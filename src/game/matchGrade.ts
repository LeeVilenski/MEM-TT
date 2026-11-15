/**
 * Match grade (S / A / B / C): one letter for how well you played a match, from your
 * contact quality and the share of points you won. Pure logic, shared by offline and
 * online matches.
 *
 * The score (0–1) weights:
 *  - clean contacts (PERFECT or GOOD) out of your graded strokes: 50%;
 *  - PERFECT contacts out of your graded strokes: 15%;
 *  - points won out of points played: 35%.
 *
 * S needs a win as well as the score.
 */

export type MatchGrade = 'S' | 'A' | 'B' | 'C';

export const GRADES: readonly MatchGrade[] = ['S', 'A', 'B', 'C'];

export interface MatchGradeInput {
  /** Graded rally strokes (serves don't count). */
  strokes: number;
  /** PERFECT or GOOD contacts. */
  clean: number;
  perfect: number;
  pointsWon: number;
  pointsPlayed: number;
  won: boolean;
}

export interface MatchGradeResult {
  grade: MatchGrade;
  /** 0–1. */
  score: number;
}

/** Fewer graded strokes than this and the grade comes from points alone. */
export const MIN_STROKES = 6;

export const GRADE_THRESHOLDS = { S: 0.8, A: 0.65, B: 0.5 } as const;

/** One-line verdicts for the match card. */
export const GRADE_TEXT: Record<MatchGrade, string> = {
  S: 'Outstanding',
  A: 'Great match',
  B: 'Solid',
  C: 'Keep practising',
};

export function matchGrade(m: MatchGradeInput): MatchGradeResult {
  const points = m.pointsPlayed ? m.pointsWon / m.pointsPlayed : 0;
  let score: number;
  if (m.strokes >= MIN_STROKES) {
    const clean = m.clean / m.strokes;
    const perfect = m.perfect / m.strokes;
    score = 0.5 * clean + 0.15 * perfect + 0.35 * points;
  } else {
    // Hardly any strokes graded (aces, a very short match): points alone, scaled so a
    // clean sweep still reaches A rather than S.
    score = 0.75 * points;
  }
  score = Math.max(0, Math.min(1, score));
  const grade: MatchGrade = score >= GRADE_THRESHOLDS.S && m.won ? 'S' : score >= GRADE_THRESHOLDS.A ? 'A' : score >= GRADE_THRESHOLDS.B ? 'B' : 'C';
  return { grade, score };
}

/** true if `a` is a better grade than `b` (undefined: no grade yet). */
export function betterGrade(a: MatchGrade, b: MatchGrade | undefined): boolean {
  return b === undefined || GRADES.indexOf(a) < GRADES.indexOf(b);
}
