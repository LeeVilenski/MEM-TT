import { describe, expect, it } from 'vitest';
import { v3 } from '../src/physics';
import { RallyRecorder, ReplayPlayer, type ViewFrame } from '../src/sandbox/replay';
import { impactGain, rubberTone } from '../src/audio/sfx';

const view = (x: number): ViewFrame => ({ id: 'me', pose: { pos: v3(x, 1, 1.5), normal: v3(0, 0, -1), vel: v3() }, body: { x, z: 2 }, wing: 'forehand', forward: 0, visible: true });

describe('rally replays', () => {
  function record() {
    const r = new RallyRecorder();
    r.start(10);
    for (let i = 0; i <= 120; i++) {
      const t = 10 + i / 60;
      if (i === 30) r.caption(t, 'You: Loop');
      if (i === 30) r.sound(t, 'paddle', 12, 0.2, 'Inverted');
      if (i === 60) r.end(t);
      r.add(t, { pos: v3(0, 1, 1 - i / 60), vel: v3(0, 0, -1), spin: v3() }, [view(i / 120)]);
    }
    return r;
  }

  it('records a rally and keeps a short tail after the point', () => {
    const r = record();
    expect(r.recording).toBe(false);
    expect(r.last).not.toBeNull();
    expect(r.last!.duration).toBeCloseTo(2, 1); // 1 s of rally + 1 s tail
    expect(r.last!.hits).toBe(1);
  });

  it('plays back slowly, interpolating positions and firing cues on time', () => {
    const p = new ReplayPlayer(record().last!, 0.5);
    const fired: string[] = [];
    // 0.5 s of real time at half speed = 0.25 s of rally: before the hit at 0.5 s.
    for (let i = 0; i < 30; i++) fired.push(...p.advance(1 / 60).map((c) => c.kind));
    expect(fired).toEqual([]);
    expect(p.frame().ball!.pos.z).toBeCloseTo(0.75, 2);
    for (let i = 0; i < 40; i++) fired.push(...p.advance(1 / 60).map((c) => c.kind));
    expect(fired).toEqual(['caption', 'sound']);
    expect(p.caption).toBe('You: Loop');
    const v = p.frame().views[0];
    expect(v.pose.pos.x).toBeGreaterThan(0.2);
    while (!p.done) p.advance(0.1);
    expect(p.done).toBe(true);
  });

  it('discards recordings that are too short to be a rally', () => {
    const r = new RallyRecorder();
    r.start(0);
    r.add(0, null, []);
    r.end(0);
    r.add(2, null, []);
    expect(r.last).toBeNull();
  });
});

describe('sound mapping', () => {
  it('louder for harder impacts, capped', () => {
    expect(impactGain(1)).toBeLessThan(impactGain(6));
    expect(impactGain(100)).toBe(1);
    expect(impactGain(0)).toBeGreaterThan(0);
  });

  it('rubbers sound different', () => {
    expect(rubberTone('Short pips').freq).toBeGreaterThan(rubberTone('Inverted').freq);
    expect(rubberTone('Anti-spin').freq).toBeLessThan(rubberTone('Inverted').freq);
  });
});
