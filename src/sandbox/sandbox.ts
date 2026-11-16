import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import GUI from 'lil-gui';
import {
  BALL,
  BallSim,
  dot,
  scale,
  sub,
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
  solveServeAim,
  spinComponents,
  length,
  v3,
  type BallEvent,
  type BallState,
  type PhysicsParams,
  type Vec3,
} from '../physics';
import { Player } from '../game/player';
import { AI_LEVELS, AiPlayer, type AiLevel } from '../game/ai';
import { DEFAULT_REALISM, REALISM_PRESETS, realismSettings } from '../game/realism';
import { STYLES, PLAYABLE_STYLE_IDS, FREE_PLAY_OPPONENT_IDS, type StyleId } from '../game/styles';
import { IncomingPrediction } from '../game/intercept';
import { Match } from '../game/match';
import { LET_MESSAGE, pointMessage } from '../game/messages';
import { classifyShot } from '../game/shots';
import { NO_INPUT, type SwingInput, type SwipeMode } from '../game/swing';
import { BallView, SPIN_PALETTES, setSpinPalette, spinColor, spinKind, type SpinPalette } from '../render/ballView';
import { Juice, hitPower } from '../render/juice';
import { PlayerView } from '../render/playerView';
import { createScene } from '../render/scene';
import { PostFx } from '../render/post';
import { Hud, MatchHud, type ShotReport, type ReturnReport, type PracticeStats } from './hud';
import { Lobby } from './lobby';
import { RallyRecorder, ReplayPlayer, type ViewFrame } from './replay';
import { Sfx } from '../audio/sfx';
import { TouchControls, isTouchDevice } from '../input/touch';
import { TiltControl } from '../input/tilt';
import { AutoQuality, QUALITY_LEVELS, type QualitySetting } from '../render/quality';
import { Career } from '../progress/profile';
import { DRILLS, DrillSession, drillUnlocked, type TargetZone } from '../progress/drills';
import { GRADE_TEXT } from '../game/contact';
import { BLADES, LEVEL_GEAR, TOUR_GEAR, defaultBat, opponentBat, type Bat, type BladeId } from '../game/equipment';
import { GRADE_TEXT as MATCH_GRADE_TEXT, matchGrade, type MatchGrade } from '../game/matchGrade';
import type { OverGrade } from './hud';
import { TOUR_STOPS, TourRun, stopUnlocked, stopsWon } from '../progress/tour';
import { TourScreen } from './tour';
import { isUnlocked, newlyUnlocked, unlockedKeys, UNLOCKS, type UnlockKind } from '../progress/unlocks';
import { CareerScreen } from './career';
import { HowToPlay } from './howto';
import { Coach } from './coach';
import { Tutorial, tutorialHint } from '../progress/tutorial';
import { SERVE_TYPES, serveReport, tossHeightFor, type ServeReport, type ServeType } from '../game/serves';
import { Menu, type MenuHost, type PauseContext } from './menu';
import { OPEN_BOUNDS, VENUES, setVenue, type Venue, type VenueId } from '../render/venues';
import { OnlineClient } from '../net/client';
import { LocalServer, WebSocketTransport, roomUrl, type Transport } from '../net/transport';
import { fromV, isRoomCode, randomRoomCode, seatSide, type GameMode, type Seat } from '../net/protocol';
import { mapVec, mapState, type SideId } from '../game/frame';
import { PRESETS, type Preset } from './presets';

type CameraView = 'Player' | 'Side' | 'Top' | 'Broadcast' | 'Machine';
export type CamMode = 'classic' | 'close' | 'dynamic';

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
  /** Serve: bounce on the machine's half first, then on the target. */
  serve: boolean;
  autoFire: boolean;
  interval: number;
  scatter: number;
  /** Cycle through a list of presets when auto-firing in play mode. */
  mix: boolean;
}

/** Rally state for practice: the machine's ball, then (maybe) the player's return. */
type Phase = 'idle' | 'incoming' | 'returned' | 'done';

export class Sandbox implements MenuHost {
  private renderer: THREE.WebGLRenderer;
  /** Bloom at High quality. */
  private post: PostFx;
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
  matchSettings = {
    level: 'medium' as AiLevel,
    bestOf: 3,
    aiStyle: 'random' as StyleId | 'random',
    doubles: false,
    /** Single-player doubles: your partner and the two opponents (remembered). */
    partner: pickPref('mem.dblPartner'),
    opp1: pickPref('mem.dblOpp1'),
    opp2: pickPref('mem.dblOpp2'),
  };

  /** Save the doubles line-up choices. */
  saveDoublesPicks() {
    savePref('mem.dblPartner', this.matchSettings.partner);
    savePref('mem.dblOpp1', this.matchSettings.opp1);
    savePref('mem.dblOpp2', this.matchSettings.opp2);
  }

  // Single-player doubles: you and an AI partner against two AI, in a private in-browser
  // room (the online doubles rules, serving order and AI seats) whose clock stops while
  // you're paused.
  private offlineDoubles = false;
  private doublesStarted = false;
  private pausedMs = 0;
  /** When the current pause began (performance.now ms), or null while playing. */
  private pausedAt: number | null = null;
  private readonly localClock = () => {
    const now = performance.now();
    return (now - this.pausedMs - (this.pausedAt !== null ? now - this.pausedAt : 0)) / 1000;
  };

  startDoubles() {
    this.leaveOnline();
    this.endMatch();
    this.stopDrill();
    this.stopTutorial();
    this.tournament = null;
    this.practicing = false;
    this.matchHud.hideOver();
    const server = new LocalServer(this.localClock);
    this.localServer = server;
    const client = (this.online = new OnlineClient(server.connect('LOCAL'), this.player, this.params, this.localClock, {
      name: 'You',
      style: this.player.style.id,
      create: { mode: 'doubles', bestOf: this.matchSettings.bestOf, aiLevel: this.matchSettings.level, realism: this.realism.percent / 100, aiStyles: this.doublesLineup() },
    }));
    this.offlineDoubles = true;
    this.doublesStarted = false;
    this.pausedAt = null;
    this.menu.hide();
    this.practiceUi(false);
    client.on((e) => this.onOnlineEvent(e));
    this.requestPlay(); // from the click, so the mouse can be captured
  }

  /** Doubles: the lit-up service boxes during a serve, and whose shot it is in a rally. */
  private serveBoxes: THREE.Group | null = null;
  /** Doubles: the serve is still in play (no rally shot yet). */
  private doublesServing = false;

  private updateDoublesHelp(c: OnlineClient, inMatch: boolean) {
    const doubles = c.mode === 'doubles' && inMatch;
    if (c.phase === 'serve-wait') this.doublesServing = true;
    if (c.phase === 'point-over') this.doublesServing = false;
    if (!this.serveBoxes) {
      // In the view frame the diagonal is always your right half (+x, near) and the far
      // left half (−x): whoever serves, the boxes are the same two.
      const g = new THREE.Group();
      const box = (color: number, x: number, z: number) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(TABLE.halfWidth - 0.03, TABLE.halfLength - 0.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(x, TABLE.height + 0.003, z);
        g.add(m);
      };
      box(0xe8562a, TABLE.halfWidth / 2, TABLE.halfLength / 2);
      box(0x5eead4, -TABLE.halfWidth / 2, -TABLE.halfLength / 2);
      this.scene.add(g);
      this.serveBoxes = g;
    }
    this.serveBoxes.visible = doubles && this.doublesServing && !this.replay;
    // Whose shot (partners alternate): shown while the ball is ours to play.
    // Whose shot (partners alternate): no text, the hit zone turns blue when it's your partner's.
    this.partnerTurn = doubles && c.phase === 'rally' && !this.doublesServing && !!c.next && seatSide(c.next) === c.side && c.next !== c.seat;
  }

  /** The characters chosen for the AI seats (you're near1, your partner near2); random ones left out. */
  private doublesLineup(): Partial<Record<Seat, StyleId>> {
    const m = this.matchSettings;
    const out: Partial<Record<Seat, StyleId>> = {};
    // Nobody twice: a pick that clashes with you (or an earlier pick) goes back to random.
    const used = new Set<StyleId>([this.player.style.id]);
    for (const [seat, pick] of [['near2', m.partner], ['far1', m.opp1], ['far2', m.opp2]] as const) {
      if (pick === 'random' || used.has(pick)) continue;
      used.add(pick);
      out[seat] = pick;
    }
    return out;
  }

  /** Each frame in single-player doubles: start the match once seated; stop the clock while paused. */
  private doublesFrame() {
    if (!this.offlineDoubles || !this.online) return;
    const c = this.online;
    if (!this.doublesStarted && c.phase === 'lobby' && c.seat && c.isHost) {
      this.doublesStarted = true;
      c.start(true);
    }
    // The room's clock stops while you're paused (measured in real time, not frame steps).
    if (!this.playing && this.pausedAt === null) this.pausedAt = performance.now();
    else if (this.playing && this.pausedAt !== null) {
      this.pausedMs += performance.now() - this.pausedAt;
      this.pausedAt = null;
    }
  }
  /** Realism slider (0 = simulation, 100 = arcade), for offline play and new rooms. */
  realism = { percent: Number(loadPref('mem.realism', String(Math.round(DEFAULT_REALISM * 100)))) || Math.round(DEFAULT_REALISM * 100), style: 'allround' as StyleId };
  /** Game speed from the realism slider (offline). */
  private gameSpeed = realismSettings(DEFAULT_REALISM).gameSpeed;
  /**
   * Playback rate actually used (offline): the realism slider's slower speed while the
   * ball is coming at you (time to react), real speed while it's going away (your shots
   * fly at their true pace). Eased, so the change is never a jolt.
   */
  private playRate = realismSettings(DEFAULT_REALISM).gameSpeed;

  private updatePlayRate(realDt: number, ballVelZ: number | null) {
    const outgoing = this.look.fullSpeedOut && ballVelZ !== null && ballVelZ < -0.5;
    const target = outgoing ? 1 : this.gameSpeed;
    // Speed up quickly as your shot leaves; slow down a little more gently as theirs comes.
    const rate = target > this.playRate ? 14 : 8;
    this.playRate += (target - this.playRate) * (1 - Math.exp(-rate * realDt));
    return this.playRate;
  }

  /** Apply the local realism slider: assists, spin curve and game speed. */
  applyRealism() {
    const a = this.realism.percent / 100;
    const r = realismSettings(a);
    this.player.applyRealism(a);
    this.params.liftCoefficientMax = DEFAULT_PARAMS.liftCoefficientMax * r.spinCurve;
    this.params.tableBounceKeep = r.bounceKeep;
    this.gameSpeed = r.gameSpeed;
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }
  private tossHoldStart: number | null = null;
  /** The serve type the player has chosen (remembered). */
  serveType: ServeType = SERVE_TYPES.some((t) => t.id === loadPref('mem.serveType', 'auto')) ? (loadPref('mem.serveType', 'auto') as ServeType) : 'auto';

  setServeType(id: ServeType) {
    this.serveType = id;
    this.player.serveType = id;
    savePref('mem.serveType', id);
  }

  /** The serve chooser: shown while it's your serve, before the toss. */
  private updateServeBar(show: boolean) {
    this.matchHud.setServeBar(show && this.tossHoldStart === null ? SERVE_TYPES : null, this.serveType, !this.isTouch);
  }

