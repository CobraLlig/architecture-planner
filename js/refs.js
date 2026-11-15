// Reference layers: imported images (scans, PDFs, point-cloud slices) and CAD linework used for tracing.
// Both share a transform: origin (x,y), rotation, uniform scale. They never print and never block editing.

import { store } from './store.js';
import * as G from './geom.js';

const imgCache = new Map(); // id -> {src, img, ready}
let redraw = () => {};
export function setRefRedraw(fn) { redraw = fn; }

const toWorld = (ref, px, py) => {
  const s = ref.scale || 1, c = Math.cos(ref.rot || 0), n = Math.sin(ref.rot || 0);
  return { x: ref.x + (px * c - py * n) * s, y: ref.y + (px * n + py * c) * s };
};
export const refToWorld = toWorld;

export function refCorners(ref) {
  if (ref.kind === 'image') return [[0, 0], [ref.w, 0], [ref.w, ref.h], [0, ref.h]].map(([x, y]) => toWorld(ref, x, y));
  const [x0, y0, x1, y1] = ref.bbox || [0, 0, 1, 1];
  return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => toWorld(ref, x, y));
}

export function drawRef(ctx, u, ref) {
  if (ref.hidden) return;
  ctx.save();
  ctx.globalAlpha = ref.opacity ?? 0.6;
  if (ref.kind === 'image') {
    let c = imgCache.get(ref.id);
    if (!c || c.src !== ref.src) {
      const img = new Image();
      c = { src: ref.src, img, ready: false };
      img.onload = () => { c.ready = true; redraw(); };
      img.src = ref.src;
      imgCache.set(ref.id, c);
    }
    if (c.ready) {
      ctx.translate(ref.x, ref.y); ctx.rotate(ref.rot || 0); ctx.scale(ref.scale || 1, ref.scale || 1);
      ctx.globalCompositeOperation = ref.blend === false ? 'source-over' : 'multiply';
      ctx.drawImage(c.img, 0, 0, ref.w, ref.h);
    }
  } else if (ref.kind === 'lines') {
    const segs = ref.segs, s = ref.scale || 1, cr = Math.cos(ref.rot || 0), sr = Math.sin(ref.rot || 0);
    ctx.strokeStyle = '#6f7d90'; ctx.lineWidth = 0.9 * u; ctx.lineJoin = 'round';
    ctx.beginPath();
    for (let i = 0; i + 3 < segs.length; i += 4) {
      ctx.moveTo(ref.x + (segs[i] * cr - segs[i + 1] * sr) * s, ref.y + (segs[i] * sr + segs[i + 1] * cr) * s);
      ctx.lineTo(ref.x + (segs[i + 2] * cr - segs[i + 3] * sr) * s, ref.y + (segs[i + 2] * sr + segs[i + 3] * cr) * s);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Endpoints of reference linework in world coordinates (for snapping), cached per project version. */
let snapCache = { key: '', pts: [] };
export function refSnapPoints(levelId) {
  const key = levelId + ':' + store.version;
  if (snapCache.key === key) return snapCache.pts;
  const pts = [];
  for (const r of store.list('ref', levelId)) {
    if (r.kind !== 'lines' || r.hidden) continue;
    const segs = r.segs;
    for (let i = 0; i + 3 < segs.length && pts.length < 60000; i += 4) {
      pts.push(toWorld(r, segs[i], segs[i + 1]), toWorld(r, segs[i + 2], segs[i + 3]));
    }
  }
  snapCache = { key, pts };
  return pts;
}

export function hitRef(ref, p, tol) {
  if (ref.hidden || ref.locked) return false;
  if (ref.kind === 'image') return G.pointInPoly(p, refCorners(ref));
  const segs = ref.segs, s = ref.scale || 1, cr = Math.cos(ref.rot || 0), sr = Math.sin(ref.rot || 0);
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const a = { x: ref.x + (segs[i] * cr - segs[i + 1] * sr) * s, y: ref.y + (segs[i] * sr + segs[i + 1] * cr) * s };
    const b = { x: ref.x + (segs[i + 2] * cr - segs[i + 3] * sr) * s, y: ref.y + (segs[i + 2] * sr + segs[i + 3] * cr) * s };
    if (G.closestOnSeg(p, a, b).d < tol) return true;
  }
  return false;
}

/** Scale a reference about a world point so that a measured distance becomes the real distance. */
export function scaleRefAbout(ref, pivot, factor) {
  ref.x = pivot.x + (ref.x - pivot.x) * factor;
  ref.y = pivot.y + (ref.y - pivot.y) * factor;
  ref.scale = (ref.scale || 1) * factor;
}

export function rotateRefAbout(ref, pivot, delta) {
  const v = G.rotate({ x: ref.x - pivot.x, y: ref.y - pivot.y }, delta);
  ref.x = pivot.x + v.x; ref.y = pivot.y + v.y;
  ref.rot = G.normAngle((ref.rot || 0) + delta);
}
