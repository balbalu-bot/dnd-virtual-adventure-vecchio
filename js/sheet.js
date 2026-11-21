// =====================================================================
//  Scheda personaggio D&D 5e (termini di gioco dal SRD 5.1, CC BY 4.0)
//  Salvataggio automatico; tiri inviati al server dei dadi.
// =====================================================================
import { sb, must } from "./supabase.js";
import { store, isDM, on } from "./store.js";
import { h, icon, toast, modal, confirmDialog, resizeImage, avatar, loadPref, savePref } from "./ui.js";
import { rollFor } from "./dice.js";

export const ABIL = [["str", "FOR", "Forza"], ["dex", "DES", "Destrezza"], ["con", "COS", "Costituzione"], ["int", "INT", "Intelligenza"], ["wis", "SAG", "Saggezza"], ["cha", "CAR", "Carisma"]];
const ABIL_NAME = Object.fromEntries(ABIL.map(([k, , n]) => [k, n]));
const ABIL_SHORT = Object.fromEntries(ABIL.map(([k, s]) => [k, s]));
export const SKILLS = [
  ["acrobatics", "Acrobazia", "dex"], ["animal", "Addestrare Animali", "wis"], ["arcana", "Arcano", "int"],
  ["athletics", "Atletica", "str"], ["stealth", "Furtività", "dex"], ["investigation", "Indagare", "int"],
  ["deception", "Inganno", "cha"], ["intimidation", "Intimidire", "cha"], ["performance", "Intrattenere", "cha"],
  ["insight", "Intuizione", "wis"], ["medicine", "Medicina", "wis"], ["nature", "Natura", "int"],
  ["perception", "Percezione", "wis"], ["persuasion", "Persuasione", "cha"], ["sleight", "Rapidità di Mano", "dex"],
  ["religion", "Religione", "int"], ["survival", "Sopravvivenza", "wis"], ["history", "Storia", "int"],
];
export const CONDITIONS = ["Accecato", "Affascinato", "Afferrato", "Assordato", "Avvelenato", "Incapacitato", "Invisibile",
  "Paralizzato", "Pietrificato", "Privo di sensi", "Prono", "Spaventato", "Stordito", "Trattenuto"];
const DMG_TYPES = ["", "contundente", "perforante", "tagliente", "acido", "freddo", "fuoco", "forza", "fulmine", "necrotico", "psichico", "radiante", "tuono", "veleno"];

export function defaults(d = {}) {
  const base = {
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    saves: {}, skills: {}, ac: 10, speed: "9 m", init_bonus: 0,
    hp: 10, hp_max: 10, temp_hp: 0, hit_dice: "1d8", hit_dice_left: 1, death: { ok: 0, ko: 0 },
    attacks: [], spell_ability: "", slots: {}, spells: [],
    coins: { mr: 0, ma: 0, me: 0, mo: 0, mp: 0 }, items: [],
    conditions: [], exhaustion: 0, xp: 0, alignment: "", inspiration: false,
    languages: "", proficiencies: "", features: "", journal: "",
  };
  const out = { ...base, ...(d || {}) };
  out.abilities = { ...base.abilities, ...(d?.abilities || {}) };
  out.coins = { ...base.coins, ...(d?.coins || {}) };
  out.death = { ...base.death, ...(d?.death || {}) };
  return out;
}
export const mod = (score) => Math.floor((Number(score || 10) - 10) / 2);
export const profBonus = (level) => 2 + Math.floor((Math.max(1, Math.min(20, Number(level) || 1)) - 1) / 4);
const fmt = (n) => (n >= 0 ? "+" + n : String(n));
const uid = () => Math.random().toString(36).slice(2, 9);

let root, char = null, data = null, saveTimer = null, lastLocalEdit = 0, viewingId = null, unsub = [];
const state = { adv: "" };

// ================================================================== montaggio
export function mountSheet(container) {
  root = h("div", { class: "sheet" });
  container.append(root);
  unsub = [on("members:changed", () => { if (!char) openDefault(); else renderPicker(); })];
  openDefault();
  return root;
}
export function unmountSheet() { unsub.forEach((u) => u()); unsub = []; flushSave(); root?.remove(); root = null; char = null; }

function openDefault() {
  const mine = store.me?.character_id;
  const want = viewingId || mine || (isDM() ? [...store.members.values()].find((m) => m.character_id && m.status === "active")?.character_id : null);
  if (want) openSheet(want); else renderEmpty();
}

