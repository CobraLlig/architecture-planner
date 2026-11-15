// Panels, toolbars and dialogs around the canvas.

import { store, DEFAULTS } from './store.js';
import { fmtLen, parseLen, fmtArea, units, setSystem, FT } from './units.js';
import { LIB, CATEGORIES, byId, drawSymbol, FLOORS, ROOM_PRESETS, DOOR_STYLES, WINDOW_STYLES } from './library.js';
import { roomGeom } from './render2d.js';
import { buildSheet, printSvg, downloadText, PAPERS, SCALES } from './sheet.js';
import { wallsOnLevel } from './walls.js';
import { buildSample } from './sample.js';
import * as G from './geom.js';
import { $, el, toast, openModal } from './dom.js';
import { openImport } from './importer.js';
export { toast };

const ICONS = {
  select: '<path d="M5 3l14 7-6 2-2 6z" />',
  wall: '<path d="M3 17 17 3l4 4L7 21z"/><path d="M12 8l4 4" />',
  door: '<path d="M4 20V4M4 20h16M4 20A16 16 0 0 1 20 4" /><path d="M4 4h5" />',
  window: '<rect x="3" y="7" width="18" height="10" rx="1"/><path d="M12 7v10M3 12h18"/>',
  room: '<path d="M4 5h16v14H4z" stroke-dasharray="3 3"/><path d="M9 12h6M12 9v6"/>',
  dim: '<path d="M3 17h18M3 13v8M21 13v8"/><path d="M8 11l8-4"/>',
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
};
const TOOLS = [
  { id: 'select', name: 'Select', key: 'V' }, { id: 'wall', name: 'Wall', key: 'W' }, { id: 'door', name: 'Door', key: 'D' },
  { id: 'window', name: 'Window', key: 'N' }, { id: 'room', name: 'Room', key: 'A' }, { id: 'dim', name: 'Measure', key: 'M' }, { id: 'text', name: 'Note', key: 'T' },
];

export function initUI({ editor, view3d, setViewMode }) {
  buildTools(editor);
  buildLibrary(editor);
  const refreshAll = () => { renderProps(editor); renderLevels(editor); renderLevelProps(editor); renderLayers(editor); renderRefs(editor); syncHeader(editor); };

  // ---- header controls
  $('#undo').onclick = () => store.undo();
  $('#redo').onclick = () => store.redo();
  $('#projname').onchange = (e) => { store.act(() => (store.project.name = e.target.value.trim() || 'Untitled Plan')); };
  $('#unitsel').onchange = (e) => { store.act(() => { store.project.units = e.target.value; setSystem(e.target.value); }); editor.requestRender(); refreshAll(); renderOptions(editor); };
  $('#snap').onchange = (e) => (editor.snapOn = e.target.checked);
  $('#grid').onchange = (e) => { editor.gridOn = e.target.checked; editor.requestRender(); };
  $('#btn-new').onclick = () => { if (confirm('Start a new plan? Unsaved changes will be lost (Save first to keep them).')) { store.newProject(); editor.fit(); } };
  $('#btn-open').onclick = () => $('#fileinput').click();
  $('#fileinput').onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { store.load(JSON.parse(await f.text())); store.autosave(); editor.fit(); toast(`Opened ${f.name}`); } catch { toast('That file could not be read as a plan.'); }
    e.target.value = '';
  };
  $('#btn-save').onclick = () => { downloadText(`${store.project.name.replace(/[^\w\- ]+/g, '').trim() || 'plan'}.archplan.json`, store.toFileText(), 'application/json'); toast('Plan saved to your downloads'); };
  $('#btn-sheet').onclick = () => openSheetDialog(editor);
  $('#btn-import').onclick = () => openImport(editor);
  editor.on('toast', (m) => toast(m, 5000));
  store.onSaveError = () => toast('Autosave is full (large imports). Use Save to keep your work as a file.', 6000);
  $('#btn-help').onclick = () => openHelp();
  $('#zin').onclick = () => editor.zoomAt(editor.w / 2, editor.h / 2, 1.3);
  $('#zout').onclick = () => editor.zoomAt(editor.w / 2, editor.h / 2, 1 / 1.3);
  $('#zfit').onclick = () => editor.fit();
  document.querySelectorAll('#viewmode button').forEach((b) => (b.onclick = () => setViewMode(b.dataset.v)));

  // 3D controls
  $('#c3fit').onclick = () => view3d.fit();
  $('#c3roof').onchange = (e) => { view3d.opts.roof = e.target.checked; view3d.update(); };
  $('#c3cut').onchange = (e) => { view3d.opts.upTo = e.target.checked ? 'active' : 'all'; view3d.update(); };
  $('#c3sun').oninput = (e) => view3d.setSun(+e.target.value, view3d.opts.sunEl);
  $('#c3png').onclick = () => {
    const url = view3d.capture(2);
    const a = el('a', { href: url, download: `${store.project.name || 'plan'}-3d.png` }); document.body.append(a); a.click(); a.remove();
    toast('Image saved to your downloads');
  };

  // editor -> ui
  editor.on('tool', (t) => { document.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.t === t)); renderOptions(editor); if (t !== 'furniture') document.querySelectorAll('.libitem').forEach((b) => b.classList.remove('on')); });
  editor.on('hint', (h) => ($('#hint').textContent = h));
  editor.on('selection', () => { renderProps(editor); renderOptions(editor); });
  editor.on('selection-props', () => syncPropValues());
  editor.on('cursor', (p) => { $('#coords').textContent = `x ${fmtLen(p.x)}   y ${fmtLen(p.y)}`; });
  editor.on('view', () => ($('#zoomread').textContent = `${Math.round((editor.view.s / 0.09) * 100)}%`));
  editor.on('room-added', (r) => { editor.setTool('select'); editor.setSelection([r.id]); setTimeout(() => $('#props [data-focus]')?.select(), 30); });
  editor.on('focus-name', () => $('#props [data-focus]')?.select());
  store.subscribe((kind) => { refreshAll(); $('#undo').disabled = !store.undoStack.length; $('#redo').disabled = !store.redoStack.length; });
  $('#hint').textContent = editor.hint();
  refreshAll(); renderOptions(editor);
  $('#undo').disabled = true; $('#redo').disabled = true;
  editor.emit('view');
  return { refreshAll };
}

