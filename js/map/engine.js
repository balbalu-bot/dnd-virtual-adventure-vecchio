// =====================================================================
//  Motore del tavolo virtuale (Canvas 2D, senza librerie esterne)
//  Zoom, spostamento, griglia, token, disegni, righello, nebbia, segnali
// =====================================================================
import { gridOf, snap, distance, hexFromPixel, hexToPixel, hexCorners } from "./grid.js";

const KIND_LAYER = { door: 0, trap: 1, treasure: 1, note: 1, object: 2, npc: 3, monster: 3, pc: 4 };
const FOG_SCALE = 0.25;
const imgCache = new Map();

function loadImg(src, onload) {
  if (!src) return null;
  let e = imgCache.get(src);
  if (!e) {
    e = { img: new Image(), ok: false };
    e.img.onload = () => { e.ok = true; onload?.(); };
    e.img.onerror = () => { e.failed = true; };
    e.img.src = src;
    imgCache.set(src, e);
  } else if (!e.ok && onload && !e.failed) {
    e.img.addEventListener("load", onload, { once: true });
  }
  return e;
}

export class MapView {
  constructor(container, opts) {
    this.opts = opts;
    this.el = container;
    this.canvas = document.createElement("canvas");
    this.canvas.className = "map-canvas";
    this.canvas.tabIndex = 0;
    container.append(this.canvas);
    this.ctx = this.canvas.getContext("2d");
    this.map = null;
    this.bg = null;
    this.tokens = new Map();
    this.drawings = new Map();
    this.fogOps = [];
    this.fogCanvas = null;
    this.cam = { x: 0, y: 0, s: 1 };
    this.tool = "select";
    this.drawStyle = { color: "#b3261e", width: 4, dmOnly: false };
    this.selected = null;
    this.pointers = new Map();
    this.gesture = null;
    this.pings = [];
    this.remoteMeasures = new Map();
    this.remoteDrags = new Map();
    this.dirty = true;
    this._raf = 0;
    this._lastDragSent = 0;

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.bindEvents();
    this.loop = this.loop.bind(this);
    this._raf = requestAnimationFrame(this.loop);
  }

  destroy() {
    cancelAnimationFrame(this._raf);
    this.ro.disconnect();
    this.canvas.remove();
  }

  // ------------------------------------------------------------ dati
  setMap(map, imageUrl) {
    const changedMap = !this.map || this.map.id !== map?.id;
    this.map = map;
    this.g = map ? gridOf(map) : null;
    if (map && imageUrl) {
      this.bg = loadImg(imageUrl, () => this.invalidate());
    } else this.bg = null;
    if (changedMap) { this.selected = null; this.fit(); }
    this.setFog(map?.fog || []);
    this.invalidate();
  }
  setTokens(list) { this.tokens = new Map(list.map((t) => [t.id, t])); this.invalidate(); }
  upsertToken(t) { this.tokens.set(t.id, { ...(this.tokens.get(t.id) || {}), ...t }); this.remoteDrags.delete(t.id); this.invalidate(); }
  removeToken(id) { this.tokens.delete(id); if (this.selected === id) this.select(null); this.invalidate(); }
  setDrawings(list) { this.drawings = new Map(list.map((d) => [d.id, d])); this.invalidate(); }
  upsertDrawing(d) { this.drawings.set(d.id, d); this.invalidate(); }
  removeDrawing(id) { this.drawings.delete(id); this.invalidate(); }

  setFog(ops) {
    this.fogOps = Array.isArray(ops) ? ops : [];
    this.rebuildFog();
  }
  rebuildFog() {
    if (!this.map || !this.map.fog_enabled) { this.fogCanvas = null; this.invalidate(); return; }
    const w = Math.max(1, Math.ceil(this.map.width * FOG_SCALE));
    const h = Math.max(1, Math.ceil(this.map.height * FOG_SCALE));
    const c = this.fogCanvas && this.fogCanvas.width === w && this.fogCanvas.height === h ? this.fogCanvas : document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.globalCompositeOperation = "source-over";
    x.fillStyle = "#000";
    x.fillRect(0, 0, w, h);
    for (const op of this.fogOps) {
      x.globalCompositeOperation = op.op === "reveal" ? "destination-out" : "source-over";
      x.fillStyle = "#000";
      if (op.shape === "all") x.fillRect(0, 0, w, h);
      else if (op.shape === "rect") x.fillRect(op.x * FOG_SCALE, op.y * FOG_SCALE, op.w * FOG_SCALE, op.h * FOG_SCALE);
      else if (op.shape === "circle") { x.beginPath(); x.arc(op.x * FOG_SCALE, op.y * FOG_SCALE, op.r * FOG_SCALE, 0, Math.PI * 2); x.fill(); }
    }
    this.fogCanvas = c;
    this.invalidate();
  }
  /** true se il punto è coperto dalla nebbia */
  isFogged(x, y) {
    if (!this.fogCanvas) return false;
    const d = this.fogCanvas.getContext("2d").getImageData(Math.floor(x * FOG_SCALE), Math.floor(y * FOG_SCALE), 1, 1).data;
    return d[3] > 128;
  }

