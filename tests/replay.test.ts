import { describe, expect, it } from 'vitest';
import { RallyRecorder, ReplayPlayer, type ViewFrame } from '../src/sandbox/replay';
import { v3 } from '../src/physics';

const view = (z: number): ViewFrame => ({ id: 'me', pose: { pos: v3(0.3, 1, z), normal: v3(0, 0, -1), vel: v3() }, body: { x: 0, z: 2 }, wing: 'forehand', forward: 0, visible: true });
const ball = (z: number) => ({ pos: v3(0.3, 1, z), vel: v3(0, 0, 15), spin: v3() });

describe('rally replays', () => {
  it('pins a contact between frames: the ball meets the bat, and the hit is heard then', () => {
    const r = new RallyRecorder();
    r.start(0);
    // The ball comes in at 15 m/s; one rendered frame later it is already on its way back.
    for (let i = 0; i < 10; i++) r.add(i / 60, ball(1.0 + i * 0.01), [view(1.3)]);
    const before = 9 / 60;
    // Contact during the next frame, at z = 1.28, logged with the frame's time.
    r.sound(10 / 60, 'paddle', 12, 0.3);
    r.keyframe(10 / 60, { pos: v3(0.3, 1, 1.28), vel: v3(0, 0, -12), spin: v3() }, [{ id: 'me', pos: v3(0.3, 1, 1.3) }]);
    for (let i = 10; i < 20; i++) r.add(i / 60, ball(1.2 - (i - 10) * 0.2), [view(1.3)]);
    r.end(20 / 60);
    r.add(2, ball(0), [view(1.3)]);
    const rally = r.last!;
    expect(rally).not.toBeNull();

    const cue = rally.cues.find((c) => c.kind === 'sound')!;
    expect(cue.t).toBeGreaterThan(before);
    expect(cue.t).toBeLessThan(10 / 60);

    // Played back: at the moment of the hit sound the ball is at the contact point, against the bat.
    const p = new ReplayPlayer(rally, 1);
    p.advance(cue.t);
    const f = p.frame();
    expect(f.ball!.pos.z).toBeCloseTo(1.28, 3);
    const bat = f.views.find((v) => v.id === 'me')!;
    expect(Math.abs(bat.pose.pos.z - f.ball!.pos.z)).toBeLessThan(0.03);
  });

  it('keeps frames in time order with several keyframes in one frame', () => {
    const r = new RallyRecorder();
    r.start(0);
    for (let i = 0; i < 12; i++) r.add(i / 60, ball(i * 0.01), []);
    r.keyframe(12 / 60, ball(0.5));
    r.keyframe(12 / 60, ball(0.6));
    r.add(12 / 60, ball(0.7), []);
    r.end(0.2);
    r.add(2, ball(0.8), []);
    const t = r.last!.frames.map((f) => f.t);
    for (let i = 1; i < t.length; i++) expect(t[i]).toBeGreaterThanOrEqual(t[i - 1]);
  });
});
