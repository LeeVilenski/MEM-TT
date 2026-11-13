import { RUBBERS, TABLE, lerp, normalize, scale, type BallState, type ContactAdjust, type PaddleCollider, type PaddlePose, type PhysicsParams, type Rubber, type Vec3 } from '../physics';
import { makeAngleAssist, type ShotMode } from './assist';
import { realismSettings } from './realism';
import { STYLES, type PlayStyle, type StyleId } from './styles';
import { DEFAULT_SWING } from './swing';
import { SwingController, type StrokeSide, type SwingInput } from './swing';

export interface AssistSettings {
  /** 0–1: pull the face angle toward one that lands on the table. */
  angle: number;
  /** Extra hittable radius around the blade, metres. */
  hitArea: number;
  /** 0–1: how strongly the player is moved to the ball. */
  footwork: number;
  /** Bat magnet radius, metres: within this of the ball's path the bat is pulled onto it as the ball arrives. */
  magnet: number;
}

export const DEFAULT_ASSISTS: AssistSettings = { angle: 0.75, hitArea: 0.035, footwork: 0.7, magnet: 0.3 };

export interface MoveInput {
  /** −1 … 1: left/right (arrow keys). */
  x: number;
  /** −1 … 1: toward (−) / away from (+) the table. */
  z: number;
}

const MANUAL_SPEED = 3.2; // m/s
const ASSIST_SPEED = 4.5; // m/s
/** Paddle plane distance in front of the body. */
const ARM_REACH = 0.42;
/** Comfortable body offset from the ball for each wing. */
const FOREHAND_OFFSET = 0.42;
const BACKHAND_OFFSET = 0.3;
/** How far a player can lean in over the table. */
const MAX_LEAN = 0.45;
/** The magnet ramps up over the last this-many seconds before contact. */
const MAGNET_WINDOW = 0.3;
const AIM_LIMIT = 0.6;
/** A stroke whose peak is this close (s) before contact is perfectly timed. */
export const PERFECT_WINDOW = 0.05;
/** How far the bat can go sideways in the world. */
const BAT_LIMIT = TABLE.width / 2 + 1.1;

/**
 * A player at the near end: body position (footwork), swing controller and rubbers.
 * Engine-agnostic so it can be driven by local input now, and network input later.
 */
export class Player {
  readonly id: string;
  /** Body position on the floor. */
  body = { x: 0.25, z: TABLE.halfLength + 0.6 };
  /** Preferred distance from the table, adjusted with the up/down arrows. */
  homeZ = TABLE.halfLength + 0.6;
  swing = new SwingController();
  rubbers: Record<StrokeSide, Rubber> = { forehand: RUBBERS.inverted, backhand: RUBBERS.inverted };
  assists: AssistSettings = { ...DEFAULT_ASSISTS };
  /** Where the incoming ball is expected to reach the hitting zone (set by the game each frame). */
  intercept: Vec3 | null = null;
  /** Seconds until the ball reaches the intercept (set with `intercept`; Infinity if unknown). */
  interceptEta = Infinity;

  /** Set the incoming ball's intercept (point and time) as of time `now`. */
  setIntercept(ic: { pos: Vec3; t: number } | null, now: number) {
    this.intercept = ic?.pos ?? null;
    this.interceptEta = ic ? ic.t - now : Infinity;
  }
  /** 'serve' while serving: the angle assist then targets own half → opponent's half. */
  shotMode: ShotMode = 'rally';
  private angleAssist;

  /** Playing style (character): handling, stance and default rubbers. */
  style: PlayStyle = STYLES.allround;

  /** Apply a style: swing power, reach, footwork, stance distance and its rubbers. */
  applyStyle(id: StyleId) {
    const st = (this.style = STYLES[id]);
    this.swing.params.swingGain = DEFAULT_SWING.swingGain * st.power;
    this.swing.reachScale = st.reach;
    this.homeZ = TABLE.halfLength + st.distance;
    this.rubbers = { ...st.rubbers };
  }

