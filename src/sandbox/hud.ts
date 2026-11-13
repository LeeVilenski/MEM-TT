import type { Side, SpinComponents } from '../physics';
import type { ShotInfo } from '../game/shots';
import type { StrokeSide } from '../game/swing';

export interface BounceReport {
  side: Side;
  x: number;
  z: number;
  time: number;
  speedIn: number;
  speedOut: number;
  angleOut: number;
  spinOut: SpinComponents;
  rpmOut: number;
}

export interface ShotReport {
  name: string;
  speed: number;
  rpm: number;
  spin: SpinComponents;
  spinLabel: string;
  elevation: number;
  aimOk: boolean;
  netClearance?: number;
  netTouches?: number;
  bounces: BounceReport[];
  result?: 'IN' | 'OUT' | 'FAULT';
}

export interface ReturnReport extends ShotInfo {
  paddleSpeed: number;
  wing: StrokeSide | null;
  rubber: string;
  netClearance?: number;
  result?: 'IN' | 'OUT' | 'OWN SIDE' | 'MISSED';
}

export interface PracticeStats {
  attempts: number;
  made: number;
  streak: number;
  best: number;
}

const fmt = (n: number, d = 1) => n.toFixed(d);
const kmh = (ms: number) => Math.round(ms * 3.6);
const rps = (c: SpinComponents) => `top ${fmt(c.top, 0)} · side ${fmt(c.side, 0)} · cork ${fmt(c.cork, 0)} rps`;

const INSPECT_HELP = [
  '<kbd>Space</kbd> fire',
  '<kbd>P</kbd> pause',
  '<kbd>.</kbd> step',
  '<kbd>1</kbd>–<kbd>5</kbd> cameras',
  '<kbd>C</kbd> clear marks',
  '<kbd>Shift</kbd>+click table: set target',
  'drag: orbit · wheel: zoom',
];

const MATCH_HELP = '<kbd>Space</kbd> hold/release: toss (when serving)';

const PLAY_HELP = [
  'mouse: move paddle · <b>flick</b> to swing (up = topspin, down = backspin)',
  '<kbd>LMB</kbd> hold: drive',
  '<kbd>W</kbd>/<kbd>S</kbd> close/open face',
  'wheel: base angle',
  '<kbd>A</kbd>/<kbd>D</kbd> hook left/right',
  '<kbd>Shift</kbd> FH/BH lock',
  '<kbd>←→↑↓</kbd> footwork',
  '<kbd>R</kbd> replay last rally',
  '<kbd>Esc</kbd> exit',
];

/** DOM overlay: shot readouts, practice stats, paddle indicator, flash messages and help. */
export class Hud {
  private panel: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private warnEl: HTMLDivElement;
  private help: HTMLDivElement;
  private startEl: HTMLDivElement;
  private paddleEl: HTMLDivElement;
  private statsEl: HTMLDivElement;
  private flashTimer = 0;
  private replayEl: HTMLDivElement;

  /** Replay banner (null hides it). */
  setReplay(text: string | null) {
    this.replayEl.innerHTML = text ?? '';
    this.replayEl.style.display = text ? 'block' : 'none';
  }
  private playing = false;
  onStartPlay: () => void = () => {};

