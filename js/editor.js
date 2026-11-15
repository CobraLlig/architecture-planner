// The 2D plan editor: canvas view, snapping, and all drawing/editing tools.

import { store, DEFAULTS } from './store.js';
import { units, fmtLen, parseLen, IN, FT } from './units.js';
import * as G from './geom.js';
import { normalizeWalls, wallsOnLevel, polysFor, faceAt, facesFor, wallInfo, nodeKey } from './walls.js';
import { drawPlan, entityOutline, handlesFor, roomGeom, labelPoint, doorGeom, textBounds, THEME } from './render2d.js';
import { byId } from './library.js';
import { refSnapPoints, hitRef, scaleRefAbout, rotateRefAbout, refCorners, setRefRedraw } from './refs.js';

const FONT = 'Inter, "Segoe UI", Arial, sans-serif';
let clipboard = null;

const HINTS = {
  select: 'Click to select · drag to move · drag empty space to box-select · Del deletes · right-drag or Space+drag pans · scroll zooms',
  wall: 'Click to start a wall · Shift = free angle · Alt = no snapping',
  wall2: 'Click for the next point · type a length (e.g. 12\'6) and press Enter · Esc or double-click to finish',
  door: 'Hover a wall and click to place · swing follows your cursor side · F flips swing · H flips hinge',
  window: 'Hover a wall and click to place a window',
  calibrate: 'Click two points on the imported drawing whose real distance you know',
  room: 'Click inside any closed loop of walls to create a room (area updates live)',
  dim: 'Click the first point, then the second, then click to set the dimension line position',
  text: 'Click where the note should go',
  furniture: 'Click to place · R rotates 90° · it snaps flush to walls · Esc to stop',
};

