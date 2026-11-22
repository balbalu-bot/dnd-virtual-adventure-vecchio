// =====================================================================
//  Combattimento: iniziativa, turni, round, PF, condizioni, bersagli
//  Il DM decide sempre: niente è automatico oltre all'ordine dei turni.
// =====================================================================
import { sb, rpc, must } from "./supabase.js";
import { store, isDM, memberName } from "./store.js";
import { h, icon, toast, modal, confirmDialog, beep } from "./ui.js";
import { rollFor } from "./dice.js";
import { defaults, mod, CONDITIONS, rollInitiativeFor, setInitiativeHook, openSheet } from "./sheet.js";
import { tableState } from "./map/table.js";

const C = { root: null, enc: null, list: new Map(), stats: new Map(), chars: new Map(), lastTurnNotified: null, onShowSheet: null };
const HEALTH = { ok: ["Illeso", "ok"], ferito: ["Ferito", "warn"], grave: ["Gravemente ferito", "bad"], "a terra": ["A terra", "down"], morto: ["Morto", "down"] };

export function mountCombat(container, { onShowSheet } = {}) {
  C.root = h("div", { class: "combat" });
  C.onShowSheet = onShowSheet;
  container.append(C.root);
  setInitiativeHook(async (charRow, total) => {
    const c = [...C.list.values()].find((x) => x.character_id === charRow.id);
    if (C.enc && c) await setInit(c, total);
  });
  return C.root;
}
export function unmountCombat() { C.root?.remove(); C.root = null; C.enc = null; C.list.clear(); C.stats.clear(); setInitiativeHook(null); }

export async function reloadCombat() {
  if (!C.root) return;
  const gid = store.game.id;
  const enc = await must(sb.from("encounters").select("*").eq("game_id", gid).eq("active", true).maybeSingle());
  C.enc = enc || null;
  C.list.clear(); C.stats.clear();
  if (C.enc) {
    const rows = await must(sb.from("combatants").select("*").eq("encounter_id", C.enc.id));
    rows.forEach((r) => C.list.set(r.id, r));
    if (isDM() && rows.length) {
      const st = await must(sb.from("combatant_stats").select("*").in("combatant_id", rows.map((r) => r.id)));
      st.forEach((s) => C.stats.set(s.combatant_id, s));
    }
    await loadChars();
  }
  render();
}

async function loadChars() {
  const ids = [...new Set([...C.list.values()].map((c) => c.character_id).filter(Boolean))];
  if (!ids.length) return;
  const rows = await must(sb.from("characters").select("id,name,owner_id,data,level").in("id", ids));
  rows.forEach((r) => C.chars.set(r.id, r));
}

// ================================================================== tempo reale
export const combatRealtime = {
  encounter(p) {
    const e = p.new && p.new.id ? p.new : null;
    const endedId = p.eventType === "DELETE" ? p.old?.id : (e && !e.active ? e.id : null);
    if (endedId) {
      if (C.enc && C.enc.id === endedId) { C.enc = null; C.list.clear(); render(); toast("Il combattimento è terminato.", "info"); }
      return;
    }
    if (!e) return;
    const newEnc = !C.enc || C.enc.id !== e.id;
    C.enc = e;
    if (newEnc) { reloadCombat(); if (!isDM()) { beep("alert"); toast("⚔ Inizia il combattimento! Tira l'iniziativa.", "private", { timeout: 8000 }); } return; }
    render();
    notifyTurn();
  },
  combatant(p) {
    if (p.eventType === "DELETE") { if (p.old?.id && C.list.delete(p.old.id)) render(); return; }
    const c = p.new; if (!c?.id || !C.enc || c.encounter_id !== C.enc.id) return;
    C.list.set(c.id, c);
    if (c.character_id && !C.chars.has(c.character_id)) loadChars().then(render); else render();
  },
  stats(p) {
    const s = p.new; if (!s?.combatant_id) return;
    C.stats.set(s.combatant_id, s); render();
  },
  character(row) {
    if (!row?.id || !C.chars.has(row.id)) return;
    C.chars.set(row.id, { ...C.chars.get(row.id), ...row }); render();
  },
  signal(s) { if (s?.ref_id && C.list.delete(s.ref_id)) render(); },
};

