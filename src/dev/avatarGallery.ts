import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STYLES, type StyleId } from '../game/styles';
import type { StrokeSide } from '../game/swing';
import { PADDLE } from '../physics';
import { AVATAR_STYLES, Avatar } from '../render/avatar';
import { bladeQuaternion, gripQuaternion } from '../render/playerView';

/**
 * Developer page (avatars.html, `npm run dev` then /avatars.html): every character in a
 * fixed set of poses, seen from fixed angles, for judging and comparing the models.
 * The poses are stepped with a fixed clock, so the same code always draws the same
 * picture: scripts/avatar-shots.mjs screenshots this page and compares against a baseline.
 *
 * URL: ?style=<StyleId>|lineup  &variant=<n> (which shirt, for wardrobes)  &shot=1 (no UI)
 *      &pose=<name> (just that picture, large: e.g. pose=Racket hand)  &az=<rad> (turn the view round).
 * Drag a cell sideways to turn the view round the character.
 */

const onePose = new URLSearchParams(location.search).get('pose');
const CELL = onePose ? 800 : 400;
const COLS = onePose ? 1 : 4;
/** Fixed step for the pose warm-up (s). */
const DT = 1 / 60;

interface View {
  /** Angle round the character: 0 = in front of them, + = round to their left (our right). */
  az: number;
  /** Camera height above the target, as a fraction of the distance. */
  el: number;
  dist: number;
  /** Height looked at (m). */
  y: number;
  fov?: number;
}

interface Pose {
  name: string;
  /** Aim at the head or the racket hand rather than the whole body. */
  aim?: 'head' | 'hand';
  /** Stand still in the rest pose (no paddle). */
  rest?: boolean;
  /** Paddle handle, relative to the feet, for a right-hander facing −z (mirrored for left-handers). */
  hand: [number, number, number];
  /** The hitting face's direction (as the game's paddle normal) for a right-hander, and the wing. */
  normal: [number, number, number];
  wing: StrokeSide;
  /** Sideways speed while posing (m/s): the shuffle. */
  move?: number;
  /**
   * Where the character looks, relative to the feet for a right-hander: a ball (drawn), or
   * the camera (for portraits). None: straight ahead.
   */
  gaze?: [number, number, number] | 'camera';
  /** A reaction started this long before the picture (s). */
  react?: { kind: 'celebrate' | 'dismay'; at: number };
  view: View;
}

const FULL: Omit<View, 'az'> = { el: 0.08, dist: 4.4, y: 0.92 };
/** Face close-ups aim at the head wherever the pose put it (y is filled in then). */
const FACE: Omit<View, 'az'> = { el: 0.04, dist: 1.2, y: 0, fov: 24 };
/** Ready, watching a ball coming over the net. */
const READY: Pick<Pose, 'hand' | 'normal' | 'wing' | 'gaze'> = { hand: [0.38, 1.0, -0.38], normal: [-0.2, 0.1, -1], wing: 'forehand', gaze: [0.15, 1.15, -2.2] };

const POSES: Pose[] = [
  { name: 'Front', ...READY, view: { az: 0, ...FULL } },
  { name: 'Side', ...READY, view: { az: Math.PI / 2, ...FULL } },
  { name: 'Back', ...READY, view: { az: Math.PI, ...FULL } },
  { name: 'Face', ...READY, gaze: 'camera', aim: 'head', view: { az: 0, ...FACE } },
  { name: 'Face ¾', ...READY, gaze: 'camera', aim: 'head', view: { az: 0.7, ...FACE } },
  { name: 'Forehand, wide', hand: [0.82, 1.0, -0.3], normal: [-0.4, 0.15, -1], wing: 'forehand', gaze: [0.85, 1.12, -0.6], view: { az: 0.6, ...FULL } },
  { name: 'Backhand', hand: [-0.24, 1.0, -0.42], normal: [0.2, 0.1, -1], wing: 'backhand', gaze: [-0.24, 1.1, -0.7], view: { az: -0.5, ...FULL } },
  { name: 'Low ball', hand: [0.45, 0.45, -0.5], normal: [-0.1, 0.7, -1], wing: 'forehand', gaze: [0.45, 0.55, -0.8], view: { az: 0.9, ...FULL } },
  { name: 'Smash', hand: [0.4, 1.8, -0.15], normal: [-0.1, -0.35, -1], wing: 'forehand', gaze: [0.4, 1.95, -0.45], view: { az: 0.7, ...FULL } },
  { name: 'Moving', ...READY, move: 1.6, view: { az: 0.4, ...FULL } },
  { name: 'Celebrate', ...READY, gaze: undefined, react: { kind: 'celebrate', at: 0.3 }, view: { az: 0.4, ...FULL } },
  { name: 'Slump', ...READY, gaze: undefined, react: { kind: 'dismay', at: 0.7 }, view: { az: 0.4, ...FULL } },
  { name: 'Rest pose', ...READY, gaze: undefined, rest: true, view: { az: 0, ...FULL } },
  { name: 'Rest pose, side', ...READY, gaze: undefined, rest: true, view: { az: Math.PI / 2, ...FULL } },
  { name: 'Head, side', ...READY, aim: 'head', view: { az: Math.PI / 2, ...FACE } },
  { name: 'Racket hand', ...READY, gaze: [0.4, 1.08, -0.6], aim: 'hand', view: { az: 0.9, el: 0.1, dist: 1.2, y: 0, fov: 24 } },
];

