/**
 * Locomotion generator — one continuous gait that morphs walk → run → sprint with speed.
 *
 * Design goals: a readable anime-swordsman run with a forward-driven torso, softly flexed knees and comfortable stride reach.
 * Body motion stays phase-locked to the alternating steps; speed comes from cadence, not extreme leg extension.
 *
 * On top of the steady-state gait the generator also produces the *transients* — the bits that happen between
 * two speeds and that the eye actually reads as weight: push-off (burst), braking (brake) and the rate at which
 * the travel direction swings across the body (cross, i.e. a cut). They feed stride length, cadence, lean,
 * banking, foot placement and the shoulder twist, so accelerating away, hauling up and circling an opponent all
 * look like different movements instead of the same loop at different speeds.
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
  burst: number; // smoothed push-off transient (driving away from a standstill / into a sprint)
  brake: number; // smoothed braking transient (hauling back toward a stop)
  cross: number; // smoothed cut rate: how fast the travel direction swings across the body, rad/s
  pdx: number; // previous travel direction (kept to measure the cut rate)
  pdz: number;
}
export const newLoco = (): Loco => ({
  phase: 0.6, prevPhase: 0.6, w: 0, lw: 0, active: false, dx: 0, dz: 1, vF: 0, vS: 0, aF: 0, aS: 0, sp: 0,
  burst: 0, brake: 0, cross: 0, pdx: 0, pdz: 1,
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
  burst: number; // push-off transient, 0..1
  brake: number; // braking transient, 0..1
  cross: number; // cut rate, rad/s (+ = cutting toward the character's left)
  twist: number; // shoulder wind-up against a hard cut (radians)
  headStab: number; // head pitch that rides out the vertical bounce of the stride
  chinLift: number; // head pitch from speed: chin up when sprinting, tucked when braking
}
export const newOut = (): LocoOut => ({
  feet: [
    { x: -0.105, z: 0, lift: 0, pitch: 0 },
    { x: 0.105, z: 0, lift: 0, pitch: 0 },
  ],
  bob: 0, sway: 0, leanF: 0, roll: 0, pelvisYaw: 0, torsoYaw: 0, hipRoll: 0, torsoRoll: 0,
  arm: 0, armAmp: 0, bounce: 0, run: 0, spr: 0, ninja: 0, duty: 0.6,
  burst: 0, brake: 0, cross: 0, twist: 0, headStab: 0, chinLift: 0,
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

  /* ----- transients: push-off, braking, and the cut ----- */
  // A cut is not the same thing as a turn: strafing around an opponent keeps the body facing him while the
  // travel direction swings underneath, so it is measured from the direction vector rather than from yaw.
  let cutRate = 0;
  if (sp > 0.8) {
    let da = Math.atan2(L.dz, L.dx) - Math.atan2(L.pdz, L.pdx);
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    cutRate = clamp(da / d, -7, 7);
  }
  L.pdx = L.dx;
  L.pdz = L.dz;
  L.burst += (sst(1.6, 8.0, L.aF) - L.burst) * (1 - Math.exp(-12 * d));
  L.brake += (sst(1.6, 9.0, -L.aF) - L.brake) * (1 - Math.exp(-11 * d));
  L.cross += (cutRate - L.cross) * (1 - Math.exp(-9 * d));
  if (!want) {
    // nothing to push off from or cut through while standing: let the transients bleed away
    L.burst *= Math.exp(-8 * d);
    L.cross *= Math.exp(-6 * d);
  }
  if (L.burst < 0.003) L.burst = 0;
  if (L.brake < 0.003) L.brake = 0;
  if (Math.abs(L.cross) < 0.02) L.cross = 0;
  o.burst = L.burst;
  o.brake = L.brake;
  o.cross = L.cross;

  /* ----- mild forward lean and turn response ----- */
  const leanF = clamp(
    0.045 * Math.max(L.vF, 0) +
      0.007 * Math.abs(L.vS) +
      0.002 * clamp(L.aF, -30, 30) +
      0.05 * L.burst -
      0.06 * L.brake,
    -0.14,
    0.62,
  );
  o.leanF = leanF;
  // banking: strafing, body yaw rate, and the cut — a hard change of direction lays the torso into it
  o.roll = clamp(
    -(0.014 * L.vS + 0.003 * L.aS) - clamp(yawRate, -8, 8) * L.sp * 0.012 - L.cross * L.sp * 0.007,
    -0.22,
    0.22,
  );

  /* ----- gait parameters from speed ----- */
  const v = want ? Math.max(L.sp, 1.0) : L.sp;
  const run = sst(2.4, 5.0, v);
  const spr = sst(5.6, 9.5, v);
  const ninja = 0.9 * sst(2.8, 5.2, v) * (1 - 0.7 * Math.abs(L.dx)) * sst(-0.2, 0.8, L.dz); // forward run posture with the sword carried ready
  const adx = Math.abs(L.dx);
  const back = L.dz < -0.3 ? 0.85 : 1;
  const gaitT = sst(1.5, 6.0, v);
  // Keep each step inside the leg's comfortable range; a slightly quicker cadence is preferable to a locked knee.
  const LEG = 1.05 * bodyK;
  // a push-off lengthens the first strides, a brake shortens them (and the leading foot plants further out
  // front, below, so the body has something to stop against)
  const A =
    Math.min(clamp(0.2 + 0.045 * v, 0.18, 0.68) * bodyK, 0.42 * LEG) *
    (1 - 0.18 * adx) *
    back *
    (1 + 0.16 * L.burst - 0.1 * L.brake);
  const duty = clamp(0.62 - 0.22 * gaitT - 0.2 * spr, 0.24, 0.62);
  const H = (0.06 + 0.18 * run + 0.11 * spr) * (1 + 0.2 * adx) * LEG_K * bodyK;
  const cadenceFloor = 0.7 / Math.max(0.25, bodyK);
  // breaking away also quickens the cadence for a couple of steps
  const freq = want ? clamp((v * duty) / (2 * A), cadenceFloor, 4.8) * (1 + 0.12 * L.burst) : 0.9 / Math.max(0.25, bodyK);
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
  const push = 0.32 + 0.16 * run;
  const liftEnd = (0.015 + 0.045 * run) * LEG_K * bodyK;
  const zc = (-0.02 - 0.14 * leanF) * bodyK; // keep the feet near the hips
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
      pitch = -0.22 * (1 - sst(0, 0.3, q)) + push * toe;
    } else {
      // swing: heel flicks up behind the body, knee drives forward, foot paws back slightly before landing
      const w2 = (u - duty) / (1 - duty);
      s = w2 < 0.88 ? -1 + 2.06 * sst(0, 1, w2 / 0.88) : 1.06 - 0.06 * ((w2 - 0.88) / 0.12);
      lift = liftEnd * (1 - sst(0, 0.25, w2)) + H * Math.sin(Math.PI * Math.pow(w2, 0.62));
      pitch = push * (1 - sst(0, 0.5, w2)) - 0.22 * sst(0.45, 1, w2);
    }
    const sA = s * (s > 0 ? 0.86 : 0.9);
    const lat = (i === 0 ? -1 : 1) * (0.09 + 0.025 * adx) * bodyK;
    // crossover step: cutting across the body puts the *swinging* foot down toward the new direction,
    // while the planted foot only shifts a quarter of the way (it is still carrying the weight)
    const crossStep = (u >= duty ? 1 : 0.25) * clamp(L.cross * 0.018, -0.09, 0.09) * bodyK;
    // braking brace: only the foot already in front reaches further out
    const brace = s > 0 ? 0.08 * L.brake * bodyK : 0;
    const f = o.feet[i];
    f.x = lat + L.dx * (sA * A + brace) + crossStep;
    f.z = zc + L.dz * (sA * A + brace);
    f.lift = lift;
    f.pitch = pitch;
  }

  /* ----- phase-locked body motion (right foot forward at phase ≈ 0) ----- */
  const ph = L.phase * TAU;
  const fwdK = Math.abs(L.dz);
  const a = Math.cos(ph - 0.12); // + when the right foot is forward
  const z2 = Math.cos(ph - 0.7 * TAU); // + while the right foot swings (weight on the left leg)
  o.pelvisYaw = (0.035 + 0.065 * run + 0.035 * spr) * a * (0.35 + 0.65 * fwdK);
  o.torsoYaw = -0.8 * o.pelvisYaw;
  o.hipRoll = (0.02 + 0.025 * run) * z2;
  o.torsoRoll = -0.45 * o.hipRoll;
  o.sway = 0.016 * z2 * (0.6 + 0.4 * run) * bodyK;
  const c4 = Math.cos(2 * TAU * (L.phase - duty / 2));
  // Small spring only: no sustained crouch, with compact strides keeping the knee naturally bent.
  o.bob = (-(0.005 + 0.012 * run + 0.01 * spr) + (0.012 + 0.018 * run) * c4 * (1 - 2 * run)) * bodyK;
  o.arm = Math.cos(ph - 0.05); // + = left arm forward
  o.armAmp = 0.22 + 0.38 * run + 0.12 * spr + 0.16 * L.burst; // the arms pump when breaking away
  o.bounce = 0.7 * Math.abs(Math.sin(ph));

  /* ----- detail layers driven by the transients ----- */
  // the shoulders wind up against a hard cut and unwrap a beat later: the twist lag that makes a change of
  // direction readable from behind instead of looking like the whole model was simply rotated
  o.twist = clamp(-L.cross * (0.32 + 0.11 * L.sp), -0.34, 0.34);
  // the head rides out the vertical bounce of the stride (stabilisation) and answers speed with the chin:
  // lifted while sprinting or driving off, tucked toward the chest while braking. headX negative = looking up.
  o.headStab = clamp(o.bob * 1.05, -0.032, 0.032); // kept small so it tracks the bounce instead of pinning
  o.chinLift = -(0.02 * spr + 0.03 * L.burst - 0.035 * L.brake);
}