export async function openSheet(id) {
  flushSave();
  viewingId = id;
  try {
    const row = await must(sb.from("characters").select("*").eq("id", id).maybeSingle());
    if (!row) { renderEmpty("Scheda non disponibile."); return; }
    char = row; data = defaults(row.data);
    render();
  } catch (e) { renderEmpty(e.message); }
}

/** Aggiornamento in tempo reale (es. il DM cambia i PF) */
export function onCharacterUpdate(row) {
  if (!row || row.id !== char?.id) return;
  if (Date.now() - lastLocalEdit < 2500) return; // stai scrivendo: non sovrascrivere
  char = row; data = defaults(row.data);
  render();
}

export function currentCharacter() { return char ? { ...char, data } : null; }
export function characterData(row) { return defaults(row?.data); }

function renderEmpty(msg) {
  if (!root) return;
  char = null;
  root.replaceChildren(
    renderPicker(true),
    h("div", { class: "sheet-empty" },
      h("p", {}, msg || (isDM() ? "Nessun giocatore ha ancora collegato un personaggio." : "Non hai ancora un personaggio collegato a questa partita.")),
      !isDM() ? h("p", { class: "muted small" }, "Crealo dalla schermata iniziale («Nuovo personaggio») e collegalo dalle Impostazioni ⚙ della partita, oppure qui:") : null,
      !isDM() ? h("button", { class: "btn btn-primary", html: `${icon("plus")} Crea e collega un personaggio`, onclick: createAndLink }) : null));
}

async function createAndLink() {
  try {
    const name = prompt("Nome del personaggio:");
    if (!name?.trim()) return;
    const row = await must(sb.from("characters").insert({ name: name.trim(), owner_id: store.user.id, data: defaults() }).select().single());
    await must(sb.from("members").update({ character_id: row.id, character_name: row.name }).eq("game_id", store.game.id).eq("user_id", store.user.id));
    store.me.character_id = row.id;
    openSheet(row.id);
  } catch (e) { toast(e.message, "error"); }
}

function renderPicker(force) {
  const linked = [...store.members.values()].filter((m) => m.status === "active" && m.character_id);
  if (!isDM() && !force) return null;
  const sel = h("select", { class: "sheet-picker", onchange: (e) => openSheet(e.target.value) },
    linked.length ? null : h("option", { value: "" }, "— nessun personaggio —"),
    linked.map((m) => h("option", { value: m.character_id, selected: m.character_id === char?.id }, `${m.character_name || "?"} (${m.display_name})`)));
  return isDM() && linked.length ? h("div", { class: "sheet-picker-row" }, h("span", { class: "muted small" }, "Scheda di:"), sel) : null;
}

// ================================================================== salvataggio
function canEdit() { return !!char && (char.owner_id === store.user.id || isDM()); }

function changed(rerender = false) {
  lastLocalEdit = Date.now();
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 700);
  setStatus("Modifiche non salvate…");
  if (rerender) render();
  else refreshDerived();
}
function flushSave() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; save(); } }

async function save() {
  saveTimer = null;
  if (!char || !canEdit()) return;
  const patch = { name: char.name, species: char.species, class: char.class, level: char.level, background: char.background, portrait: char.portrait, data };
  try {
    const row = await must(sb.from("characters").update(patch).eq("id", char.id).select().single());
    char = { ...char, updated_at: row.updated_at };
    setStatus("Salvato ✓");
    if (store.me?.character_id === char.id && store.me.character_name !== char.name) {
      sb.from("members").update({ character_name: char.name }).eq("game_id", store.game.id).eq("user_id", store.user.id).then(() => {});
    }
    document.dispatchEvent(new CustomEvent("sheet-saved", { detail: { id: char.id, data } }));
  } catch (e) { setStatus("Errore di salvataggio"); toast("Scheda non salvata: " + e.message, "error"); }
}
function setStatus(t) { const el = root?.querySelector(".sheet-status"); if (el) el.textContent = t; }

// ================================================================== tiri
function roll(expr, label, type) {
  const name = char?.name || "";
  return rollFor(expr, { label: `${name}: ${label}`, type, adv: state.adv });
}
const d20 = (bonus) => `1d20${bonus ? (bonus > 0 ? "+" + bonus : bonus) : ""}`;

