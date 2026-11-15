import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS as P } from '../src/physics';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { STYLES } from '../src/game/styles';
import { Match } from '../src/game/match';
import { mulberry32 } from './helpers/rng';

describe('AI reach', () => {
  // Heavy backspin that checks back toward the net used to send the AI's bat (and a
  // stretched arm) across the table, through the contact point and over the net.
  it('keeps its bat within reach of its body, and on its own side of the net', () => {
    const rng = mulberry32(1);
    const near = new AiPlayer('near', AI_LEVELS.hard, P, rng);
    near.setStyle(STYLES.chopper);
    const far = new AiPlayer('far', AI_LEVELS.hard, P, rng);
    far.setStyle(STYLES.penhold);
    const m = new Match(P, { near: { kind: 'ai', ai: near }, far: { kind: 'ai', ai: far } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    let maxReach = 0;
    let overNet = 0;
    for (let i = 0; i < 60 * 60 * 6 && m.phase !== 'match-over'; i++) {
      m.frame(1 / 60, 1 / 60);
      for (const [ai, side] of [[near, 1], [far, -1]] as const) {
        const bat = ai.worldPose.pos;
        const body = ai.worldBody;
        maxReach = Math.max(maxReach, Math.hypot(bat.x - body.x, bat.z - body.z));
        if (bat.z * side < 0) overNet++;
      }
    }
    expect(m.phase).toBe('match-over');
    expect(overNet).toBe(0);
    // Up to ~1.2 m: arm plus a lean in over the table for short balls.
    expect(maxReach).toBeLessThan(1.25);
  }, 60000);
});
