-- =====================================================================
--  TEST DI SICUREZZA AUTOMATICI — da eseguire SOLO su un database di
--  prova (copia locale o progetto Supabase di test), MAI su quello vero:
--  crea utenti e partite finte.
--
--  Attori:  A = DM   B = giocatore attivo   F = secondo giocatore attivo
--           C = in attesa di approvazione   D = escluso (bannato)
--           E = estraneo con il codice      X = estraneo senza codice
--  Ogni riga stampa: codice test | descrizione | OK / FALLITO
-- =====================================================================
\set ON_ERROR_STOP 1
\pset format unaligned
\pset tuples_only on
\pset fieldsep ' | '

\set A '''a0000000-0000-0000-0000-00000000000a'''
\set B '''b0000000-0000-0000-0000-00000000000b'''
\set C '''c0000000-0000-0000-0000-00000000000c'''
\set D '''d0000000-0000-0000-0000-00000000000d'''
\set E '''e0000000-0000-0000-0000-00000000000e'''
\set F '''f0000000-0000-0000-0000-00000000000f'''
\set X '''90000000-0000-0000-0000-000000000009'''
insert into auth.users values (:A),(:B),(:C),(:D),(:E),(:F),(:X) on conflict do nothing;

-- esegue un comando come l'utente corrente e restituisce 'OK' oppure il messaggio d'errore
create or replace function public.t_try(q text) returns text language plpgsql as $$
begin execute q; return 'OK';
exception when others then return 'ERR: ' || sqlerrm; end $$;
create or replace function public.t_count(q text) returns bigint language plpgsql as $$
declare n bigint; begin execute 'select count(*) from (' || q || ') s' into n; return n;
exception when others then return -1; end $$;
grant execute on function public.t_try(text), public.t_count(text) to authenticated;
create table if not exists public.t_res(n serial, code text, descr text, ok boolean);
grant insert, select on public.t_res to authenticated; grant usage on sequence public.t_res_n_seq to authenticated;
truncate public.t_res;

create or replace function public.t(code text, descr text, ok boolean) returns void language sql as $$
  insert into public.t_res(code, descr, ok) values (code, descr, coalesce(ok, false)) $$;
grant execute on function public.t(text, text, boolean) to authenticated;

set role authenticated;

-- ---------- preparazione: A crea la partita, B e F entrano e vengono approvati
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select (create_game('Prova sicurezza','Primo', null, 20)->>'invite_code') as code \gset
select id as gid from games where name = 'Prova sicurezza' \gset
insert into characters(name, data) values ('Segreto del DM', '{}') returning id as cha \gset

select set_config('request.jwt.claim.sub', :B, false) \g /dev/null
select t('T01', 'Un nuovo giocatore resta IN ATTESA (approvazione obbligatoria)', join_game(:'code', 'Marco')->>'status' = 'pending');
select t('T02', 'In attesa: non vede la partita né i membri', t_count('select * from games') = 0 and t_count('select * from members') = 1);

select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select t('T03', 'Il DM non può spegnere l''approvazione (resta obbligatoria)',
  t_try($$update games set require_approval = false$$) = 'OK' and (select bool_and(require_approval) from games));
select set_member_status(:'gid', :B, 'active') \g /dev/null
select set_config('request.jwt.claim.sub', :F, false) \g /dev/null
select join_game(:'code', 'Luca') \g /dev/null
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select set_member_status(:'gid', :F, 'active') \g /dev/null

-- C in attesa, D escluso
select set_config('request.jwt.claim.sub', :C, false) \g /dev/null
select join_game(:'code', E'Ospite‮\u0007   strano') \g /dev/null
select t('T04', 'Nomi ripuliti da caratteri di controllo e invisibili', (select display_name from members where user_id = :C) = 'Ospite strano');
select set_config('request.jwt.claim.sub', :D, false) \g /dev/null
select join_game(:'code', 'Disturbatore') \g /dev/null
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select set_member_status(:'gid', :D, 'active') \g /dev/null
select set_member_status(:'gid', :D, 'banned') \g /dev/null

-- contenuti di prova
insert into messages(game_id, kind, body) values (:'gid', 'general', 'Benvenuti') \g /dev/null
insert into maps(game_id, name) values (:'gid', 'Mappa') returning id as mid \gset
select set_active_map(:'gid', :'mid') \g /dev/null
insert into tokens(game_id, map_id, kind, name, x, y, hidden) values (:'gid', :'mid', 'monster', 'Mostro nascosto', 10, 10, true) \g /dev/null
insert into tokens(game_id, map_id, kind, name, x, y) values (:'gid', :'mid', 'monster', 'Goblin', 50, 50) returning id as tgob \gset
insert into dm_notes(game_id, title, body) values (:'gid', 'Segreto', 'Il traditore è l''oste') \g /dev/null
insert into scenes(game_id, name) values (:'gid', 'Scena segreta') \g /dev/null
select roll_dice(:'gid', '1d20', 'Tiro segreto del DM', 'generic', '', true) \g /dev/null