function saveBonus(k) { return mod(data.abilities[k]) + (data.saves[k] ? profBonus(char.level) : 0); }
function skillBonus(sk) {
  const [key, , ab] = sk;
  const lvl = Number(data.skills[key] || 0);
  return mod(data.abilities[ab]) + lvl * profBonus(char.level);
}
function initBonus() { return mod(data.abilities.dex) + (Number(data.init_bonus) || 0); }
function attackBonus(a) {
  const ab = a.ability === "spell" ? data.spell_ability : a.ability;
  return (ab && ab !== "none" ? mod(data.abilities[ab]) : 0) + (a.proficient ? profBonus(char.level) : 0) + (Number(a.bonus) || 0);
}
function damageExpr(a, crit) {
  let dice = String(a.damage || "").replace(/\s/g, "") || "1d4";
  if (crit) dice = dice.replace(/(\d*)d(\d+)/g, (_, n, s) => `${(Number(n) || 1) * 2}d${s}`);
  const ab = a.ability === "spell" ? data.spell_ability : a.ability;
  const m = a.add_mod && ab && ab !== "none" ? mod(data.abilities[ab]) : 0;
  return dice + (m ? (m > 0 ? "+" + m : m) : "");
}
export async function rollInitiativeFor(charRow) {
  const d = defaults(charRow.data);
  const b = mod(d.abilities.dex) + (Number(d.init_bonus) || 0);
  return rollFor(d20(b), { label: `${charRow.name}: Iniziativa`, type: "initiative", adv: state.adv });
}

// ================================================================== interfaccia
function num(obj, key, { min = -99, max = 999, rerender = false, cls = "", k } = {}) {
  return h("input", {
    type: "number", class: `n ${cls}`, value: obj[key] ?? 0, min, max, disabled: !canEdit(), dataset: { k: k || key },
    oninput: (e) => { obj[key] = e.target.value === "" ? 0 : Math.max(min, Math.min(max, Number(e.target.value))); changed(); },
    onchange: rerender ? () => setTimeout(render, 0) : null,
  });
}
function txt(obj, key, { placeholder = "", max = 200, area = false, rows = 3, rerender = false } = {}) {
  const attrs = { value: obj[key] ?? "", maxlength: max, placeholder, disabled: !canEdit(), oninput: (e) => { obj[key] = e.target.value; changed(rerender); } };
  if (area) { const t = h("textarea", { ...attrs, rows }); t.value = obj[key] ?? ""; return t; }
  return h("input", attrs);
}
function rollBtn(label, onclick, title) { return h("button", { class: "rb", title: title || "Tira", onclick }, label); }
function section(title, ic, open, ...body) {
  const key = "sheetSec:" + title;
  const d = h("details", { class: "sheet-sec", open: loadPref(key, open) }, h("summary", { html: `${icon(ic)} ${title}` }), ...body);
  d.addEventListener("toggle", () => savePref(key, d.open));
  return d;
}

function render() {
  if (!root) return;
  const focusK = document.activeElement?.closest?.(".sheet") ? document.activeElement.dataset?.k : null;
  renderInner();
  if (focusK) root.querySelector(`[data-k="${focusK}"]`)?.focus();
}

