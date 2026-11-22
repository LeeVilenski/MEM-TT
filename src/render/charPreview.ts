import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { StyleId } from '../game/styles';
import { Avatar, type Reaction } from './avatar';
import { bladeQuaternion } from './playerView';

/** The ready position's bat face: ahead, a little across and up. */
const READY_FACE = { x: -0.2, y: 0.1, z: -1 };

/**
 * A small, separate 3D view of one character on a turntable, for the character
 * select screen. It has its own renderer and only draws while it is on screen.
 * Drag to turn the character; otherwise it turns slowly by itself.
 */
export class CharacterPreview {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(28, 1, 0.1, 30);
  private turntable = new THREE.Group();
  private avatar: Avatar | null = null;
  private style: StyleId | null = null;
  private paddle = new THREE.Group();
  private running = false;
  private spin = 0.5;
  private dragX: number | null = null;
  private idleFor = 0;
  private last = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.NeutralToneMapping;
    this.renderer.shadowMap.enabled = true;
    this.canvas = this.renderer.domElement;
    this.canvas.className = 'cs3d';
    this.canvas.setAttribute('role', 'img');

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.5;
    pmrem.dispose();
    this.scene.add(new THREE.HemisphereLight(0xe8eeff, 0x2a2420, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(-1.5, 3.5, -2.5);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.radius = 4;
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -1.5;
    sc.right = sc.top = 1.5;
    this.scene.add(key);
    // Warm rim light from behind, in the game's accent colour.
    const rim = new THREE.DirectionalLight(0x6ab8ff, 1.6);
    rim.position.set(1.5, 2, 3);
    this.scene.add(rim);

    // A round plinth with a soft glow ring.
    const plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.66, 0.06, 48), new THREE.MeshStandardMaterial({ color: 0x1f232c, roughness: 0.6, metalness: 0.2 }));
    plinth.position.y = -0.03;
    plinth.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64, 0.008, 8, 64), new THREE.MeshBasicMaterial({ color: 0x3b8cff }));
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.001;
    this.scene.add(plinth, ring, this.turntable);

    // A paddle in the character's hand, so the racket arm has something to hold. Its
    // origin is the middle of the handle (where the hand holds it).
    const disc = new THREE.CylinderGeometry(0.075, 0.075, 0.008, 32).rotateX(Math.PI / 2);
    const face = new THREE.Mesh(disc, new THREE.MeshStandardMaterial({ color: 0xc8202a, roughness: 0.6 }));
    face.position.y = 0.12;
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.1, 0.024), new THREE.MeshStandardMaterial({ color: 0x8a5a2b, roughness: 0.7 }));
    this.paddle.add(face, handle);
    this.paddle.traverse((o) => (o.castShadow = true));
    this.turntable.add(this.paddle);

    this.camera.position.set(0, 1.2, -4.4);
    this.camera.lookAt(0, 0.86, 0);

    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.turntable.rotation.y += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
      this.idleFor = 0;
    });
    const up = () => (this.dragX = null);
    this.canvas.addEventListener('pointerup', up);
    this.canvas.addEventListener('pointercancel', up);
  }

  setStyle(style: StyleId, label: string) {
    this.canvas.setAttribute('aria-label', label);
    if (style === this.style) return;
    this.style = style;
    if (this.avatar) {
      this.turntable.remove(this.avatar.group);
      this.avatar.dispose();
    }
    this.avatar = new Avatar(style);
    this.avatar.group.traverse((o) => (o.castShadow = true));
    this.turntable.add(this.avatar.group);
    this.turntable.rotation.y = -0.45;
  }

  react(kind: Reaction) {
    this.avatar?.react(kind);
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  stop() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  private frame() {
    // Size to the slot the canvas sits in.
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const w = parent.clientWidth;
    const h = parent.clientHeight;
    if (w === 0 || h === 0) return;
    const size = this.renderer.getSize(new THREE.Vector2());
    if (size.x !== w || size.y !== h) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      // Keep the whole figure in view on narrow or short slots.
      this.camera.fov = w / h < 0.8 ? 34 : 28;
      this.camera.updateProjectionMatrix();
    }
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    this.idleFor += dt;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (this.dragX === null && this.idleFor > 1.5 && !reduced) this.turntable.rotation.y += this.spin * dt;

    // Ready position: paddle out in front on the forehand side, swaying a little.
    const t = now / 1000;
    // On the bat-hand side (left-handers hold it on the left).
    const side = this.avatar?.rig.batHand ?? 1;
    const hand = new THREE.Vector3(side * (0.38 + Math.sin(t * 1.3) * 0.04), 1.0 + Math.sin(t * 2.1) * 0.02, -0.38);
    this.paddle.position.copy(hand);
    // Forehand rubber facing ahead and a little across, as in the ready position.
    bladeQuaternion({ ...READY_FACE, x: side * READY_FACE.x }, -hand.x, this.paddle.quaternion);
    if (this.avatar) {
      this.turntable.updateMatrixWorld(true);
      // The avatar faces local −z (toward the camera) inside the turntable; it takes the hand
      // and the bat in world space, and looks at you (as far as the neck turns).
      const grip = this.turntable.quaternion.clone().multiply(this.paddle.quaternion);
      this.avatar.update({ x: 0, z: 0 }, this.turntable.localToWorld(hand.clone()), true, { gaze: this.camera.position, grip });
    }
    this.renderer.render(this.scene, this.camera);
  }
}
