import * as THREE from 'three';

/**
 * A light source (lamp, LED, bulb): brighter than white, so it clears the bloom
 * threshold at High quality while lit surfaces don't. Tone mapping keeps it in range.
 */
function glow(color: number, strength = 2.2) {
  const m = new THREE.MeshBasicMaterial({ color });
  m.color.multiplyScalar(strength);
  return m;
}

/**
 * IT-themed venues, built procedurally (no external assets). A venue restyles the
 * core scene's lights, floor and background, and adds its own props. Everything
 * stays outside the playing area so the ball and its shadow remain readable.
 */
export type VenueId = 'sandbox' | 'office' | 'mem' | 'server' | 'conference' | 'rooftop' | 'park' | 'beach';
export type Ambience = 'none' | 'office' | 'servers' | 'room' | 'wind';
/** Background song per venue (see audio/music.ts). */
export type SongId = 'none' | 'office' | 'mem' | 'servers' | 'room' | 'wind';

export const VENUES: Record<VenueId, { name: string; ambience: Ambience; song: SongId }> = {
  sandbox: { name: 'Sandbox', ambience: 'none', song: 'none' },
  office: { name: 'Open-plan office', ambience: 'office', song: 'office' },
  mem: { name: 'MEM', ambience: 'servers', song: 'mem' },
  server: { name: 'Test Bay', ambience: 'office', song: 'servers' },
  conference: { name: 'Conference room', ambience: 'room', song: 'room' },
  rooftop: { name: 'Rooftop (company offsite)', ambience: 'wind', song: 'wind' },
  park: { name: 'City Park', ambience: 'wind', song: 'wind' },
  beach: { name: 'Offsite beach', ambience: 'wind', song: 'wind' },
};

export interface Venue {
  id: VenueId;
  group: THREE.Group;
  update(dt: number, time: number): void;
  /** Venues with a screen show the score on it. */
  setScore?(lines: string[]): void;
  dispose(): void;
}

// ---------------------------------------------------------------- helpers

function canvasTexture(w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  // Signs and boards are seen at a slant: keep them sharp (clamped to what the GPU supports).
  t.anisotropy = 8;
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(...repeat);
  }
  t.anisotropy = 4;
  return t;
}

const std = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.8, ...extra });

function box(w: number, h: number, d: number, mat: THREE.Material, x: number, y: number, z: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}

/** Many copies of one mesh, placed by a list of matrices. */
function instances(geo: THREE.BufferGeometry, mat: THREE.Material, placements: THREE.Matrix4[]) {
  const m = new THREE.InstancedMesh(geo, mat, placements.length);
  placements.forEach((p, i) => m.setMatrixAt(i, p));
  m.instanceMatrix.needsUpdate = true;
  return m;
}

const at = (x: number, y: number, z: number, ry = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(s, s, s));

function room(group: THREE.Group, w: number, d: number, h: number, wallMat: THREE.Material, opts: { ceiling?: THREE.Material; skipWalls?: ('back' | 'front' | 'left' | 'right')[] } = {}) {
  const skip = new Set(opts.skipWalls ?? []);
  const wall = (gw: number, x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(gw, h), wallMat);
    m.position.set(x, h / 2, z);
    m.rotation.y = ry;
    group.add(m);
  };
  if (!skip.has('back')) wall(w, 0, -d / 2, 0);
  if (!skip.has('front')) wall(w, 0, d / 2, Math.PI);
  if (!skip.has('left')) wall(d, -w / 2, 0, Math.PI / 2);
  if (!skip.has('right')) wall(d, w / 2, 0, -Math.PI / 2);
  if (opts.ceiling) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(w, d), opts.ceiling);
    c.rotation.x = Math.PI / 2;
    c.position.y = h;
    group.add(c);
  }
}

function plant(x: number, z: number, s = 1) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.14 * s, 0.35 * s, 12), std(0xd6d3cd));
  pot.position.y = 0.175 * s;
  g.add(pot);
  const leaves = std(0x3f7d4e);
  for (let i = 0; i < 5; i++) {
    const l = new THREE.Mesh(new THREE.SphereGeometry(0.2 * s, 10, 8), leaves);
    l.position.set(Math.cos(i * 1.3) * 0.12 * s, (0.45 + (i % 3) * 0.15) * s, Math.sin(i * 1.3) * 0.12 * s);
    l.scale.set(1, 1.4, 1);
    g.add(l);
  }
  g.position.set(x, 0, z);
  return g;
}

/** A whiteboard / sign with hand-drawn text. */
function board(lines: string[], w: number, h: number, opts: { bg?: string; fg?: string; font?: string } = {}) {
  const tex = canvasTexture(512, Math.round((512 * h) / w), (ctx) => {
    ctx.fillStyle = opts.bg ?? '#f7f7f4';
    ctx.fillRect(0, 0, 512, 512);
    ctx.fillStyle = opts.fg ?? '#1b3f7a';
    ctx.font = opts.font ?? 'bold 34px "Comic Sans MS", "Segoe Print", cursive';
    lines.forEach((l, i) => ctx.fillText(l, 24, 56 + i * 46));
  });
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6 }));
}

// ---------------------------------------------------------------- venues

function office(): Venue {
  const g = new THREE.Group();
  const W = 16;
  const D = 20;
  const H = 3.4;
  room(g, W, D, H, std(0xe9e6df), { ceiling: std(0xf2f1ee), skipWalls: ['back'] });

  // Window wall behind the far end: bright sky panels and mullions.
  const sky = canvasTexture(256, 256, (ctx) => {
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#9cc7ef');
    grd.addColorStop(1, '#e3f0fb');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 256, 256);
  });
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: sky }));
  glass.position.set(0, H / 2, -D / 2);
  g.add(glass);
  const mull = std(0x4b5563);
  for (let x = -W / 2; x <= W / 2; x += 2) g.add(box(0.08, H, 0.08, mull, x, H / 2, -D / 2 + 0.05));
  g.add(box(W, 0.08, 0.08, mull, 0, 2.2, -D / 2 + 0.05));

  // Desk clusters along both sides, each with a monitor (code on screen) and a chair.
  const deskTop = std(0xcfc6b5);
  const screen = canvasTexture(128, 80, (ctx) => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, 128, 80);
    const cols = ['#60a5fa', '#f472b6', '#34d399', '#fbbf24', '#e5e7eb'];
    for (let i = 0; i < 9; i++) {
      ctx.fillStyle = cols[i % cols.length];
      ctx.fillRect(8 + (i % 3) * 6, 8 + i * 7.5, 30 + ((i * 37) % 70), 3);
    }
  });
  const desks: THREE.Matrix4[] = [];
  const mons: THREE.Matrix4[] = [];
  const chairs: THREE.Matrix4[] = [];
  for (const side of [-1, 1]) {
    for (let z = -7; z <= 7; z += 2.2) {
      const x = side * 5.6;
      desks.push(at(x, 0.74, z));
      mons.push(at(x + side * 0.25, 1.02, z, side > 0 ? -Math.PI / 2 : Math.PI / 2));
      chairs.push(at(x - side * 0.65, 0.45, z));
    }
  }
  g.add(instances(new THREE.BoxGeometry(1.4, 0.04, 1.8), deskTop, desks));
  g.add(instances(new THREE.BoxGeometry(0.62, 0.38, 0.03), new THREE.MeshStandardMaterial({ map: screen, emissive: 0xffffff, emissiveMap: screen, emissiveIntensity: 0.6 }), mons));
  g.add(instances(new THREE.BoxGeometry(0.5, 0.1, 0.5), std(0x1f2937), chairs));
  g.add(instances(new THREE.BoxGeometry(0.5, 0.55, 0.06), std(0x1f2937), chairs.map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0.3, 0.25)))));

  // Ceiling light panels.
  const panel = glow(0xffffff);
  const panels: THREE.Matrix4[] = [];
  for (let x = -4; x <= 4; x += 4) for (let z = -8; z <= 8; z += 4) panels.push(at(x, H - 0.01, z));
  const pm = instances(new THREE.PlaneGeometry(1.2, 0.6).rotateX(Math.PI / 2), panel, panels);
  g.add(pm);

  const wb = board(['SPRINT 42', '☐ fix prod', '☑ table tennis', '   > standup'], 2.4, 1.3);
  wb.position.set(-W / 2 + 0.02, 1.5, 2);
  wb.rotation.y = Math.PI / 2;
  g.add(wb);
  g.add(plant(-6.8, -8.5, 1.4), plant(6.8, -8.5, 1.4), plant(-3, -9.2), plant(3, -9.2));

  const carpet = canvasTexture(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#5b6575';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? '#535d6c' : '#66707f';
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
      }
      ctx.strokeStyle = '#4b5462';
      ctx.strokeRect(0, 0, 128, 128);
    },
    [24, 24],
  );
  return makeVenue('office', g, { background: 0xe8eef5, fog: [0xe8eef5, 14, 34], hemi: [0xffffff, 0x8a8f99, 1.1], key: [0xffffff, 2.0], env: 0.4, floor: carpet });
}

type FlagDraw = (ctx: CanvasRenderingContext2D) => void;
const stripes = (cols: string[], vertical: boolean): FlagDraw => (ctx) =>
  cols.forEach((c, i) => {
    ctx.fillStyle = c;
    if (vertical) ctx.fillRect((i * 96) / cols.length, 0, 96 / cols.length + 1, 64);
    else ctx.fillRect(0, (i * 64) / cols.length, 96, 64 / cols.length + 1);
  });
const star = (ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string) => {
  ctx.fillStyle = col;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  ctx.fill();
};
const unionJack: FlagDraw = (ctx) => {
  ctx.fillStyle = '#012169';
  ctx.fillRect(0, 0, 96, 64);
  ctx.lineCap = 'butt';
  for (const [w, c] of [
    [12, '#ffffff'],
    [5, '#c8102e'],
  ] as const) {
    ctx.strokeStyle = c;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(96, 64);
    ctx.moveTo(96, 0);
    ctx.lineTo(0, 64);
    ctx.stroke();
  }
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(38, 0, 20, 64);
  ctx.fillRect(0, 22, 96, 20);
  ctx.fillStyle = '#c8102e';
  ctx.fillRect(42, 0, 12, 64);
  ctx.fillRect(0, 26, 96, 12);
};
/** Simplified national flags for the bunting (drawn at 96 × 64). */
const FLAGS: FlagDraw[] = [
  // Mexico
  (ctx) => {
    stripes(['#006847', '#ffffff', '#ce1126'], true)(ctx);
    ctx.fillStyle = '#8a5a2b';
    ctx.beginPath();
    ctx.arc(48, 32, 7, 0, Math.PI * 2);
    ctx.fill();
  },
  // Brazil
  (ctx) => {
    ctx.fillStyle = '#009c3b';
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#ffdf00';
    ctx.beginPath();
    ctx.moveTo(48, 6);
    ctx.lineTo(90, 32);
    ctx.lineTo(48, 58);
    ctx.lineTo(6, 32);
    ctx.fill();
    ctx.fillStyle = '#002776';
    ctx.beginPath();
    ctx.arc(48, 32, 14, 0, Math.PI * 2);
    ctx.fill();
  },
  // Japan
  (ctx) => {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#bc002d';
    ctx.beginPath();
    ctx.arc(48, 32, 17, 0, Math.PI * 2);
    ctx.fill();
  },
  // Haiti
  (ctx) => {
    stripes(['#00209f', '#d21034'], false)(ctx);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(36, 22, 24, 20);
    ctx.fillStyle = '#016a16';
    ctx.fillRect(44, 28, 8, 10);
  },
  // Ghana
  (ctx) => {
    stripes(['#ce1126', '#fcd116', '#006b3f'], false)(ctx);
    star(ctx, 48, 32, 10, '#000000');
  },
  // Australia
  (ctx) => {
    ctx.fillStyle = '#012169';
    ctx.fillRect(0, 0, 96, 64);
    ctx.save();
    ctx.scale(0.5, 0.5);
    unionJack(ctx);
    ctx.restore();
    star(ctx, 24, 48, 7, '#ffffff');
    for (const [x, y] of [
      [72, 12],
      [62, 30],
      [82, 26],
      [72, 52],
    ])
      star(ctx, x, y, 4, '#ffffff');
  },
  // United Kingdom
  unionJack,
  // France
  stripes(['#0055a4', '#ffffff', '#ef4135'], true),
  // Germany
  stripes(['#000000', '#dd0000', '#ffce00'], false),
  // Italy
  stripes(['#009246', '#ffffff', '#ce2b37'], true),
  // Ireland
  stripes(['#169b62', '#ffffff', '#ff883e'], true),
  // Jamaica
  (ctx) => {
    ctx.fillStyle = '#009b3a';
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#000000';
    ctx.beginPath();
    ctx.moveTo(0, 6);
    ctx.lineTo(40, 32);
    ctx.lineTo(0, 58);
    ctx.moveTo(96, 6);
    ctx.lineTo(56, 32);
    ctx.lineTo(96, 58);
    ctx.fill();
    ctx.strokeStyle = '#fed100';
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(96, 64);
    ctx.moveTo(96, 0);
    ctx.lineTo(0, 64);
    ctx.stroke();
  },
  // Poland
  stripes(['#ffffff', '#dc143c'], false),
  // Sweden
  (ctx) => {
    ctx.fillStyle = '#006aa7';
    ctx.fillRect(0, 0, 96, 64);
    ctx.fillStyle = '#fecc00';
    ctx.fillRect(28, 0, 12, 64);
    ctx.fillRect(0, 26, 96, 12);
  },
];

