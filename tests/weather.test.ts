import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, RUBBERS, TABLE, paddleImpulse, predict, v3, wetRubber, type BallEvent, type BallState, type PhysicsParams } from '../src/physics';
import { WEATHER, WeatherState, customPreset, makePuddles, sanitizeCustom, windDirLabel } from '../src/game/weather';
import { mapParams } from '../src/game/frame';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Match } from '../src/game/match';
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;
/** A drive from the far end towards the near end (+z). */
const drive = (): BallState => ({ pos: v3(0, TABLE.height + 0.25, -TABLE.halfLength - 0.2), vel: v3(0, 1.2, 8), spin: v3() });

function firstTable(start: BallState, params: PhysicsParams) {
  const { events } = predict(start, params, { stop: (e) => e.type === 'table' || e.type === 'floor' });
  const e = events.find((x) => x.type === 'table' || x.type === 'floor');
  if (!e) throw new Error('no landing');
  return e;
}

/** Drop a ball onto the table at (x, z) with this forward speed and spin; the bounce event. */
function bounce(params: PhysicsParams, x = 0, z = 0.6, spinX = 0): Extract<BallEvent, { type: 'table' }> {
  const sim = new BallSim({ pos: v3(x, TABLE.height + 0.15, z), vel: v3(0, -3, 4), spin: v3(spinX, 0, 0) }, params);
  const events: BallEvent[] = [];
  for (let i = 0; i < 240 && !events.some((e) => e.type === 'table'); i++) sim.step(1 / 240, events);
  return events.find((e) => e.type === 'table') as Extract<BallEvent, { type: 'table' }>;
}

describe('wind', () => {
  it('a crosswind drifts the ball the way it blows', () => {
    const still = firstTable(drive(), P).pos.x;
    const right = firstTable(drive(), { ...P, windX: 3 }).pos.x;
    const left = firstTable(drive(), { ...P, windX: -3 }).pos.x;
    expect(still).toBeCloseTo(0, 5);
    expect(right).toBeGreaterThan(0.05);
    expect(left).toBeLessThan(-0.05);
    expect(right).toBeCloseTo(-left, 3);
  });

  it('a headwind holds the ball up short, a tailwind carries it long', () => {
    const still = firstTable(drive(), P).pos.z;
    const head = firstTable(drive(), { ...P, windZ: -3 }).pos.z;
    const tail = firstTable(drive(), { ...P, windZ: 3 }).pos.z;
    expect(head).toBeLessThan(still - 0.05);
    expect(tail).toBeGreaterThan(still + 0.05);
  });

  it("doesn't blow a service toss off the bat (it's sheltered until it gets going)", () => {
    const sim = new BallSim({ pos: v3(0, 1, 1.6), vel: v3(0, 3, 0), spin: v3() }, { ...P, windX: 5, windZ: 3 });
    for (let i = 0; i < 120; i++) sim.step(1 / 240);
    expect(sim.state.pos.x).toBe(0);
    expect(sim.state.pos.z).toBe(1.6);
  });
});

