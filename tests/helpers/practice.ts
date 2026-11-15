import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, launchState, solveAim, v3, type BallEvent } from '../../src/physics';
import { IncomingPrediction } from '../../src/game/intercept';
import { Player } from '../../src/game/player';
import { classifyShot } from '../../src/game/shots';
import { NO_INPUT } from '../../src/game/swing';
import { PRESETS } from '../../src/sandbox/presets';

export const FPS = 60;
const AIM = { x: 0, z: -0.85 };

/**
 * Plays one machine ball through exactly the per-frame pipeline the browser uses
 * (Player.update → N physics ticks with swept paddle colliders), driven by a
 * scripted "human": positions at ~800 px/s, then a 3-frame flick.
 */
/**
 * @param flickPx flick size per frame; positive = upward flick (topspin), negative = downward (backspin)
 * @param opts.basePitch face angle to hold (default: −10° vs backspin, −30° vs topspin)
 * @param opts.setup adjust the player before the ball (e.g. realism)
 */
export function playBall(presetName: string, angleAssist: number, flickLead = 2 / FPS, flickPx = 60, opts: { basePitch?: number; setup?: (p: Player) => void; smash?: boolean } = {}) {
  const P = DEFAULT_PARAMS;
  const pr = PRESETS.find((p) => p.name === presetName)!;
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
  const start = launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin });
  const sim = new BallSim(start, P);
  const pred = new IncomingPrediction(start, P);
  const player = new Player('p1', P);
  player.assists.angle = angleAssist;

  const backspin = pr.spin.top < 0;
  player.swing.basePitch = opts.basePitch ?? (backspin ? -10 : -30);
  opts.setup?.(player);
  const sens = player.swing.params.sensitivity;
  const maxStep = 2400 / FPS; // positioning speed (a brisk hand)
  let flick = 0;
  let flicked = false;
  let accumulator = 0;
  let hit: Extract<BallEvent, { type: 'paddle' }> | undefined;
  let result: string | undefined;
  let landing: { x: number; z: number } | undefined;

  for (let frame = 0; frame < FPS * 4 && !result; frame++) {
    const input = { ...NO_INPUT, smash: !!opts.smash };
    const ic = player.contactFor(hit ? null : pred, sim.time);
    player.setIntercept(ic, sim.time);
    if (ic) {
      const ttc = ic.t - sim.time;
      if (!flicked && ttc <= flickLead) {
        flick = 3;
        flicked = true;
      }
      if (flick > 0) {
        input.dy = -flickPx;
        flick--;
      } else if (!flicked) {
        // (After the flick the hand follows through and holds; it doesn't chase the ring.)
        const clamp = (v: number) => Math.max(-maxStep, Math.min(maxStep, v));
        // Steer the cursor (the bat, before the magnet) onto the ring.
        input.dx = clamp((ic.pos.x - player.batX) / sens);
        input.dy = clamp(-(ic.pos.y - player.swing.y) / sens);
      }
    } else if (flick > 0) {
      input.dy = -flickPx;
      flick--;
    }
    player.update(1 / FPS, input, { x: 0, z: 0 }, AIM);

    accumulator += 1 / FPS;
    const ticks = Math.floor(accumulator / TICK_DT + 1e-9);
    accumulator -= ticks * TICK_DT;
    for (let i = 0; i < ticks && !result; i++) {
      const events: BallEvent[] = [];
      sim.step(TICK_DT, events, hit ? undefined : [player.collider(i, ticks)]);
      for (const e of events) {
        if (e.type === 'paddle' && !hit) hit = e;
        else if (hit && e.type === 'table' && e.time > hit.time) {
          result = e.side === 'far' ? 'IN' : 'OWN SIDE';
          landing = { x: e.pos.x, z: e.pos.z };
        }
        else if (hit && e.type === 'floor') result = 'OUT';
        else if (!hit && e.type === 'floor') result = 'MISSED';
      }
    }
  }
  const shot = hit && classifyShot(hit.pos, hit.velOut, hit.spinOut, hit.paddleVel, hit.velIn, hit.spinIn);
  return { result: result ?? (hit ? 'NO LANDING' : 'MISSED'), shot, landing, hit };
}

