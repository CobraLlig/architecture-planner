// Point-cloud / mesh readers (PLY ascii+binary, XYZ/PTS/TXT, OBJ vertices) and a floor-plan slice rasteriser.
// A horizontal slice through a scan (above the floor, below the ceiling) shows walls as dense lines — perfect for tracing.

const SIZES = { char: 1, int8: 1, uchar: 1, uint8: 1, short: 2, int16: 2, ushort: 2, uint16: 2, int: 4, int32: 4, uint: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
const MAX_POINTS = 6_000_000;

export function parseCloud(buffer, ext) {
  ext = ext.toLowerCase();
  if (ext === 'ply') return parsePLY(buffer);
  const text = new TextDecoder().decode(buffer);
  const pts = [];
  if (ext === 'obj') {
    for (const ln of text.split('\n')) if (ln.charCodeAt(0) === 118 && ln.charCodeAt(1) === 32) { const a = ln.trim().split(/\s+/); pts.push(+a[1], +a[2], +a[3]); }
  } else {
    for (const ln of text.split('\n')) {
      const a = ln.trim().split(/[\s,;]+/);
      if (a.length >= 3) { const x = +a[0], y = +a[1], z = +a[2]; if (isFinite(x) && isFinite(y) && isFinite(z)) pts.push(x, y, z); }
    }
  }
  return finish(Float32Array.from(pts));
}

function finish(arr) {
  const n = arr.length / 3;
  if (n > MAX_POINTS) {
    const stride = Math.ceil(n / MAX_POINTS), out = new Float32Array(Math.floor(n / stride) * 3);
    for (let i = 0, k = 0; i + 2 < arr.length && k + 2 < out.length; i += 3 * stride, k += 3) { out[k] = arr[i]; out[k + 1] = arr[i + 1]; out[k + 2] = arr[i + 2]; }
    return { pts: out, n: out.length / 3, decimated: stride };
  }
  return { pts: arr, n, decimated: 1 };
}

function parsePLY(buffer) {
  const head = new TextDecoder('latin1').decode(new Uint8Array(buffer, 0, Math.min(buffer.byteLength, 20000)));
  const end = head.indexOf('end_header');
  if (end < 0) throw new Error('Not a PLY file');
  const nl = head.indexOf('\n', end);
  const header = head.slice(0, end).split(/\r?\n/);
  let format = 'ascii', count = 0, props = [], inVertex = false;
  for (const ln of header) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'format') format = t[1];
    else if (t[0] === 'element') { inVertex = t[1] === 'vertex'; if (inVertex) count = +t[2]; }
    else if (t[0] === 'property' && inVertex) props.push({ type: t[1], name: t[2] });
  }
  const ix = props.findIndex((p) => p.name === 'x'), iy = props.findIndex((p) => p.name === 'y'), iz = props.findIndex((p) => p.name === 'z');
  if (ix < 0 || iy < 0 || iz < 0 || !count) throw new Error('PLY has no vertex positions');
  const start = nl + 1;
  const stride = Math.max(1, Math.ceil(count / MAX_POINTS));
  const out = new Float32Array(Math.ceil(count / stride) * 3);
  let k = 0;
  if (format === 'ascii') {
    const lines = new TextDecoder().decode(new Uint8Array(buffer, start)).split('\n');
    for (let i = 0; i < count && i < lines.length; i += stride) {
      const a = lines[i].trim().split(/\s+/);
      out[k++] = +a[ix]; out[k++] = +a[iy]; out[k++] = +a[iz];
    }
  } else {
    const le = format === 'binary_little_endian';
    const dv = new DataView(buffer, start);
    const offs = []; let rec = 0;
    for (const p of props) { offs.push(rec); rec += SIZES[p.type] || 4; }
    const rd = (type, o) => {
      switch (type) {
        case 'float': case 'float32': return dv.getFloat32(o, le);
        case 'double': case 'float64': return dv.getFloat64(o, le);
        case 'int': case 'int32': return dv.getInt32(o, le);
        case 'uint': case 'uint32': return dv.getUint32(o, le);
        case 'short': case 'int16': return dv.getInt16(o, le);
        case 'ushort': case 'uint16': return dv.getUint16(o, le);
        case 'char': case 'int8': return dv.getInt8(o);
        default: return dv.getUint8(o);
      }
    };
    for (let i = 0; i < count; i += stride) {
      const b = i * rec;
      if (b + rec > dv.byteLength) break;
      out[k++] = rd(props[ix].type, b + offs[ix]); out[k++] = rd(props[iy].type, b + offs[iy]); out[k++] = rd(props[iz].type, b + offs[iz]);
    }
  }
  return { pts: out.subarray(0, k), n: k / 3, decimated: stride };
}