// ================================================================== ordine e azioni
function ordered() {
  return [...C.list.values()].sort((a, b) =>
    (b.initiative ?? -999) - (a.initiative ?? -999) || b.init_bonus - a.init_bonus || a.name.localeCompare(b.name));
}
function mine(c) { return c.owner_id === store.user.id; }

async function startEncounter() {
  try {
    const row = await must(sb.from("encounters").insert({ game_id: store.game.id, name: "Combattimento" }).select().single());
    C.enc = row; C.list.clear();
    await addFromMap(true);
    render();
    rpc("announce", { p_game: store.game.id, p_text: "⚔️ Inizia il combattimento! Tirate l'iniziativa." }).catch(() => {});
  } catch (e) { toast(e.message.includes("encounters_one_active") ? "C'è già un combattimento in corso." : e.message, "error"); }
}

async function endEncounter() {
  if (!(await confirmDialog("Terminare il combattimento? L'elenco dei partecipanti verrà chiuso."))) return;
  try {
    await must(sb.from("encounters").update({ active: false, current_id: null }).eq("id", C.enc.id));
    C.enc = null; C.list.clear(); render();
  } catch (e) { toast(e.message, "error"); }
}

async function addFromMap(silent) {
  const view = tableState().view;
  if (!view || !C.enc) return;
  const present = new Set([...C.list.values()].map((c) => c.token_id).filter(Boolean));
  const toks = [...view.tokens.values()].filter((t) => ["pc", "npc", "monster"].includes(t.kind) && !present.has(t.id));
  if (!toks.length) { if (!silent) toast("Nessun nuovo personaggio o mostro sulla mappa aperta.", "info"); return; }
  const rows = [];
  for (const t of toks) {
    let character_id = null, init_bonus = 0;
    if (t.kind === "pc" && t.owner_id) {
      const m = store.members.get(t.owner_id);
      character_id = m?.character_id || null;
      if (character_id) {
        const ch = C.chars.get(character_id) || (await must(sb.from("characters").select("id,name,owner_id,data,level").eq("id", character_id).maybeSingle()));
        if (ch) { C.chars.set(ch.id, ch); const d = defaults(ch.data); init_bonus = mod(d.abilities.dex) + (Number(d.init_bonus) || 0); }
      }
    }
    rows.push({ encounter_id: C.enc.id, game_id: store.game.id, name: t.name || "Senza nome", kind: t.kind, token_id: t.id, character_id, owner_id: t.owner_id, init_bonus, hidden: !!t.hidden });
  }
  try {
    const res = await must(sb.from("combatants").insert(rows).select());
    res.forEach((r) => C.list.set(r.id, r));
    const statRows = res.filter((r) => r.kind !== "pc").map((r) => ({ combatant_id: r.id, game_id: store.game.id, hp: 10, hp_max: 10, ac: 12 }));
    if (statRows.length) (await must(sb.from("combatant_stats").insert(statRows).select())).forEach((s) => C.stats.set(s.combatant_id, s));
    render();
    if (!silent || res.length) toast(`Aggiunti ${res.length} partecipanti dalla mappa.`, "ok");
  } catch (e) { toast(e.message, "error"); }
}

