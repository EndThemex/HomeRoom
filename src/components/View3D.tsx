import { useEffect, useRef, useState } from 'react';
import type { CameraMode, Selection, ViewTransform } from '../types';
import type { MutableRefObject } from 'react';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { SceneManager } from '../three/scene';

interface Props {
  store: DesignStore;
  i18n: I18n;
  show: boolean;
  selection: Selection | null;
  viewRef: MutableRefObject<ViewTransform>;
  cameraMode: CameraMode;
  walkLocked: boolean;
  touchWalk: boolean;
  hint: string;
  onReady: (m: SceneManager | null) => void;
  onSelect: (s: Selection | null) => void;
  onCameraMode: (m: CameraMode) => void;
  onWalkLocked: (v: boolean) => void;
  onTouchWalk: (v: boolean) => void;
  onHint: (s: string) => void;
  onError: () => void;
}

export function View3D(p: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const mgrRef = useRef<SceneManager | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const joyRef = useRef<HTMLDivElement>(null);
  const joyId = useRef<number | null>(null);

  const pRef = useRef(p);
  pRef.current = p;

  useEffect(() => {
    if (!hostRef.current) return;
    const mgr = new SceneManager(hostRef.current, p.store, {
      getSelection: () => pRef.current.selection,
      onSelect: (s) => pRef.current.onSelect(s),
      getI18n: () => pRef.current.i18n,
      onCameraMode: (m) => pRef.current.onCameraMode(m),
      onHint: (s) => pRef.current.onHint(s),
      onWalkLocked: (v) => pRef.current.onWalkLocked(v),
      onTouchWalk: (v) => pRef.current.onTouchWalk(v),
    });
    mgrRef.current = mgr;
    p.onReady(mgr);
    return () => {
      mgr.dispose();
      mgrRef.current = null;
      p.onReady(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (mgrRef.current) mgrRef.current.setSelection(p.selection);
  }, [p.selection]);

  useEffect(() => {
    if (p.i18n.lang) mgrRef.current?.relang();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.i18n.lang]);

  useEffect(() => {
    if (p.cameraMode === 'walk' && !p.walkLocked && !p.touchWalk) {
      const onErr = () => {
        if (pRef.current.cameraMode === 'walk') mgrRef.current?.fallbackTouchWalk();
      };
      document.addEventListener('pointerlockerror', onErr);
      return () => document.removeEventListener('pointerlockerror', onErr);
    }
  }, [p.cameraMode, p.walkLocked, p.touchWalk]);

  const moveJoy = (clientX: number, clientY: number) => {
    const r = joyRef.current?.getBoundingClientRect();
    if (!r) return;
    const dx = (clientX - (r.left + r.width / 2)) / (r.width / 2);
    const dy = (clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy);
    const k = m > 1 ? 1 / m : 1;
    setKnob({ x: dx * k, y: dy * k });
    mgrRef.current?.setJoystick(dx * k, dy * k);
  };

  return (
    <div className={`view3d${p.show ? ' show' : ''}`} ref={hostRef} id="view3d">
      {!p.show && <div className="v3d-placeholder" />}

      <div className={`hint3d${p.show ? ' show' : ''}`}>{p.show ? p.hint : ''}</div>

      {p.show && p.cameraMode === 'walk' && !p.walkLocked && !p.touchWalk && (
        <div className="walkstart" onClick={() => mgrRef.current?.lockPointer()}>
          <div className="walkcard">
            <b>{p.i18n.t('进入第一人称漫游', 'Enter first-person walk')}</b>
            <span>{p.i18n.t('点击画面开始 · WASD 移动 · 鼠标转向 · Esc 暂停', 'Click to start · WASD to move · mouse to look · Esc to pause')}</span>
            <span className="tiny">{p.i18n.t('也可以拖动左下角摇杆在触屏设备上游览', 'On touch devices, use the joystick at bottom-left')}</span>
          </div>
        </div>
      )}

      {p.show && p.cameraMode === 'walk' && p.walkLocked && <div className="cross" />}

      {p.show && p.cameraMode === 'walk' && (
        <button className="btn walkexit" onClick={() => p.onCameraMode('orbit')} title={p.i18n.t('退出漫游', 'Exit walk')}>
          {p.i18n.t('退出漫游', 'Exit walk')}
        </button>
      )}

      {p.show && p.touchWalk && (
        <div
          className="joystick"
          ref={joyRef}
          onPointerDown={(e) => {
            joyId.current = e.pointerId;
            e.currentTarget.setPointerCapture(e.pointerId);
            moveJoy(e.clientX, e.clientY);
          }}
          onPointerMove={(e) => { if (joyId.current === e.pointerId) moveJoy(e.clientX, e.clientY); }}
          onPointerUp={(e) => {
            if (joyId.current !== e.pointerId) return;
            joyId.current = null;
            setKnob({ x: 0, y: 0 });
            mgrRef.current?.setJoystick(0, 0);
          }}
          onPointerCancel={() => {
            joyId.current = null;
            setKnob({ x: 0, y: 0 });
            mgrRef.current?.setJoystick(0, 0);
          }}
        >
          <span className="joyknob" style={{ transform: `translate(calc(-50% + ${knob.x * 38}px), calc(-50% + ${knob.y * 38}px))` }} />
        </div>
      )}
    </div>
  );
}
