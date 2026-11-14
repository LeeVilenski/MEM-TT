import { describe, expect, it } from 'vitest';
import { TUTORIAL_STEPS, Tutorial, tutorialHint } from '../src/progress/tutorial';
import { PRESETS } from '../src/sandbox/presets';
import type { DrillReturn } from '../src/progress/drills';

const ret = (o: Partial<DrillReturn>): DrillReturn => ({ result: 'IN', shot: 'Drive', top: 0, speed: 8, ...o });

/** A return that satisfies a step. */
function passing(id: string): DrillReturn {
  switch (id) {
    case 'touch':
      return ret({ result: 'OUT' });
    case 'topspin':
      return ret({ top: 40 });
    case 'backspin':
      return ret({ top: -40 });
    case 'left':
      return ret({ landing: { x: -0.5, z: -0.8 } });
    case 'right':
      return ret({ landing: { x: 0.5, z: -0.8 } });
    default:
      return ret({});
  }
}

describe('tutorial', () => {
  it('feeds only presets the ball machine has', () => {
    const names = new Set(PRESETS.map((p) => p.name));
    for (const s of TUTORIAL_STEPS) for (const p of s.presets) expect(names.has(p), `${s.id}: ${p}`).toBe(true);
  });

  it('moves through every step and finishes', () => {
    const t = new Tutorial();
    let last = '';
    for (const s of TUTORIAL_STEPS) {
      expect(t.step?.id).toBe(s.id);
      for (let i = 0; i < s.needed; i++) {
        expect(t.preset()).not.toBeNull();
        last = t.register(passing(s.id));
      }
    }
    expect(last).toBe('done');
    expect(t.done).toBe(true);
    expect(t.preset()).toBeNull();
  });

  it('does not advance on the wrong kind of shot', () => {
    const t = new Tutorial();
    t.register(passing('touch'));
    t.register(passing('touch'));
    t.register(passing('land'));
    t.register(passing('land'));
    expect(t.step?.id).toBe('topspin');
    expect(t.register(ret({ top: -40 }))).toBe('miss'); // backspin isn't topspin
    expect(t.register(ret({ result: 'OUT', top: 40 }))).toBe('miss'); // must land
    expect(t.progress).toBe(0);
    expect(t.misses).toBe(2);
  });

  it('gives a hint for each way of missing', () => {
    const step = TUTORIAL_STEPS[2];
    for (const r of ['MISSED', 'OUT', 'OWN SIDE'] as const) expect(tutorialHint(ret({ result: r }), step, false)).toMatch(/\w/);
    expect(tutorialHint(ret({ top: 0 }), step, true)).toMatch(/topspin/);
  });
});
