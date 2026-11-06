import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CatalogItem, Layers, Selection, Tool, ViewMode, ViewTransform } from './types';
import { designStore } from './lib/store';
import { createI18n, type Lang } from './lib/i18n';
import type { I18n } from './lib/i18n';
import { LANG_KEY, PANES_KEY, normalizeDesign } from './lib/planDoc';
import { makeFurniture } from './lib/plan';
import { pushOut } from './lib/snap';
import { areaOf, normAngle } from './lib/geometry';
import { openingRect } from './lib/openings';
import { deleteOpening, deleteWallLine, wallRectsOf } from './lib/layoutOps';
import { Header } from './components/Header';
import { Library } from './components/Library';
import { Panel } from './components/Panel';
import { Plan2D } from './components/Plan2D';
import { View3D } from './components/View3D';
import type { StageApi } from './lib/stageApi';
import type { SceneManager } from './three/scene';
import { furnitureSvg } from './components/furnitureSvg';

const store = designStore;

const readBool = (key: string, dflt: boolean) => {
  const v = localStorage.getItem(key);
  return v === null ? dflt : v === '1';
};

export function App() {
  const state = useSyncExternalStore(store.subscribe, store.getState);
  const meta = useSyncExternalStore(store.subscribeMeta, store.getMeta);
  const planInfo = useSyncExternalStore(store.subscribePlans, store.getPlanInfo);

  const [lang, setLangState] = useState<Lang>(() => (localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'zh'));
  const i18n = useMemo<I18n>(() => createI18n(lang), [lang]);

  const [viewMode, setViewMode] = useState<ViewMode>('2d');
  const [tool, setTool] = useState<Tool>('select');
  const [selection, setSelection] = useState<Selection | null>(null);
  const [layers, setLayers] = useState<Layers>({ dims: true, labels: true, furn: true, grid: true, bearing: true, wallSnap: true, walls: true, openings: true });
  const [cameraMode, setCameraMode] = useState<'orbit' | 'walk'>('orbit');
  const [walkLocked, setWalkLocked] = useState(false);
  const [touchWalk, setTouchWalk] = useState(false);
  const [hint, setHint] = useState('');
  const [cut, setCutState] = useState(2.8);
  const [opts3d, setOpts3d] = useState({ furn: true, labels: true, night: false });
  const [hour, setHourState] = useState(10);
  const [libOpen, setLibOpen] = useState(() => readBool(PANES_KEY + '-lib', true));
  const [panelOpen, setPanelOpen] = useState(() => readBool(PANES_KEY + '-panel', true));
  const [toast, setToast] = useState<{ msg: string; id: number } | null>(null);
  const [drag, setDrag] = useState<{ item: CatalogItem; x: number; y: number; s: number } | null>(null);

  const stageRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<ViewTransform>({ x0: 0, y0: 0, s: 0.06 });
  const stageApiRef = useRef<StageApi | null>(null);
  const sceneRef = useRef<SceneManager | null>(null);
  const dragRef = useRef<{ item: CatalogItem; sx: number; sy: number; x: number; y: number; moved: boolean; pid: number } | null>(null);
  const modeRef = useRef<ViewMode>('2d');
  modeRef.current = viewMode;

  const langRef = useRef(lang);
  langRef.current = lang;

  const say = useCallback((msg: string) => setToast({ msg, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => { localStorage.setItem(LANG_KEY, lang); }, [lang]);
  useEffect(() => {
    localStorage.setItem(PANES_KEY + '-lib', libOpen ? '1' : '0');
    localStorage.setItem(PANES_KEY + '-panel', panelOpen ? '1' : '0');
  }, [libOpen, panelOpen]);

  /* ---------------------------- 2D / 3D 切换 ---------------------------- */
  const setViewModeSafe = useCallback((m: ViewMode) => {
    if (m === '3d') setCameraMode('orbit');
    setViewMode(m);
  }, []);

  useEffect(() => {
    const mgr = sceneRef.current;
    if (!mgr) return;
    if (viewMode === '3d') {
      void mgr.enter(viewRef.current);
      setHint(mgr.hint());
    } else {
      void mgr.exit();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode]);

  /* ---------------------------- 添加 / 编辑家具 ---------------------------- */
  const addFurniture = useCallback((item: CatalogItem, x: number, y: number) => {
    const f = makeFurniture({ type: item.type, name: item.name, cx: x, cy: y, w: item.w, d: item.d, color: item.color });
    const doc = store.getState().layout;
    const rects: { x0: number; y0: number; x1: number; y1: number }[] = wallRectsOf(doc, store.getState().demolishedLines);
    doc.openings.forEach((o) => {
      const line = doc.lines.find((l) => l.id === o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      rects.push({ x0, y0, x1, y1 });
    });
    pushOut(f, rects);
    store.mutate((d) => { d.furniture.push(f); });
    setSelection({ kind: 'furn', id: f.id });
    say(i18n.t(`已添加：${i18n.nm(item.name)}`, `Added: ${i18n.nm(item.name)}`));
  }, [i18n, say]);

  const dropCenter = useCallback((): { x: number; y: number } | null => {
    const r = stageRef.current?.getBoundingClientRect();
    if (!r) return null;
    if (modeRef.current === '3d') return sceneRef.current?.dropPoint(r.left + r.width / 2, r.top + r.height / 2) ?? null;
    return stageApiRef.current?.centerPoint() ?? null;
  }, []);

  const onLibraryDown = useCallback((item: CatalogItem, e: React.PointerEvent) => {
    e.preventDefault();
    dragRef.current = { item, sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY, moved: false, pid: e.pointerId };
  }, []);

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
      d.moved = true;
      d.x = e.clientX;
      d.y = e.clientY;
      const pt = modeRef.current === '3d'
        ? sceneRef.current?.dropPoint(e.clientX, e.clientY)
        : stageApiRef.current?.dropPoint(e.clientX, e.clientY);
      setDrag({ item: d.item, x: e.clientX, y: e.clientY, s: pt?.s ?? viewRef.current.s });
    };
    const up = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      dragRef.current = null;
      setDrag(null);
      const r = stageRef.current?.getBoundingClientRect();
      const inside = r && e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      if (!inside) return;
      const pt = modeRef.current === '3d'
        ? sceneRef.current?.dropPoint(e.clientX, e.clientY)
        : stageApiRef.current?.dropPoint(e.clientX, e.clientY);
      if (pt) { addFurniture(d.item, pt.x, pt.y); return; }
      const c = dropCenter();
      if (c) addFurniture(d.item, c.x, c.y);
    };
    addEventListener('pointermove', move);
    addEventListener('pointerup', up);
    addEventListener('pointercancel', up);
    return () => {
      removeEventListener('pointermove', move);
      removeEventListener('pointerup', up);
      removeEventListener('pointercancel', up);
    };
  }, [addFurniture, dropCenter]);

  const deleteSelection = useCallback(() => {
    if (!selection) return;
    if (selection.kind === 'furn') {
      store.mutate((d) => { d.furniture = d.furniture.filter((x) => x.id !== selection.id); });
    } else if (selection.kind === 'wall') {
      store.mutateLayout((layout) => { deleteWallLine(layout, selection.id); });
    } else if (selection.kind !== 'room') {
      store.mutateLayout((layout) => { deleteOpening(layout, selection.id); });
    }
    setSelection(null);
  }, [selection]);

  const onMeasure = useCallback((a: [number, number], b: [number, number]) => {
    store.mutate((d) => { d.measures.push({ a: { x: a[0], y: a[1] }, b: { x: b[0], y: b[1] } }); });
  }, []);

  /* ---------------------------- 快捷键 ---------------------------- */
  const rotateSel = useCallback((dir: number) => {
    if (selection?.kind !== 'furn') return;
    store.mutate((d) => {
      const f = d.furniture.find((x) => x.id === selection.id);
      if (f) f.rot = normAngle(f.rot + dir * 90);
    });
  }, [selection]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? store.redo() : store.undo(); return; }
      if (mod && k === 'd') {
        e.preventDefault();
        if (selection?.kind === 'furn') {
          const f = state.furniture.find((x) => x.id === selection.id);
          if (!f) return;
          const copy = { ...f, id: 'f' + Date.now().toString(36), cx: f.cx + 150, cy: f.cy + 150 };
          store.mutate((d) => { d.furniture.push(copy); });
          setSelection({ kind: 'furn', id: copy.id });
        }
        return;
      }
      if (mod) return;
      switch (e.key) {
        case 'Escape':
          if (viewMode === '2d' && stageApiRef.current?.cancelEdit?.()) break;
          setSelection(null);
          setTool('select');
          break;
        case 't': case 'T':
          setViewModeSafe(viewMode === '2d' ? '3d' : '2d');
          break;
        case 'v': case 'V': if (viewMode === '2d') setTool('select'); break;
        case 'w': case 'W': if (viewMode === '2d') setTool('wall'); break;
        case 'q': case 'Q': if (viewMode === '2d') setTool('room'); break;
        case 'r': case 'R': rotateSel(e.shiftKey ? -1 : 1); break;
        case 'd': case 'D': if (viewMode === '2d') setTool('door'); break;
        case 'n': case 'N': if (viewMode === '2d') setTool('window'); break;
        case 's': case 'S': if (viewMode === '2d') setTool('slide'); break;
        case 'm': case 'M': if (viewMode === '2d') setTool('measure'); break;
        case 'x': case 'X': if (viewMode === '2d') setTool('demolish'); break;
        case 'Delete': case 'Backspace':
          deleteSelection();
          break;
        case 'f': case 'F':
          if (e.shiftKey) toggleFullscreen();
          else if (viewMode === '2d') stageApiRef.current?.fit();
          break;
        case '=': case '+': if (viewMode === '2d') stageApiRef.current?.zoomBy(1.25); break;
        case '-': case '_': if (viewMode === '2d') stageApiRef.current?.zoomBy(0.8); break;
        case '[': setLibOpen((v) => !v); break;
        case ']': setPanelOpen((v) => !v); break;
        default: break;
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [selection, state.furniture, viewMode, rotateSel, setViewModeSafe, deleteSelection]);

  /* ---------------------------- 导出 ---------------------------- */
  const download = (href: string, name: string) => {
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    a.click();
  };

  const exportPng = useCallback(() => {
    if (viewMode === '3d') {
      const url = sceneRef.current?.screenshot();
      if (url) download(url, `homeroom-3d-${Date.now()}.png`);
      return;
    }
    const svg = stageRef.current?.querySelector('#plan') as SVGSVGElement | null;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    const vb = svg.getAttribute('viewBox')?.split(' ').map(Number) ?? [0, 0, 12000, 10500];
    const w = Math.min(2400, Math.max(800, vb[2]));
    const scale = w / vb[2];
    clone.setAttribute('viewBox', vb.join(' '));
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(vb[3] * scale));
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const data = new XMLSerializer().serializeToString(clone);
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = w;
      cv.height = Math.round(vb[3] * scale);
      const g = cv.getContext('2d')!;
      g.fillStyle = '#f7f4ee';
      g.fillRect(0, 0, cv.width, cv.height);
      g.drawImage(img, 0, 0, cv.width, cv.height);
      download(cv.toDataURL('image/png'), `homeroom-2d-${Date.now()}.png`);
    };
    img.onerror = () => say(i18n.t('导出失败，请重试', 'Export failed'));
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(data);
  }, [i18n, say, viewMode]);

  const exportJson = useCallback(() => {
    const blob = new Blob([JSON.stringify({ version: 2, state }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    download(url, `homeroom-plan-${Date.now()}.json`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [state]);

  const importJson = useCallback((file: File) => {
    file.text().then((txt) => {
      try {
        const raw = JSON.parse(txt);
        const next = normalizeDesign(raw.state ?? raw);
        if (!next) throw new Error('bad plan');
        store.mutate((d) => { Object.assign(d, next); });
        setSelection(null);
        say(i18n.t('方案已导入', 'Plan imported'));
      } catch {
        say(i18n.t('导入失败：JSON 格式不正确', 'Import failed: invalid JSON'));
      }
    });
  }, [i18n, say]);

  const resetPlan = useCallback(() => {
    const ok = window.confirm(i18n.t(
      '确定重置为默认方案？当前户型内容会被覆盖（可撤销）。',
      'Reset to the default plan? Current content will be replaced (undoable).',
    ));
    if (!ok) return;
    store.reset();
    setSelection(null);
    say(i18n.t('已重置为默认方案（可撤销）', 'Reset to default (undoable)'));
  }, [say, i18n]);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  };

  /* ---------------------------- 户型方案 ---------------------------- */
  const fitStage = useCallback(() => {
    if (modeRef.current === '3d') sceneRef.current?.flyIso();
    else stageApiRef.current?.fit();
  }, []);

  const switchPlan = useCallback((id: string) => {
    if (!store.switchPlan(id)) return;
    setSelection(null);
    setTool('select');
    const name = store.getPlanInfo().plans.find((pl) => pl.id === id)?.name ?? '';
    say(i18n.t(`已切换户型：${name}`, `Switched to: ${name}`));
    fitStage();
  }, [fitStage, i18n, say]);

  const newPlan = useCallback(() => {
    const fallback = `${i18n.t('新户型', 'New plan')} ${planInfo.plans.length + 1}`;
    const input = window.prompt(i18n.t('请输入新户型名称', 'New plan name'), fallback);
    if (input === null) return;
    const name = input.trim() || fallback;
    store.createPlan(name);
    setSelection(null);
    setTool('select');
    say(i18n.t(
      `已新建空白户型：${name}，可用画墙(W) / 建房(Q) 开始绘制`,
      `Blank plan created: ${name}. Start with Wall (W) / Room (Q).`,
    ));
    fitStage();
  }, [fitStage, i18n, planInfo.plans.length, say]);

  const renamePlan = useCallback(() => {
    const cur = planInfo.plans.find((pl) => pl.id === planInfo.activeId);
    if (!cur) return;
    const input = window.prompt(i18n.t('户型名称', 'Plan name'), cur.name);
    if (input === null) return;
    if (store.renamePlan(cur.id, input)) say(i18n.t('户型已重命名', 'Plan renamed'));
  }, [i18n, planInfo, say]);

  const deletePlan = useCallback(() => {
    const cur = planInfo.plans.find((pl) => pl.id === planInfo.activeId);
    if (!cur || planInfo.plans.length <= 1) return;
    const ok = window.confirm(i18n.t(
      `确定删除户型「${cur.name}」？该操作不可撤销。`,
      `Delete plan "${cur.name}"? This cannot be undone.`,
    ));
    if (!ok) return;
    if (store.deletePlan(cur.id)) {
      setSelection(null);
      say(i18n.t('户型已删除', 'Plan deleted'));
      fitStage();
    }
  }, [fitStage, i18n, planInfo, say]);

  /* ---------------------------- 3D 回调 ---------------------------- */
  const onReady = useCallback((m: SceneManager | null) => {
    sceneRef.current = m;
    if (m && modeRef.current === '3d') void m.enter(viewRef.current);
  }, []);

  const onCameraMode = useCallback((m: 'orbit' | 'walk') => {
    setCameraMode(m);
    if (m === 'orbit') { setWalkLocked(false); setTouchWalk(false); }
    setHint(m === 'walk'
      ? (touchWalk ? i18n.t('左下摇杆移动 · 拖动画面转向 · 点门开关', 'Joystick moves · drag to look · tap doors to open')
        : i18n.t('WASD 移动 · 鼠标转向 · Shift 快走 · E 开关门 · Esc 暂停', 'WASD moves · mouse looks · Shift runs · E opens doors · Esc pauses'))
      : sceneRef.current?.hint() ?? '');
  }, [i18n, touchWalk]);

  const netArea = state.layout.rooms
    .filter((r) => r.counted !== false)
    .reduce((a, r) => a + areaOf(r.poly), 0);

  const toggleLayer = (k: keyof Layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  const ratioView = (ratio: number) => {
    stageApiRef.current?.setRatio?.(ratio);
  };

  return (
    <div className="app">
      <Header
        i18n={i18n}
        plans={planInfo.plans}
        activePlanId={planInfo.activeId}
        onSwitchPlan={switchPlan}
        onNewPlan={newPlan}
        onRenamePlan={renamePlan}
        onDeletePlan={deletePlan}
        viewMode={viewMode}
        setViewMode={setViewModeSafe}
        tool={tool}
        setTool={setTool}
        layers={layers}
        toggleLayer={toggleLayer}
        cameraMode={cameraMode}
        setCameraMode={(m) => sceneRef.current?.setCameraMode(m)}
        cut={cut}
        setCut={(v) => { setCutState(v); sceneRef.current?.setCut(v); }}
        opts3d={opts3d}
        toggle3d={(k) => {
          const v = !opts3d[k];
          setOpts3d({ ...opts3d, [k]: v });
          sceneRef.current?.setOption(k, v);
        }}
        hour={hour}
        setHour={(v) => { setHourState(v); sceneRef.current?.setHour(v); }}
        canUndo={meta.canUndo}
        canRedo={meta.canRedo}
        onUndo={() => store.undo()}
        onRedo={() => store.redo()}
        onClear={() => {
          if (!state.furniture.length) return;
          const ok = window.confirm(i18n.t(
            '确定清空所有家具？该操作可撤销。',
            'Remove all furniture? This can be undone.',
          ));
          if (!ok) return;
          store.mutate((d) => { d.furniture = []; });
          setSelection(null);
          say(i18n.t('已清空所有家具（可撤销）', 'All furniture removed (undoable)'));
        }}
        onFit={() => stageApiRef.current?.fit()}
        onZoom={(k) => stageApiRef.current?.zoomBy(k)}
        onRatio={ratioView}
        onExportPng={exportPng}
        onExportJson={exportJson}
        onImport={importJson}
        onReset={resetPlan}
        lang={lang}
        setLang={(l) => setLangState(l)}
        onFullscreen={toggleFullscreen}
        libOpen={libOpen}
        panelOpen={panelOpen}
        toggleLib={() => setLibOpen((v) => !v)}
        togglePanel={() => setPanelOpen((v) => !v)}
        onFlyIso={() => sceneRef.current?.flyIso()}
        onFlyTop={() => sceneRef.current?.flyTop()}
      />

      <div className={`main${libOpen ? '' : ' lib-off'}${panelOpen ? '' : ' panel-off'}`}>
        <div className={`libwrap${libOpen ? '' : ' off'}`}>
          <Library
            i18n={i18n}
            viewMode={viewMode}
            selection={selection}
            rooms={state.layout.rooms}
            onDragStart={onLibraryDown}
            onFlyRoom={(id) => sceneRef.current?.flyRoom(id)}
            onSelectRoom={(id) => setSelection({ kind: 'room', id })}
          />
        </div>

        <main className="stage" ref={stageRef}>
          <Plan2D
            store={store}
            viewRef={viewRef}
            tool={tool}
            selection={selection}
            layers={layers}
            i18n={i18n}
            stageApiRef={stageApiRef}
            onSelect={setSelection}
            onMeasure={onMeasure}
            onToast={say}
          />

          <View3D
            store={store}
            i18n={i18n}
            show={viewMode === '3d'}
            selection={selection}
            viewRef={viewRef}
            cameraMode={cameraMode}
            walkLocked={walkLocked}
            touchWalk={touchWalk}
            hint={hint}
            onReady={onReady}
            onSelect={setSelection}
            onCameraMode={onCameraMode}
            onWalkLocked={(v) => { setWalkLocked(v); if (v) setHint(sceneRef.current?.hint() ?? ''); }}
            onTouchWalk={setTouchWalk}
            onHint={setHint}
            onError={() => undefined}
          />

          {drag && (
            <div
              className="ghost"
              style={{
                left: drag.x,
                top: drag.y,
                width: Math.max(36, drag.item.w * drag.s),
                height: Math.max(36, drag.item.d * drag.s),
              }}
            >
              <svg viewBox={`${-drag.item.w / 2} ${-drag.item.d / 2} ${drag.item.w} ${drag.item.d}`} width="100%" height="100%" preserveAspectRatio="xMidYMid meet">
                <g dangerouslySetInnerHTML={{ __html: furnitureSvg(drag.item.type, drag.item.w, drag.item.d, drag.item.color) }} />
              </svg>
            </div>
          )}
        </main>

        <div className={`propslot${panelOpen ? '' : ' off'}`}>
          <Panel
            store={store}
            state={state}
            i18n={i18n}
            selection={selection}
            onSelect={setSelection}
            open={panelOpen}
            onClose={() => setPanelOpen(false)}
          />
        </div>
      </div>

      <footer>
        <div className="fg">
          <span id="coord">{viewMode === '2d' ? i18n.t('拖动查看坐标', 'Move to inspect coordinates') : i18n.t('3D 场景 · 拖动家具可摆放', '3D scene · drag furniture to place')}</span>
          <span>{i18n.t('家具', 'Furniture')} {state.furniture.length} {i18n.t('件', 'pcs')}</span>
          <span>{i18n.t('套内', 'Net')} {netArea.toFixed(2)} m²</span>
          <span>{i18n.t('房间', 'Rooms')} {state.layout.rooms.filter((r) => r.counted !== false).length}</span>
          {viewMode === '2d' && <span>{i18n.t('Shift+滚轮 缩放 · 空格拖动平移', 'Shift+wheel zoom · drag to pan')}</span>}
        </div>
        <div className="fg right">
          <span>{i18n.t('方案保存在本机', 'Saved locally')}</span>
          <span>© 2026 HomeRoom</span>
        </div>
      </footer>

      {toast && <div className="toast" key={toast.id}>{toast.msg}</div>}
    </div>
  );
}
