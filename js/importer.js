// Import dialog: DXF / SVG / PDF / images / RoomPlan JSON / point clouds -> reference layers and editable walls.

import { store, DEFAULTS } from './store.js';
import { units, fmtLen, parseLen } from './units.js';
import { el, toast, openModal } from './dom.js';
import { parseDXF } from './import/dxf.js';
import { parseSVG } from './import/svg.js';
import { parseRoomPlan, looksLikeRoomPlan } from './import/roomplan.js';
import { parseCloud, cloudInfo, rasterizeSlice, traceLines } from './import/pointcloud.js';
import { imageFileToData, openPdf, renderPdfPage } from './import/raster.js';
import { toMM, segmentsToWalls, cleanupWalls, bridgeGaps, guessUnits, MM_PER } from './import/convert.js';
import { normalizeWalls, facesFor, wallsOnLevel } from './walls.js';
import { SCALES } from './sheet.js';
import { labelPoint } from './render2d.js';
import { byId } from './library.js';
import * as G from './geom.js';

const ACCEPT = '.dxf,.svg,.pdf,.png,.jpg,.jpeg,.webp,.json,.ply,.xyz,.pts,.obj,.txt,.csv';
const row = (label, node, hint) => el('div', { class: 'field' }, el('label', {}, label), el('div', {}, node, hint ? el('div', { class: 'note', style: 'font-size:11.5px;color:#6b7380;margin-top:2px' }, hint) : null));
const chk = (text, checked, onchange) => { const c = el('input', { type: 'checkbox', checked }); c.onchange = () => onchange?.(c.checked); const l = el('label', { class: 'chk', style: 'margin:3px 0' }, c, text); l.input = c; return l; };
const select = (opts, value, onchange) => { const s = el('select', {}, Object.entries(opts).map(([k, v]) => el('option', { value: k, selected: String(k) === String(value) }, v))); s.onchange = () => onchange?.(s.value); return s; };
const fmtBytes = (n) => (n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB');

export const IMPORT_ACCEPT = ACCEPT;

export function openImport(editor, file) {
  const ctx = { editor, close: () => {} };
  if (file) handleFile(ctx, file); else chooseStep(ctx);
}

// ---------------------------------------------------------------------------
function chooseStep(ctx) {
  const input = el('input', { type: 'file', accept: ACCEPT, hidden: true });
  input.onchange = () => input.files[0] && handleFile(ctx, input.files[0]);
  const drop = el('div', { class: 'dropzone' }, el('div', { style: 'font-size:15px;font-weight:600' }, 'Drop a file here'), el('div', { style: 'color:#6b7380;margin:4px 0 12px' }, 'or'), el('button', { class: 'primary', onclick: () => input.click() }, 'Choose file…'));
  drop.ondragover = (e) => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = (e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(ctx, f); };
  const li = (a, b) => el('li', {}, el('b', {}, a), ' — ', b);
  ctx.close = openModal('Import a plan, scan or drawing', el('div', {},
    drop, input,
    el('div', { style: 'margin-top:14px;color:#3d4450;line-height:1.5' },
      el('ul', { style: 'margin:0;padding-left:18px' },
        li('DXF, SVG', 'CAD, MagicPlan and most plan software. Convert double-line walls to editable walls; keep the linework as a tracing guide; bring in dimensions and text.'),
        li('PDF, JPG, PNG', 'scanned plans, photos, floor-plan PDFs. Placed as a tracing underlay you calibrate with one known distance.'),
        li('RoomPlan JSON', 'LiDAR scans from iPhone/iPad apps (Polycam, Scaniverse, Canvas…). Walls, doors, windows and furniture arrive editable.'),
        li('PLY, OBJ, XYZ, PTS', 'LiDAR point clouds / meshes. A horizontal slice becomes a floor-plan underlay to trace.'),
      ),
      el('div', { style: 'margin-top:10px;color:#6b7380;font-size:12px' }, 'DWG (Autodesk) and IFC are not read directly yet — export DXF from your CAD program (or convert with the free ODA File Converter) first.'))));
}

async function handleFile(ctx, file) {
  const ext = file.name.split('.').pop().toLowerCase();
  const wait = (msg) => { ctx.close = openModal('Import', el('div', { style: 'padding:30px;text-align:center;color:#6b7380' }, msg)); };
  try {
    if (ext === 'dxf') { wait('Reading DXF…'); const d = parseDXF(await file.text()); if (!d.segs.length) throw new Error('No lines were found in that DXF (it may use only unsupported entities such as 3D solids or splines).'); drawingStep(ctx, d, file.name, 'DXF'); }
    else if (ext === 'svg') { wait('Reading SVG…'); drawingStep(ctx, parseSVG(await file.text()), file.name, 'SVG'); }
    else if (ext === 'json') {
      const j = JSON.parse(await file.text());
      if (j.app === 'archplan') { if (confirm('This is a saved Plan file. Open it (replaces the current plan)?')) { store.load(j); store.autosave(); ctx.editor.fit(); ctx.close(); } else chooseStep(ctx); }
      else if (looksLikeRoomPlan(j)) roomPlanStep(ctx, j, file.name);
      else throw new Error('That JSON file is not a RoomPlan scan or a Plan file.');
    }
    else if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'].includes(ext)) { wait('Reading image…'); imageStep(ctx, await imageFileToData(file), file.name); }
    else if (ext === 'pdf') { wait('Opening PDF…'); pdfStep(ctx, await openPdf(file), file.name); }
    else if (['ply', 'xyz', 'pts', 'obj', 'txt', 'csv'].includes(ext)) { wait(`Reading ${fmtBytes(file.size)} of point data…`); await new Promise((r) => setTimeout(r, 30)); cloudStep(ctx, parseCloud(await file.arrayBuffer(), ext), file.name); }
    else if (ext === 'dwg') throw new Error('DWG is Autodesk\'s closed format. In AutoCAD/BricsCAD use Save As → DXF, or convert it with the free ODA File Converter, then import the DXF.');
    else if (['ifc', 'usdz', 'usdc', 'e57', 'las', 'laz', 'rvt', 'skp'].includes(ext)) throw new Error(`.${ext} files are not supported yet. Export a DXF (plan), PLY/OBJ (scan or model) or RoomPlan JSON from the source app instead.`);
    else throw new Error(`Unrecognised file type “.${ext}”.`);
  } catch (err) {
    console.error(err);
    ctx.close = openModal('Could not import', el('div', {}, el('p', { style: 'margin:0 0 12px' }, err.message || String(err))), [el('button', { class: 'btn', onclick: () => chooseStep(ctx) }, 'Try another file')]);
  }
}

function finish(ctx, msg) {
  ctx.close();
  ctx.editor.setTool('select');
  ctx.editor.fit();
  toast(msg, 4500);
}

function addRef(props) {
  return store.add('ref', { discipline: 'ref', locked: true, opacity: 0.6, x: 0, y: 0, rot: 0, scale: 1, ...props });
}

// ---------------------------------------------------------------------------
// DXF / SVG
// ---------------------------------------------------------------------------
function drawingStep(ctx, d, fileName, kind) {
  const layerCount = new Map();
  for (const s of d.segs) layerCount.set(s.layer, (layerCount.get(s.layer) || 0) + 1);
  const guess = guessUnits(d, units.system === 'imperial');
  const unitOpts = { mm: 'Millimetres', cm: 'Centimetres', m: 'Metres', in: 'Inches', ft: 'Feet' };
  if (d.svgMmPerUnit) { MM_PER.file = d.svgMmPerUnit; unitOpts.file = `As sized in the file (${d.svgMmPerUnit.toFixed(3)} mm / unit)`; }
  if (kind === 'SVG') unitOpts.px = 'Pixels (96 per inch)';
  let unit = kind === 'SVG' ? (d.svgMmPerUnit ? 'file' : 'px') : guess;
  const skip = /dim|text|anno|hatch|grid|axis|defpoints|furn|door|window|sym|elec|plumb|light|title|note|label|dimension/i;
  const wallish = /wall|mur|wand|muro|parede|a-wall|exterior|interior|partition/i;
  const names = [...layerCount.keys()];
  let selected = new Set(names.filter((n) => wallish.test(n)));
  if (!selected.size) selected = new Set(names.filter((n) => !skip.test(n)));
  if (!selected.size) selected = new Set(names);

  const o = { keepRef: true, convert: true, bridge: true, rooms: true, dims: d.dims.length > 0, texts: false, thickness: DEFAULTS.intThickness, mode: 'double' };
  const sizeNote = el('div', { class: 'note', style: 'color:#3d4450;font-weight:600' });
  const preview = el('canvas', { width: 520, height: 400, style: 'width:100%;background:#fff;border:1px solid var(--line);border-radius:8px' });
  const modeNote = el('div', { class: 'note' });

  const refresh = () => {
    const mm = MM_PER[unit];
    const xs = d.segs.flatMap((s) => [s.x1, s.x2]), ys = d.segs.flatMap((s) => [s.y1, s.y2]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    sizeNote.textContent = `Overall size: ${fmtLen((x1 - x0) * mm)} × ${fmtLen((y1 - y0) * mm)}`;
    const c = preview.getContext('2d'), W = preview.width, H = preview.height;
    c.clearRect(0, 0, W, H);
    const k = Math.min((W - 20) / Math.max(x1 - x0, 1e-9), (H - 20) / Math.max(y1 - y0, 1e-9));
    const X = (x) => 10 + (x - x0) * k, Y = (y) => (d.yDown ? 10 + (y - y0) * k : H - 10 - (y - y0) * k);
    const draw = (on, color) => { c.strokeStyle = color; c.lineWidth = on ? 1.4 : 1; c.beginPath(); const step = Math.max(1, Math.floor(d.segs.length / 30000)); for (let i = 0; i < d.segs.length; i += step) { const s = d.segs[i]; if (selected.has(s.layer) === on) { c.moveTo(X(s.x1), Y(s.y1)); c.lineTo(X(s.x2), Y(s.y2)); } } c.stroke(); };
    draw(false, '#c3cad4'); draw(true, '#2f6df6');
  };

  const layerBox = el('div', { style: 'max-height:170px;overflow:auto;border:1px solid var(--line);border-radius:8px;padding:4px 8px' });
  for (const n of names) {
    const l = chk(`${n}  (${layerCount.get(n)})`, selected.has(n), (v) => { v ? selected.add(n) : selected.delete(n); refresh(); });
    layerBox.append(l);
  }
  const unitSel = select(unitOpts, unit, (v) => { unit = v; refresh(); });
  const modeSel = select({ double: 'Double lines (wall outlines) → centre-line walls', single: 'Single lines are wall centre-lines' }, o.mode, (v) => (o.mode = v));
  const thick = el('input', { type: 'text', value: fmtLen(o.thickness, { precision: 16 }), style: 'width:80px' });
  thick.onchange = () => { const v = parseLen(thick.value); if (v > 0) o.thickness = v; thick.value = fmtLen(o.thickness, { precision: 16 }); };
  // auto-pick wall style by trying the double-line detector on the preselected layers
  try {
    const t = toMM(d, MM_PER[unit]);
    const probe = segmentsToWalls(t.segs.filter((s) => selected.has(s.layer)), { mode: 'double' });
    o.mode = probe.length >= 3 ? 'double' : 'single'; modeSel.value = o.mode;
    modeNote.textContent = probe.length >= 3 ? `Detected double-line walls (${probe.length} wall runs found).` : 'No double-line walls detected — treating lines as centre-lines.';
  } catch { /* ignore */ }

  const controls = el('div', { class: 'controls' },
    el('div', { class: 'note', style: 'color:#6b7380' }, `${fileName} · ${d.segs.length.toLocaleString()} lines`),
    row('Units', unitSel), sizeNote,
    el('div', { style: 'font-size:11px;font-weight:700;letter-spacing:.5px;color:#6b7380;margin-top:6px' }, 'LAYERS TO USE AS WALLS'), layerBox,
    chk('Keep all linework as a tracing guide', o.keepRef, (v) => (o.keepRef = v)),
    chk('Convert selected layers to walls', o.convert, (v) => (o.convert = v)),
    row('Wall style', modeSel), row('Thickness', thick, 'Used for single lines'), modeNote,
    chk('Turn doorway-sized gaps into openings', o.bridge, (v) => (o.bridge = v)),
    chk('Create rooms from closed walls', o.rooms, (v) => (o.rooms = v)),
    chk(`Import dimensions (${d.dims.length})`, o.dims, (v) => (o.dims = v)),
    chk(`Import text as notes (${d.texts.length})`, o.texts, (v) => (o.texts = v)),
  );
  const body = el('div', { class: 'sheetdlg', style: 'grid-template-columns:340px 1fr' }, controls, el('div', {}, preview));
  ctx.close = openModal(`Import ${kind}`, body, [
    el('button', { class: 'btn', onclick: () => chooseStep(ctx) }, 'Back'),
    el('button', { class: 'primary', onclick: () => runDrawing(ctx, d, MM_PER[unit], selected, o, fileName) }, 'Import'),
  ]);
  refresh();
}

function runDrawing(ctx, d, mmPer, selected, o, fileName) {
  const mm = toMM(d, mmPer);
  const lv = store.level;
  const c = { walls: 0, openings: 0, dims: 0, texts: 0, rooms: 0 };
  store.checkpoint();
  if (o.keepRef) {
    const flat = []; for (const s of mm.segs) flat.push(+s.x1.toFixed(1), +s.y1.toFixed(1), +s.x2.toFixed(1), +s.y2.toFixed(1));
    addRef({ kind: 'lines', name: fileName, segs: flat, bbox: [0, 0, mm.size.w, mm.size.h], opacity: 0.9 });
  }
  if (o.convert) {
    const sel = mm.segs.filter((s) => selected.has(s.layer));
    let walls = cleanupWalls(segmentsToWalls(sel, { mode: o.mode, thickness: o.thickness }), 150);
    const bridges = o.bridge ? bridgeGaps(walls) : [];
    for (const w of walls) { store.add('wall', { discipline: 'arch', a: w.a, b: w.b, thickness: Math.round(w.thickness), kind: w.thickness >= 150 ? 'exterior' : 'interior', height: lv.height, structural: false }); c.walls++; }
    for (const b of bridges) {
      const w = store.add('wall', { discipline: 'arch', a: b.wall.a, b: b.wall.b, thickness: Math.round(b.wall.thickness), kind: 'interior', height: lv.height, structural: false });
      store.add('opening', { discipline: 'arch', wallId: w.id, kind: 'door', style: b.opening.style, pos: b.opening.pos, width: b.opening.width, height: DEFAULTS.doorHeight, sill: 0, side: 1, hinge: 'a' });
      c.walls++; c.openings++;
    }
    normalizeWalls(store, lv.id);
    if (o.rooms) c.rooms = makeRooms(lv.id);
  }
  if (o.dims) for (const m of mm.dims) { store.add('dim', { discipline: 'annot', a: m.a, b: m.b, off: Math.round(m.off) }); c.dims++; }
  if (o.texts) for (const t of mm.texts.slice(0, 300)) { store.add('text', { discipline: 'annot', x: t.x, y: t.y, text: t.text, size: G.clamp(t.h || 160, 80, 600) }); c.texts++; }
  store.commit();
  finish(ctx, `Imported ${c.walls} walls, ${c.openings} openings, ${c.rooms} rooms, ${c.dims} dimensions. Use Undo to revert.`);
}

function makeRooms(levelId) {
  let n = 0;
  const existing = store.list('room', levelId);
  for (const f of facesFor(store, levelId)) {
    if (existing.some((r) => G.pointInPoly(r.seed, f.pts))) continue;
    store.add('room', { discipline: 'arch', seed: labelPoint(f.inner), name: 'Room', floor: 'wood', showArea: true }); n++;
  }
  return n;
}

// ---------------------------------------------------------------------------
// Images & PDF
// ---------------------------------------------------------------------------
function imageStep(ctx, img, fileName, pdf) {
  const known = el('input', { type: 'text', placeholder: units.system === 'imperial' ? `e.g. 40'` : 'e.g. 12 m', style: 'width:110px' });
  const blend = chk('Treat white as transparent (best for drawings)', true);
  const prev = el('img', { src: img.dataURL, style: 'max-width:100%;max-height:380px;border:1px solid var(--line);border-radius:8px;background:#fff' });
  const scaleSel = pdf ? select({ calib: 'Not sure — I\'ll calibrate', ...Object.fromEntries(SCALES[units.system].map((s) => ['r' + s.ratio, s.label])) }, 'calib') : null;
  const controls = el('div', { class: 'controls' },
    el('div', { class: 'note', style: 'color:#6b7380' }, `${fileName} · ${img.w}×${img.h}px`),
    pdf ? row('Drawing scale', scaleSel, 'If the PDF was printed to scale, pick it for exact dimensions.') : null,
    !pdf || true ? row('Known width', known, 'Optional: real-world width of the whole image. Otherwise you\'ll click two points of a known distance next.') : null,
    blend,
  );
  ctx.close = openModal(pdf ? 'Import PDF page' : 'Import image', el('div', { class: 'sheetdlg', style: 'grid-template-columns:340px 1fr' }, controls, el('div', { style: 'text-align:center' }, prev)), [
    el('button', { class: 'btn', onclick: () => chooseStep(ctx) }, 'Back'),
    el('button', { class: 'primary', onclick: () => {
      let mmPerPx = 10, calibrate = true;
      const kw = parseLen(known.value);
      if (kw > 0) { mmPerPx = kw / img.w; calibrate = false; }
      else if (pdf && scaleSel.value !== 'calib') { mmPerPx = ((pdf.wPt * 25.4) / 72 * +scaleSel.value.slice(1)) / img.w; calibrate = false; }
      else if (pdf) mmPerPx = ((pdf.wPt * 25.4) / 72 * 48) / img.w;
      store.checkpoint();
      const ref = addRef({ kind: 'image', name: fileName, src: img.dataURL, w: img.w * mmPerPx, h: img.h * mmPerPx, blend: blend.input.checked, opacity: 0.6 });
      store.commit();
      finish(ctx, calibrate ? 'Image placed. Now click two points of a known distance to set the scale.' : 'Image placed to scale. Trace over it with the wall tool.');
      if (calibrate) ctx.editor.startCalibrate('scale', ref.id);
    } }, 'Place on plan'),
  ]);
}

async function pdfStep(ctx, doc, fileName) {
  let page = 1;
  const render = async (n) => {
    const r = await renderPdfPage(doc, n);
    imageStep(ctx, r, `${fileName} — page ${n}/${doc.numPages}`, r);
    if (doc.numPages > 1) {
      const pg = select(Object.fromEntries(Array.from({ length: doc.numPages }, (_, i) => [i + 1, `Page ${i + 1}`])), n, (v) => render(+v));
      document.querySelector('.sheetdlg .controls')?.prepend(row('Page', pg));
    }
  };
  await render(page);
}

// ---------------------------------------------------------------------------
// Point cloud
// ---------------------------------------------------------------------------
function cloudStep(ctx, cloud, fileName) {
  if (!cloud.n) throw new Error('No points were found in that file.');
  const info = cloudInfo(cloud);
  const o = { up: info.up, units: info.units, hMin: 500, hMax: 2000, trace: true };
  const prev = el('canvas', { style: 'max-width:100%;max-height:420px;background:#fff;border:1px solid var(--line);border-radius:8px' });
  const msg = el('div', { class: 'note', style: 'color:#6b7380' });
  let result = null, timer;
  const update = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        result = rasterizeSlice(cloud, info, { up: o.up, mmPerUnit: MM_PER[o.units], hMin: o.hMin, hMax: o.hMax });
        prev.width = result.canvas.width; prev.height = result.canvas.height;
        const c = prev.getContext('2d'); c.fillStyle = '#fff'; c.fillRect(0, 0, prev.width, prev.height); c.drawImage(result.canvas, 0, 0);
        msg.textContent = `Plan size ${fmtLen(result.wMm)} × ${fmtLen(result.hMm)} · ${result.used.toLocaleString()} points in slice`; msg.style.color = '#3d4450';
      } catch (err) { result = null; msg.textContent = err.message; msg.style.color = '#e5484d'; }
    }, 120);
  };
  const lenIn = (v, cb) => { const i = el('input', { type: 'text', value: fmtLen(v), style: 'width:90px' }); i.onchange = () => { const p = parseLen(i.value); if (p != null && p >= 0) cb(p); i.value = fmtLen(p ?? v); update(); }; return i; };
  const controls = el('div', { class: 'controls' },
    el('div', { class: 'note', style: 'color:#6b7380' }, `${fileName} · ${cloud.n.toLocaleString()} points${cloud.decimated > 1 ? ` (sampled 1 in ${cloud.decimated})` : ''}`),
    row('Up axis', select({ y: 'Y is up (ARKit / most scanners)', z: 'Z is up (CAD / surveying)' }, o.up, (v) => { o.up = v; update(); })),
    row('File units', select({ mm: 'Millimetres', m: 'Metres', ft: 'Feet' }, o.units, (v) => { o.units = v; update(); })),
    row('Slice from', lenIn(o.hMin, (v) => (o.hMin = v)), 'Height above the floor. Keep it above furniture…'),
    row('Slice to', lenIn(o.hMax, (v) => (o.hMax = v)), '…and below the ceiling.'),
    chk('Also trace straight walls automatically', true, (v) => (o.trace = v)),
    msg,
  );
  ctx.close = openModal('Import point cloud / scan', el('div', { class: 'sheetdlg', style: 'grid-template-columns:340px 1fr' }, controls, el('div', { style: 'text-align:center' }, prev)), [
    el('button', { class: 'btn', onclick: () => chooseStep(ctx) }, 'Back'),
    el('button', { class: 'primary', onclick: () => {
      if (!result) return;
      store.checkpoint();
      addRef({ kind: 'image', name: `${fileName} (slice)`, src: result.dataURL, w: result.wMm, h: result.hMm, blend: false, opacity: 0.85, locked: true });
      let nW = 0;
      if (o.trace) {
        const lv = store.level;
        const segs = traceLines(result);
        let walls = cleanupWalls(segmentsToWalls(segs, { mode: 'single', thickness: DEFAULTS.intThickness }), 300);
        for (const w of walls) { store.add('wall', { discipline: 'arch', a: w.a, b: w.b, thickness: DEFAULTS.intThickness, kind: 'interior', height: lv.height, structural: false }); nW++; }
        for (const b of bridgeGaps(walls)) {
          const bw = store.add('wall', { discipline: 'arch', a: b.wall.a, b: b.wall.b, thickness: DEFAULTS.intThickness, kind: 'interior', height: lv.height, structural: false });
          store.add('opening', { discipline: 'arch', wallId: bw.id, kind: 'door', style: b.opening.style, pos: b.opening.pos, width: b.opening.width, height: DEFAULTS.doorHeight, sill: 0, side: 1, hinge: 'a' });
          nW++;
        }
        normalizeWalls(store, lv.id);
        if (nW) makeRooms(lv.id);
      }
      store.commit();
      finish(ctx, nW ? `Scan placed to scale and ${nW} walls traced automatically. Check them against the scan, then adjust.` : 'Scan slice placed to scale. Trace over it with the wall tool.');
    } }, 'Place on plan'),
  ]);
  update();
}