describe('rain', () => {
  it('a wet table skids: backspin checks the ball up less, and the bounce is lower', () => {
    // Spin about −x on a ball moving +z is backspin (the bottom of the ball moves forward).
    const dry = bounce(P, 0, 0.6, -400);
    const wet = bounce({ ...P, wetness: 1 }, 0, 0.6, -400);
    expect(wet.velOut.z).toBeGreaterThan(dry.velOut.z + 0.1);
    expect(wet.velOut.y).toBeLessThan(dry.velOut.y);
    expect(wet.splash).toBeUndefined();
    // ...and topspin kicks on less.
    expect(bounce({ ...P, wetness: 1 }, 0, 0.6, 400).velOut.z).toBeLessThan(bounce(P, 0, 0.6, 400).velOut.z - 0.1);
  });

  it('a puddle splashes and kills the bounce', () => {
    const landsAt = bounce(P, 0, 0.6).pos.z;
    const params = { ...P, wetness: 0.5, puddles: [{ x: 0, z: landsAt, r: 0.12 }] };
    const inPuddle = bounce(params, 0, 0.6);
    const beside = bounce(params, 0.5, 0.6);
    expect(inPuddle.splash).toBe(true);
    expect(beside.splash).toBeUndefined();
    expect(inPuddle.velOut.y).toBeLessThan(beside.velOut.y * 0.8);
  });

  it('a wet rubber puts less spin on', () => {
    const hit = (params: PhysicsParams) => {
      const s: BallState = { pos: v3(0, 1, 1.5), vel: v3(0, -1, 4), spin: v3() };
      paddleImpulse(s, { pos: v3(0, 1, 1.52), normal: v3(0, 0.5, -0.866), vel: v3(0, 6, -3) }, wetRubber(RUBBERS.inverted, params));
      return Math.abs(s.spin.x);
    };
    expect(hit({ ...P, wetness: 1 })).toBeLessThan(hit(P) * 0.95);
    expect(wetRubber(RUBBERS.inverted, P)).toBe(RUBBERS.inverted);
  });
});

describe('weather state', () => {
  it('calm is still air and a dry table', () => {
    const w = new WeatherState();
    w.setPreset('calm', 5);
    w.update(12.3);
    const params = { ...P };
    w.apply(params, true);
    expect([params.windX, params.windZ, params.wetness, params.puddles.length]).toEqual([0, 0, 0, 0]);
  });

  it('is repeatable for a seed, gusts above the steady wind, and stays within the preset', () => {
    const a = new WeatherState();
    const b = new WeatherState();
    a.setPreset('gusty', 42);
    b.setPreset('gusty', 42);
    let max = 0;
    let min = Infinity;
    for (let t = 0; t < 120; t += 0.25) {
      a.update(t);
      b.update(t);
      expect(a.windX).toBe(b.windX);
      const s = Math.hypot(a.windX, a.windZ);
      max = Math.max(max, s);
      min = Math.min(min, s);
    }
    const g = WEATHER.gusty;
    expect(max).toBeGreaterThan(g.wind * 1.4);
    expect(max).toBeLessThanOrEqual(g.wind + g.gust + 1e-9);
    expect(min).toBeGreaterThanOrEqual(g.wind * 0.7 - 1e-9);
  });

  it('changing ends turns the wind and the puddles round with the venue', () => {
    const w = new WeatherState();
    w.setPreset('storm', 7);
    w.update(3);
    const here = { ...P };
    const there = { ...P };
    w.apply(here, true, false);
    w.apply(there, true, true);
    expect(there.windX).toBeCloseTo(-here.windX);
    expect(there.windZ).toBeCloseTo(-here.windZ);
    expect(there.puddles.map((p) => [p.x, p.z])).toEqual(here.puddles.map((p) => [-p.x + 0, -p.z + 0]));
    expect(w.readout(true).towardsDeg).toBeCloseTo(((w.readout(false).towardsDeg + 360) % 360) - 180, 5);
  });

  it('inactive (indoors, online, drills) restores still air and a dry table', () => {
    const w = new WeatherState();
    w.setPreset('downpour', 3);
    const params = { ...P };
    w.apply(params, true);
    expect(params.wetness).toBeGreaterThan(0);
    w.apply(params, false);
    expect([params.windX, params.windZ, params.wetness, params.puddles.length]).toEqual([0, 0, 0, 0]);
  });

  it('puddles lie on the table, clear of the net and of each other', () => {
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let n = 0; n < 50; n++) {
      const ps = makePuddles(5, rand);
      expect(ps.length).toBe(5);
      for (const p of ps) {
        expect(Math.abs(p.x)).toBeLessThan(TABLE.halfWidth);
        expect(Math.abs(p.z)).toBeLessThan(TABLE.halfLength);
        expect(Math.abs(p.z) - p.r).toBeGreaterThan(0.15);
        for (const q of ps) if (q !== p) expect(Math.hypot(p.x - q.x, p.z - q.z)).toBeGreaterThan(p.r + q.r);
      }
    }
  });
});

