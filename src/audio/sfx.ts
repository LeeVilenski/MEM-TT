import type { Ambience, SongId } from '../render/venues';
import { Music } from './music';

/**
 * Procedural sound effects (Web Audio, no audio files). Ball sounds scale with
 * impact speed and are panned by where they happen across the table.
 */

/** Loudness 0–1 for an impact speed (m/s). Exported for tests. */
export function impactGain(speed: number, full = 12): number {
  return Math.max(0.04, Math.min(1, Math.sqrt(Math.max(0, speed) / full)));
}

/** Paddle "tock" tone for a rubber: grippy inverted rubber is lower and softer than pips. */
export function rubberTone(kind: string): { freq: number; q: number; decay: number } {
  switch (kind) {
    case 'Short pips':
      return { freq: 2600, q: 6, decay: 0.05 };
    case 'Long pips':
      return { freq: 1900, q: 3, decay: 0.07 };
    case 'Anti-spin':
      return { freq: 900, q: 2, decay: 0.09 };
    default:
      return { freq: 1500, q: 4, decay: 0.06 };
  }
}

const panFor = (x: number) => Math.max(-1, Math.min(1, x / 1.2));

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private music: Music | null = null;
  private musicKind: SongId = 'none';
  private amb: { stop: () => void } | null = null;
  musicOn = true;
  private ambKind: Ambience = 'none';
  volume = 0.7;
  muted = false;
  ambienceOn = true;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolume();
      this.setAmbience(this.ambKind);
      this.setMusic(this.musicKind);
    }
    void this.ctx.resume();
  }

  applyVolume() {
    if (this.master) this.master.gain.value = this.muted ? 0 : this.volume;
  }

  private ready() {
    return this.ctx && this.master && this.noise && this.ctx.state === 'running' ? this.ctx : null;
  }

  /** A filtered noise burst + optional tonal body: the building block of ball sounds. */
  private burst(opts: { gain: number; pan: number; freq: number; q: number; decay: number; tone?: number; toneDecay?: number; type?: BiquadFilterType }) {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createStereoPanner();
    out.pan.value = opts.pan;
    out.connect(this.master!);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.value = opts.freq;
    f.Q.value = opts.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(opts.gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + opts.decay);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, opts.decay + 0.02);

    if (opts.tone) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(opts.tone, t);
      o.frequency.exponentialRampToValueAtTime(opts.tone * 0.8, t + (opts.toneDecay ?? 0.05));
      const og = ctx.createGain();
      og.gain.setValueAtTime(opts.gain * 0.6, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + (opts.toneDecay ?? 0.05));
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + (opts.toneDecay ?? 0.05) + 0.02);
    }
  }

  /** Extra weight on hard hits (arcade effects): a low thump and a sharper crack. */
  heavyHits = true;

  paddle(speed: number, rubberKind: string, x: number) {
    const tone = rubberTone(rubberKind);
    // Harder hits ring slightly higher and sharper.
    const power = this.heavyHits ? Math.max(0, Math.min(1, (speed - 12) / 22)) : 0;
    const f = tone.freq * (1 + 0.25 * power);
    this.burst({ gain: impactGain(speed, 18) * 0.9, pan: panFor(x), freq: f, q: tone.q, decay: tone.decay, tone: f * 0.55, toneDecay: tone.decay * 0.8 });
    if (power > 0.15) {
      // Body: a short low thump, and a bright crack on smashes.
      this.burst({ gain: 0.5 * power, pan: panFor(x), freq: 220, q: 0.7, decay: 0.09 + 0.06 * power, type: 'lowpass', tone: 85, toneDecay: 0.1 + 0.05 * power });
      if (power > 0.5) this.burst({ gain: 0.35 * power, pan: panFor(x), freq: 5200, q: 1.2, decay: 0.03, type: 'highpass' });
    }
  }

  /**
   * Air whoosh of a fast ball going past (speed in m/s as seen, after slow motion):
   * swelling, band-passed noise whose pitch sweeps down like a fly-by. Faster = louder,
   * brighter and shorter. `toward`: coming at the listener (sweeps from higher).
   */
  whoosh(speed: number, x: number, toward: boolean) {
    const ctx = this.ready();
    if (!ctx) return;
    const k = Math.max(0, Math.min(1, (speed - 9) / 18));
    if (k <= 0) return;
    const t = ctx.currentTime;
    const dur = 0.32 - 0.12 * k;
    const out = ctx.createStereoPanner();
    out.pan.value = panFor(x);
    out.connect(this.master!);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.6;
    const top = 1400 + 2600 * k;
    f.frequency.setValueAtTime(toward ? top : top * 0.6, t);
    f.frequency.exponentialRampToValueAtTime(toward ? top * 0.35 : top * 0.25, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.06 + 0.22 * k, t + dur * 0.45);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }

  /** A dull, woody "thock" for a mishit (mistimed, off-centre or over-hit stroke). */
  mishit() {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(240, t);
    o.frequency.exponentialRampToValueAtTime(110, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
    o.connect(g).connect(this.master!);
    o.start(t);
    o.stop(t + 0.18);
  }

  /** A bright two-note chime for a perfectly timed stroke. */
  perfect() {
    const ctx = this.ready();
    if (!ctx) return;
    [1760, 2637].forEach((f, i) => {
      const t = ctx.currentTime + i * 0.05;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.27);
    });
  }

  /**
   * Colleagues reacting: 'applause' (a good rally), 'cheer' (a great one, or the match),
   * 'groan' (an "ooh" at an error). `strength` 0–1.
   */
  crowd(kind: 'applause' | 'cheer' | 'groan', strength = 0.6) {
    const ctx = this.ready();
    if (!ctx) return;
    const out = ctx.createGain();
    out.gain.value = 0.25 + 0.5 * strength;
    out.connect(this.master!);
    const t0 = ctx.currentTime;
    const noiseBand = (start: number, dur: number, freq: number, q: number, gain: number, attack: number, type: BiquadFilterType = 'bandpass') => {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = type;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(gain, start + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
      src.connect(f).connect(g).connect(out);
      src.start(start, Math.random() * 0.5);
      src.stop(start + dur + 0.05);
      return f;
    };
    if (kind === 'groan') {
      // A falling "oooh" from a few people: a vowel-like band sweeping down.
      for (let i = 0; i < 4; i++) {
        const st = t0 + i * 0.04;
        const f = noiseBand(st, 0.9, 520 + i * 60, 6, 0.35, 0.12);
        f.frequency.exponentialRampToValueAtTime(260 + i * 30, st + 0.85);
      }
      return;
    }
    // Claps: many short highpassed noise bursts from different people.
    const dur = kind === 'cheer' ? 2.2 : 1.4;
    const claps = Math.round((kind === 'cheer' ? 70 : 40) * (0.5 + strength));
    for (let i = 0; i < claps; i++) {
      const st = t0 + Math.random() * dur * Math.random() ** 0.5;
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 1200 + Math.random() * 1800;
      f.Q.value = 1.2;
      const g = ctx.createGain();
      const amp = 0.08 + Math.random() * 0.12;
      g.gain.setValueAtTime(amp, st);
      g.gain.exponentialRampToValueAtTime(0.0001, st + 0.03 + Math.random() * 0.02);
      const pan = ctx.createStereoPanner();
      pan.pan.value = Math.random() * 1.6 - 0.8;
      src.connect(f).connect(g).connect(pan).connect(out);
      src.start(st, Math.random() * 0.8, 0.06);
    }
    // A cheer adds a "yeah!" swell: voiced bands rising then falling.
    if (kind === 'cheer') {
      for (let i = 0; i < 3; i++) {
        const f = noiseBand(t0 + i * 0.06, 1.6, 700 + i * 250, 3, 0.18, 0.25);
        f.frequency.exponentialRampToValueAtTime(900 + i * 300, t0 + 0.4);
      }
    }
  }

  table(speed: number, x: number) {
    this.burst({ gain: impactGain(speed, 8), pan: panFor(x), freq: 2200, q: 5, decay: 0.045, tone: 1150, toneDecay: 0.06 });
  }

  net(x: number) {
    this.burst({ gain: 0.45, pan: panFor(x), freq: 500, q: 1, decay: 0.12, type: 'lowpass', tone: 220, toneDecay: 0.08 });
  }

  floor(speed: number, x: number) {
    this.burst({ gain: impactGain(speed, 8) * 0.6, pan: panFor(x), freq: 900, q: 3, decay: 0.06, tone: 520, toneDecay: 0.07 });
  }

  toss() {
    this.burst({ gain: 0.12, pan: 0, freq: 3000, q: 0.7, decay: 0.12, type: 'highpass' });
  }

  /** Short jingle: up for a point won, down for a point lost. */
  point(won: boolean, big = false) {
    const ctx = this.ready();
    if (!ctx) return;
    const notes = won ? [660, 880, ...(big ? [1320] : [])] : [440, 330, ...(big ? [220] : [])];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.09;
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.18);
      o.connect(g).connect(this.master!);
      o.start(t);
      o.stop(t + 0.2);
    });
  }

  /** Background music for a venue (procedural songs; see music.ts). */
  setMusic(kind: SongId) {
    this.musicKind = kind;
    if (!this.ctx || !this.noise || !this.master) return;
    this.music ??= new Music(this.ctx, this.master, this.noise);
    this.music.play(this.musicOn ? kind : 'none');
  }

  /** Looping background bed for a venue (very quiet, darkened so it reads as room tone, not static). */
  setAmbience(kind: Ambience) {
    this.ambKind = kind;
    this.amb?.stop();
    this.amb = null;
    const ctx = this.ctx;
    if (!ctx || !this.noise || kind === 'none' || !this.ambienceOn) return;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    const g = ctx.createGain();
    const nodes: AudioNode[] = [];
    switch (kind) {
      case 'office': // HVAC hum + distant chatter-ish band
        f.type = 'lowpass';
        f.frequency.value = 220;
        g.gain.value = 0.015;
        break;
      case 'servers': // fan roar
        f.type = 'bandpass';
        f.frequency.value = 350;
        f.Q.value = 0.5;
        g.gain.value = 0.02;
        break;
      case 'room':
        f.type = 'lowpass';
        f.frequency.value = 160;
        g.gain.value = 0.012;
        break;
      case 'wind': {
        f.type = 'bandpass';
        f.frequency.value = 400;
        f.Q.value = 0.8;
        g.gain.value = 0.018;
        // Gusts: slowly modulate the filter.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.15;
        const lg = ctx.createGain();
        lg.gain.value = 200;
        lfo.connect(lg).connect(f.frequency);
        lfo.start();
        nodes.push(lfo);
        break;
      }
    }
    src.connect(f).connect(g).connect(this.master!);
    src.start();
    this.amb = {
      stop: () => {
        src.stop();
        nodes.forEach((n) => (n as OscillatorNode).stop?.());
      },
    };
  }
}
