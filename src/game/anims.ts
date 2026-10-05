import { IDLE, Keyframe, PartialPose, Pose, feetPose as F, mk } from './rig';

/**
 * Sword grip helper (torso space):
 * x,y,z = grip point · pitch/yaw = blade direction · roll = edge twist · two = left hand joins the handle.
 */
const S = (x: number, y: number, z: number, pitch: number, yaw: number, roll = 0, two = 1): PartialPose => ({
  grip: 1, two, sx: x, sy: y, sz: z, sp: pitch, sw: yaw, sr: roll,
});

/* ---------- static poses ---------- */
const IDLE_E = mk({
  torsoX: 0.1, torsoY: -0.22, headY: 0.2, hipYaw: -0.1, ...S(-0.04, 0.52, 0.42, 0.62, 0.05, 0),
  ...F(-0.2, 0.3, 0.8, 0.06),
});

export const P = {
  idle: IDLE,
  idleE: IDLE_E,
  guard: mk({
    torsoX: 0.15, torsoY: -0.15, headY: 0.15, hipYaw: -0.08, ...S(0.0, 0.68, 0.38, 1.35, 0.1, 0.2),
    ...F(-0.24, 0.28, 0.78, 0.07),
  }),
  kickA: mk({
    torsoX: 0.22, torsoY: 0.45, hipYaw: 0.2, headY: -0.2, ...S(-0.05, 0.78, 0.32, 1.0, 0.75, 0.6),
    ...F(-0.3, 0.2, 0.8, 0.07),
  }),
  kickB: mk({
    torsoX: 0.22, torsoY: -0.55, hipYaw: -0.25, headY: 0.3, ...S(-0.2, 0.72, 0.34, 1.0, -0.55, -0.5),
    ...F(-0.28, 0.22, 0.8, 0.07),
  }),
  hurt: mk({
    torsoX: -0.45, torsoY: 0.2, headX: -0.35, hipX: -0.1, grip: 0,
    rsX: -0.3, rsZ: 0.1, reX: -0.9, lsX: 0.3, lsZ: 0.5, leX: -0.5,
    ...F(-0.36, 0.12, 0.82, 0.08),
  }),
  broken: mk({
    torsoX: 0.85, torsoY: 0, headX: 0.35, headY: 0, grip: 0, plant: 0.5,
    rsX: -0.2, rsZ: 0.05, reX: -0.5, wrX: 0.4, lsX: 0, lsZ: 0.3, leX: -0.4,
    rhX: -1.2, rkX: 2.4, lhX: -1.5, lkX: 2.7, dy: -0.1,
  }),
  deflected: mk({
    torsoX: -0.3, torsoY: 0.3, headX: -0.2, hipYaw: 0.1, ...S(-0.3, 0.95, 0.15, 1.3, -0.6, 0.4, 0.2),
    ...F(-0.34, 0.14, 0.82, 0.08),
  }),
  stagger: mk({
    torsoX: 0.9, torsoY: 0.2, headX: 0.4, grip: 0,
    rsX: 0.2, rsZ: 0.1, reX: -0.4, lsX: 0.1, lsZ: 0.4, leX: -0.3,
    rhX: 0.6, rkX: 0.1, lhX: -0.8, lkX: 0.9,
  }),
  dodge: mk({
    torsoX: 0.55, torsoY: -0.2, headX: -0.4, hipYaw: -0.1, ...S(-0.28, 0.4, 0.26, 0.55, -0.35, 0.3, 0),
    lsX: 0.2, lsZ: 0.5, leX: -0.5,
    ...F(-0.22, 0.22, 0.6, 0.12),
  }),
  jump: mk({
    torsoX: 0.3, torsoY: -0.15, ...S(-0.15, 0.7, 0.25, 0.8, -0.4, 0, 0), plant: 0,
    lsX: -1.1, lsZ: 0.6, leX: -1.0,
    rhX: -0.6, rkX: 1.6, lhX: -1.3, lkX: 1.9,
  }),
  heal: mk({
    torsoX: -0.18, torsoY: 0.05, headX: -0.45, headY: 0, grip: 0,
    rsX: -0.7, rsZ: 0.1, reX: -0.8, lsX: -2.3, lsZ: 0.2, leX: -2.1,
    ...F(-0.2, 0.18, 0.82, 0.07),
  }),
  // Flying Swallow: body stretched toward the target, blade driven forward-down, legs trailing
  dive: mk({
    torsoX: 0.55, torsoY: -0.1, headX: -0.25, headY: 0, hipX: 0.2, ...S(-0.06, 0.5, 0.52, -0.72, 0.02, 0.2), plant: 0,
    lsX: -1.0, lsZ: 0.3, leX: -0.5,
    rhX: 0.55, rkX: 1.1, lhX: 0.2, lkX: 0.9,
  }),
  // tucked mid-air pose used while somersaulting
  tuck: mk({
    torsoX: 0.55, torsoY: -0.1, headX: 0.35, ...S(-0.2, 0.55, 0.3, 0.9, -0.3, 0, 0), plant: 0,
    lsX: -1.3, lsZ: 0.45, leX: -1.6,
    rhX: -1.5, rkX: 2.3, lhX: -1.7, lkX: 2.5,
  }),
  stomp: mk({
    torsoX: 0.4, torsoY: 0.3, headX: 0.15, ...S(-0.2, 0.85, 0.2, 1.0, -0.6), plant: 0.3,
    rhX: 0.9, rkX: 0.2, lhX: -1.5, lkX: 0.2,
  }),
  // thrown backwards by a kick: chest caved, arms flung wide, legs buckling
  kicked: mk({
    torsoX: -0.6, torsoY: 0.12, headX: -0.5, hipX: -0.22, grip: 0, plant: 0, dy: -0.1,
    rsX: -0.2, rsZ: 1.0, reX: -0.5, lsX: -0.25, lsZ: 1.1, leX: -0.4,
    rhX: 0.25, rkX: 0.55, rhZ: -0.12, lhX: -0.3, lkX: 0.65, lhZ: 0.12,
  }),
  dead: mk({
    torsoX: -0.2, headX: -0.3, grip: 0,
    rsX: 0.3, rsZ: -0.6, reX: -0.3, lsX: 0.2, lsZ: 0.8, leX: -0.3,
    rhX: 0.1, rkX: 0.1, lhX: -0.1, lkX: 0.1,
  }),
};

