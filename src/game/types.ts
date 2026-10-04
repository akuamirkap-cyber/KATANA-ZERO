export interface EnemyView {
  id: number;
  name: string;
  kind: 'blade' | 'archer' | 'gunner' | 'boss' | 'bladehead';
  hp: number; // 0..1
  posture: number; // 0..1 (relative to effective max)
  broken: boolean;
  lethal: boolean;
  pips: number;
  maxPips: number;
  x: number;
  y: number;
  onScreen: boolean;
  focus: boolean;
  boss: boolean;
  aiming: boolean; // a ranged enemy is lining up a shot at you
  ang: number; // direction to the enemy relative to the camera (0 = ahead, +π/2 = right)
}

export interface RageView {
  on: boolean;
  meter: number; // 0..1
  ready: boolean;
  chain: number; // consecutive precision cuts
  /** where the next tap-slice will cut (steered with the mouse) */
  guide: { x: number; y: number; angle: number; hot: boolean } | null;
  aim: {
    x: number;
    y: number;
    angle: number; // current cut line (math angle, y up)
    weak: number; // golden line angle (only meaningful when finisher is true)
    finisher: boolean; // this aim is the FINAL slash (right-click) → show the yellow line
    perfect: boolean;
    band: number; // px length of the golden band
    locked: { angle: number; perfect: boolean }[]; // lines already locked into the sequence
  } | null;
}

export interface Snapshot {
  hp: number; // 0..1
  hpMax: number;
  posture: number; // 0..1
  postureBroken: boolean;
  gourds: number;
  resurrect: number;
  enemies: EnemyView[];
  lock: { x: number; y: number } | null;
  perilous: { x: number; y: number; kind: 'thrust' | 'sweep'; id: number } | null;
  prompt: string;
  stageName: string;
  stage: number;
  stats: { kills: number; deathblows: number; deflects: number; time: number; mikiri: number };
  streak: number;
  dead: boolean;
  canRevive: boolean;
  lockOn: boolean;
  rage: RageView;
  /** 'white' = SUPERHOT void → the HUD must switch to dark ink to stay readable */
  theme: 'white' | 'neon';
  cine: number; // 0..1 cinematic shot weight (drives letterbox bars)
  style: { rank: string; pct: number; score: number };
  climbing?: boolean;
  climbT?: number;
  bossBladeStuck?: boolean;
}

export interface GameEvent {
  type:
    | 'deathblow'
    | 'playerDeath'
    | 'victory'
    | 'stage'
    | 'stageClear'
    | 'phase2'
    | 'resurrect'
    | 'mikiri'
    | 'stomp'
    | 'kick'
    | 'pause'
    | 'deflect'
    | 'reflect'
    | 'enemyBreak'
    | 'playerBreak'
    | 'heal'
    | 'rage'
    | 'cut'
    | 'perfect'
    | 'rageLow'
    | 'mount';
  text?: string;
  n?: number;
}
