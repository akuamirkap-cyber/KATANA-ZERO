import { useCallback, useEffect, useRef, useState } from 'react';
import { Game } from './game/Game';
import type { SizeMode, FxStyle } from './game/Game';
import type { CombatMode, GameEvent, Snapshot } from './game/types';
import type { Theme } from './game/world';
import { Hud } from './components/Hud';
import { TouchPad } from './components/TouchPad';

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
      <div
        className={`anim-side font-title font-bold text-emerald-300 text-lg`}
        style={{ ['--dur' as string]: dur }}
      >
        +{t.n} HP
      </div>
    );
  }
  const d = map[t.type];
  if (!d) return null;
  return (
    <div className="anim-side flex items-baseline gap-2" style={{ ['--dur' as string]: dur }}>
      <span
        className={`font-jp font-extrabold text-4xl`}
        style={{ color: d.col, textShadow: `0 0 12px ${d.glow}, 0 2px 6px rgba(0,0,0,.9)` }}
      >
        {d.jp}
      </span>
      {t.n && t.n > 1 ? (
        <span className={`font-title font-bold text-amber-300 text-xl`}>×{t.n}</span>
      ) : null}
      {d.sub ? (
        <span className={`font-title tracking-[0.3em] text-white/55 uppercase text-[10px]`}>
          {d.sub}
        </span>
      ) : null}
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
        <div className={`absolute inset-x-0 text-center top-[13%]`}>
          <div className={`absolute top-1/2 w-full -translate-y-1/2 overflow-hidden h-16`}>
            <div
              className="absolute inset-y-0 w-full bg-gradient-to-r from-transparent via-red-600/45 to-transparent"
              style={{ animation: 'slashLine .5s ease-out forwards' }}
            />
          </div>
          <div
            className={`font-jp kanji-red anim-slam-s leading-none font-extrabold text-[clamp(56px,9vw,120px)]`}
            style={s}
          >
            忍殺
          </div>
        </div>
      );
    case 'perfect':
      return (
        <div className={`absolute inset-x-0 text-center top-[12%]`}>
          <div
            className={`font-jp anim-slam-s leading-none font-extrabold text-white drop-shadow-[0_0_26px_rgba(255,60,40,.9)] text-[clamp(60px,10vw,132px)]`}
            style={s}
          >
            斬
          </div>
          <div className={`font-title anim-side tracking-[0.5em] text-amber-200 uppercase text-sm`} style={s}>
            Perfect · +HP
          </div>
        </div>
      );
    case 'rage':
      return (
        <div className={`absolute inset-x-0 text-center top-[12%]`}>
          <div className={`font-jp kanji-red anim-slam-s leading-none font-extrabold text-[clamp(52px,8vw,110px)]`} style={s}>
            怒
          </div>
          <div className={`font-title anim-side tracking-[0.5em] text-red-200 uppercase text-xs`} style={s}>
            Raiden · Rage Mode
          </div>
        </div>
      );
    case 'enemyBreak':
      return (
        <div className={`absolute inset-x-0 text-center top-[17%]`}>
          <div
            className={`font-jp anim-slam-s font-extrabold tracking-[0.3em] text-white drop-shadow-[0_0_12px_rgba(255,255,255,.8)] text-3xl`}
            style={s}
          >
            体幹崩し
          </div>
          <div className={`font-title tracking-[0.4em] text-white/65 uppercase text-[10px]`}>
            Serang untuk Deathblow
          </div>
        </div>
      );
    case 'playerBreak':
      return (
        <div className={`absolute inset-x-0 text-center top-[17%]`}>
          <div
            className={`font-title anim-slam-s font-bold tracking-[0.3em] text-red-400 uppercase text-xl`}
            style={s}
          >
            Postur hancur!
          </div>
        </div>
      );
    case 'rageLow':
      return (
        <div className="absolute inset-x-0 bottom-[26%] text-center">
          <div className={`font-title anim-side tracking-[0.35em] text-red-300 uppercase text-xs`} style={s}>
            Rage belum cukup
          </div>
        </div>
      );
    case 'stage':
      return (
        <div className={`absolute inset-x-0 text-center top-[15%]`}>
          <div className={`font-jp anim-banner tracking-[0.6em] text-white/55 text-[10px]`}>決闘</div>
          <div
            className={`font-title anim-banner ink-text mt-1 font-bold tracking-[0.3em] whitespace-nowrap text-white uppercase text-2xl`}
           
          >
            {t.text}
          </div>
        </div>
      );
    case 'stageClear':
      return (
        <div className={`absolute inset-x-0 text-center top-[14%]`}>
          <div className={`font-jp kanji-red anim-banner font-extrabold text-5xl`}>
            撃破
          </div>
          <div className={`font-title anim-banner mt-1 tracking-[0.4em] text-white/75 uppercase text-xs`}>
            +HP · +Gourd
          </div>
        </div>
      );
    case 'phase2':
      return (
        <div className={`absolute inset-x-0 text-center top-[14%]`}>
          <div className={`font-jp kanji-red anim-banner font-extrabold text-4xl`}>鬼</div>
          <div className={`font-title anim-banner mt-1 tracking-[0.4em] text-red-200 uppercase text-xs`}>
            {t.text}
          </div>
        </div>
      );
    case 'resurrect':
      return (
        <div className={`absolute inset-x-0 text-center top-[14%]`}>
          <div
            className={`font-jp anim-banner font-extrabold text-amber-200 drop-shadow-[0_0_20px_rgba(255,220,120,.9)] text-5xl`}
           
          >
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
      <div
        className="absolute top-1/2 left-6 flex -translate-y-1/2 flex-col items-start gap-1"
      >
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
  ['Stick kiri', 'Jalan — layar sentuh, sama saja dengan W A S D'],
  ['Tombol kanan', '斬 serang · 瞬 dash · 跳 lompat · 弾 guard · 蹴 tendang · 怒 rage · 薬 heal · ◎ ganti target'],
  ['Tap layar', 'Tebas · swipe atas = lompat · swipe bawah = dash · swipe kiri/kanan = ganti target'],
  ['W A S D', 'Bergerak · Shift sprint (badan merendah, pedang terseret di belakang) · jalan ke undakan rendah = naik otomatis'],
  ['Mouse', 'Kamera'],
  ['Klik kiri', 'Tebas — combo 5 serangan'],
  ['Klik kanan tahan', 'Guard depan · ketuk saat benturan = Deflect'],
  ['C', 'Dodge / Mikiri saat tusukan · mundur = backflip'],
  ['E', 'Lompat · tekan 2× = double jump · arah lompat ikut stick (bukan lock) · serang di udara ditahan sampai mendarat'],
  ['C di udara', 'Roll depan (air dash) · sesudahnya 斬 = 1 tebasan terbang sekuat tendangan'],
  ['Lompat ke atap', 'Mantle: undakan ≤ 0,95 m dinaiki sambil jalan, yang lebih tinggi ditangkap tangan saat kamu melompat ke arahnya'],
  ['V', 'Tendangan keras — tembus tangkisan'],
  ['Klik tengah', 'Tancap pedang → tendang lepas, musuh terjungkal'],
  ['F / K', 'Tahan = guard · Rage: tebasan terakhir'],
  ['H', 'Gourd penyembuh · R bangkit'],
  ['Q / Tab', 'Lock-on · ganti target'],
  ['G', 'Freestyle bilah'],
  ['P / Esc', 'Jeda · pilih BEFORE / AFTER untuk membandingkan combat'],
];

