import * as THREE from 'three';
import { outlineMat } from './rig';

/**
 * Real arbitrary-plane mesh slicing (CPU).
 *
 *  1. every mesh of the target is baked to world space and each triangle is clipped by the plane  N·(X − P) = 0
 *  2. the cut edges are welded into loops and each loop is capped with a glowing, wet "flesh" cap mesh
 *  3. every half becomes an independent rigid body: surface-area mass and centre of mass are recomputed, and the
 *     slash momentum + offset from the cut produce linear and angular velocity (so halves tumble correctly)
 *  4. halves can be sliced again (debris is just another sliceable object)
 */

export interface SliceFx {
  blood(p: THREE.Vector3, d: THREE.Vector3, n: number, speed: number): void;
  /** a piece hits the floor hard: dust + thud (power 0..1) */
  thud?(p: THREE.Vector3, power: number): void;
}

const VS = 11; // px py pz nx ny nz u v r g b

interface Baked {
  kind: 'baked';
  pos: number[];
  nor: number[];
  uv: number[];
  col: number[] | null;
  mat: THREE.Material;
  outline: boolean;
  shadow: boolean;
}
interface Inst {
  kind: 'inst';
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  M: THREE.Matrix4;
  outline: boolean;
  shadow: boolean;
  c: THREE.Vector3;
  r: number;
}
type Raw = Baked | Inst;

interface Ref {
  geo: THREE.BufferGeometry;
  mat: THREE.Material;
  M: THREE.Matrix4;
  outline: boolean;
  shadow: boolean;
  own: boolean;
}
interface CapInfo {
  p: THREE.Vector3;
  n: THREE.Vector3;
}

/** 'kz' = red gore on the cut face · 'classic' = glowing machine core */
export let sliceFxStyle: 'kz' | 'classic' = 'kz';
export function setSliceFxStyle(s: 'kz' | 'classic') {
  sliceFxStyle = s;
  capMatS = null; // rebuilt on the next cut
}
let capMatS: THREE.MeshStandardMaterial | null = null;
function capMat() {
  if (!capMatS) {
    capMatS = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: sliceFxStyle === 'kz' ? 0.3 : 0.35,
      metalness: sliceFxStyle === 'kz' ? 0.05 : 0.6,
      // kz: wet red meat · classic: molten cyan machine core
      emissive: new THREE.Color(sliceFxStyle === 'kz' ? 0x3a0206 : 0x0a2a3a),
      side: THREE.DoubleSide,
    });
  }
  return capMatS;
}

function fleshPatch(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <dithering_fragment>',
    sliceFxStyle === 'kz'
      ? 'if (!gl_FrontFacing) { gl_FragColor = vec4(0.62, 0.03, 0.05, 1.0); }\n#include <dithering_fragment>'
      : 'if (!gl_FrontFacing) { gl_FragColor = vec4(0.06, 0.55, 0.78, 1.0); }\n#include <dithering_fragment>',
  );
}

const _c = new THREE.Vector3();
const _nm = new THREE.Matrix3();
const _v = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _ax = new THREE.Vector3();
const _t = new THREE.Matrix4();

/* ---- rigid-body solver scratch (no per-frame allocations) ---- */
const MAXC = 220;
const cR = new Float32Array(MAXC * 3); // contact offsets from the centre of mass
const cPen = new Float32Array(MAXC);
const cVn0 = new Float32Array(MAXC); // approach speed before solving (decides if it bounces)
const cJn = new Float32Array(MAXC); // accumulated normal impulse (bounds the friction)
const _rr = new THREE.Vector3();
const _rn = new THREE.Vector3();
const _J = new THREE.Vector3();
const _iw = new THREE.Matrix3();
const _r3 = new THREE.Matrix3();
const _r3t = new THREE.Matrix3();
const _m4 = new THREE.Matrix4();
const GROUND_MU = 0.72;
const poolGeo = new THREE.CircleGeometry(1, 28);

function collect(src: THREE.Object3D): Ref[] {
  src.updateWorldMatrix(true, true);
  const out: Ref[] = [];
  src.traverseVisible((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = Array.isArray(m.material) ? m.material[0] : m.material;
    out.push({
      geo: m.geometry,
      mat,
      M: m.matrixWorld.clone(),
      outline: mat === (outlineMat as THREE.Material),
      shadow: m.castShadow,
      own: !!m.geometry.userData.own,
    });
  });
  return out;
}

function newBaked(ref: Ref, hasCol: boolean): Baked {
  return { kind: 'baked', pos: [], nor: [], uv: [], col: hasCol ? [] : null, mat: ref.mat, outline: ref.outline, shadow: ref.shadow };
}
function pushV(o: Baked, D: ArrayLike<number>, b: number) {
  o.pos.push(D[b], D[b + 1], D[b + 2]);
  o.nor.push(D[b + 3], D[b + 4], D[b + 5]);
  o.uv.push(D[b + 6], D[b + 7]);
  if (o.col) o.col.push(D[b + 8], D[b + 9], D[b + 10]);
}

