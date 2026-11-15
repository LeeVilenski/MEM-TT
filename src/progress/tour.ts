import type { AiLevel } from '../game/ai';
import { STYLES, type StyleId } from '../game/styles';
import type { VenueId } from '../render/venues';
import { TOURNAMENTS, TournamentRun, roundLabel, type Round, type Tournament } from './tournament';

/**
 * World Tour: a route of stops, starting at MEM HQ, each at its own venue and with its own
 * event: a knockout (lose once and you're out), or a round-robin group of four (play everyone
 * once; the top two meet in a final). Win a stop to travel on to the next.
 * Pure logic; the random source (for the AI-vs-AI group matches) is injectable for tests.
 */

/** A group opponent: named after their character. */
export interface GroupOpponent {
  style: StyleId;
  level: AiLevel;
}

interface StopBase {
  id: string;
  name: string;
  /** Where it is, e.g. "MEM HQ". */
  place: string;
  venue: VenueId;
  blurb: string;
  xp: number;
  achievement?: string;
}

export interface KnockoutStop extends StopBase {
  format: 'knockout';
  rounds: Round[];
}

export interface GroupStop extends StopBase {
  format: 'group';
  opponents: [GroupOpponent, GroupOpponent, GroupOpponent];
  /** Group matches, and the final. */
  bestOf: number;
  finalBestOf: number;
}

export type TourStop = KnockoutStop | GroupStop;

const cup = TOURNAMENTS.find((t) => t.id === 'department-cup')!;
const champ = TOURNAMENTS.find((t) => t.id === 'championship')!;
const at = (rounds: Round[], venue: VenueId) => rounds.map((r) => ({ ...r, venue }));

export const TOUR_STOPS: TourStop[] = [
  {
    id: 'department-cup',
    name: 'Department Cup',
    place: 'MEM HQ',
    venue: 'mem',
    format: 'knockout',
    blurb: 'Where it all starts: the quarterly inter-team knockout at head office. The final is best of 3.',
    xp: cup.xp,
    achievement: cup.achievement,
    rounds: at(cup.rounds, 'mem'),
  },
  {
    id: 'sprint-league',
    name: 'Office League',
    place: 'Open-plan office',
    venue: 'office',
    format: 'group',
    blurb: 'A round-robin between office teams. Play everyone once; the top two meet in a best-of-3 final.',
    xp: 350,
    opponents: [
      { style: 'pusher', level: 'easy' },
      { style: 'looper', level: 'medium' },
      { style: 'patient', level: 'easy' },
    ],
    bestOf: 1,
    finalBestOf: 3,
  },
  {
    id: 'datacentre-knockout',
    name: 'Data Centre Knockout',
    place: 'Server room',
    venue: 'server',
    format: 'knockout',
    blurb: 'Three rounds among the humming racks. The final is best of 3.',
    xp: 400,
    rounds: [
      { name: 'Round 1', level: 'medium', style: 'chopper', bestOf: 1, venue: 'server' },
      { name: 'Semi-final', level: 'medium', style: 'penhold', bestOf: 1, venue: 'server' },
      { name: 'Final', level: 'medium', style: 'blocker', bestOf: 3, venue: 'server' },
    ],
  },
  {
    id: 'park-open',
    name: 'Park Open',
    place: 'City Park',
    venue: 'park',
    format: 'group',
    blurb: 'Out of the office: concrete tables in the park, a round-robin group, then a best-of-3 final.',
    xp: 500,
    opponents: [
      { style: 'wheelchair', level: 'medium' },
      { style: 'blocker', level: 'hard' },
      { style: 'chopper', level: 'medium' },
    ],
    bestOf: 1,
    finalBestOf: 3,
  },
  {
    id: 'board-showdown',
    name: 'Boardroom Showdown',
    place: 'Conference room',
    venue: 'conference',
    format: 'knockout',
    blurb: 'The executives clear the table for a knockout. Hard opponents, every match best of 3.',
    xp: 600,
    rounds: [
      { name: 'Quarter-final', level: 'medium', style: 'wheelchair', bestOf: 3, venue: 'conference' },
      { name: 'Semi-final', level: 'hard', style: 'allround', bestOf: 3, venue: 'conference' },
      { name: 'Final', level: 'hard', style: 'looper', bestOf: 3, venue: 'conference' },
    ],
  },
  {
    id: 'beach-classic',
    name: 'Beach Classic',
    place: 'Offsite beach',
    venue: 'beach',
    format: 'group',
    blurb: 'Sand, sea breeze and a hard group. Best of 3 in the group; the final is best of 5.',
    xp: 700,
    opponents: [
      { style: 'looper', level: 'hard' },
      { style: 'penhold', level: 'hard' },
      { style: 'patient', level: 'hard' },
    ],
    bestOf: 3,
    finalBestOf: 5,
  },
  {
    id: 'championship',
    name: 'Company Championship',
    place: 'Rooftop',
    venue: 'rooftop',
    format: 'knockout',
    blurb: 'Every department sends its best, ending in a best-of-5 final against an Expert opponent.',
    xp: champ.xp,
    achievement: champ.achievement,
    rounds: at(champ.rounds, 'rooftop'),
  },
];