  // Look, sound and replays
  sfx = new Sfx();
  private venue: Venue | null = null;
  look = {
    venue: (loadPref('mem.venue', 'office') as VenueId) in VENUES ? (loadPref('mem.venue', 'office') as VenueId) : 'office',
    volume: Number(loadPref('mem.volume', '0.7')),
    muted: loadPref('mem.muted', '0') === '1',
    ambience: loadPref('mem.ambience', '1') === '1',
    music: loadPref('mem.music', '1') === '1',
    autoReplay: loadPref('mem.autoReplay', '1') === '1',
    replaySpeed: Number(loadPref('mem.replaySpeed', '0.4')) || 0.4,
    arcadeFx: loadPref('mem.arcadeFx', '1') === '1',
    shotDetails: loadPref('mem.shotDetails', '0') === '1',
    bloom: loadPref('mem.bloom', '1') === '1',
    fullSpeedOut: loadPref('mem.fullSpeedOut', '1') === '1',
    /** The call-out after each point / practice return (NET, OUT…). Off by default. */
    callouts: loadPref('mem.callouts', '0') === '1',
    /** MJ mode: a falsetto pop-star yelp on each of your smashes. Off by default. */
    mjMode: loadPref('mem.mjMode', '0') === '1',
    /** What a rally swipe's sideways angle does: aim + curve in (default), aim + real brush, aim only, spin only. */
    swipeMode: (['curve', 'real', 'aim', 'spin'].includes(loadPref('mem.swipeMode', 'curve')) ? loadPref('mem.swipeMode', 'curve') : 'curve') as SwipeMode,
    /** Spin colours on the trail, comet tail and sparks. */
    spinPalette: (loadPref('mem.spinPalette', 'standard') === 'colourblind' ? 'colourblind' : 'standard') as SpinPalette,
    /** A label naming the spin of the ball coming at you. Off by default. */
    spinLabel: loadPref('mem.spinLabel', '0') === '1',
    /** No camera shake, zoom kick, hit-stop or screen flash. Defaults to the system setting. */
    reduceMotion: loadPref('mem.reduceMotion', typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? '1' : '0') === '1',
  };
  /** Arcade effects: hit-stop, shake, comet tail, sparks (see render/juice). */
  private juice!: Juice;
  /** Speed of the last paddle hit, 0–1 (for crowd reactions). */
  private lastHitPower = 0;
  /** The match just ended: replay its last rally in slow motion. */
  private finale = false;
  private recorder = new RallyRecorder();
  private replay: ReplayPlayer | null = null;
  private autoReplayed: unknown = null;
  /** The viewer has moved the replay camera themselves (the broadcast shot stops). */
  private replayFreeCam = false;
  private savedCamera: { pos: THREE.Vector3; target: THREE.Vector3; visible: Map<string, boolean> } | null = null;

  // Progression
  career = new Career();
  private careerScreen!: CareerScreen;
  private howTo!: HowToPlay;

  // Front end: title screen, settings and the pause menu. The lil-gui panel is "Developer tools".
  private menu!: Menu;
  devTools = loadPref('mem.devTools', '0') === '1';
  /** Developer free-camera view: no menu while not playing. */
  private inspecting = false;
  /** Free practice against the ball machine was started (so Esc pauses it rather than going to the title). */
  private practicing = false;
  /** Interactive tutorial (a guided ball-machine session) and its coach card. */
  private tutorial: Tutorial | null = null;
  private coach!: Coach;
  /** Extra pause before the next ball (s), e.g. after finishing a tutorial step. */
  private extraDelay = 0;
  private rubberSel = { forehand: 'inverted', backhand: 'inverted' };
  private unlocked = new Set<string>();
  private drill: DrillSession | null = null;
  private drillZone: THREE.Mesh | null = null;
  /** The World Tour stop being played (knockout or round-robin), if any. */
  private tournament: TourRun | null = null;
  private tourScreen!: TourScreen;
  private matchRecorded = false;
  private rallyHits = 0;
  /** This match so far, for the end-of-match card. */
  private mstats = { won: 0, played: 0, longest: 0, fastest: 0, aces: 0, perfect: 0, clean: 0, strokes: 0 };
  private lastPhase = '';
  /** The grade of the match that just ended (null until one does). */
  private lastGrade: OverGrade | null = null;
  /** Doubles: the ball on our side is my partner's to play (the hit zone turns blue). */
  private partnerTurn = false;

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
  /** The character (and partner see-through-ness) each remote view was dressed as. */
  private remoteLooks = new Map<Seat, string>();
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
    // Near plane 5 cm (nothing gets closer to the camera): 5× the depth precision of 1 cm,
    // so distant surfaces close together (screens, boards on walls) don't flicker.
    this.camera = new THREE.PerspectiveCamera(50, 1, 0.05, 100);
    this.post = new PostFx(this.renderer, this.scene, this.camera);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    // Grabbing the camera during a replay hands it over from the broadcast shot to the viewer.
    this.controls.addEventListener('start', () => {
      if (this.replay) this.replayFreeCam = true;
    });
    this.setCamera('Player');

    this.ball = new BallView(this.scene);
    this.ball.visible = false;
    this.juice = new Juice(this.scene);
    this.juice.reduceMotion = this.look.reduceMotion;
    setSpinPalette(this.look.spinPalette);
    this.juice.enabled = this.look.arcadeFx;
    this.sfx.heavyHits = this.look.arcadeFx;
    this.sfx.wantGrunts = this.look.mjMode;
    this.hud = new Hud(container);

    this.player = new Player('p1', this.params);
    this.player.swing.params.swipeMode = this.look.swipeMode;
    this.playerView = new PlayerView(this.scene);
    this.playerView.visible = false;
    this.aiView = new PlayerView(this.scene, { bodyColor: 0xe8562a, bodyOpacity: 0.45 });
    this.aiView.visible = false;
    this.matchHud = new MatchHud(container);
    this.hud.showDetails = this.look.shotDetails;
    this.matchHud.showDetails = this.look.shotDetails;
    this.player.serveType = this.serveType;
    this.matchHud.onServeType = (id) => this.setServeType(id as ServeType);
    this.matchHud.onRematch = () => (this.online ? this.onlineRematch() : this.startMatch());
    this.matchHud.onExit = () => (this.online ? this.backToLobby() : this.quitToTitle());
    this.lobby = new Lobby(container);
    this.lobby.onStart = () => {
      this.online?.start(this.lobby.fillAI);
    };
    this.lobby.onLeave = () => {
      this.leaveOnline();
      this.menu.show('title');
    };

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
    this.hud.onReplaySpeed = (sp) => this.setReplaySpeed(sp);
    this.hud.onReplaySkip = () => this.stopReplay();
    this.hud.onReplayResetCam = () => this.resetReplayCamera();
    this.touch.onReplay = () => (this.replay ? this.stopReplay() : this.startReplay());
    this.touch.onMenu = () => this.setPlaying(false);
    this.autoQuality = new AutoQuality(this.isTouch ? 1 : 2);
    if (this.isTouch) {
      document.body.classList.add('touch');
    }

