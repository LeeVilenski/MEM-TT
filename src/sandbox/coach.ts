import { TUTORIAL_STEPS, type Tutorial } from '../progress/tutorial';

/**
 * The tutorial's coach: a card at the top of the screen with the current step,
 * its instructions, progress pips and a hint after a miss; and a finish screen.
 */
export class Coach {
  private card: HTMLDivElement;
  private finish: HTMLDivElement;
  onFinish: (choice: 'quick' | 'practice' | 'title') => void = () => {};

  constructor(
    container: HTMLElement,
    private touch: boolean,
  ) {
    this.card = document.createElement('div');
    this.card.className = 'coach';
    this.card.setAttribute('role', 'status');
    this.card.setAttribute('aria-live', 'polite');
    this.card.style.display = 'none';
    this.finish = document.createElement('div');
    this.finish.className = 'career coach-finish';
    this.finish.setAttribute('role', 'dialog');
    this.finish.setAttribute('aria-modal', 'true');
    this.finish.setAttribute('aria-label', 'Tutorial complete');
    this.finish.style.display = 'none';
    container.append(this.card, this.finish);
    this.finish.addEventListener('click', (e) => {
      const a = (e.target as HTMLElement).closest('button')?.dataset.a as 'quick' | 'practice' | 'title' | undefined;
      if (!a) return;
      this.finish.style.display = 'none';
      this.onFinish(a);
    });
  }

  get finishVisible() {
    return this.finish.style.display !== 'none';
  }

  /** Show the coach for this tutorial (null hides it). `hint` appears under the instructions. */
  update(t: Tutorial | null, hint: string | null = null) {
    if (!t || t.done) {
      this.card.style.display = 'none';
      return;
    }
    const s = t.step!;
    const pips = Array.from({ length: s.needed }, (_, i) => `<i class="${i < t.progress ? 'on' : ''}"></i>`).join('');
    const steps = TUTORIAL_STEPS.map((_, i) => `<i class="${i < t.index ? 'done' : i === t.index ? 'now' : ''}"></i>`).join('');
    this.card.innerHTML = `
      <div class="coach-top"><span class="coach-label">Tutorial · step ${t.index + 1} of ${TUTORIAL_STEPS.length}</span><span class="coach-steps" aria-hidden="true">${steps}</span></div>
      <div class="coach-title">${s.title} <span class="coach-pips" aria-label="${t.progress} of ${s.needed} done">${pips}</span></div>
      <div class="coach-text">${this.touch ? s.touch : s.mouse}</div>
      ${hint ? `<div class="coach-hint">💡 ${hint}</div>` : ''}`;
    this.card.style.display = 'block';
  }

  /** The finish screen, with what to do next. */
  showFinish() {
    this.card.style.display = 'none';
    this.finish.innerHTML = `<div class="career-card coach-finish-card">
      <div class="coach-trophy" aria-hidden="true">🏓</div>
      <div class="cs-title">You're ready!</div>
      <p>Moving, topspin, backspin, blocking and aiming: that's the whole game. Serving comes up in a match: <b>${this.touch ? 'hold Serve' : 'hold Space'}</b> to toss, let go, then swing as it drops.</p>
      <div class="coach-actions">
        <button data-a="quick">▶ Play a quick match</button>
        <button data-a="practice" class="secondary">Keep practising</button>
        <button data-a="title" class="secondary">Back to the title</button>
      </div>
    </div>`;
    this.finish.style.display = 'flex';
    (this.finish.querySelector('button') as HTMLButtonElement | null)?.focus({ preventScroll: true });
  }
}