/** A stop is open once the stop before it has been won. */
export function stopUnlocked(index: number, won: Record<string, number>, unlockAll = false): boolean {
  return unlockAll || index === 0 || (won[TOUR_STOPS[index - 1]?.id] ?? 0) > 0;
}

/** Stops won so far. */
export function stopsWon(won: Record<string, number>): number {
  return TOUR_STOPS.filter((s) => (won[s.id] ?? 0) > 0).length;
}

// ---------------------------------------------------------------- round-robin group

export interface GroupEntry {
  id: string;
  name: string;
  style?: StyleId;
  level?: AiLevel;
  you?: boolean;
}

export interface GroupRow {
  entry: GroupEntry;
  played: number;
  won: number;
  lost: number;
  gamesFor: number;
  gamesAgainst: number;
}

export interface GroupResult {
  a: string;
  b: string;
  /** Games won by a and by b. */
  score: [number, number];
}

/** Relative strength of each AI level, for simulating the matches you don't play. */
const STRENGTH: Record<AiLevel, number> = { easy: 1, medium: 1.8, hard: 3, expert: 4.5 };

/** Your fixtures, in order, and the other match each matchday (indices into the entries). */
const MATCHDAYS: [number, number, number, number][] = [
  [0, 1, 2, 3],
  [0, 2, 1, 3],
  [0, 3, 1, 2],
];

export type GroupPhase = 'group' | 'final' | 'won' | 'eliminated';

export class GroupRun {
  readonly entries: GroupEntry[];
  readonly results: GroupResult[] = [];
  matchday = 0;
  phase: GroupPhase = 'group';
  finalOpponent: GroupEntry | null = null;
  /** The final's score (yours first), once played. */
  finalScore: [number, number] | null = null;

  constructor(
    readonly stop: GroupStop,
    private rng: () => number = Math.random,
  ) {
    this.entries = [{ id: 'you', name: 'You', you: true }, ...stop.opponents.map((o, i) => ({ id: `o${i}`, name: STYLES[o.style].character, style: o.style, level: o.level }))];
  }

  /** Who you play next (null when it's over). */
  get opponent(): GroupEntry | null {
    if (this.phase === 'group') return this.entries[MATCHDAYS[this.matchday][1]];
    if (this.phase === 'final') return this.finalOpponent;
    return null;
  }

  /** Report your match: games won by you and by them. */
  report(mine: number, theirs: number): GroupPhase {
    if (this.phase === 'final') {
      this.finalScore = [mine, theirs];
      this.phase = mine > theirs ? 'won' : 'eliminated';
      return this.phase;
    }
    if (this.phase !== 'group') return this.phase;
    const [y, o, a, b] = MATCHDAYS[this.matchday];
    this.results.push({ a: this.entries[y].id, b: this.entries[o].id, score: [mine, theirs] });
    this.results.push({ a: this.entries[a].id, b: this.entries[b].id, score: this.simulate(this.entries[a], this.entries[b]) });
    if (++this.matchday < MATCHDAYS.length) return this.phase;
    const top = this.standings().slice(0, 2);
    const you = top.findIndex((r) => r.entry.you);
    if (you < 0) this.phase = 'eliminated';
    else {
      this.phase = 'final';
      this.finalOpponent = top[1 - you].entry;
    }
    return this.phase;
  }

