import { useRef, useState } from 'react';
import type { Game, TouchAction } from '../game/Game';

/*
 * On-screen controls for the duel.
 *
 * Left thumb  : a virtual stick that walks the arena (it feeds the very same axes as WASD).
 * Right thumb : the verb cluster — tebas, dash, lompat, guard, tendang, Rage, heal, ganti target.
 * The camera auto-locks onto the target, so no thumb ever has to steer it; the ◎ button hops to the
 * next enemy when a stage has more than one. Every button fires the same intent as its key binding,
 * so a mouse/keyboard player and a touch player are playing the identical game.
 *
 * Sizes are in vmin because the duel fills the whole window (landscape or portrait, it always has a
 * shorter axis to size against).
 */

type Tone = 'red' | 'steel' | 'gold' | 'green';

const TONE: Record<Tone, string> = {
  red: 'border-red-400/60 bg-red-950/55 text-red-50 shadow-[0_0_18px_rgba(255,60,40,.3)]',
  steel: 'border-sky-200/40 bg-slate-900/55 text-sky-50 shadow-[0_0_14px_rgba(90,160,255,.22)]',
  gold: 'border-amber-200/55 bg-amber-950/50 text-amber-50 shadow-[0_0_16px_rgba(255,200,90,.26)]',
  green: 'border-emerald-300/50 bg-emerald-950/50 text-emerald-50 shadow-[0_0_14px_rgba(80,255,170,.24)]',
};

interface PadButtonProps {
  jp: string;
  label: string;
  /** diameter in vmin */
  size: number;
  tone?: Tone;
  style?: React.CSSProperties;
  onPress: () => void;
  onRelease?: () => void;
  dim?: boolean;
}

function PadButton({ jp, label, size, tone = 'steel', style, onPress, onRelease, dim }: PadButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onPress();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        onRelease?.();
      }}
      onPointerCancel={() => onRelease?.()}
      onPointerLeave={() => onRelease?.()}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className={`font-jp pointer-events-auto absolute flex items-center justify-center rounded-full border backdrop-blur-[2px] transition-transform duration-75 select-none active:scale-95 ${TONE[tone]} ${dim ? 'opacity-35' : ''}`}
      style={{ width: `${size}vmin`, height: `${size}vmin`, touchAction: 'none', ...style }}
    >
      <span className="flex flex-col items-center leading-none">
        <span style={{ fontSize: `${size * 0.4}vmin` }}>{jp}</span>
        <span
          className="font-title mt-[0.7vmin] tracking-[0.14em] uppercase"
          style={{ fontSize: `${Math.max(1.4, size * 0.135)}vmin` }}
        >
          {label}
        </span>
      </span>
    </button>
  );
}

