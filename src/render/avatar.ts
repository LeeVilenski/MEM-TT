import * as THREE from 'three';
import { STYLES, type StyleId } from '../game/styles';
import { BRYONY, ED, GEORGE_SHIRTS, LEE, PAUL_SHIRTS, RYAN, heightUVs, paint, type Fabric } from './fabric';

/**
 * Characters built from smooth primitives: a tapered torso, jointed arms and legs,
 * hands and a proper head. One look per player style; four are modelled on real
 * people (Lee, Ed, Ryan, Will, Dan, Paul, Bryony, George) from their clothes, hair and build.
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
  /** The shirt's main colour (for trims such as an open collar). */
  shirt: number;
  /** A band of the torso between two heights in another colour (trim, yokes). */
  band(y0: number, y1: number, color: number, grow?: number): THREE.Mesh;
}

interface Face {
  /** Iris colour. */
  eyes?: number;
  /** A closed smile, a one-sided smirk, or a grin with teeth showing. */
  mouth?: 'smile' | 'smirk' | 'grin';
  /** Painted stubble over the lower face, or just a goatee and moustache. density 0..1+. */
  stubble?: { color: number; density?: number; goatee?: boolean };
  /** Jaw width and face length (1 = default). */
  jaw?: number;
  long?: number;
  /** Rosy cheeks, by colour. */
  cheeks?: number;
  /** Eyebrow colour (defaults to the hair) and thickness. */
  brows?: number;
  browWeight?: number;
  /** Hair colour low on the sides (greying temples). */
  temples?: number;
  /** Short spiky hair, swept up at the front. */
  spiky?: boolean;
  /** Teardrop aviator lenses (with `glasses` as the frame colour). */
  aviators?: boolean;
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
  /** Face details: eye colour, mouth, stubble, face shape. */
  face?: Face;
  /** Sleeves down to the wrist (instead of short sleeves). */
  longSleeves?: boolean;
  /** Plays seated in a sports wheelchair: frame and tyre colours. */
  wheelchair?: { frame: number; tyre: number };
  /** A watch on the free wrist. */
  watch?: number;
  /** Something held in the free hand (a water bottle), by colour. */
  bottle?: number;
  /** A painted fabric for the shirt and sleeves (prints, panels, crests); see fabric.ts.
   *  A list is a wardrobe: one is picked each time the character is made. */
  fabric?: Fabric | Fabric[];
  accessory?: (g: THREE.Group, mat: Mat, torso: TorsoShape) => void;
}

