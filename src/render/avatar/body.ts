import * as THREE from 'three';
import { heightUVs, paint, type Fabric } from '../fabric';
import { CASTER_R, FORE, HIP, SEAT_DROP, SHOULDER_Y, THIGH, SHIN, UPPER, WHEEL_R, torsoHalfDepth, torsoHalfWidth } from './dimensions';
import { GRIP, HELD as HELD_IN_HAND, HOLD, RELAXED, batGrip, handGeometry } from './hand';
import { dressHead } from './head';
import { trainer, tube, type Ring } from './shapes';
import { blend, smoothstep } from './skin';
import type { Look, Mat, TorsoShape } from './looks';
import type { ArmJoints, AvatarRig } from './rig';

/**
 * The body drawn round the rig: smooth primitives (a tapered torso, limb segments,
 * hands, shoes, clothes) hung on the rig's joints. The head is in head.ts.
 */

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
  [0, 0.72],
  [0.3, 0.712],
  [0.55, 0.69],
  [0.72, 0.7],
  [0.8, 0.73],
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

/** Rings scaled out by `k` (a garment over a limb) or grown by `add` metres. */
const grow = (rings: Ring[], k: number, add = 0): Ring[] => rings.map((r) => ({ ...r, rx: r.rx * k + add, rz: (r.rz ?? r.rx) * k + add }));

/**
 * Leg shape, in the hip joint's frame, standing, from the hip down to the ankle: a thigh
 * fuller at the top and over the front, a kneecap forward, a calf bulging high at the
 * back, a slim ankle. One tube, so the knee bends smoothly. The character faces −z.
 */
const LEG_RINGS: Ring[] = [
  { y: 0.03, rx: 0.074, rz: 0.077 },
  { y: -0.08, rx: 0.071, rz: 0.075, cz: 0.003 },
  { y: -0.2, rx: 0.063, rz: 0.066, cz: 0.002 },
  { y: -0.32, rx: 0.054, rz: 0.054, cz: -0.001 },
  { y: -0.385, rx: 0.048, rz: 0.048, cz: -0.004 },
  { y: -THIGH, rx: 0.046, rz: 0.048, cz: -0.007 },
  { y: -THIGH - 0.035, rx: 0.045, rz: 0.046, cz: -0.002 },
  { y: -THIGH - 0.09, rx: 0.05, rz: 0.056, cz: 0.012 },
  { y: -THIGH - 0.15, rx: 0.048, rz: 0.053, cz: 0.011 },
  { y: -THIGH - 0.23, rx: 0.038, rz: 0.039, cz: 0.004 },
  { y: -THIGH - 0.31, rx: 0.031, rz: 0.031 },
  { y: -THIGH - SHIN - 0.005, rx: 0.03, rz: 0.032, cz: 0.002 },
];
/** Socks: over the ankle, in the knee's frame. */
const SOCK_RINGS: Ring[] = [
  { y: -0.27, rx: 0.0365, rz: 0.0375, cz: 0.003 },
  { y: -0.31, rx: 0.0338, rz: 0.0338 },
  { y: -SHIN - 0.005, rx: 0.0328, rz: 0.0348, cz: 0.002 },
];
/** Shorts: from the waist to mid-thigh, loose and flared, with a hem. */
const SHORTS_RINGS: Ring[] = [
  { y: 0.07, rx: 0.09, rz: 0.093 },
  { y: -0.05, rx: 0.091, rz: 0.093, cz: 0.003 },
  { y: -0.17, rx: 0.09, rz: 0.09, cz: 0.004 },
  { y: -0.27, rx: 0.089, rz: 0.088, cz: 0.004 },
];
/** Trousers: roomier than the leg, straight down from the knee to a hem over the shoe. */
const TROUSER_RINGS: Ring[] = [
  { y: 0.05, rx: 0.087, rz: 0.09 },
  { y: -0.1, rx: 0.084, rz: 0.086, cz: 0.004 },
  { y: -0.25, rx: 0.072, rz: 0.074, cz: 0.003 },
  { y: -0.38, rx: 0.062, rz: 0.062 },
  { y: -THIGH, rx: 0.059, rz: 0.061, cz: -0.003 },
  { y: -THIGH - 0.04, rx: 0.06, rz: 0.062, cz: 0.005 },
  { y: -THIGH - 0.14, rx: 0.061, rz: 0.064, cz: 0.008 },
  { y: -THIGH - 0.28, rx: 0.056, rz: 0.057, cz: 0.004 },
  { y: -THIGH - SHIN + 0.01, rx: 0.057, rz: 0.058 },
  { y: -THIGH - SHIN - 0.012, rx: 0.059, rz: 0.06 },
];
/**
 * Arm shape, from the shoulder down the arm (+y) at rest: a shoulder and biceps, the
 * elbow, a forearm thick below the elbow and flatter at the wrist. One tube, bending at
 * the elbow.
 */
