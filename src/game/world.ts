import * as THREE from 'three';

export const ARENA_HALF_EXTENT = 240;
const FIELD_SIZE = 1200;

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

export interface ParkourSurface {
  x: number;
  z: number;
  width: number;
  depth: number;
  top: number;
}

export interface World {
  petals: THREE.Points;
  parkourSurfaces: ParkourSurface[];
  flames: THREE.PointLight[];
  update(t: number, dt: number, focus?: THREE.Vector3): void;
  moon: THREE.DirectionalLight;
}

export type Theme = 'white' | 'neon';

/** Low, broad white rooftop steps sized for the existing jump, double-jump and air-dash moves. */
const PARKOUR_COURSE: ParkourSurface[] = [
  { x: 17, z: 18, width: 5.8, depth: 5, top: 0.7 },
  { x: 22, z: 25, width: 5, depth: 5, top: 1.35 },
  { x: 28, z: 32, width: 5, depth: 5, top: 2.0 },
  { x: 35, z: 39, width: 5.5, depth: 5.5, top: 2.65 },
  { x: 43, z: 45, width: 7, depth: 6, top: 3.3 },
];

function addParkourCourse(
  scene: THREE.Scene,
  sideMaterial: THREE.Material,
  topMaterial: THREE.Material,
  trimMaterial: THREE.Material,
) {
  for (const surface of PARKOUR_COURSE) {
    const bodyHeight = Math.max(0.15, surface.top - 0.12);
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(surface.width, bodyHeight, surface.depth),
      sideMaterial,
    );
    body.position.set(surface.x, bodyHeight / 2, surface.z);
    body.castShadow = true;
    body.receiveShadow = true;
    scene.add(body);

    const cap = new THREE.Mesh(
      new THREE.BoxGeometry(surface.width + 0.08, 0.12, surface.depth + 0.08),
      topMaterial,
    );
    cap.position.set(surface.x, surface.top - 0.06, surface.z);
    cap.castShadow = true;
    cap.receiveShadow = true;
    scene.add(cap);

    // Pale-gray landing marks define the edge while keeping the monochrome-white treatment.
    const mark = new THREE.Mesh(
      new THREE.PlaneGeometry(surface.width - 0.8, 0.14),
      trimMaterial,
    );
    mark.rotation.x = -Math.PI / 2;
    mark.position.set(surface.x, surface.top + 0.003, surface.z + surface.depth / 2 - 0.38);
    scene.add(mark);
  }
  return PARKOUR_COURSE.map((surface) => ({ ...surface }));
}

/** Neutral-white daylight reflections for the monochrome city, kept below mirror-bright levels. */
export function applyWhiteEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  const env = new THREE.Scene();
  env.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(220, 16, 10),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(0.76, 0.77, 0.78), side: THREE.BackSide }),
    ),
  );
  const pm = new THREE.PMREMGenerator(renderer);
  const rt = pm.fromScene(env, 0.04);
  scene.environment = rt.texture;
  scene.environmentIntensity = 0.45;
  pm.dispose();
}

/**
 * High-key monochrome city plaza with white rooftops, subtle gray windows, and a traversable parkour route.
 */
