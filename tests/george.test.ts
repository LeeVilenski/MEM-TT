import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, launchState, solveAim, v3 } from '../src/physics';
import { landingOutcome } from '../src/game/assist';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Match } from '../src/game/match';
import { STYLES, PLAYABLE_STYLE_IDS, FREE_PLAY_OPPONENT_IDS, type StyleId } from '../src/game/styles';
import { PRESETS } from '../src/sandbox/presets';
import { TOUR_STOPS } from '../src/progress/tour';
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;
const ATTACK = ['loop', 'flick', 'smash', 'drive'];

function presetLaunch(pr: (typeof PRESETS)[number]) {
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
  return launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin });
}

/** Balls a third ball is played against: pushes, floats, blocks, drives and loops. */
const RECEIVES = PRESETS.filter((p) => ['Push', 'Float', 'Block', 'Drive', 'Opening loop', 'Hook loop'].includes(p.name));

/**
 * How a medium AI of this style plays a ball after `before` strokes of its own this point
 * (it served first when `served`): share of attacking strokes, and how many land.
 */
function play(style: StyleId, served: boolean, before: number, seeds = 12) {
  let attacks = 0;
  let lands = 0;
  let n = 0;
  for (const pr of RECEIVES)
    for (let seed = 1; seed <= seeds; seed++) {
      const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(seed * 31 + n));
      ai.setStyle(STYLES[style]);
      const start = presetLaunch(pr);
      if (served) ai.planServe(0);
      else ai.planReturn(start, 0, { serve: true });
      for (let i = served ? 1 : 0; i < before - 1; i++) ai.planReturn(start, 0);
      const plan = ai.planReturn(start, 0);
      if (!plan) continue;
      const sim = new BallSim(start, P);
      while (sim.time < plan.t - 1e-6) sim.step(TICK_DT);
      n++;
      if (ATTACK.includes(plan.stroke)) attacks++;
      if (landingOutcome(sim.state, plan, plan.normal, ai.rubber, P).outcome === 'in') lands++;
    }
  return { attack: attacks / n, landRate: lands / n };
}

describe('George: third-ball attacker', () => {
  it('is an opponent only: not in the character chooser, but on the World Tour and in free play', () => {
    expect(STYLES.attacker.character).toBe('George');
    expect(PLAYABLE_STYLE_IDS).not.toContain('attacker');
    expect(FREE_PLAY_OPPONENT_IDS).toContain('attacker');
    expect(TOUR_STOPS.some((s) => (s.format === 'group' ? s.opponents.some((o) => o.style === 'attacker') : s.rounds.some((r) => r.style === 'attacker')))).toBe(true);
  });

  it('serves mostly short and low', () => {
    const count = (style: StyleId) => {
      let short = 0;
      for (let seed = 1; seed <= 40; seed++) {
        const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(seed));
        ai.setStyle(STYLES[style]);
        ai.planServe(0);
        if (ai.plan?.stroke === 'serve-short') short++;
      }
      return short / 40;
    };
    const george = count('attacker');
    const lee = count('allround');
    console.log('short serves: George', george, 'Lee', lee);
    expect(george).toBeGreaterThan(0.6);
    expect(george).toBeGreaterThan(lee + 0.2);
  });

  it('attacks the third ball more than Lee does, without being reckless', () => {
    const third = play('attacker', true, 2);
    const lee = play('allround', true, 2);
    console.log('third ball: George', third, 'Lee', lee);
    expect(third.attack).toBeGreaterThan(0.9);
    expect(third.attack).toBeGreaterThan(lee.attack + 0.1);
    // Going for it doesn't make it reckless: it lands about as often as Lee's (safer) choices.
    expect(third.landRate).toBeGreaterThan(lee.landRate * 0.8);
  }, 120000);

  it('gets shakier the longer the rally goes', () => {
    const early = play('attacker', false, 3);
    const late = play('attacker', false, 9);
    console.log('land rate: George 3rd stroke', early.landRate, '9th stroke', late.landRate);
    expect(late.landRate).toBeLessThan(early.landRate - 0.05);
  }, 240000);

  it('plays a full match against an all-rounder, with legal serves', () => {
    const rng = mulberry32(7);
    const george = new AiPlayer('near', AI_LEVELS.medium, P, rng);
    george.setStyle(STYLES.attacker);
    const lee = new AiPlayer('far', AI_LEVELS.medium, P, rng);
    lee.setStyle(STYLES.allround);
    const m = new Match(P, { near: { kind: 'ai', ai: george }, far: { kind: 'ai', ai: lee } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    let points = 0;
    let faults = 0;
    m.on((e) => {
      if (e.type !== 'point') return;
      points++;
      if (e.result.winner === 'far' && e.result.reason.startsWith('serve')) faults++;
    });
    for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'match-over'; i++) m.frame(1 / 60, 1 / 60);
    console.log('George vs Lee', m.score.history, 'serve faults', faults, '/', points);
    expect(m.phase).toBe('match-over');
    expect(faults / points).toBeLessThan(0.15);
  }, 120000);
});
