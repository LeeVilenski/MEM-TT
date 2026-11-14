import { lerp, normalize, type PaddlePose, type Vec3 } from '../physics';
import type { StrokeSide } from '../game/swing';

/**
 * Rally replays, recorded at the rendering level (what was drawn each frame), so the
 * same recorder works for practice, matches vs AI and online play.
 */
export interface ViewFrame {
  /** Which view drew this (e.g. 'me', 'ai', a seat). */
  id: string;
  pose: PaddlePose;
  body: { x: number; z: number };
  wing: StrokeSide;
  forward: number;
  visible: boolean;
}

export interface BallFrame {
  pos: Vec3;
  vel: Vec3;
  spin: Vec3;
}

export interface ReplayFrame {
  t: number;
  ball: BallFrame | null;
  views: ViewFrame[];
}

/** Something to show or play at a moment of the rally: shot captions and sounds. */
export type ReplayCue = { t: number; kind: 'caption'; text: string } | { t: number; kind: 'sound'; sound: 'paddle' | 'table' | 'net' | 'floor'; speed: number; x: number; rubber?: string };

export interface Rally {
  frames: ReplayFrame[];
  cues: ReplayCue[];
  duration: number;
  hits: number;
}

const MAX_SECONDS = 40;
/** Keep recording this long after the point ends (to see the ball land). */
const TAIL = 1.0;

export class RallyRecorder {
  private frames: ReplayFrame[] = [];
  private cues: ReplayCue[] = [];
  private t0 = 0;
  private stopAt = Infinity;
  private hits = 0;
  recording = false;
  last: Rally | null = null;

  start(t: number) {
    this.frames = [];
    this.cues = [];
    this.hits = 0;
    this.t0 = t;
    this.stopAt = Infinity;
    this.recording = true;
  }

  add(t: number, ball: BallFrame | null, views: ViewFrame[]) {
    if (!this.recording) return;
    const rt = t - this.t0;
    if (rt > MAX_SECONDS) return this.finish();
    this.frames.push({ t: rt, ball: ball && { pos: { ...ball.pos }, vel: { ...ball.vel }, spin: { ...ball.spin } }, views: views.map((v) => ({ ...v, pose: { pos: { ...v.pose.pos }, normal: { ...v.pose.normal }, vel: { ...v.pose.vel } }, body: { ...v.body } })) });
    if (t >= this.stopAt) this.finish();
  }

  /**
   * An exact moment between two recorded frames: a paddle contact or a bounce. Frames
   * are only taken once per rendered frame, and at rally speeds the ball moves 15–30 cm
   * between them; interpolating straight across a contact cuts the corner, so the ball
   * never quite meets the bat. A keyframe pins the ball (and the hitter's bat) to where
   * they actually met. `bats` moves those views' paddles to the given positions.
   */
  keyframe(t: number, ball: BallFrame, bats: { id: string; pos: Vec3 }[] = []) {
    if (!this.recording) return;
    const prev = this.frames[this.frames.length - 1];
    if (!prev) return;
    // The event happened during the frame now being simulated: between the last frame and now.
    const kt = prev.t + Math.max(0.0005, (t - this.t0 - prev.t) * 0.5);
    const views = prev.views.map((v) => {
      const bat = bats.find((b) => b.id === v.id);
      return bat ? { ...v, pose: { ...v.pose, pos: { ...bat.pos } }, forward: 0 } : v;
    });
    this.frames.push({ t: kt, ball: { pos: { ...ball.pos }, vel: { ...ball.vel }, spin: { ...ball.spin } }, views });
    // The sound and caption for this moment were logged at the frame's time; move them to
    // the moment itself, so in slow motion the hit is heard as the ball meets the bat.
    for (let i = this.cues.length - 1; i >= 0 && this.cues[i].t > prev.t; i--) this.cues[i].t = kt;
  }

  caption(t: number, text: string) {
    if (!this.recording) return;
    this.hits++;
    this.cues.push({ t: t - this.t0, kind: 'caption', text });
  }

  sound(t: number, sound: 'paddle' | 'table' | 'net' | 'floor', speed: number, x: number, rubber?: string) {
    if (this.recording) this.cues.push({ t: t - this.t0, kind: 'sound', sound, speed, x, rubber });
  }

  /** The point is over: keep the tail, then finish. */
  end(t: number) {
    if (this.recording) this.stopAt = Math.min(this.stopAt, t + TAIL);
  }

  private finish() {
    this.recording = false;
    if (this.frames.length < 10) return;
    const duration = this.frames[this.frames.length - 1].t;
    this.last = { frames: this.frames, cues: this.cues, duration, hits: this.hits };
  }
}

/** Plays a recorded rally back at reduced speed, interpolating between frames. */
export class ReplayPlayer {
  time = 0;
  private cueIndex = 0;
  caption = '';

  constructor(
    readonly rally: Rally,
    public speed = 0.4,
  ) {}

  get done() {
    return this.time >= this.rally.duration;
  }

  /** Advance by real seconds. Returns the cues that fired (sounds to play). */
  advance(dt: number): ReplayCue[] {
    this.time = Math.min(this.rally.duration, this.time + dt * this.speed);
    const fired: ReplayCue[] = [];
    const cues = this.rally.cues;
    while (this.cueIndex < cues.length && cues[this.cueIndex].t <= this.time) {
      const c = cues[this.cueIndex++];
      if (c.kind === 'caption') this.caption = c.text;
      fired.push(c);
    }
    return fired;
  }

  /** Interpolated frame at the current time. */
  frame(): ReplayFrame {
    const f = this.rally.frames;
    let i = 0;
    let lo = 0;
    let hi = f.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= this.time) ((i = mid), (lo = mid + 1));
      else hi = mid - 1;
    }
    const a = f[i];
    const b = f[Math.min(i + 1, f.length - 1)];
    const k = b.t > a.t ? (this.time - a.t) / (b.t - a.t) : 0;
    return {
      t: this.time,
      ball: a.ball && b.ball ? { pos: lerp(a.ball.pos, b.ball.pos, k), vel: a.ball.vel, spin: a.ball.spin } : a.ball,
      views: a.views.map((v) => {
        const w = b.views.find((x) => x.id === v.id);
        if (!w) return v;
        return { ...v, pose: { pos: lerp(v.pose.pos, w.pose.pos, k), normal: normalize(lerp(v.pose.normal, w.pose.normal, k)), vel: v.pose.vel }, body: { x: v.body.x + (w.body.x - v.body.x) * k, z: v.body.z + (w.body.z - v.body.z) * k } };
      }),
    };
  }
}
