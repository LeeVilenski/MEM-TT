import type { ContactGrade } from '../game/contact';

/**
 * Training drills: structured ball-machine sessions with a goal, scored in stars.
 * Each drill feeds a number of balls from its presets (in order or at random, optionally
 * placed to set spots, or with a side called out before each ball); a ball counts as a
 * success if your return lands on the far half and passes the drill's check (e.g. it must
 * be topspin, land in a target zone, or be cleanly struck).
 * Successes give stars; points (with the contact grade and a combo multiplier) give a score.
 */

export interface DrillReturn {
  /** 'IN' if the return landed on the opponent's half. */
  result: 'IN' | 'OUT' | 'OWN SIDE' | 'MISSED';
  /** Shot name from the shot classifier (e.g. 'Loop', 'Push'). */
  shot: string;
  /** Topspin (+) / backspin (−) of the return, rps. */
  top: number;
  speed: number;
  /** Where it landed on the far half (world x, z), if it did. */
  landing?: { x: number; z: number };
  /** How cleanly it was struck (contact grading), if it was hit. */
  grade?: ContactGrade;
}

export type DrillCategory = 'Fundamentals' | 'Footwork' | 'Reading spin' | 'Placement' | 'Consistency' | 'Timing';

/** One fed ball: the machine preset, where on your half it's sent, and a called side. */
export interface DrillBall {
  preset: string;
  /** Machine target across your half (world x), overriding the preset's. */
  x?: number;
  /** Where your return must go: the far half's left or right (as you look at it). */
  call?: 'left' | 'right';
}

export interface TargetZone {
  /** Rectangle on the far half (world coordinates; far half is z < 0). */
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}

export interface Drill {
  id: string;
  name: string;
  category: DrillCategory;
  description: string;
  /** Ball-machine presets, fed in order (cycled) or at random. */
  presets: string[];
  feed?: 'sequence' | 'random';
  /** Machine target x per ball (cycled; random order with a random feed). */
  placements?: number[];
  /** Call a side (left/right) before each ball: the return must land there. */
  calls?: boolean;
  /** Seconds between a ball being resolved and the next one (default 0.9). */
  feedDelay?: number;
  /** Drill that must have a star first (default: the drill before it in the list). */
  requires?: string;
  balls: number;
  /** Extra condition on a return that landed. */
  check?: (r: DrillReturn, ball: DrillBall) => boolean;
  /** Short text describing the check, shown in the drill HUD. */
  goal: string;
  target?: TargetZone;
  /** Successes needed for 1, 2 and 3 stars. */
  stars: [number, number, number];
}

const isTopspin = (r: DrillReturn) => r.top > 15;
const isClean = (r: DrillReturn) => r.grade === 'PERFECT' || r.grade === 'GOOD';
const onCalledSide = (r: DrillReturn, b: DrillBall) => !!r.landing && (b.call === 'left' ? r.landing.x < -0.05 : r.landing.x > 0.05);
const isBackspin = (r: DrillReturn) => r.top < -15;
const inZone = (z: TargetZone) => (r: DrillReturn) => !!r.landing && r.landing.x >= z.x0 && r.landing.x <= z.x1 && r.landing.z >= z.z0 && r.landing.z <= z.z1;

const DEEP_BACKHAND: TargetZone = { x0: 0.25, x1: 0.76, z0: -1.37, z1: -0.85 };

