// Wall network logic: joins, openings cut-outs, enclosed-room detection.

import {
  dist, sub, norm, leftN, closestOnSeg, segIntersect, lineIntersect, polyArea, pointInPoly, offsetPoly, clamp,
} from './geom.js';

export const nodeKey = (p) => `${Math.round(p.x * 2)},${Math.round(p.y * 2)}`;

export function wallsOnLevel(store, levelId) {
  return store.list('wall', levelId);
}

export function wallInfo(w) {
  const dx = w.b.x - w.a.x, dy = w.b.y - w.a.y;
  const len = Math.hypot(dx, dy) || 1e-6;
  const d = { x: dx / len, y: dy / len };
  return { len, d, n: { x: -d.y, y: d.x }, h: w.thickness / 2 };
}

// ---------------------------------------------------------------------------
// Splitting: keep the network "planar" so T-junctions and crossings become real nodes.
// ---------------------------------------------------------------------------
export function normalizeWalls(store, levelId) {
  for (let guard = 0; guard < 60; guard++) {
    const ws = wallsOnLevel(store, levelId);
    let didSomething = false;
    for (const w of ws) {
      const { len: L } = wallInfo(w);
      if (L < 2) { store.remove(w.id); didSomething = true; break; }
      const pts = [];
      for (const v of ws) {
        if (v === w) continue;
        for (const P of [v.a, v.b]) {
          const c = closestOnSeg(P, w.a, w.b);
          if (c.d < 1.5 && c.s > 2 && c.s < L - 2) pts.push({ s: c.s, p: { x: P.x, y: P.y } });
        }
        const X = segIntersect(w.a, w.b, v.a, v.b);
        if (X) {
          const Lv = wallInfo(v).len;
          if (X.s1 > 2 && X.s1 < L - 2 && X.s2 > 2 && X.s2 < Lv - 2) {
            pts.push({ s: X.s1, p: { x: Math.round(X.pt.x), y: Math.round(X.pt.y) } });
          }
        }
      }
      if (pts.length) { splitWall(store, w, pts); didSomething = true; break; }
    }
    if (!didSomething) return;
  }
}

function splitWall(store, w, pts) {
  pts.sort((p, q) => p.s - q.s);
  const cuts = [];
  for (const p of pts) if (!cuts.length || p.s - cuts[cuts.length - 1].s > 2) cuts.push(p);
  const ops = store.openingsOf(w.id);
  const origB = { ...w.b };
  const segs = []; // {wall, start}
  let prev = { s: 0, p: { ...w.a } };
  const pieces = [];
  for (const c of [...cuts, { s: Infinity, p: origB }]) {
    pieces.push({ from: prev, to: c });
    prev = c;
  }
  pieces.forEach((pc, i) => {
    if (i === 0) {
      w.b = { ...pc.to.p };
      segs.push({ wall: w, start: 0, end: pc.to.s });
    } else {
      const nw = store.add('wall', {
        level: w.level, discipline: w.discipline, a: { ...pc.from.p }, b: { ...pc.to.p },
        thickness: w.thickness, height: w.height, kind: w.kind, structural: w.structural,
      });
      segs.push({ wall: nw, start: pc.from.s, end: pc.to.s });
    }
  });
  for (const o of ops) {
    const seg = segs.find((s) => o.pos >= s.start && o.pos < s.end) || segs[segs.length - 1];
    o.wallId = seg.wall.id;
    o.pos = o.pos - seg.start;
  }
}

// ---------------------------------------------------------------------------
// Mitred wall outlines
// ---------------------------------------------------------------------------
export function computeWallPolys(walls) {
  const nodes = new Map();
  const addEnd = (w, end) => {
    const P = end === 'a' ? w.a : w.b, Q = end === 'a' ? w.b : w.a;
    const d = norm(sub(Q, P));
    const k = nodeKey(P);
    if (!nodes.has(k)) nodes.set(k, { p: P, ends: [] });
    nodes.get(k).ends.push({ w, end, d, h: w.thickness / 2, ang: Math.atan2(d.y, d.x) });
  };
  for (const w of walls) { addEnd(w, 'a'); addEnd(w, 'b'); }

  const corners = new Map(); // `${id}:${end}` -> {left,right}
  for (const { p: N, ends } of nodes.values()) {
    ends.sort((x, y) => x.ang - y.ang);
    const n = ends.length;
    ends.forEach((e, i) => {
      const nl = leftN(e.d);
      const fallL = { x: N.x + nl.x * e.h, y: N.y + nl.y * e.h };
      const fallR = { x: N.x - nl.x * e.h, y: N.y - nl.y * e.h };
      let left = fallL, right = fallR;
      if (n > 1) {
        const nx = ends[(i + 1) % n], pv = ends[(i - 1 + n) % n];
        const limit = 8 * Math.max(e.h, nx.h, pv.h);
        const nxl = leftN(nx.d), pvl = leftN(pv.d);
        // left side of e meets the right side of the next end counter-clockwise
        const L = lineIntersect({ x: N.x + nl.x * e.h, y: N.y + nl.y * e.h }, e.d, { x: N.x - nxl.x * nx.h, y: N.y - nxl.y * nx.h }, nx.d);
        if (L && dist(L, N) < limit) left = L;
        const R = lineIntersect({ x: N.x - nl.x * e.h, y: N.y - nl.y * e.h }, e.d, { x: N.x + pvl.x * pv.h, y: N.y + pvl.y * pv.h }, pv.d);
        if (R && dist(R, N) < limit) right = R;
      }
      corners.set(`${e.w.id}:${e.end}`, { left, right });
    });
  }

  const out = new Map();
  for (const w of walls) {
    const info = wallInfo(w);
    const ca = corners.get(`${w.id}:a`), cb = corners.get(`${w.id}:b`);
    out.set(w.id, {
      ...info, a: w.a, b: w.b,
      // polygon in a->b frame:  aL, bL, bR, aR
      aL: ca.left, aR: ca.right, bL: cb.right, bR: cb.left,
    });
  }
  return out;
}

