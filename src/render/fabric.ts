import * as THREE from 'three';

/**
 * Shirt fabrics painted onto canvases and wrapped round the body, so prints, panels,
 * crests and seams read as real cloth (rather than shapes stuck on the surface).
 *
 * Torso canvas layout: x runs round the body (u = 0 and 1 at the middle of the back,
 * 0.5 at the middle of the front, increasing from the wearer's right to the wearer's
 * left as you look at them), y runs from the neckline (top) down to the hem (bottom).
 * Sleeve canvases are a small tile repeated round the sleeve.
 */
export const TORSO_TOP = 1.48;
export const TORSO_BOTTOM = 0.79;

export interface Canvas2D {
  c: CanvasRenderingContext2D;
  w: number;
  h: number;
  /** Canvas y for a height on the body (m). Only meaningful on the torso canvas. */
  y(m: number): number;
  /** Draw something at canvas x and again one width either side, so it wraps round the back seam. */
  wrap(x: number, draw: (x: number) => void): void;
}

export type Painter = (p: Canvas2D) => void;

export interface Fabric {
  /** Names the painted textures (they're cached by it). */
  id: string;
  /** The shirt's main colour, for trims such as an open collar. */
  base?: number;
  torso: Painter;
  /** Sleeves and shoulder caps (defaults to the plain shirt colour). */
  sleeve?: Painter;
}

const cache = new Map<string, THREE.Texture | null>();

/** A canvas texture from a painter, cached by key. null where there is no DOM (tests, server). */
export function paint(key: string, painter: Painter, w: number, h: number, repeat = false): THREE.Texture | null {
  if (cache.has(key)) return cache.get(key)!;
  let tex: THREE.Texture | null = null;
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c = canvas.getContext('2d');
    if (c) {
      painter({
        c,
        w,
        h,
        y: (m) => ((TORSO_TOP - m) / (TORSO_TOP - TORSO_BOTTOM)) * h,
        wrap: (x, draw) => {
          for (const dx of [-w, 0, w]) draw(x + dx);
        },
      });
      const t = new THREE.CanvasTexture(canvas);
      t.colorSpace = THREE.SRGBColorSpace;
      t.anisotropy = 4;
      if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
      else t.wrapS = THREE.RepeatWrapping;
      tex = t;
    }
  }
  cache.set(key, tex);
  return tex;
}

/** Re-map a torso-shaped body of revolution's UVs: u round the body, v by height (top = 1). */
export function heightUVs(geo: THREE.BufferGeometry) {
  const pos = geo.getAttribute('position');
  const uv = geo.getAttribute('uv');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    uv.setY(i, (y - TORSO_BOTTOM) / (TORSO_TOP - TORSO_BOTTOM));
  }
  uv.needsUpdate = true;
}

// ---------------------------------------------------------------- helpers

/** Deterministic pseudo-random in [0, 1). */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const fill = (p: Canvas2D, color: string) => {
  p.c.fillStyle = color;
  p.c.fillRect(0, 0, p.w, p.h);
};

