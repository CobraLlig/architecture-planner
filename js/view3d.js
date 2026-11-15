// 3D model view (three.js). Rebuilt from the same project data the 2D plan uses.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { store } from './store.js';
import { polysFor, wallSegments, wallsOnLevel, facesFor, faceAt } from './walls.js';
import { byId, FLOORS } from './library.js';
import * as G from './geom.js';
import { doorGeom } from './render2d.js';

const MAT = {};
function mat(color, o = {}) {
  const k = color + JSON.stringify(o);
  return (MAT[k] ||= new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...o }));
}
const shapeOf = (pts) => new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x, -p.y)));
function extrude(pts, depth, material, y0) {
  const geo = new THREE.ExtrudeGeometry(shapeOf(pts), { depth: Math.max(depth, 0.5), bevelEnabled: false });
  const m = new THREE.Mesh(geo, material);
  m.rotation.x = -Math.PI / 2;
  m.position.y = y0;
  m.castShadow = m.receiveShadow = true;
  return m;
}

export class View3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#dbe6f1');
    this.camera = new THREE.PerspectiveCamera(40, 1, 100, 400000);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.maxPolarAngle = Math.PI * 0.495;
    this.controls.addEventListener('change', () => this.requestRender());

    this.hemi = new THREE.HemisphereLight('#dcebff', '#8c8a85', 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.scene.add(this.sun, this.sun.target);

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(200000, 64), mat('#c9cfc4', { roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -120;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.model = new THREE.Group();
    this.scene.add(this.model);

    this.opts = { roof: false, upTo: 'all', sunAz: 215, sunEl: 48 };
    this.visible = false;
    this._pending = false;
    this._needsBuild = true;
    this._fitted = false;
    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => { if (this.visible) this.controls.update(); requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  }

  setVisible(v) {
    this.visible = v;
    if (v) { this.resize(); this.update(); }
  }

  resize() {
    const r = this.container.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    this.renderer.setSize(r.width, r.height, false);
    this.renderer.domElement.style.width = r.width + 'px';
    this.renderer.domElement.style.height = r.height + 'px';
    this.camera.aspect = r.width / r.height;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender() {
    if (this._pending || !this.visible) return;
    this._pending = true;
    requestAnimationFrame(() => { this._pending = false; this.renderer.render(this.scene, this.camera); });
  }

  /** Mark the model dirty and rebuild on the next frame (only while visible). */
  update() {
    this._needsBuild = true;
    if (!this.visible) return;
    if (this._buildPending) return;
    this._buildPending = true;
    requestAnimationFrame(() => { this._buildPending = false; if (this._needsBuild) { this.rebuild(); this._needsBuild = false; } });
  }

  clearModel() {
    this.model.traverse((o) => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); });
    this.model.clear();
  }

  rebuild() {
    this.clearModel();
    const levels = [...store.project.levels].sort((a, b) => a.elevation - b.elevation);
    const active = store.level;
    const box = new THREE.Box3();
    for (const lv of levels) {
      if (this.opts.upTo === 'active' && lv.elevation > active.elevation) continue;
      this.buildLevel(lv, lv === levels[levels.length - 1] || (this.opts.upTo === 'active' && lv.id === active.id));
    }
    box.setFromObject(this.model);
    this.bounds = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-3000, 0, -3000), new THREE.Vector3(3000, 3000, 3000)) : box;
    this.updateSun();
    if (!this._fitted && !box.isEmpty()) { this.fit(); this._fitted = true; }
    this.requestRender();
  }

  buildLevel(lv, isTop) {
    const g = new THREE.Group();
    const polys = polysFor(store, lv.id);
    const walls = wallsOnLevel(store, lv.id);
    const E = lv.elevation;
    const outline = new THREE.LineBasicMaterial({ color: '#4b5563', transparent: true, opacity: 0.35 });

    for (const w of walls) {
      const P = polys.get(w.id);
      if (!P) continue;
      const ops = store.openingsOf(w.id);
      const color = w.kind === 'exterior' ? '#ece6da' : '#f3f2ee';
      for (const s of wallSegments(w, P, ops, lv.height)) {
        const m = extrude(s.poly, s.z1 - s.z0, mat(color), E + s.z0);
        const eg = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 40), outline);
        eg.rotation.copy(m.rotation); eg.position.copy(m.position);
        g.add(m, eg);
      }
      for (const o of ops) this.addOpening(g, o, w, P, E);
    }

    // floors & slabs per enclosed area
    const rooms = store.list('room', lv.id);
    for (const f of facesFor(store, lv.id)) {
      const maxT = Math.max(...f.wallIds.map((id) => store.get(id)?.thickness || 114));
      const outer = G.offsetPoly(f.pts, -(maxT / 2));
      g.add(extrude(outer, 250, mat('#cfcdc8'), E - 250));
      const room = rooms.find((r) => G.pointInPoly(r.seed, f.pts));
      const fl = FLOORS[room?.floor] || FLOORS.none;
      const floor = new THREE.Mesh(new THREE.ShapeGeometry(shapeOf(f.inner)), mat(fl.color, { roughness: 0.6 }));
      floor.rotation.x = -Math.PI / 2; floor.position.y = E + 4; floor.receiveShadow = true;
      g.add(floor);
      if (this.opts.roof && isTop) {
        const over = G.offsetPoly(f.pts, -(maxT / 2 + 200));
        const roof = extrude(over, 220, mat('#8b8f95', { roughness: 0.7 }), E + lv.height);
        g.add(roof);
      }
    }

    // furniture
    for (const f of store.list('furniture', lv.id)) {
      const item = byId[f.lib];
      if (!item) continue;
      const fg = new THREE.Group();
      for (const p of item.parts(f.w, f.d, f.h)) {
        const geo = p.kind === 'cyl' ? new THREE.CylinderGeometry(p.w / 2, p.w / 2, p.h, 28) : new THREE.BoxGeometry(p.w, p.h, p.d);
        const m = new THREE.Mesh(geo, mat(p.color));
        m.position.set(p.x, p.z + p.h / 2, p.y);
        m.castShadow = m.receiveShadow = true;
        fg.add(m);
      }
      fg.position.set(f.x, E + 5, f.y);
      fg.rotation.y = -(f.rot || 0);
      g.add(fg);
    }
    this.model.add(g);
  }

  addOpening(g, o, w, P, E) {
    const gm = doorGeom(o, w, P);
    const ang = -Math.atan2(P.d.y, P.d.x);
    const t = w.thickness;
    const place = (bw, bh, bt, off, y0, material, shadow = true, across = 0) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(bw, bh, bt), material);
      const cx = gm.c.x + P.d.x * off + P.n.x * across, cy = gm.c.y + P.d.y * off + P.n.y * across;
      m.position.set(cx, E + y0 + bh / 2, cy);
      m.rotation.y = ang;
      m.castShadow = shadow; m.receiveShadow = true;
      g.add(m);
    };
    const W = o.width, H = o.height;
    if (o.kind === 'window') {
      const sill = o.sill || 0, f = 55;
      const frame = mat('#f7f7f5');
      place(W, f, t * 0.55, 0, sill, frame); place(W, f, t * 0.55, 0, sill + H - f, frame);
      place(f, H - 2 * f, t * 0.55, -W / 2 + f / 2, sill + f, frame); place(f, H - 2 * f, t * 0.55, W / 2 - f / 2, sill + f, frame);
      if (o.style === 'casement' && W > 900) place(f * 0.8, H - 2 * f, t * 0.5, 0, sill + f, frame);
      place(W - 2 * f, H - 2 * f, 10, 0, sill + f, mat('#9cc7ea', { transparent: true, opacity: 0.38, roughness: 0.05, metalness: 0.2 }), false);
      place(W + 80, 40, t + 70, 0, sill - 40, mat('#e4e2dc'));
    } else if (o.style === 'open') {
      const f = 40;
      place(f, H, t + 20, -W / 2 + f / 2, 0, mat('#f7f7f5')); place(f, H, t + 20, W / 2 - f / 2, 0, mat('#f7f7f5')); place(W, f, t + 20, 0, H - f, mat('#f7f7f5'));
    } else {
      const frame = mat('#f7f7f5'), leaf = mat('#a97c56', { roughness: 0.6 });
      const f = 40;
      place(f, H, t + 20, -W / 2 + f / 2, 0, frame); place(f, H, t + 20, W / 2 - f / 2, 0, frame); place(W, f, t + 20, 0, H - f, frame);
      if (o.style === 'double') { place(W / 2 - f, H - f, 40, -W / 4, 0, leaf); place(W / 2 - f, H - f, 40, W / 4, 0, leaf); }
      else if (o.style === 'slide') { place(W / 2, H - f, 30, -W / 4, 0, mat('#cfe3f1', { transparent: true, opacity: 0.45 }), false, -t * 0.15); place(W / 2, H - f, 30, W / 4, 0, mat('#cfe3f1', { transparent: true, opacity: 0.45 }), false, t * 0.15); }
      else place(W - 2 * f, H - f, 44, 0, 0, leaf, true, 0);
    }
  }

  updateSun() {
    const b = this.bounds, c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, 6000) * 0.9;
    const az = G.rad(this.opts.sunAz), el = G.rad(this.opts.sunEl);
    this.sun.position.set(c.x + Math.sin(az) * Math.cos(el) * r * 2, Math.sin(el) * r * 2, c.z + Math.cos(az) * Math.cos(el) * r * 2);
    this.sun.target.position.copy(c);
    const cam = this.sun.shadow.camera;
    cam.left = -r; cam.right = r; cam.top = r; cam.bottom = -r; cam.near = 100; cam.far = r * 6;
    cam.updateProjectionMatrix();
    this.sun.target.updateMatrixWorld();
    this.requestRender();
  }

  setSun(az, el) { this.opts.sunAz = az; this.opts.sunEl = el; if (this.bounds) this.updateSun(); }

  fit() {
    const b = this.bounds || new THREE.Box3(new THREE.Vector3(-3000, 0, -3000), new THREE.Vector3(3000, 3000, 3000));
    const c = b.getCenter(new THREE.Vector3()), size = b.getSize(new THREE.Vector3());
    const r = Math.max(size.x, size.z, size.y, 4000);
    this.controls.target.set(c.x, Math.max(0, c.y * 0.6), c.z);
    this.camera.position.set(c.x + r * 0.9, r * 0.85 + c.y, c.z + r * 1.25);
    this.controls.update();
    this.requestRender();
  }

  /** Render to PNG at the current size, optionally scaled up. */
  capture(scale = 2) {
    const r = this.renderer, pr = r.getPixelRatio();
    const w = this.container.clientWidth, h = this.container.clientHeight;
    r.setPixelRatio(scale); r.setSize(w, h, false);
    r.render(this.scene, this.camera);
    const url = r.domElement.toDataURL('image/png');
    r.setPixelRatio(pr); r.setSize(w, h, false);
    this.requestRender();
    return url;
  }
}
