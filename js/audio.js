// =====================================================================
//  Musica d'ambiente ed effetti sonori sincronizzati per tutto il tavolo
//  - Ambienti ed effetti generati al momento (nessun file protetto)
//  - Oppure brani caricati dal DM (suoi file)
//  Lo stato della musica sta in games.settings.music (chi entra dopo la sente);
//  gli effetti viaggiano sul canale "broadcast".
// =====================================================================
import { sb, must } from "./supabase.js";
import { store, isDM } from "./store.js";
import { h, icon, toast, loadPref, savePref } from "./ui.js";

export const AMBIENCES = [
  ["rain", "🌧 Pioggia"], ["wind", "🌬 Vento"], ["fire", "🔥 Fuoco nel camino"], ["cave", "💧 Caverna"],
  ["sea", "🌊 Mare"], ["battle", "🥁 Battaglia"], ["tension", "😱 Tensione"], ["mystery", "✨ Mistero"],
];
export const SFX = [
  ["thunder", "⚡ Tuono"], ["door", "🚪 Porta"], ["sword", "⚔ Spade"], ["magic", "🪄 Magia"], ["trap", "🪤 Trappola"],
  ["bell", "🔔 Campana"], ["roar", "🐉 Ruggito"], ["coins", "💰 Monete"], ["victory", "🎺 Vittoria"], ["heart", "💓 Battito"],
];

const A = { ctx: null, master: null, music: null, sfx: null, verb: null, current: null, currentKey: "", el: null, sendBroadcast: () => {} };
const prefs = { music: loadPref("volMusic", 0.6), sfx: loadPref("volSfx", 0.8), off: loadPref("gameAudioOff", false) };

function ctx() {
  if (!A.ctx) {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = A.ctx.createGain(); A.master.connect(A.ctx.destination);
    A.music = A.ctx.createGain(); A.music.connect(A.master);
    A.sfx = A.ctx.createGain(); A.sfx.connect(A.master);
    A.verb = A.ctx.createConvolver(); A.verb.buffer = impulse(2.8); A.verb.connect(A.music);
    applyVolumes();
  }
  if (A.ctx.state === "suspended") A.ctx.resume().catch(() => {});
  return A.ctx;
}
function applyVolumes() {
  if (!A.ctx) return;
  const dm = Number(store.game?.settings?.music?.volume ?? 1);
  A.master.gain.value = prefs.off ? 0 : 1;
  A.music.gain.value = prefs.music * dm;
  A.sfx.gain.value = prefs.sfx;
  if (A.el) A.el.volume = prefs.off ? 0 : Math.min(1, prefs.music * dm);
}
document.addEventListener("pointerdown", () => { if (A.ctx?.state === "suspended") A.ctx.resume().catch(() => {}); if (A.el?.paused && A.currentKey.startsWith("file:")) A.el.play().catch(() => {}); });

// ------------------------------------------------------------------ mattoni sonori
function noiseBuffer(kind = "white", secs = 4) {
  const c = ctx(); const n = c.sampleRate * secs; const b = c.createBuffer(1, n, c.sampleRate); const d = b.getChannelData(0);
  let last = 0, b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < n; i++) {
    const w = Math.random() * 2 - 1;
    if (kind === "brown") { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
    else if (kind === "pink") { b0 = 0.99765 * b0 + w * 0.099; b1 = 0.963 * b1 + w * 0.2965; b2 = 0.57 * b2 + w * 1.0527; d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2; }
    else d[i] = w;
  }
  return b;
}
function impulse(secs) {
  const c = A.ctx; const n = c.sampleRate * secs; const b = c.createBuffer(2, n, c.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = b.getChannelData(ch); for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 3); }
  return b;
}
function noiseSrc(kind, dest, { loop = true } = {}) {
  const s = ctx().createBufferSource(); s.buffer = noiseBuffer(kind); s.loop = loop; s.connect(dest); s.start(); return s;
}
function filt(type, freq, q = 0.7) { const f = ctx().createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f; }
function gain(v, dest) { const g = ctx().createGain(); g.gain.value = v; if (dest) g.connect(dest); return g; }
function lfo(freq, depth, param) { const o = ctx().createOscillator(); const g = gain(depth); o.frequency.value = freq; o.connect(g); g.connect(param); o.start(); return o; }
function tone(freq, { type = "sine", dur = 0.4, vol = 0.3, at = 0, dest, glide, attack = 0.005 } = {}) {
  const c = ctx(); const t = c.currentTime + at; const o = c.createOscillator(); const g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (glide) o.frequency.exponentialRampToValueAtTime(glide, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + attack); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || A.sfx); o.start(t); o.stop(t + dur + 0.05);
}
function burst({ dur = 0.05, vol = 0.3, type = "highpass", freq = 2000, at = 0, dest, kind = "white", q = 0.7 } = {}) {
  const c = ctx(); const t = c.currentTime + at; const s = c.createBufferSource(); s.buffer = noiseBuffer(kind, Math.max(0.1, dur + 0.05));
  const f = filt(type, freq, q); const g = c.createGain();
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f); f.connect(g); g.connect(dest || A.sfx); s.start(t); s.stop(t + dur + 0.05);
}

