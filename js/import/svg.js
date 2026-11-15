// SVG reader: lines, polylines, polygons, rects and paths become linework (y already points down).
// Returns the same "drawing" shape as the DXF reader, but with `yDown: true`.

const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];

function parseTransform(t) {
  let m = [1, 0, 0, 1, 0, 0];
  if (!t) return m;
  for (const [, fn, args] of t.matchAll(/(\w+)\s*\(([^)]*)\)/g)) {
    const a = args.split(/[\s,]+/).filter(Boolean).map(Number);
    let n = null;
    if (fn === 'matrix') n = a;
    else if (fn === 'translate') n = [1, 0, 0, 1, a[0] || 0, a[1] || 0];
    else if (fn === 'scale') n = [a[0], 0, 0, a[1] ?? a[0], 0, 0];
    else if (fn === 'rotate') { const r = ((a[0] || 0) * Math.PI) / 180, c = Math.cos(r), s = Math.sin(r); n = [c, s, -s, c, 0, 0]; if (a.length > 2) n = mul([1, 0, 0, 1, a[1], a[2]], mul(n, [1, 0, 0, 1, -a[1], -a[2]])); }
    if (n) m = mul(m, n);
  }
  return m;
}

function pathPoints(d) {
  const toks = d.match(/[a-zA-Z]|-?\d*\.?\d+(?:e[-+]?\d+)?/g) || [];
  const subs = []; let cur = [], i = 0, cmd = '', x = 0, y = 0, sx = 0, sy = 0;
  const n = () => parseFloat(toks[i++]);
  const push = (px, py) => { cur.push({ x: px, y: py }); x = px; y = py; };
  const bez = (p0, p1, p2, p3) => { for (let k = 1; k <= 10; k++) { const t = k / 10, u = 1 - t; push(u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0], u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1]); } };
  while (i < toks.length) {
    if (/[a-zA-Z]/.test(toks[i])) cmd = toks[i++];
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C === 'Z') { if (cur.length) { cur.push({ x: sx, y: sy, close: true }); x = sx; y = sy; subs.push(cur); cur = []; } continue; }
    if (C === 'M') { if (cur.length) subs.push(cur); cur = []; let a = n(), b = n(); if (rel) { a += x; b += y; } push(a, b); sx = a; sy = b; cmd = rel ? 'l' : 'L'; }
    else if (C === 'L') { let a = n(), b = n(); if (rel) { a += x; b += y; } push(a, b); }
    else if (C === 'H') { let a = n(); if (rel) a += x; push(a, y); }
    else if (C === 'V') { let b = n(); if (rel) b += y; push(x, b); }
    else if (C === 'C') { const p0 = [x, y]; let a = [n(), n(), n(), n(), n(), n()]; if (rel) a = a.map((v, k) => v + (k % 2 ? p0[1] : p0[0])); bez(p0, [a[0], a[1]], [a[2], a[3]], [a[4], a[5]]); }
    else if (C === 'S') { const p0 = [x, y]; let a = [n(), n(), n(), n()]; if (rel) a = a.map((v, k) => v + (k % 2 ? p0[1] : p0[0])); bez(p0, p0, [a[0], a[1]], [a[2], a[3]]); }
    else if (C === 'Q') { const p0 = [x, y]; let a = [n(), n(), n(), n()]; if (rel) a = a.map((v, k) => v + (k % 2 ? p0[1] : p0[0])); bez(p0, [p0[0] + (2 / 3) * (a[0] - p0[0]), p0[1] + (2 / 3) * (a[1] - p0[1])], [a[2] + (2 / 3) * (a[0] - a[2]), a[3] + (2 / 3) * (a[1] - a[3])], [a[2], a[3]]); }
    else if (C === 'A') { n(); n(); n(); n(); n(); let a = n(), b = n(); if (rel) { a += x; b += y; } push(a, b); }
    else i++;
  }
  if (cur.length) subs.push(cur);
  return subs;
}

export function parseSVG(text) {
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (!root || root.nodeName === 'parsererror' || doc.querySelector('parsererror')) throw new Error('Not a valid SVG file');
  const out = { segs: [], texts: [], dims: [], yDown: true, insunits: null };
  const seg = (m, a, b, layer) => {
    const p = { x: m[0] * a.x + m[2] * a.y + m[4], y: m[1] * a.x + m[3] * a.y + m[5] };
    const q = { x: m[0] * b.x + m[2] * b.y + m[4], y: m[1] * b.x + m[3] * b.y + m[5] };
    if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer });
  };
  const chain = (m, pts, closed, layer) => { for (let i = 0; i + 1 < pts.length; i++) seg(m, pts[i], pts[i + 1], layer); if (closed && pts.length > 2) seg(m, pts[pts.length - 1], pts[0], layer); };
  const nums = (s) => (s || '').trim().split(/[\s,]+/).filter(Boolean).map(Number);
  const walk = (node, m, layer, depth) => {
    for (const ch of node.children) {
      const tag = ch.localName;
      const nm = mul(m, parseTransform(ch.getAttribute('transform')));
      const lay = depth === 0 && (ch.id || ch.getAttribute('class')) ? ch.id || ch.getAttribute('class') : layer;
      if (tag === 'g' || tag === 'svg') walk(ch, nm, tag === 'g' && depth === 0 && (ch.id || ch.getAttribute('class')) ? lay : layer, depth + 1);
      else if (tag === 'line') seg(nm, { x: +ch.getAttribute('x1') || 0, y: +ch.getAttribute('y1') || 0 }, { x: +ch.getAttribute('x2') || 0, y: +ch.getAttribute('y2') || 0 }, layer);
      else if (tag === 'polyline' || tag === 'polygon') { const a = nums(ch.getAttribute('points')), pts = []; for (let i = 0; i + 1 < a.length; i += 2) pts.push({ x: a[i], y: a[i + 1] }); chain(nm, pts, tag === 'polygon', layer); }
      else if (tag === 'rect') { const x = +ch.getAttribute('x') || 0, y = +ch.getAttribute('y') || 0, w = +ch.getAttribute('width') || 0, h = +ch.getAttribute('height') || 0; chain(nm, [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true, layer); }
      else if (tag === 'path') for (const sub of pathPoints(ch.getAttribute('d') || '')) chain(nm, sub, false, layer);
      else if (tag === 'text') { const p = { x: +ch.getAttribute('x') || 0, y: +ch.getAttribute('y') || 0 }; out.texts.push({ x: nm[0] * p.x + nm[2] * p.y + nm[4], y: nm[1] * p.x + nm[3] * p.y + nm[5], text: ch.textContent.trim(), h: 0, layer }); }
    }
  };
  walk(root, [1, 0, 0, 1, 0, 0], 'SVG', 0);
  // physical size hint (width="…mm / in / cm") -> units per user-unit
  const vb = (root.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const wAttr = root.getAttribute('width') || '';
  const mm = wAttr.match(/^([\d.]+)\s*(mm|cm|in|pt|px)?$/);
  if (mm && vb.length === 4 && vb[2] > 0) {
    const f = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, px: 25.4 / 96, undefined: 25.4 / 96 }[mm[2]];
    out.svgMmPerUnit = (parseFloat(mm[1]) * f) / vb[2];
  }
  return out;
}
