import type { OpeningData, PlanDoc, Point, WallData, WallLine } from '../types';
import { aabb } from './geometry';
import { openingRect, projectToLine } from './openings';

type Rect = WallData | { x0: number; y0: number; x1: number; y1: number };

const G = 10;
export const snapGrid = (v: number) => Math.round(v / G) * G;

/** 家具拖动吸附：10mm 网格 + 墙面 / 门窗边吸附 */
export function snapMove(
  f: { w: number; d: number; rot: number },
  cx: number,
  cy: number,
  rects: Rect[],
  wallSnap: boolean,
  viewScale: number,
): [number, number] {
  let nx = Math.round(cx / 10) * 10;
  let ny = Math.round(cy / 10) * 10;
  if (!wallSnap) return [nx, ny];
  const { hw, hh } = aabb(f);
  const tol = 10 / viewScale;
  let bx = tol;
  let by = tol;
  for (const r of rects) {
    if (!(r.y1 < cy - hh - tol || r.y0 > cy + hh + tol)) {
      for (const ex of [r.x0, r.x1]) {
        for (const c of [ex + hw, ex - hw]) {
          if (Math.abs(c - cx) < bx) { bx = Math.abs(c - cx); nx = c; }
        }
      }
    }
    if (!(r.x1 < cx - hw - tol || r.x0 > cx + hw + tol)) {
      for (const ey of [r.y0, r.y1]) {
        for (const c of [ey + hh, ey - hh]) {
          if (Math.abs(c - cy) < by) { by = Math.abs(c - cy); ny = c; }
        }
      }
    }
  }
  return [nx, ny];
}

/** 测量点吸附：10mm 网格 + 墙面 / 门窗边；Shift 锁定水平或垂直 */
export function snapPoint(p: Point, shift: boolean, anchor: Point | null, rects: Rect[], viewScale: number): Point {
  let x = Math.round(p[0] / 10) * 10;
  let y = Math.round(p[1] / 10) * 10;
  const tol = 8 / viewScale;
  let bx = tol;
  let by = tol;
  for (const r of rects) {
    for (const ex of [r.x0, r.x1]) if (Math.abs(ex - p[0]) < bx) { bx = Math.abs(ex - p[0]); x = ex; }
    for (const ey of [r.y0, r.y1]) if (Math.abs(ey - p[1]) < by) { by = Math.abs(ey - p[1]); y = ey; }
  }
  if (shift && anchor) {
    if (Math.abs(x - anchor[0]) > Math.abs(y - anchor[1])) y = anchor[1];
    else x = anchor[0];
  }
  return [x, y];
}

/** 新家具压到墙体 / 窗时，沿穿透较浅的方向推出，刚好贴墙 */
export function pushOut(f: { cx: number; cy: number; w: number; d: number; rot: number }, rects: Rect[]) {
  for (let n = 0; n < 4; n++) {
    let moved = false;
    for (const r of rects) {
      const { hw, hh } = aabb(f);
      const ox = Math.min(f.cx + hw, r.x1) - Math.max(f.cx - hw, r.x0);
      const oy = Math.min(f.cy + hh, r.y1) - Math.max(f.cy - hh, r.y0);
      if (ox <= 0 || oy <= 0) continue;
      if (ox < oy) f.cx = f.cx < (r.x0 + r.x1) / 2 ? r.x0 - hw : r.x1 + hw;
      else f.cy = f.cy < (r.y0 + r.y1) / 2 ? r.y0 - hh : r.y1 + hh;
      moved = true;
    }
    if (!moved) return;
  }
}

export type SnapKind = 'endpoint' | 'wall-face' | 'opening' | 'grid';

export interface WallSnap {
  p: Point;
  kind: SnapKind;
  ref?: [Point, Point];
}

const lineEndPoint = (line: WallLine, at: 'start' | 'end'): Point => {
  const s = at === 'start' ? line.span[0] : line.span[1];
  return line.axis === 'h' ? [s, (line.band[0] + line.band[1]) / 2] : [(line.band[0] + line.band[1]) / 2, s];
};

