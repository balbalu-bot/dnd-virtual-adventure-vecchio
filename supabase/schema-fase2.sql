-- =====================================================================
--  D&D VIRTUAL ADVENTURE — Database FASE 2 (tavolo virtuale e dadi)
--  Da eseguire DOPO schema.sql. Incolla tutto nel SQL Editor e premi RUN.
--  Si può rieseguire senza perdere dati.
-- =====================================================================

-- ---------------------------------------------------------------------
-- TABELLE
-- ---------------------------------------------------------------------

alter table public.games add column if not exists active_map_id uuid;

create table if not exists public.maps (
  id            uuid primary key default gen_random_uuid(),
  game_id       uuid not null references public.games(id) on delete cascade,
  name          text not null check (char_length(name) between 1 and 80),
  image_path    text,                                  -- file nello Storage (bucket "maps")
  width         int  not null default 2100 check (width between 100 and 12000),
  height        int  not null default 1400 check (height between 100 and 12000),
  bg_color      text not null default '#d9c497' check (char_length(bg_color) <= 20),
  grid_type     text not null default 'square' check (grid_type in ('square','hex','none')),
  grid_size     numeric not null default 70 check (grid_size between 10 and 600),
  grid_offset_x numeric not null default 0,
  grid_offset_y numeric not null default 0,
  grid_color    text not null default '#2a1c0f' check (char_length(grid_color) <= 20),
  grid_opacity  numeric not null default 0.35 check (grid_opacity between 0 and 1),
  feet_per_cell numeric not null default 5 check (feet_per_cell > 0 and feet_per_cell <= 1000),
  diagonal_rule text not null default '5e' check (diagonal_rule in ('5e','5-10-5','euclid')),
  fog_enabled   boolean not null default false,
  fog           jsonb not null default '[]'::jsonb,   -- elenco di aree rivelate/coperte
  sort          int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists maps_game_idx on public.maps(game_id);

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'games_active_map_fk') then
    alter table public.games add constraint games_active_map_fk
      foreign key (active_map_id) references public.maps(id) on delete set null;
  end if;
end $$;

