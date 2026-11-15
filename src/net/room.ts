import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, predict, v3, type BallEvent, type BallState, type PhysicsParams } from '../physics';
import { AI_LEVELS, AiPlayer, type AiLevel } from '../game/ai';
import { mapVec, type SideId } from '../game/frame';
import { RallyReferee, Scoreboard, type RallyOutcome } from '../game/rules';
import { DEFAULT_REALISM, realismSettings } from '../game/realism';
import { STYLES, PLAYABLE_STYLE_IDS, type StyleId } from '../game/styles';
import {
  PROTOCOL_VERSION,
  fromV,
  fromWire,
  seatSide,
  seatsFor,
  toV,
  toWire,
  type ClientMsg,
  type GameMode,
  type RoomInfo,
  type ScoreSnap,
  type Seat,
  type ServerMsg,
  type WirePose,
} from './protocol';

/**
 * The room server's logic, independent of how it is hosted. Adapters (Node `ws`,
 * Cloudflare Durable Objects, an in-browser loopback for testing) only move messages
 * and call tick() regularly.
 *
 * Authority model: the player whose turn it is reports their contact (time + ball
 * state after the hit). The server keeps its own simulation of every flight and
 * referees it with the same rules engine as offline play, running GRACE seconds
 * behind real time so a hit that is still on its way over the network can count.
 */

export interface RoomHost {
  /** Server clock, seconds (monotonic). */
  now(): number;
  send(clientId: string, msg: ServerMsg): void;
}

/** How far the referee runs behind real time, waiting for late hit reports. */
export const GRACE = 0.3;
const POINT_PAUSE = 1.8;
const AI_SERVE_DELAY = 1.1;
/** Max distance between the server's ball and a reported contact point. */
const HIT_TOLERANCE = 0.4;
const POSE_INTERVAL = 0.05;

type MatchPhase = 'lobby' | 'serve-wait' | 'rally' | 'point-over' | 'over';

interface Flight {
  sim: BallSim;
  /** Server time of sim.time = 0. */
  t0: number;
  /** Live AI flights: has the ball bounced on the AI's half yet? */
  bounced?: boolean;
}

const timeOf = (f: Flight) => f.t0 + f.sim.time;

export class RoomCore {
  readonly info: RoomInfo;
  private clients = new Map<string, { name: string; style?: StyleId }>();
  private params: PhysicsParams;
  private baseParams: PhysicsParams;

  private phase: MatchPhase = 'lobby';
  private phaseStart = 0;
  private score: Scoreboard | null = null;
  private ais: Partial<Record<Seat, AiPlayer>> = {};
  private order: Seat[] = [];
  private serverIndex = 0;
  private hitIndex = 0;
  private next: Seat | null = null;
  private referee: RallyReferee | null = null;
  /** The server's authoritative flight, judged GRACE behind real time. */
  private judge: Flight | null = null;
  /** Live (real-time) flight used to find AI contacts. */
  private aiLive: Flight | null = null;
  private toss = { y0: 0, apex: 0 };
  private lastTick = 0;
  private lastPose = 0;
  /** Closed rooms can be garbage-collected by the adapter. */
  closed = false;

  constructor(
    code: string,
    private host: RoomHost,
    opts: { params?: PhysicsParams; rng?: () => number; mode?: GameMode; bestOf?: number; aiLevel?: AiLevel } = {},
  ) {
    this.baseParams = opts.params ?? DEFAULT_PARAMS;
    this.params = this.baseParams;
    this.rng = opts.rng ?? Math.random;
    this.clockBase = this.hostBase = host.now();
    this.info = {
      code,
      mode: opts.mode ?? 'singles',
      bestOf: opts.bestOf ?? 3,
      aiLevel: opts.aiLevel ?? 'medium',
      aiStyle: 'random',
      realism: DEFAULT_REALISM,
      host: '',
      seats: {},
      spectators: [],
      phase: 'lobby',
    };
    this.lastTick = host.now();
  }

  private rng: () => number;

