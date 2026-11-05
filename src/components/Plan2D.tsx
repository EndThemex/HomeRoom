import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, SVGProps } from 'react';
import type { Layers, Point, Selection, Tool, ViewTransform } from '../types';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { areaOf, fmt, normAngle, PX_MM } from '../lib/geometry';
import { plan, roomById, snapRects } from '../lib/plan';
import { pushOut, snapMove, snapPoint } from '../lib/snap';
import { furnitureSvg } from './furnitureSvg';
import type { StageApi } from '../lib/stageApi';

interface Props {
  store: DesignStore;
  viewRef: MutableRefObject<ViewTransform>;
  tool: Tool;
  selection: Selection | null;
  layers: Layers;
  i18n: I18n;
  stageApiRef: MutableRefObject<StageApi | null>;
  onSelect: (sel: Selection | null) => void;
  onToggleWall: (id: string) => void;
  onMeasure: (a: Point, b: Point) => void;
  stageEl?: HTMLDivElement | null;
}

type DragState =
  | { kind: 'pan'; sx: number; sy: number; x0: number; y0: number; room: string | null; moved: boolean }
  | { kind: 'move'; id: string; sx: number; sy: number; ox: number; oy: number; before: string; moved: boolean }
  | { kind: 'rot'; id: string; sx: number; sy: number; before: string; moved: boolean }
  | { kind: 'size'; id: string; sx: number; sy: number; before: string; moved: boolean }
  | { kind: 'measure'; sx: number; sy: number; moved: boolean };

const COARSE = typeof window !== 'undefined' && matchMedia('(pointer:coarse)').matches;
const TAP = COARSE ? 9 : 4;

const NS = 'http://www.w3.org/2000/svg';
const ST = 'stroke="#3d3a34" stroke-width="1" vector-effect="non-scaling-stroke"';
const dash = (color = '#b5653a', w = 1.4) =>
  `stroke="${color}" stroke-width="${w}" stroke-dasharray="5 3" vector-effect="non-scaling-stroke"`;

function buildDefs(): string {
  const m = plan.materials;
  const plank = (id: string, base: string, line: string) => `
    <pattern id="m-${id}" patternUnits="userSpaceOnUse" width="1800" height="360">
      <rect width="1800" height="360" fill="${base}"/>
      <path d="M0 0H1800M0 180H1800M1200 0V180M600 180V360" stroke="${line}" stroke-width="10"/>
      <path d="M100 70Q500 60 900 85T1700 75M200 260Q700 250 1100 275T1750 262" stroke="${line}" stroke-width="5" fill="none" opacity=".45"/>
    </pattern>`;
  const tile = (id: string, size: number, base: string, line: string) => `
    <pattern id="m-${id}" patternUnits="userSpaceOnUse" width="${size}" height="${size}">
      <rect width="${size}" height="${size}" fill="${base}"/><path d="M0 0H${size}M0 0V${size}" stroke="${line}" stroke-width="10"/>
    </pattern>`;
  return (
    plank('wood', m.wood.tex.base, '#bf9d70') +
    plank('walnut', m.walnut.tex.base, '#80593a') +
    tile('tile800', 800, m.tile800.tex.base, '#d3cabb') +
    tile('tile600', 600, m.tile600.tex.base, '#c4cbc6') +
    tile('antislip', 300, m.antislip.tex.base, '#b3bab4') +
    `<pattern id="m-marble" patternUnits="userSpaceOnUse" width="1200" height="1200">
      <rect width="1200" height="1200" fill="#f3f0ea"/><path d="M0 0H1200M0 0V1200" stroke="#dcd5c8" stroke-width="10"/>
      <path d="M-50 300C250 260 380 520 700 470S1100 640 1260 600M200 1200C300 950 520 980 640 820" stroke="#d6cfc2" stroke-width="12" fill="none"/>
    </pattern>
    <pattern id="m-terrazzo" patternUnits="userSpaceOnUse" width="500" height="500">
      <rect width="500" height="500" fill="#e8e1d5"/>
      <circle cx="60" cy="80" r="22" fill="#b9a58c"/><circle cx="310" cy="140" r="16" fill="#8fa3a0"/><circle cx="190" cy="330" r="26" fill="#c9b7a2"/>
      <circle cx="420" cy="400" r="18" fill="#a88f76"/><circle cx="90" cy="440" r="12" fill="#8fa3a0"/><circle cx="440" cy="40" r="10" fill="#b9a58c"/>
    </pattern>
    <pattern id="m-carpet" patternUnits="userSpaceOnUse" width="120" height="120">
      <rect width="120" height="120" fill="#c9c3d3"/><circle cx="30" cy="30" r="8" fill="#bab3c6"/><circle cx="90" cy="90" r="8" fill="#bab3c6"/>
    </pattern>
    <pattern id="grid" patternUnits="userSpaceOnUse" width="1000" height="1000">
      <path d="M500 0V1000M0 500H1000" stroke="#e5dfd3" stroke-width="8"/><path d="M0 0V1000M0 0H1000" stroke="#d8d0c1" stroke-width="14"/>
    </pattern>`
  );
}

