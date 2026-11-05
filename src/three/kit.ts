import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

/* 家具建模小工具：长度单位统一为米，y = 底面高度（与参考实现一致） */

let envTex: THREE.Texture | null = null;
let envK = 1;

export function setEnv(tex: THREE.Texture | null, k = 1) {
  envTex = tex;
  envK = k;
  matCache.forEach((m) => {
    if (m.metalness > 0 || m.roughness < 0.4) {
      const scale = m.userData.envScale ?? (m.metalness > 0.5 ? 1 : 0.5);
      m.envMap = tex;
      m.envMapIntensity = scale * k;
      m.needsUpdate = true;
    }
  });
}

const matCache = new Map<string, THREE.MeshStandardMaterial>();

export function mat(color: string, o: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  const key = color + JSON.stringify(o);
  const hit = matCache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...o });
  if (envTex && (m.metalness > 0 || m.roughness < 0.4)) {
    m.userData.envScale = m.metalness > 0.5 ? 1 : 0.5;
    m.envMap = envTex;
    m.envMapIntensity = m.userData.envScale * envK;
  }
  matCache.set(key, m);
  return m;
}

export function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = seed + 0x6d2b79f5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

export const asMat = (m: string | THREE.Material) => (typeof m === 'string' ? mat(m) : m);
export const sh = <T extends THREE.Mesh>(o: T): T => { o.castShadow = o.receiveShadow = true; return o; };
export const mesh = (geo: THREE.BufferGeometry, m: string | THREE.Material) => sh(new THREE.Mesh(geo, asMat(m)));
export const rot = <T extends THREE.Object3D>(o: T, x = 0, y = 0, z = 0) => { o.rotation.set(x, y, z); return o; };

export function box(w: number, h: number, d: number, m: string | THREE.Material, x = 0, y = 0, z = 0) {
  const o = mesh(new THREE.BoxGeometry(w, h, d), m);
  o.position.set(x, y + h / 2, z);
  return o;
}

export function rbox(w: number, h: number, d: number, m: string | THREE.Material, x = 0, y = 0, z = 0, r = 0.04) {
  const o = mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2 - 0.001, h / 2 - 0.001, d / 2 - 0.001)), m);
  o.position.set(x, y + h / 2, z);
  return o;
}

export function cyl(rt: number, rb: number, h: number, m: string | THREE.Material, x = 0, y = 0, z = 0, seg = 28) {
  const o = mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  o.position.set(x, y + h / 2, z);
  return o;
}

export function lathe(pts: [number, number][], m: string | THREE.Material, x = 0, y = 0, z = 0, seg = 40) {
  const o = mesh(new THREE.LatheGeometry(pts.map(([r, h]) => new THREE.Vector2(Math.max(r, 1e-4), h)), seg), m);
  o.position.set(x, y, z);
  return o;
}

export function rod(a: [number, number, number], b: [number, number, number], r0: number, m: string | THREE.Material, r1 = r0, seg = 12) {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const o = mesh(new THREE.CylinderGeometry(r1, r0, A.distanceTo(B), seg), m);
  o.position.copy(A).add(B).multiplyScalar(0.5);
  o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.sub(A).normalize());
  return o;
}

export const tube = (pts: [number, number, number][], r: number, m: string | THREE.Material, seg = 40) =>
  mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p)), false, 'centripetal'), seg, r, 10), m);

export function blob(rx: number, ry: number, rz: number, m: string | THREE.Material, x = 0, y = 0, z = 0, seg = 24) {
  const o = mesh(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.7)), m);
  o.scale.set(rx, ry, rz);
  o.position.set(x, y, z);
  return o;
}

export function ring(R: number, r: number, m: string | THREE.Material, x = 0, y = 0, z = 0) {
  const o = mesh(new THREE.TorusGeometry(R, r, 10, 48), m);
  o.rotation.x = Math.PI / 2;
  o.position.set(x, y, z);
  return o;
}

export function rrect(w: number, d: number, r: number) {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -d / 2;
  r = Math.min(r, w / 2 - 0.001, d / 2 - 0.001);
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + d - r);
  s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
  s.lineTo(x + r, y + d);
  s.quadraticCurveTo(x, y + d, x, y + d - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export function shell(w: number, d: number, h: number, t: number, r: number, m: string | THREE.Material, x = 0, y = 0, z = 0) {
  const s = rrect(w, d, r);
  s.holes.push(rrect(w - 2 * t, d - 2 * t, Math.max(0.004, r - t)));
  const geo = new THREE.ExtrudeGeometry(s, { depth: h, bevelEnabled: false, curveSegments: 10 });
  geo.rotateX(-Math.PI / 2);
  const o = mesh(geo, m);
  o.position.set(x, y, z);
  return o;
}

export const darker = (hex: string, k = 0.8) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
export const lighter = (hex: string, k = 0.2) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();
export const legs = (g: THREE.Group, w: number, d: number, h: number, m: string | THREE.Material, inset = 0.05, r = 0.02) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([a, b]) =>
    g.add(rod([a * (w / 2 - inset), 0, b * (d / 2 - inset)], [a * (w / 2 - inset), h, b * (d / 2 - inset)], r * 0.7, m, r)));

