import * as THREE from 'three';
import { STYLES, type StyleId } from '../../game/styles';
import type { Fabric } from '../fabric';
import { MaterialKit, dressBody } from './body';
import { LOOKS, type Look } from './looks';
import { AvatarRig, type PoseInput, type Reaction } from './rig';
import { skinize } from './skin';

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

export class Avatar {
  readonly group: THREE.Group;
  /** The joints and their animation (for tools and tests; the game only calls update). */
  readonly rig: AvatarRig;
  private materials: THREE.MeshStandardMaterial[];
  private skeleton: THREE.Skeleton;
  private firstPerson = false;

  /**
   * @param variant which outfit from a wardrobe (characters with several shirts); random if left out.
   */
  constructor(style: StyleId, opacity = 1, variant?: number) {
    const base = LOOKS[style];
    let fabric: Fabric | undefined;
    if (Array.isArray(base.fabric)) {
      const n = base.fabric.length;
      fabric = base.fabric[(((variant ?? Math.floor(Math.random() * n)) % n) + n) % n];
    } else fabric = base.fabric;
    const look: Look = { ...base, fabric, shirt: fabric?.base ?? base.shirt };
    this.rig = new AvatarRig({ build: look.build ?? 1, seated: look.wheelchair !== undefined, batHand: STYLES[style].leftHanded ? -1 : 1 });
    this.group = this.rig.group;
    const kit = new MaterialKit(
      {
        skin: look.skin,
        hair: [look.hair, ...(look.beard !== undefined ? [look.beard] : [])],
        cloth: [look.shirt, look.legs.color, ...(typeof look.sleeves === 'number' ? [look.sleeves] : []), ...(look.cap ? [look.cap.color] : [])],
      },
      opacity,
    );
    dressBody(this.rig, look, fabric, kit);
    this.group.traverse((o) => {
      o.castShadow = kit.solid;
    });
    // The body becomes skinned meshes (one per material) on the rig's skeleton.
    this.skeleton = skinize(this.rig, kit.solid).skeleton;
    this.materials = kit.list;
    this.rig.rest();
    this.group.scale.setScalar(look.height ?? 1);
  }

  /**
   * Place the character. body: floor position; hand: world position of the paddle
   * handle; facingNegZ: true for a player at the near end looking down the table;
   * input: the clock and what to look at (see PoseInput).
   */
  update(body: { x: number; z: number }, hand: THREE.Vector3, facingNegZ: boolean, input?: PoseInput) {
    this.rig.update(body, hand, facingNegZ, input);
  }

  /** Stand (or sit) still in the rest pose: arms a little out, head level (see AvatarRig.rest). */
  restPose() {
    this.rig.rest();
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
    this.skeleton.dispose();
  }
}
