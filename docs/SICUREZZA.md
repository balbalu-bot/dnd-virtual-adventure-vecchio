# D&D Virtual Adventure — Audit di sicurezza e correzioni

Data: 22 novembre 2026. Obiettivo: **gruppo privato di amici (anche minorenni), nessun contatto con estranei**.
Il gioco va usato **con la presenza di un adulto** quando giocano minorenni.

Legenda verifica: ✅ = verificato con test automatici (PostgreSQL 16 locale con lo schema completo, oppure Chrome con server simulato) · 🟡 = scritto ma **non verificabile qui**, da provare dal vivo con i test della sezione 4 · ℹ️ = valutazione, nessuna modifica.

## 1. Audit statico: cosa ho trovato

| # | Area | File · funzione | Gravità | Problema | Correzione | Verifica |
|---|---|---|---|---|---|---|
| 1 | Ingresso | `schema.sql` · `join_game` | **Alta** | Con `require_approval = false` (valore predefinito!) chiunque avesse il codice entrava subito come membro attivo, senza che il DM lo vedesse prima. | `join_game` mette **sempre** in attesa; `require_approval` forzato a `true` da un trigger su tutte le partite (anche esistenti) e tolto dall'interfaccia. | ✅ T01, T03 |
| 2 | Chat / nomi | `js/chat.js` · `renderMessage` → `describeRecipients` | **Alta** | **XSS memorizzato**: i nomi dei destinatari di un messaggio privato venivano inseriti come HTML. Un membro con nome `<img src=x onerror=…>` eseguiva codice nel browser degli altri (poteva rubare la sessione, anche quella del DM). Dimostrato con un nome di prova: il codice veniva eseguito. | Testo sempre "escapato"; in più una **Content-Security-Policy** in `index.html` che blocca script non del sito, gestori inline e connessioni verso server diversi da Supabase/LiveKit. | ✅ prima: eseguito; dopo: mostrato come testo. Con la sola CSP non viene eseguito comunque |
| 3 | Audio/video | `livekit-token` | **Alta** | Token LiveKit valido **6 ore**: un escluso poteva ricollegarsi per ore con un token già ricevuto; l'espulsione dal server audio dipendeva solo dal browser del DM. | Token di **10 minuti**; nuova Edge Function **`livekit-guard`** che scollega dalla stanza chiunque non sia membro attivo. La chiama il **database stesso** (trigger + `pg_net`) appena qualcuno viene escluso o esce, LiveKit (webhook a ogni ingresso) e il DM entrando. Canale dati LiveKit disattivato (non usato). | ✅ logica provata con server simulato · 🟡 dal vivo (test V3) |
| 4 | Tempo reale | `js/game.js` · `subscribeRealtime` | **Media** | Il canale "broadcast" `game-<id>` era **pubblico**: chi conosceva l'id (es. un escluso) poteva ascoltare spostamenti, segnalazioni, misure e inviare suoni/ping falsi. | Canale **privato** con regole su `realtime.messages`: solo membri attivi possono leggere e scrivere. | ✅ T09, T12, T19, T20 (regole) · 🟡 dal vivo (test R1) |
| 5 | Mappa | `js/map/table.js` · `moveToken` | **Media** | Quando il DM spostava un token **nascosto** dopo il salvataggio, la posizione veniva comunque trasmessa ai giocatori. | Non si trasmette più nulla dei token nascosti. | ✅ codice |
| 6 | Identità | `join_game`, autenticazione anonima | **Media** | Un escluso può crearsi una nuova identità anonima e riprovare con il codice. | Non può più entrare da solo (punto 1): finisce in sala d'attesa e il DM vede la richiesta. In più: max **8 tentativi/10 min** per identità, max **5 richieste in attesa** per partita, pulsante **Stanza chiusa** (nessuna nuova richiesta), **Rigenera codice**. Supabase limita già le nuove identità anonime per indirizzo IP. | ✅ T10, T13, T14, T15 |
| 7 | Abusi | varie tabelle | **Media** | Nessun limite alle operazioni ripetute (spam in chat, dadi, partite, canali). | Limiti per utente sul server: chat 20/30 s, dadi 30/min, partite 5/ora, canali vocali 10/min, diario 300/ora, disegni 1000/10 min, personaggi 100/ora, ingressi 8/10 min. | ✅ T14, T26 |
| 8 | Comunicazioni private | `open_voice_channel`, `messages` | Bassa | Messaggi e canali vocali privati tra soli giocatori sempre permessi. | Nuova opzione del DM (Sala): se spenta, ogni messaggio privato e ogni canale vocale privato deve includere il DM; i canali già aperti senza DM si chiudono subito. Predefinita: accesa (come prima). | ✅ T24, T25 |
| 9 | Immagini | `tokens.image`, `characters.portrait`, `bestiary.image` | Bassa | Un'immagine poteva essere un indirizzo web esterno: ogni giocatore l'avrebbe scaricata da quel server, rivelandogli il proprio indirizzo IP (anche da una campagna importata). | Ammesse solo immagini incorporate (`data:image/…`) o interne (`img/…`), controllate dal database; la CSP blocca comunque gli indirizzi esterni. | ✅ T27 |
| 10 | Suoni | `js/audio.js` · `audioBroadcast` | Bassa | Un membro poteva far suonare a tutti un file qualsiasi dello Storage. | Accettati solo file della cartella audio della partita. | ✅ codice |
| 11 | Nomi | `members.display_name` | Bassa | Nomi con caratteri invisibili o di controllo (per confondere o impersonare). | Ripuliti dal database (anche dopo l'ingresso), 1–40 caratteri. | ✅ T04 |
| 12 | Videocamera | `js/game.js` · finestra d'ingresso | Media (minori) | La casella "Videocamera" era **già spuntata** e la scelta veniva ricordata. | Sempre **spenta** all'ingresso, si accende solo di proposito; quando è accesa compare in alto il bollino rosso lampeggiante **VIDEOCAMERA ACCESA** (toccandolo si spegne). | ✅ |
| 13 | Dati | `messages` | Bassa | Le chat restavano per sempre se il DM non impostava la conservazione. | Nuove partite: **30 giorni**; pulizia notturna automatica se è disponibile `pg_cron` (altrimenti quando entra il DM). Le partite esistenti mantengono la loro scelta (Strumenti DM → Campagna). | ✅ funzione · 🟡 pianificazione notturna |
| 14 | GitHub | repository pubblico | ℹ️ | Nessuna chiave segreta trovata in nessuna versione: in `config.js` c'è solo la chiave **pubblicabile** di Supabase (fatta per stare nel sito). Le chiavi LiveKit sono solo nei Secrets delle Edge Functions. **Però** i commit mostrano l'indirizzo email personale dell'autore. | Vedi sezione 3, punto 6 (rendere privata l'email su GitHub). | ✅ controllato |
| 15 | Indirizzi IP | LiveKit, `prova.html` | ℹ️ | Con LiveKit l'audio passa dal server: **i giocatori non vedono l'IP degli altri**. Lo vedono solo LiveKit e Supabase (inevitabile). La vecchia `prova.html` (collegamento diretto tra browser + server PeerJS pubblico) esponeva l'IP a tutti: è già stata tolta dal repository e non va rimessa. | Immagini esterne bloccate (punto 9), `referrer` disattivato. | ✅ |
| 16 | Canali vocali privati | `js/voice-permissions.js` | ℹ️ | I permessi d'ascolto sono **calcolati** nel browser di chi parla, ma **applicati dal server LiveKit**: chi non è nella lista non riceve i pacchetti audio, anche con un client modificato. La lista è un **elenco di ammessi** (chi entra dopo è escluso finché non viene aggiunto) e i membri dei canali vengono solo dal database. Un client modificato può solo far sentire **la propria** voce a più persone, mai ascoltare quella degli altri. | Nessuna modifica necessaria; token senza permessi extra; test V2 per verificarlo dal vivo. | 🟡 V2 |
| 17 | Policy RLS | tutte le fasi | ℹ️ | Controllate tabella per tabella: estranei, persone in attesa ed esclusi non leggono né scrivono nulla; i giocatori non vedono note, scene, bestiario, token nascosti, tiri segreti, messaggi privati altrui; non possono cambiare stato o ruolo, né muovere mostri, né modificare schede altrui; lo Storage serve i file solo ai membri e solo quando devono vederli. | Nessun buco trovato oltre ai punti sopra. | ✅ T02–T29 |
| 18 | Registrazioni | LiveKit | ℹ️ | Nessuna registrazione: l'app non usa mai la funzione "Egress" di LiveKit e i token non hanno permessi di registrazione. | — | ✅ codice |