export function cloudInfo(cloud) {
  const p = cloud.pts, mn = [Infinity, Infinity, Infinity], mx = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i += 3) for (let a = 0; a < 3; a++) { const v = p[i + a]; if (v < mn[a]) mn[a] = v; if (v > mx[a]) mx[a] = v; }
  const range = mn.map((m, i) => mx[i] - m);
  const up = range[1] <= range[2] ? 'y' : 'z';
  const maxR = Math.max(...range);
  const units = maxR > 500 ? 'mm' : 'm';
  return { mn, mx, range, up, units };
}

/** Rasterise a horizontal slice to a transparent PNG. hMin/hMax are millimetres above the floor. */
export function rasterizeSlice(cloud, info, { up, mmPerUnit, hMin, hMax, cell }) {
  const p = cloud.pts, ua = up === 'y' ? 1 : 2;
  // floor = 2nd percentile of the vertical coordinate (sampled)
  const sample = [];
  const step = Math.max(1, Math.floor(cloud.n / 20000));
  for (let i = 0; i < cloud.n; i += step) sample.push(p[i * 3 + ua]);
  sample.sort((a, b) => a - b);
  const floor = sample[Math.floor(sample.length * 0.02)] ?? info.mn[ua];
  const lo = floor + hMin / mmPerUnit, hi = floor + hMax / mmPerUnit;
  const hv = (x, y, z) => (up === 'y' ? [x, z] : [x, -y]);
  // horizontal bounds of the slice
  let u0 = Infinity, v0 = Infinity, u1 = -Infinity, v1 = -Infinity, used = 0;
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i + ua]; if (h < lo || h > hi) continue;
    const [u, v] = hv(p[i], p[i + 1], p[i + 2]);
    if (u < u0) u0 = u; if (u > u1) u1 = u; if (v < v0) v0 = v; if (v > v1) v1 = v; used++;
  }
  if (!used) throw new Error('No points fall inside that height range. Adjust the slice heights or units.');
  const extMm = Math.max(u1 - u0, v1 - v0) * mmPerUnit;
  const c = cell || Math.max(15, Math.ceil(extMm / 2400));
  const W = Math.ceil(((u1 - u0) * mmPerUnit) / c) + 1, H = Math.ceil(((v1 - v0) * mmPerUnit) / c) + 1;
  const counts = new Uint16Array(W * H);
  for (let i = 0; i < p.length; i += 3) {
    const h = p[i + ua]; if (h < lo || h > hi) continue;
    const [u, v] = hv(p[i], p[i + 1], p[i + 2]);
    const cx = Math.floor(((u - u0) * mmPerUnit) / c), cy = Math.floor(((v - v0) * mmPerUnit) / c);
    const k = cy * W + cx; if (counts[k] < 65535) counts[k]++;
  }
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(W, H);
  // adaptive threshold so sparse scans still show structure
  const nz = []; for (let i = 0; i < counts.length; i += 7) if (counts[i]) nz.push(counts[i]);
  nz.sort((a, b) => a - b);
  const ref = nz[Math.floor(nz.length * 0.8)] || 1;
  for (let i = 0; i < counts.length; i++) {
    const n = counts[i]; if (!n) continue;
    const a = Math.min(255, 70 + 185 * Math.min(1, Math.log2(1 + n) / Math.log2(1 + ref)));
    img.data[i * 4] = 38; img.data[i * 4 + 1] = 54; img.data[i * 4 + 2] = 82; img.data[i * 4 + 3] = a;
  }
  ctx.putImageData(img, 0, 0);
  return { dataURL: cv.toDataURL('image/png'), canvas: cv, counts, W, H, ref, wMm: W * c, hMm: H * c, cell: c, x0: u0 * mmPerUnit, y0: v0 * mmPerUnit, used };
}

/** Find straight wall-like runs in a rasterised slice (Hough transform + least-squares refinement).
 *  Angles are snapped to the scan's own dominant wall direction so rooms scanned at any yaw come out square. */