/** Clip one mesh by the plane. Fills A (n·x ≥ d) / B (n·x < d) and records the cut segments for capping. */
function sliceRef(ref: Ref, n: THREE.Vector3, nd: number, A: Raw[], B: Raw[], segs: number[] | null) {
  const geo = ref.geo;
  const pos = geo.getAttribute('position');
  if (!pos) return;
  if (!ref.own) {
    if (!geo.boundingSphere) geo.computeBoundingSphere();
    const bs = geo.boundingSphere!;
    _c.copy(bs.center).applyMatrix4(ref.M);
    const rad = bs.radius * ref.M.getMaxScaleOnAxis() + 0.012;
    const dc = n.dot(_c) - nd;
    if (Math.abs(dc) > rad) {
      (dc > 0 ? A : B).push({
        kind: 'inst', geo, mat: ref.mat, M: ref.M, outline: ref.outline, shadow: ref.shadow, c: _c.clone(), r: rad,
      });
      return;
    }
  }
  const nor = geo.getAttribute('normal');
  const uv = geo.getAttribute('uv');
  const col = geo.getAttribute('color');
  const cnt = pos.count;
  const D = new Float32Array(cnt * VS);
  const dist = new Float32Array(cnt);
  const e = ref.M.elements;
  _nm.getNormalMatrix(ref.M);
  const ne = _nm.elements;
  for (let i = 0; i < cnt; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const b = i * VS;
    const wx = e[0] * x + e[4] * y + e[8] * z + e[12];
    const wy = e[1] * x + e[5] * y + e[9] * z + e[13];
    const wz = e[2] * x + e[6] * y + e[10] * z + e[14];
    D[b] = wx;
    D[b + 1] = wy;
    D[b + 2] = wz;
    if (nor) {
      const nx = nor.getX(i);
      const ny = nor.getY(i);
      const nz = nor.getZ(i);
      const wnx = ne[0] * nx + ne[3] * ny + ne[6] * nz;
      const wny = ne[1] * nx + ne[4] * ny + ne[7] * nz;
      const wnz = ne[2] * nx + ne[5] * ny + ne[8] * nz;
      const l = Math.hypot(wnx, wny, wnz) || 1;
      D[b + 3] = wnx / l;
      D[b + 4] = wny / l;
      D[b + 5] = wnz / l;
    } else D[b + 4] = 1;
    if (uv) {
      D[b + 6] = uv.getX(i);
      D[b + 7] = uv.getY(i);
    }
    if (col) {
      D[b + 8] = col.getX(i);
      D[b + 9] = col.getY(i);
      D[b + 10] = col.getZ(i);
    } else {
      D[b + 8] = D[b + 9] = D[b + 10] = 1;
    }
    dist[i] = n.x * wx + n.y * wy + n.z * wz - nd;
  }
  const idx = geo.index;
  const tc = idx ? idx.count / 3 : Math.floor(cnt / 3);
  const oA = newBaked(ref, !!col);
  const oB = newBaked(ref, !!col);
  const tri = [0, 0, 0];
  for (let t = 0; t < tc; t++) {
    tri[0] = idx ? idx.getX(t * 3) : t * 3;
    tri[1] = idx ? idx.getX(t * 3 + 1) : t * 3 + 1;
    tri[2] = idx ? idx.getX(t * 3 + 2) : t * 3 + 2;
    const d0 = dist[tri[0]];
    const d1 = dist[tri[1]];
    const d2 = dist[tri[2]];
    if (d0 >= 0 && d1 >= 0 && d2 >= 0) {
      pushV(oA, D, tri[0] * VS);
      pushV(oA, D, tri[1] * VS);
      pushV(oA, D, tri[2] * VS);
      continue;
    }
    if (d0 < 0 && d1 < 0 && d2 < 0) {
      pushV(oB, D, tri[0] * VS);
      pushV(oB, D, tri[1] * VS);
      pushV(oB, D, tri[2] * VS);
      continue;
    }
    // triangle straddles the plane → Sutherland–Hodgman against one plane, keep both sides
    const F: Float32Array[] = [];
    const Bk: Float32Array[] = [];
    const X: Float32Array[] = [];
    for (let k = 0; k < 3; k++) {
      const a = tri[k];
      const bI = tri[(k + 1) % 3];
      const da = dist[a];
      const db = dist[bI];
      const va = D.subarray(a * VS, a * VS + VS);
      const vb = D.subarray(bI * VS, bI * VS + VS);
      (da >= 0 ? F : Bk).push(va);
      if (da >= 0 !== db >= 0) {
        const f = da / (da - db);
        const I = new Float32Array(VS);
        for (let j = 0; j < VS; j++) I[j] = va[j] + (vb[j] - va[j]) * f;
        const l = Math.hypot(I[3], I[4], I[5]) || 1;
        I[3] /= l;
        I[4] /= l;
        I[5] /= l;
        F.push(I);
        Bk.push(I);
        X.push(I);
      }
    }
    for (let j = 1; j + 1 < F.length; j++) {
      pushV(oA, F[0], 0);
      pushV(oA, F[j], 0);
      pushV(oA, F[j + 1], 0);
    }
    for (let j = 1; j + 1 < Bk.length; j++) {
      pushV(oB, Bk[0], 0);
      pushV(oB, Bk[j], 0);
      pushV(oB, Bk[j + 1], 0);
    }
    if (segs && X.length === 2) segs.push(X[0][0], X[0][1], X[0][2], X[1][0], X[1][1], X[1][2]);
  }
  if (oA.pos.length) A.push(oA);
  if (oB.pos.length) B.push(oB);
}

