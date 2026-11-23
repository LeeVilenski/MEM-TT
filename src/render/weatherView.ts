import * as THREE from 'three';
import { TABLE, type PhysicsParams, type Puddle, type Vec3 } from '../physics';

/**
 * How the weather looks: rain streaks slanting with the wind, a darker, wetter table
 * with puddles (rain rings on them), splashes when the ball lands in one, and a
 * windsock by the net that swings round and fills out in the gusts.
 *
 * Everything reads the physics params (the frame the ball flies in), so what you
 * see is exactly what the ball feels. Nothing here changes the physics.
 */

const RAIN_BOX = { halfW: 7, halfD: 8, h: 7 };
const FALL_SPEED = 7.5;
const MAX_DROPS = 2400;
const RIPPLES = 16;
const SPLASH_DROPS = 60;

interface Base {
  hemi: number;
  key: number;
  background: THREE.Color;
  fogColor: THREE.Color;
  fogFar: number;
  tableRoughness: number;
  tableColor: THREE.Color;
  tableClearcoat: number;
}

export class WeatherView {
  private group = new THREE.Group();
  private rain: THREE.LineSegments;
  private rainPos: Float32Array;
  private rainMat: THREE.LineBasicMaterial;
  private drops: { x: number; y: number; z: number }[] = [];
  private puddleGroup = new THREE.Group();
  private puddleMat = new THREE.MeshPhysicalMaterial({ color: 0x5b6670, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.55, clearcoat: 1, depthWrite: false });
  private puddleKey: readonly Puddle[] | null = null;
  private ripples: { mesh: THREE.Mesh; life: number }[] = [];
  private splash: THREE.Points;
  private splashPos: Float32Array;
  private splashVel: Float32Array;
  private splashLife: Float32Array;
  private sock: THREE.Group;
  private sockCloth: THREE.Group;
  private base: Base | null = null;
  private rainLevel = 0;
  private time = 0;
  /** Drops drawn, from graphics quality (0 Low … 2 High). */
  private dropCount = 1600;