/** Blade-mode stance: coiled low, katana drawn back at the side, ready to flash through the target. */
export const AIM_POSE = mk({
  torsoX: 0.3, torsoY: -0.85, headX: 0.05, headY: 0.55, hipYaw: -0.3,
  ...S(-0.32, 0.5, 0.06, 0.22, -1.5, 0.9, 0),
  lsX: -0.35, lsZ: 0.55, leX: -1.0,
  ...F(-0.14, 0.34, 0.74, 0.1), dy: -0.08,
});

/* ---------- slash segments ---------- */
export type Variant = 'diag' | 'ldiag' | 'rise' | 'horz' | 'over' | 'spin';
interface Seg {
  W: Pose; // wind-up
  M?: Pose; // mid (spin only)
  S: Pose; // strike end
  F: Pose; // follow-through
  hitAt: number; // fraction of the strike when damage lands
  arc: number; // hit arc (degrees)
  turns: number;
  ang: number; // orientation of the cut line as seen from behind the attacker (math angle, y up)
}
const SEG: Record<Variant, Seg> = {
  // kesa-giri: from behind the right shoulder → down across to the left hip; lead foot (left) lunges
  diag: {
    W: mk({
      ...S(-0.2, 0.98, 0.0, 1.25, -0.9, 0.5), torsoX: -0.1, torsoY: -0.75, hipYaw: -0.3, headY: 0.5,
      ...F(-0.32, 0.08, 0.78, 0.07), ll: 0.07,
    }),
    S: mk({
      ...S(0.0, 0.42, 0.45, -0.6, 0.55, 0.6), torsoX: 0.5, torsoY: 0.6, hipYaw: 0.35, headY: -0.3,
      ...F(-0.4, 0.5, 0.66, 0.07),
    }),
    F: mk({
      ...S(0.05, 0.35, 0.5, -0.8, 0.7, 0.6), torsoX: 0.55, torsoY: 0.65, hipYaw: 0.4, headY: -0.3,
      ...F(-0.42, 0.52, 0.66, 0.07),
    }),
    hitAt: 1, arc: 140, turns: 0, ang: 0.72,
  },
  // hidari-kesa: the mirror cut — from the high left shoulder down to the low right
  ldiag: {
    W: mk({
      ...S(0.12, 0.98, 0.0, 1.25, 0.9, -0.5), torsoX: -0.1, torsoY: 0.75, hipYaw: 0.3, headY: -0.5,
      ...F(-0.32, 0.08, 0.78, 0.07), ll: 0.07,
    }),
    S: mk({
      ...S(-0.22, 0.42, 0.45, -0.6, -0.55, -0.6), torsoX: 0.5, torsoY: -0.6, hipYaw: -0.35, headY: 0.3,
      ...F(-0.4, 0.5, 0.66, 0.07),
    }),
    F: mk({
      ...S(-0.27, 0.35, 0.5, -0.8, -0.7, -0.6), torsoX: 0.55, torsoY: -0.65, hipYaw: -0.4, headY: 0.3,
      ...F(-0.42, 0.52, 0.66, 0.07),
    }),
    hitAt: 1, arc: 140, turns: 0, ang: 2.4,
  },
  // gyaku-kesa: reverse rising cut from the low left up to the right shoulder; rear foot slides through
  rise: {
    W: mk({
      ...S(0.22, 0.3, 0.3, -0.9, 0.85, -0.5), torsoX: 0.45, torsoY: 0.7, hipYaw: 0.35, headY: -0.4,
      ...F(-0.15, 0.3, 0.7, 0.07), rl: 0.06,
    }),
    S: mk({
      ...S(-0.12, 0.78, 0.3, 1.1, -0.75, -0.5), torsoX: -0.12, torsoY: -0.7, hipYaw: -0.4, headY: 0.4,
      ...F(0.45, -0.25, 0.7, 0.07),
    }),
    F: mk({
      ...S(-0.15, 0.88, 0.22, 1.3, -0.8, -0.5), torsoX: -0.15, torsoY: -0.75, hipYaw: -0.45, headY: 0.4,
      ...F(0.47, -0.27, 0.7, 0.07),
    }),
    hitAt: 1, arc: 140, turns: 0, ang: 0.55,
  },
  // yoko-ichimonji: wide flat slash right → left from a low, wide stance
  horz: {
    W: mk({
      ...S(-0.3, 0.58, 0.3, 0.05, -1.55, 1.5), torsoX: 0.15, torsoY: -1.0, hipYaw: -0.4, headY: 0.7,
      ...F(0.3, -0.2, 0.68, 0.14), rl: 0.05,
    }),
    S: mk({
      ...S(0.05, 0.6, 0.42, 0, 1.35, 1.5), torsoX: 0.3, torsoY: 0.95, hipYaw: 0.4, headY: -0.5,
      ...F(-0.3, 0.45, 0.64, 0.16),
    }),
    F: mk({
      ...S(0.1, 0.6, 0.42, -0.05, 1.6, 1.5), torsoX: 0.3, torsoY: 1.05, hipYaw: 0.45, headY: -0.6,
      ...F(-0.32, 0.47, 0.64, 0.16),
    }),
    hitAt: 1, arc: 170, turns: 0, ang: 0.04,
  },
  // shomen-giri: blade overhead, planar chop straight down with a deep lunge (heavy)
  over: {
    W: mk({
      ...S(-0.05, 0.95, -0.05, 2.3, 0), torsoX: -0.35, torsoY: -0.1, headX: -0.2, hipYaw: 0,
      ...F(-0.3, 0.12, 0.8, 0.07), ll: 0.09,
    }),
    S: mk({
      ...S(-0.03, 0.42, 0.48, -0.7, 0), torsoX: 0.8, torsoY: 0, headX: 0.2, hipYaw: 0,
      ...F(-0.45, 0.58, 0.6, 0.07),
    }),
    F: mk({
      ...S(-0.03, 0.32, 0.5, -1.0, 0), torsoX: 0.85, torsoY: 0, headX: 0.2, hipYaw: 0,
      ...F(-0.46, 0.6, 0.6, 0.07),
    }),
    hitAt: 1, arc: 130, turns: 0, ang: 1.55,
  },
  // kaiten-giri: full 360° spinning slash (the body itself rotates)
  spin: {
    W: mk({
      ...S(-0.38, 0.58, 0.15, 0.0, -2.0, 1.5), torsoX: 0.2, torsoY: -1.3, hipYaw: -0.5, headY: 0.8,
      ...F(-0.28, 0.28, 0.7, 0.12),
    }),
    M: mk({
      ...S(0.1, 0.6, 0.45, 0, 0.2, 1.5), torsoX: 0.25, torsoY: 0.2, hipYaw: 0.1, headY: -0.2,
      ...F(-0.28, 0.28, 0.7, 0.12),
    }),
    S: mk({
      ...S(0.15, 0.6, 0.35, 0, 1.4, 1.5), torsoX: 0.3, torsoY: 0.9, hipYaw: 0.4, headY: -0.6,
      ...F(-0.28, 0.3, 0.68, 0.14),
    }),
    F: mk({
      ...S(0.1, 0.58, 0.4, -0.05, 1.5, 1.5), torsoX: 0.3, torsoY: 0.95, hipYaw: 0.4, headY: -0.6,
      ...F(-0.28, 0.3, 0.68, 0.14),
    }),
    hitAt: 0.5, arc: 250, turns: 1, ang: 0.0,
  },
};