const RAGE_HELP: [string, string][] = [
  ['Tombol 怒 / Space', 'Mode Raiden / Rage — waktu melambat'],
  ['Ketuk klik kiri', 'Slice: membelah tubuh sesuai arah tebasan'],
  ['Klik kanan / tombol 弾', 'Tebasan terakhir — garis kuning, slow-mo usai'],
  ['Geser jari / mouse', 'Mengarahkan sudut tebasan selama Rage aktif'],
];

const RULES: [string, string][] = [
  ['一', 'Kurogane adalah bos pembuka Stage I: baca ayunan pedang panjangnya. Duel ini dimenangkan lewat timing, bukan memanjat bos.'],
  ['二', 'AFTER: guard dari depan menahan tebasan; ketuk dekat benturan untuk Deflect. Serangan dari belakang melewati guard.'],
  ['三', 'Tusukan: Deflect tepat atau Mikiri (C). Sapuan rendah: lompat (E) atau dodge. Guard tidak menghentikan keduanya.'],
  ['四', 'Tebasan mengikuti arah hadap/lock-on dan hanya efektif dari jarak dekat. Musuh menampilkan GUARD, PARRY, atau CELAH saat mode AFTER aktif.'],
  ['五', 'Pecah GUARD dengan tendang (V) atau tebas berat A5; jangan spam slash ke PARRY—tunggu CELAH atau tendang. Pemanah/penembak menekan dari jauh, jadi terus bergerak mendekat.'],
  ['六', 'Deflect, Mikiri, Deathblow, dan kill mengisi Rage; tenangkan postur dengan guard saat aman. Rage tetap mode slow-motion terpisah.'],
  ['七', 'Tidak ada lagi mencocor dari udara. Lompat lalu tekan serang tidak mengeluarkan apa-apa — kecuali musuh sudah masuk jangkauan pedang: tebasan ditahan (bilah menyala) dan baru keluar begitu kaki menyentuh tanah.'],
  ['八', 'Satu-satunya serangan udara adalah sesudah roll depan (C di udara): SATU tebasan terbang, sekali saja, sekuat tendangan — damage kecil tetapi postur musuh jebol, lalu kamu jatuh dan mendarat.'],
  ['九', 'Musuh sekarang lebih galak sekaligus lebih rapat bertahan: sampai tiga bilah menekan bersamaan, jeda antar serangan lebih pendek, ayunan mereka lebih cepat, guard dan parry lebih lama serta lebih sering, dan postur mereka pulih lebih cepat. Jebol pertahanan dengan tendang (V), deflect, Mikiri, atau tebasan terbang.'],
  ['十', 'Lompat ya lompat: di udara tubuh dan kepala menghadap arah gerak (stick), bukan musuh — kamera tetap mengunci target. Double jump mendorong ke arah yang kamu tekan, salto mengikuti arah itu, dan pendaratan menekuk sedalam jatuhmu (jatuh dari atap = kompresi berat, lengan terbuka, debu lebih lama).'],
  ['十一', 'Sistem gerak diperhalus: ada dorongan awal (badan memanjang, langkah pertama lebih panjang), pengereman (badan menahan ke belakang, tumit menjejak lebih depan), dan potong arah (bahu memuntir melawan belokan lalu melepas, kaki menyilang, badan miring ke dalam belokan). Kepala distabilkan terhadap ayunan langkah dan mengangkat dagu saat sprint.'],
  ['十二', 'Kamera ikut aturan lompat: saat double jump kamera melepas lock dan berayun ke belakang arah gerak, lalu mengunci lagi begitu kaki menyentuh tanah.'],
  ['十三', 'Atap Kota Putih benar-benar bisa dipanjat. Undakan setinggi lutut sampai pinggang dinaiki sambil jalan (kaki depan mengangkat, pinggul naik, badan condong ke undakan); yang lebih tinggi ditangkap dengan mantle saat melompat ke arahnya — tarik, lalu lutut depan naik ke bibir atap. Telapak kaki sekarang mengikuti permukaan: tumit yang melewati bibir atap meraih ke bawah dan menegang, bukan mengambang di udara.'],
  ['十四', 'Lari dirombak total ala Black Myth: Wukong. Langkah jadi pendek dan berputar cepat (bukan langkah panjang yang melayang), ada fase kedua kaki lepas tanah saat sprint, pinggul memantul dua kali per langkah, badan merendah dan condong jauh ke depan, ayunan lengan lebar dengan garis bahu yang berputar melawan langkah. Pedang selalu dibawa RENDAH dan TERTINGGAL DI BELAKANG badan pada semua kecepatan lari — bilahnya menyapu mengikuti irama langkah, seperti tongkat yang diseret. Akselerasi sprint menyentak dan rem lebih pakem, kamera ikut mendekat, FOV melebar, naik-turun tiap tapak dan miring halus tiap langkah, afterimage keluar lebih awal, dan setiap tapak sprint melempar debu lebih banyak.'],
];

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
      <div className={`text-center leading-relaxed text-white/40 ${'max-w-[min(92vw,440px)] text-[10px]'}`}>
        {mode === 'before'
          ? 'BEFORE: auto-aim dekat, respons acak, guard dasar.'
          : 'AFTER: aim disengaja, counter per ancaman, celah dan guard terbaca.'}
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
  touch,
  setTouch,
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
  touch: boolean;
  setTouch: (on: boolean) => void;
}) {
  const [sheet, setSheet] = useState<null | 'controls' | 'rules'>(null);
  return (
    <div className="absolute inset-0 z-30 overflow-y-auto bg-[#05040a] overscroll-contain">
      {/* dusk haze + ink vignette */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_118%,#86303a_0%,#3a1424_28%,#120a16_58%,#05040a_100%)]" />
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_50%,transparent_35%,rgba(0,0,0,.85)_100%)]" />
      <Embers />
      {/* cinematic bars */}
      <div className="absolute inset-x-0 top-0 h-[7vh] bg-black" />
      <div className="absolute inset-x-0 bottom-0 h-[7vh] bg-black" />

      {/* title block — grows to the full height so the menu can scroll on a small phone screen */}
      <div className="relative flex min-h-full flex-col items-center justify-center px-6 py-[9vh]">
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
            Duel pedang shinobi · bisa dimainkan dengan sentuhan
          </div>
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
              Mulai Duel
            </span>
            <span className="absolute inset-x-0 bottom-0 h-px origin-center scale-x-50 bg-gradient-to-r from-transparent via-red-400/90 to-transparent transition-transform duration-500 group-hover:scale-x-100" />
          </button>

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

          {/* touch controls */}
          <div className="flex flex-col items-center gap-2">
            <div className="font-title text-[9px] tracking-[0.45em] text-white/22 uppercase">Kontrol</div>
            <div className="flex items-center gap-6">
              {([
                [true, '指', 'Tombol Layar'],
                [false, '鍵', 'Keyboard + Mouse'],
              ] as const).map(([on, jp, label]) => (
                <button key={label} onClick={() => setTouch(on)} className="group relative flex items-center gap-2 pb-1.5">
                  <span className={`font-jp text-sm transition-colors ${touch === on ? 'text-red-300' : 'text-white/30 group-hover:text-white/60'}`}>
                    {jp}
                  </span>
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      touch === on ? 'text-white/85' : 'text-white/28 group-hover:text-white/55'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      touch === on ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
            <div className="font-title text-[9px] tracking-[0.16em] text-white/28">
              Tombol layar juga jalan dengan mouse · joystick kiri = gerak · kamera otomatis mengunci musuh
            </div>
          </div>

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
        {touch ? 'Tombol layar aktif · kamera mengunci musuh · jeda di bawah tengah' : 'Kursor terkunci saat mulai · Esc untuk jeda'}
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
                  {CONTROLS.slice(0, 9).map(([k, v]) => (
                    <KeyRow key={k} k={k} v={v} />
                  ))}
                </ul>
                <ul>
                  {CONTROLS.slice(9).map(([k, v]) => (
                    <KeyRow key={k} k={k} v={v} />
                  ))}
                </ul>
                <div className="mt-5 md:col-span-2">
                  <div className="font-jp mb-2 text-xs tracking-[0.4em] text-red-400/80">
                    怒 · RAIDEN / RAGE
                  </div>
                  <ul>
                    {RAGE_HELP.map(([k, v]) => (
                      <KeyRow key={k} k={k} v={v} />
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <ul className="space-y-3">
                {RULES.map(([n, v]) => (
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
  const [touch, setTouchState] = useState(true);
  const touchRef = useRef(true);
  /** flipping the pad also hands the pointer lock over (or takes it back) */
  const setTouch = useCallback((on: boolean) => {
    touchRef.current = on;
    setTouchState(on);
    gameRef.current?.setTouchControls(on);
  }, []);
  const [coarse] = useState(() =>
    typeof window === 'undefined' ? false : !!window.matchMedia?.('(pointer: coarse)').matches,
  );
  fxRef.current = fx;
  combatModeRef.current = combatMode;
  const [shakeLvl, setShakeLvl] = useState(1);
  const shakeRef = useRef(1);
  shakeRef.current = shakeLvl;
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Game | null>(null);
  /** same instance as gameRef, but as state so the touch pad re-renders once the game exists */
  const [gameInst, setGameInst] = useState<Game | null>(null);
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
      g = new Game(containerRef.current, onEvent, themeRef.current, sizeRef.current, fxRef.current, combatModeRef.current);
    } catch (err) {
      setError('WebGL tidak tersedia di perangkat ini: ' + String(err));
      setStarted(false);
      return;
    }
    gameRef.current = g;
    setGameInst(g);
    g.setShakeScale(shakeRef.current);
    g.setTouchControls(touchRef.current);
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
      setGameInst(null);
    };
  }, [started, gameKey, onEvent]);

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
  }, [restart]);

  const resume = () => {
    setPaused(false);
    gameRef.current?.setPaused(false);
  };

  const exitToMenu = useCallback(() => {
    setStarted(false);
    setPaused(false);
    setVictory(false);
    setSnap(null);
    snapRef.current = null;
    setToasts([]);
  }, []);

  const dead = !!snap?.dead;
  const touchPadOn = touch && !victory;

  /** Every in-game layer: canvas, HUD, callouts, the touch pad and the modal overlays. */
  const stage = (
    <>
      {started && <div ref={containerRef} className="absolute inset-0" />}

      {/* with the pad on screen the HUD lifts its bars out of the thumbs' way */}
      {started && snap && <Hud s={snap} touch={touchPadOn} />}

      {started && <Callouts toasts={toasts} />}

      {/* two-thumb controls, only while the fight is live */}
      {started && touchPadOn && !paused && !victory && !dead && (
        <TouchPad
          game={gameInst}
          paused={paused}
          rageOn={!!snap?.rage.on}
          dead={dead}
          gestures={coarse}
          lockOn={!!snap?.lockOn}
          multiTarget={(snap?.enemies.length ?? 0) > 1}
        />
      )}

      {/* death */}
      {started && dead && !victory && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/55">
          <div
            className="font-jp kanji-red leading-none text-[clamp(140px,30vw,380px)] font-extrabold"
            style={{ animation: 'deathIn 1.6s ease-out forwards' }}
          >
            死
          </div>
          <div
            className="font-title mt-4 text-sm tracking-[0.5em] text-white/70 uppercase"
            style={{ animation: 'fadeIn 2s 1s both' }}
          >
            {snap?.canRevive ? 'Bangkit — tekan R' : snap && snap.resurrect > 0 ? '…' : 'Ulang — tekan R'}
          </div>
          {/* a thumb can reach this too: no keyboard on a phone */}
          {snap?.canRevive && (
            <button
              onClick={() => {
                gameRef.current?.revivePlayer();
                setToasts([]);
              }}
              className="font-title pointer-events-auto mt-6 border border-amber-300/60 bg-amber-900/35 px-8 py-2 text-sm tracking-[0.35em] text-amber-100 uppercase hover:bg-amber-700/50"
              style={{ animation: 'fadeIn 1.4s 1.1s both' }}
            >
              復活 · Bangkit
            </button>
          )}
          {snap && snap.resurrect === 0 && (
            <button
              onClick={restart}
              className="font-title pointer-events-auto mt-6 border border-red-500/60 bg-red-950/60 px-8 py-2 text-sm tracking-[0.35em] text-red-100 uppercase hover:bg-red-700/60"
              style={{ animation: 'fadeIn 2s 1.4s both' }}
            >
              Ulangi
            </button>
          )}
          <button onClick={exitToMenu} className="font-title pointer-events-auto mt-4 text-[10px] tracking-[0.3em] text-white/45 uppercase hover:text-white/85">Kembali ke Menu</button>
        </div>
      )}

      {/* victory */}
      {started && victory && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/70 px-6 text-center" style={{ animation: 'fadeIn 1.5s both' }}>
          <div
            className="font-jp leading-none text-[clamp(100px,20vw,240px)] font-extrabold text-amber-100 drop-shadow-[0_0_40px_rgba(255,200,100,.7)]"
          >
            勝利
          </div>
          <div className="font-title mt-3 text-lg tracking-[0.5em] text-white/90 uppercase">
            Sang jenderal telah tumbang
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
            Duel Lagi
          </button>
          <button onClick={exitToMenu} className="font-title mt-4 text-[10px] tracking-[0.3em] text-white/45 uppercase hover:text-white/85">Kembali ke Menu</button>
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

          {/* the pad can be switched without leaving the fight */}
          <div className="anim-soft pointer-events-auto mt-8 flex flex-col items-center" style={{ animationDelay: '.18s' }}>
            <div className="font-title mb-3 text-[9px] tracking-[0.4em] text-white/25 uppercase">Kontrol</div>
            <div className="flex gap-6">
              {([
                ['Tombol layar', true],
                ['Keyboard + mouse', false],
              ] as [string, boolean][]).map(([label, on]) => (
                <button key={label} onClick={() => setTouch(on)} className="group relative pb-1.5">
                  <span
                    className={`font-title text-[10px] tracking-[0.3em] uppercase transition-colors ${
                      touch === on ? 'text-red-200' : 'text-white/30 group-hover:text-white/60'
                    }`}
                  >
                    {label}
                  </span>
                  <span
                    className={`absolute inset-x-0 bottom-0 h-px transition-transform duration-300 ${
                      touch === on ? 'scale-x-100 bg-red-400/80' : 'scale-x-0 bg-white/40 group-hover:scale-x-100'
                    }`}
                  />
                </button>
              ))}
            </div>
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
            <button onClick={exitToMenu} className="font-title text-[9px] tracking-[0.35em] text-white/25 uppercase transition-colors hover:text-white/60">
              Kembali ke Menu
            </button>
          </div>
        </div>
      )}

    </>
  );

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {started && <div className="absolute inset-0">{stage}</div>}
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
          touch={touch}
          setTouch={setTouch}
          onStart={() => {
            setError('');
            setStarted(true);
          }}
        />
      )}
    </div>
  );
}