  /**
   * Game clock. Runs at the room's game speed (the realism slider slows the whole
   * game down); re-based when a match starts so it stays continuous.
   */
  private speed = 1;
  private clockBase = 0;
  private hostBase = 0;
  now(): number {
    return this.clockBase + (this.host.now() - this.hostBase) * this.speed;
  }
  private setSpeed(k: number) {
    this.clockBase = this.now();
    this.hostBase = this.host.now();
    this.speed = k;
  }

  get clientCount() {
    return this.clients.size;
  }

  // ------------------------------------------------------------ connections

  /** A client connected and said hello. */
  join(id: string, msg: Extract<ClientMsg, { t: 'hello' }>) {
    if (msg.v !== PROTOCOL_VERSION) {
      this.host.send(id, { t: 'error', message: `Game version mismatch (server ${PROTOCOL_VERSION}, client ${msg.v}). Reload the page.` });
      return;
    }
    const name = (msg.name || 'Player').slice(0, 24);
    this.clients.set(id, { name, style: msg.style });
    if (!this.info.host) {
      this.info.host = id;
      if (msg.create) this.configure(msg.create);
    }
    // Take the first free seat while in the lobby.
    if (this.info.phase === 'lobby') {
      const free = seatsFor(this.info.mode).find((s) => !this.info.seats[s]);
      if (free) this.info.seats[free] = { name, clientId: id, style: msg.style };
    }
    this.refreshSpectators();
    this.host.send(id, { t: 'welcome', you: id, room: this.info, now: this.now() });
    this.broadcastRoom();
    if (this.info.phase !== 'lobby' && this.score) {
      this.host.send(id, { t: 'match', mode: this.info.mode, names: this.names(), score: this.snap(), realism: this.info.realism });
    }
  }

  leave(id: string) {
    if (!this.clients.delete(id)) return;
    for (const seat of Object.keys(this.info.seats) as Seat[]) {
      const info = this.info.seats[seat]!;
      if (info.clientId !== id) continue;
      if (this.info.phase === 'playing') {
        // Keep the match going: the AI takes over the seat.
        this.info.seats[seat] = { name: `${info.name} (AI)`, ai: this.info.aiLevel, style: info.style };
        this.ais[seat] = this.makeAi(seat, info.style);
      } else delete this.info.seats[seat];
    }
    if (this.info.host === id) this.info.host = this.clients.keys().next().value ?? '';
    if (this.clients.size === 0) this.closed = true;
    this.refreshSpectators();
    this.broadcastRoom();
  }

  handle(id: string, msg: ClientMsg) {
    if (!this.clients.has(id)) return;
    switch (msg.t) {
      case 'ping':
        return this.host.send(id, { t: 'pong', c: msg.c, s: this.now() });
      case 'sit':
        return this.sit(id, msg.seat);
      case 'config':
        if (id !== this.info.host || this.info.phase === 'playing') return;
        this.configure(msg);
        return this.broadcastRoom();
      case 'style': {
        if (!(msg.style in STYLES)) return;
        this.clients.get(id)!.style = msg.style;
        const seat = this.seatOf(id);
        if (seat) this.info.seats[seat]!.style = msg.style;
        return this.broadcastRoom();
      }
      case 'start':
        if (id !== this.info.host) return this.host.send(id, { t: 'error', message: 'Only the host can start the match.' });
        return this.startMatch(msg.fillAI);
      case 'toss': {
        const seat = this.seatOf(id);
        if (seat) this.applyToss(seat, msg.at, fromV(msg.hand), msg.vy);
        return;
      }
      case 'hit': {
        const seat = this.seatOf(id);
        if (seat) this.applyHit(seat, msg.at, fromWire(msg.ball), fromV(msg.velIn), fromV(msg.spinIn), fromV(msg.paddleVel));
        return;
      }
      case 'pose': {
        const seat = this.seatOf(id);
        if (seat) this.broadcast({ t: 'pose', seat, pose: msg.pose }, id);
        return;
      }
      case 'leave':
        return this.leave(id);
    }
  }

  private seatOf(id: string): Seat | null {
    for (const [seat, info] of Object.entries(this.info.seats)) if (info?.clientId === id) return seat as Seat;
    return null;
  }