/** Warm-up before each picture (s): long enough for the springs to settle. */
const WARM = 2;

const params = new URLSearchParams(location.search);
const shotMode = params.get('shot') === '1';
const styleParam = params.get('style') ?? 'allround';
const variant = Number(params.get('variant') ?? 0);
if (shotMode) document.body.classList.add('shot');

/**
 * A bat as the game draws it (playerView.ts), with its origin at the middle of the
 * handle: red rubber on the hitting face (+z) for a forehand, black for a backhand.
 */
function makePaddle(wing: StrokeSide) {
  const g = new THREE.Group();
  const lift = (PADDLE.radius + 0.045) * 1.06; // handle middle to blade middle
  const disc = new THREE.CylinderGeometry(PADDLE.radius, PADDLE.radius, 0.002, 40).rotateX(Math.PI / 2);
  const rubber = (color: number, z: number) => {
    const m = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
    m.position.set(0, lift, z);
    m.scale.y = 1.06;
    return m;
  };
  const fh = wing === 'forehand';
  const core = new THREE.Mesh(new THREE.CylinderGeometry(PADDLE.radius - 0.002, PADDLE.radius - 0.002, 0.007, 40).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xd8b07a, roughness: 0.7 }));
  core.position.y = lift;
  core.scale.y = 1.06;
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.024), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }));
  handle.scale.y = 1.06;
  g.add(rubber(fh ? 0xc8202a : 0x15161a, 0.0045), rubber(fh ? 0x15161a : 0xc8202a, -0.0045), core, handle);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

/** A small lit studio: floor with a grid (to judge foot placement), key, fill and rim lights. */
function makeStage(renderer: THREE.WebGLRenderer, env: THREE.Texture, centre = new THREE.Vector3(), size = 3) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x2a3140);
  scene.environment = env;
  scene.environmentIntensity = 0.5;
  scene.add(new THREE.HemisphereLight(0xe8eeff, 0x2a2420, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(centre.x - 1.5, 3.5, centre.z - 2.5);
  key.target.position.copy(centre);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 3;
  const sc = key.shadow.camera;
  sc.left = sc.bottom = -size;
  sc.right = sc.top = size;
  scene.add(key, key.target);
  const rim = new THREE.DirectionalLight(0x6ab8ff, 1.6);
  rim.position.set(centre.x + 1.5, 2, centre.z + 3);
  scene.add(rim);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(size * 4, size * 4), new THREE.MeshStandardMaterial({ color: 0x394254, roughness: 0.9 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(centre);
  floor.receiveShadow = true;
  const grid = new THREE.GridHelper(size * 4, size * 8, 0x526079, 0x465269);
  grid.position.set(centre.x, 0.001, centre.z);
  scene.add(floor, grid);
  void renderer;
  return scene;
}

interface Cell {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  view: View;
  target: THREE.Vector3;
  label: string;
  /** Size in cells. */
  w: number;
  h: number;
}

function placeCamera(c: Cell) {
  const { az, el, dist, y } = c.view;
  c.camera.position.set(c.target.x + Math.sin(az) * dist, y + el * dist, c.target.z - Math.cos(az) * dist);
  c.camera.lookAt(c.target.x, y, c.target.z);
}

/** Pose one character and step it to the picture's moment. */
function posed(style: StyleId, pose: Pose, scene: THREE.Scene) {
  const avatar = new Avatar(style, 1, variant);
  const mirror = STYLES[style].leftHanded ? -1 : 1;
  const paddle = makePaddle(pose.wing);
  const n = new THREE.Vector3(pose.normal[0] * mirror, pose.normal[1], pose.normal[2]).normalize();
  const grip = new THREE.Quaternion();
  scene.add(avatar.group, paddle);
  let gaze: THREE.Vector3 | null = null;
  if (pose.gaze === 'camera') {
    const v = pose.view;
    gaze = new THREE.Vector3(Math.sin(v.az) * v.dist, 1.62 + v.el * v.dist, -Math.cos(v.az) * v.dist);
  } else if (pose.gaze) {
    gaze = new THREE.Vector3(pose.gaze[0] * mirror, pose.gaze[1], pose.gaze[2]);
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.02, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.4 }));
    ball.position.copy(gaze);
    ball.castShadow = true;
    scene.add(ball);
  }
  const steps = Math.round(WARM / DT);
  const reactAt = pose.react ? steps - Math.round(pose.react.at / DT) : -1;
  const body = { x: 0, z: 0 };
  for (let i = 0; i <= steps; i++) {
    const t = i * DT;
    body.x = (pose.move ?? 0) * (t - WARM); // ends at x = 0 when moving
    if (i === reactAt) avatar.react(pose.react!.kind);
    const hand = new THREE.Vector3(body.x + pose.hand[0] * mirror, pose.hand[1], body.z + pose.hand[2]);
    paddle.position.copy(hand);
    bladeQuaternion(n, -pose.hand[0] * mirror, paddle.quaternion);
    gripQuaternion(paddle.quaternion, pose.wing, grip);
    const look = gaze && gaze.clone().add(new THREE.Vector3(body.x, 0, body.z));
    avatar.update(body, hand, true, { now: 10 + t, gaze: look, grip }); // a fixed clock: the same pose every time
  }
  if (pose.rest) {
    avatar.restPose();
    paddle.visible = false;
  }
  return avatar;
}