/**
 * Arc bulge: while the blade travels, the hands push outward at mid-swing and come back in at the end —
 * the tip follows a true circular arc instead of a straight chord (peaks at mid-travel of the eased strike).
 */
const ARC: Record<Variant, PartialPose> = {
  diag: { sz: 0.12, sx: -0.05 },
  ldiag: { sz: 0.12, sx: 0.05 },
  rise: { sz: 0.1, sx: -0.04 },
  horz: { sz: 0.12, sy: 0.03 },
  over: { sz: 0.16 },
  spin: {},
};

export interface HitDef {
  t: number;
  dmg: number;
  post: number;
  reach: number;
  arc: number;
  kind: 'slash' | 'thrust' | 'sweep' | 'kick';
  heavy?: boolean;
  ang?: number;
}
export interface SpinDef {
  t0: number;
  t1: number;
  turns: number;
}
export interface ArcDef {
  t0: number;
  t1: number;
  d: PartialPose;
}
export interface AnimDef {
  name: string;
  dur: number;
  frames: Keyframe[];
  hits: HitDef[];
  trail: [number, number][];
  lunge: { t0: number; t1: number; dist: number }[];
  spins?: SpinDef[];
  arcs?: ArcDef[];
  trackUntil: number;
  warn?: { t: number; kind: 'thrust' | 'sweep' };
  cancelFrom: number;
  followT?: number;
  /** ranged attacks: times at which a projectile leaves the muzzle */
  fire?: number[];
  /** ranged attacks: [telegraph start, first shot] */
  aimT?: [number, number];
  ranged?: 'bow' | 'gun';
}

/** Adds the arc bulge on top of a sampled pose. */
export function applyArcs(a: AnimDef, t: number, out: Pose) {
  if (!a.arcs) return;
  for (const ar of a.arcs) {
    if (t <= ar.t0 || t >= ar.t1) continue;
    const u = (t - ar.t0) / (ar.t1 - ar.t0);
    const s = Math.sin(Math.PI * u * u * u);
    for (const k of Object.keys(ar.d)) {
      const key = k as keyof Pose;
      out[key] += (ar.d[key] as number) * s;
    }
  }
}

interface SlashSpec {
  v: Variant;
  windup: number;
  strike: number;
  recover: number;
  dmg: number;
  post: number;
  heavy?: boolean;
  reach?: number;
  lunge?: number;
}

