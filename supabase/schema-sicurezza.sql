-- =====================================================================
--  D&D Virtual Adventure — AGGIORNAMENTO DI SICUREZZA (gruppo privato)
--  Da eseguire DOPO tutti gli altri file (schema, fase2…fase5).
--  Non cancella partite, personaggi, mappe o messaggi. Si può rieseguire.
--
--  Cosa fa:
--   1. approvazione del DM SEMPRE obbligatoria (imposta dal database)
--   2. limite alle richieste ripetute (codici, ingressi, chat, dadi…)
--   3. al massimo 5 richieste di ingresso in attesa per partita
--   4. opzione del DM: messaggi e canali vocali privati tra giocatori
--      (se spenta, ogni comunicazione privata deve includere il DM)
--   5. canale in tempo reale della partita PRIVATO (solo membri attivi)
--   6. immagini solo interne (niente indirizzi web esterni che traccino gli IP)
--   7. espulsione: il server scollega subito l'escluso anche da audio/video
--   8. pulizia automatica dei messaggi vecchi (se disponibile pg_cron)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 0. Area privata (non raggiungibile dalle API pubbliche)
-- ---------------------------------------------------------------------
create schema if not exists dndva_private;
revoke all on schema dndva_private from public, anon, authenticated;

create table if not exists dndva_private.config (
  key   text primary key,
  value text not null
);
revoke all on dndva_private.config from public, anon, authenticated;
-- Indirizzo delle Edge Functions del progetto (pubblico: è lo stesso di config.js)
insert into dndva_private.config(key, value)
values ('functions_url', 'https://iorzwlodowfixktsjxgb.supabase.co/functions/v1')
on conflict (key) do nothing;

-- ---------------------------------------------------------------------
-- 1. Limite di frequenza (finestra fissa per utente e azione)
-- ---------------------------------------------------------------------
create table if not exists dndva_private.rate (
  user_id      uuid not null,
  action       text not null,
  window_start timestamptz not null,
  n            int not null default 0,
  primary key (user_id, action)
);
revoke all on dndva_private.rate from public, anon, authenticated;

create or replace function public.rate_hit(p_action text, p_max int, p_window interval)
returns boolean language plpgsql security definer set search_path = '' as $$
declare uid uuid := auth.uid(); r dndva_private.rate;
begin
  if uid is null then return true; end if;           -- funzioni interne / server
  select * into r from dndva_private.rate where user_id = uid and action = p_action for update;
  if r.user_id is null or now() - r.window_start > p_window then
    insert into dndva_private.rate(user_id, action, window_start, n) values (uid, p_action, now(), 1)
    on conflict (user_id, action) do update set window_start = now(), n = 1;
    return true;
  end if;
  if r.n >= p_max then return false; end if;
  update dndva_private.rate set n = n + 1 where user_id = uid and action = p_action;
  return true;
end $$;
revoke all on function public.rate_hit(text, int, interval) from public, anon, authenticated;

-- Trigger generico: limita gli inserimenti per utente (azione = nome tabella)
create or replace function public.rate_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare mx int := tg_argv[0]::int; win interval := tg_argv[1]::interval;
begin
  if not public.rate_hit('ins:' || tg_table_name, mx, win) then
    raise exception 'Troppe operazioni in poco tempo: aspetta un attimo e riprova';
  end if;
  return new;
end $$;
revoke all on function public.rate_guard() from public, anon, authenticated;

do $$
declare t text[];
begin
  foreach t slice 1 in array array[
    ['messages',       '20', '30 seconds'],
    ['dice_rolls',     '30', '1 minute'],
    ['games',          '5',  '1 hour'],
    ['voice_channels', '10', '1 minute'],
    ['chronicle',      '300', '1 hour'],      -- alto: l'importazione di una campagna inserisce molte voci
    ['drawings',       '1000', '10 minutes'],
    ['characters',     '100', '1 hour']
  ] loop
    if to_regclass('public.' || t[1]) is not null then
      execute format('drop trigger if exists zz_rate_guard on public.%I', t[1]);
      execute format('create trigger zz_rate_guard before insert on public.%I for each row execute function public.rate_guard(%L, %L)', t[1], t[2], t[3]);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 2. Ingresso: approvazione SEMPRE obbligatoria, tentativi limitati
