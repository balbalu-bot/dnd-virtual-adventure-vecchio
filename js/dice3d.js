// =====================================================================
//  Dadi in 3D disegnati su canvas (nessuna libreria esterna).
//  Il risultato arriva SEMPRE dal server: qui il dado rotola e si ferma
//  mostrando quel numero sulla faccia rivolta verso chi guarda.
// =====================================================================

const PHI = (1 + Math.sqrt(5)) / 2;
const cache = new Map();

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function scaleTo1(vs) { const m = Math.max(...vs.map((v) => Math.hypot(...v))); return vs.map((v) => v.map((x) => x / m)); }

/** Facce di un solido convesso (inviluppo convesso semplice: i vertici sono pochi) */
function hull(verts) {
  const faces = [];
  const seen = new Set();
  const n = verts.length;
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) for (let k = j + 1; k < n; k++) {
    let nn = cross(sub(verts[j], verts[i]), sub(verts[k], verts[i]));
    if (Math.hypot(...nn) < 1e-9) continue;
    nn = norm(nn);
    const d0 = dot(nn, verts[i]);
    let pos = 0, neg = 0;
    for (const v of verts) { const d = dot(nn, v) - d0; if (d > 1e-6) pos++; else if (d < -1e-6) neg++; }
    if (pos && neg) continue;
    if (pos) nn = nn.map((x) => -x);
    const key = nn.map((x) => Math.round(x * 1000)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const dd = dot(nn, verts[i]);
    const idx = verts.map((v, q) => [q, dot(nn, v)]).filter(([, d]) => Math.abs(d - dd) < 1e-6).map(([q]) => q);
    const c = idx.reduce((a, q) => [a[0] + verts[q][0] / idx.length, a[1] + verts[q][1] / idx.length, a[2] + verts[q][2] / idx.length], [0, 0, 0]);
    const u = norm(sub(verts[idx[0]], c)), w = cross(nn, u);
    idx.sort((a, b) => {
      const da = sub(verts[a], c), db = sub(verts[b], c);
      return Math.atan2(dot(da, w), dot(da, u)) - Math.atan2(dot(db, w), dot(db, u));
    });
    faces.push({ idx, n: nn, c });
  }
  return faces;
}

function solid(sides) {
  const key = [4, 6, 8, 10, 12, 20].includes(sides) ? sides : sides === 100 ? 10 : 6;
  if (cache.has(key)) return cache.get(key);
  let verts, faces;
  const cube = [];
  for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) cube.push([x, y, z]);
  const octa = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
  const ico = [];
  for (const a of [-1, 1]) for (const b of [-PHI, PHI]) { ico.push([0, a, b], [a, b, 0], [b, 0, a]); }
  const dode = [...cube];
  for (const a of [-1, 1]) for (const b of [-1, 1]) dode.push([0, a / PHI, b * PHI], [a / PHI, b * PHI, 0], [a * PHI, 0, b / PHI]);
  if (key === 4) { verts = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]]; faces = hull(verts); }
  else if (key === 6) { verts = cube; faces = hull(verts); }
  else if (key === 8) { verts = octa; faces = hull(verts); }
  else if (key === 12) { verts = dode; faces = hull(verts); }
  else if (key === 20) { verts = ico; faces = hull(verts); }
  else {
    // d10: trapezoedro pentagonale
    const z = 0.1056;
    verts = [[0, 0, 1], [0, 0, -1]];
    for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * i) / 5; verts.push([Math.cos(a), Math.sin(a), z]); }
    for (let i = 0; i < 5; i++) { const a = (2 * Math.PI * (i + 0.5)) / 5; verts.push([Math.cos(a), Math.sin(a), -z]); }
    const U = (i) => 2 + (i % 5), L = (i) => 7 + (i % 5);
    faces = [];
    for (let i = 0; i < 5; i++) faces.push({ idx: [0, U(i), L(i), U(i + 1)] }, { idx: [1, L(i), U(i + 1), L(i + 1)] });
    verts = verts.map((v) => [v[0], v[1], v[2] * 0.85]);
    faces.forEach((f) => {
      const p = f.idx.map((i) => verts[i]);
      let n = norm(cross(sub(p[1], p[0]), sub(p[2], p[0])));
      const c = p.reduce((acc, v) => [acc[0] + v[0] / p.length, acc[1] + v[1] / p.length, acc[2] + v[2] / p.length], [0, 0, 0]);
      if (dot(n, c) < 0) { n = n.map((x) => -x); f.idx.reverse(); }
      f.n = n; f.c = c;
    });
  }
  const s = { verts: scaleTo1(verts), faces };
  // ricalcolo dei centri dopo la normalizzazione
  s.faces.forEach((f) => { f.c = f.idx.reduce((acc, i) => [acc[0] + s.verts[i][0] / f.idx.length, acc[1] + s.verts[i][1] / f.idx.length, acc[2] + s.verts[i][2] / f.idx.length], [0, 0, 0]); });
  cache.set(key, s);
  return s;
}

