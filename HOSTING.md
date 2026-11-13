# Hosting MEM Table Tennis

The game has two parts:

| Part | What it is | Where it runs |
|---|---|---|
| **Web client** | Static files (`npm run build` → `dist/`) | Vercel (already set up), Cloudflare Pages, GitHub Pages… |
| **Room server** | Small WebSocket server that hosts private rooms | **Cloudflare** (Worker + Durable Objects) **or any Node.js host** |

Both room-server options run the **same room logic** (`src/net/room.ts`), so you can switch at any time.

**Picking a server.** The web client connects to the server set by `VITE_ROOM_SERVER` at build time. Players can also override it in the game, under **Online multiplayer → Room server**; the choice is remembered in the browser.

**With no server configured**, the client uses `local`: an in-browser room server. That runs the full online code path against the AI, but it can't connect you to friends.

---

## Option A — Cloudflare (recommended)

Each room is its own Durable Object, placed close to the players. The Workers free plan covers casual use.

1. Create a free Cloudflare account and log in from the repository:
   ```bash
   cd server/cloudflare
   npx wrangler login
   ```
2. Deploy:
   ```bash
   npx wrangler deploy
   ```
   Wrangler prints the URL, e.g. `https://mem-table-tennis-rooms.<your-subdomain>.workers.dev`.
3. Check it: opening that URL in a browser shows `MEM Table Tennis room server`.
4. Point the web client at it. See "Connect the web client" below, and use the URL with `wss://`:
   `wss://mem-table-tennis-rooms.<your-subdomain>.workers.dev`

**Optional: restrict origins.** To stop other sites using your server, uncomment `ALLOWED_ORIGINS` in `server/cloudflare/wrangler.toml` and list your web client's origin(s). Then redeploy.

**Test locally without an account:**
```bash
cd server/cloudflare && npx wrangler dev --port 8798
# then, from the repo root, run the end-to-end test against it:
ROOM_SERVER_URL=ws://127.0.0.1:8798 npx vitest run tests/server.test.ts
```

## Option B — Any Node.js host (Fly.io, Render, Railway, a VPS…)

```bash
npm install
npm run build:server          # → dist-server/node.mjs (single file, needs only Node 20+)
PORT=8080 npm run start:server
```

- Rooms are served at `ws://<host>:<port>/room/<CODE>`. Put it behind HTTPS so browsers can use `wss://`; Fly, Render and Railway do this for you.
- **Environment variables:**
  - `PORT`: the listen port. Default 8787.
  - `ALLOWED_ORIGINS`: optional, comma-separated page origins allowed to connect.
- **Health check:** `GET /` returns `200` with a short status line.
- **Rooms live in memory** in one process, so run a single instance (no horizontal scaling needed for this game).

**Local development:** run `npm run server` (port 8787) next to `npm run dev`. The dev client connects to `ws://localhost:8787` automatically.

---

## Connect the web client (Vercel)

1. In Vercel, open **Project → Settings → Environment Variables** and add:
   - `VITE_ROOM_SERVER` = `wss://…` (your Cloudflare Worker or Node server URL)
2. Redeploy, or push any commit.

Without this variable the deployed game falls back to `local`, which is AI-only.

## Playing online

1. **Create the room:** open **Online multiplayer**, set your name, and click **➕ Create room**.
2. **Invite people:** share the **room code** or the **invite link** (`…/?room=CODE`).
3. **Choose seats:** players take seats at the near or far end. Singles uses 2 seats and doubles uses 4.
4. **Fill any gaps:** the host can tick **Fill empty seats with AI**.
5. **Start:** the host clicks **Start match**.
   - Every player sees themselves at the near end.
   - The server referees every rally.
   - If someone disconnects mid-match, the AI takes over their seat.

## How the netcode works (short version)

- **Only tosses and hits are sent.** The ball's flight between contacts is deterministic.
- **Your contact is decided on your own machine,** so there's no input lag. Your client reports the contact time and the ball's state afterwards.
- **The server re-simulates every flight** with the same physics and rules code as offline play.
- **It judges 0.3 s behind real time,** so a hit report that is still crossing the network can count.
- **Doubles rules are enforced:** partners alternate, serves go diagonally (right half-court to right half-court), and server and receiver rotate.
