import * as THREE from 'three';
import { STYLES, type StyleId } from '../../game/styles';
import type { Fabric } from '../fabric';
import { MaterialKit, dressBody } from './body';
import { LOOKS, type Look } from './looks';
import { AvatarRig, type PoseInput, type Reaction } from './rig';
import { skinize } from './skin';
import { withDetail, type Detail } from './detail';
import { PONYTAIL_TIE } from './hair';

/**
 * A player character: a rig (rig.ts: the joints and the procedural animation that poses
 * them) dressed in a body (body.ts, head.ts) from the character's look (looks.ts).
 *
 * The racket arm is a two-bone chain (shoulder, elbow, hand) solved each frame to hold
 * the paddle handle. Bryony plays seated in a table tennis wheelchair: the upper body sits
 * lower and the legs rest on the footplate.
 */

export { AVATAR_STYLES } from './looks';
export type { PoseInput, Reaction } from './rig';
export type { Detail } from './detail';

export class Avatar {
  readonly group: THREE.Group;
  /** The joints and their animation (for tools and tests; the game only calls update). */
  readonly rig: AvatarRig;
  private materials: THREE.MeshStandardMaterial[];
  private skeleton: THREE.Skeleton;
  private firstPerson = false;
  /** Soft shadows under each foot (standing characters), and their own see-through level. */
  private footShadows: THREE.Mesh[] = [];
  private shadowOpacity = 1;

  /**
   * @param variant which outfit from a wardrobe (characters with several shirts); random if left out.
   * @param detail how detailed to build it (2 High, 1 Medium, 0 Low quality; see detail.ts).
   */
  constructor(style: StyleId, opacity = 1, variant?: number, detail: Detail = 2) {
    // Everything built here reads the level of detail.
    const built = withDetail(detail, () => this.build(style, opacity, variant));
    this.group = built.group;
    this.rig = built.rig;
    this.skeleton = built.skeleton;
    this.materials = built.materials;
    this.shadowOpacity = opacity;
    if (!this.rig.seated) this.addFootShadows();
  }

  private build(style: StyleId, opacity: number, variant?: number) {
    const base = LOOKS[style];
    let fabric: Fabric | undefined;
    if (Array.isArray(base.fabric)) {
      const n = base.fabric.length;
      fabric = base.fabric[(((variant ?? Math.floor(Math.random() * n)) % n) + n) % n];
    } else fabric = base.fabric;
    const look: Look = { ...base, fabric, shirt: fabric?.base ?? base.shirt };
    const rig = new AvatarRig({
      build: look.build ?? 1,
      seated: look.wheelchair !== undefined,
      batHand: STYLES[style].leftHanded ? -1 : 1,
      ponytail: look.hairStyle?.ponytail ? PONYTAIL_TIE : undefined,
    });
    const group = rig.group;
    const kit = new MaterialKit(
      {
        skin: look.skin,
        hair: [look.hair, ...(look.beard !== undefined ? [look.beard] : [])],
        cloth: [look.shirt, look.legs.color, ...(typeof look.sleeves === 'number' ? [look.sleeves] : []), ...(look.cap ? [look.cap.color] : [])],
      },
      opacity,
    );
    dressBody(rig, look, fabric, kit);
    group.traverse((o) => {
      o.castShadow = kit.solid;
    });
    // The body becomes skinned meshes (one per material) on the rig's skeleton.
    const skeleton = skinize(rig, kit.solid).skeleton;
    rig.rest();
    group.scale.setScalar(look.height ?? 1);
    return { group, rig, skeleton, materials: kit.list };
  }

  /**
   * Contact shadows: a soft dark patch on the floor under each foot, fading and shrinking
   * as the foot lifts. Drawn with vertex alpha (darkest in the middle), so they need no texture.
   */
  private addFootShadows() {
    for (let i = 0; i < 2; i++) {
      const geo = new THREE.CircleGeometry(0.11, 20).rotateX(-Math.PI / 2);
      geo.scale(0.62, 1, 1.25); // longer than wide, like a foot
      const n = geo.getAttribute('position').count;
      const col = new Float32Array(n * 4);
      for (let k = 0; k < n; k++) col.set([0, 0, 0, k === 0 ? 0.5 : 0], k * 4);
      geo.setAttribute('color', new THREE.BufferAttribute(col, 4));
      const m = new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      const mesh = new THREE.Mesh(geo, m);
      mesh.renderOrder = -1;
      mesh.frustumCulled = false;
      this.group.add(mesh);
      this.footShadows.push(mesh);
    }
  }

  private placeFootShadows() {
    if (!this.footShadows.length) return;
    const p = new THREE.Vector3();
    this.rig.legs.forEach((leg, i) => {
      const sh = this.footShadows[i];
      leg.foot.getWorldPosition(p);
      this.group.worldToLocal(p);
      // How high the ankle is off its standing height (m, in the character's frame).
      const up = Math.max(0, p.y - 0.04);
      const k = Math.max(0, 1 - up / 0.12);
      // Under the ball of the foot, a little ahead of the ankle, along the foot.
      const yaw = new THREE.Euler().setFromQuaternion(leg.foot.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.group.getWorldQuaternion(new THREE.Quaternion()).invert()), 'YXZ').y;
      sh.position.set(p.x - Math.sin(yaw) * 0.06, 0.002, p.z - Math.cos(yaw) * 0.06);
      sh.rotation.y = yaw;
      sh.scale.setScalar(0.7 + 0.3 * k);
      (sh.material as THREE.MeshBasicMaterial).opacity = this.shadowOpacity * k;
    });
  }

  /**
   * Place the character. body: floor position; hand: world position of the paddle
   * handle; facingNegZ: true for a player at the near end looking down the table;
   * input: the clock and what to look at (see PoseInput).
   */
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean, input?: PoseInput) {
    this.rig.update(body, hand, facingNegZ, input);
    this.group.updateMatrixWorld(true);
    this.placeFootShadows();
  }

  /** Stand (or sit) still in the rest pose: arms a little out, head level (see AvatarRig.rest). */
  restPose() {
    this.rig.rest();
    this.group.updateMatrixWorld(true);
    this.placeFootShadows();
  }

  /** Play a short reaction to a point: a jump and fist pump, or a slump. */
  react(kind: Reaction) {
    this.rig.react(kind);
  }

  set visible(v: boolean) {
    this.group.visible = v;
  }

  /** Fade the whole character (for see-through drawing; needs a character made with opacity < 1). */
  setOpacity(o: number) {
    for (const m of this.materials) m.opacity = o;
    this.shadowOpacity = o;
    for (const s of this.footShadows) (s.material as THREE.MeshBasicMaterial).opacity = o;
    this.group.visible = o > 0.02 && !this.firstPerson;
  }

  /** First person: nothing of the body is drawn, only the paddle (handled by the player view). */
  setFirstPerson(on: boolean) {
    this.firstPerson = on;
    // From the play camera (behind and below head height) the body would sit between you and the table.
    this.group.visible = !on;
  }

  dispose() {
    this.group.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
    this.materials.forEach((m) => m.dispose());
    this.footShadows.forEach((s) => (s.material as THREE.Material).dispose());
    this.skeleton.dispose();
  }
}
