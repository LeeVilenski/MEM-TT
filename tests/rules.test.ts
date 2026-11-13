import { describe, expect, it } from 'vitest';
import { TABLE, v3, type BallEvent } from '../src/physics';
import { RallyReferee, Scoreboard, checkServe, type RallyOutcome } from '../src/game/rules';
import type { SideId } from '../src/game/frame';

const z = (side: SideId, depth = 0.6) => (side === 'near' ? depth : -depth);
const table = (side: SideId): BallEvent => ({ type: 'table', time: 0, pos: v3(0, TABLE.height, z(side)), side, impactSpeed: 3, velIn: v3(), velOut: v3(), spinIn: v3(), spinOut: v3() });
const floor = (zPos: number): BallEvent => ({ type: 'floor', time: 0, pos: v3(0, 0, zPos) });
const paddle: BallEvent = { type: 'paddle', time: 0, pos: v3(), paddleId: 'x', face: 'front', impactSpeed: 3, paddleVel: v3(), velIn: v3(), velOut: v3(), spinIn: v3(), spinOut: v3() };
const net: BallEvent = { type: 'net', time: 0, pos: v3(), part: 'tape' };
const goodServe = { tossHeight: 0.4, ballVy: -2, localPos: { y: 1, z: 1.5 } };

function rally(server: SideId, steps: [BallEvent, Parameters<RallyReferee['onEvent']>[1]?][]): RallyOutcome | null {
  const r = new RallyReferee(server);
  let out: RallyOutcome | null = null;
  for (const [e, ctx] of steps) {
    out = r.onEvent(e, ctx) ?? out;
    if (out) break;
  }
  return out;
}

describe('rally referee', () => {
  it('scores a normal rally that ends with a ball hit long', () => {
    const out = rally('near', [
      [paddle, { hitter: 'near', serve: goodServe }],
      [table('near')],
      [table('far')],
      [paddle, { hitter: 'far' }],
      [table('near')],
      [paddle, { hitter: 'near' }],
      [floor(-3)], // long
    ]);
    expect(out).toEqual({ kind: 'point', result: expect.objectContaining({ winner: 'far', reason: 'out' }) });
  });

  it('a serve that touches the net and lands is a let', () => {
    expect(rally('near', [[paddle, { hitter: 'near', serve: goodServe }], [table('near')], [net], [table('far')]])).toEqual({ kind: 'let' });
  });

  it('a serve that does not bounce on the server’s half first is a fault', () => {
    const out = rally('far', [[paddle, { hitter: 'far', serve: goodServe }], [table('near')]]);
    expect(out?.kind === 'point' && out.result.winner).toBe('near');
  });

  it('flags illegal serves', () => {
    expect(checkServe({ ...goodServe, tossHeight: 0.1 })).toMatch(/16 cm/);
    expect(checkServe({ ...goodServe, ballVy: 1 })).toMatch(/rising/);
    expect(checkServe({ ...goodServe, localPos: { y: 1, z: 1.2 } })).toMatch(/end line/);
    expect(checkServe({ ...goodServe, localPos: { y: 0.7, z: 1.5 } })).toMatch(/below/);
    const out = rally('near', [[paddle, { hitter: 'near', serve: { ...goodServe, tossHeight: 0.05 } }]]);
    expect(out?.kind === 'point' && out.result.reason).toBe('illegal-serve');
  });

  it('an unreturned serve is an ace; a double bounce loses the point', () => {
    const out = rally('near', [[paddle, { hitter: 'near', serve: goodServe }], [table('near')], [table('far')], [table('far')]]);
    expect(out).toEqual({ kind: 'point', result: expect.objectContaining({ winner: 'near', reason: 'double-bounce', ace: true }) });
  });

  it('volley: obstruction if the ball would have landed, otherwise the volleyer wins', () => {
    const base: [BallEvent, Parameters<RallyReferee['onEvent']>[1]?][] = [[paddle, { hitter: 'near', serve: goodServe }], [table('near')], [table('far')], [paddle, { hitter: 'far' }]];
    const obstruct = rally('near', [...base, [paddle, { hitter: 'near', volleyWouldLand: true }]]);
    expect(obstruct?.kind === 'point' && obstruct.result).toMatchObject({ winner: 'far', reason: 'obstruction' });
    const goingOut = rally('near', [...base, [paddle, { hitter: 'near', volleyWouldLand: false }]]);
    expect(goingOut?.kind === 'point' && goingOut.result).toMatchObject({ winner: 'near', reason: 'volley-out' });
  });

  it('a return that bounces on the hitter’s own half loses', () => {
    const out = rally('near', [[paddle, { hitter: 'near', serve: goodServe }], [table('near')], [table('far')], [paddle, { hitter: 'far' }], [table('far')]]);
    expect(out?.kind === 'point' && out.result).toMatchObject({ winner: 'near', reason: 'own-side' });
  });

  it('exposes who should hit next', () => {
    const r = new RallyReferee('near');
    expect(r.expectedHitter).toBe('near');
    r.onEvent(paddle, { hitter: 'near', serve: goodServe });
    expect(r.ballHeadingTo).toBe('far');
    r.onEvent(table('near'));
    r.onEvent(table('far'));
    expect(r.expectedHitter).toBe('far');
  });
});

describe('scoreboard', () => {
  it('rotates serve every 2 points, every point from 10–10', () => {
    const s = new Scoreboard({ bestOf: 3, pointsToWin: 11, firstServer: 'near' });
    const servers: SideId[] = [];
    for (let i = 0; i < 6; i++) {
      servers.push(s.server);
      s.award(i % 2 === 0 ? 'near' : 'far');
    }
    expect(servers).toEqual(['near', 'near', 'far', 'far', 'near', 'near']);
    s.points = { near: 10, far: 10 };
    const a = s.server;
    s.award('near');
    expect(s.server).not.toBe(a);
    s.award('far');
    expect(s.server).toBe(a);
    expect(s.deuce).toBe(true);
  });

  it('wins a game by 2 and alternates the first server each game', () => {
    const s = new Scoreboard({ bestOf: 3, pointsToWin: 11, firstServer: 'near' });
    s.points = { near: 10, far: 9 };
    expect(s.gamePoint()).toBe('near');
    expect(s.award('near')).toEqual({ game: true, match: false });
    expect(s.games.near).toBe(1);
    expect(s.server).toBe('far');
    s.points = { near: 10, far: 10 };
    expect(s.award('near').game).toBe(false);
    s.games.near = 1;
    expect(s.matchPoint()).toBe('near');
    expect(s.award('near')).toEqual({ game: true, match: true });
    expect(s.winner).toBe('near');
  });
});
