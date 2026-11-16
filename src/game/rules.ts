import { TABLE, type BallEvent } from '../physics';
import { other, sideOfZ, type SideId } from './frame';

/**
 * Table tennis rules: the rally referee and the scoring/serve rotation.
 * Pure logic driven by physics events, so it is identical for local play,
 * AI-vs-AI tests and (later) the authoritative online server.
 */

export type PointReason =
  | 'illegal-serve'
  | 'serve-missed'
  | 'serve-wrong-bounce'
  | 'serve-net'
  | 'net'
  | 'out'
  | 'own-side'
  | 'double-bounce'
  | 'missed'
  | 'double-hit'
  | 'obstruction'
  | 'volley-out'
  | 'wrong-order'
  | 'serve-diagonal';

export interface PointResult {
  winner: SideId;
  loser: SideId;
  reason: PointReason;
  /** Extra detail for the player, e.g. which serve rule was broken. */
  detail?: string;
  /** True if the point ended on a serve that the receiver never touched. */
  ace?: boolean;
}

export type RallyOutcome = { kind: 'point'; result: PointResult } | { kind: 'let' };

/** Information about a serve contact, for the legality check. */
export interface ServeContact {
  /** Toss height above the hand, metres. */
  tossHeight: number;
  /** Ball vertical velocity at contact (must be falling). */
  ballVy: number;
  /** Contact point in the server's local frame (server end is +z). */
  localPos: { y: number; z: number };
}

/** ITTF: toss at least 16 cm, struck while falling, behind the end line, above the playing surface. */
export function checkServe(c: ServeContact): string | null {
  if (c.tossHeight < 0.16) return `Toss only ${Math.round(c.tossHeight * 100)} cm — at least 16 cm required`;
  if (c.ballVy > 0.05) return 'Ball struck while still rising';
  if (c.localPos.z < TABLE.halfLength) return 'Ball struck in front of the end line';
  if (c.localPos.y < TABLE.height) return 'Ball struck below the playing surface';
  return null;
}

type RallyState =
  | { kind: 'serve-toss' } // server has tossed, waiting for the serve contact
  | { kind: 'serve-own-bounce' } // served, must bounce on the server's half first
  | { kind: 'serve-opp-bounce' } // bounced on server's half, must bounce on receiver's half
  | { kind: 'await-bounce'; hitter: SideId } // returned, must land on the other half
  | { kind: 'await-hit'; hitter: SideId; bounced: boolean } // `hitter` must hit next
  | { kind: 'over' };

export class RallyReferee {
  private state: RallyState = { kind: 'serve-toss' };
  private serveNet = false;
  private receiverTouched = false;
  /** Number of paddle contacts in the rally (serve included). */
  hits = 0;

  /**
   * @param doubles in doubles the serve must go diagonally: it bounces in the server's
   * right half-court, then the receiver's right half-court (the centre line counts for both).
   */
  constructor(
    readonly server: SideId,
    readonly doubles = false,
  ) {}

  /** Independent copy (the online server judges on a copy while late hits may still arrive). */
  clone(): RallyReferee {
    const r = new RallyReferee(this.server, this.doubles);
    r.state = { ...this.state } as RallyState;
    r.serveNet = this.serveNet;
    r.receiverTouched = this.receiverTouched;
    r.hits = this.hits;
    return r;
  }

  /** True while the serve has been tossed but not yet struck. */
  get awaitingServe() {
    return this.state.kind === 'serve-toss';
  }

  /** Doubles diagonal check, in the server's frame: right half is +x for the server, −x for the receiver. */
  private inRightHalf(x: number, of: SideId) {
    const local = this.server === 'near' ? x : -x;
    const CENTRE_LINE = 0.0015;
    return of === this.server ? local >= -CENTRE_LINE : local <= CENTRE_LINE;
  }

  get receiver(): SideId {
    return other(this.server);
  }

  get over() {
    return this.state.kind === 'over';
  }

  /** Which side is allowed to hit next (for enabling paddle colliders), or null. */
  get expectedHitter(): SideId | null {
    switch (this.state.kind) {
      case 'serve-toss':
        return this.server;
      case 'serve-opp-bounce':
      case 'serve-own-bounce':
        return null;
      case 'await-bounce':
        return other(this.state.hitter); // a volley is possible (and judged)
      case 'await-hit':
        return this.state.hitter;
      default:
        return null;
    }
  }

