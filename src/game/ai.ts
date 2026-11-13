import {
  BallSim,
  GRAVITY,
  RUBBERS,
  TABLE,
  TICK_DT,
  length,
  lerp,
  normalize,
  scale,
  spinComponents,
  v3,
  type BallState,
  type PaddleCollider,
  type PaddlePose,
  type PhysicsParams,
  type Rubber,
  type Vec3,
} from '../physics';
import { landingOutcome, type ShotMode } from './assist';
import { mapPose, mapState, mapVec, type SideId } from './frame';
import { IncomingPrediction } from './intercept';
import { faceNormal } from './swing';

/**
 * Computer opponent. All reasoning happens in the AI's local frame, where it stands
 * at the near (+z) end and hits toward −z; the side mapping places it at either end.
 * It plays with exactly the same physics as a human: it chooses a stroke, solves
 * for a face angle with the landing solver, then adds human-like error.
 */

export interface AiProfile {
  name: string;
  /** Seconds before it starts moving to a new ball. */
  reaction: number;
  /** Footwork speed, m/s. */
  moveSpeed: number;
  /** Paddle movement speed toward the contact point, m/s. */
  paddleSpeed: number;
  /** Standard deviation of face-angle error, degrees. */
  pitchError: number;
  /** Standard deviation of aim error, degrees. */
  yawError: number;
  /** Relative standard deviation of stroke speed. */
  speedError: number;
  /** 0–1: preference for attacking strokes (loops, smashes) over safe ones. */
  aggression: number;
  /** Distance from the edges it aims inside, metres. */
  margin: number;
}

export type AiLevel = 'easy' | 'medium' | 'hard';

export const AI_LEVELS: Record<AiLevel, AiProfile> = {
  easy: { name: 'Intern', reaction: 0.22, moveSpeed: 2.6, paddleSpeed: 4, pitchError: 4.5, yawError: 3.5, speedError: 0.12, aggression: 0.2, margin: 0.3 },
  medium: { name: 'Sysadmin', reaction: 0.16, moveSpeed: 3.4, paddleSpeed: 5, pitchError: 2.2, yawError: 2, speedError: 0.07, aggression: 0.5, margin: 0.2 },
  hard: { name: 'Principal Engineer', reaction: 0.1, moveSpeed: 4.4, paddleSpeed: 6.5, pitchError: 1.0, yawError: 1, speedError: 0.04, aggression: 0.8, margin: 0.12 },
};

type StrokeKind = 'loop' | 'drive' | 'push' | 'block' | 'smash' | 'flick' | 'chop' | 'serve-short' | 'serve-long' | 'serve-side';

/** Paddle velocities (local frame, toward −z) for each stroke. */
const STROKES: Record<StrokeKind, Vec3> = {
  loop: v3(0, 8, -9),
  drive: v3(0, 3.5, -8),
  push: v3(0, -2.2, -2.4),
  block: v3(0, 0.6, -1.2),
  smash: v3(0, 1, -17),
  flick: v3(0, 4, -6),
  chop: v3(0, -6, -3),
  'serve-short': v3(0, -2.5, -3.2),
  'serve-long': v3(0, 2.5, -7.5),
  'serve-side': v3(4, -1.2, -4),
};

/** Where in the opponent's half (local −z) each stroke aims, as depth from the net. */
const DEPTH: Record<StrokeKind, number> = {
  loop: 1.05,
  drive: 1.0,
  push: 0.55,
  block: 0.95,
  smash: 0.9,
  flick: 0.95,
  chop: 1.0,
  'serve-short': 0.4,
  'serve-long': 1.15,
  'serve-side': 0.8,
};

export interface AiPlan {
  /** Absolute game time of contact. */
  t: number;
  /** Paddle centre at contact (local). */
  pos: Vec3;
  vel: Vec3;
  normal: Vec3;
  stroke: StrokeKind;
  /** Whether the solver found an angle that lands (before error was added). */
  solved: boolean;
}

const READY = { x: 0, z: TABLE.halfLength + 0.65 };
const ARM = 0.45;
const REACH = 0.95;
/** Paddle stroke velocity is applied within this window around the planned contact time. */
const STROKE_WINDOW = 0.1;
/** Half-duration of the visible swing through the contact point, seconds. */
const SWING_TIME = 0.05;

export class AiPlayer {
  readonly id: string;
  body = { ...READY };
  rubber: Rubber = RUBBERS.inverted;
  plan: AiPlan | null = null;
  private moveFrom = 0;
  private pose: PaddlePose = { pos: v3(0.3, TABLE.height + 0.25, READY.z - ARM), normal: v3(0, 0, -1), vel: v3() };
  private prevPose: PaddlePose = this.pose;

  constructor(
    readonly side: SideId,
    public profile: AiProfile,
    private params: PhysicsParams,
    private rng: () => number = Math.random,
  ) {
    this.id = `ai-${side}`;
  }

  // ------------------------------------------------------------ planning

