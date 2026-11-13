# MEM Table Tennis

A 3D browser table tennis game for 1–4 players, built around spin, pace and a full range of shots. See [PLAN.md](PLAN.md) for the full design and milestones.

## Status: Milestone 4 — online rooms (singles and doubles)

- **Create a room:** open **Online multiplayer**, then **➕ Create room**. Share the 5-letter code or the invite link, players choose seats, and the host starts the match.
- **Fill seats with AI:** empty seats can be filled by the AI, so 1 human vs AI, 2 vs 2, or anything in between works.
- **Doubles follows the real rules:** partners alternate shots, serves go diagonally, and server and receiver rotate.
- **Everyone plays from the near end:** the view is mirrored for whoever is at the far end.
- **Your own contacts have no input lag:** your client decides the contact and reports it, and the server re-simulates and referees every rally.
- **Disconnects:** if a player drops out mid-match, the AI takes over their seat.
- **Hosting is your choice:** a **Cloudflare** Worker with Durable Objects, or a plain **Node** WebSocket server. Both run the same room code. See **[HOSTING.md](HOSTING.md)**.
- **No server configured?** The client falls back to an in-browser room server: the full online path, against the AI only.

### Milestone 3 — rules, scoring and a match vs AI

Open **Match vs AI** in the panel, choose an opponent and a format, and press **▶ Start match**.

- **Opponents:** Intern (easy), Sysadmin (medium) and Principal Engineer (hard).
- **Formats:** best of 1, 3, 5 or 7 games.

**Serving**
- Hold **Space** to toss: longer means higher, and the meter shows it.
- Release, then swing as the ball drops.
- Serve legality is checked: toss of at least 16 cm, struck while falling, behind the end line, above the playing surface.
- The angle assist switches to serve mode while you serve: own half first, then the opponent's.
- Serves are gentle strokes, so the stroke threshold is lower while serving.

**Rules engine** (`src/game/rules.ts`): pure logic driven by physics events.
- The serve bounce sequence, and lets (net touch then lands).
- Double bounce, ball onto your own half, out and into the net.
- Double hits.
- Volleys: obstruction if the ball would have landed, otherwise the volleyer wins.
- Aces.
- Games to 11, win by 2.
- Serve changes every 2 points, every point from 10–10; the first server alternates each game.
- Best of N games.

**AI opponent** (`src/game/ai.ts`)
- **Same physics as you:** it predicts the ball and chooses a stroke for the incoming spin and height (push, loop, drive, block, smash, flick or chop). It then solves for a face angle that lands in the middle of the landing window, aimed at a target.
- **Kinematic swing:** the blade really travels through the contact point at the planned moment.
- **Difficulty only changes execution:** reaction time, footwork speed, and angle, aim and speed errors.

**Call-outs**

| Event | Call-out |
|---|---|
| Into the net | PACKET LOSS |
| Off the table | 404 |
| Bounced on own side | SEGFAULT |
| Not returned | TIMEOUT |
| Illegal serve | SYNTAX ERROR |
| Ace | ZERO-DAY |
| Let | RETRY |
| Deuce | RACE CONDITION |
| Game won / lost | DEPLOYED / ROLLBACK |
| Match won / lost | SHIPPED TO PROD / INCIDENT REPORT |

Practice against the ball machine (Milestone 2) is still there: **▶ Play** without starting a match.

### Milestone 2 — swing → contact

Play against the ball machine with a mouse-driven paddle. Click **▶ Play**: the mouse is captured and becomes the paddle.

| Input | Action |
|---|---|
| Mouse | Move the paddle (relative to your body, like an arm) |
| **Flick** the mouse | Stroke. Up = topspin (loop), down = backspin (push/chop), sideways = sidespin |
| Hold left button | Drive: more forward pace, less brush |
| W / S | Close / open the face while held |
| Mouse wheel | Base face angle |
| A / D | Hook: brush for a ball that curves left / right |
| Shift | Lock forehand/backhand (press again for auto) |
| Arrow keys | Footwork (on top of the footwork assist) |
| Esc | Leave play mode |

**How contact works**
- The paddle is a real collider. It's swept between frames, so fast swings can't pass through the ball.
- The impulse model includes the rubber's restitution and grip and a sponge "catapult". Spin, pace and direction come from the paddle's velocity and face angle; nothing is scripted per shot.
- Rubbers:
  - **Standard Build** (inverted)
  - **Hotfix** (short pips)
  - **Legacy Code** (long pips): returns topspin as backspin
  - **Air Gap** (anti-spin)
