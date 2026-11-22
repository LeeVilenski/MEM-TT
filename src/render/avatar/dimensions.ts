import * as THREE from 'three';

/**
 * Body measurements shared by the rig (which poses the joints) and the body (which
 * draws round them). Heights are for a standing character of height scale 1, in
 * metres; the whole character is scaled by its look's height.
 */
/** Hip height: the legs swing from here and the upper body twists and leans about it. */
export const HIP = 0.83;
/** Shoulder joint height. */
export const SHOULDER_Y = 1.375;
/** Reactions to a point, played for this long (s). */
export const REACT_TIME = 1.5;
/** Racket arm: upper arm and forearm (to the grip) lengths, m. */
export const UPPER = 0.3;
export const FORE = 0.31;
/** Longest the racket arm may stretch (shoulder to handle, m): a little past straight. */
export const ARM_MAX = 0.84;
/** Shoulder to hand within this, the body doesn't need to reach. */
export const COMFORT = 0.6;
/** Leg segments. */
export const THIGH = 0.42;
export const SHIN = 0.37;
/** Seated (wheelchair): how far the hips sit below standing hip height, m. */
export const SEAT_DROP = 0.31;
/** Wheelchair rear wheel radius, m. */
export const WHEEL_R = 0.3;

/** Wheelchair geometry: half the rear track (hub x), front caster radius. */
export const TRACK = 0.3;
export const CASTER_R = 0.035;
/** Hip joints: half the distance between them, for build 1 (m). */
export const HIP_X = 0.085;
/** Half the torso's width and depth at the chest for a build (m). */
export const torsoHalfWidth = (build: number) => 0.17 * build;
export const torsoHalfDepth = (build: number) => 0.112 * Math.sqrt(build);
/** Shoulder joint: out from the middle of the chest (m). */
export const shoulderOffset = (build: number) => torsoHalfWidth(build) + 0.025;
/**
 * The head joint (top of the neck), on the standing body. Everything on the head (face,
 * hair, glasses, cap) hangs from here, so the head can turn and nod as one piece.
 */
export const HEAD_PIVOT = new THREE.Vector3(0, 1.55, 0);
/** The middle of the head (the procedural head is built round this), on the standing body. */
export const HEAD_Y = 1.615;