/** Slight "coil" before the windup (anticipation) — makes strikes feel snappier. */
function coil(W: Pose): Pose {
  const o = { ...W };
  o.torsoY = W.torsoY * 1.1;
  o.hipYaw = W.hipYaw * 1.15;
  o.torsoX = W.torsoX - 0.06;
  o.dy = W.dy - 0.03;
  o.sy = W.sy + 0.03;
  return o;
}

function buildSlashes(name: string, from: Pose, specs: SlashSpec[], trackUntil: number, endPose: Pose, tail = 0): AnimDef {
  const frames: Keyframe[] = [{ t: 0, p: from }];
  const hits: HitDef[] = [];
  const trail: [number, number][] = [];
  const lunge: AnimDef['lunge'] = [];
  const spins: SpinDef[] = [];
  const arcs: ArcDef[] = [];
  let t = 0;
  let lastHit = 0;
  specs.forEach((s, i) => {
    const seg = SEG[s.v];
    const strike = s.v === 'spin' ? Math.max(0.3, s.strike * 3) : s.strike;
    const wEnd = t + s.windup;
    frames.push({ t: wEnd - s.windup * 0.2, p: coil(seg.W), e: 'out' });
    frames.push({ t: wEnd, p: seg.W, e: 'io' });
    const hitT = wEnd + strike * seg.hitAt;
    if (seg.M) {
      frames.push({ t: hitT, p: seg.M, e: 'lin' });
      frames.push({ t: wEnd + strike, p: seg.S, e: 'out' });
    } else {
      frames.push({ t: wEnd + strike, p: seg.S, e: 'in' });
      arcs.push({ t0: wEnd, t1: wEnd + strike, d: ARC[s.v] });
    }
    hits.push({ t: hitT, dmg: s.dmg, post: s.post, reach: s.reach ?? 2.7, arc: seg.arc, kind: 'slash', heavy: s.heavy, ang: seg.ang });
    trail.push([wEnd - 0.02, wEnd + strike + 0.1]);
    lunge.push({ t0: wEnd, t1: wEnd + strike * (s.v === 'spin' ? 0.6 : 1), dist: s.lunge ?? 1.0 });
    if (seg.turns) spins.push({ t0: wEnd, t1: wEnd + strike, turns: seg.turns });
    const endStrike = wEnd + strike;
    lastHit = endStrike;
    const isLast = i === specs.length - 1;
    const rec = s.recover;
    frames.push({ t: endStrike + rec * 0.3, p: seg.F, e: 'out' });
    t = endStrike + (isLast ? rec : rec * 0.3);
    if (isLast) frames.push({ t: t + tail, p: endPose, e: 'io' });
  });
  const dur = t + tail;
  return { name, dur, frames, hits, trail, lunge, spins, arcs, trackUntil, cancelFrom: lastHit + 0.05 };
}

/* ---------- player combo : 5 different cuts, each flowing from the previous one ---------- */
export const PLAYER_COMBO: AnimDef[] = [
  buildSlashes('A1 kesa', P.guard, [{ v: 'diag', windup: 0.12, strike: 0.08, recover: 0.42, dmg: 16, post: 14, lunge: 1.1 }], 0, P.idle),
  buildSlashes('A2 gyaku', SEG.diag.F, [{ v: 'rise', windup: 0.1, strike: 0.08, recover: 0.42, dmg: 16, post: 15, lunge: 1.0 }], 0, P.idle),
  buildSlashes('A3 yoko', SEG.rise.F, [{ v: 'horz', windup: 0.11, strike: 0.08, recover: 0.42, dmg: 17, post: 15, lunge: 1.0 }], 0, P.idle),
  buildSlashes('A4 kaiten', SEG.horz.F, [{ v: 'spin', windup: 0.16, strike: 0.1, recover: 0.5, dmg: 20, post: 22, lunge: 0.7, reach: 3.0 }], 0, P.idle),
  buildSlashes('A5 shomen', SEG.spin.F, [{ v: 'over', windup: 0.26, strike: 0.09, recover: 0.62, dmg: 30, post: 26, heavy: true, lunge: 1.6 }], 0, P.idle),
];
PLAYER_COMBO.forEach((a, i) => {
  a.cancelFrom = a.hits[0].t + (i === 3 ? 0.12 : 0.03);
});

/* ---------- blade-mode precision cut: the cut pose follows the angle of the line the player drew ---------- */
export function variantForAngle(a: number): Variant {
  let x = a % Math.PI;
  if (x < 0) x += Math.PI;
  if (x < 0.4 || x > 2.74) return 'horz';
  if (x > 1.17 && x < 1.97) return 'over';
  return x < 1.17 ? 'diag' : 'ldiag';
}
export function buildCut(angle: number): AnimDef {
  const v = variantForAngle(angle);
  const seg = SEG[v];
  return {
    name: 'cut',
    dur: 0.5,
    frames: [
      { t: 0, p: AIM_POSE },
      { t: 0.05, p: seg.W, e: 'out' },
      { t: 0.11, p: seg.S, e: 'in' },
      { t: 0.27, p: seg.F, e: 'out' },
      { t: 0.5, p: P.idle, e: 'io' },
    ],
    hits: [],
    trail: [[0.04, 0.34]],
    lunge: [],
    arcs: [{ t0: 0.05, t1: 0.11, d: ARC[v] }],
    trackUntil: 0,
    cancelFrom: 99,
  };
}

