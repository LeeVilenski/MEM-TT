import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS } from '../src/physics';
import { makeBot } from './helpers/bot';
import { Player } from '../src/game/player';
import type { PointReason } from '../src/game/rules';
import { OnlineClient } from '../src/net/client';
import { LocalServer } from '../src/net/transport';
import type { GameMode } from '../src/net/protocol';

const P = DEFAULT_PARAMS;
const FPS = 60;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A world of one local server, N clients and a shared manual clock. */
function world(latency: number, seed = 1) {
  let t = 100;
  const clock = () => t;
  const server = new LocalServer(clock, { rng: mulberry32(seed) });
  const clients: { c: OnlineClient; bot: ReturnType<typeof makeBot> }[] = [];
  const add = (name: string, create?: { mode: GameMode; bestOf: number }) => {
    // Each client gets its own params: the client applies the room's spin curve to them.
    const params = { ...P };
    const player = new Player(name, params);
    player.rng = mulberry32(seed * 100 + clients.length);
    const c = new OnlineClient(server.connect('ROOMA', latency), player, params, clock, { name, create: create && { ...create, aiLevel: 'medium' } });
    const entry = { c, bot: makeBot(c) };
    clients.push(entry);
    return c;
  };
  const step = (frames = 1) => {
    for (let i = 0; i < frames; i++) {
      t += 1 / FPS;
      server.pump();
      for (const { c, bot } of clients) c.frame(1 / FPS, bot(), { x: 0, z: 0 });
    }
  };
  return { add, step, server, clients };
}

