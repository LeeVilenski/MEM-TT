import { describe, expect, it } from 'vitest';
import { PRESETS } from '../src/sandbox/presets';
import { FPS, playBall } from './helpers/practice';

describe('gameplay pipeline (scripted player vs ball machine)', () => {
  const names = PRESETS.map((p) => p.name);

  it('reaches every machine shot, and one simple swing lands most of them', () => {
    const results = names.map((n) => [n, playBall(n, 0.75)] as const);
    for (const [n, r] of results) console.log(`${n.padEnd(13)} → ${(r.shot?.name ?? '-').padEnd(13)} ${r.result.padEnd(9)} ${r.shot ? `${r.shot.speed.toFixed(1)} m/s ${Math.round(r.shot.rpm)} rpm` : ''}`);
    expect(results.filter(([, r]) => r.result === 'MISSED').map(([n]) => n)).toEqual([]);
    expect(results.filter(([, r]) => r.result === 'IN').length).toBeGreaterThanOrEqual(9);
  });

  it('the angle assist makes a real difference', () => {
    const count = (assist: number) => names.filter((n) => playBall(n, assist).result === 'IN').length;
    const without = count(0);
    const withAssist = count(0.75);
    console.log(`in without assist: ${without}/${names.length}, with: ${withAssist}/${names.length}`);
    expect(withAssist).toBeGreaterThan(without);
  });

  it('a flick up to ~100 ms early still counts as a stroke (timing window)', () => {
    const onTime = playBall('Drive', 0.75, 2 / FPS);
    const early = playBall('Drive', 0.75, 6 / FPS);
    const wayEarly = playBall('Drive', 0.75, 20 / FPS);
    expect(onTime.shot!.name).not.toBe('Block');
    expect(early.shot!.name).not.toBe('Block');
    // A third of a second early: the stroke has faded and the ball meets a still paddle.
    expect(wayEarly.shot?.name ?? 'Block').toBe('Block');
  });
});
