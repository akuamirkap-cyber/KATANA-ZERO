/**
 * Locomotion generator — one continuous gait that morphs walk → run → sprint with speed.
 *
 * Design goals (action-RPG feel, e.g. Black Myth: Wukong):
 *  - long athletic stride with a real flight phase (contact < 50 %) and a high knee drive
 *  - the stance foot travels at exactly body speed (no skating)
 *  - every body motion (pelvis twist, hip drop, bob, arm drive) is PHASE-LOCKED to the feet
 *  - the whole body leans with speed, acceleration (start / brake) and turning
 */
import { LEG_K } from './rig';
const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const sst = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};

export interface Loco {
  phase: number;
  prevPhase: number;
  w: number; // phase-locked layers weight (0 = standing)
  lw: number; // lean layer weight
  active: boolean;
  dx: number; // smoothed local move direction (x = character's left, z = forward)
  dz: number;
  vF: number; // smoothed local velocity
  vS: number;
  aF: number; // smoothed local acceleration
  aS: number;
  sp: number; // smoothed speed
}
export const newLoco = (): Loco => ({
  phase: 0.6, prevPhase: 0.6, w: 0, lw: 0, active: false, dx: 0, dz: 1, vF: 0, vS: 0, aF: 0, aS: 0, sp: 0,
});

export interface FootT {
  x: number;
  z: number;
  lift: number;
  pitch: number;
}
export interface LocoOut {
  feet: [FootT, FootT];
  bob: number;
  sway: number;
  leanF: number;
  roll: number;
  pelvisYaw: number;
  torsoYaw: number;
  hipRoll: number;
  torsoRoll: number;
  arm: number;
  armAmp: number;
  bounce: number;
  run: number;
  spr: number;
  ninja: number;
  duty: number;
}
export const newOut = (): LocoOut => ({
  feet: [
    { x: -0.105, z: 0, lift: 0, pitch: 0 },
    { x: 0.105, z: 0, lift: 0, pitch: 0 },
  ],
  bob: 0, sway: 0, leanF: 0, roll: 0, pelvisYaw: 0, torsoYaw: 0, hipRoll: 0, torsoRoll: 0,
  arm: 0, armAmp: 0, bounce: 0, run: 0, spr: 0, ninja: 0, duty: 0.6,
});

/**
 * @param lvx local lateral velocity (+ = character's left)
 * @param lvz local forward velocity
 */
