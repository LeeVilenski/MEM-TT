import type { PointReason, PointResult } from './rules';

/**
 * IT-themed call-outs for match events. Title is the big flash; the subtitle
 * explains the actual table tennis rule in plain words.
 */
const REASONS: Record<PointReason, { title: string; sub: string }> = {
  net: { title: 'PACKET LOSS', sub: 'into the net' },
  out: { title: '404', sub: 'ball not found on the table' },
  'own-side': { title: 'SEGFAULT', sub: 'bounced on their own half' },
  'double-bounce': { title: 'TIMEOUT', sub: 'not returned' },
  missed: { title: 'TIMEOUT', sub: 'missed the ball' },
  'illegal-serve': { title: 'SYNTAX ERROR', sub: 'illegal serve' },
  'serve-missed': { title: 'NULL POINTER', sub: 'missed the toss' },
  'serve-wrong-bounce': { title: 'BAD HANDSHAKE', sub: 'the serve must bounce once on each half' },
  'serve-net': { title: 'PACKET LOSS', sub: 'serve into the net' },
  'double-hit': { title: 'DUPLICATE REQUEST', sub: 'hit the ball twice' },
  obstruction: { title: 'ACCESS DENIED', sub: 'volleyed a ball that would have landed (obstruction)' },
  'volley-out': { title: 'EARLY RETURN', sub: 'volleyed a ball that was going out' },
};

export function pointMessage(r: PointResult, names: Record<'near' | 'far', string>): { title: string; sub: string } {
  if (r.ace) return { title: 'ZERO-DAY', sub: `Ace — point to ${names[r.winner]}` };
  const m = REASONS[r.reason];
  const detail = r.detail ? ` (${r.detail})` : '';
  return { title: m.title, sub: `${names[r.loser]}: ${m.sub}${detail} — point to ${names[r.winner]}` };
}

export const LET_MESSAGE = { title: 'RETRY', sub: 'Let — the serve clipped the net. Serve again.' };
export const DEUCE = 'RACE CONDITION';
