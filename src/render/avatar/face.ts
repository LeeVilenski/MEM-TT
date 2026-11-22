import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { paint } from '../fabric';
import type { Face } from './looks';
import { tube, type Ring } from './shapes';

/**
 * The sculpted head, in the head's own frame: the origin at the middle of the head, +y up,
 * the face toward −z, metres.
 *
 * The skull and jaw are the smooth union of two ellipsoids; on top of that, a brow ridge,
 * eye sockets, cheekbones, lips, a chin and the corners of the jaw are pushed in or out.
 * The points of the mesh are gathered toward the face (where the detail is) and thinned
 * at the back (under the hair). The face is painted on: brows, lips, stubble, a little
 * shading round the eyes and nose. The nose is its own small mesh; the eyes are balls
 * that turn under the lids.
 */

/** Half the head's width (m): about 16.5 cm across, a touch over life size. */
export const HEAD_W = 0.083;

/** Where the features are (m from the middle of the head) for a face's proportions. */
export interface Layout {
  /** Lower face drop for a longer face. */
  drop: number;
  jawW: number;
  long: number;
  eyeX: number;
  eyeY: number;
  browY: number;
  noseTopY: number;
  noseTipY: number;
  mouthY: number;
  chinY: number;
}

export function layout(f: Face): Layout {
  const long = f.long ?? 1;
  const drop = (long - 1) * 0.06;
  return {
    drop,
    jawW: f.jaw ?? 1,
    long,
    eyeX: 0.034,
    eyeY: 0.012,
    browY: 0.034,
    noseTopY: 0.008,
    noseTipY: -0.026 - drop * 0.4,
    mouthY: -0.046 - drop,
    chinY: -0.08 - drop,
  };
}

/** Smooth maximum: like max(a, b), rounded over a blend of k (m). */
const smax = (a: number, b: number, k: number) => {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + (h * h * k) / 4;
};
const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
/** A soft bump (1 at the middle) of half-widths sx, sy round (cx, cy). */
const bump = (x: number, y: number, cx: number, cy: number, sx: number, sy: number) => Math.exp(-(((x - cx) / sx) ** 2) - ((y - cy) / sy) ** 2);

/** Distance from the middle of the head out to the bare skull and jaw, along a direction. */
function baseRadius(d: THREE.Vector3, L: Layout) {
  const head = new THREE.Vector3(HEAD_W, 0.11 * L.long, 0.1);
  const jawAt = new THREE.Vector3(0, -0.047 - L.drop, -0.02);
  const jaw = new THREE.Vector3(0.066 * L.jawW, 0.066, 0.079);
  const t1 = 1 / Math.hypot(d.x / head.x, d.y / head.y, d.z / head.z);
  const a = (d.x / jaw.x) ** 2 + (d.y / jaw.y) ** 2 + (d.z / jaw.z) ** 2;
  const b = -2 * ((d.x * jawAt.x) / jaw.x ** 2 + (d.y * jawAt.y) / jaw.y ** 2 + (d.z * jawAt.z) / jaw.z ** 2);
  const c = (jawAt.x / jaw.x) ** 2 + (jawAt.y / jaw.y) ** 2 + (jawAt.z / jaw.z) ** 2 - 1;
  const disc = b * b - 4 * a * c;
  const t2 = disc > 0 ? (-b + Math.sqrt(disc)) / (2 * a) : 0;
  return smax(t1, t2, 0.012);
}