const ARM_RINGS: Ring[] = [
  { y: 0, rx: 0.045 },
  { y: 0.042, rx: 0.046 },
  { y: 0.135, rx: 0.041, rz: 0.043 },
  { y: 0.24, rx: 0.036 },
  { y: UPPER - 0.01, rx: 0.034, rz: 0.035 },
  { y: UPPER + 0.02, rx: 0.035, rz: 0.035 },
  { y: UPPER + 0.06, rx: 0.039, rz: 0.037 },
  { y: UPPER + 0.12, rx: 0.035, rz: 0.033 },
  { y: UPPER + 0.2, rx: 0.029, rz: 0.025 },
  { y: UPPER + FORE, rx: 0.027, rz: 0.022 },
];
/** A short sleeve round the top of the arm (in the shoulder joint's frame, down the arm along +y), with a hem. */
const SLEEVE: Ring[] = [
  { y: -0.03, rx: 0.056 },
  { y: 0.05, rx: 0.055 },
  { y: 0.12, rx: 0.054 },
];
/** The neck, on the standing body: set back a little, flaring into the shoulders. */
const NECK: Ring[] = [
  { y: 1.42, rx: 0.062, rz: 0.058, cz: 0.012 },
  { y: 1.47, rx: 0.05, rz: 0.05, cz: 0.012 },
  { y: 1.53, rx: 0.046, rz: 0.048, cz: 0.01 },
  { y: 1.58, rx: 0.045, rz: 0.047, cz: 0.006 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/** Which colours of a look are skin, hair and clothes (they get their own kinds of material). */
export interface Palette {
  skin: number;
  hair: number[];
  cloth: number[];
}

/**
 * Hair strands: fine streaks running from the crown down (along the hair cap's v), as a
 * grey bump map.
 */
function strands() {
  return paint('hair:strands', (p) => {
    let seed = 7;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    p.c.fillStyle = 'rgb(200,200,200)';
    p.c.fillRect(0, 0, p.w, p.h);
    for (let i = 0; i < 900; i++) {
      const x = r() * p.w;
      const y = r() * p.h;
      const len = 30 + r() * 90;
      const g = Math.round(140 + r() * 115);
      p.c.strokeStyle = `rgba(${g},${g},${g},${0.5 + r() * 0.5})`;
      p.c.lineWidth = 0.6 + r() * 1.4;
      p.wrap(x, (wx) => {
        p.c.beginPath();
        p.c.moveTo(wx, y);
        p.c.quadraticCurveTo(wx + (r() - 0.5) * 6, y + len / 2, wx + (r() - 0.5) * 8, y + len);
        p.c.stroke();
      });
    }
  }, 256, 256, true);
}

/**
 * The character's materials: plain colours shared by colour, painted fabrics and
 * see-through decals. All of them fade together for a see-through character.
 *
 * Skin and clothes get a sheen, a soft glow at grazing angles: on skin, warm and reddish
 * (light scattering just under the surface); on cloth, the soft rim of a woven fabric.
 * Hair gets fine strands. Everything else (eyes, teeth, glasses, the wheelchair) is plain.
 */
export class MaterialKit {
  readonly list: THREE.MeshStandardMaterial[] = [];
  readonly solid: boolean;
  private cache = new Map<number, THREE.MeshStandardMaterial>();
  private hair: Set<number>;
  private cloth: Set<number>;

  constructor(
    private palette: Palette,
    private opacity: number,
  ) {
    this.solid = opacity >= 1;
    this.hair = new Set(palette.hair);
    this.cloth = new Set(palette.cloth);
  }

  /** Fading for a see-through character. */
  private get fade() {
    return { transparent: !this.solid, opacity: this.opacity, depthWrite: this.solid };
  }

  /** A colour, as skin, hair, cloth or plain by which of the look's colours it is. */
  mat = (c: number) => {
    let m = this.cache.get(c);
    if (!m) {
      if (c === this.palette.skin) m = this.skin(c);
      else if (this.hair.has(c)) m = this.hairOf(c);
      else if (this.cloth.has(c)) m = this.cloth_(c);
      else m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.82, ...this.fade });
      this.cache.set(c, m);
      this.list.push(m);
    }
    return m;
  };

  private skin(c: number) {
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.55,
      sheen: 0.55,
      sheenRoughness: 0.4,
      sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xff5a3c), 0.45),
      ...this.fade,
    });
  }

  private hairOf(c: number) {
    const tex = strands();
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.62,
      sheen: 0.5,
      sheenRoughness: 0.35,
      sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.35),
      bumpMap: tex,
      bumpScale: 1.2,
      ...this.fade,
    });
  }

  private cloth_(c: number) {
    return new THREE.MeshPhysicalMaterial({
      color: c,
      roughness: 0.86,
      sheen: 0.3,
      sheenRoughness: 0.55,
      sheenColor: new THREE.Color(c).lerp(new THREE.Color(0xffffff), 0.12),
      ...this.fade,
    });
  }

  /** A painted fabric (null where nothing can be painted: plain colours are used instead). */
  tex = (tex: THREE.Texture | null) => {
    if (!tex) return null;
    const m = new THREE.MeshPhysicalMaterial({ map: tex, roughness: 0.86, sheen: 0.3, sheenRoughness: 0.55, sheenColor: 0x3a3a3a, ...this.fade });
    this.list.push(m);
    return m;
  };

  /** See-through layers on the face (stubble, blush), optionally tinted. */
  decal = (tex: THREE.Texture | null, color = 0xffffff) => {
    if (!tex) return null;
    const m = new THREE.MeshStandardMaterial({ map: tex, color, roughness: 0.95, transparent: true, opacity: this.opacity, depthWrite: false });
    this.list.push(m);
    return m;
  };

  /** A material of its own (not shared by colour), still faded and disposed with the rest. */
  own = (params: THREE.MeshStandardMaterialParameters) => {
    const m = new THREE.MeshStandardMaterial({ ...this.fade, ...params });
    this.list.push(m);
    return m;
  };
}

