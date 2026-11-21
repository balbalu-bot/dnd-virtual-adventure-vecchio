// Pannello videocamere: riquadri con nome giocatore e personaggio
import { store, on } from "./store.js";
import { h, icon, avatar, loadPref, savePref, modal } from "./ui.js";
import { voice, participantInfo, setVideosHidden } from "./voice.js";

let dock, strip, tiles = new Map(), unsub = [];
let layout = loadPref("videoLayout", { mode: "top", size: "M", dmBig: false, x: null, y: null });

export function mountVideoDock(container) {
  dock = h("section", { class: "video-dock", "aria-label": "Videocamere" });
  const bar = h("div", { class: "video-bar" },
    h("span", { class: "video-bar-title", html: `${icon("cam")} Partecipanti` }),
    h("div", { class: "video-bar-btns" },
      h("button", { class: "icon-btn", title: "Dimensione riquadri", html: icon("expand"), onclick: cycleSize }),
      h("button", { class: "icon-btn", title: "Evidenzia il Dungeon Master", html: icon("crown"), onclick: toggleDmBig }),
      h("button", { class: "icon-btn hide-mobile", title: "Pannello fisso / flottante", html: icon("float"), onclick: toggleFloat }),
      h("button", { class: "icon-btn", title: "Nascondi tutti i video (più spazio alla mappa)", html: icon("eyeOff"), onclick: () => setVideosHidden(true) })));
  strip = h("div", { class: "video-strip" });
  dock.append(bar, strip);
  container.append(dock);
  makeDraggable(dock, bar);
  applyLayout();

  unsub = [
    on("voice:participants", render),
    on("voice:track", render),
    on("voice:state", () => { applyLayout(); render(); }),
    on("members:changed", render),
    on("voice:speaking", markSpeaking),
  ];
  render();
  return dock;
}

export function unmountVideoDock() {
  unsub.forEach((u) => u()); unsub = [];
  for (const t of tiles.values()) t.track?.detach(t.video);
  tiles.clear();
  dock?.remove(); dock = null;
}

function applyLayout() {
  if (!dock) return;
  dock.dataset.mode = layout.mode;
  dock.dataset.size = layout.size;
  dock.classList.toggle("dm-big", layout.dmBig);
  dock.hidden = voice.state.videosHidden;
  document.querySelector(".game")?.classList.toggle("videos-hidden", voice.state.videosHidden);
  document.querySelector(".game")?.classList.toggle("video-floating", layout.mode === "float");
  if (layout.mode === "float" && layout.x !== null) {
    dock.style.left = Math.max(0, Math.min(window.innerWidth - 120, layout.x)) + "px";
    dock.style.top = Math.max(0, Math.min(window.innerHeight - 80, layout.y)) + "px";
  } else { dock.style.left = ""; dock.style.top = ""; }
}

function save() { savePref("videoLayout", layout); applyLayout(); }
function cycleSize() { layout.size = { S: "M", M: "L", L: "S" }[layout.size] || "M"; save(); }
function toggleDmBig() { layout.dmBig = !layout.dmBig; save(); }
function toggleFloat() { layout.mode = layout.mode === "float" ? "top" : "float"; save(); }

function makeDraggable(el, handle) {
  let sx, sy, ox, oy, dragging = false;
  handle.addEventListener("pointerdown", (e) => {
    if (layout.mode !== "float" || e.target.closest("button")) return;
    dragging = true; sx = e.clientX; sy = e.clientY;
    const r = el.getBoundingClientRect(); ox = r.left; oy = r.top;
    handle.setPointerCapture(e.pointerId);
  });
  handle.addEventListener("pointermove", (e) => {
    if (!dragging) return;
    layout.x = ox + e.clientX - sx; layout.y = oy + e.clientY - sy;
    el.style.left = layout.x + "px"; el.style.top = layout.y + "px";
  });
  const end = () => { if (dragging) { dragging = false; save(); } };
  handle.addEventListener("pointerup", end);
  handle.addEventListener("pointercancel", end);
}

