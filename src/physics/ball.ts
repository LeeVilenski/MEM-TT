import { BALL, GRAVITY, AIR_DENSITY, MAX_SUBSTEP_TRAVEL, NET, TABLE, type PhysicsParams } from './constants';
import { add, addScaled, clone, cross, dot, length, scale, sub, v3, type Vec3 } from './vec3';

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
  | { type: 'floor'; time: number; pos: Vec3 };

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
  ) {
    this.state = cloneState(state);
  }

  step(dt: number, events?: BallEvent[]): void {
    if (this.atRest) {
      this.time += dt;
      return;
    }
    const speed = length(this.state.vel);
    const n = Math.min(64, Math.max(1, Math.ceil((speed * dt) / MAX_SUBSTEP_TRAVEL)));
    const h = dt / n;
    for (let i = 0; i < n; i++) this.substep(h, events);
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
  opts: { maxTime?: number; dt?: number; sampleEvery?: number; stop?: (e: BallEvent) => boolean } = {},
): PredictResult {
  const { maxTime = 3, dt = 1 / 240, sampleEvery = 2, stop } = opts;
  const sim = new BallSim(start, params);
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
