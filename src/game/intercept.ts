import { TICK_DT, predict, type BallState, type PhysicsParams, type Vec3 } from '../physics';

export interface PathPoint {
  pos: Vec3;
  t: number;
}

/** Predicted flight of an incoming ball, sampled every physics tick. */
export class IncomingPrediction {
  readonly path: PathPoint[];
  /** Time of the first bounce on the near half (Infinity if it never lands there). */
  readonly nearBounceTime: number;
  /** Time of the next bounce after that (the ball must be played before it). */
  readonly secondBounceTime: number;

  constructor(start: BallState, params: PhysicsParams, startTime = 0) {
    const { path, events } = predict(start, params, { maxTime: 3, sampleEvery: 1, stop: (e) => e.type === 'floor' });
    this.path = path.map((pos, i) => ({ pos, t: startTime + i * TICK_DT }));
    const tables = events.filter((e) => e.type === 'table');
    const i = tables.findIndex((e) => e.type === 'table' && e.side === 'near');
    this.nearBounceTime = i >= 0 ? startTime + tables[i].time : Infinity;
    this.secondBounceTime = i >= 0 && tables[i + 1] ? startTime + tables[i + 1].time : Infinity;
  }

  /**
   * Where the player should meet the ball after it bounces on the near half:
   *  - normally where it crosses the hitting plane z = planeZ;
   *  - if it is above `maxHeight` there (a lob), the first reachable point beyond the
   *    plane, i.e. the player backs off and takes it on the way down;
   *  - if it would bounce twice first (a short ball), the top of its bounce, i.e. the
   *    player steps in and reaches over the table.
   * Null once the moment has passed.
   */
  interceptAt(planeZ: number, now: number, maxHeight = Infinity): PathPoint | null {
    if (this.nearBounceTime === Infinity) return null;
    let short: PathPoint | null = null;
    for (const p of this.path) {
      if (p.t <= this.nearBounceTime) continue;
      if (p.t >= this.secondBounceTime - 0.01) break; // must be played before the next bounce
      if (p.pos.z >= planeZ && p.pos.y <= maxHeight) return p.t >= now ? p : null;
      // Short ball: take it at the top of the bounce (the easiest moment for any stroke).
      if (p.pos.y <= maxHeight && (!short || p.pos.y > short.pos.y)) short = p;
    }
    return short && short.t >= now ? short : null;
  }
}
