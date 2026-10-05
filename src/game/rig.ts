import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/* ------------------------------------------------------------------ *
 *  POSE DATA
 *  Sword keys (sx,sy,sz,sp,sw,sr) describe the grip point of the sword
 *  in TORSO space + blade pitch / yaw / roll.
 *  grip = 1 → right arm is solved with IK to hold the sword at that point.
 *  two  = 1 → left hand is also solved to the handle (two-handed grip).
 *  grip = 0 → sword simply follows the right hand (FK).
 * ------------------------------------------------------------------ */
export const KEYS = [
  'torsoX', 'torsoY', 'torsoZ', 'headX', 'headY', 'hipYaw', 'hipX', 'hipZ',
  'rsX', 'rsY', 'rsZ', 'reX', 'wrX', 'wrZ',
  'lsX', 'lsY', 'lsZ', 'leX',
  'rhX', 'rkX', 'rhZ', 'lhX', 'lkX', 'lhZ', 'dy', 'plant', 'rl', 'll',
  'grip', 'two', 'sx', 'sy', 'sz', 'sp', 'sw', 'sr',
] as const;
export type PoseKey = (typeof KEYS)[number];
export type Pose = Record<PoseKey, number>;
export type PartialPose = Partial<Pose>;

/* ------------------------------------------------------------------ *
 *  LEG GEOMETRY — feet are solved with analytic IK so they can be
 *  *placed* (footwork) instead of just swung around.
 * ------------------------------------------------------------------ */
// long, athletic legs (≈ 53 % of body height). LEG_K rescales every leg pose / stride written for the old 0.91 m legs.
const L1 = 0.52;
const L2 = 0.53;
export const LEG_K = (L1 + L2) / 0.91;
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
};

