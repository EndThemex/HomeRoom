import { useEffect, useState } from 'react';
import type { DesignState, Selection, WallKind } from '../types';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { plan } from '../lib/plan';
import { areaOf, fmt, normAngle } from '../lib/geometry';
import { lineById, resizeWallLine, setLineKind, setLineThickness, deleteWallLine, deleteOpening } from '../lib/layoutOps';
import {
  clampWidth, moveOpening, resizeOpening, setDoorSwing,
  setOpeningSillHead, widthOf, widthRange,
} from '../lib/openings';

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
  const { nm, t, rn } = i18n;
  const [nameDraft, setNameDraft] = useState('');

  const f = selection?.kind === 'furn' ? state.furniture.find((x) => x.id === selection.id) : null;
  const room = selection?.kind === 'room' ? state.layout.rooms.find((x) => x.id === selection.id) : null;
  const wall = selection?.kind === 'wall' ? lineById(state.layout, selection.id) : null;
  const opening = selection && selection.kind !== 'furn' && selection.kind !== 'room' && selection.kind !== 'wall'
    ? state.layout.openings.find((x) => x.id === selection.id) ?? null
    : null;
  const opLine = opening ? lineById(state.layout, opening.lineId) : null;

  useEffect(() => { setNameDraft(room?.name ?? ''); }, [room?.id, room?.name]);

  const patchFurn = (fn: (x: NonNullable<typeof f>) => void) => {
    if (!f) return;
    store.mutate(() => fn(f));
  };

  const rooms = state.layout.rooms;
  const netArea = rooms.filter((r) => r.counted !== false).reduce((a, r) => a + areaOf(r.poly), 0);

  const roomCost = (r: NonNullable<typeof room>) => {
    if (r.counted === false) return 0;
    const mat = plan.materials[r.mat] ?? plan.materials.tile800;
    return areaOf(r.poly) * 1.05 * mat.price;
  };
  const totalCost = rooms.reduce((a, r) => a + roomCost(r), 0);

  const openingKindName = (kind: string) =>
    kind === 'door' ? t('门', 'Door') : kind === 'window' ? t('窗', 'Window') : t('推拉门', 'Sliding door');

  const title = f ? t('家具属性', 'Furniture')
    : room ? t('房间属性', 'Room')
      : wall ? t('墙线属性', 'Wall line')
        : opening ? t(`${openingKindName(opening.kind)}属性`, `${openingKindName(opening.kind)} properties`)
          : t('方案总览', 'Overview');

  const setOpeningSpanStart = (id: string, start: number) => {
    const o = state.layout.openings.find((x) => x.id === id);
    if (!o) return;
    const delta = start - o.span[0];
    store.mutateLayout((layout) => { moveOpening(layout, id, delta); });
  };

  return (
    <aside className={`panel props${open ? ' open' : ''}`}>
      <div className="panel-head">
        {title}
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

      {room && (
        <div className="propsbody">
          <label className="field">
            <span>{t('房间名称', 'Room name')}</span>
            <input
              value={nameDraft}
              onChange={(e) => setNameDraft(e.target.value)}
              onBlur={() => {
                const v = nameDraft.trim();
                if (v && v !== room.name) {
                  store.mutate((d) => {
                    const r = d.layout.rooms.find((x) => x.id === room.id);
                    if (r) { r.name = v; r.nameEn = v; }
                  });
                }
              }}
            />
          </label>
          <div className="statline">
            <span>{t('面积', 'Area')}</span><b>{fmt(areaOf(room.poly))} m²</b>
          </div>
          <label className="field">
            <span>{t('参与面积统计', 'Counted in net area')}</span>
            <input
              type="checkbox"
              checked={room.counted !== false}
              onChange={(e) => {
                const on = e.target.checked;
                store.mutate((d) => {
                  const r = d.layout.rooms.find((x) => x.id === room.id);
                  if (r) r.counted = on ? undefined : false;
                });
              }}
            />
          </label>

          <div className="field">
            <span>{t('地面材料', 'Floor material')}</span>
            <div className="matgrid">
              {Object.entries(plan.materials).map(([k, m]) => {
                const on = room.mat === k;
                return (
                  <button key={k} className={`mat${on ? ' on' : ''}`} onClick={() => store.mutate((d) => {
                    const r = d.layout.rooms.find((x) => x.id === room.id);
                    if (r) r.mat = k;
                  })}>
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
              <b>¥{Math.round(roomCost(room)).toLocaleString()}</b>
            </div>
          )}
          <div className="hintbox">
            {t('更换材料会同步更新 3D 地面纹理与全屋造价。', 'Changing the material updates the 3D floor texture and total cost.')}
          </div>
        </div>
      )}

      {wall && (
        <div className="propsbody">
          <div className="selname">{t('墙线', 'Wall line')} · {wall.id}</div>
          <div className="tiny">
            {wall.axis === 'h' ? t('水平墙', 'Horizontal') : t('垂直墙', 'Vertical')}
            {' · '}
            {state.layout.openings.filter((o) => o.lineId === wall.id).length} {t('个洞口', 'openings')}
          </div>
          <div className="rowfields">
            <Num
              label={t('墙长', 'Length')}
              value={wall.span[1] - wall.span[0]}
              unit="mm"
              step={100}
              onCommit={(v) => store.mutateLayout((layout) => {
                resizeWallLine(layout, wall.id, 'end', wall.span[0] + v);
              })}
            />
            <Num
              label={t('墙厚', 'Thickness')}
              value={Math.round(wall.band[1] - wall.band[0])}
              unit="mm"
              step={10}
              onCommit={(v) => store.mutateLayout((layout) => { setLineThickness(layout, wall.id, v); })}
            />
          </div>
          <div className="field">
            <span>{t('墙体类型', 'Wall type')}</span>
            <div className="btnrow">
              {([
                ['b', t('承重墙', 'Bearing'), '承重墙（不可拆）', 'Bearing (not removable)'],
                ['e', t('外墙', 'Exterior'), '外墙', 'Exterior wall'],
                ['n', t('隔墙', 'Partition'), '隔墙（可拆改）', 'Partition (removable)'],
                ['low', t('矮墙', 'Low'), '矮墙 / 半墙', 'Low wall'],
              ] as [WallKind, string, string, string][]).map(([kind, label, zh, en]) => (
                <button
                  key={kind}
                  className={`btn${wall.kind === kind ? ' on' : ''}`}
                  onClick={() => store.mutateLayout((layout) => { setLineKind(layout, wall.id, kind); })}
                  title={t(zh, en)}
                >{label}</button>
              ))}
            </div>
          </div>
          <div className="btnrow">
            <button
              className={`btn${state.demolishedLines.includes(wall.id) ? ' on' : ''}`}
              onClick={() => store.toggleDemolish(wall.id)}
            >
              {state.demolishedLines.includes(wall.id) ? t('恢复墙线', 'Restore') : t('拆改墙线', 'Demolish')}
            </button>
            <button className="btn danger" onClick={() => {
              store.mutateLayout((layout) => { deleteWallLine(layout, wall.id); });
              onSelect(null);
            }}>{t('删除墙线', 'Delete')}</button>
          </div>
          <div className="hintbox">
            {t('拖动端点改墙长，拖动侧面手柄改墙厚；承重墙不可拆改。', 'Drag endpoints to resize, side handle to change thickness. Bearing walls cannot be demolished.')}
          </div>
        </div>
      )}

      {opening && opLine && (
        <div className="propsbody">
          <div className="selname">{openingKindName(opening.kind)}</div>
          <div className="tiny">{t('所属墙线', 'Host line')}: {opLine.id} · {widthOf(opening)} mm</div>
          <div className="rowfields">
            <Num
              label={t('宽度', 'Width')}
              value={Math.round(widthOf(opening))}
              unit="mm"
              step={10}
              onCommit={(v) => store.mutateLayout((layout) => {
                const [lo, hi] = widthRange(opening.kind);
                const w = Math.max(lo, Math.min(hi, clampWidth(opening.kind, v)));
                resizeOpening(layout, opening.id, 'end', opening.span[0] + w);
              })}
            />
            <Num
              label={t('距墙起点', 'From line start')}
              value={Math.round(opening.span[0] - opLine.span[0])}
              unit="mm"
              step={10}
              onCommit={(v) => setOpeningSpanStart(opening.id, opLine.span[0] + v)}
            />
          </div>

          {opening.kind === 'window' && (
            <div className="rowfields">
              <Num label={t('窗台高', 'Sill')} value={opening.sill ?? 900} unit="mm" onCommit={(v) => store.mutateLayout((layout) => { setOpeningSillHead(layout, opening.id, v, undefined); })} />
              <Num label={t('窗顶高', 'Head')} value={opening.head ?? 2400} unit="mm" onCommit={(v) => store.mutateLayout((layout) => { setOpeningSillHead(layout, opening.id, undefined, v); })} />
            </div>
          )}

          {opening.kind === 'door' && (
            <>
              <div className="rowfields">
                <Num label={t('门高', 'Door height')} value={opening.head ?? 2100} unit="mm" onCommit={(v) => store.mutateLayout((layout) => { setOpeningSillHead(layout, opening.id, undefined, v); })} />
                <label className="field">
                  <span>{t('入户门', 'Entry door')}</span>
                  <input
                    type="checkbox"
                    checked={!!opening.entry}
                    onChange={(e) => {
                      const on = e.target.checked;
                      store.mutateLayout((layout) => {
                        layout.openings.forEach((o) => { o.entry = false; });
                        const o = layout.openings.find((x) => x.id === opening.id);
                        if (o) o.entry = on;
                      });
                    }}
                  />
                </label>
              </div>
              <div className="field">
                <span>{t('开启方向', 'Swing direction')}</span>
                <div className="btnrow">
                  {([
                    ['start', 1, t('起点内开', 'Start inward'), t('铰链在起点，向室内开', 'Hinge at start, opens inward')],
                    ['start', -1, t('起点外开', 'Start outward'), t('铰链在起点，向室外开', 'Hinge at start, opens outward')],
                    ['end', 1, t('终点内开', 'End inward'), t('铰链在终点，向室内开', 'Hinge at end, opens inward')],
                    ['end', -1, t('终点外开', 'End outward'), t('铰链在终点，向室外开', 'Hinge at end, opens outward')],
                  ] as ['start' | 'end', 1 | -1, string, string][]).map(([hinge, swing, label, desc]) => (
                    <button
                      key={`${hinge}${swing}`}
                      className={`btn${(opening.hingeEnd ?? 'start') === hinge && (opening.swing ?? 1) === swing ? ' on' : ''}`}
                      onClick={() => store.mutateLayout((layout) => { setDoorSwing(layout, opening.id, hinge, swing); })}
                      title={desc}
                    >{label}</button>
                  ))}
                </div>
              </div>
              <div className="hintbox">
                {t('门扇开向可一键切换四种状态；入户门在平面图与 3D 中都有标记。', 'Swing presets cover all four states. Entry doors are marked in 2D and 3D.')}
              </div>
            </>
          )}

          {opening.kind === 'slide' && (
            <div className="field">
              <span>{t('推拉面方向', 'Panel side')}</span>
              <div className="btnrow">
                <button className={`btn${opening.swing === 1 ? ' on' : ''}`} onClick={() => store.mutateLayout((layout) => { setDoorSwing(layout, opening.id, opening.hingeEnd ?? 'start', 1); })}>{t('正向', 'Side A')}</button>
                <button className={`btn${opening.swing === -1 ? ' on' : ''}`} onClick={() => store.mutateLayout((layout) => { setDoorSwing(layout, opening.id, opening.hingeEnd ?? 'start', -1); })}>{t('反向', 'Side B')}</button>
              </div>
            </div>
          )}

          <div className="btnrow">
            <button className="btn danger" onClick={() => {
              store.mutateLayout((layout) => { deleteOpening(layout, opening.id); });
              onSelect(null);
            }}>{t('删除洞口', 'Delete opening')}</button>
          </div>
        </div>
      )}

      {!f && !room && !wall && !opening && (
        <div className="propsbody">
          <div className="bigstat">
            <div><b>{fmt(netArea, 2)}</b><span>m²</span><em>{t('套内使用面积', 'Net floor area')}</em></div>
            <div><b>{state.furniture.length}</b><span>{t('件', 'pcs')}</span><em>{t('已放置家具', 'Furniture placed')}</em></div>
          </div>
          <div className="statline"><span>{t('房间数量', 'Rooms')}</span><b>{rooms.filter((r) => r.counted !== false).length}</b></div>
          <div className="statline"><span>{t('墙线 / 洞口', 'Wall lines / openings')}</span><b>{state.layout.lines.length} / {state.layout.openings.length}</b></div>
          <div className="statline"><span>{t('地面材料总造价', 'Total floor cost')}</span><b>¥{Math.round(totalCost).toLocaleString()}</b></div>
          <div className="sect-title">{t('地面材料用量', 'Floor materials')}</div>
          <table className="costtable">
            <thead><tr><th>{t('房间', 'Room')}</th><th>{t('材料', 'Material')}</th><th>{t('造价', 'Cost')}</th></tr></thead>
            <tbody>
              {rooms.filter((r) => r.counted !== false).map((r) => (
                <tr key={r.id} onClick={() => onSelect({ kind: 'room', id: r.id })}>
                  <td>{rn(r)}</td>
                  <td>{nm(plan.materials[r.mat]?.name ?? r.mat)}</td>
                  <td>¥{Math.round(roomCost(r)).toLocaleString()}</td>
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
