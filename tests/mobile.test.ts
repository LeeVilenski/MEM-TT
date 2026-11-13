import { describe, expect, it } from 'vitest';
import { SwipeTracker } from '../src/input/touch';
import { forwardTilt, tiltToPitch } from '../src/input/tilt';
import { AutoQuality, QUALITY_LEVELS } from '../src/render/quality';
import { SwingController, NO_INPUT } from '../src/game/swing';

describe('touch swipes', () => {
  it('tracks one swing finger and reports mouse-equivalent movement', () => {
    const s = new SwipeTracker(2);
    expect(s.start(1, 100, 300)).toBe(true);
    expect(s.start(2, 50, 50)).toBe(false); // a second finger doesn't steal the swing
    s.move(2, 0, 0);
    s.move(1, 110, 250);
    expect(s.consume()).toEqual({ dx: 20, dy: -100 });
    expect(s.consume()).toEqual({ dx: 0, dy: 0 });
    s.end(1);
    expect(s.active).toBe(false);
  });

  it('a quick upward swipe is a topspin stroke through the same swing model', () => {
    const s = new SwipeTracker();
    const swing = new SwingController();
    swing.reset(0.3, 1.0, 1.6);
    s.start(1, 600, 500);
    // ~120 ms swipe of 220 px upward at 60 fps.
    for (let i = 1; i <= 7; i++) {
      s.move(1, 600, 500 - (220 * i) / 7);
      const d = s.consume();
      swing.update(1 / 60, { ...NO_INPUT, dx: d.dx, dy: d.dy }, { x: 0, z: 2 }, 1.6, { x: 0, z: -0.85 });
    }
    expect(swing.pose.vel.y).toBeGreaterThan(3);
    expect(swing.pose.vel.z).toBeLessThan(-3);
  });
});

describe('phone tilt', () => {
  it('uses the right axis for the screen orientation', () => {
    expect(forwardTilt(30, 5, 0)).toBe(30);
    expect(forwardTilt(30, 5, 90)).toBe(-5);
    expect(forwardTilt(30, 5, -90)).toBe(5);
  });

  it('maps tilt relative to calibration onto a clamped face pitch', () => {
    expect(tiltToPitch(40, 40)).toBeCloseTo(0, 9);
    expect(tiltToPitch(50, 40)).toBeLessThan(0); // tilted away: closes the face
    expect(tiltToPitch(30, 40)).toBeGreaterThan(0); // toward you: opens it
    expect(tiltToPitch(170, -170)).toBeCloseTo(24, 6); // wraps across ±180
    expect(tiltToPitch(0, 100)).toBe(50);
  });
});

describe('adaptive quality', () => {
  it('steps down when frames are slow and back up when there is headroom', () => {
    const q = new AutoQuality(2);
    let changed = false;
    for (let i = 0; i < 120; i++) changed = q.sample(1 / 25) || changed; // 40 ms frames
    expect(changed).toBe(true);
    expect(q.level).toBeLessThan(2);
    const low = q.level;
    for (let i = 0; i < 120 * 8; i++) q.sample(1 / 120); // 8 s of fast frames
    expect(q.level).toBeGreaterThan(low);
    expect(q.level).toBeLessThanOrEqual(QUALITY_LEVELS.length - 1);
  });

  it('does not flap on frames in the comfortable band', () => {
    const q = new AutoQuality(1);
    for (let i = 0; i < 60 * 20; i++) expect(q.sample(1 / 60)).toBe(false);
    expect(q.level).toBe(1);
  });
});
