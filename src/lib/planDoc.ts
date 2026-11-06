import raw from '../data/floorplan.json';
import type {
  DesignState, DimensionChains, DoorData, FloorPlanData, LegacyRoomState, LegacyWallData,
  OpeningData, OpeningKind, PlanDoc, Point, RoomData, SlideData, WallKind, WallLine, WindowData,
} from '../types';
import { colorForType, makeFurniture } from './plan';

export const STORE_KEY = 'homeroom-design-v2';
export const LEGACY_STORE_KEY = 'homeroom-design-v1';
export const PANES_KEY = 'homeroom-panes';
export const LANG_KEY = 'homeroom-lang';

export const DEFAULTS = {
  grid: 10,
  wallThickness: 200,
  doorWidth: 900,
  windowWidth: 1200,
  slideWidth: 2000,
  doorHead: 2100,
  sill: 900,
  head: 2400,
  minPier: 100,
  minWall: 100,
  minGap: 100,
  minRoomArea: 0.5,
  matchGrid: 25,
  mergeTol: 1,
};

const template = raw as unknown as FloorPlanData;

let seq = 0;
export const newId = (prefix: string) =>
  `${prefix}${Date.now().toString(36)}${(seq++).toString(36)}`;

export const cloneLayout = (doc: PlanDoc): PlanDoc => JSON.parse(JSON.stringify(doc)) as PlanDoc;

const r1 = (v: number) => Math.round(v * 10) / 10;

interface Piece {
  axis: 'h' | 'v';
  kind: WallKind;
  band: [number, number];
  span: [number, number];
  index: number;
}

function pieceOf(w: LegacyWallData, index: number): Piece {
  const hz = (w.x1 - w.x0) >= (w.y1 - w.y0);
  return {
    axis: hz ? 'h' : 'v',
    kind: w.kind,
    band: hz ? [w.y0, w.y1] : [w.x0, w.x1],
    span: hz ? [w.x0, w.x1] : [w.y0, w.y1],
    index,
  };
}

interface Hole {
  axis: 'h' | 'v';
  band: [number, number];
  span: [number, number];
  kind: OpeningKind;
}

function holeOf(rect: [number, number, number, number], kind: OpeningKind): Hole {
  const [x0, y0, x1, y1] = rect;
  const hz = (x1 - x0) >= (y1 - y0);
  return {
    axis: hz ? 'h' : 'v',
    band: hz ? [y0, y1] : [x0, x1],
    span: hz ? [x0, x1] : [y0, y1],
    kind,
  };
}

function bridge(holes: Hole[], axis: 'h' | 'v', band: [number, number], a: number, b: number): boolean {
  if (b - a <= DEFAULTS.mergeTol) return true;
  return holes.some((o) =>
    o.axis === axis
    && Math.abs(o.band[0] - band[0]) <= DEFAULTS.mergeTol
    && Math.abs(o.band[1] - band[1]) <= DEFAULTS.mergeTol
    && o.span[0] <= a + DEFAULTS.mergeTol
    && o.span[1] >= b - DEFAULTS.mergeTol,
  );
}

/** 把旧墙块按「轴向 + 厚度带 + 类型 + 首尾相接 / 同一洞口隔开」聚合为墙线 */
function aggregateWalls(walls: LegacyWallData[], holes: Hole[]) {
  const pieces = walls.map((w, i) => pieceOf(w, i));
  const groups = new Map<string, Piece[]>();
  pieces.forEach((p) => {
    const key = `${p.axis}|${r1(p.band[0])}|${r1(p.band[1])}|${p.kind}`;
    const arr = groups.get(key);
    if (arr) arr.push(p);
    else groups.set(key, [p]);
  });

  const lines: WallLine[] = [];
  const indexToLine: Record<number, string> = {};
  groups.forEach((arr) => {
    arr.sort((x, y) => x.span[0] - y.span[0]);
    let current: Piece[] = [];
    const flush = () => {
      if (!current.length) return;
      const id = `L${lines.length + 1}`;
      const span: [number, number] = [
        Math.min(...current.map((p) => p.span[0])),
        Math.max(...current.map((p) => p.span[1])),
      ];
      lines.push({ id, axis: current[0].axis, kind: current[0].kind, band: [...current[0].band], span });
      current.forEach((p) => { indexToLine[p.index] = id; });
      current = [];
    };
    for (const p of arr) {
      if (!current.length) { current = [p]; continue; }
      const lastEnd = Math.max(...current.map((q) => q.span[1]));
      if (bridge(holes, p.axis, p.band, lastEnd, p.span[0])) current.push(p);
      else { flush(); current = [p]; }
    }
    flush();
  });
  return { lines, indexToLine };
}