function syncHeader(editor) {
  $('#projname').value = store.project.name;
  $('#unitsel').value = store.project.units;
}

// ---- tool rail ---------------------------------------------------------------
function buildTools(editor) {
  const nav = $('#tools');
  TOOLS.forEach((t, i) => {
    if (i === 1) nav.append(el('div', { class: 'tsep' }));
    const b = el('button', { class: 'tool' + (t.id === 'select' ? ' on' : ''), 'data-t': t.id, title: `${t.name} (${t.key})`, tabindex: '-1' });
    b.innerHTML = `<svg viewBox="0 0 24 24">${ICONS[t.id]}</svg><span>${t.name}</span>`;
    b.onmousedown = (e) => e.preventDefault();
    b.onclick = () => editor.setTool(t.id);
    nav.append(b);
  });
}

// ---- furniture library ---------------------------------------------------------
function buildLibrary(editor) {
  const list = $('#liblist');
  const draw = () => {
    const q = $('#libsearch').value.trim().toLowerCase();
    list.innerHTML = '';
    for (const cat of CATEGORIES) {
      const items = LIB.filter((i) => i.cat === cat && (!q || i.name.toLowerCase().includes(q) || cat.toLowerCase().includes(q)));
      if (!items.length) continue;
      list.append(el('div', { class: 'libcat' }, cat));
      const grid = el('div', { class: 'libgrid' });
      for (const it of items) {
        const cv = el('canvas', { width: 156, height: 104 });
        const c = cv.getContext('2d');
        const s = Math.min(138 / it.w, 88 / it.d);
        c.translate(78, 52); c.scale(s, s);
        drawSymbol(c, it, it.w, it.d, 1.1 / s, {});
        const b = el('button', { class: 'libitem', title: `${it.name} — ${fmtLen(it.w)} × ${fmtLen(it.d)}`, 'data-id': it.id, tabindex: '-1' }, cv, el('span', {}, it.name));
        b.onmousedown = (e) => e.preventDefault();
        b.onclick = () => { editor.setTool('furniture', it.id); document.querySelectorAll('.libitem').forEach((x) => x.classList.toggle('on', x === b)); };
        grid.append(b);
      }
      list.append(grid);
    }
  };
  $('#libsearch').oninput = draw;
  draw();
  store.subscribe((k) => { if (k === 'restore') draw(); });
}

