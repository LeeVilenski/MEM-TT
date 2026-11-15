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
export type VenueId = 'sandbox' | 'office' | 'mem' | 'server' | 'conference' | 'rooftop';
export type Ambience = 'none' | 'office' | 'servers' | 'room' | 'wind';

export const VENUES: Record<VenueId, { name: string; ambience: Ambience }> = {
  sandbox: { name: 'Sandbox', ambience: 'none' },
  office: { name: 'Open-plan office', ambience: 'office' },
  mem: { name: 'MEM', ambience: 'servers' },
  server: { name: 'Server room', ambience: 'servers' },
  conference: { name: 'Conference room', ambience: 'room' },
  rooftop: { name: 'Rooftop (company offsite)', ambience: 'wind' },
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
  const dart = canvasTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(64, 64, 62, 0, Math.PI * 2);
    ctx.fill();
    for (let i = 0; i < 20; i++) {
      ctx.fillStyle = i % 2 ? '#e7cf8f' : '#1a1a1a';
      ctx.beginPath();
      ctx.moveTo(64, 64);
      ctx.arc(64, 64, 50, (i / 20) * Math.PI * 2, ((i + 1) / 20) * Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#c81e1e';
    ctx.lineWidth = 5;
    for (const r of [48, 30]) {
      ctx.beginPath();
      ctx.arc(64, 64, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.fillStyle = '#22a34a';
    ctx.beginPath();
    ctx.arc(64, 64, 6, 0, Math.PI * 2);
    ctx.fill();
  });
  const dartboard = new THREE.Mesh(new THREE.CircleGeometry(0.24, 32), new THREE.MeshStandardMaterial({ map: dart, roughness: 0.8 }));
  dartboard.position.set(-1.2, 1.65, nz - 0.05);
  dartboard.rotation.y = Math.PI;
  g.add(dartboard, box(0.7, 0.9, 0.03, std(0xa48a6a), -1.2, 1.55, nz - 0.02));
  for (const x of [-2.6, -3.0]) g.add(box(0.4, 1.0, 0.18, std(x < -2.8 ? 0x2b2f36 : 0x1e3a8a), x, 1.3, nz - 0.12));

  // ---- Bunting and fairy lights across the low ceiling.
  const flagCols = [0x16a34a, 0xffffff, 0xdc2626, 0xfacc15, 0x1d4ed8, 0xf97316];
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
  string(new THREE.Vector3(-W / 2, H - 0.08, -3.8), new THREE.Vector3(W / 2, H - 0.08, -3.4), 12, flags, 0.2);
  const flagMesh = instances(new THREE.PlaneGeometry(0.15, 0.11).translate(0, -0.055, 0), std(0xffffff, { side: THREE.DoubleSide }), flags);
  flags.forEach((_, i) => flagMesh.setColorAt(i, new THREE.Color(flagCols[i % flagCols.length])));
  g.add(flagMesh);
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
      bulbMat.color.setHSL(0.12, 1, 0.82 + Math.sin(spin * 0.25) * 0.04);
    },
    setScore: (lines) => {
      screenLines = lines;
      drawScreen();
    },
  });
}

function serverRoom(): Venue {
  const g = new THREE.Group();
  const W = 14;
  const D = 22;
  const H = 3.2;
  room(g, W, D, H, std(0x1b2230), { ceiling: std(0x111620) });

  // Rack rows along both sides and behind the far end, with blinking status LEDs.
  const rackMat = std(0x0e1117, { roughness: 0.5, metalness: 0.4 });
  const racks: THREE.Matrix4[] = [];
  const leds: THREE.Matrix4[] = [];
  const addRack = (x: number, z: number, ry: number) => {
    racks.push(at(x, 1.05, z, ry));
    const face = new THREE.Vector3(Math.sin(ry), 0, Math.cos(ry)).multiplyScalar(0.36);
    const side = new THREE.Vector3(Math.cos(ry), 0, -Math.sin(ry));
    for (let row = 0; row < 14; row++) {
      for (let k = 0; k < 3; k++) {
        const p = new THREE.Vector3(x, 0.35 + row * 0.12, z).add(face).add(side.clone().multiplyScalar(-0.22 + k * 0.05));
        leds.push(at(p.x, p.y, p.z));
      }
    }
  };
  for (let z = -9; z <= 9; z += 0.7) {
    addRack(-5.2, z, Math.PI / 2);
    addRack(5.2, z, -Math.PI / 2);
  }
  for (let x = -3.6; x <= 3.6; x += 0.7) addRack(x, -9.6, 0);
  g.add(instances(new THREE.BoxGeometry(0.6, 2.1, 0.7), rackMat, racks));
  const ledMesh = instances(new THREE.BoxGeometry(0.025, 0.012, 0.01), glow(0xffffff, 2.6), leds);
  const palette = [new THREE.Color(0x22c55e), new THREE.Color(0x22c55e), new THREE.Color(0x38bdf8), new THREE.Color(0xf59e0b), new THREE.Color(0x111827)];
  for (let i = 0; i < leds.length; i++) ledMesh.setColorAt(i, palette[(i * 7) % palette.length]);
  g.add(ledMesh);

  // Cable trays overhead and cold-aisle lights.
  const tray = std(0xd4a017, { metalness: 0.3 });
  g.add(box(0.4, 0.08, D, tray, -4, H - 0.4, 0), box(0.4, 0.08, D, tray, 4, H - 0.4, 0));
  const strip = glow(0x7dd3fc);
  for (const x of [-2.5, 2.5]) g.add(box(0.08, 0.03, D - 2, strip, x, H - 0.02, 0));
  const sign = board(['⚠ AUTHORISED', '   PERSONNEL ONLY', '  (and ping pong)'], 1.8, 0.9, { bg: '#fde047', fg: '#111827', font: 'bold 40px sans-serif' });
  sign.position.set(-6.98, 1.8, -3);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);

  const tiles = canvasTexture(
    128,
    128,
    (ctx) => {
      ctx.fillStyle = '#3a414d';
      ctx.fillRect(0, 0, 128, 128);
      ctx.strokeStyle = '#262b33';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, 128, 128);
      ctx.fillStyle = '#2f353f';
      for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) ctx.fillRect(20 + i * 26, 20 + j * 26, 6, 6);
    },
    [40, 40],
  );

  let acc = 0;
  return makeVenue('server', g, {
    background: 0x070a10,
    fog: [0x070a10, 8, 24],
    hemi: [0x9cc3ff, 0x0b0f17, 0.6],
    key: [0xdbeafe, 2.1],
    env: 0.18,
    floor: tiles,
    update: (dt) => {
      acc += dt;
      if (acc < 0.15) return;
      acc = 0;
      // Blink a few LEDs each step.
      for (let k = 0; k < 40; k++) {
        const i = Math.floor(Math.random() * leds.length);
        ledMesh.setColorAt(i, palette[Math.floor(Math.random() * palette.length)]);
      }
      ledMesh.instanceColor!.needsUpdate = true;
    },
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

const BUILDERS: Record<Exclude<VenueId, 'sandbox'>, () => Venue> = { office, mem, server: serverRoom, conference, rooftop };

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
