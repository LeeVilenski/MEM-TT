import { TABLE, add, cloneState, dot, scale, describeSpin, length, normalize, paddleImpulse, predict, radToRpm, spinComponents, v3, type BallState, type ContactAdjust, type PaddlePose, type PhysicsParams, type Rubber, type Vec3 } from '../physics';
import { isDiagonal, landingOutcome, pitchRotator } from './assist';
import { faceNormal } from './swing';

/**
 * Serve types. The type sets the face and the brush direction (Free: your own swing does);
 * the swipe sets the rest:
 *  - its speed, how much spin;
 *  - its sideways angle, the line (left, middle, right);
 *  - how high you meet the dropping ball, the length (low = short, high = long).
 * The landing assist then looks for a version that lands near that aim *without* taking
 * the spin out, and the server's execution can still let it down: the more demanding the
 * serve (short, heavy spin) and the less assist, the likelier a serve into the net or long.
 */
export type ServeType = 'auto' | 'backspin' | 'sidespin' | 'topspin' | 'fast' | 'float';

export interface ServeInfo {
  id: ServeType;
  name: string;
  /** What to do, for mouse / touch. */
  mouse: string;
  touch: string;
}

export const SERVE_TYPES: ServeInfo[] = [
  { id: 'auto', name: 'Free', mouse: 'Your swing decides the serve', touch: 'Your swipe decides the serve' },
  { id: 'backspin', name: 'Backspin', mouse: 'Flick down: faster = more backspin', touch: 'Swipe down: faster = more backspin' },
  { id: 'sidespin', name: 'Sidespin', mouse: 'Flick sideways: left or right sets the curve; steeper comes in to the middle', touch: 'Swipe sideways: left or right sets the curve; steeper comes in to the middle' },
  { id: 'topspin', name: 'Topspin', mouse: 'Flick up: a fast, long, kicking serve', touch: 'Swipe up: a fast, long, kicking serve' },
  { id: 'fast', name: 'Fast long', mouse: 'Any flick: flat and fast to the end line', touch: 'Any swipe: flat and fast to the end line' },
  { id: 'float', name: 'No-spin', mouse: 'Any flick: looks like backspin, has none', touch: 'Any swipe: looks like backspin, has none' },
];

interface Recipe {
  /** Brush direction (paddle velocity) for side sign s (−1 left … 1 right) in the server's frame (facing −z). */
  dir: (s: number) => Vec3;
  /** Brush speed (m/s) at intensity 0 and 1. */
  speed: [number, number];
  /** Face pitch range (degrees, + = open). */
  pitch: [number, number];
  /** Prefer more spin (true) or less (the no-spin serve). */
  spin: boolean;
}

const RECIPES: Record<Exclude<ServeType, 'auto'>, Recipe> = {
  backspin: { dir: (s) => v3(s * 0.45, -1, -0.8), speed: [4, 14], pitch: [15, 50], spin: true },
  sidespin: { dir: (s) => v3((s || 1) * 1, -0.75, -0.55), speed: [4, 10], pitch: [-10, 25], spin: true },
  topspin: { dir: (s) => v3(s * 0.4, 0.35, -1), speed: [4, 10], pitch: [-55, -20], spin: true },
  fast: { dir: (s) => v3(s * 0.15, 0.05, -1), speed: [5, 10], pitch: [-25, 5], spin: false },
  float: { dir: () => v3(0, -0.3, -1), speed: [2.5, 5], pitch: [-10, 30], spin: false },
};

/**
 * Toss height (m above the hand) for how far the toss meter was filled (0–1). A quick tap
 * is under the 16 cm minimum, an illegal toss; a high toss gives more spin but a tighter
 * timing window as it drops.
 */
export function tossHeightFor(fraction: number): number {
  return 0.06 + 1.04 * Math.max(0, Math.min(1, fraction));
}
/** Meter fill below which the toss is illegal (under 16 cm). */
export const TOSS_ILLEGAL_FRACTION = (0.16 - 0.06) / 1.04;

/**
 * How a toss's height changes serving: timing windows are tighter on a high toss (it's
 * falling faster), and a high toss lets a serve carry a little more pace and spin.
 */