  /** Plan a return for a ball (world state at absolute time `now`) heading to this side. */
  planReturn(world: BallState, now: number): AiPlan | null {
    const local = mapState(this.side, world);
    const pred = new IncomingPrediction(local, this.params, now);
    const planeZ = TABLE.halfLength + 0.2 + this.rng() * 0.25;
    const ic = pred.interceptAt(planeZ, now, TABLE.height + 0.95);
    if (!ic) return (this.plan = null);

    const at = this.stateAt(local, now, ic.t);
    if (!at) return (this.plan = null);
    const c = spinComponents(at.vel, at.spin);
    const height = at.pos.y - TABLE.height;
    const overTable = at.pos.z < TABLE.halfLength;
    const a = this.profile.aggression;
    const r = this.rng();

    let choices: StrokeKind[];
    if (height > 0.42 && r < 0.35 + 0.6 * a) choices = ['smash', 'drive', 'block'];
    else if (overTable) choices = c.top < -10 && r > 0.25 + 0.5 * a ? ['push', 'flick', 'block'] : ['flick', 'push', 'block'];
    else if (c.top < -15) choices = r < 0.2 + 0.7 * a ? ['loop', 'push', 'drive'] : ['push', 'loop', 'block'];
    else if (at.pos.z > TABLE.halfLength + 1.2) choices = r < 0.5 ? ['chop', 'loop', 'block'] : ['loop', 'chop', 'block'];
    else choices = r < 0.25 + 0.5 * a ? ['loop', 'drive', 'block'] : r < 0.7 ? ['drive', 'block', 'loop'] : ['block', 'drive', 'loop'];

    return (this.plan = this.solve(at, ic.t, choices, 'rally', now));
  }

  /**
   * Plan a serve. Returns the hand position (world) and upward toss speed; the match
   * spawns the ball there. The plan strikes the ball on its way down.
   */
  planServe(now: number): { hand: Vec3; tossVy: number } {
    this.body = { ...READY };
    const hand = v3(this.body.x + 0.3 + (this.rng() - 0.5) * 0.3, TABLE.height + 0.06, TABLE.halfLength + 0.15);
    const tossHeight = 0.3 + this.rng() * 0.35;
    const tossVy = Math.sqrt(2 * GRAVITY * tossHeight);
    const toss: BallState = { pos: hand, vel: v3(0, tossVy, 0), spin: v3() };

    // Contact on the way down, 10–22 cm above the table.
    const contactY = TABLE.height + 0.1 + this.rng() * 0.12;
    const sim = new BallSim(toss, this.params);
    while (sim.time < 2 && !(sim.state.vel.y < 0 && sim.state.pos.y <= contactY)) sim.step(TICK_DT);
    const r = this.rng();
    const kinds: StrokeKind[] = r < 0.45 ? ['serve-short', 'serve-side', 'serve-long'] : r < 0.75 ? ['serve-long', 'serve-short'] : ['serve-side', 'serve-short'];
    this.plan = this.solve(sim.state, now + sim.time, kinds, 'serve', now);
    return { hand: mapVec(this.side, hand), tossVy };
  }

  /** Simulate the ball (local frame) forward to absolute time t. */
  private stateAt(local: BallState, now: number, t: number): BallState | null {
    const sim = new BallSim(local, this.params);
    while (now + sim.time < t - 1e-6) {
      if (sim.time > 3) return null;
      sim.step(TICK_DT);
    }
    return sim.state;
  }

