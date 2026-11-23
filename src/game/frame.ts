import type { BallState, PaddlePose, PhysicsParams, Puddle, Vec3 } from '../physics';

/** The two ends of the table. 'near' is +z (the local player's end in the default view). */
export type SideId = 'near' | 'far';

export const other = (s: SideId): SideId => (s === 'near' ? 'far' : 'near');

/**
 * Each player's logic runs in a local frame where *they* are at the near (+z) end.
 * The far end's local frame is the world rotated 180° about the vertical axis:
 * (x, y, z) → (−x, y, −z). Rotations map axial vectors (spin) the same way, so one
 * transform covers positions, velocities and angular velocities. The same mapping
 * will let every online client see themselves at the near end.
 */
export function mapVec(side: SideId, v: Vec3): Vec3 {
  return side === 'near' ? { x: v.x, y: v.y, z: v.z } : { x: -v.x, y: v.y, z: -v.z };
}

export function mapState(side: SideId, s: BallState): BallState {
  return { pos: mapVec(side, s.pos), vel: mapVec(side, s.vel), spin: mapVec(side, s.spin) };
}

export function mapPose(side: SideId, p: PaddlePose): PaddlePose {
  return { pos: mapVec(side, p.pos), normal: mapVec(side, p.normal), vel: mapVec(side, p.vel) };
}

/** Which end a world z coordinate is on. */
export const sideOfZ = (z: number): SideId => (z >= 0 ? 'near' : 'far');

const mirrored = new WeakMap<readonly Puddle[], Puddle[]>();

/**
 * The physics as seen from `side`'s local frame. Most of it has no direction, but the
 * weather does: the far end feels the wind, and sees the puddles, rotated half round.
 * Returns `params` itself in still, dry air (and for the near end). The result is a
 * snapshot: call again for the current wind.
 */
export function mapParams(side: SideId, params: PhysicsParams): PhysicsParams {
  if (side === 'near' || (!params.windX && !params.windZ && !params.puddles.length)) return params;
  let puddles = mirrored.get(params.puddles);
  if (!puddles) mirrored.set(params.puddles, (puddles = params.puddles.map((p) => ({ x: -p.x, z: -p.z, r: p.r }))));
  return { ...params, windX: -params.windX, windZ: -params.windZ, puddles };
}
