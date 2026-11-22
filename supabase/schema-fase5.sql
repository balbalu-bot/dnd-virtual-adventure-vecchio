-- =====================================================================
--  D&D Virtual Adventure — Aggiornamento "movimento"
--  Ostacoli sulla mappa, movimento limitato dei personaggi, solo il DM
--  muove mostri e PNG.
--  Da eseguire DOPO schema.sql, schema-fase2.sql, schema-fase3.sql,
--  schema-fase4.sql. Si può rieseguire senza problemi.
-- =====================================================================

-- Caselle non calpestabili (muri, colonne, acqua profonda…): elenco "c,r"
alter table public.maps add column if not exists blocked jsonb not null default '[]'::jsonb;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'maps_blocked_array') then
    alter table public.maps add constraint maps_blocked_array
      check (jsonb_typeof(blocked) = 'array' and jsonb_array_length(blocked) <= 40000);
  end if;
end $$;

-- Velocità del token (in piedi; vuoto = dalla scheda del personaggio, altrimenti 30)
alter table public.tokens add column if not exists speed int;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'tokens_speed_range') then
    alter table public.tokens add constraint tokens_speed_range check (speed is null or speed between 0 and 300);
  end if;
end $$;
-- Movimento già usato nel turno (o nella finestra di 6 secondi fuori dal combattimento)
alter table public.tokens add column if not exists move_used numeric not null default 0;
alter table public.tokens add column if not exists move_window timestamptz;

-- "9 m", "9", "30 ft", "30 piedi" → piedi
create or replace function public.speed_feet(p text)
returns int language plpgsql immutable set search_path = '' as $$
declare m text[]; v numeric;
begin
  m := regexp_match(lower(coalesce(p, '')), '([0-9]+(?:[.,][0-9]+)?)\s*(ft|piedi|m)?');
  if m is null then return 30; end if;
  v := replace(m[1], ',', '.')::numeric;
  if m[2] in ('ft', 'piedi') then return round(v)::int; end if;
  if m[2] = 'm' or v <= 20 then return round(v / 0.3)::int; end if;
  return round(v)::int;
end $$;

create or replace function public.token_speed(t public.tokens)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(
    t.speed,
    (select public.speed_feet(c.data->>'speed')
       from public.members mb join public.characters c on c.id = mb.character_id
      where mb.game_id = t.game_id and mb.user_id = t.owner_id and t.kind = 'pc'
      limit 1),
    30);
$$;

-- Casella che contiene un punto: quadrata (colonna,riga) o esagonale (q,r)
create or replace function public.cell_of(m public.maps, x numeric, y numeric)
returns int[] language plpgsql immutable set search_path = '' as $$
declare
  s float8 := m.grid_size; px float8 := x - m.grid_offset_x; py float8 := y - m.grid_offset_y;
  rr float8; q float8; r float8; cz float8; rq float8; rv float8; rz float8;
begin
  if m.grid_type = 'hex' then
    rr := s / sqrt(3);
    q := (sqrt(3) / 3 * px - py / 3) / rr;
    r := (2.0 / 3 * py) / rr;
    cz := -q - r;
    rq := round(q); rv := round(r); rz := round(cz);
    if abs(rq - q) > abs(rv - r) and abs(rq - q) > abs(rz - cz) then rq := -rv - rz;
    elsif abs(rv - r) > abs(rz - cz) then rv := -rq - rz; end if;
    return array[rq::int, rv::int];
  end if;
  -- piccola tolleranza: i token grandi (2×2) hanno il centro sull'incrocio delle linee
  return array[floor(px / s + 1e-6)::int, floor(py / s + 1e-6)::int];
end $$;

-- Movimento di un token.
--   DM: muove tutto liberamente.
--   Giocatore: solo il proprio personaggio (tipo "pc"), seguendo un percorso di
--   caselle adiacenti (p_path = [[c,r],[c,r],…]) che non attraversa ostacoli e
--   che non supera la sua velocità:
--     · in combattimento: solo nel proprio turno, velocità per turno;
--     · fuori combattimento: velocità ogni 6 secondi (un round di D&D).
drop function if exists public.move_token(uuid, numeric, numeric);
create or replace function public.move_token(p_token uuid, p_x numeric, p_y numeric, p_path jsonb default null)
returns json language plpgsql security definer set search_path = '' as $$
declare
  t public.tokens; m public.maps; e public.encounters; cb_id uuid;
  speed int; used numeric; win timestamptz; budget numeric; cost numeric := 0;
  a int[]; b int[]; prev int[]; cur int[]; i int; n int; dc int; dr int; diags int := 0;
  blocked jsonb; in_combat boolean := false;
