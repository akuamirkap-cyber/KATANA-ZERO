import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import type { SizeMode, FxStyle } from './game/Game';
import type { CombatMode, GameEvent, GameMode, Snapshot } from './game/types';
import type { Theme } from './game/world';
import { Hud } from './components/Hud';

interface Toast {
  id: number;
  type: GameEvent['type'];
  text?: string;
  n?: number;
}

/**
 * How long each callout stays on screen (ms). Anything that fires often is short and lives at the edge of the screen;
 * only rare, cinematic beats are allowed near the centre — and even those clear quickly.
 */
const DURATION: Partial<Record<GameEvent['type'], number>> = {
  cut: 420,
  reflect: 600,
  kick: 520,
  heal: 800,
  mikiri: 800,
  stomp: 800,
  deflect: 450,
  rageLow: 900,
  enemyBreak: 900,
  playerBreak: 900,
  perfect: 950,
  deathblow: 1100,
  rage: 900,
  phase2: 1600,
  stage: 2200,
  stageClear: 2000,
  resurrect: 1300,
};
/** these are shown at the edge of the screen, never over the fight */
const SIDE_EVENTS = new Set<GameEvent['type']>(['cut', 'kick', 'reflect', 'mikiri', 'stomp', 'heal', 'deflect']);

/** Small, fast callout at the left edge — the stuff that fires constantly (slices, parries, kicks). */
function SideItem({ t }: { t: Toast }) {
  const dur = `${(DURATION[t.type] ?? 500) / 1000}s`;
  const map: Partial<Record<GameEvent['type'], { jp: string; sub?: string; col: string; glow: string }>> = {
    cut: { jp: '斬', col: '#fff1ee', glow: 'rgba(255,90,70,.9)' },
    deflect: { jp: '弾', col: '#ffe9b8', glow: 'rgba(255,210,120,.95)' },
    kick: { jp: '蹴', col: '#ffffff', glow: 'rgba(255,170,90,.95)' },
    reflect: { jp: '返', sub: 'Pantul', col: '#ffe9b8', glow: 'rgba(255,200,100,.9)' },
    mikiri: { jp: '見切', sub: 'Mikiri', col: '#ffe9b8', glow: 'rgba(255,200,100,.9)' },
    stomp: { jp: '踏', sub: 'Injak', col: '#ffe9b8', glow: 'rgba(255,200,100,.9)' },
  };
  if (t.type === 'heal') {
    return (
      <div className="anim-side font-title text-lg font-bold text-emerald-300" style={{ ['--dur' as string]: dur }}>
        +{t.n} HP
      </div>
    );
  }
  const d = map[t.type];
  if (!d) return null;
  return (
    <div className="anim-side flex items-baseline gap-2" style={{ ['--dur' as string]: dur }}>
      <span
        className="font-jp text-4xl font-extrabold"
        style={{ color: d.col, textShadow: `0 0 12px ${d.glow}, 0 2px 6px rgba(0,0,0,.9)` }}
      >
        {d.jp}
      </span>
      {t.n && t.n > 1 ? <span className="font-title text-xl font-bold text-amber-300">×{t.n}</span> : null}
      {d.sub ? <span className="font-title text-[10px] tracking-[0.3em] text-white/55 uppercase">{d.sub}</span> : null}
    </div>
  );
}