/** Weld cut segments into closed loops and fan-triangulate each into a cap on both halves. */
function buildCaps(segs: number[], n: THREE.Vector3, capA: Baked, capB: Baked, infoA: CapInfo[], infoB: CapInfo[]) {
  const Q = 1500;
  const map = new Map<string, number>();
  const px: number[] = [];
  const py: number[] = [];
  const pz: number[] = [];
  const adj: number[][] = [];
  const node = (x: number, y: number, z: number) => {
    const k = Math.round(x * Q) + '_' + Math.round(y * Q) + '_' + Math.round(z * Q);
    let i = map.get(k);
    if (i === undefined) {
      i = px.length;
      map.set(k, i);
      px.push(x);
      py.push(y);
      pz.push(z);
      adj.push([]);
    }
    return i;
  };
  for (let i = 0; i < segs.length; i += 6) {
    const a = node(segs[i], segs[i + 1], segs[i + 2]);
    const b = node(segs[i + 3], segs[i + 4], segs[i + 5]);
    if (a === b) continue;
    adj[a].push(b);
    adj[b].push(a);
  }
  const used = new Set<number>();
  const ek = (a: number, b: number) => (a < b ? a * 100003 + b : b * 100003 + a);
  for (let s = 0; s < px.length; s++) {
    for (const first of adj[s]) {
      if (used.has(ek(s, first))) continue;
      const loop = [s];
      used.add(ek(s, first));
      let prev = s;
      let cur = first;
      let closed = false;
      for (let guard = 0; guard < 6000; guard++) {
        if (cur === s) {
          closed = true;
          break;
        }
        loop.push(cur);
        let next = -1;
        for (const c of adj[cur]) {
          if (c !== prev && !used.has(ek(cur, c))) {
            next = c;
            break;
          }
        }
        if (next < 0) {
          for (const c of adj[cur]) {
            if (!used.has(ek(cur, c))) {
              next = c;
              break;
            }
          }
        }
        if (next < 0) break;
        used.add(ek(cur, next));
        prev = cur;
        cur = next;
      }
      if (!closed || loop.length < 3) continue;
      let cx = 0;
      let cy = 0;
      let cz = 0;
      for (const i of loop) {
        cx += px[i];
        cy += py[i];
        cz += pz[i];
      }
      cx /= loop.length;
      cy /= loop.length;
      cz /= loop.length;
      let area = 0;
      for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const ux = px[a] - cx;
        const uy = py[a] - cy;
        const uz = pz[a] - cz;
        const vx = px[b] - cx;
        const vy = py[b] - cy;
        const vz = pz[b] - cz;
        const gx = uy * vz - uz * vy;
        const gy = uz * vx - ux * vz;
        const gz = ux * vy - uy * vx;
        area += 0.5 * Math.hypot(gx, gy, gz);
        for (const side of [0, 1]) {
          const out = side === 0 ? capA : capB;
          // A keeps n·x ≥ d, so its cut face looks toward −n; B's looks toward +n
          const flip = side === 0 ? gx * n.x + gy * n.y + gz * n.z > 0 : gx * n.x + gy * n.y + gz * n.z < 0;
          const aa = flip ? b : a;
          const bb = flip ? a : b;
          const sn = side === 0 ? -1 : 1;
          out.pos.push(cx, cy, cz, px[aa], py[aa], pz[aa], px[bb], py[bb], pz[bb]);
          for (let k = 0; k < 3; k++) out.nor.push(n.x * sn, n.y * sn, n.z * sn);
          for (let k = 0; k < 3; k++) out.uv.push(0, 0);
          // wet red centre fading to dark meat at the rim
          // kz: bright red core fading to dark meat · classic: cyan core fading to scorched metal
          if (sliceFxStyle === 'kz') out.col!.push(1.6, 0.06, 0.08, 0.3, 0.02, 0.03, 0.3, 0.02, 0.03);
          else out.col!.push(0.1, 1.5, 2.2, 0.08, 0.2, 0.3, 0.08, 0.2, 0.3);
        }
      }
      if (area > 2e-4) {
        infoA.push({ p: new THREE.Vector3(cx, cy, cz), n: n.clone().multiplyScalar(-1) });
        infoB.push({ p: new THREE.Vector3(cx, cy, cz), n: n.clone() });
      }
    }
  }
}

export class Piece {
  pivot = new THREE.Group();
  vel = new THREE.Vector3();
  ang = new THREE.Vector3();
  mass = 1;
  age = 0;
  bleed = 1.6;
  acc = 0;
  imp = new THREE.Vector3();
  hits = 0;
  pts: Float32Array = new Float32Array(0);
  capP: THREE.Vector3[] = [];
  capN: THREE.Vector3[] = [];
  mats = new Set<THREE.Material>();
  geos: THREE.BufferGeometry[] = [];
  /** inverse inertia tensor in the piece's local frame (mass-weighted from the sampled surface points) */
  invI = new THREE.Matrix3();
  /** bounding radius (for piece↔piece collisions) */
  rad = 0.3;
  /** seconds spent practically motionless while touching the ground → the body goes to sleep */
  still = 0;
  asleep = false;
  /** seconds the piece has been lying on the floor (drives the blood pool) */
  lying = 0;
  pool: THREE.Mesh | null = null;
  /** the strongest recent impact (drives landing thud / dust) */
  lastImpact = 0;
  /** cooldown so a bouncing piece doesn't spam impact effects */
  cool = 0;
  /** born during blade mode: it drifts apart gently and is blasted outward when slow-mo ends */
  gentle = false;
  /** id of the victim this piece came from — a slice only ever touches pieces of ONE victim */
  owner = 0;
}

export interface CutOpts {
  /** 0..1 — scales every separation / spin impulse (1 = a normal violent cut, <1 = a slow-motion cut that barely parts) */
  gentle?: number;
  /** victim id stamped on the resulting pieces */
  owner?: number;
  /** momentum of the slash (scalar impulse) */
  J: number;
  /** base velocity for an enemy source */
  vel?: THREE.Vector3;
  /** source piece when re-cutting debris */
  src?: Piece;
}

export class SliceWorld {
  pieces: Piece[] = [];
  constructor(private scene: THREE.Scene) {}

