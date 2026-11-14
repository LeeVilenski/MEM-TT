import type { DrillReturn } from './drills';

/**
 * Interactive tutorial: a guided ball-machine session, one skill per step. Each
 * step feeds its presets until you've done the thing it asks often enough;
 * there's no ball limit and no score. Engine-agnostic: the Sandbox feeds balls
 * from `preset()` and reports each return with `register()`.
 */

export interface TutorialStep {
  id: string;
  title: string;
  /** Instructions, with {mouse|touch} alternatives picked by `text()`. */
  mouse: string;
  touch: string;
  presets: string[];
  /** How many successes move you on. */
  needed: number;
  /** What counts (default: the return landed). */
  check?: (r: DrillReturn) => boolean;
}

const landed = (r: DrillReturn) => r.result === 'IN';

export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'touch',
    title: 'Meet the ball',
    mouse: 'Move the mouse: the bat goes exactly where you put it. Put it on the <b>cyan ring</b> as the ball arrives. You only need to get close: the bat snaps onto the ball.',
    touch: 'Drag anywhere: the bat follows your finger. Put it on the <b>cyan ring</b> as the ball arrives. You only need to get close: the bat snaps onto the ball.',
    presets: ['Float'],
    needed: 2,
    check: (r) => r.result !== 'MISSED',
  },
  {
    id: 'land',
    title: 'Keep it on the table',
    mouse: 'Now send it back over the net. A small <b>upward flick</b> through the ring is all it takes.',
    touch: 'Now send it back over the net. A small <b>upward swipe</b> through the ring is all it takes.',
    presets: ['Float', 'Block'],
    needed: 2,
  },
  {
    id: 'topspin',
    title: 'Topspin',
    mouse: '<b>Flick up</b> through the ball, just before it reaches the ring. Watch for the ring <b>turning gold</b>: that is the perfect moment.',
    touch: '<b>Swipe up</b> through the ball, just before it reaches the ring. Watch for the ring <b>turning gold</b>: that is the perfect moment.',
    presets: ['Block', 'Float'],
    needed: 2,
    check: (r) => landed(r) && r.top > 15,
  },
  {
    id: 'backspin',
    title: 'Backspin',
    mouse: 'Backspin is coming. <b>Flick down gently</b>, like slicing under the ball: the face opens by itself.',
    touch: 'Backspin is coming. <b>Swipe down gently</b>, like slicing under the ball: the face opens by itself.',
    presets: ['Long push', 'Push'],
    needed: 2,
    check: (r) => landed(r) && r.top < -15,
  },
  {
    id: 'block',
    title: 'Block',
    mouse: 'A fast drive is coming. <b>Don\'t swing</b>: hold the bat still on the ring and let the ball bounce off.',
    touch: 'A fast drive is coming. <b>Don\'t swipe</b>: hold the bat still on the ring and let the ball bounce off.',
    presets: ['Drive'],
    needed: 2,
  },
  {
    id: 'left',
    title: 'Aim left',
    mouse: 'Angle your flick: <b>up and to the left</b> sends the ball to the left side of the table.',
    touch: 'Angle your swipe: <b>up and to the left</b> sends the ball to the left side of the table.',
    presets: ['Float', 'Block'],
    needed: 1,
    check: (r) => landed(r) && !!r.landing && r.landing.x < -0.12,
  },
  {
    id: 'right',
    title: 'Aim right',
    mouse: 'Now <b>up and to the right</b>.',
    touch: 'Now <b>up and to the right</b>.',
    presets: ['Float', 'Block'],
    needed: 1,
    check: (r) => landed(r) && !!r.landing && r.landing.x > 0.12,
  },
];

/** A coaching tip for what just went wrong. */
export function tutorialHint(r: DrillReturn, step: TutorialStep, touch: boolean): string {
  if (r.result === 'MISSED') return 'Missed it: get the bat onto the ring a little earlier. A little early beats late.';
  if (r.result === 'OUT') return touch ? 'Too long: swipe a little softer, or tap <b>Close face</b>.' : 'Too long: flick a little softer, or hold <kbd>W</kbd> to close the face.';
  if (r.result === 'OWN SIDE') return touch ? 'Into the net or your own side: tap <b>Open face</b>, and swing a bit more upward.' : 'Into the net or your own side: hold <kbd>S</kbd> to open the face, and swing a bit more upward.';
  if (step.id === 'topspin') return 'It landed, but without topspin: make the flick go <b>up</b>, not just forward.';
  if (step.id === 'backspin') return 'It landed, but without backspin: brush <b>down</b> under the ball, gently.';
  if (step.id === 'left' || step.id === 'right') return `Landed in the middle: angle the ${touch ? 'swipe' : 'flick'} more to the ${step.id}.`;
  return 'Nearly: try again.';
}

export class Tutorial {
  index = 0;
  /** Successes on the current step. */
  progress = 0;
  /** Misses in a row on the current step (hints appear after the first). */
  misses = 0;
  private fed = 0;
  /** The step just finished (for the "Nice!" moment), until the next ball. */
  justCompleted: TutorialStep | null = null;

  get step(): TutorialStep | null {
    return TUTORIAL_STEPS[this.index] ?? null;
  }

  get done() {
    return this.index >= TUTORIAL_STEPS.length;
  }

  /** Ball-machine preset for the next ball (null when the tutorial is over). */
  preset(): string | null {
    const s = this.step;
    if (!s) return null;
    this.justCompleted = null;
    return s.presets[this.fed++ % s.presets.length];
  }

  /** Report a return. Returns 'ok', 'step' (step finished), 'done' (tutorial finished) or 'miss'. */
  register(r: DrillReturn): 'ok' | 'step' | 'done' | 'miss' {
    const s = this.step;
    if (!s) return 'done';
    const ok = s.check ? s.check(r) : landed(r);
    if (!ok) {
      this.misses++;
      return 'miss';
    }
    this.misses = 0;
    this.progress++;
    if (this.progress < s.needed) return 'ok';
    this.justCompleted = s;
    this.index++;
    this.progress = 0;
    this.fed = 0;
    return this.done ? 'done' : 'step';
  }
}
