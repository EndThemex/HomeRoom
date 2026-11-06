import type { OpeningData, PlanDoc, Point, WallData, WallKind, WallLine } from '../types';
import { DEFAULTS, cloneLayout, newId } from './planDoc';
import { clamp } from './geometry';

export const lineById = (layout: PlanDoc, lineId: string) => layout.lines.find((l) => l.id === lineId) ?? null;

export const centersOf = (line: WallLine): [number, number] => [
  (line.band[0] + line.band[1]) / 2,
  (line.span[0] + line.span[1]) / 2,
];

export const thicknessOf = (line: WallLine) => line.band[1] - line.band[0];
export const lengthOf = (line: WallLine) => line.span[1] - line.span[0];

export const lineCenter = (line: WallLine): Point => line.axis === 'h'
  ? [(line.span[0] + line.span[1]) / 2, (line.band[0] + line.band[1]) / 2]
  : [(line.band[0] + line.band[1]) / 2, (line.span[0] + line.span[1]) / 2];

const wallRect = (line: WallLine, s0: number, s1: number, id: string): WallData => (line.axis === 'h'
  ? { id, lineId: line.id, x0: s0, y0: line.band[0], x1: s1, y1: line.band[1], kind: line.kind }
  : { id, lineId: line.id, x0: line.band[0], y0: s0, x1: line.band[1], y1: s1, kind: line.kind });

/** 墙线 span 依次减去洞口区间，得到墙块列表（含确定性 ID） */
export function segmentsOf(line: WallLine, openings: OpeningData[]): WallData[] {
  const list = openings
    .filter((o) => o.lineId === line.id)
    .slice()
    .sort((a, b) => a.span[0] - b.span[0]);
  const out: WallData[] = [];
  let cursor = line.span[0];
  for (const o of list) {
    const s = Math.max(cursor, Math.min(o.span[0], o.span[1]));
    const e = Math.max(cursor, Math.max(o.span[0], o.span[1]));
    if (s > cursor) {
      out.push(wallRect(line, cursor, s, `${line.id}#s${out.length}`));
    }
    cursor = Math.max(cursor, e);
  }
  if (cursor < line.span[1]) out.push(wallRect(line, cursor, line.span[1], `${line.id}#s${out.length}`));
  return out;
}

/** 全部未拆改墙线的墙块矩形，供 2D 渲染、3D 建体、家具吸附 */
export function wallRectsOf(layout: PlanDoc, demolishedLines: string[], includeDemolished = false): WallData[] {
  const out: WallData[] = [];
  layout.lines.forEach((line) => {
    if (!includeDemolished && demolishedLines.includes(line.id)) return;
    segmentsOf(line, layout.openings).forEach((w) => out.push(w));
  });
  return out;
}

/** 超出现有 bounds 时自动外扩（不改变 origin） */
export function extendBounds(layout: PlanDoc) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  layout.lines.forEach((line) => {
    const r = line.axis === 'h'
      ? [line.span[0], line.band[0], line.span[1], line.band[1]]
      : [line.band[0], line.span[0], line.band[1], line.span[1]];
    x0 = Math.min(x0, r[0]); y0 = Math.min(y0, r[1]);
    x1 = Math.max(x1, r[2]); y1 = Math.max(y1, r[3]);
  });
  if (!Number.isFinite(x0)) return;
  const b = layout.bounds;
  const nx0 = Math.min(b.x, x0 - 500);
  const ny0 = Math.min(b.y, y0 - 500);
  const nx1 = Math.max(b.x + b.w, x1 + 500);
  const ny1 = Math.max(b.y + b.h, y1 + 500);
  if (nx0 !== b.x || ny0 !== b.y) {
    b.w += b.x - nx0;
    b.h += b.y - ny0;
    b.x = nx0;
    b.y = ny0;
  }
  b.w = Math.max(b.w, nx1 - b.x);
  b.h = Math.max(b.h, ny1 - b.y);
}

function addLine(layout: PlanDoc, axis: 'h' | 'v', center: number, span: [number, number], thickness: number, kind: WallKind): string {
  const t = clamp(thickness, 60, 400);
  const s0 = Math.min(span[0], span[1]);
  const s1 = Math.max(span[0], span[1]);
  const id = newId('L');
  layout.lines.push({
    id,
    axis,
    kind,
    band: [center - t / 2, center + t / 2],
    span: [s0, s1],
  });
  return id;
}