/** How far the sculpting pushes a point of the bare head out (+) or in (−), m. */
function relief(p: THREE.Vector3, L: Layout) {
  const front = smooth(-0.02, -0.06, p.z); // only the face side
  const { x, y } = p;
  let r = 0;
  for (const s of [-1, 1]) {
    // Brow ridge over each eye, sockets under it, cheekbones out to the side.
    r += 0.0045 * bump(x, y, s * 0.03, L.browY - 0.004, 0.02, 0.007);
    r -= 0.0105 * bump(x, y, s * L.eyeX, L.eyeY - 0.001, 0.013, 0.0095);
    r += 0.0055 * bump(x, y, s * 0.05, L.eyeY - 0.024, 0.016, 0.011);
    // A hollow under the cheekbone; the corner of the jaw.
    r -= 0.0025 * bump(x, y, s * 0.048, L.mouthY + 0.01, 0.012, 0.014);
    r += 0.004 * (L.jawW - 0.85) * bump(x, y, s * 0.056, L.mouthY - 0.02, 0.014, 0.018);
    // Temples, a little in.
    r -= 0.003 * bump(x, y, s * 0.068, L.browY, 0.016, 0.02);
  }
  // Between the brows, the lips, the chin.
  r += 0.002 * bump(x, y, 0, L.browY - 0.008, 0.008, 0.008);
  r += 0.0032 * bump(x, y, 0, L.mouthY + 0.006, 0.016, 0.0055);
  r += 0.004 * bump(x, y, 0, L.mouthY - 0.0065, 0.014, 0.006);
  r -= 0.0018 * bump(x, y, 0, L.mouthY - 0.016, 0.014, 0.004); // the dip under the lower lip
  r += 0.006 * bump(x, y, 0, L.chinY + 0.004, 0.015, 0.012);
  return r * front;
}

/**
 * Directions over the sphere, gathered toward the front (−z): the face gets several
 * times the points of the back of the head.
 */
function gather(d: THREE.Vector3) {
  const th = Math.acos(THREE.MathUtils.clamp(-d.z, -1, 1));
  const s = Math.sin(th);
  if (s < 1e-6) return d;
  const th2 = Math.PI * (th / Math.PI) ** 1.45;
  const k = Math.sin(th2) / s;
  return new THREE.Vector3(d.x * k, d.y * k, -Math.cos(th2));
}

/** Texture coordinates for the face: seen from the front, x and y across the painted face. */
export const FACE_UV = { x0: -0.1, x1: 0.1, y0: -0.135, y1: 0.105 };
const faceU = (x: number) => (x - FACE_UV.x0) / (FACE_UV.x1 - FACE_UV.x0);
const faceV = (y: number) => (y - FACE_UV.y0) / (FACE_UV.y1 - FACE_UV.y0);

/** The sculpted skull, jaw and face as one smooth mesh, with face texture coordinates. */
export function sculptHead(L: Layout): THREE.BufferGeometry {
  const sphere = new THREE.SphereGeometry(1, 64, 48);
  sphere.deleteAttribute('uv');
  sphere.deleteAttribute('normal');
  const geo = mergeVertices(sphere); // one point at the seam and poles: smooth all round
  sphere.dispose();
  const pos = geo.getAttribute('position');
  const uv = new Float32Array(pos.count * 2);
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const g = gather(d);
    const p = g.clone().multiplyScalar(baseRadius(g, L));
    p.addScaledVector(g, relief(p, L));
    pos.setXYZ(i, p.x, p.y, p.z);
    uv[i * 2] = faceU(p.x);
    uv[i * 2 + 1] = faceV(p.y);
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/** The face's surface at (x, y), as its z (toward the front, so negative). */
export function frontZ(L: Layout, x: number, y: number) {
  let d = new THREE.Vector3(x, y, -0.1).normalize();
  let p = new THREE.Vector3();
  for (let i = 0; i < 6; i++) {
    p = d.clone().multiplyScalar(baseRadius(d, L));
    p.addScaledVector(d, relief(p, L));
    d = new THREE.Vector3(x, y, p.z).normalize();
  }
  return p.z;
}

/**
 * The nose: a bridge narrow between the eyes, widening to a rounded tip and the wings of
 * the nostrils, tucked back into the face underneath. Its back half sits inside the head.
 */
export function noseGeometry(L: Layout, size = 1) {
  const len = L.noseTopY - L.noseTipY;
  const rings: Ring[] = [];
  const steps = 9;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps; // 0 between the eyes, 1 at the tip
    const y = L.noseTopY - t * len;
    const w = (0.0052 + 0.0035 * t + 0.0055 * smooth(0.6, 1, t)) * size; // half width
    const h = (0.0035 + 0.0125 * t ** 1.25) * size; // how far it stands out
    const face = frontZ(L, 0, y);
    rings.push({ y, rx: w, rz: h, cz: face + 0.002 });
  }
  // Under the tip: back in to the face over the top lip.
  const tipY = L.noseTipY;
  const face = frontZ(L, 0, tipY - 0.008);
  rings.push({ y: tipY - 0.004, rx: 0.0112 * size, rz: 0.012 * size, cz: face + 0.0015 });
  rings.push({ y: tipY - 0.008, rx: 0.0095 * size, rz: 0.006 * size, cz: face + 0.001 });
  return tube(rings, { segments: 18, capStart: 0.004, capEnd: 0.004 });
}

