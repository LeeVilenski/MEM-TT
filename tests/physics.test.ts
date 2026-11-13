import { describe, expect, it } from 'vitest';
import {
  BALL,
  BallSim,
  DEFAULT_PARAMS,
  NET,
  TABLE,
  firstBounce,
  launchState,
  predict,
  solveAim,
  spinComponents,
  spinVector,
  v3,
  type BallEvent,
  type BallState,
  type Shot,
} from '../src/physics';

const P = DEFAULT_PARAMS;
const ORIGIN = v3(0, TABLE.height + 0.2, -TABLE.halfLength - 0.2);
const noSpin = { top: 0, side: 0, cork: 0 };

function landingOf(shot: Shot) {
  const { landing } = firstBounce(ORIGIN, shot, P);
  if (!landing) throw new Error('no landing');
  return landing;
}

describe('flight', () => {
  it('reaches a terminal velocity of roughly 8–10 m/s when dropped', () => {
    const sim = new BallSim({ pos: v3(5, 200, 5), vel: v3(), spin: v3() }, P);
    for (let i = 0; i < 240 * 8; i++) sim.step(1 / 240);
    expect(-sim.state.vel.y).toBeGreaterThan(8);
    expect(-sim.state.vel.y).toBeLessThan(10);
  });

  it('topspin dips the ball shorter, backspin floats it longer (Magnus)', () => {
    const base = { speed: 12, elevation: 6, azimuth: 0 };
    const flat = landingOf({ ...base, spin: noSpin }).pos.z;
    const top = landingOf({ ...base, spin: { ...noSpin, top: 100 } }).pos.z;
    const back = landingOf({ ...base, spin: { ...noSpin, top: -60 } }).pos.z;
    expect(top).toBeLessThan(flat - 0.2);
    expect(back).toBeGreaterThan(flat);
  });

  it("sidespin curves the ball to the hitter's right (−x when travelling +z)", () => {
    const shot = { speed: 10, elevation: 8, azimuth: 0 };
    const right = landingOf({ ...shot, spin: { ...noSpin, side: 80 } });
    const left = landingOf({ ...shot, spin: { ...noSpin, side: -80 } });
    expect(right.pos.x).toBeLessThan(-0.05);
    expect(left.pos.x).toBeGreaterThan(0.05);
  });

  it('round-trips spin components', () => {
    const dir = v3(0.3, 0.2, 1);
    const c = { top: 50, side: -30, cork: 20 };
    const back = spinComponents(dir, spinVector(dir, c));
    expect(back.top).toBeCloseTo(50, 6);
    expect(back.side).toBeCloseTo(-30, 6);
    expect(back.cork).toBeCloseTo(20, 6);
  });
});

describe('table bounce', () => {
  it('meets the ITTF table rule: dropped from 30 cm it rebounds about 23 cm', () => {
    const top = TABLE.height + BALL.radius;
    const sim = new BallSim({ pos: v3(0, top + 0.3, 0.5), vel: v3(), spin: v3() }, P);
    let bounced = false;
    let peak = 0;
    for (let i = 0; i < 240 * 2; i++) {
      const ev: BallEvent[] = [];
      sim.step(1 / 240, ev);
      if (ev.some((e) => e.type === 'table')) bounced = true;
      if (bounced) peak = Math.max(peak, sim.state.pos.y - top);
    }
    expect(peak).toBeGreaterThan(0.22);
    expect(peak).toBeLessThan(0.245);
  });

  const bounce = (spin: { top: number; side: number; cork: number }) => {
    const vel = v3(0, -3, 8);
    const s: BallState = { pos: v3(0, TABLE.height + 0.15, 0.3), vel, spin: spinVector(vel, spin) };
    const { events } = predict(s, P, { stop: (e) => e.type === 'table' });
    const ev = events.find((e) => e.type === 'table');
    if (ev?.type !== 'table') throw new Error('no bounce');
    return ev;
  };

  it('backspin checks up and topspin kicks forward', () => {
    const flat = bounce(noSpin).velOut.z;
    const top = bounce({ ...noSpin, top: 120 }).velOut.z;
    const back = bounce({ ...noSpin, top: -100 }).velOut.z;
    expect(top).toBeGreaterThan(flat);
    expect(back).toBeLessThan(flat - 1);
  });

  it('a no-spin ball picks up topspin from the table', () => {
    const ev = bounce(noSpin);
    expect(spinComponents(ev.velOut, ev.spinOut).top).toBeGreaterThan(10);
  });

  it('corkscrew spin kicks the ball sideways off the bounce', () => {
    const ev = bounce({ ...noSpin, cork: 80 });
    // Travelling +z, the hitter's right is −x.
    expect(ev.velOut.x).toBeLessThan(-0.3);
  });
});

describe('net', () => {
  it('stops a ball driven into the mesh', () => {
    const s: BallState = { pos: v3(0, TABLE.height + 0.08, -0.5), vel: v3(0, 0, 10), spin: v3() };
    const { events } = predict(s, P, { maxTime: 1 });
    expect(events.some((e) => e.type === 'net' && e.part === 'mesh')).toBe(true);
    expect(events.some((e) => e.type === 'table' && e.side === 'near')).toBe(false);
  });

  it('does not tunnel through the net at smash speed', () => {
    const s: BallState = { pos: v3(0.2, TABLE.height + 0.1, -0.6), vel: v3(0, 0, 35), spin: v3() };
    const sim = new BallSim(s, P);
    for (let i = 0; i < 240; i++) sim.step(1 / 240);
    expect(sim.state.pos.z).toBeLessThan(0.05);
  });

  it('a ball clipping the tape is deflected and reported', () => {
    const s: BallState = { pos: v3(0, NET.top + 0.012, -0.1), vel: v3(0, 0, 6), spin: v3() };
    const { events } = predict(s, P, { maxTime: 1 });
    expect(events.some((e) => e.type === 'net' && e.part === 'tape')).toBe(true);
  });
});

describe('ball machine aim solver', () => {
  it.each([
    ['push', 5, { top: -40, side: 0, cork: 0 }, { x: 0.2, z: 0.4 }],
    ['loop', 16, { top: 120, side: 0, cork: 0 }, { x: -0.3, z: 1.1 }],
    ['sidespin', 10, { top: 30, side: 60, cork: 0 }, { x: 0.4, z: 0.9 }],
    ['chop', 9, { top: -100, side: 0, cork: 0 }, { x: 0, z: 1.0 }],
  ])('%s lands within 3 cm of the target', (_name, speed, spin, target) => {
    const res = solveAim(ORIGIN, target, speed, spin, P);
    expect(res.ok).toBe(true);
    const land = landingOf({ speed, elevation: res.elevation, azimuth: res.azimuth, spin });
    expect(land.type).toBe('table');
    expect(Math.hypot(land.pos.x - target.x, land.pos.z - target.z)).toBeLessThan(0.03);
  });

  it('launchState produces the requested speed', () => {
    const s = launchState(ORIGIN, { speed: 20, elevation: 10, azimuth: 5, spin: noSpin });
    expect(Math.hypot(s.vel.x, s.vel.y, s.vel.z)).toBeCloseTo(20, 9);
  });
});