-- ---------------------------------------------------------------------
-- tutte le partite (anche quelle già esistenti) passano dalla sala d'attesa
update public.games set require_approval = true where not require_approval;
alter table public.games alter column require_approval set default true;
create or replace function public.games_force_approval()
returns trigger language plpgsql set search_path = '' as $$
begin new.require_approval := true; return new; end $$;
drop trigger if exists games_force_approval on public.games;
create trigger games_force_approval before insert or update on public.games
  for each row execute function public.games_force_approval();

-- nomi: niente caratteri di controllo, niente spazi strani, 1–40 caratteri
create or replace function public.clean_name(p text)
returns text language sql immutable set search_path = '' as $$
  select left(btrim(regexp_replace(regexp_replace(coalesce(p, ''), '[[:cntrl:]​-‏‪-‮⁠-⁤﻿]', '', 'g'), '\s+', ' ', 'g')), 40);
$$;

create or replace function public.join_game(
  p_code text, p_display_name text, p_character_id uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  nm text := public.clean_name(p_display_name);
  g public.games;
  m public.members;
  cname text := '';
  n int;
begin
  if uid is null then raise exception 'Accesso non effettuato'; end if;
  -- massimo 8 tentativi ogni 10 minuti per identità (i codici sbagliati contano:
  -- per questo l'errore "codice non valido" viene restituito, non sollevato)
  if not public.rate_hit('join', 8, interval '10 minutes') then
    return json_build_object('error', 'Troppi tentativi: riprova tra qualche minuto');
  end if;
  if nm = '' then return json_build_object('error', 'Inserisci il tuo nome'); end if;
  select * into g from public.games where invite_code = code;
  if g.id is null then return json_build_object('error', 'Codice partita non valido'); end if;
  if p_character_id is not null then
    select name into cname from public.characters where id = p_character_id and owner_id = uid;
    if cname is null then raise exception 'Personaggio non valido'; end if;
  end if;

  select * into m from public.members where game_id = g.id and user_id = uid;
  if m.user_id is not null then
    if m.status = 'banned' then raise exception 'Il Dungeon Master ti ha escluso da questa partita'; end if;
    update public.members
       set display_name = nm,
           character_id = coalesce(p_character_id, character_id),
           character_name = case when p_character_id is null then character_name else cname end,
           last_seen = now()
     where game_id = g.id and user_id = uid;
    return json_build_object('game_id', g.id, 'status', m.status, 'name', g.name);
  end if;

  if g.locked then raise exception 'La stanza è chiusa: chiedi al DM di riaprirla'; end if;
  select count(*) into n from public.members where game_id = g.id and status <> 'banned';
  if n >= g.max_players then raise exception 'La partita è al completo (% partecipanti)', g.max_players; end if;
  select count(*) into n from public.members where game_id = g.id and status = 'pending';
  if n >= 5 then raise exception 'Ci sono già troppe richieste in attesa: riprova più tardi'; end if;

  insert into public.members(game_id, user_id, display_name, role, status, character_id, character_name)
  values (g.id, uid, nm, 'player', 'pending', p_character_id, coalesce(cname,''));
  return json_build_object('game_id', g.id, 'status', 'pending', 'name', g.name);
end $$;

-- un nome cambiato in seguito resta "pulito"
create or replace function public.members_clean_name()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.display_name := public.clean_name(new.display_name);
  if new.display_name = '' then raise exception 'Nome non valido'; end if;
  return new;
end $$;
drop trigger if exists members_clean_name on public.members;
create trigger members_clean_name before insert or update of display_name on public.members
  for each row execute function public.members_clean_name();

-- ---------------------------------------------------------------------
-- 3. Comunicazioni private tra giocatori (opzione del DM, default: permesse)
--    games.settings.private_players = false → ogni messaggio privato/di gruppo
--    e ogni canale vocale privato deve comprendere il DM.
-- ---------------------------------------------------------------------
create or replace function public.private_players_allowed(p_game uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((settings->>'private_players')::boolean, true) from public.games where id = p_game;
$$;

create or replace function public.messages_private_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dm uuid;
begin
  if new.kind in ('private', 'group') and not public.private_players_allowed(new.game_id) then
    select dm_id into dm from public.games where id = new.game_id;
    if new.sender_id <> dm and not (dm = any(coalesce(new.recipients, '{}'))) then
      raise exception 'Il DM ha disattivato i messaggi privati tra giocatori: scrivi a tutti o al DM';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists messages_zprivate on public.messages;   -- dopo messages_validate (ordine alfabetico)
create trigger messages_zprivate before insert on public.messages
  for each row execute function public.messages_private_rule();

create or replace function public.voice_private_rule()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dm uuid;
begin
  if not public.private_players_allowed(new.game_id) then
    select dm_id into dm from public.games where id = new.game_id;
    if not (dm = any(new.members)) then
      raise exception 'Il DM ha disattivato i canali privati tra giocatori: il DM deve far parte del canale';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists voice_private_rule on public.voice_channels;
create trigger voice_private_rule before insert on public.voice_channels
  for each row execute function public.voice_private_rule();

-- quando il DM spegne i privati, si chiudono subito i canali vocali senza DM
create or replace function public.games_close_private_channels()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if coalesce((new.settings->>'private_players')::boolean, true) = false
     and coalesce((old.settings->>'private_players')::boolean, true) = true then
    update public.voice_channels set active = false
     where game_id = new.id and active and not (new.dm_id = any(members));
  end if;
  return new;
end $$;
drop trigger if exists games_close_private_channels on public.games;
create trigger games_close_private_channels after update of settings on public.games
  for each row execute function public.games_close_private_channels();

-- ---------------------------------------------------------------------
-- 4. Immagini: solo immagini incorporate o interne al sito.
--    Un indirizzo esterno (https://…) farebbe scaricare l'immagine da un
--    server sconosciuto a ogni giocatore, rivelandone l'indirizzo IP.
--    NOT VALID: le righe vecchie restano; le nuove devono rispettare la regola.
-- ---------------------------------------------------------------------
create or replace function public.safe_image(p text)
returns boolean language sql immutable set search_path = '' as $$
  select p is null or p ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' or p ~ '^img/[a-z0-9/_-]+\.(svg|png|webp|jpg)$';
$$;
do $$
declare t text[];
begin
  foreach t slice 1 in array array[['tokens','image'], ['characters','portrait'], ['bestiary','image']] loop
    if to_regclass('public.' || t[1]) is not null
       and not exists (select 1 from pg_constraint where conname = t[1] || '_safe_image') then
      execute format('alter table public.%I add constraint %I check (public.safe_image(%I)) not valid', t[1], t[1] || '_safe_image', t[2]);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 5. Canale in tempo reale della partita: SOLO membri attivi
--    (il client lo apre come canale privato "game-<id>")
-- ---------------------------------------------------------------------
create or replace function public.topic_game(p_topic text)
returns uuid language sql immutable set search_path = '' as $$
  select case when p_topic ~ '^game-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              then substr(p_topic, 6)::uuid end;
$$;
do $$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'Realtime Authorization non disponibile in questo database';
    return;
  end if;
  execute 'drop policy if exists "dndva game channel read" on realtime.messages';
  execute $p$create policy "dndva game channel read" on realtime.messages for select to authenticated
           using (public.is_member(public.topic_game((select realtime.topic()))))$p$;
  execute 'drop policy if exists "dndva game channel write" on realtime.messages';
  execute $p$create policy "dndva game channel write" on realtime.messages for insert to authenticated
           with check (public.is_member(public.topic_game((select realtime.topic()))))$p$;
exception when others then
  raise notice 'ATTENZIONE: regole del canale in tempo reale non create (%)', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 6. Espulsione: il database chiede subito al server audio/video di
--    scollegare chi non è più autorizzato (Edge Function "livekit-guard").
--    Richiede l'estensione pg_net (presente in Supabase).
-- ---------------------------------------------------------------------
do $$ begin
  create extension if not exists pg_net with schema extensions;
exception when others then
  raise notice 'pg_net non disponibile (%): l''espulsione da audio/video resterà affidata al pannello del DM', sqlerrm;
end $$;

create or replace function public.voice_sweep(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare url text;
begin
  select value into url from dndva_private.config where key = 'functions_url';
  if url is null or to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') is null then return; end if;
  execute 'select net.http_post(url := $1, body := $2, headers := $3)'
    using url || '/livekit-guard', jsonb_build_object('game_id', p_game), '{"Content-Type":"application/json"}'::jsonb;
exception when others then
  raise notice 'voice_sweep: %', sqlerrm;   -- mai bloccare l'espulsione per un problema di rete
end $$;
revoke all on function public.voice_sweep(uuid) from public, anon, authenticated;

create or replace function public.members_voice_sweep()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.status = 'active' then perform public.voice_sweep(old.game_id); end if;
    return old;
  end if;
  if old.status = 'active' and new.status <> 'active' then perform public.voice_sweep(new.game_id); end if;
  return new;
end $$;
drop trigger if exists members_voice_sweep on public.members;
create trigger members_voice_sweep after update of status or delete on public.members
  for each row execute function public.members_voice_sweep();

-- ---------------------------------------------------------------------
-- 7. Conservazione dei messaggi
--    Nuove partite: 30 giorni. Le partite esistenti mantengono la loro scelta
--    (Strumenti DM → Campagna). Pulizia notturna automatica se c'è pg_cron.
-- ---------------------------------------------------------------------
create or replace function public.games_default_retention()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.settings ? 'retention_days' is false then
    new.settings := coalesce(new.settings, '{}'::jsonb) || '{"retention_days": 30}'::jsonb;
  end if;
  return new;
end $$;
drop trigger if exists games_default_retention on public.games;
create trigger games_default_retention before insert on public.games
  for each row execute function public.games_default_retention();

create or replace function dndva_private.purge_all_messages()
returns void language sql security definer set search_path = '' as $$
  delete from public.messages m using public.games g
   where m.game_id = g.id
     and coalesce((g.settings->>'retention_days')::int, 0) > 0
     and m.created_at < now() - make_interval(days => (g.settings->>'retention_days')::int);
  delete from dndva_private.rate where window_start < now() - interval '1 day';
$$;
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule(jobid) from cron.job where jobname = 'dndva-purge';
  perform cron.schedule('dndva-purge', '17 3 * * *', 'select dndva_private.purge_all_messages()');
exception when others then
  raise notice 'pg_cron non disponibile (%): i messaggi vecchi verranno tolti quando il DM entra nella partita', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- 8. Permessi delle nuove funzioni
-- ---------------------------------------------------------------------
revoke all on function public.join_game(text, text, uuid) from public, anon;
grant execute on function public.join_game(text, text, uuid) to authenticated;
revoke all on function public.clean_name(text), public.safe_image(text), public.topic_game(text) from public, anon;
grant execute on function public.clean_name(text), public.safe_image(text), public.topic_game(text), public.private_players_allowed(uuid) to authenticated;
revoke all on function public.private_players_allowed(uuid) from anon;
revoke all on function public.members_voice_sweep(), public.messages_private_rule(), public.voice_private_rule(),
  public.games_force_approval(), public.members_clean_name(), public.games_default_retention(), public.games_close_private_channels() from public, anon, authenticated;

notify pgrst, 'reload schema';
-- Fine. "Success" (eventuali NOTICE sono solo informazioni).
