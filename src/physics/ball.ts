import { BALL, GRAVITY, AIR_DENSITY, MAX_SUBSTEP_TRAVEL, NET, TABLE, type PhysicsParams } from './constants';
import { add, addScaled, clone, cross, dot, length, scale, sub, v3, type Vec3 } from './vec3';
import { PADDLE, paddleContact, paddleImpulse, type PaddlePose, type Rubber } from './paddle';

export interface BallState {
  pos: Vec3;
  /** Linear velocity, m/s. */
  vel: Vec3;
  /** Angular velocity, rad/s (axis × rate, right-hand rule). */
  spin: Vec3;
}

export type Side = 'near' | 'far';

export type BallEvent =
  | { type: 'table'; time: number; pos: Vec3; side: Side; impactSpeed: number; velIn: Vec3; velOut: Vec3; spinIn: Vec3; spinOut: Vec3 }
  | { type: 'net'; time: number; pos: Vec3; part: 'tape' | 'mesh' }
  /** Ball centre passed the plane of the net. clearance = gap between ball bottom and net top (negative = would have hit). */
  | { type: 'netCross'; time: number; pos: Vec3; clearance: number; direction: Side }
  | { type: 'floor'; time: number; pos: Vec3 }
  | {
      type: 'paddle';
      time: number;
      pos: Vec3;
      paddleId: string;
      face: 'front' | 'back';
      impactSpeed: number;
      paddleVel: Vec3;
      velIn: Vec3;
      velOut: Vec3;
      spinIn: Vec3;
      spinOut: Vec3;
    };

/**
 * A moving paddle the ball can collide with during a step. poseAt(f) gives the
 * paddle pose at fraction f ∈ [0, 1] of the current step, so fast swings are
 * swept correctly rather than teleporting between frames.
 */
export interface PaddleCollider {
  id: string;
  poseAt(f: number): PaddlePose;
  /** Rubber on the front face (normal side) and back face. */
  front: Rubber;
  back: Rubber;
  /** Widen the hittable area (assist). */
  extraRadius?: number;
  /**
   * Optional hook to adjust the face normal at the moment of contact (the angle
   * assist). Receives a copy of the ball state just before impact.
   */
  adjustNormal?: (ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber) => Vec3;
}

/** Minimum time between two hits by the same paddle (prevents double contacts). */
const PADDLE_COOLDOWN = 0.12;

const AREA = Math.PI * BALL.radius * BALL.radius;
/** Moment of inertia of a thin hollow sphere: (2/3) m r². */
const INERTIA = (2 / 3) * BALL.mass * BALL.radius * BALL.radius;
const TABLE_TOP = TABLE.height;

export const cloneState = (s: BallState): BallState => ({ pos: clone(s.pos), vel: clone(s.vel), spin: clone(s.spin) });

/** Aerodynamic + gravitational acceleration on the ball. */
export function acceleration(s: BallState, p: PhysicsParams): Vec3 {
  const speed = length(s.vel);
  let a = v3(0, -GRAVITY, 0);
  if (speed < 1e-6) return a;

  const q = 0.5 * AIR_DENSITY * AREA * speed * speed; // dynamic pressure × area
  // Drag, opposing motion.
  a = addScaled(a, s.vel, (-q * p.dragCoefficient) / (BALL.mass * speed));

  // Magnus lift, perpendicular to both spin axis and velocity.
  const omega = length(s.spin);
  if (omega > 1e-6) {
    const spinRatio = (BALL.radius * omega) / speed;
    const cl = (p.liftCoefficientMax * spinRatio) / (spinRatio + p.liftHalfSpinRatio);
    // (ω × v) / (|ω||v|) carries the sin(angle) factor: spin parallel to velocity gives no lift.
    const dir = scale(cross(s.spin, s.vel), 1 / (omega * speed));
    a = addScaled(a, dir, (q * cl) / BALL.mass);
  }
  return a;
}

/**
 * Impulse-based bounce of the ball against a static surface with unit normal n.
 * Models friction at the contact patch: the ball either slides the whole time
 * (friction-limited) or reaches rolling ("grips") during contact. This is what
 * makes backspin check up and topspin kick forward on the bounce.
 */
