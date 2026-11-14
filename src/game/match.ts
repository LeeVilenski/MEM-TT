import {
  BallSim,
  GRAVITY,
  TABLE,
  TICK_DT,
  predict,
  v3,
  type BallEvent,
  type BallState,
  type PaddleCollider,
  type PhysicsParams,
  type Vec3,
} from '../physics';
import { AiPlayer } from './ai';
import { other, type SideId } from './frame';
import { IncomingPrediction } from './intercept';
import { SERVE_TOSS_AHEAD, type MoveInput, type Player } from './player';
import { RallyReferee, Scoreboard, DEFAULT_MATCH, type MatchConfig, type PointResult } from './rules';
import { type SwingInput } from './swing';

/** A side is played either by a local human (near end only, for now) or the AI. */
export type Controller = { kind: 'human'; player: Player } | { kind: 'ai'; ai: AiPlayer };

export type MatchPhase = 'serve-wait' | 'rally' | 'point-over' | 'match-over';

export type MatchEvent =
  | { type: 'toss'; server: SideId }
  | { type: 'hit'; side: SideId; event: Extract<BallEvent, { type: 'paddle' }>; serve: boolean }
  | { type: 'ball'; event: BallEvent }
  | { type: 'point'; result: PointResult; game: boolean; match: boolean }
  | { type: 'let' };

/** Pause after a point before the next serve (game seconds). */
const POINT_PAUSE = 1.6;
/** AI servers wait this long before tossing. */
const AI_SERVE_DELAY = 1.0;
const MAX_TOSS = 1.2;

/**
 * Runs a match: serving, rallies judged by the referee, scoring and the AI.
 * Engine-agnostic (no rendering or DOM), so whole matches can run in tests,
 * and the same code can later run on an authoritative server.
 */
export class Match {
  readonly score: Scoreboard;
  phase: MatchPhase = 'serve-wait';
  sim: BallSim | null = null;
  referee: RallyReferee | null = null;
  /** Game clock, seconds. */
  clock = 0;
  private rallyStart = 0;
  private phaseTime = 0;
  private accumulator = 0;
  private tossStartY = 0;
  private tossApex = 0;
  /** Predicted incoming flight for each human side (world frame). */
  private incoming: Partial<Record<SideId, IncomingPrediction>> = {};
  lastResult: PointResult | null = null;
  /** Count of rallies and total paddle hits, for stats. */
  stats = { rallies: 0, hits: 0, longestRally: 0 };
  private listeners: ((e: MatchEvent) => void)[] = [];

  constructor(
    readonly params: PhysicsParams,
    readonly sides: Record<SideId, Controller>,
    config: MatchConfig = DEFAULT_MATCH,
  ) {
    this.score = new Scoreboard(config);
  }