/* ---------- player deathblow ---------- */
export const DEATHBLOW: AnimDef = (() => {
  const W = mk({
    ...S(-0.05, 0.95, -0.05, 2.3, 0), torsoX: -0.4, headX: -0.2, torsoY: 0, hipYaw: 0,
    ...F(-0.3, 0.12, 0.74, 0.07), ll: 0.08,
  });
  const St = mk({
    ...S(-0.05, 0.5, 0.45, -1.3, 0), torsoX: 0.95, headX: 0.2, torsoY: 0, hipYaw: 0,
    ...F(-0.48, 0.6, 0.58, 0.07),
  });
  return {
    name: 'deathblow',
    dur: 1.25,
    frames: [
      { t: 0, p: P.guard },
      { t: 0.3, p: W, e: 'out' },
      { t: 0.4, p: St, e: 'in' },
      { t: 0.95, p: St, e: 'lin' },
      { t: 1.25, p: P.idle, e: 'io' },
    ],
    hits: [{ t: 0.4, dmg: 0, post: 0, reach: 3, arc: 180, kind: 'slash', heavy: true }],
    trail: [[0.32, 0.55]],
    lunge: [],
    trackUntil: 0,
    cancelFrom: 99,
  };
})();

/* ---------- hard kick (teep / door-breaker): rear leg chambers high, then drives through the chest ---------- */
const KCH = mk({
  torsoX: 0.05, torsoY: -0.1, headY: 0.1, hipX: 0.1, hipYaw: -0.05,
  ...S(-0.32, 0.42, 0.0, 0.25, -1.1, 0.3, 0),
  lsX: -1.25, lsZ: 0.35, leX: -0.7,
  rhX: 1.55, rkX: 2.0, rhZ: -0.1, lhX: -0.2, lkX: 0.6, lhZ: 0.08, plant: 0, rl: 0, ll: 0, dy: -0.06,
});
const KST = mk({
  torsoX: -0.32, torsoY: 0.1, headX: 0.1, headY: 0.05, hipX: -0.25, hipYaw: 0.05,
  ...S(-0.38, 0.5, -0.1, 0.35, -1.25, 0.3, 0),
  lsX: -1.5, lsZ: 0.5, leX: -0.5,
  rhX: 1.42, rkX: 0.15, rhZ: -0.06, lhX: -0.32, lkX: 0.85, lhZ: 0.08, plant: 0, rl: 0, ll: 0, dy: -0.04,
});
export const KICK: AnimDef = {
  name: 'kick',
  dur: 0.86,
  frames: [
    { t: 0, p: P.guard },
    { t: 0.15, p: KCH, e: 'out' },
    { t: 0.235, p: KST, e: 'in' },
    { t: 0.36, p: KST, e: 'lin' },
    { t: 0.62, p: KCH, e: 'io' },
    { t: 0.86, p: P.idle, e: 'io' },
  ],
  hits: [{ t: 0.235, dmg: 7, post: 36, reach: 2.4, arc: 90, kind: 'kick', heavy: true }],
  trail: [],
  lunge: [{ t0: 0.12, t1: 0.235, dist: 1.5 }],
  trackUntil: 0,
  cancelFrom: 0.5,
};

/* ---------- evasion: every dodge pose is built around the incoming attack ---------- */
export type DodgeKind = 'slip' | 'duck' | 'thru' | 'hop';

/** Blade direction (pitch / yaw in torso space) that runs ALONG a slash line seen from behind the fighter. */
function bladeDir(ang: number, fwdK: number) {
  const x = -Math.cos(ang) * 0.9;
  const y = Math.sin(ang) * 0.9;
  const l = Math.hypot(x, y, fwdK);
  return { sp: Math.asin(y / l), sw: Math.atan2(x, fwdK) };
}

/**
 * Builds the keyframed dodge.
 *  side: +1 evades to the fighter's left, −1 to the right (ignored by ducks / hops)
 *  ang:  angle of the incoming slash line (null = unknown). The blade is held parallel to it — a guard that "meets" the cut.
 */