const LOOKS: Record<StyleId, Look> = {
  // Lee: black cap, slate-navy tee with orange-red striped raglan shoulders and sleeves.
  allround: {
    shirt: 0x36466f,
    sleeves: 0xd4492a,
    fabric: LEE,
    legs: { kind: 'shorts', color: 0x16181d },
    skin: 0xf0c4a8,
    hair: 0x6b4b2e,
    shoes: 0x2b2f38,
    height: 1.0,
    build: 0.95,
    cap: { color: 0x15161a, badge: 0xd1d5db },
    // Young, lean and clean-shaven; a closed-mouth half smile.
    face: { eyes: 0x5d7f9e, mouth: 'smirk', jaw: 0.93, long: 1.03, cheeks: 0xe79a8a },
  },
  // Ryan: tall, dark tousled hair and stubble, black rugby jersey with a crest and a sponsor across the chest.
  looper: {
    shirt: 0x131416,
    fabric: RYAN,
    legs: { kind: 'shorts', color: 0x1f2a24 },
    skin: 0xe0ac86,
    hair: 0x3b2618,
    shoes: 0xe5e7eb,
    height: 1.06,
    build: 1.04,
    watch: 0x111111,
    // A short dark beard and a big open grin.
    face: { eyes: 0x4a3222, mouth: 'grin', stubble: { color: 0x2e1e14, density: 1.3 }, long: 1.05, browWeight: 1.2 },
    accessory: (g, m) => {
      // A dark rugby collar.
      const collar = new THREE.Mesh(new THREE.TorusGeometry(0.068, 0.013, 8, 24), m(0x0a0a0b));
      collar.position.set(0, 1.455, 0);
      collar.rotation.x = Math.PI / 2;
      collar.scale.set(1, 0.85, 1);
      g.add(collar);
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
  // Ed: black cap, teal tee breaking into a dark-green speckle, black shorts, a watch and a blue water bottle.
  blocker: {
    shirt: 0x22707a,
    fabric: ED,
    bottle: 0x2f80ed,
    legs: { kind: 'shorts', color: 0x111214 },
    skin: 0xe8b896,
    hair: 0x4b4038,
    shoes: 0x9ca3af,
    height: 0.98,
    build: 1.12,
    cap: { color: 0x1a1b1f },
    watch: 0x111111,
    // A round face, short greying stubble, a wide smile.
    face: { eyes: 0x5a4636, mouth: 'grin', stubble: { color: 0x7d7670, density: 0.8 }, jaw: 1.08, temples: 0x8f8a84 },
  },
  // Will: blue cap, royal-blue running vest (bare arms), grey shorts, a watch.
  penhold: {
    shirt: 0x2b4f9c,
    sleeves: 'none',
    legs: { kind: 'shorts', color: 0x8e9682 },
    skin: 0xf2c8aa,
    hair: 0xb07a45,
    shoes: 0xf3f4f6,
    height: 1.02,
    build: 0.92,
    cap: { color: 0x3a6fd0, badge: 0xf3f4f6 },
    watch: 0x111111,
    // Ginger-blond, clean-shaven, rosy-cheeked and grinning.
    face: { eyes: 0x4f86b8, mouth: 'grin', brows: 0xc49060, cheeks: 0xe8826f },
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
  // Paul: navy Hawaiian shirt with pink hibiscus, teal palm leaves and toucans, open collar,
  // mid-blue jeans, dark sunglasses, short dark hair and a goatee.
  patient: {
    shirt: 0x1b2142,
    fabric: PAUL_SHIRTS,
    legs: { kind: 'trousers', color: 0x4f75ab },
    skin: 0xe9b996,
    hair: 0x3a2a20,
    shoes: 0x1f2937,
    height: 1.0,
    build: 1.0,
    glasses: 0x3f444b,
    lenses: 0x161b26,
    // Short spiky hair greying at the sides, a salt-and-pepper goatee, aviators and a big grin.
    face: { mouth: 'grin', stubble: { color: 0x4f453d, density: 1.6, goatee: true }, temples: 0x837d77, spiky: true, aviators: true, jaw: 0.97 },
    accessory: (g, m, t) => {
      // Open collar: two lapels either side of the neck.
      for (const side of [-1, 1]) {
        const lapel = new THREE.Mesh(new THREE.CircleGeometry(0.04, 3), m(new THREE.Color(t.shirt).multiplyScalar(0.7).getHex()));
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
    fabric: BRYONY,
    longSleeves: true,
    legs: { kind: 'trousers', color: 0x1c1d22 },
    skin: 0xf0c6ae,
    hair: 0x8a6142,
    shoes: 0x1f2937,
    height: 1.0,
    build: 1.08,
    glasses: 0x2b1d1d,
    face: { eyes: 0x6b6a3e },
    wheelchair: { frame: 0xc3c8cf, tyre: 0x1b1d22 },
    accessory: (g, m) => {
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
  // George: tall, short dark-brown hair with a side parting, dark stubble, a big grin.
  // One of three outfits from his photos: tartan check shirt, white oxford, or a black
  // v-neck jumper over a burgundy shirt; dark navy chinos.
  attacker: {
    shirt: 0x2a2f55,
    fabric: GEORGE_SHIRTS,
    longSleeves: true,
    legs: { kind: 'trousers', color: 0x232838 },
    skin: 0xecbf9f,
    hair: 0x3a2717,
    shoes: 0x2b2118,
    height: 1.05,
    build: 1.02,
    face: { eyes: 0x5a4330, mouth: 'grin', stubble: { color: 0x3a2717, density: 0.85 }, jaw: 1.02, long: 1.04, browWeight: 1.15 },
    accessory: (g, m, t) => {
      const jumper = t.shirt === 0x1c1c20;
      // The jumper's v-neck shows the burgundy shirt underneath.
      if (jumper) {
        const v = new THREE.Mesh(new THREE.CircleGeometry(0.06, 3), m(0x4a1626));
        v.position.set(0, 1.42, t.front(1.42) - 0.004);
        v.rotation.set(0, Math.PI, -Math.PI / 2);
        v.scale.set(1.35, 0.8, 1);
        g.add(v);
      }
      // Shirt collar: two points either side of the neck (burgundy under the jumper).
      const collar = jumper ? 0x4a1626 : t.shirt === 0xf2f1ee ? 0xe7e5e1 : 0x232848;
      for (const side of [-1, 1]) {
        const point = new THREE.Mesh(new THREE.CircleGeometry(0.036, 3), m(collar));
        point.position.set(side * 0.034, 1.44, t.front(1.44, side * 0.034) - 0.006);
        point.rotation.set(0, Math.PI, side * 0.5 - Math.PI / 2);
        point.scale.set(1.25, 0.65, 1);
        g.add(point);
      }
      // Hair: short on the sides, a little fuller on top, parted and swept to one side.
      for (const [x, y, z, r] of [[-0.04, 1.712, -0.03, 0.04], [0.01, 1.718, -0.035, 0.044], [0.05, 1.708, -0.02, 0.036], [0.015, 1.715, 0.02, 0.05], [-0.035, 1.71, 0.03, 0.042]]) {
        const tuft = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 8), m(0x3a2717));
        tuft.position.set(x, y, z);
        tuft.scale.set(1.1, 0.4, 1);
        g.add(tuft);
      }
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
const NEG_Y = new THREE.Vector3(0, -1, 0);
/** Shortest signed difference between two angles. */
const angleDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
/** Wheelchair geometry: half the rear track (hub x), front caster radius and pivot z. */
const TRACK = 0.3;
const CASTER_R = 0.035;
/** Push stroke on the hand rim: from behind the top (θ < 0) round to the front (θ > 0), rad. */
const PUSH_FROM = -0.6;
const PUSH_TO = 0.5;

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
  /** Bat hand: +1 right (local +x), −1 left. */
  private batHand: 1 | -1 = 1;
  /** Chair, legs and hips: turns (yaws) as she wheels about, under the upper body. */
  private chair = new THREE.Group();
  /** Rear wheels, left then right: spin group (rolls) and camber group (the push rim's frame). */
  private wheelSpin: THREE.Group[] = [];
  private wheelCamber: THREE.Group[] = [];
  private wheelRoll = [0, 0];
  /** Front casters: swivel pivot (trails the travel), wheel spin and its local x. */
  private casters: { pivot: THREE.Group; spin: THREE.Group; x: number; roll: number }[] = [];
  /** Chair heading relative to facing the table (rad, + turns left). */
  private chairYaw = 0;
  /** Smoothed body velocity in the character frame (m/s). */
  private vel = { x: 0, z: 0 };
  /** Free hand pushing the rim: blend weight, angle on the rim, and recovery stroke. */
  private push = { w: 0, theta: 0, lift: 0, rec: -1, recFrom: 0, recTo: 0, wheel: 0 };

  /**
   * @param variant which outfit from a wardrobe (characters with several shirts); random if left out.
   */
  constructor(style: StyleId, opacity = 1, variant?: number) {
    const base = LOOKS[style];
    let fabric: Fabric | undefined;
    if (Array.isArray(base.fabric)) {
      const n = base.fabric.length;
      fabric = base.fabric[(((variant ?? Math.floor(Math.random() * n)) % n) + n) % n];
    } else fabric = base.fabric;
    const look: Look = { ...base, fabric, shirt: fabric?.base ?? base.shirt };
    this.batHand = STYLES[style].leftHanded ? -1 : 1;
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
    // Painted fabrics: one material for the torso, one for the sleeves (null: plain colours).
    const texMat = (tex: THREE.Texture | null) => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.82, transparent: !solid, opacity, depthWrite: solid });
      this.materials.push(m);
      return m;
    };
    const shirtMat = fabric ? texMat(paint(`${fabric.id}:torso`, fabric.torso, 1024, 512)) : null;
    const sleeveMat = fabric?.sleeve ? texMat(paint(`${fabric.id}:sleeve`, fabric.sleeve, 256, 256, true)) : null;
    // See-through layers on the face (stubble, blush), optionally tinted.
    const decal = (tex: THREE.Texture | null, color = 0xffffff) => {
      if (!tex) return null;
      const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.95, transparent: true, opacity, depthWrite: false });
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
      (look.wheelchair ? this.chair : this.group).add(hip);
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
    if (look.wheelchair) {
      this.seated = true;
      this.chair.add(this.pelvis);
      this.group.add(this.chair);
      this.buildWheelchair(look.wheelchair, mat);
    } else this.group.add(this.pelvis);

    // ---- torso, shoulders, neck, head
    const torso: TorsoShape = {
      shirt: look.shirt,
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
    const torsoGeo = lathe(TORSO, halfW, halfD);
    heightUVs(torsoGeo);
    const torsoMesh = add(torsoGeo, look.shirt, 0, 0, 0);
    if (shirtMat) torsoMesh.material = shirtMat;
    // Shoulder caps: sleeves (or bare skin for a vest) round off where the arms join.
    for (const side of [-1, 1]) {
      const cap = add(new THREE.SphereGeometry(0.062, 14, 10), sleeveColor ?? look.skin, side * this.shoulderX, SHOULDER_Y, 0);
      if (sleeveColor !== null && sleeveMat) cap.material = sleeveMat;
    }
    if (sleeveColor === null) {
      // Vest straps over bare shoulders.
      for (const side of [-1, 1]) {
        const strap = add(new THREE.BoxGeometry(0.05, 0.03, halfD * 1.9), look.shirt, side * halfW * 0.55, 1.455, 0);
        strap.rotation.z = side * -0.35;
      }
    }
    add(new THREE.CylinderGeometry(0.046, 0.052, 0.12, 12), look.skin, 0, 1.5, 0);
    this.buildHead(look, add, decal);

    // ---- arms
    this.arm = this.buildArm(look, mat, sleeveColor, sleeveMat);
    this.upperAbs.add(this.arm.upper);
    const free = this.buildArm(look, mat, sleeveColor, sleeveMat);
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
      // Front caster: a fork that swivels to trail the direction of travel, and a small wheel.
      const pivot = new THREE.Group();
      pivot.position.set(x * 0.85, 0.13, -0.5);
      const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 8), metal);
      fork.position.set(0, -0.04, 0.015);
      fork.rotation.x = -0.3;
      const cspin = new THREE.Group();
      cspin.position.set(0, CASTER_R - 0.13, 0.03);
      const caster = new THREE.Mesh(new THREE.CylinderGeometry(CASTER_R, CASTER_R, 0.022, 14).rotateZ(Math.PI / 2), mat(c.tyre));
      const cHub = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.05), metal);
      cspin.add(caster, cHub);
      pivot.add(fork, cspin);
      g.add(pivot);
      this.casters.push({ pivot, spin: cspin, x: x * 0.85, roll: 0 });
      // Rear wheel: cambered (tops lean in), with a push rim, hub and spokes; spins as she rolls.
      const camber = new THREE.Group();
      camber.position.set(sx * TRACK, WHEEL_R, 0.02);
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
      this.wheelCamber.push(camber);
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
    this.chair.add(g);
  }

  private buildHead(
    look: Look,
    add: (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => THREE.Mesh,
    decal: (tex: THREE.Texture | null, color?: number) => THREE.Material | null,
  ) {
    const HY = 1.615;
    const f = look.face ?? {};
    const jawW = f.jaw ?? 1;
    const long = f.long ?? 1;
    /** How far the lower face (jaw, mouth, stubble) drops for a longer face. */
    const drop = (long - 1) * 0.06;
    const head = add(new THREE.SphereGeometry(0.1, 24, 18), look.skin, 0, HY, 0);
    head.scale.set(0.94, 1.1 * long, 1);
    // Jaw: a slightly narrower sphere low and forward, so the face isn't a ball.
    const jaw = add(new THREE.SphereGeometry(0.08, 18, 12), look.skin, 0, HY - 0.045 - drop, -0.018);
    jaw.scale.set(0.95 * jawW, 0.85, 1);
    const browColor = f.brows ?? look.hair;
    for (const s of [-1, 1]) {
      const ear = add(new THREE.SphereGeometry(0.024, 10, 8), look.skin, s * 0.094, HY - 0.005, 0.005);
      ear.scale.set(0.45, 1, 0.75);
      // Eyes: a white, a coloured iris, a pupil and a catchlight, under a brow.
      const ey = HY + 0.012;
      const white = add(new THREE.SphereGeometry(0.0135, 14, 10), 0xf5f5f4, s * 0.034, ey, -0.088);
      white.scale.set(1.25, 0.8, 0.5);
      const iris = add(new THREE.SphereGeometry(0.0078, 12, 10), f.eyes ?? 0x5a4130, s * 0.034, ey, -0.0935);
      iris.scale.z = 0.6;
      add(new THREE.SphereGeometry(0.0042, 10, 8), 0x0b0b0c, s * 0.034, ey, -0.0972);
      add(new THREE.SphereGeometry(0.0016, 6, 4), 0xffffff, s * 0.034 + 0.0028, ey + 0.0028, -0.0985);
      // Upper lid: a skin-toned crease across the top of the eye.
      const lid = add(new THREE.CapsuleGeometry(0.003, 0.024, 2, 6).rotateZ(Math.PI / 2), look.skin, s * 0.034, ey + 0.0105, -0.0915);
      lid.rotation.z = s * -0.08;
      const w = f.browWeight ?? 1;
      const brow = add(new THREE.CapsuleGeometry(0.0055 * w, 0.024, 2, 6).rotateZ(Math.PI / 2), browColor, s * 0.035, HY + 0.037, -0.092);
      brow.rotation.z = s * -0.12;
    }
    const nose = add(new THREE.SphereGeometry(0.015, 10, 8), look.skin, 0, HY - 0.012, -0.1);
    nose.scale.set(0.85, 1.2, 1.1);

    // Stubble or a goatee: speckle painted onto a thin shell over the lower face.
    const stubbled = f.stubble !== undefined;
    if (f.stubble) {
      const st = f.stubble;
      const R = 0.086;
      const T0 = Math.PI / 2.6;
      const TL = Math.PI / 2.0;
      const sx = 0.98 * jawW;
      const sy = 0.92;
      const cz = -0.014;
      const cy = -0.04 - drop;
      const key = `stubble:${st.color}:${st.density ?? 1}:${st.goatee ? 1 : 0}:${jawW}:${long}`;
      const tex = paint(key, (p) => {
        const r = (() => {
          let s = 12345;
          return () => ((s = (s * 16807) % 2147483647) / 2147483647);
        })();
        const col = new THREE.Color(st.color);
        const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
        /** How much stubble grows at a point on the shell (0..1), from its position on the face. */
        const weight = (u: number, v: number) => {
          const phi = u * Math.PI * 2;
          const th = T0 + v * TL;
          const X = -Math.cos(phi) * Math.sin(th) * R * sx;
          const Y = cy + Math.cos(th) * R * sy + drop; // relative to the un-dropped face
          const Z = cz + Math.sin(phi) * Math.sin(th) * R;
          const ax = Math.abs(X);
          // Lips stay clear.
          if (ax < 0.024 && Y > -0.052 && Y < -0.036) return 0;
          if (st.goatee) {
            const chin = ax < 0.03 && Y < -0.054 && Y > -0.11 && Z < -0.03;
            const tache = ax < 0.032 && Y > -0.036 && Y < -0.024;
            const sides = ax > 0.022 && ax < 0.033 && Y >= -0.056 && Y <= -0.034;
            return chin || tache || sides ? 1 : 0;
          }
          // Only on the face side, and not on the part of the shell that hangs past the jaw.
          const front = clamp((-0.03 - Z) / 0.02, 0, 1) * clamp((Y + 0.102) / 0.012, 0, 1);
          const top = ax > 0.07 ? 0.02 : -0.022 - Math.max(0, 0.05 - ax) * 0.1;
          const up = clamp((top - Y) / 0.008, 0, 1);
          return front * up;
        };
        const density = st.density ?? 1;
        // A soft shadow where it grows, then the individual hairs.
        const step = 4;
        for (let y = 0; y < p.h; y += step)
          for (let x = 0; x < p.w; x += step) {
            const wgt = weight(x / p.w, y / p.h);
            if (wgt <= 0) continue;
            p.c.fillStyle = `rgba(${rgb},${0.32 * density * wgt})`;
            p.c.fillRect(x, y, step, step);
          }
        for (let i = 0; i < 26000 * density; i++) {
          const x = r() * p.w;
          const y = r() * p.h;
          const wgt = weight(x / p.w, y / p.h);
          if (r() > wgt) continue;
          p.c.fillStyle = `rgba(${rgb},${0.5 + r() * 0.5})`;
          p.c.fillRect(x, y, 1 + r() * 1.5, 1 + r() * 1.5);
        }
      }, 1024, 512);
      const m = decal(tex);
      if (m) {
        const shell = add(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, T0, TL), st.color, 0, HY + cy, cz);
        shell.scale.set(sx, sy, 1);
        shell.material = m;
        shell.renderOrder = 1;
      }
    }

    // Mouth: a closed smile, a one-sided smirk, or a grin with teeth showing.
    const my = HY - 0.044 - drop;
    const mz = look.beard !== undefined ? -0.098 : stubbled ? -0.097 : -0.093;
    const mouth = f.mouth ?? 'smile';
    if (mouth === 'grin') {
      // Sits just proud of the jaw (or the stubble), whichever is further out.
      const mz = -0.1;
      const open = add(new THREE.SphereGeometry(0.026, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x4a1416, 0, my + 0.008, mz + 0.006);
      open.scale.set(1, 0.6, 0.32);
      const teeth = add(new THREE.SphereGeometry(0.0255, 20, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 6), 0xf7f3ea, 0, my + 0.008, mz + 0.0055);
      teeth.scale.set(0.96, 0.6, 0.35);
      const lip = add(new THREE.TorusGeometry(0.026, 0.0028, 6, 18, Math.PI), 0xa24f45, 0, my + 0.008, mz + 0.002);
      lip.rotation.z = Math.PI;
      lip.scale.set(1, 0.62, 1);
    } else if (mouth === 'smirk') {
      const smirk = add(new THREE.TorusGeometry(0.02, 0.0034, 6, 14, Math.PI * 0.75), 0x9a4a3c, 0.003, my + 0.002, mz);
      smirk.rotation.z = Math.PI * 1.05;
    } else {
      const smile = add(new THREE.TorusGeometry(0.021, 0.0036, 6, 14, Math.PI), 0x9a4a3c, 0, my + 0.002, mz);
      smile.rotation.z = Math.PI;
    }

    // Rosy cheeks: soft round blush.
    if (f.cheeks !== undefined) {
      const tex = paint('blush', (p) => {
        const g = p.c.createRadialGradient(p.w / 2, p.h / 2, 0, p.w / 2, p.h / 2, p.w / 2);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        p.c.fillStyle = g;
        p.c.fillRect(0, 0, p.w, p.h);
      }, 64, 64);
      const m = decal(tex, f.cheeks);
      if (m)
        for (const s of [-1, 1]) {
          const blush = add(new THREE.CircleGeometry(0.02, 16), f.cheeks, s * 0.05, HY - 0.018, -0.086);
          blush.material = m;
          blush.rotation.y = Math.PI + s * 0.55;
          blush.scale.y = 0.75;
        }
    }

    // Hair (sides and back show under a cap); greying temples fade in towards the bottom.
    const hair = add(new THREE.SphereGeometry(0.106, 22, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), look.hair, 0, HY + 0.008, 0.01);
    hair.scale.set(0.97, 1.1 * long, 1.04);
    hair.rotation.x = 0.2;
    if (f.temples !== undefined) {
      const top = new THREE.Color(look.hair);
      const side = new THREE.Color(f.temples);
      const tex = paint(`hair:${look.hair}:${f.temples}`, (p) => {
        const g = p.c.createLinearGradient(0, 0, 0, p.h);
        g.addColorStop(0, `#${top.getHexString()}`);
        g.addColorStop(0.72, `#${top.getHexString()}`);
        g.addColorStop(0.95, `#${side.getHexString()}`);
        p.c.fillStyle = g;
        p.c.fillRect(0, 0, p.w, p.h);
      }, 16, 64);
      const m = tex && decal(tex);
      if (m) {
        (m as THREE.MeshStandardMaterial).transparent = false;
        (m as THREE.MeshStandardMaterial).depthWrite = true;
        hair.material = m;
      }
    }
    if (f.spiky) {
      // Short spikes, swept up at the front.
      for (let i = 0; i < 16; i++) {
        const phi = -Math.PI / 2 + (i - 7.5) * 0.36;
        const th = 0.25 + (i % 3) * 0.17;
        const n = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
        const spike = add(new THREE.ConeGeometry(0.015, 0.03, 6), look.hair, n.x * 0.1, HY + 0.012 + n.y * 0.112 * long, 0.006 + n.z * 0.104);
        spike.quaternion.setFromUnitVectors(Y_AXIS, n.add(new THREE.Vector3(0, 0.9, -0.15)).normalize());
      }
    }
    if (look.beard !== undefined) {
      const beard = add(new THREE.SphereGeometry(0.084, 18, 10, 0, Math.PI * 2, Math.PI / 2.1, Math.PI / 2.4), look.beard, 0, HY - 0.04, -0.016);
      beard.scale.set(0.98, 0.9, 1.03);
    }
    if (look.glasses !== undefined) {
      const c = look.glasses;
      const z = -0.101;
      const y = HY + 0.012;
      if (f.aviators) {
        // Aviators: teardrop lenses, a thin metal rim, a double bridge.
        const drop = new THREE.Shape();
        drop.moveTo(-0.021, 0.013);
        drop.quadraticCurveTo(0, 0.019, 0.023, 0.013);
        drop.quadraticCurveTo(0.028, -0.006, 0.012, -0.019);
        drop.quadraticCurveTo(-0.006, -0.025, -0.017, -0.011);
        drop.quadraticCurveTo(-0.025, 0.0, -0.021, 0.013);
        const lensGeo = new THREE.ShapeGeometry(drop, 12);
        for (const s of [-1, 1]) {
          // Outer edge (+x in the shape) away from the nose.
          const rim = add(lensGeo.clone(), c, s * 0.037, y, z + 0.0008);
          rim.rotation.y = Math.PI;
          rim.scale.set(-s * 1.12, 1.12, 1);
          const lens = add(lensGeo.clone(), look.lenses ?? 0x1b2230, s * 0.037, y, z - 0.0004);
          lens.rotation.y = Math.PI;
          lens.scale.set(-s, 1, 1);
          (lens.material as THREE.MeshStandardMaterial).roughness = 0.15;
          (lens.material as THREE.MeshStandardMaterial).metalness = 0.4;
          add(new THREE.BoxGeometry(0.003, 0.003, 0.1), c, s * 0.091, y + 0.012, z + 0.05);
        }
        lensGeo.dispose();
        add(new THREE.BoxGeometry(0.02, 0.0025, 0.003), c, 0, y + 0.012, z);
        add(new THREE.BoxGeometry(0.016, 0.0025, 0.003), c, 0, y + 0.004, z);
      } else {
        for (const s of [-1, 1]) {
          const x = s * 0.036;
          add(new THREE.BoxGeometry(0.044, 0.005, 0.004), c, x, y + 0.014, z);
          add(new THREE.BoxGeometry(0.044, 0.004, 0.004), c, x, y - 0.013, z);
          add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x - 0.0215, y, z);
          add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x + 0.0215, y, z);
          // Arm back to the ear.
          add(new THREE.BoxGeometry(0.004, 0.004, 0.1), c, s * 0.091, y + 0.012, z + 0.05);
        }
        add(new THREE.BoxGeometry(0.018, 0.004, 0.004), c, 0, HY + 0.02, z);
        if (look.lenses !== undefined) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.025, 0.002), look.lenses, s * 0.036, y, z + 0.001);
      }
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

  private buildArm(look: Look, mat: Mat, sleeveColor: number | null, sleeveMat: THREE.Material | null): ArmRig {
    const upper = new THREE.Group();
    // Long sleeves cover the arm down to the wrist (a touch thicker than bare skin).
    const armColor = look.longSleeves && sleeveColor !== null ? sleeveColor : look.skin;
    const thick = armColor === look.skin ? 1 : 1.15;
    const armMat = armColor !== look.skin && sleeveMat ? sleeveMat : mat(armColor);
    const upperMesh = new THREE.Mesh(limb(0.043 * thick, 0.035 * thick), armMat);
    upper.add(upperMesh);
    if (sleeveColor !== null) {
      // A short sleeve over the top of the upper arm (not stretched with it).
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.056, 0.06, 0.15, 14), sleeveMat ?? mat(sleeveColor));
      sleeve.position.y = 0.045;
      sleeve.name = 'sleeve';
      upper.add(sleeve);
    }
    const fore = new THREE.Group();
    const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.036 * thick, 12, 8), armMat);
    fore.add(elbow);
    const foreMesh = new THREE.Mesh(limb(0.035 * thick, 0.027 * thick), armMat);
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
    // The bat stays in one hand (right is +x: the character faces local −z): backhands
    // are played across the body rather than swapping the bat to the other hand.
    const side = this.batHand;
    this.lastFreeSide = -side;
    this.animate(dt, now, body, local, side);
    this.group.updateMatrixWorld(true);
    this.solveArm(local, side);
    if (this.seated && this.push.w > 0.01) this.solvePushArm(-side);
  }

  /**
   * Seated: the free hand grips the hand rim of the wheel on its side and pushes it
   * round (a two-bone reach to a point on the rim), blended over the posed arm.
   */
  private solvePushArm(fs: number) {
    const p = this.push;
    const camber = this.wheelCamber[fs < 0 ? 0 : 1];
    const r = WHEEL_R - 0.05;
    // On the rim (just outside it, where the fingers wrap), lifted off it during the recovery.
    const onRim = new THREE.Vector3(fs * (0.065 + p.lift * 0.05), r * Math.cos(p.theta) + p.lift * 0.07, -r * Math.sin(p.theta));
    const t = this.upperAbs.worldToLocal(camber.localToWorld(onRim));
    const shoulder = new THREE.Vector3(fs * this.shoulderX, SHOULDER_Y, 0);
    const l1 = UPPER;
    const l2 = FORE - 0.02;
    const d = t.sub(shoulder);
    const dist = clamp(d.length(), 0.15, l1 + l2 - 1e-4);
    const dir = d.normalize();
    // Elbows out and back, as when pushing a wheelchair.
    const pole = new THREE.Vector3(fs * 0.5, 0.1, 1);
    pole.addScaledVector(dir, -pole.dot(dir));
    if (pole.lengthSq() < 1e-6) pole.set(fs, 0, 0);
    pole.normalize();
    const cosA = clamp((l1 * l1 + dist * dist - l2 * l2) / (2 * l1 * dist), -1, 1);
    const sinA = Math.sqrt(1 - cosA * cosA);
    const elbowDir = dir.clone().multiplyScalar(cosA).addScaledVector(pole, sinA);
    const elbow = elbowDir.clone().multiplyScalar(l1);
    const handPos = dir.clone().multiplyScalar(dist);
    const qU = new THREE.Quaternion().setFromUnitVectors(NEG_Y, elbowDir);
    const foreDir = handPos.sub(elbow).normalize().applyQuaternion(qU.clone().invert());
    const qF = new THREE.Quaternion().setFromUnitVectors(NEG_Y, foreDir);
    this.freeArm.quaternion.slerp(qU, p.w);
    this.freeElbow.quaternion.slerp(qF, p.w);
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
    // Elbow bends outward, down and a little back; reaching across the body for a
    // backhand, it comes round in front of the chest instead.
    const across = clamp((side * (shoulderLocal.x - t.x) - 0.05) / 0.35, 0, 1);
    const ac = across * across * (3 - 2 * across);
    const pole = new THREE.Vector3(side * (0.7 - 0.4 * ac), -1 + 0.5 * ac, 0.35 - 1.35 * ac);
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
  /** Velocities for the critically damped springs below, by name. */
  private springVel: Record<string, number> = {};

  /**
   * Critically damped spring toward `target` (natural frequency `w`, rad/s): eases in
   * and out instead of snapping off at full speed the moment the target moves.
   */
  private spring(key: 'twist' | 'lean' | 'sideLean' | 'reachLean' | 'chairYaw', target: number, w: number, dt: number) {
    const x = this[key];
    let v = this.springVel[key] ?? 0;
    if (dt <= 0) return x;
    // Sub-step so a long frame stays stable.
    const n = Math.ceil(dt / (1 / 120));
    const h = dt / n;
    let y = x;
    for (let i = 0; i < n; i++) {
      v += (w * w * (target - y) - 2 * w * v) * h;
      y += v * h;
    }
    this.springVel[key] = v;
    return y;
  }

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
    // Seated: the shoulders are lower, and moving wheels the chair about (no steps).
    const drop0 = this.seated ? SEAT_DROP : 0;
    if (this.seated) {
      this.wheelAbout(dt, body);
      speed = 0;
    }
    this.stride = approach(this.stride, clamp(speed * 0.35, 0, 0.32), 12, dt);
    this.walkPhase += dt * (4 + speed * 9);
    const step = Math.sin(this.walkPhase) * this.stride;

    // Swing speed of the hand across the body (follow-through twists the torso).
    if (this.lastHand && dt > 0) this.swingVel = approach(this.swingVel, (hand.x - this.lastHand.x) / dt, 20, dt);
    this.lastHand = hand.clone();

    // Turn toward the paddle side and into the swing; lean over low or far-forward balls.
    // Backhands (bat across the body) turn the bat shoulder further round.
    const twistTarget = clamp(-hand.x * (hand.x * side < 0 ? 0.85 : 0.55) - this.swingVel * 0.05, -0.75, 0.75);
    this.twist = this.spring('twist', twistTarget, 11, dt);
    const reachDown = clamp((1.15 - drop0 - hand.y) * 0.5, 0, 0.3);
    const reachForward = clamp((-hand.z - 0.3) * 0.25, 0, 0.15);
    this.lean = this.spring('lean', 0.1 + reachDown + reachForward, 9, dt);

    // Reaching for a ball beyond the arm: bend sideways toward it and lean in.
    const sx = side * this.shoulderX;
    const far = Math.max(0, Math.hypot(hand.x - sx, hand.y - (SHOULDER_Y - drop0), hand.z) - COMFORT);
    const sideways = Math.min(1, Math.abs(hand.x - sx) / Math.max(0.01, Math.hypot(hand.x - sx, hand.z)));
    this.sideLean = this.spring('sideLean', -Math.sign(hand.x - sx || 1) * clamp(far * 1.5 * sideways, 0, 0.5), 12, dt);
    this.reachLean = this.spring('reachLean', clamp(far * 1.1 * (1 - sideways * 0.6), 0, 0.35), 12, dt);

    // Ready stance: knees bent, a light bounce on the toes.
    const bounce = Math.sin(time * Math.PI * 2 * 1.4) * (1 - this.stride * 2);
    let bend = 0.24 + this.lean * 0.35 + bounce * 0.03;
    let lean = this.lean;
    // Seated, the shoulders turn part of the way with the chair under them.
    let twist = this.twist + this.chairYaw * 0.5;
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
    // Seated: a little lean into each push on the rim.
    if (this.seated && !r) lean += this.push.w * (this.push.rec < 0 ? 0.1 : 0.03);
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
    // Seated, the free hand rests out by the wheel's push rim (and pushes it when moving).
    if (this.seated && r) this.push.w = 0;
    if (this.seated && !r) {
      freeX = 0.25;
      freeZ = 0.45;
      elbow = 0.5;
    }
    this.freeArm.rotation.set(freeX, 0, fs * freeZ, 'XYZ');
    this.freeElbow.rotation.set(elbow, 0, 0);
  }

  /**
   * Wheeling about: the chair turns toward where she's heading (and back to square
   * once she stops), the rear wheels roll at their own speeds (forward drive plus the
   * turn: they counter-rotate when she spins on the spot), the front casters swivel to
   * trail the travel, and the free hand works the push rim on its side.
   */
  private wheelAbout(dt: number, body: { x: number; z: number }) {
    if (dt <= 0) return;
    // Body velocity in the character's frame (it faces local −z).
    const prev = this.lastBodyChair ?? body;
    this.lastBodyChair = { x: body.x, z: body.z };
    const ry = this.group.rotation.y;
    const wx = (body.x - prev.x) / dt;
    const wz = (body.z - prev.z) / dt;
    const lx = wx * Math.cos(ry) - wz * Math.sin(ry);
    const lz = wx * Math.sin(ry) + wz * Math.cos(ry);
    this.vel.x = approach(this.vel.x, lx, 10, dt);
    this.vel.z = approach(this.vel.z, lz, 10, dt);
    // Heading: swing the footplate toward the side she's wheeling to.
    const yawTarget = clamp(-this.vel.x * 0.42, -0.6, 0.6);
    const yaw0 = this.chairYaw;
    this.chairYaw = this.spring('chairYaw', yawTarget, 6, dt);
    const omega = (this.chairYaw - yaw0) / dt;
    this.chair.rotation.y = this.chairYaw;
    // Velocity in the chair's own frame: forward drive along its heading.
    const c = Math.cos(this.chairYaw);
    const s = Math.sin(this.chairYaw);
    const cx = this.vel.x * c - this.vel.z * s;
    const cz = this.vel.x * s + this.vel.z * c;
    const forward = -cz;
    // Each rear wheel: forward drive ± the turn (turning left drives the right wheel on).
    const rollL = (forward - omega * TRACK) * dt;
    const rollR = (forward + omega * TRACK) * dt;
    this.wheelRoll[0] += rollL;
    this.wheelRoll[1] += rollR;
    this.wheelSpin[0].rotation.x = -this.wheelRoll[0] / WHEEL_R;
    this.wheelSpin[1].rotation.x = -this.wheelRoll[1] / WHEEL_R;
    // Casters: velocity at each pivot (chair motion + the turn), the wheel trailing behind it.
    for (const k of this.casters) {
      const pz = -0.5;
      const vx = cx + omega * pz;
      const vz = cz - omega * k.x;
      const v = Math.hypot(vx, vz);
      if (v > 0.05) {
        const target = Math.atan2(-vx, -vz);
        const cur = k.pivot.rotation.y;
        k.pivot.rotation.y = cur + angleDiff(target, cur) * (1 - Math.exp(-clamp(v * 18, 0, 22) * dt));
      }
      k.roll += v * dt;
      k.spin.rotation.x = -k.roll / CASTER_R;
    }

    // Free hand on the rim of the wheel on its side: rides round with the rim while it
    // drives, then lifts off and swings back for the next stroke.
    const p = this.push;
    const wheel = this.lastFreeSide < 0 ? 0 : 1;
    const roll = wheel === 0 ? rollL : rollR;
    const rimSpeed = Math.abs(roll) / dt;
    if (wheel !== p.wheel) {
      // The free hand changed sides with the paddle: start fresh on the new wheel.
      p.wheel = wheel;
      p.w = 0;
      p.rec = -1;
      p.theta = roll >= 0 ? PUSH_FROM : PUSH_TO;
    }
    p.w = approach(p.w, rimSpeed > 0.25 ? 1 : 0, rimSpeed > 0.25 ? 7 : 4, dt);
    if (p.rec >= 0) {
      p.rec += dt / clamp(0.55 - rimSpeed * 0.12, 0.25, 0.45);
      const k = Math.min(1, p.rec);
      const e = k * k * (3 - 2 * k);
      p.theta = p.recFrom + (p.recTo - p.recFrom) * e;
      p.lift = Math.sin(Math.PI * k);
      if (p.rec >= 1) p.rec = -1;
    } else {
      p.lift = 0;
      if (p.w < 0.05) p.theta = approach(p.theta, 0, 6, dt);
      else p.theta += roll / WHEEL_R; // the hand turns with the wheel
      if (p.theta > PUSH_TO) Object.assign(p, { rec: 0, recFrom: PUSH_TO, recTo: PUSH_FROM });
      else if (p.theta < PUSH_FROM) Object.assign(p, { rec: 0, recFrom: PUSH_FROM, recTo: PUSH_TO });
    }
  }
  private lastBodyChair: { x: number; z: number } | null = null;
  private lastFreeSide = 1;

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
