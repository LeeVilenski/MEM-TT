import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, TABLE, serveBounces, solveServeAim, spinComponents, launchState, v3 } from '../src/physics';
import { PRESETS } from '../src/sandbox/presets';
import { DRILLS, DrillSession } from '../src/progress/drills';
import { Career, type Storage } from '../src/progress/profile';
import { scoutReport } from '../src/game/scouting';
import { STYLE_IDS } from '../src/game/styles';
import { mulberry32 } from './helpers/rng';

describe('machine serves', () => {
  const serves = PRESETS.filter((p) => p.serve);

  it('every serve preset bounces on the machine half, then lands on its target', () => {
    expect(serves.length).toBeGreaterThanOrEqual(4);
    for (const p of serves) {
      const o = v3(p.lateral, TABLE.height + p.height, -TABLE.halfLength - p.distanceBack);
      const aim = solveServeAim(o, p.target, p.speed, p.spin, DEFAULT_PARAMS);
      expect(aim.ok, p.name).toBe(true);
      const b = serveBounces(o, { speed: p.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: p.spin }, DEFAULT_PARAMS)!;
      expect(b, p.name).not.toBeNull();
      expect(b.first.z).toBeLessThan(0);
      expect(Math.hypot(b.second.x - p.target.x, b.second.z - p.target.z), p.name).toBeLessThan(0.12);
    }
  });

  it('the backspin and no-spin serves differ only in spin', () => {
    const back = serves.find((p) => p.name === 'Backspin serve')!;
    const none = serves.find((p) => p.name === 'No-spin serve')!;
    expect({ ...back, name: '', description: '', spin: null }).toEqual({ ...none, name: '', description: '', spin: null });
    const o = v3(back.lateral, TABLE.height + back.height, -TABLE.halfLength - back.distanceBack);
    const aim = solveServeAim(o, back.target, back.speed, back.spin, DEFAULT_PARAMS);
    const st = launchState(o, { speed: back.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: back.spin });
    expect(spinComponents(st.vel, st.spin).top).toBeLessThan(-40);
  });
});

describe('Read the serve drill', () => {
  const drill = DRILLS.find((d) => d.id === 'serve-read')!;

  it('feeds only serve presets', () => {
    for (const name of drill.presets) expect(PRESETS.find((p) => p.name === name)?.serve, name).toBe(true);
  });

  it('breaks the coach report down by serve and coaches the weakest one', () => {
    const s = new DrillSession(drill, mulberry32(3));
    while (!s.done) {
      const b = s.nextBall()!;
      // Returns everything except the no-spin serve.
      s.register({ result: b.preset === 'No-spin serve' ? 'OUT' : 'IN', shot: 'Push', top: -20, speed: 5, grade: 'GOOD' });
    }
    const rep = s.report();
    expect(rep.breakdown).toMatch(/No-spin 0\/\d/);
    expect(rep.tip).toBe(drill.presetTips!['No-spin serve']);
  });

  it('awards Packet Inspector for 3 stars', () => {
    const store: Storage = { load: () => null, save: () => {} };
    const c = new Career(store);
    c.recordDrill('serve-read', 2, DRILLS.map((d) => d.id));
    expect(c.has('serve-reader')).toBe(false);
    c.recordDrill('serve-read', 3, DRILLS.map((d) => d.id));
    expect(c.has('serve-reader')).toBe(true);
  });
});

describe('scouting reports', () => {
  it('covers every character and level', () => {
    for (const id of STYLE_IDS)
      for (const lvl of ['easy', 'medium', 'hard', 'expert'] as const) {
        const r = scoutReport(id, lvl);
        expect(r.traits.length).toBeGreaterThan(0);
        expect(r.plan.length).toBeGreaterThan(20);
        expect(r.level).toMatch(/^[A-Z]/);
      }
  });
});

describe('returning machine serves (scripted player, full assist)', () => {
  it('the same push returns the backspin serve but not its no-spin twin', async () => {
    const { playBall } = await import('./helpers/practice');
    expect(playBall('Backspin serve', 1, 2 / 60, -40).result).toBe('IN');
    expect(playBall('Side-back serve', 1, 2 / 60, -40).result).toBe('IN');
    const float = playBall('No-spin serve', 1, 2 / 60, -40);
    expect(float.hit).toBeDefined();
    expect(float.result).not.toBe('IN');
    expect(playBall('Fast long serve', 1).result).toBe('IN');
  });
});
