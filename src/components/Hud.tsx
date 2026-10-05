import type { Snapshot, EnemyView } from '../game/types';

function postureColor(v: number, broken: boolean) {
  if (broken) return 'linear-gradient(180deg,#ff5a3c,#c01818)';
  if (v > 0.8) return 'linear-gradient(180deg,#ffb04a,#e0481c)';
  if (v > 0.5) return 'linear-gradient(180deg,#fff0c8,#f0b040)';
  return 'linear-gradient(180deg,#ffffff,#d8d8e0)';
}

/** Posture bar that grows from the center outward — the Sekiro look. Hairline frame, soft glow, tapered ends. */
function PostureBar({ v, broken, width, h = 8 }: { v: number; broken: boolean; width: number; h?: number }) {
  const w = Math.max(0, Math.min(1, v)) * 100;
  return (
    <div
      className={`relative mx-auto ${v > 0.85 && !broken ? 'anim-jitter' : ''} ${broken ? 'anim-break' : ''}`}
      style={{ width, height: h }}
    >
      <div
        className="absolute inset-0 bg-black/55"
        style={{
          border: '1px solid rgba(255,255,255,.14)',
          maskImage: 'linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 5%, #000 95%, transparent)',
        }}
      />
      <div
        className="absolute top-[1px] bottom-[1px] left-1/2 -translate-x-1/2 transition-[width] duration-100"
        style={{
          width: `${w}%`,
          background: postureColor(v, broken),
          boxShadow: broken ? '0 0 16px rgba(255,60,40,.85)' : v > 0.6 ? '0 0 11px rgba(255,190,90,.5)' : '0 0 7px rgba(255,255,255,.28)',
        }}
      />
      <div className="absolute -top-[2px] -bottom-[2px] left-1/2 w-px -translate-x-1/2 bg-white/35" />
    </div>
  );
}

function HealthBar({ v, width, h = 10 }: { v: number; width: number; h?: number }) {
  return (
    <div className="relative" style={{ width, height: h }}>
      <div
        className="absolute inset-0 bg-black/60"
        style={{
          border: '1px solid rgba(255,255,255,.12)',
          maskImage: 'linear-gradient(90deg, transparent, #000 3%, #000 100%)',
          WebkitMaskImage: 'linear-gradient(90deg, transparent, #000 3%, #000 100%)',
        }}
      />
      {/* lag trail */}
      <div
        className="absolute top-[1px] bottom-[1px] left-[1px] bg-amber-200/55 transition-[width] delay-500 duration-700"
        style={{ width: `${v * 100}%` }}
      />
      <div
        className="hud-bar-red absolute top-[1px] bottom-[1px] left-[1px] transition-[width] duration-100"
        style={{ width: `${v * 100}%`, boxShadow: '0 0 10px rgba(220,40,40,.35)' }}
      />
      <div className="absolute inset-x-0 top-0 h-px bg-white/25" />
    </div>
  );
}

function Pips({ n, max }: { n: number; max: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: max }).map((_, i) => (
        <div
          key={i}
          className={`h-2.5 w-2.5 rotate-45 border transition-colors ${i < n ? 'border-red-400/90 bg-red-700/90 shadow-[0_0_7px_rgba(255,40,30,.7)]' : 'border-white/20'}`}
        />
      ))}
    </div>
  );
}

function CombatStateTag({ tell, compact = false }: { tell: EnemyView['combatTell']; compact?: boolean }) {
  if (!tell) return null;
  const label = tell === 'opening' ? 'CELAH · SERANG' : tell === 'parry' ? 'PARRY · V / TUNGGU' : 'GUARD · V / A5';
  const color = tell === 'opening' ? 'border-emerald-300/45 bg-emerald-950/70 text-emerald-100' : tell === 'parry' ? 'border-red-300/45 bg-red-950/75 text-red-100' : 'border-amber-200/40 bg-amber-950/70 text-amber-100';
  return (
    <span className={`inline-flex items-center border ${color} ${compact ? 'px-1 py-0 text-[7px] tracking-[0.12em]' : 'px-2 py-0.5 text-[9px] tracking-[0.24em]'} font-title uppercase`}>
      {label}
    </span>
  );
}