export class Editor {
  constructor(canvas, wrap) {
    this.canvas = canvas;
    this.wrap = wrap;
    this.ctx = canvas.getContext('2d');
    this.tool = 'select';
    this.selection = new Set();
    this.hover = null;
    this.view = { s: 0.09, ox: 80, oy: 80 };
    this.snapOn = true;
    this.gridOn = true;
    this.layers = { walls: true, openings: true, rooms: true, furn: true, dims: true, notes: true };
    this.opts = {
      wallKind: 'exterior', thickness: null, doorStyle: 'single', doorWidth: DEFAULTS.doorWidth, doorHeight: DEFAULTS.doorHeight,
      windowStyle: 'casement', windowWidth: DEFAULTS.windowWidth, windowHeight: DEFAULTS.windowHeight, windowSill: DEFAULTS.windowSill,
      roomName: 'Room', roomFloor: 'wood', flip: false, hinge: 'a',
    };
    this.place = null;         // {lib, rot}
    this.draft = null;         // wall chain {start, first}
    this.dimDraft = null;      // {a, b}
    this.mouse = { sx: 0, sy: 0, p: { x: 0, y: 0 } };
    this.snapInfo = null;
    this.guides = [];
    this.drag = null;
    this.space = false;
    this.handlers = {};
    this.dirty = true;
    this.numEl = document.getElementById('numentry');
    this.textEl = document.getElementById('textentry');
    this._bind();
    store.subscribe((kind) => {
      for (const id of [...this.selection]) if (!store.get(id)) this.selection.delete(id);
      if (kind === 'restore') { this.draft = null; this.dimDraft = null; }
      this.emit('selection'); this.requestRender();
    });
    setRefRedraw(() => this.requestRender());
    this._wantFit = true;
    new ResizeObserver(() => this.resize()).observe(wrap);
    this.resize();
    const loop = () => {
      if (this.dirty) { this.dirty = false; try { this.render(); } catch (err) { console.error('render failed', err); } }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  on(name, fn) { (this.handlers[name] ||= []).push(fn); }
  emit(name, ...a) { for (const fn of this.handlers[name] || []) fn(...a); }
  requestRender() { this.dirty = true; }
  get s() { return this.view.s; }
  get level() { return store.level; }

  // ---- view ------------------------------------------------------------------
  resize() {
    const r = this.wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    if (this._wantFit && r.width > 50 && r.height > 50) this.fit();
    this.requestRender();
  }
  toWorld(sx, sy) { return { x: (sx - this.view.ox) / this.view.s, y: (sy - this.view.oy) / this.view.s }; }
  toScreen(p) { return { x: p.x * this.view.s + this.view.ox, y: p.y * this.view.s + this.view.oy }; }
  zoomAt(sx, sy, k) {
    const before = this.toWorld(sx, sy);
    this.view.s = G.clamp(this.view.s * k, 0.006, 1.6);
    this.view.ox = sx - before.x * this.view.s;
    this.view.oy = sy - before.y * this.view.s;
    this.requestRender(); this.emit('view');
  }
  fit() {
    const pts = [];
    const lv = this.level.id;
    for (const w of wallsOnLevel(store, lv)) pts.push(w.a, w.b);
    for (const e of store.list(null, lv)) {
      if (e.type === 'furniture') pts.push(...G.rectCorners(e.x, e.y, e.w, e.d, e.rot || 0));
      if (e.type === 'text') pts.push({ x: e.x, y: e.y });
      if (e.type === 'dim') { const n = G.leftN(G.norm(G.sub(e.b, e.a))), o = e.off ?? 600; pts.push(e.a, e.b, { x: e.a.x + n.x * o, y: e.a.y + n.y * o }, { x: e.b.x + n.x * o, y: e.b.y + n.y * o }); }
    }
    for (const r of store.list('ref', lv)) if (!r.hidden) pts.push(...refCorners(r));
    const bb = G.bbox(pts);
    if (!bb) { this.view = { s: 0.09, ox: 100, oy: 100 }; this.requestRender(); this.emit('view'); return; }
    const pad = 70;
    const s = Math.min((this.w - pad * 2) / Math.max(bb.w, 1000), (this.h - pad * 2) / Math.max(bb.h, 1000));
    this.view.s = G.clamp(s, 0.01, 0.4);
    this.view.ox = this.w / 2 - bb.cx * this.view.s;
    this.view.oy = this.h / 2 - bb.cy * this.view.s;
    this.requestRender(); this.emit('view');
  }
  gridStep() {
    const steps = units.system === 'imperial' ? [IN, 3 * IN, 6 * IN, FT, 2 * FT, 5 * FT, 10 * FT, 25 * FT, 50 * FT] : [10, 50, 100, 500, 1000, 5000, 10000, 25000, 50000];
    for (const st of steps) if (st * this.view.s >= 13) return st;
    return steps[steps.length - 1];
  }

  // ---- tools -----------------------------------------------------------------
  setTool(t, extra) {
    if (this.tool === 'wall' || this.tool === 'dim' || this.tool === 'calibrate') { this.draft = null; this.dimDraft = null; this.cal = null; }
    this.closeNum();
    this.tool = t;
    this.place = t === 'furniture' && extra ? { lib: extra, rot: 0 } : null;
    if (t !== 'select') { this.selection.clear(); this.hover = null; }
    this.snapInfo = null; this.guides = [];
    this.updateCursor();
    this.emit('tool', t); this.emit('selection'); this.emit('hint', this.hint());
    this.requestRender();
  }
  hint() {
    if (this.tool === 'wall') return this.draft ? HINTS.wall2 : HINTS.wall;
    if (this.tool === 'furniture' && this.place) return `Placing ${byId[this.place.lib]?.name}: ${HINTS.furniture}`;
    if (this.tool === 'calibrate') return this.cal?.a ? 'Click the second point' : (this.cal?.mode === 'align' ? 'Click two points along a line that should be level (horizontal or vertical)' : HINTS.calibrate);
    if (this.tool === 'dim') return this.dimDraft ? (this.dimDraft.b ? 'Click to place the dimension line' : 'Click the second point') : HINTS.dim;
    return HINTS[this.tool] || '';
  }
  updateCursor() {
    const c = this.canvas.style;
    if (this.drag?.type === 'pan' || this.space) c.cursor = 'grab';
    else c.cursor = this.tool === 'select' ? 'default' : 'crosshair';
  }
  setSelection(ids) { this.selection = new Set(ids); this.emit('selection'); this.requestRender(); }
  selected() { return [...this.selection].map((id) => store.get(id)).filter(Boolean); }

  // ---- snapping --------------------------------------------------------------
  snap(raw, o = {}) {
    this.guides = [];
    if (!this.snapOn || o.alt) return { p: { ...raw }, kind: null };
    const tol = 13 / this.s;
    const exclude = o.exclude || new Set();
    const walls = wallsOnLevel(store, this.level.id).filter((w) => !exclude.has(w.id));
    let best = null;
    const consider = (p, kind, label, d) => { if (d < tol && (!best || d < best.d - 1e-6)) best = { p, kind, label, d }; };
    for (const w of walls) {
      for (const P of [w.a, w.b]) consider({ x: P.x, y: P.y }, 'end', 'Endpoint', G.dist(raw, P));
    }
    if (!best && !o.noRef) for (const P of refSnapPoints(this.level.id)) { const d = Math.abs(P.x - raw.x) + Math.abs(P.y - raw.y); if (d < tol * 1.5) consider(P, 'end', 'Reference', G.dist(raw, P)); }
    if (best) return { p: best.p, kind: best.kind, label: best.label };
    for (const w of walls) {
      const m = G.lerp(w.a, w.b, 0.5);
      consider(m, 'mid', 'Midpoint', G.dist(raw, m));
    }
    if (best) return { p: best.p, kind: best.kind, label: best.label };
    if (o.noEdge !== true) {
      for (const w of walls) {
        const c = G.closestOnSeg(raw, w.a, w.b);
        consider(c.pt, 'edge', 'On wall', c.d);
      }
      if (best) return { p: best.p, kind: best.kind, label: best.label };
    }
    if (o.noGrid) return { p: { ...raw }, kind: null };
    const step = this.gridStep();
    const gs = (v) => Math.round(v / step) * step;
    if (o.from && !o.free) {
      const dx = raw.x - o.from.x, dy = raw.y - o.from.y;
      const L = Math.hypot(dx, dy);
      if (L > 1) {
        const ang = Math.atan2(dy, dx);
        const a45 = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
        if (Math.abs(G.normAngle(ang - a45)) < G.rad(6)) {
          const Ls = Math.max(step, Math.round(L / step) * step);
          const p = { x: o.from.x + Math.cos(a45) * Ls, y: o.from.y + Math.sin(a45) * Ls };
          // lock to existing node alignment if very close
          if (Math.abs(Math.cos(a45)) < 1e-6 || Math.abs(Math.sin(a45)) < 1e-6) { p.x = Math.abs(Math.cos(a45)) < 1e-6 ? o.from.x : p.x; p.y = Math.abs(Math.sin(a45)) < 1e-6 ? o.from.y : p.y; }
          this.guides.push({ from: o.from, to: p });
          return { p, kind: 'ortho', label: Math.abs(Math.sin(a45)) < 1e-6 || Math.abs(Math.cos(a45)) < 1e-6 ? 'Orthogonal' : '45°' };
        }
      }
    }
    // alignment with other nodes (x / y), otherwise grid
    let x = gs(raw.x), y = gs(raw.y), label = null;
    for (const w of walls) for (const P of [w.a, w.b]) {
      if (Math.abs(raw.x - P.x) < tol * 0.7) { x = P.x; this.guides.push({ from: P, to: { x: P.x, y: raw.y } }); label = 'Aligned'; }
      if (Math.abs(raw.y - P.y) < tol * 0.7) { y = P.y; this.guides.push({ from: P, to: { x: raw.x, y: P.y } }); label = 'Aligned'; }
    }
    return { p: { x, y }, kind: label ? 'align' : 'grid', label };
  }

  wallUnder(p, tolPx = 12) {
    const tol = tolPx / this.s;
    let best = null;
    for (const w of wallsOnLevel(store, this.level.id)) {
      const c = G.closestOnSeg(p, w.a, w.b);
      if (c.d <= w.thickness / 2 + tol && (!best || c.d < best.d)) best = { w, ...c };
    }
    return best;
  }

  /** Where would an opening of the given width go if the cursor is at p? */
  openingPlacement(p, width, base = {}) {
    const hit = this.wallUnder(p, 16);
    if (!hit) return null;
    const { len: L, n } = wallInfo(hit.w);
    if (L < width + 80) return null;
    let pos = G.clamp(hit.s, width / 2 + 50, L - width / 2 - 50);
    if (this.snapOn) {
      pos = Math.round(pos / 25) * 25;
      if (Math.abs(pos - L / 2) < 120) pos = L / 2;
      pos = G.clamp(pos, width / 2 + 50, L - width / 2 - 50);
    }
    const side = (G.dot(G.sub(p, hit.pt), n) >= 0 ? 1 : -1) * (this.opts.flip ? -1 : 1);
    return { wallId: hit.w.id, pos, side: base.side ?? side };
  }

  /** Furniture position that sits flush against a wall when the cursor is near one. */
  furnPlacement(p, item, w, d, rot) {
    let out = { x: p.x, y: p.y, rot, snapped: false };
    if (!this.snapOn) return out;
    let best = null;
    const reach = Math.max(w, d) / 2 + 220;
    for (const wl of wallsOnLevel(store, this.level.id)) {
      const c = G.closestOnSeg(p, wl.a, wl.b);
      const info = wallInfo(wl);
      const t = G.dot(G.sub(p, c.pt), info.n);
      const gap = Math.abs(t) - wl.thickness / 2;
      if (gap < d / 2 + 200 && c.d < reach && (!best || gap < best.gap)) best = { wl, c, info, t, gap };
    }
    if (!best) return out;
    const sgn = best.t >= 0 ? 1 : -1;
    const nn = { x: best.info.n.x * sgn, y: best.info.n.y * sgn };
    const r = Math.atan2(-nn.x, nn.y);
    const dist = best.wl.thickness / 2 + d / 2 + 2;
    return { x: best.c.pt.x + nn.x * dist, y: best.c.pt.y + nn.y * dist, rot: item.shape === 'round' ? rot : r, snapped: true };
  }

  // ---- hit testing -----------------------------------------------------------
  hitTest(p) {
    const lv = this.level.id;
    const polys = polysFor(store, lv);
    const tol = 6 / this.s;
    const L = this.layers;
    if (L.openings) for (const o of store.list('opening', lv)) {
      const pts = entityOutline(o, polys);
      if (pts && G.pointInPoly(p, pts)) return o.id;
    }
    const furn = L.furn ? store.list('furniture', lv) : [];
    for (const f of furn.slice().reverse()) {
      if (byId[f.lib]?.flat) continue;
      const q = G.toLocal(p, f.x, f.y, f.rot || 0);
      if (Math.abs(q.x) <= f.w / 2 + tol && Math.abs(q.y) <= f.d / 2 + tol) return f.id;
    }
    if (L.notes) for (const t of store.list('text', lv)) {
      const b = textBounds(t);
      if (p.x >= b.x0 - tol && p.x <= b.x1 + tol && p.y >= b.y0 - tol && p.y <= b.y1 + tol) return t.id;
    }
    if (L.dims) for (const d of store.list('dim', lv)) {
      const n = G.leftN(G.norm(G.sub(d.b, d.a))), off = d.off ?? 600;
      const a = { x: d.a.x + n.x * off, y: d.a.y + n.y * off }, b = { x: d.b.x + n.x * off, y: d.b.y + n.y * off };
      if (G.closestOnSeg(p, a, b).d < 8 / this.s) return d.id;
    }
    if (L.walls) {
      let best = null;
      for (const w of wallsOnLevel(store, lv)) {
        const P = polys.get(w.id);
        const c = G.closestOnSeg(p, w.a, w.b);
        const inside = P && G.pointInPoly(p, [P.aL, P.bL, P.bR, P.aR]);
        if ((inside || c.d <= w.thickness / 2 + tol) && (!best || c.d < best.d)) best = { id: w.id, d: c.d };
      }
      if (best) return best.id;
    }
    for (const f of furn.slice().reverse()) {
      if (!byId[f.lib]?.flat) continue;
      const q = G.toLocal(p, f.x, f.y, f.rot || 0);
      if (Math.abs(q.x) <= f.w / 2 && Math.abs(q.y) <= f.d / 2) return f.id;
    }
    if (L.rooms) {
      let best = null;
      for (const r of store.list('room', lv)) {
        const g = roomGeom(r);
        if (g && G.pointInPoly(p, g.inner) && (!best || g.area < best.area)) best = { id: r.id, area: g.area };
      }
      if (best) return best.id;
    }
    for (const r of store.list('ref', lv)) if (hitRef(r, p, 6 / this.s)) return r.id;
    return null;
  }

  hitHandle(sx, sy) {
    if (this.selection.size !== 1) return null;
    const e = store.get([...this.selection][0]);
    if (!e) return null;
    const polys = polysFor(store, this.level.id);
    for (const h of handlesFor(e, 1 / this.s, polys)) {
      const sp = this.toScreen(h.p);
      if (Math.hypot(sp.x - sx, sp.y - sy) <= 10) return { ...h, e };
    }
    return null;
  }

  // ---- events ----------------------------------------------------------------
  _bind() {
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointerleave', () => { this.hover = null; this.snapInfo = null; this.requestRender(); });
    c.addEventListener('dblclick', (e) => this.onDbl(e));
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._wantFit = false;
      const r = c.getBoundingClientRect();
      const k = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0016));
      this.zoomAt(e.clientX - r.left, e.clientY - r.top, k);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('keyup', (e) => { if (e.code === 'Space') { this.space = false; this.updateCursor(); } });
    this.numEl.addEventListener('keydown', (e) => this.onNumKey(e));
    this.textEl.addEventListener('keydown', (e) => this.onTextKey(e));
    this.textEl.addEventListener('blur', () => this.commitText());
  }