export function buildDodge(kind: DodgeKind, side: number, ang: number | null): AnimDef {
  const b = bladeDir(ang ?? 0.7, 0.5);
  const lean = -side * 0.5;
  const R = mk({ ...S(-0.05, 0.58, 0.4, 0.8, 0.08, 0.1, 1), torsoX: 0.18, ...F(-0.22, 0.28, 0.76, 0.07), dy: -0.04 });
  let A: Pose;
  let E: Pose;
  let dur = 0.36;
  switch (kind) {
    case 'slip':
      // sideways slide: body leaning into the evade, leading leg wide, blade laid along the cut, free arm thrown out for balance
      A = mk({ ...S(-0.12, 0.5, 0.34, 0.55, 0.1, 0.2, 1), torsoX: 0.35, torsoY: -0.25, ...F(-0.28, 0.3, 0.66, 0.1), dy: -0.1 });
      E = mk({
        ...S(-0.2, 0.55, 0.32, b.sp, b.sw, 0.3, 0),
        torsoX: 0.3, torsoY: -side * 0.4, torsoZ: lean, hipZ: lean * 0.5, hipYaw: -side * 0.25, headY: side * 0.5, headX: -0.1,
        ...F(-0.15, 0.15, 0.58, 0.1),
        lhZ: side > 0 ? 0.55 : -0.05,
        rhZ: side > 0 ? 0.05 : -0.55,
        dy: -0.18,
        lsX: -0.5, lsZ: side > 0 ? 1.1 : 0.15, leX: -0.45,
      });
      break;
    case 'duck':
      // under a horizontal cut: deep crouch, chest low, blade raised flat above the head along the slash line
      dur = 0.4;
      A = mk({ ...S(-0.1, 0.6, 0.36, 0.7, 0.1, 0.2, 1), torsoX: 0.4, ...F(-0.26, 0.28, 0.62, 0.1), dy: -0.12 });
      E = mk({
        ...S(0.0, 0.92, 0.12, b.sp, b.sw, 0.2, 0),
        torsoX: 0.72, torsoY: -0.1, headX: -0.45, hipX: 0.12,
        ...F(-0.3, 0.3, 0.46, 0.12),
        dy: -0.2,
        lsX: -0.6, lsZ: 0.7, leX: -0.8,
      });
      break;
    case 'thru':
      // forward: slip through the gap below the swing — low torpedo, blade streaming behind
      dur = 0.4;
      A = mk({ ...S(-0.2, 0.4, 0.26, 0.1, 0.6, 0.2, 0), torsoX: 0.6, ...F(-0.3, 0.32, 0.6, 0.1), dy: -0.12 });
      E = mk({
        ...S(-0.28, 0.32, -0.08, -0.05, 3.0, 0.5, 0),
        torsoX: 1.0, torsoY: -0.1, headX: -0.5, hipX: 0.2,
        ...F(-0.55, 0.62, 0.55, 0.1),
        dy: -0.22,
        lsX: -1.0, lsZ: 0.6, leX: -0.3,
      });
      break;
    case 'hop':
    default:
      // short back-hop: chest leaning away, knees lifting, blade still pointing at the attacker
      dur = 0.4;
      A = mk({ ...S(-0.05, 0.5, 0.4, 0.6, 0.08, 0.2, 1), torsoX: 0.3, ...F(-0.24, 0.28, 0.7, 0.08), dy: -0.12 });
      E = mk({
        ...S(-0.05, 0.58, 0.42, 0.62, 0.08, 0.2, 1),
        torsoX: -0.28, torsoY: -0.2, headX: 0.1, hipX: -0.12,
        ...F(0.05, 0.0, 0.9, 0.1),
        plant: 0.4, rl: 0.14, ll: 0.1, dy: 0.0,
      });
      break;
  }
  return {
    name: 'dodge-' + kind,
    dur,
    frames: [
      { t: 0, p: A },
      { t: 0.06, p: E, e: 'out' },
      { t: dur * 0.6, p: E, e: 'lin' },
      { t: dur, p: R, e: 'io' },
    ],
    hits: [],
    trail: [],
    lunge: [],
    trackUntil: 0,
    cancelFrom: 99,
  };
}

/* ---------- IMPALE → KICK-OFF: run the blade through him, then boot him off it ---------- */
const IMP_W = mk({
  torsoX: 0.1, torsoY: -0.6, headY: 0.4, hipYaw: -0.3,
  ...S(-0.3, 0.46, 0.1, 0.02, 0.1, 0.2, 1),
  ...F(-0.3, 0.3, 0.76, 0.08), dy: -0.08,
});
/** blade buried to the hilt, body driven forward behind it */
const IMP_S = mk({
  torsoX: 0.5, torsoY: 0.22, headX: 0.12, headY: -0.15, hipYaw: 0.2,
  ...S(-0.04, 0.52, 0.62, 0.0, 0.05, 0.2, 1),
  ...F(-0.5, 0.66, 0.6, 0.08), dy: -0.12,
});
/** holding him up on the steel, dragging him close */
const IMP_H = mk({
  torsoX: 0.3, torsoY: 0.1, headX: 0.05, headY: -0.1, hipYaw: 0.1,
  ...S(-0.05, 0.56, 0.58, 0.06, 0.05, 0.2, 1),
  ...F(-0.42, 0.52, 0.66, 0.09), dy: -0.08,
});
/** the boot comes up onto his chest, blade starts to slide free */
const IMP_K = mk({
  torsoX: -0.3, torsoY: 0.08, headX: -0.12, hipX: -0.22,
  ...S(-0.16, 0.58, 0.4, 0.3, 0.1, 0.2, 0),
  lsX: -1.3, lsZ: 0.5, leX: -0.6,
  rhX: 1.5, rkX: 0.3, rhZ: -0.08, lhX: -0.35, lkX: 0.9, lhZ: 0.08, plant: 0, rl: 0, ll: 0, dy: -0.05,
});
/** push-off finished: he is gone, the blade is clear, body settling back */
const IMP_E = mk({
  torsoX: -0.1, torsoY: -0.1, headY: 0.1,
  ...S(-0.14, 0.6, 0.34, 0.6, -0.05, 0.2, 0),
  lsX: -0.9, lsZ: 0.5, leX: -0.8,
  ...F(-0.34, 0.26, 0.74, 0.1), dy: -0.06,
});
export const IMPALE: AnimDef = {
  name: 'impale',
  dur: 1.55,
  frames: [
    { t: 0, p: P.guard },
    { t: 0.18, p: IMP_W, e: 'out' },
    { t: 0.27, p: IMP_S, e: 'in' },
    { t: 0.5, p: IMP_S, e: 'lin' },
    { t: 0.78, p: IMP_H, e: 'io' },
    { t: 0.95, p: IMP_K, e: 'out' },
    { t: 1.06, p: IMP_E, e: 'in' },
    { t: 1.3, p: IMP_E, e: 'lin' },
    { t: 1.55, p: P.idle, e: 'io' },
  ],
  hits: [],
  trail: [[0.2, 0.34]],
  lunge: [{ t0: 0.18, t1: 0.27, dist: 1.4 }],
  trackUntil: 0.2,
  cancelFrom: 1.25,
};
/** The victim: run through, lifted on the blade, head down, limbs hanging. */
export const IMPALED_POSE = mk({
  torsoX: 0.45, torsoY: -0.05, headX: 0.5, hipX: 0.12, grip: 0, plant: 0,
  rsX: -0.35, rsZ: 0.55, reX: -0.5, lsX: -0.3, lsZ: 0.6, leX: -0.45,
  rhX: 0.3, rkX: 0.75, rhZ: -0.1, lhX: 0.15, lkX: 0.9, lhZ: 0.1, dy: -0.02,
});
/** Blasted off the blade: spine arched, arms and legs thrown forward, about to land on his back. */
export const TUMBLE_POSE = mk({
  torsoX: -0.75, torsoY: 0.1, headX: -0.6, hipX: -0.3, grip: 0, plant: 0, dy: -0.05,
  rsX: -0.1, rsZ: 1.15, reX: -0.35, lsX: -0.15, lsZ: 1.2, leX: -0.3,
  rhX: 0.9, rkX: 0.5, rhZ: -0.15, lhX: 0.5, lkX: 0.8, lhZ: 0.15,
});

