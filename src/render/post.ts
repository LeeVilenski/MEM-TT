import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/**
 * Post-processing for High quality: a soft bloom on the brightest things only
 * (the comet tail, sparks, the PERFECT burst, LEDs, string lights and lamps).
 * The scene renders into a multisampled HDR target, so edges stay anti-aliased
 * and the bloom sees values above 1; the output pass then tone-maps as usual.
 */
export class PostFx {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  enabled = false;
  private size = new THREE.Vector2(1, 1);
  private pixelRatio = 1;

  constructor(
    private renderer: THREE.WebGLRenderer,
    private scene: THREE.Scene,
    private camera: THREE.Camera,
  ) {}

  private build() {
    const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
    const composer = new EffectComposer(this.renderer, target);
    composer.addPass(new RenderPass(this.scene, this.camera));
    // Strength, radius, threshold (linear, before tone mapping).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.5, 0.5, 1.75);
    composer.addPass(this.bloom);
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
  }

  /** Draw a frame: through the bloom chain when enabled, otherwise straight to the screen. */
  render() {
    if (!this.enabled) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    if (!this.composer) this.build();
    this.composer!.render();
  }

  dispose() {
    this.composer?.dispose();
    this.bloom?.dispose();
    this.composer = null;
    this.bloom = null;
  }
}
