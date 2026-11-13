import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {
  BallSim,
  DEFAULT_PARAMS,
  RUBBERS,
  TABLE,
  TICK_DT,
  describeSpin,
  launchDirection,
  launchState,
  lerp,
  radToRpm,
  solveAim,
  spinComponents,
  length,
  v3,
  type BallEvent,
  type PhysicsParams,
  type Vec3,
} from '../physics';
import { Player } from '../game/player';
import { AI_LEVELS, AiPlayer, type AiLevel } from '../game/ai';
import { DEFAULT_REALISM, REALISM_PRESETS, realismSettings } from '../game/realism';
import { STYLES, STYLE_IDS, type StyleId } from '../game/styles';
import { IncomingPrediction } from '../game/intercept';
import { Match } from '../game/match';
import { LET_MESSAGE, pointMessage } from '../game/messages';
import { classifyShot } from '../game/shots';
import { NO_INPUT, REACH, type SwingInput } from '../game/swing';
import { BallView, spinColor } from '../render/ballView';
import { PlayerView } from '../render/playerView';
import { createScene } from '../render/scene';
import { Hud, MatchHud, type ShotReport, type ReturnReport, type PracticeStats } from './hud';
import { Lobby } from './lobby';
import { RallyRecorder, ReplayPlayer, type ViewFrame } from './replay';
import { Sfx } from '../audio/sfx';
import { TouchControls, isTouchDevice } from '../input/touch';
import { TiltControl } from '../input/tilt';
import { AutoQuality, QUALITY_LEVELS, type QualitySetting } from '../render/quality';
import { Career } from '../progress/profile';
import { DRILLS, DrillSession, drillUnlocked } from '../progress/drills';
import { TOURNAMENTS, TournamentRun, tournamentUnlocked } from '../progress/tournament';
import { isUnlocked, newlyUnlocked, unlockedKeys, UNLOCKS, type UnlockKind } from '../progress/unlocks';
import { CareerScreen } from './career';
import { VENUES, setVenue, type Venue, type VenueId } from '../render/venues';
import { OnlineClient } from '../net/client';
import { LocalServer, WebSocketTransport, roomUrl, type Transport } from '../net/transport';
import { fromV, isRoomCode, randomRoomCode, seatSide, type GameMode, type Seat } from '../net/protocol';
import { mapVec, mapState, type SideId } from '../game/frame';
import { PRESETS, type Preset } from './presets';

type CameraView = 'Player' | 'Side' | 'Top' | 'Broadcast' | 'Machine';

const CAMERA_VIEWS: Record<CameraView, { pos: [number, number, number]; target: [number, number, number] }> = {
  Player: { pos: [0, 1.45, 2.7], target: [0, 0.8, -0.4] },
  Side: { pos: [3.4, 1.4, 0.2], target: [0, 0.8, 0.2] },
  Top: { pos: [0, 5.2, 0.01], target: [0, 0.76, 0] },
  Broadcast: { pos: [-2.6, 2.9, 4.4], target: [0, 0.7, 0] },
  Machine: { pos: [0, 1.35, -3.4], target: [0, 0.8, 0.6] },
};

/** Holding Space this long gives the highest toss, seconds. */
const TOSS_HOLD_MAX = 0.9;

/** Where the auto-aimed paddle face points on the far half. */
const AIM_POINT = { x: 0, z: -0.85 };

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
  scatter: number;
  /** Cycle through a list of presets when auto-firing in play mode. */
  mix: boolean;
}