export const DRILLS: Drill[] = [
  {
    id: 'onboarding',
    category: 'Fundamentals',
    name: 'Onboarding: keep it on the table',
    description: 'Return 10 mixed balls onto the far half. Any shot counts.',
    presets: ['Long push', 'Block', 'Drive', 'Float'],
    balls: 10,
    goal: 'Return it onto the table',
    stars: [4, 6, 8],
  },
  {
    id: 'push',
    category: 'Fundamentals',
    name: 'Push back',
    description: 'Short and long pushes are coming. Return them with backspin (brush down under the ball).',
    presets: ['Push', 'Long push'],
    balls: 10,
    check: isBackspin,
    goal: 'Return with backspin',
    stars: [3, 5, 7],
  },
  {
    id: 'open-loop',
    category: 'Fundamentals',
    name: 'Open up against backspin',
    description: 'Loop the backspin: brush up and forward with a slightly closed face.',
    presets: ['Long push', 'Chop'],
    balls: 10,
    check: isTopspin,
    goal: 'Return with topspin',
    stars: [3, 5, 7],
  },
  {
    id: 'firewall',
    category: 'Fundamentals',
    name: 'The Firewall',
    description: 'Power loops incoming. Block them back: a still or short paddle with a closed face.',
    presets: ['Power loop', 'Opening loop', 'Hook loop'],
    balls: 10,
    goal: 'Get the loop back',
    stars: [3, 5, 7],
  },
  {
    id: 'target',
    category: 'Placement',
    name: 'Ship it to the corner',
    description: 'Drive or loop the ball deep to the far backhand corner (marked zone).',
    presets: ['Block', 'Drive', 'Float'],
    balls: 10,
    check: inZone(DEEP_BACKHAND),
    target: DEEP_BACKHAND,
    goal: 'Land it in the zone',
    stars: [2, 4, 6],
  },
  {
    id: 'defence',
    category: 'Fundamentals',
    name: 'On-call defence',
    description: 'Stand back and chop the loops back with backspin.',
    presets: ['Power loop', 'Opening loop', 'Lob'],
    balls: 10,
    check: isBackspin,
    goal: 'Return with backspin',
    stars: [2, 4, 6],
  },
  {
    id: 'falkenberg',
    name: 'Falkenberg',
    category: 'Footwork',
    requires: 'onboarding',
    description: 'The classic footwork pattern: backhand corner, backhand corner, then wide to your forehand. Move your feet (and bat) to each one.',
    presets: ['Block', 'Drive'],
    placements: [-0.5, -0.5, 0.55],
    feedDelay: 0.7,
    balls: 12,
    goal: 'Return it onto the table',
    stars: [5, 8, 10],
  },
  {
    id: 'random-corners',
    name: 'Random corners',
    category: 'Footwork',
    requires: 'falkenberg',
    description: 'Wide balls to either corner, at random. Read the direction early and get across.',
    presets: ['Block', 'Drive', 'Long push'],
    feed: 'random',
    placements: [-0.6, 0.6],
    balls: 12,
    goal: 'Return it onto the table',
    stars: [5, 8, 10],
  },
  {
    id: 'read-spin',
    name: 'Chop or float?',
    category: 'Reading spin',
    requires: 'onboarding',
    description: 'Heavy chops and no-spin floats, mixed up. They look the same off the machine: a chop needs lift, a float pops up if you open the face.',
    presets: ['Chop', 'Float'],
    feed: 'random',
    balls: 12,
    goal: 'Return it onto the table',
    stars: [5, 8, 10],
  },
  {
    id: 'side-read',
    name: 'Sidespin and gyro',
    category: 'Reading spin',
    requires: 'read-spin',
    description: 'Hook loops, corkscrews and banana flicks that curve and kick sideways. Follow the ball, not the machine.',
    presets: ['Hook loop', 'Corkscrew', 'Banana flick'],
    feed: 'random',
    balls: 10,
    goal: 'Return it onto the table',
    stars: [4, 6, 8],
  },
  {
    id: 'call-shot',
    name: 'Call your shot',
    category: 'Placement',
    requires: 'onboarding',
    description: 'A side is called before each ball: LEFT or RIGHT. Put your return on that half (angle your swipe to aim).',
    presets: ['Block', 'Drive', 'Float'],
    feed: 'random',
    calls: true,
    check: onCalledSide,
    balls: 12,
    goal: 'Land it on the called side',
    stars: [4, 7, 9],
  },
  {
    id: 'endurance',
    name: 'On-call shift',
    category: 'Consistency',
    requires: 'onboarding',
    description: 'Multi-ball: 25 mixed balls, fed fast. Keep them coming back; the combo multiplier rewards a long run.',
    presets: ['Block', 'Drive', 'Long push', 'Float'],
    feed: 'random',
    feedDelay: 0.45,
    balls: 25,
    goal: 'Return it onto the table',
    stars: [12, 18, 22],
  },
  {
    id: 'timing',
    name: 'Timing trainer',
    category: 'Timing',
    requires: 'onboarding',
    description: 'Only clean contacts count: swipe through the ball as it reaches the ring, not before, and not too hard.',
    presets: ['Block', 'Drive', 'Long push'],
    check: isClean,
    balls: 12,
    goal: 'A clean (GOOD or PERFECT) return',
    stars: [5, 8, 10],
  },
];