  /** Which side the ball is travelling toward / must be played by — for AI planning. */
  get ballHeadingTo(): SideId | null {
    switch (this.state.kind) {
      case 'serve-own-bounce':
      case 'serve-opp-bounce':
        return this.receiver;
      case 'await-bounce':
        return other(this.state.hitter);
      case 'await-hit':
        return this.state.hitter;
      default:
        return null;
    }
  }

  /** End the rally from outside (e.g. a doubles partner hitting out of turn). */
  forfeit(loser: SideId, reason: PointReason, detail?: string): RallyOutcome {
    return this.end(other(loser), reason, detail);
  }

  private end(winner: SideId, reason: PointReason, detail?: string): RallyOutcome {
    this.state = { kind: 'over' };
    const ace = winner === this.server && !this.receiverTouched && reason !== 'illegal-serve';
    return { kind: 'point', result: { winner, loser: other(winner), reason, detail, ace } };
  }

  /**
   * Feed one physics event. For paddle events pass the hitting side, plus — when the
   * hit was a volley — whether the ball would have landed on the hitter's half, and
   * for serves the contact info for the legality check.
   */
  onEvent(e: BallEvent, ctx: { hitter?: SideId; volleyWouldLand?: boolean; serve?: ServeContact } = {}): RallyOutcome | null {
    const s = this.state;
    if (s.kind === 'over') return null;

    if (e.type === 'paddle') {
      const by = ctx.hitter!;
      this.hits++;
      if (by === this.receiver) this.receiverTouched = true;
      switch (s.kind) {
        case 'serve-toss': {
          if (by !== this.server) return this.end(this.server, 'obstruction');
          const fault = ctx.serve ? checkServe(ctx.serve) : null;
          if (fault) return this.end(this.receiver, 'illegal-serve', fault);
          this.state = { kind: 'serve-own-bounce' };
          return null;
        }
        case 'serve-own-bounce':
        case 'serve-opp-bounce':
          // Receiver volleys the serve (or server hits twice).
          if (by === this.server) return this.end(this.receiver, 'double-hit');
          return ctx.volleyWouldLand ? this.end(this.server, 'obstruction') : this.end(this.receiver, 'volley-out');
        case 'await-bounce':
          if (by === s.hitter) return this.end(other(by), 'double-hit');
          // Volley: if the ball was going to land on the volleyer's half it's obstruction,
          // otherwise the ball was going out and the volleyer wins the point.
          return ctx.volleyWouldLand ? this.end(s.hitter, 'obstruction') : this.end(by, 'volley-out');
        case 'await-hit':
          if (by !== s.hitter) return this.end(s.hitter, 'double-hit');
          this.state = { kind: 'await-bounce', hitter: by };
          return null;
      }
    }

    if (e.type === 'net') {
      if (s.kind === 'serve-own-bounce' || s.kind === 'serve-opp-bounce') this.serveNet = true;
      return null;
    }

    if (e.type === 'table') {
      const side = sideOfZ(e.pos.z);
      switch (s.kind) {
        case 'serve-toss':
          return this.end(this.receiver, 'serve-missed', 'The toss landed on the table');
        case 'serve-own-bounce':
          if (side !== this.server) return this.end(this.receiver, 'serve-wrong-bounce', 'A serve must bounce on your own half first');
          if (this.doubles && !this.inRightHalf(e.pos.x, this.server)) return this.end(this.receiver, 'serve-diagonal', 'Doubles serves start from your right half-court');
          this.state = { kind: 'serve-opp-bounce' };
          return null;
        case 'serve-opp-bounce':
          if (side === this.server) return this.end(this.receiver, 'serve-wrong-bounce', 'Bounced twice on the server’s half');
          if (this.doubles && !this.inRightHalf(e.pos.x, this.receiver)) return this.end(this.receiver, 'serve-diagonal', 'Doubles serves must land in the receiver’s right half-court');
          if (this.serveNet) {
            this.state = { kind: 'over' };
            return { kind: 'let' };
          }
          this.state = { kind: 'await-hit', hitter: this.receiver, bounced: true };
          return null;
        case 'await-bounce':
          if (side === s.hitter) return this.end(other(s.hitter), 'own-side');
          this.state = { kind: 'await-hit', hitter: side, bounced: true };
          return null;
        case 'await-hit':
          // Any further bounce before the hit: the player failed to return it.
          return this.end(other(s.hitter), 'double-bounce');
      }
    }

    if (e.type === 'floor') {
      switch (s.kind) {
        case 'serve-toss':
          return this.end(this.receiver, 'serve-missed', 'Missed the toss');
        case 'serve-own-bounce':
          return this.end(this.receiver, this.serveNet ? 'serve-net' : 'serve-wrong-bounce', 'A serve must bounce on your own half first');
        case 'serve-opp-bounce':
          return this.end(this.receiver, this.serveNet ? 'serve-net' : 'out');
        case 'await-bounce': {
          // Didn't reach the other half: into the net or long/wide.
          const crossed = e.pos.z !== 0 && sideOfZ(e.pos.z) !== s.hitter;
          return this.end(other(s.hitter), crossed ? 'out' : 'net');
        }
        case 'await-hit':
          return this.end(other(s.hitter), 'missed');
      }
    }
    return null;
  }
}

