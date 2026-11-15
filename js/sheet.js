// Print sheets: vector SVG at true scale with border, title block, north arrow and scale bar.

import { store } from './store.js';
import { SvgCtx } from './svgctx.js';
import { drawPlan, textBounds } from './render2d.js';
import { polysFor, wallsOnLevel } from './walls.js';
import { units, fmtLen, FT } from './units.js';
import * as G from './geom.js';

export const PAPERS = {
  letter: { name: 'Letter  8.5 × 11 in', w: 279.4, h: 215.9 },
  tabloid: { name: 'Tabloid  11 × 17 in', w: 431.8, h: 279.4 },
  archc: { name: 'ARCH C  18 × 24 in', w: 609.6, h: 457.2 },
  archd: { name: 'ARCH D  24 × 36 in', w: 914.4, h: 609.6 },
  a4: { name: 'A4', w: 297, h: 210 },
  a3: { name: 'A3', w: 420, h: 297 },
  a1: { name: 'A1', w: 841, h: 594 },
};

export const SCALES = {
  imperial: [
    { ratio: 12, label: '1" = 1\'-0"' }, { ratio: 16, label: '3/4" = 1\'-0"' }, { ratio: 24, label: '1/2" = 1\'-0"' },
    { ratio: 32, label: '3/8" = 1\'-0"' }, { ratio: 48, label: '1/4" = 1\'-0"' }, { ratio: 64, label: '3/16" = 1\'-0"' },
    { ratio: 96, label: '1/8" = 1\'-0"' }, { ratio: 192, label: '1/16" = 1\'-0"' },
  ],
  metric: [20, 25, 50, 75, 100, 125, 200, 250, 500].map((r) => ({ ratio: r, label: `1:${r}` })),
};

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const FONT = "Inter, 'Segoe UI', Arial, Helvetica, sans-serif";

export function contentBounds(levelId, o = {}) {
  const pts = [];
  const polys = polysFor(store, levelId);
  for (const w of wallsOnLevel(store, levelId)) { const P = polys.get(w.id); if (P) pts.push(P.aL, P.aR, P.bL, P.bR); }
  if (o.furn !== false) for (const f of store.list('furniture', levelId)) pts.push(...G.rectCorners(f.x, f.y, f.w, f.d, f.rot || 0));
  for (const t of store.list('text', levelId)) { const b = textBounds(t); pts.push({ x: b.x0, y: b.y0 }, { x: b.x1, y: b.y1 }); }
  for (const d of store.list('dim', levelId)) {
    const n = G.leftN(G.norm(G.sub(d.b, d.a))), off = d.off ?? 600;
    pts.push(d.a, d.b, { x: d.a.x + n.x * off, y: d.a.y + n.y * off }, { x: d.b.x + n.x * off, y: d.b.y + n.y * off });
  }
  return G.bbox(pts);
}

