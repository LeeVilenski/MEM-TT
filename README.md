# MEM Table Tennis

A 3D browser table tennis game for 1–4 players, built around spin, pace and a full range of shots. See [PLAN.md](PLAN.md) for the full design and milestones.

## Status: Milestone 1 — physics sandbox

The physics core plus a ball machine to tune it against:

- **Ball flight:** gravity, air drag and Magnus lift (spin curves the ball).
- **Bounce:** friction-based table bounce; backspin checks up, topspin kicks, corkscrew spin kicks sideways.
- **Net:** the mesh stops the ball; the tape deflects it ("net cord"). No tunnelling at smash speeds.
- **Ball machine:** 13 shot presets (push, chop, float, block, drive, loops, hook, banana flick, smash, lob, corkscrew). An aim solver lands any speed/spin combination on a chosen target.
- **Readouts:** launch speed, spin in rpm with top/side/corkscrew breakdown, net clearance, and per-bounce speed in/out, kick angle and spin after the bounce.
- **Visuals:** a spin-coloured trail (warm = topspin, blue = backspin, green = side), a spin-axis indicator, the predicted path, bounce marks, slow motion and single-stepping.
- **Tuning:** every physics constant is live-tunable in the "Physics tuning" panel; "Copy params as JSON" exports a tuned set.

## Running

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # physics unit tests
npm run build    # static build in dist/
```

### Sandbox controls

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
  ball.ts      Flight, bounce, net and floor; fixed 240 Hz tick with adaptive sub-steps
  spin.ts      Top/side/corkscrew ⇄ angular-velocity conversion and labels
  machine.ts   Launch + aim solver
  constants.ts ITTF dimensions and tunable physics parameters
src/render/    Three.js scene and ball view
src/sandbox/   Milestone 1 sandbox app (ball machine, HUD, controls)
tests/         Vitest physics tests (ITTF bounce rule, Magnus, spin-on-bounce, net)
```

World conventions: metres and seconds, +y up, the net at z = 0, and the player's (near) end at +z.