/** Drill categories, in menu order. */
export const DRILL_CATEGORIES: DrillCategory[] = ['Fundamentals', 'Footwork', 'Reading spin', 'Placement', 'Consistency', 'Timing'];

/** Points for a successful ball: more for a clean contact. */
const GRADE_BONUS: Partial<Record<ContactGrade, number>> = { PERFECT: 50, GOOD: 20 };

export interface CoachReport {
  clean: number;
  early: number;
  edge: number;
  overhit: number;
  /** Balls not touched at all. */
  missed: number;
  tip: string;
}

export class DrillSession {
  fed = 0;
  successes = 0;
  /** Result of each ball, for the HUD. */
  log: boolean[] = [];
  score = 0;
  /** Successes in a row, and the best run. */
  combo = 0;
  bestCombo = 0;
  /** The ball in play (its called side, for the check). */
  ball: DrillBall | null = null;
  private grades: (ContactGrade | 'MISSED')[] = [];

  constructor(
    readonly drill: Drill,
    private rng: () => number = Math.random,
  ) {}

  /** The next ball (null when all balls have been fed). */
  nextBall(): DrillBall | null {
    const d = this.drill;
    if (this.fed >= d.balls) return null;
    const i = this.fed++;
    const pick = <T>(list: T[]) => (d.feed === 'random' ? list[Math.floor(this.rng() * list.length)] : list[i % list.length]);
    const ball: DrillBall = { preset: pick(d.presets) };
    if (d.placements) ball.x = pick(d.placements);
    if (d.calls) ball.call = this.rng() < 0.5 ? 'left' : 'right';
    return (this.ball = ball);
  }

  get done() {
    return this.log.length >= this.drill.balls;
  }

  /** Preset for the next ball (null when all balls have been fed). */
  nextPreset(): string | null {
    return this.nextBall()?.preset ?? null;
  }

  /** Register the outcome of the current ball. Returns whether it counted. */
  register(r: DrillReturn): boolean {
    if (this.done) return false;
    const ok = r.result === 'IN' && (this.drill.check ? this.drill.check(r, this.ball ?? { preset: '' }) : true);
    this.log.push(ok);
    this.grades.push(r.result === 'MISSED' && !r.grade ? 'MISSED' : (r.grade ?? 'GOOD'));
    if (ok) {
      this.successes++;
      this.combo++;
      this.bestCombo = Math.max(this.bestCombo, this.combo);
      this.score += Math.round((100 + (r.grade ? (GRADE_BONUS[r.grade] ?? 0) : 0)) * (1 + 0.1 * Math.min(this.combo - 1, 10)));
    } else this.combo = 0;
    return ok;
  }

  /** What went well and what to work on, from the contact grades. */
  report(): CoachReport {
    const count = (g: ContactGrade | 'MISSED') => this.grades.filter((x) => x === g).length;
    const r = { clean: count('PERFECT') + count('GOOD'), early: count('EARLY'), edge: count('EDGE'), overhit: count('OVERHIT'), missed: count('MISSED') };
    const worst = Math.max(r.early, r.edge, r.overhit, r.missed);
    let tip: string;
    if (worst === 0 || worst < 2) tip = this.stars >= 3 ? 'Clean work. Try the next drill, or a harder realism setting.' : `Your contact is good: focus on the goal (${this.drill.goal.toLowerCase()}).`;
    else if (worst === r.missed) tip = 'Get the bat to the ring before the ball arrives, then swipe.';
    else if (worst === r.early) tip = "You're swinging early: start the swipe as the ball reaches the ring, not before.";
    else if (worst === r.edge) tip = 'Line the bat up first: put it on the ring, then swipe through the ball.';
    else tip = 'Ease off: a swipe much harder than needed adds risk, not pace.';
    return { ...r, tip };
  }

  get stars(): number {
    const [a, b, c] = this.drill.stars;
    return this.successes >= c ? 3 : this.successes >= b ? 2 : this.successes >= a ? 1 : 0;
  }
}

/** A drill unlocks with a star on the one it requires (by default, the drill before it). */
export function drillUnlocked(index: number, best: Record<string, number>, unlockAll = false): boolean {
  if (unlockAll || index === 0) return true;
  const need = DRILLS[index].requires ?? DRILLS[index - 1].id;
  return (best[need] ?? 0) >= 1;
}
