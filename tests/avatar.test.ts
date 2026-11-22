import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STYLES } from '../src/game/styles';
import { AVATAR_STYLES, Avatar } from '../src/render/avatar';
import { ARM_MAX, HEAD_PIVOT, SHOULDER_Y } from '../src/render/avatar/dimensions';

const DT = 1 / 60;

/** Step a character through a pose with a fixed clock; the hand is relative to the body. */
function pose(a: Avatar, hand: [number, number, number], opts: { seconds?: number; move?: number; t0?: number; gaze?: [number, number, number] } = {}) {
  const steps = Math.round((opts.seconds ?? 1) / DT);
  const body = { x: 0, z: 0.4 };
  const target = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    body.x = (opts.move ?? 0) * i * DT;
    target.set(body.x + hand[0], hand[1], body.z + hand[2]);
    const g = opts.gaze;
    a.update(body, target, true, { now: (opts.t0 ?? 5) + i * DT, gaze: g && new THREE.Vector3(body.x + g[0], g[1], body.z + g[2]) });
  }
  a.group.updateMatrixWorld(true);
  return target;
}

const worldPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('avatar rig', () => {
  it('builds every character without a page (no painted textures)', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      let meshes = 0;
      a.group.traverse((o) => (meshes += (o as THREE.Mesh).isMesh ? 1 : 0));
      expect(meshes, s).toBeGreaterThan(30);
      expect(a.rig.seated, s).toBe(s === 'wheelchair');
      a.dispose();
    }
  });

  it('poses the same way every time with the same clock', () => {
    const joints = (a: Avatar) => {
      const r = a.rig;
      return [r.upper, r.head, r.arm.upper, r.arm.fore, r.arm.hand, r.free.upper, r.free.hand, ...r.legs.flatMap((l) => [l.hip, l.knee, l.foot])].map((j) => j.matrixWorld.elements.map((e) => e.toFixed(9)).join());
    };
    for (const s of ['allround', 'wheelchair'] as const) {
      const a = new Avatar(s, 1, 0);
      const b = new Avatar(s, 1, 0);
      for (const av of [a, b]) {
        pose(av, [0.4, 1.0, -0.4], { move: 1.2 });
        av.react('celebrate');
        pose(av, [0.6, 0.8, -0.3], { seconds: 0.4, t0: 7 });
      }
      expect(joints(a), s).toEqual(joints(b));
    }
  });

  it('puts the racket hand on the paddle handle, and stretches no further than full reach', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      const side = STYLES[s].leftHanded ? -1 : 1;
      for (const h of [
        [0.38, 1.0, -0.38],
        [0.7, 0.9, -0.3],
        [-0.2, 1.0, -0.45],
        [0.4, 1.6, -0.2],
      ] as [number, number, number][]) {
        const target = pose(a, [h[0] * side, h[1], h[2]]);
        const hand = worldPos(a.rig.arm.hand);
        const shoulder = worldPos(a.rig.arm.upper);
        const reach = ARM_MAX * a.group.scale.y;
        if (shoulder.distanceTo(target) <= reach) expect(hand.distanceTo(target), `${s} ${h}`).toBeLessThan(1e-3);
        else {
          // Out of reach: straight at the target, as far as the arm goes.
          expect(hand.distanceTo(shoulder)).toBeCloseTo(reach, 3);
          const toTarget = target.clone().sub(shoulder).normalize();
          expect(hand.clone().sub(shoulder).normalize().dot(toTarget)).toBeGreaterThan(0.999);
        }
      }
    }
  });

  it('a ball out of reach is followed, not reached', () => {
    const a = new Avatar('allround', 1, 0);
    const target = pose(a, [1.6, 1.0, -0.3]);
    const hand = worldPos(a.rig.arm.hand);
    expect(hand.distanceTo(target)).toBeGreaterThan(0.1);
    expect(hand.distanceTo(worldPos(a.rig.arm.upper))).toBeCloseTo(ARM_MAX * a.group.scale.y, 3);
  });

  it('hangs everything on the head from the head joint, so a head can be turned or swapped whole', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      // The standing pose before any animation: everything above the neck belongs to the head.
      a.group.updateMatrixWorld(true);
      const scale = a.group.scale.y;
      const onHead = new Set<THREE.Object3D>();
      a.rig.head.traverse((o) => onHead.add(o));
      const box = new THREE.Box3();
      let headMeshes = 0;
      a.group.traverse((o) => {
        if (!(o as THREE.Mesh).isMesh) return;
        const y = box.setFromObject(o).getCenter(new THREE.Vector3()).y / scale;
        if (onHead.has(o)) headMeshes++;
        else expect(y, `${s}: a mesh at ${y.toFixed(3)} m is not on the head joint`).toBeLessThan(HEAD_PIVOT.y + 0.01);
      });
      expect(headMeshes, s).toBeGreaterThan(10);
      expect(HEAD_PIVOT.y).toBeGreaterThan(SHOULDER_Y);
    }
  });

  it('rest pose: standing straight, head joint at the top of the neck, arms hanging evenly', () => {
    for (const s of ['allround', 'wheelchair'] as const) {
      const a = new Avatar(s, 1, 0);
      pose(a, [0.6, 0.7, -0.4], { move: 1 });
      a.restPose();
      const k = a.group.scale.y;
      const head = worldPos(a.rig.head);
      const seatDrop = s === 'wheelchair' ? 0.31 : 0;
      expect(head.x).toBeCloseTo(0, 6);
      expect(head.z).toBeCloseTo(0, 6);
      expect(head.y).toBeCloseTo((HEAD_PIVOT.y - seatDrop) * k, 6);
      const bat = worldPos(a.rig.arm.hand);
      const free = worldPos(a.rig.free.hand);
      expect(bat.x).toBeCloseTo(-free.x, 2);
      expect(bat.y).toBeCloseTo(free.y, 1);
      expect(bat.y).toBeLessThan((SHOULDER_Y - seatDrop - 0.5) * k);
    }
  });

  /** Where a joint looks: its local −z in the world. */
  const facing = (o: THREE.Object3D) => new THREE.Vector3(0, 0, -1).transformDirection(o.matrixWorld);

  it('looks at the ball: the eyes on it, the head nearly so', () => {
    for (const s of ['allround', 'looper', 'wheelchair'] as const) {
      for (const g of [
        [0.6, 1.3, -1.2],
        [-0.4, 0.9, -0.8],
        [0.2, 1.1, -2.5],
        [0.45, 0.6, -0.7],
      ] as [number, number, number][]) {
        const a = new Avatar(s, 1, 0);
        pose(a, [0.38, 1.0, -0.38], { gaze: g });
        const ball = new THREE.Vector3(g[0], g[1], 0.4 + g[2]);
        for (const eye of a.rig.eyes) {
          const toBall = ball.clone().sub(worldPos(eye)).normalize();
          expect(facing(eye).dot(toBall), `${s} eye → ${g}`).toBeGreaterThan(0.995);
        }
        const toBall = ball.clone().sub(worldPos(a.rig.head)).normalize();
        expect(facing(a.rig.head).dot(toBall), `${s} head → ${g}`).toBeGreaterThan(0.9);
      }
    }
  });

  it('looks ahead with nothing to watch, and turns no further than a neck can', () => {
    const a = new Avatar('allround', 1, 0);
    pose(a, [0.38, 1.0, -0.38]);
    const ahead = facing(a.rig.head);
    expect(ahead.z).toBeLessThan(-0.9);
    // A ball right behind: the head turns as far as it goes, not all the way round.
    pose(a, [0.38, 1.0, -0.38], { gaze: [0.3, 1.2, 2] });
    const behind = facing(a.rig.head);
    expect(behind.z).toBeGreaterThan(-0.6);
    expect(behind.z).toBeLessThan(0);
  });

  it('turning the head joint turns the face with it', () => {
    const a = new Avatar('patient', 1, 0);
    a.group.updateMatrixWorld(true);
    const before: THREE.Vector3[] = [];
    a.rig.head.traverse((o) => (o as THREE.Mesh).isMesh && before.push(worldPos(o)));
    a.rig.head.rotation.y = 0.6;
    a.group.updateMatrixWorld(true);
    let moved = 0;
    let i = 0;
    a.rig.head.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && worldPos(o).distanceTo(before[i++]) > 0.005) moved++;
    });
    // Nearly everything on the head swings round (only pieces on the turning axis stay put).
    expect(moved / before.length).toBeGreaterThan(0.8);
  });
});