select set_config('request.jwt.claim.sub', :B, false) \g /dev/null
insert into messages(game_id, kind, recipients, body) values (:'gid', 'private', array[:F]::uuid[], 'Solo per Luca') \g /dev/null
select open_voice_channel(:'gid', array[:F]::uuid[], 'B e F') as vch \gset

-- ---------- ESTRANEI, IN ATTESA, ESCLUSI
select 'game-' || :'gid' as rt_game \gset
reset role;
insert into realtime.messages(topic, extension, payload) values ('game-' || :'gid', 'broadcast', '{"t":"ping"}');
set role authenticated;
select set_config('request.jwt.claim.sub', :X, false) \g /dev/null
select t('T05', 'Estraneo senza codice: non vede nulla (partite, membri, messaggi, mappe, token)',
  t_count('select * from games') = 0 and t_count('select * from members') = 0 and t_count('select * from messages') = 0
  and t_count('select * from maps') = 0 and t_count('select * from tokens') = 0);

select set_config('request.jwt.claim.sub', :C, false) \g /dev/null
select t('T06', 'In attesa: non legge messaggi, mappe, token, dadi, diario, personaggi altrui',
  t_count('select * from messages') = 0 and t_count('select * from maps') = 0 and t_count('select * from tokens') = 0
  and t_count('select * from dice_rolls') = 0 and t_count('select * from chronicle') = 0
  and t_count($$select * from characters where name = 'Segreto del DM'$$) = 0);
select t('T07', 'In attesa: non può scrivere in chat né tirare dadi',
  t_try(format($$insert into messages(game_id, kind, body) values (%L, 'general', 'ciao')$$, :'gid')) like 'ERR%'
  and t_try(format($$select roll_dice(%L, '1d20')$$, :'gid')) like 'ERR%');
select t('T08', 'In attesa: non può darsi da solo lo stato "attivo" o il ruolo DM',
  t_try($$update members set status = 'active'$$) like 'ERR%' and t_try($$update members set role = 'dm'$$) like 'ERR%');
select set_config('realtime.topic', :'rt_game', false) \g /dev/null
select t('T09', 'In attesa: niente accesso al canale in tempo reale della partita',
  t_count('select * from realtime.messages') = 0
  and t_try(format($$insert into realtime.messages(topic, extension, payload) values (%L, 'broadcast', '{}')$$, :'rt_game')) like 'ERR%');

select set_config('request.jwt.claim.sub', :D, false) \g /dev/null
select t('T10', 'Escluso: non può rientrare con il codice', t_try(format($$select join_game(%L, 'Disturbatore')$$, :'code')) like 'ERR%escluso%');
select t('T11', 'Escluso: non legge più nulla (messaggi, token, membri)',
  t_count('select * from messages') = 0 and t_count('select * from tokens') = 0 and t_count('select * from members') = 1);
select set_config('realtime.topic', :'rt_game', false) \g /dev/null
select t('T12', 'Escluso: niente canale in tempo reale né file dello Storage',
  t_count('select * from realtime.messages') = 0
  and not can_read_map_file(:'gid' || '/qualsiasi.jpg'));

select set_config('request.jwt.claim.sub', :E, false) \g /dev/null
select t('T13', 'Escluso con NUOVA identità: finisce in sala d''attesa, non dentro', join_game(:'code', 'Disturbatore2')->>'status' = 'pending');
select t('T14', 'Tentativi di indovinare il codice: bloccati dopo 8 in 10 minuti', (
  select bool_or(r->>'error' like 'Troppi tentativi%') from (select join_game('ZZZZ' || i, 'X') r from generate_series(1, 9) i) s));

-- limite richieste in attesa (5 per partita)
select set_config('request.jwt.claim.sub', :X, false) \g /dev/null
reset role;
insert into auth.users select ('70000000-0000-0000-0000-00000000000' || i)::uuid from generate_series(1, 5) i on conflict do nothing;
set role authenticated;
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000001', false) \g /dev/null
select join_game(:'code', 'Spam1') \g /dev/null
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000002', false) \g /dev/null
select join_game(:'code', 'Spam2') \g /dev/null
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000003', false) \g /dev/null
select join_game(:'code', 'Spam3') \g /dev/null
select set_config('request.jwt.claim.sub', '70000000-0000-0000-0000-000000000004', false) \g /dev/null
select t('T15', 'Al massimo 5 richieste in attesa per partita (anti-spam)', t_try(format($$select join_game(%L, 'Spam4')$$, :'code')) like 'ERR%troppe richieste%');

-- ---------- GIOCATORE ATTIVO (F) che prova a vedere ciò che non deve
select set_config('request.jwt.claim.sub', :F, false) \g /dev/null
select t('T16', 'Giocatore: non vede note, scene e bestiario del DM', t_count('select * from dm_notes') = 0 and t_count('select * from scenes') = 0 and t_count('select * from bestiary') = 0);
select t('T17', 'Giocatore: non vede i token nascosti né i tiri segreti del DM',
  t_count($$select * from tokens where name = 'Mostro nascosto'$$) = 0 and t_count('select * from dice_rolls where secret') = 0);