// ---- options bar -------------------------------------------------------------
function lenField(value, onCommit, w = 78) {
  const i = el('input', { type: 'text', value: fmtLen(value, { precision: 16 }), style: `width:${w}px`, spellcheck: 'false' });
  i.onchange = () => { const v = parseLen(i.value); if (v && v > 0) onCommit(v); i.value = fmtLen(v && v > 0 ? v : value, { precision: 16 }); };
  i.onfocus = () => i.select();
  return i;
}
const sel = (opts, value, onChange) => {
  const s = el('select', {}, Object.entries(opts).map(([k, v]) => el('option', { value: k, selected: k === value }, v)));
  s.onchange = () => onChange(s.value);
  return s;
};

export function renderOptions(editor) {
  const bar = $('#optionsbar');
  const o = editor.opts, t = editor.tool;
  bar.innerHTML = '';
  const lab = (text, node) => el('label', {}, text, node);
  const sep = () => el('div', { class: 'sep' });
  if (t === 'wall') {
    bar.append(lab('Wall type', sel({ exterior: 'Exterior', interior: 'Interior' }, o.wallKind, (v) => { o.wallKind = v; o.thickness = null; renderOptions(editor); })));
    const def = o.wallKind === 'exterior' ? DEFAULTS.extThickness : DEFAULTS.intThickness;
    bar.append(lab('Thickness', lenField(o.thickness || def, (v) => (o.thickness = v), 70)));
    bar.append(sep(), el('span', { class: 'note' }, 'Tip: while drawing, just type a length like 12\'6 and press Enter.'));
  } else if (t === 'door') {
    bar.append(lab('Style', sel(DOOR_STYLES, o.doorStyle, (v) => { o.doorStyle = v; if (v === 'double' && o.doorWidth < 1200) { o.doorWidth = 1524; renderOptions(editor); } })));
    bar.append(lab('Width', lenField(o.doorWidth, (v) => (o.doorWidth = v))), lab('Height', lenField(o.doorHeight, (v) => (o.doorHeight = v))));
    bar.append(sep(), el('span', { class: 'note' }, 'F flips swing · H flips hinge'));
  } else if (t === 'window') {
    bar.append(lab('Style', sel(WINDOW_STYLES, o.windowStyle, (v) => (o.windowStyle = v))));
    bar.append(lab('Width', lenField(o.windowWidth, (v) => (o.windowWidth = v))), lab('Height', lenField(o.windowHeight, (v) => (o.windowHeight = v))), lab('Sill', lenField(o.windowSill, (v) => (o.windowSill = v))));
  } else if (t === 'room') {
    const names = Object.fromEntries(ROOM_PRESETS.map(([n]) => [n, n])); names.Room = 'Room';
    bar.append(lab('Name', sel(names, o.roomName, (v) => { o.roomName = v; const p = ROOM_PRESETS.find((r) => r[0] === v); if (p) o.roomFloor = p[1]; renderOptions(editor); })));
    bar.append(lab('Floor', sel(Object.fromEntries(Object.entries(FLOORS).map(([k, v]) => [k, v.name])), o.roomFloor, (v) => (o.roomFloor = v))));
    const b = el('button', { class: 'btn', onclick: () => { const n = editor.autoRooms(); toast(n ? `Created ${n} room${n > 1 ? 's' : ''}` : 'No new enclosed areas found'); } }, 'Detect all rooms');
    bar.append(sep(), b);
  } else if (t === 'furniture' && editor.place) {
    const it = byId[editor.place.lib];
    bar.append(el('b', {}, it.name), el('span', { class: 'note' }, `${fmtLen(it.w)} × ${fmtLen(it.d)}`), sep(), el('button', { class: 'btn', onclick: () => editor.rotateSelection() }, 'Rotate 90° (R)'), el('span', { class: 'note' }, 'Hover near a wall to snap flush against it'));
  } else if (t === 'dim') {
    bar.append(el('span', { class: 'note' }, 'Click two points, then click again to position the dimension line.'));
  } else if (t === 'text') {
    bar.append(el('span', { class: 'note' }, 'Click to place a note · Enter to finish · double-click a note to edit it'));
  } else {
    bar.append(el('span', { class: 'note' }, 'Select tool — click things to edit them. Pick Wall (W) to start drawing, or choose furniture from the left.'));
  }
}

// ---- properties inspector --------------------------------------------------------
let propSpecs = [];

function field(label, node) { return el('div', { class: 'field' }, el('label', {}, label), node); }