/**
 * MEM: the IT workshop. A low-ceilinged, cramped room of painted blockwork with red
 * window and door frames, benches buried in monitors, label printers and cable,
 * cardboard stacked to the ceiling, a hazard-taped patch in the carpet and an
 * orange fire exit behind the far player. The walls sit close to the table.
 */
function mem(): Venue {
  const g = new THREE.Group();
  const W = 7.0;
  const D = 9.8;
  const H = 2.5;
  // Seeded so the clutter lands the same way every time.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];

  const block = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#efe3b8';
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = '#d9cc9e';
      ctx.lineWidth = 3;
      for (let r = 0; r < 4; r++) {
        ctx.beginPath();
        ctx.moveTo(0, r * 64);
        ctx.lineTo(256, r * 64);
        ctx.stroke();
        for (let c = 0; c < 2; c++) {
          const x = c * 128 + (r % 2) * 64;
          ctx.beginPath();
          ctx.moveTo(x, r * 64);
          ctx.lineTo(x, r * 64 + 64);
          ctx.stroke();
        }
      }
      for (let i = 0; i < 400; i++) {
        ctx.fillStyle = `rgba(120,100,60,${Math.random() * 0.08})`;
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 3, 3);
      }
    },
    [6, 2],
  );
  const wallMat = new THREE.MeshStandardMaterial({ map: block, roughness: 0.9 });
  room(g, W, D, H, wallMat, { ceiling: std(0xf3f1ea) });
  const red = std(0xd42a1e, { roughness: 0.5 });
  const orange = std(0xf07f12, { roughness: 0.5 });
  const white = std(0xeeeeea, { roughness: 0.6 });
  const black = std(0x16181c, { roughness: 0.5 });
  const cardboard = std(0xb98b55, { roughness: 0.95 });

  // Red dado band round the room, like the painted window sills.
  for (const [w, d, x, z] of [
    [W, 0.03, 0, -D / 2 + 0.02],
    [W, 0.03, 0, D / 2 - 0.02],
    [0.03, D, -W / 2 + 0.02, 0],
    [0.03, D, W / 2 - 0.02, 0],
  ] as const)
    g.add(box(w, 0.08, d, red, x, 1.18, z));

  // Fluorescent strips in the low ceiling.
  for (const z of [-3, 0, 3]) g.add(box(1.4, 0.04, 0.14, glow(0xf4f8ff), 0, H - 0.03, z));

  // ---- Far wall (behind the opponent): orange fire exit, extinguishers, bins, the score TV.
  const fz = -D / 2;
  const dx = 2.2;
  g.add(box(0.98, 2.15, 0.06, orange, dx, 1.075, fz + 0.03));
  g.add(box(0.74, 0.62, 0.02, new THREE.MeshStandardMaterial({ color: 0x3b82f6, roughness: 0.15, metalness: 0.2 }), dx, 1.4, fz + 0.07));
  g.add(box(0.74, 0.7, 0.02, std(0x5a3a22), dx, 0.55, fz + 0.07));
  g.add(box(0.1, 0.4, 0.04, orange, dx - 0.4, 1.0, fz + 0.1));
  const exit = board(['  🏃 Fire exit'], 0.6, 0.18, { bg: '#0b8a3e', fg: '#ffffff', font: 'bold 64px sans-serif' });
  exit.position.set(dx, 2.0, fz + 0.075);
  g.add(exit);
  const lastOut = board(['Are you the last', 'one out?', '', 'Close the windows.', 'Lock the outside door.'], 0.32, 0.24, { fg: '#222222', font: 'bold 38px sans-serif' });
  lastOut.position.set(dx, 1.3, fz + 0.085);
  g.add(lastOut);
  const extinguisher = (x: number, z: number, ry: number, label = 0xd8261d) => {
    const e = new THREE.Group();
    e.add(new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.55, 14), std(label, { roughness: 0.35 })));
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.05, 0.08, 8), black);
    head.position.y = 0.31;
    e.add(head);
    e.position.set(x, 0.62, z);
    e.rotation.y = ry;
    return e;
  };
  g.add(extinguisher(3.0, fz + 0.12, 0), extinguisher(3.3, fz + 0.12, 0));
  g.add(box(0.4, 0.65, 0.35, white, 1.35, 0.33, fz + 0.25), box(0.4, 0.65, 0.35, white, 0.9, 0.33, fz + 0.25));

  let screenLines = ['MEM TABLE TENNIS', 'WORKSHOP OPEN'];
  const scr = document.createElement('canvas');
  scr.width = 1024;
  scr.height = 576;
  const scrTex = new THREE.CanvasTexture(scr);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = 8;
  const drawScreen = () => {
    const ctx = scr.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    const grd = ctx.createLinearGradient(0, 0, 512, 288);
    grd.addColorStop(0, '#0a2a6e');
    grd.addColorStop(1, '#1d5fd1');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 42px ui-monospace, monospace';
    screenLines.slice(0, 4).forEach((l, i) => ctx.fillText(l, 24, 74 + i * 60));
    scrTex.needsUpdate = true;
  };
  drawScreen();
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), new THREE.MeshBasicMaterial({ map: scrTex }));
  tv.position.set(-1.2, 1.75, fz + 0.06);
  g.add(tv, box(1.68, 0.98, 0.05, black, -1.2, 1.75, fz + 0.025));

  // Corner stack of deliveries and a roll cage, far left.
  const boxes: THREE.Matrix4[] = [];
  const boxAt = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
    boxes.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + sy / 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz)));
  let y = 0;
  for (let i = 0; i < 6; i++) {
    const h = 0.25 + rnd() * 0.2;
    boxAt(-3.2 + rnd() * 0.08, y, fz + 0.45, 0.6, h, 0.5, (rnd() - 0.5) * 0.2);
    y += h;
  }
  y = 0;
  for (let i = 0; i < 4; i++) {
    const h = 0.3 + rnd() * 0.15;
    boxAt(-2.5, y, fz + 0.4, 0.5, h, 0.45, (rnd() - 0.5) * 0.3);
    y += h;
  }
  const cage = std(0xb8bcc2, { metalness: 0.7, roughness: 0.35, wireframe: true });
  g.add(box(0.7, 1.7, 0.8, cage, 0.0, 0.88, fz + 0.5));
  const fragile = board(['FRAGILE', '130W', 'power supply'], 0.5, 0.35, { bg: '#c49a63', fg: '#b3141b', font: 'bold 70px sans-serif' });
  fragile.position.set(-2.5, 0.3, fz + 0.63);
  g.add(fragile);

  // ---- Left wall: long white bench, monitors, printers and a tangle of cable.
  const lx = -W / 2;
  g.add(box(0.75, 0.04, D - 2.2, white, lx + 0.38, 0.9, 0.2));
  g.add(box(0.7, 0.86, D - 2.2, std(0xe4e2dc), lx + 0.36, 0.43, 0.2));
  for (let z = -3.4; z <= 4; z += 0.6) g.add(box(0.015, 0.1, 0.015, red, lx + 0.74, 0.7, z), box(0.015, 0.1, 0.015, red, lx + 0.74, 0.3, z + 0.08));
  // Shelves above, piled with kit.
  for (const sy of [1.55, 2.0]) g.add(box(0.35, 0.03, D - 2.2, white, lx + 0.18, sy, 0.2));

  const screens = [
    ['#0f3fa8', '#3c7ff0'],
    ['#0f172a', '#334155'],
    ['#123b2a', '#3a8f68'],
    ['#1d5fd1', '#9ec5ff'],
  ].map(([a, b]) =>
    canvasTexture(128, 80, (ctx) => {
      const grd = ctx.createLinearGradient(0, 0, 128, 80);
      grd.addColorStop(0, a);
      grd.addColorStop(1, b);
      ctx.fillStyle = grd;
      ctx.fillRect(0, 0, 128, 80);
      ctx.fillStyle = '#f8fafc';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('11:35', 36, 46);
    }),
  );
  const monitor = (x: number, z: number, ry: number, s = 1, on = true) => {
    const m = new THREE.Group();
    const tex = pick(screens);
    m.add(box(0.56 * s, 0.34 * s, 0.03, black, 0, 0, 0));
    if (on) {
      const face = new THREE.Mesh(new THREE.PlaneGeometry(0.52 * s, 0.3 * s), new THREE.MeshBasicMaterial({ map: tex }));
      face.position.z = 0.017;
      m.add(face);
    }
    m.add(box(0.04, 0.2, 0.04, black, 0, -0.2 * s, -0.04), box(0.2, 0.015, 0.16, black, 0, -0.3 * s, -0.02));
    m.position.set(x, 0.92 + 0.3 * s, z);
    m.rotation.y = ry;
    return m;
  };
  const kit: THREE.Matrix4[] = [];
  const kitAt = (x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0) =>
    kit.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y + sy / 2, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(sx, sy, sz)));
  const cables: THREE.Matrix4[] = [];
  const cableAt = (x: number, y: number, z: number, s = 1) => cables.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 3, rnd() * 3, rnd() * 3)), new THREE.Vector3(s, s * 0.5, s)));
  const printers: THREE.Matrix4[] = [];

  for (let z = -3.6; z <= 3.6; z += 1.15) {
    g.add(monitor(lx + 0.35, z + (rnd() - 0.5) * 0.2, Math.PI / 2 + (rnd() - 0.5) * 0.3, 0.9 + rnd() * 0.3, rnd() > 0.2));
    kitAt(lx + 0.5, 0.92, z + 0.4, 0.16, 0.02, 0.44, Math.PI / 2 + (rnd() - 0.5) * 0.4); // keyboard
    if (rnd() > 0.4) printers.push(at(lx + 0.55, 0.99, z - 0.45, Math.PI / 2 + rnd() * 0.4));
    for (let k = 0; k < 3; k++) cableAt(lx + 0.3 + rnd() * 0.3, 0.95, z + (rnd() - 0.5) * 0.8, 0.12 + rnd() * 0.08);
    // Towers and boxed PCs under the bench.
    kitAt(lx + 0.4, 0, z, 0.4, 0.38 + rnd() * 0.1, 0.18, Math.PI / 2);
    if (rnd() > 0.5) kitAt(lx + 0.45, 0, z + 0.3, 0.42, 0.36, 0.18, Math.PI / 2);
  }
  for (const sy of [1.565, 2.015])
    for (let z = -3.6; z <= 3.8; z += 0.28 + rnd() * 0.25) {
      if (rnd() < 0.55) kitAt(lx + 0.18, sy, z, 0.25 + rnd() * 0.08, 0.08 + rnd() * 0.2, 0.15 + rnd() * 0.15);
      else cableAt(lx + 0.18, sy + 0.05, z, 0.15);
    }

  // ---- Right wall: red-framed window with blinds, cupboards, more benches.
  const rx = W / 2;
  const blinds = canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#9a9a96';
    ctx.fillRect(0, 0, 64, 128);
    for (let i = 0; i < 128; i += 4) {
      ctx.fillStyle = '#c9c8c2';
      ctx.fillRect(0, i, 64, 3);
    }
  });
  const addWindow = (z: number) => {
    const blind = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.0), new THREE.MeshStandardMaterial({ map: blinds, roughness: 0.6 }));
    blind.position.set(rx - 0.03, 1.75, z);
    blind.rotation.y = -Math.PI / 2;
    g.add(blind);
    g.add(box(0.06, 0.08, 1.46, red, rx - 0.03, 2.29, z), box(0.08, 0.08, 1.46, red, rx - 0.04, 1.21, z));
    g.add(box(0.06, 1.1, 0.08, red, rx - 0.03, 1.75, z - 0.69), box(0.06, 1.1, 0.08, red, rx - 0.03, 1.75, z + 0.69));
  };
  addWindow(-0.2);
  addWindow(-3.4);
  // Low cupboards with red handles, clear of the side camera.
  g.add(box(0.62, 0.86, D - 2.2, std(0xe8e6e0), rx - 0.32, 0.43, 0.2), box(0.68, 0.04, D - 2.2, white, rx - 0.34, 0.88, 0.2));
  for (let z = -3.3; z <= 3.8; z += 0.55) g.add(box(0.015, 0.14, 0.02, red, rx - 0.64, 0.65, z));
  // Bench junk: laptops stacked, more printers and cable. Monitors only away from the middle.
  for (let z = -3.4; z <= 3.8; z += 0.45) {
    if (Math.abs(z) < 1.6) {
      if (rnd() > 0.4) kitAt(rx - 0.35, 0.9, z, 0.35, 0.03 + rnd() * 0.06, 0.25, rnd() - 0.5);
      cableAt(rx - 0.3, 0.93, z, 0.1);
      continue;
    }
    if (rnd() > 0.55) g.add(monitor(rx - 0.32, z, -Math.PI / 2 + (rnd() - 0.5) * 0.4, 0.9 + rnd() * 0.3, rnd() > 0.3));
    else if (rnd() > 0.5) printers.push(at(rx - 0.4, 0.97, z, -Math.PI / 2 + rnd()));
    else kitAt(rx - 0.38, 0.9, z, 0.35, 0.1 + rnd() * 0.1, 0.3, rnd() - 0.5);
    cableAt(rx - 0.3, 0.95, z, 0.12 + rnd() * 0.06);
  }
  // Generic certificate posters and a wall fan between the windows.
  for (const [z, yy] of [
    [1.25, 1.85],
    [1.65, 1.85],
    [1.25, 1.42],
    [1.65, 1.42],
  ]) {
    const cert = board(['CERTIFIED', 'IT Pro', '  ✓ A+'], 0.34, 0.42, { bg: '#ffffff', fg: '#c81e1e', font: 'bold 64px sans-serif' });
    cert.position.set(rx - 0.02, yy, z);
    cert.rotation.y = -Math.PI / 2;
    g.add(cert);
  }
  const fan = new THREE.Group();
  fan.add(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 18), std(0xf2f2ee, { wireframe: true })));
  const blades = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const b = box(0.16, 0.01, 0.06, std(0xf2f2ee), 0.08, 0, 0);
    const pivot = new THREE.Group();
    pivot.rotation.y = (i * Math.PI * 2) / 3;
    pivot.add(b);
    blades.add(pivot);
  }
  fan.add(blades);
  fan.rotation.z = Math.PI / 2;
  fan.position.set(rx - 0.3, 2.15, -1.8);
  g.add(fan, box(0.15, 0.2, 0.1, white, rx - 0.08, 2.15, -1.8));

  // ---- Near wall (behind you): stickered workshop door, dartboard, coats.
  const nz = D / 2;
  g.add(box(1.1, 2.2, 0.08, red, 1.4, 1.1, nz - 0.04), box(0.92, 2.05, 0.06, std(0xd9d7d0), 1.4, 1.03, nz - 0.09));
  const stickers: THREE.Matrix4[] = [];
  for (let i = 0; i < 40; i++) stickers.push(at(1.0 + rnd() * 0.8, 0.3 + rnd() * 1.7, nz - 0.125, 0, 0.6 + rnd() * 0.8));
  const stickerMesh = instances(new THREE.PlaneGeometry(0.08, 0.08).rotateY(Math.PI), std(0xffffff, { roughness: 0.4 }), stickers);
  const stickerCols = [0xfacc15, 0xef4444, 0x22c55e, 0x3b82f6, 0xa855f7, 0xffffff, 0xf97316, 0x111827];
  stickers.forEach((_, i) => stickerMesh.setColorAt(i, new THREE.Color(pick(stickerCols))));
  g.add(stickerMesh);
  const doorSign = board(['Computer', 'workshop'], 0.42, 0.16, { bg: '#5b4a3a', fg: '#ffffff', font: 'bold 80px sans-serif' });
  doorSign.position.set(1.4, 1.5, nz - 0.13);
  doorSign.rotation.y = Math.PI;
  g.add(doorSign);
  // Electric dartboard (plastic segments, LCD and buttons) and a paper face cut-out,
  // on the far wall where they're in view.
  const dart = canvasTexture(256, 320, (ctx) => {
    ctx.fillStyle = '#16181c';
    ctx.beginPath();
    ctx.roundRect(0, 0, 256, 320, 40);
    ctx.fill();
    const cx = 128;
    const cy = 120;
    const ring = (r0: number, r1: number, even: string, odd: string) => {
      for (let i = 0; i < 20; i++) {
        const a0 = ((i - 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
        const a1 = ((i + 0.5) / 20) * Math.PI * 2 - Math.PI / 2;
        ctx.fillStyle = i % 2 ? odd : even;
        ctx.beginPath();
        ctx.arc(cx, cy, r1, a0, a1);
        ctx.arc(cx, cy, r0, a1, a0, true);
        ctx.fill();
      }
    };
    ring(10, 100, '#e9c873', '#1c1c1c');
    ring(88, 100, '#c81e1e', '#1f7a3a');
    ring(52, 62, '#c81e1e', '#1f7a3a');
    // Tiny holes in the plastic segments.
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    for (let r = 16; r < 100; r += 6) for (let k = 0; k < r * 0.9; k++) {
      const t = (k / (r * 0.9)) * Math.PI * 2;
      ctx.fillRect(cx + Math.cos(t) * r, cy + Math.sin(t) * r, 1.4, 1.4);
    }
    ctx.fillStyle = '#1f7a3a';
    ctx.beginPath();
    ctx.arc(cx, cy, 10, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#c81e1e';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#f2f2f2';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5].forEach((n, i) => {
      const t = (i / 20) * Math.PI * 2 - Math.PI / 2;
      ctx.fillText(String(n), cx + Math.cos(t) * 110, cy + Math.sin(t) * 110 + 4);
    });
    // Control panel: LCD score and buttons.
    ctx.fillStyle = '#2b2e35';
    ctx.beginPath();
    ctx.roundRect(28, 240, 200, 66, 14);
    ctx.fill();
    ctx.fillStyle = '#9fb59a';
    ctx.fillRect(84, 250, 88, 30);
    ctx.fillStyle = '#1d2a1b';
    ctx.font = 'bold 24px ui-monospace, monospace';
    ctx.fillText('501', 128, 274);
    for (const [x, c] of [
      [46, '#e53935'],
      [62, '#e53935'],
      [194, '#e53935'],
      [210, '#fb8c00'],
      [104, '#e53935'],
      [128, '#e53935'],
      [152, '#e53935'],
    ] as const) {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x, x > 90 && x < 170 ? 294 : 272, 5, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const dartboard = new THREE.Mesh(new THREE.PlaneGeometry(0.46, 0.575), new THREE.MeshStandardMaterial({ map: dart, roughness: 0.55, transparent: true, alphaTest: 0.5 }));
  dartboard.position.set(1.05, 1.62, fz + 0.06);
  g.add(dartboard, box(0.44, 0.55, 0.04, black, 1.05, 1.62, fz + 0.025));
  // Cork board behind it, like the photo.
  g.add(box(0.8, 0.95, 0.02, std(0xa48a6a), 1.05, 1.55, fz + 0.01));

  // Paper cut-out face, stuck up with tape: a cartoon of a grinning TV presenter
  // with a mop of curly grey hair and a denim collar.
  const face = canvasTexture(256, 320, (ctx) => {
    ctx.clearRect(0, 0, 256, 320);
    // Paper edge.
    ctx.fillStyle = '#fbfbf7';
    ctx.beginPath();
    ctx.ellipse(128, 160, 120, 152, 0, 0, Math.PI * 2);
    ctx.fill();
    // Denim shirt collar.
    ctx.fillStyle = '#3d5f8f';
    ctx.beginPath();
    ctx.moveTo(30, 320);
    ctx.lineTo(80, 260);
    ctx.lineTo(128, 300);
    ctx.lineTo(176, 260);
    ctx.lineTo(226, 320);
    ctx.fill();
    // Face.
    ctx.fillStyle = '#efc2a0';
    ctx.beginPath();
    ctx.ellipse(128, 168, 74, 96, 0, 0, Math.PI * 2);
    ctx.fill();
    // Curly grey hair.
    ctx.fillStyle = '#9a958d';
    for (let i = 0; i < 26; i++) {
      const t = Math.PI + (i / 25) * Math.PI;
      ctx.beginPath();
      ctx.arc(128 + Math.cos(t) * 78, 120 + Math.sin(t) * 64, 20, 0, Math.PI * 2);
      ctx.fill();
    }
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(70 + i * 23, 76, 18, 0, Math.PI * 2);
      ctx.fill();
    }
    // Eyebrows, eyes, nose and a big toothy grin.
    ctx.strokeStyle = '#5a5048';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(128 + s * 18, 132);
      ctx.lineTo(128 + s * 50, 124);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.ellipse(128 + s * 32, 150, 13, 8, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#3b4a5a';
      ctx.beginPath();
      ctx.arc(128 + s * 32, 151, 5, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#c99475';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(128, 160);
    ctx.lineTo(120, 196);
    ctx.lineTo(134, 198);
    ctx.stroke();
    ctx.fillStyle = '#7a2a2a';
    ctx.beginPath();
    ctx.moveTo(84, 214);
    ctx.quadraticCurveTo(128, 260, 172, 214);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(96, 214, 64, 12);
    // Strips of tape on the corners.
    ctx.fillStyle = 'rgba(240,240,220,0.85)';
    for (const [x, y, r] of [
      [40, 30, -0.6],
      [216, 30, 0.6],
    ] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(r);
      ctx.fillRect(-26, -8, 52, 16);
      ctx.restore();
    }
  });
  const clarkson = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.52), new THREE.MeshStandardMaterial({ map: face, roughness: 0.9, transparent: true, alphaTest: 0.5 }));
  clarkson.position.set(0.15, 1.98, fz + 0.03);
  clarkson.rotation.z = 0.08;
  g.add(clarkson);
  for (const x of [-2.6, -3.0]) g.add(box(0.4, 1.0, 0.18, std(x < -2.8 ? 0x2b2f36 : 0x1e3a8a), x, 1.3, nz - 0.12));

  // ---- Bunting and fairy lights across the low ceiling.
  const flags: THREE.Matrix4[] = [];
  const bulbs: THREE.Matrix4[] = [];
  const string = (a: THREE.Vector3, b: THREE.Vector3, n: number, out: THREE.Matrix4[], sag: number) => {
    for (let k = 1; k < n; k++) {
      const t = k / n;
      const p = a.clone().lerp(b, t);
      p.y -= Math.sin(t * Math.PI) * sag;
      out.push(at(p.x, p.y, p.z, Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2));
    }
  };
  string(new THREE.Vector3(-W / 2, H - 0.08, 2.0), new THREE.Vector3(W / 2, H - 0.08, 1.4), 12, flags, 0.18);
  string(new THREE.Vector3(-W / 2, H - 0.04, -4.2), new THREE.Vector3(W / 2, H - 0.04, -4.0), 12, flags, 0.12);
  // Country flags: the front string is small, the back one (in view behind the
  // opponent) is big.
  const flagMats = FLAGS.map((draw) => new THREE.MeshStandardMaterial({ map: canvasTexture(96, 64, draw), side: THREE.DoubleSide, roughness: 0.8 }));
  const small = new THREE.PlaneGeometry(0.18, 0.12).translate(0, -0.06, 0);
  const big = new THREE.PlaneGeometry(0.36, 0.24).translate(0, -0.12, 0);
  flags.forEach((m, i) => {
    const back = i >= flags.length / 2;
    const f = new THREE.Mesh(back ? big : small, flagMats[(i * 5) % flagMats.length]);
    f.applyMatrix4(m);
    f.rotation.x += (rnd() - 0.5) * 0.15;
    g.add(f);
  });
  string(new THREE.Vector3(-W / 2 + 0.05, H - 0.15, -D / 2), new THREE.Vector3(-W / 2 + 0.05, H - 0.15, D / 2), 30, bulbs, 0.25);
  string(new THREE.Vector3(W / 2 - 0.05, H - 0.15, -D / 2), new THREE.Vector3(W / 2 - 0.05, H - 0.15, D / 2), 30, bulbs, 0.25);
  const bulbMat = glow(0xfff1c2, 2.6);
  g.add(instances(new THREE.SphereGeometry(0.02, 6, 4), bulbMat, bulbs));

  // ---- Plants: spider plants spilling off the high shelves, a peace lily on the bench.
  const spider = (x: number, yy: number, z: number) => {
    const p = new THREE.Group();
    p.add(new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.07, 0.14, 10), std(0x2b2b2b)));
    const leaf = std(0x7fb455);
    for (let i = 0; i < 9; i++) {
      const l = new THREE.Mesh(new THREE.ConeGeometry(0.012, 0.5, 4), leaf);
      const a = (i / 9) * Math.PI * 2;
      l.position.set(Math.cos(a) * 0.12, -0.1, Math.sin(a) * 0.12);
      l.rotation.set(Math.sin(a) * 2.4, 0, -Math.cos(a) * 2.4);
      p.add(l);
    }
    p.position.set(x, yy, z);
    return p;
  };
  // Trailing vines (pothos style): strands draped along the top of the far wall and
  // spilling off the high shelves and cupboard tops, swaying very slightly.
  const leaves: THREE.Matrix4[] = [];
  const stems: THREE.Matrix4[] = [];
  const vine = (start: THREE.Vector3, along: THREE.Vector3, drop: number, n: number) => {
    let p = start.clone();
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const next = start.clone().addScaledVector(along, t + 1 / n);
      next.y -= Math.sin(t * Math.PI * 0.5) * drop + Math.sin(i * 1.7) * 0.03;
      const mid = p.clone().lerp(next, 0.5);
      const len = p.distanceTo(next);
      stems.push(new THREE.Matrix4().compose(mid, new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), next.clone().sub(p).normalize()), new THREE.Vector3(1, len, 1)));
      const side = i % 2 ? 1 : -1;
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rnd() * 1.2 - 0.6, rnd() * Math.PI * 2, side * (0.6 + rnd() * 0.5)));
      const s = 0.7 + rnd() * 0.6;
      leaves.push(new THREE.Matrix4().compose(mid.clone().add(new THREE.Vector3(side * 0.03, -0.02, 0.02)), q, new THREE.Vector3(s, s, s)));
      p = next;
    }
  };
  // Along the top of the far wall, from corner pot to corner pot.
  for (const x0 of [-W / 2 + 0.2, W / 2 - 0.2]) {
    const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.08, 0.15, 10), std(0x2f7d4f));
    pot.position.set(x0, H - 0.35, fz + 0.15);
    g.add(pot, box(0.3, 0.02, 0.22, white, x0, H - 0.43, fz + 0.12));
    vine(new THREE.Vector3(x0, H - 0.3, fz + 0.1), new THREE.Vector3(-Math.sign(x0) * 2.6, 0, 0), 0.35, 26);
    vine(new THREE.Vector3(x0, H - 0.3, fz + 0.12), new THREE.Vector3(0, -1.3, 0.05), 0, 14);
    vine(new THREE.Vector3(x0, H - 0.3, fz + 0.16), new THREE.Vector3(-Math.sign(x0) * 0.5, -1.0, 0.1), 0, 12);
  }
  // Spilling off the left-hand shelves and down the side windows.
  for (const z of [-3.2, -1.0, 0.8, 2.6]) vine(new THREE.Vector3(lx + 0.3, 2.04, z), new THREE.Vector3(0.05, -0.7 - rnd() * 0.5, (rnd() - 0.5) * 0.3), 0, 10);
  for (const z of [-4.1, -2.4, 2.4]) vine(new THREE.Vector3(rx - 0.05, 2.3, z), new THREE.Vector3(-0.05, -0.9 - rnd() * 0.4, 0.25), 0, 11);
  const leafGeo = new THREE.SphereGeometry(0.045, 8, 6).scale(1, 0.18, 1.3);
  const vineLeaves = instances(leafGeo, std(0x3f8a3a, { roughness: 0.55 }), leaves);
  const leafCols = [0x3f8a3a, 0x58a043, 0x2f6e30, 0x7bb85a];
  leaves.forEach((_, i) => vineLeaves.setColorAt(i, new THREE.Color(leafCols[i % leafCols.length])));
  const vines = new THREE.Group();
  vines.add(vineLeaves, instances(new THREE.CylinderGeometry(0.004, 0.004, 1, 4), std(0x4b6b2a), stems));
  g.add(vines);
  g.add(spider(lx + 0.2, 2.1, -2.2), spider(lx + 0.2, 2.1, 1.4), spider(lx + 0.2, 1.65, 3.8));
  g.add(plant(lx + 0.45, 4.5, 0.9));
  const lily = plant(0, 0, 0.75);
  lily.position.set(rx - 0.35, 0.9, 3.4);
  g.add(lily);

  // ---- Strewn office chairs at the edges.
  const chair = (x: number, z: number, ry: number, seat = 0x1d3a8a) => {
    const c = new THREE.Group();
    c.add(box(0.48, 0.08, 0.46, std(seat), 0, 0.48, 0), box(0.44, 0.5, 0.06, std(seat), 0, 0.8, -0.22));
    c.add(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.4, 8), black).translateY(0.24));
    for (let i = 0; i < 5; i++) {
      const leg = box(0.3, 0.03, 0.04, black, 0.15, 0.05, 0);
      const pivot = new THREE.Group();
      pivot.rotation.y = (i * Math.PI * 2) / 5;
      pivot.add(leg);
      c.add(pivot);
    }
    c.position.set(x, 0, z);
    c.rotation.y = ry;
    return c;
  };
  g.add(chair(-2.75, -2.6, 1.2), chair(-2.8, 3.9, 2.0, 0x16181c), chair(2.8, 3.2, -1.6), chair(2.75, -4.3, -0.6, 0x16181c));
  // Bubble-wrap roll and blue crates on top of the cupboards, far end.
  const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.9, 16), new THREE.MeshStandardMaterial({ color: 0xe6f0f4, transparent: true, opacity: 0.75, roughness: 0.2 }));
  wrap.rotation.z = Math.PI / 2;
  wrap.position.set(rx - 0.4, 0.28, -4.35);
  g.add(wrap, box(0.5, 0.3, 0.4, std(0x1e40af), -1.0, 0.15, fz + 0.3), box(0.5, 0.3, 0.4, std(0x2563eb), -1.0, 0.45, fz + 0.32));

  g.add(instances(new THREE.BoxGeometry(1, 1, 1), cardboard, boxes));
  g.add(instances(new THREE.BoxGeometry(1, 1, 1), black, kit));
  g.add(instances(new THREE.TorusKnotGeometry(0.5, 0.06, 48, 5, 3, 5), black, cables));
  g.add(instances(new THREE.BoxGeometry(0.2, 0.15, 0.24), std(0xf1efe8), printers));

  // ---- Floor: worn grey carpet with the hazard-taped patches.
  const carpet = canvasTexture(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#5d5f63';
      ctx.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 1400; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? '#54565a' : '#68696d';
        ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 1);
      }
      for (let i = 0; i < 40; i++) {
        ctx.fillStyle = 'rgba(30,30,30,0.15)';
        ctx.beginPath();
        ctx.arc(Math.random() * 128, Math.random() * 128, 2 + Math.random() * 5, 0, Math.PI * 2);
        ctx.fill();
      }
    },
    [16, 16],
  );
  const hazard = canvasTexture(256, 128, (ctx) => {
    ctx.fillStyle = '#facc15';
    ctx.fillRect(0, 0, 256, 128);
    ctx.fillStyle = '#111111';
    for (let i = -128; i < 256; i += 32) {
      ctx.beginPath();
      ctx.moveTo(i, 0);
      ctx.lineTo(i + 16, 0);
      ctx.lineTo(i + 144, 128);
      ctx.lineTo(i + 128, 128);
      ctx.fill();
    }
    ctx.fillStyle = '#8b7a62';
    ctx.fillRect(28, 22, 200, 84);
  });
  const patch = (x: number, z: number, ry: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), new THREE.MeshStandardMaterial({ map: hazard, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2 }));
    m.rotation.set(-Math.PI / 2, 0, ry);
    m.position.set(x, 0.003, z);
    return m;
  };
  g.add(patch(2.2, -3.4, 0.5), patch(-2.4, 2.4, -0.3));

  let spin = 0;
  return makeVenue('mem', g, {
    background: 0x2a2620,
    fog: [0x3a342a, 9, 20],
    hemi: [0xfff4dc, 0x5a5040, 1.0],
    key: [0xfffaf0, 2.0],
    env: 0.3,
    floor: carpet,
    update: (dt) => {
      spin += dt * 9;
      blades.rotation.y = spin;
      vines.rotation.z = Math.sin(spin * 0.07) * 0.002;
      bulbMat.color.setHSL(0.12, 1, 0.82 + Math.sin(spin * 0.25) * 0.04);
    },
    setScore: (lines) => {
      screenLines = lines;
      drawScreen();
    },
  });
}

