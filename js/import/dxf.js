// ASCII DXF reader (AutoCAD, BricsCAD, MagicPlan, Floorplanner, SketchUp-via-DXF, …).
// Output: a "drawing" in the file's own units with y pointing up (the importer flips it).
//   {segs:[{x1,y1,x2,y2,layer}], texts:[{x,y,text,h,layer}], dims:[{a,b,p,layer,text}], insunits}

const UNIT_CODES = { 1: 'in', 2: 'ft', 4: 'mm', 5: 'cm', 6: 'm', 14: 'dm', 10: 'yd' };

function pairsOf(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) { i--; continue; }
    out.push([code, lines[i + 1].trim()]);
  }
  return out;
}

const num = (it, code, def = 0) => { const p = it.p.find((x) => x[0] === code); return p ? parseFloat(p[1]) : def; };
const str = (it, code, def = '') => { const p = it.p.find((x) => x[0] === code); return p ? p[1] : def; };

export function parseDXF(text) {
  const pairs = pairsOf(text);
  let insunits = 0;
  const blocks = {};
  const ents = [];
  let section = '', curBlock = null, cur = null;
  for (let i = 0; i < pairs.length; i++) {
    const [c, v] = pairs[i];
    if (c === 9 && v === '$INSUNITS' && pairs[i + 1]) insunits = parseInt(pairs[i + 1][1], 10) || 0;
    if (c === 0) {
      if (v === 'SECTION') { section = pairs[i + 1]?.[1] || ''; cur = null; continue; }
      if (v === 'ENDSEC') { section = ''; cur = null; continue; }
      if (v === 'EOF') break;
      if (section === 'BLOCKS' && v === 'BLOCK') { cur = { t: 'BLOCK', p: [] }; curBlock = cur; continue; }
      if (section === 'BLOCKS' && v === 'ENDBLK') { if (curBlock) blocks[str(curBlock, 2)] = curBlock; curBlock = null; cur = null; continue; }
      if (section === 'ENTITIES' || (section === 'BLOCKS' && curBlock)) {
        cur = { t: v, p: [] };
        (section === 'BLOCKS' ? (curBlock.ents ||= []) : ents).push(cur);
        continue;
      }
      cur = null;
    } else if (cur) cur.p.push([c, v]);
  }

  const out = { segs: [], texts: [], dims: [], insunits: UNIT_CODES[insunits] || null };
  const ident = [1, 0, 0, 1, 0, 0];
  const mul = (m, n) => [m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1], m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3], m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5]];
  const ap = (m, x, y) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });

  const seg = (m, a, b, layer) => {
    const p = ap(m, a.x, a.y), q = ap(m, b.x, b.y);
    if (Math.hypot(p.x - q.x, p.y - q.y) > 1e-9) out.segs.push({ x1: p.x, y1: p.y, x2: q.x, y2: q.y, layer });
  };
  const poly = (m, pts, closed, layer) => {
    for (let i = 0; i + 1 < pts.length; i++) bulgeSeg(m, pts[i], pts[i + 1], layer);
    if (closed && pts.length > 2) bulgeSeg(m, pts[pts.length - 1], pts[0], layer);
  };
  const bulgeSeg = (m, p1, p2, layer) => {
    const b = p1.bulge || 0;
    if (!b) return seg(m, p1, p2, layer);
    const th = 4 * Math.atan(b), cx = p2.x - p1.x, cy = p2.y - p1.y, L = Math.hypot(cx, cy);
    if (L < 1e-9) return;
    const d = L / 2 / Math.tan(th / 2);
    const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
    const cen = { x: mid.x - (cy / L) * d, y: mid.y + (cx / L) * d };
    const a0 = Math.atan2(p1.y - cen.y, p1.x - cen.x), r = Math.hypot(p1.x - cen.x, p1.y - cen.y);
    const n = Math.max(2, Math.ceil(Math.abs(th) / (Math.PI / 18)));
    let prev = p1;
    for (let k = 1; k <= n; k++) {
      const ang = a0 + (th * k) / n;
      const pt = k === n ? p2 : { x: cen.x + r * Math.cos(ang), y: cen.y + r * Math.sin(ang) };
      seg(m, prev, pt, layer); prev = pt;
    }
  };
  const arc = (m, cx, cy, r, a0, a1, layer) => {
    let sweep = a1 - a0; while (sweep <= 0) sweep += 360;
    const n = Math.max(2, Math.ceil(sweep / 6));
    let prev = null;
    for (let k = 0; k <= n; k++) {
      const a = ((a0 + (sweep * k) / n) * Math.PI) / 180;
      const pt = { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
      if (prev) seg(m, prev, pt, layer);
      prev = pt;
    }
  };
  const cleanText = (t) => t.replace(/\\P/g, '\n').replace(/\{?\\[A-Za-z][^;{}]*;/g, '').replace(/[{}]/g, '').replace(/\\~/g, ' ').replace(/%%[cC]/g, 'Ø').replace(/%%[dD]/g, '°').replace(/%%[pP]/g, '±');

  const emit = (list, m, depth) => {
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const layer = str(e, 8, '0');
      switch (e.t) {
        case 'LINE': seg(m, { x: num(e, 10), y: num(e, 20) }, { x: num(e, 11), y: num(e, 21) }, layer); break;
        case 'LWPOLYLINE': {
          const pts = [];
          for (const [c, v] of e.p) {
            if (c === 10) pts.push({ x: parseFloat(v), y: 0, bulge: 0 });
            else if (c === 20 && pts.length) pts[pts.length - 1].y = parseFloat(v);
            else if (c === 42 && pts.length) pts[pts.length - 1].bulge = parseFloat(v);
          }
          poly(m, pts, (num(e, 70) & 1) === 1, layer); break;
        }
        case 'POLYLINE': {
          const pts = []; let j = i + 1;
          while (j < list.length && list[j].t === 'VERTEX') { pts.push({ x: num(list[j], 10), y: num(list[j], 20), bulge: num(list[j], 42) }); j++; }
          if (list[j]?.t === 'SEQEND') j++;
          poly(m, pts, (num(e, 70) & 1) === 1, layer);
          i = j - 1; break;
        }
        case 'ARC': arc(m, num(e, 10), num(e, 20), num(e, 40), num(e, 50), num(e, 51, 360), layer); break;
        case 'CIRCLE': arc(m, num(e, 10), num(e, 20), num(e, 40), 0, 360, layer); break;
        case 'TEXT': case 'MTEXT': {
          const p = ap(m, num(e, 10), num(e, 20));
          let t = e.p.filter((x) => x[0] === 3).map((x) => x[1]).join('') + str(e, 1);
          t = cleanText(t).trim();
          if (t) out.texts.push({ x: p.x, y: p.y, text: t, h: num(e, 40, 0) * Math.hypot(m[0], m[1]), layer });
          break;
        }
        case 'DIMENSION': {
          const type = num(e, 70) & 7;
          if (type > 1) break; // linear / aligned only
          const a = ap(m, num(e, 13), num(e, 23)), b = ap(m, num(e, 14), num(e, 24)), pd = ap(m, num(e, 10), num(e, 20));
          let bb = b;
          const rot = ((num(e, 50) % 180) + 180) % 180;
          if (type === 0) { if (rot < 1 || rot > 179) bb = { x: b.x, y: a.y }; else if (Math.abs(rot - 90) < 1) bb = { x: a.x, y: b.y }; }
          if (Math.hypot(bb.x - a.x, bb.y - a.y) > 1e-6) out.dims.push({ a, b: bb, p: pd, layer, text: str(e, 1) });
          break;
        }
        case 'INSERT': {
          const blk = blocks[str(e, 2)];
          if (!blk?.ents || depth > 3) break;
          const sx = num(e, 41, 1), sy = num(e, 42, 1), rot = (num(e, 50) * Math.PI) / 180, c = Math.cos(rot), s = Math.sin(rot);
          const bx = num(blk, 10), by = num(blk, 20);
          const M = mul(m, mul([1, 0, 0, 1, num(e, 10), num(e, 20)], mul([c, s, -s, c, 0, 0], mul([sx, 0, 0, sy, 0, 0], [1, 0, 0, 1, -bx, -by]))));
          emit(blk.ents, M, depth + 1);
          break;
        }
        default: break;
      }
    }
  };
  emit(ents, ident, 0);
  return out;
}
