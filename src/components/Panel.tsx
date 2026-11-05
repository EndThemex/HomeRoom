import { useEffect, useState } from 'react';
import type { DesignState, Selection } from '../types';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { plan, roomById } from '../lib/plan';
import { areaOf, fmt, normAngle } from '../lib/geometry';

interface Props {
  store: DesignStore;
  state: DesignState;
  i18n: I18n;
  selection: Selection | null;
  onSelect: (s: Selection | null) => void;
  open: boolean;
  onClose: () => void;
}

const SWATCHES = ['#c9d6df', '#d8c7dc', '#e8d5b5', '#b7c4b0', '#c3cbd6', '#d6b99a', '#e2cfb4', '#efe6d8', '#e9e5de', '#eef1f3', '#4a4f55', '#1f1d1b'];

function Num({ label, value, unit, onCommit, step = 10 }: { label: string; value: number; unit?: string; onCommit: (v: number) => void; step?: number }) {
  const [v, setV] = useState(String(value));
  useEffect(() => { setV(String(value)); }, [value]);
  const apply = () => {
    const n = Number(v);
    if (Number.isFinite(n)) onCommit(n);
    else setV(String(value));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={v}
        step={step}
        onChange={(e) => setV(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      />
      {unit && <i>{unit}</i>}
    </label>
  );
}

export function Panel({ store, state, i18n, selection, onSelect, open, onClose }: Props) {
  const { nm, t } = i18n;
  const [nameDraft, setNameDraft] = useState('');

  const f = selection?.kind === 'furn' ? state.furniture.find((x) => x.id === selection.id) : null;
  const room = selection?.kind === 'room' ? roomById(selection.id) : null;
  const rs = room ? state.rooms[room.id] : null;

  useEffect(() => { setNameDraft(rs?.name ?? ''); }, [room?.id, rs?.name]);

  const patchFurn = (fn: (x: NonNullable<typeof f>) => void) => {
    if (!f) return;
    store.mutate(() => fn(f));
  };

  const netArea = plan.rooms.filter((r) => r.counted !== false).reduce((a, r) => a + areaOf(r.poly), 0);

  const roomCost = (id: string) => {
    const r = plan.rooms.find((x) => x.id === id)!;
    if (r.counted === false) return 0;
    const mat = plan.materials[state.rooms[id]?.mat ?? r.mat];
    return areaOf(r.poly) * 1.05 * mat.price;
  };
  const totalCost = plan.rooms.reduce((a, r) => a + roomCost(r.id), 0);

  return (
    <aside className={`panel props${open ? ' open' : ''}`}>
      <div className="panel-head">
        {f ? t('家具属性', 'Furniture') : room ? t('房间属性', 'Room') : t('方案总览', 'Overview')}
        <button className="btn close" onClick={onClose} title={t('收起面板', 'Hide panel')}>×</button>
      </div>

      {f && (
        <div className="propsbody">
          <div className="selname">{nm(f.name)}</div>
          <div className="tiny">{t('类型', 'Type')}: {f.type}</div>
          <div className="rowfields">
            <Num label={t('宽 W', 'Width W')} value={f.w} unit="mm" onCommit={(v) => patchFurn((x) => { x.w = Math.max(100, Math.round(v)); })} />
            <Num label={t('深 D', 'Depth D')} value={f.d} unit="mm" onCommit={(v) => patchFurn((x) => { x.d = Math.max(100, Math.round(v)); })} />
          </div>
          <div className="field">
            <span>{t('旋转', 'Rotation')} <b>{Math.round(f.rot)}°</b></span>
            <input type="range" min={0} max={359} step={1} value={f.rot} onChange={(e) => patchFurn((x) => { x.rot = +e.target.value; })} />
          </div>
          <div className="btnrow">
            <button className="btn" onClick={() => patchFurn((x) => { x.rot = normAngle(x.rot - 90); })}>{t('左转 90°', '−90°')}</button>
            <button className="btn" onClick={() => patchFurn((x) => { x.rot = normAngle(x.rot + 90); })}>{t('右转 90°', '＋90°')}</button>
          </div>
          <div className="field">
            <span>{t('颜色', 'Color')}</span>
            <div className="swatches">
              {SWATCHES.map((c) => (
                <button key={c} className={`sw${f.color.toLowerCase() === c ? ' on' : ''}`} style={{ background: c }} onClick={() => patchFurn((x) => { x.color = c; })} />
              ))}
            </div>
          </div>
          <div className="btnrow">
            <button
              className="btn"
              onClick={() => {
                const copy = { ...f, id: 'f' + Date.now().toString(36), cx: f.cx + 150, cy: f.cy + 150 };
                store.mutate((d) => { d.furniture.push(copy); });
                onSelect({ kind: 'furn', id: copy.id });
              }}
            >{t('复制', 'Duplicate')}</button>
            <button className="btn danger" onClick={() => {
              store.mutate((d) => { d.furniture = d.furniture.filter((x) => x.id !== f.id); });
              onSelect(null);
            }}>{t('删除', 'Delete')}</button>
          </div>
          <div className="hintbox">
            {t('可直接在平面图或 3D 中拖动家具；贴墙吸附开启时会自动靠墙。', 'Drag furniture on the plan or in 3D. Wall snap keeps it flush against walls.')}
          </div>
        </div>
      )}

      {room && rs && (
        <div className="propsbody">
          <label className="field">
            <span>{t('房间名称', 'Room name')}</span>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const v = nameDraft.trim();
                if (v && v !== rs.name) store.mutate((d) => { d.rooms[room.id].name = v; });
              }}
            />
          </label>
          <div className="statline">
            <span>{t('面积', 'Area')}</span><b>{fmt(areaOf(room.poly))} m²</b>
          </div>
          {room.counted === false && <div className="tiny">{t('飘窗 / 不参与套内面积统计', 'Bay window · excluded from net area')}</div>}

          <div className="field">
            <span>{t('地面材料', 'Floor material')}</span>
            <div className="matgrid">
              {Object.entries(plan.materials).map(([k, m]) => {
                const on = rs.mat === k;
                return (
                  <button key={k} className={`mat${on ? ' on' : ''}`} onClick={() => store.mutate((d) => { d.rooms[room.id].mat = k; })}>
                    <i className={on ? 'sw on' : 'sw'} style={{ background: m.swatch }} />
                    <em>{nm(m.name)}</em>
                    <small>¥{m.price}/m²</small>
                  </button>
                );
              })}
            </div>
          </div>

          {room.counted !== false && (
            <div className="statline">
              <span>{t('地面造价（含 5% 损耗）', 'Floor cost (+5% waste)')}</span>
              <b>¥{Math.round(roomCost(room.id)).toLocaleString()}</b>
            </div>
          )}
          <div className="hintbox">
            {t('更换材料会同步更新 3D 地面纹理与全屋造价。', 'Changing the material updates the 3D floor texture and total cost.')}
          </div>
        </div>
      )}

      {!f && !room && (
        <div className="propsbody">
          <div className="bigstat">
            <div><b>{fmt(netArea, 2)}</b><span>m²</span><em>{t('套内使用面积', 'Net floor area')}</em></div>
            <div><b>{state.furniture.length}</b><span>{t('件', 'pcs')}</span><em>{t('已放置家具', 'Furniture placed')}</em></div>
          </div>
          <div className="statline"><span>{t('房间数量', 'Rooms')}</span><b>{plan.rooms.filter((r) => r.counted !== false).length}</b></div>
          <div className="statline"><span>{t('地面材料总造价', 'Total floor cost')}</span><b>¥{Math.round(totalCost).toLocaleString()}</b></div>
          <div className="sect-title">{t('地面材料用量', 'Floor materials')}</div>
          <table className="costtable">
            <thead><tr><th>{t('房间', 'Room')}</th><th>{t('材料', 'Material')}</th><th>{t('造价', 'Cost')}</th></tr></thead>
            <tbody>
              {plan.rooms.filter((r) => r.counted !== false).map((r) => (
                <tr key={r.id} onClick={() => onSelect({ kind: 'room', id: r.id })}>
                  <td>{nm(state.rooms[r.id]?.name ?? r.name)}</td>
                  <td>{nm(plan.materials[state.rooms[r.id]?.mat ?? r.mat].name)}</td>
                  <td>¥{Math.round(roomCost(r.id)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="sect-title">{t('图例', 'Legend')}</div>
          <div className="legend">
            <div><i style={{ background: '#b8412c' }} />{t('承重墙（不可拆）', 'Bearing wall')}</div>
            <div><i style={{ background: '#a7a195' }} />{t('隔墙（可拆改）', 'Partition wall')}</div>
            <div><i style={{ background: '#8f897d' }} />{t('外墙', 'Exterior wall')}</div>
            <div><i style={{ background: '#e9e3d8' }} />{t('矮墙 / 半墙', 'Low wall')}</div>
            <div><i style={{ background: '#f7fbfd', border: '1px solid #4f7394' }} />{t('窗', 'Window')}</div>
            <div><i style={{ background: '#e2dacb' }} />{t('门洞 / 推拉门', 'Opening')}</div>
          </div>
          <div className="hintbox">
            {t('点击平面图空白处可取消选中；拖动家具、旋转、改尺寸都会实时存入浏览器本地。', 'Click empty space to deselect. Moves, rotations and sizes are saved locally.')}
          </div>
        </div>
      )}

      <div className="panelfoot">
        {t('方案自动保存在本浏览器', 'Auto-saved in this browser')}
      </div>
    </aside>
  );
}
