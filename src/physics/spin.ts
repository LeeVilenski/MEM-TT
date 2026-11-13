import { cross, dot, length, normalize, scale, add, v3, UP, type Vec3 } from './vec3';

export const TWO_PI = Math.PI * 2;
export const rpsToRad = (rps: number) => rps * TWO_PI;
export const radToRpm = (rad: number) => (rad / TWO_PI) * 60;

/** Spin described relative to the ball's direction of travel, in revolutions per second. */
export interface SpinComponents {
  /** Positive = topspin, negative = backspin. */
  top: number;
  /** Positive = curves to the right from the hitter's point of view. */
  side: number;
  /** Rotation about the direction of travel (gyro / "corkscrew"). Positive kicks right on the bounce. */
  cork: number;
}

/** Local frame for a direction of travel: topspin axis, sidespin axis, corkscrew axis. */
function spinFrame(dir: Vec3) {
  const d = normalize(dir);
  let topAxis = cross(UP, d);
  if (length(topAxis) < 1e-6) topAxis = v3(1, 0, 0);
  topAxis = normalize(topAxis);
  const sideAxis = normalize(cross(d, topAxis)); // ≈ up
  return { d, topAxis, sideAxis };
}

/** Build an angular-velocity vector (rad/s) from human spin components for a ball travelling along dir. */
export function spinVector(dir: Vec3, c: SpinComponents): Vec3 {
  const { d, topAxis, sideAxis } = spinFrame(dir);
  return add(add(scale(topAxis, rpsToRad(c.top)), scale(sideAxis, -rpsToRad(c.side))), scale(d, rpsToRad(c.cork)));
}

/** Decompose an angular velocity into components relative to the direction of travel. */
export function spinComponents(vel: Vec3, spin: Vec3): SpinComponents {
  if (length(vel) < 1e-6) return { top: 0, side: 0, cork: 0 };
  const { d, topAxis, sideAxis } = spinFrame(vel);
  return {
    top: dot(spin, topAxis) / TWO_PI,
    side: -dot(spin, sideAxis) / TWO_PI,
    cork: dot(spin, d) / TWO_PI,
  };
}

/** Short human label for a spin, e.g. "Heavy topspin + right side". */
export function describeSpin(c: SpinComponents): string {
  const mag = (rps: number) => (rps > 90 ? 'Heavy ' : rps > 40 ? '' : 'Light ');
  const parts: string[] = [];
  const total = Math.hypot(c.top, c.side, c.cork);
  if (total < 8) return 'No spin (float)';
  if (Math.abs(c.top) >= 8) parts.push(`${mag(Math.abs(c.top))}${c.top > 0 ? 'topspin' : 'backspin'}`);
  if (Math.abs(c.side) >= 8) parts.push(`${c.side > 0 ? 'right' : 'left'} sidespin`);
  if (Math.abs(c.cork) >= 8) parts.push(`${c.cork > 0 ? 'right' : 'left'} corkscrew`);
  const s = parts.join(' + ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}