/** Rare, cinematic beats. Kept compact and high up so the fighters below stay visible. */
function CenterItem({ t }: { t: Toast }) {
  const dur = `${(DURATION[t.type] ?? 1000) / 1000}s`;
  const s = { ['--dur' as string]: dur };
  switch (t.type) {
    case 'deathblow':
      return (
        <div className="absolute inset-x-0 top-[13%] text-center">
          <div className="absolute top-1/2 h-16 w-full -translate-y-1/2 overflow-hidden">
            <div
              className="absolute inset-y-0 w-full bg-gradient-to-r from-transparent via-red-600/45 to-transparent"
              style={{ animation: 'slashLine .5s ease-out forwards' }}
            />
          </div>
          <div className="font-jp kanji-red anim-slam-s text-[clamp(56px,9vw,120px)] leading-none font-extrabold" style={s}>
            忍殺
          </div>
        </div>
      );
    case 'perfect':
      return (
        <div className="absolute inset-x-0 top-[12%] text-center">
          <div
            className="font-jp anim-slam-s text-[clamp(60px,10vw,132px)] leading-none font-extrabold text-white drop-shadow-[0_0_26px_rgba(255,60,40,.9)]"
            style={s}
          >
            斬
          </div>
          <div className="font-title anim-side text-sm tracking-[0.5em] text-amber-200 uppercase" style={s}>
            Perfect · +HP
          </div>
        </div>
      );
    case 'rage':
      return (
        <div className="absolute inset-x-0 top-[12%] text-center">
          <div className="font-jp kanji-red anim-slam-s text-[clamp(52px,8vw,110px)] leading-none font-extrabold" style={s}>
            怒
          </div>
          <div className="font-title anim-side text-xs tracking-[0.5em] text-red-200 uppercase" style={s}>
            Raiden · Rage Mode
          </div>
        </div>
      );
    case 'enemyBreak':
      return (
        <div className="absolute inset-x-0 top-[17%] text-center">
          <div className="font-jp anim-slam-s text-3xl font-extrabold tracking-[0.3em] text-white drop-shadow-[0_0_12px_rgba(255,255,255,.8)]" style={s}>
            体幹崩し
          </div>
          <div className="font-title text-[10px] tracking-[0.4em] text-white/65 uppercase">Serang untuk Deathblow</div>
        </div>
      );
    case 'playerBreak':
      return (
        <div className="absolute inset-x-0 top-[17%] text-center">
          <div className="font-title anim-slam-s text-xl font-bold tracking-[0.3em] text-red-400 uppercase" style={s}>
            Postur hancur!
          </div>
        </div>
      );
    case 'rageLow':
      return (
        <div className="absolute inset-x-0 bottom-[22%] text-center">
          <div className="font-title anim-side text-xs tracking-[0.35em] text-red-300 uppercase" style={s}>
            Rage belum cukup
          </div>
        </div>
      );
    case 'stage':
      return (
        <div className="absolute inset-x-0 top-[15%] text-center">
          <div className="font-jp anim-banner text-[10px] tracking-[0.6em] text-white/55">決闘</div>
          <div className="font-title anim-banner ink-text mt-1 text-2xl font-bold tracking-[0.3em] whitespace-nowrap text-white uppercase">
            {t.text}
          </div>
        </div>
      );
    case 'stageClear':
      return (
        <div className="absolute inset-x-0 top-[14%] text-center">
          <div className="font-jp kanji-red anim-banner text-5xl font-extrabold">撃破</div>
          <div className="font-title anim-banner mt-1 text-xs tracking-[0.4em] text-white/75 uppercase">+HP · +Gourd</div>
        </div>
      );
    case 'phase2':
      return (
        <div className="absolute inset-x-0 top-[14%] text-center">
          <div className="font-jp kanji-red anim-banner text-4xl font-extrabold">鬼</div>
          <div className="font-title anim-banner mt-1 text-xs tracking-[0.4em] text-red-200 uppercase">{t.text}</div>
        </div>
      );
    case 'resurrect':
      return (
        <div className="absolute inset-x-0 top-[14%] text-center">
          <div className="font-jp anim-banner text-5xl font-extrabold text-amber-200 drop-shadow-[0_0_20px_rgba(255,210,120,.9)]">
            復活
          </div>
        </div>
      );
    default:
      return null;
  }
}

function Callouts({ toasts }: { toasts: Toast[] }) {
  const side = toasts.filter((t) => SIDE_EVENTS.has(t.type));
  const centre = toasts.filter((t) => !SIDE_EVENTS.has(t.type));
  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      {/* action feed: hugs the left edge, well clear of the fighters */}
      <div className="absolute top-1/2 left-6 flex -translate-y-1/2 flex-col items-start gap-1">
        {side.map((t) => (
          <SideItem key={t.id} t={t} />
        ))}
      </div>
      {centre.map((t) => (
        <CenterItem key={t.id} t={t} />
      ))}
    </div>
  );
}

const CONTROLS: [string, string][] = [
  ['W A S D', 'Bergerak · Shift sprint'],
  ['Mouse', 'Kamera'],
  ['Klik kiri', 'Tebas — combo 5 serangan'],
  ['Klik kanan tahan', 'Guard depan · ketuk saat benturan = Deflect'],
  ['C', 'Dodge / Mikiri saat tusukan · mundur = backflip'],
  ['E', 'Lompat · tekan 2× = double jump'],
  ['C / Klik di udara', 'Air dash · Flying Swallow'],
  ['V', 'Tendangan keras — tembus tangkisan'],
  ['Klik tengah', 'Tancap pedang → tendang lepas, musuh terjungkal'],
  ['F / K', 'Tahan = guard · Rage: tebasan terakhir'],
  ['H', 'Gourd penyembuh · R bangkit'],
  ['Q / Tab', 'Lock-on · ganti target'],
  ['G', 'Freestyle bilah'],
  ['P / Esc', 'Jeda · pilih BEFORE / AFTER untuk membandingkan combat'],
];

const RAGE_HELP: [string, string][] = [
  ['Space', 'Mode Raiden / Rage — waktu melambat'],
  ['Ketuk klik kiri', 'Slice: membelah tubuh sesuai arah tebasan'],
  ['Klik kanan', 'Tebasan terakhir — garis kuning, slow-mo usai'],
];