function EnemyTop({ e }: { e: EnemyView }) {
  return (
    <div className="pointer-events-none absolute top-6 left-1/2 -translate-x-1/2 text-center">
      <div className="mb-1.5 flex items-center justify-center gap-3">
        <span className="font-title ink-text text-[13px] tracking-[0.25em] text-white/90 uppercase">{e.name}</span>
        <Pips n={e.pips} max={e.maxPips} />
      </div>
      {e.combatTell && <div className="mb-1.5"><CombatStateTag tell={e.combatTell} /></div>}
      <PostureBar v={e.posture} broken={e.broken} width={e.boss ? 560 : 420} h={9} />
      <div className="mt-1.5 flex justify-center">
        <HealthBar v={e.hp} width={e.boss ? 560 : 420} h={9} />
      </div>
      {e.broken && (
        <div className="font-jp kanji-red anim-break mt-2 text-lg tracking-[0.4em]">{e.lethal ? '無防備' : '体幹崩れ'}</div>
      )}
    </div>
  );
}

type RageView = Snapshot['rage'];

function RageMeter({ r }: { r: RageView }) {
  return (
    <div className="mt-2 flex items-center gap-2">
      <span className={`font-jp text-sm ${r.on ? 'kanji-red' : 'text-red-300/70'}`}>怒</span>
      <div className={`relative h-[8px] ${r.on ? 'anim-break' : ''}`} style={{ width: 240 }}>
        <div className="absolute inset-0 border border-white/20 bg-black/60" />
        <div
          className="absolute top-0 bottom-0 left-0 transition-[width] duration-100"
          style={{
            width: `${r.meter * 100}%`,
            background: r.on
              ? 'linear-gradient(90deg,#ff3a2a,#ffa03a)'
              : r.ready
                ? 'linear-gradient(90deg,#c02030,#ff6a3a)'
                : 'linear-gradient(90deg,#4a2a30,#7a3a3a)',
            boxShadow: r.on ? '0 0 14px rgba(255,60,40,.9)' : r.ready ? '0 0 8px rgba(255,90,60,.5)' : 'none',
          }}
        />
        <div className="absolute -top-[2px] -bottom-[2px] w-px bg-white/40" style={{ left: '18%' }} />
      </div>
      <span className="font-title rounded border border-white/25 px-1.5 text-[9px] tracking-widest text-white/60">SPACE</span>
      {r.chain > 1 && (
        <span className="font-jp kanji-red anim-break ml-1 text-lg">
          斬 ×{r.chain}
        </span>
      )}
    </div>
  );
}

function AimOverlay({ a }: { a: NonNullable<RageView['aim']> }) {
  const gold = '#ffd23a';
  const fin = a.finisher;
  // spam cut = plain white-red blade line; only the FINAL slash gets the golden band and the gold "perfect" state
  const col = a.perfect ? gold : fin ? '#ffffff' : '#ffb0a0';
  const glow = a.perfect
    ? '0 0 18px 4px rgba(255,210,60,.9), 0 0 50px 10px rgba(255,170,30,.5)'
    : fin
      ? '0 0 10px 2px rgba(255,255,255,.75), 0 0 28px 6px rgba(255,255,255,.2)'
      : '0 0 10px 2px rgba(255,120,100,.7), 0 0 26px 5px rgba(255,60,40,.25)';
  const bandH = Math.min(46, Math.max(20, a.band * 0.1));
  return (
    <div className="absolute inset-0">
      {fin && (
        <>
          {/* the GOLDEN line — only for the final slash: align the blade with it for a perfect finish */}
          <div
            className="absolute"
            style={{
              left: a.x,
              top: a.y,
              width: a.band * 1.25,
              height: bandH,
              transform: `translate(-50%,-50%) rotate(${-a.weak}rad)`,
              background:
                'linear-gradient(90deg, transparent, rgba(255,200,40,.4) 10%, rgba(255,214,60,.8) 50%, rgba(255,200,40,.4) 90%, transparent)',
              border: '1px solid rgba(255,232,120,.9)',
              boxShadow: '0 0 24px rgba(255,200,40,.75)',
              animation: 'bandPulse .5s ease-in-out infinite alternate',
            }}
          />
          <div
            className="absolute"
            style={{
              left: a.x,
              top: a.y,
              width: a.band * 1.25,
              height: 2,
              transform: `translate(-50%,-50%) rotate(${-a.weak}rad)`,
              background: 'rgba(255,240,150,.95)',
            }}
          />
        </>
      )}
      {/* the blade line */}
      <div
        className="absolute"
        style={{
          left: a.x,
          top: a.y,
          width: 3200,
          height: a.perfect ? 4 : 2.5,
          transform: `translate(-50%,-50%) rotate(${-a.angle}rad)`,
          background: `linear-gradient(90deg, transparent, ${col} 14%, ${col} 86%, transparent)`,
          boxShadow: glow,
        }}
      />
      <div
        className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full"
        style={{ left: a.x, top: a.y, background: col, boxShadow: glow }}
      />
      {a.perfect && (
        <div
          className="absolute h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2"
          style={{ left: a.x, top: a.y, borderColor: gold, boxShadow: '0 0 30px rgba(255,210,60,.7)' }}
        />
      )}
      <div className="absolute bottom-[14%] left-1/2 -translate-x-1/2 text-center">
        <div
          className={`font-jp text-2xl tracking-[0.4em] ${a.perfect ? 'text-amber-200' : 'text-white/75'}`}
          style={{ textShadow: a.perfect ? '0 0 18px rgba(255,200,80,.95)' : '0 0 10px rgba(0,0,0,.9)' }}
        >
          {fin ? (a.perfect ? '今だ！' : '自動照準…') : '斬れ！'}
        </div>
        <div className="font-title mt-1 text-[11px] tracking-[0.2em] text-white/65 uppercase">
          {fin ? 'TEBASAN TERAKHIR · bilah otomatis menyapu ke garis KUNING lalu menebas' : 'Tebasan'}
        </div>
      </div>
    </div>
  );
}