  private sit(id: string, seat: Seat | null) {
    if (this.info.phase === 'playing') return;
    const current = this.seatOf(id);
    if (seat && (!seatsFor(this.info.mode).includes(seat) || this.info.seats[seat]?.clientId)) return;
    if (current) delete this.info.seats[current];
    if (seat) this.info.seats[seat] = { name: this.clients.get(id)!.name, clientId: id, style: this.clients.get(id)!.style };
    this.refreshSpectators();
    this.broadcastRoom();
  }

  private configure(c: { mode?: GameMode; bestOf?: number; aiLevel?: AiLevel; aiStyle?: StyleId | 'random'; realism?: number; aiStyles?: Partial<Record<Seat, StyleId>> }) {
    if (c.mode && c.mode !== this.info.mode) {
      this.info.mode = c.mode;
      // Drop seats that don't exist in the new mode, then re-seat everyone in order.
      const humans = Object.values(this.info.seats).filter((s) => s?.clientId);
      this.info.seats = {};
      seatsFor(c.mode).forEach((seat, i) => humans[i] && (this.info.seats[seat] = humans[i]));
    }
    if (c.bestOf && [1, 3, 5, 7].includes(c.bestOf)) this.info.bestOf = c.bestOf;
    if (c.aiLevel && c.aiLevel in AI_LEVELS) this.info.aiLevel = c.aiLevel;
    if (c.aiStyle && (c.aiStyle === 'random' || c.aiStyle in STYLES)) this.info.aiStyle = c.aiStyle;
    if (c.aiStyles) {
      const valid = seatsFor(this.info.mode);
      this.info.aiStyles = Object.fromEntries(Object.entries(c.aiStyles).filter(([seat, st]) => valid.includes(seat as Seat) && st && st in STYLES));
    }
    if (typeof c.realism === 'number' && c.realism >= 0 && c.realism <= 1) this.info.realism = c.realism;
    this.refreshSpectators();
  }

  private refreshSpectators() {
    const seated = new Set(Object.values(this.info.seats).map((s) => s?.clientId));
    this.info.spectators = [...this.clients.entries()].filter(([id]) => !seated.has(id)).map(([id, c]) => ({ id, name: c.name }));
  }

  // ------------------------------------------------------------ match flow

  private makeAi(seat: Seat, style?: StyleId) {
    const ai = new AiPlayer(seatSide(seat), AI_LEVELS[this.info.aiLevel], this.params, this.rng);
    ai.doubles = this.info.mode === 'doubles';
    // Partners wait on opposite sides (seat 1 to the right, seat 2 to the left).
    ai.doublesSide = ai.doubles ? (seat.endsWith('1') ? 1 : -1) : 0;
    ai.setStyle(STYLES[style ?? this.info.seats[seat]?.style ?? 'allround']);
    return ai;
  }

  private pickAiStyle(): StyleId {
    if (this.info.aiStyle !== 'random') return this.info.aiStyle;
    // Random, but not a character already at the table (two Ryans is confusing).
    const taken = new Set<StyleId | undefined>([...Object.values(this.info.seats).map((s) => s?.style), ...Object.values(this.info.aiStyles ?? {})]);
    const free = PLAYABLE_STYLE_IDS.filter((id) => !taken.has(id));
    const pool = free.length ? free : PLAYABLE_STYLE_IDS;
    return pool[Math.floor(this.rng() * pool.length)];
  }

