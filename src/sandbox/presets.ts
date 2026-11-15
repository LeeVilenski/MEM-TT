import type { SpinComponents } from '../physics';

/**
 * Ball-machine presets approximating real opponent shots.
 * Speeds and spin rates are in the ranges measured for club-to-pro play:
 * pushes 3–6 m/s at 30–60 rps backspin, loops 15–25 m/s at 100–150 rps topspin,
 * smashes 25–35 m/s with little spin.
 */
export interface Preset {
  name: string;
  description: string;
  /** Launch speed, m/s. */
  speed: number;
  spin: SpinComponents;
  /** Contact point: metres behind the far end line (negative = over the table). */
  distanceBack: number;
  /** Contact point: metres above the table surface (negative = below). */
  height: number;
  /** Contact point: lateral offset, metres (+x is the right as seen from the near end). */
  lateral: number;
  /** Landing target on the near half, as seen from the near end: x across (+ right), z depth from net. */
  target: { x: number; z: number };
  /** Use the high arc (lobs). */
  highArc?: boolean;
  /** A serve: bounces on the machine's half first, then lands on `target`. */
  serve?: boolean;
}

const s = (top: number, side = 0, cork = 0): SpinComponents => ({ top, side, cork });

export const PRESETS: Preset[] = [
  { name: 'Push', description: 'Short, low backspin touch shot', speed: 4.5, spin: s(-45), distanceBack: -0.05, height: 0.08, lateral: 0, target: { x: 0.15, z: 0.4 } },
  { name: 'Long push', description: 'Deep, heavy backspin push', speed: 7, spin: s(-70), distanceBack: 0.05, height: 0.06, lateral: 0, target: { x: -0.3, z: 1.15 } },
  { name: 'Chop', description: 'Defensive backspin from deep', speed: 9, spin: s(-110), distanceBack: 2.0, height: 0.0, lateral: 0.2, target: { x: 0.0, z: 1.05 } },
  { name: 'Float', description: 'Looks like a chop, but no spin', speed: 9, spin: s(0), distanceBack: 2.0, height: 0.0, lateral: 0.2, target: { x: 0.0, z: 1.05 } },
  { name: 'Block', description: 'Short-swing return off the bounce', speed: 10, spin: s(20), distanceBack: 0.1, height: 0.18, lateral: -0.2, target: { x: 0.35, z: 1.0 } },
  { name: 'Drive', description: 'Flat-ish, fast counter-hit', speed: 15, spin: s(45), distanceBack: 0.6, height: 0.3, lateral: 0.1, target: { x: -0.4, z: 1.05 } },
  { name: 'Opening loop', description: 'Slow, very spinny loop against backspin', speed: 11, spin: s(140), distanceBack: 0.6, height: 0.05, lateral: 0, target: { x: 0.2, z: 1.1 } },
  { name: 'Power loop', description: 'Fast topspin from mid-distance', speed: 20, spin: s(125), distanceBack: 1.2, height: 0.35, lateral: -0.3, target: { x: -0.35, z: 1.15 } },
  { name: 'Hook loop', description: 'Topspin with sidespin that curves away', speed: 15, spin: s(90, 60), distanceBack: 1.0, height: 0.3, lateral: 0.4, target: { x: -0.45, z: 1.0 } },
  { name: 'Banana flick', description: 'Over-the-table flick with side-top', speed: 8.5, spin: s(70, 0, 45), distanceBack: -0.35, height: 0.14, lateral: 0.1, target: { x: 0.4, z: 1.0 } },
  { name: 'Smash', description: 'Kill shot off a high ball', speed: 30, spin: s(15), distanceBack: 0.4, height: 0.75, lateral: 0, target: { x: 0.45, z: 0.95 } },
  { name: 'Lob', description: 'High, deep defensive topspin', speed: 13, spin: s(100, 15), distanceBack: 3.5, height: 0.6, lateral: -0.4, target: { x: 0.1, z: 1.2 }, highArc: true },
  // Machine serves (struck just behind the far end line, low): the backspin and no-spin
  // pair are identical apart from the spin, so only the ball itself gives them away.
  { name: 'Backspin serve', description: 'Short, low, heavy backspin serve', speed: 7, spin: s(-55), distanceBack: 0.15, height: 0.2, lateral: 0.3, target: { x: -0.1, z: 0.42 }, serve: true },
  { name: 'No-spin serve', description: 'Looks like the backspin serve: no spin at all', speed: 7, spin: s(0), distanceBack: 0.15, height: 0.2, lateral: 0.3, target: { x: -0.1, z: 0.42 }, serve: true },
  { name: 'Side-back serve', description: 'Short sidespin-backspin serve that kicks sideways', speed: 7, spin: s(-25, 45), distanceBack: 0.15, height: 0.2, lateral: 0.3, target: { x: 0.2, z: 0.45 }, serve: true },
  { name: 'Fast long serve', description: 'Long, fast topspin serve to the backhand corner', speed: 8, spin: s(45), distanceBack: 0.15, height: 0.2, lateral: 0.3, target: { x: -0.5, z: 1.15 }, serve: true },
  { name: 'Corkscrew', description: 'Gyro spin that kicks sideways on the bounce', speed: 10, spin: s(20, 0, 80), distanceBack: 1.0, height: 0.25, lateral: 0, target: { x: 0.0, z: 1.0 } },
];
