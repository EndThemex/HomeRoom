export type WallKind = 'b' | 'e' | 'n' | 'low';

export type Point = [number, number];

export type Axis = 'h' | 'v';

/** 墙线：持久化的墙体主体（本期的存储粒度） */
export interface WallLine {
  id: string;
  axis: Axis;
  kind: WallKind;
  band: [number, number];
  span: [number, number];
}

/** 墙块：由墙线 span 减去洞口派生，不持久化（用于 2D/3D 渲染与命中） */
export interface WallData {
  id: string;
  lineId: string;
  x0: number; y0: number; x1: number; y1: number;
  kind: WallKind;
}

export type OpeningKind = 'door' | 'window' | 'slide';

/** 门窗洞口：位于某条墙线的区间 */
export interface OpeningData {
  id: string;
  lineId: string;
  kind: OpeningKind;
  span: [number, number];
  sill?: number;
  head?: number;
  hingeEnd?: 'start' | 'end';
  swing?: 1 | -1;
  entry?: boolean;
}

/** 门参数派生出的门扇实例 */
export interface DoorRender {
  hinge: Point;
  closedDir: Point;
  openDir: Point;
  len: number;
  entry: boolean;
}

export interface RoomData {
  id: string;
  name: string;
  nameEn: string;
  poly: Point[];
  mat: string;
  labelAt?: Point;
  counted?: boolean;
}

export interface DimensionChains {
  horizontal: { at: number; start: number; segs: number[] }[];
  vertical: { at: number; start: number; segs: number[] }[];
}

export interface PlanDoc {
  schemaVersion: 2;
  bounds: { x: number; y: number; w: number; h: number };
  origin: Point;
  floorHeight: number;
  lines: WallLine[];
  openings: OpeningData[];
  rooms: RoomData[];
  dimensionChains: DimensionChains | null;
}

/* ------------------------- 旧静态模板结构（仅用于模板与迁移） ------------------------- */

export interface LegacyWallData {
  x0: number; y0: number; x1: number; y1: number;
  kind: WallKind;
}

export interface WindowData {
  x0: number; y0: number; x1: number; y1: number;
  sill: number;
  head: number;
}

export interface DoorData {
  name: string;
  nameEn: string;
  rect: [number, number, number, number];
  hinge: Point;
  closedDir: Point;
  openDir: Point;
  len: number;
  entry?: boolean;
}

export interface SlideData {
  rect: [number, number, number, number];
  vertical: boolean;
}

export interface MaterialData {
  name: string;
  nameEn: string;
  price: number;
  swatch: string;
  pattern: string;
  tex: { u: number; v: number; base: string; grout?: string; rough: number };
}

export interface CatalogItem {
  type: string;
  name: string;
  nameEn: string;
  w: number;
  d: number;
  color: string;
}

export interface CatalogCategory {
  name: string;
  nameEn: string;
  items: CatalogItem[];
}

export interface FurnitureSeed {
  type: string;
  name: string;
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot?: number;
  color?: string;
}

export interface FloorPlanData {
  meta: { title: string; titleEn: string; note: string; noteEn: string };
  bounds: { x: number; y: number; w: number; h: number };
  origin: Point;
  floorHeight: number;
  walls: LegacyWallData[];
  windows: WindowData[];
  doors: DoorData[];
  slides: SlideData[];
  rooms: RoomData[];
  materials: Record<string, MaterialData>;
  catalog: CatalogCategory[];
  initialFurniture: FurnitureSeed[];
  dimensionChains: DimensionChains;
}

export interface Furniture {
  id: string;
  type: string;
  name: string;
  cx: number;
  cy: number;
  w: number;
  d: number;
  rot: number;
  color: string;
}

export interface Measure {
  a: { x: number; y: number };
  b: { x: number; y: number };
}

export interface LegacyRoomState {
  name: string;
  mat: string;
}

export type Tool =
  | 'select' | 'wall' | 'room' | 'door' | 'window' | 'slide'
  | 'measure' | 'demolish';

export interface Layers {
  dims: boolean;
  labels: boolean;
  furn: boolean;
  grid: boolean;
  bearing: boolean;
  wallSnap: boolean;
  walls: boolean;
  openings: boolean;
}

export interface DesignState {
  layout: PlanDoc;
  furniture: Furniture[];
  demolishedLines: string[];
  measures: Measure[];
}

export interface Selection {
  kind: 'furn' | 'room' | 'wall' | 'door' | 'window' | 'slide';
  id: string;
}

export interface ViewTransform {
  x0: number;
  y0: number;
  s: number;
}

export type ViewMode = '2d' | '3d';
export type CameraMode = 'orbit' | 'walk';

export interface ScaleBar {
  width: number;
  label: string;
  ratio: number;
}
