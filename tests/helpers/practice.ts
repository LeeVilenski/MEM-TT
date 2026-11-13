import { BallSim, DEFAULT_PARAMS, TABLE, TICK_DT, launchState, solveAim, v3, type BallEvent } from '../../src/physics';
import { IncomingPrediction } from '../../src/game/intercept';
import { Player } from '../../src/game/player';
import { classifyShot } from '../../src/game/shots';
import { NO_INPUT, REACH } from '../../src/game/swing';
import { PRESETS } from '../../src/sandbox/presets';

export const FPS = 60;
const AIM = { x: 0, z: -0.85 };

/**
 * Plays one machine ball through exactly the per-frame pipeline the browser uses
 * (Player.update → N physics ticks with swept paddle colliders), driven by a
 * scripted "human": positions at ~800 px/s, then a 3-frame flick.
 */
export function playBall(presetName: string, angleAssist: number, flickLead = 2 / FPS, flickPx = 60) {
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
  player.swing.basePitch = backspin ? -10 : -30;
  const sens = player.swing.params.sensitivity;
  const maxStep = 800 / FPS; // positioning speed, below the stroke threshold
  let flick = 0;
  let flicked = false;
  let accumulator = 0;
  let hit: Extract<BallEvent, { type: 'paddle' }> | undefined;
  let result: string | undefined;
  let landing: { x: number; z: number } | undefined;

  for (let frame = 0; frame < FPS * 4 && !result; frame++) {
    const input = { ...NO_INPUT };
    const ic = hit ? null : pred.interceptAt(player.restZ, sim.time, REACH.maxHeight - 0.05);
    player.intercept = ic?.pos ?? null;
    if (ic) {
      const ttc = ic.t - sim.time;
      if (!flicked && ttc <= flickLead) {
        flick = 3;
        flicked = true;
      }
      if (flick > 0) {
        input.dy = -flickPx;
        flick--;
      } else {
        const clamp = (v: number) => Math.max(-maxStep, Math.min(maxStep, v));
        // Footwork assist handles fine left–right alignment; only correct big errors.
        const ex = ic.pos.x - player.swing.pose.pos.x;
        if (Math.abs(ex) > 0.3) input.dx = clamp(ex / sens);
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
  return { result: result ?? (hit ? 'NO LANDING' : 'MISSED'), shot, landing };
}