  constructor(container: HTMLElement) {
    this.panel = el('div', 'hud-panel');
    this.panel.innerHTML = `<div class="hud-title">Shot readout</div><div class="hud-muted">Press <kbd>Space</kbd> to fire the ball machine, or <b>Play</b> to hit back.</div>`;
    this.flashEl = el('div', 'hud-flash');
    this.warnEl = el('div', 'hud-warn');
    this.help = el('div', 'hud-help');

    this.startEl = el('div', 'hud-start');
    this.startEl.innerHTML = `<button type="button">▶ Play vs ball machine</button><div class="hud-start-sub">Your mouse becomes the paddle. Flick to swing. <kbd>Esc</kbd> to get the cursor back.</div>`;
    this.startEl.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStartPlay();
    });

    this.replayEl = el('div', 'hud-replay');
    this.replayEl.style.display = 'none';
    container.append(this.replayEl);
    this.paddleEl = el('div', 'hud-paddle');
    this.statsEl = el('div', 'hud-stats');
    container.append(this.panel, this.flashEl, this.warnEl, this.help, this.startEl, this.paddleEl, this.statsEl);
    this.setPlaying(false);
    this.setStats({ attempts: 0, made: 0, streak: 0, best: 0 });
  }

  private matchMode = false;

  private hiddenByOverlay = false;

  /** Hide the start button and help while a full-screen overlay (the lobby) is open. */
  setOverlay(on: boolean) {
    if (this.hiddenByOverlay === on) return;
    this.hiddenByOverlay = on;
    this.setPlaying(this.playing);
  }

  setPlaying(on: boolean) {
    this.playing = on;
    this.help.style.display = this.hiddenByOverlay ? 'none' : '';
    const help = on ? (this.matchMode ? [MATCH_HELP, ...PLAY_HELP] : PLAY_HELP) : INSPECT_HELP;
    this.help.innerHTML = help.join('<span class="sep">·</span>');
    this.startEl.style.display = on || this.hiddenByOverlay ? 'none' : 'flex';
    this.paddleEl.style.display = on ? 'block' : 'none';
    this.statsEl.style.display = on && !this.matchMode ? 'block' : 'none';
  }

  /** In a match the practice readout and stats give way to the match HUD. */
  setMatchMode(on: boolean) {
    this.matchMode = on;
    this.panel.style.display = on ? 'none' : 'block';
    this.startEl.querySelector('button')!.textContent = on ? '▶ Resume match' : '▶ Play vs ball machine';
    this.setAimWarning(null);
    this.setPlaying(this.playing);
  }

  setAimWarning(msg: string | null) {
    this.warnEl.textContent = msg ?? '';
    this.warnEl.style.display = msg && !this.playing ? 'block' : 'none';
  }

  flash(title: string, sub: string) {
    this.flashEl.innerHTML = `<div class="flash-title">${title}</div><div class="flash-sub">${sub}</div>`;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth; // restart the CSS animation
    this.flashEl.classList.add('show');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flashEl.classList.remove('show'), 1400);
  }

  setPaddle(pitch: number, wing: StrokeSide, locked: boolean, drive: boolean) {
    const p = Math.round(pitch);
    const face = p === 0 ? 'square' : p > 0 ? `${p}° open` : `${-p}° closed`;
    this.paddleEl.innerHTML = `<span class="wing ${wing}">${wing === 'forehand' ? 'FH' : 'BH'}${locked ? ' 🔒' : ''}</span> Face <b>${face}</b>${drive ? ' <span class="drive">DRIVE</span>' : ''}`;
  }

  setStats(s: PracticeStats) {
    const pct = s.attempts ? Math.round((100 * s.made) / s.attempts) : 0;
    this.statsEl.innerHTML = `<b>${s.made}</b>/${s.attempts} returns in (${pct}%) · streak <b>${s.streak}</b> · best <b>${s.best}</b>`;
  }

  /**
   * @param ret undefined: no return section (inspect mode); null: waiting for the player's return.
   */
  showShot(r: ShotReport, ret?: ReturnReport | null) {
    const rows: string[] = [];
    const row = (k: string, v: string) => rows.push(`<div class="hud-row"><span>${k}</span><b>${v}</b></div>`);
    rows.push(`<div class="hud-title">${ret === undefined ? '' : 'Incoming: '}${r.name}${r.aimOk ? '' : ' <span class="hud-bad">(target unreachable)</span>'}</div>`);
    row('Launch', `${fmt(r.speed)} m/s (${kmh(r.speed)} km/h) @ ${fmt(r.elevation)}°`);
    row('Spin', `${Math.round(r.rpm).toLocaleString()} rpm`);
    rows.push(`<div class="hud-sub">${r.spinLabel} — ${rps(r.spin)}</div>`);
    if (r.netClearance !== undefined) row('Net clearance', `${fmt(r.netClearance * 100)} cm`);
    if (r.netTouches) row('Net', `touched ×${r.netTouches}`);

    // In play mode keep the incoming section short; the return matters more.
    const bounces = ret === undefined ? r.bounces.slice(0, 3) : r.bounces.slice(0, 1);
    bounces.forEach((b, i) => {
      rows.push(`<div class="hud-section">Bounce ${i + 1} · ${b.side} side · ${fmt(b.time, 2)} s</div>`);
      row('Speed in → out', `${fmt(b.speedIn)} → ${fmt(b.speedOut)} m/s`);
      row('Kick angle', `${fmt(b.angleOut, 0)}° up`);
      row('Spin after', `${Math.round(b.rpmOut).toLocaleString()} rpm`);
      rows.push(`<div class="hud-sub">${rps(b.spinOut)}</div>`);
    });

    if (ret === undefined) {
      if (r.result) rows.push(`<div class="hud-result ${r.result.toLowerCase()}">${r.result === 'IN' ? 'IN' : r.result === 'OUT' ? 'OUT · 404' : 'FAULT'}</div>`);
    } else if (ret === null) {
      rows.push(`<div class="hud-section">Your return</div><div class="hud-muted">Waiting… move the paddle to the ring and flick.</div>`);
    } else {
      rows.push(`<div class="hud-section ret">Your return: <span class="shot-name">${ret.name}</span></div>`);
      if (ret.result !== 'MISSED') {
        row('Ball speed', `${fmt(ret.speed)} m/s (${kmh(ret.speed)} km/h)`);
        row('Spin', `${Math.round(ret.rpm).toLocaleString()} rpm`);
        rows.push(`<div class="hud-sub">${rps({ top: ret.top, side: ret.side, cork: ret.cork })}</div>`);
        row('Paddle speed', `${fmt(ret.paddleSpeed)} m/s`);
        row('Launch angle', `${fmt(ret.elevation, 0)}°`);
        if (ret.netClearance !== undefined) row('Net clearance', `${fmt(ret.netClearance * 100)} cm`);
        row('Wing / rubber', `${ret.wing === 'forehand' ? 'FH' : 'BH'} · ${ret.rubber}`);
      }
      if (ret.result) {
        const cls = ret.result === 'IN' ? 'in' : 'out';
        rows.push(`<div class="hud-result ${cls}">${ret.result === 'IN' ? 'IN ✓' : ret.result}</div>`);
      }
    }
    this.panel.innerHTML = rows.join('');
  }
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}

