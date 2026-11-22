# Stato delle funzioni

Legenda: ✅ implementato · 🟡 parziale · ⏳ fase successiva

## Fase 1 — Base multiplayer (questa consegna)

| Funzione | Stato | Note |
|---|---|---|
| Schermata iniziale fantasy | ✅ | PC, tablet, smartphone |
| Nome giocatore | ✅ | memorizzato sul dispositivo |
| Creare / scegliere un personaggio | 🟡 | nome, ritratto, specie, classe, livello, background. Scheda completa in Fase 3 |
| Creare partita (come DM) | ✅ | il creatore è DM; può trasferire il ruolo |
| Entrare con codice / link | ✅ | codice di 8 caratteri, link `#/join/CODICE` |
| Condivisione WhatsApp | ✅ | anche *Copia link* e condivisione nativa del telefono |
| Riprendere una partita | ✅ | *Le tue partite*; su altri dispositivi tramite accesso email |
| Stanze private, 2–8 partecipanti (fino a 20) | ✅ | stanza chiusa, sala d'attesa con approvazione, rigenera codice |
| Controllo amministrativo del DM | ✅ | ammetti / rifiuta / allontana / riammetti / silenzia per tutti / pausa / elimina partita |
| Sincronizzazione in tempo reale | ✅ | chat, membri, stato partita, canali privati |
| Voce: microfono on/off, volume individuale, chi parla, silenzia partecipante | ✅ | silenziare = smettere di ricevere il suo audio (solo per te) |
| Microfono sempre aperto | ✅ | modalità *Aperto* |
| Push-to-Talk tieni premuto | ✅ | grande pulsante, tasto configurabile (SPAZIO) ignorato mentre scrivi |
| PTT con un clic (apri/chiudi) | ✅ | |
| Indicazione di trasmissione | ✅ | pulsante illuminato, scritta *IN TRASMISSIONE*, segnale acustico |
| Canale vocale privato 1-a-1 | ✅ | privacy applicata dal server LiveKit |
| Piccoli gruppi privati | ✅ | fino a 8 persone; selezione con le caselle nel gruppo |
| Ritorno immediato al generale | ✅ | pulsante *Torna al generale* |
| Canale attivo sempre evidente | ✅ | indicatore in basso, barra sopra il tavolo, bordo rosso |
| Videochiamata con nome giocatore e personaggio | ✅ | |
| Attiva/disattiva videocamera, scelta webcam e microfono | ✅ | impostazioni |
| Scelta uscita audio | 🟡 | da sito su Chrome/Edge per PC; su telefono dalle impostazioni di sistema |
| Solo audio per connessioni lente | ✅ | spegne la propria webcam e non scarica i video altrui |
| Pannello video ridimensionabile e spostabile | ✅ | 3 dimensioni, pannello fisso o flottante (PC) |
| Ingrandimento di un partecipante | ✅ | doppio clic o icona |
| DM evidenziato | ✅ | primo riquadro, bordo oro, opzione ingrandito |
| Nascondi tutti i video | ✅ | |
| Disposizione compatta per smartphone | ✅ | schede Tavolo / Gruppo / Chat / Video |
| Chat generale, privata, al DM, a gruppi | ✅ | protetta dal database (RLS) |
| Mittente e orario, messaggi di sistema | ✅ | ingressi, approvazioni, allontanamenti, nuovo DM |
| Notifiche discrete | ✅ | suono, avviso, contatore non letti |
| Disconnessioni e riconnessioni | ✅ | automatiche per dati e audio/video |
| Installazione come app (PWA) | ✅ | Android/PC: pulsante *Installa*; iPhone: *Aggiungi a Home* |

## Fase 2 — Tavolo virtuale (consegnata)

| Funzione | Stato | Note |
|---|---|---|
| Creare mappe vuote o da immagine propria | ✅ | immagini ridotte a max 4096 px, salvate nello Storage privato |
| Griglia quadrata o esagonale, scala, colore, allineamento | ✅ | anteprima dal vivo mentre regoli dimensione e spostamento |
| Più mappe per avventura, preparazione in anticipo | ✅ | una mappa è "bozza" finché il DM non preme *Mostra ai giocatori* |
| Cambio rapido di scena | ✅ | i giocatori passano subito alla nuova mappa |
| Token di personaggi, PNG, mostri, oggetti | ✅ | taglie da ½ a 4×4, colore, ritratto |
| Porte (apri/chiudi, ruota), trappole (attiva/ripristina), tesori | ✅ | l'attivazione di una trappola manda un avviso a tutti |
| Note e segnaposto, note di testo, note solo-DM | ✅ | |
| Disegno a mano libera | ✅ | tutti possono disegnare; il DM cancella tutto, i giocatori i propri |
| Elementi nascosti ai giocatori | ✅ | **protetti dal server**: un elemento nascosto non viene inviato ai giocatori, nemmeno quando il DM lo sposta |
| Nebbia di guerra, rivelazione progressiva | ✅ | copertura visiva della mappa; per segreti assoluti usare *Nascondi* sugli elementi |
| Zoom, spostamento, pizzico a due dita | ✅ | |
| Righello (piedi, metri, caselle), regola diagonali 5e / 5-10-5 / reale | ✅ | il righello si vede anche dagli altri |
| Segnalare un punto a tutti (ping) | ✅ | |
| Movimento sincronizzato in tempo reale | ✅ | ogni giocatore muove solo il proprio personaggio (controllo sul server); il DM muove tutto e può bloccare un token |
| Dadi D4–D100, multipli, modificatori, formule (es. 2d6+1d4+3) | ✅ | **generati dal server** con generatore crittografico |
| Vantaggio / svantaggio, tipo di tiro (colpire, danni, TS, prove, iniziativa) | ✅ | |
| Tiri segreti del DM e tiri riservati dei giocatori | ✅ | protetti dal database |
| Storico dei tiri e animazione | ✅ | animazione 2D dei dadi che rotolano |

