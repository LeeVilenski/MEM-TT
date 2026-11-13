import * as THREE from 'three';
import type { StyleId } from '../game/styles';

/**
 * Low-poly IT-office characters, built from primitives. One look per player style,
 * with an arm that reaches from the shoulder to the paddle handle each frame.
 */
interface Look {
  shirt: number;
  trousers: number;
  skin: number;
  hair: number;
  accessory: (g: THREE.Group, mat: (c: number) => THREE.Material) => void;
}

const LOOKS: Record<StyleId, Look> = {
  // Helpdesk Hero: blue polo and a headset with a mic boom.
  allround: {
    shirt: 0x2f6fd6,
    trousers: 0x3b3f4a,
    skin: 0xe0b089,
    hair: 0x4a3222,
    accessory: (g, m) => {
      const band = new THREE.Mesh(new THREE.TorusGeometry(0.115, 0.012, 6, 16, Math.PI), m(0x111827));
      band.position.y = 1.66;
      band.rotation.y = Math.PI / 2;
      const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.12, 6), m(0x111827));
      mic.position.set(0.1, 1.55, -0.05);
      mic.rotation.x = Math.PI / 2.4;
      g.add(band, mic);
    },
  },
  // Full-Stack Dev: charcoal hoodie (with hood) and headphones round the neck.
  looper: {
    shirt: 0x374151,
    trousers: 0x1e3a5f,
    skin: 0xc68d63,
    hair: 0x1f1a17,
    accessory: (g, m) => {
      const hood = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.05, 8, 16), m(0x374151));
      hood.position.set(0, 1.42, 0.06);
      hood.rotation.x = Math.PI / 2.2;
      const phones = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.018, 6, 16), m(0xe8562a));
      phones.position.set(0, 1.44, -0.02);
      phones.rotation.x = Math.PI / 2;
      g.add(hood, phones);
    },
  },
  // Sysadmin: black band t-shirt, beard, lanyard with an access badge.
  chopper: {
    shirt: 0x111111,
    trousers: 0x3f3f46,
    skin: 0xe7c2a0,
    hair: 0x6b4a2f,
    accessory: (g, m) => {
      const beard = new THREE.Mesh(new THREE.SphereGeometry(0.085, 10, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), m(0x6b4a2f));
      beard.position.set(0, 1.55, -0.03);
      const lanyard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.01), m(0xe8562a));
      lanyard.position.set(0, 1.28, -0.16);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.01), m(0xffffff));
      badge.position.set(0, 1.12, -0.165);
      g.add(beard, lanyard, badge);
    },
  },
  // Security Analyst: navy suit, sunglasses, earpiece.
  blocker: {
    shirt: 0x1e293b,
    trousers: 0x0f172a,
    skin: 0x8d5a3b,
    hair: 0x0b0b0b,
    accessory: (g, m) => {
      const shades = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.03), m(0x050505));
      shades.position.set(0, 1.64, -0.1);
      const ear = new THREE.Mesh(new THREE.SphereGeometry(0.015, 6, 6), m(0xd1d5db));
      ear.position.set(0.11, 1.62, 0);
      const tie = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.22, 0.01), m(0xb91c1c));
      tie.position.set(0, 1.3, -0.16);
      g.add(shades, ear, tie);
    },
  },
  // Network Engineer: hi-vis vest, cap, a coil of blue patch cable on the shoulder.
  penhold: {
    shirt: 0xf97316,
    trousers: 0x334155,
    skin: 0xf0c9a5,
    hair: 0x2a1f1a,
    accessory: (g, m) => {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), m(0x1d4ed8));
      cap.position.y = 1.7;
      const peak = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.01, 0.1), m(0x1d4ed8));
      peak.position.set(0, 1.7, -0.12);
      const coil = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.015, 6, 16), m(0x2563eb));
      coil.position.set(-0.17, 1.38, 0);
      coil.rotation.y = Math.PI / 2;
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.37, 0.04, 0.27), m(0xe5e7eb));
      stripe.position.y = 1.12;
      g.add(cap, peak, coil, stripe);
    },
  },
};

export class Avatar {
  readonly group = new THREE.Group();
  private arm: THREE.Mesh;
  private materials: THREE.MeshStandardMaterial[] = [];
  /** Everything except the racket arm (hidden in first person). */
  private bodyParts: THREE.Object3D[] = [];

  constructor(style: StyleId, opacity = 1) {
    const look = LOOKS[style];
    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
      this.materials.push(m);
      return m;
    };
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set(x, y, z);
      m.castShadow = opacity >= 1;
      this.group.add(m);
      return m;
    };
    // Legs, torso, shoulders, neck, head, hair.
    add(new THREE.BoxGeometry(0.13, 0.82, 0.16), look.trousers, -0.09, 0.41, 0);
    add(new THREE.BoxGeometry(0.13, 0.82, 0.16), look.trousers, 0.09, 0.41, 0);
    add(new THREE.BoxGeometry(0.36, 0.58, 0.24), look.shirt, 0, 1.12, 0);
    add(new THREE.SphereGeometry(0.06, 8, 6), look.skin, 0, 1.46, 0);
    add(new THREE.SphereGeometry(0.11, 14, 10), look.skin, 0, 1.6, 0);
    const hair = add(new THREE.SphereGeometry(0.115, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.2), look.hair, 0, 1.62, 0.01);
    hair.rotation.x = 0.15;
    // Free arm hanging down.
    const free = add(new THREE.CylinderGeometry(0.04, 0.035, 0.55, 8), look.shirt, -0.22, 1.1, 0);
    free.rotation.z = -0.15;
    look.accessory(this.group, mat);
    this.bodyParts = [...this.group.children];
    // Racket arm: a cylinder stretched from shoulder to hand every frame.
    this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 1, 8).translate(0, 0.5, 0), mat(look.shirt));
    this.arm.castShadow = opacity >= 1;
    this.group.add(this.arm);
  }

  /**
   * Place the character. body: floor position; hand: world position of the paddle
   * handle; facingNegZ: true for a player at the near end looking down the table.
   */
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean) {
    this.group.position.set(body.x, 0, body.z);
    this.group.rotation.y = facingNegZ ? 0 : Math.PI;
    this.group.updateMatrixWorld();
    // Shoulder on the paddle side.
    const local = this.group.worldToLocal(hand.clone());
    const shoulder = new THREE.Vector3(local.x >= 0 ? 0.2 : -0.2, 1.36, 0);
    const d = local.clone().sub(shoulder);
    const len = Math.min(0.75, d.length());
    this.arm.position.copy(shoulder);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.arm.scale.set(1, len, 1);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** First person: only the racket arm is drawn (the camera is behind the head). */
  setFirstPerson(on: boolean) {
    for (const p of this.bodyParts) p.visible = !on;
    // See-through racket arm in first person so it never hides the ball.
    const m = this.arm.material as THREE.MeshStandardMaterial;
    m.transparent = on;
    m.opacity = on ? 0.45 : 1;
    m.depthWrite = !on;
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