export const metal = () => mat('#cfd2d4', { metalness: 0.9, roughness: 0.25 });
export const chrome = () => mat('#eef0f2', { metalness: 1, roughness: 0.08 });
export const hwMat = () => mat('#b9b3a8', { metalness: 0.85, roughness: 0.3 });
export const blackMetal = () => mat('#2b2b2d', { metalness: 0.6, roughness: 0.4 });
export const mirror = () => mat('#dfeaee', { metalness: 0.55, roughness: 0.06 });
export const ceramic = (o: THREE.MeshStandardMaterialParameters = {}) => mat('#fbfbf9', { roughness: 0.12, ...o });
export const fabric = (c: string) => mat(c, { roughness: 0.96 });
export const woodM = (c: string) => mat(c, { roughness: 0.55 });
export const screenMat = (glow = '#1a2636') => mat('#0b0e13', { roughness: 0.1, metalness: 0.3, emissive: glow, emissiveIntensity: 0.35 });
export const glowMat = (c = '#fff4dc', e = '#ffdca0', k = 0.5) =>
  mat(c, { emissive: e, emissiveIntensity: k, roughness: 0.9, side: THREE.DoubleSide });

export function pull(g: THREE.Group, len: number, vert: boolean, x: number, y: number, z: number) {
  const m = hwMat();
  const o = new THREE.Group();
  o.add(vert ? box(0.01, len, 0.01, m, 0, -len / 2, 0.028) : box(len, 0.01, 0.01, m, 0, -0.005, 0.028));
  [-1, 1].forEach((s) =>
    o.add(vert ? box(0.008, 0.008, 0.028, m, 0, s * (len / 2 - 0.015) - 0.004, 0.014) : box(0.008, 0.008, 0.028, m, s * (len / 2 - 0.015), -0.004, 0.014)));
  o.position.set(x, y, z);
  g.add(o);
}

export function knob(g: THREE.Group, x: number, y: number, z: number) {
  const k = cyl(0.011, 0.014, 0.02, hwMat(), x, y - 0.01, z + 0.01, 16);
  k.rotation.x = Math.PI / 2;
  g.add(k, blob(0.014, 0.014, 0.008, hwMat(), x, y, z + 0.022, 12));
}

/** 柜门 / 抽屉面板：x0..x0+w、y0..y0+h 区域内 nx 列 × ny 行，正面朝 +z */
export function fronts(
  g: THREE.Group, x0: number, y0: number, w: number, h: number, z: number, nx: number, ny: number,
  m: string | THREE.Material, hd: 'bar' | 'knob' | 'edge' | 'none' = 'bar', hy: number | null = null,
) {
  const gap = 0.005, pw = w / nx, ph = h / ny, fz = z + 0.018;
  g.add(box(w, h, 0.002, '#2a2724', x0 + w / 2, y0, z + 0.001));
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const cx = x0 + pw * (i + 0.5), yb = y0 + ph * j, drawer = ph < 0.4 && pw >= ph;
    g.add(rbox(pw - gap, ph - gap, 0.018, m, cx, yb + gap / 2, z + 0.009, 0.003));
    if (hd === 'none') continue;
    if (hd === 'edge') { g.add(box(pw - 0.05, 0.01, 0.006, '#3c3a37', cx, yb + ph - gap - 0.018, fz)); continue; }
    if (drawer) { hd === 'knob' ? knob(g, cx, yb + ph / 2, fz) : pull(g, Math.min(0.3, pw * 0.45), false, cx, yb + ph / 2, fz); continue; }
    const len = Math.min(0.45, ph * 0.35), hx = nx === 1 ? cx + pw / 2 - 0.045 : (i % 2 ? cx - pw / 2 + 0.04 : cx + pw / 2 - 0.04);
    const y = Math.min(yb + ph - 0.05 - len / 2, Math.max(yb + 0.05 + len / 2, hy ?? yb + ph / 2));
    hd === 'knob' ? knob(g, hx, y, fz) : pull(g, len, true, hx, y, fz);
  }
}

export const vasePts = (r: number, h: number): [number, number][] =>
  [[0, 0], [r * 0.65, 0], [r, h * 0.32], [r * 0.92, h * 0.62], [r * 0.42, h * 0.86], [r * 0.5, h]];

export function vase(g: THREE.Group, x: number, y: number, z: number, r: number, h: number, c: string, R: () => number, flowers = true) {
  g.add(lathe(vasePts(r, h), mat(c, { roughness: 0.35, side: THREE.DoubleSide }), x, y, z, 32));
  if (!flowers) return;
  const cols = ['#f3e6d8', '#e8b4a0', '#f6d27a', '#ffffff'];
  for (let k = 0; k < 5; k++) {
    const a = k * 1.26 + R() * 0.4, s = 0.03 + R() * 0.05;
    const top: [number, number, number] = [x + Math.cos(a) * s, y + h + 0.12 + R() * 0.14, z + Math.sin(a) * s];
    g.add(rod([x, y + h * 0.6, z], top, 0.003, '#6f8f4a', 0.003, 6), blob(0.022, 0.018, 0.022, cols[k % 4], ...top, 12));
  }
}

export function tableLamp(g: THREE.Group, x: number, y: number, z: number, s = 1) {
  g.add(lathe([[0, 0], [0.06 * s, 0], [0.075 * s, 0.05 * s], [0.08 * s, 0.12 * s], [0.055 * s, 0.2 * s], [0.018 * s, 0.25 * s], [0.012 * s, 0.3 * s]], ceramic({ roughness: 0.3 }), x, y, z, 32));
  g.add(lathe([[0.13 * s, 0], [0.1 * s, 0.18 * s]], glowMat('#f6ecd9', '#ffdca0', 0.35), x, y + 0.26 * s, z, 40), blob(0.03 * s, 0.03 * s, 0.03 * s, glowMat('#fff', '#ffe2b0', 1), x, y + 0.31 * s, z, 12));
}

export const plate = (g: THREE.Group, r: number, x: number, y: number, z: number) =>
  g.add(lathe([[0, 0], [r * 0.6, 0], [r * 0.72, 0.008], [r, 0.02]], ceramic({ side: THREE.DoubleSide }), x, y, z, 32));