export function traceLines(r, { minLen = 700, maxGap = 220 } = {}) {
  const { counts, W, H, cell: c } = r;
  const thr = Math.max(1, Math.floor(r.ref * 0.3));
  let pix = [];
  for (let i = 0; i < counts.length; i++) if (counts[i] >= thr) pix.push(i);
  const sub = Math.max(1, Math.ceil(pix.length / 120000));
  if (sub > 1) pix = pix.filter((_, i) => i % sub === 0);
  if (pix.length < 20) return [];
  const PX = new Float32Array(pix.length), PY = new Float32Array(pix.length), alive = new Uint8Array(pix.length).fill(1);
  pix.forEach((i, k) => { PX[k] = ((i % W) + 0.5) * c; PY[k] = (Math.floor(i / W) + 0.5) * c; });
  const NT = 180, binR = 50, diag = Math.hypot(W, H) * c, NR = Math.ceil((2 * diag) / binR) + 1;
  const cs = [], sn = [];
  for (let t = 0; t < NT; t++) { cs.push(Math.cos((t * Math.PI) / NT)); sn.push(Math.sin((t * Math.PI) / NT)); }
  const acc = new Float32Array(NT * NR);
  const vote = (k, w) => { for (let t = 0; t < NT; t++) acc[t * NR + Math.round((PX[k] * cs[t] + PY[k] * sn[t] + diag) / binR)] += w; };
  for (let k = 0; k < PX.length; k++) vote(k, sub);
  const minVotes = minLen / c;
  const out = [];
  let domAng = null;
  const near = (theta, rho, tol) => {
    const nx = Math.cos(theta), ny = Math.sin(theta), idx = [];
    for (let k = 0; k < PX.length; k++) if (alive[k] && Math.abs(PX[k] * nx + PY[k] * ny - rho) < tol) idx.push(k);
    return idx;
  };
  const fit = (idx) => {
    let mx = 0, my = 0; for (const k of idx) { mx += PX[k]; my += PY[k]; } mx /= idx.length; my /= idx.length;
    let sxx = 0, syy = 0, sxy = 0; for (const k of idx) { const dx = PX[k] - mx, dy = PY[k] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    const phi = 0.5 * Math.atan2(2 * sxy, sxx - syy);
    const theta = phi + Math.PI / 2;
    return { theta, rho: mx * Math.cos(theta) + my * Math.sin(theta) };
  };
  for (let it = 0; it < 70; it++) {
    let best = -1, bi = 0;
    for (let i = 0; i < acc.length; i++) if (acc[i] > best) { best = acc[i]; bi = i; }
    if (best < minVotes) break;
    let theta = ((Math.floor(bi / NR)) * Math.PI) / NT, rho = (bi % NR) * binR - diag;
    let idx = near(theta, rho, 80);
    for (let k = 0; k < 3 && idx.length > 8; k++) { ({ theta, rho } = fit(idx)); idx = near(theta, rho, 60); }
    if (idx.length * sub < minVotes * 0.8) { acc[bi] = 0; continue; }
    if (domAng === null) domAng = theta;
    // snap to the dominant wall grid when close
    const q = Math.round((theta - domAng) / (Math.PI / 2)), snapped = domAng + q * (Math.PI / 2);
    if (Math.abs(theta - snapped) < (4 * Math.PI) / 180) {
      theta = snapped;
      const nx = Math.cos(theta), ny = Math.sin(theta);
      let m = 0; for (const k of idx) m += PX[k] * nx + PY[k] * ny; rho = m / idx.length;
      idx = near(theta, rho, 60);
    }
    const dx = -Math.sin(theta), dy = Math.cos(theta), nx = Math.cos(theta), ny = Math.sin(theta);
    const pts = idx.map((k) => ({ k, s: PX[k] * dx + PY[k] * dy })).sort((a, b) => a.s - b.s);
    let start = 0;
    const flush = (end) => {
      const s0 = pts[start].s, s1 = pts[end].s;
      if (s1 - s0 >= minLen && (end - start + 1) * sub >= (s1 - s0) / c / 3) out.push({ x1: nx * rho + dx * s0, y1: ny * rho + dy * s0, x2: nx * rho + dx * s1, y2: ny * rho + dy * s1 });
    };
    for (let i = 1; i < pts.length; i++) if (pts[i].s - pts[i - 1].s > maxGap) { flush(i - 1); start = i; }
    if (pts.length) flush(pts.length - 1);
    for (const { k } of pts) { alive[k] = 0; vote(k, -sub); }
    for (let i = 0; i < acc.length; i++) if (acc[i] < 0) acc[i] = 0;
  }
  return out;
}
