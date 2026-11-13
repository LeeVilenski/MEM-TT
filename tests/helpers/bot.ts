import { TABLE } from '../../src/physics';
import { NO_INPUT } from '../../src/game/swing';
import type { OnlineClient } from '../../src/net/client';

const FPS = 60;

/** Scripted human: positions at ~800 px/s, serves with a gentle downward stroke, returns with an upward flick. */
export function makeBot(c: OnlineClient) {
  let flick = 0;
  let flickDy = 0;
  let lastFlickFor = -1;
  let tossedAt = -1;
  return () => {
    const input = { ...NO_INPUT };
    const p = c.player;
    const sens = p.swing.params.sensitivity;
    const lim = 800 / FPS;
    const clamp = (v: number) => Math.max(-lim, Math.min(lim, v));
    if (flick > 0) {
      flick--;
      input.dy = flickDy;
      return input;
    }
    if (c.myServe) {
      p.swing.basePitch = 0;
      const dy = p.swing.y - (TABLE.height + 0.12);
      if (Math.abs(dy) > 0.01) input.dy = clamp(dy / sens);
      else {
        c.toss(0.45);
        tossedAt = c.serverNow();
      }
      return input;
    }
    if (c.awaitingMyServeContact && c.flight) {
      const b = c.flight.sim.state;
      if (b.vel.y < 0 && b.pos.y - p.swing.y < 0.2 && lastFlickFor !== tossedAt) {
        lastFlickFor = tossedAt;
        flick = 3;
        flickDy = 25;
      }
      return input;
    }
    const ic = c.interceptPoint();
    if (ic) {
      p.swing.basePitch = -25;
      const key = Math.round(ic.t * 1000);
      if (ic.t - c.serverNow() <= 3 / FPS && lastFlickFor !== key) {
        lastFlickFor = key;
        flick = 3;
        flickDy = -60;
      } else {
        const ex = ic.pos.x - p.swing.pose.pos.x;
        if (Math.abs(ex) > 0.3) input.dx = clamp(ex / sens);
        input.dy = clamp(-(ic.pos.y - p.swing.pose.pos.y) / sens);
      }
    }
    return input;
  };
}