function orderedIdentities() {
  const ids = [];
  const me = store.user?.id;
  const room = voice.room;
  const online = new Set(room ? [room.localParticipant.identity, ...room.remoteParticipants.keys()] : []);
  const list = [...store.members.values()].filter((m) => m.status === "active" && (online.has(m.user_id) || m.user_id === me));
  list.sort((a, b) => (b.role === "dm") - (a.role === "dm") || (b.user_id === me) - (a.user_id === me) || a.display_name.localeCompare(b.display_name));
  for (const m of list) ids.push(m.user_id);
  return ids;
}

function render() {
  if (!strip) return;
  const ids = orderedIdentities();
  // rimuovi i riquadri di chi è uscito
  for (const [id, t] of tiles) {
    if (!ids.includes(id)) { t.track?.detach(t.video); t.el.remove(); tiles.delete(id); }
  }
  ids.forEach((id, i) => {
    let t = tiles.get(id);
    if (!t) { t = createTile(id); tiles.set(id, t); }
    updateTile(t);
    if (strip.children[i] !== t.el) strip.insertBefore(t.el, strip.children[i] || null);
  });
  if (!ids.length) strip.replaceChildren(h("p", { class: "muted small video-empty" }, "Nessuno è collegato all'audio/video."));
  else strip.querySelector(".video-empty")?.remove();
  markSpeaking(voice.speaking);
}

function createTile(id) {
  const video = h("video", { autoplay: true, playsinline: true, muted: true });
  video.muted = true;
  const av = h("div", { class: "tile-avatar" });
  const name = h("strong", {});
  const char = h("span", { class: "tile-char" });
  const micIco = h("span", { class: "tile-mic" });
  const el = h("div", { class: "tile", dataset: { id } },
    video, av,
    h("div", { class: "tile-label" }, h("div", { class: "tile-names" }, name, char), micIco),
    h("button", { class: "tile-zoom icon-btn", title: "Ingrandisci", html: icon("expand"), onclick: () => spotlight(id) }));
  el.addEventListener("dblclick", () => spotlight(id));
  return { id, el, video, av, name, char, micIco, track: null };
}

function updateTile(t) {
  const m = store.members.get(t.id);
  const info = participantInfo(t.id);
  const isMe = t.id === store.user?.id;
  t.el.classList.toggle("is-dm", m?.role === "dm");
  t.el.classList.toggle("is-me", isMe);
  t.name.textContent = (m?.display_name || "?") + (isMe ? " (tu)" : "");
  t.char.textContent = m?.character_name || "";
  const portrait = m?.character_id ? store.characters.get(m.character_id)?.portrait : null;
  t.av.replaceChildren(avatar(m?.display_name || "?", portrait, "avatar-tile"));
  const track = info?.videoTrack || null;
  if (track !== t.track) {
    t.track?.detach(t.video);
    t.track = track;
    if (track) track.attach(t.video);
  }
  t.el.classList.toggle("has-video", !!track);
  t.el.classList.toggle("mirror", isMe);
  const muted = isMe ? !voice.state.transmitting : (info ? info.micMuted || !info.hearable : true);
  t.micIco.innerHTML = icon(muted ? "micOff" : "mic");
  t.micIco.title = isMe ? (voice.state.transmitting ? "Stai trasmettendo" : "Microfono chiuso")
    : (info?.hearable ? (info.micMuted ? "Microfono chiuso" : "Lo senti") : "Non lo senti (silenziato o in canale privato)");
}

function markSpeaking(set) {
  for (const [id, t] of tiles) t.el.classList.toggle("speaking", set?.has(id));
}

function spotlight(id) {
  const info = participantInfo(id);
  const m = store.members.get(id);
  const big = h("video", { autoplay: true, playsinline: true, muted: true, class: id === store.user?.id ? "mirror" : "" });
  if (info?.videoTrack) info.videoTrack.attach(big);
  modal({
    title: `${m?.display_name || ""}${m?.character_name ? " — " + m.character_name : ""}`,
    wide: true, cls: "spotlight",
    body: info?.videoTrack ? big : h("div", { class: "center" }, avatar(m?.display_name, null, "avatar-xl"), h("p", { class: "muted" }, "Videocamera spenta")),
    onClose: () => { info?.videoTrack?.detach(big); },
  });
}