/** 正交约束 + 网格取整，生成墙线 */
export function createWallLine(layout: PlanDoc, a: Point, b: Point, thickness = DEFAULTS.wallThickness, kind: WallKind = 'n'): string | null {
  const ax = Math.round(a[0] / DEFAULTS.grid) * DEFAULTS.grid;
  const ay = Math.round(a[1] / DEFAULTS.grid) * DEFAULTS.grid;
  const bx = Math.round(b[0] / DEFAULTS.grid) * DEFAULTS.grid;
  const by = Math.round(b[1] / DEFAULTS.grid) * DEFAULTS.grid;
  const dx = Math.abs(bx - ax);
  const dy = Math.abs(by - ay);
  if (Math.max(dx, dy) < DEFAULTS.minWall) return null;
  const id = dx >= dy
    ? addLine(layout, 'h', ay, [ax, bx], thickness, kind)
    : addLine(layout, 'v', ax, [ay, by], thickness, kind);
  extendBounds(layout);
  return id;
}

/** 快速建房：拖出矩形，自动创建四面隔墙 */
export function createRectRoom(layout: PlanDoc, a: Point, b: Point, thickness = DEFAULTS.wallThickness, kind: WallKind = 'n'): string[] {
  const x0 = Math.round(Math.min(a[0], b[0]) / DEFAULTS.grid) * DEFAULTS.grid;
  const x1 = Math.round(Math.max(a[0], b[0]) / DEFAULTS.grid) * DEFAULTS.grid;
  const y0 = Math.round(Math.min(a[1], b[1]) / DEFAULTS.grid) * DEFAULTS.grid;
  const y1 = Math.round(Math.max(a[1], b[1]) / DEFAULTS.grid) * DEFAULTS.grid;
  if (x1 - x0 < DEFAULTS.minWall || y1 - y0 < DEFAULTS.minWall) return [];
  const ids = [
    addLine(layout, 'h', y0, [x0, x1], thickness, kind),
    addLine(layout, 'h', y1, [x0, x1], thickness, kind),
    addLine(layout, 'v', x0, [y0, y1], thickness, kind),
    addLine(layout, 'v', x1, [y0, y1], thickness, kind),
  ];
  extendBounds(layout);
  return ids;
}

/** 平移整条墙线的 band / span 与全部洞口 span */
export function moveWallLine(layout: PlanDoc, lineId: string, dx: number, dy: number): boolean {
  const line = lineById(layout, lineId);
  if (!line || (!dx && !dy)) return false;
  if (line.axis === 'h') {
    line.span[0] += dx; line.span[1] += dx;
    line.band[0] += dy; line.band[1] += dy;
    layout.openings.filter((o) => o.lineId === lineId).forEach((o) => { o.span[0] += dx; o.span[1] += dx; });
  } else {
    line.band[0] += dx; line.band[1] += dx;
    line.span[0] += dy; line.span[1] += dy;
    layout.openings.filter((o) => o.lineId === lineId).forEach((o) => { o.span[0] += dy; o.span[1] += dy; });
  }
  extendBounds(layout);
  return true;
}

/** 只改墙线外侧端点；遇洞口夹紧，保证墙垛 ≥ 100mm */
export function resizeWallLine(layout: PlanDoc, lineId: string, end: 'start' | 'end', coord: number): boolean {
  const line = lineById(layout, lineId);
  if (!line) return false;
  const c = Math.round(coord / DEFAULTS.grid) * DEFAULTS.grid;
  const ops = layout.openings.filter((o) => o.lineId === lineId);
  const next: [number, number] = [...line.span];
  if (end === 'start') {
    let cap = line.span[1] - DEFAULTS.minWall;
    if (ops.length) cap = Math.min(cap, Math.min(...ops.map((o) => o.span[0])) - DEFAULTS.minPier);
    next[0] = Math.min(c, cap);
  } else {
    let floor = line.span[0] + DEFAULTS.minWall;
    if (ops.length) floor = Math.max(floor, Math.max(...ops.map((o) => o.span[1])) + DEFAULTS.minPier);
    next[1] = Math.max(c, floor);
  }
  if (next[1] - next[0] < DEFAULTS.minWall) return false;
  line.span = [Math.min(next[0], next[1]), Math.max(next[0], next[1])];
  extendBounds(layout);
  return true;
}

/** 保持墙线中心不变，更新 band；洞口无 band 字段，天然同步 */
export function setLineThickness(layout: PlanDoc, lineId: string, thickness: number) {
  const line = lineById(layout, lineId);
  if (!line) return;
  const t = clamp(Math.round(thickness), 60, 400);
  const c = (line.band[0] + line.band[1]) / 2;
  line.band = [c - t / 2, c + t / 2];
}

export function setLineKind(layout: PlanDoc, lineId: string, kind: WallKind) {
  const line = lineById(layout, lineId);
  if (line) line.kind = kind;
}

export function deleteWallLine(layout: PlanDoc, lineId: string) {
  layout.lines = layout.lines.filter((l) => l.id !== lineId);
  layout.openings = layout.openings.filter((o) => o.lineId !== lineId);
}

export function deleteOpening(layout: PlanDoc, openingId: string) {
  layout.openings = layout.openings.filter((o) => o.id !== openingId);
}