    // Career: toasts for XP / promotions / achievements / unlocks.
    this.unlocked = unlockedKeys(this.career.data, this.career.levelIndex);
    this.careerScreen = new CareerScreen(container, this.career);
    this.careerScreen.onClose = () => this.careerScreen.hide();
    this.tourScreen = new TourScreen(container, this.career, () => this.tournament);
    this.tourScreen.onClose = () => this.tourScreen.hide();
    this.tourScreen.onEnter = (id) => this.startTournament(id);
    this.tourScreen.onPlay = () => this.playTournamentRound();
    this.tourScreen.onAbandon = () => {
      this.tournament = null;
      this.tourScreen.banner = '';
      this.tourScreen.render();
    };
    this.hud.onCareer = () => this.openCareer();
    this.howTo = new HowToPlay(container, this.isTouch);
    this.howTo.onTutorial = () => this.startTutorial();
    this.coach = new Coach(container, this.isTouch);
    this.coach.onFinish = (choice) => (choice === 'quick' ? this.startAiMatch() : choice === 'practice' ? this.startPractice() : this.quitToTitle());
    this.hud.onHowTo = () => this.howTo.show();
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
    this.menu = new Menu(container, this);
    this.menu.onChange = (screen) => this.onMenuChange(screen);
    this.setDevTools(this.devTools);
    this.applyQuality();
    this.applyRealism();
    // A venue saved before progression existed might still be locked.
    this.setVenue(isUnlocked('venue', this.look.venue, this.career.data, this.career.levelIndex) ? this.look.venue : 'office');
    this.playerView.setStyle(this.player.style.id);
    // Restore the last player picked ("Playing as"), if still unlocked.
    const savedStyle = loadPref('mem.style', '');
    if (savedStyle in STYLES && savedStyle !== this.realism.style && !this.lockReason('style', savedStyle)) this.setStyle(savedStyle as StyleId, false);
    else this.player.applyBat(this.batFor(this.player.style.id));
    this.sfx.volume = this.look.volume;
    this.sfx.muted = this.look.muted;
    this.sfx.ambienceOn = this.look.ambience;
    this.sfx.musicOn = this.look.music;
    // Browsers only allow audio after a user gesture.
    const unlock = () => this.sfx.unlock();
    // No background audio: pause all sound while the game is minimised or in another tab.
    // (pagehide/pageshow cover iOS, which doesn't always fire visibilitychange when backgrounded.)
    document.addEventListener('visibilitychange', () => this.sfx.setHidden(document.hidden));
    window.addEventListener('pagehide', () => this.sfx.setHidden(true));
    window.addEventListener('pageshow', () => this.sfx.setHidden(document.hidden));
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
      if (e.button === 2) this.input.smash = false;
    });
    window.addEventListener('pointercancel', () => ((this.input.drive = false), (this.input.smash = false)));
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
    document.addEventListener('pointerlockchange', () => {
      this.setPlaying(document.pointerLockElement === canvas);
      this.syncControlsEnabled();
    });
    this.hud.onStartPlay = () => this.requestPlay();

    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());

    // Invite links: ?room=CODE joins that room.
    const invited = new URLSearchParams(location.search).get('room')?.toUpperCase();
    if (invited && isRoomCode(invited)) {
      this.onlineSettings.code = invited;
      this.joinOnline(invited);
    } else this.menu.show('title');
  }

  // ---------------------------------------------------------------- play mode

  requestPlay() {
    // First time: explain the controls before the first ball.
    if (loadPref('mem.seenHowTo', '') !== '1') {
      savePref('mem.seenHowTo', '1');
      this.howTo.onClose = () => {
        this.howTo.onClose = () => {};
        this.requestPlay();
      };
      this.menu.hide();
      this.howTo.show();
      return;
    }
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
    if (on) {
      this.inspecting = false;
      if (!this.match && !this.drill && !this.online && !this.tutorial) this.practicing = true;
      this.menu.hide();
    }
    this.syncControlsEnabled();
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
      this.setFov(50);
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
      serve: !!p.serve,
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
      const ball = this.drill.nextBall();
      if (!ball) return this.finishDrill();
      Object.assign(this.machine, this.settingsFromPreset(PRESETS.find((p) => p.name === ball.preset)!), { scatter: ball.x === undefined ? 0.12 : 0.05 });
      if (ball.x !== undefined) this.machine.targetX = ball.x;
      if (ball.call) {
        // Call the side, and light up that half of the far side.
        this.showDrillZone({ x0: ball.call === 'left' ? -TABLE.halfWidth : 0, x1: ball.call === 'left' ? 0 : TABLE.halfWidth, z0: -TABLE.halfLength, z1: 0 });
        // (A toast, not the big centre call-out: that would sit on the incoming ball's path.)
        this.hud.toast(`<b>${ball.call === 'left' ? '◀ LEFT' : 'RIGHT ▶'}</b> — put it on that side`);
      }
      this.updateMachineVisuals();
      this.updateDrillHud();
    } else if (this.tutorial) {
      const name = this.tutorial.preset();
      if (!name) return;
      Object.assign(this.machine, this.settingsFromPreset(PRESETS.find((p) => p.name === name)!), { scatter: 0.06 });
      this.updateMachineVisuals();
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
    const aim = this.solveMachineAim(origin, target);
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

  /** The machine's launch angles for its current settings (a serve bounces on its own half first). */
  private solveMachineAim(origin: Vec3, target: { x: number; z: number }) {
    const m = this.machine;
    return m.serve ? solveServeAim(origin, target, m.speed, this.spin(), this.params) : solveAim(origin, target, m.speed, this.spin(), this.params, m.highArc);
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
    const aim = this.solveMachineAim(o, { x: this.machine.targetX, z: this.machine.targetZ });
    this.aimMachine(aim.elevation, aim.azimuth);
    (this.targetRing.material as THREE.MeshBasicMaterial).color.set(aim.ok ? 0xffd34d : 0xff4d4d);
    this.hud.setAimWarning(aim.ok ? null : 'Target not reachable with this speed/spin — the shot will miss.');
  }

  // ---------------------------------------------------------------- intercept

  /** Where (and when) the incoming ball reaches the player's hitting plane. */
  computeIntercept(now: number) {
    return this.player.contactFor(this.phase === 'incoming' ? this.incoming : null, now);
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
        this.callout(e.part === 'tape' ? 'NET CORD' : 'NET', e.part === 'tape' ? 'Clipped the tape' : 'Into the net');
        break;
      case 'table': {
        this.recorder.keyframe(this.clock(), { pos: e.pos, vel: e.velOut, spin: e.spinOut });
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
          // (A machine serve bounces on its own half first: that's the serve, not a fault.)
          else if (r.bounces.length === 1 && e.pos.z < 0 && !this.machine.serve) r.result = 'FAULT';
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
            this.callout('OUT', 'Missed the table');
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
    this.fxHit(e.pos, e.velOut, e.spinOut, true, false);
    this.keyContact('me', this.playerView, e.pos, e.velIn, e.velOut, e.spinOut);
    this.playerView.strike(e.paddleVel);
    this.camOnHit(length(e.velOut));
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
    this.tutorialRegister(result!, landing);
    this.stats.attempts++;
    if (result === 'IN') {
      this.stats.made++;
      this.stats.streak++;
      this.stats.best = Math.max(this.stats.best, this.stats.streak);
      if (this.look.arcadeFx && this.stats.streak % 5 === 0) this.sfx.crowd(this.stats.streak % 10 === 0 ? 'cheer' : 'applause', Math.min(1, this.stats.streak / 20));
    } else {
      this.stats.streak = 0;
      if (result === 'OUT') this.callout('OUT', 'Missed the table');
      if (result === 'OWN SIDE') this.callout('OWN SIDE', 'Bounced on your own side');
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
    this.tutorialRegister('MISSED');
    this.callout('MISSED', 'Not returned');
    this.hud.setStats(this.stats);
    this.updateDrillHud();
    this.resolve();
  }

  private resolve() {
    this.recorder.end(this.clock());
    this.phase = 'done';
    this.sinceResolved = -this.extraDelay;
    this.extraDelay = 0;
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

  /** Seconds left before the bounce marks are gone (null: not fading). */
  private markerFade: number | null = null;
  private static readonly MARKER_FADE = 1.2;

  /** Point over: fade the bounce marks out instead of leaving them until the next serve. */
  fadeMarkers() {
    if (this.markers.length) this.markerFade = Sandbox.MARKER_FADE;
  }

  private updateMarkerFade(dt: number) {
    if (this.markerFade === null) return;
    this.markerFade -= dt;
    if (this.markerFade <= 0) {
      this.clearMarkers();
      return;
    }
    const k = this.markerFade / Sandbox.MARKER_FADE;
    for (const m of this.markers) {
      const mat = m.material as THREE.MeshBasicMaterial;
      mat.opacity = Math.min(mat.opacity, 0.9 * k);
    }
  }

  clearMarkers() {
    this.markerFade = null;
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

    this.doublesFrame();
    this.localServer?.pump();
    // Hit-stop pauses the game clock briefly; online the clock is the server's, so never.
    this.juice.allowHitStop = !this.online;
    const fxScale = this.online || this.replay ? 1 : this.juice.gameScale(realDt);
    this.updateMarkerFade(realDt);
    if (this.replay) {
      // Online the match carries on underneath (it can't be paused for one player).
      if (this.online) this.onlineFrame(realDt);
      this.runReplay(realDt);
    } else {
      if (this.online) this.onlineFrame(realDt);
      else if (this.match) this.matchFrame(realDt, fxScale);
      else {
        if (this.playing) this.updatePlayer(realDt);
        const rate = this.updatePlayRate(realDt, this.sim && this.playing ? this.sim.state.vel.z : null);
        if (!this.settings.paused) this.advance(realDt * this.settings.timeScale * rate * fxScale, realDt);
      }
      this.recordFrame();
      this.maybeAutoReplay();
      if (this.playing) this.updatePlayCamera(realDt);
    }
    this.syncMenu();
    this.ball.streakEnabled = this.look.arcadeFx;
    this.ball.playRate = this.replay ? this.replay.speed : this.online ? this.gameSpeed : this.playRate;
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
    if (this.replay && this.replayFreeCam) this.keepReplayCameraInRoom();
    const b = this.ball.last;
    this.juice.update(realDt, this.ball.isVisible && b ? { pos: b.pos, state: b.state, visible: true } : null);
    this.updateSpinTag();
    // Shake and zoom kick are applied for this render only.
    const shake = this.playing && !this.replay ? this.juice.cameraOffset : null;
    if (shake) {
      this.camera.position.add(shake);
      this.setFov(this.playFov + this.juice.fovOffset);
    }
    this.post.render();
    if (shake) this.camera.position.sub(shake);
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
      smash: !!this.input.smash || t.smash,
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
    const ic = this.computeIntercept(now);
    const intercept = ic?.pos ?? null;
    this.player.setIntercept(ic, now);
    this.player.update(realDt, input, move, AIM_POINT);
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? intercept : null, this.markerEta());
    this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive, !!input.smash);
  }

  // ---------------------------------------------------------------- match vs AI

  startMatch() {
    this.resetMatchStats();
    this.leaveOnline();
    this.endMatch(false);
    this.stopDrill();
    this.careerScreen?.hide();
    this.tourScreen?.hide();
    this.practicing = false;
    this.stopTutorial();
    this.matchRecorded = false;
    const ai = (this.ai = new AiPlayer('far', AI_LEVELS[this.matchSettings.level], this.params));
    const st = this.matchSettings.aiStyle === 'random' ? FREE_PLAY_OPPONENT_IDS[Math.floor(Math.random() * FREE_PLAY_OPPONENT_IDS.length)] : this.matchSettings.aiStyle;
    ai.setStyle(STYLES[st]);
    // Better opponents carry better bats: by World Tour stop, else by level.
    const stopIndex = this.tournament ? TOUR_STOPS.indexOf(this.tournament.stop) : -1;
    ai.setBat(opponentBat(st, stopIndex >= 0 ? TOUR_GEAR[stopIndex] : LEVEL_GEAR[this.matchSettings.level]));
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
          // The AI's plan (its chosen stroke) is still set when its hit is reported.
          this.fxHit(h.pos, h.velOut, h.spinOut, e.side === 'near', e.serve, e.side === 'far' && ai.plan?.stroke === 'smash');
          if (e.side === 'near') {
            this.keyContact('me', this.playerView, h.pos, h.velIn, h.velOut, h.spinOut);
            this.playerView.strike(h.paddleVel);
            this.camOnHit(length(h.velOut));
          } else this.keyContact('ai', this.aiView, h.pos, h.velIn, h.velOut, h.spinOut);
          this.recorder.caption(this.clock(), `${who}: ${name} · ${info.speed.toFixed(1)} m/s · ${Math.round(info.rpm).toLocaleString()} rpm`);
          if (e.side === 'near' && !e.serve) this.career.recordShot(info.name, info.speed, info.rpm);
          if (e.side === 'near') this.noteMyShot(info.speed, e.serve);
          if (e.side === 'near' && e.serve) this.reportMyServe({ pos: h.pos, vel: h.velOut, spin: h.spinOut });
          this.ball.clearTrail();
          break;
        }
        case 'ball':
          if (e.event.type !== 'paddle') this.ballSound(e.event);
          if (e.event.type === 'table') {
            this.recorder.keyframe(this.clock(), { pos: e.event.pos, vel: e.event.velOut, spin: e.event.spinOut });
            this.addMarker(e.event.pos, spinColor(e.event.velIn, e.event.spinIn));
          }
          break;
        case 'let':
          this.callout(LET_MESSAGE.title, LET_MESSAGE.sub);
          this.recorder.end(this.clock());
          break;
        case 'point': {
          this.fadeMarkers();
          this.recorder.end(this.clock());
          this.sfx.point(e.result.winner === 'near', e.game);
          this.updateVenueScreen();
          this.career.recordPoint(e.result.winner === 'near', { ace: e.result.ace, rallyHits: match.referee?.hits });
          this.playerView.react(e.result.winner === 'near' ? 'celebrate' : 'dismay');
          this.aiView.react(e.result.winner === 'far' ? 'celebrate' : 'dismay');
          this.matchHud.pointGlow(e.result.winner === 'near');
          this.notePoint(e.result.winner === 'near', match.referee?.hits ?? 0, !!e.result.ace);
          // Won a short point off your own serve that the AI misjudged: that's the serve working.
          const read = this.ai?.lastRead;
          if (e.result.winner === 'near' && match.referee?.server === 'near' && (match.referee?.hits ?? 9) <= 3 && read && Math.abs(read.seenTop - read.top) > Math.max(15, 0.35 * Math.abs(read.top))) this.career.award('social-engineering');
          this.fxPoint(e.result.reason, match.referee?.hits ?? 0, e.result.winner === 'near', e.match);
          const m = pointMessage(e.result, names);
          if (e.match) this.hud.flash(e.result.winner === 'near' ? 'YOU WIN!' : 'MATCH LOST', e.result.winner === 'near' ? 'You won the match!' : `${ai.displayName} won the match`);
          else if (e.game) this.hud.flash(e.result.winner === 'near' ? 'GAME WON' : 'GAME LOST', `Game to ${names[e.result.winner]}${this.look.callouts ? ` — ${m.title}: ${m.sub}` : ''}`);
          else this.callout(m.title, m.sub);
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
    this.updateVenueScreen();
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

  private matchFrame(realDt: number, fxScale = 1) {
    const match = this.match!;
    const ai = this.ai!;
    const running = this.playing && !this.settings.paused && match.phase !== 'match-over';
    if (running) {
      const { input, move } = this.gatherInput();
      const rate = this.updatePlayRate(realDt, match.sim && match.referee && match.referee.hits > 0 ? match.sim.state.vel.z : null);
      match.frame(realDt * this.settings.timeScale * rate * fxScale, realDt, { side: 'near', input, move });
      this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive, !!input.smash);
    }

    // Players and ball.
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? match.interceptFor('near') : null, this.markerEta());
    const pose = ai.worldPose;
    const body = ai.worldBody;
    this.aiView.updatePose(pose, body, ai.wing);
    const state = match.sim?.state ?? { pos: match.ballRenderPos(), vel: v3(), spin: v3() };
    if (running && match.sim) this.ball.rotate(state.spin, realDt * this.settings.timeScale);
    this.ball.update(match.ballRenderPos(), state);
    if (!match.sim) this.ball.clearTrail();

    this.matchHud.setRally(match.phase === 'rally' ? (match.referee?.hits ?? 0) : 0);
    if (this.playing && match.phase !== this.lastPhase) {
      this.lastPhase = match.phase;
      if (match.phase === 'serve-wait' && this.playing) this.matchHud.cue(match.humanToServe ? 'YOUR SERVE' : 'RECEIVE', match.humanToServe);
    }
    // Scoreboard.
    const sc = match.score;
    const gp = sc.gamePoint();
    const mp = sc.matchPoint();
    const badge = sc.deuce ? 'DEUCE' : mp ? `MATCH POINT · ${mp === 'near' ? 'You' : ai.displayName}` : gp ? `GAME POINT · ${gp === 'near' ? 'You' : ai.displayName}` : null;
    this.matchHud.setScore({
      you: 'You',
      them: 'Opponent',
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
        this.gradeMatch(won, ai.style.id, ai.displayName, this.matchSettings.level);
        this.career.recordMatch(won, { aiLevel: this.matchSettings.level, style: this.player.style.id });
        if (this.tournament) return this.reportTournamentMatch(sc.games.near, sc.games.far);
      }
      if (this.tournament) return;
      const games = sc.history.map((g) => `${g.near}–${g.far}`).join('  ·  ');
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
      this.matchHud.showOver(won ? 'YOU WIN!' : 'MATCH LOST', won ? `You beat ${ai.displayName} ${sc.games.near}–${sc.games.far}` : `${ai.displayName} won ${sc.games.far}–${sc.games.near}`, games, 'Rematch', 'Back to practice', this.matchStatsList(), this.lastGrade);
      if (document.pointerLockElement) document.exitPointerLock();
      return;
    }
    this.updateServeBar(this.playing && match.humanToServe);
    if (!this.playing) {
      this.matchHud.setPrompt(null);
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
    const h = tossHeightFor(held / TOSS_HOLD_MAX);
    this.player.tossHeight = h;
    if (this.online) this.online.toss(h);
    else this.match!.toss(h);
  }

  private servePrompt() {
    const t = SERVE_TYPES.find((x) => x.id === this.serveType)!;
    const how = this.isTouch
      ? 'Hold <b>Serve</b> to toss, release, then swipe as it drops'
      : 'Hold <kbd>Space</kbd> to toss, release, then swing as it drops';
    const pick = this.isTouch ? 'tap a serve below to change' : '<kbd>1</kbd>–<kbd>6</kbd> or <kbd>Q</kbd>/<kbd>E</kbd> to change';
    return `<b>${t.name} serve</b> · ${this.isTouch ? t.touch : t.mouse}<br><small>${how} · ${pick}</small>`;
  }

  // ---------------------------------------------------------------- career, drills, tournaments

  private unlockLabel(kind: UnlockKind, id: string) {
    if (kind === 'venue') return VENUES[id as VenueId]?.name ?? id;
    if (kind === 'style') return STYLES[id as StyleId]?.character ?? id;
    if (kind === 'blade') return `${BLADES[id as BladeId]?.name ?? id} blade`;
    return `${RUBBERS[id]?.name} rubber (${RUBBERS[id]?.kind})`;
  }

  /** True (and tells the player how to unlock it) if an item is still locked. */
  private locked(kind: UnlockKind, id: string): boolean {
    if (isUnlocked(kind, id, this.career.data, this.career.levelIndex)) return false;
    const rule = UNLOCKS.find((u) => u.kind === kind && u.id === id)!;
    this.hud.flash('LOCKED', `${this.unlockLabel(kind, id)}: ${rule.requirement}`);
    return true;
  }

  /** The Locker: stats, badges and unlocks. */
  openCareer() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    this.careerScreen.show();
  }

  /** The World Tour route and the stop in progress. */
  openTour(banner = '') {
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    this.menu.hide();
    this.tourScreen.show(banner);
  }

  /** "3/7 stops won · next: City Park" for the title screen. */
  tourSummary(): string {
    const won = this.career.data.tournaments;
    const n = stopsWon(won);
    if (this.tournament && this.tournament.state === 'playing') return `In progress: ${this.tournament.stop.place}`;
    const next = TOUR_STOPS.find((st, i) => stopUnlocked(i, won, false) && !(won[st.id] ?? 0));
    return next ? `${n}/${TOUR_STOPS.length} stops · next: ${next.place}` : `All ${TOUR_STOPS.length} stops won`;
  }

  /** Drills, for the Training menu. */
  readonly drills = DRILLS;
  drillOpen(index: number) {
    return drillUnlocked(index, this.career.data.drills, this.career.data.unlockAll);
  }
  drillStars(id: string) {
    return this.career.data.drills[id] ?? 0;
  }
  drillBest(id: string) {
    return this.career.data.drillScores[id] ?? 0;
  }

  startDrill(id: string) {
    const idx = DRILLS.findIndex((d) => d.id === id);
    if (idx < 0 || !drillUnlocked(idx, this.career.data.drills, this.career.data.unlockAll)) return;
    this.leaveOnline();
    this.endMatch();
    this.tournament = null;
    this.careerScreen.hide();
    this.drill = new DrillSession(DRILLS[idx]);
    this.practicing = false;
    this.stopTutorial();
    this.machine.mix = false;
    this.clearMarkers();
    // Target zone, if the drill has one.
    this.showDrillZone(this.drill.drill.target ?? null);
    // Instructions stay up until the player says go — no ball until then.
    const d = this.drill.drill;
    const touch = matchMedia('(pointer: coarse)').matches;
    this.hud.hold(d.name.toUpperCase(), `${d.description}<br><b>Goal:</b> ${d.goal}`, touch ? 'Tap to start' : 'Click or press any key to start');
    this.drillWaiting = true;
    this.phase = 'done';
    this.sinceResolved = 0;
    this.updateDrillHud();
    this.requestPlay();
  }

  /** Light up a zone on the far half (a drill's target, or the called side); null clears it. */
  private showDrillZone(z: TargetZone | null) {
    if (this.drillZone) this.scene.remove(this.drillZone);
    this.drillZone = null;
    if (!z) return;
    this.drillZone = new THREE.Mesh(new THREE.PlaneGeometry(z.x1 - z.x0, z.z1 - z.z0), new THREE.MeshBasicMaterial({ color: 0x4ade80, transparent: true, opacity: 0.28, depthWrite: false }));
    this.drillZone.rotation.x = -Math.PI / 2;
    this.drillZone.position.set((z.x0 + z.x1) / 2, TABLE.height + 0.002, (z.z0 + z.z1) / 2);
    this.scene.add(this.drillZone);
  }

  private drillRegister(result: NonNullable<ReturnReport['result']>, landing?: Vec3) {
    if (!this.drill) return;
    const r = this.lastReturn;
    // The contact grade, if the ball was hit at all.
    const grade = result === 'MISSED' ? undefined : this.player.lastContact?.grade;
    const ok = this.drill.register({ result, shot: r?.name ?? '-', top: r?.top ?? 0, speed: r?.speed ?? 0, landing: landing && { x: landing.x, z: landing.z }, grade });
    if (ok) this.sfx.point(true);
    if (ok && this.drill.combo >= 5 && this.drill.combo % 5 === 0) this.hud.toast(`🔥 Combo ×${this.drill.combo}`);
    if (this.drill.done) setTimeout(() => this.finishDrill(), 900);
  }

  private updateDrillHud() {
    if (!this.drill) return;
    const d = this.drill;
    const marks = d.log.map((ok) => (ok ? '✓' : '✗')).join('');
    const call = d.ball?.call ? ` · <b>${d.ball.call === 'left' ? '◀ LEFT' : 'RIGHT ▶'}</b>` : '';
    this.hud.setStatsText(`<b>${d.drill.name}</b> · ball ${Math.min(d.fed, d.drill.balls)}/${d.drill.balls} · ${d.successes} ✓ · <b>${d.score.toLocaleString()}</b> pts${d.combo > 1 ? ` · combo ×${d.combo}` : ''}${call} · goal: ${d.drill.goal} <span style="letter-spacing:1px">${marks}</span>`);
  }

  private finishDrill() {
    const d = this.drill;
    if (!d) return;
    const prevBest = this.career.data.drillScores[d.drill.id] ?? 0;
    this.career.recordDrill(d.drill.id, d.stars, DRILLS.map((x) => x.id), d.score);
    this.stopDrill();
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    const st = '★'.repeat(d.stars) + '☆'.repeat(3 - d.stars);
    const rep = d.report();
    const faults = [rep.early && `${rep.early} early`, rep.edge && `${rep.edge} off-centre`, rep.overhit && `${rep.overhit} over-hit`, rep.missed && `${rep.missed} missed`].filter(Boolean).join(', ');
    this.menu.banner = `<b>${d.drill.name}</b>: ${d.successes}/${d.drill.balls} <span class="stars">${st}</span> · <b>${d.score.toLocaleString()}</b> pts${d.score > prevBest ? ' <b>(new best!)</b>' : ''} · best combo ×${d.bestCombo}${d.stars === 0 ? ` — need ${d.drill.stars[0]} for a star.` : ''}
      <div class="menu-coach"><b>Coach:</b> ${rep.clean} clean contact${rep.clean === 1 ? '' : 's'}${faults ? ` · ${faults}` : ''}.${rep.breakdown ? ` Returned: ${rep.breakdown}.` : ''} ${rep.tip}</div>`;
    this.menu.show('training');
  }

  /** The drill's instructions are up; the first ball waits for this. */
  private drillWaiting = false;

  private drillGo() {
    if (!this.drillWaiting) return false;
    this.drillWaiting = false;
    this.hud.hold(null);
    this.sinceResolved = 0; // first ball shortly after
    return true;
  }

  private stopDrill() {
    if (this.drillWaiting) this.hud.hold(null);
    this.drillWaiting = false;
    if (this.drillZone) this.scene.remove(this.drillZone);
    this.drillZone = null;
    this.drill = null;
    this.hud.setStats(this.stats);
  }

  /** Enter a World Tour stop. */
  startTournament(id: string) {
    const i = TOUR_STOPS.findIndex((x) => x.id === id);
    if (i < 0 || !stopUnlocked(i, this.career.data.tournaments, this.career.data.unlockAll)) return;
    const stop = TOUR_STOPS[i];
    this.tournament = new TourRun(stop);
    this.openTour(
      stop.format === 'knockout'
        ? `Welcome to <b>${stop.place}</b>. Win every round of the ${stop.name} — one loss and you're out.`
        : `Welcome to <b>${stop.place}</b>. Play everyone in your group once; finish in the top two to reach the final.`,
    );
  }

  private playTournamentRound() {
    const r = this.tournament?.current;
    if (!r) return;
    const keep = this.tournament;
    this.matchSettings.level = r.level;
    this.matchSettings.aiStyle = r.style;
    this.matchSettings.bestOf = r.bestOf;
    this.setVenue(r.venue); // tour stops may use venues you haven't unlocked yet
    this.startMatch();
    this.tournament = keep; // startMatch clears ongoing modes; keep the run
    this.hud.flash(r.label.toUpperCase(), `${AI_LEVELS[r.level].name} · best of ${r.bestOf}`);
  }

  private reportTournamentMatch(mine: number, theirs: number) {
    const run = this.tournament!;
    const played = run.current!;
    const state = run.report(mine, theirs);
    if (document.pointerLockElement) document.exitPointerLock();
    const stop = run.stop;
    const score = `${mine}–${theirs}`;
    const g = this.lastGrade;
    const gradeLine = g ? ` <span class="grade-chip g-${g.grade}">${g.grade}</span> ${g.text}${g.best ? ' <b>(new best!)</b>' : ''}` : '';
    let banner: string;
    if (state === 'won') {
      this.career.recordTournament(stop.id, stop.xp, stop.achievement);
      if (stopsWon(this.career.data.tournaments) === TOUR_STOPS.length) this.career.award('world-tour');
      const i = TOUR_STOPS.indexOf(stop);
      const next = TOUR_STOPS[i + 1];
      banner = `🏆 <b>You won the ${stop.name}!</b> +${stop.xp} XP${next ? ` · Next stop: <b>${next.place}</b>` : ' · World Tour complete!'}`;
    } else if (state === 'eliminated') {
      banner = run.group && run.group.phase === 'eliminated' && !run.group.finalScore ? `Out in the group stage at ${stop.place}: you needed a top-two finish. Enter again to have another go.` : `Knocked out: ${played.label} (${score}). Enter again to have another go.`;
    } else {
      const next = run.current!;
      const toFinal = run.group?.phase === 'final' && !played.label.startsWith('Final');
      banner = `${mine > theirs ? '✓' : '✗'} ${played.label}: ${score}.${toFinal ? ' <b>Through to the final!</b>' : ''} Next: <b>${next.label}</b>.`;
    }
    if (gradeLine) banner += `<div class="tour-grade">Match grade:${gradeLine}</div>`;
    this.endMatch();
    this.openTour(banner);
  }

  // ---------------------------------------------------------------- menu (title, settings, pause)

  /** null if unlocked, otherwise the requirement. */
  lockReason(kind: UnlockKind, id: string): string | null {
    if (isUnlocked(kind, id, this.career.data, this.career.levelIndex)) return null;
    return UNLOCKS.find((u) => u.kind === kind && u.id === id)?.requirement ?? 'Locked';
  }

  /** A match from the menu (not a tournament round: that would abandon the run). */
  startAiMatch() {
    this.tournament = null;
    this.startMatch();
  }

  startPractice() {
    this.leaveOnline();
    this.endMatch();
    this.stopDrill();
    this.tournament = null;
    this.stopTutorial();
    this.practicing = true;
    this.requestPlay();
  }

  // ---------------------------------------------------------------- interactive tutorial

  startTutorial() {
    this.leaveOnline();
    this.endMatch();
    this.stopDrill();
    this.tournament = null;
    this.practicing = false;
    this.howTo.hide();
    this.careerScreen.hide();
    this.tutorial = new Tutorial();
    this.machine.mix = false;
    this.clearMarkers();
    this.phase = 'done';
    this.sinceResolved = -1.5; // a moment to read the first card
    this.hud.setStatsText('');
    this.coach.update(this.tutorial);
    document.body.classList.add('tutorial');
    savePref('mem.seenHowTo', '1'); // the coach explains as you go
    this.requestPlay();
  }

  private stopTutorial() {
    if (!this.tutorial) return;
    this.tutorial = null;
    this.coach.update(null);
    document.body.classList.remove('tutorial');
    this.hud.setStats(this.stats);
  }

  private tutorialRegister(result: NonNullable<ReturnReport['result']>, landing?: Vec3) {
    const t = this.tutorial;
    if (!t || !t.step) return;
    const step = t.step;
    const r = this.lastReturn;
    const ret = { result, shot: r?.name ?? '-', top: r?.top ?? 0, speed: r?.speed ?? 0, landing: landing && { x: landing.x, z: landing.z } };
    const out = t.register(ret);
    if (out === 'miss') {
      this.coach.update(t, tutorialHint(ret, step, this.isTouch));
    } else if (out === 'ok') {
      this.sfx.point(true);
      this.coach.update(t);
    } else if (out === 'step') {
      this.sfx.point(true, true);
      this.hud.flash('NICE!', `${step.title} ✓ · next: ${t.step!.title}`);
      this.extraDelay = 1.2;
      this.coach.update(t);
    } else {
      this.sfx.point(true, true);
      this.hud.flash('NICE!', `${step.title} ✓`);
      this.extraDelay = 99;
      setTimeout(() => this.finishTutorial(), 1100);
    }
  }

  private finishTutorial() {
    if (!this.tutorial) return;
    savePref('mem.tutorialDone', '1');
    this.tutorial = null;
    this.coach.update(null);
    document.body.classList.remove('tutorial');
    this.hud.setStats(this.stats);
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    this.coach.showFinish();
  }

  showHowTo() {
    this.howTo.show();
  }

  resume() {
    this.requestPlay();
  }

  get canReplay() {
    return !!this.recorder.last;
  }

  /** From the pause menu: hide it and play the last rally; the menu comes back when it ends. */
  watchReplay() {
    if (!this.recorder.last) return;
    this.menu.hide();
    this.startReplay();
  }

  restart() {
    if (this.offlineDoubles) this.startDoubles();
    else if (this.tutorial) this.startTutorial();
    else if (this.drill) this.startDrill(this.drill.drill.id);
    else if (this.match && !this.tournament) this.startMatch();
    else this.resume();
  }

  quitToTitle() {
    if (document.pointerLockElement) document.exitPointerLock();
    this.setPlaying(false);
    this.leaveOnline();
    this.endMatch();
    this.matchHud.hideOver();
    this.stopDrill();
    this.stopTutorial();
    this.practicing = false;
    this.inspecting = false;
    this.phase = 'done';
    this.menu.show('title');
  }

  /** Developer free camera (only offered with developer tools on). */
  inspect() {
    this.inspecting = true;
    this.menu.hide();
  }

  private inSession() {
    return !!(this.match || this.drill || this.online || this.practicing || this.tutorial);
  }

  private pauseContext(): PauseContext {
    if (this.online && this.offlineDoubles) {
      const sc = this.online.score;
      const side = this.online.side;
      const them = side === 'near' ? 'far' : 'near';
      return { kind: 'match', detail: `Doubles vs AI${sc ? ` · <b>${sc.points[side]}–${sc.points[them]}</b> · games ${sc.games[side]}–${sc.games[them]}` : ''}` };
    }
    if (this.online) return { kind: 'online', detail: 'Online match: it keeps going while you are paused.' };
    if (this.match && this.ai) {
      const sc = this.match.score;
      return {
        kind: this.tournament ? 'tournament' : 'match',
        detail: `${this.tournament ? `${this.tournament.stop.name} · ` : ''}vs ${this.ai.displayName} · <b>${sc.points.near}–${sc.points.far}</b> · games ${sc.games.near}–${sc.games.far}`,
      };
    }
    if (this.tutorial?.step) return { kind: 'tutorial', detail: `Tutorial · step ${this.tutorial.index + 1}: ${this.tutorial.step.title}` };
    if (this.drill) return { kind: 'drill', detail: `Drill: ${this.drill.drill.name} · ball ${Math.min(this.drill.fed, this.drill.drill.balls)}/${this.drill.drill.balls}` };
    return { kind: 'practice', detail: `Practice vs the ball machine · ${this.stats.made}/${this.stats.attempts} returned` };
  }

  /** Whenever nothing else is on screen and you're not playing, show the title or pause menu. */
  private syncMenu() {
    if (this.playing || this.menu.visible || this.inspecting || this.replay) return;
    if (this.careerScreen.visible || this.tourScreen.visible || this.howTo.visible || this.lobby.visible || this.matchHud.overVisible || this.coach.finishVisible) return;
    if (this.inSession()) this.menu.show('pause', this.pauseContext());
    else this.menu.show('title');
  }

  private onMenuChange(screen: string | null) {
    const title = screen === 'title';
    this.controls.autoRotate = title;
    this.controls.autoRotateSpeed = 0.35;
    if (title) {
      this.setCamera('Broadcast');
      // The title shows a clean venue: no ball machine or aiming ring (developer view only).
      this.machineMesh.visible = this.devTools;
      this.targetRing.visible = false;
      this.predictionLine.visible = false;
    } else if (screen === null && !this.playing) this.setCamera(this.settings.camera);
    this.menuFrame = title;
    requestAnimationFrame(() => this.frameAroundMenu());
  }

  /** On the title screen, shift the picture so the table sits in the space beside the menu. */
  private menuFrame = false;
  private frameAroundMenu() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const card = this.menuFrame ? this.container.querySelector<HTMLElement>('.menu-card') : null;
    const box = this.container.getBoundingClientRect();
    const right = card ? card.getBoundingClientRect().right - box.left : 0;
    // Only when there is real room beside the menu (landscape); portrait phones keep the plain view.
    if (card && w - right > w * 0.3) {
      // A little left of the gap's centre so the table sits close to the menu.
      const freeCentre = right + (w - right) * 0.4;
      this.camera.setViewOffset(w, h, w / 2 - freeCentre, 0, w, h);
    } else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  setRealismPercent(p: number) {
    this.realism.percent = p;
    savePref('mem.realism', String(p));
    this.applyRealism();
  }

  /** `announce`: flash the character banner (not when restoring the saved player at startup). */
  setStyle(id: StyleId, announce = true) {
    if (this.lockReason('style', id)) return;
    this.realism.style = id;
    savePref('mem.style', id);
    this.player.applyStyle(id);
    this.player.applyBat(this.batFor(id));
    this.playerView.setStyle(id);
    this.rubberSel.forehand = this.player.rubbers.forehand.id;
    this.rubberSel.backhand = this.player.rubbers.backhand.id;
    this.online?.setStyle(id);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    if (announce && !this.menu?.visible) this.hud.flash(STYLES[id].character.toUpperCase(), `${STYLES[id].role !== STYLES[id].character ? STYLES[id].role + ' · ' : ''}${STYLES[id].label}: ${STYLES[id].description}`);
  }

  /** A character's bat: the one you set up for them, else their usual rubbers on a starter blade. */
  batFor(id: StyleId): Bat {
    const saved = this.career.data.bats[id];
    if (!saved) return defaultBat(id);
    // Kit that's locked again (e.g. after switching "Unlock everything" off) falls back.
    const ok = (kind: UnlockKind, x: string) => !this.lockReason(kind, x);
    const d = defaultBat(id);
    return {
      blade: ok('blade', saved.blade) ? saved.blade : d.blade,
      forehand: ok('rubber', saved.forehand) ? saved.forehand : d.forehand,
      backhand: ok('rubber', saved.backhand) ? saved.backhand : d.backhand,
    };
  }

  /** Change a character's bat (only to unlocked kit); applies now if it's your player. */
  setBat(id: StyleId, bat: Bat) {
    if (this.lockReason('blade', bat.blade) || this.lockReason('rubber', bat.forehand) || this.lockReason('rubber', bat.backhand)) return;
    this.career.setBat(id, bat);
    if (this.player.style.id === id) {
      this.player.applyBat(bat);
      this.rubberSel.forehand = bat.forehand;
      this.rubberSel.backhand = bat.backhand;
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    }
  }

  setVolume(v: number) {
    this.look.volume = v;
    this.sfx.volume = v;
    this.sfx.applyVolume();
    savePref('mem.volume', String(v));
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setMuted(m: boolean) {
    this.look.muted = m;
    this.sfx.muted = m;
    this.sfx.applyVolume();
    savePref('mem.muted', m ? '1' : '0');
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setAmbience(a: boolean) {
    this.look.ambience = a;
    this.sfx.ambienceOn = a;
    this.sfx.setAmbience(a ? VENUES[this.look.venue].ambience : 'none');
    savePref('mem.ambience', a ? '1' : '0');
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setMusic(m: boolean) {
    this.look.music = m;
    this.sfx.musicOn = m;
    this.sfx.setMusic(VENUES[this.look.venue].song);
    savePref('mem.music', m ? '1' : '0');
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setAutoReplay(a: boolean) {
    this.look.autoReplay = a;
    savePref('mem.autoReplay', a ? '1' : '0');
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setReplaySpeed(speed: number) {
    this.look.replaySpeed = speed;
    savePref('mem.replaySpeed', String(speed));
    if (this.replay) this.replay.speed = speed;
  }

  setArcadeFx(a: boolean) {
    this.look.arcadeFx = a;
    this.juice.enabled = a;
    this.sfx.heavyHits = a;
    savePref('mem.arcadeFx', a ? '1' : '0');
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setQuality(q: QualitySetting) {
    this.quality.setting = q;
    savePref('mem.quality', String(q));
    this.applyQuality();
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  setDevTools(on: boolean) {
    this.devTools = on;
    savePref('mem.devTools', on ? '1' : '0');
    this.gui.show(on);
    document.body.classList.toggle('dev-tools', on);
    if (!on) this.inspecting = false;
    this.menu?.refresh();
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
    this.applyBloom();
    this.resize();
  }

  /** Bloom only at High quality (and only if the player wants it). */
  private applyBloom() {
    this.post.enabled = this.look.bloom && this.qualityLevel === QUALITY_LEVELS.length - 1;
    this.juice?.setGlow(this.post.enabled);
  }

  /** A per-point / per-return call-out: only if the player wants them. */
  private callout(title: string, sub: string) {
    if (this.look.callouts) this.hud.flash(title, sub);
  }

  /** The spin label on the incoming ball (while playing, not in replays). */
  private updateSpinTag() {
    const b = this.ball.last;
    // Render coordinates always put you at the near (+z) end: incoming = moving toward +z.
    if (!this.look.spinLabel || !this.playing || this.replay || !b || !this.ball.isVisible || b.state.vel.z <= 0.5 || this.menu.screen) return this.hud.spinTag(null);
    const p = new THREE.Vector3(b.pos.x, b.pos.y, b.pos.z).project(this.camera);
    if (p.z > 1 || Math.abs(p.x) > 1.1 || Math.abs(p.y) > 1.1) return this.hud.spinTag(null);
    const { kind } = spinKind(b.state.vel, b.state.spin);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.hud.spinTag({ kind, color: SPIN_PALETTES[this.look.spinPalette][kind], x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h });
  }

  setSpinPalette(p: SpinPalette) {
    this.look.spinPalette = p;
    savePref('mem.spinPalette', p);
    setSpinPalette(p);
    this.ball.clearTrail();
  }

  setSwipeMode(m: SwipeMode) {
    this.look.swipeMode = m;
    savePref('mem.swipeMode', m);
    this.player.swing.params.swipeMode = m;
  }

  setSpinLabel(on: boolean) {
    this.look.spinLabel = on;
    savePref('mem.spinLabel', on ? '1' : '0');
  }

  setReduceMotion(on: boolean) {
    this.look.reduceMotion = on;
    savePref('mem.reduceMotion', on ? '1' : '0');
    this.juice.reduceMotion = on;
  }

  setMjMode(on: boolean) {
    this.look.mjMode = on;
    savePref('mem.mjMode', on ? '1' : '0');
    this.sfx.wantGrunts = on;
    if (on) this.sfx.yelp(); // a taste of it (and starts loading the grunts)
  }

  setCallouts(on: boolean) {
    this.look.callouts = on;
    savePref('mem.callouts', on ? '1' : '0');
  }

  setFullSpeedOut(on: boolean) {
    this.look.fullSpeedOut = on;
    savePref('mem.fullSpeedOut', on ? '1' : '0');
  }

  setBloom(on: boolean) {
    this.look.bloom = on;
    savePref('mem.bloom', on ? '1' : '0');
    this.applyBloom();
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  // ---------------------------------------------------------------- look, sound, replays

  private clock() {
    return performance.now() / 1000;
  }

  setVenue(id: VenueId) {
    this.look.venue = id;
    this.venue = setVenue(this.scene, id, this.venue);
    this.sfx.setAmbience(this.look.ambience ? VENUES[id].ambience : 'none');
    this.sfx.setMusic(VENUES[id].song);
    savePref('mem.venue', id);
    this.updateVenueScreen();
    this.gui?.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  /** The conference room's TV shows the score. */
  private updateVenueScreen() {
    if (!this.venue?.setScore) return;
    if (this.online?.score) {
      const c = this.online;
      const sc = c.score!;
      const them: SideId = c.side === 'near' ? 'far' : 'near';
      this.venue.setScore([`YOU  ${sc.points[c.side]}`, `OPPONENT  ${sc.points[them]}`, `GAMES ${sc.games[c.side]}-${sc.games[them]}`]);
    } else if (this.match && this.ai) {
      const sc = this.match.score;
      this.venue.setScore([`YOU          ${sc.points.near}`, `${this.ai.style.character.toUpperCase().padEnd(12)} ${sc.points.far}`, `GAMES ${sc.games.near}-${sc.games.far}`]);
    } else {
      this.venue.setScore(['MEM TABLE TENNIS', 'PRACTICE', `RETURNS ${this.stats.made}/${this.stats.attempts}`]);
    }
  }

  /** The shot readout / match shot list: hidden while playing unless asked for. */
  private applyShotDetails() {
    this.hud.showDetails = this.look.shotDetails;
    this.hud.setPlaying(this.playing);
    this.matchHud.showDetails = this.look.shotDetails;
    if (this.match || this.online?.score) this.matchHud.show(true);
  }

  /** Timing-ring input: seconds until the ball arrives (only with arcade effects). */
  private markerEta(): number | undefined {
    return this.look.arcadeFx ? this.player.interceptEta : undefined;
  }

  private resetMatchStats() {
    this.mstats = { won: 0, played: 0, longest: 0, fastest: 0, aces: 0, perfect: 0, clean: 0, strokes: 0 };
    this.lastPhase = '';
    this.lastGrade = null;
  }

  private noteMyShot(speed: number, serve: boolean) {
    if (!serve) this.mstats.fastest = Math.max(this.mstats.fastest, speed * 3.6);
    const g = !serve ? this.player.lastContact?.grade : undefined;
    if (g) {
      this.mstats.strokes++;
      if (g === 'PERFECT') this.mstats.perfect++;
      if (g === 'PERFECT' || g === 'GOOD') this.mstats.clean++;
    }
  }

  /** After your serve: how good it was (height over the net, length, spin), and its contact grade. */
  private reportMyServe(ball: BallState) {
    const r = serveReport(ball, this.params);
    this.lastServe = r;
    const g = this.player.lastContact?.grade;
    const graded = g && g !== 'GOOD' ? ` <span class="toast-grade${g === 'PERFECT' ? ' gold' : ''}">${GRADE_TEXT[g].title}</span>` : '';
    this.hud.toast(`🏓 Serve: <b>${r.text}</b>${graded}`);
  }

  /** The last serve you hit (for objectives and stats). */
  lastServe: ServeReport | null = null;

  private notePoint(mine: boolean, hits: number, ace: boolean) {
    const m = this.mstats;
    m.played++;
    if (mine) m.won++;
    if (mine && ace) m.aces++;
    m.longest = Math.max(m.longest, hits);
  }

  /**
   * The S/A/B/C grade for the match just finished; records it (best per opponent,
   * grade badges) and keeps it for the end-of-match card.
   */
  private gradeMatch(won: boolean, opponent: string, opponentName: string, aiLevel?: AiLevel) {
    const m = this.mstats;
    const { grade } = matchGrade({ strokes: m.strokes, clean: m.clean, perfect: m.perfect, pointsWon: m.won, pointsPlayed: m.played, won });
    const prev: MatchGrade | undefined = this.career.data.bestGrades[opponent];
    const best = this.career.recordGrade(opponent, grade, { aiLevel });
    const note = best ? (prev ? `New best vs ${opponentName} (was ${prev})` : `First grade vs ${opponentName}`) : `Best vs ${opponentName}: ${prev}`;
    this.lastGrade = { grade, text: MATCH_GRADE_TEXT[grade], note, best };
  }

  /** Label/value pairs for the end-of-match card. */
  private matchStatsList(): [string, string][] {
    const m = this.mstats;
    return [
      ['Points won', `${m.won}/${m.played}${m.aces ? ` · ${m.aces} ace${m.aces > 1 ? 's' : ''}` : ''}`],
      ['Longest rally', `${m.longest} hits`],
      ['Fastest shot', m.fastest ? `${Math.round(m.fastest)} km/h` : '—'],
      ['Clean contacts', m.strokes ? `${m.clean}/${m.strokes} · ${m.perfect} perfect` : '—'],
    ];
  }

  /** Clean contacts in a row (any mode), for the Clean Hitter badge. */
  private cleanStreak = 0;

  /** Arcade effects for a paddle hit (render coordinates). `mine` = the local player. */
  /** `otherSmash`: someone else's hit (the AI, a partner, an online opponent) was a smash. */
  private fxHit(pos: Vec3, velOut: Vec3, spinOut: Vec3, mine: boolean, serve: boolean, otherSmash = false) {
    this.lastHitPower = serve ? 0 : hitPower(length(velOut));
    const perfect = mine && !serve && this.player.lastContactPerfect;
    this.juice.hit(pos, velOut, spinOut, { perfect, serve });
    // Speed call-out on a fast shot (its real speed).
    const kmh = length(velOut) * 3.6;
    if (this.look.arcadeFx && !serve && kmh >= 65) this.hud.speedPop(kmh, mine);
    if (this.look.arcadeFx && !this.look.reduceMotion && mine && !serve && kmh >= 45) this.matchHud.impact(Math.min(1, (kmh - 45) / 50));
    // Contact grade: PERFECT (with the chime and sparks under arcade effects) or a mishit.
    const g = mine && !serve ? this.player.lastContact?.grade : undefined;
    if (g) {
      this.cleanStreak = g === 'PERFECT' || g === 'GOOD' ? this.cleanStreak + 1 : 0;
      if (this.cleanStreak >= 10) this.career.award('clean-code');
    }
    // MJ mode: every smash, yours or theirs, gets a grunt (a yelp's caption only on yours,
    // unless PERFECT has the spot).
    const smashed = !serve && (mine ? this.player.lastContactSmash : otherSmash);
    const yelp = this.look.mjMode && smashed ? this.sfx.yelp(pos.x) : '';
    if (yelp && mine && !perfect) this.hud.grade(yelp, 'gold');
    if (perfect && this.look.arcadeFx) {
      this.sfx.perfect();
      this.hud.perfect();
    } else if (g && g !== 'PERFECT' && g !== 'GOOD') {
      this.hud.grade(GRADE_TEXT[g].title, 'bad');
      this.sfx.mishit();
    }
  }

  /** Colleagues react to how a point ended. */
  private fxPoint(reason: string, rallyHits: number, mine: boolean, matchOver: boolean) {
    if (!this.look.arcadeFx) return;
    const error = reason === 'net' || reason === 'out' || reason === 'own-side' || reason === 'volley-out';
    if (matchOver) {
      this.sfx.crowd(mine ? 'cheer' : 'applause', 1);
      this.finale = true;
    } else if (rallyHits >= 8) this.sfx.crowd('cheer', Math.min(1, rallyHits / 14));
    else if (rallyHits >= 5) this.sfx.crowd('applause', 0.5);
    else if (!error && this.lastHitPower > 0.75) this.sfx.crowd('applause', 0.4); // a smash winner
    else if (error && rallyHits >= 3) this.sfx.crowd('groan', 0.5);
  }

  private hitSound(speed: number, rubberKind: string, x: number) {
    this.sfx.paddle(speed, rubberKind, x);
    this.recorder.sound(this.clock(), 'paddle', speed, x, rubberKind);
  }

  /** Table / net / floor sounds (world event, shown from `side`'s view). */
  private ballSound(e: BallEvent, side: SideId = 'near') {
    const x = mapVec(side, e.pos).x;
    if (e.type === 'netCross' && this.look.arcadeFx && this.ball.last) {
      // A fast ball whooshes over the net (as fast as it looks, after any slow motion).
      const rate = this.online ? this.gameSpeed : this.playRate;
      this.sfx.whoosh(length(this.ball.last.state.vel) * rate, x, e.direction === side);
    }
    if (e.type === 'table') {
      this.sfx.table(e.impactSpeed, x);
      this.juice.bounce(mapVec(side, e.pos), e.impactSpeed);
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
  /**
   * Pin the replay to an exact contact: the ball where it was struck and the hitter's bat
   * face against it (the hitting face is on the side the ball came from).
   */
  private keyContact(viewId: string, view: PlayerView, ballPos: Vec3, velIn: Vec3, velOut: Vec3, spin: Vec3) {
    const n0 = view.last?.pose.normal;
    const bats: { id: string; pos: Vec3 }[] = [];
    if (n0) {
      const n = dot(velIn, n0) < 0 ? n0 : scale(n0, -1);
      bats.push({ id: viewId, pos: sub(ballPos, scale(n, BALL.radius + 0.005)) });
    }
    this.recorder.keyframe(this.clock(), { pos: ballPos, vel: velOut, spin }, bats);
  }

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
    // The match-winning rally, in slow motion.
    if (this.finale && last && last !== this.autoReplayed && !this.recorder.recording) {
      this.finale = false;
      this.autoReplayed = last;
      this.startReplay(Math.min(0.25, this.look.replaySpeed));
      return;
    }
    if (!this.look.autoReplay || !this.match || !last || last === this.autoReplayed || this.recorder.recording) return;
    this.autoReplayed = last;
    if (last.hits >= 6) this.startReplay();
  }

  startReplay(speed = this.look.replaySpeed) {
    const rally = this.recorder.last;
    if (!rally || this.replay) {
      if (!rally) this.hud.flash('NO DATA', 'Play a rally first, then press R');
      return;
    }
    this.replay = new ReplayPlayer(rally, speed);
    const visible = new Map(this.replayViews().map(([id, v]) => [id, v.isVisible]));
    this.savedCamera = { pos: this.camera.position.clone(), target: this.controls.target.clone(), visible };
    this.ball.clearTrail();
    this.playerView.setMarker(null);
    this.hud.setReplay({ caption: '…', speed });
    this.replayFreeCam = false;
    this.syncControlsEnabled();
  }

  /** Camera controls: off during play (the mouse swings the bat), except to steer a replay. */
  private syncControlsEnabled() {
    this.controls.enabled = !this.playing || (!!this.replay && !document.pointerLockElement);
  }

  /** Keep a viewer-steered replay camera (and what it orbits) inside the room. */
  private keepReplayCameraInRoom() {
    const b = this.venue?.bounds ?? OPEN_BOUNDS;
    const m = 0.25; // stay a little off the walls, floor and ceiling
    const clamp = (v: THREE.Vector3) => {
      v.x = THREE.MathUtils.clamp(v.x, -b.halfW + m, b.halfW - m);
      v.z = THREE.MathUtils.clamp(v.z, -b.halfD + m, b.halfD - m);
      v.y = THREE.MathUtils.clamp(v.y, 0.15, b.h - m);
    };
    clamp(this.controls.target);
    clamp(this.camera.position);
    this.camera.lookAt(this.controls.target);
  }

  /** Back to the broadcast shot after the viewer moved the replay camera. */
  resetReplayCamera() {
    this.replayFreeCam = false;
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
    this.replayFreeCam = false;
    this.syncControlsEnabled();
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
    // Broadcast camera: side-on, slowly drifting (until the viewer drags/zooms it themselves).
    if (!this.replayFreeCam) {
      const k = r.time / Math.max(0.5, r.rally.duration);
      this.camera.position.set(3.6 - k * 0.6, 1.75, 0.9 - k * 1.8);
      this.controls.target.set(0, 0.85, 0);
      this.camera.lookAt(this.controls.target);
    }
    this.hud.setReplay({ caption: r.caption || '…', speed: r.speed });
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
    this.menu.hide();
    this.practicing = false;
    this.stopTutorial();
    this.practiceUi(false);
    client.on((e) => this.onOnlineEvent(e));
    if (document.pointerLockElement) document.exitPointerLock();
  }

  leaveOnline() {
    if (!this.online) return;
    this.partnerTurn = false;
    if (this.serveBoxes) this.serveBoxes.visible = false;
    this.doublesServing = false;
    if (this.offlineDoubles) {
      this.offlineDoubles = false;
      this.localServer = null;
    }
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
    if (this.offlineDoubles) return this.startDoubles();
    this.matchHud.hideOver();
    if (this.online?.isHost) this.online.start(this.lobby.fillAI);
    else this.backToLobby();
  }

  private backToLobby() {
    if (this.offlineDoubles) return this.quitToTitle();
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
        if (!this.offlineDoubles && c.room?.phase === 'lobby' && !this.lobby.visible && c.phase === 'lobby') this.backToLobby();
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
        this.resetMatchStats();
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
        if (!e.serve) this.doublesServing = false;
        const info = classifyShot(mapVec(c.side, e.pos), e.velOut, e.spinOut, e.paddleVel, e.velIn, e.spinIn);
        const who = e.by === c.seat ? 'You' : (c.names[e.by] ?? e.by);
        const name = e.serve ? 'Serve' : info.name;
        this.matchHud.addShot({ who, name, speed: info.speed, rpm: info.rpm, top: info.top });
        const rubber = e.by === c.seat ? this.player.rubbers[this.player.swing.side].kind : 'Inverted';
        this.hitSound(length(e.velOut) + length(e.paddleVel), rubber, mapVec(c.side, e.pos).x);
        // Others' strokes aren't sent: a hit that plays like a smash counts as one.
        this.fxHit(mapVec(c.side, e.pos), mapVec(c.side, e.velOut), mapVec(c.side, e.spinOut), e.by === c.seat, e.serve, info.name === 'Smash');
        {
          const mine = e.by === c.seat;
          const view = mine ? this.playerView : this.remoteViews.get(e.by);
          if (view) this.keyContact(mine ? 'me' : e.by, view, mapVec(c.side, e.pos), mapVec(c.side, e.velIn), mapVec(c.side, e.velOut), mapVec(c.side, e.spinOut));
          if (mine) {
            this.playerView.strike(mapVec(c.side, e.paddleVel));
            this.camOnHit(length(e.velOut));
          }
        }
        this.recorder.caption(this.clock(), `${who}: ${name} · ${info.speed.toFixed(1)} m/s · ${Math.round(info.rpm).toLocaleString()} rpm`);
        this.rallyHits++;
        if (e.by === c.seat && !e.serve) this.career.recordShot(info.name, info.speed, info.rpm);
        if (e.by === c.seat) this.noteMyShot(info.speed, e.serve);
        if (e.by === c.seat && e.serve) this.reportMyServe({ pos: mapVec(c.side, e.pos), vel: mapVec(c.side, e.velOut), spin: mapVec(c.side, e.spinOut) });
        this.ball.clearTrail();
        if (c.next === c.seat) this.stopReplay();
        break;
      }
      case 'ball':
        if (e.event.type !== 'paddle') this.ballSound(e.event, c.side);
        if (e.event.type === 'table') {
          this.recorder.keyframe(this.clock(), { pos: mapVec(c.side, e.event.pos), vel: mapVec(c.side, e.event.velOut), spin: mapVec(c.side, e.event.spinOut) });
          this.addMarker(mapVec(c.side, e.event.pos), spinColor(e.event.velIn, e.event.spinIn));
        }
        break;
      case 'let':
        this.callout(LET_MESSAGE.title, LET_MESSAGE.sub);
        this.recorder.end(this.clock());
        break;
      case 'point': {
        this.recorder.end(this.clock());
        this.sfx.point(e.result.winner === c.side, e.game);
        this.updateVenueScreen();
        if (c.seat) this.career.recordPoint(e.result.winner === c.side, { ace: e.result.ace, rallyHits: this.rallyHits });
        this.playerView.react(e.result.winner === c.side ? 'celebrate' : 'dismay');
        for (const [seat, view] of this.remoteViews) view.react(seatSide(seat) === e.result.winner ? 'celebrate' : 'dismay');
        this.fxPoint(e.result.reason, this.rallyHits, e.result.winner === c.side, e.match);
        this.matchHud.pointGlow(e.result.winner === c.side);
        this.notePoint(e.result.winner === c.side, this.rallyHits, !!e.result.ace);
        const names = { near: this.teamName('near'), far: this.teamName('far') };
        const m = pointMessage(e.result, names);
        const mine = e.result.winner === c.side;
        if (e.match) this.hud.flash(mine ? 'YOU WIN!' : 'MATCH LOST', `${names[e.result.winner]} won the match`);
        else if (e.game) this.hud.flash(mine ? 'GAME WON' : 'GAME LOST', `Game to ${names[e.result.winner]}${this.look.callouts ? ` — ${m.title}: ${m.sub}` : ''}`);
        else this.callout(m.title, m.sub);
        break;
      }
      case 'over':
        if (c.seat && c.score) {
          const won = c.score.winner === c.side;
          this.gradeMatch(won, this.offlineDoubles ? 'doubles' : 'online', this.offlineDoubles ? 'Doubles' : 'Online', this.offlineDoubles ? this.matchSettings.level : undefined);
          this.career.recordMatch(won, { online: true, style: this.player.style.id });
        }
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
    if (this.playing) this.hud.setPaddle(this.player.swing.pitchDeg, this.player.swing.side, this.player.swing.forcedSide !== null, input.drive, !!input.smash);

    // Me (view frame), other players (world → view).
    this.playerView.visible = !!c.seat && inMatch;
    this.playerView.update(this.player);
    this.playerView.setMarker(this.settings.showIntercept ? c.interceptView() : null, this.markerEta(), this.partnerTurn);
    const seats = Object.keys(c.room?.seats ?? {}) as Seat[];
    for (const seat of seats) {
      if (seat === c.seat) continue;
      let view = this.remoteViews.get(seat);
      // Your doubles partner stands between the camera and the table: draw them see-through.
      const partner = seatSide(seat) === side;
      const style = c.room?.seats[seat]?.style ?? 'allround';
      const look = `${style}|${partner}`;
      if (!view) {
        view = new PlayerView(this.scene, { bodyColor: partner ? 0x60a5fa : 0xe8562a, bodyOpacity: 1, style, avatarOpacity: partner ? 0.35 : 1 });
        this.remoteViews.set(seat, view);
        this.remoteLooks.set(seat, look);
      } else if (this.remoteLooks.get(seat) !== look) {
        // A new match with a different line-up: re-dress the seat (it may now be your partner, or someone else).
        view.setStyle(style, partner ? 0.35 : 1);
        this.remoteLooks.set(seat, look);
      }
      const r = c.remotes.get(seat);
      view.visible = inMatch && !!r;
      if (!r) continue;
      const pos = mapVec(side, fromV(r.pose.p));
      const normal = mapVec(side, fromV(r.pose.n));
      const body = mapVec(side, { x: r.pose.b[0], y: 0, z: r.pose.b[1] });
      view.updatePose({ pos, normal, vel: { x: 0, y: 0, z: 0 } }, { x: body.x, z: body.z }, r.pose.wing);
      // (In replays the camera is elsewhere: show them at their usual see-through level.)
      view.fadeNear(this.playing && !this.replay ? this.camera.position : { x: 1e3, y: 0, z: 1e3 });
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

    this.matchHud.setRally(c.phase === 'rally' ? this.rallyHits : 0);
    if (this.playing && c.phase !== this.lastPhase) {
      this.lastPhase = c.phase;
      if (c.phase === 'serve-wait' && this.playing && c.seat && c.serverSeat) {
        const ours = seatSide(c.serverSeat) === c.side;
        this.matchHud.cue(c.myServe ? 'YOUR SERVE' : ours ? 'PARTNER SERVES' : 'RECEIVE', c.myServe);
      }
    }
    // Scoreboard (my team first).
    const sc = c.score;
    if (sc && c.phase !== 'lobby') {
      const them: SideId = side === 'near' ? 'far' : 'near';
      const badge = sc.deuce ? 'DEUCE' : sc.matchPoint ? `MATCH POINT · ${this.teamName(sc.matchPoint)}` : sc.gamePoint ? `GAME POINT · ${this.teamName(sc.gamePoint)}` : null;
      this.matchHud.setScore({
        you: 'You',
        them: 'Opponent',
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
          won ? 'YOU WIN!' : 'MATCH LOST',
          `${this.teamName(sc.winner!)} won ${sc.games[sc.winner!]}–${sc.games[sc.winner === 'near' ? 'far' : 'near']}`,
          sc.history.map((g) => `${g[side]}–${g[them]}`).join('  ·  '),
          c.isHost ? 'Rematch' : null,
          this.offlineDoubles ? 'Back to the title' : 'Back to lobby',
          this.matchStatsList(),
          c.seat ? this.lastGrade : null,
        );
        if (document.pointerLockElement) document.exitPointerLock();
      }
      this.matchHud.setPrompt(null);
      return;
    }
    this.updateServeBar(inMatch && this.playing && !!c.myServe);
    this.updateDoublesHelp(c, inMatch);
    if (!inMatch) {
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
    } else if (!this.playing && c.seat) {
      this.matchHud.setPrompt(this.offlineDoubles ? null : 'Paused locally — the match keeps going online!');
      this.matchHud.setMeter(null);
    } else if (c.myServe) {
      const to = c.mode === 'doubles' && c.receiverSeat ? `<br><b>Serve to ${c.names[c.receiverSeat] ?? 'them'}</b>: bounce it in your right half, then in theirs (lit up)` : '';
      this.matchHud.setPrompt(this.servePrompt() + to);
      this.matchHud.setMeter(this.tossHoldStart !== null ? (performance.now() - this.tossHoldStart) / 1000 / TOSS_HOLD_MAX : null);
    } else if (c.phase === 'serve-wait' && c.serverSeat) {
      const who = (seat: Seat | null) => (seat === c.seat ? 'you' : seat ? `${c.names[seat] ?? seat}${c.seat && seatSide(seat) === c.side ? ' (your partner)' : ''}` : '');
      this.matchHud.setPrompt(c.mode === 'doubles' && c.receiverSeat ? `${c.names[c.serverSeat] ?? 'Opponent'} serves to <b>${who(c.receiverSeat)}</b>` : `${c.names[c.serverSeat] ?? 'Opponent'} to serve`);
      this.matchHud.setMeter(null);
    } else {
      this.matchHud.setPrompt(null);
      this.matchHud.setMeter(null);
    }
  }

  /** Play camera: height above the floor and distance behind your body (adjustable, remembered). */
  playCam = {
    height: Number(loadPref('mem.camHeight', '1.5')),
    distance: Number(loadPref('mem.camDistance', '2.0')),
    /** Vertical field of view in play, degrees. Narrower = more zoomed in (like a TV camera). */
    fov: Number(loadPref('mem.camFov', '38')),
  };

  /** Play camera: 'classic' (high, far, telephoto), 'close' (behind you, wider) or 'dynamic'. */
  camMode: CamMode = (['classic', 'close', 'dynamic'] as const).includes(loadPref('mem.camMode', 'dynamic') as CamMode) ? (loadPref('mem.camMode', 'dynamic') as CamMode) : 'dynamic';
  /** Dynamic camera: eased extras (push-in as a ball arrives, a lift after your shot). */
  private camPush = 0;
  private camKick = 0;

  setCamMode(mode: CamMode) {
    this.camMode = mode;
    savePref('mem.camMode', mode);
  }

  /** Called when the local player strikes the ball (dynamic camera reacts). */
  private camOnHit(speed: number) {
    this.camKick = this.look.reduceMotion ? 0 : Math.min(1, speed / 25);
  }

  private updatePlayCamera(dt: number) {
    const b = this.player.body;
    let { height, distance, fov } = this.playCam;
    let follow = 0.25;
    let lookX = b.x * 0.1;
    let lookZ = -0.9;
    if (this.camMode !== 'classic') {
      const close = this.camMode === 'close';
      // Nearer and lower, with a wider lens: more depth, so a ball visibly rushes at you.
      height = close ? 1.48 : 1.55;
      distance = close ? 1.15 : 1.45;
      fov = close ? 54 : 48;
      follow = close ? 0.6 : 0.5;
      lookX = b.x * 0.3;
      // Aim nearer (tilted down a little), so your end of the table sits higher in the
      // frame, clear of the HUD at the bottom.
      lookZ = close ? -0.35 : -0.5;
      if (!close) {
        // Dynamic: the aim drifts gently toward the ball, eases in as a ball arrives
        // and lifts briefly after your shot. All small and smooth: the bat goes where
        // the cursor is in the world, so big camera moves would make it swim on screen.
        const ball = this.ball.isVisible ? this.ball.last : null;
        if (ball) lookX += (ball.pos.x - lookX) * 0.2;
        const eta = this.player.interceptEta;
        const pushTarget = Number.isFinite(eta) && eta > 0 && eta < 0.6 ? 1 - eta / 0.6 : 0;
        this.camPush += (pushTarget - this.camPush) * (1 - Math.exp(-dt * 6));
        this.camKick *= Math.exp(-dt * 3);
        distance -= 0.18 * this.camPush;
        fov += -3 * this.camPush + 5 * this.camKick;
        height += 0.06 * this.camKick;
        lookZ -= 0.25 * this.camKick;
      }
    }
    // Follow the body, smoothly: a steady view keeps the bat under your hand on screen.
    const target = new THREE.Vector3(b.x * follow, height, b.z + distance);
    // Look a little above the table so the ball's height over the net reads clearly;
    // the lower the camera, the higher (flatter) the look point.
    const look = new THREE.Vector3(lookX, 0.78 + Math.max(0, 1.95 - height) * 0.25, lookZ);
    const k = 1 - Math.exp(-dt / 0.12);
    this.camera.position.lerp(target, k);
    this.controls.target.lerp(look, k);
    this.camera.lookAt(this.controls.target);
    this.playFov = fov;
    this.setFov(fov);
  }

  /** The play camera's field of view this frame (the zoom kick adds to it). */
  private playFov = 38;

  private setFov(fov: number) {
    if (this.camera.fov === fov) return;
    this.camera.fov = fov;
    this.camera.updateProjectionMatrix();
  }

  /** Advance the simulation by gameDt seconds of game time using fixed ticks. */
  private advance(gameDt: number, realDt: number) {
    this.sinceFire += gameDt;
    if (this.playing) {
      if (this.drillWaiting) {
        // Waiting on the player to read the drill.
      } else if (this.phase === 'done' || this.phase === 'idle') {
        this.sinceResolved += realDt;
        if (this.sinceResolved > (this.drill?.drill.feedDelay ?? 0.9)) this.fire();
      } else if (this.sinceFire > 6) {
        this.resolve();
      }
    } else if ((this.machine.autoFire || this.menu.screen === 'title') && this.sinceFire >= this.machine.interval) {
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
    if (down && e.code === 'Backquote' && !e.repeat) return this.setDevTools(!this.devTools);
    if (this.menu.visible) {
      if (down && e.code === 'Escape') this.menu.handleEscape();
      if (down && e.code === 'Space') e.preventDefault();
      return;
    }
    // Esc pauses (pointer lock normally does this itself; this covers play without it).
    if (down && e.code === 'Escape' && this.playing && !document.pointerLockElement) {
      this.setPlaying(false);
      return;
    }
    if (down && !e.repeat && e.code !== 'Escape' && this.playing && this.drillGo()) return;
    // Esc during a replay watched while paused ends it (and the pause menu comes back).
    if (down && e.code === 'Escape' && !this.playing && this.replay) {
      this.stopReplay();
      return;
    }
    // Esc in the developer free-camera view brings the menu back.
    if (down && e.code === 'Escape' && !this.playing && this.inspecting) {
      this.inspecting = false;
      return;
    }
    if (down) this.keys.add(e.code);
    else this.keys.delete(e.code);
    if (this.playing && e.code.startsWith('Arrow')) e.preventDefault();
    if (e.code === 'Space' && this.online) {
      e.preventDefault();
      if (down && !e.repeat && this.playing && this.online.myServe) this.tossHoldStart = performance.now();
      if (!down) this.releaseToss();
      return;
    }
    // Choosing a serve: 1–6, or Q / E to cycle (only while it's your serve).
    if (down && this.playing && (this.match?.humanToServe || this.online?.myServe) && this.tossHoldStart === null) {
      const i = SERVE_TYPES.findIndex((t) => t.id === this.serveType);
      if (e.code >= 'Digit1' && e.code <= `Digit${SERVE_TYPES.length}`) return this.setServeType(SERVE_TYPES[Number(e.code.slice(5)) - 1].id);
      if (e.code === 'KeyQ') return this.setServeType(SERVE_TYPES[(i + SERVE_TYPES.length - 1) % SERVE_TYPES.length].id);
      if (e.code === 'KeyE') return this.setServeType(SERVE_TYPES[(i + 1) % SERVE_TYPES.length].id);
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
    } else if (e.code === 'KeyH') {
      this.hud.toggleHelp();
    } else if (e.code === 'KeyP') {
      this.settings.paused = !this.settings.paused;
      this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    } else if (e.code === 'Period') {
      this.step();
    } else if (e.code === 'KeyV' && this.replay) {
      this.resetReplayCamera();
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
    if (this.playing && this.drillGo()) return;
    if (this.playing) {
      // Left mouse button = Drive, right = Smash. Touches (swipes) never are: touch has its own buttons.
      if (e.button === 0 && e.pointerType === 'mouse') this.input.drive = true;
      if (e.button === 2 && e.pointerType === 'mouse') this.input.smash = true;
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
    this.post.setSize(w, h, this.renderer.getPixelRatio());
    this.ball.setResolution(w, h);
    this.camera.aspect = w / h;
    this.frameAroundMenu();
  }

  private buildGui() {
    const gui = (this.gui = new GUI({ title: 'Developer tools  ( ` )' }));
    const onMachine = () => this.updateMachineVisuals();

    gui.add({ play: () => this.requestPlay() }, 'play').name('▶ Play  (Esc to leave)');
    gui.add({ career: () => this.openCareer() }, 'career').name('📈 Locker: stats & badges');
    gui.add({ help: () => this.howTo.show() }, 'help').name('❓ How to play');

    const rf = gui.addFolder('Realism');
    rf.add(this.realism, 'percent', 0, 100, 5)
      .name('Arcade %')
      .onChange(() => this.applyRealism());
    for (const [name, v] of Object.entries(REALISM_PRESETS)) {
      // Presets: Simulation, Balanced, Assisted (default), Arcade.
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
      .onChange((v: number) => this.setVolume(v));
    lf.add(this.look, 'muted')
      .name('Mute')
      .onChange((m: boolean) => this.setMuted(m));
    lf.add(this.look, 'ambience')
      .name('Venue ambience')
      .onChange((a: boolean) => this.setAmbience(a));
    lf.add(this.look, 'music')
      .name('Music')
      .onChange((m: boolean) => this.setMusic(m));
    lf.add(this.look, 'autoReplay')
      .name('Auto-replay long rallies')
      .onChange((a: boolean) => this.setAutoReplay(a));
    lf.add(this.look, 'shotDetails')
      .name('Shot details while playing')
      .onChange((d: boolean) => {
        savePref('mem.shotDetails', d ? '1' : '0');
        this.applyShotDetails();
      });
    lf.add(this.look, 'arcadeFx')
      .name('Arcade effects (hit-stop, sparks, crowd)')
      .onChange((a: boolean) => this.setArcadeFx(a));
    lf.add({ replay: () => this.startReplay() }, 'replay').name('Replay last rally  [R]');
    lf.add(this.quality, 'setting', { 'Auto (adapts to your device)': 'auto', High: 2, Medium: 1, Low: 0 })
      .name('Graphics quality')
      .onChange((v: QualitySetting) => this.setQuality(v));
    lf.add(this.look, 'bloom').name('Glow (bloom, High quality)').onChange((b: boolean) => this.setBloom(b));
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
    mt.add(this.matchSettings, 'aiStyle', { Random: 'random', ...Object.fromEntries(FREE_PLAY_OPPONENT_IDS.map((id) => [styleTitle(id), id])) }).name('Opponent');
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
    const rubberSel = this.rubberSel;
    const styleNames = Object.fromEntries(PLAYABLE_STYLE_IDS.map((id) => [styleTitle(id), id]));
    pl.add(this.realism, 'style', styleNames)
      .name('Your style')
      .onChange((id: StyleId) => {
        if (this.locked('style', id)) {
          this.realism.style = this.player.style.id;
          pl.controllersRecursive().forEach((c) => c.updateDisplay());
          return;
        }
        this.setStyle(id);
      });
    const pickRubber = (wing: 'forehand' | 'backhand') => (id: string) => {
      if (this.locked('rubber', id)) {
        rubberSel[wing] = this.player.rubbers[wing].id;
        pl.controllersRecursive().forEach((c) => c.updateDisplay());
        return;
      }
      this.setBat(this.player.style.id, { ...this.player.bat, [wing]: id });
    };
    pl.add(rubberSel, 'forehand', rubberNames).name('Forehand rubber').onChange(pickRubber('forehand'));
    pl.add(rubberSel, 'backhand', rubberNames).name('Backhand rubber').onChange(pickRubber('backhand'));
    pl.add(this.player.swing.params, 'sensitivity', 0.0005, 0.004, 0.0001).name('Mouse sensitivity');
    pl.add(this.player.swing.params, 'swingGain', 0.6, 3, 0.05).name('Swing power');
    pl.add(this.player.assists, 'angle', 0, 1, 0.05).name('Angle assist');
    pl.add(this.player.assists, 'hitArea', 0, 0.1, 0.005).name('Hit area + (m)');
    pl.add(this.player.assists, 'magnet', 0, 0.5, 0.01).name('Bat magnet (m)');
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
    sf.add(this.machine, 'serve').name('Serve (bounce own half first)').onChange(onMachine);
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
    vf.add(this.playCam, 'height', 1.1, 2.4, 0.05)
      .name('Play camera height (m)')
      .onChange((v: number) => savePref('mem.camHeight', String(v)));
    vf.add(this.playCam, 'distance', 0.8, 3.5, 0.1)
      .name('Play camera distance (m)')
      .onChange((v: number) => savePref('mem.camDistance', String(v)));
    vf.add(this.playCam, 'fov', 25, 70, 1)
      .name('Play camera zoom (FOV°)')
      .onChange((v: number) => savePref('mem.camFov', String(v)));
    vf.add({ reset: () => {
      Object.assign(this.playCam, { height: 1.5, distance: 2.0, fov: 38 });
      for (const k of ['mem.camHeight', 'mem.camDistance', 'mem.camFov']) savePref(k, '');
      vf.controllersRecursive().forEach((c) => c.updateDisplay());
    } }, 'reset').name('Reset play camera');
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

/** A remembered character choice ('random' if none or unknown). */
function pickPref(key: string): StyleId | 'random' {
  const v = loadPref(key, 'random');
  return (FREE_PLAY_OPPONENT_IDS as string[]).includes(v) ? (v as StyleId) : 'random';
}

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

/** "Lee — Lee From IT, All-rounder" for pickers. */
function styleTitle(id: StyleId): string {
  const st = STYLES[id];
  return st.role === st.character ? `${st.character} — ${st.label}` : `${st.character} — ${st.role}, ${st.label}`;
}
