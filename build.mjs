// Build step: node build.mjs
//  - draws the app icons if missing (node build.mjs --icons to redraw)
//  - hashes the app files into a build id (js/version.js)
//  - writes the offline file list + cache version into sw.js
// Run it before every deploy so installed copies notice the update and refresh their offline cache.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { makeIcons } from './tools/icons.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const rel = (p) => path.relative(root, p).split(path.sep).join('/');

if (process.argv.includes('--icons') || !fs.existsSync(path.join(root, 'icon-512.png'))) console.log('icons:', makeIcons().join(', '));

const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]));
const files = [
  'index.html', 'manifest.webmanifest', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  ...walk(path.join(root, 'css')).map(rel), ...walk(path.join(root, 'js')).map(rel), ...walk(path.join(root, 'vendor')).map(rel),
].sort();

const h = crypto.createHash('sha1');
for (const f of files) if (f !== 'js/version.js') { h.update(f); h.update(fs.readFileSync(path.join(root, f))); }
const id = h.digest('hex').slice(0, 8);
const stamp = new Date().toISOString().slice(0, 10);
fs.writeFileSync(path.join(root, 'js/version.js'), `export const BUILD = '${id} · ${stamp}';\n`);

const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const block = `/*BUILD:START*/\nconst VERSION = '${id}';\nconst FILES = ${JSON.stringify(['./', ...files.map((f) => './' + f)], null, 1)};\n/*BUILD:END*/`;
sw = sw.replace(/\/\*BUILD:START\*\/[\s\S]*?\/\*BUILD:END\*\//, block);
fs.writeFileSync(swPath, sw);
console.log(`build ${id}: ${files.length} files cached for offline use`);
