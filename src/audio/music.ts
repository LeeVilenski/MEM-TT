import type { SongId } from '../render/venues';

/**
 * Procedural background music (Web Audio, no audio files): one looping song per
 * venue mood. Each song is a chord progression plus bass, chord, arpeggio/melody
 * and drum patterns on a 16-step grid, scheduled slightly ahead of time.
 */

type Chord = { root: number; tones: number[] }; // root as MIDI note, tones as semitones above root
type Wave = OscillatorType;

export interface Song {
  name: string;
  bpm: number;
  swing: number; // 0–0.3: delays off-beat 16ths
  chords: Chord[]; // one per bar
  bass: (number | null)[]; // 16 steps: index into chord tones (+ octave via 10+), null = rest
  stabs: number[]; // steps on which to play the chord
  stabLen: number; // in steps
  lead: (number | null)[]; // 16 steps: index into chord tones, one octave up
  leadWave: Wave;
  keysWave: Wave;
  bassWave: Wave;
  kick: number[];
  snare: number[];
  hat: number[];
  cutoff: number; // keys lowpass
}

const maj7 = [0, 4, 7, 11];
const min7 = [0, 3, 7, 10];
const dom7 = [0, 4, 7, 10];
const maj = [0, 4, 7, 12];
const min = [0, 3, 7, 12];

export const SONGS: Record<Exclude<SongId, 'none'>, Song> = {
  // Lo-fi, mellow electric piano for the open-plan office.
  office: {
    name: 'Desk Plants',
    bpm: 82,
    swing: 0.18,
    chords: [
      { root: 53, tones: maj7 }, // Fmaj7
      { root: 52, tones: min7 }, // Em7
      { root: 50, tones: min7 }, // Dm7
      { root: 48, tones: maj7 }, // Cmaj7
    ],
    bass: [0, null, null, null, null, null, null, 2, 0, null, null, null, 1, null, null, null],
    stabs: [0, 6, 10],
    stabLen: 5,
    lead: [null, null, 3, null, 2, null, null, null, null, 1, null, 2, null, null, 0, null],
    leadWave: 'sine',
    keysWave: 'triangle',
    bassWave: 'sine',
    kick: [0, 7, 10],
    snare: [4, 12],
    hat: [0, 2, 4, 6, 8, 10, 12, 14],
    cutoff: 1400,
  },
  // Driving synthwave for MEM.
  mem: {
    name: 'Uptime',
    bpm: 112,
    swing: 0,
    chords: [
      { root: 45, tones: min }, // Am
      { root: 41, tones: maj }, // F
      { root: 48, tones: maj }, // C
      { root: 43, tones: maj }, // G
    ],
    bass: [0, null, 0, 10, 0, null, 0, 10, 0, null, 0, 10, 0, null, 2, 10],
    stabs: [0, 8],
    stabLen: 7,
    lead: [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 2, 3, 2],
    leadWave: 'square',
    keysWave: 'sawtooth',
    bassWave: 'sawtooth',
    kick: [0, 4, 8, 12],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    cutoff: 1100,
  },
  // Slow, dark half-time dub for the server room: deep sub bass, sparse bleeps, lots of space.
  servers: {
    name: 'Cold Aisle',
    bpm: 70,
    swing: 0.12,
    chords: [
      { root: 50, tones: [0, 7, 10, 15] }, // D minor, open
      { root: 50, tones: [0, 7, 10, 15] },
      { root: 46, tones: [0, 7, 11, 14] }, // Bb, open
      { root: 48, tones: [0, 7, 10, 14] }, // C sus
    ],
    bass: [0, null, null, null, null, null, null, 0, null, null, 1, null, null, null, null, null],
    stabs: [6],
    stabLen: 10,
    lead: [null, null, null, 3, null, null, null, null, null, null, null, null, null, 2, null, 3],
    leadWave: 'sine',
    keysWave: 'sine',
    bassWave: 'sine',
    kick: [0, 10],
    snare: [8],
    hat: [3, 7, 11, 15],
    cutoff: 700,
  },
  // Easy lounge jazz for the conference room.
  room: {
    name: 'Any Other Business',
    bpm: 96,
    swing: 0.25,
    chords: [
      { root: 50, tones: min7 }, // Dm7
      { root: 55, tones: dom7 }, // G7
      { root: 48, tones: maj7 }, // Cmaj7
      { root: 57, tones: dom7 }, // A7
    ],
    bass: [0, null, null, null, 1, null, null, null, 2, null, null, null, 1, null, null, null],
    stabs: [2, 7, 11],
    stabLen: 2,
    lead: [null, null, null, null, 3, null, 2, null, null, null, 1, null, 3, null, null, null],
    leadWave: 'triangle',
    keysWave: 'sine',
    bassWave: 'triangle',
    kick: [0, 8],
    snare: [4, 12],
    hat: [0, 4, 6, 8, 12, 14],
    cutoff: 2000,
  },
  // Bright, breezy plucks for the rooftop offsite.
  wind: {
    name: 'Offsite',
    bpm: 104,
    swing: 0.08,
    chords: [
      { root: 55, tones: maj }, // G
      { root: 50, tones: maj }, // D
      { root: 52, tones: min }, // Em
      { root: 48, tones: maj }, // C
    ],
    bass: [0, null, null, null, null, null, 2, null, 0, null, null, null, 1, null, null, null],
    stabs: [0, 8],
    stabLen: 6,
    lead: [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 1, 0],
    leadWave: 'triangle',
    keysWave: 'triangle',
    bassWave: 'sine',
    kick: [0, 6, 8],
    snare: [4, 12],
    hat: [2, 6, 10, 14],
    cutoff: 2400,
  },
};

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12);

