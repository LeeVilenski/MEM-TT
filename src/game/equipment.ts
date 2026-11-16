import { RUBBERS, type Rubber } from '../physics';
import type { GradeParams } from './contact';
import type { AiLevel } from './ai';
import { STYLES, type StyleId } from './styles';

/**
 * Bats: a blade plus a rubber on each side. The blade makes the bat faster (a livelier
 * rebound) and/or more controlled (a wider sweet spot and steadier face); the rubber sets
 * grip and spin. Equipment changes how the ball comes off the bat, never the rules.
 *
 * Better kit unlocks on the World Tour (see unlocks.ts) for whoever you play as, and
 * opponents later on the tour carry better bats too.
 */

export type BladeId = 'starter' | 'allround' | 'offensive' | 'carbon' | 'champion';

export interface Blade {
  id: BladeId;
  name: string;
  /** 0 (starter) … 4 (best). */
  tier: number;
  description: string;
  /** Multiplier on the rubber's restitution: how lively the bat is (1 = starter). */
  speed: number;
  /** 0–1: widens the sweet spot and steadies the face (fewer off-centre, wild contacts). */
  control: number;
}

export const BLADES: Record<BladeId, Blade> = {
  starter: { id: 'starter', name: 'Starter', tier: 0, description: 'A basic all-wood blade.', speed: 1, control: 0 },
  allround: { id: 'allround', name: 'Allround Wood', tier: 1, description: 'Soft and forgiving: easy to keep on the table.', speed: 1.02, control: 0.3 },
  offensive: { id: 'offensive', name: 'Offensive Seven', tier: 2, description: 'Seven plies of wood: more pace, a little control.', speed: 1.06, control: 0.15 },
  carbon: { id: 'carbon', name: 'Carbon Pro', tier: 3, description: 'Carbon layers: fast, with a big sweet spot.', speed: 1.09, control: 0.3 },
  champion: { id: 'champion', name: 'Champion Carbon', tier: 4, description: 'The best there is: fast and controlled.', speed: 1.12, control: 0.45 },
};

export const BLADE_IDS = Object.keys(BLADES) as BladeId[];

/** Inverted rubbers from worst to best (the pips and anti rubbers are their own thing). */
export const INVERTED_TIERS = ['inverted', 'classicPro', 'turbo', 'gripMax'] as const;

/** Rubber ids you can put on a bat. */
export const BAT_RUBBER_IDS = [...INVERTED_TIERS, 'shortPips', 'longPips', 'anti'] as const;

export interface Bat {
  blade: BladeId;
  forehand: string;
  backhand: string;
}

/** A character's own bat before any upgrades: their usual rubbers on a starter blade. */
export function defaultBat(style: StyleId): Bat {
  const st = STYLES[style];
  return { blade: 'starter', forehand: st.rubbers.forehand.id, backhand: st.rubbers.backhand.id };
}

/** A rubber as it plays on a blade: the blade's speed scales the rebound. */
export function onBlade(rubber: Rubber, blade: Blade): Rubber {
  if (blade.speed === 1) return rubber;
  return { ...rubber, restitution: Math.min(0.96, rubber.restitution * blade.speed) };
}

/** The bat's two faces, ready for the physics. Unknown ids fall back to the starter kit. */
export function batRubbers(bat: Bat): { forehand: Rubber; backhand: Rubber } {
  const blade = BLADES[bat.blade] ?? BLADES.starter;
  const r = (id: string) => onBlade(RUBBERS[id] ?? RUBBERS.inverted, blade);
  return { forehand: r(bat.forehand), backhand: r(bat.backhand) };
}

/** Contact grading with the blade's control: a wider sweet spot and steadier face. */
export function withControl(g: GradeParams, blade: Blade): GradeParams {
  if (!blade.control) return g;
  const c = blade.control;
  return { ...g, sweet: g.sweet * (1 + 0.5 * c), edge: g.edge * (1 + 0.2 * c), maxFaceError: g.maxFaceError * (1 - 0.4 * c) };
}

/**
 * An opponent's bat at a gear tier (0–4): that tier's blade, and their usual rubbers with any
 * inverted rubber upgraded to match (pips and anti stay what they are: that's their style).
 */
export function opponentBat(style: StyleId, tier: number): Bat {
  const t = Math.max(0, Math.min(4, Math.round(tier)));
  const blade = BLADE_IDS.find((id) => BLADES[id].tier === t)!;
  const inv = INVERTED_TIERS[Math.min(INVERTED_TIERS.length - 1, Math.max(0, t - 1))];
  const up = (id: string) => (RUBBERS[id]?.kind === 'Inverted' ? inv : id);
  const d = defaultBat(style);
  return { blade, forehand: up(d.forehand), backhand: up(d.backhand) };
}

/** Gear tier for a free-play AI opponent by level. */
export const LEVEL_GEAR: Record<AiLevel, number> = { easy: 0, medium: 1, hard: 2, expert: 3 };

/** Gear tier for opponents at each World Tour stop (by stop order). */
export const TOUR_GEAR = [0, 1, 1, 2, 3, 3, 4];

/** "Carbon Pro · Turbo Spin / Turbo Spin" */
export function batLabel(bat: Bat): string {
  const n = (id: string) => RUBBERS[id]?.name ?? id;
  return `${BLADES[bat.blade]?.name ?? bat.blade} · ${bat.forehand === bat.backhand ? n(bat.forehand) : `${n(bat.forehand)} / ${n(bat.backhand)}`}`;
}
