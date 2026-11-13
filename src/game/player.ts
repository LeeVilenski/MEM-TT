import { RUBBERS, TABLE, lerp, normalize, type PaddleCollider, type PaddlePose, type PhysicsParams, type Rubber, type Vec3 } from '../physics';
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
}

export const DEFAULT_ASSISTS: AssistSettings = { angle: 0.75, hitArea: 0.035, footwork: 0.7 };

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
/** Below this paddle offset the footwork assist uses the comfortable offsets above. */
const MIN_OFFSET = 0.15;
/** How far a player can lean in over the table. */
const MAX_LEAN = 0.45;

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
    this.swing.params.strokeHold = r.strokeHold;
    this.swing.params.autoFace = r.autoFace;
  }

  constructor(id: string, params: PhysicsParams) {
    this.id = id;
    this.angleAssist = makeAngleAssist(params, () => this.assists.angle, () => this.shotMode);
    this.swing.reset(FOREHAND_OFFSET, TABLE.height + 0.25, this.restZ, this.body.x);
  }

  /** Extra reach over the table for short balls (leaning in), metres. */
  lean = 0;

  get restZ() {
    return this.body.z - ARM_REACH - this.lean;
  }

  update(dt: number, input: SwingInput, move: MoveInput, aim: { x: number; z: number }) {
    // Footwork: manual movement plus assisted pull toward the incoming ball.
    const foot = this.style.footwork;
    let vx = move.x * MANUAL_SPEED * foot;
    let vz = move.z * MANUAL_SPEED * foot;
    if (move.z !== 0) this.homeZ = clamp(this.homeZ + move.z * MANUAL_SPEED * foot * dt, TABLE.halfLength + 0.2, TABLE.halfLength + 3.5);

    const a = this.assists.footwork;
    if (a > 0) {
      let tx = this.body.x;
      let tz = this.homeZ;
      if (this.intercept) {
        // Step so the paddle (held at its current offset from the body) lines up with
        // the ball. Keep at least a comfortable offset so the ball isn't into the body.
        let rel = this.swing.x;
        if (Math.abs(rel) < MIN_OFFSET) rel = rel >= 0 ? FOREHAND_OFFSET : -BACKHAND_OFFSET;
        tx = this.intercept.x - rel;
        // Short ball: step in so the paddle plane reaches it. Deep ball (lob): back off.
        if (this.intercept.z < this.homeZ - ARM_REACH) tz = this.intercept.z + ARM_REACH;
        else if (this.intercept.z > this.homeZ - ARM_REACH + 0.05) tz = this.intercept.z + ARM_REACH;
      }
      const pull = (d: number) => clamp(d * 16, -ASSIST_SPEED * foot, ASSIST_SPEED * foot) * a;
      if (move.x === 0) vx += pull(tx - this.body.x);
      if (move.z === 0) vz += pull(tz - this.body.z);
    }
    this.body.x = clamp(this.body.x + vx * dt, -2.5, 2.5);
    this.body.z = clamp(this.body.z + vz * dt, TABLE.halfLength + 0.15, TABLE.halfLength + 3.6);

    // Lean over the table when the ball is shorter than the arm can reach from here.
    const needLean = this.intercept ? clamp(this.body.z - ARM_REACH - this.intercept.z, 0, MAX_LEAN) : 0;
    this.lean += (needLean - this.lean) * (1 - Math.exp(-dt / 0.08));

    this.swing.serving = this.shotMode === 'serve';
    this.swing.update(dt, input, this.body, this.restZ, aim);

    // Keep the paddle above the table surface when reaching over it.
    const pose = this.swing.pose;
    if (pose.pos.z < TABLE.halfLength + 0.02 && pose.pos.y < TABLE.height + 0.06) {
      this.swing.y = TABLE.height + 0.06;
      pose.pos.y = TABLE.height + 0.06;
    }
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
      adjustNormal: this.angleAssist,
    };
  }
}

function lerpPose(a: PaddlePose, b: PaddlePose, t: number): PaddlePose {
  return { pos: lerp(a.pos, b.pos, t), normal: normalize(lerp(a.normal, b.normal, t)), vel: b.vel };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
