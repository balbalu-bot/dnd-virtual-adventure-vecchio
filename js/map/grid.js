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