/**
 * A layer grown out of the head: each point pushed out along the surface by `thickness`
 * times the mask (0 to 1), and the parts where the mask is 0 left out. The layer thins to
 * nothing at its edges, so it melts into the face (a beard) or the scalp (hair).
 */
export function shell(
  head: THREE.BufferGeometry,
  mask: (p: THREE.Vector3) => number,
  thickness: number | ((p: THREE.Vector3) => number),
  opts: { fade?: boolean } = {},
) {
  const geo = head.clone();
  const pos = geo.getAttribute('position');
  const nor = geo.getAttribute('normal');
  const m = new Float32Array(pos.count);
  // With `fade`, the edges also fade out (vertex alpha), so the cut-off isn't seen.
  const rgba = opts.fade ? new Float32Array(pos.count * 4).fill(1) : null;
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    m[i] = mask(p);
    if (rgba) rgba[i * 4 + 3] = Math.min(1, m[i] * 1.6) ** 1.5;
    const t = typeof thickness === 'number' ? thickness : thickness(p);
    p.addScaledVector(n, 0.0006 + t * m[i]);
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  const idx = geo.getIndex()!;
  const keep: number[] = [];
  for (let k = 0; k < idx.count; k += 3) {
    const a = idx.getX(k);
    const b = idx.getX(k + 1);
    const c = idx.getX(k + 2);
    if (Math.max(m[a], m[b], m[c]) > 0.02) keep.push(a, b, c);
  }
  geo.setIndex(keep);
  if (rgba) geo.setAttribute('color', new THREE.BufferAttribute(rgba, 4));
  geo.computeVertexNormals();
  return geo;
}

/** Mouth shapes on the painted face. */
type Mouth = NonNullable<Face['mouth']>;

/** A colour for the canvas (in sRGB, as it's drawn; THREE.Color holds linear values). */
const css = (c: number | THREE.Color, a = 1) => {
  const col = (c instanceof THREE.Color ? c : new THREE.Color(c)).getRGB({ r: 0, g: 0, b: 0 }, THREE.SRGBColorSpace);
  return `rgba(${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)},${a})`;
};
/** 1 inside a soft-edged ellipse round (cx, cy), fading to 0 over `soft` (a fraction of its size). */
export const oval = (x: number, y: number, cx: number, cy: number, rx: number, ry: number, soft = 0.35) =>
  smooth(1 + soft, 1 - soft, Math.hypot((x - cx) / rx, (y - cy) / ry));

/**
 * The face's skin, painted: the skin tone with a faint mottle, warmth on the cheeks, nose
 * and lips, a little shade round the eyes and under the nose, the brows as hair strokes,
 * the mouth, and stubble or a goatee.
 */
/**
 * Where a full beard grows (0 to 1), at a point of the head: the jaw, chin and cheeks up to
 * a line from the ear to the corner of the nose, round the mouth, a moustache under the nose.
 */
export function beardMask(L: Layout) {
  return (x: number, y: number, z: number) => {
    const ax = Math.abs(x);
    const top = L.eyeY - 0.03 - Math.max(0, 0.035 - ax) * 0.3;
    const mouth = oval(x, y, 0, L.mouthY - 0.001, 0.026, 0.011, 0.25);
    const underNose = smooth(-0.004, 0.004, y - L.noseTipY + 0.008) * smooth(0.014, 0.008, ax);
    return smooth(top, top - 0.014, y) * smooth(0.05, 0.02, z) * (1 - mouth) * (1 - underNose);
  };
}

