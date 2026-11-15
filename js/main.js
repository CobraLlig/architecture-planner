import { store } from './store.js';
import { setSystem } from './units.js';
import { Editor } from './editor.js';
import { View3D } from './view3d.js';
import { initUI, toast } from './ui.js';
import { openImport } from './importer.js';

if (!store.loadAutosave()) store.newProject();
setSystem(store.project.units);

const editor = new Editor(document.getElementById('c2d'), document.getElementById('wrap2d'));
let view3d = null;
let mode = 'plan';

function ensure3D() {
  if (!view3d) {
    try { view3d = new View3D(document.getElementById('wrap3d')); }
    catch (err) { console.error(err); toast('3D view is not available in this browser (WebGL needed).'); return null; }
  }
  return view3d;
}

function setViewMode(m) {
  mode = m;
  document.getElementById('views').dataset.mode = m;
  document.querySelectorAll('#viewmode button').forEach((b) => b.classList.toggle('on', b.dataset.v === m));
  const want3D = m !== 'plan';
  if (want3D) {
    const v = ensure3D();
    if (!v) { setViewMode('plan'); return; }
    v.setVisible(true);
  } else if (view3d) view3d.setVisible(false);
  requestAnimationFrame(() => { editor.resize(); view3d?.resize(); });
}

// 3D proxy so the UI can wire controls before the 3D view exists
const proxy = {
  get opts() { return ensure3D()?.opts || {}; },
  update() { view3d?.update(); },
  fit() { view3d?.fit(); },
  setSun(a, e) { ensure3D()?.setSun(a, e); },
  capture(s) { return ensure3D().capture(s); },
};

initUI({ editor, view3d: proxy, setViewMode });
store.subscribe(() => { if (view3d?.visible) view3d.update(); });
window.addEventListener('keydown', (e) => {
  if (e.target.matches?.('input, textarea, select')) return;
  if (e.key === '3' && !e.ctrlKey) setViewMode(mode === 'plan' ? '3d' : 'plan');
});
editor.fit();
window.__plan = { store, editor, setViewMode, get view3d() { return view3d; } };

// drag & drop a file anywhere to import it
const veil = document.getElementById('dropveil');
let dragDepth = 0;
const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes('Files');
window.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; veil.hidden = false; } });
window.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; veil.hidden = true; } });
window.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
window.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault(); dragDepth = 0; veil.hidden = true;
  if (e.target.closest?.('.dropzone')) return; // the dialog handles its own drop
  const f = e.dataTransfer.files[0];
  if (f) openImport(editor, f);
});
