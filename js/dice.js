// =====================================================================
//  Dadi: il risultato lo genera il SERVER (funzione roll_dice),
//  il browser si limita a mostrarlo con un'animazione.
// =====================================================================
import { opts, diceColors } from "./options.js";
import { die3d } from "./dice3d.js";
import { sb, rpc, must } from "./supabase.js";
import { store, isDM } from "./store.js";
import { h, icon, toast, fmtTime, beep, loadPref, savePref } from "./ui.js";

const DICE = [4, 6, 8, 10, 12, 20, 100];
const TYPES = [["generic", "Tiro libero"], ["check", "Prova di abilità"], ["attack", "Tiro per colpire"], ["damage", "Danni"], ["save", "Tiro salvezza"], ["initiative", "Iniziativa"]];
const TYPE_LABEL = Object.fromEntries(TYPES);
let root, list, gameId, stage, unsub = [], seen = new Set();

// Forme dei dadi (SVG disegnati a mano)
const SHAPES = {
  4: '<polygon points="50,6 94,88 6,88"/>',
  6: '<rect x="10" y="10" width="80" height="80" rx="10"/>',
  8: '<polygon points="50,4 94,50 50,96 6,50"/>',
  10: '<polygon points="50,4 92,42 50,96 8,42"/>',
  12: '<polygon points="50,4 93,35 77,90 23,90 7,35"/>',
  20: '<polygon points="50,3 93,27 93,73 50,97 7,73 7,27"/><path d="M50 30 L93 73 M50 30 L7 73 M50 30 L93 27 M50 30 L7 27 M50 3 L50 30 M7 73 L93 73" fill="none" opacity=".55"/>',
  100: '<polygon points="50,4 92,42 50,96 8,42"/>',
  2: '<circle cx="50" cy="50" r="42"/>',
  3: '<polygon points="50,6 94,88 6,88"/>',
};
export function dieSvg(sides, value, cls = "") {
  return `<svg class="die ${cls}" viewBox="0 0 100 100"><g class="die-shape">${SHAPES[sides] || SHAPES[6]}</g><text x="50" y="${sides === 4 ? 70 : 60}" text-anchor="middle">${value}</text></svg>`;
}

export function mountDice(container, gid, stageEl) {
  gameId = gid; stage = stageEl; seen = new Set();
  const count = h("input", { type: "number", min: 1, max: 20, value: 1, class: "dice-n", title: "Quanti dadi" });
  const mod = h("input", { type: "number", min: -30, max: 30, value: 0, class: "dice-n", title: "Modificatore" });
  const adv = h("select", { title: "Vantaggio / svantaggio" }, h("option", { value: "" }, "Normale"), h("option", { value: "adv" }, "Vantaggio"), h("option", { value: "dis" }, "Svantaggio"));
  const type = h("select", {}, TYPES.map(([v, l]) => h("option", { value: v }, l)));
  const label = h("input", { maxlength: 80, placeholder: "Descrizione (es. Furtività, Spada lunga)" });
  const secret = h("input", { type: "checkbox" });
  const formula = h("input", { maxlength: 60, placeholder: "Formula libera: 2d6+3, 1d20+5, 4d6…", value: loadPref("diceFormula", "") });
  list = h("div", { class: "dice-history" });

  const roll = async (expr) => {
    try {
      const r = await rpc("roll_dice", {
        p_game: gameId, p_expr: expr, p_label: label.value.trim(), p_type: type.value,
        p_adv: adv.value, p_secret: secret.checked,
      });
      addRoll(r, { animate: true, mine: true });
    } catch (e) { toast(e.message, "error"); }
  };
  const quick = (d) => {
    const n = Math.max(1, Math.min(20, parseInt(count.value, 10) || 1));
    const m = parseInt(mod.value, 10) || 0;
    roll(`${n}d${d}${m ? (m > 0 ? "+" + m : m) : ""}`);
  };

  root = h("div", { class: "dice-panel" },
    h("div", { class: "dice-quick" }, DICE.map((d) => h("button", { class: "die-btn", title: `Tira d${d}`, html: dieSvg(d, "d" + d), onclick: () => quick(d) }))),
    h("div", { class: "dice-row" },
      h("label", { class: "inline" }, "N°", count),
      h("label", { class: "inline" }, "Mod.", mod),
      adv),
    h("div", { class: "dice-row" }, type, label),
    h("div", { class: "dice-row" }, formula,
      h("button", { class: "btn btn-primary btn-sm", onclick: () => { if (formula.value.trim()) { savePref("diceFormula", formula.value.trim()); roll(formula.value.trim()); } } }, "Tira")),
    h("label", { class: "check small" }, secret, " ", isDM() ? "Tiro segreto (lo vedi solo tu)" : "Tiro riservato (lo vedete solo tu e il DM)"),
    h("p", { class: "muted small" }, "«Vantaggio» e «Svantaggio» valgono per un singolo d20. I risultati li genera il server: nessuno può truccarli."),
    h("h4", { class: "dice-title" }, "Ultimi tiri"),
    list);
  container.append(root);
  load();
  return root;
}