/**
 * Dress the rig: legs, hips, torso, shoulders, neck, head, arms, extras and (seated) the
 * wheelchair, as meshes on the rig's bones (skin.ts then bakes them into skinned meshes).
 */
export function dressBody(rig: AvatarRig, look: Look, fabric: Fabric | undefined, kit: MaterialKit) {
  const mat = kit.mat;
  // Painted fabrics: one material for the torso, one for the sleeves (null: plain colours).
  const shirtMat = fabric ? kit.tex(paint(`${fabric.id}:torso`, fabric.torso, 1024, 512)) : null;
  const sleeveMat = fabric?.sleeve ? kit.tex(paint(`${fabric.id}:sleeve`, fabric.sleeve, 256, 256, true)) : null;
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number, parent: THREE.Object3D = rig.upperAbs) => {
    const m = new THREE.Mesh(geo, mat(color));
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };
  const build = look.build ?? 1;
  const halfW = torsoHalfWidth(build);
  const halfD = torsoHalfDepth(build);
  const sleeveColor = look.sleeves === 'none' ? null : (look.sleeves ?? look.shirt);

  // ---- legs
  const shoe = trainer();
  for (const { hip, knee, foot } of rig.legs) {
    if (look.legs.kind === 'shorts') {
      // Flared shorts to mid-thigh, then bare legs, white socks.
      // Shorts hang from the waist (the hips) and follow the thigh below.
      blend(add(tube(SHORTS_RINGS, { hemEnd: 0.02 }), look.legs.color, 0, 0, 0, hip), (q) => {
        const w = smoothstep(-0.03, 0.06, q.y);
        return [
          [rig.pelvis, w],
          [hip, 1 - w],
        ];
      });
      blend(add(tube(LEG_RINGS), look.skin, 0, 0, 0, hip), kneeBend(hip, knee));
      add(tube(SOCK_RINGS, { hemEnd: 0.008 }), 0xf1f2f4, 0, 0, 0, knee);
    } else {
      blend(add(tube(TROUSER_RINGS, { hemEnd: 0.015 }), look.legs.color, 0, 0, 0, hip), kneeBend(hip, knee));
    }
    // Trainer: an upper with a heel collar and tongue, on a pale sole.
    add(shoe.upper.clone(), look.shoes ?? 0x27272a, 0, 0, 0, foot);
    add(shoe.sole.clone(), 0xe5e7eb, 0, 0, 0, foot);
  }
  shoe.upper.dispose();
  shoe.sole.dispose();
  // Hips and waistband move with the legs, not the twisting upper body.
  rig.pelvis.add(new THREE.Mesh(lathe(PELVIS, halfW * 0.98, halfD * 0.98), mat(look.legs.color)));
  if (look.wheelchair) dressWheelchair(rig, look.wheelchair, kit);

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
  // The bottom of the shirt goes with the hips, so a lean or a twist bends at the waist.
  blend(torsoMesh, (q) => {
    const w = smoothstep(0.8, 1.0, q.y);
    return [
      [rig.pelvis, 1 - w],
      [rig.upperAbs, w],
    ];
  });
  // Shoulder caps: sleeves (or bare skin for a vest) round off where the arms join.
  for (const side of [-1, 1]) {
    const cap = add(new THREE.SphereGeometry(0.057, 16, 12), sleeveColor ?? look.skin, side * rig.shoulderX, SHOULDER_Y, 0);
    cap.scale.set(1, 0.9, 1);
    if (sleeveColor !== null && sleeveMat) cap.material = sleeveMat;
  }
  if (sleeveColor === null) {
    // Vest straps over bare shoulders.
    for (const side of [-1, 1]) {
      const strap = add(new THREE.BoxGeometry(0.05, 0.03, halfD * 1.9), look.shirt, side * halfW * 0.55, 1.455, 0);
      strap.rotation.z = side * -0.35;
    }
  }
  // The neck bends as the head turns: its top goes with the head.
  blend(add(tube(NECK), look.skin, 0, 0, 0), (q) => {
    const w = smoothstep(1.49, 1.565, q.y);
    return [
      [rig.upperAbs, 1 - w],
      [rig.head, w],
    ];
  });
  const headAbs = dressHead(rig.head, rig.eyes, look, kit);

  // ---- arms
  // The racket arm runs along +y from the shoulder; the free arm hangs along −y.
  dressArm(rig.arm, 1, look, mat, sleeveColor, sleeveMat);
  dressArm(rig.free, -1, look, mat, sleeveColor, sleeveMat);
  if (look.watch !== undefined) add(new THREE.CylinderGeometry(0.031, 0.031, 0.026, 14), look.watch, 0, -(FORE - 0.03), 0, rig.free.fore);

  // ---- hands
  const s = rig.batHand;
  // Racket hand: built round the handle in the bat's frame (the hand joint's frame),
  // mirrored across the bat for a left hand.
  const grip = batGrip();
  const gripFrame = new THREE.Group();
  gripFrame.name = 'grip';
  gripFrame.position.set(-s * grip.wrist.x, -grip.wrist.y, -grip.wrist.z); // the middle of the handle
  gripFrame.scale.x = s;
  const batHand = new THREE.Mesh(handGeometry(GRIP), mat(look.skin));
  batHand.position.copy(grip.wrist);
  batHand.quaternion.copy(grip.rotation);
  gripFrame.add(batHand);
  rig.arm.hand.add(gripFrame);
  // Free hand: hanging loose (or round a bottle), palm to the thigh, thumb forward. Built
  // for a right hand on the right; mirrored for the left.
  const fs = -s;
  const freeFrame = new THREE.Group();
  freeFrame.scale.x = fs;
  const freeHand = new THREE.Mesh(handGeometry(look.bottle !== undefined ? HOLD : RELAXED), mat(look.skin));
  // Hand frame → arm: fingers down (−y), palm inward (−x), thumb forward (−z).
  freeHand.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, -1, 0), new THREE.Vector3(-1, 0, 0)));
  freeFrame.add(freeHand);
  rig.free.hand.add(freeFrame);
  if (look.bottle !== undefined) {
    // Held across the fingers, cap up by the thumb.
    const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.17, 16).rotateZ(-Math.PI / 2), mat(look.bottle));
    bottle.position.copy(HELD_IN_HAND);
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.017, 0.02, 0.03, 10).rotateZ(-Math.PI / 2), mat(0xf3f4f6));
    cap.position.x = 0.1;
    bottle.add(cap);
    freeHand.add(bottle);
  }

  look.accessory?.(rig.upperAbs, mat, torso);
  look.hairPieces?.(headAbs, mat);
}

