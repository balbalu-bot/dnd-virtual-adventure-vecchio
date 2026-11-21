// =====================================================================
//  Tavolo virtuale: dati, tempo reale, barra strumenti, pannelli del DM
// =====================================================================
import { sb, rpc, must } from "../supabase.js";
import { store, isDM, memberName, emit } from "../store.js";
import { h, icon, toast, modal, confirmDialog, loadPref, savePref, resizeImage } from "../ui.js";
import { MapView } from "./engine.js";
import { gridOf, snap } from "./grid.js";

const KINDS = {
  pc: "Personaggio giocante", npc: "PNG", monster: "Mostro", object: "Oggetto",
  door: "Porta", trap: "Trappola", treasure: "Tesoro", note: "Nota / segnaposto",
};
const SIZES = [[0.5, "Minuscola (½ casella)"], [1, "Piccola / Media (1)"], [2, "Grande (2×2)"], [3, "Enorme (3×3)"], [4, "Mastodontica (4×4)"]];
const COLORS = ["#b3261e", "#2e7d32", "#1565c0", "#6a1b9a", "#ef6c00", "#00838f", "#c2185b", "#f9a825", "#4e342e", "#37474f"];
const DRAW_COLORS = ["#b3261e", "#1565c0", "#2e7d32", "#f9a825", "#6a1b9a", "#111111", "#ffffff"];

const T = {
  gameId: null, view: null, els: {}, maps: new Map(), viewMapId: null,
  urls: new Map(), sendBroadcast: () => {}, listEl: null,
};

