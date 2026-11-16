import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NET, TABLE } from '../physics';

/**
 * Wonford House: a lunchtime game on an outdoor concrete table, on the mown lawn in
 * front of an old Victorian stone hall. Overcast autumn afternoon: striped grass,
 * fallen leaves, a bare-earth patch worn round the table, tall cedars screening a
 * car park, broad limes and planes, a cherry in orange, distant hills.
 *
 * Built procedurally (no external assets). Trees, leaves, windows and cars are
 * instanced so the whole venue is a few dozen draw calls.
 *
 * Layout (the player stands at +z looking towards −z):
 *   −z  cedars, a post-and-rail fence, the car park, and the hall beyond it
 *   −x  a big multi-stemmed lime with leaves heaped round its base
 *   +x  a cherry in autumn colour, a golden conifer, a picnic shelter
 *   +z  open lawn, picnic tables, a big plane tree, woodland, a solar-roofed barn
 */

// ---------------------------------------------------------------- small helpers

function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  return t;
}

/** Materials are shared by look within one build, so static props can be merged by material. */
let matCache = new Map<string, THREE.MeshStandardMaterial>();
function std(color: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  const key = `${color}:${JSON.stringify(extra)}`;
  let m = matCache.get(key);
  if (!m) matCache.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra })));
  return m;
}

/**
 * Merge every static, single-material mesh under `root` into one mesh per material
 * (and shadow setting). Subtrees marked `userData.dynamic` are left alone.
 */
function mergeStatic(root: THREE.Group) {
  root.updateMatrixWorld(true);
  const buckets = new Map<string, { mat: THREE.Material; cast: boolean; recv: boolean; geos: THREE.BufferGeometry[] }>();
  const remove: THREE.Mesh[] = [];
  const visit = (o: THREE.Object3D) => {
    if (o.userData.dynamic) return;
    const m = o as THREE.Mesh;
    if (m.isMesh && !(m as unknown as THREE.InstancedMesh).isInstancedMesh && !Array.isArray(m.material) && !m.material.transparent) {
      const key = `${m.material.uuid}:${m.castShadow}:${!!m.userData.receiveShadow}`;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { mat: m.material, cast: m.castShadow, recv: !!m.userData.receiveShadow, geos: [] }));
      let geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.clearGroups();
      for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(name)) geo.deleteAttribute(name);
      geo = geo.applyMatrix4(m.matrixWorld);
      b.geos.push(geo);
      remove.push(m);
    }
    o.children.forEach(visit);
  };
  visit(root);
  for (const m of remove) {
    m.removeFromParent();
    m.geometry.dispose();
  }
  for (const b of buckets.values()) {
    const geo = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!geo) continue;
    const mesh = new THREE.Mesh(geo, b.mat);
    mesh.castShadow = b.cast;
    mesh.userData.receiveShadow = b.recv;
    root.add(mesh);
  }
}

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Box whose UVs are in metres / tile, so a shared repeating texture keeps its scale on any size. */
function tiledBox(w: number, h: number, d: number, tile: number) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, −x (d × h), +y, −y (w × d), +z, −z (w × h); 4 vertices each.
  const dims: [number, number][] = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++)
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / tile, (uv.getY(i) * dims[f][1]) / tile);
    }
  return g;
}

/** Scale an extruded shape's UVs (which are in metres) to a tile size. */
function tileUV(g: THREE.BufferGeometry, tile: number) {
  const uv = g.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / tile, uv.getY(i) / tile);
  return g;
}

/** A gable end / pediment: a flat outline (in the x–y plane, base on y = 0) extruded `depth` towards −z. */
function gable(points: [number, number][], depth: number, mat: THREE.Material, tile: number) {
  const s = new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = tileUV(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: false }), tile);
  g.translate(0, 0, -depth);
  return new THREE.Mesh(g, mat);
}

/** A pitched roof: triangular prism running along x, ridge at height h, eaves `w` apart. */
function roofPrism(len: number, w: number, h: number, mat: THREE.Material, tile = 2) {
  const s = new THREE.Shape([new THREE.Vector2(-w / 2, 0), new THREE.Vector2(w / 2, 0), new THREE.Vector2(0, h)]);
  const g = tileUV(new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false }), tile);
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2);
  return new THREE.Mesh(g, mat);
}

const UP = new THREE.Vector3(0, 1, 0);
const tmpQ = new THREE.Quaternion();
const tmpV = new THREE.Vector3();

/** Matrix for a unit limb (y from 0 to 1) stretched from a to b with radius r. */
function limb(a: THREE.Vector3, b: THREE.Vector3, r: number) {
  tmpV.subVectors(b, a);
  const len = tmpV.length();
  tmpQ.setFromUnitVectors(UP, tmpV.normalize());
  return new THREE.Matrix4().compose(a.clone(), tmpQ.clone(), new THREE.Vector3(r, len, r));
}

function blobAt(x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) {
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(sx, sy, sz));
}

/** Instanced mesh with an optional colour per instance. */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, items: { m: THREE.Matrix4; c?: THREE.Color }[]) {
  const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  items.forEach((it, i) => {
    mesh.setMatrixAt(i, it.m);
    if (it.c) mesh.setColorAt(i, it.c);
  });
  mesh.count = items.length;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** A lumpy low-poly blob for foliage: a dodecahedron with its vertices nudged (consistently, so no cracks). */
function lumpyBlob(seed: number) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i);
    const y = p.getY(i);
    const z = p.getZ(i);
    const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed) * 43758.5453;
    const k = 0.82 + (h - Math.floor(h)) * 0.32;
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

const hex = (s: string) => new THREE.Color(s);

// ---------------------------------------------------------------- textures

