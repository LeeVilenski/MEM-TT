import * as THREE from 'three';
import { byDetail } from './detail';

/**
 * Body parts as shaped tubes: a stack of oval rings (each with its own size and offset),
 * joined into a smooth surface. A calf bulges at the back, a thigh is fuller at the top,
 * a forearm thickens below the elbow and flattens at the wrist, where cylinders can't.
 */

/** One ring of a tube: height along the tube, half-widths across (x) and front to back (z), and an offset of its middle. */
export interface Ring {
  y: number;
  rx: number;
  rz?: number;
  /** Offset of the ring's middle: + toward the back (+z) or to the side (+x). */
  cz?: number;
  cx?: number;
}

export interface TubeOptions {
  /** Points round each ring. */
  segments?: number;
  /** Round off an end with a dome this long (m, or a fraction for unit-length tubes): the first ring's end, and the last's. */
  capStart?: number;
  capEnd?: number;
  /** Turn the open end back inside by this much, like a hem (for an open sleeve or leg). */
  hemEnd?: number;
}

/**
 * A tube through the rings (in order along y; y may go up or down). UVs run round the
 * tube (u) and along it (v, 0 at the first ring), for repeating fabric tiles. Normals
 * are smooth all round, including across the seam where u wraps.
 */
export function tube(rings: Ring[], o: TubeOptions = {}): THREE.BufferGeometry {
  const n = o.segments ?? byDetail(10, 12, 16);
  const rs: Ring[] = [];
  const dir = Math.sign(rings[rings.length - 1].y - rings[0].y) || 1;
  // Domes: rings shrinking to a point beyond each end.
  const dome = (r: Ring, len: number, outward: number) => {
    const out: Ring[] = [];
    for (const s of [0.45, 0.75, 0.93, 1]) {
      const k = Math.sqrt(Math.max(0, 1 - s * s));
      out.push({ ...r, y: r.y + outward * len * s, rx: r.rx * k, rz: (r.rz ?? r.rx) * k });
    }
    return out;
  };
  if (o.capStart) rs.push(...dome(rings[0], o.capStart, -dir).reverse());
  rs.push(...rings);
  if (o.capEnd) rs.push(...dome(rings[rings.length - 1], o.capEnd, dir));
  if (o.hemEnd) {
    // Fold the open end back in: a ring slightly smaller, a little way back inside.
    const last = rings[rings.length - 1];
    rs.push({ ...last, y: last.y - dir * o.hemEnd * 0.2, rx: last.rx * 0.93, rz: (last.rz ?? last.rx) * 0.93 });
    rs.push({ ...last, y: last.y - dir * o.hemEnd, rx: last.rx * 0.9, rz: (last.rz ?? last.rx) * 0.9 });
  }
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  // Distance along the tube, for v.
  let along = 0;
  rs.forEach((r, i) => {
    if (i > 0) along += Math.hypot(r.y - rs[i - 1].y, (r.rx - rs[i - 1].rx) * 0.5);
    for (let j = 0; j <= n; j++) {
      const a = (j / n) * Math.PI * 2;
      // a = 0 at the front (−z), going round through +x.
      pos.push((r.cx ?? 0) + Math.sin(a) * r.rx, r.y, (r.cz ?? 0) - Math.cos(a) * (r.rz ?? r.rx));
      uv.push(j / n, along);
    }
  });
  const total = along || 1;
  for (let i = 1; i < uv.length; i += 2) uv[i] /= total;
  const row = n + 1;
  for (let i = 0; i < rs.length - 1; i++)
    for (let j = 0; j < n; j++) {
      const a = i * row + j;
      const b = a + row;
      // Wind so the outside faces out whichever way the rings run.
      if (dir > 0) idx.push(a, b, a + 1, b, b + 1, a + 1);
      else idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  // The seam: the first and last point of each ring are the same place; share their normal.
  const nor = geo.getAttribute('normal');
  const v = new THREE.Vector3();
  for (let i = 0; i < rs.length; i++) {
    const a = i * row;
    const b = a + n;
    v.set(nor.getX(a) + nor.getX(b), nor.getY(a) + nor.getY(b), nor.getZ(a) + nor.getZ(b)).normalize();
    nor.setXYZ(a, v.x, v.y, v.z);
    nor.setXYZ(b, v.x, v.y, v.z);
  }
  return geo;
}

/**
 * A trainer, in the foot's frame (the ankle joint at the origin, the toe toward −z, the
 * floor 4 cm below): an upper with a heel collar, a padded tongue and a rounded toe, and
 * a sole with a little toe spring. Returns the two parts for two colours.
 */
export function trainer() {
  /** Width (half, m) by distance forward of the heel (m). */
  const width = (f: number) => {
    const t = THREE.MathUtils.clamp((f + 0.06) / 0.26, 0, 1); // 0 at the heel, 1 at the toe
    return 0.036 + 0.014 * Math.sin(Math.min(1, t / 0.62) * Math.PI * 0.5) - 0.02 * Math.max(0, (t - 0.82) / 0.18) ** 2;
  };
  /** Extrude a side profile (forward f, height y) across the foot and shape its width. */
  const extrude = (pts: [number, number][], grow: number, bevel: number) => {
    const shape = new THREE.Shape(pts.map(([f, y]) => new THREE.Vector2(f, y)));
    const depth = 0.02;
    const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3, curveSegments: 10, steps: 1 });
    geo.translate(0, 0, -depth / 2);
    const p = geo.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const f = p.getX(i);
      const side = p.getZ(i) / (depth / 2 + bevel); // −1 … 1 across the foot
      // Across the foot (x), forward (−z), up (y).
      p.setXYZ(i, side * width(f) * grow, p.getY(i), -f);
    }
    geo.computeVertexNormals();
    return geo;
  };
  const curve = (pts: [number, number][], from: [number, number], via: [number, number], to: [number, number], steps = 5) => {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const a = (1 - t) * (1 - t);
      const b = 2 * (1 - t) * t;
      const c = t * t;
      pts.push([a * from[0] + b * via[0] + c * to[0], a * from[1] + b * via[1] + c * to[1]]);
    }
  };
  // Upper: heel, collar, tongue, laces sloping down to the toe cap.
  const up: [number, number][] = [[-0.058, -0.03]];
  curve(up, [-0.058, -0.03], [-0.07, 0.0], [-0.055, 0.03]); // heel counter
  curve(up, [-0.055, 0.03], [-0.02, 0.012], [0.02, 0.035]); // collar dips, then the tongue
  curve(up, [0.02, 0.035], [0.07, 0.025], [0.12, -0.004]); // laces down the instep
  curve(up, [0.12, -0.004], [0.185, -0.012], [0.19, -0.03]); // toe cap
  up.push([0.17, -0.032], [-0.04, -0.032]);
  const upper = extrude(up, 0.92, 0.012);
  // Sole: a slab under it all, the toe lifting a little.
  const so: [number, number][] = [[-0.062, -0.04]];
  curve(so, [-0.062, -0.04], [-0.07, -0.028], [-0.058, -0.022]);
  so.push([0.16, -0.024]);
  curve(so, [0.16, -0.024], [0.2, -0.026], [0.195, -0.034]);
  curve(so, [0.195, -0.034], [0.18, -0.042], [0.14, -0.042]);
  so.push([-0.03, -0.042]);
  const sole = extrude(so, 1.02, 0.006);
  return { upper, sole };
}
