import { BALL } from './constants';
import { add, addScaled, cross, dot, length, scale, sub, type Vec3 } from './vec3';
import type { BallState } from './ball';

/**
 * Rubber properties. The contact model is impulse-based, like the table bounce,
 * but with a sponge "catapult" (tangential restitution) that lets grippy rubbers
 * overspin the ball, and low-friction rubbers (long pips, anti) that leave the
 * incoming spin largely untouched — which is what "reverses" spin relative to
 * the new direction of travel.
 */
export interface Rubber {
  id: string;
  /** Themed display name. */
  name: string;
  kind: string;
  /** Normal coefficient of restitution at low impact speed (blade + sponge). */
  restitution: number;
  /** Restitution lost per m/s of normal impact speed. */
  restitutionSpeedLoss: number;
  /** Coulomb friction limit (tacky inverted rubber can exceed 1). */
  friction: number;
  /** Tangential restitution: 0 = ball leaves rolling, >0 = elastic "overspin" from the topsheet. */
  tangentialRestitution: number;
}

export const RUBBERS: Record<string, Rubber> = {
  inverted: { id: 'inverted', name: 'Standard Build', kind: 'Inverted', restitution: 0.86, restitutionSpeedLoss: 0.006, friction: 1.1, tangentialRestitution: 0.3 },
  shortPips: { id: 'shortPips', name: 'Hotfix', kind: 'Short pips', restitution: 0.88, restitutionSpeedLoss: 0.006, friction: 0.55, tangentialRestitution: 0.05 },
  longPips: { id: 'longPips', name: 'Legacy Code', kind: 'Long pips', restitution: 0.72, restitutionSpeedLoss: 0.008, friction: 0.1, tangentialRestitution: 0 },
  anti: { id: 'anti', name: 'Air Gap', kind: 'Anti-spin', restitution: 0.62, restitutionSpeedLoss: 0.01, friction: 0.04, tangentialRestitution: 0 },
};

/** Blade face, approximated as a disc. ITTF has no size rule; typical blades are ~15 × 16 cm. */
export const PADDLE = Object.freeze({ radius: 0.078, thickness: 0.012 });

export interface PaddlePose {
  /** Centre of the blade face. */
  pos: Vec3;
  /** Unit normal of the hitting face (points toward where the ball should go). */
  normal: Vec3;
  /** Linear velocity of the blade, m/s. */
  vel: Vec3;
}

const INERTIA = (2 / 3) * BALL.mass * BALL.radius * BALL.radius;

/**
 * Apply a paddle hit to the ball. The paddle is treated as infinitely heavy
 * (the arm is far heavier than a 2.7 g ball). Mutates `s`.
 * Returns the normal impact speed, or 0 if the ball wasn't approaching the face.
 */
export function paddleImpulse(s: BallState, paddle: PaddlePose, rubber: Rubber): number {
  const n = paddle.normal;
  const vRel = sub(s.vel, paddle.vel);
  const vn = dot(vRel, n);
  if (vn >= 0) return 0;

  const m = BALL.mass;
  const e = Math.max(0.3, rubber.restitution - rubber.restitutionSpeedLoss * -vn);
  const jn = -(1 + e) * m * vn;

  const rc = scale(n, -BALL.radius);
  const vContact = add(vRel, cross(s.spin, rc));
  const slip = sub(vContact, scale(n, dot(vContact, n)));
  const slipSpeed = length(slip);

  let impulse = scale(n, jn);
  if (slipSpeed > 1e-9) {
    // Impulse that would bring the slip to −e_t × slip (hollow sphere: Δslip = (5/2m) J).
    const jStick = 0.4 * m * (1 + rubber.tangentialRestitution) * slipSpeed;
    const jt = Math.min(rubber.friction * jn, jStick);
    impulse = addScaled(impulse, slip, -jt / slipSpeed);
  }
  s.vel = addScaled(s.vel, impulse, 1 / m);
  s.spin = addScaled(s.spin, cross(rc, impulse), 1 / INERTIA);
  return -vn;
}

/**
 * Geometric contact test between the ball and a paddle disc.
 * `extraRadius` widens the hittable area (an accessibility / arcade assist).
 * Returns the face normal that should be used (flipped if the ball is behind the
 * face) or null if there is no contact.
 */
export function paddleContact(ball: Vec3, paddle: PaddlePose, extraRadius = 0): Vec3 | null {
  const d = sub(ball, paddle.pos);
  const along = dot(d, paddle.normal);
  if (Math.abs(along) > BALL.radius + PADDLE.thickness / 2) return null;
  const inPlane = sub(d, scale(paddle.normal, along));
  if (length(inPlane) > PADDLE.radius + extraRadius) return null;
  return along >= 0 ? paddle.normal : scale(paddle.normal, -1);
}
