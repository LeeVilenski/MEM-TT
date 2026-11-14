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
export type VenueId = 'sandbox' | 'office' | 'server' | 'conference' | 'rooftop';
export type Ambience = 'none' | 'office' | 'servers' | 'room' | 'wind';

export const VENUES: Record<VenueId, { name: string; ambience: Ambience }> = {
  sandbox: { name: 'Sandbox', ambience: 'none' },
  office: { name: 'Open-plan office', ambience: 'office' },
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

const BUILDERS: Record<Exclude<VenueId, 'sandbox'>, () => Venue> = { office, server: serverRoom, conference, rooftop };

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
