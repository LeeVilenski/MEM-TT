import * as THREE from 'three';
import type { StyleId } from '../game/styles';

/**
 * Characters built from smooth primitives: a tapered torso, jointed arms and legs,
 * hands and a proper head. One look per player style; four are modelled on real
 * people (Lee, Ed, Ryan, Will, Dan, Paul, Bryony) from their clothes, hair and build.
 * Bryony plays seated in a table tennis wheelchair: the upper body sits lower and the
 * legs rest on the footplate. The racket arm is
 * a two-bone chain (shoulder, elbow, hand) solved each frame to hold the paddle handle.
 */
type Mat = (c: number) => THREE.Material;

/** Helpers for placing details on the torso surface. */
interface TorsoShape {
  /** Half width at chest height (m). */
  halfW: number;
  /** Half depth at chest height (m). */
  halfD: number;
  /** Front surface (local −z) at height y and across-offset x (m). */
  front(y: number, x?: number): number;
  /** A band of the torso between two heights in another colour (trim, yokes). */
  band(y0: number, y1: number, color: number, grow?: number): THREE.Mesh;
}

interface Look {
  shirt: number;
  /** Sleeve colour (defaults to the shirt), or 'none' for a vest (bare arms). */
  sleeves?: number | 'none';
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
  /** Rectangular glasses frames, by colour. */
  glasses?: number;
  /** Tinted lenses in the glasses (sunglasses), by colour. */
  lenses?: number;
  /** A goatee and moustache (instead of a full beard), by colour. */
  goatee?: number;
  /** Sleeves down to the wrist (instead of short sleeves). */
  longSleeves?: boolean;
  /** Plays seated in a sports wheelchair: frame and tyre colours. */
  wheelchair?: { frame: number; tyre: number };
  /** A watch on the free wrist. */
  watch?: number;
  /** Something held in the free hand (a water bottle), by colour. */
  bottle?: number;
  accessory?: (g: THREE.Group, mat: Mat, torso: TorsoShape) => void;
}

