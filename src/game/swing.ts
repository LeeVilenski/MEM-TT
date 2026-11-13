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
 *   - no movement   → a block: the ball rebounds off the still paddle
 */
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
  /** Face angle change while W or S is held, degrees. */
  faceStep: number;
  /** How far the paddle can travel forward during a stroke, metres. */
  maxForwardTravel: number;
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
  /** Time constant of velocity smoothing, seconds. */
  velocitySmoothing: number;
  /**
   * Timing window: a stroke stays effective for this long (s), fading out, so the
   * flick doesn't have to coincide with contact to the frame. Lower = harder.
   */
  strokeHold: number;
  /** Fraction of above-threshold (stroke) mouse movement that moves the paddle. */
  strokeTravel: number;
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
  faceStep: 22,
  maxForwardTravel: 0.15,
  recoverySpeed: 2.5,
  swingThreshold: 1.5,
  serveThreshold: 0.3,
  serveForwardGain: 2.0,
  velocitySmoothing: 0.025,
  strokeHold: 0.12,
  strokeTravel: 0.15,
  maxSpeed: 12,
};

export type StrokeSide = 'forehand' | 'backhand';

export interface SwingInput {
  /** Mouse movement since the last update, pixels (+x right, +y down as on screen). */
  dx: number;
  dy: number;
  drive: boolean;
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
export const REACH = Object.freeze({ lateral: 0.95, minHeight: TABLE.height - 0.35, maxHeight: TABLE.height + 0.95 });

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
 * Exported for tests and for the AI later on.
 */
export function strokeVelocity(mousePlanar: { x: number; y: number }, drive: boolean, hook: -1 | 0 | 1, p: SwingParams, threshold = p.swingThreshold, serving = false): Vec3 {
  const planar = { x: mousePlanar.x * p.swingGain, y: mousePlanar.y * p.swingGain };
  const speed = Math.hypot(planar.x, planar.y);
  const brushScale = drive ? p.driveBrushScale : 1;
  // Forward drive ramps in above the stroke threshold (no jump at the threshold).
  const over = Math.max(0, speed - threshold * p.swingGain);
  const gain = drive ? p.driveForwardGain : serving ? p.serveForwardGain : p.brushForwardGain;
  const forward = gain * Math.min(speed, over * 2);
  // Brushing the back of the ball to +x makes it curve left (and vice versa).
  const hookVel = -hook * p.hookGain * speed;
  return v3(planar.x * brushScale + hookVel, planar.y * brushScale, -forward);
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
  /** null = automatic forehand/backhand from paddle position. */
  forcedSide: StrokeSide | null = null;

  private planarVel = { x: 0, y: 0 };
  private held: Vec3 = v3();
  private heldAge = 0;
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

    // Positioning vs stroking: movement faster than the stroke threshold only moves the
    // paddle partly, so a flick keeps the blade on the ball's line instead of sweeping
    // it past. Lateral position is relative to the body, like an arm.
    const mouseSpeed = Math.hypot(rawVx, rawVy);
    const thr = this.serving ? p.serveThreshold : p.swingThreshold;
    // Full movement up to the stroke threshold, then falling off with the square of the
    // speed (down to strokeTravel): positioning is unaffected, hard flicks barely move it.
    const posScale = mouseSpeed > thr ? Math.max(p.strokeTravel, (thr / mouseSpeed) ** 2) : 1;
    this.x = clamp(this.x + mx * posScale, -REACH.lateral * this.reachScale, REACH.lateral * this.reachScale);
    this.y = clamp(this.y + my * posScale, REACH.minHeight, REACH.maxHeight);

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
    let vel = strokeVelocity(this.planarVel, input.drive, hook, p, this.serving ? p.serveThreshold : p.swingThreshold, this.serving);

    // Stroke memory: the strongest recent stroke stays "live" for strokeHold seconds,
    // fading out, so contact doesn't have to land on the exact frame of the flick.
    this.heldAge += dt;
    const fade = Math.max(0, 1 - this.heldAge / p.strokeHold);
    if (length(vel) >= length(this.held) * fade) {
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
    const targetPitch = this.basePitch + (input.open ? p.faceStep : 0) - (input.close ? p.faceStep : 0);
    this.pitch += (targetPitch - this.pitch) * (dt > 0 ? 1 - Math.exp(-dt / 0.04) : 1);
    // Contact happens at the rest plane (where the intercept marker is); the forward
    // lunge of the stroke is drawn by the renderer only, so it never shifts timing.
    const pos = v3(body.x + this.x, this.y, restZ);
    const yaw = (Math.atan2(aim.x - pos.x, -(aim.z - pos.z)) * 180) / Math.PI + this.yawOffset;
    this.pose = { pos, normal: faceNormal(this.pitch, yaw), vel };
  }

  /** Snap the paddle to a pose without generating a swing (x relative to the body). */
  reset(x: number, y: number, restZ: number, bodyX = 0) {
    this.x = x;
    this.y = y;
    this.forward = 0;
    this.planarVel = { x: 0, y: 0 };
    this.held = v3();
    this.pose = { pos: v3(bodyX + x, y, restZ), normal: v3(0, 0, -1), vel: v3() };
    this.prevPose = this.pose;
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
