import * as THREE from 'three';

export const ARENA_R = 48;

function canvasTex(size: number, draw: (g: CanvasRenderingContext2D, s: number) => void) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/** Bake a dusk-sky environment so steel, lacquer and gold catch warm sun + cool sky reflections. */
export function applyEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const env = new THREE.Scene();
  const tex = canvasTex(256, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    gr.addColorStop(0, '#0a0620');
    gr.addColorStop(0.3, '#2a1050');
    gr.addColorStop(0.46, '#ff3a92');
    gr.addColorStop(0.5, '#7a1050');
    gr.addColorStop(0.52, '#12101e');
    gr.addColorStop(1, '#07060e');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  env.add(new THREE.Mesh(new THREE.SphereGeometry(220, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide })));
  const sun = new THREE.Mesh(new THREE.SphereGeometry(15, 16, 12), new THREE.MeshBasicMaterial({ color: new THREE.Color(13, 2.2, 7.5) }));
  sun.position.set(-60, 32, -90);
  env.add(sun);
  const cool = new THREE.Mesh(new THREE.PlaneGeometry(80, 40), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.7, 0.9, 2.4), side: THREE.DoubleSide }));
  cool.position.set(70, 35, 60);
  cool.lookAt(0, 0, 0);
  env.add(cool);
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(50, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(3.4, 0.5, 2.0), side: THREE.DoubleSide }));
  warm.position.set(0, 16, 90);
  warm.lookAt(0, 0, 0);
  env.add(warm);
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.02);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.7;
  pm.dispose();
}

export interface World {
  petals: THREE.Points;
  flames: THREE.PointLight[];
  update(t: number, dt: number): void;
  moon: THREE.DirectionalLight;
}

export type Theme = 'white' | 'neon';

/** Flat, shadowless white void for the SUPERHOT arena — everything reads as silhouette and colour. */
export function applyWhiteEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const env = new THREE.Scene();
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(220, 16, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.62, 0.63, 0.68), side: THREE.BackSide }),
    ),
  );
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.04);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.45;
  pm.dispose();
}

/**
 * SUPERHOT arena: a blinding white void. The floor is bare white with faint grid seams, the only scenery is a
 * handful of low polygonal blocks, and everything else is light. Blue sparks and black silhouettes pop hard against it.
 */
