/**
 * Career profile: XP, career level, lifetime stats and achievements. Local to the
 * player's browser (no accounts). Pure logic with an injectable storage so it is
 * fully testable; the game calls the record* methods as things happen.
 */

import { betterGrade, type MatchGrade } from '../game/matchGrade';

export const CAREER_LEVELS = [
  { title: 'Beginner', xp: 0 },
  { title: 'Club Player', xp: 150 },
  { title: 'League Player', xp: 450 },
  { title: 'County Player', xp: 1000 },
  { title: 'Regional Player', xp: 2000 },
  { title: 'National Player', xp: 3500 },
  { title: 'World Class', xp: 6000 },
] as const;

export interface Stats {
  matchesPlayed: number;
  matchesWon: number;
  onlineMatches: number;
  pointsWon: number;
  pointsLost: number;
  aces: number;
  longestRally: number;
  fastestShot: number;
  maxRpm: number;
  shots: Record<string, number>;
  practiceReturns: number;
  practiceAttempts: number;
  /** Wins against the AI per level. */
  aiWins: Record<string, number>;
  /** Styles you've won a match with. */
  wonWithStyles: string[];
}

export interface ProfileData {
  version: 1;
  xp: number;
  stats: Stats;
  achievements: string[];
  /** Best stars per drill id. */
  drills: Record<string, number>;
  /** Best score per drill id. */
  drillScores: Record<string, number>;
  /** Tournament ids won (and how many times). */
  tournaments: Record<string, number>;
  /** Best match grade per AI opponent (style id), and 'online'. */
  bestGrades: Record<string, MatchGrade>;
  unlockAll: boolean;
}

export interface Achievement {
  id: string;
  name: string;
  description: string;
  xp: number;
}

export const ACHIEVEMENTS: Achievement[] = [
  { id: 'first-win', name: 'First Win', description: 'Win your first match', xp: 50 },
  { id: 'ace', name: 'Ace', description: 'Serve an ace', xp: 30 },
  { id: 'marathon', name: 'Marathon Rally', description: 'Play a rally of 15+ hits', xp: 60 },
  { id: 'speed', name: 'Speed Demon', description: 'Hit a shot faster than 25 m/s (90 km/h)', xp: 40 },
  { id: 'spin', name: 'Spin Doctor', description: 'Put 7,000+ rpm on the ball', xp: 40 },
  { id: 'principal', name: 'Giant Killer', description: 'Beat a Hard or Expert AI', xp: 120 },
  { id: 'full-stack', name: 'All-Rounder', description: 'Win a match with every player style', xp: 150 },
  { id: 'online', name: 'Online Debut', description: 'Finish an online match', xp: 40 },
  { id: 'drills', name: 'Training Complete', description: 'Earn 3 stars on every drill', xp: 200 },
  { id: 'cup', name: 'Cup Winner', description: 'Win the Department Cup', xp: 0 },
  { id: 'championship', name: 'Champion', description: 'Win the Company Championship', xp: 0 },
  { id: 'world-tour', name: 'World Tour Champion', description: 'Win every stop of the World Tour', xp: 300 },
  { id: 'clean-code', name: 'Clean Hitter', description: '10 clean contacts in a row', xp: 40 },
  { id: 'social-engineering', name: 'Mind Games', description: 'Win a point with a serve the AI misread', xp: 40 },
  { id: 'grade-s', name: 'Top Marks', description: 'Earn an S grade in a match', xp: 80 },
  { id: 'grade-a-hard', name: 'Class Act', description: 'Earn an A or better against a Hard or Expert AI', xp: 60 },
  { id: 'serve-reader', name: 'Serve Reader', description: 'Earn 3 stars in Read the serve', xp: 40 },
];

export interface Storage {
  load(): string | null;
  save(data: string): void;
}

const KEY = 'mem.profile.v1';

export const browserStorage: Storage = {
  load: () => {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null;
    }
  },
  save: (d) => {
    try {
      localStorage.setItem(KEY, d);
    } catch {
      /* storage unavailable: progress lasts for this session only */
    }
  },
};

function fresh(): ProfileData {
  return {
    version: 1,
    xp: 0,
    stats: {
      matchesPlayed: 0,
      matchesWon: 0,
      onlineMatches: 0,
      pointsWon: 0,
      pointsLost: 0,
      aces: 0,
      longestRally: 0,
      fastestShot: 0,
      maxRpm: 0,
      shots: {},
      practiceReturns: 0,
      practiceAttempts: 0,
      aiWins: {},
      wonWithStyles: [],
    },
    achievements: [],
    drills: {},
    drillScores: {},
    tournaments: {},
    bestGrades: {},
    unlockAll: false,
  };
}

export type CareerEvent = { type: 'xp'; amount: number; reason: string } | { type: 'level'; title: string } | { type: 'achievement'; achievement: Achievement };

export class Career {
  data: ProfileData;
  private listeners: ((e: CareerEvent) => void)[] = [];

