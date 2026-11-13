import { AI_LEVELS, type AiLevel } from '../game/ai';
import { realismLabel } from '../game/realism';
import { STYLES, STYLE_IDS, type StyleId } from '../game/styles';
import type { OnlineClient } from '../net/client';
import { seatsFor, type GameMode, type Seat } from '../net/protocol';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const SEAT_LABEL: Record<Seat, string> = { near1: 'Player 1', near2: 'Player 2', far1: 'Player 1', far2: 'Player 2' };

/** Room lobby overlay: code + invite link, seats, host controls, start/leave. */
export class Lobby {
  private el: HTMLDivElement;
  private client: OnlineClient | null = null;
  private error = '';
  fillAI = true;
  onStart: () => void = () => {};
  onLeave: () => void = () => {};

  constructor(container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'lobby';
    this.el.style.display = 'none';
    container.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('change', (e) => this.onChange(e));
  }

  show(client: OnlineClient | null) {
    this.client = client;
    this.el.style.display = client ? 'flex' : 'none';
    this.render();
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  setError(msg: string) {
    this.error = msg;
    this.render();
  }

  render() {
    const c = this.client;
    if (!c) return;
    const room = c.room;
    if (!room) {
      this.el.innerHTML = `<div class="lobby-card"><div class="lobby-title">Connecting…</div>${this.error ? `<div class="lobby-error">${esc(this.error)}</div>` : ''}<div class="lobby-actions"><button data-a="leave" class="secondary">Cancel</button></div></div>`;
      return;
    }
    const host = c.isHost;
    const seatCard = (seat: Seat) => {
      const info = room.seats[seat];
      const mine = info?.clientId === c.you;
      const body = info
        ? `<span class="seat-name">${esc(info.name)}${mine ? ' <i>(you)</i>' : ''}</span>${info.ai ? '<span class="seat-tag">AI</span>' : ''}${info.style && !info.ai ? `<span class="seat-style">${STYLES[info.style]?.character ?? ''}</span>` : ''}${mine && room.phase !== 'playing' ? '<button data-a="stand" class="link">Stand up</button>' : ''}`
        : room.phase !== 'playing'
          ? `<button data-a="sit" data-seat="${seat}">Sit here</button><span class="seat-empty">${host && this.fillAI ? 'AI will play' : 'Empty'}</span>`
          : '<span class="seat-empty">Empty</span>';
      return `<div class="seat${mine ? ' mine' : ''}"><span class="seat-label">${SEAT_LABEL[seat]}</span>${body}</div>`;
    };
    const seats = seatsFor(room.mode);
    const nearSeats = seats.filter((s) => s.startsWith('near'));
    const farSeats = seats.filter((s) => s.startsWith('far'));
    const link = `${location.origin}${location.pathname}?room=${room.code}`;
    const opts = <T extends string | number>(cur: T, list: [T, string][]) => list.map(([v, l]) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`).join('');

    const controls = host
      ? `<div class="lobby-controls">
          <label>Mode <select data-c="mode">${opts<GameMode>(room.mode, [['singles', 'Singles (1v1)'], ['doubles', 'Doubles (2v2)']])}</select></label>
          <label>Format <select data-c="bestOf">${opts(room.bestOf, [[1, 'Best of 1'], [3, 'Best of 3'], [5, 'Best of 5'], [7, 'Best of 7']])}</select></label>
          <label>AI level <select data-c="aiLevel">${opts<AiLevel>(room.aiLevel, Object.entries(AI_LEVELS).map(([k, v]) => [k as AiLevel, v.name]))}</select></label>
          <label>AI style <select data-c="aiStyle">${opts<StyleId | 'random'>(room.aiStyle, [['random', 'Random'], ...STYLE_IDS.map((id) => [id, STYLES[id].character] as [StyleId, string])])}</select></label>
          <label class="realism">Realism <input type="range" min="0" max="100" step="5" value="${Math.round(room.realism * 100)}" data-c="realism"/> <span>${realismLabel(room.realism)}</span></label>
          <label class="check"><input type="checkbox" data-c="fill"${this.fillAI ? ' checked' : ''}/> Fill empty seats with AI</label>
        </div>`
      : `<div class="lobby-wait">${room.mode === 'doubles' ? 'Doubles' : 'Singles'} · best of ${room.bestOf} · realism ${realismLabel(room.realism)} — waiting for the host to start…</div>`;

    this.el.innerHTML = `<div class="lobby-card">
      <div class="lobby-head">
        <div><div class="lobby-sub">Room code</div><div class="lobby-code">${room.code}</div></div>
        <div class="lobby-share"><button data-a="copy" data-link="${esc(link)}" class="secondary">Copy invite link</button><div class="lobby-sub">${c.rtt ? `ping ${Math.round(c.rtt * 1000)} ms` : ''}</div></div>
      </div>
      <div class="lobby-sides">
        <div class="side"><div class="side-title">Near end</div>${nearSeats.map(seatCard).join('')}</div>
        <div class="side"><div class="side-title">Far end</div>${farSeats.map(seatCard).join('')}</div>
      </div>
      ${room.spectators.length ? `<div class="lobby-sub">Watching: ${room.spectators.map((s) => esc(s.name)).join(', ')}</div>` : ''}
      ${controls}
      ${this.error ? `<div class="lobby-error">${esc(this.error)}</div>` : ''}
      <div class="lobby-actions">
        ${host ? `<button data-a="start">${room.phase === 'over' ? 'Rematch' : 'Start match'}</button>` : ''}
        <button data-a="leave" class="secondary">Leave room</button>
      </div>
    </div>`;
  }

  private onClick(e: Event) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || !this.client) return;
    switch (t.dataset.a) {
      case 'sit':
        this.client.sit(t.dataset.seat as Seat);
        break;
      case 'stand':
        this.client.sit(null);
        break;
      case 'start':
        this.error = '';
        this.onStart();
        break;
      case 'leave':
        this.onLeave();
        break;
      case 'copy':
        void navigator.clipboard?.writeText(t.dataset.link!);
        t.textContent = 'Copied!';
        break;
    }
  }

  private onChange(e: Event) {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (!this.client) return;
    switch (t.dataset.c) {
      case 'mode':
        this.client.configure({ mode: t.value as GameMode });
        break;
      case 'bestOf':
        this.client.configure({ bestOf: Number(t.value) });
        break;
      case 'aiLevel':
        this.client.configure({ aiLevel: t.value as AiLevel });
        break;
      case 'aiStyle':
        this.client.configure({ aiStyle: t.value as StyleId | 'random' });
        break;
      case 'realism':
        this.client.configure({ realism: Number(t.value) / 100 });
        break;
      case 'fill':
        this.fillAI = (t as HTMLInputElement).checked;
        this.render();
        break;
    }
  }
}