const RULES: [string, string][] = [
  ['一', 'Kurogane adalah bos pembuka Stage I: baca ayunan pedang panjangnya. Duel ini dimenangkan lewat timing, bukan memanjat bos.'],
  ['二', 'AFTER: guard dari depan menahan tebasan; ketuk dekat benturan untuk Deflect. Serangan dari belakang melewati guard.'],
  ['三', 'Tusukan: Deflect tepat atau Mikiri (C). Sapuan rendah: lompat (E) atau dodge. Guard tidak menghentikan keduanya.'],
  ['四', 'Tebasan mengikuti arah hadap/lock-on dan hanya efektif dari jarak dekat. Musuh menampilkan GUARD, PARRY, atau CELAH saat mode AFTER aktif.'],
  ['五', 'Pecah GUARD dengan tendang (V) atau tebas berat A5; jangan spam slash ke PARRY—tunggu CELAH atau tendang. Pemanah/penembak menekan dari jauh, jadi terus bergerak mendekat.'],
  ['六', 'Deflect, Mikiri, Deathblow, dan kill mengisi Rage; tenangkan postur dengan guard saat aman. Rage tetap mode slow-motion terpisah.'],
];

const SIDE_MODE_CONTROLS: Record<'runner' | 'apartment', [string, string][]> = {
  runner: [
    ['W / S', 'Lari otomatis · W mempercepat · S mengerem tanpa berhenti'],
    ['A / D', 'Pindah jalur kedalaman · A menjauh · D mendekat'],
    ['Shift', 'Sprint tambahan'],
    ['Klik kiri / J', 'Tebas · combo 5 serangan · Deathblow saat terbuka'],
    ['Klik kanan tahan · F / K', 'Guard depan · ketuk saat benturan untuk Deflect'],
    ['C · E', 'Dodge / Mikiri · lompat (tekan dua kali untuk double jump)'],
    ['V · Klik tengah', 'Tendang pemecah guard · tancap lalu lepas'],
    ['Space', 'Raiden / Rage · slow-motion dan tebasan terarah'],
    ['Q / Tab · H · R', 'Lock-on / ganti target · heal · bangkit'],
    ['P / Esc', 'Jeda · G freestyle bilah'],
  ],
  apartment: [
    ['A / D', 'Bergerak kiri / kanan sepanjang koridor di layar'],
    ['W / S', 'W maju menjauh dari kamera · S mundur mendekat ke kamera'],
    ['Klik kiri / J', 'Tebas · combo 5 serangan · Deathblow saat terbuka'],
    ['Klik kanan tahan · F / K', 'Guard depan · ketuk saat benturan untuk Deflect'],
    ['C · E', 'Dodge / Mikiri · lompat (tekan dua kali untuk double jump)'],
    ['V · Klik tengah', 'Tendang pemecah guard · tancap lalu lepas'],
    ['Space', 'Raiden / Rage · slow-motion dan tebasan terarah'],
    ['Q / Tab · H · R', 'Lock-on / ganti target · heal · bangkit'],
    ['P / Esc', 'Jeda · G freestyle bilah'],
  ],
};

const SIDE_MODE_RULES: Record<'runner' | 'apartment', [string, string][]> = {
  runner: [
    ['一', 'Lari tanpa akhir di atap kota 3D; W menambah laju, S mengerem tetapi auto-run tidak berhenti.'],
    ['二', 'A/D mengubah jalur kedalaman (A menjauh, D mendekat); kecepatan dan kepadatan ancaman naik seiring jarak.'],
    ['三', 'Lompat atau dodge melewati rintangan; mendarat di beam/crate akan mengurangi HP dan postur.'],
    ['四', 'Drone bersenjata memakai pola serang dan pertahanan Sekiro yang sama: baca GUARD, PARRY, celah, dan perilaku perilous.'],
    ['五', 'Lock-on, Deflect, Mikiri, Deathblow, heal, Rage, serta posture management tetap aktif seperti di duel.'],
  ],
  apartment: [
    ['一', 'Bersihkan lima hostile di koridor apartemen sebelum elevator terbuka. Captain terakhir lebih tahan pukul; Kurogane tidak muncul di misi ini.'],
    ['二', 'Musuh bertanda GUARD menahan slash dari depan; gunakan V atau combo slash berat untuk memecahnya.'],
    ['三', 'Baca kilatan merah: tahan guard dari depan, ketuk dekat benturan untuk Deflect, Mikiri thrust, lompat/dodge sweep.'],
    ['四', 'Lock-on, Deathblow, Rage, gourd heal, serta posture management memakai sistem inti duel yang sama.'],
  ],
};

const SIDE_MODE_SPECIAL: Record<'runner' | 'apartment', [string, string][]> = {
  runner: [['Rage', 'Space mengaktifkan slow-motion; tebasan terakhir tetap diarahkan dengan mouse / klik kanan.']],
  apartment: [['Rage', 'Space mengaktifkan slow-motion; Rage tetap mode terpisah dan bisa dipakai kapan saja.']],
};