/** Enemy evade: a low, fast side-slide — body leaning out of the blade's path, sword kept between him and you. */
export const EVADE_SIDE = mk({
  torsoX: 0.3, torsoY: -0.3, torsoZ: -0.4, headY: 0.5, hipZ: -0.22, hipYaw: -0.2,
  ...S(-0.12, 0.6, 0.3, 0.9, -0.2, 0.2, 1),
  ...F(-0.2, 0.2, 0.62, 0.14), dy: -0.14,
});
/** Enemy evade: a sharp hop straight back out of reach. */
export const EVADE_BACK = mk({
  torsoX: -0.3, torsoY: -0.15, headX: 0.12, hipX: -0.14,
  ...S(-0.05, 0.64, 0.42, 0.95, 0.05, 0.1, 1),
  ...F(0.06, -0.02, 0.86, 0.1), plant: 0.4, rl: 0.12, ll: 0.09,
});
/** The instant a parry connects: blade thrown up and across, body braced behind it. */
export const PARRY_POSE = mk({
  torsoX: -0.15, torsoY: -0.35, headX: -0.1, headY: 0.25,
  ...S(0.06, 0.82, 0.3, 1.5, 0.25, 0.4, 1),
  ...F(-0.26, 0.24, 0.74, 0.1), dy: -0.04,
});

/** Mid-air pose of a graceful somersault: arms wide, blade out toward the foe, one knee tucking. */
export const FLIP_OPEN = mk({
  torsoX: 0.12, headX: -0.12, ...S(-0.25, 0.55, 0.36, 0.55, 0.12, 0.2, 0),
  lsX: -0.6, lsZ: 1.25, leX: -0.2, plant: 0,
  rhX: -0.45, rkX: 0.9, lhX: 0.2, lkX: 0.5,
});

/** Anime hero landing: deep crouch, one hand brushing the ground, blade swept behind, eyes locked on the enemy. */
export const LAND_HERO = mk({
  torsoX: 1.1, torsoY: -0.25, headX: -0.85, headY: 0.2, hipX: 0.15, hipYaw: -0.1,
  ...S(-0.3, 0.3, -0.2, 0.12, 2.9, 0.4, 0),
  lsX: -1.1, lsZ: 0.3, leX: -0.12,
  ...F(-0.5, 0.45, 0.55, 0.1), dy: -0.34,
});
export const LAND_HERO_ANIM: AnimDef = {
  name: 'land-hero',
  dur: 0.5,
  frames: [
    { t: 0, p: mk({ dy: -0.46, torsoX: 1.2 }, LAND_HERO) },
    { t: 0.1, p: LAND_HERO, e: 'out' },
    { t: 0.34, p: LAND_HERO, e: 'lin' },
    { t: 0.5, p: P.guard, e: 'io' },
  ],
  hits: [], trail: [], lunge: [], trackUntil: 0, cancelFrom: 99,
};

/** After a backflip: skidding landing in a low ready stance, two hands on the sword pointed at the enemy. */
const LAND_BACK = mk({
  torsoX: 0.5, torsoY: -0.35, headX: -0.1, headY: 0.35, hipYaw: -0.2,
  ...S(-0.1, 0.62, 0.4, 0.78, 0.05, 0.1, 1),
  ...F(-0.45, 0.4, 0.62, 0.12), dy: -0.2,
});
export const LAND_BACK_ANIM: AnimDef = {
  name: 'land-back',
  dur: 0.44,
  frames: [
    { t: 0, p: mk({ dy: -0.3, torsoX: 0.62 }, LAND_BACK) },
    { t: 0.1, p: LAND_BACK, e: 'out' },
    { t: 0.28, p: LAND_BACK, e: 'lin' },
    { t: 0.44, p: P.guard, e: 'io' },
  ],
  hits: [], trail: [], lunge: [], trackUntil: 0, cancelFrom: 99,
};

