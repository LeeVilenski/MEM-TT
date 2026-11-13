import { ACHIEVEMENTS, CAREER_LEVELS, type Career } from '../progress/profile';
import { DRILLS, drillUnlocked, type DrillSession } from '../progress/drills';
import { TOURNAMENTS, tournamentUnlocked, type TournamentRun } from '../progress/tournament';
import { UNLOCKS } from '../progress/unlocks';
import { STYLES } from '../game/styles';
import { AI_LEVELS } from '../game/ai';
import { VENUES } from '../render/venues';
import { RUBBERS } from '../physics';

type Tab = 'stats' | 'drills' | 'tournaments' | 'unlocks';

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const stars = (n: number) => `<span class="stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;

function unlockName(kind: string, id: string) {
  if (kind === 'venue') return `Venue: ${VENUES[id as keyof typeof VENUES]?.name ?? id}`;
  if (kind === 'style') return `Style: ${STYLES[id as keyof typeof STYLES]?.character ?? id}`;
  return `Rubber: ${RUBBERS[id]?.name ?? id} (${RUBBERS[id]?.kind ?? ''})`;
}

/** Career screen: profile, stats, drills, tournaments, unlocks and achievements. */
export class CareerScreen {
  private el: HTMLDivElement;
  tab: Tab = 'stats';
  /** A message shown at the top (e.g. drill or tournament result). */
  banner = '';
  run: TournamentRun | null = null;
  onStartDrill: (id: string) => void = () => {};
  onStartTournament: (id: string) => void = () => {};
  onPlayRound: () => void = () => {};
  onAbandonTournament: () => void = () => {};
  onClose: () => void = () => {};

  constructor(
    container: HTMLElement,
    private career: Career,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'career';
    this.el.style.display = 'none';
    container.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  get visible() {
    return this.el.style.display !== 'none';
  }

  show(tab?: Tab, banner = '') {
    if (tab) this.tab = tab;
    this.banner = banner;
    this.el.style.display = 'flex';
    this.render();
  }

  hide() {
    this.el.style.display = 'none';
  }

  drillResult(session: DrillSession) {
    const d = session.drill;
    this.show('drills', `<b>${esc(d.name)}</b>: ${session.successes}/${d.balls} ${stars(session.stars)}${session.stars === 0 ? ' — need ' + d.stars[0] + ' for a star. Try again!' : ''}`);
  }

  render() {
    const c = this.career;
    const p = c.data;
    const s = p.stats;
    const lvl = c.levelIndex;
    const next = CAREER_LEVELS[lvl + 1];
    const tabs: [Tab, string][] = [
      ['stats', 'Stats'],
      ['drills', 'Training drills'],
      ['tournaments', 'Tournaments'],
      ['unlocks', 'Unlocks & badges'],
    ];
    let body = '';
    if (this.tab === 'stats') {
      const fav = Object.entries(s.shots)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([n, k]) => `${esc(n)} ×${k}`)
        .join(', ');
      const row = (k: string, v: string) => `<div class="cs-row"><span>${k}</span><b>${v}</b></div>`;
      const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '—');
      body = `<div class="cs-grid">
        <div>${row('Matches', `${s.matchesWon} won / ${s.matchesPlayed} played (${pct(s.matchesWon, s.matchesPlayed)})`)}
        ${row('Online matches', String(s.onlineMatches))}
        ${row('Points', `${s.pointsWon} won / ${s.pointsWon + s.pointsLost} (${pct(s.pointsWon, s.pointsWon + s.pointsLost)})`)}
        ${row('Aces', String(s.aces))}
        ${row('Longest rally', `${s.longestRally} hits`)}</div>
        <div>${row('Fastest shot', `${s.fastestShot.toFixed(1)} m/s (${Math.round(s.fastestShot * 3.6)} km/h)`)}
        ${row('Most spin', `${Math.round(s.maxRpm).toLocaleString()} rpm`)}
        ${row('Practice returns', `${s.practiceReturns} / ${s.practiceAttempts} (${pct(s.practiceReturns, s.practiceAttempts)})`)}
        ${row('AI beaten', Object.entries(s.aiWins).map(([k, v]) => `${AI_LEVELS[k as keyof typeof AI_LEVELS]?.name ?? k} ×${v}`).join(', ') || '—')}
        ${row('Favourite shots', fav || '—')}</div>
      </div>`;
    } else if (this.tab === 'drills') {
      body = DRILLS.map((d, i) => {
        const open = drillUnlocked(i, p.drills, p.unlockAll);
        const best = p.drills[d.id] ?? 0;
        return `<div class="cs-item${open ? '' : ' locked'}">
          <div class="cs-item-main"><div class="cs-item-title">${open ? '' : '🔒 '}${esc(d.name)} ${stars(best)}</div>
          <div class="cs-item-sub">${esc(d.description)} <i>Stars at ${d.stars.join(' / ')} of ${d.balls}.</i></div></div>
          ${open ? `<button data-a="drill" data-id="${d.id}">${best ? 'Retry' : 'Start'}</button>` : '<span class="cs-lock">Earn a star in the previous drill</span>'}
        </div>`;
      }).join('');
    } else if (this.tab === 'tournaments') {
      const run = this.run;
      const bracket = run
        ? `<div class="cs-bracket"><div class="cs-item-title">${esc(run.tournament.name)} — ${run.state === 'playing' ? 'in progress' : run.state === 'won' ? '🏆 WON' : 'eliminated'}</div>
           ${run.tournament.rounds
             .map((r, i) => {
               const res = run.results[i];
               const status = res ? (i < run.round || run.state === 'won' ? `✓ ${res}` : `✗ ${res}`) : i === run.round && run.state === 'playing' ? '▶ next' : '';
               return `<div class="cs-round${i === run.round && run.state === 'playing' ? ' next' : ''}"><span>${esc(r.name)}</span><span class="cs-opp">${STYLES[r.style].character} · ${AI_LEVELS[r.level].name} · best of ${r.bestOf}</span><b>${status}</b></div>`;
             })
             .join('')}
           <div class="cs-actions">${run.state === 'playing' ? `<button data-a="round">Play ${esc(run.current!.name)}</button><button data-a="abandon" class="secondary">Abandon</button>` : '<button data-a="abandon" class="secondary">Close bracket</button>'}</div></div>`
        : '';
      body =
        bracket +
        TOURNAMENTS.map((t) => {
          const open = tournamentUnlocked(t, p.tournaments, p.unlockAll);
          const wins = p.tournaments[t.id] ?? 0;
          return `<div class="cs-item${open ? '' : ' locked'}">
            <div class="cs-item-main"><div class="cs-item-title">${open ? '' : '🔒 '}${esc(t.name)} ${wins ? `🏆×${wins}` : ''}</div>
            <div class="cs-item-sub">${esc(t.description)} Prize: ${t.xp} XP.</div></div>
            ${open ? (run && run.state === 'playing' ? '' : `<button data-a="tournament" data-id="${t.id}">Enter</button>`) : '<span class="cs-lock">Win the Department Cup first</span>'}
          </div>`;
        }).join('');
    } else {
      const unl = UNLOCKS.map((u) => {
        const ok = p.unlockAll || u.test(p, lvl);
        return `<div class="cs-unlock${ok ? ' ok' : ''}">${ok ? '✓' : '🔒'} ${esc(unlockName(u.kind, u.id))} <span>${ok ? '' : esc(u.requirement)}</span></div>`;
      }).join('');
      const ach = ACHIEVEMENTS.map((a) => `<div class="cs-ach${c.has(a.id) ? ' ok' : ''}"><b>${c.has(a.id) ? '🏅' : '○'} ${esc(a.name)}</b><span>${esc(a.description)}</span></div>`).join('');
      body = `<div class="cs-cols"><div><div class="cs-h">Unlocks</div>${unl}
        <label class="cs-check"><input type="checkbox" data-a="unlockall"${p.unlockAll ? ' checked' : ''}/> Unlock everything (sandbox mode)</label></div>
        <div><div class="cs-h">Achievements (${p.achievements.length}/${ACHIEVEMENTS.length})</div>${ach}</div></div>
        <div class="cs-actions"><button data-a="reset" class="danger">Reset all progress</button></div>`;
    }

    this.el.innerHTML = `<div class="career-card">
      <div class="cs-head">
        <div><div class="cs-sub">Career level</div><div class="cs-title">${esc(c.title)}</div></div>
        <div class="cs-xp"><div class="cs-sub">${p.xp.toLocaleString()} XP${next ? ` · ${next.xp - p.xp} to ${next.title}` : ' · top of the org chart'}</div><div class="cs-bar"><div style="width:${Math.round(c.levelProgress * 100)}%"></div></div></div>
        <button data-a="close" class="cs-close" aria-label="Close">✕</button>
      </div>
      ${this.banner ? `<div class="cs-banner">${this.banner}</div>` : ''}
      <div class="cs-tabs">${tabs.map(([t, l]) => `<button data-tab="${t}" class="${t === this.tab ? 'on' : ''}">${l}</button>`).join('')}</div>
      <div class="cs-body">${body}</div>
    </div>`;
  }

  private onClick(e: Event) {
    const t = e.target as HTMLElement;
    if (t === this.el) return this.onClose();
    const tab = t.closest('[data-tab]') as HTMLElement | null;
    if (tab) {
      this.tab = tab.dataset.tab as Tab;
      this.banner = '';
      return this.render();
    }
    const a = (t.closest('[data-a]') as HTMLElement | null)?.dataset;
    if (!a) return;
    switch (a.a) {
      case 'close':
        return this.onClose();
      case 'drill':
        return this.onStartDrill(a.id!);
      case 'tournament':
        return this.onStartTournament(a.id!);
      case 'round':
        return this.onPlayRound();
      case 'abandon':
        return this.onAbandonTournament();
      case 'unlockall':
        this.career.setUnlockAll((t as HTMLInputElement).checked);
        return this.render();
      case 'reset':
        if (confirm('Reset all career progress, stats and unlocks? This cannot be undone.')) {
          this.career.reset();
          this.render();
        }
        return;
    }
  }
}
