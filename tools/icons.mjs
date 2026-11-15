// Draws the app icons (no image libraries): node tools/icons.mjs
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const crcTable = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 4 + 1)] = 0; rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4); }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

// glyph in a 32x32 design grid (matches the favicon): a room with a partition
const SEGS = [[7, 25, 7, 7], [7, 7, 25, 7], [25, 7, 25, 25], [25, 25, 7, 25], [7, 15, 17, 15], [17, 15, 17, 25]];
const HALF = 1.3;
const segDist = (px, py, [x1, y1, x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1, t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
};

function render(size, { rounded }) {
  const buf = Buffer.alloc(size * size * 4);
  const SS = 3, bg = [47, 109, 246], r = (7 / 32) * size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let bgA = 0, fgA = 0;
    for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
      const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
      let inside = true;
      if (rounded) {
        const cx = Math.min(Math.max(px, r), size - r), cy = Math.min(Math.max(py, r), size - r);
        inside = Math.hypot(px - cx, py - cy) <= r;
      }
      if (inside) bgA++;
      const gx = (px / size) * 32, gy = (py / size) * 32;
      if (inside && SEGS.some((s) => segDist(gx, gy, s) <= HALF)) fgA++;
    }
    const a = bgA / (SS * SS), f = fgA / bgA || 0;
    const i = (y * size + x) * 4;
    buf[i] = Math.round(bg[0] * (1 - f) + 255 * f); buf[i + 1] = Math.round(bg[1] * (1 - f) + 255 * f); buf[i + 2] = Math.round(bg[2] * (1 - f) + 255 * f);
    buf[i + 3] = Math.round(a * 255);
  }
  return png(size, size, buf);
}

export function makeIcons() {
  const out = {
    'icon-192.png': render(192, { rounded: true }),
    'icon-512.png': render(512, { rounded: true }),
    'icon-maskable-512.png': render(512, { rounded: false }),
    'icon-180.png': render(180, { rounded: false }),
  };
  for (const [name, data] of Object.entries(out)) fs.writeFileSync(path.join(root, name), data);
  return Object.keys(out);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log('wrote', makeIcons().join(', '));