  private gauss() {
    const u = Math.max(1e-9, this.rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  /** Pick the first stroke in `choices` that can be made to land, aiming at a target. */
  private solve(at: BallState, t: number, choices: StrokeKind[], mode: ShotMode, now: number): AiPlan {
    const p = this.profile;
    // Paddle just behind the ball so contact happens at the planned moment.
    const pos = v3(at.pos.x, at.pos.y, at.pos.z + 0.018);
    let best: AiPlan | null = null;

    for (const stroke of choices) {
      const halfW = TABLE.halfWidth - p.margin;
      const target = { x: (this.rng() * 2 - 1) * halfW, z: -DEPTH[stroke] };
      let vel = STROKES[stroke];
      // Occasionally hook the loop for sidespin.
      if (stroke === 'loop' && this.rng() < 0.25 * p.aggression) vel = v3((this.rng() < 0.5 ? -1 : 1) * 3, vel.y, vel.z);
      const yaw = (Math.atan2(target.x - pos.x, -(target.z - pos.z)) * 180) / Math.PI;
      const pose: PaddlePose = { pos, normal: v3(0, 0, -1), vel };

      // Scan the face angle; prefer angles near the target that also sit well inside the
      // landing window, so execution error doesn't immediately miss.
      const STEP = 2;
      const scan: { pitch: number; pos?: Vec3 }[] = [];
      for (let pitch = -72; pitch <= 72; pitch += STEP) {
        const normal = faceNormal(pitch, yaw);
        const res = landingOutcome(at, { ...pose, normal }, normal, this.rubber, this.params, mode);
        scan.push({ pitch, pos: res.outcome === 'in' ? res.pos : undefined });
      }
      let bestPitch: number | null = null;
      let bestScore = Infinity;
      scan.forEach((c, i) => {
        if (!c.pos) return;
        let margin = 0;
        while (margin < 4 && scan[i - margin - 1]?.pos && scan[i + margin + 1]?.pos) margin++;
        const err = Math.abs(c.pos.z - target.z) + 0.3 * Math.abs(c.pos.x - target.x);
        const score = err - 0.12 * margin;
        if (score < bestScore) ((bestScore = score), (bestPitch = c.pitch));
      });
      if (bestPitch === null) continue;

      // Human-like execution error.
      // Serves are rehearsed: much more consistent than rally shots.
      const errScale = mode === 'serve' ? 0.35 : 1;
      const pitch = bestPitch + this.gauss() * p.pitchError * errScale;
      const yawErr = yaw + this.gauss() * p.yawError;
      const speed = 1 + this.gauss() * p.speedError;
      best = { t, pos, vel: scale(vel, speed), normal: faceNormal(pitch, yawErr), stroke, solved: true };
      break;
    }
    // Nothing lands: swing anyway (it will probably miss).
    best ??= { t, pos, vel: STROKES.block, normal: faceNormal(this.gauss() * 20, 0), stroke: 'block', solved: false };
    this.moveFrom = now + (mode === 'serve' ? 0 : p.reaction);
    return best;
  }

  clearPlan() {
    this.plan = null;
  }

  // ------------------------------------------------------------ movement

  update(dt: number, now: number) {
    this.prevPose = this.pose;
    const p = this.profile;
    const plan = this.plan && now <= this.plan.t + 0.25 ? this.plan : null;

    // Footwork toward a position where the contact point is at a comfortable offset.
    let target = READY;
    if (plan && now >= this.moveFrom) {
      const fh = plan.pos.x >= this.body.x - 0.1;
      target = { x: plan.pos.x + (fh ? -0.4 : 0.3), z: Math.max(TABLE.halfLength + 0.15, plan.pos.z + ARM) };
    }
    const move = (from: number, to: number) => from + Math.max(-p.moveSpeed * dt, Math.min(p.moveSpeed * dt, to - from));
    if (!plan || now >= this.moveFrom) {
      this.body.x = move(this.body.x, target.x);
      this.body.z = move(this.body.z, target.z);
    }

    // Paddle: toward the contact point at limited speed, within reach of the body.
    // Before the stroke, wait at the backswing point (contact point minus the swing).
    const goal =
      plan && now >= this.moveFrom
        ? v3(plan.pos.x - plan.vel.x * SWING_TIME, plan.pos.y - plan.vel.y * SWING_TIME, plan.pos.z - plan.vel.z * SWING_TIME)
        : v3(this.body.x + 0.3, TABLE.height + 0.25, this.body.z - ARM);
    const cur = this.pose.pos;
    const d = v3(goal.x - cur.x, goal.y - cur.y, goal.z - cur.z);
    const dist = length(d);
    const stepLen = Math.min(dist, p.paddleSpeed * dt);
    let pos = dist > 1e-9 ? v3(cur.x + (d.x / dist) * stepLen, cur.y + (d.y / dist) * stepLen, cur.z + (d.z / dist) * stepLen) : cur;
    pos = v3(
      Math.max(this.body.x - REACH, Math.min(this.body.x + REACH, pos.x)),
      Math.max(TABLE.height - 0.3, Math.min(TABLE.height + 1.0, pos.y)),
      Math.max(this.body.z - REACH, Math.min(this.body.z - 0.1, pos.z)),
    );

    // The stroke itself is kinematic: around contact the blade travels along its stroke
    // velocity and passes through the planned contact point at the planned time, so
    // contact happens where and when the solver assumed (from backswing to follow-through).
    const striking = plan !== null && Math.abs(now - plan.t) < STROKE_WINDOW;
    if (plan && striking && now >= this.moveFrom) {
      const dtc = Math.max(-SWING_TIME, Math.min(SWING_TIME, now - plan.t));
      pos = v3(plan.pos.x + plan.vel.x * dtc, plan.pos.y + plan.vel.y * dtc, plan.pos.z + plan.vel.z * dtc);
    }
    this.pose = {
      pos,
      normal: plan ? plan.normal : v3(0, 0, -1),
      vel: striking ? plan!.vel : v3(),
    };
  }

  /** World-frame collider for one physics tick (index of count ticks this frame). */
  collider(index: number, count: number): PaddleCollider {
    const a = this.prevPose;
    const b = this.pose;
    return {
      id: this.id,
      front: this.rubber,
      back: this.rubber,
      extraRadius: 0.02,
      poseAt: (f) => {
        const t = (index + f) / count;
        return mapPose(this.side, { pos: lerp(a.pos, b.pos, t), normal: normalize(lerp(a.normal, b.normal, t)), vel: b.vel });
      },
    };
  }

  /** World-frame pose and body, for rendering. */
  get worldPose(): PaddlePose {
    return mapPose(this.side, this.pose);
  }

  get worldBody(): { x: number; z: number } {
    const w = mapVec(this.side, v3(this.body.x, 0, this.body.z));
    return { x: w.x, z: w.z };
  }
}