export function tossEffect(height: number): { window: number; power: number } {
  return { window: Math.max(0.7, Math.min(1.1, 1.2 - 0.5 * height)), power: 1 + 0.12 * Math.max(0, Math.min(1, (height - 0.3) / 0.7)) };
}

/** Search time for a serve, ms: the best that lands by then is used… */
const SEARCH_BUDGET_MS = 5;
/** …and the search gives up after this (the normal landing assist takes over). */
const SEARCH_LIMIT_MS = 14;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where a serve is aimed. The swipe places it:
 *  - line: the swipe's sideways angle, as for rally strokes (down-right on a backspin serve
 *    goes to the right; a sidespin's sideways swipe also sets which way it curves, so a
 *    steeper swipe brings it in toward the middle);
 *  - depth: how high you meet the dropping ball. Low, near the table, is short; high is
 *    long. Each type starts from its own length (backspin short, fast long).
 */
export interface ServeAim {
  /** −1 (left, as the server sees it) … 1 (right). */
  line: number;
  /** 0 = just over the net … 1 = to the end line. */
  depth: number;
  /** The target on the receiver's half (hitter's frame: server at +z, receiver at −z). */
  x: number;
  z: number;
}

/** Each type's own length, 0 (short) … 1 (long), for a contact at MID_CONTACT. */
const TYPE_DEPTH: Record<ServeType, number> = { auto: 0.45, backspin: 0.2, sidespin: 0.25, float: 0.2, topspin: 0.8, fast: 0.9 };
/** Contact height above the table (m) that plays a type at its own length. */
export const MID_CONTACT = 0.24;
/** How far contact height moves the depth: ±DEPTH_SWING for ±DEPTH_RANGE metres. */
const DEPTH_RANGE = 0.14;
const DEPTH_SWING = 0.4;

/** The target point for a line and depth (doubles: the receiver's right half only). */
export function aimPoint(line: number, depth: number, diagonal = false): { x: number; z: number } {
  const hw = TABLE.halfWidth - 0.14;
  const x = diagonal ? -0.12 - ((1 - line) / 2) * (hw - 0.12) : line * hw;
  return { x, z: -(0.3 + depth * (TABLE.halfLength - 0.55)) };
}

/** The serve's aim from the swing (`vel`: the bat's velocity, +y up) and the contact height above the table. */
export function serveAim(type: ServeType, vel: Vec3, contactHeight: number, diagonal = false): ServeAim {
  // Sidespin is swiped sideways: only a clearly steeper swipe pulls it in from the wide line.
  const full = type === 'sidespin' ? 2.2 : 0.85;
  const line = clamp(vel.x / Math.max(Math.abs(vel.y), 0.7) / full, -1, 1);
  // A free serve's own length follows the swing: chopped down plays short, swung up long.
  const own = type === 'auto' ? TYPE_DEPTH.auto + 0.25 * clamp(vel.y / Math.max(Math.abs(vel.x) + Math.abs(vel.y), 0.7), -1, 1) : TYPE_DEPTH[type];
  const depth = clamp(own + clamp((contactHeight - MID_CONTACT) / DEPTH_RANGE, -1, 1) * DEPTH_SWING, 0, 1);
  return { line, depth, ...aimPoint(line, depth, diagonal) };
}

/** How demanding a serve is (0.25 plain … about 1.1 very short, heavy spin), which sets its risk. */
export function serveDemand(intensity: number, depth: number): number {
  const short = clamp((0.4 - depth) / 0.4, 0, 1);
  const deep = clamp((depth - 0.85) / 0.15, 0, 1);
  return 0.25 + 0.45 * clamp(intensity, 0, 1) + 0.35 * short + 0.15 * deep;
}

/**
 * How far the face can tilt one way (degrees; +1 = open, −1 = closed) before the serve
 * faults: open, it goes long or high; closed, into the net. Null if it still lands at
 * EDGE_SEARCH degrees (or doesn't land as it is).
 */