export function buildWhiteWorld(scene: THREE.Scene): World {
  scene.background = new THREE.Color(0xd9dce3);

  // ---------- light: broad and flat, with one soft key so shapes still read ----------
  scene.add(new THREE.HemisphereLight(0xdfe3ea, 0xaeb4c0, 0.75));
  const moon = new THREE.DirectionalLight(0xf2f4f8, 0.75);
  moon.position.set(-25, 45, -15);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera as THREE.OrthographicCamera;
  sc.left = -50;
  sc.right = 50;
  sc.top = 50;
  sc.bottom = -50;
  sc.near = 1;
  sc.far = 120;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  scene.add(moon);
  const fill = new THREE.DirectionalLight(0xdfe6f5, 0.3);
  fill.position.set(14, 7, 16);
  scene.add(fill);

  // ---------- floor ----------
  const floorTex = canvasTex(1024, (g, s) => {
    g.fillStyle = '#c9cdd6';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(90,100,120,0.22)';
    g.lineWidth = 2;
    const step = s / 8;
    for (let i = 0; i <= 8; i++) {
      g.beginPath();
      g.moveTo(i * step, 0);
      g.lineTo(i * step, s);
      g.stroke();
      g.beginPath();
      g.moveTo(0, i * step);
      g.lineTo(s, i * step);
      g.stroke();
    }
  });
  floorTex.wrapS = floorTex.wrapT = THREE.RepeatWrapping;
  floorTex.repeat.set(3, 3);
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_R + 1.5, 64),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.82, metalness: 0.02 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    new THREE.MeshStandardMaterial({ color: 0xcfd3db, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  scene.add(outer);

  // ---------- scenery: plain white blocks, a few red accents ----------
  const whiteM = new THREE.MeshStandardMaterial({ color: 0xe6e9ef, roughness: 0.7, metalness: 0.04 });
  const edgeM = new THREE.MeshStandardMaterial({ color: 0xb2b8c4, roughness: 0.75 });
  const redM = new THREE.MeshStandardMaterial({ color: 0xd42424, roughness: 0.5, emissive: 0x2a0000, emissiveIntensity: 0.3 });

  const block = (x: number, z: number, w: number, h: number, d: number, ry: number, red = false) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), red ? redM : whiteM);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    scene.add(m);
    // thin seam cap so the silhouette reads against the white sky
    const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 1.02, 0.03, d * 1.02), edgeM);
    cap.position.set(x, h, z);
    cap.rotation.y = ry;
    scene.add(cap);
    return m;
  };

  // low cover scattered around the ring
  const spots: [number, number, number, number, number][] = [
    [-9, -7, 1.6, 1.1, 1.6],
    [8, -9, 2.2, 0.8, 1.2],
    [11, 4, 1.2, 1.6, 1.2],
    [-11, 6, 2.6, 0.7, 1.0],
    [0, -13, 3.2, 1.3, 1.0],
    [-5, 12, 1.4, 0.9, 1.4],
    [6, 12, 1.0, 1.9, 1.0],
  ];
  spots.forEach(([x, z, w, h, d], i) => block(x, z, w, h, d, (i * 0.7) % Math.PI, i === 2 || i === 5));

  // tall slabs far out, like the empty galleries of SUPERHOT
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r = 26 + (i % 3) * 7;
    const h = 7 + (i % 4) * 4;
    const m = new THREE.Mesh(new THREE.BoxGeometry(5 + (i % 2) * 4, h, 5), whiteM);
    m.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r);
    m.rotation.y = a;
    m.castShadow = true;
    scene.add(m);
  }

  // arena rim: a clean white kerb with red marker posts
  const kerb = new THREE.Mesh(new THREE.TorusGeometry(ARENA_R + 1.3, 0.16, 8, 72), edgeM);
  kerb.rotation.x = Math.PI / 2;
  kerb.position.y = 0.16;
  kerb.receiveShadow = true;
  scene.add(kerb);
  const flames: THREE.PointLight[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    const x = Math.cos(a) * (ARENA_R + 2.6);
    const z = Math.sin(a) * (ARENA_R + 2.6);
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.2, 0.22), i % 2 ? redM : whiteM);
    post.position.set(x, 1.1, z);
    post.castShadow = true;
    scene.add(post);
  }

  // ---------- drifting white motes (replaces the petals) ----------
  const N = 260;
  const pg = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = Math.random() * 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    ph[i] = Math.random() * 10;
  }
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const petals = new THREE.Points(
    pg,
    new THREE.PointsMaterial({ color: 0x9aa4b8, size: 0.07, transparent: true, opacity: 0.5, depthWrite: false }),
  );
  petals.frustumCulled = false;
  scene.add(petals);

  return {
    petals,
    flames,
    moon,
    update(t: number, dt: number) {
      const a = pg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        pos[i * 3] += Math.sin(t * 0.5 + ph[i]) * 0.22 * dt;
        pos[i * 3 + 1] -= (0.22 + Math.sin(ph[i]) * 0.1) * dt;
        pos[i * 3 + 2] += Math.cos(t * 0.4 + ph[i]) * 0.2 * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 12;
          pos[i * 3] = (Math.random() - 0.5) * 50;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
        }
      }
      a.needsUpdate = true;
    },
  };
}