function testBay(): Venue {
  // The IT build/test bay: white walls, suspended ceiling with panel lights, blue
  // vertical blinds, maple worktops full of monitors and laptops being imaged, and
  // stacks of Dell boxes on grey steel shelving.
  const g = new THREE.Group();
  const W = 14;
  const D = 22;
  const H = 3.0;
  const ceilTex = canvasTexture(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#f4f4f1';
      ctx.fillRect(0, 0, 128, 128);
      ctx.fillStyle = 'rgba(0,0,0,0.035)';
      for (let i = 0; i < 260; i++) ctx.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
      ctx.strokeStyle = '#d9d9d4';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, 128, 128);
    },
    [W / 0.6, D / 0.6],
  );
  room(g, W, D, H, std(0xeef0ee), { ceiling: new THREE.MeshStandardMaterial({ map: ceilTex, roughness: 0.9 }) });

  // Recessed LED panels in the ceiling grid.
  const panel = glow(0xffffff, 1.9);
  const panels: THREE.Matrix4[] = [];
  for (const x of [-3.6, 0, 3.6]) for (let z = -8.4; z <= 8.4; z += 3.6) panels.push(at(x, H - 0.01, z));
  g.add(instances(new THREE.BoxGeometry(1.15, 0.02, 0.58), panel, panels));

  // Window wall on the right with blue vertical blinds (slightly open, light leaking through).
  const blind = std(0x1f5fbf, { roughness: 0.7 });
  const slats: THREE.Matrix4[] = [];
  for (let z = -10.4; z <= 10.4; z += 0.11) {
    slats.push(at(W / 2 - 0.12, 1.85, z, 0.5));
  }
  g.add(instances(new THREE.BoxGeometry(0.01, 1.7, 0.09), blind, slats));
  g.add(box(0.02, 1.7, D - 1, glow(0xdbe9f7, 1.3), W / 2 - 0.02, 1.85, 0));
  for (let z = -9; z <= 9; z += 4.5) g.add(box(0.3, H, 0.5, std(0xf1f1ee), W / 2 - 0.15, H / 2, z));
  g.add(box(0.06, 0.06, D, std(0xe5e7eb), W / 2 - 0.12, 2.72, 0));

  // Maple worktops with cabinets along the left wall and under the window.
  const maple = std(0xd9b27c, { roughness: 0.55 });
  const cab = std(0xc99a5e, { roughness: 0.65 });
  const bench = (x: number, z: number, len: number) => {
    g.add(box(0.8, 0.04, len, maple, x, 0.76, z), box(0.7, 0.72, len, cab, x, 0.37, z));
  };
  bench(W / 2 - 0.55, 0, 17);

  // Monitors (black, on stands), keyboards and open laptops on the benches.
  const black = std(0x15171b, { roughness: 0.4 });
  const screenOff = std(0x0b0d10, { roughness: 0.2, metalness: 0.2 });
  const monitors: THREE.Matrix4[] = [];
  const stands: THREE.Matrix4[] = [];
  const keys: THREE.Matrix4[] = [];
  const laptops: THREE.Matrix4[] = [];
  const lids: THREE.Matrix4[] = [];
  const lit: THREE.Matrix4[] = [];
  let n = 0;
  for (let z = -7.8; z <= 7.8; z += 1.3) {
    for (const side of [1]) {
      const x = side * (W / 2 - 0.3);
      const ry = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      n++;
      if (n % 4 === 0) {
        // Laptop being imaged, lid open, screen lit.
        laptops.push(at(x - side * 0.15, 0.79, z, ry));
        const lid = new THREE.Matrix4().compose(
          new THREE.Vector3(x + side * 0.02, 0.92, z),
          new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)),
          new THREE.Vector3(1, 1, 1),
        );
        lids.push(lid);
        lit.push(at(x + side * 0.02, 0.92, z, ry));
      } else {
        monitors.push(at(x, 1.12, z, ry));
        stands.push(at(x, 0.9, z, ry));
        keys.push(at(x - side * 0.3, 0.79, z, ry));
        if (n % 5 === 0) lit.push(at(x - side * 0.03, 1.12, z, ry));
      }
    }
  }
  g.add(instances(new THREE.BoxGeometry(0.62, 0.38, 0.04), screenOff, monitors));
  g.add(instances(new THREE.BoxGeometry(0.06, 0.28, 0.06), black, stands));
  g.add(instances(new THREE.BoxGeometry(0.42, 0.02, 0.14), black, keys));
  g.add(instances(new THREE.BoxGeometry(0.34, 0.02, 0.24), std(0x2a2d33, { metalness: 0.4 }), laptops));
  g.add(instances(new THREE.BoxGeometry(0.34, 0.24, 0.015), std(0x2a2d33, { metalness: 0.4 }), lids));
  const winScreen = canvasTexture(128, 80, (ctx) => {
    ctx.fillStyle = '#1e4fa8';
    ctx.fillRect(0, 0, 128, 80);
    ctx.fillStyle = '#9cc4ff';
    ctx.fillRect(14, 30, 100, 6);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(14, 30, 62, 6);
    ctx.font = '10px sans-serif';
    ctx.fillText('Installing updates…', 14, 22);
  });
  g.add(instances(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ map: winScreen }), lit.map((m) => m.clone().multiply(new THREE.Matrix4().makeTranslation(0, 0, 0.025)))));

  // Cardboard: a big pile of boxes in the back-left corner and Dell boxes on steel shelving at the back.
  const card = std(0xc29a6b, { roughness: 0.9 });
  const cardDark = std(0xb08757, { roughness: 0.9 });
  const tape = std(0xa98a62, { roughness: 0.6 });
  const dell = canvasTexture(128, 96, (ctx) => {
    ctx.fillStyle = '#c29a6b';
    ctx.fillRect(0, 0, 128, 96);
    ctx.strokeStyle = '#3d3a36';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(64, 48, 20, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = '#3d3a36';
    ctx.font = 'bold 13px sans-serif';
    ctx.fillText('DELL', 48, 53);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(92, 60, 26, 22);
  });
  const dellMat = new THREE.MeshStandardMaterial({ map: dell, roughness: 0.9 });

  const pile = (cx: number, cz: number, cols: number, rows: number, seed: number) => {
    let s = seed;
    const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
    for (let i = 0; i < cols; i++)
      for (let j = 0; j < rows; j++) {
        let y = 0;
        const layers = 2 + Math.floor(rnd() * 3);
        for (let k = 0; k < layers; k++) {
          const w = 0.45 + rnd() * 0.25;
          const h = 0.35 + rnd() * 0.25;
          const d = 0.4 + rnd() * 0.25;
          const b = box(w, h, d, k === 1 ? dellMat : rnd() < 0.3 ? cardDark : card, cx + i * 0.62 + (rnd() - 0.5) * 0.08, y + h / 2, cz + j * 0.6 + (rnd() - 0.5) * 0.08);
          b.rotation.y = (rnd() - 0.5) * 0.15;
          g.add(b, box(0.06, 0.005, d + 0.01, tape, b.position.x, y + h + 0.003, b.position.z));
          y += h;
        }
      }
  };
  pile(3.2, 8.4, 2, 2, 31);

  // Grey steel shelving, rammed with kit: a long run down the left wall, a run across
  // the back, and two free-standing back-to-back aisles at the far end.
  const steel = std(0x3a4150, { roughness: 0.5, metalness: 0.5 });
  const shelfBoard = std(0xc4ab84, { roughness: 0.95 });
  const lip = std(0xd1d5db, { roughness: 0.6 });
  const laptopTex = canvasTexture(64, 128, (ctx) => {
    ctx.fillStyle = '#c49c6c';
    ctx.fillRect(0, 0, 64, 128);
    ctx.fillStyle = '#f8f8f6';
    ctx.fillRect(8, 74, 48, 36);
    ctx.fillStyle = '#222';
    for (let i = 0; i < 14; i++) ctx.fillRect(12 + i * 3, 96, i % 3 ? 1 : 2, 10);
    ctx.font = '8px sans-serif';
    ctx.fillText('LATITUDE', 12, 88);
    ctx.strokeStyle = '#2b2b2b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(10, 30);
    ctx.bezierCurveTo(20, 18, 30, 40, 52, 26);
    ctx.moveTo(12, 46);
    ctx.bezierCurveTo(26, 36, 34, 54, 48, 44);
    ctx.stroke();
  });
  const laptopMat = new THREE.MeshStandardMaterial({ map: laptopTex, roughness: 0.9 });
  const lists = { card: [] as THREE.Matrix4[], dell: [] as THREE.Matrix4[], laptop: [] as THREE.Matrix4[], bag: [] as THREE.Matrix4[], post: [] as THREE.Matrix4[], board: [] as THREE.Matrix4[], lip: [] as THREE.Matrix4[] };
  const unit = new THREE.BoxGeometry(1, 1, 1);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 9301 + 49297) % 233280) / 233280);
  const sized = (base: THREE.Matrix4, x: number, y: number, z: number, w: number, h: number, d: number, ry = 0) =>
    base.clone().multiply(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), ry), new THREE.Vector3(w, h, d)));
  /** A shelving run, length along its local x, front facing local +z. */
  const shelfRun = (cx: number, cz: number, len: number, ry: number, top = true) => {
    const base = at(cx, 0, cz, ry);
    const depth = 0.6;
    const bays = Math.max(1, Math.round(len / 1.8));
    for (let b = 0; b <= bays; b++) for (const dz of [-depth / 2, depth / 2]) lists.post.push(sized(base, -len / 2 + (b * len) / bays, 1.15, dz, 0.05, 2.3, 0.04));
    const levels = [0.12, 0.62, 1.12, 1.62, 2.28];
    levels.forEach((y, lv) => {
      lists.board.push(sized(base, 0, y, 0, len, 0.03, depth));
      lists.lip.push(sized(base, 0, y + 0.02, depth / 2, len, 0.06, 0.03));
      const room = lv === levels.length - 1 ? (top ? 3.0 - y - 0.05 : 0) : levels[lv + 1] - y - 0.06;
      if (room <= 0.1) return;
      let x = -len / 2 + 0.04;
      while (x < len / 2 - 0.15) {
        const r = rnd();
        if (lv < levels.length - 1 && r < 0.35) {
          // A run of tall thin laptop boxes stood on end.
          const count = 4 + Math.floor(rnd() * 6);
          const h = Math.min(room - 0.02, 0.36 + rnd() * 0.06);
          for (let k = 0; k < count && x < len / 2 - 0.1; k++) {
            const w = 0.08 + rnd() * 0.03;
            lists.laptop.push(sized(base, x + w / 2, y + 0.015 + h / 2, 0.02, w, h, 0.48));
            x += w + 0.005;
          }
        } else if (r < 0.43 && lv < levels.length - 1) {
          const w = 0.35 + rnd() * 0.2;
          const h = Math.min(room - 0.04, 0.2 + rnd() * 0.15);
          lists.bag.push(sized(base, x + w / 2, y + 0.015 + h / 2, 0.05, w, h, 0.4, (rnd() - 0.5) * 0.3));
          x += w + 0.02;
        } else {
          const w = 0.32 + rnd() * 0.3;
          let yy = y + 0.015;
          // Stack until the shelf above (or near the ceiling on top).
          while (yy < y + room - 0.18) {
            const h = Math.min(y + room - yy - 0.01, 0.18 + rnd() * 0.25);
            if (h < 0.12) break;
            const d = 0.4 + rnd() * 0.18;
            (rnd() < 0.4 ? lists.dell : lists.card).push(sized(base, x + w / 2 + (rnd() - 0.5) * 0.03, yy + h / 2, 0.3 - d / 2 + 0.02, w, h, d, (rnd() - 0.5) * 0.06));
            yy += h;
            if (lv < levels.length - 1 && rnd() < 0.5) break;
          }
          x += w + 0.02;
        }
      }
    });
  };
  shelfRun(-W / 2 + 0.36, 0, 17.2, Math.PI / 2);
  shelfRun(-1.6, -D / 2 + 0.36, 8.6, 0);
  for (const ax of [-3.6, 2.4]) {
    shelfRun(ax - 0.31, -8.1, 3, -Math.PI / 2, false);
    shelfRun(ax + 0.31, -8.1, 3, Math.PI / 2, false);
  }
  const cardInst = instances(unit, card, lists.card);
  const tint = new THREE.Color();
  lists.card.forEach((_, i) => cardInst.setColorAt(i, tint.setHSL(0.08 + Math.random() * 0.02, 0.35 + Math.random() * 0.15, 0.82 + Math.random() * 0.14)));
  g.add(
    cardInst,
    instances(unit, dellMat, lists.dell),
    instances(unit, laptopMat, lists.laptop),
    instances(unit, std(0xb9c7d8, { roughness: 0.35 }), lists.bag),
    instances(unit, steel, lists.post),
    instances(unit, shelfBoard, lists.board),
    instances(unit, lip, lists.lip),
  );
  const note = board(['KIT TO BUILD', 'Row 1', 'REVENUE', 'Row 3'], 0.42, 0.42, { bg: '#fdf6c7', fg: '#1f2937', font: 'bold 52px "Comic Sans MS", cursive' });
  note.position.set(-3.6, 2.0, -6.57);
  g.add(note);

  // Fire exit double doors on the front-left wall, sign above; dartboard on a whiteboard.
  const door = std(0xf4f4f2, { roughness: 0.6 });
  g.add(box(1.6, 2.1, 0.05, door, -3.5, 1.05, D / 2 - 0.03), box(0.02, 2.1, 0.06, std(0xc8c8c4), -3.5, 1.05, D / 2 - 0.04));
  const exit = board(['  🏃 Fire exit'], 0.7, 0.18, { bg: '#16a34a', fg: '#ffffff', font: 'bold 44px sans-serif' });
  exit.position.set(-3.5, 2.35, D / 2 - 0.02);
  exit.rotation.y = Math.PI;
  g.add(exit);
  const darts = new THREE.Group();
  const rings = [0x111111, 0xdc2626, 0xf5deb3, 0x15803d, 0xdc2626];
  rings.forEach((c, i) => {
    const r = new THREE.Mesh(new THREE.CircleGeometry(0.22 - i * 0.04, 24), std(c));
    r.position.z = i * 0.002;
    darts.add(r);
  });
  darts.position.set(1.5, 1.7, D / 2 - 0.03);
  darts.rotation.y = Math.PI;
  g.add(darts);

  // Pedestal fan, sack truck by the window, blue crates.
  const white = std(0xeeeae0);
  const fan = new THREE.Group();
  fan.add(box(0.03, 1.1, 0.03, white, 0, 0.6, 0), box(0.6, 0.02, 0.04, white, 0, 0.02, 0), box(0.04, 0.02, 0.6, white, 0, 0.02, 0));
  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.1, 24), white);
  head.rotation.x = Math.PI / 2;
  head.position.y = 1.2;
  fan.add(head);
  fan.position.set(-5.4, 0, 9.6);
  fan.rotation.y = -0.6;
  g.add(fan);
  const metal = std(0x9ca3af, { metalness: 0.6, roughness: 0.4 });
  const sack = new THREE.Group();
  sack.add(box(0.03, 1.2, 0.03, metal, -0.2, 0.62, 0), box(0.03, 1.2, 0.03, metal, 0.2, 0.62, 0), box(0.43, 0.03, 0.03, metal, 0, 1.2, 0), box(0.43, 0.03, 0.25, metal, 0, 0.04, 0.12));
  for (const sx of [-0.24, 0.24]) {
    const w = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.06, 16), std(0x111111));
    w.rotation.z = Math.PI / 2;
    w.position.set(sx, 0.11, -0.05);
    sack.add(w);
  }
  sack.position.set(6.3, 0, -10.2);
  sack.rotation.x = -0.15;
  g.add(sack);
  const crate = std(0x1d4ed8, { roughness: 0.5 });
  g.add(box(0.55, 0.35, 0.4, crate, 5.3, 0.18, -10.5), box(0.55, 0.35, 0.4, crate, 5.3, 0.53, -10.5));

  // Wire roll cage, half full of flattened cardboard.
  const cage: THREE.Matrix4[] = [];
  const cw = 0.8;
  const cd = 0.7;
  const ch = 1.6;
  for (let i = 0; i <= 8; i++) {
    const t = -cw / 2 + (i * cw) / 8;
    cage.push(sized(at(0, 0, 0), t, ch / 2 + 0.12, -cd / 2, 0.012, ch, 0.012), sized(at(0, 0, 0), t, ch / 2 + 0.12, cd / 2, 0.012, ch, 0.012));
  }
  for (let i = 0; i <= 7; i++) {
    const t = -cd / 2 + (i * cd) / 7;
    cage.push(sized(at(0, 0, 0), -cw / 2, ch / 2 + 0.12, t, 0.012, ch, 0.012), sized(at(0, 0, 0), cw / 2, ch / 2 + 0.12, t, 0.012, ch, 0.012));
  }
  for (let j = 0; j <= 8; j++) {
    const y = 0.12 + (j * ch) / 8;
    cage.push(sized(at(0, 0, 0), 0, y, -cd / 2, cw, 0.012, 0.012), sized(at(0, 0, 0), 0, y, cd / 2, cw, 0.012, 0.012), sized(at(0, 0, 0), -cw / 2, y, 0, 0.012, 0.012, cd), sized(at(0, 0, 0), cw / 2, y, 0, 0.012, 0.012, cd));
  }
  const rollCage = new THREE.Group();
  rollCage.add(instances(unit, metal, cage), box(cw, 0.04, cd, metal, 0, 0.1, 0));
  for (let k = 0; k < 6; k++) {
    const flat = box(0.7, 0.9 + (k % 3) * 0.15, 0.02, k % 2 ? card : cardDark, (k % 2 - 0.5) * 0.06, 0.6 + (k % 3) * 0.07, -0.25 + k * 0.09);
    flat.rotation.z = (k % 2 ? 1 : -1) * 0.05;
    rollCage.add(flat);
  }
  rollCage.position.set(4.0, 0, -9.9);
  rollCage.rotation.y = 0.2;
  g.add(rollCage);

  // Pink "MINI DAVE" platform trolley and two folding trolleys leant on the aisle ends.
  const dave = canvasTexture(128, 192, (ctx) => {
    ctx.fillStyle = '#e48a90';
    ctx.fillRect(0, 0, 128, 192);
    ctx.fillStyle = 'rgba(255,255,255,0.2)';
    for (let i = 0; i < 40; i++) ctx.fillRect(Math.random() * 128, Math.random() * 192, 6, 3);
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(16, 120, 96, 50);
    ctx.fillStyle = '#111';
    ctx.font = 'bold 14px "Comic Sans MS", cursive';
    ctx.fillText('MINI', 46, 138);
    ctx.font = 'bold 26px "Comic Sans MS", cursive';
    ctx.fillText('DAVE', 30, 164);
  });
  const trolley = (x: number, z: number, mat: THREE.Material, tilt: number, ry = 0) => {
    const t = new THREE.Group();
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.8, 0.03), mat);
    deck.position.y = 0.42;
    t.add(deck, box(0.03, 0.75, 0.03, std(0xd8cdb0, { metalness: 0.4 }), -0.28, 0.85, -0.04), box(0.03, 0.75, 0.03, std(0xd8cdb0, { metalness: 0.4 }), 0.28, 0.85, -0.04), box(0.59, 0.03, 0.03, std(0xd8cdb0, { metalness: 0.4 }), 0, 1.21, -0.04));
    t.position.set(x, 0, z);
    t.rotation.set(tilt, ry, 0);
    g.add(t);
  };
  trolley(-3.6, -6.35, new THREE.MeshStandardMaterial({ map: dave, roughness: 0.7 }), -0.25);
  trolley(2.25, -6.3, std(0x3b3f46, { metalness: 0.3 }), -0.28, 0.1);
  trolley(2.65, -6.25, std(0x2f3339, { metalness: 0.3 }), -0.22, -0.08);

  // Open box with plastic wrap ("618"), bubble-wrapped kit and blue bags on the floor.
  const open = new THREE.Group();
  open.add(box(0.8, 0.35, 0.55, card, 0, 0.175, 0));
  const film = new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.35, roughness: 0.15 });
  const wrap = new THREE.Mesh(new THREE.SphereGeometry(0.4, 12, 8), film);
  wrap.scale.set(1.05, 0.35, 0.75);
  wrap.position.y = 0.38;
  const label = board(['618'], 0.3, 0.15, { bg: '#c29a6b', fg: '#1f2937', font: 'bold 120px "Comic Sans MS", cursive' });
  label.position.set(0, 0.2, 0.28);
  open.add(wrap, label);
  open.position.set(0.2, 0, -9.85);
  g.add(open);
  const bubble = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.4), new THREE.MeshStandardMaterial({ color: 0xdfe6ea, transparent: true, opacity: 0.7, roughness: 0.3 }));
  bubble.position.set(-5.9, 2.55, -4.2);
  g.add(bubble, box(0.5, 0.3, 0.35, std(0x2563eb, { roughness: 0.6 }), -1.2, 0.15, -9.9));

  // Speckled blue-grey vinyl floor.
  const vinyl = canvasTexture(
    256,
    256,
    (ctx) => {
      ctx.fillStyle = '#6f8aa6';
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 1600; i++) {
        ctx.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,0.1)' : 'rgba(30,45,65,0.14)';
        ctx.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
      }
    },
    [12, 12],
  );

  return makeVenue('server', g, {
    background: 0xeef0ee,
    fog: [0xeef0ee, 14, 30],
    hemi: [0xf4f8ff, 0x7d8fa3, 1.0],
    key: [0xffffff, 2.2],
    env: 0.4,
    floor: vinyl,
  });
}

