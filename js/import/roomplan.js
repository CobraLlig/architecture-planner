// Apple RoomPlan JSON (CapturedRoom export) — written by LiDAR scanning apps such as Polycam, Scaniverse,
// Canvas, Rooms and many custom ARKit tools. Coordinates are metres, y-up; plan = (x, z).
// Output is in millimetres, ready to turn into walls / openings / furniture.

import * as G from '../geom.js';

const matOf = (t) => {
  if (!t) return null;
  if (Array.isArray(t) && t.length === 16) return t.map(Number);
  if (Array.isArray(t) && t.length === 4 && Array.isArray(t[0])) return t.flat().map(Number); // 4 columns
  if (t.columns) return t.columns.flat().map(Number);
  return null;
};
const dimsOf = (d) => {
  if (Array.isArray(d)) return d.map(Number);
  if (d && typeof d === 'object') return [d.x ?? d.width ?? 0, d.y ?? d.height ?? 0, d.z ?? d.depth ?? 0].map(Number);
  return [0, 0, 0];
};
const catOf = (c) => (typeof c === 'string' ? c : c && typeof c === 'object' ? Object.keys(c)[0] || '' : '');

const OBJ_MAP = {
  table: 'dtable', chair: 'chair', sofa: 'sofa3', bed: 'bedq', bathtub: 'bathtub', toilet: 'toilet', sink: 'vanity',
  refrigerator: 'fridge', stove: 'range', oven: 'range', dishwasher: 'dishwasher', washerDryer: 'washer', fireplace: 'fireplace',
  television: 'tvstand', stairs: 'stairs', storage: 'bookcase',
};

export function looksLikeRoomPlan(j) {
  return j && typeof j === 'object' && (Array.isArray(j.walls) || Array.isArray(j.rooms) || Array.isArray(j.sections) || Array.isArray(j.objects));
}

export function parseRoomPlan(j) {
  const parts = Array.isArray(j.rooms) ? j.rooms : [j];
  const walls = [], openings = [], objects = [];
  let floorY = Infinity;
  for (const r of parts) for (const w of r.walls || []) {
    const m = matOf(w.transform), d = dimsOf(w.dimensions);
    if (m) floorY = Math.min(floorY, m[13] - d[1] / 2);
  }
  if (!isFinite(floorY)) floorY = 0;
  for (const r of parts) {
    for (const w of r.walls || []) {
      const m = matOf(w.transform); if (!m) continue;
      const d = dimsOf(w.dimensions);
      const dir = G.norm({ x: m[0], y: m[2] });
      const c = { x: m[12] * 1000, y: m[14] * 1000 }, L = d[0] * 1000;
      if (L < 100) continue;
      walls.push({ a: { x: c.x - dir.x * L / 2, y: c.y - dir.y * L / 2 }, b: { x: c.x + dir.x * L / 2, y: c.y + dir.y * L / 2 }, thickness: d[2] > 0.03 ? d[2] * 1000 : 0, height: d[1] * 1000 });
    }
    for (const [key, list] of [['doors', 'door'], ['windows', 'window'], ['openings', 'opening']]) {
      for (const o of r[key] || []) {
        const m = matOf(o.transform); if (!m) continue;
        const d = dimsOf(o.dimensions);
        const kind = list === 'window' ? 'window' : 'door';
        openings.push({ x: m[12] * 1000, y: m[14] * 1000, width: d[0] * 1000, height: d[1] * 1000, sill: Math.max(0, (m[13] - d[1] / 2 - floorY) * 1000), kind, style: list === 'opening' ? 'open' : kind === 'window' ? 'casement' : 'single' });
      }
    }
    for (const o of r.objects || []) {
      const m = matOf(o.transform); if (!m) continue;
      const cat = catOf(o.category), d = dimsOf(o.dimensions);
      let lib = OBJ_MAP[cat];
      if (!lib) continue;
      if (cat === 'storage') lib = d[1] > 1.6 ? 'wardrobe' : 'bookcase';
      if (cat === 'table' && Math.abs(d[0] - d[2]) < 0.1 && d[0] < 1.3) lib = 'rtable';
      if (cat === 'bed') lib = d[0] > 1.75 ? 'bedk' : d[0] < 1.1 ? 'bedt' : 'bedq';
      objects.push({ lib, x: m[12] * 1000, y: m[14] * 1000, rot: Math.atan2(m[2], m[0]), w: Math.max(100, d[0] * 1000), d: Math.max(100, d[2] * 1000), h: Math.max(10, d[1] * 1000) });
    }
  }
  // move to origin
  const pts = [...walls.flatMap((w) => [w.a, w.b]), ...openings, ...objects];
  const bb = G.bbox(pts);
  if (bb) {
    const sh = (p) => { p.x -= bb.x0; p.y -= bb.y0; };
    walls.forEach((w) => { sh(w.a); sh(w.b); }); openings.forEach(sh); objects.forEach(sh);
  }
  return { walls, openings, objects };
}
