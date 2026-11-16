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
  spinVector,
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
import { STYLES, type PlayStyle } from './styles';
import { BLADES, batRubbers, defaultBat, type Bat } from './equipment';

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
  /**
   * How well it reads a serve's spin: the relative error (standard deviation) of the spin it
   * plans against. It sees where the ball goes; it can misjudge how much it's spinning (and a
   * no-spin serve can look like backspin).
   */
  spinRead: number;
}

export type AiLevel = 'easy' | 'medium' | 'hard' | 'expert';

export const AI_LEVELS: Record<AiLevel, AiProfile> = {
  easy: { name: 'Easy', reaction: 0.22, moveSpeed: 2.6, paddleSpeed: 4, pitchError: 4.5, yawError: 3.5, speedError: 0.12, aggression: 0.2, margin: 0.3, spinRead: 0.5 },
  medium: { name: 'Medium', reaction: 0.16, moveSpeed: 3.4, paddleSpeed: 5, pitchError: 2.2, yawError: 2, speedError: 0.07, aggression: 0.5, margin: 0.2, spinRead: 0.36 },
  hard: { name: 'Hard', reaction: 0.1, moveSpeed: 4.4, paddleSpeed: 6.5, pitchError: 1.0, yawError: 1, speedError: 0.04, aggression: 0.8, margin: 0.12, spinRead: 0.22 },
  // Near-perfect: reads the ball instantly, covers the table and rarely misses.
  expert: { name: 'Expert', reaction: 0.06, moveSpeed: 5.4, paddleSpeed: 8, pitchError: 0.45, yawError: 0.5, speedError: 0.02, aggression: 0.7, margin: 0.16, spinRead: 0.12 },
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
  chop: v3(0, -4.5, -6.5),
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
  /** Where across the table it aimed (local x), if solved. */
  aimX?: number;
}

const READY = { x: 0, z: TABLE.halfLength + 0.65 };
const ARM = 0.45;
const REACH = 0.95;
/** Paddle stroke velocity is applied within this window around the planned contact time. */
const STROKE_WINDOW = 0.1;
/** Closest the body gets to the net: right up against the end line, to take short balls. */
const MIN_BODY_Z = TABLE.halfLength + 0.04;
/** Forward reach when leaning in over the table (more than sideways: the whole body tips in). */
const OVER_REACH = 1.12;
/** Nearest the net a contact can be (local z): body at the end line plus a long lean. */
const MIN_REACH_Z = MIN_BODY_Z - OVER_REACH;
/** During the stroke the bat stays this close to the body (m), and this far back from the net. */
const STRIKE_REACH = REACH + 0.1;
const NET_CLEARANCE_Z = 0.12;
/** Rally contact happens about this long after the planned moment (s): the blade starts behind the ball. */
const CONTACT_LAG = 0.008;
/** Half-duration of the visible swing through the contact point, seconds. */
const SWING_TIME = 0.05;

export class AiPlayer {
  readonly id: string;
  body = { ...READY };
  rubber: Rubber = RUBBERS.inverted;
  plan: AiPlan | null = null;
  /** Doubles: serves must go diagonally (own right half → receiver's right half). */
  doubles = false;
  /**
   * Doubles: which side (−1 left, +1 right, in its own frame) this player waits on when it
   * isn't its turn, so partners don't stand in each other's way (or in front of the camera).
   */
  doublesSide = 0;
  /** Doubles: not involved in the next shot (steps aside); or receiving the serve (set by the room). */
  waiting = false;
  receiving = false;
  /** Playing style: stroke preferences, distance from the table and rubbers. */
  style: PlayStyle = STYLES.allround;

  setStyle(style: PlayStyle) {
    this.style = style;
    this.rubber = style.rubbers.forehand;
    this.bat = defaultBat(style.id);
    this.control = 0;
    this.body = { ...this.ready };
  }

  /** The bat (call after setStyle). The AI plays both wings with its forehand rubber. */
  bat: Bat = defaultBat('allround');
  /** The blade's control (0–1): steadier execution. */
  private control = 0;

