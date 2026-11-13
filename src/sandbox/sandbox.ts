import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {
  BallSim,
  DEFAULT_PARAMS,
  TABLE,
  TICK_DT,
  describeSpin,
  launchDirection,
  launchState,
  lerp,
  predict,
  radToRpm,
  solveAim,
  spinComponents,
  length,
  v3,
  type BallEvent,
  type PhysicsParams,
  type Vec3,
} from '../physics';
import { BallView, spinColor } from '../render/ballView';
import { createScene } from '../render/scene';
import { Hud, type ShotReport } from './hud';
import { PRESETS, type Preset } from './presets';

type CameraView = 'Player' | 'Side' | 'Top' | 'Broadcast' | 'Machine';

const CAMERA_VIEWS: Record<CameraView, { pos: [number, number, number]; target: [number, number, number] }> = {
  Player: { pos: [0, 1.45, 2.7], target: [0, 0.8, -0.4] },
  Side: { pos: [3.4, 1.4, 0.2], target: [0, 0.8, 0.2] },
  Top: { pos: [0, 5.2, 0.01], target: [0, 0.76, 0] },
  Broadcast: { pos: [-2.6, 2.9, 4.4], target: [0, 0.7, 0] },
  Machine: { pos: [0, 1.35, -3.4], target: [0, 0.8, 0.6] },
};

/** Ball-machine settings edited through the UI. */
interface MachineSettings {
  preset: string;
  speed: number;
  topspin: number;
  sidespin: number;
  corkscrew: number;
  distanceBack: number;
  height: number;
  lateral: number;
  targetX: number;
  targetZ: number;
  highArc: boolean;
  autoFire: boolean;
  interval: number;
  /** Random scatter of the landing target, metres. */
  scatter: number;
}

export class Sandbox {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private ball: BallView;
  private hud: Hud;
  private gui!: GUI;

  params: PhysicsParams = { ...DEFAULT_PARAMS };
  private sim: BallSim | null = null;
  private prevPos: Vec3 = v3();
  private accumulator = 0;
  private lastFrame = performance.now();
  private sinceFire = 0;

  settings = {
    timeScale: 1,
    paused: false,
    showPrediction: true,
    showTrail: true,
    showSpinAxis: true,
    camera: 'Player' as CameraView,
  };
  machine: MachineSettings;

  private report: ShotReport | null = null;
  private markers: THREE.Mesh[] = [];
  private predictionLine: THREE.Line;
  private machineMesh: THREE.Group;
  private targetRing: THREE.Mesh;
  private raycaster = new THREE.Raycaster();

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.scene = createScene(this.renderer);
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.setCamera('Player');

    this.ball = new BallView(this.scene);
    this.ball.visible = false;
    this.hud = new Hud(container);

    this.predictionLine = new THREE.Line(
      new THREE.BufferGeometry(),
      new THREE.LineDashedMaterial({ color: 0x9aa4b8, dashSize: 0.03, gapSize: 0.03, transparent: true, opacity: 0.55 }),
    );
    this.predictionLine.frustumCulled = false;
    this.scene.add(this.predictionLine);

    this.machineMesh = createMachineMesh();
    this.scene.add(this.machineMesh);

    this.targetRing = new THREE.Mesh(
      new THREE.RingGeometry(0.035, 0.05, 32),
      new THREE.MeshBasicMaterial({ color: 0xffd34d, transparent: true, opacity: 0.85, side: THREE.DoubleSide }),
    );
    this.targetRing.rotation.x = -Math.PI / 2;
    this.scene.add(this.targetRing);

