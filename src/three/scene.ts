import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import type { CameraMode, DesignState, Point, Selection, ViewTransform } from '../types';
import type { DesignStore } from '../lib/store';
import type { I18n } from '../lib/i18n';
import { plan } from '../lib/plan';
import { bboxOf, PX_MM } from '../lib/geometry';
import { snapMove } from '../lib/snap';
import { wallRectsOf } from '../lib/layoutOps';
import { doorRender, openingRect } from '../lib/openings';
import { buildFurniture } from './furnitureModels';
import { mat, setEnv } from './kit';

const FOV = 45;
const WAIT = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const TAP = matchMedia('(pointer:coarse)').matches ? 9 : 4;

interface Pose { t: THREE.Vector3; p: THREE.Vector3 }
interface DoorInst { pivot: THREE.Group; a0: number; a1: number; cur: number; open: boolean }

export interface SceneGlue {
  getSelection(): Selection | null;
  onSelect(sel: Selection | null): void;
  getI18n(): I18n;
  onCameraMode(mode: CameraMode): void;
  onHint(text: string): void;
  onWalkLocked(locked: boolean): void;
  onTouchWalk(on: boolean): void;
}

export class SceneManager {
  private host: HTMLElement;
  private store: DesignStore;
  private glue: SceneGlue;

  private inited = false;
  private active = false;
  private raf = 0;
  private anim: { t0: number; dur: number; fn: (t: number) => void; res: () => void } | null = null;
  private fly: { t0: number; dur: number; A: Pose; B: Pose } | null = null;

  private renderer!: THREE.WebGLRenderer;
  private labelRenderer!: CSS2DRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private orbit!: OrbitControls;
  private walkCtl!: PointerLockControls;
  private hemi!: THREE.HemisphereLight;
  private sun!: THREE.DirectionalLight;
  private ground!: THREE.Mesh;
  private glassMat!: THREE.MeshPhysicalMaterial;
  private wallMat!: THREE.MeshStandardMaterial;
  private capMat!: THREE.MeshStandardMaterial;
  private frameMat!: THREE.MeshStandardMaterial;

  private archFloor!: THREE.Group;
  private archUp!: THREE.Group;
  private furnG!: THREE.Group;
  private labelG!: THREE.Group;
  private lampG!: THREE.Group;

  private colliders: [number, number, number, number][] = [];
  private doors: DoorInst[] = [];
  private selKey = '';
  private selHelper: THREE.BoxHelper | null = null;
  private sigArch = '';
  private sigFurn = '';
  private sigLabels = '';
  private grow = 1;
  private furnGrow = 1;
  private savedView: ViewTransform = { x0: 0, y0: 0, s: 0.06 };
  private envTex: THREE.Texture | null = null;

  private opt = { cut: 2.8, furn: true, labels: true, night: false, hour: 10, mode: 'orbit' as CameraMode };
  private keys: Record<string, boolean> = {};
  private touchWalk = false;
  private joy = { x: 0, y: 0 };
  private look: { id: number; x: number; y: number } | null = null;
  private fdrag: { id: string; pid: number; sx: number; sy: number; ox: number; oy: number; before: string; moved: boolean } | null = null;
  private downAt: [number, number] | null = null;
  private readonly ray = new THREE.Raycaster();
  private readonly ptr = new THREE.Vector2();
  private readonly clock = new THREE.Clock();
  private unsubCommit: () => void;
  private dirtyAt = 0;

  constructor(host: HTMLElement, store: DesignStore, glue: SceneGlue) {
    this.host = host;
    this.store = store;
    this.glue = glue;
    this.bindKeys();
    // 提交事件合并为 200ms 内的单次重建，拖动过程不重建
    this.unsubCommit = this.store.subscribeCommit(() => {
      if (this.active) this.dirtyAt = performance.now();
    });
  }

  private get state(): DesignState { return this.store.getState(); }
  private wx(x: number) { return (x - this.state.layout.origin[0]) / 1000; }
  private wz(y: number) { return (y - this.state.layout.origin[1]) / 1000; }
  private get W() { return this.host.clientWidth || 1; }
  private get H() { return this.host.clientHeight || 1; }

  /* ---------------------------------- 初始化 ---------------------------------- */