  setBat(bat: Bat) {
    this.bat = { ...bat };
    this.rubber = batRubbers(bat).forehand;
    this.control = (BLADES[bat.blade] ?? BLADES.starter).control;
  }

  /** Display name, e.g. "Sysadmin · Senior". */
  get displayName() {
    return `${this.style.character} · ${this.profile.name}`;
  }

  /** Ready position for this style. */
  private get ready() {
    const z = TABLE.halfLength + Math.max(0.45, this.style.distance);
    if (this.doubles) {
      // Receiving the serve: ready in your right half-court (+x in your own frame).
      if (this.receiving) return { x: 0.3, z };
      // Not your shot next: off to one side and a step back, out of your partner's way.
      if (this.waiting && this.doublesSide) return { x: this.doublesSide * 0.75, z: z + 0.5 };
    }
    return { x: 0, z };
  }

  /** Reorder candidate strokes by style preference (randomised, so styles mix it up). */
  private byStyle(choices: StrokeKind[]): StrokeKind[] {
    const w = this.style.ai as Partial<Record<StrokeKind, number>>;
    return choices
      .map((k, i) => ({ k, score: (w[k] ?? 1) * (1 + this.rng()) * (1 - i * 0.15) }))
      .sort((a, b) => b.score - a.score)
      .map((x) => x.k);
  }
  private moveFrom = 0;
  /** Serves seen this match, by kind: each repeat of a kind is read better. */
  private serveMemory: Record<string, number> = {};
  /** The last ball's read: true and perceived topspin (rps), for tests and debugging. */
  lastRead: { kind: string; top: number; seenTop: number } | null = null;

