// Service worker: precaches the whole app so it opens and works with no connection.
// The block below is rewritten by `node build.mjs`.
/*BUILD:START*/
const VERSION = '43be9770';
const FILES = [
 "./",
 "./css/app.css",
 "./icon-180.png",
 "./icon-192.png",
 "./icon-512.png",
 "./icon-maskable-512.png",
 "./index.html",
 "./js/dom.js",
 "./js/editor.js",
 "./js/geom.js",
 "./js/import/convert.js",
 "./js/import/dxf.js",
 "./js/import/pointcloud.js",
 "./js/import/raster.js",
 "./js/import/roomplan.js",
 "./js/import/svg.js",
 "./js/importer.js",
 "./js/library.js",
 "./js/main.js",
 "./js/refs.js",
 "./js/render2d.js",
 "./js/sample.js",
 "./js/sheet.js",
 "./js/store.js",
 "./js/svgctx.js",
 "./js/ui.js",
 "./js/units.js",
 "./js/version.js",
 "./js/view3d.js",
 "./js/walls.js",
 "./manifest.webmanifest",
 "./vendor/pdfjs/pdf.min.mjs",
 "./vendor/pdfjs/pdf.worker.min.mjs",
 "./vendor/three/addons/OrbitControls.js",
 "./vendor/three/three.module.js"
];
/*BUILD:END*/

const CACHE = 'plan-' + VERSION;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(new Request(f, { cache: 'reload' })))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('plan-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
      try {
        const res = await fetch(req);
        if (res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        if (req.mode === 'navigate') { const page = await cache.match('./index.html'); if (page) return page; }
        throw err;
      }
    }),
  );
});