## 2. File modificati

- `supabase/schema-sicurezza.sql` (nuovo) — tutte le regole del database. Non cancella nulla; si può rieseguire.
- `supabase/functions/livekit-guard/index.ts` (nuova Edge Function).
- `supabase/functions/livekit-token/index.ts` — token di 10 minuti, niente canale dati.
- `index.html` — Content-Security-Policy e `referrer` disattivato.
- `js/chat.js`, `js/ui.js` — correzione XSS (`escapeHtml`).
- `js/game.js` — canale privato, videocamera spenta all'ingresso, bollino VIDEOCAMERA ACCESA, controllo `livekit-guard` quando entra il DM.
- `js/dm-panel.js` — approvazione sempre attiva, opzione privati, "Silenzia tutti i microfoni", doppio scollegamento all'espulsione.
- `js/lobby.js` — avviso sulla presenza di un adulto, niente più casella "approvazione".
- `js/supabase.js` — gestione degli errori restituiti (tentativi contati).
- `js/map/table.js`, `js/audio.js` — piccole correzioni (token nascosti, suoni).
- `supabase/test-sicurezza.sql` (nuovo) — i test automatici.

## 3. Installazione (in quest'ordine)

1. **Database** — Supabase → SQL Editor → New query → incolla `supabase/schema-sicurezza.sql` → **Run**. Le righe "NOTICE" sono solo informazioni.
2. **Edge Function nuova** — Supabase → Edge Functions → **Deploy a new function** → *Via Editor* → nome **`livekit-guard`** → incolla `supabase/functions/livekit-guard/index.ts` → Deploy. Poi nelle sue impostazioni **disattiva "Verify JWT"** (la chiamano il database e LiveKit). I segreti LIVEKIT_* sono già presenti.
3. **Edge Function esistente** — apri `livekit-token` → Code → sostituisci con il nuovo `index.ts` → Deploy.
4. **LiveKit Cloud** — Settings → **Webhooks** → Add → URL `https://iorzwlodowfixktsjxgb.supabase.co/functions/v1/livekit-guard` → chiave: quella già usata → Save. (Così ogni ingresso nella stanza audio viene controllato dal server.)
5. **Sito** — carica lo ZIP su GitHub e ricarica con Cmd+Maiusc+R.
6. **Dopo aver provato che la partita funziona**: Supabase → Realtime → Settings → disattiva **"Allow public access"** (solo canali privati).
7. **GitHub, email**: github.com → Settings → Emails → spunta **"Keep my email addresses private"** e **"Block command line pushes that expose my email"**. I commit futuri useranno un indirizzo anonimo. (I vecchi commit mostrano ancora l'email: per cancellarla del tutto bisognerebbe ricreare il repository da zero.)
8. Facoltativo: Supabase → Authentication → Rate Limits: lascia basso il limite di "Anonymous sign-ins" (es. 30 all'ora per IP).

## 4. Test di sicurezza

### 4a. Automatici (database) — `supabase/test-sicurezza.sql`
Da eseguire **solo su un database di prova** (crea utenti e partite finte). Risultato ottenuto qui su PostgreSQL 16 con tutto lo schema: **29 OK su 29**.

| Test | Cosa prova |
|---|---|
| T01–T03 | Ingresso sempre in attesa; il DM non può disattivare l'approvazione |
| T04 | Nomi ripuliti |
| T05–T09 | Estraneo e persona in attesa: non vedono e non scrivono nulla, non possono promuoversi, niente canale in tempo reale |
| T10–T13 | Escluso: non rientra, non legge nulla, niente Storage né tempo reale; con una nuova identità finisce in attesa |
| T14–T15 | Codici tirati a indovinare bloccati; max 5 richieste in attesa |
| T16–T20 | Giocatore: niente segreti del DM, niente token nascosti o tiri segreti, non muove mostri, accede solo al canale della sua partita |
| T21–T25 | Messaggi e canali vocali privati invisibili ai terzi; opzione "privati tra giocatori" |
| T26 | Limite di frequenza in chat |
| T27 | Immagini esterne rifiutate |
| T28–T29 | Non si può prendere il controllo della partita né modificare schede altrui |

### 4b. Dal vivo, con account di prova autorizzati
Servono tre dispositivi (o tre browser diversi, uno in finestra anonima): **DM**, **Giocatore**, **Ospite**.

| Test | Come | Risultato atteso |
|---|---|---|
| I1 Ingresso non approvato | L'Ospite usa il codice | Resta in "attesa di approvazione"; non vede mappa, chat, persone |
| I2 Stanza chiusa | Il DM spunta "Stanza chiusa"; l'Ospite riprova | "La stanza è chiusa" |
| I3 Codice a caso | L'Ospite prova 9 codici inventati | Dal 9° tentativo: "Troppi tentativi" |
| M1 Messaggi privati | Giocatore scrive in privato al DM; l'Ospite (ammesso) guarda la chat | L'Ospite non vede il messaggio |
| V1 Canale privato | DM e Giocatore aprono un canale privato | L'Ospite non li sente; la barra del DM è rossa |
| V2 Client modificato | Sul PC dell'Ospite, nella console del browser (F12): `const v = await import('./js/voice.js'); for (const p of v.voice.room.remoteParticipants.values()) for (const t of p.trackPublications.values()) { t.setSubscribed(true); setTimeout(() => console.log(p.identity, t.source, t.permissionStatus, t.isSubscribed), 3000); }` | Per i microfoni di DM e Giocatore nel canale privato: `not_allowed` / `false` e nessun audio |
| V3 Espulsione | Il DM allontana l'Ospite mentre è collegato all'audio | Entro pochi secondi l'Ospite viene scollegato da audio e video e torna alla schermata iniziale; riaprendo il link: "ti ha escluso" |
| V4 Rientro con nuova identità | L'Ospite escluso apre il link in una finestra anonima | Finisce in sala d'attesa: il DM vede la richiesta e la rifiuta |
| R1 Tempo reale | Dopo il punto 6 dell'installazione, gioca una partita normale | Ping, spostamenti e suoni arrivano a tutti i membri |
| C1 Videocamera | Entra al tavolo | La casella videocamera è spenta; se la accendi compare "VIDEOCAMERA ACCESA" |

## 5. Cosa NON è verificato (onestamente)

- Il funzionamento dal vivo di `livekit-guard`, del webhook di LiveKit e della chiamata dal database (`pg_net`): la logica è stata provata con un server simulato, ma non posso collegarmi a LiveKit Cloud da qui. Usa i test V2–V4.
- Il canale in tempo reale privato su Supabase vero: le regole sono provate sul database, la connessione va provata con il test R1. Se qualcosa non arriva, riattiva "Allow public access" e avvisami.
- La pulizia notturna: dipende da `pg_cron` nel tuo progetto (il file prova ad attivarlo da solo).
- Un utente già escluso che tiene la pagina aperta potrebbe ricevere per qualche minuto i ping e gli spostamenti trasmessi (non i messaggi, non l'audio) finché il canale non si ricollega; il suo browser comunque esce dalla partita appena viene escluso.