// ---------------------------------------------------------------- scoring

export interface MatchConfig {
  /** Best of N games (odd). */
  bestOf: number;
  pointsToWin: number;
  /** Who serves first in game 1. */
  firstServer: SideId;
}

export const DEFAULT_MATCH: MatchConfig = { bestOf: 3, pointsToWin: 11, firstServer: 'near' };

export class Scoreboard {
  points: Record<SideId, number> = { near: 0, far: 0 };
  games: Record<SideId, number> = { near: 0, far: 0 };
  /** Completed game scores, for the summary. */
  history: Record<SideId, number>[] = [];
  winner: SideId | null = null;

  constructor(readonly config: MatchConfig = DEFAULT_MATCH) {}

  get gameNumber() {
    return this.games.near + this.games.far + 1;
  }

  /** Who serves first in the current game: alternates each game. */
  get gameFirstServer(): SideId {
    return this.gameNumber % 2 === 1 ? this.config.firstServer : other(this.config.firstServer);
  }

  /**
   * How many times the serve has changed hands this game: every 2 points, and every
   * point from deuce (both at pointsToWin − 1). Doubles rotation uses this directly.
   */
  get rotation(): number {
    const { near, far } = this.points;
    const total = near + far;
    const d = this.config.pointsToWin - 1;
    return near >= d && far >= d ? d + (total - 2 * d) : Math.floor(total / 2);
  }

  get server(): SideId {
    return this.rotation % 2 === 0 ? this.gameFirstServer : other(this.gameFirstServer);
  }

  get deuce() {
    const d = this.config.pointsToWin - 1;
    return this.points.near >= d && this.points.far >= d && this.points.near === this.points.far;
  }

  /** The side that would win the game (or match) with the next point, if any. */
  gamePoint(): SideId | null {
    for (const s of ['near', 'far'] as const) {
      const me = this.points[s] + 1;
      if (me >= this.config.pointsToWin && me - this.points[other(s)] >= 2) return s;
    }
    return null;
  }

  matchPoint(): SideId | null {
    const gp = this.gamePoint();
    return gp && this.games[gp] + 1 === Math.ceil(this.config.bestOf / 2) ? gp : null;
  }

  /** Record a point. Returns what it completed. */
  award(side: SideId): { game: boolean; match: boolean } {
    if (this.winner) return { game: false, match: false };
    this.points[side]++;
    const me = this.points[side];
    const them = this.points[other(side)];
    if (me >= this.config.pointsToWin && me - them >= 2) {
      this.history.push({ ...this.points });
      this.games[side]++;
      this.points = { near: 0, far: 0 };
      if (this.games[side] === Math.ceil(this.config.bestOf / 2)) {
        this.winner = side;
        return { game: true, match: true };
      }
      return { game: true, match: false };
    }
    return { game: false, match: false };
  }
}

/**
 * Have the players swapped ends from where they started? They change ends after
 * every game, and in the deciding game once either side reaches half the target
 * (5 in an 11-point game), as in the ITTF rules.
 */
export function endsSwapped(points: Record<SideId, number>, games: Record<SideId, number>, bestOf: number, pointsToWin = 11): boolean {
  const played = games.near + games.far;
  let swapped = played % 2 === 1;
  const deciding = played === bestOf - 1;
  if (deciding && Math.max(points.near, points.far) >= Math.ceil(pointsToWin / 2) - 1) swapped = !swapped;
  return swapped;
}
