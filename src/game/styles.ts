import type { AnimDef } from './anims';
import { IDLE, Keyframe, PartialPose, Pose, feetPose as F, mk } from './rig';

/**
 * FREESTYLE — blade flourishes. Each one is a keyframed pose sequence on the same rig the combat uses, so it
 * blends in/out of the stance automatically. Spins run past 2π and are re-wrapped by the game when they end.
 */
const TAU = Math.PI * 2;
const S = (x: number, y: number, z: number, pitch: number, yaw: number, roll = 0, two = 1): PartialPose => ({
  grip: 1, two, sx: x, sy: y, sz: z, sp: pitch, sw: yaw, sr: roll,
});

export interface StyleDef extends AnimDef {
  label: string;
  sfx: number[];
  streaks: { t: number; ang: number }[];
}

const rest = (spExtra = 0, swExtra = 0): Pose => mk({ sp: IDLE.sp + spExtra, sw: IDLE.sw + swExtra });

const build = (
  label: string,
  frames: Keyframe[],
  trail: [number, number][],
  sfx: number[],
  streaks: { t: number; ang: number }[] = [],
): StyleDef => ({
  name: 'style:' + label,
  label,
  dur: frames[frames.length - 1].t,
  frames,
  hits: [],
  trail,
  lunge: [],
  trackUntil: 0,
  cancelFrom: 99,
  sfx,
  streaks,
});

const ramp = (pose: (v: number) => Pose, from: number, to: number, t0: number, n: number, dt: number): Keyframe[] =>
  Array.from({ length: n }, (_, i) => ({ t: t0 + dt * (i + 1), p: pose(from + ((to - from) * (i + 1)) / n), e: 'lin' as const }));

/* 1 · chiburi — flick the blood off the blade, then settle */
const chA = mk({
  ...S(-0.12, 0.8, 0.32, 1.05, 0.65, 0.4, 0), torsoX: -0.05, torsoY: -0.5, headY: 0.35, hipYaw: -0.2,
  lsX: -0.3, lsZ: 0.5, leX: -0.7, ...F(-0.22, 0.28, 0.8, 0.06),
});
const chB = mk({
  ...S(-0.34, 0.38, 0.3, -0.9, -0.75, -0.4, 0), torsoX: 0.3, torsoY: 0.15, headY: -0.2, hipYaw: 0.15,
  lsX: -0.2, lsZ: 0.55, leX: -0.6, ...F(-0.26, 0.3, 0.78, 0.06),
});
const chC = mk({
  ...S(-0.3, 0.42, 0.3, -0.5, -0.55, -0.3, 0), torsoX: 0.25, torsoY: 0.1, headY: -0.1,
  lsX: -0.2, lsZ: 0.55, leX: -0.6, ...F(-0.26, 0.3, 0.78, 0.06),
});
const chiburi = build(
  'chiburi',
  [
    { t: 0, p: IDLE },
    { t: 0.3, p: chA, e: 'out' },
    { t: 0.4, p: chB, e: 'in' },
    { t: 0.55, p: chC, e: 'out' },
    { t: 1.05, p: chC, e: 'lin' },
    { t: 1.6, p: IDLE, e: 'io' },
  ],
  [[0.32, 0.5]],
  [0.34],
  [{ t: 0.38, ang: 2.4 }],
);

/* 2 · windmill — one-handed vertical blade spin beside the body */
const wm = (sp: number) =>
  mk({
    ...S(-0.52, 0.6, 0.3, sp, 0.04, 0, 0), torsoX: 0.1, torsoY: -0.4, headY: 0.3, hipYaw: -0.2,
    lsX: -0.5, lsZ: 0.7, leX: -0.7, ...F(-0.22, 0.28, 0.8, 0.06),
  });
const wmEnd = IDLE.sp + 2 * TAU;
const windmill = build(
  'windmill',
  [
    { t: 0, p: IDLE },
    { t: 0.22, p: wm(0.2), e: 'out' },
    ...ramp(wm, 0.2, wmEnd, 0.22, 8, 0.1),
    { t: 1.35, p: wm(wmEnd), e: 'lin' },
    { t: 1.85, p: rest(2 * TAU), e: 'io' },
  ],
  [[0.25, 1.1]],
  [0.3, 0.5, 0.7, 0.9],
);

