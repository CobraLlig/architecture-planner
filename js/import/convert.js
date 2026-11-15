// Turning raw linework into editable walls.
//  - toMM: apply units, flip CAD's y-up to our y-down, move to the origin
//  - segmentsToWalls: double-line wall outlines -> centre-line walls with thickness (or single lines -> walls)
//  - cleanupWalls: close small gaps, extend/trim to corners and T-junctions
//  - bridgeGaps: collinear walls with a doorway-sized gap -> wall + opening

import * as G from '../geom.js';

export const MM_PER = { mm: 1, cm: 10, dm: 100, m: 1000, in: 25.4, ft: 304.8, yd: 914.4, px: 25.4 / 96 };

export function drawingBounds(d) {
  const pts = [];
  for (const s of d.segs) pts.push({ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 });
  return G.bbox(pts);
}

/** Robust guess for unitless drawings. */
export function guessUnits(d, imperialPref) {
  if (d.insunits && MM_PER[d.insunits]) return d.insunits;
  const bb = drawingBounds(d);
  if (!bb) return 'mm';
  // use a trimmed extent so a stray far-away line doesn't skew it
  const D = Math.max(bb.w, bb.h);
  if (D >= 1500) return 'mm';
  if (D >= 120) return imperialPref ? 'in' : 'cm';
  return imperialPref ? 'ft' : 'm';
}

export function toMM(d, mmPerUnit, keepSegs) {
  const flip = d.yDown ? 1 : -1;
  const T = (x, y) => ({ x: x * mmPerUnit, y: y * mmPerUnit * flip });
  const segs = d.segs.map((s) => { const a = T(s.x1, s.y1), b = T(s.x2, s.y2); return { x1: a.x, y1: a.y, x2: b.x, y2: b.y, layer: s.layer }; });
  const pts = segs.flatMap((s) => [{ x: s.x1, y: s.y1 }, { x: s.x2, y: s.y2 }]);
  const bb = G.bbox(pts) || { x0: 0, y0: 0, w: 0, h: 0 };
  const sh = { x: bb.x0, y: bb.y0 };
  for (const s of segs) { s.x1 -= sh.x; s.x2 -= sh.x; s.y1 -= sh.y; s.y2 -= sh.y; }
  const mv = (p) => { const q = T(p.x, p.y); return { x: q.x - sh.x, y: q.y - sh.y }; };
  const texts = d.texts.map((t) => ({ ...mv(t), text: t.text, h: (t.h || 0) * mmPerUnit, layer: t.layer }));
  const dims = d.dims.map((m) => {
    const a = mv(m.a), b = mv(m.b), p = mv(m.p);
    const n = G.leftN(G.norm(G.sub(b, a)));
    let off = G.dot(G.sub(p, a), n);
    if (!isFinite(off) || Math.abs(off) > 4000) off = 600;
    return { a, b, off, layer: m.layer };
  });
  return { segs, texts, dims, size: { w: bb.w, h: bb.h } };
}

// ---------------------------------------------------------------------------
function dirOf(a, b) { const L = G.dist(a, b); return { L, d: { x: (b.x - a.x) / L, y: (b.y - a.y) / L } }; }

/** Group collinear intervals: input [{p0,p1,t}] -> walls [{a,b,thickness}] with touching/overlapping pieces merged. */
function mergeCollinear(items, { angTol = 0.026, offTol = 30, tTol = 40, gap = 80 } = {}) {
  const groups = [];
  for (const it of items) {
    let d = G.norm(G.sub(it.p1, it.p0));
    if (!isFinite(d.x)) continue;
    let found = null;
    for (const g of groups) {
      if (Math.abs(G.cross(g.d, d)) > angTol) continue;
      const n = G.leftN(g.d);
      if (Math.abs(G.dot(G.sub(it.p0, g.o), n)) > offTol) continue;
      if (Math.abs(it.t - g.t) > tTol) continue;
      found = g; break;
    }
    if (!found) { found = { d, o: it.p0, t: it.t, n: 0, iv: [] }; groups.push(found); }
    const s0 = G.dot(G.sub(it.p0, found.o), found.d), s1 = G.dot(G.sub(it.p1, found.o), found.d);
    found.iv.push([Math.min(s0, s1), Math.max(s0, s1)]);
    found.t = (found.t * found.n + it.t) / (found.n + 1); found.n++;
  }
  const out = [];
  for (const g of groups) {
    g.iv.sort((a, b) => a[0] - b[0]);
    let cur = g.iv[0].slice();
    const flush = () => out.push({ a: { x: g.o.x + g.d.x * cur[0], y: g.o.y + g.d.y * cur[0] }, b: { x: g.o.x + g.d.x * cur[1], y: g.o.y + g.d.y * cur[1] }, thickness: g.t });
    for (const iv of g.iv.slice(1)) { if (iv[0] <= cur[1] + gap) cur[1] = Math.max(cur[1], iv[1]); else { flush(); cur = iv.slice(); } }
    flush();
  }
  return out;
}