// ---------------------------------------------------------------- match HUD

export interface ScoreView {
  you: string;
  them: string;
  points: [number, number];
  games: [number, number];
  /** True if you serve next / are serving. */
  youServe: boolean;
  badge: string | null;
  bestOf: number;
}

export interface ShotLine {
  who: string;
  name: string;
  speed: number;
  rpm: number;
  top: number;
}

/** Scoreboard, serve prompt, toss meter, compact shot log and match-over screen. */
export class MatchHud {
  private board: HTMLDivElement;
  private prompt: HTMLDivElement;
  private meter: HTMLDivElement;
  private meterFill: HTMLDivElement;
  private shots: HTMLDivElement;
  private over: HTMLDivElement;
  private shotLog: ShotLine[] = [];
  onRematch: () => void = () => {};
  onExit: () => void = () => {};

  constructor(container: HTMLElement) {
    this.board = el('div', 'mhud-board');
    this.prompt = el('div', 'mhud-prompt');
    this.meter = el('div', 'mhud-meter');
    this.meterFill = el('div', 'mhud-meter-fill');
    this.meter.append(this.meterFill);
    this.shots = el('div', 'mhud-shots');
    this.over = el('div', 'mhud-over');
    container.append(this.board, this.prompt, this.meter, this.shots, this.over);
    this.show(false);
  }

  show(on: boolean) {
    for (const e of [this.board, this.shots]) e.style.display = on ? 'block' : 'none';
    if (!on) {
      this.prompt.style.display = 'none';
      this.meter.style.display = 'none';
      this.over.style.display = 'none';
      this.shotLog = [];
      this.shots.innerHTML = '';
    }
  }

  setScore(s: ScoreView) {
    const serve = (mine: boolean) => (mine ? '<span class="serve-dot" title="Serving"></span>' : '<span class="serve-dot off"></span>');
    this.board.innerHTML = `
      <div class="mrow">${serve(s.youServe)}<span class="mname">${s.you}</span><span class="mgames">${s.games[0]}</span><span class="mpts">${s.points[0]}</span></div>
      <div class="mrow">${serve(!s.youServe)}<span class="mname">${s.them}</span><span class="mgames">${s.games[1]}</span><span class="mpts">${s.points[1]}</span></div>
      <div class="mfoot">Best of ${s.bestOf}${s.badge ? ` · <b>${s.badge}</b>` : ''}</div>`;
  }

  setPrompt(html: string | null) {
    this.prompt.innerHTML = html ?? '';
    this.prompt.style.display = html ? 'block' : 'none';
  }

  /** Toss meter while holding Space: 0–1, null hides it. */
  setMeter(v: number | null) {
    this.meter.style.display = v === null ? 'none' : 'block';
    if (v !== null) this.meterFill.style.width = `${Math.round(Math.min(1, v) * 100)}%`;
  }

  addShot(line: ShotLine) {
    this.shotLog.unshift(line);
    this.shotLog = this.shotLog.slice(0, 4);
    this.shots.innerHTML = this.shotLog
      .map(
        (l, i) =>
          `<div class="mshot${i === 0 ? ' latest' : ''}"><span class="who">${l.who}</span> <b>${l.name}</b> <span class="num">${l.speed.toFixed(1)} m/s · ${Math.round(l.rpm).toLocaleString()} rpm ${l.top >= 0 ? 'top' : 'back'}</span></div>`,
      )
      .join('');
  }

  clearShots() {
    this.shotLog = [];
    this.shots.innerHTML = '';
  }

  private overKey = '';

  showOver(title: string, sub: string, games: string, rematch: string | null = 'Rematch', exit = 'Back to practice') {
    // Called every frame while the match is over: only rebuild when something changed.
    const key = [title, sub, games, rematch, exit].join('|');
    if (this.overKey === key && this.over.style.display === 'flex') return;
    this.overKey = key;
    this.over.innerHTML = `<div class="mover-card"><div class="mover-title">${title}</div><div class="mover-sub">${sub}</div><div class="mover-games">${games}</div>
      <div class="mover-buttons">${rematch ? `<button type="button" data-a="rematch">${rematch}</button>` : ''}<button type="button" data-a="exit" class="secondary">${exit}</button></div></div>`;
    this.over.style.display = 'flex';
    this.over.querySelector('[data-a=rematch]')?.addEventListener('click', () => this.onRematch());
    this.over.querySelector('[data-a=exit]')!.addEventListener('click', () => this.onExit());
  }

  hideOver() {
    this.over.style.display = 'none';
    this.overKey = '';
  }
}
