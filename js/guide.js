// =====================================================================
//  Guida dentro l'app: come si gioca + glossario di tutti i termini
// =====================================================================
import { h, modal } from "./ui.js";

export const GLOSSARY = [
  // ---- il gioco
  ["A terra", "Un personaggio a 0 punti ferita cade privo di sensi. Nel suo turno fa i tiri salvezza contro la morte: 3 successi (10 o più sul d20) = si stabilizza, 3 fallimenti = muore. Un 20 naturale lo rialza con 1 PF."],
  ["Abilità", "Cose in cui un personaggio può essere bravo, ognuna legata a una caratteristica: Atletica (FOR), Acrobazia, Furtività, Rapidità di mano (DES), Arcano, Storia, Indagare, Natura, Religione (INT), Addestrare animali, Intuizione, Medicina, Percezione, Sopravvivenza (SAG), Inganno, Intimidire, Intrattenere, Persuasione (CAR)."],
  ["Azione, azione bonus, reazione", "Nel suo turno un personaggio può muoversi, fare UNA azione (attaccare, lanciare un incantesimo, Scattare, Disimpegnarsi, Nascondersi, Aiutare…) e, se ha una capacità che lo permette, un'azione bonus. La reazione è una cosa rapida fatta anche fuori dal proprio turno, per esempio l'attacco di opportunità quando un nemico si allontana."],
  ["Bersaglio", "Nel combattimento ogni giocatore indica chi sta attaccando (🎯). Sulla mappa compare una freccia rossa."],
  ["Bestiario", "L'archivio del DM con mostri e PNG pronti: statistiche, attacchi, illustrazione. Si trova in Strumenti DM → Mostri e PNG."],
  ["Bonus di competenza", "Un bonus (+2 al 1° livello, cresce con il livello) che si aggiunge ai tiri in cui il personaggio è addestrato: armi che sa usare, abilità e tiri salvezza in cui è competente."],
  ["CA — Classe Armatura", "Quanto è difficile colpire una creatura. Per colpirla il tiro per colpire deve essere uguale o superiore alla sua CA."],
  ["Campagna", "Una storia che continua per più sessioni con gli stessi personaggi. Qui una partita = una campagna, con mappe, schede, diario e note salvati."],
  ["Canale generale", "Il canale vocale e di chat in cui tutti sentono tutti."],
  ["Canale privato", "Un canale vocale solo per alcune persone (per esempio DM e un giocatore). Gli altri non ricevono proprio l'audio. Quando sei in un canale privato la barra in alto diventa rossa."],
  ["Caratteristiche", "I sei numeri base di ogni creatura: Forza (FOR), Destrezza (DES), Costituzione (COS), Intelligenza (INT), Saggezza (SAG), Carisma (CAR). Di solito vanno da 3 a 20; 10–11 è la media umana."],
  ["Casella", "Un quadretto (o esagono) della griglia sulla mappa. 1 casella = 1,5 metri = 5 piedi."],
  ["CD — Classe Difficoltà", "Il numero da raggiungere o superare in una prova o in un tiro salvezza. Facile 10, media 15, difficile 20, quasi impossibile 25–30."],
  ["Colpo critico", "Un 20 naturale sul d20 di un attacco colpisce sempre e raddoppia i dadi dei danni (spunta «crit» nella scheda). Un 1 naturale manca sempre."],
  ["Combattimento, round e turno", "Il combattimento è diviso in round (circa 6 secondi). In ogni round tutti agiscono una volta, uno alla volta, nell'ordine di iniziativa: il momento in cui agisci è il tuo turno."],
  ["Condizioni", "Stati speciali che cambiano cosa puoi fare: Accecato, Affascinato, Afferrato, Assordato, Avvelenato, Incapacitato, Invisibile, Paralizzato, Pietrificato, Privo di sensi, Prono (a terra), Spaventato, Stordito, Trattenuto. Si segnano nel riquadro del combattimento."],
  ["d4, d6, d8, d10, d12, d20, d100", "I dadi: la «d» sta per dado e il numero sono le facce. Il d20 è quello principale: si usa per attacchi, prove e tiri salvezza. Il d100 (percentuale) dà un numero da 1 a 100."],
  ["DM — Dungeon Master", "Chi racconta la storia, interpreta mostri e PNG, prepara le mappe e decide le regole al tavolo. Ha gli Strumenti DM e vede le cose nascoste."],
  ["Danni", "Quanto male fa un attacco: si tirano i dadi indicati (per esempio 1d8+3) e si tolgono dai punti ferita. Tipi di danno: taglienti, perforanti, contundenti, fuoco, freddo, fulmine, tuono, acido, veleno, necrotico, radioso, psichico, forza."],
  ["Diario", "La cronaca della campagna, scritta insieme, e la galleria delle immagini mostrate dal DM (scheda «Diario» a destra)."],
  ["Nebbia di guerra", "Copertura nera sulle parti della mappa che i personaggi non hanno ancora visto. Il DM la rivela (🌤) o la copre (🌫) trascinando sulla mappa."],
  ["Formula dei dadi", "Come si scrive un tiro: «2d6+3» = tira due d6 e aggiungi 3. «1d20+5» = un d20 più 5. Si possono sommare: «1d8+1d6+2»."],
  ["GS — Grado di sfida", "Quanto è pericoloso un mostro. GS 1 è una buona sfida per un gruppo di 4 personaggi di 1° livello; GS 5 o più è molto pericoloso per personaggi di basso livello."],
  ["Handout (immagini mostrate)", "Lettere, mappe del tesoro, ritratti o indizi che il DM mostra a tutti con «Mostra a tutti». Restano nel Diario."],
  ["Incantesimi e slot", "Le magie. I trucchetti si lanciano sempre; gli altri incantesimi consumano uno «slot» del livello giusto, che si recupera con il riposo lungo."],
  ["Iniziativa", "All'inizio del combattimento ognuno tira 1d20 + modificatore di Destrezza: chi fa di più agisce per primo. Il tracker ordina tutto da solo."],
  ["Ispirazione", "Un premio del DM per una bella interpretazione: si spende per avere vantaggio su un tiro."],
  ["Livello", "Quanto è esperto un personaggio (da 1 a 20). Salendo di livello aumentano punti ferita, capacità e bonus di competenza."],
  ["Maestria", "Competenza doppia in un'abilità: si aggiunge due volte il bonus di competenza (doppio pallino nella scheda)."],
  ["Modificatore", "Il numero che si aggiunge ai tiri, ricavato da una caratteristica: (valore − 10) ÷ 2 arrotondato per difetto. Esempi: 10 → +0, 14 → +2, 18 → +4, 8 → −1."],
  ["Movimento e velocità", "Quanto può spostarsi un personaggio. Velocità 9 m = 6 caselle. In combattimento ti muovi solo nel tuo turno e fino alla tua velocità; fuori combattimento puoi fare quel tratto ogni 6 secondi (un round). Quando tocchi il tuo personaggio le caselle verdi mostrano dove puoi arrivare."],
  ["Multiattacco", "Alcuni mostri fanno più attacchi nella stessa azione (per esempio un morso e due artigli)."],
  ["Ostacoli", "Caselle in cui non si può camminare (muri, colonne, burroni, acqua profonda). Il DM le segna con 🧱; i personaggi dei giocatori non possono entrarci né attraversarle."],
  ["PF — Punti ferita", "La salute. Quando subisci danni scendono; a 0 sei a terra. I PF temporanei sono uno scudo che si consuma per primo e non si somma ad altri temporanei."],
  ["Personaggio giocante (PG)", "Il personaggio guidato da un giocatore. Solo il suo giocatore (e il DM) può muoverlo sulla mappa."],
  ["Ping (segnala un punto)", "📍 o Alt+clic: fa comparire un cerchio colorato che vedono tutti, per dire «guardate qui»."],
  ["PNG — Personaggio non giocante", "Chiunque non sia un personaggio dei giocatori: oste, guardia, re, mercante. Li interpreta il DM."],
  ["Prova di caratteristica", "Quando provi qualcosa di incerto (scassinare, convincere, saltare): 1d20 + modificatore (+ competenza se sei addestrato) contro una CD scelta dal DM."],
  ["PTT — Premi per parlare", "Il microfono trasmette solo mentre tieni premuto il pulsante (o il tasto scelto, di solito SPAZIO). «PTT clic» = un clic accende, un altro spegne. «Aperto» = il microfono è sempre acceso."],
  ["Resistenza, vulnerabilità, immunità", "Resistenza: quel tipo di danno è dimezzato. Vulnerabilità: raddoppiato. Immunità: nessun danno."],
  ["Ricarica 5–6", "Una capacità di un mostro (per esempio il soffio del drago) che, dopo l'uso, torna disponibile solo se all'inizio del suo turno esce 5 o 6 su un d6."],
  ["Righello", "📏 Misura le distanze sulla mappa in caselle, metri e piedi. Tutti vedono la tua misura."],
  ["Riposo breve e lungo", "Breve (1 ora): si spendono dadi vita per recuperare PF. Lungo (8 ore): si recuperano tutti i PF e gli slot incantesimo."],
  ["Sala d'attesa", "Chi entra con il codice invito aspetta che il DM lo ammetta. Il DM sceglie sulla mappa dove comparirà il suo personaggio e poi lo fa entrare."],
  ["Scena", "Un momento preparato dal DM: mappa, musica, testo da leggere ad alta voce, immagine da mostrare. Si avvia con un clic."],
  ["Scheda del personaggio", "Tutti i dati del tuo personaggio: caratteristiche, PF, CA, abilità, attacchi, incantesimi, equipaggiamento. Cliccando sui numeri si tirano i dadi."],
  ["Scurovisione", "Capacità di vedere al buio (in bianco e nero) entro una certa distanza, di solito 18 m."],
  ["Sessione", "Una serata di gioco. Più sessioni formano una campagna."],
  ["SRD", "System Reference Document 5.1: la parte delle regole di D&D 5ª edizione pubblicata liberamente (licenza CC BY 4.0). I mostri pronti di questa app vengono da lì."],
  ["Tattiche di branco", "Il mostro ha vantaggio negli attacchi se un suo alleato è vicino (entro 1,5 m) al bersaglio."],
  ["Tiro per colpire", "1d20 + modificatore + competenza: se il risultato è uguale o superiore alla CA del bersaglio, l'attacco colpisce e si tirano i danni."],
  ["Tiro salvezza (TS)", "Un tiro per resistere a qualcosa (veleno, incantesimo, trappola): 1d20 + modificatore della caratteristica indicata (+ competenza se competente) contro una CD."],
  ["Tiro segreto", "Un tiro che vedono solo chi lo fa e il DM (🔒). Utile per Percezione o Intuizione, quando il giocatore non deve sapere se è andata bene."],
  ["Token (segnalino)", "La pedina rotonda sulla mappa che rappresenta un personaggio, un mostro o un oggetto (porta, trappola, tesoro, nota)."],
  ["Vantaggio e svantaggio", "Con vantaggio tiri due d20 e tieni il più alto; con svantaggio il più basso. Se hai entrambi si annullano."],
  // ---- l'app
  ["Codice invito", "Il codice (o il link) che il DM manda agli amici per entrare nella partita, anche su WhatsApp."],
  ["Esporta / importa", "Salva tutta la campagna in un file (backup) e, se serve, ricreala da quel file in una nuova partita."],
  ["Griglia quadrata o esagonale", "Il reticolo sulla mappa. Con i quadretti una diagonale vale 1 casella (regola base) o alterna 1 e 2 (regola 5-10-5)."],
  ["Opzioni", "Scegli lo stile dell'interfaccia (medievale, classico, moderno), chiaro o scuro, e lo stile e il colore dei dadi. Valgono solo sul tuo dispositivo."],
  ["Tutto schermo", "Il pulsante con il riquadro sulla mappa (o il tasto F) la allarga a tutto lo schermo; Esc o F per tornare."],
];