begin
  select * into t from public.tokens where id = p_token;
  if t.id is null then raise exception 'Elemento non trovato'; end if;
  select * into m from public.maps where id = t.map_id;
  if p_x < 0 or p_y < 0 or p_x > m.width or p_y > m.height then raise exception 'Fuori dalla mappa'; end if;

  if public.is_dm(t.game_id) then
    update public.tokens set x = p_x, y = p_y where id = p_token;
    return json_build_object('ok', true);
  end if;

  if t.kind <> 'pc' or t.owner_id is distinct from auth.uid() then
    raise exception 'Puoi muovere solo il tuo personaggio: mostri ed elementi li muove il DM';
  end if;
  if t.locked then raise exception 'Il DM ha bloccato il tuo personaggio'; end if;
  if t.hidden or not public.can_see_map(t.map_id) then raise exception 'Elemento non disponibile'; end if;
  if exists (select 1 from public.games where id = t.game_id and paused) then
    raise exception 'La sessione è in pausa';
  end if;

  speed := public.token_speed(t);
  used := t.move_used; win := t.move_window;

  -- in combattimento?
  select * into e from public.encounters where game_id = t.game_id and active;
  if e.id is not null then
    select id into cb_id from public.combatants where encounter_id = e.id and token_id = t.id limit 1;
    if cb_id is not null then
      in_combat := true;
      if e.current_id is distinct from cb_id then raise exception 'Aspetta il tuo turno per muoverti'; end if;
    end if;
  end if;
  if not in_combat and (win is null or now() - win > interval '6 seconds') then
    used := 0; win := now();
  end if;
  budget := speed - used;

  if m.grid_type = 'none' then
    cost := sqrt(power(p_x - t.x, 2) + power(p_y - t.y, 2)) / m.grid_size * m.feet_per_cell;
  else
    a := public.cell_of(m, t.x, t.y);
    b := public.cell_of(m, p_x, p_y);
    if a = b then
      cost := 0;
    else
      if p_path is null or jsonb_typeof(p_path) <> 'array' then raise exception 'Percorso mancante: aggiorna la pagina'; end if;
      n := jsonb_array_length(p_path);
      if n < 2 or n > 200 then raise exception 'Percorso non valido'; end if;
      blocked := coalesce(m.blocked, '[]'::jsonb);
      prev := array[(p_path->0->>0)::int, (p_path->0->>1)::int];
      if prev <> a then raise exception 'Il percorso non parte dal tuo personaggio'; end if;
      for i in 1 .. n - 1 loop
        cur := array[(p_path->i->>0)::int, (p_path->i->>1)::int];
        dc := cur[1] - prev[1]; dr := cur[2] - prev[2];
        if blocked ? (cur[1] || ',' || cur[2]) then raise exception 'Non puoi passare di lì: c''è un ostacolo'; end if;
        if m.grid_type = 'hex' then
          if not ((dc, dr) in ((1,0),(-1,0),(0,1),(0,-1),(1,-1),(-1,1))) then raise exception 'Percorso non valido'; end if;
          cost := cost + 1;
        else
          if abs(dc) > 1 or abs(dr) > 1 or (dc = 0 and dr = 0) then raise exception 'Percorso non valido'; end if;
          if dc <> 0 and dr <> 0 then
            -- niente scorciatoie in diagonale tra due ostacoli
            if blocked ? ((prev[1] + dc) || ',' || prev[2]) and blocked ? (prev[1] || ',' || (prev[2] + dr)) then
              raise exception 'Non puoi passare di lì: c''è un ostacolo';
            end if;
            diags := diags + 1;
            if m.diagonal_rule = '5-10-5' then cost := cost + case when diags % 2 = 0 then 2 else 1 end;
            elsif m.diagonal_rule = 'euclid' then cost := cost + 1.5;
            else cost := cost + 1; end if;
          else
            cost := cost + 1;
          end if;
        end if;
        prev := cur;
      end loop;
      if prev <> b then raise exception 'Il percorso non arriva alla casella scelta'; end if;
      cost := cost * m.feet_per_cell;
    end if;
  end if;

  if cost > budget + 0.01 then
    raise exception 'Troppo lontano: puoi muoverti ancora di % m (% caselle)',
      replace(round(greatest(budget, 0) * 0.3, 1)::text, '.', ','), floor(greatest(budget, 0) / m.feet_per_cell);
  end if;
  update public.tokens set x = p_x, y = p_y, move_used = used + cost, move_window = win where id = p_token;
  return json_build_object('ok', true, 'left', budget - cost, 'speed', speed);
end $$;

-- Nuovo turno: il personaggio di turno recupera tutto il movimento.
-- Fine combattimento: tutti tornano al movimento libero (6 secondi).
create or replace function public.encounter_move_reset()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active and new.current_id is distinct from old.current_id and new.current_id is not null then
    update public.tokens set move_used = 0, move_window = null
     where id = (select token_id from public.combatants where id = new.current_id);
  end if;
  if old.active and not new.active then
    update public.tokens set move_used = 0, move_window = null
     where id in (select token_id from public.combatants where encounter_id = new.id and token_id is not null);
  end if;
  return new;
end $$;
drop trigger if exists encounters_move_reset on public.encounters;
create trigger encounters_move_reset after update on public.encounters
  for each row execute function public.encounter_move_reset();

grant execute on function public.move_token(uuid, numeric, numeric, jsonb) to authenticated;
grant execute on function public.token_speed(public.tokens) to authenticated;
revoke execute on function public.encounter_move_reset() from public, anon, authenticated;

-- Chiede a PostgREST di rileggere lo schema (nuove colonne e funzioni)
notify pgrst, 'reload schema';
