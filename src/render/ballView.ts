import * as THREE from 'three';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { BALL, length, spinComponents, type BallState, type Vec3 } from '../physics';

/** The kind of spin a ball predominantly carries. */
export type SpinKind = 'top' | 'back' | 'side' | 'none';

/** Which colours show the spin: the standard set, or one safe for colour-blind players. */
export type SpinPalette = 'standard' | 'colourblind';

/**
 * Spin colours (sRGB hex). Standard: red topspin, green backspin, yellow sidespin.
 * Colour-blind safe (Okabe–Ito): vermillion topspin, sky-blue backspin, yellow sidespin;
 * they also differ in brightness, so they stay apart for red–green colour blindness.
 */
export const SPIN_PALETTES: Record<SpinPalette, Record<SpinKind, string>> = {
  standard: { top: '#ff2a1a', back: '#1fe04a', side: '#ffd400', none: '#d4d4d4' },
  colourblind: { top: '#d55e00', back: '#56b4e9', side: '#f0e442', none: '#d4d4d4' },
};

/** Below this (rps) a ball counts as no spin. */
const NO_SPIN = 8;

/**
 * The predominant spin: sidespin (side or corkscrew) when it outweighs the top/back
 * component, else topspin or backspin. `strength` 0–1 (full from 60 rps).
 */
export function spinKind(vel: Vec3, spin: Vec3): { kind: SpinKind; strength: number } {
  const c = spinComponents(vel, spin);
  const lateral = Math.hypot(c.side, c.cork);
  const total = Math.hypot(c.top, lateral);
  if (total < NO_SPIN) return { kind: 'none', strength: 0 };
  const kind: SpinKind = lateral > Math.abs(c.top) ? 'side' : c.top >= 0 ? 'top' : 'back';
  return { kind, strength: Math.min(1, total / 60) };
}

let palette: SpinPalette = 'standard';
let paletteColors = paletteToColors(palette);
function paletteToColors(p: SpinPalette): Record<SpinKind, THREE.Color> {
  const hex = SPIN_PALETTES[p];
  return { top: new THREE.Color(hex.top), back: new THREE.Color(hex.back), side: new THREE.Color(hex.side), none: new THREE.Color(hex.none) };
}

export function setSpinPalette(p: SpinPalette) {
  palette = p;
  paletteColors = paletteToColors(p);
}

export function spinPalette(): SpinPalette {
  return palette;
}

const GREY = new THREE.Color('#d4d4d4');

/**
 * Colour for a spin, from the palette: one clear colour per kind of spin (topspin,
 * backspin, sidespin), only a little paler when the spin is light.
 */
export function spinColor(vel: Vec3, spin: Vec3, out = new THREE.Color()): THREE.Color {
  const { kind, strength } = spinKind(vel, spin);
  out.copy(paletteColors[kind]);
  return kind === 'none' ? out : out.lerp(GREY, 0.4 * (1 - strength));
}

function ballTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fbfbf7';
  ctx.fillRect(0, 0, 256, 128);
  // A coloured band and "MEM" logos so the spin is readable in slow motion.
  ctx.fillStyle = '#e8562a';
  ctx.fillRect(0, 58, 256, 12);
  ctx.fillStyle = '#1b3f7a';
  ctx.font = 'bold 26px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('MEM', 64, 46);
  ctx.fillText('MEM', 192, 100);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const TRAIL_POINTS = 900;
/** Trail width on screen, pixels. */
const TRAIL_WIDTH = 3.5;

/**
 * The ball mesh, its spin-axis indicator and a colour-coded trail.
 * Orientation is integrated from the simulated angular velocity, so in slow
 * motion you see the real rotation.
 */