function specInput(spec, items, editor) {
  const first = items[0];
  const apply = (v) => { store.act(() => items.forEach((e) => spec.set(e, v))); };
  let node;
  if (spec.kind === 'len') {
    node = el('input', { type: 'text', spellcheck: 'false' });
    node.onchange = () => { const v = parseLen(node.value); if (v != null && v >= (spec.min ?? 1)) apply(v); else toast('Try a length like 3\'-6", 3.5m or 900mm'); sync(); };
    node.onfocus = () => node.select();
  } else if (spec.kind === 'num') {
    node = el('input', { type: 'text', spellcheck: 'false' });
    node.onchange = () => { const v = parseFloat(node.value); if (isFinite(v)) apply(v); sync(); };
    node.onfocus = () => node.select();
  } else if (spec.kind === 'text') {
    node = el('input', { type: 'text', spellcheck: 'false', 'data-focus': spec.focus ? '1' : null });
    if (spec.list) node.setAttribute('list', 'roomnames');
    node.onchange = () => apply(node.value);
  } else if (spec.kind === 'area') {
    node = el('textarea', { rows: 3 }); node.onchange = () => apply(node.value);
  } else if (spec.kind === 'select') {
    node = sel(typeof spec.options === 'function' ? spec.options(first) : spec.options, spec.get(first), (v) => apply(v));
  } else if (spec.kind === 'check') {
    node = el('input', { type: 'checkbox' }); node.onchange = () => apply(node.checked);
  } else node = el('div', { class: 'ro' });
  const sync = () => {
    const vals = items.map((e) => spec.get(e));
    const same = vals.every((v) => JSON.stringify(v) === JSON.stringify(vals[0]));
    if (spec.kind === 'check') node.checked = !!vals[0];
    else if (spec.kind === 'select') node.value = same ? vals[0] : '';
    else if (spec.kind === 'ro') node.textContent = spec.fmt ? spec.fmt(vals[0], items) : vals[0];
    else if (document.activeElement !== node) node.value = !same ? '' : spec.kind === 'len' ? fmtLen(vals[0], { precision: 16 }) : spec.kind === 'num' ? Math.round(vals[0] * 100) / 100 : vals[0] ?? '';
    if (!same && node.placeholder !== undefined) node.placeholder = 'mixed';
  };
  sync();
  propSpecs.push(sync);
  return node;
}

function syncPropValues() { for (const f of propSpecs) f(); }

const SPECS = {
  ref: [
    { label: 'Name', kind: 'ro', get: (e) => e.name || 'Reference' },
    { label: 'Opacity %', kind: 'num', get: (e) => (e.opacity ?? 0.6) * 100, set: (e, v) => { e.opacity = Math.min(1, Math.max(0.05, v / 100)); } },
    { label: 'Rotation °', kind: 'num', get: (e) => G.deg(e.rot || 0), set: (e, v) => { e.rot = G.rad(v); } },
    { label: 'Scale %', kind: 'num', get: (e) => (e.scale || 1) * 100, set: (e, v) => { if (v > 0) e.scale = v / 100; } },
    { label: 'Locked', kind: 'check', get: (e) => !!e.locked, set: (e, v) => { e.locked = v; } },
    { label: 'Visible', kind: 'check', get: (e) => !e.hidden, set: (e, v) => { e.hidden = !v; } },
  ],
  wall: [
    { label: 'Type', kind: 'select', options: { exterior: 'Exterior', interior: 'Interior' }, get: (e) => e.kind, set: (e, v) => { e.kind = v; } },
    { label: 'Length', kind: 'ro', get: (e) => G.dist(e.a, e.b), fmt: (v, items) => (items.length === 1 ? fmtLen(v) : `${items.length} walls`) },
    { label: 'Thickness', kind: 'len', get: (e) => e.thickness, set: (e, v) => { e.thickness = v; } },
    { label: 'Height', kind: 'len', get: (e) => e.height || store.level.height, set: (e, v) => { e.height = v; } },
    { label: 'Load-bearing', kind: 'check', get: (e) => !!e.structural, set: (e, v) => { e.structural = v; } },
  ],
  opening: [
    { label: 'Style', kind: 'select', options: (e) => (e.kind === 'door' ? DOOR_STYLES : WINDOW_STYLES), get: (e) => e.style, set: (e, v) => { e.style = v; } },
    { label: 'Width', kind: 'len', get: (e) => e.width, set: (e, v) => { e.width = v; } },
    { label: 'Height', kind: 'len', get: (e) => e.height, set: (e, v) => { e.height = v; } },
    { label: 'Sill height', kind: 'len', min: 0, only: 'window', get: (e) => e.sill || 0, set: (e, v) => { e.sill = v; } },
  ],
  room: [
    { label: 'Name', kind: 'text', list: true, focus: true, get: (e) => e.name, set: (e, v) => { e.name = v; } },
    { label: 'Floor', kind: 'select', options: Object.fromEntries(Object.entries(FLOORS).map(([k, v]) => [k, v.name])), get: (e) => e.floor || 'none', set: (e, v) => { e.floor = v; } },
    { label: 'Area', kind: 'ro', get: (e) => roomGeom(e)?.area ?? NaN, fmt: (v) => (isFinite(v) ? fmtArea(v) : 'Not enclosed') },
    { label: 'Show area', kind: 'check', get: (e) => e.showArea !== false, set: (e, v) => { e.showArea = v; } },
  ],
  furniture: [
    { label: 'Item', kind: 'ro', get: (e) => byId[e.lib]?.name || e.lib },
    { label: 'Width', kind: 'len', get: (e) => e.w, set: (e, v) => { e.w = v; } },
    { label: 'Depth', kind: 'len', get: (e) => e.d, set: (e, v) => { e.d = v; } },
    { label: 'Height', kind: 'len', get: (e) => e.h, set: (e, v) => { e.h = v; } },
    { label: 'Rotation °', kind: 'num', get: (e) => G.deg(e.rot || 0), set: (e, v) => { e.rot = G.rad(v); } },
  ],
  text: [
    { label: 'Text', kind: 'area', get: (e) => e.text, set: (e, v) => { e.text = v; } },
    { label: 'Text size', kind: 'len', get: (e) => e.size || 160, set: (e, v) => { e.size = v; } },
  ],
  dim: [
    { label: 'Length', kind: 'ro', get: (e) => G.dist(e.a, e.b), fmt: (v) => fmtLen(v) },
    { label: 'Line offset', kind: 'len', min: -1e6, get: (e) => e.off ?? 600, set: (e, v) => { e.off = v; } },
  ],
};
const TYPE_NAMES = { ref: 'Reference', wall: 'Wall', opening: 'Opening', room: 'Room', furniture: 'Furniture', text: 'Note', dim: 'Dimension' };