  pos(e) { const r = this.canvas.getBoundingClientRect(); return { sx: e.clientX - r.left, sy: e.clientY - r.top }; }

  onDown(e) {
    this._wantFit = false;
    this.canvas.focus?.();
    const { sx, sy } = this.pos(e);
    const raw = this.toWorld(sx, sy);
    this.mouse = { sx, sy, p: raw };
    if (this.textEl.style.display === 'block') this.commitText();
    if (e.button === 1 || e.button === 2 || (e.button === 0 && this.space)) {
      this.drag = { type: 'pan', sx, sy, ox: this.view.ox, oy: this.view.oy, moved: false, button: e.button };
      this.canvas.setPointerCapture(e.pointerId); this.updateCursor();
      return;
    }
    if (e.button !== 0) return;
    this.canvas.setPointerCapture(e.pointerId);
    this.closeNum();
    const t = this.tool;
    if (t === 'select') return this.downSelect(e, sx, sy, raw);
    if (t === 'wall') return this.downWall(e, raw);
    if (t === 'door' || t === 'window') return this.downOpening(raw);
    if (t === 'room') return this.downRoom(raw);
    if (t === 'furniture') return this.downFurniture(e, raw);
    if (t === 'dim') return this.downDim(e, raw);
    if (t === 'calibrate') return this.downCal(e, raw);
    if (t === 'text') return this.downText(sx, sy, raw);
  }

