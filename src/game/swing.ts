import { TABLE, length, normalize, scale, v3, type PaddlePose, type Vec3 } from '../physics';

/**
 * Mouse-swing control model. Pure logic (no DOM / Three.js) so it can be unit
 * tested and reused for touch input later.
 *
 * The mouse moves the paddle within a vertical "hitting plane" in front of the
 * player. Moving the mouse fast is a stroke: the paddle also drives forward
 * through the ball in proportion to swing speed. So:
 *   - swing up       → brush up + forward      → topspin (loop)
 *   - swing down     → brush down + forward    → backspin (push / chop)
 *   - swing sideways → brush across + forward  → sidespin
 *   - hold left button ("drive") → more forward, less brush → pace (drive / smash)
 *   - W/S close/open the face, A/D add a hooking sidespin brush
 *   - an up/down stroke angled sideways also brushes across the ball (sidespin), as well as aiming
 *   - no movement   → a block: the ball rebounds off the still paddle
 */
export type SwipeMode = 'curve' | 'real' | 'aim' | 'spin';

export interface SwingParams {
  /** Metres of paddle travel per pixel of mouse movement. */
  sensitivity: number;
  /**
   * Stroke speed per unit of mouse speed. Real loops are swung at 15–20 m/s at the
   * blade, faster than anyone moves a mouse, so swings are amplified.
   */
  swingGain: number;
  /** Forward drive per m/s of planar swing speed, brushing. */
  brushForwardGain: number;
  /** Forward drive per m/s of planar swing speed, with the drive button held. */
  driveForwardGain: number;
  /** In drive mode, the planar (brush) component is scaled down by this factor. */
  driveBrushScale: number;
  /** Lateral brush added by A/D, per m/s of swing speed. */
  hookGain: number;
  /**
   * Rally strokes: how much of a hook a sideways-angled stroke brushes, at full angle (~40° off
   * vertical), as a fraction of holding A/D; which way it curves is set by swipeMode.
   */
  swipeHook: number;
  /**
   * What a rally stroke's sideways angle does (Settings → Gameplay → Swipe angle):
   *  - 'curve' (default): aims, and curves the ball toward the aim (sidespin that bends it in);
   *  - 'real': aims, and brushes the way the bat travels, so the ball curves away from the aim;
   *  - 'aim': aims only (sidespin from the hook keys/buttons);
   *  - 'spin': sidespin only, brushed the way the bat travels; no aim.
   */
  swipeMode: SwipeMode;
  /** Face angle change while W or S is held, degrees. */
  faceStep: number;
  /** How far the paddle can travel forward during a stroke, metres. */
  maxForwardTravel: number;
  /** Soft cap on gesture speed (m/s, mouse plane); 0 = no cap. Set by the realism slider. */
  powerCap: number;
  /** Rally strokes: fraction of sideways mouse speed that counts toward the stroke. */
  lateralStroke: number;
  /** How fast the paddle returns to the ready position after a stroke, m/s. */
  recoverySpeed: number;
  /**
   * Mouse-plane speed (m/s, before gain) that counts as a stroke. Slower movement is
   * just positioning the paddle and must not push it forward.
   */
  swingThreshold: number;
  /** Stroke threshold while serving: serves are gentle strokes, and nothing can be hit by accident. */
  serveThreshold: number;
  /** Forward drive per m/s of swing while serving: a serve is mostly a forward brush. */
  serveForwardGain: number;
  /**
   * Downward rally strokes (push/chop): base forward speed of a gentle push, extra
   * forward per m/s of stroke, and how much of the downward motion is kept.
   */
  pushBaseForward: number;
  chopForwardGain: number;
  chopDownScale: number;
  /** Auto face-angle assist strength (0–1), and how far it opens/closes the face, degrees. */
  autoFace: number;
  autoFaceOpen: number;
  autoFaceClose: number;
  /** Time constant of velocity smoothing, seconds. */
  velocitySmoothing: number;
  /**
   * Timing window: a stroke stays effective for this long (s), fading out, so the
   * flick doesn't have to coincide with contact to the frame. Lower = harder.
   */
  strokeHold: number;
  /** Max mouse-plane speed before gain, m/s. */
  maxSpeed: number;
}