/** Slow-drifting embers behind the title. */
function Embers() {
  const seeds = useRef(
    Array.from({ length: 22 }, () => ({
      left: Math.random() * 100,
      size: 1 + Math.random() * 2.4,
      dur: 11 + Math.random() * 14,
      delay: -Math.random() * 20,
      dx: (Math.random() - 0.5) * 120,
      op: 0.25 + Math.random() * 0.5,
    })),
  ).current;
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {seeds.map((s, i) => (
        <span
          key={i}
          className="absolute bottom-[-6vh] rounded-full"
          style={{
            left: `${s.left}%`,
            width: s.size,
            height: s.size,
            background: '#ff8a4a',
            boxShadow: '0 0 6px 1px rgba(255,120,60,.8)',
            opacity: s.op,
            animation: `emberRise ${s.dur}s linear ${s.delay}s infinite`,
            ['--dx' as string]: `${s.dx}px`,
          }}
        />
      ))}
    </div>
  );
}

function KeyRow({ k, v }: { k: string; v: string }) {
  return (
    <li className="flex items-baseline justify-between gap-6 border-b border-white/5 py-1.5 last:border-0">
      <span className="font-title text-[10px] tracking-[0.25em] whitespace-nowrap text-amber-200/90 uppercase">{k}</span>
      <span className="text-right text-[12px] leading-snug text-white/55">{v}</span>
    </li>
  );
}