/** Rally state for practice: the machine's ball, then (maybe) the player's return. */
type Phase = 'idle' | 'incoming' | 'returned' | 'done';

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
    showPrediction: false,
    showTrail: true,
    showSpinAxis: true,
    showIntercept: true,
    camera: 'Player' as CameraView,
  };
  machine: MachineSettings;

  // Play mode
  player: Player;
  private playerView: PlayerView;
  private playing = false;
  private input: SwingInput = { ...NO_INPUT };
  private keys = new Set<string>();
  private phase: Phase = 'idle';
  private sinceResolved = 0;
  private incoming: IncomingPrediction | null = null;
  private stats: PracticeStats = { attempts: 0, made: 0, streak: 0, best: 0 };
  private mixIndex = 0;
  private lastReturn: ReturnReport | null = null;

  // Match vs AI
  match: Match | null = null;
  private ai: AiPlayer | null = null;
  private aiView: PlayerView;
  private matchHud: MatchHud;
  matchSettings = { level: 'medium' as AiLevel, bestOf: 3, aiStyle: 'random' as StyleId | 'random' };
  /** Realism slider (0 = simulation, 100 = arcade), for offline play and new rooms. */
  realism = { percent: Math.round(DEFAULT_REALISM * 100), style: 'allround' as StyleId };
  /** Game speed from the realism slider (offline). */
  private gameSpeed = realismSettings(DEFAULT_REALISM).gameSpeed;

  /** Apply the local realism slider: assists, spin curve and game speed. */
  applyRealism() {
    const a = this.realism.percent / 100;
    const r = realismSettings(a);
    this.player.applyRealism(a);
    this.params.liftCoefficientMax = DEFAULT_PARAMS.liftCoefficientMax * r.spinCurve;
    this.gameSpeed = r.gameSpeed;
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  private tossHoldStart: number | null = null;

  // Look, sound and replays
  sfx = new Sfx();
  private venue: Venue | null = null;
  look = {
    venue: (loadPref('mem.venue', 'office') as VenueId) in VENUES ? (loadPref('mem.venue', 'office') as VenueId) : 'office',
    volume: Number(loadPref('mem.volume', '0.7')),
    muted: loadPref('mem.muted', '0') === '1',
    ambience: loadPref('mem.ambience', '1') === '1',
    autoReplay: loadPref('mem.autoReplay', '1') === '1',
  };
  private recorder = new RallyRecorder();
  private replay: ReplayPlayer | null = null;
  private autoReplayed: unknown = null;
  private savedCamera: { pos: THREE.Vector3; target: THREE.Vector3; visible: Map<string, boolean> } | null = null;

  // Progression
  career = new Career();
  private careerScreen!: CareerScreen;
  private unlocked = new Set<string>();
  private drill: DrillSession | null = null;
  private drillZone: THREE.Mesh | null = null;
  private tournament: TournamentRun | null = null;
  private matchRecorded = false;
  private rallyHits = 0;

  // Mobile and performance
  readonly isTouch = isTouchDevice();
  private touch: TouchControls;
  tilt = new TiltControl();
  quality = { setting: (loadPref('mem.quality', 'auto') === 'auto' ? 'auto' : Number(loadPref('mem.quality', 'auto'))) as QualitySetting, showFps: false, tilt: false };
  private autoQuality: AutoQuality;
  private qualityLevel = -1;

  // Online
  online: OnlineClient | null = null;
  private localServer: LocalServer | null = null;
  private lobby: Lobby;
  private remoteViews = new Map<Seat, PlayerView>();
  onlineSettings = {
    name: loadPref('mem.name', 'Player'),
    server: loadPref('mem.server', DEFAULT_SERVER),
    code: '',
    mode: 'singles' as GameMode,
    bestOf: 3,
    aiLevel: 'medium' as AiLevel,
  };

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

    this.player = new Player('p1', this.params);
    this.playerView = new PlayerView(this.scene);
    this.playerView.visible = false;
    this.aiView = new PlayerView(this.scene, { bodyColor: 0xe8562a, bodyOpacity: 0.45 });
    this.aiView.visible = false;
    this.matchHud = new MatchHud(container);
    this.matchHud.onRematch = () => (this.online ? this.onlineRematch() : this.startMatch());
    this.matchHud.onExit = () => (this.online ? this.backToLobby() : this.endMatch());
    this.lobby = new Lobby(container);
    this.lobby.onStart = () => {
      this.online?.start(this.lobby.fillAI);
    };
    this.lobby.onLeave = () => this.leaveOnline();

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

    this.machine = this.settingsFromPreset(PRESETS.find((p) => p.name === 'Long push')!);
    // Touch controls (phones/tablets) and adaptive quality.
    this.touch = new TouchControls(container);
    this.touch.onServeStart = () => {
      if ((this.match?.humanToServe || this.online?.myServe) && this.playing) this.tossHoldStart = performance.now();
    };
    this.touch.onServeEnd = () => this.releaseToss();
    this.touch.onReplay = () => (this.replay ? this.stopReplay() : this.startReplay());
    this.touch.onMenu = () => this.setPlaying(false);
    this.autoQuality = new AutoQuality(this.isTouch ? 1 : 2);
    if (this.isTouch) {
      document.body.classList.add('touch');
      // A bit more forgiving on a phone.
      this.realism.percent = 75;
    }

    // Career: toasts for XP / promotions / achievements / unlocks.
    this.unlocked = unlockedKeys(this.career.data, this.career.levelIndex);
    this.careerScreen = new CareerScreen(container, this.career);
    this.careerScreen.onClose = () => this.careerScreen.hide();
    this.careerScreen.onStartDrill = (id) => this.startDrill(id);
    this.careerScreen.onStartTournament = (id) => this.startTournament(id);
    this.careerScreen.onPlayRound = () => this.playTournamentRound();
    this.careerScreen.onAbandonTournament = () => {
      this.tournament = null;
      this.careerScreen.run = null;
      this.careerScreen.render();
    };
    this.hud.onCareer = () => this.openCareer();
    this.career.on((e) => {
      if (e.type === 'level') {
        this.hud.flash('PROMOTED', `You are now ${e.title}`);
        this.sfx.point(true, true);
      } else if (e.type === 'achievement') this.hud.toast(`🏅 <b>${e.achievement.name}</b> — ${e.achievement.description}`);
      else if (e.type === 'xp' && e.amount >= 20) this.hud.toast(`+${e.amount} XP · ${e.reason}`);
      for (const u of newlyUnlocked(this.unlocked, this.career.data, this.career.levelIndex)) {
        this.unlocked.add(`${u.kind}:${u.id}`);
        this.hud.toast(`🔓 Unlocked <b>${this.unlockLabel(u.kind, u.id)}</b>`);
      }
    });

    this.buildGui();
    if (this.isTouch || window.innerWidth < 700) this.gui.close();
    this.applyQuality();
    this.applyRealism();
    // A venue saved before progression existed might still be locked.
    this.setVenue(isUnlocked('venue', this.look.venue, this.career.data, this.career.levelIndex) ? this.look.venue : 'office');
    this.playerView.setStyle(this.player.style.id);
    this.sfx.volume = this.look.volume;
    this.sfx.muted = this.look.muted;
    this.sfx.ambienceOn = this.look.ambience;
    // Browsers only allow audio after a user gesture.
    const unlock = () => this.sfx.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    this.updateMachineVisuals();

    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('blur', () => this.keys.clear());
    const canvas = this.renderer.domElement;
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.input.drive = false;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.playing) return;
      this.input.dx += e.movementX;
      this.input.dy += e.movementY;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.playing) return;
        e.preventDefault();
        const s = this.player.swing;
        s.basePitch = THREE.MathUtils.clamp(s.basePitch + (e.deltaY < 0 ? 4 : -4), -60, 60);
      },
      { passive: false },
    );
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('pointerlockchange', () => this.setPlaying(document.pointerLockElement === canvas));
    this.hud.onStartPlay = () => this.requestPlay();

    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());

    // Invite links: ?room=CODE joins that room.
    const invited = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (invited && isRoomCode(invited)) {
      this.onlineSettings.code = invited;
      this.joinOnline(invited);
    }
  }

  // ---------------------------------------------------------------- play mode

  requestPlay() {
    // Phones have no mouse to capture: just start.
    if (this.isTouch) return this.setPlaying(true);
    const canvas = this.renderer.domElement;
    // Pointer lock may be unavailable (e.g. in automated tests); fall back to play without it.
    const req = canvas.requestPointerLock?.() as unknown as Promise<void> | undefined;
    if (req && typeof req.catch === 'function') req.catch(() => this.setPlaying(true));
    else if (!canvas.requestPointerLock) this.setPlaying(true);
  }

  setPlaying(on: boolean) {
    if (this.playing === on) return;
    this.playing = on;
    this.controls.enabled = !on;
    this.touch.show(on && this.isTouch);
    document.body.classList.toggle('playing', on);
    this.playerView.visible = on;
    this.targetRing.visible = !on && !this.match;
    this.hud.setPlaying(on);
    if (on) {
      this.input = { ...NO_INPUT };
      this.player.swing.reset(0.4, TABLE.height + 0.25, this.player.restZ, this.player.body.x);
      if (!this.match) {
        this.phase = 'done';
        this.sinceResolved = 0.5;
      }
    } else {
      this.tossHoldStart = null;
      this.setCamera(this.settings.camera);
    }
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
      scatter: this.machine?.scatter ?? 0.15,
      mix: this.machine?.mix ?? false,
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
    if (this.match) return;
    this.recorder.start(this.clock());
    this.recorder.caption(this.clock(), `Ball machine: ${this.machine.preset}`);
    if (this.drill) {
      const name = this.drill.nextPreset();
      if (!name) return this.finishDrill();
      Object.assign(this.machine, this.settingsFromPreset(PRESETS.find((p) => p.name === name)!), { scatter: 0.12 });
      this.updateMachineVisuals();
      this.updateDrillHud();
    } else if (this.playing && this.machine.mix) {
      const p = PRESETS[this.mixIndex++ % PRESETS.length];
      Object.assign(this.machine, this.settingsFromPreset(p));
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
      this.updateMachineVisuals();
    }
    const m = this.machine;
    const jitter = () => (Math.random() * 2 - 1) * m.scatter;
    const target = {
      x: THREE.MathUtils.clamp(m.targetX + jitter(), -TABLE.halfWidth + 0.05, TABLE.halfWidth - 0.05),
      z: THREE.MathUtils.clamp(m.targetZ + jitter(), 0.1, TABLE.halfLength - 0.05),
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
    this.phase = 'incoming';
    this.lastReturn = null;

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
    this.hud.showShot(this.report, this.playing ? null : undefined);

    // Full predicted flight, used for the dashed preview and the intercept marker.
    this.incoming = new IncomingPrediction(start, this.params);
    this.predictionLine.geometry.dispose();
    this.predictionLine.geometry = new THREE.BufferGeometry().setFromPoints(this.incoming.path.map(({ pos: p }) => new THREE.Vector3(p.x, p.y, p.z)));
    this.predictionLine.computeLineDistances();
    this.predictionLine.visible = this.settings.showPrediction;
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
    const aim = solveAim(o, { x: this.machine.targetX, z: this.machine.targetZ }, this.machine.speed, this.spin(), this.params, this.machine.highArc);
    this.aimMachine(aim.elevation, aim.azimuth);
    (this.targetRing.material as THREE.MeshBasicMaterial).color.set(aim.ok ? 0xffd34d : 0xff4d4d);
    this.hud.setAimWarning(aim.ok ? null : 'Target not reachable with this speed/spin — the shot will miss.');
  }

  // ---------------------------------------------------------------- intercept

  /** Where (and when) the incoming ball reaches the player's hitting plane. */
  computeIntercept(now: number) {
    if (this.phase !== 'incoming' || !this.incoming) return null;
    return this.incoming.interceptAt(this.player.restZ, now, REACH.maxHeight - 0.05);
  }

  // ---------------------------------------------------------------- events

  private handleEvent(e: BallEvent) {
    this.ballSound(e);
    if (e.type === 'floor' && !this.playing) this.recorder.end(this.clock());
    if (e.type === 'paddle') return this.onPaddleHit(e);
    if (!this.report) return;
    const r = this.report;
    const returned = this.phase === 'returned';

    switch (e.type) {
      case 'netCross':
        if (!returned && e.direction === 'near' && r.netClearance === undefined) r.netClearance = e.clearance;
        if (returned && this.lastReturn && e.direction === 'far') this.lastReturn.netClearance = e.clearance;
        break;
      case 'net':
        if (!returned) r.netTouches = (r.netTouches ?? 0) + 1;
        this.hud.flash(e.part === 'tape' ? 'NET CORD' : 'PACKET LOSS', e.part === 'tape' ? 'Clipped the tape' : 'Into the net');
        break;
      case 'table': {
        this.addMarker(e.pos, spinColor(e.velIn, e.spinIn));
        if (returned) {
          if (this.lastReturn && !this.lastReturn.result) this.resolveReturn(e.side === 'far' ? 'IN' : 'OWN SIDE', e.pos);
          break;
        }
        r.bounces.push({
          side: e.side,
          x: e.pos.x,
          z: e.pos.z,
          time: e.time,
          speedIn: length(e.velIn),
          speedOut: length(e.velOut),
          angleOut: (Math.atan2(e.velOut.y, Math.hypot(e.velOut.x, e.velOut.z)) * 180) / Math.PI,
          spinOut: spinComponents(e.velOut, e.spinOut),
          rpmOut: radToRpm(length(e.spinOut)),
        });
        if (r.result === undefined) {
          if (e.side === 'near') r.result = 'IN';
          else if (r.bounces.length === 1 && e.pos.z < 0) r.result = 'FAULT';
        }
        // A second bounce on the near half before the player hit it: missed.
        if (this.playing && this.phase === 'incoming' && e.side === 'near' && r.bounces.filter((b) => b.side === 'near').length >= 2) this.resolveMiss();
        break;
      }
      case 'floor':
        if (returned) {
          if (this.lastReturn && !this.lastReturn.result) this.resolveReturn('OUT');
        } else {
          if (r.result === undefined) {
            r.result = 'OUT';
            this.hud.flash('404', 'Ball not found (on the table)');
          }
          if (this.playing && this.phase === 'incoming') {
            if (r.result === 'IN') this.resolveMiss();
            else this.resolve();
          }
        }
        break;
    }
    this.hud.showShot(r, this.playing ? this.lastReturn : undefined);
  }

  private onPaddleHit(e: Extract<BallEvent, { type: 'paddle' }>) {
    if (this.phase !== 'incoming') return;
    this.phase = 'returned';
    const info = classifyShot(e.pos, e.velOut, e.spinOut, e.paddleVel, e.velIn, e.spinIn);
    this.lastReturn = { ...info, paddleSpeed: length(e.paddleVel), wing: this.player.swing.side, rubber: this.player.rubbers[this.player.swing.side].name };
    this.hitSound(e.impactSpeed + length(e.paddleVel), this.player.rubbers[this.player.swing.side].kind, e.pos.x);
    this.career.recordShot(info.name, info.speed, info.rpm);
    this.recorder.caption(this.clock(), `You: ${info.name} · ${info.speed.toFixed(1)} m/s · ${Math.round(info.rpm).toLocaleString()} rpm`);
    this.ball.clearTrail();
    this.player.intercept = null;
    this.hud.showShot(this.report!, this.lastReturn);
  }

  private resolveReturn(result: ReturnReport['result'], landing?: Vec3) {
    if (!this.lastReturn) return;
    this.lastReturn.result = result;
    this.career.recordPractice(result === 'IN');
    this.drillRegister(result!, landing);
    this.stats.attempts++;
    if (result === 'IN') {
      this.stats.made++;
      this.stats.streak++;
      this.stats.best = Math.max(this.stats.best, this.stats.streak);
    } else {
      this.stats.streak = 0;
      if (result === 'OUT') this.hud.flash('404', 'Ball not found (on the table)');
      if (result === 'OWN SIDE') this.hud.flash('SEGFAULT', 'Bounced on your own side');
    }
    this.hud.setStats(this.stats);
    this.updateDrillHud();
    this.resolve();
  }

  private resolveMiss() {
    this.lastReturn = { name: 'Missed', speed: 0, top: 0, side: 0, cork: 0, rpm: 0, elevation: 0, paddleSpeed: 0, wing: null, rubber: '', result: 'MISSED' };
    this.stats.attempts++;
    this.stats.streak = 0;
    this.career.recordPractice(false);
    this.drillRegister('MISSED');
    this.hud.flash('TIMEOUT', 'Request not handled');
    this.hud.setStats(this.stats);
    this.updateDrillHud();
    this.resolve();
  }

  private resolve() {
    this.recorder.end(this.clock());
    this.phase = 'done';
    this.sinceResolved = 0;
    this.player.intercept = null;
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

    this.localServer?.pump();
    if (this.replay) {
      // Online the match carries on underneath (it can't be paused for one player).
      if (this.online) this.onlineFrame(realDt);
      this.runReplay(realDt);
    } else {
      if (this.online) this.onlineFrame(realDt);
      else if (this.match) this.matchFrame(realDt);
      else {
        if (this.playing) this.updatePlayer(realDt);
        if (!this.settings.paused) this.advance(realDt * this.settings.timeScale * this.gameSpeed, realDt);
      }
      this.recordFrame();
      this.maybeAutoReplay();
      if (this.playing) this.updatePlayCamera(realDt);
    }
    this.venue?.update(realDt, now / 1000);
    // Your own character: just the racket arm in first person, the full character otherwise.
    this.playerView.setFirstPerson(this.playing && !this.replay);
    // Touch: show Serve only when it's your serve. Tilt: phone tilt sets the face angle.
    if (this.isTouch) this.touch.setServeVisible(!!(this.match?.humanToServe || this.online?.myServe));
    if (this.tilt.active) this.player.swing.basePitch = this.tilt.pitch;
    // Adaptive quality.
    if (this.quality.setting === 'auto' && this.autoQuality.sample(realDt)) this.applyQuality();
    this.hud.setFps(this.quality.showFps ? `${this.autoQuality.fps} fps · ${QUALITY_LEVELS[this.qualityLevel].name}` : null);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  /** Current human input (mouse deltas accumulated since the last frame, plus held keys). */
  private gatherInput() {
    const k = this.keys;
    const t = this.touch.buttons;
    const swipe = this.touch.swipe.consume();
    const input: SwingInput = {
      ...this.input,
      dx: this.input.dx + swipe.dx,
      dy: this.input.dy + swipe.dy,
      drive: this.input.drive || t.drive,
      close: k.has('KeyW') || t.close,
      open: k.has('KeyS') || t.open,
      hookLeft: k.has('KeyA') || t.hookLeft,
      hookRight: k.has('KeyD') || t.hookRight,
    };
    const move = {
      x: (k.has('ArrowRight') ? 1 : 0) - (k.has('ArrowLeft') ? 1 : 0),
      z: (k.has('ArrowDown') ? 1 : 0) - (k.has('ArrowUp') ? 1 : 0),
    };
    this.input.dx = 0;
    this.input.dy = 0;
    return { input, move };
  }

  private updatePlayer(realDt: number) {
    const { input, move } = this.gatherInput();
    const now = this.sim?.time ?? 0;
    const intercept = this.computeIntercept(now)?.pos ?? null;
    this.player.intercept = intercept;
    this.player.update(realDt, input, move, AIM_POINT);
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? intercept : null);
    this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive);
  }

  // ---------------------------------------------------------------- match vs AI

  startMatch() {
    this.leaveOnline();
    this.endMatch(false);
    this.stopDrill();
    this.careerScreen?.hide();
    this.matchRecorded = false;
    const ai = (this.ai = new AiPlayer('far', AI_LEVELS[this.matchSettings.level], this.params));
    const st = this.matchSettings.aiStyle === 'random' ? STYLE_IDS[Math.floor(Math.random() * STYLE_IDS.length)] : this.matchSettings.aiStyle;
    ai.setStyle(STYLES[st]);
    this.aiView.setStyle(st);
    const match = (this.match = new Match(
      this.params,
      { near: { kind: 'human', player: this.player }, far: { kind: 'ai', ai } },
      { bestOf: this.matchSettings.bestOf, pointsToWin: 11, firstServer: Math.random() < 0.5 ? 'near' : 'far' },
    ));
    const names = { near: 'You', far: ai.displayName };
    match.on((e) => {
      switch (e.type) {
        case 'toss':
          this.ball.clearTrail();
          this.clearMarkers();
          this.recorder.start(this.clock());
          this.sfx.toss();
          break;
        case 'hit': {
          const h = e.event;
          const info = classifyShot(h.pos, h.velOut, h.spinOut, h.paddleVel, h.velIn, h.spinIn);
          const who = e.side === 'near' ? 'You' : ai.displayName;
          const name = e.serve ? 'Serve' : info.name;
          this.matchHud.addShot({ who, name, speed: info.speed, rpm: info.rpm, top: info.top });
          this.hitSound(h.impactSpeed + length(h.paddleVel), e.side === 'near' ? this.player.rubbers[this.player.swing.side].kind : ai.rubber.kind, h.pos.x);
          this.recorder.caption(this.clock(), `${who}: ${name} · ${info.speed.toFixed(1)} m/s · ${Math.round(info.rpm).toLocaleString()} rpm`);
          if (e.side === 'near' && !e.serve) this.career.recordShot(info.name, info.speed, info.rpm);
          this.ball.clearTrail();
          break;
        }
        case 'ball':
          if (e.event.type !== 'paddle') this.ballSound(e.event);
          if (e.event.type === 'table') this.addMarker(e.event.pos, spinColor(e.event.velIn, e.event.spinIn));
          break;
        case 'let':
          this.hud.flash(LET_MESSAGE.title, LET_MESSAGE.sub);
          this.recorder.end(this.clock());
          break;
        case 'point': {
          this.recorder.end(this.clock());
          this.sfx.point(e.result.winner === 'near', e.game);
          this.updateVenueScreen();
          this.career.recordPoint(e.result.winner === 'near', { ace: e.result.ace, rallyHits: match.referee?.hits });
          const m = pointMessage(e.result, names);
          if (e.match) this.hud.flash(e.result.winner === 'near' ? 'SHIPPED TO PROD' : 'INCIDENT REPORT', e.result.winner === 'near' ? 'You won the match!' : `${ai.displayName} won the match`);
          else if (e.game) this.hud.flash(e.result.winner === 'near' ? 'DEPLOYED' : 'ROLLBACK', `Game to ${names[e.result.winner]} — ${m.title}: ${m.sub}`);
          else this.hud.flash(m.title, m.sub);
          break;
        }
      }
    });
    this.machineMesh.visible = false;
    this.targetRing.visible = false;
    this.predictionLine.visible = false;
    this.sim = null;
    this.ball.visible = true;
    this.aiView.visible = true;
    this.hud.setMatchMode(true);
    this.matchHud.show(true);
    this.matchHud.hideOver();
    this.clearMarkers();
    this.requestPlay();
  }

  endMatch(restoreUi = true) {
    if (!this.match) return;
    this.match = null;
    this.ai = null;
    this.tossHoldStart = null;
    this.aiView.visible = false;
    this.matchHud.show(false);
    if (!restoreUi) return;
    this.machineMesh.visible = true;
    this.targetRing.visible = !this.playing;
    this.ball.visible = false;
    this.hud.setMatchMode(false);
    this.phase = 'done';
    this.sinceResolved = 0;
  }

  private matchFrame(realDt: number) {
    const match = this.match!;
    const ai = this.ai!;
    const running = this.playing && !this.settings.paused && match.phase !== 'match-over';
    if (running) {
      const { input, move } = this.gatherInput();
      match.frame(realDt * this.settings.timeScale * this.gameSpeed, realDt, { side: 'near', input, move });
      this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive);
    }

    // Players and ball.
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? match.interceptFor('near') : null);
    const pose = ai.worldPose;
    const body = ai.worldBody;
    this.aiView.updatePose(pose, body, pose.pos.x <= body.x ? 'forehand' : 'backhand');
    const state = match.sim?.state ?? { pos: match.ballRenderPos(), vel: v3(), spin: v3() };
    if (running && match.sim) this.ball.rotate(state.spin, realDt * this.settings.timeScale);
    this.ball.update(match.ballRenderPos(), state);
    if (!match.sim) this.ball.clearTrail();

    // Scoreboard.
    const sc = match.score;
    const gp = sc.gamePoint();
    const mp = sc.matchPoint();
    const badge = sc.deuce ? 'DEUCE · RACE CONDITION' : mp ? `MATCH POINT · ${mp === 'near' ? 'You' : ai.displayName}` : gp ? `GAME POINT · ${gp === 'near' ? 'You' : ai.displayName}` : null;
    this.matchHud.setScore({
      you: 'You',
      them: `${ai.displayName} (AI)`,
      points: [sc.points.near, sc.points.far],
      games: [sc.games.near, sc.games.far],
      youServe: (match.phase === 'rally' || match.phase === 'point-over') && match.referee ? match.referee.server === 'near' : sc.server === 'near',
      badge,
      bestOf: sc.config.bestOf,
    });

    // Prompts.
    if (match.phase === 'match-over') {
      const won = sc.winner === 'near';
      if (!this.matchRecorded) {
        this.matchRecorded = true;
        this.career.recordMatch(won, { aiLevel: this.matchSettings.level, style: this.player.style.id });
        if (this.tournament) return this.reportTournamentMatch(won, `${sc.games.near}–${sc.games.far}`);
      }
      if (this.tournament) return;
      const games = sc.history.map((g) => `${g.near}–${g.far}`).join('  ·  ');
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
      this.matchHud.showOver(won ? 'SHIPPED TO PROD' : 'INCIDENT REPORT', won ? `You beat ${ai.displayName} ${sc.games.near}–${sc.games.far}` : `${ai.displayName} won ${sc.games.far}–${sc.games.near}`, games);
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    if (!this.playing) {
      this.matchHud.setPrompt('Match paused — click <b>▶ Resume match</b> to continue');
      this.matchHud.setMeter(null);
    } else if (match.humanToServe) {
      this.matchHud.setPrompt(this.servePrompt());
      this.matchHud.setMeter(this.tossHoldStart !== null ? (performance.now() - this.tossHoldStart) / 1000 / TOSS_HOLD_MAX : null);
    } else {
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
    }
  }

  private releaseToss() {
    if (this.tossHoldStart === null || (!this.match && !this.online)) return;
    const held = Math.min(TOSS_HOLD_MAX, (performance.now() - this.tossHoldStart) / 1000);
    this.tossHoldStart = null;
    const h = 0.2 + (held / TOSS_HOLD_MAX) * 0.9;
    if (this.online) this.online.toss(h);
    else this.match!.toss(h);
  }

  private servePrompt() {
    return this.isTouch
      ? 'Your serve: hold <b>Serve</b> to toss (longer = higher), release, then swipe as it drops'
      : 'Your serve: hold <kbd>Space</kbd> to toss (longer = higher), release, then swing as it drops';
  }

  // ---------------------------------------------------------------- career, drills, tournaments

  private unlockLabel(kind: UnlockKind, id: string) {
    if (kind === 'venue') return VENUES[id as VenueId]?.name ?? id;
    if (kind === 'style') return STYLES[id as StyleId]?.character ?? id;
    return `${RUBBERS[id]?.name} (${RUBBERS[id]?.kind})`;
  }

  /** True (and tells the player how to unlock it) if an item is still locked. */
  private locked(kind: UnlockKind, id: string): boolean {
    if (isUnlocked(kind, id, this.career.data, this.career.levelIndex)) return false;
    const rule = UNLOCKS.find((u) => u.kind === kind && u.id === id)!;
    this.hud.flash('LOCKED', `${this.unlockLabel(kind, id)}: ${rule.requirement}`);
    return true;
  }

  openCareer() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    this.careerScreen.run = this.tournament;
    this.careerScreen.show();
  }

  startDrill(id: string) {
    const idx = DRILLS.findIndex((d) => d.id === id);
    if (idx < 0 || !drillUnlocked(idx, this.career.data.drills, this.career.data.unlockAll)) return;
    this.leaveOnline();
    this.endMatch();
    this.tournament = null;
    this.careerScreen.hide();
    this.drill = new DrillSession(DRILLS[idx]);
    this.machine.mix = false;
    this.clearMarkers();
    // Target zone, if the drill has one.
    if (this.drillZone) this.scene.remove(this.drillZone);
    this.drillZone = null;
    const z = this.drill.drill.target;
    if (z) {
      this.drillZone = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.z1 - z.z0), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.28, depthWrite: false }));
      this.drillZone.rotation.x = -Math.PI / 2;
      this.drillZone.position.set((z.x0 + z.x1) / 2, TABLE.height + 0.002, (z.z0 + z.z1) / 2);
      this.scene.add(this.drillZone);
    }
    this.hud.flash('DRILL', this.drill.drill.description);
    this.phase = 'done';
    this.sinceResolved = -1.2; // give the player a moment to read
    this.updateDrillHud();
    this.requestPlay();
  }

  private drillRegister(result: NonNullable<ReturnReport['result']>, landing?: Vec3) {
    if (!this.drill) return;
    const r = this.lastReturn;
    const ok = this.drill.register({ result, shot: r?.name ?? '-', top: r?.top ?? 0, speed: r?.speed ?? 0, landing: landing && { x: landing.x, z: landing.z } });
    if (ok) this.sfx.point(true);
    if (this.drill.done) setTimeout(() => this.finishDrill(), 900);
  }

  private updateDrillHud() {
    if (!this.drill) return;
    const d = this.drill;
    const marks = d.log.map((ok) => (ok ? '✓' : '✗')).join('');
    this.hud.setStatsText(`<b>${d.drill.name}</b> · ball ${Math.min(d.fed, d.drill.balls)}/${d.drill.balls} · ${d.successes} ✓ · goal: ${d.drill.goal} <span style="letter-spacing:1px">${marks}</span>`);
  }

  private finishDrill() {
    const d = this.drill;
    if (!d) return;
    this.career.recordDrill(d.drill.id, d.stars, DRILLS.map((x) => x.id));
    this.stopDrill();
    this.openCareer();
    this.careerScreen.drillResult(d);
  }

  private stopDrill() {
    if (this.drillZone) this.scene.remove(this.drillZone);
    this.drillZone = null;
    this.drill = null;
    this.hud.setStats(this.stats);
  }

  startTournament(id: string) {
    const t = TOURNAMENTS.find((x) => x.id === id);
    if (!t || !tournamentUnlocked(t, this.career.data.tournaments, this.career.data.unlockAll)) return;
    this.tournament = new TournamentRun(t);
    this.careerScreen.run = this.tournament;
    this.careerScreen.show('tournaments', `Entered the <b>${t.name}</b>. Win every round to take the trophy — one loss and you're out.`);
  }

  private playTournamentRound() {
    const r = this.tournament?.current;
    if (!r) return;
    const keep = this.tournament;
    this.matchSettings.level = r.level;
    this.matchSettings.aiStyle = r.style;
    this.matchSettings.bestOf = r.bestOf;
    this.setVenue(r.venue); // tournaments may use venues you haven't unlocked yet
    this.startMatch();
    this.tournament = keep; // startMatch clears ongoing modes; keep the run
    this.hud.flash(r.name.toUpperCase(), `${STYLES[r.style].character} · ${AI_LEVELS[r.level].name} · best of ${r.bestOf}`);
  }

  private reportTournamentMatch(won: boolean, score: string) {
    const run = this.tournament!;
    const round = run.current!;
    const state = run.report(won, score);
    if (document.pointerLockElement) document.exitPointerLock();
    let banner: string;
    if (state === 'won') {
      this.career.recordTournament(run.tournament.id, run.tournament.xp, run.tournament.achievement);
      banner = `🏆 <b>You won the ${run.tournament.name}!</b> +${run.tournament.xp} XP`;
    } else if (state === 'eliminated') banner = `Knocked out in ${round.name} (${score}). Enter again to have another go.`;
    else banner = `✓ ${round.name} won ${score}. Next: <b>${run.current!.name}</b>.`;
    this.endMatch();
    this.careerScreen.run = run;
    this.openCareer();
    this.careerScreen.show('tournaments', banner);
  }

  // ---------------------------------------------------------------- quality

  /** Apply the quality setting (or the automatic controller's current level). */
  applyQuality() {
    const idx = this.quality.setting === 'auto' ? this.autoQuality.level : this.quality.setting;
    if (idx === this.qualityLevel) return;
    this.qualityLevel = idx;
    const q = QUALITY_LEVELS[idx];
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, q.maxPixelRatio));
    const key = this.scene.getObjectByName('key') as THREE.DirectionalLight;
    if (key.shadow.mapSize.x !== q.shadowMap) {
      key.shadow.mapSize.set(q.shadowMap, q.shadowMap);
      key.shadow.map?.dispose();
      key.shadow.map = null;
    }
    this.resize();
  }

  // ---------------------------------------------------------------- look, sound, replays

  private clock() {
    return performance.now() / 1000;
  }

  setVenue(id: VenueId) {
    this.look.venue = id;
    this.venue = setVenue(this.scene, id, this.venue);
    this.sfx.setAmbience(this.look.ambience ? VENUES[id].ambience : 'none');
    savePref('mem.venue', id);
    this.updateVenueScreen();
  }

  /** The conference room's TV shows the score. */
  private updateVenueScreen() {
    if (!this.venue?.setScore) return;
    if (this.online?.score) {
      const c = this.online;
      const sc = c.score!;
      const them: SideId = c.side === 'near' ? 'far' : 'near';
      this.venue.setScore([`${this.teamName(c.side, false).slice(0, 12).toUpperCase()}  ${sc.points[c.side]}`, `${this.teamName(them, false).slice(0, 12).toUpperCase()}  ${sc.points[them]}`, `GAMES ${sc.games[c.side]}-${sc.games[them]}`]);
    } else if (this.match && this.ai) {
      const sc = this.match.score;
      this.venue.setScore([`YOU          ${sc.points.near}`, `${this.ai.style.character.toUpperCase().padEnd(12)} ${sc.points.far}`, `GAMES ${sc.games.near}-${sc.games.far}`]);
    } else {
      this.venue.setScore(['MEM TABLE TENNIS', 'PRACTICE', `RETURNS ${this.stats.made}/${this.stats.attempts}`]);
    }
  }

  private hitSound(speed: number, rubberKind: string, x: number) {
    this.sfx.paddle(speed, rubberKind, x);
    this.recorder.sound(this.clock(), 'paddle', speed, x, rubberKind);
  }

  /** Table / net / floor sounds (world event, shown from `side`'s view). */
  private ballSound(e: BallEvent, side: SideId = 'near') {
    const x = mapVec(side, e.pos).x;
    if (e.type === 'table') {
      this.sfx.table(e.impactSpeed, x);
      this.recorder.sound(this.clock(), 'table', e.impactSpeed, x);
    } else if (e.type === 'net') {
      this.sfx.net(x);
      this.recorder.sound(this.clock(), 'net', 3, x);
    } else if (e.type === 'floor') {
      const speed = length(this.ball.last?.state.vel ?? v3(0, -3, 0));
      this.sfx.floor(speed, x);
      this.recorder.sound(this.clock(), 'floor', speed, x);
    }
  }

  /** Views that can appear in a replay, by id. */
  private replayViews(): [string, PlayerView][] {
    return [['me', this.playerView], ['ai', this.aiView], ...[...this.remoteViews.entries()].map(([seat, v]) => [seat, v] as [string, PlayerView])];
  }

  private recordFrame() {
    if (!this.recorder.recording) return;
    const views: ViewFrame[] = [];
    for (const [id, v] of this.replayViews()) {
      if (v.isVisible && v.last) views.push({ id, ...v.last, visible: true });
    }
    const b = this.ball.isVisible && this.ball.last ? { pos: this.ball.last.pos, vel: this.ball.last.state.vel, spin: this.ball.last.state.spin } : null;
    this.recorder.add(this.clock(), b, views);
  }

  private maybeAutoReplay() {
    const last = this.recorder.last;
    if (!this.look.autoReplay || !this.match || !last || last === this.autoReplayed || this.recorder.recording) return;
    this.autoReplayed = last;
    if (last.hits >= 6) this.startReplay();
  }

  startReplay() {
    const rally = this.recorder.last;
    if (!rally || this.replay) {
      if (!rally) this.hud.flash('NO DATA', 'Play a rally first, then press R');
      return;
    }
    this.replay = new ReplayPlayer(rally, 0.4);
    const visible = new Map(this.replayViews().map(([id, v]) => [id, v.isVisible]));
    this.savedCamera = { pos: this.camera.position.clone(), target: this.controls.target.clone(), visible };
    this.ball.clearTrail();
    this.playerView.setMarker(null);
    this.hud.setReplay('REPLAY');
  }

  stopReplay() {
    if (!this.replay) return;
    this.replay = null;
    this.hud.setReplay(null);
    this.ball.clearTrail();
    const saved = this.savedCamera;
    if (saved) {
      this.camera.position.copy(saved.pos);
      this.controls.target.copy(saved.target);
      for (const [id, v] of this.replayViews()) v.visible = saved.visible.get(id) ?? false;
    }
    this.savedCamera = null;
  }

  private runReplay(dt: number) {
    const r = this.replay!;
    for (const cue of r.advance(dt)) {
      if (cue.kind !== 'sound') continue;
      if (cue.sound === 'paddle') this.sfx.paddle(cue.speed, cue.rubber ?? 'Inverted', cue.x);
      else if (cue.sound === 'table') this.sfx.table(cue.speed, cue.x);
      else if (cue.sound === 'net') this.sfx.net(cue.x);
      else this.sfx.floor(cue.speed, cue.x);
    }
    const f = r.frame();
    for (const [id, v] of this.replayViews()) {
      const vf = f.views.find((x) => x.id === id);
      v.visible = !!vf;
      if (vf) v.updatePose(vf.pose, vf.body, vf.wing, vf.forward);
    }
    this.playerView.setMarker(null);
    this.ball.visible = !!f.ball;
    if (f.ball) {
      this.ball.rotate(f.ball.spin, dt * r.speed);
      this.ball.update(f.ball.pos, { pos: f.ball.pos, vel: f.ball.vel, spin: f.ball.spin });
    }
    // Broadcast camera: side-on, slowly drifting.
    const k = r.time / Math.max(0.5, r.rally.duration);
    this.camera.position.set(3.6 - k * 0.6, 1.75, 0.9 - k * 1.8);
    this.controls.target.set(0, 0.85, 0);
    this.camera.lookAt(this.controls.target);
    this.hud.setReplay(`▶ REPLAY ×${r.speed} · ${r.caption || '…'}<br/><small>press R to skip</small>`);
    if (r.done) this.stopReplay();
  }

  // ---------------------------------------------------------------- online

  createOnline() {
    this.connectOnline(randomRoomCode(), true);
  }

  joinOnline(code = this.onlineSettings.code) {
    code = code.trim().toUpperCase();
    if (!isRoomCode(code)) {
      this.hud.flash('INVALID INPUT', 'Room codes are 5 letters');
      return;
    }
    this.connectOnline(code, false);
  }

  private connectOnline(code: string, create: boolean) {
    this.leaveOnline();
    this.endMatch();
    const o = this.onlineSettings;
    savePref('mem.name', o.name);
    savePref('mem.server', o.server);
    let transport: Transport;
    if (o.server.trim() === '' || o.server.trim().toLowerCase() === 'local') {
      // In-browser room server: the full online code path, against the AI, no hosting needed.
      this.localServer ??= new LocalServer(() => performance.now() / 1000);
      transport = this.localServer.connect(code);
    } else {
      transport = new WebSocketTransport(roomUrl(o.server, code));
    }
    const client = (this.online = new OnlineClient(transport, this.player, this.params, () => performance.now() / 1000, {
      name: o.name || 'Player',
      style: this.player.style.id,
      create: create ? { mode: o.mode, bestOf: o.bestOf, aiLevel: o.aiLevel, realism: this.realism.percent / 100 } : undefined,
    }));
    this.lobby.fillAI = true;
    this.lobby.setError('');
    this.lobby.show(client);
    this.practiceUi(false);
    client.on((e) => this.onOnlineEvent(e));
    if (document.pointerLockElement) document.exitPointerLock();
  }

  leaveOnline() {
    if (!this.online) return;
    this.hud.setOverlay(false);
    this.applyRealism(); // the room's realism no longer applies
    this.online.leave();
    this.online = null;
    this.lobby.show(null);
    for (const v of this.remoteViews.values()) v.visible = false;
    this.matchHud.show(false);
    this.practiceUi(true);
    if (location.search.includes('room=')) history.replaceState(null, '', location.pathname);
  }

  private onlineRematch() {
    this.matchHud.hideOver();
    if (this.online?.isHost) this.online.start(this.lobby.fillAI);
    else this.backToLobby();
  }

  private backToLobby() {
    this.matchHud.hideOver();
    this.lobby.show(this.online);
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Show/hide the practice-only scene and HUD elements. */
  private practiceUi(on: boolean) {
    this.machineMesh.visible = on;
    this.targetRing.visible = on && !this.playing;
    this.predictionLine.visible = false;
    this.ball.visible = !on;
    this.hud.setMatchMode(!on);
    if (on) this.matchHud.show(false);
  }

  /** Names of the team at a side, e.g. "Ada & Bob". */
  private teamName(side: SideId, mineLabel = true): string {
    const c = this.online!;
    const names = Object.entries(c.room?.seats ?? {})
      .filter(([s]) => seatSide(s as Seat) === side)
      .map(([s, i]) => (mineLabel && s === c.seat ? 'You' : i!.name));
    return names.join(' & ') || '—';
  }

  private onOnlineEvent(e: Parameters<Parameters<OnlineClient['on']>[0]>[0]) {
    const c = this.online!;
    switch (e.type) {
      case 'room':
        this.lobby.render();
        if (c.room?.phase === 'lobby' && !this.lobby.visible && c.phase === 'lobby') this.backToLobby();
        if (c.room && !location.search.includes(c.room.code)) history.replaceState(null, '', `?room=${c.room.code}`);
        break;
      case 'error':
        this.lobby.setError(e.message);
        this.hud.flash('ERROR', e.message);
        break;
      case 'closed':
        this.lobby.setError(`Disconnected: ${e.reason}`);
        this.lobby.show(c);
        break;
      case 'match':
        this.lobby.show(null);
        this.matchHud.show(true);
        this.matchHud.hideOver();
        this.matchHud.clearShots();
        this.clearMarkers();
        if (c.seat) this.requestPlay();
        break;
      case 'toss':
        this.stopReplay();
        this.rallyHits = 0;
        this.ball.clearTrail();
        this.clearMarkers();
        this.recorder.start(this.clock());
        this.sfx.toss();
        break;
      case 'hit': {
        const info = classifyShot(mapVec(c.side, e.pos), e.velOut, e.spinOut, e.paddleVel, e.velIn, e.spinIn);
        const who = e.by === c.seat ? 'You' : (c.names[e.by] ?? e.by);
        const name = e.serve ? 'Serve' : info.name;
        this.matchHud.addShot({ who, name, speed: info.speed, rpm: info.rpm, top: info.top });
        const rubber = e.by === c.seat ? this.player.rubbers[this.player.swing.side].kind : 'Inverted';
        this.hitSound(length(e.velOut) + length(e.paddleVel), rubber, mapVec(c.side, e.pos).x);
        this.recorder.caption(this.clock(), `${who}: ${name} · ${info.speed.toFixed(1)} m/s · ${Math.round(info.rpm).toLocaleString()} rpm`);
        this.rallyHits++;
        if (e.by === c.seat && !e.serve) this.career.recordShot(info.name, info.speed, info.rpm);
        this.ball.clearTrail();
        if (c.next === c.seat) this.stopReplay();
        break;
      }
      case 'ball':
        if (e.event.type !== 'paddle') this.ballSound(e.event, c.side);
        if (e.event.type === 'table') this.addMarker(mapVec(c.side, e.event.pos), spinColor(e.event.velIn, e.event.spinIn));
        break;
      case 'let':
        this.hud.flash(LET_MESSAGE.title, LET_MESSAGE.sub);
        this.recorder.end(this.clock());
        break;
      case 'point': {
        this.recorder.end(this.clock());
        this.sfx.point(e.result.winner === c.side, e.game);
        this.updateVenueScreen();
        if (c.seat) this.career.recordPoint(e.result.winner === c.side, { ace: e.result.ace, rallyHits: this.rallyHits });
        const names = { near: this.teamName('near'), far: this.teamName('far') };
        const m = pointMessage(e.result, names);
        const mine = e.result.winner === c.side;
        if (e.match) this.hud.flash(mine ? 'SHIPPED TO PROD' : 'INCIDENT REPORT', `${names[e.result.winner]} won the match`);
        else if (e.game) this.hud.flash(mine ? 'DEPLOYED' : 'ROLLBACK', `Game to ${names[e.result.winner]} — ${m.title}: ${m.sub}`);
        else this.hud.flash(m.title, m.sub);
        break;
      }
      case 'over':
        if (c.seat && c.score) this.career.recordMatch(c.score.winner === c.side, { online: true, style: this.player.style.id });
        break;
    }
  }

  private onlineFrame(realDt: number) {
    const c = this.online!;
    const inMatch = c.phase === 'serve-wait' || c.phase === 'rally' || c.phase === 'point-over';
    this.hud.setOverlay(this.lobby.visible || (!c.seat && inMatch));
    const { input, move } = this.playing && inMatch ? this.gatherInput() : { input: { ...NO_INPUT }, move: { x: 0, z: 0 } };
    c.frame(realDt, input, move);
    const side = c.side;
    if (this.playing) this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive);

    // Me (view frame), other players (world → view).
    this.playerView.visible = !!c.seat && inMatch;
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? c.interceptView() : null);
    const seats = Object.keys(c.room?.seats ?? {}) as Seat[];
    for (const seat of seats) {
      if (seat === c.seat) continue;
      let view = this.remoteViews.get(seat);
      if (!view) {
        view = new PlayerView(this.scene, { bodyColor: seatSide(seat) === side ? 0x60a5fa : 0xe8562a, bodyOpacity: 1, style: c.room?.seats[seat]?.style ?? 'allround' });
        this.remoteViews.set(seat, view);
      }
      const r = c.remotes.get(seat);
      view.visible = inMatch && !!r;
      if (!r) continue;
      const pos = mapVec(side, fromV(r.pose.p));
      const normal = mapVec(side, fromV(r.pose.n));
      const body = mapVec(side, { x: r.pose.b[0], y: 0, z: r.pose.b[1] });
      view.updatePose({ pos, normal, vel: { x: 0, y: 0, z: 0 } }, { x: body.x, z: body.z }, r.pose.wing);
    }
    for (const [seat, view] of this.remoteViews) if (!seats.includes(seat)) view.visible = false;

    // Ball: the live flight, or in the server's hand while waiting to serve.
    this.ball.visible = inMatch;
    if (c.flight) {
      const state = mapState(side, c.flight.sim.state);
      if (this.playing) this.ball.rotate(state.spin, realDt);
      this.ball.update(state.pos, state);
    } else if (c.phase === 'serve-wait' && c.serverSeat) {
      let hand = c.myServe ? c.handView() : null;
      const r = !hand && c.remotes.get(c.serverSeat);
      if (r) hand = mapVec(side, { x: r.pose.p[0], y: TABLE.height + 0.06, z: r.pose.p[2] });
      if (hand) this.ball.update(hand, { pos: hand, vel: v3(), spin: v3() });
      this.ball.clearTrail();
    }

    // Scoreboard (my team first).
    const sc = c.score;
    if (sc && c.phase !== 'lobby') {
      const them: SideId = side === 'near' ? 'far' : 'near';
      const badge = sc.deuce ? 'DEUCE · RACE CONDITION' : sc.matchPoint ? `MATCH POINT · ${this.teamName(sc.matchPoint)}` : sc.gamePoint ? `GAME POINT · ${this.teamName(sc.gamePoint)}` : null;
      this.matchHud.setScore({
        you: this.teamName(side),
        them: this.teamName(them),
        points: [sc.points[side], sc.points[them]],
        games: [sc.games[side], sc.games[them]],
        youServe: !!c.serverSeat && seatSide(c.serverSeat) === side,
        badge,
        bestOf: sc.bestOf,
      });
    }

    // Prompts and overlays.
    if (c.phase === 'over' && sc) {
      const won = sc.winner === side;
      const them: SideId = side === 'near' ? 'far' : 'near';
      if (!this.lobby.visible) {
        this.matchHud.showOver(
          won ? 'SHIPPED TO PROD' : 'INCIDENT REPORT',
          `${this.teamName(sc.winner!)} won ${sc.games[sc.winner!]}–${sc.games[sc.winner === 'near' ? 'far' : 'near']}`,
          sc.history.map((g) => `${g[side]}–${g[them]}`).join('  ·  '),
          c.isHost ? 'Rematch' : null,
          'Back to lobby',
        );
        if (document.pointerLockElement) document.exitPointerLock();
      }
      this.matchHud.setPrompt(null);
      return;
    }
    if (!inMatch) {
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
    } else if (!this.playing && c.seat) {
      this.matchHud.setPrompt('Paused locally — click <b>▶ Resume match</b> (the match keeps going online!)');
      this.matchHud.setMeter(null);
    } else if (c.myServe) {
      this.matchHud.setPrompt(this.servePrompt());
      this.matchHud.setMeter(this.tossHoldStart !== null ? (performance.now() - this.tossHoldStart) / 1000 / TOSS_HOLD_MAX : null);
    } else if (c.phase === 'serve-wait' && c.serverSeat) {
      this.matchHud.setPrompt(`${c.names[c.serverSeat] ?? 'Opponent'} to serve`);
      this.matchHud.setMeter(null);
    } else {
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
    }
  }

  private updatePlayCamera(dt: number) {
    const b = this.player.body;
    const target = new THREE.Vector3(b.x * 0.5, 1.95, b.z + 1.2);
    const look = new THREE.Vector3(b.x * 0.2, 0.78, -0.8);
    const k = 1 - Math.exp(-dt / 0.12);
    this.camera.position.lerp(target, k);
    this.controls.target.lerp(look, k);
    this.camera.lookAt(this.controls.target);
  }

  /** Advance the simulation by gameDt seconds of game time using fixed ticks. */
  private advance(gameDt: number, realDt: number) {
    this.sinceFire += gameDt;
    if (this.playing) {
      if (this.phase === 'done' || this.phase === 'idle') {
        this.sinceResolved += realDt;
        if (this.sinceResolved > 0.9) this.fire();
      } else if (this.sinceFire > 6) {
        this.resolve();
      }
    } else if (this.machine.autoFire && this.sinceFire >= this.machine.interval) {
      this.fire();
    }
    if (!this.sim) return;

    this.accumulator += gameDt;
    const ticks = Math.floor(this.accumulator / TICK_DT);
    for (let i = 0; i < ticks; i++) this.tick(i, ticks);
    this.accumulator -= ticks * TICK_DT;
    // Interpolate between the last two ticks for smooth rendering at any frame rate.
    const alpha = this.accumulator / TICK_DT;
    const pos = lerp(this.prevPos, this.sim.state.pos, alpha);
    this.ball.rotate(this.sim.state.spin, gameDt);
    this.ball.update(pos, this.sim.state);
  }

  private tick(index = 0, count = 1) {
    if (!this.sim) return;
    this.prevPos = { ...this.sim.state.pos };
    const events: BallEvent[] = [];
    const paddles = this.playing && this.phase === 'incoming' ? [this.player.collider(index, count)] : undefined;
    this.sim.step(TICK_DT, events, paddles);
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

  private onKey(e: KeyboardEvent, down: boolean) {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === 'INPUT' || tag === 'SELECT') return;
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (this.playing && e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space' && this.online) {
      e.preventDefault();
      if (down && !e.repeat && this.playing && this.online.myServe) this.tossHoldStart = performance.now();
      if (!down) this.releaseToss();
      return;
    }
    if (e.code === 'Space' && this.match) {
      e.preventDefault();
      if (down && !e.repeat && this.playing && this.match.humanToServe) this.tossHoldStart = performance.now();
      if (!down) this.releaseToss();
      return;
    }
    if (!down) return;

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
    } else if (e.code === 'KeyR' && !e.repeat) {
      if (this.replay) this.stopReplay();
      else this.startReplay();
    } else if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') {
      if (this.playing && !e.repeat) {
        const s = this.player.swing;
        // Cycle: auto → locked to the other wing → auto.
        s.forcedSide = s.forcedSide === null ? (s.side === 'forehand' ? 'backhand' : 'forehand') : null;
      }
    } else if (!this.playing && e.code >= 'Digit1' && e.code <= 'Digit5') {
      const view = Object.keys(CAMERA_VIEWS)[Number(e.code.slice(5)) - 1] as CameraView;
      this.settings.camera = view;
      this.setCamera(view);
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  private onPointerDown(e: PointerEvent) {
    if (this.playing) {
      if (e.button === 0) this.input.drive = true;
      return;
    }
    if (!e.shiftKey) return;
    // Shift+click on the near half of the table moves the machine's landing target.
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

  /** Programmatic input, used by automated tests and handy from the console. */
  injectSwing(dx: number, dy: number, opts: Partial<SwingInput> = {}) {
    this.input.dx += dx;
    this.input.dy += dy;
    Object.assign(this.input, opts);
  }

  private resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private buildGui() {
    const gui = (this.gui = new GUI({ title: 'MEM Table Tennis · Sandbox' }));
    const onMachine = () => this.updateMachineVisuals();

    gui.add({ play: () => this.requestPlay() }, 'play').name('▶ Play  (Esc to leave)');
    gui.add({ career: () => this.openCareer() }, 'career').name('📈 Career, drills & tournaments');

    const rf = gui.addFolder('Realism');
    rf.add(this.realism, 'percent', 0, 100, 5)
      .name('Arcade %')
      .onChange(() => this.applyRealism());
    for (const [name, v] of Object.entries(REALISM_PRESETS)) {
      rf.add(
        {
          [name]: () => {
            this.realism.percent = Math.round(v * 100);
            this.applyRealism();
          },
        },
        name,
      ).name(`${name} (${Math.round(v * 100)}%)`);
    }

    const lf = gui.addFolder('Look & sound');
    lf.add(this.look, 'venue', Object.fromEntries(Object.entries(VENUES).map(([id, v]) => [v.name, id])))
      .name('Venue')
      .onChange((id: VenueId) => {
        if (this.locked('venue', id)) {
          this.look.venue = this.venue?.id ?? 'sandbox';
          lf.controllersRecursive().forEach((c) => c.updateDisplay());
          return;
        }
        this.setVenue(id);
      });
    lf.add(this.look, 'volume', 0, 1, 0.05)
      .name('Volume')
      .onChange((v: number) => {
        this.sfx.volume = v;
        this.sfx.applyVolume();
        savePref('mem.volume', String(v));
      });
    lf.add(this.look, 'muted')
      .name('Mute')
      .onChange((m: boolean) => {
        this.sfx.muted = m;
        this.sfx.applyVolume();
        savePref('mem.muted', m ? '1' : '0');
      });
    lf.add(this.look, 'ambience')
      .name('Venue ambience')
      .onChange((a: boolean) => {
        this.sfx.ambienceOn = a;
        this.sfx.setAmbience(a ? VENUES[this.look.venue].ambience : 'none');
        savePref('mem.ambience', a ? '1' : '0');
      });
    lf.add(this.look, 'autoReplay')
      .name('Auto-replay long rallies')
      .onChange((a: boolean) => savePref('mem.autoReplay', a ? '1' : '0'));
    lf.add({ replay: () => this.startReplay() }, 'replay').name('Replay last rally  [R]');
    lf.add(this.quality, 'setting', { 'Auto (adapts to your device)': 'auto', High: 2, Medium: 1, Low: 0 })
      .name('Graphics quality')
      .onChange((v: QualitySetting) => {
        savePref('mem.quality', String(v));
        this.applyQuality();
      });
    lf.add(this.quality, 'showFps').name('Show FPS');

    const on = gui.addFolder('Online multiplayer');
    const o = this.onlineSettings;
    on.add(o, 'name').name('Your name');
    on.add(o, 'server').name('Room server');
    on.add(o, 'mode', { 'Singles (1v1)': 'singles', 'Doubles (2v2)': 'doubles' }).name('New room: mode');
    on.add(o, 'bestOf', { 'Best of 1': 1, 'Best of 3': 3, 'Best of 5': 5, 'Best of 7': 7 }).name('New room: format');
    on.add({ create: () => this.createOnline() }, 'create').name('➕ Create room');
    on.add(o, 'code').name('Room code').listen();
    on.add({ join: () => this.joinOnline() }, 'join').name('→ Join room');

    const mt = gui.addFolder('Match vs AI');
    const levelNames = Object.fromEntries(Object.entries(AI_LEVELS).map(([k, v]) => [`${v.name} (${k})`, k]));
    mt.add(this.matchSettings, 'level', levelNames).name('Opponent level');
    mt.add(this.matchSettings, 'aiStyle', { Random: 'random', ...Object.fromEntries(STYLE_IDS.map((id) => [`${STYLES[id].character} (${STYLES[id].label})`, id])) }).name('Opponent style');
    mt.add(this.matchSettings, 'bestOf', { 'Best of 1': 1, 'Best of 3': 3, 'Best of 5': 5, 'Best of 7': 7 }).name('Format');
    mt.add({ start: () => this.startMatch() }, 'start').name('▶ Start match');
    mt.add({ end: () => this.endMatch() }, 'end').name('End match (back to practice)');

    const pl = gui.addFolder('Player');
    if (this.isTouch || 'DeviceOrientationEvent' in window) {
      pl.add(this.quality, 'tilt')
        .name('Tilt phone → face angle')
        .onChange(async (on: boolean) => {
          if (on && !(await this.tilt.enable())) {
            this.quality.tilt = false;
            pl.controllersRecursive().forEach((c) => c.updateDisplay());
            this.hud.flash('UNSUPPORTED', 'This device does not report its tilt (or permission was refused)');
          } else if (!on) this.tilt.disable();
        });
      pl.add({ cal: () => this.tilt.recalibrate() }, 'cal').name('Recalibrate tilt');
    }
    const rubberNames = Object.fromEntries(Object.values(RUBBERS).map((r) => [`${r.name} (${r.kind})`, r.id]));
    const rubberSel = { forehand: 'inverted', backhand: 'inverted' };
    const styleNames = Object.fromEntries(STYLE_IDS.map((id) => [`${STYLES[id].character} — ${STYLES[id].label}`, id]));
    pl.add(this.realism, 'style', styleNames)
      .name('Your style')
      .onChange((id: StyleId) => {
        if (this.locked('style', id)) {
          this.realism.style = this.player.style.id;
          pl.controllersRecursive().forEach((c) => c.updateDisplay());
          return;
        }
        this.player.applyStyle(id);
        this.playerView.setStyle(id);
        rubberSel.forehand = this.player.rubbers.forehand.id;
        rubberSel.backhand = this.player.rubbers.backhand.id;
        this.online?.setStyle(id);
        pl.controllersRecursive().forEach((c) => c.updateDisplay());
        this.hud.flash(STYLES[id].character.toUpperCase(), STYLES[id].description);
      });
    const pickRubber = (wing: 'forehand' | 'backhand') => (id: string) => {
      if (this.locked('rubber', id)) {
        rubberSel[wing] = this.player.rubbers[wing].id;
        pl.controllersRecursive().forEach((c) => c.updateDisplay());
        return;
      }
      this.player.rubbers[wing] = RUBBERS[id];
    };
    pl.add(rubberSel, 'forehand', rubberNames).name('Forehand rubber').onChange(pickRubber('forehand'));
    pl.add(rubberSel, 'backhand', rubberNames).name('Backhand rubber').onChange(pickRubber('backhand'));
    pl.add(this.player.swing.params, 'sensitivity', 0.0005, 0.004, 0.0001).name('Mouse sensitivity');
    pl.add(this.player.swing.params, 'swingGain', 0.6, 3, 0.05).name('Swing power');
    pl.add(this.player.assists, 'angle', 0, 1, 0.05).name('Angle assist');
    pl.add(this.player.assists, 'hitArea', 0, 0.1, 0.005).name('Hit area + (m)');
    pl.add(this.player.assists, 'footwork', 0, 1, 0.05).name('Footwork assist');
    pl.add(this.settings, 'showIntercept').name('Intercept marker');

    const mf = gui.addFolder('Ball machine');
    mf.add(this.machine, 'preset', PRESETS.map((p) => p.name))
      .name('Preset')
      .onChange((name: string) => {
        Object.assign(this.machine, this.settingsFromPreset(PRESETS.find((p) => p.name === name)!));
        gui.controllersRecursive().forEach((c) => c.updateDisplay());
        onMachine();
        if (!this.playing) this.fire();
      });
    mf.add(this.machine, 'mix').name('Mix presets (play)');
    mf.add({ fire: () => this.fire() }, 'fire').name('Fire  [Space]');
    mf.add(this.machine, 'autoFire').name('Auto-fire (inspect)');
    mf.add(this.machine, 'interval', 0.8, 6, 0.1).name('Interval (s)');
    mf.add(this.machine, 'scatter', 0, 0.4, 0.01).name('Target scatter (m)');

    const sf = mf.addFolder('Shot');
    sf.add(this.machine, 'speed', 2, 35, 0.5).name('Speed (m/s)').onChange(onMachine);
    sf.add(this.machine, 'topspin', -150, 150, 1).name('Top(+)/Back(−) rps').onChange(onMachine);
    sf.add(this.machine, 'sidespin', -100, 100, 1).name('Sidespin rps').onChange(onMachine);
    sf.add(this.machine, 'corkscrew', -100, 100, 1).name('Corkscrew rps').onChange(onMachine);
    sf.add(this.machine, 'highArc').name('High arc (lob)').onChange(onMachine);
    sf.close();

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
    vf.close();

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
          void navigator.clipboard?.writeText(JSON.stringify({ physics: p, swing: this.player.swing.params, assists: this.player.assists }, null, 2));
          this.hud.flash('COPIED', 'Tuning copied to clipboard');
        },
      },
      'copy',
    ).name('Copy tuning as JSON');
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

/**
 * Room server used by default: VITE_ROOM_SERVER at build time (e.g. the Cloudflare
 * Worker or Node server URL); a local Node server in development; otherwise the
 * in-browser server ("local": online mode against the AI, no friends).
 */
const DEFAULT_SERVER: string =
  (import.meta.env.VITE_ROOM_SERVER as string | undefined) || (['localhost', '127.0.0.1'].includes(location.hostname) ? 'ws://localhost:8787' : 'local');

function loadPref(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback;
  } catch {
    return fallback;
  }
}

function savePref(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}
