import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, TABLE, launchState, solveAim, v3 } from '../src/physics';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Match } from '../src/game/match';
import { STYLES, PLAYABLE_STYLE_IDS, FREE_PLAY_OPPONENT_IDS, type StyleId } from '../src/game/styles';
import { TOUR_STOPS } from '../src/progress/tour';
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;

/** Top sideways speed (m/s) of an AI of this style moving to a wide ball. */
function sidewaysSpeed(style: StyleId) {
  const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(1));
  ai.setStyle(STYLES[style]);
  // A ball aimed wide to the near player's forehand corner.
  const origin = v3(0, TABLE.height + 0.3, -TABLE.halfLength - 0.6);
  const spin = { top: 30, side: 0, cork: 0 };
  const aim = solveAim(origin, { x: 0.65, z: 1.0 }, 12, spin, P);
  ai.planReturn(launchState(origin, { speed: 12, elevation: aim.elevation, azimuth: aim.azimuth, spin }), 0);
  const dt = 1 / 60;
  let top = 0;
  for (let t = 0; t < 0.4; t += dt) {
    const x0 = ai.body.x;
    ai.update(dt, AI_LEVELS.medium.reaction + 0.01 + t);
    top = Math.max(top, Math.abs(ai.body.x - x0) / dt);
  }
  return top;
}

describe('Bryony: wheelchair player', () => {
  it('is an opponent only: not in the character chooser, but on the World Tour and in free play', () => {
    expect(STYLES.wheelchair.character).toBe('Bryony');
    expect(PLAYABLE_STYLE_IDS).not.toContain('wheelchair');
    // …but you can pick them as an opponent in free play (Match vs AI, doubles, online AI seats).
    expect(FREE_PLAY_OPPONENT_IDS).toContain('wheelchair');
    expect(FREE_PLAY_OPPONENT_IDS).not.toContain('chopper');
    const inTour = TOUR_STOPS.filter((s) => (s.format === 'group' ? s.opponents.some((o) => o.style === 'wheelchair') : s.rounds.some((r) => r.style === 'wheelchair')));
    expect(inTour.length).toBeGreaterThanOrEqual(1);
  });

  it('plays tight to the table and covers less ground sideways than a standing player', () => {
    expect(STYLES.wheelchair.distance).toBeLessThan(STYLES.allround.distance);
    const bryony = sidewaysSpeed('wheelchair');
    const lee = sidewaysSpeed('allround');
    expect(bryony).toBeGreaterThan(1); // she does move (m/s)
    expect(bryony).toBeLessThan(lee * 0.8);
  });

  it('plays a full match against an all-rounder', () => {
    const rng = mulberry32(5);
    const bry = new AiPlayer('near', AI_LEVELS.medium, P, rng);
    bry.setStyle(STYLES.wheelchair);
    const lee = new AiPlayer('far', AI_LEVELS.medium, P, rng);
    lee.setStyle(STYLES.allround);
    const m = new Match(P, { near: { kind: 'ai', ai: bry }, far: { kind: 'ai', ai: lee } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    let points = 0;
    let myPoints = 0;
    m.on((e) => {
      if (e.type !== 'point') return;
      points++;
      if (e.result.winner === 'near') myPoints++;
    });
    for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'match-over'; i++) m.frame(1 / 60, 1 / 60);
    expect(m.phase).toBe('match-over');
    // Competitive, not a pushover: she wins a fair share of points.
    expect(myPoints / points).toBeGreaterThan(0.25);
  }, 120000);

  it('is left-handed: the bat waits on her left, and that is her forehand', () => {
    expect(STYLES.wheelchair.leftHanded).toBe(true);
    for (const [style, sign] of [['wheelchair', -1], ['allround', 1]] as const) {
      const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(2));
      ai.setStyle(STYLES[style]);
      for (let t = 0; t < 1; t += 1 / 60) ai.update(1 / 60, t);
      expect(Math.sign(ai.worldPose.pos.x - ai.worldBody.x)).toBe(sign);
      expect(ai.wing).toBe('forehand');
    }
  });
});