function conference(): Venue {
  const g = new THREE.Group();
  const W = 11;
  const D = 16;
  const H = 3;
  room(g, W, D, H, std(0xd8cfc0), { ceiling: std(0xefece6), skipWalls: ['right'] });

  // Glass wall on the right with frosted band.
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(D, H), new THREE.MeshStandardMaterial({ color: 0xbfd8e6, transparent: true, opacity: 0.25, roughness: 0.1 }));
  glass.position.set(W / 2, H / 2, 0);
  glass.rotation.y = -Math.PI / 2;
  g.add(glass);
  g.add(box(0.02, 0.4, D, std(0xffffff, { transparent: true, opacity: 0.6 }), W / 2 - 0.01, 1.3, 0));

  // Big screen on the far wall: shows the score.
  let screenLines = ['MEM TABLE TENNIS', 'Q4 ALL-HANDS'];
  // Drawn at 2× (1024 × 576) so the text stays crisp; redrawn only when the score changes.
  const scr = document.createElement('canvas');
  scr.width = 1024;
  scr.height = 576;
  const scrTex = new THREE.CanvasTexture(scr);
  scrTex.colorSpace = THREE.SRGBColorSpace;
  scrTex.anisotropy = 8;
  const drawScreen = () => {
    const ctx = scr.getContext('2d')!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.fillStyle = '#0b1220';
    ctx.fillRect(0, 0, 512, 288);
    ctx.fillStyle = '#e8562a';
    ctx.fillRect(0, 0, 512, 10);
    ctx.fillStyle = '#e5e7eb';
    ctx.font = 'bold 44px ui-monospace, monospace';
    screenLines.slice(0, 4).forEach((l, i) => ctx.fillText(l, 28, 80 + i * 60));
    scrTex.needsUpdate = true;
  };
  drawScreen();
  const tv = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.8), new THREE.MeshBasicMaterial({ map: scrTex }));
  // 1 cm in front of the bezel's face (which is at +0.03): coplanar, the two fought over
  // every pixel and the picture flickered in and out.
  tv.position.set(0, 1.75, -D / 2 + 0.04);
  g.add(tv, box(3.3, 1.9, 0.05, std(0x111111), 0, 1.75, -D / 2 + 0.005));

  // Conference table pushed to the side, with chairs; pendant lights.
  g.add(box(1.2, 0.05, 4.5, std(0x6b4f35, { roughness: 0.5 }), -4.2, 0.74, -1));
  const chairs: THREE.Matrix4[] = [];
  for (let z = -3; z <= 1; z += 1) chairs.push(at(-4.95, 0.45, z), at(-3.45, 0.45, z));
  g.add(instances(new THREE.BoxGeometry(0.45, 0.08, 0.45), std(0x374151), chairs));
  const pend = glow(0xfff1d6);
  for (const z of [-4, 0, 4]) g.add(box(0.5, 0.06, 0.5, pend, 0, H - 0.5, z), box(0.01, 0.5, 0.01, std(0x111111), 0, H - 0.25, z));
  const okr = board(['Q4 OKRs', '1. Ship it', '2. Win the', '   ping pong cup'], 1.6, 1.0);
  okr.position.set(-W / 2 + 0.02, 1.6, 3.5);
  okr.rotation.y = Math.PI / 2;
  g.add(okr, plant(-4.8, -7, 1.2), plant(4.6, -7, 1.2));

  const wood = canvasTexture(
    256,
    256,
    (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#a07650' : '#93694a';
        ctx.fillRect(0, i * 32, 256, 32);
        ctx.fillStyle = 'rgba(60,35,20,0.25)';
        ctx.fillRect(0, i * 32 + 30, 256, 2);
        ctx.fillRect(((i * 97) % 200) + 20, i * 32, 2, 32);
      }
    },
    [10, 14],
  );
  return makeVenue('conference', g, {
    background: 0xd9d3c8,
    fog: [0xd9d3c8, 12, 26],
    hemi: [0xfff6e8, 0x6b5a48, 0.95],
    key: [0xfff3df, 2.0],
    env: 0.3,
    floor: wood,
    setScore: (lines) => {
      screenLines = lines;
      drawScreen();
    },
  });
}

