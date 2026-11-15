/** "How to play": practical shot recipes, in mouse or touch wording. */
export class HowToPlay {
  private el: HTMLDivElement;
  onClose: () => void = () => {};
  /** Start the interactive tutorial instead. */
  onTutorial: () => void = () => {};

  constructor(
    container: HTMLElement,
    private touch: boolean,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'career howto';
    this.el.style.display = 'none';
    container.append(this.el);
    this.el.addEventListener('click', (e) => {
      const t = e.target as HTMLElement;
      if (t.closest('[data-a=tutorial]')) {
        this.el.style.display = 'none';
        this.onClose = () => {};
        this.onTutorial();
      } else if (t === this.el || t.closest('[data-a=close]')) this.hide();
    });
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  hide() {
    this.el.style.display = 'none';
    this.onClose();
  }

  show() {
    const t = this.touch;
    const move = t ? 'Drag' : 'Move the mouse';
    const flickUp = t ? '<b>Swipe up</b>' : '<b>Flick the mouse up</b>';
    const flickDown = t ? '<b>Swipe down</b> gently' : '<b>Flick the mouse down</b> gently';
    const drive = t ? 'hold <b>Drive</b>' : 'hold the <b>left mouse button</b>';
    const close = t ? '<b>Close face</b>' : '<kbd>W</kbd>';
    const open = t ? '<b>Open face</b>' : '<kbd>S</kbd>';
    const hook = t ? 'hold <b>↶</b> or <b>↷</b>' : 'hold <kbd>A</kbd> (curves left) or <kbd>D</kbd> (curves right)';
    const toss = t ? 'Hold <b>Serve</b>' : 'Hold <kbd>Space</kbd>';
    this.el.innerHTML = `<div class="career-card howto-card">
      <div class="cs-head"><div><div class="cs-sub">MEM Table Tennis</div><div class="cs-title">How to play</div></div><div class="cs-xp"></div><button data-a="close" class="cs-close" aria-label="Close">✕</button></div>
      <div class="cs-body">
        <div class="ht-step"><div class="ht-n">1</div><div><b>Put the bat by the ring.</b> The <span class="ht-ring">cyan ring</span> shows where the ball will reach you. ${move}: the bat goes exactly where you put it, and your feet follow. You only need to get close: as the ball arrives the bat <b>snaps onto it</b>.</div></div>
        <div class="ht-step"><div class="ht-n">2</div><div><b>Swing just before the ball arrives.</b> Which way you swing decides the shot:
          <table class="ht-shots">
            <tr><td>Topspin<br><small>loop / drive</small></td><td>${flickUp} through the ring. For a flatter, faster drive, ${drive} while you swing.</td></tr>
            <tr><td>Backspin<br><small>push / chop</small></td><td>${flickDown}, like slicing under the ball. The face opens by itself. Best against short balls and against backspin.</td></tr>
            <tr><td>Smash<br><small>kill shot</small></td><td>Hold ${t ? '<b>Smash</b>' : 'the <b>right mouse button</b>'} as the ball arrives. The ring turns <b style="color:#ff4d6d">red</b> when the ball is high enough: a high ball is a near-certain winner, a low one a gamble.</td></tr>
            <tr><td>Block</td><td>Keep the paddle <b>still</b> on the ring. Great against fast topspin.</td></tr>
            <tr><td>Sidespin<br><small>hook</small></td><td>${hook} while you swing.</td></tr>
          </table>
          <b>Placement:</b> angle your ${t ? 'swipe' : 'flick'}: up-and-<b>left</b> sends the ball left, up-and-<b>right</b> sends it right (the more angled, the wider). Straight goes to the middle. Works for downward strokes too.
        </div></div>
        <div class="ht-step"><div class="ht-n">3</div><div><b>Timing.</b> The ring shrinks onto the ball as it arrives and <b style="color:#ffc83d">turns gold</b> at the last moment: ${t ? 'swipe' : 'flick'} then for a <b>PERFECT</b> stroke (a little extra pace). A swing counts for about 0.15 s, and <b>a little early beats late</b>: if you swing after the ball has reached the ring, you just block it.
          <br><b>Take it early:</b> ${t ? 'swipe' : 'flick'} while the ball is still rising off the bounce, with the bat near it, and you meet it there: on the rise, close to the table. The ring shows the normal point; you'll never have to dig a ball up off the floor.</div></div>
        <div class="ht-step"><div class="ht-n">4</div><div><b>Missing?</b> Into the net → open the face (${open}). Long → close it (${close}). The face angle is shown at the bottom of the screen.</div></div>
        <div class="ht-step"><div class="ht-n">5</div><div><b>Serving.</b> ${toss} (longer = higher toss), let go, then swing as the ball drops; the bat meets the ball as long as you swing. <b>Pick a serve</b> first (${t ? 'tap one of the serve buttons' : '<kbd>1</kbd>–<kbd>6</kbd> or <kbd>Q</kbd>/<kbd>E</kbd>'}): <b>Backspin</b>, <b>Sidespin</b> (swipe left or right for the curve), <b>Topspin</b>, <b>Fast long</b> or <b>No-spin</b>. The faster you ${t ? 'swipe' : 'flick'}, the more spin. <b>Free</b> lets your swing decide everything.</div></div>
        <div class="ht-tip">Still too hard? Open <b>Realism</b> in the panel: <b>Arcade</b> slows the game and helps even more. The <b>📈 Career → Training drills</b> teach each shot one at a time.</div>
        <div class="cs-actions"><button data-a="tutorial" class="secondary">Try the interactive tutorial</button><button data-a="close">Got it — let's play</button></div>
      </div>
    </div>`;
    this.el.style.display = 'flex';
  }
}