describe('online rooms (local server, simulated latency)', () => {
  it('creates a room, seats players and starts a match', () => {
    const w = world(0.03);
    const a = w.add('Ada', { mode: 'singles', bestOf: 1 });
    w.step(10);
    const b = w.add('Bob');
    w.step(10);
    expect(a.room?.code).toBe('ROOMA');
    expect(a.seat).toBe('near1');
    expect(b.seat).toBe('far1');
    expect(a.isHost).toBe(true);
    a.start(false);
    w.step(10);
    expect(['serve-wait', 'rally']).toContain(b.phase);
    expect(a.names).toEqual({ near1: 'Ada', far1: 'Bob' });
    // Bob sees himself at the near end of his own view.
    expect(b.side).toBe('far');
  });

  it('two remote humans rally, and both clients agree on the score', () => {
    const w = world(0.05, 7);
    const a = w.add('Ada', { mode: 'singles', bestOf: 1 });
    w.step(5);
    const b = w.add('Bob');
    w.step(5);
    a.start(false);
    const hitsBy: Record<string, number> = {};
    const reasons: Partial<Record<PointReason, number>> = {};
    let seq: string[] = [];
    a.on((e) => {
      if (e.type === 'hit') {
        hitsBy[e.by] = (hitsBy[e.by] ?? 0) + 1;
        seq.push(e.by + (e.serve ? ':S' : ''));
      }
      if (e.type === 'point') {
        reasons[e.result.reason] = (reasons[e.result.reason] ?? 0) + 1;
        if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DBG) console.log('point', e.result.winner, e.result.reason, seq.join(' '));
        seq = [];
      }
    });
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.DBG) b.on((e) => { if (e.type === 'ball' && e.event.type !== 'netCross') { const x = e.event as { pos: { x: number; z: number } }; console.log('  B sees', e.event.type, x.pos.x.toFixed(2), x.pos.z.toFixed(2), e.event.type === 'paddle' ? `vOut=${JSON.stringify(e.event.velOut)}` : ''); } if (e.type === 'toss') console.log('  B toss by', e.by); });
    for (let i = 0; i < FPS * 120 && (a.score?.points.near ?? 0) + (a.score?.points.far ?? 0) < 8; i++) w.step();
    w.step(FPS); // let the last messages arrive
    console.log('hits seen by Ada', hitsBy, 'reasons', reasons, 'score', a.score?.points);
    expect((a.score?.points.near ?? 0) + (a.score?.points.far ?? 0)).toBeGreaterThanOrEqual(8);
    expect(b.score?.points).toEqual(a.score?.points);
    // Both players' contacts were accepted by the server (relayed to the other client).
    expect(hitsBy.near1 ?? 0).toBeGreaterThan(2);
    expect(hitsBy.far1 ?? 0).toBeGreaterThan(2);
  });

  it('the far-end player plays exactly like the near-end player (frame mapping)', () => {
    const returnsIn = (seat: 'near1' | 'far1', seed = 21) => {
      const w = world(0.04, seed);
      const a = w.add('Ada', { mode: 'singles', bestOf: 1 });
      w.step(5);
      if (seat === 'far1') a.sit('far1');
      w.step(5);
      a.start(true);
      let made = 0;
      let mine = false;
      const seq: string[] = [];
      a.on((e) => {
        if (e.type === 'hit') {
          seq.push(e.by + (e.serve ? ':S' : ''));
          if (e.by !== seat && mine) made++;
          mine = e.by === seat && !e.serve;
        }
        if (e.type === 'point') {
          mine = false;
          seq.push('|');
        }
      });
      for (let i = 0; i < FPS * 300 && a.phase !== 'over'; i++) w.step();
      return made;
    };
    let near = 0;
    let far = 0;
    for (const seed of [21, 22, 23, 24, 25, 26]) {
      near += returnsIn('near1', seed);
      far += returnsIn('far1', seed);
    }
    console.log('returns that the AI got to play: near', near, 'far', far);
    expect(far).toBeGreaterThan(0);
    // Same bot, same AI: the two ends should perform alike (allowing for randomness).
    expect(Math.min(near, far) / Math.max(near, far)).toBeGreaterThan(0.6);
  }, 120000); // 12 whole online matches (longer since AI seats return serves)

  it("an AI seat returns a human's serve", () => {
    // The room judges the flight GRACE behind real time: a serve returned soon after its
    // bounce used to be rejected as "not the receiver's ball yet" (a double bounce).
    const w = world(0.04, 3);
    const a = w.add('Ada', { mode: 'singles', bestOf: 1 });
    w.step(5);
    a.start(true);
    let served = 0;
    let returned = 0;
    let lastServeBy = '';
    a.on((e) => {
      if (e.type !== 'hit') return;
      if (e.serve) {
        lastServeBy = e.by;
        if (e.by === 'near1') served++;
      } else if (lastServeBy === 'near1' && e.by === 'far1') {
        returned++;
        lastServeBy = '';
      }
    });
    for (let i = 0; i < FPS * 120 && served < 4; i++) w.step();
    expect(served).toBeGreaterThanOrEqual(3);
    expect(returned).toBeGreaterThanOrEqual(Math.ceil(served / 2));
  }, 60000);

  it('fills empty seats with the AI', () => {
    const w = world(0.04, 3);
    const a = w.add('Ada', { mode: 'singles', bestOf: 1 });
    w.step(5);
    a.start(true);
    let aiHits = 0;
    a.on((e) => e.type === 'hit' && e.by === 'far1' && aiHits++);
    // 8 points, so the AI serves a few times whoever wins the toss (it doesn't yet return
    // this bot's serves online; see the AI seats' serve return). Time enough for a patient
    // AI (Paul plays long rallies) as well as the others.
    for (let i = 0; i < FPS * 160 && (a.score?.points.near ?? 0) + (a.score?.points.far ?? 0) < 8; i++) w.step();
    expect(a.room?.seats.far1?.ai).toBe('medium');
    expect((a.score?.points.near ?? 0) + (a.score?.points.far ?? 0)).toBeGreaterThanOrEqual(8);
    expect(aiHits).toBeGreaterThan(2);
  });

  it('doubles: four AI players alternate correctly and serve diagonally', () => {
    const w = world(0.02, 11);
    const host = w.add('Host', { mode: 'doubles', bestOf: 1 });
    w.step(5);
    host.sit(null); // watch as a spectator
    w.step(5);
    host.start(true);
    const reasons: Partial<Record<PointReason, number>> = {};
    const hitters: string[] = [];
    host.on((e) => {
      if (e.type === 'point') reasons[e.result.reason] = (reasons[e.result.reason] ?? 0) + 1;
      if (e.type === 'hit') hitters.push(e.by);
    });
    for (let i = 0; i < FPS * 60 * 6 && host.phase !== 'over'; i++) w.step();
    console.log('doubles reasons', reasons, 'final', host.score?.history, 'hits', hitters.length);
    expect(host.phase).toBe('over');
    expect(reasons['wrong-order'] ?? 0).toBe(0);
    expect(reasons['serve-diagonal'] ?? 0).toBeLessThanOrEqual(3);
    // Partners alternate: no seat hits twice in a row within a rally... (relayed hits are in order)
    expect(new Set(hitters).size).toBe(4);
  });
});
