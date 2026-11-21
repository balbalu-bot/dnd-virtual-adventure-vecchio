-- =====================================================================
--  D&D VIRTUAL ADVENTURE — Database FASE 4 (campagne e strumenti del DM)
--  Da eseguire DOPO schema.sql, schema-fase2.sql e schema-fase3.sql.
--  Si può rieseguire senza perdere dati.
-- =====================================================================

-- Note private del DM (le vede solo il DM)
create table if not exists public.dm_notes (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  title      text not null default '' check (char_length(title) <= 120),
  body       text not null default '' check (char_length(body) <= 50000),
  pinned     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists dm_notes_game_idx on public.dm_notes(game_id);

-- Cronaca della campagna (visibile a tutti; scrivono tutti, il DM modifica tutto)
create table if not exists public.chronicle (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  author_id   uuid default auth.uid() references auth.users(id) on delete set null,
  author_name text not null default '',
  session_no  int check (session_no is null or session_no between 0 and 9999),
  title       text not null default '' check (char_length(title) <= 160),
  body        text not null default '' check (char_length(body) <= 20000),
  happened_on date default current_date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chronicle_game_idx on public.chronicle(game_id, happened_on desc);

-- Scene preparate dal DM
create table if not exists public.scenes (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.games(id) on delete cascade,
  name        text not null check (char_length(name) between 1 and 120),
  map_id      uuid references public.maps(id) on delete set null,
  handout_id  uuid,
  read_aloud  text not null default '' check (char_length(read_aloud) <= 8000),
  dm_notes    text not null default '' check (char_length(dm_notes) <= 8000),
  music       jsonb,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists scenes_game_idx on public.scenes(game_id, sort);

-- Archivio di mostri e PNG (statistiche riservate al DM)
create table if not exists public.bestiary (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 80),
  kind       text not null default 'monster' check (kind in ('monster','npc')),
  size       numeric not null default 1 check (size between 0.25 and 10),
  color      text not null default '#b3261e' check (char_length(color) <= 20),
  image      text check (image is null or char_length(image) <= 120000),
  hp         int not null default 10 check (hp between 0 and 9999),
  ac         int not null default 12 check (ac between 0 and 50),
  init_bonus int not null default 0 check (init_bonus between -20 and 30),
  speed      text not null default '9 m' check (char_length(speed) <= 40),
  attacks    text not null default '' check (char_length(attacks) <= 4000),
  notes      text not null default '' check (char_length(notes) <= 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists bestiary_game_idx on public.bestiary(game_id);

-- Immagini da mostrare ai giocatori
create table if not exists public.handouts (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  title      text not null default '' check (char_length(title) <= 160),
  image_path text not null,
  shown_at   timestamptz,               -- null = preparata, non ancora mostrata
  created_at timestamptz not null default now()
);
create index if not exists handouts_game_idx on public.handouts(game_id);

-- Brani audio caricati dal DM
create table if not exists public.audio_tracks (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 120),
  file_path  text not null,
  kind       text not null default 'music' check (kind in ('music','sfx')),
  created_at timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'scenes_handout_fk') then
    alter table public.scenes add constraint scenes_handout_fk foreign key (handout_id) references public.handouts(id) on delete set null;
  end if;
end $$;

drop trigger if exists dm_notes_touch on public.dm_notes;
create trigger dm_notes_touch before update on public.dm_notes for each row execute function public.touch_updated_at();
drop trigger if exists chronicle_touch on public.chronicle;
create trigger chronicle_touch before update on public.chronicle for each row execute function public.touch_updated_at();
drop trigger if exists scenes_touch on public.scenes;
create trigger scenes_touch before update on public.scenes for each row execute function public.touch_updated_at();
drop trigger if exists bestiary_touch on public.bestiary;
create trigger bestiary_touch before update on public.bestiary for each row execute function public.touch_updated_at();

create or replace function public.chronicle_author()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    select display_name into new.author_name from public.members where game_id = new.game_id and user_id = auth.uid();
    new.author_name := coalesce(new.author_name, '');
  else
    new.author_id := old.author_id; new.author_name := old.author_name;
  end if;
  return new;
end $$;
drop trigger if exists chronicle_author on public.chronicle;
create trigger chronicle_author before insert or update on public.chronicle for each row execute function public.chronicle_author();

-- ---------------------------------------------------------------------
-- CONSERVAZIONE DEI MESSAGGI
--   games.settings.retention_days: 0 o assente = per sempre
-- ---------------------------------------------------------------------
create or replace function public.purge_messages(p_game uuid, p_all boolean default false)
returns int language plpgsql security definer set search_path = '' as $$
declare days int; n int;
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  if p_all then
    delete from public.messages where game_id = p_game;
  else
    select coalesce((settings->>'retention_days')::int, 0) into days from public.games where id = p_game;
    if days <= 0 then return 0; end if;
    delete from public.messages where game_id = p_game and created_at < now() - make_interval(days => days);
  end if;
  get diagnostics n = row_count;
  if not p_all then
    delete from public.dice_rolls where game_id = p_game and days > 0 and created_at < now() - make_interval(days => days);
  end if;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- STORAGE: i giocatori leggono anche le immagini mostrate e la musica
-- ---------------------------------------------------------------------
create or replace function public.can_read_map_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_dm(public.path_game(p_name))
    or exists (select 1 from public.maps m join public.games g on g.active_map_id = m.id
               where m.image_path = p_name and public.is_member(m.game_id))
    or exists (select 1 from public.handouts h
               where h.image_path = p_name and h.shown_at is not null and public.is_member(h.game_id))
    or exists (select 1 from public.audio_tracks a
               where a.file_path = p_name and public.is_member(a.game_id));
$$;

do $$
begin
  update storage.buckets set allowed_mime_types = array['image/jpeg','image/png','image/webp','audio/mpeg','audio/mp4','audio/ogg','audio/wav','audio/x-wav','audio/webm','audio/aac','audio/x-m4a'],
    file_size_limit = 26214400
  where id = 'maps';
exception when others then
  raise notice 'ATTENZIONE: Storage non aggiornato (%). Carica i file audio dopo aver creato il bucket "maps".', sqlerrm;
end $$;

-- ---------------------------------------------------------------------
-- SICUREZZA
-- ---------------------------------------------------------------------
alter table public.dm_notes     enable row level security;
alter table public.chronicle    enable row level security;
alter table public.scenes       enable row level security;
alter table public.bestiary     enable row level security;
alter table public.handouts     enable row level security;
alter table public.audio_tracks enable row level security;

drop policy if exists dm_notes_dm on public.dm_notes;
create policy dm_notes_dm on public.dm_notes for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));
drop policy if exists scenes_dm on public.scenes;
create policy scenes_dm on public.scenes for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));
drop policy if exists bestiary_dm on public.bestiary;
create policy bestiary_dm on public.bestiary for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

