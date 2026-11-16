import { describe, expect, it } from 'vitest';
import { BLADES, BLADE_IDS, BAT_RUBBER_IDS, LEVEL_GEAR, TOUR_GEAR, batRubbers, defaultBat, opponentBat, withControl } from '../src/game/equipment';
import { RUBBERS } from '../src/physics';
import { UNLOCKS, isUnlocked } from '../src/progress/unlocks';
import { Career, type Storage } from '../src/progress/profile';
import { TOUR_STOPS } from '../src/progress/tour';
import { NO_GRADING } from '../src/game/contact';
import { realismSettings } from '../src/game/realism';
import { playBall } from './helpers/practice';

const mem = (): Storage & { value: string | null } => {
  const s = { value: null as string | null, load: () => s.value, save: (d: string) => (s.value = d) };
  return s;
};

describe('bats', () => {
  it('each character starts with their usual rubbers on a starter blade', () => {
    expect(defaultBat('chopper')).toEqual({ blade: 'starter', forehand: 'inverted', backhand: 'longPips' });
    const r = batRubbers(defaultBat('allround'));
    expect(r.forehand).toBe(RUBBERS.inverted);
  });

  it('faster blades make the rubber livelier; control widens the sweet spot', () => {
    const r = batRubbers({ blade: 'carbon', forehand: 'inverted', backhand: 'inverted' });
    expect(r.forehand.restitution).toBeGreaterThan(RUBBERS.inverted.restitution);
    const g = realismSettings(0.85).grading;
    expect(withControl(g, BLADES.champion).sweet).toBeGreaterThan(g.sweet);
    expect(withControl(g, BLADES.starter)).toBe(g);
    expect(withControl(NO_GRADING, BLADES.champion).maxFaceError).toBe(0);
  });

  it('opponents get better kit later, but keep their pips', () => {
    expect(opponentBat('allround', 0)).toEqual(defaultBat('allround'));
    expect(opponentBat('allround', 4)).toEqual({ blade: 'champion', forehand: 'gripMax', backhand: 'gripMax' });
    expect(opponentBat('patient', 3).forehand).toBe('shortPips');
    expect(opponentBat('chopper', 2).backhand).toBe('longPips');
    expect(TOUR_GEAR).toHaveLength(TOUR_STOPS.length);
    for (let i = 1; i < TOUR_GEAR.length; i++) expect(TOUR_GEAR[i]).toBeGreaterThanOrEqual(TOUR_GEAR[i - 1]);
    expect(LEVEL_GEAR.expert).toBeGreaterThan(LEVEL_GEAR.easy);
  });

  it('every blade and new rubber but the starter kit has an unlock rule', () => {
    const c = new Career(mem());
    for (const b of BLADE_IDS) expect(isUnlocked('blade', b, c.data, 0), b).toBe(b === 'starter');
    for (const r of BAT_RUBBER_IDS) expect(isUnlocked('rubber', r, c.data, 0), r).toBe(r === 'inverted');
    expect(UNLOCKS.filter((u) => u.kind === 'blade')).toHaveLength(BLADE_IDS.length - 1);
    c.data.tournaments['beach-classic'] = 1;
    expect(isUnlocked('blade', 'champion', c.data, 0)).toBe(true);
  });

  it('saves each character’s bat', () => {
    const store = mem();
    new Career(store).setBat('looper', { blade: 'carbon', forehand: 'turbo', backhand: 'classicPro' });
    expect(new Career(store).data.bats.looper).toEqual({ blade: 'carbon', forehand: 'turbo', backhand: 'classicPro' });
  });

  it('a better bat loops with more spin and pace from the same stroke', () => {
    const loop = (bat?: Parameters<typeof batRubbers>[0]) =>
      playBall('Long push', 0, 2 / 60, 60, { setup: (p) => bat && p.applyBat(bat) });
    const base = loop();
    const pro = loop({ blade: 'carbon', forehand: 'gripMax', backhand: 'gripMax' });
    expect(base.shot && pro.shot).toBeTruthy();
    expect(pro.shot!.rpm).toBeGreaterThan(base.shot!.rpm);
    expect(pro.shot!.speed).toBeGreaterThan(base.shot!.speed);
  });
});
