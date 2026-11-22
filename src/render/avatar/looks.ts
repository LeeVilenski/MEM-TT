import * as THREE from 'three';
import type { StyleId } from '../../game/styles';
import { BRYONY, ED, GEORGE_SHIRTS, LEE, PAUL_SHIRTS, RYAN, type Fabric } from '../fabric';
import type { HairStyle } from './hair';

/**
 * What each character looks like: clothes, colours, build, face and extras. Eight are
 * modelled on real people (Lee, Ed, Ryan, Will, Dan, Paul, Bryony, George) from their
 * clothes, hair and build. body.ts and head.ts turn a look into meshes on the rig.
 */
export type Mat = (c: number) => THREE.Material;

/** Helpers for placing details on the torso surface. */
export interface TorsoShape {
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

export interface Face {
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

  /** Teardrop aviator lenses (with `glasses` as the frame colour). */
  aviators?: boolean;
}

export interface Look {
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
  /** Extra pieces on the clothes (collars, lanyards), placed at heights on the standing body. */
  accessory?: (g: THREE.Object3D, mat: Mat, torso: TorsoShape) => void;
  /**
   * Extra hair (tufts, a ponytail), placed at heights on the standing body like the rest
   * of the head, but carried by the head joint so it moves with the head.
   */
  hairPieces?: (g: THREE.Object3D, mat: Mat) => void;
  /** How the hair is cut (short and close by default). */
  hairStyle?: HairStyle;
}

export const LOOKS: Record<StyleId, Look> = {
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
    },
    hairStyle: { thickness: 0.009, top: 0.01, tousled: 1 },
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
    hairStyle: { thickness: 0.008, top: 0.008 },
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
    hairStyle: { thickness: 0.005, top: 0.003, spikes: true },
    // Short spiky hair greying at the sides, a salt-and-pepper goatee, aviators and a big grin.
    face: { mouth: 'grin', stubble: { color: 0x4f453d, density: 1.6, goatee: true }, temples: 0x837d77, aviators: true, jaw: 0.97 },
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
    hairStyle: { thickness: 0.006, top: 0.004, ponytail: { tie: 0x1f2937 } },
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
    },
    hairStyle: { thickness: 0.006, top: 0.013, parting: 0.026 },
  },
};

/** Exported for tests: every style has a look. */
export const AVATAR_STYLES = Object.keys(LOOKS) as StyleId[];
