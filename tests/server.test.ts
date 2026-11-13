import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { DEFAULT_PARAMS as P } from '../src/physics';
import { Player } from '../src/game/player';
import { OnlineClient } from '../src/net/client';
import { WebSocketTransport, roomUrl } from '../src/net/transport';
import { randomRoomCode } from '../src/net/protocol';
import { makeBot } from './helpers/bot';

/**
 * End-to-end over real WebSockets. By default starts the Node adapter (server/node.ts).
 * Set ROOM_SERVER_URL to test another deployment instead, e.g. the Cloudflare adapter
 * running under `wrangler dev`: ROOM_SERVER_URL=ws://127.0.0.1:8798 npx vitest run tests/server.test.ts
 */
const EXTERNAL = process.env.ROOM_SERVER_URL;
const PORT = 8000 + Math.floor(Math.random() * 900);
let proc: ChildProcess | undefined;

beforeAll(async () => {
  if (EXTERNAL) return;
  proc = spawn('npx', ['tsx', 'server/node.ts'], { env: { ...process.env, PORT: String(PORT) }, stdio: 'pipe' });
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 15000);
    proc!.stdout!.on('data', (d) => String(d).includes('listening') && (clearTimeout(t), resolve()));
  });
}, 20000);

afterAll(() => {
  proc?.kill();
});

const clock = () => performance.now() / 1000;
const base = EXTERNAL ?? `ws://localhost:${PORT}`;

function client(code: string, name: string, create?: boolean) {
  const t = new WebSocketTransport(roomUrl(base, code));
  const params = { ...P }; // the client applies the room's spin curve to its params
  return new OnlineClient(t, new Player(name, params), params, clock, { name, create: create ? { mode: 'singles', bestOf: 1, aiLevel: 'medium' } : undefined });
}

async function run(clients: OnlineClient[], until: () => boolean, timeoutMs: number) {
  const bots = clients.map((c) => makeBot(c));
  let last = clock();
  await new Promise<void>((resolve) => {
    const iv = setInterval(() => {
      const n = clock();
      const dt = n - last;
      last = n;
      clients.forEach((c, i) => c.frame(dt, bots[i](), { x: 0, z: 0 }));
      if (until()) {
        clearInterval(iv);
        resolve();
      }
    }, 1000 / 60);
    setTimeout(() => {
      clearInterval(iv);
      resolve();
    }, timeoutMs);
  });
}

describe(`room server over real WebSockets (${EXTERNAL ?? 'Node adapter'})`, () => {
  it('rejects joining a room that does not exist', async () => {
    const c = client('ZZZZZ', 'Lost');
    const errors: string[] = [];
    c.on((e) => e.type === 'error' && errors.push(e.message));
    await run([c], () => errors.length > 0, 3000);
    expect(errors[0]).toMatch(/not found/i);
  });

  it('two players play points through the server and see the same score', async () => {
    const code = randomRoomCode();
    const a = client(code, 'Ada', true);
    await run([a], () => a.phase === 'lobby', 3000);
    const b = client(code, 'Bob');
    await run([a, b], () => b.phase === 'lobby' && !!a.room?.seats.far1, 3000);
    expect(b.seat).toBe('far1');
    a.start(false);
    const hits = { near1: 0, far1: 0 };
    a.on((e) => e.type === 'hit' && hits[e.by as 'near1' | 'far1']++);
    const total = () => (a.score?.points.near ?? 0) + (a.score?.points.far ?? 0);
    await run([a, b], () => total() >= 4, 40000);
    await run([a, b], () => false, 500);
    console.log('score', a.score?.points, 'hits', hits, 'rtt', a.rtt.toFixed(4));
    expect(total()).toBeGreaterThanOrEqual(4);
    expect(b.score?.points).toEqual(a.score?.points);
    expect(hits.near1 + hits.far1).toBeGreaterThan(3);
    a.leave();
    b.leave();
  }, 60000);
});
