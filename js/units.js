// Length / area formatting and parsing. Everything internal is millimetres.

export const IN = 25.4;
export const FT = 304.8;

export const units = { system: 'imperial' };

export function setSystem(s) { units.system = s === 'metric' ? 'metric' : 'imperial'; }

const FRACS = ['', '1/16', '1/8', '3/16', '1/4', '5/16', '3/8', '7/16', '1/2', '9/16', '5/8', '11/16', '3/4', '13/16', '7/8', '15/16'];

/** Format a length. opts.precision = smallest imperial fraction denominator (default 4 = nearest 1/4"). */
export function fmtLen(mm, opts = {}) {
  if (!isFinite(mm)) return '—';
  const neg = mm < 0; mm = Math.abs(mm);
  let out;
  if (units.system === 'metric') {
    if (mm >= 10000 || opts.meters) out = (mm / 1000).toFixed(2).replace(/\.?0+$/, '') + ' m';
    else if (mm >= 1000) out = (mm / 1000).toFixed(3).replace(/\.?0+$/, '') + ' m';
    else out = Math.round(mm) + ' mm';
  } else {
    const prec = opts.precision || 4;
    const step = 16 / prec;
    let sixteenths = Math.round((mm / IN) * 16 / step) * step;
    let totalIn = Math.floor(sixteenths / 16);
    const fr = sixteenths % 16;
    const ft = Math.floor(totalIn / 12);
    const inch = totalIn % 12;
    const fracStr = FRACS[fr];
    let inchStr = '';
    if (inch || fracStr) inchStr = `${inch}${fracStr ? ' ' + fracStr : ''}"`;
    if (ft && inchStr) out = `${ft}'-${inchStr}`;
    else if (ft) out = `${ft}'-0"`;
    else out = inchStr || '0"';
  }
  return (neg ? '-' : '') + out;
}

export function fmtArea(mm2) {
  if (units.system === 'metric') return (mm2 / 1e6).toFixed(1) + ' m²';
  return Math.round(mm2 / 92903.04).toLocaleString() + ' sf';
}

/** Parse user length text into millimetres. Returns null if it cannot be understood.
 *  Imperial: 12'6", 12' 6 1/2", 12-6, 6", 12ft, 12.5 (bare = feet).
 *  Metric / any: 3.5m, 350cm, 3500mm, bare number = metres in metric mode. */
export function parseLen(text) {
  if (text == null) return null;
  let s = String(text).trim().toLowerCase();
  if (!s) return null;
  s = s.replace(/feet|foot|ft/g, "'").replace(/inches|inch|in/g, '"').replace(/\s+/g, ' ');
  let m;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*mm$/))) return +m[1];
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*cm$/))) return +m[1] * 10;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)\s*m$/))) return +m[1] * 1000;
  if ((m = s.match(/^(-?\d+(?:\.\d+)?)$/))) {
    const v = +m[1];
    if (units.system === 'metric') return v >= 100 ? v : v * 1000;
    return v * FT;
  }
  // feet-inches with marks or dash:  12'6 1/2"  |  12' 6"  |  12-6  |  6"  |  12'
  m = s.match(/^(-?)\s*(?:(\d+(?:\.\d+)?)\s*')?\s*-?\s*(?:(\d+(?:\.\d+)?)?(?:\s*(\d+)\/(\d+))?\s*")?$/);
  if (m && (m[2] || m[3] || m[4])) {
    const ft = m[2] ? +m[2] : 0;
    let inch = m[3] ? +m[3] : 0;
    if (m[4] && m[5] && +m[5] !== 0) inch += +m[4] / +m[5];
    return (m[1] ? -1 : 1) * (ft * FT + inch * IN);
  }
  if ((m = s.match(/^(\d+)\s*-\s*(\d+(?:\.\d+)?)$/))) return +m[1] * FT + +m[2] * IN;
  return null;
}