export const DEFAULT_SWING: SwingParams = {
  sensitivity: 0.0016,
  swingGain: 1.4,
  brushForwardGain: 1.25,
  driveForwardGain: 2.4,
  driveBrushScale: 0.5,
  hookGain: 1.0,
  swipeHook: 0.8,
  swipeMode: 'curve',
  faceStep: 22,
  maxForwardTravel: 0.3,
  lateralStroke: 0.3,
  powerCap: 0,
  recoverySpeed: 2.5,
  swingThreshold: 1.5,
  serveThreshold: 0.3,
  serveForwardGain: 2.0,
  autoFace: 0,
  autoFaceOpen: 40,
  autoFaceClose: 15,
  pushBaseForward: 3.2,
  chopForwardGain: 0.6,
  chopDownScale: 0.45,
  velocitySmoothing: 0.025,
  strokeHold: 0.12,
  maxSpeed: 12,
};

export type StrokeSide = 'forehand' | 'backhand';

export interface SwingInput {
  /** Mouse movement since the last update, pixels (+x right, +y down as on screen). */
  dx: number;
  dy: number;
  drive: boolean;
  /** Smash held (right mouse button / Smash button): a flat kill shot at contact. */
  smash?: boolean;
  /** W held: close the face. */
  close: boolean;
  /** S held: open the face. */
  open: boolean;
  /** A held: brush for a ball that curves left; D: curves right. */
  hookLeft: boolean;
  hookRight: boolean;
}

export const NO_INPUT: SwingInput = { dx: 0, dy: 0, drive: false, close: false, open: false, hookLeft: false, hookRight: false };

/** Reach limits relative to the player's body. */
export const REACH = Object.freeze({ lateral: 1.5, minHeight: TABLE.height - 0.35, maxHeight: TABLE.height + 0.95 });

/**
 * Face normal for a pitch (positive = open, tilted up) and yaw (positive = aimed toward +x),
 * facing the far end (−z).
 */
export function faceNormal(pitchDeg: number, yawDeg: number): Vec3 {
  const p = (pitchDeg * Math.PI) / 180;
  const y = (yawDeg * Math.PI) / 180;
  return normalize(v3(Math.sin(y) * Math.cos(p), Math.sin(p), -Math.cos(y) * Math.cos(p)));
}

/**
 * Paddle velocity for a planar swing velocity (in the hitting plane, m/s).
 * `hook` is −1 … 1: −1 brushes for a ball that curves left (A), 1 right (D).
 * Exported for tests and for the AI later on.
 */
export function strokeVelocity(mousePlanar: { x: number; y: number }, drive: boolean, hook: number, p: SwingParams, threshold = p.swingThreshold, serving = false): Vec3 {
  const planar = { x: mousePlanar.x * p.swingGain, y: mousePlanar.y * p.swingGain };
  const speed = Math.hypot(planar.x, planar.y);
  const brushScale = drive ? p.driveBrushScale : 1;
  // Forward drive ramps in above the stroke threshold (no jump at the threshold).
  const over = Math.max(0, speed - threshold * p.swingGain);
  // A downward rally stroke is a push/chop: mostly forward, with a little downward
  // brush (the open face turns it into backspin). Upward strokes (loops) keep their
  // steep up-and-forward path. Serves have their own calibration.
  const chop = !serving && !drive && planar.y < -0.3 * p.swingGain && planar.y < -Math.abs(planar.x);
  if (chop) {
    // Even a gentle downward movement as the ball arrives is a push: it always carries
    // a solid forward component; harder downward strokes become chops.
    const hookVel = -hook * p.hookGain * speed;
    return v3(planar.x + hookVel, planar.y * p.chopDownScale, -(p.pushBaseForward + p.chopForwardGain * speed));
  }
  const gain = drive ? p.driveForwardGain : serving ? p.serveForwardGain : p.brushForwardGain;
  const forward = gain * Math.min(speed, over * 2);
  const vy = planar.y * brushScale;
  // Brushing the back of the ball to +x makes it curve left (and vice versa).
  const hookVel = -hook * p.hookGain * speed;
  return v3(planar.x * brushScale + hookVel, vy, -forward);
}

