/**
 * Training drills: structured ball-machine sessions with a goal, scored in stars.
 * Each drill feeds a fixed number of balls from its presets; a ball counts as a
 * success if your return lands on the far half and passes the drill's check
 * (e.g. it must be topspin, or land in a target zone).
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
  description: string;
  /** Ball-machine presets fed in order (cycled). */
  presets: string[];
  balls: number;
  /** Extra condition on a return that landed. */
  check?: (r: DrillReturn) => boolean;
  /** Short text describing the check, shown in the drill HUD. */
  goal: string;
  target?: TargetZone;
  /** Successes needed for 1, 2 and 3 stars. */
  stars: [number, number, number];
}

const isTopspin = (r: DrillReturn) => r.top > 15;
const isBackspin = (r: DrillReturn) => r.top < -15;
const inZone = (z: TargetZone) => (r: DrillReturn) => !!r.landing && r.landing.x >= z.x0 && r.landing.x <= z.x1 && r.landing.z >= z.z0 && r.landing.z <= z.z1;

const DEEP_BACKHAND: TargetZone = { x0: 0.25, x1: 0.76, z0: -1.37, z1: -0.85 };

export const DRILLS: Drill[] = [
  {
    id: 'onboarding',
    name: 'Onboarding: keep it on the table',
    description: 'Return 10 mixed balls onto the far half. Any shot counts.',
    presets: ['Long push', 'Block', 'Drive', 'Float'],
    balls: 10,
    goal: 'Return it onto the table',
    stars: [4, 6, 8],
  },
  {
    id: 'push',
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
    name: 'The Firewall',
    description: 'Power loops incoming. Block them back: a still or short paddle with a closed face.',
    presets: ['Power loop', 'Opening loop', 'Hook loop'],
    balls: 10,
    goal: 'Get the loop back',
    stars: [3, 5, 7],
  },
  {
    id: 'target',
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
    name: 'On-call defence',
    description: 'Stand back and chop the loops back with backspin.',
    presets: ['Power loop', 'Opening loop', 'Lob'],
    balls: 10,
    check: isBackspin,
    goal: 'Return with backspin',
    stars: [2, 4, 6],
  },
];

export class DrillSession {
  fed = 0;
  successes = 0;
  /** Result of each ball, for the HUD. */
  log: boolean[] = [];

  constructor(readonly drill: Drill) {}

  get done() {
    return this.log.length >= this.drill.balls;
  }

  /** Preset for the next ball (null when all balls have been fed). */
  nextPreset(): string | null {
    if (this.fed >= this.drill.balls) return null;
    return this.drill.presets[this.fed++ % this.drill.presets.length];
  }

  /** Register the outcome of the current ball. Returns whether it counted. */
  register(r: DrillReturn): boolean {
    if (this.done) return false;
    const ok = r.result === 'IN' && (this.drill.check ? this.drill.check(r) : true);
    this.log.push(ok);
    if (ok) this.successes++;
    return ok;
  }

  get stars(): number {
    const [a, b, c] = this.drill.stars;
    return this.successes >= c ? 3 : this.successes >= b ? 2 : this.successes >= a ? 1 : 0;
  }
}

/** Drills unlock in order: each needs at least one star on the previous one. */
export function drillUnlocked(index: number, best: Record<string, number>, unlockAll = false): boolean {
  return unlockAll || index === 0 || (best[DRILLS[index - 1].id] ?? 0) >= 1;
}