const START = [
  ["Per i giocatori", [
    "Apri il link ricevuto dal DM, scrivi il tuo nome e scegli o crea il personaggio. Aspetta che il DM ti faccia entrare.",
    "Premi «Collega audio» e consenti il microfono. Per parlare tieni premuto il grande pulsante in basso (o SPAZIO sul computer).",
    "Sulla mappa trascina il tuo personaggio: le caselle verdi mostrano fin dove puoi arrivare. In combattimento ti muovi solo nel tuo turno.",
    "Per tirare i dadi usa la scheda «Dadi» a destra, oppure clicca sui numeri della tua «Scheda». Il risultato lo decide il server ed è uguale per tutti.",
    "Se il DM mette musica e non la senti, tocca il pulsante dorato «tocca qui per sentirli»: il browser fa partire l'audio solo dopo un tuo tocco. Su iPhone controlla anche il volume.",
  ]],
  ["Per il Dungeon Master", [
    "Crea la partita e manda il link invito. Quando qualcuno chiede di entrare, premi «Ammetti e posiziona» e tocca sulla mappa la casella dove comparirà.",
    "Prepara la mappa: caricala dal titolo della mappa, poi segna gli ostacoli con 🧱 (muri e zone non calpestabili) e copri con la nebbia ciò che non si vede.",
    "Strumenti DM → Mostri e PNG → «Aggiungi dal manuale (SRD)» per avere mostri pronti con statistiche e illustrazione; «Sulla mappa» li piazza nascosti.",
    "Solo tu puoi muovere mostri, PNG e oggetti. I giocatori muovono solo il proprio personaggio, entro la sua velocità.",
    "Combattimento: «Inizia combattimento», fai tirare l'iniziativa, poi «Turno successivo ▶». Il personaggio di turno recupera tutto il movimento.",
  ]],
];

