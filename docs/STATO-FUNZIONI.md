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

## Fasi successive

| Funzione | Fase |
|---|---|
| Campagne e scene preparate, mostri e PNG con statistiche | ⏳ 4 |
| Mostrare immagini a tutti, musica ed effetti sonori | ⏳ 4 |
| Note private del DM, cronologia della campagna | ⏳ 4 |
| Esportazione / importazione JSON, conservazione messaggi configurabile | ⏳ 4 |
