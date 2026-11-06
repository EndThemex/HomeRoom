import type { DoorRender, OpeningData, OpeningKind, PlanDoc, Point, WallLine } from '../types';
import { DEFAULTS, newId } from './planDoc';
import { clamp } from './geometry';
import { lineById } from './layoutOps';

export const widthOf = (o: OpeningData) => o.span[1] - o.span[0];

export const defaultWidth = (kind: OpeningKind) =>
  (kind === 'door' ? DEFAULTS.doorWidth : kind === 'window' ? DEFAULTS.windowWidth : DEFAULTS.slideWidth);

export function widthRange(kind: OpeningKind): [number, number] {
  if (kind === 'door') return [600, 1200];
  if (kind === 'window') return [300, 3000];
  return [800, 3000];
}

export const clampWidth = (kind: OpeningKind, w: number) => {
  const [lo, hi] = widthRange(kind);
  return clamp(Math.round(w / DEFAULTS.grid) * DEFAULTS.grid, lo, hi);
};

export const hostLine = (layout: PlanDoc, o: OpeningData): WallLine | null => lineById(layout, o.lineId);

export const openingById = (layout: PlanDoc, id: string) => layout.openings.find((o) => o.id === id) ?? null;

/** 洞口 → 矩形，用于 2D 绘制与 3D 洞口 */
export function openingRect(line: WallLine, o: OpeningData): [number, number, number, number] {
  const [s0, s1] = o.span;
  const [c0, c1] = line.band;
  return line.axis === 'h' ? [s0, c0, s1, c1] : [c0, s0, c1, s1];
}

const sign = (v: number): 1 | -1 => (v < 0 ? -1 : 1);

/** 门参数 → 门扇实例；2D 弧线与 3D 门扇都由该结果生成 */
export function doorRender(line: WallLine, o: OpeningData): DoorRender {
  const [s0, s1] = o.span;
  const [c0, c1] = line.band;
  const hingeAt = o.hingeEnd === 'start' ? s0 : s1;
  const other = o.hingeEnd === 'start' ? s1 : s0;
  const c = (c0 + c1) / 2;
  const hinge: Point = line.axis === 'h' ? [hingeAt, c] : [c, hingeAt];
  const closedDir: Point = line.axis === 'h' ? [sign(other - hingeAt), 0] : [0, sign(other - hingeAt)];
  const swing = o.swing ?? 1;
  const openDir: Point = line.axis === 'h' ? [0, swing] : [swing, 0];
  return { hinge, closedDir, openDir, len: Math.abs(s1 - s0), entry: !!o.entry };
}

/** 点击位置为洞口中心，校验墙垛 / 间距 / 宽度 */
export function insertOpening(
  layout: PlanDoc,
  lineId: string,
  kind: OpeningKind,
  center: number,
  width = defaultWidth(kind),
): string | null {
  const line = lineById(layout, lineId);
  if (!line) return null;
  const w = clampWidth(kind, width);
  const pier = DEFAULTS.minPier;
  const L = line.span[1] - line.span[0];
  if (L < w + 2 * pier) return null;
  const lo = line.span[0] + pier + w / 2;
  const hi = line.span[1] - pier - w / 2;
  const mid = clamp(Math.round(center / DEFAULTS.grid) * DEFAULTS.grid, lo, hi);
  const span: [number, number] = [mid - w / 2, mid + w / 2];
  const others = layout.openings.filter((o) => o.lineId === lineId);
  for (const o of others) {
    if (span[1] < o.span[0] && o.span[0] - span[1] >= DEFAULTS.minGap) continue;
    if (span[0] > o.span[1] && span[0] - o.span[1] >= DEFAULTS.minGap) continue;
    return null;
  }
  const id = newId('O');
  layout.openings.push({
    id,
    lineId,
    kind,
    span,
    sill: kind === 'window' ? DEFAULTS.sill : undefined,
    head: kind === 'window' ? DEFAULTS.head : kind === 'door' ? DEFAULTS.doorHead : 2400,
    hingeEnd: kind === 'door' ? 'start' : undefined,
    swing: kind === 'door' || kind === 'slide' ? 1 : undefined,
    entry: false,
  });
  return id;
}

