# MEM Table Tennis — Game Plan

A 3D browser table tennis game for 1–4 players (singles and doubles), built around spin, pace and a full range of shots. Themed around IT professionals.

## Decisions so far

| Area | Decision |
|---|---|
| Multiplayer | Online, private rooms joined with a room code; each player on their own device |
| Controls | Mouse swing; keyboard modifiers for paddle face, sidespin and forehand/backhand |
| Feel | Simulation by default, with an "arcade" slider |
| Movement | Assisted: manual movement with an adjustable pull toward the ideal spot |
| Depth | Rubber types, detailed serves, player styles |
| Visuals | Minimal prototype first; art direction decided once the feel is right |
| Mobile | Later. Input is kept abstract so touch can be added |
| Progression | Later (stats, training drills, tournaments, unlocks) |

## Technology

- **Client:** TypeScript, Vite, Three.js.
- **Physics:** custom, in its own module with no rendering code, running a fixed timestep at 240 Hz.
  - Gravity, air drag, and the Magnus effect (spin bending the ball's path).
  - Table bounce, with friction that lets spin act on the ball: backspin checks up, topspin kicks forward.
  - Ball–rubber contact, where the rubber type sets grip and how fast the ball comes off.
  - Net and net-clip collisions.
  - The same code runs on the client and the server.
- **Networking:** private rooms on Cloudflare Workers with Durable Objects, one object per room.
  - Each player's swing is shown instantly on their own screen, and the server confirms whether the hit counts.
  - Between hits the ball's flight is fully predictable, so only hit events need to cross the network.
- **Hosting:**
  - The client is static files on Cloudflare Pages, so client and server live on one platform.
  - Vercel or GitHub Pages also work for the client.
  - Fly.io running a Node WebSocket server is the fallback for the room server.
- **Input abstraction:** every input device produces the same `SwingInput` (paddle path, face angle, tilt, stroke side). Mouse comes first; touch swipes and phone tilt come later.

## Controls (desktop)

| Input | Action |
|---|---|
| Mouse movement | Paddle position. Speed and direction of the swing at contact set pace and spin |
| W / S | Close / open the paddle face |
| A / D | Tilt the paddle for sidespin |
| Shift | Switch forehand / backhand |
| Space | Serve toss (hold for a higher toss) |
| Arrow keys | Movement, with assisted pull toward the ideal spot |

## Shot model

There are no hard-coded shots. They come out of how the paddle meets the ball, and the game names what you played, for example "Loop · 4,200 rpm · 21 m/s".

- **Topspin:** drive, loop, counter-loop, banana flick
- **Backspin:** push, chop, drop shot
- **Other:** block, smash, lob, sidespin hook
- **Serves:**
  - toss height, contact point and swing;
  - legality checks (16 cm minimum toss, open palm, ball not hidden from the receiver);
  - spin can be disguised, e.g. a heavy-backspin serve and a no-spin serve that look the same.

## Theme: IT professionals

**Player styles**

| Style | Character | Play |
|---|---|---|
| Looper | Full-Stack Dev | Heavy topspin from both wings |
| Chopper | Sysadmin | Defends far from the table and returns everything |
| Blocker | Security Analyst ("The Firewall") | Close to the table, redirects pace |
| Penhold Hitter | Network Engineer | Fast, flat, early timing |
| All-rounder | Helpdesk Hero | Balanced |

**Rubbers**

| Rubber | Name | Behavior |
|---|---|---|
| Inverted | Standard Build | Grippy, maximum spin |
| Short pips | Hotfix | Fast and flat, less affected by spin |
| Long pips | Legacy Code | Reverses the incoming spin |
| Anti-spin | Air Gap | Kills spin |

**Venues:** open-plan office, server room, conference room, rooftop at the company offsite.

**Flavour text**

| Event | Text |
|---|---|
| Net | "PACKET LOSS" |
| Ball misses the table | "404" |
| Ace | "ZERO-DAY" |
| Let | "RETRY" |
| Deuce | "RACE CONDITION" |
| Timeout | "SCHEDULED MAINTENANCE" |

## Readability aids

- Spin shown by logo marks on the ball and a color-tinted trail (type and strength).
- An optional marker showing where the ball will bounce, for training.
- A replay of the last rally, with spin and speed readouts.

## Realism slider (0–100% arcade)

The host sets it for the room. It adjusts:

- ball speed (time slows down);
- how wide the timing window is;
- how strongly spin curves the ball, with an option to exaggerate it;
- how hard it is to miss the table;
- how strongly movement pulls you to the ball.

## Milestones

1. ✅ **Physics sandbox** (done): ball, table and net, plus a ball machine firing set spins. Tune against real ball speeds (up to about 30 m/s) and spin rates (up to about 150 rps).
2. ✅ **Swing → contact** (done): the mouse paddle and keyboard modifiers produce every shot above, played against the ball machine.
3. ✅ **Rules + 1v1 against AI** (done): scoring, serves with the legality check, a basic AI.
4. ✅ **Online rooms** (done): room codes, 1v1, then 2v2 doubles with partners taking turns, plus spectators.
5. ✅ **Depth** (done): rubbers, player styles, AI per style, the realism slider.
6. ✅ **Look and theme** (done): IT venues and characters, audio, replays.
7. ✅ **Mobile** (done): touch-swipe swings, optional phone tilt, performance tuning.
8. ✅ **Progression** (done): stats, training drills, tournaments, unlocks.
