import * as THREE from 'three';
import type { MaterialKit } from './body';
import { HEAD_W, shell, type Layout } from './face';
import { tube, type Ring } from './shapes';
import { blend } from './skin';

/** Where a ponytail is tied (the head's own frame, m): rig.ts hangs its swinging bone here. */
export const PONYTAIL_TIE = new THREE.Vector3(0, -0.01, 0.11);

/**
 * Hair, in the head's own frame (the middle of the head at the origin, the face toward −z):
 * a layer grown out of the scalp inside a real hairline (across the forehead, back at the
 * temples, sideburns, over the ears, down to the nape), fading out at its edges over hair
 * painted on the scalp, with strands running down from the crown. Styles add volume on
 * top, a tousled top and a fringe, short spikes, a side parting, or a ponytail.
 */
export interface HairStyle {
  /** How thick the hair lies on the head (m). */
  thickness: number;
  /** Extra on top (m). */
  top?: number;
  /** Raise (+) or lower (−) the front hairline (m). */
  hairline?: number;
  /** Lumpy, tousled top, with a few locks falling forward (0 to 1). */
  tousled?: number;
  /** Short spikes standing up at the front and top. */
  spikes?: boolean;
  /** A side parting at this x (m; + is the wearer's left), the hair swept away from it. */
  parting?: number;
  /** Pulled back into a ponytail (and a hair tie). */
  ponytail?: { tie: number };
}

