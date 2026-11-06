import { useRef } from 'react';
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

export function Header(p: Props) {
  const { i18n: { t }, viewMode } = p;
  const fileRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const planRef = useRef<HTMLDetailsElement>(null);
  const in2d = viewMode === '2d';
  const activePlan = p.plans.find((pl) => pl.id === p.activePlanId);
  const closePlans = () => { if (planRef.current) planRef.current.open = false; };

  const btn = (on: boolean, label: string, onClick: () => void, title?: string) => (
    <button className={`btn${on ? ' on' : ''}`} onClick={onClick} title={title}>{label}</button>
  );

  return (
    <header>
      <div className="grp">
        <button className={`btn chip${p.libOpen ? ' on' : ''}`} onClick={p.toggleLib}>{t('◧ 家具库', '◧ Library')}</button>
        <button className={`btn chip${p.panelOpen ? ' on' : ''}`} onClick={p.togglePanel}>{t('属性 ◨', 'Properties ◨')}</button>
      </div>

      <div className="brand">
        <b>{activePlan?.name ?? t('未命名户型', 'Untitled plan')}</b>
        <span>{t(`${p.plans.length} 个户型方案 · 尺寸单位 mm`, `${p.plans.length} plans · units: mm`)}</span>
      </div>

      <details className="menu planmenu" ref={planRef}>
        <summary className="btn">{t('户型 ▾', 'Plans ▾')}</summary>
        <div className="menu-pop plans">
          {p.plans.map((pl) => (
            <button
              key={pl.id}
              className={`btn${pl.id === p.activePlanId ? ' on' : ''}`}
              onClick={() => { p.onSwitchPlan(pl.id); closePlans(); }}
            >
              {pl.id === p.activePlanId ? '✓ ' : ''}{pl.name}
            </button>
          ))}
          <div className="menu-sep" />
          <button className="btn" onClick={() => { p.onNewPlan(); closePlans(); }}>{t('新建户型', 'New plan')}</button>
          <button className="btn" onClick={() => { p.onRenamePlan(); closePlans(); }}>{t('重命名当前户型', 'Rename plan')}</button>
          <button
            className="btn danger"
            disabled={p.plans.length <= 1}
            onClick={() => { p.onDeletePlan(); closePlans(); }}
          >
            {t('删除当前户型', 'Delete plan')}
          </button>
        </div>
      </details>

      <div className="seg" title={t('切换 2D / 3D (T)', 'Switch 2D / 3D (T)')}>
        <span className="pill" style={{ transform: in2d ? 'translateX(0)' : 'translateX(100%)' }} />
        <button className={`btn${in2d ? ' on' : ''}`} onClick={() => p.setViewMode('2d')}>{t('2D 平面', '2D Plan')}</button>
        <button className={`btn${!in2d ? ' on' : ''}`} onClick={() => p.setViewMode('3d')}>{t('3D 场景', '3D Scene')}</button>
      </div>

      {in2d && (
        <div className="grp">
          {btn(p.tool === 'select', t('选择', 'Select'), () => p.setTool('select'), t('选择 / 移动 (V)', 'Select / Move (V)'))}
          {btn(p.tool === 'wall', t('画墙', 'Wall'), () => p.setTool('wall'), t('画墙 (W)', 'Draw wall (W)'))}
          {btn(p.tool === 'room', t('建房', 'Room'), () => p.setTool('room'), t('快速建房 (Q)', 'Draw room (Q)'))}
          {btn(p.tool === 'door', t('门', 'Door'), () => p.setTool('door'), t('放置门 (D)', 'Door (D)'))}
          {btn(p.tool === 'window', t('窗', 'Window'), () => p.setTool('window'), t('放置窗 (N)', 'Window (N)'))}
          {btn(p.tool === 'slide', t('推拉门', 'Slide'), () => p.setTool('slide'), t('放置推拉门 (S)', 'Sliding door (S)'))}
          {btn(p.tool === 'measure', t('测量', 'Measure'), () => p.setTool('measure'), t('测量 (M)', 'Measure (M)'))}
          {btn(p.tool === 'demolish', t('拆改墙体', 'Demolish'), () => p.setTool('demolish'), t('拆改非承重墙 (X)', 'Demolish walls (X)'))}
        </div>
      )}

      {in2d && (
        <div className="grp">
          <button className="btn" onClick={() => p.onZoom(0.8)} title={t('缩小', 'Zoom out')}>−</button>
          <button className="btn" onClick={() => p.onZoom(1.25)} title={t('放大', 'Zoom in')}>＋</button>
          <button className="btn" onClick={p.onFit} title={t('适应窗口 (F)', 'Fit to window (F)')}>{t('适应', 'Fit')}</button>
          <button className="btn" onClick={() => p.onRatio(60)} title={t('按 1:60 显示', 'Show at 1:60')}>1:60</button>
          <button className="btn" onClick={() => p.onRatio(100)} title={t('按 1:100 显示', 'Show at 1:100')}>1:100</button>
        </div>
      )}

      {!in2d && (
        <>
          <div className="grp">
            {btn(p.cameraMode === 'orbit', t('鸟瞰', 'Orbit'), () => p.setCameraMode('orbit'))}
            {btn(p.cameraMode === 'walk', t('漫游', 'Walk'), () => p.setCameraMode('walk'))}
          </div>
          <div className="grp">
            <button className="btn" onClick={p.onFlyIso}>{t('斜视', 'Iso')}</button>
            <button className="btn" onClick={p.onFlyTop}>{t('俯视', 'Top')}</button>
          </div>
        </>
      )}

      <div className="grp">
        <button className="btn" onClick={p.onUndo} disabled={!p.canUndo} title={t('撤销 (Ctrl+Z)', 'Undo (Ctrl+Z)')}>{t('撤销', 'Undo')}</button>
        <button className="btn" onClick={p.onRedo} disabled={!p.canRedo} title={t('重做 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')}>{t('重做', 'Redo')}</button>
        <button className="btn danger" onClick={p.onClear} title={t('清空所有家具家电（可撤销）', 'Remove all furniture (undoable)')}>{t('清空布置', 'Clear')}</button>
      </div>

      {in2d && (
        <div className="grp">
          {(Object.keys(p.layers) as (keyof Layers)[]).map((k) => (
            <button key={k} className={`btn chip${p.layers[k] ? ' on' : ''}`} onClick={() => p.toggleLayer(k)}>
              {k === 'dims' ? t('尺寸', 'Dims') : k === 'labels' ? t('房间名', 'Labels') : k === 'furn' ? t('家具', 'Furniture') : k === 'grid' ? t('网格', 'Grid') : k === 'bearing' ? t('承重墙', 'Bearing') : k === 'walls' ? t('墙线', 'Walls') : k === 'openings' ? t('门窗', 'Openings') : t('贴墙吸附', 'Wall snap')}
            </button>
          ))}
        </div>
      )}

      {!in2d && (
        <>
          <div className="grp">
            <button className={`btn chip${p.cut >= 2.8 ? ' on' : ''}`} onClick={() => p.setCut(2.8)}>{t('全高墙', 'Full walls')}</button>
            <button className={`btn chip${p.cut < 2.8 ? ' on' : ''}`} onClick={() => p.setCut(1.2)}>{t('剖切墙', 'Cut walls')}</button>
          </div>
          <div className="grp">
            {(['furn', 'labels', 'night'] as const).map((k) => (
              <button key={k} className={`btn chip${p.opts3d[k] ? ' on' : ''}`} onClick={() => p.toggle3d(k)}>
                {k === 'furn' ? t('家具', 'Furniture') : k === 'labels' ? t('房间名', 'Labels') : t('夜景', 'Night')}
              </button>
            ))}
          </div>
          <div className="grp">
            <label className="range">
              <span>{t('日照', 'Sun')}</span>
              <input type="range" min={7} max={18} step={0.25} value={p.hour} onChange={(e) => p.setHour(+e.target.value)} />
              <b>{String(Math.floor(p.hour)).padStart(2, '0')}:{String(Math.round((p.hour - Math.floor(p.hour)) * 60)).padStart(2, '0')}</b>
            </label>
          </div>
        </>
      )}

      <div className="spacer" />

      <div className="grp">
        {(['zh', 'en'] as Lang[]).map((l) => (
          <button key={l} className={`btn chip${p.lang === l ? ' on' : ''}`} onClick={() => p.setLang(l)} title={l === 'zh' ? '简体中文' : 'English'}>
            {l === 'zh' ? '简' : 'EN'}
          </button>
        ))}
      </div>

      <button className="btn outline" onClick={p.onFullscreen} title={`${t('全屏', 'Fullscreen')} (Shift+F)`}>⛶ {t('全屏', 'Full')}</button>

      <details className="menu" ref={menuRef}>
        <summary className="btn">{t('文件 ▾', 'File ▾')}</summary>
        <div className="menu-pop">
          <button className="btn" onClick={() => { p.onExportPng(); if (menuRef.current) menuRef.current.open = false; }}>{t('导出图片', 'Export image')}</button>
          <button className="btn" onClick={() => { p.onExportJson(); if (menuRef.current) menuRef.current.open = false; }}>{t('导出方案 JSON', 'Export plan JSON')}</button>
          <button className="btn" onClick={() => { fileRef.current?.click(); if (menuRef.current) menuRef.current.open = false; }}>{t('导入方案', 'Import plan')}</button>
          <button className="btn danger" onClick={() => { p.onReset(); if (menuRef.current) menuRef.current.open = false; }}>{t('重置为默认方案', 'Reset to default')}</button>
        </div>
      </details>
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