  /**
   * The ball as the AI perceives it when receiving a serve: the same position and velocity,
   * but the spin read with error (and a no-spin serve may look like backspin). Each repeat of
   * the same kind of serve in a match is read better. Rally balls are read exactly.
   */
  private perceive(at: BallState, serve: boolean): BallState {
    if (!serve) return at;
    const c = spinComponents(at.vel, at.spin);
    const total = Math.hypot(c.top, c.side, c.cork);
    const kind = total < 10 ? 'none' : Math.abs(c.side) > Math.abs(c.top) ? 'side' : c.top < 0 ? 'back' : 'top';
    const seen = this.serveMemory[kind] ?? 0;
    const sd = this.profile.spinRead * Math.max(0.35, Math.pow(0.7, seen));
    for (const k of Object.keys(this.serveMemory)) this.serveMemory[k] = Math.max(0, this.serveMemory[k] - 0.5);
    this.serveMemory[kind] = seen + 1;
    let read: typeof c;
    // A float looks like the backspin serve it's disguised as.
    if (kind === 'none' && this.rng() < Math.min(0.8, sd * 1.2)) read = { top: -(25 + 20 * this.rng()), side: c.side, cork: c.cork };
    else {
      const f = (sd: number) => Math.max(0.2, Math.min(1.8, 1 + this.gauss() * sd));
      read = { top: c.top * f(sd), side: c.side * f(sd), cork: c.cork * f(sd) };
    }
    this.lastRead = { kind, top: c.top, seenTop: read.top };
    if (sd <= 0) return at;
    return { pos: at.pos, vel: at.vel, spin: spinVector(at.vel, read) };
  }
  private lastTargetX = 0;
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
  planReturn(world: BallState, now: number, opts: { serve?: boolean } = {}): AiPlan | null {
    const local = mapState(this.side, world);
    const pred = new IncomingPrediction(local, this.params, now);
    // Where it meets the ball depends on the style: blockers stay close, choppers deep.
    // A counter-looper (lowLoop) lets the ball drop further, to topspin it from below the table.
    const late = (this.style.personality?.lowLoop ?? 0) * 0.8 * this.rng();
    const planeZ = TABLE.halfLength + Math.max(0.15, this.style.distance - 0.4) + this.rng() * 0.25 + late;
    let ic = pred.interceptAt(planeZ, now, TABLE.height + 0.95);
    // Out of reach over the table (a short ball, or heavy backspin checking back toward the
    // net): take it at the highest point it can still be reached, or let it go.
    // A slow ball that bounces short (a drop, or short topspin that kicks on past the end
    // line low): step in and take it at the top of the bounce, not falling below the table.
    const play = pred.playable();
    if (ic && play.length) {
      const first = play[0];
      const next = play[Math.min(play.length - 1, 4)];
      const speed = Math.hypot(next.pos.x - first.pos.x, next.pos.y - first.pos.y, next.pos.z - first.pos.z) / Math.max(1e-6, next.t - first.t);
      if (first.pos.z < TABLE.halfLength * 0.6 && speed < 6.5 && ic.pos.y < TABLE.height + 0.12) {
        const top = play.filter((p) => p.t >= now + this.profile.reaction + 0.12 && p.pos.z >= MIN_REACH_Z && p.pos.y <= TABLE.height + 0.95);
        if (top.length) ic = top.reduce((a, b) => (b.pos.y > a.pos.y ? b : a));
      }
    }
    if (!ic || ic.pos.z < MIN_REACH_Z) {
      const reachable = pred.playable().filter((p) => p.t >= now && p.pos.z >= MIN_REACH_Z && p.pos.y <= TABLE.height + 0.95);
      ic = reachable.length ? reachable.reduce((a, b) => (b.pos.y > a.pos.y ? b : a)) : null;
    }
    if (!ic) return (this.plan = null);

    const real = this.stateAt(local, now, ic.t);
    if (!real) return (this.plan = null);
    // It plans its stroke against the spin it *thinks* the ball has.
    const at = this.perceive(real, !!opts.serve);
    const c = spinComponents(at.vel, at.spin);
    const height = at.pos.y - TABLE.height;
    const overTable = at.pos.z < TABLE.halfLength;
    const a = this.profile.aggression;
    const r = this.rng();
    const pers = this.style.personality ?? {};

    // Personality first: a counter-attacker blocks pace steadily and loops balls taken
    // low; these choices are made in a fixed order (not re-ranked by stroke preference).
    const fast = length(at.vel) > 9;
    if (fast && pers.blockPace && this.rng() < pers.blockPace) {
      return (this.plan = this.solve(at, ic.t, ['block', 'loop', 'drive'], 'rally', now, { steady: pers.blockPace }));
    }
    if (pers.lowLoop && at.pos.y < TABLE.height + 0.02 && !overTable && this.rng() < pers.lowLoop) {
      return (this.plan = this.solve(at, ic.t, ['loop', 'chop', 'block'], 'rally', now));
    }

    // Slicers (Will): when it isn't a ball to smash, often slice it back with backspin.
    const smashable = height > (pers.smashHeight ?? 0.42);
    if (pers.slice && !smashable && c.top < 15 && this.rng() < pers.slice) {
      const slice: StrokeKind[] = at.pos.z > TABLE.halfLength + 0.5 ? ['chop', 'push', 'block'] : ['push', 'chop', 'block'];
      return (this.plan = this.solve(at, ic.t, slice, 'rally', now));
    }
    let choices: StrokeKind[];
    if (height > (pers.smashHeight ?? 0.42) && r < Math.min(0.95, (0.35 + 0.6 * a) * (pers.smashAppetite ?? 1))) choices = ['smash', 'drive', 'block'];
    // Short topspin over the table: block it back (safe), or flick it when feeling aggressive.
    else if (overTable && c.top > 5) choices = r < 0.6 * a ? ['flick', 'block', 'push'] : ['block', 'flick', 'push'];
    else if (overTable) choices = c.top < -10 && r > 0.25 + 0.5 * a ? ['push', 'flick', 'block'] : ['flick', 'push', 'block'];
    else if (c.top < -15) choices = r < 0.2 + 0.7 * a ? ['loop', 'push', 'drive'] : ['push', 'loop', 'block'];
    else if (at.pos.z > TABLE.halfLength + 1.2) choices = r < 0.5 ? ['chop', 'loop', 'block'] : ['loop', 'chop', 'block'];
    else choices = r < 0.25 + 0.5 * a ? ['loop', 'drive', 'block'] : r < 0.7 ? ['drive', 'block', 'loop'] : ['block', 'drive', 'loop'];

    // Keep every candidate the situation allows, but let the style decide the order.
    const extra: StrokeKind[] = at.pos.z > TABLE.halfLength + 0.8 ? ['chop'] : [];
    return (this.plan = this.solve(at, ic.t, this.byStyle([...new Set([...choices, ...extra])]), 'rally', now));
  }

