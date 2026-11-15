import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, CAREER_LEVELS, Career, type Storage } from '../src/progress/profile';
import { DRILLS, DrillSession, drillUnlocked, type DrillReturn } from '../src/progress/drills';
import { TOURNAMENTS, TournamentRun, tournamentUnlocked } from '../src/progress/tournament';
import { isUnlocked, newlyUnlocked, unlockedKeys } from '../src/progress/unlocks';
import { playBall } from './helpers/practice';

function memoryStorage(initial: string | null = null): Storage & { value: string | null } {
  const s = { value: initial, load: () => s.value, save: (d: string) => (s.value = d) };
  return s;
}

describe('career profile', () => {
  it('earns XP, levels up and persists', () => {
    const store = memoryStorage();
    const c = new Career(store);
    const events: string[] = [];
    c.on((e) => events.push(e.type === 'level' ? `level:${e.title}` : e.type));
    expect(c.title).toBe('Intern');
    c.recordMatch(true, { aiLevel: 'medium', style: 'looper' });
    for (let i = 0; i < 20; i++) c.recordPoint(true, { rallyHits: 4 });
    expect(c.data.xp).toBeGreaterThanOrEqual(CAREER_LEVELS[1].xp);
    expect(events).toContain('level:Junior');
    expect(c.has('first-win')).toBe(true);
    // Reload from storage.
    const again = new Career(store);
    expect(again.data.xp).toBe(c.data.xp);
    expect(again.data.stats.matchesWon).toBe(1);
  });

  it('awards achievements once, from stats', () => {
    const c = new Career(memoryStorage());
    c.recordShot('Smash', 27, 3000);
    c.recordShot('Loop', 18, 7500);
    c.recordPoint(true, { ace: true });
    c.recordPoint(false, { rallyHits: 16 });
    const xp = c.data.xp;
    c.recordShot('Smash', 30, 3000); // no second award
    expect(c.data.achievements.sort()).toEqual(['ace', 'marathon', 'speed', 'spin']);
    expect(c.data.xp).toBe(xp);
    expect(c.data.stats.fastestShot).toBe(30);
    expect(c.data.stats.shots).toEqual({ Smash: 2, Loop: 1 });
    expect(ACHIEVEMENTS.map((a) => a.id)).toContain('full-stack');
  });

  it('recovers from a corrupt save', () => {
    const c = new Career(memoryStorage('{not json'));
    expect(c.data.xp).toBe(0);
  });
});

describe('drills', () => {
  const ret = (over: Partial<DrillReturn>): DrillReturn => ({ result: 'IN', shot: 'Drive', top: 40, speed: 10, ...over });

  it('feeds its presets, scores the check and awards stars', () => {
    const d = DRILLS.find((x) => x.id === 'open-loop')!;
    const s = new DrillSession(d);
    const presets: string[] = [];
    for (let i = 0; i < d.balls; i++) {
      presets.push(s.nextPreset()!);
      s.register(i < 6 ? ret({ top: 60 }) : ret({ top: -40 })); // 6 topspin returns, 4 backspin
    }
    expect(s.nextPreset()).toBeNull();
    expect(presets.slice(0, 2)).toEqual(['Long push', 'Chop']);
    expect(s.successes).toBe(6);
    expect(s.stars).toBe(2);
    expect(s.done).toBe(true);
  });

  it('target zones count only landings inside', () => {
    const d = DRILLS.find((x) => x.id === 'target')!;
    const s = new DrillSession(d);
    expect(s.register(ret({ landing: { x: 0.5, z: -1.1 } }))).toBe(true);
    expect(s.register(ret({ landing: { x: -0.5, z: -1.1 } }))).toBe(false);
    expect(s.register(ret({ result: 'OUT' }))).toBe(false);
  });

  it('unlock in order', () => {
    expect(drillUnlocked(0, {})).toBe(true);
    expect(drillUnlocked(1, {})).toBe(false);
    expect(drillUnlocked(1, { onboarding: 1 })).toBe(true);
    expect(drillUnlocked(3, {}, true)).toBe(true);
  });

  it('the first drills are achievable with a simple, human-speed swing', () => {
    // The scripted player from the gameplay tests (one upward flick for every ball).
    for (const id of ['onboarding', 'open-loop', 'firewall']) {
      const d = DRILLS.find((x) => x.id === id)!;
      const s = new DrillSession(d);
      for (let p = s.nextPreset(); p; p = s.nextPreset()) {
        const r = playBall(p, 0.77);
        s.register({ result: r.result as DrillReturn['result'], shot: r.shot?.name ?? '-', top: r.shot?.top ?? 0, speed: r.shot?.speed ?? 0, landing: r.landing });
      }
      console.log(id, `${s.successes}/${d.balls}`, '★'.repeat(s.stars));
      expect(s.stars).toBeGreaterThanOrEqual(1);
    }
  }, 60000);
});

describe('tournaments', () => {
  it('advances on wins and ends on a loss', () => {
    const cup = TOURNAMENTS[0];
    const run = new TournamentRun(cup);
    expect(run.current?.name).toMatch(/Round 1/);
    expect(run.report(true, '1–0')).toBe('playing');
    expect(run.report(true, '1–0')).toBe('playing');
    expect(run.current?.style).toBe('chopper');
    expect(run.report(false, '0–1')).toBe('eliminated');
    expect(run.current).toBeNull();
    const win = new TournamentRun(cup);
    for (let i = 0; i < cup.rounds.length; i++) win.report(true, '1–0');
    expect(win.state).toBe('won');
  });

  it('the championship needs the cup first', () => {
    const champ = TOURNAMENTS.find((t) => t.id === 'championship')!;
    expect(tournamentUnlocked(champ, {})).toBe(false);
    expect(tournamentUnlocked(champ, { 'department-cup': 1 })).toBe(true);
  });
});

describe('unlocks', () => {
  it('unlock by level, drill and tournament, and report what is new', () => {
    const c = new Career(memoryStorage());
    const before = unlockedKeys(c.data, c.levelIndex);
    expect(isUnlocked('venue', 'office', c.data, c.levelIndex)).toBe(true);
    expect(isUnlocked('venue', 'server', c.data, c.levelIndex)).toBe(false);
    c.addXp(CAREER_LEVELS[1].xp, 'test');
    c.recordDrill('defence', 2, ['defence']);
    const fresh = newlyUnlocked(before, c.data, c.levelIndex).map((u) => `${u.kind}:${u.id}`);
    expect(fresh).toEqual(expect.arrayContaining(['venue:server', 'rubber:longPips', 'rubber:shortPips']));
    expect(isUnlocked('venue', 'rooftop', c.data, c.levelIndex)).toBe(false);
    c.recordTournament('department-cup', 300, 'cup');
    expect(isUnlocked('venue', 'rooftop', c.data, c.levelIndex)).toBe(true);
    c.setUnlockAll(true);
    expect(isUnlocked('rubber', 'anti', c.data, c.levelIndex)).toBe(true);
  });
});
