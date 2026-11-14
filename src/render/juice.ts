import * as THREE from 'three';
import { length, type BallState, type Vec3 } from '../physics';
import { spinColor } from './ballView';

/**
 * "Arcade effects": purely presentational feedback that makes hits feel punchy.
 * - Hit-stop: a brief freeze of the game clock on hard contacts (offline only).
 * - Camera shake and a small FOV kick on big hits.
 * - A glowing comet tail behind the ball, coloured by spin, brighter with speed.
 * - Sparks at paddle contact (gold for a perfectly timed stroke) and puffs on hard bounces.
 * Nothing here changes the physics.
 */

/** How hard a shot was, 0–1, from the ball's speed off the paddle (m/s). */
export function hitPower(speed: number): number {
  return Math.max(0, Math.min(1, (speed - 7) / 18));
}

const COMET_POINTS = 48;
/** Seconds of ball path the comet tail covers. */
const COMET_SPAN = 0.11;
const MAX_SPARKS = 220;

interface Spark {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  life: number;
  maxLife: number;
  color: THREE.Color;
}

export class Juice {
  /** Master switch (the "Arcade effects" setting). */
  enabled = true;
  private materials: THREE.MeshBasicMaterial[] = [];

  /** With bloom on, the trail and sparks are pushed above white so they glow. */
  setGlow(on: boolean) {
    for (const m of this.materials) m.color.setScalar(on ? 2.2 : 1);
  }
  /** Hit-stop needs a pausable clock: off in online rooms. */
  allowHitStop = true;

  private hitStopLeft = 0;
  private shakeAmp = 0;
  private shakeTime = 0;
  private fovKick = 0;
  private readonly offset = new THREE.Vector3();

  // Comet tail
  private history: { p: THREE.Vector3; t: number }[] = [];
  private time = 0;
  private comet: THREE.InstancedMesh;