  /** Start a match (or a rematch). Optionally fill empty seats with the AI. */
  startMatch(fillAI: boolean) {
    const seats = seatsFor(this.info.mode);
    for (const s of seats) {
      // Seats left by AI from a previous match are refilled fresh.
      if (this.info.seats[s]?.ai) delete this.info.seats[s];
      if (!this.info.seats[s] && fillAI) {
        const style = this.info.aiStyles?.[s] ?? this.pickAiStyle();
        this.info.seats[s] = { name: `${STYLES[style].character} · ${AI_LEVELS[this.info.aiLevel].name} (AI)`, ai: this.info.aiLevel, style };
      }
    }
    if (seats.some((s) => !this.info.seats[s])) {
      return this.broadcast({ t: 'error', message: 'Not enough players — fill the empty seats with the AI or wait for others to join.' });
    }
    // Realism: physics (spin curve) and game speed are room-wide so everyone agrees.
    const r = realismSettings(this.info.realism);
    this.params = { ...this.baseParams, liftCoefficientMax: this.baseParams.liftCoefficientMax * r.spinCurve, tableBounceKeep: r.bounceKeep };
    this.setSpeed(r.gameSpeed);
    this.lastTick = this.now();
    this.ais = {};
    for (const s of seats) if (this.info.seats[s]!.ai) this.ais[s] = this.makeAi(s);
    this.score = new Scoreboard({ bestOf: this.info.bestOf, pointsToWin: 11, firstServer: this.rng() < 0.5 ? 'near' : 'far' });
    this.info.phase = 'playing';
    this.broadcastRoom();
    this.broadcast({ t: 'match', mode: this.info.mode, names: this.names(), score: this.snap(), realism: this.info.realism });
    this.beginServe();
  }

  private names(): Partial<Record<Seat, string>> {
    return Object.fromEntries(Object.entries(this.info.seats).map(([s, i]) => [s, i!.name]));
  }

  /** Serving order for the current game: [server, receiver, server's partner, receiver's partner]. */
  private rotationOrder(): Seat[] {
    const s = this.score!.gameFirstServer;
    const r: SideId = s === 'near' ? 'far' : 'near';
    return this.info.mode === 'singles' ? [`${s}1` as Seat, `${r}1` as Seat] : [`${s}1` as Seat, `${r}1` as Seat, `${s}2` as Seat, `${r}2` as Seat];
  }

  private beginServe() {
    this.phase = 'serve-wait';
    this.phaseStart = this.now();
    this.order = this.rotationOrder();
    this.serverIndex = this.score!.rotation % this.order.length;
    this.hitIndex = 0;
    this.next = this.order[this.serverIndex];
    this.referee = null;
    this.judge = null;
    this.aiLive = null;
    const receiver = this.order[(this.serverIndex + 1) % this.order.length];
    this.broadcast({ t: 'serve', server: this.next, receiver, score: this.snap() });
  }

  private applyToss(by: Seat, at: number, hand: { x: number; y: number; z: number }, vy: number) {
    if (this.phase !== 'serve-wait' || by !== this.next) return;
    const now = this.now();
    at = Math.min(now, Math.max(this.phaseStart, at));
    // Sanity: the hand must be behind the server's end line, near table height.
    const local = mapVec(seatSide(by), hand);
    if (local.z < TABLE.halfLength - 0.05 || Math.abs(local.y - TABLE.height) > 0.4 || !(vy >= 0 && vy <= 7)) return;

    const state: BallState = { pos: hand, vel: v3(0, vy, 0), spin: v3() };
    this.referee = new RallyReferee(seatSide(by), this.info.mode === 'doubles');
    this.judge = { sim: new BallSim(state, this.params), t0: at };
    this.toss = { y0: hand.y, apex: hand.y };
    this.phase = 'rally';
    this.startAiLive(state, at);
    this.broadcast({ t: 'toss', at, by, hand: toV(hand), vy, next: by });
  }

  private startAiLive(state: BallState, at: number) {
    const ai = this.next && this.ais[this.next];
    this.aiLive = ai ? { sim: new BallSim(state, this.params), t0: at } : null;
  }

  /** Advance the judged flight to time `t`, feeding events to the referee. Returns false if the point ended. */
  private judgeTo(t: number): boolean {
    const j = this.judge;
    if (!j || !this.referee) return false;
    while (timeOf(j) + TICK_DT <= t + 1e-9) {
      const events: BallEvent[] = [];
      j.sim.step(TICK_DT, events);
      if (this.referee.awaitingServe) this.toss.apex = Math.max(this.toss.apex, j.sim.state.pos.y);
      for (const e of events) {
        const out = this.referee.onEvent(e);
        if (out) {
          this.endRally(out);
          return false;
        }
      }
    }
    return true;
  }

