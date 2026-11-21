# Architettura tecnica — D&D Virtual Adventure

## 1. Schema generale

```
 Browser (PC / tablet / Android / iPhone)          ── HTTPS ──▶  GitHub Pages
 ┌─────────────────────────────────────────┐                     (solo file statici)
 │ index.html + js/*.js (moduli ES, no build)│
 │  ├─ supabase-js ───────── HTTPS/WebSocket ──────▶  SUPABASE
 │  │    • accesso (ospite anonimo / email)          • Auth (JWT)
 │  │    • database (partite, membri, chat,          • Postgres + Row Level Security
 │  │      canali privati)                           • Realtime (postgres_changes)
 │  │    • funzioni server ─────────────────────▶   • Edge Functions (Deno)
 │  │                                                   livekit-token   ── firma il token con il segreto
 │  │                                                   livekit-moderate ── API admin LiveKit
 │  └─ livekit-client ────── WebRTC (DTLS-SRTP) ───▶  LIVEKIT CLOUD (SFU)
 │       • microfono, videocamera, altoparlante        • smista audio/video
 │       • permessi di ascolto delle mie tracce        • applica i permessi lato server
 └─────────────────────────────────────────┘
```

Nessun server "nostro" da mantenere: GitHub Pages serve i file, Supabase e LiveKit Cloud sono servizi gestiti con piano gratuito.

**Perché senza React/Vite (per ora):** l'app è scritta in JavaScript moderno a moduli, senza passaggio di compilazione. Si pubblica caricando i file su GitHub, come le altre web-app statiche, e non dipende da GitHub Actions. Le librerie (Supabase JS 2.119.2, LiveKit client 2.25.0) sono incluse in `vendor/` già impacchettate: nessun CDN esterno. Se nelle fasi successive la complessità crescerà (mappa con PixiJS, molte schermate) si potrà passare a Vite + TypeScript con una GitHub Action, mantenendo la stessa architettura.

## 2. Identità e accesso

- All'apertura del sito viene creato un **utente ospite anonimo** Supabase (nessuna registrazione). La sessione resta nel browser.
- Facoltativo: **Proteggi con email** trasforma l'ospite in un account permanente; **Ho già un account** permette di entrare con lo stesso profilo da un altro dispositivo (link via email, flusso PKCE).
- Ogni richiesta al database porta il JWT dell'utente; le regole RLS decidono cosa può leggere e scrivere.

## 3. Modello dati (Fase 1)

| Tabella | Contenuto | Chi legge | Chi scrive |
|---|---|---|---|
| `games` | partita, codice invito, DM, stanza chiusa, approvazione, pausa | membri attivi | solo il DM (colonne limitate) |
| `members` | partecipanti, ruolo, stato (attivo / in attesa / allontanato), personaggio | membri attivi (+ la propria riga) | ognuno il proprio nome/personaggio; stato e ruolo solo tramite funzioni del DM |
| `characters` | personaggi (base; scheda completa in Fase 3) | proprietario + compagni di tavolo | solo il proprietario |
| `messages` | chat; `recipients` = destinatari (null = tutti) | **solo mittente e destinatari** | membri attivi; mittente e nome imposti dal server |
| `voice_channels` | canali vocali privati e loro membri | **solo i membri del canale** | solo tramite funzioni (`open_voice_channel`, `leave_voice_channel`) |

Operazioni sensibili come funzioni `SECURITY DEFINER` con controlli: `create_game`, `join_game`, `set_member_status`, `reject_member`, `transfer_dm`, `regenerate_invite`, `leave_game`, `delete_game`, `open_voice_channel`, `leave_voice_channel`.

## 4. Sicurezza

