import type { PlanDoc, Point, RoomData } from '../types';
import { areaOf } from './geometry';
import { openingRect } from './openings';
import { newId, DEFAULTS } from './planDoc';
import { wallRectsOf } from './layoutOps';

interface Rect { x0: number; y0: number; x1: number; y1: number }

const uniqueCoords = (values: number[]) => {
  const sorted = values.slice().sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((v) => {
    if (!out.length || v !== out[out.length - 1]) out.push(v);
  });
  return out;
};

const pointInPoly = (p: Point, poly: Point[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
};

const distToSegment = (p: Point, a: Point, b: Point) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return Math.hypot(p[0] - a[0], p[1] - a[1]);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

const distToBoundary = (p: Point, poly: Point[]) => {
  let d = Infinity;
  for (let i = 0; i < poly.length; i++) {
    d = Math.min(d, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  }
  return d;
};

function centroid(poly: Point[]): Point {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    const q = poly[(i + 1) % poly.length];
    const f = p[0] * q[1] - q[0] * p[1];
    a += f;
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  if (!a) {
    const xs = poly.map((p) => p[0]);
    const ys = poly.map((p) => p[1]);
    return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
  }
  return [cx / (3 * a), cy / (3 * a)];
}

function interiorPoint(poly: Point[]): Point {
  const c = centroid(poly);
  if (pointInPoly(c, poly) && distToBoundary(c, poly) >= 250) return c;
  const xs = poly.map((p) => p[0]);
  const ys = poly.map((p) => p[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  const step = Math.max(100, Math.min(250, (x1 - x0) / 12, (y1 - y0) / 12));
  let best: Point | null = null;
  let bestD = -1;
  for (let x = x0 + step / 2; x < x1; x += step) {
    for (let y = y0 + step / 2; y < y1; y += step) {
      const p: Point = [x, y];
      if (!pointInPoly(p, poly)) continue;
      const d = distToBoundary(p, poly);
      if (d > bestD) { bestD = d; best = p; }
    }
  }
  return best ?? c;
}

function simplify(poly: Point[]): Point[] {
  if (poly.length < 3) return poly;
  const out: Point[] = [];
  poly.forEach((p, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length];
    const next = poly[(i + 1) % poly.length];
    const cross = (p[0] - prev[0]) * (next[1] - p[1]) - (p[1] - prev[1]) * (next[0] - p[0]);
    if (Math.abs(cross) > 1) out.push(p);
  });
  return out.length >= 3 ? out : poly;
}

interface Candidate { poly: Point[]; area: number }

/** 压缩网格 + 洪水填充 + 边界追踪：精确提取轴对齐房间面环 */
function traceCandidates(rects: Rect[]): Candidate[] {
  if (!rects.length) return [];
  let minX = Infinity; let minY = Infinity; let maxX = -Infinity; let maxY = -Infinity;
  const xsRaw: number[] = [];
  const ysRaw: number[] = [];
  rects.forEach((r) => {
    minX = Math.min(minX, r.x0); minY = Math.min(minY, r.y0);
    maxX = Math.max(maxX, r.x1); maxY = Math.max(maxY, r.y1);
    xsRaw.push(r.x0, r.x1);
    ysRaw.push(r.y0, r.y1);
  });
  const pad = 10000;
  const xs = uniqueCoords([minX - pad, ...xsRaw, maxX + pad]);
  const ys = uniqueCoords([minY - pad, ...ysRaw, maxY + pad]);
  const nx = xs.length - 1;
  const ny = ys.length - 1;
  if (nx < 1 || ny < 1) return [];
  const blocked = new Uint8Array(nx * ny);
  const xi = new Map(xs.map((v, i) => [v, i]));
  const yi = new Map(ys.map((v, i) => [v, i]));
  rects.forEach((r) => {
    const i0 = xi.get(r.x0)!;
    const i1 = xi.get(r.x1)!;
    const j0 = yi.get(r.y0)!;
    const j1 = yi.get(r.y1)!;
    for (let j = j0; j < j1; j++) {
      for (let i = i0; i < i1; i++) blocked[j * nx + i] = 1;
    }
  });

  const comp = new Int32Array(nx * ny).fill(-1);
  const comps: number[][] = [];
  const ids: number[] = [];
  const stack: number[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const idx = j * nx + i;
      if (blocked[idx] || comp[idx] >= 0) continue;
      const id = comps.length;
      const cells: number[] = [];
      comp[idx] = id;
      stack.push(idx);
      while (stack.length) {
        const cur = stack.pop()!;
        cells.push(cur);
        const cx = cur % nx;
        const cy = (cur - cx) / nx;
        const nbs = [
          cx > 0 ? cur - 1 : -1,
          cx < nx - 1 ? cur + 1 : -1,
          cy > 0 ? cur - nx : -1,
          cy < ny - 1 ? cur + nx : -1,
        ];
        for (const n of nbs) {
          if (n < 0 || blocked[n] || comp[n] >= 0) continue;
          comp[n] = id;
          stack.push(n);
        }
      }
      comps.push(cells);
      ids.push(id);
    }
  }

  const candidates: Candidate[] = [];
  comps.forEach((cells) => {
    // 接触边界的是外部空间
    let onBorder = false;
    for (const c of cells) {
      const cx = c % nx;
      const cy = (c - cx) / nx;
      if (cx === 0 || cx === nx - 1 || cy === 0 || cy === ny - 1) { onBorder = true; break; }
    }
    if (onBorder) return;
    const set = new Set(cells);
    const startMap = new Map<string, { to: string; dx: number; dy: number }[]>();
    const key = (x: number, y: number) => `${x},${y}`;
    const addEdge = (x0: number, y0: number, x1: number, y1: number) => {
      const k = key(x0, y0);
      const arr = startMap.get(k);
      const e = { to: key(x1, y1), dx: x1 - x0, dy: y1 - y0 };
      if (arr) arr.push(e);
      else startMap.set(k, [e]);
    };
    cells.forEach((c) => {
      const cx = c % nx;
      const cy = (c - cx) / nx;
      const x0 = xs[cx]; const x1 = xs[cx + 1];
      const y0 = ys[cy]; const y1 = ys[cy + 1];
      if (!set.has((cy - 1) * nx + cx)) addEdge(x0, y0, x1, y0);
      if (!set.has((cy + 1) * nx + cx)) addEdge(x1, y1, x0, y1);
      if (!set.has(cy * nx + cx + 1)) addEdge(x1, y0, x1, y1);
      if (!set.has(cy * nx + cx - 1)) addEdge(x0, y1, x0, y0);
    });

    const used = new Set<string>();
    const edgeKey = (from: string, e: { to: string }) => `${from}>${e.to}`;
    const maxLoop = cells.length * 4 + 8;
    for (const [start, edges] of startMap) {
      if (edges.every((e) => used.has(edgeKey(start, e)))) continue;
      const poly: Point[] = [];
      let at = start;
      let dir = edges.find((e) => !used.has(edgeKey(start, e)))!;
      let guard = 0;
      while (guard++ < maxLoop) {
        poly.push(at.split(',').map(Number) as Point);
        used.add(edgeKey(at, dir));
        at = dir.to;
        if (at === start) break;
        const cands = startMap.get(at);
        if (!cands) break;
        // 最右转：优先选择顺时针旋转最大的边，保证内侧在右
        let best: { to: string; dx: number; dy: number } | null = null;
        let bestCross = -Infinity;
        for (const e of cands) {
          if (used.has(edgeKey(at, e))) continue;
          const cross = dir.dx * e.dy - dir.dy * e.dx;
          if (cross > bestCross) { bestCross = cross; best = e; }
        }
        if (!best) break;
        dir = best;
      }
      if (poly.length >= 4) {
        const simple = simplify(poly);
        const area = areaOf(simple) * 1e6;
        if (area >= DEFAULTS.minRoomArea * 1e6) candidates.push({ poly: simple, area });
      }
    }
  });
  return candidates;
}

interface RoomMatch {
  oldId?: string;
  overlap: number;
}

/** 允许近似：25mm 栅格化统计重叠比例，仅用于属性继承 */
function matchRooms(prev: RoomData[], next: Candidate[]): RoomMatch[] {
  const used = new Set<number>();
  return next.map((cand) => {
    let best = -1;
    let bestHits = 0;
    let bestTotal = 0;
    prev.forEach((old, i) => {
      if (used.has(i)) return;
      const xs = old.poly.map((p) => p[0]);
      const ys = old.poly.map((p) => p[1]);
      let total = 0;
      let hit = 0;
      const step = DEFAULTS.matchGrid;
      for (let x = Math.min(...xs); x <= Math.max(...xs); x += step) {
        for (let y = Math.min(...ys); y <= Math.max(...ys); y += step) {
          const p: Point = [x, y];
          if (!pointInPoly(p, old.poly)) continue;
          total++;
          if (pointInPoly(p, cand.poly)) hit++;
        }
      }
      if (!total) return;
      // 取绝对重叠面积最大的旧房间（同一新区域内多个旧房间时，继承面积最大的那间）
      if (hit > bestHits || (hit === bestHits && total > bestTotal)) {
        bestHits = hit;
        bestTotal = total;
        best = i;
      }
    });
    if (best >= 0) {
      const overlap = bestTotal ? bestHits / bestTotal : 0;
      if (overlap >= 0.02) {
        used.add(best);
        return { oldId: prev[best].id, overlap };
      }
    }
    return { overlap: 0 };
  });
}

/** 面环提取 + 属性匹配：墙线 / 洞口提交后调用 */
export function refreshRooms(layout: PlanDoc, prev: RoomData[], demolishedLines: string[]): RoomData[] {
  try {
    const rects: Rect[] = wallRectsOf(layout, demolishedLines).map((w) => ({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }));
    layout.openings.forEach((o) => {
      if (demolishedLines.includes(o.lineId)) return;
      const line = layout.lines.find((l) => l.id === o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      rects.push({ x0, y0, x1, y1 });
    });
    const candidates = traceCandidates(rects);
    const matches = matchRooms(prev, candidates);
    let n = prev.length + 1;
    return candidates.map((c, i) => {
      const m = matches[i];
      const old = m.oldId ? prev.find((r) => r.id === m.oldId) : undefined;
      const labelAt = interiorPoint(c.poly);
      if (old) {
        return {
          ...old,
          poly: c.poly,
          labelAt,
        };
      }
      return {
        id: newId('room'),
        name: `房间 ${n}`,
        nameEn: `Room ${n}`,
        mat: 'tile800',
        poly: c.poly,
        labelAt,
      } as RoomData;
    }).map((r, i, arr) => {
      // 未匹配的新房间顺序命名
      if (r.name.startsWith('房间 ')) {
        const idx = arr.slice(0, i).filter((x) => x.name.startsWith('房间 ')).length;
        const num = prev.length + 1 + idx;
        r.name = `房间 ${num}`;
        r.nameEn = `Room ${num}`;
      }
      return r;
    });
  } catch {
    return prev;
  }
}
