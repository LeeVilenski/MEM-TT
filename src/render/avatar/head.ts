import * as THREE from 'three';
import { paint } from '../fabric';
import type { MaterialKit } from './body';
import { HEAD_PIVOT, HEAD_Y } from './dimensions';
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

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const Y_AXIS = new THREE.Vector3(0, 1, 0);

/**
 * Build the head on the `head` joint. Returns the inner group (positioned so its
 * children use heights on the standing body), for extra hair pieces.
 */
export function dressHead(joint: THREE.Group, look: Look, kit: MaterialKit): THREE.Group {
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
  const HY = HEAD_Y;
  const f = look.face ?? {};
  const jawW = f.jaw ?? 1;
  const long = f.long ?? 1;
  /** How far the lower face (jaw, mouth, stubble) drops for a longer face. */
  const drop = (long - 1) * 0.06;
  const head = add(new THREE.SphereGeometry(0.1, 24, 18), look.skin, 0, HY, 0);
  head.scale.set(0.94, 1.1 * long, 1);
  // Jaw: a slightly narrower sphere low and forward, so the face isn't a ball.
  const jaw = add(new THREE.SphereGeometry(0.08, 18, 12), look.skin, 0, HY - 0.045 - drop, -0.018);
  jaw.scale.set(0.95 * jawW, 0.85, 1);
  const browColor = f.brows ?? look.hair;
  for (const s of [-1, 1]) {
    const ear = add(new THREE.SphereGeometry(0.024, 10, 8), look.skin, s * 0.094, HY - 0.005, 0.005);
    ear.scale.set(0.45, 1, 0.75);
    // Eyes: a white, a coloured iris, a pupil and a catchlight, under a brow.
    const ey = HY + 0.012;
    const white = add(new THREE.SphereGeometry(0.0135, 14, 10), 0xf5f5f4, s * 0.034, ey, -0.088);
    white.scale.set(1.25, 0.8, 0.5);
    const iris = add(new THREE.SphereGeometry(0.0078, 12, 10), f.eyes ?? 0x5a4130, s * 0.034, ey, -0.0935);
    iris.scale.z = 0.6;
    add(new THREE.SphereGeometry(0.0042, 10, 8), 0x0b0b0c, s * 0.034, ey, -0.0972);
    add(new THREE.SphereGeometry(0.0016, 6, 4), 0xffffff, s * 0.034 + 0.0028, ey + 0.0028, -0.0985);
    // Upper lid: a skin-toned crease across the top of the eye.
    const lid = add(new THREE.CapsuleGeometry(0.003, 0.024, 2, 6).rotateZ(Math.PI / 2), look.skin, s * 0.034, ey + 0.0105, -0.0915);
    lid.rotation.z = s * -0.08;
    const w = f.browWeight ?? 1;
    const brow = add(new THREE.CapsuleGeometry(0.0055 * w, 0.024, 2, 6).rotateZ(Math.PI / 2), browColor, s * 0.035, HY + 0.037, -0.092);
    brow.rotation.z = s * -0.12;
  }
  const nose = add(new THREE.SphereGeometry(0.015, 10, 8), look.skin, 0, HY - 0.012, -0.1);
  nose.scale.set(0.85, 1.2, 1.1);

  // Stubble or a goatee: speckle painted onto a thin shell over the lower face.
  const stubbled = f.stubble !== undefined;
  if (f.stubble) {
    const st = f.stubble;
    const R = 0.086;
    const T0 = Math.PI / 2.6;
    const TL = Math.PI / 2.0;
    const sx = 0.98 * jawW;
    const sy = 0.92;
    const cz = -0.014;
    const cy = -0.04 - drop;
    const key = `stubble:${st.color}:${st.density ?? 1}:${st.goatee ? 1 : 0}:${jawW}:${long}`;
    const tex = paint(key, (p) => {
      const r = (() => {
        let s = 12345;
        return () => ((s = (s * 16807) % 2147483647) / 2147483647);
      })();
      const col = new THREE.Color(st.color);
      const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
      /** How much stubble grows at a point on the shell (0..1), from its position on the face. */
      const weight = (u: number, v: number) => {
        const phi = u * Math.PI * 2;
        const th = T0 + v * TL;
        const X = -Math.cos(phi) * Math.sin(th) * R * sx;
        const Y = cy + Math.cos(th) * R * sy + drop; // relative to the un-dropped face
        const Z = cz + Math.sin(phi) * Math.sin(th) * R;
        const ax = Math.abs(X);
        // Lips stay clear.
        if (ax < 0.024 && Y > -0.052 && Y < -0.036) return 0;
        if (st.goatee) {
          const chin = ax < 0.03 && Y < -0.054 && Y > -0.11 && Z < -0.03;
          const tache = ax < 0.032 && Y > -0.036 && Y < -0.024;
          const sides = ax > 0.022 && ax < 0.033 && Y >= -0.056 && Y <= -0.034;
          return chin || tache || sides ? 1 : 0;
        }
        // Only on the face side, and not on the part of the shell that hangs past the jaw.
        const front = clamp((-0.03 - Z) / 0.02, 0, 1) * clamp((Y + 0.102) / 0.012, 0, 1);
        const top = ax > 0.07 ? 0.02 : -0.022 - Math.max(0, 0.05 - ax) * 0.1;
        const up = clamp((top - Y) / 0.008, 0, 1);
        return front * up;
      };
      const density = st.density ?? 1;
      // A soft shadow where it grows, then the individual hairs.
      const step = 4;
      for (let y = 0; y < p.h; y += step)
        for (let x = 0; x < p.w; x += step) {
          const wgt = weight(x / p.w, y / p.h);
          if (wgt <= 0) continue;
          p.c.fillStyle = `rgba(${rgb},${0.32 * density * wgt})`;
          p.c.fillRect(x, y, step, step);
        }
      for (let i = 0; i < 26000 * density; i++) {
        const x = r() * p.w;
        const y = r() * p.h;
        const wgt = weight(x / p.w, y / p.h);
        if (r() > wgt) continue;
        p.c.fillStyle = `rgba(${rgb},${0.5 + r() * 0.5})`;
        p.c.fillRect(x, y, 1 + r() * 1.5, 1 + r() * 1.5);
      }
    }, 1024, 512);
    const m = decal(tex);
    if (m) {
      const shell = add(new THREE.SphereGeometry(R, 32, 16, 0, Math.PI * 2, T0, TL), st.color, 0, HY + cy, cz);
      shell.scale.set(sx, sy, 1);
      shell.material = m;
      shell.renderOrder = 1;
    }
  }

  // Mouth: a closed smile, a one-sided smirk, or a grin with teeth showing.
  const my = HY - 0.044 - drop;
  const mz = look.beard !== undefined ? -0.098 : stubbled ? -0.097 : -0.093;
  const mouth = f.mouth ?? 'smile';
  if (mouth === 'grin') {
    // Sits just proud of the jaw (or the stubble), whichever is further out.
    const mz = -0.1;
    const open = add(new THREE.SphereGeometry(0.026, 20, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x4a1416, 0, my + 0.008, mz + 0.006);
    open.scale.set(1, 0.6, 0.32);
    const teeth = add(new THREE.SphereGeometry(0.0255, 20, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 6), 0xf7f3ea, 0, my + 0.008, mz + 0.0055);
    teeth.scale.set(0.96, 0.6, 0.35);
    const lip = add(new THREE.TorusGeometry(0.026, 0.0028, 6, 18, Math.PI), 0xa24f45, 0, my + 0.008, mz + 0.002);
    lip.rotation.z = Math.PI;
    lip.scale.set(1, 0.62, 1);
  } else if (mouth === 'smirk') {
    const smirk = add(new THREE.TorusGeometry(0.02, 0.0034, 6, 14, Math.PI * 0.75), 0x9a4a3c, 0.003, my + 0.002, mz);
    smirk.rotation.z = Math.PI * 1.05;
  } else {
    const smile = add(new THREE.TorusGeometry(0.021, 0.0036, 6, 14, Math.PI), 0x9a4a3c, 0, my + 0.002, mz);
    smile.rotation.z = Math.PI;
  }

  // Rosy cheeks: soft round blush.
  if (f.cheeks !== undefined) {
    const tex = paint('blush', (p) => {
      const g = p.c.createRadialGradient(p.w / 2, p.h / 2, 0, p.w / 2, p.h / 2, p.w / 2);
      g.addColorStop(0, 'rgba(255,255,255,0.55)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      p.c.fillStyle = g;
      p.c.fillRect(0, 0, p.w, p.h);
    }, 64, 64);
    const m = decal(tex, f.cheeks);
    if (m)
      for (const s of [-1, 1]) {
        const blush = add(new THREE.CircleGeometry(0.02, 16), f.cheeks, s * 0.05, HY - 0.018, -0.086);
        blush.material = m;
        blush.rotation.y = Math.PI + s * 0.55;
        blush.scale.y = 0.75;
      }
  }

  // Hair (sides and back show under a cap); greying temples fade in towards the bottom.
  const hair = add(new THREE.SphereGeometry(0.106, 22, 14, 0, Math.PI * 2, 0, Math.PI / 1.9), look.hair, 0, HY + 0.008, 0.01);
  hair.scale.set(0.97, 1.1 * long, 1.04);
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
    const m = tex && decal(tex);
    if (m) {
      (m as THREE.MeshStandardMaterial).transparent = false;
      (m as THREE.MeshStandardMaterial).depthWrite = true;
      hair.material = m;
    }
  }
  if (f.spiky) {
    // Short spikes, swept up at the front.
    for (let i = 0; i < 16; i++) {
      const phi = -Math.PI / 2 + (i - 7.5) * 0.36;
      const th = 0.25 + (i % 3) * 0.17;
      const n = new THREE.Vector3(Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
      const spike = add(new THREE.ConeGeometry(0.015, 0.03, 6), look.hair, n.x * 0.1, HY + 0.012 + n.y * 0.112 * long, 0.006 + n.z * 0.104);
      spike.quaternion.setFromUnitVectors(Y_AXIS, n.add(new THREE.Vector3(0, 0.9, -0.15)).normalize());
    }
  }
  if (look.beard !== undefined) {
    const beard = add(new THREE.SphereGeometry(0.084, 18, 10, 0, Math.PI * 2, Math.PI / 2.1, Math.PI / 2.4), look.beard, 0, HY - 0.04, -0.016);
    beard.scale.set(0.98, 0.9, 1.03);
  }
  if (look.glasses !== undefined) {
    const c = look.glasses;
    const z = -0.101;
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
        add(new THREE.BoxGeometry(0.003, 0.003, 0.1), c, s * 0.091, y + 0.012, z + 0.05);
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
        add(new THREE.BoxGeometry(0.004, 0.004, 0.1), c, s * 0.091, y + 0.012, z + 0.05);
      }
      add(new THREE.BoxGeometry(0.018, 0.004, 0.004), c, 0, HY + 0.02, z);
      if (look.lenses !== undefined) for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.04, 0.025, 0.002), look.lenses, s * 0.036, y, z + 0.001);
    }
  }
  if (look.cap) {
    const crown = add(new THREE.SphereGeometry(0.108, 22, 12, 0, Math.PI * 2, 0, Math.PI / 2), look.cap.color, 0, HY + 0.035, 0.004);
    crown.scale.set(0.98, 0.95, 1.04);
    // Peak: a half disc out in front, tipped down a touch.
    const peak = add(new THREE.CylinderGeometry(0.1, 0.1, 0.008, 20, 1, false, Math.PI / 2, Math.PI), look.cap.color, 0, HY + 0.04, -0.06);
    peak.scale.set(0.9, 1, 1.05);
    peak.rotation.x = -0.14;
    if (look.cap.badge !== undefined) {
      const badge = add(new THREE.CircleGeometry(0.016, 14), look.cap.badge, 0, HY + 0.085, -0.093);
      badge.rotation.set(-0.5, Math.PI, 0);
    }
  }
  return abs;
}