export function paintFace(L: Layout, f: Face, skin: number, brow: number, beard?: number) {
  const key = `face:${skin}:${brow}:${JSON.stringify(f)}:${beard}`;
  return paint(key, (p) => {
    const W = p.w;
    const H = p.h;
    const X = (x: number) => faceU(x) * W;
    const Y = (y: number) => (1 - faceV(y)) * H;
    const SX = (m: number) => (m / (FACE_UV.x1 - FACE_UV.x0)) * W;
    const SY = (m: number) => (m / (FACE_UV.y1 - FACE_UV.y0)) * H;
    const c = p.c;
    let seed = 99;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const skinC = new THREE.Color(skin);
    c.fillStyle = css(skinC);
    c.fillRect(0, 0, W, H);
    /** A soft round patch of colour. */
    const glow = (x: number, y: number, rx: number, ry: number, col: string) => {
      c.save();
      c.translate(X(x), Y(y));
      c.scale(SX(rx), SY(ry));
      const g = c.createRadialGradient(0, 0, 0, 0, 0, 1);
      g.addColorStop(0, col);
      g.addColorStop(1, col.replace(/[\d.]+\)$/, '0)'));
      c.fillStyle = g;
      c.beginPath();
      c.arc(0, 0, 1, 0, Math.PI * 2);
      c.fill();
      c.restore();
    };
    // A faint mottle, so the skin isn't plastic.
    for (let i = 0; i < 2600; i++) {
      const a = 0.025 + r() * 0.03;
      c.fillStyle = r() < 0.5 ? `rgba(120,60,50,${a})` : `rgba(255,240,230,${a})`;
      const s = 2 + r() * 5;
      c.fillRect(r() * W, r() * H, s, s);
    }
    const warm = 'rgba(232,124,112,';
    for (const s of [-1, 1]) {
      // Cheeks (rosier for rosy cheeks), and shade round each eye.
      glow(s * 0.05, L.eyeY - 0.026, 0.022, 0.016, f.cheeks !== undefined ? css(f.cheeks, 0.4) : `${warm}0.1)`);
      glow(s * L.eyeX, L.eyeY, 0.018, 0.012, 'rgba(110,60,70,0.2)');
      glow(s * (L.eyeX + 0.012), L.eyeY + 0.006, 0.012, 0.008, 'rgba(110,60,70,0.12)');
      // Nostrils' shade, on the face under the wings.
      glow(s * 0.008, L.noseTipY - 0.007, 0.005, 0.0035, 'rgba(70,30,25,0.5)');
      // Ears warm too (the ear meshes are plain skin; this is the face's edge).
    }
    glow(0, L.noseTipY + 0.004, 0.012, 0.012, `${warm}0.14)`);
    glow(0, L.chinY + 0.004, 0.016, 0.01, `${warm}0.08)`);

    // Stubble or a goatee: speckle where it grows.
    if (f.stubble) {
      const st = f.stubble;
      const col = new THREE.Color(st.color);
      const density = st.density ?? 1;
      const grows = (x: number, y: number) => {
        const ax = Math.abs(x);
        const lips = oval(x, y, 0, L.mouthY - 0.001, 0.024, 0.0095, 0.25);
        if (st.goatee) {
          // A rounded chin piece, a moustache, and the two joined down the sides of the mouth.
          const chin = oval(x, y, 0, L.mouthY - 0.026, 0.021, 0.02, 0.3);
          const tache = oval(x, y, 0, L.mouthY + 0.0125, 0.027, 0.0055, 0.4);
          const sides = smooth(0.032, 0.026, ax) * smooth(0.016, 0.021, ax) * smooth(L.mouthY - 0.024, L.mouthY - 0.016, y) * smooth(L.mouthY + 0.014, L.mouthY + 0.008, y);
          return Math.max(chin, tache, sides) * (1 - lips);
        }
        // Up the cheeks to a line from the ear to the corner of the nose; under the chin.
        const top = L.eyeY - 0.03 - Math.max(0, 0.035 - ax) * 0.25;
        return smooth(top, top - 0.012, y) * smooth(0.1, 0.09, ax) * (1 - lips);
      };
      for (let py = 0; py < H; py += 4)
        for (let px = 0; px < W; px += 4) {
          const x = FACE_UV.x0 + (px / W) * (FACE_UV.x1 - FACE_UV.x0);
          const y = FACE_UV.y1 - (py / H) * (FACE_UV.y1 - FACE_UV.y0);
          const w = grows(x, y);
          if (w <= 0) continue;
          c.fillStyle = css(col, 0.32 * density * w);
          c.fillRect(px, py, 4, 4);
        }
      for (let i = 0; i < 30000 * density; i++) {
        const px = r() * W;
        const py = r() * H;
        const x = FACE_UV.x0 + (px / W) * (FACE_UV.x1 - FACE_UV.x0);
        const y = FACE_UV.y1 - (py / H) * (FACE_UV.y1 - FACE_UV.y0);
        if (r() > grows(x, y)) continue;
        c.fillStyle = css(col, 0.45 + r() * 0.5);
        c.fillRect(px, py, 1 + r(), 1 + r() * 1.6);
      }
    }
    if (beard !== undefined) {
      // Under a full beard, the beard's colour (so where it thins to nothing, it still shows).
      const grows = beardMask(L);
      const col = new THREE.Color(beard);
      for (let py = 0; py < H; py += 2)
        for (let px = 0; px < W; px += 2) {
          const x = FACE_UV.x0 + (px / W) * (FACE_UV.x1 - FACE_UV.x0);
          const y = FACE_UV.y1 - (py / H) * (FACE_UV.y1 - FACE_UV.y0);
          const w = grows(x, y, -0.06);
          if (w <= 0.01) continue;
          c.fillStyle = css(col.clone().multiplyScalar(0.8 + r() * 0.4), Math.min(1, w * 1.3));
          c.fillRect(px, py, 2, 2);
        }
    }

    // Brows: hair strokes along an arch, thicker toward the middle.
    const bw = f.browWeight ?? 1;
    const browC = new THREE.Color(brow);
    for (const s of [-1, 1]) {
      for (let i = 0; i < 260 * bw; i++) {
        const t = r(); // 0 at the inner end, 1 at the outer
        const x = s * (0.011 + t * 0.042);
        const arch = L.browY + 0.0035 * Math.sin(Math.min(1, t * 1.25) * Math.PI) - 0.004 * t * t;
        const thick = (0.0042 - 0.0022 * t) * bw;
        const y = arch + (r() - 0.5) * thick * 2;
        const ang = s * (0.35 + 0.6 * t) + (r() - 0.5) * 0.3; // inner hairs point up, outer ones out
        const len = SX(0.004 + r() * 0.003);
        c.strokeStyle = css(browC.clone().multiplyScalar(0.75 + r() * 0.4), 0.55 + r() * 0.4);
        c.lineWidth = 1 + r() * 1.2;
        c.beginPath();
        c.moveTo(X(x), Y(y));
        c.lineTo(X(x) + Math.sin(ang) * len, Y(y) - Math.cos(ang) * len * 0.55);
        c.stroke();
      }
    }

    // The mouth.
    drawMouth(c, f.mouth ?? 'smile', L, skinC, X, Y, SX, SY);
  }, 512, 512);
}

