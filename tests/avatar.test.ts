import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { STYLES } from '../src/game/styles';
import { AVATAR_STYLES, Avatar } from '../src/render/avatar';
import { ARM_MAX, HEAD_PIVOT, SHOULDER_Y } from '../src/render/avatar/dimensions';
import { bladeQuaternion, gripQuaternion } from '../src/render/playerView';

const DT = 1 / 60;

/** Step a character through a pose with a fixed clock; the hand is relative to the body. */
function pose(
  a: Avatar,
  hand: [number, number, number],
  opts: { seconds?: number; move?: number; t0?: number; gaze?: [number, number, number]; grip?: THREE.Quaternion } = {},
) {
  const steps = Math.round((opts.seconds ?? 1) / DT);
  const body = { x: 0, z: 0.4 };
  const target = new THREE.Vector3();
  for (let i = 0; i <= steps; i++) {
    body.x = (opts.move ?? 0) * i * DT;
    target.set(body.x + hand[0], hand[1], body.z + hand[2]);
    const g = opts.gaze;
    a.update(body, target, true, { now: (opts.t0 ?? 5) + i * DT, gaze: g && new THREE.Vector3(body.x + g[0], g[1], body.z + g[2]), grip: opts.grip });
  }
  a.group.updateMatrixWorld(true);
  return target;
}

const worldPos = (o: THREE.Object3D) => o.getWorldPosition(new THREE.Vector3());

