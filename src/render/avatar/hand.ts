import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * Hands: a palm, four fingers of three joints each and a thumb, posed once and merged
 * into one mesh (the fingers don't move during play, so a hand costs one draw call).
 *
 * Hand frame (a right hand; a left hand is the mirror image): the wrist at the origin,
 * the fingers along +y, the palm facing +z, the thumb on the +x side.
 */

/** Curl of one finger's three joints (knuckle, middle, tip), rad; + curls toward the palm. */
type Curl = [number, number, number];
type V3 = [number, number, number];

export interface HandPose {
  /** Index, middle, ring, little finger. */
  fingers: [Curl, Curl, Curl, Curl];
  /** Each finger's sideways turn at the knuckle (rad; + toward the thumb). */
  splay: [number, number, number, number];
  /** The thumb's two bones, as directions in the hand frame (from the heel of the thumb out). */
  thumb: [V3, V3];
}

/**
 * Holding the bat: middle, ring and little fingers wrapped round the handle (their curls
 * solved to fit it), the index along the back of the blade, the thumb on the forehand rubber.
 */
export const GRIP: HandPose = {
  fingers: [
    [0.12, 0.12, 0.1],
    [0.45, 1.65, 0.7],
    [0.65, 1.65, 0.6],
    [0.8, 1.15, 0.9],
  ],
  splay: [0.75, 0.05, -0.02, -0.08],
  thumb: [
    [0.12, 0.72, 0.68],
    [0.35, 0.88, 0.3],
  ],
};

/** Hanging loose: fingers gently curled, thumb beside them. */
export const RELAXED: HandPose = {
  fingers: [
    [0.25, 0.4, 0.2],
    [0.32, 0.5, 0.25],
    [0.38, 0.55, 0.28],
    [0.45, 0.6, 0.3],
  ],
  splay: [0.09, 0.03, -0.03, -0.09],
  thumb: [
    [0.5, 0.78, 0.38],
    [0.3, 0.85, 0.45],
  ],
};

/** Round something like a bottle: all four fingers wrapped, thumb across. */
export const HOLD: HandPose = {
  fingers: [
    [1.1, 1.25, 0.6],
    [1.15, 1.3, 0.65],
    [1.2, 1.3, 0.65],
    [1.25, 1.3, 0.6],
  ],
  splay: [0.06, 0.02, -0.02, -0.06],
  thumb: [
    [0.25, 0.65, 0.72],
    [-0.35, 0.55, 0.75],
  ],
};

/** Knuckle positions and the length and thickness of each finger's three bones (m). */
const FINGERS = [
  { x: 0.026, y: 0.094, len: [0.042, 0.025, 0.021], r: 0.0092 },
  { x: 0.009, y: 0.097, len: [0.046, 0.028, 0.022], r: 0.0095 },
  { x: -0.009, y: 0.094, len: [0.043, 0.026, 0.021], r: 0.009 },
  { x: -0.025, y: 0.087, len: [0.034, 0.021, 0.019], r: 0.0082 },
];
/** Where the thumb leaves the palm, and its two bones. */
const THUMB = { base: new THREE.Vector3(0.031, 0.045, 0.016), len: [0.036, 0.028], r: 0.0112 };
/**
 * Where something held lies in the hand: on the palm side, just past the knuckles, the
 * long way across the hand (along x). The grip is built round this point.
 */
export const HELD = new THREE.Vector3(0.0, 0.1, 0.028);

/** A rounded segment of length `len` along +y from the origin. */
const bone = (r: number, len: number, tipR = r * 0.92) => {
  const g = new THREE.CylinderGeometry(tipR, r, len, 10, 1, true).translate(0, len / 2, 0);
  return g;
};

/**
 * The hand in a pose, as one geometry in the hand frame (right hand; mirror it for a left
 * hand). `size` scales it (1 for an adult of about 1.75 m).
 */
export function handGeometry(pose: HandPose, size = 1): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const put = (g: THREE.BufferGeometry, m: THREE.Matrix4) => {
    g.applyMatrix4(m);
    parts.push(g);
  };

  // Palm: a rounded slab, narrower at the wrist; and the heel of the thumb.
  const palm = new RoundedBoxGeometry(0.078, 0.092, 0.028, 3, 0.011);
  const pos = palm.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i); // −0.046 … 0.046
    const k = 0.78 + 0.22 * ((y + 0.046) / 0.092);
    pos.setX(i, pos.getX(i) * k);
    // Slightly cupped: the middle of the palm a touch thinner.
    pos.setZ(i, pos.getZ(i) * (1 - 0.15 * Math.exp(-(pos.getX(i) ** 2) / 0.0006)));
  }
  palm.computeVertexNormals();
  put(palm, new THREE.Matrix4().makeTranslation(0, 0.05, 0));
  const thenar = new THREE.SphereGeometry(0.022, 12, 10);
  put(thenar, new THREE.Matrix4().compose(new THREE.Vector3(0.019, 0.035, 0.008), new THREE.Quaternion(), new THREE.Vector3(0.85, 1.25, 0.75)));
  // Wrist: a short rounded piece that meets the forearm.
  put(new THREE.SphereGeometry(0.028, 12, 10), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.006, 0), new THREE.Quaternion(), new THREE.Vector3(1.05, 0.7, 0.72)));

  // Fingers: a chain of joints from each knuckle, curling about x (toward the palm, +z).
  FINGERS.forEach((f, i) => {
    const curl = pose.fingers[i];
    const m = new THREE.Matrix4().makeTranslation(f.x, f.y, 0);
    m.multiply(new THREE.Matrix4().makeRotationZ(-pose.splay[i]));
    let r = f.r;
    for (let j = 0; j < 3; j++) {
      m.multiply(new THREE.Matrix4().makeRotationX(curl[j]));
      const len = f.len[j];
      const tip = r * 0.9;
      put(bone(r, len, tip), m.clone());
      // A knuckle (or the fingertip) rounding off the joint.
      put(new THREE.SphereGeometry(j === 2 ? tip : r * 1.02, 10, 8), m.clone());
      m.multiply(new THREE.Matrix4().makeTranslation(0, len, 0));
      if (j === 2) put(new THREE.SphereGeometry(tip, 10, 8), m.clone());
      r = tip;
    }
  });

  // Thumb: two bones out from the heel of the hand, each along its direction.
  {
    const at = THUMB.base.clone();
    let r = THUMB.r;
    pose.thumb.forEach((d, j) => {
      const dir = new THREE.Vector3(...d).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
      const tip = r * 0.9;
      const m = new THREE.Matrix4().compose(at, q, new THREE.Vector3(1, 1, 1));
      put(bone(r, THUMB.len[j], tip), m);
      put(new THREE.SphereGeometry(r, 10, 8), new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
      at.addScaledVector(dir, THUMB.len[j]);
      if (j === 1) put(new THREE.SphereGeometry(tip, 10, 8), new THREE.Matrix4().makeTranslation(at.x, at.y, at.z));
      r = tip;
    });
  }

  // Every piece the same layout (non-indexed, position/normal/uv) so they merge.
  const flat = parts.map((p) => (p.index ? p.toNonIndexed() : p));
  const geo = mergeGeometries(flat);
  parts.forEach((p) => p.dispose());
  flat.forEach((p) => p.dispose());
  if (!geo) throw new Error('hand: pieces did not merge');
  if (size !== 1) geo.scale(size, size, size);
  return geo;
}

/**
 * How a right hand holds the bat, in the bat's frame (x across the blade, y up the handle
 * toward the blade, z out of the forehand rubber; origin the middle of the handle):
 * `rotation` turns the hand frame into the bat's, and `wrist` is where the wrist is. A
 * left hand is the mirror image across the bat's x.
 *
 * The handle runs across the fingers (thumb toward the blade); the palm faces the
 * forehand rubber; the forearm comes in at an angle below the blade.
 */
export function batGrip() {
  // Thumb up the handle (hand x → bat y), fingers round the back (hand y → bat −x), palm
  // on the forehand side (hand z → bat z); then tipped so the handle lies diagonally
  // across the palm, from the heel of the hand to the index knuckle.
  const rotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2);
  rotation.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.55));
  const wrist = HELD.clone().applyQuaternion(rotation).negate();
  return { rotation, wrist };
}