function drawMouth(
  c: CanvasRenderingContext2D,
  mouth: Mouth,
  L: Layout,
  skin: THREE.Color,
  X: (x: number) => number,
  Y: (y: number) => number,
  SX: (m: number) => number,
  SY: (m: number) => number,
) {
  const lip = skin.clone().lerp(new THREE.Color(0xb44d48), 0.5);
  const lipDark = lip.clone().multiplyScalar(0.72);
  const y0 = L.mouthY;
  const w = 0.024; // half width
  // Corners up for a smile; one side only for a smirk.
  const lift = (s: number) => (mouth === 'smirk' ? (s > 0 ? 0.006 : 0.001) : mouth === 'grin' ? 0.007 : 0.004);
  const path = (pts: [number, number][]) => {
    c.beginPath();
    pts.forEach(([x, y], i) => (i ? c.lineTo(X(x), Y(y)) : c.moveTo(X(x), Y(y))));
  };
  const curve = (s0: number, s1: number, f: (t: number) => [number, number], n = 16) => {
    const pts: [number, number][] = [];
    for (let i = 0; i <= n; i++) pts.push(f(s0 + ((s1 - s0) * i) / n));
    return pts;
  };
  // Lips: the upper a slim bow, the lower fuller.
  const L1 = (t: number): [number, number] => [t * w, y0 + lift(t) * t * t + 0.0005];
  const upperTop = (t: number): [number, number] => [t * w * 0.98, y0 + 0.0045 - 0.0015 * Math.cos(t * Math.PI * 1.5) * (1 - Math.abs(t)) + lift(t) * t * t * 0.8];
  const lowerBot = (t: number): [number, number] => [t * w * 0.92, y0 - 0.0068 * (1 - t * t) + lift(t) * t * t];
  c.fillStyle = css(lip, 0.85);
  path([...curve(-1, 1, upperTop), ...curve(1, -1, L1)]);
  c.fill();
  c.fillStyle = css(lip, 0.75);
  path([...curve(-1, 1, L1), ...curve(1, -1, lowerBot)]);
  c.fill();
  if (mouth === 'grin') {
    // Open: dark inside, the top teeth showing.
    const open = (t: number): [number, number] => [t * w * 0.88, y0 - 0.0055 * (1 - t * t) + lift(t) * t * t];
    const top = (t: number): [number, number] => [t * w * 0.9, y0 + 0.0012 + lift(t) * t * t];
    c.fillStyle = 'rgba(60,18,20,1)';
    path([...curve(-1, 1, top), ...curve(1, -1, open)]);
    c.fill();
    const teeth = (t: number): [number, number] => [t * w * 0.74, y0 - 0.0026 * (1 - t * t) + lift(t) * t * t + 0.0008];
    c.fillStyle = 'rgba(246,242,232,1)';
    path([...curve(-1, 1, top), ...curve(1, -1, teeth)]);
    c.fill();
  }
  // The line between the lips.
  c.strokeStyle = css(lipDark, 0.9);
  c.lineWidth = SY(0.0011);
  path(curve(-1.04, 1.04, L1));
  c.stroke();
  void SX;
}

