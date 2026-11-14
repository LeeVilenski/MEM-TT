import { describe, expect, it } from 'vitest';
import { BallSim, DEFAULT_PARAMS, RUBBERS, TABLE, TICK_DT, launchState, solveAim, v3 } from '../src/physics';
import { landingOutcome } from '../src/game/assist';
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
import { mulberry32 } from './helpers/rng';

const P = DEFAULT_PARAMS;

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

  it('Will hits harder and stands close', () => {
    const p = new Player('p', P);
    p.applyStyle('penhold');
    expect(p.swing.params.swingGain).toBeCloseTo(DEFAULT_SWING.swingGain * 1.15, 6);
    expect(p.homeZ).toBeLessThan(TABLE.halfLength + 0.6);
  });
});

/** The ball state a machine preset launches. */
function presetLaunch(pr: (typeof PRESETS)[number]) {
  const origin = v3(pr.lateral, TABLE.height + pr.height, -TABLE.halfLength - pr.distanceBack);
  const aim = solveAim(origin, pr.target, pr.speed, pr.spin, P, pr.highArc);
  return launchState(origin, { speed: pr.speed, elevation: aim.elevation, azimuth: aim.azimuth, spin: pr.spin });
}

describe('AI per style', () => {
  /** Strokes an AI chooses for a spread of incoming machine shots. */
  function strokeMix(styleId: keyof typeof STYLES) {
    const counts: Record<string, number> = {};
    let distance = 0;
    let n = 0;
    let wide = 0;
    let loops = 0;
    let loopVy = 0;
    for (let seed = 1; seed <= 6; seed++) {
      for (const pr of PRESETS) {
        const ai = new AiPlayer('near', AI_LEVELS.hard, P, mulberry32(seed * 100 + n));
        ai.setStyle(STYLES[styleId]);
        const plan = ai.planReturn(presetLaunch(pr), 0);
        if (!plan) continue;
        counts[plan.stroke] = (counts[plan.stroke] ?? 0) + 1;
        distance += plan.pos.z;
        if (plan.aimX !== undefined && Math.abs(plan.aimX) > 0.4) wide++;
        if (plan.stroke === 'loop') ((loops += 1), (loopVy += plan.vel.y));
        n++;
      }
    }
    return { counts, distance: distance / n, n, wide: wide / n, loopVy: loopVy / Math.max(1, loops) };
  }

  it('each character plays like the real person: Ed, Ryan, Will, Lee and the Sysadmin', () => {
    const lee = strokeMix('allround');
    const ryan = strokeMix('looper');
    const ed = strokeMix('blocker');
    const will = strokeMix('penhold');
    const sys = strokeMix('chopper');
    const share = (m: typeof lee, ...k: string[]) => k.reduce((a, s) => a + (m.counts[s] ?? 0), 0) / m.n;
    console.log({ lee: lee.counts, ryan: ryan.counts, ed: ed.counts, will: will.counts, sys: sys.counts }, 'wide', lee.wide, ryan.wide, 'loopVy', lee.loopVy, will.loopVy);
    // Sysadmin: chops from the deepest position.
    expect(share(sys, 'chop', 'push')).toBeGreaterThan(share(lee, 'chop', 'push') + 0.2);
    expect(sys.distance).toBeGreaterThan(Math.max(lee.distance, ryan.distance, will.distance));
    // Ed: defends deep and counter-loops.
    expect(ed.distance).toBeGreaterThan(lee.distance + 0.3);
    expect(share(ed, 'loop')).toBeGreaterThan(share(lee, 'loop') + 0.15);
    // Ryan: moves the ball around, and only smashes a real opening.
    expect(ryan.wide).toBeGreaterThan(lee.wide + 0.25);
    expect(share(ryan, 'smash')).toBeLessThan(share(lee, 'smash'));
    // Will: the most smashes, and heavier topspin.
    expect(share(will, 'smash')).toBeGreaterThan(Math.max(share(lee, 'smash'), share(ryan, 'smash'), share(ed, 'smash')));
    expect(will.loopVy).toBeGreaterThan(lee.loopVy * 1.25);
  }, 120000); // several whole AI matches: ~50 s alone, longer under the full suite

  it('Ed blocks slams well and topspins pushes from below the table', () => {
    /** Share of smashes and power loops each style returns onto the table. */
    const slamReturns = (id: keyof typeof STYLES) => {
      let lands = 0;
      let n = 0;
      for (const name of ['Smash', 'Power loop']) {
        const pr = PRESETS.find((p) => p.name === name)!;
        for (let seed = 1; seed <= 20; seed++) {
          const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(seed));
          ai.setStyle(STYLES[id]);
          const start = presetLaunch(pr);
          const plan = ai.planReturn(start, 0);
          if (!plan) continue;
          const sim = new BallSim(start, P);
          while (sim.time < plan.t - 1e-6) sim.step(TICK_DT);
          n++;
          if (landingOutcome(sim.state, plan, plan.normal, ai.rubber, P).outcome === 'in') lands++;
        }
      }
      return lands / n;
    };
    const ed = slamReturns('blocker');
    const others = ['allround', 'looper', 'penhold'].map((id) => slamReturns(id as keyof typeof STYLES));
    console.log('slam returns: Ed', ed.toFixed(2), 'Lee/Ryan/Will', others.map((x) => x.toFixed(2)).join(' '));
    expect(ed).toBeGreaterThan(Math.max(...others) + 0.15);

    // A long push taken late, below the height of the table, is looped.
    const push = PRESETS.find((p) => p.name === 'Long push')!;
    let lowLoops = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const ai = new AiPlayer('near', AI_LEVELS.medium, P, mulberry32(seed + 50));
      ai.setStyle(STYLES.blocker);
      const plan = ai.planReturn(presetLaunch(push), 0);
      if (plan && plan.stroke === 'loop' && plan.pos.y < TABLE.height) lowLoops++;
    }
    expect(lowLoops).toBeGreaterThanOrEqual(6);
  }, 60000);

  it('Will serves with spin: mostly sidespin', () => {
    const kinds: Record<string, number> = {};
    for (let i = 0; i < 30; i++) {
      const ai = new AiPlayer('near', AI_LEVELS.hard, P, mulberry32(i + 7));
      ai.setStyle(STYLES.penhold);
      ai.planServe(0);
      kinds[ai.plan!.stroke] = (kinds[ai.plan!.stroke] ?? 0) + 1;
    }
    expect(kinds['serve-side'] ?? 0).toBeGreaterThanOrEqual(18);
  });

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
