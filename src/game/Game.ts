import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { Rig, Pose, PoseKey, KEYS, LimbName, createHumanoid, clonePose, copyPose, blendInto, sampleFrames, footStance, feetPose as makeFeetPose, LEG_K, IDLE } from './rig';
import { AnimDef, HitDef, P, PLAYER_COMBO, DEATHBLOW, KICK, enemyAttack, EnemyAttackName } from './anims';
import { Loco, LocoOut, newLoco, newOut, stepLoco } from './locomotion';
import { Sfx } from './audio';
import { Particles, Sparks, Trail, Shocks } from './fx';
import { buildWorld, buildWhiteWorld, applyEnvironment, applyWhiteEnvironment, Theme, World, ARENA_HALF_EXTENT } from './world';
import type { Snapshot, GameEvent, EnemyView, CombatMode } from './types';
import {
  applyArcs, buildCut, AIM_POSE, buildDodge, DodgeKind, FLIP_OPEN, LAND_HERO_ANIM, LAND_BACK_ANIM,
  EVADE_SIDE, EVADE_BACK, PARRY_POSE, IMPALE, IMPALED_POSE, TUMBLE_POSE,
} from './anims';
import { Streaks } from './streaks';
import { SliceWorld, Piece, setSliceFxStyle } from './slice';
import { Afterimages } from './ghosts';
import { STYLES, StyleDef, STYLE_CHIBURI, STYLE_JODAN } from './styles';
import { Projectiles, Proj } from './projectiles';
import { IDLE_BOW, IDLE_GUN, rangedAttack, RangedAttackName } from './ranged';

type EKind = 'blade' | 'archer' | 'gunner' | 'boss';
import { RageShader } from './ragepass';

/** Actions the on-screen mobile controls can fire. Mirrors the keyboard / mouse bindings. */
export type TouchAction =
  | 'attack'
  | 'jump'
  | 'dash'
  | 'guard'
  | 'finisher'
  | 'kick'
  | 'heal'
  | 'rage'
  | 'target'
  | 'lock'
  | 'pause';

interface CutPlane {
  p0: THREE.Vector3;
  normal: THREE.Vector3;
  lineDir: THREE.Vector3;
  perfect: boolean;
  /** the last slash of blade mode (right-click): the only one that kills */
  final?: boolean;
}

const DEFLECT_WINDOW = 0.2;
const CLOSE_ATTACK_RANGE = 4.5;
const CLOSE_PIECE_RANGE = 7;
const HEAVY_BOSS_SCALE = 2;
const HEAVY_BOSS_BODY_RADIUS = 1.2;
const HEAVY_BOSS_ATTACK_RANGE = 6.2;
const ROBOT_SPARK = new THREE.Color(0.8, 3.1, 4.6);
const ROBOT_GLOW = new THREE.Color(0.06, 1.25, 2.4);

/* ---------------- helpers ---------------- */
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const angDiff = (a: number, b: number) => {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
};
const turnToward = (cur: number, target: number, step: number) => {
  const d = angDiff(cur, target);
  return cur + clamp(d, -step, step);
};
const fwd = (yaw: number) => new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
const TAU = Math.PI * 2;
/** how hard a slow-motion cut pushes its halves apart (1 = a normal violent cut) — low, so nothing flies away while time crawls */
const SLOW_CUT = 0.28;
export type SizeMode = 'normal' | 'chibi';
/** 'kz' = Katana ZERO: flat neon-red arterial bursts and hard white flashes · 'classic' = the electric-blue machine look */
export type FxStyle = 'kz' | 'classic';
/** overall body scale of the toon (Zelda / Link) fighters */
const CHIBI_K = 0.78;
const smooth01 = (x: number) => {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
};

/** Spring damping per pose channel: <1 overshoots a little (whip / follow-through), >1 is overdamped (no wobble). */
const DAMP = {} as Record<PoseKey, number>;
for (const k of KEYS) DAMP[k] = 0.82;
for (const k of ['sp', 'sw', 'sr'] as PoseKey[]) DAMP[k] = 0.55;
for (const k of ['sx', 'sy', 'sz'] as PoseKey[]) DAMP[k] = 0.7;
for (const k of ['torsoX', 'torsoY', 'hipYaw'] as PoseKey[]) DAMP[k] = 0.66;
for (const k of ['grip', 'two', 'plant', 'rl', 'll', 'dy'] as PoseKey[]) DAMP[k] = 1.15;
const zeroPose = (): Pose => {
  const o = clonePose(IDLE);
  for (const k of KEYS) o[k] = 0;
  return o;
};

type EnemyState =
  | 'spawn' | 'idle' | 'attack' | 'evade' | 'parry' | 'flinch' | 'recoil' | 'stagger' | 'kicked'
  | 'impaled' | 'tumble' | 'broken' | 'dying' | 'dead';
type PlayerState =
  | 'idle' | 'attack' | 'dodge' | 'jump' | 'hurt' | 'broken' | 'heal' | 'stomp' | 'deathblow' | 'recoil' | 'cutaim' | 'cut' | 'style' | 'dive' | 'land' | 'impale' | 'dead';

interface Foot {
  wx: number;
  wz: number;
  stepping: boolean;
  t: number;
  dur: number;
  fx: number;
  fz: number;
  tx: number;
  tz: number;
  lift: number;
  pitch: number;
  init: boolean;
}
const newFoot = (): Foot => ({
  wx: 0, wz: 0, stepping: false, t: 0, dur: 0.15, fx: 0, fz: 0, tx: 0, tz: 0, lift: 0, pitch: 0, init: false,
});

interface Common {
  feet: Foot[];
  lastPos: THREE.Vector3;
  gv: THREE.Vector3;
  sig: string;
  lastSig: string;
  xfade: number;
  soft: boolean;
  gaitOn: boolean;
  loco: Loco;
  lout: LocoOut;
  out: Pose;
  locoCarry: boolean;
  locoCarryW: number;
  lastYaw: number;
  yawRate: number;
  pv: Pose;
  /** seconds of extra springiness right after a swing — the blade and chest settle with a soft wobble */
  settle: number;
  aim: number;
  rig: Rig;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  yaw: number;
  pose: Pose;
  target: Pose;
  walk: number;
  flash: number;
  react: number;
  reactPose: Pose;
  trail: Trail;
  trailOn: boolean;
  t: number;
  hp: number;
  hpMax: number;
  posture: number;
  postureT: number;
  glow: number;
  look: THREE.Vector3 | null;
  lookW: number;
}
interface Player extends Common {
  state: PlayerState;
  anim: AnimDef | null;
  hitIdx: number;
  comboIdx: number;
  comboTimer: number;
  guardT: number;
  guardPrev: boolean;
  gourds: number;
  resurrect: number;
  jumpStart: number;
  vy: number;
  dodgeDir: THREE.Vector3;
  dbTarget: Enemy | null;
  dbDone: boolean;
  healDone: boolean;
  kickSide: number;
  speed: number;
  swingPlayed: boolean;
  /* ninja moves */
  flip: number;
  flipV: number;
  jumps: number;
  diveAvail: boolean;
  dashAvail: boolean;
  airDashT: number;
  diveHit: boolean;
  flipEnd: number;
  /** 'back' while a backflip dodge is in progress */
  flipStyle: '' | 'back';
  dodgeKind: DodgeKind;
  dodgeSide: number;
  /** remaining i-frames (seconds) */
  inv: number;
  landBack: boolean;
  /** the enemy currently skewered on the blade */
  impTarget: Enemy | null;
  impStab: boolean;
  impKick: boolean;
}
interface Enemy extends Common {
  id: number;
  name: string;
  boss: boolean;
  scale: number;
  state: EnemyState;
  stateT: number;
  stateDur: number;
  anim: AnimDef | null;
  hitIdx: number;
  swingIdx: number;
  warned: boolean;
  speedMul: number;
  lungeD: number[];
  pips: number;
  maxPips: number;
  postureMax: number;
  lethal: boolean;
  brokenDur: number;
  attackTimer: number;
  circleDir: number;
  circleT: number;
  defense: null | 'block' | 'deflect';
  defenseUntil: number;
  /** cooldowns so an enemy can't evade / parry every single swing */
  evadeCD: number;
  parryCD: number;
  /** sideways direction of the current evade (+1 / −1), 0 = straight back */
  evadeSide: number;
  evadeDir: THREE.Vector3;
  /** queued counter-attack right after a successful parry / evade */
  punish: number;
  /** spin while tumbling backwards off the blade */
  tumbleV: number;
  tumbleA: number;
  dmgMul: number;
  phase2: boolean;
  removeAt: number;
  lastAttack: string;
  perilId: number;
  imp: THREE.Vector3;
  impDmg: number;
  impHits: number;
  kind: EKind;
  fireIdx: number;
  aiming: boolean;
  aimMesh: THREE.Mesh;
  /** number of limbs severed so far */
  sevN: number;
  /** lost its weapon arm (or the arm that draws the bow) → cannot attack any more */
  disarmed: boolean;
  /** time left of blood spurting from the stumps */
  bleedT: number;
  stumps: THREE.Object3D[];
}

