import {
  TABLE,
  UP,
  cloneState,
  cross,
  dot,
  length,
  normalize,
  paddleImpulse,
  predict,
  scale,
  add,
  type BallState,
  type PaddlePose,
  type PhysicsParams,
  type Rubber,
  type Vec3,
} from '../physics';

/** Rotate v around a unit axis by an angle (Rodrigues). */
function rotate(v: Vec3, axis: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

export type LandingOutcome = 'in' | 'short' | 'long' | 'wide';

/** Where a hit with this face normal would land: on the far half, into the net/own side, or long. */
export function landingOutcome(ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber, params: PhysicsParams): { outcome: LandingOutcome; z?: number } {
  const s = cloneState(ball);
  if (paddleImpulse(s, { ...pose, normal }, rubber) <= 0) return { outcome: 'short' };
  const { events } = predict(s, params, { maxTime: 2, dt: 1 / 120, sampleEvery: 1000, maxTravel: 0.018, stop: (e) => e.type === 'table' || e.type === 'floor' });
  const land = events.find((e) => e.type === 'table' || e.type === 'floor');
  if (!land) return { outcome: 'long' };
  if (land.type === 'table') {
    if (land.pos.z > 0) return { outcome: 'short' };
    return { outcome: 'in', z: land.pos.z };
  }
  const crossed = events.some((e) => e.type === 'netCross' && e.direction === 'far');
  if (!crossed) return { outcome: 'short' };
  return { outcome: Math.abs(land.pos.x) > TABLE.halfWidth && land.pos.z > -TABLE.halfLength ? 'wide' : 'long' };
}

/**
 * Angle assist. At the moment of contact, find the range of face pitch that would
 * land the ball on the opponent's half, and correct the player's chosen angle into
 * it if the error is within `strength` × 60° (0 = pure simulation, 1 = always lands
 * if any angle can).
 * The player's choice still decides where within that window the ball goes —
 * deep or short, spinny or flat.
 */
export function makeAngleAssist(params: PhysicsParams, strength: () => number) {
  const STEP = 6;
  const RANGE = 60;
  return (ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 => {
    const k = strength();
    if (k <= 0) return normal;
    // Pitch axis: horizontal, perpendicular to the face normal.
    let axis = cross(normal, UP);
    if (length(axis) < 1e-6) return normal;
    axis = normalize(axis);
    const at = (deg: number) => rotate(normal, axis, (deg * Math.PI) / 180);

    const outcomeAt = (deg: number) => landingOutcome(ball, pose, at(deg), rubber, params).outcome;
    if (outcomeAt(0) === 'in') return normal;

    // Coarse scan of the whole pitch range; pick the landing angle nearest the player's.
    const samples: { deg: number; out: LandingOutcome }[] = [];
    for (let d = -RANGE; d <= RANGE; d += STEP) samples.push({ deg: d, out: outcomeAt(d) });

    let found: number | null = null;
    let best = Infinity;
    for (const smp of samples) if (smp.out === 'in' && Math.abs(smp.deg) < best) ((best = Math.abs(smp.deg)), (found = smp.deg));

    // Landing windows can be narrower than the scan step: bisect short↔long transitions too.
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const flip = (a.out === 'short' && b.out === 'long') || (a.out === 'long' && b.out === 'short');
      if (!flip || Math.min(Math.abs(a.deg), Math.abs(b.deg)) >= best) continue;
      let lo = a.deg;
      let hi = b.deg;
      for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        const out = outcomeAt(mid);
        if (out === 'in') {
          if (Math.abs(mid) < best) ((best = Math.abs(mid)), (found = mid));
          break;
        }
        if (out === a.out) lo = mid;
        else hi = mid;
      }
    }
    if (found === null) return normal;
    // Step slightly into the window when it continues, so the ball isn't on the edge.
    const deeper = found + Math.sign(found) * 1.5;
    const target = outcomeAt(deeper) === 'in' ? deeper : found;
    // Strength = how large an angle error gets fully corrected (1 → the whole ±60° range).
    // Beyond that the face is only nudged, so a wild swing still misses.
    const reach = k * RANGE;
    return at(Math.abs(target) <= reach ? target : Math.sign(target) * reach);
  };
}