export function buildWorld(scene: THREE.Scene): World {
  // ---------- sky ----------
  const skyTex = canvasTex(512, (g, s) => {
    const gr = g.createLinearGradient(0, 0, 0, s);
    // neon-noir night: deep indigo overhead bleeding into magenta city haze at the horizon
    gr.addColorStop(0, '#05030e');
    gr.addColorStop(0.32, '#140a2e');
    gr.addColorStop(0.58, '#3d1046');
    gr.addColorStop(0.78, '#8a1a5c');
    gr.addColorStop(0.9, '#d4277e');
    gr.addColorStop(1, '#ff4f9e');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false, depthWrite: false }),
  );
  // map gradient vertically: sphere uv.y = 0 bottom → flip so horizon (bottom of texture) sits near equator
  skyTex.wrapS = THREE.ClampToEdgeWrapping;
  scene.add(sky);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const sp: number[] = [];
  for (let i = 0; i < 400; i++) {
    const th = Math.random() * Math.PI * 2;
    const ph = Math.random() * 0.9 + 0.1;
    const r = 190;
    sp.push(Math.cos(th) * Math.sin(ph) * r * 0.9, Math.cos(ph) * r, Math.sin(th) * Math.sin(ph) * r * 0.9);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  scene.add(
    new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffeedd, size: 1.2, fog: false, sizeAttenuation: false })),
  );

  // sun/moon disc with glow
  const glowTex = canvasTex(256, (g, s) => {
    const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    gr.addColorStop(0, 'rgba(255,240,210,1)');
    gr.addColorStop(0.18, 'rgba(255,210,150,0.95)');
    gr.addColorStop(0.4, 'rgba(255,140,80,0.35)');
    gr.addColorStop(1, 'rgba(255,100,60,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, s, s);
  });
  const sun = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending }),
  );
  sun.position.set(-70, 30, -150);
  sun.scale.setScalar(120);
  scene.add(sun);

  // ---------- lights ----------
  scene.add(new THREE.HemisphereLight(0x5a4a9a, 0x180c22, 0.5));
  const moon = new THREE.DirectionalLight(0xff5aa8, 2.1); // magenta neon key light
  moon.position.set(-14, 16, -12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(2048, 2048);
  const sc = moon.shadow.camera as THREE.OrthographicCamera;
  sc.left = -20;
  sc.right = 20;
  sc.top = 20;
  sc.bottom = -20;
  sc.near = 1;
  sc.far = 60;
  moon.shadow.bias = -0.0004;
  moon.shadow.normalBias = 0.03;
  scene.add(moon);
  const rim = new THREE.DirectionalLight(0x2ad8ff, 1.15); // cyan rim from the far side
  rim.position.set(15, 8, 14);
  scene.add(rim);

  // ---------- ground ----------
  const gravel = canvasTex(1024, (g, s) => {
    g.fillStyle = '#211d2e';
    g.fillRect(0, 0, s, s);
    const img = g.getImageData(0, 0, s, s);
    for (let i = 0; i < img.data.length; i += 4) {
      const n = (Math.random() - 0.5) * 34;
      img.data[i] += n;
      img.data[i + 1] += n;
      img.data[i + 2] += n;
    }
    g.putImageData(img, 0, 0);
    // raked concentric lines
    g.strokeStyle = 'rgba(20,16,26,0.35)';
    g.lineWidth = 2;
    for (let r = 20; r < s * 0.5; r += 14) {
      g.beginPath();
      g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
    g.strokeStyle = 'rgba(255,230,210,0.07)';
    for (let r = 27; r < s * 0.5; r += 14) {
      g.beginPath();
      g.arc(s / 2, s / 2, r, 0, Math.PI * 2);
      g.stroke();
    }
  });
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(ARENA_R + 1.5, 64),
    new THREE.MeshStandardMaterial({ map: gravel, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  const outer = new THREE.Mesh(
    new THREE.CircleGeometry(160, 48),
    new THREE.MeshStandardMaterial({ color: 0x1d1a24, roughness: 1 }),
  );
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.03;
  outer.receiveShadow = true;
  scene.add(outer);

  // stone ring edge
  const stoneM = new THREE.MeshStandardMaterial({ color: 0x5b5560, roughness: 0.9 });
  for (let i = 0; i < 56; i++) {
    const a = (i / 56) * Math.PI * 2;
    const s = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.35, 0.6), stoneM);
    s.position.set(Math.cos(a) * (ARENA_R + 1.3), 0.15, Math.sin(a) * (ARENA_R + 1.3));
    s.rotation.y = -a + Math.PI / 2;
    s.castShadow = true;
    s.receiveShadow = true;
    scene.add(s);
  }

  // ---------- torii gates ----------
  const red = new THREE.MeshStandardMaterial({ color: 0xa8231e, roughness: 0.6, metalness: 0.1 });
  const black = new THREE.MeshStandardMaterial({ color: 0x15121a, roughness: 0.7 });
  const torii = (x: number, z: number, ry: number, sc = 1) => {
    const g = new THREE.Group();
    const pillar = new THREE.CylinderGeometry(0.4, 0.46, 9, 12);
    const p1 = new THREE.Mesh(pillar, red);
    p1.position.set(-3.6, 4.5, 0);
    const p2 = p1.clone();
    p2.position.x = 3.6;
    const beam = new THREE.Mesh(new THREE.BoxGeometry(11.5, 0.7, 0.8), black);
    beam.position.y = 9.4;
    const beam2 = new THREE.Mesh(new THREE.BoxGeometry(9, 0.45, 0.6), red);
    beam2.position.y = 7.6;
    const top = new THREE.Mesh(new THREE.BoxGeometry(12.6, 0.3, 1.1), black);
    top.position.y = 9.9;
    [p1, p2, beam, beam2, top].forEach((m) => {
      m.castShadow = true;
      g.add(m);
    });
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    g.scale.setScalar(sc);
    scene.add(g);
  };
  torii(0, -27, 0, 1.2);
  torii(0, -40, 0, 1.6);

  // ---------- temple backdrop ----------
  const wood = new THREE.MeshStandardMaterial({ color: 0x3b2418, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0x1e1b26, roughness: 0.8 });
  const temple = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(30, 1.2, 14), new THREE.MeshStandardMaterial({ color: 0x4a4350 }));
  base.position.y = 0.6;
  const walls = new THREE.Mesh(new THREE.BoxGeometry(24, 7, 10), wood);
  walls.position.y = 4.7;
  const roof1 = new THREE.Mesh(new THREE.CylinderGeometry(4, 20, 5, 4, 1), roofM);
  roof1.rotation.y = Math.PI / 4;
  roof1.scale.set(1.15, 1, 0.6);
  roof1.position.y = 10.5;
  const roof2 = roof1.clone();
  roof2.scale.set(0.75, 0.9, 0.4);
  roof2.position.y = 14.5;
  for (let i = -5; i <= 5; i++) {
    const c = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 8), red);
    c.position.set(i * 2.3, 4.7, 5.3);
    c.castShadow = true;
    temple.add(c);
  }
  [base, walls, roof1, roof2].forEach((m) => {
    m.castShadow = true;
    m.receiveShadow = true;
    temple.add(m);
  });
  temple.position.set(0, 0, -55);
  scene.add(temple);

  // mountains
  const mtM = new THREE.MeshBasicMaterial({ color: 0x1b1330, fog: true });
  for (let i = 0; i < 14; i++) {
    const a = -Math.PI * 0.95 + (i / 13) * Math.PI * 0.9;
    const r = 120 + Math.random() * 30;
    const h = 30 + Math.random() * 45;
    const m = new THREE.Mesh(new THREE.ConeGeometry(25 + Math.random() * 20, h, 5), mtM);
    m.position.set(Math.cos(a) * r, h / 2 - 2, Math.sin(a) * r);
    scene.add(m);
  }

  // ---------- trees (cherry blossoms) ----------
  const trunkM = new THREE.MeshStandardMaterial({ color: 0x2c1b17, roughness: 1 });
  const blossomM = new THREE.MeshStandardMaterial({ color: 0xff4f9e, roughness: 0.85, emissive: 0x8a1050, emissiveIntensity: 1.1 });
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + Math.random() * 0.2;
    const r = ARENA_R + 6 + Math.random() * 14;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z < -20 && Math.abs(x) < 20) continue;
    const g = new THREE.Group();
    const h = 4 + Math.random() * 2.5;
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.5, h, 7), trunkM);
    tr.position.y = h / 2;
    tr.castShadow = true;
    g.add(tr);
    for (let k = 0; k < 4; k++) {
      const b = new THREE.Mesh(new THREE.IcosahedronGeometry(1.8 + Math.random() * 1.2, 1), blossomM);
      b.position.set((Math.random() - 0.5) * 3.2, h + Math.random() * 1.4, (Math.random() - 0.5) * 3.2);
      b.scale.y = 0.65;
      b.castShadow = true;
      g.add(b);
    }
    g.position.set(x, 0, z);
    scene.add(g);
  }

  // ---------- stone lanterns ----------
  const flames: THREE.PointLight[] = [];
  const lanternM = new THREE.MeshStandardMaterial({ color: 0x6d6670, roughness: 0.9 });
  const fireM = new THREE.MeshBasicMaterial({ color: 0xffb060 });
  const lantern = (x: number, z: number, real: boolean) => {
    const g = new THREE.Group();
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 0.5, 6), lanternM);
    b.position.y = 0.25;
    const p = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.1, 6), lanternM);
    p.position.y = 1.0;
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.55, 0.62), lanternM);
    box.position.y = 1.8;
    const fire = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), fireM);
    fire.position.y = 1.8;
    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.45, 4), lanternM);
    roof.position.y = 2.28;
    roof.rotation.y = Math.PI / 4;
    [b, p, box, roof].forEach((m) => {
      m.castShadow = true;
      g.add(m);
    });
    g.add(fire);
    const halo = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: glowTex, fog: false, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.28 }),
    );
    halo.position.y = 1.8;
    halo.scale.setScalar(2.4);
    g.add(halo);
    g.position.set(x, 0, z);
    scene.add(g);
    if (real) {
      // neon lamps: alternating cyan / magenta
      const l = new THREE.PointLight(flames.length % 2 ? 0xff2fb0 : 0x2ad8ff, 20, 16, 1.6);
      l.position.set(x, 1.9, z);
      scene.add(l);
      flames.push(l);
    }
  };
  lantern(-10, -9, true);
  lantern(10, -9, true);
  lantern(0, 12.5, true);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.4;
    lantern(Math.cos(a) * (ARENA_R + 3), Math.sin(a) * (ARENA_R + 3), false);
  }

  // ---------- petals ----------
  const N = 500;
  const pg = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  const ph = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 50;
    pos[i * 3 + 1] = Math.random() * 12;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
    ph[i] = Math.random() * 10;
  }
  pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const petals = new THREE.Points(
    pg,
    new THREE.PointsMaterial({ color: 0xffb7c8, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }),
  );
  petals.frustumCulled = false;
  scene.add(petals);

  return {
    petals,
    flames,
    moon,
    update(t: number, dt: number) {
      const a = pg.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < N; i++) {
        pos[i * 3] += (Math.sin(t * 0.7 + ph[i]) * 0.5 + 0.9) * dt;
        pos[i * 3 + 1] -= (0.5 + Math.sin(ph[i]) * 0.2) * dt;
        pos[i * 3 + 2] += Math.cos(t * 0.5 + ph[i]) * 0.3 * dt;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 12;
          pos[i * 3] = (Math.random() - 0.5) * 50;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 50;
        }
        if (pos[i * 3] > 25) pos[i * 3] = -25;
      }
      a.needsUpdate = true;
      flames.forEach((l, i) => {
        l.intensity = 22 + Math.sin(t * 9 + i * 2) * 2.5 + Math.sin(t * 23 + i) * 1.5;
      });
    },
  };
}