  private applyHit(by: Seat, at: number, post: BallState, velIn: { x: number; y: number; z: number }, spinIn: { x: number; y: number; z: number }, paddleVel: { x: number; y: number; z: number }) {
    if (this.phase !== 'rally' || !this.referee || !this.judge) return;
    const side = seatSide(by);
    const now = this.now();
    at = Math.min(now, at);
    if (at < timeOf(this.judge) - 1e-6) return; // arrived after the grace period: too late

    // Judge the flight up to the contact; if the point ended first, the hit doesn't count.
    // (Only then ask whose ball it is: the judge runs GRACE behind, so a serve returned
    // soon after its bounce used to be thrown away as "not the receiver's ball yet".)
    if (!this.judgeTo(at)) return;
    if (this.referee?.expectedHitter !== side) return; // not this side's ball
    const ref = this.referee;
    const j = this.judge!;
    const d = Math.hypot(j.sim.state.pos.x - post.pos.x, j.sim.state.pos.y - post.pos.y, j.sim.state.pos.z - post.pos.z);
    if (d > HIT_TOLERANCE) return; // implausible report

    // Doubles: partners must alternate.
    if (by !== this.next) {
      this.endRally(ref.forfeit(side, 'wrong-order', `${this.info.seats[by]?.name ?? by} hit out of turn`));
      return;
    }

    const e: BallEvent = {
      type: 'paddle',
      time: at - j.t0,
      pos: post.pos,
      paddleId: by,
      face: 'front',
      impactSpeed: 0,
      paddleVel,
      velIn,
      velOut: post.vel,
      spinIn,
      spinOut: post.spin,
    };
    const ctx: Parameters<RallyReferee['onEvent']>[1] = { hitter: side };
    const serve = ref.awaitingServe;
    if (serve) {
      const sign = side === 'near' ? 1 : -1;
      ctx.serve = { tossHeight: this.toss.apex - this.toss.y0, ballVy: velIn.y, localPos: { y: post.pos.y, z: post.pos.z * sign } };
    } else if (ref.ballHeadingTo === side) {
      const { events } = predict({ pos: post.pos, vel: velIn, spin: spinIn }, this.params, { maxTime: 1.5, stop: (x) => x.type === 'table' || x.type === 'floor' });
      const land = events.find((x) => x.type === 'table' || x.type === 'floor');
      ctx.volleyWouldLand = land?.type === 'table' && (land.pos.z >= 0 ? 'near' : 'far') === side;
    }
    const out = ref.onEvent(e, ctx);

    this.hitIndex++;
    this.next = this.order[(this.serverIndex + this.hitIndex) % this.order.length];
    this.judge = { sim: new BallSim(post, this.params), t0: at };
    this.ais[by]?.clearPlan();
    this.broadcast({ t: 'hit', at, by, ball: toWire(post), serve, next: out ? null : this.next, velIn: toV(velIn), spinIn: toV(spinIn), paddleVel: toV(paddleVel) });
    if (out) return this.endRally(out);

    const ai = this.ais[this.next];
    if (ai) ai.planReturn(post, at, { serve });
    this.startAiLive(post, at);
  }

  private endRally(out: RallyOutcome) {
    this.phase = 'point-over';
    this.phaseStart = this.now();
    this.referee = null;
    this.aiLive = null;
    for (const ai of Object.values(this.ais)) ai?.clearPlan();
    if (out.kind === 'let') return this.broadcast({ t: 'let' });
    const { game, match } = this.score!.award(out.result.winner);
    this.broadcast({ t: 'point', result: out.result, score: this.snap(), game, match });
  }

  // ------------------------------------------------------------ clock

