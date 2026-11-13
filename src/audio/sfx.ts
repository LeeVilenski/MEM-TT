import type { Ambience } from '../render/venues';

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
  private amb: { stop: () => void } | null = null;
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

  paddle(speed: number, rubberKind: string, x: number) {
    const tone = rubberTone(rubberKind);
    this.burst({ gain: impactGain(speed, 18) * 0.9, pan: panFor(x), freq: tone.freq, q: tone.q, decay: tone.decay, tone: tone.freq * 0.55, toneDecay: tone.decay * 0.8 });
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

  /** Looping background bed for a venue (very quiet). */
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
        f.frequency.value = 400;
        g.gain.value = 0.05;
        break;
      case 'servers': // fan roar
        f.type = 'bandpass';
        f.frequency.value = 1200;
        f.Q.value = 0.4;
        g.gain.value = 0.07;
        break;
      case 'room':
        f.type = 'lowpass';
        f.frequency.value = 250;
        g.gain.value = 0.03;
        break;
      case 'wind': {
        f.type = 'bandpass';
        f.frequency.value = 500;
        f.Q.value = 0.8;
        g.gain.value = 0.06;
        // Gusts: slowly modulate the filter.
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.15;
        const lg = ctx.createGain();
        lg.gain.value = 300;
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