function rooftop(): Venue {
  const g = new THREE.Group();

  // Sunset sky dome.
  const skyTex = canvasTexture(16, 256, (ctx) => {
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    grd.addColorStop(0, '#1e2a5a');
    grd.addColorStop(0.45, '#7c4a8c');
    grd.addColorStop(0.62, '#f2855b');
    grd.addColorStop(0.75, '#ffd59a');
    grd.addColorStop(1, '#2b2d42');
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 16, 256);
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(60, 32, 16), new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide, fog: false }));
  g.add(dome);

  // Skyline: instanced buildings with lit windows.
  const win = canvasTexture(
    64,
    128,
    (ctx) => {
      ctx.fillStyle = '#1b1f2e';
      ctx.fillRect(0, 0, 64, 128);
      for (let y = 4; y < 128; y += 10)
        for (let x = 4; x < 64; x += 10) {
          ctx.fillStyle = Math.random() < 0.45 ? '#ffd58a' : '#2a3044';
          ctx.fillRect(x, y, 5, 6);
        }
    },
    [1, 1],
  );
  const bmat = new THREE.MeshStandardMaterial({ map: win, emissive: 0xffffff, emissiveMap: win, emissiveIntensity: 0.5, roughness: 0.9 });
  const blds: THREE.Matrix4[] = [];
  for (let i = 0; i < 46; i++) {
    const a = (i / 46) * Math.PI * 2;
    const r = 26 + (i % 5) * 4;
    const h = 6 + ((i * 53) % 17);
    blds.push(new THREE.Matrix4().compose(new THREE.Vector3(Math.cos(a) * r, h / 2 - 8, Math.sin(a) * r), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -a), new THREE.Vector3(3 + (i % 3), h, 3)));
  }
  g.add(instances(new THREE.BoxGeometry(1, 1, 1), bmat, blds));

  // Railing around the deck.
  const rail = std(0x9ca3af, { metalness: 0.6, roughness: 0.4 });
  const S = 9;
  for (const [w, d, x, z] of [
    [2 * S, 0.05, 0, -S],
    [2 * S, 0.05, 0, S],
    [0.05, 2 * S, -S, 0],
    [0.05, 2 * S, S, 0],
  ] as const)
    g.add(box(w, 0.05, d, rail, x, 1.05, z), box(w, 0.03, d, rail, x, 0.55, z));
  const posts: THREE.Matrix4[] = [];
  for (let t = -S; t <= S; t += 1.5) posts.push(at(t, 0.52, -S), at(t, 0.52, S), at(-S, 0.52, t), at(S, 0.52, t));
  g.add(instances(new THREE.BoxGeometry(0.05, 1.05, 0.05), rail, posts));

  // String lights between poles.
  const bulbs: THREE.Matrix4[] = [];
  const poles: [number, number][] = [
    [-6, -7],
    [6, -7],
    [6, 7],
    [-6, 7],
  ];
  for (const [x, z] of poles) g.add(box(0.08, 3.2, 0.08, std(0x374151), x, 1.6, z));
  for (let i = 0; i < 4; i++) {
    const [ax, az] = poles[i];
    const [bx, bz] = poles[(i + 1) % 4];
    for (let k = 1; k < 20; k++) {
      const t = k / 20;
      bulbs.push(at(ax + (bx - ax) * t, 3.1 - Math.sin(t * Math.PI) * 0.7, az + (bz - az) * t));
    }
  }
  const bulbMat = glow(0xffe2a8, 2.6);
  const bulbMesh = instances(new THREE.SphereGeometry(0.05, 8, 6), bulbMat, bulbs);
  g.add(bulbMesh);
  g.add(plant(-7.5, -7.5, 1.6), plant(7.5, -7.5, 1.6), plant(7.5, 7.5, 1.3), plant(-7.5, 7.5, 1.3));
  const banner = board(['OFFSITE 2026', 'team building ✓'], 3, 0.9, { bg: '#e8562a', fg: '#ffffff', font: 'bold 52px sans-serif' });
  banner.position.set(0, 2.6, -8.9);
  g.add(banner);

  const deck = canvasTexture(
    256,
    256,
    (ctx) => {
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = i % 2 ? '#8a6a4b' : '#7c5e42';
        ctx.fillRect(i * 32, 0, 30, 256);
        ctx.fillStyle = '#3d2c1f';
        ctx.fillRect(i * 32 + 30, 0, 2, 256);
      }
    },
    [8, 8],
  );
  let tw = 0;
  return makeVenue('rooftop', g, {
    background: 0x2b2d42,
    fog: [0x6b4e6b, 30, 70],
    hemi: [0xffc49a, 0x3b2f4a, 0.9],
    key: [0xffe0c0, 2.1],
    env: 0.3,
    floor: deck,
    update: (dt) => {
      tw += dt;
      bulbMat.color.setHSL(0.11, 1, 0.8 + Math.sin(tw * 2.3) * 0.05);
    },
  });
}

