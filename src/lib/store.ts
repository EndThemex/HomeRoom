import type { DesignState } from '../types';
import { loadDesign, normalizeDesign, STORE_KEY } from './plan';

type Listener = () => void;

/**
 * 方案状态容器：为 React 提供订阅接口，同时管理撤销 / 重做与本地持久化。
 * 拖动过程中用 applyTransient（不写历史），松手后 commit(before) 一次性入栈。
 */
export class DesignStore {
  private state: DesignState;
  private undoStack: string[] = [];
  private redoStack: string[] = [];
  private listeners = new Set<Listener>();
  private metaListeners = new Set<Listener>();
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

  private save() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.state));
    } catch {
      /* 隐私模式 / 存储已满：静默失败 */
    }
  }

  /** 记录一次可撤销的变更 */
  mutate(fn: (draft: DesignState) => void) {
    const before = this.snapshot();
    const draft: DesignState = { ...this.state };
    fn(draft);
    this.state = draft;
    this.pushUndo(before);
    this.save();
    this.emit();
  }

  /** 不记录历史的高频变更（拖动中） */
  applyTransient(fn: (draft: DesignState) => void) {
    const draft: DesignState = { ...this.state };
    fn(draft);
    this.state = draft;
    this.emit();
  }

  snapshot() {
    return JSON.stringify(this.state);
  }

  /** 拖拽开始前调用，拿到快照；结束时交给 commit */
  commit(before: string) {
    if (before === this.snapshot()) return;
    this.pushUndo(before);
    this.save();
    this.emit();
  }

  cancel(before: string) {
    const parsed = normalizeDesign(JSON.parse(before));
    if (parsed) {
      this.state = parsed;
      this.emit();
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
    return true;
  }

  redo() {
    if (!this.redoStack.length) return false;
    this.undoStack.push(this.snapshot());
    const next = normalizeDesign(JSON.parse(this.redoStack.pop()!));
    if (next) this.state = next;
    this.save();
    this.emit();
    return true;
  }

  reset() {
    this.mutate((draft) => {
      const rooms = Object.keys(draft.rooms);
      rooms.forEach((id) => { delete draft.rooms[id]; });
      draft.furniture = [];
      draft.demolished = [];
      draft.measures = [];
    });
  }
}

export const designStore = new DesignStore();