  /**
   * Plan a serve. Returns the hand position (world) and upward toss speed; the match
   * spawns the ball there. The plan strikes the ball on its way down.
   */
  planServe(now: number): { hand: Vec3; tossVy: number } {
    this.body = { ...READY, z: TABLE.halfLength + 0.65 };
    // Doubles: serve from the right half (+x locally) so the ball can go diagonally.
    const handX = this.doubles ? 0.25 + this.rng() * 0.3 : this.body.x + this.hand * 0.3 + (this.rng() - 0.5) * 0.3;
    const hand = v3(handX, TABLE.height + 0.06, TABLE.halfLength + 0.15);
    const tossHeight = 0.3 + this.rng() * 0.35;
    const tossVy = Math.sqrt(2 * GRAVITY * tossHeight);
    const toss: BallState = { pos: hand, vel: v3(0, tossVy, 0), spin: v3() };

    // Contact on the way down, 10–22 cm above the table.
    const contactY = TABLE.height + 0.1 + this.rng() * 0.12;
    const sim = new BallSim(toss, this.params);
    while (sim.time < 2 && !(sim.state.vel.y < 0 && sim.state.pos.y <= contactY)) sim.step(TICK_DT);
    const r = this.rng();
    const kinds: StrokeKind[] = r < 0.45 ? ['serve-short', 'serve-side', 'serve-long'] : r < 0.75 ? ['serve-long', 'serve-short'] : ['serve-side', 'serve-short'];
    // Styles with serve preferences (Will's spinny sidespin serves) re-rank them.
    const servePrefs = Object.keys(this.style.ai).some((k) => k.startsWith('serve-'));
    this.plan = this.solve(sim.state, now + sim.time, servePrefs ? this.byStyle([...new Set([...kinds, 'serve-side', 'serve-short'] as StrokeKind[])]) : kinds, 'serve', now);
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

  /** The ball (local frame) `dt` seconds later. */
  private advance(b: BallState, dt: number): BallState {
    const sim = new BallSim(b, this.params);
    while (sim.time < dt - 1e-9) sim.step(TICK_DT);
    return sim.state;
  }

  private gauss() {
    const u = Math.max(1e-9, this.rng());
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * this.rng());
  }

