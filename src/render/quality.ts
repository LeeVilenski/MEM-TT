/**
 * Rendering quality levels and an automatic controller that steps down when frames
 * are slow and back up when there's headroom (with hysteresis so it doesn't flap).
 */
export interface QualityLevel {
  name: string;
  /** Upper limit on the device pixel ratio. */
  maxPixelRatio: number;
  /** Shadow map resolution (the ball's shadow matters for depth, so it stays on). */
  shadowMap: number;
}

export const QUALITY_LEVELS: QualityLevel[] = [
  { name: 'Low', maxPixelRatio: 0.75, shadowMap: 512 },
  { name: 'Medium', maxPixelRatio: 1.25, shadowMap: 1024 },
  { name: 'High', maxPixelRatio: 2, shadowMap: 2048 },
];

export type QualitySetting = 'auto' | 0 | 1 | 2;

export class AutoQuality {
  level: number;
  private avg = 16;
  private slowFor = 0;
  private fastFor = 0;

  /**
   * @param start initial level index
   * @param slowMs frames slower than this (on average) step quality down
   * @param fastMs frames faster than this step it back up
   */
  constructor(
    start = QUALITY_LEVELS.length - 1,
    private slowMs = 24,
    private fastMs = 13,
    private downAfter = 1.5,
    private upAfter = 6,
  ) {
    this.level = start;
  }

  /** Feed one frame's duration (seconds). Returns true when the level changed. */
  sample(dt: number): boolean {
    const ms = Math.min(100, dt * 1000);
    this.avg += (ms - this.avg) * 0.05;
    if (this.avg > this.slowMs) {
      this.slowFor += dt;
      this.fastFor = 0;
    } else if (this.avg < this.fastMs) {
      this.fastFor += dt;
      this.slowFor = 0;
    } else {
      this.slowFor = this.fastFor = 0;
    }
    if (this.slowFor > this.downAfter && this.level > 0) {
      this.level--;
      this.slowFor = 0;
      this.avg = (this.slowMs + this.fastMs) / 2; // give the new level a fair start
      return true;
    }
    if (this.fastFor > this.upAfter && this.level < QUALITY_LEVELS.length - 1) {
      this.level++;
      this.fastFor = 0;
      this.avg = (this.slowMs + this.fastMs) / 2;
      return true;
    }
    return false;
  }

  get fps() {
    return Math.round(1000 / this.avg);
  }
}
