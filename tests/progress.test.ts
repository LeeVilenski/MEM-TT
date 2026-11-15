import { describe, expect, it } from 'vitest';
import { ACHIEVEMENTS, CAREER_LEVELS, Career, type Storage } from '../src/progress/profile';
import { DRILLS, DRILL_CATEGORIES, DrillSession, drillUnlocked, type DrillReturn } from '../src/progress/drills';
import { TOURNAMENTS, TournamentRun, tournamentUnlocked } from '../src/progress/tournament';
import { isUnlocked, newlyUnlocked, unlockedKeys } from '../src/progress/unlocks';
import { TOUR_STOPS, TourRun, stopUnlocked, stopsWon } from '../src/progress/tour';
import { mulberry32 } from './helpers/rng';
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

  it('new drills branch off Onboarding, by category', () => {
    const idx = (id: string) => DRILLS.findIndex((d) => d.id === id);
    expect(drillUnlocked(idx('falkenberg'), {})).toBe(false);
    expect(drillUnlocked(idx('falkenberg'), { onboarding: 1 })).toBe(true);
    expect(drillUnlocked(idx('read-spin'), { onboarding: 1 })).toBe(true);
    expect(drillUnlocked(idx('random-corners'), { onboarding: 1 })).toBe(false);
    expect(drillUnlocked(idx('random-corners'), { onboarding: 1, falkenberg: 1 })).toBe(true);
    for (const d of DRILLS) expect(DRILL_CATEGORIES).toContain(d.category);
  });

  it('placements and called sides', () => {
    const fk = new DrillSession(DRILLS.find((x) => x.id === 'falkenberg')!);
    expect([fk.nextBall()!.x, fk.nextBall()!.x, fk.nextBall()!.x]).toEqual([-0.5, -0.5, 0.55]);
    const call = new DrillSession(DRILLS.find((x) => x.id === 'call-shot')!, mulberry32(3));
    const b = call.nextBall()!;
    expect(b.call === 'left' || b.call === 'right').toBe(true);
    const good = b.call === 'left' ? -0.4 : 0.4;
    expect(call.register(ret({ landing: { x: good, z: -0.8 } }))).toBe(true);
    call.nextBall();
    const wrong = call.ball!.call === 'left' ? 0.4 : -0.4;
    expect(call.register(ret({ landing: { x: wrong, z: -0.8 } }))).toBe(false);
  });

  it('scores clean contacts and combos, and the coach names the main fault', () => {
    const s = new DrillSession(DRILLS[0]);
    s.register(ret({ grade: 'PERFECT' }));
    s.register(ret({ grade: 'GOOD' }));
    expect(s.score).toBe(150 + Math.round(120 * 1.1));
    expect(s.combo).toBe(2);
    for (let i = 0; i < 3; i++) s.register(ret({ grade: 'EARLY', result: 'OUT' }));
    expect(s.combo).toBe(0);
    expect(s.bestCombo).toBe(2);
    const rep = s.report();
    expect(rep.early).toBe(3);
    expect(rep.tip).toMatch(/early/);
    // Only clean contacts count in the timing trainer.
    const t = new DrillSession(DRILLS.find((x) => x.id === 'timing')!);
    expect(t.register(ret({ grade: 'EDGE' }))).toBe(false);
    expect(t.register(ret({ grade: 'GOOD' }))).toBe(true);
  });

  it('remembers the best score', () => {
    const c = new Career(memoryStorage());
    c.recordDrill('onboarding', 2, ['onboarding'], 900);
    c.recordDrill('onboarding', 1, ['onboarding'], 400);
    expect(c.data.drillScores.onboarding).toBe(900);
    expect(c.data.drills.onboarding).toBe(2);
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
    expect(isUnlocked('style', 'chopper', c.data, c.levelIndex)).toBe(false);
    c.addXp(CAREER_LEVELS[1].xp, 'test');
    c.recordDrill('defence', 2, ['defence']);
    const fresh = newlyUnlocked(before, c.data, c.levelIndex).map((u) => `${u.kind}:${u.id}`);
    expect(fresh).toEqual(expect.arrayContaining(['venue:server', 'style:chopper', 'rubber:longPips', 'rubber:shortPips']));
    expect(isUnlocked('venue', 'rooftop', c.data, c.levelIndex)).toBe(false);
    c.recordTournament('department-cup', 300, 'cup');
    expect(isUnlocked('venue', 'rooftop', c.data, c.levelIndex)).toBe(true);
    c.setUnlockAll(true);
    expect(isUnlocked('rubber', 'anti', c.data, c.levelIndex)).toBe(true);
  });
});

describe('World Tour', () => {
  it('starts at MEM HQ and opens each stop once the one before is won', () => {
    expect(TOUR_STOPS[0].place).toBe('MEM HQ');
    expect(TOUR_STOPS[0].venue).toBe('mem');
    expect(TOUR_STOPS.some((s) => s.format === 'group')).toBe(true);
    expect(TOUR_STOPS.some((s) => s.venue === 'park')).toBe(true);
    expect(stopUnlocked(0, {})).toBe(true);
    expect(stopUnlocked(1, {})).toBe(false);
    expect(stopUnlocked(1, { 'department-cup': 1 })).toBe(true);
    expect(stopUnlocked(3, {}, true)).toBe(true);
  });

  it('a knockout stop advances on wins and ends on a loss', () => {
    const run = new TourRun(TOUR_STOPS[0]);
    expect(run.current?.label).toMatch(/Round 1/);
    expect(run.current?.venue).toBe('mem');
    expect(run.report(1, 0)).toBe('playing');
    expect(run.report(0, 1)).toBe('eliminated');
    expect(run.current).toBeNull();
  });

  it('a round-robin group: play everyone once, top two to the final', () => {
    const stop = TOUR_STOPS.find((s) => s.format === 'group')!;
    const run = new TourRun(stop, mulberry32(5));
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const f = run.current!;
      expect(f.label).toMatch(/Group match/);
      seen.add(f.style);
      expect(run.report(1, 0)).toBe('playing');
    }
    expect(seen.size).toBe(3); // three different opponents
    // Three wins out of three: top of the group, into the final.
    expect(run.group!.standings()[0].entry.you).toBe(true);
    expect(run.current!.label).toMatch(/^Final/);
    expect(run.report(2, 1)).toBe('won');
  });

  it('losing every group match means going out in the group stage', () => {
    const stop = TOUR_STOPS.find((s) => s.format === 'group')!;
    const run = new TourRun(stop, mulberry32(9));
    for (let i = 0; i < 3; i++) run.report(0, 1);
    expect(run.state).toBe('eliminated');
    expect(run.group!.finalScore).toBeNull();
    const table = run.group!.standings();
    expect(table.reduce((n, r) => n + r.played, 0)).toBe(12); // 6 matches, 2 players each
  });

  it('winning a stop records it, unlocking the next stop and its venue', () => {
    const c = new Career(memoryStorage());
    expect(isUnlocked('venue', 'park', c.data, c.levelIndex)).toBe(false);
    c.recordTournament('datacentre-knockout', 400);
    expect(isUnlocked('venue', 'park', c.data, c.levelIndex)).toBe(true);
    expect(stopsWon(c.data.tournaments)).toBe(1);
  });
});
