import { predict, type BallEvent, type BallState } from './ball';
import { TABLE, type PhysicsParams } from './constants';
import { spinVector, type SpinComponents } from './spin';
import { scale, v3, type Vec3 } from './vec3';

/**
 * Ball machine: launches balls from behind the far end toward the near (+z) end.
 * Used now for tuning physics; later it becomes the training mode's robot.
 */
export interface Shot {
  /** Launch speed, m/s. */
  speed: number;
  /** Degrees above horizontal. */
  elevation: number;
  /** Degrees; positive aims toward +x (the player's right when looking down the table from the near end). */
  azimuth: number;
  spin: SpinComponents;
}

export function launchDirection(elevationDeg: number, azimuthDeg: number): Vec3 {
  const e = (elevationDeg * Math.PI) / 180;
  const a = (azimuthDeg * Math.PI) / 180;
  return v3(Math.cos(e) * Math.sin(a), Math.sin(e), Math.cos(e) * Math.cos(a));
}

export function launchState(origin: Vec3, shot: Shot): BallState {
  const dir = launchDirection(shot.elevation, shot.azimuth);
  return { pos: { ...origin }, vel: scale(dir, shot.speed), spin: spinVector(dir, shot.spin) };
}

/** First bounce of a launched ball, and whether it cleared the net. */
export function firstBounce(origin: Vec3, shot: Shot, params: PhysicsParams) {
  const { events } = predict(launchState(origin, shot), params, {
    maxTime: 4,
    stop: (e) => e.type === 'table' || e.type === 'floor',
  });
  const net = events.find((e) => e.type === 'net');
  const landing = events.find((e): e is Extract<BallEvent, { type: 'table' | 'floor' }> => e.type === 'table' || e.type === 'floor');
  return { net, landing, events };
}

export interface AimResult {
  elevation: number;
  azimuth: number;
  /** Whether a launch landing on the target (and clearing the net) was found. */
  ok: boolean;
  landing?: Vec3;
}

/**
 * Find the elevation/azimuth that lands the ball on a target point on the near
 * half for a given speed and spin, accounting for drag, Magnus curve and the net.
 * Takes the lowest trajectory that works, or the high arc when highArc is set.
 */
export function solveAim(
  origin: Vec3,
  target: { x: number; z: number },
  speed: number,
  spin: SpinComponents,
  params: PhysicsParams,
  /** Take the high arc (lobs) instead of the lowest trajectory that works. */
  highArc = false,
): AimResult {
  const minElevation = -25;
  let azimuth = (Math.atan2(target.x - origin.x, target.z - origin.z) * 180) / Math.PI;
  let elevation = minElevation;
  let best: { err: number; elevation: number; landing?: Vec3 } = { err: Infinity, elevation };

  for (let iter = 0; iter < 4; iter++) {
    // Scan elevations coarsely for the first one whose landing passes the target depth.
    const depthAt = (el: number) => {
      const { landing, net, events } = firstBounce(origin, { speed, elevation: el, azimuth, spin }, params);
      if (!landing || net) return { z: -Infinity, landing: undefined as Vec3 | undefined };
      // Missing the table counts as "long" only if the ball went over the net;
      // a ball that dives under the far end of the table is "short".
      const crossed = events.some((e) => e.type === 'netCross' && e.direction === 'near');
      const z = landing.type === 'table' ? landing.pos.z : crossed ? TABLE.halfLength + 1 : -Infinity;
      return { z, landing: landing.type === 'table' ? landing.pos : undefined };
    };
    let lo = NaN;
    let hi = NaN;
    // Low arc: scan upward from flat. High arc: scan downward from steep, where
    // lowering the elevation lengthens the shot.
    const step = highArc ? -1 : 1;
    for (let el = highArc ? 80 : minElevation; highArc ? el >= 10 : el <= 75; el += step) {
      const { z } = depthAt(el);
      if (z >= target.z) {
        hi = el;
        lo = el - step;
        break;
      }
    }
    if (Number.isNaN(hi)) return { elevation: best.elevation, azimuth, ok: false };
    // Bisect between "short / into net" and "reaches target".
    for (let i = 0; i < 18; i++) {
      const mid = (lo + hi) / 2;
      if (depthAt(mid).z >= target.z) hi = mid;
      else lo = mid;
    }
    elevation = hi;
    const res = depthAt(elevation);
    if (!res.landing) return { elevation, azimuth, ok: false };
    const err = Math.hypot(res.landing.x - target.x, res.landing.z - target.z);
    if (err < best.err) best = { err, elevation, landing: res.landing };
    if (err < 0.01) break;
    // Correct azimuth for lateral curve (sidespin / corkscrew), then re-solve.
    const dist = Math.hypot(target.x - origin.x, target.z - origin.z);
    azimuth -= ((res.landing.x - target.x) / dist) * (180 / Math.PI);
  }
  return { elevation: best.elevation, azimuth, ok: best.err < 0.08, landing: best.landing };
}

