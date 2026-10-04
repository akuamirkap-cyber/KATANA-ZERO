/* Synthesized sound effects — no external assets needed. */
export class Sfx {
  ctx: AudioContext | null = null;
  master!: GainNode;
  noiseBuf!: AudioBuffer;
  private ambientStarted = false;

  init() {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const AC: typeof AudioContext =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 6;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startAmbient();
  }

  private startAmbient() {
    const c = this.ctx!;
    if (this.ambientStarted) return;
    this.ambientStarted = true;
    // wind
    const src = c.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 420;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator();
    lfo.frequency.value = 0.12;
    const lfoG = c.createGain();
    lfoG.gain.value = 0.03;
    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    lfo.start();
    src.connect(lp);
    lp.connect(g);
    g.connect(this.master);
    src.start();
    // low drone
    const o = c.createOscillator();
    o.type = 'sine';
    o.frequency.value = 48;
    const og = c.createGain();
    og.gain.value = 0.035;
    o.connect(og);
    og.connect(this.master);
    o.start();
  }

  private tone(f0: number, f1: number, dur: number, type: OscillatorType, vol: number, delay = 0) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private noise(
    dur: number,
    type: BiquadFilterType,
    f0: number,
    f1: number,
    vol: number,
    q = 1,
    delay = 0,
    attack = 0.004,
  ) {
    const c = this.ctx;
    if (!c) return;
    const t = c.currentTime + delay;
    const s = c.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f);
    f.connect(g);
    g.connect(this.master);
    s.start(t, Math.random());
    s.stop(t + dur + 0.05);
  }

  swing(heavy = false) {
    this.noise(heavy ? 0.28 : 0.18, 'bandpass', 600, heavy ? 3200 : 4200, heavy ? 0.28 : 0.2, 1.2, 0, 0.06);
  }

  whoosh() {
    this.noise(0.25, 'bandpass', 300, 1500, 0.16, 0.8, 0, 0.08);
  }

  hit(heavy = false) {
    this.noise(0.14, 'highpass', 2500, 900, 0.5, 0.8);
    this.noise(0.12, 'lowpass', 900, 200, 0.7, 0.8);
    this.tone(heavy ? 110 : 150, 45, 0.2, 'sine', 0.8);
    if (heavy) this.tone(70, 35, 0.35, 'sine', 0.8, 0.02);
  }

  hurt() {
    this.noise(0.2, 'lowpass', 1200, 150, 0.8);
    this.tone(90, 35, 0.35, 'sine', 0.9);
    this.tone(220, 120, 0.15, 'sawtooth', 0.08);
  }

  block() {
    this.noise(0.1, 'highpass', 3000, 1500, 0.5);
    this.tone(520, 380, 0.14, 'square', 0.12);
    this.tone(1250, 1100, 0.18, 'sine', 0.2);
    this.tone(95, 50, 0.18, 'sine', 0.6);
  }

  /** The signature, bright "ting-ting" deflect. */
  deflect(streak = 1) {
    const k = 1 + Math.min(streak - 1, 4) * 0.035;
    this.noise(0.07, 'highpass', 4000, 2500, 0.7);
    const partials = [2150, 3180, 4620, 6050, 7900];
    partials.forEach((f, i) => this.tone(f * k, f * k * 0.985, 0.55 - i * 0.07, 'sine', 0.3 / (1 + i * 0.5)));
    this.tone(880 * k, 760 * k, 0.1, 'square', 0.12);
    this.tone(2150 * k, 2100 * k, 0.45, 'sine', 0.22, 0.09);
    this.tone(3180 * k, 3100 * k, 0.4, 'sine', 0.14, 0.09);
    this.tone(80, 40, 0.16, 'sine', 0.55);
  }

  perilous() {
    this.tone(660, 660, 0.12, 'square', 0.12);
    this.tone(990, 990, 0.12, 'square', 0.12, 0.1);
    this.tone(1320, 1000, 0.35, 'sawtooth', 0.1, 0.2);
    this.noise(0.4, 'bandpass', 800, 3000, 0.12, 2, 0.1, 0.1);
  }

  postureBreak() {
    this.noise(0.5, 'highpass', 5000, 1800, 0.5);
    [3400, 4700, 6100].forEach((f, i) => this.tone(f, f * 0.7, 0.4, 'triangle', 0.18, i * 0.025));
    this.tone(120, 38, 0.6, 'sine', 0.9);
    this.noise(0.3, 'lowpass', 600, 100, 0.6);
  }

  deathblow() {
    this.noise(0.18, 'highpass', 2000, 800, 0.8);
    this.noise(0.35, 'lowpass', 1500, 120, 0.9);
    this.tone(100, 28, 0.9, 'sine', 1);
    this.tone(60, 30, 1.2, 'sine', 0.9, 0.03);
    this.tone(1800, 600, 0.5, 'sawtooth', 0.08);
    this.noise(1.0, 'bandpass', 3000, 400, 0.25, 1, 0.12, 0.2);
  }

  mikiri() {
    this.noise(0.12, 'highpass', 2500, 1000, 0.6);
    this.tone(180, 60, 0.3, 'triangle', 0.7);
    this.tone(1500, 900, 0.25, 'sine', 0.2);
    this.tone(80, 35, 0.4, 'sine', 0.8);
  }

  /** Footfall: gravel crunch + a soft thud, louder with speed. */
  step(sp: number) {
    const v = Math.min(1, sp / 9);
    this.noise(0.07, 'bandpass', 1500 + Math.random() * 900, 650, 0.035 + 0.06 * v, 1.4);
    this.tone(62 + Math.random() * 22, 38, 0.09, 'sine', 0.04 + 0.1 * v);
  }

  /** Steel driven through a body: a wet punch-through with a ring of metal. */
  impale() {
    this.noise(0.1, 'highpass', 3400, 1400, 0.5);
    this.noise(0.26, 'lowpass', 1400, 180, 0.8, 0.8, 0.02);
    this.tone(150, 52, 0.3, 'sine', 0.75);
    this.tone(2400, 1700, 0.5, 'sine', 0.1, 0.03);
    this.tone(90, 34, 0.5, 'sine', 0.6, 0.05);
  }

  /** Pulling the blade back out. */
  unsheathe() {
    this.noise(0.22, 'bandpass', 2600, 5200, 0.22, 1.6, 0, 0.05);
    this.tone(1800, 2600, 0.2, 'sine', 0.09);
  }

  /** A body part dropping on the gravel: a short, soft, low thud — far quieter than the player's own landing. */
  partThud(power: number) {
    const v = Math.min(1, Math.max(0.15, power));
    this.tone(78 + 20 * (1 - v), 44, 0.11, 'sine', 0.035 + 0.05 * v);
    this.noise(0.07, 'lowpass', 700, 180, 0.018 + 0.03 * v, 0.8);
  }

  /** Landing: thud + gravel scatter, heavier with impact. */
  land(power: number) {
    const v = Math.min(1, Math.max(0.2, power));
    this.tone(70 + 30 * (1 - v), 34, 0.22, 'sine', 0.5 * v + 0.2);
    this.noise(0.2, 'lowpass', 1800, 200, 0.5 * v + 0.15, 0.8);
    this.noise(0.28, 'bandpass', 2400, 800, 0.16 * v, 1.1, 0.02);
  }

  /** Cloth + air whip of a somersault. */
  flip() {
    this.noise(0.32, 'bandpass', 350, 1800, 0.18, 0.8, 0, 0.1);
    this.tone(420, 240, 0.22, 'sine', 0.05);
  }

  /** Brake skid: dragged gravel hiss. */
  skid() {
    this.noise(0.28, 'bandpass', 2600, 700, 0.12, 0.9, 0, 0.03);
  }

  /** Matchlock gun: sharp crack + boom + rolling smoke hiss. */
  shot() {
    this.noise(0.09, 'highpass', 1500, 600, 1.0);
    this.noise(0.35, 'lowpass', 2500, 120, 0.9, 0.8);
    this.tone(120, 40, 0.4, 'sine', 0.9);
    this.tone(2200, 400, 0.08, 'sawtooth', 0.14);
    this.noise(0.9, 'bandpass', 900, 200, 0.16, 0.8, 0.05, 0.1);
  }

  bowDraw() {
    this.noise(0.7, 'bandpass', 500, 1100, 0.07, 2, 0, 0.4);
    this.tone(140, 190, 0.7, 'sine', 0.05);
  }

  bowRelease() {
    this.tone(260, 160, 0.18, 'triangle', 0.3);
    this.noise(0.12, 'bandpass', 1800, 900, 0.3, 1.2);
    this.noise(0.3, 'bandpass', 700, 2400, 0.12, 0.8, 0.02, 0.06);
  }

  arrowHit() {
    this.noise(0.08, 'lowpass', 1200, 200, 0.7);
    this.tone(180, 70, 0.12, 'sine', 0.5);
  }

  /** Two rising blips: a ranged enemy has locked on to you. */
  aimWarn() {
    this.tone(880, 1320, 0.28, 'square', 0.07);
    this.tone(1320, 1320, 0.12, 'square', 0.06, 0.28);
  }

  arrowCut() {
    this.noise(0.1, 'highpass', 4000, 2000, 0.45);
    this.tone(3000, 2200, 0.2, 'sine', 0.14);
  }

  kickSwing() {
    this.noise(0.22, 'bandpass', 180, 1100, 0.26, 0.9, 0, 0.08);
  }

  /** Heavy boot to the chest — like a door being kicked in. */
  kick() {
    this.noise(0.16, 'lowpass', 1500, 120, 1.0, 0.8);
    this.noise(0.09, 'highpass', 3200, 1200, 0.4);
    this.tone(95, 30, 0.38, 'sine', 1);
    this.tone(160, 55, 0.2, 'triangle', 0.7);
    this.tone(60, 28, 0.5, 'sine', 0.8, 0.03);
    this.noise(0.4, 'bandpass', 900, 150, 0.25, 1, 0.05, 0.02);
  }

  dodge() {
    this.noise(0.22, 'bandpass', 500, 2200, 0.2, 0.7, 0, 0.07);
  }

  heal() {
    [523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 0.5, 'sine', 0.12, i * 0.09));
  }

  gourd() {
    this.noise(0.3, 'bandpass', 400, 900, 0.15, 3, 0, 0.1);
    this.tone(200, 300, 0.2, 'sine', 0.1);
  }

  private lp: BiquadFilterNode | null = null;

  /** Muffled, time-dilated mix while blade mode is on. */
  setRage(on: boolean) {
    const c = this.ctx;
    if (!c) return;
    if (!this.lp) {
      const lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 22000;
      lp.Q.value = 0.4;
      const comp = c.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      this.master.disconnect();
      this.master.connect(lp);
      lp.connect(comp);
      comp.connect(c.destination);
      this.lp = lp;
    }
    this.lp.frequency.setTargetAtTime(on ? 1500 : 22000, c.currentTime, 0.06);
  }

  rageOn() {
    this.tone(70, 26, 1.0, 'sine', 1);
    this.tone(220, 100, 0.8, 'sawtooth', 0.07);
    this.noise(1.0, 'bandpass', 200, 2800, 0.3, 1, 0, 0.4);
    [0.5, 0.82].forEach((d) => this.tone(62, 34, 0.24, 'sine', 0.75, d));
  }

  rageOff() {
    this.noise(0.5, 'bandpass', 2400, 300, 0.2, 1, 0, 0.05);
    this.tone(320, 80, 0.5, 'sine', 0.25);
  }

  rageDeny() {
    this.tone(180, 120, 0.15, 'square', 0.1);
    this.tone(150, 100, 0.18, 'square', 0.1, 0.12);
  }

  cutAim() {
    this.tone(900, 1500, 0.14, 'sine', 0.12);
    this.noise(0.4, 'highpass', 3000, 6500, 0.05, 1, 0, 0.2);
  }

  /** Blade-mode cut: razor "shing", wet tear and a sub-bass thud. */
  slice(perfect: boolean) {
    this.noise(0.12, 'highpass', 6500, 2500, 0.8);
    [3200, 4800, 6400, 8800].forEach((f, i) => this.tone(f, f * 0.96, 0.8 - i * 0.1, 'sine', 0.22 / (1 + i * 0.4)));
    this.tone(1200, 300, 0.25, 'sawtooth', 0.18);
    this.noise(0.3, 'lowpass', 2200, 150, 0.9, 0.8, 0.02);
    this.tone(90, 30, 0.7, 'sine', 1);
    if (perfect) {
      this.tone(660, 660, 0.3, 'triangle', 0.15, 0.15);
      this.tone(990, 990, 0.5, 'triangle', 0.15, 0.25);
      this.tone(1320, 1320, 0.8, 'triangle', 0.12, 0.35);
    }
  }

  die() {
    this.tone(70, 25, 1.6, 'sine', 1);
    this.noise(1.2, 'lowpass', 800, 60, 0.5);
  }

  revive() {
    [196, 294, 392, 587].forEach((f, i) => this.tone(f, f, 1.2, 'triangle', 0.16, i * 0.12));
  }

  victory() {
    [392, 523, 659, 784, 1046].forEach((f, i) => this.tone(f, f, 1.8, 'triangle', 0.14, i * 0.18));
  }

  stage() {
    this.tone(110, 110, 1.2, 'sine', 0.3);
    this.tone(165, 165, 1.2, 'sine', 0.2, 0.1);
    this.noise(0.9, 'bandpass', 200, 1200, 0.12, 1, 0, 0.4);
  }
}
