// Small 2D geometry toolkit. World units are millimetres; +x east, +y south (screen-down).

export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
export const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
export const dot = (a, b) => a.x * b.x + a.y * b.y;
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const len = (a) => Math.hypot(a.x, a.y);
export const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const norm = (a) => { const l = len(a) || 1; return { x: a.x / l, y: a.y / l }; };
export const leftN = (d) => ({ x: -d.y, y: d.x });
export const rotate = (p, ang) => {
  const c = Math.cos(ang), s = Math.sin(ang);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
};
export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/** Intersection of segments p-p2 and q-q2. Returns {pt, s1, s2} (distances along each) or null. */
export function segIntersect(p, p2, q, q2) {
  const r = sub(p2, p), s = sub(q2, q);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const qp = sub(q, p);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return {
    pt: { x: p.x + r.x * t, y: p.y + r.y * t },
    s1: t * len(r),
    s2: u * len(s),
  };
}

/** Closest point on segment a-b to p. Returns {pt, s (distance along from a), d (distance from p)}. */
export function closestOnSeg(p, a, b) {
  const ab = sub(b, a);
  const L2 = dot(ab, ab);
  let t = L2 === 0 ? 0 : clamp(dot(sub(p, a), ab) / L2, 0, 1);
  const pt = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { pt, s: t * Math.sqrt(L2), d: dist(p, pt) };
}

/** Intersection of two infinite lines (point+direction). */
export function lineIntersect(p, d1, q, d2) {
  const den = cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = cross(sub(q, p), d2) / den;
  return { x: p.x + d1.x * t, y: p.y + d1.y * t };
}

export function polyArea(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function polyCentroid(pts) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    a += f; cx += (p.x + q.x) * f; cy += (p.y + q.y) * f;
  }
  if (Math.abs(a) < 1e-6) return pts[0] || { x: 0, y: 0 };
  return { x: cx / (3 * a), y: cy / (3 * a) };
}

export function pointInPoly(p, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function bbox(pts) {
  if (!pts.length) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

/** Corners of a rectangle centred on (cx,cy), size w x d, rotated by rot radians. */
export function rectCorners(cx, cy, w, d, rot = 0) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-w / 2, -d / 2], [w / 2, -d / 2], [w / 2, d / 2], [-w / 2, d / 2]].map(([x, y]) => ({
    x: cx + x * c - y * s,
    y: cy + x * s + y * c,
  }));
}

/** Convert world point into the local frame of a rotated item. */
export function toLocal(p, cx, cy, rot) {
  return rotate({ x: p.x - cx, y: p.y - cy }, -rot);
}

export function normAngle(a) {
  while (a <= -Math.PI) a += 2 * Math.PI;
  while (a > Math.PI) a -= 2 * Math.PI;
  return a;
}

/** Offset a closed polygon by `dist` (positive = outwards for a CCW-by-shoelace polygon's right side). */
export function offsetPoly(pts, offsets) {
  // offsets: number or array (per edge i, edge i = pts[i] -> pts[i+1]); positive pushes to the left of travel.
  const n = pts.length;
  const off = (i) => (Array.isArray(offsets) ? offsets[i] : offsets);
  const lines = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const d = norm(sub(q, p));
    const nl = leftN(d);
    return { p: { x: p.x + nl.x * off(i), y: p.y + nl.y * off(i) }, d };
  });
  return pts.map((p, i) => {
    const a = lines[(i - 1 + n) % n], b = lines[i];
    const hit = lineIntersect(a.p, a.d, b.p, b.d);
    if (!hit || dist(hit, p) > 20000) return { x: b.p.x, y: b.p.y };
    return hit;
  });
}
