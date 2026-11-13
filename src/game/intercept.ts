import { TABLE, TICK_DT, predict, type BallState, type PhysicsParams, type Vec3 } from '../physics';

export interface PathPoint {
  pos: Vec3;
  t: number;
}

/** Predicted flight of an incoming ball, sampled every physics tick. */
export class IncomingPrediction {
  readonly path: PathPoint[];
  /** Time of the first bounce on the near half (Infinity if it never lands there). */
  readonly nearBounceTime: number;

  constructor(start: BallState, params: PhysicsParams, startTime = 0) {
    const { path, events } = predict(start, params, { maxTime: 3, sampleEvery: 1, stop: (e) => e.type === 'floor' });
    this.path = path.map((pos, i) => ({ pos, t: startTime + i * TICK_DT }));
    const nb = events.find((e) => e.type === 'table' && e.side === 'near');
    this.nearBounceTime = nb ? startTime + nb.time : Infinity;
  }

  /**
   * Where the player should meet the ball after it bounces on the near half:
   *  - normally where it crosses the hitting plane z = planeZ;
   *  - if it is above `maxHeight` there (a lob), the first reachable point beyond the
   *    plane, i.e. the player backs off and takes it on the way down;
   *  - if it would bounce twice first (a short ball), the furthest point it reaches at a
   *    playable height, i.e. the player steps in and reaches over the table.
   * Null once the moment has passed.
   */
  interceptAt(planeZ: number, now: number, maxHeight = Infinity): PathPoint | null {
    if (this.nearBounceTime === Infinity) return null;
    let short: PathPoint | null = null;
    for (const p of this.path) {
      if (p.t <= this.nearBounceTime) continue;
      if (p.pos.y < TABLE.height + 0.022 && p.t > this.nearBounceTime + 0.05) break; // second bounce
      if (p.pos.z >= planeZ && p.pos.y <= maxHeight) return p.t >= now ? p : null;
      if (p.pos.y >= TABLE.height + 0.06 && p.pos.y <= maxHeight && (!short || p.pos.z > short.pos.z)) short = p;
    }
    return short && short.t >= now ? short : null;
  }
}