export class SwingController {
  /** Paddle face centre in the hitting plane: x relative to the body (+ = right), y is world height. */
  x = 0.3;
  y = TABLE.height + 0.25;
  /** Forward lunge of the current stroke, metres (visual only). */
  forward = 0;
  /** Persistent face pitch set with the mouse wheel, degrees (+ open). */
  basePitch = 0;
  /** Extra yaw on top of the automatic aim, degrees. */
  yawOffset = 0;
  side: StrokeSide = 'forehand';
  /** Serving: gentle strokes count (lower stroke threshold). */
  serving = false;
  /** Player-style multiplier on lateral reach. */
  reachScale = 1;
  /** Current auto-face contribution, degrees (for the HUD). */
  autoPitch = 0;
  /** Where the paddle is drawn (the player's bat magnet may move it onto the ball). */
  visualPos: Vec3 = v3();
  /** null = automatic forehand/backhand from paddle position. */
  forcedSide: StrokeSide | null = null;

  private planarVel = { x: 0, y: 0 };
  private held: Vec3 = v3();
  private heldAge = 0;
  /** Mouse-plane velocity of the stroke in memory (for its direction). */
  private heldGesture = { x: 0, y: 0 };
  /** Its strength as a stroke (as `rawGesture` measures it). */
  private heldStrength = 0;
  /** Seconds since the last frame of flick movement. */
  private flickAge = Infinity;
  /** How long the current flick has been going, seconds. */
  private flickLen = 0;
  /** Peak speed of the current flick (m/s, mouse plane, lateral discounted in rallies). */
  private flickPeak = 0;

  /** How long the live flick has been going (s). */
  get flickLength(): number {
    return this.flickLen;
  }

  /** Peak speed of the live flick (m/s, mouse plane; sideways discounted in rallies), 0 if none. */
  get flickSpeed(): number {
    return this.flickAge > this.params.strokeHold ? 0 : this.flickPeak;
  }

  /** Seconds since the last flick movement (Infinity if no flick is live). */
  /** The live flick's mouse-plane velocity (m/s, before gain; +y up), for telling strokes from drags. */
  get flickVelocity(): { x: number; y: number } {
    return { ...this.heldGesture };
  }

  get strokePeakAge(): number {
    if (this.heldGesture.x === 0 && this.heldGesture.y === 0) return Infinity;
    return this.flickAge;
  }

  /**
   * Sideways aim from the stroke's direction, −1 (left) … 1 (right): a stroke angled ~40°
   * off vertical is full aim. 0 when no stroke is live.
   */
  get strokeAim(): number {
    if (this.flickAge > this.params.strokeHold) return 0;
    const g = this.heldGesture;
    const ratio = g.x / Math.max(Math.abs(g.y), 0.5);
    return Math.max(-1, Math.min(1, ratio / 0.85));
  }
  private pitch = 0;
  pose: PaddlePose = { pos: v3(), normal: v3(0, 0, -1), vel: v3() };
  /** Pose at the previous update, for sweeping collisions between frames. */
  prevPose: PaddlePose = { pos: v3(), normal: v3(0, 0, -1), vel: v3() };

  constructor(public params: SwingParams = { ...DEFAULT_SWING }) {}

  get pitchDeg() {
    return this.pitch;
  }

