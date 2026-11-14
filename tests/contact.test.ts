import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, TABLE, launchState, solveAim, v3 } from '../src/physics';
import { IncomingPrediction } from '../src/game/intercept';
import { Player } from '../src/game/player';
import { PRESETS } from '../src/sandbox/presets';
import { FPS, playBall } from './helpers/practice';

function incoming(name: string) {
  const pr = PRESETS.find((p) => p.name === name)!;
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, DEFAULT_PARAMS, pr.highArc);
  return new IncomingPrediction(launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin }), DEFAULT_PARAMS);
}

describe('where the player meets the ball', () => {
  it('plays the ball at table level, even standing far back', () => {
    for (const stance of [0.6, 1.2, 1.8, 2.6]) {
      for (const pr of PRESETS) {
        const pred = incoming(pr.name);
        const p = new Player('p', DEFAULT_PARAMS);
        p.homeZ = TABLE.halfLength + stance;
        const c = p.contactFor(pred, 0);
        expect(c, `${pr.name} at ${stance} m`).not.toBeNull();
        // Every ball here comes up above the table after its bounce, so it is played there.
        expect(c!.pos.y, `${pr.name} at ${stance} m`).toBeGreaterThanOrEqual(TABLE.height + 0.04 - 1e-9);
      }
    }
  });

  it('meets the ball at the usual depth when it is still up there', () => {
    const p = new Player('p', DEFAULT_PARAMS);
    const c = p.contactFor(incoming('Float'), 0)!;
    expect(c.pos.z).toBeGreaterThanOrEqual(p.homeZ - 0.42 - 1e-9);
  });

  it('a flick while the ball is still rising takes it early', () => {
    let early = 0;
    for (const preset of ['Block', 'Float', 'Long push', 'Drive']) {
      const planned = new Player('p', DEFAULT_PARAMS).contactFor(incoming(preset), 0)!;
      // Flick about 0.12 s before the planned contact, with the bat steered toward it.
      const r = playBall(preset, 0.75, 0.12, 60, { setup: (p) => p.applyRealism(0.85) });
      if (r.hit && r.hit.time < planned.t - 0.05) {
        early++;
        expect(r.hit.pos.y).toBeGreaterThan(TABLE.height);
        expect(r.hit.pos.z).toBeLessThan(planned.pos.z);
      }
    }
    expect(early).toBeGreaterThanOrEqual(2);
  });

  it('a flick on time still meets the ball at the planned point', () => {
    for (const preset of ['Block', 'Drive']) {
      const planned = new Player('p', DEFAULT_PARAMS).contactFor(incoming(preset), 0)!;
      const r = playBall(preset, 0.75, 2 / FPS, 60, { setup: (p) => p.applyRealism(0.85) });
      expect(r.hit, preset).toBeTruthy();
      expect(Math.abs(r.hit!.time - planned.t)).toBeLessThan(0.05);
    }
  });
});
