import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS as P, TABLE, TICK_DT, launchState, v3, type BallEvent } from '../src/physics';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { STYLES, STYLE_IDS } from '../src/game/styles';
import { mulberry32 } from './helpers/rng';

/** One short ball from the near end at the far AI; returns the outcome. */
function shortBall(ai: AiPlayer, targetZ: number, x: number, spin: { top: number; side: number; cork: number }, speed: number) {
  const origin = v3(x * 0.5, TABLE.height + 0.12, TABLE.halfLength + 0.05);
  const azimuth = 180 + (Math.atan2(x - origin.x, origin.z - targetZ) * 180) / Math.PI;
  let best = { err: Infinity, elevation: 0 };
  for (let el = -15; el <= 50; el += 0.5) {
    const s0 = new BallSim(launchState(origin, { speed, elevation: el, azimuth, spin }), P);
    for (let i = 0; i < 2000; i++) {
      const ev: BallEvent[] = [];
      s0.step(TICK_DT, ev);
      const tb = ev.find((e) => e.type === 'table' || e.type === 'floor' || e.type === 'net');
      if (!tb) continue;
      if (tb.type === 'table' && tb.side === 'far') {
        const err = Math.abs(tb.pos.z - targetZ);
        if (err < best.err) best = { err, elevation: el };
      }
      break;
    }
  }
  if (best.err > 0.1) return 'invalid';
  const sim = new BallSim(launchState(origin, { speed, elevation: best.elevation, azimuth, spin }), P);
  let planned = false;
  let hit = false;
  let farBounces = 0;
  let acc = 0;
  for (let f = 0; f < 60 * 4; f++) {
    if (!planned) { ai.planReturn(sim.state, sim.time); planned = true; }
    ai.update(1 / 60, sim.time);
    acc += 1 / 60;
    const n = Math.floor(acc / TICK_DT + 1e-9);
    acc -= n * TICK_DT;
    for (let i = 0; i < n; i++) {
      const ev: BallEvent[] = [];
      sim.step(TICK_DT, ev, hit ? undefined : [ai.collider(i, n)]);
      for (const e of ev) {
        if (e.type === 'paddle') hit = true;
        if (!hit && (e.type === 'net' || (e.type === 'table' && e.side === 'near'))) return 'invalid';
        if (!hit && e.type === 'table' && e.side === 'far' && ++farBounces >= 2) return 'double-bounce';
        if (hit && e.type === 'table') return e.side === 'near' ? 'in' : 'own-side';
        if (e.type === 'net' && hit) return 'net';
        if (e.type === 'floor') return hit ? 'out' : 'missed';
      }
    }
  }
  return hit ? 'no-landing' : 'missed';
}

describe('AI against short balls', () => {
  // Drops and short serves (bouncing 0.2–0.6 m past the net): the Principal AI steps in to
  // the end line and leans over the table to take them at the top of the bounce.
  it('Principal returns most short balls, whatever the spin', () => {
    const rng = mulberry32(5);
    const spins = [{ top: -45, side: 0, cork: 0 }, { top: 0, side: 0, cork: 0 }, { top: -10, side: 35, cork: 0 }];
    let valid = 0;
    let made = 0;
    let doubleBounce = 0;
    for (const sid of STYLE_IDS) {
      for (const spin of spins) {
        for (let k = 0; k < 10; k++) {
          const ai = new AiPlayer('far', AI_LEVELS.hard, P, rng);
          ai.setStyle(STYLES[sid]);
          const r = shortBall(ai, -(0.2 + rng() * 0.4), (rng() * 2 - 1) * 0.6, spin, 3.8 + rng() * 1.5);
          if (r === 'invalid') continue;
          valid++;
          if (r === 'in') made++;
          if (r === 'double-bounce' || r === 'missed') doubleBounce++;
        }
      }
    }
    expect(valid).toBeGreaterThan(80);
    expect(made / valid).toBeGreaterThan(0.82);
    expect(doubleBounce / valid).toBeLessThan(0.06);
  }, 120000);
});