export function serveEdge(ball: BallState, pose: PaddlePose, adj: ContactAdjust, rubber: Rubber, params: PhysicsParams, sign: 1 | -1, diagonal = false): number | null {
  const at = pitchRotator(adj.normal);
  if (!at) return null;
  const vel = adj.vel ?? pose.vel;
  // 'miss': the face is turned so far the bat doesn't drive into the ball (no hit at all,
  // so not a fault either): the edge isn't this way.
  const lands = (deg: number, fine = false): 'in' | 'fault' | 'miss' => {
    const n = at(sign * deg);
    if (paddleImpulse(cloneState(ball), { ...pose, normal: n, vel }, rubber) <= 0) return 'miss';
    const out = landingOutcome(ball, { ...pose, vel }, n, rubber, params, 'serve', fine ? undefined : 1 / 60);
    return out.outcome === 'in' && (!diagonal || isDiagonal(out.first, out.pos)) ? 'in' : 'fault';
  };
  if (lands(0) !== 'in') return null;
  let last = 0;
  for (const d of [1.5, 3, 5, 8, 12, 18, 26, EDGE_SEARCH]) {
    const r = lands(d);
    if (r === 'miss') return null;
    if (r === 'fault') {
      // Narrow it down between the last angle that landed and this one, at the live ball's
      // resolution (a net clip can differ between coarse and fine steps).
      let lo = last;
      let hi = d;
      if (lands(hi, true) === 'in') {
        // Coarse steps called it a fault, fine ones don't: carry on past it.
        last = d;
        continue;
      }
      for (let i = 0; i < 3; i++) {
        const m = (lo + hi) / 2;
        const rm = lands(m, true);
        if (rm === 'in') lo = m;
        else if (rm === 'fault') hi = m;
        else return null;
      }
      return hi;
    }
    last = d;
  }
  return null;
}
const EDGE_SEARCH = 36;

/**
 * Execution risk on a serve: the spread of the server's "slip" (standard deviation, in
 * units of the serve's own margin), so it reads the same for every type. A slip past 1
 * is a fault: the face ends up past the edge of what lands, into the net or long. Inside
 * that, it just scatters the serve a little. About 1 in 15 plain serves miss on the
 * default setting and 1 in 4 very short, heavy-spin ones; much less on arcade, more
 * toward simulation; a high toss adds to it.
 */
export function serveRisk(demand: number, arcade: number, tossHeight: number): number {
  const a = clamp(arcade, 0, 1);
  const help = a <= 0.85 ? 1.25 - 0.5 * a : 0.825 - 2 * (a - 0.85);
  const toss = 1 + 0.35 * clamp((tossHeight - 0.5) / 0.6, 0, 1);
  return help * 1.35 * demand * toss;
}

/** A serve's contact, with what it was aimed at and how demanding it is. */
export interface ServePlan {
  /** null: no serve found that lands (the normal landing assist takes over, from `base`). */
  adj: ContactAdjust | null;
  /** The type's own stroke aimed at the line, unadjusted: where the normal landing assist starts if nothing was found. */
  base: ContactAdjust;
  aim: ServeAim;
  /** 0–1: how hard it was swiped (spin). */
  intensity: number;
  demand: number;
}

/**
 * Plan a serve. `pose.vel` is the player's swing: its speed sets the intensity (spin), its
 * sideways angle the line; the contact height sets the depth (serveAim). The type's recipe
 * sets the brush and the face ('auto': the swing itself does). `strength` is the landing
 * assist: how far it may move the face, the bat speed and the stroke's direction to land the
 * serve near the aim (0 = the recipe as it is, even if it faults). Returns null with no
 * swing (the ball just dropped onto a still bat).
 */
