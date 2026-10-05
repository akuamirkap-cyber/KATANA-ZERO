import * as THREE from 'three';

const pvs = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
uniform float uScale;
varying vec3 vC;
varying float vA;
void main(){
  vC = aColor; vA = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position,1.0);
  gl_PointSize = max(1.0, aSize * uScale / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const pfs = /* glsl */ `
varying vec3 vC;
varying float vA;
void main(){
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d);
  if (r > 0.5) discard;
  float a = smoothstep(0.5, 0.0, r);
  gl_FragColor = vec4(vC, a * vA);
}`;

/** Soft round particles (blood, dust, glow). */
export class Particles {
  points: THREE.Points;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private cursor = 0;
  private active: number[] = [];
  private activeFlags: Uint8Array;
  mat: THREE.ShaderMaterial;

  constructor(
    scene: THREE.Scene,
    private max: number,
    additive: boolean,
    private gravity: number,
    private drag: number,
    private grow = 0,
  ) {
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.baseSize = new Float32Array(max);
    this.activeFlags = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    (g.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.aColor as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.aSize as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.aAlpha as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.mat = new THREE.ShaderMaterial({
      vertexShader: pvs,
      fragmentShader: pfs,
      uniforms: { uScale: { value: 800 } },
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    for (let i = 0; i < max; i++) this.pos[i * 3 + 1] = -100;
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, size: number, life: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (!this.activeFlags[i]) {
      this.activeFlags[i] = 1;
      this.active.push(i);
    }
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = v.x;
    this.vel[i * 3 + 1] = v.y;
    this.vel[i * 3 + 2] = v.z;
    // additive glow particles are dimmed so they never cover the action
    const k = this.mat.blending === THREE.AdditiveBlending ? 0.4 : 1;
    this.col[i * 3] = c.r * k;
    this.col[i * 3 + 1] = c.g * k;
    this.col[i * 3 + 2] = c.b * k;
    this.baseSize[i] = size;
    this.size[i] = size;
    this.life[i] = life;
    this.maxLife[i] = life;
    this.alpha[i] = 1;
    (this.points.geometry.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
  }

  update(dt: number) {
    if (this.active.length === 0) return;
    const dragF = Math.exp(-this.drag * dt);
    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.alpha[i] = 0;
        this.pos[i * 3 + 1] = -100;
        this.activeFlags[i] = 0;
        this.active[a] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.vel[i * 3 + 1] -= this.gravity * dt;
      this.vel[i * 3] *= dragF;
      this.vel[i * 3 + 1] *= dragF;
      this.vel[i * 3 + 2] *= dragF;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02 && this.gravity > 0) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.2;
        this.vel[i * 3] *= 0.6;
        this.vel[i * 3 + 2] *= 0.6;
      }
      this.alpha[i] = Math.min(1, f * 1.6);
      this.size[i] = this.baseSize[i] * (1 + this.grow * (1 - f));
    }
    const g = this.points.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
  }

  setScale(s: number) {
    this.mat.uniforms.uScale.value = s;
  }
}

/** Streak-shaped sparks drawn as additive line segments. */
export class Sparks {
  lines: THREE.LineSegments;
  private pos: Float32Array;
  private col: Float32Array;
  private p: Float32Array;
  private v: Float32Array;
  private c: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private cursor = 0;
  private active: number[] = [];
  private activeFlags: Uint8Array;

  constructor(
    scene: THREE.Scene,
    private max = 900,
  ) {
    this.pos = new Float32Array(max * 6);
    this.col = new Float32Array(max * 6);
    this.p = new Float32Array(max * 3);
    this.v = new Float32Array(max * 3);
    this.c = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max).fill(1);
    this.activeFlags = new Uint8Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    (g.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.color as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    this.lines = new THREE.LineSegments(
      g,
      new THREE.LineBasicMaterial({
        vertexColors: true,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
        fog: false,
      }),
    );
    this.lines.frustumCulled = false;
    scene.add(this.lines);
    for (let i = 0; i < max; i++) {
      this.pos[i * 6 + 1] = -100;
      this.pos[i * 6 + 4] = -100;
    }
  }

  emit(p: THREE.Vector3, v: THREE.Vector3, c: THREE.Color, life: number) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    if (!this.activeFlags[i]) {
      this.activeFlags[i] = 1;
      this.active.push(i);
    }
    this.p[i * 3] = p.x;
    this.p[i * 3 + 1] = p.y;
    this.p[i * 3 + 2] = p.z;
    this.v[i * 3] = v.x;
    this.v[i * 3 + 1] = v.y;
    this.v[i * 3 + 2] = v.z;
    this.c[i * 3] = c.r * 0.5;
    this.c[i * 3 + 1] = c.g * 0.5;
    this.c[i * 3 + 2] = c.b * 0.5;
    this.life[i] = life;
    this.maxLife[i] = life;
  }

  update(dt: number) {
    if (this.active.length === 0) return;
    const drag = Math.exp(-1.6 * dt);
    for (let a = this.active.length - 1; a >= 0; a--) {
      const i = this.active[a];
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.life[i] = 0;
        this.pos[i * 6 + 1] = -100;
        this.pos[i * 6 + 4] = -100;
        this.col.fill(0, i * 6, i * 6 + 6);
        this.activeFlags[i] = 0;
        this.active[a] = this.active[this.active.length - 1];
        this.active.pop();
        continue;
      }
      const f = Math.max(0, this.life[i] / this.maxLife[i]);
      this.v[i * 3 + 1] -= 11 * dt;
      this.v[i * 3] *= drag;
      this.v[i * 3 + 1] *= drag;
      this.v[i * 3 + 2] *= drag;
      this.p[i * 3] += this.v[i * 3] * dt;
      this.p[i * 3 + 1] += this.v[i * 3 + 1] * dt;
      this.p[i * 3 + 2] += this.v[i * 3 + 2] * dt;
      if (this.p[i * 3 + 1] < 0.02) {
        this.p[i * 3 + 1] = 0.02;
        this.v[i * 3 + 1] *= -0.35;
      }
      const tl = 0.045;
      const o = i * 6;
      this.pos[o] = this.p[i * 3];
      this.pos[o + 1] = this.p[i * 3 + 1];
      this.pos[o + 2] = this.p[i * 3 + 2];
      this.pos[o + 3] = this.p[i * 3] - this.v[i * 3] * tl;
      this.pos[o + 4] = this.p[i * 3 + 1] - this.v[i * 3 + 1] * tl;
      this.pos[o + 5] = this.p[i * 3 + 2] - this.v[i * 3 + 2] * tl;
      const b = f * f * 1.6;
      this.col[o] = this.c[i * 3] * b;
      this.col[o + 1] = this.c[i * 3 + 1] * b;
      this.col[o + 2] = this.c[i * 3 + 2] * b;
      this.col[o + 3] = this.c[i * 3] * b * 0.1;
      this.col[o + 4] = this.c[i * 3 + 1] * b * 0.1;
      this.col[o + 5] = this.c[i * 3 + 2] * b * 0.1;
    }
    const g = this.lines.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Sword trail ribbon. */
export class Trail {
  mesh: THREE.Mesh;
  private N = 48;
  private samples: { b: THREE.Vector3; t: THREE.Vector3; age: number }[];
  private count = 0;
  private pos: Float32Array;
  private col: Float32Array;
  private color: THREE.Color;
  private life = 0.26;
  private sm = new THREE.Vector3();
  private sampleB = new THREE.Vector3();
  private sampleT = new THREE.Vector3();
  private lastB = new THREE.Vector3();
  private lastT = new THREE.Vector3();
  private hasLast = false;

  constructor(scene: THREE.Scene, color: number) {
    this.color = new THREE.Color(color);
    this.samples = Array.from({ length: this.N }, () => ({ b: new THREE.Vector3(), t: new THREE.Vector3(), age: 0 }));
    this.pos = new Float32Array(this.N * 6);
    this.col = new Float32Array(this.N * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    (g.attributes.position as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    (g.attributes.color as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
    const idx: number[] = [];
    for (let i = 0; i < this.N - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    g.setIndex(idx);
    this.mesh = new THREE.Mesh(
      g,
      new THREE.MeshBasicMaterial({
        vertexColors: true,
        transparent: true,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false,
        fog: false,
      }),
    );
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
  }

  private pushSample(base: THREE.Vector3, tip: THREE.Vector3, age: number) {
    for (let i = Math.min(this.count, this.N - 1); i > 0; i--) {
      this.samples[i].b.copy(this.samples[i - 1].b);
      this.samples[i].t.copy(this.samples[i - 1].t);
      this.samples[i].age = this.samples[i - 1].age;
    }
    this.samples[0].b.copy(base);
    this.samples[0].t.copy(tip);
    this.samples[0].age = age;
    this.count = Math.min(this.count + 1, this.N);
  }

  update(dt: number, active: boolean, base: THREE.Vector3, tip: THREE.Vector3) {
    const hadSamples = this.count > 0;
    for (let i = 0; i < this.count; i++) this.samples[i].age += dt;
    while (this.count > 0 && this.samples[this.count - 1].age > this.life) this.count--;
    if (active) {
      if (this.hasLast) {
        const dist = tip.distanceTo(this.lastT);
        if (dist > 0.01) {
          // Fill the gap travelled between frames so a fast swing remains one clean, continuous ribbon.
          const steps = Math.min(12, Math.max(0, Math.ceil(dist / 0.075) - 1));
          for (let k = 1; k <= steps; k++) {
            const f = k / (steps + 1);
            this.sampleB.copy(this.lastB).lerp(base, f);
            this.sampleT.copy(this.lastT).lerp(tip, f);
            this.pushSample(this.sampleB, this.sampleT, 0.0001);
          }
          this.pushSample(base, tip, 0);
        }
      } else {
        this.pushSample(base, tip, 0);
      }
      this.lastB.copy(base);
      this.lastT.copy(tip);
      this.hasLast = true;
    } else {
      this.hasLast = false;
    }
    if (this.count === 0 && !active && !hadSamples) return;
    for (let i = 0; i < this.N; i++) {
      const s = this.count > 0 ? this.samples[Math.min(i, this.count - 1)] : undefined;
      const o = i * 6;
      if (!s || i >= this.count) {
        for (let k = 0; k < 6; k++) this.col[o + k] = 0;
        if (s) {
          this.pos[o] = s.b.x;
          this.pos[o + 1] = s.b.y;
          this.pos[o + 2] = s.b.z;
          this.pos[o + 3] = s.t.x;
          this.pos[o + 4] = s.t.y;
          this.pos[o + 5] = s.t.z;
        }
        continue;
      }
      const f = Math.max(0, 1 - s.age / this.life);
      // The ribbon narrows as it ages: its tip draws back toward the hand, leaving a tapered crescent.
      const taper = 0.25 + 0.75 * Math.pow(f, 0.7);
      this.sm.copy(s.b).lerp(s.t, taper);
      this.pos[o] = s.b.x;
      this.pos[o + 1] = s.b.y;
      this.pos[o + 2] = s.b.z;
      this.pos[o + 3] = this.sm.x;
      this.pos[o + 4] = this.sm.y;
      this.pos[o + 5] = this.sm.z;
      // Bright at the blade edge, fading softly into the tail.
      const br = Math.pow(f, 1.6) * 0.95;
      this.col[o] = this.color.r * br * 0.1;
      this.col[o + 1] = this.color.g * br * 0.1;
      this.col[o + 2] = this.color.b * br * 0.1;
      this.col[o + 3] = this.color.r * br;
      this.col[o + 4] = this.color.g * br;
      this.col[o + 5] = this.color.b * br;
    }
    const g = this.mesh.geometry;
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }
}

/** Expanding shock rings. */
export class Shocks {
  private items: { m: THREE.Mesh; t: number; dur: number; size: number }[] = [];
  private pool: THREE.Mesh[] = [];
  constructor(scene: THREE.Scene) {
    const geo = new THREE.RingGeometry(0.85, 1, 48);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(
        geo,
        new THREE.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          side: THREE.DoubleSide,
          fog: false,
        }),
      );
      m.visible = false;
      scene.add(m);
      this.pool.push(m);
    }
  }
  spawn(p: THREE.Vector3, color: number, size: number, dur: number) {
    const m = this.pool.find((x) => !x.visible);
    if (!m) return;
    m.visible = true;
    m.position.copy(p);
    (m.material as THREE.MeshBasicMaterial).color.setHex(color);
    this.items.push({ m, t: 0, dur, size });
  }
  update(dt: number, cam: THREE.Camera) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      it.t += dt;
      const f = it.t / it.dur;
      if (f >= 1) {
        it.m.visible = false;
        this.items.splice(i, 1);
        continue;
      }
      const e = 1 - Math.pow(1 - f, 3);
      it.m.scale.setScalar(0.1 + it.size * e);
      (it.m.material as THREE.MeshBasicMaterial).opacity = (1 - f) * 0.34;
      it.m.quaternion.copy(cam.quaternion);
    }
  }
}
