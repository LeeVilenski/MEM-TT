import { describe, expect, it } from 'vitest';
import { playBall } from './helpers/practice';
import { smashQuality } from '../src/game/player';
import { mulberry32 } from './helpers/rng';

describe('smash', () => {
  it('quality rises with contact height', () => {
    expect(smashQuality(0.05)).toBe(0);
    expect(smashQuality(0.25)).toBeGreaterThan(0.3);
    expect(smashQuality(0.5)).toBe(1);
  });

  function rate(preset: string, n = 30) {
    let made = 0;
    let fast = 0;
    for (let i = 0; i < n; i++) {
      const rng = mulberry32(100 + i);
      const r = playBall(preset, 0.75, 2 / 60, 40, { smash: true, setup: (p) => (p.applyRealism(0.85), (p.rng = rng)) });
      if (r.result === 'IN') made++;
      if (r.shot && r.shot.speed > 12) fast++;
    }
    return { made: made / n, fast: fast / n };
  }

  it('a high ball is a near-certain kill; a low one is a gamble', () => {
    const high = rate('Lob');
    const low = rate('Push');
    expect(high.made).toBeGreaterThan(0.85);
    expect(high.fast).toBeGreaterThan(0.85);
    expect(low.made).toBeLessThan(high.made - 0.25);
  }, 60000);
});