  constructor(private scene: THREE.Scene) {
    this.group.name = 'weather';
    scene.add(this.group);

    // Rain: one line segment per drop, stretched along its velocity.
    for (let i = 0; i < MAX_DROPS; i++) this.drops.push({ x: (Math.random() * 2 - 1) * RAIN_BOX.halfW, y: Math.random() * RAIN_BOX.h, z: (Math.random() * 2 - 1) * RAIN_BOX.halfD });
    this.rainPos = new Float32Array(MAX_DROPS * 6);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.rainPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.rainMat = new THREE.LineBasicMaterial({ color: 0xc8d4de, transparent: true, opacity: 0.35, depthWrite: false });
    this.rain = new THREE.LineSegments(g, this.rainMat);
    this.rain.frustumCulled = false;
    this.group.add(this.rain);

    this.group.add(this.puddleGroup);
    const ringGeo = new THREE.RingGeometry(0.8, 1, 24);
    ringGeo.rotateX(-Math.PI / 2);
    for (let i = 0; i < RIPPLES; i++) {
      const mesh = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: 0xdfe8ef, transparent: true, opacity: 0, depthWrite: false }));
      mesh.visible = false;
      this.group.add(mesh);
      this.ripples.push({ mesh, life: 0 });
    }

    // Splash droplets.
    this.splashPos = new Float32Array(SPLASH_DROPS * 3);
    this.splashVel = new Float32Array(SPLASH_DROPS * 3);
    this.splashLife = new Float32Array(SPLASH_DROPS);
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(this.splashPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.splash = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xe6eef5, size: 0.018, transparent: true, opacity: 0.85, depthWrite: false }));
    this.splash.frustumCulled = false;
    this.group.add(this.splash);

    // Windsock on a pole off the far left corner, where you can see it while you play.
    this.sock = new THREE.Group();
    this.sock.position.set(-TABLE.halfWidth - 1.6, 0, -TABLE.halfLength - 0.4);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.02, 2, 8), new THREE.MeshStandardMaterial({ color: 0x9aa1a6, metalness: 0.6, roughness: 0.4 }));
    pole.position.y = 1;
    this.sock.add(pole);
    this.sockCloth = new THREE.Group();
    this.sockCloth.position.y = 1.95;
    const bands = [0xf26b1d, 0xf4f1ea, 0xf26b1d, 0xf4f1ea];
    bands.forEach((c, i) => {
      const r0 = 0.09 - i * 0.014;
      const seg = new THREE.Mesh(new THREE.CylinderGeometry(r0 - 0.014, r0, 0.16, 12, 1, true), new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.9 }));
      // Lie along +z (the cloth streams downwind), segment i further out.
      seg.rotation.x = Math.PI / 2;
      seg.position.z = 0.08 + i * 0.16;
      this.sockCloth.add(seg);
    });
    this.sock.add(this.sockCloth);
    this.group.add(this.sock);

    this.group.visible = false;
  }

  setQuality(level: number) {
    this.dropCount = [700, 1500, MAX_DROPS][Math.max(0, Math.min(2, level))];
  }

  /**
   * Remember the venue's lighting and table look (call after every venue change), so
   * rain can darken and wet them and put them back afterwards.
   */
  captureVenue() {
    const hemi = this.scene.getObjectByName('hemi') as THREE.HemisphereLight;
    const key = this.scene.getObjectByName('key') as THREE.DirectionalLight;
    const top = this.scene.getObjectByName('tableTop') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | undefined;
    const fog = this.scene.fog as THREE.Fog | null;
    this.base = {
      hemi: hemi.intensity,
      key: key.intensity,
      background: (this.scene.background as THREE.Color | null)?.clone() ?? new THREE.Color(0),
      fogColor: fog?.color.clone() ?? new THREE.Color(0),
      fogFar: fog?.far ?? 100,
      tableRoughness: top?.material.roughness ?? 0.5,
      tableColor: top?.material.color.clone() ?? new THREE.Color(1, 1, 1),
      tableClearcoat: top?.material.clearcoat ?? 0,
    };
    this.rainLevel = -1; // force the look to be reapplied
  }

  /** Set the look for the weather: rain 0–1, wetness 0–1. Nothing shows when inactive. */
  private applyLook(rain: number, wetness: number) {
    const b = this.base;
    if (!b) return;
    const hemi = this.scene.getObjectByName('hemi') as THREE.HemisphereLight;
    const key = this.scene.getObjectByName('key') as THREE.DirectionalLight;
    const top = this.scene.getObjectByName('tableTop') as THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial> | undefined;
    const grey = new THREE.Color(0x8d959c);
    hemi.intensity = b.hemi * (1 - 0.22 * rain);
    key.intensity = b.key * (1 - 0.45 * rain);
    if (this.scene.background instanceof THREE.Color) this.scene.background.copy(b.background).lerp(grey, 0.6 * rain);
    const fog = this.scene.fog as THREE.Fog | null;
    if (fog) {
      fog.color.copy(b.fogColor).lerp(grey, 0.6 * rain);
      fog.far = b.fogFar * (1 - 0.35 * rain);
    }
    if (top) {
      // Wet: darker, glossy (it reflects the sky), with a clear film on top.
      top.material.roughness = THREE.MathUtils.lerp(b.tableRoughness, 0.18, wetness);
      top.material.color.copy(b.tableColor).multiplyScalar(1 - 0.3 * wetness);
      top.material.clearcoat = Math.max(b.tableClearcoat, 0.8 * wetness);
    }
  }

  private buildPuddles(puddles: readonly Puddle[]) {
    this.puddleKey = puddles;
    for (const m of this.puddleGroup.children as THREE.Mesh[]) m.geometry.dispose();
    this.puddleGroup.clear();
    for (const p of puddles) {
      // A soft blob rather than a perfect disc.
      const shape = new THREE.Shape();
      const n = 20;
      for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = p.r * (1 + 0.12 * Math.sin(a * 3 + p.x * 9) + 0.07 * Math.sin(a * 5 + p.z * 7));
        const x = Math.cos(a) * r;
        const y = Math.sin(a) * r;
        if (i === 0) shape.moveTo(x, y);
        else shape.lineTo(x, y);
      }
      const geo = new THREE.ShapeGeometry(shape);
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.puddleMat);
      m.position.set(p.x, TABLE.height + 0.0015, p.z);
      m.renderOrder = 1;
      this.puddleGroup.add(m);
    }
  }

  /** The ball landed in a puddle: a crown of droplets and a ring. */
  splashAt(pos: Vec3, impactSpeed: number) {
    const n = Math.min(SPLASH_DROPS, 18 + Math.round(impactSpeed * 6));
    let used = 0;
    for (let i = 0; i < SPLASH_DROPS && used < n; i++) {
      if (this.splashLife[i] > 0) continue;
      used++;
      const a = Math.random() * Math.PI * 2;
      const out = 0.4 + Math.random() * 0.8 + impactSpeed * 0.12;
      this.splashPos.set([pos.x, TABLE.height + 0.01, pos.z], i * 3);
      this.splashVel.set([Math.cos(a) * out, 0.8 + Math.random() * 1.2 + impactSpeed * 0.15, Math.sin(a) * out], i * 3);
      this.splashLife[i] = 0.35 + Math.random() * 0.25;
    }
    this.ripple(pos.x, pos.z, 0.1);
  }

  private ripple(x: number, z: number, size: number) {
    const r = this.ripples.find((q) => q.life <= 0);
    if (!r) return;
    r.life = 1;
    r.mesh.position.set(x, TABLE.height + 0.002, z);
    r.mesh.userData.size = size;
    r.mesh.visible = true;
  }

  /**
   * Per frame. `params` is the physics (wind, wetness and puddles in the ball's frame);
   * `rain` 0–1; `active` false hides it all and restores the venue's look.
   */
  update(dt: number, params: PhysicsParams, rain: number, active: boolean) {
    this.time += dt;
    const r = active ? rain : 0;
    const wet = active ? params.wetness : 0;
    if (Math.abs(r - this.rainLevel) > 1e-3 || this.lastWet !== wet) {
      this.rainLevel = r;
      this.lastWet = wet;
      this.applyLook(r, wet);
    }
    const windy = active && (params.windX !== 0 || params.windZ !== 0);
    this.group.visible = active && (r > 0 || windy || params.puddles.length > 0);
    if (!this.group.visible) return;
    if (this.puddleKey !== params.puddles) this.buildPuddles(params.puddles);

    // Rain: drops fall and drift with the wind; respawn at the top when they reach the ground.
    const count = Math.round(this.dropCount * r);
    this.rain.visible = count > 0;
    this.rain.geometry.setDrawRange(0, count * 2);
    if (count > 0) {
      const vx = params.windX;
      const vz = params.windZ;
      const vy = -FALL_SPEED;
      const streak = 0.045;
      const P = this.rainPos;
      for (let i = 0; i < count; i++) {
        const d = this.drops[i];
        d.x += vx * dt;
        d.y += vy * dt;
        d.z += vz * dt;
        if (d.y < 0) {
          d.y += RAIN_BOX.h;
          d.x = (Math.random() * 2 - 1) * RAIN_BOX.halfW;
          d.z = (Math.random() * 2 - 1) * RAIN_BOX.halfD;
        }
        if (d.x > RAIN_BOX.halfW) d.x -= 2 * RAIN_BOX.halfW;
        else if (d.x < -RAIN_BOX.halfW) d.x += 2 * RAIN_BOX.halfW;
        if (d.z > RAIN_BOX.halfD) d.z -= 2 * RAIN_BOX.halfD;
        else if (d.z < -RAIN_BOX.halfD) d.z += 2 * RAIN_BOX.halfD;
        const o = i * 6;
        P[o] = d.x;
        P[o + 1] = d.y;
        P[o + 2] = d.z;
        P[o + 3] = d.x - vx * streak;
        P[o + 4] = d.y - vy * streak;
        P[o + 5] = d.z - vz * streak;
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
      this.rainMat.opacity = 0.18 + 0.22 * r;
    }

    // Rain rings on the puddles.
    if (r > 0 && params.puddles.length && Math.random() < dt * 14 * r) {
      const p = params.puddles[Math.floor(Math.random() * params.puddles.length)];
      const a = Math.random() * Math.PI * 2;
      const d = Math.sqrt(Math.random()) * p.r * 0.85;
      this.ripple(p.x + Math.cos(a) * d, p.z + Math.sin(a) * d, 0.025 + Math.random() * 0.02);
    }
    for (const q of this.ripples) {
      if (q.life <= 0) continue;
      q.life -= dt * 1.8;
      const size = q.mesh.userData.size as number;
      q.mesh.scale.setScalar(size * (1.6 - q.life));
      (q.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, q.life) * 0.5;
      if (q.life <= 0) q.mesh.visible = false;
    }

    // Splash droplets: simple ballistics, gone when they land.
    let live = false;
    for (let i = 0; i < SPLASH_DROPS; i++) {
      if (this.splashLife[i] <= 0) {
        this.splashPos[i * 3 + 1] = -10;
        continue;
      }
      live = true;
      this.splashLife[i] -= dt;
      this.splashVel[i * 3 + 1] -= 9.81 * dt;
      for (let k = 0; k < 3; k++) this.splashPos[i * 3 + k] += this.splashVel[i * 3 + k] * dt;
    }
    this.splash.visible = live;
    if (live) this.splash.geometry.attributes.position.needsUpdate = true;

    // Windsock: points downwind, lifts from hanging to straight out as the wind gets up.
    const speed = Math.hypot(params.windX, params.windZ);
    this.sock.visible = windy;
    if (windy) {
      const yaw = Math.atan2(params.windX, params.windZ);
      const lift = Math.min(1, speed / 4);
      const flap = Math.sin(this.time * (6 + speed * 2)) * 0.06 * lift;
      this.sockCloth.rotation.set(0, 0, 0);
      this.sockCloth.rotateY(yaw + flap);
      // Hanging = pitched down ~80°; full wind = level.
      this.sockCloth.rotateX((1 - lift) * 1.35 + Math.abs(flap) * 0.5);
    }
  }

  private lastWet = -1;

  dispose() {
    this.scene.remove(this.group);
  }
}
