// Project state, undo/redo and persistence.
//
// The project is a flat map of entities. Every entity has:
//   id, type, level, discipline ('arch' | 'furn' | 'elec' | 'plmb' | 'strc' | 'annot')
// New building systems (electrical, plumbing, structural) are just new entity types + disciplines,
// so the data model is already BIM-shaped: typed objects with properties, not loose lines.

import { setSystem } from './units.js';

const KEY = 'archplan.project.v1';

export const DEFAULTS = {
  wallHeight: 2743,       // 9'-0"
  extThickness: 165,      // ~6.5"
  intThickness: 114,      // ~4.5"
  doorWidth: 914,         // 3'-0"
  doorHeight: 2032,       // 6'-8"
  windowWidth: 1219,      // 4'-0"
  windowHeight: 1219,
  windowSill: 914,        // 3'-0"
};

export function blankProject() {
  return {
    name: 'Untitled Plan',
    units: 'imperial',
    meta: { client: '', address: '', drawnBy: '', sheetNo: 'A-101' },
    levels: [{ id: 'L1', name: 'Level 1', elevation: 0, height: DEFAULTS.wallHeight }],
    activeLevel: 'L1',
    entities: {},
    nextId: 1,
  };
}

function serialise(p) {
  return JSON.stringify(p);
}

class Store {
  constructor() {
    this.project = blankProject();
    this.version = 0;
    this.undoStack = [];
    this.redoStack = [];
    this.listeners = new Set();
    this._saveTimer = null;
    this._pending = false;      // a checkpoint was taken for an in-flight action
  }

  // ---- subscriptions -------------------------------------------------------
  subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  _emit(kind = 'change') { for (const fn of this.listeners) fn(kind); }

  /** Call after mutating the project. */
  changed() {
    this.version++;
    this._emit('change');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.autosave(), 400);
  }

  // ---- undo / redo ---------------------------------------------------------
  /** Snapshot state before a user action. Pair with changed(); call cancelCheckpoint() if nothing happened. */
  checkpoint() {
    this.undoStack.push(serialise(this.project));
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack.length = 0;
    this._pending = true;
  }
  cancelCheckpoint() {
    if (this._pending) { this.undoStack.pop(); this._pending = false; }
  }
  commit() { this._pending = false; this.changed(); }

  /** Run fn as a single undoable action. */
  act(fn) { this.checkpoint(); const r = fn(); this.commit(); return r; }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(serialise(this.project));
    this._restore(this.undoStack.pop());
    return true;
  }
  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(serialise(this.project));
    this._restore(this.redoStack.pop());
    return true;
  }
  _restore(json) {
    this.project = JSON.parse(json);
    setSystem(this.project.units);
    this.version++;
    this._emit('restore');
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.autosave(), 400);
  }

  // ---- entities ------------------------------------------------------------
  get level() { return this.project.levels.find((l) => l.id === this.project.activeLevel) || this.project.levels[0]; }
  get entities() { return this.project.entities; }
  get(id) { return this.project.entities[id]; }

  add(type, props = {}) {
    const id = 'e' + this.project.nextId++;
    const e = { id, type, level: this.project.activeLevel, ...props };
    this.project.entities[id] = e;
    return e;
  }

  remove(id) {
    const e = this.project.entities[id];
    if (!e) return;
    if (e.type === 'wall') {
      for (const o of Object.values(this.project.entities)) if (o.type === 'opening' && o.wallId === id) delete this.project.entities[o.id];
    }
    delete this.project.entities[id];
  }

  list(type, levelId) {
    const out = [];
    for (const e of Object.values(this.project.entities)) {
      if (type && e.type !== type) continue;
      if (levelId && e.level !== levelId) continue;
      out.push(e);
    }
    return out;
  }

  openingsOf(wallId) {
    const out = [];
    for (const e of Object.values(this.project.entities)) if (e.type === 'opening' && e.wallId === wallId) out.push(e);
    return out;
  }

  // ---- levels --------------------------------------------------------------
  addLevel() {
    const lv = this.project.levels;
    const top = lv[lv.length - 1];
    const n = lv.length + 1;
    const l = { id: 'L' + (Date.now() % 1e7) + n, name: `Level ${n}`, elevation: top.elevation + top.height + 150, height: DEFAULTS.wallHeight };
    lv.push(l);
    this.project.activeLevel = l.id;
    return l;
  }

  removeLevel(id) {
    const p = this.project;
    if (p.levels.length < 2) return;
    p.levels = p.levels.filter((l) => l.id !== id);
    for (const e of Object.values(p.entities)) if (e.level === id) delete p.entities[e.id];
    if (p.activeLevel === id) p.activeLevel = p.levels[0].id;
  }

  levelBelow(levelId) {
    const sorted = [...this.project.levels].sort((a, b) => a.elevation - b.elevation);
    const i = sorted.findIndex((l) => l.id === levelId);
    return i > 0 ? sorted[i - 1] : null;
  }

  // ---- persistence ---------------------------------------------------------
  autosave() {
    try { localStorage.setItem(KEY, serialise(this.project)); this._saveWarned = false; }
    catch { if (!this._saveWarned) { this._saveWarned = true; this.onSaveError?.(); } }
  }

  loadAutosave() {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return false;
      this.load(JSON.parse(raw), false);
      return true;
    } catch { return false; }
  }

  load(data, resetHistory = true) {
    const base = blankProject();
    this.project = { ...base, ...data, meta: { ...base.meta, ...(data.meta || {}) } };
    if (!this.project.levels?.length) this.project.levels = base.levels;
    if (!this.project.levels.find((l) => l.id === this.project.activeLevel)) this.project.activeLevel = this.project.levels[0].id;
    setSystem(this.project.units);
    if (resetHistory) { this.undoStack = []; this.redoStack = []; }
    this.version++;
    this._emit('restore');
  }

  newProject() {
    this.undoStack = []; this.redoStack = [];
    this.load(blankProject());
    this.autosave();
  }

  toFileText() { return JSON.stringify({ app: 'archplan', format: 1, ...this.project }, null, 1); }
}

export const store = new Store();