export function buildSheet(o) {
  const level = store.project.levels.find((l) => l.id === o.levelId) || store.level;
  const paper = PAPERS[o.paper] || PAPERS.archd;
  const portrait = o.orientation === 'portrait';
  const W = portrait ? paper.h : paper.w, H = portrait ? paper.w : paper.h;
  const M = 8, TB = Math.min(64, W * 0.24);
  const area = { x: M + 6, y: M + 6, w: W - 2 * M - TB - 12, h: H - 2 * M - 12 };
  const meta = store.project.meta;

  let bb = contentBounds(level.id, o);
  if (!bb) bb = { x0: 0, y0: 0, x1: 4000, y1: 3000, w: 4000, h: 3000, cx: 2000, cy: 1500 };
  const pad = o.autoDims ? 1600 : 700;
  const need = { w: bb.w + pad * 2, h: bb.h + pad * 2 };
  const titleSpace = 22; // paper mm reserved under the plan for the sheet title / scale bar
  const list = SCALES[units.system];
  let sc = list.find((s) => 'r' + s.ratio === String(o.scale));
  if (!sc) {
    sc = list.filter((s) => s.ratio >= 20).find((s) => need.w / s.ratio <= area.w && need.h / s.ratio <= area.h - titleSpace) || list[list.length - 1];
  }
  const ratio = sc.ratio;
  const u = 0.2 * ratio; // one 0.2 mm paper line unit, in world mm
  const tx = area.x + area.w / 2 - bb.cx / ratio;
  const ty = area.y + (area.h - titleSpace) / 2 - bb.cy / ratio;

  const ctx = new SvgCtx();
  drawPlan(ctx, {
    levelId: level.id, u, screen: false, layers: { furn: o.furn !== false, dims: true, rooms: true, notes: true },
    roomFills: !!o.roomFills, autoDims: !!o.autoDims,
  });
  const plan = ctx.toString();

  const dateStr = new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  const title = (o.title || `${level.name} Plan`).toUpperCase();
  const tbx = W - M - TB;

  // scale bar (paper mm)
  const barWorld = units.system === 'imperial' ? (ratio >= 96 ? 10 * FT : 5 * FT) : (ratio >= 100 ? 5000 : 2000);
  const nSeg = 4, barP = barWorld / ratio, segP = barP / nSeg;
  const bx = area.x + 4, by = area.y + area.h - 8;
  let bar = '';
  for (let i = 0; i < nSeg; i++) bar += `<rect x="${bx + i * segP}" y="${by}" width="${segP}" height="2" fill="${i % 2 ? '#fff' : '#000'}" stroke="#000" stroke-width="0.2"/>`;
  bar += `<text x="${bx}" y="${by - 1.2}" font-size="2.2" font-family="${FONT}">0</text>`;
  bar += `<text x="${bx + barP}" y="${by - 1.2}" font-size="2.2" font-family="${FONT}" text-anchor="middle">${esc(fmtLen(barWorld))}</text>`;

  // north arrow
  const nx = area.x + area.w - 14, ny = area.y + 14;
  const north = `<g transform="translate(${nx} ${ny})"><circle r="7" fill="none" stroke="#000" stroke-width="0.3"/><path d="M0 -6.2 L2.6 3 L0 1.6 L-2.6 3 Z" fill="#000"/><text y="-8.2" font-size="3.2" font-weight="700" font-family="${FONT}" text-anchor="middle">N</text></g>`;

  // sheet title under the drawing
  const cx = area.x + area.w / 2, cy = area.y + area.h - 11;
  const titleSvg = `<g><circle cx="${cx - 40}" cy="${cy}" r="0" /><text x="${cx}" y="${cy}" font-size="5.2" font-weight="700" font-family="${FONT}" text-anchor="middle">${esc(title)}</text>
    <line x1="${cx - 45}" y1="${cy + 2}" x2="${cx + 45}" y2="${cy + 2}" stroke="#000" stroke-width="0.7"/>
    <text x="${cx}" y="${cy + 6.5}" font-size="3" font-family="${FONT}" text-anchor="middle">SCALE: ${esc(sc.label)}</text></g>`;

  const row = (label, value, y) => `<text x="${tbx + 4}" y="${y}" font-size="2.2" fill="#666" font-family="${FONT}">${label}</text><text x="${tbx + 4}" y="${y + 4.6}" font-size="3.4" font-family="${FONT}">${esc(value || '—')}</text>`;
  const th = H - 2 * M;
  const block = `
    <rect x="${tbx}" y="${M}" width="${TB}" height="${th}" fill="#fff" stroke="#000" stroke-width="0.7"/>
    <text x="${tbx + 4}" y="${M + 11}" font-size="5" font-weight="700" font-family="${FONT}">${esc(store.project.name)}</text>
    <text x="${tbx + 4}" y="${M + 17}" font-size="3" fill="#444" font-family="${FONT}">${esc(meta.address)}</text>
    <line x1="${tbx}" y1="${M + 24}" x2="${tbx + TB}" y2="${M + 24}" stroke="#000" stroke-width="0.35"/>
    ${row('CLIENT', meta.client, M + 31)}
    ${row('DRAWN BY', meta.drawnBy, M + 43)}
    ${row('DATE', dateStr, M + 55)}
    ${row('SCALE', sc.label, M + 67)}
    <line x1="${tbx}" y1="${H - M - 44}" x2="${tbx + TB}" y2="${H - M - 44}" stroke="#000" stroke-width="0.35"/>
    <text x="${tbx + 4}" y="${H - M - 36}" font-size="2.2" fill="#666" font-family="${FONT}">SHEET TITLE</text>
    <text x="${tbx + 4}" y="${H - M - 30}" font-size="4" font-weight="700" font-family="${FONT}">${esc(title)}</text>
    <text x="${tbx + 4}" y="${H - M - 14}" font-size="2.2" fill="#666" font-family="${FONT}">SHEET NO.</text>
    <text x="${tbx + 4}" y="${H - M - 4}" font-size="10" font-weight="700" font-family="${FONT}">${esc(meta.sheetNo)}</text>
    <text x="${tbx + TB - 4}" y="${H - M - 4}" font-size="2" fill="#888" font-family="${FONT}" text-anchor="end">NOT FOR CONSTRUCTION</text>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}" font-family="${FONT}">
  <rect width="${W}" height="${H}" fill="#fff"/>
  <rect x="${M}" y="${M}" width="${W - 2 * M}" height="${H - 2 * M}" fill="none" stroke="#000" stroke-width="0.7"/>
  <rect x="${M - 3}" y="${M - 3}" width="${W - 2 * M + 6}" height="${H - 2 * M + 6}" fill="none" stroke="#000" stroke-width="0.2"/>
  <g transform="translate(${tx} ${ty}) scale(${1 / ratio})">${plan}</g>
  ${bar}${north}${titleSvg}${block}
</svg>`;
  return { svg, width: W, height: H, scaleLabel: sc.label, ratio };
}

export function printSvg(svg, w, h, title = 'Plan') {
  const win = window.open('', '_blank');
  if (!win) { alert('Please allow pop-ups to print.'); return; }
  win.document.write(`<!doctype html><html><head><title>${esc(title)}</title><style>
    @page { size: ${w}mm ${h}mm; margin: 0 }
    html,body { margin:0; padding:0; background:#fff }
    svg { display:block }
    @media screen { body { background:#888; padding:16px } svg { background:#fff; box-shadow:0 2px 16px rgba(0,0,0,.4); max-width:100%; height:auto } }
  </style></head><body>${svg}<script>window.onload=()=>setTimeout(()=>window.print(),300)<\/script></body></html>`);
  win.document.close();
}

export function downloadText(name, text, type = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