/** Resolve a pattern value to a MIDI note for a chord (10+ = one octave up). */
export function noteFor(chord: Chord, v: number): number {
  const up = v >= 10 ? 12 : 0;
  const i = v % 10;
  return chord.root + chord.tones[i % chord.tones.length] + up;
}

export class Music {
  private timer: ReturnType<typeof setInterval> | null = null;
  private out: GainNode;
  private step = 0;
  private nextTime = 0;
  private song: Song | null = null;

  constructor(
    private ctx: AudioContext,
    dest: AudioNode,
    private noise: AudioBuffer,
    level = 0.22,
  ) {
    this.out = ctx.createGain();
    this.out.gain.value = level;
    this.out.connect(dest);
  }

  play(kind: SongId) {
    this.stop();
    if (kind === 'none') return;
    this.song = SONGS[kind];
    this.step = 0;
    this.nextTime = this.ctx.currentTime + 0.1;
    this.out.gain.cancelScheduledValues(this.ctx.currentTime);
    this.out.gain.setValueAtTime(0.0001, this.ctx.currentTime);
    this.out.gain.exponentialRampToValueAtTime(0.22, this.ctx.currentTime + 1.5);
    this.timer = setInterval(() => this.schedule(), 25);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.song = null;
  }

  private schedule() {
    const s = this.song;
    if (!s) return;
    if (this.ctx.state !== 'running') {
      this.nextTime = this.ctx.currentTime + 0.1;
      return;
    }
    // If the tab was throttled, skip ahead rather than playing a burst of notes.
    if (this.nextTime < this.ctx.currentTime - 0.2) this.nextTime = this.ctx.currentTime + 0.05;
    const stepDur = 60 / s.bpm / 4;
    while (this.nextTime < this.ctx.currentTime + 0.15) {
      const st = this.step % 16;
      const bar = Math.floor(this.step / 16);
      const t = this.nextTime + (st % 2 === 1 ? s.swing * stepDur : 0);
      this.playStep(s, bar, st, t, stepDur);
      this.nextTime += stepDur;
      this.step++;
    }
  }

  private playStep(s: Song, bar: number, st: number, t: number, stepDur: number) {
    const chord = s.chords[bar % s.chords.length];
    const phrase = Math.floor(bar / s.chords.length) % 4; // 4 passes of the progression
    const b = s.bass[st];
    if (b !== null) this.tone(hz(noteFor(chord, b) - 12), t, stepDur * 1.8, s.bassWave, 0.32, 600);
    if (s.stabs.includes(st)) {
      for (const tn of chord.tones.slice(0, 4)) this.tone(hz(chord.root + 12 + tn), t, stepDur * s.stabLen, s.keysWave, 0.07, s.cutoff, 0.02);
    }
    // Lead sits out the first pass and the third, so the loop breathes.
    const l = s.lead[st];
    if (l !== null && phrase % 2 === 1) this.tone(hz(noteFor(chord, l) + 24), t, stepDur * 1.5, s.leadWave, s.leadWave === 'square' ? 0.035 : 0.08, 3000, 0.005);
    if (phrase === 0 && bar % s.chords.length < 2) return; // intro: no drums for two bars
    if (s.kick.includes(st)) this.kick(t);
    if (s.snare.includes(st)) this.hit(t, 1800, 0.7, 0.12, 0.18);
    if (s.hat.includes(st)) this.hit(t, 8000, 1, 0.03, st % 4 === 0 ? 0.07 : 0.045, 'highpass');
  }

  private tone(freq: number, t: number, dur: number, wave: Wave, gain: number, cutoff: number, attack = 0.01) {
    const o = this.ctx.createOscillator();
    o.type = wave;
    o.frequency.value = freq;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(f).connect(g).connect(this.out);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  private kick(t: number) {
    const o = this.ctx.createOscillator();
    o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    o.connect(g).connect(this.out);
    o.start(t);
    o.stop(t + 0.25);
  }

  private hit(t: number, freq: number, q: number, dur: number, gain: number, type: BiquadFilterType = 'bandpass') {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.out);
    src.start(t, Math.random() * 0.5, dur + 0.02);
  }
}