function RageUI({ r }: { r: RageView }) {
  return (
    <>
      <div className="absolute inset-x-0 top-0 bg-black transition-[height] duration-300 ease-out" style={{ height: r.aim ? '9%' : 0 }} />
      <div className="absolute inset-x-0 bottom-0 bg-black transition-[height] duration-300 ease-out" style={{ height: r.aim ? '9%' : 0 }} />
      {/* the slash guide: aim it with the mouse, then tap to cut along it */}
      {r.guide && (
        <>
          <div
            className="absolute"
            style={{
              left: r.guide.x,
              top: r.guide.y,
              width: 2400,
              height: r.guide.hot ? 2 : 1,
              transform: `translate(-50%,-50%) rotate(${-r.guide.angle}rad)`,
              background: `linear-gradient(90deg, transparent, ${r.guide.hot ? 'rgba(255,245,235,.9)' : 'rgba(255,220,210,.4)'} 22%, ${r.guide.hot ? 'rgba(255,245,235,.9)' : 'rgba(255,220,210,.4)'} 78%, transparent)`,
              boxShadow: r.guide.hot ? '0 0 12px 2px rgba(255,120,100,.55)' : '0 0 7px 1px rgba(255,120,100,.25)',
            }}
          />
          <div
            className="absolute h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
            style={{
              left: r.guide.x,
              top: r.guide.y,
              background: r.guide.hot ? '#fff' : 'rgba(255,220,210,.6)',
              boxShadow: '0 0 10px 2px rgba(255,120,100,.6)',
            }}
          />
        </>
      )}
      {r.on && !r.aim && (
        <div className="absolute top-28 left-1/2 -translate-x-1/2 text-center">
          <div className="font-jp kanji-red anim-break text-sm tracking-[0.6em]">怒 · RAIDEN / RAGE</div>
          <div className="font-title text-[10px] tracking-[0.28em] text-white/50 uppercase">
            Geser mouse = arahkan sudut · ketuk klik kiri = tebas
          </div>
          <div className="font-title mt-0.5 text-[10px] tracking-[0.28em] text-amber-200/70 uppercase">
            Klik kanan = tebasan terakhir
          </div>
        </div>
      )}
      {r.aim && <AimOverlay a={r.aim} />}
    </>
  );
}

/** Warns about archers / gunners lining up a shot — on-screen marker, or an edge arrow when they're out of view. */
function ThreatMarkers({ enemies }: { enemies: EnemyView[] }) {
  return (
    <>
      {enemies
        .filter((e) => e.aiming)
        .map((e) =>
          e.onScreen ? (
            <div
              key={'aw' + e.id}
              className="absolute -translate-x-1/2 -translate-y-full text-center"
              style={{ left: e.x, top: e.y - 4 }}
            >
              <div className="font-title anim-break text-2xl leading-none font-black text-red-400 drop-shadow-[0_0_8px_rgba(255,40,30,.9)]">⌖</div>
              <div className="font-title text-[9px] tracking-[0.3em] text-red-200 uppercase">
                {e.kind === 'archer' ? 'Panah' : 'Tembakan'}
              </div>
            </div>
          ) : (
            <div
              key={'aw' + e.id}
              className="anim-break absolute"
              style={{
                left: `${50 + Math.sin(e.ang) * 44}%`,
                top: `${50 - Math.cos(e.ang) * 40}%`,
                transform: `translate(-50%,-50%) rotate(${e.ang}rad)`,
              }}
            >
              <div className="text-3xl leading-none text-red-500 drop-shadow-[0_0_10px_rgba(255,40,30,.95)]">▲</div>
            </div>
          ),
        )}
    </>
  );
}

