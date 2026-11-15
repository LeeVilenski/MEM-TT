import type { Career } from '../progress/profile';
import { roundLabel } from '../progress/tournament';
import { TOUR_STOPS, stopUnlocked, stopsWon, type TourRun, type TourStop } from '../progress/tour';
import { AI_LEVELS, type AiLevel } from '../game/ai';
import { STYLES, type StyleId } from '../game/styles';
import type { VenueId } from '../render/venues';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Each venue's colour and icon on the route map and the stop's hero banner. */
const VENUE_STYLE: Partial<Record<VenueId, { color: string; icon: string }>> = {
  mem: { color: '#2f7cf6', icon: '🏢' },
  office: { color: '#ef7d32', icon: '💻' },
  server: { color: '#7a5cd6', icon: '🖥️' },
  park: { color: '#3fa34d', icon: '🌳' },
  conference: { color: '#0e9aa7', icon: '📊' },
  beach: { color: '#e0a106', icon: '🏖️' },
  rooftop: { color: '#db2777', icon: '🌆' },
};
const venueStyle = (v: VenueId) => VENUE_STYLE[v] ?? { color: '#3a4a63', icon: '🏓' };

/** Opponent level colours (chips). */
const LEVEL_COLOR: Record<AiLevel, string> = { easy: '#3fa34d', medium: '#2f7cf6', hard: '#ef7d32', expert: '#dc2626' };

type StopStatus = 'won' | 'playing' | 'open' | 'locked';

/**
 * World Tour screen: a route map of the stops (MEM HQ → … → the rooftop) and, below it,
 * the selected stop: its venue, event and opponents, or (while it's being played) the
 * bracket or group table, with one clear main action.
 * The event in progress is read from the game (`getRun`), so the two never disagree.
 */
export class TourScreen {
  private el: HTMLDivElement;
  banner = '';
  /** The stop shown in the panel (null: the one in progress, else the next one to win). */
  private selected: string | null = null;
  onEnter: (id: string) => void = () => {};
  onPlay: () => void = () => {};
  onAbandon: () => void = () => {};
  onClose: () => void = () => {};