drop policy if exists chronicle_select on public.chronicle;
create policy chronicle_select on public.chronicle for select to authenticated using (public.is_member(game_id));
drop policy if exists chronicle_insert on public.chronicle;
create policy chronicle_insert on public.chronicle for insert to authenticated with check (public.is_member(game_id));
drop policy if exists chronicle_update on public.chronicle;
create policy chronicle_update on public.chronicle for update to authenticated
  using (public.is_dm(game_id) or author_id = (select auth.uid())) with check (public.is_member(game_id));
drop policy if exists chronicle_delete on public.chronicle;
create policy chronicle_delete on public.chronicle for delete to authenticated
  using (public.is_dm(game_id) or author_id = (select auth.uid()));

drop policy if exists handouts_select on public.handouts;
create policy handouts_select on public.handouts for select to authenticated
  using (public.is_dm(game_id) or (shown_at is not null and public.is_member(game_id)));
drop policy if exists handouts_dm on public.handouts;
create policy handouts_dm on public.handouts for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

drop policy if exists audio_select on public.audio_tracks;
create policy audio_select on public.audio_tracks for select to authenticated using (public.is_member(game_id));
drop policy if exists audio_dm on public.audio_tracks;
create policy audio_dm on public.audio_tracks for all to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));

revoke all on public.dm_notes, public.chronicle, public.scenes, public.bestiary, public.handouts, public.audio_tracks from anon;
grant select, insert, update, delete on public.dm_notes, public.chronicle, public.scenes, public.bestiary, public.handouts, public.audio_tracks to authenticated;

do $$
begin
  execute 'revoke all on function public.purge_messages(uuid,boolean) from public, anon';
  execute 'grant execute on function public.purge_messages(uuid,boolean) to authenticated';
end $$;

do $$
declare t text;
begin
  foreach t in array array['chronicle','handouts','audio_tracks'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- Fine. Se vedi "Success. No rows returned" è tutto a posto.
