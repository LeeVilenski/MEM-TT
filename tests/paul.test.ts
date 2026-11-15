import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, cloneState, launchState, length, paddleImpulse, radToRpm, solveAim, v3 } from '../src/physics';
import { landingOutcome } from '../src/game/assist';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Match } from '../src/game/match';
import { STYLES, PLAYABLE_STYLE_IDS, FREE_PLAY_OPPONENT_IDS, type StyleId } from '../src/game/styles';
import { PRESETS } from '../src/sandbox/presets';
import { TOUR_STOPS } from '../src/progress/tour';
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;

function presetLaunch(pr: (typeof PRESETS)[number]) {
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
  return launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin });
}

/** Returns of a spread of machine balls by a medium AI of this style: landing rate and spin put on them. */
function returns(style: StyleId, seeds = 6) {
  let lands = 0;
  let n = 0;
  const rpm: number[] = [];
  for (const pr of PRESETS.filter((p) => !['Smash', 'Lob'].includes(p.name)))
    for (let seed = 1; seed <= seeds; seed++) {
      const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(seed));
      ai.setStyle(STYLES[style]);
      const start = presetLaunch(pr);
      const plan = ai.planReturn(start, 0);
      if (!plan) continue;
      const sim = new BallSim(start, P);
      while (sim.time < plan.t - 1e-6) sim.step(TICK_DT);
      n++;
      if (landingOutcome(sim.state, plan, plan.normal, ai.rubber, P).outcome === 'in') lands++;
      const out = cloneState(sim.state);
      if (paddleImpulse(out, plan, ai.rubber) > 0) rpm.push(radToRpm(length(out.spin)));
    }
  rpm.sort((a, b) => a - b);
  return { landRate: lands / n, medianRpm: rpm[Math.floor(rpm.length / 2)], maxRpm: rpm[rpm.length - 1] };
}

describe('Paul: patient, flat (no spin of his own)', () => {
  it('is an opponent only: not in the character chooser, but on the World Tour and in free play', () => {
    expect(STYLES.patient.character).toBe('Paul');
    expect(PLAYABLE_STYLE_IDS).not.toContain('patient');
    // …but you can pick them as an opponent in free play (Match vs AI, doubles, online AI seats).
    expect(FREE_PLAY_OPPONENT_IDS).toContain('patient');
    expect(FREE_PLAY_OPPONENT_IDS).not.toContain('chopper');
    expect(TOUR_STOPS.some((s) => (s.format === 'group' ? s.opponents.some((o) => o.style === 'patient') : s.rounds.some((r) => r.style === 'patient')))).toBe(true);
  });

  it('sends the ball back flat, with less spin than others, and keeps it on the table', () => {
    const paul = returns('patient');
    const lee = returns('allround');
    const will = returns('penhold');
    console.log('Paul', paul, 'Lee', lee, 'Will', will);
    // Flat: a ball always leaves the bat with a little spin (from the bat angle and the
    // incoming ball), but Paul's carries clearly less than spinners' and all-rounders'.
    expect(paul.medianRpm).toBeLessThan(lee.medianRpm * 0.8);
    expect(paul.medianRpm).toBeLessThan(will.medianRpm * 0.8);
    // Patient: keeps it on the table more reliably than they do.
    expect(paul.landRate).toBeGreaterThan(lee.landRate + 0.1);
    expect(paul.landRate).toBeGreaterThan(will.landRate + 0.1);
  }, 120000);

  it('plays a full match against an all-rounder, with legal serves', () => {
    const rng = mulberry32(3);
    const paul = new AiPlayer('near', AI_LEVELS.medium, P, rng);
    paul.setStyle(STYLES.patient);
    const lee = new AiPlayer('far', AI_LEVELS.medium, P, rng);
    lee.setStyle(STYLES.allround);
    const m = new Match(P, { near: { kind: 'ai', ai: paul }, far: { kind: 'ai', ai: lee } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    let points = 0;
    let paulServeFaults = 0;
    m.on((e) => {
      if (e.type !== 'point') return;
      points++;
      if (e.result.winner === 'far' && e.result.reason.startsWith('serve')) paulServeFaults++;
    });
    for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'match-over'; i++) m.frame(1 / 60, 1 / 60);
    expect(m.phase).toBe('match-over');
    expect(paulServeFaults / points).toBeLessThan(0.15);
  }, 120000);
});