  /** An AI-vs-AI match, by relative strength. */
  private simulate(a: GroupEntry, b: GroupEntry): [number, number] {
    const sa = STRENGTH[a.level ?? 'medium'];
    const sb = STRENGTH[b.level ?? 'medium'];
    const p = sa / (sa + sb);
    const need = Math.ceil(this.stop.bestOf / 2);
    let ga = 0;
    let gb = 0;
    while (ga < need && gb < need) this.rng() < p ? ga++ : gb++;
    return [ga, gb];
  }

  /** The group table: wins, then game difference, then games won, then head-to-head. */
  standings(): GroupRow[] {
    const rows = new Map<string, GroupRow>(this.entries.map((e) => [e.id, { entry: e, played: 0, won: 0, lost: 0, gamesFor: 0, gamesAgainst: 0 }]));
    for (const r of this.results) {
      const a = rows.get(r.a)!;
      const b = rows.get(r.b)!;
      a.played++;
      b.played++;
      a.gamesFor += r.score[0];
      a.gamesAgainst += r.score[1];
      b.gamesFor += r.score[1];
      b.gamesAgainst += r.score[0];
      if (r.score[0] > r.score[1]) (a.won++, b.lost++);
      else (b.won++, a.lost++);
    }
    const beat = (x: string, y: string) => this.results.some((r) => (r.a === x && r.b === y && r.score[0] > r.score[1]) || (r.b === x && r.a === y && r.score[1] > r.score[0]));
    return [...rows.values()].sort(
      (p, q) => q.won - p.won || q.gamesFor - q.gamesAgainst - (p.gamesFor - p.gamesAgainst) || q.gamesFor - p.gamesFor || (beat(p.entry.id, q.entry.id) ? -1 : beat(q.entry.id, p.entry.id) ? 1 : 0),
    );
  }
}

// ---------------------------------------------------------------- a stop in progress

/** The next match to play at a stop. */
export interface Fixture {
  /** e.g. "Semi-final vs Ed" or "Group match 2 vs Will": the stage and the character. */
  label: string;
  style: StyleId;
  level: AiLevel;
  bestOf: number;
  venue: VenueId;
}

export type StopState = 'playing' | 'won' | 'eliminated';

export class TourRun {
  readonly knockout: TournamentRun | null = null;
  readonly group: GroupRun | null = null;

  constructor(
    readonly stop: TourStop,
    rng: () => number = Math.random,
  ) {
    if (stop.format === 'knockout') {
      const t: Tournament = { id: stop.id, name: stop.name, description: stop.blurb, rounds: stop.rounds, xp: stop.xp, achievement: stop.achievement ?? '' };
      this.knockout = new TournamentRun(t);
    } else this.group = new GroupRun(stop, rng);
  }

  get state(): StopState {
    if (this.knockout) return this.knockout.state;
    const p = this.group!.phase;
    return p === 'won' ? 'won' : p === 'eliminated' ? 'eliminated' : 'playing';
  }

  get current(): Fixture | null {
    if (this.knockout) {
      const r = this.knockout.current;
      return r && { label: roundLabel(r), style: r.style, level: r.level, bestOf: r.bestOf, venue: r.venue };
    }
    const g = this.group!;
    const o = g.opponent;
    if (!o || !o.style || !o.level) return null;
    const stop = g.stop;
    return g.phase === 'final'
      ? { label: `Final vs ${o.name}`, style: o.style, level: o.level, bestOf: stop.finalBestOf, venue: stop.venue }
      : { label: `Group match ${g.matchday + 1} vs ${o.name}`, style: o.style, level: o.level, bestOf: stop.bestOf, venue: stop.venue };
  }

  /** Report your match: games won by you and by them. */
  report(mine: number, theirs: number): StopState {
    if (this.knockout) this.knockout.report(mine > theirs, `${mine}–${theirs}`);
    else this.group!.report(mine, theirs);
    return this.state;
  }
}