// ------------------------------------------------------------------ ambienti
function ambience(kind) {
  const nodes = []; const timers = []; let stopped = false;
  const out = gain(0, A.music);
  out.gain.linearRampToValueAtTime(1, ctx().currentTime + 2);
  const every = (fn, min, max) => { const loop = () => { if (stopped) return; fn(); timers.push(setTimeout(loop, min + Math.random() * (max - min))); }; loop(); };
  if (kind === "rain") {
    const f1 = filt("lowpass", 4500), f2 = filt("highpass", 500); nodes.push(noiseSrc("white", f1)); f1.connect(f2); f2.connect(gain(0.22, out));
    every(() => burst({ dur: 0.03, vol: 0.05 + Math.random() * 0.06, freq: 3000 + Math.random() * 3000, dest: out }), 40, 160);
  } else if (kind === "wind") {
    const f = filt("bandpass", 450, 0.9); nodes.push(noiseSrc("brown", f)); const g = gain(0.5, out); f.connect(g);
    nodes.push(lfo(0.09, 260, f.frequency), lfo(0.13, 0.25, g.gain));
  } else if (kind === "fire") {
    const f = filt("lowpass", 500); nodes.push(noiseSrc("brown", f)); f.connect(gain(0.45, out));
    every(() => burst({ dur: 0.01 + Math.random() * 0.03, vol: 0.05 + Math.random() * 0.25, freq: 1500 + Math.random() * 2500, dest: out }), 30, 380);
  } else if (kind === "cave") {
    const g = gain(0.05, out);
    for (const fr of [55, 82.6]) { const o = ctx().createOscillator(); o.frequency.value = fr; o.connect(g); o.start(); nodes.push(o); }
    every(() => { const fr = 1200 + Math.random() * 1400; tone(fr, { dur: 0.09, vol: 0.12, glide: fr * 0.55, dest: A.verb }); }, 700, 3200);
  } else if (kind === "sea") {
    const f = filt("lowpass", 900); nodes.push(noiseSrc("pink", f)); const g = gain(0.35, out); f.connect(g);
    nodes.push(lfo(0.075, 0.3, g.gain), lfo(0.075, 300, f.frequency));
  } else if (kind === "battle") {
    const drone = gain(0.035, out); const f = filt("lowpass", 380);
    for (const fr of [55, 82.5, 110.4]) { const o = ctx().createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(); nodes.push(o); }
    f.connect(drone);
    let step = 0; const pattern = [1, 0, 2, 0, 1, 1, 2, 0];
    every(() => {
      const p = pattern[step++ % pattern.length];
      if (p === 1) tone(130, { dur: 0.45, vol: 0.55, glide: 42, dest: out });
      if (p === 2) { tone(210, { dur: 0.3, vol: 0.35, glide: 95, dest: out }); burst({ dur: 0.08, vol: 0.12, freq: 1800, dest: out }); }
    }, 330, 331);
  } else if (kind === "tension") {
    const f = filt("lowpass", 320); const g = gain(0.07, out); f.connect(g);
    for (const fr of [55, 55.8, 82.1]) { const o = ctx().createOscillator(); o.type = "sawtooth"; o.frequency.value = fr; o.connect(f); o.start(); nodes.push(o); }
    nodes.push(lfo(0.21, 0.04, g.gain));
    every(() => tone(880 + Math.random() * 300, { dur: 4, vol: 0.03, attack: 2, dest: A.verb, type: "sine" }), 5000, 11000);
  } else if (kind === "mystery") {
    const scale = [261.6, 293.7, 329.6, 392, 440, 523.3, 587.3, 659.3];
    every(() => tone(scale[Math.floor(Math.random() * scale.length)] * (Math.random() < 0.3 ? 0.5 : 1), { dur: 2.6, vol: 0.09, type: "triangle", dest: A.verb, attack: 0.02 }), 600, 1700);
    const g = gain(0.025, out); const o = ctx().createOscillator(); o.frequency.value = 130.8; o.connect(g); o.start(); nodes.push(o);
  }
  return {
    stop() {
      stopped = true; timers.forEach(clearTimeout); timers.length = 0;
      const t = A.ctx.currentTime; out.gain.cancelScheduledValues(t); out.gain.setValueAtTime(out.gain.value, t); out.gain.linearRampToValueAtTime(0, t + 1.2);
      setTimeout(() => { nodes.forEach((n) => { try { n.stop?.(); n.disconnect?.(); } catch { /* già fermo */ } }); out.disconnect(); }, 1400);
    },
  };
}

