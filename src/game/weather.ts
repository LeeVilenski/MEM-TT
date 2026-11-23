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
 *  - Rain soaks the table as you play (and it dries when the rain stops, faster in a
 *    wind). A wet table skids: less grip, so backspin checks up less and topspin
 *    kicks less, and the bounce is lower.
 *  - Puddles: standing water on the table, more of them as the water builds. A ball
 *    that lands in one splashes and skids through low: still in, but hard to get under.
 *  - Rain wets the bats and the ball too, and a puddle soaks the ball. A wet bat or
 *    ball puts less spin on; a soaked ball is a little heavier, so the air moves it
 *    less. The players wipe the bat and the ball between points.
 *
 * Everything here is deterministic for a given seed and clock, so the AI and the
 * trajectory preview see the same wind as the ball does.
 */

export type WeatherId = 'calm' | 'breezy' | 'gusty' | 'drizzle' | 'downpour' | 'storm' | 'random' | 'custom';

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
  /** How wet the table is at the start (0–1); rain soaks it further as you play. */
  wetness: number;
}

export const WEATHER: Record<Exclude<WeatherId, 'random' | 'custom'>, WeatherPreset> = {
  calm: { name: 'Calm', note: 'Still air, dry table', wind: 0, gust: 0, rain: 0, wetness: 0 },
  breezy: { name: 'Breezy', note: 'A light breeze nudges the ball', wind: 1.2, gust: 1.3, rain: 0, wetness: 0 },
  gusty: { name: 'Gusty', note: 'Strong gusts bend and hold up the ball', wind: 2.2, gust: 3, rain: 0, wetness: 0 },
  drizzle: { name: 'Drizzle', note: 'A damp table that slowly gets wetter', wind: 0.8, gust: 0.8, rain: 0.35, wetness: 0.2 },
  downpour: { name: 'Downpour', note: 'Soaks the table as you play: skids and puddles', wind: 1.2, gust: 1.5, rain: 1, wetness: 0.4 },
  storm: { name: 'Storm', note: 'Driving rain and big gusts. Good luck', wind: 3, gust: 3.5, rain: 1, wetness: 0.55 },
};

export const WEATHER_IDS: WeatherId[] = ['calm', 'breezy', 'gusty', 'drizzle', 'downpour', 'storm', 'random', 'custom'];

/** Your own weather, from the sliders. */
export interface CustomWeather {
  /** How hard it rains (0–1): what you see and hear. */
  rain: number;
  /** Steady wind speed, km/h (gusts add up to half again). */
  windKmh: number;
  /** Where the wind blows the ball, degrees: 0 = towards your opponent, 90 = to your right, 180 = back at you. */
  windDir: number;
  /** Water on the table at the start (0–1): how wet it plays, and puddles from about a third. Rain adds to it. */
  water: number;
}

export const DEFAULT_CUSTOM: CustomWeather = { rain: 0.5, windKmh: 10, windDir: 90, water: 0.5 };
export const MAX_WIND_KMH = 30;
/** Most puddles a soaked table (water = 1) gets. */
const MAX_PUDDLES = 6;

/** How many puddles stand on a table this wet: none when merely damp, then up to MAX_PUDDLES. */
export const puddleCount = (water: number) => Math.max(0, Math.min(MAX_PUDDLES, Math.round(((water - 0.25) / 0.75) * MAX_PUDDLES)));

/** Seconds of heavy rain to take a dry table to soaked (lighter rain takes longer). */
export const SOAK_TIME = 240;
/** Seconds for a soaked table to dry in still air once the rain stops (wind speeds it up). */
export const DRY_TIME = 600;

/** Clean up a saved custom weather (anything missing or out of range falls back to the default). */
export function sanitizeCustom(c: Partial<CustomWeather> | null | undefined): CustomWeather {
  const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
  return {
    rain: num(c?.rain, 0, 1, DEFAULT_CUSTOM.rain),
    windKmh: num(c?.windKmh, 0, MAX_WIND_KMH, DEFAULT_CUSTOM.windKmh),
    windDir: ((num(c?.windDir, -360, 720, DEFAULT_CUSTOM.windDir) % 360) + 360) % 360,
    water: num(c?.water, 0, 1, DEFAULT_CUSTOM.water),
  };
}

export function customPreset(c: CustomWeather): WeatherPreset {
  const wind = c.windKmh / 3.6;
  return {
    name: 'Custom',
    note: 'Your own mix',
    wind,
    gust: wind * 0.5,
    rain: c.rain,
    wetness: c.water,
  };
}

/** Wind direction in words, from your end: "towards your opponent", "to your right"… */
export function windDirLabel(deg: number): string {
  const d = ((Math.round(deg) % 360) + 360) % 360;
  const names = ['towards your opponent', 'away and to your right', 'to your right', 'back and to your right', 'back at you', 'back and to your left', 'to your left', 'away and to your left'];
  return names[Math.round(d / 45) % 8];
}

/** The tables that are outside, where weather applies. */
export const OUTDOOR_VENUES: readonly VenueId[] = ['rooftop', 'park', 'beach', 'wonford'];
export const isOutdoor = (v: VenueId) => OUTDOOR_VENUES.includes(v);

export function weatherName(id: WeatherId): string {
  return id === 'random' ? 'Random' : id === 'custom' ? 'Custom' : WEATHER[id].name;
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
  /** Water on the table (0–1). */
  water: number;
}

/**
 * The live weather. Call setPreset() for a new match (it rolls the wind's quarter
 * and the puddles), update(t) each frame, and apply() to write it into the physics.
 */
