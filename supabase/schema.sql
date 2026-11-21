-- =====================================================================
--  D&D VIRTUAL ADVENTURE — Database Supabase (Fase 1)
--  Incolla TUTTO questo file nel "SQL Editor" di Supabase e premi RUN.
--  Lo script si può rieseguire: ricrea funzioni e policy senza perdere dati.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABELLE
-- ---------------------------------------------------------------------

create table if not exists public.games (
  id               uuid primary key default gen_random_uuid(),
  name             text not null check (char_length(name) between 1 and 80),
  invite_code      text not null unique,
  dm_id            uuid not null references auth.users(id) on delete cascade,
  locked           boolean not null default false,   -- stanza chiusa ai nuovi ingressi
  require_approval boolean not null default false,   -- il DM approva ogni nuovo ingresso
  paused           boolean not null default false,   -- sessione in pausa
  max_players      int not null default 8 check (max_players between 2 and 20),
  settings         jsonb not null default '{}'::jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table if not exists public.characters (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 60),
  species     text not null default '' check (char_length(species) <= 60),
  class       text not null default '' check (char_length(class) <= 60),
  level       int  not null default 1 check (level between 1 and 20),
  background  text not null default '' check (char_length(background) <= 60),
  portrait    text check (portrait is null or char_length(portrait) <= 150000),
  data        jsonb not null default '{}'::jsonb,   -- scheda completa (Fase 3)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.members (
  game_id        uuid not null references public.games(id) on delete cascade,
  user_id        uuid not null references auth.users(id) on delete cascade,
  display_name   text not null check (char_length(display_name) between 1 and 40),
  role           text not null check (role in ('dm','player')),
  status         text not null default 'active' check (status in ('active','pending','banned')),
  character_id   uuid references public.characters(id) on delete set null,
  character_name text not null default '' check (char_length(character_name) <= 60),
  joined_at      timestamptz not null default now(),
  last_seen      timestamptz not null default now(),
  primary key (game_id, user_id)
);
create index if not exists members_user_idx on public.members(user_id);

create table if not exists public.messages (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games(id) on delete cascade,
  sender_id   uuid references auth.users(id) on delete set null,   -- null = messaggio di sistema
  sender_name text not null default '',
  kind        text not null check (kind in ('general','private','dm','group','system')),
  recipients  uuid[],                 -- null = visibile a tutti i membri attivi
  body        text not null check (char_length(body) between 1 and 2000),
  meta        jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists messages_game_idx on public.messages(game_id, id desc);

create table if not exists public.voice_channels (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  created_by  uuid not null references auth.users(id) on delete cascade,
  name        text not null default '' check (char_length(name) <= 60),
  members     uuid[] not null,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists voice_channels_game_idx on public.voice_channels(game_id) where active;

-- ---------------------------------------------------------------------
-- FUNZIONI DI SUPPORTO (usate dalle policy)
-- ---------------------------------------------------------------------

create or replace function public.is_member(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m
    where m.game_id = g and m.user_id = (select auth.uid()) and m.status = 'active'
  );
$$;

create or replace function public.is_dm(g uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.games where id = g and dm_id = (select auth.uid()));
$$;

create or replace function public.new_invite_code()
returns text language plpgsql volatile set search_path = '' as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';  -- niente 0/O/1/I
  b bytea := uuid_send(gen_random_uuid());
  idx int[] := array[0,1,2,3,4,5,10,11];                          -- byte totalmente casuali
  code text := '';
  i int;
begin
  foreach i in array idx loop
    code := code || substr(alphabet, (get_byte(b, i) % 32) + 1, 1);
  end loop;
  return code;
end $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;

drop trigger if exists games_touch on public.games;
create trigger games_touch before update on public.games
  for each row execute function public.touch_updated_at();
drop trigger if exists characters_touch on public.characters;
create trigger characters_touch before update on public.characters
  for each row execute function public.touch_updated_at();
drop trigger if exists voice_channels_touch on public.voice_channels;
create trigger voice_channels_touch before update on public.voice_channels
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- RPC: PARTITE E MEMBRI
-- ---------------------------------------------------------------------

create or replace function public.create_game(
  p_name text, p_display_name text, p_character_id uuid default null,
  p_max_players int default 8, p_require_approval boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  g public.games;
  cname text := '';
  tries int := 0;
begin
  if uid is null then raise exception 'Accesso non effettuato'; end if;
  if coalesce(trim(p_name),'') = '' then raise exception 'Inserisci il nome della partita'; end if;
  if coalesce(trim(p_display_name),'') = '' then raise exception 'Inserisci il tuo nome'; end if;
  if (select count(*) from public.games where dm_id = uid) >= 30 then
    raise exception 'Hai già troppe partite come DM';
  end if;
  if p_character_id is not null then
    select name into cname from public.characters where id = p_character_id and owner_id = uid;
    if cname is null then raise exception 'Personaggio non valido'; end if;
  end if;
  loop
    begin
      insert into public.games(name, invite_code, dm_id, max_players, require_approval)
      values (trim(p_name), public.new_invite_code(), uid,
              greatest(2, least(20, coalesce(p_max_players, 8))), coalesce(p_require_approval,false))
      returning * into g;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise; end if;
    end;
  end loop;
  insert into public.members(game_id, user_id, display_name, role, status, character_id, character_name)
  values (g.id, uid, left(trim(p_display_name),40), 'dm', 'active', p_character_id, coalesce(cname,''));
  return json_build_object('game_id', g.id, 'invite_code', g.invite_code, 'name', g.name);
end $$;

create or replace function public.join_game(
  p_code text, p_display_name text, p_character_id uuid default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  code text := upper(regexp_replace(coalesce(p_code,''), '[^A-Za-z0-9]', '', 'g'));
  g public.games;
  m public.members;
  cname text := '';
  n int;
  st text;
begin
  if uid is null then raise exception 'Accesso non effettuato'; end if;
  if coalesce(trim(p_display_name),'') = '' then raise exception 'Inserisci il tuo nome'; end if;
  select * into g from public.games where invite_code = code;
  if g.id is null then raise exception 'Codice partita non valido'; end if;
  if p_character_id is not null then
    select name into cname from public.characters where id = p_character_id and owner_id = uid;
    if cname is null then raise exception 'Personaggio non valido'; end if;
  end if;

  select * into m from public.members where game_id = g.id and user_id = uid;
  if m.user_id is not null then
    if m.status = 'banned' then raise exception 'Il Dungeon Master ti ha escluso da questa partita'; end if;
    update public.members
       set display_name = left(trim(p_display_name),40),
           character_id = coalesce(p_character_id, character_id),
           character_name = case when p_character_id is null then character_name else cname end,
           last_seen = now()
     where game_id = g.id and user_id = uid;
    return json_build_object('game_id', g.id, 'status', m.status, 'name', g.name);
  end if;

  if g.locked then raise exception 'La stanza è chiusa: chiedi al DM di riaprirla'; end if;
  select count(*) into n from public.members where game_id = g.id and status <> 'banned';
  if n >= g.max_players then raise exception 'La partita è al completo (% partecipanti)', g.max_players; end if;

  st := case when g.require_approval then 'pending' else 'active' end;
  insert into public.members(game_id, user_id, display_name, role, status, character_id, character_name)
  values (g.id, uid, left(trim(p_display_name),40), 'player', st, p_character_id, coalesce(cname,''));
  return json_build_object('game_id', g.id, 'status', st, 'name', g.name);
end $$;

-- Il DM approva / esclude / riammette un partecipante
create or replace function public.set_member_status(p_game uuid, p_user uuid, p_status text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  if p_user = auth.uid() then raise exception 'Non puoi cambiare il tuo stato'; end if;
  if p_status not in ('active','banned') then raise exception 'Stato non valido'; end if;
  update public.members set status = p_status where game_id = p_game and user_id = p_user;
  if p_status = 'banned' then
    -- l'escluso esce da tutti i canali privati della partita
    update public.voice_channels
       set members = array_remove(members, p_user),
           active = cardinality(array_remove(members, p_user)) >= 2
     where game_id = p_game and active and p_user = any(members);
  end if;
end $$;

-- Rifiuta una richiesta di ingresso (cancella la richiesta in attesa)
create or replace function public.reject_member(p_game uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  update public.members set status = 'banned'
   where game_id = p_game and user_id = p_user and status = 'pending';
end $$;

create or replace function public.transfer_dm(p_game uuid, p_user uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  if not exists (select 1 from public.members where game_id = p_game and user_id = p_user and status = 'active') then
    raise exception 'Il nuovo DM deve essere un partecipante attivo';
  end if;
  update public.members set role = 'player' where game_id = p_game and user_id = auth.uid();
  update public.members set role = 'dm' where game_id = p_game and user_id = p_user;
  update public.games set dm_id = p_user where id = p_game;
end $$;

create or replace function public.regenerate_invite(p_game uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare c text;
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  loop
    c := public.new_invite_code();
    exit when not exists (select 1 from public.games where invite_code = c);
  end loop;
  update public.games set invite_code = c where id = p_game;
  return c;
end $$;

create or replace function public.leave_game(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if public.is_dm(p_game) then
    raise exception 'Il DM non può abbandonare: trasferisci prima il ruolo o elimina la partita';
  end if;
  update public.voice_channels
     set members = array_remove(members, auth.uid()),
         active = cardinality(array_remove(members, auth.uid())) >= 2
   where game_id = p_game and active and auth.uid() = any(members);
  delete from public.members where game_id = p_game and user_id = auth.uid();
end $$;

create or replace function public.delete_game(p_game uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  delete from public.games where id = p_game;
end $$;

-- ---------------------------------------------------------------------
-- RPC: CANALI VOCALI PRIVATI
-- ---------------------------------------------------------------------

create or replace function public.open_voice_channel(p_game uuid, p_members uuid[], p_name text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  mem uuid[];
  existing uuid;
  cid uuid;
begin
  if not public.is_member(p_game) then raise exception 'Non fai parte di questa partita'; end if;
  select array_agg(distinct x order by x) into mem from unnest(coalesce(p_members,'{}') || uid) as x;
  if cardinality(mem) < 2 then raise exception 'Seleziona almeno un altro partecipante'; end if;
  if cardinality(mem) > 8 then raise exception 'Massimo 8 persone in un canale privato'; end if;
  if exists (
    select 1 from unnest(mem) x
    where not exists (select 1 from public.members m
                      where m.game_id = p_game and m.user_id = x and m.status = 'active')
  ) then raise exception 'Tutti i partecipanti del canale devono essere membri attivi'; end if;

  -- se esiste già un canale attivo con le stesse persone, riusalo
  select id into existing from public.voice_channels
   where game_id = p_game and active
     and (select array_agg(x order by x) from unnest(members) x) = mem
   limit 1;
  if existing is not null then return existing; end if;

  insert into public.voice_channels(game_id, created_by, name, members)
  values (p_game, uid, left(coalesce(p_name,''),60), mem)
  returning id into cid;
  return cid;
end $$;

create or replace function public.leave_voice_channel(p_channel uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.voice_channels
     set members = array_remove(members, auth.uid()),
         active = cardinality(array_remove(members, auth.uid())) >= 2
   where id = p_channel and auth.uid() = any(members);
end $$;

-- ---------------------------------------------------------------------
-- TRIGGER: MESSAGGI (validazione lato server) E MESSAGGI DI SISTEMA
-- ---------------------------------------------------------------------

create or replace function public.messages_before_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  sname text;
  dm uuid;
  rec uuid[];
begin
  if new.kind = 'system' then
    -- solo le funzioni del server (che non passano dalle policy) creano messaggi di sistema
    return new;
  end if;
  new.sender_id := uid;
  new.created_at := now();
  select display_name into sname from public.members
   where game_id = new.game_id and user_id = uid and status = 'active';
  if sname is null then raise exception 'Non fai parte di questa partita'; end if;
  new.sender_name := sname;
  new.body := left(new.body, 2000);

  if new.kind = 'general' then
    new.recipients := null;
  elsif new.kind = 'dm' then
    select dm_id into dm from public.games where id = new.game_id;
    if dm = uid then raise exception 'Sei tu il DM: scegli un destinatario'; end if;
    new.recipients := array[dm];
  else
    select array_agg(distinct x) into rec
      from unnest(coalesce(new.recipients,'{}')) x where x <> uid;
    if rec is null then raise exception 'Scegli almeno un destinatario'; end if;
    if new.kind = 'private' and cardinality(rec) <> 1 then
      raise exception 'Un messaggio privato ha un solo destinatario';
    end if;
    if exists (select 1 from unnest(rec) x where not exists (
         select 1 from public.members m where m.game_id = new.game_id and m.user_id = x and m.status = 'active'))
    then raise exception 'Destinatario non valido'; end if;
    new.recipients := rec;
  end if;
  return new;
end $$;

drop trigger if exists messages_validate on public.messages;
create trigger messages_validate before insert on public.messages
  for each row execute function public.messages_before_insert();

create or replace function public.members_system_messages()
returns trigger language plpgsql security definer set search_path = '' as $$
declare dm uuid;
begin
  select dm_id into dm from public.games where id = new.game_id;
  if tg_op = 'INSERT' then
    if new.role = 'dm' then return new; end if;
    if new.status = 'pending' then
      insert into public.messages(game_id, sender_name, kind, recipients, body, meta)
      values (new.game_id, 'Sistema', 'system', array[dm],
              new.display_name || ' chiede di entrare nella partita.', json_build_object('event','join_request')::jsonb);
    else
      insert into public.messages(game_id, sender_name, kind, body, meta)
      values (new.game_id, 'Sistema', 'system', new.display_name || ' è entrato nella partita.',
              json_build_object('event','join')::jsonb);
    end if;
  elsif tg_op = 'UPDATE' then
    if old.status is distinct from new.status then
      if new.status = 'active' then
        insert into public.messages(game_id, sender_name, kind, body, meta)
        values (new.game_id, 'Sistema', 'system', new.display_name || ' è stato ammesso al tavolo.',
                json_build_object('event','admitted')::jsonb);
      elsif new.status = 'banned' and old.status = 'active' then
        insert into public.messages(game_id, sender_name, kind, body, meta)
        values (new.game_id, 'Sistema', 'system', new.display_name || ' è stato allontanato dal tavolo.',
                json_build_object('event','banned')::jsonb);
      end if;
    elsif old.role is distinct from new.role and new.role = 'dm' then
      insert into public.messages(game_id, sender_name, kind, body, meta)
      values (new.game_id, 'Sistema', 'system', new.display_name || ' è il nuovo Dungeon Master.',
              json_build_object('event','new_dm')::jsonb);
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_events on public.members;
create trigger members_events after insert or update on public.members
  for each row execute function public.members_system_messages();

-- Un membro può collegare solo un proprio personaggio
create or replace function public.members_check_character()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.character_id is not null and new.character_id is distinct from old.character_id then
    if not exists (select 1 from public.characters where id = new.character_id and owner_id = new.user_id) then
      raise exception 'Personaggio non valido';
    end if;
  end if;
  return new;
end $$;

drop trigger if exists members_character on public.members;
create trigger members_character before update on public.members
  for each row execute function public.members_check_character();

-- ---------------------------------------------------------------------
-- SICUREZZA: ROW LEVEL SECURITY
-- ---------------------------------------------------------------------

alter table public.games          enable row level security;
alter table public.characters     enable row level security;
alter table public.members        enable row level security;
alter table public.messages       enable row level security;
alter table public.voice_channels enable row level security;

-- PARTITE: le vedono solo i membri attivi; le modifica solo il DM
drop policy if exists games_select on public.games;
create policy games_select on public.games for select to authenticated
  using (public.is_member(id) or dm_id = (select auth.uid()));
drop policy if exists games_update on public.games;
create policy games_update on public.games for update to authenticated
  using (dm_id = (select auth.uid())) with check (dm_id = (select auth.uid()));

-- MEMBRI: li vedono i membri attivi (e ognuno vede la propria riga)
drop policy if exists members_select on public.members;
create policy members_select on public.members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_member(game_id));
drop policy if exists members_update_self on public.members;
create policy members_update_self on public.members for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- PERSONAGGI: il proprietario li gestisce; i compagni di tavolo li vedono
drop policy if exists characters_select on public.characters;
create policy characters_select on public.characters for select to authenticated
  using (owner_id = (select auth.uid()) or exists (
    select 1 from public.members m where m.character_id = characters.id and public.is_member(m.game_id)));
drop policy if exists characters_insert on public.characters;
create policy characters_insert on public.characters for insert to authenticated
  with check (owner_id = (select auth.uid()));
drop policy if exists characters_update on public.characters;
create policy characters_update on public.characters for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
drop policy if exists characters_delete on public.characters;
create policy characters_delete on public.characters for delete to authenticated
  using (owner_id = (select auth.uid()));

-- MESSAGGI: un messaggio privato è leggibile SOLO da mittente e destinatari
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages for select to authenticated
  using (public.is_member(game_id) and (
         recipients is null
      or sender_id = (select auth.uid())
      or (select auth.uid()) = any(recipients)));
drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages for insert to authenticated
  with check (sender_id = (select auth.uid()) and kind <> 'system' and public.is_member(game_id));

-- CANALI VOCALI: li vedono solo le persone che ne fanno parte
drop policy if exists voice_select on public.voice_channels;
create policy voice_select on public.voice_channels for select to authenticated
  using (public.is_member(game_id) and (select auth.uid()) = any(members));

-- ---------------------------------------------------------------------
-- PERMESSI (chi può fare cosa a livello di colonne)
-- ---------------------------------------------------------------------

revoke all on public.games, public.characters, public.members, public.messages, public.voice_channels from anon;
revoke insert, update, delete on public.games, public.members, public.voice_channels from authenticated;
revoke update, delete on public.messages from authenticated;
grant select on public.games, public.members, public.messages, public.voice_channels to authenticated;
grant select, insert, update, delete on public.characters to authenticated;
grant insert on public.messages to authenticated;
grant update (name, locked, require_approval, paused, max_players, settings) on public.games to authenticated;
grant update (display_name, character_id, character_name, last_seen) on public.members to authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'is_member(uuid)','is_dm(uuid)','create_game(text,text,uuid,int,boolean)','join_game(text,text,uuid)',
    'set_member_status(uuid,uuid,text)','reject_member(uuid,uuid)','transfer_dm(uuid,uuid)',
    'regenerate_invite(uuid)','leave_game(uuid)','delete_game(uuid)',
    'open_voice_channel(uuid,uuid[],text)','leave_voice_channel(uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.new_invite_code() from public, anon, authenticated';
end $$;

-- ---------------------------------------------------------------------
-- TEMPO REALE: le tabelle che inviano aggiornamenti istantanei
-- (gli aggiornamenti rispettano le stesse regole di sicurezza)
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['games','members','messages','voice_channels'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Fine. Se vedi "Success. No rows returned" è tutto a posto.