  /** Pick the first stroke in `choices` that can be made to land, aiming at a target. */
  private solve(at: BallState, t: number, choices: StrokeKind[], mode: ShotMode, now: number, opts: { steady?: number } = {}): AiPlan {
    const p = this.profile;
    const pers = this.style.personality ?? {};
    const spin = pers.spin ?? 1;
    // Paddle just behind the ball so contact happens at the planned moment.
    // The blade starts just behind the ball and meets it a few milliseconds after the planned
    // moment: judge the landing from the ball as it will be then (it matters on short, slow balls).
    const met = mode === 'rally' ? this.advance(at, CONTACT_LAG) : at;
    const pos = v3(at.pos.x, at.pos.y, at.pos.z + 0.018);
    let best: AiPlan | null = null;

    // A sidespin serve can curve either way: try the mirrored brush if the first won't land.
    const attempts = choices.flatMap<{ stroke: StrokeKind; mirror: boolean }>((stroke) => (stroke === 'serve-side' ? [{ stroke, mirror: false }, { stroke, mirror: true }] : [{ stroke, mirror: false }]));
    for (const { stroke, mirror } of attempts) {
      // Patient players aim further inside the sidelines.
      const halfW = TABLE.halfWidth - p.margin - 0.12 * (pers.steady ?? 0);
      const diagonal = mode === 'serve' && this.doubles;
      // Receiver's right half-court is −x in the server's frame.
      let x = diagonal ? -(0.15 + this.rng() * (halfW - 0.15)) : (this.rng() * 2 - 1) * halfW;
      // Placement: go for the wide angles, switching sides to move the opponent around.
      if (mode === 'rally' && pers.placement && this.rng() < pers.placement) {
        const side = this.lastTargetX === 0 ? (this.rng() < 0.5 ? 1 : -1) : -Math.sign(this.lastTargetX);
        x = side * halfW * (0.8 + 0.2 * this.rng());
      }
      const target = { x, z: -DEPTH[stroke] };
      let vel = mirror ? v3(-STROKES[stroke].x, STROKES[stroke].y, STROKES[stroke].z) : STROKES[stroke];
      // Spin: more brush on loops and serves (more upward/downward and sideways swing).
      // Serves trade a little forward speed for the extra brush, so they still land short.
      if (spin !== 1 && stroke === 'loop') vel = v3(vel.x * spin, vel.y * spin, vel.z);
      // Looping a ball taken below the table: a steeper, lifting swing (more up, less forward).
      if (stroke === 'loop' && pos.y < TABLE.height + 0.05) {
        const below = TABLE.height + 0.05 - pos.y;
        vel = v3(vel.x, Math.min(18, vel.y + 2 + 18 * below), vel.z * (1 - Math.min(0.6, 1.5 * below)));
      }
      if (spin !== 1 && stroke.startsWith('serve-')) vel = v3(vel.x * spin, vel.y * spin, vel.z * Math.sqrt(spin));
      // Occasionally hook the loop for sidespin.
      if (stroke === 'loop' && !pers.flat && this.rng() < 0.25 * p.aggression) vel = v3((this.rng() < 0.5 ? -1 : 1) * 3, vel.y, vel.z);
      // Flat hitters brush nothing: the bat goes straight through the ball, so no spin.
      if (pers.flat) vel = v3(vel.x * (1 - pers.flat), vel.y * (1 - pers.flat), vel.z);
      // Patient players hit a little softer in the rally.
      if (pers.steady && mode === 'rally') vel = scale(vel, 1 - 0.15 * pers.steady);
      const yaw = (Math.atan2(target.x - pos.x, -(target.z - pos.z)) * 180) / Math.PI;
      const pose: PaddlePose = { pos, normal: v3(0, 0, -1), vel };

      // Scan the face angle; prefer angles near the target that also sit well inside the
      // landing window, so execution error doesn't immediately miss.
      const STEP = 2;
      const scan: { pitch: number; pos?: Vec3 }[] = [];
      for (let pitch = -72; pitch <= 72; pitch += STEP) {
        const normal = faceNormal(pitch, yaw);
        const res = landingOutcome(met, { ...pose, normal }, normal, this.rubber, this.params, mode);
        const diagonalOk = !diagonal || (res.first !== undefined && res.first.x >= 0.02 && res.pos !== undefined && res.pos.x <= -0.02);
        scan.push({ pitch, pos: res.outcome === 'in' && diagonalOk ? res.pos : undefined });
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
      // A controlled blade steadies the stroke a little.
      const errScale = (mode === 'serve' ? 0.35 : 1) * (1 - 0.25 * this.control);
      // Personal error: wild slammers spray their smashes; a counter-attacker blocks pace steadily.
      let personal = 1;
      if (stroke === 'smash') personal *= pers.smashError ?? 1;
      if (stroke === 'block' && opts.steady) personal *= 1 - 0.6 * opts.steady;
      if (pers.steady) personal *= 1 - 0.4 * pers.steady;
      const pitch = bestPitch + this.gauss() * p.pitchError * errScale * personal;
      // (Aim and pace are rehearsed too: a doubles serve must also land in the right half.)
      const yawErr = yaw + this.gauss() * p.yawError * errScale * personal;
      const speed = 1 + this.gauss() * p.speedError * errScale * personal;
      best = { t, pos, vel: scale(vel, speed), normal: faceNormal(pitch, yawErr), stroke, solved: true, aimX: target.x };
      this.lastTargetX = target.x;
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
    let target = this.ready;
    if (plan && now >= this.moveFrom) {
      const fh = (plan.pos.x - this.body.x) * this.hand >= -0.1;
      // Over the table (a short ball) the body steps right in to the end line and leans.
      const over = plan.pos.z < TABLE.halfLength;
      target = { x: plan.pos.x + this.hand * (fh ? -0.4 : 0.3) * (over ? 0.6 : 1), z: Math.max(over ? MIN_BODY_Z : TABLE.halfLength + 0.15, plan.pos.z + ARM) };
    }
    const step = p.moveSpeed * (this.style.personality?.mobility ?? 1) * dt;
    const move = (from: number, to: number) => from + Math.max(-step, Math.min(step, to - from));
    if (!plan || now >= this.moveFrom) {
      this.body.x = move(this.body.x, target.x);
      this.body.z = move(this.body.z, target.z);
    }

    // Paddle: toward the contact point at limited speed, within reach of the body.
    // Before the stroke, wait at the backswing point (contact point minus the swing).
    const goal =
      plan && now >= this.moveFrom
        ? v3(plan.pos.x - plan.vel.x * SWING_TIME, plan.pos.y - plan.vel.y * SWING_TIME, plan.pos.z - plan.vel.z * SWING_TIME)
        : v3(this.body.x + this.hand * 0.3, TABLE.height + 0.25, this.body.z - ARM);
    const cur = this.pose.pos;
    const d = v3(goal.x - cur.x, goal.y - cur.y, goal.z - cur.z);
    const dist = length(d);
    const stepLen = Math.min(dist, p.paddleSpeed * dt);
    let pos = dist > 1e-9 ? v3(cur.x + (d.x / dist) * stepLen, cur.y + (d.y / dist) * stepLen, cur.z + (d.z / dist) * stepLen) : cur;
    pos = v3(
      Math.max(this.body.x - REACH, Math.min(this.body.x + REACH, pos.x)),
      Math.max(TABLE.height - 0.3, Math.min(TABLE.height + 1.0, pos.y)),
      Math.max(this.body.z - OVER_REACH, Math.min(this.body.z - 0.1, pos.z)),
    );

    // The stroke itself is kinematic: around contact the blade travels along its stroke
    // velocity and passes through the planned contact point at the planned time, so
    // contact happens where and when the solver assumed (from backswing to follow-through).
    const striking = plan !== null && Math.abs(now - plan.t) < STROKE_WINDOW;
    if (plan && striking && now >= this.moveFrom) {
      const dtc = Math.max(-SWING_TIME, Math.min(SWING_TIME, now - plan.t));
      pos = v3(plan.pos.x + plan.vel.x * dtc, plan.pos.y + plan.vel.y * dtc, plan.pos.z + plan.vel.z * dtc);
      // Still within reach of the body (a late body means a miss, not a stretching arm),
      // and the follow-through stays on this side of the net.
      pos = v3(
        Math.max(this.body.x - STRIKE_REACH, Math.min(this.body.x + STRIKE_REACH, pos.x)),
        pos.y,
        Math.max(NET_CLEARANCE_Z, this.body.z - OVER_REACH - 0.03, Math.min(this.body.z - 0.05, pos.z)),
      );
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

  /** Bat hand in its own frame: +1 right-handed (forehand at +x), −1 left-handed. */
  private get hand() {
    return this.style.leftHanded ? -1 : 1;
  }

  /** Which wing the bat is on: forehand on the bat-hand side of the body. */
  get wing(): 'forehand' | 'backhand' {
    return (this.pose.pos.x - this.body.x) * this.hand >= 0 ? 'forehand' : 'backhand';
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
