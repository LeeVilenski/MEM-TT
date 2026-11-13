import * as THREE from 'three';
import { BALL, length, spinComponents, type BallState, type Vec3 } from '../physics';

/** Colour for a spin: warm for topspin, cool for backspin, green tint for side/corkscrew. */
export function spinColor(vel: Vec3, spin: Vec3, out = new THREE.Color()): THREE.Color {
  const c = spinComponents(vel, spin);
  const lateral = Math.hypot(c.side, c.cork);
  const total = Math.hypot(c.top, lateral);
  if (total < 8) return out.setRGB(0.85, 0.85, 0.85);
  const strength = Math.min(1, total / 140);
  const base = c.top >= 0 ? new THREE.Color(1.0, 0.45, 0.1) : new THREE.Color(0.2, 0.55, 1.0);
  const side = new THREE.Color(0.25, 1.0, 0.45);
  out.copy(base).lerp(side, lateral / (Math.abs(c.top) + lateral));
  return out.lerp(new THREE.Color(0.9, 0.9, 0.9), 1 - (0.35 + 0.65 * strength));
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

/**
 * The ball mesh, its spin-axis indicator and a colour-coded trail.
 * Orientation is integrated from the simulated angular velocity, so in slow
 * motion you see the real rotation.
 */
export class BallView {
  readonly mesh: THREE.Mesh;
  private axis: THREE.Line;
  private trail: THREE.Line;
  private trailPositions: Float32Array;
  private trailColors: Float32Array;
  private trailCount = 0;
  private tmpColor = new THREE.Color();
  showAxis = true;

  constructor(scene: THREE.Scene) {
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(BALL.radius, 32, 16), new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35 }));
    this.mesh.castShadow = true;
    scene.add(this.mesh);

    const axisGeo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 1, 0)]);
    this.axis = new THREE.Line(axisGeo, new THREE.LineBasicMaterial({ color: 0xffffff }));
    scene.add(this.axis);

    this.trailPositions = new Float32Array(TRAIL_POINTS * 3);
    this.trailColors = new Float32Array(TRAIL_POINTS * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.trailPositions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.trailColors, 3));
    g.setDrawRange(0, 0);
    this.trail = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9 }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);
  }

  set visible(v: boolean) {
    this.mesh.visible = v;
    this.axis.visible = v && this.showAxis;
  }

  set trailVisible(v: boolean) {
    this.trail.visible = v;
  }

  clearTrail() {
    this.trailCount = 0;
    this.trail.geometry.setDrawRange(0, 0);
  }

  /** Advance the visual orientation by the simulated spin over dt seconds. */
  rotate(spin: Vec3, dt: number) {
    const w = length(spin);
    if (w < 1e-6) return;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(spin.x / w, spin.y / w, spin.z / w), w * dt);
    this.mesh.quaternion.premultiply(q);
  }

  update(pos: Vec3, state: BallState) {
    this.mesh.position.set(pos.x, pos.y, pos.z);

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
      const i = this.trailCount * 3;
      this.trailPositions[i] = pos.x;
      this.trailPositions[i + 1] = pos.y;
      this.trailPositions[i + 2] = pos.z;
      const col = spinColor(state.vel, state.spin, this.tmpColor);
      this.trailColors[i] = col.r;
      this.trailColors[i + 1] = col.g;
      this.trailColors[i + 2] = col.b;
      this.trailCount++;
      const g = this.trail.geometry;
      g.setDrawRange(0, this.trailCount);
      g.attributes.position.needsUpdate = true;
      g.attributes.color.needsUpdate = true;
    }
  }
}
