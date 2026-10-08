import * as THREE from 'three';
import type { GameMode } from './types';

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

/**
 * NINJA RUN track layout — ONE flat level.
 *
 * The whole run happens on a single rooftop plane at y = 0: there are no steps, no second floor and
 * nothing to climb, so the ninja never travels up or down between levels. The only vertical motion in
 * the mode is the player's own jump / air-dash, and every obstacle is cleared by jumping, dashing or
 * switching lane.
 *
 * The three lanes below are DEPTH lanes: x runs toward / away from the fixed side camera (which sits
 * at negative x), so a lane change reads as the ninja slipping between three painted stripes that
 * recede into the screen — never as a change of floor.
 *
 * Order matters: index 0 is the FAR lane (lane -1, "menjauh", +x, appears higher and smaller), index 2
 * is the NEAR lane (lane +1, "mendekat", -x, appears lower and bigger). That keeps A / swipe-left /
 * the ◀ button = menjauh, exactly like the on-screen labels say.
 */
export const RUNNER_LANES = [1.9, 0, -1.9] as const;
/** Half-width of the walkable track; the low parapet sits just outside it. */
export const RUNNER_TRACK_HALF = 2.8;

/** 3D side-view environments for the Sekiro gameplay modes. The runner's scenery is tiled endlessly along +Z. */
export function buildSideWorld(scene: THREE.Scene, mode: Exclude<GameMode, 'duel'>): World {
  const runner = mode === 'runner';
  scene.background = new THREE.Color(runner ? 0xdce1e4 : 0x171922);
  scene.fog = new THREE.FogExp2(runner ? 0xdce1e4 : 0x171922, runner ? 0.006 : 0.012);

  scene.add(new THREE.HemisphereLight(runner ? 0xffffff : 0xa2a8c0, runner ? 0x90979d : 0x201b27, runner ? 1.1 : 0.58));
  const moon = new THREE.DirectionalLight(runner ? 0xffffff : 0xffc78e, runner ? 1.35 : 1.1);
  moon.position.set(-16, 24, -12);
  moon.castShadow = true;
  moon.shadow.mapSize.set(1024, 1024);
  const shadowCamera = moon.shadow.camera as THREE.OrthographicCamera;
  shadowCamera.left = -24;
  shadowCamera.right = 24;
  shadowCamera.top = 24;
  shadowCamera.bottom = -24;
  shadowCamera.near = 1;
  shadowCamera.far = 70;
  moon.shadow.bias = -0.0005;
  scene.add(moon);
  // The runner never stops, so the sun and its shadow frustum have to travel with the ninja or the
  // ground shadow (the main depth cue for the three lanes) would disappear after the first 20 m.
  const moonTarget = new THREE.Object3D();
  scene.add(moonTarget);
  moon.target = moonTarget;
  const fill = new THREE.DirectionalLight(runner ? 0xeaf4ff : 0x809bda, runner ? 0.55 : 0.48);
  fill.position.set(10, 7, 12);
  scene.add(fill);

  const flames: THREE.PointLight[] = [];
  const parkourSurfaces: ParkourSurface[] = [];
  const movingGroups: THREE.Group[] = [];
  const tileLength = 80;

  if (runner) {
    const road = new THREE.MeshStandardMaterial({ color: 0xc4c9cd, roughness: 0.9 });
    const roofSide = new THREE.MeshStandardMaterial({ color: 0xa8aeb4, roughness: 0.94 });
    const edge = new THREE.MeshStandardMaterial({ color: 0xe5e8ea, roughness: 0.82 });
    const paint = new THREE.MeshStandardMaterial({ color: 0x9aa2a9, roughness: 0.86 });
    const rail = new THREE.MeshStandardMaterial({ color: 0xd3d8dc, roughness: 0.88 });
    const roadWidth = (RUNNER_TRACK_HALF + 0.7) * 2;
    const slabDepth = 7;
    for (let i = -1; i <= 1; i++) {
      const tile = new THREE.Group();
      // ONE flat level for the whole endless run: a single thick rooftop slab whose top surface sits
      // exactly at y = 0 in every tile. There are no steps, gaps, platforms or second floors anywhere
      // on the track, so the ninja only ever leaves the ground with its own jump / air-dash. The slab
      // is deep so the portrait 9:16 frame reads a solid rooftop edge along the bottom of the screen.
      const slab = new THREE.Mesh(new THREE.BoxGeometry(roadWidth, slabDepth, tileLength), road);
      slab.position.y = -slabDepth / 2;
      slab.receiveShadow = true;
      tile.add(slab);
      // darker side face toward the camera, so the roof reads as a block rather than a floating strip
      const sideFace = new THREE.Mesh(new THREE.PlaneGeometry(tileLength, slabDepth), roofSide);
      sideFace.rotation.y = -Math.PI / 2; // normal toward -X, i.e. toward the side camera
      sideFace.position.set(-roadWidth / 2 - 0.02, -slabDepth / 2, 0);
      tile.add(sideFace);
      // A low parapet only on the FAR edge: the near edge stays open so the runner is never occluded.
      {
        const x = RUNNER_TRACK_HALF + 0.3;
        const curb = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.4, tileLength), rail);
        curb.position.set(x, 0.05, 0);
        curb.castShadow = true;
        curb.receiveShadow = true;
        tile.add(curb);
        const cap = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.06, tileLength), edge);
        cap.position.set(x, 0.28, 0);
        tile.add(cap);
      }
      // Painted edge line on the open (near) side of the roof.
      const nearLine = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.012, tileLength), edge);
      nearLine.position.set(-RUNNER_TRACK_HALF - 0.16, 0.006, 0);
      tile.add(nearLine);
      // Dashed dividers between the three depth lanes (at the midpoints of RUNNER_LANES). The dashes
      // are the main speed cue on a roof that never changes height, and one InstancedMesh keeps them
      // to a single draw call.
      const laneMid = [(RUNNER_LANES[0] + RUNNER_LANES[1]) / 2, (RUNNER_LANES[1] + RUNNER_LANES[2]) / 2];
      const dashCount = laneMid.length * 20;
      const dashes = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.014, 1.9), paint, dashCount);
      const mat4 = new THREE.Matrix4();
      let dash = 0;
      for (const x of laneMid) {
        for (let k = 0; k < 20; k++) {
          mat4.setPosition(x, 0.008, -tileLength / 2 + 2 + k * 4);
          dashes.setMatrixAt(dash++, mat4);
        }
      }
      dashes.count = dash;
      dashes.instanceMatrix.needsUpdate = true;
      tile.add(dashes);
      // Railing posts along the far parapet, also instanced — they read the run's pace past the ninja.
      const posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.14, 0.78, 0.14), rail, 10);
      for (let k = 0; k < 10; k++) {
        mat4.setPosition(RUNNER_TRACK_HALF + 0.3, 0.39, -tileLength / 2 + 4 + k * 8);
        posts.setMatrixAt(k, mat4);
      }
      posts.instanceMatrix.needsUpdate = true;
      posts.castShadow = true;
      tile.add(posts);
      tile.position.z = i * tileLength;
      scene.add(tile);
      movingGroups.push(tile);
    }

    // Repeating monochrome high-rises provide continuous parallax without ever reaching a level edge.
    // Only the FAR row can ever be seen: the side camera sits at x ≈ -11, so anything at negative x is
    // behind it. A portrait 9:16 frustum is narrow in depth, so the row is packed every 8 m (instead of
    // every 22 m) and layered at three distances — otherwise the skyline keeps blinking out.
    const facade = new THREE.MeshStandardMaterial({ color: 0xe6e9eb, roughness: 0.9 });
    const shadowFacade = new THREE.MeshStandardMaterial({ color: 0xb8bec3, roughness: 0.94 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xaab7c0, roughness: 0.48, metalness: 0.08 });
    for (let tileIndex = -1; tileIndex <= 1; tileIndex++) {
      const tile = new THREE.Group();
      for (let i = 0; i < 11; i++) {
        const width = 5 + (i % 3) * 1.6;
        const depth = 5 + ((i + 1) % 3) * 1.4;
        const height = 10 + ((i * 7) % 23);
        const x = 13 + (i % 3) * 5.5;
        const z = -tileLength / 2 + i * 8;
        // backdrop only: the sun comes from the camera side, so these never throw a shadow on the roof
        const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), i % 3 === 0 ? shadowFacade : facade);
        block.position.set(x, height / 2 - 1.8, z);
        tile.add(block);
        const roof = new THREE.Mesh(new THREE.BoxGeometry(width + 0.35, 0.22, depth + 0.35), edge);
        roof.position.set(x, height - 1.69, z);
        tile.add(roof);
        if (i % 2 === 0) {
          // the band sits on the -X face: that is the one turned toward the side camera (a band on a
          // ±Z face would only ever be seen edge-on and reads as nothing)
          const windowBand = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.17, depth * 0.72), glass);
          windowBand.position.set(x - width / 2 - 0.03, Math.max(2.4, height * 0.55 - 1.8), z);
          tile.add(windowBand);
        }
      }
      tile.position.z = tileIndex * tileLength;
      scene.add(tile);
      movingGroups.push(tile);
    }
  } else {
    // Apartment: a long, readable corridor with door bays, windows and an elevator at the far end.
    const floor = new THREE.Mesh(
      new THREE.BoxGeometry(7.2, 0.28, 78),
      new THREE.MeshStandardMaterial({ color: 0x33343a, roughness: 0.94 }),
    );
    floor.position.set(0, -0.14, 31);
    floor.receiveShadow = true;
    scene.add(floor);

    const wall = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 6.2, 82),
      new THREE.MeshStandardMaterial({ color: 0x4b4645, roughness: 0.9 }),
    );
    wall.position.set(3.45, 3.1, 30);
    wall.receiveShadow = true;
    scene.add(wall);
    const baseboard = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.32, 82), new THREE.MeshStandardMaterial({ color: 0x8b6655, roughness: 0.8 }));
    baseboard.position.set(3.19, 0.18, 30);
    scene.add(baseboard);
    const floorLine = new THREE.Mesh(new THREE.BoxGeometry(5.9, 0.018, 78), new THREE.MeshStandardMaterial({ color: 0x656064, roughness: 0.85 }));
    floorLine.position.set(0, 0.012, 31);
    scene.add(floorLine);

    const doorFrame = new THREE.MeshStandardMaterial({ color: 0xb27e55, roughness: 0.72, metalness: 0.12 });
    const doorMat = new THREE.MeshStandardMaterial({ color: 0x29272b, roughness: 0.76 });
    const windowMat = new THREE.MeshStandardMaterial({ color: 0x68809b, emissive: 0x15253b, emissiveIntensity: 0.55, roughness: 0.32 });
    for (const z of [7, 20, 33, 46]) {
      const door = new THREE.Group();
      const panel = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.55, 1.42), doorMat);
      panel.position.y = 1.29;
      const left = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.75, 0.12), doorFrame);
      left.position.set(-0.08, 1.38, -0.8);
      const right = left.clone();
      right.position.z = 0.8;
      const header = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.12, 1.72), doorFrame);
      header.position.set(-0.08, 2.76, 0);
      door.add(panel, left, right, header);
      door.position.set(3.05, 0, z);
      door.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
      scene.add(door);
      const number = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.2, 0.42), windowMat);
      number.position.set(2.94, 2.34, z - 0.55);
      scene.add(number);
    }

    for (const z of [13.5, 39.5]) {
      const window = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.15, 3.1), windowMat);
      window.position.set(3.16, 3.65, z);
      window.castShadow = false;
      scene.add(window);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.12, 3.3), doorFrame);
      sill.position.set(3.04, 2.5, z);
      scene.add(sill);
    }

    const ceilingBeam = new THREE.MeshStandardMaterial({ color: 0x282a31, roughness: 0.84 });
    for (const z of [4, 17, 30, 43, 56]) {
      const beam = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.28, 0.35), ceilingBeam);
      beam.position.set(0, 6.0, z);
      scene.add(beam);
      const lamp = new THREE.Mesh(
        new THREE.BoxGeometry(0.35, 0.08, 2.2),
        new THREE.MeshStandardMaterial({ color: 0xf7c77b, emissive: 0xe28c42, emissiveIntensity: 1.1 }),
      );
      lamp.position.set(0.5, 5.8, z + 0.3);
      scene.add(lamp);
      const light = new THREE.PointLight(0xffbd72, 1.8, 12, 1.8);
      light.position.set(0.4, 5.25, z + 0.2);
      scene.add(light);
      flames.push(light);
    }

    // The elevator door and lit sign mark the mission exit beyond the final guard.
    const elevator = new THREE.Group();
    const elevatorFrame = new THREE.Mesh(new THREE.BoxGeometry(0.7, 4.8, 4.2), doorFrame);
    elevatorFrame.position.set(2.6, 2.4, 57);
    const elevatorDoor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 4.3, 3.45), doorMat);
    elevatorDoor.position.set(2.15, 2.15, 57);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.45, 1.3), windowMat);
    sign.position.set(1.75, 5.05, 57);
    elevator.add(elevatorFrame, elevatorDoor, sign);
    elevator.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = true; o.receiveShadow = true; } });
    scene.add(elevator);
  }

  // Sparse floating dust catches the light, but the fighters and attack tells remain clear.
  const moteCount = runner ? 90 : 42;
  const motePositions = new Float32Array(moteCount * 3);
  for (let i = 0; i < moteCount; i++) {
    motePositions[i * 3] = (Math.random() - 0.5) * 7;
    motePositions[i * 3 + 1] = 0.4 + Math.random() * 5;
    motePositions[i * 3 + 2] = (Math.random() - 0.5) * (runner ? 80 : 64);
  }
  const moteGeometry = new THREE.BufferGeometry();
  moteGeometry.setAttribute('position', new THREE.BufferAttribute(motePositions, 3));
  const petals = new THREE.Points(
    moteGeometry,
    new THREE.PointsMaterial({ color: runner ? 0xffffff : 0xffcb8a, size: runner ? 0.055 : 0.035, transparent: true, opacity: runner ? 0.35 : 0.23, depthWrite: false }),
  );
  petals.frustumCulled = false;
  scene.add(petals);

  return {
    petals,
    parkourSurfaces,
    flames,
    moon,
    update(t: number, dt: number, focus?: THREE.Vector3) {
      if (runner && focus) {
        const center = Math.floor(focus.z / tileLength) * tileLength;
        let tileIndex = 0;
        for (let i = -1; i <= 1; i++, tileIndex++) {
          movingGroups[tileIndex].position.z = center + i * tileLength;
          movingGroups[tileIndex + 3].position.z = center + i * tileLength;
        }
        moon.position.z = focus.z - 12;
        moonTarget.position.set(0, 0, focus.z);
      }
      const attr = moteGeometry.attributes.position as THREE.BufferAttribute;
      for (let i = 0; i < moteCount; i++) {
        motePositions[i * 3 + 1] += Math.sin(t * 0.8 + i) * dt * 0.035;
        if (focus && Math.abs(motePositions[i * 3 + 2] + (runner ? focus.z : 0)) > (runner ? 42 : 40)) {
          motePositions[i * 3 + 2] = (Math.random() - 0.5) * (runner ? 80 : 64) - (runner ? focus.z : 0);
        }
      }
      attr.needsUpdate = true;
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