/**
 * A serve's two bounces (the server's half, then the receiver's), or null if it hits the
 * net, misses either half or never gets there.
 */
export function serveBounces(origin: Vec3, shot: Shot, params: PhysicsParams): { first: Vec3; second: Vec3 } | null {
  const { events } = predict(launchState(origin, shot), params, {
    maxTime: 3,
    stop: (e) => e.type === 'floor' || e.type === 'net' || (e.type === 'table' && e.pos.z > 0),
  });
  if (events.some((e) => e.type === 'net' || e.type === 'floor')) return null;
  const tables = events.filter((e): e is Extract<BallEvent, { type: 'table' }> => e.type === 'table');
  if (tables.length < 2 || tables[0].pos.z >= 0 || tables[1].pos.z <= 0) return null;
  return { first: tables[0].pos, second: tables[1].pos };
}

/**
 * Aim a machine *serve*: launched from behind the far end line, it bounces on the far
 * half first and then lands on `target` on the near half, as a real serve does. Solves
 * for the (downward) elevation at the given speed and spin, correcting the azimuth for
 * sidespin curve. `landing` is the second (receiver's) bounce.
 */
export function solveServeAim(origin: Vec3, target: { x: number; z: number }, speed: number, spin: SpinComponents, params: PhysicsParams): AimResult {
  let azimuth = (Math.atan2(target.x - origin.x, target.z - origin.z) * 180) / Math.PI;
  let best: { err: number; elevation: number; azimuth: number; landing?: Vec3 } = { err: Infinity, elevation: -12, azimuth };
  for (let iter = 0; iter < 4; iter++) {
    let found: { err: number; elevation: number; landing?: Vec3 } = { err: Infinity, elevation: best.elevation };
    const tryAt = (el: number) => {
      const b = serveBounces(origin, { speed, elevation: el, azimuth, spin }, params);
      if (!b) return;
      const err = Math.abs(b.second.z - target.z);
      if (err < found.err) found = { err, elevation: el, landing: b.second };
    };
    // Coarse scan, then a fine one around the best elevation.
    for (let el = -50; el <= 20; el += 2) tryAt(el);
    if (!found.landing) break;
    const c = found.elevation;
    for (let el = c - 2; el <= c + 2; el += 0.1) tryAt(el);
    const landing = found.landing!;
    const err = Math.hypot(landing.x - target.x, landing.z - target.z);
    if (err < best.err) best = { err, elevation: found.elevation, azimuth, landing };
    if (err < 0.02) break;
    const dist = Math.hypot(target.x - origin.x, target.z - origin.z);
    azimuth -= ((landing.x - target.x) / dist) * (180 / Math.PI);
  }
  return { elevation: best.elevation, azimuth: best.azimuth, ok: best.err < 0.12, landing: best.landing };
}
