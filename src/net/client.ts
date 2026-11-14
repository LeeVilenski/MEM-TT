import { BallSim, TABLE, TICK_DT, GRAVITY, v3, type BallEvent, type PaddleCollider, type PhysicsParams, type Vec3 } from '../physics';
import { mapPose, mapState, mapVec, type SideId } from '../game/frame';
import { IncomingPrediction } from '../game/intercept';
import { SERVE_TOSS_AHEAD, type MoveInput, type Player } from '../game/player';
import type { PointResult } from '../game/rules';
import { type SwingInput } from '../game/swing';
import {
  PROTOCOL_VERSION,
  fromV,
  fromWire,
  seatSide,
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
import type { Transport } from './transport';
import type { AiLevel } from '../game/ai';
import { realismSettings } from '../game/realism';
import type { StyleId } from '../game/styles';
import { DEFAULT_PARAMS } from '../physics';

export type OnlinePhase = 'connecting' | 'lobby' | 'serve-wait' | 'rally' | 'point-over' | 'over' | 'closed';

export type OnlineEvent =
  | { type: 'room' }
  | { type: 'match' }
  | { type: 'serve' }
  | { type: 'toss'; by: Seat }
  | { type: 'hit'; by: Seat; serve: boolean; pos: Vec3; velIn: Vec3; spinIn: Vec3; velOut: Vec3; spinOut: Vec3; paddleVel: Vec3 }
  | { type: 'ball'; event: BallEvent }
  | { type: 'point'; result: PointResult; game: boolean; match: boolean }
  | { type: 'let' }
  | { type: 'over' }
  | { type: 'error'; message: string }
  | { type: 'closed'; reason: string };

const PING_INTERVAL = 2;
const POSE_INTERVAL = 0.05;
const MAX_TOSS = 1.2;

/**
 * Game client for online rooms. Engine-agnostic: rendering reads its state.
 *
 * The local player always plays as if at the near end ("view" frame); the client
 * maps to and from world coordinates with the seat's side. Ball flights are kept in
 * world coordinates and simulated locally from each toss/hit the server relays. When
 * it's this player's turn, their paddle is a collider in that local flight, and a
 * contact is reported to the server immediately — no input lag.
 */
export class OnlineClient {
  you = '';
  room: RoomInfo | null = null;
  phase: OnlinePhase = 'connecting';
  mode: GameMode = 'singles';
  names: Partial<Record<Seat, string>> = {};
  score: ScoreSnap | null = null;
  serverSeat: Seat | null = null;
  receiverSeat: Seat | null = null;
  /** The seat that must hit next (null between rallies or after a contact we reported). */
  next: Seat | null = null;
  /** Current ball flight (world frame). */
  flight: { sim: BallSim; t0: number } | null = null;
  /** Latest pose of every other seat (world frame), with local receive time. */
  remotes = new Map<Seat, { pose: WirePose; at: number }>();
  lastResult: PointResult | null = null;
  /** The room's realism (0 simulation … 1 arcade), known once a match starts. */
  realism = 0.55;
  rtt = 0;
  private offset = 0;
  private bestRtt = Infinity;
  private lastPing = -Infinity;
  private lastPose = -Infinity;
  private incoming: IncomingPrediction | null = null;
  private serving = false;
  private bouncedOnMySide = false;
  private listeners: ((e: OnlineEvent) => void)[] = [];

  /**
   * Local game clock: runs at the room's game speed once a match starts (the realism
   * slider slows the game for everyone), so server time estimates stay consistent.
   */
  private speed = 1;
  private clockBase: number;
  private rawBase: number;
  private clock = () => this.clockBase + (this.rawClock() - this.rawBase) * this.speed;

  private setSpeed(k: number) {
    this.clockBase = this.clock();
    this.rawBase = this.rawClock();
    this.speed = k;
    // Re-measure the clock offset at the new rate.
    this.bestRtt = Infinity;
    this.ping();
  }

  constructor(
    private transport: Transport,
    readonly player: Player,
    /** Shared physics parameters; the room's spin-curve setting is applied to them. */
    private params: PhysicsParams,
    private rawClock: () => number,
    hello: { name: string; style?: StyleId; create?: { mode: GameMode; bestOf: number; aiLevel: AiLevel; realism?: number; aiStyles?: Partial<Record<Seat, StyleId>> } },
  ) {
    this.clockBase = this.rawBase = rawClock();
    transport.onOpen = () => {
      this.send({ t: 'hello', v: PROTOCOL_VERSION, name: hello.name, style: hello.style, create: hello.create });
      this.ping();
    };
    transport.onMessage = (m) => this.onMessage(m);
    transport.onClose = (reason) => {
      this.phase = 'closed';
      this.emit({ type: 'closed', reason });
    };
  }

  on(fn: (e: OnlineEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: OnlineEvent) {
    for (const l of this.listeners) l(e);
  }

  private send(m: ClientMsg) {
    this.transport.send(m);
  }

  /** Estimated server clock, seconds. */
  serverNow() {
    return this.clock() + this.offset;
  }

  get seat(): Seat | null {
    if (!this.room) return null;
    for (const [s, info] of Object.entries(this.room.seats)) if (info?.clientId === this.you) return s as Seat;
    return null;
  }

  /** The end this client plays from (spectators watch from the near end). */
  get side(): SideId {
    const s = this.seat;
    return s ? seatSide(s) : 'near';
  }

  get isHost() {
    return !!this.room && this.room.host === this.you;
  }

  /** Whether it's this player's turn to toss. */
  get myServe() {
    return this.phase === 'serve-wait' && !!this.serverSeat && this.serverSeat === this.seat;
  }

  // ------------------------------------------------------------ actions

  sit(seat: Seat | null) {
    this.send({ t: 'sit', seat });
  }

  configure(c: { mode?: GameMode; bestOf?: number; aiLevel?: AiLevel; aiStyle?: StyleId | 'random'; realism?: number }) {
    this.send({ t: 'config', ...c });
  }

  setStyle(style: StyleId) {
    this.send({ t: 'style', style });
  }

  start(fillAI: boolean) {
    this.send({ t: 'start', fillAI });
  }

  leave() {
    this.player.doubles = false;
    this.send({ t: 'leave' });
    this.transport.close();
    this.phase = 'closed';
  }

  /** Toss for a serve. height: metres above the hand. */
  toss(height: number) {
    const seat = this.seat;
    if (!this.myServe || !seat) return;
    const h = Math.max(0.05, Math.min(MAX_TOSS, height));
    const vy = Math.sqrt(2 * GRAVITY * h);
    const handWorld = mapVec(this.side, this.handView());
    const at = this.serverNow();
    this.flight = { sim: new BallSim({ pos: handWorld, vel: v3(0, vy, 0), spin: v3() }, this.params), t0: at };
    this.phase = 'rally';
    this.next = seat;
    this.serving = true;
    this.player.shotMode = 'serve';
    this.send({ t: 'toss', at, hand: toV(handWorld), vy });
    this.emit({ type: 'toss', by: seat });
  }

  /** Where the local player holds the ball to serve (view frame). */
  handView(): Vec3 {
    // Doubles: the toss is from your right half-court (the serve must bounce there first).
    const x = this.mode === 'doubles' ? Math.max(0.18, Math.min(0.6, this.player.swing.pose.pos.x)) : this.player.swing.pose.pos.x;
    return v3(x, TABLE.height + 0.06, this.player.restZ - SERVE_TOSS_AHEAD);
  }

  /** The local player's intercept point and time (view frame), for the marker and bots. */
  interceptPoint(): { pos: Vec3; t: number } | null {
    return this.player.contactFor(this.phase === 'rally' ? this.incoming : null, this.serverNow());
  }

  interceptView(): Vec3 | null {
    return this.interceptPoint()?.pos ?? null;
  }

  /** True between our toss and our serve contact. */
  get awaitingMyServeContact() {
    return this.serving;
  }

  // ------------------------------------------------------------ frame

  frame(realDt: number, input: SwingInput, move: MoveInput) {
    const now = this.serverNow();
    if (this.clock() - this.lastPing > PING_INTERVAL) this.ping();

    // Local player (view frame).
    const p = this.player;
    p.setIntercept(this.interceptPoint(), now);
    if (!this.serving) p.shotMode = 'rally';
    // Doubles serves go to the receiver's right half-court (−x from the server's view).
    const aim = this.serving && this.mode === 'doubles' ? { x: -0.35, z: -0.8 } : { x: 0, z: -0.85 };
    p.serveBall = this.serving && this.flight ? mapState(this.side, this.flight.sim.state) : null;
    p.update(realDt, input, move, aim);

    // Ball flight up to the (estimated) server time.
    const f = this.flight;
    if (f) {
      let ticks = Math.floor((now - (f.t0 + f.sim.time)) / TICK_DT + 1e-9);
      if (ticks > 240 * 2) {
        // Far behind (tab was hidden): skip ahead without colliders.
        while (ticks-- > 2) f.sim.step(TICK_DT);
        ticks = 2;
      }
      for (let i = 0; i < ticks; i++) {
        const events: BallEvent[] = [];
        f.sim.step(TICK_DT, events, this.colliders(i, ticks));
        for (const e of events) {
          if (e.type === 'table' && e.side === this.side) this.bouncedOnMySide = true;
          this.emit({ type: 'ball', event: e });
          if (e.type === 'paddle') this.reportHit(e, f.t0);
        }
      }
    }

    // Share the local paddle with the others.
    if (this.seat && this.clock() - this.lastPose >= POSE_INTERVAL && this.phase !== 'lobby') {
      this.lastPose = this.clock();
      const w = mapPose(this.side, p.swing.pose);
      const b = mapVec(this.side, v3(p.body.x, 0, p.body.z));
      this.send({ t: 'pose', pose: { p: toV(w.pos), n: toV(w.normal), b: [b.x, b.z], wing: p.swing.side } });
    }
  }

  private colliders(index: number, count: number): PaddleCollider[] | undefined {
    const seat = this.seat;
    if (!seat || this.next !== seat || this.phase !== 'rally' || !this.flight) return undefined;
    // The toss can only be struck on its way down.
    if (this.serving && this.flight.sim.state.vel.y >= 0) return undefined;
    // No accidental volleys: the paddle only connects once the ball has bounced on our
    // half, or once it is past our end line (where a volley wins: the ball was going out).
    if (!this.serving && !this.bouncedOnMySide && mapVec(this.side, this.flight.sim.state.pos).z < TABLE.halfLength) return undefined;
    const c = this.player.collider(index, count);
    const side = this.side;
    // The player (and its angle assist) think in the view frame, where they are at the
    // near end; the flight is in world coordinates. Map both ways.
    const adjust = c.adjustNormal;
    return [
      {
        ...c,
        poseAt: (f) => mapPose(side, c.poseAt(f)),
        adjustNormal:
          adjust &&
          ((ball, pose, normal, rubber) => {
            const r = adjust(mapState(side, ball), mapPose(side, pose), mapVec(side, normal), rubber);
            return 'normal' in r ? { normal: mapVec(side, r.normal), vel: r.vel && mapVec(side, r.vel) } : mapVec(side, r);
          }),
      },
    ];
  }

  private reportHit(e: Extract<BallEvent, { type: 'paddle' }>, t0: number) {
    const seat = this.seat!;
    const at = t0 + e.time;
    const ball = { pos: e.pos, vel: e.velOut, spin: e.spinOut };
    this.send({ t: 'hit', at, ball: toWire(ball), velIn: toV(e.velIn), spinIn: toV(e.spinIn), paddleVel: toV(e.paddleVel) });
    this.emit({ type: 'hit', by: seat, serve: this.serving, pos: e.pos, velIn: e.velIn, spinIn: e.spinIn, velOut: e.velOut, spinOut: e.spinOut, paddleVel: e.paddleVel });
    // Until the server relays the hit, nobody on this client is expected to hit.
    this.next = null;
    this.serving = false;
    this.incoming = null;
    this.player.shotMode = 'rally';
  }

  // ------------------------------------------------------------ messages

  private ping() {
    this.lastPing = this.clock();
    this.send({ t: 'ping', c: this.clock() });
  }

  private onMessage(m: ServerMsg) {
    switch (m.t) {
      case 'welcome':
        this.you = m.you;
        this.room = m.room;
        this.phase = m.room.phase === 'lobby' ? 'lobby' : this.phase;
        if (this.bestRtt === Infinity) this.offset = m.now - this.clock();
        this.emit({ type: 'room' });
        break;
      case 'room':
        this.room = m.room;
        if (m.room.phase === 'lobby') this.phase = 'lobby';
        this.emit({ type: 'room' });
        break;
      case 'pong': {
        const rtt = this.clock() - m.c;
        this.rtt = rtt;
        // Prefer the lowest-latency samples: their midpoint is the most accurate.
        if (rtt <= this.bestRtt * 1.25) {
          this.bestRtt = Math.min(this.bestRtt, rtt);
          this.offset = m.s + rtt / 2 - this.clock();
        }
        break;
      }
      case 'error':
        this.emit({ type: 'error', message: m.message });
        break;
      case 'match': {
        // Room-wide realism: game speed and spin curve must match the server; the
        // player's own assists follow it too.
        const r = realismSettings(m.realism);
        this.realism = m.realism;
        this.params.liftCoefficientMax = DEFAULT_PARAMS.liftCoefficientMax * r.spinCurve;
        this.params.tableBounceKeep = r.bounceKeep;
        this.player.applyRealism(m.realism);
        if (this.speed !== r.gameSpeed) this.setSpeed(r.gameSpeed);
        this.mode = m.mode;
        this.player.doubles = m.mode === 'doubles';
        this.names = m.names;
        this.score = m.score;
        this.phase = 'serve-wait';
        this.emit({ type: 'match' });
        break;
      }
      case 'serve':
        this.serverSeat = m.server;
        this.receiverSeat = m.receiver;
        this.next = m.server;
        this.score = m.score;
        this.flight = null;
        this.incoming = null;
        this.serving = false;
        this.phase = 'serve-wait';
        this.emit({ type: 'serve' });
        break;
      case 'toss':
        if (m.by === this.seat) break; // we started this flight ourselves
        this.flight = { sim: new BallSim({ pos: fromV(m.hand), vel: v3(0, m.vy, 0), spin: v3() }, this.params), t0: m.at };
        this.next = m.next;
        this.phase = 'rally';
        this.emit({ type: 'toss', by: m.by });
        break;
      case 'hit': {
        this.next = m.next;
        if (m.by === this.seat) break; // our own contact, already simulated
        const state = fromWire(m.ball);
        this.flight = { sim: new BallSim(state, this.params), t0: m.at };
        this.bouncedOnMySide = false;
        this.incoming = m.next && m.next === this.seat ? new IncomingPrediction(mapState(this.side, state), this.params, m.at) : null;
        this.emit({ type: 'hit', by: m.by, serve: m.serve, pos: state.pos, velIn: fromV(m.velIn), spinIn: fromV(m.spinIn), velOut: state.vel, spinOut: state.spin, paddleVel: fromV(m.paddleVel) });
        break;
      }
      case 'point':
        this.score = m.score;
        this.lastResult = m.result;
        this.phase = 'point-over';
        this.next = null;
        this.incoming = null;
        this.serving = false;
        this.emit({ type: 'point', result: m.result, game: m.game, match: m.match });
        break;
      case 'let':
        this.phase = 'point-over';
        this.next = null;
        this.incoming = null;
        this.serving = false;
        this.emit({ type: 'let' });
        break;
      case 'over':
        this.score = m.score;
        this.phase = 'over';
        this.emit({ type: 'over' });
        break;
      case 'pose':
        this.remotes.set(m.seat, { pose: m.pose, at: this.clock() });
        break;
    }
  }
}