/** 画墙端点吸附：墙线端点 / 墙角 → 墙面投影 → 洞口边 → 网格 */
export function snapWallPoint(p: Point, rawScale: number, layout: PlanDoc, anchor: Point | null = null, disabled = false): WallSnap {
  const tol = 10 / Math.max(rawScale, 0.015);
  if (disabled) return { p: [snapGrid(p[0]), snapGrid(p[1])], kind: 'grid' };
  let best: { q: Point; kind: SnapKind; ref?: [Point, Point]; d: number } | null = null;
  const consider = (q: Point, kind: SnapKind, ref?: [Point, Point]) => {
    const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (d > tol) return;
    const rank = kind === 'endpoint' ? 0 : kind === 'opening' ? 1 : 2;
    const bestRank = !best ? 99 : best.kind === 'endpoint' ? 0 : best.kind === 'opening' ? 1 : 2;
    if (d < (best?.d ?? Infinity) || rank < bestRank) best = { q, kind, ref, d };
  };

  layout.lines.forEach((line) => {
    const c = (line.band[0] + line.band[1]) / 2;
    const ends: Point[] = line.axis === 'h'
      ? [[line.span[0], c], [line.span[1], c]]
      : [[c, line.span[0]], [c, line.span[1]]];
    const ref: [Point, Point] = line.axis === 'h'
      ? [[line.span[0], c], [line.span[1], c]]
      : [[c, line.span[0]], [c, line.span[1]]];
    ends.forEach((q) => consider(q, 'endpoint', ref));
  });
  layout.openings.forEach((o: OpeningData) => {
    const line = layout.lines.find((l) => l.id === o.lineId);
    if (!line) return;
    o.span.forEach((s) => consider(lineEndPoint({ ...line, span: [s, s] }, 'start'), 'opening'));
  });

  if (!best) {
    // 墙面投影：贴到墙带中心线
    layout.lines.forEach((line) => {
      const c = (line.band[0] + line.band[1]) / 2;
      const q: Point = line.axis === 'h' ? [Math.round(p[0] / G) * G, c] : [c, Math.round(p[1] / G) * G];
      const coord = line.axis === 'h' ? p[0] : p[1];
      if (coord < Math.min(line.span[0], line.span[1]) - tol || coord > Math.max(line.span[0], line.span[1]) + tol) return;
      consider(q, 'wall-face', line.axis === 'h' ? [[line.span[0], c], [line.span[1], c]] : [[c, line.span[0]], [c, line.span[1]]]);
    });
  }

  const result: WallSnap = best
    ? { p: (best as { q: Point }).q, kind: (best as { kind: SnapKind }).kind, ref: (best as { ref?: [Point, Point] }).ref }
    : { p: [snapGrid(p[0]), snapGrid(p[1])], kind: 'grid' };

  if (anchor) {
    if (Math.abs(result.p[0] - anchor[0]) > Math.abs(result.p[1] - anchor[1])) result.p[1] = anchor[1];
    else result.p[0] = anchor[0];
  }
  return result;
}

/** 门窗点击位置投影到墙线并吸附网格 */
export function snapOpeningCenter(p: Point, line: WallLine, scale: number): number {
  const coord = snapGrid(projectToLine(p, line));
  return Math.max(line.span[0] + 100, Math.min(line.span[1] - 100, coord));
}

/** 命中墙线（按屏幕厚度扩大） */
export function hitWallLine(layout: PlanDoc, p: Point, scale: number): WallLine | null {
  const tol = 8 / Math.max(scale, 0.015);
  let hit: WallLine | null = null;
  let best = Infinity;
  layout.lines.forEach((line) => {
    const [x0, y0, x1, y1] = line.axis === 'h'
      ? [line.span[0], line.band[0], line.span[1], line.band[1]]
      : [line.band[0], line.span[0], line.band[1], line.span[1]];
    const d = p[0] < x0 - tol || p[0] > x1 + tol || p[1] < y0 - tol || p[1] > y1 + tol
      ? Infinity
      : Math.max(0, Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]));
    if (d < best) { best = d; hit = line; }
  });
  return hit;
}

/** 命中洞口矩形 */
export function hitOpening(layout: PlanDoc, p: Point, scale: number) {
  const tol = 6 / Math.max(scale, 0.015);
  return layout.openings.find((o) => {
    const line = layout.lines.find((l) => l.id === o.lineId);
    if (!line) return false;
    const [x0, y0, x1, y1] = openingRect(line, o);
    return p[0] >= x0 - tol && p[0] <= x1 + tol && p[1] >= y0 - tol && p[1] <= y1 + tol;
  }) ?? null;
}