  /**
   * Advance by `dt` real seconds. Velocities are measured in real time so a swing
   * feels the same in slow motion.
   * @param body player's body position (x, z) — reach is limited around it
   * @param restZ paddle plane when not swinging
   * @param aim point on the far half the face auto-aims at (yaw assist)
   */
  update(dt: number, input: SwingInput, body: { x: number; z: number }, restZ: number, aim: { x: number; z: number }) {
    const p = this.params;
    this.prevPose = { pos: { ...this.pose.pos }, normal: { ...this.pose.normal }, vel: { ...this.pose.vel } };

    // Mouse movement in metres of the hitting plane (+y up).
    const mx = input.dx * p.sensitivity;
    const my = -input.dy * p.sensitivity;
    const rawVx = dt > 0 ? mx / dt : 0;
    const rawVy = dt > 0 ? my / dt : 0;

    // The bat follows the mouse 1:1. (x is stored relative to the body, but the player
    // moves it back as the body moves, so on screen it stays exactly where you put it.)
    this.x = clamp(this.x + mx, -REACH.lateral * this.reachScale, REACH.lateral * this.reachScale);
    this.y = clamp(this.y + my, REACH.minHeight, REACH.maxHeight);


    // Smooth the bursty mouse velocity (exponential moving average).
    const k = dt > 0 ? 1 - Math.exp(-dt / p.velocitySmoothing) : 1;
    this.planarVel.x += (rawVx - this.planarVel.x) * k;
    this.planarVel.y += (rawVy - this.planarVel.y) * k;
    const sp = Math.hypot(this.planarVel.x, this.planarVel.y);
    if (sp > p.maxSpeed) {
      this.planarVel.x *= p.maxSpeed / sp;
      this.planarVel.y *= p.maxSpeed / sp;
    }

    const hook = input.hookLeft === input.hookRight ? 0 : input.hookLeft ? -1 : 1;
    // Rally strokes are up/down gestures: sideways mouse speed (moving the bat across to
    // the ball) only counts a little, so chasing a wide ball isn't read as a stroke.
    let gesture = this.serving ? this.planarVel : { x: this.planarVel.x * p.lateralStroke, y: this.planarVel.y };
    // Soft power cap (assist): a hard swipe gives a strong shot that can still land, rather
    // than one so fast no face angle keeps it on the table. Near-linear for gentle strokes.
    const gs = Math.hypot(gesture.x, gesture.y);
    if (p.powerCap > 0 && gs > 0) {
      const f = (p.powerCap * Math.tanh(gs / p.powerCap)) / gs;
      gesture = { x: gesture.x * f, y: gesture.y * f };
    }
    // The flick itself, from this frame's raw movement (not the smoothed velocity): its
    // direction aims, and the time since it ended times the stroke ("perfect" timing).
    // Sliding across to reach the ball, or slow positioning before a block, isn't a flick.
    const thrNow = this.serving ? p.serveThreshold : p.swingThreshold;
    const rawGesture = this.serving ? Math.hypot(rawVx, rawVy) : Math.hypot(rawVx * p.lateralStroke, rawVy);
    if (rawGesture > thrNow) {
      // A new flick (not a continuation of one still going a frame or two ago).
      const fresh = this.flickAge > Math.max(0.05, 2.5 * dt);
      if (fresh) ((this.flickLen = 0), (this.flickPeak = 0));
      else this.flickLen += this.flickAge + dt;
      this.flickPeak = Math.max(this.flickPeak, rawGesture);
      // The stroke's direction: the strongest recent flick, but a fresh one the other way up/down
      // (a flick up after a quick drag down to the ball) replaces it, as for the bat speed below.
      const flipped = Math.abs(rawVy) > thrNow && Math.sign(rawVy) !== Math.sign(this.heldGesture.y);
      // Strength as a stroke (sideways discounted in rallies), so a fast drag across to the ball
      // doesn't outrank the flick that follows it.
      if (this.flickAge > p.strokeHold || flipped || rawGesture >= this.heldStrength) {
        this.heldGesture = { x: rawVx, y: rawVy };
        this.heldStrength = rawGesture;
      }
      this.flickAge = 0;
    } else this.flickAge += dt;

    // A rally stroke angled sideways brushes across the ball too: sidespin as well as aim
    // (swipeMode). 'real': brushing to the right makes the ball curve left, so a swipe up-right
    // hooks like A, away from the aim. 'curve' flips it, so the ball bends in toward the aim.
    // (Serves read the swipe's side themselves.)
    const brush = p.swipeMode === 'aim' ? 0 : p.swipeMode === 'curve' ? 1 : -1;
    const swipe = this.serving ? 0 : brush * this.strokeAim * p.swipeHook;
    const totalHook = clamp(hook + swipe, -1, 1);
    let vel = strokeVelocity(gesture, input.drive, totalHook, p, this.serving ? p.serveThreshold : p.swingThreshold, this.serving);

    // Stroke memory: the strongest recent stroke stays "live" for strokeHold seconds,
    // fading out, so contact doesn't have to land on the exact frame of the flick.
    this.heldAge += dt;
    const fade = Math.max(0, 1 - this.heldAge / p.strokeHold);
    // A fresh stroke the other way up/down (a flick up after a quick downward drag to put
    // the bat by the ball) replaces the held one even if it's slower: the latest
    // deliberate stroke wins, not the biggest recent movement.
    const reversed = length(vel) > 1 && Math.abs(this.held.y) > 0.3 && Math.sign(vel.y) !== Math.sign(this.held.y) && Math.abs(vel.y) > 0.3;
    if (length(vel) >= length(this.held) * fade || reversed) {
      this.held = vel;
      this.heldAge = 0;
    } else {
      vel = scale(this.held, fade);
    }

    // Forward travel: driven by the stroke, recovering when the swing stops.
    if (vel.z < 0) this.forward = Math.min(p.maxForwardTravel, this.forward - vel.z * dt);
    else this.forward = Math.max(0, this.forward - p.recoverySpeed * dt);

    // Forehand / backhand: by position relative to the body unless forced.
    this.side = this.forcedSide ?? (this.x >= 0 ? 'forehand' : 'backhand');

    // Face orientation: auto-aim yaw toward the target, plus W/S pitch.
    // Auto face angle (assist): open the face on a downward stroke (push/chop), close it a
    // little on an upward one (loop) — what real players do, so "flick down = backspin".
    let auto = 0;
    const vs = length(vel);
    if (p.autoFace > 0 && vs > 0.5) {
      const firm = Math.min(1, vs / 3);
      if (vel.y < -0.1) auto = p.autoFace * p.autoFaceOpen * firm;
      else if (vel.y > 0.5) auto = -p.autoFace * p.autoFaceClose * firm;
    }
    this.autoPitch = auto;
    const targetPitch = this.basePitch + auto + (input.open ? p.faceStep : 0) - (input.close ? p.faceStep : 0);
    this.pitch += (targetPitch - this.pitch) * (dt > 0 ? 1 - Math.exp(-dt / 0.025) : 1);
    // Contact happens at the rest plane (where the intercept marker is); the forward
    // lunge of the stroke is drawn by the renderer only, so it never shifts timing.
    const pos = v3(body.x + this.x, this.y, restZ);
    const yaw = (Math.atan2(aim.x - pos.x, -(aim.z - pos.z)) * 180) / Math.PI + this.yawOffset;
    this.pose = { pos, normal: faceNormal(this.pitch, yaw), vel };
    this.visualPos = { ...pos };
  }

  /** Snap the paddle to a pose without generating a swing (x relative to the body). */
  reset(x: number, y: number, restZ: number, bodyX = 0) {
    this.x = x;
    this.y = y;
    this.forward = 0;
    this.planarVel = { x: 0, y: 0 };
    this.held = v3();
    this.heldGesture = { x: 0, y: 0 };
    this.heldStrength = 0;
    this.flickAge = Infinity;
    this.flickLen = 0;
    this.flickPeak = 0;
    this.pose = { pos: v3(bodyX + x, y, restZ), normal: v3(0, 0, -1), vel: v3() };
    this.visualPos = { ...this.pose.pos };
    this.prevPose = this.pose;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