function openingsFromLegacy(
  lines: WallLine[],
  doors: DoorData[],
  windows: WindowData[],
  slides: SlideData[],
): OpeningData[] {
  const out: OpeningData[] = [];

  const hostOf = (hole: Hole): WallLine | null => {
    if (hole.span[1] - hole.span[0] < 1) return null;
    const bandLines = lines.filter((l) =>
      l.axis === hole.axis
      && Math.abs(l.band[0] - hole.band[0]) <= 1.5
      && Math.abs(l.band[1] - hole.band[1]) <= 1.5,
    );
    const inside = bandLines.find((l) => hole.span[0] >= l.span[0] - 1 && hole.span[1] <= l.span[1] + 1);
    if (inside) return inside;
    // 洞口位于墙线外侧端点（模板中整段窗洞没有相邻墙块）：把墙线延伸到洞口范围
    const adjacent = bandLines.find((l) =>
      (l.span[1] >= hole.span[0] - 1 && l.span[1] <= hole.span[0] + 1)
      || (l.span[0] >= hole.span[1] - 1 && l.span[0] <= hole.span[1] + 1),
    );
    if (adjacent) {
      adjacent.span = [Math.min(adjacent.span[0], hole.span[0]), Math.max(adjacent.span[1], hole.span[1])];
      return adjacent;
    }
    // 整段墙都是洞口：创建一条纯洞口墙线，保证 3D 过梁与房间识别正确
    const created: WallLine = {
      id: `L${lines.length + 1}`,
      axis: hole.axis,
      kind: hole.kind === 'window' ? 'e' : 'n',
      band: [hole.band[0], hole.band[1]],
      span: [hole.span[0], hole.span[1]],
    };
    lines.push(created);
    return created;
  };

  const add = (hole: Hole, extra: Partial<OpeningData>) => {
    const line = hostOf(hole);
    if (!line) return;
    out.push({
      id: `O${out.length + 1}`,
      lineId: line.id,
      kind: hole.kind,
      span: [Math.max(hole.span[0], line.span[0]), Math.min(hole.span[1], line.span[1])],
      ...extra,
    });
  };

  windows.forEach((w) => add(holeOf([w.x0, w.y0, w.x1, w.y1], 'window'), {
    sill: Math.round(w.sill * 1000),
    head: Math.round(w.head * 1000),
  }));
  doors.forEach((d) => {
    const hole = holeOf(d.rect, 'door');
    const hingeCoord = hole.axis === 'h' ? d.hinge[0] : d.hinge[1];
    const hingeEnd = Math.abs(hingeCoord - hole.span[0]) <= Math.abs(hingeCoord - hole.span[1]) ? 'start' : 'end';
    const sign = hole.axis === 'h' ? Math.sign(d.openDir[1]) : Math.sign(d.openDir[0]);
    add(hole, {
      head: DEFAULTS.doorHead,
      hingeEnd,
      swing: (sign || 1) as 1 | -1,
      entry: d.entry ? true : undefined,
    });
  });
  slides.forEach((s) => add(holeOf(s.rect, 'slide'), { swing: s.vertical ? -1 : 1, head: 2400 }));
  return out;
}

let cachedBase: { layout: PlanDoc; indexToLine: Record<number, string> } | null = null;