export function segmentsToWalls(segs, o) {
  const { mode = 'double', thickness = 114, minT = 70, maxT = 450, minLen = 250 } = o;
  if (mode === 'single') {
    const items = segs.filter((s) => Math.hypot(s.x2 - s.x1, s.y2 - s.y1) >= 100).map((s) => ({ p0: { x: s.x1, y: s.y1 }, p1: { x: s.x2, y: s.y2 }, t: thickness }));
    return mergeCollinear(items, { tTol: 1e9 });
  }
  let S = segs.map((s) => {
    const a = { x: s.x1, y: s.y1 }, b = { x: s.x2, y: s.y2 }, { L, d } = dirOf(a, b);
    return L >= minLen ? { a, b, L, d, n: G.leftN(d) } : null;
  }).filter(Boolean);
  if (S.length > 6000) S = S.sort((p, q) => q.L - p.L).slice(0, 6000);
  const cands = [];
  for (let i = 0; i < S.length; i++) {
    const A = S[i];
    for (let j = i + 1; j < S.length; j++) {
      const B = S[j];
      if (Math.abs(A.d.x * B.d.y - A.d.y * B.d.x) > 0.021) continue;
      const mB = { x: (B.a.x + B.b.x) / 2 - A.a.x, y: (B.a.y + B.b.y) / 2 - A.a.y };
      const sgn = G.dot(mB, A.n), perp = Math.abs(sgn);
      if (perp < minT || perp > maxT) continue;
      const t1 = G.dot({ x: B.a.x - A.a.x, y: B.a.y - A.a.y }, A.d), t2 = G.dot({ x: B.b.x - A.a.x, y: B.b.y - A.a.y }, A.d);
      const s0 = Math.max(0, Math.min(t1, t2)), s1 = Math.min(A.L, Math.max(t1, t2));
      if (s1 - s0 < Math.min(200, 0.5 * Math.min(A.L, B.L))) continue;
      const off = sgn / 2;
      cands.push({
        p0: { x: A.a.x + A.d.x * s0 + A.n.x * off, y: A.a.y + A.d.y * s0 + A.n.y * off },
        p1: { x: A.a.x + A.d.x * s1 + A.n.x * off, y: A.a.y + A.d.y * s1 + A.n.y * off }, t: perp,
      });
    }
  }
  return mergeCollinear(cands);
}

export function cleanupWalls(walls, tol = 150) {
  const info = walls.map((w) => { const { L, d } = dirOf(w.a, w.b); return { L, d }; });
  const moves = [];
  walls.forEach((w, i) => {
    for (const end of ['a', 'b']) {
      const E = w[end]; let best = null;
      walls.forEach((v, j) => {
        if (i === j) return;
        if (Math.abs(G.cross(info[i].d, info[j].d)) < 0.17) return;
        const X = G.lineIntersect(w.a, info[i].d, v.a, info[j].d);
        if (!X) return;
        const dE = G.dist(X, E);
        if (dE > tol) return;
        const tv = G.dot(G.sub(X, v.a), info[j].d);
        if (tv < -tol || tv > info[j].L + tol) return;
        if (!best || dE < best.d) best = { X, d: dE };
      });
      if (best) moves.push({ w, end, X: best.X });
    }
  });
  for (const m of moves) m.w[m.end] = { x: m.X.x, y: m.X.y };
  // snap remaining nearby endpoints together
  const pts = walls.flatMap((w) => [{ w, end: 'a' }, { w, end: 'b' }]);
  const used = new Set();
  pts.forEach((p, i) => {
    if (used.has(i)) return;
    const cl = [i];
    pts.forEach((q, j) => { if (j !== i && !used.has(j) && G.dist(p.w[p.end], q.w[q.end]) < tol / 3) cl.push(j); });
    if (cl.length > 1) {
      const c = cl.reduce((a, k) => ({ x: a.x + pts[k].w[pts[k].end].x / cl.length, y: a.y + pts[k].w[pts[k].end].y / cl.length }), { x: 0, y: 0 });
      cl.forEach((k) => { pts[k].w[pts[k].end] = { ...c }; used.add(k); });
    }
  });
  return walls.filter((w) => G.dist(w.a, w.b) >= 80);
}

/** Doorway-sized gaps between collinear walls -> bridging wall + opening. Returns [{wall, opening}] */
export function bridgeGaps(walls, { min = 550, max = 2400 } = {}) {
  const groups = [];
  for (const w of walls) {
    const { L, d } = dirOf(w.a, w.b);
    if (L < 100) continue;
    let g = groups.find((g) => Math.abs(G.cross(g.d, d)) < 0.026 && Math.abs(G.dot(G.sub(w.a, g.o), G.leftN(g.d))) < 40 && Math.abs(w.thickness - g.t) < 40);
    if (!g) { g = { d, o: w.a, t: w.thickness, iv: [] }; groups.push(g); }
    const s0 = G.dot(G.sub(w.a, g.o), g.d), s1 = G.dot(G.sub(w.b, g.o), g.d);
    g.iv.push([Math.min(s0, s1), Math.max(s0, s1)]);
  }
  const out = [];
  for (const g of groups) {
    g.iv.sort((a, b) => a[0] - b[0]);
    for (let i = 0; i + 1 < g.iv.length; i++) {
      const gap = g.iv[i + 1][0] - g.iv[i][1];
      if (gap < min || gap > max) continue;
      const s0 = g.iv[i][1], s1 = g.iv[i + 1][0];
      const a = { x: g.o.x + g.d.x * s0, y: g.o.y + g.d.y * s0 }, b = { x: g.o.x + g.d.x * s1, y: g.o.y + g.d.y * s1 };
      out.push({ wall: { a, b, thickness: g.t }, opening: { width: Math.max(500, gap - 40), pos: gap / 2, style: gap < 1200 ? 'single' : gap < 2400 ? 'double' : 'open' } });
    }
  }
  return out;
}
