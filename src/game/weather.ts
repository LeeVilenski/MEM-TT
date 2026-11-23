import type { PhysicsParams, Puddle } from '../physics';
import type { VenueId } from '../render/venues';

/**
 * Weather for the outdoor tables: wind that pushes the ball about, and rain that
 * wets the table and bats and leaves puddles on the top.
 *
 *  - Wind blows from one quarter with a steady part and gusts on top. Its direction
 *    swings a little, and it is fixed to the venue, so when you change ends it is
 *    in your face instead of at your back. The ball weighs 2.7 g: a 3 m/s crosswind
 *    bends a drive 20–30 cm.
 *  - Rain wets the table (it skids: less grip, so backspin checks up less and
 *    topspin kicks less, and the bounce is lower) and your rubber (less spin goes on).
 *  - Puddles: standing water on the table. A ball that lands in one splashes and
 *    skids through low: it is still in, but hard to get under.
 *
 * Everything here is deterministic for a given seed and clock, so the AI and the
 * trajectory preview see the same wind as the ball does.
 */

export type WeatherId = 'calm' | 'breezy' | 'gusty' | 'drizzle' | 'downpour' | 'storm' | 'random';

export interface WeatherPreset {
  name: string;
  /** One line for the settings menu. */
  note: string;
  /** Steady wind speed, m/s. */
  wind: number;
  /** How much a gust adds on top, m/s. */
  gust: number;
  /** Rain intensity (0–1): how heavy it looks and sounds. */
  rain: number;
  /** Table and bat wetness (0–1). */
  wetness: number;
  /** How many puddles stand on the table. */
  puddles: number;
}

export const WEATHER: Record<Exclude<WeatherId, 'random'>, WeatherPreset> = {
  calm: { name: 'Calm', note: 'Still air, dry table', wind: 0, gust: 0, rain: 0, wetness: 0, puddles: 0 },
  breezy: { name: 'Breezy', note: 'A light breeze nudges the ball', wind: 1.2, gust: 1.3, rain: 0, wetness: 0, puddles: 0 },
  gusty: { name: 'Gusty', note: 'Strong gusts bend and hold up the ball', wind: 2.2, gust: 3, rain: 0, wetness: 0, puddles: 0 },
  drizzle: { name: 'Drizzle', note: 'Damp table: less spin, lower bounce', wind: 0.8, gust: 0.8, rain: 0.35, wetness: 0.45, puddles: 2 },
  downpour: { name: 'Downpour', note: 'Soaked: skidding bounces and puddles', wind: 1.2, gust: 1.5, rain: 1, wetness: 0.85, puddles: 4 },
  storm: { name: 'Storm', note: 'Driving rain and big gusts. Good luck', wind: 3, gust: 3.5, rain: 1, wetness: 1, puddles: 5 },
};

export const WEATHER_IDS: WeatherId[] = ['calm', 'breezy', 'gusty', 'drizzle', 'downpour', 'storm', 'random'];

/** The tables that are outside, where weather applies. */
export const OUTDOOR_VENUES: readonly VenueId[] = ['rooftop', 'park', 'beach', 'wonford'];
export const isOutdoor = (v: VenueId) => OUTDOOR_VENUES.includes(v);

export function weatherName(id: WeatherId): string {
  return id === 'random' ? 'Random' : WEATHER[id].name;
}