export class WeatherState {
  preset: WeatherPreset = WEATHER.calm;
  id: Exclude<WeatherId, 'random'> = 'calm';
  /** The custom wind's swing round its direction is smaller: you chose where it blows from. */
  private swing = 1;
  /** Direction the wind blows towards, radians in the venue frame (0 = −z, towards the far end). */
  private baseDir = 0;
  private phase = [0, 0, 0, 0];
  /** Every puddle this table can get, in the order they appear as the water builds (venue frame). */
  private allPuddles: Puddle[] = [];
  private puddleSets = new Map<number, Puddle[]>();
  /** Water on the table (0–1). Rain adds to it; it dries when the rain stops. */
  tableWater = 0;
  /** How wet the bats are (0–1). */
  batWet = 0;
  /** How wet the ball is (0–1). */
  ballWet = 0;

  /** The puddles standing now, in the venue's frame (mirrored when the players change ends). */
  get puddles(): Puddle[] {
    const n = puddleCount(this.tableWater);
    let set = this.puddleSets.get(n);
    if (!set) this.puddleSets.set(n, (set = this.allPuddles.slice(0, n)));
    return set;
  }

  private setPuddles(rand: () => number) {
    this.allPuddles = makePuddles(MAX_PUDDLES, rand);
    this.puddleSets.clear();
  }

  /** Dry the bat and the ball for a fresh start (a new match or weather). */
  private startWet() {
    this.tableWater = this.preset.wetness;
    this.batWet = this.ballWet = 0.5 * this.preset.rain;
  }
  /** Current wind in the venue frame, m/s. */
  windX = 0;
  windZ = 0;
  /** How much of the gust is blowing (0–1). */
  gustLevel = 0;

  setPreset(id: WeatherId, seed = Date.now(), custom: CustomWeather = DEFAULT_CUSTOM) {
    const rand = seeded(seed);
    if (id === 'custom') return this.setCustom(custom, seed);
    const pick = id === 'random' ? (['breezy', 'gusty', 'drizzle', 'downpour', 'storm'] as const)[Math.floor(rand() * 5)] : id;
    this.id = pick;
    this.preset = WEATHER[pick];
    this.swing = 1;
    this.baseDir = rand() * Math.PI * 2;
    this.phase = this.phase.map(() => rand() * 100);
    this.setPuddles(rand);
    this.startWet();
    this.update(0);
  }

  /**
   * Your own weather. The wind blows the way you set it, from the end you start at (it still
   * turns round with the venue when you change ends). The same seed keeps the puddles where
   * they are as you drag the water slider: more water adds puddles, it doesn't move them.
   * Moving a slider sets the table back to the slider's water; the bat and ball keep theirs.
   */
  setCustom(c: CustomWeather, seed = 1, fresh = true) {
    const rand = seeded(seed);
    this.id = 'custom';
    this.preset = customPreset(c);
    this.swing = 0.4;
    this.baseDir = (c.windDir * Math.PI) / 180;
    this.phase = this.phase.map(() => rand() * 100);
    this.setPuddles(rand);
    if (fresh) this.startWet();
    else this.tableWater = c.water;
    this.update(0);
  }

  /**
   * Let the weather work for dt seconds of play: rain soaks the table, or it dries (faster in
   * a wind); the bats and the ball get as wet as the rain (and a wet ball wets the bat), and
   * a ball soaked in a puddle dries off slowly.
   */
  advance(dt: number) {
    const rain = this.preset.rain;
    const wind = Math.hypot(this.windX, this.windZ);
    if (rain > 0) this.tableWater = Math.min(1, this.tableWater + (dt * rain) / SOAK_TIME);
    else this.tableWater = Math.max(0, this.tableWater - (dt * (1 + wind / 3)) / DRY_TIME);
    const ease = (v: number, to: number, tau: number) => v + (to - v) * (1 - Math.exp(-dt / tau));
    const ballTo = 0.8 * rain;
    this.ballWet = ease(this.ballWet, ballTo, this.ballWet > ballTo ? 25 : 5);
    this.batWet = ease(this.batWet, Math.max(0.9 * rain, 0.6 * this.ballWet), 6);
  }

  /** The ball bounced on the table: it picks up water, and a puddle soaks it. */
  onBounce(splash: boolean) {
    this.ballWet = splash ? 1 : Math.max(this.ballWet, 0.6 * this.tableWater);
  }

  /** Between points the players wipe the bat on their shirt and the ball on the towel. */
  newPoint() {
    this.batWet *= 0.4;
    this.ballWet = Math.min(this.ballWet, 0.3 * this.preset.rain);
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
    const dir = this.baseDir + (Math.sin(0.11 * t + b) * 0.3 + Math.sin(0.37 * t + c) * 0.12) * (1 + this.gustLevel * 0.5) * this.swing;
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
      params.windX = params.windZ = params.wetness = params.batWet = params.ballWet = 0;
      if (params.puddles.length) params.puddles = [];
      return;
    }
    const k = swapped ? -1 : 1;
    params.windX = this.windX * k;
    params.windZ = this.windZ * k;
    params.wetness = this.tableWater;
    params.batWet = this.batWet;
    params.ballWet = this.ballWet;
    const want = swapped ? this.mirrored() : this.puddles;
    if (params.puddles !== want) params.puddles = want;
  }

  private mirrors = new WeakMap<Puddle[], Puddle[]>();
  private mirrored() {
    const here = this.puddles;
    let m = this.mirrors.get(here);
    if (!m) this.mirrors.set(here, (m = here.map((p) => ({ x: -p.x, z: -p.z, r: p.r }))));
    return m;
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
      water: this.tableWater,
    };
  }
}
