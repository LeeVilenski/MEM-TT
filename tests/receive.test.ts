import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, launchState, solveAim, v3 } from '../src/physics';
import { landingOutcome } from '../src/game/assist';
import { AI_LEVELS, AiPlayer, type AiLevel } from '../src/game/ai';
import { TOSS_ILLEGAL_FRACTION, serveReport, tossEffect, tossHeightFor } from '../src/game/serves';
import { checkServe } from '../src/game/rules';
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;

/** A short serve-like ball from the far end (the AI receives at the near end). */
function serveBall(topRps: number, sideRps = 0) {
  const origin = v3(0.1, TABLE.height + 0.12, -TABLE.halfLength - 0.1);
  const target = { x: 0.2, z: 0.45 };
  const spin = { top: topRps, side: sideRps, cork: 0 };
  const aim = solveAim(origin, target, 5, spin, P);
  return launchState(origin, { speed: 5, elevation: aim.elevation, azimuth: aim.azimuth, spin });
}

/** Share of returns that land, receiving `ball` as a serve (or as a rally ball). */
function returns(level: AiLevel, ball: ReturnType<typeof serveBall>, serve: boolean, seeds = 30) {
  let lands = 0;
  let n = 0;
  for (let seed = 1; seed <= seeds; seed++) {
    const ai = new AiPlayer('near', AI_LEVELS[level], P, mulberry32(seed));
    const plan = ai.planReturn(ball, 0, { serve });
    if (!plan) continue;
    const sim = new BallSim(ball, P);
    while (sim.time < plan.t - 1e-6) sim.step(TICK_DT);
    n++;
    if (landingOutcome(sim.state, plan, plan.normal, ai.rubber, P).outcome === 'in') lands++;
  }
  return lands / Math.max(1, n);
}

describe('receiving serves', () => {
  it('spinny serves are returned less often than the same ball in a rally (the spin is misread)', () => {
    let rally = 0;
    let serve = 0;
    for (const ball of [serveBall(-70), serveBall(0, 50)])
      for (const level of ['easy', 'medium', 'hard'] as AiLevel[]) {
        rally += returns(level, ball, false, 20);
        serve += returns(level, ball, true, 20);
      }
    expect(serve).toBeLessThan(rally - 0.5);
  }, 60000);

  it('heavy backspin is misjudged more by Easy than by Expert', () => {
    const chop = serveBall(-70);
    expect(returns('expert', chop, true)).toBeGreaterThan(returns('easy', chop, true));
  });

  it('the same serve over and over gets read better', () => {
    const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(7));
    const chop = serveBall(-60);
    const err: number[] = [];
    for (let i = 0; i < 12; i++) {
      ai.planReturn(chop, 0, { serve: true });
      err.push(Math.abs(ai.lastRead!.seenTop - ai.lastRead!.top) / Math.abs(ai.lastRead!.top));
    }
    const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;
    expect(mean(err.slice(6))).toBeLessThan(mean(err.slice(0, 4)));
  });

  it('rally balls are read exactly', () => {
    const ai = new AiPlayer('near', AI_LEVELS.easy, P, mulberry32(3));
    ai.planReturn(serveBall(-60), 0);
    expect(ai.lastRead).toBeNull();
  });
});

describe('serve report and toss', () => {
  it('rates a low, short, spinny serve above a high one', () => {
    const low = serveReport(serveLaunch(-55, 0.03), P);
    const high = serveReport(serveLaunch(-10, 0.3), P);
    expect(low.length).not.toBe('fault');
    expect(low.rating).toBeGreaterThan(high.rating);
    expect(low.text).toMatch(/rpm|spin/);
  });

  it('a quick tap is an illegal toss; a high toss is tighter but spinnier', () => {
    expect(tossHeightFor(TOSS_ILLEGAL_FRACTION * 0.5)).toBeLessThan(0.16);
    expect(checkServe({ tossHeight: tossHeightFor(0.02), ballVy: -1, localPos: { y: TABLE.height + 0.1, z: TABLE.halfLength + 0.1 } })).toMatch(/Toss/);
    expect(tossHeightFor(0.5)).toBeGreaterThan(0.16);
    expect(tossEffect(1).window).toBeLessThan(tossEffect(0.3).window);
    expect(tossEffect(1).power).toBeGreaterThan(tossEffect(0.3).power);
  });
});

/** A serve struck at the near end (server's frame: server at +z), bouncing on its own half first. */
function serveLaunch(topRps: number, apex: number) {
  // Search a launch that bounces near the server's end line, then on the far half.
  const origin = v3(0, TABLE.height + 0.1, TABLE.halfLength + 0.15);
  const spin = { top: topRps, side: 0, cork: 0 };
  let best = launchState(origin, { speed: 4, elevation: 0, azimuth: 0, spin });
  let bestErr = Infinity;
  for (let speed = 2.5; speed <= 8; speed += 0.25)
    for (let el = -40; el <= 30; el += 2) {
      const st = launchState(origin, { speed, elevation: el, azimuth: 180, spin });
      const r = serveReport(st, P);
      if (r.length === 'fault' || r.clearance === null) continue;
      const err = Math.abs(r.clearance - apex);
      if (err < bestErr) ((bestErr = err), (best = st));
    }
  return best;
}