    this.machine = this.settingsFromPreset(PRESETS.find((p) => p.name === 'Power loop')!);
    this.buildGui();
    this.updateMachineVisuals();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e));
    this.renderer.domElement.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ---------------------------------------------------------------- machine

  private settingsFromPreset(p: Preset): MachineSettings {
    return {
      preset: p.name,
      speed: p.speed,
      topspin: p.spin.top,
      sidespin: p.spin.side,
      corkscrew: p.spin.cork,
      distanceBack: p.distanceBack,
      height: p.height,
      lateral: p.lateral,
      targetX: p.target.x,
      targetZ: p.target.z,
      highArc: !!p.highArc,
      autoFire: this.machine?.autoFire ?? false,
      interval: this.machine?.interval ?? 2.5,
      scatter: this.machine?.scatter ?? 0,
    };
  }

  private origin(): Vec3 {
    const m = this.machine;
    return v3(m.lateral, TABLE.height + m.height, -TABLE.halfLength - m.distanceBack);
  }

  private spin() {
    return { top: this.machine.topspin, side: this.machine.sidespin, cork: this.machine.corkscrew };
  }

  fire() {
    const m = this.machine;
    const jitter = () => (Math.random() * 2 - 1) * m.scatter;
    const target = {
      x: THREE.MathUtils.clamp(m.targetX + jitter(), -TABLE.halfWidth + 0.03, TABLE.halfWidth - 0.03),
      z: THREE.MathUtils.clamp(m.targetZ + jitter(), 0.05, TABLE.halfLength - 0.03),
    };
    const origin = this.origin();
    const aim = solveAim(origin, target, m.speed, this.spin(), this.params, m.highArc);
    const shot = { speed: m.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: this.spin() };
    const start = launchState(origin, shot);

    this.sim = new BallSim(start, this.params);
    this.prevPos = { ...start.pos };
    this.accumulator = 0;
    this.sinceFire = 0;
    this.ball.clearTrail();
    this.ball.visible = true;
    this.ball.mesh.quaternion.identity();
    this.aimMachine(shot.elevation, shot.azimuth);

    const comps = spinComponents(start.vel, start.spin);
    this.report = {
      name: m.preset,
      speed: m.speed,
      rpm: radToRpm(length(start.spin)),
      spin: comps,
      spinLabel: describeSpin(comps),
      elevation: aim.elevation,
      aimOk: aim.ok,
      bounces: [],
    };
    this.hud.showShot(this.report);

    if (this.settings.showPrediction) {
      const { path } = predict(start, this.params, { maxTime: 3, stop: (e) => e.type === 'floor' });
      this.predictionLine.geometry.dispose();
      this.predictionLine.geometry = new THREE.BufferGeometry().setFromPoints(path.map((p) => new THREE.Vector3(p.x, p.y, p.z)));
      this.predictionLine.computeLineDistances();
      this.predictionLine.visible = true;
    } else {
      this.predictionLine.visible = false;
    }
  }

  private aimMachine(elevation: number, azimuth: number) {
    const dir = launchDirection(elevation, azimuth);
    const barrel = this.machineMesh.getObjectByName('barrel')!;
    barrel.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(dir.x, dir.y, dir.z));
  }

  private updateMachineVisuals() {
    const o = this.origin();
    this.machineMesh.position.set(o.x, o.y, o.z);
    this.targetRing.position.set(this.machine.targetX, TABLE.height + 0.002, this.machine.targetZ);
    // Preview the aim without firing.
    const aim = solveAim(o, { x: this.machine.targetX, z: this.machine.targetZ }, this.machine.speed, this.spin(), this.params, this.machine.highArc);
    this.aimMachine(aim.elevation, aim.azimuth);
    (this.targetRing.material as THREE.MeshBasicMaterial).color.set(aim.ok ? 0xffd34d : 0xff4d4d);
    this.hud.setAimWarning(aim.ok ? null : 'Target not reachable with this speed/spin — the shot will miss.');
  }

  // ---------------------------------------------------------------- events

  private handleEvent(e: BallEvent) {
    if (!this.report) return;
    const r = this.report;
    switch (e.type) {
      case 'netCross':
        if (e.direction === 'near' && r.netClearance === undefined) r.netClearance = e.clearance;
        break;
      case 'net':
        r.netTouches = (r.netTouches ?? 0) + 1;
        this.hud.flash(e.part === 'tape' ? 'NET CORD' : 'PACKET LOSS', e.part === 'tape' ? 'Clipped the tape' : 'Into the net');
        break;
      case 'table': {
        const outSpin = spinComponents(e.velOut, e.spinOut);
        r.bounces.push({
          side: e.side,
          x: e.pos.x,
          z: e.pos.z,
          time: e.time,
          speedIn: length(e.velIn),
          speedOut: length(e.velOut),
          angleOut: (Math.atan2(e.velOut.y, Math.hypot(e.velOut.x, e.velOut.z)) * 180) / Math.PI,
          spinOut: outSpin,
          rpmOut: radToRpm(length(e.spinOut)),
        });
        this.addMarker(e.pos, spinColor(e.velIn, e.spinIn));
        if (r.result === undefined) {
          if (e.side === 'near') r.result = 'IN';
          else if (r.bounces.length === 1 && e.pos.z < 0) r.result = 'FAULT';
        }
        break;
      }
      case 'floor':
        if (r.result === undefined) {
          r.result = 'OUT';
          this.hud.flash('404', 'Ball not found (on the table)');
        }
        break;
    }
    this.hud.showShot(r);
  }

  private addMarker(pos: Vec3, color: THREE.Color) {
    const m = new THREE.Mesh(new THREE.CircleGeometry(0.02, 20), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(pos.x, TABLE.height + 0.001 + this.markers.length * 0.00001, pos.z);
    this.scene.add(m);
    this.markers.push(m);
    if (this.markers.length > 40) {
      const old = this.markers.shift()!;
      this.scene.remove(old);
      old.geometry.dispose();
    }
    this.markers.forEach((mk, i) => ((mk.material as THREE.MeshBasicMaterial).opacity = 0.25 + (0.65 * (i + 1)) / this.markers.length));
  }

  clearMarkers() {
    for (const m of this.markers) {
      this.scene.remove(m);
      m.geometry.dispose();
    }
    this.markers = [];
  }

  // ---------------------------------------------------------------- loop

  private frame() {
    const now = performance.now();
    const realDt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.settings.paused) this.advance(realDt * this.settings.timeScale);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Advance the simulation by gameDt seconds of game time using fixed ticks. */
  private advance(gameDt: number) {
    this.sinceFire += gameDt;
    if (this.machine.autoFire && this.sinceFire >= this.machine.interval) this.fire();
    if (!this.sim) return;

    this.accumulator += gameDt;
    while (this.accumulator >= TICK_DT) {
      this.tick();
      this.accumulator -= TICK_DT;
    }
    // Interpolate between the last two ticks for smooth rendering at any frame rate.
    const alpha = this.accumulator / TICK_DT;
    const pos = lerp(this.prevPos, this.sim.state.pos, alpha);
    this.ball.rotate(this.sim.state.spin, gameDt);
    this.ball.update(pos, this.sim.state);
  }

  private tick() {
    if (!this.sim) return;
    this.prevPos = { ...this.sim.state.pos };
    const events: BallEvent[] = [];
    this.sim.step(TICK_DT, events);
    for (const e of events) this.handleEvent(e);
  }

  /** Single-step one physics tick while paused. */
  step() {
    if (!this.sim) return;
    this.settings.paused = true;
    this.tick();
    this.ball.rotate(this.sim.state.spin, TICK_DT);
    this.ball.update(this.sim.state.pos, this.sim.state);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  // ---------------------------------------------------------------- input / ui

  setCamera(view: CameraView) {
    const v = CAMERA_VIEWS[view];
    this.camera.position.set(...v.pos);
    this.controls.target.set(...v.target);
    this.controls.update();
  }

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    if (e.code === 'Space') {
      e.preventDefault();
      this.fire();
    } else if (e.code === 'KeyP') {
      this.settings.paused = !this.settings.paused;
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    } else if (e.code === 'Period') {
      this.step();
    } else if (e.code === 'KeyC') {
      this.clearMarkers();
    } else if (e.code >= 'Digit1' && e.code <= 'Digit5') {
      const view = Object.keys(CAMERA_VIEWS)[Number(e.code.slice(5)) - 1] as CameraView;
      this.settings.camera = view;
      this.setCamera(view);
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  /** Shift+click on the near half of the table moves the machine's landing target. */
  private onPointerDown(e: PointerEvent) {
    if (!e.shiftKey) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE.height);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(plane, hit)) return;
    if (hit.z < 0.02 || hit.z > TABLE.halfLength || Math.abs(hit.x) > TABLE.halfWidth) return;
    this.machine.targetX = hit.x;
    this.machine.targetZ = hit.z;
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.updateMachineVisuals();
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildGui() {
    const gui = (this.gui = new GUI({ title: 'MEM Table Tennis · Physics Sandbox' }));
    const onMachine = () => this.updateMachineVisuals();

    const mf = gui.addFolder('Ball machine');
    mf.add(this.machine, 'preset', PRESETS.map((p) => p.name))
      .name('Preset')
      .onChange((name: string) => {
        Object.assign(this.machine, this.settingsFromPreset(PRESETS.find((p) => p.name === name)!));
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        onMachine();
        this.fire();
      });
    mf.add({ fire: () => this.fire() }, 'fire').name('Fire  [Space]');
    mf.add(this.machine, 'autoFire').name('Auto-fire');
    mf.add(this.machine, 'interval', 0.8, 6, 0.1).name('Interval (s)');
    mf.add(this.machine, 'scatter', 0, 0.4, 0.01).name('Target scatter (m)');

    const sf = mf.addFolder('Shot');
    sf.add(this.machine, 'speed', 2, 35, 0.5).name('Speed (m/s)').onChange(onMachine);
    sf.add(this.machine, 'topspin', -150, 150, 1).name('Top(+)/Back(−) rps').onChange(onMachine);
    sf.add(this.machine, 'sidespin', -100, 100, 1).name('Sidespin rps').onChange(onMachine);
    sf.add(this.machine, 'corkscrew', -100, 100, 1).name('Corkscrew rps').onChange(onMachine);
    sf.add(this.machine, 'highArc').name('High arc (lob)').onChange(onMachine);

    const pf = mf.addFolder('Position & target');
    pf.add(this.machine, 'distanceBack', -0.6, 4, 0.05).name('Contact: back (m)').onChange(onMachine);
    pf.add(this.machine, 'height', -0.3, 1.2, 0.01).name('Contact: height (m)').onChange(onMachine);
    pf.add(this.machine, 'lateral', -1.2, 1.2, 0.05).name('Contact: side (m)').onChange(onMachine);
    pf.add(this.machine, 'targetX', -TABLE.halfWidth, TABLE.halfWidth, 0.01).name('Target across (m)').onChange(onMachine);
    pf.add(this.machine, 'targetZ', 0.05, TABLE.halfLength, 0.01).name('Target depth (m)').onChange(onMachine);
    pf.close();

    const vf = gui.addFolder('View & time');
    vf.add(this.settings, 'timeScale', 0.02, 1, 0.01).name('Time scale');
    vf.add(this.settings, 'paused').name('Paused  [P]');
    vf.add({ step: () => this.step() }, 'step').name('Step one tick  [.]');
    vf.add(this.settings, 'camera', Object.keys(CAMERA_VIEWS)).name('Camera  [1–5]').onChange((v: CameraView) => this.setCamera(v));
    vf.add(this.settings, 'showPrediction').name('Predicted path').onChange((v: boolean) => (this.predictionLine.visible = v && !!this.sim));
    vf.add(this.settings, 'showTrail').name('Spin trail').onChange((v: boolean) => (this.ball.trailVisible = v));
    vf.add(this.settings, 'showSpinAxis').name('Spin axis').onChange((v: boolean) => (this.ball.showAxis = v));
    vf.add({ clear: () => this.clearMarkers() }, 'clear').name('Clear bounce marks  [C]');

    const tf = gui.addFolder('Physics tuning');
    const p = this.params;
    tf.add(p, 'dragCoefficient', 0.2, 0.8, 0.01).name('Drag Cd');
    tf.add(p, 'liftCoefficientMax', 0, 0.8, 0.01).name('Magnus lift max');
    tf.add(p, 'liftHalfSpinRatio', 0.1, 3, 0.05).name('Lift half-spin ratio');
    tf.add(p, 'spinDecay', 0, 2, 0.01).name('Spin decay (1/s)');
    tf.add(p, 'tableRestitution', 0.6, 1, 0.005).name('Table bounce (e)');
    tf.add(p, 'tableRestitutionSpeedLoss', 0, 0.05, 0.001).name('Bounce loss / m/s');
    tf.add(p, 'tableFriction', 0, 0.8, 0.01).name('Table friction');
    tf.add(p, 'tableSpinBite', 0, 0.1, 0.001).name('Spin bite');
    tf.add(p, 'tableFrictionMax', 0.2, 1.2, 0.01).name('Friction max');
    tf.add(p, 'netRestitution', 0, 0.8, 0.01).name('Net bounce');
    tf.add(
      {
        reset: () => {
          Object.assign(p, DEFAULT_PARAMS);
          tf.controllersRecursive().forEach((c) => c.updateDisplay());
          onMachine();
        },
      },
      'reset',
    ).name('Reset to defaults');
    tf.add(
      {
        copy: () => {
          void navigator.clipboard?.writeText(JSON.stringify(p, null, 2));
          this.hud.flash('COPIED', 'Physics params copied to clipboard');
        },
      },
      'copy',
    ).name('Copy params as JSON');
    tf.onChange(onMachine);
    tf.close();
  }
}

function createMachineMesh(): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.22), new THREE.MeshStandardMaterial({ color: 0x3b4252, roughness: 0.6 }));
  body.position.y = -0.11;
  body.castShadow = true;
  g.add(body);
  const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2, 8), new THREE.MeshStandardMaterial({ color: 0x2b2e35 }));
  stand.position.y = -1.19;
  g.add(stand);
  const barrel = new THREE.Group();
  barrel.name = 'barrel';
  const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0xe8562a, roughness: 0.4 }));
  tube.rotation.x = Math.PI / 2;
  tube.position.z = -0.06;
  tube.castShadow = true;
  barrel.add(tube);
  g.add(barrel);
  return g;
}
