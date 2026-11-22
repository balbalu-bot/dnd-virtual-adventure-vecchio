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

// Su iPhone/iPad il Web Audio viene zittito dall'interruttore "silenzioso":
// facciamo uscire il suono da un elemento <audio>, che invece si sente sempre.
const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

function ctx() {
  if (!A.ctx) {
    A.ctx = new (window.AudioContext || window.webkitAudioContext)();
    A.master = A.ctx.createGain();
    if (IOS && A.ctx.createMediaStreamDestination) {
      const d = A.ctx.createMediaStreamDestination();
      A.master.connect(d);
      A.outEl = document.createElement("audio");
      A.outEl.setAttribute("playsinline", ""); A.outEl.autoplay = true; A.outEl.srcObject = d.stream;
      A.outEl.play().catch(() => {});
    } else A.master.connect(A.ctx.destination);
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

// ------------------------------------------------------------------ sblocco dell'audio
// I browser fanno partire l'audio solo dopo un tocco o un clic della persona.
function audioBlocked() {
  if (prefs.off) return false;
  if (A.ctx && A.ctx.state !== "running") return true;
  if (A.outEl && A.outEl.paused) return true;
  if (A.el && A.el.paused && A.currentKey.startsWith("file:")) return true;
  return false;
}
export function unlockAudio() {
  try {
    const c = ctx();
    const b = c.createBuffer(1, 1, 22050); const s = c.createBufferSource(); s.buffer = b; s.connect(c.destination); s.start(0);
    c.resume?.().catch(() => {});
  } catch { /* nessun audio disponibile */ }
  A.outEl?.play().catch(() => {});
  if (A.el?.paused && A.currentKey.startsWith("file:")) A.el.play().catch(() => {});
  setTimeout(updateUnlockBanner, 300);
}
let unlockBanner = null;
function updateUnlockBanner() {
  const need = audioBlocked() && (A.currentKey || A.wantSound);
  if (!need) { unlockBanner?.remove(); unlockBanner = null; return; }
  if (unlockBanner) return;
  unlockBanner = h("button", { class: "audio-unlock", onclick: (e) => { e.stopPropagation(); unlockAudio(); } },
    isDM() ? "🔊 Tocca qui per attivare musica ed effetti" : "🔊 Il DM sta usando musica ed effetti: tocca qui per sentirli");
  document.body.append(unlockBanner);
}
for (const ev of ["pointerup", "touchend", "click", "keydown"]) {
  document.addEventListener(ev, () => { if (A.ctx && audioBlocked()) unlockAudio(); }, { capture: true, passive: true });
}

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
  const every = (fn, min, max) => { const loop = () => { if (stopped) return; if (A.ctx.state === "running") fn(); timers.push(setTimeout(loop, min + Math.random() * (max - min))); }; loop(); };
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
/** Suono metallico/campana: parziali sinusoidali con decadimento esponenziale */
function partials(base, list, { at = 0, dest, vol = 0.3 } = {}) {
  const c = ctx(); const t = c.currentTime + at;
  for (const [ratio, amp, dec] of list) {
    const o = c.createOscillator(), g = c.createGain();
    o.frequency.value = base * ratio * (1 + (Math.random() - 0.5) * 0.004);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
    o.connect(g); g.connect(dest || A.sfx); o.start(t); o.stop(t + dec + 0.05);
  }
}
/** Cigolio: treno di piccoli impulsi irregolari (attrito) filtrato da risonanze di legno */
function creak({ at = 0, dur = 1.1, from = 38, to = 70, vol = 0.5 } = {}) {
  const c = ctx(); const sr = c.sampleRate; const n = Math.floor(sr * dur);
  const b = c.createBuffer(1, n, sr); const d = b.getChannelData(0);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (i >= next) {
      const k = i / n; const rate = from + (to - from) * Math.sin(k * Math.PI) + (Math.random() - 0.5) * 14;
      next = i + Math.floor(sr / Math.max(12, rate));
      for (let j = 0; j < 40 && i + j < n; j++) d[i + j] += (Math.random() * 2 - 1) * Math.exp(-j / 6) * (0.6 + 0.4 * Math.sin(k * Math.PI));
    }
  }
  const s = c.createBufferSource(); s.buffer = b;
  const out = gain(vol);
  for (const [f, q, v] of [[520, 7, 1], [1250, 9, 0.7], [2300, 10, 0.35]]) { const bp = filt("bandpass", f, q); s.connect(bp); bp.connect(gain(v, out)); }
  out.connect(A.sfx); s.start(c.currentTime + at);
}
function thud({ at = 0, vol = 0.8, freq = 85 } = {}) {
  tone(freq, { dur: 0.35, vol, at, glide: 38 });
  burst({ dur: 0.18, vol: vol * 0.6, type: "lowpass", freq: 260, kind: "brown", at });
}
function clang(base, at = 0, vol = 0.22) {
  burst({ dur: 0.04, vol: vol * 1.6, type: "highpass", freq: 2500, at });
  partials(base, [[1, 1, 1.4], [2.32, 0.7, 1.1], [3.87, 0.5, 0.8], [5.41, 0.35, 0.6], [7.9, 0.2, 0.4]], { at, vol });
}

export function playSfxLocal(id) {
  if (prefs.off) return;
  ctx();
  const c = A.ctx;
  if (c.state !== "running") { // se si sblocca subito (clic del DM) suona, altrimenti niente suoni in ritardo
    const t0 = Date.now();
    c.resume().then(() => { if (Date.now() - t0 < 500 && c.state === "running") playSfxLocal(id); }).catch(() => {});
    return;
  }
  switch (id) {
    case "thunder": {
      burst({ dur: 0.12, vol: 0.9, type: "highpass", freq: 900 });                     // schiocco del fulmine
      burst({ dur: 0.5, vol: 0.7, type: "lowpass", freq: 1500, at: 0.04 });
      const s = c.createBufferSource(); s.buffer = noiseBuffer("brown", 6);             // brontolio che rotola
      const f = filt("lowpass", 140); const g = gain(0); s.connect(f); f.connect(g); g.connect(A.sfx);
      const t = c.currentTime + 0.1;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(1.6, t + 0.35);
      for (let i = 1; i < 10; i++) g.gain.linearRampToValueAtTime((1.4 - i * 0.13) * (0.6 + Math.random() * 0.6), t + 0.35 + i * 0.45);
      g.gain.linearRampToValueAtTime(0.0001, t + 5.2);
      s.start(t); s.stop(t + 5.4); break;
    }
    case "door": creak({ dur: 1.2 }); thud({ at: 1.2, vol: 0.7, freq: 75 }); break;
    case "sword":
      burst({ dur: 0.25, vol: 0.12, type: "bandpass", freq: 3500, q: 1.5 });           // sfregamento della lama
      clang(820, 0.22, 0.2); clang(1130, 0.5, 0.16); break;
    case "magic": {
      const notes = [523.3, 659.3, 784, 1046.5, 1318.5, 1568, 2093];
      notes.forEach((fr, i) => { tone(fr, { dur: 1.4, vol: 0.09, at: i * 0.07, type: "sine", dest: A.verb, attack: 0.03 }); tone(fr * 1.006, { dur: 1.4, vol: 0.05, at: i * 0.07, type: "triangle", dest: A.verb }); });
      for (let i = 0; i < 18; i++) partials(3000 + Math.random() * 4000, [[1, 1, 0.25]], { at: 0.1 + Math.random() * 1.1, vol: 0.05, dest: A.verb });
      const s = c.createBufferSource(); s.buffer = noiseBuffer("white", 2); const f = filt("bandpass", 600, 3); const g = gain(0);
      s.connect(f); f.connect(g); g.connect(A.verb); const t = c.currentTime;
      f.frequency.setValueAtTime(600, t); f.frequency.exponentialRampToValueAtTime(7000, t + 1.2);
      g.gain.linearRampToValueAtTime(0.25, t + 0.4); g.gain.linearRampToValueAtTime(0, t + 1.4); s.start(t); s.stop(t + 1.5); break;
    }
    case "trap":
      partials(2400, [[1, 1, 0.06], [1.7, 0.6, 0.05]], { vol: 0.4 });                   // clic del meccanismo
      burst({ dur: 0.07, vol: 0.5, type: "highpass", freq: 1800, at: 0.18 });            // scatto
      clang(420, 0.2, 0.18); thud({ at: 0.22, vol: 0.9, freq: 70 });
      burst({ dur: 0.9, vol: 0.25, type: "lowpass", freq: 500, kind: "brown", at: 0.25 }); break;
    case "bell":                                                                          // campana: parziali reali di una campana
      for (let i = 0; i < 3; i++) partials(311, [[0.5, 0.5, 5], [1, 1, 4], [1.19, 0.6, 3], [1.5, 0.45, 2.6], [2, 0.5, 2.2], [2.5, 0.25, 1.6], [3, 0.2, 1.2]], { at: i * 1.6, vol: 0.16 });
      break;
    case "roar": {
      const t = c.currentTime; const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.setValueAtTime(95, t);
      o.frequency.linearRampToValueAtTime(130, t + 0.5); o.frequency.linearRampToValueAtTime(70, t + 2.2);
      const am = gain(0.5); const amO = c.createOscillator(); amO.frequency.value = 31; const amG = gain(0.5); amO.connect(amG); amG.connect(am.gain);
      const ns = c.createBufferSource(); ns.buffer = noiseBuffer("pink", 3); const nG = gain(0.6);
      const out = gain(0); out.connect(A.sfx);
      for (const [f, q, v] of [[320, 4, 1], [780, 5, 0.6], [1900, 6, 0.25]]) { const bp = filt("bandpass", f, q); am.connect(bp); nG.connect(bp); bp.connect(gain(v, out)); }
      o.connect(am); ns.connect(nG);
      out.gain.setValueAtTime(0.0001, t); out.gain.exponentialRampToValueAtTime(1.3, t + 0.45); out.gain.setValueAtTime(1.2, t + 1.3); out.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
      o.start(t); amO.start(t); ns.start(t); o.stop(t + 2.5); amO.stop(t + 2.5); ns.stop(t + 2.5); break;
    }
    case "coins":
      for (let i = 0; i < 14; i++) partials(2600 + Math.random() * 1800, [[1, 1, 0.22], [1.52, 0.6, 0.16], [2.4, 0.35, 0.1]], { at: i * 0.045 + Math.random() * 0.05 + (i > 9 ? 0.15 : 0), vol: 0.07 });
      break;
    case "victory": {                                                                     // fanfara di ottoni
      const brass = (fr, at, dur) => {
        const t = c.currentTime + at; const o = c.createOscillator(); o.type = "sawtooth"; o.frequency.value = fr;
        const f = filt("lowpass", 600, 2); const g = gain(0);
        f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(3200, t + 0.06); f.frequency.exponentialRampToValueAtTime(1300, t + dur);
        g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.04); g.gain.setValueAtTime(0.13, t + dur * 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(f); f.connect(g); g.connect(A.sfx); g.connect(A.verb); o.start(t); o.stop(t + dur + 0.05);
      };
      [[392, 0, 0.18], [392, 0.2, 0.18], [392, 0.4, 0.18], [523.3, 0.6, 0.9], [466.2, 1.55, 0.3], [523.3, 1.9, 1.2]].forEach(([fr, at, d]) => { brass(fr, at, d); brass(fr * 1.5, at, d); });
      break;
    }
    case "heart":
      for (let i = 0; i < 5; i++) { tone(58, { dur: 0.16, vol: 0.9, at: i * 0.8, glide: 38 }); tone(52, { dur: 0.14, vol: 0.6, at: i * 0.8 + 0.22, glide: 34 }); }
      break;
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
  el.play().catch(() => setTimeout(updateUnlockBanner, 100));
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
  if (!m || prefs.off) { if (!m) A.currentKey = ""; updateUnlockBanner(); return; }
  if (m.type === "synth") { ctx(); A.current = ambience(m.id); setTimeout(updateUnlockBanner, 400); }
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
  if (msg?.t === "sfx" || msg?.t === "sfx-file") { A.wantSound = true; setTimeout(updateUnlockBanner, 200); }
  if (msg?.t === "sfx") playSfxLocal(msg.id);
  if (msg?.t === "sfx-file" && !prefs.off && typeof msg.path === "string" && store.game && msg.path.startsWith(store.game.id + "/audio/")) playFile(msg.path, { asSfx: true });
}

export function initAudio({ sendBroadcast }) { A.sendBroadcast = sendBroadcast; }
export function stopAllAudio() { A.current?.stop(); A.current = null; if (A.el) { A.el.pause(); A.el = null; } A.currentKey = ""; A.wantSound = false; updateUnlockBanner(); }

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
