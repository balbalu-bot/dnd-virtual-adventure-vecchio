// =====================================================================
//  Mostri pronti: statistiche dal System Reference Document 5.1 (CC BY 4.0,
//  Wizards of the Coast) tradotte in italiano, e illustrazioni originali
//  create per questo progetto (cartella img/monsters).
// =====================================================================

const A = (id) => `img/monsters/${id}.svg`;

// abil: For Des Cos Int Sag Car
export const SRD_MONSTERS = [
  { id: "popolano", name: "Popolano", kind: "npc", size: 1, cr: "0", hp: 4, hpDice: "1d8", ac: 10, speed: "9 m", abil: [10, 10, 10, 10, 10, 10],
    attacks: "Randello: +2 per colpire, portata 1,5 m, 1d4 contundenti.", notes: "Un abitante qualsiasi: contadino, oste, mercante." },
  { id: "guardia", name: "Guardia", kind: "npc", size: 1, cr: "1/8", hp: 11, hpDice: "2d8+2", ac: 16, speed: "9 m", abil: [13, 12, 12, 10, 11, 10],
    attacks: "Lancia: +3 per colpire, portata 1,5 m o gittata 6/18 m, 1d6+1 perforanti (1d8+1 a due mani).", notes: "Corazza di maglia e scudo. Percezione passiva 12." },
  { id: "bandito", name: "Bandito", kind: "monster", size: 1, cr: "1/8", hp: 11, hpDice: "2d8+2", ac: 12, speed: "9 m", abil: [11, 12, 12, 10, 10, 10],
    attacks: "Scimitarra: +3 per colpire, 1d6+1 taglienti.\nBalestra leggera: +3 per colpire, gittata 24/96 m, 1d8+1 perforanti.", notes: "Armatura di cuoio." },
  { id: "cultista", name: "Cultista", kind: "monster", size: 1, cr: "1/8", hp: 9, hpDice: "2d8", ac: 12, speed: "9 m", abil: [11, 12, 10, 10, 11, 10],
    attacks: "Scimitarra: +3 per colpire, 1d6+1 taglienti.", notes: "Devozione oscura: vantaggio ai tiri salvezza contro charme e paura." },
  { id: "kobold", name: "Coboldo", kind: "monster", size: 1, cr: "1/8", hp: 5, hpDice: "2d6-2", ac: 12, speed: "9 m", abil: [7, 15, 9, 8, 7, 8],
    attacks: "Pugnale: +4 per colpire, 1d4+2 perforanti.\nFionda: +4 per colpire, gittata 9/36 m, 1d4+2 contundenti.",
    notes: "Tattiche di branco: vantaggio se un alleato è entro 1,5 m dal bersaglio.\nSensibilità alla luce del sole: svantaggio agli attacchi e a Percezione (vista) alla luce del sole. Scurovisione 18 m." },
  { id: "ratto-gigante", name: "Ratto gigante", kind: "monster", size: 1, cr: "1/8", hp: 7, hpDice: "2d6", ac: 12, speed: "9 m", abil: [7, 15, 11, 2, 10, 4],
    attacks: "Morso: +4 per colpire, 1d4+2 perforanti.", notes: "Tattiche di branco. Olfatto acuto. Scurovisione 18 m." },
  { id: "goblin", name: "Goblin", kind: "monster", size: 1, cr: "1/4", hp: 7, hpDice: "2d6", ac: 15, speed: "9 m", abil: [8, 14, 10, 10, 8, 8],
    attacks: "Scimitarra: +4 per colpire, 1d6+2 taglienti.\nArco corto: +4 per colpire, gittata 24/96 m, 1d6+2 perforanti.",
    notes: "Fuga agile: può Disimpegnarsi o Nascondersi come azione bonus a ogni turno.\nFurtività +6. Scurovisione 18 m." },
  { id: "lupo", name: "Lupo", kind: "monster", size: 1, cr: "1/4", hp: 11, hpDice: "2d8+2", ac: 13, speed: "12 m", abil: [12, 15, 12, 3, 12, 6],
    attacks: "Morso: +4 per colpire, 2d4+2 perforanti. Se è una creatura: tiro salvezza su Forza CD 11 o cade prona.",
    notes: "Tattiche di branco. Udito e olfatto acuti (vantaggio a Percezione)." },
  { id: "scheletro", name: "Scheletro", kind: "monster", size: 1, cr: "1/4", hp: 13, hpDice: "2d8+4", ac: 13, speed: "9 m", abil: [10, 14, 15, 6, 8, 5],
    attacks: "Spada corta: +4 per colpire, 1d6+2 perforanti.\nArco corto: +4 per colpire, gittata 24/96 m, 1d6+2 perforanti.",
    notes: "Vulnerabile ai danni contundenti. Immune a veleno e sfinimento. Scurovisione 18 m." },
  { id: "zombi", name: "Zombi", kind: "monster", size: 1, cr: "1/4", hp: 22, hpDice: "3d8+9", ac: 8, speed: "6 m", abil: [13, 6, 16, 3, 6, 5],
    attacks: "Schianto: +3 per colpire, 1d6+1 contundenti.",
    notes: "Tempra da non morto: se scende a 0 PF (non per danni radiosi o critico), TS Costituzione CD 5 + danni subiti: se riesce resta a 1 PF. Immune al veleno." },
  { id: "pipistrello-gigante", name: "Pipistrello gigante", kind: "monster", size: 2, cr: "1/4", hp: 22, hpDice: "4d10", ac: 13, speed: "3 m, volare 18 m", abil: [15, 16, 11, 2, 12, 6],
    attacks: "Morso: +4 per colpire, 1d6+2 perforanti.", notes: "Ecolocazione (vista cieca 18 m, non se assordato). Udito acuto." },
  { id: "orco", name: "Orco", kind: "monster", size: 1, cr: "1/2", hp: 15, hpDice: "2d8+6", ac: 13, speed: "9 m", abil: [16, 12, 16, 7, 11, 10],
    attacks: "Ascia bipenne: +5 per colpire, 1d12+3 taglienti.\nGiavellotto: +5 per colpire, portata 1,5 m o gittata 9/36 m, 1d6+3 perforanti.",
    notes: "Aggressivo: come azione bonus può muoversi fino alla sua velocità verso un nemico che vede. Scurovisione 18 m." },
  { id: "hobgoblin", name: "Hobgoblin", kind: "monster", size: 1, cr: "1/2", hp: 11, hpDice: "2d8+2", ac: 18, speed: "9 m", abil: [13, 12, 12, 10, 10, 9],
    attacks: "Spada lunga: +3 per colpire, 1d8+1 taglienti (1d10+1 a due mani).\nArco lungo: +3 per colpire, gittata 45/180 m, 1d8+1 perforanti.",
    notes: "Vantaggio marziale: una volta per turno +2d6 danni se un alleato è entro 1,5 m dal bersaglio. Scurovisione 18 m." },
  { id: "gnoll", name: "Gnoll", kind: "monster", size: 1, cr: "1/2", hp: 22, hpDice: "5d8", ac: 15, speed: "9 m", abil: [14, 12, 11, 6, 10, 7],
    attacks: "Morso: +4 per colpire, 1d4+2 perforanti.\nLancia: +4 per colpire, 1d6+2 perforanti.\nArco lungo: +3 per colpire, gittata 45/180 m, 1d8+1 perforanti.",
    notes: "Furia: quando porta una creatura a 0 PF in mischia, come azione bonus si muove di metà velocità e fa un attacco di morso." },
  { id: "melma-grigia", name: "Melma grigia", kind: "monster", size: 1, cr: "1/2", hp: 22, hpDice: "3d8+9", ac: 8, speed: "3 m, scalare 3 m", abil: [12, 6, 16, 1, 6, 2],
    attacks: "Pseudopodo: +3 per colpire, 1d6+1 contundenti + 2d6 acido; l'armatura metallica non magica del bersaglio perde 1 di CA.",
    notes: "Amorfa. Corrode il metallo. Aspetto falso: immobile sembra una pozza o una roccia bagnata. Resistente ad acido, freddo e fuoco." },
  { id: "bugbear", name: "Bugbear", kind: "monster", size: 1, cr: "1", hp: 27, hpDice: "5d8+5", ac: 16, speed: "9 m", abil: [15, 14, 13, 8, 11, 9],
    attacks: "Morning star: +4 per colpire, 2d8+2 perforanti.\nGiavellotto: +4 per colpire, portata 1,5 m o gittata 9/36 m, 2d6+2 (1d6+2 a distanza) perforanti.",
    notes: "Bruto: un'arma da mischia infligge un dado in più. Attacco a sorpresa: +2d6 danni a una creatura sorpresa nel primo round. Furtività +6." },
  { id: "lupo-crudele", name: "Lupo crudele", kind: "monster", size: 2, cr: "1", hp: 37, hpDice: "5d10+10", ac: 14, speed: "15 m", abil: [17, 15, 15, 3, 12, 7],
    attacks: "Morso: +5 per colpire, 2d6+3 perforanti. Se è una creatura: TS Forza CD 13 o cade prona.", notes: "Tattiche di branco. Udito e olfatto acuti." },
  { id: "ragno-gigante", name: "Ragno gigante", kind: "monster", size: 2, cr: "1", hp: 26, hpDice: "4d10+4", ac: 14, speed: "9 m, scalare 9 m", abil: [14, 16, 12, 2, 11, 4],
    attacks: "Morso: +5 per colpire, 1d8+3 perforanti + 2d8 veleno (TS Costituzione CD 11 dimezza).\nRagnatela (ricarica 5–6): +5 per colpire, gittata 9/18 m, il bersaglio è trattenuto (CD 12 per liberarsi).",
    notes: "Movimento del ragno, senso della ragnatela, cammina sulle ragnatele. Vista cieca 3 m, scurovisione 18 m." },
  { id: "ogre", name: "Ogre", kind: "monster", size: 2, cr: "2", hp: 59, hpDice: "7d10+21", ac: 11, speed: "12 m", abil: [19, 8, 16, 5, 7, 7],
    attacks: "Randello pesante: +6 per colpire, 2d8+4 contundenti.\nGiavellotto: +6 per colpire, portata 1,5 m o gittata 9/36 m, 2d6+4 perforanti.", notes: "Scurovisione 18 m." },
  { id: "orsogufo", name: "Orsogufo", kind: "monster", size: 2, cr: "3", hp: 59, hpDice: "7d10+21", ac: 13, speed: "12 m", abil: [20, 12, 17, 3, 12, 7],
    attacks: "Multiattacco: becco e artigli.\nBecco: +7 per colpire, 1d10+5 perforanti.\nArtigli: +7 per colpire, 2d8+5 taglienti.", notes: "Vista e olfatto acuti. Scurovisione 18 m." },
  { id: "fantasma", name: "Fantasma", kind: "monster", size: 1, cr: "4", hp: 45, hpDice: "10d8", ac: 11, speed: "0 m, volare 12 m (fluttua)", abil: [7, 13, 10, 10, 12, 17],
    attacks: "Tocco avvizzente: +5 per colpire, 4d6+3 necrotici.\nAspetto terrificante: chi lo vede entro 18 m TS Saggezza CD 13 o spaventato per 1 minuto.\nPossessione (ricarica 6): un umanoide entro 1,5 m TS Carisma CD 13 o viene posseduto.",
    notes: "Incorporeo: attraversa creature e oggetti. Vista eterea. Resiste a molti danni non magici; immune a freddo, necrotico e veleno." },
  { id: "troll", name: "Troll", kind: "monster", size: 2, cr: "5", hp: 84, hpDice: "8d10+40", ac: 15, speed: "9 m", abil: [18, 13, 20, 7, 9, 7],
    attacks: "Multiattacco: un morso e due artigli.\nMorso: +7 per colpire, 1d6+4 perforanti.\nArtiglio: +7 per colpire, 2d6+4 taglienti.",
    notes: "Rigenerazione: recupera 10 PF all'inizio del suo turno, se non ha subito danni da acido o fuoco; muore solo se inizia il turno a 0 PF senza rigenerare. Olfatto acuto. Scurovisione 18 m." },
  { id: "drago-rosso", name: "Drago rosso giovane", kind: "monster", size: 2, cr: "10", hp: 178, hpDice: "17d10+85", ac: 18, speed: "12 m, scalare 12 m, volare 24 m", abil: [23, 10, 21, 14, 11, 19],
    attacks: "Multiattacco: un morso e due artigli.\nMorso: +10 per colpire, portata 3 m, 2d10+6 perforanti + 1d6 fuoco.\nArtiglio: +10 per colpire, 2d6+6 taglienti.\nSoffio di fuoco (ricarica 5–6): cono di 9 m, TS Destrezza CD 17, 16d6 fuoco (metà se riesce).",
    notes: "Immune al fuoco. Vista cieca 9 m, scurovisione 36 m. Percezione +8." },
];

export const MONSTER_ART = [
  ...SRD_MONSTERS.map((m) => ({ id: m.id, name: m.name, src: A(m.id) })),
];

const mod = (v) => Math.floor((v - 10) / 2);
const sg = (n) => (n >= 0 ? "+" : "") + n;

/** Riga del bestiario pronta da salvare */
export function srdToBestiary(m) {
  const [fo, de, co, in_, sa, ca] = m.abil;
  const ab = `FOR ${fo} (${sg(mod(fo))}) · DES ${de} (${sg(mod(de))}) · COS ${co} (${sg(mod(co))}) · INT ${in_} (${sg(mod(in_))}) · SAG ${sa} (${sg(mod(sa))}) · CAR ${ca} (${sg(mod(ca))})`;
  return {
    name: m.name, kind: m.kind, size: m.size, color: m.kind === "npc" ? "#1565c0" : "#b3261e", image: A(m.id),
    hp: m.hp, ac: m.ac, init_bonus: mod(de), speed: m.speed, attacks: m.attacks,
    notes: `Grado di sfida ${m.cr} · PF ${m.hp} (${m.hpDice})\n${ab}\n\n${m.notes}\n\nFonte: SRD 5.1 (CC BY 4.0).`,
  };
}