  on(fn: (e: MatchEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: MatchEvent) {
    for (const l of this.listeners) l(e);
  }

  get server(): SideId {
    return this.score.server;
  }

  /** Absolute game time of the current ball simulation. */
  get ballTime(): number {
    return this.rallyStart + (this.sim?.time ?? 0);
  }

  /** Where the server holds the ball before tossing (world). */
  handPosition(side: SideId = this.server): Vec3 {
    const c = this.sides[side];
    if (c.kind === 'ai') {
      const b = c.ai.worldBody;
      const s = side === 'near' ? 1 : -1;
      return v3(b.x + 0.3 * s, TABLE.height + 0.06, s * (TABLE.halfLength + 0.15));
    }
    // Human: in line with the paddle and in its plane, so the dropping ball meets it.
    const pose = c.player.swing.pose;
    return v3(pose.pos.x, TABLE.height + 0.06, c.player.restZ - SERVE_TOSS_AHEAD);
  }

  /** Is a human waiting to serve? */
  get humanToServe(): boolean {
    return this.phase === 'serve-wait' && this.sides[this.server].kind === 'human';
  }

  /** Toss for a human server. height: metres above the hand (clamped to legal-ish range). */
  toss(height: number) {
    if (!this.humanToServe) return;
    const h = Math.max(0.05, Math.min(MAX_TOSS, height));
    this.startRally(this.handPosition(), Math.sqrt(2 * GRAVITY * h));
  }

  private startRally(hand: Vec3, tossVy: number) {
    const state: BallState = { pos: hand, vel: v3(0, tossVy, 0), spin: v3() };
    this.sim = new BallSim(state, this.params);
    this.prevBallPos = { ...hand };
    this.rallyStart = this.clock;
    this.accumulator = 0;
    this.referee = new RallyReferee(this.server);
    this.bouncedOn = { near: false, far: false };
    this.tossStartY = hand.y;
    this.tossApex = hand.y;
    this.phase = 'rally';
    this.phaseTime = 0;
    this.incoming = {};
    for (const s of ['near', 'far'] as const) {
      const c = this.sides[s];
      if (c.kind === 'human') {
        c.player.intercept = null;
        c.player.shotMode = s === this.server ? 'serve' : 'rally';
      }
    }
    this.emit({ type: 'toss', server: this.server });
  }

  /** The human's predicted contact point (for the intercept marker), if a ball is coming. */
  interceptFor(side: SideId): Vec3 | null {
    return this.interceptPointFor(side)?.pos ?? null;
  }

  /** The human's planned contact point and time (the player chooses it; see Player.contactFor). */
  interceptPointFor(side: SideId): { pos: Vec3; t: number } | null {
    const c = this.sides[side];
    const pred = this.incoming[side];
    if (c.kind !== 'human') return null;
    return c.player.contactFor(pred && this.phase === 'rally' ? pred : null, this.ballTime);
  }

  /**
   * Advance the match.
   * @param gameDt game-time step (slow motion scales this)
   * @param realDt real-time step (human swings are measured in real time)
   * @param human input for a human-controlled side
   */
  frame(gameDt: number, realDt: number, human?: { side: SideId; input: SwingInput; move: MoveInput }) {
    this.clock += gameDt;
    this.phaseTime += gameDt;

    // Players move every frame.
    for (const s of ['near', 'far'] as const) {
      const c = this.sides[s];
      // Pose for the end of this frame: the physics ticks interpolate from the
      // previous pose to this one, so the blade is exactly on its planned path.
      if (c.kind === 'ai') c.ai.update(gameDt, this.ballTime + gameDt);
      else {
        c.player.setIntercept(this.interceptPointFor(s), this.ballTime);
        // Serving: the tossed ball, until it is struck (for the serve magnet).
        c.player.serveBall = s === this.server && this.phase === 'rally' && this.sim && this.referee?.hits === 0 ? this.sim.state : null;
        const h = human && human.side === s ? human : { input: { dx: 0, dy: 0, drive: false, close: false, open: false, hookLeft: false, hookRight: false }, move: { x: 0, z: 0 } };
        c.player.update(realDt, h.input, h.move, { x: 0, z: -0.85 });
      }
    }

    if (this.phase === 'serve-wait') {
      const c = this.sides[this.server];
      if (c.kind === 'ai' && this.phaseTime >= AI_SERVE_DELAY) {
        const { hand, tossVy } = c.ai.planServe(this.clock);
        this.startRally(hand, tossVy);
      }
      return;
    }

    if (!this.sim) return;
    this.accumulator += gameDt;
    const ticks = Math.floor(this.accumulator / TICK_DT + 1e-9);
    this.accumulator -= ticks * TICK_DT;
    for (let i = 0; i < ticks; i++) this.tick(i, ticks);

    if (this.phase === 'point-over' && this.phaseTime >= POINT_PAUSE) this.nextPoint();
  }

  private collidersFor(index: number, count: number): PaddleCollider[] | undefined {
    if (this.phase !== 'rally' || !this.referee || !this.sim) return undefined;
    const side = this.referee.expectedHitter;
    if (!side) return undefined;
    // The server can only strike the toss on its way down.
    if (side === this.server && this.referee.hits === 0 && this.sim.state.vel.y >= 0) return undefined;
    const c = this.sides[side];
    // No accidental volleys (an assisted or waiting paddle can sit in the ball's path
    // over the table): contact only after the bounce, or once the ball is past the end line.
    const localZ = side === 'near' ? this.sim.state.pos.z : -this.sim.state.pos.z;
    if (this.referee.hits > 0 && this.referee.ballHeadingTo === side && this.referee.expectedHitter === side && !this.bouncedOn[side] && localZ < TABLE.halfLength) return undefined;
    return [c.kind === 'ai' ? c.ai.collider(index, count) : c.player.collider(index, count)];
  }

  private sideOfPaddle(id: string): SideId {
    for (const s of ['near', 'far'] as const) {
      const c = this.sides[s];
      if ((c.kind === 'ai' ? c.ai.id : c.player.id) === id) return s;
    }
    return 'near';
  }

  /** Ball position for rendering: interpolated between ticks, or in the server's hand. */
  ballRenderPos(): Vec3 {
    if (!this.sim) return this.handPosition();
    const a = Math.min(1, this.accumulator / TICK_DT);
    const p = this.prevBallPos;
    const q = this.sim.state.pos;
    return v3(p.x + (q.x - p.x) * a, p.y + (q.y - p.y) * a, p.z + (q.z - p.z) * a);
  }

  private prevBallPos: Vec3 = v3();

  private tick(index: number, count: number) {
    const sim = this.sim!;
    this.prevBallPos = { ...sim.state.pos };
    const events: BallEvent[] = [];
    sim.step(TICK_DT, events, this.collidersFor(index, count));
    if (this.referee && this.referee.hits === 0) this.tossApex = Math.max(this.tossApex, sim.state.pos.y);
    for (const e of events) {
      if (e.type === 'table') this.bouncedOn[e.side] = true;
      if (e.type === 'paddle') this.bouncedOn = { near: false, far: false };
      this.onBallEvent(e);
    }
  }

  private bouncedOn: Record<SideId, boolean> = { near: false, far: false };

  private onBallEvent(e: BallEvent) {
    this.emit({ type: 'ball', event: e });
    if (this.phase !== 'rally' || !this.referee) return;
    const ref = this.referee;

    let ctx: Parameters<RallyReferee['onEvent']>[1] = {};
    const isServe = e.type === 'paddle' && ref.hits === 0;
    if (e.type === 'paddle') {
      const hitter = this.sideOfPaddle(e.paddleId);
      ctx = { hitter };
      if (isServe) {
        const sign = hitter === 'near' ? 1 : -1;
        ctx.serve = { tossHeight: this.tossApex - this.tossStartY, ballVy: e.velIn.y, localPos: { y: e.pos.y, z: e.pos.z * sign } };
      } else if (ref.expectedHitter === hitter && ref.ballHeadingTo === hitter) {
        // Possible volley: would the ball have landed on the hitter's half?
        const { events } = predict({ pos: e.pos, vel: e.velIn, spin: e.spinIn }, this.params, { maxTime: 1.5, stop: (x) => x.type === 'table' || x.type === 'floor' });
        const land = events.find((x) => x.type === 'table' || x.type === 'floor');
        ctx.volleyWouldLand = land?.type === 'table' && (land.pos.z >= 0 ? 'near' : 'far') === hitter;
      }
      this.stats.hits++;
      this.emit({ type: 'hit', side: hitter, event: e, serve: isServe });
    }

    const out = ref.onEvent(e, ctx);
    if (out) return this.endRally(out.kind === 'let' ? null : out.result);

    // After a hit, the ball heads to the other side: let its player get ready.
    if (e.type === 'paddle') {
      const to = other(ctx.hitter!);
      const state: BallState = { pos: e.pos, vel: e.velOut, spin: e.spinOut };
      const now = this.rallyStart + e.time;
      const c = this.sides[to];
      if (c.kind === 'ai') c.ai.planReturn(state, now);
      else this.incoming[to] = new IncomingPrediction(state, this.params, now);
      const hc = this.sides[ctx.hitter!];
      if (hc.kind === 'human') hc.player.shotMode = 'rally';
      else hc.ai.clearPlan();
    }
  }

  private endRally(result: PointResult | null) {
    this.phase = 'point-over';
    this.phaseTime = 0;
    this.lastResult = result;
    this.stats.rallies++;
    this.stats.longestRally = Math.max(this.stats.longestRally, this.referee?.hits ?? 0);
    this.incoming = {};
    for (const s of ['near', 'far'] as const) {
      const c = this.sides[s];
      if (c.kind === 'ai') c.ai.clearPlan();
      else c.player.intercept = null;
    }
    if (!result) {
      this.emit({ type: 'let' });
      return;
    }
    const { game, match } = this.score.award(result.winner);
    this.emit({ type: 'point', result, game, match });
  }

  private nextPoint() {
    if (this.score.winner) {
      this.phase = 'match-over';
      return;
    }
    this.phase = 'serve-wait';
    this.phaseTime = 0;
    this.sim = null;
    this.referee = null;
  }
}
