/**
 * Contact grading: how cleanly a stroke met the ball. Pure logic (no DOM), shared by
 * local play and online clients; the windows come from the realism slider, so everyone
 * in an online room plays with the host's setting.
 *
 * Three signals:
 *  - timing: how long before contact the flick peaked (faded = EARLY);
 *  - sweet spot: how close the swipe's path came to the ball, before the bat magnet
 *    pulled it on (far off = EDGE);
 *  - over-hitting: a swipe much harder than the power cap rewards (OVERHIT).
 *
 * The quality q (0–1) then decides how much the contact assist helps, how much
 * execution error the face gets, and how much pace and spin the stroke keeps.
 */

export type ContactGrade = 'PERFECT' | 'GOOD' | 'EARLY' | 'EDGE' | 'OVERHIT';

export interface GradeParams {
  /** 0 = grading has no effect on the shot (feedback only), 1 = full effect. */
  impact: number;
  /** Flick peak within this of contact (s) is perfectly timed. */
  perfectWindow: number;
  /** …within this is well timed; later than this (up to the stroke memory) is early. */
  goodWindow: number;
  /** Stroke memory (s): a flick older than this is no stroke at all (a block). */
  strokeHold: number;
  /** The swipe passing within this of the ball (m) is a clean, centred contact… */
  sweet: number;
  /** …and this far off (m) is the very edge (the magnet's reach). */
  edge: number;
  /** Swipe speed (m/s, mouse plane) above which a stroke is over-hit, and the speed of a full over-hit. */
  overhitStart: number;
  overhitFull: number;
  /** Face error (degrees, standard deviation) at q = 0, at full impact. */
  maxFaceError: number;
  /** Fraction of the angle assist kept at q = 0, at full impact. */
  minAssist: number;
}

/** Grading off: every contact is clean and nothing changes. */
export const NO_GRADING: GradeParams = {
  impact: 0,
  perfectWindow: 0.05,
  goodWindow: 0.12,
  strokeHold: 0.12,
  // Finite "never" values: Infinity − Infinity would make the ramps NaN.
  sweet: 1e6,
  edge: 2e6,
  overhitStart: 1e6,
  overhitFull: 2e6,
  maxFaceError: 0,
  minAssist: 1,
};

export interface ContactSample {
  /** Seconds since the flick last moved (Infinity: no flick, a block). */
  peakAge: number;
  /** Closest the swipe's path came to the ball, metres (before the magnet). */
  miss: number;
  /** Peak swipe speed, m/s in the mouse plane (lateral movement already discounted). */
  speed: number;
}

export interface ContactResult {
  grade: ContactGrade;
  /** Overall quality, 0–1. */
  q: number;
  /** The separate parts (each 0–1). */
  timing: number;
  centre: number;
  control: number;
  /** Multiplier on the angle assist's strength. */
  assistScale: number;
  /** Face-angle error to add after the assist (degrees, standard deviation). */
  faceError: number;
  /** Multiplier on the bat speed. */
  paceScale: number;
}

/** Quality at or above which a contact is clean (no penalty). */
const CLEAN = 0.9;
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (t: number) => {
  const c = Number.isFinite(t) ? clamp01(t) : t > 0 ? 1 : 0;
  return c * c * (3 - 2 * c);
};

export function gradeContact(s: ContactSample, p: GradeParams): ContactResult {
  const block = !Number.isFinite(s.peakAge);
  // Timing. A block (no flick) has no timing to judge.
  const timing = block || s.peakAge <= p.goodWindow ? 1 : 1 - 0.7 * smooth((s.peakAge - p.goodWindow) / Math.max(1e-3, p.strokeHold - p.goodWindow));
  // Sweet spot: how close the swipe's path came to the ball.
  const centre = 1 - 0.75 * smooth((s.miss - p.sweet) / Math.max(1e-3, p.edge - p.sweet));
  // Control: swiping much harder than pays.
  const control = block ? 1 : 1 - 0.32 * smooth((s.speed - p.overhitStart) / Math.max(1e-3, p.overhitFull - p.overhitStart));

  const q = timing * centre * control;
  const worst = Math.min(timing, centre, control);
  let grade: ContactGrade;
  if (worst >= CLEAN) grade = !block && s.peakAge <= p.perfectWindow && centre >= 0.98 ? 'PERFECT' : 'GOOD';
  else if (worst === control) grade = 'OVERHIT';
  else if (worst === centre) grade = 'EDGE';
  else grade = 'EARLY';

  const k = p.impact;
  // A clean contact (GOOD or PERFECT) costs nothing: the penalties start below that, so
  // a near-perfect stroke isn't nudged off the edge of what the assist can rescue.
  const bad = clamp01((CLEAN - q) / CLEAN);
  return {
    grade,
    q,
    timing,
    centre,
    control,
    assistScale: 1 - k * bad * (1 - p.minAssist),
    faceError: k * p.maxFaceError * bad,
    // Mistimed and off-centre hits lose pace; an over-hit keeps it (that's the gamble).
    paceScale: bad > 0 ? 1 - k * (0.25 * (1 - timing) + 0.3 * (1 - centre)) : 1,
  };
}

/** Short call-out text for each grade (HUD). */
export const GRADE_TEXT: Record<ContactGrade, { title: string; tone: 'gold' | 'good' | 'bad' }> = {
  PERFECT: { title: 'PERFECT', tone: 'gold' },
  GOOD: { title: 'GOOD', tone: 'good' },
  EARLY: { title: 'EARLY', tone: 'bad' },
  EDGE: { title: 'EDGE', tone: 'bad' },
  OVERHIT: { title: 'OVERHIT', tone: 'bad' },
};
