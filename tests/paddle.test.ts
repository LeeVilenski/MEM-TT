import { describe, expect, it } from 'vitest';
import {
  BallSim,
  DEFAULT_PARAMS,
  RUBBERS,
  TABLE,
  addScaled,
  cloneState,
  length,
  launchState,
  paddleImpulse,
  solveAim,
  spinComponents,
  spinVector,
  v3,
  type BallEvent,
  type BallState,
  type PaddleCollider,
  type Rubber,
  type Vec3,
} from '../src/physics';
import { landingOutcome, makeAngleAssist } from '../src/game/assist';
import { classifyShot } from '../src/game/shots';
import { DEFAULT_SWING, NO_INPUT, SwingController, faceNormal, strokeVelocity } from '../src/game/swing';
import { PRESETS } from '../src/sandbox/presets';

const P = DEFAULT_PARAMS;

/** Ball state from a machine preset when it reaches the plane z = zPlane after bouncing on the near half. */
function incoming(name: string, zPlane: number): BallState {
  const pr = PRESETS.find((p) => p.name === name)!;
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
  const sim = new BallSim(launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin }), P);
  let bounced = false;
  for (let i = 0; i < 2000; i++) {
    const before = cloneState(sim.state);
    const ev: BallEvent[] = [];
    sim.step(1 / 240, ev);
    if (ev.some((e) => e.type === 'table' && e.side === 'near')) bounced = true;
    if (bounced && sim.state.pos.z >= zPlane) return before;
  }
  throw new Error('ball never reached plane');
}

/** Swing a paddle moving at `vel` through the ball's position at `zPlane`. */
function swingAt(ball: BallState, zPlane: number, vel: Vec3, normal: Vec3, rubber: Rubber = RUBBERS.inverted, adjust?: PaddleCollider['adjustNormal']) {
  const cp = v3(ball.pos.x, ball.pos.y, zPlane);
  const sim = new BallSim(ball, P);
  let t = 0;
  const col: PaddleCollider = {
    id: 'p',
    front: rubber,
    back: rubber,
    extraRadius: 0.03,
    adjustNormal: adjust,
    poseAt: (f) => ({ pos: addScaled(cp, vel, t + f / 240 - 1 / 240), normal, vel }),
  };
  const events: BallEvent[] = [];
  for (let i = 0; i < 240 * 3; i++) {
    const ev: BallEvent[] = [];
    sim.step(1 / 240, ev, [col]);
    t += 1 / 240;
    events.push(...ev);
    const hit = events.find((e) => e.type === 'paddle');
    if (hit && ev.some((e) => e.type === 'table' || e.type === 'floor')) break;
  }
  const hit = events.find((e): e is Extract<BallEvent, { type: 'paddle' }> => e.type === 'paddle');
  const land = hit && events.find((e) => (e.type === 'table' || e.type === 'floor') && e.time > hit.time);
  return { hit, land };
}

const aimYaw = (x: number, z: number) => (Math.atan2(0 - x, -(-0.8 - z)) * 180) / Math.PI;

describe('paddle contact', () => {
  it('a still paddle blocks: the ball comes back slower', () => {
    const ball = incoming('Drive', 1.6);
    const { hit } = swingAt(ball, 1.6, v3(), faceNormal(-15, aimYaw(ball.pos.x, 1.6)));
    expect(hit).toBeDefined();
    expect(hit!.velOut.z).toBeLessThan(0);
    expect(length(hit!.velOut)).toBeLessThan(length(hit!.velIn));
  });

  it('an upward brush makes topspin; a downward brush makes backspin', () => {
    const ball = incoming('Long push', 1.55);
    const yaw = aimYaw(ball.pos.x, 1.55);
    const up = swingAt(ball, 1.55, strokeVelocity({ x: 0, y: 5 }, false, 0, DEFAULT_SWING), faceNormal(-20, yaw)).hit!;
    const down = swingAt(ball, 1.55, strokeVelocity({ x: 0, y: -3 }, false, 0, DEFAULT_SWING), faceNormal(35, yaw)).hit!;
    expect(spinComponents(up.velOut, up.spinOut).top).toBeGreaterThan(70);
    expect(spinComponents(down.velOut, down.spinOut).top).toBeLessThan(-40);
  });

  it('a hook brush adds sidespin in the requested direction', () => {
    const ball = incoming('Drive', 1.6);
    const yaw = aimYaw(ball.pos.x, 1.6);
    const left = swingAt(ball, 1.6, strokeVelocity({ x: 0, y: 5 }, false, -1, DEFAULT_SWING), faceNormal(-35, yaw)).hit!;
    const right = swingAt(ball, 1.6, strokeVelocity({ x: 0, y: 5 }, false, 1, DEFAULT_SWING), faceNormal(-35, yaw)).hit!;
    expect(spinComponents(left.velOut, left.spinOut).side).toBeLessThan(-15);
    expect(spinComponents(right.velOut, right.spinOut).side).toBeGreaterThan(15);
  });

  it('long pips return topspin as backspin; inverted rubber does not', () => {
    const ball: BallState = { pos: v3(0, 1, 1.5), vel: v3(0, -1, 9), spin: spinVector(v3(0, -1, 9), { top: 100, side: 0, cork: 0 }) };
    const pose = { pos: v3(0, 1, 1.5), normal: faceNormal(5, 0), vel: v3(0, 0, -1) };
    const pips = cloneState(ball);
    paddleImpulse(pips, pose, RUBBERS.longPips);
    const inv = cloneState(ball);
    paddleImpulse(inv, pose, RUBBERS.inverted);
    // Pips keep the incoming rotation, which is heavy backspin relative to the return direction.
    expect(spinComponents(pips.vel, pips.spin).top).toBeLessThan(-45);
    expect(spinComponents(inv.vel, inv.spin).top).toBeGreaterThan(spinComponents(pips.vel, pips.spin).top + 25);
  });

  it('a 25 m/s swing does not tunnel through the ball', () => {
    const ball: BallState = { pos: v3(0, 1, 1.0), vel: v3(0, 0, 3), spin: v3() };
    const { hit } = swingAt(ball, 1.03, v3(0, 0, -25), v3(0, 0, -1));
    expect(hit).toBeDefined();
  });
});