/** An eyeball's surface: white, the iris (a ring of colour with fine streaks), the pupil. Iris at the ball's −z. */
export function eyeTexture(iris: number) {
  return paint(`eyeball:${iris}`, (p) => {
    const { c, w, h } = p;
    c.fillStyle = '#f2eee8';
    c.fillRect(0, 0, w, h);
    // Toward the back of the ball, a little shade.
    const cx = w * 0.75;
    const cy = h * 0.5;
    const R = w * 0.078; // iris radius (about 5.5 mm on a 12 mm ball)
    const col = new THREE.Color(iris);
    const g = c.createRadialGradient(cx, cy, R * 0.2, cx, cy, R);
    g.addColorStop(0, css(col.clone().lerp(new THREE.Color(0xffffff), 0.15)));
    g.addColorStop(0.75, css(col));
    g.addColorStop(1, css(col.clone().multiplyScalar(0.45)));
    c.fillStyle = g;
    c.beginPath();
    c.arc(cx, cy, R, 0, Math.PI * 2);
    c.fill();
    let seed = 5;
    const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 70; i++) {
      const a = r() * Math.PI * 2;
      c.strokeStyle = css(col.clone().multiplyScalar(0.6 + r() * 0.7), 0.5);
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(cx + Math.cos(a) * R * 0.35, cy + Math.sin(a) * R * 0.35);
      c.lineTo(cx + Math.cos(a) * R * 0.95, cy + Math.sin(a) * R * 0.95);
      c.stroke();
    }
    c.fillStyle = '#0a0a0b';
    c.beginPath();
    c.arc(cx, cy, R * 0.38, 0, Math.PI * 2);
    c.fill();
    // Corners of the eye a touch pink.
    for (const dx of [-1, 1]) {
      const pg = c.createRadialGradient(cx + dx * R * 2.6, cy, 0, cx + dx * R * 2.6, cy, R * 1.6);
      pg.addColorStop(0, 'rgba(220,140,140,0.35)');
      pg.addColorStop(1, 'rgba(220,140,140,0)');
      c.fillStyle = pg;
      c.fillRect(0, 0, w, h);
    }
  }, 256, 128);
}
