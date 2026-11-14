import { RUBBERS, type Rubber } from '../physics';

/**
 * Player styles: the characters (Lee, Ryan, Ed, Will and a Sysadmin), each with an IT job. A style changes handling (not the
 * physics): swing power, reach, footwork speed, where you stand, and your default
 * rubbers. For the AI it also sets stroke preferences and playing distance.
 */
export type StyleId = 'allround' | 'looper' | 'chopper' | 'blocker' | 'penhold';

/** AI stroke kinds that styles can weight (see ai.ts), serves included. */
export type StyleStroke = 'loop' | 'drive' | 'push' | 'block' | 'smash' | 'flick' | 'chop' | 'serve-short' | 'serve-long' | 'serve-side';

/** How an AI with this style plays, beyond stroke preferences (all optional; 1 / 0 = neutral). */
export interface Personality {
  /** Minimum ball height over the net (m) it will smash; lower = goes for low-percentage smashes. Default 0.42. */
  smashHeight?: number;
  /** Multiplier on how often it smashes when it can. */
  smashAppetite?: number;
  /** Multiplier on execution error for smashes (above 1 = wild). */
  smashError?: number;
  /** 0–1: against fast balls, prefers to block, and blocks them steadily. */
  blockPace?: number;
  /** 0–1: counter-loops balls it takes late, below the height of the table. */
  lowLoop?: number;
  /** 0–1: aims for the wide angles and switches sides, moving the opponent around. */
  placement?: number;
  /** Multiplier on brush (spin) for loops and serves. */
  spin?: number;
}

export interface PlayStyle {
  id: StyleId;
  /** Character name shown in the game. */
  character: string;
  /** Their IT job (the game's theme). */
  role: string;
  /** Playing style in table tennis terms. */
  label: string;
  description: string;
  /** Multiplier on stroke speed. */
  power: number;
  /** Multiplier on lateral reach. */
  reach: number;
  /** Multiplier on footwork speed. */
  footwork: number;
  /** Preferred distance of the body from the end line, metres. */
  distance: number;
  rubbers: { forehand: Rubber; backhand: Rubber };
  /** AI: relative preference for each stroke (1 = neutral). */
  ai: Partial<Record<StyleStroke, number>>;
  /** AI: playing personality. */
  personality?: Personality;
}

export const STYLES: Record<StyleId, PlayStyle> = {
  allround: {
    id: 'allround',
    character: 'Lee',
    role: 'Helpdesk Hero',
    label: 'All-rounder',
    description: 'A bit of everything, but can\'t resist slamming a ball that isn\'t quite there.',
    power: 1,
    reach: 1,
    footwork: 1,
    distance: 0.6,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: {},
    personality: { smashHeight: 0.28, smashAppetite: 1.3, smashError: 1.5 },
  },
  looper: {
    id: 'looper',
    character: 'Ryan',
    role: 'Full-Stack Dev',
    label: 'Tactician',
    description: 'Moves you around the table with placement and waits for the opening to put it away.',
    power: 1.05,
    reach: 1,
    footwork: 1.1,
    distance: 0.75,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: { drive: 1.6, loop: 1.4, push: 1.3, flick: 1.3, block: 0.9, chop: 0.3 },
    personality: { placement: 0.85, smashHeight: 0.5, smashAppetite: 1.4 },
  },
  chopper: {
    id: 'chopper',
    character: 'Sysadmin',
    role: 'Sysadmin',
    label: 'Chopper',
    description: 'Defends far from the table and sends everything back with backspin.',
    power: 0.95,
    reach: 1.12,
    footwork: 1.1,
    distance: 1.8,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.longPips },
    ai: { chop: 4, push: 2, loop: 0.5, smash: 0.6, drive: 0.4, flick: 0.5 },
  },
  blocker: {
    id: 'blocker',
    character: 'Ed',
    role: 'Security Analyst',
    label: 'Counter-attacker ("The Firewall")',
    description: 'Defends from deep, counter-loops topspin from below the table and soaks up your smashes.',
    power: 1,
    reach: 1.1,
    footwork: 1.05,
    distance: 1.2,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: { loop: 2.4, block: 2, push: 1.1, chop: 0.8, drive: 0.8, smash: 0.4 },
    personality: { blockPace: 0.85, lowLoop: 0.8, smashAppetite: 0.5 },
  },
  penhold: {
    id: 'penhold',
    character: 'Will',
    role: 'Network Engineer',
    label: 'Spinner & slammer',
    description: 'Heavy spin, especially on serve, and wild smashes that can go anywhere.',
    power: 1.15,
    reach: 0.95,
    footwork: 1.1,
    distance: 0.55,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: { loop: 2, smash: 2, flick: 1.3, drive: 1, chop: 0.2, 'serve-side': 3, 'serve-short': 1.5, 'serve-long': 0.6 },
    personality: { spin: 1.4, smashHeight: 0.3, smashAppetite: 1.8, smashError: 2.4 },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