  constructor(
    container: HTMLElement,
    private career: Career,
    private getRun: () => TourRun | null,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'career tour';
    this.el.style.display = 'none';
    container.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  show(banner = '') {
    this.banner = banner;
    this.selected = null;
    this.el.style.display = 'flex';
    this.render();
    (this.el.querySelector('.tw-actions button') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hide() {
    this.el.style.display = 'none';
  }

  private status(i: number): StopStatus {
    const s = TOUR_STOPS[i];
    const p = this.career.data;
    const run = this.getRun();
    if (run && run.stop.id === s.id && run.state === 'playing') return 'playing';
    if ((p.tournaments[s.id] ?? 0) > 0) return 'won';
    return stopUnlocked(i, p.tournaments, p.unlockAll) ? 'open' : 'locked';
  }

  /** The stop to show: the selected one, else the one in progress, else the next to win. */
  private shown(): number {
    const sel = TOUR_STOPS.findIndex((s) => s.id === this.selected);
    if (sel >= 0) return sel;
    const run = this.getRun();
    if (run) return TOUR_STOPS.indexOf(run.stop);
    const next = TOUR_STOPS.findIndex((_, i) => this.status(i) === 'open');
    return next >= 0 ? next : TOUR_STOPS.length - 1;
  }

  private routeHtml(shown: number) {
    return TOUR_STOPS.map((s, i) => {
      const st = this.status(i);
      const v = venueStyle(s.venue);
      const mark = st === 'won' ? '🏆' : st === 'locked' ? '🔒' : v.icon;
      return `<button class="tw-node ${st}${i === shown ? ' on' : ''}" data-a="select" data-id="${s.id}" style="--v:${v.color}" aria-label="${esc(s.place)}: ${esc(s.name)} (${st})" aria-pressed="${i === shown}">
        <span class="tw-dot" aria-hidden="true">${mark}</span>
        <span class="tw-label">${esc(s.place)}</span>
      </button>`;
    }).join('<span class="tw-link" aria-hidden="true"></span>');
  }

  /** Who you'll face at a stop (before you enter). */
  private lineupHtml(s: TourStop) {
    const chip = (style: StyleId, level: AiLevel, label?: string) =>
      `<div class="tw-opp"><span class="tw-ava" style="--l:${LEVEL_COLOR[level]}">${esc(STYLES[style].character[0])}</span><span><b>${esc(STYLES[style].character)}</b><small>${label ? `${esc(label)} · ` : ''}${AI_LEVELS[level].name}</small></span></div>`;
    const list = s.format === 'knockout' ? s.rounds.map((r) => chip(r.style, r.level, r.name)) : s.opponents.map((o) => chip(o.style, o.level));
    return `<div class="tw-sub">${s.format === 'knockout' ? 'The draw' : 'Your group'}</div><div class="tw-opps">${list.join('')}</div>`;
  }

  /** The event being played at this stop: bracket or group table. */
  private progressHtml(run: TourRun) {
    if (run.knockout) {
      const k = run.knockout;
      return `<div class="tw-sub">The draw</div><div class="tw-bracket">${k.tournament.rounds
        .map((r, i) => {
          const res = k.results[i];
          const won = res && (i < k.round || k.state === 'won');
          const cls = res ? (won ? 'won' : 'lost') : i === k.round && k.state === 'playing' ? 'next' : '';
          const mark = res ? `${won ? '✓' : '✗'} ${res}` : cls === 'next' ? 'Next' : `Best of ${r.bestOf}`;
          return `<div class="tw-round ${cls}"><span class="tw-ava" style="--l:${LEVEL_COLOR[r.level]}">${esc(STYLES[r.style].character[0])}</span><span class="tw-rn"><b>${esc(roundLabel(r))}</b><small>${AI_LEVELS[r.level].name} · best of ${r.bestOf}</small></span><span class="tw-res">${mark}</span></div>`;
        })
        .join('')}</div>`;
    }
    const g = run.group!;
    const rows = g
      .standings()
      .map(
        (r, i) =>
          `<tr class="${r.entry.you ? 'you' : ''}${i < 2 ? ' top' : ''}"><td>${i + 1}</td><td>${esc(r.entry.name)}${r.entry.level ? ` <small>${AI_LEVELS[r.entry.level].name}</small>` : ''}</td><td>${r.played}</td><td>${r.won}</td><td>${r.gamesFor}–${r.gamesAgainst}</td></tr>`,
      )
      .join('');
    const name = (id: string) => g.entries.find((e) => e.id === id)!.name;
    const results = g.results.map((r) => `<span>${esc(name(r.a))} <b>${r.score[0]}–${r.score[1]}</b> ${esc(name(r.b))}</span>`).join('');
    const final =
      g.phase === 'final' || g.finalScore
        ? `<div class="tw-round ${g.finalScore ? (g.finalScore[0] > g.finalScore[1] ? 'won' : 'lost') : 'next'}"><span class="tw-ava" style="--l:${LEVEL_COLOR[g.finalOpponent!.level ?? 'medium']}">${esc(g.finalOpponent!.name[0])}</span><span class="tw-rn"><b>Final vs ${esc(g.finalOpponent!.name)}</b><small>Best of ${run.stop.format === 'group' ? run.stop.finalBestOf : 1}</small></span><span class="tw-res">${g.finalScore ? `${g.finalScore[0] > g.finalScore[1] ? '✓' : '✗'} ${g.finalScore[0]}–${g.finalScore[1]}` : 'Next'}</span></div>`
        : '';
    return `<div class="tw-sub">Group table <small>· top two reach the final</small></div>
      <table class="tw-table"><thead><tr><th></th><th></th><th>P</th><th>W</th><th>Games</th></tr></thead><tbody>${rows}</tbody></table>
      ${final}${results ? `<div class="tw-results">${results}</div>` : ''}`;
  }

  private stopHtml(i: number) {
    const s = TOUR_STOPS[i];
    const v = venueStyle(s.venue);
    const st = this.status(i);
    const run = this.getRun();
    const here = run && run.stop.id === s.id ? run : null;
    const wins = this.career.data.tournaments[s.id] ?? 0;
    const busyElsewhere = run && run.state === 'playing' && !here;
    const chips = [
      s.format === 'knockout' ? 'Knockout' : 'Round-robin group',
      s.format === 'knockout' ? `Final best of ${s.rounds[s.rounds.length - 1].bestOf}` : `Final best of ${s.finalBestOf}`,
      `${s.xp} XP`,
      wins ? `🏆 Won${wins > 1 ? ` ×${wins}` : ''}` : '',
    ]
      .filter(Boolean)
      .map((c) => `<span>${c}</span>`)
      .join('');

    let actions: string;
    if (here && here.state === 'playing') {
      const next = here.current!;
      actions = `<button data-a="play" class="primary">▶ Play ${esc(next.label)}</button><button data-a="abandon" class="secondary">Abandon</button>`;
    } else if (here) {
      actions = `${here.state === 'won' ? '' : `<button data-a="enter" data-id="${s.id}" class="primary">Try again</button>`}<button data-a="abandon" class="secondary">${here.state === 'won' ? 'Done' : 'Close'}</button>`;
    } else if (st === 'locked') {
      actions = `<div class="tw-locked">🔒 Win the ${esc(TOUR_STOPS[i - 1].name)} to travel here</div>`;
    } else if (busyElsewhere) {
      actions = `<div class="tw-locked">Finish the ${esc(run!.stop.name)} first</div>`;
    } else actions = `<button data-a="enter" data-id="${s.id}" class="primary">${wins ? 'Play again' : `Enter the ${esc(s.name)}`}</button>`;

    return `<section class="tw-stop" style="--v:${v.color}">
      <div class="tw-hero">
        <div class="tw-icon" aria-hidden="true">${v.icon}</div>
        <div class="tw-hero-text"><div class="tw-place">Stop ${i + 1} · ${esc(s.place)}</div><h3>${esc(s.name)}</h3><div class="tw-chips">${chips}</div></div>
      </div>
      <div class="tw-body">
        ${here && this.banner ? `<div class="tw-news">${this.banner}</div>` : ''}
        ${here ? '' : `<p class="tw-blurb">${esc(s.blurb)}</p>`}
        ${here ? this.progressHtml(here) : this.lineupHtml(s)}
        <div class="tw-actions">${actions}</div>
      </div>
    </section>`;
  }

  render() {
    const c = this.career;
    const won = stopsWon(c.data.tournaments);
    const shown = this.shown();
    const run = this.getRun();
    // A banner about an event shows inside its stop; anything else at the top.
    const loose = this.banner && !(run && TOUR_STOPS.indexOf(run.stop) === shown) ? `<div class="tw-news top">${this.banner}</div>` : '';
    const stamps = TOUR_STOPS.map((_, i) => `<i class="${this.status(i) === 'won' ? 'on' : ''}"></i>`).join('');
    this.el.innerHTML = `<div class="career-card tw-card">
      <div class="tw-head">
        <div class="tw-title"><h2>World Tour</h2><div class="tw-progress"><span class="tw-stamps" aria-hidden="true">${stamps}</span>${won}/${TOUR_STOPS.length} stops won</div></div>
        <div class="tw-rank" title="${c.data.xp.toLocaleString()} XP"><small>Career</small><b>${esc(c.title)}</b></div>
        <button data-a="close" class="cs-close" aria-label="Close">✕</button>
      </div>
      ${loose}
      <nav class="tw-route" aria-label="Tour stops">${this.routeHtml(shown)}</nav>
      ${this.stopHtml(shown)}
    </div>`;
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    if (t === this.el) return this.onClose();
    const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset;
    if (!a) return;
    if (a.a === 'close') return this.onClose();
    if (a.a === 'select') {
      this.selected = a.id!;
      return this.render();
    }
    if (a.a === 'enter') return this.onEnter(a.id!);
    if (a.a === 'play') return this.onPlay();
    if (a.a === 'abandon') return this.onAbandon();
  }
}
