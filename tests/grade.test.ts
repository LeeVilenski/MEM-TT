import { describe, expect, it } from 'vitest';
import { betterGrade, matchGrade } from '../src/game/matchGrade';
import { Career, type Storage } from '../src/progress/profile';

const mem = (): Storage & { value: string | null } => {
  const s = { value: null as string | null, load: () => s.value, save: (d: string) => (s.value = d) };
  return s;
};

describe('match grade', () => {
  it('rates clean, dominant play S and sloppy losses C', () => {
    expect(matchGrade({ strokes: 40, clean: 38, perfect: 20, pointsWon: 33, pointsPlayed: 40, won: true }).grade).toBe('S');
    expect(matchGrade({ strokes: 40, clean: 34, perfect: 8, pointsWon: 24, pointsPlayed: 40, won: true }).grade).toBe('A');
    expect(matchGrade({ strokes: 40, clean: 25, perfect: 4, pointsWon: 20, pointsPlayed: 40, won: false }).grade).toBe('B');
    expect(matchGrade({ strokes: 40, clean: 12, perfect: 0, pointsWon: 9, pointsPlayed: 33, won: false }).grade).toBe('C');
  });

  it('never gives S for a loss', () => {
    expect(matchGrade({ strokes: 40, clean: 40, perfect: 40, pointsWon: 21, pointsPlayed: 42, won: false }).grade).toBe('A');
  });

  it('uses points alone when hardly any strokes were graded', () => {
    const r = matchGrade({ strokes: 2, clean: 0, perfect: 0, pointsWon: 11, pointsPlayed: 11, won: true });
    expect(r.grade).toBe('A');
  });

  it('orders grades', () => {
    expect(betterGrade('S', 'A')).toBe(true);
    expect(betterGrade('B', 'A')).toBe(false);
    expect(betterGrade('C', undefined)).toBe(true);
  });

  it('keeps the best grade per opponent and awards the grade badges', () => {
    const store = mem();
    const c = new Career(store);
    expect(c.recordGrade('blocker', 'B', { aiLevel: 'medium' })).toBe(true);
    expect(c.recordGrade('blocker', 'C', { aiLevel: 'medium' })).toBe(false);
    expect(c.data.bestGrades.blocker).toBe('B');
    expect(c.has('grade-a-hard')).toBe(false);
    expect(c.recordGrade('blocker', 'A', { aiLevel: 'hard' })).toBe(true);
    expect(c.has('grade-a-hard')).toBe(true);
    expect(c.has('grade-s')).toBe(false);
    c.recordGrade('penhold', 'S', { aiLevel: 'easy' });
    expect(c.has('grade-s')).toBe(true);
    expect(new Career(store).data.bestGrades).toEqual({ blocker: 'A', penhold: 'S' });
  });

  it('loads an old save without grades', () => {
    const store = mem();
    const old = new Career(store);
    old.recordMatch(true, { aiLevel: 'easy' });
    const parsed = JSON.parse(store.value!);
    delete parsed.bestGrades;
    store.value = JSON.stringify(parsed);
    expect(new Career(store).data.bestGrades).toEqual({});
  });
});
