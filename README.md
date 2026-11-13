# MEM Table Tennis

A 3D browser table tennis game for 1–4 players, built around spin, pace and a full range of shots. See [PLAN.md](PLAN.md) for the full design and milestones.

## Status: Milestone 2 — swing → contact

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
```

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
src/render/    Three.js scene, ball, paddle and player views
src/sandbox/   Sandbox app (ball machine, play mode, HUD, controls)
tests/         Vitest: physics, paddle contact, swing, assist, and an end-to-end
               gameplay test that plays every machine preset through the real per-frame pipeline
```

World conventions: metres and seconds, +y up, the net at z = 0, and the player's (near) end at +z.
