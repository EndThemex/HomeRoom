import type { DesignState, PlanDoc } from '../types';
import { defaultDesign, STORE_KEY, cloneLayout, loadDesign, normalizeDesign } from './planDoc';
import { refreshRooms } from './roomTrace';
import { wallRectsOf } from './layoutOps';
import { openingRect } from './openings';
import { pushOut } from './snap';

type Listener = () => void;

/**
 * 方案状态容器：为 React 提供订阅接口，同时管理撤销 / 重做与本地持久化。
 * 拖动过程中用 applyTransient（不写历史），松手后 commit(before) 一次性入栈。
 * subscribeCommit 仅由提交类操作触发，3D 场景据此合并重建。
 */
export class DesignStore {
  private state: DesignState;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private metaListeners = new Set<Listener>();
  private commitListeners = new Set<Listener>();
  private meta = { canUndo: false, canRedo: false };

  constructor(state: DesignState = loadDesign()) {
    this.state = state;
  }

  /** useSyncExternalStore 要求快照在两次变更之间保持同一引用 */
  getState = () => this.state;

  subscribe = (listener: Listener) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };

  /** 撤销栈深度变化时通知（用于按钮可用态） */
  subscribeMeta = (listener: Listener) => {
    this.metaListeners.add(listener);
    return () => { this.metaListeners.delete(listener); };
  };

  /** 提交事件：仅 mutate / commit / undo / redo 触发，transient 不触发 */
  subscribeCommit = (listener: Listener) => {
    this.commitListeners.add(listener);
    return () => { this.commitListeners.delete(listener); };
  };

  getMeta = () => this.meta;

  private emit() {
    const canUndo = this.undoStack.length > 0;
    const canRedo = this.redoStack.length > 0;
    if (canUndo !== this.meta.canUndo || canRedo !== this.meta.canRedo) {
      this.meta = { canUndo, canRedo };
    }
    this.listeners.forEach((l) => l());
    this.metaListeners.forEach((l) => l());
  }

  private emitCommit() {
    this.commitListeners.forEach((l) => l());
  }

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      /* 隐私模式 / 存储已满：静默失败 */
    }
  }

  /** 记录一次可撤销的变更（家具 / 测量等） */
  mutate(fn: (draft: DesignState) => void) {
    const before = this.snapshot();
    const draft: DesignState = { ...this.state };
    fn(draft);
    this.state = draft;
    this.pushUndo(before);
    this.save();
    this.emit();
    this.emitCommit();
  }

  /** 户型编辑：对 layout 副本执行操作，并重算房间后入栈 */
  mutateLayout(fn: (layout: PlanDoc, draft: DesignState) => void) {
    const before = this.snapshot();
    const draft: DesignState = { ...this.state, layout: cloneLayout(this.state.layout) };
    fn(draft.layout, draft);
    draft.layout.dimensionChains = null;
    draft.layout.rooms = refreshRooms(draft.layout, this.state.layout.rooms, draft.demolishedLines);
    this.settle(draft);
    this.state = draft;
    this.pushUndo(before);
    this.save();
    this.emit();
    this.emitCommit();
  }

  /** 拆改墙线：拓扑变化，需要重算房间 */
  toggleDemolish(lineId: string) {
    const before = this.snapshot();
    const draft: DesignState = { ...this.state, layout: cloneLayout(this.state.layout) };
    const on = draft.demolishedLines.includes(lineId);
    draft.demolishedLines = on
      ? draft.demolishedLines.filter((x) => x !== lineId)
      : [...draft.demolishedLines, lineId];
    draft.layout.rooms = refreshRooms(draft.layout, this.state.layout.rooms, draft.demolishedLines);
    this.settle(draft);
    this.state = draft;
    this.pushUndo(before);
    this.save();
    this.emit();
    this.emitCommit();
    return on;
  }

  /** 不记录历史的高频变更（拖动中） */
  applyTransient(fn: (draft: DesignState) => void) {
    const draft: DesignState = { ...this.state };
    fn(draft);
    this.state = draft;
    this.emit();
  }

  /** 拖动中的户型变更：不重算房间、不写历史 */
  applyTransientLayout(fn: (layout: PlanDoc) => void) {
    const layout = cloneLayout(this.state.layout);
    fn(layout);
    this.state = { ...this.state, layout };
    this.emit();
  }

  snapshot() {
    return JSON.stringify(this.state);
  }

  /** 拖拽开始前调用，拿到快照；结束时交给 commit */
  commit(before: string, recomputeRooms = false) {
    if (before === this.snapshot()) return;
    if (recomputeRooms) {
      const layout = this.state.layout;
      this.state = {
        ...this.state,
        layout: { ...layout, rooms: refreshRooms(layout, layout.rooms, this.state.demolishedLines) },
      };
      this.settle(this.state);
    }
    this.pushUndo(before);
    this.save();
    this.emit();
    this.emitCommit();
  }

  /** 布局提交后把压到墙体 / 门窗的家具沿浅方向推出，保持贴墙 */
  private settle(draft: DesignState) {
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = wallRectsOf(draft.layout, draft.demolishedLines)
      .map((w) => ({ x0: w.x0, y0: w.y0, x1: w.x1, y1: w.y1 }));
    draft.layout.openings.forEach((o) => {
      if (draft.demolishedLines.includes(o.lineId)) return;
      const line = draft.layout.lines.find((l) => l.id === o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      rects.push({ x0, y0, x1, y1 });
    });
    draft.furniture.forEach((f) => pushOut(f, rects));
  }

  cancel(before: string) {
    const parsed = normalizeDesign(JSON.parse(before));
    if (parsed) {
      this.state = parsed;
      this.emit();
      this.emitCommit();
    }
  }

  private pushUndo(before: string) {
    this.undoStack.push(before);
    if (this.undoStack.length > 150) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo() {
    if (!this.undoStack.length) return false;
    this.redoStack.push(this.snapshot());
    const prev = normalizeDesign(JSON.parse(this.undoStack.pop()!));
    if (prev) this.state = prev;
    this.save();
    this.emit();
    this.emitCommit();
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    const next = normalizeDesign(JSON.parse(this.redoStack.pop()!));
    if (next) this.state = next;
    this.save();
    this.emit();
    this.emitCommit();
    return true;
  }

  reset() {
    const before = this.snapshot();
    this.state = defaultDesign();
    this.pushUndo(before);
    this.save();
    this.emit();
    this.emitCommit();
  }
}

export const designStore = new DesignStore();
