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

/** Paul: navy Hawaiian shirt crowded with pink hibiscus, teal palm leaves, white blossoms and toucans. */
const paulPrint = (p: Canvas2D, seed: number, scale: number) => {
  const { c, w, h } = p;
  fill(p, '#1b2142');
  const r = rng(seed);
  const leafCols = [
    ['#2aa3b8', '#15606e'],
    ['#3fc1c0', '#1a7a7a'],
    ['#1f6fa8', '#123f63'],
    ['#2e8b57', '#1b5135'],
  ];
  const n = (w * h) / (2600 * scale * scale);
  for (let i = 0; i < n * 0.9; i++) {
    const [a, b] = leafCols[Math.floor(r() * leafCols.length)];
    const x = r() * w;
    const y = r() * h;
    const len = (40 + r() * 50) * scale;
    const rot = r() * Math.PI * 2;
    p.wrap(x, (xx) => leaf(c, xx, y, len, a, b, rot));
  }
  for (let i = 0; i < n * 0.3; i++) {
    const x = r() * w;
    const y = r() * h;
    const flip = r() < 0.5;
    const s = (9 + r() * 3) * scale;
    p.wrap(x, (xx) => toucan(c, xx, y, s, flip));
  }
  const pinks = ['#ff5c8a', '#ff7aa8', '#f43f7a', '#ff9ec0'];
  for (let i = 0; i < n * 0.55; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (14 + r() * 14) * scale;
    const col = pinks[Math.floor(r() * pinks.length)];
    const rot = r() * 6;
    p.wrap(x, (xx) => hibiscus(c, xx, y, rad, col, '#9d1747', rot));
  }
  // Small white and pale-blue blossoms filling the gaps.
  for (let i = 0; i < n * 0.7; i++) {
    const x = r() * w;
    const y = r() * h;
    const rad = (5 + r() * 4) * scale;
    c.fillStyle = r() < 0.6 ? '#f1f5f9' : '#9fd8f0';
    p.wrap(x, (xx) => {
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2;
        c.beginPath();
        c.arc(xx + Math.cos(a) * rad * 0.6, y + Math.sin(a) * rad * 0.6, rad * 0.5, 0, Math.PI * 2);
        c.fill();
      }
    });
  }
};
export const PAUL: Fabric = {
  torso: (p) => {
    paulPrint(p, 11, 1);
    const { c, w } = p;
    // Button placket down the front, a touch off-centre, with pale buttons.
    const x = w * 0.5 + 4;
    c.fillStyle = 'rgba(10,12,30,0.45)';
    c.fillRect(x - 1, p.y(1.42), 3, p.h);
    c.fillStyle = '#e2e8f0';
    for (let y = p.y(1.32); y < p.h - 10; y += 52) {
      c.beginPath();
      c.arc(x + 9, y, 4, 0, Math.PI * 2);
      c.fill();
    }
  },
  sleeve: (p) => paulPrint(p, 23, 0.55),
};

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
  torso: (p) => bryonyStars(p, 5, 260, 7),
  sleeve: (p) => bryonyStars(p, 9, 40, 6),
};