export function renderProps(editor) {
  const box = $('#props');
  const sel = editor.selected();
  propSpecs = [];
  box.innerHTML = '';
  if (!box.nextElementSibling?.matches('datalist')) {
    // datalist for room names
  }
  if (!sel.length) {
    $('#insp-title').textContent = 'Project';
    const lv = store.level.id;
    const walls = wallsOnLevel(store, lv);
    const rooms = store.list('room', lv).map(roomGeom).filter(Boolean);
    const total = walls.reduce((a, w) => a + G.dist(w.a, w.b), 0);
    if (!walls.length && !store.list('furniture', lv).length) {
      box.append(
        el('div', { class: 'card' }, el('b', {}, 'Start drafting'), el('br'), 'Press ', el('b', {}, 'W'), ' and click to draw walls. Drop doors and windows onto them, click inside a closed area to make a room, then furnish from the library on the left.'),
        el('div', { class: 'field-row' }, el('button', { class: 'btn', onclick: () => { buildSample(); editor.fit(); } }, 'Load example house')),
      );
    } else {
      const stat = (k, v) => field(k, el('div', { class: 'ro' }, v));
      box.append(
        stat('Walls', `${walls.length}  ·  ${fmtLen(total, { meters: true })}`),
        stat('Rooms', `${rooms.length}  ·  ${fmtArea(rooms.reduce((a, r) => a + r.area, 0))}`),
        stat('Doors / windows', `${store.list('opening', lv).filter((o) => o.kind === 'door').length} / ${store.list('opening', lv).filter((o) => o.kind === 'window').length}`),
        stat('Furniture', String(store.list('furniture', lv).length)),
        el('div', { class: 'card' }, 'Select anything to edit its size, type or properties here.'),
      );
    }
    return;
  }
  const types = [...new Set(sel.map((s) => s.type))];
  if (types.length > 1) {
    $('#insp-title').textContent = `${sel.length} items selected`;
    box.append(el('div', { class: 'card' }, types.map((t) => `${sel.filter((s) => s.type === t).length} × ${TYPE_NAMES[t]}`).join(', ')),
      el('div', { class: 'field-row' }, el('button', { class: 'btn', onclick: () => editor.duplicate() }, 'Duplicate'), el('button', { class: 'btn', onclick: () => editor.deleteSelection() }, 'Delete')));
    return;
  }
  const type = types[0];
  $('#insp-title').textContent = sel.length > 1 ? `${sel.length} × ${TYPE_NAMES[type]}` : TYPE_NAMES[type] === 'Opening' ? (sel[0].kind === 'door' ? 'Door' : 'Window') : TYPE_NAMES[type];
  for (const spec of SPECS[type]) {
    if (spec.only && !sel.every((s) => s.kind === spec.only)) continue;
    box.append(field(spec.label, specInput(spec, sel, editor)));
  }
  if (type === 'room') {
    const dl = el('datalist', { id: 'roomnames' }, ROOM_PRESETS.map(([n]) => el('option', { value: n })));
    box.append(dl);
  }
  if (type === 'opening' && sel.every((s) => s.kind === 'door')) {
    box.append(el('div', { class: 'field-row' },
      el('button', { class: 'btn', onclick: () => { store.act(() => sel.forEach((o) => (o.side = -(o.side || 1)))); } }, 'Flip swing (F)'),
      el('button', { class: 'btn', onclick: () => { store.act(() => sel.forEach((o) => (o.hinge = (o.hinge || 'a') === 'a' ? 'b' : 'a'))); } }, 'Flip hinge (H)')));
  }
  if (type === 'ref' && sel.length === 1) {
    box.append(el('div', { class: 'field-row' }, el('button', { class: 'btn', onclick: () => editor.startCalibrate('scale', sel[0].id) }, 'Set scale…'), el('button', { class: 'btn', onclick: () => editor.startCalibrate('align', sel[0].id) }, 'Level it…')));
    box.append(el('div', { class: 'card' }, 'Unlock to drag it into place. Scale: click two points a known distance apart. Level: click along a wall that should be horizontal or vertical.'));
  }
  if (type === 'furniture') {
    box.append(el('div', { class: 'field-row' }, el('button', { class: 'btn', onclick: () => editor.rotateSelection() }, 'Rotate 90° (R)'), el('button', { class: 'btn', onclick: () => editor.duplicate() }, 'Duplicate')));
  }
  box.append(el('div', { class: 'field-row' }, el('button', { class: 'btn', style: 'color:#c0262d', onclick: () => editor.deleteSelection() }, 'Delete')));
}

