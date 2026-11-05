import raw from '../data/floorplan.json';
import { registerPlanNames } from './i18n';
import type { DesignState, FloorPlanData, Furniture, FurnitureSeed } from '../types';

export const plan = raw as unknown as FloorPlanData;
registerPlanNames(plan);

export const STORE_KEY = 'homeroom-design-v1';
export const PANES_KEY = 'homeroom-panes';
export const LANG_KEY = 'homeroom-lang';

let seq = 1;
export const uid = () => 'f' + Date.now().toString(36) + seq++;

const typeColors = new Map<string, string>();
plan.catalog.forEach((c) => c.items.forEach((i) => { if (!typeColors.has(i.type)) typeColors.set(i.type, i.color); }));
export const colorForType = (type: string) => typeColors.get(type) ?? '#eeeeee';

export function makeFurniture(seed: FurnitureSeed): Furniture {
  return {
    id: uid(),
    type: seed.type,
    name: seed.name,
    cx: seed.cx,
    cy: seed.cy,
    w: seed.w,
    d: seed.d,
    rot: seed.rot ?? 0,
    color: seed.color ?? colorForType(seed.type),
  };
}

export function defaultDesign(): DesignState {
  const rooms: Record<string, { name: string; mat: string }> = {};
  plan.rooms.forEach((r) => { rooms[r.id] = { name: r.name, mat: r.mat }; });
  return {
    furniture: plan.initialFurniture.map(makeFurniture),
    rooms,
    demolished: [],
    measures: [],
  };
}

/** 兼容旧存档 / 缺失字段；所有房间都以当前户型数据兜底 */
export function normalizeDesign(input: unknown): DesignState | null {
  if (!input || typeof input !== 'object') return null;
  const obj = input as Partial<DesignState>;
  if (!Array.isArray(obj.furniture)) return null;
  const base = defaultDesign();
  return {
    furniture: obj.furniture.map((f) => ({
      ...f,
      rot: f.rot ?? 0,
      color: f.color ?? colorForType(f.type),
    })) as Furniture[],
    rooms: { ...base.rooms, ...(obj.rooms ?? {}) },
    demolished: obj.demolished ?? [],
    measures: obj.measures ?? [],
  };
}

export function loadDesign(): DesignState {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null');
    const normalized = normalizeDesign(saved);
    if (normalized) return normalized;
  } catch {
    /* ignore */
  }
  return defaultDesign();
}

export const roomById = (id: string) => plan.rooms.find((r) => r.id === id);

export const snapRects = (demolished: string[]) => [
  ...plan.walls.filter((_, i) => !demolished.includes('w' + i)),
  ...plan.windows,
];
