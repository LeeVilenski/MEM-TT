import { CAREER_LEVELS, type Career } from '../progress/profile';
import { TOUR_STOPS, stopUnlocked, stopsWon, type TourRun, type TourStop } from '../progress/tour';
import { STYLES } from '../game/styles';
import { AI_LEVELS } from '../game/ai';
import { VENUES } from '../render/venues';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const formatName = (s: TourStop) => (s.format === 'knockout' ? 'Knockout' : `Round-robin group · final best of ${s.finalBestOf}`);

/**
 * World Tour screen: the route of stops (MEM HQ → … → the rooftop), and the event in
 * progress: a knockout bracket or a round-robin table with your fixtures.
 */
export class TourScreen {
  private el: HTMLDivElement;
  banner = '';
  run: TourRun | null = null;
  onEnter: (id: string) => void = () => {};
  onPlay: () => void = () => {};
  onAbandon: () => void = () => {};
  onClose: () => void = () => {};

  constructor(
    container: HTMLElement,
    private career: Career,
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
    this.el.style.display = 'flex';
    this.render();
    (this.el.querySelector('[data-a="play"], [data-a="enter"]') as HTMLElement | null)?.focus({ preventScroll: true });
  }

  hide() {
    this.el.style.display = 'none';
  }

  private eventHtml(run: TourRun): string {
    const st = run.stop;
    const done = run.state !== 'playing';
    const status = run.state === 'won' ? '🏆 WON' : run.state === 'eliminated' ? 'eliminated' : 'in progress';
    let body = '';
    if (run.knockout) {
      const k = run.knockout;
      body = k.tournament.rounds
        .map((r, i) => {
          const res = k.results[i];
          const mark = res ? (i < k.round || k.state === 'won' ? `✓ ${res}` : `✗ ${res}`) : i === k.round && k.state === 'playing' ? '▶ next' : '';
          return `<div class="cs-round${i === k.round && k.state === 'playing' ? ' next' : ''}"><span>${esc(r.name)}</span><span class="cs-opp">${STYLES[r.style].character} · ${AI_LEVELS[r.level].name} · best of ${r.bestOf}</span><b>${mark}</b></div>`;
        })
        .join('');
    } else {
      const g = run.group!;
      const rows = g
        .standings()
        .map(
          (r, i) =>
            `<tr class="${r.entry.you ? 'you' : ''}${i < 2 ? ' top' : ''}"><td>${i + 1}</td><td>${esc(r.entry.name)}${r.entry.level ? ` <small>${AI_LEVELS[r.entry.level].name}</small>` : ''}</td><td>${r.played}</td><td>${r.won}</td><td>${r.lost}</td><td>${r.gamesFor}–${r.gamesAgainst}</td></tr>`,
        )
        .join('');
      const name = (id: string) => g.entries.find((e) => e.id === id)!.name;
      const results = g.results.map((r) => `<div class="tr-res">${esc(name(r.a))} <b>${r.score[0]}–${r.score[1]}</b> ${esc(name(r.b))}</div>`).join('');
      const final =
        g.phase === 'final' || g.finalScore
          ? `<div class="cs-round next"><span>Final</span><span class="cs-opp">vs ${esc(g.finalOpponent!.name)} · best of ${st.format === 'group' ? st.finalBestOf : 1}</span><b>${g.finalScore ? `${g.finalScore[0] > g.finalScore[1] ? '✓' : '✗'} ${g.finalScore[0]}–${g.finalScore[1]}` : '▶ next'}</b></div>`
          : '';
      body = `<table class="tr-table"><thead><tr><th></th><th>Group</th><th>P</th><th>W</th><th>L</th><th>Games</th></tr></thead><tbody>${rows}</tbody></table>
        <div class="tr-note">Top two go through to the final.</div>${final}${results ? `<div class="tr-results">${results}</div>` : ''}`;
    }
    const next = run.current;
    return `<div class="cs-bracket"><div class="cs-item-title">${esc(st.place)}: ${esc(st.name)} — ${status}</div>${body}
      <div class="cs-actions">${!done && next ? `<button data-a="play">Play ${esc(next.label)}</button><button data-a="abandon" class="secondary">Abandon</button>` : '<button data-a="abandon" class="secondary">Close</button>'}</div></div>`;
  }

  render() {
    const c = this.career;
    const p = c.data;
    const won = stopsWon(p.tournaments);
    const lvl = c.levelIndex;
    const next = CAREER_LEVELS[lvl + 1];
    const busy = this.run && this.run.state === 'playing';
    const route = TOUR_STOPS.map((s, i) => {
      const open = stopUnlocked(i, p.tournaments, p.unlockAll);
      const wins = p.tournaments[s.id] ?? 0;
      const here = this.run?.stop.id === s.id;
      const action = !open
        ? `<span class="cs-lock">Win the ${esc(TOUR_STOPS[i - 1].name)} first</span>`
        : busy
          ? here
            ? '<span class="cs-lock">In progress</span>'
            : ''
          : `<button data-a="enter" data-id="${s.id}">${wins ? 'Play again' : 'Enter'}</button>`;
      return `<div class="cs-item tr-stop${open ? '' : ' locked'}${wins ? ' won' : ''}${here ? ' here' : ''}">
        <div class="tr-num" aria-hidden="true">${wins ? '🏆' : i + 1}</div>
        <div class="cs-item-main"><div class="cs-item-title">${open ? '' : '🔒 '}${esc(s.place)}: ${esc(s.name)} ${wins > 1 ? `<small>×${wins}</small>` : ''}</div>
        <div class="cs-item-sub">${esc(s.blurb)} <i>${formatName(s)} · ${esc(VENUES[s.venue].name)} · ${s.xp} XP</i></div></div>
        ${action}
      </div>`;
    }).join('');

    this.el.innerHTML = `<div class="career-card">
      <div class="cs-head">
        <div><div class="cs-sub">World Tour · ${won}/${TOUR_STOPS.length} stops won</div><div class="cs-title">${esc(c.title)}</div></div>
        <div class="cs-xp"><div class="cs-sub">${p.xp.toLocaleString()} XP${next ? ` · ${next.xp - p.xp} to ${next.title}` : ' · top of the org chart'}</div><div class="cs-bar"><div style="width:${Math.round(c.levelProgress * 100)}%"></div></div></div>
        <button data-a="close" class="cs-close" aria-label="Close">✕</button>
      </div>
      ${this.banner ? `<div class="cs-banner">${this.banner}</div>` : ''}
      <div class="cs-body">${this.run ? this.eventHtml(this.run) : ''}<div class="tr-route">${route}</div></div>
    </div>`;
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    if (t === this.el) return this.onClose();
    const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset;
    if (!a) return;
    if (a.a === 'close') return this.onClose();
    if (a.a === 'enter') return this.onEnter(a.id!);
    if (a.a === 'play') return this.onPlay();
    if (a.a === 'abandon') return this.onAbandon();
  }
}