// ---------------------------------------------------------------- outdoors

/** Repeatable pseudo-random numbers for prop placement (same layout every visit). */
function seeded(seed: number) {
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

/** A sky dome: a vertical gradient (top to bottom), drawn unfogged. */
function skyDome(stops: [number, string][], radius = 60) {
  const tex = canvasTexture(16, 256, (ctx) => {
    const grd = ctx.createLinearGradient(0, 0, 0, 256);
    for (const [t, c] of stops) grd.addColorStop(t, c);
    ctx.fillStyle = grd;
    ctx.fillRect(0, 0, 16, 256);
  });
  return new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false }));
}

/** A speckled ground texture (grass, sand) that tiles. */
function groundTexture(base: string, specks: string[], repeat: number, blades = false) {
  return canvasTexture(
    256,
    256,
    (ctx) => {
      const rnd = seeded(7);
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        ctx.fillStyle = specks[i % specks.length];
        const x = rnd() * 256;
        const y = rnd() * 256;
        if (blades) ctx.fillRect(x, y, 1, 2 + rnd() * 4);
        else ctx.fillRect(x, y, 1.5, 1.5);
      }
    },
    [repeat, repeat],
  );
}

/** A slab under the table so the playing area reads clearly on grass or sand. */
function pad(w: number, d: number, color: number) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.02, d), std(color, { roughness: 0.95 }));
  m.position.y = 0.005;
  return m;
}

