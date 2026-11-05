import { shade } from '../lib/geometry';

const ST = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
const DASH = 'stroke-dasharray="4 3"';

const rc = (x: number, y: number, w: number, h: number, f: string, ex = '') =>
  `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}" fill="${f}" ${ST} ${ex}/>`;
const ec = (cx: number, cy: number, rx: number, ry: number, f: string, ex = '') =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${Math.max(0, rx)}" ry="${Math.max(0, ry)}" fill="${f}" ${ST} ${ex}/>`;
const ln = (x1: number, y1: number, x2: number, y2: number, ex = '') =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" ${ST} ${ex}/>`;
const pa = (d: string, f = 'none', ex = '') => `<path d="${d}" fill="${f}" ${ST} ${ex}/>`;

/** 家具 2D 图例（真实尺寸 mm，原点为家具中心） */
export function furnitureSvg(t: string, w: number, d: number, c: string): string {
  const x = -w / 2;
  const y = -d / 2;
  const m = Math.min(w, d);
  switch (t) {
    case 'bed': {
      let s = rc(x, y, w, d, '#fbf8f2', 'rx="30"') + rc(x, y, w, Math.min(90, d * 0.05), shade(c, 0.62), 'rx="20"');
      const ph = Math.min(360, d * 0.18);
      const py = y + 150;
      if (w >= 1300) {
        const pw = (w - 240) / 2;
        s += rc(x + 80, py, pw, ph, '#fff', 'rx="70"') + rc(x + 160 + pw, py, pw, ph, '#fff', 'rx="70"');
      } else {
        s += rc(x + 80, py, w - 160, ph, '#fff', 'rx="70"');
      }
      const by = py + ph + 110;
      const bh = y + d - 15 - by;
      s += rc(x + 15, by, w - 30, bh, c, 'rx="40"') + pa(`M${x + 15} ${by + 300}H${x + w - 15}`, 'none', DASH);
      s += pa(
        `M${x + w - 15 - Math.min(420, w * 0.3)} ${by}L${x + w - 15} ${by}L${x + w - 15} ${by + Math.min(420, w * 0.3)}Z`,
        shade(c, 1.12),
      );
      return s;
    }
    case 'sofa':
    case 'armchair': {
      const b = d * 0.24;
      const a = Math.min(200, w * 0.13);
      const n = t === 'armchair' ? 1 : w > 2200 ? 3 : 2;
      const cw = (w - 2 * a) / n;
      const dk = shade(c, 0.85);
      let s = rc(x, y, w, d, dk, 'rx="60"');
      for (let i = 0; i < n; i++) s += rc(x + a + i * cw, y + b, cw, d - b - 40, c, 'rx="40"');
      return s + rc(x, y, w, b, dk, 'rx="50"') + rc(x, y, a, d, dk, 'rx="50"') + rc(x + w - a, y, a, d, dk, 'rx="50"');
    }
    case 'cornersofa': {
      const k = Math.min(950, d * 0.56, w * 0.4);
      const b = 220;
      const dk = shade(c, 0.85);
      let s = pa(`M${x} ${y}H${x + w}V${y + k}H${x + k}V${y + d}H${x}Z`, dk);
      const cw = (w - b - 200) / 2;
      s += rc(x + b, y + b, cw, k - b - 30, c, 'rx="40"') + rc(x + b + cw, y + b, cw, k - b - 30, c, 'rx="40"') + rc(x + b, y + k, k - b - 30, d - k - 200, c, 'rx="40"');
      return s + rc(x, y, w, b, dk, 'rx="50"') + rc(x, y, b, d, dk, 'rx="50"') + rc(x + w - 200, y, 200, k, dk, 'rx="50"') + rc(x, y + d - 200, k, 200, dk, 'rx="50"');
    }
    case 'nightstand':
      return rc(x, y, w, d, c, 'rx="30"') + `<circle r="${m * 0.24}" fill="#fff6dd" ${ST}/>` + `<circle r="${m * 0.08}" fill="${shade(c, 0.8)}" ${ST}/>`;
    case 'wardrobe': {
      let s = rc(x, y, w, d, c) + ln(x + 50, 0, x + w - 50, 0);
      for (let hx = x + 160; hx < x + w - 100; hx += 180) s += ln(hx - 45, -d * 0.28, hx + 45, d * 0.28, 'opacity=".6"');
      return s;
    }
    case 'cabinet':
    case 'shoecab':
      return rc(x, y, w, d, c) + ln(x, y + d, x + w, y);
    case 'dresser':
      return rc(x, y, w, d, c, 'rx="20"') + rc(x + w * 0.2, y, w * 0.6, 55, '#dfe9ee') + ec(0, d / 2 + 180, 160, 140, shade(c, 0.9));
    case 'desk':
      return rc(x, y, w, d, c, 'rx="20"') + rc(-w * 0.18, y + 50, w * 0.36, 45, '#555') + rc(-w * 0.14, y + d * 0.45, w * 0.28, d * 0.28, '#f4f4f4', 'rx="10"');
    case 'chair':
      return rc(x + 25, y + d * 0.16, w - 50, d * 0.84 - 10, c, 'rx="60"') + rc(x, y, w, d * 0.2, shade(c, 0.78), 'rx="40"');
    case 'bookshelf': {
      let s = rc(x, y, w, d, c);
      for (let bx = x + 400; bx < x + w - 50; bx += 400) s += ln(bx, y, bx, y + d);
      return s;
    }
    case 'baycushion':
      return rc(x, y, w, d, c, 'rx="60"') + rc(x + 60, y + 80, w - 120, Math.min(300, d * 0.2), '#fff', 'rx="60"') + rc(x + 60, y + d - 80 - Math.min(300, d * 0.2), w - 120, Math.min(300, d * 0.2), '#fff', 'rx="60"');
    case 'coffeetable':
      return rc(x, y, w, d, c, 'rx="80"') + rc(x + 60, y + 60, w - 120, d - 120, shade(c, 1.06), 'rx="50"');
    case 'tvstand':
      return rc(x, y, w, d, c) + rc(x + w * 0.15, y + 30, w * 0.7, 55, '#3a3a3a');
    case 'rug':
      return rc(x, y, w, d, c, 'rx="40" fill-opacity=".6"') + rc(x + 90, y + 90, w - 180, d - 180, 'none', 'rx="30" stroke-dasharray="3 3" opacity=".6"');
    case 'plant': {
      let s = `<circle r="${m / 2}" fill="${c}" fill-opacity=".85" ${ST}/>`;
      for (let k = 0; k < 8; k++) s += `<ellipse cx="0" cy="${-m * 0.27}" rx="${m * 0.1}" ry="${m * 0.21}" transform="rotate(${k * 45})" fill="${shade(c, 0.8)}" ${ST}/>`;
      return s + `<circle r="${m * 0.1}" fill="#8a6a4a" ${ST}/>`;
    }
    case 'table':
      return rc(x, y, w, d, c, 'rx="30"') + rc(x + 50, y + 50, w - 100, d - 100, 'none', 'rx="20" opacity=".4"');
    case 'roundtable':
      return ec(0, 0, w / 2, d / 2, c) + ec(0, 0, w / 2 - 50, d / 2 - 50, 'none', 'opacity=".4"');
    case 'counter':
      return rc(x, y, w, d, c) + ln(x, y + d - 40, x + w, y + d - 40, DASH);
    case 'stove': {
      let s = rc(x, y, w, d, '#2f2f2f', 'rx="20"');
      const r = m * 0.26;
      const pts = w / d > 1.4 ? [[-w / 4, 0], [w / 4, 0]] : [[-w / 4, -d / 4], [w / 4, -d / 4], [-w / 4, d / 4], [w / 4, d / 4]];
      pts.forEach(([px, py]) => { s += `<circle cx="${px}" cy="${py}" r="${r}" fill="none" stroke="#bbb" stroke-width="1" vector-effect="non-scaling-stroke"/><circle cx="${px}" cy="${py}" r="${r * 0.45}" fill="#666"/>`; });
      return s;
    }
    case 'ksink':
      return rc(x, y, w, d, c, 'rx="20"') + rc(x + w * 0.06, y + d * 0.18, w * 0.42, d * 0.66, '#fff', 'rx="50"') + rc(x + w * 0.52, y + d * 0.18, w * 0.42, d * 0.66, '#fff', 'rx="50"') + `<circle cx="0" cy="${y + d * 0.09}" r="22" fill="#999"/>`;
    case 'fridge':
      return rc(x, y, w, d, c, 'rx="30"') + ln(x, y + d * 0.14, x + w, y + d * 0.14) + ln(0, y + d * 0.14, 0, y + d) + rc(-70, y + d * 0.5, 40, d * 0.25, '#aab') + rc(30, y + d * 0.5, 40, d * 0.25, '#aab');
    case 'toilet':
      return rc(x + w * 0.04, y, w * 0.92, d * 0.27, c, 'rx="30"') + ec(0, y + d * 0.27 + d * 0.36, w * 0.47, d * 0.36, c) + ec(0, y + d * 0.27 + d * 0.4, w * 0.3, d * 0.24, '#eef4f7');
    case 'vanity':
      return rc(x, y, w, d, c, 'rx="20"') + ec(0, y + d * 0.57, Math.min(w * 0.32, 260), d * 0.28, '#fff') + `<circle cx="0" cy="${y + d * 0.17}" r="26" fill="#999"/>`;
    case 'shower':
      return rc(x, y, w, d, c) + ln(x, y, x + w, y + d, DASH) + ln(x + w, y, x, y + d, DASH) + `<circle r="45" fill="#fff" ${ST}/>`;
    case 'bathtub':
      return rc(x, y, w, d, c, 'rx="40"') + rc(x + 80, y + 80, w - 160, d - 160, '#fff', `rx="${m * 0.33}"`) + `<circle cx="${x + w - 260}" cy="0" r="35" fill="#ccc" ${ST}/>`;
    case 'washer':
    case 'dryer':
      return rc(x, y, w, d, c, 'rx="30"') + rc(x, y, w, d * 0.14, shade(c, 0.9)) + `<circle cy="${d * 0.06}" r="${m * 0.34}" fill="#fff" ${ST}/><circle cy="${d * 0.06}" r="${m * 0.24}" fill="${t === 'dryer' ? '#e9dccb' : '#cfdde4'}" ${ST}/>`;
    case 'crib': {
      let s = rc(x, y, w, d, c, 'rx="20"') + rc(x + 45, y + 45, w - 90, d - 90, '#fff', 'rx="20"');
      for (let sx = x + 90; sx < x + w - 60; sx += 90) s += ln(sx, y, sx, y + 45, 'opacity=".5"') + ln(sx, y + d - 45, sx, y + d, 'opacity=".5"');
      return s;
    }
    case 'beanbag':
      return ec(0, 0, w / 2, d / 2, c) + ec(-w * 0.04, -d * 0.06, w * 0.3, d * 0.28, shade(c, 1.12), 'opacity=".9"');
    case 'sidetable':
      return ec(0, 0, w / 2, d / 2, c) + ec(0, 0, w * 0.12, d * 0.12, 'none', 'opacity=".5"');
    case 'floorlamp':
      return `<circle r="${m * 0.5}" fill="#fff6dd" fill-opacity=".85" ${ST}/>` + `<circle r="${m * 0.32}" fill="none" ${ST} ${DASH}/>` + `<circle r="${m * 0.07}" fill="${c}" ${ST}/>`;
    case 'island':
      return rc(x, y, w, d, c) + ln(x, y + d - 250, x + w, y + d - 250, DASH);
    case 'barstool':
      return `<circle r="${m / 2}" fill="${c}" ${ST}/><circle r="${m * 0.3}" fill="${shade(c, 1.15)}" ${ST}/>`;
    case 'waterheater':
      return rc(x, y, w, d, c, `rx="${d / 2}" ${DASH}`) + ln(x + w * 0.2, 0, x + w * 0.8, 0, DASH);
    case 'tv':
      return rc(x, y, w, d, c, 'rx="10"') + rc(x + w * 0.3, y + d, w * 0.4, Math.min(40, d), '#666');
    case 'aircon':
      return rc(x, y, w, d, c, 'rx="30"') + ln(x + 40, y + d * 0.72, x + w - 40, y + d * 0.72) + ln(x + 40, y + d * 0.86, x + w - 40, y + d * 0.86);
    case 'acwall': {
      let s = rc(x, y, w, d, c, `rx="30" ${DASH}`);
      [0.25, 0.5, 0.75].forEach((k) => { s += ln(x + w * k, y + d, x + w * k, y + d + 200, `${DASH} opacity=".6"`); });
      return s;
    }
    case 'dishwasher':
      return rc(x, y, w, d, c, 'rx="15"') + ln(x, y + d - 70, x + w, y + d - 70) + rc(x + w * 0.3, y + d - 45, w * 0.4, 25, '#888');
    case 'ovencol':
      return rc(x, y, w, d, c) + ln(x, y, x + w, y + d) + ln(x + w, y, x, y + d);
    case 'purifier':
      return rc(x, y, w, d, c, 'rx="60"') + rc(x + 45, y + 45, w - 90, d - 90, 'none', `rx="40" ${DASH}`);
    case 'officechair': {
      let s = '';
      for (let k = 0; k < 5; k++) s += `<line x1="0" y1="0" x2="0" y2="${m * 0.48}" transform="rotate(${k * 72 + 36})" stroke="#555" stroke-width="2" vector-effect="non-scaling-stroke"/>`;
      return s + rc(x + w * 0.12, y + d * 0.22, w * 0.76, d * 0.66, c, 'rx="80"') + rc(x + w * 0.15, y + d * 0.04, w * 0.7, d * 0.16, shade(c, 0.78), 'rx="40"')
        + rc(x + w * 0.02, y + d * 0.3, w * 0.1, d * 0.45, shade(c, 0.7), 'rx="30"') + rc(x + w * 0.88, y + d * 0.3, w * 0.1, d * 0.45, shade(c, 0.7), 'rx="30"');
    }
    case 'piano': {
      let s = rc(x, y, w, d * 0.55, c, 'rx="10"') + rc(x + 40, y + d * 0.55, w - 80, d * 0.4, shade(c, 1.4), 'rx="10"');
      const kx = x + 90;
      const kw = w - 180;
      const kd = d * 0.2;
      s += rc(kx, y + d * 0.55, kw, kd, '#faf8f3');
      for (let i = 1; i < 26; i++) s += ln(kx + (kw * i) / 26, y + d * 0.55, kx + (kw * i) / 26, y + d * 0.55 + kd, 'opacity=".5"');
      return s;
    }
    case 'treadmill':
      return rc(x, y, w, d, c, 'rx="50"') + rc(x + 90, y + 320, w - 180, d - 400, '#1c1c1e', 'rx="25"') + rc(x, y, w, 230, shade(c, 1.4), 'rx="40"');
    default:
      return rc(x, y, w, d, c);
  }
}