export function Hud({ s }: { s: Snapshot }) {
  const focus = s.enemies.find((e) => e.focus);
  const barW = 300;
  const white = s.theme === 'white';
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* the white void would swallow the light HUD — lay soft dark scrims under it */}
      {white && (
        <>
          <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/35 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-44 bg-gradient-to-t from-black/35 to-transparent" />
          <div className="absolute top-0 left-0 h-64 w-80 bg-[radial-gradient(ellipse_at_top_left,rgba(0,0,0,.4),transparent_70%)]" />
          <div className="absolute top-0 right-0 h-64 w-80 bg-[radial-gradient(ellipse_at_top_right,rgba(0,0,0,.4),transparent_70%)]" />
          <div className="absolute right-0 bottom-0 h-56 w-80 bg-[radial-gradient(ellipse_at_bottom_right,rgba(0,0,0,.35),transparent_70%)]" />
        </>
      )}
      {/* enemy bars */}
      {focus && !s.dead && !s.rage.aim && <EnemyTop e={focus} />}
      {s.enemies
        .filter((e) => !e.focus && e.onScreen && e.hp > 0)
        .map((e) => (
          <div key={e.id} className="absolute -translate-x-1/2" style={{ left: e.x, top: e.y }}>
            {e.combatTell && (
              <div className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap">
                <CombatStateTag tell={e.combatTell} compact />
              </div>
            )}
            <PostureBar v={e.posture} broken={e.broken} width={80} h={5} />
            <div className="mt-1">
              <HealthBar v={e.hp} width={80} h={5} />
            </div>
          </div>
        ))}

      <ThreatMarkers enemies={s.enemies} />

      {/* lock-on reticle */}
      {s.lock && !s.rage.aim && (
        <div
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: s.lock.x, top: s.lock.y }}
        >
          <div className="h-3 w-3 rounded-full bg-red-600 shadow-[0_0_12px_4px_rgba(255,30,30,.75)] ring-1 ring-red-200/60" />
        </div>
      )}

      {/* perilous warning */}
      {s.perilous && (
        <div
          key={s.perilous.id}
          className="absolute"
          style={{ left: s.perilous.x, top: Math.max(80, s.perilous.y - 30), animation: 'periloPop .35s ease-out forwards' }}
        >
          <div className="font-jp kanji-red text-center text-[88px] leading-none font-extrabold">危</div>
          <div className="font-title mt-1 text-center text-[11px] font-bold tracking-[0.3em] whitespace-nowrap text-red-200 uppercase ink-text">
            {s.perilous.kind === 'thrust' ? 'Tusukan · Dodge saat tiba (C)' : 'Sapuan · Lompat (E)'}
          </div>
        </div>
      )}

      {/* prompt */}
      {s.prompt && (
        <div
          className="font-title absolute bottom-36 left-1/2 -translate-x-1/2 rounded-lg border border-red-500/40 bg-black/75 px-6 py-2.5 text-center text-sm tracking-wider text-red-100 shadow-[0_0_24px_rgba(200,0,0,.35)] backdrop-blur-md transition-all select-none sm:text-base"
        >
          {s.prompt}
        </div>
      )}

      {/* bottom-left: vitality */}
      <div className="absolute bottom-8 left-8">
        <div className="mb-1 flex items-center gap-3">
          <span className="font-jp text-xs tracking-[0.3em] text-white/60">体力</span>
          <div className="flex items-center gap-1.5" title="Gourd penyembuh (H)">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className={`h-4 w-3 rounded-b-full rounded-t-sm border ${i < s.gourds ? 'border-emerald-300 bg-emerald-500/80 shadow-[0_0_8px_rgba(80,255,170,.6)]' : 'border-white/25'}`}
              />
            ))}
            <span className="font-title ml-1 text-[10px] text-white/50">H</span>
          </div>
          <div className="ml-2 flex items-center gap-1" title="Kebangkitan (R)">
            {Array.from({ length: Math.max(1, s.resurrect) }).map((_, i) => (
              <div
                key={i}
                className={`h-2.5 w-2.5 rotate-45 border ${i < s.resurrect ? 'border-amber-200 bg-amber-300 shadow-[0_0_8px_rgba(255,220,120,.8)]' : 'border-white/25'}`}
              />
            ))}
          </div>
        </div>
        <HealthBar v={s.hp} width={barW} h={12} />
        <RageMeter r={s.rage} />
      </div>

      {/* bottom center: posture */}
      <div className="absolute bottom-12 left-1/2 -translate-x-1/2 text-center">
        <PostureBar v={s.posture} broken={s.postureBroken} width={380} h={9} />
        <div className="font-jp mt-1 text-[10px] tracking-[0.5em] text-white/40">体幹</div>
      </div>

      {/* top-left stage */}
      <div className="absolute top-7 left-9 flex items-start gap-3">
        <span className="font-jp mt-0.5 text-[13px] text-red-400/60">戦</span>
        <div>
          <div className="font-title ink-text text-[13px] tracking-[0.22em] text-white/75 uppercase">{s.stageName}</div>
          <div className="mt-1.5 h-px w-16 bg-gradient-to-r from-white/25 to-transparent" />
          <div className={`font-title mt-1.5 text-[9px] tracking-[0.3em] uppercase ${s.lockOn ? 'text-white/35' : 'text-white/18'}`}>
            Lock {s.lockOn ? 'on' : 'off'}
          </div>
        </div>
      </div>

      {/* top-right stats */}
      <div className="font-title absolute top-7 right-9 space-y-1 text-right text-[9px] tracking-[0.28em] text-white/30 uppercase">
        <div className={s.combatMode === 'after' ? 'text-amber-200/70' : 'text-white/45'}>
          {s.combatMode === 'after' ? 'AFTER UPDATE · TAKTIS' : 'BEFORE UPDATE · KLASIK'}
        </div>
        {([
          ['Deflect', s.stats.deflects],
          ['Deathblow', s.stats.deathblows],
          ['Counter', s.stats.mikiri],
        ] as const).map(([k, n]) => (
          <div key={k} className="flex items-baseline justify-end gap-2.5">
            <span>{k}</span>
            <span className="font-title w-5 text-[12px] tracking-normal text-white/70">{n}</span>
          </div>
        ))}
      </div>

      <RageUI r={s.rage} />

      {/* cinematic letterbox (crane intro, kill-cam) */}
      {s.cine > 0.02 && (
        <>
          <div className="absolute inset-x-0 top-0 bg-black" style={{ height: `${s.cine * 11}%` }} />
          <div className="absolute inset-x-0 bottom-0 bg-black" style={{ height: `${s.cine * 11}%` }} />
        </>
      )}

      {/* style rank */}
      {s.style.rank && (
        <div className="absolute top-24 right-9 text-right">
          <div
            className="font-title leading-none font-black"
            style={{
              fontSize: s.style.rank.length === 3 ? 38 : 44,
              letterSpacing: '0.02em',
              color: s.style.score > 74 ? '#ffd86a' : s.style.score > 44 ? '#ff8a5a' : '#e8e8f0',
              textShadow: '0 2px 12px rgba(0,0,0,.95)',
              opacity: 0.92,
            }}
          >
            {s.style.rank}
          </div>
          <div className="relative mt-1.5 ml-auto h-px w-20 bg-white/15">
            <div
              className="absolute top-0 bottom-0 left-0 bg-white/70 transition-[width] duration-150"
              style={{ width: `${s.style.pct * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* a short, contextual hint — never a wall of text */}
      <div className="font-title absolute right-9 bottom-9 space-y-1 text-right text-[9px] tracking-[0.28em] text-white/22 uppercase">
        {s.rage.on ? (
          <>
            <div className="text-red-200/50">Klik kiri · Slice</div>
            <div className="text-amber-200/50">Klik kanan · Tebasan terakhir</div>
          </>
        ) : (
          <>
            <div>Klik kanan tahan · guard depan</div>
            <div>Ketuk saat benturan · Deflect</div>
            <div>C · Dodge/Mikiri · E · lompat</div>
            <div>V · Tendang pecah guard</div>
            <div className={s.rage.ready ? 'text-red-200/55' : ''}>Space · Raiden / Rage</div>
          </>
        )}
      </div>
    </div>
  );
}