  /** Call regularly (~60 Hz). */
  tick() {
    const now = this.now();
    const dt = Math.min(0.1, Math.max(0, now - this.lastTick));
    this.lastTick = now;
    this.assignAiRoles();
    for (const ai of Object.values(this.ais)) ai?.update(dt, now);

    if (now - this.lastPose >= POSE_INTERVAL) {
      this.lastPose = now;
      for (const [seat, ai] of Object.entries(this.ais)) {
        if (!ai) continue;
        const p = ai.worldPose;
        const b = ai.worldBody;
        const pose: WirePose = { p: toV(p.pos), n: toV(p.normal), b: [b.x, b.z], wing: 'forehand' };
        this.broadcast({ t: 'pose', seat: seat as Seat, pose });
      }
    }

    switch (this.phase) {
      case 'serve-wait': {
        const ai = this.next && this.ais[this.next];
        if (ai && now - this.phaseStart >= AI_SERVE_DELAY) {
          const { hand, tossVy } = ai.planServe(now);
          this.applyToss(this.next!, now, hand, tossVy);
        }
        break;
      }
      case 'rally':
        this.stepAiLive(now);
        if (this.phase === 'rally') this.judgeTo(now - GRACE);
        break;
      case 'point-over':
        if (now - this.phaseStart >= POINT_PAUSE) {
          if (this.score!.winner) {
            this.phase = 'over';
            this.info.phase = 'over';
            this.broadcast({ t: 'over', score: this.snap() });
            this.broadcastRoom();
          } else this.beginServe();
        }
        break;
    }
  }

  /** Real-time flight with the AI's paddle, to find the AI's contact as it happens. */
  /**
   * Doubles positioning: the receiver waits for the serve in their right half-court, the
   * player who hits next stays ready, and the others step aside, out of the way.
   */
  private assignAiRoles() {
    if (this.info.mode !== 'doubles' || !this.order.length) return;
    const serving = this.phase === 'serve-wait' || (this.phase === 'rally' && this.hitIndex <= 1);
    const receiver = serving ? this.order[(this.serverIndex + 1) % this.order.length] : null;
    // On deck: the player who hits after the next shot (your partner, once you've hit)
    // gets back into position now rather than when the ball is already coming.
    const onDeck = this.phase === 'rally' ? this.order[(this.serverIndex + this.hitIndex + 1) % this.order.length] : null;
    for (const [seat, ai] of Object.entries(this.ais)) {
      if (!ai) continue;
      ai.receiving = seat === receiver;
      ai.waiting = seat !== this.next && seat !== receiver && seat !== onDeck;
    }
  }

  private stepAiLive(now: number) {
    const live = this.aiLive;
    const seat = this.next;
    const ai = seat && this.ais[seat];
    if (!live || !ai || !this.referee) return;
    const ticks = Math.floor((now - timeOf(live)) / TICK_DT + 1e-9);
    for (let i = 0; i < ticks; i++) {
      const serving = this.referee.awaitingServe;
      // Serve: strike the toss on its way down. Rally: no accidental volleys — only after
      // the ball bounced on the AI's half, or once it is past the end line.
      const localZ = seatSide(seat) === 'near' ? live.sim.state.pos.z : -live.sim.state.pos.z;
      const blocked = serving ? live.sim.state.vel.y >= 0 : !live.bounced && localZ < TABLE.halfLength;
      const colliders = blocked ? undefined : [ai.collider(i, ticks)];
      const events: BallEvent[] = [];
      live.sim.step(TICK_DT, events, colliders);
      if (events.some((e) => e.type === 'table' && e.side === seatSide(seat))) live.bounced = true;
      const hit = events.find((e): e is Extract<BallEvent, { type: 'paddle' }> => e.type === 'paddle');
      if (hit) {
        this.aiLive = null;
        this.applyHit(seat, live.t0 + hit.time, { pos: hit.pos, vel: hit.velOut, spin: hit.spinOut }, hit.velIn, hit.spinIn, hit.paddleVel);
        return;
      }
      if (events.some((e) => e.type === 'floor')) {
        this.aiLive = null;
        return;
      }
    }
  }

  // ------------------------------------------------------------ helpers

  private snap(): ScoreSnap {
    const s = this.score!;
    return {
      points: { ...s.points },
      games: { ...s.games },
      history: s.history.map((h) => ({ ...h })),
      winner: s.winner,
      bestOf: s.config.bestOf,
      deuce: s.deuce,
      gamePoint: s.gamePoint(),
      matchPoint: s.matchPoint(),
    };
  }

  private broadcastRoom() {
    this.broadcast({ t: 'room', room: this.info });
  }

  private broadcast(msg: ServerMsg, except?: string) {
    for (const id of this.clients.keys()) if (id !== except) this.host.send(id, msg);
  }
}