/** Analog thumb stick. Dead-zoned, clamped to its base, and released the moment the finger lifts. */
function Stick({ game, disabled }: { game: Game | null; disabled: boolean }) {
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const id = useRef(-1);
  const c = useRef({ x: 0, y: 0, r: 1 });

  const apply = (px: number, py: number) => {
    const dx = px - c.current.x;
    const dy = py - c.current.y;
    const d = Math.hypot(dx, dy) || 1e-4;
    const clamped = Math.min(d, c.current.r);
    const ux = dx / d;
    const uy = dy / d;
    setKnob({ x: ux * clamped, y: uy * clamped });
    // a small dead zone keeps the fighter standing still when the thumb merely rests on the stick
    const n = clamped / c.current.r;
    const dead = 0.16;
    const k = n <= dead ? 0 : (n - dead) / (1 - dead);
    // screen y grows downward, but "forward" is +z away from the camera → flip it
    game?.setTouchMove(ux * k, -uy * k);
  };
  const end = () => {
    id.current = -1;
    setKnob({ x: 0, y: 0 });
    game?.setTouchMove(0, 0);
  };

  return (
    <div
      className="pointer-events-auto absolute rounded-full border border-white/15 bg-white/[0.045]"
      style={{ left: '3.5vmin', bottom: '3.5vmin', width: '28vmin', height: '28vmin', touchAction: 'none' }}
      onPointerDown={(e) => {
        if (disabled) return;
        e.preventDefault();
        e.stopPropagation();
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        c.current = { x: r.left + r.width / 2, y: r.top + r.height / 2, r: r.width * 0.31 };
        id.current = e.pointerId;
        apply(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (id.current !== e.pointerId) return;
        e.stopPropagation();
        apply(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        if (id.current === e.pointerId) end();
      }}
      onPointerCancel={() => end()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-px w-[58%] bg-white/10" />
      </div>
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="h-[58%] w-px bg-white/10" />
      </div>
      <div
        className="absolute rounded-full border border-white/45 bg-white/15 shadow-[0_0_16px_rgba(120,180,255,.35)]"
        style={{
          width: '11vmin',
          height: '11vmin',
          left: `calc(50% + ${knob.x}px)`,
          top: `calc(50% + ${knob.y}px)`,
          transform: 'translate(-50%,-50%)',
        }}
      />
      <span className="font-title absolute -top-[3.6vmin] left-1/2 -translate-x-1/2 text-[1.5vmin] tracking-[0.3em] text-white/28 uppercase">
        gerak
      </span>
    </div>
  );
}

export interface TouchPadProps {
  game: Game | null;
  paused: boolean;
  rageOn: boolean;
  dead: boolean;
  /** true on touch devices: also lay a gesture field over the canvas (tap = tebas, swipe = aksi) */
  gestures: boolean;
  lockOn: boolean;
  /** more than one live enemy → the target-hop button matters */
  multiTarget: boolean;
}

export function TouchPad({ game, paused, rageOn, dead, gestures, lockOn, multiTarget }: TouchPadProps) {
  const press = (a: TouchAction) => () => game?.pressTouch(a);
  const release = (a: TouchAction) => () => game?.releaseTouch(a);
  const rageRef = useRef(rageOn);
  rageRef.current = rageOn;
  const g = useRef({ id: -1, x0: 0, y0: 0, lx: 0, ly: 0, t0: 0, moved: false });

  const onFieldDown = (e: React.PointerEvent) => {
    if (paused || dead) return;
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: false };
  };

  const onFieldMove = (e: React.PointerEvent) => {
    if (g.current.id !== e.pointerId) return;
    const dx = e.clientX - g.current.lx;
    const dy = e.clientY - g.current.ly;
    g.current.lx = e.clientX;
    g.current.ly = e.clientY;
    if (Math.hypot(e.clientX - g.current.x0, e.clientY - g.current.y0) > 12) g.current.moved = true;
    // in Rage the finger replaces the mouse: it steers the angle of the next slice
    if (rageRef.current && g.current.moved) game?.steerTouch(dx, dy);
  };

  const onFieldUp = (e: React.PointerEvent) => {
    if (g.current.id !== e.pointerId) return;
    const st = g.current;
    g.current.id = -1;
    if (paused || dead || !game) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    const d = Math.hypot(dx, dy);
    const dt = performance.now() - st.t0;
    // A tap is a slash (like a left click) and resolves on release, so a swipe up can never sneak an
    // attack in first — an attack buffered into a jump turns into a dive. 斬 stays the fast path.
    if (d < 22 && dt < 400) {
      game.pressTouch('attack');
      return;
    }
    if (d < 26) return;
    if (Math.abs(dy) > Math.abs(dx)) game.pressTouch(dy < 0 ? 'jump' : 'dash');
    else game.pressTouch('target');
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {gestures && (
        <div
          className="pointer-events-auto absolute inset-0"
          style={{ touchAction: 'none' }}
          onPointerDown={onFieldDown}
          onPointerMove={onFieldMove}
          onPointerUp={onFieldUp}
          onPointerCancel={onFieldUp}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseMove={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        />
      )}

      <Stick game={game} disabled={paused || dead} />

      {/* ---- right thumb: the verbs, arced around the big attack button ---- */}
      <PadButton
        jp="斬"
        label="Serang"
        size={16}
        tone="red"
        style={{ right: '3.5vmin', bottom: '4vmin' }}
        onPress={press('attack')}
        onRelease={release('attack')}
      />
      <PadButton
        jp="瞬"
        label="Dash"
        size={11}
        style={{ right: '21vmin', bottom: '4.5vmin' }}
        onPress={press('dash')}
      />
      <PadButton
        jp="跳"
        label="Lompat"
        size={11}
        style={{ right: '5vmin', bottom: '21.5vmin' }}
        onPress={press('jump')}
      />
      <PadButton
        jp={rageOn ? '決' : '弾'}
        label={rageOn ? 'Tebas akhir' : 'Guard'}
        size={10.5}
        tone={rageOn ? 'gold' : 'steel'}
        style={{ right: '20vmin', bottom: '18vmin' }}
        onPress={press('guard')}
        onRelease={release('guard')}
      />
      <PadButton
        jp="蹴"
        label="Tendang"
        size={9}
        style={{ right: '33.5vmin', bottom: '6vmin' }}
        onPress={press('kick')}
      />
      <PadButton
        jp="怒"
        label="Rage"
        size={9}
        tone={rageOn ? 'red' : 'gold'}
        style={{ right: '33vmin', bottom: '18.5vmin' }}
        onPress={press('rage')}
      />
      <PadButton
        jp="薬"
        label="Heal"
        size={9}
        tone="green"
        style={{ right: '12vmin', bottom: '34vmin' }}
        onPress={press('heal')}
      />
      <PadButton
        jp="◎"
        label="Target"
        size={9}
        style={{ right: '23vmin', bottom: '32vmin' }}
        onPress={press('target')}
        dim={!multiTarget && lockOn}
      />

      {/* ---- pause: bottom centre, out of both thumbs' way ---- */}
      <button
        type="button"
        aria-label="Jeda"
        onPointerDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
          game?.pressTouch('pause');
        }}
        onMouseDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
        className="font-title pointer-events-auto absolute flex items-center gap-[1vmin] rounded-full border border-white/25 bg-black/55 px-[2.6vmin] py-[1.1vmin] tracking-[0.26em] text-white/70 uppercase backdrop-blur-[2px] active:bg-white/20"
        style={{ left: '50%', bottom: '2vmin', transform: 'translateX(-50%)', fontSize: '1.7vmin', touchAction: 'none' }}
      >
        <span className="flex gap-[0.5vmin]">
          <span className="inline-block h-[2.2vmin] w-[0.6vmin] bg-white/85" />
          <span className="inline-block h-[2.2vmin] w-[0.6vmin] bg-white/85" />
        </span>
        jeda
      </button>
    </div>
  );
}
