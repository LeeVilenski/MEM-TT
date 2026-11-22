import * as THREE from 'three';
import { PADDLE, TABLE, UP, add, cross, dot, length, normalize, scale, sub, v3, type Vec3 } from '../physics';
import type { Player } from '../game/player';
import type { StrokeSide } from '../game/swing';
import type { PaddlePose } from '../physics';
import type { StyleId } from '../game/styles';
import { Avatar, type Reaction } from './avatar';

const RED = 0xc8202a;
/** The ring turns gold this long (s) before contact: flick now for a perfect stroke. */
const PERFECT_RING = 0.06;
const BLACK = 0x15161a;
/** Hit-zone colours: yours, and your doubles partner's turn. */
const MINE = 0x5eead4;
const PARTNER = 0x60a5fa;
/** The ring turns red when the ball will be high enough to smash. */
const SMASHABLE = 0xff4d6d;
/** Contact height above the table (m) from which the ring shows a ball as smashable. */
const SMASH_HEIGHT = 0.3;
/** The drawn backswing starts this long (game s) before the ball arrives, and reaches the contact point on time. */
const WIND_UP = 0.2;
/** Follow-through after contact: out along the stroke, then back (real s). */
const FOLLOW_OUT = 0.12;
const FOLLOW_TIME = 0.42;

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

  private paddleMaterials: THREE.MeshStandardMaterial[] = [];
  /** Opacity of the character (a doubles partner on your side is drawn see-through). */
  private avatarOpacity = 1;

  constructor(scene: THREE.Scene, opts: { bodyColor?: number; bodyOpacity?: number; marker?: boolean; style?: StyleId; avatarOpacity?: number } = {}) {
    this.avatarOpacity = opts.avatarOpacity ?? 1;
    // Blade: two thin discs (one per rubber) around a wooden core, slightly oval.
    const disc = new THREE.CylinderGeometry(PADDLE.radius, PADDLE.radius, 0.002, 40);
    disc.rotateX(Math.PI / 2); // face along ±z
    // Slightly see-through so the blade never completely hides the ball at contact.
    const mk = (color: number) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 0.6, transparent: true, opacity: 0.78 });
      this.paddleMaterials.push(m);
      return m;
    };
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
  /** Where the character's eyes go (the ball), if anywhere. */
  private gazeSource: (() => Vec3 | null) | null = null;
  private gaze = new THREE.Vector3();

  /** Have the character watch something (the ball): asked for its position each frame; null when there's nothing to see. */
  watch(source: () => Vec3 | null) {
    this.gazeSource = source;
  }

  /** The local player's own view: draw only the racket arm, not the body in front of the camera. */
  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    this.avatar?.setFirstPerson(on);
  }

  /** Show this player as a style's character (replacing the plain torso). */
  setStyle(style: StyleId, avatarOpacity = this.avatarOpacity) {
    this.avatarOpacity = avatarOpacity;
    if (this.avatar) {
      this.body.remove(this.avatar.group);
      this.avatar.dispose();
    }
    this.avatar = new Avatar(style, this.avatarOpacity);
    this.avatar.setFirstPerson(this.firstPerson);
    this.body.add(this.avatar.group);
    this.body.getObjectByName('torso')!.visible = false;
  }

  /**
   * Fade a see-through character (a doubles partner) by how close it is to the camera:
   * gone when right in front of it, faint up close, at its usual see-through level further off.
   */
  fadeNear(camera: { x: number; y: number; z: number }) {
    if (!this.avatar || this.avatarOpacity >= 1 || !this.last) return;
    const b = this.last.body;
    const d = Math.hypot(b.x - camera.x, b.z - camera.z);
    const k = Math.max(0, Math.min(1, (d - 0.9) / 1.2));
    this.avatar.setOpacity(this.avatarOpacity * k);
    for (const m of this.paddleMaterials) m.opacity = 0.78 * Math.max(0.15, k);
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
  setMarker(p: Vec3 | null, eta?: number, partner = false) {
    this.marker.visible = !!p;
    this.markerLine.visible = !!p;
    if (!p) return;
    const mat = this.marker.material as THREE.MeshBasicMaterial;
    const base = p.y - TABLE.height >= SMASH_HEIGHT ? SMASHABLE : MINE;
    if (eta !== undefined && Number.isFinite(eta)) {
      const k = Math.max(0, Math.min(1, eta / 0.5));
      this.marker.scale.setScalar(1 + 1.6 * k);
      mat.color.set(partner ? PARTNER : eta <= PERFECT_RING ? 0xffc83d : base);
    } else {
      this.marker.scale.setScalar(1);
      mat.color.set(partner ? PARTNER : base);
    }
    (this.markerLine.material as THREE.LineDashedMaterial).color.set(partner ? PARTNER : base);
    this.marker.position.set(p.x, p.y, p.z);
    this.markerLine.position.set(p.x, p.y, p.z);
    this.markerLine.scale.y = p.y;
    this.markerLine.computeLineDistances();
  }

  /** Drawn stroke offset from the physics pose (smoothed), and the current follow-through. */
  private strokeOffset: Vec3 = v3();
  private follow: { at: number; dir: Vec3; len: number } | null = null;

  /**
   * The ball was just struck: draw a follow-through along the stroke. The bat is drawn
   * at the contact point at the moment of contact, so it meets the ball rather than
   * passing through it.
   */
  strike(paddleVel: Vec3) {
    const sp = length(paddleVel);
    if (sp < 0.3) return; // a block: no follow-through
    this.follow = { at: performance.now() / 1000, dir: scale(paddleVel, 1 / sp), len: Math.min(0.38, 0.1 + sp * 0.035) };
    this.strokeOffset = v3();
  }

  update(player: Player) {
    // Contact always happens at the physics pose (the rest plane, where the ring is). The
    // drawn stroke is timed around it: a wind-up that arrives at the contact point just
    // as the ball does, then a follow-through. Away from contact (a shadow stroke), the
    // bat lunges forward with the flick so swings still feel responsive.
    const now = performance.now() / 1000;
    const vel = player.swing.pose.vel;
    const sp = length(vel);
    const eta = player.interceptEta;
    let target: Vec3;
    let exact = false;
    const f = this.follow;
    if (f && now - f.at < FOLLOW_TIME) {
      const u = (now - f.at) / FOLLOW_TIME;
      const out = FOLLOW_OUT / FOLLOW_TIME;
      const amount = u < out ? Math.sin(((u / out) * Math.PI) / 2) : 0.5 + 0.5 * Math.cos(((u - out) / (1 - out)) * Math.PI);
      target = scale(f.dir, f.len * amount);
      exact = true;
    } else {
      this.follow = null;
      if (Number.isFinite(eta) && eta < WIND_UP && eta > -0.05) {
        // Wind-up: back along the live stroke, closing to zero at contact.
        const k = Math.max(0, eta) / WIND_UP;
        target = sp > 0.5 ? scale(vel, (-Math.min(0.14, sp * 0.025) * k) / sp) : v3();
        exact = eta < 0.06;
      } else {
        const n = player.swing.pose.normal;
        target = v3(n.x * player.swing.forward, 0, n.z * player.swing.forward);
      }
    }
    // Ease between modes, but be exact close to contact and during the follow-through.
    const k = exact ? 1 : 1 - Math.exp(-(now - this.lastUpdate) * 30);
    this.lastUpdate = now;
    this.strokeOffset = add(this.strokeOffset, scale(sub(target, this.strokeOffset), Math.min(1, k)));
    this.updatePose({ ...player.swing.pose, pos: add(player.swing.visualPos, this.strokeOffset) }, player.body, player.swing.side, 0);
  }

  private lastUpdate = performance.now() / 1000;

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
      const g = this.gazeSource?.() ?? null;
      this.avatar.update(bodyPos, hand, bodyPos.z >= 0, { gaze: g && this.gaze.set(g.x, g.y, g.z) });
    } else this.body.position.set(bodyPos.x, 0, bodyPos.z);
    this.shadow.position.set(bodyPos.x, 0.002, bodyPos.z);
  }
}

