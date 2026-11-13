import { describe, expect, it } from 'vitest';
import { DEFAULT_PARAMS, RUBBERS, TABLE, launchState, solveAim, v3 } from '../src/physics';
import { AI_LEVELS, AiPlayer } from '../src/game/ai';
import { Player } from '../src/game/player';
import { DEFAULT_REALISM, REALISM_PRESETS, realismSettings } from '../src/game/realism';
import { STYLES } from '../src/game/styles';
import { DEFAULT_SWING } from '../src/game/swing';
import { Match } from '../src/game/match';
import { OnlineClient } from '../src/net/client';
import { LocalServer } from '../src/net/transport';
import { PRESETS } from '../src/sandbox/presets';
import { makeBot } from './helpers/bot';

const P = DEFAULT_PARAMS;

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('realism slider', () => {
  it('runs from pure simulation to full arcade', () => {
    const sim = realismSettings(REALISM_PRESETS.Simulation);
    const arc = realismSettings(REALISM_PRESETS.Arcade);
    expect(sim).toMatchObject({ gameSpeed: 1, angleAssist: 0, hitArea: 0, spinCurve: 1 });
    expect(arc.gameSpeed).toBeLessThan(0.7);
    expect(arc.angleAssist).toBe(1);
    expect(arc.spinCurve).toBeGreaterThan(1.3);
    expect(arc.strokeHold).toBeGreaterThan(sim.strokeHold);
    expect(arc.footwork).toBeGreaterThan(sim.footwork);
  });

  it('Balanced keeps the tuning the game was first balanced with, a little slower', () => {
    const d = realismSettings(REALISM_PRESETS.Balanced);
    expect(d.angleAssist).toBeCloseTo(0.77, 1);
    expect(d.hitArea).toBeCloseTo(0.0385, 2);
    expect(d.footwork).toBeCloseTo(0.69, 1);
    expect(d.strokeHold).toBeCloseTo(0.137, 2);
    expect(d.gameSpeed).toBeLessThan(0.8);
  });

  it('the default is the more assisted setting, with auto face angle on', () => {
    const d = realismSettings(DEFAULT_REALISM);
    expect(DEFAULT_REALISM).toBe(0.75);
    expect(d.angleAssist).toBe(1);
    expect(d.autoFace).toBe(1);
    expect(realismSettings(0).autoFace).toBe(0);
  });

  it('applies to a player', () => {
    const p = new Player('p', P);
    p.applyRealism(1);
    expect(p.assists.angle).toBe(1);
    expect(p.swing.params.strokeHold).toBeCloseTo(0.2, 6);
  });
});

describe('player styles', () => {
  it('a Sysadmin (chopper) stands deep with long pips on the backhand', () => {
    const p = new Player('p', P);
    p.applyStyle('chopper');
    expect(p.homeZ).toBeCloseTo(TABLE.halfLength + 1.8, 6);
    expect(p.rubbers.backhand).toBe(RUBBERS.longPips);
    expect(p.swing.reachScale).toBeGreaterThan(1);
  });

  it('a Network Engineer (penhold) hits harder and stands close', () => {
    const p = new Player('p', P);
    p.applyStyle('penhold');
    expect(p.swing.params.swingGain).toBeCloseTo(DEFAULT_SWING.swingGain * 1.15, 6);
    expect(p.homeZ).toBeLessThan(TABLE.halfLength + 0.6);
  });
});

