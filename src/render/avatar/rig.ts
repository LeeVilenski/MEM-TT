import * as THREE from 'three';
import {
  ARM_MAX,
  CASTER_R,
  COMFORT,
  EYE,
  FORE,
  HEAD_PIVOT,
  HEAD_Y,
  HIP,
  HIP_X,
  REACT_TIME,
  SEAT_DROP,
  SHIN,
  SHOULDER_Y,
  THIGH,
  TRACK,
  UPPER,
  WHEEL_R,
  shoulderOffset,
} from './dimensions';
import { batGrip } from './hand';

/**
 * The character's skeleton and everything that moves it: a hierarchy of joints (plain
 * groups) and the procedural animation that poses them each frame. Nothing here draws:
 * body.ts and head.ts hang meshes on the joints, so the look can change (or be swapped
 * for a skinned mesh, or a head made in Blender) without touching the animation.
 *
 * Joints, as the character faces local −z with its right hand at +x:
 *
 *   root                    floor point under the character; turns to face the table
 *   ├─ upper                hips pivot: the upper body twists, leans and bends here
 *   │  └─ upperAbs          (offset so its children use heights on the standing body)
 *   │     ├─ head           top of the neck (HEAD_PIVOT); turns to look at the gaze point
 *   │     │  └─ eyes[0..1]  left then right eyeball middles (EYE): the irises look
 *   │     ├─ arm            racket arm: upper (shoulder) → fore (elbow) → hand (grip)
 *   │     └─ free           free arm, the same chain
 *   ├─ legs[0..1]           left then right: hip → knee → foot (ankle)
 *   └─ pelvis               moves with the legs, not the twisting upper body
 *
 * Seated characters put the legs and pelvis on a `chair` joint (which turns as they
 * wheel about), with spinning wheels, swivelling casters and a push arm on the rim.
 *
 * Arm conventions: the racket arm's segments point along +y, solved each frame so the
 * hand holds the paddle handle: the arm reaches for the wrist, and the hand joint takes
 * the bat's orientation (x across the blade, y up the handle, z out of the forehand
 * rubber). The bones can stretch past straight for a ball out of reach: read the lengths
 * from fore.position.y and hand.position.y. The free arm hangs along −y at fixed lengths.
 */

export type Reaction = 'celebrate' | 'dismay';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Frame-rate independent approach of `cur` to `target` (rate per second). */
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const NEG_Y = new THREE.Vector3(0, -1, 0);
/** Shortest signed difference between two angles. */
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Push stroke on the hand rim: from behind the top (θ < 0) round to the front (θ > 0), rad. */
const PUSH_FROM = -0.6;
const PUSH_TO = 0.5;

/**
 * One arm: shoulder, elbow and hand joints, each a child of the one before, plus helper
 * bones that only shape the skin: `upperStretch` and `foreStretch` (children of the
 * shoulder and elbow) stretch along their bones when the arm reaches past straight, and
 * `twist` (three, children of the elbow) share the forearm's turn out along it, a third
 * each, so the wrist doesn't pinch.
 */
export interface ArmJoints {
  upper: THREE.Bone;
  fore: THREE.Bone;
  hand: THREE.Bone;
  upperStretch: THREE.Bone;
  foreStretch: THREE.Bone;
  twist: [THREE.Bone, THREE.Bone, THREE.Bone];
}

export interface LegJoints {
  hip: THREE.Bone;
  knee: THREE.Bone;
  foot: THREE.Bone;
}

/** How many twist helpers share the forearm's turn, and the most they turn in all (rad). */
const TWIST_MAX = 2.6;

/** What to pose to, besides the body and hand positions. */
export interface PoseInput {
  /** The time in seconds (defaults to the clock; pass one for a repeatable pose). */
  now?: number;
  /** A world point to look at (the ball); none: look ahead, down the table. */
  gaze?: THREE.Vector3 | null;
  /**
   * How the bat is held, as its world orientation: x across the blade, y up the handle
   * toward the blade, z out of the forehand rubber (see gripQuaternion in playerView.ts).
   * None: blade up, forehand facing ahead.
   */
  grip?: THREE.Quaternion | null;
}

/** Where the wrist is in the bat's frame, for a right hand (hand.ts). */
const WRIST_IN_BAT = batGrip().wrist;
/** The default bat: blade up, the forehand rubber facing ahead (local −z). */
const BAT_AHEAD = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);

export interface RigOptions {
  /** Torso width scale (sets how far apart the shoulders and hips are). */
  build: number;
  seated: boolean;
  /** +1 right-handed (bat at local +x), −1 left. */
  batHand: 1 | -1;
  /** A ponytail tied here (head-centre frame, m): it gets a bone that swings. */
  ponytail?: THREE.Vector3;
}

/** Ready stance: half the distance between the ankles (m), and the bat-side foot this far back. */
const STANCE_X = 0.19;
const STANCE_BACK = 0.07;
/** A foot steps once it's this far from where it should be (m). */
const STEP_AT = 0.11;
/** Ankle height above the floor when standing (m). */
const ANKLE_Y = HIP - THIGH - SHIN;
/** Toes turned out (rad). */
const TOE_OUT = 0.28;

/** One foot's footwork: where it's planted (world), and a step in progress. */
interface FootState {
  plant: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  /** 0..1 through a step, or −1 standing. */
  t: number;
  dur: number;
}

const arm = (): ArmJoints => {
  const upper = new THREE.Bone();
  const fore = new THREE.Bone();
  const hand = new THREE.Bone();
  const upperStretch = new THREE.Bone();
  const foreStretch = new THREE.Bone();
  const twist: [THREE.Bone, THREE.Bone, THREE.Bone] = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()];
  upper.add(fore, upperStretch);
  fore.add(hand, foreStretch, ...twist);
  return { upper, fore, hand, upperStretch, foreStretch, twist };
};

