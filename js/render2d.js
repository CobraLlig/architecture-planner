// Plan renderer. Draws into a real canvas (screen) or an SvgCtx (print/export) — same code, same look.
// All coordinates are world millimetres; `u` is the size of one "line unit" in world mm
// (1 screen pixel on screen, 0.2 mm of paper in print) so line weights stay constant at any zoom/scale.

import { store } from './store.js';
import { polysFor, facesFor, wallSegments, wallInfo, faceAt, wallsOnLevel } from './walls.js';
import { byId, drawSymbol, FLOORS } from './library.js';
import { fmtLen, fmtArea } from './units.js';
import * as G from './geom.js';
import { drawRef, refCorners } from './refs.js';

export const THEME = {
  ink: '#22262c',
  wallExt: '#2b2f35',
  wallInt: '#444b54',
  accent: '#2f6df6',
  warn: '#e5484d',
  dim: '#0b6e99',
  text: '#3b4048',
  underlay: '#cdd2d9',
  paper: '#ffffff',
};
const FONT = 'Inter, "Segoe UI", Arial, Helvetica, sans-serif';

export function roomGeom(room) {
  const f = faceAt(store, room.level, room.seed);
  if (!f) return null;
  return { face: f, inner: f.inner, area: G.polyArea(f.inner), c: labelPoint(f.inner) };
}

/** A good spot for a label: centroid, or the middle of the longest horizontal chord if the centroid is outside. */
export function labelPoint(poly) {
  const c = G.polyCentroid(poly);
  if (G.pointInPoly(c, poly)) return c;
  const bb = G.bbox(poly);
  const y = c.y >= bb.y0 && c.y <= bb.y1 ? c.y : bb.cy;
  const xs = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    if ((p.y > y) !== (q.y > y)) xs.push(p.x + ((y - p.y) * (q.x - p.x)) / (q.y - p.y));
  }
  xs.sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i + 1 < xs.length; i += 2) if (!best || xs[i + 1] - xs[i] > best[1] - best[0]) best = [xs[i], xs[i + 1]];
  return best ? { x: (best[0] + best[1]) / 2, y } : c;
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}

const isFullHeight = (s, H) => s.z0 <= 0 && s.z1 >= H - 1;