function renderInner() {
  if (!char) { renderEmpty(); return; }
  const ed = canEdit();
  const pb = profBonus(char.level);

  // --- intestazione
  const portraitIn = h("input", { type: "file", accept: "image/*", class: "visually-hidden", id: "sheet-portrait",
    onchange: async () => { if (portraitIn.files[0]) { char.portrait = await resizeImage(portraitIn.files[0]); changed(true); } } });
  const head = h("div", { class: "sheet-head" },
    h("label", { for: ed ? "sheet-portrait" : "", class: "sheet-portrait", title: ed ? "Cambia ritratto" : "" }, avatar(char.name, char.portrait, "avatar-lg")), portraitIn,
    h("div", { class: "sheet-id" },
      h("input", { class: "sheet-name", value: char.name, maxlength: 60, disabled: !ed, oninput: (e) => { char.name = e.target.value; changed(); } }),
      h("div", { class: "sheet-id-row" },
        h("input", { value: char.species || "", placeholder: "Specie", maxlength: 60, disabled: !ed, oninput: (e) => { char.species = e.target.value; changed(); } }),
        h("input", { value: char.class || "", placeholder: "Classe", maxlength: 60, disabled: !ed, oninput: (e) => { char.class = e.target.value; changed(); } }),
        h("label", { class: "inline" }, "Liv.", h("input", { type: "number", class: "n", min: 1, max: 20, value: char.level || 1, disabled: !ed, dataset: { k: "level" }, oninput: (e) => { char.level = Math.max(1, Math.min(20, Number(e.target.value) || 1)); changed(); }, onchange: () => setTimeout(render, 0) }))),
      h("div", { class: "sheet-id-row" },
        h("input", { value: char.background || "", placeholder: "Background", maxlength: 60, disabled: !ed, oninput: (e) => { char.background = e.target.value; changed(); } }),
        txt(data, "alignment", { placeholder: "Allineamento", max: 40 }),
        h("label", { class: "inline", title: "Punti esperienza" }, "PE", num(data, "xp", { min: 0, max: 999999 })))));

  // --- barra tiri
  const advSel = h("div", { class: "seg seg-sm" }, [["", "Normale"], ["adv", "Vantaggio"], ["dis", "Svantaggio"]].map(([v, l]) =>
    h("button", { class: state.adv === v ? "active" : "", onclick: () => { state.adv = v; render(); } }, l)));
  const top = h("div", { class: "sheet-topbar" },
    h("span", { class: "pb-chip", title: "Bonus di competenza" }, `Competenza ${fmt(pb)}`),
    h("label", { class: "check small", title: "Ispirazione" }, h("input", { type: "checkbox", checked: !!data.inspiration, disabled: !ed, onchange: (e) => { data.inspiration = e.target.checked; changed(); } }), " Ispirazione"),
    advSel,
    h("span", { class: "sheet-status muted small" }, ed ? "Salvato ✓" : "Sola lettura"));

  // --- punti ferita e combattimento
  const dmgIn = h("input", { type: "number", class: "n", min: 0, max: 999, placeholder: "0" });
  const hpBox = h("div", { class: "hp-box" },
    h("div", { class: "hp-main" },
      h("div", { class: "hp-label" }, "Punti ferita"),
      h("div", { class: "hp-nums" }, num(data, "hp", { min: -99, max: 999, cls: "hp-cur" }), h("span", {}, "/"), num(data, "hp_max", { min: 0, max: 999 })),
      h("div", { class: "hp-temp" }, "Temporanei ", num(data, "temp_hp", { min: 0, max: 999 }))),
    ed ? h("div", { class: "hp-actions" }, dmgIn,
      h("button", { class: "btn btn-sm btn-danger", onclick: () => applyHp(-(Number(dmgIn.value) || 0)) }, "Danno"),
      h("button", { class: "btn btn-sm", onclick: () => applyHp(Number(dmgIn.value) || 0) }, "Cura")) : null);

  const combat = h("div", { class: "combat-grid" },
    stat("CA", num(data, "ac", { min: 0, max: 40 })),
    stat("Iniziativa", h("span", { class: "big" }, fmt(initBonus())), rollBtn("🎲", () => roll(d20(initBonus()), "Iniziativa", "initiative").then(afterInitiative), "Tira iniziativa"),
      h("label", { class: "inline tiny", title: "Bonus extra all'iniziativa" }, "+", num(data, "init_bonus", { min: -10, max: 20, rerender: true }))),
    stat("Velocità", txt(data, "speed", { max: 20 })),
    stat("Dadi Vita", txt(data, "hit_dice", { max: 20 }), h("label", { class: "inline tiny" }, "rimasti", num(data, "hit_dice_left", { min: 0, max: 40 }))),
    stat("TS contro morte", h("div", { class: "death" },
      h("span", {}, "✔"), ...[1, 2, 3].map((i) => h("input", { type: "checkbox", checked: data.death.ok >= i, disabled: !ed, onchange: (e) => { data.death.ok = e.target.checked ? i : i - 1; changed(true); } })),
      h("span", {}, "✖"), ...[1, 2, 3].map((i) => h("input", { type: "checkbox", checked: data.death.ko >= i, disabled: !ed, onchange: (e) => { data.death.ko = e.target.checked ? i : i - 1; changed(true); } }))),
      rollBtn("🎲", () => roll("1d20", "Tiro salvezza contro la morte", "save"), "Tiro salvezza contro la morte")));

  // --- caratteristiche
  const abil = h("div", { class: "abil-grid" }, ABIL.map(([k, short, name]) => h("div", { class: "abil" },
    h("div", { class: "abil-name", title: name }, short),
    h("button", { class: "abil-mod", title: `Prova di ${name}`, onclick: () => roll(d20(mod(data.abilities[k])), `Prova di ${name}`, "check") }, fmt(mod(data.abilities[k]))),
    num(data.abilities, k, { min: 1, max: 30, rerender: true, cls: "abil-score", k: "ab-" + k }))));

  // --- tiri salvezza
  const saves = h("div", { class: "list-2" }, ABIL.map(([k, , name]) => h("div", { class: "row-roll" },
    h("input", { type: "checkbox", title: "Competente", checked: !!data.saves[k], disabled: !ed, onchange: (e) => { data.saves[k] = e.target.checked; changed(true); } }),
    h("span", { class: "rr-name" }, name),
    rollBtn(fmt(saveBonus(k)), () => roll(d20(saveBonus(k)), `Tiro salvezza su ${name}`, "save")))));

  // --- abilità
  const skills = h("div", { class: "list-2" }, SKILLS.map((sk) => {
    const lvl = Number(data.skills[sk[0]] || 0);
    return h("div", { class: "row-roll" },
      h("button", {
        class: `prof-dot l${lvl}`, title: ["Nessuna competenza", "Competente", "Maestria (competenza doppia)"][lvl], disabled: !ed,
        onclick: () => { data.skills[sk[0]] = (lvl + 1) % 3; changed(true); },
      }),
      h("span", { class: "rr-name" }, sk[1], h("small", { class: "muted" }, " " + ABIL_SHORT[sk[2]])),
      rollBtn(fmt(skillBonus(sk)), () => roll(d20(skillBonus(sk)), sk[1], "check")));
  }));
  const passive = 10 + skillBonus(SKILLS.find((s) => s[0] === "perception"));

  // --- attacchi
  const attacks = h("div", { class: "attacks" },
    data.attacks.map((a) => attackRow(a)),
    ed ? h("button", { class: "btn btn-sm", html: `${icon("plus")} Aggiungi attacco`, onclick: () => { data.attacks.push({ id: uid(), name: "Nuova arma", ability: "str", proficient: true, bonus: 0, damage: "1d8", add_mod: true, dtype: "tagliente" }); changed(true); } }) : null);

  // --- incantesimi
  const spellMod = data.spell_ability ? mod(data.abilities[data.spell_ability]) : null;
  const spells = h("div", {},
    h("div", { class: "spell-head" },
      h("label", { class: "inline" }, "Caratteristica",
        h("select", { disabled: !ed, onchange: (e) => { data.spell_ability = e.target.value; changed(true); } },
          h("option", { value: "" }, "—"), ABIL.filter(([k]) => ["int", "wis", "cha"].includes(k)).map(([k, , n]) => h("option", { value: k, selected: data.spell_ability === k }, n)))),
      spellMod !== null ? h("span", { class: "pb-chip" }, `CD ${8 + pb + spellMod}`) : null,
      spellMod !== null ? h("span", { class: "pb-chip" }, `Attacco ${fmt(pb + spellMod)}`) : null,
      spellMod !== null ? rollBtn("🎲 Attacco", () => roll(d20(pb + spellMod), "Attacco con incantesimo", "attack")) : null),
    h("div", { class: "slots" }, [1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => {
      const s = data.slots[lv] || { max: 0, used: 0 };
      if (!ed && !s.max) return null;
      return h("div", { class: "slot" },
        h("span", { class: "slot-lv" }, `${lv}°`),
        h("input", { type: "number", class: "n tiny-n", min: 0, max: 9, value: s.max, title: "Slot totali", disabled: !ed, oninput: (e) => { data.slots[lv] = { ...s, max: Math.max(0, Math.min(9, Number(e.target.value) || 0)) }; changed(true); } }),
        h("span", { class: "slot-boxes" }, Array.from({ length: s.max }, (_, i) => h("input", {
          type: "checkbox", title: "Slot usato", checked: i < s.used, disabled: !ed,
          onchange: (e) => { data.slots[lv] = { ...s, used: e.target.checked ? i + 1 : i }; changed(true); },
        }))));
    })),
    ed ? h("button", { class: "btn btn-sm btn-ghost", onclick: () => { for (const k of Object.keys(data.slots)) data.slots[k].used = 0; changed(true); toast("Slot recuperati (riposo lungo)", "ok"); } }, "Riposo lungo: recupera slot") : null,
    h("div", { class: "spell-list" }, data.spells.map((sp) => spellRow(sp, pb, spellMod))),
    ed ? h("button", { class: "btn btn-sm", html: `${icon("plus")} Aggiungi incantesimo`, onclick: () => { data.spells.push({ id: uid(), name: "", level: 0, prepared: true, damage: "", notes: "" }); changed(true); } }) : null);

  // --- condizioni
  const conds = h("div", { class: "conds" },
    CONDITIONS.map((c) => h("button", { class: `chip ${data.conditions.includes(c) ? "on" : ""}`, disabled: !ed,
      onclick: () => { data.conditions = data.conditions.includes(c) ? data.conditions.filter((x) => x !== c) : [...data.conditions, c]; changed(true); } }, c)),
    h("label", { class: "inline" }, "Indebolimento", num(data, "exhaustion", { min: 0, max: 6 })));

  // --- equipaggiamento
  const coins = h("div", { class: "coins" }, [["mr", "MR rame"], ["ma", "MA argento"], ["me", "ME electrum"], ["mo", "MO oro"], ["mp", "MP platino"]].map(([k, l]) =>
    h("label", { class: "coin", title: l }, l.split(" ")[0], num(data.coins, k, { min: 0, max: 9999999 }))));
  const items = h("div", { class: "items" },
    data.items.map((it) => h("div", { class: "item-row" },
      h("input", { type: "number", class: "n tiny-n", min: 0, max: 9999, value: it.qty ?? 1, title: "Quantità", disabled: !ed, oninput: (e) => { it.qty = Number(e.target.value) || 0; changed(); } }),
      h("input", { value: it.name || "", placeholder: "Oggetto", maxlength: 80, disabled: !ed, oninput: (e) => { it.name = e.target.value; changed(); } }),
      h("input", { value: it.notes || "", placeholder: "Note", maxlength: 200, disabled: !ed, oninput: (e) => { it.notes = e.target.value; changed(); } }),
      ed ? h("button", { class: "icon-btn", title: "Rimuovi", html: icon("x"), onclick: () => { data.items = data.items.filter((x) => x !== it); changed(true); } }) : null)),
    ed ? h("button", { class: "btn btn-sm", html: `${icon("plus")} Aggiungi oggetto`, onclick: () => { data.items.push({ id: uid(), name: "", qty: 1, notes: "" }); changed(true); } }) : null);

  root.replaceChildren(
    renderPicker() || "",
    head, top,
    section("Combattimento", "sword", true, hpBox, combat),
    section("Caratteristiche", "shield", true, abil, h("p", { class: "muted small" }, `Percezione passiva: ${passive}`)),
    section("Tiri salvezza", "shield", false, saves),
    section("Abilità", "check", false, skills),
    section("Attacchi", "sword", true, attacks),
    section("Incantesimi", "scroll", false, spells),
    section("Condizioni", "info", false, conds),
    section("Equipaggiamento e denaro", "key", false, coins, items),
    section("Tratti, competenze e lingue", "scroll", false,
      h("label", {}, "Privilegi e tratti", txt(data, "features", { area: true, rows: 5, max: 6000 })),
      h("label", {}, "Competenze (armi, armature, strumenti)", txt(data, "proficiencies", { area: true, rows: 2, max: 2000 })),
      h("label", {}, "Lingue", txt(data, "languages", { max: 300 }))),
    section("Diario personale", "scroll", false, txt(data, "journal", { area: true, rows: 8, max: 20000, placeholder: "Appunti, indizi, nomi incontrati…" })));
}