function seeded(seed: number) {
  let s = Math.max(1, Math.floor(seed) % 2147483647);
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Lay puddles on the table, clear of the net and mostly away from the very edges. */
export function makePuddles(count: number, rand: () => number): Puddle[] {
  const out: Puddle[] = [];
  for (let tries = 0; out.length < count && tries < 200; tries++) {
    const r = 0.07 + rand() * 0.1;
    const x = (rand() * 2 - 1) * (0.7625 - r * 0.6);
    const z = (rand() < 0.5 ? -1 : 1) * (0.2 + r + rand() * (1.37 - 0.2 - r * 1.6));
    if (out.some((p) => Math.hypot(p.x - x, p.z - z) < p.r + r + 0.05)) continue;
    out.push({ x, z, r });
  }
  return out;
}

/** What the HUD shows: wind relative to you, and whether it's raining. */
export interface WeatherReadout {
  name: string;
  /** Wind speed, km/h. */
  kmh: number;
  /** Direction the wind blows towards, in screen terms: 0 = away from you (towards the opponent), +90° = to your right. */
  towardsDeg: number;
  gusting: boolean;
  rain: number;
}

/**
 * The live weather. Call setPreset() for a new match (it rolls the wind's quarter
 * and the puddles), update(t) each frame, and apply() to write it into the physics.
 */
export class WeatherState {
  preset: WeatherPreset = WEATHER.calm;
  id: Exclude<WeatherId, 'random'> = 'calm';
  /** Direction the wind blows towards, radians in the venue frame (0 = −z, towards the far end). */
  private baseDir = 0;
  private phase = [0, 0, 0, 0];
  /** Puddles in the venue's frame (mirrored when the players change ends). */
  puddles: Puddle[] = [];
  /** Current wind in the venue frame, m/s. */
  windX = 0;
  windZ = 0;
  /** How much of the gust is blowing (0–1). */
  gustLevel = 0;

  setPreset(id: WeatherId, seed = Date.now()) {
    const rand = seeded(seed);
    const pick = id === 'random' ? (['breezy', 'gusty', 'drizzle', 'downpour', 'storm'] as const)[Math.floor(rand() * 5)] : id;
    this.id = pick;
    this.preset = WEATHER[pick];
    this.baseDir = rand() * Math.PI * 2;
    this.phase = this.phase.map(() => rand() * 100);
    this.puddles = makePuddles(this.preset.puddles, rand);
    this.update(0);
  }

  /** Advance the wind to clock time t (seconds). Smooth, with a gust every 5–15 s. */
  update(t: number) {
    const p = this.preset;
    if (!p.wind && !p.gust) {
      this.windX = this.windZ = this.gustLevel = 0;
      return;
    }
    const [a, b, c, d] = this.phase;
    // Gusts: incommensurate slow waves, peaky (only the tops count).
    const g = (Math.sin(0.41 * t + a) + Math.sin(0.23 * t + b) * 0.8 + Math.sin(0.97 * t + c) * 0.35) / 2.15;
    this.gustLevel = Math.max(0, (g - 0.2) / 0.8) ** 1.5;
    const speed = p.wind * (0.85 + 0.15 * Math.sin(0.17 * t + d)) + p.gust * this.gustLevel;
    // Direction swings up to ±25°, more in a gust.
    const dir = this.baseDir + (Math.sin(0.11 * t + b) * 0.3 + Math.sin(0.37 * t + c) * 0.12) * (1 + this.gustLevel * 0.5);
    this.windX = Math.sin(dir) * speed;
    this.windZ = -Math.cos(dir) * speed;
  }

  /**
   * Write the weather into the physics. `swapped`: the players have changed ends, so
   * the venue (and with it the wind and the table's puddles) has turned half round.
   * `active` false (indoors, online, drills) gives still air and a dry table.
   */
  apply(params: PhysicsParams, active: boolean, swapped = false) {
    if (!active) {
      params.windX = params.windZ = params.wetness = 0;
      if (params.puddles.length) params.puddles = [];
      return;
    }
    const k = swapped ? -1 : 1;
    params.windX = this.windX * k;
    params.windZ = this.windZ * k;
    params.wetness = this.preset.wetness;
    const want = swapped ? this.mirrored() : this.puddles;
    if (params.puddles !== want) params.puddles = want;
  }

  private mirrorCache: Puddle[] | null = null;
  private mirrorOf: Puddle[] | null = null;
  private mirrored() {
    if (this.mirrorOf !== this.puddles) {
      this.mirrorOf = this.puddles;
      this.mirrorCache = this.puddles.map((p) => ({ x: -p.x, z: -p.z, r: p.r }));
    }
    return this.mirrorCache!;
  }

  readout(swapped = false): WeatherReadout {
    const k = swapped ? -1 : 1;
    const x = this.windX * k;
    const z = this.windZ * k;
    return {
      name: this.preset.name,
      kmh: Math.round(Math.hypot(x, z) * 3.6),
      towardsDeg: (Math.atan2(x, -z) * 180) / Math.PI,
      gusting: this.gustLevel > 0.45,
      rain: this.preset.rain,
    };
  }
}
