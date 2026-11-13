import * as THREE from 'three';
import { PADDLE, UP, cross, dot, normalize, scale, sub, type Vec3 } from '../physics';
import type { Player } from '../game/player';

const RED = 0xc8202a;
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
  private marker: THREE.Mesh;
  private markerLine: THREE.Line;
  private shadow: THREE.Mesh;

  constructor(scene: THREE.Scene) {
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
    const blade = new THREE.Group();
    blade.add(this.faceFront, this.faceBack, core, handle);
    blade.scale.set(1, 1.06, 1);
    blade.traverse((o) => (o.castShadow = true));
    this.paddle.add(blade);
    scene.add(this.paddle);

    // Body: a faint torso only (the camera sits just above and behind the head), so it
    // gives a sense of position without ever hiding the ball.
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0x6b7280, transparent: true, opacity: 0.16, roughness: 0.8, depthWrite: false });
    const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.6, 6, 16), bodyMat);
    torso.position.y = 0.9;
    this.body.add(torso);
    scene.add(this.body);

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

  set visible(v: boolean) {
    this.paddle.visible = v;
    this.body.visible = v;
    this.shadow.visible = v;
    if (!v) this.setMarker(null);
  }

  setMarker(p: Vec3 | null) {
    this.marker.visible = !!p;
    this.markerLine.visible = !!p;
    if (!p) return;
    this.marker.position.set(p.x, p.y, p.z);
    this.markerLine.position.set(p.x, p.y, p.z);
    this.markerLine.scale.y = p.y;
    this.markerLine.computeLineDistances();
  }

  update(player: Player) {
    const pose = player.swing.pose;
    const n = pose.normal;
    // Blade frame: local +z = face normal, local +y = "up" along the blade toward its tip.
    let up = sub(UP, scale(n, dot(UP, n)));
    up = normalize(up);
    // Tilt the blade so the handle points back toward the player's hand.
    const towardBody = player.body.x - pose.pos.x;
    const right = normalize(cross(up, n));
    const tilt = Math.max(-0.9, Math.min(0.9, towardBody * 1.6));
    const tipUp = normalize({ x: up.x - right.x * tilt, y: up.y - right.y * tilt, z: up.z - right.z * tilt });
    const x = normalize(cross(tipUp, n));
    const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(x.x, x.y, x.z), new THREE.Vector3(tipUp.x, tipUp.y, tipUp.z), new THREE.Vector3(n.x, n.y, n.z));
    this.paddle.quaternion.setFromRotationMatrix(m);
    // Draw the stroke's forward lunge (contact itself happens at the rest plane).
    this.paddle.position.set(pose.pos.x, pose.pos.y, pose.pos.z - player.swing.forward * 0.6);

    // The hitting face shows the rubber colour for the current wing (red forehand, black backhand).
    const fh = player.swing.side === 'forehand';
    (this.faceFront.material as THREE.MeshStandardMaterial).color.set(fh ? RED : BLACK);
    (this.faceBack.material as THREE.MeshStandardMaterial).color.set(fh ? BLACK : RED);

    this.body.position.set(player.body.x, 0, player.body.z);
    this.shadow.position.set(player.body.x, 0.002, player.body.z);
  }
}