  constructor(private storage: Storage = browserStorage) {
    this.data = fresh();
    const raw = storage.load();
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as ProfileData;
        if (parsed.version === 1) this.data = { ...fresh(), ...parsed, stats: { ...fresh().stats, ...parsed.stats } };
      } catch {
        /* corrupt save: start fresh */
      }
    }
  }

  on(fn: (e: CareerEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: CareerEvent) {
    for (const l of this.listeners) l(e);
  }

  save() {
    this.storage.save(JSON.stringify(this.data));
  }

  reset() {
    this.data = fresh();
    this.save();
  }

  // ------------------------------------------------------------ levels

  get levelIndex(): number {
    let i = 0;
    for (let k = 0; k < CAREER_LEVELS.length; k++) if (this.data.xp >= CAREER_LEVELS[k].xp) i = k;
    return i;
  }

  get title() {
    return CAREER_LEVELS[this.levelIndex].title;
  }

  /** Progress through the current level, 0–1 (1 at the top level). */
  get levelProgress(): number {
    const i = this.levelIndex;
    if (i === CAREER_LEVELS.length - 1) return 1;
    const a = CAREER_LEVELS[i].xp;
    const b = CAREER_LEVELS[i + 1].xp;
    return (this.data.xp - a) / (b - a);
  }

  addXp(amount: number, reason: string) {
    if (amount <= 0) return;
    const before = this.levelIndex;
    this.data.xp += Math.round(amount);
    this.emit({ type: 'xp', amount: Math.round(amount), reason });
    if (this.levelIndex > before) this.emit({ type: 'level', title: this.title });
    this.save();
  }

  // ------------------------------------------------------------ achievements

  has(id: string) {
    return this.data.achievements.includes(id);
  }

  award(id: string) {
    if (this.has(id)) return;
    const a = ACHIEVEMENTS.find((x) => x.id === id);
    if (!a) return;
    this.data.achievements.push(id);
    this.emit({ type: 'achievement', achievement: a });
    if (a.xp) this.addXp(a.xp, a.name);
    this.save();
  }

  // ------------------------------------------------------------ recording

  /** One of *your* shots. */
  recordShot(name: string, speed: number, rpm: number) {
    const s = this.data.stats;
    s.shots[name] = (s.shots[name] ?? 0) + 1;
    s.fastestShot = Math.max(s.fastestShot, speed);
    s.maxRpm = Math.max(s.maxRpm, rpm);
    if (speed >= 25) this.award('speed');
    if (rpm >= 7000) this.award('spin');
    this.save();
  }

  /** A point in a match (vs AI or online), from your side's point of view. */
  recordPoint(won: boolean, opts: { ace?: boolean; rallyHits?: number } = {}) {
    const s = this.data.stats;
    if (won) s.pointsWon++;
    else s.pointsLost++;
    if (opts.rallyHits) {
      s.longestRally = Math.max(s.longestRally, opts.rallyHits);
      if (opts.rallyHits >= 15) this.award('marathon');
    }
    if (won && opts.ace) {
      s.aces++;
      this.award('ace');
    }
    if (won) this.addXp(opts.ace ? 8 : 5, 'Point');
    else this.save();
  }

  /** A finished match. */
  recordMatch(won: boolean, ctx: { online?: boolean; aiLevel?: string; style?: string; games?: [number, number] } = {}) {
    const s = this.data.stats;
    s.matchesPlayed++;
    if (ctx.online) {
      s.onlineMatches++;
      this.award('online');
    }
    if (won) {
      s.matchesWon++;
      if (ctx.aiLevel) s.aiWins[ctx.aiLevel] = (s.aiWins[ctx.aiLevel] ?? 0) + 1;
      if (ctx.style && !s.wonWithStyles.includes(ctx.style)) s.wonWithStyles.push(ctx.style);
      this.award('first-win');
      if (ctx.aiLevel === 'hard' || ctx.aiLevel === 'expert') this.award('principal');
      if (s.wonWithStyles.length >= 5) this.award('full-stack');
      const mult = ctx.aiLevel === 'expert' ? 3 : ctx.aiLevel === 'hard' ? 2 : ctx.aiLevel === 'easy' ? 0.6 : ctx.online ? 1.5 : 1;
      this.addXp(60 * mult, 'Match won');
    } else {
      this.addXp(15, 'Match played');
    }
  }

  /**
   * A match grade against `opponent` (an AI style id, or 'online'). Returns true if it
   * beats your previous best against them.
   */
  recordGrade(opponent: string, grade: MatchGrade, ctx: { aiLevel?: string } = {}): boolean {
    const best = betterGrade(grade, this.data.bestGrades[opponent]);
    if (best) this.data.bestGrades[opponent] = grade;
    if (grade === 'S') this.award('grade-s');
    if ((grade === 'S' || grade === 'A') && (ctx.aiLevel === 'hard' || ctx.aiLevel === 'expert')) this.award('grade-a-hard');
    this.save();
    return best;
  }

  recordPractice(made: boolean) {
    const s = this.data.stats;
    s.practiceAttempts++;
    if (made) s.practiceReturns++;
    if (made) this.addXp(1, 'Practice');
    else this.save();
  }

  /** A drill finished with `stars` (0–3). XP only for improving your best. */
  recordDrill(id: string, stars: number, allDrillIds: string[], score = 0) {
    if (score > (this.data.drillScores[id] ?? 0)) this.data.drillScores[id] = score;
    const prev = this.data.drills[id] ?? 0;
    if (stars > prev) {
      this.data.drills[id] = stars;
      this.addXp((stars - prev) * 40, 'Drill');
    }
    if (allDrillIds.every((d) => (this.data.drills[d] ?? 0) >= 3)) this.award('drills');
    if (id === 'serve-read' && stars >= 3) this.award('serve-reader');
    this.save();
  }

  recordTournament(id: string, xp: number, achievement?: string) {
    this.data.tournaments[id] = (this.data.tournaments[id] ?? 0) + 1;
    this.addXp(xp, 'Tournament won');
    if (achievement) this.award(achievement);
    this.save();
  }

  setUnlockAll(on: boolean) {
    this.data.unlockAll = on;
    this.save();
  }
}