function stat(label, ...children) { return h("div", { class: "stat" }, h("div", { class: "stat-label" }, label), ...children); }

function refreshDerived() { /* i valori derivati si aggiornano al render completo */ }

function applyHp(delta) {
  if (!delta) return;
  if (delta < 0) {
    let dmg = -delta;
    const t = Math.min(Number(data.temp_hp) || 0, dmg);
    data.temp_hp = (Number(data.temp_hp) || 0) - t; dmg -= t;
    data.hp = Math.max(0, (Number(data.hp) || 0) - dmg);
  } else {
    data.hp = Math.min(Number(data.hp_max) || 0, (Number(data.hp) || 0) + delta);
    if (data.hp > 0) data.death = { ok: 0, ko: 0 };
  }
  changed(true);
}

function attackRow(a) {
  const ed = canEdit();
  const crit = h("input", { type: "checkbox", title: "Colpo critico: raddoppia i dadi" });
  return h("div", { class: "attack" },
    h("div", { class: "attack-main" },
      h("input", { class: "attack-name", value: a.name, maxlength: 60, disabled: !ed, oninput: (e) => { a.name = e.target.value; changed(); } }),
      rollBtn(`Colpire ${fmt(attackBonus(a))}`, () => roll(d20(attackBonus(a)), `${a.name} (per colpire)`, "attack")),
      rollBtn(`Danni ${damageExpr(a)}`, () => roll(damageExpr(a, crit.checked), `${a.name} (danni${a.dtype ? " " + a.dtype : ""}${crit.checked ? ", critico" : ""})`, "damage")),
      h("label", { class: "inline tiny", title: "Critico" }, crit, "crit")),
    ed ? h("details", { class: "attack-edit" }, h("summary", {}, "modifica"),
      h("div", { class: "attack-fields" },
        h("label", {}, "Caratteristica", h("select", { onchange: (e) => { a.ability = e.target.value; changed(true); } },
          [["str", "Forza"], ["dex", "Destrezza"], ["spell", "Incantatore"], ["none", "Nessuna"]].map(([v, l]) => h("option", { value: v, selected: a.ability === v }, l)))),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!a.proficient, onchange: (e) => { a.proficient = e.target.checked; changed(true); } }), " Competente"),
        h("label", {}, "Bonus extra", h("input", { type: "number", class: "n", value: a.bonus || 0, oninput: (e) => { a.bonus = Number(e.target.value) || 0; changed(); } })),
        h("label", {}, "Dadi danno", h("input", { value: a.damage || "", placeholder: "1d8", maxlength: 30, oninput: (e) => { a.damage = e.target.value; changed(); } })),
        h("label", { class: "check" }, h("input", { type: "checkbox", checked: !!a.add_mod, onchange: (e) => { a.add_mod = e.target.checked; changed(true); } }), " Aggiungi modificatore ai danni"),
        h("label", {}, "Tipo di danno", h("select", { onchange: (e) => { a.dtype = e.target.value; changed(); } }, DMG_TYPES.map((t) => h("option", { value: t, selected: a.dtype === t }, t || "—")))),
        h("button", { class: "btn btn-sm btn-danger", onclick: async () => { if (await confirmDialog(`Rimuovere ${a.name}?`)) { data.attacks = data.attacks.filter((x) => x !== a); changed(true); } } }, "Rimuovi"))) : null);
}

