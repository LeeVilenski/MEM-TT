import * as THREE from 'three';
import type { StyleId } from '../game/styles';

/**
 * Low-poly characters, built from primitives. One look per player style; four are
 * modelled on real people (Lee, Ed, Ryan, Will) from their clothes, hair and build.
 * An arm reaches from the shoulder to the paddle handle each frame.
 */
type Mat = (c: number) => THREE.Material;

interface Look {
  shirt: number;
  /** Sleeve colour (defaults to the shirt), or 'none' for a vest (bare arms). */
  sleeves?: number | 'none';
  /** Long sleeves cover the whole arm; short ones the upper arm. */
  longSleeves?: boolean;
  /** Shorts (bare lower legs) or full-length trousers. */
  legs: { kind: 'shorts' | 'trousers'; color: number };
  skin: number;
  hair: number;
  shoes?: number;
  /** Overall height scale and torso width scale. */
  height?: number;
  build?: number;
  cap?: { color: number; badge?: number };
  beard?: number;
  /** A watch on the free wrist. */
  watch?: number;
  /** Something held in the free hand (a water bottle), by colour. */
  bottle?: number;
  accessory?: (g: THREE.Group, mat: Mat, torsoW: number) => void;
}

const LOOKS: Record<StyleId, Look> = {
  // Lee: black cap, navy tee with orange-red patterned shoulders and sleeves.
  allround: {
    shirt: 0x26386e,
    sleeves: 0xc8452c,
    legs: { kind: 'shorts', color: 0x16181d },
    skin: 0xf0c4a8,
    hair: 0x6b4b2e,
    shoes: 0x2b2f38,
    height: 1.0,
    build: 0.95,
    cap: { color: 0x15161a, badge: 0xd1d5db },
    accessory: (g, m, w) => {
      // Shoulder yokes in the sleeve colour, with a darker stripe pattern.
      for (const side of [-1, 1]) {
        const yoke = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.1, 0.25), m(0xc8452c));
        yoke.position.set(side * (w / 2 - 0.05), 1.37, 0);
        g.add(yoke);
        for (let i = 0; i < 3; i++) {
          const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.1, 0.252), m(0x8f2a1c));
          stripe.position.set(side * (w / 2 - 0.09 + i * 0.03), 1.37, 0);
          g.add(stripe);
        }
      }
    },
  },
  // Ryan: tall, dark tousled hair and stubble, black rugby-style jersey with white trim.
  looper: {
    shirt: 0x121315,
    legs: { kind: 'shorts', color: 0x1f2a24 },
    skin: 0xe0ac86,
    hair: 0x3b2618,
    shoes: 0xe5e7eb,
    height: 1.06,
    build: 1.04,
    beard: 0x8f6448, // stubble: between skin and hair
    watch: 0x111111,
    accessory: (g, m, w) => {
      // White collar trim, a small crest on the chest and a white chest band.
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.012, 6, 16), m(0xf3f4f6));
      collar.position.set(0, 1.41, 0);
      collar.rotation.x = Math.PI / 2;
      const crest = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.06, 0.01), m(0xf3f4f6));
      crest.position.set(w * 0.22, 1.3, -0.125);
      const band = new THREE.Mesh(new THREE.BoxGeometry(w * 0.6, 0.035, 0.01), m(0xe5e7eb));
      band.position.set(0, 1.2, -0.125);
      // Tousled hair: a few tufts on top.
      for (const [x, z, r] of [[-0.05, -0.04, 0.04], [0.02, -0.06, 0.045], [0.06, -0.01, 0.035], [-0.02, 0.02, 0.045], [0.03, 0.05, 0.04]]) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), m(0x3b2618));
        tuft.position.set(x, 1.69, z);
        tuft.scale.y = 0.55;
        g.add(tuft);
      }
      g.add(collar, crest, band);
    },
  },
  // Sysadmin: black band t-shirt, beard, lanyard with an access badge.
  chopper: {
    shirt: 0x111111,
    legs: { kind: 'trousers', color: 0x3f3f46 },
    skin: 0xe7c2a0,
    hair: 0x6b4a2f,
    beard: 0x6b4a2f,
    accessory: (g, m) => {
      const lanyard = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.28, 0.01), m(0xe8562a));
      lanyard.position.set(0, 1.28, -0.125);
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.09, 0.01), m(0xffffff));
      badge.position.set(0, 1.12, -0.13);
      g.add(lanyard, badge);
    },
  },
  // Ed: black cap, teal speckled tee, black shorts, a watch and a water bottle.
  blocker: {
    shirt: 0x1d5a57,
    legs: { kind: 'shorts', color: 0x111214 },
    skin: 0xe8b896,
    hair: 0x4b4038,
    shoes: 0x9ca3af,
    height: 0.98,
    build: 1.12,
    cap: { color: 0x1a1b1f },
    watch: 0x111111,
    bottle: 0x2f8fe0,
    accessory: (g, m, w) => {
      // Speckled print on the front and back of the shirt.
      const dots = [0x7dd3c0, 0x0f3b39, 0x9ee6d6];
      for (let i = 0; i < 26; i++) {
        const dot = new THREE.Mesh(new THREE.SphereGeometry(0.009 + (i % 3) * 0.003, 5, 4), m(dots[i % 3]));
        const front = i % 2 === 0 ? -1 : 1;
        dot.position.set((((i * 37) % 100) / 100 - 0.5) * w * 0.85, 0.88 + ((i * 53) % 100) / 100 * 0.5, front * 0.122);
        g.add(dot);
      }
    },
  },
  // Will: blue cap, royal-blue running vest (bare arms), grey shorts, a watch.
  penhold: {
    shirt: 0x1f4fb0,
    sleeves: 'none',
    legs: { kind: 'shorts', color: 0x8c8f80 },
    skin: 0xf2c8aa,
    hair: 0x9a6b3f,
    shoes: 0xf3f4f6,
    height: 1.02,
    build: 0.92,
    cap: { color: 0x2f5bd3, badge: 0xf3f4f6 },
    watch: 0x111111,
  },
};