export function surfaceBounce(s: BallState, n: Vec3, restitution: number, friction: number, spinBite = 0, frictionMax = 1): void {
  const vn = dot(s.vel, n);
  if (vn >= 0) return;
  const m = BALL.mass;
  const jn = -(1 + restitution) * m * vn;

  const rc = scale(n, -BALL.radius); // contact point relative to centre
  const vContact = add(s.vel, cross(s.spin, rc));
  const slip = sub(vContact, scale(n, dot(vContact, n)));
  const slipSpeed = length(slip);

  let impulse = scale(n, jn);
  if (slipSpeed > 1e-9) {
    // Impulse needed to stop slipping entirely for a hollow sphere is (2/5) m |slip|.
    const mu = Math.min(frictionMax, friction + spinBite * slipSpeed);
    const jt = Math.min(mu * jn, 0.4 * m * slipSpeed);
    impulse = addScaled(impulse, slip, -jt / slipSpeed);
  }
  s.vel = addScaled(s.vel, impulse, 1 / m);
  s.spin = addScaled(s.spin, cross(rc, impulse), 1 / INERTIA);
}

export function tableRestitution(impactSpeed: number, p: PhysicsParams): number {
  return Math.max(0.5, p.tableRestitution - p.tableRestitutionSpeedLoss * impactSpeed);
}

/**
 * Deterministic ball simulation. Call step() with the fixed tick dt; it
 * sub-steps internally so a 30 m/s smash can't tunnel through the net.
 */
export class BallSim {
  state: BallState;
  time = 0;
  /** True once the ball has settled on the floor. */
  atRest = false;

  constructor(
    state: BallState,
    public params: PhysicsParams,
    /** Max ball travel per sub-step. Coarser values are fine for quick what-if predictions. */
    public maxTravel = MAX_SUBSTEP_TRAVEL,
  ) {
    this.state = cloneState(state);
  }

  private lastPaddleHit = new Map<string, number>();