select t('T18', 'Giocatore: non può creare, spostare o cancellare mostri',
  t_try(format($$insert into tokens(game_id, map_id, kind, name, x, y) values (%L, %L, 'monster', 'x', 1, 1)$$, :'gid', :'mid')) like 'ERR%'
  and t_try(format($$select move_token(%L, 100, 100)$$, :'tgob')) like 'ERR%'
  and t_count(format($$select * from tokens where id = %L and x = 50$$, :'tgob')) = 1);
select set_config('realtime.topic', :'rt_game', false) \g /dev/null
select t('T19', 'Giocatore: entra nel canale in tempo reale della SUA partita',
  t_count('select * from realtime.messages') > 0 and t_try(format($$insert into realtime.messages(topic, extension, payload) values (%L, 'broadcast', '{}')$$, :'rt_game')) = 'OK');
select set_config('realtime.topic', 'game-00000000-0000-0000-0000-000000000000', false) \g /dev/null
select t('T20', 'Canale in tempo reale di un''altra partita: negato',
  t_count('select * from realtime.messages') = 0 and t_try($$insert into realtime.messages(topic, extension, payload) values ('game-00000000-0000-0000-0000-000000000000', 'broadcast', '{}')$$) like 'ERR%');

-- messaggi privati: B → F; il terzo (A, il DM) non lo legge
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select t('T21', 'Messaggio privato B→F: NON leggibile da terzi (nemmeno dal DM)', t_count($$select * from messages where body = 'Solo per Luca'$$) = 0);
select t('T22', 'Canale vocale privato B+F: invisibile a chi non ne fa parte', t_count('select * from voice_channels') = 0);
select set_config('request.jwt.claim.sub', :F, false) \g /dev/null
select t('T23', 'Il destinatario legge il messaggio privato', t_count($$select * from messages where body = 'Solo per Luca'$$) = 1);

-- il DM spegne le comunicazioni private tra giocatori
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
update games set settings = settings || '{"private_players": false}' where id = :'gid';
select set_config('request.jwt.claim.sub', :B, false) \g /dev/null
select t('T24', 'Privati tra giocatori disattivati: B→F rifiutato, B→DM permesso',
  t_try(format($$insert into messages(game_id, kind, recipients, body) values (%L, 'private', array[%L]::uuid[], 'psst')$$, :'gid', :F)) like 'ERR%'
  and t_try(format($$insert into messages(game_id, kind, body) values (%L, 'dm', 'al DM')$$, :'gid')) = 'OK');
select t('T25', 'Privati disattivati: i canali tra soli giocatori si chiudono; nuovi senza DM rifiutati, con il DM permessi',
  t_count('select * from voice_channels where active') = 0 and
  t_try(format($$select open_voice_channel(%L, array[%L]::uuid[], 'x')$$, :'gid', :F)) like 'ERR%'
  and t_try(format($$select open_voice_channel(%L, array[%L]::uuid[], 'x')$$, :'gid', :A)) = 'OK');

-- limiti di frequenza in chat
select set_config('request.jwt.claim.sub', :F, false) \g /dev/null
select t('T26', 'Chat: oltre 20 messaggi in 30 secondi vengono bloccati', (
  select count(*) filter (where r like 'ERR%Troppe%') > 0 from (
    select t_try(format($$insert into messages(game_id, kind, body) values (%L, 'general', 'spam')$$, :'gid')) r from generate_series(1, 25)) s));

-- immagini esterne vietate (non rivelano l'IP dei ragazzi a siti terzi)
select set_config('request.jwt.claim.sub', :A, false) \g /dev/null
select t('T27', 'Immagine da indirizzo esterno rifiutata, immagine interna accettata',
  t_try(format($$insert into tokens(game_id, map_id, kind, name, x, y, image) values (%L, %L, 'npc', 'x', 1, 1, 'https://esempio.com/spia.png')$$, :'gid', :'mid')) like 'ERR%'
  and t_try(format($$insert into tokens(game_id, map_id, kind, name, x, y, image) values (%L, %L, 'npc', 'x', 1, 1, 'img/monsters/goblin.svg')$$, :'gid', :'mid')) = 'OK');
select set_config('request.jwt.claim.sub', :B, false) \g /dev/null
select t('T28', 'Un giocatore non può rinominare la partita né diventarne DM',
  t_try(format($$update games set dm_id = %L where id = %L$$, :B, :'gid')) like 'ERR%'
  and t_try(format($$update games set name = 'Hackerata' where id = %L$$, :'gid')) = 'OK'
  and t_count($$select * from games where name = 'Hackerata'$$) = 0);
select t_try($$update characters set name = 'Rubato' where name = 'Segreto del DM'$$) \g /dev/null
reset role;
select t('T29', 'Un giocatore non può modificare la scheda di un altro', exists (select 1 from characters where name = 'Segreto del DM'));
set role authenticated;

reset role;
\echo
\echo ===== RISULTATI =====
select code, descr, case when ok then 'OK' else 'FALLITO' end from public.t_res order by n;
select 'Totale: ' || count(*) filter (where ok) || ' OK su ' || count(*) from public.t_res;
