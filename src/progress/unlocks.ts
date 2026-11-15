import type { ProfileData } from './profile';

/**
 * What unlocks what. Venues, player styles and rubbers unlock with your career
 * level, drills and tournaments; "Unlock everything" in the Career screen skips it.
 */
export type UnlockKind = 'venue' | 'style' | 'rubber';

export interface UnlockRule {
  kind: UnlockKind;
  id: string;
  /** Human description of the requirement. */
  requirement: string;
  test: (p: ProfileData, levelIndex: number) => boolean;
}

const level = (n: number, title: string) => ({ requirement: `Reach ${title}`, test: (_: ProfileData, lvl: number) => lvl >= n });
const drill = (id: string, name: string) => ({ requirement: `Earn a star in "${name}"`, test: (p: ProfileData) => (p.drills[id] ?? 0) >= 1 });
const cup = (id: string, name: string) => ({ requirement: `Win the ${name}`, test: (p: ProfileData) => (p.tournaments[id] ?? 0) > 0 });
/** A World Tour stop won (stops record their wins alongside tournaments). */
const stop = (id: string, name: string) => ({ requirement: `World Tour: win the ${name}`, test: (p: ProfileData) => (p.tournaments[id] ?? 0) > 0 });

export const UNLOCKS: UnlockRule[] = [
  // Venues (the sandbox and the office are always available).
  { kind: 'venue', id: 'server', ...level(1, 'Junior') },
  { kind: 'venue', id: 'conference', ...level(2, 'Mid-level') },
  { kind: 'venue', id: 'rooftop', ...cup('department-cup', 'Department Cup') },
  { kind: 'venue', id: 'park', ...stop('datacentre-knockout', 'Data Centre Knockout') },
  { kind: 'venue', id: 'beach', ...stop('board-showdown', 'Boardroom Showdown') },
  // Player styles: Lee, Ryan, Ed, Will and Dan from the start; the Sysadmin is earned.
  { kind: 'style', id: 'chopper', ...drill('defence', 'On-call defence') },
  // Rubbers (Standard Build from the start).
  { kind: 'rubber', id: 'shortPips', ...level(1, 'Junior') },
  { kind: 'rubber', id: 'longPips', ...drill('defence', 'On-call defence') },
  { kind: 'rubber', id: 'anti', ...cup('championship', 'Company Championship') },
];

export function isUnlocked(kind: UnlockKind, id: string, p: ProfileData, levelIndex: number): boolean {
  if (p.unlockAll) return true;
  const rule = UNLOCKS.find((u) => u.kind === kind && u.id === id);
  return !rule || rule.test(p, levelIndex);
}

/** Rules that are now satisfied but weren't before (for "Unlocked!" toasts). */
export function newlyUnlocked(before: Set<string>, p: ProfileData, levelIndex: number): UnlockRule[] {
  return UNLOCKS.filter((u) => !before.has(`${u.kind}:${u.id}`) && u.test(p, levelIndex));
}

export function unlockedKeys(p: ProfileData, levelIndex: number): Set<string> {
  return new Set(UNLOCKS.filter((u) => u.test(p, levelIndex)).map((u) => `${u.kind}:${u.id}`));
}
