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
 *
 * The target gait is a nimble, monkey-quick run: short committed strides that turn over fast, a low forward-
 * folded sprint with the hips dropped, real flight time between steps, wide arm swing and a shoulder line that
 * rocks against it. Speed therefore reads as *quicker steps and a lower body*, not as bigger steps.
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
  if (sp > 14.5) {
    const c = 14.5 / sp;
    lvx *= c;
    lvz *= c;
    sp = 14.5;
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

  /* ----- turn response ----- */
  // banking: strafing, body yaw rate, and the cut — a hard change of direction lays the torso into it
  o.roll = clamp(
    -(0.014 * L.vS + 0.003 * L.aS) - clamp(yawRate, -8, 8) * L.sp * 0.012 - L.cross * L.sp * 0.007,
    -0.22,
    0.22,
  );

  /* ----- gait parameters from speed ----- */
  const v = want ? Math.max(L.sp, 1.0) : L.sp;
  // The run and the sprint are deliberately separate animals: the run layer is full by 5.5 m/s, the sprint
  // layer only starts at 8.2 and is full by 13.5, so letting go of sprint visibly changes the whole body
  // instead of just sliding along the same curve.
  const run = sst(2.2, 5.5, v);
  const spr = sst(8.2, 13.5, v);
  const ninja = 0.9 * sst(6.5, 12.5, v) * (1 - 0.7 * Math.abs(L.dx)) * sst(-0.2, 0.8, L.dz); // folded sprint posture
  const adx = Math.abs(L.dx);
  const back = L.dz < -0.3 ? 0.85 : 1;
  const gaitT = sst(1.5, 6.5, v);
  // Strides stay short and the cadence does the work: that is what makes the run read as nimble rather than
  // as a long-strided gallop. `freq` below is derived from stride and stance time, so the planted foot still
  // sweeps back at exactly body speed — shorter steps mean quicker steps, never sliding feet.
  const LEG = 1.05 * bodyK;
  // a push-off lengthens the first strides, a brake shortens them (and the leading foot plants further out
  // front, below, so the body has something to stop against)
  const A =
    Math.min(clamp(0.19 + 0.04 * v, 0.17, 0.66) * bodyK, 0.38 * LEG) *
    (1 - 0.18 * adx) *
    back *
    (1 + 0.16 * L.burst - 0.1 * L.brake);
  // less time on the ground as speed builds: the sprint spends real time in the air between steps
  const duty = clamp(0.61 - 0.2 * gaitT - 0.22 * spr, 0.23, 0.61);
  const H = (0.055 + 0.17 * run + 0.15 * spr) * (1 + 0.2 * adx) * LEG_K * bodyK;
  const cadenceFloor = 0.7 / Math.max(0.25, bodyK);
  // breaking away also quickens the cadence for a couple of steps
  const freq = want ? clamp((v * duty) / (2 * A), cadenceFloor, 5.4) * (1 + 0.14 * L.burst) : 0.9 / Math.max(0.25, bodyK);

  /* ----- forward lean: speed, the sprint fold, push-off and braking ----- */
  const leanF = clamp(
    0.042 * Math.max(L.vF, 0) +
      0.1 * spr +
      0.008 * Math.abs(L.vS) +
      0.002 * clamp(L.aF, -30, 30) +
      0.06 * L.burst -
      0.07 * L.brake,
    -0.16,
    0.65,
  );
  o.leanF = leanF;
  o.run = run;
  o.spr = spr;
  o.ninja = ninja;
  o.duty = duty;
  if (want || L.w > 0.02) {
    L.prevPhase = L.phase;
    L.phase = (L.phase + dt * freq) % 1;
  } else {
    L.prevPhase = L.phase;
  }

  /* ----- foot trajectories ----- */
  const push = 0.3 + 0.18 * run + 0.16 * spr; // the ankle extends hard off the toe at a sprint
  const liftEnd = (0.014 + 0.04 * run + 0.03 * spr) * LEG_K * bodyK;
  const swingK = 0.62 - 0.14 * spr; // the knee snaps through faster the quicker the run
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
      lift = liftEnd * (1 - sst(0, 0.25, w2)) + H * Math.sin(Math.PI * Math.pow(w2, swingK));
      pitch = push * (1 - sst(0, 0.5, w2)) - 0.22 * sst(0.45, 1, w2);
    }
    // Normalised so the stance sweep is exactly 2A: `freq` below is derived from that sweep, so a planted foot
    // travels backward at precisely the body speed and never skates. The front/back split is kept (the step
    // reaches a touch further behind the hip than in front of it) — it just no longer shortens the stride.
    const sA = s * (s > 0 ? 0.977 : 1.023);
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
  o.pelvisYaw = (0.04 + 0.075 * run + 0.05 * spr) * a * (0.35 + 0.65 * fwdK);
  o.torsoYaw = -0.95 * o.pelvisYaw; // the shoulders answer the hips harder: the twist that reads as athletic
  o.hipRoll = (0.022 + 0.028 * run + 0.018 * spr) * z2;
  o.torsoRoll = -0.5 * o.hipRoll;
  o.sway = 0.016 * z2 * (0.6 + 0.4 * run + 0.35 * spr) * bodyK;
  const c4 = Math.cos(2 * TAU * (L.phase - duty / 2));
  // The hips drop as speed builds (a coiled, low sprint) and bound twice per cycle — down through mid-stance,
  // up through the flight phase. That vertical travel is most of what makes a run feel alive instead of gliding.
  const bounceAmp = 0.012 + 0.014 * run + 0.014 * spr;
  const bounceSign = 1 - 2 * Math.max(run, spr * 0.9);
  o.bob = (-(0.006 + 0.011 * run + 0.018 * spr) + bounceAmp * c4 * bounceSign) * bodyK;
  o.arm = Math.cos(ph - 0.05); // + = left arm forward
  o.armAmp = 0.24 + 0.44 * run + 0.2 * spr + 0.18 * L.burst; // wide swing; the arms pump when breaking away
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