/** Exported for tests: every style has a look. */
export const AVATAR_STYLES = Object.keys(LOOKS) as StyleId[];

/** Hip height: the legs swing from here and the upper body twists and leans about it. */
const HIP = 0.83;
/** Reactions to a point, played for this long (s). */
const REACT_TIME = 1.5;

export type Reaction = 'celebrate' | 'dismay';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Frame-rate independent approach of `cur` to `target` (rate per second). */
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class Avatar {
  readonly group = new THREE.Group();
  private arm: THREE.Mesh;
  /** Upper body, pivoting at the hips (twist into strokes, lean, reactions). */
  private upper = new THREE.Group();
  /** Inside `upper`, offset so its children use the same absolute heights as before. */
  private upperAbs = new THREE.Group();
  private legs: THREE.Group[] = [];
  private freeArm: THREE.Object3D;
  private materials: THREE.MeshStandardMaterial[] = [];
  /** Everything except the racket arm (hidden in first person). */
  private bodyParts: THREE.Object3D[] = [];

  /** The racket arm's sleeve (short sleeves), oriented with the arm but not stretched. */
  private sleeve: THREE.Mesh | null = null;

  constructor(style: StyleId, opacity = 1) {
    const look = LOOKS[style];
    const mat = (c: number) => {
      const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
      this.materials.push(m);
      return m;
    };
    this.upper.position.y = HIP;
    this.upperAbs.position.y = -HIP;
    this.upper.add(this.upperAbs);
    this.group.add(this.upper);
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = this.upperAbs) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set(x, y, z);
      m.castShadow = opacity >= 1;
      parent.add(m);
      return m;
    };
    const w = 0.36 * (look.build ?? 1);
    const sleeveColor = look.sleeves === 'none' ? null : (look.sleeves ?? look.shirt);
    const armColor = look.longSleeves && sleeveColor !== null ? sleeveColor : look.skin;

    // Legs: shorts over bare lower legs, or full trousers; shoes. Each leg swings from the hip.
    for (const x of [-0.09, 0.09]) {
      const leg = new THREE.Group();
      leg.position.set(x, HIP, 0);
      this.group.add(leg);
      this.legs.push(leg);
      if (look.legs.kind === 'shorts') {
        add(new THREE.BoxGeometry(0.14, 0.3, 0.17), look.legs.color, 0, 0.68 - HIP, 0, leg);
        add(new THREE.BoxGeometry(0.105, 0.48, 0.12), look.skin, 0, 0.3 - HIP, 0, leg);
      } else add(new THREE.BoxGeometry(0.13, 0.78, 0.16), look.legs.color, 0, 0.43 - HIP, 0, leg);
      add(new THREE.BoxGeometry(0.12, 0.07, 0.25), look.shoes ?? 0x27272a, 0, 0.035 - HIP, -0.04, leg);
    }
    // Torso, neck, head.
    add(new THREE.BoxGeometry(w, 0.58, 0.24), look.shirt, 0, 1.12, 0);
    add(new THREE.SphereGeometry(0.06, 8, 6), look.skin, 0, 1.46, 0);
    add(new THREE.SphereGeometry(0.11, 14, 10), look.skin, 0, 1.6, 0);
    // A friendly face: eyes and a smile (everyone in the photo is smiling).
    for (const x of [-0.037, 0.037]) add(new THREE.SphereGeometry(0.012, 6, 5), 0x1f1a17, x, 1.62, -0.1);
    const smile = add(new THREE.TorusGeometry(0.035, 0.007, 4, 10, Math.PI), 0x7a2e24, 0, 1.575, look.beard !== undefined ? -0.112 : -0.098);
    smile.rotation.z = Math.PI;
    // Hair (sides and back show under a cap).
    const hair = add(new THREE.SphereGeometry(0.117, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2.1), look.hair, 0, 1.615, 0.012);
    hair.rotation.x = 0.18;
    if (look.beard !== undefined) {
      const beard = add(new THREE.SphereGeometry(0.105, 12, 8, 0, Math.PI * 2, Math.PI / 1.9, Math.PI / 2.6), look.beard, 0, 1.6, -0.01);
      beard.scale.set(1, 1, 1.02);
    }
    if (look.cap) {
      add(new THREE.SphereGeometry(0.122, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), look.cap.color, 0, 1.655, 0.005);
      const peak = add(new THREE.BoxGeometry(0.15, 0.012, 0.11), look.cap.color, 0, 1.665, -0.135);
      peak.rotation.x = -0.12;
      if (look.cap.badge !== undefined) add(new THREE.BoxGeometry(0.05, 0.025, 0.01), look.cap.badge, 0, 1.72, -0.112);
    }
    // Free arm hanging from the shoulder, with sleeve and watch following its angle.
    const free = add(new THREE.CylinderGeometry(0.038, 0.033, 0.55, 8).translate(0, -0.275, 0), armColor, -w / 2 - 0.04, 1.375, 0);
    free.rotation.z = -0.15;
    this.freeArm = free;
    if (sleeveColor !== null && !look.longSleeves) add(new THREE.CylinderGeometry(0.05, 0.046, 0.17, 8), sleeveColor, 0, -0.085, 0, free);
    if (look.watch !== undefined) add(new THREE.CylinderGeometry(0.039, 0.039, 0.035, 8), look.watch, 0, -0.485, 0, free);
    if (look.bottle !== undefined) {
      const bottle = add(new THREE.CylinderGeometry(0.03, 0.03, 0.16, 10), look.bottle, 0, -0.575, -0.04, free);
      bottle.rotation.x = Math.PI / 2.3;
      add(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 8), 0xf3f4f6, 0, 0.09, 0, bottle);
    }
    look.accessory?.(this.upperAbs, mat, w);
    this.upperAbs.traverse((o) => (o.castShadow = opacity >= 1));
    this.bodyParts = [this.upper, ...this.legs];
    // Racket arm: a cylinder stretched from shoulder to hand every frame.
    this.shoulderX = w / 2 + 0.02;
    this.arm = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.032, 1, 8).translate(0, 0.5, 0), mat(armColor));
    this.arm.castShadow = opacity >= 1;
    this.group.add(this.arm);
    if (sleeveColor !== null && !look.longSleeves) {
      this.sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.17, 8).translate(0, 0.085, 0), mat(sleeveColor));
      this.group.add(this.sleeve);
    }
    this.group.scale.setScalar(look.height ?? 1);
  }

  private shoulderX = 0.2;

  /**
   * Place the character. body: floor position; hand: world position of the paddle
   * handle; facingNegZ: true for a player at the near end looking down the table.
   */
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean) {
    const now = performance.now() / 1000;
    const dt = this.lastTime === null ? 0 : clamp(now - this.lastTime, 0, 0.1);
    this.lastTime = now;
    this.group.rotation.y = facingNegZ ? 0 : Math.PI;
    this.group.position.set(body.x, 0, body.z);
    this.group.updateMatrixWorld();
    const local = this.group.worldToLocal(hand.clone());
    this.animate(dt, now, body, local);
    this.group.updateMatrixWorld(true);
    // Shoulder on the paddle side (it moves with the upper body), in the group's frame.
    const shoulder = this.group.worldToLocal(this.upperAbs.localToWorld(new THREE.Vector3(local.x >= 0 ? this.shoulderX : -this.shoulderX, 1.36, 0)));
    const d = local.clone().sub(shoulder);
    const len = Math.min(0.75, d.length());
    this.arm.position.copy(shoulder);
    this.arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    this.arm.scale.set(1, len, 1);
    if (this.sleeve) {
      this.sleeve.position.copy(shoulder);
      this.sleeve.quaternion.copy(this.arm.quaternion);
    }
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  // ------------------------------------------------------------- animation

  private lastTime: number | null = null;
  private lastBody: { x: number; z: number } | null = null;
  private lastHand: THREE.Vector3 | null = null;
  private walkPhase = 0;
  private stride = 0;
  private twist = 0;
  private lean = 0;
  private swingVel = 0;
  private reaction: { kind: Reaction; t: number } | null = null;

  /** Play a short reaction to a point: a jump and fist pump, or a slump. */
  react(kind: Reaction) {
    this.reaction = { kind, t: 0 };
  }

  /**
   * Procedural animation: shuffle steps when moving, a bouncy ready stance, the
   * upper body turning into the stroke and leaning for low balls, and reactions.
   * `hand` is in the group's local frame (the character faces local −z).
   */
  private animate(dt: number, time: number, body: { x: number; z: number }, hand: THREE.Vector3) {
    // Footwork: speed in the local frame drives a side-step shuffle.
    let speed = 0;
    if (this.lastBody && dt > 0) speed = Math.hypot(body.x - this.lastBody.x, body.z - this.lastBody.z) / dt;
    this.lastBody = { x: body.x, z: body.z };
    this.stride = approach(this.stride, clamp(speed * 0.35, 0, 0.32), 12, dt);
    this.walkPhase += dt * (4 + speed * 9);
    const step = Math.sin(this.walkPhase) * this.stride;
    this.legs[0].rotation.z = -Math.abs(step) * 0.9 - 0.04;
    this.legs[1].rotation.z = Math.abs(step) * 0.9 + 0.04;
    this.legs[0].rotation.x = step * 0.5;
    this.legs[1].rotation.x = -step * 0.5;

    // Swing speed of the hand across the body (follow-through twists the torso).
    if (this.lastHand && dt > 0) this.swingVel = approach(this.swingVel, (hand.x - this.lastHand.x) / dt, 20, dt);
    this.lastHand = hand.clone();

    // Turn toward the paddle side and into the swing; lean over low or far-forward balls.
    const twistTarget = clamp(-hand.x * 0.55 - this.swingVel * 0.06, -0.7, 0.7);
    this.twist = approach(this.twist, twistTarget, 10, dt);
    const reachDown = clamp((1.15 - hand.y) * 0.5, 0, 0.3);
    const reachForward = clamp((-hand.z - 0.3) * 0.25, 0, 0.15);
    this.lean = approach(this.lean, 0.1 + reachDown + reachForward, 8, dt);

    // Ready stance: knees bent, a light bounce on the toes.
    let y = -0.025 + Math.sin(time * Math.PI * 2 * 1.4) * 0.006 * (1 - this.stride * 2);
    let lean = this.lean;
    let twist = this.twist;
    let freeZ = -0.15 - this.stride * 0.6;
    let freeX = 0.25 + this.lean * 0.6; // free arm a little forward, for balance
    let jump = 0;

    const r = this.reaction;
    if (r) {
      r.t += dt;
      const k = r.t / REACT_TIME;
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      if (r.kind === 'celebrate') {
        // A hop and a fist pump with the free arm.
        jump = r.t < 0.42 ? Math.sin((r.t / 0.42) * Math.PI) * 0.11 : 0;
        freeZ = THREE.MathUtils.lerp(freeZ, -2.75 + Math.sin(r.t * 14) * 0.18, fade);
        freeX = THREE.MathUtils.lerp(freeX, 0, fade);
        lean = THREE.MathUtils.lerp(lean, -0.08, fade);
      } else {
        // Shoulders drop, head down, a slow shake.
        lean = THREE.MathUtils.lerp(lean, 0.42, fade);
        twist += Math.sin(r.t * 7) * 0.18 * fade * (1 - k);
        freeZ = THREE.MathUtils.lerp(freeZ, -0.05, fade);
        freeX = THREE.MathUtils.lerp(freeX, -0.2, fade);
        y -= 0.02 * fade;
      }
      if (r.t >= REACT_TIME) this.reaction = null;
    }

    this.upper.position.y = HIP + y + jump;
    this.upper.rotation.set(-lean, twist, 0, 'YXZ');
    for (const leg of this.legs) leg.position.y = HIP + jump;
    this.freeArm.rotation.set(freeX, 0, freeZ);
  }

  /** First person: nothing of the body is drawn, only the paddle (handled by the player view). */
  setFirstPerson(on: boolean) {
    // In first person only the paddle is drawn: from the play camera (behind and
    // below head height) the body and racket arm would sit between you and the table.
    for (const p of this.bodyParts) p.visible = !on;
    this.arm.visible = !on;
    if (this.sleeve) this.sleeve.visible = !on;
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