/** City Park: a sunny afternoon at a concrete table among the trees. */
function park(): Venue {
  const g = new THREE.Group();
  g.add(
    skyDome([
      [0, '#3f7fd0'],
      [0.42, '#8fc2ee'],
      [0.5, '#d9ecf7'],
      [0.56, '#a7c48a'],
      [1, '#4d6b3a'],
    ]),
  );
  g.add(pad(5.6, 8.4, 0xb9b4aa));

  // Trees: instanced trunks and leafy crowns, in a ring well clear of the table.
  const rnd = seeded(42);
  const trunks: THREE.Matrix4[] = [];
  const crowns: THREE.Matrix4[] = [];
  const crowns2: THREE.Matrix4[] = [];
  for (let i = 0; i < 38; i++) {
    const a = (i / 38) * Math.PI * 2 + rnd() * 0.12;
    const r = 9 + rnd() * 11;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    if (Math.abs(x) < 4 && Math.abs(z) < 7) continue;
    const h = 2.2 + rnd() * 1.6;
    const sc = 0.8 + rnd() * 0.7;
    trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, h / 2, z), new THREE.Quaternion(), new THREE.Vector3(1, h, 1)));
    (i % 2 ? crowns : crowns2).push(new THREE.Matrix4().compose(new THREE.Vector3(x, h + 0.9 * sc, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(1.6 * sc, 1.4 * sc, 1.6 * sc)));
  }
  g.add(instances(new THREE.CylinderGeometry(0.12, 0.18, 1, 8), std(0x6b4a2f), trunks));
  g.add(instances(new THREE.IcosahedronGeometry(1, 1), std(0x3f7a35, { flatShading: true }), crowns));
  g.add(instances(new THREE.IcosahedronGeometry(1, 1), std(0x5a8f3c, { flatShading: true }), crowns2));

  // Benches either side, lamp posts, a bin and the event sign.
  const wood = std(0x9a6b3f);
  const iron = std(0x2f3437, { metalness: 0.5, roughness: 0.5 });
  for (const sx of [-1, 1]) {
    for (const z of [-2.5, 2.5]) {
      const bench = new THREE.Group();
      bench.add(box(0.45, 0.05, 1.6, wood, 0, 0.45, 0), box(0.06, 0.4, 1.6, wood, 0.2 * sx, 0.7, 0));
      bench.add(box(0.4, 0.45, 0.06, iron, 0, 0.225, -0.7), box(0.4, 0.45, 0.06, iron, 0, 0.225, 0.7));
      bench.position.set(sx * 4.2, 0, z);
      g.add(bench);
    }
  }
  const lampMat = glow(0xfff1c8, 1.6);
  for (const [x, z] of [
    [-5.5, -6],
    [5.5, -6],
    [-5.5, 6],
    [5.5, 6],
  ] as const) {
    g.add(box(0.08, 3.4, 0.08, iron, x, 1.7, z));
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), lampMat);
    lamp.position.set(x, 3.5, z);
    g.add(lamp);
  }
  g.add(box(0.5, 0.8, 0.5, std(0x2f6b45), 3.6, 0.4, -5.2));
  const sign = board(['PARK OPEN', 'all welcome'], 2.6, 0.8, { bg: '#2f6b45', fg: '#f4f1e6', font: 'bold 54px sans-serif' });
  sign.position.set(0, 1.3, -7.5);
  g.add(sign, box(0.08, 1.3, 0.08, iron, -1.1, 0.65, -7.52), box(0.08, 1.3, 0.08, iron, 1.1, 0.65, -7.52));
  g.add(plant(-3.6, 5.6, 1.4), plant(3.6, 5.6, 1.4));

  // A few birds circling overhead.
  const birds: THREE.Mesh[] = [];
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x1f2328 });
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 3), birdMat);
    b.rotation.z = Math.PI / 2;
    g.add(b);
    birds.push(b);
  }

  const grass = groundTexture('#4f7d36', ['#5d8f3f', '#446d2e', '#6a9a48', '#3c6128'], 14, true);
  let t = 0;
  return makeVenue('park', g, {
    background: 0x8fc2ee,
    fog: [0xc6dcea, 22, 58],
    hemi: [0xe4f1ff, 0x55703a, 1.15],
    key: [0xfff3dc, 2.6],
    env: 0.5,
    floor: grass,
    update: (dt) => {
      t += dt;
      birds.forEach((b, i) => {
        const a = t * (0.25 + i * 0.03) + i * 1.3;
        const r = 14 + i * 2;
        b.position.set(Math.cos(a) * r, 9 + i * 0.8 + Math.sin(t * 2 + i) * 0.3, Math.sin(a) * r - 6);
        b.rotation.y = -a;
      });
    },
  });
}