export function userColor(id = "") {
  let hsh = 0; for (const c of id) hsh = (hsh * 31 + c.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hsh) % 360} 75% 62%)`;
}

// ================================================================== montaggio
export function mountTable(container, listContainer, { gameId, sendBroadcast }) {
  T.gameId = gameId;
  T.sendBroadcast = sendBroadcast;
  T.listEl = listContainer;
  T.maps = new Map(); T.viewMapId = null; T.urls = new Map();

  const e = T.els = {};
  e.title = h("button", { class: "map-title", title: "Mappe dell'avventura", onclick: () => isDM() ? openMapManager() : null });
  e.badge = h("span", { class: "map-badge" });
  e.showBtn = h("button", { class: "btn btn-sm btn-gold", html: `${icon("eye")} Mostra ai giocatori`, onclick: () => showToPlayers(T.viewMapId) });
  e.tools = h("div", { class: "map-tools" });
  e.dmTools = h("div", { class: "map-tools dm-only" });
  e.zoom = h("div", { class: "map-tools" },
    toolBtn("zoomOut", "−", "Rimpicciolisci", () => T.view?.zoomAt(1 / 1.25)),
    toolBtn("zoomIn", "+", "Ingrandisci", () => T.view?.zoomAt(1.25)),
    h("button", { class: "tool", title: "Adatta allo schermo", html: icon("expand"), onclick: () => T.view?.fit() }));
  e.bar = h("div", { class: "map-toolbar" },
    h("div", { class: "map-toolbar-left" }, e.title, e.badge, e.showBtn),
    e.tools, e.dmTools, e.zoom);
  e.wrap = h("div", { class: "map-wrap" });
  e.empty = h("div", { class: "map-empty parchment" });
  e.tokenBar = h("div", { class: "token-bar", hidden: true });
  e.drawBar = h("div", { class: "draw-bar", hidden: true });
  e.wrap.append(e.empty, e.tokenBar, e.drawBar);
  container.append(e.bar, e.wrap);

  T.view = new MapView(e.wrap, {
    isDM, myId: store.user.id, myColor: userColor(store.user.id),
    onSelect: renderTokenBar,
    onTokenDrag: (t, x, y) => { if (t && !t.hidden) T.sendBroadcast({ t: "drag", map: T.viewMapId, id: t.id, x, y }); },
    onTokenDrop: moveToken,
    onTokenDblClick: (t) => { if (isDM()) editToken(t); },
    onDeleteKey: (t) => { if (isDM() && t) deleteToken(t); },
    onPing: (x, y) => T.sendBroadcast({ t: "ping", map: T.viewMapId, x, y, name: store.me?.display_name, color: userColor(store.user.id) }),
    onMeasure: (pts) => T.sendBroadcast({ t: "measure", map: T.viewMapId, pts, uid: store.user.id, name: store.me?.display_name, color: userColor(store.user.id) }),
    onDrawingDone: saveDrawing,
    onTextAt: addTextAt,
    onFogOp: addFogOp,
  });
  // trasparente sotto la barra: lo strato del canvas va sotto i pannelli flottanti
  e.wrap.prepend(T.view.canvas);
  renderTools();
  renderDrawBar();
  return T;
}

export function unmountTable() {
  T.view?.destroy(); T.view = null;
  T.maps.clear();
}

function toolBtn(id, label, title, onclick, active) {
  return h("button", { class: `tool ${active ? "active" : ""}`, dataset: { tool: id }, title, onclick }, label);
}

// ================================================================== caricamento
export async function reloadTable() {
  if (!T.view) return;
  const rows = await must(sb.from("maps").select("*").eq("game_id", T.gameId).order("sort").order("created_at"));
  T.maps = new Map(rows.map((m) => [m.id, m]));
  const active = store.game?.active_map_id || null;
  let target = T.viewMapId;
  if (!isDM()) target = active;
  else if (!target || !T.maps.has(target)) target = active && T.maps.has(active) ? active : (rows[0]?.id || null);
  await openMap(target, { force: true });
}

async function imageUrl(path) {
  if (!path) return null;
  const c = T.urls.get(path);
  if (c && c.exp > Date.now()) return c.url;
  const { data, error } = await sb.storage.from("maps").createSignedUrl(path, 60 * 60 * 12);
  if (error) { toast("Immagine della mappa non disponibile: " + error.message, "error"); return null; }
  T.urls.set(path, { url: data.signedUrl, exp: Date.now() + 11 * 3600 * 1000 });
  return data.signedUrl;
}

async function openMap(id, { force = false } = {}) {
  if (!T.view) return;
  if (!force && id === T.viewMapId) return;
  T.viewMapId = id;
  const map = id ? T.maps.get(id) : null;
  if (!map) {
    T.view.setMap(null); T.view.setTokens([]); T.view.setDrawings([]);
    renderHeader(); renderList();
    return;
  }
  const [url, tokens, drawings] = await Promise.all([
    imageUrl(map.image_path),
    must(sb.from("tokens").select("*").eq("map_id", id)),
    must(sb.from("drawings").select("*").eq("map_id", id).order("created_at")),
  ]);
  if (T.viewMapId !== id) return;
  T.view.setMap(map, url);
  T.view.setTokens(tokens);
  T.view.setDrawings(drawings);
  renderHeader(); renderList();
}

// ================================================================== tempo reale
export const tableRealtime = {
  map(p) {
    if (p.eventType === "DELETE") {
      const id = p.old?.id; if (!id || !T.maps.has(id)) return;
      T.maps.delete(id);
      if (id === T.viewMapId) reloadTable();
      else renderHeader();
      return;
    }
    const m = p.new; if (!m?.id || m.game_id !== T.gameId) return;
    const prev = T.maps.get(m.id);
    T.maps.set(m.id, m);
    if (m.id === T.viewMapId) {
      const imgChanged = !prev || prev.image_path !== m.image_path;
      if (imgChanged) openMap(m.id, { force: true });
      else { T.view.setMap(m, T.urls.get(m.image_path)?.url); }
    }
    renderHeader();
  },
  token(p) {
    if (!T.view) return;
    if (p.eventType === "DELETE") { if (p.old?.id) { T.view.removeToken(p.old.id); renderList(); } return; }
    const t = p.new; if (!t?.id) return;
    if (t.map_id === T.viewMapId) T.view.upsertToken(t);
    else T.view.removeToken(t.id);
    if (T.view.selected === t.id) renderTokenBar(T.view.tokens.get(t.id));
    renderList();
  },
  drawing(p) {
    if (!T.view) return;
    if (p.eventType === "DELETE") { if (p.old?.id) T.view.removeDrawing(p.old.id); return; }
    const d = p.new; if (d?.map_id === T.viewMapId) T.view.upsertDrawing(d);
  },
  signal(s) {
    if (!T.view || !s) return;
    if (s.kind === "token_gone" && !isDM()) { T.view.removeToken(s.ref_id); renderList(); }
    if (s.kind === "drawing_gone") T.view.removeDrawing(s.ref_id);
  },
  broadcast(msg) {
    if (!T.view || !msg || msg.map !== T.viewMapId) return;
    if (msg.t === "ping") T.view.addPing(msg.x, msg.y, msg.color || "#7fd6ff", msg.name);
    if (msg.t === "measure") T.view.showRemoteMeasure(msg.uid, msg.pts, msg.name, msg.color);
    if (msg.t === "drag") T.view.showRemoteDrag(msg.id, msg.x, msg.y);
  },
  activeMapChanged() {
    if (!T.view) return;
    if (!isDM()) {
      reloadTable();
      toast("Il Dungeon Master ha cambiato scena.", "info");
    } else renderHeader();
  },
};

// ================================================================== intestazione e strumenti
function renderHeader() {
  const e = T.els; if (!e.title) return;
  const dm = isDM();
  const map = T.maps.get(T.viewMapId);
  const active = store.game?.active_map_id;
  e.title.innerHTML = `${icon("map")} <span>${map ? escapeHtml(map.name) : "Nessuna mappa"}</span>${dm ? ' <span class="caret">▾</span>' : ""}`;
  e.title.disabled = !dm;
  e.badge.hidden = !dm || !map;
  e.badge.className = `map-badge ${map && map.id === active ? "live" : "draft"}`;
  e.badge.textContent = map && map.id === active ? "● visibile ai giocatori" : "bozza: la vedi solo tu";
  e.showBtn.hidden = !dm || !map || map.id === active;
  e.dmTools.hidden = !dm || !map;
  e.empty.hidden = !!map;
  if (!map) {
    e.empty.replaceChildren(
      h("div", { class: "compass-small", html: icon("map") }),
      dm ? h("div", {},
        h("h3", {}, "Prepara la prima scena"),
        h("p", {}, "Crea una mappa vuota con griglia o carica un'immagine tua (pianta del dungeon, villaggio, campo di battaglia)."),
        h("button", { class: "btn btn-primary", html: `${icon("plus")} Nuova mappa`, onclick: () => newMapDialog() }))
        : h("div", {},
          h("h3", {}, "In attesa della scena"),
          h("p", {}, "Il Dungeon Master non ha ancora mostrato una mappa. Nel frattempo si gioca a voce!")));
  }
  renderTools();
}

function renderTools() {
  const e = T.els; if (!e.tools) return;
  const cur = T.view?.tool || "select";
  const mk = (tool, ic, title) => h("button", {
    class: `tool ${cur === tool ? "active" : ""}`, title, html: ic,
    onclick: () => { T.view.setTool(tool); savePref("mapTool", tool); renderTools(); renderDrawBar(); },
  });
  e.tools.replaceChildren(
    mk("select", "✋", "Seleziona e muovi (trascina il vuoto per spostare la vista)"),
    mk("measure", "📏", "Righello: misura le distanze"),
    mk("ping", "📍", "Segnala un punto a tutti (anche Alt+clic)"),
    mk("draw", "✏️", "Disegno a mano libera"),
    mk("text", "🅰", "Nota di testo sulla mappa"));
  const map = T.maps.get(T.viewMapId);
  e.dmTools.replaceChildren(
    mk("fog-reveal", "🌤", "Nebbia: trascina per RIVELARE un'area"),
    mk("fog-cover", "🌫", "Nebbia: trascina per COPRIRE un'area"),
    h("button", { class: "tool", title: "Opzioni nebbia di guerra", onclick: fogMenu }, map?.fog_enabled ? "Nebbia ✓" : "Nebbia"),
    h("button", { class: "tool tool-wide", title: "Aggiungi un elemento sulla mappa", html: `${icon("plus")} Elemento`, onclick: () => addTokenDialog() }));
}

function renderDrawBar() {
  const bar = T.els.drawBar; if (!bar) return;
  const tool = T.view?.tool;
  bar.hidden = !(tool === "draw" || tool === "text");
  if (bar.hidden) return;
  const st = T.view.drawStyle;
  bar.replaceChildren(
    ...DRAW_COLORS.map((c) => h("button", {
      class: `swatch ${st.color === c ? "active" : ""}`, style: { background: c }, title: c,
      onclick: () => { T.view.setDrawStyle({ color: c }); renderDrawBar(); },
    })),
    tool === "draw" ? h("select", { onchange: (ev) => T.view.setDrawStyle({ width: Number(ev.target.value) }) },
      [[2, "Sottile"], [4, "Medio"], [8, "Spesso"], [16, "Pennarello"]].map(([v, l]) => h("option", { value: v, selected: st.width === v }, l))) : null,
    isDM() ? h("label", { class: "check small" }, h("input", { type: "checkbox", checked: st.dmOnly, onchange: (ev) => T.view.setDrawStyle({ dmOnly: ev.target.checked }) }), " solo DM") : null,
    h("button", { class: "btn btn-sm", onclick: clearDrawings }, isDM() ? "Cancella disegni" : "Cancella i miei"));
}

function escapeHtml(s) { return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

// ================================================================== elenco elementi (colonna sinistra)
function renderList() {
  const box = T.listEl; if (!box || !T.view) return;
  const toks = [...T.view.tokens.values()].sort((a, b) => (a.kind === "pc" ? 0 : 1) - (b.kind === "pc" ? 0 : 1) || a.name.localeCompare(b.name));
  if (!T.viewMapId) { box.replaceChildren(h("p", { class: "muted small" }, "Nessuna mappa aperta.")); return; }
  if (!toks.length) { box.replaceChildren(h("p", { class: "muted small" }, isDM() ? "Nessun elemento. Usa «+ Elemento» o «Aggiungi i personaggi»." : "Nessun elemento visibile.")); }
  else {
    box.replaceChildren(...toks.map((t) => h("div", { class: `tok-row ${t.hidden ? "is-hidden" : ""}` },
      h("span", { class: "tok-dot", style: { background: t.kind === "door" ? "#6b4423" : t.kind === "trap" ? "#d0453a" : t.color } }),
      h("button", { class: "tok-name", title: "Centra sulla mappa", onclick: () => { T.view.centerOn(t.x, t.y); T.view.select(t.id); } },
        t.name || KINDS[t.kind], h("small", { class: "muted" }, " · " + KINDS[t.kind] + (t.owner_id ? " di " + memberName(t.owner_id) : ""))),
      isDM() ? h("button", { class: "icon-btn", title: t.hidden ? "Mostra ai giocatori" : "Nascondi ai giocatori", html: icon(t.hidden ? "eyeOff" : "eye"), onclick: () => patchToken(t, { hidden: !t.hidden }) }) : null)));
  }
  if (isDM()) box.append(h("button", { class: "btn btn-sm", style: { marginTop: ".5em" }, html: `${icon("users")} Aggiungi i personaggi`, onclick: addPlayerTokens }));
}

// ================================================================== token: movimento e azioni
async function moveToken(t, x, y, prev) {
  try {
    await rpc("move_token", { p_token: t.id, p_x: Math.round(x * 10) / 10, p_y: Math.round(y * 10) / 10 });
    T.sendBroadcast({ t: "drag", map: T.viewMapId, id: t.id, x, y });
  } catch (err) {
    t.x = prev.x; t.y = prev.y; T.view.invalidate();
    toast(err.message, "error");
  }
}

async function patchToken(t, patch) {
  try {
    const row = await must(sb.from("tokens").update(patch).eq("id", t.id).select().single());
    T.view.upsertToken(row); renderList(); renderTokenBar(row);
    return row;
  } catch (e) { toast(e.message, "error"); return null; }
}

async function deleteToken(t) {
  if (!(await confirmDialog(`Eliminare «${t.name || KINDS[t.kind]}» dalla mappa?`, { danger: true, okLabel: "Elimina" }))) return;
  try { await must(sb.from("tokens").delete().eq("id", t.id)); T.view.removeToken(t.id); renderList(); }
  catch (e) { toast(e.message, "error"); }
}

function renderTokenBar(t) {
  const bar = T.els.tokenBar; if (!bar) return;
  if (!t) { bar.hidden = true; return; }
  const dm = isDM();
  const acts = [];
  if (dm) {
    acts.push(h("button", { class: "btn btn-sm", html: `${icon("gear")} Modifica`, onclick: () => editToken(t) }));
    acts.push(h("button", { class: "btn btn-sm", html: icon(t.hidden ? "eye" : "eyeOff") + (t.hidden ? " Mostra" : " Nascondi"), onclick: () => patchToken(t, { hidden: !t.hidden }) }));
    if (t.kind === "door") {
      acts.push(h("button", { class: "btn btn-sm", onclick: () => patchToken(t, { state: { ...t.state, open: !t.state?.open } }) }, t.state?.open ? "🚪 Chiudi" : "🚪 Apri"));
      acts.push(h("button", { class: "btn btn-sm", title: "Ruota di 90°", onclick: () => patchToken(t, { rotation: ((Number(t.rotation) || 0) + 90) % 360 }) }, "↻"));
    }
    if (t.kind === "trap") {
      acts.push(t.state?.triggered
        ? h("button", { class: "btn btn-sm", onclick: () => patchToken(t, { state: { ...t.state, triggered: false }, hidden: true }) }, "Ripristina")
        : h("button", { class: "btn btn-sm btn-danger", onclick: () => triggerTrap(t) }, "⚠ Attiva trappola"));
    }
    if (t.kind === "treasure") acts.push(h("button", { class: "btn btn-sm", onclick: () => patchToken(t, { state: { ...t.state, taken: !t.state?.taken } }) }, t.state?.taken ? "Rimetti" : "💰 Raccolto"));
    if (["pc", "npc", "monster"].includes(t.kind)) acts.push(h("button", { class: "btn btn-sm", title: "Segna come a terra / privo di sensi", onclick: () => patchToken(t, { state: { ...t.state, down: !t.state?.down } }) }, t.state?.down ? "Rialza" : "✖ A terra"));
    acts.push(h("button", { class: "btn btn-sm", title: t.locked ? "Il giocatore può di nuovo muoverlo" : "Impedisci al giocatore di muoverlo", onclick: () => patchToken(t, { locked: !t.locked }) }, t.locked ? "🔓" : "🔒"));
    acts.push(h("button", { class: "btn btn-sm btn-danger", title: "Elimina", html: icon("x"), onclick: () => deleteToken(t) }));
  }
  const note = t.kind === "note" && t.state?.text ? h("div", { class: "token-note" }, t.state.text) : null;
  bar.replaceChildren(
    h("div", { class: "token-bar-head" },
      h("strong", {}, t.name || KINDS[t.kind]),
      h("span", { class: "muted small" }, KINDS[t.kind] + (t.owner_id ? " · " + memberName(t.owner_id) : "") + (t.hidden ? " · nascosto" : "") + (t.locked ? " · bloccato" : "")),
      h("button", { class: "icon-btn", html: icon("x"), onclick: () => T.view.select(null) })),
    ...[note, acts.length ? h("div", { class: "row-btns" }, acts) : null].filter(Boolean));
  bar.hidden = false;
}

async function triggerTrap(t) {
  const row = await patchToken(t, { hidden: false, state: { ...t.state, triggered: true } });
  if (!row) return;
  T.sendBroadcast({ t: "ping", map: T.viewMapId, x: t.x, y: t.y, name: "⚠ " + (t.name || "Trappola"), color: "#ff5a4a" });
  T.view.addPing(t.x, t.y, "#ff5a4a", "⚠ " + (t.name || "Trappola"));
  rpc("announce", { p_game: T.gameId, p_text: `⚠️ Trappola attivata: ${t.name || "trappola"}!` }).catch(() => {});
}

// ================================================================== disegni e note
async function saveDrawing(d) {
  if (!T.viewMapId) return;
  try {
    const row = await must(sb.from("drawings").insert({
      game_id: T.gameId, map_id: T.viewMapId, kind: d.kind, points: d.points, color: d.color,
      width: Math.max(0.5, Math.min(60, d.width || 4)), text: d.text || null, dm_only: isDM() && !!T.view.drawStyle.dmOnly,
    }).select().single());
    T.view.upsertDrawing(row);
  } catch (e) { toast("Disegno non salvato: " + e.message, "error"); }
}

function addTextAt(x, y) {
  const ta = h("textarea", { rows: 3, maxlength: 500, placeholder: "es. Qui c'è un altare con rune" });
  modal({
    title: "Nota sulla mappa",
    body: h("div", {}, ta, isDM() ? h("p", { class: "muted small" }, T.view.drawStyle.dmOnly ? "Sarà visibile solo a te (opzione «solo DM» attiva)." : "Sarà visibile a tutti. Per una nota segreta spunta «solo DM».") : null),
    actions: [{ label: "Annulla" }, {
      label: "Aggiungi", primary: true,
      onClick: async () => { if (ta.value.trim()) await saveDrawing({ kind: "text", points: [[x, y]], color: T.view.drawStyle.color, width: 2, text: ta.value.trim() }); },
    }],
  });
}

async function clearDrawings() {
  const dm = isDM();
  if (!(await confirmDialog(dm ? "Cancellare TUTTI i disegni e le note di questa mappa?" : "Cancellare i tuoi disegni su questa mappa?", { danger: true, okLabel: "Cancella" }))) return;
  let q = sb.from("drawings").delete().eq("map_id", T.viewMapId);
  if (!dm) q = q.eq("author_id", store.user.id);
  try {
    await must(q);
    for (const d of [...T.view.drawings.values()]) if (dm || d.author_id === store.user.id) T.view.removeDrawing(d.id);
  } catch (e) { toast(e.message, "error"); }
}

// ================================================================== nebbia di guerra
async function addFogOp(op) {
  const map = T.maps.get(T.viewMapId); if (!map) return;
  if (!map.fog_enabled) { toast("Prima attiva la nebbia di guerra (pulsante «Nebbia»).", "info"); return; }
  let fog = [...(map.fog || []), op];
  if (fog.length > 400) fog = fog.slice(-400);
  map.fog = fog; T.view.setFog(fog);
  await saveFog(map, { fog });
}

async function saveFog(map, patch) {
  try {
    const row = await must(sb.from("maps").update(patch).eq("id", map.id).select().single());
    T.maps.set(row.id, row); T.view.setMap(row, T.urls.get(row.image_path)?.url); renderTools();
  } catch (e) { toast("Nebbia non salvata: " + e.message, "error"); }
}

function fogMenu() {
  const map = T.maps.get(T.viewMapId); if (!map) return;
  modal({
    title: "Nebbia di guerra",
    body: h("div", {},
      h("p", {}, "La nebbia copre la mappa ai giocatori. Tu la vedi semitrasparente. Usa 🌤 per rivelare e 🌫 per coprire trascinando un rettangolo."),
      h("p", { class: "muted small" }, "Mostri e PNG sotto la nebbia non si vedono, ma per una sicurezza totale (anche contro chi «sbircia» nel browser) usa «Nascondi»: un elemento nascosto non viene proprio inviato ai giocatori.")),
    actions: [
      { label: map.fog_enabled ? "Disattiva nebbia" : "Attiva nebbia (tutto coperto)", primary: !map.fog_enabled, onClick: () => saveFog(map, { fog_enabled: !map.fog_enabled }) },
      { label: "Rivela tutto", onClick: () => saveFog(map, { fog: [{ op: "reveal", shape: "all" }] }) },
      { label: "Copri tutto", onClick: () => saveFog(map, { fog: [] }) },
    ],
  });
}

// ================================================================== scene / mappe (DM)
async function showToPlayers(id) {
  try { await rpc("set_active_map", { p_game: T.gameId, p_map: id }); store.game.active_map_id = id; renderHeader(); toast("Ora i giocatori vedono questa mappa.", "ok"); }
  catch (e) { toast(e.message, "error"); }
}

function openMapManager() {
  const active = store.game?.active_map_id;
  const list = [...T.maps.values()];
  modal({
    title: "Mappe dell'avventura",
    wide: true,
    body: (box, close) => box.append(
      h("p", { class: "muted small" }, "Prepara le scene in anticipo: una mappa diventa visibile ai giocatori solo quando premi «Mostra ai giocatori»."),
      list.length ? h("div", { class: "map-list" }, list.map((m) => h("div", { class: `map-row ${m.id === T.viewMapId ? "current" : ""}` },
        h("div", { class: "map-row-main" },
          h("strong", {}, m.name),
          h("span", { class: "muted small" }, ` · ${m.grid_type === "hex" ? "esagoni" : m.grid_type === "square" ? "quadretti" : "senza griglia"} · ${m.image_path ? "immagine" : "vuota"}`),
          m.id === active ? h("span", { class: "pill pill-live" }, "visibile ai giocatori") : null),
        h("div", { class: "row-btns" },
          h("button", { class: "btn btn-sm", onclick: () => { close(); openMap(m.id); } }, "Apri"),
          m.id !== active ? h("button", { class: "btn btn-sm btn-primary", onclick: async () => { await showToPlayers(m.id); close(); openMap(m.id); } }, "Mostra ai giocatori") : null,
          h("button", { class: "btn btn-sm", onclick: () => { close(); mapSettings(m); } }, "Impostazioni"),
          h("button", {
            class: "btn btn-sm btn-danger",
            onclick: async () => {
              if (!(await confirmDialog(`Eliminare la mappa «${m.name}» con tutti i suoi elementi?`, { danger: true, okLabel: "Elimina" }))) return;
              try {
                await must(sb.from("maps").delete().eq("id", m.id));
                if (m.image_path) sb.storage.from("maps").remove([m.image_path]).catch(() => {});
                T.maps.delete(m.id); close(); reloadTable();
              } catch (e) { toast(e.message, "error"); }
            },
          }, "Elimina")))))
        : h("p", {}, "Nessuna mappa ancora."),
      active ? h("button", { class: "btn btn-sm btn-ghost", onclick: async () => { await showToPlayers(null); close(); } }, "Nascondi la mappa ai giocatori (schermo vuoto)") : null),
    actions: [{ label: "Chiudi" }, { label: "+ Nuova mappa", primary: true, onClick: () => newMapDialog() }],
  });
}

function gridFields(m = {}) {
  const f = {
    name: h("input", { maxlength: 80, value: m.name || "", placeholder: "es. Taverna del Drago Verde" }),
    type: h("select", {}, [["square", "Quadretti"], ["hex", "Esagoni"], ["none", "Nessuna griglia"]].map(([v, l]) => h("option", { value: v, selected: (m.grid_type || "square") === v }, l))),
    size: h("input", { type: "number", min: 10, max: 600, value: m.grid_size ?? 70 }),
    feet: h("input", { type: "number", min: 1, max: 1000, step: "0.5", value: m.feet_per_cell ?? 5 }),
    rule: h("select", {}, [["5e", "Diagonale = 1 casella (regola base)"], ["5-10-5", "Diagonali alternate 5-10-5"], ["euclid", "Distanza reale"]].map(([v, l]) => h("option", { value: v, selected: (m.diagonal_rule || "5e") === v }, l))),
    ox: h("input", { type: "number", value: m.grid_offset_x ?? 0, step: "1" }),
    oy: h("input", { type: "number", value: m.grid_offset_y ?? 0, step: "1" }),
    color: h("input", { type: "color", value: m.grid_color || "#2a1c0f" }),
    opacity: h("input", { type: "range", min: 0, max: 1, step: 0.05, value: m.grid_opacity ?? 0.35 }),
    bg: h("input", { type: "color", value: m.bg_color || "#d9c497" }),
  };
  return f;
}
function gridValues(f) {
  return {
    name: f.name.value.trim(), grid_type: f.type.value,
    grid_size: Math.max(10, Math.min(600, Number(f.size.value) || 70)),
    feet_per_cell: Math.max(1, Number(f.feet.value) || 5), diagonal_rule: f.rule.value,
    grid_offset_x: Number(f.ox.value) || 0, grid_offset_y: Number(f.oy.value) || 0,
    grid_color: f.color.value, grid_opacity: Number(f.opacity.value), bg_color: f.bg.value,
  };
}

function newMapDialog() {
  const f = gridFields();
  let file = null;
  const fileIn = h("input", { type: "file", accept: "image/*", onchange: () => { file = fileIn.files[0] || null; info.textContent = file ? `${file.name} (${Math.round(file.size / 1024)} KB)` : ""; } });
  const info = h("span", { class: "muted small" });
  const cols = h("input", { type: "number", min: 1, max: 200, placeholder: "es. 30" });
  const rows = h("input", { type: "number", min: 1, max: 200, value: 20 });
  modal({
    title: "Nuova mappa",
    wide: true,
    body: h("div", { class: "form-cols" },
      h("div", {},
        h("label", {}, "Nome", f.name),
        h("label", {}, "Immagine della mappa (facoltativa)", fileIn), info,
        h("p", { class: "muted small" }, "JPG, PNG o WebP. Viene ridotta automaticamente (max 4096 px). Senza immagine si crea una mappa vuota con griglia."),
        h("div", { class: "row2" }, h("label", {}, "Caselle in larghezza", cols), h("label", {}, "Righe (solo mappa vuota)", rows)),
        h("p", { class: "muted small" }, "Per un'immagine con griglia già disegnata: scrivi quante caselle ha in larghezza e la griglia si allinea da sola (poi la rifinisci in «Impostazioni»).")),
      h("div", {},
        h("div", { class: "row2" }, h("label", {}, "Griglia", f.type), h("label", {}, "Dimensione casella (px)", f.size)),
        h("div", { class: "row2" }, h("label", {}, "Piedi per casella", f.feet), h("label", {}, "Diagonali", f.rule)),
        h("div", { class: "row2" }, h("label", {}, "Colore griglia", f.color), h("label", {}, "Colore sfondo", f.bg)),
        h("label", {}, "Intensità griglia", f.opacity))),
    actions: [{ label: "Annulla" }, {
      label: "Crea mappa", primary: true,
      onClick: async () => {
        const v = gridValues(f);
        if (!v.name) { toast("Dai un nome alla mappa", "error"); return false; }
        let width, height, image_path = null;
        if (file) {
          toast("Caricamento dell'immagine…", "info", { timeout: 2500 });
          const img = await prepareMapImage(file);
          width = img.width; height = img.height;
          image_path = `${T.gameId}/${crypto.randomUUID()}.jpg`;
          const { error } = await sb.storage.from("maps").upload(image_path, img.blob, { contentType: "image/jpeg", upsert: false });
          if (error) throw new Error("Caricamento non riuscito: " + error.message + ". Hai eseguito schema-fase2.sql?");
          if (Number(cols.value) > 0) v.grid_size = Math.round(width / Number(cols.value) * 100) / 100;
        } else {
          const c = Math.max(1, Math.min(200, Number(cols.value) || 30));
          const r = Math.max(1, Math.min(200, Number(rows.value) || 20));
          width = Math.round(c * v.grid_size); height = Math.round(r * v.grid_size);
          if (v.grid_type === "hex") height = Math.round(r * v.grid_size * 0.866 + v.grid_size * 0.6);
        }
        const row = await must(sb.from("maps").insert({ ...v, game_id: T.gameId, image_path, width: Math.min(12000, width), height: Math.min(12000, height), sort: T.maps.size }).select().single());
        T.maps.set(row.id, row);
        await openMap(row.id, { force: true });
        toast("Mappa creata. È una bozza: premi «Mostra ai giocatori» quando sei pronto.", "ok", { timeout: 6000 });
      },
    }],
  });
}

function mapSettings(m) {
  const f = gridFields(m);
  const preview = () => { if (m.id === T.viewMapId) T.view.setMap({ ...m, ...gridValues(f), name: m.name }, T.urls.get(m.image_path)?.url); };
  Object.values(f).forEach((el) => el.addEventListener("input", preview));
  modal({
    title: "Impostazioni mappa",
    wide: true,
    onClose: () => { if (m.id === T.viewMapId) T.view.setMap(T.maps.get(m.id), T.urls.get(m.image_path)?.url); },
    body: h("div", { class: "form-cols" },
      h("div", {},
        h("label", {}, "Nome", f.name),
        h("div", { class: "row2" }, h("label", {}, "Griglia", f.type), h("label", {}, "Dimensione casella (px)", f.size)),
        h("div", { class: "row2" }, h("label", {}, "Spostamento griglia X", f.ox), h("label", {}, "Spostamento griglia Y", f.oy)),
        h("p", { class: "muted small" }, "Modifica dimensione e spostamento finché la griglia coincide con quella disegnata sull'immagine: l'anteprima si aggiorna dal vivo.")),
      h("div", {},
        h("div", { class: "row2" }, h("label", {}, "Piedi per casella", f.feet), h("label", {}, "Diagonali", f.rule)),
        h("div", { class: "row2" }, h("label", {}, "Colore griglia", f.color), h("label", {}, "Colore sfondo", f.bg)),
        h("label", {}, "Intensità griglia", f.opacity))),
    actions: [{ label: "Annulla" }, {
      label: "Salva", primary: true,
      onClick: async () => {
        const v = gridValues(f); if (!v.name) v.name = m.name;
        const row = await must(sb.from("maps").update(v).eq("id", m.id).select().single());
        T.maps.set(row.id, row);
        if (row.id === T.viewMapId) T.view.setMap(row, T.urls.get(row.image_path)?.url);
        renderHeader();
      },
    }],
  });
}

function prepareMapImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 4096;
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const w = Math.round(img.width * k), hgt = Math.round(img.height * k);
      const c = document.createElement("canvas"); c.width = w; c.height = hgt;
      c.getContext("2d").drawImage(img, 0, 0, w, hgt);
      URL.revokeObjectURL(url);
      c.toBlob((blob) => blob ? resolve({ blob, width: w, height: hgt }) : reject(new Error("Conversione immagine non riuscita")), "image/jpeg", 0.86);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Immagine non valida")); };
    img.src = url;
  });
}

// ================================================================== token: creazione e modifica (DM)
function tokenForm(t = {}) {
  let image = t.image || null;
  const members = [...store.members.values()].filter((m) => m.status === "active");
  const f = {
    kind: h("select", {}, Object.entries(KINDS).map(([v, l]) => h("option", { value: v, selected: (t.kind || "monster") === v }, l))),
    name: h("input", { maxlength: 60, value: t.name || "", placeholder: "es. Goblin 1, Porta della cripta…" }),
    size: h("select", {}, SIZES.map(([v, l]) => h("option", { value: v, selected: Number(t.size || 1) === v }, l))),
    color: h("div", { class: "swatches" }),
    owner: h("select", {}, h("option", { value: "" }, "— nessuno (solo il DM) —"), members.map((m) => h("option", { value: m.user_id, selected: t.owner_id === m.user_id }, m.display_name + (m.character_name ? ` (${m.character_name})` : "")))),
    hidden: h("input", { type: "checkbox", checked: t.hidden ?? false }),
    locked: h("input", { type: "checkbox", checked: !!t.locked }),
    text: h("textarea", { rows: 2, maxlength: 400, placeholder: "Testo visibile cliccando la nota" }, t.state?.text || ""),
    file: h("input", { type: "file", accept: "image/*" }),
  };
  let color = t.color || COLORS[0];
  const paint = () => f.color.replaceChildren(...COLORS.map((c) => h("button", { type: "button", class: `swatch ${c === color ? "active" : ""}`, style: { background: c }, onclick: () => { color = c; paint(); } })));
  paint();
  const prev = h("div", { class: "tok-preview" });
  const showPrev = () => prev.replaceChildren(image ? h("img", { src: image, alt: "" }) : h("span", { class: "muted small" }, "nessuna immagine"));
  showPrev();
  f.file.onchange = async () => { if (f.file.files[0]) { try { image = await resizeImage(f.file.files[0], 128); showPrev(); } catch (e) { toast(e.message, "error"); } } };
  const textRow = h("label", {}, "Testo della nota", f.text);
  const syncKind = () => { textRow.hidden = f.kind.value !== "note"; };
  f.kind.onchange = () => { syncKind(); if (!t.id) f.hidden.checked = f.kind.value === "trap"; };
  syncKind();
  const body = h("div", { class: "form-cols" },
    h("div", {},
      h("div", { class: "row2" }, h("label", {}, "Tipo", f.kind), h("label", {}, "Taglia", f.size)),
      h("label", {}, "Nome", f.name),
      h("div", { class: "label" }, "Colore del bordo"), f.color,
      textRow),
    h("div", {},
      h("label", {}, "Chi può muoverlo", f.owner),
      h("label", { class: "check" }, f.hidden, " Nascosto ai giocatori (non viene nemmeno inviato)"),
      h("label", { class: "check" }, f.locked, " Bloccato (il giocatore non può muoverlo)"),
      h("label", {}, "Immagine / ritratto (facoltativa)", f.file), prev,
      image ? h("button", { type: "button", class: "btn btn-sm btn-ghost", onclick: () => { image = null; showPrev(); } }, "Rimuovi immagine") : null));
  const values = () => ({
    kind: f.kind.value, name: f.name.value.trim(), size: Number(f.size.value), color, image,
    owner_id: f.owner.value || null, hidden: f.hidden.checked, locked: f.locked.checked,
    state: { ...(t.state || {}), ...(f.kind.value === "note" ? { text: f.text.value.trim() } : {}) },
  });
  return { body, values };
}

function addTokenDialog() {
  const map = T.maps.get(T.viewMapId); if (!map) return;
  const { body, values } = tokenForm({ kind: "monster" });
  modal({
    title: "Nuovo elemento sulla mappa", wide: true, body,
    actions: [{ label: "Annulla" }, {
      label: "Aggiungi", primary: true,
      onClick: async () => {
        const v = values();
        const c = T.view.viewCenter();
        const p = v.kind === "note" ? c : snap(gridOf(map), c.x, c.y, v.size);
        const row = await must(sb.from("tokens").insert({ ...v, game_id: T.gameId, map_id: map.id, x: p.x, y: p.y }).select().single());
        T.view.upsertToken(row); T.view.select(row.id); renderList();
      },
    }],
  });
}

function editToken(t) {
  const { body, values } = tokenForm(t);
  modal({
    title: "Modifica elemento", wide: true, body,
    actions: [
      { label: "Elimina", danger: true, close: false, onClick: async (close) => { close(); await deleteToken(t); } },
      { label: "Annulla" },
      { label: "Salva", primary: true, onClick: async () => { await patchToken(t, values()); } },
    ],
  });
}

async function addPlayerTokens() {
  const map = T.maps.get(T.viewMapId); if (!map) return;
  const existing = new Set([...T.view.tokens.values()].filter((t) => t.kind === "pc").map((t) => t.owner_id));
  const players = [...store.members.values()].filter((m) => m.status === "active" && m.role !== "dm" && !existing.has(m.user_id));
  if (!players.length) { toast("Tutti i giocatori hanno già il loro token su questa mappa.", "info"); return; }
  const g = gridOf(map);
  const c = T.view.viewCenter();
  const rows = players.map((m, i) => {
    const p = snap(g, c.x + (i - (players.length - 1) / 2) * g.size, c.y, 1);
    const ch = m.character_id ? store.characters.get(m.character_id) : null;
    return { game_id: T.gameId, map_id: map.id, kind: "pc", name: m.character_name || m.display_name, owner_id: m.user_id,
      x: p.x, y: p.y, size: 1, color: COLORS[(i + 1) % COLORS.length], image: ch?.portrait || null };
  });
  try {
    const res = await must(sb.from("tokens").insert(rows).select());
    res.forEach((r) => T.view.upsertToken(r));
    renderList();
    toast(`Aggiunti ${res.length} personaggi. Ogni giocatore può muovere il proprio.`, "ok");
  } catch (e) { toast(e.message, "error"); }
}

export function tableState() { return T; }
export { emit };