  /** Apply the realism slider (0 = simulation, 1 = arcade) to this player's assists. */
  applyRealism(arcade: number) {
    const r = realismSettings(arcade);
    this.assists.angle = r.angleAssist;
    this.assists.hitArea = r.hitArea;
    this.assists.footwork = r.footwork;
    this.assists.magnet = r.magnet;
    this.swing.params.powerCap = r.powerCap;
    this.perfectBonus = r.perfectBonus;
    this.swing.params.strokeHold = r.strokeHold;
    this.swing.params.autoFace = r.autoFace;
  }

  constructor(id: string, params: PhysicsParams) {
    this.id = id;
    this.angleAssist = makeAngleAssist(params, () => this.assists.angle, () => this.shotMode, () => this.aimTarget);
    this.swing.reset(FOREHAND_OFFSET, TABLE.height + 0.25, this.restZ, this.body.x);
  }

  /** Extra reach over the table for short balls (leaning in), metres. */
  lean = 0;

  get restZ() {
    return this.body.z - ARM_REACH - this.lean;
  }

  private magnetLocked = false;
  /** The wing the footwork assist is setting up for. */
  private wing: StrokeSide = 'forehand';

  /** Where the cursor puts the bat, world x (before the magnet). */
  get batX() {
    return this.body.x + this.swing.x;
  }

  /** Extra bat speed for a perfectly timed stroke (0 = none; set by the realism slider). */
  perfectBonus = 0;
  /** Whether the last paddle contact was perfectly timed (read on the paddle event). */
  lastContactPerfect = false;

  /** Where this player's shot is aimed (view frame); the contact assist steers toward it. */
  aimTarget: { x: number; z: number } | null = null;

  /** Landing aim from the stroke's direction: swipe up-left → left, up-right → right. */
  aimFor(aim: { x: number; z: number }) {
    if (this.shotMode !== 'rally') return aim;
    const x = aim.x + this.swing.strokeAim * AIM_LIMIT;
    return { x: clamp(x, -AIM_LIMIT, AIM_LIMIT), z: aim.z };
  }