function addManual() {
  const f = {
    name: h("input", { maxlength: 60, placeholder: "es. Goblin 3" }),
    kind: h("select", {}, h("option", { value: "monster" }, "Mostro"), h("option", { value: "npc" }, "PNG")),
    hp: h("input", { type: "number", min: 0, max: 999, value: 7 }),
    ac: h("input", { type: "number", min: 0, max: 40, value: 13 }),
    init: h("input", { type: "number", min: -10, max: 20, value: 2 }),
    hidden: h("input", { type: "checkbox" }),
  };
  modal({
    title: "Aggiungi al combattimento",
    body: h("div", {},
      h("div", { class: "row2" }, h("label", {}, "Nome", f.name), h("label", {}, "Tipo", f.kind)),
      h("div", { class: "row2" }, h("label", {}, "Punti ferita", f.hp), h("label", {}, "Classe Armatura", f.ac)),
      h("label", {}, "Bonus iniziativa", f.init),
      h("label", { class: "check" }, f.hidden, " Nascosto ai giocatori")),
    actions: [{ label: "Annulla" }, {
      label: "Aggiungi", primary: true,
      onClick: async () => {
        if (!f.name.value.trim()) { toast("Scrivi un nome", "error"); return false; }
        const r = await must(sb.from("combatants").insert({ encounter_id: C.enc.id, game_id: store.game.id, name: f.name.value.trim(), kind: f.kind.value, init_bonus: Number(f.init.value) || 0, hidden: f.hidden.checked }).select().single());
        C.list.set(r.id, r);
        const hp = Math.max(0, Number(f.hp.value) || 0);
        const s = await must(sb.from("combatant_stats").insert({ combatant_id: r.id, game_id: store.game.id, hp, hp_max: hp, ac: Number(f.ac.value) || 10 }).select().single());
        C.stats.set(r.id, s); render();
      },
    }],
  });
}

async function rollMonsters() {
  const todo = ordered().filter((c) => c.kind !== "pc" && c.initiative == null);
  if (!todo.length) { toast("Tutti i mostri hanno già l'iniziativa.", "info"); return; }
  for (const c of todo) {
    const r = await rollFor(`1d20${c.init_bonus ? (c.init_bonus > 0 ? "+" + c.init_bonus : c.init_bonus) : ""}`, { label: `${c.name}: Iniziativa`, type: "initiative", secret: c.hidden });
    if (r) await setInit(c, r.total);
  }
}

async function setInit(c, value) {
  try { await rpc("set_initiative", { p_combatant: c.id, p_value: value }); c.initiative = value; render(); }
  catch (e) { toast(e.message, "error"); }
}

async function rollMyInit(c) {
  const ch = c.character_id ? C.chars.get(c.character_id) : null;
  const r = ch ? await rollInitiativeFor(ch) : await rollFor(`1d20${c.init_bonus ? "+" + c.init_bonus : ""}`, { label: `${c.name}: Iniziativa`, type: "initiative" });
  if (r) await setInit(c, r.total);
}

async function turn(back = false) {
  try { const r = await rpc("next_turn", { p_enc: C.enc.id, p_back: back }); C.enc.current_id = r.current_id; C.enc.round = r.round; render(); }
  catch (e) { toast(e.message, "error"); }
}

async function patch(c, p) {
  try { const r = await must(sb.from("combatants").update(p).eq("id", c.id).select().single()); C.list.set(r.id, r); render(); }
  catch (e) { toast(e.message, "error"); }
}

async function patchStats(c, p) {
  const cur = C.stats.get(c.id) || { combatant_id: c.id, game_id: store.game.id, hp: 10, hp_max: 10, temp_hp: 0, ac: 10 };
  try {
    const r = await must(sb.from("combatant_stats").upsert({ ...cur, ...p }).select().single());
    C.stats.set(r.combatant_id, r); render();
  } catch (e) { toast(e.message, "error"); }
}

async function patchCharData(c, fn) {
  const ch = C.chars.get(c.character_id); if (!ch) return;
  const d = defaults(ch.data); fn(d);
  try {
    const r = await must(sb.from("characters").update({ data: d }).eq("id", ch.id).select("id,name,owner_id,data,level").single());
    C.chars.set(r.id, r); render();
  } catch (e) { toast(e.message, "error"); }
}