/**
 * An arm: one tube from the shoulder to the wrist (bending at the elbow, stretching with
 * the stretch bones, twisting along the forearm with the twist bones), a little elbow,
 * and a short sleeve (if any). `dir`: +1 if the arm's bones run along +y, −1 along −y.
 * The hands are added separately.
 */
function dressArm(j: ArmJoints, dir: 1 | -1, look: Look, mat: Mat, sleeveColor: number | null, sleeveMat: THREE.Material | null) {
  // Long sleeves cover the arm down to the wrist (a touch thicker than bare skin).
  const armColor = look.longSleeves && sleeveColor !== null ? sleeveColor : look.skin;
  const thick = armColor === look.skin ? 1 : 1.15;
  const armMat = armColor !== look.skin && sleeveMat ? sleeveMat : mat(armColor);
  const arm = new THREE.Mesh(tube(grow(ARM_RINGS, thick)), armMat);
  if (dir < 0) arm.rotation.x = Math.PI;
  j.upper.add(arm);
  const forearm = [j.foreStretch, ...j.twist];
  blend(arm, (q) => {
    const y = q.y; // along the arm, in the tube's own frame
    const e = smoothstep(UPPER - 0.035, UPPER + 0.035, y);
    // Along the forearm, shared between the elbow end and the three twist bones.
    const u = THREE.MathUtils.clamp((y - UPPER) / FORE, 0, 1) * (forearm.length - 1);
    const out: [THREE.Bone, number][] = [[j.upperStretch, 1 - e]];
    forearm.forEach((b, k) => out.push([b, e * Math.max(0, 1 - Math.abs(u - k))]));
    return out;
  });
  const elbow = new THREE.Mesh(new THREE.SphereGeometry(0.032 * thick, 14, 10), armMat);
  j.fore.add(elbow);
  if (sleeveColor !== null) {
    // A short sleeve over the top of the upper arm (going with the shoulder, not stretched).
    const sleeve = new THREE.Mesh(tube(SLEEVE, { hemEnd: 0.012 }), sleeveMat ?? mat(sleeveColor));
    if (dir < 0) sleeve.rotation.x = Math.PI;
    j.upper.add(sleeve);
  }
}