create table if not exists public.tokens (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  map_id     uuid not null references public.maps(id) on delete cascade,
  kind       text not null default 'monster'
             check (kind in ('pc','npc','monster','object','door','trap','treasure','note')),
  name       text not null default '' check (char_length(name) <= 60),
  x          numeric not null default 0,
  y          numeric not null default 0,
  size       numeric not null default 1 check (size between 0.25 and 10),
  rotation   numeric not null default 0,
  color      text not null default '#b3261e' check (char_length(color) <= 20),
  image      text check (image is null or char_length(image) <= 120000),
  owner_id   uuid references auth.users(id) on delete set null,
  hidden     boolean not null default false,
  locked     boolean not null default false,
  state      jsonb not null default '{}'::jsonb,       -- porta aperta, trappola scattata, testo nota…
  z          int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists tokens_map_idx on public.tokens(map_id);
create index if not exists tokens_game_idx on public.tokens(game_id);

create table if not exists public.drawings (
  id         uuid primary key default gen_random_uuid(),
  game_id    uuid not null references public.games(id) on delete cascade,
  map_id     uuid not null references public.maps(id) on delete cascade,
  author_id  uuid default auth.uid() references auth.users(id) on delete set null,
  kind       text not null check (kind in ('path','line','rect','circle','text')),
  points     jsonb not null default '[]'::jsonb,
  color      text not null default '#b3261e' check (char_length(color) <= 20),
  width      numeric not null default 4 check (width between 0.5 and 60),
  text       text check (text is null or char_length(text) <= 500),
  dm_only    boolean not null default false,
  created_at timestamptz not null default now(),
  check (jsonb_array_length(points) <= 4000)
);
create index if not exists drawings_map_idx on public.drawings(map_id);

-- Segnali per far sparire dagli schermi dei giocatori ciò che il DM nasconde o elimina
create table if not exists public.map_signals (
  id         bigint generated always as identity primary key,
  game_id    uuid not null references public.games(id) on delete cascade,
  map_id     uuid,
  kind       text not null check (kind in ('token_gone','drawing_gone')),
  ref_id     uuid not null,
  created_at timestamptz not null default now()
);
create index if not exists map_signals_game_idx on public.map_signals(game_id, id);

create table if not exists public.dice_rolls (
  id          bigint generated always as identity primary key,
  game_id     uuid not null references public.games(id) on delete cascade,
  roller_id   uuid references auth.users(id) on delete set null,
  roller_name text not null default '',
  label       text not null default '' check (char_length(label) <= 80),
  roll_type   text not null default 'generic'
              check (roll_type in ('generic','attack','damage','save','check','initiative')),
  expr        text not null,
  adv         text not null default '' check (adv in ('','adv','dis')),
  detail      jsonb not null,
  modifier    int not null default 0,
  total       int not null,
  secret      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists dice_game_idx on public.dice_rolls(game_id, id desc);

drop trigger if exists maps_touch on public.maps;
create trigger maps_touch before update on public.maps for each row execute function public.touch_updated_at();
drop trigger if exists tokens_touch on public.tokens;
create trigger tokens_touch before update on public.tokens for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- FUNZIONI DI SUPPORTO
-- ---------------------------------------------------------------------

-- Una mappa è visibile al DM sempre, ai giocatori solo se è la scena attiva
create or replace function public.can_see_map(p_map uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.maps m join public.games g on g.id = m.game_id
    where m.id = p_map and (
      g.dm_id = (select auth.uid())
      or (g.active_map_id = m.id and public.is_member(m.game_id))
    )
  );
$$;

-- Numero casuale crittograficamente sicuro tra 1 e n (senza distorsioni)
create or replace function public.rand_int(n int)
returns int language plpgsql volatile set search_path = '' as $$
declare
  b bytea; v bigint; lim bigint;
begin
  if n < 1 then raise exception 'Dado non valido'; end if;
  lim := (4294967296 / n) * n;
  loop
    b := uuid_send(gen_random_uuid());
    v := (get_byte(b,0)::bigint << 24) | (get_byte(b,1)::bigint << 16) | (get_byte(b,2)::bigint << 8) | get_byte(b,3)::bigint;
    exit when v < lim;
  end loop;
  return (v % n)::int + 1;
end $$;

-- Cartella del file nello Storage = id della partita
create or replace function public.path_game(p_name text)
returns uuid language plpgsql immutable set search_path = '' as $$
begin
  return split_part(p_name, '/', 1)::uuid;
exception when others then
  return null;
end $$;

create or replace function public.can_read_map_file(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_dm(public.path_game(p_name)) or exists (
    select 1 from public.maps m join public.games g on g.active_map_id = m.id
    where m.image_path = p_name and public.is_member(m.game_id)
  );
$$;

-- ---------------------------------------------------------------------
-- VALIDAZIONI E SEGNALI
-- ---------------------------------------------------------------------

create or replace function public.tokens_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
declare m public.maps;
begin
  select * into m from public.maps where id = new.map_id;
  if m.id is null or m.game_id <> new.game_id then raise exception 'Mappa non valida'; end if;
  new.x := greatest(0, least(m.width, new.x));
  new.y := greatest(0, least(m.height, new.y));
  return new;
end $$;
drop trigger if exists tokens_validate on public.tokens;
create trigger tokens_validate before insert or update on public.tokens
  for each row execute function public.tokens_validate();

create or replace function public.drawings_validate()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.maps where id = new.map_id and game_id = new.game_id) then
    raise exception 'Mappa non valida';
  end if;
  new.author_id := coalesce(auth.uid(), new.author_id);
  new.created_at := now();
  return new;
end $$;
drop trigger if exists drawings_validate on public.drawings;
create trigger drawings_validate before insert on public.drawings
  for each row execute function public.drawings_validate();

create or replace function public.tokens_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    insert into public.map_signals(game_id, map_id, kind, ref_id) values (old.game_id, old.map_id, 'token_gone', old.id);
    return old;
  end if;
  if (new.hidden and not old.hidden) or new.map_id <> old.map_id then
    insert into public.map_signals(game_id, map_id, kind, ref_id) values (old.game_id, old.map_id, 'token_gone', old.id);
  end if;
  return new;
end $$;
drop trigger if exists tokens_signal on public.tokens;
create trigger tokens_signal after update or delete on public.tokens
  for each row execute function public.tokens_signal();

create or replace function public.drawings_signal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.map_signals(game_id, map_id, kind, ref_id) values (old.game_id, old.map_id, 'drawing_gone', old.id);
  -- pulizia: i segnali servono solo pochi secondi
  delete from public.map_signals where game_id = old.game_id and created_at < now() - interval '1 day';
  return old;
end $$;
drop trigger if exists drawings_signal on public.drawings;
create trigger drawings_signal after delete on public.drawings
  for each row execute function public.drawings_signal();

-- ---------------------------------------------------------------------
-- RPC
-- ---------------------------------------------------------------------

-- Il DM sceglie quale mappa vedono i giocatori
create or replace function public.set_active_map(p_game uuid, p_map uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  if p_map is not null and not exists (select 1 from public.maps where id = p_map and game_id = p_game) then
    raise exception 'Mappa non valida';
  end if;
  update public.games set active_map_id = p_map where id = p_game;
end $$;

-- Un giocatore muove il SUO token; il DM muove tutto
create or replace function public.move_token(p_token uuid, p_x numeric, p_y numeric)
returns void language plpgsql security definer set search_path = '' as $$
declare t public.tokens;
begin
  select * into t from public.tokens where id = p_token;
  if t.id is null then raise exception 'Elemento non trovato'; end if;
  if not public.is_dm(t.game_id) then
    if t.owner_id is distinct from auth.uid() then raise exception 'Puoi muovere solo il tuo personaggio'; end if;
    if t.locked then raise exception 'Il DM ha bloccato questo token'; end if;
    if t.hidden or not public.can_see_map(t.map_id) then raise exception 'Elemento non disponibile'; end if;
    if exists (select 1 from public.games where id = t.game_id and paused) then
      raise exception 'La sessione è in pausa';
    end if;
  end if;
  update public.tokens set x = p_x, y = p_y where id = p_token;
end $$;

-- Messaggio di sistema del DM (porte, trappole, eventi)
create or replace function public.announce(p_game uuid, p_text text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_dm(p_game) then raise exception 'Solo il Dungeon Master può farlo'; end if;
  insert into public.messages(game_id, sender_name, kind, body, meta)
  values (p_game, 'Sistema', 'system', left(p_text, 500), '{"event":"announce"}'::jsonb);
end $$;

-- DADI: generati dal server, il giocatore non può modificarli
--   p_expr: "1d20+5", "2d6+1d4-1", "d100" … (massimo 50 dadi, facce 2/3/4/6/8/10/12/20/100)
--   p_adv : '' | 'adv' | 'dis'  (solo per un singolo d20)
--   p_secret: visibile solo a chi tira e al DM
create or replace function public.roll_dice(
  p_game uuid, p_expr text, p_label text default '', p_type text default 'generic',
  p_adv text default '', p_secret boolean default false)
returns json language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := auth.uid();
  e text := lower(regexp_replace(coalesce(p_expr,''), '\s', '', 'g'));
  m text[];
  sign int; cnt int; sides int; k int;
  detail jsonb := '[]'::jsonb;
  rolls int[]; kept int; a int; b int;
  total int := 0; modv int := 0; ndice int := 0; nd20 int := 0;
  rname text; r public.dice_rolls;
  adv text := coalesce(p_adv, '');
begin
  if uid is null or not public.is_member(p_game) then raise exception 'Non fai parte di questa partita'; end if;
  if e = '' or char_length(e) > 60 or e !~ '^[+-]?(\d*d\d+|\d+)([+-](\d*d\d+|\d+))*$' then
    raise exception 'Formula non valida. Esempi: 1d20+5, 2d6+3, d100';
  end if;
  if p_type not in ('generic','attack','damage','save','check','initiative') then p_type := 'generic'; end if;
  if adv not in ('','adv','dis') then adv := ''; end if;
  if (select count(*) from public.dice_rolls where roller_id = uid and created_at > now() - interval '10 seconds') > 15 then
    raise exception 'Troppi tiri: aspetta un momento';
  end if;

  -- prima passata: conta i dadi
  for m in select regexp_matches(e, '([+-]?)(\d*)d(\d+)', 'g') loop
    ndice := ndice + coalesce(nullif(m[2],'')::int, 1);
    if m[3]::int = 20 then nd20 := nd20 + coalesce(nullif(m[2],'')::int, 1); end if;
  end loop;
  if ndice < 1 then raise exception 'Serve almeno un dado'; end if;
  if ndice > 50 then raise exception 'Massimo 50 dadi per tiro'; end if;
  if adv <> '' and not (ndice = 1 and nd20 = 1) then adv := ''; end if;

  for m in select regexp_matches(e, '([+-]?)(\d*d\d+|\d+)', 'g') loop
    sign := case when m[1] = '-' then -1 else 1 end;
    if position('d' in m[2]) > 0 then
      cnt := coalesce(nullif(split_part(m[2], 'd', 1), '')::int, 1);
      sides := split_part(m[2], 'd', 2)::int;
      if sides not in (2,3,4,6,8,10,12,20,100) then raise exception 'Dado d% non supportato', sides; end if;
      if cnt < 1 then raise exception 'Numero di dadi non valido'; end if;
      if adv <> '' and sides = 20 then
        a := public.rand_int(20); b := public.rand_int(20);
        kept := case when adv = 'adv' then greatest(a,b) else least(a,b) end;
        detail := detail || jsonb_build_object('die', 20, 'sign', sign, 'rolls', jsonb_build_array(a,b), 'kept', jsonb_build_array(kept));
        total := total + sign * kept;
      else
        rolls := '{}';
        for k in 1..cnt loop rolls := rolls || public.rand_int(sides); end loop;
        detail := detail || jsonb_build_object('die', sides, 'sign', sign, 'rolls', to_jsonb(rolls), 'kept', to_jsonb(rolls));
        total := total + sign * (select coalesce(sum(x),0) from unnest(rolls) x)::int;
      end if;
    else
      if m[2]::int > 1000 then raise exception 'Modificatore troppo grande'; end if;
      modv := modv + sign * m[2]::int;
    end if;
  end loop;
  total := total + modv;

  select display_name into rname from public.members where game_id = p_game and user_id = uid;
  insert into public.dice_rolls(game_id, roller_id, roller_name, label, roll_type, expr, adv, detail, modifier, total, secret)
  values (p_game, uid, coalesce(rname,'?'), left(coalesce(p_label,''), 80), p_type, e, adv, detail, modv, total, coalesce(p_secret,false))
  returning * into r;
  return row_to_json(r);
end $$;

-- ---------------------------------------------------------------------
-- SICUREZZA (RLS)
-- ---------------------------------------------------------------------

alter table public.maps        enable row level security;
alter table public.tokens      enable row level security;
alter table public.drawings    enable row level security;
alter table public.map_signals enable row level security;
alter table public.dice_rolls  enable row level security;

drop policy if exists maps_select on public.maps;
create policy maps_select on public.maps for select to authenticated
  using (public.is_dm(game_id) or public.can_see_map(id));
drop policy if exists maps_insert on public.maps;
create policy maps_insert on public.maps for insert to authenticated with check (public.is_dm(game_id));
drop policy if exists maps_update on public.maps;
create policy maps_update on public.maps for update to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));
drop policy if exists maps_delete on public.maps;
create policy maps_delete on public.maps for delete to authenticated using (public.is_dm(game_id));

-- Un token nascosto NON viene mai inviato ai giocatori (nemmeno quando il DM lo sposta)
drop policy if exists tokens_select on public.tokens;
create policy tokens_select on public.tokens for select to authenticated
  using (public.is_dm(game_id) or (not hidden and public.can_see_map(map_id)));
drop policy if exists tokens_insert on public.tokens;
create policy tokens_insert on public.tokens for insert to authenticated with check (public.is_dm(game_id));
drop policy if exists tokens_update on public.tokens;
create policy tokens_update on public.tokens for update to authenticated using (public.is_dm(game_id)) with check (public.is_dm(game_id));
drop policy if exists tokens_delete on public.tokens;
create policy tokens_delete on public.tokens for delete to authenticated using (public.is_dm(game_id));

drop policy if exists drawings_select on public.drawings;
create policy drawings_select on public.drawings for select to authenticated
  using (public.is_dm(game_id) or (not dm_only and public.can_see_map(map_id)));
drop policy if exists drawings_insert on public.drawings;
create policy drawings_insert on public.drawings for insert to authenticated
  with check (public.can_see_map(map_id) and (not dm_only or public.is_dm(game_id)));
drop policy if exists drawings_delete on public.drawings;
create policy drawings_delete on public.drawings for delete to authenticated
  using (public.is_dm(game_id) or author_id = (select auth.uid()));

drop policy if exists signals_select on public.map_signals;
create policy signals_select on public.map_signals for select to authenticated using (public.is_member(game_id));

drop policy if exists dice_select on public.dice_rolls;
create policy dice_select on public.dice_rolls for select to authenticated
  using (public.is_member(game_id) and (not secret or roller_id = (select auth.uid()) or public.is_dm(game_id)));

revoke all on public.maps, public.tokens, public.drawings, public.map_signals, public.dice_rolls from anon;
grant select, insert, update, delete on public.maps, public.tokens to authenticated;
grant select, insert, delete on public.drawings to authenticated;
revoke update on public.drawings from authenticated;
grant select on public.map_signals, public.dice_rolls to authenticated;
revoke insert, update, delete on public.map_signals, public.dice_rolls from authenticated;

do $$
declare f text;
begin
  foreach f in array array[
    'can_see_map(uuid)','can_read_map_file(text)','path_game(text)',
    'set_active_map(uuid,uuid)','move_token(uuid,numeric,numeric)','announce(uuid,text)',
    'roll_dice(uuid,text,text,text,text,boolean)']
  loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
  execute 'revoke all on function public.rand_int(int) from public, anon, authenticated';
end $$;

-- ---------------------------------------------------------------------
-- TEMPO REALE
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['maps','tokens','drawings','map_signals','dice_rolls'] loop
    if not exists (select 1 from pg_publication_tables
                   where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- STORAGE: cartella privata per le immagini delle mappe
--   - il DM carica e cancella
--   - i giocatori vedono SOLO l'immagine della mappa attiva
-- ---------------------------------------------------------------------
do $$
begin
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('maps', 'maps', false, 15728640, array['image/jpeg','image/png','image/webp'])
  on conflict (id) do nothing;

  drop policy if exists "dndva maps read" on storage.objects;
  create policy "dndva maps read" on storage.objects for select to authenticated
    using (bucket_id = 'maps' and public.can_read_map_file(name));
  drop policy if exists "dndva maps insert" on storage.objects;
  create policy "dndva maps insert" on storage.objects for insert to authenticated
    with check (bucket_id = 'maps' and public.is_dm(public.path_game(name)));
  drop policy if exists "dndva maps update" on storage.objects;
  create policy "dndva maps update" on storage.objects for update to authenticated
    using (bucket_id = 'maps' and public.is_dm(public.path_game(name)));
  drop policy if exists "dndva maps delete" on storage.objects;
  create policy "dndva maps delete" on storage.objects for delete to authenticated
    using (bucket_id = 'maps' and public.is_dm(public.path_game(name)));
exception when others then
  raise notice 'ATTENZIONE: configurazione Storage non riuscita (%). Le mappe senza immagine funzionano comunque.', sqlerrm;
end $$;

-- Fine. Se vedi "Success. No rows returned" è tutto a posto.
