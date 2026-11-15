import { describe, expect, it } from 'vitest';
import { NO_GRADING, gradeContact } from '../src/game/contact';
import { realismSettings } from '../src/game/realism';
import { FPS, playBall } from './helpers/practice';
import { mulberry32 } from './helpers/rng';

const ASSISTED = realismSettings(0.85).grading;

describe('contact grading', () => {
  it('a clean, well-timed stroke through the ball is PERFECT and costs nothing', () => {
    const g = gradeContact({ peakAge: 0.01, miss: 0.02, speed: 6 }, ASSISTED);
    expect(g.grade).toBe('PERFECT');
    expect(g.faceError).toBe(0);
    expect(g.assistScale).toBe(1);
    expect(g.paceScale).toBe(1);
  });

  it('names what went wrong: early, off-centre, over-hit', () => {
    expect(gradeContact({ peakAge: ASSISTED.strokeHold * 0.95, miss: 0, speed: 6 }, ASSISTED).grade).toBe('EARLY');
    expect(gradeContact({ peakAge: 0.01, miss: ASSISTED.edge, speed: 6 }, ASSISTED).grade).toBe('EDGE');
    expect(gradeContact({ peakAge: 0.01, miss: 0, speed: ASSISTED.overhitFull + 2 }, ASSISTED).grade).toBe('OVERHIT');
  });

  it('a poor contact gets less assist, face error and (if mistimed or off-centre) less pace', () => {
    const edge = gradeContact({ peakAge: 0.01, miss: ASSISTED.edge, speed: 6 }, ASSISTED);
    expect(edge.assistScale).toBeLessThan(1);
    expect(edge.faceError).toBeGreaterThan(0);
    expect(edge.paceScale).toBeLessThan(1);
    // Over-hitting keeps its pace: that's the gamble.
    const over = gradeContact({ peakAge: 0.01, miss: 0, speed: ASSISTED.overhitFull + 2 }, ASSISTED);
    expect(over.paceScale).toBe(1);
    expect(over.faceError).toBeGreaterThan(0);
  });

  it('a block (no flick) is never early or over-hit', () => {
    expect(gradeContact({ peakAge: Infinity, miss: 0.02, speed: 0 }, ASSISTED).grade).toBe('GOOD');
  });

  it('in simulation it is feedback only, and with grading off nothing changes', () => {
    const sim = gradeContact({ peakAge: 0.01, miss: 0.5, speed: 6 }, realismSettings(0).grading);
    expect(sim.grade).toBe('EDGE');
    expect(sim.faceError).toBe(0);
    expect(sim.assistScale).toBe(1);
    expect(sim.paceScale).toBe(1);
    const off = gradeContact({ peakAge: 0.01, miss: 0.5, speed: 30 }, NO_GRADING);
    expect([off.q, off.faceError, off.assistScale, off.paceScale].every(Number.isFinite)).toBe(true);
    expect(off.assistScale).toBe(1);
  });

  it('in play: clean strokes land as often as before, and sloppy ones miss somewhat more', () => {
    const presets = ['Long push', 'Block', 'Drive', 'Float', 'Opening loop', 'Power loop'];
    const rate = (lead: number, px: number, offset: number, graded: boolean, runs: number) => {
      let ins = 0;
      let n = 0;
      let seed = 1;
      for (const pr of presets)
        for (let k = 0; k < runs; k++) {
          const r = playBall(pr, 0.75, lead, px, {
            offset,
            setup: (p) => {
              p.applyRealism(0.85);
              p.rng = mulberry32(seed++);
              if (!graded) p.grading = NO_GRADING;
            },
          });
          n++;
          if (r.result === 'IN') ins++;
        }
      return ins / n;
    };
    // Clean: no penalty, so the very same result.
    expect(rate(2 / FPS, 60, 0, true, 2)).toBe(rate(2 / FPS, 60, 0, false, 1));
    // Off-centre (the swipe passes 28 cm from the ball): a few more misses, but most still land.
    const edgeOff = rate(2 / FPS, 60, 0.28, false, 1);
    const edgeOn = rate(2 / FPS, 60, 0.28, true, 4);
    expect(edgeOn).toBeLessThan(edgeOff);
    expect(edgeOn).toBeGreaterThan(edgeOff - 0.3);
  }, 120000);
});
