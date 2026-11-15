import type { Side, SpinComponents } from '../physics';
import type { ShotInfo } from '../game/shots';
import type { StrokeSide } from '../game/swing';
import { TOSS_ILLEGAL_FRACTION } from '../game/serves';

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
  '<kbd>RMB</kbd> hold: smash (high balls)',
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

  private fpsEl: HTMLDivElement | null = null;

  setFps(text: string | null) {
    if (!text) {
      if (this.fpsEl) this.fpsEl.style.display = 'none';
      return;
    }
    if (!this.fpsEl) {
      this.fpsEl = el('div', 'hud-fps');
      this.replayEl.parentElement!.append(this.fpsEl);
    }
    this.fpsEl.style.display = 'block';
    this.fpsEl.textContent = text;
  }

  onReplaySpeed: (speed: number) => void = () => {};
  onReplaySkip: () => void = () => {};
  private replayCaption: HTMLDivElement | null = null;
  private replaySlider: HTMLInputElement | null = null;
  private replaySpeedLabel: HTMLSpanElement | null = null;

  /** Replay bar at the bottom of the screen (null hides it). */
  setReplay(info: { caption: string; speed: number } | null) {
    if (!info) {
      this.replayEl.style.display = 'none';
      return;
    }
    if (!this.replayCaption) {
      this.replayCaption = el('div', 'hud-replay-caption');
      const row = el('div', 'hud-replay-row');
      const slider = document.createElement('input');
      slider.type = 'range';
      slider.min = '0.05';
      slider.max = '1';
      slider.step = '0.05';
      slider.setAttribute('aria-label', 'Replay speed');
      for (const ev of ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'mousedown']) slider.addEventListener(ev, (e) => e.stopPropagation());
      slider.addEventListener('input', () => this.onReplaySpeed(Number(slider.value)));
      const label = document.createElement('span');
      label.className = 'hud-replay-speed';
      const skip = document.createElement('button');
      skip.type = 'button';
      skip.className = 'skip';
      skip.textContent = 'Skip ⏭';
      skip.title = 'Skip replay (R)';
      skip.addEventListener('pointerdown', (e) => {
        e.stopPropagation();
        this.onReplaySkip();
      });
      row.append(slider, label, skip);
      this.replayEl.append(this.replayCaption, row);
      this.replaySlider = slider;
      this.replaySpeedLabel = label;
    }
    const text = `▶ REPLAY · ${info.caption}`;
    if (this.replayCaption.textContent !== text) this.replayCaption.textContent = text;
    if (document.activeElement !== this.replaySlider) this.replaySlider!.value = String(info.speed);
    this.replaySpeedLabel!.textContent = `×${info.speed.toFixed(2)}`;
    this.replayEl.style.display = 'flex';
  }
  private playing = false;
  onStartPlay: () => void = () => {};
  onCareer: () => void = () => {};
  onHowTo: () => void = () => {};
  private toastsEl: HTMLDivElement | null = null;

  /** Small stacked notification (XP, unlocks, achievements). */
  toast(html: string) {
    if (!this.toastsEl) {
      this.toastsEl = el('div', 'hud-toasts');
      this.panel.parentElement!.append(this.toastsEl);
    }
    const t = el('div', 'hud-toast');
    t.innerHTML = html;
    this.toastsEl.append(t);
    setTimeout(() => t.remove(), 3300);
    while (this.toastsEl.children.length > 4) this.toastsEl.firstChild!.remove();
  }

  /** Replace the practice stats line (used by drills). */
  setStatsText(html: string) {
    this.statsEl.innerHTML = html;
  }

  constructor(container: HTMLElement) {
    this.panel = el('div', 'hud-panel');
    this.panel.innerHTML = `<div class="hud-title">Shot readout</div><div class="hud-muted">Press <kbd>Space</kbd> to fire the ball machine, or <b>Play</b> to hit back.</div>`;
    this.flashEl = el('div', 'hud-flash');
    this.warnEl = el('div', 'hud-warn');
    this.help = el('div', 'hud-help');

    this.startEl = el('div', 'hud-start');
    const touch = document.body.classList.contains('touch') || window.matchMedia?.('(pointer: coarse)').matches;
    this.startEl.innerHTML = touch
      ? `<button type="button">▶ Play vs ball machine</button><div class="hud-start-sub">Drag to move the paddle, <b>swipe</b> to swing (up = topspin, down = backspin). ☰ to leave.</div>`
      : `<button type="button">▶ Play vs ball machine</button><div class="hud-start-sub">Your mouse becomes the paddle. Flick to swing. <kbd>Esc</kbd> to get the cursor back.</div>`;
    const careerLink = document.createElement('div');
    careerLink.className = 'hud-career';
    careerLink.textContent = '📈 Career, training drills & tournaments';
    careerLink.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onCareer();
    });
    const howLink = document.createElement('div');
    howLink.className = 'hud-career';
    howLink.textContent = '❓ How to play';
    howLink.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onHowTo();
    });
    this.startEl.append(careerLink, howLink);
    this.startEl.querySelector('button')!.addEventListener('click', (e) => {
      e.stopPropagation();
      this.onStartPlay();
    });

    this.replayEl = el('div', 'hud-replay');
    this.replayEl.style.display = 'none';
    container.append(this.replayEl);
    this.paddleEl = el('div', 'hud-paddle');
    this.statsEl = el('div', 'hud-stats');
    this.perfectEl = el('div', 'hud-perfect');
    this.perfectEl.textContent = 'PERFECT';
    container.append(this.perfectEl);
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

  /** Show the shot readout while playing (off by default: it's distracting mid-rally). */
  showDetails = false;

  setPlaying(on: boolean) {
    this.playing = on;
    this.panel.style.display = this.matchMode || (on && !this.showDetails) ? 'none' : 'block';
    this.help.style.display = this.hiddenByOverlay ? 'none' : '';
    // In play, a single quiet line; the full list is in How to play (and expands on hover/H).
    const help = on ? (this.matchMode ? [MATCH_HELP, ...PLAY_HELP] : PLAY_HELP) : INSPECT_HELP;
    this.help.innerHTML = on
      ? `<span class="help-short"><kbd>H</kbd> controls<span class="sep">·</span><kbd>Esc</kbd> pause</span><span class="help-full">${help.join('<span class="sep">·</span>')}</span>`
      : help.join('<span class="sep">·</span>');
    this.help.classList.toggle('compact', on);
    this.startEl.style.display = on || this.hiddenByOverlay ? 'none' : 'flex';
    this.paddleEl.style.display = on ? 'block' : 'none';
    this.statsEl.style.display = on && !this.matchMode ? 'block' : 'none';
  }

  /** In a match the practice readout and stats give way to the match HUD. */
  /** Show or hide the full controls list during play (H). */
  toggleHelp() {
    this.help.classList.toggle('expanded');
  }

  setMatchMode(on: boolean) {
    this.matchMode = on;
    this.startEl.querySelector('button')!.textContent = on ? '▶ Resume match' : '▶ Play vs ball machine';
    this.setAimWarning(null);
    this.setPlaying(this.playing);
  }

  setAimWarning(msg: string | null) {
    this.warnEl.textContent = msg ?? '';
    this.warnEl.style.display = msg && !this.playing ? 'block' : 'none';
  }

  /** Keep a title card on screen until hold(null) (e.g. drill instructions before the first ball). */
  hold(title: string | null, sub = '', go = '') {
    window.clearTimeout(this.flashTimer);
    this.flashEl.classList.remove('show');
    this.flashEl.classList.toggle('hold', !!title);
    if (title) this.flashEl.innerHTML = `<div class="flash-title">${title}</div><div class="flash-sub">${sub}</div>${go ? `<div class="flash-go">${go}</div>` : ''}`;
  }

  flash(title: string, sub: string) {
    this.flashEl.classList.remove('hold');
    this.flashEl.innerHTML = `<div class="flash-title">${title}</div><div class="flash-sub">${sub}</div>`;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth; // restart the CSS animation
    this.flashEl.classList.add('show');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flashEl.classList.remove('show'), 1400);
  }

  private perfectEl: HTMLDivElement;

  /** A small gold "PERFECT" pop for a perfectly timed stroke. */
  perfect() {
    this.grade('PERFECT', 'gold');
  }

  /** A contact-grade pop: gold PERFECT, or a red EARLY / EDGE / OVERHIT. */
  grade(text: string, tone: 'gold' | 'good' | 'bad') {
    this.perfectEl.textContent = text;
    this.perfectEl.dataset.tone = tone;
    this.perfectEl.classList.remove('show');
    void this.perfectEl.offsetWidth; // restart the CSS animation
    this.perfectEl.classList.add('show');
  }

  private speedEl: HTMLDivElement | null = null;

  /** A speed call-out for a fast shot ("92 km/h"). */
  speedPop(kmh: number, mine: boolean) {
    if (!this.speedEl) {
      this.speedEl = el('div', 'hud-speed');
      this.perfectEl.parentElement!.append(this.speedEl);
    }
    this.speedEl.textContent = `${Math.round(kmh)} km/h`;
    this.speedEl.classList.toggle('theirs', !mine);
    this.speedEl.classList.remove('show');
    void this.speedEl.offsetWidth;
    this.speedEl.classList.add('show');
  }

  setPaddle(pitch: number, wing: StrokeSide, locked: boolean, drive: boolean, smash = false) {
    const p = Math.round(pitch);
    const face = p === 0 ? 'square' : p > 0 ? `${p}° open` : `${-p}° closed`;
    this.paddleEl.innerHTML = `<span class="wing ${wing}">${wing === 'forehand' ? 'FH' : 'BH'}${locked ? ' 🔒' : ''}</span> Face <b>${face}</b>${smash ? ' <span class="drive smash">SMASH</span>' : drive ? ' <span class="drive">DRIVE</span>' : ''}`;
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
    this.serveBar = el('div', 'mhud-serves');
    this.serveBar.setAttribute('role', 'radiogroup');
    this.serveBar.setAttribute('aria-label', 'Serve type');
    this.serveBar.style.display = 'none';
    this.serveBar.addEventListener('click', (e) => {
      const id = (e.target as HTMLElement).closest('button')?.dataset.serve;
      if (id) this.onServeType(id);
    });
    container.append(this.board, this.prompt, this.meter, this.shots, this.over, this.serveBar);
    this.show(false);
  }

  private serveBar: HTMLDivElement;
  private serveKey = '';
  onServeType: (id: string) => void = () => {};

  /** The serve-type chooser, shown while it's your serve (null hides it). */
  setServeBar(types: { id: string; name: string }[] | null, selected = '', keys = true) {
    if (!types) {
      this.serveBar.style.display = 'none';
      this.serveKey = '';
      return;
    }
    const key = selected + keys;
    if (key !== this.serveKey) {
      this.serveKey = key;
      this.serveBar.innerHTML = types
        .map((t, i) => `<button type="button" role="radio" aria-checked="${t.id === selected}" class="${t.id === selected ? 'on' : ''}" data-serve="${t.id}">${keys ? `<kbd>${i + 1}</kbd>` : ''}${t.name}</button>`)
        .join('');
    }
    this.serveBar.style.display = 'flex';
  }

  /** Show the per-shot list during matches (off by default). */
  showDetails = false;

  show(on: boolean) {
    this.board.style.display = on ? 'block' : 'none';
    this.shots.style.display = on && this.showDetails ? 'block' : 'none';
    if (!on) {
      this.serveBar.style.display = 'none';
      this.prompt.style.display = 'none';
      this.meter.style.display = 'none';
      this.over.style.display = 'none';
      this.shotLog = [];
      this.shots.innerHTML = '';
      this.setRally(0);
      this.lastPts = [-1, -1];
    }
  }

  private scoreEls: { rows: HTMLDivElement[]; names: HTMLElement[]; pts: HTMLElement[]; pips: HTMLElement[]; badge: HTMLElement } | null = null;
  private lastScore = '';
  private lastPts: [number, number] = [-1, -1];
  private rallyEl: HTMLDivElement | null = null;
  private edgeEl: HTMLDivElement | null = null;

  /** Broadcast-style scoreboard. Built once; only changed parts update, so animations play. */
  setScore(s: ScoreView) {
    if (!this.scoreEls) {
      this.board.innerHTML = `
        <div class="sb-row you"><span class="sb-serve"></span><span class="sb-name"></span><span class="sb-pips"></span><span class="sb-pts"></span></div>
        <div class="sb-row them"><span class="sb-serve"></span><span class="sb-name"></span><span class="sb-pips"></span><span class="sb-pts"></span></div>
        <div class="sb-badge"></div>`;
      const q = (c: string) => [...this.board.querySelectorAll<HTMLElement>(c)];
      this.scoreEls = { rows: q('.sb-row') as HTMLDivElement[], names: q('.sb-name'), pts: q('.sb-pts'), pips: q('.sb-pips'), badge: this.board.querySelector('.sb-badge')! };
    }
    const key = JSON.stringify(s);
    if (key === this.lastScore) return;
    this.lastScore = key;
    const e = this.scoreEls;
    const toWin = Math.ceil(s.bestOf / 2);
    [s.you, s.them].forEach((name, i) => {
      if (e.names[i].textContent !== name) e.names[i].textContent = name;
      e.rows[i].classList.toggle('serving', i === 0 ? s.youServe : !s.youServe);
      e.pips[i].innerHTML = toWin > 1 ? Array.from({ length: toWin }, (_, k) => `<i class="${k < s.games[i] ? 'on' : ''}"></i>`).join('') : '';
      const p = s.points[i];
      if (p !== this.lastPts[i]) {
        e.pts[i].textContent = String(p);
        if (this.lastPts[i] >= 0 && p > this.lastPts[i]) {
          e.pts[i].classList.remove('bump');
          void e.pts[i].offsetWidth;
          e.pts[i].classList.add('bump');
        }
      }
    });
    this.lastPts = [s.points[0], s.points[1]];
    e.badge.textContent = s.badge ?? `Best of ${s.bestOf}`;
    e.badge.classList.toggle('hot', !!s.badge);
  }

  /** Live rally length (hidden under 3 hits). */
  setRally(hits: number) {
    if (!this.rallyEl) {
      this.rallyEl = el('div', 'mhud-rally');
      this.board.parentElement!.append(this.rallyEl);
    }
    const show = hits >= 3;
    this.rallyEl.classList.toggle('show', show);
    if (show && this.rallyEl.dataset.n !== String(hits)) {
      this.rallyEl.dataset.n = String(hits);
      this.rallyEl.innerHTML = `<b>${hits}</b> hit rally`;
      this.rallyEl.classList.toggle('long', hits >= 8);
      this.rallyEl.classList.remove('tick');
      void this.rallyEl.offsetWidth;
      this.rallyEl.classList.add('tick');
    }
  }

  private cueEl: HTMLDivElement | null = null;
  private impactEl: HTMLDivElement | null = null;

  /** A short cue at the start of each point ("YOUR SERVE" / "RECEIVE"). */
  cue(text: string, mine: boolean) {
    if (!this.cueEl) {
      this.cueEl = el('div', 'mhud-cue');
      this.board.parentElement!.append(this.cueEl);
    }
    this.cueEl.textContent = text;
    this.cueEl.className = `mhud-cue${mine ? ' mine' : ''}`;
    void this.cueEl.offsetWidth;
    this.cueEl.classList.add('show');
  }

  /** A quick white pulse at the screen edges on a hard hit of yours (power 0–1). */
  impact(power: number) {
    if (!this.impactEl) {
      this.impactEl = el('div', 'mhud-impact');
      this.board.parentElement!.append(this.impactEl);
    }
    this.impactEl.style.setProperty('--p', String(0.25 + power * 0.6));
    this.impactEl.classList.remove('show');
    void this.impactEl.offsetWidth;
    this.impactEl.classList.add('show');
  }

  /** A brief glow round the screen edge: green when you win the point, red when you lose it. */
  pointGlow(mine: boolean) {
    if (!this.edgeEl) {
      this.edgeEl = el('div', 'mhud-edge');
      this.board.parentElement!.append(this.edgeEl);
    }
    this.edgeEl.className = `mhud-edge ${mine ? 'win' : 'lose'}`;
    void this.edgeEl.offsetWidth;
    this.edgeEl.classList.add('show');
  }

  setPrompt(html: string | null) {
    this.prompt.innerHTML = html ?? '';
    this.prompt.style.display = html ? 'block' : 'none';
  }

  /** Toss meter while holding Space: 0–1, null hides it. */
  setMeter(v: number | null) {
    this.meter.style.display = v === null ? 'none' : 'block';
    // The start of the meter is an illegal toss (under 16 cm).
    this.meter.style.setProperty('--illegal', `${(TOSS_ILLEGAL_FRACTION * 100).toFixed(1)}%`);
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

  showOver(title: string, sub: string, games: string, rematch: string | null = 'Rematch', exit = 'Back to practice', stats: [string, string][] = []) {
    // Called every frame while the match is over: only rebuild when something changed.
    const key = [title, sub, games, rematch, exit, JSON.stringify(stats)].join('|');
    if (this.overKey === key && this.over.style.display === 'flex') return;
    this.overKey = key;
    this.over.innerHTML = `<div class="mover-card"><div class="mover-title">${title}</div><div class="mover-sub">${sub}</div><div class="mover-games">${games}</div>${stats.length ? `<div class="mover-stats">${stats.map(([k, v]) => `<div><b>${v}</b><span>${k}</span></div>`).join('')}</div>` : ''}
      <div class="mover-buttons">${rematch ? `<button type="button" data-a="rematch">${rematch}</button>` : ''}<button type="button" data-a="exit" class="secondary">${exit}</button></div></div>`;
    this.over.style.display = 'flex';
    this.over.querySelector('[data-a=rematch]')?.addEventListener('click', () => this.onRematch());
    this.over.querySelector('[data-a=exit]')!.addEventListener('click', () => this.onExit());
  }

  get overVisible() {
    return this.over.style.display === 'flex';
  }

  hideOver() {
    this.over.style.display = 'none';
    this.overKey = '';
  }
}