function applyDamage(c, amount) {
  if (!amount) return;
  if (c.kind === "pc" && c.character_id) {
    patchCharData(c, (d) => {
      if (amount < 0) { let dmg = -amount; const t = Math.min(d.temp_hp || 0, dmg); d.temp_hp -= t; dmg -= t; d.hp = Math.max(0, d.hp - dmg); }
      else d.hp = Math.min(d.hp_max, d.hp + amount);
    });
  } else {
    const s = C.stats.get(c.id) || { hp: 0, hp_max: 0, temp_hp: 0 };
    let hp = s.hp, temp = s.temp_hp || 0;
    if (amount < 0) { let dmg = -amount; const t = Math.min(temp, dmg); temp -= t; dmg -= t; hp = Math.max(0, hp - dmg); }
    else hp = Math.min(s.hp_max, hp + amount);
    patchStats(c, { hp, temp_hp: temp });
  }
}

function notifyTurn() {
  if (!C.enc?.current_id || C.lastTurnNotified === `${C.enc.current_id}:${C.enc.round}`) return;
  C.lastTurnNotified = `${C.enc.current_id}:${C.enc.round}`;
  const c = C.list.get(C.enc.current_id);
  if (c && mine(c)) { beep("private"); toast(`⚔ È il tuo turno, ${c.name}!`, "private", { timeout: 7000 }); }
}

// ================================================================== disegno
function render() {
  if (!C.root) return;
  syncMap();
  const dm = isDM();
  if (!C.enc) {
    C.root.replaceChildren(dm
      ? h("div", {}, h("p", { class: "muted small" }, "Nessun combattimento in corso."),
        h("button", { class: "btn btn-primary btn-sm", html: `${icon("sword")} Inizia combattimento`, onclick: startEncounter }),
        h("p", { class: "muted small" }, "Verranno aggiunti personaggi e mostri presenti sulla mappa aperta."))
      : h("p", { class: "muted small" }, "Nessun combattimento in corso."));
    return;
  }
  const list = ordered();
  const cur = C.enc.current_id;
  const head = h("div", { class: "combat-head" },
    h("span", { class: "round-chip" }, `Round ${C.enc.round}`),
    cur && C.list.get(cur) ? h("span", { class: "small" }, "Turno di ", h("strong", {}, C.list.get(cur).name)) : h("span", { class: "muted small" }, dm ? "Premi ▶ per iniziare" : "In attesa del primo turno"));
  const dmBar = dm ? h("div", { class: "combat-dm row-btns" },
    h("button", { class: "btn btn-sm", title: "Turno precedente", onclick: () => turn(true) }, "◀"),
    h("button", { class: "btn btn-sm btn-primary", onclick: () => turn(false) }, cur ? "Turno successivo ▶" : "Inizia i turni ▶"),
    h("button", { class: "btn btn-sm", title: "Aggiungi dalla mappa", onclick: () => addFromMap(false) }, "+ dalla mappa"),
    h("button", { class: "btn btn-sm", title: "Aggiungi un mostro o PNG", onclick: addManual }, "+ mostro"),
    h("button", { class: "btn btn-sm", title: "Tira l'iniziativa di tutti i mostri", onclick: rollMonsters }, "🎲 Iniz. mostri"),
    h("button", { class: "btn btn-sm btn-danger", onclick: endEncounter }, "Fine")) : null;
  C.root.replaceChildren(head, dmBar || "", h("div", { class: "combat-list" }, list.map((c, i) => row(c, i, list))));
  notifyTurn();
}

