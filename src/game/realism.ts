import type { GradeParams } from './contact';

/**
 * The realism slider: one number from 0 (pure simulation) to 1 (full arcade) that
 * sets every assist and the game speed together. The host sets it for a room.
 */
export interface RealismSettings {
  /** Game clock speed (1 = real time). Lower = the ball travels slower. */
  gameSpeed: number;
  /** Swing timing window, seconds. */
  strokeHold: number;
  /** Angle assist strength (0–1): how large an angle error is corrected onto the table. */
  angleAssist: number;
  /** Extra hittable radius around the blade, metres. */
  hitArea: number;
  /** Footwork assist strength (0–1). */
  footwork: number;
  /** Bat magnet radius, metres (pulls the bat onto the ball's path as it arrives). */
  magnet: number;
  /** Soft cap on stroke speed (m/s of mouse movement); 0 = none (simulation). */
  powerCap: number;
  /** Extra bat speed for a perfectly timed stroke (fraction); 0 below 50% arcade. */
  perfectBonus: number;
  /** Multiplier on Magnus lift: above 1 exaggerates how spin curves the ball. */
  spinCurve: number;
  /** Least forward speed kept through a table bounce (see PhysicsParams.tableBounceKeep). */
  bounceKeep: number;
  /** Auto face angle (0–1): opens the face on downward strokes, closes it on upward ones. */
  autoFace: number;
  /** Contact grading: timing, sweet-spot and over-hit windows, and how much a poor contact costs. */
  grading: GradeParams;
}

export const REALISM_PRESETS = { Simulation: 0, Balanced: 0.55, Assisted: 0.85, Arcade: 1 } as const;
export const DEFAULT_REALISM = REALISM_PRESETS.Assisted;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function realismSettings(arcade: number): RealismSettings {
  const a = clamp01(arcade);
  const strokeHold = 0.06 + 0.14 * a;
  const magnet = 0.1 + 0.3 * a;
  const hitArea = 0.07 * a;
  return {
    gameSpeed: 1 - 0.4 * a,
    strokeHold,
    angleAssist: clamp01(a * 1.4),
    hitArea,
    footwork: clamp01(0.25 + 0.8 * a),
    magnet,
    powerCap: a < 0.2 ? 0 : 10 - 7 * a,
    perfectBonus: a >= 0.5 ? 0.1 : 0,
    // Spin is only exaggerated in the arcade half of the range.
    spinCurve: 1 + 0.8 * Math.max(0, a - 0.5),
    // Backspin can't bring the ball back over the net, except in (near-)pure simulation.
    bounceKeep: a < 0.15 ? 0 : 0.35,
    autoFace: clamp01((a - 0.2) / 0.5),
    // Grading: in (near-)pure simulation it is feedback only (the physics already punishes
    // a bad stroke); above that a poor contact costs assist, accuracy and pace. Arcade
    // widens the windows rather than switching it off.
    grading: {
      impact: a < 0.15 ? 0 : 1,
      perfectWindow: 0.05 + 0.02 * a,
      goodWindow: 0.06 + 0.06 * a,
      strokeHold,
      sweet: 0.06 + 0.1 * a + hitArea,
      edge: magnet + 0.05,
      overhitStart: 11 + 3 * a,
      overhitFull: 20 + 2 * a,
      maxFaceError: 6 - 2 * a,
      minAssist: 0.45 + 0.25 * a,
    },
  };
}

/** Describe a realism value for UI labels. */
export function realismLabel(arcade: number): string {
  const p = Math.round(clamp01(arcade) * 100);
  return p <= 10 ? `Simulation (${p}%)` : p >= 90 ? `Arcade (${p}%)` : `${p}% arcade`;
}