/** The middle of the face, wherever the pose put the head: a little above the head joint (top of the neck), in front. */
function headCentre(avatar: Avatar) {
  avatar.group.updateMatrixWorld(true);
  return avatar.rig.head.localToWorld(new THREE.Vector3(0, 0.07, -0.03));
}

function characterCells(style: StyleId, renderer: THREE.WebGLRenderer, env: THREE.Texture): Cell[] {
  return POSES.filter((p) => !onePose || p.name === onePose).map((pose) => {
    const scene = makeStage(renderer, env);
    const avatar = posed(style, pose, scene);
    const camera = new THREE.PerspectiveCamera(pose.view.fov ?? 30, 1, 0.05, 50);
    const view = { ...pose.view };
    view.az += Number(params.get('az') ?? 0); // ?az=: turn the camera further round (single pictures)
    const target = new THREE.Vector3();
    if (pose.aim) {
      const h = pose.aim === 'head' ? headCentre(avatar) : avatar.rig.arm.hand.getWorldPosition(new THREE.Vector3());
      target.set(h.x, 0, h.z);
      view.y = h.y;
    }
    return { scene, camera, view, target, label: pose.name, w: 1, h: 1 };
  });
}

function lineupCells(renderer: THREE.WebGLRenderer, env: THREE.Texture): Cell[] {
  const gap = 0.95;
  const n = AVATAR_STYLES.length;
  const make = (az: number, label: string): Cell => {
    const scene = makeStage(renderer, env, new THREE.Vector3(), n * 0.6);
    AVATAR_STYLES.forEach((style, i) => {
      const a = posed(style, { ...POSES[0], gaze: undefined }, scene); // no ball: the paddle is the last thing added
      const x = (i - (n - 1) / 2) * gap;
      // posed() leaves the character (and paddle) at the origin: slide the pair along.
      a.group.position.x += x;
      const paddle = scene.children[scene.children.length - 1];
      paddle.position.x += x;
    });
    const camera = new THREE.PerspectiveCamera(30, COLS / 1, 0.05, 80);
    return { scene, camera, view: { az, el: 0.05, dist: 6.2, y: 0.95 }, target: new THREE.Vector3(), label, w: COLS, h: 1 };
  };
  return [make(0, 'Line-up, front'), make(0.55, 'Line-up, ¾')];
}

/**
 * The character standing in the rest pose, at height scale 1, as a binary glTF: a
 * reference to import into Blender and model over (see docs/avatar-heads.md).
 */