/** 沿墙线平移，夹紧保证墙垛与间距 */
export function moveOpening(layout: PlanDoc, id: string, delta: number): boolean {
  const o = layout.openings.find((x) => x.id === id);
  const line = o && lineById(layout, o.lineId);
  if (!o || !line || !delta) return false;
  const w = widthOf(o);
  const others = layout.openings
    .filter((x) => x.lineId === line.id && x.id !== id)
    .sort((a, b) => a.span[0] - b.span[0]);
  let lo = line.span[0] + DEFAULTS.minPier;
  let hi = line.span[1] - DEFAULTS.minPier - w;
  for (const x of others) {
    if (x.span[0] < o.span[0]) lo = Math.max(lo, x.span[1] + DEFAULTS.minGap);
    else hi = Math.min(hi, x.span[0] - DEFAULTS.minGap - w);
  }
  if (hi < lo) return false;
  const next = clamp(o.span[0] + Math.round(delta / DEFAULTS.grid) * DEFAULTS.grid, lo, hi);
  if (next === o.span[0]) return false;
  o.span = [next, next + w];
  return true;
}

/** 调整洞口一端；限制最小墙垛、相邻洞口间距与宽度范围 */
export function resizeOpening(layout: PlanDoc, id: string, edge: 'start' | 'end', coord: number): boolean {
  const o = layout.openings.find((x) => x.id === id);
  const line = o && lineById(layout, o.lineId);
  if (!o || !line) return false;
  const [minW, maxW] = widthRange(o.kind);
  const c = Math.round(coord / DEFAULTS.grid) * DEFAULTS.grid;
  let span: [number, number] = [...o.span];
  if (edge === 'start') {
    let lo = line.span[0] + DEFAULTS.minPier;
    for (const x of layout.openings.filter((x) => x.lineId === line.id && x.id !== id && x.span[0] < o.span[0])) {
      lo = Math.max(lo, x.span[1] + DEFAULTS.minGap);
    }
    const hi = o.span[1] - minW;
    const start = clamp(c, lo, hi);
    span = [start, o.span[1]];
  } else {
    let hi = line.span[1] - DEFAULTS.minPier;
    for (const x of layout.openings.filter((x) => x.lineId === line.id && x.id !== id && x.span[1] > o.span[1])) {
      hi = Math.min(hi, x.span[0] - DEFAULTS.minGap);
    }
    const lo = o.span[0] + minW;
    const end = clamp(c, lo, hi);
    span = [o.span[0], end];
  }
  if (span[1] - span[0] < minW) return false;
  if (span[1] - span[0] > maxW) {
    if (edge === 'start') span[0] = span[1] - maxW;
    else span[1] = span[0] + maxW;
  }
  o.span = span;
  return true;
}

export function removeOpening(layout: PlanDoc, id: string) {
  layout.openings = layout.openings.filter((o) => o.id !== id);
}

export function setOpeningSillHead(layout: PlanDoc, id: string, sill: number | undefined, head: number | undefined) {
  const o = layout.openings.find((x) => x.id === id);
  if (!o) return;
  const maxH = layout.floorHeight * 1000;
  if (sill !== undefined) o.sill = clamp(Math.round(sill), 0, maxH - 100);
  if (head !== undefined) o.head = clamp(Math.round(head), (o.sill ?? 0) + 100, maxH);
  if ((o.sill ?? 0) >= (o.head ?? maxH)) o.head = Math.min(maxH, (o.sill ?? 0) + 100);
  if (o.head! > maxH) { o.head = maxH; if (o.sill !== undefined && o.sill >= maxH) o.sill = maxH - 100; }
}

export function setDoorSwing(layout: PlanDoc, id: string, hingeEnd: 'start' | 'end', swing: 1 | -1) {
  const o = layout.openings.find((x) => x.id === id);
  if (!o) return;
  o.hingeEnd = hingeEnd;
  o.swing = swing;
}

/** 将任意点投影到墙线长度坐标 */
export function projectToLine(p: Point, line: WallLine): number {
  return line.axis === 'h' ? p[0] : p[1];
}