/** Hip + knee angles that put an ankle `z` metres ahead of (+) / behind (−) the hip, `H` metres below it. */
export function legAngles(z: number, H: number) {
  const D = Math.min(Math.hypot(z, H), (L1 + L2) * 0.995);
  const ck = (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const k = Math.acos(Math.max(-1, Math.min(1, ck)));
  const vy = -(L1 + L2 * Math.cos(k));
  const vz = -L2 * Math.sin(k);
  return { a: wrapPi(Math.atan2(z, -H) - Math.atan2(vz, vy)), k };
}
/** Pose fragment: right foot at rz, left foot at lz (relative to hips), hips H above the floor, w = lateral toe-out. */
export function feetPose(rz: number, lz: number, H: number, w = 0.05): PartialPose {
  const r = legAngles(rz * LEG_K, H * LEG_K);
  const l = legAngles(lz * LEG_K, H * LEG_K);
  return { rhX: r.a, rkX: r.k, lhX: l.a, lkX: l.k, rhZ: -w, lhZ: w, dy: 0, plant: 1, rl: 0, ll: 0 };
}

const _fk = { x: 0, y: 0, z: 0 };
function legFK(a: number, z: number, k: number, hipX: number) {
  const vy = -(L1 + L2 * Math.cos(k));
  const vz = -L2 * Math.sin(k);
  const sz = Math.sin(z);
  const cz = Math.cos(z);
  const Y = vy * cz;
  _fk.x = hipX - vy * sz;
  _fk.y = Y * Math.cos(a) - vz * Math.sin(a);
  _fk.z = Y * Math.sin(a) + vz * Math.cos(a);
  return _fk;
}
/** Where a foot naturally sits (root space) for a given pose — used by the footwork system. */
export function footStance(p: Pose, left: boolean): { x: number; z: number } {
  const f = left ? legFK(p.lhX, p.lhZ, p.lkX, 0.1) : legFK(p.rhX, p.rhZ, p.rkX, -0.1);
  return { x: f.x, z: f.z };
}

/** Wolf's kamae: left foot forward, rear heel light, knees softly bent, weight low and centred. */
export const IDLE: Pose = {
  torsoX: 0.12, torsoY: -0.28, torsoZ: 0, headX: 0, headY: 0.22, hipYaw: -0.12, hipX: 0, hipZ: 0,
  rsX: -0.5, rsY: 0, rsZ: 0.2, reX: -0.9, wrX: 0, wrZ: 0,
  lsX: -0.5, lsY: 0, lsZ: 0.22, leX: -0.9,
  ...(feetPose(-0.22, 0.28, 0.81, 0.06) as { rhX: number; rkX: number; rhZ: number; lhX: number; lkX: number; lhZ: number; dy: number; plant: number; rl: number; ll: number }),
  // chudan-gamae: both hands on the tsuka at the centre line, tip raised toward the opponent's throat
  grip: 1, two: 1, sx: -0.03, sy: 0.48, sz: 0.42, sp: 0.72, sw: 0.05, sr: 0,
};

/** Live footwork state written by the game each frame (not keyframed). Offsets are in root space. */
export interface Gait {
  rx: number; rz: number; rl: number; rp: number;
  lx: number; lz: number; ll: number; lp: number;
  sway: number;
  bob: number;
}

export const mk = (p: PartialPose, base: Pose = IDLE): Pose => ({ ...base, ...p });
export const clonePose = (p: Pose): Pose => ({ ...p });
export function copyPose(out: Pose, a: Pose) {
  for (const k of KEYS) out[k] = a[k];
}
export function blendInto(out: Pose, a: Pose, b: Pose, t: number) {
  for (const k of KEYS) out[k] = a[k] + (b[k] - a[k]) * t;
}

export type Ease = 'lin' | 'in' | 'out' | 'io';
const EASE: Record<Ease, (t: number) => number> = {
  lin: (t) => t,
  in: (t) => t * t * t,
  out: (t) => 1 - Math.pow(1 - t, 3),
  io: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
};
export interface Keyframe {
  t: number;
  p: Pose;
  e?: Ease;
}
export function sampleFrames(frames: Keyframe[], t: number, out: Pose) {
  if (t <= frames[0].t) return copyPose(out, frames[0].p);
  const last = frames[frames.length - 1];
  if (t >= last.t) return copyPose(out, last.p);
  for (let i = 1; i < frames.length; i++) {
    if (t <= frames[i].t) {
      const a = frames[i - 1];
      const b = frames[i];
      const f = (t - a.t) / Math.max(1e-5, b.t - a.t);
      blendInto(out, a.p, b.p, EASE[b.e ?? 'io'](f));
      return;
    }
  }
}

/* ------------------------------------------------------------------ *
 *  RIG
 * ------------------------------------------------------------------ */
export type RigKind = 'player' | 'soldier' | 'boss';
export interface RigOpts {
  kind: RigKind;
  /** machine body: brushed metal "skin", glowing optic, exposed cabling */
  robot?: boolean;
  /** toon proportions (Zelda / Link): oversized head, chunky hands and feet on a small body */
  chibi?: boolean;
  skin: number;
  cloth: number;
  cloth2: number;
  accent: number;
  hair?: number;
  scale?: number;
  blade?: number;
  bladeGlow?: number;
  weapon?: 'katana' | 'bow' | 'gun';
}

export type LimbName = 'rArm' | 'lArm' | 'rLeg' | 'lLeg';

export interface Rig {
  /** the four limbs that a slice can sever (each is a self-contained group of meshes) */
  limbs: Record<LimbName, THREE.Object3D>;
  /** bloody stump shown at the joint once a limb is gone */
  stumps: Record<LimbName, THREE.Object3D>;
  severed: Set<LimbName>;
  /** the held weapon (katana / bow / gun) */
  weaponObj: THREE.Object3D;
  /** hides the limb and reveals the stump (call AFTER building the debris from it) */
  sever(name: LimbName): void;
  /** hides the weapon (it was dropped) */
  dropWeapon(): void;
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  swordBase: THREE.Object3D;
  swordTip: THREE.Object3D;
  bladeMat: THREE.MeshStandardMaterial;
  apply(p: Pose): void;
  update(dt: number): void;
  setFlash(v: number): void;
  setBladeGlow(v: number): void;
  bladeGlowBase: number;
  headObj: THREE.Object3D;
  chestObj: THREE.Object3D;
  gait: Gait;
  /** leg-length factor (1 = adult, <1 = toon). Foot positions live in this scaled space. */
  legK: number;
  /** where projectiles leave the weapon (bow centre / gun muzzle) */
  muzzle: THREE.Object3D;
  /** bow: pull the string back (0..1) and show / hide the nocked arrow */
  setDraw(d: number, nocked: boolean): void;
}

const A1 = 0.272;
const A2 = 0.264;
const GRIP_GAP = 0.14;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

interface LegRig {
  hp: THREE.Group;
  kn: THREE.Group;
  foot: THREE.Group;
}
/** Exact 3-DoF leg solve: hip (pitch + roll) and knee hinge land the ankle on (tx,ty,tz). */
function solveLeg(l: LegRig, hipX: number, tx: number, ty: number, tz: number, pitchX: number, toe: number) {
  let dx = tx - hipX;
  let dy = ty;
  let dz = tz;
  let D = Math.hypot(dx, dy, dz);
  const maxD = (L1 + L2) * 0.996;
  if (D > maxD) {
    const s = maxD / D;
    dx *= s;
    dy *= s;
    dz *= s;
    D = maxD;
  }
  const ck = (D * D - L1 * L1 - L2 * L2) / (2 * L1 * L2);
  const k = Math.max(0.02, Math.acos(clamp(ck, -1, 1)));
  const vy = -(L1 + L2 * Math.cos(k));
  const vz = -L2 * Math.sin(k);
  const zr = Math.asin(clamp(dx / -vy, -0.9, 0.9));
  const a = wrapPi(Math.atan2(dz, dy) - Math.atan2(vz, vy * Math.cos(zr)));
  l.hp.rotation.set(a, 0, zr);
  l.kn.rotation.x = k;
  l.foot.rotation.x = -(a + k) + pitchX;
  l.foot.rotation.y = toe;
}

/* ---------- procedural cloth weave bump ---------- */
let weave: THREE.CanvasTexture | null = null;
function getWeave() {
  if (weave) return weave;
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  for (let y = 0; y < 64; y++) {
    for (let x = 0; x < 64; x++) {
      const v = (((x + y) & 1) === 1 ? 175 : 105) + Math.random() * 40;
      g.fillStyle = `rgb(${v | 0},${v | 0},${v | 0})`;
      g.fillRect(x * 2, y * 2, 2, 2);
    }
  }
  weave = new THREE.CanvasTexture(c);
  weave.wrapS = weave.wrapT = THREE.RepeatWrapping;
  weave.repeat.set(5, 4);
  return weave;
}

/* ---------- thin ink contour (inverted hull) ---------- */
export const outlineMat = new THREE.ShaderMaterial({
  uniforms: { uThick: { value: 0.0042 }, uColor: { value: new THREE.Color(0x0a0608) } },
  vertexShader: /* glsl */ `
    uniform float uThick;
    void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + normal * uThick, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform vec3 uColor;
    void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
  side: THREE.BackSide,
});
const olCache = new Map<THREE.BufferGeometry, THREE.BufferGeometry>();
function outlineGeo(g: THREE.BufferGeometry) {
  let o = olCache.get(g);
  if (!o) {
    const c = g.clone();
    c.deleteAttribute('normal');
    c.deleteAttribute('uv');
    o = mergeVertices(c);
    o.computeVertexNormals();
    olCache.set(g, o);
  }
  return o;
}

/* ---------- spring cloth chains ---------- */
interface Chain {
  parent: THREE.Object3D;
  segs: THREE.Group[];
  ax: number[];
  az: number[];
  vx: number[];
  vz: number[];
  last: THREE.Vector3;
  sv: THREE.Vector3;
  init: boolean;
  k: number;
  c: number;
  gain: number;
  flutter: number;
  rest: number;
  restZ: number;
  droop: number;
  phase: number;
  /** how strongly a segment lags behind its parent's angular acceleration (whip / follow-through) */
  inert: number;
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _qi = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _g = new THREE.Vector3();

function updateChain(ch: Chain, dt: number, clock: number, sc: number) {
  ch.segs[0].getWorldPosition(_p);
  ch.parent.getWorldQuaternion(_q);
  _qi.copy(_q).invert();
  if (!ch.init) {
    ch.last.copy(_p);
    ch.init = true;
  }
  _v.copy(_p).sub(ch.last).multiplyScalar(1 / Math.max(dt, 1e-4));
  ch.last.copy(_p);
  if (_v.length() > 16) _v.setLength(16);
  ch.sv.lerp(_v, 1 - Math.exp(-14 * dt));
  _v.copy(ch.sv).applyQuaternion(_qi).multiplyScalar(1 / sc);
  _g.set(0, -1, 0).applyQuaternion(_qi);
  const gx = Math.atan2(-_g.z, -_g.y);
  const gz = Math.atan2(_g.x, -_g.y);
  const dX = clamp(_v.z * ch.gain, -0.95, 0.95);
  const dZ = clamp(-_v.x * ch.gain, -0.95, 0.95);
  const n = ch.segs.length;
  // a slow breeze that travels along the chain, so even at rest the hair and cloth breathe
  const breeze = Math.sin(clock * 0.8 + ch.phase) * 0.6 + Math.sin(clock * 2.1 + ch.phase * 1.3) * 0.3;
  let dvx = 0;
  let dvz = 0;
  for (let i = 0; i < n; i++) {
    const wave = i * 0.8;
    const fl = Math.sin(clock * (3.1 + i * 0.7) + ch.phase + wave) * ch.flutter * (0.5 + 0.25 * i);
    const fz = Math.sin(clock * (2.3 + i * 0.5) + ch.phase * 1.7 + wave) * ch.flutter * 0.6 * (0.4 + 0.25 * i);
    const bz = breeze * ch.flutter * 0.5 * (0.3 + 0.2 * i);
    // speed makes the drag pull stronger toward the tip (so the ends stream out, the roots stay put)
    const sp = Math.min(1.5, 0.4 + 0.12 * ch.sv.length());
    const tx = (i === 0 ? gx + ch.rest : ch.droop) + dX * (i === 0 ? 0.45 : 0.4 + 0.06 * i * sp) + fl;
    const tz = (i === 0 ? gz + ch.restZ : 0) + dZ * (i === 0 ? 0.4 : 0.34 + 0.05 * i * sp) + fz + bz;
    const k = ch.k * (1 - 0.1 * i);
    const c = ch.c * (1 - 0.04 * i);
    const ovx = ch.vx[i];
    const ovz = ch.vz[i];
    ch.vx[i] += ((tx - ch.ax[i]) * k - ovx * c) * dt - dvx * ch.inert;
    ch.vz[i] += ((tz - ch.az[i]) * k - ovz * c) * dt - dvz * ch.inert;
    dvx = ch.vx[i] - ovx;
    dvz = ch.vz[i] - ovz;
    ch.ax[i] = clamp(ch.ax[i] + ch.vx[i] * dt, -1.7, 2.0);
    ch.az[i] = clamp(ch.az[i] + ch.vz[i] * dt, -1.3, 1.3);
    ch.segs[i].rotation.set(ch.ax[i], 0, ch.az[i]);
  }
}

/* ---------- IK scratch ---------- */
const S = new THREE.Vector3();
const Dd = new THREE.Vector3();
const Dn = new THREE.Vector3();
const pole = new THREE.Vector3();
const pp = new THREE.Vector3();
const E = new THREE.Vector3();
const U = new THREE.Vector3();
const Tc = new THREE.Vector3();
const F = new THREE.Vector3();
const Zl = new THREE.Vector3();
const Yl = new THREE.Vector3();
const Xl = new THREE.Vector3();
const basis = new THREE.Matrix4();
const qIk = new THREE.Quaternion();
const fkM = new THREE.Matrix4();
const fkPos = new THREE.Vector3();
const fkQ = new THREE.Quaternion();
const fkS = new THREE.Vector3();
const qZpi = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI);
const swDir = new THREE.Vector3();
const swLat = new THREE.Vector3();
const swEdge0 = new THREE.Vector3();
const swEdge = new THREE.Vector3();
const swX = new THREE.Vector3();
const swQ = new THREE.Quaternion();
const swPos = new THREE.Vector3();
const gripR = new THREE.Vector3();
const gripL = new THREE.Vector3();
const swY = new THREE.Vector3();
const tmpV = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface Arm {
  sh: THREE.Group;
  el: THREE.Group;
  wr: THREE.Group;
}

function solveArm(a: Arm, T: THREE.Vector3, side: number, w: number) {
  if (w < 0.001) return;
  S.copy(a.sh.position);
  Dd.subVectors(T, S);
  const dist = Math.max(1e-4, Dd.length());
  Dn.copy(Dd).divideScalar(dist);
  const cd = clamp(dist, 0.14, (A1 + A2) * 0.995);
  const aa = (A1 * A1 - A2 * A2 + cd * cd) / (2 * cd);
  const hh = Math.sqrt(Math.max(0, A1 * A1 - aa * aa));
  pole.set(side * 0.55, -1, -0.2);
  pp.copy(pole).addScaledVector(Dn, -pole.dot(Dn));
  if (pp.lengthSq() < 1e-6) pp.set(0, -1, 0);
  pp.normalize();
  E.copy(S).addScaledVector(Dn, aa).addScaledVector(pp, hh);
  U.subVectors(E, S).normalize();
  Tc.copy(S).addScaledVector(Dn, cd);
  F.subVectors(Tc, E).normalize();
  const bend = Math.acos(clamp(U.dot(F), -1, 1));
  const th = -bend;
  const sn = Math.sin(th);
  const cs = Math.cos(th);
  if (Math.abs(sn) > 1e-4) Zl.copy(U).multiplyScalar(cs).sub(F).divideScalar(sn).normalize();
  else Zl.copy(pp).addScaledVector(U, -pp.dot(U)).normalize();
  Yl.copy(U).negate();
  Xl.crossVectors(Yl, Zl);
  basis.makeBasis(Xl, Yl, Zl);
  qIk.setFromRotationMatrix(basis);
  a.sh.quaternion.slerp(qIk, w);
  a.el.rotation.x += (th - a.el.rotation.x) * w;
}

/* ------------------------------------------------------------------ *
 *  BUILD
 * ------------------------------------------------------------------ */
export function createHumanoid(o: RigOpts): Rig {
  const kind = o.kind;
  const isP = kind === 'player';
  const isB = kind === 'boss';
  const bot = !!o.robot;
  const robotSoldier = bot && !isB;
  const root = new THREE.Group();
  const flashMats: THREE.MeshStandardMaterial[] = [];
  const chains: Chain[] = [];
  let clock = Math.random() * 10;

  const M = (c: number, r = 0.8, m = 0.05, side?: THREE.Side, fabric = false) => {
    const mat = new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: m });
    if (side !== undefined) mat.side = side;
    if (fabric) {
      mat.bumpMap = getWeave();
      mat.bumpScale = 1.4;
    }
    flashMats.push(mat);
    return mat;
  };
  const add = (
    parent: THREE.Object3D,
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x = 0,
    y = 0,
    z = 0,
    ol = true,
  ) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = !robotSoldier || ol;
    parent.add(m);
    // Metallic troops read more cleanly without a separate inverted-hull draw call on every armor segment.
    if (ol && !robotSoldier) m.add(new THREE.Mesh(outlineGeo(geo), outlineMat));
    return m;
  };
  const grp = (parent: THREE.Object3D, x = 0, y = 0, z = 0) => {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  };
  const tube = (len: number, rt: number, rb: number, seg = 14) => {
    const g = new THREE.CylinderGeometry(rt, rb, len, seg, 1);
    g.translate(0, -len / 2, 0);
    return g;
  };
  const lathe = (pts: [number, number][], seg = 28) =>
    new THREE.LatheGeometry(
      pts.map(([r, y]) => new THREE.Vector2(r, y)),
      seg,
    );
  const sph = (r: number, ws = 16, hs = 12) => new THREE.SphereGeometry(r, ws, hs);
  /** Muscled limb segment hanging down from its joint. prof = [radius, t] with t = 0 (top) … 1 (bottom). */
  const limb = (len: number, prof: [number, number][], seg = 18) =>
    lathe(
      prof.map(([r, t]) => [r, -t * len] as [number, number]).reverse(),
      seg,
    );
  const ring = (parent: THREE.Object3D, R: number, tubeR: number, y: number, mat: THREE.Material, zs = 0.64) => {
    const m = add(parent, new THREE.TorusGeometry(R, tubeR, 6, 30), mat, 0, y, 0, false);
    m.rotation.x = Math.PI / 2;
    m.scale.y = zs;
    return m;
  };
  /** A tapered strand/spike with its base at `root` pointing along `dir`. */
  const strand = (parent: THREE.Object3D, rootP: THREE.Vector3, dir: THREE.Vector3, len: number, rad: number, mat: THREE.Material) => {
    const d = dir.clone().normalize();
    const m = add(parent, new THREE.ConeGeometry(rad, len, 6), mat, 0, 0, 0, false);
    m.position.copy(rootP).addScaledVector(d, len / 2 - 0.01);
    m.quaternion.setFromUnitVectors(UP, d);
    return m;
  };

  const makeChain = (
    parent: THREE.Object3D,
    x: number,
    y: number,
    z: number,
    n: number,
    segLen: number,
    w0: number,
    w1: number,
    mat: THREE.Material,
    opt: {
      rest?: number;
      restZ?: number;
      k?: number;
      c?: number;
      gain?: number;
      flutter?: number;
      thick?: number;
      phase?: number;
      droop?: number;
      ol?: boolean;
      inert?: number;
    } = {},
  ) => {
    const segs: THREE.Group[] = [];
    let par: THREE.Object3D = parent;
    for (let i = 0; i < n; i++) {
      const g = new THREE.Group();
      if (i === 0) g.position.set(x, y, z);
      else g.position.set(0, -segLen, 0);
      par.add(g);
      const wt = w0 + (w1 - w0) * (i / n);
      const wb = w0 + (w1 - w0) * ((i + 1) / n);
      const geo = new THREE.CylinderGeometry(wt / Math.SQRT2, wb / Math.SQRT2, segLen * 1.04, 4, 1);
      geo.rotateY(Math.PI / 4);
      geo.scale(1, 1, (opt.thick ?? 0.012) / ((wt + wb) / 2));
      geo.translate(0, -segLen / 2, 0);
      add(g, geo, mat, 0, 0, 0, opt.ol ?? false);
      segs.push(g);
      par = g;
    }
    chains.push({
      parent,
      segs,
      ax: new Array(n).fill(0),
      az: new Array(n).fill(0),
      vx: new Array(n).fill(0),
      vz: new Array(n).fill(0),
      last: new THREE.Vector3(),
      sv: new THREE.Vector3(),
      init: false,
      k: opt.k ?? 60,
      c: opt.c ?? 7,
      gain: opt.gain ?? 0.1,
      flutter: opt.flutter ?? 0.05,
      inert: opt.inert ?? 0.22,
      rest: opt.rest ?? 0.1,
      restZ: opt.restZ ?? 0,
      droop: opt.droop ?? 0,
      phase: opt.phase ?? Math.random() * 6,
    });
  };

  /* ---------- materials ---------- */
  const cloth = M(robotSoldier ? 0x1c252f : o.cloth, robotSoldier ? 0.54 : 0.88, robotSoldier ? 0.48 : 0.02, undefined, !robotSoldier);
  const cloth2 = M(robotSoldier ? 0x26313d : o.cloth2, robotSoldier ? 0.48 : 0.82, robotSoldier ? 0.56 : 0.04, undefined, !robotSoldier);
  const clothDS = M(o.cloth2, 0.85, 0.02, THREE.DoubleSide, true);
  // Ordinary troops expose brushed-metal joints and hard plates instead of fabric-covered samurai silhouettes.
  const skin = bot ? M(o.skin, 0.34, 0.85) : M(o.skin, 0.62, 0);
  const accent = M(o.accent, 0.55, 0.12, undefined, true);
  const accentDS = M(o.accent, 0.6, 0.05, THREE.DoubleSide, true);
  const dark = M(0x15131a, 0.8, 0.1);
  const leather = robotSoldier ? M(0x394552, 0.36, 0.78) : M(0x3a281e, 0.7, 0.08);
  const metal = M(isB ? 0x2e2f38 : bot ? 0x657382 : 0x555966, 0.32, 0.85);
  const gold = M(0xc9a24a, 0.3, 0.9);
  const inner = M(robotSoldier ? 0x18212b : isP ? 0xb8b5c6 : isB ? 0x2a2024 : 0xcdbf9c, robotSoldier ? 0.58 : 0.9, robotSoldier ? 0.62 : 0, undefined, !robotSoldier);
  const wrapMat = M(robotSoldier ? 0x293541 : isP ? 0x3a3f58 : isB ? 0x2a2024 : 0x6d5a40, robotSoldier ? 0.44 : 0.9, robotSoldier ? 0.72 : 0, undefined, !robotSoldier);
  const obiMat = M(robotSoldier ? 0x26313d : isP ? 0x2a2832 : isB ? 0x8c6a1e : o.accent, robotSoldier ? 0.38 : 0.7, robotSoldier ? 0.76 : 0.1, undefined, !robotSoldier);
  const laquer = M(isB ? 0x16141c : robotSoldier ? 0x202a36 : 0x2a2124, 0.32, robotSoldier ? 0.74 : 0.5);
  // robot optics burn cyan; humans have dark eyes
  const eyeMat = bot ? new THREE.MeshBasicMaterial({ color: new THREE.Color(0.35, 3.4, 4.2) }) : M(0x0a0608, 0.4, 0);
  const wireMat = M(0x101420, 0.6, 0.4);
  const coreMat = new THREE.MeshBasicMaterial({ color: isB ? new THREE.Color(3.8, 0.08, 0.04) : new THREE.Color(0.2, 2.6, 3.6) });
  const hairMat = o.hair !== undefined ? M(o.hair, 0.7, 0.05) : dark;

  /* ---------- body skeleton ---------- */
  const hips = grp(root, 0, 0.93, 0);
  // Keep the toon legs compact and in proportion under the large head, rather than stretching the stride silhouette.
  const legK = o.chibi ? 0.82 : 1;
  const legRoot = grp(hips, 0, 0, 0);
  legRoot.scale.setScalar(legK);
  const pelvis = grp(hips, 0, 0.04, 0);
  pelvis.rotation.order = 'YXZ';

  // Compact, fitted hips keep the legs visually connected to the torso.
  const pm = add(pelvis, new THREE.CylinderGeometry(0.168, 0.2, 0.26, 22), cloth2, 0, -0.08, 0);
  pm.scale.z = 0.8;
  const obi = add(pelvis, new THREE.CylinderGeometry(0.168, 0.168, isB ? 0.11 : 0.09, 24), obiMat, 0, 0.065, 0);
  obi.scale.z = 0.76;
  add(pelvis, new THREE.BoxGeometry(0.1, 0.07, 0.05), obiMat, 0, 0.07, -0.135);
  makeChain(pelvis, 0.045, 0.06, -0.148, 3, 0.12, 0.055, 0.045, isP ? accent : obiMat, { rest: 0.12, k: 70, gain: 0.1, thick: 0.014 });
  makeChain(pelvis, -0.045, 0.06, -0.148, 3, 0.1, 0.05, 0.04, isP ? accent : obiMat, { rest: 0.1, k: 75, gain: 0.1, phase: 2.2, thick: 0.014 });

  if (isP) {
    // gold hem band around the bottom of the kimono (the yellow trim of the reference)
    ring(pelvis, 0.2, 0.014, -0.215, accent, 0.82);
    ring(pelvis, 0.188, 0.007, -0.17, accent, 0.82);
    // long kimono tails — back + both sides — flow with every move
    makeChain(pelvis, 0, 0.0, -0.16, 4, 0.13, 0.3, 0.2, clothDS, { rest: 0.06, k: 40, c: 5.5, gain: 0.12, flutter: 0.05, thick: 0.012, phase: 0.7 });
    makeChain(pelvis, 0.168, 0.0, -0.05, 3, 0.14, 0.15, 0.11, clothDS, { rest: 0.04, restZ: -0.04, k: 46, c: 5.5, gain: 0.1, flutter: 0.04, thick: 0.012, phase: 1.4 });
    makeChain(pelvis, -0.168, 0.0, -0.05, 3, 0.14, 0.15, 0.11, clothDS, { rest: 0.04, restZ: 0.04, k: 46, c: 5.5, gain: 0.1, flutter: 0.04, thick: 0.012, phase: 2.9 });
  }

  // saya (empty scabbard) at left hip
  {
    const sg = grp(pelvis, 0.2, 0.06, -0.01);
    sg.rotation.set(1.15, 0, -0.06);
    const geo = new THREE.CapsuleGeometry(0.027, 0.94, 4, 12);
    geo.translate(0, -0.47, 0);
    const sm = add(sg, geo, M(0x17141a, 0.25, 0.4), 0, 0, 0);
    sm.scale.z = 1.35;
    add(sg, new THREE.CylinderGeometry(0.03, 0.03, 0.035, 12), gold, 0, -0.01, 0, false);
    add(sg, new THREE.CylinderGeometry(0.029, 0.029, 0.02, 12), gold, 0, -0.2, 0, false);
    add(sg, sph(0.03), gold, 0, -0.96, 0, false);
    const cord = add(sg, new THREE.BoxGeometry(0.008, 0.28, 0.008), accent, 0.02, -0.14, 0.02, false);
    cord.rotation.z = 0.2;
  }

  /* ---------- legs ---------- */
  const mkLeg = (side: 1 | -1) => {
    const hp = grp(legRoot, side * 0.1, 0, 0);
    add(hp, limb(L1 + 0.03, [[0.098, 0], [0.108, 0.14], [0.1, 0.42], [0.08, 0.8], [0.068, 1]]), cloth2);
    const kn = grp(hp, 0, -L1, 0);
    add(kn, sph(0.07), cloth2, 0, 0, 0, false);
    add(kn, limb(L2 + 0.01, [[0.07, 0], [0.078, 0.13], [0.079, 0.3], [0.062, 0.62], [0.046, 0.9], [0.043, 1]]), cloth2);
    // leg wraps (kyahan)
    add(kn, tube(0.3, 0.072, 0.05, 14), wrapMat, 0, -0.25, 0);
    for (let i = 0; i < 4; i++) ring(kn, 0.07 - i * 0.0045, 0.004, -0.3 - i * 0.055, dark, 1);
    if (isB || kind === 'soldier') {
      const gm = isB || bot ? metal : leather;
      add(kn, tube(0.28, 0.088, 0.07, 14), gm, 0, -0.1, 0.0);
      add(kn, sph(0.078), gm, 0, 0, 0.03, false).scale.set(1, 0.8, 1);
    }
    const foot = grp(kn, 0, -L2, 0);
    if (o.chibi) foot.scale.setScalar(1.5); // big toon boots (the legs above them are short)
    if (isP) {
      // bare foot in a tabi sock…
      const toe = add(foot, sph(0.052), M(0xe8e4dc, 0.85, 0), 0, -0.02, 0.085);
      toe.scale.set(1, 0.62, 2.1);
      const heel = add(foot, sph(0.05), M(0xe8e4dc, 0.85, 0), 0, -0.024, -0.03);
      heel.scale.set(1, 0.72, 1.2);
      // …standing on a wooden geta: plank sole, two teeth, black thong
      const woodM = M(0xc9a071, 0.8, 0);
      add(foot, new THREE.BoxGeometry(0.115, 0.022, 0.265), woodM, 0, -0.064, 0.05);
      for (const z of [-0.03, 0.125]) add(foot, new THREE.BoxGeometry(0.105, 0.05, 0.026), woodM, 0, -0.1, z);
      const thong = add(foot, new THREE.BoxGeometry(0.012, 0.012, 0.12), dark, 0, -0.04, 0.085, false);
      thong.rotation.x = -0.25;
      for (const s of [-1, 1]) {
        const strap = add(foot, new THREE.BoxGeometry(0.01, 0.045, 0.01), dark, s * 0.042, -0.038, 0.035, false);
        strap.rotation.z = s * 0.5;
      }
    } else {
      const toe = add(foot, sph(0.054), leather, 0, -0.022, 0.085);
      toe.scale.set(1, 0.6, 2.2);
      const heel = add(foot, sph(0.052), leather, 0, -0.026, -0.03);
      heel.scale.set(1, 0.7, 1.2);
      add(foot, new THREE.BoxGeometry(0.1, 0.01, 0.2), dark, 0, -0.058, 0.05, false);
    }
    return { hp, kn, foot };
  };
  const RL = mkLeg(-1);
  const LL = mkLeg(1);

  /* ---------- torso ---------- */
  const torso = grp(pelvis, 0, 0.06, 0);
  torso.rotation.order = 'YXZ';
  const tProf: [number, number][] = [
    [0.135, -0.02], [0.14, 0.08], [0.16, 0.2], [0.188, 0.3], [0.218, 0.38], [0.228, 0.5], [0.19, 0.57], [0.1, 0.62], [0.065, 0.645],
  ];
  const tm = add(torso, lathe(tProf, 28), isB ? cloth2 : cloth);
  tm.scale.z = 0.64;
  const chestObj = grp(torso, 0, 0.4, 0);

  if (bot) {
    // power core in the chest + exposed cabling at the neck and spine
    add(torso, new THREE.CylinderGeometry(0.052, 0.052, 0.03, 16), coreMat, 0, 0.34, 0.15, false).rotation.x = Math.PI / 2;
    add(torso, new THREE.TorusGeometry(0.068, 0.012, 8, 20), metal, 0, 0.34, 0.145, false);
    for (const s of [-1, 1]) {
      add(torso, new THREE.BoxGeometry(0.012, 0.3, 0.012), coreMat, s * 0.12, 0.34, 0.14, false).rotation.z = s * 0.25;
      makeChain(torso, s * 0.07, 0.6, -0.1, 4, 0.07, 0.022, 0.014, wireMat, {
        rest: 0.5, droop: 0.1, k: 48, c: 4, gain: 0.2, flutter: 0.1, thick: 0.02, phase: s * 2,
      });
    }
    // panel seams
    for (const y of [0.18, 0.46]) ring(torso, 0.2, 0.008, y, metal, 0.7);
  }

  // kimono V-neck collar
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.082, 0.6);
    sh.lineTo(0.082, 0.6);
    sh.lineTo(0, 0.3);
    sh.closePath();
    const m = add(torso, new THREE.ShapeGeometry(sh), inner, 0, 0, 0.151, false);
    m.castShadow = false;
    const c1 = add(torso, new THREE.BoxGeometry(0.04, 0.31, 0.016), isP ? cloth2 : cloth2, 0.043, 0.455, 0.154, false);
    c1.rotation.z = -0.27;
    const c2 = add(torso, new THREE.BoxGeometry(0.04, 0.31, 0.016), isP ? cloth2 : cloth2, -0.043, 0.455, 0.154, false);
    c2.rotation.z = 0.27;
  }

  if (isP) {
    // chest harness straps + belt buckle — Wolf's utility look
    const tilt = grp(torso, 0, 0.32, 0);
    tilt.rotation.z = 0.62;
    const st = add(tilt, new THREE.TorusGeometry(0.222, 0.012, 6, 32, Math.PI * 1.2), leather, 0, 0, 0, false);
    st.rotation.x = Math.PI / 2;
    st.rotation.z = -Math.PI * 0.1;
    st.scale.set(1, 0.66, 1);
    add(torso, new THREE.BoxGeometry(0.038, 0.038, 0.02), gold, 0.0, 0.01, 0.135, false);
  }

  if (kind !== 'player') {
    const ap: [number, number][] = [[0.158, 0.08], [0.178, 0.2], [0.205, 0.3], [0.236, 0.38], [0.246, 0.49], [0.232, 0.535]];
    const dm = add(torso, lathe(ap, 28), robotSoldier ? metal : laquer, 0, 0, 0);
    dm.scale.z = 0.68;
    [0.17, 0.25, 0.33, 0.41].forEach((y, i) => ring(torso, [0.178, 0.195, 0.222, 0.246][i], 0.0075, y, isB ? gold : accent, 0.68));
    // lacing diamonds
    for (let i = 0; i < 6; i++) {
      const lz = add(torso, new THREE.BoxGeometry(0.03, 0.03, 0.006), isB ? gold : accent, (i - 2.5) * 0.04, 0.2 + (i % 2) * 0.09, 0.128 + (i % 2) * 0.014, false);
      lz.rotation.z = Math.PI / 4;
    }
    if (isB) {
      add(torso, new THREE.CylinderGeometry(0.045, 0.045, 0.012, 20), gold, 0, 0.36, 0.172, false).rotation.x = Math.PI / 2;
      for (const s of [-1, 1]) {
        const ridge = add(torso, new THREE.BoxGeometry(0.05, 0.32, 0.022), metal, s * 0.12, 0.34, 0.164, false);
        ridge.rotation.z = -s * 0.22;
        const seam = add(torso, new THREE.BoxGeometry(0.014, 0.28, 0.01), M(0x9e1521, 0.28, 0.55), s * 0.16, 0.34, 0.17, false);
        seam.rotation.z = -s * 0.22;
      }
      const heartRing = add(torso, new THREE.TorusGeometry(0.09, 0.012, 7, 24), gold, 0, 0.36, 0.19, false);
      heartRing.rotation.x = Math.PI / 2;
    }
  }

  // kusazuri / hip plates (soldier + boss)
  if (kind !== 'player') {
    const n = isB ? 10 : 7;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const pl = add(
        pelvis,
        new THREE.BoxGeometry(isB ? 0.14 : 0.12, isB ? 0.26 : 0.2, 0.014),
        isB ? laquer : robotSoldier ? metal : leather,
        Math.sin(a) * 0.238,
        -0.15,
        Math.cos(a) * 0.192,
      );
      pl.rotation.y = a;
      pl.rotation.x = -0.1;
      add(pl, new THREE.BoxGeometry(isB ? 0.14 : 0.12, 0.012, 0.018), isB ? gold : accent, 0, isB ? -0.12 : -0.09, 0, false);
    }
  } else {
    add(pelvis, new THREE.BoxGeometry(0.1, 0.09, 0.06), leather, 0.1, 0.0, 0.14);
    const gm = M(0x6f8d4a, 0.5, 0.05);
    add(pelvis, sph(0.045), gm, -0.2, -0.04, 0.04).scale.y = 1.1;
    add(pelvis, sph(0.03), gm, -0.2, 0.035, 0.04);
    add(pelvis, new THREE.BoxGeometry(0.008, 0.06, 0.008), dark, -0.2, 0.08, 0.04, false);
  }

  /* ---------- head ---------- */
  const head = grp(torso, 0, 0.62, 0);
  // heroic 8-head proportions — or a big toon head when chibi
  head.scale.setScalar(o.chibi ? 1.45 : 0.92);
  head.rotation.order = 'YXZ';
  const headObj = grp(head, 0, 0.17, 0);
  const neckG = new THREE.CylinderGeometry(0.05, 0.058, 0.13, 12);
  neckG.translate(0, 0.045, 0);
  add(head, neckG, skin);
  const skull = add(head, sph(0.105, 24, 18), skin, 0, 0.17, 0);
  skull.scale.set(0.92, 1.1, 1.0);
  const jaw = add(head, sph(0.078, 16, 12), skin, 0, 0.108, 0.034);
  jaw.scale.set(0.95, 0.85, 1.0);
  if (!robotSoldier) {
    [-1, 1].forEach((s) => add(head, sph(0.022, 8, 6), skin, s * 0.098, 0.165, 0.0, false).scale.set(0.5, 1, 0.8));
  }
  if (!isB && !robotSoldier) {
    [-1, 1].forEach((s) => {
      add(head, sph(0.0125, 8, 6), eyeMat, s * 0.04, 0.184, 0.096, false);
      const br = add(head, new THREE.BoxGeometry(0.048, 0.009, 0.012), dark, s * 0.043, 0.206, 0.093, false);
      br.rotation.z = s * (isP ? 0.12 : 0.28);
    });
    const nose = add(head, new THREE.ConeGeometry(0.014, 0.04, 5), skin, 0, 0.15, 0.1, false);
    nose.rotation.x = Math.PI / 2 - 0.15;
    add(head, new THREE.BoxGeometry(0.042, 0.005, 0.006), dark, 0, 0.118, 0.098, false);
  }

  if (isP) {
    // scar across the brow and cheek
    const scar = add(head, new THREE.BoxGeometry(0.006, 0.075, 0.004), M(0x8a3a3a, 0.6, 0), -0.05, 0.17, 0.099, false);
    scar.rotation.z = 0.35;
    // Wolf's swept-back white hair + topknot ponytail
    const cap = add(head, new THREE.SphereGeometry(0.114, 24, 14, 0, Math.PI * 2, 0, Math.PI * 0.6), hairMat, 0, 0.182, -0.016);
    cap.scale.set(1.0, 1.06, 1.08);
    cap.rotation.x = -0.25;
    const back = add(head, sph(0.1, 16, 12), hairMat, 0, 0.17, -0.045, false);
    back.scale.set(1, 1.02, 0.95);
    // bangs
    for (let i = 0; i < 5; i++) {
      const a = (i - 2) * 0.36;
      strand(
        head,
        new THREE.Vector3(Math.sin(a) * 0.09, 0.248 - Math.abs(i - 2) * 0.013, Math.cos(a) * 0.065),
        new THREE.Vector3(Math.sin(a) * 0.5, -0.5, 0.75),
        0.12 - Math.abs(i - 2) * 0.012,
        0.022,
        hairMat,
      );
    }
    // swept-back crown spikes
    for (let i = 0; i < 9; i++) {
      const a = (i / 8 - 0.5) * 2.4;
      strand(
        head,
        new THREE.Vector3(Math.sin(a) * 0.075, 0.26, -0.02 + Math.cos(a) * 0.02),
        new THREE.Vector3(Math.sin(a) * 0.65, 0.3, -1),
        0.15 - Math.abs(a) * 0.03,
        0.026,
        hairMat,
      );
    }
    // sideburns
    [-1, 1].forEach((s) => strand(head, new THREE.Vector3(s * 0.1, 0.19, 0.04), new THREE.Vector3(s * 0.2, -1, 0.1), 0.1, 0.018, hairMat));
    // hair tie
    const tie = add(head, sph(0.03, 8, 6), accent, 0, 0.215, -0.1, false);
    tie.scale.set(1, 0.7, 1);
    // flowing ponytail: three layered locks of different length / stiffness so they separate and whip like real hair
    makeChain(head, 0, 0.215, -0.1, 7, 0.1, 0.085, 0.012, hairMat, {
      rest: 1.2, droop: -0.2, k: 52, c: 3.6, gain: 0.26, flutter: 0.1, thick: 0.05, ol: true, inert: 0.85, phase: 0.4,
    });
    makeChain(head, 0.035, 0.212, -0.095, 6, 0.095, 0.06, 0.01, hairMat, {
      rest: 1.1, restZ: 0.18, droop: -0.18, k: 46, c: 3.2, gain: 0.3, flutter: 0.12, thick: 0.04, inert: 0.95, phase: 2.1,
    });
    makeChain(head, -0.035, 0.212, -0.095, 6, 0.092, 0.06, 0.01, hairMat, {
      rest: 1.1, restZ: -0.18, droop: -0.18, k: 48, c: 3.3, gain: 0.3, flutter: 0.12, thick: 0.04, inert: 0.95, phase: 4.3,
    });
    // loose locks falling beside the face / over the nape — they swing on their own
    [-1, 1].forEach((s) => {
      makeChain(head, s * 0.1, 0.2, 0.035, 4, 0.05, 0.034, 0.008, hairMat, {
        rest: 0.15, restZ: s * 0.22, droop: 0.02, k: 36, c: 2.8, gain: 0.34, flutter: 0.14, thick: 0.026, inert: 0.7, phase: s * 2.4 + 3,
      });
      makeChain(head, s * 0.07, 0.2, -0.085, 5, 0.06, 0.04, 0.008, hairMat, {
        rest: 0.7, restZ: s * 0.12, droop: -0.1, k: 42, c: 3, gain: 0.3, flutter: 0.13, thick: 0.03, inert: 0.8, phase: s * 1.7 + 5,
      });
    });
    // crimson neck scarf
    const sc = add(torso, new THREE.TorusGeometry(0.098, 0.04, 10, 24), accent, 0, 0.635, 0);
    sc.rotation.x = Math.PI / 2;
    sc.scale.y = 0.85;
    makeChain(torso, 0.05, 0.625, -0.1, 6, 0.13, 0.15, 0.08, accentDS, { rest: 0.14, droop: 0.04, k: 50, c: 6, gain: 0.14, flutter: 0.08, thick: 0.014 });
    makeChain(torso, -0.04, 0.625, -0.095, 5, 0.13, 0.12, 0.07, accentDS, { rest: 0.18, droop: 0.05, k: 56, c: 6, gain: 0.14, flutter: 0.09, phase: 1.9, thick: 0.014 });
  } else if (!isB) {
    if (robotSoldier) {
      // Sealed mechanical helmet, horizontal sensor visor, ear actuators and a service antenna.
      const dome = add(head, new THREE.SphereGeometry(0.122, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.66), metal, 0, 0.2, -0.008);
      dome.scale.set(1.04, 1.1, 1.02);
      const brow = add(head, new THREE.BoxGeometry(0.205, 0.038, 0.038), laquer, 0, 0.244, 0.11, false);
      brow.rotation.x = -0.08;
      add(head, new THREE.BoxGeometry(0.178, 0.078, 0.034), laquer, 0, 0.17, 0.098, false);
      add(head, new THREE.BoxGeometry(0.15, 0.032, 0.012), dark, 0, 0.19, 0.12, false);
      add(head, new THREE.BoxGeometry(0.12, 0.012, 0.008), eyeMat, 0, 0.19, 0.132, false);
      [-1, 1].forEach((s) => {
        add(head, new THREE.BoxGeometry(0.018, 0.014, 0.008), eyeMat, s * 0.043, 0.19, 0.136, false);
        const actuator = add(head, new THREE.CylinderGeometry(0.042, 0.042, 0.032, 14), metal, s * 0.112, 0.16, -0.005, false);
        actuator.rotation.z = Math.PI / 2;
        add(head, new THREE.BoxGeometry(0.045, 0.036, 0.018), metal, s * 0.09, 0.095, 0.09, false);
        add(head, new THREE.BoxGeometry(0.012, 0.02, 0.006), dark, s * 0.026, 0.095, 0.108, false);
      });
      add(head, new THREE.BoxGeometry(0.115, 0.022, 0.035), metal, 0, 0.286, -0.008, false);
      add(head, new THREE.CylinderGeometry(0.006, 0.01, 0.07, 6), metal, 0.075, 0.326, -0.028, false);
      add(head, sph(0.013, 8, 6), eyeMat, 0.075, 0.364, -0.028, false);
    } else {
      // human soldier: topknot under a straw jingasa
      const hr = M(o.hair ?? 0x1a1414, 0.8, 0);
      const cap = add(head, new THREE.SphereGeometry(0.112, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.55), hr, 0, 0.18, -0.012);
      cap.scale.set(1, 1.05, 1.05);
      add(head, sph(0.03, 8, 6), hr, 0, 0.3, -0.04, false);
      const kasa = add(head, new THREE.ConeGeometry(0.43, 0.21, 40), M(0xa88a52, 0.95, 0, undefined, true), 0, 0.33, 0);
      kasa.castShadow = true;
      ring(head, 0.425, 0.01, 0.228, M(0x5a4528, 0.9, 0), 1);
      for (let i = 1; i < 4; i++) ring(head, 0.425 - i * 0.1, 0.004, 0.228 + i * 0.05, M(0x6f5832, 0.9, 0), 1);
      add(head, sph(0.03, 8, 6), M(0x5a4528, 0.9, 0), 0, 0.445, 0, false);
      [-1, 1].forEach((s) => {
        const st = add(head, new THREE.BoxGeometry(0.008, 0.2, 0.008), dark, s * 0.095, 0.115, 0.05, false);
        st.rotation.z = s * 0.15;
      });
      ring(head, 0.108, 0.011, 0.21, accent, 1.0);
      // face wrap
      const wrap = add(head, new THREE.CylinderGeometry(0.098, 0.088, 0.065, 16, 1, true, Math.PI * 0.12, Math.PI * 1.76), M(0x2a2830, 0.9, 0, THREE.DoubleSide, true), 0, 0.105, 0.0, false);
      wrap.rotation.y = Math.PI;
    }
  } else {
    // boss: kabuto + demon mempo + crescent crest
    const bowl = add(head, new THREE.SphereGeometry(0.128, 24, 16, 0, Math.PI * 2, 0, Math.PI * 0.58), metal, 0, 0.2, 0);
    bowl.scale.set(1, 1.05, 1.08);
    ring(head, 0.13, 0.012, 0.205, gold, 1.08);
    const brim = add(head, new THREE.CylinderGeometry(0.15, 0.135, 0.022, 24), laquer, 0, 0.215, 0.02);
    brim.scale.z = 1.1;
    const shMat = M(0x23242c, 0.4, 0.7, THREE.DoubleSide);
    for (let t = 0; t < 3; t++) {
      add(head, new THREE.CylinderGeometry(0.15 + t * 0.03, 0.17 + t * 0.035, 0.05, 20, 1, true, Math.PI * 0.42, Math.PI * 1.16), shMat, 0, 0.19 - t * 0.04, -0.01, false);
      add(head, new THREE.CylinderGeometry(0.17 + t * 0.035, 0.17 + t * 0.035, 0.008, 20, 1, true, Math.PI * 0.42, Math.PI * 1.16), gold, 0, 0.165 - t * 0.04, -0.01, false);
    }
    const mask = add(head, new THREE.SphereGeometry(0.119, 20, 12, 0, Math.PI * 2, Math.PI * 0.52, Math.PI * 0.36), M(0x6a1218, 0.35, 0.3), 0, 0.172, 0.01);
    mask.scale.set(0.94, 1.1, 1.04);
    [-1, 1].forEach((s) => {
      const tk = add(head, new THREE.ConeGeometry(0.012, 0.045, 6), M(0xeee8d8, 0.5, 0), s * 0.03, 0.098, 0.112, false);
      tk.rotation.x = 0.2;
      const brow = add(head, new THREE.BoxGeometry(0.05, 0.012, 0.014), M(0xff2a14, 0.3, 0), s * 0.042, 0.2, 0.1, false);
      brow.rotation.z = s * -0.35;
    });
    const eyeGlow = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.0, 0.25, 0.1) });
    [-1, 1].forEach((s) => add(head, new THREE.BoxGeometry(0.032, 0.01, 0.01), eyeGlow, s * 0.04, 0.184, 0.104, false));
    const crest = add(head, new THREE.TorusGeometry(0.2, 0.017, 6, 28, Math.PI * 1.15), gold, 0, 0.36, 0.11, false);
    crest.rotation.z = Math.PI * 0.925;
    add(head, new THREE.CylinderGeometry(0.03, 0.03, 0.012, 14), gold, 0, 0.275, 0.135, false).rotation.x = Math.PI / 2;
    // twin swept horns and a blade-like crest turn the kabuto into a much harsher war-helm silhouette
    const hornMat = M(0x4d1118, 0.24, 0.82);
    const hornTipMat = M(0xb4a890, 0.22, 0.86);
    [-1, 1].forEach((s) => {
      strand(head, new THREE.Vector3(s * 0.1, 0.28, -0.015), new THREE.Vector3(s * 0.72, 0.68, -0.04), 0.48, 0.06, hornMat);
      strand(head, new THREE.Vector3(s * 0.42, 0.56, -0.04), new THREE.Vector3(s * 0.4, 0.92, -0.04), 0.22, 0.028, hornTipMat);
    });
    // long white mane under the helm
    makeChain(head, 0, 0.16, -0.12, 5, 0.1, 0.16, 0.1, M(0xd8d4d0, 0.8, 0, THREE.DoubleSide), { rest: 0.12, droop: 0.02, k: 55, c: 6, gain: 0.13, flutter: 0.06, thick: 0.03 });
  }

  /* ---------- arms ---------- */
  const mkArm = (side: 1 | -1, pros: boolean): Arm => {
    const sh = grp(torso, side * 0.285, 0.505, 0); // broader shoulders
    sh.rotation.order = 'XYZ';
    add(sh, sph(0.074, 16, 12), cloth, 0, 0, 0);
    add(sh, limb(A1 + 0.01, [[0.064, 0], [0.072, 0.18], [0.07, 0.45], [0.054, 0.85], [0.05, 1]]), cloth);
    if (kind !== 'player') {
      const tiers = isB ? 3 : 2;
      for (let i = 0; i < tiers; i++) {
        const w = (isB ? 0.2 : 0.16) - i * 0.015;
        const pl = add(sh, new THREE.BoxGeometry(w, 0.014, isB ? 0.22 : 0.17), isB ? laquer : leather, side * 0.03, 0.075 - i * 0.04, 0, true);
        pl.rotation.z = side * (-0.28 - i * 0.12);
        add(pl, new THREE.BoxGeometry(w, 0.016, 0.02), isB ? gold : accent, 0, 0, isB ? 0.1 : 0.08, false);
      }
      if (isB) {
        const shoulder = add(sh, new THREE.SphereGeometry(0.16, 16, 10), laquer, side * 0.035, 0.085, -0.015);
        shoulder.scale.set(1.55, 0.78, 1.42);
        const rim = add(sh, new THREE.TorusGeometry(0.17, 0.012, 6, 20), gold, side * 0.035, 0.09, 0.035, false);
        rim.rotation.x = Math.PI / 2;
        const spikeMat = M(0x68111a, 0.23, 0.8);
        strand(sh, new THREE.Vector3(side * 0.06, 0.16, -0.02), new THREE.Vector3(side * 0.82, 0.48, -0.08), 0.36, 0.072, metal);
        strand(sh, new THREE.Vector3(side * 0.1, 0.13, 0.08), new THREE.Vector3(side * 0.28, 0.88, 0.38), 0.28, 0.052, spikeMat);
      } else if (robotSoldier) {
        const shoulder = add(sh, new THREE.SphereGeometry(0.105, 16, 10), metal, side * 0.035, 0.055, 0.005);
        shoulder.scale.set(1.35, 0.82, 1.15);
        const seam = add(sh, new THREE.BoxGeometry(0.105, 0.012, 0.018), accent, side * 0.025, 0.025, 0.092, false);
        seam.rotation.z = side * -0.28;
      }
    } else {
      add(sh, sph(0.085, 14, 10), cloth2, side * 0.01, 0.03, 0, false).scale.set(1, 0.7, 1.05);
    }
    const el = grp(sh, 0, -A1, 0);
    add(el, sph(0.052, 14, 10), pros ? metal : cloth, 0, 0, 0, false);
    add(el, limb(A2 + 0.01, [[0.05, 0], [0.057, 0.14], [0.052, 0.45], [0.04, 0.9], [0.037, 1]]), pros ? metal : cloth2);
    const bm = pros ? metal : isP ? M(0x2a2c3a, 0.8, 0.05, undefined, true) : isB ? laquer : leather;
    add(el, tube(0.21, 0.058, 0.044, 14), bm, 0, -0.09, 0);
    if (pros) {
      // Shinobi Prosthetic: ribbed metal forearm
      [-0.06, -0.12, -0.18, -0.24].forEach((y) => ring(el, 0.056 - Math.abs(y) * 0.04, 0.007, y, gold, 1).rotation.set(Math.PI / 2, 0, 0));
      add(el, tube(0.08, 0.036, 0.03, 8), dark, 0.0, -0.2, 0.05, false).rotation.x = -0.9;
    } else if (isB) {
      ring(el, 0.058, 0.007, -0.1, gold, 1);
    } else if (isP) {
      for (let i = 0; i < 4; i++) ring(el, 0.056 - i * 0.003, 0.0045, -0.08 - i * 0.04, dark, 1);
    } else if (robotSoldier) {
      ring(el, 0.056, 0.008, -0.04, dark, 1);
      ring(el, 0.051, 0.006, -0.1, metal, 1);
      ring(el, 0.045, 0.005, -0.17, accent, 1);
    }
    const wr = grp(el, 0, -A2, 0);
    const hand = add(wr, sph(0.048, 14, 12), pros ? metal : skin, 0, 0, 0);
    hand.scale.set(1.0, 1.05, 1.15);
    if (o.chibi) wr.scale.setScalar(1.45); // chunky mitts
    return { sh, el, wr };
  };
  const R = mkArm(-1, false);
  const Lf = mkArm(1, isP);

  /* ---------- katana (lives in torso space) ---------- */
  // bright white-silver steel: moderate metalness so it reads as polished white metal, not as a dark mirror
  const bladeMat = new THREE.MeshStandardMaterial({
    color: o.blade ?? 0xf4f6f8,
    metalness: 0.62,
    roughness: 0.15,
    emissive: o.bladeGlow ?? 0x2c3036,
    emissiveIntensity: 0.45,
    envMapIntensity: 1.5,
  });
  const sword = grp(torso, 0, 0, 0);
  // Kurogane's blade is doubled; the player's and ordinary enemies' katanas keep their original length.
  const bladeLength = isB ? 2.0 : 1.0;
  if (isB) sword.scale.set(1.08, 1.12, 1.08);
  const tsuka = add(sword, new THREE.CylinderGeometry(0.02, 0.022, 0.37, 12), M(0xd9d4c8, 0.7, 0), 0, -0.015, 0, false);
  tsuka.scale.x = 0.85;
  for (let i = 0; i < 8; i++) {
    const r = add(sword, new THREE.TorusGeometry(0.0235, 0.0048, 5, 14), isP ? dark : accent, 0, -0.18 + i * 0.045, 0, false);
    r.rotation.x = Math.PI / 2;
    r.scale.y = 0.85;
  }
  add(sword, sph(0.026, 10, 8), gold, 0, -0.205, 0, false);
  const tsuba = add(sword, new THREE.CylinderGeometry(0.064, 0.064, 0.012, 24), isP ? M(0x2a2630, 0.35, 0.8) : gold, 0, 0.18, 0, false);
  tsuba.scale.z = 0.9;
  add(sword, new THREE.TorusGeometry(0.056, 0.004, 6, 24), gold, 0, 0.18, 0, false).rotation.x = Math.PI / 2;
  add(sword, new THREE.CylinderGeometry(0.02, 0.02, 0.04, 8), gold, 0, 0.205, 0, false).scale.x = 0.8;
  {
    const Lb = bladeLength;
    const N = 22;
    const edge: [number, number][] = [];
    const spine: [number, number][] = [];
    const curve = (t: number) => -0.056 * t * t;
    for (let i = 0; i <= N; i++) {
      const t = (i / N) * 0.94;
      const y = t * Lb;
      const c = curve(t);
      const w = 0.052 - 0.016 * t;
      edge.push([c + w / 2, y]);
      spine.push([c - w / 2, y]);
    }
    const tipX = curve(0.99) - 0.002;
    const sh = new THREE.Shape();
    sh.moveTo(edge[0][0], edge[0][1]);
    edge.forEach(([x, y]) => sh.lineTo(x, y));
    sh.lineTo(tipX, Lb + 0.02);
    for (let i = spine.length - 1; i >= 0; i--) sh.lineTo(spine[i][0], spine[i][1]);
    sh.closePath();
    const g = new THREE.ExtrudeGeometry(sh, { depth: 0.008, bevelEnabled: false });
    g.translate(0, 0, -0.004);
    g.rotateY(-Math.PI / 2);
    g.translate(0, 0.2, 0);
    const bl = add(sword, g, bladeMat, 0, 0, 0, false);
    bl.castShadow = false;

    // hamon: wavy temper line hugging the cutting edge, on both faces
    const mkRibbon = (xOff: number) => {
      const pos: number[] = [];
      const idx: number[] = [];
      const M2 = 34;
      for (let i = 0; i <= M2; i++) {
        const t = (i / M2) * 0.93;
        const y = t * Lb + 0.2;
        const c = curve(t);
        const w = 0.052 - 0.016 * t;
        const ez = c + w / 2;
        const wave = 0.0045 + 0.0035 * Math.sin(i * 1.15) * Math.cos(i * 0.37);
        pos.push(xOff, y, ez - 0.0015, xOff, y, ez - 0.0085 - wave);
        if (i < M2) {
          const a = i * 2;
          idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
        }
      }
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      rg.setIndex(idx);
      return rg;
    };
    const hamonMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.5, 1.65, 1.8), side: THREE.DoubleSide, transparent: true, opacity: 0.55, depthWrite: false });
    [0.0042, -0.0042].forEach((x) => {
      const m = new THREE.Mesh(mkRibbon(x), hamonMat);
      sword.add(m);
    });
    // spine ridge (shinogi)
    const rid = new THREE.BoxGeometry(0.0095, Lb * 0.88, 0.006);
    rid.translate(0, Lb * 0.44 + 0.2, -0.004);
    const ridge = add(sword, rid, M(0x9aa4b0, 0.25, 0.9), 0, 0, 0, false);
    ridge.castShadow = false;
    ridge.visible = false; // curved blade → straight ridge would drift; keep hidden, hamon carries the look
  }
  const swordBase = grp(sword, 0, 0.2, 0);
  const swordTip = grp(sword, 0, 0.2 + bladeLength, -0.055);

  /* ---------- ranged weapons: yumi (bow) · tanegashima (matchlock) ---------- */
  const weapon = o.weapon ?? 'katana';
  let leftAlong = -GRIP_GAP; // where the free hand grabs the weapon (along its long axis)
  let leftEdge = 0; // …and sideways (the bow-string nock moves with the draw)
  const muzzle = grp(sword, 0, 0, 0);
  let drawFn: (d: number, nocked: boolean) => void = () => {};
  if (weapon !== 'katana') {
    for (const ch of sword.children.slice()) if (ch !== muzzle) ch.visible = false; // hide the katana parts
  }
  if (weapon === 'bow') {
    const wood = M(0x6a4526, 0.65, 0.05);
    const aWood = M(0xb89a62, 0.7, 0);
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (i / 16) * 2 - 1;
      pts.push(new THREE.Vector3(0, 0.62 * t, -0.2 * t * t));
    }
    add(sword, new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 32, 0.016, 6, false), wood, 0, 0, 0);
    add(sword, new THREE.CylinderGeometry(0.024, 0.024, 0.17, 8), dark, 0, 0, 0, false);
    for (const s of [1, -1]) add(sword, sph(0.022, 8, 6), M(0xd8cfa8, 0.6, 0), 0, s * 0.63, -0.2, false);
    const strMat = new THREE.MeshBasicMaterial({ color: 0xe0d8c0 });
    const strGeo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 4);
    const strUp = new THREE.Mesh(strGeo, strMat);
    const strDn = new THREE.Mesh(strGeo, strMat);
    sword.add(strUp, strDn);
    const arrowG = new THREE.Group();
    sword.add(arrowG);
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.9, 6), aWood);
    shaft.rotation.x = Math.PI / 2;
    shaft.position.z = 0.45;
    const ahead = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.07, 6), M(0x9aa0aa, 0.3, 0.8));
    ahead.rotation.x = Math.PI / 2;
    ahead.position.z = 0.935;
    arrowG.add(shaft, ahead);
    const tipA = new THREE.Vector3(0, 0.63, -0.2);
    const tipB = new THREE.Vector3(0, -0.63, -0.2);
    const nockV = new THREE.Vector3();
    const dV = new THREE.Vector3();
    const seg = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
      dV.subVectors(b, a);
      const len = dV.length();
      m.position.copy(a).addScaledVector(dV, 0.5);
      m.scale.set(1, len, 1);
      m.quaternion.setFromUnitVectors(UP, dV.divideScalar(len));
    };
    drawFn = (d, nocked) => {
      const nz = -0.2 - 0.52 * d;
      nockV.set(0, 0, nz);
      seg(strUp, tipA, nockV);
      seg(strDn, nockV, tipB);
      arrowG.position.set(0, 0, nz);
      arrowG.visible = nocked;
      leftEdge = nz;
    };
    drawFn(0, false);
    leftAlong = 0;
    muzzle.position.set(0, 0, 0.12);
    // quiver on the back
    const quiver = add(torso, new THREE.CylinderGeometry(0.058, 0.05, 0.5, 10), leather, 0.1, 0.3, -0.2);
    quiver.rotation.z = -0.28;
    for (let k = 0; k < 4; k++) {
      const ar = add(torso, new THREE.CylinderGeometry(0.006, 0.006, 0.22, 5), aWood, 0.16 + k * 0.014, 0.62, -0.2 + (k % 2) * 0.025, false);
      ar.rotation.z = -0.28;
      add(torso, sph(0.012, 5, 4), M(0xcc3a2a, 0.8, 0), 0.19 + k * 0.014, 0.73, -0.2 + (k % 2) * 0.025, false);
    }
  } else if (weapon === 'gun') {
    const iron = M(0x24262c, 0.35, 0.8);
    const woodG = M(0x5a3a22, 0.7, 0.05);
    const brass = M(0xb08a3a, 0.35, 0.85);
    add(sword, new THREE.CylinderGeometry(0.019, 0.022, 1.2, 8), iron, 0, 0.56, 0);
    add(sword, new THREE.BoxGeometry(0.05, 0.62, 0.07), woodG, 0, -0.1, 0.03);
    const butt = add(sword, new THREE.BoxGeometry(0.05, 0.16, 0.12), woodG, 0, -0.43, 0.07);
    butt.rotation.x = -0.25;
    add(sword, new THREE.BoxGeometry(0.06, 0.1, 0.05), iron, 0, 0.04, -0.01);
    for (const y of [0.24, 0.6, 0.96]) ring(sword, 0.027, 0.006, y, brass, 1);
    add(sword, sph(0.012, 6, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.6, 1.0, 0.3) }), 0.032, 0.06, -0.02, false);
    muzzle.position.set(0, 1.19, 0);
    leftAlong = 0.24;
    // bandolier with cartridges
    const strap = add(torso, new THREE.BoxGeometry(0.05, 0.68, 0.02), leather, 0, 0.33, 0.175, false);
    strap.rotation.z = 0.62;
    for (let k = 0; k < 6; k++) {
      const t = (k - 2.5) * 0.11;
      const cart = add(torso, new THREE.CylinderGeometry(0.014, 0.014, 0.075, 6), brass, -0.58 * t, 0.33 + 0.81 * t, 0.19, false);
      cart.rotation.z = 0.62;
    }
  }

  /* ---------- boss cape ---------- */
  if (isB) {
    makeChain(torso, 0.13, 0.56, -0.17, 6, 0.17, 0.27, 0.23, clothDS, { rest: 0.1, droop: 0.01, k: 42, c: 6, gain: 0.1, flutter: 0.05, thick: 0.014, phase: 0.4 });
    makeChain(torso, -0.13, 0.56, -0.17, 6, 0.17, 0.27, 0.23, clothDS, { rest: 0.12, droop: 0.01, k: 45, c: 6, gain: 0.1, flutter: 0.05, thick: 0.014, phase: 2.6 });
    add(torso, new THREE.BoxGeometry(0.34, 0.07, 0.04), gold, 0, 0.58, -0.17, false);
  }

  /* ---------- severable limbs: a wet red stump waits at every joint, hidden until the limb is cut off ---------- */
  const stumpMat = M(bot ? 0x263340 : 0x8c1118, bot ? 0.28 : 0.3, bot ? 0.88 : 0.05);
  if (bot) {
    stumpMat.emissive.setHex(0x08788c);
    stumpMat.emissiveIntensity = 0.9;
  }
  const mkStump = (parent: THREE.Object3D, at: THREE.Vector3, r: number) => {
    const s = add(parent, sph(r, 12, 9), stumpMat, at.x, at.y, at.z, false);
    s.visible = false;
    return s;
  };
  const limbs: Record<LimbName, THREE.Object3D> = { rArm: R.sh, lArm: Lf.sh, rLeg: RL.hp, lLeg: LL.hp };
  const stumps: Record<LimbName, THREE.Object3D> = {
    rArm: mkStump(R.sh.parent!, R.sh.position, 0.085),
    lArm: mkStump(Lf.sh.parent!, Lf.sh.position, 0.085),
    rLeg: mkStump(RL.hp.parent!, RL.hp.position, 0.11),
    lLeg: mkStump(LL.hp.parent!, LL.hp.position, 0.11),
  };
  const severedSet = new Set<LimbName>();

  /* ---------- toon torso: compact, but long enough to balance the head and leg proportions ---------- */
  // Subtle vertical compression preserves the chibi shape without making the legs dominate the silhouette.
  const torsoK = o.chibi ? 0.74 : 1;
  if (torsoK !== 1) {
    for (const ch of torso.children) {
      if (ch === sword) continue; // the sword's position is written every frame by apply()
      ch.position.y *= torsoK;
      if ((ch as THREE.Mesh).isMesh) ch.scale.y *= torsoK;
    }
  }

  /* ---------- scale & rig api ---------- */
  root.scale.setScalar(o.scale ?? 1);
  const glowBase = bladeMat.emissiveIntensity;

  const rig: Rig = {
    root,
    hips,
    torso,
    head,
    swordBase,
    swordTip,
    bladeMat,
    headObj,
    chestObj,
    gait: { rx: 0, rz: 0, rl: 0, rp: 0, lx: 0, lz: 0, ll: 0, lp: 0, sway: 0, bob: 0 },
    limbs,
    stumps,
    severed: severedSet,
    weaponObj: sword,
    sever(name: LimbName) {
      if (severedSet.has(name)) return;
      severedSet.add(name);
      limbs[name].visible = false;
      stumps[name].visible = true;
    },
    dropWeapon() {
      sword.visible = false;
    },
    legK,
    muzzle,
    setDraw(d: number, nocked: boolean) {
      drawFn(d, nocked);
    },
    bladeGlowBase: glowBase,
    apply(p: Pose) {
      // legs: pose → natural ankle spots, + live footwork offsets, then exact IK so feet stay planted
      const g = rig.gait;
      const fR = legFK(p.rhX, p.rhZ, p.rkX, -0.1);
      const rx = fR.x;
      const rz = fR.z;
      const hR = -fR.y;
      const fL = legFK(p.lhX, p.lhZ, p.lkX, 0.1);
      const lx = fL.x;
      const lz = fL.z;
      const hL = -fL.y;
      const hm = Math.max(hR, hL);
      const dyT = p.dy + g.bob;
      hips.position.y = (hm + 0.055 + dyT) * legK;
      pelvis.position.x = g.sway * legK;
      pelvis.rotation.set(p.hipX, p.hipYaw, p.hipZ);
      torso.rotation.set(p.torsoX, p.torsoY, p.torsoZ);
      head.rotation.set(p.headX, p.headY, 0);

      const zR = rz + g.rz;
      const zL = lz + g.lz;
      // light rear heel: raise the heel of whichever foot trails behind the hips while planted
      const heelR = clamp((-zR - 0.1) * 1.3, 0, 0.38) * clamp(1 - (p.rl + g.rl) * 14, 0, 1);
      const heelL = clamp((-zL - 0.1) * 1.3, 0, 0.38) * clamp(1 - (p.ll + g.ll) * 14, 0, 1);
      const pl = clamp(p.plant, 0, 1);
      const yR = -(hR + (hm + dyT - hR) * pl) + p.rl + g.rl + heelR * 0.1;
      const yL = -(hL + (hm + dyT - hL) * pl) + p.ll + g.ll + heelL * 0.1;
      solveLeg(RL, -0.1, rx + g.rx, yR, zR, g.rp + heelR, -0.1);
      solveLeg(LL, 0.1, lx + g.lx, yL, zL, g.lp + heelL, 0.1);

      // arms — FK first
      R.sh.rotation.set(p.rsX, p.rsY, p.rsZ);
      R.el.rotation.set(p.reX, 0, 0);
      R.wr.rotation.set(p.wrX, 0, p.wrZ);
      Lf.sh.rotation.set(p.lsX, p.lsY, p.lsZ);
      Lf.el.rotation.set(p.leX, 0, 0);

      const w = clamp(p.grip, 0, 1);
      R.sh.updateMatrix();
      R.el.updateMatrix();
      R.wr.updateMatrix();
      fkM.copy(R.sh.matrix).multiply(R.el.matrix).multiply(R.wr.matrix);
      fkM.decompose(fkPos, fkQ, fkS);
      fkQ.multiply(qZpi);

      swDir.set(Math.sin(p.sw) * Math.cos(p.sp), Math.sin(p.sp), Math.cos(p.sw) * Math.cos(p.sp));
      swLat.set(Math.cos(p.sw), 0, -Math.sin(p.sw));
      swEdge0.crossVectors(swLat, swDir).normalize();
      tmpV.crossVectors(swDir, swEdge0);
      swEdge.copy(swEdge0).multiplyScalar(Math.cos(p.sr)).addScaledVector(tmpV, Math.sin(p.sr)).normalize();
      swX.crossVectors(swDir, swEdge);
      basis.makeBasis(swX, swDir, swEdge);
      swQ.setFromRotationMatrix(basis);

      // keep the grip target within reach of the right shoulder so the hand never detaches
      // (grip heights are authored for the adult torso — follow the shoulders down on a toon body)
      gripR.set(p.sx, p.sy * torsoK, p.sz);
      tmpV.subVectors(gripR, R.sh.position);
      const dl = tmpV.length();
      const reach = (A1 + A2) * 0.93;
      if (dl > reach) gripR.copy(R.sh.position).addScaledVector(tmpV, reach / dl);

      swPos.copy(fkPos).lerp(gripR, w);
      fkQ.slerp(swQ, w);
      sword.position.copy(swPos);
      sword.quaternion.copy(fkQ);

      if (w > 0.001) {
        solveArm(R, gripR, -1, w);
        let wl = w * clamp(p.two, 0, 1);
        if (wl > 0.001) {
          swY.set(0, 1, 0).applyQuaternion(fkQ);
          gripL.copy(swPos).addScaledVector(swY, leftAlong);
          if (leftEdge !== 0) gripL.addScaledVector(tmpV.set(0, 0, 1).applyQuaternion(fkQ), leftEdge);
          // if the hilt is out of the left arm's reach, let that hand release instead of straining after it
          tmpV.subVectors(gripL, Lf.sh.position);
          const dll = tmpV.length();
          if (dll > reach) {
            wl *= clamp(1 - (dll - reach) / 0.22, 0, 1);
            gripL.copy(Lf.sh.position).addScaledVector(tmpV, reach / dll);
          }
          if (wl > 0.001) solveArm(Lf, gripL, 1, wl);
        }
      }
    },
    update(dt: number) {
      if (dt <= 0) return;
      clock += dt;
      root.updateMatrixWorld(true);
      const sc = root.scale.x || 1;
      for (const c of chains) updateChain(c, dt, clock, sc);
    },
    setFlash(v: number) {
      for (const m of flashMats) {
        // a faint warm-red tint on impact (no more white-out)
        m.emissive.setRGB(v * 0.2, v * 0.025, v * 0.02);
        m.emissiveIntensity = 1;
      }
    },
    setBladeGlow(v: number) {
      bladeMat.emissiveIntensity = glowBase + v * 1.6; // keep the steel readable — no blown-out blade
    },
  };
  return rig;
}