const LOOKS: Record<StyleId, Look> = {
  // Lee: black cap, navy tee with orange-red shoulders and sleeves.
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
    accessory: (g, _m, t) => {
      // Raglan shoulders in the sleeve colour, with a darker stripe beneath.
      g.add(t.band(1.3, 1.475, 0xc8452c, 1.012), t.band(1.27, 1.3, 0x8f2a1c, 1.012));
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
    accessory: (g, m, t) => {
      // White collar, a chest band and a small crest.
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.013, 8, 24), m(0xf3f4f6));
      collar.position.set(0, 1.455, 0);
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(1, 0.85, 1);
      const crest = new THREE.Mesh(new THREE.CircleGeometry(0.026, 16), m(0xf3f4f6));
      crest.position.set(t.halfW * 0.45, 1.31, t.front(1.31, t.halfW * 0.45) - 0.002);
      crest.rotation.y = Math.PI;
      g.add(collar, crest, t.band(1.19, 1.225, 0xe5e7eb, 1.01));
      // Tousled hair: a few tufts on top.
      for (const [x, z, r] of [[-0.05, -0.04, 0.04], [0.02, -0.06, 0.045], [0.06, -0.01, 0.035], [-0.02, 0.02, 0.045], [0.03, 0.05, 0.04]]) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m(0x3b2618));
        tuft.position.set(x, 1.7, z);
        tuft.scale.y = 0.5;
        g.add(tuft);
      }
    },
  },
  // Sysadmin: black t-shirt, beard, lanyard with an access badge.
  chopper: {
    shirt: 0x1b1c1f,
    legs: { kind: 'trousers', color: 0x3f3f46 },
    skin: 0xe7c2a0,
    hair: 0x6b4a2f,
    beard: 0x6b4a2f,
    shoes: 0x1f2937,
    build: 1.06,
    accessory: (g, m, t) => {
      // Lanyard: two straps from the collar meeting at the badge.
      for (const side of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.25, 0.004), m(0xe8562a));
        strap.position.set(side * 0.032, 1.3, t.front(1.3, 0.032) - 0.003);
        strap.rotation.z = side * 0.24;
        g.add(strap);
      }
      const badge = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.006), m(0xf8fafc));
      badge.position.set(0, 1.15, t.front(1.15) - 0.005);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.018, 0.007), m(0x2563eb));
      stripe.position.set(0, 1.175, t.front(1.15) - 0.006);
      g.add(badge, stripe);
    },
  },
  // Ed: black cap, teal speckled tee, black shorts, and a watch.
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
    accessory: (g, m, t) => {
      // Speckled print on the front and back of the shirt.
      const dots = [0x7dd3c0, 0x0f3b39, 0x9ee6d6];
      const geo = new THREE.CircleGeometry(1, 8);
      for (let i = 0; i < 30; i++) {
        const dot = new THREE.Mesh(geo, m(dots[i % 3]));
        const back = i % 2 === 1;
        const x = (((i * 37) % 100) / 100 - 0.5) * t.halfW * 1.1;
        const y = 0.92 + (((i * 53) % 100) / 100) * 0.42;
        const z = t.front(y, x) - 0.002;
        dot.position.set(x, y, back ? -z : z);
        dot.scale.setScalar(0.009 + (i % 3) * 0.003);
        dot.rotation.y = back ? 0 : Math.PI;
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
  // Dan: dark hair, full dark beard, dark rectangular glasses, grey v-neck jumper.
  pusher: {
    shirt: 0x8e959c,
    legs: { kind: 'trousers', color: 0x2a2d33 },
    skin: 0xeec4a6,
    hair: 0x2e2119,
    beard: 0x2a1d15,
    glasses: 0x1a1a1a,
    shoes: 0x1f2937,
    height: 1.0,
    build: 1.12,
    accessory: (g, m, t) => {
      // V-neck: a darker grey wedge at the collar, with a pale undershirt showing.
      const v = new THREE.Mesh(new THREE.CircleGeometry(0.06, 3), m(0x6b7178));
      v.position.set(0, 1.42, t.front(1.42) - 0.004);
      v.rotation.set(0, Math.PI, -Math.PI / 2);
      v.scale.set(1.3, 0.8, 1);
      const under = new THREE.Mesh(new THREE.CircleGeometry(0.045, 3), m(0xd4d4d8));
      under.position.set(0, 1.43, t.front(1.43) - 0.005);
      under.rotation.set(0, Math.PI, -Math.PI / 2);
      under.scale.set(1.3, 0.8, 1);
      g.add(v, under);
    },
  },
  // Paul: navy Hawaiian shirt with a pink, teal and orange flower print, open collar,
  // jeans, dark sunglasses, short dark hair and a goatee.
  patient: {
    shirt: 0x1c2442,
    legs: { kind: 'trousers', color: 0x3b5b8f },
    skin: 0xe9b996,
    hair: 0x3a2a20,
    shoes: 0x1f2937,
    height: 1.0,
    build: 1.0,
    glasses: 0x111111,
    lenses: 0x1b2230,
    goatee: 0x4a3426,
    accessory: (g, m, t) => {
      // A busy flower print front and back: big blossoms (petals round a yellow centre) among leaves.
      const petals = [0xf06292, 0x2bb3a3, 0xf59e0b, 0xf8fafc, 0xec4899];
      const disc = new THREE.CircleGeometry(1, 10);
      const leaf = new THREE.CircleGeometry(1, 6);
      const place = (o: THREE.Object3D, i: number, back: boolean, x: number, y: number) => {
        const z = t.front(y, x) - 0.002 - (i % 3) * 0.0003;
        o.position.set(x, y, back ? -z : z);
        o.rotation.y = back ? 0 : Math.PI;
        g.add(o);
      };
      // A jittered grid over the front and back, so the print covers the shirt evenly.
      const COLS = 5;
      const ROWS = 6;
      const jitter = (n: number) => ((Math.sin(n * 12.9898) * 43758.5453) % 1 + 1) % 1 - 0.5;
      for (let i = 0; i < COLS * ROWS * 2; i++) {
        const back = i >= COLS * ROWS;
        const cell = i % (COLS * ROWS);
        const col = cell % COLS;
        const row = Math.floor(cell / COLS);
        const x = ((col + 0.5) / COLS - 0.5 + jitter(i) * 0.12) * t.halfW * 1.6;
        const y = 0.93 + ((row + 0.5) / ROWS + jitter(i + 99) * 0.08) * 0.45;
        if (i % 3 === 0) {
          // A leaf.
          const l = new THREE.Mesh(leaf, m(i % 2 ? 0x15803d : 0x0e7490));
          l.scale.set(0.012, 0.028, 1);
          l.rotation.z = i;
          const w = new THREE.Group();
          w.add(l);
          place(w, i, back, x, y);
          continue;
        }
        const r = 0.022 + (i % 4) * 0.005;
        const flower = new THREE.Group();
        for (let k = 0; k < 5; k++) {
          const petal = new THREE.Mesh(disc, m(petals[i % petals.length]));
          petal.scale.setScalar(r * 0.5);
          const a = (k * Math.PI * 2) / 5 + i;
          petal.position.set(Math.cos(a) * r * 0.5, Math.sin(a) * r * 0.5, 0);
          flower.add(petal);
        }
        const centre = new THREE.Mesh(disc, m(0xfde047));
        centre.scale.setScalar(r * 0.25);
        centre.position.z = -0.0005;
        flower.add(centre);
        place(flower, i, back, x, y);
      }
      // Open collar: two lapels either side of the neck.
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.CircleGeometry(0.04, 3), m(0x141a33));
        lapel.position.set(side * 0.03, 1.415, t.front(1.415, side * 0.03) - 0.004);
        lapel.rotation.set(0, Math.PI, side * 0.6 - Math.PI / 2);
        lapel.scale.set(1.2, 0.7, 1);
        g.add(lapel);
      }
      const neck = new THREE.Mesh(new THREE.CircleGeometry(0.03, 3), m(0xe9b996));
      neck.position.set(0, 1.43, t.front(1.43) - 0.005);
      neck.rotation.set(0, Math.PI, -Math.PI / 2);
      neck.scale.set(1.2, 0.8, 1);
      g.add(neck);
    },
  },
  // Bryony: in a sports wheelchair; long light-brown hair in a ponytail, thin dark
  // glasses, a berry long-sleeved top with a small white star print, dark trousers.
  wheelchair: {
    shirt: 0x8e1d55,
    longSleeves: true,
    legs: { kind: 'trousers', color: 0x1c1d22 },
    skin: 0xf0c6ae,
    hair: 0x8a6142,
    shoes: 0x1f2937,
    height: 1.0,
    build: 1.08,
    glasses: 0x2b1d1d,
    wheelchair: { frame: 0xc3c8cf, tyre: 0x1b1d22 },
    accessory: (g, m, t) => {
      // Star print: small white (and a few gold) stars front and back.
      const star = new THREE.CircleGeometry(1, 5);
      const jitter = (n: number) => ((Math.sin(n * 78.233) * 43758.5453) % 1 + 1) % 1 - 0.5;
      for (let i = 0; i < 90; i++) {
        const back = i % 2 === 1;
        const col = (i >> 1) % 6;
        const row = Math.floor((i >> 1) / 6);
        const x = ((col + 0.5) / 6 - 0.5 + jitter(i) * 0.14) * t.halfW * 1.6;
        const y = 0.9 + ((row + 0.5) / 8 + jitter(i + 7) * 0.06) * 0.5;
        const z = t.front(y, x) - 0.002;
        const s = new THREE.Mesh(star, m(i % 7 === 0 ? 0xfacc15 : 0xf8fafc));
        s.scale.setScalar(0.007 + (i % 3) * 0.002);
        s.position.set(x, y, back ? -z : z);
        s.rotation.set(0, back ? 0 : Math.PI, i);
        g.add(s);
      }
      // Ponytail: a hair tie at the back of the head and the tail hanging down.
      const tie = new THREE.Mesh(new THREE.TorusGeometry(0.022, 0.008, 6, 12), m(0x1f2937));
      tie.position.set(0, 1.62, 0.1);
      g.add(tie);
      const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.026, 0.16, 4, 10), m(0x8a6142));
      tail.position.set(0, 1.52, 0.115);
      tail.rotation.x = 0.18;
      g.add(tail);
    },
  },
};

