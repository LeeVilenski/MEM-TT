import {
  TABLE,
  UP,
  cloneState,
  cross,
  dot,
  length,
  normalize,
  paddleImpulse,
  predict,
  scale,
  add,
  type BallState,
  type ContactAdjust,
  type PaddlePose,
  type PhysicsParams,
  type Rubber,
  type Vec3,
} from '../physics';

/** Landing margin for "in" (metres from the net and the end line; half that from the sides). */
const MARGIN = 0.1;

/** Rotate v around a unit axis by an angle (Rodrigues). */
export function rotate(v: Vec3, axis: Vec3, rad: number): Vec3 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return add(add(scale(v, c), scale(cross(axis, v), s)), scale(axis, dot(axis, v) * (1 - c)));
}

export type LandingOutcome = 'in' | 'short' | 'long' | 'wide';
/** A rally shot must land on the far half; a serve must bounce on the near half, then the far half. */
export type ShotMode = 'rally' | 'serve';

/**
 * Where a hit with this face normal would land, in the hitter's frame (hitter at +z).
 * 'short' = into the net / own side; 'long' = past the far end.
 */
export function landingOutcome(
  ball: BallState,
  pose: PaddlePose,
  normal: Vec3,
  rubber: Rubber,
  params: PhysicsParams,
  mode: ShotMode = 'rally',
): { outcome: LandingOutcome; pos?: Vec3; first?: Vec3; net?: boolean } {
  const s = cloneState(ball);
  if (paddleImpulse(s, { ...pose, normal }, rubber) <= 0) return { outcome: 'short' };
  let tables = 0;
  let wasAbove = false;
  const { events, path } = predict(s, params, {
    maxTime: 2.5,
    // Same stepping as the live ball, so net-skimmers and edge balls are judged the same way.
    dt: 1 / 240,
    sampleEvery: 1000,
    stop: (e) => e.type === 'floor' || (e.type === 'table' && ++tables >= (mode === 'serve' ? 2 : 1)),
    // Rally: once the ball has risen above the table top and dropped back below it, or is
    // heading back to us, the outcome is settled (it can't land on the far half), so stop.
    // (A ball struck from below the table starts below the top: that doesn't count.)
    until:
      mode === 'rally'
        ? (b) => {
            if (b.pos.y > TABLE.height + 0.01) wasAbove = true;
            return (wasAbove && b.pos.y < TABLE.height - 0.01) || b.vel.z > 0.5;
          }
        : undefined,
  });
  const bounces = events.filter((e) => e.type === 'table');
  const netTouched = events.some((e) => e.type === 'net');
  const floor = events.find((e) => e.type === 'floor');
  const crossedFar = events.some((e) => e.type === 'netCross' && e.direction === 'far');

  if (mode === 'serve') {
    const [first, second] = bounces;
    if (!first) return { outcome: crossedFar ? 'long' : 'short' };
    if (first.pos.z < 0) return { outcome: 'long' }; // didn't bounce on own half first
    if (!second) return { outcome: crossedFar ? 'long' : 'short' };
    if (second.pos.z > 0 || netTouched) return { outcome: 'short', net: netTouched };
    return { outcome: 'in', pos: second.pos, first: first.pos };
  }

  const land = bounces[0] ?? floor;
  if (!land) {
    // Stopped early (below the table top, or coming back): it never reached the far half.
    if (!crossedFar) return { outcome: 'short' };
    const end = path[path.length - 1];
    return { outcome: Math.abs(end.x) > TABLE.halfWidth && end.z > -TABLE.halfLength ? 'wide' : 'long' };
  }
  if (land.type === 'table') {
    if (land.pos.z > 0) return { outcome: 'short' };
    // Safety margin: a net cord or a ball within a few cm of the edge counts as a miss, so
    // the assists aim for shots that land with room to spare.
    if (netTouched || land.pos.z > -MARGIN) return { outcome: 'short' };
    if (land.pos.z < -TABLE.halfLength + MARGIN) return { outcome: 'long' };
    if (Math.abs(land.pos.x) > TABLE.halfWidth - MARGIN / 2) return { outcome: 'wide' };
    return { outcome: 'in', pos: land.pos };
  }
  if (!crossedFar) return { outcome: 'short' };
  return { outcome: Math.abs(land.pos.x) > TABLE.halfWidth && land.pos.z > -TABLE.halfLength ? 'wide' : 'long' };
}

