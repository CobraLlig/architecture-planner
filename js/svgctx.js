// A tiny CanvasRenderingContext2D look-alike that records vector SVG.
// The plan renderer draws to either a real canvas (screen) or this (print / SVG export),
// so printed sheets are true vector output at exact scale.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const f = (n) => (Math.abs(n) < 1e-9 ? 0 : +n.toFixed(3));

export class SvgCtx {
  constructor() {
    this.out = [];
    this.stack = [];
    this.m = [1, 0, 0, 1, 0, 0];
    this.path = [];
    this.cur = null;
    this.fillStyle = '#000';
    this.strokeStyle = '#000';
    this.lineWidth = 1;
    this.lineJoin = 'miter';
    this.lineCap = 'butt';
    this.globalAlpha = 1;
    this.font = '10px sans-serif';
    this.textAlign = 'left';
    this.textBaseline = 'alphabetic';
    this.dash = [];
  }

  // --- state ---
  save() { this.stack.push({ m: this.m.slice(), fillStyle: this.fillStyle, strokeStyle: this.strokeStyle, lineWidth: this.lineWidth, lineJoin: this.lineJoin, lineCap: this.lineCap, globalAlpha: this.globalAlpha, font: this.font, textAlign: this.textAlign, textBaseline: this.textBaseline, dash: this.dash }); }
  restore() { Object.assign(this, this.stack.pop()); }
  setLineDash(d) { this.dash = d || []; }
  _mul(n) {
    const [a, b, c, d, e, g] = this.m, [A, B, C, D, E, G] = n;
    this.m = [a * A + c * B, b * A + d * B, a * C + c * D, b * C + d * D, a * E + c * G + e, b * E + d * G + g];
  }
  translate(x, y) { this._mul([1, 0, 0, 1, x, y]); }
  scale(x, y) { this._mul([x, 0, 0, y, 0, 0]); }
  rotate(a) { const c = Math.cos(a), s = Math.sin(a); this._mul([c, s, -s, c, 0, 0]); }
  setTransform(a, b, c, d, e, g) { this.m = [a, b, c, d, e, g]; }

  // --- paths (stored untransformed; the matrix is applied at emit time) ---
  beginPath() { this.path = []; this.cur = null; this.pm = this.m.slice(); }
  moveTo(x, y) { this.path.push(`M${f(x)} ${f(y)}`); this.cur = { x, y }; this.pm = this.pm || this.m.slice(); }
  lineTo(x, y) { this.path.push(this.cur ? `L${f(x)} ${f(y)}` : `M${f(x)} ${f(y)}`); this.cur = { x, y }; }
  closePath() { this.path.push('Z'); }
  rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
  arc(cx, cy, r, a0, a1, ccw = false) {
    let delta = a1 - a0;
    if (!ccw && delta < 0) delta += Math.ceil(-delta / (2 * Math.PI)) * 2 * Math.PI;
    if (ccw && delta > 0) delta -= Math.ceil(delta / (2 * Math.PI)) * 2 * Math.PI;
    const pt = (a) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const [sx, sy] = pt(a0);
    if (this.cur) this.lineTo(sx, sy); else this.moveTo(sx, sy);
    const sweep = ccw ? 0 : 1;
    if (Math.abs(delta) >= 2 * Math.PI - 1e-6) {
      const [mx, my] = pt(a0 + Math.PI);
      this.path.push(`A${f(r)} ${f(r)} 0 1 ${sweep} ${f(mx)} ${f(my)}`);
      this.path.push(`A${f(r)} ${f(r)} 0 1 ${sweep} ${f(sx)} ${f(sy)}`);
      this.cur = { x: sx, y: sy };
      return;
    }
    const [ex, ey] = pt(a0 + delta);
    this.path.push(`A${f(r)} ${f(r)} 0 ${Math.abs(delta) > Math.PI ? 1 : 0} ${sweep} ${f(ex)} ${f(ey)}`);
    this.cur = { x: ex, y: ey };
  }
  _tf() {
    const [a, b, c, d, e, g] = this.pm || this.m;
    return a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && g === 0 ? '' : ` transform="matrix(${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)})"`;
  }
  _style(fill) {
    const al = this.globalAlpha !== 1 ? ` opacity="${f(this.globalAlpha)}"` : '';
    if (fill) return ` fill="${this.fillStyle}" stroke="none"${al}`;
    const dash = this.dash.length ? ` stroke-dasharray="${this.dash.map(f).join(' ')}"` : '';
    return ` fill="none" stroke="${this.strokeStyle}" stroke-width="${f(this.lineWidth)}" stroke-linejoin="${this.lineJoin}" stroke-linecap="${this.lineCap}"${dash}${al}`;
  }
  fill() { if (this.path.length) this.out.push(`<path d="${this.path.join('')}"${this._tf()}${this._style(true)}/>`); }
  stroke() { if (this.path.length) this.out.push(`<path d="${this.path.join('')}"${this._tf()}${this._style(false)}/>`); }
  fillRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.fill(); }
  strokeRect(x, y, w, h) { this.beginPath(); this.rect(x, y, w, h); this.stroke(); }

  // --- text ---
  _fontParts() {
    const m = this.font.match(/(?:(bold|italic|600|700)\s+)?([\d.]+)px\s+(.*)/);
    return m ? { weight: m[1] || 'normal', size: +m[2], family: m[3] } : { weight: 'normal', size: 10, family: 'sans-serif' };
  }
  measureText(t) { const { size } = this._fontParts(); return { width: t.length * size * 0.56 }; }
  fillText(text, x, y) {
    const { weight, size, family } = this._fontParts();
    const anchor = { left: 'start', start: 'start', center: 'middle', right: 'end', end: 'end' }[this.textAlign] || 'start';
    const dy = { alphabetic: 0, middle: size * 0.35, top: size * 0.8, hanging: size * 0.8, bottom: -size * 0.2 }[this.textBaseline] ?? 0;
    const [a, b, c, d, e, g] = this.m;
    const al = this.globalAlpha !== 1 ? ` opacity="${f(this.globalAlpha)}"` : '';
    const fw = weight !== 'normal' ? ` font-weight="${weight === 'bold' || weight === '700' ? 700 : weight}"` : '';
    this.out.push(`<text x="${f(x)}" y="${f(y + dy)}" transform="matrix(${f(a)} ${f(b)} ${f(c)} ${f(d)} ${f(e)} ${f(g)})" font-family="${esc(family.replace(/"/g, "'"))}" font-size="${f(size)}"${fw} text-anchor="${anchor}" fill="${this.fillStyle}"${al}>${esc(text)}</text>`);
  }

  // --- raw ---
  raw(s) { this.out.push(s); }
  toString() { return this.out.join('\n'); }
}
