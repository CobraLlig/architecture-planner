// Furniture & fixture catalogue. Each item has a 2D plan symbol and a simple 3D massing model.
// Local frame for drawing: origin at the centre, x = width, y = depth, back of item at y = -d/2.
// Adding an item = add one entry here. Electrical / plumbing / structural symbols will reuse this shape.

const INK = '#2b2f36';
const COL = {
  fab: '#97a6b5', fab2: '#c4b5a0', wood: '#b58863', woodD: '#7a5a42', white: '#eceff1', steel: '#b8bfc7',
  dark: '#3b3f45', ceramic: '#f3f5f6', green: '#6f9d69', blue: '#8fb3cf', rug: '#c9a99a', stone: '#d5d3cf',
};

// ---- 2D drawing helpers (assume ctx.lineWidth already set) -------------------
function rrPath(c, x, y, w, h, r = 0) {
  r = Math.min(r, w / 2, h / 2);
  c.beginPath();
  if (r <= 0) { c.rect(x, y, w, h); return; }
  c.moveTo(x + r, y);
  c.lineTo(x + w - r, y); c.arc(x + w - r, y + r, r, -Math.PI / 2, 0);
  c.lineTo(x + w, y + h - r); c.arc(x + w - r, y + h - r, r, 0, Math.PI / 2);
  c.lineTo(x + r, y + h); c.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI);
  c.lineTo(x, y + r); c.arc(x + r, y + r, r, Math.PI, Math.PI * 1.5);
  c.closePath();
}
function box(c, x, y, w, h, r = 0, fill = '#fff') {
  rrPath(c, x, y, w, h, r);
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.stroke();
}
function line(c, x1, y1, x2, y2) { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
function circ(c, x, y, r, fill = '#fff') {
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.stroke();
}
function oval(c, x, y, rx, ry, fill = '#fff') {
  c.save(); c.translate(x, y); c.scale(1, ry / rx);
  c.beginPath(); c.arc(0, 0, rx, 0, Math.PI * 2);
  if (fill) { c.fillStyle = fill; c.fill(); }
  c.stroke(); c.restore();
}
function label(c, t, size, y = 0) {
  c.save(); c.fillStyle = '#5b626c'; c.font = `${size}px Inter, Segoe UI, Arial, sans-serif`;
  c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(t, 0, y); c.restore();
}

// ---- 3D part helper: absolute mm box centred at (x,y), base at z ----------------
const B = (x, y, z, w, d, h, color, kind = 'box') => ({ x, y, z, w, d, h, color, kind });

// ---- generic symbol recipes ----------------------------------------------------
function sofaSym(c, w, d) {
  const arm = Math.min(160, w * 0.1), back = d * 0.26;
  box(c, -w / 2, -d / 2, w, d, 70, '#fff');
  box(c, -w / 2, -d / 2, w, back, 50, '#eef0f2');
  box(c, -w / 2, -d / 2 + back * 0.4, arm, d - back * 0.4, 50, '#eef0f2');
  box(c, w / 2 - arm, -d / 2 + back * 0.4, arm, d - back * 0.4, 50, '#eef0f2');
  const inner = w - arm * 2, n = Math.max(1, Math.round(inner / 700));
  for (let i = 1; i < n; i++) line(c, -w / 2 + arm + (inner * i) / n, -d / 2 + back, -w / 2 + arm + (inner * i) / n, d / 2);
}
function sofaParts(w, d, h) {
  const arm = Math.min(160, w * 0.1);
  return [
    B(0, 0, 80, w - 2 * arm, d, h * 0.5 - 80, COL.fab),
    B(-w / 2 + arm / 2, 0, 80, arm, d, h * 0.65, COL.fab),
    B(w / 2 - arm / 2, 0, 80, arm, d, h * 0.65, COL.fab),
    B(0, -d / 2 + d * 0.13, 80, w - 2 * arm, d * 0.26, h - 80, COL.fab),
    B(-w / 2 + 60, 0, 0, 60, d - 100, 80, COL.dark), B(w / 2 - 60, 0, 0, 60, d - 100, 80, COL.dark),
  ];
}
function bedSym(c, w, d, pillows) {
  box(c, -w / 2, -d / 2, w, d, 40, '#fff');
  const pw = pillows === 1 ? w * 0.7 : w * 0.42, ph = Math.min(d * 0.14, 380);
  if (pillows === 1) box(c, -pw / 2, -d / 2 + 80, pw, ph, 80, '#f1f3f5');
  else { box(c, -w / 2 + w * 0.05, -d / 2 + 80, pw, ph, 80, '#f1f3f5'); box(c, w / 2 - w * 0.05 - pw, -d / 2 + 80, pw, ph, 80, '#f1f3f5'); }
  c.beginPath(); c.moveTo(-w / 2, -d / 2 + d * 0.33); c.lineTo(w / 2, -d / 2 + d * 0.33); c.stroke();
  box(c, -w / 2 + 40, -d / 2 + d * 0.33, w - 80, d * 0.67 - 40, 30, null);
}
function bedParts(w, d, h) {
  return [
    B(0, 0, 0, w, d, h * 0.45, COL.woodD),
    B(0, 40, h * 0.45, w - 60, d - 120, h * 0.3, '#e8e4dc'),
    B(0, -d / 2 + 30, 0, w, 60, h * 1.5, COL.woodD),
    B(-w * 0.22, -d / 2 + 340, h * 0.75, w * 0.36, 380, 110, '#fafafa'),
    B(w * 0.22, -d / 2 + 340, h * 0.75, w * 0.36, 380, 110, '#fafafa'),
  ];
}
function chairSym(c, w, d) {
  box(c, -w / 2, -d / 2, w, d, 40, '#fff');
  box(c, -w / 2 + 20, -d / 2, w - 40, d * 0.22, 20, '#eef0f2');
}
function chairParts(w, d, h) {
  return [
    B(0, 0, h * 0.45, w, d, 50, COL.wood),
    B(0, -d / 2 + 25, h * 0.45, w, 50, h * 0.55, COL.wood),
    B(-w / 2 + 25, d / 2 - 25, 0, 40, 40, h * 0.45, COL.woodD), B(w / 2 - 25, d / 2 - 25, 0, 40, 40, h * 0.45, COL.woodD),
    B(-w / 2 + 25, -d / 2 + 25, 0, 40, 40, h * 0.45, COL.woodD), B(w / 2 - 25, -d / 2 + 25, 0, 40, 40, h * 0.45, COL.woodD),
  ];
}
function tableParts(w, d, h, kind = 'box') {
  const t = 45;
  const parts = [B(0, 0, h - t, w, d, t, COL.wood, kind)];
  if (kind === 'cyl') parts.push(B(0, 0, 0, Math.min(w, d) * 0.15, Math.min(w, d) * 0.15, h - t, COL.woodD, 'cyl'));
  else for (const sx of [-1, 1]) for (const sy of [-1, 1]) parts.push(B(sx * (w / 2 - 50), sy * (d / 2 - 50), 0, 60, 60, h - t, COL.woodD));
  return parts;
}
function cabinetSym(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); line(c, -w / 2, d / 2 - d * 0.08, w / 2, d / 2 - d * 0.08); }
function cabinetParts(w, d, h, color = COL.white) { return [B(0, 0, 0, w, d, h - 40, color), B(0, 0, h - 40, w + 30, d + 30, 40, COL.stone)]; }