/** Mown lawn: alternate light and dark stripes, blades and a few stray leaves. One tile = 5 m. */
function lawnTexture(repeat: number) {
  const t = canvasTexture(
    256,
    256,
    (ctx) => {
      const rnd = seeded(5);
      ctx.fillStyle = '#5d7a3b';
      ctx.fillRect(0, 0, 128, 256);
      ctx.fillStyle = '#4c6831';
      ctx.fillRect(128, 0, 128, 256);
      const blades = ['#6a8743', '#557333', '#40592a', '#76904e', '#4b652d'];
      for (let i = 0; i < 5200; i++) {
        const x = rnd() * 256;
        ctx.fillStyle = blades[i % blades.length];
        ctx.globalAlpha = 0.55;
        ctx.fillRect(x, rnd() * 256, 1, 2 + rnd() * 4);
      }
      ctx.globalAlpha = 1;
      // Clover / moss patches.
      for (let i = 0; i < 22; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(90,120,50,0.35)' : 'rgba(60,82,34,0.3)';
        ctx.beginPath();
        ctx.ellipse(rnd() * 256, rnd() * 256, 4 + rnd() * 10, 3 + rnd() * 7, rnd() * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [repeat, repeat],
  );
  // Centre a stripe on the table, so the pattern is the same when the venue
  // turns half round for a change of ends (the core floor doesn't turn).
  t.offset.x = 0.25;
  return t;
}

/** Worn earth round the table: soft irregular blobs at each end and under it, with leaf litter. */
function wornTexture() {
  return canvasTexture(512, 640, (ctx) => {
    const rnd = seeded(91);
    const W = 512;
    const H = 640;
    // Areas (in canvas px; 64 px per metre, centre = table centre).
    const spots: [number, number, number, number][] = [
      [0, -2.75, 1.7, 1.35], // far end
      [0, 2.75, 1.8, 1.4], // near end
      [0, 0, 1.25, 2.2], // under the table
    ];
    const toPx = (x: number, z: number): [number, number] => [W / 2 + x * 64, H / 2 + z * 64];
    for (const [cx, cz, rx, rz] of spots) {
      for (let i = 0; i < 70; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd());
        const [px, py] = toPx(cx + Math.cos(a) * rx * d * 0.85, cz + Math.sin(a) * rz * d * 0.85);
        const r = (0.35 + rnd() * 0.55) * 64;
        const grd = ctx.createRadialGradient(px, py, 0, px, py, r);
        grd.addColorStop(0, 'rgba(98,74,56,0.55)');
        grd.addColorStop(0.6, 'rgba(92,72,52,0.32)');
        grd.addColorStop(1, 'rgba(92,72,52,0)');
        ctx.fillStyle = grd;
        ctx.beginPath();
        ctx.arc(px, py, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // Grit, darker damp spots and a few grass tufts.
    const img = ctx.getImageData(0, 0, W, H);
    for (let i = 0; i < 9000; i++) {
      const x = Math.floor(rnd() * W);
      const y = Math.floor(rnd() * H);
      const o = (y * W + x) * 4;
      if (img.data[o + 3] < 90) continue;
      const v = rnd();
      const c = v < 0.4 ? [70, 52, 40] : v < 0.75 ? [128, 102, 80] : [88, 110, 52];
      img.data[o] = c[0];
      img.data[o + 1] = c[1];
      img.data[o + 2] = c[2];
    }
    ctx.putImageData(img, 0, 0);
    // Squashed leaves, only where there's earth.
    const leafCols = ['#a8742c', '#7a4d26', '#c99a3a', '#6b4a2a', '#b5612a'];
    for (let i = 0; i < 420; i++) {
      const x = rnd() * W;
      const y = rnd() * H;
      if (img.data[(Math.floor(y) * W + Math.floor(x)) * 4 + 3] < 110) continue;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rnd() * 6.3);
      ctx.fillStyle = leafCols[i % leafCols.length];
      ctx.globalAlpha = 0.75;
      ctx.beginPath();
      ctx.ellipse(0, 0, 3 + rnd() * 3, 1.6 + rnd() * 1.6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  });
}

/** Weathered concrete for the table top: speckled grey with damp and lichen stains. */
export function concreteTexture() {
  return canvasTexture(256, 512, (ctx) => {
    const rnd = seeded(23);
    ctx.fillStyle = '#9a9d98';
    ctx.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 40; i++) {
      const x = rnd() * 256;
      const y = rnd() * 512;
      const r = 10 + rnd() * 40;
      const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
      const dark = rnd() < 0.6;
      const rgb = dark ? '90,94,88' : '190,192,186';
      grd.addColorStop(0, `rgba(${rgb},${dark ? 0.28 : 0.25})`);
      grd.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = grd;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
    for (let i = 0; i < 9000; i++) {
      const v = rnd();
      ctx.fillStyle = v < 0.5 ? 'rgba(70,72,70,0.35)' : 'rgba(215,215,210,0.4)';
      ctx.fillRect(rnd() * 256, rnd() * 512, 1, 1);
    }
    // Pale lichen dots.
    for (let i = 0; i < 26; i++) {
      ctx.fillStyle = rnd() < 0.5 ? 'rgba(200,205,170,0.45)' : 'rgba(150,160,120,0.35)';
      ctx.beginPath();
      ctx.arc(rnd() * 256, rnd() * 512, 1.5 + rnd() * 3, 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

/** Coursed stone rubble in greys, browns and pinks. One tile = 3 m. */
function stoneTexture() {
  return canvasTexture(
    512,
    512,
    (ctx) => {
      const rnd = seeded(77);
      ctx.fillStyle = '#5f5852';
      ctx.fillRect(0, 0, 512, 512);
      const cols = ['#857d76', '#77706b', '#958a80', '#6c6762', '#9c9186', '#837b77', '#8d766c', '#7a7672', '#a09a92'];
      let y = 0;
      while (y < 512) {
        const h = 16 + rnd() * 14;
        let x = -rnd() * 30;
        while (x < 512) {
          const w = 22 + rnd() * 46;
          ctx.fillStyle = cols[Math.floor(rnd() * cols.length)];
          ctx.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
          ctx.fillStyle = 'rgba(255,255,255,0.06)';
          ctx.fillRect(x + 1.5, y + 1.5, w - 3, 3);
          x += w;
        }
        y += h;
      }
      // Weathering streaks.
      for (let i = 0; i < 60; i++) {
        ctx.fillStyle = 'rgba(40,36,34,0.08)';
        ctx.fillRect(rnd() * 512, rnd() * 512, 2 + rnd() * 4, 30 + rnd() * 90);
      }
    },
    [1, 1],
  );
}

function slateTexture(base = '#4b5058') {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      const rnd = seeded(31);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 256, 256);
      for (let r = 0; r < 16; r++) {
        const off = (r % 2) * 8;
        for (let c = -1; c < 17; c++) {
          const v = 70 + Math.floor(rnd() * 26);
          ctx.fillStyle = `rgb(${v - 4},${v},${v + 8})`;
          ctx.fillRect(c * 16 + off + 1, r * 16 + 1, 14, 14);
        }
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.fillRect(0, r * 16 + 14, 256, 2);
      }
      for (let i = 0; i < 30; i++) {
        ctx.fillStyle = 'rgba(150,160,120,0.25)';
        ctx.fillRect(rnd() * 256, rnd() * 256, 3 + rnd() * 6, 2 + rnd() * 3);
      }
    },
    [1, 1],
  );
}

/** A sash window in a pale stone surround, reflecting the grey sky. */
function windowTexture() {
  return canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#c7b59a';
    ctx.fillRect(0, 0, 64, 128);
    const grd = ctx.createLinearGradient(0, 10, 0, 118);
    grd.addColorStop(0, '#aeb6be');
    grd.addColorStop(0.45, '#4b5560');
    grd.addColorStop(1, '#2c333b');
    ctx.fillStyle = grd;
    ctx.fillRect(8, 10, 48, 106);
    ctx.fillStyle = '#f1efe8';
    ctx.fillRect(8, 10, 48, 3);
    ctx.fillRect(8, 113, 48, 3);
    ctx.fillRect(8, 10, 3, 106);
    ctx.fillRect(53, 10, 3, 106);
    ctx.fillRect(8, 61, 48, 4);
    ctx.fillRect(30.5, 10, 3, 106);
    ctx.fillStyle = '#b09c80';
    ctx.fillRect(4, 116, 56, 8);
  });
}

function clockTexture() {
  return canvasTexture(256, 256, (ctx) => {
    ctx.fillStyle = '#3a3532';
    ctx.beginPath();
    ctx.arc(128, 128, 126, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e9d9a8';
    ctx.beginPath();
    ctx.arc(128, 128, 112, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1c1a18';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.lineWidth = i % 3 ? 4 : 9;
      ctx.beginPath();
      ctx.moveTo(128 + Math.sin(a) * 90, 128 - Math.cos(a) * 90);
      ctx.lineTo(128 + Math.sin(a) * 106, 128 - Math.cos(a) * 106);
      ctx.stroke();
    }
    ctx.lineCap = 'round';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.sin(-0.6) * 55, 128 - Math.cos(-0.6) * 55);
    ctx.stroke();
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(128, 128);
    ctx.lineTo(128 + Math.sin(2.2) * 85, 128 - Math.cos(2.2) * 85);
    ctx.stroke();
  });
}

/** Overcast sky: pale grey with soft, slightly darker cloud masses. */
function skyTexture() {
  return canvasTexture(1024, 512, (ctx) => {
    const rnd = seeded(13);
    const grd = ctx.createLinearGradient(0, 0, 0, 512);
    grd.addColorStop(0, '#c4cad1');
    grd.addColorStop(0.3, '#d3d8dd');
    grd.addColorStop(0.48, '#e5e8ea');
    grd.addColorStop(0.52, '#d9dcd9');
    grd.addColorStop(1, '#9aa197');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 1024, 512);
    for (let i = 0; i < 260; i++) {
      const x = rnd() * 1024;
      const y = 30 + rnd() * 215;
      const r = 20 + rnd() * 70;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const light = rnd() < 0.55;
      // Fade to the same colour, transparent (fading to transparent black darkens the sky).
      const rgb = light ? '240,242,244' : '150,157,166';
      g.addColorStop(0, `rgba(${rgb},${light ? 0.4 : 0.18})`);
      g.addColorStop(1, `rgba(${rgb},0)`);
      ctx.fillStyle = g;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(2.6, 0.55 + (y / 256) * 0.4);
      ctx.translate(-x, -y);
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
      ctx.restore();
    }
  });
}

function solarRoofTexture() {
  return canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#3e434a';
    ctx.fillRect(0, 0, 256, 128);
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 12; c++) {
        ctx.fillStyle = '#1d2638';
        ctx.fillRect(8 + c * 20, 10 + r * 28, 18, 25);
        ctx.fillStyle = 'rgba(160,180,210,0.25)';
        ctx.fillRect(8 + c * 20, 10 + r * 28, 18, 2);
      }
  });
}

function signTexture(lines: string[], bg: string, fg: string, w = 256, h = 128) {
  return canvasTexture(w, h, (ctx) => {
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fg;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = Math.floor(h / (lines.length + 0.8));
    ctx.font = `bold ${size}px sans-serif`;
    // Shrink to fit the widest line.
    const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
    if (widest > w * 0.9) size = Math.floor((size * w * 0.9) / widest);
    ctx.font = `bold ${size}px sans-serif`;
    lines.forEach((l, i) => ctx.fillText(l, w / 2, (h * (i + 0.5 + 0.4)) / (lines.length + 0.8)));
  });
}

// ---------------------------------------------------------------- trees

interface Forest {
  bark: { m: THREE.Matrix4; c?: THREE.Color }[];
  leaves: { m: THREE.Matrix4; c?: THREE.Color }[];
  /** Foliage far enough away to use a lighter blob. */
  far: { m: THREE.Matrix4; c?: THREE.Color }[];
  /** Ground spots under crowns (for leaf litter and falling leaves). */
  canopies: { x: number; z: number; r: number; top: number; cols: THREE.Color[] }[];
}

const PAL = {
  summer: ['#4a6b34', '#56773a', '#3f5e2e', '#627f42'].map(hex),
  turning: ['#7f8f42', '#94953f', '#66803a', '#a8964a', '#56773a'].map(hex),
  golden: ['#c19a35', '#cfab45', '#b2862c', '#a47f35', '#d4b552'].map(hex),
  cherry: ['#c0652f', '#ab5129', '#c9823e', '#a4492d', '#c49a45'].map(hex),
  cedar: ['#2b3f30', '#324834', '#27392b', '#3a5038', '#434f35'].map(hex),
  lime: ['#8f9846', '#7f8d40', '#a99e4c', '#6f843d', '#9fa04f'].map(hex),
  hedge: ['#2f4f2c', '#365a31', '#2b4628'].map(hex),
  topiary: ['#e3c437', '#d2b52f', '#c9a92a', '#6e7f2c'].map(hex),
};

function pick<T>(rnd: () => number, a: T[]) {
  return a[Math.floor(rnd() * a.length)];
}

/** A broadleaf tree (plane, lime, chestnut): trunk, a few main limbs, and a lumpy crown. */
function broadleaf(f: Forest, rnd: () => number, x: number, z: number, o: { trunk: number; r: number; crownR: number; crownH: number; pal: THREE.Color[]; stems?: number; blobs?: number; gaps?: number }) {
  const stems = o.stems ?? 1;
  const cy = o.trunk + o.crownH * 0.5;
  for (let s = 0; s < stems; s++) {
    const a = (s / stems) * Math.PI * 2 + rnd();
    const splay = stems > 1 ? 0.9 : 0.25;
    const base = new THREE.Vector3(x + (stems > 1 ? Math.cos(a) * 0.25 : 0), 0, z + (stems > 1 ? Math.sin(a) * 0.25 : 0));
    const top = new THREE.Vector3(x + Math.cos(a) * splay * (rnd() + 0.5), o.trunk, z + Math.sin(a) * splay * (rnd() + 0.5));
    f.bark.push({ m: limb(base, top, o.r / Math.sqrt(stems)) });
    // Root flare.
    f.bark.push({ m: limb(base.clone().setY(-0.1), base.clone().setY(0.6), (o.r / Math.sqrt(stems)) * 1.5) });
    const limbs = 4 + Math.floor(rnd() * 3);
    for (let k = 0; k < limbs; k++) {
      const b = (k / limbs) * Math.PI * 2 + rnd() * 0.8;
      const reach = o.crownR * (0.45 + rnd() * 0.4);
      const end = new THREE.Vector3(top.x + Math.cos(b) * reach, cy + (rnd() - 0.2) * o.crownH * 0.45, top.z + Math.sin(b) * reach);
      const from = top.clone().lerp(base, rnd() * 0.25);
      f.bark.push({ m: limb(from, end, o.r * 0.42) });
      const mid = from.clone().lerp(end, 0.6);
      f.bark.push({ m: limb(mid, mid.clone().add(new THREE.Vector3((rnd() - 0.5) * 2, 1 + rnd(), (rnd() - 0.5) * 2)), o.r * 0.2) });
    }
  }
  const n = Math.round((o.blobs ?? 14 + o.crownR * 6) * 1.8);
  for (let i = 0; i < n; i++) {
    if (rnd() < (o.gaps ?? 0.1)) continue;
    // Points biased to the crown's shell, so it reads as foliage rather than a ball.
    const u = rnd() * Math.PI * 2;
    const v = Math.acos(2 * rnd() - 1);
    const d = 0.55 + Math.sqrt(rnd()) * 0.45;
    const px = x + Math.sin(v) * Math.cos(u) * o.crownR * d;
    const py = cy + Math.cos(v) * o.crownH * 0.5 * d;
    const pz = z + Math.sin(v) * Math.sin(u) * o.crownR * d;
    if (py < o.trunk * 0.8) continue;
    const s = (0.5 + rnd() * 0.55) * Math.max(1, o.crownR / 3.2);
    f.leaves.push({ m: blobAt(px, py, pz, s * 1.15, s * 0.85, s * 1.15, rnd() * 6), c: pick(rnd, o.pal).clone().multiplyScalar(0.9 + rnd() * 0.2) });
  }
  f.canopies.push({ x, z, r: o.crownR, top: o.trunk + o.crownH, cols: o.pal });
}

/** A Lebanon-style cedar: tall straight trunk, flat tiers of dark foliage. */
function cedar(f: Forest, rnd: () => number, x: number, z: number, h: number) {
  const r = 0.32 + rnd() * 0.12;
  const lean = new THREE.Vector3((rnd() - 0.5) * 0.6, 0, (rnd() - 0.5) * 0.6);
  const base = new THREE.Vector3(x, 0, z);
  const top = new THREE.Vector3(x, h, z).add(lean);
  f.bark.push({ m: limb(base, top, r), c: hex('#6a5245') });
  f.bark.push({ m: limb(base.clone().setY(-0.1), base.clone().setY(0.9), r * 1.7), c: hex('#6a5245') });
  const tiers = 6 + Math.floor(rnd() * 3);
  for (let k = 0; k < tiers; k++) {
    const t = k / (tiers - 1);
    const y = h * (0.38 + t * 0.6);
    const spread = (3.6 - t * 2.3) * (0.8 + rnd() * 0.4);
    const trunkAt = base.clone().lerp(top, y / h);
    const arms = 2 + Math.floor(rnd() * 2);
    for (let a = 0; a < arms; a++) {
      const ang = rnd() * Math.PI * 2;
      const tip = new THREE.Vector3(trunkAt.x + Math.cos(ang) * spread, y + 0.3 + rnd() * 0.5, trunkAt.z + Math.sin(ang) * spread);
      f.bark.push({ m: limb(trunkAt, tip, r * 0.35), c: hex('#6a5245') });
      // A flat plate of foliage along the arm, thickest towards its tip.
      for (let p = 0; p < 3; p++) {
        const q = 0.4 + p * 0.3;
        const c = trunkAt.clone().lerp(tip, q);
        const s = 0.9 + spread * 0.3 * (1 - Math.abs(q - 0.8));
        f.leaves.push({ m: blobAt(c.x, c.y + 0.25, c.z, s * 1.3, 0.38 + rnd() * 0.15, s, ang), c: pick(rnd, PAL.cedar).clone().multiplyScalar(0.9 + rnd() * 0.2) });
      }
    }
  }
  f.leaves.push({ m: blobAt(top.x, top.y, top.z, 1.2, 0.6, 1.2), c: PAL.cedar[1] });
  f.canopies.push({ x, z, r: 3, top: h, cols: [hex('#7a5a34'), hex('#8a6a3a'), hex('#5d4630')] });
}

/** A young tree, almost bare. */
function sapling(f: Forest, rnd: () => number, x: number, z: number) {
  const top = new THREE.Vector3(x, 3.6, z);
  f.bark.push({ m: limb(new THREE.Vector3(x, 0, z), top, 0.06) });
  for (let k = 0; k < 8; k++) {
    const from = new THREE.Vector3(x, 1.6 + k * 0.25, z);
    const a = rnd() * 6.3;
    const to = from.clone().add(new THREE.Vector3(Math.cos(a) * 0.8, 0.9 + rnd() * 0.6, Math.sin(a) * 0.8));
    f.bark.push({ m: limb(from, to, 0.02) });
    if (rnd() < 0.5) f.leaves.push({ m: blobAt(to.x, to.y, to.z, 0.18, 0.14, 0.18), c: PAL.golden[1] });
  }
}

// ---------------------------------------------------------------- furniture

function picnicTable(wood: THREE.Material, roofed = false) {
  const g = new THREE.Group();
  g.add(box(0.75, 0.05, 1.9, wood, 0, 0.76, 0));
  for (const sx of [-1, 1]) g.add(box(0.28, 0.05, 1.9, wood, sx * 0.62, 0.45, 0));
  for (const sz of [-0.7, 0.7]) {
    for (const sx of [-1, 1]) {
      const leg = box(0.07, 0.95, 0.09, wood, sx * 0.3, 0.42, sz);
      leg.rotation.z = sx * 0.55;
      g.add(leg);
    }
    g.add(box(1.5, 0.06, 0.09, wood, 0, 0.4, sz));
  }
  if (roofed) {
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) g.add(box(0.12, 2.2, 0.12, wood, sx * 0.95, 1.1, sz * 1.05));
    const roof = roofPrism(2.6, 2.4, 0.8, wood, 1);
    roof.rotation.y = Math.PI / 2;
    roof.position.y = 2.2;
    g.add(roof);
    g.add(box(2.1, 0.12, 0.12, wood, 0, 2.15, 1.05), box(2.1, 0.12, 0.12, wood, 0, 2.15, -1.05));
  }
  return g;
}

function car(color: number, rnd: () => number) {
  const g = new THREE.Group();
  const paint = std(color, { roughness: 0.35, metalness: 0.5 });
  const glass = std(0x1d242c, { roughness: 0.15, metalness: 0.6 });
  const tall = rnd() < 0.5; // SUV or hatchback
  const H = tall ? 0.62 : 0.5;
  const base = 0.28;
  g.add(box(1.78, H, 4.3, paint, 0, base + H / 2, 0));
  // Cabin: tinted glass with a painted roof, set back from the bonnet.
  const cl = tall ? 2.5 : 2.1;
  const cz = tall ? -0.25 : -0.3;
  g.add(box(1.56, 0.42, cl, glass, 0, base + H + 0.21, cz));
  g.add(box(1.6, 0.06, cl - 0.15, paint, 0, base + H + 0.44, cz - 0.05));
  for (const sx of [-1, 1]) g.add(box(0.06, 0.4, 0.12, paint, sx * 0.76, base + H + 0.2, cz + cl / 2 - 0.05));
  const tyre = std(0x16181a);
  for (const sx of [-1, 1]) for (const sz of [-1.4, 1.35]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.24, 14), tyre);
    w.rotation.z = Math.PI / 2;
    w.position.set(sx * 0.8, 0.32, sz);
    g.add(w);
  }
  for (const sx of [-0.6, 0.6]) g.add(box(0.3, 0.1, 0.04, std(0xf6f2e6, { emissive: 0x333333 }), sx, base + H * 0.7, 2.15));
  return g;
}