export function openGuide(tab = "start") {
  let cur = tab;
  const box = h("div", { class: "guide" });
  const render = (q = "") => {
    const tabs = h("div", { class: "dmt-tabs" },
      [["start", "Come si gioca"], ["glossary", "Glossario dei termini"]].map(([id, l]) => h("button", { class: `dmt-tab ${cur === id ? "active" : ""}`, onclick: () => { cur = id; render(); } }, l)));
    let body;
    if (cur === "start") {
      body = h("div", {}, START.map(([title, steps]) => h("section", {}, h("h3", {}, title), h("ol", { class: "guide-steps" }, steps.map((s) => h("li", {}, s))))));
    } else {
      const search = h("input", { type: "search", placeholder: "Cerca un termine (es. CA, vantaggio, PTT)…", value: q, oninput: (e) => { list.replaceChildren(...items(e.target.value)); } });
      const items = (qq) => {
        const n = qq.trim().toLowerCase();
        const rows = GLOSSARY.filter(([t, d]) => !n || t.toLowerCase().includes(n) || d.toLowerCase().includes(n))
          .sort((a, b) => a[0].localeCompare(b[0], "it"));
        return rows.length ? rows.map(([t, d]) => h("div", { class: "gloss-item" }, h("dt", {}, t), h("dd", {}, d))) : [h("p", { class: "muted" }, "Nessun termine trovato.")];
      };
      const list = h("dl", { class: "gloss" }, ...items(q));
      body = h("div", {}, search, list);
      setTimeout(() => search.focus(), 30);
    }
    box.replaceChildren(tabs, body);
  };
  render();
  modal({ title: "Guida", body: box, wide: true, actions: [{ label: "Chiudi", primary: true }] });
}