  step(dt: number, events?: BallEvent[], paddles?: readonly PaddleCollider[]): void {
    if (this.atRest) {
      this.time += dt;
      return;
    }
    let speed = length(this.state.vel);
    if (paddles) for (const p of paddles) speed += length(p.poseAt(0.5).vel);
    const n = Math.min(96, Math.max(1, Math.ceil((speed * dt) / this.maxTravel)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      this.substep(h, events);
      if (paddles) this.collidePaddles(paddles, (i + 1) / n, events);
    }
  }

  private collidePaddles(paddles: readonly PaddleCollider[], f: number, events?: BallEvent[]) {
    const s = this.state;
    for (const p of paddles) {
      const last = this.lastPaddleHit.get(p.id);
      if (last !== undefined && this.time - last < PADDLE_COOLDOWN) continue;
      const pose = p.poseAt(f);
      const n = paddleContact(s.pos, pose, p.extraRadius ?? 0);
      if (!n) continue;
      const face = n === pose.normal ? 'front' : 'back';
      const rubber = face === 'front' ? p.front : p.back;
      const velIn = clone(s.vel);
      const spinIn = clone(s.spin);
      const normal = p.adjustNormal ? p.adjustNormal(cloneState(s), pose, n, rubber) : n;
      const impact = paddleImpulse(s, { ...pose, normal }, rubber);
      if (impact <= 0) continue;
      // Place the ball just off the face.
      const d = sub(s.pos, pose.pos);
      const inPlane = sub(d, scale(n, dot(d, n)));
      s.pos = add(add(pose.pos, inPlane), scale(n, BALL.radius + PADDLE.thickness / 2 + 1e-4));
      this.lastPaddleHit.set(p.id, this.time);
      events?.push({
        type: 'paddle',
        time: this.time,
        pos: clone(s.pos),
        paddleId: p.id,
        face,
        impactSpeed: impact,
        paddleVel: clone(pose.vel),
        velIn,
        velOut: clone(s.vel),
        spinIn,
        spinOut: clone(s.spin),
      });
    }
  }

  private substep(h: number, events?: BallEvent[]): void {
    const s = this.state;
    const p = this.params;
    const prev = clone(s.pos);

    // Semi-implicit Euler; stable and adequate at sub-millisecond steps.
    s.vel = addScaled(s.vel, acceleration(s, p), h);
    s.pos = addScaled(s.pos, s.vel, h);
    s.spin = scale(s.spin, Math.exp(-p.spinDecay * h));
    this.time += h;

    const r = BALL.radius;

    // Net plane crossing (for clearance readouts / rules).
    if ((prev.z > 0) !== (s.pos.z > 0) && events) {
      const t = prev.z / (prev.z - s.pos.z);
      const at = { x: prev.x + (s.pos.x - prev.x) * t, y: prev.y + (s.pos.y - prev.y) * t, z: 0 };
      if (Math.abs(at.x) <= NET.halfLength + r && at.y > TABLE_TOP) {
        events.push({ type: 'netCross', time: this.time, pos: at, clearance: at.y - r - NET.top, direction: s.pos.z > 0 ? 'near' : 'far' });
      }
    }

    // Net: thin vertical rectangle in the z = 0 plane.
    const cp = v3(Math.max(-NET.halfLength, Math.min(NET.halfLength, s.pos.x)), Math.max(TABLE_TOP, Math.min(NET.top, s.pos.y)), 0);
    const d = sub(s.pos, cp);
    const dist = length(d);
    if (dist < r) {
      const n = dist > 1e-9 ? scale(d, 1 / dist) : v3(0, 0, prev.z >= 0 ? 1 : -1);
      const vn = dot(s.vel, n);
      if (vn < 0) {
        const part = cp.y >= NET.top - 0.012 && n.y > 0.15 ? 'tape' : 'mesh';
        const vNormal = scale(n, vn);
        const vTangent = sub(s.vel, vNormal);
        s.vel = add(scale(vTangent, p.netTangentialKeep), scale(n, -vn * p.netRestitution));
        s.spin = scale(s.spin, 0.5);
        events?.push({ type: 'net', time: this.time, pos: clone(cp), part });
      }
      s.pos = addScaled(cp, n, r + 1e-5);
    }

    // Table top.
    if (
      s.vel.y < 0 &&
      s.pos.y - r <= TABLE_TOP &&
      prev.y - r >= TABLE_TOP - 0.01 &&
      Math.abs(s.pos.x) <= TABLE.halfWidth &&
      Math.abs(s.pos.z) <= TABLE.halfLength
    ) {
      const impactSpeed = -s.vel.y;
      const velIn = clone(s.vel);
      const spinIn = clone(s.spin);
      s.pos.y = TABLE_TOP + r;
      surfaceBounce(s, v3(0, 1, 0), tableRestitution(impactSpeed, p), p.tableFriction, p.tableSpinBite, p.tableFrictionMax);
      // A ball that has almost stopped bouncing is dead: stop instead of micro-bouncing forever.
      if (impactSpeed < 0.15 && Math.hypot(s.vel.x, s.vel.z) < 0.5) {
        s.vel = v3();
        s.spin = v3();
        this.atRest = true;
      }
      events?.push({
        type: 'table',
        time: this.time,
        pos: v3(s.pos.x, TABLE_TOP, s.pos.z),
        side: s.pos.z >= 0 ? 'near' : 'far',
        impactSpeed,
        velIn,
        velOut: clone(s.vel),
        spinIn,
        spinOut: clone(s.spin),
      });
    }

    // Floor.
    if (s.pos.y - r <= 0 && s.vel.y < 0) {
      s.pos.y = r;
      const impact = -s.vel.y;
      surfaceBounce(s, v3(0, 1, 0), impact < 0.3 ? 0 : p.floorRestitution, p.floorFriction);
      if (impact > 0.3) events?.push({ type: 'floor', time: this.time, pos: v3(s.pos.x, 0, s.pos.z) });
      if (length(s.vel) < 0.05) {
        s.vel = v3();
        s.spin = v3();
        this.atRest = true;
      }
    }
  }
}

export interface PredictResult {
  path: Vec3[];
  events: BallEvent[];
}

/**
 * Run a copy of the simulation forward. Used for the trajectory preview,
 * the ball machine's aim solver, AI later on, and tests.
 */
export function predict(
  start: BallState,
  params: PhysicsParams,
  opts: { maxTime?: number; dt?: number; sampleEvery?: number; maxTravel?: number; stop?: (e: BallEvent) => boolean } = {},
): PredictResult {
  const { maxTime = 3, dt = 1 / 240, sampleEvery = 2, maxTravel, stop } = opts;
  const sim = new BallSim(start, params, maxTravel);
  const path: Vec3[] = [clone(sim.state.pos)];
  const events: BallEvent[] = [];
  let tick = 0;
  while (sim.time < maxTime && !sim.atRest) {
    const before = events.length;
    sim.step(dt, events);
    tick++;
    if (tick % sampleEvery === 0) path.push(clone(sim.state.pos));
    if (stop) {
      for (let i = before; i < events.length; i++) {
        if (stop(events[i])) {
          path.push(clone(sim.state.pos));
          return { path, events };
        }
      }
    }
  }
  return { path, events };
}