## Fase 3 — Regole e personaggi (consegnata)

| Funzione | Stato | Note |
|---|---|---|
| Scheda completa: nome, ritratto, specie, classe, livello, background, allineamento, PE | ✅ | |
| Caratteristiche con modificatori automatici, bonus di competenza dal livello | ✅ | |
| Tiri salvezza e 18 abilità con competenza e maestria | ✅ | clic per tirare |
| PF, PF temporanei, danni/cure rapide, CA, iniziativa, velocità, dadi vita, TS contro morte | ✅ | |
| Attacchi: per colpire e danni dalla scheda, colpo critico, tipo di danno | ✅ | |
| Incantesimi: caratteristica, CD e attacco automatici, slot 1°–9°, elenco con danni | ✅ | riposo lungo recupera gli slot |
| Equipaggiamento, inventario, monete (MR, MA, ME, MO, MP) | ✅ | |
| Condizioni (14 del SRD) e indebolimento | ✅ | |
| Privilegi, competenze, lingue, diario personale | ✅ | |
| Vantaggio / svantaggio per tutti i tiri d20 della scheda | ✅ | |
| Salvataggio automatico, aggiornamento in tempo reale | ✅ | |
| Permessi: il giocatore modifica il suo, il DM tutti quelli del tavolo | ✅ | controllo sul database |
| Combattimento: avvio, partecipanti dalla mappa o manuali | ✅ | |
| Iniziativa (giocatori dalla scheda, mostri in un clic, valori modificabili dal DM) | ✅ | |
| Ordine automatico, turno attivo, turno successivo/precedente, contatore round | ✅ | notifica «È il tuo turno» |
| PF dei mostri riservati al DM; ai giocatori solo lo stato (illeso, ferito, grave, a terra) | ✅ | protetto dal database |
| Condizioni in combattimento, mostri nascosti nel tracker | ✅ | |
| Bersagli con freccia sulla mappa, anello sul personaggio di turno | ✅ | |
| Nessuna automazione arbitraria | ✅ | colpito/mancato e danni li applica il DM |

## Fase 4 — Campagna e strumenti del DM (consegnata)

| Funzione | Stato | Note |
|---|---|---|
| Scene preparate (mappa, musica, testo da leggere, immagine, appunti) e avvio con un clic | ✅ | solo il DM le vede |
| Bestiario di mostri e PNG, piazzamento nascosto sulla mappa, invio al combattimento | ✅ | |
| Immagini da mostrare ai giocatori (handout) con galleria nel Diario | ✅ | i giocatori ricevono il file solo dopo *Mostra a tutti* |
| Musica d'atmosfera ed effetti sonori sincronizzati | ✅ | suoni originali generati dal browser; file propri caricabili |
| Volume personale musica/effetti | ✅ | |
| Note private del DM | ✅ | protette dal database |
| Diario/cronaca della campagna scritto da tutti | ✅ | ognuno modifica le proprie voci, il DM tutte |
| Esportazione JSON (con o senza immagini e chat) e importazione in una nuova partita | ✅ | i file audio caricati non sono inclusi |
| Durata configurabile dei messaggi e cancellazione della chat | ✅ | pulizia all'ingresso del DM |

## Aggiornamento "movimento, mostri e opzioni" (consegnato)

| Funzione | Stato | Note |
|---|---|---|
| Solo il DM muove mostri, PNG e oggetti | ✅ | controllo nel database (`move_token`) |
| Il DM sceglie dove compare un giocatore prima di ammetterlo | ✅ | |
| Movimento limitato dalla velocità, area raggiungibile e percorso visibili | ✅ | in combattimento solo nel proprio turno; fuori, velocità ogni 6 s |
| Ostacoli / caselle non calpestabili | ✅ | verificati dal server lungo tutto il percorso |
| Mostri SRD pronti con statistiche e illustrazioni originali | ✅ | 23 creature |
| Sblocco dell'audio per i giocatori, suono anche con iPhone in silenzioso | ✅ | da provare dal vivo su iPhone |
| Effetti sonori rifatti | ✅ | generati dal browser |
| Opzioni: tema medievale/classico/moderno, chiaro/scuro, dadi 2D/3D con colori | ✅ | per dispositivo |
| Guida in app e glossario dei termini | ✅ | anche in `docs/GLOSSARIO.md` |

## Possibili miglioramenti futuri (non promessi)

| Funzione | Note |
|---|---|
| Visione dinamica / linea di vista dei token | oggi la nebbia è manuale |
| Porte che bloccano il passaggio da sole | oggi si segnano le caselle come ostacolo |
| Registrazione delle sessioni | richiede servizi a pagamento |