  onMove(e) {
    const { sx, sy } = this.pos(e);
    const raw = this.toWorld(sx, sy);
    this.mouse = { sx, sy, p: raw, shift: e.shiftKey, alt: e.altKey };
    const d = this.drag;
    if (d?.type === 'pan') {
      this.view.ox = d.ox + (sx - d.sx); this.view.oy = d.oy + (sy - d.sy);
      d.moved = d.moved || Math.hypot(sx - d.sx, sy - d.sy) > 3;
      this.requestRender(); this.emit('view'); return;
    }
    if (d) return this.dragMove(e, sx, sy, raw);
    this.emit('cursor', raw);
    if (this.tool === 'select') {
      const hh = this.hitHandle(sx, sy);
      const id = hh ? null : this.hitTest(raw);
      if (id !== this.hover) this.hover = id;
      this.canvas.style.cursor = hh ? (hh.kind === 'rot' ? 'alias' : 'pointer') : id ? 'move' : 'default';
    } else if (this.tool === 'wall' || this.tool === 'dim' || this.tool === 'calibrate') {
      this.snapInfo = this.snap(raw, { from: this.draft?.start || this.dimDraft?.b || this.dimDraft?.a, free: e.shiftKey || this.tool === 'calibrate', noGrid: this.tool === 'calibrate', alt: e.altKey });
    } else if (this.tool === 'furniture' || this.tool === 'room' || this.tool === 'text') {
      this.snapInfo = null;
    }
    this.requestRender();
  }