describe('playing in the weather', () => {
  it('the far end feels the wind (and sees the puddles) turned half round', () => {
    const params = { ...P, windX: 2, windZ: -1, puddles: [{ x: 0.3, z: 0.8, r: 0.1 }] };
    expect(mapParams('near', params)).toBe(params);
    expect(mapParams('far', P)).toBe(P);
    const far = mapParams('far', params);
    expect([far.windX, far.windZ]).toEqual([-2, 1]);
    expect(far.puddles).toEqual([{ x: -0.3, z: -0.8, r: 0.1 }]);
  });

  it('the AI still rallies in a storm', () => {
    const params = { ...P };
    const w = new WeatherState();
    w.setPreset('storm', 11);
    const rng = mulberry32(3);
    const near = new AiPlayer('near', AI_LEVELS.hard, params, rng);
    const far = new AiPlayer('far', AI_LEVELS.hard, params, rng);
    const m = new Match(params, { near: { kind: 'ai', ai: near }, far: { kind: 'ai', ai: far } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    let hits = 0;
    let points = 0;
    m.on((e) => {
      if (e.type === 'hit') hits++;
      if (e.type === 'point') points++;
    });
    for (let i = 0, t = 0; i < 60 * 60 * 10 && m.phase !== 'match-over'; i++) {
      w.update((t += 1 / 60));
      w.apply(params, true);
      m.frame(1 / 60, 1 / 60);
    }
    expect(m.phase).toBe('match-over');
    // Still air gives ~4.5 shots a point; with the wind read in the wrong frame it was under 1.
    expect(hits / points).toBeGreaterThan(3);
  }, 60000);
});

describe('custom weather', () => {
  it('blows the way you set it, at the speed you set', () => {
    const w = new WeatherState();
    for (const [dir, label] of [[0, 'towards your opponent'], [90, 'to your right'], [180, 'back at you'], [270, 'to your left']] as const) {
      w.setCustom({ rain: 0, windKmh: 18, windDir: dir, water: 0 });
      w.update(0);
      const r = w.readout();
      expect(Math.abs(((r.towardsDeg - dir + 540) % 360) - 180)).toBeLessThan(25);
      expect(windDirLabel(dir)).toBe(label);
      // Gusts only add: never below ~85% of the steady wind.
      expect(Math.hypot(w.windX, w.windZ) * 3.6).toBeGreaterThan(18 * 0.84);
    }
  });

  it('water on the table sets the wetness, and puddles grow in number without moving', () => {
    expect(customPreset({ rain: 0, windKmh: 0, windDir: 0, water: 0.2 }).puddles).toBe(0);
    expect(customPreset({ rain: 0, windKmh: 0, windDir: 0, water: 1 }).puddles).toBe(6);
    const w = new WeatherState();
    w.setCustom({ rain: 1, windKmh: 0, windDir: 0, water: 0.5 }, 9);
    const some = w.puddles;
    w.setCustom({ rain: 1, windKmh: 0, windDir: 0, water: 1 }, 9);
    expect(w.puddles.length).toBeGreaterThan(some.length);
    expect(w.puddles.slice(0, some.length)).toEqual(some);
    const params = { ...P };
    w.apply(params, true);
    expect(params.wetness).toBe(1);
    expect([params.windX, params.windZ]).toEqual([0, 0]);
  });

  it('cleans up saved settings', () => {
    expect(sanitizeCustom({ rain: 3, windKmh: -5, windDir: 450, water: Number.NaN })).toEqual({ rain: 1, windKmh: 0, windDir: 90, water: 0.5 });
    expect(sanitizeCustom(null).windDir).toBe(90);
  });
});
