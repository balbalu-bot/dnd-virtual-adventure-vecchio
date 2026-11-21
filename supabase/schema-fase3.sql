-- =====================================================================
--  D&D VIRTUAL ADVENTURE — Database FASE 3 (schede e combattimento)
--  Da eseguire DOPO schema.sql e schema-fase2.sql. Si può rieseguire.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SCHEDE: il DM può modificare le schede dei personaggi al suo tavolo
-- ---------------------------------------------------------------------
create or replace function public.dm_of_character(p_char uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.members m join public.games g on g.id = m.game_id
    where m.character_id = p_char and m.status = 'active' and g.dm_id = (select auth.uid())
  );
$$;

drop policy if exists characters_update_dm on public.characters;
create policy characters_update_dm on public.characters for update to authenticated
  using (public.dm_of_character(id)) with check (true);

-- il proprietario non cambia mai (nemmeno se modifica il DM)
create or replace function public.characters_keep_owner()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.owner_id := old.owner_id;
  return new;
end $$;
drop trigger if exists characters_keep_owner on public.characters;
create trigger characters_keep_owner before update on public.characters
  for each row execute function public.characters_keep_owner();

-- ---------------------------------------------------------------------
-- COMBATTIMENTO
-- ---------------------------------------------------------------------
create table if not exists public.encounters (
  id           uuid primary key default gen_random_uuid(),
  game_id      uuid not null references public.games(id) on delete cascade,
  name         text not null default 'Combattimento' check (char_length(name) <= 80),
  active       boolean not null default true,
  round        int not null default 1 check (round >= 1),
  current_id   uuid,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists encounters_one_active on public.encounters(game_id) where active;

create table if not exists public.combatants (
  id           uuid primary key default gen_random_uuid(),
  encounter_id uuid not null references public.encounters(id) on delete cascade,
  game_id      uuid not null references public.games(id) on delete cascade,
  name         text not null check (char_length(name) between 1 and 60),
  kind         text not null default 'monster' check (kind in ('pc','npc','monster')),
  token_id     uuid references public.tokens(id) on delete set null,
  character_id uuid references public.characters(id) on delete set null,
  owner_id     uuid references auth.users(id) on delete set null,
  initiative   numeric,
  init_bonus   int not null default 0,
  conditions   text[] not null default '{}',
  health       text not null default 'ok' check (health in ('ok','ferito','grave','a terra','morto')),
  hidden       boolean not null default false,
  target_id    uuid,
  created_at   timestamptz not null default now()
);
create index if not exists combatants_enc_idx on public.combatants(encounter_id);

-- Statistiche segrete dei mostri: le vede solo il DM
create table if not exists public.combatant_stats (
  combatant_id uuid primary key references public.combatants(id) on delete cascade,
  game_id      uuid not null references public.games(id) on delete cascade,
  hp           int not null default 10,
  hp_max       int not null default 10 check (hp_max >= 0),
  temp_hp      int not null default 0,
  ac           int not null default 10,
  notes        text not null default '' check (char_length(notes) <= 2000)
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'encounters_current_fk') then
    alter table public.encounters add constraint encounters_current_fk
      foreign key (current_id) references public.combatants(id) on delete set null;
  end if;
end $$;

drop trigger if exists encounters_touch on public.encounters;
create trigger encounters_touch before update on public.encounters for each row execute function public.touch_updated_at();

-- Stato di salute pubblico calcolato dai PF segreti (nessun numero ai giocatori)
create or replace function public.stats_health()
returns trigger language plpgsql security definer set search_path = '' as $$
declare st text;
begin
  st := case
    when new.hp <= 0 then 'a terra'
    when new.hp_max > 0 and new.hp * 2 <= new.hp_max then 'grave'
    when new.hp < new.hp_max then 'ferito'
    else 'ok' end;
  update public.combatants set health = st where id = new.combatant_id and health <> 'morto' and health is distinct from st;
  return new;
end $$;
drop trigger if exists stats_health on public.combatant_stats;
create trigger stats_health after insert or update on public.combatant_stats
  for each row execute function public.stats_health();

create or replace function public.combatants_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.encounters where id = new.encounter_id and game_id = new.game_id) then
    raise exception 'Combattimento non valido';
  end if;
  return new;
end $$;
drop trigger if exists combatants_validate on public.combatants;
create trigger combatants_validate before insert or update on public.combatants
  for each row execute function public.combatants_validate();