// ---------------------------------------------------------------------------
export function drawPlan(ctx, o) {
  const { levelId, u, screen = true, selection = new Set(), hover = null, layers = {}, ghost = null } = o;
  const L = { walls: true, openings: true, rooms: true, furn: true, dims: true, notes: true, refs: true, ...layers };
  const level = store.project.levels.find((l) => l.id === levelId);
  const polys = polysFor(store, levelId);
  const walls = wallsOnLevel(store, levelId);
  const ow = screen ? 1.1 : 1.3;      // wall outline half-weight in line units
  ctx.lineJoin = 'miter';

  if (screen && o.underlay !== false) drawUnderlay(ctx, o, level);
  if (screen && L.refs !== false) for (const r of store.list('ref', levelId)) drawRef(ctx, u, r);

  // rooms --------------------------------------------------------------
  if (L.rooms) {
    for (const r of store.list('room', levelId)) {
      const g = roomGeom(r);
      if (!g) continue;
      if (screen || o.roomFills) {
        polyPath(ctx, g.inner);
        ctx.fillStyle = (FLOORS[r.floor] || FLOORS.none).tint;
        ctx.fill();
      }
    }
  }

  // walls --------------------------------------------------------------
  if (L.walls) {
    const segsByWall = new Map();
    for (const w of walls) {
      const P = polys.get(w.id);
      if (!P) continue;
      const H = w.height || level.height;
      const ops = store.openingsOf(w.id).filter((x) => L.openings);
      segsByWall.set(w.id, wallSegments(w, P, ops, level.height).filter((s) => isFullHeight(s, H)));
    }
    ctx.strokeStyle = screen ? THEME.ink : '#000';
    ctx.lineWidth = ow * 2 * u;
    for (const segs of segsByWall.values()) for (const s of segs) { polyPath(ctx, s.poly); ctx.stroke(); }
    for (const w of walls) {
      const segs = segsByWall.get(w.id);
      if (!segs) continue;
      ctx.fillStyle = screen ? (w.kind === 'exterior' ? THEME.wallExt : THEME.wallInt) : (w.kind === 'exterior' ? '#111' : '#2a2a2a');
      for (const s of segs) { polyPath(ctx, s.poly); ctx.fill(); }
    }
    // thin seam-closing stroke in fill colour to avoid hairline gaps on screen
    if (screen) {
      ctx.lineWidth = 0.6 * u;
      for (const w of walls) {
        ctx.strokeStyle = w.kind === 'exterior' ? THEME.wallExt : THEME.wallInt;
        for (const s of segsByWall.get(w.id) || []) { polyPath(ctx, s.poly); ctx.stroke(); }
      }
    }
  }

  // openings -----------------------------------------------------------
  if (L.openings) {
    for (const op of store.list('opening', levelId)) {
      const w = store.get(op.wallId);
      const P = w && polys.get(w.id);
      if (w && P) drawOpening(ctx, u, op, w, P, screen);
    }
  }

  // furniture ----------------------------------------------------------
  if (L.furn) {
    const items = store.list('furniture', levelId).sort((a, b) => (byId[b.lib]?.flat ? 1 : 0) - (byId[a.lib]?.flat ? 1 : 0));
    for (const f of items) drawFurn(ctx, u, f, screen);
  }

  // room labels --------------------------------------------------------
  if (L.rooms) {
    for (const r of store.list('room', levelId)) {
      const g = roomGeom(r);
      if (!g) {
        if (screen) {
          ctx.save(); ctx.strokeStyle = THEME.warn; ctx.lineWidth = 1.5 * u; ctx.setLineDash([4 * u, 3 * u]);
          ctx.beginPath(); ctx.arc(r.seed.x, r.seed.y, 9 * u, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          ctx.save(); ctx.fillStyle = THEME.warn; ctx.font = `${11 * u}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(`${r.name} (not enclosed)`, r.seed.x, r.seed.y + 20 * u); ctx.restore();
        }
        continue;
      }
      ctx.save();
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillStyle = THEME.text;
      const big = (screen ? 12.5 : 14) * u, small = (screen ? 10.5 : 10) * u;
      const showArea = r.showArea !== false;
      ctx.font = `600 ${big}px ${FONT}`;
      ctx.fillText((r.name || 'Room').toUpperCase(), g.c.x, g.c.y - (showArea ? small * 0.7 : 0));
      if (showArea) {
        ctx.font = `${small}px ${FONT}`; ctx.fillStyle = '#6b7280';
        ctx.fillText(fmtArea(g.area), g.c.x, g.c.y + big * 0.75);
      }
      ctx.restore();
    }
  }

  // dimensions & notes -------------------------------------------------
  if (L.dims) for (const d of store.list('dim', levelId)) drawDim(ctx, u, d, screen ? THEME.dim : '#000');
  if (L.dims && o.autoDims) drawOverallDims(ctx, u, o, polys, walls);
  if (L.notes) for (const t of store.list('text', levelId)) drawText(ctx, u, t, screen);

  // ghost / preview ----------------------------------------------------
  if (ghost) drawGhost(ctx, u, ghost, polys);

  // selection overlay --------------------------------------------------
  if (screen) {
    for (const id of hover ? [hover] : []) if (!selection.has(id)) outlineEntity(ctx, u, id, polys, 0.55, 1.5);
    for (const id of selection) outlineEntity(ctx, u, id, polys, 1, 2);
    if (selection.size === 1) {
      const e = store.get([...selection][0]);
      if (e) drawHandles(ctx, u, e, polys, o.coarse);
    }
  }
}

// ---------------------------------------------------------------------------
function drawUnderlay(ctx, o, level) {
  const below = store.levelBelow(level.id);
  if (!below) return;
  const polys = polysFor(store, below.id);
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = THEME.underlay;
  for (const w of wallsOnLevel(store, below.id)) {
    const P = polys.get(w.id);
    if (P) { polyPath(ctx, [P.aL, P.bL, P.bR, P.aR]); ctx.fill(); }
  }
  ctx.restore();
}

export function doorGeom(op, w, P) {
  const c = { x: w.a.x + P.d.x * op.pos, y: w.a.y + P.d.y * op.pos };
  const half = op.width / 2;
  return { c, p1: { x: c.x - P.d.x * half, y: c.y - P.d.y * half }, p2: { x: c.x + P.d.x * half, y: c.y + P.d.y * half } };
}

function drawOpening(ctx, u, op, w, P, screen, alpha = 1) {
  const g = doorGeom(op, w, P);
  const { d, n, h } = P;
  const W = op.width;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineJoin = 'round';
  if (op.kind === 'window') {
    ctx.strokeStyle = screen ? THEME.ink : '#000';
    ctx.lineWidth = 1 * u;
    ctx.fillStyle = '#fff';
    const t = h * 0.38;
    const at = (s, k) => ({ x: g.c.x + d.x * s + n.x * k, y: g.c.y + d.y * s + n.y * k });
    polyPath(ctx, [at(-W / 2, -h), at(W / 2, -h), at(W / 2, h), at(-W / 2, h)]); ctx.fill(); ctx.stroke();
    ctx.lineWidth = 0.9 * u;
    ctx.beginPath(); ctx.moveTo(...xy(at(-W / 2, 0))); ctx.lineTo(...xy(at(W / 2, 0))); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(...xy(at(-W / 2, -t))); ctx.lineTo(...xy(at(W / 2, -t))); ctx.moveTo(...xy(at(-W / 2, t))); ctx.lineTo(...xy(at(W / 2, t))); ctx.stroke();
    if (op.style === 'casement' && W > 900) { ctx.beginPath(); ctx.moveTo(...xy(at(0, -h))); ctx.lineTo(...xy(at(0, h))); ctx.stroke(); }
  } else {
    const side = op.side || 1;
    const nn = { x: n.x * side, y: n.y * side };
    ctx.strokeStyle = screen ? THEME.ink : '#000';
    ctx.fillStyle = '#fff';
    const leaf = (hinge, dirAlong, len) => {
      // leaf drawn open at 90 degrees; hinge at `hinge`; thin arc shows the swing back to the closed position
      const th = 40;
      const open = { x: hinge.x + nn.x * len, y: hinge.y + nn.y * len };
      const closed = { x: hinge.x + dirAlong.x * len, y: hinge.y + dirAlong.y * len };
      ctx.lineWidth = 1 * u;
      polyPath(ctx, [
        hinge, open,
        { x: open.x + dirAlong.x * th, y: open.y + dirAlong.y * th },
        { x: hinge.x + dirAlong.x * th, y: hinge.y + dirAlong.y * th },
      ]);
      ctx.fill(); ctx.stroke();
      ctx.save();
      ctx.lineWidth = 0.7 * u; ctx.strokeStyle = screen ? '#7b8490' : '#444';
      const a0 = Math.atan2(closed.y - hinge.y, closed.x - hinge.x), a1 = Math.atan2(open.y - hinge.y, open.x - hinge.x);
      const diff = G.normAngle(a1 - a0);
      ctx.beginPath(); ctx.arc(hinge.x, hinge.y, len, a0, a1, diff < 0); ctx.stroke();
      ctx.restore();
    };
    if (op.style === 'slide') {
      ctx.lineWidth = 1 * u;
      const t = h * 0.42;
      const at = (s, k) => ({ x: g.c.x + d.x * s + n.x * k, y: g.c.y + d.y * s + n.y * k });
      polyPath(ctx, [at(-W / 2, -t), at(W * 0.08, -t), at(W * 0.08, -t * 0.1), at(-W / 2, -t * 0.1)]); ctx.fill(); ctx.stroke();
      polyPath(ctx, [at(-W * 0.08, t * 0.1), at(W / 2, t * 0.1), at(W / 2, t), at(-W * 0.08, t)]); ctx.fill(); ctx.stroke();
    } else if (op.style === 'open') {
      ctx.save(); ctx.lineWidth = 0.7 * u; ctx.setLineDash([3 * u, 3 * u]); ctx.strokeStyle = screen ? '#7b8490' : '#444';
      for (const p of [g.p1, g.p2]) { ctx.beginPath(); ctx.moveTo(p.x + n.x * h, p.y + n.y * h); ctx.lineTo(p.x - n.x * h, p.y - n.y * h); ctx.stroke(); }
      ctx.restore();
    } else if (op.style === 'double') {
      leaf(g.p1, d, W / 2);
      leaf(g.p2, { x: -d.x, y: -d.y }, W / 2);
    } else {
      const hingeA = (op.hinge || 'a') === 'a';
      if (hingeA) leaf(g.p1, d, W); else leaf(g.p2, { x: -d.x, y: -d.y }, W);
    }
  }
  ctx.restore();
}
const xy = (p) => [p.x, p.y];

function drawFurn(ctx, u, f, screen, alpha = 1) {
  const item = byId[f.lib];
  if (!item) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(f.x, f.y);
  ctx.rotate(f.rot || 0);
  drawSymbol(ctx, item, f.w, f.d, u, { stroke: screen ? THEME.ink : '#000' });
  ctx.restore();
}

function drawDim(ctx, u, dm, color, alpha = 1) {
  const dv = G.sub(dm.b, dm.a);
  const L = G.len(dv);
  if (L < 1) return;
  const d = G.norm(dv), n = G.leftN(d);
  const off = dm.off ?? 600, sg = off < 0 ? -1 : 1;
  const A = { x: dm.a.x + n.x * off, y: dm.a.y + n.y * off }, Bp = { x: dm.b.x + n.x * off, y: dm.b.y + n.y * off };
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 0.8 * u;
  const gap = 6 * u, ext = 5 * u;
  for (const [p, q] of [[dm.a, A], [dm.b, Bp]]) {
    ctx.beginPath();
    ctx.moveTo(p.x + n.x * gap * sg, p.y + n.y * gap * sg);
    ctx.lineTo(q.x + n.x * ext * sg, q.y + n.y * ext * sg);
    ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(Bp.x, Bp.y); ctx.stroke();
  const tk = 5 * u, t = G.norm({ x: d.x + n.x, y: d.y + n.y });
  ctx.lineWidth = 1.3 * u;
  for (const p of [A, Bp]) { ctx.beginPath(); ctx.moveTo(p.x - t.x * tk, p.y - t.y * tk); ctx.lineTo(p.x + t.x * tk, p.y + t.y * tk); ctx.stroke(); }
  // label
  let ang = Math.atan2(d.y, d.x);
  if (Math.cos(ang) < -1e-6 || (Math.abs(Math.cos(ang)) < 1e-6 && Math.sin(ang) > 0)) ang += Math.PI;
  const mid = { x: (A.x + Bp.x) / 2, y: (A.y + Bp.y) / 2 };
  ctx.translate(mid.x, mid.y); ctx.rotate(ang);
  ctx.font = `${11 * u}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillText(fmtLen(L), 0, -3.5 * u);
  ctx.restore();
}

function drawOverallDims(ctx, u, o, polys, walls) {
  const pts = [];
  for (const w of walls) { const P = polys.get(w.id); if (P) pts.push(P.aL, P.aR, P.bL, P.bR); }
  const bb = G.bbox(pts);
  if (!bb) return;
  const col = '#000', off = 1100;
  drawDim(ctx, u, { a: { x: bb.x0, y: bb.y0 }, b: { x: bb.x1, y: bb.y0 }, off: -off }, col);
  drawDim(ctx, u, { a: { x: bb.x0, y: bb.y1 }, b: { x: bb.x0, y: bb.y0 }, off: -off }, col);
}

function drawText(ctx, u, t, screen, alpha = 1) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = screen ? THEME.text : '#000';
  const size = t.size || 160;
  ctx.font = `${size}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  String(t.text || '').split('\n').forEach((ln, i) => ctx.fillText(ln, t.x, t.y + i * size * 1.25));
  ctx.restore();
}

export function textBounds(t, measure) {
  const size = t.size || 160;
  const lines = String(t.text || '').split('\n');
  const w = Math.max(...lines.map((l) => (measure ? measure(l, size) : l.length * size * 0.55)));
  return { x0: t.x, y0: t.y - size, x1: t.x + w, y1: t.y + (lines.length - 1) * size * 1.25 + size * 0.3 };
}

// ---------------------------------------------------------------------------
// Ghosts (tool previews)
// ---------------------------------------------------------------------------
function drawGhost(ctx, u, g, polys) {
  ctx.save();
  if (g.walls) {
    for (const w of g.walls) {
      const d = G.norm(G.sub(w.b, w.a)), n = G.leftN(d), h = w.thickness / 2;
      polyPath(ctx, [
        { x: w.a.x + n.x * h, y: w.a.y + n.y * h }, { x: w.b.x + n.x * h, y: w.b.y + n.y * h },
        { x: w.b.x - n.x * h, y: w.b.y - n.y * h }, { x: w.a.x - n.x * h, y: w.a.y - n.y * h },
      ]);
      ctx.fillStyle = 'rgba(47,109,246,.35)'; ctx.fill();
      ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.2 * u; ctx.stroke();
    }
  }
  if (g.openings) for (const op of g.openings) {
    const w = store.get(op.wallId); const P = w && polys.get(w.id);
    if (w && P) {
      // erase look: draw a highlight band then the symbol
      const gm = doorGeom(op, w, P);
      polyPath(ctx, [
        { x: gm.p1.x + P.n.x * P.h, y: gm.p1.y + P.n.y * P.h }, { x: gm.p2.x + P.n.x * P.h, y: gm.p2.y + P.n.y * P.h },
        { x: gm.p2.x - P.n.x * P.h, y: gm.p2.y - P.n.y * P.h }, { x: gm.p1.x - P.n.x * P.h, y: gm.p1.y - P.n.y * P.h },
      ]);
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.fill();
      drawOpening(ctx, u, op, w, P, true, 0.9);
    }
  }
  if (g.furniture) for (const f of g.furniture) drawFurn(ctx, u, f, true, 0.65);
  if (g.dims) for (const d of g.dims) drawDim(ctx, u, d, THEME.accent, 0.9);
  if (g.room) {
    polyPath(ctx, g.room); ctx.fillStyle = 'rgba(47,109,246,.18)'; ctx.fill();
    ctx.strokeStyle = THEME.accent; ctx.lineWidth = 1.5 * u; ctx.setLineDash([5 * u, 3 * u]); ctx.stroke();
  }
  if (g.text) drawText(ctx, u, g.text, true, 0.7);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Selection outlines & handles
// ---------------------------------------------------------------------------
export function entityOutline(e, polys) {
  if (e.type === 'wall') { const P = polys.get(e.id); return P ? [P.aL, P.bL, P.bR, P.aR] : null; }
  if (e.type === 'furniture') return G.rectCorners(e.x, e.y, e.w, e.d, e.rot || 0);
  if (e.type === 'opening') {
    const w = store.get(e.wallId); const P = w && polys.get(w.id);
    if (!P) return null;
    const g = doorGeom(e, w, P), k = P.h + 40;
    return [
      { x: g.p1.x + P.n.x * k, y: g.p1.y + P.n.y * k }, { x: g.p2.x + P.n.x * k, y: g.p2.y + P.n.y * k },
      { x: g.p2.x - P.n.x * k, y: g.p2.y - P.n.y * k }, { x: g.p1.x - P.n.x * k, y: g.p1.y - P.n.y * k },
    ];
  }
  if (e.type === 'room') { const g = roomGeom(e); return g ? g.inner : null; }
  if (e.type === 'ref') return refCorners(e);
  if (e.type === 'text') { const b = textBounds(e); return [{ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y0 }, { x: b.x1, y: b.y1 }, { x: b.x0, y: b.y1 }]; }
  if (e.type === 'dim') {
    const d = G.norm(G.sub(e.b, e.a)), n = G.leftN(d), off = e.off ?? 600;
    return [e.a, e.b, { x: e.b.x + n.x * off, y: e.b.y + n.y * off }, { x: e.a.x + n.x * off, y: e.a.y + n.y * off }];
  }
  return null;
}

function outlineEntity(ctx, u, id, polys, alpha, lw) {
  const e = store.get(id);
  if (!e) return;
  const pts = entityOutline(e, polys);
  if (!pts) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = THEME.accent; ctx.lineWidth = lw * u;
  if (e.type === 'room') ctx.setLineDash([6 * u, 4 * u]);
  polyPath(ctx, pts);
  if (e.type === 'room') { ctx.fillStyle = 'rgba(47,109,246,.12)'; ctx.fill(); }
  ctx.stroke();
  ctx.restore();
  if (e.type === 'wall' && alpha === 1) {
    const L = G.dist(e.a, e.b);
    const d = G.norm(G.sub(e.b, e.a)), n = G.leftN(d);
    const mid = { x: (e.a.x + e.b.x) / 2 + n.x * (e.thickness / 2 + 14 * u), y: (e.a.y + e.b.y) / 2 + n.y * (e.thickness / 2 + 14 * u) };
    ctx.save();
    let ang = Math.atan2(d.y, d.x); if (Math.cos(ang) < 0) ang += Math.PI;
    ctx.translate(mid.x, mid.y); ctx.rotate(ang);
    ctx.fillStyle = THEME.accent; ctx.font = `600 ${11 * u}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(fmtLen(L), 0, 0);
    ctx.restore();
  }
}

/** Interactive handles for a single selected entity: [{kind, p}] */
export function handlesFor(e, u, polys) {
  if (e.type === 'wall') return [{ kind: 'a', p: e.a }, { kind: 'b', p: e.b }];
  if (e.type === 'furniture') {
    const top = { x: 0, y: -e.d / 2 - 26 * u };
    const p = G.rotate(top, e.rot || 0);
    const out = [{ kind: 'rot', p: { x: e.x + p.x, y: e.y + p.y } }];
    // resize handles at the side midpoints (width / depth)
    for (const [k, lx, ly] of [['rw', e.w / 2, 0], ['rd', 0, e.d / 2]]) {
      const q = G.rotate({ x: lx, y: ly }, e.rot || 0);
      out.push({ kind: k, p: { x: e.x + q.x, y: e.y + q.y } });
    }
    return out;
  }
  if (e.type === 'dim') {
    const d = G.norm(G.sub(e.b, e.a)), n = G.leftN(d), off = e.off ?? 600;
    return [{ kind: 'a', p: e.a }, { kind: 'b', p: e.b }, { kind: 'off', p: { x: (e.a.x + e.b.x) / 2 + n.x * off, y: (e.a.y + e.b.y) / 2 + n.y * off } }];
  }
  return [];
}

function drawHandles(ctx, u, e, polys, coarse) {
  const k = coarse ? 1.7 : 1;
  const hs = handlesFor(e, u, polys);
  if (!hs.length) return;
  ctx.save();
  ctx.lineWidth = 1.5 * u; ctx.strokeStyle = THEME.accent; ctx.fillStyle = '#fff';
  if (e.type === 'furniture') {
    const rot = hs.find((h) => h.kind === 'rot');
    const top = G.rotate({ x: 0, y: -e.d / 2 }, e.rot || 0);
    ctx.beginPath(); ctx.moveTo(e.x + top.x, e.y + top.y); ctx.lineTo(rot.p.x, rot.p.y); ctx.stroke();
  }
  for (const h of hs) {
    ctx.beginPath();
    if (h.kind === 'rot') ctx.arc(h.p.x, h.p.y, 6 * u * k, 0, Math.PI * 2);
    else ctx.rect(h.p.x - 4.5 * u * k, h.p.y - 4.5 * u * k, 9 * u * k, 9 * u * k);
    ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}

export { polyPath };
