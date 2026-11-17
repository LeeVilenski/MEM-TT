import { describe, expect, it } from 'vitest';
import { Match } from '../src/game/match';
import { Player } from '../src/game/player';
import { AiPlayer, AI_LEVELS } from '../src/game/ai';
import { NO_INPUT } from '../src/game/swing';
import { classifyShot } from '../src/game/shots';
import { aimPoint, serveAim, serveDemand, serveRisk, type ServeType } from '../src/game/serves';
import { DEFAULT_PARAMS as P, TABLE, v3 } from '../src/physics';
import { PLAYABLE_STYLE_IDS, STYLES, type StyleId } from '../src/game/styles';
import { mulberry32 } from './helpers/rng';

interface ServeOpts {
  flickAt?: number;
  bodyX?: number;
  style?: StyleId;
  /** Realism slider (0 = simulation, 1 = arcade). */
  realism?: number;
  /** Bat height above the table before the toss: where the ball is met (low = short, high = long). */
  batY?: number;
}

/** Serve through the real match pipeline: toss, then a 3-frame flick (dx, dy px/frame) as the ball drops. */
function serve(type: ServeType, dx: number, dy: number, seed: number, o: ServeOpts = {}) {
  const human = new Player('h', { ...P });
  // Standing where the character plays from.
  if (o.style) ((human.applyStyle(o.style)), (human.body.z = human.homeZ));
  // Serving from near the middle by default (the default stance puts the bat at the forehand edge).
  human.body.x = o.bodyX ?? -0.2;
  human.applyRealism(o.realism ?? 0.75);
  human.serveType = type;
  // Repeatable execution error.
  human.rng = mulberry32(seed * 7919);
  const m = new Match(P, { near: { kind: 'human', player: human }, far: { kind: 'ai', ai: new AiPlayer('far', AI_LEVELS.medium, P, mulberry32(seed)) } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
  let outcome = '';
  let detail = '';
  let top = 0;
  let side = 0;
  let land: { x: number; z: number } | null = null;
  m.on((e) => {
    if (e.type === 'hit' && e.serve) {
      const i = classifyShot(e.event.pos, e.event.velOut, e.event.spinOut, e.event.paddleVel, e.event.velIn, e.event.spinIn);
      top = i.top;
      side = i.side;
    }
    if (e.type === 'ball' && e.event.type === 'table' && !land && e.event.pos.z < 0) land = { x: e.event.pos.x, z: e.event.pos.z };
    if (e.type === 'point' && !outcome) ((outcome = e.result.reason), (detail = e.result.detail ?? ''));
    if (e.type === 'hit' && e.side === 'far' && !outcome) outcome = 'returned';
  });
  human.swing.y = TABLE.height + (o.batY ?? 0.15);
  m.frame(1 / 60, 1 / 60);
  m.toss(0.3 + (seed % 4) * 0.08);
  let flick = 0;
  for (let i = 0; i < 400 && !outcome; i++) {
    const b = m.sim?.state;
    const input = { ...NO_INPUT };
    if (flick === 0 && b && b.vel.y < 0 && b.pos.y - human.swing.pose.pos.y < (o.flickAt ?? 0.15)) flick = 3;
    if (flick > 0) {
      input.dx = dx;
      input.dy = dy;
      if (--flick === 0) flick = -1;
    }
    m.frame(1 / 60, 1 / 60, { side: 'near', input, move: { x: 0, z: 0 } });
  }
  const legal = outcome === 'returned' || outcome === 'ace' || outcome === 'not-returned' || outcome === 'double-bounce';
  return { legal, outcome, detail, top, side, land: land as { x: number; z: number } | null, slip: human.lastServeSlip, plan: human.lastServePlan };
}

function many(type: ServeType, dx: number, dy: number, n: number, o: ServeOpts = {}) {
  return Array.from({ length: n }, (_, i) => serve(type, dx, dy, i + 1, o));
}

/**
 * Spin and legality checks, on arcade realism: there the server's execution error (which
 * faults a share of serves on purpose) is at its lowest, so a miss means the serve itself
 * doesn't work.
 */
function run(type: ServeType, dx: number, dy: number, bodyX = -0.2, n = 8) {
  const r = many(type, dx, dy, n, { bodyX, realism: 1 });
  const ok = r.filter((x) => x.legal);
  const avg = (f: (x: (typeof r)[0]) => number) => ok.reduce((s, x) => s + f(x), 0) / Math.max(1, ok.length);
  return { legal: ok.length, top: avg((x) => x.top), side: avg((x) => x.side) };
}

/** Mean landing spot of the serves that landed. */
function meanLanding(r: ReturnType<typeof many>) {
  const l = r.filter((x) => x.legal && x.land).map((x) => x.land!);
  return { x: l.reduce((s, p) => s + p.x, 0) / l.length, z: l.reduce((s, p) => s + p.z, 0) / l.length, n: l.length };
}

describe('serves', { timeout: 60000 }, () => {
  it('every character serves from behind the end line, even tight to the table (Bryony)', () => {
    expect(STYLES.wheelchair.distance).toBeLessThan(0.42); // closer than the bat's reach in front of the body
    for (const id of PLAYABLE_STYLE_IDS) {
      const r = Array.from({ length: 4 }, (_, i) => serve('backspin', 0, 40, i + 1, { style: id }));
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

  it("the swipe's angle places the serve: left, middle or right", () => {
    for (const type of ['backspin', 'auto'] as ServeType[]) {
      const left = meanLanding(many(type, -50, 60, 6));
      const mid = meanLanding(many(type, 0, 60, 6));
      const right = meanLanding(many(type, 50, 60, 6));
      expect(left.n, type).toBeGreaterThanOrEqual(4);
      expect(right.n, type).toBeGreaterThanOrEqual(4);
      expect(left.x, type).toBeLessThan(-0.3);
      expect(right.x, type).toBeGreaterThan(0.3);
      expect(Math.abs(mid.x), type).toBeLessThan(0.15);
    }
  });

  it('meeting the ball low serves short, high serves long', () => {
    for (const type of ['backspin', 'auto'] as ServeType[]) {
      const low = meanLanding(many(type, 0, 60, 6, { batY: 0.07 }));
      const high = meanLanding(many(type, 0, 60, 6, { batY: 0.3 }));
      expect(low.n, type).toBeGreaterThanOrEqual(4);
      expect(high.n, type).toBeGreaterThanOrEqual(4);
      // z is negative on the receiver's half: short is nearer the net (less negative).
      expect(low.z - high.z, type).toBeGreaterThan(0.2);
    }
  });

  it('demanding serves miss more, and less assist means more misses', () => {
    const faults = (r: ReturnType<typeof many>) => r.filter((x) => !x.legal).length;
    // Plain: a moderate flick at the type's own length. Aggressive: a hard flick, met low (very short).
    const plain = faults(many('backspin', 0, 45, 30, { realism: 0.85 }));
    const aggressive = faults(many('backspin', 0, 100, 30, { realism: 0.85, batY: 0.07 }));
    const arcade = faults(many('backspin', 0, 100, 30, { realism: 1, batY: 0.07 }));
    expect(aggressive).toBeGreaterThan(plain);
    expect(aggressive).toBeGreaterThanOrEqual(5); // about 1 in 4
    expect(plain).toBeLessThanOrEqual(5);
    expect(arcade).toBeLessThan(aggressive);
    // The risk model itself: more demand, less assist and a higher toss all add to it.
    expect(serveRisk(serveDemand(1, 0), 0.85, 0.4)).toBeGreaterThan(serveRisk(serveDemand(0.4, 0.3), 0.85, 0.4));
    expect(serveRisk(0.6, 0.55, 0.4)).toBeGreaterThan(serveRisk(0.6, 0.85, 0.4));
    expect(serveRisk(0.6, 0.85, 0.4)).toBeGreaterThan(serveRisk(0.6, 1, 0.4));
    expect(serveRisk(0.6, 0.85, 1)).toBeGreaterThan(serveRisk(0.6, 0.85, 0.4));
  });

  it('a serve misses when the server slips past its margin, and then into the net or long', () => {
    const r = many('sidespin', 100, 40, 30, { realism: 0.85, batY: 0.07 });
    const slipped = r.filter((x) => Math.abs(x.slip) > 1);
    expect(slipped.length).toBeGreaterThanOrEqual(3);
    for (const x of slipped) expect(x.legal, `slip ${x.slip.toFixed(2)}`).toBe(false);
    for (const x of r.filter((x) => !x.legal)) expect(['serve-net', 'serve-wrong-bounce', 'out', 'net']).toContain(x.outcome);
  });

  it('aims from the swing and the contact height (doubles: the right half only)', () => {
    const down = v3(0, -6, -6);
    expect(serveAim('backspin', v3(-5, -6, -6), 0.24).line).toBeLessThan(-0.8);
    expect(serveAim('backspin', v3(5, -6, -6), 0.24).line).toBeGreaterThan(0.8);
    expect(serveAim('backspin', down, 0.24).line).toBe(0);
    // Sidespin is swiped sideways: flat goes wide, steeper comes in.
    expect(Math.abs(serveAim('sidespin', v3(6, -1, -6), 0.24).line)).toBe(1);
    expect(Math.abs(serveAim('sidespin', v3(6, -5, -6), 0.24).line)).toBeLessThan(0.7);
    // Low contact is shorter; each type has its own length.
    expect(serveAim('backspin', down, 0.1).z).toBeGreaterThan(serveAim('backspin', down, 0.38).z);
    expect(serveAim('fast', down, 0.24).z).toBeLessThan(serveAim('backspin', down, 0.24).z);
    // Doubles: the receiver's right half (−x in the server's frame) whatever the line.
    for (const line of [-1, 0, 1]) {
      const p = aimPoint(line, 0.5, true);
      expect(p.x).toBeLessThan(0);
      expect(p.x).toBeGreaterThan(-TABLE.halfWidth);
    }
  });

  it('without a swing, the ball is not served off a still bat', () => {
    const r = serve('backspin', 0, 0, 1);
    expect(r.legal).toBe(false);
  });
});