export const LIB = [
  // ---------- Living ----------
  { id: 'sofa3', name: 'Sofa, 3-seat', cat: 'Living', w: 2130, d: 920, h: 850, draw: sofaSym, parts: sofaParts },
  { id: 'sofa2', name: 'Loveseat', cat: 'Living', w: 1520, d: 920, h: 850, draw: sofaSym, parts: sofaParts },
  { id: 'sectional', name: 'Sofa, 2-seat + chaise', cat: 'Living', w: 2400, d: 1600, h: 850,
    draw(c, w, d) { sofaSym(c, w, d * 0.58); c.save(); c.translate(0, -d / 2 + (d * 0.58) / 2); c.restore();
      box(c, w / 2 - 900, -d / 2 + d * 0.58, 900, d * 0.42, 50, '#fff'); },
    parts: (w, d, h) => [...sofaParts(w, d * 0.58, h).map((p) => ({ ...p, y: p.y - d * 0.21 })), B(w / 2 - 450, d / 2 - d * 0.21, 80, 900, d * 0.42, h * 0.45, COL.fab)] },
  { id: 'armchair', name: 'Armchair', cat: 'Living', w: 900, d: 900, h: 850, draw: sofaSym, parts: sofaParts },
  { id: 'coffee', name: 'Coffee table', cat: 'Living', w: 1200, d: 600, h: 430,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 40, '#fff'); box(c, -w / 2 + 60, -d / 2 + 60, w - 120, d - 120, 20, null); }, parts: (w, d, h) => tableParts(w, d, h) },
  { id: 'side', name: 'Side table', cat: 'Living', w: 500, d: 500, h: 550, shape: 'round',
    draw(c, w) { circ(c, 0, 0, w / 2); circ(c, 0, 0, w / 2 - 50, null); }, parts: (w, d, h) => tableParts(w, d, h, 'cyl') },
  { id: 'tvstand', name: 'TV stand', cat: 'Living', w: 1600, d: 450, h: 550,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); box(c, -w * 0.3, -d / 2 + 60, w * 0.6, 40, 0, '#3b3f45'); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.woodD), B(0, 0, h, w * 0.6, 50, h * 0.9, COL.dark)] },
  { id: 'bookcase', name: 'Bookcase', cat: 'Living', w: 900, d: 300, h: 1850,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); line(c, -w / 2, -d / 2, w / 2, d / 2); line(c, -w / 2, d / 2, w / 2, -d / 2); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.wood)] },
  { id: 'rug', name: 'Area rug', cat: 'Living', w: 2400, d: 1700, h: 15, flat: true,
    draw(c, w, d) { c.save(); c.setLineDash([c.lineWidth * 5, c.lineWidth * 3]); box(c, -w / 2, -d / 2, w, d, 30, 'rgba(200,170,150,.18)'); c.restore(); box(c, -w / 2 + 90, -d / 2 + 90, w - 180, d - 180, 20, null); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.rug)] },
  { id: 'fireplace', name: 'Fireplace', cat: 'Living', w: 1500, d: 450, h: 1200,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#e9e6e1'); box(c, -w * 0.28, -d / 2 + 40, w * 0.56, d - 80, 0, '#fff'); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.stone)] },

  // ---------- Dining & Office ----------
  { id: 'dtable', name: 'Dining table', cat: 'Dining & Office', w: 1800, d: 900, h: 760,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 30, '#fff'); box(c, -w / 2 + 70, -d / 2 + 70, w - 140, d - 140, 10, null); }, parts: (w, d, h) => tableParts(w, d, h) },
  { id: 'rtable', name: 'Round table', cat: 'Dining & Office', w: 1200, d: 1200, h: 760, shape: 'round',
    draw(c, w) { circ(c, 0, 0, w / 2); circ(c, 0, 0, w / 2 - 70, null); }, parts: (w, d, h) => tableParts(w, d, h, 'cyl') },
  { id: 'chair', name: 'Dining chair', cat: 'Dining & Office', w: 460, d: 460, h: 900, draw: chairSym, parts: chairParts },
  { id: 'desk', name: 'Desk', cat: 'Dining & Office', w: 1500, d: 750, h: 740,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); box(c, -300, -d / 2 + 110, 600, 40, 0, '#eef0f2'); box(c, -w / 2 + 40, d / 2 - 260, 360, 190, 0, null); },
    parts: (w, d, h) => tableParts(w, d, h) },
  { id: 'ochair', name: 'Office chair', cat: 'Dining & Office', w: 620, d: 620, h: 950, shape: 'round',
    draw(c, w) { circ(c, 0, 0, w / 2 - 20); c.beginPath(); c.arc(0, 0, w / 2, Math.PI * 1.15, Math.PI * 1.85); c.stroke(); },
    parts: (w, d, h) => [B(0, 0, 0, w * 0.15, w * 0.15, h * 0.45, COL.dark, 'cyl'), B(0, 0, h * 0.45, w * 0.8, w * 0.8, 70, COL.dark, 'cyl'), B(0, -w * 0.35, h * 0.5, w * 0.7, 60, h * 0.5, COL.dark)] },
  { id: 'filecab', name: 'Filing cabinet', cat: 'Dining & Office', w: 460, d: 620, h: 720, draw: cabinetSym, parts: (w, d, h) => cabinetParts(w, d, h, COL.steel) },

  // ---------- Bedroom ----------
  { id: 'bedq', name: 'Bed, queen', cat: 'Bedroom', w: 1520, d: 2030, h: 600, draw: (c, w, d) => bedSym(c, w, d, 2), parts: bedParts },
  { id: 'bedk', name: 'Bed, king', cat: 'Bedroom', w: 1930, d: 2030, h: 600, draw: (c, w, d) => bedSym(c, w, d, 2), parts: bedParts },
  { id: 'bedt', name: 'Bed, twin', cat: 'Bedroom', w: 970, d: 1900, h: 600, draw: (c, w, d) => bedSym(c, w, d, 1), parts: bedParts },
  { id: 'nightstand', name: 'Nightstand', cat: 'Bedroom', w: 500, d: 450, h: 600,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); circ(c, 0, -d * 0.1, Math.min(w, d) * 0.22, null); }, parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.wood)] },
  { id: 'dresser', name: 'Dresser', cat: 'Bedroom', w: 1500, d: 500, h: 850,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); for (let i = 1; i < 3; i++) line(c, -w / 2 + (w * i) / 3, -d / 2, -w / 2 + (w * i) / 3, d / 2); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.wood)] },
  { id: 'wardrobe', name: 'Wardrobe', cat: 'Bedroom', w: 1200, d: 600, h: 2000,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); line(c, -w / 2, -d / 2, 0, d / 2); line(c, 0, d / 2, w / 2, -d / 2); line(c, 0, -d / 2, 0, d / 2); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.wood)] },

  // ---------- Kitchen ----------
  { id: 'fridge', name: 'Refrigerator', cat: 'Kitchen', w: 900, d: 750, h: 1750,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); line(c, -w / 2, -d / 2 + d * 0.15, w / 2, -d / 2 + d * 0.15); label(c, 'REF', Math.min(w, d) * 0.22, d * 0.05); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.steel)] },
  { id: 'range', name: 'Range / oven', cat: 'Kitchen', w: 760, d: 650, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); const r = Math.min(w, d) * 0.16; for (const [x, y] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) circ(c, x * w * 0.22, y * d * 0.2, r, null); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.steel), B(0, 0, h, w - 40, d - 40, 20, COL.dark)] },
  { id: 'ksink', name: 'Kitchen sink', cat: 'Kitchen', w: 1000, d: 600, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); box(c, -w / 2 + 60, -d / 2 + 70, w / 2 - 80, d - 140, 60, '#eaf1f6'); box(c, 20, -d / 2 + 70, w / 2 - 80, d - 140, 60, '#eaf1f6'); circ(c, 0, -d / 2 + 30, 18, null); },
    parts: (w, d, h) => [...cabinetParts(w, d, h), B(0, 0, h, w - 140, d - 140, 5, COL.blue)] },
  { id: 'dishwasher', name: 'Dishwasher', cat: 'Kitchen', w: 600, d: 600, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); label(c, 'DW', Math.min(w, d) * 0.28); }, parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.steel)] },
  { id: 'basecab', name: 'Base cabinet', cat: 'Kitchen', w: 600, d: 600, h: 900, draw: cabinetSym, parts: (w, d, h) => cabinetParts(w, d, h) },
  { id: 'island', name: 'Kitchen island', cat: 'Kitchen', w: 1800, d: 900, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); box(c, -w / 2 + 60, -d / 2 + 60, w - 120, d - 120, 10, null); }, parts: (w, d, h) => cabinetParts(w, d, h) },

  // ---------- Bath & Laundry ----------
  { id: 'toilet', name: 'Toilet', cat: 'Bath & Laundry', w: 400, d: 700, h: 750,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d * 0.28, 30, '#fff'); oval(c, 0, d * 0.12, w / 2, d * 0.34, '#fff'); },
    parts: (w, d, h) => [B(0, -d / 2 + d * 0.14, 0, w, d * 0.28, h, COL.ceramic), B(0, d * 0.1, 0, w * 0.9, d * 0.6, h * 0.55, COL.ceramic)] },
  { id: 'vanity', name: 'Vanity with sink', cat: 'Bath & Laundry', w: 900, d: 550, h: 850,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); oval(c, 0, 20, w * 0.22, d * 0.28, '#eaf1f6'); circ(c, 0, -d / 2 + 50, 15, null); },
    parts: (w, d, h) => [...cabinetParts(w, d, h), B(0, 20, h, w * 0.4, d * 0.5, 5, COL.blue)] },
  { id: 'bathtub', name: 'Bathtub', cat: 'Bath & Laundry', w: 1520, d: 760, h: 550,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 60, '#fff'); box(c, -w / 2 + 70, -d / 2 + 70, w - 140, d - 140, 120, '#eaf1f6'); circ(c, -w / 2 + 200, 0, 25, null); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.ceramic), B(0, 0, h - 5, w - 140, d - 140, 5, COL.blue)] },
  { id: 'shower', name: 'Shower', cat: 'Bath & Laundry', w: 900, d: 900, h: 2000,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 0, '#fff'); line(c, -w / 2, -d / 2, w / 2, d / 2); circ(c, 0, 0, 35, null); },
    parts: (w, d, h) => [B(0, 0, 0, w, d, 80, COL.ceramic), B(0, d / 2 - 15, 0, w, 20, h, '#cfe3ef'), B(w / 2 - 15, 0, 0, 20, d, h, '#cfe3ef')] },
  { id: 'washer', name: 'Washer', cat: 'Bath & Laundry', w: 680, d: 700, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); circ(c, 0, d * 0.05, w * 0.3, null); label(c, 'W', 150, -d * 0.36); }, parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.white)] },
  { id: 'dryer', name: 'Dryer', cat: 'Bath & Laundry', w: 680, d: 700, h: 900,
    draw(c, w, d) { box(c, -w / 2, -d / 2, w, d, 20, '#fff'); circ(c, 0, d * 0.05, w * 0.3, null); label(c, 'D', 150, -d * 0.36); }, parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.white)] },
  { id: 'waterheater', name: 'Water heater', cat: 'Bath & Laundry', w: 560, d: 560, h: 1500, shape: 'round',
    draw(c, w) { circ(c, 0, 0, w / 2); label(c, 'WH', w * 0.3); }, parts: (w, d, h) => [B(0, 0, 0, w, d, h, COL.steel, 'cyl')] },

  // ---------- Other ----------
  { id: 'stairs', name: 'Stairs (straight)', cat: 'Other', w: 1000, d: 3000, h: 2743, stairs: true,
    draw(c, w, d) {
      box(c, -w / 2, -d / 2, w, d, 0, '#fff');
      const n = Math.max(3, Math.round(d / 260));
      for (let i = 1; i < n; i++) line(c, -w / 2, -d / 2 + (d * i) / n, w / 2, -d / 2 + (d * i) / n);
      c.beginPath(); c.moveTo(0, d / 2 - 150); c.lineTo(0, -d / 2 + 200); c.stroke();
      c.beginPath(); c.moveTo(-110, -d / 2 + 380); c.lineTo(0, -d / 2 + 160); c.lineTo(110, -d / 2 + 380); c.stroke();
      label(c, 'UP', Math.min(w * 0.22, 190), d / 2 - 380);
    },
    parts(w, d, h) {
      const n = Math.max(3, Math.round(d / 260)), run = d / n, rise = h / n, out = [];
      // steps rise toward the back (-y)
      for (let i = 0; i < n; i++) out.push(B(0, d / 2 - run * (i + 0.5), 0, w, run, rise * (i + 1), COL.stone));
      return out;
    } },
  { id: 'plant', name: 'Potted plant', cat: 'Other', w: 450, d: 450, h: 900, shape: 'round',
    draw(c, w) { circ(c, 0, 0, w / 2, '#e3efe0'); circ(c, 0, 0, w * 0.22, '#c5dec0'); }, parts: (w, d, h) => [B(0, 0, 0, w * 0.5, d * 0.5, h * 0.3, COL.woodD, 'cyl'), B(0, 0, h * 0.3, w, d, h * 0.7, COL.green, 'cyl')] },
];

