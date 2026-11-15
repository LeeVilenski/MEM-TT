import { describe, expect, it } from 'vitest';
import { spinComponents } from '../src/physics';
import { playBall } from './helpers/practice';
import type { Player } from '../src/game/player';

/** Sidespin (rps, + = right) and landing of a rally stroke against a machine ball. */
function stroke(preset: string, flickPx: number, opts: Parameters<typeof playBall>[4] = {}) {
  const r = playBall(preset, 0.75, 2 / 60, flickPx, opts);
  const h = r.hit!;
  return { result: r.result, landing: r.landing, side: spinComponents(h.velOut, h.spinOut).side };
}

describe('sideways swipe → sidespin', () => {
  for (const [preset, px] of [['Push', 60], ['Chop', 60]] as const) {
    it(`${preset}: angling the stroke brushes sidespin as well as aiming`, () => {
      const straight = stroke(preset, px);
      const right = stroke(preset, px, { flickDx: 40 });
      const left = stroke(preset, px, { flickDx: -40 });
      // Swiping up-right brushes the back of the ball to the right: it curves left (−), like A.
      expect(right.side - straight.side).toBeLessThan(-12);
      expect(left.side - straight.side).toBeGreaterThan(12);
      // It still aims, and still lands.
      for (const s of [right, left]) expect(s.result).toBe('IN');
      expect(right.landing!.x).toBeGreaterThan(0.2);
      expect(left.landing!.x).toBeLessThan(-0.2);
    });
  }

  it('no swipe hook when it is switched off: the angle only aims', () => {
    const off = (p: Player) => (p.swing.params.swipeHook = 0);
    const straight = stroke('Push', 60, { setup: off });
    const right = stroke('Push', 60, { flickDx: 40, setup: off });
    expect(Math.abs(right.side - straight.side)).toBeLessThan(8);
  });
});