function lampPost(iron: THREE.Material, h = 5.5) {
  const g = new THREE.Group();
  g.add(box(0.1, h, 0.1, iron, 0, h / 2, 0));
  g.add(box(0.5, 0.12, 0.22, iron, 0.2, h, 0));
  g.add(box(0.36, 0.04, 0.16, std(0xf3f1e6, { emissive: 0x777766 }), 0.25, h - 0.07, 0));
  return g;
}

// ---------------------------------------------------------------- the hall

/**
 * The Victorian stone hall: a long three-storey range with cross gables, a Dutch-gabled
 * clock block over a sandstone porch (in scaffolding), roof dormers, chimneys, and a
 * turret with a slate mansard and an iron crown at the far end. Front face at local z = 0.
 */
function hall() {
  const g = new THREE.Group();
  const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 });
  const dressed = std(0xb6a68f, { roughness: 0.9 });
  const sandstone = std(0xc8a86e, { roughness: 0.9 });
  const slate = new THREE.MeshStandardMaterial({ map: slateTexture(), roughness: 0.75 });
  const blueSlate = new THREE.MeshStandardMaterial({ map: slateTexture('#5a6574'), roughness: 0.7, color: 0xb8c4d4 });
  const T = 3;
  const sbox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(tiledBox(w, h, d, T), stone);
    m.position.set(x, y, z);
    return m;
  };
  const windows: THREE.Matrix4[] = [];
  const win = (x: number, y: number, z: number, ry = 0, s = 1) => windows.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(UP, ry), new THREE.Vector3(s, s, s)));

  // Main range.
  const L = 46;
  const D = 12;
  const H = 11;
  g.add(sbox(L, H, D, 0, H / 2, -D / 2));
  g.add(box(L + 0.3, 0.9, D + 0.3, std(0x5e5650), 0, 0.45, -D / 2));
  for (const y of [3.6, 7.2]) g.add(box(L + 0.1, 0.16, 0.2, dressed, 0, y, 0.05));
  g.add(box(L + 0.4, 0.3, 0.5, dressed, 0, H, 0.1));
  const roof = roofPrism(L + 0.6, D + 1, 5, slate, 2);
  roof.position.set(0, H, -D / 2);
  g.add(roof);
  for (let x = -21.5; x <= 21.5; x += 2.6) {
    if (Math.abs(x + 17) < 5 || Math.abs(x + 1) < 4.2 || Math.abs(x - 12) < 3.8) continue;
    for (const y of [1.9, 5.4, 8.9]) win(x, y, 0.03);
  }

  // Clock block: projects 3 m, Dutch gable with the clock, sandstone porch and steps.
  const cx = -17;
  g.add(sbox(9, 13, 3.2, cx, 6.5, 1.6));
  const dutch: [number, number][] = [
    [-4.5, 0],
    [4.5, 0],
    [4.5, 1.1],
    [3.3, 1.5],
    [3.3, 2.7],
    [1.9, 3.1],
    [1.9, 4.5],
    [0.9, 4.9],
    [0, 5.5],
    [-0.9, 4.9],
    [-1.9, 4.5],
    [-1.9, 3.1],
    [-3.3, 2.7],
    [-3.3, 1.5],
    [-4.5, 1.1],
  ];
  const dg = gable(dutch, 3.2, stone, T);
  dg.position.set(cx, 13, 3.2);
  g.add(dg);
  const cr = roofPrism(4.5, 8.4, 4.6, slate, 2);
  cr.rotation.y = Math.PI / 2;
  cr.position.set(cx, 13, 0);
  g.add(cr);
  for (const [x, y] of [
    [4.5, 1.1],
    [-4.5, 1.1],
    [3.3, 2.7],
    [-3.3, 2.7],
    [1.9, 4.5],
    [-1.9, 4.5],
  ] as const)
    g.add(box(0.5, 0.5, 0.5, dressed, cx + x, 13 + y + 0.25, 3.0));
  const clock = new THREE.Mesh(new THREE.CircleGeometry(1.0, 32), new THREE.MeshStandardMaterial({ map: clockTexture(), roughness: 0.6 }));
  clock.position.set(cx, 15.6, 3.24);
  g.add(clock);
  for (const y of [5.4, 8.9]) for (const dx of [-2.6, 2.6]) win(cx + dx, y, 3.23);
  // Bay window over the porch.
  g.add(box(3.4, 3, 0.9, dressed, cx, 6.2, 3.6));
  win(cx - 0.9, 6.2, 4.07, 0, 0.95);
  win(cx + 0.9, 6.2, 4.07, 0, 0.95);
  // Porch: honey sandstone, arched door, balustrade, steps.
  g.add(box(5, 4.4, 2.2, sandstone, cx, 2.2, 4.3));
  g.add(box(5.4, 0.3, 2.5, sandstone, cx, 4.5, 4.35));
  for (let i = 0; i < 9; i++) g.add(box(0.14, 0.45, 0.14, sandstone, cx - 2.4 + i * 0.6, 4.9, 5.45));
  g.add(box(5.4, 0.12, 0.3, sandstone, cx, 5.15, 5.45));
  const door = new THREE.Mesh(
    new THREE.PlaneGeometry(1.7, 2.8),
    new THREE.MeshStandardMaterial({
      map: canvasTexture(64, 128, (ctx) => {
        ctx.fillStyle = '#c8a86e';
        ctx.fillRect(0, 0, 64, 128);
        ctx.fillStyle = '#2d3a2f';
        ctx.beginPath();
        ctx.moveTo(6, 128);
        ctx.lineTo(6, 34);
        ctx.arc(32, 34, 26, Math.PI, 0);
        ctx.lineTo(58, 128);
        ctx.fill();
        ctx.fillStyle = '#9fb0b9';
        ctx.fillRect(12, 20, 40, 20);
      }),
    }),
  );
  door.position.set(cx, 1.6, 5.42);
  g.add(door);
  for (let s = 0; s < 6; s++) g.add(box(6.2 - s * 0.1, 0.18, 0.4, std(0x9a958c), cx, 0.09 + s * 0.18, 7.6 - s * 0.38));
  for (const sx of [-1, 1]) g.add(box(0.4, 1.2, 2.4, sandstone, cx + sx * 3.2, 0.6, 6.6));
  // Scaffolding over the clock block's left side.
  const tube = std(0x8e9296, { metalness: 0.6, roughness: 0.45 });
  const tubes: THREE.Matrix4[] = [];
  const X0 = cx - 7.8;
  const X1 = cx - 2.8;
  for (let x = X0; x <= X1 + 0.01; x += 1.25)
    for (const z of [3.5, 4.7]) tubes.push(limb(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 14.5, z), 0.03));
  for (let y = 2; y <= 14; y += 2)
    for (const z of [3.5, 4.7]) tubes.push(limb(new THREE.Vector3(X0, y, z), new THREE.Vector3(X1, y, z), 0.03));
  for (let x = X0; x <= X1 + 0.01; x += 1.25) for (let y = 2; y <= 14; y += 2) tubes.push(limb(new THREE.Vector3(x, y, 3.4), new THREE.Vector3(x, y, 4.8), 0.025));
  const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
  tubeGeo.translate(0, 0.5, 0);
  g.add(instanced(tubeGeo, tube, tubes.map((m) => ({ m }))));
  for (let y = 2; y <= 14; y += 4) g.add(box(X1 - X0, 0.05, 1.2, std(0xa98b5c), (X0 + X1) / 2, y + 0.05, 4.1));
  g.add(box(X1 - X0, 2.2, 0.03, std(0xd8d6cf), (X0 + X1) / 2, 1.1, 4.85));

  // Central and right cross gables.
  for (const [gx, gw] of [
    [-1, 8],
    [12, 7],
  ] as const) {
    g.add(sbox(gw, H, 1, gx, H / 2, 0.5));
    const tri = gable(
      [
        [-gw / 2, 0],
        [gw / 2, 0],
        [0, 4.4],
      ],
      1,
      stone,
      T,
    );
    tri.position.set(gx, H, 1);
    g.add(tri);
    const gr = roofPrism(3.5, gw + 0.6, 4.6, slate, 2);
    gr.rotation.y = Math.PI / 2;
    gr.position.set(gx, H, -0.6);
    g.add(gr);
    g.add(box(0.5, 0.5, 0.5, dressed, gx, H + 4.6, 0.8));
    for (const y of [1.9, 5.4, 8.9]) for (const dx of [-gw / 4, gw / 4]) win(gx + dx, y, 1.03);
    win(gx, H + 1.4, 1.03, 0, 0.85);
  }

  // Roof dormers.
  for (const x of [-9.5, 5, 19]) {
    g.add(sbox(1.8, 1.8, 2, x, H + 1.2, -1.1));
    const tri = gable(
      [
        [-0.9, 0],
        [0.9, 0],
        [0, 1.1],
      ],
      2,
      stone,
      T,
    );
    tri.position.set(x, H + 2.1, -0.1);
    g.add(tri);
    const dr = roofPrism(2.2, 2.2, 1.15, slate, 2);
    dr.rotation.y = Math.PI / 2;
    dr.position.set(x, H + 2.1, -1.1);
    g.add(dr);
    win(x, H + 1.15, -0.07, 0, 0.6);
  }

  // Chimney stacks with pots.
  for (const [x, z] of [
    [-12, -4],
    [-5, -6],
    [3.5, -4],
    [9, -7.5],
    [17, -4],
  ] as const) {
    g.add(sbox(0.9, 4.2, 1.8, x, H + 3.4, z));
    g.add(box(1.05, 0.2, 1.95, dressed, x, H + 5.5, z));
    for (const dz of [-0.45, 0.45]) {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.16, 0.5, 8), std(0x9a5a3e));
      pot.position.set(x, H + 5.85, z + dz);
      g.add(pot);
    }
  }

  // The turret: octagonal tower, slate mansard, dormers and a white iron crown.
  const tx = 25.5;
  const tz = -2.5;
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.3, 3.3, 14, 8), stone);
  tower.position.set(tx, 7, tz);
  tower.rotation.y = Math.PI / 8;
  g.add(tower);
  tileUV(tower.geometry, 1 / 6);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    if (Math.cos(a) < -0.3) continue; // back faces
    const nx = Math.sin(a) * 3.06;
    const nz = Math.cos(a) * 3.06;
    for (const y of [1.9, 5.4, 8.9, 12.2]) win(tx + nx, y, tz + nz, a, 0.85);
  }
  g.add(box(7, 0.35, 7, dressed, tx, 14, tz));
  const mansard = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 3.6, 3.2, 8), blueSlate);
  mansard.position.set(tx, 15.75, tz);
  mansard.rotation.y = Math.PI / 8;
  g.add(mansard);
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 2.4, 1.1, 8), blueSlate);
  cap.position.set(tx, 17.9, tz);
  cap.rotation.y = Math.PI / 8;
  g.add(cap);
  for (let k = 0; k < 4; k++) {
    const a = -Math.PI / 2 + (k / 3) * Math.PI;
    const d = new THREE.Group();
    d.add(box(0.9, 1.2, 0.8, std(0xe8e6df), 0, 0, 0));
    const dwin = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.85), std(0x3a444e, { roughness: 0.2 }));
    dwin.position.z = 0.41;
    d.add(dwin);
    d.position.set(tx + Math.sin(a) * 3.1, 15.7, tz + Math.cos(a) * 3.1);
    d.rotation.y = a;
    g.add(d);
  }
  const crown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.9, 1.1, 1.4, 16, 1, true),
    new THREE.MeshStandardMaterial({
      map: canvasTexture(128, 64, (ctx) => {
        ctx.clearRect(0, 0, 128, 64);
        ctx.fillStyle = '#eef0f0';
        ctx.fillRect(0, 0, 128, 6);
        ctx.fillRect(0, 56, 128, 8);
        for (let i = 0; i < 16; i++) ctx.fillRect(i * 8, 0, 2.5, 64);
        for (let i = 0; i < 16; i++) {
          ctx.beginPath();
          ctx.arc(i * 8 + 4, 22, 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }),
      transparent: true,
      alphaTest: 0.4,
      side: THREE.DoubleSide,
      roughness: 0.5,
    }),
  );
  crown.position.set(tx, 19.15, tz);
  g.add(crown);

  // Glazed canopy along the right-hand ground floor.
  const glassRoof = new THREE.Mesh(new THREE.BoxGeometry(9, 0.08, 3), new THREE.MeshStandardMaterial({ color: 0x9fb2bd, roughness: 0.15, metalness: 0.3, transparent: true, opacity: 0.75 }));
  glassRoof.position.set(16.5, 3.1, 1.4);
  glassRoof.rotation.x = 0.22;
  g.add(glassRoof);
  for (const x of [12.3, 16.5, 20.7]) g.add(box(0.1, 2.75, 0.1, std(0x5a636a), x, 1.375, 2.8));

  const winGeo = new THREE.PlaneGeometry(1.3, 2.3);
  g.add(instanced(winGeo, new THREE.MeshStandardMaterial({ map: windowTexture(), roughness: 0.35, metalness: 0.1 }), windows.map((m) => ({ m }))));
  return g;
}