- Shots are named from what actually happened: loop, counter-loop, drive, flick, push, chop, smash, lob, block, hook loop and so on.

**Assists** (all adjustable in the Player panel, and will feed the arcade/realism slider)
- **Intercept ring:** where the ball will reach your hitting plane.
- **Timing window:** a flick stays live for 120 ms, fading out.
- **Angle assist:** at contact, corrects the face angle into the landing window if your error is within strength × 60°. Strength 0 = pure physics.
- **Hit area:** a slightly larger blade.
- **Footwork assist:** steps you so the paddle lines up with the ball, leans over the table for short balls and backs off for lobs.

### Milestone 1 — physics sandbox

The physics core plus a ball machine to tune it against:

- **Ball flight:** gravity, air drag and Magnus lift (spin curves the ball).
- **Bounce:** friction-based table bounce; backspin checks up, topspin kicks, corkscrew spin kicks sideways.
- **Net:** the mesh stops the ball; the tape deflects it ("net cord"). No tunnelling at smash speeds.
- **Ball machine:** 13 shot presets with an aim solver that lands any speed/spin combination on a chosen target.
- **Readouts and visuals:** speeds, spin in rpm (top/side/corkscrew), net clearance, per-bounce data, a spin-coloured trail, a spin-axis indicator, slow motion and single-stepping.
- **Tuning:** every physics constant is live-tunable; "Copy tuning as JSON" exports a set.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics unit tests
npm run build    # static build in dist/
npm run server   # local room server on :8787 (online play in dev)
npm run build:server   # bundle the Node room server → dist-server/node.mjs
```

Hosting the room server (Cloudflare or Node) is covered in [HOSTING.md](HOSTING.md).

### Inspect-mode controls (not playing)

| Input | Action |
|---|---|
| Space | Fire the ball machine |
| P / . | Pause / step one physics tick |
| 1–5 | Cameras: player, side, top, broadcast, machine |
| Shift + click on the near half | Set the landing target |
| C | Clear bounce marks |
| Drag / wheel | Orbit / zoom |

## Code layout

```
src/physics/   Pure TypeScript simulation, no rendering. Will be shared with the online room server.
  ball.ts      Flight, bounce, net and floor; swept paddle collisions; fixed 240 Hz tick
  paddle.ts    Rubber types and the ball–paddle impulse model
  spin.ts      Top/side/corkscrew ⇄ angular-velocity conversion and labels
  machine.ts   Launch + aim solver
  constants.ts ITTF dimensions and tunable physics parameters
src/game/      Engine-agnostic game logic (shared with AI and netcode later)
  swing.ts     Mouse → paddle pose/velocity (stroke model, timing window)
  player.ts    Body, footwork assist, reach/lean, per-tick paddle colliders
  assist.ts    Angle assist (contact-time landing solver)
  intercept.ts Where/when the incoming ball reaches the player
  shots.ts     Shot naming
  frame.ts     Near/far end mapping (each player's logic runs as if at the near end)
  rules.ts     Rally referee, serve legality, scoring and serve rotation
  ai.ts        AI opponent (planning, stroke solving, difficulty)
  match.ts     Match orchestration: serving, rallies, scoring (engine-agnostic)
  messages.ts  IT-themed call-outs
src/net/       Online play
  protocol.ts  Wire messages (shared by client and servers)
  room.ts      Room server logic: lobby, seats, refereeing, AI seats (host-agnostic)
  client.ts    Game client: local contact authority, flight simulation, clock sync
  transport.ts WebSocket transport + in-process LocalServer (tests, "local" mode)
server/        Room server adapters
  node.ts      Node.js (ws) — Fly.io, Render, Railway, VPS
  cloudflare/  Cloudflare Worker + Durable Object (wrangler.toml)
src/render/    Three.js scene, ball, paddle and player views
src/sandbox/   Sandbox app (ball machine, play mode, HUD, controls)
tests/         Vitest: physics, paddle contact, swing, assist, rules, an end-to-end
               gameplay test vs every machine preset, full AI-vs-AI matches,
               scripted human serves/rallies against the AI, online rooms with
               simulated latency (singles, doubles, AI seats, near/far symmetry),
               and end-to-end over real WebSockets (Node or Cloudflare adapter)
```

World conventions: metres and seconds, +y up, the net at z = 0, and the player's (near) end at +z.
