/**
 * Touch controls for phones and tablets.
 *
 *  - One finger anywhere outside the buttons moves the paddle (like the mouse);
 *    a fast swipe is a stroke — swipe up for topspin, down for backspin.
 *  - Hold-buttons on the left: Close / Open face, Hook ← / →, Drive, Smash.
 *  - Serve (hold to toss, release to throw), Replay, and Menu (leave play mode).
 *
 * The swing finger's movement is reported as mouse-equivalent pixels, so the same
 * swing model handles mouse and touch.
 */

export interface TouchButtons {
  close: boolean;
  open: boolean;
  hookLeft: boolean;
  hookRight: boolean;
  drive: boolean;
  smash: boolean;
}

/** Converts finger movement (CSS px) into mouse-equivalent px. Pure, for tests. */
export class SwipeTracker {
  private id: number | null = null;
  private x = 0;
  private y = 0;
  private dx = 0;
  private dy = 0;

  constructor(public scale = 1.8) {}

  get active() {
    return this.id !== null;
  }

  start(id: number, x: number, y: number) {
    if (this.id !== null) return false;
    this.id = id;
    this.x = x;
    this.y = y;
    return true;
  }

  move(id: number, x: number, y: number) {
    if (id !== this.id) return;
    this.dx += (x - this.x) * this.scale;
    this.dy += (y - this.y) * this.scale;
    this.x = x;
    this.y = y;
  }

  end(id: number) {
    if (id === this.id) this.id = null;
  }

  /** Movement since the last call. */
  consume(): { dx: number; dy: number } {
    const d = { dx: this.dx, dy: this.dy };
    this.dx = this.dy = 0;
    return d;
  }
}

type ButtonId = keyof TouchButtons | 'serve' | 'replay' | 'menu';

const LAYOUT: { id: ButtonId; label: string; cls: string }[] = [
  { id: 'close', label: 'Close<br><small>face</small>', cls: 'tb-face tb-close' },
  { id: 'open', label: 'Open<br><small>face</small>', cls: 'tb-face tb-open' },
  { id: 'hookLeft', label: '↶<br><small>hook</small>', cls: 'tb-hook tb-hl' },
  { id: 'hookRight', label: '↷<br><small>hook</small>', cls: 'tb-hook tb-hr' },
  { id: 'drive', label: 'Drive', cls: 'tb-drive' },
  { id: 'smash', label: 'Smash', cls: 'tb-smash' },
  { id: 'serve', label: 'Serve<br><small>hold</small>', cls: 'tb-serve' },
  { id: 'replay', label: '⟲', cls: 'tb-replay' },
  { id: 'menu', label: '☰', cls: 'tb-menu' },
];

export class TouchControls {
  readonly buttons: TouchButtons = { close: false, open: false, hookLeft: false, hookRight: false, drive: false, smash: false };
  readonly swipe = new SwipeTracker();
  private el: HTMLDivElement;
  private btnEls = new Map<ButtonId, HTMLElement>();
  /** Which touch is holding which button. */
  private held = new Map<number, ButtonId>();
  onServeStart = () => {};
  onServeEnd = () => {};
  onReplay = () => {};
  onMenu = () => {};

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'touch-ui';
    this.el.style.display = 'none';
    for (const b of LAYOUT) {
      const e = document.createElement('div');
      e.className = `tb ${b.cls}`;
      e.innerHTML = b.label;
      e.dataset.id = b.id;
      this.el.append(e);
      this.btnEls.set(b.id, e);
    }
    container.append(this.el);
    const opts = { passive: false } as const;
    container.addEventListener('touchstart', (e) => this.onStart(e), opts);
    container.addEventListener('touchmove', (e) => this.onMove(e), opts);
    container.addEventListener('touchend', (e) => this.onEnd(e), opts);
    container.addEventListener('touchcancel', (e) => this.onEnd(e), opts);
  }

  private enabled = false;

  show(on: boolean) {
    this.enabled = on;
    this.el.style.display = on ? 'block' : 'none';
    if (!on) this.reset();
  }

  /** Show the Serve button only when it's your serve. */
  setServeVisible(on: boolean) {
    this.btnEls.get('serve')!.style.display = on ? 'flex' : 'none';
  }

  private reset() {
    for (const k of Object.keys(this.buttons) as (keyof TouchButtons)[]) this.buttons[k] = false;
    this.held.clear();
    this.btnEls.forEach((e) => e.classList.remove('down'));
  }

  private buttonAt(t: Touch): ButtonId | null {
    const target = document.elementFromPoint(t.clientX, t.clientY) as HTMLElement | null;
    const b = target?.closest('.tb') as HTMLElement | null;
    return b && this.el.contains(b) ? (b.dataset.id as ButtonId) : null;
  }

  private onStart(e: TouchEvent) {
    if (!this.enabled) return;
    // Let the settings panel and other UI handle their own touches.
    if ((e.target as HTMLElement).closest('.lil-gui, .lobby, .mhud-over, .hud-start, .mhud-serves, .hud-replay')) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const id = this.buttonAt(t);
      if (id) {
        this.held.set(t.identifier, id);
        this.btnEls.get(id)!.classList.add('down');
        if (id in this.buttons) this.buttons[id as keyof TouchButtons] = true;
        if (id === 'serve') this.onServeStart();
        if (id === 'replay') this.onReplay();
        if (id === 'menu') this.onMenu();
      } else {
        this.swipe.start(t.identifier, t.clientX, t.clientY);
      }
    }
  }

  private onMove(e: TouchEvent) {
    if (!this.enabled) return;
    if ((e.target as HTMLElement).closest('.lil-gui, .lobby, .mhud-over, .mhud-serves, .hud-replay')) return;
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) this.swipe.move(t.identifier, t.clientX, t.clientY);
  }

  private onEnd(e: TouchEvent) {
    if (!this.enabled) return;
    for (const t of Array.from(e.changedTouches)) {
      const id = this.held.get(t.identifier);
      if (id) {
        this.held.delete(t.identifier);
        this.btnEls.get(id)!.classList.remove('down');
        if (id in this.buttons) this.buttons[id as keyof TouchButtons] = false;
        if (id === 'serve') this.onServeEnd();
      }
      this.swipe.end(t.identifier);
    }
  }
}

/** Is this primarily a touch device? */
export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches || 'ontouchstart' in window);
}