// ---------------------------------------------------------------- the concrete table dressing

/**
 * Dressing for the outdoor concrete table (the core table supplies the top and lines):
 * a thick concrete apron round the top, two slab pedestals and a perforated steel net.
 */
function concreteTable() {
  const g = new THREE.Group();
  const conc = std(0x9b9e99, { roughness: 0.95 });
  const top = TABLE.height;
  const apronH = 0.07;
  const label = new THREE.MeshStandardMaterial({
    map: canvasTexture(1024, 32, (ctx) => {
      ctx.fillStyle = '#9b9e99';
      ctx.fillRect(0, 0, 1024, 32);
      ctx.fillStyle = '#3d4a63';
      ctx.font = 'bold 22px sans-serif';
      ctx.textBaseline = 'middle';
      ctx.fillText('mem tt', 24, 16);
      ctx.fillText('510', 340, 16);
      ctx.fillText('510', 640, 16);
      ctx.textAlign = 'right';
      ctx.fillText('mem tt', 1000, 16);
    }),
    roughness: 0.95,
  });
  // Apron round the edge (just outside the playing surface, below its height).
  for (const sx of [-1, 1]) {
    const a = new THREE.Mesh(new THREE.BoxGeometry(0.035, apronH, TABLE.length + 0.07), conc);
    a.position.set(sx * (TABLE.halfWidth + 0.0175), top - apronH / 2 - 0.0015, 0);
    g.add(a);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.length + 0.07, apronH * 0.9), label);
    face.position.set(sx * (TABLE.halfWidth + 0.0355), top - apronH / 2 - 0.0015, 0);
    face.rotation.y = (sx * Math.PI) / 2;
    g.add(face);
  }
  for (const sz of [-1, 1]) g.add(box(TABLE.width + 0.07, apronH, 0.035, conc, 0, top - apronH / 2 - 0.0015, sz * (TABLE.halfLength + 0.0175)));
  // Underside slab and two pedestals with a logo panel.
  g.add(box(TABLE.width - 0.1, 0.06, TABLE.length - 0.2, conc, 0, top - 0.06, 0));
  const logo = new THREE.MeshStandardMaterial({
    map: canvasTexture(256, 160, (ctx) => {
      ctx.fillStyle = '#a3a6a1';
      ctx.fillRect(0, 0, 256, 160);
      const rnd = seeded(3);
      for (let i = 0; i < 1500; i++) {
        ctx.fillStyle = rnd() < 0.5 ? 'rgba(80,82,80,0.3)' : 'rgba(220,220,215,0.3)';
        ctx.fillRect(rnd() * 256, rnd() * 160, 1, 1);
      }
      // A small bat and ball, then the name.
      ctx.fillStyle = '#2b3446';
      ctx.save();
      ctx.translate(122, 70);
      ctx.rotate(-0.6);
      ctx.fillRect(-3, 8, 6, 16);
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(143, 58, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = 'bold 17px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('mem tt', 128, 104);
    }),
    roughness: 0.95,
  });
  for (const sz of [-1, 1]) {
    const ped = new THREE.Mesh(new THREE.BoxGeometry(1.0, top - 0.09, 0.16), [conc, conc, conc, conc, sz > 0 ? logo : conc, sz < 0 ? logo : conc]);
    ped.position.set(0, (top - 0.09) / 2, sz * 0.95);
    ped.castShadow = true;
    g.add(ped);
  }
  g.add(box(0.22, 0.2, 1.75, conc, 0, 0.35, 0));

  // Perforated steel net: a painted plate with round holes, a rolled top edge and chunky posts.
  const holes = canvasTexture(512, 64, (ctx) => {
    ctx.fillStyle = '#e7e9e6';
    ctx.fillRect(0, 0, 512, 64);
    ctx.globalCompositeOperation = 'destination-out';
    for (let r = 0; r < 4; r++)
      for (let c = 0; c < 64; c++) {
        ctx.beginPath();
        ctx.arc(4 + c * 8 + (r % 2) * 4, 10 + r * 13, 3.1, 0, Math.PI * 2);
        ctx.fill();
      }
  });
  const plate = new THREE.Mesh(
    new THREE.PlaneGeometry(NET.halfLength * 2, NET.height - 0.02),
    new THREE.MeshStandardMaterial({ map: holes, transparent: true, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.3, color: 0xdfe3e0 }),
  );
  plate.position.set(0, top + (NET.height - 0.02) / 2, 0);
  plate.castShadow = true;
  g.add(plate);
  const steel = std(0xc9cdc9, { roughness: 0.5, metalness: 0.4 });
  const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, NET.halfLength * 2, 8), steel);
  rail.rotation.z = Math.PI / 2;
  rail.position.set(0, NET.top - 0.01, 0);
  rail.castShadow = true;
  g.add(rail);
  for (const sx of [-1, 1]) {
    const post = box(0.04, NET.height + 0.06, 0.06, steel, sx * NET.halfLength, top + (NET.height - 0.06) / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  // Bats left lying on the ground under the table, like at the real one.
  const red = std(0xc0262b, { roughness: 0.6 });
  const blue = std(0x2066c8, { roughness: 0.6 });
  const handle = std(0x1f2a44, { roughness: 0.6 });
  for (const [x, z, ry, face] of [
    [-0.35, -0.35, 0.6, blue],
    [0.15, 0.45, 2.2, blue],
    [0.42, -0.6, -1.0, red],
  ] as const) {
    const bat = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.075, 0.012, 24), face);
    blade.scale.z = 1.1;
    bat.add(blade, box(0.035, 0.014, 0.1, handle, 0, 0, 0.13));
    bat.position.set(x, 0.012, z);
    bat.rotation.y = ry;
    g.add(bat);
  }
  return g;
}