// ---------------------------------------------------------- quaternioni
const qMul = (a, b) => [
  a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
  a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
  a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
  a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
];
const qAxis = (ax, ang) => { const s = Math.sin(ang / 2), n = norm(ax); return [Math.cos(ang / 2), n[0] * s, n[1] * s, n[2] * s]; };
function qRot(q, v) {
  const p = qMul(qMul(q, [0, ...v]), [q[0], -q[1], -q[2], -q[3]]);
  return [p[1], p[2], p[3]];
}
/** Rotazione che porta il vettore a sul vettore b */
function qFromTo(a, b) {
  a = norm(a); b = norm(b);
  const d = dot(a, b);
  if (d > 0.99999) return [1, 0, 0, 0];
  if (d < -0.99999) return qAxis(Math.abs(a[0]) < 0.9 ? cross(a, [1, 0, 0]) : cross(a, [0, 1, 0]), Math.PI);
  const c = cross(a, b);
  return norm4([1 + d, c[0], c[1], c[2]]);
}
function norm4(q) { const l = Math.hypot(...q); return q.map((x) => x / l); }

const LIGHT = norm([-0.5, -0.7, 1]);

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = (x) => Math.max(0, Math.min(255, Math.round(k >= 1 ? x + (255 - x) * (k - 1) : x * k)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

/**
 * Crea un dado 3D animato. Restituisce l'elemento canvas.
 * colors = { body, edge, text }
 */
export function die3d(sides, value, { size = 64, colors, delay = 0, duration = 1000, onLand } = {}) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cv = document.createElement("canvas");
  cv.width = cv.height = Math.round(size * dpr);
  cv.style.width = cv.style.height = size + "px";
  cv.className = "die3d";
  const x = cv.getContext("2d");
  const S = solid(sides);
  const shown = sides === 100 ? 10 : sides;
  // etichette: la faccia 0 mostra il risultato, le altre numeri a caso
  const others = [];
  for (let i = 1; i <= Math.max(shown, S.faces.length); i++) if (i !== value) others.push(i);
  others.sort(() => Math.random() - 0.5);
  const labels = S.faces.map((_, i) => (i === 0 ? value : others[i - 1] ?? ""));
  const fmt = (v) => (sides === 10 && v === 10 ? "0" : String(v));
  // orientamento finale: faccia 0 verso chi guarda, con una piccola rotazione casuale
  const spinZ = (Math.random() - 0.5) * 0.6;
  const tilt = qMul(qAxis([1, 0, 0], -0.5), qAxis([0, 1, 0], 0.32)); // leggermente inclinato: si vede che è un solido
  const qEnd = qMul(tilt, qMul(qAxis([0, 0, 1], spinZ), qFromTo(S.faces[0].n, [0, 0, 1])));
  const axis = norm([Math.random() - 0.5, Math.random() - 0.5, Math.random() * 0.3]);
  const turns = 3 + Math.random() * 2;
  const t0 = performance.now() + delay;

  function draw(now) {
    const t = Math.max(0, Math.min(1, (now - t0) / duration));
    const e = 1 - Math.pow(1 - t, 3);
    const q = qMul(qAxis(axis, (1 - e) * turns * Math.PI * 2), qEnd);
    const bounce = Math.abs(Math.sin(e * Math.PI * 3)) * (1 - e) * 0.22;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, size, size);
    const R = size * 0.38, cx = size / 2, cy = size / 2 - bounce * size;
    // ombra
    x.fillStyle = "rgba(0,0,0,.35)";
    x.beginPath(); x.ellipse(size / 2, size * 0.9, R * (0.8 - bounce), R * 0.16, 0, 0, Math.PI * 2); x.fill();
    const P = S.verts.map((v) => { const r = qRot(q, v); const k = 1 / (1 - r[2] * 0.18); return [cx + r[0] * R * k, cy - r[1] * R * k, r[2]]; });
    const fs = S.faces.map((f, i) => {
      const n = qRot(q, f.n), c = qRot(q, f.c);
      return { f, i, n, z: c[2] };
    }).filter((o) => o.n[2] > 0.02).sort((a, b) => a.z - b.z);
    for (const o of fs) {
      const light = 0.7 + 0.75 * Math.max(0, dot(o.n, LIGHT));
      x.beginPath();
      o.f.idx.forEach((vi, k) => (k ? x.lineTo(P[vi][0], P[vi][1]) : x.moveTo(P[vi][0], P[vi][1])));
      x.closePath();
      x.fillStyle = shade(colors.body, light); x.fill();
      x.strokeStyle = colors.edge; x.globalAlpha = 0.85; x.lineWidth = Math.max(1, size / 60); x.lineJoin = "round"; x.stroke(); x.globalAlpha = 1;
      if (o.n[2] > 0.3 && labels[o.i] !== "") {
        const c = qRot(q, o.f.c); const k = 1 / (1 - c[2] * 0.18);
        const px = cx + c[0] * R * k, py = cy - c[1] * R * k;
        const big = S.faces.length <= 6 ? 0.8 : S.faces.length <= 8 ? 0.6 : S.faces.length <= 12 ? 0.5 : 0.42;
        x.save();
        x.translate(px, py); x.scale(1, Math.max(0.35, o.n[2]));
        x.font = `700 ${Math.round(R * big * (String(labels[o.i]).length > 2 ? 0.75 : 1))}px Georgia, serif`;
        x.textAlign = "center"; x.textBaseline = "middle";
        x.fillStyle = colors.text; x.globalAlpha = 0.4 + 0.6 * o.n[2];
        x.fillText(fmt(labels[o.i]), 0, S.faces.length === 4 ? R * 0.08 : 0);
        x.restore();
      }
    }
    if (t < 1) requestAnimationFrame(draw);
    else onLand?.();
  }
  requestAnimationFrame(draw);
  return cv;
}