function CombatModePicker({ mode, onChange }: { mode: CombatMode; onChange: (mode: CombatMode) => void }) {
  const options: [CombatMode, string][] = [
    ['before', 'BEFORE · Klasik'],
    ['after', 'AFTER · Taktis'],
  ];
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="font-title text-[9px] tracking-[0.38em] text-white/35 uppercase">Mode Update · Bandingkan Before / After</div>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => onChange(id)}
            className={`border px-3 py-1.5 font-title text-[9px] tracking-[0.22em] uppercase transition-colors ${
              mode === id
                ? 'border-red-400/70 bg-red-950/40 text-red-100'
                : 'border-white/10 text-white/40 hover:border-white/30 hover:text-white/75'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="max-w-[min(92vw,440px)] text-center text-[10px] leading-relaxed text-white/40">
        {mode === 'before'
          ? 'BEFORE: auto-aim dekat, respons acak, guard dasar.'
          : 'AFTER: aim disengaja, counter per ancaman, celah dan guard terbaca.'}
      </div>
    </div>
  );
}

function GameModePicker({ mode, onChange }: { mode: GameMode; onChange: (mode: GameMode) => void }) {
  const options: [GameMode, string, string][] = [
    ['duel', '⚔', 'DUEL 3D'],
    ['runner', '忍', 'NINJA RUN'],
    ['apartment', '04F', 'APARTMENT'],
  ];
  return (
    <div className="mt-4 flex flex-col items-center gap-2">
      <div className="font-title text-[8px] tracking-[0.42em] text-white/35 uppercase">Pilih Mode Permainan</div>
      <div className="flex flex-wrap justify-center gap-2">
        {options.map(([id, icon, label]) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => onChange(id)}
            className={`flex min-w-[100px] items-center justify-center gap-2 border px-3 py-1.5 transition-colors ${
              mode === id
                ? 'border-red-400/70 bg-red-950/45 text-white'
                : 'border-white/10 bg-black/20 text-white/40 hover:border-white/30 hover:text-white/75'
            }`}
          >
            <span className="font-jp text-xs text-red-200/85">{icon}</span>
            <span className="font-title text-[8px] tracking-[0.19em] uppercase">{label}</span>
          </button>
        ))}
      </div>
      <div className="font-title text-[9px] tracking-[0.16em] text-white/35">
        {mode === 'duel' ? 'Kurogane · duel 3D taktis' : mode === 'runner' ? 'Combat Sekiro · runner rooftop endless 3D' : 'Combat Sekiro · misi apartemen side-view 3D'}
      </div>
    </div>
  );
}

function Menu({
  onStart,
  error,
  theme,
  setTheme,
  size,
  setSize,
  fx,
  setFx,
  combatMode,
  setCombatMode,
  gameMode,
  setGameMode,
}: {
  onStart: () => void;
  error: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  size: SizeMode;
  setSize: (s: SizeMode) => void;
  fx: FxStyle;
  setFx: (f: FxStyle) => void;
  combatMode: CombatMode;
  setCombatMode: (mode: CombatMode) => void;
  gameMode: GameMode;
  setGameMode: (mode: GameMode) => void;
}) {
  const [sheet, setSheet] = useState<null | 'controls' | 'rules'>(null);
  const controls = gameMode === 'duel' ? CONTROLS : SIDE_MODE_CONTROLS[gameMode];
  const rules = gameMode === 'duel' ? RULES : SIDE_MODE_RULES[gameMode];
  const specialHelp = gameMode === 'duel' ? RAGE_HELP : SIDE_MODE_SPECIAL[gameMode];
  return (
    <div className="absolute inset-0 z-30 overflow-hidden bg-[#05040a]">
      {/* dusk haze + ink vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_118%,#86303a_0%,#3a1424_28%,#120a16_58%,#05040a_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,transparent_35%,rgba(0,0,0,.85)_100%)]" />
      <Embers />
      {/* cinematic bars */}
      <div className="absolute inset-x-0 top-0 h-[7vh] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[7vh] bg-black" />

      {/* title block */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        <div className="relative flex flex-col items-center">
          <div
            className="font-jp anim-ink text-[clamp(84px,15vw,172px)] leading-[0.9] font-extrabold tracking-[0.08em] text-[#f3eee8]"
            style={{ textShadow: '0 0 70px rgba(200,40,30,.5), 0 6px 40px rgba(0,0,0,.9)' }}
          >
            影刃
          </div>
          <div
            className="anim-line mt-7 h-px w-[min(60vw,460px)] bg-gradient-to-r from-transparent via-red-500/80 to-transparent"
            style={{ animationDelay: '0.6s' }}
          />
          <div
            className="font-title anim-soft mt-5 text-[clamp(11px,1.5vw,15px)] tracking-[0.75em] text-white/60 uppercase"
            style={{ animationDelay: '0.9s' }}
          >
            Kageba
          </div>
          <div
            className="font-title anim-soft mt-2 text-[10px] tracking-[0.42em] text-white/28 uppercase"
            style={{ animationDelay: '1.05s' }}
          >
            {gameMode === 'duel' ? 'Duel pedang shinobi' : gameMode === 'runner' ? 'Ninja runner endless · rooftop' : 'Sideview · misi apartemen'}
          </div>
          <GameModePicker mode={gameMode} onChange={setGameMode} />
        </div>

        {/* actions */}
        <div className="anim-soft mt-10 flex flex-col items-center gap-5" style={{ animationDelay: '1.25s' }}>
          <button
            onClick={onStart}
            className="group relative px-10 py-2 transition-transform duration-300 active:scale-95"
          >
            <span className="font-jp absolute -top-7 left-1/2 -translate-x-1/2 text-base text-red-400/70 opacity-0 transition-opacity duration-500 group-hover:opacity-100">
              始
            </span>
            <span className="font-title anim-breathe text-[15px] tracking-[0.55em] text-white/85 uppercase transition-colors duration-300 group-hover:text-white">
              {gameMode === 'duel' ? 'Mulai Duel' : gameMode === 'runner' ? 'Mulai Runner' : 'Masuk Apartemen'}
            </span>
            <span className="absolute inset-x-0 bottom-0 h-px origin-center scale-x-50 bg-gradient-to-r from-transparent via-red-400/90 to-transparent transition-transform duration-500 group-hover:scale-x-100" />
          </button>

          {gameMode === 'duel' && (
            <>
              {/* fx picker */}
              <div className="flex flex-col items-center gap-2">
            <div className="font-title text-[9px] tracking-[0.45em] text-white/22 uppercase">Efek</div>
            <div className="flex items-center gap-6">
              {([
                ['kz', '血', 'Katana Zero'],
                ['classic', '雷', 'Listrik Biru'],
              ] as const).map(([id, jp, label]) => (
                <button key={id} onClick={() => setFx(id)} className="group relative flex items-center gap-2 pb-1.5">
                  <span className={`font-jp text-sm transition-colors ${fx === id ? 'text-red-300' : 'text-white/30 group-hover:text-white/60'}`}>
                    {jp}
                  </span>
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      fx === id ? 'text-white/85' : 'text-white/28 group-hover:text-white/55'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      fx === id ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

              {/* size picker */}
              <div className="flex flex-col items-center gap-2">
            <div className="font-title text-[9px] tracking-[0.45em] text-white/22 uppercase">Ukuran</div>
            <div className="flex items-center gap-6">
              {([
                ['normal', '人', 'Normal'],
                ['chibi', '豆', 'Chibi · Link'],
              ] as const).map(([id, jp, label]) => (
                <button key={id} onClick={() => setSize(id)} className="group relative flex items-center gap-2 pb-1.5">
                  <span className={`font-jp text-sm transition-colors ${size === id ? 'text-red-300' : 'text-white/30 group-hover:text-white/60'}`}>
                    {jp}
                  </span>
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      size === id ? 'text-white/85' : 'text-white/28 group-hover:text-white/55'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      size === id ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          {/* arena picker */}
          <div className="flex flex-col items-center gap-2">
            <div className="font-title text-[9px] tracking-[0.45em] text-white/22 uppercase">Arena</div>
            <div className="flex items-center gap-6">
              {([
                ['white', '白', 'Kota Putih'],
                ['neon', '夜', 'Kuil Neon'],
              ] as const).map(([id, jp, label]) => (
                <button key={id} onClick={() => setTheme(id)} className="group relative flex items-center gap-2 pb-1.5">
                  <span className={`font-jp text-sm transition-colors ${theme === id ? 'text-red-300' : 'text-white/30 group-hover:text-white/60'}`}>
                    {jp}
                  </span>
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      theme === id ? 'text-white/85' : 'text-white/28 group-hover:text-white/55'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      theme === id ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

              <CombatModePicker mode={combatMode} onChange={setCombatMode} />
            </>
          )}

          <div className="flex items-center gap-7">
            {([
              ['controls', '操作', 'Kontrol'],
              ['rules', '心得', 'Aturan'],
            ] as const).map(([id, jp, label]) => (
              <button
                key={id}
                onClick={() => setSheet(sheet === id ? null : id)}
                className="group flex items-center gap-2 transition-opacity duration-300"
              >
                <span className={`font-jp text-sm transition-colors ${sheet === id ? 'text-red-300' : 'text-white/35 group-hover:text-white/70'}`}>
                  {jp}
                </span>
                <span
                  className={`font-title text-[10px] tracking-[0.35em] uppercase transition-colors ${sheet === id ? 'text-white/80' : 'text-white/30 group-hover:text-white/60'}`}
                >
                  {label}
                </span>
              </button>
            ))}
          </div>
        </div>

        {error && <p className="mt-6 max-w-md text-center text-xs tracking-wide text-red-300/90">{error}</p>}
      </div>

      {/* side kanji */}
      <div className="pointer-events-none absolute top-1/2 right-[5vw] hidden -translate-y-1/2 flex-col items-center gap-4 md:flex">
        <div className="anim-line-y h-24 w-px bg-gradient-to-b from-transparent to-white/15" style={{ animationDelay: '1.4s' }} />
        <div className="font-jp anim-soft text-xs leading-[2] tracking-[0.5em] text-white/20 [writing-mode:vertical-rl]" style={{ animationDelay: '1.5s' }}>
          忍 殺
        </div>
        <div className="anim-line-y h-24 w-px bg-gradient-to-b from-white/15 to-transparent" style={{ animationDelay: '1.4s' }} />
      </div>

      <div className="font-title absolute inset-x-0 bottom-[9vh] text-center text-[9px] tracking-[0.4em] text-white/20 uppercase">
        {gameMode === 'duel' ? 'Kursor terkunci saat mulai · Esc untuk jeda' : 'Kamera side-view · input dan combat Sekiro tetap aktif · Esc untuk jeda'}
      </div>

      {/* slide-up sheet */}
      {sheet && (
        <div className="absolute inset-0 z-10 flex items-end justify-center bg-black/70 px-4 pb-[9vh] backdrop-blur-sm" onClick={() => setSheet(null)}>
          <div
            className="anim-soft w-full max-w-2xl border-t border-red-500/30 bg-[#0b0810]/95 p-7"
            onClick={(ev) => ev.stopPropagation()}
          >
            <div className="mb-5 flex items-baseline justify-between">
              <div className="flex items-baseline gap-3">
                <span className="font-jp text-lg text-red-400/80">{sheet === 'controls' ? '操作' : '心得'}</span>
                <span className="font-title text-[11px] tracking-[0.4em] text-white/60 uppercase">
                  {sheet === 'controls' ? 'Kontrol' : 'Aturan Duel'}
                </span>
              </div>
              <button onClick={() => setSheet(null)} className="font-title text-[10px] tracking-[0.3em] text-white/35 uppercase hover:text-white/70">
                Tutup
              </button>
            </div>
            {sheet === 'controls' ? (
              <div className="grid gap-x-10 md:grid-cols-2">
                <ul>
                  {controls.slice(0, 6).map(([k, v]) => (
                    <KeyRow key={k} k={k} v={v} />
                  ))}
                </ul>
                <ul>
                  {controls.slice(6).map(([k, v]) => (
                    <KeyRow key={k} k={k} v={v} />
                  ))}
                </ul>
                <div className="mt-5 md:col-span-2">
                  <div className="font-jp mb-2 text-xs tracking-[0.4em] text-red-400/80">
                    {gameMode === 'duel' ? '怒 · RAIDEN / RAGE' : gameMode === 'runner' ? '忍 · RUNNER' : '04F · APARTMENT'}
                  </div>
                  <ul>
                    {specialHelp.map(([k, v]) => (
                      <KeyRow key={k} k={k} v={v} />
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {rules.map(([n, v]) => (
                  <li key={n} className="flex gap-4">
                    <span className="font-jp text-base text-red-400/70">{n}</span>
                    <span className="text-[13px] leading-relaxed text-white/60">{v}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [started, setStarted] = useState(false);
  const [gameKey, setGameKey] = useState(0);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const [paused, setPaused] = useState(false);
  const [victory, setVictory] = useState(false);
  const [error, setError] = useState('');
  const [theme, setTheme] = useState<Theme>('white');
  const themeRef = useRef<Theme>('white');
  themeRef.current = theme;
  const [size, setSize] = useState<SizeMode>('chibi');
  const sizeRef = useRef<SizeMode>('chibi');
  sizeRef.current = size;
  const [fx, setFx] = useState<FxStyle>('kz');
  const fxRef = useRef<FxStyle>('kz');
  const [combatMode, setCombatMode] = useState<CombatMode>('after');
  const combatModeRef = useRef<CombatMode>('after');
  const [gameMode, setGameMode] = useState<GameMode>('duel');
  fxRef.current = fx;
  combatModeRef.current = combatMode;
  const [shakeLvl, setShakeLvl] = useState(1);
  const shakeRef = useRef(1);
  shakeRef.current = shakeLvl;
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  const snapRef = useRef<Snapshot | null>(null);
  const idRef = useRef(1);
  const chooseCombatMode = useCallback((mode: CombatMode) => {
    combatModeRef.current = mode;
    setCombatMode(mode);
    gameRef.current?.setCombatMode(mode);
  }, []);

  const onEvent = useCallback((e: GameEvent) => {
    if (e.type === 'pause') {
      if (e.n === 1) setPaused(true);
      else {
        setPaused(false);
        gameRef.current?.setPaused(false);
      }
      return;
    }

    if (e.type === 'victory') {
      setTimeout(() => {
        setVictory(true);
        if (document.pointerLockElement) document.exitPointerLock();
      }, 2200);
      return;
    }
    if (e.type === 'playerDeath') return;
    const id = idRef.current++;
    // a repeat of the same callout REPLACES the old one — no stacking, no two 斬 on top of each other
    setToasts((t) => [...t.filter((x) => x.type !== e.type), { id, type: e.type, text: e.text, n: e.n }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), DURATION[e.type] ?? 1200);
  }, []);

  useEffect(() => {
    if (!started || !containerRef.current) return;
    let g: Game;
    try {
      g = new Game(containerRef.current, onEvent, themeRef.current, sizeRef.current, fxRef.current, combatModeRef.current, gameMode);
    } catch (err) {
      setError('WebGL tidak tersedia di perangkat ini: ' + String(err));
      setStarted(false);
      return;
    }
    gameRef.current = g;
    g.setShakeScale(shakeRef.current);
    g.start();
    const iv = setInterval(() => {
      const s = g.getSnapshot();
      snapRef.current = s;
      setSnap(s);
    }, 33);
    return () => {
      clearInterval(iv);
      g.dispose();
      gameRef.current = null;
    };
  }, [started, gameKey, gameMode, onEvent]);

  const restart = useCallback(() => {
    setToasts([]);
    setVictory(false);
    setPaused(false);
    setSnap(null);
    snapRef.current = null;
    setGameKey((k) => k + 1);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.code === 'KeyR' && snapRef.current?.dead && snapRef.current.resurrect === 0) restart();
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [restart, gameMode]);

  const resume = () => {
    setPaused(false);
    gameRef.current?.setPaused(false);
  };

  const exitSideMode = useCallback(() => {
    setStarted(false);
    setPaused(false);
    setVictory(false);
    setSnap(null);
    snapRef.current = null;
    setToasts([]);
  }, []);

  const dead = !!snap?.dead;

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {started && <div ref={containerRef} className="absolute inset-0" />}

      {started && snap && <Hud s={snap} />}

      {/* Shared combat callouts for duel and side-view modes. */}
      {started && <Callouts toasts={toasts} />}

      {/* death */}
      {started && dead && !victory && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/55">
          <div
            className="font-jp kanji-red text-[clamp(140px,30vw,380px)] leading-none font-extrabold"
            style={{ animation: 'deathIn 1.6s ease-out forwards' }}
          >
            死
          </div>
          <div className="font-title mt-4 text-sm tracking-[0.5em] text-white/70 uppercase" style={{ animation: 'fadeIn 2s 1s both' }}>
            {snap?.canRevive ? 'Tekan R untuk bangkit' : snap && snap.resurrect > 0 ? '…' : 'Tekan R untuk mengulang'}
          </div>
          {snap && snap.resurrect === 0 && (
            <button
              onClick={restart}
              className="font-title pointer-events-auto mt-6 border border-red-500/60 bg-red-950/60 px-8 py-2 text-sm tracking-[0.35em] text-red-100 uppercase hover:bg-red-700/60"
              style={{ animation: 'fadeIn 2s 1.4s both' }}
            >
              Ulangi
            </button>
          )}
          <button onClick={exitSideMode} className="font-title pointer-events-auto mt-4 text-[10px] tracking-[0.3em] text-white/45 uppercase hover:text-white/85">Kembali ke Menu</button>
        </div>
      )}

      {/* victory */}
      {started && victory && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 px-6 text-center" style={{ animation: 'fadeIn 1.5s both' }}>
          <div className="font-jp text-[clamp(100px,20vw,240px)] leading-none font-extrabold text-amber-100 drop-shadow-[0_0_40px_rgba(255,200,100,.7)]">
            勝利
          </div>
          <div className="font-title mt-3 text-lg tracking-[0.5em] text-white/90 uppercase">
            {gameMode === 'duel' ? 'Sang jenderal telah tumbang' : gameMode === 'apartment' ? 'Koridor aman · misi selesai' : 'Runner selesai'}
          </div>
          {snap && (
            <div className="font-title mt-6 grid grid-cols-2 gap-x-10 gap-y-1 text-sm tracking-[0.2em] text-white/70 uppercase">
              <span>Deflect</span>
              <span className="text-right text-amber-200">{snap.stats.deflects}</span>
              <span>Deathblow</span>
              <span className="text-right text-amber-200">{snap.stats.deathblows}</span>
              <span>Mikiri / Injak</span>
              <span className="text-right text-amber-200">{snap.stats.mikiri}</span>
              <span>Waktu</span>
              <span className="text-right text-amber-200">
                {Math.floor(snap.stats.time / 60)}:{String(Math.floor(snap.stats.time % 60)).padStart(2, '0')}
              </span>
            </div>
          )}
          <button
            onClick={restart}
            className="font-title mt-8 border border-amber-300/60 bg-amber-900/30 px-10 py-3 text-sm font-bold tracking-[0.4em] text-amber-100 uppercase hover:bg-amber-700/40"
          >
            {gameMode === 'duel' ? 'Duel Lagi' : 'Main Lagi'}
          </button>
          <button onClick={exitSideMode} className="font-title mt-4 text-[10px] tracking-[0.3em] text-white/45 uppercase hover:text-white/85">Kembali ke Menu</button>
        </div>
      )}

      {/* pause */}
      {started && paused && !victory && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/78 backdrop-blur-[3px]">
          <div className="absolute inset-x-0 top-0 h-[7vh] bg-black" />
          <div className="absolute inset-x-0 bottom-0 h-[7vh] bg-black" />
          <div className="anim-ink font-jp text-5xl tracking-[0.3em] text-white/85">休</div>
          <div className="anim-line mt-6 h-px w-56 bg-gradient-to-r from-transparent via-white/25 to-transparent" />
          <div className="font-title anim-soft mt-5 text-[11px] tracking-[0.6em] text-white/45 uppercase">Dijeda</div>

          <div className="anim-soft mt-12 flex flex-col items-center" style={{ animationDelay: '.1s' }}>
            <div className="font-title mb-3 text-[9px] tracking-[0.4em] text-white/25 uppercase">Getaran layar</div>
            <div className="pointer-events-auto flex gap-6">
              {(
                [
                  ['Mati', 0],
                  ['Rendah', 0.5],
                  ['Normal', 1],
                  ['Tinggi', 1.5],
                ] as [string, number][]
              ).map(([label, v]) => (
                <button
                  key={label}
                  onClick={() => {
                    setShakeLvl(v);
                    gameRef.current?.setShakeScale(v);
                  }}
                  className="group relative pb-1.5"
                >
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      shakeLvl === v ? 'text-red-200' : 'text-white/30 group-hover:text-white/60'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      shakeLvl === v ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
          </div>

          <div className="anim-soft pointer-events-auto mt-8" style={{ animationDelay: '.16s' }}>
            <CombatModePicker mode={combatMode} onChange={chooseCombatMode} />
          </div>

          <div className="anim-soft pointer-events-auto mt-8 flex flex-col items-center gap-5" style={{ animationDelay: '.2s' }}>
            <button onClick={resume} className="group relative px-8 py-1.5">
              <span className="font-title text-[13px] tracking-[0.5em] text-white/85 uppercase transition-colors group-hover:text-white">
                Lanjutkan
              </span>
              <span className="absolute inset-x-0 bottom-0 h-px origin-center scale-x-50 bg-gradient-to-r from-transparent via-red-400/90 to-transparent transition-transform duration-500 group-hover:scale-x-100" />
            </button>
            <button onClick={restart} className="font-title text-[9px] tracking-[0.35em] text-white/25 uppercase transition-colors hover:text-white/60">
              Mulai ulang
            </button>
            <button onClick={exitSideMode} className="font-title text-[9px] tracking-[0.35em] text-white/25 uppercase transition-colors hover:text-white/60">
              Kembali ke Menu
            </button>
          </div>
        </div>
      )}

      {!started && (
        <Menu
          error={error}
          theme={theme}
          setTheme={setTheme}
          size={size}
          setSize={setSize}
          fx={fx}
          setFx={setFx}
          combatMode={combatMode}
          setCombatMode={chooseCombatMode}
          gameMode={gameMode}
          setGameMode={setGameMode}
          onStart={() => {
            setError('');
            setStarted(true);
          }}
        />
      )}
    </div>
  );
}
