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
  /** Multiplier on Magnus lift: above 1 exaggerates how spin curves the ball. */
  spinCurve: number;
  /** Auto face angle (0–1): opens the face on downward strokes, closes it on upward ones. */
  autoFace: number;
}

export const REALISM_PRESETS = { Simulation: 0, Balanced: 0.55, Assisted: 0.75, Arcade: 1 } as const;
export const DEFAULT_REALISM = REALISM_PRESETS.Assisted;

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

export function realismSettings(arcade: number): RealismSettings {
  const a = clamp01(arcade);
  return {
    gameSpeed: 1 - 0.4 * a,
    strokeHold: 0.06 + 0.14 * a,
    angleAssist: clamp01(a * 1.4),
    hitArea: 0.07 * a,
    footwork: clamp01(0.25 + 0.8 * a),
    // Spin is only exaggerated in the arcade half of the range.
    spinCurve: 1 + 0.8 * Math.max(0, a - 0.5),
    autoFace: clamp01((a - 0.2) / 0.5),
  };
}

/** Describe a realism value for UI labels. */
export function realismLabel(arcade: number): string {
  const p = Math.round(clamp01(arcade) * 100);
  return p <= 10 ? `Simulation (${p}%)` : p >= 90 ? `Arcade (${p}%)` : `${p}% arcade`;
}