/* 3 · helicopter — blade spun flat above the head */
const hc = (sw: number) =>
  mk({
    ...S(-0.12, 1.04, 0.12, 0.22, sw, 0.2, 0), torsoX: -0.1, torsoY: 0, headX: -0.1,
    lsX: -0.4, lsZ: 0.9, leX: -0.6, ...F(-0.2, 0.25, 0.8, 0.08),
  });
const hcEnd = IDLE.sw + 2 * TAU;
const helicopter = build(
  'helicopter',
  [
    { t: 0, p: IDLE },
    { t: 0.25, p: hc(0.05), e: 'out' },
    ...ramp(hc, 0.05, hcEnd, 0.25, 8, 0.1),
    { t: 1.4, p: hc(hcEnd), e: 'lin' },
    { t: 1.9, p: rest(0, 2 * TAU), e: 'io' },
  ],
  [[0.28, 1.1]],
  [0.32, 0.5, 0.7, 0.9],
);

/* 4 · iai — crouch with the hand on the saya, then a single explosive draw-cut */
const iaiA = mk({
  ...S(0.2, 0.3, 0.26, -0.15, 2.95, 1.5, 0), torsoX: 0.35, torsoY: -0.7, hipYaw: -0.45, headY: 0.5,
  lsX: -0.2, lsZ: 0.4, leX: -0.5, ...F(-0.34, 0.3, 0.66, 0.1), dy: -0.04,
});
const iaiB = mk({
  ...S(-0.22, 0.6, 0.48, 0.0, -1.55, 1.5, 0), torsoX: 0.35, torsoY: 1.0, hipYaw: 0.45, headY: -0.5,
  lsX: -0.3, lsZ: 0.6, leX: -0.6, ...F(-0.4, 0.52, 0.62, 0.1),
});
const iai = build(
  'iai',
  [
    { t: 0, p: IDLE },
    { t: 0.5, p: iaiA, e: 'out' },
    { t: 1.0, p: iaiA, e: 'lin' },
    { t: 1.09, p: iaiB, e: 'in' },
    { t: 1.5, p: iaiB, e: 'lin' },
    { t: 2.1, p: IDLE, e: 'io' },
  ],
  [[1.0, 1.22]],
  [1.03],
  [{ t: 1.08, ang: 0.1 }],
);

/* 5 · figure-eight — fast alternating diagonal cuts */
const f8 = (x: number, sp: number, sw: number, roll: number, ty: number) =>
  mk({
    ...S(x, 0.62, 0.42, sp, sw, roll, 1), torsoX: 0.18, torsoY: ty, hipYaw: ty * 0.5, headY: -ty * 0.4,
    ...F(-0.22, 0.28, 0.78, 0.07),
  });
const f8a = f8(-0.2, 1.0, -0.8, 0.5, -0.5);
const f8b = f8(0.05, 0.2, 0.9, -0.5, 0.5);
const figure8 = build(
  'figure8',
  [
    { t: 0, p: IDLE },
    { t: 0.2, p: f8a, e: 'out' },
    { t: 0.42, p: f8b },
    { t: 0.62, p: f8a },
    { t: 0.82, p: f8b },
    { t: 1.02, p: f8a },
    { t: 1.5, p: IDLE, e: 'io' },
  ],
  [[0.22, 1.1]],
  [0.3, 0.5, 0.7, 0.9],
  [
    { t: 0.4, ang: 2.2 },
    { t: 0.6, ang: 0.8 },
    { t: 0.8, ang: 2.2 },
    { t: 1.0, ang: 0.8 },
  ],
);

/* 6 · jodan — blade held high, the hero pose */
const jo = mk({
  ...S(-0.05, 1.0, 0.05, 1.38, 0.15, 0.2, 1), torsoX: -0.18, torsoY: -0.1, headX: -0.2, headY: 0.1,
  ...F(-0.34, 0.34, 0.8, 0.09), dy: -0.01,
});
const jodan = build(
  'jodan',
  [
    { t: 0, p: IDLE },
    { t: 0.5, p: jo, e: 'out' },
    { t: 2.1, p: jo, e: 'lin' },
    { t: 2.7, p: IDLE, e: 'io' },
  ],
  [],
  [0.45],
);

export const STYLES: StyleDef[] = [chiburi, windmill, helicopter, iai, figure8, jodan];
export const STYLE_CHIBURI = 0;
export const STYLE_JODAN = 5;