/** A leg tube's weights: the thigh with the hip, the shin with the knee, shared over the knee. */
function kneeBend(hip: THREE.Bone, knee: THREE.Bone) {
  return (q: THREE.Vector3): [THREE.Bone, number][] => {
    const w = smoothstep(-THIGH + 0.035, -THIGH - 0.035, q.y);
    return [
      [hip, 1 - w],
      [knee, w],
    ];
  };
}

/**
 * A table tennis wheelchair: big cambered rear wheels with push rims, a low back, a
 * cushion, side rails down to small front casters, a footplate and an anti-tip wheel.
 * The moving parts (wheels, casters) hang on the rig's chair joints. The character faces
 * local −z; the hips sit at HIP − SEAT_DROP.
 */
function dressWheelchair(rig: AvatarRig, c: { frame: number; tyre: number }, kit: MaterialKit) {
  const mat = kit.mat;
  const g = new THREE.Group();
  const metal = kit.own({ color: c.frame, metalness: 0.75, roughness: 0.35 });
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
  [-1, 1].forEach((sx, i) => {
    const x = sx * 0.2;
    tube(v(x, seatY - 0.03, 0.12), v(x, seatY - 0.03, -0.4)); // side rail
    tube(v(x, seatY - 0.03, 0.12), v(x, seatY + 0.3, 0.12)); // backrest upright
    tube(v(x, seatY - 0.03, -0.4), v(x * 0.75, 0.13, -0.5)); // down to the footplate
    // Front caster: the fork on the swivel, the small wheel on its spin joint.
    const caster = rig.casters[i];
    const fork = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.1, 8), metal);
    fork.position.set(0, -0.04, 0.015);
    fork.rotation.x = -0.3;
    caster.pivot.add(fork);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(CASTER_R, CASTER_R, 0.022, 14).rotateZ(Math.PI / 2), mat(c.tyre));
    const cHub = new THREE.Mesh(new THREE.BoxGeometry(0.024, 0.012, 0.05), metal);
    caster.spin.add(wheel, cHub);
    // Rear wheel: tyre, rim, push rim, hub and spokes, all turning with the spin joint.
    const spin = rig.wheelSpin[i];
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
  });
  tube(v(-0.3, WHEEL_R, 0.02), v(0.3, WHEEL_R, 0.02), 0.016); // axle bar
  // Footplate, and the anti-tip wheel out behind.
  const plate = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.14), metal);
  plate.position.set(0, 0.12, -0.5);
  g.add(plate);
  tube(v(0, seatY - 0.03, 0.1), v(0, 0.06, 0.34), 0.011);
  const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 12).rotateZ(Math.PI / 2), mat(c.tyre));
  tip.position.set(0, 0.04, 0.36);
  g.add(tip);
  rig.chair.add(g);
}