export class AvatarRig {
  readonly group = new THREE.Group();
  /** Upper body, pivoting at the hips (twist into strokes, lean, reactions). */
  readonly upper = new THREE.Bone();
  /** Inside `upper`, offset so its children use absolute heights. */
  readonly upperAbs = new THREE.Bone();
  /** Top of the neck: the head and everything on it. */
  readonly head = new THREE.Bone();
  /** Eyeballs, left then right: they turn to look, a step ahead of the head. */
  readonly eyes = [new THREE.Bone(), new THREE.Bone()];
  readonly legs: LegJoints[] = [];
  /** Racket arm (solved to the paddle handle) and the free arm (posed). */
  readonly arm = arm();
  readonly free = arm();
  /** Hips and waistband: follows the legs' bend and hop. */
  readonly pelvis = new THREE.Bone();
  /** A ponytail's root (if any): swings with the head's movement. */
  readonly ponytail: THREE.Bone | null = null;
  /** Chair, legs and hips: turns (yaws) as she wheels about, under the upper body. */
  readonly chair = new THREE.Group();
  /** Rear wheels, left then right: spin group (rolls) and camber group (the push rim's frame). */
  readonly wheelSpin: THREE.Group[] = [];
  readonly wheelCamber: THREE.Group[] = [];
  /** Front casters: swivel pivot (trails the travel), wheel spin and its local x. */
  readonly casters: { pivot: THREE.Group; spin: THREE.Group; x: number; roll: number }[] = [];
  readonly shoulderX: number;
  /** Hip joints: out from the middle (m). */
  private hipX: number;
  /** Seated in a wheelchair (lower body, legs on the footplate, wheels that roll). */
  readonly seated: boolean;
  /**
   * Standing about rather than playing (a spectator): upright, knees nearly straight, no
   * ready bounce, and no turning into a stroke.
   */
  relaxed = false;
  /** Bat hand: +1 right (local +x), −1 left. */
  readonly batHand: 1 | -1;
  private wheelRoll = [0, 0];
  /** Chair heading relative to facing the table (rad, + turns left). */
  private chairYaw = 0;
  /** Smoothed body velocity in the character frame (m/s). */
  private vel = { x: 0, z: 0 };
  /** Free hand pushing the rim: blend weight, angle on the rim, and recovery stroke. */
  private push = { w: 0, theta: 0, lift: 0, rec: -1, recFrom: 0, recTo: 0, wheel: 0 };

  constructor(o: RigOptions) {
    this.seated = o.seated;
    this.batHand = o.batHand;
    this.shoulderX = shoulderOffset(o.build);
    this.hipX = HIP_X * o.build;
    this.upper.position.y = HIP;
    this.upperAbs.position.y = -HIP;
    this.upper.add(this.upperAbs);
    this.group.add(this.upper);
    this.head.position.copy(HEAD_PIVOT);
    if (o.ponytail) {
      const tail = new THREE.Bone();
      tail.name = 'ponytail';
      tail.position.set(o.ponytail.x, HEAD_Y + o.ponytail.y - HEAD_PIVOT.y, o.ponytail.z);
      this.head.add(tail);
      this.ponytail = tail;
    }
    this.eyes.forEach((eye, i) => {
      eye.position.set((i === 0 ? -1 : 1) * EYE.x, EYE.y, EYE.z).sub(HEAD_PIVOT);
      this.head.add(eye);
    });
    this.upperAbs.add(this.head, this.arm.upper, this.free.upper);
    // The free arm hangs down at its full length.
    this.free.fore.position.y = -UPPER;
    this.free.hand.position.y = -FORE;
    // Legs: hip → knee → ankle, each joint a group so the stance can bend.
    for (const x of [-HIP_X, HIP_X]) {
      const hip = new THREE.Bone();
      hip.position.set(x * o.build, HIP, 0);
      const knee = new THREE.Bone();
      knee.position.y = -THIGH;
      const foot = new THREE.Bone();
      foot.position.y = -SHIN;
      hip.add(knee);
      knee.add(foot);
      (o.seated ? this.chair : this.group).add(hip);
      this.legs.push({ hip, knee, foot });
    }
    this.nameJoints();
    if (o.seated) {
      this.chair.add(this.pelvis);
      this.group.add(this.chair);
      this.buildChairJoints();
    } else this.group.add(this.pelvis);
  }

  /** Names for the joints (they show in Blender's outliner when a character is exported). */
  private nameJoints() {
    const lr = (s: number) => (s < 0 ? 'L' : 'R');
    const bat = lr(this.batHand);
    const freeSide = lr(-this.batHand);
    this.group.name = 'avatar';
    this.upper.name = 'spine';
    this.upperAbs.name = 'spine_offset';
    this.head.name = 'head';
    this.eyes[0].name = 'eye_L';
    this.eyes[1].name = 'eye_R';
    this.pelvis.name = 'pelvis';
    this.chair.name = 'chair';
    for (const [arm, side] of [[this.arm, bat], [this.free, freeSide]] as const) {
      arm.upper.name = `shoulder_${side}`;
      arm.fore.name = `elbow_${side}`;
      arm.hand.name = `hand_${side}`;
      arm.upperStretch.name = `upperarm_stretch_${side}`;
      arm.foreStretch.name = `forearm_stretch_${side}`;
      arm.twist.forEach((b, i) => (b.name = `forearm_twist${i + 1}_${side}`));
    }
    this.legs.forEach((leg, i) => {
      const side = i === 0 ? 'L' : 'R';
      leg.hip.name = `hip_${side}`;
      leg.knee.name = `knee_${side}`;
      leg.foot.name = `ankle_${side}`;
    });
  }

  /** The wheelchair's moving parts: cambered rear wheels that roll, and front casters that swivel. */
  private buildChairJoints() {
    for (const sx of [-1, 1]) {
      const x = sx * 0.2;
      // Front caster: a fork that swivels to trail the direction of travel, and a small wheel.
      const pivot = new THREE.Group();
      pivot.position.set(x * 0.85, 0.13, -0.5);
      const spin = new THREE.Group();
      spin.position.set(0, CASTER_R - 0.13, 0.03);
      pivot.add(spin);
      this.chair.add(pivot);
      this.casters.push({ pivot, spin, x: x * 0.85, roll: 0 });
      // Rear wheel: cambered (tops lean in); the spin group rolls inside the camber.
      const camber = new THREE.Group();
      camber.position.set(sx * TRACK, WHEEL_R, 0.02);
      camber.rotation.z = sx * 0.14;
      const wheel = new THREE.Group();
      camber.add(wheel);
      this.chair.add(camber);
      this.wheelSpin.push(wheel);
      this.wheelCamber.push(camber);
    }
  }

