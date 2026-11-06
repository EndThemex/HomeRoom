import { useCallback, useEffect, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { MouseEvent as ReactMouseEvent, MutableRefObject, PointerEvent as ReactPointerEvent, SVGProps } from 'react';
import type { DimensionChains, Layers, OpeningData, Point, Selection, Tool, ViewTransform, WallLine } from '../types';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { areaOf, fmt, normAngle, PX_MM } from '../lib/geometry';
import { plan } from '../lib/plan';
import { segmentsOf, wallRectsOf } from '../lib/layoutOps';
import { doorRender, openingRect } from '../lib/openings';
import { pushOut, snapMove, snapPoint } from '../lib/snap';
import { furnitureSvg } from './furnitureSvg';
import type { StageApi } from '../lib/stageApi';
import { useEditSession } from './editor/useEditSession';

interface Props {
  store: DesignStore;
  viewRef: MutableRefObject<ViewTransform>;
  tool: Tool;
  selection: Selection | null;
  layers: Layers;
  i18n: I18n;
  stageApiRef: MutableRefObject<StageApi | null>;
  onSelect: (sel: Selection | null) => void;
  onMeasure: (a: Point, b: Point) => void;
  onToast: (msg: string) => void;
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

function dimChains(chains: DimensionChains | null): string {
  if (!chains) return '';
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
  return chains.horizontal.map((c) => chain(true, c.at, c.start, c.segs)).join('')
    + chains.vertical.map((c) => chain(false, c.at, c.start, c.segs)).join('');
}

const wallFill = (kind: WallLine['kind'], bearing: boolean) => (
  kind === 'b' ? (bearing ? '#b8412c' : '#26241f')
    : kind === 'low' ? '#e9e3d8'
      : kind === 'e' ? '#8f897d'
        : '#a7a195'
);

export function Plan2D(props: Props) {
  const { store, viewRef, tool, selection, layers, i18n, stageApiRef, onSelect, onMeasure, onToast } = props;
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const { layout, demolishedLines } = state;
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
    const b = store.getState().layout.bounds;
    const s = Math.min(w / b.w, h / b.h);
    viewRef.current = { s, x0: b.x - (w / s - b.w) / 2, y0: b.y - (h / s - b.h) / 2 };
    applyView();
  }, [applyView, store, viewRef]);

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

  const edit = useEditSession({
    store, viewRef, tool, selection, layers, i18n, onSelect, onToast, toMM,
  });

  /** 家具 / 测量吸附矩形：墙块 + 全部洞口（洞口处也视为实体） */
  const snapRects = useCallback(() => {
    const doc = store.getState().layout;
    const demo = store.getState().demolishedLines;
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = wallRectsOf(doc, demo).map((w) => ({
      x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1,
    }));
    doc.openings.forEach((o) => {
      if (demo.includes(o.lineId)) return;
      const line = doc.lines.find((l) => l.id === o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      rects.push({ x0, y0, x1, y1 });
    });
    return rects;
  }, [store]);

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
      cancelEdit: edit.cancel,
    };
    return () => { stageApiRef.current = null; };
  }, [applyView, edit.cancel, fitView, zoomCenter, stageApiRef, toMM, viewRef]);

  // 工具切换时清空测量临时点
  useEffect(() => { setMeasure({ a: null, cur: null }); }, [tool]);

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
        edit.cancel();
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

    // 测量工具保持原有独立逻辑
    if (tool === 'measure') {
      const q = snapPoint(p, e.shiftKey, measure.a, snapRects(), viewRef.current.s);
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
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (tool === 'select' && target.closest('[data-fid]')) {
      const fid = (target.closest('[data-fid]') as HTMLElement).dataset.fid!;
      if (selection?.id !== fid) onSelect({ kind: 'furn', id: fid });
      const f = state.furniture.find((x) => x.id === fid)!;
      dragRef.current = { kind: 'move', id: fid, sx: e.clientX, sy: e.clientY, ox: p[0] - f.cx, oy: p[1] - f.cy, before: store.snapshot(), moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    // 墙体 / 门窗 / 新建工具交给编辑器会话
    if (edit.pointerDown(e.clientX, e.clientY, e.altKey)) {
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }

    const room = target.closest('[data-room]') as HTMLElement | null;
    dragRef.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, x0: viewRef.current.x0, y0: viewRef.current.y0, room: room?.dataset.room ?? null, moved: false };
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

    if (edit.pointerMove(e.clientX, e.clientY, e.altKey)) return;

    const d = dragRef.current;
    if (!d) {
      if (tool === 'measure' && measure.a) {
        setMeasure((m) => ({ ...m, cur: snapPoint(p, e.shiftKey, m.a, snapRects(), viewRef.current.s) }));
      }
      return;
    }

    const far = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) >= TAP;
    if (d.kind === 'measure') {
      if (far) d.moved = true;
      setMeasure((m) => ({ ...m, cur: snapPoint(p, e.shiftKey, m.a, snapRects(), viewRef.current.s) }));
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
      const [cx, cy] = snapMove(f, p[0] - d.ox, p[1] - d.oy, snapRects(), layers.wallSnap, viewRef.current.s);
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
    if (edit.pointerUp()) {
      dragRef.current = null;
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

  const walls = wallRectsOf(layout, demolishedLines);
  const demLines = layout.lines.filter((l) => demolishedLines.includes(l.id));
  const openingLine = (o: OpeningData) => layout.lines.find((l) => l.id === o.lineId) ?? null;
  const liveOpenings = layout.openings.filter((o) => !demolishedLines.includes(o.lineId));
  const entryDoor = liveOpenings.find((o) => o.kind === 'door' && o.entry);
  const selLine = selection?.kind === 'wall' ? layout.lines.find((l) => l.id === selection.id) : null;
  const selOpening = selection && (selection.kind === 'door' || selection.kind === 'window' || selection.kind === 'slide')
    ? layout.openings.find((o) => o.id === selection.id) : null;
  const k = 1 / viewRef.current.s;
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
          {layout.rooms.map((r) => (
            <polygon
              key={r.id}
              className="room"
              data-room={r.id}
              points={r.poly.map((p) => p.join(',')).join(' ')}
              fill={`url(#m-${r.mat})`}
            />
          ))}
          {liveOpenings.filter((o) => o.kind !== 'window').map((o) => {
            const line = openingLine(o);
            if (!line) return null;
            const rect = openingRect(line, o);
            return (
              <rect key={'sill' + o.id} x={rect[0]} y={rect[1]} width={rect[2] - rect[0]} height={rect[3] - rect[1]} fill="#e2dacb" stroke="#b9b0a0" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
            );
          })}
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

        {layers.walls && (
          <g>
            {walls.map((w) => {
              const extra: SVGProps<SVGRectElement> = w.kind === 'low'
                ? { stroke: '#8f897d', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' }
                : {};
              return (
                <rect
                  key={w.id}
                  className="wall"
                  data-wall={w.lineId}
                  x={w.x0}
                  y={w.y0}
                  width={w.x1 - w.x0}
                  height={w.y1 - w.y0}
                  fill={wallFill(w.kind as WallLine['kind'], layers.bearing)}
                  {...extra}
                />
              );
            })}
            {demLines.flatMap((line) => segmentsOf(line, layout.openings)).map((w) => (
              <rect
                key={'dem' + w.id}
                x={w.x0}
                y={w.y0}
                width={w.x1 - w.x0}
                height={w.y1 - w.y0}
                fill="rgba(198,91,58,.12)"
                stroke="#c65b3a"
                strokeWidth={1.2}
                strokeDasharray="5 3"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {selLine && segmentsOf(selLine, layout.openings).map((w) => (
              <rect
                key={'sel' + w.id}
                x={w.x0}
                y={w.y0}
                width={w.x1 - w.x0}
                height={w.y1 - w.y0}
                fill="rgba(181,101,58,.35)"
                stroke="#b5653a"
                strokeWidth={1.5}
                vectorEffect="non-scaling-stroke"
                pointerEvents="none"
              />
            ))}
          </g>
        )}

        <g display={layers.openings ? 'inline' : 'none'}>
          {liveOpenings.filter((o) => o.kind === 'window').map((o) => {
            const line = openingLine(o);
            if (!line) return null;
            const [x0, y0, x1, y1] = openingRect(line, o);
            const width = x1 - x0;
            const height = y1 - y0;
            return (
              <g key={'win' + o.id}>
                <rect x={x0} y={y0} width={width} height={height} fill="#f7fbfd" stroke="#4f7394" strokeWidth={1} vectorEffect="non-scaling-stroke" pointerEvents="none" />
                {width >= height
                  ? [1 / 3, 2 / 3].map((t) => <line key={t} x1={x0} y1={y0 + height * t} x2={x1} y2={y0 + height * t} stroke="#4f7394" strokeWidth={1} vectorEffect="non-scaling-stroke" />)
                  : [1 / 3, 2 / 3].map((t) => <line key={t} x1={x0 + width * t} y1={y0} x2={x0 + width * t} y2={y1} stroke="#4f7394" strokeWidth={1} vectorEffect="non-scaling-stroke" />)}
              </g>
            );
          })}

          {liveOpenings.filter((o) => o.kind === 'door').map((o) => {
            const line = openingLine(o);
            if (!line) return null;
            const d = doorRender(line, o);
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
              <g key={o.id} pointerEvents="none">
                <polygon points={`${hx},${hy} ${ox},${oy} ${ox + d.closedDir[0] * T},${oy + d.closedDir[1] * T} ${hx + d.closedDir[0] * T},${hy + d.closedDir[1] * T}`} fill="#fff" stroke={col} strokeWidth={d.entry ? 1.8 : 1} vectorEffect="non-scaling-stroke" />
                <path d={`M${ox} ${oy}A${L} ${L} 0 0 ${sweep} ${cx} ${cy}`} fill="none" stroke="#3d3a34" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="5 3" opacity={0.7} />
              </g>
            );
          })}

          {liveOpenings.filter((o) => o.kind === 'slide').map((o) => {
            const line = openingLine(o);
            if (!line) return null;
            const [x0, y0, x1, y1] = openingRect(line, o);
            const vertical = line.axis === 'v';
            const dir = o.swing ?? 1;
            const DS = { stroke: '#3d3a34', strokeWidth: 1, vectorEffect: 'non-scaling-stroke' as const };
            if (vertical) {
              const L = y1 - y0;
              const m = (x0 + x1) / 2;
              return (
                <g key={o.id} pointerEvents="none">
                  <rect x={m - 45} y={y0} width={40} height={L * 0.55} fill="#fff" {...DS} />
                  <rect x={m + 5} y={y1 - L * 0.55} width={40} height={L * 0.55} fill="#fff" {...DS} />
                </g>
              );
            }
            const L = x1 - x0;
            const m = (y0 + y1) / 2;
            return (
              <g key={o.id} pointerEvents="none">
                <rect x={x0} y={m - 45} width={L * 0.55} height={40} fill="#fff" {...DS} />
                <rect x={x1 - L * 0.55} y={m + 5} width={L * 0.55} height={40} fill="#fff" {...DS} />
              </g>
            );
          })}

          {entryDoor && (() => {
            const line = openingLine(entryDoor);
            if (!line) return null;
            const d = doorRender(line, entryDoor);
            const mid = [d.hinge[0] + d.closedDir[0] * d.len / 2, d.hinge[1] + d.closedDir[1] * d.len / 2];
            const half = (line.band[1] - line.band[0]) / 2;
            const out = [mid[0] + d.openDir[0] * (half + 900), mid[1] + d.openDir[1] * (half + 900)];
            const x1 = out[0] - d.openDir[0] * 300;
            const y1 = out[1] - d.openDir[1] * 300;
            return (
              <g pointerEvents="none">
                <path d={`M${out[0]} ${out[1]}L${x1} ${y1}`} fill="none" stroke="#b5653a" strokeWidth={2} vectorEffect="non-scaling-stroke" />
                <text x={out[0] + 30} y={out[1] - 150} fontSize={200} fill="#b5653a">{i18n.t('入户', 'Entry')}</text>
              </g>
            );
          })()}
        </g>

        <g display={layers.labels ? 'inline' : 'none'}>
          {layout.rooms.filter((r) => r.labelAt).map((r) => {
            const [x, y] = r.labelAt!;
            const halo = { stroke: '#fbf9f4', strokeWidth: 45, paintOrder: 'stroke' as const, strokeLinejoin: 'round' as const };
            return (
              <g key={r.id} pointerEvents="none">
                <text x={x} y={y} fontSize={250} fontWeight={600} textAnchor="middle" fill="#2b2824" {...halo}>{i18n.rn(r)}</text>
                <text x={x} y={y + 260} fontSize={175} textAnchor="middle" fill="#7d7366" {...halo}>{fmt(areaOf(r.poly))} m²</text>
              </g>
            );
          })}
        </g>

        <g display={layers.dims ? 'inline' : 'none'} pointerEvents="none" dangerouslySetInnerHTML={{ __html: dimChains(layout.dimensionChains) }} />

        <g pointerEvents="none">
          {[...state.measures.map((m) => ({ a: m.a, b: m.b, tmp: false })), ...(measure.a && measure.cur ? [{ a: { x: measure.a[0], y: measure.a[1] }, b: { x: measure.cur[0], y: measure.cur[1] }, tmp: true }] : [])].map((m, i) => {
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

        <g pointerEvents="none">
          {edit.preview?.kind === 'wall' && (
            <g>
              <rect
                x={edit.preview.rect[0]}
                y={edit.preview.rect[1]}
                width={edit.preview.rect[2] - edit.preview.rect[0]}
                height={edit.preview.rect[3] - edit.preview.rect[1]}
                fill="rgba(47,93,98,.28)"
                stroke="#2f5d62"
                strokeWidth={1.5}
                strokeDasharray="6 4"
                vectorEffect="non-scaling-stroke"
              />
              {edit.preview.len >= 10 && (
                <text
                  x={(edit.preview.rect[0] + edit.preview.rect[2]) / 2}
                  y={(edit.preview.rect[1] + edit.preview.rect[3]) / 2 - 8 * k}
                  fontSize={12 * k}
                  textAnchor="middle"
                  fill="#2f5d62"
                  fontWeight={600}
                  stroke="#fff"
                  strokeWidth={3 * k}
                  paintOrder="stroke"
                >
                  {Math.round(edit.preview.len)} mm
                </text>
              )}
            </g>
          )}
          {edit.preview?.kind === 'room' && (
            <rect
              x={edit.preview.rect[0]}
              y={edit.preview.rect[1]}
              width={edit.preview.rect[2] - edit.preview.rect[0]}
              height={edit.preview.rect[3] - edit.preview.rect[1]}
              fill="rgba(47,93,98,.16)"
              stroke="#2f5d62"
              strokeWidth={1.5}
              strokeDasharray="6 4"
              vectorEffect="non-scaling-stroke"
            />
          )}
          {edit.preview?.kind === 'opening' && (
            <rect
              x={edit.preview.rect[0]}
              y={edit.preview.rect[1]}
              width={edit.preview.rect[2] - edit.preview.rect[0]}
              height={edit.preview.rect[3] - edit.preview.rect[1]}
              fill="rgba(181,101,58,.25)"
              stroke="#b5653a"
              strokeWidth={1.5}
              strokeDasharray="5 3"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>

        <g>
          {selection?.kind === 'furn' && (() => {
            const f = state.furniture.find((x) => x.id === selection.id);
            if (!f) return null;
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
            const r = layout.rooms.find((x) => x.id === selection.id);
            if (!r) return null;
            return <polygon points={r.poly.map((p) => p.join(',')).join(' ')} fill="rgba(181,101,58,.08)" stroke="#b5653a" strokeWidth={2} vectorEffect="non-scaling-stroke" pointerEvents="none" />;
          })()}
          {selLine && (() => {
            const center = (selLine.band[0] + selLine.band[1]) / 2;
            const mid = (selLine.span[0] + selLine.span[1]) / 2;
            const A = { stroke: '#b5653a', vectorEffect: 'non-scaling-stroke' as const };
            const hit = (COARSE ? 24 : 12) * k;
            const ends: Point[] = selLine.axis === 'h'
              ? [[selLine.span[0], center], [selLine.span[1], center]]
              : [[center, selLine.span[0]], [center, selLine.span[1]]];
            const thick: Point = selLine.axis === 'h' ? [mid, selLine.band[0]] : [selLine.band[0], mid];
            return (
              <g>
                {ends.map((p, i) => (
                  <g key={i}>
                    <circle cx={p[0]} cy={p[1]} r={hit} fill="transparent" />
                    <rect x={p[0] - 5 * k} y={p[1] - 5 * k} width={10 * k} height={10 * k} fill="#fff" {...A} strokeWidth={1.5} />
                  </g>
                ))}
                <g>
                  <circle cx={thick[0]} cy={thick[1]} r={hit} fill="transparent" />
                  <rect x={thick[0] - 4 * k} y={thick[1] - 4 * k} width={8 * k} height={8 * k} fill="#2f5d62" />
                </g>
                <text
                  x={mid}
                  y={center - 28 * k}
                  fontSize={12 * k}
                  textAnchor="middle"
                  fill="#b5653a"
                  fontWeight={600}
                  stroke="#fff"
                  strokeWidth={3 * k}
                  paintOrder="stroke"
                >
                  {Math.round(selLine.span[1] - selLine.span[0])} mm · {Math.round(selLine.band[1] - selLine.band[0])} mm
                </text>
              </g>
            );
          })()}
          {selOpening && (() => {
            const line = openingLine(selOpening);
            if (!line) return null;
            const rect = openingRect(line, selOpening);
            const center = (line.band[0] + line.band[1]) / 2;
            const ends: Point[] = line.axis === 'h'
              ? [[selOpening.span[0], center], [selOpening.span[1], center]]
              : [[center, selOpening.span[0]], [center, selOpening.span[1]]];
            const A = { stroke: '#b5653a', vectorEffect: 'non-scaling-stroke' as const };
            const hit = (COARSE ? 24 : 12) * k;
            return (
              <g>
                <rect x={rect[0]} y={rect[1]} width={rect[2] - rect[0]} height={rect[3] - rect[1]} fill="rgba(181,101,58,.18)" {...A} strokeWidth={1.5} pointerEvents="none" />
                {ends.map((p, i) => (
                  <g key={i}>
                    <circle cx={p[0]} cy={p[1]} r={hit} fill="transparent" />
                    <rect x={p[0] - 5 * k} y={p[1] - 5 * k} width={10 * k} height={10 * k} fill="#fff" {...A} strokeWidth={1.5} />
                  </g>
                ))}
                <text
                  x={(rect[0] + rect[2]) / 2}
                  y={(rect[1] + rect[3]) / 2 - 28 * k}
                  fontSize={12 * k}
                  textAnchor="middle"
                  fill="#b5653a"
                  fontWeight={600}
                  stroke="#fff"
                  strokeWidth={3 * k}
                  paintOrder="stroke"
                >
                  {Math.round(selOpening.span[1] - selOpening.span[0])} mm
                </text>
              </g>
            );
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