/** Split a wall outline into solid pieces around its openings.
 *  Returns [{poly, z0, z1, s1, s2}] with z relative to the level floor. */
export function wallSegments(w, P, openings, levelHeight) {
  const H = w.height || levelHeight;
  const { len: L, d, n, h } = P;
  const cut = (s) => ({
    L: { x: w.a.x + d.x * s + n.x * h, y: w.a.y + d.y * s + n.y * h },
    R: { x: w.a.x + d.x * s - n.x * h, y: w.a.y + d.y * s - n.y * h },
  });
  const piece = (s1, s2, z0, z1) => {
    const c1 = s1 <= 0 ? { L: P.aL, R: P.aR } : cut(s1);
    const c2 = s2 >= L ? { L: P.bL, R: P.bR } : cut(s2);
    return { poly: [c1.L, c2.L, c2.R, c1.R], z0, z1, s1, s2 };
  };
  const ops = openings
    .map((o) => ({ o, s1: clamp(o.pos - o.width / 2, 0, L), s2: clamp(o.pos + o.width / 2, 0, L) }))
    .filter((x) => x.s2 - x.s1 > 1)
    .sort((x, y) => x.s1 - y.s1);
  const out = [];
  let cur = 0;
  for (const { o, s1, s2 } of ops) {
    if (s1 - cur > 0.5) out.push(piece(cur, s1, 0, H));
    const sill = o.kind === 'window' ? o.sill || 0 : 0;
    const top = Math.min(H, sill + o.height);
    if (sill > 1) out.push(piece(s1, s2, 0, sill));
    if (top < H - 1) out.push(piece(s1, s2, top, H));
    cur = Math.max(cur, s2);
  }
  if (L - cur > 0.5 || !out.length) out.push(piece(cur, L, 0, H));
  return out;
}

// ---------------------------------------------------------------------------
// Enclosed areas (faces of the wall graph)
// ---------------------------------------------------------------------------
export function computeFaces(walls) {
  const nodes = new Map();
  const edges = [];
  const node = (p) => {
    const k = nodeKey(p);
    if (!nodes.has(k)) nodes.set(k, { k, p: { x: p.x, y: p.y }, out: [] });
    return nodes.get(k);
  };
  for (const w of walls) {
    const A = node(w.a), B = node(w.b);
    if (A === B) continue;
    const e1 = { from: A, to: B, wall: w, ang: Math.atan2(B.p.y - A.p.y, B.p.x - A.p.x) };
    const e2 = { from: B, to: A, wall: w, ang: Math.atan2(A.p.y - B.p.y, A.p.x - B.p.x) };
    e1.twin = e2; e2.twin = e1;
    A.out.push(e1); B.out.push(e2);
    edges.push(e1, e2);
  }
  // prune dead-end spurs
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const nd of nodes.values()) {
      if (nd.out.length === 1) {
        const e = nd.out[0];
        nd.out = [];
        e.to.out = e.to.out.filter((x) => x !== e.twin);
        e.dead = e.twin.dead = true;
        pruned = true;
      }
    }
  }
  for (const nd of nodes.values()) nd.out.sort((a, b) => a.ang - b.ang);

  const used = new Set();
  const faces = [];
  for (const e0 of edges) {
    if (e0.dead || used.has(e0)) continue;
    const loop = [];
    let e = e0, guard = 0;
    while (!used.has(e) && guard++ < 5000) {
      used.add(e);
      loop.push(e);
      const outs = e.to.out;
      const i = outs.indexOf(e.twin);
      if (i < 0) break;
      e = outs[(i - 1 + outs.length) % outs.length];
    }
    if (e !== e0 || loop.length < 3) continue;
    const pts = loop.map((x) => x.from.p);
    const area = polyArea(pts);
    if (area <= 1000) continue; // outer face (negative) or degenerate
    const inner = offsetPoly(pts, loop.map((x) => x.wall.thickness / 2));
    const innerArea = polyArea(inner);
    if (innerArea <= 0) continue;
    faces.push({ pts, area, inner, innerArea, wallIds: [...new Set(loop.map((x) => x.wall.id))] });
  }
  return faces;
}

const faceCache = new Map(); // levelId -> {version, faces}
export function facesFor(store, levelId) {
  const c = faceCache.get(levelId);
  if (c && c.version === store.version) return c.faces;
  const faces = computeFaces(wallsOnLevel(store, levelId));
  faceCache.set(levelId, { version: store.version, faces });
  return faces;
}

/** Smallest enclosed area that contains the point (works on wall centre-line polygons). */
export function faceAt(store, levelId, p) {
  let best = null;
  for (const f of facesFor(store, levelId)) {
    if (pointInPoly(p, f.pts) && (!best || f.area < best.area)) best = f;
  }
  return best;
}

export function polysFor(store, levelId) {
  const c = polysFor._c;
  const key = levelId + ':' + store.version;
  if (c && c.key === key) return c.v;
  const v = computeWallPolys(wallsOnLevel(store, levelId));
  polysFor._c = { key, v };
  return v;
}
