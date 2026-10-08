import { useCallback, useEffect, useRef, useState } from 'react';
import type { Game, TouchAction } from '../game/Game';

/**
 * On-screen mobile controls for NINJA RUN (9:16 portrait frame).
 *
 * The run only needs three verbs — LOMPAT · SERANG · DASH — so those are the big thumb buttons on the
 * right. Guard / Rage / Heal stay reachable as smaller buttons, ◀ ▶ step between the three depth lanes
 * of the flat track, and the play field itself accepts gestures: tap = tebas, swipe up = lompat,
 * swipe down = dash, swipe left/right = pindah jalur. Every control routes into the very same intents
 * the keyboard and mouse use (Game.pressTouch / releaseTouch / changeRunnerLane).
 */

interface PadButtonProps {
  jp: string;
  label: string;
  /** diameter in cqw */
  size: number;
  style: React.CSSProperties;
  onPress: () => void;
  onRelease?: () => void;
  tone?: 'red' | 'steel' | 'amber' | 'green';
  hint?: string;
}

const TONE: Record<string, { ring: string; bg: string; text: string }> = {
  red: { ring: 'rgba(255,90,70,.65)', bg: 'rgba(60,10,10,.55)', text: '#ffe9e2' },
  steel: { ring: 'rgba(220,230,240,.45)', bg: 'rgba(14,16,22,.5)', text: '#eef2f6' },
  amber: { ring: 'rgba(255,196,90,.6)', bg: 'rgba(58,34,6,.5)', text: '#ffeecb' },
  green: { ring: 'rgba(120,235,180,.55)', bg: 'rgba(8,44,30,.5)', text: '#dcffee' },
};

function PadButton({ jp, label, size, style, onPress, onRelease, tone = 'red', hint }: PadButtonProps) {
  const [down, setDown] = useState(false);
  const held = useRef(false);
  const t = TONE[tone];

  const release = useCallback(() => {
    if (!held.current) return;
    held.current = false;
    setDown(false);
    onRelease?.();
  }, [onRelease]);

  // never leave a hold-button stuck down (e.g. the pause overlay opens mid-press)
  useEffect(() => {
    return () => release();
  }, [release]);

  return (
    <button
      type="button"
      aria-label={label}
      onPointerDown={(e) => {
        e.preventDefault(); // suppress the compatibility mouse event → no double trigger on the canvas
        e.stopPropagation(); // keep the game's window-level mousedown listener out of it
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        held.current = true;
        setDown(true);
        onPress();
      }}
      onPointerUp={(e) => {
        e.stopPropagation();
        release();
      }}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
      className="pointer-events-auto absolute flex flex-col items-center justify-center rounded-full backdrop-blur-[2px] transition-[transform,box-shadow,background] duration-75 select-none"
      style={{
        width: `${size}cqw`,
        height: `${size}cqw`,
        border: `1px solid ${t.ring}`,
        background: down ? t.ring : t.bg,
        boxShadow: down ? `0 0 22px ${t.ring}, inset 0 0 18px rgba(0,0,0,.45)` : `0 0 12px rgba(0,0,0,.45), inset 0 0 12px rgba(0,0,0,.35)`,
        transform: down ? 'scale(.93)' : 'scale(1)',
        touchAction: 'none',
        ...style,
      }}
    >
      <span
        className="font-jp leading-none font-extrabold"
        style={{ fontSize: `${size * 0.42}cqw`, color: down ? '#1a0b0b' : t.text, textShadow: down ? 'none' : '0 2px 8px rgba(0,0,0,.9)' }}
      >
        {jp}
      </span>
      <span
        className="font-title mt-[0.6cqw] leading-none tracking-[0.14em] uppercase"
        style={{ fontSize: `${Math.max(6, size * 0.135)}cqw`, color: down ? '#2a1010' : 'rgba(255,255,255,.62)' }}
      >
        {label}
      </span>
      {hint && (
        <span className="font-title leading-none tracking-[0.1em] text-white/35 uppercase" style={{ fontSize: `${Math.max(5, size * 0.1)}cqw` }}>
          {hint}
        </span>
      )}
    </button>
  );
}

interface TouchPadProps {
  game: Game | null;
  paused: boolean;
  /** rage mode is on → a drag over the field steers the cut angle instead of firing a gesture */
  rageOn: boolean;
  dead: boolean;
}

