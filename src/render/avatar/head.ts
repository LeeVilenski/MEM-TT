import * as THREE from 'three';
import { paint } from '../fabric';
import type { MaterialKit } from './body';
import { EYE, HEAD_PIVOT, HEAD_Y } from './dimensions';
import { FACE_UV, HEAD_W, beardMask, eyeTexture, frontZ, layout, noseGeometry, paintFace, sculptHead, shell } from './face';
import type { Look } from './looks';

/**
 * The procedural head: skull and jaw, eyes, brows, nose, mouth, painted stubble and
 * blush, hair, beard, glasses and cap, from the look's face settings.
 *
 * Head contract (for any head, procedural or made in Blender): everything on the head
 * hangs from the rig's `head` joint, whose origin is the top of the neck (HEAD_PIVOT on
 * the standing body), in metres, +y up, the face toward −z. The joint turns and nods
 * the whole head. See docs/avatar-heads.md.
 */

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Build the head on the `head` joint. Returns the inner group (positioned so its
 * children use heights on the standing body), for extra hair pieces.
 */
/** How much narrower the sculpted head is than the old round one (for the hair and cap made to fit it). */
const NARROW = HEAD_W / 0.094;

export function dressHead(joint: THREE.Object3D, eyes: THREE.Object3D[], look: Look, kit: MaterialKit): THREE.Group {
  // Built at heights on the standing body: an inner group cancels the joint's offset.
  const abs = new THREE.Group();
  abs.position.copy(HEAD_PIVOT).negate();
  joint.add(abs);
  const add = (geo: THREE.BufferGeometry, color: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, kit.mat(color));
    m.position.set(x, y, z);
    abs.add(m);
    return m;
  };
  const decal = kit.decal;
  /** On an eye joint (left s = −1, right s = 1), at a height on the standing body: turns with the eye. */
  const addEye = (geo: THREE.BufferGeometry, color: number, s: number, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geo, kit.mat(color));
    m.position.set(x - s * EYE.x, y - EYE.y, z - EYE.z);
    eyes[s < 0 ? 0 : 1].add(m);
    return m;
  };
  const HY = HEAD_Y;
  const f = look.face ?? {};
  const long = f.long ?? 1;
  const L = layout(f);
  // The sculpted head (skull, jaw and face as one mesh), its face painted on. The nose,
  // ears and lids share the painted skin, so their colour matches it exactly.
  const faceTex = paintFace(L, f, look.skin, f.brows ?? look.hair, look.beard);
  const skinMat = faceTex ? kit.skinTex(faceTex) : kit.mat(look.skin);
  const onFace = (geo: THREE.BufferGeometry, x: number, y: number, z: number) => {
    // Face texture coordinates from where each point ends up on the head.
    const pos = geo.getAttribute('position');
    const uv = new Float32Array(pos.count * 2);
    const m = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      m.fromBufferAttribute(pos, i);
      uv[i * 2] = (m.x + x - FACE_UV.x0) / (FACE_UV.x1 - FACE_UV.x0);
      uv[i * 2 + 1] = (m.y + y - HY - FACE_UV.y0) / (FACE_UV.y1 - FACE_UV.y0);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    const mesh = add(geo, look.skin, x, y, z);
    mesh.material = skinMat;
    return mesh;
  };
  const headGeo = sculptHead(L);
  onFace(headGeo.clone(), 0, HY, 0);
  onFace(noseGeometry(L), 0, HY, 0);
  const eyeTex = eyeTexture(f.eyes ?? 0x5a4130);
  const eyeMat = eyeTex ? kit.own({ map: eyeTex, roughness: 0.16 }) : kit.mat(0xf2eee8);
  for (const s of [-1, 1]) {
    // Ears: flattened, set back a little and angled forward, with a hollow.
    const ear = onFace(new THREE.SphereGeometry(0.026, 14, 10), s * (HEAD_W - 0.001), HY - 0.006, 0.012);
    ear.scale.set(0.34, 1, 0.68);
    ear.rotation.y = -s * 0.35;
    const hollow = add(new THREE.SphereGeometry(0.016, 10, 8), new THREE.Color(look.skin).multiplyScalar(0.78).getHex(), s * (HEAD_W + 0.006), HY - 0.004, 0.01);
    hollow.scale.set(0.25, 1, 0.62);
    hollow.rotation.y = -s * 0.35;
    // The eyeball (turns with its eye joint), under an upper and a lower lid.
    const ex = s * EYE.x;
    const ball = addEye(new THREE.SphereGeometry(0.0118, 24, 16), 0xf2eee8, s, ex, EYE.y, EYE.z);
    ball.material = eyeMat;
    const R = 0.0127;
    const front = Math.PI * 1.5; // the sphere's −z, as SphereGeometry's phi
    const lid = onFace(new THREE.SphereGeometry(R, 22, 8, front - 1.35, 2.7, 0, 1.22), ex, EYE.y, EYE.z);
    lid.rotation.z = s * 0.06;
    onFace(new THREE.SphereGeometry(R * 0.985, 22, 4, front - 1.2, 2.4, 2.02, 0.5), ex, EYE.y, EYE.z);
    // The lash line along the upper lid's edge.
    const lash = add(
      new THREE.TorusGeometry(R * Math.sin(1.22), 0.00085, 4, 22, 2.7)
        .rotateX(Math.PI / 2)
        .rotateY(1.35 + Math.PI / 2),
      0x2a1d17,
      ex,
      EYE.y + R * Math.cos(1.22),
      EYE.z,
    );
    lash.rotation.z = s * 0.06;
    // A catchlight: stays put (a reflection), so the eye moves under it.
    add(new THREE.SphereGeometry(0.0013, 6, 4), 0xffffff, ex + 0.003, EYE.y + 0.0035, EYE.z - 0.0117);
  }
  // A full beard: a layer grown out of the lower face, thinning to nothing at its edges
  // (where the face under it is painted the beard's colour).
  if (look.beard !== undefined) {
    const grows = beardMask(L);
    const beard = add(shell(headGeo, (q) => grows(q.x, q.y, q.z), 0.0075, { fade: true }), look.beard, 0, HY, 0);
    beard.material = kit.hairFade(look.beard);
  }


  // Hair (sides and back show under a cap); greying temples fade in towards the bottom.
  const hair = add(new THREE.SphereGeometry(0.106, 22, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), look.hair, 0, HY + 0.008, 0.01);
  hair.scale.set(0.97 * NARROW, 1.1 * long, 1.04);
  hair.rotation.x = 0.2;
  if (f.temples !== undefined) {
    const top = new THREE.Color(look.hair);
    const side = new THREE.Color(f.temples);
    const tex = paint(`hair:${look.hair}:${f.temples}`, (p) => {
      const g = p.c.createLinearGradient(0, 0, 0, p.h);
      g.addColorStop(0, `#${top.getHexString()}`);
      g.addColorStop(0.72, `#${top.getHexString()}`);
      g.addColorStop(0.95, `#${side.getHexString()}`);
      p.c.fillStyle = g;
      p.c.fillRect(0, 0, p.w, p.h);
    }, 16, 64);
    // The strands over the greying: the colour from the gradient, the bumps from the hair material.
    const m = tex && (decal(tex) as THREE.MeshStandardMaterial | null);
    if (m) {
      m.transparent = !kit.solid;
      m.depthWrite = kit.solid;
      m.roughness = 0.62;
      m.bumpMap = (kit.mat(look.hair) as THREE.MeshStandardMaterial).bumpMap;
      m.bumpScale = 1.2;
      hair.material = m;
    }
  }
  if (f.spiky) {
    // Short spikes, swept up at the front.
    for (let i = 0; i < 16; i++) {
      const phi = -Math.PI / 2 + (i - 7.5) * 0.36;
      const th = 0.25 + (i % 3) * 0.17;
      const n = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      const spike = add(new THREE.ConeGeometry(0.015, 0.03, 6), look.hair, n.x * 0.1 * NARROW, HY + 0.012 + n.y * 0.112 * long, 0.006 + n.z * 0.104);
      spike.quaternion.setFromUnitVectors(Y_AXIS, n.add(new THREE.Vector3(0, 0.9, -0.15)).normalize());
    }
  }
  if (look.glasses !== undefined) {
    const c = look.glasses;
    // Just in front of the face (clear of the nose bridge and brows).
    const z = Math.min(frontZ(L, 0, L.eyeY + 0.008), frontZ(L, 0.034, L.browY - 0.006)) - 0.005;
    const y = HY + 0.012;
    if (f.aviators) {
      // Aviators: teardrop lenses, a thin metal rim, a double bridge.
      const drop = new THREE.Shape();
      drop.moveTo(-0.021, 0.013);
      drop.quadraticCurveTo(0, 0.019, 0.023, 0.013);
      drop.quadraticCurveTo(0.028, -0.006, 0.012, -0.019);
      drop.quadraticCurveTo(-0.006, -0.025, -0.017, -0.011);
      drop.quadraticCurveTo(-0.025, 0.0, -0.021, 0.013);
      const lensGeo = new THREE.ShapeGeometry(drop, 12);
      for (const s of [-1, 1]) {
        // Outer edge (+x in the shape) away from the nose.
        const rim = add(lensGeo.clone(), c, s * 0.037, y, z + 0.0008);
        rim.rotation.y = Math.PI;
        rim.scale.set(-s * 1.12, 1.12, 1);
        const lens = add(lensGeo.clone(), look.lenses ?? 0x1b2230, s * 0.037, y, z - 0.0004);
        lens.rotation.y = Math.PI;
        lens.scale.set(-s, 1, 1);
        (lens.material as THREE.MeshStandardMaterial).roughness = 0.15;
        (lens.material as THREE.MeshStandardMaterial).metalness = 0.4;
        add(new THREE.BoxGeometry(0.003, 0.003, 0.1), c, s * (HEAD_W - 0.002), y + 0.012, z + 0.05);
      }
      lensGeo.dispose();
      add(new THREE.BoxGeometry(0.02, 0.0025, 0.003), c, 0, y + 0.012, z);
      add(new THREE.BoxGeometry(0.016, 0.0025, 0.003), c, 0, y + 0.004, z);
    } else {
      for (const s of [-1, 1]) {
        const x = s * 0.036;
        add(new THREE.BoxGeometry(0.044, 0.005, 0.004), c, x, y + 0.014, z);
        add(new THREE.BoxGeometry(0.044, 0.004, 0.004), c, x, y - 0.013, z);
        add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x - 0.0215, y, z);
        add(new THREE.BoxGeometry(0.005, 0.03, 0.004), c, x + 0.0215, y, z);
        // Arm back to the ear.
        add(new THREE.BoxGeometry(0.004, 0.004, 0.1), c, s * (HEAD_W - 0.002), y + 0.012, z + 0.05);
      }
      add(new THREE.BoxGeometry(0.018, 0.004, 0.004), c, 0, HY + 0.02, z);
      if (look.lenses !== undefined) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.025, 0.002), look.lenses, s * 0.036, y, z + 0.001);
    }
  }
  if (look.cap) {
    const crown = add(new THREE.SphereGeometry(0.108, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), look.cap.color, 0, HY + 0.035, 0.004);
    crown.scale.set(0.98 * NARROW, 0.95, 1.04);
    // Peak: a half disc out in front, tipped down a touch.
    const peak = add(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, Math.PI / 2, Math.PI), look.cap.color, 0, HY + 0.04, -0.06);
    peak.scale.set(0.9 * NARROW, 1, 1.05);
    peak.rotation.x = -0.14;
    if (look.cap.badge !== undefined) {
      const badge = add(new THREE.CircleGeometry(0.016, 14), look.cap.badge, 0, HY + 0.085, -0.093);
      badge.rotation.set(-0.5, Math.PI, 0);
    }
  }
  return abs;
}