describe('AI per style', () => {
  /** Strokes an AI chooses for a spread of incoming machine shots. */
  function strokeMix(styleId: keyof typeof STYLES) {
    const counts: Record<string, number> = {};
    let distance = 0;
    let n = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const pr of PRESETS) {
        const ai = new AiPlayer('near', AI_LEVELS.hard, P, mulberry32(seed * 100 + n));
        ai.setStyle(STYLES[styleId]);
        const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
        const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
        const plan = ai.planReturn(launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin }), 0);
        if (!plan) continue;
        counts[plan.stroke] = (counts[plan.stroke] ?? 0) + 1;
        distance += plan.pos.z;
        n++;
      }
    }
    return { counts, distance: distance / n, n };
  }

  it('a Sysadmin AI chops from deep; a Full-Stack Dev AI loops; a Security Analyst AI blocks close', () => {
    const chopper = strokeMix('chopper');
    const looper = strokeMix('looper');
    const blocker = strokeMix('blocker');
    console.log('chopper', chopper.counts, chopper.distance.toFixed(2), '| looper', looper.counts, looper.distance.toFixed(2), '| blocker', blocker.counts, blocker.distance.toFixed(2));
    const share = (m: typeof chopper, ...k: string[]) => k.reduce((a, s) => a + (m.counts[s] ?? 0), 0) / m.n;
    expect(share(chopper, 'chop', 'push')).toBeGreaterThan(share(looper, 'chop', 'push') + 0.2);
    expect(share(looper, 'loop')).toBeGreaterThan(share(chopper, 'loop') + 0.2);
    expect(share(blocker, 'block')).toBeGreaterThan(share(looper, 'block') + 0.15);
    expect(chopper.distance).toBeGreaterThan(looper.distance + 0.3);
    expect(blocker.distance).toBeLessThan(looper.distance);
  }, 60000);

  it('a Chopper vs a Looper plays a complete game', () => {
    const rng = mulberry32(9);
    const a = new AiPlayer('near', AI_LEVELS.medium, P, rng);
    const b = new AiPlayer('far', AI_LEVELS.medium, P, rng);
    a.setStyle(STYLES.chopper);
    b.setStyle(STYLES.looper);
    const m = new Match(P, { near: { kind: 'ai', ai: a }, far: { kind: 'ai', ai: b } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
    for (let i = 0; i < 60 * 60 * 20 && m.phase !== 'match-over'; i++) m.frame(1 / 60, 1 / 60);
    console.log('chopper vs looper', m.score.history, m.stats);
    expect(m.phase).toBe('match-over');
    expect(m.stats.hits / m.stats.rallies).toBeGreaterThan(2.5);
  }, 60000);
});

describe('room realism (online)', () => {
  it('a full-arcade room runs slower for everyone and stays in sync', () => {
    let t = 50;
    const clock = () => t;
    const server = new LocalServer(clock, { rng: mulberry32(4) });
    const params = { a: { ...P }, b: { ...P } };
    const a = new OnlineClient(server.connect('ARCAD', 0.04), new Player('Ada', params.a), params.a, clock, { name: 'Ada', create: { mode: 'singles', bestOf: 1, aiLevel: 'medium', realism: 1 } });
    const clients = [a];
    const step = (frames: number) => {
      for (let i = 0; i < frames; i++) {
        t += 1 / 60;
        server.pump();
        for (const [c, bot] of bots) c.frame(1 / 60, bot(), { x: 0, z: 0 });
      }
    };
    const bots: [OnlineClient, () => ReturnType<ReturnType<typeof makeBot>>][] = [[a, makeBot(a)]];
    step(5);
    a.configure({ realism: 1 });
    const b = new OnlineClient(server.connect('ARCAD', 0.04), new Player('Bob', params.b), params.b, clock, { name: 'Bob' });
    clients.push(b);
    bots.push([b, makeBot(b)]);
    step(10);
    expect(a.room?.realism).toBe(1);
    a.start(false);
    step(10);
    expect(b.realism).toBe(1);
    expect(params.b.liftCoefficientMax).toBeGreaterThan(P.liftCoefficientMax * 1.3);
    expect(b.player.assists.angle).toBe(1);
    // Game time runs at ~0.6× real time on the server and both clients.
    const room = server.room('ARCAD')!;
    const g0 = room.now();
    const r0 = t;
    step(120);
    expect((room.now() - g0) / (t - r0)).toBeCloseTo(realismSettings(1).gameSpeed, 2);
    expect(Math.abs(a.serverNow() - room.now())).toBeLessThan(0.05);
    expect(Math.abs(b.serverNow() - room.now())).toBeLessThan(0.05);
    for (let i = 0; i < 60 * 120 && (a.score?.points.near ?? 0) + (a.score?.points.far ?? 0) < 6; i++) step(1);
    step(60);
    expect((a.score?.points.near ?? 0) + (a.score?.points.far ?? 0)).toBeGreaterThanOrEqual(6);
    expect(b.score?.points).toEqual(a.score?.points);
  }, 60000);
});