describe('angle assist', () => {
  it('pulls an over-hit loop onto the table, and leaves good shots alone', () => {
    const ball = incoming('Long push', 1.55);
    const yaw = aimYaw(ball.pos.x, 1.55);
    const vel = strokeVelocity({ x: 0, y: 5 }, false, 0, DEFAULT_SWING);
    const open = faceNormal(15, yaw);
    const pose = { pos: v3(ball.pos.x, ball.pos.y, 1.55), normal: open, vel };
    expect(landingOutcome(ball, pose, open, RUBBERS.inverted, P).outcome).toBe('long');

    const assisted = swingAt(ball, 1.55, vel, open, RUBBERS.inverted, makeAngleAssist(P, () => 1));
    expect(assisted.land?.type).toBe('table');
    expect(assisted.land!.pos.z).toBeLessThan(0);

    const none = swingAt(ball, 1.55, vel, open, RUBBERS.inverted, makeAngleAssist(P, () => 0));
    expect(none.land?.type).toBe('floor');
  });
});

describe('swing controller', () => {
  const body = { x: 0, z: 2 };
  const aim = { x: 0, z: -0.8 };

  it('an upward mouse flick drives the paddle up and forward', () => {
    const s = new SwingController();
    s.reset(0.3, 1.0, 1.6);
    for (let i = 0; i < 6; i++) s.update(1 / 120, { ...NO_INPUT, dy: -30 }, body, 1.6, aim);
    expect(s.pose.vel.y).toBeGreaterThan(3);
    expect(s.pose.vel.z).toBeLessThan(-3);
    expect(s.forward).toBeGreaterThan(0.02);
  });

  it('slow positioning moves do not push the paddle forward', () => {
    const s = new SwingController();
    s.reset(0.3, 1.0, 1.6);
    // ~500 px/s for half a second: repositioning, not a stroke.
    for (let i = 0; i < 30; i++) s.update(1 / 60, { ...NO_INPUT, dx: 8, dy: -4 }, body, 1.6, aim);
    expect(s.forward).toBe(0);
    expect(s.pose.pos.x).toBeGreaterThan(0.6);
  });

  it('holding drive trades brush for forward pace', () => {
    const run = (drive: boolean) => {
      const s = new SwingController();
      s.reset(0.3, 1.0, 1.6);
      for (let i = 0; i < 4; i++) s.update(1 / 120, { ...NO_INPUT, dy: -30, drive }, body, 1.6, aim);
      return s.pose.vel;
    };
    const brush = run(false);
    const drive = run(true);
    expect(-drive.z).toBeGreaterThan(-brush.z);
    expect(drive.y).toBeLessThan(brush.y);
  });

  it('W closes and S opens the face', () => {
    const s = new SwingController();
    s.reset(0.3, 1.0, 1.6);
    for (let i = 0; i < 30; i++) s.update(1 / 60, { ...NO_INPUT, close: true }, body, 1.6, aim);
    expect(s.pose.normal.y).toBeLessThan(-0.3);
    for (let i = 0; i < 30; i++) s.update(1 / 60, { ...NO_INPUT, open: true }, body, 1.6, aim);
    expect(s.pose.normal.y).toBeGreaterThan(0.3);
  });

  it('the paddle returns to the ready position after a stroke', () => {
    const s = new SwingController();
    s.reset(0.3, 1.0, 1.6);
    for (let i = 0; i < 5; i++) s.update(1 / 120, { ...NO_INPUT, dy: -40 }, body, 1.6, aim);
    for (let i = 0; i < 120; i++) s.update(1 / 120, NO_INPUT, body, 1.6, aim);
    expect(s.forward).toBe(0);
    expect(s.pose.vel.z).toBeCloseTo(0, 6);
  });
});

describe('shot naming', () => {
  it('names loops, pushes, smashes and blocks', () => {
    const dir = v3(0, 0.15, -1);
    const spin = (top: number, side = 0) => spinVector(dir, { top, side, cork: 0 });
    const behind = v3(0, 1, 1.7);
    const over = v3(0, 0.9, 1.1);
    const inc = v3(0, 0, 8);
    const scaleTo = (s: number) => v3(0, 0.15 * s, -s);
    expect(classifyShot(behind, scaleTo(15), spin(110), v3(0, 8, -10), inc, v3()).name).toBe('Loop');
    expect(classifyShot(over, scaleTo(4), spin(-50), v3(0, -1, -3), inc, v3()).name).toBe('Push');
    expect(classifyShot(behind, scaleTo(26), spin(20), v3(0, 2, -20), inc, v3()).name).toBe('Smash');
    expect(classifyShot(behind, scaleTo(8), spin(10), v3(0, 0, -0.5), inc, v3()).name).toBe('Block');
    expect(classifyShot(behind, scaleTo(15), spin(100, 50), v3(4, 8, -10), inc, v3()).name).toBe('Hook loop');
  });
});