export const byId = Object.fromEntries(LIB.map((i) => [i.id, i]));
export const CATEGORIES = [...new Set(LIB.map((i) => i.cat))];

/** Draw a library symbol centred at the origin (call inside ctx.save/translate/rotate). */
export function drawSymbol(ctx, item, w, d, u, { stroke = INK, weight = 1 } = {}) {
  ctx.save();
  ctx.strokeStyle = stroke; ctx.lineWidth = weight * u; ctx.lineJoin = 'round'; ctx.fillStyle = '#fff';
  item.draw(ctx, w, d);
  ctx.restore();
}

export const FLOORS = {
  wood: { name: 'Wood', color: '#c8a27a', tint: 'rgba(200,162,122,.18)' },
  tile: { name: 'Tile', color: '#c9d4dc', tint: 'rgba(160,185,205,.22)' },
  carpet: { name: 'Carpet', color: '#b9aaa0', tint: 'rgba(185,170,160,.22)' },
  concrete: { name: 'Concrete', color: '#b9bbbd', tint: 'rgba(160,160,165,.20)' },
  none: { name: 'None', color: '#dcdcdc', tint: 'rgba(120,130,150,.08)' },
};

export const ROOM_PRESETS = [
  ['Living Room', 'wood'], ['Kitchen', 'tile'], ['Dining', 'wood'], ['Bedroom', 'carpet'], ['Primary Bedroom', 'carpet'],
  ['Bathroom', 'tile'], ['Laundry', 'tile'], ['Office', 'wood'], ['Hall', 'wood'], ['Closet', 'carpet'], ['Garage', 'concrete'], ['Entry', 'tile'],
];

export const DOOR_STYLES = { single: 'Single swing', double: 'Double swing', slide: 'Sliding', open: 'Open (no door)' };
export const WINDOW_STYLES = { fixed: 'Fixed', casement: 'Casement / double-hung' };
