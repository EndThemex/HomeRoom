import raw from '../data/floorplan.json';
import { registerPlanNames } from './i18n';
import type { FloorPlanData, Furniture, FurnitureSeed } from '../types';

/** 静态模板：材质、家具目录、初始家具与历史户型（仅迁移使用） */
export const plan = raw as unknown as FloorPlanData;
registerPlanNames(plan);

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
