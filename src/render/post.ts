import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';

/**
 * Ambient occlusion that only solid things cast: see-through and additive meshes (the
 * net's mesh, the comet tail, sparks, the aiming ring, a see-through partner) are left
 * out of its depth and normals, so they don't leave dark halos.
 */
class SolidAO extends GTAOPass {
  _overrideVisibility() {
    const cache = (this as unknown as { _visibilityCache: THREE.Object3D[] })._visibilityCache;
    this.scene.traverse((o) => {
      if (!o.visible) return;
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      const seeThrough = !!mat && (Array.isArray(mat) ? mat.some((m) => m.transparent) : mat.transparent);
      if ((o as THREE.Points).isPoints || (o as THREE.Line).isLine || (o as unknown as { isLine2?: boolean }).isLine2 || seeThrough || o.userData.noAO) {
        o.visible = false;
        cache.push(o);
      }
    });
  }
}

/**
 * Post-processing for High quality:
 * - Ambient occlusion: soft contact darkening where things meet (under the table, round
 *   the legs and feet, in the corners of a room), so objects sit on the floor instead
 *   of floating in flat light.
 * - A soft bloom on the brightest things only (the comet tail, sparks, the PERFECT
 *   burst, LEDs, string lights and lamps).
 * The scene renders into a multisampled HDR target, so edges stay anti-aliased and the
 * bloom sees values above 1; the output pass then tone-maps as usual.
 */
export class PostFx {
  private composer: EffectComposer | null = null;
  private bloomPass: UnrealBloomPass | null = null;
  private aoPass: SolidAO | null = null;
  /** Glow on the brightest things. */
  bloom = false;
  /** Ambient occlusion. */
  ao = false;
  /** How dark the occlusion gets (venues outdoors want less: the sky lights everything). */
  aoStrength = 1;
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  /** Old name for "any post-processing at all". */
  get enabled() {
    return this.bloom || this.ao;
  }

  private build() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // AO at half resolution (it's soft anyway), denoised. Radius in metres: big enough to
    // darken the floor under the table (76 cm below its top), small enough not to grey whole walls.
    this.aoPass = new SolidAO(this.scene, this.camera, 256, 256);
    this.aoPass.updateGtaoMaterial({ radius: 0.9, distanceExponent: 1, thickness: 2, scale: 1.6, samples: 16, distanceFallOff: 1 });
    this.aoPass.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2 });
    composer.addPass(this.aoPass);
    // Strength, radius, threshold (linear, before tone mapping).
    this.bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.75);
    composer.addPass(this.bloomPass);
    composer.addPass(new OutputPass());
    this.composer = composer;
    this.apply();
  }

  setSize(width: number, height: number, pixelRatio: number) {
    this.size.set(width, height);
    this.pixelRatio = pixelRatio;
    this.apply();
  }

  private apply() {
    if (!this.composer) return;
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(this.size.x, this.size.y);
    // The AO buffers at half the drawing size.
    const pr = this.pixelRatio * 0.5;
    this.aoPass?.setSize(Math.max(1, Math.round(this.size.x * pr)), Math.max(1, Math.round(this.size.y * pr)));
  }

  /** Draw a frame: through the effects chain when any is on, otherwise straight to the screen. */
  render() {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.composer) this.build();
    this.aoPass!.enabled = this.ao;
    this.aoPass!.blendIntensity = this.aoStrength;
    this.bloomPass!.enabled = this.bloom;
    this.composer!.render();
  }

  dispose() {
    this.composer?.dispose();
    this.bloomPass?.dispose();
    this.aoPass?.dispose();
    this.composer = null;
    this.bloomPass = null;
    this.aoPass = null;
  }
}
