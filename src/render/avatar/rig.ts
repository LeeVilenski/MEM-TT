import * as THREE from 'three';
import {
  ARM_MAX,
  CASTER_R,
  COMFORT,
  FORE,
  HEAD_PIVOT,
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
 *   │     ├─ head           top of the neck (HEAD_PIVOT)
 *   │     ├─ arm            racket arm: upper (shoulder) → fore (elbow) → hand (grip)
 *   │     └─ free           free arm, the same chain
 *   ├─ legs[0..1]           left then right: hip → knee → foot (ankle)
 *   └─ pelvis               moves with the legs, not the twisting upper body
 *
 * Seated characters put the legs and pelvis on a `chair` joint (which turns as they
 * wheel about), with spinning wheels, swivelling casters and a push arm on the rim.
 *
 * Arm conventions: the racket arm's segments point along +y, solved each frame to the
 * handle (the bones can stretch a little past straight: read the lengths from
 * fore.position.y and hand.position.y). The free arm hangs along −y at fixed lengths.
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
/** Push stroke on the hand rim: from behind the top (θ < 0) round to the front (θ > 0), rad. */
const PUSH_FROM = -0.6;
const PUSH_TO = 0.5;

/** One arm: shoulder, elbow and hand joints, each a child of the one before. */
export interface ArmJoints {
  upper: THREE.Group;
  fore: THREE.Group;
  hand: THREE.Group;
}

export interface LegJoints {
  hip: THREE.Group;
  knee: THREE.Group;
  foot: THREE.Group;
}

export interface RigOptions {
  /** Torso width scale (sets how far apart the shoulders and hips are). */
  build: number;
  seated: boolean;
  /** +1 right-handed (bat at local +x), −1 left. */
  batHand: 1 | -1;
}

const arm = (): ArmJoints => {
  const upper = new THREE.Group();
  const fore = new THREE.Group();
  const hand = new THREE.Group();
  upper.add(fore);
  fore.add(hand);
  return { upper, fore, hand };
};

export class AvatarRig {
  readonly group = new THREE.Group();
  /** Upper body, pivoting at the hips (twist into strokes, lean, reactions). */
  readonly upper = new THREE.Group();
  /** Inside `upper`, offset so its children use absolute heights. */
  readonly upperAbs = new THREE.Group();
  /** Top of the neck: the head and everything on it. */
  readonly head = new THREE.Group();
  readonly legs: LegJoints[] = [];
  /** Racket arm (solved to the paddle handle) and the free arm (posed). */
  readonly arm = arm();
  readonly free = arm();
  /** Hips and waistband: follows the legs' bend and hop. */
  readonly pelvis = new THREE.Group();
  /** Chair, legs and hips: turns (yaws) as she wheels about, under the upper body. */
  readonly chair = new THREE.Group();
  /** Rear wheels, left then right: spin group (rolls) and camber group (the push rim's frame). */
  readonly wheelSpin: THREE.Group[] = [];
  readonly wheelCamber: THREE.Group[] = [];
  /** Front casters: swivel pivot (trails the travel), wheel spin and its local x. */
  readonly casters: { pivot: THREE.Group; spin: THREE.Group; x: number; roll: number }[] = [];
  readonly shoulderX: number;
  /** Seated in a wheelchair (lower body, legs on the footplate, wheels that roll). */
  readonly seated: boolean;
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
    this.upper.position.y = HIP;
    this.upperAbs.position.y = -HIP;
    this.upper.add(this.upperAbs);
    this.group.add(this.upper);
    this.head.position.copy(HEAD_PIVOT);
    this.upperAbs.add(this.head, this.arm.upper, this.free.upper);
    // The free arm hangs down at its full length.
    this.free.fore.position.y = -UPPER;
    this.free.hand.position.y = -(FORE - 0.02);
    // Legs: hip → knee → ankle, each joint a group so the stance can bend.
    for (const x of [-HIP_X, HIP_X]) {
      const hip = new THREE.Group();
      hip.position.set(x * o.build, HIP, 0);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      const foot = new THREE.Group();
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
    this.pelvis.name = 'pelvis';
    this.chair.name = 'chair';
    for (const [arm, side] of [[this.arm, bat], [this.free, freeSide]] as const) {
      arm.upper.name = `shoulder_${side}`;
      arm.fore.name = `elbow_${side}`;
      arm.hand.name = `hand_${side}`;
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
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean, now = performance.now() / 1000) {
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
    this.solveArm(local, side);
    if (this.seated && this.push.w > 0.01) this.solvePushArm(-side);
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
    const l2 = FORE - 0.02;
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
  private walkPhase = 0;
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
  private spring(key: 'twist' | 'lean' | 'sideLean' | 'reachLean' | 'chairYaw', target: number, w: number, dt: number) {
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
   * hanging a little out from the sides, at the origin facing −z. It's the pose the body
   * is built round, and the reference exported for modelling (see docs/avatar-heads.md).
   * Animation picks up from here on the next update.
   */
  rest() {
    const hipY = this.seated ? HIP - SEAT_DROP : HIP;
    this.group.position.set(0, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.upper.position.y = hipY;
    this.upper.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    this.pelvis.position.y = hipY - HIP;
    this.chair.rotation.y = 0;
    this.legs.forEach((leg, i) => {
      leg.hip.position.y = hipY;
      if (this.seated) {
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
    // Free arm (segments along −y): the same, on the other side.
    this.free.upper.position.set(-s * this.shoulderX, SHOULDER_Y, 0);
    this.free.upper.rotation.set(0, 0, -s * out);
    this.free.fore.rotation.set(0, 0, 0);
    this.group.updateMatrixWorld(true);
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
    this.stride = approach(this.stride, clamp(speed * 0.35, 0, 0.32), 12, dt);
    this.walkPhase += dt * (4 + speed * 9);
    const step = Math.sin(this.walkPhase) * this.stride;

    // Swing speed of the hand across the body (follow-through twists the torso).
    if (this.lastHand && dt > 0) this.swingVel = approach(this.swingVel, (hand.x - this.lastHand.x) / dt, 20, dt);
    this.lastHand = hand.clone();

    // Turn toward the paddle side and into the swing; lean over low or far-forward balls.
    // Backhands (bat across the body) turn the bat shoulder further round.
    const twistTarget = clamp(-hand.x * (hand.x * side < 0 ? 0.85 : 0.55) - this.swingVel * 0.05, -0.75, 0.75);
    this.twist = this.spring('twist', twistTarget, 11, dt);
    const reachDown = clamp((1.15 - drop0 - hand.y) * 0.5, 0, 0.3);
    const reachForward = clamp((-hand.z - 0.3) * 0.25, 0, 0.15);
    this.lean = this.spring('lean', 0.1 + reachDown + reachForward, 9, dt);

    // Reaching for a ball beyond the arm: bend sideways toward it and lean in.
    const sx = side * this.shoulderX;
    const far = Math.max(0, Math.hypot(hand.x - sx, hand.y - (SHOULDER_Y - drop0), hand.z) - COMFORT);
    const sideways = Math.min(1, Math.abs(hand.x - sx) / Math.max(0.01, Math.hypot(hand.x - sx, hand.z)));
    this.sideLean = this.spring('sideLean', -Math.sign(hand.x - sx || 1) * clamp(far * 1.5 * sideways, 0, 0.5), 12, dt);
    this.reachLean = this.spring('reachLean', clamp(far * 1.1 * (1 - sideways * 0.6), 0, 0.35), 12, dt);

    // Ready stance: knees bent, a light bounce on the toes.
    const bounce = Math.sin(time * Math.PI * 2 * 1.4) * (1 - this.stride * 2);
    let bend = 0.24 + this.lean * 0.35 + bounce * 0.03;
    let lean = this.lean;
    // Seated, the shoulders turn part of the way with the chair under them.
    let twist = this.twist + this.chairYaw * 0.5;
    let freeZ = 0.2 + this.stride * 0.6;
    let freeX = 0.35 + this.lean * 0.6; // free arm a little forward, for balance
    let elbow = 1.25;
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
    this.upper.position.y = HIP - drop + jump;
    // Seated: a little lean into each push on the rim.
    if (this.seated && !r) lean += this.push.w * (this.push.rec < 0 ? 0.1 : 0.03);
    this.upper.rotation.set(-(lean + this.reachLean), twist, this.sideLean, 'YXZ');
    this.legs.forEach((leg, i) => {
      const s = i === 0 ? -1 : 1;
      leg.hip.position.y = HIP - drop + jump;
      if (this.seated) {
        // Thighs forward along the cushion, shins down to the footplate.
        leg.hip.rotation.set(Math.PI / 2 - 0.04, 0, s * 0.05);
        leg.knee.rotation.x = -Math.PI / 2 + 0.12;
        leg.foot.rotation.x = -0.05;
        return;
      }
      leg.hip.rotation.set(bend + (i === 0 ? step : -step) * 0.5, 0, s * (Math.abs(step) * 0.9 + 0.05));
      leg.knee.rotation.x = -2 * bend;
      leg.foot.rotation.x = bend;
    });
    this.pelvis.position.y = -drop + jump;
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
