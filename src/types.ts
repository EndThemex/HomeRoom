export type WallKind = 'b' | 'e' | 'n' | 'low';

export type Point = [number, number];

export interface WallData {
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

export interface RoomData {
  id: string;
  name: string;
  nameEn: string;
  poly: Point[];
  mat: string;
  labelAt?: Point;
  counted?: boolean;
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
  walls: WallData[];
  windows: WindowData[];
  doors: DoorData[];
  slides: SlideData[];
  rooms: RoomData[];
  materials: Record<string, MaterialData>;
  catalog: CatalogCategory[];
  initialFurniture: FurnitureSeed[];
  dimensionChains: {
    horizontal: { at: number; start: number; segs: number[] }[];
    vertical: { at: number; start: number; segs: number[] }[];
  };
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

export interface RoomState {
  name: string;
  mat: string;
}

export type Tool = 'select' | 'measure' | 'demolish';

export interface Layers {
  dims: boolean;
  labels: boolean;
  furn: boolean;
  grid: boolean;
  bearing: boolean;
  wallSnap: boolean;
}

export interface DesignState {
  furniture: Furniture[];
  rooms: Record<string, RoomState>;
  demolished: string[];
  measures: Measure[];
}

export interface Selection {
  kind: 'furn' | 'room';
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