-- Ordine di turno: iniziativa più alta, poi bonus, poi nome
create or replace function public.combat_order(p_enc uuid)
returns table(id uuid, pos int) language sql stable security definer set search_path = '' as $$
  select c.id, (row_number() over (order by c.initiative desc nulls last, c.init_bonus desc, c.name, c.id))::int
  from public.combatants c where c.encounter_id = p_enc and c.health <> 'morto';
$$;

create or replace function public.next_turn(p_enc uuid, p_back boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  e public.encounters; cur int; n int; nxt uuid; rnd int;
begin
  select * into e from public.encounters where id = p_enc;
  if e.id is null or not public.is_dm(e.game_id) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  select count(*) into n from public.combat_order(p_enc);
  if n = 0 then raise exception 'Nessun partecipante al combattimento'; end if;
  select pos into cur from public.combat_order(p_enc) where id = e.current_id;
  rnd := e.round;
  if cur is null then
    select id into nxt from public.combat_order(p_enc) where pos = 1;
  elsif not p_back then
    if cur >= n then rnd := rnd + 1; select id into nxt from public.combat_order(p_enc) where pos = 1;
    else select id into nxt from public.combat_order(p_enc) where pos = cur + 1; end if;
  else
    if cur <= 1 then rnd := greatest(1, rnd - 1); select id into nxt from public.combat_order(p_enc) where pos = n;
    else select id into nxt from public.combat_order(p_enc) where pos = cur - 1; end if;
  end if;
  update public.encounters set current_id = nxt, round = rnd where id = p_enc;
  return json_build_object('current_id', nxt, 'round', rnd);
end $$;

-- Il giocatore imposta l'iniziativa del proprio personaggio
create or replace function public.set_initiative(p_combatant uuid, p_value numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.combatants;
begin
  select * into c from public.combatants where id = p_combatant;
  if c.id is null then raise exception 'Partecipante non trovato'; end if;
  if not public.is_dm(c.game_id) and c.owner_id is distinct from auth.uid() then
    raise exception 'Puoi impostare solo la tua iniziativa';
  end if;
  update public.combatants set initiative = greatest(-20, least(60, p_value)) where id = p_combatant;
end $$;

-- Il giocatore sceglie il bersaglio del proprio personaggio
create or replace function public.set_target(p_combatant uuid, p_target uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.combatants;
begin
  select * into c from public.combatants where id = p_combatant;
  if c.id is null then raise exception 'Partecipante non trovato'; end if;
  if not public.is_dm(c.game_id) and c.owner_id is distinct from auth.uid() then
    raise exception 'Puoi scegliere solo il tuo bersaglio';
  end if;
  if p_target is not null and not exists (select 1 from public.combatants where id = p_target and encounter_id = c.encounter_id and not hidden) then
    raise exception 'Bersaglio non valido';
  end if;
  update public.combatants set target_id = p_target where id = p_combatant;
end $$;

-- ---------------------------------------------------------------------
-- SICUREZZA
-- ---------------------------------------------------------------------
alter table public.encounters      enable row level security;
alter table public.combatants      enable row level security;
alter table public.combatant_stats enable row level security;

drop policy if exists enc_select on public.encounters;
create policy enc_select on public.encounters for select to authenticated using (public.is_member(game_id));
drop policy if exists enc_dm on public.encounters;
create policy enc_dm on public.encounters for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

drop policy if exists comb_select on public.combatants;
create policy comb_select on public.combatants for select to authenticated
  using (public.is_dm(game_id) or (not hidden and public.is_member(game_id)));
drop policy if exists comb_dm on public.combatants;
create policy comb_dm on public.combatants for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

drop policy if exists stats_dm on public.combatant_stats;
create policy stats_dm on public.combatant_stats for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

revoke all on public.encounters, public.combatants, public.combatant_stats from anon;
grant select, insert, update, delete on public.encounters, public.combatants, public.combatant_stats to authenticated;

do $$
declare f text;
begin
  foreach f in array array['dm_of_character(uuid)','combat_order(uuid)','next_turn(uuid,boolean)',
                           'set_initiative(uuid,numeric)','set_target(uuid,uuid)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;

-- Combattimento eliminato: segnala ai giocatori di toglierlo dallo schermo
create or replace function public.combatants_gone()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or (new.hidden and not old.hidden) then
    insert into public.map_signals(game_id, map_id, kind, ref_id) values (old.game_id, null, 'token_gone', old.id);
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists combatants_gone on public.combatants;
create trigger combatants_gone after update or delete on public.combatants
  for each row execute function public.combatants_gone();

-- ---------------------------------------------------------------------
-- TEMPO REALE
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['encounters','combatants','combatant_stats','characters'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Fine. Se vedi "Success. No rows returned" è tutto a posto.
