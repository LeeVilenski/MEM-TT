import type { AiLevel } from '../game/ai';
import { STYLES, type StyleId } from '../game/styles';
import type { VenueId } from '../render/venues';

/** Knockout tournaments against themed AI opponents. Lose once and you're out. */
export interface Round {
  /** The stage: "Round 1", "Quarter-final", "Semi-final", "Final". */
  name: string;
  level: AiLevel;
  style: StyleId;
  bestOf: number;
  venue: VenueId;
}

/** "Semi-final vs Ed": the stage and the opponent's character. */
export function roundLabel(r: Round): string {
  return `${r.name} vs ${STYLES[r.style].character}`;
}

export interface Tournament {
  id: string;
  name: string;
  description: string;
  rounds: Round[];
  xp: number;
  achievement: string;
  /** Tournament that must be won first (if any). */
  requires?: string;
}

export const TOURNAMENTS: Tournament[] = [
  {
    id: 'department-cup',
    name: 'Department Cup',
    description: 'The quarterly inter-team knockout. Four rounds; the final is best of 3.',
    xp: 300,
    achievement: 'cup',
    rounds: [
      { name: 'Round 1', level: 'easy', style: 'allround', bestOf: 1, venue: 'office' },
      { name: 'Quarter-final', level: 'easy', style: 'blocker', bestOf: 1, venue: 'server' },
      { name: 'Semi-final', level: 'medium', style: 'chopper', bestOf: 1, venue: 'server' },
      { name: 'Final', level: 'medium', style: 'looper', bestOf: 3, venue: 'conference' },
    ],
  },
  {
    id: 'championship',
    name: 'Company Championship',
    description: 'Every department sends its best. Hard opponents, and an Expert in the final, which is best of 5.',
    xp: 800,
    achievement: 'championship',
    requires: 'department-cup',
    rounds: [
      { name: 'Round 1', level: 'medium', style: 'penhold', bestOf: 3, venue: 'office' },
      { name: 'Quarter-final', level: 'medium', style: 'chopper', bestOf: 3, venue: 'server' },
      { name: 'Semi-final', level: 'hard', style: 'blocker', bestOf: 3, venue: 'conference' },
      { name: 'Final', level: 'expert', style: 'looper', bestOf: 5, venue: 'rooftop' },
    ],
  },
];

export type RunState = 'playing' | 'won' | 'eliminated';

export class TournamentRun {
  round = 0;
  state: RunState = 'playing';
  /** Game scores per round played, e.g. "2–1". */
  results: string[] = [];

  constructor(readonly tournament: Tournament) {}

  get current(): Round | null {
    return this.state === 'playing' ? this.tournament.rounds[this.round] : null;
  }

  /** Report the result of the current round's match. */
  report(won: boolean, score: string): RunState {
    if (this.state !== 'playing') return this.state;
    this.results.push(score);
    if (!won) this.state = 'eliminated';
    else if (++this.round >= this.tournament.rounds.length) this.state = 'won';
    return this.state;
  }
}

export function tournamentUnlocked(t: Tournament, won: Record<string, number>, unlockAll = false): boolean {
  return unlockAll || !t.requires || (won[t.requires] ?? 0) > 0;
}