/** Rotate a face normal about its horizontal pitch axis by `deg` (positive or negative). */
export function pitchRotator(normal: Vec3): ((deg: number) => Vec3) | null {
  let axis = cross(normal, UP);
  if (length(axis) < 1e-6) return null;
  axis = normalize(axis);
  return (deg: number) => rotate(normal, axis, (deg * Math.PI) / 180);
}

/**
 * Angle assist. At the moment of contact, find the range of face pitch that would
 * land the ball on the opponent's half, and correct the player's chosen angle into
 * it if the error is within `strength` × 60° (0 = pure simulation, 1 = always lands
 * if any angle can).
 * The player's choice still decides where within that window the ball goes —
 * deep or short, spinny or flat.
 */
export function makeAngleAssist(
  params: PhysicsParams,
  strength: () => number,
  mode: () => ShotMode = () => 'rally',
  aim: () => { x: number; z: number } | null = () => null,
) {
  const STEP = 6;
  const RANGE = 60;
  /** Pace the power assist may take off, or add to a too-gentle swing, at full strength. */
  const MAX_PACE_CUT = 0.6;
  const MAX_PACE_ADD = 0.7;

  /** Where the outcome flips between net/short and long nearest the player's angle (a best guess when no angle clearly lands). */
  let edge: number | null = null;

  /** The landing pitch (degrees from the player's) nearest the player's angle, or null. */
  const solve = (outcomeAt: (deg: number) => LandingOutcome, step = STEP): number | null => {
    edge = null;
    // Coarse scan of the whole pitch range; pick the landing angle nearest the player's.
    const samples: { deg: number; out: LandingOutcome }[] = [];
    for (let d = -RANGE; d <= RANGE; d += step) samples.push({ deg: d, out: outcomeAt(d) });

    let found: number | null = null;
    let best = Infinity;
    for (const smp of samples) if (smp.out === 'in' && Math.abs(smp.deg) < best) ((best = Math.abs(smp.deg)), (found = smp.deg));

    // Landing windows can be narrower than the scan step: bisect short↔long transitions too.
    for (let i = 0; i + 1 < samples.length; i++) {
      const a = samples[i];
      const b = samples[i + 1];
      const flip = (a.out === 'short' && b.out === 'long') || (a.out === 'long' && b.out === 'short');
      if (!flip || Math.min(Math.abs(a.deg), Math.abs(b.deg)) >= best) continue;
      let lo = a.deg;
      let hi = b.deg;
      for (let it = 0; it < 7; it++) {
        const mid = (lo + hi) / 2;
        const out = outcomeAt(mid);
        if (out === 'in') {
          if (Math.abs(mid) < best) ((best = Math.abs(mid)), (found = mid));
          break;
        }
        if (out === a.out) lo = mid;
        else hi = mid;
      }
      const flipAt = (lo + hi) / 2;
      if (edge === null || Math.abs(flipAt) < Math.abs(edge)) edge = flipAt;
    }
    if (found === null) return null;
    // Step into the window, not onto its edge (where a tiny difference misses): toward the
    // middle of the window, at most 4° past the edge.
    const dir = Math.sign(found) || 1;
    let lastIn = found;
    for (let d = 1; d <= 8; d++) {
      if (outcomeAt(found + dir * d) !== 'in') break;
      lastIn = found + dir * d;
    }
    return found + dir * Math.min(4, (lastIn - found) * dir * 0.5);
  };

  /**
   * Steer the landing sideways toward the aim point by turning the face (yaw), keeping
   * only corrections that still land. Strength limits how far the face may be turned.
   */
  const steer = (ball: BallState, pose: PaddlePose, adj: ContactAdjust, rubber: Rubber, k: number): ContactAdjust => {
    const target = aim();
    if (!target || mode() !== 'rally') return adj;
    const vel = adj.vel ?? pose.vel;
    // Turn the whole stroke (face and bat path together) about the vertical.
    const turned = (deg: number): ContactAdjust => {
      const rad = (deg * Math.PI) / 180;
      return { normal: rotate(adj.normal, UP, rad), vel: rotate(vel, UP, rad) };
    };
    const landX = (deg: number): number | null => {
      const t = turned(deg);
      const r = landingOutcome(ball, { ...pose, vel: t.vel! }, t.normal, rubber, params, 'rally');
      return r.outcome === 'in' && r.pos ? r.pos.x : null;
    };
    const x0 = landX(0);
    if (x0 === null || Math.abs(x0 - target.x) < 0.06) return adj;
    const maxYaw = 30 * k;
    let best = { deg: 0, err: Math.abs(x0 - target.x) };
    // Secant search on yaw → landing x.
    let d0 = 0;
    let e0 = x0 - target.x;
    let d1 = e0 > 0 ? -6 : 6;
    for (let it = 0; it < 4; it++) {
      const x1 = landX(d1);
      if (x1 === null) {
        d1 = (d0 + d1) / 2; // that far misses: back off toward the last good angle
        continue;
      }
      const e1 = x1 - target.x;
      if (Math.abs(e1) < best.err) best = { deg: d1, err: Math.abs(e1) };
      if (Math.abs(e1) < 0.05 || Math.abs(e1 - e0) < 1e-4) break;
      const next = d1 - (e1 * (d1 - d0)) / (e1 - e0);
      d0 = d1;
      e0 = e1;
      d1 = Math.max(-maxYaw, Math.min(maxYaw, next));
      if (d1 === d0) break;
    }
    if (best.deg === 0) return adj;
    return turned(best.deg);
  };

  const base = (ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 | ContactAdjust => {
    const k = strength();
    if (k <= 0) return normal;
    const at = pitchRotator(normal);
    if (!at) return normal;
    const m = mode();
    const outcomeWith = (p: PaddlePose) => (deg: number) => landingOutcome(ball, p, at(deg), rubber, params, m).outcome;
    const outcomeAt = outcomeWith(pose);
    if (outcomeAt(0) === 'in') return normal;

    // Strength = how large an angle error gets fully corrected (1 → the whole ±60° range).
    const reach = k * RANGE;
    const target = solve(outcomeAt);
    if (target !== null && Math.abs(target) <= reach) return at(target);

    // Power assist: no face angle lands a swing this hot, so take some pace off (up to
    // MAX_PACE_CUT × strength) — a hard swing becomes a strong shot that lands.
    // A swing too gentle to reach (e.g. a soft backspin serve) gets a little extra pace
    // instead, up to MAX_PACE_ADD × strength.
    const minScale = 1 - MAX_PACE_CUT * k;
    // Serves are gentle by nature: they may get more help than rally shots.
    const maxScale = 1 + MAX_PACE_ADD * k * (m === 'serve' ? 2 : 1);
    // Too weak = falls short on our own side (not caught in the net, where more pace won't help).
    const r0 = landingOutcome(ball, pose, normal, rubber, params, m);
    const tooWeak = r0.outcome === 'short' && !r0.net;
    const scales = (tooWeak ? [1.3, 1.6, 2.0, 2.4, 0.7, 0.4] : [0.7, 0.4, 1.3, 1.6]).filter((f) => f >= minScale - 1e-9 && f <= maxScale + 1e-9);
    let guess: ContactAdjust | null = null;
    for (const f of scales) {
      const slower = { ...pose, vel: scale(pose.vel, f) };
      const out = outcomeWith(slower);
      if (out(0) === 'in') return { normal, vel: scale(pose.vel, f) };
      const t = solve(out, 10);
      if (t !== null && Math.abs(t) <= reach) return { normal: at(t), vel: scale(pose.vel, f) };
      // No clear landing even here: remember the net↔long tipping point as a best guess.
      const e = edge as number | null;
      if (e !== null && Math.abs(e) <= reach) guess = { normal: at(e), vel: scale(pose.vel, f) };
    }
    if (guess) return guess;

    // Beyond that the face is only nudged, so a wild swing still misses.
    if (target === null) return normal;
    return at(Math.sign(target) * reach);
  };

  return (ball: BallState, pose: PaddlePose, normal: Vec3, rubber: Rubber): Vec3 | ContactAdjust => {
    const k = strength();
    const r = base(ball, pose, normal, rubber);
    if (k <= 0) return r;
    const adj = 'normal' in r ? r : { normal: r };
    const out = steer(ball, pose, adj, rubber, k);
    return out.vel ? out : out.normal;
  };
}