// ---- layers --------------------------------------------------------------------
function renderLayers(editor) {
  const box = $('#layers');
  if (box.dataset.built) return;
  box.dataset.built = '1';
  const defs = [['walls', 'Walls'], ['openings', 'Doors & windows'], ['rooms', 'Rooms'], ['furn', 'Furniture'], ['dims', 'Dimensions'], ['notes', 'Notes']];
  for (const [k, name] of defs) {
    const cb = el('input', { type: 'checkbox', checked: true });
    cb.onchange = () => { editor.layers[k] = cb.checked; editor.requestRender(); };
    box.append(el('label', { class: 'layer' }, cb, name));
  }
  for (const n of ['Electrical', 'Plumbing', 'Structural']) box.append(el('label', { class: 'layer dis' }, el('input', { type: 'checkbox', disabled: true }), n, el('i', {}, 'soon')));
}

// ---- references -----------------------------------------------------------------
function renderRefs(editor) {
  const box = $('#refs');
  if (box.contains(document.activeElement) && document.activeElement.tagName === 'INPUT') return;
  box.innerHTML = '';
  const refs = store.list('ref', store.level.id);
  if (!refs.length) {
    box.append(el('div', { class: 'card' }, 'Trace over a scan, PDF, photo or CAD file.', el('br'), el('a', { href: '#', onclick: (e) => { e.preventDefault(); openImport(editor); } }, 'Import a file…')));
    return;
  }
  for (const r of refs) {
    const vis = el('input', { type: 'checkbox', checked: !r.hidden, title: 'Show / hide' });
    vis.onchange = () => store.act(() => (r.hidden = !vis.checked));
    const name = el('a', { href: '#', class: 'refname', title: 'Select to edit, set scale or move', onclick: (e) => { e.preventDefault(); editor.setTool('select'); editor.setSelection([r.id]); } }, r.name || 'Reference');
    const lock = el('button', { class: 'ib', style: 'width:26px;height:26px', title: r.locked ? 'Locked — click to unlock so it can be moved' : 'Unlocked — click to lock', onclick: () => store.act(() => (r.locked = !r.locked)) }, r.locked ? '🔒' : '🔓');
    const op = el('input', { type: 'range', min: 5, max: 100, value: Math.round((r.opacity ?? 0.6) * 100), title: 'Opacity', style: 'width:100%;accent-color:var(--accent)' });
    op.oninput = () => { r.opacity = op.value / 100; store.changed(); };
    op.onchange = () => { store.checkpoint(); store.commit(); };
    const del = el('button', { class: 'ib', style: 'width:26px;height:26px;color:#c0262d', title: 'Remove', onclick: () => { if (confirm(`Remove “${r.name}”?`)) { store.act(() => store.remove(r.id)); editor.setSelection([]); } } }, '×');
    box.append(el('div', { class: 'refrow' }, el('div', { class: 'refhead' }, vis, name, lock, del), op));
  }
}

