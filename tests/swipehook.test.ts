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

const real = (p: Player) => (p.swing.params.swipeMode = 'real');

describe('sideways swipe → sidespin', () => {
  for (const [preset, px] of [['Push', 60], ['Chop', 60]] as const) {
    it(`${preset}: 'real' brush: angling the stroke brushes sidespin as well as aiming`, () => {
      const straight = stroke(preset, px, { setup: real });
      const right = stroke(preset, px, { flickDx: 40, setup: real });
      const left = stroke(preset, px, { flickDx: -40, setup: real });
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

  it("'curve' (default): the ball bends in toward the aim", () => {
    const straight = stroke('Push', 60);
    const right = stroke('Push', 60, { flickDx: 40 });
    const left = stroke('Push', 60, { flickDx: -40 });
    expect(right.side - straight.side).toBeGreaterThan(12);
    expect(left.side - straight.side).toBeLessThan(-12);
    for (const s of [right, left]) expect(s.result).toBe('IN');
    expect(right.landing!.x).toBeGreaterThan(0.2);
    expect(left.landing!.x).toBeLessThan(-0.2);
  });

  it("'spin': sidespin without aiming", () => {
    const spin = (p: Player) => (p.swing.params.swipeMode = 'spin');
    const straight = stroke('Push', 60, { setup: spin });
    const right = stroke('Push', 60, { flickDx: 40, setup: spin });
    expect(right.side - straight.side).toBeLessThan(-12);
    expect(Math.abs(right.landing!.x - straight.landing!.x)).toBeLessThan(0.2);
  });
});

describe('angled swipes still land', () => {
  // A regression test for angled strokes going wide: the contact assist gave up on a stroke
  // heading off the side instead of turning it back toward the table.
  const presets: [string, number][] = [['Push', 60], ['Long push', 60], ['Chop', 60], ['Block', 50], ['Drive', 50], ['Float', 50], ['Opening loop', 45], ['Hook loop', 45]];
  const rate = (dx: number, mode: Player['swing']['params']['swipeMode']) => {
    let made = 0;
    let n = 0;
    for (const [p, px] of presets)
      for (const s of dx ? [1, -1] : [1])
        for (const lead of [1 / 60, 3 / 60, 5 / 60]) {
          const r = playBall(p, 0, lead, px, { flickDx: dx * s, setup: (pl) => (pl.applyRealism(0.85), (pl.swing.params.swipeMode = mode)) });
          n++;
          if (r.result === 'IN') made++;
        }
    return made / n;
  };
  it('at Assisted, angled swipes land about as often as straight ones, in every swipe mode', () => {
    const straight = rate(0, 'curve');
    for (const mode of ['curve', 'real', 'aim', 'spin'] as const) expect(rate(40, mode), mode).toBeGreaterThan(straight - 0.1);
  }, 60_000);
});