/* ---------- enemy attacks ---------- */
export type EnemyAttackName = 'slash' | 'combo2' | 'combo3' | 'combo4' | 'thrust' | 'sweep';

const pick = <T,>(a: T[]): T => a[Math.floor(Math.random() * a.length)];
const SEQ2: Variant[][] = [['diag', 'horz'], ['rise', 'over'], ['ldiag', 'diag'], ['horz', 'ldiag']];
const SEQ3: Variant[][] = [['diag', 'rise', 'over'], ['ldiag', 'horz', 'diag'], ['diag', 'ldiag', 'over'], ['rise', 'diag', 'horz']];
const SEQ3B: Variant[][] = [['diag', 'rise', 'spin'], ['ldiag', 'diag', 'over'], ['diag', 'horz', 'spin']];
const SEQ4: Variant[][] = [['diag', 'ldiag', 'horz', 'spin'], ['horz', 'diag', 'rise', 'over'], ['ldiag', 'diag', 'ldiag', 'over']];

export function enemyAttack(name: EnemyAttackName, boss: boolean): AnimDef {
  const base = boss ? 1.22 : 1.0;
  const from = IDLE_E;
  switch (name) {
    case 'slash':
      return buildSlashes(
        'slash',
        from,
        [
          {
            v: pick<Variant>(['diag', 'over', 'rise', 'ldiag']),
            windup: 0.62 * base, strike: 0.1, recover: 0.7,
            dmg: boss ? 16 : 13, post: boss ? 22 : 20, lunge: 1.8, reach: 2.6,
          },
        ],
        0.5 * base,
        IDLE_E,
      );
    case 'combo2':
    case 'combo3':
    case 'combo4': {
      const seq = name === 'combo2' ? pick(SEQ2) : name === 'combo3' ? pick(boss ? SEQ3B : SEQ3) : pick(SEQ4);
      const n = seq.length;
      const specs: SlashSpec[] = seq.map((v, i) => ({
        v,
        windup: (i === 0 ? 0.55 : v === 'spin' ? 0.42 : 0.34) * base,
        strike: 0.1,
        recover: i === n - 1 ? 0.75 : 0.18,
        dmg: boss ? 14 : 12, post: boss ? 20 : 18, lunge: v === 'spin' ? 0.6 : 1.0, reach: v === 'spin' ? 3.0 : 2.7,
        heavy: v === 'over',
      }));
      return buildSlashes(name, from, specs, 0.42 * base, IDLE_E);
    }
    case 'thrust': {
      const W = mk({
        ...S(-0.25, 0.4, 0.12, 0.05, 0.12, 0), torsoX: 0.1, torsoY: -0.7, hipYaw: -0.35, headY: 0.7,
        ...F(-0.32, 0.1, 0.74, 0.08), ll: 0.05,
      });
      const St = mk({
        ...S(-0.08, 0.5, 0.5, 0.0, 0.08, 0), torsoX: 0.55, torsoY: 0.3, hipYaw: 0.25, headY: -0.3,
        ...F(-0.5, 0.66, 0.58, 0.08),
      });
      const hitT = 0.82 * base + 0.09;
      return {
        name: 'thrust',
        dur: hitT + 0.85,
        frames: [
          { t: 0, p: from },
          { t: 0.82 * base, p: W, e: 'io' },
          { t: hitT, p: St, e: 'in' },
          { t: hitT + 0.35, p: St, e: 'lin' },
          { t: hitT + 0.85, p: IDLE_E, e: 'io' },
        ],
        hits: [{ t: hitT, dmg: boss ? 32 : 28, post: 30, reach: 2.6, arc: 70, kind: 'thrust', heavy: true }],
        trail: [[hitT - 0.12, hitT + 0.12]],
        lunge: [{ t0: hitT - 0.09, t1: hitT, dist: 3.6 }],
        trackUntil: 0.6 * base,
        warn: { t: 0.1, kind: 'thrust' },
        cancelFrom: 99,
      };
    }
    case 'sweep': {
      const W = mk({
        ...S(0.15, 0.5, 0.28, 0, 1.9, -1.5), torsoX: 0.45, torsoY: 1.25, hipYaw: 0.5, headY: -0.9,
        ...F(0.25, -0.2, 0.62, 0.16),
      });
      const St = mk({
        ...S(-0.35, 0.5, 0.3, 0, -1.5, -1.5), torsoX: 0.5, torsoY: -1.4, hipYaw: -0.55, headY: 0.8,
        ...F(-0.3, 0.42, 0.58, 0.18),
      });
      const hitT = 0.9 * base + 0.12;
      return {
        name: 'sweep',
        dur: hitT + 0.9,
        frames: [
          { t: 0, p: from },
          { t: 0.9 * base, p: W, e: 'io' },
          { t: hitT, p: St, e: 'in' },
          { t: hitT + 0.35, p: St, e: 'lin' },
          { t: hitT + 0.9, p: IDLE_E, e: 'io' },
        ],
        hits: [{ t: hitT, dmg: boss ? 26 : 24, post: 28, reach: 3.2, arc: 170, kind: 'sweep', heavy: true }],
        trail: [[hitT - 0.14, hitT + 0.14]],
        lunge: [{ t0: hitT - 0.12, t1: hitT, dist: 1.4 }],
        trackUntil: 0.7 * base,
        warn: { t: 0.1, kind: 'sweep' },
        cancelFrom: 99,
      };
    }
  }
}