  setCombat({ activeTokenId = null, links = [] } = {}) { this.combat = { activeTokenId, links }; this.invalidate(); }

  setTool(t) { this.tool = t; this.measure = null; this.draft = null; this.canvas.dataset.tool = t; this.invalidate(); }
  setDrawStyle(s) { Object.assign(this.drawStyle, s); }
  select(id) { this.selected = id; this.opts.onSelect?.(id ? this.tokens.get(id) : null); this.invalidate(); }

  // ------------------------------------------------------------ camera
  resize() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, r.width); this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * dpr); this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + "px"; this.canvas.style.height = this.h + "px";
    this.dpr = dpr;
    if (!this._fitted && this.map) this.fit();
    this.invalidate();
  }
  fit() {
    if (!this.map || this.w < 10) return;
    const s = Math.min(this.w / this.map.width, this.h / this.map.height) * 0.95;
    this.cam.s = Math.max(0.05, s);
    this.cam.x = this.map.width / 2 - this.w / 2 / this.cam.s;
    this.cam.y = this.map.height / 2 - this.h / 2 / this.cam.s;
    this._fitted = true;
    this.invalidate();
  }
  centerOn(x, y) {
    this.cam.x = x - this.w / 2 / this.cam.s;
    this.cam.y = y - this.h / 2 / this.cam.s;
    this.invalidate();
  }
  zoomAt(factor, sx = this.w / 2, sy = this.h / 2) {
    const before = this.toWorld(sx, sy);
    this.cam.s = Math.max(0.05, Math.min(8, this.cam.s * factor));
    this.cam.x = before.x - sx / this.cam.s;
    this.cam.y = before.y - sy / this.cam.s;
    this.invalidate();
  }
  toWorld(sx, sy) { return { x: sx / this.cam.s + this.cam.x, y: sy / this.cam.s + this.cam.y }; }
  toScreen(x, y) { return { x: (x - this.cam.x) * this.cam.s, y: (y - this.cam.y) * this.cam.s }; }
  viewCenter() { return this.toWorld(this.w / 2, this.h / 2); }

  // ------------------------------------------------------------ input
  bindEvents() {
    const c = this.canvas;
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      const r = c.getBoundingClientRect();
      const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
      this.zoomAt(f, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    c.addEventListener("pointerdown", (e) => this.onDown(e));
    c.addEventListener("pointermove", (e) => this.onMove(e));
    c.addEventListener("pointerup", (e) => this.onUp(e));
    c.addEventListener("pointercancel", (e) => this.onUp(e, true));
    c.addEventListener("dblclick", (e) => {
      const p = this.evPoint(e);
      const t = this.hitToken(p.x, p.y);
      if (t) this.opts.onTokenDblClick?.(t);
    });
    c.addEventListener("keydown", (e) => {
      if (e.key === "Delete" || e.key === "Backspace") { if (this.selected) this.opts.onDeleteKey?.(this.tokens.get(this.selected)); }
      if (e.key === "Escape") { this.select(null); this.measure = null; this.draft = null; this.invalidate(); }
      if (e.key === "+" || e.key === "=") this.zoomAt(1.2);
      if (e.key === "-") this.zoomAt(1 / 1.2);
    });
  }
  evPoint(e) {
    const r = this.canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    return { sx, sy, ...this.toWorld(sx, sy) };
  }
  canMove(t) {
    if (!t) return false;
    if (this.opts.isDM()) return true;
    return t.owner_id === this.opts.myId && !t.locked && !t.hidden;
  }

  onDown(e) {
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(e.pointerId);
    const p = this.evPoint(e);
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      // pizzico a due dita: zoom + spostamento
      const [a, b] = [...this.pointers.values()];
      this.gesture = { type: "pinch", dist: Math.hypot(a.sx - b.sx, a.sy - b.sy), mid: { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 } };
      this.drag = null; this.draft = null; this.measure = null; this.rectOp = null;
      return;
    }
    if (this.pointers.size > 2) return;
    const tool = e.button === 1 || e.button === 2 ? "pan" : this.tool;
    if ((e.altKey && tool === "select") || tool === "ping") { this.opts.onPing?.(p.x, p.y); this.addPing(p.x, p.y, this.opts.myColor || "#f4d58d"); return; }
    if (tool === "pan") { this.gesture = { type: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y }; return; }
    if (tool === "select") {
      const t = this.hitToken(p.x, p.y);
      if (t) {
        this.select(t.id);
        if (this.canMove(t)) this.drag = { id: t.id, dx: p.x - t.x, dy: p.y - t.y, x: t.x, y: t.y, moved: false, sx: p.sx, sy: p.sy };
        return;
      }
      this.select(null);
      this.gesture = { type: "pan", sx: p.sx, sy: p.sy, cx: this.cam.x, cy: this.cam.y };
      return;
    }
    if (tool === "measure") { this.measure = { a: this.snapCenter(p), b: this.snapCenter(p) }; this.invalidate(); return; }
    if (tool === "draw") { this.draft = { kind: "path", points: [[p.x, p.y]], color: this.drawStyle.color, width: this.drawStyle.width / Math.max(0.3, this.cam.s) }; return; }
    if (tool === "text") { this.opts.onTextAt?.(p.x, p.y); return; }
    if (tool === "fog-reveal" || tool === "fog-cover") { this.rectOp = { op: tool === "fog-reveal" ? "reveal" : "cover", x0: p.x, y0: p.y, x1: p.x, y1: p.y }; this.invalidate(); }
  }

  onMove(e) {
    if (!this.pointers.has(e.pointerId)) {
      // passaggio del mouse: cursore
      const p = this.evPoint(e);
      const t = this.tool === "select" ? this.hitToken(p.x, p.y) : null;
      this.canvas.style.cursor = t ? (this.canMove(t) ? "grab" : "pointer") : "";
      return;
    }
    const p = this.evPoint(e);
    this.pointers.set(e.pointerId, p);
    if (this.gesture?.type === "pinch" && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.sx - b.sx, a.sy - b.sy);
      const mid = { x: (a.sx + b.sx) / 2, y: (a.sy + b.sy) / 2 };
      this.zoomAt(dist / (this.gesture.dist || dist), mid.x, mid.y);
      this.cam.x -= (mid.x - this.gesture.mid.x) / this.cam.s;
      this.cam.y -= (mid.y - this.gesture.mid.y) / this.cam.s;
      this.gesture.dist = dist; this.gesture.mid = mid;
      this.invalidate();
      return;
    }
    if (this.gesture?.type === "pan") {
      this.cam.x = this.gesture.cx - (p.sx - this.gesture.sx) / this.cam.s;
      this.cam.y = this.gesture.cy - (p.sy - this.gesture.sy) / this.cam.s;
      this.invalidate();
      return;
    }
    if (this.drag) {
      if (!this.drag.moved && Math.hypot(p.sx - this.drag.sx, p.sy - this.drag.sy) < 4) return;
      this.drag.moved = true;
      this.drag.x = p.x - this.drag.dx; this.drag.y = p.y - this.drag.dy;
      this.canvas.style.cursor = "grabbing";
      const now = performance.now();
      if (now - this._lastDragSent > 70) { this._lastDragSent = now; this.opts.onTokenDrag?.(this.tokens.get(this.drag.id), this.drag.x, this.drag.y); }
      this.invalidate();
      return;
    }
    if (this.measure) {
      this.measure.b = this.snapCenter(p);
      const now = performance.now();
      if (now - this._lastDragSent > 90) { this._lastDragSent = now; this.opts.onMeasure?.([this.measure.a, this.measure.b]); }
      this.invalidate();
      return;
    }
    if (this.draft) {
      const last = this.draft.points[this.draft.points.length - 1];
      if (Math.hypot(p.x - last[0], p.y - last[1]) * this.cam.s > 2) this.draft.points.push([Math.round(p.x * 10) / 10, Math.round(p.y * 10) / 10]);
      this.invalidate();
      return;
    }
    if (this.rectOp) { this.rectOp.x1 = p.x; this.rectOp.y1 = p.y; this.invalidate(); }
  }

  onUp(e, cancelled) {
    this.pointers.delete(e.pointerId);
    if (this.gesture?.type === "pinch") { if (this.pointers.size < 2) this.gesture = null; return; }
    if (this.gesture) { this.gesture = null; return; }
    if (this.drag) {
      const d = this.drag; this.drag = null;
      const t = this.tokens.get(d.id);
      this.canvas.style.cursor = "";
      if (d.moved && t && !cancelled) {
        const s = this.snapToken(t, d.x, d.y);
        const clamped = { x: Math.max(0, Math.min(this.map.width, s.x)), y: Math.max(0, Math.min(this.map.height, s.y)) };
        const prev = { x: t.x, y: t.y };
        t.x = clamped.x; t.y = clamped.y; // ottimistico
        this.opts.onTokenDrop?.(t, clamped.x, clamped.y, prev);
      }
      this.invalidate();
      return;
    }
    if (this.measure) {
      this.opts.onMeasure?.(null);
      if (this.tool !== "measure") this.measure = null;
      this.invalidate();
      return;
    }
    if (this.draft) {
      const d = this.draft; this.draft = null;
      if (!cancelled && d.points.length > 1) this.opts.onDrawingDone?.({ kind: "path", points: simplify(d.points, 1.5 / this.cam.s), color: d.color, width: Math.round(d.width * 10) / 10 });
      this.invalidate();
      return;
    }
    if (this.rectOp) {
      const r = this.rectOp; this.rectOp = null;
      const x = Math.min(r.x0, r.x1), y = Math.min(r.y0, r.y1), w = Math.abs(r.x1 - r.x0), h = Math.abs(r.y1 - r.y0);
      if (!cancelled && w * this.cam.s > 4 && h * this.cam.s > 4) this.opts.onFogOp?.({ op: r.op, shape: "rect", x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
      this.invalidate();
    }
  }

  snapCenter(p) { return this.g && this.g.type !== "none" ? snap(this.g, p.x, p.y, 1) : { x: p.x, y: p.y }; }
  snapToken(t, x, y) {
    if (!this.g || this.g.type === "none" || t.kind === "note") return { x, y };
    if (t.kind === "door") return snap({ ...this.g, type: this.g.type === "hex" ? "none" : "square" }, x, y, 2);
    return snap(this.g, x, y, Number(t.size) || 1);
  }

  tokenRadius(t) {
    const cell = this.g && this.g.type !== "none" ? this.g.size : 70;
    return Math.max(8, (Number(t.size) || 1) * cell / 2 * (t.kind === "pc" || t.kind === "npc" || t.kind === "monster" ? 0.9 : 0.8));
  }
  tokenPos(t) {
    if (this.drag && this.drag.id === t.id && this.drag.moved) return { x: this.drag.x, y: this.drag.y };
    const r = this.remoteDrags.get(t.id);
    if (r && performance.now() - r.at < 2500) return r;
    return { x: t.x, y: t.y };
  }
  sortedTokens() {
    return [...this.tokens.values()].sort((a, b) => (KIND_LAYER[a.kind] ?? 2) - (KIND_LAYER[b.kind] ?? 2) || (a.z || 0) - (b.z || 0));
  }
  hitToken(x, y) {
    const list = this.sortedTokens().reverse();
    for (const t of list) {
      if (!this.opts.isDM() && this.fogCanvas && t.kind !== "pc" && this.isFogged(t.x, t.y)) continue;
      const p = this.tokenPos(t);
      if (Math.hypot(x - p.x, y - p.y) <= this.tokenRadius(t)) return t;
    }
    return null;
  }

  // ------------------------------------------------------------ elementi remoti
  addPing(x, y, color, label) { this.pings.push({ x, y, color, label, at: performance.now() }); this.invalidate(); }
  showRemoteMeasure(id, pts, label, color) {
    if (!pts) this.remoteMeasures.delete(id); else this.remoteMeasures.set(id, { pts, label, color, at: performance.now() });
    this.invalidate();
  }
  showRemoteDrag(id, x, y) { if (this.tokens.has(id)) { this.remoteDrags.set(id, { x, y, at: performance.now() }); this.invalidate(); } }

  // ------------------------------------------------------------ disegno
  invalidate() { this.dirty = true; }
  loop() {
    this._raf = requestAnimationFrame(this.loop);
    const animating = this.pings.length || this.remoteDrags.size || this.remoteMeasures.size || this._pulse;
    if (!this.dirty && !animating) return;
    const now = performance.now();
    if (!this.dirty && !this.pings.length && !this.remoteDrags.size && !this.remoteMeasures.size && now - (this._lastFrame || 0) < 70) return;
    this._lastFrame = now;
    this.dirty = false;
    try { this.render(); } catch (e) { console.error(e); }
  }

  render() {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#120d09";
    ctx.fillRect(0, 0, this.w, this.h);
    if (!this.map) return;
    const m = this.map, s = this.cam.s;
    ctx.setTransform(dpr * s, 0, 0, dpr * s, -this.cam.x * s * dpr, -this.cam.y * s * dpr);

    // sfondo e immagine
    ctx.fillStyle = m.bg_color || "#d9c497";
    ctx.fillRect(0, 0, m.width, m.height);
    if (this.bg?.ok) ctx.drawImage(this.bg.img, 0, 0, m.width, m.height);
    else if (m.image_path) {
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.font = `${24 / s}px serif`; ctx.textAlign = "center";
      ctx.fillText(this.bg?.failed ? "Immagine non disponibile" : "Caricamento mappa…", m.width / 2, m.height / 2);
    }

    this.drawGrid(ctx);
    for (const d of this.drawings.values()) this.drawDrawing(ctx, d);
    if (this.draft) this.drawDrawing(ctx, this.draft);

    const isDM = this.opts.isDM();
    const tokens = this.sortedTokens();
    const under = tokens.filter((t) => t.kind !== "pc");
    const over = tokens.filter((t) => t.kind === "pc");
    for (const t of under) this.drawToken(ctx, t);
    if (this.fogCanvas) {
      ctx.save();
      ctx.globalAlpha = isDM ? 0.5 : 1;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogCanvas, 0, 0, m.width, m.height);
      ctx.restore();
    }
    for (const t of over) this.drawToken(ctx, t);
    this.drawCombat(ctx);

    // rettangolo nebbia in corso
    if (this.rectOp) {
      const r = this.rectOp;
      ctx.save();
      ctx.fillStyle = r.op === "reveal" ? "rgba(255,240,200,.25)" : "rgba(0,0,0,.45)";
      ctx.strokeStyle = r.op === "reveal" ? "#f4d58d" : "#000"; ctx.lineWidth = 2 / s; ctx.setLineDash([8 / s, 6 / s]);
      ctx.fillRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.strokeRect(Math.min(r.x0, r.x1), Math.min(r.y0, r.y1), Math.abs(r.x1 - r.x0), Math.abs(r.y1 - r.y0));
      ctx.restore();
    }

    // righelli
    const now = performance.now();
    for (const [id, rm] of this.remoteMeasures) {
      if (now - rm.at > 8000) { this.remoteMeasures.delete(id); continue; }
      this.drawMeasure(ctx, rm.pts[0], rm.pts[1], rm.color || "#7fd6ff", rm.label);
    }
    if (this.measure) this.drawMeasure(ctx, this.measure.a, this.measure.b, "#f4d58d");
    if (this.drag?.moved) {
      const t = this.tokens.get(this.drag.id);
      if (t) this.drawMeasure(ctx, { x: t.x, y: t.y }, this.snapToken(t, this.drag.x, this.drag.y), "#f4d58d");
    }
    for (const [id, r] of this.remoteDrags) if (now - r.at > 2500) this.remoteDrags.delete(id);

    // segnali (ping)
    this.pings = this.pings.filter((p) => now - p.at < 1800);
    for (const p of this.pings) {
      const k = (now - p.at) / 1800;
      ctx.save();
      ctx.strokeStyle = p.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4 / s;
      for (const off of [0, 0.3]) {
        const kk = Math.min(1, k + off);
        ctx.beginPath(); ctx.arc(p.x, p.y, (10 + kk * 70) / s, 0, Math.PI * 2); ctx.stroke();
      }
      if (p.label) { ctx.fillStyle = p.color; ctx.font = `bold ${14 / s}px sans-serif`; ctx.textAlign = "center"; ctx.fillText(p.label, p.x, p.y - 24 / s); }
      ctx.restore();
    }
  }

  drawGrid(ctx) {
    const g = this.g, m = this.map, s = this.cam.s;
    if (!g || g.type === "none" || m.grid_opacity <= 0) return;
    if (g.size * s < 6) return; // troppo piccolo per vederla
    const a = this.toWorld(0, 0), b = this.toWorld(this.w, this.h);
    const x0 = Math.max(0, a.x), y0 = Math.max(0, a.y), x1 = Math.min(m.width, b.x), y1 = Math.min(m.height, b.y);
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, m.width, m.height); ctx.clip();
    ctx.strokeStyle = m.grid_color || "#2a1c0f";
    ctx.globalAlpha = Number(m.grid_opacity ?? 0.35);
    ctx.lineWidth = Math.max(1 / s, 1);
    ctx.beginPath();
    if (g.type === "square") {
      const st = g.size;
      for (let x = g.ox + Math.floor((x0 - g.ox) / st) * st; x <= x1; x += st) { ctx.moveTo(x, y0); ctx.lineTo(x, y1); }
      for (let y = g.oy + Math.floor((y0 - g.oy) / st) * st; y <= y1; y += st) { ctx.moveTo(x0, y); ctx.lineTo(x1, y); }
    } else {
      const R = g.size / Math.sqrt(3);
      const rMin = Math.floor((y0 - g.oy) / (1.5 * R)) - 1, rMax = Math.ceil((y1 - g.oy) / (1.5 * R)) + 1;
      for (let r = rMin; r <= rMax; r++) {
        const qMin = Math.floor((x0 - g.ox) / g.size - r / 2) - 1, qMax = Math.ceil((x1 - g.ox) / g.size - r / 2) + 1;
        for (let q = qMin; q <= qMax; q++) {
          const c = hexToPixel(g, q, r);
          const pts = hexCorners(g, c.x, c.y);
          ctx.moveTo(pts[0][0], pts[0][1]);
          for (let i = 1; i < 6; i++) ctx.lineTo(pts[i][0], pts[i][1]);
          ctx.closePath();
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  drawDrawing(ctx, d) {
    ctx.save();
    ctx.strokeStyle = d.color; ctx.fillStyle = d.color;
    ctx.lineWidth = Number(d.width) || 4; ctx.lineCap = "round"; ctx.lineJoin = "round";
    if (d.dm_only) ctx.globalAlpha = 0.7;
    const pts = d.points || [];
    if (d.kind === "text" && pts[0]) {
      const fs = Math.max(14, (this.g?.size || 70) * 0.32);
      ctx.font = `bold ${fs}px Georgia, serif`;
      const lines = String(d.text || "").split("\n");
      const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + fs;
      ctx.fillStyle = d.dm_only ? "rgba(60,20,60,.85)" : "rgba(250,240,215,.92)";
      ctx.strokeStyle = d.dm_only ? "#c79bff" : "#7a5422"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.rect(pts[0][0], pts[0][1], w, lines.length * fs * 1.25 + fs * 0.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = d.dm_only ? "#f2e6ff" : "#2a1c0f";
      lines.forEach((l, i) => ctx.fillText(l, pts[0][0] + fs / 2, pts[0][1] + fs * (1.1 + i * 1.25)));
    } else if (pts.length > 1) {
      ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawToken(ctx, t) {
    const isDM = this.opts.isDM();
    const pos = this.tokenPos(t);
    const r = this.tokenRadius(t);
    const s = this.cam.s;
    ctx.save();
    if (t.hidden) ctx.globalAlpha = 0.45;
    if (t.kind === "door") {
      const cell = this.g?.size || 70;
      const open = !!t.state?.open;
      ctx.translate(pos.x, pos.y); ctx.rotate((Number(t.rotation) || 0) * Math.PI / 180);
      ctx.fillStyle = open ? "rgba(120,80,40,.25)" : "#6b4423";
      ctx.strokeStyle = open ? "#6b4423" : "#2a1708"; ctx.lineWidth = 3 / Math.max(s, 0.5);
      ctx.setLineDash(open ? [6, 5] : []);
      ctx.beginPath(); ctx.rect(-cell / 2, -cell * 0.12, cell, cell * 0.24); ctx.fill(); ctx.stroke();
      if (!open) { ctx.fillStyle = "#f4d58d"; ctx.beginPath(); ctx.arc(cell * 0.28, 0, cell * 0.04, 0, Math.PI * 2); ctx.fill(); }
      if (t.state?.locked_door) { ctx.fillStyle = "#f4d58d"; ctx.font = `${cell * 0.25}px sans-serif`; ctx.textAlign = "center"; ctx.fillText("🔒", 0, -cell * 0.18); }
    } else if (t.kind === "trap") {
      const fired = !!t.state?.triggered;
      ctx.fillStyle = fired ? "rgba(208,69,58,.85)" : "rgba(208,69,58,.35)";
      ctx.strokeStyle = "#7a1010"; ctx.lineWidth = 3 / Math.max(s, 0.5);
      ctx.beginPath(); ctx.moveTo(pos.x, pos.y - r); ctx.lineTo(pos.x + r * 0.95, pos.y + r * 0.75); ctx.lineTo(pos.x - r * 0.95, pos.y + r * 0.75); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#fff"; ctx.font = `bold ${r}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("!", pos.x, pos.y + r * 0.15);
    } else if (t.kind === "treasure") {
      ctx.fillStyle = "#8a5a1c"; ctx.strokeStyle = "#f4d58d"; ctx.lineWidth = 3 / Math.max(s, 0.5);
      ctx.beginPath(); ctx.rect(pos.x - r * 0.8, pos.y - r * 0.45, r * 1.6, r * 1.0); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos.x - r * 0.8, pos.y - r * 0.1); ctx.lineTo(pos.x + r * 0.8, pos.y - r * 0.1); ctx.stroke();
      ctx.fillStyle = "#f4d58d"; ctx.beginPath(); ctx.arc(pos.x, pos.y - r * 0.05, r * 0.12, 0, Math.PI * 2); ctx.fill();
      if (t.state?.taken) { ctx.globalAlpha = 0.6; ctx.fillStyle = "#000"; ctx.fillRect(pos.x - r * 0.8, pos.y - r * 0.45, r * 1.6, r); }
    } else if (t.kind === "note") {
      ctx.fillStyle = t.color || "#f4d58d"; ctx.strokeStyle = "#2a1c0f"; ctx.lineWidth = 2 / Math.max(s, 0.5);
      ctx.beginPath(); ctx.arc(pos.x, pos.y - r * 0.4, r * 0.45, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(pos.x - r * 0.15, pos.y - r * 0.05); ctx.lineTo(pos.x, pos.y + r * 0.6); ctx.lineTo(pos.x + r * 0.15, pos.y - r * 0.05); ctx.fill(); ctx.stroke();
    } else {
      // creature e oggetti: disco con ritratto o iniziali
      ctx.beginPath(); ctx.arc(pos.x, pos.y + r * 0.08, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,.35)"; ctx.fill(); // ombra
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fillStyle = t.kind === "object" ? "#5c4630" : "#2a1f16"; ctx.fill();
      const img = t.image ? loadImg(t.image, () => this.invalidate()) : null;
      if (img?.ok) {
        ctx.save(); ctx.clip();
        ctx.drawImage(img.img, pos.x - r, pos.y - r, r * 2, r * 2);
        ctx.restore();
      } else {
        ctx.fillStyle = "#f4e7c8"; ctx.font = `bold ${r * 0.8}px Georgia, serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.fillText(initials(t.name), pos.x, pos.y + r * 0.04);
      }
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.lineWidth = Math.max(3 / s, r * 0.12);
      ctx.strokeStyle = t.color || "#b3261e"; ctx.stroke();
      if (t.kind === "pc" && t.owner_id === this.opts.myId) {
        ctx.lineWidth = 2 / s; ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(pos.x, pos.y, r + ctx.lineWidth * 2, 0, Math.PI * 2); ctx.stroke();
      }
      if (t.state?.down) { ctx.strokeStyle = "#000"; ctx.lineWidth = r * 0.15; ctx.beginPath(); ctx.moveTo(pos.x - r * 0.7, pos.y - r * 0.7); ctx.lineTo(pos.x + r * 0.7, pos.y + r * 0.7); ctx.stroke(); }
    }
    if (t.hidden && isDM) {
      ctx.globalAlpha = 1; ctx.setLineDash([5 / s, 4 / s]); ctx.strokeStyle = "#c79bff"; ctx.lineWidth = 2 / s;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 4 / s, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    if (this.selected === t.id) {
      ctx.globalAlpha = 1; ctx.strokeStyle = "#f4d58d"; ctx.lineWidth = 3 / s;
      ctx.beginPath(); ctx.arc(pos.x, pos.y, r + 7 / s, 0, Math.PI * 2); ctx.stroke();
    }
    // etichetta
    if (t.name && t.kind !== "door" && (t.kind !== "trap" || isDM) && s * r > 8) {
      ctx.globalAlpha = t.hidden ? 0.7 : 1;
      const fs = Math.max(11 / s, r * 0.32);
      ctx.font = `bold ${fs}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "top";
      const label = t.name + (t.hidden && isDM ? " (nascosto)" : "");
      const w = ctx.measureText(label).width + fs * 0.6;
      ctx.fillStyle = "rgba(10,7,4,.75)";
      ctx.fillRect(pos.x - w / 2, pos.y + r + 3 / s, w, fs * 1.3);
      ctx.fillStyle = "#f4e7c8"; ctx.fillText(label, pos.x, pos.y + r + 3 / s + fs * 0.15);
    }
    ctx.restore();
  }

  drawCombat(ctx) {
    const cb = this.combat; if (!cb) return;
    const s = this.cam.s;
    const isDM = this.opts.isDM();
    const visible = (t) => t && (isDM || !this.fogCanvas || t.kind === "pc" || !this.isFogged(t.x, t.y));
    for (const [a, b] of cb.links || []) {
      const ta = this.tokens.get(a), tb = this.tokens.get(b);
      if (!visible(ta) || !visible(tb)) continue;
      const pa = this.tokenPos(ta), pb = this.tokenPos(tb);
      const ang = Math.atan2(pb.y - pa.y, pb.x - pa.x);
      const ra = this.tokenRadius(ta), rb = this.tokenRadius(tb) + 6 / s;
      const x1 = pa.x + Math.cos(ang) * ra, y1 = pa.y + Math.sin(ang) * ra;
      const x2 = pb.x - Math.cos(ang) * rb, y2 = pb.y - Math.sin(ang) * rb;
      ctx.save();
      ctx.strokeStyle = "rgba(255,90,74,.9)"; ctx.fillStyle = "rgba(255,90,74,.9)"; ctx.lineWidth = 3 / s; ctx.setLineDash([8 / s, 5 / s]);
      ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
      const hl = 12 / s;
      ctx.beginPath(); ctx.moveTo(x2, y2);
      ctx.lineTo(x2 - hl * Math.cos(ang - 0.45), y2 - hl * Math.sin(ang - 0.45));
      ctx.lineTo(x2 - hl * Math.cos(ang + 0.45), y2 - hl * Math.sin(ang + 0.45)); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    const act = this.tokens.get(cb.activeTokenId);
    if (visible(act)) {
      const p = this.tokenPos(act), r = this.tokenRadius(act);
      const k = (Math.sin(performance.now() / 300) + 1) / 2;
      ctx.save();
      ctx.strokeStyle = `rgba(244,213,141,${0.55 + 0.45 * k})`; ctx.lineWidth = (4 + 3 * k) / s;
      ctx.beginPath(); ctx.arc(p.x, p.y, r + (10 + 4 * k) / s, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
      this._pulse = true;
    } else this._pulse = false;
  }

  drawMeasure(ctx, a, b, color, who) {
    if (!a || !b || !this.g) return;
    const s = this.cam.s;
    const d = distance(this.g, a, b);
    ctx.save();
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 3 / s; ctx.setLineDash([10 / s, 6 / s]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); ctx.setLineDash([]);
    ctx.beginPath(); ctx.arc(a.x, a.y, 5 / s, 0, Math.PI * 2); ctx.arc(b.x, b.y, 5 / s, 0, Math.PI * 2); ctx.fill();
    const label = `${d.feet} ft · ${String(d.meters).replace(".", ",")} m · ${d.cells} ${d.cells === 1 ? "casella" : "caselle"}${who ? " — " + who : ""}`;
    ctx.font = `bold ${14 / s}px sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    const w = ctx.measureText(label).width + 14 / s;
    ctx.fillStyle = "rgba(10,7,4,.85)"; ctx.fillRect(b.x - w / 2, b.y - 34 / s, w, 22 / s);
    ctx.fillStyle = color; ctx.fillText(label, b.x, b.y - 23 / s);
    ctx.restore();
  }
}

function initials(n = "") {
  return n.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || "").join("") || "?";
}

// Riduce i punti di un tratto a mano libera (Ramer–Douglas–Peucker)
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const l = dx * dx + dy * dy || 1;
    let t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const rec = (s, e, out) => {
    let max = 0, idx = -1;
    for (let i = s + 1; i < e; i++) { const d = d2(pts[i], pts[s], pts[e]); if (d > max) { max = d; idx = i; } }
    if (max > eps) { rec(s, idx, out); out.pop(); rec(idx, e, out); } else out.push(pts[s], pts[e]);
    return out;
  };
  const out = rec(0, pts.length - 1, []);
  return out.length > 4000 ? out.filter((_, i) => i % Math.ceil(out.length / 4000) === 0) : out;
}

export { hexFromPixel };
