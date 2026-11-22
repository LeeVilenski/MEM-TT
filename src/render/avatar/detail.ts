/**
 * How detailed characters are built: 2 (High quality: the full meshes, sheen on skin and
 * cloth, a woven texture on clothes), 1 (Medium: fewer points, no weave), 0 (Low: fewer
 * still, plain materials). Read while a character is being built.
 */
export type Detail = 0 | 1 | 2;

let current: Detail = 2;

/** Build something at a level of detail. */
export function withDetail<T>(d: Detail, build: () => T): T {
  const was = current;
  current = d;
  try {
    return build();
  } finally {
    current = was;
  }
}

/** The level of detail being built at. */
export const detail = () => current;

/** Pick by detail: [low, medium, high]. */
export const byDetail = <T,>(low: T, medium: T, high: T): T => (current === 0 ? low : current === 1 ? medium : high);
