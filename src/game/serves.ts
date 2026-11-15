import { TABLE, cloneState, describeSpin, length, normalize, paddleImpulse, predict, radToRpm, spinComponents, v3, type BallState, type ContactAdjust, type PaddlePose, type PhysicsParams, type Rubber, type Vec3 } from '../physics';
import { isDiagonal, landingOutcome } from './assist';
import { faceNormal } from './swing';

/**
 * Serve types. Spinny serves need a fast brush with an open (or closed) face and little
 * forward pace, which is hard to produce with a mouse flick and was mostly corrected
 * away by the landing assist. With a serve type chosen, the type sets the face and the
 * brush direction, the swipe's speed sets how hard (how much spin), and the assist looks
 * for a version that lands *without* taking the spin out.
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
  { id: 'backspin', name: 'Backspin', mouse: 'Flick down: faster = more backspin. Angle it for side', touch: 'Swipe down: faster = more backspin' },
  { id: 'sidespin', name: 'Sidespin', mouse: 'Flick sideways: left or right sets the curve', touch: 'Swipe sideways: left or right sets the curve' },
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
  /** Short serves bounce twice on the far half; long ones go to the end line. */
  length: 'short' | 'long';
  /** Prefer more spin (true) or less (the no-spin serve). */
  spin: boolean;
}