// ------------------------------------------------------------------ effetti
export function playSfxLocal(id) {
  if (prefs.off) return;
  ctx();
  switch (id) {
    case "thunder": burst({ dur: 0.25, vol: 0.9, type: "lowpass", freq: 1200 }); burst({ dur: 3.2, vol: 0.7, type: "lowpass", freq: 180, kind: "brown", at: 0.08 }); break;
    case "door": { const o = A.ctx.createOscillator(); const f = filt("bandpass", 700, 6); const g = gain(0); o.type = "sawtooth"; o.frequency.value = 90; o.connect(f); f.connect(g); g.connect(A.sfx);
      const t = A.ctx.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.35, t + 0.1); g.gain.linearRampToValueAtTime(0.0001, t + 1.3);
      for (let i = 0; i < 12; i++) o.frequency.setValueAtTime(70 + Math.random() * 60, t + i * 0.1);
      o.start(t); o.stop(t + 1.4); tone(70, { dur: 0.5, vol: 0.5, at: 1.25, glide: 40 }); break; }
    case "sword": for (const [fr, at] of [[2350, 0], [3170, 0], [1870, 0.12], [2690, 0.12]]) tone(fr, { type: "square", dur: 0.5, vol: 0.06, at }); burst({ dur: 0.05, vol: 0.3, freq: 3000 }); break;
    case "magic": [523, 659, 784, 1047, 1319, 1568].forEach((fr, i) => tone(fr, { dur: 0.8, vol: 0.12, at: i * 0.06, type: "triangle", dest: A.verb })); break;
    case "trap": burst({ dur: 0.03, vol: 0.5, freq: 3000 }); tone(90, { dur: 0.6, vol: 0.7, at: 0.15, glide: 35 }); burst({ dur: 0.5, vol: 0.4, type: "lowpass", freq: 400, at: 0.15, kind: "brown" }); break;
    case "bell": for (const [m, v] of [[1, 0.3], [2.76, 0.12], [5.4, 0.07]]) tone(440 * m, { dur: 3, vol: v }); break;
    case "roar": { const o = A.ctx.createOscillator(); const f = filt("lowpass", 700, 4); const g = gain(0); o.type = "sawtooth"; o.frequency.value = 70; o.connect(f); f.connect(g); g.connect(A.sfx);
      const t = A.ctx.currentTime; g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.5, t + 0.3); g.gain.linearRampToValueAtTime(0.0001, t + 2);
      o.frequency.linearRampToValueAtTime(55, t + 2); f.frequency.linearRampToValueAtTime(300, t + 2); o.start(t); o.stop(t + 2.1);
      burst({ dur: 1.8, vol: 0.25, type: "bandpass", freq: 500, kind: "brown" }); break; }
    case "coins": for (let i = 0; i < 9; i++) tone(2500 + Math.random() * 2500, { dur: 0.15, vol: 0.08, at: i * 0.05 + Math.random() * 0.03, type: "square" }); break;
    case "victory": [[523, 0], [659, 0.15], [784, 0.3], [1047, 0.45], [784, 0.75], [1047, 0.9]].forEach(([fr, at]) => tone(fr, { dur: 0.4, vol: 0.18, at, type: "sawtooth" })); break;
    case "heart": for (let i = 0; i < 4; i++) { tone(60, { dur: 0.15, vol: 0.7, at: i * 0.85, glide: 40 }); tone(55, { dur: 0.15, vol: 0.5, at: i * 0.85 + 0.25, glide: 38 }); } break;
    default: break;
  }
}

async function playFile(path, { loop = false, startedAt = null, asSfx = false } = {}) {
  const { data, error } = await sb.storage.from("maps").createSignedUrl(path, 60 * 60 * 6);
  if (error) { toast("Audio non disponibile: " + error.message, "error"); return null; }
  const el = new Audio(data.signedUrl);
  el.loop = loop; el.preload = "auto";
  el.volume = prefs.off ? 0 : (asSfx ? prefs.sfx : prefs.music * Number(store.game?.settings?.music?.volume ?? 1));
  if (startedAt && loop) el.addEventListener("loadedmetadata", () => { if (el.duration > 0) el.currentTime = ((Date.now() - startedAt) / 1000) % el.duration; }, { once: true });
  el.play().catch(() => toast("Tocca lo schermo per attivare la musica.", "info"));
  return el;
}