// ---- levels --------------------------------------------------------------------
function renderLevels(editor) {
  const box = $('#levels');
  box.innerHTML = '';
  const levels = [...store.project.levels].sort((a, b) => a.elevation - b.elevation);
  for (const l of levels) {
    const b = el('button', { class: 'lvl' + (l.id === store.project.activeLevel ? ' on' : ''), tabindex: '-1' }, l.name);
    b.onclick = () => { store.project.activeLevel = l.id; editor.setSelection([]); editor.draft = null; store.changed(); editor.fit(); };
    box.append(b);
  }
  box.append(el('button', { class: 'lvl', title: 'Add a level (floor)', tabindex: '-1', onclick: () => { store.act(() => store.addLevel()); editor.setSelection([]); editor.fit(); } }, '+ Level'));
}

function renderLevelProps(editor) {
  const box = $('#levelprops');
  if (box.contains(document.activeElement)) return;
  const l = store.level;
  box.innerHTML = '';
  const name = el('input', { type: 'text', value: l.name });
  name.onchange = () => store.act(() => (l.name = name.value.trim() || l.name));
  box.append(field('Name', name));
  const elev = lenField(l.elevation, (v) => store.act(() => (l.elevation = v)), 90); elev.style.width = '100%';
  const ht = lenField(l.height, (v) => store.act(() => (l.height = v)), 90); ht.style.width = '100%';
  box.append(field('Elevation', elev), field('Floor-to-floor', ht));
  if (store.project.levels.length > 1) {
    box.append(el('div', { class: 'field-row' }, el('button', { class: 'btn', onclick: () => { if (confirm(`Delete "${l.name}" and everything on it?`)) { store.act(() => store.removeLevel(l.id)); editor.setSelection([]); } } }, 'Delete level')));
  }
}

// ---- dialogs ---------------------------------------------------------------------
function openHelp() {
  const keys = [['V', 'Select'], ['W', 'Wall'], ['D', 'Door'], ['N', 'Window'], ['A', 'Room'], ['M', 'Measure'], ['T', 'Note'], ['R', 'Rotate'], ['F / H', 'Flip door swing / hinge'], ['Del', 'Delete'], ['Ctrl+Z / Y', 'Undo / redo'], ['Ctrl+C / V / D', 'Copy / paste / duplicate'], ['Space + drag', 'Pan (or middle / right mouse)'], ['Scroll', 'Zoom'], ['0', 'Fit plan to window'], ['3', 'Toggle 3D'], ['Alt', 'Hold to bypass snapping'], ['Shift', 'Free angle while drawing']];
  const kg = el('div', { class: 'keys' });
  keys.forEach(([k, d]) => kg.append(el('kbd', {}, k), el('span', {}, d)));
  const phase = (cls, h, p, items) => el('div', { class: 'ph ' + cls }, el('h4', {}, h), el('p', {}, p), el('ul', {}, items.map((i) => el('li', {}, i))));
  const road = el('div', { class: 'road' },
    phase('now', 'Phase 1 — Layout  (you are here)', 'Fast, intuitive drafting.', ['Walls, doors, windows, rooms with live areas', 'Furniture & fixture library with wall-snapping', 'Levels, dimensions, notes', '3D view, printable vector sheets at true scale']),
    phase('', 'Phase 2 — Building systems', 'Electrical & plumbing layers.', ['Outlets, switches, lights, panel; circuits & load', 'Plumbing fixtures, supply & drain routing', 'Schedules (doors, windows, fixtures)', 'Separate sheets per discipline']),
    phase('', 'Phase 3 — Structure & recommendations', 'Structural plans and checks.', ['Footings, columns, beams, joist & truss layouts', 'Load-bearing wall flagging, span checks', 'Code-style prompts: egress, ceiling heights, stair rise/run', 'Roof designer (gable, hip, shed)']),
    phase('', 'Phase 4 — Construction documents & renders', 'Build-ready sets and pictures.', ['Elevations, sections and wall/detail callouts', 'Sheet sets with titleblocks, PDF export', 'Materials & lighting, exterior renders', 'IFC / DXF import–export for engineers']),
  );
  openModal('Shortcuts & roadmap', el('div', {}, el('h4', { style: 'margin:0 0 8px' }, 'Shortcuts'), kg, el('h4', { style: 'margin:0 0 8px' }, 'Roadmap'), road));
}

