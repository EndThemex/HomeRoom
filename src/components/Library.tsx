import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CatalogItem, Selection, ViewMode } from '../types';
import { plan } from '../lib/plan';
import type { I18n } from '../lib/i18n';
import { furnitureSvg } from './furnitureSvg';
import { areaOf, fmt } from '../lib/geometry';

interface Props {
  i18n: I18n;
  viewMode: ViewMode;
  selection: Selection | null;
  onDragStart: (item: CatalogItem, e: ReactPointerEvent) => void;
  onFlyRoom: (id: string) => void;
  onSelectRoom: (id: string) => void;
}

function Preview({ item }: { item: CatalogItem }) {
  return (
    <svg viewBox={`${-item.w / 2} ${-item.d / 2} ${item.w} ${item.d}`} width="54" height="40" preserveAspectRatio="xMidYMid meet">
      <g dangerouslySetInnerHTML={{ __html: furnitureSvg(item.type, item.w, item.d, item.color) }} />
    </svg>
  );
}

export function Library({ i18n, viewMode, selection, onDragStart, onFlyRoom, onSelectRoom }: Props) {
  const { nm, t } = i18n;
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [viewMode]);

  if (viewMode === '3d') {
    return (
      <aside className="panel lib open">
        <div className="panel-head">{t('房间列表', 'Rooms')}</div>
        <div className="roomlist" ref={scrollRef}>
          {plan.rooms.map((r) => (
            <button
              key={r.id}
              className={`roomitem${selection?.kind === 'room' && selection.id === r.id ? ' sel' : ''}`}
              onClick={() => onFlyRoom(r.id)}
              onDoubleClick={() => onSelectRoom(r.id)}
              title={t('点击飞到该房间', 'Click to fly to this room')}
            >
              <span>{nm(r.name)}</span>
              <small>{fmt(areaOf(r.poly))} m²</small>
            </button>
          ))}
        </div>
        <div className="lib-tip">
          {t('点击房间可飞到对应视角；切换到 2D 后可修改房间名称与地面材料。', 'Click a room to fly there. Switch to 2D to edit room names and floor materials.')}
        </div>
      </aside>
    );
  }

  return (
    <aside className="panel lib open">
      <div className="panel-head">
        {t('家具库', 'Furniture Library')}
        <span className="tiny">{t('拖到平面图上放置', 'Drag onto the plan')}</span>
      </div>
      <div className="libscroll" ref={scrollRef}>
        {plan.catalog.map((cat) => (
          <section key={cat.name} className="cat">
            <h4>{nm(cat.name)}</h4>
            <div className="items">
              {cat.items.map((it) => (
                <button
                  key={it.name}
                  className="item"
                  onPointerDown={(e) => { e.preventDefault(); onDragStart(it, e); }}
                  title={`${nm(it.name)} · ${it.w}×${it.d}`}
                >
                  <Preview item={it} />
                  <em>{nm(it.name)}</em>
                </button>
              ))}
            </div>
          </section>
        ))}
      </div>
      <div className="lib-tip">
        {t('拖动家具到平面图放置；按住可移动，Shift 自由旋转。', 'Drag furniture onto the plan · drag to move · Shift for free rotation.')}
      </div>
    </aside>
  );
}
