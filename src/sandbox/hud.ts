import type { Side, SpinComponents } from '../physics';

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

const fmt = (n: number, d = 1) => n.toFixed(d);
const kmh = (ms: number) => Math.round(ms * 3.6);
const rps = (c: SpinComponents) => `top ${fmt(c.top, 0)} · side ${fmt(c.side, 0)} · cork ${fmt(c.cork, 0)} rps`;

/** DOM overlay: the shot readout panel, flash messages and help text. */
export class Hud {
  private panel: HTMLDivElement;
  private flashEl: HTMLDivElement;
  private warnEl: HTMLDivElement;
  private flashTimer = 0;

  constructor(container: HTMLElement) {
    this.panel = el('div', 'hud-panel');
    this.panel.innerHTML = `<div class="hud-title">Shot readout</div><div class="hud-muted">Press <kbd>Space</kbd> to fire the ball machine.</div>`;
    this.flashEl = el('div', 'hud-flash');
    this.warnEl = el('div', 'hud-warn');
    const help = el('div', 'hud-help');
    help.innerHTML = [
      '<kbd>Space</kbd> fire',
      '<kbd>P</kbd> pause',
      '<kbd>.</kbd> step',
      '<kbd>1</kbd>–<kbd>5</kbd> cameras',
      '<kbd>C</kbd> clear marks',
      '<kbd>Shift</kbd>+click table: set target',
      'drag: orbit · wheel: zoom',
    ].join('<span class="sep">·</span>');
    container.append(this.panel, this.flashEl, this.warnEl, help);
  }

  setAimWarning(msg: string | null) {
    this.warnEl.textContent = msg ?? '';
    this.warnEl.style.display = msg ? 'block' : 'none';
  }

  flash(title: string, sub: string) {
    this.flashEl.innerHTML = `<div class="flash-title">${title}</div><div class="flash-sub">${sub}</div>`;
    this.flashEl.classList.remove('show');
    void this.flashEl.offsetWidth; // restart the CSS animation
    this.flashEl.classList.add('show');
    window.clearTimeout(this.flashTimer);
    this.flashTimer = window.setTimeout(() => this.flashEl.classList.remove('show'), 1400);
  }

  showShot(r: ShotReport) {
    const rows: string[] = [];
    const row = (k: string, v: string) => rows.push(`<div class="hud-row"><span>${k}</span><b>${v}</b></div>`);
    row('Launch', `${fmt(r.speed)} m/s (${kmh(r.speed)} km/h) @ ${fmt(r.elevation)}°`);
    row('Spin', `${Math.round(r.rpm).toLocaleString()} rpm`);
    rows.push(`<div class="hud-sub">${r.spinLabel} — ${rps(r.spin)}</div>`);
    if (r.netClearance !== undefined) row('Net clearance', `${fmt(r.netClearance * 100)} cm`);
    if (r.netTouches) row('Net', `touched ×${r.netTouches}`);
    r.bounces.slice(0, 3).forEach((b, i) => {
      rows.push(`<div class="hud-section">Bounce ${i + 1} · ${b.side} side · ${fmt(b.time, 2)} s</div>`);
      row('Speed in → out', `${fmt(b.speedIn)} → ${fmt(b.speedOut)} m/s`);
      row('Kick angle', `${fmt(b.angleOut, 0)}° up`);
      row('Spin after', `${Math.round(b.rpmOut).toLocaleString()} rpm`);
      rows.push(`<div class="hud-sub">${rps(b.spinOut)}</div>`);
    });
    const result = r.result
      ? `<div class="hud-result ${r.result.toLowerCase()}">${r.result === 'IN' ? 'IN' : r.result === 'OUT' ? 'OUT · 404' : 'FAULT'}</div>`
      : '';
    this.panel.innerHTML = `<div class="hud-title">${r.name}${r.aimOk ? '' : ' <span class="hud-bad">(target unreachable)</span>'}</div>${rows.join('')}${result}`;
  }
}

function el(tag: string, cls: string) {
  const e = document.createElement(tag) as HTMLDivElement;
  e.className = cls;
  return e;
}