export class BallView {
  readonly mesh: THREE.Mesh;
  private axis: THREE.Line;
  private trail: LineSegments2;
  private trailMaterial: LineMaterial;
  private lastTrail = new Float32Array(3);
  private lastTrailColor = new Float32Array(3);
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailCount = 0;
  private tmpColor = new THREE.Color();
  showAxis = true;
  /** Speed streak: a faint tapered smear behind a fast ball (arcade effects). */
  private streak: THREE.Mesh;
  streakEnabled = true;
  /** Playback rate (slow motion), so the streak follows how fast the ball looks. */
  playRate = 1;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 32, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 }));
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]);
    this.axis = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    scene.add(this.axis);

    // A wide (screen-space) line so the spin colour reads at a glance. Segments are written
    // into fixed buffers as the ball flies; instanceCount sets how many are drawn.
    const g = new LineSegmentsGeometry();
    g.setPositions(new Float32Array((TRAIL_POINTS - 1) * 6));
    g.setColors(new Float32Array((TRAIL_POINTS - 1) * 6));
    this.trailPositions = (g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.array as Float32Array;
    this.trailColors = (g.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.array as Float32Array;
    g.instanceCount = 0;
    this.trailMaterial = new LineMaterial({ vertexColors: true, linewidth: TRAIL_WIDTH, transparent: true, opacity: 0.95, worldUnits: false });
    this.trail = new LineSegments2(g, this.trailMaterial);
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    // Unit-length cone from the ball's centre backwards (−y), aligned to the velocity each frame.
    this.streak = new THREE.Mesh(
      new THREE.CylinderGeometry(BALL.radius * 0.9, 0.002, 1, 14, 1, true).translate(0, -0.5, 0),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
    );
    this.streak.visible = false;
    this.streak.frustumCulled = false;
    scene.add(this.streak);
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
    if (!v) this.streak.visible = false;
    this.axis.visible = v && this.showAxis;
  }

  set trailVisible(v: boolean) {
    this.trail.visible = v;
  }

  clearTrail() {
    this.trailCount = 0;
    this.trail.geometry.instanceCount = 0;
  }

  /** Advance the visual orientation by the simulated spin over dt seconds. */
  rotate(spin: Vec3, dt: number) {
    const w = length(spin);
    if (w < 1e-6) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(spin.x / w, spin.y / w, spin.z / w), w * dt);
    this.mesh.quaternion.premultiply(q);
  }

  /** What was drawn last (for replays). */
  last: { pos: Vec3; state: BallState } | null = null;

  get isVisible() {
    return this.mesh.visible;
  }

  update(pos: Vec3, state: BallState) {
    this.last = { pos, state };
    this.mesh.position.set(pos.x, pos.y, pos.z);

    // Speed streak: from ~10 m/s as seen, longer and brighter with speed.
    const v = length(state.vel);
    const k = Math.max(0, Math.min(1, (v * this.playRate - 10) / 18));
    this.streak.visible = this.streakEnabled && this.mesh.visible && k > 0 && v > 1e-3;
    if (this.streak.visible) {
      this.streak.position.set(pos.x, pos.y, pos.z);
      this.streak.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(state.vel.x / v, state.vel.y / v, state.vel.z / v));
      this.streak.scale.set(1, 0.06 + 0.32 * k, 1);
      (this.streak.material as THREE.MeshBasicMaterial).opacity = 0.12 + 0.3 * k;
    }

    const w = length(state.spin);
    this.axis.visible = this.mesh.visible && this.showAxis && w > 30;
    if (this.axis.visible) {
      // Axis line length scales with spin rate (max ~6 cm each side).
      const len = BALL.radius + Math.min(1, w / 900) * 0.05;
      this.axis.position.copy(this.mesh.position);
      this.axis.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(state.spin.x / w, state.spin.y / w, state.spin.z / w));
      this.axis.scale.setScalar(len);
      (this.axis.material as THREE.LineBasicMaterial).color.copy(spinColor(state.vel, state.spin, this.tmpColor));
    }

    if (this.trailCount < TRAIL_POINTS) {
      const col = spinColor(state.vel, state.spin, this.tmpColor);
      if (this.trailCount > 0) {
        // Segment from the previous point to this one: [start xyz, end xyz].
        const i = (this.trailCount - 1) * 6;
        const P = this.trailPositions;
        const C = this.trailColors;
        P.set(this.lastTrail, i);
        P[i + 3] = pos.x;
        P[i + 4] = pos.y;
        P[i + 5] = pos.z;
        C.set(this.lastTrailColor, i);
        C[i + 3] = col.r;
        C[i + 4] = col.g;
        C[i + 5] = col.b;
        const g = this.trail.geometry;
        g.instanceCount = this.trailCount;
        (g.attributes.instanceStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
        (g.attributes.instanceColorStart as THREE.InterleavedBufferAttribute).data.needsUpdate = true;
      }
      this.lastTrail[0] = pos.x;
      this.lastTrail[1] = pos.y;
      this.lastTrail[2] = pos.z;
      this.lastTrailColor[0] = col.r;
      this.lastTrailColor[1] = col.g;
      this.lastTrailColor[2] = col.b;
      this.trailCount++;
    }
  }

  /** The wide trail is sized in screen pixels: call when the canvas size changes. */
  setResolution(width: number, height: number) {
    this.trailMaterial.resolution.set(width, height);
  }
}