- **Chiavi**: nel sito solo la chiave pubblica Supabase. Il segreto LiveKit vive nei *Secrets* delle Edge Functions.
- **Stanze private**: si entra solo con il codice di invito (8 caratteri, ~10¹² combinazioni). Il DM può chiudere la stanza, attivare la sala d'attesa con approvazione manuale, rigenerare il codice, allontanare o riammettere.
- **Messaggi privati**: la policy RLS su `messages` restituisce una riga solo a mittente e destinatari. Lo stesso vale per gli aggiornamenti in tempo reale (Supabase Realtime applica la RLS): un messaggio privato non arriva proprio al dispositivo degli esclusi, **DM compreso**. Un trigger impone mittente, nome e destinatari validi, impedendo di falsificare l'autore.
- **Audio/video**: per entrare nella stanza LiveKit serve un token firmato dalla funzione `livekit-token`, che lo rilascia solo ai **membri attivi** della partita (controllo sul database). Identità = id utente; ruolo nel token preso dal database, non dal browser.
- **Moderazione**: `livekit-moderate` verifica che chi chiama sia il DM, poi usa l'API amministrativa LiveKit per spegnere un microfono o scollegare un partecipante.

## 5. Voce: generale, PTT, canali privati

- Ogni partecipante pubblica **una** traccia microfono. In PTT la traccia è pubblicata ma *muta*: si attiva solo mentre trasmetti (pulsante, tasto configurabile, o un clic per aprire/chiudere). In modalità *Aperto* resta attiva.
- **Privacy reale dei canali privati**: entrando in un canale privato, il client chiama `setTrackSubscriptionPermissions` di LiveKit: il **server SFU** inoltra il tuo microfono solo ai membri del canale e revoca l'abbonamento a tutti gli altri. Gli esclusi non ricevono i pacchetti audio (non è un volume a zero). La videocamera resta visibile a tutti. Il calcolo dei permessi è in `js/voice-permissions.js` (testato).
- Al cambio di canale il microfono viene chiuso, i permessi aggiornati, e solo dopo ~0,4 s riaperto, per non lasciar uscire sillabe sul canale sbagliato.
- Chi riceve una chiamata privata vi entra automaticamente (se era sul generale), con segnale acustico, bordo rosso, indicatore del canale e pulsante *Torna al generale*. Se era già in un altro canale privato riceve un invito con *Passa*.
- Mentre si è in privato si continua a sentire il canale generale a volume ridotto (disattivabile).
- Indicatore "sta parlando" mostrato solo per chi si sente davvero (non rivela l'attività dei canali privati altrui).

## 6. Tempo reale e riconnessioni

- **Dati** (chat, membri, stato partita, canali): Supabase Realtime `postgres_changes`, filtrati per partita e soggetti a RLS. Alla riconnessione del canale, al ritorno della rete o dell'app in primo piano: ricaricamento dello stato e recupero dei messaggi persi (`id > ultimo ricevuto`).
- **Media**: LiveKit gestisce le microinterruzioni (ICE restart). Se la connessione cade del tutto, il client richiede un nuovo token e si ricollega con attesa crescente (2 s, 4 s, 8 s… max 15 s).
- Ogni 60 s il client aggiorna `last_seen` e verifica di essere ancora membro (partita eliminata o accesso revocato → ritorno alla schermata iniziale).

## 7. Come verranno costruite le fasi successive (anticipazioni tecniche)

- **Mappe e token (Fase 2)**: tabelle `maps`, `tokens`, `fog` con RLS. I token nascosti stanno in una tabella/colonna leggibile solo dal DM: un mostro nascosto non viene mai inviato ai giocatori, quindi non può "apparire per errore". Disegno su Canvas (o PixiJS), immagini mappe su Supabase Storage con accesso riservato ai membri.
- **Dadi (Fase 2)**: lancio eseguito da una funzione del database con generatore casuale crittografico; il risultato viene scritto dal server e il client lo anima soltanto. Tiri segreti visibili solo al DM tramite RLS.
- **Schede e combattimento (Fase 3)**: scheda in `characters.data` (JSON con schema), permessi proprietario/DM; tabella `encounters` con iniziativa, turni e round; il DM può sempre correggere a mano.
- **Campagne (Fase 4)**: scene preparate offline, esportazione/importazione JSON, conservazione messaggi configurabile.

## 7-bis. Fase 2 realizzata

- **Tabelle**: `maps` (griglia, scala, nebbia), `tokens`, `drawings`, `map_signals`, `dice_rolls`; `games.active_map_id` indica la scena visibile ai giocatori.
- **Visibilità (RLS)**: il DM vede tutto; un giocatore vede solo la mappa attiva, i suoi elementi non nascosti e i disegni non riservati. Quando il DM nasconde o elimina un elemento, un trigger scrive un "segnale" che fa sparire l'elemento dagli schermi dei giocatori senza rivelarne la posizione.
- **Movimento**: `move_token` (server) consente al giocatore di muovere solo il proprio token non bloccato, a sessione non in pausa. Durante il trascinamento la posizione provvisoria viaggia su un canale "broadcast" effimero (mai per elementi nascosti); a fine trascinamento viene salvata nel database.
- **Dadi**: `roll_dice` (server) interpreta la formula, genera i numeri con `gen_random_uuid()` (generatore crittografico di PostgreSQL) senza distorsione modulo, salva il tiro; il client riceve il risultato già deciso e lo anima. Limite anti-abuso: 15 tiri ogni 10 secondi per persona.
- **Immagini**: bucket Storage privato `maps`; il DM carica, i giocatori possono leggere solo l'immagine della mappa attiva (URL firmati a tempo).
- **Nebbia**: elenco di operazioni (rivela/copri rettangoli) salvato sulla mappa e ridisegnato su ogni client. È una copertura visiva: l'immagine della mappa arriva comunque intera al browser, quindi i segreti veri vanno messi come elementi nascosti.

## 7-ter. Fase 3 realizzata

- **Schede**: salvate in `characters.data` (JSON). Il proprietario le modifica; il DM può modificare quelle dei personaggi collegati alla sua partita (policy `characters_update_dm`); un trigger impedisce di cambiare il proprietario. Valori derivati (modificatori, competenza, CD) calcolati nel browser; i tiri passano sempre da `roll_dice`.
- **Combattimento**: `encounters` (uno attivo per partita, round, turno corrente), `combatants` (dati pubblici: nome, iniziativa, condizioni, stato di salute, bersaglio), `combatant_stats` (PF, CA, note: **solo DM**). Un trigger calcola lo stato di salute pubblico dai PF segreti. `next_turn` (solo DM) calcola il turno successivo e il round; `set_initiative` e `set_target` permettono ai giocatori di agire solo sul proprio personaggio.
- **Sul tavolo**: anello pulsante sul token di turno e frecce verso i bersagli (frecce verso elementi nella nebbia non mostrate ai giocatori).

## 8. Verifiche eseguite su questa consegna

- Schema SQL eseguito due volte (rieseguibile) su PostgreSQL 16 con un ambiente che simula l'autenticazione Supabase; verificati: visibilità dei messaggi generali, privati, al DM e di gruppo; esterni senza accesso; tentativi di modificare ruolo/stato, falsificare il mittente, inviare messaggi di sistema o a non-membri (tutti respinti); canali vocali invisibili ai non membri; sala d'attesa, allontanamento, trasferimento del ruolo DM.
- Firma dei token LiveKit verificata con l'SDK ufficiale `livekit-server-sdk`.
- Interfaccia caricata in Chrome (PC e formato smartphone) con un finto backend: nessun errore JavaScript, schermate lobby, tavolo, chat, canale privato e pannello DM controllate.
- Fase 2: regole di visibilità di mappe, token, disegni, file e tiri verificate su PostgreSQL (giocatore che muove token altrui, token nascosti, mappe in bozza, file non attivi, tiri segreti, formule non valide, distribuzione dei d20); interfaccia del tavolo provata in Chrome con griglia quadrata ed esagonale, trascinamento con aggancio, righello, dadi.
- Fase 3: permessi su schede e combattimento verificati su PostgreSQL (DM che corregge una scheda senza cambiarne il proprietario, giocatore che non modifica schede altrui, PF dei mostri invisibili ai giocatori, mostri nascosti, iniziativa e bersaglio solo per il proprio personaggio, ordine dei turni e cambio di round); scheda e tracker provati in Chrome con modificatori, competenze, maestria, attacchi e danni calcolati correttamente.
- **Non ancora verificato dal vivo**: collegamento ai servizi reali Supabase/LiveKit, audio tra dispositivi diversi, Safari su iPhone. Per questo la prova del README (sezione 6) va eseguita al primo avvio.