const STAGES: { name: string; enemies: EKind[] }[] = [
  { name: 'I · Kurogane, Panglima Baja', enemies: ['boss'] },
  { name: 'II · Gerbang Kuil', enemies: ['blade', 'archer'] },
  { name: 'III · Hujan Panah & Api', enemies: ['blade', 'gunner', 'archer'] },
  { name: 'IV · Pengepungan Terakhir', enemies: ['blade', 'blade', 'gunner', 'archer'] },
];
const PostShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    aberr: { value: 0 },
    flash: { value: 0 },
    hurt: { value: 0 },
    sat: { value: 1 },
    time: { value: 0 },
    vig: { value: 0.55 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float aberr, flash, hurt, sat, time, vig;
    varying vec2 vUv;
    float rnd(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float d = length(c);
      vec2 off = c * aberr * (0.4 + d);
      vec3 col = vec3(texture2D(tDiffuse, vUv + off).r, texture2D(tDiffuse, vUv).g, texture2D(tDiffuse, vUv - off).b);
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, sat);
      col *= 1.0 - vig * smoothstep(0.25, 0.85, d);
      col = mix(col, vec3(0.85, 0.02, 0.02), hurt * smoothstep(0.05, 0.75, d));
      col += vec3(flash);
      col += (rnd(vUv * 1000.0 + time) - 0.5) * 0.008;
      gl_FragColor = vec4(col, 1.0);
    }`,
};

export class Game {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private post: ShaderPass;
  private fxaa: ShaderPass | null = null;
  private bloom: UnrealBloomPass;
  private world: World;
  private sfx = new Sfx();
  private blood: Particles;
  private dust: Particles;
  private glowP: Particles;
  private sparks: Sparks;
  private shocks: Shocks;
  private flashLight: THREE.PointLight;
  private ro: ResizeObserver;
  private renderDprLevels: number[] = [1];
  private renderDprIndex = 0;
  private qualitySampleFrames = 0;
  private qualitySampleTime = 0;
  private slowQualityWindows = 0;
  private fastQualityWindows = 0;

  private player!: Player;
  private enemies: Enemy[] = [];
  private enemyId = 1;
  private raf = 0;
  private lastT = 0;
  private time = 0;
  private paused = false;
  private disposed = false;
  private hitStop = 0;
  private slow = 0;
  private slowScale = 1;
  private trauma = 0;
  private fovPunch = 0;
  private aberr = 0;
  private whiteFlash = 0;
  private hurtFx = 0;
  private sat = 1;

  private camYaw = 0;
  private camPitch = 0.32;
  private camPos = new THREE.Vector3(0, 4, -8);
  private camLook = new THREE.Vector3();
  private lockOn = true;
  private lockTarget: Enemy | null = null;
  private fov = 58;

  private keys = new Set<string>();
  private mouseGuard = false;
  /** guard held down by the on-screen mobile button */
  private touchGuard = false;
  /** the on-screen stick + buttons are up → no pointer lock, and the HUD lifts its bars */
  private touchControls = false;
  /** on-screen stick vector, -1..1 per axis (0,0 = nobody touching it) */
  private touchMove = { x: 0, y: 0 };
  /** a swing pressed in mid-air with an enemy in reach: it is held and comes out the instant feet land */
  private airSlashQueued = false;
  /** how hard the last landing hit (0.2 = a small hop, 1 = a rooftop drop) — the landing pose is scaled by it */
  private landPower = 0.6;
  private attackBuf = 0;
  private dodgeBuf = 0;
  private jumpBuf = 0;
  private healBuf = 0;
  private guardBuf = 0;
  private kickBuf = 0;
  private impaleBuf = 0;

  /* ---- freestyle / cinematics / style rank ---- */
  private styleBuf = 0;
  private styleForce = -1;
  private styleLast = -1;
  private styleDef: StyleDef | null = null;
  private styleFx = 0;
  private styleSt = 0;
  private pState: PlayerState = 'idle';
  private idleT = 0;
  private pendingT = 0;
  private pendingIdx = STYLE_CHIBURI;
  private ghosts!: Afterimages;
  private ghostT = 0;
  private prevSpd = 0;
  private skidT = 0;
  private camRoll = 0;
  private rollKick = 0;
  private camBob = 0;
  private camSide = 0.65;
  private cineW = 0;
  private cine = {
    kind: 'none' as 'none' | 'intro' | 'kill',
    t: 0,
    dur: 0,
    center: new THREE.Vector3(),
    a0: 0,
    dir: 1,
    r0: 6,
    r1: 4,
    h0: 2,
    h1: 1.6,
    fov: 36,
  };
  private styleScore = 0;
  private styleHold = 0;

  /* ---- ranged enemies · projectiles · screen shake ---- */
  private proj = new Projectiles(this.scene);
  private shakeScale = 1;
  private hbT = 0;
  private lastKills = 0;
  private aimGeo = new THREE.BoxGeometry(0.018, 0.018, 1);

  /* ---- rage / blade mode ---- */
  private streaks!: Streaks;
  private ragePass!: ShaderPass;
  private sliceWorld!: SliceWorld;
  private rage = {
    on: false,
    meter: 55,
    aiming: false,
    aimT: 0,
    angle: 0.8,
    weak: 1.2,
    target: null as Enemy | null,
    noAim: false,
    cutT: 0,
    cutDone: true,
    chain: 0,
    chainT: 0,
    aimIdle: 0,
    // final slash: right-click / F. Only this slash shows the yellow line and only this one can finish an enemy.
    finisher: false,
    finDown: false,
    finBuf: 0,
    finTap: false,
    tapBuf: 0,
    /** slash angle you steer with the mouse while blade mode is on (math angle, y up) */
    slashAng: 0.7,
    /** >0 while the player is actively steering; the guide line brightens */
    steerT: 0,
    // the victim being carved: while set, every tap keeps cutting THIS body's pieces — the target never jumps to another enemy
    focusOwner: null as number | null,
    seqOwner: null as number | null,
    keepAlive: false, // something was cut: stay in blade mode (slow-mo) until the final slash / gauge empties
    endT: 0, // real seconds until blade mode ends after the final slash
    queue: [] as { angle: number; perfect: boolean }[],
    seq: [] as { angle: number; perfect: boolean; final: boolean; normal: THREE.Vector3; lineDir: THREE.Vector3 }[],
    seqIdx: 0,
    seqTarget: null as Enemy | null,
    cutCenter: new THREE.Vector3(),
    invert: 0,
    plane: null as CutPlane | null,
    dashFrom: new THREE.Vector3(),
    dashTo: new THREE.Vector3(),
  };
  private rageFx = 0;

  private kickV = new THREE.Vector3();
  private lastStats = { deflects: 0, deathblows: 0, mikiri: 0 };
  /** body scale of every fighter (1 = normal, <1 = chibi). Heights and reaches are measured against it. */
  private sizeK = 1;
  private chibi = false;
  /** top sprint speed for this body size — every run effect triggers off a fraction of it, never a fixed m/s */
  private sprintSpd = 10;
  private thudAt = 0;
  private sliceFx = {
    blood: (p: THREE.Vector3, d: THREE.Vector3, n: number, s: number) => this.machineBurst(p, d, n, s),
    thud: (p: THREE.Vector3, power: number) => {
      // a body part hitting the gravel: a small puff and a SOFT thud — and never more than a few per second, however many pieces drop
      const now = performance.now();
      if (now - this.thudAt < 120) return;
      this.thudAt = now;
      this.dustBurst(p, 1 + Math.round(power * 3), 0.8 + power * 1.1);
      this.machineBurst(p, new THREE.Vector3(0, 1, 0), 2 + Math.round(power * 4), 1.5 + power * 1.5);
      this.sfx.partThud(power);
      const d = p.distanceTo(this.player.pos);
      if (d < 7) this.shake(0.015 * power * (1 - d / 7));
    },
  };

  private stage = -1;
  private stageTimer = 0;
  private stageCleared = false;
  private ended = false;
  private streak = 0;
  private streakT = 0;
  private stats = { kills: 0, deathblows: 0, deflects: 0, time: 0, mikiri: 0 };
  private perilCounter = 0;
  private deadT = 0;

  private tmpV = new THREE.Vector3();
  private tmpV2 = new THREE.Vector3();

  constructor(
    private container: HTMLElement,
    private onEvent: (e: GameEvent) => void,
    private theme: Theme = 'white',
    /** 'chibi' = Zelda / Link sized: small toon bodies with big heads in a full-size arena */
    private sizeMode: SizeMode = 'chibi',
    private fxStyle: FxStyle = 'kz',
    private combatMode: CombatMode = 'after',
  ) {
    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    const pr = Math.min(window.devicePixelRatio || 1, 1.35);
    const minPr = Math.max(0.75, pr * 0.68);
    this.renderDprLevels = [...new Set([pr, Math.max(minPr, pr * 0.84), minPr])].sort((a, b) => b - a);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = this.theme === 'white' ? 0.84 : 1.05;
    this.renderer.domElement.style.display = 'block';
    container.appendChild(this.renderer.domElement);

    // Every sliceable target is a machine, so exposed cut faces and floor pools stay metallic cyan.
    setSliceFxStyle('classic');
    this.chibi = this.sizeMode === 'chibi';
    this.sizeK = this.chibi ? CHIBI_K : 1;
    this.sprintSpd = 14.0 * (0.3 + 0.7 * (this.sizeK * (this.chibi ? 0.9 : 1)));
    const white = this.theme === 'white';
    this.scene.fog = white ? new THREE.FogExp2(0xdfe2e4, 0.0095) : new THREE.FogExp2(0x2a1038, 0.015);
    this.fov = 58;
    this.camera = new THREE.PerspectiveCamera(this.fov, w / h, 0.03, 700);
    this.scene.add(this.camera);

    this.world = white ? buildWhiteWorld(this.scene) : buildWorld(this.scene);
    if (white) applyWhiteEnvironment(this.renderer, this.scene);
    else applyEnvironment(this.renderer, this.scene);

    this.blood = new Particles(this.scene, 700, false, 9, 0.6);
    this.dust = new Particles(this.scene, 300, false, -0.2, 2.2, 1.2);
    this.glowP = new Particles(this.scene, 500, true, 1.5, 2.5);
    this.sparks = new Sparks(this.scene, 1200);
    this.shocks = new Shocks(this.scene);
    this.flashLight = new THREE.PointLight(0xffd9a0, 0, 16, 1.4);
    this.scene.add(this.flashLight);

    // post-processing
    // High-DPI MSAA multiplied the full-screen post stack's bandwidth for little visible gain on this stylized renderer.
    const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 0 });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(w, h);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    // subtle bloom: it must never wash out the blade, the enemy silhouette or the slash lines
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), white ? 0.1 : 0.22, 0.35, white ? 1.25 : 1.1);
    this.composer.addPass(this.bloom);
    this.post = new ShaderPass(PostShader);
    // the white void needs only the faintest vignette, or it stops reading as "blinding white"
    if (white) this.post.uniforms.vig.value = 0.42;
    this.composer.addPass(this.post);
    this.composer.addPass(new OutputPass());

    this.player = this.makePlayer();
    this.setupInput();

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
  }

  /* ================= lifecycle ================= */
  start() {
    this.sfx.init();
    this.requestLock();
    this.initRage();
    this.airSlashQueued = false;
    this.nextStage();
    // the duel opens on a crane shot that settles into the fight
    const openingBoss = this.enemies.find((e) => this.isHeavyBoss(e)) ?? null;
    const bossIntro = openingBoss !== null;
    this.startCine('intro', this.player.pos.clone().setY(1.3), bossIntro ? 4.2 : 3.8);
    if (bossIntro) {
      this.cine.r0 = 24;
      this.cine.r1 = 18;
      this.cine.h0 = 12;
      this.cine.h1 = 7;
      this.cine.fov = 58;
    }
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  /**
   * The on-screen pad replaces the mouse. With it up we never take the pointer lock: a locked pointer
   * would swallow every click aimed at a button, and the camera already rides the auto-lock. Turning
   * it back off hands the mouse its camera again.
   */
  setTouchControls(on: boolean) {
    if (this.touchControls === on) return;
    this.touchControls = on;
    if (on) {
      this.touchGuard = false;
      this.touchMove.x = 0;
      this.touchMove.y = 0;
      if (document.pointerLockElement) {
        this.lockWasOn = false; // leaving the lock on purpose must never auto-pause the duel
        document.exitPointerLock();
      }
    } else if (!this.paused && !this.disposed) {
      this.requestLock();
    }
  }

  requestLock() {
    // Pointer lock is how a mouse aims the duel camera; on a touch screen (or with the pad up) it
    // does nothing useful, and the auto-lock camera plays the fight fine without it.
    if (this.touchControls) return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;
    try {
      const el = this.renderer.domElement;
      const r = el.requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => {});
    } catch {
      /* pointer lock unavailable */
    }
  }

  setPaused(p: boolean) {
    this.paused = p;
    if (!p) {
      this.lastT = performance.now();
      this.sfx.init();
      this.requestLock();
    }
  }

  /** Switch between the original reaction rules and the tactical update without restarting the duel. */
  setCombatMode(mode: CombatMode) {
    if (mode === this.combatMode) return;
    this.combatMode = mode;
    this.guardBuf = 0;
    for (const e of this.enemies) {
      e.defense = null;
      e.defenseUntil = this.time;
      e.parryCD = mode === 'after' ? Math.max(e.parryCD, e.boss ? 2.4 : 1.6) : 0;
    }
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.teardownInput();
    this.ro.disconnect();
    if (document.pointerLockElement) document.exitPointerLock();
    this.sliceWorld?.dispose();
    this.ghosts?.dispose();
    this.renderer.dispose();
    this.composer.dispose();
    this.sfx.ctx?.close().catch(() => {});
    if (this.renderer.domElement.parentElement) this.renderer.domElement.parentElement.removeChild(this.renderer.domElement);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.updatePointScale();
    this.updateFxaaResolution();
  }

  private updateFxaaResolution() {
    if (!this.fxaa) return;
    const width = Math.max(1, this.renderer.domElement.width);
    const height = Math.max(1, this.renderer.domElement.height);
    this.fxaa.uniforms.resolution.value.set(1 / width, 1 / height);
  }

  private updatePointScale() {
    const h = this.renderer.domElement.height;
    const s = h / (2 * Math.tan((this.camera.fov * Math.PI) / 360));
    this.blood.setScale(s);
    this.dust.setScale(s);
    this.glowP.setScale(s);
  }

  /* ================= input ================= */
  private onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    const c = e.code;
    this.keys.add(c);
    if (['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Escape'].includes(c)) e.preventDefault();
    if (this.paused) {
      if (c === 'KeyP') this.onEvent({ type: 'pause', n: 0 });
      return;
    }
    if (c === 'KeyJ') this.pressAttack();
    if (c === 'Space') this.toggleRage();
    if (c === 'KeyC') this.dodgeBuf = 0.2;
    if (c === 'KeyE') this.jumpBuf = 0.2;
    if (c === 'KeyH') this.healBuf = 0.2;
    if (c === 'KeyF') {
      if (this.rage.on) this.pressFinisher();
      else this.guardBuf = 0.2;
    }
    if (c === 'KeyK') {
      if (this.rage.on) this.pressFinisher();
      else this.guardBuf = 0.2;
    }
    if (c === 'KeyV' || c === 'KeyL') this.kickBuf = 0.2;
    if (c === 'KeyG') {
      this.styleBuf = 0.3;
      this.styleForce = -1;
    }
    if (c === 'KeyQ') this.toggleLock();
    if (c === 'Tab' || c === 'KeyX') this.switchTarget();
    if (c === 'KeyR') this.revive();
    if (c === 'KeyP' || (c === 'Escape' && !document.pointerLockElement)) {
      this.paused = true;
      this.onEvent({ type: 'pause', n: 1 });
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
    if (e.code === 'KeyJ') this.releaseAttack();
    if (e.code === 'KeyK' || e.code === 'KeyF') this.releaseFinisher();
  };
  private onMouseDown = (e: MouseEvent) => {
    if (this.paused) return;
    if (e.button === 0) this.pressAttack();
    if (e.button === 2) {
      if (this.rage.on) {
        // blade mode: right-click is the FINAL slash, not a guard
        this.pressFinisher();
      } else {
        this.mouseGuard = true;
        this.guardBuf = 0.2;
      }
    }
    if (e.button === 1) {
      e.preventDefault();
      this.impaleBuf = 0.3; // scroll-wheel click: run him through, then boot him off the blade
    }
  };
  private onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.mouseGuard = false;
      this.releaseFinisher();
    }
    if (e.button === 0) this.releaseAttack();
  };
  private onMouseMove = (e: MouseEvent) => {
    if (this.paused) return;
    const pointerLocked = document.pointerLockElement === this.renderer.domElement;
    if (!pointerLocked) return;
    if (this.rage.aiming) {
      this.aimMouse(e.movementX, e.movementY);
      return;
    }
    // blade mode: the mouse steers the ANGLE of the next slice instead of the camera (the camera holds the target)
    if (this.rage.on) {
      this.steerSlash(e.movementX, e.movementY);
      return;
    }
    const pitchMin = -1.42;
    const pitchMax = 1.38;
    if (!(this.lockOn && this.lockTarget)) {
      this.camYaw -= e.movementX * 0.0028;
      this.camPitch = clamp(this.camPitch + e.movementY * 0.0022, pitchMin, pitchMax);
    } else {
      this.camYaw -= e.movementX * 0.0018;
      this.camPitch = clamp(this.camPitch + e.movementY * 0.0022, pitchMin, pitchMax);
    }
  };
  private onCtx = (e: Event) => e.preventDefault();
  private onLockChange = () => {
    if (!document.pointerLockElement && !this.paused && !this.disposed && this.lockWasOn) {
      this.paused = true;
      this.onEvent({ type: 'pause', n: 1 });
    }
    this.lockWasOn = !!document.pointerLockElement;
  };
  private lockWasOn = false;
  private onBlur = () => {
    this.keys.clear();
    this.touchMove.x = 0;
    this.touchMove.y = 0;
    this.mouseGuard = false;
    this.touchGuard = false;
  };

  private setupInput() {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('contextmenu', this.onCtx);
    window.addEventListener('blur', this.onBlur);
    document.addEventListener('pointerlockchange', this.onLockChange);
  }
  private teardownInput() {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('contextmenu', this.onCtx);
    window.removeEventListener('blur', this.onBlur);
    document.removeEventListener('pointerlockchange', this.onLockChange);
  }

  private get guardHeld() {
    return this.mouseGuard || this.touchGuard || this.keys.has('KeyK') || this.keys.has('KeyF');
  }

  /* =================== mobile / touch controls =================== */
  /**
   * The on-screen pad fires exactly the same intents as the keyboard and the mouse, so the duel is
   * playable with two thumbs: the left stick walks the arena, the right cluster attacks, jumps,
   * dashes, guards, kicks, heals, opens Rage and hops between targets. Guard is a hold-button with
   * its own state in `touchGuard`. The camera auto-locks onto the target, so no thumb has to aim it.
   */
  pressTouch(action: TouchAction) {
    if (this.disposed) return;
    if (action === 'pause') {
      if (this.paused) this.onEvent({ type: 'pause', n: 0 });
      else {
        this.paused = true;
        this.onEvent({ type: 'pause', n: 1 });
      }
      return;
    }
    if (this.paused || this.player.state === 'dead') return;
    this.sfx.init();
    switch (action) {
      case 'attack':
        this.pressAttack();
        break;
      case 'jump':
        this.jumpBuf = 0.2;
        break;
      case 'dash':
        this.dodgeBuf = 0.2;
        break;
      case 'guard':
        // identical to the right mouse button: a guard, except in Rage where it is the final slash
        if (this.rage.on) this.pressFinisher();
        else {
          this.touchGuard = true;
          this.guardBuf = 0.2;
        }
        break;
      case 'finisher':
        this.pressFinisher();
        break;
      case 'kick':
        this.kickBuf = 0.2;
        break;
      case 'heal':
        this.healBuf = 0.2;
        break;
      case 'rage':
        this.toggleRage();
        break;
      case 'target':
        this.switchTarget();
        break;
      case 'lock':
        this.toggleLock();
        break;
    }
  }

  releaseTouch(action: TouchAction) {
    if (action === 'guard') this.touchGuard = false;
    if (action === 'attack') this.releaseAttack();
    if (action === 'finisher') this.releaseFinisher();
  }

  /**
   * The virtual stick. x = strafe, y = forward, both -1..1 (the pad dead-zones and normalises it).
   * moveInput() sums it with WASD, so a keyboard and a thumb coexist without fighting.
   */
  setTouchMove(x: number, y: number) {
    this.touchMove.x = clamp(x, -1, 1);
    this.touchMove.y = clamp(y, -1, 1);
  }

  /** A drag over the play field steers the Rage cut angle, exactly like moving the mouse does. */
  steerTouch(dx: number, dy: number) {
    if (this.paused || this.disposed) return;
    if (this.rage.aiming) this.aimMouse(dx, dy);
    else if (this.rage.on) this.steerSlash(dx, dy);
  }

  private toggleLock() {
    this.rage.focusOwner = null;
    this.lockOn = !this.lockOn;
    if (this.lockOn) this.lockTarget = this.nearestEnemy();
  }
  private switchTarget() {
    this.rage.focusOwner = null; // moving on to someone else on purpose
    const alive = this.enemies.filter((e) => this.alive(e));
    if (alive.length < 2) {
      this.lockOn = true;
      this.lockTarget = alive[0] ?? null;
      return;
    }
    const i = this.lockTarget ? alive.indexOf(this.lockTarget) : -1;
    this.lockTarget = alive[(i + 1) % alive.length];
    this.lockOn = true;
  }
  private nearestEnemy(): Enemy | null {
    let best: Enemy | null = null;
    let bd = 1e9;
    for (const e of this.enemies) {
      if (!this.alive(e)) continue;
      const d = e.pos.distanceTo(this.player.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }
  private isHeavyBoss(e: Enemy | null | undefined): boolean {
    return !!e && e.boss && e.scale >= HEAVY_BOSS_SCALE * this.sizeK * 0.9;
  }

  /** Close-range combat measures from the boss's armored surface, not its ground-level origin. */
  private enemySurfaceDistance(e: Enemy, point: THREE.Vector3) {
    const radius = this.isHeavyBoss(e) ? HEAVY_BOSS_BODY_RADIUS * this.sizeK : 0;
    return Math.max(0, e.pos.distanceTo(point) - radius);
  }

  /** Scale weapon reach with the actual rig, while every attack still requires close-range contact. */
  private enemyAttackReach(e: Enemy, hit: HitDef) {
    return hit.reach * e.scale + 0.3 * this.sizeK;
  }

  private nearestCloseEnemy(maxDistance = CLOSE_ATTACK_RANGE): Enemy | null {
    const p = this.player;
    let best: Enemy | null = null;
    let bestDistance = maxDistance;
    for (const e of this.enemies) {
      if (!this.alive(e)) continue;
      const distance = this.enemySurfaceDistance(e, p.pos);
      if (distance < bestDistance) {
        best = e;
        bestDistance = distance;
      }
    }
    return best;
  }

  private alive(e: Enemy) {
    return e.state !== 'dying' && e.state !== 'dead' && e.state !== 'spawn';
  }

  /* ================= construction ================= */
  private makeCommon(rig: Rig, trailColor: number): Common {
    this.scene.add(rig.root);
    rig.root.rotation.order = 'YXZ';
    return {
      feet: [newFoot(), newFoot()],
      lastPos: new THREE.Vector3(),
      gv: new THREE.Vector3(),
      sig: '',
      lastSig: '',
      xfade: 0,
      soft: true,
      gaitOn: false,
      loco: newLoco(),
      lout: newOut(),
      out: clonePose(IDLE),
      locoCarry: true,
      locoCarryW: 0,
      lastYaw: 0,
      yawRate: 0,
      pv: zeroPose(),
      settle: 0,
      aim: 0,
      rig,
      pos: new THREE.Vector3(),
      vel: new THREE.Vector3(),
      yaw: 0,
      pose: clonePose(IDLE),
      target: clonePose(IDLE),
      walk: 0,
      flash: 0,
      react: 0,
      reactPose: P.hurt,
      trail: new Trail(this.scene, trailColor),
      trailOn: false,
      t: 0,
      hp: 100,
      hpMax: 100,
      posture: 0,
      postureT: 0,
      glow: 0,
      look: null,
      lookW: 0.85,
    };
  }

  private makePlayer(): Player {
    const rig = createHumanoid({
      // Katana ZERO look: black kimono, gold hem, black ponytail, geta
      kind: 'player', skin: 0xe9c6a4, cloth: 0x15151b, cloth2: 0x1d1d25, accent: 0xe8bb3c, hair: 0x15131a,
      blade: 0xf6f8fb, bladeGlow: 0x3a2a4a, chibi: this.chibi, scale: this.sizeK,
    });
    const c = this.makeCommon(rig, 0x9fdcff);
    return {
      ...c,
      state: 'idle', anim: null, hitIdx: 0, comboIdx: 0, comboTimer: 0, guardT: 99, guardPrev: false,
      gourds: 3, resurrect: 1, jumpStart: -9, vy: 0, dodgeDir: new THREE.Vector3(0, 0, 1),
      dbTarget: null, dbDone: false, healDone: false, kickSide: 1, speed: 0, swingPlayed: false,
      flip: 0, flipV: 0, jumps: 0, diveAvail: true, dashAvail: true, airDashT: 0, diveHit: false, flipEnd: 0,
      flipStyle: '', dodgeKind: 'slip', dodgeSide: 1, inv: 0, landBack: false,
      impTarget: null, impStab: false, impKick: false,
    };
  }

  private makeEnemy(kind: EKind, angle: number): Enemy {
    const boss = kind === 'boss';
    const spec = {
      blade: { name: 'Prajurit Robot', hp: 130, posture: 128, atk: 0.6, dist: 8.5, trail: 0xff9a60 },
      archer: { name: 'Pemanah Robot', hp: 80, posture: 80, atk: 0.85, dist: 12.5, trail: 0x9acf60 },
      gunner: { name: 'Penembak Robot', hp: 95, posture: 92, atk: 1.2, dist: 11.5, trail: 0xffb060 },
      boss: { name: 'Kurogane, Panglima Baja', hp: 520, posture: 268, atk: 1.5, dist: 18, trail: 0xff241c },
    }[kind];
    const rig = createHumanoid(
      // every enemy is a machine: brushed-steel frame, cyan optics, neon trim
      kind === 'boss'
        ? {
            kind: 'boss' as const, robot: true, chibi: this.chibi, skin: 0x626773, cloth: 0x111116, cloth2: 0x211218,
            accent: 0xd51c2d, scale: HEAVY_BOSS_SCALE * this.sizeK, blade: 0xe5e7eb, bladeGlow: 0x8e1018,
          }
        : kind === 'archer'
          ? {
              kind: 'soldier' as const, robot: true, chibi: this.chibi, weapon: 'bow' as const, skin: 0x79828f,
              cloth: 0x1a2230, cloth2: 0x141a24, accent: 0x2ad8ff, hair: 0x11151c, scale: this.sizeK,
            }
          : kind === 'gunner'
            ? {
                kind: 'soldier' as const, robot: true, chibi: this.chibi, weapon: 'gun' as const, skin: 0x7c8694,
                cloth: 0x241a2e, cloth2: 0x16141c, accent: 0xb44aff, hair: 0x11151c, scale: this.sizeK,
              }
            : {
                kind: 'soldier' as const, robot: true, chibi: this.chibi, skin: 0x79828f, cloth: 0x1b1f28,
                cloth2: 0x141820, accent: 0x2ad8ff, hair: 0x11151c, scale: this.sizeK,
              },
    );
    const c = this.makeCommon(rig, spec.trail);
    const hpMax = spec.hp;
    const aimMesh = new THREE.Mesh(
      this.aimGeo,
      new THREE.MeshBasicMaterial({
        color: 0xff3020, transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
      }),
    );
    aimMesh.visible = false;
    aimMesh.frustumCulled = false;
    this.scene.add(aimMesh);
    const e: Enemy = {
      ...c,
      id: this.enemyId++,
      name: spec.name,
      kind,
      fireIdx: 0,
      aiming: false,
      aimMesh,
      boss,
      scale: (boss ? HEAVY_BOSS_SCALE : 1) * this.sizeK,
      state: 'spawn',
      stateT: 0,
      stateDur: 0,
      anim: null,
      hitIdx: 0,
      swingIdx: 0,
      warned: false,
      speedMul: boss ? 0.86 : 1.16, // swings arrive quicker: less time to read them
      lungeD: [],
      pips: boss ? 2 : 1,
      maxPips: boss ? 2 : 1,
      postureMax: spec.posture,
      lethal: false,
      brokenDur: 5,
      attackTimer: spec.atk,
      circleDir: Math.random() < 0.5 ? 1 : -1,
      circleT: rand(1, 3),
      defense: null,
      defenseUntil: 0,
      evadeCD: 0,
      parryCD: this.combatMode === 'after' ? (boss ? 6.5 : kind === 'blade' ? 2.2 : 0) : 0,
      evadeSide: 0,
      evadeDir: new THREE.Vector3(),
      punish: 0,
      tumbleV: 0,
      tumbleA: 0,
      dmgMul: boss ? 0.48 : 1,
      phase2: false,
      removeAt: 0,
      lastAttack: '',
      perilId: 0,
      imp: new THREE.Vector3(),
      impDmg: 0,
      impHits: 0,
      sevN: 0,
      disarmed: false,
      bleedT: 0,
      stumps: [],
    };
    e.hp = hpMax;
    e.hpMax = hpMax;
    e.t = 0;
    const d = spec.dist;
    e.pos.set(
      this.player.pos.x + Math.sin(angle) * d,
      0,
      this.player.pos.z + Math.cos(angle) * d,
    );
    this.clampArena(e.pos, 1);
    e.yaw = Math.atan2(this.player.pos.x - e.pos.x, this.player.pos.z - e.pos.z);
    e.rig.root.visible = true;
    return e;
  }

  private nextStage() {
    this.stage++;
    if (this.stage >= STAGES.length) {
      this.ended = true;
      this.sfx.victory();
      this.pendingT = 0.9;
      this.pendingIdx = STYLE_JODAN;
      this.onEvent({ type: 'victory' });
      return;
    }
    const st = STAGES[this.stage];
    this.stageCleared = false;
    const base = this.camYaw;
    st.enemies.forEach((kind, i) => {
      const n = st.enemies.length;
      const ang = base + (n > 1 ? (i / (n - 1) - 0.5) * 1.7 : 0);
      const e = this.makeEnemy(kind, ang);
      this.enemies.push(e);
    });
    this.sfx.stage();
    this.onEvent({ type: 'stage', text: st.name });
    this.lockTarget = this.nearestEnemy();
    this.lockOn = true;
  }

  /* ================= main loop ================= */
  private frame = (now: number) => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.frame);
    const real = Math.min(0.05, (now - this.lastT) / 1000);
    this.lastT = now;
    if (!this.paused) this.step(real);
    this.composer.render();
    this.sampleRenderQuality(real);
  };

  /** Reduce internal resolution only after sustained slow frames; restore it gradually after stable headroom. */
  private sampleRenderQuality(real: number) {
    if (this.paused || real <= 0 || real > 0.06) return;
    this.qualitySampleFrames++;
    this.qualitySampleTime += real;
    if (this.qualitySampleFrames < 120) return;
    const averageFrameTime = this.qualitySampleTime / this.qualitySampleFrames;
    this.qualitySampleFrames = 0;
    this.qualitySampleTime = 0;
    if (averageFrameTime > 0.02) {
      this.slowQualityWindows++;
      this.fastQualityWindows = 0;
      if (this.slowQualityWindows >= 1 && this.renderDprIndex < this.renderDprLevels.length - 1) {
        this.renderDprIndex++;
        this.setRenderDpr(this.renderDprLevels[this.renderDprIndex]);
        this.slowQualityWindows = 0;
      }
    } else if (averageFrameTime < 0.0145) {
      this.fastQualityWindows++;
      this.slowQualityWindows = 0;
      if (this.fastQualityWindows >= 4 && this.renderDprIndex > 0) {
        this.renderDprIndex--;
        this.setRenderDpr(this.renderDprLevels[this.renderDprIndex]);
        this.fastQualityWindows = 0;
      }
    } else {
      this.slowQualityWindows = 0;
      this.fastQualityWindows = 0;
    }
  }

  private setRenderDpr(dpr: number) {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h);
    this.composer.setPixelRatio(dpr);
    this.composer.setSize(w, h);
    this.updatePointScale();
    this.updateFxaaResolution();
  }

  private step(real: number) {
    let ts = 1;
    if (this.hitStop > 0) {
      this.hitStop -= real;
      ts = 0.025;
    } else if (this.slow > 0) {
      this.slow -= real;
      ts = this.slowScale;
    }
    // Blade mode: the world crawls (almost freezes while aiming a cut) but the player keeps moving fast.
    const r0 = this.rage;
    let pdt: number;
    if (r0.on) {
      ts = Math.min(ts, r0.aiming ? 0.012 : r0.cutT > 0 ? 0.045 : 0.1);
      pdt = real * (r0.aiming ? 0.6 : r0.cutT > 0 ? 0.9 : 0.62) * (this.hitStop > 0 ? 0.35 : 1);
    } else {
      pdt = real * ts;
    }
    const dt = real * ts;
    this.time += dt;
    this.updateRage(real);
    if (!this.ended) this.stats.time += real;

    this.attackBuf -= real;
    this.dodgeBuf -= real;
    this.jumpBuf -= real;
    this.healBuf -= real;
    this.guardBuf -= real;
    this.kickBuf -= real;
    this.impaleBuf -= real;
    this.styleBuf -= real;
    if (this.pendingT > 0) {
      this.pendingT -= real;
      if (this.pendingT <= 0) {
        this.styleBuf = 0.8;
        this.styleForce = this.pendingIdx;
      }
    }
    // style meter slowly cools down when you stop fighting stylishly
    this.styleHold -= real;
    if (this.styleHold <= 0) this.styleScore = Math.max(0, this.styleScore - 7 * real);

    // keep a valid lock target
    // …except while carving a body in blade mode: the dead victim stays the camera / target focus, so the view never jumps to another enemy
    const carving = this.rage.on && this.rage.focusOwner !== null;
    if (!carving) {
      if (this.lockTarget && !this.alive(this.lockTarget)) this.lockTarget = this.nearestEnemy();
      if (!this.lockTarget && this.lockOn) this.lockTarget = this.nearestEnemy();
    }

    this.updatePlayer(pdt);

    // afterimages: dodge dash, blade-cut dash and full sprint leave translucent echoes behind
    {
      const pl = this.player;
      const spd = Math.hypot(pl.vel.x, pl.vel.z);
      const dashing =
        pl.state === 'dodge' ||
        pl.state === 'dive' ||
        (pl.state === 'jump' && (pl.airDashT > 0 || pl.inv > 0)) ||
        (pl.state === 'idle' && spd > this.sprintSpd * 0.78);
      this.ghostT -= real;
      if (dashing && this.ghostT <= 0) {
        this.ghostT = pl.state === 'idle' ? 0.075 : 0.05;
        const col = this.rage.on ? 0xff5a48 : 0x7fa6ff;
        this.ghosts.snap(pl.rig.root, col, this.rage.on ? 0.3 : 0.22, 0.34);
      }
      this.ghosts.update(real);
    }
    // Rage slicing is a deliberate freeze-frame for targets: keep enemies exactly where the cut is lined up.
    if (!this.rage.on) {
      for (const e of this.enemies) this.updateEnemy(e, dt);
    }
    this.updateProjectiles(dt);
    // low-HP heartbeat: a soft thump in the frame and a red pulse at the edges
    if (this.player.state !== 'dead' && this.player.hp / this.player.hpMax < 0.3) {
      this.hbT -= real;
      if (this.hbT <= 0) {
        this.hbT = 0.85;
        this.shake(0.07);
        this.hurtFx = Math.max(this.hurtFx, 0.14);
      }
    }
    this.separate();

    // stage progression
    if (
      !this.ended &&
      !this.stageCleared &&
      this.enemies.length > 0 &&
      this.enemies.every((e) => !this.alive(e) && e.state !== 'spawn')
    ) {
      this.stageCleared = true;
      this.stageTimer = 3.2;
      // victory flourish: wipe the blade clean once the dust settles
      this.pendingT = 1.3;
      this.pendingIdx = STYLE_CHIBURI;
      if (this.stage < STAGES.length - 1) this.onEvent({ type: 'stageClear' });
    }
    if (this.stageCleared && !this.ended) {
      this.stageTimer -= dt;
      if (this.stageTimer <= 0 && this.player.state !== 'dead') {
        this.enemies = this.enemies.filter((e) => {
          if (e.state === 'dead') this.removeEnemy(e);
          return e.state !== 'dead';
        });
        if (this.stage < STAGES.length - 1) {
          this.player.hp = Math.min(this.player.hpMax, this.player.hp + 35);
          this.player.gourds = Math.min(3, this.player.gourds + 1);
        }
        this.nextStage();
      }
    }
    // cleanup dead
    this.enemies = this.enemies.filter((e) => {
      if (e.state === 'dying' && this.time > e.removeAt) {
        e.state = 'dead';
      }
      if (e.state === 'dead' && this.time > e.removeAt + 2.5 && !this.stageCleared) {
        this.removeEnemy(e);
        return false;
      }
      return true;
    });

    // streak decay
    this.streakT += dt;
    if (this.streakT > 6) this.streak = 0;

    this.updateFx(dt, real);
    this.updateCamera(dt, real);
    this.world.update(this.time, dt, this.player.pos);

    // Only rebuild sword world matrices while a ribbon is actively being drawn. Fading ribbons need just their age advanced.
    if (this.player.trailOn) {
      this.player.rig.root.updateMatrixWorld(true);
      this.player.rig.swordBase.getWorldPosition(this.tmpV);
      this.player.rig.swordTip.getWorldPosition(this.tmpV2);
    }
    this.player.trail.update(dt, this.player.trailOn, this.tmpV, this.tmpV2);
    for (const e of this.enemies) {
      if (e.trailOn) {
        e.rig.root.updateMatrixWorld(true);
        e.rig.swordBase.getWorldPosition(this.tmpV);
        e.rig.swordTip.getWorldPosition(this.tmpV2);
      }
      e.trail.update(dt, e.trailOn, this.tmpV, this.tmpV2);
    }
  }

  /* ================= RAGE / BLADE MODE ================= */
  private initRage() {
    this.streaks = new Streaks(this.scene);
    this.sliceWorld = new SliceWorld(this.scene);
    this.ghosts = new Afterimages(this.scene, 4);
    this.ragePass = new ShaderPass(RageShader);
    this.composer.insertPass(this.ragePass, this.composer.passes.length - 1);
    this.fxaa = new ShaderPass(FXAAShader);
    this.composer.insertPass(this.fxaa, this.composer.passes.length - 1);
    this.updateFxaaResolution();
    this.lastStats = { deflects: 0, deathblows: 0, mikiri: 0 };
  }

  private wrapHalf(d: number) {
    return ((((d + Math.PI / 2) % Math.PI) + Math.PI) % Math.PI) - Math.PI / 2;
  }

  private addRage(a: number) {
    this.rage.meter = Math.min(100, this.rage.meter + a);
  }

  private toggleRage() {
    const p = this.player;
    if (this.paused || p.state === 'dead' || p.state === 'deathblow' || p.state === 'cut') return;
    this.setRage(!this.rage.on);
  }

  private setRage(on: boolean) {
    const r = this.rage;
    const p = this.player;
    if (on === r.on) return;
    if (on) {
      if (r.meter < 18) {
        this.sfx.rageDeny();
        this.onEvent({ type: 'rageLow', text: 'Rage belum cukup' });
        return;
      }
      if (!this.enemies.some((e) => this.alive(e))) return;
      r.on = true;
      this.sfx.rageOn();
      this.sfx.setRage(true);
      this.shocks.spawn(p.pos.clone().setY(0.1), 0xff2a1a, 9, 0.8);
      this.shocks.spawn(p.pos.clone().setY(1.2), 0xffffff, 4, 0.4);
      this.flashAt(p.pos.clone().setY(1.5), 0xff3020, 40);
      this.glowBurst(p.pos.clone().setY(1.2), 30, 0.2, new THREE.Color(3, 0.3, 0.2), 5);
      this.whiteFlash = 0.35;
      this.aberr = 0.03;
      this.fovPunch = -6;
      this.shake(0.6);
      this.onEvent({ type: 'rage', text: '怒' });
    } else {
      r.on = false;
      this.cancelAim();
      r.tapBuf = 0;
      r.finBuf = 0;
      r.endT = 0;
      r.keepAlive = false;
      r.focusOwner = null;
      r.seqOwner = null;
      this.sfx.rageOff();
      this.sfx.setRage(false);
      this.shocks.spawn(p.pos.clone().setY(0.1), 0x66aaff, 5, 0.5);
      this.releaseImpulse();
    }
  }

  /**
   * Momentum burst: every slash landed during slow-mo was stored as impulse. The moment blade mode ends it is
   * released all at once — enemies are hurled and debris explodes into more pieces.
   */
  private releaseImpulse() {
    let big = false;
    for (const e of this.enemies) {
      if (!this.alive(e) || e.impHits === 0) continue;
      big = true;
      const imp = e.imp.clone();
      imp.y = 0;
      imp.clampLength(0, 2.2); // a firm shove, not a launch
      const mag = Math.min(1, e.impHits / 4);
      const massScale = this.isHeavyBoss(e) ? 0.12 : e.boss ? 0.6 : 1;
      e.vel.addScaledVector(imp, massScale);
      e.hp -= e.impDmg;
      const c = e.pos.clone().setY(1.2 * e.scale);
      this.machineBurst(c, imp.clone().normalize(), 34 + 24 * mag, 9);
      this.shocks.spawn(c, 0x62eaff, 4 + 3 * mag, 0.5);
      e.flash = 1;
      e.react = 1;
      e.reactPose = P.kicked;
      e.imp.set(0, 0, 0);
      e.impDmg = 0;
      e.impHits = 0;
      if (e.hp <= 0) {
        e.hp = 0;
        if (e.pips > 1) this.bossPipLoss(e);
        else this.rageKill(e, rand(0.3, 2.8), 5);
      } else if (e.state !== 'broken') {
        this.interruptEnemy(e);
        e.state = 'kicked';
        e.stateT = 0;
        e.stateDur = 1.0;
        this.addEnemyPosture(e, 40);
      }
    }
    // slow-mo is over: every piece cut during blade mode is hurled outward from the middle of the pile, at normal speed
    {
      const live = this.sliceWorld.pieces.filter((pc: Piece) => pc.gentle);
      if (live.length) {
        const mid = new THREE.Vector3();
        for (const pc of live) mid.add(pc.pivot.position);
        mid.divideScalar(live.length);
        const launched = this.sliceWorld.burst(mid, 1);
        if (launched.length) {
          big = true;
          this.machineBurst(mid.clone().setY(Math.max(0.6, mid.y)), new THREE.Vector3(0, 1, 0), 22, 5);
          this.shocks.spawn(mid.clone().setY(0.15), 0x48dff4, 4.5, 0.55);
        }
      }
    }
    // (no second blast and no extra shattering here any more: one natural burst is all there is)
    for (const pc of this.sliceWorld.pieces as Piece[]) {
      pc.hits = 0;
      pc.imp.set(0, 0, 0);
    }
    if (big) {
      this.hitStop = 0.12;
      this.shake(0.55);
      this.aberr = 0.02;
      this.sfx.postureBreak();
      this.shocks.spawn(this.player.pos.clone().setY(0.1), 0xff6a4a, 5, 0.5);
    }
  }

  private cancelAim() {
    const r = this.rage;
    const p = this.player;
    r.aiming = false;
    r.target = null;
    r.queue.length = 0;
    r.finisher = false;
    if (p.state === 'cutaim') {
      p.state = 'idle';
      p.t = 0;
    }
  }

  private pressAttack() {
    if (this.rage.on) {
      // blade mode: every click is one slice — just tap, no holding or releasing
      this.rage.tapBuf = 0.3;
    } else {
      this.attackBuf = 0.32; // a longer input buffer lets combos chain without precise timing
    }
  }

  private releaseAttack() {
    /* nothing to release: every click is a complete action */
  }

  /** During precision aim, mouse swipes set the cut axis instead of moving the camera. */
  private aimMouse(mx: number, my: number) {
    this.steerSlash(mx, my);
  }

  /** The cut axis follows the exact mouse-swipe direction; the line is undirected, so opposite swipes match. */
  private steerSlash(mx: number, my: number) {
    const r = this.rage;
    if (Math.hypot(mx, my) < 1.2) return;
    const want = Math.atan2(-my, mx);
    r.slashAng = ((want % Math.PI) + Math.PI) % Math.PI;
    r.steerT = 1.2;
    if (r.aiming) {
      r.angle = r.slashAng;
      if (r.finisher) r.weak = r.slashAng;
    }
  }

  private canAimNow() {
    const p = this.player;
    return (
      p.state === 'idle' ||
      p.state === 'style' ||
      p.state === 'land' ||
      (p.state === 'cut' && p.t >= 0.2) ||
      (p.state === 'attack' && !!p.anim && p.t >= p.anim.cancelFrom)
    );
  }

  /** One tap = one slice along the player-steered angle, against the locked or nearest close target. Never lethal. */
  private doTapCut(): boolean {
    const r = this.rage;
    const p = this.player;
    // 1) the body that was just cut stays the focus: keep carving ITS pieces (Tab / X is how you move on to someone else)
    let tgt: Enemy | null = null;
    let pile: THREE.Vector3 | null = null;
    r.seqOwner = null;
    if (r.focusOwner !== null) {
      pile = this.sliceWorld.clusterNear(p.pos, CLOSE_PIECE_RANGE, r.focusOwner);
      if (pile) r.seqOwner = r.focusOwner;
      else r.focusOwner = null; // nothing of it left in reach
    }
    // 2) otherwise hit only the locked target; without lock-on, use the nearest enemy inside the close-range cap
    if (!pile) {
      tgt = this.lockOn ? this.lockTarget : this.nearestCloseEnemy();
      if (!tgt || !this.alive(tgt) || this.enemySurfaceDistance(tgt, p.pos) > CLOSE_ATTACK_RANGE) tgt = null;
      // 3) nobody alive in reach → any pile still hanging in the slow-motion air
      if (!tgt) {
        const o = this.sliceWorld.ownerNear(p.pos, CLOSE_PIECE_RANGE);
        if (o === null) return false;
        pile = this.sliceWorld.clusterNear(p.pos, CLOSE_PIECE_RANGE, o);
        if (!pile) return false;
        r.seqOwner = o;
        r.focusOwner = o;
      }
    }
    // Never choose a cut angle for the player: repeat the last direction they set with a mouse swipe.
    const ang = r.slashAng;
    const where = tgt ? tgt.pos : pile!;
    if (tgt) {
      this.lockTarget = tgt;
      this.lockOn = true;
    }
    const pl0 = this.makePlane(where, ang);
    r.finisher = false;
    r.aiming = false;
    r.seq = [{ angle: ang, perfect: false, final: false, normal: pl0.normal, lineDir: pl0.lineDir }];
    r.seqIdx = 0;
    r.seqTarget = tgt;
    r.target = null;
    r.cutCenter.copy(where);
    this.beginCut();
    return true;
  }

  /**
   * FINAL SLASH (right-click / F / K in blade mode). Swipe to choose the exact cut axis; the yellow line tracks it.
   * This is the only slash in blade mode that can finish an enemy.
   */
  private pressFinisher() {
    const r = this.rage;
    if (!r.on || this.paused) return;
    if (r.aiming && r.finisher) return; // already lining up the final slash
    r.finBuf = 0.4;
    this.tryStartFinisher();
  }

  private tryStartFinisher() {
    const r = this.rage;
    const p = this.player;
    if (r.finBuf <= 0 || !r.on) return;
    if (p.state === 'dead' || p.state === 'deathblow') return;
    if (r.aiming || !this.canAimNow()) return;
    // a body is mid-carving (or nobody is left alive): the final slash closes THAT pile, then slow-mo ends in a blast
    const carving = r.focusOwner !== null && this.sliceWorld.hasPieces(r.focusOwner, p.pos, CLOSE_PIECE_RANGE);
    if (carving || !this.enemies.some((e) => this.alive(e))) {
      r.finBuf = 0;
      this.finalOnPieces();
      return;
    }
    if (!this.startAim()) {
      r.finBuf = 0;
      return;
    }
    this.beginFinisher();
    r.finBuf = 0;
  }

  /** Final slash with no live target: one big cut through the middle of the pile. */
  private finalOnPieces() {
    const r = this.rage;
    const p = this.player;
    const owner = r.focusOwner ?? this.sliceWorld.ownerNear(p.pos, CLOSE_PIECE_RANGE);
    const pile = owner === null ? null : this.sliceWorld.clusterNear(p.pos, CLOSE_PIECE_RANGE, owner);
    if (!pile || owner === null) {
      this.setRage(false); // nothing left to cut — just leave blade mode
      return;
    }
    const ang = r.slashAng;
    const pl0 = this.makePlane(pile, ang);
    r.finisher = true;
    r.aiming = false;
    r.seq = [{ angle: ang, perfect: true, final: true, normal: pl0.normal, lineDir: pl0.lineDir }];
    r.seqIdx = 0;
    r.seqTarget = null;
    r.seqOwner = owner;
    r.target = null;
    r.cutCenter.copy(pile);
    this.beginCut();
  }

  /** The final cut's target line follows the player's chosen angle; it never spawns on a random side. */
  private beginFinisher() {
    const r = this.rage;
    r.finisher = true;
    r.weak = r.slashAng;
    r.angle = r.slashAng;
    r.aimIdle = 0;
    this.sfx.rageOn();
    this.shake(0.12);
    this.aberr = Math.max(this.aberr, 0.01);
  }

  private releaseFinisher() {
    /* nothing to release: one click is enough */
  }

  private startAim(): boolean {
    const r = this.rage;
    const p = this.player;
    let tgt = this.lockOn ? this.lockTarget : this.nearestCloseEnemy();
    if (!tgt || !this.alive(tgt) || this.enemySurfaceDistance(tgt, p.pos) > CLOSE_ATTACK_RANGE) return false;
    r.aiming = true;
    r.aimT = 0;
    r.target = tgt;
    r.weak = r.slashAng;
    r.angle = r.slashAng;
    r.aimIdle = 0;
    r.queue.length = 0;
    r.finisher = false; // a normal cut: no yellow line, never lethal
    this.lockTarget = tgt;
    this.lockOn = true;
    p.state = 'cutaim';
    p.t = 0;
    p.anim = null;
    p.trailOn = false;
    p.vel.set(0, 0, 0);
    this.sfx.cutAim();
    return true;
  }

  private updateRage(real: number) {
    const r = this.rage;
    const p = this.player;
    const st = this.stats;
    const ls = this.lastStats;
    // rage gauge fills from skilled play
    r.meter = Math.min(
      100,
      r.meter + (st.deflects - ls.deflects) * 9 + (st.deathblows - ls.deathblows) * 28 + (st.mikiri - ls.mikiri) * 16,
    );
    if (st.deflects > ls.deflects) {
      this.addStyle(12 * (st.deflects - ls.deflects));
      this.rollKick = (Math.random() < 0.5 ? 1 : -1) * 0.045; // the frame jolts sideways on a perfect parry
    }
    if (st.deathblows > ls.deathblows) this.addStyle(26);
    if (st.mikiri > ls.mikiri) this.addStyle(20);
    ls.deflects = st.deflects;
    ls.deathblows = st.deathblows;
    ls.mikiri = st.mikiri;
    // every kill keeps the flow going: a little health and rage back
    if (st.kills > this.lastKills) {
      const n = st.kills - this.lastKills;
      this.lastKills = st.kills;
      p.hp = Math.min(p.hpMax, p.hp + 6 * n);
      this.addRage(10 * n);
    }
    r.cutT = Math.max(0, r.cutT - real);
    r.chainT = Math.max(0, r.chainT - real);
    if (r.chainT <= 0) r.chain = 0;
    r.invert *= Math.exp(-6 * real);
    const alive = this.enemies.some((e) => this.alive(e));
    if (r.on) {
      // aiming costs almost nothing, so you can chain as many precision cuts as you like
      r.meter -= (r.aiming ? 0.5 : 3.2) * (1 - 0.4 * this.flowLevel()) * real; // drains in real time (~14 s of blade mode from a 55 % gauge)
      if (r.endT > 0) {
        r.endT -= real;
        if (r.endT <= 0) {
          r.endT = 0;
          this.setRage(false); // final slash landed → slow-mo ends, the pieces blast outward at normal speed
          return;
        }
      }
      if (r.meter <= 0) {
        r.meter = 0;
        this.setRage(false);
      } else if (p.state === 'dead' || (!alive && !r.keepAlive)) {
        this.setRage(false);
      }
    } else {
      r.meter = Math.min(100, r.meter + 2.4 * real);
    }
    if (!r.on) return;

    p.glow = Math.max(p.glow, 0.1);
    if (Math.random() < 0.18) {
      this.glowBurst(
        this.tmpV2.set(p.pos.x + rand(-0.7, 0.7), rand(0.1, 1.9), p.pos.z + rand(-0.7, 0.7)),
        1,
        0.07,
        new THREE.Color(2.6, 0.25, 0.15),
        0.5,
      );
    }
    // right-click pressed while the stance wasn't ready: keep trying for a short moment
    r.finBuf = Math.max(0, r.finBuf - real);
    if (r.finBuf > 0 && !(r.aiming && r.finisher)) this.tryStartFinisher();
    r.steerT = Math.max(0, r.steerT - real);
    // left-click taps: each one is a slice. Buffered, so mashing the button never drops a cut.
    r.tapBuf = Math.max(0, r.tapBuf - real);
    if (r.tapBuf > 0 && !r.aiming && this.canAimNow()) {
      if (this.doTapCut()) r.tapBuf = 0;
      else {
        r.tapBuf = 0;
        this.attackBuf = 0.3; // nobody in range: swing normally instead
      }
    }
    if (r.aiming) {
      r.aimT += real;
      r.aimIdle += real;
      if (p.state !== 'cutaim') {
        this.cancelAim();
        return;
      }
      // Tab / X while lining up → hop to another enemy
      const lt = this.lockTarget;
      if (lt && lt !== r.target && this.alive(lt) && this.enemySurfaceDistance(lt, p.pos) < CLOSE_ATTACK_RANGE) {
        r.target = lt;
        r.weak = r.slashAng;
        r.angle = r.slashAng;
      }
      if (r.target && this.enemySurfaceDistance(r.target, p.pos) > CLOSE_ATTACK_RANGE) {
        this.cancelAim();
        return;
      }
      if (r.finisher) {
        // AUTO-ALIGN: the blade line is drawn onto the yellow line, then the cut fires by itself
        const diff = this.wrapHalf(r.weak - r.angle);
        const step = Math.min(1, 11 * real);
        r.angle += diff * step + Math.sign(diff) * Math.min(Math.abs(diff), 1.2 * real);
        r.angle = ((r.angle % Math.PI) + Math.PI) % Math.PI;
        const left = Math.abs(this.wrapHalf(r.weak - r.angle));
        if (!r.target || !this.alive(r.target)) this.cancelAim();
        else if ((left < 0.03 && r.aimT > 0.45) || r.aimT > 0.75) {
          r.angle = r.weak; // lock exactly on the line
          this.executeCut();
        }
      } else {
        r.angle = ((r.angle % Math.PI) + Math.PI) % Math.PI;
        if (!r.target || !this.alive(r.target)) this.cancelAim();
        else if (r.aimT > 0.2) this.executeCut();
      }
    }
  }

  /** Cut plane that contains the camera's view axis and the on-screen line direction → exactly the line the player sees. */
  private makePlane(p0: THREE.Vector3, ang: number): CutPlane {
    this.camera.updateMatrixWorld(true);
    const r = new THREE.Vector3();
    const u = new THREE.Vector3();
    const b = new THREE.Vector3();
    this.camera.matrixWorld.extractBasis(r, u, b);
    const lineDir = r.multiplyScalar(Math.cos(ang)).addScaledVector(u, Math.sin(ang)).normalize();
    const normal = new THREE.Vector3().crossVectors(b.negate(), lineDir).normalize();
    return { p0: p0.clone(), normal, lineDir, perfect: false };
  }

  /** World-space direction of a slash line, given its orientation as seen from behind the player. */
  private slashLine(ang: number): THREE.Vector3 {
    const yaw = this.player.aim;
    const right = new THREE.Vector3(-Math.cos(yaw), 0, Math.sin(yaw));
    return right.multiplyScalar(Math.cos(ang)).add(new THREE.Vector3(0, Math.sin(ang), 0)).normalize();
  }

  private executeCut() {
    const r = this.rage;
    const p = this.player;
    const tgt = r.target;
    r.aiming = false;
    if (
      !tgt ||
      !this.alive(tgt) ||
      this.enemySurfaceDistance(tgt, p.pos) > CLOSE_ATTACK_RANGE ||
      p.state !== 'cutaim'
    ) {
      this.cancelAim();
      return;
    }
    // a normal aimed cut is a spammable wound; only the final slash (right-click) has a yellow line, a bonus and a kill
    const fin = r.finisher;
    r.finisher = false;
    r.finDown = false;
    const perfect = fin && Math.abs(this.wrapHalf(r.weak - r.angle)) < 0.22;
    r.queue.length = 0;
    const pl0 = this.makePlane(tgt.pos, r.angle);
    r.seq = [{ angle: r.angle, perfect, final: fin, normal: pl0.normal, lineDir: pl0.lineDir }];
    r.seqIdx = 0;
    r.seqTarget = tgt;
    r.target = null;
    r.cutCenter.copy(tgt.pos);
    this.beginCut();
  }

  /** One dash-through along one line of the sequence. */
  private beginCut() {
    const r = this.rage;
    const p = this.player;
    const s = r.seq[r.seqIdx];
    const tgt = r.seqTarget;
    const live = !!tgt && this.alive(tgt);
    if (live) r.cutCenter.copy(tgt!.pos);
    const scale = live ? tgt!.scale : 1;
    const center = r.cutCenter.clone();
    if (live) center.setY(1.2 * scale); // a pile of pieces keeps its real height
    r.plane = { p0: center, normal: s.normal.clone(), lineDir: s.lineDir.clone(), perfect: s.perfect, final: s.final };
    const dir = new THREE.Vector3(r.cutCenter.x - p.pos.x, 0, r.cutCenter.z - p.pos.z);
    const d = dir.length();
    if (d > 0.01) dir.divideScalar(d);
    else dir.copy(fwd(p.yaw));
    // STAY PUT: the slice is cast from where the player stands — no dash through the enemy, the feet never move
    r.dashFrom.copy(p.pos);
    r.dashTo.copy(p.pos);
    p.yaw = Math.atan2(dir.x, dir.z);
    p.aim = p.yaw;
    p.anim = buildCut(s.angle);
    p.state = 'cut';
    p.t = 0;
    p.hitIdx = 0;
    p.vel.set(0, 0, 0);
    r.cutT = 0.7;
    r.cutDone = false;
    this.sfx.whoosh();
  }

  /** The instant the blade passes through: every enemy the plane touches is cut. */
  private performCut() {
    const r = this.rage;
    const pl = r.plane;
    const p = this.player;
    if (!pl) return;
    const fin = !!pl.final;
    // the slash leaves the blade right in front of the player…
    const near = p.pos.clone().addScaledVector(fwd(p.yaw), 1.3).setY(1.25);
    this.streaks.spawn(near, pl.lineDir, fin ? 4 : 3, fin ? 0.2 : 0.12, new THREE.Color(4, 3.2, 3), fin ? 0.5 : 0.3);
    // …and tears through the target wherever it is standing
    this.streaks.spawn(pl.p0, pl.lineDir, fin ? 7 : 5, fin ? 0.34 : 0.2, new THREE.Color(5, 0.5, 0.4), fin ? 1.0 : 0.6);
    this.streaks.spawn(pl.p0, pl.lineDir, fin ? 4.5 : 3.5, 0.09, new THREE.Color(7, 7, 7), fin ? 0.7 : 0.45);
    this.sfx.slice(pl.perfect);
    // spam cuts are light and snappy; the final slash gets the full freeze, shake and flash
    this.hitStop = fin ? 0.14 : 0.04;
    this.shake(fin ? (pl.perfect ? 1 : 0.8) : 0.3);
    this.whiteFlash = fin ? 0.5 : 0.15;
    this.aberr = fin ? 0.04 : 0.015;
    this.fovPunch = fin ? 9 : 3.5;
    r.invert = fin ? (pl.perfect ? 1 : 0.55) : 0;
    this.kickV.copy(fwd(p.yaw)).multiplyScalar(fin ? 0.3 : 0.12);
    p.glow = 0.3;
    // ONE victim per slice. The plane passes through everything on the camera's line of sight, so we never ask "who does it touch" —
    // only the body being carved is cut; enemies standing behind or beside it are left alone.
    const victimId = r.seqTarget ? r.seqTarget.id : r.seqOwner;
    // pieces of that same victim are cut again first (so the halves this very slice creates aren't cut twice).
    // In slow motion they barely part, so the pile stays together.
    if (victimId !== null) {
      const recut = this.sliceWorld.cutPieces(pl.p0, pl.normal, pl.lineDir, 3.6, 4, SLOW_CUT, victimId);
      if (recut > 0) {
        r.keepAlive = true;
        r.focusOwner = victimId;
        this.machineBurst(pl.p0, pl.normal, 6 + recut * 2, 3.5);
      }
    }
    const tgt = r.seqTarget;
    if (tgt && this.alive(tgt)) this.cutEnemy(tgt, pl.perfect, pl, fin);
    // the FINAL slash closes blade mode: a short beat to see it land, then slow-mo ends and everything cut flies apart
    if (fin) r.endT = 0.55;
    this.cutProjectiles(pl.p0, 9, pl);
    // chain: every cut within 4 s of the last one extends the chain and refunds a little rage, so you can keep going
    r.chain = r.chainT > 0 ? r.chain + 1 : 1;
    r.chainT = 4;
    this.addRage(Math.min(14, 3 + r.chain * 2));
    this.addStyle(pl.perfect ? 30 : fin ? 20 : 9);
    this.onEvent({ type: pl.perfect ? 'perfect' : 'cut', text: '斬', n: r.chain });
    r.target = null;
  }

  /**
   * Spam cut (final = false): hurts and staggers but can NEVER kill — the enemy is left hanging on a sliver of health.
   * Final slash (final = true, right-click): ends a normal enemy outright; a perfect one (on the yellow line) also heals you,
   * refills rage and costs a boss one of its lives.
   */
  private cutEnemy(e: Enemy, perfect: boolean, pl: CutPlane, final: boolean) {
    const p = this.player;
    const chest = e.pos.clone().setY(1.2 * e.scale);
    let kill = false;
    if (final) {
      if (perfect) {
        this.addRage(26);
        p.hp = Math.min(p.hpMax, p.hp + p.hpMax * 0.2);
        if (e.pips > 1) this.bossPipLoss(e);
        else kill = true;
      } else if (e.boss) {
        // a boss needs the yellow line to be cut down in one go — otherwise it just takes a heavy blow
        e.hp -= e.hpMax * 0.4;
        if (e.hp <= 0) {
          e.hp = 0;
          if (e.pips > 1) this.bossPipLoss(e);
          else kill = true;
        }
      } else kill = true;
    } else if (!e.boss) {
      // SPAM SLICE: the plane cuts the victim's actual body mesh. The enemy is replaced by the two halves (no copy is left standing),
      // which drift apart slowly while blade mode lasts and are carved again by every following tap.
      e.hp = 0;
      this.sliceKill(e, pl, 5, SLOW_CUT);
      this.sfx.slice(false);
      return;
    } else {
      // a boss can't be killed by spam: it takes a wound and loses a limb (the limb mesh itself is sliced along the plane)
      e.hp = Math.max(e.hpMax * 0.05, e.hp - e.hpMax * 0.09);
      e.imp.addScaledVector(pl.lineDir, 2.5);
      e.impDmg += e.hpMax * 0.02;
      e.impHits++;
      this.severLimb(e, pl);
    }
    if (kill) {
      this.sliceKill(e, pl, 6, this.rage.on ? SLOW_CUT : 1);
      return;
    }
    // A wound vents cyan coolant and a compact electrical flare rather than spraying human blood.
    e.flash = 1;
    e.react = 1;
    e.reactPose = P.hurt;
    this.machineImpactFx(chest, pl.normal, true);
    this.sparkBurst(chest, pl.lineDir, 20, 7, 0.8, ROBOT_SPARK, 0.45);
    if (e.state !== 'broken' && e.state !== 'recoil') {
      this.interruptEnemy(e);
      e.state = 'flinch';
      e.stateT = 0;
      e.stateDur = 0.9;
    }
    // spam cuts barely build posture, so they can't chain into a posture-break finish by themselves
    this.addEnemyPosture(e, final ? 55 : 8);
  }

  /**
   * A spam slice (left-click in blade mode) cuts clean through the limb nearest to the blade's plane: it becomes a free rigid body
   * that tumbles away, blood sprays from the stump, and the enemy fights on without it. Max 3 limbs per enemy (never both legs).
   * The head and torso stay for the final slash.
   */
  private severLimb(e: Enemy, pl: CutPlane): boolean {
    if (e.sevN >= 3 || !this.alive(e)) return false;
    const rig = e.rig;
    rig.root.updateMatrixWorld(true);
    const names: LimbName[] = ['rArm', 'lArm', 'rLeg', 'lLeg'];
    const box = new THREE.Box3();
    const c = new THREE.Vector3();
    let best: LimbName | null = null;
    let bd = 1.3 * e.scale;
    let bs = 1;
    for (const nm of names) {
      if (rig.severed.has(nm)) continue;
      if (nm === 'rLeg' && rig.severed.has('lLeg')) continue;
      if (nm === 'lLeg' && rig.severed.has('rLeg')) continue;
      box.setFromObject(rig.limbs[nm]);
      box.getCenter(c);
      const sd = pl.normal.dot(c.sub(pl.p0));
      if (Math.abs(sd) < bd) {
        bd = Math.abs(sd);
        best = nm;
        bs = sd >= 0 ? 1 : -1;
      }
    }
    if (!best) return false;
    const limb = rig.limbs[best];
    const joint = limb.getWorldPosition(new THREE.Vector3());
    const base = new THREE.Vector3(e.vel.x, 0, e.vel.z);
    // build the debris BEFORE hiding the limb (hidden meshes are skipped). The limb's own mesh is sliced along the blade's plane,
    // so the severed piece has a real cut face; if the plane misses it, the whole limb simply drops.
    const lc = box.setFromObject(limb).getCenter(new THREE.Vector3());
    lc.addScaledVector(pl.normal, -pl.normal.dot(lc.clone().sub(pl.p0)));
    const cutLimb = this.sliceWorld.cutObject(limb, lc, pl.normal, pl.lineDir, { J: 5, vel: base, gentle: SLOW_CUT, owner: e.id });
    if (!cutLimb) this.sliceWorld.detach(limb, joint, pl.p0, pl.normal, pl.lineDir, bs, { J: 5, vel: base, gentle: SLOW_CUT, owner: e.id });
    this.rage.keepAlive = true;
    this.rage.focusOwner = e.id;
    if (best === 'rArm') {
      // the sword goes with the arm
      this.sliceWorld.detach(rig.weaponObj, null, pl.p0, pl.normal, pl.lineDir, -bs, { J: 4, vel: base, gentle: SLOW_CUT, owner: e.id });
      rig.dropWeapon();
      e.disarmed = true;
    }
    if (best === 'lArm' && e.kind === 'archer') e.disarmed = true; // can't draw the bow any more
    rig.sever(best);
    e.stumps.push(rig.stumps[best]);
    e.sevN++;
    e.bleedT = 3.2;
    if (e.state === 'attack') this.interruptEnemy(e);
    this.machineImpactFx(joint, pl.normal.clone().multiplyScalar(bs), true);
    this.sfx.hit(true);
    this.shake(0.22);
    return true;
  }

  private bossPipLoss(e: Enemy) {
    e.pips--;
    e.hp = e.hpMax;
    e.posture = 0;
    e.lethal = false;
    this.interruptEnemy(e);
    e.state = 'recoil';
    e.stateT = 0;
    e.stateDur = 1.6;
    e.phase2 = true;
    e.speedMul = this.isHeavyBoss(e) ? 1.12 : 1.38;
    e.dmgMul = 0.75;
    e.rig.bladeMat.emissive.setHex(0xff2010);
    e.glow = 0.4;
    this.onEvent({ type: 'phase2', text: 'Jenderal mengamuk!' });
  }

  /** Real mesh split: the fighter is replaced by two clipped clones that fly apart. */
  private sliceKill(e: Enemy, pl: CutPlane, power = 6, gentle = 1) {
    const chest = this.tmpV.copy(e.pos).setY(1.2 * e.scale);
    const off = pl.normal.dot(this.tmpV2.copy(chest).sub(pl.p0));
    const c = chest.clone().addScaledVector(pl.normal, -off);
    const J = power;
    // the victim's own body is cut along the plane — its mesh becomes the two halves, nothing is copied or duplicated
    const base = new THREE.Vector3(e.vel.x, 0, e.vel.z).multiplyScalar(gentle);
    const pieces = this.sliceWorld.cutObject(e.rig.root, c, pl.normal, pl.lineDir, { J, vel: base, gentle, owner: e.id });
    if (gentle < 1) {
      // blade mode stays on so the pieces can keep being carved in slow motion — and THIS body stays the focus
      this.rage.keepAlive = true;
      this.rage.focusOwner = e.id;
    }
    if (pieces) {
      e.rig.root.visible = false;
      e.trail.mesh.visible = false;
      e.trailOn = false;
      e.state = 'dying';
      e.stateT = 0;
      e.removeAt = this.time + 0.2;
    } else {
      // plane missed the body — fall back to a normal death
      e.state = 'dying';
      e.stateT = 0;
      e.removeAt = this.time + (e.boss ? 3.5 : 2.2);
      e.trailOn = false;
    }
    e.hp = 0;
    e.lethal = false;
    this.stats.kills++;
    if (pieces && e.impHits >= 3 && gentle >= 1 && !this.rage.on) this.sliceWorld.shatter(pieces, 3 + Math.min(3, e.impHits));
    this.maybeKillCam(e);
    if (gentle >= 1) this.sliceWorld.cutPieces(c, pl.normal, pl.lineDir, 2.5, 3, 1, e.id);
    const nn = pl.normal.clone().negate();
    const ln = pl.lineDir.clone().negate();
    // in slow motion the spray is lighter, so the cut face stays readable instead of vanishing into a red cloud
    const bk = gentle < 1 ? 0.45 : 1;
    this.machineBurst(c, pl.normal, Math.round(56 * bk), 9 * (0.5 + 0.5 * bk));
    this.machineBurst(c, nn, Math.round(56 * bk), 9 * (0.5 + 0.5 * bk));
    this.sparkBurst(c, pl.lineDir, 46, 9, 1.0, ROBOT_SPARK, 0.72);
    this.sparkBurst(c, ln, 46, 9, 1.0, ROBOT_SPARK, 0.72);
    this.glowBurst(c, 20, 0.24, ROBOT_GLOW, 5);
    this.shocks.spawn(c, 0x48dff4, 4.8, 0.58);
    this.shocks.spawn(c, 0xffffff, 2.2, 0.32);
    this.flashAt(c, 0x62e8ff, 36);
  }

  /** Normal slash that lands the final blow while in blade mode → the enemy is cut apart along that slash. */
  private rageKill(e: Enemy, ang: number, power = 6) {
    const pl = this.slashPlane(e.pos.clone().setY(1.2 * e.scale), ang + rand(-0.1, 0.1));
    e.hp = 0;
    if (e.pips > 1) this.bossPipLoss(e);
    else this.sliceKill(e, pl, power);
    this.sfx.slice(false);
    this.streaks.spawn(pl.p0, pl.lineDir, 4.5, 0.2, new THREE.Color(5, 0.6, 0.4), 0.7);
    this.addRage(6);
  }

  /**
   * Physical plane of a normal slash: it contains the blade's travel line AND the player's forward axis,
   * so a diagonal swing cuts the body on that exact diagonal, a horizontal swing cuts at the waist, etc.
   */
  private slashPlane(p0: THREE.Vector3, ang: number): CutPlane {
    const ld = this.slashLine(ang);
    const f = fwd(this.player.aim);
    const normal = new THREE.Vector3().crossVectors(f, ld);
    if (normal.lengthSq() < 1e-4) normal.set(0, 1, 0);
    normal.normalize();
    return { p0: p0.clone(), normal, lineDir: ld, perfect: false };
  }

  /** Every swing leaves a razor streak along its true cut line + a directional camera push. */
  private onPlayerStrike(h: HitDef) {
    const p = this.player;
    if (h.kind === 'kick') return;
    const ld = this.slashLine(h.ang ?? 0.6);
    const c = p.pos.clone().addScaledVector(fwd(p.aim), 1.45).setY(1.25);
    this.streaks.spawn(
      c,
      ld,
      h.heavy ? 3.4 : 2.7,
      h.heavy ? 0.17 : 0.11,
      this.rage.on ? new THREE.Color(4, 0.5, 0.4) : new THREE.Color(2.2, 2.6, 3.2),
      h.heavy ? 0.34 : 0.26,
    );
    this.kickV.addScaledVector(fwd(p.aim), h.heavy ? 0.28 : 0.14);
    // any swing also cuts arrows and bullets out of the air
    this.cutProjectiles(p.pos.clone().addScaledVector(fwd(p.aim), 1.5).setY(1.2), 2.8);
    p.glow = Math.max(p.glow, 0.25);
    if (this.rage.on) {
      // the blade also slices any debris still tumbling through the air along its path
      const pl = this.slashPlane(c, h.ang ?? 0.6);
      this.sliceWorld.cutPieces(c, pl.normal, ld, 2.4, 3);
    }
  }

  private onPlayerHitFx(e: Enemy, h: HitDef, impact: THREE.Vector3) {
    const ld = this.slashLine(h.ang ?? 0.6);
    this.machineImpactFx(impact, ld, h.heavy);
    this.streaks.spawn(
      impact,
      ld,
      h.heavy ? 3.0 : 2.3,
      0.15,
      this.rage.on ? new THREE.Color(5, 0.6, 0.4) : new THREE.Color(2.2, 3.1, 3.6),
      0.3,
    );
    e.flash = Math.max(e.flash, 0.7);
    if (!this.rage.on) this.addRage(h.heavy ? 6 : 3.5);
    this.addStyle(h.heavy ? 8 : 4.5);
    if (h.heavy) this.slowmo(0.07, 0.4);
  }

  private rageSnapshot(): Snapshot['rage'] {
    const r = this.rage;
    let aim: Snapshot['rage']['aim'] = null;
    const t = r.target;
    if (r.aiming && t && this.alive(t)) {
      const c = t.pos.clone().setY(1.2 * t.scale);
      const s0 = this.project(c);
      const rr = new THREE.Vector3();
      const uu = new THREE.Vector3();
      const bb = new THREE.Vector3();
      this.camera.matrixWorld.extractBasis(rr, uu, bb);
      const s1 = this.project(c.clone().addScaledVector(rr, 0.9 * t.scale));
      const half = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      aim = {
        x: s0.x,
        y: s0.y,
        angle: r.angle,
        weak: r.weak,
        finisher: r.finisher,
        // only the final slash has a yellow line, so only it can ever read as "perfect"
        perfect: r.finisher && Math.abs(this.wrapHalf(r.weak - r.angle)) < 0.22,
        band: Math.max(60, half * 2),
        locked: [],
      };
    }
    // guide line: shows where the next tap will cut, drawn over the body you are carving
    let guide: Snapshot['rage']['guide'] = null;
    if (r.on && !r.aiming) {
      let c: THREE.Vector3 | null = null;
      if (r.focusOwner !== null) c = this.sliceWorld.clusterNear(this.player.pos, CLOSE_PIECE_RANGE, r.focusOwner);
      if (!c) {
        const t2 = this.lockOn ? this.lockTarget : this.nearestCloseEnemy();
        if (t2 && this.alive(t2) && this.enemySurfaceDistance(t2, this.player.pos) <= CLOSE_ATTACK_RANGE) {
          c = t2.pos.clone().setY(1.2 * t2.scale);
        }
      }
      if (c) {
        const s0 = this.project(c);
        if (s0.on) guide = { x: s0.x, y: s0.y, angle: r.slashAng, hot: r.steerT > 0 };
      }
    }
    return { on: r.on, meter: clamp(r.meter / 100, 0, 1), ready: r.meter >= 18, chain: r.chain, aim, guide };
  }

  /* ================= FREESTYLE / CINEMA / STYLE RANK ================= */
  private startStyle() {
    const p = this.player;
    let idx = this.styleForce >= 0 ? this.styleForce : Math.floor(Math.random() * STYLES.length);
    if (this.styleForce < 0 && idx === this.styleLast) idx = (idx + 1) % STYLES.length;
    this.styleForce = -1;
    this.styleLast = idx;
    this.styleDef = STYLES[idx];
    this.styleFx = 0;
    this.styleSt = 0;
    p.state = 'style';
    p.t = 0;
    p.anim = null;
    p.vel.multiplyScalar(0.3);
    p.aim = p.yaw;
    this.idleT = 0;
    this.addStyle(8);
  }

  /** Start a cinematic shot. It blends over the gameplay camera and fades back out. */
  private startCine(kind: 'intro' | 'kill', center: THREE.Vector3, dur: number) {
    const c = this.cine;
    c.kind = kind;
    c.t = 0;
    c.dur = dur;
    c.center.copy(center);
    c.dir = Math.random() < 0.5 ? 1 : -1;
    if (kind === 'intro') {
      c.a0 = 0;
      c.r0 = 15;
      c.r1 = 6.4;
      c.h0 = 10;
      c.h1 = 2.6;
      c.fov = 50;
    } else {
      c.a0 = Math.atan2(this.camPos.x - center.x, this.camPos.z - center.z);
      c.r0 = 5.4;
      c.r1 = 3.1;
      c.h0 = 1.5;
      c.h1 = 1.15;
      c.fov = 34;
    }
  }

  private maybeKillCam(e: Enemy) {
    if (this.rage.on) return; // blade mode already is the slow-motion show — no second camera on top of it
    if (this.enemies.some((o) => o !== e && this.alive(o))) return;
    if (this.cine.kind === 'kill' && this.cine.t < this.cine.dur) return;
    this.startCine('kill', e.pos.clone().setY(1.1 * e.scale), 2.1);
    this.slowmo(1.3, 0.22);
  }

  private addStyle(n: number) {
    this.styleScore = Math.min(100, this.styleScore + n);
    this.styleHold = 3.2;
  }

  private styleRank() {
    const s = this.styleScore;
    const ranks: [number, string][] = [[88, 'SSS'], [74, 'SS'], [60, 'S'], [44, 'A'], [28, 'B'], [14, 'C'], [3, 'D']];
    for (const [t, r] of ranks) if (s >= t) return r;
    return '';
  }

  /* ================= RANGED ENEMIES & PROJECTILES ================= */
  private flowLevel() {
    return clamp((this.styleScore - 30) / 60, 0, 1);
  }

  setShakeScale(v: number) {
    this.shakeScale = v;
  }

  private enemyFire(e: Enemy, idx: number) {
    const p = this.player;
    e.rig.root.updateMatrixWorld(true);
    const mp = e.rig.muzzle.getWorldPosition(new THREE.Vector3());
    const arrow = e.kind === 'archer';
    const spd = arrow ? 27 : 58;
    const target = p.pos.clone();
    target.y += 1.1;
    const t = mp.distanceTo(target) / spd;
    // lead the target only partly: strafing gets punished, a well-timed dodge still wins
    target.x += p.vel.x * t * 0.5;
    target.z += p.vel.z * t * 0.5;
    const dir = target.sub(mp).normalize();
    if (arrow && e.anim?.name === 'volley') {
      const a = (idx - 1) * 0.1;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const x = dir.x * c - dir.z * s;
      dir.z = dir.x * s + dir.z * c;
      dir.x = x;
    } else {
      dir.x += rand(-0.012, 0.012);
      dir.y += rand(-0.01, 0.01);
      dir.normalize();
    }
    this.proj.spawn(arrow ? 'arrow' : 'bullet', mp, dir.clone().multiplyScalar(spd), e.id, arrow ? 15 : 24, arrow ? 16 : 26);
    if (arrow) {
      this.sfx.bowRelease();
      e.react = 0.25;
    } else {
      this.sfx.shot();
      this.sparkBurst(mp, dir, 14, 9, 0.5, new THREE.Color(2.2, 1.4, 0.6), 0.25);
      this.glowBurst(mp, 5, 0.14, new THREE.Color(1.8, 1.2, 0.6), 2);
      this.dustBurst(mp, 6, 1.6);
      this.flashAt(mp, 0xffc080, 14);
      e.vel.addScaledVector(dir, -2.5);
      e.react = 0.5;
      // the crack shakes the frame more the closer the gunner is
      this.shake(0.1 + 0.2 * clamp(1 - mp.distanceTo(p.pos) / 22, 0, 1));
    }
    e.reactPose = P.deflected;
  }

  /** Per-frame logic of a ranged attack: telegraph, bow draw animation, and releasing the shots on time. */
  private rangedTick(e: Enemy, a: AnimDef) {
    const f = a.fire!;
    if (a.aimT && e.fireIdx < f.length && e.t >= a.aimT[0]) {
      if (!e.warned) {
        e.warned = true;
        this.sfx.aimWarn();
        if (e.kind === 'archer') this.sfx.bowDraw();
      }
      e.aiming = e.fireIdx === 0;
    }
    if (e.kind === 'archer') {
      let draw = 0;
      let nock = false;
      if (e.fireIdx < f.length) {
        const lead = e.fireIdx === 0 ? 0.75 : 0.28;
        draw = clamp(1 - (f[e.fireIdx] - e.t) / lead, 0, 1);
        draw = draw * draw * (3 - 2 * draw);
        nock = true;
      }
      e.rig.setDraw(draw, nock);
    }
    while (e.fireIdx < f.length && e.t >= f[e.fireIdx]) {
      this.enemyFire(e, e.fireIdx);
      e.fireIdx++;
    }
  }

  /** Thin red aim line from the muzzle to the player that sharpens right before the shot. */
  private updateAimLine(e: Enemy) {
    const m = e.aimMesh;
    const a = e.anim;
    if (!e.aiming || !a?.aimT || !a.fire) {
      m.visible = false;
      return;
    }
    const u = clamp((e.t - a.aimT[0]) / Math.max(0.01, a.fire[0] - a.aimT[0]), 0, 1);
    const from = e.rig.muzzle.getWorldPosition(new THREE.Vector3());
    const to = this.player.pos.clone();
    to.y += 1.1;
    const d = to.sub(from);
    const len = Math.min(d.length(), 24);
    d.normalize();
    m.visible = true;
    m.position.copy(from).addScaledVector(d, len / 2);
    m.scale.set(1 + u * 2, 1 + u * 2, len);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    (m.material as THREE.MeshBasicMaterial).opacity = 0.1 + 0.4 * u * u;
  }

  private updateProjectiles(dt: number) {
    const p = this.player;
    this.proj.update(dt);
    const q = new THREE.Vector3();
    for (const pr of this.proj.items.slice()) {
      if (pr.stuck) {
        if (pr.life <= 0) this.proj.remove(pr);
        continue;
      }
      if (
        pr.life <= 0 ||
        Math.abs(pr.pos.x) > ARENA_HALF_EXTENT + 8 ||
        Math.abs(pr.pos.z) > ARENA_HALF_EXTENT + 8
      ) {
        this.proj.remove(pr);
        continue;
      }
      if (pr.pos.y <= 0.05) {
        q.copy(pr.pos).setY(0.1);
        if (pr.kind === 'arrow') {
          pr.stuck = true;
          pr.life = 5;
          pr.vel.set(0, 0, 0);
          this.dustBurst(q, 4, 1.5);
          this.sfx.arrowHit();
        } else {
          this.dustBurst(q, 6, 2);
          this.sparkBurst(q, new THREE.Vector3(0, 1, 0), 10, 5, 1, new THREE.Color(2.2, 1.6, 0.9), 0.3);
          this.proj.remove(pr);
        }
        continue;
      }
      let consumed = false;
      for (let s = 1; s <= 3 && !consumed; s++) {
        q.copy(pr.prev).lerp(pr.pos, s / 3);
        if (!pr.reflected) {
          const dx = q.x - p.pos.x;
          const dz = q.z - p.pos.z;
          if (dx * dx + dz * dz < 0.3 && q.y > p.pos.y - 0.1 && q.y < p.pos.y + 1.95 * this.sizeK) {
            const r = this.projectileHitPlayer(pr);
            if (r === 'hit') consumed = true;
            else if (r === 'deflect') break;
          }
        } else {
          for (const e of this.enemies) {
            if (!this.alive(e)) continue;
            const dx = q.x - e.pos.x;
            const dz = q.z - e.pos.z;
            if (dx * dx + dz * dz < 0.45 * e.scale * e.scale + 0.15 && q.y > 0 && q.y < 2.0 * e.scale) {
              this.reflectedHit(pr, e);
              consumed = true;
              break;
            }
          }
        }
      }
      if (consumed) this.proj.remove(pr);
    }
  }

  private projectileHitPlayer(pr: Proj): 'hit' | 'pass' | 'deflect' {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'deathblow' || p.state === 'cut') return 'pass';
    if (p.inv > 0 || (p.state === 'dodge' && p.t > 0.03 && p.t < 0.34)) {
      if (!pr.whooshed) {
        pr.whooshed = true;
        this.sfx.whoosh();
        this.addStyle(10);
        this.shake(0.1);
      }
      return 'pass';
    }
    const vdir = pr.vel.clone().normalize();
    const facing = fwd(p.yaw);
    const frontal = facing.dot(vdir) < -0.1;
    const contact = p.pos.clone().addScaledVector(facing, 0.75).setY(1.3);
    if (p.state === 'idle' && this.guardHeld && frontal) {
      if (p.guardT <= 0.3) {
        this.deflectProjectile(pr, contact);
        return 'deflect';
      }
      // plain block
      this.sfx.block();
      this.sparkBurst(contact, vdir.clone().multiplyScalar(-0.5).setY(0.3), 24, 6, 1, new THREE.Color(2.2, 1.1, 0.4), 0.4);
      this.flashAt(contact, 0xffb060, 10);
      this.hitstop(0.05);
      this.shake(0.28);
      this.kickV.addScaledVector(vdir, 0.15);
      p.vel.addScaledVector(vdir, 3.5);
      p.react = 0.7;
      p.reactPose = p.kickSide > 0 ? P.kickA : P.kickB;
      p.kickSide *= -1;
      p.hp = Math.max(1, p.hp - pr.dmg * 0.1);
      this.streak = 0;
      this.addPlayerPosture(pr.post);
      return 'hit';
    }
    // clean hit
    const impact = p.pos.clone().setY(1.25);
    p.hp -= pr.dmg;
    this.streak = 0;
    this.sfx.hurt();
    if (pr.kind === 'arrow') this.sfx.arrowHit();
    this.bloodBurst(impact, vdir, 24, 7);
    this.sparkBurst(impact, vdir, 8, 5, 1, new THREE.Color(2.4, 0.8, 0.5), 0.3);
    this.hitstop(0.09);
    this.shake(0.6);
    this.kickV.addScaledVector(vdir, 0.32);
    this.hurtFx = 0.9;
    this.aberr = 0.015;
    p.flash = 1;
    p.vel.addScaledVector(vdir, 4);
    p.anim = null;
    p.trailOn = false;
    if (p.hp <= 0) {
      p.hp = 0;
      this.killPlayer();
      return 'hit';
    }
    if (p.state !== 'broken') {
      p.state = 'hurt';
      p.t = 0;
    }
    this.addPlayerPosture(pr.post * 0.6);
    return 'hit';
  }

  /** Perfect parry on a projectile: it is sent flying back at the shooter, faster and deadlier. */
  private deflectProjectile(pr: Proj, contact: THREE.Vector3) {
    const p = this.player;
    this.streak++;
    this.streakT = 0;
    this.stats.deflects++;
    const shooter = this.enemies.find((e) => e.id === pr.owner && this.alive(e)) ?? this.nearestEnemy();
    const dir = shooter
      ? new THREE.Vector3(shooter.pos.x - contact.x, 1.2 * shooter.scale - contact.y, shooter.pos.z - contact.z).normalize()
      : pr.vel.clone().normalize().multiplyScalar(-1);
    const spd = pr.vel.length() * 1.3;
    pr.pos.copy(contact);
    pr.prev.copy(contact);
    pr.vel.copy(dir).multiplyScalar(spd);
    pr.reflected = true;
    pr.life = 3;
    pr.dmg = pr.kind === 'bullet' ? 60 : 40;
    pr.post = 45;
    this.sfx.deflect(this.streak);
    this.sparkBurst(contact, dir.clone().multiplyScalar(-0.3).setY(0.5), 70, 9, 1.1, new THREE.Color(3, 2.4, 1.2), 0.6);
    this.glowBurst(contact, 10, 0.18, new THREE.Color(2, 1.6, 0.8), 3);
    this.shocks.spawn(contact, 0xfff0c0, 2.6, 0.35);
    this.flashAt(contact, 0xffe8b0, 26);
    this.hitstop(0.09);
    this.shake(0.45);
    this.aberr = 0.012;
    this.fovPunch = 3;
    p.glow = 1;
    p.react = 1;
    p.reactPose = p.kickSide > 0 ? P.kickA : P.kickB;
    p.kickSide *= -1;
    this.addPlayerPosture(3);
    this.onEvent({ type: 'deflect', n: this.streak });
  }

  /** A reflected arrow / bullet reaches an enemy. */
  private reflectedHit(pr: Proj, e: Enemy) {
    const dir = pr.vel.clone().normalize();
    const impact = pr.pos.clone();
    this.sfx.hit(true);
    this.machineBurst(impact, dir, 12, 8);
    this.sparkBurst(impact, dir, 24, 7, 0.8, ROBOT_SPARK, 0.44);
    this.shocks.spawn(impact, 0x62eaff, 3, 0.4);
    this.flashAt(impact, 0x75eaff, 18);
    this.hitstop(0.1);
    this.slowmo(0.12, 0.35);
    this.shake(0.5);
    e.flash = 1;
    e.react = 1;
    e.reactPose = P.hurt;
    e.vel.addScaledVector(dir, 4);
    e.hp -= pr.dmg;
    this.addRage(8);
    this.addStyle(18);
    this.onEvent({ type: 'reflect', text: '返し' });
    // a shot you batted back is a kill: the body is cut open along the line it travelled
    if (pr.lethal && this.alive(e)) {
      this.hitstop(0.12);
      this.slowmo(0.3, 0.3);
      this.shake(0.7);
      this.whiteFlash = 0.25;
      e.hp = 0;
      if (e.pips > 1) this.bossPipLoss(e);
      else {
        const ang = Math.atan2(dir.y, Math.hypot(dir.x, dir.z)) + Math.PI / 2;
        const pl = this.slashPlane(impact, ang);
        this.sliceKill(e, pl, 7, 1);
      }
      return;
    }
    if (e.hp <= 0 && e.state !== 'broken') {
      e.hp = 0;
      this.breakEnemy(e, true);
    } else if (this.alive(e)) {
      if (e.state === 'attack') this.interruptEnemy(e);
      if (e.state === 'idle' || e.state === 'attack') {
        e.state = 'flinch';
        e.stateT = 0;
        e.stateDur = 0.5;
      }
      this.addEnemyPosture(e, pr.post);
    }
  }

  /**
   * A blade in the path of an arrow / bullet BATS IT BACK at whoever fired it (Katana ZERO style) — a returned shot
   * is lethal: it kills a normal enemy outright and takes a huge bite out of a boss.
   */
  private cutProjectiles(center: THREE.Vector3, reach: number, plane?: CutPlane): number {
    let n = 0;
    const q = new THREE.Vector3();
    for (const pr of this.proj.items) {
      if (pr.stuck || pr.reflected) continue;
      if (pr.pos.distanceTo(center) > reach) continue;
      if (plane && Math.abs(plane.normal.dot(q.copy(pr.pos).sub(plane.p0))) > 0.7) continue;
      n++;
      // aim it back at the shooter (or at the nearest enemy if he is already gone)
      let tgt = this.enemies.find((e) => e.id === pr.owner && this.alive(e)) ?? null;
      if (!tgt) tgt = this.nearestEnemy();
      const dir = tgt
        ? new THREE.Vector3(tgt.pos.x - pr.pos.x, 1.15 * tgt.scale - pr.pos.y, tgt.pos.z - pr.pos.z).normalize()
        : pr.vel.clone().normalize().multiplyScalar(-1);
      pr.vel.copy(dir).multiplyScalar(Math.max(34, pr.vel.length() * 1.45));
      pr.prev.copy(pr.pos);
      pr.reflected = true;
      pr.lethal = true;
      pr.life = 3;
      pr.dmg = 9999; // a returned shot finishes whoever it reaches
      pr.post = 60;
      this.sfx.arrowCut();
      this.sparkBurst(pr.pos, dir.clone().multiplyScalar(-0.4).setY(0.4), 26, 8, 1, new THREE.Color(2.6, 2.2, 1.2), 0.4);
      this.streaks.spawn(pr.pos, dir, 2.4, 0.1, new THREE.Color(3.4, 3, 2), 0.22);
      this.flashAt(pr.pos, 0xffe2a0, 14);
    }
    if (n) {
      this.addRage(7 * n);
      this.addStyle(12 * n);
      this.hitstop(0.05);
      this.shake(0.22);
    }
    return n;
  }

  private removeEnemy(e: Enemy) {
    this.scene.remove(e.aimMesh);
    this.scene.remove(e.rig.root);
    this.scene.remove(e.trail.mesh);
  }

  /* ================= effects ================= */
  private shake(a: number) {
    this.trauma = Math.min(1, this.trauma + a * this.shakeScale);
  }
  private hitstop(s: number) {
    this.hitStop = Math.max(this.hitStop, this.rage.on ? s * 0.4 : s);
  }
  private slowmo(s: number, scale: number) {
    this.slow = Math.max(this.slow, s);
    this.slowScale = scale;
  }

  private sparkBurst(p: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number, spread: number, color: THREE.Color, life = 0.55) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(-0.3, 1), rand(-1, 1)).normalize().multiplyScalar(spread);
      v.addScaledVector(dir, 1);
      v.multiplyScalar(speed * rand(0.35, 1.2));
      this.sparks.emit(p, v, color, life * rand(0.6, 1.2));
    }
  }
  private glowBurst(p: THREE.Vector3, n: number, size: number, color: THREE.Color, speed: number) {
    const v = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(-1, 1), rand(-1, 1)).normalize().multiplyScalar(speed * rand(0.2, 1));
      this.glowP.emit(p, v, color, size * rand(0.6, 1.4), rand(0.2, 0.55));
    }
  }
  /** Damage feedback for the mechanical troops: a few cyan coolant motes plus crisp electrical sparks. */
  private machineBurst(p: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number) {
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(0.55);
      v.addScaledVector(dir, 1.25).multiplyScalar(speed * rand(0.3, 1.1));
      if (i % 3 === 0) {
        c.setRGB(rand(0.45, 0.9), rand(1.8, 3.0), rand(2.6, 4.2));
        this.sparks.emit(p, v, c, rand(0.16, 0.42));
      } else {
        c.setRGB(rand(0.04, 0.2), rand(0.65, 1.25), rand(1.2, 2.1));
        this.blood.emit(p, v, c, rand(0.035, 0.09), rand(0.28, 0.75));
      }
    }
  }

  private machineImpactFx(p: THREE.Vector3, dir: THREE.Vector3, heavy = false) {
    this.machineBurst(p, dir, heavy ? 9 : 5, heavy ? 6.5 : 4.2);
    this.sparkBurst(p, dir, heavy ? 28 : 16, heavy ? 8 : 6, 0.8, ROBOT_SPARK, heavy ? 0.58 : 0.4);
    this.glowBurst(p, heavy ? 12 : 6, heavy ? 0.16 : 0.11, ROBOT_GLOW, heavy ? 3.2 : 2.2);
    this.shocks.spawn(p, 0x62eaff, heavy ? 1.8 : 1.15, heavy ? 0.36 : 0.27);
    this.flashAt(p, 0x6be8ff, heavy ? 20 : 12);
  }

  /**
   * 'kz'      — Katana ZERO: thick neon-red gore, flat and loud, thrown in a hard fan.
   * 'classic' — the machines spit arcs of blue electricity and coolant instead.
   */
  private bloodBurst(p: THREE.Vector3, dir: THREE.Vector3, n: number, speed: number) {
    const v = new THREE.Vector3();
    const c = new THREE.Color();
    const kz = this.fxStyle === 'kz';
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(-0.2, 1), rand(-1, 1)).multiplyScalar(kz ? 0.55 : 0.7);
      v.addScaledVector(dir, kz ? 1.45 : 1.2).multiplyScalar(speed * rand(0.3, 1.1));
      if (kz) {
        // fat crimson droplets + a few bright streaks tearing through them
        if (i % 5 === 0) {
          c.setRGB(rand(2.6, 4.0), rand(0.1, 0.35), rand(0.1, 0.3));
          this.sparks.emit(p, v, c, rand(0.16, 0.4));
        } else {
          c.setRGB(rand(0.6, 1.0), rand(0.01, 0.06), rand(0.02, 0.08));
          this.blood.emit(p, v, c, rand(0.08, 0.22), rand(0.5, 1.3));
        }
      } else if (i % 2 === 0) {
        c.setRGB(rand(0.3, 0.9), rand(1.8, 3.2), rand(2.6, 4.2));
        this.sparks.emit(p, v, c, rand(0.18, 0.5));
      } else {
        c.setRGB(rand(0.05, 0.3), rand(0.7, 1.5), rand(1.4, 2.2));
        this.blood.emit(p, v, c, rand(0.04, 0.12), rand(0.35, 0.9));
      }
    }
  }
  private dustBurst(p: THREE.Vector3, n: number, speed = 2) {
    const v = new THREE.Vector3();
    const c = new THREE.Color(0.55, 0.45, 0.42);
    for (let i = 0; i < n; i++) {
      v.set(rand(-1, 1), rand(0.1, 0.6), rand(-1, 1)).multiplyScalar(speed * rand(0.4, 1));
      this.dust.emit(p, v, c, rand(0.25, 0.6), rand(0.5, 1.0));
    }
  }
  private flashAt(p: THREE.Vector3, color: number, intensity: number) {
    this.flashLight.position.copy(p);
    this.flashLight.color.setHex(color);
    // kept low: a strong point light right on the enemy is what used to wash them out to white
    this.flashLight.intensity = intensity * 0.07;
  }

  private updateFx(dt: number, real: number) {
    // Blade mode slows the WHOLE world — pieces, blood, dust, sparks all crawl together. When the final slash ends the mode,
    // the clock returns to normal and the pieces (launched in releaseImpulse) fly at full speed.
    const fxDt = dt;
    this.blood.update(fxDt);
    this.dust.update(fxDt);
    this.glowP.update(dt);
    this.sparks.update(fxDt);
    this.shocks.update(dt, this.camera);
    this.flashLight.intensity *= Math.exp(-11 * dt);
    this.trauma = Math.max(0, this.trauma - real * 1.7);
    this.fovPunch *= Math.exp(-10 * real);
    this.aberr *= Math.exp(-9 * real);
    this.whiteFlash *= Math.exp(-14 * real);
    this.hurtFx *= Math.exp(-4 * real);
    const u = this.post.uniforms;
    u.aberr.value = this.aberr * 0.3;
    u.flash.value = this.whiteFlash * 0.05;
    const lowHp = this.player.hp / this.player.hpMax < 0.3 && this.player.state !== 'dead' ? 0.12 + Math.sin(this.time * 6) * 0.05 : 0;
    u.hurt.value = Math.max(this.hurtFx, lowHp);
    const targetSat = this.player.state === 'dead' ? 0.15 : 1;
    this.sat += (targetSat - this.sat) * (1 - Math.exp(-3 * real));
    u.sat.value = this.sat;
    u.time.value = this.time % 100;
    // the muzzle-flash light must fade in real time, not in (slow) world time
    this.flashLight.intensity *= Math.exp(-11 * Math.max(0, real - dt));
    this.streaks.update(real, this.camera);
    this.sliceWorld.update(fxDt, real, this.sliceFx);
    this.rageFx += ((this.rage.on ? 1 : 0) - this.rageFx) * (1 - Math.exp(-5 * real));
    const ru = this.ragePass.uniforms;
    ru.rage.value = this.rageFx;
    ru.aim.value = this.rage.aiming ? Math.min(1, ru.aim.value + real * 5) : Math.max(0, ru.aim.value - real * 4);
    ru.invert.value = this.rage.invert * 0.1;
    ru.time.value = (performance.now() * 0.001) % 100;
    u.aberr.value += this.rageFx * 0.0008;
    const pp = this.player;
    const sprintK =
      pp.state === 'idle' ? clamp((Math.hypot(pp.vel.x, pp.vel.z) - this.sprintSpd * 0.6) / (this.sprintSpd * 0.35), 0, 1) : 0;
    ru.speed.value += (sprintK - ru.speed.value) * (1 - Math.exp(-6 * real));
    ru.edge.value = Math.max(this.cineW, this.rage.aiming ? 0.7 : 0);
  }

  /* ================= camera ================= */
  private updateCamera(dt: number, real: number) {
    const p = this.player;
    const tgt = this.lockOn ? this.lockTarget : null;
    const arrow = (this.keys.has('ArrowLeft') ? 1 : 0) - (this.keys.has('ArrowRight') ? 1 : 0);
    if (!tgt) this.camYaw += arrow * 2.2 * real;
    // smaller fighters → pull the camera in so they still fill the frame
    let dist = 6.2 * (0.45 + 0.55 * this.sizeK);
    let pitch = this.camPitch;
    // sense of speed: the lens widens when sprinting — and through the air too, so an air dash (17.5 m/s)
    // and a long rooftop leap stretch the frame instead of flying past at walking lens
    const fastStates = p.state === 'idle' || p.state === 'jump' || p.state === 'dive';
    let fovT = 58 + (fastStates ? clamp((Math.hypot(p.vel.x, p.vel.z) - 6) * 1.7, 0, 8) : 0);
    const pivot = this.tmpV.copy(p.pos).add(new THREE.Vector3(0, 1.55 * this.sizeK, 0));
    if (tgt) {
      const dx = tgt.pos.x - p.pos.x;
      const dz = tgt.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      const want = Math.atan2(dx, dz);
      this.camYaw += angDiff(this.camYaw, want) * (1 - Math.exp(-8 * real));
      dist = clamp(5.0 + d * 0.38, 5.4, 8.6);
      pivot.x += dx * 0.28;
      pivot.z += dz * 0.28;
      if (this.isHeavyBoss(tgt)) {
        dist = Math.max(dist, tgt.scale * 3.2);
        pivot.y = Math.max(pivot.y, tgt.scale * 0.92);
        fovT = Math.max(fovT, 62);
      }
    }
    if (p.state === 'deathblow') {
      dist = 3.8;
      fovT = 40;
      pitch = 0.2;
      if (this.isHeavyBoss(p.dbTarget)) {
        dist = Math.max(6.5, p.dbTarget.scale * 2.2);
        pivot.copy(p.dbTarget.pos).setY(1.2 * p.dbTarget.scale);
        fovT = 50;
      }
    }
    if (this.rage.on) {
      dist *= 0.88;
      fovT -= 4;
      const finalShot = this.rage.aiming || p.state === 'cutaim' || (p.state === 'cut' && !!this.rage.plane?.final);
      if (finalShot) {
        // cinematic close-up while the final slash locks on — spam taps keep the wider gameplay camera
        dist = 3.6;
        fovT = 34;
        pitch = 0.16;
        const t2 = this.rage.target ?? this.rage.seqTarget ?? this.lockTarget;
        if (this.isHeavyBoss(t2)) {
          dist = Math.max(6.5, t2.scale * 2.2);
          fovT = 50;
          pivot.copy(t2.pos).setY(1.2 * t2.scale);
        } else if (t2) pivot.lerp(this.tmpV2.set(t2.pos.x, pivot.y, t2.pos.z), 0.5);
      } else if (p.state === 'cut') {
        dist *= 0.82;
        fovT -= 3;
      }
    }
    if (this.kickV.lengthSq() > 1e-6) {
      this.camPos.add(this.kickV);
      this.kickV.multiplyScalar(Math.exp(-30 * real));
    }
    const dir = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    // over-the-shoulder side follows where you strafe, so the camera "leads" the action
    const lat = p.vel.x * right.x + p.vel.z * right.z;
    this.camSide += ((p.state === 'deathblow' ? 1.0 : 0.65 + clamp(lat * 0.06, -0.35, 0.35)) - this.camSide) * (1 - Math.exp(-3 * real));
    const desired = pivot
      .clone()
      .addScaledVector(dir, -dist * Math.cos(pitch))
      .addScaledVector(right, this.camSide);
    desired.y = pivot.y + Math.sin(pitch) * dist;
    desired.y = Math.max(0.7, desired.y);
    const lookT = pivot.clone().addScaledVector(dir, 1.2);

    // ---- cinematic shot: orbit / crane blended over the gameplay camera ----
    const cn = this.cine;
    let cw = 0;
    if (cn.dur > 0) {
      cn.t += real;
      const u = cn.t / cn.dur;
      if (u >= 1) {
        cn.dur = 0;
        cn.kind = 'none';
      } else {
        const sm = (a: number, b: number, x: number) => {
          const t = clamp((x - a) / (b - a), 0, 1);
          return t * t * (3 - 2 * t);
        };
        const ease = 1 - Math.pow(1 - u, 2.2);
        if (cn.kind === 'intro') {
          cw = 1 - sm(0.55, 1, u);
          const r = cn.r0 + (cn.r1 - cn.r0) * ease;
          const h = cn.h0 + (cn.h1 - cn.h0) * ease;
          const a = this.camYaw + Math.PI + 1.9 * (1 - ease);
          const introBoss = this.enemies.find((e) => this.isHeavyBoss(e)) ?? null;
          if (introBoss) cn.center.copy(p.pos).lerp(introBoss.pos, 0.5).setY(introBoss.scale * 0.92);
          else cn.center.set(p.pos.x, 1.3, p.pos.z);
          this.tmpV2.set(cn.center.x + Math.sin(a) * r, h, cn.center.z + Math.cos(a) * r);
          desired.lerp(this.tmpV2, cw);
          lookT.lerp(cn.center, cw * 0.85);
          fovT += (cn.fov - fovT) * cw;
        } else {
          cw = sm(0, 0.16, u) * (1 - sm(0.78, 1, u));
          const r = cn.r0 + (cn.r1 - cn.r0) * ease;
          const h = cn.h0 + (cn.h1 - cn.h0) * ease + Math.sin(u * Math.PI) * 0.25;
          const a = cn.a0 + cn.dir * (0.25 + 1.25 * ease);
          this.tmpV2.set(cn.center.x + Math.sin(a) * r, h, cn.center.z + Math.cos(a) * r);
          desired.lerp(this.tmpV2, cw);
          lookT.lerp(cn.center, cw);
          // dolly-zoom: the lens tightens while the camera pushes in
          fovT += (cn.fov - 8 * ease - fovT) * cw;
        }
      }
    }
    this.cineW += (cw - this.cineW) * (1 - Math.exp(-12 * real));
    this.fov += (fovT - this.fov) * (1 - Math.exp(-7 * real));
    this.camPos.lerp(desired, 1 - Math.exp(-14 * real));
    this.camLook.lerp(lookT, 1 - Math.exp(-16 * real));

    // camera roll: banks into strafes and turns, kicked sideways by deflects
    const spdNow = Math.hypot(p.vel.x, p.vel.z);
    const rollT = clamp(-lat * 0.0055, -0.05, 0.05) + clamp(-p.yawRate * 0.004 * Math.min(1, spdNow / 5), -0.04, 0.04);
    this.camRoll += (rollT - this.camRoll) * (1 - Math.exp(-6 * real));
    this.rollKick *= Math.exp(-7 * real);
    // run bob: head-height rhythm locked to the footfalls (stronger when sprinting)
    const bobAmt = p.state === 'idle' ? clamp((spdNow - 2.5) / 7, 0, 1) : 0;
    this.camBob += ((Math.sin(p.loco.phase * Math.PI * 4) * 0.045 * bobAmt) - this.camBob) * (1 - Math.exp(-18 * real));

    const tr = this.trauma * this.trauma;
    const tt = this.time * 40 + performance.now() * 0.03;
    const sx = (Math.sin(tt * 1.3) + Math.sin(tt * 2.9)) * 0.5 * tr * 0.35;
    const sy = (Math.sin(tt * 1.7 + 2) + Math.sin(tt * 3.3)) * 0.5 * tr * 0.3;
    this.camera.position.copy(this.camPos);
    this.camera.position.x += sx;
    this.camera.position.y += sy + this.camBob;
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(this.camLook);
    this.camera.rotation.z += Math.sin(tt * 2.1) * tr * 0.03 + this.camRoll + this.rollKick;
    const f = this.fov - this.fovPunch;
    if (Math.abs(this.camera.fov - f) > 0.01) {
      this.camera.fov = f;
      this.camera.updateProjectionMatrix();
      this.updatePointScale();
    }
    void dt;
  }

  /* ================= pose / render sync ================= */
  private walkOverlay(T: Pose, f: Common, speed: number, dt: number, maxSpeed: number, vx = 0, vz = 0, carry = true) {
    // locomotion itself (feet, pelvis, arms, lean) lives in the phase-locked layer — see updateLoco / buildOut.
    // here: only the "alive while standing" idle motion.
    void dt;
    void vx;
    void vz;
    f.locoCarry = carry;
    const amp = clamp(speed / maxSpeed, 0, 1);
    const ph = f.rig.root.id * 1.7;
    const br = Math.sin(this.time * 2.3 + ph);
    T.torsoX += br * 0.014;
    T.headX -= br * 0.01;
    // idle katana: the tip drifts in a slow, living figure-eight
    const idleW = 1 - amp;
    // light fighter's bounce on the balls of the feet
    T.dy += Math.sin(this.time * 3.3 + ph) * 0.011 * idleW;
    T.sp += Math.sin(this.time * 1.7 + ph) * 0.045 * idleW;
    T.sw += Math.sin(this.time * 1.2 + ph * 2) * 0.05 * idleW;
    T.sy += (br * 0.008 + Math.sin(this.time * 2.4 + ph) * 0.005) * idleW;
    T.hipZ += Math.sin(this.time * 0.9 + ph) * 0.022 * (1 - amp * 0.6);
    T.torsoZ -= Math.sin(this.time * 0.9 + ph) * 0.012;
  }

  /**
   * Procedural footwork. Each foot stays near its natural stance and takes a short, low step as the body moves.
   * Standing still = planted. Turning = small pivot steps. Running = alternating compact steps.
   */
  private updateGait(f: Common, dt: number) {
    const g = f.rig.gait;
    const on = f.gaitOn && dt > 1e-4;
    const cy = Math.cos(f.yaw);
    const sy = Math.sin(f.yaw);
    if (dt > 1e-4) {
      const vx = (f.pos.x - f.lastPos.x) / dt;
      const vz = (f.pos.z - f.lastPos.z) / dt;
      const a = 1 - Math.exp(-12 * dt);
      f.gv.x += (clamp(vx, -12, 12) - f.gv.x) * a;
      f.gv.z += (clamp(vz, -12, 12) - f.gv.z) * a;
    }
    f.lastPos.copy(f.pos);
    const speed = Math.hypot(f.gv.x, f.gv.z);
    const sf = clamp(speed / 4.2, 0, 1);
    const dx = speed > 0.05 ? f.gv.x / speed : 0;
    const dz = speed > 0.05 ? f.gv.z / speed : 0;
    // the rig's local space is scaled by the body size — world offsets must be converted, or short legs get
    // stretched past their reach (and the IK then clamps, so the feet skate)
    const k = (f.rig.root.scale.x || 1) * f.rig.legK;
    const lead = clamp(speed * 0.045, 0, 0.25);
    const th = (0.13 + lead * 0.55) * k;
    const stepDur = clamp((0.2 - speed * 0.017) * k, 0.1, 8);
    const lh = 0.05 + 0.06 * sf;

    for (let i = 0; i < 2; i++) {
      const ft = f.feet[i];
      const st = footStance(f.pose, i === 1);
      // in motion the stance relaxes toward a symmetric stride centred under the hips
      const nlx = st.x + ((i === 1 ? 0.12 : -0.12) - st.x) * sf * 0.5;
      const nlz = st.z * (1 - 0.85 * sf);
      const nx = f.pos.x + (nlx * cy + nlz * sy) * k;
      const nz = f.pos.z + (-nlx * sy + nlz * cy) * k;
      if (!on || !ft.init) {
        ft.wx = nx;
        ft.wz = nz;
        ft.stepping = false;
        ft.lift = 0;
        ft.pitch = 0;
        ft.init = true;
      } else if (ft.stepping) {
        ft.t += dt;
        const u = Math.min(1, ft.t / ft.dur);
        const e = u * u * (3 - 2 * u);
        // keep re-aiming the landing spot so the foot lands where the body actually is
        ft.tx = nx + dx * lead;
        ft.tz = nz + dz * lead;
        ft.wx = ft.fx + (ft.tx - ft.fx) * e;
        ft.wz = ft.fz + (ft.tz - ft.fz) * e;
        ft.lift = Math.sin(Math.PI * u) * lh;
        ft.pitch = Math.sin(Math.PI * 2 * u) * (0.2 + 0.2 * sf);
        if (u >= 1) {
          ft.stepping = false;
          ft.wx = ft.tx;
          ft.wz = ft.tz;
          ft.lift = 0;
          ft.pitch = 0;
          if (speed > 2.5) this.dustBurst(this.tmpV2.set(ft.wx, 0.05, ft.wz), 1, 0.8);
        }
      }
      // local planted position vs the foot spot the pose asks for
      const ex = ft.wx - f.pos.x;
      const ez = ft.wz - f.pos.z;
      const lx = (ex * cy - ez * sy) / k;
      const lz = (ex * sy + ez * cy) / k;
      const ox = lx - st.x;
      const oz = lz - st.z;
      // when leaving locomotion (attack, hit…) offsets relax away instead of snapping to zero
      const dec = Math.exp(-15 * Math.max(dt, 0.001));
      if (i === 0) {
        g.rx = on ? ox : g.rx * dec;
        g.rz = on ? oz : g.rz * dec;
        g.rl = on ? ft.lift : g.rl * dec;
        g.rp = on ? ft.pitch : g.rp * dec;
      } else {
        g.lx = on ? ox : g.lx * dec;
        g.lz = on ? oz : g.lz * dec;
        g.ll = on ? ft.lift : g.ll * dec;
        g.lp = on ? ft.pitch : g.lp * dec;
      }
    }

    if (on) {
      // begin a step when a foot has fallen behind its natural spot (alternate feet, allow a double-step if far)
      const r = f.feet[0];
      const l = f.feet[1];
      const err = (ft: Foot, i: number) => {
        const st = footStance(f.pose, i === 1);
        const nlx = st.x + ((i === 1 ? 0.12 : -0.12) - st.x) * sf * 0.5;
        const nlz = st.z * (1 - 0.85 * sf);
        const nx = f.pos.x + (nlx * cy + nlz * sy) * k;
        const nz = f.pos.z + (-nlx * sy + nlz * cy) * k;
        return { e: Math.hypot(nx - ft.wx, nz - ft.wz), nx, nz };
      };
      const er = err(r, 0);
      const el = err(l, 1);
      const pickI = er.e > el.e ? 0 : 1;
      const ft = pickI === 0 ? r : l;
      const ee = pickI === 0 ? er : el;
      const other = pickI === 0 ? l : r;
      if (!ft.stepping && ee.e > th && (!other.stepping || ee.e > th * 2.2)) {
        ft.stepping = true;
        ft.t = 0;
        ft.dur = stepDur;
        ft.fx = ft.wx;
        ft.fz = ft.wz;
        ft.tx = ee.nx + dx * lead;
        ft.tz = ee.nz + dz * lead;
      } else if (ee.e > 1.5) {
        // teleported (knock-back, spawn) — snap
        ft.wx = ee.nx;
        ft.wz = ee.nz;
      }
    }

    // pelvis shifts over the supporting leg, hips dip slightly on each step
    const tsway = on ? clamp((g.rl - g.ll) * 0.5, -0.04, 0.04) * (0.4 + sf) : 0;
    const tbob = on ? -Math.max(g.rl, g.ll) * 0.22 : 0;
    const a = 1 - Math.exp(-18 * Math.max(dt, 0.001));
    g.sway += (tsway - g.sway) * a;
    g.bob += (tbob - g.bob) * a;
  }

  /**
   * Spring-damper pose follower (replaces plain exponential smoothing). Slightly under-damped channels
   * overshoot and settle, giving the sword/torso real follow-through instead of robotic easing.
   */
  private springPose(f: Common, rate: number, dt: number) {
    const w0 = rate * 1.55;
    const n = Math.max(1, Math.ceil(dt / 0.007));
    const h = dt / n;
    const ww = w0 * w0;
    // just after a swing the damping is eased off, so the blade and chest overshoot a touch and settle — real follow-through
    f.settle = Math.max(0, f.settle - dt);
    const loose = 1 - 0.3 * Math.min(1, f.settle / 0.3);
    for (let s = 0; s < n; s++) {
      for (const key of KEYS) {
        const x = f.pose[key];
        const v = f.pv[key];
        const nv = v + ((f.target[key] - x) * ww - 2 * DAMP[key] * loose * w0 * v) * h;
        f.pv[key] = nv;
        f.pose[key] = x + nv * h;
      }
    }
  }

  /**
   * Phase-driven run cycle layered over the planted-foot system. Short steps, modest foot lift, and a soft knee bend
   * keep the silhouette balanced while feet alternate under the hips.
   */
  private updateLoco(f: Common, dt: number) {
    const g = f.rig.gait;
    const L = f.loco;
    const o = f.lout;
    const d = Math.max(dt, 0.001);
    const on = f.gaitOn && dt > 1e-4;
    const cy = Math.cos(f.yaw);
    const sy = Math.sin(f.yaw);
    const speed = Math.hypot(f.gv.x, f.gv.z);
    const lvx = f.gv.x * cy - f.gv.z * sy; // local: + = character's left
    const lvz = f.gv.x * sy + f.gv.z * cy; // local: + = forward

    // turn rate (for banking into corners)
    f.yawRate += (clamp(angDiff(f.lastYaw, f.yaw) / d, -9, 9) - f.yawRate) * (1 - Math.exp(-10 * d));
    f.lastYaw = f.yaw;

    const want = on && (L.active ? speed > 0.7 : speed > 1.1);
    if (want && !L.active && L.w < 0.05) L.phase = 0.6; // first stride starts with the rear foot
    L.active = want;
    stepLoco(L, o, dt, on ? lvx : 0, on ? lvz : 0, on ? f.yawRate : 0, want, (f.rig.root.scale.x || 1) * f.rig.legK);

    // layer weights
    L.w += ((want ? 1 : 0) - L.w) * (1 - Math.exp(-(want ? 14 : 8) * d));
    if (!on) L.w *= Math.exp(-30 * d);
    if (L.w < 0.004) L.w = 0;
    L.lw += ((on ? 1 : 0) - L.lw) * (1 - Math.exp(-(on ? 12 : 30) * d));
    if (L.lw < 0.004) L.lw = 0;

    // Let the sword-ready run carry ease out into an attack, and ease back in as a run resumes.
    const carryTarget = on && f.locoCarry ? 1 : 0;
    f.locoCarryW += (carryTarget - f.locoCarryW) * (1 - Math.exp(-(carryTarget ? 14 : 9) * d));
    if (f.locoCarryW < 0.004) f.locoCarryW = 0;

    if (L.w <= 0) return;
    const w = L.w;
    // the stride is produced in world metres; the rig's legs live in a scaled local space
    const k = (f.rig.root.scale.x || 1) * f.rig.legK;
    for (let i = 0; i < 2; i++) {
      const ft = f.feet[i];
      const st = footStance(f.pose, i === 1);
      const tgt = o.feet[i];
      const cx = i === 0 ? g.rx : g.lx;
      const cz = i === 0 ? g.rz : g.lz;
      const cl = i === 0 ? g.rl : g.ll;
      const cp = i === 0 ? g.rp : g.lp;
      const nx = cx + (tgt.x / k - st.x - cx) * w;
      const nz = cz + (tgt.z / k - st.z - cz) * w;
      const nl = cl + (tgt.lift / k - cl) * w;
      const np = cp + (tgt.pitch - cp) * w;
      if (i === 0) {
        g.rx = nx; g.rz = nz; g.rl = nl; g.rp = np;
      } else {
        g.lx = nx; g.lz = nz; g.ll = nl; g.lp = np;
      }
      if (want) {
        // keep the pinned world position in sync so stopping hands over to the planted system seamlessly
        const lx = (st.x + nx) * k;
        const lz = (st.z + nz) * k;
        ft.wx = f.pos.x + lx * cy + lz * sy;
        ft.wz = f.pos.z - lx * sy + lz * cy;
        ft.stepping = false;
        ft.init = true;
      }
    }
    g.sway += (o.sway / k - g.sway) * w;
    g.bob += (o.bob / k - g.bob) * w;

    // footfalls: gravel crunch (player only, so the mix stays clean) + dust puffs at speed
    if (want && L.sp > 0.9) {
      const p0 = L.prevPhase;
      const p1 = L.phase;
      const hit0 = p1 < p0; // right foot lands when the phase wraps
      const hit1 = p0 < 0.5 && p1 >= 0.5; // left foot lands at half-cycle
      const heavyBoss = f !== this.player && this.isHeavyBoss(f as Enemy);
      for (let i = 0; i < 2; i++) {
        if (i === 0 ? hit0 : hit1) {
          const ft = f.feet[i];
          if (f === this.player) {
            this.sfx.step(L.sp);
            if (L.sp > this.sprintSpd * 0.72) this.shake(0.024); // sprinting: every footfall thumps the frame
          }
          if (heavyBoss) {
            const foot = this.tmpV2.set(ft.wx, 0.04, ft.wz);
            this.dustBurst(foot, 14, 3.2);
            this.shocks.spawn(foot, 0xff3540, 2.8, 0.45);
            this.shake(0.07);
          } else {
            const fs = L.sp / this.sprintSpd;
            if (fs > 0.3) {
              const big = fs > 0.62;
              this.dustBurst(this.tmpV2.set(ft.wx, 0.05, ft.wz), big ? 5 : 2, big ? 2.2 : 1.2);
              if (big && f === this.player) {
                this.shocks.spawn(this.tmpV2.set(ft.wx, 0.04, ft.wz), 0xffffff, 0.9, 0.22);
              }
            }
          }
        }
      }
    }
  }

  /** Final pose = spring-followed pose + phase-locked locomotion layer (so it can never lag behind the feet). */
  private buildOut(f: Common) {
    const out = f.out;
    copyPose(out, f.pose);
    const L = f.loco;
    const o = f.lout;
    const lw = L.lw;
    const w = L.w;
    // whole-body lean: speed + acceleration + banking; the head stays level and looks ahead
    const lean = o.leanF * lw;
    out.hipX += 0.4 * lean;
    out.torsoX += 0.6 * lean;
    out.headX -= 0.85 * lean;
    out.torsoZ += o.roll * lw * 0.7;
    out.hipZ += o.roll * lw * 0.3;
    // the head rides out the bounce of the stride and answers speed with the chin — a stabilised head is what
    // sells the weight of a run, and it sits on top of the lean so it survives every pose
    out.headX += (o.headStab + o.chinLift) * lw;
    // push-off stretches the body out; braking folds it back and drops the hips
    out.hipX += (0.05 * o.burst - 0.07 * o.brake) * lw;
    out.torsoX += (0.07 * o.burst - 0.1 * o.brake) * lw;
    out.dy -= 0.03 * o.brake * lw;
    if (w <= 0.001) return;
    const ph = L.phase * TAU;
    out.hipYaw += o.pelvisYaw * w;
    out.torsoY += o.torsoYaw * w;
    out.hipZ += o.hipRoll * w;
    out.torsoZ += o.torsoRoll * w;
    // a hard cut winds the shoulders up against the turn and lets them unwrap a beat later
    out.torsoY += o.twist * w;
    out.hipYaw -= o.twist * 0.4 * w;
    const carryW = f.locoCarryW;
    // With the sword up in guard (or a bow in hand) the arms are locked to the weapon by IK, so the stride can
    // only show in the shoulder line and the hips: a low, tight shuffle instead of a free-armed run.
    const tightW = (1 - carryW) * smooth01((L.sp - 0.9) / 1.4) * w;
    if (tightW > 0.001) {
      out.torsoZ += o.arm * 0.035 * tightW; // the shoulder line rocks with the steps
      out.hipZ += o.hipRoll * 0.7 * tightW;
      out.dy -= 0.012 * o.bounce * tightW; // stays low: a guard shuffle does not bounce
      out.headX += 0.02 * o.bounce * tightW; // ...and the head stays on the target
      out.torsoX += 0.05 * tightW;
    }
    if (carryW > 0.001) {
      // The free arm trails back; keep the sword hand lower and close to the hip in a ready carry.
      const c = smooth01((L.sp - 0.9) / 1.6) * carryW;
      const amp = 0.24 + 0.34 * o.run + 0.1 * o.spr + 0.16 * o.burst; // the arms pump harder when driving off
      out.lsX += (-0.3 - o.arm * amp - out.lsX) * c;
      out.lsZ += (0.12 + 0.08 * o.run - out.lsZ) * c;
      out.leX += (-(0.7 + 0.75 * o.run) - 0.25 * Math.max(0, o.arm) * o.run - out.leX) * c;
      out.two *= 1 - c;
      out.sx += (-0.27 - out.sx) * c;
      out.sy += (0.2 - out.sy) * c;
      out.sz += (0.22 - out.sz) * c;
      out.sp += (0.58 - out.sp) * c;
      out.sw += (0.28 - out.sw) * c;
      out.sr += (0.14 - out.sr) * c;
      // The sword stays steady; only a small wrist follow-through answers the running rhythm.
      out.sp += Math.sin(ph * 2) * 0.025 * c;
      out.sw += -0.035 * o.arm * c;

      // Forward-running posture: the free arm trails while the right hand carries the katana ready to strike.
      const n = o.ninja * carryW;
      if (n > 0.001) {
        out.lsX += (0.82 + o.arm * 0.26 - out.lsX) * n;
        out.lsZ += (0.3 - out.lsZ) * n;
        out.leX += (-0.22 - 0.12 * Math.max(0, o.arm) - out.leX) * n;
        out.two *= 1 - n;
        out.sx += (-0.27 - out.sx) * n;
        out.sy += (0.16 - out.sy) * n;
        out.sz += (0.28 - out.sz) * n;
        out.sp += (0.52 - out.sp) * n;
        out.sw += (0.34 - 0.04 * o.arm - out.sw) * n;
        out.sr += (0.14 - out.sr) * n;
        // The torso leans into the run; the head stays lifted toward the path ahead.
        out.torsoX += 0.15 * n;
        out.hipX += 0.05 * n;
        out.headX -= 0.08 * n;
      }
    }
  }

  private finishPose(f: Common, rate: number, dt: number) {
    if (f.react > 0.001) blendInto(f.target, f.target, f.reactPose, f.react * 0.85);
    // eyes follow the opponent — head turns independently of the torso
    if (f.look && f.lookW > 0) {
      const want = Math.atan2(f.look.x - f.pos.x, f.look.z - f.pos.z);
      const base = f.yaw + f.pose.hipYaw + f.pose.torsoY;
      const d = clamp(angDiff(base, want), -1.0, 1.0);
      f.target.headY = f.target.headY * (1 - f.lookW) + d * f.lookW;
      const dist = Math.hypot(f.look.x - f.pos.x, f.look.z - f.pos.z);
      f.target.headX += clamp((dist - 4) * 0.01, -0.05, 0.05) - 0.04;
    }
    // crossfade: whenever the animation state changes, ease the follower in so poses melt into each other
    if (f.sig !== f.lastSig) {
      f.lastSig = f.sig;
      f.xfade = 1;
    }
    f.xfade = Math.max(0, f.xfade - dt / 0.22);
    const eased = f.xfade * f.xfade;
    this.springPose(f, f.soft ? rate * (1 - 0.6 * eased) : rate, dt);
    this.updateGait(f, dt);
    this.updateLoco(f, dt);
    this.buildOut(f);
    f.rig.apply(f.out);
    f.rig.root.position.copy(f.pos);
    f.rig.root.rotation.y = f.yaw;
    if (f === this.player && f.rig.root.rotation.x !== 0 && this.player.state !== 'dead') {
      // somersault around the body centre (not the feet)
      const q = new THREE.Quaternion().setFromEuler(f.rig.root.rotation);
      const v = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
      f.rig.root.position.x -= v.x;
      f.rig.root.position.y += 1 - v.y;
      f.rig.root.position.z -= v.z;
    }
    f.rig.update(dt);
    if (f.flash > 0.001) f.rig.setFlash(f.flash * 0.9);
    else f.rig.setFlash(0);
    f.rig.setBladeGlow(f.glow);
  }

  /* ================= player ================= */
  private moveInput(): THREE.Vector3 {
    const k = this.keys;
    let mx = 0;
    let mz = 0;
    if (k.has('KeyW')) mz += 1;
    if (k.has('KeyS')) mz -= 1;
    if (k.has('KeyD')) mx += 1;
    if (k.has('KeyA')) mx -= 1;
    // the on-screen stick pushes the same axes; keyboard and thumb simply add up and re-normalise
    mx += this.touchMove.x;
    mz += this.touchMove.y;
    const dir = new THREE.Vector3(Math.sin(this.camYaw), 0, Math.cos(this.camYaw));
    const right = new THREE.Vector3(-Math.cos(this.camYaw), 0, Math.sin(this.camYaw));
    const v = dir.multiplyScalar(mz).add(right.multiplyScalar(mx));
    if (v.lengthSq() > 1) v.normalize();
    return v;
  }

  private pEffMax() {
    return 100 * (0.6 + 0.4 * (this.player.hp / this.player.hpMax));
  }
  private eEffMax(e: Enemy) {
    return e.postureMax * (0.55 + 0.45 * (e.hp / e.hpMax));
  }

  private clampArena(v: THREE.Vector3, margin = 0.8) {
    // The duel is an open, wide rectangular battlefield with no circular arena wall.
    const limit = ARENA_HALF_EXTENT - margin;
    v.x = clamp(v.x, -limit, limit);
    v.z = clamp(v.z, -limit, limit);
  }

  private separate() {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.state === 'dying' || e.state === 'dead' || e.state === 'spawn') continue;
      if (e.state === 'impaled') continue; // he is pinned on the blade — don't push him away
      const dx = p.pos.x - e.pos.x;
      const dz = p.pos.z - e.pos.z;
      const d = Math.hypot(dx, dz);
      const heavyBoss = this.isHeavyBoss(e);
      const min = heavyBoss ? HEAVY_BOSS_BODY_RADIUS * this.sizeK : 0.95 * e.scale;
      if (d < min && d > 0.001 && p.pos.y < 0.8) {
        if (this.rage.on || heavyBoss) {
          // The player moves out of the way; slicing and the boss's armor never get shoved around by contact.
          const push = min - d;
          p.pos.x += (dx / d) * push;
          p.pos.z += (dz / d) * push;
        } else {
          const push = (min - d) * 0.5;
          p.pos.x += (dx / d) * push;
          p.pos.z += (dz / d) * push;
          e.pos.x -= (dx / d) * push * 0.6;
          e.pos.z -= (dz / d) * push * 0.6;
        }
      }
    }
    if (!this.rage.on) {
      for (let i = 0; i < this.enemies.length; i++) {
        for (let j = i + 1; j < this.enemies.length; j++) {
          const a = this.enemies[i];
          const b = this.enemies[j];
          if (!this.alive(a) || !this.alive(b)) continue;
          const dx = a.pos.x - b.pos.x;
          const dz = a.pos.z - b.pos.z;
          const d = Math.hypot(dx, dz);
          if (d < 1.1 && d > 0.001) {
            const push = (1.1 - d) * 0.5;
            a.pos.x += (dx / d) * push;
            a.pos.z += (dz / d) * push;
            b.pos.x -= (dx / d) * push;
            b.pos.z -= (dz / d) * push;
          }
        }
      }
    }
    this.clampArena(p.pos);
    if (!this.rage.on) this.enemies.forEach((e) => this.clampArena(e.pos, 0.8));
  }

  private nearestDist(): number {
    let d = 99;
    for (const e of this.enemies) if (this.alive(e)) d = Math.min(d, e.pos.distanceTo(this.player.pos));
    return d;
  }

  /** Highest walkable floor under the player's feet: the ground plane plus the default arena's rooftop steps. */
  private parkourFloorAt(x: number, z: number) {
    let floor = 0;
    for (const surface of this.world.parkourSurfaces) {
      if (
        Math.abs(x - surface.x) <= surface.width / 2 - 0.2 &&
        Math.abs(z - surface.z) <= surface.depth / 2 - 0.2
      ) floor = Math.max(floor, surface.top);
    }
    return floor;
  }

  /** Detect a downward crossing of the ground or one of the raised landing pads. */
  private landingHeightAt(previousY: number, currentY: number, x: number, z: number): number | null {
    if (currentY > previousY) return null;
    let landing: number | null = null;
    for (const surface of this.world.parkourSurfaces) {
      const withinTop =
        Math.abs(x - surface.x) <= surface.width / 2 - 0.2 &&
        Math.abs(z - surface.z) <= surface.depth / 2 - 0.2;
      if (withinTop && previousY >= surface.top && currentY <= surface.top) {
        landing = Math.max(landing ?? 0, surface.top);
      }
    }
    if (previousY >= 0 && currentY <= 0) landing = Math.max(landing ?? 0, 0);
    return landing;
  }

  /** Keep low approaches from clipping through a step's vertical sides; landing from above remains unrestricted. */
  private resolveParkourSideCollision(previousX: number, previousZ: number) {
    const p = this.player;
    const radius = 0.36;
    for (const surface of this.world.parkourSurfaces) {
      if (p.pos.y >= surface.top - 0.02) continue;
      const halfX = surface.width / 2 + radius;
      const halfZ = surface.depth / 2 + radius;
      const dx = p.pos.x - surface.x;
      const dz = p.pos.z - surface.z;
      const overlapX = halfX - Math.abs(dx);
      const overlapZ = halfZ - Math.abs(dz);
      if (overlapX <= 0 || overlapZ <= 0) continue;
      if (overlapX < overlapZ) {
        const sign = Math.sign(previousX - surface.x) || Math.sign(dx) || 1;
        p.pos.x = surface.x + sign * (halfX + 0.005);
        p.vel.x = 0;
      } else {
        const sign = Math.sign(previousZ - surface.z) || Math.sign(dz) || 1;
        p.pos.z = surface.z + sign * (halfZ + 0.005);
        p.vel.z = 0;
      }
    }
  }

  private updatePlayer(dt: number) {
    const p = this.player;
    const previousX = p.pos.x;
    const previousZ = p.pos.z;
    p.t += dt;
    p.postureT += dt;
    p.flash = Math.max(0, p.flash - dt * 6);
    p.react = Math.max(0, p.react - dt * 5);
    p.glow = Math.max(0, p.glow - dt * 5);
    if (p.state !== 'attack') p.comboTimer -= dt;
    p.inv = Math.max(0, p.inv - dt);

    const gh = this.guardHeld;
    if (gh && !p.guardPrev) p.guardT = 0;
    if (gh) p.guardT += dt;
    p.guardPrev = gh;

    // A calm, held guard helps settle posture; taking a hit still delays recovery, so blocking under pressure carries a cost.
    if (p.state !== 'broken' && p.state !== 'dead' && p.postureT > 1.1) {
      const hpF = p.hp / p.hpMax;
      const recovery = this.combatMode === 'before' ? (gh ? 20 : 28) : gh && p.state === 'idle' ? 42 : 25;
      p.posture = Math.max(0, p.posture - recovery * (0.5 + 0.5 * hpF) * dt);
    }

    const move = this.moveInput();
    const tgt = this.lockOn ? this.lockTarget : null;
    const T = p.target;
    let rate = 12;
    let desiredSpeed = 0;
    const guarding = p.state === 'idle' && gh;

    const free = () =>
      p.state === 'idle' ||
      p.state === 'style' ||
      (p.state === 'attack' && !!p.anim && p.t >= p.anim.cancelFrom) ||
      (p.state === 'cut' && p.t >= 0.3) ||
      (p.state === 'land' && p.t > 0.2) ||
      (p.state === 'recoil' && p.t > 0.2);
    const dodgeFree = () =>
      free() ||
      (p.state === 'attack' && !!p.anim && p.t >= p.anim.hits[0].t + 0.02) ||
      (p.state === 'cut' && p.t >= 0.2) ||
      (p.state === 'land' && p.t > 0.08) ||
      (p.state === 'hurt' && p.t > 0.16) ||
      (p.state === 'dodge' && p.t > 0.24) ||
      (p.state === 'heal' && p.t > 0.2 && !p.healDone);

    // ---- global actions ----
    if (p.state !== 'dead' && p.state !== 'deathblow' && p.state !== 'jump' && p.state !== 'stomp' && p.state !== 'dive') {
      if (this.dodgeBuf > 0 && dodgeFree()) {
        this.dodgeBuf = 0;
        if (!this.tryMikiri()) this.startDodge(move);
      } else if (this.jumpBuf > 0 && free()) {
        this.jumpBuf = 0;
        this.startJump(move);
      } else if (this.healBuf > 0 && free()) {
        this.healBuf = 0;
        if (p.gourds > 0 && p.hp < p.hpMax) this.startHeal();
      } else if (
        this.guardBuf > 0 &&
        gh &&
        p.state === 'attack' &&
        p.anim &&
        p.t >= p.anim.hits[0].t + 0.08
      ) {
        p.state = 'idle';
        p.t = 0;
        p.anim = null;
        p.trailOn = false;
        p.guardT = 0;
        this.guardBuf = 0;
      } else if (this.styleBuf > 0 && free() && !this.rage.aiming && !this.rage.on) {
        this.styleBuf = 0;
        this.startStyle();
      } else if (this.impaleBuf > 0 && free() && !this.rage.on) {
        this.impaleBuf = 0;
        if (!this.startImpale()) this.kickBuf = 0.2; // nobody in range → just throw the kick
      } else if (this.kickBuf > 0 && free()) {
        this.kickBuf = 0;
        this.attackBuf = 0;
        this.startAttack(KICK);
      } else if (this.attackBuf > 0 && free()) {
        this.attackBuf = 0;
        // blade mode has its own finisher (right-click) — a stray click must not trigger a deathblow
        const db = this.rage.on ? null : this.findDeathblowTarget();
        if (db) this.startDeathblow(db);
        else this.startAttack();
      }
    }

    // leaving a freestyle spin: re-wrap the blade angles so the pose never "unwinds" backwards
    if (this.pState === 'style' && p.state !== 'style') {
      for (const k of ['sp', 'sw'] as const) p.pose[k] -= Math.round((p.pose[k] - IDLE[k]) / TAU) * TAU;
      this.styleDef = null;
    }
    this.pState = p.state;
    // lazy fighter? after a quiet moment the blade starts to play on its own
    if (p.state === 'idle' && move.lengthSq() < 0.01 && !gh) {
      this.idleT += dt;
      if (this.idleT > 7 && (this.nearestDist() > 8 || !this.enemies.some((e) => this.alive(e)))) {
        this.idleT = 0;
        this.styleBuf = 0.3;
        this.styleForce = -1;
      }
    } else if (p.state !== 'style') this.idleT = 0;

    // ---- state behaviour ----
    switch (p.state) {
      case 'idle': {
        const sprint = !guarding && (this.keys.has('ShiftLeft') || this.keys.has('ShiftRight'));
        // "flow": a high style rank makes you a little faster
        // short legs cover less ground, so speed follows body size
        // speed is capped by what the legs can actually turn over — outrun your own stride and the feet skate
        const bodyK = this.sizeK * (this.chibi ? 0.9 : 1);
        let spd = (guarding ? 2.4 : sprint ? 14.0 : 8.4) * (1 + 0.08 * this.flowLevel()) * (0.3 + 0.7 * bodyK);
        if (move.lengthSq() > 0.01) desiredSpeed = spd;
        // weighty acceleration: ~0.2 s to full run, firm braking — the lean in the animation comes from this
        const desVel = move.clone().multiplyScalar(spd);
        const dvx = desVel.x - p.vel.x;
        const dvz = desVel.z - p.vel.z;
        const dvl = Math.hypot(dvx, dvz);
        const maxStep = (move.lengthSq() > 0.01 ? (sprint ? 30 : 36) : 46) * dt;
        const k = dvl > maxStep ? maxStep / dvl : 1;
        p.vel.x += dvx * k;
        p.vel.z += dvz * k;
        spd = Math.hypot(p.vel.x, p.vel.z);
        p.speed = spd;
        // brake skid: let go of the stick at a sprint → dig the heels in and slide, throwing up gravel
        if (move.lengthSq() < 0.01 && this.prevSpd > 6.5 && spd < this.prevSpd - 0.2) {
          if (this.skidT <= 0) this.sfx.skid();
          this.skidT = 0.34;
        }
        this.skidT -= dt;
        if (this.skidT > 0 && spd > 2.5) {
          this.dustBurst(this.tmpV2.set(p.pos.x, 0.06, p.pos.z), 2, 2.4);
          if (Math.random() < 0.5) this.sparkBurst(this.tmpV2.set(p.pos.x, 0.05, p.pos.z), fwd(p.yaw).multiplyScalar(-1), 1, 3, 0.8, new THREE.Color(1.2, 0.9, 0.6), 0.25);
        }
        this.prevSpd = spd;
        // facing: strafe around the target — unless sprinting (then run facing the direction of travel)
        if (tgt && !(sprint && spd > 3)) {
          const want = Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z);
          p.yaw = turnToward(p.yaw, want, 14 * dt);
        } else if (spd > 0.5) {
          p.yaw = turnToward(p.yaw, Math.atan2(p.vel.x, p.vel.z), (sprint ? 9 : 12) * dt);
        }
        copyPose(T, guarding ? P.guard : P.idle);
        p.look = tgt ? tgt.pos : (this.nearestEnemy()?.pos ?? null);
        this.walkOverlay(T, p, spd, dt, 7.6, p.vel.x, p.vel.z, !guarding);
        rate = guarding ? 26 : 12;
        break;
      }
      case 'attack': {
        const a = p.anim!;
        // swing sound
        if (!p.swingPlayed && p.t >= a.hits[0].t - 0.09) {
          p.swingPlayed = true;
          if (a.hits[0].kind === 'kick') this.sfx.kickSwing();
          else this.sfx.swing(!!a.hits[0].heavy);
        }
        const nd = this.nearestDist();
        // magnetism: keep turning toward the locked target while winding up
        if (tgt && p.t < a.hits[0].t - 0.03) {
          const want = Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z);
          p.aim = turnToward(p.aim, want, 9 * dt);
        }
        for (const l of a.lunge) {
          if (p.t >= l.t0 && p.t <= l.t1 + dt) {
            const sp = l.dist / (l.t1 - l.t0);
            if (nd > 1.5) p.pos.addScaledVector(fwd(p.aim), sp * dt);
          }
        }
        // spinning cuts rotate the whole body around its aim direction
        let spinA = 0;
        if (a.spins) {
          for (const s of a.spins) {
            const u = clamp((p.t - s.t0) / (s.t1 - s.t0), 0, 1);
            spinA += s.turns * Math.PI * 2 * (u * u * (3 - 2 * u));
          }
        }
        p.yaw = p.aim + spinA;
        p.vel.multiplyScalar(0.8);
        while (p.hitIdx < a.hits.length && p.t >= a.hits[p.hitIdx].t) {
          const h = a.hits[p.hitIdx++];
          // the planted front foot bites into the gravel on every strike
          this.dustBurst(p.pos.clone().setY(0.1), h.kind === 'kick' ? 12 : 5, 2.6);
          this.onPlayerStrike(h);
          this.playerStrike(h);
        }
        p.trailOn = a.trail.some(([s, e]) => p.t >= s && p.t <= e);
        sampleFrames(a.frames, p.t, T);
        applyArcs(a, p.t, T);
        rate = 38;
        if (p.t >= a.dur) {
          p.state = 'idle';
          p.t = 0;
          p.trailOn = false;
          p.comboTimer = 0.45;
          p.settle = 0.34; // the blade swings back into the stance and wobbles to a stop
        }
        break;
      }
      case 'style': {
        const a = this.styleDef;
        if (!a) {
          p.state = 'idle';
          p.t = 0;
          break;
        }
        sampleFrames(a.frames, p.t, T);
        p.trailOn = a.trail.some(([s, e]) => p.t >= s && p.t <= e);
        while (this.styleFx < a.sfx.length && p.t >= a.sfx[this.styleFx]) {
          this.sfx.swing(false);
          this.styleFx++;
        }
        while (this.styleSt < a.streaks.length && p.t >= a.streaks[this.styleSt].t) {
          const s = a.streaks[this.styleSt++];
          const c = p.pos.clone().addScaledVector(fwd(p.aim), 1.2).setY(1.3);
          this.streaks.spawn(c, this.slashLine(s.ang), 2.4, 0.1, new THREE.Color(2.2, 2.6, 3.2), 0.3);
        }
        // keep facing the foe; any movement input breaks the pose back into the stance
        if (tgt) p.yaw = turnToward(p.yaw, Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z), 5 * dt);
        p.aim = p.yaw;
        p.look = tgt ? tgt.pos : null;
        p.vel.multiplyScalar(Math.exp(-8 * dt));
        rate = 26;
        if ((p.t > 0.3 && move.lengthSq() > 0.05) || p.t >= a.dur) {
          p.state = 'idle';
          p.t = 0;
          p.trailOn = false;
        }
        break;
      }
      case 'cutaim': {
        // Blade-mode stance: coiled, katana drawn back, eyes locked on the target
        copyPose(T, AIM_POSE);
        const tg = this.rage.target;
        p.look = tg ? tg.pos : null;
        if (tg) p.yaw = turnToward(p.yaw, Math.atan2(tg.pos.x - p.pos.x, tg.pos.z - p.pos.z), 16 * dt);
        p.vel.set(0, 0, 0);
        rate = 20;
        break;
      }
      case 'cut': {
        // the dash-through: blur across the enemy, blade flashing along the chosen line
        const a = p.anim!;
        const r = this.rage;
        const u = clamp(p.t / 0.11, 0, 1);
        const ez = 1 - Math.pow(1 - u, 3);
        p.pos.lerpVectors(r.dashFrom, r.dashTo, ez);
        p.look = null;
        p.trailOn = a.trail.some(([s, e]) => p.t >= s && p.t <= e);
        sampleFrames(a.frames, p.t, T);
        applyArcs(a, p.t, T);
        rate = 46;
        if (!r.cutDone && p.t >= 0.11) {
          r.cutDone = true;
          this.performCut();
        }
        // next line of a multi-cut sequence: flash straight into it
        if (r.cutDone && r.seqIdx < r.seq.length - 1 && p.t >= 0.19) {
          r.seqIdx++;
          this.beginCut();
          break;
        }
        if (p.t >= a.dur) {
          p.state = 'idle';
          p.t = 0;
          p.trailOn = false;
        }
        break;
      }
      case 'dodge': {
        const a = p.anim!;
        const k = p.dodgeKind;
        // each evade has its own speed curve: slips and thru-slides burst fast, ducks stay compact, hops arc backwards
        const speedK = k === 'slip' ? 17.5 : k === 'thru' ? 16 : k === 'duck' ? 10 : 15;
        const f = 1 - p.t / (a.dur * 0.88);
        if (f > 0) p.pos.addScaledVector(p.dodgeDir, speedK * f * f * 1.4 * dt);
        // Small evade arcs inherit the current step height instead of snapping back to ground level.
        const u = clamp(p.t / a.dur, 0, 1);
        const floor = this.parkourFloorAt(p.pos.x, p.pos.z);
        const dodgeBase = Math.max(floor, p.pos.y);
        p.pos.y = dodgeBase + (k === 'hop' ? 0.34 : k === 'slip' ? 0.05 : 0) * Math.sin(Math.PI * u);
        sampleFrames(a.frames, p.t, T);
        rate = 34;
        p.look = tgt ? tgt.pos : null;
        // gravel kicked up along the slide
        if (p.pos.y - floor < 0.2 && f > 0.1) this.dustBurst(this.tmpV2.set(p.pos.x, floor + 0.06, p.pos.z), 1, 2);
        // keep facing the attacker (the blade stays on them)
        const foe = tgt ?? this.nearestEnemy();
        if (foe) p.yaw = turnToward(p.yaw, Math.atan2(foe.pos.x - p.pos.x, foe.pos.z - p.pos.z), 12 * dt);
        p.aim = p.yaw;
        if (p.t >= a.dur) {
          p.pos.y = Math.max(p.pos.y, this.parkourFloorAt(p.pos.x, p.pos.z));
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'land': {
        // anime hero landing: crouched, hand to the ground, eyes on the enemy; any input breaks out of it early
        const a = p.anim!;
        sampleFrames(a.frames, p.t, T);
        // Impact detail. Everything below is scaled by how hard the feet arrived (`landPower`, taken from the
        // vertical speed at contact), so a small hop stays light while a rooftop drop folds the body deep,
        // throws the free arm out for balance and holds the compression before it recovers. The feet stay
        // planted (the landing poses are planted), so lowering the hips bends the knees through the leg IK.
        const lp = this.landPower;
        const hold = 1 - smooth01(p.t / (0.16 + 0.34 * lp));
        const w = lp * hold;
        T.dy -= 0.12 * w;
        T.torsoX += 0.14 * w;
        T.hipX += 0.14 * w;
        T.headX -= 0.1 * w; // the body folds over the impact; the eyes stay up on the enemy
        T.lsX += -0.5 * w; // free arm flares out and back to keep the balance
        T.lsZ += 0.6 * w;
        T.leX += -0.42 * w;
        T.rsX += 0.12 * w;
        T.sp += 0.09 * w; // the blade dips with the compression
        rate = 26 + 14 * w; // snap into the compression, then settle out of it
        p.look = tgt ? tgt.pos : (this.nearestEnemy()?.pos ?? null);
        if (tgt) p.yaw = turnToward(p.yaw, Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z), 9 * dt);
        p.aim = p.yaw;
        if (p.landBack && p.vel.lengthSq() > 4 && Math.random() < 0.7) {
          this.dustBurst(this.tmpV2.set(p.pos.x, 0.06, p.pos.z), 1, 2.4); // the skid throws gravel
        }
        // a heavy landing keeps throwing dust while the body is still folding
        if (lp > 0.6 && hold > 0.35 && Math.random() < 0.4) {
          this.dustBurst(this.tmpV2.set(p.pos.x, p.pos.y + 0.08, p.pos.z), 2, 2 + 2 * lp);
        }
        // the recovery waits for the compression: the heavier the impact, the longer the landing owns him
        if ((p.t > 0.2 + 0.16 * lp && move.lengthSq() > 0.05) || p.t >= a.dur * (0.86 + 0.5 * lp)) {
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'jump': {
        const sweeping = this.enemies.some((e) => e.state === 'attack' && e.anim?.warn?.kind === 'sweep');
        // ---- the jump belongs to the stick, never to the lock ----
        // Airborne, the fighter stops staring at the target (the camera keeps its own lock, so nothing is lost
        // on screen) and turns toward where he is actually travelling. Head, body, somersault and kimono all
        // commit to the movement direction, which is what makes a double jump read as a jump.
        p.look = null;
        const airSpd = Math.hypot(p.vel.x, p.vel.z);
        if (airSpd > 0.9) p.yaw = turnToward(p.yaw, Math.atan2(p.vel.x, p.vel.z), 7 * dt);
        p.aim = p.yaw;
        // ---- double jump: a second somersault, with a burst of air ----
        if (this.jumpBuf > 0 && p.jumps < 2) {
          this.jumpBuf = 0;
          p.jumps = 2;
          p.flipStyle = '';
          p.vy = 7.8;
          // the second press answers the stick, not the target: face the way you are pushing, flip that way
          const pushing = move.lengthSq() > 0.05;
          if (pushing) {
            p.yaw = Math.atan2(move.x, move.z);
            p.aim = p.yaw;
          }
          const front = !pushing || move.dot(fwd(p.yaw)) > -0.2;
          p.flipV = (front ? 1 : -1) * 10.5;
          p.flipEnd = p.flip + (front ? 1 : -1) * TAU;
          if (pushing) p.vel.copy(move).multiplyScalar(6.4);
          p.jumpStart = -9;
          p.airDashT = 0;
          this.sfx.whoosh();
          this.shocks.spawn(p.pos.clone().setY(p.pos.y + 0.2), 0x9fc8ff, 2.4, 0.35);
          this.dustBurst(p.pos.clone().setY(p.pos.y + 0.1), 5, 1.5);
          this.shake(0.1);
        }
        // ---- air dash (C): a flat, fast burst that ignores gravity for a moment ----
        if (this.dodgeBuf > 0 && p.dashAvail && p.airDashT <= 0) {
          this.dodgeBuf = 0;
          p.dashAvail = false;
          p.airDashT = 0.2;
          const dd = move.lengthSq() > 0.05 ? move.clone().normalize() : fwd(p.yaw);
          p.vel.copy(dd).multiplyScalar(17.5);
          p.vy = 0.6;
          p.flipV = 0;
          p.flipEnd = p.flip;
          this.sfx.dodge();
          this.shake(0.14);
          this.aberr = Math.max(this.aberr, 0.008);
          this.kickV.addScaledVector(dd, 0.14);
          this.shocks.spawn(p.pos.clone().setY(p.pos.y + 1), 0xbfd8ff, 2.2, 0.3);
        }
        // ---- air attacks: you cannot fence from the sky any more ----
        // Only two things are allowed up here:
        //  1. after an air dash (roll depan, C) → ONE flying slash, kick-weight, then gravity finishes it
        //  2. with an enemy already inside blade reach → the swing is HELD and comes out on landing
        // Anything else is dropped: a jump is for jumping, not for pecking people out of the air.
        if (this.attackBuf > 0 && p.pos.y > 0.4) {
          this.attackBuf = 0;
          if (!p.dashAvail && p.diveAvail) {
            this.startDive();
            break;
          }
          if (this.nearestCloseEnemy()) {
            this.airSlashQueued = true;
            p.glow = Math.max(p.glow, 0.9); // the blade answers: this swing is booked for the landing
            this.sfx.unsheathe();
          }
        }
        if (p.airDashT > 0) {
          p.airDashT -= dt;
          p.vy = 0.5;
          if (p.airDashT <= 0) p.vel.multiplyScalar(0.4);
        } else {
          p.vy -= 22 * dt;
          if (!sweeping && !p.flipStyle && move.lengthSq() > 0.05) {
            const k = 1 - Math.exp(-1.7 * dt);
            p.vel.x += (move.x * 6.4 - p.vel.x) * k;
            p.vel.z += (move.z * 6.4 - p.vel.z) * k;
          }
        }
        // somersault progress
        if (p.flipV !== 0) {
          p.flip += p.flipV * dt;
          if ((p.flipV > 0 && p.flip >= p.flipEnd) || (p.flipV < 0 && p.flip <= p.flipEnd)) {
            p.flip = p.flipEnd;
            p.flipV = 0;
          }
        }
        const previousY = p.pos.y;
        p.pos.y += p.vy * dt;
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        const landingY = this.landingHeightAt(previousY, p.pos.y, p.pos.x, p.pos.z);
        if (landingY !== null) {
          this.landFromAir(p.vy, landingY);
          break;
        }
        // in the air: a somersault opens up (blade out, arms wide), tucks in the middle, then opens again for the landing
        // A plain jump is no longer a single frozen pose either. It is three beats, all read straight off the
        // vertical speed, so the very same code covers the first jump, the double jump and a long rooftop fall:
        //   1. takeoff extension — the body opens, the free arm punches up, the trailing leg kicks back
        //   2. apex hang         — everything floats open for a moment at the top of the arc
        //   3. descent           — the legs swing down and under the hips to go and meet the ground
        const vyN = clamp(p.vy / 8.4, -1, 1);
        const rise = clamp(vyN, 0, 1);
        const fall = clamp(-vyN, 0, 1);
        const apex = 1 - Math.min(1, Math.abs(vyN) / 0.3);
        const ext = 1 - smooth01(p.t / 0.24); // the takeoff beat, gone after a quarter of a second
        const stretch = clamp(Math.hypot(p.vel.x, p.vel.z) - 4, 0, 7) / 7; // a fast leap flattens out
        if (Math.abs(p.flipV) > 0.1) {
          const prog = clamp(1 - Math.abs(p.flipEnd - p.flip) / TAU, 0, 1);
          const w = smooth01((prog - 0.12) / 0.18) * (1 - smooth01((prog - 0.68) / 0.22));
          blendInto(T, FLIP_OPEN, P.tuck, w);
          // the flip still answers the air around it: flat and long when travelling fast, open at the top
          T.torsoX += 0.1 * stretch;
          T.dy += 0.03 * apex;
        } else if (p.flipStyle === 'back') {
          copyPose(T, FLIP_OPEN);
          T.dy += 0.03 * apex;
        } else {
          copyPose(T, P.jump);
          const tk = rise * ext; // takeoff beat
          T.torsoX += 0.2 * tk - 0.13 * fall + 0.16 * stretch;
          T.headX += -0.12 * tk + 0.17 * fall; // chin up off the ground, eyes on the landing coming down
          T.hipX += 0.1 * tk + 0.13 * fall + 0.06 * stretch;
          T.dy += 0.05 * tk + 0.035 * apex - 0.03 * fall;
          // free arm: punches up on takeoff, flares wide at the apex, drops to brace before touchdown
          T.lsX += -0.5 * tk + 0.2 * apex - 0.24 * fall;
          T.lsZ += 0.32 * tk + 0.24 * apex;
          T.leX += -0.32 * tk + 0.16 * apex - 0.1 * fall;
          // sword arm trails behind the body, then comes up ready as the ground arrives
          T.rsX += 0.18 * fall + 0.1 * tk;
          T.sp += 0.09 * fall;
          T.sw += -0.06 * tk;
          // legs: trailing kick, open at the top, then down and under the hips for the landing
          T.rhX += 0.24 * tk - 0.3 * fall;
          T.rkX += -0.28 * tk + 0.52 * fall;
          T.lhX += -0.2 * tk + 0.34 * fall;
          T.lkX += 0.22 * tk - 0.4 * fall;
          T.plant = 0;
        }
        // the pose follower snaps hard on takeoff and relaxes at the top of the arc — that is the hang time
        rate = 20 + 14 * rise * ext + 6 * fall;
        break;
      }
      case 'impale': {
        const a = p.anim!;
        const e = p.impTarget;
        sampleFrames(a.frames, p.t, T);
        applyArcs(a, p.t, T);
        p.trailOn = a.trail.some(([s, en]) => p.t >= s && p.t <= en);
        rate = 34;
        const alive = !!e && e.state !== 'dead';
        if (alive) {
          p.look = e!.pos;
          if (p.t < 0.24) p.yaw = turnToward(p.yaw, Math.atan2(e!.pos.x - p.pos.x, e!.pos.z - p.pos.z), 14 * dt);
          p.aim = p.yaw;
          // drive forward onto him
          const d = Math.hypot(e!.pos.x - p.pos.x, e!.pos.z - p.pos.z);
          if (p.t >= 0.18 && p.t < 0.27 && d > 1.4) p.pos.addScaledVector(fwd(p.aim), Math.min(d - 1.4, 14 * dt));
        }
        if (!p.impStab && p.t >= 0.26) {
          p.impStab = true;
          if (alive && this.alive(e!)) this.impaleHit(e!);
        }
        // he hangs on the blade, dragged along in front of the player
        if (p.impStab && !p.impKick && alive && e!.state === 'impaled') {
          const f = fwd(p.aim);
          e!.pos.x = p.pos.x + f.x * (1.25 * e!.scale);
          e!.pos.z = p.pos.z + f.z * (1.25 * e!.scale);
          e!.yaw = p.aim + Math.PI;
          e!.aim = e!.yaw;
          if (Math.random() < 0.5) {
            this.machineBurst(this.tmpV2.set(e!.pos.x, 1.1 * e!.scale, e!.pos.z), this.tmpV.set(0, -1, 0), 1, 1.6);
          }
        }
        if (!p.impKick && p.t >= 0.97) {
          p.impKick = true;
          if (alive && e!.state === 'impaled') this.impaleKick(e!);
          else {
            this.sfx.kickSwing();
            this.dustBurst(p.pos.clone().setY(0.1), 6, 2);
          }
        }
        p.vel.multiplyScalar(Math.exp(-7 * dt));
        if (p.t >= a.dur) {
          p.state = 'idle';
          p.t = 0;
          p.trailOn = false;
          p.impTarget = null;
          p.settle = 0.3;
        }
        break;
      }
      case 'dive': {
        const previousY = p.pos.y;
        p.pos.x += p.vel.x * dt;
        p.pos.z += p.vel.z * dt;
        p.pos.y += p.vy * dt;
        p.yaw = Math.atan2(p.vel.x, p.vel.z);
        p.aim = p.yaw;
        p.flip += (0.9 - p.flip) * (1 - Math.exp(-16 * dt));
        p.look = null;
        p.trailOn = true;
        copyPose(T, P.dive);
        rate = 34;
        if (Math.random() < 0.6) {
          this.sparkBurst(this.tmpV2.copy(p.pos).setY(p.pos.y + 0.9), p.vel.clone().multiplyScalar(-0.05), 1, 4, 0.6, new THREE.Color(1.4, 1.5, 2.2), 0.25);
        }
        let hitE: Enemy | null = null;
        for (const e of this.enemies) {
          if (!this.alive(e)) continue;
          const dx = e.pos.x - p.pos.x;
          const dz = e.pos.z - p.pos.z;
          if (dx * dx + dz * dz < 2.1 * e.scale * e.scale && p.pos.y < 2.2 * e.scale) {
            hitE = e;
            break;
          }
        }
        const landingY = this.landingHeightAt(previousY, p.pos.y, p.pos.x, p.pos.z);
        // one contact only: after the slash connects the dive simply falls to the ground
        if (hitE && !p.diveHit) this.diveStrike(hitE);
        if (landingY !== null) this.diveLand(landingY, !p.diveHit);
        else if (p.t > 1.2) this.diveLand(this.parkourFloorAt(p.pos.x, p.pos.z), !p.diveHit);
        break;
      }
      case 'stomp': {
        p.vel.multiplyScalar(0.85);
        copyPose(T, P.stomp);
        rate = 30;
        if (p.t > 0.6) {
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'hurt': {
        copyPose(T, P.hurt);
        rate = 30;
        if (p.t > 0.34) {
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'recoil': {
        copyPose(T, P.deflected);
        rate = 28;
        if (p.t > 0.42) {
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'broken': {
        copyPose(T, P.broken);
        T.torsoZ += Math.sin(this.time * 4) * 0.06;
        rate = 10;
        if (p.t > 2.3) {
          p.state = 'idle';
          p.t = 0;
          p.posture = this.pEffMax() * 0.3;
        }
        break;
      }
      case 'heal': {
        p.vel.multiplyScalar(0.9);
        copyPose(T, P.heal);
        rate = 12;
        if (!p.healDone && p.t > 0.55) {
          p.healDone = true;
          p.gourds--;
          const before = p.hp;
          p.hp = Math.min(p.hpMax, p.hp + 42);
          this.sfx.heal();
          this.onEvent({ type: 'heal', n: Math.round(p.hp - before) });
          const c = new THREE.Color(0.4, 1.8, 0.8);
          this.glowBurst(p.pos.clone().setY(1.4), 28, 0.12, c, 2.5);
          this.shocks.spawn(p.pos.clone().setY(0.1), 0x66ffaa, 2.2, 0.6);
        }
        if (p.t > 0.95) {
          p.state = 'idle';
          p.t = 0;
        }
        break;
      }
      case 'deathblow': {
        const a = DEATHBLOW;
        const e = p.dbTarget!;
        // glide into position
        const toE = this.tmpV.copy(e.pos).sub(p.pos).setY(0);
        const d = toE.length();
        const want = Math.atan2(toE.x, toE.z);
        p.yaw = turnToward(p.yaw, want, 20 * dt);
        if (d > 1.5 && p.t < 0.3) {
          p.pos.addScaledVector(toE.normalize(), Math.min(d - 1.5, 14 * dt));
        }
        p.trailOn = p.t >= a.trail[0][0] && p.t <= a.trail[0][1];
        sampleFrames(a.frames, p.t, T);
        rate = 38;
        if (!p.dbDone && p.t >= 0.4) this.executeDeathblow(e);
        if (p.t >= a.dur) {
          p.state = 'idle';
          p.t = 0;
          p.trailOn = false;
          p.dbTarget = null;
        }
        break;
      }
      case 'dead': {
        // sink to the knees first, then slump forward
        copyPose(T, p.t < 0.6 ? P.broken : P.dead);
        T.headX = p.t < 0.6 ? 0.5 : 0.1;
        p.look = null;
        rate = p.t < 0.6 ? 14 : 7;
        this.deadT += dt;
        const f = clamp((p.t - 0.5) / 0.9, 0, 1);
        const e = f * f * (3 - 2 * f);
        p.rig.root.rotation.x = 1.5 * e;
        break;
      }
    }
    // somersault angle: settle leftovers when we are no longer airborne, then apply it to the rig
    if (p.state !== 'jump' && p.state !== 'dive') {
      const tf = Math.round(p.flip / TAU) * TAU;
      p.flip += (tf - p.flip) * (1 - Math.exp(-22 * dt));
      if (Math.abs(p.flip - tf) < 0.02) p.flip = 0;
      p.flipV = 0;
    }
    if (p.state !== 'dead') p.rig.root.rotation.x = p.flip;

    // integrate generic velocity (knockback etc)
    if (p.state !== 'idle' && p.state !== 'jump' && p.state !== 'dive' && p.state !== 'dead') {
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
      p.vel.multiplyScalar(Math.exp(-6 * dt));
    } else if (p.state === 'idle') {
      p.pos.x += p.vel.x * dt;
      p.pos.z += p.vel.z * dt;
    }
    this.resolveParkourSideCollision(previousX, previousZ);
    if (p.state === 'idle') {
      const floor = this.parkourFloorAt(p.pos.x, p.pos.z);
      if (p.pos.y > floor + 0.02) {
        // Walking off a step becomes a real fall, preserving double-jump and air-dash access.
        p.state = 'jump';
        p.t = 0;
        p.anim = null;
        p.vy = 0;
        p.jumps = 1;
        p.diveAvail = true;
        p.dashAvail = true;
        p.airDashT = 0;
        p.jumpStart = -9;
      } else p.pos.y = floor;
    }
    if (
      p.state !== 'attack' &&
      p.state !== 'deathblow' &&
      p.state !== 'cut' &&
      p.state !== 'style' &&
      p.state !== 'dive'
    ) p.trailOn = false;

    p.gaitOn = p.state === 'idle';
    if (p.state !== 'idle') p.locoCarry = false;
    p.sig =
      p.state === 'attack'
        ? 'attack' + (p.anim?.name ?? '')
        : p.state === 'style'
          ? 'style' + this.styleLast
          : p.state === 'dodge' || p.state === 'land'
            ? p.state + (p.anim?.name ?? '')
            : p.state;
    p.soft = p.state === 'idle' || p.state === 'heal' || p.state === 'stomp' || p.state === 'jump' || p.state === 'style';
    this.finishPose(p, rate, dt);
    if (p.state === 'dead') p.rig.root.position.y = 0.12 * clamp(p.t / 0.9, 0, 1);
    void desiredSpeed;
  }

  private startAttack(special?: AnimDef) {
    const p = this.player;
    if (special) {
      p.anim = special;
      p.comboTimer = 0.7;
    } else {
      const idx = p.comboTimer > 0 ? p.comboIdx : 0;
      p.anim = PLAYER_COMBO[idx];
      p.comboIdx = (idx + 1) % PLAYER_COMBO.length;
      p.comboTimer = 0.8;
    }
    p.state = 'attack';
    p.t = 0;
    p.hitIdx = 0;
    p.swingPlayed = false;
    // Attacks follow the chosen lock target or committed movement direction; otherwise keep the player's current facing.
    const tgt = this.lockOn ? this.lockTarget : null;
    const move = this.moveInput();
    if (tgt) {
      p.yaw = Math.atan2(tgt.pos.x - p.pos.x, tgt.pos.z - p.pos.z);
    } else if (move.lengthSq() > 0.05) {
      p.yaw = Math.atan2(move.x, move.z);
    } else if (this.combatMode === 'before') {
      // The comparison mode preserves the former nearest-enemy aim assist.
      const n = this.nearestEnemy();
      if (n && this.enemySurfaceDistance(n, p.pos) < CLOSE_ATTACK_RANGE) p.yaw = Math.atan2(n.pos.x - p.pos.x, n.pos.z - p.pos.z);
    }
    p.aim = p.yaw;

    if (this.combatMode === 'before') {
      // Original combat: enemies can randomly evade, block, or parry when a swing starts.
      for (const e of this.enemies) {
        if (e.state !== 'idle' || !this.alive(e)) continue;
        const d = this.enemySurfaceDistance(e, p.pos);
        if (d > 5.0) continue;
        const ranged = e.kind === 'archer' || e.kind === 'gunner';
        const evadeChance = ranged ? 0.55 : this.isHeavyBoss(e) ? (e.phase2 ? 0.11 : 0.05) : e.boss ? (e.phase2 ? 0.4 : 0.3) : 0.26;
        if (e.evadeCD <= 0 && Math.random() < evadeChance) {
          this.startEvade(e, d < 2.6);
          continue;
        }
        if (ranged) continue;
        const parryChance = e.boss ? (e.phase2 ? 0.46 : 0.36) : 0.24;
        const blockChance = e.boss ? 0.36 : 0.42;
        const r = Math.random();
        e.defense = e.parryCD <= 0 && r < parryChance ? 'deflect' : r < parryChance + blockChance ? 'block' : null;
        e.defenseUntil = this.time + 0.72;
      }
    } else if (!this.rage.on && special?.hits[0]?.kind !== 'kick') {
      // Tactical update: readable guards replace random melee evasions; wind-ups and recovery remain punishable.
      for (const e of this.enemies) {
        if (e.state !== 'idle' || !this.alive(e)) continue;
        const d = this.enemySurfaceDistance(e, p.pos);
        if (d > 5.0) continue;
        const ranged = e.kind === 'archer' || e.kind === 'gunner';
        if (ranged) {
          if (e.evadeCD <= 0 && d < 2.8) this.startEvade(e, true);
          continue;
        }
        if (e.defense && this.time < e.defenseUntil) continue;
        const parryReady = e.parryCD <= 0;
        e.defense = parryReady ? 'deflect' : 'block';
        e.defenseUntil = this.time + (parryReady ? 0.6 : 0.78);
        if (parryReady) e.parryCD = e.boss ? 1.5 : 2.4;
      }
    }
  }

  /** The enemy slides out of the blade's path (or hops straight back when you're right on top of him). */
  private startEvade(e: Enemy, back: boolean) {
    const p = this.player;
    const toP = new THREE.Vector3(p.pos.x - e.pos.x, 0, p.pos.z - e.pos.z);
    if (toP.lengthSq() < 1e-4) toP.set(0, 0, 1);
    toP.normalize();
    e.evadeSide = back ? 0 : Math.random() < 0.5 ? 1 : -1;
    if (back) e.evadeDir.copy(toP).multiplyScalar(-1);
    else e.evadeDir.set(-toP.z * e.evadeSide, 0, toP.x * e.evadeSide);
    this.interruptEnemy(e);
    e.state = 'evade';
    e.stateT = 0;
    e.stateDur = back ? 0.42 : 0.38;
    e.evadeCD = this.combatMode === 'after' ? (e.boss ? 1.5 : 2.3) : e.boss ? rand(1.2, 2.0) : rand(1.9, 3.0);
    e.yaw = Math.atan2(toP.x, toP.z);
    e.aim = e.yaw;
    // a dodge is a free opening to strike back
    e.punish = e.boss ? 0.42 : 0.6;
    this.sfx.dodge();
    this.dustBurst(e.pos.clone().setY(0.12), 5, 1.8);
  }

  /** What is about to hit the player? A melee swing about to land, or an arrow / bullet on its way. */
  private findThreat(): { kind: 'slash' | 'thrust' | 'sweep' | 'proj'; ang: number | null; from: THREE.Vector3 } | null {
    const p = this.player;
    let best: { kind: 'slash' | 'thrust' | 'sweep' | 'proj'; ang: number | null; from: THREE.Vector3 } | null = null;
    let bt = 0.8;
    for (const e of this.enemies) {
      if (e.state !== 'attack' || !e.anim || e.anim.fire) continue;
      const h = e.anim.hits[e.hitIdx];
      if (!h) continue;
      const rem = (h.t - e.t) / e.speedMul;
      const threatRange = this.isHeavyBoss(e) ? this.enemyAttackReach(e, h) + 2 : 6.5;
      if (rem < bt && rem > -0.08 && e.pos.distanceTo(p.pos) < threatRange) {
        bt = rem;
        best = { kind: h.kind === 'kick' ? 'slash' : h.kind, ang: h.ang ?? null, from: e.pos };
      }
    }
    if (best) return best;
    const to = new THREE.Vector3();
    for (const pr of this.proj.items) {
      if (pr.stuck || pr.reflected) continue;
      to.subVectors(p.pos, pr.pos);
      const d = to.length();
      const sp = pr.vel.length();
      if (d < 18 && sp > 1 && pr.vel.dot(to) / (sp * d) > 0.9 && d / sp < 0.6) return { kind: 'proj', ang: null, from: pr.pos };
    }
    return null;
  }

  /**
   * The dodge reads the incoming attack and answers it:
   *  horizontal cut → duck under it · thrust / bullet → slide aside · forward input → slip through · backward → back-hop or a full backflip.
   * The blade is held parallel to the slash line during the evade, so the pose "meets" the attack.
   */
  private startDodge(move: THREE.Vector3) {
    const p = this.player;
    const tgt = this.lockOn ? this.lockTarget : null;
    const threat = this.findThreat();
    if (move.lengthSq() > 0.05) {
      p.dodgeDir.copy(move).normalize();
    } else if (threat && (threat.kind === 'thrust' || threat.kind === 'proj')) {
      // nothing held against a thrust / bullet → sidestep out of the line of fire
      const toE = new THREE.Vector3(threat.from.x - p.pos.x, 0, threat.from.z - p.pos.z).normalize();
      p.dodgeDir.set(-toE.z, 0, toE.x);
      if (Math.random() < 0.5) p.dodgeDir.multiplyScalar(-1);
    } else if (tgt) {
      p.dodgeDir.set(p.pos.x - tgt.pos.x, 0, p.pos.z - tgt.pos.z).normalize();
    } else {
      p.dodgeDir.copy(fwd(p.yaw)).multiplyScalar(-1);
    }
    // always face the attacker so the evade reads as a reaction, not a run
    const foe = tgt ?? this.nearestEnemy();
    if (foe && this.enemySurfaceDistance(foe, p.pos) < 14) p.yaw = Math.atan2(foe.pos.x - p.pos.x, foe.pos.z - p.pos.z);
    else p.yaw = Math.atan2(p.dodgeDir.x, p.dodgeDir.z);
    p.aim = p.yaw;
    const fv = fwd(p.yaw);
    const left = new THREE.Vector3(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
    const backC = -p.dodgeDir.dot(fv);
    const side = p.dodgeDir.dot(left) >= 0 ? 1 : -1;

    let kind: DodgeKind = 'slip';
    let flip = false;
    if (backC > 0.6) {
      if (Math.random() < 0.5 && threat?.kind !== 'sweep') flip = true;
      else kind = 'hop';
    } else if (backC < -0.6) kind = 'thru';
    if (!flip && kind !== 'thru' && threat?.kind === 'slash' && threat.ang !== null) {
      const a = ((threat.ang % Math.PI) + Math.PI) % Math.PI;
      if (a < 0.45 || a > 2.7) kind = 'duck'; // a flat horizontal cut: get under it
    }

    p.trailOn = false;
    this.shake(0.12);
    this.kickV.addScaledVector(p.dodgeDir, 0.1);
    p.vel.multiplyScalar(0.2); // the evade sets its own momentum — don't inherit the run
    if (flip) {
      // athletic backflip — a full rotation, blade out toward the enemy, i-frames the whole way up
      p.state = 'jump';
      p.t = 0;
      p.anim = null;
      p.vy = 6.8;
      p.vel.copy(p.dodgeDir).multiplyScalar(9.6);
      p.jumps = 1;
      p.diveAvail = true;
      p.dashAvail = true;
      p.airDashT = 0;
      p.jumpStart = -9;
      p.flip = 0;
      p.flipV = -TAU / 0.56;
      p.flipEnd = -TAU;
      p.flipStyle = 'back';
      p.inv = 0.5;
      this.sfx.flip();
      this.shocks.spawn(p.pos.clone().setY(0.1), 0xcfe0ff, 2.6, 0.35);
      this.dustBurst(p.pos.clone().setY(0.12), 10, 2.8);
      return;
    }
    p.state = 'dodge';
    p.t = 0;
    p.anim = buildDodge(kind, side, threat?.ang ?? null);
    p.dodgeKind = kind;
    p.dodgeSide = side;
    p.inv = 0.34;
    this.sfx.dodge();
    this.dustBurst(p.pos.clone().setY(0.15), 7, 2.2);
  }

  private startJump(move: THREE.Vector3) {
    const p = this.player;
    p.state = 'jump';
    p.t = 0;
    p.anim = null;
    p.vy = 8.4;
    p.jumpStart = this.time;
    p.trailOn = false;
    // moving jump = somersault; standing jump = a graceful leap (a second press in the air double-jumps)
    const moving = move.lengthSq() > 0.05;
    // a moving takeoff commits to the direction of travel — the lock never steers the body in the air.
    // A jump pressed while standing still keeps the current facing (and has no somersault at all).
    if (moving) {
      p.yaw = Math.atan2(move.x, move.z);
      p.aim = p.yaw;
    }
    const front = !moving || move.dot(fwd(p.yaw)) > -0.2;
    p.flip = 0;
    p.flipV = moving ? (front ? 1 : -1) * 9.4 : 0;
    p.flipEnd = moving ? (front ? 1 : -1) * TAU : 0;
    p.flipStyle = '';
    p.jumps = 1;
    p.diveAvail = true;
    p.dashAvail = true;
    p.airDashT = 0;
    // lean towards a sweeping enemy
    const sw = this.enemies.find((e) => e.state === 'attack' && e.anim?.warn?.kind === 'sweep');
    if (sw) {
      const d = new THREE.Vector3().subVectors(sw.pos, p.pos).setY(0);
      const len = d.length();
      if (len > 1.2) p.vel.copy(d.normalize().multiplyScalar(Math.min(4.5, (len - 1.2) / 0.6)));
      else p.vel.set(0, 0, 0);
    } else {
      p.vel.copy(move).multiplyScalar(4.2);
    }
    this.sfx.whoosh();
    this.dustBurst(p.pos.clone().setY(0.15), 8, 2.5);
    // the ground answers the push-off: a thin ring of air at the feet and a breath of camera lift
    this.shocks.spawn(p.pos.clone().setY(0.1), 0xcfe2ff, 1.5, 0.26);
    this.kickV.y += 0.022;
  }

  /**
   * Touchdown. A real jump ends in a pose: hero landing (hand to the ground, blade swept behind) — or, after a backflip dodge,
   * a skidding low ready stance with the blade on the enemy. Tiny hops just return to idle.
   */
  private landFromAir(impactVy: number, floorY = 0) {
    const p = this.player;
    const back = p.flipStyle === 'back';
    const airtime = p.t;
    const held = this.airSlashQueued;
    this.airSlashQueued = false;
    p.pos.y = floorY;
    p.jumps = 0;
    p.diveAvail = true;
    p.dashAvail = true;
    p.diveHit = false;
    p.airDashT = 0;
    p.flipStyle = '';
    const power = clamp(-impactVy / 12, 0.2, 1);
    this.landPower = power; // the landing pose reads this: how deep it compresses, how long it holds
    this.dustBurst(p.pos.clone().setY(floorY + 0.1), 8 + Math.round(10 * power), 2.5 + 2 * power);
    this.shake(0.12 + 0.28 * power);
    if (airtime > 0.3 || impactVy < -6) {
      p.state = 'land';
      p.t = 0;
      p.anim = back ? LAND_BACK_ANIM : LAND_HERO_ANIM;
      p.landBack = back;
      p.vel.multiplyScalar(back ? 0.62 : 0.12);
      this.sfx.land(power);
      this.shocks.spawn(p.pos.clone().setY(floorY + 0.08), 0xffe2c0, 2.4 + 2.4 * power, 0.42);
      this.kickV.set(0, -0.08 * power, 0);
      if (!back) this.addStyle(3);
    } else {
      p.state = 'idle';
      p.t = 0;
      p.vel.multiplyScalar(0.25);
    }
    // a swing held in the air is delivered on contact (the landing pose already cancels into it)
    // generous on purpose: 'land' only cancels into a swing after 0.2 s, and slow-motion stretches that
    if (held) this.attackBuf = Math.max(this.attackBuf, 0.5);
  }

  /**
   * IMPALE → KICK-OFF (scroll-wheel click). Runs the katana through the nearest enemy in front of you, holds him on the
   * steel for a beat, then plants a boot on his chest and tears the blade free — he is flung back and lands hard on his back.
   */
  private startImpale(): boolean {
    const p = this.player;
    let best: Enemy | null = null;
    let bs = 1e9;
    for (const e of this.enemies) {
      if (!this.alive(e) || e.state === 'impaled') continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = Math.hypot(dx, dz);
      if (d > 3.6) continue;
      const ang = Math.abs(angDiff(p.yaw, Math.atan2(dx, dz)));
      if (ang > 1.5) continue; // roughly in front of you
      const s = d + ang * 1.5;
      if (s < bs) {
        bs = s;
        best = e;
      }
    }
    if (!best) return false;
    p.state = 'impale';
    p.t = 0;
    p.anim = IMPALE;
    p.impTarget = best;
    p.impStab = false;
    p.impKick = false;
    p.vel.set(0, 0, 0);
    p.yaw = Math.atan2(best.pos.x - p.pos.x, best.pos.z - p.pos.z);
    p.aim = p.yaw;
    p.look = best.pos;
    this.sfx.swing(true);
    return true;
  }

  /** The blade goes in. */
  private impaleHit(e: Enemy) {
    const p = this.player;
    const dir = fwd(p.aim);
    const chest = e.pos.clone().setY(1.15 * e.scale);
    this.interruptEnemy(e);
    e.state = 'impaled';
    e.stateT = 0;
    e.defense = null;
    e.aiming = false;
    e.vel.set(0, 0, 0);
    e.hp -= 24 * e.dmgMul;
    this.addEnemyPosture(e, 45);
    this.sfx.impale();
    this.machineBurst(chest, dir, 28, 8);
    this.machineBurst(chest.clone().addScaledVector(dir, 0.45), dir, 22, 9); // a short coolant vent out of the back
    this.sparkBurst(chest, dir, 24, 7, 0.8, ROBOT_SPARK, 0.42);
    this.flashAt(chest, 0x70e9ff, 18);
    this.hitstop(0.14);
    this.slowmo(0.35, 0.4);
    this.shake(0.5);
    this.fovPunch = 5;
    this.kickV.addScaledVector(dir, 0.22);
    this.addRage(14);
    this.addStyle(22);
    e.flash = 1;
  }

  /** Boot on the chest: the blade rips out and he is launched. */
  private impaleKick(e: Enemy) {
    const p = this.player;
    const dir = fwd(p.aim);
    const chest = e.pos.clone().setY(1.1 * e.scale);
    const weight = e.boss ? 0.55 : 1;
    this.sfx.unsheathe();
    this.sfx.kick();
    this.machineBurst(chest, dir.clone().multiplyScalar(-1), 22, 7);
    this.machineBurst(chest, dir, 18, 9);
    this.shocks.spawn(chest, 0x62eaff, 3.4, 0.4);
    this.dustBurst(e.pos.clone().setY(0.08), 14, 3);
    this.flashAt(chest, 0x72e9ff, 22);
    this.hitstop(0.16);
    this.shake(0.8);
    this.fovPunch = 7;
    this.aberr = 0.016;
    p.vel.addScaledVector(dir, -2.4);
    e.hp -= 26 * e.dmgMul;
    this.addEnemyPosture(e, 55);
    this.addRage(10);
    this.addStyle(26);
    e.flash = 1;
    e.vel.copy(dir).multiplyScalar(15 * weight);
    e.vel.y = 0;
    if (e.hp <= 0 && e.state !== 'broken') {
      e.hp = 0;
      this.breakEnemy(e, true);
      return;
    }
    // sent tumbling: spins backwards through the air and lands flat on his back
    e.state = 'tumble';
    e.stateT = 0;
    e.stateDur = e.boss ? 1.0 : 1.5;
    e.tumbleA = 0;
    e.tumbleV = -(3.2 + Math.random() * 1.6) * weight;
    e.punish = 0;
  }

  /** Flying Swallow: a hard dive at the locked target (or straight ahead if none). */
  /**
   * Flying slash — only reachable after an air dash (roll depan). One cut, kick-weight, and then the
   * fighter drops to the ground; there is no rebound and no second pass at the same body.
   */
  private startDive() {
    const p = this.player;
    p.diveHit = false;
    let tgt = this.lockOn ? this.lockTarget : null;
    if (!tgt || !this.alive(tgt) || this.enemySurfaceDistance(tgt, p.pos) > CLOSE_ATTACK_RANGE) {
      tgt = this.nearestCloseEnemy();
    }
    const from = this.tmpV.set(p.pos.x, p.pos.y + 0.9, p.pos.z);
    const dir = new THREE.Vector3();
    if (tgt && this.enemySurfaceDistance(tgt, p.pos) <= CLOSE_ATTACK_RANGE) {
      const targetY = this.isHeavyBoss(tgt) ? 2.2 * this.sizeK : 1.0 * tgt.scale;
      dir.set(tgt.pos.x - from.x, targetY - from.y, tgt.pos.z - from.z).normalize();
    } else {
      dir.copy(fwd(p.yaw)).setY(-0.7).normalize();
    }
    const spd = 20;
    p.vel.set(dir.x * spd, 0, dir.z * spd);
    p.vy = Math.min(dir.y * spd, -3.5);
    p.state = 'dive';
    p.t = 0;
    p.anim = null;
    p.diveAvail = false;
    p.airDashT = 0;
    p.flipV = 0;
    p.flipEnd = 0;
    p.yaw = Math.atan2(dir.x, dir.z);
    p.aim = p.yaw;
    this.sfx.swing(true);
    this.shake(0.15);
    this.fovPunch = -3;
    this.kickV.addScaledVector(dir, 0.2);
  }

  /**
   * The flying slash connects: ONE cut weighted like the kick — little HP, enough posture to break a
   * guard — and that is the whole move. The dive's momentum dies on contact, so gravity drops the
   * fighter straight to the ground instead of bouncing him back up for another peck.
   */
  private diveStrike(e: Enemy) {
    const p = this.player;
    const h: HitDef = { t: 0, dmg: 10, post: 36, reach: 2.6, arc: 140, kind: 'slash', heavy: true, ang: 0.95 };
    p.diveHit = true;
    p.aim = Math.atan2(e.pos.x - p.pos.x, e.pos.z - p.pos.z);
    p.yaw = p.aim;
    this.onPlayerStrike(h);
    this.applyPlayerHit(e, h);
    this.addStyle(14);
    this.shake(0.42);
    this.fovPunch = 4;
    this.shocks.spawn(this.tmpV.copy(e.pos).setY(this.isHeavyBoss(e) ? 2.2 * this.sizeK : 1.1 * e.scale), 0xfff0c0, 2.6, 0.32);
    p.vel.multiplyScalar(0.2);
    p.vy = Math.min(p.vy, -3);
  }

  /** The dive hits the ground: shockwave that staggers anything close. */
  private diveLand(floorY = 0, shock = true) {
    const p = this.player;
    this.airSlashQueued = false;
    p.diveHit = false;
    p.pos.y = floorY;
    p.state = 'land';
    p.t = 0;
    p.anim = LAND_HERO_ANIM;
    p.landBack = false;
    this.landPower = 1; // slamming down out of a flying slash is the hardest landing there is
    p.flipStyle = '';
    p.vel.multiplyScalar(0.1);
    p.jumps = 0;
    p.diveAvail = true;
    p.dashAvail = true;
    this.shocks.spawn(p.pos.clone().setY(floorY + 0.1), 0xffd9b0, shock ? 5 : 3.2, 0.5);
    this.dustBurst(p.pos.clone().setY(floorY + 0.1), shock ? 18 : 10, shock ? 4 : 2.6);
    this.shake(shock ? 0.4 : 0.24);
    this.sfx.kick();
    // an empty dive still dents the ground; one that already cut somebody does not hit him twice
    if (shock) {
      for (const e of this.enemies.slice()) {
        if (!this.alive(e)) continue;
        if (this.enemySurfaceDistance(e, p.pos) < 2.8) {
          this.applyPlayerHit(e, { t: 0, dmg: 14, post: 24, reach: 3, arc: 360, kind: 'slash', heavy: false, ang: 0.95 });
        }
      }
    }
  }

  private startHeal() {
    const p = this.player;
    p.state = 'heal';
    p.t = 0;
    p.healDone = false;
    p.anim = null;
    this.sfx.gourd();
  }

  private tryMikiri(): boolean {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.state !== 'attack' || !e.anim || e.anim.warn?.kind !== 'thrust' || e.hitIdx > 0) continue;
      const hitT = e.anim.hits[0].t;
      const remaining = (hitT - e.t) / e.speedMul;
      const d = e.pos.distanceTo(p.pos);
      const mikiriRange = Math.max(5.5, this.enemyAttackReach(e, e.anim.hits[0]) + 1.5);
      if (remaining < 0.34 && remaining > -0.05 && d < mikiriRange) {
        // MIKIRI COUNTER
        const away = new THREE.Vector3().subVectors(p.pos, e.pos).setY(0).normalize();
        const counterOffset = this.isHeavyBoss(e)
          ? (HEAVY_BOSS_BODY_RADIUS + 1.2) * this.sizeK
          : 1.55 * e.scale;
        p.pos.copy(e.pos).addScaledVector(away, counterOffset);
        p.yaw = Math.atan2(-away.x, -away.z);
        p.state = 'stomp';
        p.t = 0;
        p.anim = null;
        p.vel.set(0, 0, 0);
        e.state = 'stagger';
        e.stateDur = 1.2;
        e.stateT = 0;
        e.t = 0;
        e.anim = null;
        e.trailOn = false;
        e.yaw = Math.atan2(away.x * -1, away.z * -1) + Math.PI;
        e.yaw = Math.atan2(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
        this.stats.mikiri++;
        const pt = e.pos.clone().addScaledVector(away, 0.9).setY(0.4);
        this.sfx.mikiri();
        this.sparkBurst(pt, new THREE.Vector3(0, 0.6, 0), 60, 8, 1.2, new THREE.Color(3, 2.2, 1.0));
        this.glowBurst(pt, 20, 0.2, new THREE.Color(2, 1.4, 0.6), 4);
        this.shocks.spawn(pt, 0xffd890, 3.2, 0.45);
        this.flashAt(pt.clone().setY(1), 0xffd9a0, 30);
        this.hitstop(0.16);
        this.slowmo(0.4, 0.3);
        this.shake(0.7);
        this.aberr = 0.02;
        this.whiteFlash = 0.3;
        this.addEnemyPosture(e, e.boss ? 62 : 90);
        this.onEvent({ type: 'mikiri', text: '見切り' });
        return true;
      }
    }
    return false;
  }

  private findDeathblowTarget(): Enemy | null {
    const p = this.player;
    let best: Enemy | null = null;
    let bd = 4.2;
    for (const e of this.enemies) {
      if (e.state !== 'broken') continue;
      const d = this.enemySurfaceDistance(e, p.pos);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private startDeathblow(e: Enemy) {
    const p = this.player;
    if (this.enemySurfaceDistance(e, p.pos) > 4.2) return;
    p.state = 'deathblow';
    p.t = 0;
    p.dbTarget = e;
    p.dbDone = false;
    p.anim = DEATHBLOW;
    p.vel.set(0, 0, 0);
    e.brokenDur = 99; // freeze broken state
    this.slowmo(0.6, 0.3);
    this.sfx.whoosh();
  }

  private executeDeathblow(e: Enemy) {
    const p = this.player;
    if (this.enemySurfaceDistance(e, p.pos) > 4.2) {
      p.state = 'idle';
      p.dbTarget = null;
      p.dbDone = true;
      return;
    }
    p.dbDone = true;
    this.stats.deathblows++;
    const chest = e.pos.clone().setY(1.25 * e.scale);
    const dir = fwd(p.yaw);
    this.sfx.deathblow();
    this.machineBurst(chest, dir, 58, 11);
    this.machineBurst(chest, new THREE.Vector3(0, 1, 0), 28, 7);
    this.sparkBurst(chest, dir, 68, 9, 1.0, ROBOT_SPARK, 0.72);
    this.glowBurst(chest, 24, 0.28, ROBOT_GLOW, 5);
    this.shocks.spawn(chest, 0x48dff4, 5, 0.6);
    this.shocks.spawn(chest, 0xffffff, 3, 0.35);
    this.flashAt(chest, 0x62e8ff, 34);
    this.hitStop = 0.28;
    this.slowmo(0.9, 0.22);
    this.shake(1);
    this.aberr = 0.035;
    this.whiteFlash = 0.55;
    this.fovPunch = 8;
    p.glow = 1;
    e.flash = 1;
    e.react = 1;
    e.reactPose = P.hurt;
    e.pips--;
    this.onEvent({ type: 'deathblow', text: '忍殺' });
    if (e.pips > 0) {
      e.hp = e.hpMax;
      e.posture = 0;
      e.lethal = false;
      e.state = 'recoil';
      e.stateT = 0;
      e.stateDur = 1.5;
      e.phase2 = true;
      e.speedMul = this.isHeavyBoss(e) ? 1.12 : 1.38;
      e.dmgMul = 0.75;
      e.rig.bladeMat.emissive.setHex(0xff2010);
      e.glow = 0.4;
      this.onEvent({ type: 'phase2', text: 'Jenderal mengamuk!' });
    } else {
      e.state = 'dying';
      e.stateT = 0;
      e.removeAt = this.time + (e.boss ? 3.5 : 2.2);
      e.trailOn = false;
      this.stats.kills++;
      this.maybeKillCam(e);
    }
  }

  /* ----- player strikes enemy ----- */
  private playerStrike(h: HitDef) {
    const p = this.player;
    let best: Enemy | null = null;
    let bs = 1e9;
    const locked = this.lockOn && this.lockTarget && this.alive(this.lockTarget) ? this.lockTarget : null;
    const targets = locked ? [locked] : this.enemies;
    const bladeReach = (h.reach + 0.6) * this.sizeK;
    const maxReach = Math.min(bladeReach, CLOSE_ATTACK_RANGE);
    for (const e of targets) {
      if (!this.alive(e)) continue;
      const dx = e.pos.x - p.pos.x;
      const dz = e.pos.z - p.pos.z;
      const d = this.enemySurfaceDistance(e, p.pos);
      if (d > maxReach) continue;
      const ang = Math.abs(angDiff(p.aim, Math.atan2(dx, dz)));
      if (ang > (h.arc / 2) * (Math.PI / 180)) continue;
      const s = d + ang * 2;
      if (s < bs) {
        bs = s;
        best = e;
      }
    }
    if (best) this.applyPlayerHit(best, h);
  }

  private applyPlayerHit(e: Enemy, h: HitDef) {
    const p = this.player;
    const dir = fwd(p.aim);
    const impactY = this.isHeavyBoss(e) ? 2.2 * this.sizeK : 1.2 * e.scale;
    const impact = e.pos.clone().setY(impactY).addScaledVector(dir, -0.35);
    const heavy = !!h.heavy;
    if (h.kind === 'kick') {
      this.addRage(10);
      this.addStyle(14);
      this.applyKick(e, h);
      return;
    }
    // the blade passes through empty air: he already slipped aside
    if (e.state === 'evade' && e.stateT < e.stateDur * 0.8) {
      this.sfx.whoosh();
      this.sparkBurst(impact, dir, 6, 4, 1, new THREE.Color(1.6, 1.6, 2), 0.25);
      this.addPlayerPosture(4); // whiffing costs you a little composure
      this.streak = 0;
      return;
    }
    const def =
      !this.rage.on && e.state === 'idle' && e.defense && this.time < e.defenseUntil && e.kind !== 'archer' && e.kind !== 'gunner'
        ? e.defense
        : null;

    if (def === 'deflect') {
      // a real parry: your blade is thrown off, you stagger, and he is already swinging back
      e.defense = null;
      e.parryCD = this.combatMode === 'before' ? (e.boss ? rand(1.0, 1.8) : rand(2.2, 3.6)) : e.boss ? 1.5 : 2.4;
      this.interruptEnemy(e);
      e.state = 'parry';
      e.stateT = 0;
      e.stateDur = 0.3;
      e.punish = e.boss ? 0.12 : 0.3; // instant riposte
      this.sfx.deflect(1);
      this.sparkBurst(impact, dir.clone().multiplyScalar(-0.6).setY(0.4), 70, 9, 1.1, new THREE.Color(3, 2.4, 1.2));
      this.glowBurst(impact, 12, 0.18, new THREE.Color(2, 1.6, 0.8), 3);
      this.shocks.spawn(impact, 0xffe2a0, 2.8, 0.38);
      this.flashAt(impact, 0xffe0a0, 24);
      this.hitstop(0.11);
      this.shake(0.55);
      this.aberr = 0.016;
      p.state = 'recoil';
      p.t = 0;
      p.anim = null;
      p.trailOn = false;
      p.vel.copy(dir).multiplyScalar(-6.5);
      p.glow = 1;
      p.comboIdx = 0;
      p.comboTimer = 0;
      this.addPlayerPosture(34);
      this.streak = 0;
      return;
    }
    if (def === 'block') {
      if (this.combatMode === 'after' && heavy) {
        // A committed heavy cut cracks a normal guard; kicks also break guards before reaching this branch.
        e.defense = null;
        e.defenseUntil = this.time;
        e.parryCD = Math.max(e.parryCD, e.boss ? 1.1 : 0.8);
        this.sfx.block();
        this.sparkBurst(impact, dir.clone().multiplyScalar(-0.5).setY(0.3), 36, 7, 1.0, new THREE.Color(2.8, 1.8, 0.8), 0.42);
        this.shocks.spawn(impact, 0xffd890, 1.8, 0.28);
        this.addEnemyPosture(e, h.post * 0.55);
        // Let the heavy strike continue through the cracked guard and deal its normal damage.
      } else {
        const legacy = this.combatMode === 'before';
        this.sfx.block();
        this.sparkBurst(impact, dir.clone().multiplyScalar(-0.5).setY(0.3), 25, 6, 1.0, new THREE.Color(2.2, 1.1, 0.4), 0.4);
        this.flashAt(impact, 0xffb060, 10);
        this.hitstop(legacy && heavy ? 0.09 : 0.055);
        this.shake(legacy && heavy ? 0.4 : 0.22);
        e.vel.addScaledVector(dir, (legacy && heavy ? 3.5 : 2.2) * (this.isHeavyBoss(e) ? 0.16 : 1));
        e.hp = Math.max(1, e.hp - h.dmg * e.dmgMul * (legacy ? 0.12 : 0.08));
        e.react = 0.4;
        e.reactPose = P.guard;
        this.addEnemyPosture(e, h.post * 1.55);
        return;
      }
    }

    const wasVulnerable = e.state === 'broken' || e.state === 'stagger' || e.state === 'recoil' || e.state === 'kicked';
    const dmg = h.dmg * e.dmgMul * (wasVulnerable ? 1.3 : 1) * (this.rage.on ? 1.7 : 1);
    this.sfx.hit(heavy);
    this.onPlayerHitFx(e, h, impact);
    this.hitstop(heavy ? 0.13 : 0.07);
    this.shake(heavy ? 0.6 : 0.28);
    this.fovPunch = heavy ? 4 : 1.5;
    e.flash = 1;
    e.react = 1;
    e.reactPose = P.hurt;
    const massScale = this.isHeavyBoss(e) ? 0.16 : 1;
    e.vel.addScaledVector(dir, (heavy ? 5 : 2.4) * massScale);
    e.hp -= dmg;
    if (this.rage.on) {
      // blade mode: the blow's momentum is stored (released as a burst when slow-mo ends)…
      e.imp.addScaledVector(dir, heavy ? 7 : 4);
      e.impDmg += dmg * 0.2;
      e.impHits++;
      // …but a plain slash never ends the fight in blade mode: the enemy hangs on at a sliver of health.
      // Finish them with the final slash (right-click).
      e.hp = Math.max(e.hpMax * 0.05, e.hp);
    }
    // in blade mode a flurry barely builds posture (so spamming can't break → deathblow by accident)
    if (!wasVulnerable && e.state !== 'broken') this.addEnemyPosture(e, this.rage.on ? h.post * 0.3 : h.post);
    if (e.hp <= 0 && e.state !== 'broken' && this.alive(e)) {
      e.hp = 0;
      this.breakEnemy(e, true);
    } else if (e.hp < 0) e.hp = 0;
    if (this.alive(e) && (e.state === 'idle' || (e.state === 'attack' && !e.boss))) {
      if (e.state === 'attack') this.interruptEnemy(e);
      e.state = 'flinch';
      e.stateT = 0;
      e.stateDur = heavy ? 0.5 : 0.3;
    }
  }

  /** Boot to the chest: ignores block & deflect, hurls the enemy back, wrecks posture, cancels normal attacks. */
  private applyKick(e: Enemy, h: HitDef) {
    const p = this.player;
    const dir = fwd(p.aim);
    const weight = this.isHeavyBoss(e) ? 0.12 : e.boss ? 0.6 : 1;
    const impactY = this.isHeavyBoss(e) ? 2.2 * this.sizeK : 1.0 * e.scale;
    const impact = e.pos.clone().setY(impactY).addScaledVector(dir, -0.4);
    const ground = e.pos.clone().setY(0.08);
    this.sfx.kick();
    this.dustBurst(ground, 26, 4.2);
    this.dustBurst(impact.clone().setY(0.4), 12, 3);
    this.sparkBurst(impact, dir, 26, 7, 1.1, new THREE.Color(2.4, 1.7, 0.9), 0.4);
    this.glowBurst(impact, 10, 0.2, new THREE.Color(2, 1.5, 0.8), 3);
    this.shocks.spawn(impact, 0xffffff, 3.6, 0.4);
    this.shocks.spawn(ground, 0xffd9b0, 5.2, 0.55);
    this.flashAt(impact, 0xffe0b0, 30);
    this.hitstop(0.15);
    this.slowmo(0.2, 0.35);
    this.shake(0.85);
    this.fovPunch = 7;
    this.aberr = 0.016;
    this.whiteFlash = 0.15;
    p.vel.addScaledVector(dir, -3);
    e.flash = 1;
    e.react = 1;
    e.reactPose = P.kicked;
    e.vel.addScaledVector(dir, 17 * weight);
    e.hp -= h.dmg * e.dmgMul;
    if (e.hp <= 0 && e.state !== 'broken') {
      e.hp = 0;
      this.breakEnemy(e, true);
      return;
    }
    if (e.hp < 0) e.hp = 0;
    // perilous attacks can't be kicked out of — only softened
    const perilous = e.state === 'attack' && !!e.anim?.warn;
    if (!perilous && e.state !== 'broken' && this.alive(e)) {
      if (e.state === 'attack') this.interruptEnemy(e);
      e.state = 'kicked';
      e.stateT = 0;
      e.stateDur = e.boss ? 0.75 : 1.15;
      e.defense = null;
    }
    this.addEnemyPosture(e, e.boss ? 30 : h.post * 1.5);
    this.onEvent({ type: 'kick', text: '蹴' });
  }

  private interruptEnemy(e: Enemy) {
    e.anim = null;
    e.trailOn = false;
  }

  private addEnemyPosture(e: Enemy, amt: number) {
    if (!this.alive(e) || e.state === 'broken') return;
    e.posture += amt;
    e.postureT = 0;
    if (e.posture >= this.eEffMax(e)) this.breakEnemy(e, false);
  }

  private breakEnemy(e: Enemy, lethal: boolean) {
    if (e.state === 'broken') return;
    this.interruptEnemy(e);
    e.state = 'broken';
    e.stateT = 0;
    e.lethal = lethal;
    e.brokenDur = lethal ? 12 : e.boss ? 4.4 : 5.5;
    e.posture = this.eEffMax(e);
    e.defense = null;
    e.rig.root.rotation.x = 0;
    const c = e.pos.clone().setY(1.3 * e.scale);
    this.sfx.postureBreak();
    this.sparkBurst(c, new THREE.Vector3(0, 0.3, 0), 70, 7, 1.4, new THREE.Color(2.6, 2.6, 3));
    this.glowBurst(c, 24, 0.22, new THREE.Color(1.6, 1.6, 2.4), 4);
    this.shocks.spawn(c, 0xffffff, 3.6, 0.5);
    this.flashAt(c, 0xffffff, 26);
    this.hitstop(0.15);
    this.slowmo(0.45, 0.35);
    this.shake(0.65);
    this.whiteFlash = 0.35;
    this.aberr = 0.02;
    this.onEvent({ type: 'enemyBreak', text: '体幹崩し' });
  }

  private addPlayerPosture(a: number) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'deathblow') return;
    p.posture += a;
    p.postureT = 0;
    if (p.posture >= this.pEffMax() && p.state !== 'broken') this.breakPlayer();
  }

  private breakPlayer() {
    const p = this.player;
    p.state = 'broken';
    p.t = 0;
    p.anim = null;
    p.trailOn = false;
    p.posture = this.pEffMax();
    this.sfx.postureBreak();
    this.hitstop(0.14);
    this.shake(0.8);
    this.aberr = 0.025;
    this.hurtFx = 0.6;
    this.streak = 0;
    this.onEvent({ type: 'playerBreak', text: 'Postur hancur!' });
  }

  private revive() {
    const p = this.player;
    if (p.state !== 'dead' || p.resurrect <= 0 || this.deadT < 1.2) return;
    p.resurrect--;
    p.hp = p.hpMax * 0.65;
    p.posture = 0;
    p.state = 'idle';
    p.t = 0;
    this.deadT = 0;
    this.sat = 0.3;
    this.sfx.revive();
    this.shocks.spawn(p.pos.clone().setY(0.1), 0xffe8a0, 7, 0.9);
    this.glowBurst(p.pos.clone().setY(1), 40, 0.2, new THREE.Color(2, 1.7, 0.8), 4);
    this.whiteFlash = 0.5;
    for (const e of this.enemies) {
      if (!this.alive(e)) continue;
      const d = new THREE.Vector3().subVectors(e.pos, p.pos).setY(0).normalize();
      e.vel.addScaledVector(d, 12);
      if (e.state !== 'broken') {
        this.interruptEnemy(e);
        e.state = 'recoil';
        e.stateT = 0;
        e.stateDur = 1.2;
      }
    }
    this.onEvent({ type: 'resurrect', text: '復活' });
  }

  /* ================= enemy attacks player ================= */
  private startEnemyAttack(e: Enemy, name: EnemyAttackName | RangedAttackName) {
    e.aim = e.yaw;
    e.fireIdx = 0;
    e.anim =
      name === 'shoot' || name === 'volley'
        ? rangedAttack(name, e.kind === 'archer' ? 'bow' : 'gun')
        : enemyAttack(name, e.boss);
    e.state = 'attack';
    e.t = 0;
    e.stateT = 0;
    e.hitIdx = 0;
    e.swingIdx = 0;
    e.warned = false;
    e.lungeD = [];
    e.lastAttack = name;
    e.defense = null;
  }

  private chooseAttack(e: Enemy): EnemyAttackName {
    const r = Math.random();
    let n: EnemyAttackName;
    // The heavy boss favors slow, readable, high-impact strikes over rapid multi-hit strings.
    if (!e.boss) n = r < 0.18 ? 'slash' : r < 0.46 ? 'combo2' : r < 0.68 ? 'combo3' : r < 0.86 ? 'thrust' : 'sweep';
    else if (this.isHeavyBoss(e)) {
      if (!e.phase2) n = r < 0.38 ? 'slash' : r < 0.68 ? 'sweep' : r < 0.9 ? 'thrust' : 'combo2';
      else n = r < 0.3 ? 'sweep' : r < 0.65 ? 'thrust' : r < 0.85 ? 'slash' : 'combo3';
    } else if (!e.phase2) n = r < 0.12 ? 'slash' : r < 0.46 ? 'combo3' : r < 0.72 ? 'combo4' : r < 0.88 ? 'thrust' : 'sweep';
    else n = r < 0.06 ? 'combo3' : r < 0.44 ? 'combo4' : r < 0.72 ? 'thrust' : 'sweep';
    if ((n === 'thrust' || n === 'sweep') && e.lastAttack === n) n = this.isHeavyBoss(e) ? 'slash' : e.boss ? 'combo3' : 'slash';
    return n;
  }

  private resolveEnemyHit(e: Enemy, h: HitDef, isLast: boolean) {
    const p = this.player;
    if (p.state === 'dead' || p.state === 'deathblow') return;
    const dx = p.pos.x - e.pos.x;
    const dz = p.pos.z - e.pos.z;
    const d = Math.hypot(dx, dz);
    if (d > this.enemyAttackReach(e, h)) return;
    if (Math.abs(angDiff(e.aim, Math.atan2(dx, dz))) > (h.arc / 2) * (Math.PI / 180)) return;

    // dodge i-frames (a Flying Swallow dive is untouchable too)
    if (p.inv > 0 || p.state === 'dive' || (p.state === 'dodge' && p.t > 0.03 && p.t < 0.34)) {
      this.sfx.whoosh();
      return;
    }
    // airborne vs sweep
    if (h.kind === 'sweep' && p.pos.y > 0.3) {
      if (this.time - p.jumpStart < 0.6) this.doStomp(e);
      else this.sfx.whoosh();
      return;
    }
    const impact = p.pos.clone().setY(1.25);
    const dirToP = new THREE.Vector3(dx, 0, dz).normalize();

    const tactical = this.combatMode === 'after';
    const toAttacker = dirToP.clone().negate();
    const facesAttack = fwd(p.yaw).dot(toAttacker) > 0.35;
    const guardable = h.kind === 'slash' || (tactical && h.kind === 'thrust');
    if (guardable && p.state === 'idle' && this.guardHeld && (!tactical || facesAttack)) {
      const dirE = fwd(p.yaw);
      const contact = p.pos.clone().addScaledVector(dirE, 0.85).setY(1.35);
      const perfect = p.guardT <= (tactical ? DEFLECT_WINDOW : 0.26);
      if (perfect) {
        // Tactical mode lets a precisely timed guard catch a thrust too; sweeps still require movement.
        this.doDeflect(e, contact, dirToP, isLast);
        return;
      }
      if (h.kind === 'slash') {
        this.sfx.block();
        this.sparkBurst(contact, dirToP.clone().setY(0.3), 30, 6.5, 1.0, new THREE.Color(2.2, 1.1, 0.4), 0.4);
        this.flashAt(contact, 0xffb060, 10);
        this.hitstop(0.06);
        this.shake(tactical && h.heavy ? 0.4 : 0.3);
        p.vel.addScaledVector(dirToP, tactical && h.heavy ? 7.5 : 6.5);
        p.react = 0.7;
        p.reactPose = p.kickSide > 0 ? P.kickA : P.kickB;
        p.kickSide *= -1;
        const chip = tactical ? (h.heavy ? 0.16 : 0.08) : 0.1;
        const posture = tactical ? (h.heavy ? 1.8 : 1.25) : 1.4;
        p.hp = Math.max(1, p.hp - h.dmg * chip);
        this.streak = 0;
        this.addPlayerPosture(h.post * posture);
        return;
      }
      // A mistimed tactical guard does not stop a thrust. Use Mikiri or evade instead.
    }

    // clean hit on player
    const broken = p.state === 'broken';
    const bossDamage = e.boss ? (e.phase2 ? 2.3 : 2.0) : 1;
    const dmg = h.dmg * bossDamage * (broken ? 1.5 : 1);
    p.hp -= dmg;
    this.streak = 0;
    this.sfx.hurt();
    this.bloodBurst(impact, dirToP, 24, 7);
    this.sparkBurst(impact, dirToP, 10, 5, 1, new THREE.Color(2.4, 0.8, 0.5), 0.3);
    this.hitstop(e.boss ? 0.18 : h.heavy ? 0.14 : 0.09);
    this.shake(e.boss ? 1.25 : h.heavy ? 0.9 : 0.6);
    this.hurtFx = 0.9;
    this.aberr = 0.015;
    p.flash = 1;
    p.vel.addScaledVector(dirToP, h.heavy ? 8 : 5);
    p.anim = null;
    p.trailOn = false;
    if (p.hp <= 0) {
      p.hp = 0;
      this.killPlayer();
      return;
    }
    if (!broken) {
      p.state = 'hurt';
      p.t = 0;
    }
    this.addPlayerPosture(h.post * 0.7);
  }

  private doDeflect(e: Enemy, contact: THREE.Vector3, dirToP: THREE.Vector3, isLast: boolean) {
    const p = this.player;
    this.streak++;
    this.streakT = 0;
    this.stats.deflects++;
    const away = dirToP.clone().multiplyScalar(-1);
    this.sfx.deflect(this.streak);
    this.sparkBurst(contact, away.clone().multiplyScalar(0.4).setY(0.5), 110, 10, 1.2, new THREE.Color(3.2, 2.6, 1.4), 0.7);
    this.sparkBurst(contact, dirToP.clone().multiplyScalar(0.4).setY(0.5), 40, 7, 1.0, new THREE.Color(3, 3, 3.4), 0.5);
    this.glowBurst(contact, 16, 0.22, new THREE.Color(2.4, 1.9, 1.0), 3.5);
    this.shocks.spawn(contact, 0xfff0c0, 3.0, 0.4);
    this.shocks.spawn(contact, 0xffffff, 1.6, 0.22);
    this.flashAt(contact, 0xffe8b0, 38);
    this.hitstop(0.11);
    this.shake(0.5);
    this.aberr = 0.016;
    this.whiteFlash = 0.22;
    this.fovPunch = 4;
    p.glow = 1;
    p.react = 1;
    p.reactPose = p.kickSide > 0 ? P.kickA : P.kickB;
    p.kickSide *= -1;
    p.vel.addScaledVector(dirToP, 3.2);
    e.vel.addScaledVector(away, this.isHeavyBoss(e) ? 0.45 : 3.0);
    e.react = 0.7;
    e.reactPose = P.deflected;
    e.glow = 0.6;
    this.addPlayerPosture(5);
    this.addEnemyPosture(e, e.boss ? 27 : 40);
    this.onEvent({ type: 'deflect', n: this.streak });
    if (isLast && e.state === 'attack') {
      this.interruptEnemy(e);
      e.state = 'recoil';
      e.stateT = 0;
      e.stateDur = 0.7;
    }
  }

  private doStomp(e: Enemy) {
    const p = this.player;
    this.interruptEnemy(e);
    e.state = 'stagger';
    e.stateT = 0;
    e.stateDur = 1.1;
    const pt = e.pos.clone().setY(this.isHeavyBoss(e) ? 2.2 * this.sizeK : 2.0 * e.scale);
    this.sfx.mikiri();
    this.sparkBurst(pt, new THREE.Vector3(0, -0.2, 0), 60, 8, 1.2, new THREE.Color(3, 2.2, 1.0));
    this.shocks.spawn(pt, 0xffd890, 3.2, 0.45);
    this.flashAt(pt, 0xffd9a0, 28);
    this.hitstop(0.13);
    this.slowmo(0.35, 0.3);
    this.shake(0.6);
    this.aberr = 0.018;
    const away = new THREE.Vector3().subVectors(p.pos, e.pos).setY(0).normalize();
    p.vy = 8.5;
    p.vel.copy(away).multiplyScalar(5);
    p.jumpStart = -9;
    this.stats.mikiri++;
    this.addEnemyPosture(e, e.boss ? 52 : 80);
    this.onEvent({ type: 'stomp', text: '踏み付け' });
  }

  private killPlayer() {
    const p = this.player;
    p.state = 'dead';
    p.t = 0;
    this.deadT = 0;
    this.airSlashQueued = false; // a swing booked for a landing that will never happen
    this.sfx.die();
    this.slowmo(1.2, 0.25);
    this.onEvent({ type: 'playerDeath', text: '死' });
  }

  /* ================= enemies ================= */
  private updateEnemy(e: Enemy, dt: number) {
    const p = this.player;
    e.stateT += dt;
    e.postureT += dt;
    e.flash = Math.max(0, e.flash - dt * 6);
    e.react = Math.max(0, e.react - dt * 5);
    e.glow = Math.max(0, e.glow - dt * 2);
    if (e.defense && this.time > e.defenseUntil) e.defense = null;
    e.evadeCD = Math.max(0, e.evadeCD - dt);
    e.parryCD = Math.max(0, e.parryCD - dt);
    const T = e.target;
    let rate = 12;
    const toP = this.tmpV.set(p.pos.x - e.pos.x, 0, p.pos.z - e.pos.z);
    const dist = toP.length();
    const wantYaw = Math.atan2(toP.x, toP.z);
    let speed = 0;

    if (e.state !== 'broken' && e.state !== 'dying' && e.state !== 'dead' && e.state !== 'spawn' && e.postureT > 1.15) {
      e.posture = Math.max(0, e.posture - 21 * (0.5 + 0.5 * (e.hp / e.hpMax)) * dt);
    }

    switch (e.state) {
      case 'spawn': {
        copyPose(T, P.idleE);
        e.pose = clonePose(P.idleE);
        e.look = p.pos;
        if (e.stateT > 1.2) {
          e.state = 'idle';
          e.stateT = 0;
        }
        break;
      }
      case 'idle': {
        const heavyBoss = this.isHeavyBoss(e);
        const turnRate = heavyBoss ? 1.45 : e.boss ? 8 : 6;
        e.yaw = turnToward(e.yaw, wantYaw, turnRate * dt);
        e.circleT -= dt;
        if (e.circleT <= 0) {
          e.circleDir = Math.random() < 0.5 ? 1 : -1;
          e.circleT = rand(1.4, 3.5);
        }
        const ranged = e.kind === 'archer' || e.kind === 'gunner';
        // ranged enemies never block the melee queue — they snipe independently
        // three blades may press you at once now: the duel is meant to feel outnumbered
        const busy =
          !ranged &&
          this.enemies.filter((o) => o !== e && o.state === 'attack' && o.kind !== 'archer' && o.kind !== 'gunner').length >= 3;
        let fwdS = 0;
        let side = 0;
        const approach = heavyBoss ? 2.15 * (0.45 + 0.55 * this.sizeK) : (e.boss ? 5.2 : 4.6) * (0.45 + 0.55 * this.sizeK);
        if (ranged) {
          // keep a firing distance: back off fast when rushed, close in when too far, always sidestep
          const lo = e.kind === 'archer' ? 8 : 6.5;
          const hi = e.kind === 'archer' ? 13 : 10.5;
          if (dist < lo - 1.5) fwdS = -4.2;
          else if (dist < lo) fwdS = -2;
          else if (dist > hi) fwdS = 3.6;
          side = e.circleDir * (dist < lo + 2 ? 2.4 : 1.5);
        } else if (heavyBoss) {
          if (dist > 5.2) fwdS = approach;
          else if (dist < 3.2) fwdS = -0.45 * this.sizeK;
          side = e.circleDir * (dist < 3.2 ? 0.06 : 0.18) * this.sizeK;
        } else if (busy) {
          // waiting their turn no longer means walking away: they crowd you and look for the gap
          if (dist < 4.0) fwdS = -0.9;
          else if (dist > 5.4) fwdS = approach * 0.85;
          side = e.circleDir * 1.5;
        } else if (dist > 3.0) {
          fwdS = approach;
          side = e.circleDir * 0.6;
        } else if (dist < 1.6) {
          fwdS = -1.2;
          side = e.circleDir * 1.15;
        } else {
          side = e.circleDir * 1.3;
        }
        const f = fwd(e.yaw);
        const r = new THREE.Vector3(-f.z, 0, f.x).multiplyScalar(-1);
        const mv = f.multiplyScalar(fwdS).add(r.multiplyScalar(side));
        e.pos.x += mv.x * dt;
        e.pos.z += mv.z * dt;
        speed = mv.length();
        const guard = !ranged && e.defense && this.time < e.defenseUntil;
        const idlePose = guard ? (this.combatMode === 'after' && e.defense === 'deflect' ? PARRY_POSE : P.guard) : P.idleE;
        copyPose(T, ranged ? (e.kind === 'archer' ? IDLE_BOW : IDLE_GUN) : idlePose);
        e.look = p.pos;
        this.walkOverlay(T, e, speed, dt, 4.0, mv.x, mv.z, !guard && !ranged);
        rate = guard ? 24 : 10;
        e.attackTimer -= dt;
        const playerAlive = p.state !== 'dead' && p.state !== 'deathblow';
        if (ranged) {
          if (e.attackTimer <= 0 && !e.disarmed && dist > 2.5 && dist < 18 && playerAlive && this.alive(e)) {
            this.startEnemyAttack(e, e.kind === 'archer' && Math.random() < 0.38 ? 'volley' : 'shoot');
          }
        } else if (
          e.attackTimer <= 0 &&
          !e.disarmed &&
          !busy &&
          dist < (heavyBoss ? HEAVY_BOSS_ATTACK_RANGE : 4.9) &&
          playerAlive &&
          this.alive(e)
        ) {
          this.startEnemyAttack(e, this.chooseAttack(e));
        }
        break;
      }
      case 'attack': {
        const a = e.anim;
        if (!a) {
          e.state = 'idle';
          break;
        }
        const prev = e.t;
        e.t += dt * e.speedMul;
        // perilous warning
        if (a.warn && !e.warned && e.t >= a.warn.t) {
          e.warned = true;
          e.rig.bladeMat.emissive.setHex(0xff2010);
          e.perilId = ++this.perilCounter;
          this.sfx.perilous();
          this.shake(0.22);
          e.glow = 1;
          this.flashAt(e.pos.clone().setY(2 * e.scale), 0xff2010, 18);
        }
        if (a.warn && e.warned && e.hitIdx === 0) e.glow = 0.9 + Math.sin(this.time * 30) * 0.1;
        // swing sound
        if (e.swingIdx < a.hits.length && e.t >= a.hits[e.swingIdx].t - 0.1) {
          this.sfx.swing(!!a.hits[e.swingIdx].heavy);
          e.swingIdx++;
        }
        // track the player hard during the first wind-up, then gently re-aim between the hits of a combo
        const inStrike = a.hits.some((h) => Math.abs(e.t - h.t) < 0.14) || !!a.spins?.some((s) => e.t > s.t0 - 0.05 && e.t < s.t1 + 0.1);
        if (e.t < a.trackUntil) e.aim = turnToward(e.aim, wantYaw, (this.isHeavyBoss(e) ? (e.phase2 ? 2.4 : 1.5) : e.boss ? 6 : 5) * dt);
        else if (a.name.startsWith('combo') && !inStrike && e.t < a.dur - 0.5) e.aim = turnToward(e.aim, wantYaw, 2.6 * dt * e.speedMul);
        let eSpin = 0;
        if (a.spins) {
          for (const s of a.spins) {
            const u = clamp((e.t - s.t0) / (s.t1 - s.t0), 0, 1);
            eSpin += s.turns * Math.PI * 2 * (u * u * (3 - 2 * u));
          }
        }
        e.yaw = e.aim + eSpin;
        // lunge
        a.lunge.forEach((l, i) => {
          const a0 = Math.max(prev, l.t0);
          const a1 = Math.min(e.t, l.t1);
          if (a1 > a0) {
            if (e.lungeD[i] === undefined) e.lungeD[i] = clamp(dist - 1.6, 0, l.dist);
            const move = (e.lungeD[i] * (a1 - a0)) / (l.t1 - l.t0);
            e.pos.addScaledVector(fwd(e.aim), move);
          }
        });
        while (e.hitIdx < a.hits.length && e.t >= a.hits[e.hitIdx].t) {
          const h = a.hits[e.hitIdx];
          const last = e.hitIdx === a.hits.length - 1;
          e.hitIdx++;
          this.resolveEnemyHit(e, h, last);
          if (e.state !== 'attack') break;
        }
        if (e.state !== 'attack') break;
        e.trailOn = a.trail.some(([s, en]) => e.t >= s && e.t <= en);
        sampleFrames(a.frames, e.t, T);
        applyArcs(a, e.t, T);
        if (a.fire) this.rangedTick(e, a);
        rate = 36;
        if (e.t >= a.dur) {
          e.state = 'idle';
          e.stateT = 0;
          e.anim = null;
          e.trailOn = false;
          e.settle = 0.3;
          e.attackTimer = this.isHeavyBoss(e)
            ? rand(e.phase2 ? 0.5 : 0.85, e.phase2 ? 0.8 : 1.35)
            : e.boss
              ? rand(e.phase2 ? 0.14 : 0.24, e.phase2 ? 0.4 : 0.62)
              : e.kind === 'archer' || e.kind === 'gunner'
                ? rand(0.65, 1.35)
                : rand(0.22, 0.62);
        }
        break;
      }
      case 'flinch': {
        copyPose(T, P.hurt);
        rate = 30;
        e.trailOn = false;
        if (e.stateT > e.stateDur) {
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = Math.min(e.attackTimer, rand(0.18, 0.5));
        }
        break;
      }
      case 'recoil': {
        copyPose(T, P.deflected);
        rate = 24;
        if (e.stateT > e.stateDur) {
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = rand(0.1, 0.35);
        }
        break;
      }
      case 'evade': {
        // slide out of the blade's path — untouchable for most of it, then straight back into stance (often countering)
        const u = clamp(e.stateT / e.stateDur, 0, 1);
        const sp = (1 - u) * (e.evadeSide === 0 ? 11 : 13);
        e.pos.addScaledVector(e.evadeDir, sp * dt);
        if (e.evadeSide === 0) e.pos.y = 0.22 * Math.sin(Math.PI * u);
        copyPose(T, e.evadeSide === 0 ? EVADE_BACK : EVADE_SIDE);
        if (e.evadeSide < 0) {
          T.torsoZ = -T.torsoZ;
          T.hipZ = -T.hipZ;
          T.torsoY = -T.torsoY;
          T.headY = -T.headY;
        }
        rate = 30;
        e.look = p.pos;
        e.yaw = turnToward(e.yaw, wantYaw, 9 * dt);
        e.aim = e.yaw;
        if (u > 0.25 && Math.random() < 0.4) this.dustBurst(this.tmpV2.set(e.pos.x, 0.06, e.pos.z), 1, 1.4);
        if (e.stateT > e.stateDur) {
          e.pos.y = 0;
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = Math.min(e.attackTimer, e.punish > 0 ? e.punish : rand(0.4, 0.9));
          e.punish = 0;
        }
        break;
      }
      case 'parry': {
        // blade thrown up to catch the strike, then an instant riposte
        copyPose(T, PARRY_POSE);
        rate = 38;
        e.look = p.pos;
        e.yaw = turnToward(e.yaw, wantYaw, 12 * dt);
        e.aim = e.yaw;
        e.vel.multiplyScalar(Math.exp(-9 * dt));
        if (e.stateT > e.stateDur) {
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = e.punish > 0 ? e.punish : rand(0.25, 0.5);
          e.punish = 0;
        }
        break;
      }
      case 'impaled': {
        // run through: hanging on the steel, head down, feet barely touching the ground
        copyPose(T, IMPALED_POSE);
        T.torsoZ += Math.sin(this.time * 9) * 0.05;
        rate = 22;
        e.look = null;
        e.trailOn = false;
        e.vel.set(0, 0, 0);
        e.pos.y = 0.14;
        if (e.stateT > 2.2) {
          // the player's animation was cut short somehow — let him slide off
          e.pos.y = 0;
          e.state = 'kicked';
          e.stateT = 0;
          e.stateDur = 0.8;
        }
        break;
      }
      case 'tumble': {
        // blasted off the blade: spins backwards, hits the ground, rolls, then drags himself up
        copyPose(T, e.stateT < 0.75 ? TUMBLE_POSE : P.broken);
        rate = e.stateT < 0.75 ? 20 : 10;
        e.look = null;
        e.trailOn = false;
        const air = e.pos.y > 0.02 || e.stateT < 0.42;
        if (air) {
          e.vel.y = e.vel.y === 0 && e.stateT < 0.02 ? 5.2 : e.vel.y - 17 * dt;
          e.pos.y = Math.max(0, e.pos.y + e.vel.y * dt);
          e.tumbleA += e.tumbleV * dt;
          if (e.pos.y <= 0 && e.vel.y < 0) {
            // impact with the gravel
            e.vel.y = 0;
            e.vel.x *= 0.35;
            e.vel.z *= 0.35;
            this.dustBurst(e.pos.clone().setY(0.08), 16, 3);
            this.sfx.land(0.9);
            this.shake(0.3);
            this.machineBurst(e.pos.clone().setY(0.4), this.tmpV.set(0, 1, 0), 12, 4);
          }
        } else {
          e.vel.multiplyScalar(Math.exp(-5 * dt));
          // settle flat on his back, then roll upright again
          const want = e.stateT > e.stateDur - 0.55 ? 0 : -Math.PI / 2;
          e.tumbleA += (want - e.tumbleA) * (1 - Math.exp(-7 * dt));
        }
        e.rig.root.rotation.x = e.tumbleA;
        if (e.stateT > e.stateDur) {
          e.pos.y = 0;
          e.tumbleA = 0;
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = rand(0.5, 1.1);
        }
        break;
      }
      case 'kicked': {
        copyPose(T, P.kicked);
        rate = 26;
        e.trailOn = false;
        // skid trail while flying back
        if (e.vel.length() > 5) this.dustBurst(this.tmpV2.set(e.pos.x, 0.1, e.pos.z), 1, 1.6);
        if (e.stateT > e.stateDur) {
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = rand(0.4, 0.9);
        }
        break;
      }
      case 'stagger': {
        copyPose(T, P.stagger);
        rate = 20;
        if (e.stateT > e.stateDur) {
          e.state = 'idle';
          e.stateT = 0;
          e.attackTimer = rand(0.5, 1.0);
        }
        break;
      }
      case 'broken': {
        copyPose(T, P.broken);
        T.torsoZ += Math.sin(this.time * 3 + e.id) * 0.08;
        rate = 9;
        e.yaw = turnToward(e.yaw, wantYaw, 3 * dt);
        if (e.stateT > e.brokenDur && this.player.dbTarget !== e) {
          e.state = 'idle';
          e.stateT = 0;
          e.posture = this.eEffMax(e) * 0.25;
          if (e.lethal) {
            e.lethal = false;
            e.hp = e.hpMax * 0.3;
          }
          e.attackTimer = 0.8;
        }
        break;
      }
      case 'dying':
      case 'dead': {
        copyPose(T, e.stateT < 0.55 ? P.broken : P.dead);
        T.headX = e.stateT < 0.55 ? 0.5 : 0.1;
        e.look = null;
        rate = e.stateT < 0.55 ? 14 : 7;
        const f = clamp((e.stateT - 0.45) / (e.boss ? 1.3 : 0.9), 0, 1);
        const ee = f * f * (3 - 2 * f);
        e.rig.root.rotation.x = 1.5 * ee;
        e.trailOn = false;
        break;
      }
    }
    if (e.state !== 'dying' && e.state !== 'dead' && e.state !== 'tumble') e.rig.root.rotation.x = 0;
    if (e.state !== 'attack') {
      e.aiming = false;
      if (e.kind === 'archer' || e.kind === 'gunner') e.rig.setDraw(0, false);
    }
    // blood keeps spurting from every severed stump for a few seconds
    if (e.bleedT > 0 && e.stumps.length && this.alive(e)) {
      e.bleedT -= dt;
      for (const s of e.stumps) {
        if (Math.random() < 0.75) {
          s.getWorldPosition(this.tmpV2);
          this.machineBurst(this.tmpV2, this.tmpV.set(Math.random() - 0.5, 0.5, Math.random() - 0.5), 1, 2.2 + Math.random() * 2.6);
        }
      }
    }
    this.updateAimLine(e);

    // knockback
    if (e.state !== 'idle') {
      // idle handles its own motion; others use vel
    }
    e.pos.x += e.vel.x * dt;
    e.pos.z += e.vel.z * dt;
    e.vel.multiplyScalar(Math.exp(-7 * dt));
    e.pos.y = 0;

    e.gaitOn = e.state === 'idle';
    if (e.state !== 'idle') e.locoCarry = false;
    e.sig = e.state;
    e.soft = e.state === 'idle' || e.state === 'spawn';
    this.finishPose(e, rate, dt);
    if (e.state === 'dying' || e.state === 'dead') {
      e.rig.root.position.y = 0.12 * e.scale * clamp(e.stateT / 0.9, 0, 1);
    }
    if (e.state === 'dead' && this.time > e.removeAt + 1.5) {
      e.rig.root.position.y -= (this.time - e.removeAt - 1.5) * 0.4;
    }
    if (e.state === 'spawn') {
      const k = clamp(e.stateT / 1.0, 0, 1);
      e.rig.root.scale.setScalar(e.scale * (0.6 + 0.4 * k));
      e.rig.root.visible = true;
    } else if (e.rig.root.scale.x !== e.scale) {
      e.rig.root.scale.setScalar(e.scale);
    }
  }

  /* ================= HUD snapshot ================= */
  private project(v: THREE.Vector3) {
    const p = v.clone().project(this.camera);
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    return {
      x: (p.x * 0.5 + 0.5) * w,
      y: (-p.y * 0.5 + 0.5) * h,
      on: p.z < 1 && p.x > -1.1 && p.x < 1.1 && p.y > -1.1 && p.y < 1.1,
    };
  }

  getSnapshot(): Snapshot {
    const p = this.player;
    const focus = (this.lockOn ? this.lockTarget : null) ?? this.nearestEnemy();
    const enemies: EnemyView[] = this.enemies
      .filter((e) => e.state !== 'dead')
      .map((e) => {
        const s = this.project(e.pos.clone().setY(2.35 * e.scale));
        const combatTell: EnemyView['combatTell'] =
          this.combatMode !== 'after'
            ? null
            : e.state === 'idle' && e.defense && this.time < e.defenseUntil
              ? e.defense === 'deflect'
                ? 'parry'
                : 'guard'
              : e.state === 'attack' && !e.boss || ['flinch', 'recoil', 'stagger', 'kicked'].includes(e.state)
                ? 'opening'
                : null;
        return {
          id: e.id,
          name: e.name,
          hp: clamp(e.hp / e.hpMax, 0, 1),
          posture: clamp(e.posture / this.eEffMax(e), 0, 1),
          broken: e.state === 'broken',
          lethal: e.lethal,
          pips: e.pips,
          maxPips: e.maxPips,
          x: s.x,
          y: s.y,
          onScreen: s.on,
          focus: e === focus,
          boss: e.boss,
          kind: e.kind,
          aiming: e.aiming,
          combatTell,
          ang: Math.atan2(
            (e.pos.x - p.pos.x) * -Math.cos(this.camYaw) + (e.pos.z - p.pos.z) * Math.sin(this.camYaw),
            (e.pos.x - p.pos.x) * Math.sin(this.camYaw) + (e.pos.z - p.pos.z) * Math.cos(this.camYaw),
          ),
        };
      });
    let lock: Snapshot['lock'] = null;
    if (this.lockOn && this.lockTarget && this.alive(this.lockTarget)) {
      const s = this.project(this.lockTarget.pos.clone().setY(1.25 * this.lockTarget.scale));
      if (s.on) lock = { x: s.x, y: s.y };
    }
    let perilous: Snapshot['perilous'] = null;
    for (const e of this.enemies) {
      if (e.state === 'attack' && e.anim && e.anim.warn && e.warned && e.hitIdx === 0) {
        const s = this.project(e.pos.clone().setY(2.0 * e.scale));
        perilous = { x: s.x, y: s.y, kind: e.anim.warn.kind, id: e.perilId };
      }
    }
    let prompt = '';
    if (p.state !== 'dead' && !this.rage.on && this.findDeathblowTarget() && p.state !== 'deathblow') prompt = '忍殺 · Klik kiri / J untuk Deathblow';
    else if (
      this.rage.on &&
      !this.rage.aiming &&
      p.state !== 'dead' &&
      (this.rage.keepAlive || this.enemies.some((e) => this.alive(e) && e.hp <= e.hpMax * 0.25))
    ) {
      prompt = '斬 · Klik kanan / F = tebasan terakhir (akhiri slow-mo)';
    }
    return {
      hp: clamp(p.hp / p.hpMax, 0, 1),
      hpMax: p.hpMax,
      posture: clamp(p.posture / this.pEffMax(), 0, 1),
      postureBroken: p.state === 'broken',
      gourds: p.gourds,
      resurrect: p.resurrect,
      enemies,
      lock,
      perilous,
      prompt,
      stageName: this.stage >= 0 && this.stage < STAGES.length ? STAGES[this.stage].name : '',
      stage: this.stage,
      stats: { ...this.stats },
      streak: this.streak,
      dead: p.state === 'dead',
      canRevive: p.state === 'dead' && p.resurrect > 0 && this.deadT > 1.2,
      lockOn: this.lockOn,
      combatMode: this.combatMode,
      rage: this.rageSnapshot(),
      theme: this.theme,
      cine: this.cineW,
      style: { rank: this.styleRank(), pct: this.styleScore / 100, score: this.styleScore },
    };
  }

  revivePlayer() {
    this.revive();
  }
}