// ---------------------------------------------------------------------------
// RoomPlan JSON
// ---------------------------------------------------------------------------
function roomPlanStep(ctx, json, fileName) {
  const rp = parseRoomPlan(json);
  if (!rp.walls.length) throw new Error('That scan has no walls.');
  const o = { rooms: true, furn: true, newLevel: false };
  const controls = el('div', { class: 'controls' },
    el('div', { class: 'note', style: 'color:#6b7380' }, fileName),
    el('div', { style: 'font-weight:600' }, `${rp.walls.length} walls · ${rp.openings.length} doors/windows/openings · ${rp.objects.length} recognised objects`),
    chk('Create rooms from closed walls', true, (v) => (o.rooms = v)),
    chk('Import furniture & fixtures', true, (v) => (o.furn = v)),
    chk('Put on a new level', false, (v) => (o.newLevel = v)),
    el('div', { class: 'note', style: 'color:#6b7380;margin-top:6px' }, 'Scanned walls are cleaned up so corners meet. Measurements come straight from the LiDAR scan.'),
  );
  ctx.close = openModal('Import LiDAR scan (RoomPlan)', controls, [
    el('button', { class: 'btn', onclick: () => chooseStep(ctx) }, 'Back'),
    el('button', { class: 'primary', onclick: () => runRoomPlan(ctx, rp, o) }, 'Import'),
  ]);
}

