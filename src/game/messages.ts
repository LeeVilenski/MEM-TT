import type { PointReason, PointResult } from './rules';

/**
 * Call-outs for match events. Title is the big flash; the subtitle explains the
 * table tennis rule in plain words.
 */
const REASONS: Record<PointReason, { title: string; sub: string }> = {
  net: { title: 'NET', sub: 'into the net' },
  out: { title: 'OUT', sub: 'missed the table' },
  'own-side': { title: 'OWN SIDE', sub: 'bounced on their own half' },
  'double-bounce': { title: 'NOT RETURNED', sub: 'bounced twice' },
  missed: { title: 'MISSED', sub: 'missed the ball' },
  'illegal-serve': { title: 'FAULT', sub: 'illegal serve' },
  'serve-missed': { title: 'MISSED TOSS', sub: 'missed the toss' },
  'serve-wrong-bounce': { title: 'BAD SERVE', sub: 'the serve must bounce once on each half' },
  'serve-net': { title: 'NET', sub: 'serve into the net' },
  'double-hit': { title: 'DOUBLE HIT', sub: 'hit the ball twice' },
  obstruction: { title: 'OBSTRUCTION', sub: 'volleyed a ball that would have landed (obstruction)' },
  'volley-out': { title: 'VOLLEY', sub: 'volleyed a ball that was going out' },
  'wrong-order': { title: 'OUT OF TURN', sub: 'hit out of turn — doubles partners must alternate' },
  'serve-diagonal': { title: 'NOT DIAGONAL', sub: 'doubles serves go diagonally, right half-court to right half-court' },
};

export function pointMessage(r: PointResult, names: Record<'near' | 'far', string>): { title: string; sub: string } {
  if (r.ace) return { title: 'ACE!', sub: `Ace — point to ${names[r.winner]}` };
  const m = REASONS[r.reason];
  const detail = r.detail ? ` (${r.detail})` : '';
  return { title: m.title, sub: `${names[r.loser]}: ${m.sub}${detail} — point to ${names[r.winner]}` };
}

export const LET_MESSAGE = { title: 'LET', sub: 'Let — the serve clipped the net. Serve again.' };
export const DEUCE = 'DEUCE';