/** Offsite beach: late afternoon on the sand, the sea beyond the far end of the table. */
function beach(): Venue {
  const g = new THREE.Group();
  g.add(
    skyDome([
      [0, '#3d6fb8'],
      [0.38, '#8db8e2'],
      [0.48, '#ffd6a0'],
      [0.52, '#f6a96b'],
      [0.53, '#2f7fa3'],
      [1, '#1f5f80'],
    ]),
  );
  // The sun, low over the sea.
  const sun = new THREE.Mesh(new THREE.CircleGeometry(2.2, 32), glow(0xffe1a0, 2.4));
  sun.position.set(-8, 7, -55);
  g.add(sun);

  // The sea: a wide plane beyond the far end, with a shimmering tint and a line of surf.
  const seaMat = new THREE.MeshStandardMaterial({ color: 0x2f86a8, roughness: 0.25, metalness: 0.1, emissive: 0x0a3a50, emissiveIntensity: 0.4 });
  const sea = new THREE.Mesh(new THREE.PlaneGeometry(140, 60), seaMat);
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(0, 0.02, -44);
  g.add(sea);
  const foamMat = new THREE.MeshBasicMaterial({ color: 0xf4f7f6, transparent: true, opacity: 0.8 });
  const foam = new THREE.Mesh(new THREE.PlaneGeometry(140, 0.5), foamMat);
  foam.rotation.x = -Math.PI / 2;
  foam.position.set(0, 0.03, -14);
  g.add(foam);
  g.add(pad(5.2, 8, 0xc9a77c));

  // Palms: a leaning trunk of stacked segments, and a crown of drooping fronds.
  const trunkMat = std(0x8a6a44);
  const frondMat = std(0x3c8a3e, { side: THREE.DoubleSide, flatShading: true });
  const rnd = seeded(11);
  const palm = (x: number, z: number, h: number) => {
    const p = new THREE.Group();
    const lean = (rnd() - 0.5) * 0.5;
    let top = new THREE.Vector3();
    for (let k = 0; k < 8; k++) {
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(0.13 - k * 0.008, 0.16 - k * 0.008, h / 8, 7), trunkMat);
      const y = (k + 0.5) * (h / 8);
      seg.position.set(lean * y * y * 0.15, y, 0);
      seg.rotation.z = -lean * y * 0.3;
      p.add(seg);
      top = new THREE.Vector3(lean * h * h * 0.15, h, 0);
    }
    for (let f = 0; f < 7; f++) {
      const fr = new THREE.Mesh(new THREE.ConeGeometry(0.28, 2.2, 4), frondMat);
      fr.scale.set(1, 1, 0.15);
      fr.position.copy(top);
      fr.rotation.set(0, (f / 7) * Math.PI * 2, 0);
      fr.rotateZ(Math.PI / 2 + 0.5);
      fr.translateY(1);
      p.add(fr);
    }
    p.position.set(x, 0, z);
    p.rotation.y = rnd() * 6;
    return p;
  };
  for (const [x, z, h] of [
    [-7, -9, 5.5],
    [8, -10, 6.2],
    [-9, 3, 5],
    [9.5, 5, 5.6],
    [-12, -3, 6],
    [12, -4, 5.2],
  ] as const)
    g.add(palm(x, z, h));

  // Umbrellas and deck chairs along the sides.
  const stripes = canvasTexture(128, 16, (ctx) => {
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#ffffff' : '#e8562a';
      ctx.fillRect(i * 16, 0, 16, 16);
    }
  });
  const canopy = new THREE.MeshStandardMaterial({ map: stripes, side: THREE.DoubleSide, roughness: 0.8 });
  const pole = std(0xe9e4da);
  for (const [x, z] of [
    [-5, -4],
    [5.2, -2],
    [-5.4, 4.5],
    [5.6, 5.5],
  ] as const) {
    g.add(box(0.05, 2.2, 0.05, pole, x, 1.1, z));
    const c = new THREE.Mesh(new THREE.ConeGeometry(1.2, 0.45, 16, 1, true), canopy);
    c.position.set(x, 2.25, z);
    g.add(c);
    const chair = new THREE.Group();
    chair.add(box(0.55, 0.04, 1.1, std(0x2f86a8), 0, 0.25, 0));
    const back = box(0.55, 0.04, 0.6, std(0x2f86a8), 0, 0.45, 0.62);
    back.rotation.x = -0.9;
    chair.add(back);
    chair.position.set(x + 0.9 * Math.sign(x), 0, z + 0.4);
    g.add(chair);
  }

  // The offsite bar, and bunting above the court.
  const bar = new THREE.Group();
  bar.add(box(3, 1.1, 0.8, std(0x8a5a32), 0, 0.55, 0), box(3.4, 0.08, 1.4, std(0xd9c08a), 0, 2.4, 0.2));
  bar.add(box(0.08, 2.4, 0.08, trunkMat, -1.5, 1.2, 0.7), box(0.08, 2.4, 0.08, trunkMat, 1.5, 1.2, 0.7));
  const barSign = board(['OFFSITE BAR', 'smoothies'], 2.4, 0.6, { bg: '#ffd166', fg: '#7a3412', font: 'bold 44px sans-serif' });
  barSign.position.set(0, 2.05, 0.82);
  bar.add(barSign);
  bar.position.set(-7.5, 0, 7.5);
  bar.rotation.y = Math.PI / 5;
  g.add(bar);
  const flagCols = [0xe8562a, 0xffd166, 0x2f86a8, 0x4ade80, 0xf7f7f4];
  for (let i = 0; i < 24; i++) {
    const tt = i / 23;
    const f = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.22, 3), new THREE.MeshStandardMaterial({ color: flagCols[i % flagCols.length], side: THREE.DoubleSide }));
    f.rotation.x = Math.PI;
    f.position.set(-5 + 10 * tt, 3.4 - Math.sin(tt * Math.PI) * 0.5, -6.2);
    g.add(f);
  }
  g.add(box(0.08, 3.5, 0.08, trunkMat, -5, 1.75, -6.2), box(0.08, 3.5, 0.08, trunkMat, 5, 1.75, -6.2));

  const sand = groundTexture('#e2c597', ['#d9b985', '#ecd3a8', '#cfae7c', '#f1dcb6'], 12);
  let t = 0;
  return makeVenue('beach', g, {
    background: 0x8db8e2,
    fog: [0xf0d6b4, 30, 80],
    hemi: [0xffe9cc, 0xc9a77a, 1.05],
    key: [0xffe0b0, 2.5],
    env: 0.45,
    floor: sand,
    update: (dt) => {
      t += dt;
      seaMat.emissiveIntensity = 0.35 + Math.sin(t * 0.8) * 0.08;
      foam.position.z = -14 + Math.sin(t * 0.6) * 0.6;
      foamMat.opacity = 0.55 + Math.sin(t * 0.6 + 1) * 0.25;
    },
  });
}

// ---------------------------------------------------------------- application

interface Look {
  background: number;
  fog: [number, number, number];
  hemi: [number, number, number];
  key: [number, number];
  /** Strength of the image-based (environment) light. */
  env?: number;
  floor?: THREE.Texture;
  update?: (dt: number, time: number) => void;
  setScore?: (lines: string[]) => void;
}

function makeVenue(id: VenueId, group: THREE.Group, look: Look): Venue {
  group.userData.look = look;
  group.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.receiveShadow = false;
  });
  return {
    id,
    group,
    update: look.update ?? (() => {}),
    setScore: look.setScore,
    dispose: () =>
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        const mats = Array.isArray(m.material) ? m.material : [m.material];
        mats.forEach((mat) => {
          (mat as THREE.MeshStandardMaterial).map?.dispose();
          mat.dispose();
        });
      }),
  };
}

const BUILDERS: Record<Exclude<VenueId, 'sandbox'>, () => Venue> = { office, mem, server: testBay, conference, rooftop, park, beach };

const SANDBOX_LOOK: Look = { background: 0x14161c, fog: [0x14161c, 12, 30], hemi: [0xdfe8ff, 0x22252c, 0.85], key: [0xffffff, 2.2], env: 0.35 };

/** Swap the scene to a venue, disposing the previous one. */
export function setVenue(scene: THREE.Scene, id: VenueId, previous: Venue | null): Venue | null {
  if (previous) {
    scene.remove(previous.group);
    previous.dispose();
  }
  const venue = id === 'sandbox' ? null : BUILDERS[id]();
  const look: Look = venue ? (venue.group.userData.look as Look) : SANDBOX_LOOK;
  scene.background = new THREE.Color(look.background);
  scene.fog = new THREE.Fog(...look.fog);
  const hemi = scene.getObjectByName('hemi') as THREE.HemisphereLight;
  hemi.color.set(look.hemi[0]);
  hemi.groundColor.set(look.hemi[1]);
  hemi.intensity = look.hemi[2];
  const key = scene.getObjectByName('key') as THREE.DirectionalLight;
  key.color.set(look.key[0]);
  key.intensity = look.key[1];
  scene.environmentIntensity = look.env ?? 0.35;
  const floor = scene.getObjectByName('floor') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
  floor.material.map = look.floor ?? null;
  floor.material.color.set(look.floor ? 0xffffff : 0x23262e);
  floor.material.needsUpdate = true;
  (scene.getObjectByName('grid') as THREE.Object3D).visible = !venue;
  if (venue) scene.add(venue.group);
  return venue;
}
