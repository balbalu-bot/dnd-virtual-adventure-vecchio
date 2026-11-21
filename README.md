# D&D Virtual Adventure — Fase 1

Piattaforma web per giocare a Dungeons & Dragons a distanza: stanze private, ruoli DM e giocatore, chat generale, privata e di gruppo, **voce con ricetrasmittente (Push-to-Talk)**, **canali vocali privati reali** e **videochiamata**. Funziona da browser su PC, tablet, Android e iPhone, senza installare nulla, ed è pubblicata gratis su GitHub Pages.

> **Stato:** completate la Fase 1 (voce, video, chat, stanze), la **Fase 2** (mappe, token, nebbia di guerra, dadi) e la **Fase 3** (schede D&D 5e e combattimento). La Fase 4 riguarda campagne, musica, immagini ed esportazione. L'elenco preciso di ciò che è già fatto e di ciò che manca è in [`docs/STATO-FUNZIONI.md`](docs/STATO-FUNZIONI.md). L'architettura tecnica è descritta in [`docs/ARCHITETTURA.md`](docs/ARCHITETTURA.md).

---

## Come è fatta (in breve)

| Pezzo | Servizio | A cosa serve | Costo |
|---|---|---|---|
| Sito | **GitHub Pages** | Pubblica le pagine (HTML, CSS, JavaScript) | Gratis |
| Database e accessi | **Supabase** | Partite, giocatori, chat, canali privati, sincronizzazione in tempo reale, regole di sicurezza | Gratis (piano Free) |
| Voce e video | **LiveKit Cloud** | Server audio/video (WebRTC) che smista voce e webcam tra i giocatori | Gratis (piano Build, con limiti) |
| Chiavi segrete | **Supabase Edge Functions** | Rilasciano i "biglietti" per l'audio solo ai membri autorizzati | Gratis |

Nessuna chiave segreta finisce su GitHub: nel sito c'è solo la chiave **pubblica** di Supabase, protetta dalle regole di sicurezza del database.

---

## 1. Creare il repository GitHub

1. Crea un account su <https://github.com> (se non lo hai già).
2. In alto a destra premi **+** → **New repository**.
3. Nome: per esempio `dnd-virtual-adventure`. Visibilità: **Public** (GitHub Pages gratuito richiede un repository pubblico).
4. Premi **Create repository**.

## 2. Caricare i file

1. Estrai lo ZIP sul computer.
2. Nella pagina del repository premi **uploading an existing file** (oppure **Add file → Upload files**).
3. Trascina **il contenuto** della cartella estratta (le cartelle `css`, `js`, `vendor`, `fonts`, `icons`, `supabase`, `docs` e i file `index.html`, `config.js`, ecc.), **non** la cartella esterna.
4. In basso premi **Commit changes**.

> Il file `.nojekyll` è nascosto e alcuni computer non lo trascinano: non è un problema.

## 3. Configurare i servizi esterni

### 3a. Supabase (database, accessi, tempo reale)

1. Vai su <https://supabase.com>, crea un account e premi **New project**.
   - Nome a piacere, password del database (conservala), **Region: Central EU (Frankfurt)**.
2. Quando il progetto è pronto, apri **SQL Editor** → **New query**, incolla **tutto** il file `supabase/schema.sql` e premi **Run**. Deve comparire *Success*.
3. Apri **Authentication → Sign In / Providers** e attiva **Allow anonymous sign-ins** → **Save**.
   *(Serve per entrare con il solo nome, senza registrazione.)*