const RECIPES: Record<Exclude<ServeType, 'auto'>, Recipe> = {
  backspin: { dir: (s) => v3(s * 0.45, -1, -0.8), speed: [4, 12], pitch: [15, 50], length: 'short', spin: true },
  sidespin: { dir: (s) => v3((s || 1) * 1, -0.75, -0.55), speed: [4, 10], pitch: [-10, 25], length: 'short', spin: true },
  topspin: { dir: (s) => v3(s * 0.4, 0.35, -1), speed: [4, 10], pitch: [-55, -20], length: 'long', spin: true },
  fast: { dir: (s) => v3(s * 0.15, 0.05, -1), speed: [5, 10], pitch: [-25, 5], length: 'long', spin: false },
  float: { dir: () => v3(0, -0.3, -1), speed: [2.5, 5], pitch: [-10, 30], length: 'short', spin: false },
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
const SEARCH_BUDGET_MS = 6;
/** …and the search gives up (serving the type's plain recipe) after this. */
const SEARCH_LIMIT_MS = 25;

/** Short serve: second bounce in the nearer part of the far half. */
const SHORT_Z = -TABLE.halfLength + 0.55;

/**
 * Contact for a chosen serve type. `pose.vel` is the player's swing: its speed sets the
 * intensity and its sideways direction the side. `strength` is the landing assist
 * (0 = take the recipe as it is, even if it faults; 1 = search freely for one that lands).
 * Returns null for 'auto' (the normal assist handles it).
 */
export function serveContact(type: ServeType, ball: BallState, pose: PaddlePose, rubber: Rubber, params: PhysicsParams, strength: number, flipped = false, diagonal = false): ContactAdjust | null {
  if (type === 'auto') return null;
  const r = RECIPES[type];
  const sp = length(pose.vel);
  // No swing (the ball just dropped onto a still bat): not a serve stroke.
  if (sp < 1) return null;
  const intensity = Math.max(0, Math.min(1, (sp - 1) / 7));
  // Side from the swipe itself: sideways compared with up/down (not the forward drive).
  let side = Math.abs(pose.vel.x) > 0.5 * Math.abs(pose.vel.y) && Math.abs(pose.vel.x) > 0.5 ? Math.sign(pose.vel.x) : 0;
  // A straight swipe on a sidespin serve brushes toward the middle of the table.
  if (type === 'sidespin' && side === 0) side = ball.pos.x > 0 ? -1 : 1;
  const dir = normalize(r.dir(side));
  const yaw = (Math.atan2(pose.normal.x, -pose.normal.z) * 180) / Math.PI;
  const brush = r.speed[0] + (r.speed[1] - r.speed[0]) * intensity;
  const mid = (r.pitch[0] + r.pitch[1]) / 2;

  // Turning the face (and the stroke with it) about the vertical steers the serve back
  // onto the table, e.g. a sidespin brush that would carry it off the side.
  const make = (pitch: number, f: number, turn = 0): ContactAdjust => {
    const a = (turn * Math.PI) / 180;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    const vx = dir.x * brush * f;
    const vz = dir.z * brush * f;
    return { normal: faceNormal(pitch, yaw + turn), vel: v3(vx * c - vz * sn, dir.y * brush * f, vx * sn + vz * c) };
  };
  if (strength <= 0) return make(mid, 1);

  // Search the face angle within the type's range (narrower with less assist) and the
  // brush speed (a little either side of the swipe's), for the spinniest serve that lands.
  const half = ((r.pitch[1] - r.pitch[0]) / 2) * Math.min(1, strength);
  const turns = strength >= 0.5 ? [0, -12, 12, -24, 24, -36, 36] : [0];
  // Spin is cheap to work out; whether a serve lands means simulating its flight. So score
  // every candidate on spin first, then simulate them best-first and stop as soon as no
  // remaining candidate could beat the best one that lands (one serve stays well under a frame).
  const candidates: { adj: ContactAdjust; bound: number; turn: number }[] = [];
  for (let pitch = mid - half; pitch <= mid + half + 1e-9; pitch += Math.max(2.5, half / 3)) {
    for (const f of [1, 0.8, 1.2, 0.6, 0.45]) {
      for (const turn of turns) {
        const adj = make(pitch, f, turn);
        const st = cloneState(ball);
        if (paddleImpulse(st, { ...pose, normal: adj.normal, vel: adj.vel! }, rubber) <= 0) continue;
        // Clearly heading off the side (a straight-line estimate to the far end line, with
        // slack for the curve): skip it without simulating its flight.
        if (st.vel.z < -0.1) {
          const xEnd = st.pos.x + (st.vel.x * (st.pos.z + TABLE.halfLength)) / -st.vel.z;
          const xNet = st.pos.x + (st.vel.x * st.pos.z) / -st.vel.z;
          if (Math.abs(xNet) > TABLE.halfWidth + 0.15 && Math.abs(xEnd) > TABLE.halfWidth + 0.3) continue;
        }
        const c = spinComponents(st.vel, st.spin);
        // It must be the kind of serve asked for.
        if (type === 'backspin' && c.top > -5) continue;
        if (type === 'topspin' && c.top < 5) continue;
        const rpm = radToRpm(length(st.spin));
        let bound = r.spin ? rpm : 3000 - rpm;
        bound *= 1 - 0.25 * Math.abs(1 - f); // stay close to the swipe's own speed
        bound *= 1 - Math.abs(turn) / 120; // and to straight
        candidates.push({ adj, bound, turn });
      }
    }
  }
  candidates.sort((a, b) => b.bound - a.bound);
  // Straight face first; turned faces (to steer it back onto the table) only if needed.
  // A time budget keeps the serve contact under a frame or so: past it, the best serve
  // found that lands is good enough (the search only carries on if none lands yet).
  const started = performance.now();
  const pick = (list: typeof candidates) => {
    let best: { adj: ContactAdjust; score: number } | null = null;
    for (const c of list) {
      if (best && c.bound <= best.score) break;
      const spent = performance.now() - started;
      if ((best && spent > SEARCH_BUDGET_MS) || spent > SEARCH_LIMIT_MS) break;
      // Screen with coarse steps, then confirm at the live ball's resolution.
      const quick = landingOutcome(ball, { ...pose, vel: c.adj.vel! }, c.adj.normal, rubber, params, 'serve', 1 / 60);
      if (quick.outcome !== 'in') continue;
      const out = landingOutcome(ball, { ...pose, vel: c.adj.vel! }, c.adj.normal, rubber, params, 'serve');
      if (out.outcome !== 'in' || !out.pos) continue;
      if (diagonal && !isDiagonal(out.first, out.pos)) continue; // doubles: your right half, then theirs
      const isShort = out.pos.z > SHORT_Z;
      const score = c.bound * ((r.length === 'short') === isShort ? 1 : 0.6);
      if (!best || score > best.score) best = { adj: c.adj, score };
    }
    return best;
  };
  const straight = candidates.filter((c) => c.turn === 0);
  const best = pick(straight) ?? pick(candidates.filter((c) => c.turn !== 0));
  if (best) return best.adj;
  // Nothing lands. A sidespin brushed toward the near edge (from a toss out wide) is
  // turned around to brush toward the middle: a sidespin that curves the other way
  // beats a fault.
  if (type === 'sidespin' && !flipped && side !== 0) return serveContact(type, ball, { ...pose, vel: v3(-pose.vel.x, pose.vel.y, pose.vel.z) }, rubber, params, strength, true, diagonal);
  // Otherwise leave it to the normal landing assist, with the player's own swing.
  return null;
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
  const far = bounces.filter((e) => e.type === 'table' && e.pos.z < 0).length;
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
  return { clearance, length: len, rpm, spin: describeSpin(c), rating, text };
}