function row(c, i, list) {
  const dm = isDM();
  const isCur = C.enc.current_id === c.id;
  const own = mine(c);
  const ch = c.character_id ? C.chars.get(c.character_id) : null;
  const d = ch ? defaults(ch.data) : null;
  const st = C.stats.get(c.id);
  const conds = d ? d.conditions : c.conditions;

  const initEl = dm
    ? h("input", { class: "n init-in", type: "number", value: c.initiative ?? "", placeholder: "—", title: "Iniziativa", onchange: (e) => setInit(c, Number(e.target.value)) })
    : c.initiative != null ? h("span", { class: "init-val" }, String(c.initiative))
      : own ? h("button", { class: "btn btn-sm btn-primary", onclick: () => rollMyInit(c) }, "🎲 Iniz.") : h("span", { class: "init-val muted" }, "—");

  let hpEl;
  if (d) hpEl = h("span", { class: "hp-chip", title: "Punti ferita" }, `❤ ${d.hp}/${d.hp_max}${d.temp_hp ? " +" + d.temp_hp : ""}`);
  else if (dm && st) hpEl = h("span", { class: "hp-chip", title: "Punti ferita (solo DM)" }, `❤ ${st.hp}/${st.hp_max} · CA ${st.ac}`);
  else hpEl = h("span", { class: `health h-${(HEALTH[c.health] || HEALTH.ok)[1]}` }, (HEALTH[c.health] || HEALTH.ok)[0]);

  const dmgIn = h("input", { type: "number", class: "n tiny-n", min: 0, max: 999, placeholder: "0" });
  const canHp = dm || (own && d);
  const hpCtl = canHp ? h("span", { class: "hp-ctl" }, dmgIn,
    h("button", { class: "mini bad", title: "Danno", onclick: () => applyDamage(c, -(Number(dmgIn.value) || 0)) }, "−"),
    h("button", { class: "mini good", title: "Cura", onclick: () => applyDamage(c, Number(dmgIn.value) || 0) }, "+")) : null;

  const targets = list.filter((x) => x.id !== c.id);
  const targetSel = (own || dm) && targets.length ? h("select", {
    class: "target-sel", title: "Bersaglio",
    onchange: (e) => rpc("set_target", { p_combatant: c.id, p_target: e.target.value || null }).catch((err) => toast(err.message, "error")),
  }, h("option", { value: "" }, "🎯 nessun bersaglio"), targets.map((t) => h("option", { value: t.id, selected: c.target_id === t.id }, "🎯 " + t.name))) : null;
  const tgt = !targetSel && c.target_id && C.list.get(c.target_id) ? h("span", { class: "muted small" }, "🎯 " + C.list.get(c.target_id).name) : null;

  const condSel = dm ? h("select", {
    class: "cond-sel", title: "Aggiungi/togli condizione",
    onchange: (e) => {
      const v = e.target.value; if (!v) return;
      if (v === "__morto") { patch(c, { health: c.health === "morto" ? "ok" : "morto" }); return; }
      if (d) patchCharData(c, (dd) => { dd.conditions = dd.conditions.includes(v) ? dd.conditions.filter((x) => x !== v) : [...dd.conditions, v]; });
      else patch(c, { conditions: c.conditions.includes(v) ? c.conditions.filter((x) => x !== v) : [...c.conditions, v] });
    },
  }, h("option", { value: "" }, "+ condizione"), CONDITIONS.map((x) => h("option", { value: x }, (conds.includes(x) ? "✓ " : "") + x)),
  c.kind !== "pc" ? h("option", { value: "__morto" }, c.health === "morto" ? "✓ Morto" : "Morto") : null) : null;

  const dmExtra = dm ? h("span", { class: "row-btns" },
    c.kind !== "pc" ? h("button", { class: "mini", title: "Modifica PF/CA/note", onclick: () => editStats(c) }, "✎") : null,
    h("button", { class: "mini", title: c.hidden ? "Mostra ai giocatori" : "Nascondi ai giocatori", html: icon(c.hidden ? "eyeOff" : "eye"), onclick: () => patch(c, { hidden: !c.hidden }) }),
    h("button", { class: "mini bad", title: "Togli dal combattimento", html: icon("x"), onclick: async () => { if (await confirmDialog(`Togliere ${c.name} dal combattimento?`)) { await must(sb.from("combatants").delete().eq("id", c.id)); C.list.delete(c.id); render(); } } })) : null;

  return h("div", { class: `cb ${isCur ? "current" : ""} ${own ? "mine" : ""} ${c.hidden ? "is-hidden" : ""} ${c.health === "morto" || c.health === "a terra" ? "down" : ""}` },
    h("div", { class: "cb-top" },
      h("span", { class: "cb-pos" }, isCur ? "▶" : String(i + 1)),
      initEl,
      h("button", {
        class: "cb-name", title: c.token_id ? "Mostra sulla mappa" : "",
        onclick: () => {
          const v = tableState().view; const t = c.token_id && v?.tokens.get(c.token_id);
          if (t) { v.centerOn(t.x, t.y); v.select(t.id); }
          if (ch && (dm || own) && C.onShowSheet) { C.onShowSheet(); openSheet(ch.id); }
        },
      }, c.name, c.kind === "pc" && c.owner_id ? h("small", { class: "muted" }, " · " + memberName(c.owner_id)) : null),
      hpEl),
    h("div", { class: "cb-bottom" },
      conds.length ? h("span", { class: "conds-mini" }, conds.map((x) => h("span", { class: "chip on small" }, x))) : null,
      hpCtl, targetSel || tgt, condSel, dmExtra));
}