describe('avatar rig', () => {
  /** The character's skinned meshes. */
  const skins = (a: Avatar) => {
    const out: THREE.SkinnedMesh[] = [];
    a.group.traverse((o) => (o as THREE.SkinnedMesh).isSkinnedMesh && out.push(o as THREE.SkinnedMesh));
    return out;
  };

  it('builds every character without a page (no painted textures), as a few skinned meshes on one skeleton', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      const sk = skins(a);
      expect(sk.length, s).toBeGreaterThan(4);
      expect(sk.length, s).toBeLessThan(25);
      expect(new Set(sk.map((m) => m.skeleton)).size, s).toBe(1);
      expect(a.rig.seated, s).toBe(s === 'wheelchair');
      a.dispose();
    }
  });

  it('a see-through character (a doubles partner) fades every part of it', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 0.35, 0);
      a.setOpacity(0.2);
      a.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (!m) return;
        expect(m.transparent, `${s}: ${o.name || o.type}`).toBe(true);
        expect(m.opacity, `${s}: ${o.name || o.type}`).toBeCloseTo(0.2, 5);
      });
    }
  });

  it('feet stay planted while the body sways, on the floor, about shoulder-width apart', () => {
    const a = new Avatar('allround', 1, 0);
    const hand = new THREE.Vector3();
    const ankles = () => a.rig.legs.map((l) => l.foot.getWorldPosition(new THREE.Vector3()));
    // Settle, then sway the body a few centimetres for a second.
    let first: THREE.Vector3[] | null = null;
    for (let i = 0; i < 180; i++) {
      const x = i < 60 ? 0 : 0.03 * Math.sin(i * 0.2);
      hand.set(x + 0.38, 1.0, 0.4 - 0.38);
      a.update({ x, z: 0.4 }, hand, true, { now: 3 + i * DT });
      a.group.updateMatrixWorld(true);
      if (i === 60) first = ankles();
      if (i > 60) ankles().forEach((p, k) => expect(p.distanceTo(first![k]), `foot ${k} slid`).toBeLessThan(0.002));
    }
    const [l, r] = ankles();
    expect(Math.abs(l.y - r.y)).toBeLessThan(1e-3);
    expect(l.y).toBeCloseTo(0.04 * a.group.scale.y, 2);
    expect(r.x - l.x).toBeGreaterThan(0.3);
    expect(r.x - l.x).toBeLessThan(0.5);
  });

  it('steps rather than slides: moving across, a foot is nearly always planted, and they catch up', () => {
    const a = new Avatar('looper', 1, 0);
    const hand = new THREE.Vector3();
    let prev: THREE.Vector3[] | null = null;
    let planted = 0;
    let frames = 0;
    for (let i = 0; i < 150; i++) {
      // Stand, then move 1.2 m to the right at 1.5 m/s, then stand again.
      const t = i * DT;
      const x = Math.min(1.2, Math.max(0, (t - 0.5) * 1.5));
      hand.set(x + 0.38, 1.0, 0.4 - 0.38);
      a.update({ x, z: 0.4 }, hand, true, { now: 3 + t });
      a.group.updateMatrixWorld(true);
      const now = a.rig.legs.map((l) => l.foot.getWorldPosition(new THREE.Vector3()));
      if (prev && t > 0.5 && t < 1.3) {
        frames++;
        if (now.some((p, k) => p.distanceTo(prev![k]) < 1e-4)) planted++;
      }
      prev = now;
    }
    expect(planted / frames).toBeGreaterThan(0.6);
    // Settled at the new place: feet either side of the body.
    const [l, r] = prev!;
    expect(l.x).toBeLessThan(1.2);
    expect(r.x).toBeGreaterThan(1.2);
    expect(Math.abs((l.x + r.x) / 2 - 1.2)).toBeLessThan(0.12);
  });

  it("a ponytail hangs down when still and swings when she moves", () => {
    const a = new Avatar('wheelchair', 1, 0);
    const tail = a.rig.ponytail!;
    expect(tail).toBeTruthy();
    const hand = new THREE.Vector3();
    const hanging = () => {
      a.group.updateMatrixWorld(true);
      return new THREE.Vector3(0, -1, 0).applyQuaternion(tail.getWorldQuaternion(new THREE.Quaternion()));
    };
    // Still, looking down at a low ball: the tail turns in the head to keep hanging down.
    for (let i = 0; i < 120; i++) {
      hand.set(0.38, 0.9, 0);
      a.update({ x: 0, z: 0.4 }, hand, true, { now: 3 + i * DT, gaze: new THREE.Vector3(0.2, 0.3, -0.2) });
    }
    expect(hanging().y).toBeLessThan(-0.95);
    // Wheeling off sideways and stopping: it swings, then settles.
    let most = 0;
    for (let i = 0; i < 90; i++) {
      const x = Math.min(0.6, i * DT * 2.5);
      hand.set(x + 0.38, 0.9, 0.4);
      a.update({ x, z: 0.4 }, hand, true, { now: 6 + i * DT });
      // How far from straight down it swings (rad).
      most = Math.max(most, Math.acos(Math.min(1, -hanging().y)));
    }
    expect(most).toBeGreaterThan(0.1);
    // Still again: back to hanging down.
    for (let i = 0; i < 150; i++) a.update({ x: 0.6, z: 0.4 }, hand, true, { now: 8 + i * DT });
    expect(hanging().y).toBeLessThan(-0.95);
  });

  it('builds lighter at lower quality: fewer triangles, plain materials at Low', () => {
    const tris = (a: Avatar) => {
      let n = 0;
      a.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) n += (m.geometry.index ? m.geometry.index.count : m.geometry.getAttribute('position').count) / 3;
      });
      return n;
    };
    for (const s of ['allround', 'wheelchair'] as const) {
      const [low, mid, high] = ([0, 1, 2] as const).map((d) => new Avatar(s, 1, 0, d));
      expect(tris(low), s).toBeLessThan(tris(mid));
      expect(tris(mid), s).toBeLessThan(tris(high));
      const physical = (a: Avatar) => skins(a).some((m) => (m.material as THREE.MeshPhysicalMaterial).isMeshPhysicalMaterial);
      expect(physical(low), s).toBe(false);
      expect(physical(high), s).toBe(true);
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

  /** A bat held with the forehand rubber facing `n` (blade up), as the game does it. */
  const bat = (n: [number, number, number], wing: 'forehand' | 'backhand', towardBody = 0) =>
    gripQuaternion(bladeQuaternion({ x: n[0], y: n[1], z: n[2] }, towardBody), wing);

  it('holds the paddle handle in the hand, turned with the bat, and reaches no further than a straight arm', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      const side = STYLES[s].leftHanded ? -1 : 1;
      const grip = a.group.getObjectByName('grip')!;
      for (const [h, q] of [
        [[0.38, 1.0, -0.38], bat([-0.2, 0.1, -1], 'forehand')],
        [[0.7, 0.9, -0.3], bat([-0.4, 0.2, -1], 'forehand', -0.3)],
        [[-0.2, 1.0, -0.45], bat([0.2, 0.1, -1], 'backhand', 0.2)],
        [[0.4, 1.6, -0.2], bat([0, -0.3, -1], 'forehand')],
        [[0.45, 0.45, -0.5], undefined],
      ] as [[number, number, number], THREE.Quaternion | undefined][]) {
        const target = pose(a, [h[0] * side, h[1], h[2]], { grip: q });
        // The wrist is where the arm reaches; the grip (the middle of the handle in the hand) is on the handle.
        const wrist = worldPos(a.rig.arm.hand);
        const shoulder = worldPos(a.rig.arm.upper);
        const reach = ARM_MAX * a.group.scale.y;
        const wristToHandle = target.distanceTo(wrist);
        expect(wristToHandle, s).toBeGreaterThan(0.05);
        expect(wristToHandle, s).toBeLessThan(0.14);
        if (shoulder.distanceTo(wrist) < reach - 1e-4) {
          expect(worldPos(grip).distanceTo(target), `${s} ${h}`).toBeLessThan(1e-3);
          // The hand turns with the bat: the handle runs the same way in the hand as in the bat.
          if (q) {
            const handle = new THREE.Vector3(0, 1, 0).transformDirection(grip.matrixWorld);
            expect(handle.dot(new THREE.Vector3(0, 1, 0).applyQuaternion(q)), `${s} ${h}`).toBeGreaterThan(0.999);
          }
        } else expect(shoulder.distanceTo(wrist), `${s} ${h}`).toBeCloseTo(reach, 3);
      }
    }
  });

  it('a ball out of reach is followed, not reached', () => {
    const a = new Avatar('allround', 1, 0);
    const target = pose(a, [1.6, 1.0, -0.3]);
    const wrist = worldPos(a.rig.arm.hand);
    expect(wrist.distanceTo(target)).toBeGreaterThan(0.2);
    expect(wrist.distanceTo(worldPos(a.rig.arm.upper))).toBeCloseTo(ARM_MAX * a.group.scale.y, 3);
    // Straight toward it.
    const toBall = target.clone().sub(worldPos(a.rig.arm.upper)).normalize();
    expect(wrist.clone().sub(worldPos(a.rig.arm.upper)).normalize().dot(toBall)).toBeGreaterThan(0.99);
  });

  it('hangs everything on the head from the head joint, so a head can be turned or swapped whole', () => {
    for (const s of AVATAR_STYLES) {
      const a = new Avatar(s, 1, 0);
      const onHead = new Set<THREE.Object3D>();
      a.rig.head.traverse((o) => onHead.add(o));
      let headPoints = 0;
      // The skin is built standing at height scale 1: everything above the neck must go with the head.
      for (const m of skins(a)) {
        const pos = m.geometry.getAttribute('position');
        const idx = m.geometry.getAttribute('skinIndex');
        const wt = m.geometry.getAttribute('skinWeight');
        for (let i = 0; i < pos.count; i++) {
          if (pos.getY(i) < HEAD_PIVOT.y + 0.02) continue;
          let w = 0;
          for (let k = 0; k < 4; k++) if (onHead.has(m.skeleton.bones[idx.getComponent(i, k)])) w += wt.getComponent(i, k);
          expect(w, `${s}: a point at ${pos.getY(i).toFixed(3)} m is not on the head`).toBeGreaterThan(0.99);
          headPoints++;
        }
      }
      expect(headPoints, s).toBeGreaterThan(1000);
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
    const faceUp = (m: THREE.SkinnedMesh) => {
      a.group.updateMatrixWorld(true);
      m.skeleton.update();
      const out: THREE.Vector3[] = [];
      const pos = m.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 7) if (pos.getY(i) > HEAD_PIVOT.y + 0.03) out.push(m.getVertexPosition(i, new THREE.Vector3()));
      return out;
    };
    const before = skins(a).flatMap(faceUp);
    a.rig.head.rotation.y = 0.6;
    const after = skins(a).flatMap(faceUp);
    expect(before.length).toBeGreaterThan(100);
    const moved = before.filter((p, i) => p.distanceTo(after[i]) > 0.005).length;
    // Nearly everything on the head swings round (only points near the turning axis stay put).
    expect(moved / before.length).toBeGreaterThan(0.8);
  });

});