4. Apri **Authentication → URL Configuration**:
   - **Site URL**: `https://TUO-NOME-UTENTE.github.io/dnd-virtual-adventure/`
   - **Redirect URLs**: aggiungi lo stesso indirizzo.
   *(Serve per l'accesso tramite email da altri dispositivi.)*
5. Apri **Project Settings → API Keys** (o **API**) e copia:
   - **Project URL** (tipo `https://abcdefgh.supabase.co`)
   - la chiave **pubblica**: *Publishable key* (`sb_publishable_…`) oppure *anon public*.
6. Su GitHub apri il file `config.js` → icona della **matita** → sostituisci i due valori → **Commit changes**.

> ⚠️ Non usare mai la *service_role* / *Secret key* nel file `config.js`.

### 3b. LiveKit Cloud (voce e video)

1. Vai su <https://cloud.livekit.io>, crea un account e un progetto (piano **Build**, gratuito, senza carta di credito).
2. Apri **Settings → API Keys** → **Create key**. Copia e conserva:
   - **API Key** (tipo `APIxxxxxxx`)
   - **API Secret** (lunga stringa, si vede una volta sola)
   - **WebSocket URL** del progetto (tipo `wss://nome-progetto-xxxx.livekit.cloud`)

### 3c. Le due funzioni server (Supabase Edge Functions)

1. In Supabase apri **Edge Functions** → **Deploy a new function** → **Via Editor**.
2. Nome: `livekit-token`. Cancella il codice di esempio, incolla tutto il file `supabase/functions/livekit-token/index.ts` → **Deploy**.
3. Ripeti con il nome `livekit-moderate` e il file `supabase/functions/livekit-moderate/index.ts`.
4. Apri **Edge Functions → Secrets** (o *Manage secrets*) e aggiungi tre segreti:

   | Nome | Valore |
   |---|---|
   | `LIVEKIT_API_KEY` | la API Key di LiveKit |
   | `LIVEKIT_API_SECRET` | la API Secret di LiveKit |
   | `LIVEKIT_URL` | il WebSocket URL (`wss://…`) |

> Se entrando al tavolo compare un errore **401 / Invalid JWT**, apri le impostazioni di ciascuna funzione e disattiva **Verify JWT**: le funzioni controllano comunque da sole chi è l'utente e se fa parte della partita.

## 4. Attivare GitHub Pages

1. Nel repository: **Settings → Pages**.
2. **Source: Deploy from a branch**, **Branch: `main`**, cartella **`/ (root)`** → **Save**.
3. Dopo 1–2 minuti l'indirizzo del sito compare in alto nella stessa pagina:
   `https://TUO-NOME-UTENTE.github.io/dnd-virtual-adventure/`

GitHub Pages usa sempre **HTTPS**, indispensabile perché il browser conceda microfono e videocamera.

## 5. Invitare gli amici

1. Apri il sito, scrivi il tuo nome e (se vuoi) crea un personaggio.
2. Premi **Crea una nuova partita**: diventi Dungeon Master.
3. Si apre la finestra **Invita**: premi **WhatsApp** (o *Copia link*). Gli amici aprono il collegamento, scrivono il nome e premono **Entra**.
4. Ognuno preme **Entra al tavolo** e accetta i permessi per microfono e videocamera.

Per riprendere una partita, apri il sito dallo stesso dispositivo: la trovi in **Le tue partite**. Su iPhone conviene **aggiungere il sito alla schermata Home** (Condividi → *Aggiungi alla schermata Home*): Safari cancella i dati dei siti non visitati per 7 giorni, mentre le app sulla Home li conservano. Per usare lo stesso profilo su più dispositivi premi **Proteggi con email**.

## 6. Prova con due telefoni e un computer su reti diverse

Prepara tre dispositivi su **tre reti diverse**, per esempio:
- **PC** sul Wi-Fi di casa;
- **Telefono A** con il **Wi-Fi spento** (solo rete mobile 4G/5G);
- **Telefono B** collegato all'hotspot di un altro telefono o a un altro Wi-Fi.

Usa le **cuffie** su almeno due dispositivi per evitare l'eco, poi verifica:

| # | Prova | Risultato atteso |
|---|---|---|
| 1 | Il PC crea la partita, A e B entrano dal link WhatsApp | Tutti vedono i tre nomi nel riquadro *Il gruppo* |
| 2 | Chat: messaggio a *Tutti* | Arriva subito sugli altri due |
| 3 | Chat: da A messaggio privato a B | Lo vede solo B (il PC no, nemmeno il DM) |
| 4 | PTT: su A tieni premuto il grande pulsante e parla | PC e B ti sentono; rilasci e smettono di sentirti |
| 5 | Sul PC prova il tasto **SPAZIO** (fuori dalla chat) | Funziona come PTT; scrivendo in chat lo spazio resta uno spazio |
| 6 | **Privacy**: dal PC premi l'icona 📻 accanto ad A | Sul PC e su A appare il bordo rosso *CANALE PRIVATO*. Parla dal PC: **A ti sente, B no**. Parla da A: **il PC sente, B no** |
| 7 | Premi **Torna al generale** | Ora B sente di nuovo tutti |
| 8 | Videocamere | Ognuno vede i riquadri con nome e personaggio |
| 9 | Su A attiva la modalità aereo per 10 secondi, poi disattivala | Compare *riconnessione…* e poi tutto riprende da solo |
| 10 | Il DM silenzia B *per tutti* dal pannello | Il microfono di B si spegne |

La prova **6** è quella che conferma la privacy reale dei canali privati: falla sempre dopo ogni aggiornamento.

---

## Aggiornamento alla Fase 2 (mappe, token, nebbia, dadi)

1. **Database** — In Supabase apri **SQL Editor → New query**, incolla tutto `supabase/schema-fase2.sql` e premi **Run**: deve comparire *Success*. Crea le tabelle di mappe, token, disegni e dadi e la cartella privata per le immagini delle mappe.
   - Se in basso compare l'avviso *configurazione Storage non riuscita*, vai in **Storage → New bucket**, nome `maps`, **Public: disattivato**, e riesegui lo script.
2. **File del sito** — Su GitHub **Add file → Upload files**, trascina il contenuto dello ZIP di aggiornamento (cartelle `js`, `css`, `docs`, `supabase` e i file `sw.js`, `README.md`) e premi **Commit changes**. Lo ZIP di aggiornamento **non contiene `config.js`**, così la tua configurazione resta intatta.
3. Dopo 1–2 minuti ricarica il sito con **Cmd+Maiusc+R** (su telefono: chiudi e riapri la scheda).

### Come si usa il tavolo

**Il DM**
- **Nuova mappa**: clic sul nome della mappa (in alto a sinistra del tavolo) → *Nuova mappa*. Con un'immagine tua o vuota con griglia. Scrivi quante caselle ha l'immagine in larghezza e la griglia si allinea da sola; rifinisci in *Impostazioni*.
- Le mappe nuove sono **bozze** (le vedi solo tu): preparale in anticipo e premi **Mostra ai giocatori** quando la scena inizia.
- **+ Elemento**: mostri, PNG, oggetti, porte, trappole, tesori, note. Doppio clic su un elemento per modificarlo. Selezionandolo compare una barra con *Nascondi/Mostra*, *Apri/Chiudi* (porte), *Attiva trappola*, *A terra*, *Blocca*, *Elimina*.
- **Aggiungi i personaggi** (colonna sinistra): crea in un colpo il token di ogni giocatore, che potrà muovere solo il suo.
- **Nebbia**: attivala, poi 🌤 trascina per rivelare e 🌫 per coprire. Tu la vedi semitrasparente.
- **Nascosto** = il server non manda proprio quell'elemento ai giocatori: usalo per mostri in agguato e trappole.

**Tutti**
- ✋ trascina il tuo token (si aggancia alla griglia) · trascina il vuoto per spostare la vista · rotellina o due dita per lo zoom.
- 📏 righello (piedi, metri, caselle; lo vedono anche gli altri) · 📍 segnala un punto · ✏️ disegna · 🅰 nota di testo.
- **Dadi**: scheda *Dadi* a destra. Clic su un dado, oppure formula libera (`1d20+5`, `2d6+1d4+3`). Vantaggio/svantaggio, tipo di tiro, descrizione, tiro segreto. Il risultato lo decide il server e compare a tutti con l'animazione.

## Aggiornamento alla Fase 3 (schede e combattimento)

1. **Database**: in Supabase **SQL Editor → New query**, incolla tutto `supabase/schema-fase3.sql` e premi **Run** (*Success*).
2. **File del sito**: su GitHub **Add file → Upload files**, trascina il contenuto dello ZIP di aggiornamento e premi **Commit changes**. Il tuo `config.js` non viene toccato.
3. Ricarica il sito con **Cmd+Maiusc+R**.

### Come si usa

**Scheda** (scheda *Scheda* a destra)
- Ogni giocatore vede e modifica la propria; il DM sceglie dall'elenco in alto quella di qualunque giocatore e può correggerla.
- Si salva da sola mentre scrivi (in alto a destra compare *Salvato ✓*).
- **Clic sui numeri per tirare**: modificatore di una caratteristica = prova; tiri salvezza; abilità; attacchi (*Colpire* e *Danni*, spunta *crit* per il critico); incantesimi.
- *Normale / Vantaggio / Svantaggio* in alto vale per tutti i tiri d20.
- Il pallino accanto alle abilità: vuoto = nessuna competenza, pieno = competente, doppio = maestria.
- *Danno* / *Cura* aggiornano i PF (i temporanei si consumano per primi).

**Combattimento** (riquadro *Iniziativa e combattimento* a sinistra; su telefono nella scheda *Gruppo*)
- Il DM preme **Inizia combattimento**: entrano personaggi e mostri presenti sulla mappa. *+ mostro* per aggiungerne altri, *🎲 Iniz. mostri* tira l'iniziativa di tutti i mostri.
- I giocatori premono **🎲 Iniz.** (o *Iniziativa* nella scheda): il valore entra da solo nell'ordine.
- **Turno successivo ▶**: avanza; a fine giro aumenta il round. Chi è di turno riceve un avviso e il suo token si illumina sulla mappa.
- PF dei mostri: il DM li vede e li modifica (✎ per PF, CA e note segrete); i giocatori vedono solo *Illeso / Ferito / Gravemente ferito / A terra*.
- **🎯 Bersaglio**: ogni giocatore sceglie chi attacca; sulla mappa compare una freccia.
- Nulla è automatico: colpito o mancato, danni e condizioni li decide e applica il DM.

## Limiti dei servizi gratuiti (da conoscere)

**LiveKit Cloud — piano Build (gratuito)**
- **5.000 minuti-partecipante al mese**, 50 GB di traffico, 100 partecipanti contemporanei. È un **tetto rigido**: superato il limite le nuove connessioni falliscono fino al mese successivo (non ti addebitano nulla).
- Esempio: 5 persone × 3 ore = 900 minuti a sessione → circa **5 sessioni al mese**. I minuti contano anche se nessuno parla, finché si è "al tavolo" con l'audio collegato; *Solo chat, senza audio* non consuma minuti.
- Se servono più serate: piano **Ship** a 50 $/mese (150.000 minuti), oppure un server LiveKit proprio (open source) su un piccolo server cloud.

**Supabase — piano Free**
- 500 MB di database, 200 connessioni in tempo reale contemporanee, 2 milioni di messaggi in tempo reale al mese: abbondanti per un gruppo di amici.
- **Pausa per inattività**: se il progetto non viene usato per circa una settimana, Supabase lo mette in pausa (avvisa prima via email). **I dati restano**: si riattiva dal pannello Supabase con *Restore*. Tra una sessione e l'altra, se passa più di una settimana, ricordati di riattivarlo prima di giocare.
- L'invio di email (accesso con email) del piano gratuito ha un limite di pochi messaggi l'ora.

**Browser e telefoni**
- iPhone: usa Safari aggiornato (iOS 16 o successivo consigliato). Se lo schermo si blocca o passi ad un'altra app, iOS sospende microfono e audio: tieni l'app in primo piano.
- La scelta dell'uscita audio (cuffie Bluetooth) dal sito funziona su Chrome/Edge per PC; su telefono si sceglie dalle impostazioni del sistema.

---

## Struttura del repository

```
index.html                 pagina unica dell'app
config.js                  ← l'unico file da modificare (indirizzo e chiave pubblica Supabase)
manifest.webmanifest, sw.js  installazione come app (PWA)
css/app.css                grafica fantasy, layout PC / tablet / smartphone
js/main.js                 avvio e navigazione
js/supabase.js             collegamento al database e alle funzioni server
js/lobby.js                schermata iniziale, crea / entra / riprendi, inviti WhatsApp
js/characters.js           creazione e scelta del personaggio (base)
js/game.js                 schermata di gioco, gruppo, canali, comandi vocali, tempo reale
js/voice.js                voce, PTT, canali privati, videocamere (LiveKit)
js/voice-permissions.js    calcolo dei permessi di ascolto (privacy dei canali privati)
js/video.js                riquadri video
js/chat.js                 chat generale, privata, al DM, di gruppo
js/dm-panel.js             pannello del Dungeon Master
js/ui.js, js/store.js      utilità e stato condiviso
vendor/                    librerie già incluse (Supabase JS, LiveKit client): nessun CDN esterno
fonts/                     caratteri Cinzel e Alegreya Sans (licenza OFL)
icons/                     icone dell'app
supabase/schema.sql        database + regole di sicurezza (da incollare in Supabase)
supabase/schema-fase2.sql  mappe, token, disegni, dadi, Storage (da incollare dopo schema.sql)
supabase/schema-fase3.sql  schede e combattimento (da incollare dopo schema-fase2.sql)
js/sheet.js                scheda personaggio D&D 5e
js/combat.js               iniziativa, turni, PF, condizioni, bersagli
js/map/                    tavolo virtuale: motore grafico, griglia, strumenti del DM
js/dice.js                 dadi generati dal server e animazione
supabase/functions/        le due funzioni server (token audio, moderazione DM)
docs/                      architettura e stato delle funzioni
```

## Aggiornare il sito

Quando ti consegno una nuova versione: su GitHub **Add file → Upload files**, trascina i file aggiornati (sovrascrivono quelli vecchi) e premi **Commit**. Se cambia `schema.sql`, rieseguilo nel SQL Editor di Supabase: è scritto per poter essere eseguito più volte senza perdere i dati. Non sovrascrivere il tuo `config.js` con quello vuoto.

## Diritti e contenuti

Progetto amatoriale non ufficiale, non affiliato a Wizards of the Coast. Nessuna illustrazione, mappa o testo protetto è incluso. La scheda usa solo termini di gioco del *System Reference Document 5.1* (licenza CC BY 4.0): vedi l'attribuzione in `docs/LICENZE-SRD.md`. Licenze delle librerie incluse: vedi `vendor/LICENZE.txt` e `fonts/`.