  onUp(e) {
    const d = this.drag;
    if (!d) return;
    try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* not captured */ }
    this.drag = null;
    this.updateCursor();
    if (d.type === 'pan') {
      if (d.button === 2 && !d.moved) this.rightClick();
      return;
    }
    if (d.type === 'marquee') {
      this.finishMarquee(d, e);
    } else if (d.type === 'handle' && !d.dirty) {
      store.cancelCheckpoint();
    } else if (d.started) {
      normalizeWalls(store, this.level.id);
      store.commit();
    } else if (d.type === 'click-select') {
      // plain click on already-selected item with shift handled on down; nothing to do
    }
    if (d.deferSelect !== undefined && !d.started) this.setSelection(d.deferSelect);
    this.requestRender();
  }

  rightClick() {
    if (this.draft || this.dimDraft || this.place) { this.draft = null; this.dimDraft = null; this.closeNum(); this.emit('hint', this.hint()); this.requestRender(); return; }
    if (this.tool !== 'select') this.setTool('select');
  }

  onDbl(e) {
    if (this.tool === 'wall') { this.draft = null; this.closeNum(); this.emit('hint', this.hint()); this.requestRender(); return; }
    if (this.tool === 'select') {
      const { sx, sy } = this.pos(e);
      const id = this.hitTest(this.toWorld(sx, sy));
      const ent = id && store.get(id);
      if (ent?.type === 'text') this.editText(ent);
      else if (ent?.type === 'room') this.emit('focus-name');
    }
  }

  // ---- select tool -----------------------------------------------------------
  downSelect(e, sx, sy, raw) {
    const hh = this.hitHandle(sx, sy);
    if (hh) {
      store.checkpoint();
      this.drag = { type: 'handle', h: hh, e: hh.e, started: true };
      return;
    }
    const id = this.hitTest(raw);
    if (id) {
      if (e.shiftKey) {
        const s = new Set(this.selection);
        s.has(id) ? s.delete(id) : s.add(id);
        this.setSelection(s);
        return;
      }
      const wasSel = this.selection.has(id);
      if (!wasSel) this.setSelection([id]);
      this.beginMove(raw, id, wasSel && this.selection.size > 1 ? [id] : undefined);
    } else {
      if (!e.shiftKey) this.setSelection([]);
      this.drag = { type: 'marquee', sx, sy, x: sx, y: sy };
    }
  }

  beginMove(raw, hitId, deferSelect) {
    const ids = [...this.selection];
    const lv = this.level.id;
    const items = ids.map((i) => store.get(i)).filter(Boolean);
    // single opening: slide along walls
    if (items.length === 1 && items[0].type === 'opening') {
      this.drag = { type: 'opening', e: items[0], started: false, sp: { ...this.mouse } };
      return;
    }
    const nodeSet = new Set();
    for (const it of items) if (it.type === 'wall') { nodeSet.add(nodeKey(it.a)); nodeSet.add(nodeKey(it.b)); }
    const moves = [];
    for (const w of wallsOnLevel(store, lv)) {
      const mA = nodeSet.has(nodeKey(w.a)), mB = nodeSet.has(nodeKey(w.b));
      if (mA || mB) moves.push({ e: w, a: { ...w.a }, b: { ...w.b }, mA, mB });
    }
    for (const it of items) {
      if (it.type === 'furniture' || it.type === 'text' || it.type === 'ref') moves.push({ e: it, x: it.x, y: it.y });
      else if (it.type === 'dim') moves.push({ e: it, a: { ...it.a }, b: { ...it.b }, mA: true, mB: true });
    }
    if (!moves.length) { this.drag = null; return; }
    const hitE = store.get(hitId);
    const ref = hitE?.type === 'furniture' ? { x: hitE.x, y: hitE.y } : { ...raw };
    this.drag = { type: 'move', moves, start: raw, ref, started: false, sp: { ...this.mouse }, exclude: new Set(moves.filter((m) => m.e.type === 'wall').map((m) => m.e.id)), deferSelect };
  }

  dragMove(e, sx, sy, raw) {
    const d = this.drag;
    if (d.type === 'marquee') { d.x = sx; d.y = sy; this.requestRender(); return; }
    if (!d.started && d.type !== 'handle') {
      if (Math.hypot(sx - d.sp.sx, sy - d.sp.sy) < 4) return;
      store.checkpoint(); d.started = true;
      if (d.deferSelect !== undefined) d.deferSelect = undefined;
    }
    if (d.type === 'move') {
      const target = { x: d.ref.x + (raw.x - d.start.x), y: d.ref.y + (raw.y - d.start.y) };
      const s = this.snap(target, { exclude: d.exclude, alt: e.altKey, noEdge: true, free: true });
      this.snapInfo = s.kind && s.kind !== 'grid' ? s : null;
      let dx = s.p.x - d.ref.x, dy = s.p.y - d.ref.y;
      if (e.shiftKey && !e.altKey) { if (Math.abs(raw.x - d.start.x) > Math.abs(raw.y - d.start.y)) dy = 0; else dx = 0; }
      for (const m of d.moves) {
        const it = m.e;
        if (it.type === 'wall' || it.type === 'dim') {
          if (m.mA) it.a = { x: m.a.x + dx, y: m.a.y + dy };
          if (m.mB) it.b = { x: m.b.x + dx, y: m.b.y + dy };
        } else { it.x = m.x + dx; it.y = m.y + dy; }
      }
      store.changed();
    } else if (d.type === 'opening') {
      const o = d.e;
      const pl = this.openingPlacement(raw, o.width, {});
      if (pl) { o.wallId = pl.wallId; o.pos = pl.pos; o.side = pl.side; store.changed(); }
    } else if (d.type === 'handle') this.dragHandle(d, e, raw);
    this.emit('selection-props');
  }

  dragHandle(d, e, raw) {
    const it = d.e, k = d.h.kind;
    if (it.type === 'wall') {
      const other = k === 'a' ? it.b : it.a;
      const s = this.snap(raw, { from: other, exclude: new Set([it.id]), free: e.shiftKey, alt: e.altKey });
      this.snapInfo = s;
      const old = k === 'a' ? { ...it.a } : { ...it.b };
      const key = nodeKey(old);
      for (const w of wallsOnLevel(store, this.level.id)) {
        if (nodeKey(w.a) === key) w.a = { ...s.p };
        if (nodeKey(w.b) === key) w.b = { ...s.p };
      }
      d.dirty = true;
    } else if (it.type === 'furniture') {
      if (k === 'rot') {
        let ang = Math.atan2(raw.y - it.y, raw.x - it.x) + Math.PI / 2;
        if (!e.altKey) ang = Math.round(ang / G.rad(15)) * G.rad(15);
        it.rot = G.normAngle(ang);
      } else {
        const q = G.toLocal(raw, it.x, it.y, it.rot || 0);
        const step = 25;
        if (k === 'rw') {
          const nw = Math.max(100, Math.round((q.x + it.w / 2) / step) * step);
          const sh = G.rotate({ x: (nw - it.w) / 2, y: 0 }, it.rot || 0);
          it.x += sh.x; it.y += sh.y; it.w = nw;
        } else {
          const nd = Math.max(100, Math.round((q.y + it.d / 2) / step) * step);
          const sh = G.rotate({ x: 0, y: (nd - it.d) / 2 }, it.rot || 0);
          it.x += sh.x; it.y += sh.y; it.d = nd;
        }
      }
    } else if (it.type === 'dim') {
      const dv = G.norm(G.sub(it.b, it.a)), n = G.leftN(dv);
      if (k === 'off') it.off = Math.round(G.dot(G.sub(raw, G.lerp(it.a, it.b, 0.5)), n) / 25) * 25;
      else { const s = this.snap(raw, { alt: e.altKey }); it[k] = s.p; }
    }
    d.dirty = true;
    store.changed();
    this.emit('selection-props');
  }

  finishMarquee(d, e) {
    const x0 = Math.min(d.sx, d.x), x1 = Math.max(d.sx, d.x), y0 = Math.min(d.sy, d.y), y1 = Math.max(d.sy, d.y);
    if (x1 - x0 < 4 && y1 - y0 < 4) return;
    const A = this.toWorld(x0, y0), B = this.toWorld(x1, y1);
    const crossing = d.x < d.sx; // right-to-left drag
    const polys = polysFor(store, this.level.id);
    const hits = [];
    for (const en of store.list(null, this.level.id)) {
      if (en.type === 'ref') continue;
      const pts = entityOutline(en, polys);
      if (!pts) continue;
      const bb = G.bbox(pts);
      const inside = bb.x0 >= A.x && bb.x1 <= B.x && bb.y0 >= A.y && bb.y1 <= B.y;
      const touch = bb.x1 >= A.x && bb.x0 <= B.x && bb.y1 >= A.y && bb.y0 <= B.y;
      if (inside || (crossing && touch && en.type !== 'room')) hits.push(en.id);
    }
    const s = new Set(e.shiftKey ? this.selection : []);
    hits.forEach((h) => s.add(h));
    this.setSelection(s);
  }

  // ---- wall tool -------------------------------------------------------------
  wallProps(a, b) {
    const kind = this.opts.wallKind;
    return {
      type: 'wall', discipline: 'arch', a, b, kind,
      thickness: this.opts.thickness || (kind === 'exterior' ? DEFAULTS.extThickness : DEFAULTS.intThickness),
      height: this.level.height, structural: false,
    };
  }

  downWall(e, raw) {
    const s = this.snap(raw, { from: this.draft?.start, free: e.shiftKey, alt: e.altKey });
    if (!this.draft) { this.draft = { start: s.p, first: s.p }; this.emit('hint', this.hint()); this.requestRender(); return; }
    this.commitWall(s.p);
  }

  commitWall(end) {
    const st = this.draft.start;
    if (G.dist(st, end) < 50) return;
    store.checkpoint();
    store.add('wall', this.wallProps({ ...st }, { ...end }));
    normalizeWalls(store, this.level.id);
    store.commit();
    const closed = G.dist(end, this.draft.first) < 2;
    this.draft = closed ? null : { start: { ...end }, first: this.draft.first };
    this.emit('hint', this.hint());
    this.requestRender();
  }

  // numeric entry while drawing
  openNum(ch) {
    const el = this.numEl;
    el.style.display = 'block';
    el.value = ch;
    const sp = this.toScreen(this.draft.start);
    el.style.left = Math.min(this.w - 160, Math.max(10, this.mouse.sx + 18)) + 'px';
    el.style.top = Math.min(this.h - 50, Math.max(10, this.mouse.sy + 18)) + 'px';
    el.focus();
    this._numDir = this.snapInfo ? G.norm(G.sub(this.snapInfo.p, this.draft.start)) : { x: 1, y: 0 };
    if (!isFinite(this._numDir.x) || (this._numDir.x === 0 && this._numDir.y === 0)) this._numDir = { x: 1, y: 0 };
    this.numLive();
  }
  numLive() {
    const v = parseLen(this.numEl.value);
    this.numPreview = v && v > 0 ? G.add(this.draft.start, G.mul(this._numDir, v)) : null;
    this.requestRender();
  }
  closeNum() { this.numMode = null; this.numEl.placeholder = 'length'; this.numEl.style.width = ''; this.numEl.style.display = 'none'; this.numEl.value = ''; this.numPreview = null; if (document.activeElement === this.numEl) this.canvas.focus?.(); }
  onNumKey(e) {
    if (this.numMode === 'cal') {
      if (e.key === 'Enter') { const v = parseLen(this.numEl.value); e.preventDefault(); if (v && v > 0) { this.finishCal(v); this.closeNum(); } }
      else if (e.key === 'Escape') { this.closeNum(); this.cal = null; this.setTool('select'); e.preventDefault(); }
      e.stopPropagation(); return;
    }
    if (e.key === 'Enter') {
      const v = parseLen(this.numEl.value);
      if (v && v > 0 && this.draft) this.commitWall(G.add(this.draft.start, G.mul(this._numDir, v)));
      this.closeNum(); e.preventDefault();
    } else if (e.key === 'Escape') { this.closeNum(); e.preventDefault(); e.stopPropagation(); }
    else setTimeout(() => this.numLive(), 0);
    e.stopPropagation();
  }

  // ---- door / window ---------------------------------------------------------
  openingProps(kind) {
    const o = this.opts;
    return kind === 'door'
      ? { kind, style: o.doorStyle, width: o.doorWidth, height: o.doorHeight, sill: 0 }
      : { kind, style: o.windowStyle, width: o.windowWidth, height: o.windowHeight, sill: o.windowSill };
  }
  openingGhost() {
    const props = this.openingProps(this.tool);
    const pl = this.openingPlacement(this.mouse.p, props.width);
    return pl ? { ...props, ...pl, hinge: this.opts.hinge, type: 'opening', level: this.level.id } : null;
  }
  downOpening(raw) {
    const props = this.openingProps(this.tool);
    const pl = this.openingPlacement(raw, props.width);
    if (!pl) return;
    store.checkpoint();
    const o = store.add('opening', { discipline: 'arch', ...props, ...pl, hinge: this.opts.hinge });
    store.commit();
    this.requestRender();
    return o;
  }

  // ---- room ------------------------------------------------------------------
  downRoom(raw) {
    const f = faceAt(store, this.level.id, raw);
    if (!f) return;
    const seed = labelPoint(f.inner);
    const existing = store.list('room', this.level.id).find((r) => G.pointInPoly(r.seed, f.pts));
    if (existing) { this.setSelection([existing.id]); this.setTool('select'); this.setSelection([existing.id]); return; }
    store.checkpoint();
    const r = store.add('room', { discipline: 'arch', seed, name: this.opts.roomName, floor: this.opts.roomFloor, showArea: true });
    store.commit();
    this.emit('room-added', r);
  }
  autoRooms() {
    const lv = this.level.id;
    const faces = facesFor(store, lv);
    const rooms = store.list('room', lv);
    let n = 0;
    store.checkpoint();
    for (const f of faces) {
      if (rooms.some((r) => G.pointInPoly(r.seed, f.pts))) continue;
      store.add('room', { discipline: 'arch', seed: labelPoint(f.inner), name: 'Room', floor: 'wood', showArea: true });
      n++;
    }
    if (n) store.commit(); else store.cancelCheckpoint();
    return n;
  }

  // ---- furniture -------------------------------------------------------------
  furnGhost() {
    if (!this.place) return null;
    const item = byId[this.place.lib];
    const pl = this.furnPlacement(this.mouse.p, item, item.w, item.d, this.place.rot);
    return { lib: item.id, x: pl.x, y: pl.y, rot: pl.rot, w: item.w, d: item.d };
  }
  downFurniture(e, raw) {
    if (!this.place) return;
    const g = this.furnGhost();
    const item = byId[this.place.lib];
    store.checkpoint();
    store.add('furniture', { discipline: 'furn', lib: item.id, x: g.x, y: g.y, rot: g.rot, w: item.w, d: item.d, h: item.h });
    store.commit();
  }

  // ---- dimension -------------------------------------------------------------
  downDim(e, raw) {
    const s = this.snap(raw, { from: this.dimDraft?.a, free: e.shiftKey, alt: e.altKey, noEdge: false });
    if (!this.dimDraft) this.dimDraft = { a: s.p };
    else if (!this.dimDraft.b) { if (G.dist(this.dimDraft.a, s.p) > 20) this.dimDraft.b = s.p; }
    else {
      const d = G.norm(G.sub(this.dimDraft.b, this.dimDraft.a)), n = G.leftN(d);
      const off = Math.round(G.dot(G.sub(raw, G.lerp(this.dimDraft.a, this.dimDraft.b, 0.5)), n) / 25) * 25;
      store.checkpoint();
      store.add('dim', { discipline: 'annot', a: this.dimDraft.a, b: this.dimDraft.b, off: off || 600 });
      store.commit();
      this.dimDraft = null;
    }
    this.emit('hint', this.hint());
    this.requestRender();
  }

  // ---- text ------------------------------------------------------------------
  downText(sx, sy, raw) { this.openText({ x: raw.x, y: raw.y, text: '', size: 160, _new: true }, sx, sy); }
  editText(t) { const sp = this.toScreen({ x: t.x, y: t.y - (t.size || 160) }); this.openText(t, sp.x, sp.y); }
  openText(t, sx, sy) {
    this._textTarget = t;
    const el = this.textEl;
    el.style.display = 'block';
    el.style.left = sx + 'px'; el.style.top = sy + 'px';
    el.value = t.text || '';
    el.focus();
  }
  onTextKey(e) {
    if (e.key === 'Escape') { this.textEl.value = this._textTarget?._new ? '' : this._textTarget?.text; this.textEl.blur(); }
    else if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); this.textEl.blur(); }
    e.stopPropagation();
  }
  commitText() {
    const t = this._textTarget;
    if (!t || this.textEl.style.display !== 'block') return;
    this.textEl.style.display = 'none';
    this._textTarget = null;
    const text = this.textEl.value.trim();
    if (t._new) {
      if (!text) return;
      store.checkpoint();
      store.add('text', { discipline: 'annot', x: t.x, y: t.y, text, size: t.size });
      store.commit();
    } else if (text !== t.text) {
      store.checkpoint();
      if (text) t.text = text; else store.remove(t.id);
      store.commit();
    }
    this.canvas.focus?.();
  }

  // ---- calibrate / align reference drawings -----------------------------------
  startCalibrate(mode, refId) {
    this.setTool('calibrate');
    this.cal = { mode, ref: refId, a: null, b: null };
    this.emit('hint', this.hint());
  }
  downCal(e, raw) {
    if (!this.cal || this.cal.b) return;
    const s = this.snap(raw, { alt: e.altKey, free: true, noGrid: true });
    if (!this.cal.a) { this.cal.a = s.p; this.emit('hint', this.hint()); this.requestRender(); return; }
    if (G.dist(this.cal.a, s.p) < 5) return;
    this.cal.b = s.p;
    const ref = store.get(this.cal.ref);
    if (!ref) { this.setTool('select'); return; }
    if (this.cal.mode === 'align') {
      const ang = Math.atan2(s.p.y - this.cal.a.y, s.p.x - this.cal.a.x);
      const target = Math.round(ang / (Math.PI / 2)) * (Math.PI / 2);
      const pivot = this.cal.a;
      store.act(() => rotateRefAbout(ref, pivot, target - ang));
      this.setTool('select'); this.emit('toast', 'Drawing rotated to level.');
      return;
    }
    const el = this.numEl;
    this.numMode = 'cal';
    el.placeholder = "real distance, e.g. 12'6";
    el.style.display = 'block'; el.value = '';
    el.style.left = Math.min(this.w - 190, Math.max(10, this.mouse.sx + 18)) + 'px';
    el.style.top = Math.min(this.h - 50, Math.max(10, this.mouse.sy + 18)) + 'px';
    el.style.width = '170px';
    el.focus();
    this.emit('toast', `Measured ${fmtLen(G.dist(this.cal.a, this.cal.b))} on the drawing. Type the real distance and press Enter.`);
  }
  finishCal(real) {
    const { a, b, ref: id } = this.cal;
    const ref = store.get(id);
    const factor = real / G.dist(a, b);
    if (ref && isFinite(factor) && factor > 0) store.act(() => scaleRefAbout(ref, a, factor));
    this.cal = null;
    this.setTool('select');
    this.fit();
    this.emit('toast', 'Scale set. Trace over the drawing with the wall tool.');
  }

  // ---- commands --------------------------------------------------------------
  deleteSelection() {
    if (!this.selection.size) return;
    store.checkpoint();
    for (const id of this.selection) store.remove(id);
    this.selection.clear();
    store.commit();
  }
  copy() {
    const items = this.selected();
    if (!items.length) return;
    const ids = new Set(items.map((i) => i.id));
    const all = [...items];
    for (const w of items.filter((i) => i.type === 'wall')) for (const o of store.openingsOf(w.id)) if (!ids.has(o.id)) all.push(o);
    clipboard = JSON.parse(JSON.stringify(all));
    this._pasteN = 0;
  }
  paste() {
    if (!clipboard?.length) return;
    this._pasteN = (this._pasteN || 0) + 1;
    const off = 450 * this._pasteN;
    const map = {}, out = [];
    store.checkpoint();
    for (const src of clipboard.filter((c) => c.type !== 'opening')) {
      const { id: _id, ...rest } = JSON.parse(JSON.stringify(src));
      const ne = store.add(rest.type, rest);
      ne.level = this.level.id;
      if (ne.a) ne.a = { x: ne.a.x + off, y: ne.a.y + off };
      if (ne.b) ne.b = { x: ne.b.x + off, y: ne.b.y + off };
      if (ne.type === 'furniture' || ne.type === 'text') { ne.x += off; ne.y += off; }
      if (ne.type === 'room') ne.seed = { x: ne.seed.x + off, y: ne.seed.y + off };
      map[src.id] = ne.id; out.push(ne.id);
    }
    for (const src of clipboard.filter((c) => c.type === 'opening')) {
      if (!map[src.wallId]) continue;
      const { id: _id, ...rest } = JSON.parse(JSON.stringify(src));
      const ne = store.add('opening', rest);
      ne.wallId = map[src.wallId]; ne.level = this.level.id;
      out.push(ne.id);
    }
    normalizeWalls(store, this.level.id);
    store.commit();
    this.setSelection(out.filter((i) => store.get(i)));
  }
  duplicate() { this.copy(); this._pasteN = 0; this.paste(); }
  nudge(dx, dy) {
    const items = this.selected();
    if (!items.length) return false;
    store.checkpoint();
    const nodes = new Set();
    for (const it of items) if (it.type === 'wall') { nodes.add(nodeKey(it.a)); nodes.add(nodeKey(it.b)); }
    for (const w of wallsOnLevel(store, this.level.id)) {
      if (nodes.has(nodeKey(w.a))) w.a = { x: w.a.x + dx, y: w.a.y + dy };
      if (nodes.has(nodeKey(w.b))) w.b = { x: w.b.x + dx, y: w.b.y + dy };
    }
    for (const it of items) {
      if (it.type === 'furniture' || it.type === 'text') { it.x += dx; it.y += dy; }
      if (it.type === 'dim') { it.a = G.add(it.a, { x: dx, y: dy }); it.b = G.add(it.b, { x: dx, y: dy }); }
    }
    store.commit();
    return true;
  }
  rotateSelection(delta = Math.PI / 2) {
    if (this.tool === 'furniture' && this.place) { this.place.rot = G.normAngle(this.place.rot + delta); this.requestRender(); return; }
    const fs = this.selected().filter((s) => s.type === 'furniture');
    if (!fs.length) return;
    store.checkpoint();
    fs.forEach((f) => (f.rot = G.normAngle((f.rot || 0) + delta)));
    store.commit();
  }

  onKey(e) {
    this._wantFit = false;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); }
      else if (k === 'y') { e.preventDefault(); store.redo(); }
      else if (k === 'c') { this.copy(); }
      else if (k === 'v') { e.preventDefault(); this.paste(); }
      else if (k === 'd') { e.preventDefault(); this.duplicate(); }
      else if (k === 'a') { e.preventDefault(); this.setTool('select'); this.setSelection(store.list(null, this.level.id).filter((x) => x.type !== 'room' && x.type !== 'ref').map((x) => x.id)); }
      return;
    }
    if (e.code === 'Space') { this.space = true; this.updateCursor(); e.preventDefault(); return; }
    // numeric entry while drawing a wall
    if (this.tool === 'wall' && this.draft && /^[0-9.'"\-]$/.test(e.key)) { e.preventDefault(); this.openNum(e.key); return; }
    const key = e.key.toLowerCase();
    if (e.key === 'Escape') {
      if (this.draft || this.dimDraft) { this.draft = null; this.dimDraft = null; this.emit('hint', this.hint()); }
      else if (this.place) this.setTool('select');
      else if (this.selection.size) this.setSelection([]);
      else if (this.tool !== 'select') this.setTool('select');
      this.requestRender(); return;
    }
    if (e.key === 'Delete' || e.key === 'Backspace') { this.deleteSelection(); e.preventDefault(); return; }
    if (e.key.startsWith('Arrow')) {
      const step = e.shiftKey ? FT : units.system === 'imperial' ? IN : 25;
      const v = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!this.nudge(v[0], v[1])) { this.view.ox -= v[0] * this.s * 4; this.view.oy -= v[1] * this.s * 4; this.requestRender(); }
      e.preventDefault(); return;
    }
    const tools = { v: 'select', w: 'wall', d: 'door', n: 'window', a: 'room', m: 'dim', t: 'text' };
    if (tools[key]) { this.setTool(tools[key]); return; }
    if (key === 'r') { this.rotateSelection(e.shiftKey ? -Math.PI / 2 : Math.PI / 2); return; }
    if (key === 'f' || key === 'h') {
      const ops = this.selected().filter((s) => s.type === 'opening' && s.kind === 'door');
      if (ops.length && this.tool === 'select') {
        store.checkpoint();
        ops.forEach((o) => { if (key === 'f') o.side = -(o.side || 1); else o.hinge = (o.hinge || 'a') === 'a' ? 'b' : 'a'; });
        store.commit();
      } else if (key === 'f') this.opts.flip = !this.opts.flip; else this.opts.hinge = this.opts.hinge === 'a' ? 'b' : 'a';
      this.requestRender(); return;
    }
    if (key === '0' || key === 'home') { this.fit(); return; }
    if (e.key === '+' || e.key === '=') this.zoomAt(this.w / 2, this.h / 2, 1.25);
    if (e.key === '-') this.zoomAt(this.w / 2, this.h / 2, 0.8);
  }

  // ---- rendering ---------------------------------------------------------------
  render() {
    const { ctx, dpr, w, h } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    if (this.gridOn) this.drawGrid();
    const { s, ox, oy } = this.view;
    ctx.save();
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * ox, dpr * oy);
    const ghost = this.buildGhost();
    drawPlan(ctx, { levelId: this.level.id, u: 1 / s, screen: true, selection: this.selection, hover: this.tool === 'select' ? this.hover : null, layers: this.layers, ghost });
    // alignment guides
    if (this.guides.length) {
      ctx.save(); ctx.strokeStyle = 'rgba(47,109,246,.55)'; ctx.lineWidth = 1 / s; ctx.setLineDash([4 / s, 4 / s]);
      for (const g of this.guides) { ctx.beginPath(); ctx.moveTo(g.from.x, g.from.y); ctx.lineTo(g.to.x, g.to.y); ctx.stroke(); }
      ctx.restore();
    }
    ctx.restore();
    this.drawOverlay();
  }

  buildGhost() {
    const t = this.tool;
    const mp = this.mouse.p;
    const g = {};
    if (t === 'wall') {
      const end = this.numPreview || this.snapInfo?.p;
      if (this.draft && end && G.dist(this.draft.start, end) > 1) g.walls = [this.wallProps(this.draft.start, end)];
      else if (!this.draft && this.snapInfo) g.walls = [];
    } else if (t === 'door' || t === 'window') {
      const o = this.openingGhost();
      if (o) g.openings = [o];
    } else if (t === 'room') {
      const f = faceAt(store, this.level.id, mp);
      if (f) g.room = f.inner;
    } else if (t === 'furniture') {
      const f = this.furnGhost(); if (f) g.furniture = [f];
    } else if (t === 'calibrate' && this.cal?.a && this.snapInfo) {
      g.dims = [{ a: this.cal.a, b: this.snapInfo.p, off: 0 }];
    } else if (t === 'dim' && this.dimDraft) {
      const d = this.dimDraft;
      if (!d.b && this.snapInfo) g.dims = [{ a: d.a, b: this.snapInfo.p, off: 0 }];
      else if (d.b) {
        const n = G.leftN(G.norm(G.sub(d.b, d.a)));
        g.dims = [{ a: d.a, b: d.b, off: Math.round(G.dot(G.sub(mp, G.lerp(d.a, d.b, 0.5)), n) / 25) * 25 }];
      }
    }
    return g;
  }

  drawGrid() {
    const { ctx, w, h } = this;
    const step = this.gridStep();
    const major = step * (units.system === 'imperial' && step >= FT ? 5 : 5);
    const a = this.toWorld(0, 0), b = this.toWorld(w, h);
    const drawLines = (st, color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      for (let x = Math.floor(a.x / st) * st; x <= b.x; x += st) { const sx = Math.round(x * this.s + this.view.ox) + 0.5; ctx.moveTo(sx, 0); ctx.lineTo(sx, h); }
      for (let y = Math.floor(a.y / st) * st; y <= b.y; y += st) { const sy = Math.round(y * this.s + this.view.oy) + 0.5; ctx.moveTo(0, sy); ctx.lineTo(w, sy); }
      ctx.stroke();
    };
    drawLines(step, '#eef0f3', 1);
    drawLines(major, '#dde1e7', 1);
    // origin
    const o = this.toScreen({ x: 0, y: 0 });
    ctx.strokeStyle = 'rgba(47,109,246,.35)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(o.x - 8, o.y + 0.5); ctx.lineTo(o.x + 8, o.y + 0.5); ctx.moveTo(o.x + 0.5, o.y - 8); ctx.lineTo(o.x + 0.5, o.y + 8); ctx.stroke();
  }

  pill(text, x, y, color = THEME.accent) {
    const { ctx } = this;
    ctx.font = `600 11.5px ${FONT}`;
    const tw = ctx.measureText(text).width + 14;
    x = G.clamp(x, tw / 2 + 4, this.w - tw / 2 - 4); y = G.clamp(y, 14, this.h - 14);
    ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect(x - tw / 2, y - 11, tw, 22, 11); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
  }

  drawOverlay() {
    const { ctx } = this;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const d = this.drag;
    if (d?.type === 'marquee') {
      ctx.fillStyle = d.x < d.sx ? 'rgba(47,109,246,.07)' : 'rgba(47,109,246,.10)';
      ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1;
      ctx.setLineDash(d.x < d.sx ? [5, 4] : []);
      ctx.fillRect(d.sx, d.sy, d.x - d.sx, d.y - d.sy); ctx.strokeRect(d.sx + 0.5, d.sy + 0.5, d.x - d.sx, d.y - d.sy);
      ctx.setLineDash([]);
    }
    const si = this.snapInfo;
    if ((this.tool === 'wall' || this.tool === 'dim' || this.tool === 'calibrate') && si) {
      const sp = this.toScreen(si.p);
      ctx.strokeStyle = THEME.accent; ctx.fillStyle = '#fff'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (si.kind === 'end') ctx.rect(sp.x - 5, sp.y - 5, 10, 10);
      else if (si.kind === 'mid') { ctx.moveTo(sp.x, sp.y - 6); ctx.lineTo(sp.x + 6, sp.y + 5); ctx.lineTo(sp.x - 6, sp.y + 5); ctx.closePath(); }
      else ctx.arc(sp.x, sp.y, si.kind === 'grid' ? 3 : 5, 0, Math.PI * 2);
      ctx.fill(); ctx.stroke();
      if (si.label && si.kind !== 'grid') this.pill(si.label, sp.x + 14 + 30, sp.y - 20, 'rgba(34,38,44,.85)');
    }
    // live wall HUD
    if (this.tool === 'wall' && this.draft) {
      const end = this.numPreview || this.snapInfo?.p;
      if (end) {
        const a = this.toScreen(this.draft.start), b = this.toScreen(end);
        const L = G.dist(this.draft.start, end);
        const ang = G.deg(Math.atan2(-(end.y - this.draft.start.y), end.x - this.draft.start.x));
        const A = ((Math.round(ang * 10) / 10) % 360 + 360) % 360;
        this.pill(`${fmtLen(L)}   ${A}°`, (a.x + b.x) / 2, (a.y + b.y) / 2 - 24);
      }
    }
    if (this.tool === 'dim' && this.dimDraft && !this.dimDraft.b && this.snapInfo) {
      const a = this.toScreen(this.dimDraft.a), b = this.toScreen(this.snapInfo.p);
      this.pill(fmtLen(G.dist(this.dimDraft.a, this.snapInfo.p)), (a.x + b.x) / 2, (a.y + b.y) / 2 - 22);
    }
  }
}