export function stepLoco(
  L: Loco,
  o: LocoOut,
  dt: number,
  lvx: number,
  lvz: number,
  yawRate: number,
  want: boolean,
  /** body scale: stance width, stride and foot lift all shrink with a smaller fighter */
  bodyK = 1,
) {
  const d = Math.max(dt, 1e-4);
  let sp = Math.hypot(lvx, lvz);
  if (sp > 13) {
    const c = 13 / sp;
    lvx *= c;
    lvz *= c;
    sp = 13;
  }
  // smoothed velocity / acceleration (drives lean)
  const k = 1 - Math.exp(-9 * d);
  const pF = L.vF;
  const pS = L.vS;
  L.vF += (lvz - L.vF) * k;
  L.vS += (lvx - L.vS) * k;
  const ka = 1 - Math.exp(-10 * d);
  L.aF += ((L.vF - pF) / d - L.aF) * ka;
  L.aS += ((L.vS - pS) / d - L.aS) * ka;
  L.sp += (sp - L.sp) * (1 - Math.exp(-10 * d));
  if (sp > 0.4) {
    const kd = 1 - Math.exp(-14 * d);
    L.dx += (lvx / sp - L.dx) * kd;
    L.dz += (lvz / sp - L.dz) * kd;
    const n = Math.hypot(L.dx, L.dz) || 1;
    L.dx /= n;
    L.dz /= n;
  }

  /* ----- body lean: speed + acceleration (start leans in, braking leans back) + turning bank ----- */
  // Raiden-style: the faster he goes the harder he dives forward (≈ 40° at full sprint)
  const leanF = clamp(
    0.05 * Math.max(L.vF, 0) + 0.012 * Math.abs(L.vS) + 0.009 * clamp(L.aF, -45, 45),
    -0.46,
    0.78,
  );
  o.leanF = leanF;
  o.roll = clamp(-(0.024 * L.vS + 0.006 * L.aS) - clamp(yawRate, -8, 8) * L.sp * 0.03, -0.3, 0.3);

  /* ----- gait parameters from speed ----- */
  const v = want ? Math.max(L.sp, 1.0) : L.sp;
  const run = sst(2.4, 5.0, v);
  const spr = sst(5.6, 9.5, v);
  const ninja = sst(3.4, 6.0, v) * (1 - 0.7 * Math.abs(L.dx)); // arms-back "ninja run" (forward running only)
  const adx = Math.abs(L.dx);
  const back = L.dz < -0.3 ? 0.85 : 1;
  const gaitT = sst(1.5, 6.0, v);
  // Stride vs cadence. The foot may reach out to ~60 % of leg length — any further and the thigh goes flat,
  // the IK clamps, and the legs splay. To cover ground the hips also DROP as the stride opens (see o.bob),
  // which is exactly what buys the extra reach — and it reads as a low, predatory ninja run.
  const LEG = 1.05 * bodyK;
  const A = Math.min(clamp(0.34 + 0.085 * v, 0.3, 1.2) * bodyK, 0.66 * LEG) * (1 - 0.3 * adx) * back;
  // a ninja keeps ground contact short: by a sprint the foot is down barely a quarter of the cycle
  const duty = clamp(0.6 - 0.28 * gaitT - 0.08 * spr, 0.24, 0.6);
  const H = (0.1 + 0.32 * run + 0.26 * spr) * (1 + 0.3 * adx) * LEG_K * bodyK; // swing-foot clearance → high knees
  // long strides + a quick, driving cadence. The cap is high enough that a full sprint never outruns the legs
  // (which is what makes feet skate), but low enough that it never becomes a frantic shuffle.
  const freq = want ? clamp((v * duty) / (2 * A), 0.7, 3.7) : 0.9;
  o.run = run;
  o.spr = spr;
  o.ninja = ninja;
  o.duty = duty;

  o.leanF = leanF;
  if (want || L.w > 0.02) {
    L.prevPhase = L.phase;
    L.phase = (L.phase + dt * freq) % 1;
  } else {
    L.prevPhase = L.phase;
  }

  /* ----- foot trajectories ----- */
  const push = 0.55 + 0.3 * run;
  const liftEnd = (0.02 + 0.07 * run) * LEG_K * bodyK;
  const zc = (-0.04 - 0.3 * leanF) * bodyK; // feet trail the hips a little when leaning forward
  for (let i = 0; i < 2; i++) {
    const u = (L.phase + (i === 0 ? 0 : 0.5)) % 1;
    let s: number;
    let lift: number;
    let pitch: number;
    if (u < duty) {
      // stance: heel-strike → flat → heel rises → toe push-off. Foot slides back at body speed.
      const q = u / duty;
      s = 1 - 2 * q;
      const toe = sst(0.62, 1, q);
      lift = liftEnd * toe;
      pitch = -0.32 * (1 - sst(0, 0.3, q)) + push * toe;
    } else {
      // swing: heel flicks up behind the body, knee drives forward, foot paws back slightly before landing
      const w2 = (u - duty) / (1 - duty);
      s = w2 < 0.88 ? -1 + 2.06 * sst(0, 1, w2 / 0.88) : 1.06 - 0.06 * ((w2 - 0.88) / 0.12);
      lift = liftEnd * (1 - sst(0, 0.25, w2)) + H * Math.sin(Math.PI * Math.pow(w2, 0.62));
      pitch = push * (1 - sst(0, 0.5, w2)) - 0.32 * sst(0.45, 1, w2);
    }
    const sA = s > 0 ? s * 0.9 : s * 1.05; // the leg is nearly straight at contact, trails further behind
    const lat = (i === 0 ? -1 : 1) * (0.105 + 0.035 * adx) * bodyK;
    const f = o.feet[i];
    f.x = lat + L.dx * sA * A;
    f.z = zc + L.dz * sA * A;
    f.lift = lift;
    f.pitch = pitch;
  }

  /* ----- phase-locked body motion (right foot forward at phase ≈ 0) ----- */
  const ph = L.phase * TAU;
  const fwdK = Math.abs(L.dz);
  const a = Math.cos(ph - 0.12); // + when the right foot is forward
  const z2 = Math.cos(ph - 0.7 * TAU); // + while the right foot swings (weight on the left leg)
  o.pelvisYaw = (0.07 + 0.1 * run + 0.05 * spr) * a * (0.35 + 0.65 * fwdK);
  o.torsoYaw = -1.35 * o.pelvisYaw * (1 - 0.55 * ninja); // shoulders counter-rotate (calmer when arms are swept back)
  o.hipRoll = (0.035 + 0.03 * run) * z2;
  o.torsoRoll = -0.55 * o.hipRoll;
  o.sway = 0.028 * z2 * (0.6 + 0.4 * run) * bodyK;
  // walking: hips highest over the planted leg · running: a crouch that deepens with speed, plus a real
  // push-off rise through the flight phase — that drive is what makes a run read as a run
  const c4 = Math.cos(2 * TAU * (L.phase - duty / 2));
  o.bob = (-(0.01 + 0.085 * run + 0.075 * spr) + (0.016 + 0.055 * run) * c4 * (1 - 2 * run)) * bodyK;
  // geometry, not taste: with the foot reaching A ahead, the hips must sit low enough for the leg to span
  // sqrt(A² + h²) ≤ 0.95·LEG. Crouch to exactly that whenever the stride demands it, so the knee never locks out.
  const hipNom = 0.88 * LEG;
  const hipMax = Math.sqrt(Math.max(0.04 * LEG * LEG, 0.95 * 0.95 * LEG * LEG - A * A));
  if (hipMax < hipNom) o.bob = Math.min(o.bob, hipMax - hipNom);
  o.arm = Math.cos(ph - 0.05); // + = left arm forward
  o.armAmp = 0.34 + 0.72 * run + 0.35 * spr;
  o.bounce = Math.abs(Math.sin(ph));
}