/** Exported for tests: every style has a look. */
export const AVATAR_STYLES = Object.keys(LOOKS) as StyleId[];

/** Hip height: the legs swing from here and the upper body twists and leans about it. */
const HIP = 0.83;
/** Shoulder joint height. */
const SHOULDER_Y = 1.375;
/** Reactions to a point, played for this long (s). */
const REACT_TIME = 1.5;
/** Racket arm: upper arm and forearm (to the grip) lengths, m. */
const UPPER = 0.3;
const FORE = 0.31;
/** Longest the racket arm may stretch (shoulder to handle, m): a little past straight. */
const ARM_MAX = 0.84;
/** Shoulder to hand within this, the body doesn't need to reach. */
const COMFORT = 0.6;
/** Leg segments. */
const THIGH = 0.42;
const SHIN = 0.37;
/** Seated (wheelchair): how far the hips sit below standing hip height, m. */
const SEAT_DROP = 0.31;
/** Wheelchair rear wheel radius, m. */
const WHEEL_R = 0.3;

/** Torso outline: [radius (fraction of the half width), height]. Waist, chest, shoulders, neckline. */
const TORSO: [number, number][] = [
  [0, 0.79],
  [0.86, 0.79],
  [0.86, 0.84],
  [0.83, 0.94],
  [0.84, 1.04],
  [0.91, 1.15],
  [0.98, 1.25],
  [1.0, 1.32],
  [0.93, 1.39],
  [0.72, 1.44],
  [0.42, 1.47],
  [0.2, 1.48],
  [0, 1.48],
];
/** Hips / waistband (in the shorts or trousers colour). */
const PELVIS: [number, number][] = [
  [0, 0.66],
  [0.62, 0.66],
  [0.8, 0.72],
  [0.84, 0.8],
  [0.82, 0.87],
  [0, 0.87],
];

const torsoRadius = (y: number) => {
  for (let i = 1; i < TORSO.length; i++) {
    const [r1, y1] = TORSO[i];
    const [r0, y0] = TORSO[i - 1];
    if (y <= y1 && y1 > y0) return r0 + ((r1 - r0) * (y - y0)) / (y1 - y0);
  }
  return 0;
};

/** A smooth body of revolution through `profile`, squashed to an oval cross-section. */
function lathe(profile: [number, number][], halfW: number, halfD: number, segments = 28) {
  const geo = new THREE.LatheGeometry(
    profile.map(([r, y]) => new THREE.Vector2(r, y)),
    segments,
  );
  geo.scale(halfW, 1, halfD);
  return geo;
}

/** A tapered limb segment of unit length along +y (scaled to length per frame). */
const limb = (r0: number, r1: number) => new THREE.CylinderGeometry(r1, r0, 1, 12, 1).translate(0, 0.5, 0);

export type Reaction = 'celebrate' | 'dismay';

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
/** Frame-rate independent approach of `cur` to `target` (rate per second). */
const approach = (cur: number, target: number, rate: number, dt: number) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** One jointed arm: upper arm, forearm and hand, each segment a group pointing along +y. */
interface ArmRig {
  upper: THREE.Group;
  upperMesh: THREE.Mesh;
  fore: THREE.Group;
  foreMesh: THREE.Mesh;
  hand: THREE.Mesh;
}

export class Avatar {
  readonly group = new THREE.Group();
  /** Upper body, pivoting at the hips (twist into strokes, lean, reactions). */
  private upper = new THREE.Group();
  /** Inside `upper`, offset so its children use absolute heights. */
  private upperAbs = new THREE.Group();
  private legs: { hip: THREE.Group; knee: THREE.Group; foot: THREE.Group }[] = [];
  /** Racket arm (solved to the paddle handle) and the free arm (posed). */
  private arm: ArmRig;
  private freeArm: THREE.Group;
  private freeElbow: THREE.Group;
  private pelvis: THREE.Mesh;
  private materials: THREE.MeshStandardMaterial[] = [];
  private shoulderX = 0.2;
  private firstPerson = false;
  /** Seated in a wheelchair (lower body, legs on the footplate, wheels that roll). */
  private seated = false;
  private wheelSpin: THREE.Group[] = [];
  private rolled = 0;

