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

## Fasi successive

| Funzione | Fase |
|---|---|
| Mappe (caricamento immagini, griglia quadrata/esagonale, scala) | ⏳ 2 |
| Token di personaggi e mostri, movimento sincronizzato | ⏳ 2 |
| Porte, trappole, tesori, note, disegno a mano libera | ⏳ 2 |
| Nebbia di guerra e elementi nascosti (protetti dal server) | ⏳ 2 |
| Zoom, spostamento visuale, misurazione distanze | ⏳ 2 |
| Dadi D4–D100 animati, vantaggio/svantaggio, tiri segreti, storico — generati dal server | ⏳ 2 |
| Scheda D&D 5e completa (SRD 5.1), salvataggio automatico | ⏳ 3 |
| Combattimento: iniziativa, turni, round, PF, condizioni, bersagli | ⏳ 3 |
| Inventario, incantesimi e slot, prove di abilità dalla scheda | ⏳ 3 |
| Campagne e scene preparate, mostri e PNG | ⏳ 4 |
| Mostrare immagini a tutti, musica ed effetti sonori | ⏳ 4 |
| Note private del DM, cronologia della campagna | ⏳ 4 |
| Esportazione / importazione JSON, conservazione messaggi configurabile | ⏳ 4 |
