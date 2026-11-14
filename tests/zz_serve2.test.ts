import { it } from 'vitest';
import { Match } from '../src/game/match';
import { Player } from '../src/game/player';
import { AiPlayer, AI_LEVELS } from '../src/game/ai';
import { NO_INPUT } from '../src/game/swing';
import { DEFAULT_PARAMS as P, TABLE } from '../src/physics';
import { mulberry32 } from './helpers/rng';
it('x', () => {
  for (const realism of [0.55, 0.75, 0.85])
  for (const dy of [20, -20]) {
    let ok = 0;
    for (let seed = 1; seed <= 8; seed++) {
      const human = new Player('h', { ...P });
      human.applyRealism(realism);
      const ai = new AiPlayer('far', AI_LEVELS.medium, P, mulberry32(seed));
      const m = new Match(P, { near: { kind: 'human', player: human }, far: { kind: 'ai', ai } }, { bestOf: 1, pointsToWin: 11, firstServer: 'near' });
      let outcome = '';
      m.on((e) => { if (e.type === 'point' && !outcome) outcome = e.result.reason; if (e.type === 'hit' && e.side === 'far' && !outcome) outcome = 'returned'; });
      human.swing.y = TABLE.height + 0.15;
      m.frame(1 / 60, 1 / 60);
      m.toss(0.3 + seed * 0.03);
      let flick = 0;
      for (let i = 0; i < 300 && !outcome; i++) {
        const b = m.sim?.state;
        const input = { ...NO_INPUT };
        if (flick === 0 && b && b.vel.y < 0 && b.pos.y - human.swing.pose.pos.y < 0.15) flick = 3;
        if (flick > 0) { input.dy = dy; flick--; if (flick === 0) flick = -1; }
        m.frame(1 / 60, 1 / 60, { side: 'near', input, move: { x: 0, z: 0 } });
      }
      if (outcome === 'returned') ok++;
    }
    console.log('realism', realism, 'dy', dy, 'returned', ok, '/8');
  }
}, 60000);