export function TouchPad({ game, paused, rageOn, dead }: TouchPadProps) {
  const press = useCallback((a: TouchAction) => () => game?.pressTouch(a), [game]);
  const release = useCallback((a: TouchAction) => () => game?.releaseTouch(a), [game]);
  const rageRef = useRef(rageOn);
  rageRef.current = rageOn;

  const g = useRef({ id: -1, x0: 0, y0: 0, lx: 0, ly: 0, t0: 0, moved: false });

  const onFieldDown = (e: React.PointerEvent) => {
    if (paused || dead) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    g.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, lx: e.clientX, ly: e.clientY, t0: performance.now(), moved: false };
  };

  const onFieldMove = (e: React.PointerEvent) => {
    if (g.current.id !== e.pointerId) return;
    const dx = e.clientX - g.current.lx;
    const dy = e.clientY - g.current.ly;
    g.current.lx = e.clientX;
    g.current.ly = e.clientY;
    if (Math.hypot(e.clientX - g.current.x0, e.clientY - g.current.y0) > 12) g.current.moved = true;
    // in Rage mode the finger replaces the mouse: it steers the angle of the next slice
    if (rageRef.current && g.current.moved) game?.steerTouch(dx, dy);
  };

  const onFieldUp = (e: React.PointerEvent) => {
    if (g.current.id !== e.pointerId) return;
    const st = g.current;
    g.current.id = -1;
    if (paused || dead || !game) return;
    const dx = e.clientX - st.x0;
    const dy = e.clientY - st.y0;
    const dt = performance.now() - st.t0;
    // A tap on the field is a slash (like a left click). It resolves on release so that a swipe up
    // never fires an attack first — an attack buffered into a jump would turn into a dive. The 斬
    // button is the low-latency path: it fires on press.
    if (Math.hypot(dx, dy) < 22 && dt < 400) {
      game.pressTouch('attack');
      return;
    }
    if (Math.hypot(dx, dy) < 24) return;
    if (Math.abs(dy) > Math.abs(dx)) {
      game.pressTouch(dy < 0 ? 'jump' : 'dash');
    } else {
      game.changeRunnerLane(dx < 0 ? -1 : 1);
    }
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {/* gesture field: sits over the canvas, under the buttons */}
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

      {/* ---- right thumb: the three verbs ---- */}
      <PadButton
        jp="斬"
        label="Serang"
        size={23}
        tone="red"
        style={{ right: '4cqw', bottom: '5cqw' }}
        onPress={press('attack')}
        onRelease={release('attack')}
      />
      <PadButton
        jp="跳"
        label="Lompat"
        size={17}
        tone="steel"
        style={{ right: '7cqw', bottom: '31cqw' }}
        onPress={press('jump')}
      />
      <PadButton
        jp="瞬"
        label="Dash"
        size={16}
        tone="steel"
        style={{ right: '28cqw', bottom: '7cqw' }}
        onPress={press('dash')}
      />

      {/* ---- left thumb: lanes + the Sekiro extras ---- */}
      <PadButton
        jp="◀"
        label="Jalur"
        size={13}
        tone="steel"
        hint="jauh"
        style={{ left: '4cqw', bottom: '5cqw' }}
        onPress={() => game?.changeRunnerLane(-1)}
      />
      <PadButton
        jp="▶"
        label="Jalur"
        size={13}
        tone="steel"
        hint="dekat"
        style={{ left: '19cqw', bottom: '5cqw' }}
        onPress={() => game?.changeRunnerLane(1)}
      />
      <PadButton
        jp="弾"
        label="Guard"
        size={14}
        tone="amber"
        style={{ left: '4cqw', bottom: '22cqw' }}
        onPress={press('guard')}
        onRelease={release('guard')}
      />
      <PadButton
        jp="怒"
        label="Rage"
        size={13}
        tone="red"
        style={{ left: '21cqw', bottom: '24cqw' }}
        onPress={press('rage')}
      />
      <PadButton
        jp="薬"
        label="Heal"
        size={13}
        tone="green"
        style={{ left: '37cqw', bottom: '24cqw' }}
        onPress={press('heal')}
      />
      <PadButton
        jp="蹴"
        label="Tendang"
        size={12}
        tone="amber"
        style={{ left: '38cqw', bottom: '7cqw' }}
        onPress={press('kick')}
      />

      {/* ---- pause: top-right corner, the usual mobile spot and clear of both thumbs ---- */}
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
        className="pointer-events-auto absolute flex items-center justify-center rounded-full border border-white/25 bg-black/55 backdrop-blur-[2px] active:bg-white/25"
        style={{ top: '2cqw', right: '3cqw', width: '9cqw', height: '9cqw', touchAction: 'none' }}
      >
        <span className="flex gap-[0.9cqw]">
          <span className="inline-block h-[3.4cqw] w-[1cqw] bg-white/85" />
          <span className="inline-block h-[3.4cqw] w-[1cqw] bg-white/85" />
        </span>
      </button>
    </div>
  );
}
