import { RoomCore } from './room';
import { parseMsg, type ClientMsg, type ServerMsg } from './protocol';

/** A connection to a room server, however it is hosted. */
export interface Transport {
  send(msg: ClientMsg): void;
  close(): void;
  onOpen: () => void;
  onMessage: (msg: ServerMsg) => void;
  onClose: (reason: string) => void;
}

/**
 * Normalise a room-server base URL and build the URL for a room.
 * Both the Node and Cloudflare adapters serve rooms at `<base>/room/<CODE>`.
 * http(s):// is converted to ws(s)://.
 */
export function roomUrl(base: string, code: string): string {
  let b = base.trim().replace(/\/+$/, '');
  if (b.startsWith('http://')) b = 'ws://' + b.slice(7);
  else if (b.startsWith('https://')) b = 'wss://' + b.slice(8);
  else if (!/^wss?:\/\//.test(b)) b = 'wss://' + b;
  return `${b}/room/${encodeURIComponent(code)}`;
}

export class WebSocketTransport implements Transport {
  private ws: WebSocket;
  onOpen = () => {};
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.onOpen();
    this.ws.onmessage = (ev) => {
      const m = parseMsg<ServerMsg>(ev.data);
      if (m) this.onMessage(m);
    };
    this.ws.onclose = (ev) => this.onClose(ev.reason || (ev.code === 1006 ? 'Could not reach the room server' : 'Disconnected'));
    this.ws.onerror = () => {};
  }

  send(msg: ClientMsg) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  close() {
    this.ws.close();
  }
}

/**
 * An in-process room server. Used for automated tests (with a manual clock and
 * simulated latency) and for the "local" server option in the browser, where a
 * human plays AI opponents through the full online code path without any hosting.
 */
export class LocalServer {
  private rooms = new Map<string, RoomCore>();
  private queue: { at: number; deliver: () => void }[] = [];
  private nextId = 1;

  constructor(
    readonly now: () => number,
    private opts: { latency?: number; rng?: () => number } = {},
  ) {}

  room(code: string) {
    return this.rooms.get(code);
  }

  /** Connect a client to a room (created on first connect). Latency is one-way, seconds. */
  connect(code: string, latency = this.opts.latency ?? 0): Transport {
    const id = `c${this.nextId++}`;
    let room = this.rooms.get(code);
    if (!room) {
      const clients = new Map<string, LocalTransport>();
      room = new RoomCore(code, { now: this.now, send: (cid, msg) => clients.get(cid)?.deliver(msg) }, { rng: this.opts.rng });
      (room as unknown as { _clients: Map<string, LocalTransport> })._clients = clients;
      this.rooms.set(code, room);
    }
    const clients = (room as unknown as { _clients: Map<string, LocalTransport> })._clients;
    const t = new LocalTransport(this, room, id, latency);
    clients.set(id, t);
    this.schedule(latency, () => t.onOpen());
    return t;
  }

  schedule(delay: number, fn: () => void) {
    this.queue.push({ at: this.now() + delay, deliver: fn });
  }

  /** Deliver due messages and tick rooms. Call regularly. */
  pump() {
    const now = this.now();
    // Deliver in order of due time.
    this.queue.sort((a, b) => a.at - b.at);
    while (this.queue.length && this.queue[0].at <= now) this.queue.shift()!.deliver();
    for (const [code, room] of this.rooms) {
      room.tick();
      if (room.closed) this.rooms.delete(code);
    }
  }
}

class LocalTransport implements Transport {
  onOpen = () => {};
  onMessage: (msg: ServerMsg) => void = () => {};
  onClose: (reason: string) => void = () => {};
  private open = true;

  constructor(
    private server: LocalServer,
    private room: RoomCore,
    private id: string,
    private latency: number,
  ) {}

  /** Server → client, after the one-way latency. Messages are cloned like a real network would. */
  deliver(msg: ServerMsg) {
    const copy = JSON.parse(JSON.stringify(msg)) as ServerMsg;
    this.server.schedule(this.latency, () => this.open && this.onMessage(copy));
  }

  send(msg: ClientMsg) {
    if (!this.open) return;
    const copy = JSON.parse(JSON.stringify(msg)) as ClientMsg;
    this.server.schedule(this.latency, () => {
      if (copy.t === 'hello') this.room.join(this.id, copy);
      else this.room.handle(this.id, copy);
    });
  }

  close() {
    if (!this.open) return;
    this.open = false;
    this.server.schedule(this.latency, () => this.room.leave(this.id));
  }
}
