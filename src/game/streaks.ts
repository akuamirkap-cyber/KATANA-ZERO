import * as THREE from 'three';

/** Razor-thin glowing slash marks, billboarded to the camera and oriented along a world-space line. */
function makeTex() {
  const W = 256;
  const H = 64;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  const img = g.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x / (W - 1)) * 2 - 1;
      const v = (y / (H - 1)) * 2 - 1;
      const core = Math.exp(-v * v * 46);
      const glow = Math.exp(-v * v * 7) * 0.1;
      const taper = Math.pow(Math.max(0, 1 - Math.abs(u)), 0.5);
      const a = Math.min(1, (core + glow) * taper);
      const i = (y * W + x) * 4;
      img.data[i] = 255;
      img.data[i + 1] = 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

interface Item {
  m: THREE.Mesh;
  t: number;
  dur: number;
  len: number;
  th: number;
  dir: THREE.Vector3;
  on: boolean;
}

const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _b = new THREE.Vector3();
const _q = new THREE.Quaternion();
const Z = new THREE.Vector3(0, 0, 1);

export class Streaks {
  private items: Item[] = [];

  constructor(scene: THREE.Scene, n = 14) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const tex = makeTex();
    for (let i = 0; i < n; i++) {
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false,
        fog: false,
        toneMapped: false,
      });
      const m = new THREE.Mesh(geo, mat);
      m.visible = false;
      m.frustumCulled = false;
      m.renderOrder = 30;
      scene.add(m);
      this.items.push({ m, t: 0, dur: 1, len: 1, th: 0.1, dir: new THREE.Vector3(1, 0, 0), on: false });
    }
  }

  spawn(pos: THREE.Vector3, dir: THREE.Vector3, len: number, th: number, color: THREE.Color, dur: number) {
    let it = this.items.find((i) => !i.on);
    if (!it) it = this.items.reduce((a, b) => (a.t / a.dur > b.t / b.dur ? a : b));
    it.on = true;
    it.t = 0;
    it.dur = dur;
    it.len = len;
    it.th = th;
    it.dir.copy(dir).normalize();
    it.m.position.copy(pos);
    // thin + dim: the line marks the cut direction without hiding the slash itself
    (it.m.material as THREE.MeshBasicMaterial).color.copy(color).multiplyScalar(0.3);
    it.m.visible = true;
  }

  update(dt: number, cam: THREE.Camera) {
    cam.matrixWorld.extractBasis(_r, _u, _b);
    for (const it of this.items) {
      if (!it.on) continue;
      it.t += dt;
      const f = it.t / it.dur;
      if (f >= 1) {
        it.on = false;
        it.m.visible = false;
        continue;
      }
      const ang = Math.atan2(it.dir.dot(_u), it.dir.dot(_r));
      it.m.quaternion.copy(cam.quaternion).multiply(_q.setFromAxisAngle(Z, ang));
      const e = 1 - Math.pow(1 - Math.min(1, f * 4), 3);
      it.m.scale.set(it.len * (0.3 + 0.7 * e), it.th * 0.45 * (1 - 0.6 * f), 1);
      (it.m.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - f, 1.8) * 0.8;
    }
  }
}