function runRoomPlan(ctx, rp, o) {
  store.checkpoint();
  if (o.newLevel) store.addLevel();
  const lv = store.level;
  let walls = rp.walls.map((w) => ({ ...w, thickness: w.thickness || DEFAULTS.intThickness }));
  walls = cleanupWalls(walls, 250);
  const ents = walls.map((w) => store.add('wall', { discipline: 'arch', a: w.a, b: w.b, thickness: Math.round(w.thickness), kind: 'interior', height: lv.height, structural: false }));
  // outer boundary -> exterior walls: any wall that is on the convex hull side is hard to know; keep interior, user can switch.
  normalizeWalls(store, lv.id);
  let nOp = 0;
  for (const op of rp.openings) {
    let best = null;
    for (const w of wallsOnLevel(store, lv.id)) { const c = G.closestOnSeg(op, w.a, w.b); if (!best || c.d < best.d) best = { w, ...c }; }
    if (!best || best.d > 600) continue;
    store.add('opening', { discipline: 'arch', kind: op.kind, style: op.style, wallId: best.w.id, pos: best.s, width: Math.max(300, op.width), height: Math.max(500, op.height), sill: op.kind === 'window' ? Math.round(op.sill) : 0, side: 1, hinge: 'a' });
    nOp++;
  }
  let nF = 0;
  if (o.furn) for (const f of rp.objects) { if (!byId[f.lib]) continue; store.add('furniture', { discipline: 'furn', lib: f.lib, x: f.x, y: f.y, rot: f.rot, w: f.w, d: f.d, h: f.h }); nF++; }
  const nR = o.rooms ? makeRooms(lv.id) : 0;
  store.commit();
  finish(ctx, `Imported ${ents.length} walls, ${nOp} openings, ${nF} furniture items, ${nR} rooms from the scan.`);
}
