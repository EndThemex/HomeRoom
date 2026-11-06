import { useEffect, useRef } from 'react';
import type { RefObject } from 'react';
import type { CameraMode, Layers, Tool, ViewMode } from '../types';
import type { I18n, Lang } from '../lib/i18n';
import type { PlanMeta } from '../lib/planDoc';

interface Props {
  i18n: I18n;
  plans: PlanMeta[];
  activePlanId: string;
  onSwitchPlan: (id: string) => void;
  onNewPlan: () => void;
  onRenamePlan: () => void;
  onDeletePlan: () => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  tool: Tool;
  setTool: (t: Tool) => void;
  layers: Layers;
  toggleLayer: (k: keyof Layers) => void;
  cameraMode: CameraMode;
  setCameraMode: (m: CameraMode) => void;
  cut: number;
  setCut: (v: number) => void;
  opts3d: { furn: boolean; labels: boolean; night: boolean };
  toggle3d: (k: 'furn' | 'labels' | 'night') => void;
  hour: number;
  setHour: (v: number) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onFit: () => void;
  onZoom: (k: number) => void;
  onRatio: (ratio: number) => void;
  onExportPng: () => void;
  onExportJson: () => void;
  onImport: (file: File) => void;
  onReset: () => void;
  lang: Lang;
  setLang: (l: Lang) => void;
  onFullscreen: () => void;
  libOpen: boolean;
  panelOpen: boolean;
  toggleLib: () => void;
  togglePanel: () => void;
  onFlyIso: () => void;
  onFlyTop: () => void;
}

const LAYER_GROUPS: { titleZh: string; titleEn: string; keys: (keyof Layers)[] }[] = [
  { titleZh: '标注', titleEn: 'Annotations', keys: ['dims', 'labels', 'bearing'] },
  { titleZh: '显示', titleEn: 'Display', keys: ['furn', 'walls', 'openings', 'grid'] },
  { titleZh: '吸附', titleEn: 'Snap', keys: ['wallSnap'] },
];

const LAYER_NAMES: Record<keyof Layers, [string, string]> = {
  dims: ['尺寸', 'Dims'],
  labels: ['房间名', 'Labels'],
  furn: ['家具', 'Furniture'],
  grid: ['网格', 'Grid'],
  bearing: ['承重墙', 'Bearing'],
  wallSnap: ['贴墙吸附', 'Wall snap'],
  walls: ['墙线', 'Walls'],
  openings: ['门窗', 'Openings'],
};