function openSheetDialog(editor) {
  const state = {
    levelId: store.project.activeLevel, paper: 'archd', orientation: 'landscape', scale: 'auto', title: '', furn: true, roomFills: false, autoDims: false,
  };
  const meta = store.project.meta;
  const preview = el('div', { class: 'preview' });
  let last = null;
  const rebuild = () => {
    try {
      last = buildSheet({ ...state, title: state.title || `${store.project.levels.find((l) => l.id === state.levelId)?.name} Plan` });
      preview.innerHTML = last.svg;
      scaleNote.textContent = `Drawn at ${last.scaleLabel} on ${PAPERS[state.paper].name.trim()}`;
    } catch (err) { preview.textContent = 'Could not build sheet: ' + err.message; console.error(err); }
  };
  const bind = (key, node, ev = 'onchange') => { node[ev] = () => { state[key] = node.type === 'checkbox' ? node.checked : node.value; rebuild(); }; return node; };
  const levelSel = bind('levelId', sel(Object.fromEntries(store.project.levels.map((l) => [l.id, l.name])), state.levelId, () => {})); levelSel.onchange = () => { state.levelId = levelSel.value; rebuild(); };
  const paperSel = sel(Object.fromEntries(Object.entries(PAPERS).map(([k, v]) => [k, v.name])), state.paper, () => {}); paperSel.onchange = () => { state.paper = paperSel.value; rebuild(); };
  const orient = sel({ landscape: 'Landscape', portrait: 'Portrait' }, 'landscape', () => {}); orient.onchange = () => { state.orientation = orient.value; rebuild(); };
  const scaleSel = sel({ auto: 'Auto (best fit)', ...Object.fromEntries(SCALES[units.system].map((s) => ['r' + s.ratio, s.label])) }, 'auto', () => {}); scaleSel.onchange = () => { state.scale = scaleSel.value; rebuild(); };
  const title = el('input', { type: 'text', placeholder: 'e.g. FIRST FLOOR PLAN' }); title.oninput = () => { state.title = title.value; clearTimeout(title._t); title._t = setTimeout(rebuild, 250); };
  const metaIn = (k, ph) => { const i = el('input', { type: 'text', value: meta[k] || '', placeholder: ph }); i.oninput = () => { meta[k] = i.value; store.autosave(); clearTimeout(i._t); i._t = setTimeout(rebuild, 250); }; return i; };
  const chk = (key, text) => { const c = el('input', { type: 'checkbox', checked: state[key] }); c.onchange = () => { state[key] = c.checked; rebuild(); }; return el('label', { class: 'chk' }, c, text); };
  const scaleNote = el('div', { class: 'note', style: 'color:#6b7380;font-size:12px' });
  const controls = el('div', { class: 'controls' },
    field('Level', levelSel), field('Paper', paperSel), field('Orientation', orient), field('Scale', scaleSel), field('Sheet title', title),
    el('div', { style: 'height:4px' }), chk('furn', 'Show furniture'), chk('roomFills', 'Tint rooms by floor type'), chk('autoDims', 'Overall dimensions'),
    el('div', { style: 'height:4px' }), field('Project', el('div', { class: 'ro' }, store.project.name)), field('Client', metaIn('client', '')), field('Address', metaIn('address', '')), field('Drawn by', metaIn('drawnBy', '')), field('Sheet no.', metaIn('sheetNo', 'A-101')), scaleNote);
  const body = el('div', { class: 'sheetdlg' }, controls, preview);
  const close = openModal('Print sheet', body, [
    el('button', { class: 'btn', onclick: () => last && downloadText(`${store.project.name}-${last.scaleLabel.replace(/\W+/g, '')}.svg`, last.svg, 'image/svg+xml') }, 'Download SVG'),
    el('button', { class: 'primary', onclick: () => last && printSvg(last.svg, last.width, last.height, store.project.name) }, 'Print / Save as PDF'),
  ]);
  rebuild();
}
