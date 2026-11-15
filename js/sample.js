// A small example house so a first-time user sees something meaningful straight away.
import { store, DEFAULTS } from './store.js';
import { normalizeWalls, wallsOnLevel, facesFor } from './walls.js';
import { closestOnSeg } from './geom.js';
import { byId } from './library.js';
import * as G from './geom.js';

export function buildSample() {
  store.newProject();
  store.project.name = 'Example House';
  store.project.meta = { client: 'Sample Client', address: '123 Example Street', drawnBy: '', sheetNo: 'A-101' };
  const lv = store.level.id;
  const wall = (x1, y1, x2, y2, kind = 'interior') => store.add('wall', {
    discipline: 'arch', a: { x: x1, y: y1 }, b: { x: x2, y: y2 }, kind,
    thickness: kind === 'exterior' ? DEFAULTS.extThickness : DEFAULTS.intThickness, height: store.level.height, structural: false,
  });
  const W = 9144, D = 7315, X1 = 5486, X2 = 7620, Y1 = 3658;
  wall(0, 0, W, 0, 'exterior'); wall(W, 0, W, D, 'exterior'); wall(W, D, 0, D, 'exterior'); wall(0, D, 0, 0, 'exterior');
  wall(X1, 0, X1, D); wall(X1, Y1, W, Y1); wall(X2, Y1, X2, D);
  normalizeWalls(store, lv);

  const onWall = (x, y, kind, props) => {
    let best = null;
    for (const w of wallsOnLevel(store, lv)) {
      const c = closestOnSeg({ x, y }, w.a, w.b);
      if (!best || c.d < best.d) best = { w, ...c };
    }
    return store.add('opening', { discipline: 'arch', kind, wallId: best.w.id, pos: best.s, side: 1, hinge: 'a', ...props });
  };
  const door = (x, y, o = {}) => onWall(x, y, 'door', { style: 'single', width: 914, height: 2032, sill: 0, ...o });
  const win = (x, y, w = 1219, o = {}) => onWall(x, y, 'window', { style: 'casement', width: w, height: 1219, sill: 914, ...o });

  door(4600, D, { side: -1, width: 1016 });
  door(X1, 1900); door(X1, 5200, { side: -1 }); door(X2, 5400, { width: 762, side: -1 });
  win(2300, 0, 1200, { sill: 1067, height: 914 }); win(0, 3200, 1800); win(1800, D, 1500); win(6500, 0); win(W, 1800); win(6500, D, 1200); win(W, 5600, 610, { sill: 1500, height: 610 });

  const furn = (lib, x, y, rot = 0, o = {}) => {
    const it = byId[lib];
    return store.add('furniture', { discipline: 'furn', lib, x, y, rot, w: it.w, d: it.d, h: it.h, ...o });
  };
  const PI = Math.PI;
  // kitchen run along the top wall
  furn('fridge', 540, 457); furn('range', 1400, 407); furn('ksink', 2300, 382); furn('dishwasher', 3130, 382); furn('basecab', 3760, 382);
  // dining
  furn('dtable', 1800, 2900); furn('chair', 1400, 2300); furn('chair', 2200, 2300); furn('chair', 1400, 3500, PI); furn('chair', 2200, 3500, PI);
  // living
  furn('rug', 2400, 5800); furn('sofa3', 2400, 6773, PI); furn('coffee', 2400, 5650); furn('tvstand', 307, 5650, -PI / 2); furn('armchair', 4400, 5750, -PI / 2 - 0.4);
  furn('plant', 5000, 4300);
  // primary bedroom
  furn('bedq', 6550, 6218, PI); furn('dresser', 6550, 3975); furn('nightstand', 5780, 6900, PI);
  // bedroom 2
  furn('bedt', 6200, 1060); furn('desk', 8500, 400); furn('ochair', 8500, 1100, PI); furn('wardrobe', 8200, 3300, PI);
  // bath
  furn('bathtub', 8682, 6473, PI / 2); furn('toilet', 8712, 5000, PI / 2); furn('vanity', 8300, 3990);

  // rooms
  const names = [
    [(c) => c.x < X1, 'Living / Kitchen', 'wood'],
    [(c) => c.x >= X1 && c.y < Y1, 'Bedroom 2', 'carpet'],
    [(c) => c.x >= X1 && c.x < X2 && c.y >= Y1, 'Primary Bedroom', 'carpet'],
    [(c) => c.x >= X2 && c.y >= Y1, 'Bath', 'tile'],
  ];
  for (const f of facesFor(store, lv)) {
    const c = G.polyCentroid(f.pts);
    const [, name, floor] = names.find(([t]) => t(c)) || [0, 'Room', 'wood'];
    store.add('room', { discipline: 'arch', seed: G.polyCentroid(f.inner), name, floor, showArea: true });
  }
  // a couple of annotations
  store.add('dim', { discipline: 'annot', a: { x: 0, y: D }, b: { x: W, y: D }, off: 1000 });
  store.changed();
}