  private pieceMat(old: THREE.Material, cache: Map<THREE.Material, THREE.Material>, pc: Piece): THREE.Material {
    if (old === (outlineMat as THREE.Material) || old === capMatS) return old;
    let m = cache.get(old);
    if (!m) {
      const std = old as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        const c = std.clone();
        c.emissive.setRGB(0, 0, 0);
        const flesh = !!std.userData.flesh || std.side !== THREE.DoubleSide;
        if (flesh) {
          c.side = THREE.DoubleSide;
          c.userData.flesh = true;
          c.onBeforeCompile = fleshPatch;
          c.customProgramCacheKey = () => 'sliceFlesh';
        }
        m = c;
      } else m = old;
      cache.set(old, m);
    }
    if (m !== old) pc.mats.add(m);
    return m;
  }

  private build(raws: Raw[], cache: Map<THREE.Material, THREE.Material>, caps: CapInfo[]): Piece | null {
    let W = 0;
    const com = new THREE.Vector3();
    for (const r of raws) {
      if (r.outline) continue;
      if (r.kind === 'inst') {
        const w = 11 * r.r * r.r;
        com.addScaledVector(r.c, w);
        W += w;
      } else {
        const p = r.pos;
        for (let i = 0; i + 8 < p.length; i += 9) {
          const ux = p[i + 3] - p[i];
          const uy = p[i + 4] - p[i + 1];
          const uz = p[i + 5] - p[i + 2];
          const vx = p[i + 6] - p[i];
          const vy = p[i + 7] - p[i + 1];
          const vz = p[i + 8] - p[i + 2];
          const w = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
          com.x += (w * (p[i] + p[i + 3] + p[i + 6])) / 3;
          com.y += (w * (p[i + 1] + p[i + 4] + p[i + 7])) / 3;
          com.z += (w * (p[i + 2] + p[i + 5] + p[i + 8])) / 3;
          W += w;
        }
      }
    }
    if (W < 1e-4) return null;
    com.divideScalar(W);
    const pc = new Piece();
    pc.mass = W;
    pc.pivot.position.copy(com);
    _t.makeTranslation(-com.x, -com.y, -com.z);
    const pts: number[] = [];
    for (const r of raws) {
      const mat = this.pieceMat(r.mat, cache, pc);
      let mesh: THREE.Mesh;
      if (r.kind === 'inst') {
        mesh = new THREE.Mesh(r.geo, mat);
        mesh.matrixAutoUpdate = false;
        mesh.matrix.copy(r.M).premultiply(_t);
        if (!r.outline) pts.push(r.c.x - com.x, r.c.y - com.y, r.c.z - com.z, r.r);
      } else {
        const g = new THREE.BufferGeometry();
        const pa = new Float32Array(r.pos.length);
        for (let i = 0; i < pa.length; i += 3) {
          pa[i] = r.pos[i] - com.x;
          pa[i + 1] = r.pos[i + 1] - com.y;
          pa[i + 2] = r.pos[i + 2] - com.z;
        }
        g.setAttribute('position', new THREE.BufferAttribute(pa, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(r.nor), 3));
        g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(r.uv), 2));
        if (r.col) g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(r.col), 3));
        g.userData.own = true;
        pc.geos.push(g);
        mesh = new THREE.Mesh(g, mat);
        if (!r.outline) {
          const stride = Math.max(1, Math.floor(pa.length / 3 / 14)) * 3;
          for (let i = 0; i + 2 < pa.length; i += stride) pts.push(pa[i], pa[i + 1], pa[i + 2], 0);
        }
      }
      mesh.castShadow = r.shadow && !r.outline;
      mesh.frustumCulled = false;
      pc.pivot.add(mesh);
    }
    // collision points: the extreme point in 14 directions (so corners / limb tips can't sink through the floor)
    // + an even sample of everything else
    const n4 = pts.length / 4;
    const keepIdx = new Set<number>();
    const dirs: [number, number, number][] = [];
    for (const a of [-1, 1]) {
      dirs.push([a, 0, 0], [0, a, 0], [0, 0, a]);
    }
    for (const x of [-1, 1]) for (const y of [-1, 1]) for (const z of [-1, 1]) dirs.push([x, y, z]);
    for (const d of dirs) {
      let best = -1;
      let bv = -Infinity;
      for (let i = 0; i < n4; i++) {
        const v = pts[i * 4] * d[0] + pts[i * 4 + 1] * d[1] + pts[i * 4 + 2] * d[2] + pts[i * 4 + 3];
        if (v > bv) {
          bv = v;
          best = i;
        }
      }
      if (best >= 0) keepIdx.add(best);
    }
    const step = Math.max(1, Math.ceil(n4 / 90));
    for (let i = 0; i < n4; i += step) keepIdx.add(i);
    const keep: number[] = [];
    for (const i of keepIdx) keep.push(pts[i * 4], pts[i * 4 + 1], pts[i * 4 + 2], pts[i * 4 + 3]);
    pc.pts = new Float32Array(keep);
    // bounding radius + inertia tensor (point masses + small spheres), expressed around the centre of mass
    {
      const m = new THREE.Matrix3();
      const cnt = Math.max(1, pc.pts.length / 4);
      const mi = pc.mass / cnt;
      let ixx = 0, iyy = 0, izz = 0, ixy = 0, ixz = 0, iyz = 0, rad = 0;
      for (let i = 0; i < pc.pts.length; i += 4) {
        const x = pc.pts[i], y = pc.pts[i + 1], z = pc.pts[i + 2], rs = pc.pts[i + 3];
        const r2 = x * x + y * y + z * z;
        ixx += mi * (r2 - x * x);
        iyy += mi * (r2 - y * y);
        izz += mi * (r2 - z * z);
        ixy -= mi * x * y;
        ixz -= mi * x * z;
        iyz -= mi * y * z;
        const s2 = 0.4 * mi * rs * rs;
        ixx += s2; iyy += s2; izz += s2;
        rad = Math.max(rad, Math.sqrt(r2) + rs);
      }
      // keep the tensor well-conditioned (very flat halves would otherwise spin like a coin without any resistance)
      const floorI = ((ixx + iyy + izz) / 3) * 0.2 + 1e-5;
      ixx += floorI; iyy += floorI; izz += floorI;
      m.set(ixx, ixy, ixz, ixy, iyy, iyz, ixz, iyz, izz);
      pc.invI.copy(m).invert();
      pc.rad = rad;
    }
    for (const c of caps) {
      pc.capP.push(c.p.clone().sub(com));
      pc.capN.push(c.n.clone());
    }
    this.scene.add(pc.pivot);
    return pc;
  }

  /**
   * Slice any Object3D (an enemy rig, or an existing piece) with the plane (p0, n).
   * Returns the two new pieces, or null if the plane misses it.
   */
  cutObject(src: THREE.Object3D, p0: THREE.Vector3, n: THREE.Vector3, lineDir: THREE.Vector3, o: CutOpts): Piece[] | null {
    const refs = collect(src);
    const nd = n.dot(p0);
    const A: Raw[] = [];
    const B: Raw[] = [];
    const capA = newBaked({ geo: null as unknown as THREE.BufferGeometry, mat: capMat(), M: _t, outline: false, shadow: false, own: false }, true);
    const capB = newBaked({ geo: null as unknown as THREE.BufferGeometry, mat: capMat(), M: _t, outline: false, shadow: false, own: false }, true);
    const infoA: CapInfo[] = [];
    const infoB: CapInfo[] = [];
    for (const ref of refs) {
      const segs = ref.outline || ref.mat === capMatS ? null : [];
      sliceRef(ref, n, nd, A, B, segs);
      if (segs && segs.length >= 18) buildCaps(segs, n, capA, capB, infoA, infoB);
    }
    if (!A.length || !B.length) return null;
    if (capA.pos.length) A.push(capA);
    if (capB.pos.length) B.push(capB);
    const cache = new Map<THREE.Material, THREE.Material>();
    const pa = this.build(A, cache, infoA);
    const pb = this.build(B, cache, infoB);
    if (!pa || !pb) {
      for (const p of [pa, pb]) if (p) this.remove(p);
      return null;
    }
    const M = pa.mass + pb.mass;
    const out = [pa, pb];
    out.forEach((p, i) => {
      const s = i === 0 ? 1 : -1;
      const mf = clamp((2 * (i === 0 ? pb.mass : pa.mass)) / M, 0.55, 1.8); // the lighter half is flung harder
      const rel = _v.copy(p.pivot.position).sub(p0).clone();
      // inherited motion
      if (o.src) {
        const r2 = p.pivot.position.clone().sub(o.src.pivot.position);
        p.vel.copy(o.src.vel).add(new THREE.Vector3().crossVectors(o.src.ang, r2));
        p.ang.copy(o.src.ang);
        p.imp.copy(o.src.imp);
        p.hits = o.src.hits;
        p.bleed = 1.3;
      } else if (o.vel) p.vel.copy(o.vel);
      // separation impulse + slash momentum + a little pop upward
      const g = o.gentle ?? 1;
      p.gentle = g < 1 || !!o.src?.gentle;
      p.owner = o.owner ?? o.src?.owner ?? 0;
      const Jn = (1.1 + 0.2 * o.J) * mf * g;
      p.vel.addScaledVector(n, s * Jn);
      p.vel.addScaledVector(lineDir, 0.18 * o.J * g);
      p.vel.y += ((o.src ? 0.3 : 0.9) + 0.1 * o.J) * g;
      // torque about the new centre of mass: ω = (r × J) / (m·k²)
      const Jv = n.clone().multiplyScalar(s * o.J * 0.55 * mf * g).addScaledVector(lineDir, o.J * 0.15 * g);
      const w = new THREE.Vector3().crossVectors(rel, Jv).divideScalar(0.5);
      w.x += (Math.random() - 0.5) * 0.8 * g;
      w.z += (Math.random() - 0.5) * 0.8 * g;
      p.ang.add(w);
      const wMax = Math.max(1.6, 8 * g);
      if (p.ang.length() > wMax) p.ang.setLength(wMax);
      this.pieces.push(p);
    });
    if (o.src) this.remove(o.src);
    while (this.pieces.length > 30) this.remove(this.pieces[0]);
    return out;
  }

  /**
   * Turns a whole sub-tree of a live character (an arm, a leg, the held weapon) into its own free rigid body — the severed limb.
   * No triangles are cut: the meshes are simply handed over to a Piece, with a bleeding stump marker at the joint.
   * `joint` = where it was attached, `side` = which side of the cut plane the limb is on (+1 / −1).
   */
  detach(src: THREE.Object3D, joint: THREE.Vector3 | null, p0: THREE.Vector3, n: THREE.Vector3, lineDir: THREE.Vector3, side: number, o: CutOpts): Piece | null {
    const refs = collect(src);
    if (!refs.length) return null;
    const raws: Raw[] = [];
    const ctr = new THREE.Vector3();
    let cnt = 0;
    for (const ref of refs) {
      const g = ref.geo;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere!;
      const c = bs.center.clone().applyMatrix4(ref.M);
      raws.push({
        kind: 'inst',
        geo: g,
        mat: ref.mat,
        M: ref.M,
        outline: ref.outline,
        shadow: ref.shadow,
        c,
        r: bs.radius * ref.M.getMaxScaleOnAxis() + 0.012,
      });
      if (!ref.outline) {
        ctr.add(c);
        cnt++;
      }
    }
    if (cnt) ctr.divideScalar(cnt);
    const caps: CapInfo[] = [];
    if (joint) caps.push({ p: joint.clone(), n: joint.clone().sub(ctr).normalize() });
    const cache = new Map<THREE.Material, THREE.Material>();
    const pc = this.build(raws, cache, caps);
    if (!pc) return null;
    const s = side >= 0 ? 1 : -1;
    if (o.vel) pc.vel.copy(o.vel);
    // flung away from the cut plane along its normal, tossed up, and tumbling around the point it was attached to
    const g = o.gentle ?? 1;
    pc.gentle = g < 1;
    pc.owner = o.owner ?? 0;
    pc.vel.addScaledVector(n, s * (2.8 + 0.22 * o.J) * g);
    pc.vel.addScaledVector(lineDir, 0.18 * o.J * g);
    pc.vel.y += (2.2 + 0.1 * o.J) * g;
    const rel = pc.pivot.position.clone().sub(joint ?? p0);
    const Jv = n.clone().multiplyScalar(s * o.J * 0.5 * g).addScaledVector(lineDir, o.J * 0.12 * g);
    const w = new THREE.Vector3().crossVectors(rel, Jv).divideScalar(0.35);
    w.x += (Math.random() - 0.5) * 3 * g;
    w.y += (Math.random() - 0.5) * 3 * g;
    w.z += (Math.random() - 0.5) * 3 * g;
    pc.ang.copy(w);
    if (pc.ang.length() > Math.max(1.8, 11 * g)) pc.ang.setLength(Math.max(1.8, 11 * g));
    pc.bleed = 2.4;
    this.pieces.push(pc);
    while (this.pieces.length > 30) this.remove(this.pieces[0]);
    return pc;
  }

  /** Slice every piece of debris that the plane passes through (within reach of p0). */
  cutPieces(p0: THREE.Vector3, n: THREE.Vector3, lineDir: THREE.Vector3, reach: number, J: number, gentle = 1, owner?: number): number {
    let cuts = 0;
    for (const p of this.pieces.slice()) {
      if (owner !== undefined && p.owner !== owner) continue; // never touch another victim's pieces
      if (p.pivot.position.distanceTo(p0) > reach) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < p.pts.length; i += 4) {
        _v.set(p.pts[i], p.pts[i + 1], p.pts[i + 2]).applyQuaternion(p.pivot.quaternion).add(p.pivot.position);
        const d = n.dot(_v) - n.dot(p0);
        lo = Math.min(lo, d - p.pts[i + 3]);
        hi = Math.max(hi, d + p.pts[i + 3]);
      }
      if (lo > -0.02 || hi < 0.02) continue;
      p.imp.addScaledVector(lineDir, 3);
      p.hits++;
      if (this.cutObject(p.pivot, p0, n, lineDir, { J, src: p, gentle, owner: p.owner })) cuts++;
    }
    return cuts;
  }

  /**
   * Centre of the pile of pieces nearest to `from` (within maxD): the spot the next slice should go through when nothing
   * alive is left to cut. Returns null when there is nothing to carve.
   */
  clusterNear(from: THREE.Vector3, maxD: number, owner?: number): THREE.Vector3 | null {
    let best: Piece | null = null;
    let bd = maxD;
    for (const p of this.pieces) {
      if (owner !== undefined && p.owner !== owner) continue;
      const d = p.pivot.position.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    if (!best) return null;
    const c = new THREE.Vector3();
    let n = 0;
    for (const p of this.pieces) {
      if (owner !== undefined && p.owner !== owner) continue;
      if (p.pivot.position.distanceTo(best.pivot.position) < 3.2) {
        c.add(p.pivot.position);
        n++;
      }
    }
    return c.divideScalar(Math.max(1, n));
  }

  /** Victim id of the piece nearest to `from` (so the next slice keeps working on the same body). */
  ownerNear(from: THREE.Vector3, maxD: number): number | null {
    let best: Piece | null = null;
    let bd = maxD;
    for (const p of this.pieces) {
      const d = p.pivot.position.distanceTo(from);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best ? best.owner : null;
  }

  /** Is there still anything of this victim lying around to carve? */
  hasPieces(owner: number, from: THREE.Vector3, maxD: number): boolean {
    for (const p of this.pieces) if (p.owner === owner && p.pivot.position.distanceTo(from) < maxD) return true;
    return false;
  }

  /** Everything cut during blade mode flies apart at once (called when slow-mo ends). Returns the pieces that were launched. */
  burst(origin: THREE.Vector3, power: number): Piece[] {
    const out: Piece[] = [];
    for (const p of this.pieces) {
      if (!p.gentle) continue;
      p.gentle = false;
      p.asleep = false;
      p.still = 0;
      p.cool = 0;
      p.bleed = Math.max(p.bleed, 1.4);
      _rr.copy(p.pivot.position).sub(origin);
      _rr.y = 0;
      if (_rr.lengthSq() < 0.01) _rr.set(Math.random() - 0.5, 0, Math.random() - 0.5);
      _rr.normalize();
      // a natural blast: ~2–3.5 m/s outward, ~1.2–2 m/s up (a hop of a few tens of cm), a lazy tumble. Light pieces go a bit faster, but capped.
      const k = clamp((power * (0.8 + Math.random() * 0.4)) / Math.sqrt(Math.max(0.6, p.mass)), 0.55, 1.25);
      p.vel.addScaledVector(_rr, 1.5 + 1.5 * k);
      p.vel.y += 0.9 + 0.9 * k;
      p.ang.x += (Math.random() - 0.5) * 3.2 * k;
      p.ang.y += (Math.random() - 0.5) * 2.4 * k;
      p.ang.z += (Math.random() - 0.5) * 3.2 * k;
      out.push(p);
    }
    return out;
  }

  /** Blow debris apart: every piece is cut along a random plane through its centre and flung outward. */
  shatter(ps: Piece[], power: number) {
    for (const p of ps) {
      if (!this.pieces.includes(p) || p.mass < 0.25) continue;
      const nrm = new THREE.Vector3(Math.random() - 0.5, (Math.random() - 0.5) * 0.7, Math.random() - 0.5).normalize();
      const tan = new THREE.Vector3().crossVectors(nrm, new THREE.Vector3(0, 1, 0));
      if (tan.lengthSq() < 0.01) tan.set(1, 0, 0);
      tan.normalize();
      this.cutObject(p.pivot, p.pivot.position.clone(), nrm, tan, { J: power, src: p });
    }
  }

  remove(p: Piece) {
    const i = this.pieces.indexOf(p);
    if (i >= 0) this.pieces.splice(i, 1);
    this.scene.remove(p.pivot);
    if (p.pool) {
      this.scene.remove(p.pool);
      (p.pool.material as THREE.Material).dispose();
      p.pool = null;
    }
    for (const g of p.geos) g.dispose();
    for (const m of p.mats) m.dispose();
  }

  /**
   * One rigid-body sub-step for a piece:
   * gravity → integrate → collect floor contacts (every sampled surface point) → sequential-impulse solve with restitution and Coulomb
   * friction using the full world-space inverse inertia tensor → positional correction.
   * Returns the number of floor contacts.
   */
  private stepPiece(p: Piece, h: number): number {
    const q = p.pivot.quaternion;
    const pos = p.pivot.position;
    p.vel.y -= 9.8 * h;
    pos.addScaledVector(p.vel, h);
    const w = p.ang.length();
    if (w > 1e-5) {
      _ax.copy(p.ang).divideScalar(w);
      _q.setFromAxisAngle(_ax, Math.min(w * h, 0.6));
      q.premultiply(_q).normalize();
    }
    // arena rim: a soft wall so nothing ever leaves the stage
    const rr = Math.hypot(pos.x, pos.z);
    if (rr > 16) {
      const nx = pos.x / rr;
      const nz = pos.z / rr;
      pos.x = nx * 16;
      pos.z = nz * 16;
      const vo = p.vel.x * nx + p.vel.z * nz;
      if (vo > 0) {
        p.vel.x -= 1.4 * vo * nx;
        p.vel.z -= 1.4 * vo * nz;
      }
    }
    // world-space inverse inertia: R · I⁻¹ · Rᵀ
    _m4.makeRotationFromQuaternion(q);
    _r3.setFromMatrix4(_m4);
    _r3t.copy(_r3).transpose();
    _iw.copy(_r3).multiply(p.invI).multiply(_r3t);

    // contacts
    const FLOOR = 0.004;
    let nc = 0;
    let maxPen = 0;
    let impact = 0;
    const pts = p.pts;
    for (let k = 0; k < pts.length && nc < MAXC; k += 4) {
      _rr.set(pts[k], pts[k + 1], pts[k + 2]).applyQuaternion(q);
      const y = pos.y + _rr.y - pts[k + 3];
      if (y < FLOOR) {
        cR[nc * 3] = _rr.x;
        cR[nc * 3 + 1] = _rr.y - pts[k + 3]; // the contact is the underside of the sample sphere
        cR[nc * 3 + 2] = _rr.z;
        cPen[nc] = FLOOR - y;
        cJn[nc] = 0;
        const vy = p.vel.y + (p.ang.z * _rr.x - p.ang.x * _rr.z);
        cVn0[nc] = vy;
        impact = Math.max(impact, -vy);
        maxPen = Math.max(maxPen, FLOOR - y);
        nc++;
      }
    }
    if (nc > 0) {
      const invM = 1 / p.mass;
      for (let it = 0; it < 6; it++) {
        for (let c = 0; c < nc; c++) {
          const rx = cR[c * 3];
          const ry = cR[c * 3 + 1];
          const rz = cR[c * 3 + 2];
          const wx = p.ang.x;
          const wz = p.ang.z;
          // —— normal impulse ——
          const vcy = p.vel.y + (wz * rx - wx * rz);
          _rn.set(-rz, 0, rx).applyMatrix3(_iw);
          const kn = invM + (_rn.z * rx - _rn.x * rz);
          const bounce = cVn0[c] < -2.4 ? -0.24 * cVn0[c] : 0;
          let dj = (bounce - vcy) / kn;
          const nj = Math.max(0, cJn[c] + dj);
          dj = nj - cJn[c];
          cJn[c] = nj;
          if (dj !== 0) {
            // J = (0, dj, 0)  →  torque r × J = (−rz·dj, 0, rx·dj)
            p.vel.y += dj * invM;
            _J.set(-rz * dj, 0, rx * dj).applyMatrix3(_iw);
            p.ang.add(_J);
          }
          // —— Coulomb friction (flesh / cloth on gravel) ——
          const wx2 = p.ang.x;
          const wy2 = p.ang.y;
          const wz2 = p.ang.z;
          const vtx = p.vel.x + (wy2 * rz - wz2 * ry);
          const vtz = p.vel.z + (wx2 * ry - wy2 * rx);
          const vt = Math.hypot(vtx, vtz);
          if (vt > 1e-5) {
            const tx = vtx / vt;
            const tz = vtz / vt;
            _rn.set(ry * tz, rz * tx - rx * tz, -ry * tx).applyMatrix3(_iw);
            const kt = invM + (_rn.y * rz - _rn.z * ry) * tx + (_rn.x * ry - _rn.y * rx) * tz;
            const jt = clamp(-vt / kt, -GROUND_MU * cJn[c], 0);
            if (jt !== 0) {
              p.vel.x += tx * jt * invM;
              p.vel.z += tz * jt * invM;
              // torque r × J, J = (tx·jt, 0, tz·jt)
              _J.set(ry * tz * jt, (rz * tx - rx * tz) * jt, -ry * tx * jt).applyMatrix3(_iw);
              p.ang.add(_J);
            }
          }
        }
      }
      // push out of the floor (Baumgarte-style, a bit soft so resting pieces don't jitter)
      pos.y += Math.min(maxPen, 0.3) * 0.9;
      // rolling / spinning resistance: more contact points → more drag, so a piece comes to rest instead of rocking forever
      p.ang.multiplyScalar(Math.exp(-(nc >= 3 ? 2.6 : 1.1) * h));
      p.vel.x *= Math.exp(-0.15 * h);
      p.vel.z *= Math.exp(-0.15 * h);
    } else {
      p.ang.multiplyScalar(Math.exp(-0.12 * h));
      p.vel.multiplyScalar(Math.exp(-0.04 * h));
    }
    p.lastImpact = Math.max(p.lastImpact, impact);
    return nc;
  }

  update(dt: number, real: number, fx: SliceFx) {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      p.cool -= real;
      const q = p.pivot.quaternion;
      let nc = 0;
      if (p.asleep) {
        // resting bodies slowly sink into the gravel at the end of their life
        if (p.age > 8.5) p.pivot.position.y -= 0.14 * dt;
      } else if (dt > 1e-6) {
        // fixed small sub-steps: tunnelling-free and stable even for fast, fast-spinning halves
        const n = Math.min(8, Math.max(1, Math.ceil(dt / (1 / 120))));
        const h = dt / n;
        p.lastImpact = 0;
        for (let s = 0; s < n; s++) nc = Math.max(nc, this.stepPiece(p, h));
        // thud + dust on a hard landing
        if (p.lastImpact > 3.4 && p.cool <= 0 && fx.thud) {
          p.cool = 0.35;
          fx.thud(this.contactPoint(p), Math.min(1, p.lastImpact / 10));
        }
        // sleep: touching the floor and (nearly) motionless for a while → freeze
        const sp = p.vel.length();
        const sw = p.ang.length();
        if (nc > 0 && sp < 0.28 && sw < 0.4) p.still += dt;
        else p.still = 0;
        if (p.still > 0.5) {
          p.asleep = true;
          p.vel.set(0, 0, 0);
          p.ang.set(0, 0, 0);
        }
      }
      p.lying = nc > 0 || p.asleep ? p.lying + real : 0;

      // blood from every cut face (real-time driven, so slow-mo shows a continuous spurt)
      if (p.bleed > 0 && p.capP.length && !p.asleep) {
        p.bleed -= real;
        p.acc += real * 55 * Math.min(3, p.capP.length);
        let guard = 0;
        while (p.acc >= 1 && guard++ < 10) {
          p.acc -= 1;
          const ci = Math.floor(Math.random() * p.capP.length);
          const wp = p.capP[ci].clone().applyQuaternion(q).add(p.pivot.position);
          const wd = p.capN[ci].clone().applyQuaternion(q);
          fx.blood(wp, wd, 1, 2.5 + Math.random() * 4);
        }
      }

      // blood pool spreading underneath once the piece lies on the floor
      if (p.capP.length && p.lying > 0.3) {
        if (!p.pool) {
          const mat = new THREE.MeshBasicMaterial({
            color: sliceFxStyle === 'kz' ? 0x4a0409 : 0x07202c,
            transparent: true,
            opacity: 0.8,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
          });
          p.pool = new THREE.Mesh(poolGeo, mat);
          p.pool.rotation.x = -Math.PI / 2;
          p.pool.rotation.z = Math.random() * Math.PI;
          p.pool.position.y = 0.01 + Math.random() * 0.004;
          p.pool.renderOrder = 1;
          p.pool.scale.set(0.001, 0.001, 1);
          this.scene.add(p.pool);
        }
        const maxR = clamp(0.2 * Math.sqrt(p.mass), 0.35, 1.05);
        const R = maxR * (1 - Math.exp(-(p.lying - 0.3) * 0.55));
        p.pool.scale.set(R, R * 0.82, 1);
        if (!p.asleep) p.pool.position.set(p.pivot.position.x, p.pool.position.y, p.pivot.position.z);
        else if (p.pool.position.x === 0 && p.pool.position.z === 0) p.pool.position.set(p.pivot.position.x, p.pool.position.y, p.pivot.position.z);
        (p.pool.material as THREE.MeshBasicMaterial).opacity = 0.85 * clamp((12.5 - p.age) / 2.0, 0, 1);
      }

      // piece ↔ piece: soft sphere collisions so halves and limbs pile up instead of ghosting through each other
      if (!p.asleep) {
        for (let j = i + 1; j < this.pieces.length; j++) {
          const o = this.pieces[j];
          const minD = (p.rad + o.rad) * 0.5;
          _rr.copy(o.pivot.position).sub(p.pivot.position);
          const d = _rr.length();
          if (d >= minD || d < 1e-4) continue;
          _rr.divideScalar(d);
          const push = (minD - d) * 0.5;
          const mt = p.mass + o.mass;
          p.pivot.position.addScaledVector(_rr, -push * (o.mass / mt) * 2);
          o.pivot.position.addScaledVector(_rr, push * (p.mass / mt) * 2);
          _J.copy(o.vel).sub(p.vel);
          const vn = _J.dot(_rr);
          if (vn < 0) {
            const jj = (-(1.1) * vn) / (1 / p.mass + 1 / o.mass);
            p.vel.addScaledVector(_rr, -jj / p.mass);
            o.vel.addScaledVector(_rr, jj / o.mass);
            o.asleep = false;
            o.still = 0;
          }
        }
      }
      if (p.age > 12.5 || p.pivot.position.y < -1.4) this.remove(p);
    }
  }

  /** world position of the lowest point of a piece (for dust / sound on impact) */
  private contactPoint(p: Piece): THREE.Vector3 {
    let ly = Infinity;
    const out = new THREE.Vector3();
    for (let k = 0; k < p.pts.length; k += 4) {
      _rr.set(p.pts[k], p.pts[k + 1], p.pts[k + 2]).applyQuaternion(p.pivot.quaternion).add(p.pivot.position);
      if (_rr.y < ly) {
        ly = _rr.y;
        out.copy(_rr);
      }
    }
    out.y = 0.06;
    return out;
  }

  dispose() {
    for (const p of this.pieces.slice()) this.remove(p);
  }
}

function clamp(v: number, a: number, b: number) {
  return Math.min(b, Math.max(a, v));
}
