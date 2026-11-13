import { describe, expect, it } from 'vitest';
import { SwingController, NO_INPUT } from '../src/game/swing';
import { realismSettings } from '../src/game/realism';
import { hitPower } from '../src/render/juice';
import { playBall, FPS } from './helpers/practice';
import type { Player } from '../src/game/player';
import { TABLE } from '../src/physics';

const body = { x: 0, z: TABLE.halfLength + 0.6 };
const aim = { x: 0, z: -0.85 };

describe('perfect timing', () => {
  it('times the stroke from the flick itself, not the smoothed swing memory', () => {
    const s = new SwingController();
    s.reset(0.3, TABLE.height + 0.2, body.z - 0.42, body.x);
    const dt = 1 / FPS;
    expect(s.strokePeakAge).toBe(Infinity);
    for (let i = 0; i < 3; i++) s.update(dt, { ...NO_INPUT, dy: -60 }, body, body.z - 0.42, aim);
    expect(s.strokePeakAge).toBe(0);
    for (let i = 0; i < 6; i++) s.update(dt, NO_INPUT, body, body.z - 0.42, aim);
    expect(s.strokePeakAge).toBeCloseTo(6 * dt, 5);
  });

  it('slow positioning is not a flick', () => {
    const s = new SwingController();
    s.reset(0.3, TABLE.height + 0.2, body.z - 0.42, body.x);
    for (let i = 0; i < 10; i++) s.update(1 / FPS, { ...NO_INPUT, dx: 8, dy: 4 }, body, body.z - 0.42, aim);
    expect(s.strokePeakAge).toBe(Infinity);
  });

  it('a flick right at contact is perfect; one well before it is not', () => {
    const perfectAt = (lead: number) => {
      let pl: Player | null = null;
      playBall('Drive', 0.75, lead / FPS, 40, { setup: (p) => (p.applyRealism(0.85), (pl = p)) });
      return pl!.lastContactPerfect;
    };
    expect(perfectAt(3)).toBe(true);
    expect(perfectAt(9)).toBe(false);
  });

  it('the pace bonus is arcade-only', () => {
    expect(realismSettings(0).perfectBonus).toBe(0);
    expect(realismSettings(0.4).perfectBonus).toBe(0);
    expect(realismSettings(0.75).perfectBonus).toBeGreaterThan(0);
  });
});

describe('arcade effects', () => {
  it('hit power grows with ball speed and is clamped to 0–1', () => {
    expect(hitPower(4)).toBe(0);
    expect(hitPower(12)).toBeGreaterThan(0);
    expect(hitPower(20)).toBeGreaterThan(hitPower(12));
    expect(hitPower(60)).toBe(1);
  });
});