export function planServe(
  type: ServeType,
  ball: BallState,
  pose: PaddlePose,
  rubber: Rubber,
  params: PhysicsParams,
  strength: number,
  opts: {
    diagonal?: boolean;
    contactHeight?: number;
    flipped?: boolean;
  } = {},
): ServePlan | null {
  const { diagonal = false, contactHeight = ball.pos.y - TABLE.height, flipped = false } = opts;
  const sp = length(pose.vel);
  if (sp < 1) return null;
  const aim = serveAim(type, pose.vel, contactHeight, diagonal);
  const auto = type === 'auto';
  const intensity = clamp((sp - 2) / 10, 0, 1);
  const demand = serveDemand(intensity, aim.depth);
  const plan = (adj: ContactAdjust | null): ServePlan => ({ adj, base: make(mid, 1, aimTurn), aim, intensity, demand });

  // Free serve: the recipe is the swing's own brush (down, up, across) and the player's face
  // (± the assist), at a serve's pace: the mouse swing's forward drive is far more than a
  // serve's, so it is brought down to the backspin serve's (forward 0.8 × the brush).
  const playerPitch = (Math.asin(clamp(pose.normal.y, -1, 1)) * 180) / Math.PI;
  const swipe = Math.hypot(pose.vel.x, pose.vel.y);
  const own = swipe > 0.3 ? v3(pose.vel.x, pose.vel.y, -0.8 * swipe) : pose.vel;
  const r: Recipe = auto ? { dir: () => own, speed: [4, 12], pitch: [playerPitch - 30, playerPitch + 30], spin: true } : RECIPES[type];
  // Side from the swipe itself: sideways compared with up/down (not the forward drive).
  let side = Math.abs(pose.vel.x) > 0.5 * Math.abs(pose.vel.y) && Math.abs(pose.vel.x) > 0.5 ? Math.sign(pose.vel.x) : 0;
  // A straight swipe on a sidespin serve brushes toward the middle of the table.
  if (type === 'sidespin' && side === 0) side = ball.pos.x > 0 ? -1 : 1;
  const dir = normalize(r.dir(side));
  const brush = r.speed[0] + (r.speed[1] - r.speed[0]) * intensity;
  const mid = (r.pitch[0] + r.pitch[1]) / 2;
  // Face and stroke point at the target ('auto': the face does; the stroke is the player's own).
  const aimYaw = (Math.atan2(aim.x - ball.pos.x, -(aim.z - ball.pos.z)) * 180) / Math.PI;

  // A candidate serve: the face at `pitch`, the stroke turned by `turn` (degrees about the
  // vertical) and `f` × the pace into the face. Only the pace changes, not the brush across
  // the face, so the swipe's spin stays: pace is what sets the length.
  const make = (pitch: number, f: number, turn = 0): ContactAdjust => {
    const a = (((auto ? 0 : aimYaw) + turn) * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const vx = dir.x * brush;
    const vz = dir.z * brush;
    const b = v3(vx * c - vz * sn, dir.y * brush, vx * sn + vz * c);
    const normal = faceNormal(pitch, aimYaw + turn);
    return { normal, vel: add(b, scale(normal, dot(b, normal) * (f - 1))) };
  };
  // Aim the ball, not the bat: a sideways brush (sidespin, or a free serve swiped across)
  // sends the ball off at an angle to the stroke, so turn the stroke to start it toward the aim.
  let aimTurn = 0;
  {
    const st = cloneState(ball);
    const adj = make(mid, 1);
    if (paddleImpulse(st, { ...pose, normal: adj.normal, vel: adj.vel! }, rubber) > 0 && st.vel.z < -0.1) {
      const travel = (Math.atan2(st.vel.x, -st.vel.z) * 180) / Math.PI;
      aimTurn = clamp(aimYaw - travel, -40, 40);
    }
  }
  const k = clamp(strength, 0, 1);
  if (k <= 0) return plan(make(mid, 1, aimTurn));

  // The assist's room: the face within the type's range, the pace into it, and the stroke
  // turned a little (all narrower with less assist).
  const half = ((r.pitch[1] - r.pitch[0]) / 2) * Math.max(0.35, k);
  const pitches: number[] = [];
  const steps = auto ? 6 : 4;
  for (let i = 0; i <= steps; i++) pitches.push(mid - half + (2 * half * i) / steps);
  // Free serve: the player's own face first, then further from it.
  const from = auto ? playerPitch : mid;
  const fMax = Math.exp(0.12 + 0.5 * k);
  const fMin = 1 / Math.exp(0.15 + 0.75 * k);
  const maxTurn = (type === 'sidespin' ? 36 : 24) * k;

  const started = performance.now();
  const outOfTime = (found: boolean) => performance.now() - started > (found ? SEARCH_BUDGET_MS : SEARCH_LIMIT_MS);
  const test = (adj: ContactAdjust, dt?: number) => landingOutcome(ball, { ...pose, vel: adj.vel! }, adj.normal, rubber, params, 'serve', dt);
  const kindOk = (adj: ContactAdjust): number | null => {
    const st = cloneState(ball);
    if (paddleImpulse(st, { ...pose, normal: adj.normal, vel: adj.vel! }, rubber) <= 0) return null;
    const c = spinComponents(st.vel, st.spin);
    // It must be the kind of serve asked for.
    if (type === 'backspin' && c.top > -5) return null;
    if (type === 'topspin' && c.top < 5) return null;
    return radToRpm(length(st.spin));
  };
  interface Cand {
    adj: ContactAdjust;
    pitch: number;
    f: number;
    turn: number;
    rpm: number;
    pos: Vec3;
  }
  const landed: Cand[] = [];
  const near = (pos: Vec3) => Math.hypot(0.8 * (pos.x - aim.x), pos.z - aim.z);
  /** Bisect the pace (geometrically) toward the aimed depth at one face angle and turn. */
  const searchPace = (pitch: number, turn: number, steps: number) => {
    let lo = fMin;
    let hi = fMax;
    let hit = false;
    for (let it = 0; it < steps; it++) {
      if (outOfTime(landed.some((l) => near(l.pos) < 0.25))) break;
      const f = Math.sqrt(lo * hi);
      const adj = make(pitch, f, turn);
      const rpm = kindOk(adj);
      if (rpm === null) break;
      const out = test(adj, 1 / 60);
      if (out.outcome === 'in' && out.pos) {
        // Doubles: your right half, then theirs.
        if (!diagonal || isDiagonal(out.first, out.pos)) ((hit = true), landed.push({ adj, pitch, f, turn, rpm, pos: out.pos }));
        if (out.pos.z > aim.z) lo = f;
        else hi = f;
      } else if (out.outcome === 'long' || out.outcome === 'wide') hi = f;
      else lo = f;
    }
    return hit;
  };
  // Every face angle, stroke pointed at the aim; the middle (or the player's) face first.
  const order = [...pitches].sort((p, q) => Math.abs(p - from) - Math.abs(q - from));
  for (const pitch of order) searchPace(pitch, aimTurn, 6);
  // Nothing lands: a sidespin's curve (or a toss out wide) may need the stroke turned back
  // toward the table. Find the smallest turn that lands, then every face angle there.
  if (!landed.length) {
    const toward = side !== 0 && !auto ? -side : 1;
    let turn0: number | null = null;
    for (let t = 12; t <= maxTurn + 1e-9 && turn0 === null && !outOfTime(false); t += 12) {
      turn0 = [aimTurn + toward * t, aimTurn - toward * t].find((turn) => searchPace(mid, turn, 5)) ?? null;
    }
    if (turn0 !== null) for (const pitch of order) if (pitch !== mid) searchPace(pitch, turn0, 5);
  }
  if (landed.length) {
    const maxRpm = Math.max(1, ...landed.map((l) => l.rpm));
    const score = (c: Cand) => near(c.pos) + 0.45 * (r.spin ? 1 - c.rpm / maxRpm : Math.min(1, c.rpm / 3000)) + 0.1 * Math.abs(Math.log(c.f)) + Math.abs(c.turn - aimTurn) / 200;
    landed.sort((a, b) => score(a) - score(b));
    // Line: turn the best one (face and stroke together) toward the aim's line.
    const best = landed[0];
    const lineFix = (c: Cand): Cand => {
      let cur = c;
      for (let it = 0; it < 2 && Math.abs(cur.pos.x - aim.x) > 0.06; it++) {
        // About 1.2 m from bat to bounce: the turn that moves the landing that far sideways.
        const room = Math.max(maxTurn, 12 * k);
        const turn = clamp(cur.turn + (((aim.x - cur.pos.x) / 1.2) * 180) / Math.PI, aimTurn - room, aimTurn + room);
        const adj = make(cur.pitch, cur.f, turn);
        const out = test(adj, 1 / 60);
        if (out.outcome !== 'in' || !out.pos || (diagonal && !isDiagonal(out.first, out.pos)) || near(out.pos) >= near(cur.pos)) break;
        cur = { ...cur, adj, turn, pos: out.pos };
      }
      return cur;
    };
    // Confirm the best few at the live ball's resolution; with more assist, prefer one with
    // room to spare (a little more or less face still lands) unless it's clearly worse.
    let pick: { c: Cand; cost: number } | null = null;
    for (const c0 of [best, ...landed.slice(1, 3)]) {
      const c = c0 === best ? lineFix(c0) : c0;
      if (test(c.adj).outcome !== 'in') continue;
      const safe = [-2.5, 2.5].every((d) => test(make(c.pitch + d, c.f, c.turn), 1 / 60).outcome === 'in');
      const cost = score(c) + (safe ? 0 : 0.12 * k);
      if (!pick || cost < pick.cost) pick = { c, cost };
    }
    if (pick) return plan(pick.c.adj);
  }
  // Nothing lands. A sidespin brushed toward the near edge (from a toss out wide) is
  // turned around to brush toward the middle: a sidespin that curves the other way
  // beats a fault.
  if (type === 'sidespin' && !flipped && side !== 0) {
    const other = planServe(type, ball, { ...pose, vel: v3(-pose.vel.x, pose.vel.y, pose.vel.z) }, rubber, params, strength, { ...opts, flipped: true });
    if (other?.adj) return other;
  }
  // Otherwise leave it to the normal landing assist, starting from the type's own stroke
  // (so it keeps the type's spin; e.g. when the search ran out of time on a slow device).
  return plan(null);
}

export interface ServeReport {
  /** Gap between ball and net tape as it crosses (m); null if it never crossed. */
  clearance: number | null;
  /** 'short': it would bounce twice on the receiver's half; 'long': once, then off the end. */
  length: 'short' | 'long' | 'fault';
  rpm: number;
  spin: string;
  /** 0–100: low, short and spinny is best. */
  rating: number;
  /** e.g. "Low · Short · 3,800 rpm backspin". */
  text: string;
  /** Where it first bounces on the receiver's half (null if it never does). */
  landing: Vec3 | null;
}

/** A spot on the receiver's half in words, as the server sees it: e.g. "short left", "long middle". */
export function describeSpot(x: number, z: number): string {
  const depth = z > -0.6 ? 'short' : z > -0.95 ? 'half-long' : 'long';
  const line = x < -0.22 ? 'left' : x > 0.22 ? 'right' : 'middle';
  return `${depth} ${line}`;
}

/**
 * How good a serve is, from the ball as it leaves the bat (server's frame: server at +z).
 * Low over the net, short (two bounces on the far half if left) and spinny is hard to attack;
 * a serve that pops up high invites a kill.
 */
export function serveReport(ball: BallState, params: PhysicsParams): ServeReport {
  const c = spinComponents(ball.vel, ball.spin);
  const rpm = radToRpm(length(ball.spin));
  const { events } = predict(ball, params, { maxTime: 2.5, sampleEvery: 1000, stop: (e) => e.type === 'floor' || e.type === 'net' });
  const cross = events.find((e) => e.type === 'netCross' && e.direction === 'far');
  const clearance = cross && cross.type === 'netCross' ? cross.clearance : null;
  const bounces = events.filter((e) => e.type === 'table');
  const farBounces = bounces.filter((e) => e.type === 'table' && e.pos.z < 0);
  const far = farBounces.length;
  const legal = bounces.length > 0 && bounces[0].type === 'table' && bounces[0].pos.z > 0 && far >= 1 && !events.some((e) => e.type === 'net');
  const len: ServeReport['length'] = !legal ? 'fault' : far >= 2 ? 'short' : 'long';
  const height = clearance === null ? 'Into the net' : clearance < 0.05 ? 'Low' : clearance < 0.12 ? 'Medium height' : 'High';
  let rating = 0;
  if (legal) {
    const low = clearance === null ? 0 : Math.max(0, Math.min(1, (0.18 - clearance) / 0.14));
    const spin = Math.min(1, rpm / 4000);
    rating = Math.round(100 * (0.35 * low + 0.25 * (len === 'short' ? 1 : 0.4) + 0.4 * spin));
  }
  const spinText = rpm < 500 ? 'no spin' : `${(Math.round(rpm / 100) * 100).toLocaleString()} rpm ${describeSpin(c).toLowerCase()}`;
  const text = len === 'fault' ? `Fault · ${spinText}` : `${height} · ${len === 'short' ? 'Short' : 'Long'} · ${spinText}`;
  return { clearance, length: len, rpm, spin: describeSpin(c), rating, text, landing: farBounces[0]?.type === 'table' ? farBounces[0].pos : null };
}