function baseTemplate() {
  if (cachedBase) return cachedBase;
  const holes = [
    ...template.windows.map((w) => holeOf([w.x0, w.y0, w.x1, w.y1], 'window')),
    ...template.doors.map((d) => holeOf(d.rect, 'door')),
    ...template.slides.map((s) => holeOf(s.rect, 'slide')),
  ];
  const { lines, indexToLine } = aggregateWalls(template.walls, holes);
  const openings = openingsFromLegacy(lines, template.doors, template.windows, template.slides);
  const rooms: RoomData[] = template.rooms.map((r) => ({
    ...r,
    poly: r.poly.map((p) => [...p] as Point),
    labelAt: r.labelAt ? [...r.labelAt] as Point : undefined,
  }));
  const layout: PlanDoc = {
    schemaVersion: 2,
    bounds: { ...template.bounds },
    origin: [...template.origin] as Point,
    floorHeight: template.floorHeight,
    lines,
    openings,
    rooms,
    dimensionChains: JSON.parse(JSON.stringify(template.dimensionChains)) as DimensionChains,
  };
  cachedBase = { layout, indexToLine };
  return cachedBase;
}

export function defaultLayout(): PlanDoc {
  return cloneLayout(baseTemplate().layout);
}

function migrateLegacy(input: Record<string, unknown>): PlanDoc {
  const doc = defaultLayout();
  const overrides = (input.rooms ?? {}) as Record<string, LegacyRoomState>;
  doc.rooms.forEach((room) => {
    const o = overrides[room.id];
    if (o) {
      if (typeof o.name === 'string' && o.name.trim()) { room.name = o.name; room.nameEn = o.name; }
      if (typeof o.mat === 'string') room.mat = o.mat;
    }
  });
  return doc;
}

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const pair = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && num(v[0]) && num(v[1]);
const pt = (v: unknown): v is Point => Array.isArray(v) && v.length >= 2 && num(v[0]) && num(v[1]);
const kindOf = (v: unknown): WallKind => (v === 'b' || v === 'e' || v === 'low' || v === 'n' ? v : 'n');

/** 校验并修复户型文档；非法字段回退默认值 */
export function normalizePlanDoc(input: unknown): PlanDoc {
  if (!input || typeof input !== 'object') return defaultLayout();
  const o = input as Partial<PlanDoc>;
  if (!Array.isArray(o.lines)) return defaultLayout();

  const lineIds = new Set<string>();
  const lines: WallLine[] = [];
  o.lines.forEach((l, i) => {
    if (!l || typeof l !== 'object') return;
    if (l.axis !== 'h' && l.axis !== 'v') return;
    if (!pair(l.span) || !pair(l.band)) return;
    const id = typeof l.id === 'string' && l.id ? l.id : `L${i + 1}`;
    if (lineIds.has(id)) return;
    lineIds.add(id);
    lines.push({
      id,
      axis: l.axis,
      kind: kindOf(l.kind),
      band: [Math.min(l.band[0], l.band[1]), Math.max(l.band[0], l.band[1])],
      span: [Math.min(l.span[0], l.span[1]), Math.max(l.span[0], l.span[1])],
    });
  });

  const byId = new Map(lines.map((l) => [l.id, l]));
  const openings: OpeningData[] = [];
  if (Array.isArray(o.openings)) {
    o.openings.forEach((op, i) => {
      if (!op || typeof op !== 'object') return;
      const line = byId.get(op.lineId);
      if (!line || !pair(op.span)) return;
      const kind: OpeningKind = op.kind === 'window' || op.kind === 'slide' ? op.kind : 'door';
      const span: [number, number] = [
        Math.max(line.span[0], Math.min(op.span[0], op.span[1])),
        Math.min(line.span[1], Math.max(op.span[0], op.span[1])),
      ];
      if (span[1] - span[0] < 1) return;
      openings.push({
        id: typeof op.id === 'string' && op.id ? op.id : `O${i + 1}`,
        lineId: line.id,
        kind,
        span,
        sill: num(op.sill) ? op.sill : kind === 'window' ? DEFAULTS.sill : undefined,
        head: num(op.head) ? op.head : kind === 'window' ? DEFAULTS.head : kind === 'door' ? DEFAULTS.doorHead : undefined,
        hingeEnd: op.hingeEnd === 'end' ? 'end' : kind === 'door' ? 'start' : undefined,
        swing: (op.swing === -1 ? -1 : 1) as 1 | -1,
        entry: !!op.entry,
      });
    });
  }

  const rooms: RoomData[] = [];
  if (Array.isArray(o.rooms)) {
    o.rooms.forEach((r, i) => {
      if (!r || typeof r !== 'object') return;
      if (!Array.isArray(r.poly) || r.poly.length < 3 || !r.poly.every(pt)) return;
      const name = typeof r.name === 'string' && r.name ? r.name : `房间 ${i + 1}`;
      rooms.push({
        id: typeof r.id === 'string' && r.id ? r.id : newId('room'),
        name,
        nameEn: typeof r.nameEn === 'string' && r.nameEn ? r.nameEn : name,
        mat: typeof r.mat === 'string' ? r.mat : 'tile800',
        poly: r.poly.map((p) => [p[0], p[1]] as Point),
        labelAt: pt(r.labelAt) ? [r.labelAt[0], r.labelAt[1]] : undefined,
        counted: r.counted === false ? false : undefined,
      });
    });
  }

  const bounds = o.bounds && typeof o.bounds === 'object'
    && num(o.bounds.x) && num(o.bounds.y) && num(o.bounds.w) && num(o.bounds.h)
    ? { x: o.bounds.x, y: o.bounds.y, w: o.bounds.w, h: o.bounds.h }
    : { ...template.bounds };
  const origin = pt(o.origin) ? [...o.origin] as Point : [...template.origin] as Point;
  const floorHeight = num(o.floorHeight) && o.floorHeight > 0 ? o.floorHeight : template.floorHeight;
  const dimensionChains = o.dimensionChains && Array.isArray(o.dimensionChains.horizontal) && Array.isArray(o.dimensionChains.vertical)
    ? o.dimensionChains
    : null;

  return {
    schemaVersion: 2,
    bounds,
    origin,
    floorHeight,
    lines,
    openings,
    rooms,
    dimensionChains,
  };
}