// ---------------------------------------------------------------- the venue

export interface WonfordBuild {
  group: THREE.Group;
  floor: THREE.Texture;
  tableTop: THREE.Texture;
  update: (dt: number) => void;
}

export function buildWonford(): WonfordBuild {
  matCache = new Map();
  const g = new THREE.Group();
  const rnd = seeded(2024);

  // Sky: overcast, rotating very slowly.
  const sky = new THREE.Mesh(new THREE.SphereGeometry(70, 48, 24), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false }));
  sky.userData.dynamic = true;
  g.add(sky);

  // Distant hills, hazy in the fog.
  {
    const n = 160;
    const pos: number[] = [];
    const idx: number[] = [];
    const R = 62;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const h = 4 + Math.sin(a * 3 + 1) * 2.6 + Math.sin(a * 7 + 2) * 1.2 + Math.sin(a * 17) * 0.4 + Math.sin(a * 41) * 0.15;
      pos.push(Math.cos(a) * R, -1, Math.sin(a) * R, Math.cos(a) * R, h, Math.sin(a) * R);
      if (i < n) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.add(new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x4f5e4c, side: THREE.DoubleSide })));
  }

  // Lawn beyond the core floor (same 5 m stripe tile, aligned, so there's no seam).
  const outer = new THREE.Mesh(new THREE.CircleGeometry(95, 48), new THREE.MeshStandardMaterial({ map: lawnTexture(38), roughness: 0.95 }));
  outer.rotation.x = -Math.PI / 2;
  outer.position.y = -0.015;
  g.add(outer);

  // Worn earth round the table (it takes the ball's shadow, like the floor).
  const worn = new THREE.Mesh(new THREE.PlaneGeometry(8, 10), new THREE.MeshStandardMaterial({ map: wornTexture(), transparent: true, depthWrite: false, roughness: 1 }));
  worn.rotation.x = -Math.PI / 2;
  worn.position.y = 0.004;
  worn.userData.receiveShadow = true;
  g.add(worn);

  g.add(concreteTable());

  // ---- trees
  const forest: Forest = { bark: [], leaves: [], far: [], canopies: [] };
  // Cedars screening the car park (in front of the player, beyond the far end).
  for (const [x, z, h] of [
    [-11, -8.5, 15],
    [-6.5, -11, 17],
    [-1.5, -10, 16],
    [3.2, -11.5, 18],
    [-15.5, -12, 14],
    [7.6, -13.5, 15],
  ] as const)
    cedar(forest, rnd, x, z, h);
  // The big multi-stemmed lime on the left, leaves heaped round it.
  broadleaf(forest, rnd, -8.5, -1.5, { trunk: 4.2, r: 0.55, crownR: 5.2, crownH: 8.5, pal: PAL.lime, stems: 3, gaps: 0.22 });
  broadleaf(forest, rnd, -14, 4, { trunk: 3.8, r: 0.4, crownR: 4.2, crownH: 7, pal: PAL.turning, gaps: 0.18 });
  // Cherries in orange and a golden tree on the right.
  broadleaf(forest, rnd, 9.5, -4, { trunk: 1.8, r: 0.22, crownR: 3.6, crownH: 3.2, pal: PAL.cherry, gaps: 0.12 });
  broadleaf(forest, rnd, 14.5, -9, { trunk: 1.9, r: 0.22, crownR: 3.4, crownH: 3, pal: PAL.cherry, gaps: 0.12 });
  broadleaf(forest, rnd, 13, 3.5, { trunk: 2.6, r: 0.3, crownR: 3.4, crownH: 5, pal: PAL.golden, gaps: 0.05 });
  // Behind the player: the open lawn, a big plane, a chestnut in gold, a sapling.
  broadleaf(forest, rnd, -4, 13, { trunk: 5, r: 0.5, crownR: 5.5, crownH: 9, pal: PAL.turning, gaps: 0.2 });
  broadleaf(forest, rnd, 9, 18, { trunk: 3, r: 0.35, crownR: 4, crownH: 5.5, pal: PAL.golden, gaps: 0.06 });
  broadleaf(forest, rnd, -16, 17, { trunk: 4, r: 0.45, crownR: 4.6, crownH: 7.5, pal: PAL.summer, gaps: 0.15 });
  broadleaf(forest, rnd, 19, 12, { trunk: 3.5, r: 0.4, crownR: 4.2, crownH: 6.5, pal: PAL.turning, gaps: 0.15 });
  sapling(forest, rnd, 3.5, 8.5);
  sapling(forest, rnd, -10, 25);
  // Woodland edge all round, thinned where the car park and hall are.
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2 + rnd() * 0.08;
    const r = 30 + rnd() * 9;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (z < -12 && x > -14) continue; // car park and hall
    if (x < -30 && z < 5 && z > -30) continue; // houses
    const kind = rnd();
    const near = forest.leaves.length;
    if (kind < 0.25) cedar(forest, rnd, x, z, 12 + rnd() * 6);
    else broadleaf(forest, rnd, x, z, { trunk: 3 + rnd() * 2, r: 0.4, crownR: 3.5 + rnd() * 2.5, crownH: 6 + rnd() * 4, pal: kind < 0.5 ? PAL.summer : kind < 0.75 ? PAL.turning : PAL.golden, gaps: 0.05, blobs: 12 });
    forest.far.push(...forest.leaves.splice(near));
  }
  // A golden conifer and clipped hedges in front of the hall.
  {
    const x = 6;
    const z = -29.5;
    forest.bark.push({ m: limb(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, 2, z), 0.2) });
    for (let i = 0; i < 26; i++) {
      const a = rnd() * 6.3;
      const v = rnd();
      const y = 2 + v * 3.6;
      const rr = 2.2 * Math.sin(Math.PI * (0.15 + v * 0.8));
      forest.leaves.push({ m: blobAt(x + Math.cos(a) * rr * 0.7, y, z + Math.sin(a) * rr * 0.7, 1, 0.8, 1, a), c: (v > 0.35 ? PAL.topiary[Math.floor(rnd() * 3)] : PAL.topiary[3]).clone() });
    }
    for (const [hx, hz, s] of [
      [-3, -29, 1.5],
      [-0.6, -29.6, 1.3],
      [1.8, -29.2, 1.4],
      [10, -30.5, 1.6],
      [13, -30.8, 1.4],
    ] as const)
      for (let k = 0; k < 4; k++)
        forest.leaves.push({ m: blobAt(hx + (rnd() - 0.5) * s, s * 0.45, hz + (rnd() - 0.5) * s * 0.6, s * 0.75, s * 0.5, s * 0.6, rnd() * 6), c: pick(rnd, PAL.hedge) });
  }
  const barkGeo = new THREE.CylinderGeometry(0.72, 1, 1, 7, 1, true);
  barkGeo.translate(0, 0.5, 0);
  g.add(instanced(barkGeo, std(0xffffff, { roughness: 0.95 }), forest.bark.map((b) => ({ m: b.m, c: b.c ?? hex('#6b625a') }))));
  const foliage = std(0xffffff, { flatShading: true, roughness: 0.9 });
  g.add(instanced(lumpyBlob(1), foliage, forest.leaves));
  g.add(instanced(new THREE.IcosahedronGeometry(1, 0), foliage, forest.far));

  // Leaves heaped round the lime's base.
  const mound = new THREE.Mesh(lumpyBlob(4), std(0x6e5234, { flatShading: true, roughness: 1 }));
  mound.scale.set(1.7, 0.28, 1.7);
  mound.position.set(-8.5, 0, -1.5);
  g.add(mound);

  // ---- fallen leaves on the ground
  const leafCols = ['#c9a227', '#d98a2b', '#a8582a', '#7a4a2a', '#b8902f', '#8a6a3a', '#e0b84a', '#5d4630', '#b0702c'].map(hex);
  const fallen: { m: THREE.Matrix4; c: THREE.Color }[] = [];
  const flat = new THREE.Quaternion();
  const leafAt = (x: number, y: number, z: number) => {
    flat.setFromEuler(new THREE.Euler(-Math.PI / 2 + (rnd() - 0.5) * 0.5, 0, rnd() * Math.PI * 2, 'XZY'));
    const s = 0.7 + rnd() * 0.7;
    return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), flat.clone(), new THREE.Vector3(s, s, s));
  };
  for (let i = 0; i < 2600; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 24;
    fallen.push({ m: leafAt(Math.cos(a) * r, 0.006 + rnd() * 0.004, Math.sin(a) * r), c: pick(rnd, leafCols) });
  }
  for (const c of forest.canopies) {
    if (Math.hypot(c.x, c.z) > 26) continue;
    for (let i = 0; i < 70; i++) {
      const a = rnd() * Math.PI * 2;
      const r = Math.sqrt(rnd()) * c.r * 1.1;
      fallen.push({ m: leafAt(c.x + Math.cos(a) * r, 0.008 + rnd() * 0.004, c.z + Math.sin(a) * r), c: pick(rnd, leafCols) });
    }
  }
  for (let i = 0; i < 260; i++) {
    const a = rnd() * Math.PI * 2;
    const r = Math.sqrt(rnd()) * 1.7;
    const y = 0.28 * Math.max(0, 1 - (r / 1.7) ** 2) + 0.01;
    fallen.push({ m: leafAt(-8.5 + Math.cos(a) * r, y, -1.5 + Math.sin(a) * r), c: pick(rnd, leafCols) });
  }
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, -0.045);
  leafShape.quadraticCurveTo(0.04, 0, 0, 0.05);
  leafShape.quadraticCurveTo(-0.04, 0, 0, -0.045);
  const leafGeo = new THREE.ShapeGeometry(leafShape, 3);
  const leafMat = std(0xffffff, { side: THREE.DoubleSide, roughness: 0.9 });
  g.add(instanced(leafGeo, leafMat, fallen));

  // ---- car park beyond the cedars, behind a post-and-rail fence
  const wood = std(0x8a6a4c, { roughness: 0.95 });
  const posts: THREE.Matrix4[] = [];
  for (let x = -24; x <= 26; x += 2) posts.push(new THREE.Matrix4().makeTranslation(x, 0.45, -14.5));
  g.add(instanced(new THREE.BoxGeometry(0.12, 0.9, 0.12), wood, posts.map((m) => ({ m }))));
  g.add(box(50, 0.09, 0.06, wood, 1, 0.78, -14.45), box(50, 0.09, 0.06, wood, 1, 0.42, -14.45));
  const tarmac = new THREE.Mesh(
    new THREE.PlaneGeometry(60, 12.5),
    new THREE.MeshStandardMaterial({
      map: canvasTexture(
        128,
        128,
        (ctx) => {
          const r2 = seeded(8);
          ctx.fillStyle = '#4a4c4f';
          ctx.fillRect(0, 0, 128, 128);
          for (let i = 0; i < 2500; i++) {
            ctx.fillStyle = r2() < 0.5 ? '#3d3f42' : '#5a5c5f';
            ctx.fillRect(r2() * 128, r2() * 128, 1, 1);
          }
        },
        [12, 2.5],
      ),
      roughness: 0.95,
    }),
  );
  tarmac.rotation.x = -Math.PI / 2;
  tarmac.position.set(2, 0.006, -21);
  g.add(tarmac);
  const lines: THREE.Matrix4[] = [];
  for (let x = -22; x <= 24; x += 2.6) for (const z of [-17.5, -23.5]) lines.push(new THREE.Matrix4().makeTranslation(x, 0.012, z));
  const lineGeo = new THREE.PlaneGeometry(0.1, 4.6);
  lineGeo.rotateX(-Math.PI / 2);
  g.add(instanced(lineGeo, std(0xe8e6de), lines.map((m) => ({ m }))));
  const carCols = [0xf2f2f0, 0x16181c, 0x1f3550, 0x8e949b, 0xb3262b, 0xf2f2f0, 0x2a2d33, 0x6c7b8a, 0xd7d9db, 0x2c4a8a];
  for (const z of [-17.5, -23.5]) {
    for (let x = -20.7; x <= 23; x += 2.6) {
      if (rnd() < 0.25) continue;
      const c = car(pick(rnd, carCols), rnd);
      c.position.set(x, 0, z);
      c.rotation.y = (z > -20 ? 0 : Math.PI) + (rnd() - 0.5) * 0.05;
      g.add(c);
    }
  }
  const iron = std(0x3a3f44, { metalness: 0.4, roughness: 0.6 });
  for (const [x, z] of [
    [-12, -20.5],
    [4, -20.5],
    [18, -20.5],
  ] as const) {
    const l = lampPost(iron, 6.5);
    l.position.set(x, 0, z);
    g.add(l);
  }
  // A blue parking sign and a green information board by the fence.
  {
    const s = new THREE.Mesh(new THREE.PlaneGeometry(0.7, 0.7), new THREE.MeshStandardMaterial({ map: signTexture(['P'], '#1d4f9c', '#ffffff', 128, 128) }));
    s.position.set(13.5, 2.1, -14.2);
    g.add(s, box(0.06, 2.4, 0.06, iron, 13.5, 1.2, -14.25));
    const info = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), new THREE.MeshStandardMaterial({ map: signTexture(['WONFORD HOUSE', 'please take', 'bats home'], '#2f6b45', '#f4f1e6', 288, 192) }));
    info.position.set(16.2, 1.1, -14.2);
    g.add(info, box(0.05, 1.4, 0.05, iron, 15.8, 0.7, -14.25), box(0.05, 1.4, 0.05, iron, 16.6, 0.7, -14.25));
  }

  // ---- the hall, beyond the car park, angled towards the table
  const h = hall();
  h.position.set(9, 0, -36);
  h.rotation.y = -0.18;
  g.add(h);
  // A small stone lodge on the left, and red-brick houses beyond.
  {
    const stone = new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 });
    const lodge = new THREE.Group();
    const walls = new THREE.Mesh(tiledBox(6, 4.5, 5, 3), stone);
    walls.position.y = 2.25;
    lodge.add(walls);
    const lr = roofPrism(6.4, 5.6, 2.4, new THREE.MeshStandardMaterial({ map: slateTexture(), roughness: 0.75 }), 2);
    lr.position.y = 4.5;
    lodge.add(lr, box(0.8, 2, 0.8, std(0x7d7069), 2, 5.8, 0));
    const lw = windowTexture();
    for (const x of [-1.6, 1.6]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.9), new THREE.MeshStandardMaterial({ map: lw, roughness: 0.4 }));
      w.position.set(x, 2.4, 2.52);
      lodge.add(w);
    }
    lodge.position.set(-21, 0, -10);
    lodge.rotation.y = 0.5;
    g.add(lodge);
    const brick = new THREE.MeshStandardMaterial({
      roughness: 0.95,
      map: canvasTexture(256, 256, (ctx) => {
        const r3 = seeded(19);
        ctx.fillStyle = '#9c5039';
        ctx.fillRect(0, 0, 256, 256);
        for (let y = 0; y < 256; y += 4)
          for (let x = (y / 4) % 2 ? -4 : 0; x < 256; x += 9) {
            ctx.fillStyle = r3() < 0.5 ? '#a95a40' : '#8f4733';
            ctx.fillRect(x, y, 8, 3);
          }
        for (const wy of [40, 150])
          for (const wx of [30, 110, 190]) {
            ctx.fillStyle = '#f0eee8';
            ctx.fillRect(wx, wy, 40, 56);
            ctx.fillStyle = '#4a5560';
            ctx.fillRect(wx + 4, wy + 4, 32, 48);
            ctx.fillStyle = '#f0eee8';
            ctx.fillRect(wx + 18, wy + 4, 3, 48);
          }
      }),
    });
    for (let i = 0; i < 4; i++) {
      const house = new THREE.Group();
      house.add(box(7, 6, 7, brick, 0, 3, 0));
      const hr = roofPrism(7.4, 7.6, 3, std(0x4a4f57), 2);
      hr.position.y = 6;
      house.add(hr, box(0.7, 1.8, 0.9, brick, -2.5, 8.2, 0));
      house.position.set(-36 - (i % 2) * 2, 0, -24 + i * 8.5);
      house.rotation.y = Math.PI / 2 + 0.25;
      g.add(house);
    }
  }
  // Behind the player: a long, low stone barn with a solar roof, and a pale block beyond the trees.
  {
    const barn = new THREE.Group();
    const walls = new THREE.Mesh(tiledBox(18, 3.5, 7, 3), new THREE.MeshStandardMaterial({ map: stoneTexture(), roughness: 0.95 }));
    walls.position.y = 1.75;
    barn.add(walls);
    const br = roofPrism(18.4, 7.6, 2.6, [std(0x4a4f57), new THREE.MeshStandardMaterial({ map: solarRoofTexture(), roughness: 0.4, metalness: 0.3 })] as unknown as THREE.Material);
    br.position.y = 3.5;
    barn.add(br);
    barn.position.set(-27, 0, 41);
    barn.rotation.y = Math.PI - 0.35;
    g.add(barn);
    g.add(box(7, 7, 6, std(0xcfd2cd), 30, 3.5, 44));
  }

  // ---- picnic tables, the shelter, a bin, lamp posts on the lawn
  const picnicWood = std(0x8a7058, { roughness: 0.95 });
  for (const [x, z, ry, roofed] of [
    [6.5, 9.5, 0.3, false],
    [-7, 20, -0.4, false],
    [3, 22, 1.2, false],
    [9.5, -10.5, 1.4, true],
    [-12.5, -5.5, 0.9, false],
  ] as const) {
    const p = picnicTable(picnicWood, roofed);
    p.position.set(x, 0, z);
    p.rotation.y = ry;
    g.add(p);
  }
  const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.27, 0.9, 14), std(0x2f4a3a));
  bin.position.set(3.4, 0.45, -7.8);
  g.add(bin);
  for (const [x, z] of [
    [-5.5, 6],
    [17, -2],
  ] as const) {
    const l = lampPost(iron, 4.8);
    l.position.set(x, 0, z);
    g.add(l);
  }

  // ---- life: falling leaves, pigeons on the lawn, crows overhead
  const FALL = 70;
  const fallMesh = new THREE.InstancedMesh(leafGeo, leafMat, FALL);
  const drifting: { x: number; y: number; z: number; vy: number; ph: number; spin: number; s: number }[] = [];
  const crowned = forest.canopies.filter((c) => Math.hypot(c.x, c.z) < 22);
  const respawn = (d?: (typeof drifting)[number]) => {
    const c = crowned[Math.floor(rnd() * crowned.length)];
    const a = rnd() * Math.PI * 2;
    let x = c.x + Math.cos(a) * c.r * rnd();
    let z = c.z + Math.sin(a) * c.r * rnd();
    // Never across the playing area.
    if (Math.abs(x) < 3 && Math.abs(z) < 4.5) x += 4 * Math.sign(x || 1);
    const n = { x, y: c.top * (0.5 + rnd() * 0.4), z, vy: 0.35 + rnd() * 0.35, ph: rnd() * 6, spin: 1 + rnd() * 3, s: 0.8 + rnd() * 0.6 };
    if (d) Object.assign(d, n);
    return n;
  };
  for (let i = 0; i < FALL; i++) {
    const d = respawn();
    d.y = rnd() * d.y;
    drifting.push(d);
    fallMesh.setColorAt(i, pick(rnd, leafCols));
  }
  fallMesh.frustumCulled = false;
  g.add(fallMesh);

  const pigeonMat = std(0x8a8f99, { roughness: 0.8 });
  const pigeonDark = std(0x4b5160, { roughness: 0.8 });
  const pigeons = [
    [4.5, -6],
    [5.3, -6.6],
    [-3.5, 8],
    [-2.8, 7.2],
    [6, 6.5],
  ].map(([x, z], i) => {
    const p = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.1, 10, 8), pigeonMat);
    body.scale.set(0.8, 0.75, 1.3);
    body.position.y = 0.12;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), pigeonDark);
    head.position.set(0, 0.22, 0.11);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.04, 5), std(0x3b3b3b));
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.21, 0.17);
    const tail = box(0.08, 0.02, 0.12, pigeonDark, 0, 0.12, -0.16);
    p.add(body, head, beak, tail);
    p.position.set(x, 0, z);
    p.userData = { dynamic: true, home: new THREE.Vector2(x, z), head, beak, t: i * 1.7, heading: rnd() * 6.3 };
    g.add(p);
    return p;
  });

  const crowMat = new THREE.MeshBasicMaterial({ color: 0x1b1d20 });
  const crows: THREE.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const c = new THREE.Group();
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.45, 4), crowMat);
    body.rotation.x = Math.PI / 2;
    c.add(body);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.16), new THREE.MeshBasicMaterial({ color: 0x1b1d20, side: THREE.DoubleSide }));
      w.geometry.translate(0.22, 0, 0);
      w.rotation.x = -Math.PI / 2;
      w.scale.x = sx;
      c.add(w);
    }
    c.userData.dynamic = true;
    g.add(c);
    crows.push(c);
  }

  const m4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  let t = 0;
  const update = (dt: number) => {
    t += dt;
    sky.rotation.y += dt * 0.004;
    for (let i = 0; i < FALL; i++) {
      const d = drifting[i];
      d.y -= d.vy * dt;
      d.x += 0.12 * dt;
      const sway = Math.sin(t * 1.3 + d.ph);
      p3.set(d.x + sway * 0.6, d.y, d.z + Math.cos(t * 0.9 + d.ph) * 0.4);
      // Landed, or drifted over the playing area: start again from a tree.
      if (d.y < 0.01 || (Math.abs(p3.x) < 2.8 && Math.abs(p3.z) < 4.4 && p3.y < 5)) {
        respawn(d);
        p3.set(d.x, d.y, d.z);
      }
      e.set(sway * 1.2, t * d.spin + d.ph, Math.cos(t * 2 + d.ph) * 0.8);
      q.setFromEuler(e);
      s3.setScalar(d.s * 1.4);
      fallMesh.setMatrixAt(i, m4.compose(p3, q, s3));
    }
    fallMesh.instanceMatrix.needsUpdate = true;
    for (const p of pigeons) {
      const u = p.userData;
      u.t += dt;
      const phase = u.t % 4;
      if (phase < 1.6) {
        // Walk, head bobbing, turning gently, staying near home.
        u.heading += Math.sin(u.t * 0.7) * dt * 0.8;
        const home = u.home as THREE.Vector2;
        const away = Math.hypot(p.position.x - home.x, p.position.z - home.y);
        if (away > 1.2) u.heading = Math.atan2(home.x - p.position.x, home.y - p.position.z);
        p.position.x += Math.sin(u.heading) * 0.25 * dt;
        p.position.z += Math.cos(u.heading) * 0.25 * dt;
        p.rotation.y = u.heading;
        u.head.position.z = 0.11 + Math.sin(u.t * 14) * 0.02;
        u.head.position.y = 0.22;
      } else {
        // Peck.
        const k = Math.max(0, Math.sin((phase - 1.6) * 9));
        u.head.position.set(0, 0.22 - k * 0.12, 0.11 + k * 0.05);
      }
      u.beak.position.set(0, u.head.position.y - 0.01, u.head.position.z + 0.06);
    }
    crows.forEach((c, i) => {
      const a = t * (0.16 + i * 0.03) + i * 2.1;
      const r = 16 + i * 3;
      c.position.set(Math.cos(a) * r, 11 + i * 1.5 + Math.sin(t * 0.7 + i) * 0.5, Math.sin(a) * r - 4);
      c.rotation.y = -a;
      const flap = Math.sin(t * 7 + i) * 0.5;
      c.children[1].rotation.z = flap;
      c.children[2].rotation.z = -flap;
    });
  };

  mergeStatic(g);
  return { group: g, floor: lawnTexture(8), tableTop: concreteTexture(), update };
}
