import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics';
import { AI_LEVELS, AiPlayer, type AiLevel } from '../src/game/ai';
import { Match } from '../src/game/match';
import type { PointReason } from '../src/game/rules';

/** Deterministic PRNG so match tests are reproducible. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function aiMatch(near: AiLevel, far: AiLevel, seed: number, bestOf = 1) {
  const P = DEFAULT_PARAMS;
  const rng = mulberry32(seed);
  const m = new Match(P, {
    near: { kind: 'ai', ai: new AiPlayer('near', AI_LEVELS[near], P, rng) },
    far: { kind: 'ai', ai: new AiPlayer('far', AI_LEVELS[far], P, rng) },
  }, { bestOf, pointsToWin: 11, firstServer: 'near' });
  const reasons: Partial<Record<PointReason, number>> = {};
  let lets = 0;
  m.on((e) => {
    if (e.type === 'point') reasons[e.result.reason] = (reasons[e.result.reason] ?? 0) + 1;
    if (e.type === 'let') lets++;
  });
  for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'match-over'; i++) m.frame(1 / 60, 1 / 60);
  return { m, reasons, lets };
}

describe('AI vs AI matches', () => {
  it('plays a complete game with real rallies and legal serves', () => {
    const { m, reasons, lets } = aiMatch('medium', 'medium', 1);
    console.log('score', m.score.history, 'reasons', reasons, 'lets', lets, 'stats', m.stats);
    expect(m.phase).toBe('match-over');
    expect(m.score.winner).not.toBeNull();
    const avgHits = m.stats.hits / m.stats.rallies;
    expect(avgHits).toBeGreaterThan(3); // serve + at least one exchange on average
    expect(reasons['illegal-serve'] ?? 0).toBe(0);
    expect(reasons['obstruction'] ?? 0).toBe(0);
  });

  it('a hard AI beats an easy AI', () => {
    let hardPoints = 0;
    let easyPoints = 0;
    for (const seed of [2, 3]) {
      const { m } = aiMatch('hard', 'easy', seed);
      for (const g of m.score.history) {
        hardPoints += g.near;
        easyPoints += g.far;
      }
    }
    console.log('hard', hardPoints, 'easy', easyPoints);
    expect(hardPoints).toBeGreaterThan(easyPoints);
  }, 30000);
});

import { Player } from '../src/game/player';
import { NO_INPUT, REACH } from '../src/game/swing';
import { TABLE as T } from '../src/physics';

describe('human player in a match (scripted input through the real pipeline)', () => {
  function humanMatch(seed: number) {
    const P = DEFAULT_PARAMS;
    const player = new Player('p1', P);
    const m = new Match(P, { near: { kind: 'human', player }, far: { kind: 'ai', ai: new AiPlayer('far', AI_LEVELS.medium, P, mulberry32(seed)) } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    const log: string[] = [];
    m.on((e) => {
      if (e.type === 'hit') log.push(`${e.side}${e.serve ? ':serve' : ''}`);
      if (e.type === 'point') log.push(`point:${e.result.winner}:${e.result.reason}`);
    });
    return { m, player, log, sens: player.swing.params.sensitivity };
  }

  it('serves legally: toss, then a downward flick as the ball drops', () => {
    const { m, player, log, sens } = humanMatch(5);
    let flick = 0;
    let served = false;
    for (let f = 0; f < 60 * 4 && !log.some((l) => l.startsWith('point')); f++) {
      const input = { ...NO_INPUT };
      if (m.humanToServe) {
        // Get the paddle ~12 cm above the table first, then toss.
        const dy = player.swing.y - (T.height + 0.12);
        if (Math.abs(dy) > 0.01) input.dy = Math.max(-10, Math.min(10, dy / sens));
        else m.toss(0.45);
      } else if (m.sim && !served && m.sim.state.vel.y < 0 && m.sim.state.pos.y - player.swing.y < 0.2) {
        flick = 3;
        served = true;
      }
      if (flick > 0) {
        input.dy = 25; // gentle downward stroke (~1500 px/s) → backspin serve
        flick--;
      }
      m.frame(1 / 60, 1 / 60, { side: 'near', input, move: { x: 0, z: 0 } });
    }
    console.log('serve log', log.join(' '));
    expect(log[0]).toBe('near:serve');
    // The serve was legal and landed: the AI got to play it, or it was an ace.
    expect(log.some((l) => l.startsWith('point:far:illegal') || l.includes('serve-'))).toBe(false);
  });

  it('a scripted human can rally with the AI', () => {
    const { m, player, log, sens } = humanMatch(6);
    let flick = 0;
    let flickedFor = -1;
    for (let f = 0; f < 60 * 120 && m.score.points.near + m.score.points.far < 6; f++) {
      const input = { ...NO_INPUT };
      if (m.humanToServe) {
        const dy = player.swing.y - (T.height + 0.12);
        if (Math.abs(dy) > 0.01) input.dy = Math.max(-10, Math.min(10, dy / sens));
        else m.toss(0.45);
      } else if (m.sim && m.referee && m.referee.hits === 0 && m.server === 'near' && flickedFor !== m.stats.rallies && m.sim.state.vel.y < 0 && m.sim.state.pos.y - player.swing.y < 0.2) {
        flick = 3;
        flickedFor = m.stats.rallies;
      } else {
        const ic = m.interceptFor('near');
        const pred = (m as unknown as { incoming: { near?: { interceptAt: (z: number, t: number, h: number) => { t: number } | null } } }).incoming.near;
        const icT = pred?.interceptAt(player.restZ, m.ballTime, REACH.maxHeight - 0.05);
        if (ic && icT) {
          player.swing.basePitch = -25;
          if (icT.t - m.ballTime <= 2 / 60 && flick === 0 && flickedFor !== m.stats.hits) {
            flick = 3;
            flickedFor = m.stats.hits;
          } else if (flick === 0) {
            const lim = 13;
            input.dx = Math.max(-lim, Math.min(lim, (ic.x - player.swing.pose.pos.x) / sens));
            input.dy = Math.max(-lim, Math.min(lim, -(ic.y - player.swing.y) / sens));
          }
        }
      }
      if (flick > 0) {
        input.dy = m.referee?.hits === 0 ? 25 : -60;
        flick--;
      }
      m.frame(1 / 60, 1 / 60, { side: 'near', input, move: { x: 0, z: 0 } });
    }
    console.log('rally log', log.join(' '));
    const humanReturns = log.filter((l) => l === 'near').length;
    expect(humanReturns).toBeGreaterThan(0);
    expect(m.score.points.near + m.score.points.far).toBeGreaterThan(0);
  });
});