// ------------------------------------------------------------------ musica: stato condiviso
export function applyMusicState(m) {
  const key = m ? `${m.type}:${m.id || m.path}:${m.started_at}` : "";
  applyVolumes();
  if (key === A.currentKey) { renderBadge(); return; }
  A.current?.stop(); A.current = null;
  if (A.el) { A.el.pause(); A.el = null; }
  A.currentKey = key;
  renderBadge();
  if (!m || prefs.off) return;
  if (m.type === "synth") { ctx(); A.current = ambience(m.id); }
  else if (m.type === "file") playFile(m.path, { loop: true, startedAt: m.started_at }).then((el) => { if (A.currentKey === key) { A.el = el; applyVolumes(); } else el?.pause(); });
}

/** Il DM cambia la musica per tutti */
export async function dmSetMusic(m) {
  const settings = { ...(store.game.settings || {}), music: m ? { ...m, volume: store.game.settings?.music?.volume ?? 0.8, started_at: Date.now() } : null };
  try {
    await must(sb.from("games").update({ settings }).eq("id", store.game.id));
    store.game.settings = settings; applyMusicState(settings.music);
  } catch (e) { toast(e.message, "error"); }
}
export async function dmSetMusicVolume(v) {
  const settings = { ...(store.game.settings || {}) };
  if (!settings.music) return;
  settings.music = { ...settings.music, volume: v };
  store.game.settings = settings; applyVolumes();
  clearTimeout(dmSetMusicVolume.t);
  dmSetMusicVolume.t = setTimeout(() => sb.from("games").update({ settings }).eq("id", store.game.id).then(() => {}), 400);
}

/** Il DM fa sentire un effetto a tutti */
export function dmPlaySfx(id) { playSfxLocal(id); A.sendBroadcast({ t: "sfx", id }); }
export async function dmPlayFileSfx(path) { playFile(path, { asSfx: true }); A.sendBroadcast({ t: "sfx-file", path }); }

export function audioBroadcast(msg) {
  if (msg?.t === "sfx") playSfxLocal(msg.id);
  if (msg?.t === "sfx-file" && !prefs.off) playFile(msg.path, { asSfx: true });
}

export function initAudio({ sendBroadcast }) { A.sendBroadcast = sendBroadcast; }
export function stopAllAudio() { A.current?.stop(); A.current = null; if (A.el) { A.el.pause(); A.el = null; } A.currentKey = ""; }

// ------------------------------------------------------------------ controllo per ogni giocatore
let badge;
export function audioButton() {
  badge = h("button", { class: "icon-btn audio-btn", title: "Musica ed effetti", onclick: (e) => openAudioPopover(e.currentTarget) });
  renderBadge();
  return badge;
}
function currentTitle() {
  const m = store.game?.settings?.music;
  if (!m) return "";
  return m.title || (AMBIENCES.find(([k]) => k === m.id)?.[1]) || "Musica";
}
function renderBadge() {
  if (!badge) return;
  const t = currentTitle();
  badge.innerHTML = prefs.off ? "🔇" : t ? "🎵" : "🎶";
  badge.classList.toggle("playing", !!t && !prefs.off);
  badge.title = prefs.off ? "Audio di gioco disattivato" : t ? `In riproduzione: ${t}` : "Musica ed effetti";
}
function openAudioPopover(anchor) {
  document.querySelector(".audio-pop")?.remove();
  const slider = (label, key) => h("label", {}, label, h("input", { type: "range", min: 0, max: 1, step: 0.05, value: prefs[key],
    oninput: (e) => { prefs[key] = Number(e.target.value); savePref(key === "music" ? "volMusic" : "volSfx", prefs[key]); applyVolumes(); } }));
  const pop = h("div", { class: "audio-pop" },
    h("div", { class: "small" }, "In riproduzione: ", h("strong", {}, currentTitle() || "nessuna musica")),
    slider("Volume musica", "music"), slider("Volume effetti", "sfx"),
    h("label", { class: "check small" }, h("input", { type: "checkbox", checked: prefs.off, onchange: (e) => { prefs.off = e.target.checked; savePref("gameAudioOff", prefs.off); A.currentKey = "__"; applyMusicState(store.game?.settings?.music); renderBadge(); } }), " Disattiva musica ed effetti (solo per me)"),
    isDM() ? h("p", { class: "muted small" }, "Per scegliere la musica di tutti: Strumenti del DM → Musica e suoni.") : null);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.top = r.bottom + 8 + "px";
  pop.style.right = Math.max(8, window.innerWidth - r.right) + "px";
  const close = (e) => { if (!pop.contains(e.target) && e.target !== anchor) { pop.remove(); document.removeEventListener("pointerdown", close, true); } };
  setTimeout(() => document.addEventListener("pointerdown", close, true), 0);
}

