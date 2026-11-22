// Geometria della griglia: quadrata ed esagonale (vertici in alto)

const SQ3 = Math.sqrt(3);

export function gridOf(map) {
  return {
    type: map.grid_type || "square",
    size: Number(map.grid_size) || 70,
    ox: Number(map.grid_offset_x) || 0,
    oy: Number(map.grid_offset_y) || 0,
    feet: Number(map.feet_per_cell) || 5,
    rule: map.diagonal_rule || "5e",
  };
}

// ---------------- esagoni (pointy-top), "size" = distanza tra centri adiacenti
function hexR(g) { return g.size / SQ3; }

export function hexFromPixel(g, x, y) {
  const R = hexR(g);
  const px = x - g.ox, py = y - g.oy;
  const q = (SQ3 / 3 * px - py / 3) / R;
  const r = (2 / 3 * py) / R;
  return hexRound(q, r);
}
function hexRound(q, r) {
  const s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}
export function hexToPixel(g, q, r) {
  const R = hexR(g);
  return { x: R * (SQ3 * q + SQ3 / 2 * r) + g.ox, y: R * (1.5 * r) + g.oy };
}
export function hexCorners(g, cx, cy) {
  const R = hexR(g);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 30);
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

// ---------------- aggancio alla griglia
export function snap(g, x, y, size = 1) {
  if (g.type === "none") return { x, y };
  if (g.type === "hex") {
    const h = hexFromPixel(g, x, y);
    return hexToPixel(g, h.q, h.r);
  }
  const s = g.size;
  const even = Math.round(size) % 2 === 0 && size >= 1;
  if (even) {
    return { x: Math.round((x - g.ox) / s) * s + g.ox, y: Math.round((y - g.oy) / s) * s + g.oy };
  }
  return { x: (Math.floor((x - g.ox) / s) + 0.5) * s + g.ox, y: (Math.floor((y - g.oy) / s) + 0.5) * s + g.oy };
}

// ---------------- distanze (in caselle e piedi/metri)
export function distance(g, a, b) {
  let cells;
  if (g.type === "hex") {
    const A = hexFromPixel(g, a.x, a.y), B = hexFromPixel(g, b.x, b.y);
    const dq = A.q - B.q, dr = A.r - B.r;
    cells = (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
  } else {
    const s = g.size;
    const dx = Math.abs(Math.round((b.x - a.x) / s));
    const dy = Math.abs(Math.round((b.y - a.y) / s));
    if (g.rule === "euclid" || g.type === "none") {
      cells = Math.hypot(b.x - a.x, b.y - a.y) / s;
      cells = Math.round(cells * 10) / 10;
    } else if (g.rule === "5-10-5") {
      const diag = Math.min(dx, dy), straight = Math.max(dx, dy) - diag;
      cells = straight + diag + Math.floor(diag / 2);
    } else {
      cells = Math.max(dx, dy); // regola base 5e: ogni casella diagonale vale 1
    }
  }
  return { cells, feet: Math.round(cells * g.feet * 10) / 10, meters: Math.round(cells * g.feet * 0.3 * 10) / 10 };
}

export function cellPx(g) { return g.size; }

// ---------------- caselle, ostacoli e percorsi (stessa logica del server)
/** Casella che contiene il punto: {a, b} = (colonna, riga) o (q, r) esagonale */
export function cellOf(g, x, y) {
  if (g.type === "hex") { const h = hexFromPixel(g, x, y); return { a: h.q, b: h.r }; }
  return { a: Math.floor((x - g.ox) / g.size + 1e-6), b: Math.floor((y - g.oy) / g.size + 1e-6) };
}
export function cellCenter(g, a, b) {
  if (g.type === "hex") return hexToPixel(g, a, b);
  return { x: (a + 0.5) * g.size + g.ox, y: (b + 0.5) * g.size + g.oy };
}
export const cellKey = (a, b) => a + "," + b;

const HEX_N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];
const SQ_N = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * Caselle raggiungibili entro "budget" caselle senza attraversare ostacoli.
 * Restituisce Map(chiave → {a, b, cost, prev}) — prev è la chiave di stato precedente.
 * Con la regola 5-10-5 la seconda diagonale costa 2: lo stato tiene conto della parità.
 */