function dimChains(): string {
  const DC = '#7d7160';
  const LS = `stroke="${DC}" stroke-width="1" vector-effect="non-scaling-stroke"`;
  const TK = `stroke="${DC}" stroke-width="2" vector-effect="non-scaling-stroke"`;
  const txt = (x: number, y: number, v: number, rot?: boolean) =>
    `<text x="${x}" y="${y}" font-size="${v < 400 ? 140 : 200}" text-anchor="middle" fill="${DC}" ${rot ? `transform="rotate(-90 ${x} ${y})"` : ''}>${v}</text>`;
  const chain = (horiz: boolean, at: number, start: number, segs: number[]) => {
    const pts = [start];
    segs.forEach((v) => pts.push(pts[pts.length - 1] + v));
    let s = horiz
      ? `<line x1="${pts[0]}" y1="${at}" x2="${pts[pts.length - 1]}" y2="${at}" ${LS}/>`
      : `<line x1="${at}" y1="${pts[0]}" x2="${at}" y2="${pts[pts.length - 1]}" ${LS}/>`;
    pts.forEach((p) => {
      s += horiz
        ? `<line x1="${p}" y1="${at - 170}" x2="${p}" y2="${at + 170}" ${LS}/><line x1="${p - 80}" y1="${at + 80}" x2="${p + 80}" y2="${at - 80}" ${TK}/>`
        : `<line x1="${at - 170}" y1="${p}" x2="${at + 170}" y2="${p}" ${LS}/><line x1="${at - 80}" y1="${p + 80}" x2="${at + 80}" y2="${p - 80}" ${TK}/>`;
    });
    segs.forEach((v, i) => {
      const mid = (pts[i] + pts[i + 1]) / 2;
      s += horiz ? txt(mid, at - 70, v) : txt(at - 70, mid, v, true);
    });
    return s;
  };
  const { horizontal, vertical } = plan.dimensionChains;
  return horizontal.map((c) => chain(true, c.at, c.start, c.segs)).join('') +
    vertical.map((c) => chain(false, c.at, c.start, c.segs)).join('');
}

