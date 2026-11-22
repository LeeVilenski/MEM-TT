import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AvatarRig } from './rig';

/**
 * Skinning: the body is built as ordinary meshes hung on the rig's bones (easy to place
 * and reason about), then baked into skinned meshes, one per material, bound to the
 * skeleton in the bind pose. A mesh goes wholly with the bone it hangs on, unless it
 * carries blend weights (see `blend`): then each point is shared between bones, so a
 * limb bends smoothly at the knee or elbow and the shirt bends at the waist.
 */

/** Bones and their shares (they needn't add up to 1: they're normalised) for a point in the mesh's own frame. */
export type Weights = (p: THREE.Vector3) => [THREE.Bone, number][];

/** Give a mesh blend weights for skinning, instead of going wholly with its bone. */
export function blend<T extends THREE.Mesh>(mesh: T, weights: Weights): T {
  mesh.userData.weights = weights;
  return mesh;
}

/** 0 below `a`, 1 above `b`, smooth in between. */
export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const boneOf = (o: THREE.Object3D): THREE.Bone | null => {
  for (let p = o.parent; p; p = p.parent) if ((p as THREE.Bone).isBone) return p as THREE.Bone;
  return null;
};

/**
 * Bake every mesh on the rig's bones into skinned meshes (one per material and draw
 * order), added to the rig's group and bound in the bind pose (standing, straight legs,
 * arms a little out). Meshes not on a bone (the wheelchair) are left as they are.
 * Returns the skinned meshes and their shared skeleton.
 */
export function skinize(rig: AvatarRig, castShadow: boolean) {
  rig.rest({ standing: true });
  const root = rig.group;
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const bones = rig.bones();
  const index = new Map(bones.map((b, i) => [b, i]));

  const found: { mesh: THREE.Mesh; bone: THREE.Bone }[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    const bone = boneOf(m);
    if (bone) found.push({ mesh: m, bone });
  });

  const groups = new Map<string, { material: THREE.Material; renderOrder: number; parts: THREE.BufferGeometry[] }>();
  const p = new THREE.Vector3();
  for (const { mesh, bone } of found) {
    const material = mesh.material as THREE.Material;
    let geo = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry.clone();
    // Keep what the materials use (vertex colours only where a material wants them).
    const keepColor = (material as THREE.MeshStandardMaterial).vertexColors;
    for (const name of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', ...(keepColor ? ['color'] : [])].includes(name)) geo.deleteAttribute(name);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const pos = geo.getAttribute('position');
    if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(pos.count * 2), 2));
    // Weights, from each point in the mesh's own frame.
    const skinIndex = new Uint16Array(pos.count * 4);
    const skinWeight = new Float32Array(pos.count * 4);
    const weights = mesh.userData.weights as Weights | undefined;
    for (let i = 0; i < pos.count; i++) {
      let w: [THREE.Bone, number][] = weights ? weights(p.fromBufferAttribute(pos, i)).filter(([, v]) => v > 1e-4) : [[bone, 1]];
      if (!w.length) w = [[bone, 1]];
      w.sort((a, b) => b[1] - a[1]);
      w = w.slice(0, 4);
      const sum = w.reduce((s, [, v]) => s + v, 0);
      w.forEach(([b, v], k) => {
        const bi = index.get(b);
        if (bi === undefined) throw new Error(`skin: ${b.name || 'a bone'} is not in the rig`);
        skinIndex[i * 4 + k] = bi;
        skinWeight[i * 4 + k] = v / sum;
      });
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
    // Into the bind pose, in the root's frame.
    const m = toRoot.clone().multiply(mesh.matrixWorld);
    geo.applyMatrix4(m);
    if (m.determinant() < 0) flipWinding(geo); // a mirrored piece (a left hand)
    const key = `${material.uuid}:${mesh.renderOrder}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { material, renderOrder: mesh.renderOrder, parts: [] }));
    g.parts.push(geo);
  }
  // The originals go (and anything hung on them, already collected).
  for (const { mesh } of found) mesh.parent?.remove(mesh);
  for (const { mesh } of found) mesh.geometry.dispose();

  const skeleton = new THREE.Skeleton(bones);
  const meshes: THREE.SkinnedMesh[] = [];
  for (const g of groups.values()) {
    const geo = mergeGeometries(g.parts);
    g.parts.forEach((part) => part.dispose());
    if (!geo) throw new Error('skin: pieces did not merge');
    const sm = new THREE.SkinnedMesh(geo, g.material);
    sm.renderOrder = g.renderOrder;
    sm.castShadow = castShadow;
    // The bounds are of the bind pose; a pose can reach outside them.
    sm.frustumCulled = false;
    root.add(sm);
    sm.bind(skeleton, new THREE.Matrix4());
    meshes.push(sm);
  }
  return { meshes, skeleton };
}

/** Reverse each triangle's winding (non-indexed geometry), so a mirrored piece faces out. */
function flipWinding(geo: THREE.BufferGeometry) {
  for (const name of Object.keys(geo.attributes)) {
    const a = geo.getAttribute(name) as THREE.BufferAttribute;
    const n = a.itemSize;
    const arr = a.array as Float32Array;
    for (let t = 0; t < a.count; t += 3) {
      for (let k = 0; k < n; k++) {
        const i1 = (t + 1) * n + k;
        const i2 = (t + 2) * n + k;
        const tmp = arr[i1];
        arr[i1] = arr[i2];
        arr[i2] = tmp;
      }
    }
    a.needsUpdate = true;
  }
}
