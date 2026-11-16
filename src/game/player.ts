import { RUBBERS, TABLE, UP, length, lerp, normalize, scale, type BallState, type ContactAdjust, type PaddleCollider, type PaddlePose, type PhysicsParams, type Rubber, type Vec3 } from '../physics';
import { makeAngleAssist, pitchRotator, rotate, type ShotMode } from './assist';
import { NO_GRADING, gradeContact, type ContactResult, type GradeParams } from './contact';
import { realismSettings } from './realism';
import { STYLES, type PlayStyle, type StyleId } from './styles';
import { DEFAULT_SWING } from './swing';
import { BLADES, batRubbers, defaultBat, withControl, type Bat, type Blade } from './equipment';
import { REACH, SwingController, type StrokeSide, type SwingInput } from './swing';
import type { IncomingPrediction, PathPoint } from './intercept';
import { serveContact, tossEffect, type ServeType } from './serves';
import { landingOutcome } from './assist';
import { faceNormal } from './swing';

/**
 * How smashable a ball is at this contact height above the table (m): 0 (too low to kill,
 * a big risk) to 1 (a sitter). Ramps from 12 cm to 40 cm above the table.
 */
export function smashQuality(heightAboveTable: number): number {
  const t = clamp((heightAboveTable - 0.12) / 0.28, 0, 1);
  return t * t * (3 - 2 * t);
}
/** Paddle speed of a smash (m/s): from a firm hit on a low ball to a full kill on a high one. */
const SMASH_SPEED = { low: 10, high: 15 };
/**
 * Face-angle error of a smash, as a fraction of half the window of angles that land it
 * (standard deviation): small on a sitter, more than the whole window on a low ball.
 */
const SMASH_ERROR = { low: 3, high: 0.35 };

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
/**
 * The serve toss rises and falls just in front of the bat's face (m), so the ball meets the
 * hitting face, not the bat's edge or back (which knocked it back onto your own side).
 */
export const SERVE_TOSS_AHEAD = 0.012;

