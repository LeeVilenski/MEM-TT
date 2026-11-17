import type { AiLevel } from './ai';
import type { StyleId } from './styles';
import { STYLES } from './styles';

/**
 * Scouting reports: what to expect from an AI opponent and how to beat them, shown
 * before World Tour matches. The notes match how each style's AI actually plays
 * (its stroke preferences and personality in styles.ts); the level line matches
 * what the difficulty changes (reaction, footwork, accuracy and reading serves).
 */

export interface ScoutReport {
  /** e.g. "Ed · Counter-attacker". */
  title: string;
  /** One-line summary of their game. */
  headline: string;
  /** What they do (two or three short points). */
  traits: string[];
  /** How to beat them. */
  plan: string;
  /** What their level means. */
  level: string;
}

const NOTES: Record<StyleId, { headline: string; traits: string[]; plan: string }> = {
  allround: {
    headline: 'A bit of everything, and loves a cheeky smash.',
    traits: ['Goes for smashes on balls that aren’t really high enough', 'Misses some of those smashes', 'No big weakness otherwise'],
    plan: 'Keep it low over the net. Lee will try to smash balls that aren’t high enough: offer a half-high ball to go for, and be ready for it to come back (or not).',
  },
  looper: {
    headline: 'A tactician: moves you around and waits for the opening.',
    traits: ['Wide placement, switching sides', 'Only smashes a genuinely high ball', 'Drives and loops from mid-distance'],
    plan: 'Expect to be pulled wide: recover to the middle after every shot. Short, low balls stop the placement game; don’t pop anything up.',
  },
  chopper: {
    headline: 'Defends from deep and sends everything back with backspin.',
    traits: ['Chops from about 2.6 m back', 'Long pips on the backhand turn your topspin into backspin', 'Rarely attacks'],
    plan: 'Be patient: loop with lift, not power, then drop a short ball while the Sysadmin is deep. Watch the long-pips side: your own topspin comes back as backspin.',
  },
  blocker: {
    headline: 'A counter-attacker who soaks up pace.',
    traits: ['Returns about 70% of smashes and power loops', 'Lets pushes drop and loops them from below the table', 'Blocks steadily from deep'],
    plan: 'Don’t try to blast through Ed. Win with placement and change of pace: short balls bring Ed in, then go wide. Heavy pushes won’t cause trouble.',
  },
  penhold: {
    headline: 'Heavy spin, slices, and wild smashes that can go anywhere.',
    traits: ['Spinny serves, mostly sidespin', 'Slices a lot of balls with backspin', 'Smashes often, and misses often'],
    plan: 'Read the serve: aim against the sidespin’s curve. Keep the ball low and steady; Will gives away points with wild smashes if you make one more shot necessary.',
  },
  pusher: {
    headline: 'Pushes everything back low and waits for your mistake.',
    traits: ['Mostly backspin pushes and chops', 'Short serves', 'Almost never smashes'],
    plan: 'Open up with topspin (brush up through the ball) rather than pushing all day. Loop with plenty of lift so the backspin doesn’t drag it into the net.',
  },
  patient: {
    headline: 'Never puts spin on anything. Pats it back flat, all day.',
    traits: ['Every stroke is flat, on short pips', 'Aims well inside the lines and makes few errors', 'Almost never smashes'],
    plan: 'Paul’s flat balls have no spin to use: create your own with loops. Don’t rush: Paul wins by waiting, so go for the winner only on a genuinely loose ball.',
  },
  wheelchair: {
    headline: 'Tight to the table: quick hands, early blocks and sharp angles.',
    traits: ['Takes the ball early and works the angles', 'Blocks pace well', 'Covers less ground sideways in the chair'],
    plan: 'Make her move: go wide to the corners, then switch. She’s left-handed, so her forehand is on your right. Expect your pace to come straight back.',
  },
  attacker: {
    headline: 'Serves short with heavy backspin, then attacks the very next ball.',
    traits: ['Short backspin serves, built to make you push', 'Loops, flicks or smashes the third ball hard', 'Less accurate the longer the rally goes'],
    plan: 'Don’t hand George the push he wants: flick his short serve, or push it short and low so there’s nothing to attack. Get through the first three shots and keep the ball in play; the longer the rally, the more he misses.',
  },
};

const LEVEL_NOTES: Record<AiLevel, string> = {
  easy: 'Easy: slow to react and often misreads your serve’s spin.',
  medium: 'Medium: decent footwork, and reads your serves only roughly.',
  hard: 'Hard: quick, accurate and reads most serves. Mix your serves up.',
  expert: 'Expert: very quick and very accurate, and reads serves well. Repeating one serve gets it read even better.',
};

export function scoutReport(style: StyleId, level: AiLevel): ScoutReport {
  const st = STYLES[style];
  const n = NOTES[style];
  return { title: `${st.character} · ${st.label}`, headline: n.headline, traits: n.traits, plan: n.plan, level: LEVEL_NOTES[level] };
}