  /**
   * Pose the character. body: floor position; hand: world position of the paddle
   * handle; facingNegZ: true for a player at the near end looking down the table;
   * now: the time in seconds (a fixed clock gives a repeatable pose).
   */
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean, input: PoseInput = {}) {
    const now = input.now ?? performance.now() / 1000;
    const dt = this.lastTime === null ? 0 : clamp(now - this.lastTime, 0, 0.1);
    this.lastTime = now;
    this.group.rotation.y = facingNegZ ? 0 : Math.PI;
    this.group.position.set(body.x, 0, body.z);
    this.group.updateMatrixWorld();
    const local = this.group.worldToLocal(hand.clone());
    // The bat stays in one hand (right is +x: the character faces local −z): backhands
    // are played across the body rather than swapping the bat to the other hand.
    const side = this.batHand;
    this.lastFreeSide = -side;
    this.animate(dt, now, body, local, side);
    this.group.updateMatrixWorld(true);
    this.look(dt, input.gaze ?? null);
    this.swingTail(dt);
    // The bat in the character's frame, and the wrist that holds it there.
    const groupQ = this.group.getWorldQuaternion(new THREE.Quaternion());
    const bat = input.grip ? groupQ.clone().invert().multiply(input.grip) : BAT_AHEAD.clone();
    const wrist = new THREE.Vector3(side * WRIST_IN_BAT.x, WRIST_IN_BAT.y, WRIST_IN_BAT.z).applyQuaternion(bat).add(local);
    this.solveArm(wrist, side);
    // The hand turns to the bat (its frame is the bat's; body.ts places the fingers round the handle).
    this.arm.fore.updateWorldMatrix(true, false);
    const foreQ = this.arm.fore.getWorldQuaternion(new THREE.Quaternion());
    this.arm.hand.quaternion.copy(foreQ.invert().multiply(groupQ).multiply(bat));
    this.shapeArm();
    if (this.seated && this.push.w > 0.01) this.solvePushArm(-side);
  }

  /** The hand's turn in the forearm when the forearm isn't twisted (palm in, thumb forward): see rest(). */
  private neutralHand?: THREE.Quaternion;
  /** The forearm's twist last frame (rad), to follow it smoothly past a half turn. */
  private forearmTwist = 0;

  /**
   * The racket arm's helper bones: stretch the skin along the bones the solver lengthened,
   * and share the hand's turn about the forearm out along it (the twist bones), so the
   * skin twists like a forearm rather than pinching at the wrist.
   */
  private shapeArm() {
    const a = this.arm;
    a.upperStretch.scale.y = a.fore.position.y / UPPER;
    const fore = a.hand.position.y / FORE;
    a.foreStretch.scale.y = fore;
    // The twist: the hand's turn about the forearm (local y), measured from neutral.
    this.neutralHand ??= this.restHand();
    const r = a.hand.quaternion.clone().multiply(this.neutralHand.clone().invert());
    let tw = 2 * Math.atan2(r.y, r.w);
    tw = this.forearmTwist + angleDiff(tw, this.forearmTwist);
    tw = clamp(tw, -TWIST_MAX, TWIST_MAX);
    this.forearmTwist = tw;
    a.twist.forEach((b, i) => {
      b.rotation.set(0, (tw * (i + 1)) / a.twist.length, 0);
      b.scale.y = fore;
    });
  }

  /** The racket hand's resting turn in the forearm (see rest()). */
  private restHand() {
    // Fingers down the arm, palm to the thigh, thumb forward; its joint takes a bat's frame.
    const hang = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0), new THREE.Vector3(1, 0, 0)),
    );
    const held = hang.multiply(batGrip().rotation.invert());
    // A left hand is the mirror image (mirroring across x keeps x and negates y and z).
    if (this.batHand < 0) held.set(held.x, -held.y, -held.z, held.w);
    return held;
  }

  /** Every bone, for binding a skinned mesh. */
  bones(): THREE.Bone[] {
    const out: THREE.Bone[] = [];
    this.group.traverse((o) => (o as THREE.Bone).isBone && out.push(o as THREE.Bone));
    return out;
  }

  /**
   * Seated: the free hand grips the hand rim of the wheel on its side and pushes it
   * round (a two-bone reach to a point on the rim), blended over the posed arm.
   */
  private solvePushArm(fs: number) {
    const p = this.push;
    const camber = this.wheelCamber[fs < 0 ? 0 : 1];
    const r = WHEEL_R - 0.05;
    // On the rim (just outside it, where the fingers wrap), lifted off it during the recovery.
    const onRim = new THREE.Vector3(fs * (0.065 + p.lift * 0.05), r * Math.cos(p.theta) + p.lift * 0.07, -r * Math.sin(p.theta));
    const t = this.upperAbs.worldToLocal(camber.localToWorld(onRim));
    const shoulder = new THREE.Vector3(fs * this.shoulderX, SHOULDER_Y, 0);
    const l1 = UPPER;
    const l2 = FORE;
    const d = t.sub(shoulder);
    const dist = clamp(d.length(), 0.15, l1 + l2 - 1e-4);
    const dir = d.normalize();
    // Elbows out and back, as when pushing a wheelchair.
    const pole = new THREE.Vector3(fs * 0.5, 0.1, 1);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(fs, 0, 0);
    pole.normalize();
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbowDir = dir.clone().multiplyScalar(cosA).addScaledVector(pole, sinA);
    const elbow = elbowDir.clone().multiplyScalar(l1);
    const handPos = dir.clone().multiplyScalar(dist);
    const qU = new THREE.Quaternion().setFromUnitVectors(NEG_Y, elbowDir);
    const foreDir = handPos.sub(elbow).normalize().applyQuaternion(qU.clone().invert());
    const qF = new THREE.Quaternion().setFromUnitVectors(NEG_Y, foreDir);
    this.free.upper.quaternion.slerp(qU, p.w);
    this.free.fore.quaternion.slerp(qF, p.w);
  }

  /**
   * Two-bone arm: the shoulder on the paddle side, the elbow bent out and down, the
   * hand on the handle. Beyond full reach the arm straightens and stretches slightly.
   */
  private solveArm(target: THREE.Vector3, side: number) {
    const a = this.arm;
    const shoulderLocal = new THREE.Vector3(side * this.shoulderX, SHOULDER_Y, 0);
    a.upper.position.copy(shoulderLocal);
    // Work in upperAbs space (the arm is parented there).
    const t = this.upperAbs.worldToLocal(this.group.localToWorld(target.clone()));
    const d = t.clone().sub(shoulderLocal);
    const dist = Math.max(1e-4, d.length());
    const dir = d.clone().divideScalar(dist);
    const reach = UPPER + FORE;
    const stretch = clamp(dist / reach, 1, ARM_MAX / reach);
    const l1 = UPPER * stretch;
    const l2 = FORE * stretch;
    const dd = Math.min(dist, l1 + l2 - 1e-4);
    // Elbow bends outward, down and a little back; reaching across the body for a
    // backhand, it comes round in front of the chest instead.
    const across = clamp((side * (shoulderLocal.x - t.x) - 0.05) / 0.35, 0, 1);
    const ac = across * across * (3 - 2 * across);
    const pole = new THREE.Vector3(side * (0.7 - 0.4 * ac), -1 + 0.5 * ac, 0.35 - 1.35 * ac);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(side, 0, 0);
    pole.normalize();
    const cosA = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = shoulderLocal.clone().addScaledVector(dir, cosA * l1).addScaledVector(pole, sinA * l1);
    const handPos = shoulderLocal.clone().addScaledVector(dir, Math.min(dist, ARM_MAX));

    const upDir = elbow.clone().sub(shoulderLocal).normalize();
    a.upper.quaternion.setFromUnitVectors(Y_AXIS, upDir);
    a.fore.position.set(0, l1, 0);
    // Forearm direction, expressed in the upper arm's frame.
    const foreDirWorld = handPos.clone().sub(elbow).normalize();
    const inv = a.upper.quaternion.clone().invert();
    a.fore.quaternion.setFromUnitVectors(Y_AXIS, foreDirWorld.applyQuaternion(inv));
    const lf = handPos.distanceTo(elbow);
    a.hand.position.y = lf;
  }

  private lastTime: number | null = null;
  private lastBody: { x: number; z: number } | null = null;
  private lastHand: THREE.Vector3 | null = null;
  private stride = 0;
  private twist = 0;
  private lean = 0;
  private sideLean = 0;
  private reachLean = 0;
  private swingVel = 0;
  private reaction: { kind: Reaction; t: number } | null = null;
  /** Velocities for the critically damped springs below, by name. */
  private springVel: Record<string, number> = {};

  /**
   * Critically damped spring toward `target` (natural frequency `w`, rad/s): eases in
   * and out instead of snapping off at full speed the moment the target moves.
   */
  private spring(key: 'twist' | 'lean' | 'sideLean' | 'reachLean' | 'chairYaw' | 'headYaw' | 'headPitch' | 'hipYaw', target: number, w: number, dt: number) {
    const x = this[key];
    let v = this.springVel[key] ?? 0;
    if (dt <= 0) return x;
    // Sub-step so a long frame stays stable.
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    let y = x;
    for (let i = 0; i < n; i++) {
      v += (w * w * (target - y) - 2 * w * v) * h;
      y += v * h;
    }
    this.springVel[key] = v;
    return y;
  }

  /**
   * The rest pose: standing straight (or sitting square in the chair), head level, arms
   * hanging a little out from the sides, at the origin facing −z. It's the reference
   * exported for modelling (see docs/avatar-heads.md). With `standing`, seated characters
   * stand too, legs straight: the bind pose the skin is built in. Animation picks up from
   * here on the next update.
   */
  rest(opts: { standing?: boolean } = {}) {
    const seated = this.seated && !opts.standing;
    const hipY = seated ? HIP - SEAT_DROP : HIP;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.upper.position.set(0, hipY, 0);
    this.upper.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.pelvis.rotation.set(0, 0, 0);
    this.ponytail?.rotation.set(0, 0, 0);
    this.feet = null;
    this.lastFootBody = null;
    this.tailLast = null;
    for (const eye of this.eyes) eye.rotation.set(0, 0, 0);
    this.pelvis.position.set(0, hipY - HIP, 0);
    this.chair.rotation.y = 0;
    this.legs.forEach((leg, i) => {
      leg.hip.position.set((i === 0 ? -1 : 1) * this.hipX, hipY, 0);
      if (seated) {
        // As in animate(): thighs along the cushion, shins down to the footplate.
        leg.hip.rotation.set(Math.PI / 2 - 0.04, 0, (i === 0 ? -1 : 1) * 0.05);
        leg.knee.rotation.set(-Math.PI / 2 + 0.12, 0, 0);
        leg.foot.rotation.set(-0.05, 0, 0);
      } else {
        leg.hip.rotation.set(0, 0, 0);
        leg.knee.rotation.set(0, 0, 0);
        leg.foot.rotation.set(0, 0, 0);
      }
    });
    const out = 0.2; // arms angled out from the sides (rad)
    const s = this.batHand;
    // Racket arm (segments along +y): straight, full length, pointing down and out.
    const a = this.arm;
    a.upper.position.set(s * this.shoulderX, SHOULDER_Y, 0);
    a.upper.quaternion.setFromUnitVectors(Y_AXIS, new THREE.Vector3(s * Math.sin(out), -Math.cos(out), 0));
    a.fore.position.set(0, UPPER, 0);
    a.fore.quaternion.identity();
    a.hand.position.set(0, FORE, 0);
    // The racket hand hangs empty: fingers down the arm, palm to the thigh, thumb forward.
    a.hand.quaternion.copy(this.restHand());
    // Free arm (segments along −y): the same, on the other side.
    this.free.upper.position.set(-s * this.shoulderX, SHOULDER_Y, 0);
    this.free.upper.rotation.set(0, 0, -s * out);
    this.free.fore.rotation.set(0, 0, 0);
    // Helpers at rest: no stretch, no twist.
    for (const arm of [this.arm, this.free]) {
      for (const b of [arm.upperStretch, arm.foreStretch, ...arm.twist]) {
        b.rotation.set(0, 0, 0);
        b.scale.set(1, 1, 1);
      }
    }
    this.forearmTwist = 0;
    this.group.updateMatrixWorld(true);
  }

  private headYaw = 0;
  private headPitch = 0;
  /** Each eye's turn in the head (left, right): yaw and pitch. */
  private eyeAim = [
    { yaw: 0, pitch: 0 },
    { yaw: 0, pitch: 0 },
  ];

  /**
   * Look at the gaze point (the ball): the eyes get there first, the head follows with a
   * spring, within what a neck can turn. Measured from the upper body, so the head keeps
   * its eyes on the ball through the twist and lean of a stroke. With nothing to look at,
   * look ahead and a little down, as at the table. Reactions take over: chin up to
   * celebrate, head down in a slump.
   */
  private look(dt: number, gaze: THREE.Vector3 | null) {
    let yaw = 0;
    let pitch = -0.12;
    if (gaze) {
      const eyes = new THREE.Vector3(0, EYE.y, EYE.z);
      const d = this.upperAbs.worldToLocal(gaze.clone()).sub(eyes);
      // The character faces −z: turning left (+yaw) looks toward −x.
      yaw = Math.atan2(-d.x, -d.z);
      pitch = Math.atan2(d.y, Math.hypot(d.x, d.z));
    }
    const r = this.reaction;
    if (r) {
      const k = r.t / REACT_TIME;
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      const pose = r.kind === 'celebrate' ? { yaw: 0, pitch: 0.25 } : { yaw: 0, pitch: -0.45 };
      yaw += (pose.yaw - yaw) * fade;
      pitch += (pose.pitch - pitch) * fade;
    }
    const headYaw = clamp(yaw, -1.15, 1.15);
    const headPitch = clamp(pitch, -0.75, 0.5);
    this.headYaw = this.spring('headYaw', headYaw, 11, dt);
    this.headPitch = this.spring('headPitch', headPitch, 11, dt);
    this.head.rotation.set(this.headPitch, this.headYaw, 0, 'YXZ'); // +x tips the face up
    // The eyes make up the rest, each aimed on its own (so they converge on a near ball),
    // as far as they can turn in their sockets.
    let local: THREE.Vector3 | null = null;
    if (gaze && !r) {
      this.head.updateMatrixWorld(true);
      local = this.head.worldToLocal(gaze.clone());
    }
    this.eyes.forEach((eye, i) => {
      let y = 0;
      let p = 0;
      if (local) {
        const d = local.clone().sub(eye.position);
        y = clamp(Math.atan2(-d.x, -d.z), -0.35, 0.35);
        p = clamp(Math.atan2(d.y, Math.hypot(d.x, d.z)), -0.25, 0.25);
      }
      const aim = this.eyeAim[i];
      aim.yaw = approach(aim.yaw, y, 30, dt);
      aim.pitch = approach(aim.pitch, p, 30, dt);
      eye.rotation.set(aim.pitch, aim.yaw, 0, 'YXZ');
    });
  }

  /** Play a short reaction to a point: a jump and fist pump, or a slump. */
  react(kind: Reaction) {
    this.reaction = { kind, t: 0 };
  }

  /**
   * Procedural animation: shuffle steps when moving, a bouncy ready stance with bent
   * knees, the upper body turning into the stroke and leaning for low balls, and reactions.
   * `hand` is in the group's local frame (the character faces local −z).
   */
  private animate(dt: number, time: number, body: { x: number; z: number }, hand: THREE.Vector3, side: number) {
    // Footwork: speed drives a side-step shuffle.
    let speed = 0;
    if (this.lastBody && dt > 0) speed = Math.hypot(body.x - this.lastBody.x, body.z - this.lastBody.z) / dt;
    this.lastBody = { x: body.x, z: body.z };
    // Seated: the shoulders are lower, and moving wheels the chair about (no steps).
    const drop0 = this.seated ? SEAT_DROP : 0;
    if (this.seated) {
      this.wheelAbout(dt, body);
      speed = 0;
    }
    // How much the body is on the move (calms the ready bounce while stepping).
    this.stride = approach(this.stride, clamp(speed * 0.35, 0, 0.32), 12, dt);

    // Swing speed of the hand across the body (follow-through twists the torso).
    if (this.lastHand && dt > 0) this.swingVel = approach(this.swingVel, (hand.x - this.lastHand.x) / dt, 20, dt);
    this.lastHand = hand.clone();

    // Turn toward the paddle side and into the swing; lean over low or far-forward balls.
    // Backhands (bat across the body) turn the bat shoulder further round.
    const twistTarget = this.relaxed ? 0 : clamp(-hand.x * (hand.x * side < 0 ? 0.85 : 0.55) - this.swingVel * 0.05, -0.75, 0.75);
    this.twist = this.spring('twist', twistTarget, 11, dt);
    const reachDown = clamp((1.15 - drop0 - hand.y) * 0.5, 0, 0.3);
    const reachForward = clamp((-hand.z - 0.3) * 0.25, 0, 0.15);
    this.lean = this.spring('lean', this.relaxed ? 0.02 : 0.1 + reachDown + reachForward, 9, dt);

    // Reaching for a ball beyond the arm: bend sideways toward it and lean in.
    const sx = side * this.shoulderX;
    const far = Math.max(0, Math.hypot(hand.x - sx, hand.y - (SHOULDER_Y - drop0), hand.z) - COMFORT);
    const sideways = Math.min(1, Math.abs(hand.x - sx) / Math.max(0.01, Math.hypot(hand.x - sx, hand.z)));
    this.sideLean = this.spring('sideLean', -Math.sign(hand.x - sx || 1) * clamp(far * 1.5 * sideways, 0, 0.5), 12, dt);
    this.reachLean = this.spring('reachLean', clamp(far * 1.1 * (1 - sideways * 0.6), 0, 0.35), 12, dt);

    // Ready stance: knees bent, a light bounce on the toes.
    const bounce = this.relaxed ? 0 : Math.sin(time * Math.PI * 2 * 1.4) * (1 - this.stride * 2);
    let bend = this.relaxed ? 0.06 : 0.4 + this.lean * 0.3 + bounce * 0.03;
    // Breathing: a slow rise and fall of the chest.
    let lean = this.lean + 0.012 * Math.sin(time * Math.PI * 2 * 0.27);
    // Seated, the shoulders turn part of the way with the chair under them.
    let twist = this.twist + this.chairYaw * 0.5;
    let freeZ = this.relaxed ? 0.1 : 0.2 + this.stride * 0.6;
    let freeX = this.relaxed ? 0.08 : 0.35 + this.lean * 0.6; // free arm a little forward, for balance (hanging when relaxed)
    let elbow = this.relaxed ? 0.3 : 1.25;
    let jump = 0;

    const r = this.reaction;
    if (r) {
      r.t += dt;
      const k = r.t / REACT_TIME;
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      if (r.kind === 'celebrate') {
        // A hop and a fist pump with the free arm.
        jump = r.t < 0.42 ? Math.sin((r.t / 0.42) * Math.PI) * 0.11 : 0;
        bend = THREE.MathUtils.lerp(bend, r.t < 0.42 ? 0.1 : 0.3, fade);
        freeZ = THREE.MathUtils.lerp(freeZ, 0.75, fade);
        freeX = THREE.MathUtils.lerp(freeX, 1.0 + Math.sin(r.t * 14) * 0.15, fade);
        elbow = THREE.MathUtils.lerp(elbow, 1.9 - Math.sin(r.t * 14) * 0.25, fade);
        lean = THREE.MathUtils.lerp(lean, -0.08, fade);
      } else {
        // Shoulders drop, head down, a slow shake.
        lean = THREE.MathUtils.lerp(lean, 0.42, fade);
        twist += Math.sin(r.t * 7) * 0.18 * fade * (1 - k);
        freeZ = THREE.MathUtils.lerp(freeZ, 0.05, fade);
        freeX = THREE.MathUtils.lerp(freeX, -0.1, fade);
        elbow = THREE.MathUtils.lerp(elbow, 0.25, fade);
      }
      if (r.t >= REACT_TIME) this.reaction = null;
    }

    if (this.seated) {
      // In the chair: no knee bend or hop; the hips stay on the cushion.
      jump = 0;
      bend = 0;
    }
    // Bent knees lower the hips: thigh and shin each lose height to the bend.
    const drop = this.seated ? SEAT_DROP : THIGH * (1 - Math.cos(bend)) + SHIN * (1 - Math.cos(bend));
    const hipY = HIP - drop + jump;
    // Seated: a little lean into each push on the rim.
    if (this.seated && !r) lean += this.push.w * (this.push.rec < 0 ? 0.1 : 0.03);
    if (this.seated) {
      this.upper.position.set(0, hipY, 0);
      this.upper.rotation.set(-(lean + this.reachLean), twist, this.sideLean, 'YXZ');
      this.legs.forEach((leg, i) => {
        const s = i === 0 ? -1 : 1;
        leg.hip.position.y = hipY;
        // Thighs forward along the cushion, shins down to the footplate.
        leg.hip.rotation.set(Math.PI / 2 - 0.04, 0, s * 0.05);
        leg.knee.rotation.x = -Math.PI / 2 + 0.12;
        leg.foot.rotation.x = -0.05;
      });
      this.pelvis.position.set(0, -drop + jump, 0);
    } else {
      // The hips turn part of the way into the stroke, a little ahead of the shoulders.
      const hipYaw = this.spring('hipYaw', this.twist * 0.45, 15, dt);
      this.hipYaw = hipYaw;
      // Feet: planted, stepping when they must; the hips carry the weight over them.
      const fw = this.footwork(dt, hand, side, jump);
      const shift = fw.shift;
      this.upper.position.set(shift.x, hipY, shift.z);
      this.upper.rotation.set(-(lean + this.reachLean), twist, this.sideLean, 'YXZ');
      this.pelvis.position.set(shift.x, -drop + jump, shift.z);
      this.pelvis.rotation.set(0, hipYaw, 0);
      const c = Math.cos(hipYaw);
      const sn = Math.sin(hipYaw);
      this.legs.forEach((leg, i) => {
        const s = i === 0 ? -1 : 1;
        const x = s * this.hipX;
        leg.hip.position.set(shift.x + x * c, hipY, shift.z - x * sn);
        this.solveLeg(leg, fw.ankles[i], s, fw.lift[i]);
      });
    }
    // Free arm on the side away from the paddle.
    const fs = -side;
    this.free.upper.position.set(fs * this.shoulderX, SHOULDER_Y, 0);
    // Seated, the free hand rests out by the wheel's push rim (and pushes it when moving).
    if (this.seated && r) this.push.w = 0;
    if (this.seated && !r) {
      freeX = 0.25;
      freeZ = 0.45;
      elbow = 0.5;
    }
    this.free.upper.rotation.set(freeX, 0, fs * freeZ, 'XYZ');
    this.free.fore.rotation.set(elbow, 0, 0);
  }

  private hipYaw = 0;
  private feet: FootState[] | null = null;
  /** The body's velocity over the floor (world, m/s), smoothed. */
  private bodyVel = new THREE.Vector3();
  private lastFootBody: THREE.Vector3 | null = null;

  /**
   * Footwork. Each foot has a place it should be (the ready stance, wide and low, the
   * bat-side foot back; further out for a wide ball, in for a short one), and stays
   * planted on the floor until it's too far from it: then it steps there, leading the
   * movement, one foot at a time (both at once only for a big move). The hips sit over the
   * middle of the feet, swaying over the standing foot during a step.
   * Returns the ankles (character's frame), how far through a step each foot is (0 if
   * planted), and the hips' shift.
   */
  private footwork(dt: number, hand: THREE.Vector3, side: number, jump: number) {
    const g = this.group;
    const here = g.position.clone();
    if (this.lastFootBody && dt > 0) {
      const v = here.clone().sub(this.lastFootBody).divideScalar(dt);
      this.bodyVel.lerp(v, 1 - Math.exp(-12 * dt));
    }
    const teleported = !this.lastFootBody || here.distanceTo(this.lastFootBody) > 0.8;
    this.lastFootBody = here;
    const speed = this.bodyVel.length();
    const homes = [-1, 1].map((s) => {
      const home = new THREE.Vector3(s * STANCE_X, 0, s === side ? STANCE_BACK : -0.02);
      // A wide ball: the foot on that side steps out toward it.
      const out = hand.x * s - 0.42;
      if (out > 0) home.x += s * out * 0.75;
      // A short, low ball: the bat-side foot steps in under it.
      if (s === side && hand.z < -0.45 && hand.y < 0.75) home.z += (hand.z + 0.45) * 0.9;
      const w = g.localToWorld(home);
      w.y = 0;
      return w.addScaledVector(this.bodyVel, 0.12);
    });
    if (teleported || !this.feet) {
      this.feet = homes.map((h) => ({ plant: h.clone(), from: h.clone(), to: h.clone(), t: -1, dur: 0.2 }));
    }
    const feet = this.feet;
    for (const f of feet) {
      if (f.t < 0) continue;
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.plant.copy(f.to);
        f.t = -1;
      }
    }
    // The foot furthest from where it should be steps, if it's far enough.
    const far = feet.map((f, i) => (f.t < 0 ? f.plant.distanceTo(homes[i]) : 0));
    const j = far[0] > far[1] ? 0 : 1;
    const other = feet[1 - j];
    if (far[j] > STEP_AT && (other.t < 0 || other.t > 0.85 || far[j] > 0.45)) {
      const f = feet[j];
      f.from.copy(f.plant);
      f.to.copy(homes[j]).addScaledVector(this.bodyVel, 0.08);
      f.dur = THREE.MathUtils.clamp(0.2 - speed * 0.05, 0.1, 0.2); // quicker steps when moving quickly
      f.t = 0;
    }
    const ankles: THREE.Vector3[] = [];
    const lift: number[] = [];
    feet.forEach((f) => {
      const k = f.t < 0 ? 1 : f.t * f.t * (3 - 2 * f.t);
      const p = f.t < 0 ? f.plant.clone() : f.from.clone().lerp(f.to, k);
      const up = f.t < 0 ? 0 : Math.sin(Math.PI * f.t) * Math.min(0.07, 0.025 + f.from.distanceTo(f.to) * 0.25);
      const a = g.worldToLocal(p);
      a.y = ANKLE_Y + up + jump;
      ankles.push(a);
      lift.push(f.t < 0 ? 0 : f.t);
    });
    // Hips over the middle of the feet, swaying over the standing one during a step.
    const mid = ankles[0].clone().add(ankles[1]).multiplyScalar(0.5);
    let sway = 0;
    feet.forEach((f, i) => {
      if (f.t >= 0) sway += (ankles[1 - i].x - mid.x) * 0.3 * Math.sin(Math.PI * f.t);
    });
    const shift = new THREE.Vector3(THREE.MathUtils.clamp(mid.x * 0.6 + sway, -0.15, 0.15), 0, THREE.MathUtils.clamp(mid.z * 0.4, -0.12, 0.12));
    return { ankles, lift, shift };
  }

  /**
   * Two-bone leg: the hip turns the thigh so the knee (pointing forward and a little out)
   * and the shin reach the ankle; the foot stays flat on the floor, toes turned out, the
   * toe dipping as it lifts in a step. `lift`: how far through a step (0 planted).
   */
  private solveLeg(leg: LegJoints, ankle: THREE.Vector3, s: number, lift: number) {
    const hip = leg.hip.position;
    const d = ankle.clone().sub(hip);
    const dist = clamp(d.length(), 0.05, THIGH + SHIN - 1e-4);
    const dir = d.normalize();
    const pole = new THREE.Vector3(s * 0.25, 0, -1);
    pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = clamp((THIGH * THIGH + dist * dist - SHIN * SHIN) / (2 * THIGH * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const knee = hip.clone().addScaledVector(dir, cosA * THIGH).addScaledVector(pole, sinA * THIGH);
    const reach = hip.clone().addScaledVector(dir, dist);
    const X = new THREE.Vector3().crossVectors(dir, pole).normalize();
    const Y = hip.clone().sub(knee).normalize();
    const Z = new THREE.Vector3().crossVectors(X, Y);
    leg.hip.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(X, Y, Z));
    const thigh = knee.clone().sub(hip).normalize();
    const shin = reach.sub(knee).normalize();
    leg.knee.rotation.set(-Math.acos(clamp(thigh.dot(shin), -1, 1)), 0, 0);
    // The foot: flat, toes out, in the character's frame; undo the leg's turn above it.
    const want = new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.3 * Math.sin(Math.PI * lift), -s * TOE_OUT, 0, 'YXZ'));
    const above = leg.hip.quaternion.clone().multiply(leg.knee.quaternion);
    leg.foot.quaternion.copy(above.invert().multiply(want));
  }

  /** The ponytail's swing: angles (about x, then z) and their speeds. */
  private tail = { x: 0, z: 0, vx: 0, vz: 0 };
  private tailLast: THREE.Vector3 | null = null;
  private tailVel = new THREE.Vector3();

  /**
   * The ponytail hangs down whichever way the head is turned, and swings behind the head's
   * movement: a lightly damped spring toward hanging straight, pushed by the head's
   * acceleration.
   */
  private swingTail(dt: number) {
    const tail = this.ponytail;
    if (!tail || dt <= 0) return;
    this.group.updateMatrixWorld(true);
    const at = tail.getWorldPosition(new THREE.Vector3());
    const vel = this.tailLast ? at.clone().sub(this.tailLast).divideScalar(dt) : new THREE.Vector3();
    const acc = vel.clone().sub(this.tailVel).divideScalar(dt);
    this.tailLast = at;
    this.tailVel.copy(vel);
    // Down, and the head's acceleration, in the head's frame.
    const inv = this.head.getWorldQuaternion(new THREE.Quaternion()).invert();
    const down = new THREE.Vector3(0, -1, 0).applyQuaternion(inv);
    const a = acc.clamp(new THREE.Vector3(-40, -40, -40), new THREE.Vector3(40, 40, 40)).applyQuaternion(inv);
    // Angles that would point the tail along `down`, then lag behind the acceleration.
    const tx = clamp(Math.atan2(-down.z, -down.y) + a.z * 0.012, -1.1, 1.1);
    const tz = clamp(Math.atan2(down.x, -down.y) - a.x * 0.012, -1.1, 1.1);
    const w = 9;
    const zeta = 0.35;
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    const t = this.tail;
    for (let i = 0; i < n; i++) {
      t.vx += (w * w * (tx - t.x) - 2 * zeta * w * t.vx) * h;
      t.vz += (w * w * (tz - t.z) - 2 * zeta * w * t.vz) * h;
      t.x += t.vx * h;
      t.z += t.vz * h;
    }
    tail.rotation.set(t.x, 0, t.z, 'XYZ');
  }

  /**
   * Wheeling about: the chair turns toward where she's heading (and back to square
   * once she stops), the rear wheels roll at their own speeds (forward drive plus the
   * turn: they counter-rotate when she spins on the spot), the front casters swivel to
   * trail the travel, and the free hand works the push rim on its side.
   */
  private wheelAbout(dt: number, body: { x: number; z: number }) {
    if (dt <= 0) return;
    // Body velocity in the character's frame (it faces local −z).
    const prev = this.lastBodyChair ?? body;
    this.lastBodyChair = { x: body.x, z: body.z };
    const ry = this.group.rotation.y;
    const wx = (body.x - prev.x) / dt;
    const wz = (body.z - prev.z) / dt;
    const lx = wx * Math.cos(ry) - wz * Math.sin(ry);
    const lz = wx * Math.sin(ry) + wz * Math.cos(ry);
    this.vel.x = approach(this.vel.x, lx, 10, dt);
    this.vel.z = approach(this.vel.z, lz, 10, dt);
    // Heading: swing the footplate toward the side she's wheeling to.
    const yawTarget = clamp(-this.vel.x * 0.42, -0.6, 0.6);
    const yaw0 = this.chairYaw;
    this.chairYaw = this.spring('chairYaw', yawTarget, 6, dt);
    const omega = (this.chairYaw - yaw0) / dt;
    this.chair.rotation.y = this.chairYaw;
    // Velocity in the chair's own frame: forward drive along its heading.
    const c = Math.cos(this.chairYaw);
    const s = Math.sin(this.chairYaw);
    const cx = this.vel.x * c - this.vel.z * s;
    const cz = this.vel.x * s + this.vel.z * c;
    const forward = -cz;
    // Each rear wheel: forward drive ± the turn (turning left drives the right wheel on).
    const rollL = (forward - omega * TRACK) * dt;
    const rollR = (forward + omega * TRACK) * dt;
    this.wheelRoll[0] += rollL;
    this.wheelRoll[1] += rollR;
    this.wheelSpin[0].rotation.x = -this.wheelRoll[0] / WHEEL_R;
    this.wheelSpin[1].rotation.x = -this.wheelRoll[1] / WHEEL_R;
    // Casters: velocity at each pivot (chair motion + the turn), the wheel trailing behind it.
    for (const k of this.casters) {
      const pz = -0.5;
      const vx = cx + omega * pz;
      const vz = cz - omega * k.x;
      const v = Math.hypot(vx, vz);
      if (v > 0.05) {
        const target = Math.atan2(-vx, -vz);
        const cur = k.pivot.rotation.y;
        k.pivot.rotation.y = cur + angleDiff(target, cur) * (1 - Math.exp(-clamp(v * 18, 0, 22) * dt));
      }
      k.roll += v * dt;
      k.spin.rotation.x = -k.roll / CASTER_R;
    }

    // Free hand on the rim of the wheel on its side: rides round with the rim while it
    // drives, then lifts off and swings back for the next stroke.
    const p = this.push;
    const wheel = this.lastFreeSide < 0 ? 0 : 1;
    const roll = wheel === 0 ? rollL : rollR;
    const rimSpeed = Math.abs(roll) / dt;
    if (wheel !== p.wheel) {
      // The free hand changed sides with the paddle: start fresh on the new wheel.
      p.wheel = wheel;
      p.w = 0;
      p.rec = -1;
      p.theta = roll >= 0 ? PUSH_FROM : PUSH_TO;
    }
    p.w = approach(p.w, rimSpeed > 0.25 ? 1 : 0, rimSpeed > 0.25 ? 7 : 4, dt);
    if (p.rec >= 0) {
      p.rec += dt / clamp(0.55 - rimSpeed * 0.12, 0.25, 0.45);
      const k = Math.min(1, p.rec);
      const e = k * k * (3 - 2 * k);
      p.theta = p.recFrom + (p.recTo - p.recFrom) * e;
      p.lift = Math.sin(Math.PI * k);
      if (p.rec >= 1) p.rec = -1;
    } else {
      p.lift = 0;
      if (p.w < 0.05) p.theta = approach(p.theta, 0, 6, dt);
      else p.theta += roll / WHEEL_R; // the hand turns with the wheel
      if (p.theta > PUSH_TO) Object.assign(p, { rec: 0, recFrom: PUSH_TO, recTo: PUSH_FROM });
      else if (p.theta < PUSH_FROM) Object.assign(p, { rec: 0, recFrom: PUSH_FROM, recTo: PUSH_TO });
    }
  }
  private lastBodyChair: { x: number; z: number } | null = null;
  private lastFreeSide = 1;
}