export function Header(p: Props) {
  const { i18n: { t }, viewMode } = p;
  const fileRef = useRef<HTMLInputElement>(null);
  const planRef = useRef<HTMLDetailsElement>(null);
  const doorRef = useRef<HTMLDetailsElement>(null);
  const moreRef = useRef<HTMLDetailsElement>(null);
  const viewRef = useRef<HTMLDetailsElement>(null);
  const angleRef = useRef<HTMLDetailsElement>(null);
  const fileMenuRef = useRef<HTMLDetailsElement>(null);
  const miscRef = useRef<HTMLDetailsElement>(null);

  const in2d = viewMode === '2d';
  const activePlan = p.plans.find((pl) => pl.id === p.activePlanId);
  const openingActive = p.tool === 'door' || p.tool === 'window' || p.tool === 'slide';
  const moreActive = p.tool === 'measure' || p.tool === 'demolish';
  const hiddenLayers = (Object.keys(p.layers) as (keyof Layers)[]).filter((k) => !p.layers[k]).length;

  const close = (ref: RefObject<HTMLDetailsElement | null>) => {
    if (ref.current) ref.current.open = false;
  };

  /* 点击其它菜单或空白处时收起已展开的浮层 */
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const inside = (e.target as HTMLElement | null)?.closest('details.menu');
      document.querySelectorAll<HTMLDetailsElement>('details.menu[open]').forEach((d) => {
        if (d !== inside) d.open = false;
      });
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);

  const toolBtn = (key: Tool, label: string, title: string) => (
    <button className={`btn${p.tool === key ? ' on' : ''}`} onClick={() => p.setTool(key)} title={title}>{label}</button>
  );

  const checkRow = (on: boolean, label: string, onChange: () => void) => (
    <label className="row">
      <input type="checkbox" checked={on} onChange={onChange} />
      <span>{label}</span>
    </label>
  );

  const openingLabel = p.tool === 'door' ? t('门', 'Door')
    : p.tool === 'window' ? t('窗', 'Window')
      : p.tool === 'slide' ? t('推拉门', 'Slide')
        : t('门窗', 'Openings');

  return (
    <header>
      <div className="grp">
        <button
          className={`btn icon${p.libOpen ? ' on' : ''}`}
          onClick={p.toggleLib}
          title={t('家具库 ( [ )', 'Library ( [ )')}
          aria-label={t('家具库', 'Library')}
        >◧</button>
        <button
          className={`btn icon${p.panelOpen ? ' on' : ''}`}
          onClick={p.togglePanel}
          title={t('属性面板 ( ] )', 'Properties ( ] )')}
          aria-label={t('属性面板', 'Properties')}
        >◨</button>
      </div>

      <div className="grp">
        <details className="menu planmenu" ref={planRef}>
          <summary className="btn planname" title={t(`${p.plans.length} 个户型方案 · 尺寸单位 mm`, `${p.plans.length} plans · units: mm`)}>
            <span>{activePlan?.name ?? t('未命名户型', 'Untitled plan')}</span>
            <i>▾</i>
          </summary>
          <div className="menu-pop plans">
            <div className="group-title">{t(`${p.plans.length} 个户型方案 · 单位 mm`, `${p.plans.length} plans · units: mm`)}</div>
            {p.plans.map((pl) => (
              <button
                key={pl.id}
                className={`btn${pl.id === p.activePlanId ? ' on' : ''}`}
                onClick={() => { p.onSwitchPlan(pl.id); close(planRef); }}
              >
                {pl.id === p.activePlanId ? '✓ ' : ''}{pl.name}
              </button>
            ))}
            <div className="menu-sep" />
            <button className="btn" onClick={() => { p.onNewPlan(); close(planRef); }}>{t('新建户型', 'New plan')}</button>
            <button className="btn" onClick={() => { p.onRenamePlan(); close(planRef); }}>{t('重命名当前户型', 'Rename plan')}</button>
            <button
              className="btn danger"
              disabled={p.plans.length <= 1}
              onClick={() => { p.onDeletePlan(); close(planRef); }}
            >
              {t('删除当前户型', 'Delete plan')}
            </button>
          </div>
        </details>
      </div>

      <div className="seg" title={t('切换 2D / 3D (T)', 'Switch 2D / 3D (T)')}>
        <span className="pill" style={{ transform: in2d ? 'translateX(0)' : 'translateX(100%)' }} />
        <button className={`btn${in2d ? ' on' : ''}`} onClick={() => p.setViewMode('2d')}>{t('2D 平面', '2D Plan')}</button>
        <button className={`btn${!in2d ? ' on' : ''}`} onClick={() => p.setViewMode('3d')}>{t('3D 场景', '3D Scene')}</button>
      </div>

      {in2d && (
        <div className="grp">
          {toolBtn('select', t('选择', 'Select'), t('选择 / 移动 (V)', 'Select / Move (V)'))}
          {toolBtn('wall', t('画墙', 'Wall'), t('画墙 (W)', 'Draw wall (W)'))}
          {toolBtn('room', t('建房', 'Room'), t('快速建房 (Q)', 'Draw room (Q)'))}

          <details className="menu" ref={doorRef}>
            <summary className={`btn${openingActive ? ' on' : ''}`}>{openingLabel} ▾</summary>
            <div className="menu-pop">
              <button className="btn" onClick={() => { p.setTool('door'); close(doorRef); }}>{t('门 · D', 'Door · D')}</button>
              <button className="btn" onClick={() => { p.setTool('window'); close(doorRef); }}>{t('窗 · N', 'Window · N')}</button>
              <button className="btn" onClick={() => { p.setTool('slide'); close(doorRef); }}>{t('推拉门 · S', 'Sliding door · S')}</button>
            </div>
          </details>

          <details className="menu" ref={moreRef}>
            <summary className={`btn${moreActive ? ' on' : ''}`}>{t('更多', 'More')} ▾</summary>
            <div className="menu-pop">
              <button className="btn" onClick={() => { p.setTool('measure'); close(moreRef); }}>{t('测量 · M', 'Measure · M')}</button>
              <button className="btn" onClick={() => { p.setTool('demolish'); close(moreRef); }}>{t('拆改墙体 · X', 'Demolish walls · X')}</button>
            </div>
          </details>
        </div>
      )}

      {in2d && (
        <div className="grp">
          <button className="btn icon" onClick={() => p.onZoom(0.8)} title={t('缩小', 'Zoom out')} aria-label={t('缩小', 'Zoom out')}>−</button>
          <button className="btn icon" onClick={() => p.onZoom(1.25)} title={t('放大', 'Zoom in')} aria-label={t('放大', 'Zoom in')}>＋</button>
          <button className="btn icon" onClick={p.onFit} title={t('适应窗口 (F)', 'Fit to window (F)')} aria-label={t('适应窗口', 'Fit to window')}>⤢</button>
        </div>
      )}

      {!in2d && (
        <div className="grp">
          <button className={`btn${p.cameraMode === 'orbit' ? ' on' : ''}`} onClick={() => p.setCameraMode('orbit')}>{t('鸟瞰', 'Orbit')}</button>
          <button className={`btn${p.cameraMode === 'walk' ? ' on' : ''}`} onClick={() => p.setCameraMode('walk')}>{t('漫游', 'Walk')}</button>
          <details className="menu" ref={angleRef}>
            <summary className="btn">{t('视角', 'View')} ▾</summary>
            <div className="menu-pop">
              <button className="btn" onClick={() => { p.onFlyIso(); close(angleRef); }}>{t('斜视', 'Iso')}</button>
              <button className="btn" onClick={() => { p.onFlyTop(); close(angleRef); }}>{t('俯视', 'Top')}</button>
            </div>
          </details>
        </div>
      )}

      <div className="grp">
        <button className="btn icon" onClick={p.onUndo} disabled={!p.canUndo} title={t('撤销 (Ctrl+Z)', 'Undo (Ctrl+Z)')} aria-label={t('撤销', 'Undo')}>↶</button>
        <button className="btn icon" onClick={p.onRedo} disabled={!p.canRedo} title={t('重做 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')} aria-label={t('重做', 'Redo')}>↷</button>
      </div>

      <div className="spacer" />

      <div className="grp">
        <details className="menu" ref={viewRef}>
          <summary className={`btn chip${hiddenLayers > 0 ? ' on' : ''}`} title={t('图层与显示设置', 'Layers & display')}>
            {t('视图', 'View')} ▾
          </summary>
          <div className="menu-pop wide">
            {in2d ? (
              <>
                {LAYER_GROUPS.map((g) => (
                  <div key={g.titleZh}>
                    <div className="group-title">{t(g.titleZh, g.titleEn)}</div>
                    {g.keys.map((k) => checkRow(p.layers[k], t(...LAYER_NAMES[k]), () => p.toggleLayer(k)))}
                  </div>
                ))}
                <div className="menu-sep" />
                <div className="group-title">{t('出图比例', 'Scale')}</div>
                <button className="btn" onClick={() => { p.onRatio(60); close(viewRef); }}>1:60</button>
                <button className="btn" onClick={() => { p.onRatio(100); close(viewRef); }}>1:100</button>
              </>
            ) : (
              <>
                <div className="group-title">{t('剖切与显示', 'Cut & display')}</div>
                {checkRow(p.cut < 2.8, t('剖切墙', 'Cut walls'), () => p.setCut(p.cut < 2.8 ? 2.8 : 1.2))}
                {checkRow(p.opts3d.furn, t('家具', 'Furniture'), () => p.toggle3d('furn'))}
                {checkRow(p.opts3d.labels, t('房间名', 'Labels'), () => p.toggle3d('labels'))}
                {checkRow(p.opts3d.night, t('夜景', 'Night'), () => p.toggle3d('night'))}
                <div className="menu-sep" />
                <label className="range sun">
                  <span>{t('日照', 'Sun')}</span>
                  <input type="range" min={7} max={18} step={0.25} value={p.hour} onChange={(e) => p.setHour(+e.target.value)} />
                  <b>{String(Math.floor(p.hour)).padStart(2, '0')}:{String(Math.round((p.hour - Math.floor(p.hour)) * 60)).padStart(2, '0')}</b>
                </label>
              </>
            )}
          </div>
        </details>
      </div>

      <div className="grp">
        <details className="menu" ref={fileMenuRef}>
          <summary className="btn chip">{t('文件', 'File')} ▾</summary>
          <div className="menu-pop">
            <button className="btn" onClick={() => { p.onExportPng(); close(fileMenuRef); }}>{t('导出图片', 'Export image')}</button>
            <button className="btn" onClick={() => { p.onExportJson(); close(fileMenuRef); }}>{t('导出方案 JSON', 'Export plan JSON')}</button>
            <button className="btn" onClick={() => { fileRef.current?.click(); close(fileMenuRef); }}>{t('导入方案', 'Import plan')}</button>
            <div className="menu-sep" />
            <button className="btn danger" onClick={() => { p.onClear(); close(fileMenuRef); }}>{t('清空所有家具', 'Clear furniture')}</button>
            <button className="btn danger" onClick={() => { p.onReset(); close(fileMenuRef); }}>{t('重置为默认方案', 'Reset to default')}</button>
          </div>
        </details>
      </div>

      <div className="grp">
        <details className="menu" ref={miscRef}>
          <summary className="btn icon" title={t('更多设置', 'More settings')}>⋯</summary>
          <div className="menu-pop">
            <div className="group-title">{t('界面语言', 'Language')}</div>
            <button className={`btn${p.lang === 'zh' ? ' on' : ''}`} onClick={() => p.setLang('zh')}>{p.lang === 'zh' ? '✓ ' : ''}{t('简体中文', 'Chinese')}</button>
            <button className={`btn${p.lang === 'en' ? ' on' : ''}`} onClick={() => p.setLang('en')}>{p.lang === 'en' ? '✓ ' : ''}English</button>
            <div className="menu-sep" />
            <button className="btn" onClick={() => { p.onFullscreen(); close(miscRef); }}>{t('全屏', 'Fullscreen')} <span className="kbd">Shift+F</span></button>
            <div className="menu-note">
              {t('快捷键：V 选择 · W 画墙 · Q 建房 · T 切换视角 · F 适应', 'Keys: V select · W wall · Q room · T view · F fit')}
            </div>
          </div>
        </details>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) p.onImport(f);
          e.target.value = '';
        }}
      />
    </header>
  );
}
