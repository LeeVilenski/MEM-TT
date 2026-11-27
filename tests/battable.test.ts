import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Match } from '../src/game/match';
import { DEFAULT_PARAMS, PADDLE, TABLE } from '../src/physics';
import { bladeQuaternion, tableClearance } from '../src/render/playerView';
import { mulberry32 } from './helpers/rng';

const q = (normal: { x: number; y: number; z: number }, towardBody = 0) => bladeQuaternion(normal, towardBody, new THREE.Quaternion());

describe('drawn bat and the table top', () => {
  it('lifts a bat that would sink into the table, and leaves others alone', () => {
    // Upright blade facing the net, centred just above the surface over the table: the rim dips in.
    const upright = q({ x: 0, y: 0, z: -1 });
    const low = new THREE.Vector3(0, TABLE.height + 0.03, 1.0);
    const lift = tableClearance(low, upright);
    expect(lift).toBeGreaterThan(PADDLE.radius - 0.03);
    expect(tableClearance(low.clone().setY(low.y + lift), upright)).toBeCloseTo(0, 6);
    // High above the table: nothing to do.
    expect(tableClearance(new THREE.Vector3(0, TABLE.height + 0.3, 1.0), upright)).toBe(0);
    // Low but behind the end line (beside the table, not over it): nothing to do.
    expect(tableClearance(new THREE.Vector3(0, TABLE.height - 0.1, TABLE.halfLength + 0.25), upright)).toBe(0);
  });

  it('keeps both bats out of the table through real AI rallies', () => {
    const P = DEFAULT_PARAMS;
    const rng = mulberry32(7);
    const ais = { near: new AiPlayer('near', AI_LEVELS.hard, P, rng), far: new AiPlayer('far', AI_LEVELS.hard, P, rng) };
    const m = new Match(P, { near: { kind: 'ai', ai: ais.near }, far: { kind: 'ai', ai: ais.far } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    const pos = new THREE.Vector3();
    let sunk = 0;
    let maxLift = 0;
    for (let i = 0; i < 60 * 60 * 10 && m.phase !== 'match-over'; i++) {
      m.frame(1 / 60, 1 / 60);
      for (const ai of [ais.near, ais.far]) {
        const pose = ai.worldPose;
        const rot = q(pose.normal, ai.worldBody.x - pose.pos.x);
        pos.set(pose.pos.x, pose.pos.y, pose.pos.z);
        const lift = tableClearance(pos, rot);
        if (lift > 0.005) sunk++;
        maxLift = Math.max(maxLift, lift);
        pos.y += lift;
        expect(tableClearance(pos, rot)).toBeLessThan(1e-6);
      }
    }
    // The undrawn poses really do dip into the table (this is the bug), and the lift stays small.
    expect(sunk).toBeGreaterThan(0);
    expect(maxLift).toBeLessThan(0.4);
  });
});
