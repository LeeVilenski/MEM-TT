import * as THREE from 'three';
import { STYLES, type StyleId } from '../game/styles';
import { PADDLE, type Vec3 } from '../physics';
import { Avatar, AVATAR_STYLES, type Detail } from './avatar';

/** Where a spectator stands, in the venue's frame (floor at y = 0, table at the origin). */
export interface SpectatorSpot {
  x: number;
  z: number;
  /** Holding a bat at their side (waiting for a game), rather than empty-handed. */
  bat?: boolean;
  /** How far they lean on their feet (0–1): a little variety in how people stand. */
  sway?: number;
}

/**
 * Colleagues watching the game: characters standing round the table who follow the
 * ball with their eyes and head, and react to a good rally. They're added to the venue's
 * group, so they turn with it when the players change ends.
 */
export class Spectators {
  readonly group = new THREE.Group();
  private people: { spot: SpectatorSpot; holder: THREE.Group; avatar: Avatar; style: StyleId; bat: THREE.Group | null; phase: number; reactAt: number | null }[] = [];
  private gaze = new THREE.Vector3();
  private hand = new THREE.Vector3();
  private grip = new THREE.Quaternion();
  private gripLocal: THREE.Quaternion[] = [];
  private time = 0;

  constructor(
    spots: SpectatorSpot[],
    avoid: string[],
    private detail: Detail,
  ) {
    this.group.name = 'spectators';
    // Bat hanging at the side: the handle in the hand, blade down, forehand rubber facing out.
    // Bat frame: x across the blade, y up the handle to the blade, z out of the forehand.
    for (const side of [1, -1]) {
      const y = new THREE.Vector3(0, -1, 0);
      const z = new THREE.Vector3(side, 0, 0);
      const x = new THREE.Vector3().crossVectors(y, z);
      this.gripLocal.push(new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)));
    }
    const pool = this.pickStyles(avoid, spots.length);
    spots.forEach((spot, i) => this.add(spot, pool[i], i));
  }

  /** Spectator characters: anyone not playing right now, in a fixed order so each venue looks the same. */
  private pickStyles(avoid: string[], n: number): StyleId[] {
    const all = (AVATAR_STYLES as readonly StyleId[]).filter((s) => !avoid.includes(s));
    const order = [3, 5, 1, 6, 0, 4, 2, 7, 8];
    const picked: StyleId[] = [];
    for (const k of order) if (all[k % all.length] && !picked.includes(all[k % all.length])) picked.push(all[k % all.length]);
    for (const s of all) if (!picked.includes(s)) picked.push(s);
    return Array.from({ length: n }, (_, i) => picked[i % picked.length]);
  }

  private add(spot: SpectatorSpot, style: StyleId, i: number) {
    const holder = new THREE.Group();
    holder.position.set(spot.x, 0, spot.z);
    // Face the table: local −z towards the origin.
    holder.rotation.y = Math.atan2(spot.x, spot.z);
    this.group.add(holder);
    const avatar = new Avatar(style, 1, i, this.detail);
    avatar.rig.relaxed = true;
    holder.add(avatar.group);
    let bat: THREE.Group | null = null;
    if (spot.bat) {
      bat = makeBat();
      holder.add(bat);
    }
    this.people.push({ spot, holder, avatar, style, bat, phase: i * 1.7, reactAt: null });
  }

  /** Rebuild anyone now playing (a new opponent), so no one watches themselves. */
  avoid(styles: string[]) {
    if (!this.people.some((p) => styles.includes(p.style))) return;
    const taken = this.people.map((p) => p.style);
    const free = this.pickStyles([...styles, ...taken], this.people.length);
    this.people.forEach((p, i) => {
      if (!styles.includes(p.style)) return;
      p.holder.remove(p.avatar.group);
      p.avatar.dispose();
      p.style = free[i % free.length];
      p.avatar = new Avatar(p.style, 1, i, this.detail);
      p.avatar.rig.relaxed = true;
      p.holder.add(p.avatar.group);
    });
  }

  /** A good rally or a big point: some of them hop and punch the air, one after another. */
  cheer(strength = 1) {
    this.people.forEach((p, i) => {
      if (Math.random() < 0.35 + 0.6 * strength) p.reactAt = this.time + 0.15 + i * 0.12 + Math.random() * 0.25;
    });
  }

  /** Per frame: `ball` in world coordinates (null when there's no ball in play). */
  update(dt: number, ball: Vec3 | null) {
    this.time += dt;
    const now = this.time;
    for (const p of this.people) {
      const side = STYLES[p.style].leftHanded ? -1 : 1;
      if (p.reactAt !== null && now >= p.reactAt) {
        p.avatar.react('celebrate');
        p.reactAt = null;
      }
      // Watch the ball; with none in play, glance about over the table.
      if (ball) this.gaze.set(ball.x, ball.y, ball.z);
      else this.group.localToWorld(this.gaze.set(Math.sin(now * 0.3 + p.phase) * 0.8, 0.9, Math.sin(now * 0.17 + p.phase) * 1.2));
      // The bat hand hangs by the thigh (in the character's frame), swaying a little.
      const sway = Math.sin(now * 0.9 + p.phase) * 0.012;
      this.hand.set(side * 0.24, 0.78 + sway, 0.02);
      p.holder.localToWorld(this.hand);
      p.holder.updateMatrixWorld();
      const holderQ = p.holder.getWorldQuaternion(new THREE.Quaternion());
      this.grip.copy(holderQ).multiply(this.gripLocal[side > 0 ? 0 : 1]);
      p.avatar.update({ x: 0, z: 0 }, this.hand, true, { now, gaze: this.gaze, grip: this.grip });
      if (p.bat) {
        p.bat.position.copy(p.holder.worldToLocal(this.hand.clone()));
        p.bat.quaternion.copy(this.gripLocal[side > 0 ? 0 : 1]);
      }
    }
  }

  dispose() {
    for (const p of this.people) {
      p.avatar.dispose();
      p.bat?.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.isMesh) {
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
      });
    }
    this.group.removeFromParent();
  }
}

/** A plain bat: the handle centred on the origin, the blade along +y, the red rubber facing +z. */
function makeBat(): THREE.Group {
  const g = new THREE.Group();
  const disc = new THREE.CylinderGeometry(PADDLE.radius, PADDLE.radius, 0.012, 32).rotateX(Math.PI / 2);
  const blade = new THREE.Mesh(disc, [new THREE.MeshStandardMaterial({ color: 0x2a2420, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.45 }), new THREE.MeshStandardMaterial({ color: 0x1b1c21, roughness: 0.45 })]);
  blade.position.y = 0.045 + PADDLE.radius;
  blade.scale.set(1, 1.06, 1);
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.024), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }));
  g.add(blade, handle);
  g.traverse((o) => (o.castShadow = true));
  return g;
}
