// Piccole utilità per l'interfaccia (nessuna libreria esterna)

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Crea un elemento: h('button', {class:'btn', onclick: fn}, 'Testo', figlio) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v === null || v === undefined) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k === "html") el.innerHTML = v; // usare SOLO con testo fidato (icone)
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, "");
    else el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

// ---------------- Icone (disegnate a mano, SVG inline) ----------------
const P = {
  radio: '<path d="M9 2v5"/><rect x="5" y="7" width="12" height="15" rx="2"/><rect x="8" y="10" width="6" height="4" rx="1"/><path d="M8 17h1M11 17h1M14 17h0M8 19.5h6"/>',
  mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4M8 22h8"/>',
  micOff: '<path d="M3 3l18 18"/><path d="M9 5a3 3 0 0 1 6 0v6M15 13a3 3 0 0 1-5.2 1.7"/><path d="M5 11a7 7 0 0 0 11.5 5.4M19 11a7 7 0 0 1-.5 2.6M12 18v4M8 22h8"/>',
  cam: '<rect x="2" y="6" width="14" height="12" rx="2"/><path d="M16 10l6-3v10l-6-3z"/>',
  camOff: '<path d="M3 3l18 18"/><path d="M2 8v8a2 2 0 0 0 2 2h10M16 14l6 3V7l-6 3v-2a2 2 0 0 0-2-2H8"/>',
  users: '<circle cx="9" cy="8" r="3.5"/><path d="M2 21a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M17 14a5 5 0 0 1 5 5"/>',
  chat: '<path d="M4 4h16v12H8l-4 4z"/>',
  map: '<path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3z"/><path d="M9 3v15M15 6v15"/>',
  dice: '<path d="M12 2l9 5v10l-9 5-9-5V7z"/><path d="M12 2v6M3 7l9 1 9-1M12 8l-6 9h12z"/>',
  crown: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9L7 7M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/>',
  x: '<path d="M5 5l14 14M19 5L5 19"/>',
  share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  phone: '<path d="M4 3h4l2 5-2.5 1.5a11 11 0 0 0 7 7L16 14l5 2v4a2 2 0 0 1-2 2A17 17 0 0 1 2 5a2 2 0 0 1 2-2z"/>',
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  volumeOff: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16 9l5 6M21 9l-5 6"/>',
  expand: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .8-1 1.5V14"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  fullscreen: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 9h3M7 9v3M17 15h-3M17 15v-3"/>',
  fullscreenExit: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 12H7M10 12V9M14 12h3M14 12v3"/>',
  eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6 0 10 7 10 7a17 17 0 0 1-3 3.7M6.6 6.6A17 17 0 0 0 2 12s4 7 10 7a10 10 0 0 0 4.4-1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  shield: '<path d="M12 2l8 3v6c0 5-3.5 9-8 11-4.5-2-8-6-8-11V5z"/>',
  pause: '<rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/>',
  play: '<path d="M7 4l13 8-13 8z"/>',
  exit: '<path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
  wifi: '<path d="M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="1"/>',
  headphones: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><rect x="3" y="15" width="4" height="6" rx="1.5"/><rect x="17" y="15" width="4" height="6" rx="1.5"/>',
  door: '<path d="M5 21V3h11v18M3 21h18"/><circle cx="13" cy="12" r="1"/>',
  key: '<circle cx="7.5" cy="15.5" r="4.5"/><path d="M11 12l9-9M17 6l3 3M14 9l2 2"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',
  check: '<path d="M4 12l5 5L20 6"/>',
  ban: '<circle cx="12" cy="12" r="9"/><path d="M5.6 5.6l12.8 12.8"/>',
  arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
  send: '<path d="M3 11l18-8-8 18-2-8z"/>',
  scroll: '<path d="M6 3h12a2 2 0 0 1 2 2v2h-4M6 3a2 2 0 0 0-2 2v12a4 4 0 0 0 4 4h10a2 2 0 0 0 2-2V9"/><path d="M8 8h8M8 12h8M8 16h5"/>',
  sword: '<path d="M14.5 3H21v6.5L10 20.5 3.5 14z"/><path d="M5 17l-2 4 4-2M7.5 13.5l3 3"/>',
  fog: '<path d="M3 8h13M6 12h15M3 16h12M8 20h10"/>',
  float: '<rect x="3" y="3" width="18" height="18" rx="2"/><rect x="11" y="11" width="8" height="8" rx="1"/>',
  dock: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/>',
  speaker: '<rect x="5" y="2" width="14" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><circle cx="12" cy="6" r="1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  hourglass: '<path d="M6 2h12M6 22h12M7 2c0 6 10 6 10 10S7 16 7 22M17 2c0 6-10 6-10 10s10 4 10 10"/>',
  bell: '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 20a2 2 0 0 0 4 0"/>',
  download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
};
export function icon(name, cls = "") {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ""}</svg>`;
}
export function iconEl(name, cls = "") {
  const span = document.createElement("span");
  span.className = "ico-wrap";
  span.innerHTML = icon(name, cls);
  return span;
}

// ---------------- Notifiche e finestre ----------------
export function toast(msg, type = "info", { timeout = 4200, action } = {}) {
  const box = document.getElementById("toasts");
  const t = h("div", { class: `toast toast-${type}`, role: "status" }, h("span", {}, msg));
  if (action) {
    t.append(h("button", { class: "btn btn-sm", onclick: () => { action.onClick(); t.remove(); } }, action.label));
  }
  t.append(h("button", { class: "toast-x", "aria-label": "Chiudi", html: icon("x"), onclick: () => t.remove() }));
  box.append(t);
  if (timeout) setTimeout(() => t.classList.add("out"), timeout);
  if (timeout) setTimeout(() => t.remove(), timeout + 400);
  return t;
}

export function modal({ title, body, actions = [], wide = false, onClose, dismissable = true, cls = "" }) {
  const close = () => { wrap.remove(); document.removeEventListener("keydown", onKey); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape" && dismissable) close(); };
  const content = h("div", { class: "modal-body" });
  if (typeof body === "function") body(content, close); else if (body) content.append(body);
  const foot = h("div", { class: "modal-actions" },
    actions.map((a) => h("button", {
      class: `btn ${a.primary ? "btn-primary" : ""} ${a.danger ? "btn-danger" : ""}`,
      onclick: async (e) => {
        if (a.onClick) {
          const btn = e.currentTarget; btn.disabled = true;
          try { const r = await a.onClick(close); if (r !== false && a.close !== false) close(); }
          catch (err) { toast(err.message || String(err), "error"); }
          finally { btn.disabled = false; }
        } else close();
      },
    }, a.label)));
  const dialog = h("div", { class: `modal ${wide ? "modal-wide" : ""} ${cls}`, role: "dialog", "aria-modal": "true" },
    h("div", { class: "modal-head" },
      h("h2", {}, title),
      dismissable ? h("button", { class: "icon-btn", "aria-label": "Chiudi", html: icon("x"), onclick: close }) : null),
    content, actions.length ? foot : null);
  const wrap = h("div", { class: "modal-wrap", onmousedown: (e) => { if (e.target === wrap && dismissable) close(); } }, dialog);
  document.body.append(wrap);
  document.addEventListener("keydown", onKey);
  setTimeout(() => dialog.querySelector("input:not([type=checkbox]),textarea,select")?.focus(), 30);
  return { close, el: dialog, content };
}

export function confirmDialog(text, { okLabel = "Conferma", danger = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal({
      title: "Conferma",
      body: h("p", {}, text),
      onClose: () => { if (!done) resolve(false); },
      actions: [
        { label: "Annulla", onClick: () => { done = true; resolve(false); } },
        { label: okLabel, primary: !danger, danger, onClick: () => { done = true; resolve(true); } },
      ],
    });
  });
}

// ---------------- Varie ----------------
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast("Copiato negli appunti", "ok", { timeout: 1800 }); }
  catch { prompt("Copia questo testo:", text); }
}

export function fmtTime(ts) {
  const d = new Date(ts);
  const today = new Date();
  const hm = d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return hm;
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) + " " + hm;
}

export function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

export function formatCode(code = "") {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

export const isMobile = () => window.matchMedia("(max-width: 899px)").matches;

export function isTypingTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

// Suoni brevi generati al volo (nessun file audio esterno)
let actx;
export function beep(kind = "tx-on") {
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === "suspended") actx.resume();
    const tones = {
      "tx-on": [[1200, 0.05], [1600, 0.05]],
      "tx-off": [[1600, 0.04], [900, 0.08]],
      "private": [[700, 0.08], [1050, 0.12]],
      "message": [[880, 0.06], [1320, 0.08]],
      "alert": [[520, 0.12], [520, 0.12]],
    }[kind] || [[1000, 0.05]];
    let t = actx.currentTime;
    for (const [f, d] of tones) {
      const o = actx.createOscillator(); const g = actx.createGain();
      o.type = "square"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.06, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d);
      o.connect(g).connect(actx.destination);
      o.start(t); o.stop(t + d + 0.02);
      t += d + 0.015;
    }
  } catch { /* audio non disponibile */ }
}

export function loadPref(key, def) {
  try { const v = localStorage.getItem("dndva:" + key); return v === null ? def : JSON.parse(v); } catch { return def; }
}
export function savePref(key, val) {
  try { localStorage.setItem("dndva:" + key, JSON.stringify(val)); } catch { /* storage pieno o bloccato */ }
}

/** Riduce un'immagine scelta dall'utente a un piccolo ritratto JPEG (data URL) */
export function resizeImage(file, size = 192) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const c = document.createElement("canvas");
      c.width = c.height = size;
      const ctx = c.getContext("2d");
      const s = Math.min(img.width, img.height);
      ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Immagine non valida")); };
    img.src = url;
  });
}

export function avatar(name, portrait, cls = "") {
  if (portrait) return h("img", { class: `avatar ${cls}`, src: portrait, alt: "" });
  return h("span", { class: `avatar avatar-txt ${cls}` }, initials(name));
}