  constructor(style: StyleId, opacity = 1) {
    const look = LOOKS[style];
    const solid = opacity >= 1;
    const cache = new Map<number, THREE.MeshStandardMaterial>();
    const mat = (c: number) => {
      let m = cache.get(c);
      if (!m) {
        const skin = c === look.skin;
        m = new THREE.MeshStandardMaterial({ color: c, roughness: skin ? 0.62 : 0.82, transparent: !solid, opacity, depthWrite: solid });
        cache.set(c, m);
        this.materials.push(m);
      }
      return m;
    };
    this.upper.position.y = HIP;
    this.upperAbs.position.y = -HIP;
    this.upper.add(this.upperAbs);
    this.group.add(this.upper);
    const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = this.upperAbs) => {
      const m = new THREE.Mesh(geo, mat(color));
      m.position.set(x, y, z);
      parent.add(m);
      return m;
    };
    const build = look.build ?? 1;
    const halfW = 0.17 * build;
    const halfD = 0.112 * Math.sqrt(build);
    const sleeveColor = look.sleeves === 'none' ? null : (look.sleeves ?? look.shirt);
    this.shoulderX = halfW + 0.025;

    // ---- legs: hip → knee → ankle, each joint a group so the stance can bend.
    for (const x of [-0.085, 0.085]) {
      const hip = new THREE.Group();
      hip.position.set(x * build, HIP, 0);
      const knee = new THREE.Group();
      knee.position.y = -THIGH;
      const foot = new THREE.Group();
      foot.position.y = -SHIN;
      hip.add(knee);
      knee.add(foot);
      this.group.add(hip);
      this.legs.push({ hip, knee, foot });
      if (look.legs.kind === 'shorts') {
        // Shorts over the upper thigh, then bare legs, white socks.
        add(new THREE.CylinderGeometry(0.082, 0.078, 0.3, 14), look.legs.color, 0, -0.14, 0, hip);
        add(new THREE.CylinderGeometry(0.062, 0.05, THIGH - 0.2, 12), look.skin, 0, -0.2 - (THIGH - 0.2) / 2 + 0.02, 0, hip);
        add(new THREE.SphereGeometry(0.05, 12, 10), look.skin, 0, 0, 0, knee);
        add(new THREE.CylinderGeometry(0.048, 0.034, SHIN, 12), look.skin, 0, -SHIN / 2, 0, knee);
        add(new THREE.CylinderGeometry(0.037, 0.037, 0.07, 12), 0xf1f2f4, 0, -SHIN + 0.03, 0, knee);
      } else {
        add(new THREE.CylinderGeometry(0.078, 0.066, THIGH + 0.02, 14), look.legs.color, 0, -THIGH / 2, 0, hip);
        add(new THREE.SphereGeometry(0.066, 12, 10), look.legs.color, 0, 0, 0, knee);
        add(new THREE.CylinderGeometry(0.064, 0.056, SHIN, 14), look.legs.color, 0, -SHIN / 2, 0, knee);
      }
      // Trainer: a rounded shoe with a pale sole.
      const shoe = add(new THREE.CapsuleGeometry(0.045, 0.15, 4, 12).rotateX(Math.PI / 2), look.shoes ?? 0x27272a, 0, -0.005, -0.045, foot);
      shoe.scale.set(1.15, 0.72, 1);
      const sole = add(new THREE.CapsuleGeometry(0.047, 0.15, 4, 12).rotateX(Math.PI / 2), 0xe5e7eb, 0, -0.026, -0.045, foot);
      sole.scale.set(1.18, 0.3, 1.02);
    }
    // Hips and waistband move with the legs, not the twisting upper body.
    this.pelvis = new THREE.Mesh(lathe(PELVIS, halfW * 0.98, halfD * 0.98), mat(look.legs.color));
    this.group.add(this.pelvis);
    if (look.wheelchair) {
      this.seated = true;
      this.buildWheelchair(look.wheelchair, mat);
    }

    // ---- torso, shoulders, neck, head
    const torso: TorsoShape = {
      halfW,
      halfD,
      front: (y, x = 0) => {
        const rw = torsoRadius(y) * halfW;
        const k = clamp(x / Math.max(rw, 1e-3), -0.98, 0.98);
        return -torsoRadius(y) * halfD * Math.sqrt(1 - k * k);
      },
      band: (y0, y1, color, grow = 1.01) => {
        const prof: [number, number][] = [[0, y0], [torsoRadius(y0), y0]];
        for (const [r, y] of TORSO) if (y > y0 && y < y1) prof.push([r, y]);
        prof.push([torsoRadius(y1), y1], [0, y1]);
        return new THREE.Mesh(lathe(prof, halfW * grow, halfD * grow), mat(color));
      },
    };
    add(lathe(TORSO, halfW, halfD), look.shirt, 0, 0, 0);
    // Shoulder caps: sleeves (or bare skin for a vest) round off where the arms join.
    for (const side of [-1, 1]) add(new THREE.SphereGeometry(0.062, 14, 10), sleeveColor ?? look.skin, side * this.shoulderX, SHOULDER_Y, 0);
    if (sleeveColor === null) {
      // Vest straps over bare shoulders.
      for (const side of [-1, 1]) {
        const strap = add(new THREE.BoxGeometry(0.05, 0.03, halfD * 1.9), look.shirt, side * halfW * 0.55, 1.455, 0);
        strap.rotation.z = side * -0.35;
      }
    }
    add(new THREE.CylinderGeometry(0.046, 0.052, 0.12, 12), look.skin, 0, 1.5, 0);
    this.buildHead(look, add);

