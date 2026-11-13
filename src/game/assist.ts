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
/** A rally shot must land on the far half; a serve must bounce on the near half, then the far half. */
export type ShotMode = 'rally' | 'serve';

/**
 * Where a hit with this face normal would land, in the hitter's frame (hitter at +z).
 * 'short' = into the net / own side; 'long' = past the far end.
 */
export function landingOutcome(
  ball: BallState,
  pose: PaddlePose,
  normal: Vec3,
  rubber: Rubber,
  params: PhysicsParams,
  mode: ShotMode = 'rally',
): { outcome: LandingOutcome; pos?: Vec3; first?: Vec3 } {
  const s = cloneState(ball);
  if (paddleImpulse(s, { ...pose, normal }, rubber) <= 0) return { outcome: 'short' };
  let tables = 0;
  const { events } = predict(s, params, {
    maxTime: 2.5,
    dt: 1 / 120,
    sampleEvery: 1000,
    maxTravel: 0.018,
    stop: (e) => e.type === 'floor' || (e.type === 'table' && ++tables >= (mode === 'serve' ? 2 : 1)),
  });
  const bounces = events.filter((e) => e.type === 'table');
  const netTouched = events.some((e) => e.type === 'net');
  const floor = events.find((e) => e.type === 'floor');
  const crossedFar = events.some((e) => e.type === 'netCross' && e.direction === 'far');

  if (mode === 'serve') {
    const [first, second] = bounces;
    if (!first) return { outcome: crossedFar ? 'long' : 'short' };
    if (first.pos.z < 0) return { outcome: 'long' }; // didn't bounce on own half first
    if (!second) return { outcome: crossedFar ? 'long' : 'short' };
    if (second.pos.z > 0 || netTouched) return { outcome: 'short' };
    return { outcome: 'in', pos: second.pos, first: first.pos };
  }

  const land = bounces[0] ?? floor;
  if (!land) return { outcome: 'long' };
  if (land.type === 'table') {
    if (land.pos.z > 0) return { outcome: 'short' };
    return { outcome: 'in', pos: land.pos };
  }
  if (!crossedFar) return { outcome: 'short' };
  return { outcome: Math.abs(land.pos.x) > TABLE.halfWidth && land.pos.z > -TABLE.halfLength ? 'wide' : 'long' };
}

/** Rotate a face normal about its horizontal pitch axis by `deg` (positive or negative). */
export function pitchRotator(normal: Vec3): ((deg: number) => Vec3) | null {
  let axis = cross(normal, UP);
  if (length(axis) < 1e-6) return null;
  axis = normalize(axis);
  return (deg: number) => rotate(normal, axis, (deg * Math.PI) / 180);
}

/**
 * Angle assist. At the moment of contact, find the range of face pitch that would
 * land the ball on the opponent's half, and correct the player's chosen angle into
 * it if the error is within `strength` × 60° (0 = pure simulation, 1 = always lands
 * if any angle can).
 * The player's choice still decides where within that window the ball goes —
 * deep or short, spinny or flat.
 */
export function makeAngleAssist(params: PhysicsParams, strength: () => number, mode: () => ShotMode = () => 'rally') {
  const STEP = 6;
  const RANGE = 60;
  return (ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 => {
    const k = strength();
    if (k <= 0) return normal;
    const at = pitchRotator(normal);
    if (!at) return normal;
    const m = mode();
    const outcomeAt = (deg: number) => landingOutcome(ball, pose, at(deg), rubber, params, m).outcome;
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
