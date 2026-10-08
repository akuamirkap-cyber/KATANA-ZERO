import type { Snapshot } from '../game/types';
import { CombatStateTag, HealthBar, Pips, PostureBar, RageUI, ThreatMarkers } from './Hud';

/**
 * Portrait HUD for NINJA RUN — built for the 9:16 phone frame.
 *
 * Everything the player has to read sits in the top third of the screen, because the bottom half
 * belongs to the thumbs (see TouchPad): vitality · posture · rage top-left, distance and style
 * top-right, and the current threat in between. Sizes are in `cqw` units — the phone stage is a CSS
 * container — so the whole HUD scales with the frame instead of the browser window.
 */
export function MobileHud({ s }: { s: Snapshot }) {
  const focus = s.enemies.find((e) => e.focus);
  const others = s.enemies.filter((e) => !e.focus && e.onScreen && e.hp > 0);
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* scrims: the rooftop is bright, so the bars need a little darkness behind them */}
      <div className="absolute inset-x-0 top-0 h-[30%] bg-gradient-to-b from-black/55 via-black/25 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-[22%] bg-gradient-to-t from-black/45 to-transparent" />

      {/* ---------- top-left: the runner's own vitals ---------- */}
      <div className="absolute top-[2.6%] left-[4%]">
        <div className="mb-[1.2cqw] flex items-center gap-[2cqw]">
          <span className="font-jp text-[3cqw] tracking-[0.18em] text-white/70">体力</span>
          <div className="flex items-center gap-[1cqw]" title="Gourd penyembuh">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`h-[3cqw] w-[2.1cqw] rounded-b-full rounded-t-sm border ${
                  i < s.gourds
                    ? 'border-emerald-300 bg-emerald-500/85 shadow-[0_0_6px_rgba(80,255,170,.6)]'
                    : 'border-white/25'
                }`}
              />
            ))}
          </div>
          {s.resurrect > 0 && (
            <div className="flex items-center gap-[0.8cqw]">
              {Array.from({ length: s.resurrect }).map((_, i) => (
                <div
                  key={i}
                  className="h-[1.9cqw] w-[1.9cqw] rotate-45 border border-amber-200 bg-amber-300 shadow-[0_0_6px_rgba(255,220,120,.85)]"
                />
              ))}
            </div>
          )}
        </div>
        <HealthBar v={s.hp} width="48cqw" h="2.9cqw" />
        <div className="mt-[1.4cqw]">
          <PostureBar v={s.posture} broken={s.postureBroken} width="40cqw" h="2.1cqw" />
          <div className="font-jp mt-[0.6cqw] text-[2.2cqw] tracking-[0.4em] text-white/45">体幹</div>
        </div>
        {/* rage: compact, because the RAGE button lives under the thumb */}
        <div className="mt-[1.2cqw] flex items-center gap-[1.4cqw]">
          <span className={`font-jp text-[3.2cqw] leading-none ${s.rage.on ? 'kanji-red' : 'text-red-300/70'}`}>怒</span>
          <div className={`relative h-[1.9cqw] ${s.rage.on ? 'anim-break' : ''}`} style={{ width: '28cqw' }}>
            <div className="absolute inset-0 border border-white/20 bg-black/60" />
            <div
              className="absolute top-0 bottom-0 left-0 transition-[width] duration-100"
              style={{
                width: `${s.rage.meter * 100}%`,
                background: s.rage.on
                  ? 'linear-gradient(90deg,#ff3a2a,#ffa03a)'
                  : s.rage.ready
                    ? 'linear-gradient(90deg,#c02030,#ff6a3a)'
                    : 'linear-gradient(90deg,#4a2a30,#7a3a3a)',
                boxShadow: s.rage.on ? '0 0 12px rgba(255,60,40,.9)' : s.rage.ready ? '0 0 8px rgba(255,90,60,.55)' : 'none',
              }}
            />
          </div>
          {s.rage.ready && !s.rage.on && (
            <span className="font-title text-[2.2cqw] tracking-[0.2em] text-red-200/85 uppercase">siap</span>
          )}
          {s.rage.chain > 1 && <span className="font-jp kanji-red text-[3.4cqw] leading-none">斬×{s.rage.chain}</span>}
        </div>
      </div>

      {/* ---------- top-right: distance, style rank, counters ---------- */}
      <div className="absolute top-[9.5%] right-[4%] text-right">
        <div className="font-title ink-text text-[3.4cqw] tracking-[0.2em] text-white/85 uppercase">{s.stageName}</div>
        <div className="mt-[0.8cqw] ml-auto h-px w-[16cqw] bg-gradient-to-l from-white/30 to-transparent" />
        {s.style.rank && (
          <div
            className="font-title mt-[1cqw] leading-none font-black"
            style={{
              fontSize: '7cqw',
              color: s.style.score > 74 ? '#ffd86a' : s.style.score > 44 ? '#ff8a5a' : '#e8e8f0',
              textShadow: '0 2px 10px rgba(0,0,0,.95)',
              opacity: 0.92,
            }}
          >
            {s.style.rank}
          </div>
        )}
        <div className="font-title mt-[0.6cqw] space-y-[0.2cqw] text-[2.1cqw] tracking-[0.22em] text-white/35 uppercase">
          {(
            [
              ['Deflect', s.stats.deflects],
              ['Deathblow', s.stats.deathblows],
              ['Counter', s.stats.mikiri],
            ] as const
          ).map(([k, n]) => (
            <div key={k} className="flex items-baseline justify-end gap-[1.4cqw]">
              <span>{k}</span>
              <span className="w-[4cqw] text-[2.8cqw] tracking-normal text-white/75">{n}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ---------- lane indicator: three depth lanes on one flat level ---------- */}
      <div className="absolute top-[15%] left-[4%] flex items-center gap-[1.4cqw]">
        <span className="font-title text-[2.1cqw] tracking-[0.24em] text-white/35 uppercase">jalur</span>
        {/* left diamond = jalur jauh (menjauh dari kamera), right = jalur dekat */}
        {([-1, 0, 1] as const).map((lane) => (
          <span
            key={lane}
            className={`h-[1.6cqw] w-[1.6cqw] rotate-45 border transition-colors ${
              s.lane === lane ? 'border-red-300 bg-red-500/90 shadow-[0_0_7px_rgba(255,60,40,.8)]' : 'border-white/25'
            }`}
          />
        ))}
      </div>

      {/* ---------- the threat being focused ---------- */}
      {focus && !s.dead && !s.rage.aim && (
        <div className="absolute top-[25%] left-1/2 -translate-x-1/2 text-center">
          <div className="mb-[1cqw] flex items-center justify-center gap-[2cqw]">
            <span className="font-title ink-text text-[3cqw] tracking-[0.2em] text-white/90 uppercase">{focus.name}</span>
            <Pips n={focus.pips} max={focus.maxPips} />
          </div>
          {focus.combatTell && (
            <div className="mb-[1cqw]">
              <CombatStateTag tell={focus.combatTell} compact />
            </div>
          )}
          <PostureBar v={focus.posture} broken={focus.broken} width="66cqw" h="2.2cqw" />
          <div className="mt-[1cqw] flex justify-center">
            <HealthBar v={focus.hp} width="66cqw" h="2.2cqw" />
          </div>
          {focus.broken && (
            <div className="font-jp kanji-red anim-break mt-[1cqw] text-[4cqw] tracking-[0.3em]">
              {focus.lethal ? '無防備' : '体幹崩れ'}
            </div>
          )}
        </div>
      )}

      {/* ---------- everybody else on screen ---------- */}
      {others.map((e) => (
        <div key={e.id} className="absolute -translate-x-1/2" style={{ left: e.x, top: e.y }}>
          {e.combatTell && (
            <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap">
              <CombatStateTag tell={e.combatTell} compact />
            </div>
          )}
          <PostureBar v={e.posture} broken={e.broken} width="18cqw" h="1.3cqw" />
          <div className="mt-[0.6cqw]">
            <HealthBar v={e.hp} width="18cqw" h="1.3cqw" />
          </div>
        </div>
      ))}

      <ThreatMarkers enemies={s.enemies} />

      {/* lock-on reticle */}
      {s.lock && !s.rage.aim && (
        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={{ left: s.lock.x, top: s.lock.y }}>
          <div className="h-[2.4cqw] w-[2.4cqw] rounded-full bg-red-600 shadow-[0_0_10px_3px_rgba(255,30,30,.75)] ring-1 ring-red-200/60" />
        </div>
      )}

      {/* perilous attack warning */}
      {s.perilous && (
        <div
          key={s.perilous.id}
          className="absolute"
          style={{ left: s.perilous.x, top: Math.max(120, s.perilous.y - 26), animation: 'periloPop .35s ease-out forwards' }}
        >
          <div className="font-jp kanji-red text-center text-[16cqw] leading-none font-extrabold">危</div>
          <div className="font-title ink-text mt-[0.4cqw] text-center text-[2.4cqw] font-bold tracking-[0.2em] whitespace-nowrap text-red-200 uppercase">
            {s.perilous.kind === 'thrust' ? 'Tusukan · Dash' : 'Sapuan · Lompat'}
          </div>
        </div>
      )}

      {/* contextual prompt — kept above the thumb zone */}
      {s.prompt && (
        <div className="font-title absolute top-[42%] left-1/2 -translate-x-1/2 rounded-lg border border-red-500/40 bg-black/75 px-[4cqw] py-[1.6cqw] text-center text-[2.9cqw] tracking-wider text-red-100 shadow-[0_0_20px_rgba(200,0,0,.35)] backdrop-blur-md select-none">
          {s.prompt}
        </div>
      )}

      <RageUI r={s.rage} />

      {/* cinematic letterbox */}
      {s.cine > 0.02 && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black" style={{ height: `${s.cine * 9}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${s.cine * 9}%` }} />
        </>
      )}
    </div>
  );
}