// ------------------------------------------------------------------ pannello del DM
export function audioPanel() {
  const box = h("div", { class: "audio-panel" });
  const render = async () => {
    const m = store.game.settings?.music;
    let tracks = [];
    try { tracks = await must(sb.from("audio_tracks").select("*").eq("game_id", store.game.id).order("created_at")); } catch { /* fase 4 non installata */ }
    const fileIn = h("input", { type: "file", accept: "audio/*" });
    const kindSel = h("select", {}, h("option", { value: "music" }, "Musica (in loop)"), h("option", { value: "sfx" }, "Effetto"));
    box.replaceChildren(
      h("h3", {}, "Musica d'ambiente (la sentono tutti)"),
      h("div", { class: "amb-grid" }, AMBIENCES.map(([k, l]) => h("button", {
        class: `btn btn-sm ${m?.type === "synth" && m.id === k ? "btn-primary" : ""}`,
        onclick: async () => { await dmSetMusic(m?.type === "synth" && m.id === k ? null : { type: "synth", id: k, title: l }); render(); },
      }, l))),
      h("div", { class: "row-btns" },
        h("button", { class: "btn btn-sm btn-danger", onclick: async () => { await dmSetMusic(null); render(); } }, "⏹ Ferma musica"),
        m ? h("label", { class: "inline" }, "Volume per tutti", h("input", { type: "range", min: 0, max: 1, step: 0.05, value: m.volume ?? 0.8, oninput: (e) => dmSetMusicVolume(Number(e.target.value)) })) : null),
      h("h3", {}, "Effetti sonori"),
      h("div", { class: "amb-grid" }, SFX.map(([k, l]) => h("button", { class: "btn btn-sm", onclick: () => dmPlaySfx(k) }, l))),
      h("h3", {}, "I tuoi brani"),
      h("p", { class: "muted small" }, "Carica solo file che hai il diritto di usare (musica libera da diritti o tua). MP3, M4A, OGG o WAV fino a 25 MB."),
      tracks.length ? h("div", { class: "map-list" }, tracks.map((t) => h("div", { class: "map-row" },
        h("div", { class: "map-row-main" }, h("strong", {}, t.title), h("span", { class: "muted small" }, t.kind === "sfx" ? " · effetto" : " · musica")),
        h("div", { class: "row-btns" },
          t.kind === "sfx"
            ? h("button", { class: "btn btn-sm", onclick: () => dmPlayFileSfx(t.file_path) }, "▶ Suona")
            : h("button", { class: `btn btn-sm ${m?.type === "file" && m.path === t.file_path ? "btn-primary" : ""}`, onclick: async () => { await dmSetMusic({ type: "file", path: t.file_path, title: t.title }); render(); } }, "▶ Per tutti"),
          h("button", { class: "btn btn-sm btn-danger", onclick: async () => {
            await must(sb.from("audio_tracks").delete().eq("id", t.id));
            sb.storage.from("maps").remove([t.file_path]).catch(() => {});
            render();
          } }, "Elimina"))))) : h("p", { class: "muted small" }, "Nessun brano caricato."),
      h("div", { class: "row-btns" }, fileIn, kindSel,
        h("button", { class: "btn btn-sm btn-primary", onclick: async () => {
          const f = fileIn.files[0]; if (!f) { toast("Scegli un file audio", "error"); return; }
          if (f.size > 25 * 1024 * 1024) { toast("File troppo grande (max 25 MB)", "error"); return; }
          const ext = (f.name.split(".").pop() || "mp3").toLowerCase().replace(/[^a-z0-9]/g, "");
          const path = `${store.game.id}/audio/${crypto.randomUUID()}.${ext}`;
          toast("Caricamento…", "info", { timeout: 2000 });
          const { error } = await sb.storage.from("maps").upload(path, f, { contentType: f.type || "audio/mpeg" });
          if (error) { toast("Caricamento non riuscito: " + error.message, "error"); return; }
          await must(sb.from("audio_tracks").insert({ game_id: store.game.id, title: f.name.replace(/\.[^.]+$/, "").slice(0, 120), file_path: path, kind: kindSel.value }));
          render();
        } }, "Carica")));
  };
  render();
  return box;
}