export function buildWhiteWorld(scene: THREE.Scene): World {
  scene.background = new THREE.Color(0xdfe2e4);

  // Neutral daylight, soft shadows and a restrained exposure keep the all-white city easy on the eyes.
  scene.add(new THREE.HemisphereLight(0xf0f1f2, 0xbfc3c6, 0.72));
  const moon = new THREE.DirectionalLight(0xf7f7f7, 0.78);
  moon.position.set(-25, 45, -15);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
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
  const fill = new THREE.DirectionalLight(0xe7e9eb, 0.3);
  fill.position.set(14, 7, 16);
  scene.add(fill);

  // ---------- floor ----------
  const floorTex = canvasTex(1024, (g, s) => {
    g.fillStyle = '#dfe2e4';
    g.fillRect(0, 0, s, s);
    g.strokeStyle = 'rgba(112,118,123,0.16)';
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
  floorTex.repeat.set(12, 12);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.9, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ---------- white city blocks around an open central plaza ----------
  const facadeM = new THREE.MeshStandardMaterial({ color: 0xe1e3e5, roughness: 0.9 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0xe9ebed, roughness: 0.9 });
  const ledgeM = new THREE.MeshStandardMaterial({ color: 0xd1d5d8, roughness: 0.9 });
  const windowM = new THREE.MeshStandardMaterial({ color: 0xcbd0d4, roughness: 0.72, metalness: 0 });

  const cityBlocks: [number, number, number, number, number, number][] = [
    [-54, -44, 16, 18, 24, 0.04], [-20, -66, 18, 15, 18, -0.08],
    [18, -65, 17, 18, 31, 0.06], [54, -51, 17, 17, 26, -0.07],
    [-68, -3, 20, 17, 34, 0.12], [-61, 40, 18, 18, 23, 0.04],
    [68, 0, 20, 18, 31, 0.08], [71, 50, 18, 17, 31, -0.1],
    [24, 78, 17, 20, 28, 0.04], [-22, 78, 20, 16, 32, -0.08],
    [105, 10, 22, 24, 45, 0.1], [-103, -24, 24, 18, 42, 0.18],
    [103, 84, 24, 20, 37, 0.12], [-95, 87, 24, 22, 46, -0.08],
    [43, -110, 22, 20, 38, -0.12], [-45, -116, 24, 22, 36, 0.14],
    [139, -42, 28, 24, 52, 0.12], [-143, 44, 30, 26, 48, -0.12],
  ];

  cityBlocks.forEach(([x, z, width, depth, height, rotation], index) => {
    const building = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), index % 3 === 0 ? roofM : facadeM);
    body.position.y = height / 2;
    body.castShadow = true;
    body.receiveShadow = true;
    building.add(body);

    // Thin roof lips and a raised white penthouse give each tower a readable silhouette.
    const roofLip = new THREE.Mesh(new THREE.BoxGeometry(width + 0.6, 0.32, depth + 0.6), ledgeM);
    roofLip.position.y = height + 0.16;
    roofLip.castShadow = true;
    roofLip.receiveShadow = true;
    building.add(roofLip);
    const penthouse = new THREE.Mesh(new THREE.BoxGeometry(width * 0.42, 2.2, depth * 0.44), roofM);
    penthouse.position.set(-width * 0.12, height + 1.42, -depth * 0.1);
    penthouse.castShadow = true;
    penthouse.receiveShadow = true;
    building.add(penthouse);

    // Repeated matte, white-gray window bands signal a city facade without introducing color or glare.
    const floors = Math.floor((height - 2.4) / 3.6);
    const frontWindows = new THREE.InstancedMesh(
      new THREE.BoxGeometry(width * 0.82, 0.72, 0.045), windowM, Math.max(1, floors),
    );
    const sideWindows = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.045, 0.72, depth * 0.78), windowM, Math.max(1, floors),
    );
    const dummy = new THREE.Object3D();
    for (let floor = 0; floor < floors; floor++) {
      const y = 2.15 + floor * 3.6;
      dummy.position.set(0, y, depth / 2 + 0.025);
      dummy.updateMatrix();
      frontWindows.setMatrixAt(floor, dummy.matrix);
      dummy.position.set(width / 2 + 0.025, y, 0);
      dummy.updateMatrix();
      sideWindows.setMatrixAt(floor, dummy.matrix);
    }
    frontWindows.instanceMatrix.needsUpdate = true;
    sideWindows.instanceMatrix.needsUpdate = true;
    frontWindows.castShadow = false;
    sideWindows.castShadow = false;
    building.add(frontWindows, sideWindows);

    // A few slim vertical mullions break the broad window bands into calm, legible city-scale panels.
    const mullionGeometry = new THREE.BoxGeometry(0.08, height - 1.4, 0.07);
    for (const mullionX of [-width * 0.25, width * 0.25]) {
      const mullion = new THREE.Mesh(mullionGeometry, roofM);
      mullion.position.set(mullionX, height / 2, depth / 2 + 0.06);
      building.add(mullion);
    }

    building.position.set(x, 0, z);
    building.rotation.y = rotation;
    scene.add(building);
  });

  const parkourSurfaces = addParkourCourse(
    scene,
    new THREE.MeshStandardMaterial({ color: 0xcbd0d4, roughness: 0.92 }),
    new THREE.MeshStandardMaterial({ color: 0xe9ebed, roughness: 0.9 }),
    new THREE.MeshBasicMaterial({ color: 0xb8bdc1 }),
  );

  // No circular rim or posts: the battlefield continues as an open plane.
  const flames: THREE.PointLight[] = [];

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
    new THREE.PointsMaterial({ color: 0xbfc3c6, size: 0.045, transparent: true, opacity: 0.22, depthWrite: false }),
  );
  petals.frustumCulled = false;
  scene.add(petals);

  return {
    petals,
    parkourSurfaces,
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
  moon.shadow.mapSize.set(1024, 1024);
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
    // Subtle straight inlays read as an open field, not a circular arena.
    g.strokeStyle = 'rgba(20,16,26,0.22)';
    g.lineWidth = 2;
    const step = s / 8;
    for (let i = 0; i <= 8; i++) {
      const p = i * step;
      g.beginPath();
      g.moveTo(p, 0);
      g.lineTo(p, s);
      g.stroke();
      g.beginPath();
      g.moveTo(0, p);
      g.lineTo(s, p);
      g.stroke();
    }
  });
  gravel.wrapS = gravel.wrapT = THREE.RepeatWrapping;
  gravel.repeat.set(18, 18);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(FIELD_SIZE, FIELD_SIZE),
    new THREE.MeshStandardMaterial({ map: gravel, roughness: 0.95, metalness: 0 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

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
    const x = (Math.random() - 0.5) * 150;
    const z = (Math.random() - 0.5) * 150;
    if (Math.hypot(x, z) < 24 || (z < -20 && Math.abs(x) < 20)) continue;
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
  lantern(-26, 18, false);
  lantern(26, 18, false);
  lantern(-32, 38, false);
  lantern(32, 38, false);

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
    parkourSurfaces: [],
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
