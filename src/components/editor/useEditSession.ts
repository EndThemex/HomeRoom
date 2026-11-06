import { useCallback, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import type {
  Layers, OpeningKind, PlanDoc, Point, Selection, Tool, ViewTransform, WallLine,
} from '../../types';
import type { DesignStore } from '../../lib/store';
import type { I18n } from '../../lib/i18n';
import { DEFAULTS } from '../../lib/planDoc';
import {
  createRectRoom, createWallLine, lineById, moveWallLine, resizeWallLine,
  setLineThickness,
} from '../../lib/layoutOps';
import {
  defaultWidth, hostLine, insertOpening, moveOpening, openingRect,
  projectToLine, resizeOpening,
} from '../../lib/openings';
import { hitOpening, hitWallLine, snapOpeningCenter, snapWallPoint, type WallSnap } from '../../lib/snap';

type Rect = [number, number, number, number];

export type EditorPreview =
  | { kind: 'wall'; rect: Rect; len: number; snap: WallSnap | null }
  | { kind: 'room'; rect: Rect }
  | { kind: 'opening'; rect: Rect; span: [number, number]; openingKind: OpeningKind }
  | null;

type LinePart = 'body' | 'start' | 'end' | 'thickness';
type OpeningPart = 'body' | 'start' | 'end';

type Session =
  | { kind: 'idle' }
  | { kind: 'drawWall'; a: Point; b: Point; snap: WallSnap | null }
  | { kind: 'drawRoom'; a: Point; b: Point }
  | { kind: 'dragLine'; lineId: string; part: LinePart; before: string; last: Point; moved: boolean }
  | { kind: 'dragOpening'; id: string; part: OpeningPart; before: string; last: number; moved: boolean }
  | { kind: 'placeOpening'; openingKind: OpeningKind; lineId: string; center: number };

export interface EditorCtx {
  store: DesignStore;
  viewRef: MutableRefObject<ViewTransform>;
  tool: Tool;
  selection: Selection | null;
  layers: Layers;
  i18n: I18n;
  onSelect: (s: Selection | null) => void;
  onToast: (msg: string) => void;
  toMM: (clientX: number, clientY: number) => Point;
}

const COARSE = typeof window !== 'undefined' && matchMedia('(pointer:coarse)').matches;
const snap10 = (v: number) => Math.round(v / DEFAULTS.grid) * DEFAULTS.grid;

const rectOf = (line: WallLine, s0: number, s1: number): Rect => (line.axis === 'h'
  ? [Math.min(s0, s1), line.band[0], Math.max(s0, s1), line.band[1]]
  : [line.band[0], Math.min(s0, s1), line.band[1], Math.max(s0, s1)]);

function pointInPoly(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0]; const yi = poly[i][1];
    const xj = poly[j][0]; const yj = poly[j][1];
    if (((yi > p[1]) !== (yj > p[1])) && (p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}

export function useEditSession(ctx: EditorCtx) {
  const ctxRef = useRef(ctx);
  ctxRef.current = ctx;
  const previewRef = useRef<EditorPreview>(null);
  const sessionRef = useRef<Session>({ kind: 'idle' });
  const [preview, setPreview] = useState<EditorPreview>(null);

  const setPrev = (p: EditorPreview) => {
    previewRef.current = p;
    setPreview(p);
  };

  const scale = () => Math.max(ctxRef.current.viewRef.current.s, 0.015);
  const radius = () => (COARSE ? 24 : 11) / scale();

  const handlesOf = (line: WallLine, p: Point): LinePart | null => {
    if (!line) return null;
    const r = radius();
    const c = (line.band[0] + line.band[1]) / 2;
    const starts: [LinePart, Point][] = line.axis === 'h'
      ? [['start', [line.span[0], c]], ['end', [line.span[1], c]], ['thickness', [(line.span[0] + line.span[1]) / 2, line.band[0]]]]
      : [['start', [c, line.span[0]]], ['end', [c, line.span[1]]], ['thickness', [line.band[0], (line.span[0] + line.span[1]) / 2]]];
    for (const [part, q] of starts) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= r) return part;
    }
    return null;
  };

  const openingHandles = (id: string, p: Point): OpeningPart | null => {
    const { layout } = ctxRef.current.store.getState();
    const o = layout.openings.find((x) => x.id === id);
    const line = o && lineById(layout, o.lineId);
    if (!o || !line) return null;
    const r = radius();
    const c = (line.band[0] + line.band[1]) / 2;
    const pts: [OpeningPart, Point][] = line.axis === 'h'
      ? [['start', [o.span[0], c]], ['end', [o.span[1], c]]]
      : [['start', [c, o.span[0]]], ['end', [c, o.span[1]]]];
    for (const [part, q] of pts) {
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) <= r) return part;
    }
    return null;
  };

  const previewOpening = (openingKind: OpeningKind, line: WallLine, center: number) => {
    const w = defaultWidth(openingKind);
    const span: [number, number] = [
      Math.max(line.span[0], Math.min(center - w / 2, line.span[1] - w)),
      Math.max(line.span[0] + w, Math.min(center + w / 2, line.span[1])),
    ];
    const s0 = Math.min(center - w / 2, line.span[1] - w);
    const s1 = Math.min(center + w / 2, line.span[1]);
    setPrev({ kind: 'opening', rect: rectOf(line, s0, s1), span, openingKind });
  };

  const pointerDown = useCallback((clientX: number, clientY: number, altKey: boolean): boolean => {
    const c = ctxRef.current;
    const { store, tool } = c;
    const { layout } = store.getState();
    const p = c.toMM(clientX, clientY);

    if (tool === 'wall') {
      const snap = snapWallPoint(p, scale(), layout, null, altKey);
      sessionRef.current = { kind: 'drawWall', a: snap.p, b: snap.p, snap: null };
      setPrev({ kind: 'wall', rect: [snap.p[0], snap.p[1], snap.p[0], snap.p[1]], len: 0, snap });
      return true;
    }
    if (tool === 'room') {
      const a: Point = [snap10(p[0]), snap10(p[1])];
      sessionRef.current = { kind: 'drawRoom', a, b: a };
      setPrev({ kind: 'room', rect: [a[0], a[1], a[0], a[1]] });
      return true;
    }
    if (tool === 'door' || tool === 'window' || tool === 'slide') {
      const line = hitWallLine(layout, p, scale());
      if (!line) {
        c.onToast(c.i18n.t('请点击墙体放置门窗', 'Click a wall to place an opening'));
        return true;
      }
      const center = snapOpeningCenter(p, line, scale());
      sessionRef.current = { kind: 'placeOpening', openingKind: tool, lineId: line.id, center };
      previewOpening(tool, line, center);
      return true;
    }
    if (tool === 'demolish') {
      const line = hitWallLine(layout, p, scale());
      if (!line) return false;
      const on = store.toggleDemolish(line.id);
      c.onToast(on
        ? c.i18n.t('已恢复该墙线', 'Wall line restored')
        : c.i18n.t('已拆改该墙线（可撤销）', 'Wall line demolished (undoable)'));
      return true;
    }
    if (tool === 'select') {
      const op = hitOpening(layout, p, scale());
      if (op) {
        const part = c.selection?.kind === op.kind && c.selection?.id === op.id ? openingHandles(op.id, p) : null;
        c.onSelect({ kind: op.kind, id: op.id });
        sessionRef.current = {
          kind: 'dragOpening',
          id: op.id,
          part: part ?? 'body',
          before: store.snapshot(),
          last: op.span[0],
          moved: false,
        };
        return true;
      }
      const line = hitWallLine(layout, p, scale());
      if (line) {
        const part = c.selection?.kind === 'wall' && c.selection.id === line.id ? handlesOf(line, p) : null;
        c.onSelect({ kind: 'wall', id: line.id });
        sessionRef.current = {
          kind: 'dragLine',
          lineId: line.id,
          part: part ?? 'body',
          before: store.snapshot(),
          last: p,
          moved: false,
        };
        return true;
      }
      // 点击房间地面：交给 Plan2D 的拖动逻辑，松手后选择房间
      return false;
    }
    return false;
  }, []);

  const pointerMove = useCallback((clientX: number, clientY: number, altKey: boolean): boolean => {
    const c = ctxRef.current;
    const { store } = c;
    const { layout } = store.getState();
    const p = c.toMM(clientX, clientY);
    const s = scale();
    const session = sessionRef.current;

    if (session.kind === 'idle') {
      if (c.tool === 'door' || c.tool === 'window' || c.tool === 'slide') {
        const line = hitWallLine(layout, p, s);
        if (line) previewOpening(c.tool, line, snapOpeningCenter(p, line, s));
        else setPrev(null);
      }
      return false;
    }

    if (session.kind === 'drawWall') {
      const axis = Math.abs(p[0] - session.a[0]) >= Math.abs(p[1] - session.a[1]) ? 'h' : 'v';
      const raw: Point = axis === 'h' ? [p[0], session.a[1]] : [session.a[0], p[1]];
      const snap = snapWallPoint(raw, s, layout, session.a, altKey);
      const b: Point = axis === 'h' ? [snap.p[0], session.a[1]] : [session.a[0], snap.p[1]];
      session.b = b;
      session.snap = snap;
      const t = DEFAULTS.wallThickness;
      const rect: Rect = axis === 'h'
        ? [Math.min(session.a[0], b[0]), session.a[1] - t / 2, Math.max(session.a[0], b[0]), session.a[1] + t / 2]
        : [session.a[0] - t / 2, Math.min(session.a[1], b[1]), session.a[0] + t / 2, Math.max(session.a[1], b[1])];
      setPrev({ kind: 'wall', rect, len: Math.abs(axis === 'h' ? b[0] - session.a[0] : b[1] - session.a[1]), snap });
      return true;
    }

    if (session.kind === 'drawRoom') {
      session.b = [snap10(p[0]), snap10(p[1])];
      const rect: Rect = [
        Math.min(session.a[0], session.b[0]),
        Math.min(session.a[1], session.b[1]),
        Math.max(session.a[0], session.b[0]),
        Math.max(session.a[1], session.b[1]),
      ];
      setPrev({ kind: 'room', rect });
      return true;
    }

    if (session.kind === 'placeOpening') {
      const line = lineById(layout, session.lineId);
      if (!line) return true;
      session.center = snapOpeningCenter(p, line, s);
      previewOpening(session.openingKind, line, session.center);
      return true;
    }

    if (session.kind === 'dragLine') {
      const line = lineById(layout, session.lineId);
      if (!line) return false;
      session.moved = true;
      if (session.part === 'body') {
        const dx = snap10(p[0] - session.last[0]);
        const dy = snap10(p[1] - session.last[1]);
        if (dx || dy) {
          store.applyTransientLayout((draft) => { moveWallLine(draft, session.lineId, dx, dy); });
          session.last = [session.last[0] + dx, session.last[1] + dy];
        }
      } else if (session.part === 'start' || session.part === 'end') {
        const coord = snap10(line.axis === 'h' ? p[0] : p[1]);
        store.applyTransientLayout((draft) => { resizeWallLine(draft, session.lineId, session.part as 'start' | 'end', coord); });
      } else {
        const center = (line.band[0] + line.band[1]) / 2;
        const coord = line.axis === 'h' ? p[1] : p[0];
        const raw = Math.max(DEFAULTS.grid, Math.abs(coord - center) * 2);
        const thickness = Math.round(raw / DEFAULTS.grid) * DEFAULTS.grid;
        store.applyTransientLayout((draft) => { setLineThickness(draft, session.lineId, thickness); });
      }
      setPrev(null);
      return true;
    }

    if (session.kind === 'dragOpening') {
      const o = layout.openings.find((x) => x.id === session.id);
      const line = o && lineById(layout, o.lineId);
      if (!o || !line) return false;
      session.moved = true;
      const coord = snap10(projectToLine(p, line));
      if (session.part === 'body') {
        const delta = coord - session.last;
        if (delta) {
          store.applyTransientLayout((draft) => { moveOpening(draft, session.id, delta); });
          session.last = coord;
        }
      } else {
        store.applyTransientLayout((draft) => { resizeOpening(draft, session.id, session.part as 'start' | 'end', coord); });
      }
      setPrev(null);
      return true;
    }

    return false;
  }, []);

  const pointerUp = useCallback((): boolean => {
    const c = ctxRef.current;
    const { store } = c;
    const session = sessionRef.current;
    sessionRef.current = { kind: 'idle' };
    setPrev(null);

    if (session.kind === 'drawWall') {
      const len = Math.abs(session.b[0] - session.a[0]) + Math.abs(session.b[1] - session.a[1]);
      if (len < DEFAULTS.minWall) {
        c.onToast(c.i18n.t(`墙体太短（最小 ${DEFAULTS.minWall}mm）`, `Wall too short (min ${DEFAULTS.minWall}mm)`));
        return true;
      }
      store.mutateLayout((layout) => { createWallLine(layout, session.a, session.b); });
      return true;
    }

    if (session.kind === 'drawRoom') {
      const w = Math.abs(session.b[0] - session.a[0]);
      const h = Math.abs(session.b[1] - session.a[1]);
      if (w < DEFAULTS.minWall || h < DEFAULTS.minWall) {
        c.onToast(c.i18n.t('房间尺寸过小', 'Room too small'));
        return true;
      }
      store.mutateLayout((layout) => { createRectRoom(layout, session.a, session.b); });
      return true;
    }

    if (session.kind === 'placeOpening') {
      let id: string | null = null;
      store.mutateLayout((layout) => {
        id = insertOpening(layout, session.lineId, session.openingKind, session.center);
      });
      if (id) {
        c.onSelect({ kind: session.openingKind, id });
      } else {
        c.onToast(c.i18n.t('该位置空间不足，无法放置', 'Not enough space for this opening'));
      }
      return true;
    }

    if (session.kind === 'dragLine' || session.kind === 'dragOpening') {
      if (session.moved) store.commit(session.before, true);
      return true;
    }
    return false;
  }, []);

  const cancel = useCallback((): boolean => {
    const c = ctxRef.current;
    const session = sessionRef.current;
    sessionRef.current = { kind: 'idle' };
    setPrev(null);
    if (session.kind === 'dragLine' || session.kind === 'dragOpening') {
      c.store.cancel(session.before);
      return true;
    }
    if (session.kind === 'drawWall' || session.kind === 'drawRoom' || session.kind === 'placeOpening') {
      return true;
    }
    return false;
  }, []);

  return { preview, pointerDown, pointerMove, pointerUp, cancel };
}

/** 判断点是否在房间内（供 2D 命中房间） */
export function roomAtPoint(layout: PlanDoc, p: Point): string | null {
  for (const r of layout.rooms) {
    if (pointInPoly(p, r.poly)) return r.id;
  }
  return null;
}

/** 选中洞口所属墙线，供属性面板使用 */
export function lineOfOpening(layout: PlanDoc, id: string): WallLine | null {
  const o = layout.openings.find((x) => x.id === id);
  return o ? hostLine(layout, o) : null;
}

/** 洞口矩形（供预览层复用） */
export function rectOfOpening(layout: PlanDoc, id: string): Rect | null {
  const o = layout.openings.find((x) => x.id === id);
  if (!o) return null;
  const line = hostLine(layout, o);
  return line ? openingRect(line, o) : null;
}
