import type { Furniture, Point } from '../types';

export const PX_MM = 25.4 / 96;

export const areaOf = (poly: Point[]) =>
  Math.abs(poly.reduce((a, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2 / 1e6;

export const perimeterOf = (poly: Point[]) =>
  poly.reduce((a, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return a + Math.hypot(q[0] - p[0], q[1] - p[1]);
  }, 0) / 1000;

export const bboxOf = (poly: Point[]): [number, number, number, number] => {
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
};

/** 轴对齐外接半宽 / 半高（考虑旋转） */
export function aabb(f: Pick<Furniture, 'w' | 'd' | 'rot'>) {
  const a = (f.rot * Math.PI) / 180;
  const c = Math.abs(Math.cos(a));
  const s = Math.abs(Math.sin(a));
  return { hw: (f.w / 2) * c + (f.d / 2) * s, hh: (f.w / 2) * s + (f.d / 2) * c };
}

export const fmt = (n: number, d = 2) => n.toFixed(d);
export const normAngle = (a: number) => ((Math.round(a) % 360) + 360) % 360;

export function hexToRgb(h: string): [number, number, number] {
  let s = h.replace('#', '');
  if (s.length === 3) s = s.split('').map((c) => c + c).join('');
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** k > 1 提亮，k < 1 压暗 */
export function shade(hex: string, k: number): string {
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(k > 1 ? v + (255 - v) * (k - 1) * 2 : v * k)));
  return '#' + hexToRgb(hex).map((v) => f(v).toString(16).padStart(2, '0')).join('');
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const clamp01 = (v: number) => clamp(v, 0, 1);
