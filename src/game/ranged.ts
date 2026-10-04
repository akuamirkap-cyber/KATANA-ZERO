import type { AnimDef } from './anims';
import { Keyframe, PartialPose, Pose, feetPose as F, mk } from './rig';

/** Grip helper (torso space), same convention as anims.ts. */
const S = (x: number, y: number, z: number, pitch: number, yaw: number, roll = 0, two = 1): PartialPose => ({
  grip: 1, two, sx: x, sy: y, sz: z, sp: pitch, sw: yaw, sr: roll,
});
const HALF_PI = Math.PI / 2;

/**
 * Yumi stance: body turned side-on (angle th), the bow held vertically at arm's length along the line of fire
 * (the bow's forward axis is −th in torso space), the free hand on the string (rig.setDraw moves it).
 */
const bowAt = (th: number, o: PartialPose = {}): Pose =>
  mk({
    torsoX: 0.02, torsoY: th, headY: -th * 0.9, hipYaw: th * 0.45,
    ...S(-0.285 - 0.52 * Math.sin(th), 0.53, 0.52 * Math.cos(th), HALF_PI, -th),
    ...F(0.06, -0.1, 0.8, 0.2),
    ...o,
  });
export const IDLE_BOW = bowAt(0.55);
const DRAW_BOW = bowAt(1.0, { torsoX: -0.05 });
const REL_BOW = bowAt(0.96, { torsoX: -0.1, sp: HALF_PI + 0.12 });

/** Tanegashima matchlock: low-ready, shouldered aim, recoil, reload. */
export const IDLE_GUN = mk({
  torsoX: 0.1, torsoY: -0.2, headY: 0.2, hipYaw: -0.1, ...S(-0.05, 0.35, 0.3, -0.5, 0.2),
  ...F(-0.2, 0.3, 0.8, 0.07),
});
const AIM_GUN = mk({
  torsoX: 0.12, torsoY: -0.3, headX: 0.08, headY: 0.35, hipYaw: -0.15, ...S(-0.08, 0.58, 0.34, 0.03, 0.3),
  ...F(-0.2, 0.3, 0.78, 0.07),
});
const FIRE_GUN = mk({ ...AIM_GUN, torsoX: -0.06, headX: -0.05, ...S(-0.08, 0.6, 0.22, 0.4, 0.3) });
const RELOAD_GUN = mk({
  torsoX: 0.3, torsoY: -0.25, headX: 0.35, ...S(-0.05, 0.25, 0.28, -0.95, 0.25),
  ...F(-0.2, 0.3, 0.8, 0.07),
});

export type RangedAttackName = 'shoot' | 'volley';

export function rangedAttack(name: RangedAttackName, weapon: 'bow' | 'gun'): AnimDef {
  if (weapon === 'bow') {
    const fire = name === 'volley' ? [1.17, 1.5, 1.83] : [1.17];
    const frames: Keyframe[] = [
      { t: 0, p: IDLE_BOW },
      { t: 0.4, p: DRAW_BOW, e: 'out' },
      { t: 1.15, p: DRAW_BOW, e: 'lin' },
    ];
    fire.forEach((t, i) => {
      frames.push({ t: t + 0.04, p: REL_BOW, e: 'in' });
      if (i < fire.length - 1) frames.push({ t: fire[i + 1] - 0.05, p: DRAW_BOW, e: 'out' });
    });
    const end = fire[fire.length - 1];
    frames.push({ t: end + 0.35, p: REL_BOW, e: 'lin' });
    frames.push({ t: end + 0.85, p: IDLE_BOW, e: 'io' });
    return {
      name, dur: end + 0.85, frames, hits: [], trail: [], lunge: [], trackUntil: 1.0, cancelFrom: 99,
      fire, aimT: [0.42, 1.17], ranged: 'bow',
    };
  }
  return {
    name,
    dur: 2.7,
    frames: [
      { t: 0, p: IDLE_GUN },
      { t: 0.42, p: AIM_GUN, e: 'out' },
      { t: 1.02, p: AIM_GUN, e: 'lin' },
      { t: 1.1, p: FIRE_GUN, e: 'in' },
      { t: 1.45, p: FIRE_GUN, e: 'lin' },
      { t: 1.9, p: RELOAD_GUN, e: 'io' },
      { t: 2.25, p: RELOAD_GUN, e: 'lin' },
      { t: 2.7, p: IDLE_GUN, e: 'io' },
    ],
    hits: [], trail: [], lunge: [], trackUntil: 0.88, cancelFrom: 99,
    fire: [1.05], aimT: [0.5, 1.05], ranged: 'gun',
  };
}