/** Serving: without a swing the bat is held this far back from the falling ball (m). */
const SERVE_HOLD_BACK = 0.12;
/** Serving: a live swing meets the ball within this (plus the magnet radius) of the bat (m). */
const SERVE_REACH = 0.15;
/** Contact points are kept at least this high: the ball is played at table level, not off the floor. */
const CONTACT_MIN_Y = TABLE.height + 0.04;
/** The bat can reach this far in front of / behind its usual plane to meet the ball (m). */
const DEPTH_IN = 0.35;
const DEPTH_OUT = 0.3;
/** Taking it early: the flick must come at least this long (game s) before the planned contact… */
const EARLY_MIN = 0.05;
/** …the ball must be up off the bounce by this much (m): taken any lower, it's a weak shot… */
const EARLY_MIN_HEIGHT = 0.12;
/** …and the flick must be a real stroke: this fast (m/s, mouse plane), mostly up or down. */
const EARLY_STROKE_SPEED = 3.2;
/** …and the bat must be this close to the ball's line (m, beyond the magnet radius). */
const EARLY_SLACK = 0.05;

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
  /** Playing doubles: serves must go diagonally (set by the game). */
  doubles = false;
  /** The serve to play when serving ('auto': the swing decides). */
  serveType: ServeType = 'auto';
  /** The tossed ball while serving (view frame), until it is struck; set by the game each frame. */
  serveBall: BallState | null = null;

  /**
   * Serve magnet. The bat follows the mouse 1:1, so a hard flick used to carry it past
   * the falling ball (a missed or fumbled serve) unless it went exactly through it. Now,
   * while a swing is live and the ball is dropping above the table within reach, the bat
   * meets it; without a swing the bat holds back, so the ball doesn't just drop onto it.
   */
  private serveMagnet() {
    const b = this.serveBall;
    if (!b) return;
    const pose = this.swing.pose;
    if (length(pose.vel) < 1) {
      pose.pos.z += SERVE_HOLD_BACK;
      return;
    }
    if (b.vel.y >= -0.05 || b.pos.y < TABLE.height + 0.03) return;
    if (Math.hypot(b.pos.x - pose.pos.x, b.pos.y - pose.pos.y) > SERVE_REACH + this.assists.magnet) return;
    pose.pos.x = b.pos.x;
    pose.pos.y = b.pos.y;
    this.swing.visualPos = { ...pose.pos };
  }
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
    this.bat = defaultBat(id);
    this.blade = BLADES.starter;
  }

  /** The bat in hand: its blade and the rubber on each side. Apply after the style. */
  bat: Bat = defaultBat('allround');
  blade: Blade = BLADES.starter;

  applyBat(bat: Bat) {
    this.bat = { ...bat };
    this.blade = BLADES[bat.blade] ?? BLADES.starter;
    this.rubbers = batRubbers(bat);
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
    this.grading = r.grading;
  }

  /** Contact grading windows (set by the realism slider; off until then). */
  grading: GradeParams = NO_GRADING;
  /** The last paddle contact's grade (read on the paddle event), rally shots and serves. */
  lastContact: ContactResult | null = null;
  /** Height of the current serve's toss (m above the hand; set by the game). */
  tossHeight = 0.4;
  /** Multiplier on the angle assist for the contact being made (from its grade). */
  private assistScale = 1;
  /** Recent cursor positions (world x, height; before the magnet), for the sweet-spot check. */
  private path: { t: number; x: number; y: number }[] = [];
  private clock = 0;

  /** Closest the cursor's recent path (since `since`) came to a point (x, y), metres. */
  private pathMiss(x: number, y: number, since: number): number {
    const pts = this.path.filter((p) => p.t >= since);
    const last = this.path[this.path.length - 1];
    if (pts.length === 0) return last ? Math.hypot(last.x - x, last.y - y) : 0;
    let best = Math.hypot(pts[0].x - x, pts[0].y - y);
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1];
      const b = pts[i];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t = len2 > 0 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1) : 0;
      best = Math.min(best, Math.hypot(a.x + dx * t - x, a.y + dy * t - y));
    }
    return best;
  }

  /** Grade a contact with the ball at `ball` (a serve's windows depend on the toss). */
  private grade(ball: Vec3, serve = false): ContactResult {
    const sw = this.swing;
    const age = sw.strokePeakAge;
    let gp = withControl(this.grading, this.blade);
    if (serve) {
      const w = tossEffect(this.tossHeight).window;
      // The serve magnet reaches further than the rally one (SERVE_REACH), so does the sweet spot.
      gp = { ...gp, perfectWindow: gp.perfectWindow * w, goodWindow: gp.goodWindow * w, sweet: gp.sweet + 0.05, edge: gp.edge + SERVE_REACH };
    }
    const live = age <= gp.strokeHold;
    // The swipe's path through the hitting plane: the flick itself plus a moment before it.
    const since = live ? this.clock - (age + sw.flickLength + 0.06) : this.clock;
    return gradeContact({ peakAge: live ? age : Infinity, miss: this.pathMiss(ball.x, ball.y, since), speed: sw.flickSpeed }, gp);
  }

  constructor(
    id: string,
    private params: PhysicsParams,
  ) {
    this.id = id;
    this.angleAssist = makeAngleAssist(params, () => this.assists.angle * this.assistScale, () => this.shotMode, () => this.aimTarget, () => this.doubles);
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

  // ------------------------------------------------------------ where to meet the ball

  private plannedFor: IncomingPrediction | null = null;
  private planned: PathPoint | null = null;
  /** A ball taken early (a flick while it was still rising), overriding the plan. */
  private early: PathPoint | null = null;
  private incoming: IncomingPrediction | null = null;
  private now = 0;

  /**
   * Where (and when) to meet an incoming ball, chosen once per ball:
   *  - at the player's usual depth (their stance), the first point the ball reaches it;
   *  - never below table level: if the ball would drop that low before reaching that
   *    depth (a short ball, or a long low one), at the top of its bounce instead, and the
   *    footwork assist steps in for it;
   *  - a lob above reach is taken on the way down.
   * A flick earlier than that, with the bat on the ball's line, takes it early (see update).
   * Null once the moment has passed.
   */
  contactFor(pred: IncomingPrediction | null, now: number): PathPoint | null {
    this.incoming = pred;
    this.now = now;
    if (pred !== this.plannedFor) {
      this.plannedFor = pred;
      this.early = null;
      this.planned = pred ? this.planContact(pred) : null;
    }
    const p = this.early ?? this.planned;
    return p && p.t >= now ? p : null;
  }

  private planContact(pred: IncomingPrediction): PathPoint | null {
    const maxY = REACH.maxHeight - 0.05;
    const window = pred.playable().filter((p) => p.pos.y <= maxY);
    if (window.length === 0) return null;
    const ok = window.filter((p) => p.pos.y >= CONTACT_MIN_Y);
    // A ball that never comes up to table level (a dead-low chop): its highest point.
    if (ok.length === 0) return window.reduce((a, b) => (b.pos.y > a.pos.y ? b : a));
    const planeZ = this.homeZ - ARM_REACH;
    const atDepth = ok.find((p) => p.pos.z >= planeZ);
    // It drops below the table before reaching the usual depth: meet it at the top of the bounce.
    return atDepth ?? ok.reduce((a, b) => (b.pos.y > a.pos.y ? b : a));
  }

  /** Paddle plane for this frame: the contact point's depth, as far as the arm can reach. */
  private contactZ(): number {
    const rest = this.restZ;
    // Within a few cm of the usual plane, stay on it (the ball is met there as it crosses).
    if (!this.intercept || Math.abs(this.intercept.z - rest) < 0.06) return rest;
    return clamp(this.intercept.z, rest - DEPTH_IN, rest + DEPTH_OUT);
  }

  /**
   * Taking the ball early: a fresh flick while the ball is already up off the bounce,
   * before the planned contact, with the bat on its line, meets it there and then.
   */
  private tryEarly() {
    const pred = this.incoming;
    const plan = this.planned;
    if (!pred || !plan || this.early || this.shotMode !== 'rally') return;
    if (this.swing.strokePeakAge > 0) return; // a flick this very frame
    // A deliberate stroke, not a quick drag to put the bat by the ball (on touch screens a
    // repositioning drag is easily as fast as a swing, and used to take the ball early,
    // straight off the bounce, for a weak return that died short or into the net).
    const g = this.swing.flickVelocity;
    if (Math.hypot(g.x, g.y) < EARLY_STROKE_SPEED || Math.abs(g.y) < 1.5 * Math.abs(g.x)) return;
    const cur = pred.pointAt(this.now + 0.016);
    if (!cur || cur.t <= pred.nearBounceTime || cur.t > plan.t - EARLY_MIN) return;
    if (cur.pos.y < TABLE.height + EARLY_MIN_HEIGHT || cur.pos.y > REACH.maxHeight - 0.05) return;
    // Within reach in depth of where the body is now.
    if (cur.pos.z < this.restZ - DEPTH_IN - 0.05) return;
    const bat = this.swing.pose.pos;
    if (Math.hypot(cur.pos.x - bat.x, cur.pos.y - bat.y) > this.assists.magnet + EARLY_SLACK) return;
    this.early = cur;
    this.magnetLocked = true;
    this.setIntercept(cur, this.now);
  }

  /** Where the cursor puts the bat, world x (before the magnet). */
  get batX() {
    return this.body.x + this.swing.x;
  }

  /** Extra bat speed for a perfectly timed stroke (0 = none; set by the realism slider). */
  perfectBonus = 0;
  /** Smash held this frame. */
  smashHeld = false;
  /** Whether the last contact was a smash (read on the paddle event). */
  lastContactSmash = false;
  /** Random source for smash execution error (replaceable in tests). */
  rng: () => number = Math.random;

  /** Whether the last paddle contact was perfectly timed (read on the paddle event). */
  lastContactPerfect = false;

  /** Where this player's shot is aimed (view frame); the contact assist steers toward it. */
  aimTarget: { x: number; z: number } | null = null;

  /** Landing aim from the stroke's direction: swipe up-left → left, up-right → right. */
  aimFor(aim: { x: number; z: number }) {
    if (this.shotMode !== 'rally' || this.swing.params.swipeMode === 'spin') return aim;
    const x = aim.x + this.swing.strokeAim * AIM_LIMIT;
    return { x: clamp(x, -AIM_LIMIT, AIM_LIMIT), z: aim.z };
  }

  update(dt: number, input: SwingInput, move: MoveInput, aim: { x: number; z: number }) {
    this.smashHeld = !!input.smash;
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
    this.swing.update(dt, input, this.body, this.contactZ(), this.aimFor(aim));
    this.clock += dt;
    this.path.push({ t: this.clock, x: this.body.x + this.swing.x, y: this.swing.y });
    while (this.path.length > 2 && this.path[0].t < this.clock - 0.4) this.path.shift();
    this.tryEarly();
    if (this.shotMode === 'serve') this.serveMagnet();
    // Taken early: the bat goes to the ball's depth now.
    if (this.early) this.swing.pose.pos.z = this.contactZ();
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

  /** At contact: grade the stroke, then the contact assist, then the grade's execution error. */
  private contact(ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 | ContactAdjust {
    const rally = this.shotMode === 'rally';
    const g = this.grade(ball.pos, !rally);
    this.lastContact = g;
    const perfect = g.grade === 'PERFECT';
    this.lastContactPerfect = rally && perfect;
    this.lastContactSmash = false;
    if (rally && this.smashHeld) {
      const smash = this.smashContact(ball, pose, rubber, g.q);
      if (smash) {
        this.lastContactSmash = true;
        return smash;
      }
    }
    if (!rally && this.serveType !== 'auto') {
      // A chosen serve: a poorly struck one gets less help finding a version that lands,
      // keeps less of its spin, and strays a little after; a high toss adds a little spin.
      const power = tossEffect(this.tossHeight).power * g.paceScale;
      const swing = { ...pose, vel: scale(pose.vel, power) };
      const adj = serveContact(this.serveType, ball, swing, rubber, this.params, this.assists.angle * g.assistScale, false, this.doubles);
      if (adj) return this.withError(adj, g.faceError * 0.6);
    }
    // A clean contact keeps the full assist; a poor one is rescued less often, loses pace
    // (mistimed or off-centre), and the face goes a little astray after the assist.
    const pace = g.paceScale * (rally && perfect ? 1 + this.perfectBonus : 1);
    const hit = pace !== 1 ? { ...pose, vel: scale(pose.vel, pace) } : pose;
    this.assistScale = g.assistScale;
    let r: Vec3 | ContactAdjust;
    try {
      r = this.angleAssist(ball, hit, normal, rubber);
    } finally {
      this.assistScale = 1;
    }
    if (g.faceError <= 0 && pace === 1) return r;
    return this.withError(withVel(r, hit.vel), g.faceError);
  }

  /** Execution error on the face (degrees, standard deviation; sideways error is smaller). */
  private withError(adj: ContactAdjust, sd: number): ContactAdjust {
    if (sd <= 0) return adj;
    let n = pitchRotator(adj.normal)?.(this.gauss() * sd) ?? adj.normal;
    n = rotate(n, UP, (this.gauss() * sd * 0.6 * Math.PI) / 180);
    return { normal: normalize(n), vel: adj.vel };
  }

  private gauss() {
    return Math.sqrt(-2 * Math.log(Math.max(1e-9, this.rng()))) * Math.cos(2 * Math.PI * this.rng());
  }

  /**
   * A smash: a flat, fast stroke at the aim point. The face angle is chosen to land it, then
   * an execution error is added that grows as the ball gets lower: a high ball is a near-certain
   * kill, a low one a gamble. Arcade realism (the angle assist) halves the error.
   */
  private smashContact(ball: BallState, pose: PaddlePose, rubber: Rubber, contactQ = 1): ContactAdjust | null {
    const q = smashQuality(ball.pos.y - TABLE.height);
    const full = (SMASH_SPEED.low + (SMASH_SPEED.high - SMASH_SPEED.low) * q) * this.style.power;
    const target = this.aimTarget ?? { x: 0, z: -0.9 };
    const yaw = (Math.atan2(target.x - ball.pos.x, -(target.z - ball.pos.z)) * 180) / Math.PI;
    // A flat hit: the face and the stroke point the same way. Scan that angle for the one
    // that lands nearest the target, then take the middle of the run of angles that land.
    let speed = full;
    let pitch = -4;
    let window = 0;
    // Take pace off only if nothing lands at full speed (a deep or low ball can't be killed flat out).
    for (const f of [1, 0.85, 0.7]) {
      speed = full * f;
      const ok: boolean[] = [];
      const pitches: number[] = [];
      for (let p = -35; p <= 25; p += 0.5) {
        const n = faceNormal(p, yaw);
        const res = landingOutcome(ball, { ...pose, vel: scale(n, speed) }, n, rubber, this.params, 'rally', 1 / 120);
        pitches.push(p);
        ok.push(res.outcome === 'in');
      }
      // The widest run of angles that land; aim at its middle.
      let lo = -1;
      let bestLo = -1;
      let bestHi = -1;
      ok.forEach((v, i) => {
        if (v && lo < 0) lo = i;
        if (lo >= 0 && (!v || i === ok.length - 1)) {
          const hi = v ? i : i - 1;
          if (hi - lo > bestHi - bestLo) ((bestLo = lo), (bestHi = hi));
          lo = -1;
        }
      });
      if (bestLo < 0) continue;
      pitch = (pitches[bestLo] + pitches[bestHi]) / 2;
      window = pitches[bestHi] - pitches[bestLo] + 0.5;
      break;
    }
    // Execution error, relative to how much room there is: on a sitter a small fraction of the
    // window (almost always in), on a low ball more than the whole window (a gamble).
    const frac = SMASH_ERROR.high + (SMASH_ERROR.low - SMASH_ERROR.high) * (1 - q);
    // A poorly struck smash (mistimed, off-centre, over-hit) sprays more.
    const err = Math.max(window, 1.5) * 0.5 * frac * (1 - 0.3 * this.assists.angle) * (1 + 1.5 * this.grading.impact * (1 - contactQ));
    const g = this.gauss();
    const n = faceNormal(pitch + g * err, yaw);
    return { normal: n, vel: scale(faceNormal(pitch, yaw), speed) };
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