async function downloadGlb(style: StyleId) {
  const a = new Avatar(style, 1, variant);
  a.restPose();
  a.group.scale.setScalar(1);
  a.group.updateMatrixWorld(true);
  const glb = (await new GLTFExporter().parseAsync(a.group, { binary: true })) as ArrayBuffer;
  a.dispose();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([glb], { type: 'model/gltf-binary' }));
  link.download = `${STYLES[style].character.toLowerCase()}-rest.glb`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function build() {
  const bar = document.getElementById('bar')!;
  const sheet = document.getElementById('sheet')!;
  const isLineup = styleParam === 'lineup';
  const style = (AVATAR_STYLES as string[]).includes(styleParam) ? (styleParam as StyleId) : 'allround';

  if (!shotMode) {
    const opts = ['lineup', ...AVATAR_STYLES]
      .map((s) => `<option value="${s}" ${s === (isLineup ? 'lineup' : style) ? 'selected' : ''}>${s === 'lineup' ? 'All (line-up)' : `${STYLES[s as StyleId].character} (${s})`}</option>`)
      .join('');
    bar.innerHTML = `<h1>Avatar gallery</h1><select id="pick">${opts}</select>
      <label>Shirt <select id="variant">${[0, 1, 2, 3, 4, 5].map((v) => `<option ${v === variant ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <button id="reset">Reset views</button>
      ${isLineup ? '' : '<button id="glb" title="The character in the rest pose at height scale 1, for modelling over in Blender (docs/avatar-heads.md)">Download .glb</button>'}<span class="hint">Drag a picture sideways to turn round the character.</span>`;
    const go = () => {
      const p = new URLSearchParams({ style: (document.getElementById('pick') as HTMLSelectElement).value, variant: (document.getElementById('variant') as HTMLSelectElement).value });
      location.search = p.toString();
    };
    document.getElementById('pick')!.addEventListener('change', go);
    document.getElementById('variant')!.addEventListener('change', go);
    document.getElementById('glb')?.addEventListener('click', () => void downloadGlb(style));
  }

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(shotMode ? 1 : Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();

  const cells = isLineup ? lineupCells(renderer, env) : characterCells(style, renderer, env);
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let used = 0;
  for (const c of cells) {
    if (used + c.w > COLS) {
      rows.push(row);
      row = [];
      used = 0;
    }
    row.push(c);
    used += c.w;
  }
  if (row.length) rows.push(row);
  const W = COLS * CELL;
  const H = rows.length * CELL;
  renderer.setSize(W, H);
  renderer.setScissorTest(true);
  sheet.appendChild(renderer.domElement);

  const rects = new Map<Cell, { x: number; y: number; w: number; h: number }>();
  rows.forEach((r, ri) => {
    let x = 0;
    for (const c of r) {
      rects.set(c, { x: x * CELL, y: ri * CELL, w: c.w * CELL, h: c.h * CELL });
      c.camera.aspect = c.w / c.h;
      c.camera.updateProjectionMatrix();
      x += c.w;
    }
  });
  const title = isLineup ? 'All characters' : `${STYLES[style].character} (${style})`;
  for (const [c, r] of rects) {
    const label = document.createElement('div');
    label.className = 'cell-label';
    label.textContent = c === cells[0] ? `${title}: ${c.label}` : c.label;
    label.style.left = `${r.x + 8}px`;
    label.style.top = `${r.y + 8}px`;
    sheet.appendChild(label);
  }

  const render = () => {
    for (const [c, r] of rects) {
      placeCamera(c);
      const y = H - r.y - r.h; // GL viewports count from the bottom
      renderer.setViewport(r.x, y, r.w, r.h);
      renderer.setScissor(r.x, y, r.w, r.h);
      renderer.render(c.scene, c.camera);
    }
  };
  render();

  if (!shotMode) {
    const initial = new Map(cells.map((c) => [c, c.view.az]));
    let drag: { cell: Cell; x: number } | null = null;
    const cellAt = (e: PointerEvent) => {
      const b = renderer.domElement.getBoundingClientRect();
      const px = e.clientX - b.left;
      const py = e.clientY - b.top;
      for (const [c, r] of rects) if (px >= r.x && px < r.x + r.w && py >= r.y && py < r.y + r.h) return c;
      return null;
    };
    renderer.domElement.addEventListener('pointerdown', (e) => {
      const cell = cellAt(e);
      if (cell) drag = { cell, x: e.clientX };
      renderer.domElement.setPointerCapture(e.pointerId);
    });
    renderer.domElement.addEventListener('pointermove', (e) => {
      if (!drag) return;
      drag.cell.view.az -= (e.clientX - drag.x) * 0.012;
      drag.x = e.clientX;
      render();
    });
    renderer.domElement.addEventListener('pointerup', () => (drag = null));
    document.getElementById('reset')!.addEventListener('click', () => {
      for (const c of cells) c.view.az = initial.get(c)!;
      render();
    });
  }
  (window as unknown as { __avatarGalleryReady: boolean }).__avatarGalleryReady = true;
}

build();
