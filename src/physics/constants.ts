/**
 * World conventions (SI units: metres, seconds, kilograms, radians):
 *   +y is up. The table's long axis is z, the net sits at z = 0.
 *   The "near" end (player / camera side) is +z, the "far" end is -z.
 *   x runs across the table width.
 *
 * Dimensions follow ITTF regulations.
 */
export const TABLE = Object.freeze({
  length: 2.74,
  width: 1.525,
  height: 0.76,
  /** Half extents of the playing surface. */
  halfLength: 1.37,
  halfWidth: 0.7625,
  thickness: 0.025,
});

export const NET = Object.freeze({
  height: 0.1525,
  /** Net extends 15.25 cm beyond each sideline: total length 1.83 m. */
  halfLength: 0.915,
  top: TABLE.height + 0.1525,
});

export const BALL = Object.freeze({
  radius: 0.02,
  mass: 0.0027,
});

export const AIR_DENSITY = 1.2; // kg/m^3
export const GRAVITY = 9.81;

/**
 * Tunable physics parameters. These are exposed in the sandbox UI so the feel
 * can be tuned against real-world reference values; the defaults are taken
 * from table tennis aerodynamics literature and slow-motion footage.
 */
export interface PhysicsParams {
  /** Drag coefficient. ~0.40–0.50 for a 40 mm ball; gives ~8.5 m/s terminal velocity. */
  dragCoefficient: number;
  /** Max lift (Magnus) coefficient, reached at high spin ratio. */
  liftCoefficientMax: number;
  /** Spin ratio S = r·ω/v at which lift reaches half its max. */
  liftHalfSpinRatio: number;
  /** Exponential spin decay rate in the air (1/s). */
  spinDecay: number;
  /** Coefficient of restitution of ball on table at low impact speed. */
  tableRestitution: number;
  /** Restitution drop per m/s of normal impact speed (harder hits bounce relatively lower). */
  tableRestitutionSpeedLoss: number;
  /** Base ball–table friction coefficient. */
  tableFriction: number;
  /**
   * "Spin bite": extra friction per m/s of contact-point slip. Pure Coulomb friction
   * makes a fully-sliding bounce ignore spin; real balls deform and grip harder the
   * faster the surface slips, which is what makes backspin check up and topspin kick.
   */
  tableSpinBite: number;
  /** Upper limit on effective friction. */
  tableFrictionMax: number;
  /**
   * Gameplay: the least of its forward (horizontal) speed a ball keeps through a table
   * bounce, as a fraction of the incoming speed. 0 = pure physics, where heavy backspin
   * on a slow, steep ball can stop it dead or send it back over the net.
   */
  tableBounceKeep: number;
  /** Restitution of the ball against the net mesh / tape. */
  netRestitution: number;
  /** Fraction of tangential velocity kept when brushing the net. */
  netTangentialKeep: number;
  floorRestitution: number;
  floorFriction: number;
}

export const DEFAULT_PARAMS: PhysicsParams = {
  dragCoefficient: 0.45,
  liftCoefficientMax: 0.33,
  liftHalfSpinRatio: 0.9,
  spinDecay: 0.25,
  tableRestitution: 0.93,
  tableRestitutionSpeedLoss: 0.012,
  tableFriction: 0.25,
  tableSpinBite: 0.025,
  tableFrictionMax: 0.7,
  tableBounceKeep: 0,
  netRestitution: 0.15,
  netTangentialKeep: 0.6,
  floorRestitution: 0.75,
  floorFriction: 0.35,
};

/** Physics tick rate for the authoritative simulation. */
export const TICK_HZ = 240;
export const TICK_DT = 1 / TICK_HZ;
/** Collision sub-steps keep per-step travel below this distance (no tunnelling through the net). */
export const MAX_SUBSTEP_TRAVEL = 0.005;
