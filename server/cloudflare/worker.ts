/**
 * Room server on Cloudflare: one Worker plus one Durable Object per room.
 *
 *   cd server/cloudflare
 *   npx wrangler deploy
 *
 * Rooms live at wss://<your-worker>.workers.dev/room/<CODE>. All game logic is in
 * src/net/room.ts (shared with the Node adapter); this file only moves messages.
 *
 * Optional variable ALLOWED_ORIGINS (comma-separated page origins) restricts which
 * sites may connect; empty allows all.
 */
import { RoomCore } from '../../src/net/room';
import { isRoomCode, parseMsg, type ClientMsg, type ServerMsg } from '../../src/net/protocol';

// Minimal Workers runtime types, so this file needs no extra type packages.
declare class WebSocketPair {
  0: CfWebSocket;
  1: CfWebSocket;
}
interface CfWebSocket {
  accept(): void;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  addEventListener(type: 'close' | 'error', fn: () => void): void;
}
interface DurableObjectId {}
interface DurableObjectStub {
  fetch(req: Request): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
}
interface Env {
  ROOMS: DurableObjectNamespace;
  ALLOWED_ORIGINS?: string;
}

const TICK_MS = 1000 / 60;
const MAX_MSGS_PER_SECOND = 300;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z]{5})$/);
    if (!m) return new Response('MEM Table Tennis room server\n', { headers: { 'access-control-allow-origin': '*' } });
    const code = m[1].toUpperCase();
    if (!isRoomCode(code)) return new Response('Bad room code', { status: 400 });
    if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected a WebSocket', { status: 426 });
    const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (allowed.length && !allowed.includes(req.headers.get('Origin') ?? '')) return new Response('Origin not allowed', { status: 403 });
    // One Durable Object per room code: all players in a room meet in the same object.
    return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(req);
  },
};

export class RoomDO {
  private core: RoomCore | null = null;
  private sockets = new Map<string, CfWebSocket>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;

  constructor(_state: unknown, _env: Env) {}

  async fetch(req: Request): Promise<Response> {
    const code = new URL(req.url).pathname.split('/').pop()!.toUpperCase();
    const pair = new WebSocketPair();
    const client = pair[0];
    const ws = pair[1];
    ws.accept();
    this.onSocket(ws, code);
    return new Response(null, { status: 101, webSocket: client } as ResponseInit & { webSocket: CfWebSocket });
  }

  private send(ws: CfWebSocket, msg: ServerMsg) {
    try {
      ws.send(JSON.stringify(msg));
    } catch {
      /* socket already closed */
    }
  }

  private onSocket(ws: CfWebSocket, code: string) {
    const id = `c${this.nextId++}`;
    let joined = false;
    let budget = MAX_MSGS_PER_SECOND;
    let windowStart = Date.now();

    ws.addEventListener('message', (e) => {
      if (Date.now() - windowStart > 1000) ((windowStart = Date.now()), (budget = MAX_MSGS_PER_SECOND));
      if (--budget < 0) return ws.close(1008, 'Too many messages');
      const msg = parseMsg<ClientMsg>(e.data);
      if (!msg) return;
      if (!joined) {
        if (msg.t !== 'hello') return;
        const live = this.core && this.core.clientCount > 0;
        if (!live && !msg.create) {
          this.send(ws, { t: 'error', message: 'Room not found. Check the code, or create a new room.' });
          return ws.close(1000, 'not found');
        }
        if (live && msg.create) {
          this.send(ws, { t: 'error', message: 'That room code is already in use — try again.' });
          return ws.close(1000, 'in use');
        }
        if (!live) this.core = new RoomCore(code, { now: () => performance.now() / 1000, send: (cid, m) => this.sockets.get(cid) && this.send(this.sockets.get(cid)!, m) });
        joined = true;
        this.sockets.set(id, ws);
        this.core!.join(id, msg);
        this.startTicking();
        return;
      }
      this.core?.handle(id, msg);
    });

    const onClose = () => {
      if (!this.sockets.delete(id)) return;
      this.core?.leave(id);
      if (this.sockets.size === 0) {
        this.core = null;
        if (this.timer) clearInterval(this.timer);
        this.timer = null;
      }
    };
    ws.addEventListener('close', onClose);
    ws.addEventListener('error', onClose);
  }

  private startTicking() {
    if (this.timer) return;
    this.timer = setInterval(() => this.core?.tick(), TICK_MS);
  }
}
