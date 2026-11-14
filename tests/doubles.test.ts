import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS as P } from '../src/physics';
import { NO_INPUT } from '../src/game/swing';
import { Player } from '../src/game/player';
import { OnlineClient } from '../src/net/client';
import { LocalServer } from '../src/net/transport';
import type { ServeType } from '../src/game/serves';
import { makeBot } from './helpers/bot';
import { mulberry32 } from './helpers/rng';

const FPS = 60;

function doublesRoom(seed: number, player?: Player, bestOf = 1) {
  let t = 100;
  const server = new LocalServer(() => t, { rng: mulberry32(seed) });
  const params = { ...P };
  const me = player ?? new Player('H', params);
  const c = new OnlineClient(server.connect('R', 0), me, params, () => t, { name: 'H', create: { mode: 'doubles', bestOf, aiLevel: 'medium', realism: 0.75 } });
  const bot = makeBot(c);
  const step = (botOn = true) => {
    t += 1 / FPS;
    server.pump();
    c.frame(1 / FPS, botOn ? bot() : { ...NO_INPUT }, { x: 0, z: 0 });
  };
  return { c, server, step };
}

describe('doubles', { timeout: 120000 }, () => {
  it('plays the chosen line-up, and random seats never repeat a character', () => {
    let t = 100;
    const server = new LocalServer(() => t, { rng: mulberry32(4) });
    const params = { ...P };
    const c = new OnlineClient(server.connect('R', 0), new Player('H', params), params, () => t, {
      name: 'H',
      style: 'allround',
      create: { mode: 'doubles', bestOf: 1, aiLevel: 'medium', aiStyles: { near2: 'looper', far2: 'blocker' } },
    });
    for (let i = 0; i < 5; i++) {
      t += 1 / FPS;
      server.pump();
      c.frame(1 / FPS, { ...NO_INPUT }, { x: 0, z: 0 });
    }
    c.start(true);
    for (let i = 0; i < 5; i++) {
      t += 1 / FPS;
      server.pump();
      c.frame(1 / FPS, { ...NO_INPUT }, { x: 0, z: 0 });
    }
    const seats = c.room!.seats;
    expect(seats.near2?.style).toBe('looper');
    expect(seats.far2?.style).toBe('blocker');
    const styles = ['near1', 'near2', 'far1', 'far2'].map((s) => seats[s as 'near1']?.style);
    expect(new Set(styles).size).toBe(4); // far1 (random) is someone else
  });

  it("a human's serves go diagonally (the assist aims for your right half, then theirs)", () => {
    for (const type of ['auto', 'backspin', 'sidespin'] as ServeType[]) {
      const player = new Player('H', { ...P });
      player.applyRealism(0.75);
      player.serveType = type;
      const { c, step } = doublesRoom(1, player, 3);
      for (let i = 0; i < 5; i++) step();
      c.start(true);
      let served = 0;
      let diagonalFaults = 0;
      c.on((e) => {
        if (e.type === 'hit' && e.serve && e.by === 'near1') served++;
        if (e.type === 'point' && e.result.reason === 'serve-diagonal' && e.result.winner === 'far') diagonalFaults++;
      });
      for (let i = 0; i < FPS * 600 && served < 4; i++) step();
      expect(served, type).toBeGreaterThanOrEqual(3);
      expect(diagonalFaults, type).toBe(0);
    }
  });

  it('AI players: the receiver is ready in position, and serves are mostly legal', () => {
    const off: number[] = [];
    let points = 0;
    let faults = 0;
    for (const seed of [11, 12, 13]) {
      const { c, server, step } = doublesRoom(seed);
      for (let i = 0; i < 5; i++) step(false);
      c.sit(null);
      for (let i = 0; i < 5; i++) step(false);
      c.start(true);
      c.on((e) => {
        if (e.type === 'hit' && e.serve) {
          // Where is the receiver as the serve is struck? (Ready spot: right half, at its stance depth.)
          const room = server.room('R') as unknown as { order: string[]; serverIndex: number; ais: Record<string, { worldBody: { x: number; z: number }; style: { distance: number } }> };
          const rec = room.order[(room.serverIndex + 1) % room.order.length];
          const ai = room.ais[rec];
          const sx = rec.startsWith('near') ? 1 : -1;
          off.push(Math.hypot(ai.worldBody.x - sx * 0.3, Math.abs(ai.worldBody.z) - (1.37 + Math.max(0.45, ai.style.distance))));
        }
        if (e.type === 'point') {
          points++;
          if (e.result.reason.startsWith('serve-')) faults++;
        }
      });
      for (let i = 0; i < FPS * 600 && c.phase !== 'over'; i++) step(false);
      expect(c.phase).toBe('over');
    }
    expect(Math.max(...off)).toBeLessThan(0.1);
    expect(faults / points).toBeLessThan(0.12);
  });
});