  // Sparks
  private sparks: Spark[] = [];
  private sparkMesh: THREE.InstancedMesh;
  private tmp = new THREE.Color();
  private m4 = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    // Small glowing spheres (instanced), additive so overlaps brighten. Meshes rather than
    // point sprites: they render the same on every GPU.
    const mk = (count: number, additive: boolean) => {
      const m = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: additive, depthWrite: !additive, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: false });
      this.materials.push(m);
      const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), m, count);
      for (let i = 0; i < count; i++) mesh.setColorAt(i, new THREE.Color(0, 0, 0));
      mesh.count = 0;
      mesh.frustumCulled = false;
      mesh.renderOrder = 5;
      scene.add(mesh);
      return mesh;
    };
    // The tail glows (additive, fading out); sparks keep their colour and shrink away.
    this.comet = mk(COMET_POINTS, true);
    this.sparkMesh = mk(MAX_SPARKS, false);
  }

  /** Place instance i at p with radius r and colour c. */
  private put(mesh: THREE.InstancedMesh, i: number, p: THREE.Vector3, r: number, c: THREE.Color) {
    this.m4.compose(p, this.q, this.v.set(r, r, r));
    mesh.setMatrixAt(i, this.m4);
    mesh.setColorAt(i, c);
  }

  private commit(mesh: THREE.InstancedMesh, count: number) {
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }

  // ------------------------------------------------------------- events

  /**
   * A paddle contact. `pos`, `velOut` and `spinOut` in render (view) coordinates.
   * `perfect` = a perfectly timed stroke (gold sparks).
   */
  hit(pos: Vec3, velOut: Vec3, spinOut: Vec3, opts: { perfect?: boolean; serve?: boolean } = {}) {
    if (!this.enabled) return;
    const power = opts.serve ? hitPower(length(velOut)) * 0.4 : hitPower(length(velOut));
    if (this.allowHitStop && power > 0.35) this.hitStopLeft = Math.max(this.hitStopLeft, 0.025 + 0.05 * power);
    if (power > 0.3) this.kick(0.003 + 0.016 * power * power);
    if (power > 0.6) this.fovKick = Math.min(this.fovKick + 3.5 * power, 5);
    const base = opts.perfect ? new THREE.Color(1, 0.8, 0.25) : spinColor(velOut, spinOut, new THREE.Color());
    const n = Math.round((opts.perfect ? 26 : 8) + 46 * power);
    const dir = new THREE.Vector3(velOut.x, velOut.y, velOut.z).normalize();
    for (let i = 0; i < n; i++) {
      // A cone around the ball's direction, plus some scatter back toward the hitter.
      const spread = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(1.6);
      const v = dir.clone().multiplyScalar((Math.random() < 0.7 ? 1 : -0.4) * (1 + 3.5 * Math.random() * (0.4 + power))).add(spread);
      const c = base.clone().lerp(new THREE.Color(1, 1, 0.85), Math.random() * 0.35);
      this.spawn(pos, v, 0.18 + Math.random() * (0.2 + 0.25 * power), c);
    }
  }

  /** A table or floor bounce: a small puff for hard impacts. */
  bounce(pos: Vec3, impactSpeed: number) {
    if (!this.enabled || impactSpeed < 7) return;
    const n = Math.min(14, Math.round((impactSpeed - 6) * 1.5));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 0.4 + Math.random() * 0.9;
      this.spawn(pos, new THREE.Vector3(Math.cos(a) * r, 0.3 + Math.random() * 0.8, Math.sin(a) * r), 0.15 + Math.random() * 0.15, new THREE.Color(0.75, 0.8, 0.9));
    }
  }

  /** Add camera shake (metres of amplitude). */
  kick(amp: number) {
    if (!this.enabled) return;
    this.shakeAmp = Math.min(0.03, Math.max(this.shakeAmp, amp));
  }

  /** Forget the tail (a new rally or a new flight). */
  clearTail() {
    this.history = [];
    this.comet.count = 0;
  }

  // ------------------------------------------------------------- per frame

  /**
   * Factor for this frame's game time step: near zero during hit-stop, else 1.
   * Call once per frame with the real frame time.
   */
  gameScale(realDt: number): number {
    if (this.hitStopLeft <= 0) return 1;
    this.hitStopLeft -= realDt;
    return 0.04;
  }

  /** Advance effects and update the tail from the ball's drawn position. */
  update(realDt: number, ball: { pos: Vec3; state: BallState; visible: boolean } | null) {
    this.time += realDt;
    this.shakeTime += realDt;
    this.shakeAmp *= Math.exp(-realDt / 0.09);
    this.fovKick *= Math.exp(-realDt / 0.12);
    if (this.shakeAmp < 1e-4) this.shakeAmp = 0;
    const s = this.shakeAmp;
    const t = this.shakeTime * 60;
    this.offset.set(Math.sin(t * 1.7) * s, Math.sin(t * 2.3 + 1) * s * 0.7, Math.sin(t * 1.1 + 2) * s * 0.5);

    this.updateComet(ball);
    this.updateSparks(realDt);
  }

  /** Camera position offset (shake) for this frame. */
  get cameraOffset(): THREE.Vector3 {
    return this.enabled ? this.offset : this.offset.set(0, 0, 0);
  }

  /** FOV change for this frame (degrees, negative = zoom in). */
  get fovOffset(): number {
    return this.enabled ? -this.fovKick : 0;
  }

  private updateComet(ball: { pos: Vec3; state: BallState; visible: boolean } | null) {
    if (!this.enabled || !ball || !ball.visible) {
      this.history = [];
      this.comet.count = 0;
      return;
    }
    const p = new THREE.Vector3(ball.pos.x, ball.pos.y, ball.pos.z);
    const last = this.history[this.history.length - 1];
    // A jump (new flight, replay cut) restarts the tail.
    if (last && last.p.distanceTo(p) > 1.2) this.history = [];
    this.history.push({ p, t: this.time });
    while (this.history.length > 2 && this.time - this.history[1].t > COMET_SPAN) this.history.shift();

    const speed = length(ball.state.vel);
    const glow = Math.max(0, Math.min(1, (speed - 3) / 14));
    if (this.history.length < 2 || glow <= 0) {
      this.comet.count = 0;
      return;
    }
    const color = spinColor(ball.state.vel, ball.state.spin, this.tmp);
    // Resample the recent path evenly so fast balls draw a continuous streak.
    const pts = this.history.map((h) => h.p);
    const lens = [0];
    for (let i = 1; i < pts.length; i++) lens.push(lens[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = lens[lens.length - 1];
    if (total < 1e-4) {
      this.comet.count = 0;
      return;
    }
    let seg = 0;
    for (let k = 0; k < COMET_POINTS; k++) {
      const f = k / (COMET_POINTS - 1); // 0 = oldest, 1 = the ball
      const d = f * total;
      while (seg < lens.length - 2 && lens[seg + 1] < d) seg++;
      const span = lens[seg + 1] - lens[seg] || 1;
      const q = pts[seg].clone().lerp(pts[seg + 1], (d - lens[seg]) / span);
      // A tapered tail: thin and faint at the old end, ball-sized at the ball.
      const a = f * f * glow * 0.55;
      this.put(this.comet, k, q, 0.02 * (0.25 + 0.75 * f), new THREE.Color(color.r * a, color.g * a, color.b * a));
    }
    this.commit(this.comet, COMET_POINTS);
  }

  private spawn(pos: Vec3, vel: THREE.Vector3, life: number, color: THREE.Color) {
    if (this.sparks.length >= MAX_SPARKS) this.sparks.shift();
    this.sparks.push({ pos: new THREE.Vector3(pos.x, pos.y, pos.z), vel, life, maxLife: life, color });
  }

  private updateSparks(dt: number) {
    const alive: Spark[] = [];
    for (const s of this.sparks) {
      s.life -= dt;
      if (s.life <= 0) continue;
      s.vel.y -= 9.8 * dt;
      s.vel.multiplyScalar(Math.exp(-dt * 2.5));
      s.pos.addScaledVector(s.vel, dt);
      alive.push(s);
    }
    this.sparks = alive;
    alive.forEach((s, i) => {
      const a = s.life / s.maxLife;
      this.put(this.sparkMesh, i, s.pos, 0.009 * Math.sqrt(a), s.color);
    });
    this.commit(this.sparkMesh, alive.length);
  }
}