/** 兼容旧存档 / 缺失字段；v1 快照会迁移为 v2 户型文档 */
export function normalizeDesign(input: unknown): DesignState | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Partial<DesignState> & Record<string, unknown>;
  if (!Array.isArray(obj.furniture)) return null;
  const layout = obj.layout && typeof obj.layout === 'object'
    ? normalizePlanDoc(obj.layout)
    : migrateLegacy(obj);
  const fallback = defaultLayout();
  const demoRaw = obj.demolishedLines ?? obj.demolished;
  const demolishedRaw = Array.isArray(demoRaw) ? demoRaw : [];
  let demolishedLines = demolishedRaw.filter((x): x is string => typeof x === 'string');
  if (!obj.layout && Array.isArray(obj.demolished)) {
    demolishedLines = demolishedLines
      .map((id) => baseTemplate().indexToLine[Number(id.replace(/^w/, ''))])
      .filter((id): id is string => !!id);
  }
  const lineIds = new Set(layout.lines.map((l) => l.id));
  return {
    layout,
    furniture: obj.furniture.map((f) => ({
      ...f,
      rot: f.rot ?? 0,
      color: f.color ?? colorForType(f.type),
    })),
    demolishedLines: demolishedLines.filter((id) => lineIds.has(id) || fallback.lines.some((l) => l.id === id)),
    measures: Array.isArray(obj.measures) ? obj.measures : [],
  };
}

export function defaultDesign(): DesignState {
  return {
    layout: defaultLayout(),
    furniture: template.initialFurniture.map(makeFurniture),
    demolishedLines: [],
    measures: [],
  };
}

export function loadDesign(): DesignState {
  try {
    const v2 = localStorage.getItem(STORE_KEY);
    if (v2) {
      const normalized = normalizeDesign(JSON.parse(v2));
      if (normalized) return normalized;
    }
    const v1 = localStorage.getItem(LEGACY_STORE_KEY);
    if (v1) {
      const normalized = normalizeDesign(JSON.parse(v1));
      if (normalized) return normalized;
    }
  } catch {
    /* ignore */
  }
  return defaultDesign();
}