  update(dt: number, input: SwingInput, move: MoveInput, aim: { x: number; z: number }) {
    // The bat is anchored in the world (it goes exactly where you move it); the body follows it.
    const batX = this.batX;

    // Footwork: manual movement plus the assist, which keeps the body a comfortable arm's
    // length beside the bat (forehand: bat to the right; backhand: to the left).
    const foot = this.style.footwork;
    let vx = move.x * MANUAL_SPEED * foot;
    let vz = move.z * MANUAL_SPEED * foot;
    if (move.z !== 0) this.homeZ = clamp(this.homeZ + move.z * MANUAL_SPEED * foot * dt, TABLE.halfLength + 0.2, TABLE.halfLength + 3.5);

    const a = this.assists.footwork;
    if (a > 0) {
      // Which wing to set up for: forced with the keys, else forehand on the right half of
      // the court and backhand on the left (with a little hysteresis around the middle).
      const forced = this.swing.forcedSide;
      if (forced) this.wing = forced;
      else if (batX > 0.08) this.wing = 'forehand';
      else if (batX < -0.08) this.wing = 'backhand';
      const tx = batX - (this.wing === 'forehand' ? FOREHAND_OFFSET : -BACKHAND_OFFSET);
      let tz = this.homeZ;
      if (this.intercept) {
        // Short ball: step in so the paddle plane reaches it. Deep ball (lob): back off.
        if (this.intercept.z < this.homeZ - ARM_REACH) tz = this.intercept.z + ARM_REACH;
        else if (this.intercept.z > this.homeZ - ARM_REACH + 0.05) tz = this.intercept.z + ARM_REACH;
      }
      const pull = (d: number) => clamp(d * 16, -ASSIST_SPEED * foot, ASSIST_SPEED * foot) * a;
      if (move.x === 0 && Math.abs(tx - this.body.x) > 0.05) vx += pull(tx - this.body.x);
      if (move.z === 0) vz += pull(tz - this.body.z);
    }
    this.body.x = clamp(this.body.x + vx * dt, -2.5, 2.5);
    this.body.z = clamp(this.body.z + vz * dt, TABLE.halfLength + 0.15, TABLE.halfLength + 3.6);
    // Keep the bat where it was in the world while the body moves under it.
    this.swing.x = clamp(batX, -BAT_LIMIT, BAT_LIMIT) - this.body.x;

    // Lean over the table when the ball is shorter than the arm can reach from here.
    const needLean = this.intercept ? clamp(this.body.z - ARM_REACH - this.intercept.z, 0, MAX_LEAN) : 0;
    this.lean += (needLean - this.lean) * (1 - Math.exp(-dt / 0.08));

    this.swing.serving = this.shotMode === 'serve';
    this.swing.update(dt, input, this.body, this.restZ, this.aimFor(aim));
    // Read after the swing update, so a flick on the contact frame already counts.
    this.aimTarget = this.shotMode === 'rally' ? this.aimFor(aim) : null;
    const pose = this.swing.pose;

    // Bat magnet: as the ball arrives, a bat held near its path is pulled onto it, so the
    // mouse gesture (the stroke) is what matters, not pixel-perfect placement.
    const ic = this.intercept;
    if (!ic || this.interceptEta >= MAGNET_WINDOW) this.magnetLocked = false;
    if (ic && this.assists.magnet > 0 && this.interceptEta < MAGNET_WINDOW) {
      const dx = ic.x - pose.pos.x;
      const dy = ic.y - pose.pos.y;
      const d = Math.hypot(dx, dy);
      const r = this.assists.magnet;
      // Once the bat is on the ball's path it stays locked for this ball, however far the
      // swipe itself carries the hand.
      if (d <= r) this.magnetLocked = true;
      const near = this.magnetLocked || d <= r ? 1 : Math.max(0, 1 - (d - r) / 0.1);
      const soon = smoothstep(clamp(1 - this.interceptEta / MAGNET_WINDOW, 0, 1));
      const k = near * soon;
      pose.pos.x += dx * k;
      pose.pos.y += dy * k;
      this.swing.visualPos = { ...pose.pos };
    }

    // Keep the paddle above the table surface when reaching over it.
    if (pose.pos.z < TABLE.halfLength + 0.02 && pose.pos.y < TABLE.height + 0.06) {
      if (this.swing.y < TABLE.height + 0.06) this.swing.y = TABLE.height + 0.06;
      pose.pos.y = TABLE.height + 0.06;
      this.swing.visualPos.y = pose.pos.y;
    }
  }

  /** At contact: perfect-timing check (and its bonus), then the contact assist. */
  private contact(ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 | ContactAdjust {
    const perfect = this.shotMode === 'rally' && this.swing.strokePeakAge <= PERFECT_WINDOW;
    this.lastContactPerfect = perfect;
    if (!perfect || this.perfectBonus <= 0) return this.angleAssist(ball, pose, normal, rubber);
    const faster = { ...pose, vel: scale(pose.vel, 1 + this.perfectBonus) };
    return withVel(this.angleAssist(ball, faster, normal, rubber), faster.vel);
  }

  /**
   * Collider for one physics tick. A frame spans `count` ticks; tick `index` covers
   * the fraction [index/count, (index+1)/count] of the paddle's motion this frame.
   */
  collider(index: number, count: number): PaddleCollider {
    const prev = this.swing.prevPose;
    const cur = this.swing.pose;
    const rubber = this.rubbers[this.swing.side];
    return {
      id: this.id,
      front: rubber,
      back: rubber,
      extraRadius: this.assists.hitArea,
      poseAt: (f) => lerpPose(prev, cur, (index + f) / count),
      adjustNormal: (ball, pose, normal, rub) => this.contact(ball, pose, normal, rub),
    };
  }
}

function withVel(r: Vec3 | ContactAdjust, vel: Vec3): ContactAdjust {
  if ('normal' in r) return r.vel ? r : { normal: r.normal, vel };
  return { normal: r, vel };
}

function lerpPose(a: PaddlePose, b: PaddlePose, t: number): PaddlePose {
  return { pos: lerp(a.pos, b.pos, t), normal: normalize(lerp(a.normal, b.normal, t)), vel: b.vel };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const smoothstep = (t: number) => t * t * (3 - 2 * t);
