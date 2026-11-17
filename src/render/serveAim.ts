import * as THREE from 'three';
import { TABLE } from '../physics';

const COLOR = 0xffd34d;
/** How long the aim ring stays after a serve (s). */
const RING_TIME = 1.6;

/** After a serve: a ring where it was aimed, fading out, to compare with where it landed. */
export class ServeAimView {
  private ring: THREE.Mesh;
  private ringAt = -Infinity;

  constructor(scene: THREE.Scene) {
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(0.06, 0.08, 40),
      new THREE.MeshBasicMaterial({ color: COLOR, transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.renderOrder = 5;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  /** Show the aim ring at (x, z) for a moment. */
  showAim(x: number, z: number) {
    this.ring.position.set(x, TABLE.height + 0.004, z);
    this.ringAt = performance.now() / 1000;
  }

  update() {
    const age = performance.now() / 1000 - this.ringAt;
    this.ring.visible = age < RING_TIME;
    if (this.ring.visible) (this.ring.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - Math.max(0, age - RING_TIME * 0.5) / (RING_TIME * 0.5));
  }
}
