/**
 * Room server for any Node.js host (Fly.io, Render, Railway, a VPS, or your laptop).
 *
 *   npm run server            # dev, port 8787
 *   npm run build:server      # bundles to dist-server/node.mjs
 *   PORT=8080 node dist-server/node.mjs
 *
 * Rooms live at ws(s)://<host>/room/<CODE>. All game logic is in src/net/room.ts
 * (shared with the Cloudflare adapter); this file only moves messages.
 *
 * Environment:
 *   PORT              listen port (default 8787)
 *   ALLOWED_ORIGINS   optional comma-separated list of page origins allowed to connect
 *                     (e.g. https://mem-table-tennis.vercel.app). Empty = allow all.
 */
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { RoomCore } from '../src/net/room';
import { isRoomCode, parseMsg, type ClientMsg, type ServerMsg } from '../src/net/protocol';

const PORT = Number(process.env.PORT ?? 8787);
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const MAX_ROOMS = 500;
const MAX_MSGS_PER_SECOND = 300;
const TICK_HZ = 60;

const now = () => performance.now() / 1000;

interface Room {
  core: RoomCore;
  sockets: Map<string, WebSocket>;
}
const rooms = new Map<string, Room>();

function send(ws: WebSocket, msg: ServerMsg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function getOrCreateRoom(code: string, create: boolean): Room | string {
  const existing = rooms.get(code);
  if (existing) {
    if (create && existing.core.clientCount > 0) return 'That room code is already in use — try again.';
    return existing;
  }
  if (!create) return 'Room not found. Check the code, or create a new room.';
  if (rooms.size >= MAX_ROOMS) return 'The server is full right now. Try again later.';
  const sockets = new Map<string, WebSocket>();
  const core = new RoomCore(code, { now, send: (id, msg) => sockets.get(id) && send(sockets.get(id)!, msg) });
  const room = { core, sockets };
  rooms.set(code, room);
  return room;
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
  res.end(`MEM Table Tennis room server — ${rooms.size} room(s) open\n`);
});

const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const m = url.pathname.match(/^\/room\/([A-Za-z]{5})$/);
  const origin = req.headers.origin ?? '';
  if (!m || !isRoomCode(m[1].toUpperCase()) || (ALLOWED.length && !ALLOWED.includes(origin))) {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, m[1].toUpperCase()));
});

function onConnection(ws: WebSocket, code: string) {
  const id = randomUUID().slice(0, 8);
  let room: Room | null = null;
  let budget = MAX_MSGS_PER_SECOND;
  const refill = setInterval(() => (budget = MAX_MSGS_PER_SECOND), 1000);

  ws.on('message', (data) => {
    if (--budget < 0) return ws.close(1008, 'Too many messages');
    const msg = parseMsg<ClientMsg>(data.toString());
    if (!msg) return;
    if (!room) {
      if (msg.t !== 'hello') return;
      const r = getOrCreateRoom(code, !!msg.create);
      if (typeof r === 'string') {
        send(ws, { t: 'error', message: r });
        return ws.close(1000, r);
      }
      room = r;
      room.sockets.set(id, ws);
      room.core.join(id, msg);
      return;
    }
    room.core.handle(id, msg);
  });

  ws.on('close', () => {
    clearInterval(refill);
    if (!room) return;
    room.sockets.delete(id);
    room.core.leave(id);
    if (room.core.closed) rooms.delete(code);
  });
}

setInterval(() => {
  for (const [code, room] of rooms) {
    room.core.tick();
    if (room.core.closed) rooms.delete(code);
  }
}, 1000 / TICK_HZ);

server.listen(PORT, () => console.log(`MEM Table Tennis room server listening on :${PORT}`));
