import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { Player } from '../src/game/player';
import { AiPlayer, AI_LEVELS } from '../src/game/ai';
import { NO_INPUT } from '../src/game/swing';
import { classifyShot } from '../src/game/shots';
import type { ServeType } from '../src/game/serves';
import { DEFAULT_PARAMS as P, TABLE } from '../src/physics';
import { PLAYABLE_STYLE_IDS, STYLES, type StyleId } from '../src/game/styles';
import { mulberry32 } from './helpers/rng';

/** Serve through the real match pipeline: toss, then a 3-frame flick (dx, dy px/frame) as the ball drops. */
function serve(type: ServeType, dx: number, dy: number, seed: number, flickAt = 0.15, bodyX = -0.2, style?: StyleId) {
  const human = new Player('h', { ...P });
  // Standing where the character plays from.
  if (style) ((human.applyStyle(style)), (human.body.z = human.homeZ));
  // Serving from near the middle by default (the default stance puts the bat at the forehand edge).
  human.body.x = bodyX;
  human.applyRealism(0.75);
  human.serveType = type;
  const m = new Match(P, { near: { kind: 'human', player: human }, far: { kind: 'ai', ai: new AiPlayer('far', AI_LEVELS.medium, P, mulberry32(seed)) } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
  let outcome = '';
  let detail = '';
  let top = 0;
  let side = 0;
  m.on((e) => {
    if (e.type === 'hit' && e.serve) {
      const i = classifyShot(e.event.pos, e.event.velOut, e.event.spinOut, e.event.paddleVel, e.event.velIn, e.event.spinIn);
      top = i.top;
      side = i.side;
    }
    if (e.type === 'point' && !outcome) ((outcome = e.result.reason), (detail = e.result.detail ?? ''));
    if (e.type === 'hit' && e.side === 'far' && !outcome) outcome = 'returned';
  });
  human.swing.y = TABLE.height + 0.15;
  m.frame(1 / 60, 1 / 60);
  m.toss(0.3 + (seed % 4) * 0.08);
  let flick = 0;
  for (let i = 0; i < 400 && !outcome; i++) {
    const b = m.sim?.state;
    const input = { ...NO_INPUT };
    if (flick === 0 && b && b.vel.y < 0 && b.pos.y - human.swing.pose.pos.y < flickAt) flick = 3;
    if (flick > 0) {
      input.dx = dx;
      input.dy = dy;
      if (--flick === 0) flick = -1;
    }
    m.frame(1 / 60, 1 / 60, { side: 'near', input, move: { x: 0, z: 0 } });
  }
  const legal = outcome === 'returned' || outcome === 'ace' || outcome === 'not-returned' || outcome === 'double-bounce';
  return { legal, outcome, detail, top, side };
}

function run(type: ServeType, dx: number, dy: number, bodyX = -0.2) {
  const r = Array.from({ length: 8 }, (_, i) => serve(type, dx, dy, i + 1, 0.15, bodyX));
  const ok = r.filter((x) => x.legal);
  const avg = (f: (x: (typeof r)[0]) => number) => ok.reduce((s, x) => s + f(x), 0) / Math.max(1, ok.length);
  return { legal: ok.length, top: avg((x) => x.top), side: avg((x) => x.side) };
}

describe('serves', { timeout: 60000 }, () => {
  it('every character serves from behind the end line, even tight to the table (Bryony)', () => {
    expect(STYLES.wheelchair.distance).toBeLessThan(0.42); // closer than the bat's reach in front of the body
    for (const id of PLAYABLE_STYLE_IDS) {
      const r = Array.from({ length: 4 }, (_, i) => serve('backspin', 0, 40, i + 1, 0.15, -0.2, id));
      for (const x of r) expect(x.detail, id).not.toMatch(/end line/);
      expect(r.filter((x) => x.legal).length, id).toBeGreaterThanOrEqual(3);
    }
  });

  it('a backspin serve lands with heavy backspin, more for a harder swipe', () => {
    const gentle = run('backspin', 0, 20);
    const hard = run('backspin', 0, 90);
    expect(gentle.legal).toBeGreaterThanOrEqual(7);
    expect(hard.legal).toBeGreaterThanOrEqual(7);
    expect(hard.top).toBeLessThan(-50); // rps: over 3,000 rpm of backspin
    expect(hard.top).toBeLessThan(gentle.top);
  });

  it('a sidespin serve curves the way it was swiped', () => {
    const left = run('sidespin', -90, 60);
    const right = run('sidespin', 90, 60);
    expect(left.legal).toBeGreaterThanOrEqual(7);
    expect(right.legal).toBeGreaterThanOrEqual(6);
    expect(Math.sign(left.side)).toBe(-Math.sign(right.side));
    expect(Math.abs(left.side)).toBeGreaterThan(15);
    expect(Math.abs(right.side)).toBeGreaterThan(15);
  });

  it('a sidespin brushed out from the forehand edge is still a legal serve', () => {
    expect(run('sidespin', 90, 60, 0.25).legal).toBeGreaterThanOrEqual(7);
  });

  it('topspin, fast and no-spin serves land and have the spin they promise', () => {
    const top = run('topspin', 0, -60);
    const fast = run('fast', 0, 60);
    const float = run('float', 0, 60);
    expect(top.legal).toBeGreaterThanOrEqual(7);
    expect(top.top).toBeGreaterThan(35);
    expect(fast.legal).toBeGreaterThanOrEqual(7);
    expect(float.legal).toBeGreaterThanOrEqual(7);
    expect(Math.abs(float.top)).toBeLessThan(10);
  });

  it('a free serve keeps its spin: a hard downward flick is real backspin', () => {
    const hard = run('auto', 0, 90);
    expect(hard.legal).toBeGreaterThanOrEqual(7);
    expect(hard.top).toBeLessThan(-30);
  });

  it('without a swing, the ball is not served off a still bat', () => {
    const r = serve('backspin', 0, 0, 1);
    expect(r.legal).toBe(false);
  });
});