export function Plan2D(props: Props) {
  const { store, viewRef, tool, selection, layers, i18n, stageApiRef, onSelect, onToggleWall, onMeasure } = props;
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const svgRef = useRef<SVGSVGElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);
  const [, bump] = useReducer((n: number) => n + 1, 0);
  const [measure, setMeasure] = useState<{ a: Point | null; cur: Point | null }>({ a: null, cur: null });
  const dragRef = useRef<DragState | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchRef = useRef<{ d: number; c: [number, number]; s: number; px: number; py: number } | null>(null);

  const svgSize = () => {
    const el = svgRef.current;
    return el ? { w: el.clientWidth || 1, h: el.clientHeight || 1 } : { w: 1, h: 1 };
  };

  const applyView = useCallback(() => {
    const el = svgRef.current;
    if (!el) return;
    const { w, h } = svgSize();
    const v = viewRef.current;
    el.setAttribute('viewBox', `${v.x0} ${v.y0} ${w / v.s} ${h / v.s}`);
    bump();
  }, [viewRef]);

  const fitView = useCallback(() => {
    const { w, h } = svgSize();
    const b = plan.bounds;
    const s = Math.min(w / b.w, h / b.h);
    viewRef.current = { s, x0: b.x - (w / s - b.w) / 2, y0: b.y - (h / s - b.h) / 2 };
    applyView();
  }, [applyView, viewRef]);

  const zoomAt = useCallback((ns: number, mx: number, my: number) => {
    const v = viewRef.current;
    const s = Math.max(0.012, Math.min(2, ns));
    const px = v.x0 + mx / v.s;
    const py = v.y0 + my / v.s;
    viewRef.current = { s, x0: px - mx / s, y0: py - my / s };
    applyView();
  }, [applyView, viewRef]);

  const zoomCenter = useCallback((k: number) => {
    const { w, h } = svgSize();
    zoomAt(viewRef.current.s * k, w / 2, h / 2);
  }, [viewRef, zoomAt]);

  const toMM = useCallback((clientX: number, clientY: number): Point => {
    const svg = svgRef.current!;
    const rect = svg.getBoundingClientRect();
    const v = viewRef.current;
    const { w, h } = svgSize();
    return [v.x0 + ((clientX - rect.left) / w) * (w / v.s), v.y0 + ((clientY - rect.top) / h) * (h / v.s)];
  }, [viewRef]);

  // 首次挂载后适应窗口；窗口尺寸变化时保持中心
  useEffect(() => {
    fitView();
    const onResize = () => applyView();
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 滚轮缩放（React 的 onWheel 是 passive，需手动绑定）
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(viewRef.current.s * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt, viewRef]);

  // 对外暴露给家具库拖放 / 工具栏
  useEffect(() => {
    stageApiRef.current = {
      fit: fitView,
      zoomBy: zoomCenter,
      dropPoint: (x, y) => {
        const r = wrapRef.current?.getBoundingClientRect();
        if (!r || x < r.left || x > r.right || y < r.top || y > r.bottom) return null;
        const p = toMM(x, y);
        return { x: p[0], y: p[1], s: viewRef.current.s };
      },
      centerPoint: () => {
        const { w, h } = svgSize();
        const v = viewRef.current;
        return { x: v.x0 + w / 2 / v.s, y: v.y0 + h / 2 / v.s };
      },
      setRatio: (ratio) => {
        const { w, h } = svgSize();
        const v = viewRef.current;
        const cx = v.x0 + w / 2 / v.s;
        const cy = v.y0 + h / 2 / v.s;
        const s = 1 / (ratio * PX_MM);
        viewRef.current = { s, x0: cx - w / 2 / s, y0: cy - h / 2 / s };
        applyView();
      },
    };
    return () => { stageApiRef.current = null; };
  }, [applyView, fitView, zoomCenter, stageApiRef, toMM, viewRef]);

  // 工具切换时清空测量临时点
  useEffect(() => { setMeasure({ a: null, cur: null }); }, [tool]);

  useEffect(() => {
    if (tool === 'measure' && measure.a && measure.cur) {
      const el = svgRef.current;
      if (el) el.setAttribute('class', 'tool-measure');
    }
  }, [tool, measure.a, measure.cur]);

  const endDrag = (cancel: boolean) => {
    const d = dragRef.current;
    dragRef.current = null;
    svgRef.current?.classList.remove('panning');
    if (!d) return;
    if (d.kind === 'measure') {
      if (cancel) { setMeasure({ a: null, cur: null }); return; }
      const { a, cur } = measure;
      if (d.moved && a && cur && Math.hypot(cur[0] - a[0], cur[1] - a[1]) > 20) {
        setMeasure({ a: null, cur: null });
        onMeasure(a, cur);
      }
      return;
    }
    if (d.kind === 'pan') {
      if (!cancel && !d.moved && d.room) onSelect({ kind: 'room', id: d.room });
      return;
    }
    if (d.moved) store.commit(d.before);
  };

  const onPointerDown = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (e.button === 1 || e.button === 2) return;
    const target = e.target as Element;
    if (e.pointerType !== 'mouse') {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (pointers.current.size >= 2) {
        endDrag(true);
        const [a, b] = [...pointers.current.values()];
        const svg = svgRef.current!;
        const r = svg.getBoundingClientRect();
        const c: [number, number] = [((a.x + b.x) / 2) - r.left, ((a.y + b.y) / 2) - r.top];
        pinchRef.current = {
          d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
          c,
          s: viewRef.current.s,
          px: viewRef.current.x0 + c[0] / viewRef.current.s,
          py: viewRef.current.y0 + c[1] / viewRef.current.s,
        };
        return;
      }
    }
    if (pinchRef.current) return;

    const p = toMM(e.clientX, e.clientY);
    if (tool === 'measure') {
      const q = snapPoint(p, e.shiftKey, measure.a, snapRects(state.demolished), viewRef.current.s);
      if (!measure.a) {
        setMeasure({ a: q, cur: q });
        dragRef.current = { kind: 'measure', sx: e.clientX, sy: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
      } else {
        const a = measure.a;
        setMeasure({ a: null, cur: null });
        if (Math.hypot(q[0] - a[0], q[1] - a[1]) > 20) onMeasure(a, q);
      }
      return;
    }

    const handle = target.closest('[data-handle]') as HTMLElement | null;
    if (handle && selection?.kind === 'furn') {
      const kind = handle.dataset.handle === 'rot' ? 'rot' : 'size';
      dragRef.current = { kind, id: selection.id, sx: e.clientX, sy: e.clientY, before: store.snapshot(), moved: false };
    } else if (tool === 'demolish' && target.closest('[data-wall]')) {
      onToggleWall((target.closest('[data-wall]') as HTMLElement).dataset.wall!);
      return;
    } else if (tool === 'select' && target.closest('[data-fid]')) {
      const fid = (target.closest('[data-fid]') as HTMLElement).dataset.fid!;
      if (selection?.id !== fid) onSelect({ kind: 'furn', id: fid });
      const f = state.furniture.find((x) => x.id === fid)!;
      dragRef.current = { kind: 'move', id: fid, sx: e.clientX, sy: e.clientY, ox: p[0] - f.cx, oy: p[1] - f.cy, before: store.snapshot(), moved: false };
    } else {
      const room = target.closest('[data-room]') as HTMLElement | null;
      dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, x0: viewRef.current.x0, y0: viewRef.current.y0, room: room?.dataset.room ?? null, moved: false };
    }
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: ReactPointerEvent<SVGSVGElement>) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchRef.current) {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const svg = svgRef.current!;
      const r = svg.getBoundingClientRect();
      const c: [number, number] = [((a.x + b.x) / 2) - r.left, ((a.y + b.y) / 2) - r.top];
      const d = Math.max(1, Math.hypot(b.x - a.x, b.y - a.y));
      const ns = Math.max(0.012, Math.min(2, pinchRef.current.s * d / pinchRef.current.d));
      viewRef.current = { s: ns, x0: pinchRef.current.px - c[0] / ns, y0: pinchRef.current.py - c[1] / ns };
      applyView();
      return;
    }

    const p = toMM(e.clientX, e.clientY);
    if (coordRef.current) coordRef.current.textContent = `X ${Math.round(p[0])} · Y ${Math.round(p[1])} mm`;
    const d = dragRef.current;
    if (!d) {
      if (tool === 'measure' && measure.a) {
        setMeasure((m) => ({ ...m, cur: snapPoint(p, e.shiftKey, m.a, snapRects(state.demolished), viewRef.current.s) }));
      }
      return;
    }

    const far = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= TAP;
    if (d.kind === 'measure') {
      if (far) d.moved = true;
      setMeasure((m) => ({ ...m, cur: snapPoint(p, e.shiftKey, m.a, snapRects(state.demolished), viewRef.current.s) }));
      return;
    }
    if (d.kind === 'pan') {
      if (!d.moved && !far) return;
      d.moved = true;
      svgRef.current?.classList.add('panning');
      viewRef.current = { ...viewRef.current, x0: d.x0 - (e.clientX - d.sx) / viewRef.current.s, y0: d.y0 - (e.clientY - d.sy) / viewRef.current.s };
      applyView();
      return;
    }

    const f = state.furniture.find((x) => x.id === d.id);
    if (!f) return;
    if (!d.moved && !far) return;
    d.moved = true;

    if (d.kind === 'move') {
      const [cx, cy] = snapMove(f, p[0] - d.ox, p[1] - d.oy, snapRects(state.demolished), layers.wallSnap, viewRef.current.s);
      store.applyTransient(() => { f.cx = cx; f.cy = cy; });
    } else if (d.kind === 'rot') {
      const a = Math.atan2(p[1] - f.cy, p[0] - f.cx) * 180 / Math.PI + 90;
      store.applyTransient(() => { f.rot = normAngle(e.shiftKey ? a : Math.round(a / 15) * 15); });
    } else if (d.kind === 'size') {
      const a = f.rot * Math.PI / 180;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const dx = p[0] - f.cx;
      const dy = p[1] - f.cy;
      const lx = dx * c + dy * s;
      const ly = -dx * s + dy * c;
      const ax = -f.w / 2;
      const ay = -f.d / 2;
      const nw = Math.max(100, Math.round((lx - ax) / 10) * 10);
      const nd = Math.max(100, Math.round((ly - ay) / 10) * 10);
      const mx = ax + nw / 2;
      const my = ay + nd / 2;
      store.applyTransient(() => {
        f.cx += mx * c - my * s;
        f.cy += mx * s + my * c;
        f.w = nw;
        f.d = nd;
      });
    }
  };

  const onPointerEnd = (e: ReactPointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pinchRef.current) {
      if (pointers.current.size < 2) pinchRef.current = null;
      return;
    }
    endDrag(e.type === 'pointercancel');
  };

  const onDblClick = (e: ReactMouseEvent) => {
    if (tool !== 'select' || !selection || selection.kind !== 'furn') return;
    const target = e.target as Element;
    if (target.closest('[data-fid]')) {
      store.mutate(() => {
        const f = state.furniture.find((x) => x.id === selection.id);
        if (f) f.rot = normAngle(f.rot + 90);
      });
    }
  };

  const { s } = viewRef.current;
  const ratio = 1 / (s * PX_MM);
  const nice = [100, 200, 500, 1000, 2000, 5000].find((v) => v * s >= 60) ?? 5000;

  return (
    <div className="plan-wrap" ref={wrapRef}>
      <svg
        ref={svgRef}
        id="plan"
        className={`tool-${tool}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onDoubleClick={onDblClick}
        onContextMenu={(e) => { if (tool === 'measure') { e.preventDefault(); setMeasure({ a: null, cur: null }); } }}
        style={{ touchAction: 'none' }}
      >
        <defs dangerouslySetInnerHTML={{ __html: buildDefs() }} />

        <g>
          <rect x={-20000} y={-20000} width={55000} height={55000} fill={layers.grid ? 'url(#grid)' : '#f7f4ee'} />
        </g>

        <g>
          {plan.rooms.map((r) => (
            <polygon
              key={r.id}
              className="room"
              data-room={r.id}
              points={r.poly.map((p) => p.join(',')).join(' ')}
              fill={`url(#m-${state.rooms[r.id]?.mat ?? r.mat})`}
            />
          ))}
          {[...plan.doors.map((d) => d.rect), ...plan.slides.map((d) => d.rect)].map((rect, i) => (
            <rect key={'sill' + i} x={rect[0]} y={rect[1]} width={rect[2] - rect[0]} height={rect[3] - rect[1]} fill="#e2dacb" stroke="#b9b0a0" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
          ))}
        </g>

        <g display={layers.furn ? 'inline' : 'none'}>
          {state.furniture.map((f) => {
            const fs = Math.max(80, Math.min(170, Math.min(f.w, f.d) * 0.2));
            const noLabel = ['plant', 'floorlamp', 'sidetable', 'barstool', 'beanbag'];
            const label = Math.min(f.w, f.d) >= 380 && !noLabel.includes(f.type);
            return (
              <g key={f.id} className="furn" data-fid={f.id} transform={`translate(${f.cx} ${f.cy}) rotate(${f.rot})`}>
                <g dangerouslySetInnerHTML={{ __html: furnitureSvg(f.type, f.w, f.d, f.color) }} />
                {label && (
                  <text transform={`rotate(${-f.rot})`} fontSize={fs} textAnchor="middle" dominantBaseline="central" fill="#4a443c" opacity={0.8} pointerEvents="none">
                    {i18n.nm(f.name)}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        <g>
          {plan.walls.map((w, i) => {
            const id = 'w' + i;
            const dem = state.demolished.includes(id);
            let fill = w.kind === 'b' ? (layers.bearing ? '#b8412c' : '#26241f') : w.kind === 'low' ? '#e9e3d8' : w.kind === 'e' ? '#8f897d' : '#a7a195';
            let extra: SVGProps<SVGRectElement> = {};
            if (dem) {
              fill = 'rgba(198,91,58,.12)';
              extra = { stroke: '#c65b3a', strokeWidth: 1.2, strokeDasharray: '5 3', vectorEffect: 'non-scaling-stroke' };
            } else if (w.kind === 'low') {
              extra = { stroke: '#8f897d', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' };
            }
            return (
              <rect
                key={id}
                className="wall"
                data-wall={id}
                x={w.x0}
                y={w.y0}
                width={w.x1 - w.x0}
                height={w.y1 - w.y0}
                fill={fill}
                pointerEvents={tool === 'demolish' ? 'all' : 'none'}
                {...extra}
              />
            );
          })}
        </g>

        <g>
          {plan.windows.map((w, i) => {
            const width = w.x1 - w.x0;
            const height = w.y1 - w.y0;
            const WS = 'stroke="#4f7394" stroke-width="1" vector-effect="non-scaling-stroke"';
            return (
              <g key={'win' + i}>
                <rect x={w.x0} y={w.y0} width={width} height={height} fill="#f7fbfd" stroke="#4f7394" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {width >= height
                  ? [1 / 3, 2 / 3].map((t) => <line key={t} x1={w.x0} y1={w.y0 + height * t} x2={w.x1} y2={w.y0 + height * t} {...{ stroke: '#4f7394', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />)
                  : [1 / 3, 2 / 3].map((t) => <line key={t} x1={w.x0 + width * t} y1={w.y0} x2={w.x0 + width * t} y2={w.y1} {...{ stroke: '#4f7394', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }} />)}
              </g>
            );
          })}

          {plan.doors.map((d) => {
            const [hx, hy] = d.hinge;
            const L = d.len;
            const T = 40;
            const ox = hx + d.openDir[0] * L;
            const oy = hy + d.openDir[1] * L;
            const cx = hx + d.closedDir[0] * L;
            const cy = hy + d.closedDir[1] * L;
            const sweep = d.openDir[0] * d.closedDir[1] - d.openDir[1] * d.closedDir[0] > 0 ? 1 : 0;
            const col = d.entry ? '#b5653a' : '#3d3a34';
            return (
              <g key={d.name} pointerEvents="none">
                <polygon points={`${hx},${hy} ${ox},${oy} ${ox + d.closedDir[0] * T},${oy + d.closedDir[1] * T} ${hx + d.closedDir[0] * T},${hy + d.closedDir[1] * T}`} fill="#fff" stroke={col} strokeWidth={d.entry ? 1.8 : 1} vectorEffect="non-scaling-stroke" />
                <path d={`M${ox} ${oy}A${L} ${L} 0 0 ${sweep} ${cx} ${cy}`} fill="none" stroke="#3d3a34" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="5 3" opacity={0.7} />
              </g>
            );
          })}

          {plan.slides.map(({ rect: [x0, y0, x1, y1], vertical }, i) => {
            const DS = { stroke: '#3d3a34', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };
            if (vertical) {
              const L = y1 - y0;
              const m = (x0 + x1) / 2;
              return (
                <g key={'slide' + i} pointerEvents="none">
                  <rect x={m - 45} y={y0} width={40} height={L * 0.55} fill="#fff" {...DS} />
                  <rect x={m + 5} y={y1 - L * 0.55} width={40} height={L * 0.55} fill="#fff" {...DS} />
                </g>
              );
            }
            const L = x1 - x0;
            const m = (y0 + y1) / 2;
            return (
              <g key={'slide' + i} pointerEvents="none">
                <rect x={x0} y={m - 45} width={L * 0.55} height={40} fill="#fff" {...DS} />
                <rect x={x1 - L * 0.55} y={m + 5} width={L * 0.55} height={40} fill="#fff" {...DS} />
              </g>
            );
          })}

          {(() => {
            const entry = plan.doors.find((d) => d.entry);
            if (!entry) return null;
            const cy = (entry.rect[1] + entry.rect[3]) / 2;
            const x1 = entry.rect[0] - 170;
            const x0 = x1 - 1000;
            return (
              <g pointerEvents="none">
                <path d={`M${x0} ${cy}H${x1}M${x1 - 250} ${cy - 155}L${x1} ${cy}L${x1 - 250} ${cy + 155}`} fill="none" stroke="#b5653a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <text x={x0 + 30} y={cy - 155} fontSize={200} fill="#b5653a">{i18n.t('入户', 'Entry')}</text>
              </g>
            );
          })()}
        </g>

        <g display={layers.labels ? 'inline' : 'none'}>
          {plan.rooms.filter((r) => r.labelAt).map((r) => {
            const [x, y] = r.labelAt!;
            const halo = { stroke: '#fbf9f4', strokeWidth: 45, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };
            return (
              <g key={r.id} pointerEvents="none">
                <text x={x} y={y} fontSize={250} fontWeight={600} textAnchor="middle" fill="#2b2824" {...halo}>{i18n.nm(state.rooms[r.id]?.name ?? r.name)}</text>
                <text x={x} y={y + 260} fontSize={175} textAnchor="middle" fill="#7d7366" {...halo}>{fmt(areaOf(r.poly))} m²</text>
              </g>
            );
          })}
        </g>

        <g display={layers.dims ? 'inline' : 'none'} pointerEvents="none" dangerouslySetInnerHTML={{ __html: dimChains() }} />

        <g pointerEvents="none">
          {[...state.measures.map((m) => ({ a: m.a, b: m.b, tmp: false })), ...(measure.a && measure.cur ? [{ a: { x: measure.a[0], y: measure.a[1] }, b: { x: measure.cur[0], y: measure.cur[1] }, tmp: true }] : [])].map((m, i) => {
            const k = 1 / s;
            const fs = 12 * k;
            const L = Math.hypot(m.b.x - m.a.x, m.b.y - m.a.y);
            if (L < 1) return null;
            let ang = Math.atan2(m.b.y - m.a.y, m.b.x - m.a.x) * 180 / Math.PI;
            if (ang > 90 || ang < -90) ang += 180;
            const mx = (m.a.x + m.b.x) / 2;
            const my = (m.a.y + m.b.y) / 2;
            const nx = -(m.b.y - m.a.y) / L * 5 * k;
            const ny = (m.b.x - m.a.x) / L * 5 * k;
            const col = m.tmp ? '#2f5d62' : '#b5653a';
            return (
              <g key={i}>
                <line x1={m.a.x} y1={m.a.y} x2={m.b.x} y2={m.b.y} stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <line x1={m.a.x - nx} y1={m.a.y - ny} x2={m.a.x + nx} y2={m.a.y + ny} stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <line x1={m.b.x - nx} y1={m.b.y - ny} x2={m.b.x + nx} y2={m.b.y + ny} stroke={col} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <text x={mx} y={my - 5 * k} fontSize={fs} textAnchor="middle" fill={col} fontWeight={600} transform={`rotate(${ang} ${mx} ${my})`} stroke="#fff" strokeWidth={3.5 * k} paintOrder="stroke">
                  {Math.round(L)} mm
                </text>
              </g>
            );
          })}
          {measure.a && <circle cx={measure.a[0]} cy={measure.a[1]} r={3 / s} fill="#2f5d62" />}
        </g>

        <g>
          {selection?.kind === 'furn' && (() => {
            const f = state.furniture.find((x) => x.id === selection.id);
            if (!f) return null;
            const k = 1 / s;
            const p = 5 * k;
            const hs = COARSE ? 1.7 : 1;
            const ro = (COARSE ? 40 : 26) * k;
            const hit = (COARSE ? 24 : 11) * k;
            const sx = f.w / 2 + p;
            const sy = f.d / 2 + p;
            const A = { stroke: '#b5653a', vectorEffect: 'non-scaling-stroke' as const };
            const hh = Math.abs(f.w / 2 * Math.sin(f.rot * Math.PI / 180)) + Math.abs(f.d / 2 * Math.cos(f.rot * Math.PI / 180));
            return (
              <g>
                <g transform={`translate(${f.cx} ${f.cy}) rotate(${f.rot})`}>
                  <rect x={-f.w / 2 - p} y={-f.d / 2 - p} width={f.w + 2 * p} height={f.d + 2 * p} fill="none" {...A} strokeWidth={1.5} strokeDasharray="5 3" pointerEvents="none" />
                  <line x1={0} y1={-f.d / 2 - p} x2={0} y2={-f.d / 2 - ro} {...A} strokeWidth={1} pointerEvents="none" />
                  <circle data-handle="rot" cx={0} cy={-f.d / 2 - ro} r={hit} fill="transparent" />
                  <circle data-handle="rot" cx={0} cy={-f.d / 2 - ro} r={6 * hs * k} fill="#fff" {...A} strokeWidth={1.5}>
                    <title>{i18n.t('拖动旋转（Shift 自由角度）', 'Drag to rotate (Shift for free angle)')}</title>
                  </circle>
                  <circle data-handle="size" cx={sx} cy={sy} r={hit} fill="transparent" />
                  <rect data-handle="size" x={sx - 5 * hs * k} y={sy - 5 * hs * k} width={10 * hs * k} height={10 * hs * k} fill="#b5653a">
                    <title>{i18n.t('拖动调整尺寸', 'Drag to resize')}</title>
                  </rect>
                </g>
                <text x={f.cx} y={f.cy + hh + 24 * k} fontSize={12 * k} textAnchor="middle" fill="#b5653a" fontWeight={600} pointerEvents="none" stroke="#fff" strokeWidth={3 * k} paintOrder="stroke">
                  {f.w} × {f.d}
                </text>
              </g>
            );
          })()}
          {selection?.kind === 'room' && (() => {
            const r = roomById(selection.id);
            if (!r) return null;
            return <polygon points={r.poly.map((p) => p.join(',')).join(' ')} fill="rgba(181,101,58,.08)" stroke="#b5653a" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
          })()}
        </g>
      </svg>

      <div className="scalebar">
        <div>{i18n.t('比例 1:', 'Scale 1:')}{Math.round(ratio)}</div>
        <div className="bar" style={{ width: Math.max(20, nice * s) }} />
        <div>{nice >= 1000 ? `${nice / 1000} m` : `${nice} mm`}</div>
      </div>
      <div className="coords">
        <span ref={coordRef}>mm</span>
      </div>
    </div>
  );
}
