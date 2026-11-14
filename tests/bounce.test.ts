import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, TABLE, v3, type BallEvent } from '../src/physics';

/** A steep, slow, heavily backspun ball dropping onto the far half (one that used to come back). */
function bounce(keep: number) {
  const P = { ...DEFAULT_PARAMS, tableBounceKeep: keep };
  const sim = new BallSim({ pos: v3(0, TABLE.height + 0.6, -0.5), vel: v3(0, -3, -1.8), spin: v3(450, 0, 0) }, P);
  type TableEvent = Extract<BallEvent, { type: 'table' }>;
  let out: TableEvent | undefined;
  for (let i = 0; i < 240 && !out; i++) {
    const ev: BallEvent[] = [];
    sim.step(1 / 240, ev);
    out = ev.find((e): e is TableEvent => e.type === 'table');
  }
  return out!;
}

describe('table bounce with heavy backspin', () => {
  it('pure physics: it can check back toward the net', () => {
    expect(bounce(0).velOut.z).toBeGreaterThan(0);
  });

  it('with the gameplay rule it still checks up hard, but keeps going', () => {
    const b = bounce(0.35);
    expect(b.velOut.z).toBeLessThan(0);
    expect(Math.abs(b.velOut.z)).toBeLessThan(Math.abs(b.velIn.z) * 0.5);
  });
});