function editStats(c) {
  const s = C.stats.get(c.id) || { hp: 10, hp_max: 10, temp_hp: 0, ac: 10, notes: "" };
  const f = {
    name: h("input", { value: c.name, maxlength: 60 }),
    hp: h("input", { type: "number", value: s.hp }), hp_max: h("input", { type: "number", value: s.hp_max }),
    temp: h("input", { type: "number", value: s.temp_hp || 0 }), ac: h("input", { type: "number", value: s.ac }),
    init: h("input", { type: "number", value: c.init_bonus }),
    notes: h("textarea", { rows: 3, maxlength: 2000, placeholder: "Note segrete: attacchi, resistenze, tattica…" }, s.notes || ""),
  };
  modal({
    title: `Statistiche — ${c.name}`,
    body: h("div", {},
      h("label", {}, "Nome", f.name),
      h("div", { class: "row2" }, h("label", {}, "PF attuali", f.hp), h("label", {}, "PF massimi", f.hp_max)),
      h("div", { class: "row2" }, h("label", {}, "PF temporanei", f.temp), h("label", {}, "Classe Armatura", f.ac)),
      h("label", {}, "Bonus iniziativa", f.init),
      h("label", {}, "Note (solo DM)", f.notes)),
    actions: [{ label: "Annulla" }, {
      label: "Salva", primary: true,
      onClick: async () => {
        await patchStats(c, { hp: Number(f.hp.value) || 0, hp_max: Math.max(0, Number(f.hp_max.value) || 0), temp_hp: Number(f.temp.value) || 0, ac: Number(f.ac.value) || 0, notes: f.notes.value });
        if (f.name.value.trim() !== c.name || Number(f.init.value) !== c.init_bonus) await patch(c, { name: f.name.value.trim() || c.name, init_bonus: Number(f.init.value) || 0 });
      },
    }],
  });
}

// Sul tavolo: anello sul personaggio di turno e frecce verso i bersagli
function syncMap() {
  const v = tableState().view; if (!v) return;
  const cur = C.enc ? C.list.get(C.enc.current_id) : null;
  const links = [];
  if (C.enc) for (const c of C.list.values()) {
    const t = c.target_id && C.list.get(c.target_id);
    if (c.token_id && t?.token_id) links.push([c.token_id, t.token_id]);
  }
  v.setCombat?.({ activeTokenId: cur?.token_id || null, links });
}
export function refreshCombatOverlay() { syncMap(); }

// ================================================================== usate dagli strumenti del DM
export function activeEncounter() { return C.enc; }
export async function addToCombat({ name, kind = "monster", token_id = null, init_bonus = 0, hidden = false, hp = 10, ac = 12 }) {
  if (!C.enc) throw new Error("Nessun combattimento in corso: avvialo prima dal riquadro a sinistra.");
  const r = await must(sb.from("combatants").insert({ encounter_id: C.enc.id, game_id: store.game.id, name, kind, token_id, init_bonus, hidden }).select().single());
  C.list.set(r.id, r);
  const s = await must(sb.from("combatant_stats").insert({ combatant_id: r.id, game_id: store.game.id, hp, hp_max: hp, ac }).select().single());
  C.stats.set(r.id, s); render();
  return r;
}
export function combatantOfToken(tokenId) {
  if (!tokenId) return null;
  for (const c of C.list.values()) if (c.token_id === tokenId) return c;
  return null;
}
