import * as THREE from 'three';
import { PADDLE, UP, cross, dot, normalize, scale, sub, type Vec3 } from '../physics';
import type { Player } from '../game/player';
import type { StrokeSide } from '../game/swing';
import type { PaddlePose } from '../physics';
import type { StyleId } from '../game/styles';
import { Avatar, type Reaction } from './avatar';

const RED = 0xc8202a;
/** The ring turns gold this long (s) before contact: flick now for a perfect stroke. */
const PERFECT_RING = 0.06;
const BLACK = 0x15161a;

/**
 * Paddle + simple body avatar, plus the intercept marker that shows where the
 * incoming ball will reach the hitting plane.
 */
export class PlayerView {
  private paddle = new THREE.Group();
  private faceFront: THREE.Mesh;
  private faceBack: THREE.Mesh;
  private body = new THREE.Group();
  private avatar: Avatar | null = null;
  private handle: THREE.Object3D;
  private marker: THREE.Mesh;
  private markerLine: THREE.Line;
  private shadow: THREE.Mesh;

  constructor(scene: THREE.Scene, opts: { bodyColor?: number; bodyOpacity?: number; marker?: boolean; style?: StyleId } = {}) {
    // Blade: two thin discs (one per rubber) around a wooden core, slightly oval.
    const disc = new THREE.CylinderGeometry(PADDLE.radius, PADDLE.radius, 0.002, 40);
    disc.rotateX(Math.PI / 2); // face along ±z
    // Slightly see-through so the blade never completely hides the ball at contact.
    const mk = (color: number) => new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.78 });
    this.faceFront = new THREE.Mesh(disc, mk(RED));
    this.faceFront.position.z = 0.0045;
    this.faceBack = new THREE.Mesh(disc, mk(BLACK));
    this.faceBack.position.z = -0.0045;
    const core = new THREE.Mesh(new THREE.CylinderGeometry(PADDLE.radius - 0.002, PADDLE.radius - 0.002, 0.007, 40).rotateX(Math.PI / 2), mk(0xd8b07a));
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.024), mk(0x8a5a2b));
    handle.position.y = -PADDLE.radius - 0.045;
    handle.name = 'handle';
    this.handle = handle;
    const blade = new THREE.Group();
    blade.add(this.faceFront, this.faceBack, core, handle);
    blade.scale.set(1, 1.06, 1);
    blade.traverse((o) => (o.castShadow = true));
    this.paddle.add(blade);
    scene.add(this.paddle);

    // Body: a faint torso only (the camera sits just above and behind the head), so it
    // gives a sense of position without ever hiding the ball.
    const bodyMat = new THREE.MeshStandardMaterial({ color: opts.bodyColor ?? 0x6b7280, transparent: true, opacity: opts.bodyOpacity ?? 0.16, roughness: 0.8, depthWrite: false });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 6, 16), bodyMat);
    torso.position.y = 0.9;
    torso.name = 'torso';
    this.body.add(torso);
    scene.add(this.body);
    if (opts.style) this.setStyle(opts.style);

    this.shadow = new THREE.Mesh(new THREE.CircleGeometry(0.28, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.25 }));
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.position.y = 0.002;
    scene.add(this.shadow);

    // Intercept marker: a ring in the hitting plane, plus a drop line to the floor for depth.
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.05, 0.062, 32),
      new THREE.MeshBasicMaterial({ color: 0x5eead4, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthTest: false }),
    );
    this.marker.renderOrder = 10;
    scene.add(this.marker);
    this.markerLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(0, -1, 0)]),
      new THREE.LineDashedMaterial({ color: 0x5eead4, dashSize: 0.03, gapSize: 0.03, transparent: true, opacity: 0.5 }),
    );
    scene.add(this.markerLine);
    this.setMarker(null);
  }

  private firstPerson = false;

  /** The local player's own view: draw only the racket arm, not the body in front of the camera. */
  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    this.avatar?.setFirstPerson(on);
  }

  /** Show this player as a style's character (replacing the plain torso). */
  setStyle(style: StyleId) {
    if (this.avatar) {
      this.body.remove(this.avatar.group);
      this.avatar.dispose();
    }
    this.avatar = new Avatar(style, 1);
    this.avatar.setFirstPerson(this.firstPerson);
    this.body.add(this.avatar.group);
    this.body.getObjectByName('torso')!.visible = false;
  }

  /** A short body-language reaction to a point (no-op for the plain torso). */
  react(kind: Reaction) {
    this.avatar?.react(kind);
  }

  set visible(v: boolean) {
    this.paddle.visible = v;
    this.body.visible = v;
    this.shadow.visible = v;
    if (!v) this.setMarker(null);
  }

  /**
   * Show the intercept ring at `p`. With `eta` (seconds until the ball arrives), it is a
   * timing ring: it shrinks onto the ball as it arrives and turns gold in the
   * perfect-timing window.
   */
  setMarker(p: Vec3 | null, eta?: number) {
    this.marker.visible = !!p;
    this.markerLine.visible = !!p;
    if (!p) return;
    const mat = this.marker.material as THREE.MeshBasicMaterial;
    if (eta !== undefined && Number.isFinite(eta)) {
      const k = Math.max(0, Math.min(1, eta / 0.5));
      this.marker.scale.setScalar(1 + 1.6 * k);
      mat.color.set(eta <= PERFECT_RING ? 0xffc83d : 0x5eead4);
    } else {
      this.marker.scale.setScalar(1);
      mat.color.set(0x5eead4);
    }
    this.marker.position.set(p.x, p.y, p.z);
    this.markerLine.position.set(p.x, p.y, p.z);
    this.markerLine.scale.y = p.y;
    this.markerLine.computeLineDistances();
  }

  update(player: Player) {
    // Draw the paddle where the mouse put it (the contact point may be pinned during a flick).
    this.updatePose({ ...player.swing.pose, pos: player.swing.visualPos }, player.body, player.swing.side, player.swing.forward);
  }

  /** Generic update (used for AI players too). Pose and body in world coordinates. */
  /** What was drawn last (for replays). */
  last: { pose: PaddlePose; body: { x: number; z: number }; wing: StrokeSide; forward: number } | null = null;

  get isVisible() {
    return this.paddle.visible;
  }

  updatePose(pose: PaddlePose, bodyPos: { x: number; z: number }, wing: StrokeSide, forward = 0) {
    this.last = { pose, body: bodyPos, wing, forward };
    const n = pose.normal;
    // Blade frame: local +z = face normal, local +y = "up" along the blade toward its tip.
    let up = sub(UP, scale(n, dot(UP, n)));
    up = normalize(up);
    // Tilt the blade so the handle points back toward the player's hand.
    const towardBody = bodyPos.x - pose.pos.x;
    const right = normalize(cross(up, n));
    const tilt = Math.max(-0.9, Math.min(0.9, towardBody * 1.6));
    const tipUp = normalize({ x: up.x - right.x * tilt, y: up.y - right.y * tilt, z: up.z - right.z * tilt });
    const x = normalize(cross(tipUp, n));
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(tipUp.x, tipUp.y, tipUp.z), new THREE.Vector3(n.x, n.y, n.z));
    this.paddle.quaternion.setFromRotationMatrix(m);
    // Draw the stroke's forward lunge along the face normal (contact itself happens at the rest plane).
    this.paddle.position.set(pose.pos.x + n.x * forward, pose.pos.y, pose.pos.z + n.z * forward);

    // The hitting face shows the rubber colour for the current wing (red forehand, black backhand).
    const fh = wing === 'forehand';
    (this.faceFront.material as THREE.MeshStandardMaterial).color.set(fh ? RED : BLACK);
    (this.faceBack.material as THREE.MeshStandardMaterial).color.set(fh ? BLACK : RED);

    if (this.avatar) {
      // The body group stays at the origin; the avatar places itself and reaches for the handle.
      this.body.position.set(0, 0, 0);
      this.paddle.updateMatrixWorld(true);
      const hand = new THREE.Vector3();
      this.handle.getWorldPosition(hand);
      this.avatar.update(bodyPos, hand, bodyPos.z >= 0);
    } else this.body.position.set(bodyPos.x, 0, bodyPos.z);
    this.shadow.position.set(bodyPos.x, 0.002, bodyPos.z);
  }
}