function spellRow(sp, pb, spellMod) {
  const ed = canEdit();
  return h("div", { class: "spell" },
    h("input", { type: "checkbox", title: "Preparato", checked: !!sp.prepared, disabled: !ed, onchange: (e) => { sp.prepared = e.target.checked; changed(); } }),
    h("select", { class: "spell-lv", disabled: !ed, title: "Livello", onchange: (e) => { sp.level = Number(e.target.value); changed(); } },
      [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => h("option", { value: l, selected: Number(sp.level) === l }, l === 0 ? "Trucchetto" : `${l}°`))),
    h("input", { value: sp.name || "", placeholder: "Nome incantesimo", maxlength: 60, disabled: !ed, oninput: (e) => { sp.name = e.target.value; changed(); } }),
    h("input", { class: "spell-dmg", value: sp.damage || "", placeholder: "Danni/cura (es. 3d6)", maxlength: 30, disabled: !ed, oninput: (e) => { sp.damage = e.target.value; changed(); } }),
    sp.damage ? rollBtn("🎲", () => roll(String(sp.damage).replace(/\s/g, ""), sp.name || "Incantesimo", "damage"), "Tira danni/cura") : null,
    h("input", { class: "spell-notes", value: sp.notes || "", placeholder: "Note (gittata, durata…)", maxlength: 300, disabled: !ed, oninput: (e) => { sp.notes = e.target.value; changed(); } }),
    ed ? h("button", { class: "icon-btn", title: "Rimuovi", html: icon("x"), onclick: () => { data.spells = data.spells.filter((x) => x !== sp); changed(true); } }) : null);
}

// L'iniziativa tirata dalla scheda entra nel combattimento attivo
let initHook = null;
export function setInitiativeHook(fn) { initHook = fn; }
function afterInitiative(r) { if (r && initHook && char) initHook(char, r.total); }
