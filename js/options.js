// =====================================================================
//  Opzioni personali (valgono solo su questo dispositivo):
//  stile dell'interfaccia, chiaro/scuro, stile e colore dei dadi.
// =====================================================================
import { h, modal, loadPref, savePref } from "./ui.js";
import { die3d } from "./dice3d.js";
import { dieSvg } from "./dice.js";

export const THEMES = [
  ["medievale", "Medievale", "Pietra, pergamena e bronzo, caratteri antichi"],
  ["classico", "Classico", "Come un manuale di gioco: rosso scuro e carta"],
  ["moderno", "Moderno", "Pulito e semplice, caratteri moderni"],
];
export const DICE_COLORS = [
  { id: "bronzo", name: "Bronzo", body: "#7a5428", edge: "#f4d58d", text: "#fff4d6" },
  { id: "rubino", name: "Rubino", body: "#8e1b1b", edge: "#ffb0a0", text: "#fff2e2" },
  { id: "smeraldo", name: "Smeraldo", body: "#17693a", edge: "#9ef0bc", text: "#f0fff4" },
  { id: "zaffiro", name: "Zaffiro", body: "#1c3f92", edge: "#a8c8ff", text: "#ffffff" },
  { id: "ametista", name: "Ametista", body: "#5b2a8c", edge: "#e2c2ff", text: "#ffffff" },
  { id: "ossidiana", name: "Ossidiana", body: "#17171c", edge: "#9a9aae", text: "#e9e9f2" },
  { id: "avorio", name: "Avorio", body: "#efe5cf", edge: "#7a5a2a", text: "#2a1c0f" },
  { id: "ghiaccio", name: "Ghiaccio", body: "#bfe6f2", edge: "#2a6a8a", text: "#0b2a3a" },
];

export const opts = {
  theme: loadPref("theme", "medievale"),
  mode: loadPref("mode", "dark"),
  diceStyle: loadPref("diceStyle", "3d"),
  diceColor: loadPref("diceColor", "bronzo"),
};

export function diceColors() { return DICE_COLORS.find((c) => c.id === opts.diceColor) || DICE_COLORS[0]; }

export function applyOptions() {
  const r = document.documentElement;
  r.dataset.theme = opts.theme;
  r.dataset.mode = opts.mode;
  const c = diceColors();
  r.style.setProperty("--die-body", c.body);
  r.style.setProperty("--die-edge", c.edge);
  r.style.setProperty("--die-text", c.text);
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", opts.mode === "light" ? "#efe7d6" : "#120e0a");
}
applyOptions();

function set(k, v) { opts[k] = v; savePref(k, v); applyOptions(); }

export function openOptions() {
  const box = h("div", { class: "options" });
  const seg = (k, list) => h("div", { class: "seg opt-seg" }, list.map(([v, label]) => h("button", {
    type: "button", class: opts[k] === v ? "on" : "", onclick: () => { set(k, v); render(); },
  }, label)));
  const preview = h("div", { class: "opt-dice-preview" });
  const showDice = () => {
    preview.replaceChildren();
    const c = diceColors();
    [[20, 17], [6, 4], [12, 9], [8, 3]].forEach(([s, v], i) => {
      if (opts.diceStyle === "3d") preview.append(die3d(s, v, { size: 62, colors: c, delay: i * 80, duration: 900 }));
      else preview.append(h("span", { class: "die-anim landed", html: dieSvg(s, v) }));
    });
  };
  const render = () => {
    box.replaceChildren(
      h("h3", {}, "Stile dell'interfaccia"),
      h("div", { class: "theme-cards" }, THEMES.map(([v, label, desc]) => h("button", {
        type: "button", class: `theme-card t-${v} ${opts.theme === v ? "on" : ""}`, onclick: () => { set("theme", v); render(); },
      }, h("span", { class: "theme-swatch" }, h("i"), h("i"), h("i")), h("strong", {}, label), h("span", { class: "small muted" }, desc)))),
      h("h3", {}, "Luminosità"),
      seg("mode", [["dark", "🌙 Scuro"], ["light", "☀️ Chiaro"]]),
      h("h3", {}, "Dadi"),
      seg("diceStyle", [["2d", "2D (piatti)"], ["3d", "3D (rotolano)"]]),
      h("div", { class: "dice-colors" }, DICE_COLORS.map((c) => h("button", {
        type: "button", title: c.name, class: `dice-color ${opts.diceColor === c.id ? "on" : ""}`,
        style: { background: `radial-gradient(circle at 35% 30%, ${c.edge}, ${c.body} 60%)`, color: c.text },
        onclick: () => { set("diceColor", c.id); render(); },
      }, c.name))),
      preview,
      h("p", { class: "muted small" }, "Queste scelte valgono solo su questo dispositivo: ognuno può avere il suo stile. I risultati dei dadi restano sempre quelli decisi dal server."));
    showDice();
  };
  render();
  modal({ title: "Opzioni", body: box, wide: true, actions: [{ label: "Fatto", primary: true }] });
}