export function reachable(g, start, budget, blocked, bounds) {
  const rule = g.type === "hex" ? "hex" : g.rule;
  const best = new Map();           // chiave casella → miglior stato
  const states = new Map();         // chiave stato → stato
  const sk = (a, b, p) => a + "," + b + "|" + p;
  const first = { a: start.a, b: start.b, p: 0, cost: 0, prev: null, k: sk(start.a, start.b, 0) };
  states.set(first.k, first);
  const open = new Heap();
  open.push(first);
  const inBounds = (a, b) => {
    if (!bounds) return true;
    const c = cellCenter(g, a, b);
    return c.x >= 0 && c.y >= 0 && c.x <= bounds.w && c.y <= bounds.h;
  };
  while (open.size) {
    const s = open.pop();
    if (states.get(s.k) !== s) continue; // superato da uno stato migliore
    const ck = cellKey(s.a, s.b);
    if (!best.has(ck) || best.get(ck).cost > s.cost) best.set(ck, s);
    for (const [da, db] of g.type === "hex" ? HEX_N : SQ_N) {
      const a = s.a + da, b = s.b + db;
      if (blocked.has(cellKey(a, b)) || !inBounds(a, b)) continue;
      let step = 1, p = s.p;
      if (g.type !== "hex" && da && db) {
        if (blocked.has(cellKey(s.a + da, s.b)) && blocked.has(cellKey(s.a, s.b + db))) continue;
        if (rule === "5-10-5") { p = s.p ^ 1; step = p === 0 ? 2 : 1; }
        else if (rule === "euclid") step = 1.5;
      }
      const cost = s.cost + step;
      if (cost > budget + 1e-6) continue;
      const k = sk(a, b, p);
      const old = states.get(k);
      if (old && old.cost <= cost) continue;
      const ns = { a, b, p, cost, prev: s.k, k };
      states.set(k, ns);
      open.push(ns);
    }
  }
  const out = new Map();
  for (const [ck, s] of best) out.set(ck, { a: s.a, b: s.b, cost: s.cost, stateKey: s.k });
  out.states = states;
  return out;
}

/** Percorso [[a,b],…] dalla partenza alla casella "key" (o null se irraggiungibile) */
export function pathTo(reach, key) {
  const r = reach.get(key); if (!r) return null;
  const path = [];
  let s = reach.states.get(r.stateKey);
  while (s) { path.unshift([s.a, s.b]); s = s.prev ? reach.states.get(s.prev) : null; }
  return path;
}

/** "9 m", "30 ft", "30" → piedi (come speed_feet sul server) */
export function speedFeet(txt) {
  const m = String(txt ?? "").toLowerCase().match(/([0-9]+(?:[.,][0-9]+)?)\s*(ft|piedi|m)?/);
  if (!m) return 30;
  const v = Number(m[1].replace(",", "."));
  if (m[2] === "ft" || m[2] === "piedi") return Math.round(v);
  if (m[2] === "m" || v <= 20) return Math.round(v / 0.3);
  return Math.round(v);
}

class Heap {
  constructor() { this.h = []; }
  get size() { return this.h.length; }
  push(v) { const h = this.h; h.push(v); let i = h.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (h[p].cost <= h[i].cost) break; [h[p], h[i]] = [h[i], h[p]]; i = p; } }
  pop() {
    const h = this.h, top = h[0], last = h.pop();
    if (h.length) { h[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i;
      if (l < h.length && h[l].cost < h[m].cost) m = l; if (r < h.length && h[r].cost < h[m].cost) m = r;
      if (m === i) break; [h[m], h[i]] = [h[i], h[m]]; i = m; } }
    return top;
  }
}