/** The hairline's height (m from the middle of the head) going round from the front (0) to the back (π). */
const LINE: [number, number][] = [
  [0, 0.074],
  [0.45, 0.068],
  [0.8, 0.05],
  [1.05, 0.032],
  [1.25, 0.002],
  [1.4, -0.012], // the bottom of the sideburn, in front of the ear
  [1.62, 0.018], // up to the top of the ear
  [1.92, 0.022], // over it
  [2.15, -0.02], // down behind it
  [2.5, -0.058],
  [Math.PI, -0.066], // the nape
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** The hairline's height at an angle round the head (0 at the front, ±π at the back). */
export function hairlineY(theta: number, style: HairStyle, L: Layout) {
  const a = Math.abs(theta);
  let y = LINE[LINE.length - 1][1];
  for (let i = 1; i < LINE.length; i++) {
    if (a <= LINE[i][0]) {
      const [a0, y0] = LINE[i - 1];
      const [a1, y1] = LINE[i];
      const t = (a - a0) / (a1 - a0);
      y = y0 + (y1 - y0) * (t * t * (3 - 2 * t));
      break;
    }
  }
  // A longer face has its hairline higher; the style can raise or lower the front.
  const front = smooth(1.2, 0.3, a);
  return y + (L.long - 1) * 0.04 + (style.hairline ?? 0) * front;
}

/** How much hair grows at a point of the head (0 to 1): above the hairline, softly. */
export function hairMask(p: THREE.Vector3, style: HairStyle, L: Layout) {
  const theta = Math.atan2(p.x, -p.z);
  // Softened round the head as well as up and down (where the line turns steeply, as at
  // the sideburns, a purely up-and-down edge would show the mesh's steps).
  let m = 0;
  for (const d of [-0.08, -0.04, 0, 0.04, 0.08]) {
    const y = hairlineY(theta + d, style, L);
    m += smooth(y - 0.008, y + 0.014, p.y);
  }
  return m / 5;
}

/** A cheap bumpy field for tousled hair. */
const lumps = (p: THREE.Vector3) => Math.sin(p.x * 61 + p.z * 23) * Math.cos(p.y * 47 + p.x * 19) + 0.6 * Math.sin(p.z * 71 - p.y * 31);

/**
 * Add the hair to `add` (meshes in the head's frame). `head` is the sculpted head's
 * geometry; `color` the hair, `temples` an optional grey low on the sides.
 */
export function dressHair(
  add: (geo: THREE.BufferGeometry, material: THREE.Material) => THREE.Mesh,
  head: THREE.BufferGeometry,
  style: HairStyle,
  L: Layout,
  kit: MaterialKit,
  color: number,
  temples?: number,
  bones?: { head: THREE.Bone; tail: THREE.Bone | null },
) {
  const thick = (p: THREE.Vector3) => {
    let t = style.thickness + (style.top ?? 0) * smooth(0.02, 0.09, p.y);
    if (style.tousled) t += style.tousled * 0.0045 * lumps(p) * smooth(0.03, 0.08, p.y);
    if (style.parting !== undefined) {
      // Thin along the parting; fuller on the side it's swept to.
      const d = p.x - style.parting;
      const top = smooth(0.04, 0.08, p.y) * smooth(0.06, -0.02, p.z);
      t -= 0.75 * t * Math.exp(-((d / 0.005) ** 2)) * top;
      t += 0.004 * smooth(0, -0.05, d) * top;
    }
    return Math.max(0.0015, t);
  };
  const geo = shell(head, (p) => hairMask(p, style, L), thick, { fade: true });
  // Strands run down from the crown: texture coordinates round the head and down from the top.
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  const col = geo.getAttribute('color');
  const hair = new THREE.Color(color);
  const grey = temples !== undefined ? new THREE.Color(temples) : null;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    let around = Math.atan2(p.x, -p.z) / (Math.PI * 2) + 0.5;
    // Swept from the parting: the strands lean away from it.
    if (style.parting !== undefined) around += (p.x - style.parting) * 0.6 * smooth(0.03, 0.08, p.y);
    const down = Math.acos(THREE.MathUtils.clamp(p.y / p.length(), -1, 1)) / Math.PI;
    uv.setXY(i, around * 7, down * 3);
    // Colour: greying low on the sides and back, if any.
    const k = grey ? smooth(0.045, 0.0, p.y) * smooth(0.03, 0.06, Math.abs(p.x)) : 0;
    const c = grey ? hair.clone().lerp(grey, k) : hair;
    col.setXYZ(i, c.r, c.g, c.b);
  }
  const mat = kit.hairFade(color);
  mat.color.set(0xffffff); // the colour is in the points
  add(geo, mat);
  const solid = kit.mat(color);

  if (style.spikes) {
    // Short spikes, standing up and a little forward, over the front and top.
    for (let i = 0; i < 30; i++) {
      const phi = -Math.PI / 2 + (i - 14.5) * 0.17;
      const th = 0.22 + ((i * 7) % 5) * 0.11;
      const n = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      const at = n.clone().multiply(new THREE.Vector3(HEAD_W, 0.11 * L.long, 0.1)).multiplyScalar(1.02);
      const spike = add(new THREE.ConeGeometry(0.0075, 0.024, 6).translate(0, 0.009, 0), solid);
      spike.position.copy(at);
      spike.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n.add(new THREE.Vector3(0, 0.8, -0.25)).normalize());
    }
  }
  if (style.tousled) {
    // A few locks falling forward over the forehead, and some standing up on top.
    for (let i = 0; i < 9; i++) {
      const x = (i - 4) * 0.013 + Math.sin(i * 3.1) * 0.004;
      const lock = add(lockGeometry(0.0075, 0.04 + (i % 3) * 0.008, 0.9 + (i % 2) * 0.5), solid);
      const y = hairlineY(Math.atan2(x, 0.09), style, L) + 0.014 + (i % 2) * 0.006;
      lock.position.set(x, y, -Math.sqrt(Math.max(0, 0.1 ** 2 * (1 - (x / HEAD_W) ** 2 - (y / (0.11 * L.long)) ** 2))) - 0.004);
      lock.rotation.set(-1.1 - (i % 3) * 0.15, Math.sin(i) * 0.4, Math.sin(i * 2.3) * 0.35);
    }
  }
  if (style.ponytail) {
    // Gathered at the back of the head, a tie, the tail hanging down and back.
    const tieY = PONYTAIL_TIE.y;
    const back = PONYTAIL_TIE.z - 0.006;
    const tie = add(new THREE.TorusGeometry(0.016, 0.006, 8, 18), kit.mat(style.ponytail.tie));
    tie.position.set(0, tieY, back + 0.006);
    const rings: Ring[] = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      rings.push({
        y: tieY - t * 0.2,
        rx: 0.019 * (1 - t) ** 0.6 + 0.004,
        rz: 0.016 * (1 - t) ** 0.6 + 0.003,
        cz: back + 0.012 + 0.032 * Math.sin(t * Math.PI * 0.8),
      });
    }
    const tail = add(tube(rings, { segments: 14, capStart: 0.01, capEnd: 0.012 }), solid);
    // It swings: going from the head at the tie to the ponytail's bone along its length.
    if (bones?.tail) {
      const { head, tail: bone } = bones;
      blend(tail, (q) => {
        const t = Math.min(1, Math.max(0, (tieY - q.y) / 0.06));
        return [
          [head, 1 - t],
          [bone, t],
        ];
      });
    }
  }
}

/** A lock of hair: a tapered tube curling over (curl: how far it bends, rad). */
function lockGeometry(r: number, len: number, curl: number) {
  const rings: Ring[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    const a = curl * t * t;
    rings.push({ y: t * len, rx: r * (1 - t * 0.85), rz: r * 0.55 * (1 - t * 0.85), cz: -len * 0.5 * (1 - Math.cos(a)) });
  }
  return tube(rings, { segments: 8, capStart: 0.004 });
}

/**
 * Where hair is painted on the scalp under the hair layer (0 to 1), as seen from the
 * front (for the face texture): above the hairline, a little beyond it so the layer's
 * faded edge sits over hair colour.
 */
export function scalpPaint(style: HairStyle, L: Layout) {
  return (x: number, y: number) => {
    const z = -0.1 * Math.sqrt(Math.max(0, 1 - (x / HEAD_W) ** 2 - (y / (0.11 * L.long)) ** 2));
    const theta = Math.atan2(x, -z);
    const line = hairlineY(theta, style, L);
    // Only round the front: seen from the front the sides are squeezed into a few pixels,
    // so there the hair layer's own soft edge does the job.
    return smooth(line - 0.001, line + 0.009, y) * smooth(0.056, 0.04, Math.abs(x));
  };
}