  init() {
    if (this.inited) return;
    this.inited = true;
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2));
    r.setSize(this.W, this.H);
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.domElement.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;';
    this.host.prepend(r.domElement);
    this.renderer = r;

    this.labelRenderer = new CSS2DRenderer();
    this.labelRenderer.setSize(this.W, this.H);
    Object.assign(this.labelRenderer.domElement.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
    this.host.appendChild(this.labelRenderer.domElement);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(FOV, this.W / this.H, 0.05, 300);
    this.orbit = new OrbitControls(this.camera, r.domElement);
    this.orbit.enableDamping = true;
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 1.5;
    this.orbit.maxDistance = 45;

    this.walkCtl = new PointerLockControls(this.camera, document.body);
    this.walkCtl.addEventListener('lock', () => {
      this.glue.onWalkLocked(true);
      this.glue.onHint(this.hintWalk());
    });
    this.walkCtl.addEventListener('unlock', () => {
      if (this.opt.mode !== 'walk') return;
      this.glue.onWalkLocked(false);
    });

    this.hemi = new THREE.HemisphereLight(0xfff8ee, 0xb9a88f, 1.1);
    this.sun = new THREE.DirectionalLight(0xfff1dd, 2.6);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.setScalar(matchMedia('(pointer:coarse)').matches ? 2048 : 4096);
    Object.assign(this.sun.shadow.camera, { left: -11, right: 11, top: 11, bottom: -11, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshStandardMaterial({ color: 0xf2eee7, roughness: 1 }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.015;
    this.ground.receiveShadow = true;
    this.scene.add(this.hemi, this.sun, this.sun.target, this.ground);

    const pm = new THREE.PMREMGenerator(r);
    this.envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    pm.dispose();
    setEnv(this.envTex, 1);

    this.glassMat = new THREE.MeshPhysicalMaterial({ color: 0xcfe6ef, roughness: 0.05, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide });
    this.wallMat = mat('#f4f1eb', { roughness: 0.92 });
    this.capMat = mat('#34312d', { roughness: 0.9 });
    this.frameMat = mat('#5d6166', { roughness: 0.5, metalness: 0.4 });

    this.archFloor = new THREE.Group();
    this.archUp = new THREE.Group();
    this.furnG = new THREE.Group();
    this.labelG = new THREE.Group();
    this.lampG = new THREE.Group();
    this.scene.add(this.archFloor, this.archUp, this.furnG, this.labelG, this.lampG);

    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.host);
  }

  private bindKeys() {
    addEventListener('keydown', (e) => {
      if (!this.active || (e.target as HTMLElement).matches('input,select,textarea')) return;
      this.keys[e.code] = true;
      if (this.opt.mode === 'walk' && e.code === 'KeyE') {
        const h = this.pick();
        if (h?.door && h.dist < 2.5) h.door.open = !h.door.open;
      }
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
  }

  private bindPointer() {
    const cv = this.renderer.domElement;
    cv.addEventListener('pointerdown', (e) => {
      this.downAt = [e.clientX, e.clientY];
      if (this.touchWalk && !this.look) {
        this.look = { id: e.pointerId, x: e.clientX, y: e.clientY };
        cv.setPointerCapture(e.pointerId);
      }
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.look || e.pointerId !== this.look.id) return;
      this.lookBy(e.clientX - this.look.x, e.clientY - this.look.y);
      this.look.x = e.clientX;
      this.look.y = e.clientY;
    });
    const endLook = (e: PointerEvent) => { if (this.look?.id === e.pointerId) this.look = null; };
    cv.addEventListener('pointercancel', endLook);

    this.host.addEventListener('pointerdown', (e) => {
      if (e.target !== cv || !e.isPrimary || this.anim || this.opt.mode !== 'orbit') return;
      const sel = this.glue.getSelection();
      if (sel?.kind !== 'furn') return;
      const h = this.pick(e);
      const f = h?.fid === sel.id ? this.state.furniture.find((x) => x.id === sel.id) : null;
      const g = f && this.groundAt(e.clientX, e.clientY);
      if (!f || !g) return;
      this.fdrag = { id: f.id, pid: e.pointerId, sx: e.clientX, sy: e.clientY, ox: g.x - f.cx, oy: g.y - f.cy, before: this.store.snapshot(), moved: false };
      this.orbit.enabled = false;
      this.fly = null;
      cv.setPointerCapture(e.pointerId);
    }, true);

    cv.addEventListener('pointermove', (e) => {
      const d = this.fdrag;
      if (!d || e.pointerId !== d.pid) return;
      if (!d.moved && Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < TAP) return;
      const f = this.state.furniture.find((x) => x.id === d.id);
      const g = this.groundAt(e.clientX, e.clientY);
      if (!f || !g) return;
      d.moved = true;
      cv.style.cursor = 'grabbing';
      const [cx, cy] = snapMove(f, g.x - d.ox, g.y - d.oy, this.snapRects(), true, 1 / (g.s * PX_MM));
      this.store.applyTransient(() => { f.cx = cx; f.cy = cy; });
      this.furnG.children.find((o) => o.userData.fid === f.id)?.position.set(this.wx(f.cx), 0, this.wz(f.cy));
    });

    const endF = (e: PointerEvent) => {
      const d = this.fdrag;
      if (!d || e.pointerId !== d.pid) return;
      this.fdrag = null;
      this.orbit.enabled = true;
      cv.style.cursor = '';
      if (d.moved) { this.store.commit(d.before); this.sync(); }
    };
    cv.addEventListener('pointerup', endF);
    cv.addEventListener('pointercancel', endF);

    cv.addEventListener('pointerup', (e) => {
      const tap = this.downAt && Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]) <= TAP;
      if (this.look?.id === e.pointerId) {
        this.look = null;
        if (tap) {
          const h = this.pick(e);
          if (h?.door && h.dist < 3.5) h.door.open = !h.door.open;
        }
        return;
      }
      if (this.anim || this.opt.mode !== 'orbit' || !tap) return;
      const h = this.pick(e);
      if (h?.door) h.door.open = !h.door.open;
      else if (h?.fid) this.glue.onSelect({ kind: 'furn', id: h.fid });
      else if (h?.room) this.glue.onSelect({ kind: 'room', id: h.room });
      else this.glue.onSelect(null);
    });
  }

  resize() {
    if (!this.inited) return;
    this.renderer.setSize(this.W, this.H);
    this.labelRenderer.setSize(this.W, this.H);
    this.camera.aspect = this.W / this.H;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------------------------- 进入 / 退出 ---------------------------------- */

  async enter(view: ViewTransform) {
    this.init();
    this.savedView = { ...view };
    this.active = true;
    this.resize();
    this.sync(true);
    this.opt.mode = 'orbit';
    this.glue.onCameraMode('orbit');
    this.orbit.enabled = false;
    this.showLabels(false);
    const A = this.planPose();
    const B = this.isoFrom(A);
    this.grow = 0;
    this.furnGrow = 0;
    this.applyGrow();
    this.setPose(A);
    this.startLoop();
    this.renderer.render(this.scene, this.camera);
    await WAIT(380);
    await this.animate(1700, (t) => {
      this.camTween(A, B, ease(clamp01(t / 0.85)));
      this.grow = ease(clamp01((t - 0.1) / 0.55));
      this.furnGrow = ease(clamp01((t - 0.45) / 0.5));
      this.applyGrow();
    });
    this.orbit.enabled = true;
    this.showLabels(this.opt.labels);
  }

  async exit() {
    if (!this.active) return;
    if (this.opt.mode === 'walk') {
      this.walkCtl.unlock();
      this.stopTouchWalk();
      const dir = new THREE.Vector3();
      this.camera.getWorldDirection(dir);
      this.orbit.target.copy(this.camera.position).addScaledVector(dir, 3).setY(0);
      this.opt.mode = 'orbit';
      this.glue.onCameraMode('orbit');
    }
    this.fly = null;
    this.orbit.enabled = false;
    this.showLabels(false);
    const A = this.curPose();
    const B = this.planPose();
    await this.animate(1300, (t) => {
      this.camTween(A, B, ease(clamp01((t - 0.1) / 0.9)));
      this.furnGrow = 1 - ease(clamp01(t / 0.45));
      this.grow = 1 - ease(clamp01((t - 0.2) / 0.6));
      this.applyGrow();
    });
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.grow = this.furnGrow = 1;
    this.applyGrow();
  }

  /* ---------------------------------- 同步 ---------------------------------- */

  sync(force = false) {
    if (!this.inited || (!this.active && !force)) return;
    const a = JSON.stringify([this.state.layout, this.state.demolishedLines, this.opt.cut, this.state.measures]);
    const f = JSON.stringify(this.state.furniture);
    const l = JSON.stringify([this.state.layout.rooms, this.opt.cut, this.glue.getI18n().lang]);
    if (force || a !== this.sigArch) { this.sigArch = a; this.buildArch(); }
    if (force || f !== this.sigFurn) { this.sigFurn = f; this.buildFurn(); }
    if (force || l !== this.sigLabels) { this.sigLabels = l; this.buildLabels(); }
    this.updateSel();
  }

  private clearGroup(g: THREE.Group) {
    g.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
    });
    g.clear();
  }

  private snapRects() {
    const doc = this.state.layout;
    const walls = wallRectsOf(doc, this.state.demolishedLines);
    const wins = doc.openings.filter((o) => o.kind === 'window' && !this.state.demolishedLines.includes(o.lineId)).flatMap((o) => {
      const line = doc.lines.find((l) => l.id === o.lineId);
      if (!line) return [];
      const [x0, y0, x1, y1] = openingRect(line, o);
      return [{ x0, y0, x1, y1 }];
    });
    return [...walls, ...wins];
  }

  /* ---------------------------------- 地面材质 ---------------------------------- */

  private floorMats: Record<string, THREE.MeshStandardMaterial> = {};

  private floorMat(kind: string) {
    if (this.floorMats[kind]) return this.floorMats[kind];
    const m = plan.materials[kind] ?? plan.materials.tile800;
    const s = m.tex;
    const wood = kind === 'wood' || kind === 'walnut';
    const cv = document.createElement('canvas');
    cv.width = wood ? 1024 : 512;
    cv.height = wood ? 205 : 512;
    const g = cv.getContext('2d')!;
    const W = cv.width;
    const Hh = cv.height;
    g.fillStyle = s.base;
    g.fillRect(0, 0, W, Hh);

    const R = mulberry(kind.length * 977 + 13);
    const shadeRgb = (hex: string, k: number) => {
      const n = parseInt(hex.slice(1), 16);
      const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
      return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
    };

    if (wood) {
      const rowH = Hh / 2;
      const joints = [[W * 2 / 3], [W / 3]];
      for (let r = 0; r < 2; r++) {
        let x0 = 0;
        [...joints[r], W].forEach((x1) => {
          g.fillStyle = shadeRgb(s.base, 0.9 + R() * 0.2);
          g.fillRect(x0, r * rowH, x1 - x0, rowH);
          g.strokeStyle = shadeRgb(s.base, 0.8);
          g.globalAlpha = 0.35;
          g.lineWidth = 1.2;
          for (let k = 0; k < 7; k++) {
            const y = r * rowH + 6 + R() * (rowH - 12);
            g.beginPath();
            g.moveTo(x0, y);
            for (let x = x0; x <= x1; x += 40) g.lineTo(x, y + Math.sin(x * 0.02 + k) * 2.5);
            g.stroke();
          }
          g.globalAlpha = 1;
          g.fillStyle = shadeRgb(s.base, 0.62);
          g.fillRect(x1 - 1.5, r * rowH, 3, rowH);
          x0 = x1;
        });
        g.fillStyle = shadeRgb(s.base, 0.62);
        g.fillRect(0, r * rowH, W, 2.5);
      }
    } else if (kind === 'marble') {
      g.strokeStyle = 'rgba(160,150,135,.35)';
      for (let k = 0; k < 6; k++) {
        g.lineWidth = 1 + R() * 3;
        g.beginPath();
        g.moveTo(R() * W, 0);
        g.bezierCurveTo(R() * W, R() * Hh, R() * W, R() * Hh, R() * W, Hh);
        g.stroke();
      }
    } else if (kind === 'terrazzo') {
      const cs = ['#b9a58c', '#8fa3a0', '#c9b7a2', '#a88f76', '#7e8a86'];
      for (let k = 0; k < 160; k++) {
        g.fillStyle = cs[k % 5];
        g.beginPath();
        g.arc(R() * W, R() * Hh, 2 + R() * 7, 0, 7);
        g.fill();
      }
    } else {
      for (let k = 0; k < 1500; k++) {
        g.fillStyle = `rgba(0,0,0,${R() * 0.04})`;
        g.fillRect(R() * W, R() * Hh, 2, 2);
      }
    }
    if (s.grout) {
      g.fillStyle = s.grout;
      g.fillRect(0, 0, W, 3);
      g.fillRect(0, 0, 3, Hh);
    }
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1 / s.u, 1 / s.v);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const fm = new THREE.MeshStandardMaterial({ map: t, roughness: m.tex.rough });
    this.floorMats[kind] = fm;
    return fm;
  }

  /* ---------------------------------- 建筑 ---------------------------------- */

  private wallBox([x0, y0, x1, y1]: [number, number, number, number], yb: number, yt: number) {
    if (yt - yb <= 0.001) return;
    const o = new THREE.Mesh(
      new THREE.BoxGeometry((x1 - x0) / 1000, yt - yb, (y1 - y0) / 1000),
      [this.wallMat, this.wallMat, this.capMat, this.wallMat, this.wallMat, this.wallMat],
    );
    o.position.set(this.wx((x0 + x1) / 2), (yb + yt) / 2, this.wz((y0 + y1) / 2));
    o.castShadow = o.receiveShadow = true;
    this.archUp.add(o);
    const ln = new THREE.LineSegments(new THREE.EdgesGeometry(o.geometry), this.edgeMat);
    ln.position.copy(o.position);
    ln.userData.walkOnly = true;
    ln.visible = this.opt.mode === 'walk';
    this.archUp.add(ln);
    if (yb <= 0.001) {
      const p = o.geometry.parameters;
      const sh = Math.min(0.12, yt);
      const sk = new THREE.Mesh(new THREE.BoxGeometry(p.width + 0.02, sh, p.depth + 0.02), this.skirtMat);
      sk.position.set(o.position.x, sh / 2, o.position.z);
      sk.userData.walkOnly = true;
      sk.visible = this.opt.mode === 'walk';
      this.archUp.add(sk);
    }
  }

  private edgeMat = new THREE.LineBasicMaterial({ color: 0x6f675b });
  private skirtMat = new THREE.MeshStandardMaterial({ color: '#8b7f6e', roughness: 0.6 });

  private shapeOf(poly: Point[], flip = false) {
    const s = new THREE.Shape();
    poly.forEach(([x, y], i) => {
      const px = this.wx(x);
      const pz = flip ? this.wz(y) : -this.wz(y);
      if (i) s.lineTo(px, pz);
      else s.moveTo(px, pz);
    });
    return s;
  }

  private buildArch() {
    this.clearGroup(this.archFloor);
    this.clearGroup(this.archUp);
    this.lampG.clear();
    this.doors.length = 0;
    this.colliders = [];
    const top = this.opt.cut;
    const doc = this.state.layout;
    const fh = doc.floorHeight;
    const lineOf = (lineId: string) => doc.lines.find((l) => l.id === lineId) ?? null;
    const live = (lineId: string) => !this.state.demolishedLines.includes(lineId);

    doc.rooms.forEach((r) => {
      const fm = this.floorMat(r.mat);
      const bay = r.counted === false;
      const geo = bay
        ? new THREE.ExtrudeGeometry(this.shapeOf(r.poly), { depth: 0.45, bevelEnabled: false })
        : new THREE.ShapeGeometry(this.shapeOf(r.poly));
      geo.rotateX(-Math.PI / 2);
      const fl = new THREE.Mesh(geo, bay ? [fm, mat('#e9e4da')] : fm);
      fl.receiveShadow = true;
      fl.userData.room = r.id;
      if (bay) {
        fl.castShadow = true;
        this.archUp.add(fl);
      } else {
        this.archFloor.add(fl);
      }

      const cg = new THREE.ShapeGeometry(this.shapeOf(r.poly, true));
      cg.rotateX(Math.PI / 2);
      const ceil = new THREE.Mesh(cg, mat('#fbfaf7', { roughness: 1 }));
      ceil.position.y = fh;
      ceil.visible = top >= fh;
      this.archUp.add(ceil);

      if (r.labelAt) {
        const lamp = new THREE.Mesh(
          new THREE.CylinderGeometry(0.22, 0.22, 0.02, 32),
          new THREE.MeshStandardMaterial({ color: '#fff', emissive: '#fff2d6', emissiveIntensity: 0.3 }),
        );
        lamp.position.set(this.wx(r.labelAt[0]), fh - 0.012, this.wz(r.labelAt[1]));
        lamp.visible = top >= fh;
        this.lampG.add(lamp);
        const pl = new THREE.PointLight(0xffd9a8, 0, 7, 1.6);
        pl.position.set(this.wx(r.labelAt[0]), fh - 0.25, this.wz(r.labelAt[1]));
        this.lampG.add(pl);
      }
    });

    // 门洞 / 推拉门地面过门石
    doc.openings.filter((o) => o.kind !== 'window' && live(o.lineId)).forEach((o) => {
      const line = lineOf(o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      const s = new THREE.Mesh(
        new THREE.BoxGeometry((x1 - x0) / 1000, 0.012, (y1 - y0) / 1000),
        mat('#d8d0c0', { roughness: 0.3 }),
      );
      s.position.set(this.wx((x0 + x1) / 2), 0, this.wz((y0 + y1) / 2));
      this.archFloor.add(s);
    });

    wallRectsOf(doc, this.state.demolishedLines).forEach((w) => {
      this.wallBox([w.x0, w.y0, w.x1, w.y1], 0, w.kind === 'low' ? Math.min(1, top) : top);
      this.colliders.push([this.wx(w.x0), this.wz(w.y0), this.wx(w.x1), this.wz(w.y1)]);
    });

    // 门洞 / 推拉门 上方的过梁
    doc.openings.filter((o) => o.kind !== 'window' && live(o.lineId)).forEach((o) => {
      const line = lineOf(o.lineId);
      if (!line) return;
      const rect = openingRect(line, o);
      const headM = (o.head ?? (o.kind === 'slide' ? 2400 : 2100)) / 1000;
      if (top > headM) this.wallBox(rect, headM, top);
    });
    doc.rooms.filter((r) => r.counted === false).forEach((r) => {
      const [x0, y0, x1, y1] = bboxOf(r.poly);
      if (top > 2.4) this.wallBox([x0, y0, x1, y1], 2.4, top);
    });

    doc.openings.filter((o) => o.kind === 'window' && live(o.lineId)).forEach((o) => {
      const line = lineOf(o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      const sill = (o.sill ?? 900) / 1000;
      const head = (o.head ?? 2400) / 1000;
      this.wallBox([x0, y0, x1, y1], 0, Math.min(sill, top));
      if (top > head) this.wallBox([x0, y0, x1, y1], head, top);
      this.colliders.push([this.wx(x0), this.wz(y0), this.wx(x1), this.wz(y1)]);
      const gTop = Math.min(head, top);
      if (gTop <= sill) return;
      const hz = x1 - x0 >= y1 - y0;
      const L = (hz ? x1 - x0 : y1 - y0) / 1000;
      const gh = gTop - sill;
      const cx = this.wx((x0 + x1) / 2);
      const cz = this.wz((y0 + y1) / 2);
      const pane = new THREE.Mesh(new THREE.BoxGeometry(hz ? L : 0.01, gh, hz ? 0.01 : L), this.glassMat);
      pane.position.set(cx, sill + gh / 2, cz);
      this.archUp.add(pane);
      const n = Math.max(1, Math.round(L / 0.9));
      for (let k = 0; k <= n; k++) {
        const t = -L / 2 + k * L / n;
        const mu = new THREE.Mesh(new THREE.BoxGeometry(hz ? 0.04 : 0.06, gh, hz ? 0.06 : 0.04), this.frameMat);
        mu.position.set(cx + (hz ? t : 0), sill + gh / 2, cz + (hz ? 0 : t));
        mu.castShadow = true;
        this.archUp.add(mu);
      }
      [sill + 0.02, gTop - 0.02].forEach((y) => {
        const tr = new THREE.Mesh(new THREE.BoxGeometry(hz ? L : 0.06, 0.04, hz ? 0.06 : L), this.frameMat);
        tr.position.set(cx, y, cz);
        this.archUp.add(tr);
      });
    });

    doc.openings.filter((o) => o.kind === 'door' && live(o.lineId)).forEach((o) => {
      const line = lineOf(o.lineId);
      if (!line) return;
      const d = doorRender(line, o);
      const pivot = new THREE.Group();
      const L = d.len / 1000;
      const dh = Math.min(2.05, top);
      pivot.position.set(this.wx(d.hinge[0]), 0, this.wz(d.hinge[1]));
      const leaf = new THREE.Mesh(
        new THREE.BoxGeometry(L, dh, 0.04),
        mat(d.entry ? '#6b4f3a' : '#efe6d8', { roughness: 0.5 }),
      );
      leaf.position.set(L / 2, dh / 2, 0);
      leaf.castShadow = leaf.receiveShadow = true;
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.03, 12, 8), mat('#cfd2d4', { metalness: 0.9, roughness: 0.25 }));
      knob.position.set(L - 0.07, Math.min(1, dh - 0.05), 0);
      knob.scale.z = 2.2;
      pivot.add(leaf, knob);
      const ang = (v: Point) => Math.atan2(-v[1], v[0]);
      const door: DoorInst = { pivot, a0: ang(d.closedDir), a1: ang(d.openDir), cur: 0, open: true };
      if (door.a1 - door.a0 > Math.PI) door.a1 -= Math.PI * 2;
      if (door.a0 - door.a1 > Math.PI) door.a1 += Math.PI * 2;
      door.cur = door.a1;
      pivot.rotation.y = door.cur;
      leaf.userData.door = knob.userData.door = door;
      this.doors.push(door);
      this.archUp.add(pivot);
    });

    doc.openings.filter((o) => o.kind === 'slide' && live(o.lineId)).forEach((o) => {
      const line = lineOf(o.lineId);
      if (!line) return;
      const [x0, y0, x1, y1] = openingRect(line, o);
      const v = line.axis === 'v';
      const L = (v ? y1 - y0 : x1 - x0) / 1000;
      const ph = Math.min((o.head ?? 2400) / 1000, top);
      const pl = L * 0.55;
      const dir = o.swing ?? 1;
      [[-1, -0.02 * dir], [1, 0.02 * dir]].forEach(([s, off]) => {
        const c = s < 0 ? -L / 2 + pl / 2 : L / 2 - pl / 2;
        const x = v ? this.wx((x0 + x1) / 2) + off : this.wx(x0) + L / 2 + c;
        const z = v ? this.wz(y0) + L / 2 + c : this.wz((y0 + y1) / 2) + off;
        const p = new THREE.Mesh(new THREE.BoxGeometry(v ? 0.02 : pl, ph, v ? pl : 0.02), this.glassMat);
        p.position.set(x, ph / 2, z);
        this.archUp.add(p);
        [ph - 0.03, 0.03].forEach((y) => {
          const fr = new THREE.Mesh(new THREE.BoxGeometry(v ? 0.04 : pl, 0.05, v ? pl : 0.04), this.frameMat);
          fr.position.set(x, y, z);
          this.archUp.add(fr);
        });
        [-1, 1].forEach((e) => {
          const fr = new THREE.Mesh(new THREE.BoxGeometry(0.04, ph, 0.04), this.frameMat);
          fr.position.set(v ? x : x + e * pl / 2, ph / 2, v ? z + e * pl / 2 : z);
          this.archUp.add(fr);
        });
      });
    });

    this.applyLight();
    this.applyGrow();
  }

  private buildFurn() {
    this.clearGroup(this.furnG);
    this.state.furniture.forEach((f) => {
      const g = buildFurniture(f);
      g.position.set(this.wx(f.cx), 0, this.wz(f.cy));
      g.rotation.y = -f.rot * Math.PI / 180;
      g.userData.fid = f.id;
      this.furnG.add(g);
    });
    this.furnG.visible = this.opt.furn;
    this.selKey = '';
    this.applyGrow();
  }

  private buildLabels() {
    this.labelG.children.slice().forEach((o) => {
      const el = (o as CSS2DObject).element;
      el?.remove();
      this.labelG.remove(o);
    });
    const { rn } = this.glue.getI18n();
    this.state.layout.rooms.filter((r) => r.labelAt).forEach((r) => {
      const el = document.createElement('div');
      el.className = 'rlabel';
      el.innerHTML = `${escapeHtml(rn(r))}<small>${areaOf(r.poly).toFixed(1)}m²</small>`;
      const o = new CSS2DObject(el);
      o.position.set(this.wx(r.labelAt![0]), this.opt.cut + 0.15, this.wz(r.labelAt![1]));
      o.visible = this.labelG.visible;
      this.labelG.add(o);
    });
  }

  private showLabels(v: boolean) {
    this.labelG.visible = v;
    this.labelG.children.forEach((o) => { o.visible = v; });
  }

  private applyGrow() {
    if (!this.inited) return;
    this.archUp.scale.y = Math.max(this.grow, 0.001);
    this.furnG.scale.y = Math.max(this.furnGrow, 0.001);
    this.lampG.visible = this.grow > 0.99;
  }

  /* ---------------------------------- 灯光 ---------------------------------- */

  private applyLight() {
    const o = this.opt;
    const t = (o.hour - 6) / 12;
    const az = Math.PI * (0.15 + t * 0.7);
    const el = Math.sin(Math.PI * t) * 1.05 + 0.15;
    const warm = 1 - Math.sin(Math.PI * t);
    this.sun.position.set(Math.cos(az) * 18, Math.sin(el) * 20 + 3, -Math.sin(az) * 10 + 8);
    this.sun.target.position.set(0, 0, 0);
    this.sun.color.setHSL(0.09, 0.5 + warm * 0.4, 0.92 - warm * 0.12);
    this.sun.intensity = o.night ? 0.05 : 1.4 + Math.sin(Math.PI * t) * 1.6;
    this.hemi.intensity = o.night ? 0.12 : 1.1;
    this.scene.background = new THREE.Color(o.night ? 0x1c2130 : 0xf7f4ee);
    (this.ground.material as THREE.MeshStandardMaterial).color.set(o.night ? 0x2a2e38 : 0xf2eee7);
    this.lampG.children.forEach((x) => {
      if ((x as THREE.PointLight).isPointLight) (x as THREE.PointLight).intensity = o.night ? 6 : 0;
      else ((x as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = o.night ? 2 : 0.3;
    });
    this.renderer.toneMappingExposure = o.night ? 1.25 : 1.05;
    setEnv(this.envTex, o.night ? 0.15 : 1);
  }

  /* ---------------------------------- 相机 ---------------------------------- */

  private planPose(): Pose {
    const v = this.savedView;
    const cx = v.x0 + this.W / 2 / v.s;
    const cy = v.y0 + this.H / 2 / v.s;
    const visH = this.H / v.s / 1000;
    const dist = visH / 2 / Math.tan(FOV / 2 * Math.PI / 180);
    const t = new THREE.Vector3(this.wx(cx), 0, this.wz(cy));
    return { t, p: new THREE.Vector3(t.x, dist, t.z + 1e-4) };
  }

  private isoFrom(P: Pose): Pose {
    const d = THREE.MathUtils.clamp(P.p.y, 5, 30);
    const dir = new THREE.Vector3(0.3, 0.82, 0.49).normalize();
    return { t: P.t.clone(), p: P.t.clone().addScaledVector(dir, d) };
  }

  private isoWhole(): Pose {
    return { t: new THREE.Vector3(0, 0, 0), p: new THREE.Vector3(5.5, 15.5, 10) };
  }

  private topWhole(): Pose {
    return { t: new THREE.Vector3(0, 0, 0), p: new THREE.Vector3(0, 19, 1e-4) };
  }

  private curPose(): Pose {
    return { t: this.orbit.target.clone(), p: this.camera.position.clone() };
  }

  private camTween(A: Pose, B: Pose, e: number) {
    const t = A.t.clone().lerp(B.t, e);
    const sa = new THREE.Spherical().setFromVector3(A.p.clone().sub(A.t));
    const sb = new THREE.Spherical().setFromVector3(B.p.clone().sub(B.t));
    let dth = sb.theta - sa.theta;
    dth = Math.atan2(Math.sin(dth), Math.cos(dth));
    const s = new THREE.Spherical(sa.radius + (sb.radius - sa.radius) * e, sa.phi + (sb.phi - sa.phi) * e, sa.theta + dth * e);
    this.camera.position.copy(t).add(new THREE.Vector3().setFromSpherical(s));
    this.camera.lookAt(t);
    this.orbit.target.copy(t);
  }

  private setPose(P: Pose) {
    this.camera.position.copy(P.p);
    this.orbit.target.copy(P.t);
    this.camera.lookAt(P.t);
  }

  private animate(dur: number, fn: (t: number) => void) {
    return new Promise<void>((res) => { this.anim = { t0: performance.now(), dur, fn, res }; });
  }

  private flyTo(B: Pose, dur = 900) {
    this.fly = { t0: performance.now(), dur, A: this.curPose(), B };
  }

  flyRoom(id: string) {
    if (!this.active || this.anim) return;
    const r = this.state.layout.rooms.find((x) => x.id === id);
    if (!r) return;
    if (this.opt.mode === 'walk') this.setCameraMode('orbit');
    const xs = r.poly.map((p) => p[0]);
    const ys = r.poly.map((p) => p[1]);
    const t = new THREE.Vector3(this.wx((Math.min(...xs) + Math.max(...xs)) / 2), 0.6, this.wz((Math.min(...ys) + Math.max(...ys)) / 2));
    const size = Math.max(...xs) - Math.min(...xs) >= Math.max(...ys) - Math.min(...ys)
      ? (Math.max(...xs) - Math.min(...xs)) / 1000
      : (Math.max(...ys) - Math.min(...ys)) / 1000;
    const dir = this.camera.position.clone().sub(this.orbit.target).setY(0);
    if (dir.lengthSq() < 0.01) dir.set(0.6, 0, 0.8);
    dir.normalize();
    const dist = size * 1.3 + 2.2;
    this.flyTo({ t, p: new THREE.Vector3(t.x + dir.x * dist * 0.7, dist * 1.05, t.z + dir.z * dist * 0.7) });
  }

  flyIso() {
    if (!this.active || this.anim) return;
    if (this.opt.mode === 'walk') this.setCameraMode('orbit');
    this.flyTo(this.isoWhole());
  }

  flyTop() {
    if (!this.active || this.anim) return;
    if (this.opt.mode === 'walk') this.setCameraMode('orbit');
    this.flyTo(this.topWhole());
  }

  /* ---------------------------------- 拾取 / 拖放 ---------------------------------- */

  private pick(e?: PointerEvent | null) {
    if (!e) this.ptr.set(0, 0);
    else {
      const r = this.renderer.domElement.getBoundingClientRect();
      this.ptr.set((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1);
    }
    this.ray.setFromCamera(this.ptr, this.camera);
    const hits = this.ray.intersectObjects([...(this.opt.furn ? [this.furnG] : []), this.archUp, this.archFloor], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      if ((o as THREE.Mesh).material === this.glassMat) continue;
      if (o.userData.door) return { door: o.userData.door as DoorInst, dist: h.distance };
      if (o.userData.room) return { room: o.userData.room as string };
      while (o && !o.userData.fid && o !== this.scene) o = o.parent;
      if (o?.userData.fid) return { fid: o.userData.fid as string };
      return null;
    }
    return null;
  }

  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  groundAt(x: number, y: number) {
    if (!this.inited || !this.active || this.anim) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    const hit = new THREE.Vector3();
    this.ptr.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
    this.ray.setFromCamera(this.ptr, this.camera);
    if (!this.ray.ray.intersectPlane(this.groundPlane, hit) || hit.distanceTo(this.camera.position) > 60) return null;
    const wall = this.ray.intersectObjects([this.archUp, this.archFloor], true).find((h) => (h.object as THREE.Mesh).material !== this.glassMat && h.object.visible);
    if (wall && wall.distance < hit.distanceTo(this.camera.position) - 0.01) hit.set(wall.point.x, 0, wall.point.z);
    const px = (v: THREE.Vector3) => new THREE.Vector2(v.x * r.width / 2, v.y * r.height / 2);
    const a = px(hit.clone().project(this.camera));
    const s = Math.max(
      a.distanceTo(px(hit.clone().add(new THREE.Vector3(1, 0, 0)).project(this.camera))),
      a.distanceTo(px(hit.clone().add(new THREE.Vector3(0, 0, 1)).project(this.camera))),
    ) / 1000;
    return { x: hit.x * 1000 + this.state.layout.origin[0], y: hit.z * 1000 + this.state.layout.origin[1], s };
  }

  setSelection(sel: Selection | null) {
    if (!this.inited) return;
    this.updateSel(sel);
  }

  private updateSel(sel: Selection | null = this.glue.getSelection()) {
    if (!this.inited) return;
    const key = sel?.kind === 'furn' ? sel.id : '';
    if (key !== this.selKey) {
      this.selKey = key;
      if (this.selHelper) {
        this.scene.remove(this.selHelper);
        this.selHelper.geometry.dispose();
        this.selHelper = null;
      }
      const g = key ? this.furnG.children.find((o) => o.userData.fid === key) : undefined;
      if (g) {
        this.selHelper = new THREE.BoxHelper(g, 0xb5653a);
        this.scene.add(this.selHelper);
      }
    }
    this.selHelper?.update();
  }

  /** 家具库拖入 3D 时的落点 */
  dropPoint(clientX: number, clientY: number) {
    return this.groundAt(clientX, clientY);
  }

  /* ---------------------------------- 漫游 ---------------------------------- */

  private hintOrbit() {
    const { t } = this.glue.getI18n();
    return matchMedia('(pointer:coarse)').matches
      ? t('单指旋转 · 双指缩放 / 平移 · 点选家具后可拖动摆放 · 点门开关', '1 finger orbits · 2 fingers zoom / pan · select furniture to drag it · tap doors to open')
      : t('左键旋转 · 右键平移 · 滚轮缩放 · 选中家具后拖动可摆放 · 点击门开关', 'Left-drag orbits · right-drag pans · scroll zooms · select furniture to drag it · click doors to open');
  }

  private hintWalk() {
    const { t } = this.glue.getI18n();
    if (this.touchWalk) return t('左下摇杆移动 · 拖动画面转向 · 点门开关', 'Joystick moves · drag to look · tap doors to open');
    return t('WASD 移动 · 鼠标转向 · Shift 快走 · E 开关门 · Esc 暂停', 'WASD moves · mouse looks · Shift runs · E opens doors · Esc pauses');
  }

  private lookBy(dx: number, dy: number) {
    const eul = new THREE.Euler(0, 0, 0, 'YXZ');
    eul.setFromQuaternion(this.camera.quaternion);
    eul.y += dx * 0.005;
    eul.x = THREE.MathUtils.clamp(eul.x + dy * 0.005, -1.35, 1.35);
    this.camera.quaternion.setFromEuler(eul);
  }

  setJoystick(x: number, y: number) {
    this.joy.x = x;
    this.joy.y = y;
  }

  lockPointer() {
    if (this.touchWalk) {
      this.glue.onHint(this.hintWalk());
      return;
    }
    this.walkCtl.lock();
  }

  /** 指针锁定失败（如 iPad）时退化为摇杆漫游 */
  fallbackTouchWalk() {
    if (this.opt.mode !== 'walk' || this.touchWalk) return;
    this.touchWalk = true;
    this.glue.onTouchWalk(true);
    this.glue.onHint(this.hintWalk());
  }

  private stopTouchWalk() {
    this.touchWalk = false;
    this.joy.x = this.joy.y = 0;
    this.look = null;
    this.glue.onTouchWalk(false);
  }

  setCameraMode(m: CameraMode) {
    if (this.anim) return;
    this.opt.mode = m;
    this.glue.onCameraMode(m);
    this.fly = null;
    if (m === 'walk') {
      this.glue.onSelect(null);
      if (this.opt.cut < this.state.layout.floorHeight) {
        this.opt.cut = this.state.layout.floorHeight;
        this.sync(true);
      }
      const b = this.state.layout.bounds;
      const cx = b.x + b.w / 2;
      const cy = b.y + b.h / 2;
      this.orbit.enabled = false;
      this.camera.position.set(this.wx(cx), 1.6, this.wz(cy));
      this.camera.lookAt(this.wx(cx + 1500), 1.5, this.wz(cy));
      this.glue.onHint(this.hintWalk());
    } else {
      this.walkCtl.unlock();
      this.stopTouchWalk();
      this.glue.onWalkLocked(false);
      this.orbit.enabled = true;
      this.glue.onHint(this.hintOrbit());
      this.orbit.target.set(0, 0, 0);
      this.flyTo(this.isoWhole());
    }
    this.showLabels(this.opt.labels && m === 'orbit');
    this.archUp.traverse((o) => { if (o.userData.walkOnly) o.visible = m === 'walk'; });
  }

  private blocked(x: number, z: number, r = 0.22) {
    for (const [x0, z0, x1, z1] of this.colliders) {
      if (x > x0 - r && x < x1 + r && z > z0 - r && z < z1 + r) return true;
    }
    for (const d of this.doors) {
      const a = d.pivot.rotation.y;
      const px = d.pivot.position.x;
      const pz = d.pivot.position.z;
      const ex = px + Math.cos(a) * 0.9;
      const ez = pz - Math.sin(a) * 0.9;
      const t = clamp01(((x - px) * (ex - px) + (z - pz) * (ez - pz)) / ((ex - px) ** 2 + (ez - pz) ** 2));
      if (Math.hypot(x - (px + t * (ex - px)), z - (pz + t * (ez - pz))) < r * 0.8) return true;
    }
    return false;
  }

  private stepWalk(dt: number) {
    if (!this.walkCtl.isLocked && !this.touchWalk) return;
    const sp = (this.keys.ShiftLeft || this.keys.ShiftRight ? 2.6 : 1.4) * dt;
    const fwd = new THREE.Vector3();
    this.camera.getWorldDirection(fwd);
    fwd.y = 0;
    fwd.normalize();
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const mv = new THREE.Vector3();
    if (this.keys.KeyW || this.keys.ArrowUp) mv.add(fwd);
    if (this.keys.KeyS || this.keys.ArrowDown) mv.sub(fwd);
    if (this.keys.KeyD || this.keys.ArrowRight) mv.add(right);
    if (this.keys.KeyA || this.keys.ArrowLeft) mv.sub(right);
    if (this.touchWalk) mv.addScaledVector(fwd, -this.joy.y).addScaledVector(right, this.joy.x);
    const mag = Math.min(1, mv.length());
    if (mag < 0.05) return;
    mv.normalize().multiplyScalar(sp * mag);
    const p = this.camera.position;
    if (!this.blocked(p.x + mv.x, p.z)) p.x += mv.x;
    if (!this.blocked(p.x, p.z + mv.z)) p.z += mv.z;
  }

  /* ---------------------------------- 对外操作 ---------------------------------- */

  setCut(cut: number) {
    if (this.opt.mode === 'walk') return;
    this.opt.cut = cut;
    if (!this.inited) return;
    this.sync();
  }

  setOption(k: 'furn' | 'labels' | 'night', v: boolean) {
    this.opt[k] = v;
    if (!this.inited) return;
    if (k === 'furn') {
      this.furnG.visible = v;
      if (!v) this.updateSel(null);
    }
    if (k === 'labels') this.showLabels(v && this.opt.mode === 'orbit' && !this.anim);
    if (k === 'night') this.applyLight();
  }

  setHour(h: number) {
    this.opt.hour = h;
    if (!this.inited) return;
    this.applyLight();
  }

  relang() {
    if (!this.inited) return;
    this.buildLabels();
    this.glue.onHint(this.opt.mode === 'orbit' ? this.hintOrbit() : this.hintWalk());
  }

  hint() {
    return this.opt.mode === 'orbit' ? this.hintOrbit() : this.hintWalk();
  }

  screenshot(): string | null {
    if (!this.inited) return null;
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose() {
    this.active = false;
    this.unsubCommit?.();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (!this.inited) return;
    this.clearGroup(this.archFloor);
    this.clearGroup(this.archUp);
    this.clearGroup(this.furnG);
    this.labelG.children.slice().forEach((o) => {
      (o as CSS2DObject).element?.remove();
      this.labelG.remove(o);
    });
    this.renderer?.dispose();
    this.renderer?.domElement.remove();
    this.labelRenderer?.domElement.remove();
    this.inited = false;
  }

  /* ---------------------------------- 主循环 ---------------------------------- */

  private startLoop() {
    if (this.raf) return;
    this.clock.getDelta();
    this.raf = requestAnimationFrame(this.loop);
  }

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const dt = Math.min(this.clock.getDelta(), 0.05);
    const now = performance.now();
    if (this.anim) {
      const t = clamp01((now - this.anim.t0) / this.anim.dur);
      this.anim.fn(t);
      if (t >= 1) {
        const r = this.anim.res;
        this.anim = null;
        r();
      }
    } else if (this.fly) {
      const t = clamp01((now - this.fly.t0) / this.fly.dur);
      this.camTween(this.fly.A, this.fly.B, ease(t));
      if (t >= 1) this.fly = null;
    } else if (this.opt.mode === 'orbit') this.orbit.update();
    else this.stepWalk(dt);

    if (this.active && this.dirtyAt && now - this.dirtyAt > 180) {
      this.dirtyAt = 0;
      this.sync();
    }

    this.doors.forEach((d) => {
      const tg = d.open ? d.a1 : d.a0;
      d.cur += (tg - d.cur) * Math.min(1, dt * 6);
      d.pivot.rotation.y = d.cur;
    });
    this.updateSel();
    this.renderer.render(this.scene, this.camera);
    this.labelRenderer.render(this.scene, this.camera);
  };
}

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

const areaOf = (poly: Point[]) =>
  Math.abs(poly.reduce((a, p, i) => {
    const q = poly[(i + 1) % poly.length];
    return a + p[0] * q[1] - q[0] * p[1];
  }, 0)) / 2 / 1e6;

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));