/** Tiro dalla scheda o dal combattimento: il server genera, qui si mostra */
export async function rollFor(expr, { label = "", type = "generic", adv = "", secret = false } = {}) {
  try {
    const r = await rpc("roll_dice", { p_game: gameId, p_expr: expr, p_label: label, p_type: type, p_adv: adv, p_secret: secret });
    addRoll(r, { animate: true, mine: true });
    return r;
  } catch (e) { toast(e.message, "error"); return null; }
}

export function unmountDice() { root?.remove(); root = null; }

async function load() {
  try {
    const rows = await must(sb.from("dice_rolls").select("*").eq("game_id", gameId).order("id", { ascending: false }).limit(40));
    list.replaceChildren();
    rows.reverse().forEach((r) => addRoll(r, { animate: false }));
  } catch (e) { list.replaceChildren(h("p", { class: "muted small" }, e.message)); }
}
export const reloadDice = load;

export function addRoll(r, { animate = true, mine = false } = {}) {
  if (!list || seen.has(r.id)) return;
  seen.add(r.id);
  list.prepend(renderRow(r));
  while (list.children.length > 60) list.lastChild.remove();
  if (animate) showOverlay(r, mine);
}

function detailText(r) {
  const parts = (r.detail || []).map((g) => {
    const sign = g.sign < 0 ? "− " : "";
    if (g.rolls.length === 2 && r.adv && g.die === 20) return `${sign}d20 [${g.rolls.join(", ")}] → ${g.kept[0]}`;
    return `${sign}${g.rolls.length}d${g.die} [${g.rolls.join(", ")}]`;
  });
  if (r.modifier) parts.push(r.modifier > 0 ? `+ ${r.modifier}` : `− ${-r.modifier}`);
  return parts.join("  ");
}
function crit(r) {
  const d = r.detail || [];
  if (d.length !== 1 || d[0].die !== 20 || d[0].kept.length !== 1) return "";
  if (d[0].kept[0] === 20) return "crit";
  if (d[0].kept[0] === 1) return "fumble";
  return "";
}

function renderRow(r) {
  const c = crit(r);
  return h("div", { class: `roll ${r.secret ? "secret" : ""} ${c}` },
    h("div", { class: "roll-head" },
      h("strong", {}, r.roller_name),
      h("span", { class: "muted small" }, [TYPE_LABEL[r.roll_type] !== "Tiro libero" ? TYPE_LABEL[r.roll_type] : "", r.label].filter(Boolean).join(" · ")),
      r.secret ? h("span", { class: "roll-secret", html: `${icon("lock")} segreto` }) : null,
      h("span", { class: "roll-time" }, fmtTime(r.created_at))),
    h("div", { class: "roll-body" },
      h("span", { class: "roll-total" }, String(r.total)),
      h("span", { class: "roll-detail" }, `${r.expr}${r.adv === "adv" ? " (vantaggio)" : r.adv === "dis" ? " (svantaggio)" : ""} → ${detailText(r)}`),
      c === "crit" ? h("span", { class: "roll-flag" }, "CRITICO!") : c === "fumble" ? h("span", { class: "roll-flag bad" }, "1 naturale") : null));
}

// Animazione: dadi che rotolano, poi si fermano sul risultato del server
function showOverlay(r, mine) {
  if (!stage) return;
  const dice = [];
  for (const g of r.detail || []) for (const v of g.rolls) if (dice.length < 12) dice.push({ sides: g.die, value: v, kept: g.kept.includes(v) });
  const box = h("div", { class: `dice-overlay ${crit(r)}` });
  const tray = h("div", { class: "dice-tray" });
  if (opts.diceStyle === "3d") {
    const colors = diceColors();
    dice.forEach((d, i) => {
      const cv = die3d(d.sides, d.value, { size: dice.length > 6 ? 60 : 84, colors, delay: i * 70, duration: 950,
        onLand: () => { if (!d.kept) cv.classList.add("dropped"); } });
      tray.append(cv);
    });
  } else dice.forEach((d, i) => {
    const el = h("span", { class: "die-anim", style: { animationDelay: `${i * 60}ms` }, html: dieSvg(d.sides, "?") });
    tray.append(el);
    let n = 0;
    const spin = setInterval(() => {
      n++;
      el.querySelector("text").textContent = String(1 + Math.floor(Math.random() * d.sides));
      if (n > 9) {
        clearInterval(spin);
        el.querySelector("text").textContent = String(d.value);
        el.classList.add("landed");
        if (!d.kept) el.classList.add("dropped");
      }
    }, 80);
  });
  const total = h("div", { class: "dice-total" }, "…");
  box.append(
    h("div", { class: "dice-who" }, `${r.roller_name}${r.label ? " · " + r.label : ""}${r.secret ? " 🔒" : ""}`),
    tray, total);
  stage.append(box);
  if (mine) beep("tx-on");
  setTimeout(() => { total.textContent = String(r.total); box.classList.add("done"); }, opts.diceStyle === "3d" ? 1000 + Math.min(dice.length, 12) * 70 : 900);
  setTimeout(() => box.classList.add("out"), 3600);
  setTimeout(() => box.remove(), 4200);
}

export function isSecretVisible(r) {
  return !r.secret || r.roller_id === store.user.id || isDM();
}