/** A hibiscus: five overlapping round petals, a dark throat and a stamen. */
function hibiscus(c: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, throat: string, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  for (let k = 0; k < 5; k++) {
    const a = (k / 5) * Math.PI * 2;
    c.fillStyle = petal;
    c.beginPath();
    c.ellipse(Math.cos(a) * r * 0.55, Math.sin(a) * r * 0.55, r * 0.58, r * 0.46, a, 0, Math.PI * 2);
    c.fill();
    // Petal veins.
    c.strokeStyle = 'rgba(120,0,40,0.35)';
    c.lineWidth = Math.max(1, r * 0.05);
    c.beginPath();
    c.moveTo(0, 0);
    c.lineTo(Math.cos(a) * r * 0.9, Math.sin(a) * r * 0.9);
    c.stroke();
  }
  c.fillStyle = throat;
  c.beginPath();
  c.arc(0, 0, r * 0.3, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = '#ffd23f';
  c.lineWidth = Math.max(1.5, r * 0.08);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(r * 0.75, -r * 0.5);
  c.stroke();
  c.fillStyle = '#ffd23f';
  c.beginPath();
  c.arc(r * 0.75, -r * 0.5, r * 0.09, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A palm or monstera-style leaf: a long pointed blade with a midrib and slashes. */
function leaf(c: CanvasRenderingContext2D, x: number, y: number, len: number, color: string, rib: string, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = color;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(len * 0.5, -len * 0.3, len, 0);
  c.quadraticCurveTo(len * 0.5, len * 0.3, 0, 0);
  c.fill();
  c.strokeStyle = rib;
  c.lineWidth = Math.max(1, len * 0.03);
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(len, 0);
  // Slashes from the rib to the edge, like a palm frond.
  for (let i = 1; i < 7; i++) {
    const t = (i / 7) * len;
    const w = Math.sin((i / 7) * Math.PI) * len * 0.26;
    c.moveTo(t, 0);
    c.lineTo(t + len * 0.06, -w);
    c.moveTo(t, 0);
    c.lineTo(t + len * 0.06, w);
  }
  c.stroke();
  c.restore();
}

/** A small toucan: black body, white bib, big orange beak. */
function toucan(c: CanvasRenderingContext2D, x: number, y: number, s: number, flip: boolean) {
  c.save();
  c.translate(x, y);
  c.scale(flip ? -s : s, s);
  c.fillStyle = '#111317';
  c.beginPath();
  c.ellipse(0, 0, 1, 0.55, -0.3, 0, Math.PI * 2);
  c.fill();
  c.beginPath();
  c.moveTo(-0.8, 0.25);
  c.lineTo(-1.6, 0.6);
  c.lineTo(-0.7, 0.55);
  c.fill();
  c.fillStyle = '#f8f5ea';
  c.beginPath();
  c.ellipse(0.65, -0.2, 0.32, 0.3, 0, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#ff8a1c';
  c.beginPath();
  c.moveTo(0.85, -0.45);
  c.quadraticCurveTo(1.9, -0.55, 2.0, -0.05);
  c.quadraticCurveTo(1.5, -0.1, 0.9, 0.0);
  c.fill();
  c.fillStyle = '#e8331e';
  c.beginPath();
  c.arc(1.95, -0.15, 0.12, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#0b0b0b';
  c.beginPath();
  c.arc(0.68, -0.3, 0.07, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A five-pointed star. */
function star(c: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  c.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = rot + (k * Math.PI) / 5 - Math.PI / 2;
    const rr = k % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

// ---------------------------------------------------------------- the shirts

/** Lee: slate-navy tee; orange-red raglan shoulder panels with dark diagonal stripes. */
const leeStripes = (p: Canvas2D, x0: number, y0: number, w: number, h: number) => {
  const { c } = p;
  c.fillStyle = '#d4492a';
  c.fillRect(x0, y0, w, h);
  c.strokeStyle = '#7a2414';
  c.lineWidth = 3;
  for (let x = x0 - h; x < x0 + w + h; x += 11) {
    c.beginPath();
    c.moveTo(x, y0 + h);
    c.lineTo(x + h, y0);
    c.stroke();
  }
};
export const LEE: Fabric = {
  id: 'lee',
  torso: (p) => {
    const { c, w, h } = p;
    fill(p, '#36466f');
    // Raglan panel: from beside the collar diagonally down to the underarm, front and back.
    // u = 0.25 and 0.75 are the sides (under the arms).
    c.save();
    c.beginPath();
    const neck = p.y(1.468);
    const pit = p.y(1.2);
    const at = 0.2; // half the panel's width at the collar (fraction of the way round)
    const low = 0.1; // half its width where the seam meets the front and back of the armpit
    for (const side of [0.25, 0.75]) {
      c.moveTo(w * (side - at), neck);
      c.lineTo(w * (side - low), pit);
      c.lineTo(w * (side + low), pit);
      c.lineTo(w * (side + at), neck);
      c.lineTo(w * (side + at), 0);
      c.lineTo(w * (side - at), 0);
      c.closePath();
    }
    c.clip();
    leeStripes(p, 0, 0, w, h);
    c.restore();
    // A darker piping line along each raglan seam.
    c.strokeStyle = '#1f2a48';
    c.lineWidth = 4;
    for (const side of [0.25, 0.75])
      for (const d of [-1, 1]) {
        c.beginPath();
        c.moveTo(w * (side + d * at), neck);
        c.lineTo(w * (side + d * low), pit);
        c.stroke();
      }
    // Ribbed collar.
    c.fillStyle = '#2a3657';
    c.fillRect(0, 0, w, p.y(1.465));
  },
  sleeve: (p) => {
    leeStripes(p, 0, 0, p.w, p.h);
    // Navy cuff.
    p.c.fillStyle = '#36466f';
    p.c.fillRect(0, p.h - 10, p.w, 10);
  },
};

/** Ed: teal tee that breaks up into a dense dark-green speckle from mid-chest down. */
export const ED: Fabric = {
  id: 'ed',
  torso: (p) => {
    const { c, w, h } = p;
    fill(p, '#22707a');
    const r = rng(7);
    const top = p.y(1.32);
    const cols = ['#0d2b24', '#123d2f', '#0a1f1b', '#1e5a3f', '#5fae7c', '#8ad3a5'];
    for (let i = 0; i < 9000; i++) {
      const y = top + Math.pow(r(), 0.6) * (h - top);
      // Denser and darker towards the hem.
      const depth = (y - top) / (h - top);
      if (r() > 0.25 + depth * 0.75) continue;
      const x = r() * w;
      c.fillStyle = cols[r() < 0.12 ? 4 + Math.floor(r() * 2) : Math.floor(r() * 4)];
      const s = 1.5 + r() * 4 * (0.6 + depth);
      p.wrap(x, (xx) => {
        c.beginPath();
        c.arc(xx, y, s, 0, Math.PI * 2);
        c.fill();
      });
    }
    c.fillStyle = '#1b5c64';
    c.fillRect(0, 0, w, p.y(1.465));
  },
  sleeve: (p) => fill(p, '#22707a'),
};

/** Ryan: black rugby jersey; crest on the left chest, a white wordmark and a row of coloured dots. */
export const RYAN: Fabric = {
  id: 'ryan',
  torso: (p) => {
    const { c, w } = p;
    fill(p, '#131416');
    // Subtle tonal side panels.
    c.fillStyle = '#1c1e22';
    for (const side of [0.25, 0.75]) c.fillRect(w * (side - 0.05), 0, w * 0.1, p.h);
    const front = w * 0.5;
    // Crest (wearer's left: larger u) — a small shield with a grey emblem.
    const cx = front + w * 0.065;
    const cy = p.y(1.33);
    c.fillStyle = '#e5e7eb';
    c.beginPath();
    c.moveTo(cx - 14, cy - 16);
    c.lineTo(cx + 14, cy - 16);
    c.lineTo(cx + 14, cy + 2);
    c.quadraticCurveTo(cx + 12, cy + 14, cx, cy + 20);
    c.quadraticCurveTo(cx - 12, cy + 14, cx - 14, cy + 2);
    c.closePath();
    c.fill();
    c.fillStyle = '#131416';
    c.beginPath();
    c.arc(cx, cy - 2, 7, 0, Math.PI * 2);
    c.fill();
    // Kit maker's mark on the wearer's right chest.
    c.fillStyle = '#d1d5db';
    c.fillRect(front - w * 0.08, p.y(1.36), 26, 6);
    // Sponsor: a bold white wordmark with a row of coloured dots under it.
    c.fillStyle = '#ffffff';
    c.font = 'bold italic 46px Arial, Helvetica, sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    const sy = p.y(1.2);
    c.fillText('MEM.', front, sy);
    const dots = ['#e11d48', '#f97316', '#f59e0b', '#facc15', '#fde047', '#f97316', '#e11d48'];
    dots.forEach((d, i) => {
      c.fillStyle = d;
      c.beginPath();
      c.arc(front - 30 + i * 12, sy + 12, 4.5, 0, Math.PI * 2);
      c.fill();
    });
    // Collar.
    c.fillStyle = '#0a0a0b';
    c.fillRect(0, 0, w, p.y(1.462));
  },
  sleeve: (p) => {
    fill(p, '#131416');
    p.c.fillStyle = '#2a2c31';
    p.c.fillRect(0, p.h - 8, p.w, 8);
  },
};

/** A palm tree: a curved trunk with ring marks and a crown of fronds. */
function palmTree(c: CanvasRenderingContext2D, x: number, y: number, s: number, trunk: string, frond: string, rib: string, lean: number) {
  c.save();
  c.translate(x, y);
  c.strokeStyle = trunk;
  c.lineCap = 'round';
  c.lineWidth = s * 0.09;
  const tx = lean * s * 0.35;
  const ty = -s;
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(lean * s * 0.05, -s * 0.5, tx, ty);
  c.stroke();
  c.strokeStyle = 'rgba(0,0,0,0.25)';
  c.lineWidth = Math.max(1, s * 0.02);
  for (let i = 1; i < 6; i++) {
    const t = i / 6;
    const px = lean * s * 0.05 * 2 * t * (1 - t) + tx * t * t;
    const py = ty * t;
    c.beginPath();
    c.moveTo(px - s * 0.04, py);
    c.lineTo(px + s * 0.04, py);
    c.stroke();
  }
  for (let k = 0; k < 7; k++) {
    const a = -Math.PI / 2 + (k - 3) * 0.55 + (k % 2 ? 0.1 : -0.1);
    leaf(c, tx, ty, s * (0.55 + (k % 3) * 0.08), frond, rib, a + (Math.abs(k - 3) > 1 ? 0.5 * Math.sign(k - 3) : 0));
  }
  c.restore();
}

/** A pink flamingo standing on one leg, neck curved. */
function flamingo(c: CanvasRenderingContext2D, x: number, y: number, s: number, flip: boolean, body: string) {
  c.save();
  c.translate(x, y);
  c.scale(flip ? -s : s, s);
  c.strokeStyle = '#e46a93';
  c.lineWidth = 0.07;
  c.lineCap = 'round';
  // Legs.
  c.beginPath();
  c.moveTo(0, 0.3);
  c.lineTo(0, 1.6);
  c.moveTo(0, 0.9);
  c.lineTo(0.35, 0.75);
  c.lineTo(0.05, 0.55);
  c.stroke();
  // Body.
  c.fillStyle = body;
  c.beginPath();
  c.ellipse(0, 0, 0.75, 0.38, -0.25, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = 'rgba(180,40,90,0.35)';
  c.beginPath();
  c.ellipse(0.15, -0.05, 0.45, 0.18, -0.35, 0, Math.PI * 2);
  c.fill();
  // S-shaped neck up to the head.
  c.strokeStyle = body;
  c.lineWidth = 0.16;
  c.beginPath();
  c.moveTo(-0.55, -0.1);
  c.bezierCurveTo(-1.0, -0.6, -0.3, -0.9, -0.55, -1.4);
  c.stroke();
  c.fillStyle = body;
  c.beginPath();
  c.arc(-0.55, -1.45, 0.14, 0, Math.PI * 2);
  c.fill();
  // Beak: pale with a black tip.
  c.fillStyle = '#f5e6d8';
  c.beginPath();
  c.moveTo(-0.65, -1.5);
  c.lineTo(-0.95, -1.3);
  c.lineTo(-0.6, -1.38);
  c.fill();
  c.fillStyle = '#111';
  c.beginPath();
  c.moveTo(-0.85, -1.36);
  c.lineTo(-0.95, -1.3);
  c.lineTo(-0.83, -1.32);
  c.fill();
  c.restore();
}

/** A pineapple: a crosshatched golden body and a spiky green crown. */
function pineapple(c: CanvasRenderingContext2D, x: number, y: number, s: number, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = '#2f9e44';
  for (let k = -2; k <= 2; k++) {
    c.beginPath();
    c.moveTo(-s * 0.12, -s * 0.5);
    c.lineTo(k * s * 0.13, -s * (1.05 - Math.abs(k) * 0.12));
    c.lineTo(s * 0.12, -s * 0.5);
    c.fill();
  }
  c.fillStyle = '#e8a317';
  c.beginPath();
  c.ellipse(0, 0, s * 0.36, s * 0.55, 0, 0, Math.PI * 2);
  c.fill();
  c.save();
  c.clip();
  c.strokeStyle = '#9a5b07';
  c.lineWidth = Math.max(1, s * 0.04);
  for (let i = -6; i <= 6; i++) {
    c.beginPath();
    c.moveTo(i * s * 0.16 - s, -s);
    c.lineTo(i * s * 0.16 + s, s);
    c.moveTo(i * s * 0.16 + s, -s);
    c.lineTo(i * s * 0.16 - s, s);
    c.stroke();
  }
  c.restore();
  c.restore();
}

/** A plumeria: five rounded, slightly overlapping petals with a yellow heart. */
function plumeria(c: CanvasRenderingContext2D, x: number, y: number, r: number, petal: string, heart: string, rot: number) {
  c.save();
  c.translate(x, y);
  c.rotate(rot);
  c.fillStyle = petal;
  for (let k = 0; k < 5; k++) {
    c.save();
    c.rotate((k / 5) * Math.PI * 2);
    c.beginPath();
    c.ellipse(r * 0.5, 0, r * 0.55, r * 0.3, 0.35, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  c.fillStyle = heart;
  c.beginPath();
  c.arc(0, 0, r * 0.22, 0, Math.PI * 2);
  c.fill();
  c.restore();
}

/** A gull in silhouette: two shallow arcs. */
function bird(c: CanvasRenderingContext2D, x: number, y: number, s: number, color: string) {
  c.strokeStyle = color;
  c.lineWidth = Math.max(1.5, s * 0.12);
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x - s, y);
  c.quadraticCurveTo(x - s * 0.5, y - s * 0.5, x, y);
  c.quadraticCurveTo(x + s * 0.5, y - s * 0.5, x + s, y);
  c.stroke();
}

/** One layer of a Hawaiian print: a motif scattered at a density (per 100×100 px at scale 1). */
interface Layer {
  per: number;
  draw: (c: CanvasRenderingContext2D, x: number, y: number, s: number, r: () => number) => void;
}

/** A Hawaiian shirt from a background and layers of motifs, with a button placket down the front. */
function hawaiian(id: string, base: number, background: (p: Canvas2D) => void, layers: Layer[], button = '#e2e8f0'): Fabric {
  const print = (seed: number, scale: number) => (p: Canvas2D) => {
    background(p);
    const r = rng(seed);
    const area = (p.w * p.h) / (2400 * scale * scale);
    for (const layer of layers) {
      const n = Math.round(area * layer.per);
      for (let i = 0; i < n; i++) {
        const x = r() * p.w;
        const y = r() * p.h;
        const k = r();
        p.wrap(x, (xx) => layer.draw(p.c, xx, y, scale, rng(Math.floor(k * 1e6) + 1)));
      }
    }
  };
  return {
    id,
    base,
    torso: (p) => {
      print(11 + id.length, 1)(p);
      const { c, w } = p;
      const x = w * 0.5 + 4;
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(x - 1, p.y(1.42), 3, p.h);
      c.fillStyle = button;
      for (let y = p.y(1.32); y < p.h - 10; y += 52) {
        c.beginPath();
        c.arc(x + 9, y, 4, 0, Math.PI * 2);
        c.fill();
      }
    },
    sleeve: print(23 + id.length, 0.55),
  };
}

const pick = <T,>(r: () => number, xs: T[]) => xs[Math.floor(r() * xs.length)];
const solid = (color: string) => (p: Canvas2D) => fill(p, color);

/** Paul's wardrobe: a different loud Hawaiian shirt each time he turns up. */
export const PAUL_SHIRTS: Fabric[] = [
  // Navy with pink hibiscus, teal palm leaves, toucans and small white blossoms (from a photo of his).
  hawaiian('paul-toucan', 0x1b2142, solid('#1b2142'), [
    { per: 0.45, draw: (c, x, y, s, r) => { const [a, b] = pick(r, [['#2aa3b8', '#15606e'], ['#3fc1c0', '#1a7a7a'], ['#1f6fa8', '#123f63'], ['#2e8b57', '#1b5135']]); leaf(c, x, y, (40 + r() * 50) * s, a, b, r() * 7); } },
    { per: 0.12, draw: (c, x, y, s, r) => toucan(c, x, y, (9 + r() * 3) * s, r() < 0.5) },
    { per: 0.22, draw: (c, x, y, s, r) => hibiscus(c, x, y, (14 + r() * 14) * s, pick(r, ['#ff5c8a', '#ff7aa8', '#f43f7a', '#ff9ec0']), '#9d1747', r() * 6) },
    { per: 0.28, draw: (c, x, y, s, r) => plumeria(c, x, y, (6 + r() * 4) * s, r() < 0.6 ? '#f1f5f9' : '#9fd8f0', '#fde68a', r() * 6) },
  ]),
  // Pale mint with pink flamingos among green palm trees (from a photo of his).
  hawaiian('paul-flamingo', 0xdff3ee, solid('#e3f4ef'), [
    { per: 0.1, draw: (c, x, y, s, r) => palmTree(c, x, y, (80 + r() * 30) * s, '#9a6b3f', pick(r, ['#2f7d5b', '#3a9a6c', '#25664a']), '#164a33', (r() - 0.5) * 1.6) },
    { per: 0.12, draw: (c, x, y, s, r) => flamingo(c, x, y, (22 + r() * 6) * s, r() < 0.5, pick(r, ['#f7a1c4', '#f48fb8', '#fbb6d0'])) },
  ], '#f8fafc'),
  // Bright turquoise with big hibiscus in hot pink, orange, red, white and yellow.
  hawaiian('paul-turquoise', 0x10c4d0, solid('#10c4d0'), [
    { per: 0.3, draw: (c, x, y, s, r) => leaf(c, x, y, (35 + r() * 35) * s, pick(r, ['#22c55e', '#84cc16', '#15803d']), '#14532d', r() * 7) },
    { per: 0.3, draw: (c, x, y, s, r) => hibiscus(c, x, y, (15 + r() * 12) * s, pick(r, ['#ff2d8a', '#ff7a00', '#ef233c', '#ffffff', '#ffd60a']), '#9d1747', r() * 6) },
  ]),
  // Classic red with white hibiscus and white leaf outlines.
  hawaiian('paul-red', 0xc8102e, solid('#c8102e'), [
    { per: 0.3, draw: (c, x, y, s, r) => leaf(c, x, y, (40 + r() * 40) * s, 'rgba(255,255,255,0.85)', '#c8102e', r() * 7) },
    { per: 0.22, draw: (c, x, y, s, r) => hibiscus(c, x, y, (16 + r() * 12) * s, '#ffffff', '#f4b6c2', r() * 6) },
  ], '#111827'),
  // Sunny yellow with pineapples, green leaves and white plumeria.
  hawaiian('paul-pineapple', 0xffcf33, solid('#ffcf33'), [
    { per: 0.3, draw: (c, x, y, s, r) => leaf(c, x, y, (35 + r() * 35) * s, pick(r, ['#16a34a', '#0f766e']), '#064e3b', r() * 7) },
    { per: 0.14, draw: (c, x, y, s, r) => pineapple(c, x, y, (24 + r() * 8) * s, (r() - 0.5) * 0.8) },
    { per: 0.25, draw: (c, x, y, s, r) => plumeria(c, x, y, (8 + r() * 5) * s, '#ffffff', '#f59e0b', r() * 6) },
  ], '#7c2d12'),
  // Sunset: orange fading to hot pink, purple palm silhouettes and gulls.
  hawaiian(
    'paul-sunset',
    0xff7849,
    (p) => {
      const g = p.c.createLinearGradient(0, 0, 0, p.h);
      g.addColorStop(0, '#ffb347');
      g.addColorStop(0.5, '#ff7849');
      g.addColorStop(1, '#e8437a');
      p.c.fillStyle = g;
      p.c.fillRect(0, 0, p.w, p.h);
    },
    [
      { per: 0.14, draw: (c, x, y, s, r) => palmTree(c, x, y, (55 + r() * 30) * s, '#3b0f4a', '#4c1d5f', '#2a0a35', (r() - 0.5) * 1.6) },
      { per: 0.12, draw: (c, x, y, s, r) => bird(c, x, y, (7 + r() * 5) * s, '#3b0f4a') },
      { per: 0.08, draw: (c, x, y, s, r) => hibiscus(c, x, y, (12 + r() * 8) * s, '#fff1a8', '#e8437a', r() * 6) },
    ],
    '#3b0f4a',
  ),
  // Royal blue with white plumeria and pale-blue monstera leaves.
  hawaiian('paul-plumeria', 0x1d4ed8, solid('#1d4ed8'), [
    { per: 0.35, draw: (c, x, y, s, r) => leaf(c, x, y, (40 + r() * 40) * s, pick(r, ['#93c5fd', '#60a5fa', '#bfdbfe']), '#1e3a8a', r() * 7) },
    { per: 0.35, draw: (c, x, y, s, r) => plumeria(c, x, y, (10 + r() * 7) * s, '#ffffff', '#facc15', r() * 6) },
  ]),
];

/** Paul's default (the shirt in his photo). */
export const PAUL = PAUL_SHIRTS[0];

/** Bryony: berry long-sleeved top with a small white (and a few gold) star print. */
const bryonyStars = (p: Canvas2D, seed: number, count: number, size: number) => {
  fill(p, '#8e1d55');
  const r = rng(seed);
  for (let i = 0; i < count; i++) {
    const x = r() * p.w;
    const y = r() * p.h;
    const rot = r() * 6;
    p.c.fillStyle = r() < 0.14 ? '#facc15' : '#f8fafc';
    const s = size * (0.7 + r() * 0.6);
    p.wrap(x, (xx) => star(p.c, xx, y, s, rot));
  }
};
export const BRYONY: Fabric = {
  id: 'bryony',
  torso: (p) => bryonyStars(p, 5, 260, 7),
  sleeve: (p) => bryonyStars(p, 9, 40, 6),
};

/** A button placket down the front of a shirt, with buttons. */
const placket = (p: Canvas2D, line: string, button: string) => {
  const { c, w } = p;
  const x = w * 0.5 + 4;
  c.fillStyle = line;
  c.fillRect(x - 1, p.y(1.42), 3, p.h);
  c.fillStyle = button;
  for (let y = p.y(1.34); y < p.h - 10; y += 50) {
    c.beginPath();
    c.arc(x + 9, y, 3.5, 0, Math.PI * 2);
    c.fill();
  }
};

/** Navy, burgundy and white tartan check: wide navy bands with burgundy and pale over-checks. */
const tartan = (p: Canvas2D, scale: number) => {
  const { c, w, h } = p;
  fill(p, '#ece9e6');
  const pitch = 64 * scale;
  const bands: [number, number, string][] = [
    // offset, width (fractions of the pitch), colour
    [0, 0.34, 'rgba(32,38,74,0.88)'],
    [0.42, 0.1, 'rgba(128,30,50,0.85)'],
    [0.62, 0.16, 'rgba(32,38,74,0.6)'],
    [0.86, 0.04, 'rgba(128,30,50,0.7)'],
  ];
  for (const [o, bw, col] of bands) {
    c.fillStyle = col;
    for (let x = o * pitch; x < w + pitch; x += pitch) c.fillRect(x, 0, bw * pitch, h);
    for (let y = o * pitch; y < h + pitch; y += pitch) c.fillRect(0, y, w, bw * pitch);
  }
  // Thin white over-check lines.
  c.fillStyle = 'rgba(255,255,255,0.55)';
  for (let x = 0.38 * pitch; x < w; x += pitch) c.fillRect(x, 0, Math.max(1, 2 * scale), h);
  for (let y = 0.38 * pitch; y < h; y += pitch) c.fillRect(0, y, w, Math.max(1, 2 * scale));
};

/** A fine weave texture over a plain colour (oxford cloth, knit). */
const weave = (p: Canvas2D, base: string, fleck: string, seed: number, n: number) => {
  fill(p, base);
  const r = rng(seed);
  p.c.fillStyle = fleck;
  for (let i = 0; i < n; i++) p.c.fillRect(r() * p.w, r() * p.h, 2, 1);
};

/**
 * George's wardrobe (from photos): a navy-and-burgundy tartan check shirt, a white oxford
 * button-down, and a black v-neck jumper over a burgundy collared shirt.
 */
export const GEORGE_SHIRTS: Fabric[] = [
  {
    id: 'george-tartan',
    base: 0x2a2f55,
    torso: (p) => {
      tartan(p, 1);
      placket(p, 'rgba(0,0,0,0.3)', '#f5f5f4');
    },
    sleeve: (p) => tartan(p, 0.5),
  },
  {
    id: 'george-oxford',
    base: 0xf2f1ee,
    torso: (p) => {
      weave(p, '#f2f1ee', 'rgba(150,160,180,0.25)', 3, 6000);
      placket(p, 'rgba(0,0,0,0.12)', '#d6d3d1');
    },
    sleeve: (p) => weave(p, '#f2f1ee', 'rgba(150,160,180,0.25)', 4, 900),
  },
  {
    id: 'george-jumper',
    base: 0x1c1c20,
    torso: (p) => {
      weave(p, '#1c1c20', 'rgba(255,255,255,0.05)', 6, 8000);
      // Ribbed hem.
      p.c.fillStyle = 'rgba(255,255,255,0.06)';
      for (let x = 0; x < p.w; x += 8) p.c.fillRect(x, p.h - 26, 3, 26);
    },
    sleeve: (p) => weave(p, '#1c1c20', 'rgba(255,255,255,0.05)', 7, 1200),
  },
];
