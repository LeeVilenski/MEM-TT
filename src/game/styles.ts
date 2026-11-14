import { RUBBERS, type Rubber } from '../physics';

/**
 * Player styles: the characters (Lee, Ryan, Ed, Will and a Sysadmin), each with an IT job. A style changes handling (not the
 * physics): swing power, reach, footwork speed, where you stand, and your default
 * rubbers. For the AI it also sets stroke preferences and playing distance.
 */
export type StyleId = 'allround' | 'looper' | 'chopper' | 'blocker' | 'penhold';

/** AI stroke kinds that styles can weight (see ai.ts). */
export type StyleStroke = 'loop' | 'drive' | 'push' | 'block' | 'smash' | 'flick' | 'chop';

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
}

export const STYLES: Record<StyleId, PlayStyle> = {
  allround: {
    id: 'allround',
    character: 'Lee',
    role: 'Helpdesk Hero',
    label: 'All-rounder',
    description: 'Balanced: a bit of everything, no weaknesses.',
    power: 1,
    reach: 1,
    footwork: 1,
    distance: 0.6,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: {},
  },
  looper: {
    id: 'looper',
    character: 'Ryan',
    role: 'Full-Stack Dev',
    label: 'Looper',
    description: 'Heavy topspin from both wings, from mid-distance.',
    power: 1.1,
    reach: 1,
    footwork: 1.05,
    distance: 0.9,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted },
    ai: { loop: 3, drive: 1.2, block: 0.5, push: 0.6, chop: 0.2 },
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
    label: 'Blocker ("The Firewall")',
    description: 'Glued to the table, blocking and redirecting your pace.',
    power: 0.9,
    reach: 0.95,
    footwork: 0.95,
    distance: 0.35,
    rubbers: { forehand: RUBBERS.inverted, backhand: RUBBERS.shortPips },
    ai: { block: 4, drive: 1.3, push: 1.2, loop: 0.4, chop: 0.1 },
  },
  penhold: {
    id: 'penhold',
    character: 'Will',
    role: 'Network Engineer',
    label: 'Penhold hitter',
    description: 'Fast, flat and early: drives, flicks and smashes.',
    power: 1.15,
    reach: 0.95,
    footwork: 1.15,
    distance: 0.45,
    rubbers: { forehand: RUBBERS.shortPips, backhand: RUBBERS.inverted },
    ai: { drive: 3, flick: 2.5, smash: 2, loop: 0.7, chop: 0.1 },
  },
};

export const STYLE_IDS = Object.keys(STYLES) as StyleId[];
