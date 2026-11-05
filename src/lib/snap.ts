import type { Point, WallData, WindowData } from '../types';
import { aabb } from './geometry';

type Rect = WallData | WindowData;

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