    // ---- arms
    this.arm = this.buildArm(look, mat, sleeveColor);
    this.upperAbs.add(this.arm.upper);
    const free = this.buildArm(look, mat, sleeveColor);
    this.freeArm = free.upper;
    this.freeElbow = free.fore;
    free.upperMesh.scale.y = UPPER;
    free.fore.position.y = -UPPER;
    free.foreMesh.scale.y = FORE - 0.04;
    free.hand.position.y = -(FORE - 0.02);
    // The free arm hangs down: flip the chain so it points along −y.
    free.upperMesh.rotation.x = Math.PI;
    free.upperMesh.position.y = 0;
    free.foreMesh.rotation.x = Math.PI;
    const freeSleeve = free.upper.getObjectByName('sleeve');
    if (freeSleeve) freeSleeve.position.y = -0.045;
    if (look.watch !== undefined) add(new THREE.CylinderGeometry(0.033, 0.033, 0.03, 12), look.watch, 0, -(FORE - 0.07), 0, free.fore);
    if (look.bottle !== undefined) {
      const bottle = add(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 14), look.bottle, 0, -(FORE + 0.0), -0.03, free.fore);
      bottle.rotation.x = Math.PI / 2.2;
      add(new THREE.CylinderGeometry(0.017, 0.02, 0.03, 10), 0xf3f4f6, 0, 0.1, 0, bottle);
    }
    this.upperAbs.add(this.freeArm);

    look.accessory?.(this.upperAbs, mat, torso);
    this.group.traverse((o) => {
      o.castShadow = solid;
    });
    this.group.scale.setScalar(look.height ?? 1);
  }

  /**
   * A table tennis wheelchair: big cambered rear wheels with push rims, a low back, a
   * cushion, side rails down to small front casters, a footplate and an anti-tip wheel.
   * The character faces local −z; the hips sit at HIP − SEAT_DROP.
   */
  private buildWheelchair(c: { frame: number; tyre: number }, mat: Mat) {
    const g = new THREE.Group();
    const metal = new THREE.MeshStandardMaterial({ color: c.frame, metalness: 0.75, roughness: 0.35 });
    this.materials.push(metal);
    const fabric = mat(0x15161a);
    const tube = (a: THREE.Vector3, b: THREE.Vector3, r = 0.013) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 8), metal);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(Y_AXIS, b.clone().sub(a).normalize());
      g.add(m);
    };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    const seatY = HIP - SEAT_DROP - 0.1;
    // Cushion and the low backrest.
    const cushion = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.05, 0.44), fabric);
    cushion.position.set(0, seatY, -0.14);
    const back = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.22, 0.025), fabric);
    back.position.set(0, seatY + 0.17, 0.11);
    g.add(cushion, back);
    for (const sx of [-1, 1]) {
      const x = sx * 0.2;
      tube(v(x, seatY - 0.03, 0.12), v(x, seatY - 0.03, -0.4)); // side rail
      tube(v(x, seatY - 0.03, 0.12), v(x, seatY + 0.3, 0.12)); // backrest upright
      tube(v(x, seatY - 0.03, -0.4), v(x * 0.75, 0.13, -0.5)); // down to the footplate
      // Front caster: a fork and a small wheel.
      tube(v(x * 0.85, 0.13, -0.5), v(x * 0.85, 0.06, -0.52), 0.01);
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.022, 14).rotateZ(Math.PI / 2), mat(c.tyre));
      caster.position.set(x * 0.85, 0.035, -0.53);
      g.add(caster);
      // Rear wheel: cambered (tops lean in), with a push rim, hub and spokes; spins as she rolls.
      const camber = new THREE.Group();
      camber.position.set(sx * 0.3, WHEEL_R, 0.02);
      camber.rotation.z = sx * 0.14;
      const spin = new THREE.Group();
      camber.add(spin);
      const tyre = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.016, 0.017, 10, 40).rotateY(Math.PI / 2), mat(c.tyre));
      const rim = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.034, 0.008, 6, 40).rotateY(Math.PI / 2), metal);
      const push = new THREE.Mesh(new THREE.TorusGeometry(WHEEL_R - 0.05, 0.007, 6, 40).rotateY(Math.PI / 2), metal);
      push.position.x = sx * 0.035;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.05, 14).rotateZ(Math.PI / 2), metal);
      spin.add(tyre, rim, push, hub);
      for (let k = 0; k < 10; k++) {
        const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.004, WHEEL_R - 0.04, 0.004), metal);
        const a = (k / 10) * Math.PI * 2;
        spoke.position.set(0, Math.cos(a) * (WHEEL_R - 0.04) * 0.5, Math.sin(a) * (WHEEL_R - 0.04) * 0.5);
        spoke.rotation.x = a; // along (0, cos a, sin a): hub to rim
        spin.add(spoke);
      }
      this.wheelSpin.push(spin);
      g.add(camber);
    }
    tube(v(-0.3, WHEEL_R, 0.02), v(0.3, WHEEL_R, 0.02), 0.016); // axle bar
    // Footplate, and the anti-tip wheel out behind.
    const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.14), metal);
    plate.position.set(0, 0.12, -0.5);
    g.add(plate);
    tube(v(0, seatY - 0.03, 0.1), v(0, 0.06, 0.34), 0.011);
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateZ(Math.PI / 2), mat(c.tyre));
    tip.position.set(0, 0.04, 0.36);
    g.add(tip);
    this.group.add(g);
  }

  private buildHead(look: Look, add: (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => THREE.Mesh) {
    const HY = 1.615;
    const head = add(new THREE.SphereGeometry(0.1, 24, 18), look.skin, 0, HY, 0);
    head.scale.set(0.94, 1.1, 1);
    // Jaw: a slightly narrower sphere low and forward, so the face isn't a ball.
    const jaw = add(new THREE.SphereGeometry(0.08, 18, 12), look.skin, 0, HY - 0.045, -0.018);
    jaw.scale.set(0.95, 0.85, 1);
    for (const s of [-1, 1]) {
      const ear = add(new THREE.SphereGeometry(0.024, 10, 8), look.skin, s * 0.094, HY - 0.005, 0.005);
      ear.scale.set(0.45, 1, 0.75);
      // Eyes: a dark iris set into a white, under a brow.
      const white = add(new THREE.SphereGeometry(0.014, 12, 8), 0xf5f5f4, s * 0.034, HY + 0.012, -0.088);
      white.scale.set(1.2, 0.8, 0.5);
      add(new THREE.SphereGeometry(0.0085, 10, 8), 0x2b211b, s * 0.034, HY + 0.012, -0.094);
      const brow = add(new THREE.CapsuleGeometry(0.0055, 0.022, 2, 6).rotateZ(Math.PI / 2), look.hair, s * 0.035, HY + 0.037, -0.091);
      brow.rotation.z = s * -0.12;
    }
    const nose = add(new THREE.SphereGeometry(0.015, 10, 8), look.skin, 0, HY - 0.012, -0.1);
    nose.scale.set(0.85, 1.2, 1.1);
    const smile = add(new THREE.TorusGeometry(0.022, 0.0045, 6, 12, Math.PI), 0x9a4a3c, 0, HY - 0.042, look.beard !== undefined ? -0.098 : -0.092);
    smile.rotation.z = Math.PI;
    // Hair (sides and back show under a cap).
    const hair = add(new THREE.SphereGeometry(0.106, 22, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), look.hair, 0, HY + 0.008, 0.01);
    hair.scale.set(0.97, 1.1, 1.04);
    hair.rotation.x = 0.2;
    if (look.beard !== undefined) {
      const beard = add(new THREE.SphereGeometry(0.084, 18, 10, 0, Math.PI * 2, Math.PI / 2.1, Math.PI / 2.4), look.beard, 0, HY - 0.04, -0.016);
      beard.scale.set(0.98, 0.9, 1.03);
    }
    if (look.glasses !== undefined) {
      const c = look.glasses;
      const z = -0.101;
      for (const s of [-1, 1]) {
        const x = s * 0.036;
        const y = HY + 0.012;
        add(new THREE.BoxGeometry(0.044, 0.005, 0.004), c, x, y + 0.014, z);
        add(new THREE.BoxGeometry(0.044, 0.004, 0.004), c, x, y - 0.013, z);
        add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x - 0.0215, y, z);
        add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x + 0.0215, y, z);
        // Arm back to the ear.
        add(new THREE.BoxGeometry(0.004, 0.004, 0.1), c, s * 0.091, y + 0.012, z + 0.05);
      }
      add(new THREE.BoxGeometry(0.018, 0.004, 0.004), c, 0, HY + 0.02, z);
      if (look.lenses !== undefined) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.025, 0.002), look.lenses, s * 0.036, HY + 0.012, z + 0.001);
    }
    if (look.goatee !== undefined) {
      // Chin patch, the strip down from the lip, and a moustache.
      const chin = add(new THREE.SphereGeometry(0.03, 12, 8), look.goatee, 0, HY - 0.082, -0.084);
      chin.scale.set(1, 0.75, 0.6);
      add(new THREE.BoxGeometry(0.014, 0.022, 0.006), look.goatee, 0, HY - 0.06, -0.097);
      const tache = add(new THREE.BoxGeometry(0.05, 0.009, 0.008), look.goatee, 0, HY - 0.03, -0.098);
      tache.rotation.x = 0.1;
    }
    if (look.cap) {
      const crown = add(new THREE.SphereGeometry(0.108, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), look.cap.color, 0, HY + 0.035, 0.004);
      crown.scale.set(0.98, 0.95, 1.04);
      // Peak: a half disc out in front, tipped down a touch.
      const peak = add(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, Math.PI / 2, Math.PI), look.cap.color, 0, HY + 0.04, -0.06);
      peak.scale.set(0.9, 1, 1.05);
      peak.rotation.x = -0.14;
      if (look.cap.badge !== undefined) {
        const badge = add(new THREE.CircleGeometry(0.016, 14), look.cap.badge, 0, HY + 0.085, -0.093);
        badge.rotation.set(-0.5, Math.PI, 0);
      }
    }
  }

  private buildArm(look: Look, mat: Mat, sleeveColor: number | null): ArmRig {
    const upper = new THREE.Group();
    // Long sleeves cover the arm down to the wrist (a touch thicker than bare skin).
    const armColor = look.longSleeves && sleeveColor !== null ? sleeveColor : look.skin;
    const thick = armColor === look.skin ? 1 : 1.15;
    const upperMesh = new THREE.Mesh(limb(0.043 * thick, 0.035 * thick), mat(armColor));
    upper.add(upperMesh);
    if (sleeveColor !== null) {
      // A short sleeve over the top of the upper arm (not stretched with it).
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.06, 0.15, 14), mat(sleeveColor));
      sleeve.position.y = 0.045;
      sleeve.name = 'sleeve';
      upper.add(sleeve);
    }
    const fore = new THREE.Group();
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.036 * thick, 12, 8), mat(armColor));
    fore.add(elbow);
    const foreMesh = new THREE.Mesh(limb(0.035 * thick, 0.027 * thick), mat(armColor));
    fore.add(foreMesh);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.036, 12, 10), mat(look.skin));
    hand.scale.set(0.85, 1.15, 0.7);
    fore.add(hand);
    upper.add(fore);
    return { upper, upperMesh, fore, foreMesh, hand };
  }

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
    const side = local.x >= 0 ? 1 : -1;
    this.animate(dt, now, body, local, side);
    this.group.updateMatrixWorld(true);
    this.solveArm(local, side);
  }

  /**
   * Two-bone arm: the shoulder on the paddle side, the elbow bent out and down, the
   * hand on the handle. Beyond full reach the arm straightens and stretches slightly.
   */
  private solveArm(target: THREE.Vector3, side: number) {
    const a = this.arm;
    const shoulderLocal = new THREE.Vector3(side * this.shoulderX, SHOULDER_Y, 0);
    a.upper.position.copy(shoulderLocal);
    // Work in upperAbs space (the arm is parented there).
    const t = this.upperAbs.worldToLocal(this.group.localToWorld(target.clone()));
    const d = t.clone().sub(shoulderLocal);
    const dist = Math.max(1e-4, d.length());
    const dir = d.clone().divideScalar(dist);
    const reach = UPPER + FORE;
    const stretch = clamp(dist / reach, 1, ARM_MAX / reach);
    const l1 = UPPER * stretch;
    const l2 = FORE * stretch;
    const dd = Math.min(dist, l1 + l2 - 1e-4);
    // Elbow bends outward, down and a little back.
    const pole = new THREE.Vector3(side * 0.7, -1, 0.35);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(side, 0, 0);
    pole.normalize();
    const cosA = clamp((l1 * l1 + dd * dd - l2 * l2) / (2 * l1 * dd), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbow = shoulderLocal.clone().addScaledVector(dir, cosA * l1).addScaledVector(pole, sinA * l1);
    const handPos = shoulderLocal.clone().addScaledVector(dir, Math.min(dist, ARM_MAX));

    const upDir = elbow.clone().sub(shoulderLocal).normalize();
    a.upper.quaternion.setFromUnitVectors(Y_AXIS, upDir);
    a.upperMesh.scale.y = l1;
    a.fore.position.set(0, l1, 0);
    // Forearm direction, expressed in the upper arm's frame.
    const foreDirWorld = handPos.clone().sub(elbow).normalize();
    const inv = a.upper.quaternion.clone().invert();
    a.fore.quaternion.setFromUnitVectors(Y_AXIS, foreDirWorld.applyQuaternion(inv));
    const lf = handPos.distanceTo(elbow);
    a.foreMesh.scale.y = Math.max(0.01, lf - 0.03);
    a.hand.position.y = lf;
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Fade the whole character (for see-through drawing; needs a character made with opacity < 1). */
  setOpacity(o: number) {
    for (const m of this.materials) m.opacity = o;
    this.group.visible = o > 0.02 && !this.firstPerson;
  }

  // ------------------------------------------------------------- animation

  private lastTime: number | null = null;
  private lastBody: { x: number; z: number } | null = null;
  private lastHand: THREE.Vector3 | null = null;
  private walkPhase = 0;
  private stride = 0;
  private twist = 0;
  private lean = 0;
  private sideLean = 0;
  private reachLean = 0;
  private swingVel = 0;
  private reaction: { kind: Reaction; t: number } | null = null;

  /** Play a short reaction to a point: a jump and fist pump, or a slump. */
  react(kind: Reaction) {
    this.reaction = { kind, t: 0 };
  }

  /**
   * Procedural animation: shuffle steps when moving, a bouncy ready stance with bent
   * knees, the upper body turning into the stroke and leaning for low balls, and reactions.
   * `hand` is in the group's local frame (the character faces local −z).
   */
  private animate(dt: number, time: number, body: { x: number; z: number }, hand: THREE.Vector3, side: number) {
    // Footwork: speed drives a side-step shuffle.
    let speed = 0;
    if (this.lastBody && dt > 0) speed = Math.hypot(body.x - this.lastBody.x, body.z - this.lastBody.z) / dt;
    this.lastBody = { x: body.x, z: body.z };
    // Seated: the shoulders are lower, and moving rolls the wheels (no steps).
    const drop0 = this.seated ? SEAT_DROP : 0;
    if (this.seated) {
      this.rolled += speed * dt;
      for (const w of this.wheelSpin) w.rotation.x = -this.rolled / WHEEL_R;
      speed = 0;
    }
    this.stride = approach(this.stride, clamp(speed * 0.35, 0, 0.32), 12, dt);
    this.walkPhase += dt * (4 + speed * 9);
    const step = Math.sin(this.walkPhase) * this.stride;

    // Swing speed of the hand across the body (follow-through twists the torso).
    if (this.lastHand && dt > 0) this.swingVel = approach(this.swingVel, (hand.x - this.lastHand.x) / dt, 20, dt);
    this.lastHand = hand.clone();

    // Turn toward the paddle side and into the swing; lean over low or far-forward balls.
    const twistTarget = clamp(-hand.x * 0.55 - this.swingVel * 0.06, -0.7, 0.7);
    this.twist = approach(this.twist, twistTarget, 10, dt);
    const reachDown = clamp((1.15 - drop0 - hand.y) * 0.5, 0, 0.3);
    const reachForward = clamp((-hand.z - 0.3) * 0.25, 0, 0.15);
    this.lean = approach(this.lean, 0.1 + reachDown + reachForward, 8, dt);

    // Reaching for a ball beyond the arm: bend sideways toward it and lean in.
    const sx = side * this.shoulderX;
    const far = Math.max(0, Math.hypot(hand.x - sx, hand.y - (SHOULDER_Y - drop0), hand.z) - COMFORT);
    const sideways = Math.min(1, Math.abs(hand.x - sx) / Math.max(0.01, Math.hypot(hand.x - sx, hand.z)));
    this.sideLean = approach(this.sideLean, -Math.sign(hand.x - sx || 1) * clamp(far * 1.5 * sideways, 0, 0.5), 18, dt);
    this.reachLean = approach(this.reachLean, clamp(far * 1.1 * (1 - sideways * 0.6), 0, 0.35), 18, dt);

    // Ready stance: knees bent, a light bounce on the toes.
    const bounce = Math.sin(time * Math.PI * 2 * 1.4) * (1 - this.stride * 2);
    let bend = 0.24 + this.lean * 0.35 + bounce * 0.03;
    let lean = this.lean;
    let twist = this.twist;
    let freeZ = 0.2 + this.stride * 0.6;
    let freeX = 0.35 + this.lean * 0.6; // free arm a little forward, for balance
    let elbow = 1.25;
    let jump = 0;

    const r = this.reaction;
    if (r) {
      r.t += dt;
      const k = r.t / REACT_TIME;
      const fade = k < 0.75 ? 1 : 1 - (k - 0.75) / 0.25;
      if (r.kind === 'celebrate') {
        // A hop and a fist pump with the free arm.
        jump = r.t < 0.42 ? Math.sin((r.t / 0.42) * Math.PI) * 0.11 : 0;
        bend = THREE.MathUtils.lerp(bend, r.t < 0.42 ? 0.1 : 0.3, fade);
        freeZ = THREE.MathUtils.lerp(freeZ, 0.75, fade);
        freeX = THREE.MathUtils.lerp(freeX, 1.0 + Math.sin(r.t * 14) * 0.15, fade);
        elbow = THREE.MathUtils.lerp(elbow, 1.9 - Math.sin(r.t * 14) * 0.25, fade);
        lean = THREE.MathUtils.lerp(lean, -0.08, fade);
      } else {
        // Shoulders drop, head down, a slow shake.
        lean = THREE.MathUtils.lerp(lean, 0.42, fade);
        twist += Math.sin(r.t * 7) * 0.18 * fade * (1 - k);
        freeZ = THREE.MathUtils.lerp(freeZ, 0.05, fade);
        freeX = THREE.MathUtils.lerp(freeX, -0.1, fade);
        elbow = THREE.MathUtils.lerp(elbow, 0.25, fade);
      }
      if (r.t >= REACT_TIME) this.reaction = null;
    }

    if (this.seated) {
      // In the chair: no knee bend or hop; the hips stay on the cushion.
      jump = 0;
      bend = 0;
    }
    // Bent knees lower the hips: thigh and shin each lose height to the bend.
    const drop = this.seated ? SEAT_DROP : THIGH * (1 - Math.cos(bend)) + SHIN * (1 - Math.cos(bend));
    this.upper.position.y = HIP - drop + jump;
    this.upper.rotation.set(-(lean + this.reachLean), twist, this.sideLean, 'YXZ');
    this.legs.forEach((leg, i) => {
      const s = i === 0 ? -1 : 1;
      leg.hip.position.y = HIP - drop + jump;
      if (this.seated) {
        // Thighs forward along the cushion, shins down to the footplate.
        leg.hip.rotation.set(Math.PI / 2 - 0.04, 0, s * 0.05);
        leg.knee.rotation.x = -Math.PI / 2 + 0.12;
        leg.foot.rotation.x = -0.05;
        return;
      }
      leg.hip.rotation.set(bend + (i === 0 ? step : -step) * 0.5, 0, s * (Math.abs(step) * 0.9 + 0.05));
      leg.knee.rotation.x = -2 * bend;
      leg.foot.rotation.x = bend;
    });
    this.pelvis.position.y = -drop + jump;
    // Free arm on the side away from the paddle.
    const fs = -side;
    this.freeArm.position.set(fs * this.shoulderX, SHOULDER_Y, 0);
    // Seated, the free hand rests out by the wheel's push rim.
    if (this.seated && !r) {
      freeX = 0.25;
      freeZ = 0.45;
      elbow = 0.5;
    }
    this.freeArm.rotation.set(freeX, 0, fs * freeZ, 'XYZ');
    this.freeElbow.rotation.set(elbow, 0, 0);
  }

  /** First person: nothing of the body is drawn, only the paddle (handled by the player view). */
  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    // From the play camera (behind and below head height) the body would sit between you and the table.
    this.group.visible = !on;
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.materials.forEach((m) => m.dispose());
  }
}
