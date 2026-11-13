import type { BallState, Vec3 } from '../physics';
import type { AiLevel } from '../game/ai';
import type { SideId } from '../game/frame';
import type { PointResult } from '../game/rules';
import type { StrokeSide } from '../game/swing';

/**
 * Wire protocol between game clients and the room server (JSON over WebSocket).
 * Shared by the browser client, the Node adapter and the Cloudflare adapter.
 *
 * Model: ball flight between contacts is deterministic, so only tosses and hits are
 * sent. The player whose turn it is simulates their own contact locally (no input
 * lag) and reports it; the server re-simulates every flight and referees the rally.
 * All coordinates on the wire are world coordinates; times are server clock seconds.
 */
export const PROTOCOL_VERSION = 1;

export type Seat = 'near1' | 'near2' | 'far1' | 'far2';
export const SEATS: Seat[] = ['near1', 'far1', 'near2', 'far2'];
export const seatSide = (s: Seat): SideId => (s.startsWith('near') ? 'near' : 'far');
export const partnerOf = (s: Seat): Seat => (s.endsWith('1') ? (s.replace('1', '2') as Seat) : (s.replace('2', '1') as Seat));

export type GameMode = 'singles' | 'doubles';
export const seatsFor = (mode: GameMode): Seat[] => (mode === 'singles' ? ['near1', 'far1'] : ['near1', 'near2', 'far1', 'far2']);

/** Compact vector on the wire. */
export type V = [number, number, number];
export const toV = (v: Vec3): V => [round(v.x), round(v.y), round(v.z)];
export const fromV = (v: V): Vec3 => ({ x: v[0], y: v[1], z: v[2] });
const round = (n: number) => Math.round(n * 1e6) / 1e6;

export interface WireBall {
  p: V;
  v: V;
  w: V;
}
export const toWire = (s: BallState): WireBall => ({ p: toV(s.pos), v: toV(s.vel), w: toV(s.spin) });
export const fromWire = (w: WireBall): BallState => ({ pos: fromV(w.p), vel: fromV(w.v), spin: fromV(w.w) });

export interface WirePose {
  p: V;
  n: V;
  /** Body position on the floor (x, z). */
  b: [number, number];
  wing: StrokeSide;
}

export interface SeatInfo {
  name: string;
  /** Connected client in this seat, if human. */
  clientId?: string;
  /** AI level if the seat is filled by the AI. */
  ai?: AiLevel;
}

export interface RoomInfo {
  code: string;
  mode: GameMode;
  bestOf: number;
  aiLevel: AiLevel;
  host: string;
  seats: Partial<Record<Seat, SeatInfo>>;
  /** Connected clients not (yet) in a seat. */
  spectators: { id: string; name: string }[];
  phase: 'lobby' | 'playing' | 'over';
}

export interface ScoreSnap {
  points: Record<SideId, number>;
  games: Record<SideId, number>;
  history: Record<SideId, number>[];
  winner: SideId | null;
  bestOf: number;
  deuce: boolean;
  gamePoint: SideId | null;
  matchPoint: SideId | null;
}

// ---------------------------------------------------------------- client → server

export type ClientMsg =
  | { t: 'hello'; v: number; name: string; create?: { mode: GameMode; bestOf: number; aiLevel: AiLevel } }
  | { t: 'ping'; c: number }
  | { t: 'sit'; seat: Seat | null }
  | { t: 'config'; mode?: GameMode; bestOf?: number; aiLevel?: AiLevel }
  | { t: 'start'; fillAI: boolean }
  | { t: 'toss'; at: number; hand: V; vy: number }
  | { t: 'hit'; at: number; ball: WireBall; velIn: V; spinIn: V; paddleVel: V }
  | { t: 'pose'; pose: WirePose }
  | { t: 'leave' };

// ---------------------------------------------------------------- server → client

export type ServerMsg =
  | { t: 'welcome'; you: string; room: RoomInfo; now: number }
  | { t: 'room'; room: RoomInfo }
  | { t: 'pong'; c: number; s: number }
  | { t: 'error'; message: string }
  | { t: 'match'; mode: GameMode; names: Partial<Record<Seat, string>>; score: ScoreSnap }
  /** Waiting for `server` to toss. */
  | { t: 'serve'; server: Seat; receiver: Seat; score: ScoreSnap }
  | { t: 'toss'; at: number; by: Seat; hand: V; vy: number; next: Seat }
  | { t: 'hit'; at: number; by: Seat; ball: WireBall; serve: boolean; next: Seat | null; velIn: V; spinIn: V; paddleVel: V }
  | { t: 'point'; result: PointResult; score: ScoreSnap; game: boolean; match: boolean }
  | { t: 'let' }
  | { t: 'pose'; seat: Seat; pose: WirePose }
  | { t: 'over'; score: ScoreSnap };

export function parseMsg<T>(data: unknown): T | null {
  try {
    const text = typeof data === 'string' ? data : new TextDecoder().decode(data as ArrayBuffer);
    const m = JSON.parse(text);
    return m && typeof m.t === 'string' ? (m as T) : null;
  } catch {
    return null;
  }
}

/** Room codes: 5 letters, no easily-confused characters. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
export function randomRoomCode(rng: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 5; i++) s += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  return s;
}
export const isRoomCode = (s: string) => /^[A-Z]{5}$/.test(s);
