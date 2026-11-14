import { STYLES, STYLE_IDS, type StyleId } from '../game/styles';
import { AI_LEVELS, type AiLevel } from '../game/ai';
import { REALISM_PRESETS } from '../game/realism';
import { VENUES, type VenueId } from '../render/venues';
import type { QualitySetting } from '../render/quality';
import type { UnlockKind } from '../progress/unlocks';
import { CharacterPreview } from '../render/charPreview';

/** Which screen the menu shows (null: hidden). */
export type MenuScreen = 'title' | 'pause' | 'vsai' | 'online' | 'settings' | 'characters';

/** What the player was doing when the pause menu opened. */
export interface PauseContext {
  kind: 'match' | 'tournament' | 'drill' | 'practice' | 'online' | 'tutorial';
  /** One line under "Paused", e.g. "vs Sysadmin · 4–7 · games 1–0". */
  detail: string;
}

/** Everything the menus read and change; the Sandbox implements it. */
export interface MenuHost {
  readonly isTouch: boolean;
  matchSettings: { level: AiLevel; bestOf: number; aiStyle: StyleId | 'random'; doubles: boolean; partner: StyleId | 'random'; opp1: StyleId | 'random'; opp2: StyleId | 'random' };
  saveDoublesPicks(): void;
  onlineSettings: { name: string; code: string; mode: 'singles' | 'doubles'; bestOf: number };
  realism: { percent: number; style: StyleId };
  look: { venue: VenueId; volume: number; muted: boolean; ambience: boolean; autoReplay: boolean; arcadeFx: boolean; bloom: boolean; fullSpeedOut: boolean; callouts: boolean };
  quality: { setting: QualitySetting };
  devTools: boolean;
  /** null if unlocked, otherwise how to unlock it. */
  lockReason(kind: UnlockKind, id: string): string | null;

  startAiMatch(): void;
  /** You and an AI partner against two AI. */
  startDoubles(): void;
  startPractice(): void;
  startTutorial(): void;
  openCareer(): void;
  showHowTo(): void;
  createOnline(): void;
  joinOnline(code: string): void;
  resume(): void;
  restart(): void;
  quitToTitle(): void;
  /** Developer free camera. */
  inspect(): void;

  setRealismPercent(p: number): void;
  setStyle(id: StyleId): void;
  setVenue(id: VenueId): void;
  setVolume(v: number): void;
  setMuted(m: boolean): void;
  setAmbience(a: boolean): void;
  setAutoReplay(a: boolean): void;
  setArcadeFx(a: boolean): void;
  setQuality(q: QualitySetting): void;
  setBloom(on: boolean): void;
  setFullSpeedOut(on: boolean): void;
  setCallouts(on: boolean): void;
  camMode: 'classic' | 'close' | 'dynamic';
  setCamMode(mode: 'classic' | 'close' | 'dynamic'): void;
  setDevTools(on: boolean): void;
}

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const BEST_OF = [1, 3, 5, 7];

/** "Helpdesk Hero · All-rounder" (the role only when it isn't the name). */
const styleNote = (id: StyleId) => {
  const st = STYLES[id];
  return st.role !== st.character ? `${st.role} · ${st.label}` : st.label;
};
const QUALITY: [string, QualitySetting][] = [
  ['Auto', 'auto'],
  ['High', 2],
  ['Medium', 1],
  ['Low', 0],
];

/**
 * The game's front end: a title screen, its sub-screens (match vs AI, online,
 * settings) and the pause menu. Plain DOM, keyboard- and touch-friendly.
 * The developer panel (lil-gui) stays available behind Settings → Developer tools.
 */
export class Menu {
  private el: HTMLDivElement;
  private card: HTMLDivElement;
  screen: MenuScreen | null = null;
  /** Where Back goes from a sub-screen: the title or the pause menu. */
  private home: 'title' | 'pause' = 'title';
  /** Character select: which character is being looked at, and where Back returns to. */
  private browse: StyleId | null = null;
  private charReturn: MenuScreen = 'title';
  private preview: CharacterPreview | null = null;
  private pause: PauseContext = { kind: 'practice', detail: '' };
  /** Called whenever the menu opens or closes (the Sandbox adjusts the camera and HUD). */
  onChange: (screen: MenuScreen | null) => void = () => {};

  constructor(
    container: HTMLElement,
    private host: MenuHost,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'menu';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.card = document.createElement('div');
    this.card.className = 'menu-card';
    this.el.append(this.card);
    this.el.style.display = 'none';
    container.append(this.el);
    this.el.addEventListener('click', (e) => this.onClick(e));
    this.el.addEventListener('input', (e) => this.onInput(e));
    this.el.addEventListener('change', (e) => this.onInput(e));
    this.el.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  get visible() {
    return this.screen !== null;
  }

  show(screen: MenuScreen, pause?: PauseContext) {
    if (pause) this.pause = pause;
    if (screen === 'title' || screen === 'pause') this.home = screen;
    const changed = this.screen !== screen;
    if (screen === 'characters' && changed) {
      this.charReturn = this.screen ?? 'title';
      this.browse = this.host.realism.style;
    }
    this.screen = screen;
    this.render();
    this.el.style.display = 'flex';
    document.body.classList.add('menu-open');
    if (changed) {
      this.focusFirst();
      this.onChange(screen);
    }
  }

  hide() {
    if (this.screen === null) return;
    this.screen = null;
    this.preview?.stop();
    this.el.style.display = 'none';
    document.body.classList.remove('menu-open');
    this.onChange(null);
  }

  /**
   * Back from a sub-screen. Esc on the pause menu itself does nothing: the Esc that
   * released the mouse can arrive here too, and resuming would grab it straight back.
   */
  back() {
    if (this.screen === 'characters') this.show(this.charReturn);
    else if (this.screen && this.screen !== 'title' && this.screen !== 'pause') this.show(this.home);
  }

  /** Re-render in place (e.g. after an unlock), keeping focus where it was. */
  refresh() {
    if (!this.screen) return;
    const focused = (document.activeElement as HTMLElement | null)?.dataset;
    const key = focused?.a ?? focused?.k;
    this.render();
    if (key) (this.card.querySelector(`[data-a="${key}"], [data-k="${key}"]`) as HTMLElement | null)?.focus();
  }

  // ------------------------------------------------------------- rendering

  private render() {
    const s = this.screen;
    this.el.dataset.screen = s ?? '';
    if (s === 'title') this.card.innerHTML = this.titleHtml();
    else if (s === 'pause') this.card.innerHTML = this.pauseHtml();
    else if (s === 'vsai') this.card.innerHTML = this.vsAiHtml();
    else if (s === 'online') this.card.innerHTML = this.onlineHtml();
    else if (s === 'settings') this.card.innerHTML = this.settingsHtml();
    else if (s === 'characters') this.card.innerHTML = this.charactersHtml();
    if (s === 'characters') {
      this.preview ??= new CharacterPreview();
      const st = STYLES[this.browse!];
      this.preview.setStyle(st.id, `${st.character}, ${st.role}`);
      this.card.querySelector('.cs-stage')!.prepend(this.preview.canvas);
      this.preview.start();
    } else this.preview?.stop();
    this.el.setAttribute('aria-label', this.card.querySelector('h1, h2')?.textContent ?? 'Menu');
  }

  private titleHtml() {
    const h = this.host;
    const st = STYLES[h.realism.style];
    return `
      <div class="menu-logo" aria-hidden="true"><span class="menu-ball"></span></div>
      <h1 class="menu-title">MEM <span>Table Tennis</span></h1>
      <p class="menu-tag">Spin, pace and office politics.</p>
      <button data-a="go-characters" class="menu-player" aria-label="Playing as ${esc(st.character)}. Change player">
        <span class="mp-avatar" aria-hidden="true">${esc(st.character[0])}</span>
        <span class="mp-text"><small>Playing as</small><b>${esc(st.character)}</b><small>${esc(styleNote(st.id))}</small></span>
        <span class="mp-change">Change ›</span>
      </button>
      <div class="menu-buttons">
        <button data-a="quick" class="primary big">▶ Quick match <small>vs ${AI_LEVELS[h.matchSettings.level].name} AI · best of ${h.matchSettings.bestOf}</small></button>
        <button data-a="go-vsai">Match vs AI <small>Choose opponent and format</small></button>
        <button data-a="practice">Practice <small>Ball machine, no score</small></button>
        <button data-a="career">Career <small>Drills, tournaments, stats</small></button>
        <button data-a="go-online">Online <small>Play friends: singles or doubles</small></button>
        <div class="menu-row three">
          <button data-a="tutorial" class="secondary">Tutorial</button>
          <button data-a="howto" class="secondary">Controls</button>
          <button data-a="go-settings" class="secondary">Settings</button>
        </div>
      </div>
      ${h.devTools ? '<button data-a="inspect" class="link menu-dev">Developer: free camera</button>' : ''}
      <p class="menu-foot">Difficulty: ${esc(this.realismName(h.realism.percent))}</p>`;
  }

  private pauseHtml() {
    const k = this.pause.kind;
    const restart = k === 'match' ? 'Restart match' : k === 'drill' ? 'Restart drill' : k === 'tutorial' ? 'Restart tutorial' : null;
    const quit = k === 'online' ? 'Leave room' : 'Quit to title';
    return `
      <h2 class="menu-title small">Paused</h2>
      ${this.pause.detail ? `<p class="menu-tag">${this.pause.detail}</p>` : ''}
      <div class="menu-buttons">
        <button data-a="resume" class="primary big">▶ Resume</button>
        ${restart ? `<button data-a="restart">${restart}</button>` : ''}
        <button data-a="howto">How to play</button>
        <button data-a="go-settings">Settings</button>
        <button data-a="quit" class="secondary">${quit}</button>
      </div>
      ${this.host.devTools ? '<button data-a="inspect" class="link menu-dev">Developer: free camera</button>' : ''}
      <p class="menu-foot">${this.host.isTouch ? 'Tap Resume to carry on.' : '<b>Resume</b> takes the mouse back. <kbd>Esc</kbd> during play pauses.'}</p>`;
  }

  private vsAiHtml() {
    const m = this.host.matchSettings;
    const levels = (Object.keys(AI_LEVELS) as AiLevel[])
      .map((id, i) => this.choice('level', id, AI_LEVELS[id].name, m.level === id, ['Gentle, slow to react', 'Solid all round', 'Fast, precise, aggressive'][i]))
      .join('');
    const styles = [this.choice('aiStyle', 'random', 'Random', m.aiStyle === 'random', 'Surprise me')]
      .concat(STYLE_IDS.map((id) => this.choice('aiStyle', id, STYLES[id].character, m.aiStyle === id, styleNote(id))))
      .join('');
    const formats = BEST_OF.map((n) => this.choice('bestOf', String(n), `Best of ${n}`, m.bestOf === n)).join('');
    return `
      ${this.header('Match vs AI')}
      ${this.group('Mode', `<div class="menu-choices">${this.choice('doubles', '0', 'Singles', !m.doubles, '1 v 1')}${this.choice('doubles', '1', 'Doubles', m.doubles, 'You + AI partner v 2 AI')}</div>`)}
      ${this.group('Opponent level', `<div class="menu-choices">${levels}</div>`)}
      ${m.doubles ? this.doublesLineupHtml() : this.group('Opponent', `<div class="menu-choices wrap">${styles}</div>`)}
      ${this.group('Format', `<div class="menu-choices">${formats}</div>`)}
      <div class="menu-actions"><button data-a="start" class="primary big">▶ Start match</button></div>`;
  }

  /**
   * Doubles line-up: you (your chosen character), your partner and the two opponents.
   * A character can only play once: those already in the line-up are greyed out.
   */
  private doublesLineupHtml() {
    const h = this.host;
    const m = h.matchSettings;
    const me = STYLES[h.realism.style];
    const slots = ['partner', 'opp1', 'opp2'] as const;
    const picker = (slot: (typeof slots)[number]) => {
      const others = new Set<StyleId>([h.realism.style, ...slots.filter((x) => x !== slot).map((x) => m[x]).filter((v): v is StyleId => v !== 'random')]);
      return [this.choice(slot, 'random', 'Random', m[slot] === 'random')]
        .concat(STYLE_IDS.map((id) => this.choice(slot, id, STYLES[id].character, m[slot] === id, others.has(id) ? (id === h.realism.style ? 'You' : 'In the game') : STYLES[id].role, null, others.has(id))))
        .join('');
    };
    return `
      ${this.group('You', `<button data-a="go-characters" class="menu-player compact"><span class="mp-avatar" aria-hidden="true">${esc(me.character[0])}</span><span class="mp-text"><b>${esc(me.character)}</b><small>${esc(styleNote(me.id))}</small></span><span class="mp-change">Change ›</span></button>`)}
      ${this.group('Your partner', `<div class="menu-choices six">${picker('partner')}</div>`)}
      ${this.group('Opponent 1', `<div class="menu-choices six">${picker('opp1')}</div>`)}
      ${this.group('Opponent 2', `<div class="menu-choices six">${picker('opp2')}</div>`)}`;
  }

  private onlineHtml() {
    const o = this.host.onlineSettings;
    const modes = this.choice('mode', 'singles', 'Singles', o.mode === 'singles', '1 v 1') + this.choice('mode', 'doubles', 'Doubles', o.mode === 'doubles', '2 v 2');
    const formats = BEST_OF.map((n) => this.choice('onlineBestOf', String(n), `Best of ${n}`, o.bestOf === n)).join('');
    return `
      ${this.header('Online')}
      ${this.group('Your name', `<input data-k="name" type="text" maxlength="20" value="${esc(o.name)}" autocomplete="nickname" aria-label="Your name">`)}
      <div class="menu-split">
        <section>
          <h3>Create a room</h3>
          <div class="menu-choices">${modes}</div>
          <div class="menu-choices">${formats}</div>
          <button data-a="create" class="primary">➕ Create room</button>
          <p class="menu-note">You get a 5-letter code to share. Empty seats can be filled by the AI.</p>
        </section>
        <section>
          <h3>Join a room</h3>
          <input data-k="code" type="text" maxlength="5" placeholder="CODE" value="${esc(o.code)}" class="menu-code" autocapitalize="characters" autocomplete="off" aria-label="Room code">
          <button data-a="join" class="primary">→ Join room</button>
        </section>
      </div>`;
  }

  private settingsHtml() {
    const h = this.host;
    const realism = Object.entries(REALISM_PRESETS)
      .map(([name, v]) => this.choice('realism', String(Math.round(v * 100)), name, h.realism.percent === Math.round(v * 100), ['Real physics, no help', 'Some help', 'Forgiving (default)', 'Slow and very forgiving'][Object.keys(REALISM_PRESETS).indexOf(name)]))
      .join('');
    const venues = (Object.keys(VENUES) as VenueId[]).map((id) => this.choice('venue', id, VENUES[id].name, h.look.venue === id, undefined, h.lockReason('venue', id))).join('');
    const quality = QUALITY.map(([name, q]) => this.choice('quality', String(q), name, h.quality.setting === q)).join('');
    const toggle = (k: string, label: string, on: boolean, note?: string) =>
      `<label class="menu-toggle"><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''}><span>${label}${note ? `<small>${note}</small>` : ''}</span></label>`;
    const custom = !Object.values(REALISM_PRESETS).some((v) => Math.round(v * 100) === h.realism.percent);
    return `
      ${this.header('Settings')}
      <div class="menu-scroll">
        ${this.group('Difficulty (realism)', `<div class="menu-choices">${realism}</div>${custom ? `<p class="menu-note">Currently a custom ${h.realism.percent}%: pick a preset to change it.</p>` : ''}`)}
        ${this.group('Your character', `<button data-a="go-characters" class="menu-player compact"><span class="mp-avatar" aria-hidden="true">${esc(STYLES[h.realism.style].character[0])}</span><span class="mp-text"><b>${esc(STYLES[h.realism.style].character)}</b><small>${esc(styleNote(h.realism.style))}</small></span><span class="mp-change">Change ›</span></button>`)}
        ${this.group('Venue', `<div class="menu-choices wrap">${venues}</div>`)}
        ${this.group(
          'Sound',
          `<label class="menu-slider"><span>Volume</span><input type="range" data-k="volume" min="0" max="1" step="0.05" value="${h.look.volume}" aria-label="Volume"><output>${Math.round(h.look.volume * 100)}%</output></label>
           ${toggle('muted', 'Mute', h.look.muted)}
           ${toggle('ambience', 'Venue ambience', h.look.ambience, 'Office hum, server fans, wind')}`,
        )}
        ${this.group(
          'Gameplay & effects',
          `${toggle('arcadeFx', 'Arcade effects', h.look.arcadeFx, 'Hit-stop, camera shake, sparks, crowd')}
           ${toggle('fullSpeedOut', 'Your shots at full speed', h.look.fullSpeedOut, 'The game slows down only for balls coming at you (offline)')}
           ${toggle('autoReplay', 'Auto-replay long rallies', h.look.autoReplay)}
           ${toggle('callouts', 'Point call-outs', h.look.callouts, 'A joke after each point: 404, PACKET LOSS, SEGFAULT…')}`,
        )}
        ${this.group('Camera', `<div class="menu-choices">${this.choice('cam', 'dynamic', 'Dynamic', h.camMode === 'dynamic', 'Follows the play (recommended)')}${this.choice('cam', 'close', 'Close', h.camMode === 'close', 'Behind you, more depth')}${this.choice('cam', 'classic', 'Classic', h.camMode === 'classic', 'High and steady, like TV')}</div>`)}
        ${this.group('Graphics quality', `<div class="menu-choices">${quality}</div>${toggle('bloom', 'Glow effects', h.look.bloom, 'Bloom on the ball trail, sparks and lights (High quality only)')}`)}
        ${this.group('Advanced', toggle('devTools', 'Developer tools', h.devTools, 'Physics tuning, ball machine and every assist. <kbd>`</kbd> toggles it too.'))}
      </div>`;
  }

  private charactersHtml() {
    const h = this.host;
    const id = this.browse!;
    const st = STYLES[id];
    const lock = h.lockReason('style', id);
    const current = h.realism.style === id;
    const list = STYLE_IDS.map((sid) => {
      const s2 = STYLES[sid];
      const l = h.lockReason('style', sid);
      return `<button class="cs-pick${sid === id ? ' on' : ''}${l ? ' locked' : ''}" data-k="browse" data-v="${sid}" aria-pressed="${sid === id}" aria-label="${esc(s2.character)}, ${esc(s2.role)}${l ? ', locked' : ''}${h.realism.style === sid ? ', your player' : ''}">
        <span class="mp-avatar" aria-hidden="true">${l ? '🔒' : esc(s2.character[0])}</span><span class="cs-pick-name">${esc(s2.character)}${h.realism.style === sid ? ' <i>✓</i>' : ''}</span></button>`;
    }).join('');
    const bar = (label: string, v: number, lo: number, hi: number, word: string) => {
      const pct = Math.round(15 + (85 * (v - lo)) / (hi - lo));
      return `<div class="cs-stat"><span>${label}</span><span class="cs-bar" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}" aria-valuetext="${word}"><i style="width:${Math.max(8, Math.min(100, pct))}%"></i></span><b>${word}</b></div>`;
    };
    const rate = (v: number) => (v >= 1.12 ? 'Very high' : v >= 1.04 ? 'High' : v > 0.97 ? 'Average' : 'Low');
    const stance = st.distance < 0.7 ? 'At the table' : st.distance < 1 ? 'Mid-distance' : st.distance < 1.5 ? 'Back' : 'Far back';
    const rubber = (r: { name: string; kind: string }) => `<span>${esc(r.name)} <small>(${esc(r.kind)})</small></span>`;
    const action = lock
      ? `<button class="primary big" aria-disabled="true" disabled>🔒 Locked <small>${esc(lock)}</small></button>`
      : current
        ? `<button data-a="back" class="primary big">✓ ${esc(st.character)} is your player <small>Back</small></button>`
        : `<button data-a="pick" class="primary big">Play as ${esc(st.character)}</button>`;
    return `
      ${this.header('Choose your player')}
      <div class="cs-layout">
        <div class="cs-stage">
          <div class="cs-hint" aria-hidden="true">Drag to turn</div>
        </div>
        <div class="cs-info">
          <div class="cs-name">${esc(st.character)}</div>
          <div class="cs-role">${esc(st.role)} · <b>${esc(st.label)}</b></div>
          <p class="cs-desc">${esc(st.description)}</p>
          <div class="cs-stats">
            ${bar('Power', st.power, 0.85, 1.2, rate(st.power))}
            ${bar('Reach', st.reach, 0.9, 1.15, rate(st.reach))}
            ${bar('Footwork', st.footwork, 0.95, 1.15, rate(st.footwork))}
            ${bar('Stance', st.distance, 0.4, 1.9, stance)}
          </div>
          <div class="cs-rubbers"><span class="k">Forehand</span>${rubber(st.rubbers.forehand)}<span class="k">Backhand</span>${rubber(st.rubbers.backhand)}</div>
          <div class="menu-actions">${action}</div>
        </div>
      </div>
      <div class="cs-list" role="group" aria-label="Characters">${list}</div>`;
  }

  private header(title: string) {
    return `<div class="menu-head"><button data-a="back" class="menu-back" aria-label="Back">←</button><h2 class="menu-title small">${title}</h2></div>`;
  }

  private group(label: string, body: string) {
    return `<div class="menu-group" role="group" aria-label="${esc(label)}"><div class="menu-label">${label}</div>${body}</div>`;
  }

  /** A selectable option button: data-k is the setting, data-v its value. */
  private choice(k: string, v: string, label: string, selected: boolean, note?: string, locked?: string | null, taken = false) {
    const off = !!locked || taken;
    return `<button class="menu-choice${selected ? ' on' : ''}${off ? ' locked' : ''}" data-k="${k}" data-v="${esc(v)}" aria-pressed="${selected}"${off ? ` aria-disabled="true" title="${esc(locked ?? note ?? '')}"` : ''}>${locked ? '🔒 ' : ''}${esc(label)}${note || locked ? `<small>${esc(locked ? locked : note!)}</small>` : ''}</button>`;
  }

  private realismName(p: number) {
    const hit = Object.entries(REALISM_PRESETS).find(([, v]) => Math.round(v * 100) === p);
    return hit ? hit[0] : `${p}% arcade`;
  }

  // ------------------------------------------------------------- input

  private onClick(e: MouseEvent) {
    const t = (e.target as HTMLElement).closest('button') as HTMLButtonElement | null;
    if (!t || !this.el.contains(t)) return;
    const h = this.host;
    const a = t.dataset.a;
    if (a) {
      if (a.startsWith('go-')) return this.show(a.slice(3) as MenuScreen);
      switch (a) {
        case 'back':
          return this.back();
        case 'quick':
          return h.startAiMatch();
        case 'start':
          return h.matchSettings.doubles ? h.startDoubles() : h.startAiMatch();
        case 'practice':
          return h.startPractice();
        case 'tutorial':
          return h.startTutorial();
        case 'career':
          return h.openCareer();
        case 'howto':
          return h.showHowTo();
        case 'create':
          return h.createOnline();
        case 'join':
          return h.joinOnline(h.onlineSettings.code);
        case 'resume':
          return h.resume();
        case 'restart':
          return h.restart();
        case 'quit':
          return h.quitToTitle();
        case 'inspect':
          return h.inspect();
        case 'pick':
          if (this.browse && !h.lockReason('style', this.browse)) {
            h.setStyle(this.browse);
            this.preview?.react('celebrate');
            this.refresh();
          }
          return;
      }
      return;
    }
    const k = t.dataset.k;
    const v = t.dataset.v;
    if (!k || v === undefined) return;
    if (k === 'browse') {
      this.browse = v as StyleId;
      return this.refresh();
    }
    if (t.getAttribute('aria-disabled') === 'true') {
      t.classList.remove('shake');
      void t.offsetWidth;
      t.classList.add('shake');
      return;
    }
    switch (k) {
      case 'level':
        h.matchSettings.level = v as AiLevel;
        break;
      case 'doubles':
        h.matchSettings.doubles = v === '1';
        break;
      case 'partner':
      case 'opp1':
      case 'opp2':
        h.matchSettings[k] = v as StyleId | 'random';
        h.saveDoublesPicks();
        break;
      case 'aiStyle':
        h.matchSettings.aiStyle = v as StyleId | 'random';
        break;
      case 'bestOf':
        h.matchSettings.bestOf = Number(v);
        break;
      case 'mode':
        h.onlineSettings.mode = v as 'singles' | 'doubles';
        break;
      case 'onlineBestOf':
        h.onlineSettings.bestOf = Number(v);
        break;
      case 'realism':
        h.setRealismPercent(Number(v));
        break;
      case 'style':
        h.setStyle(v as StyleId);
        break;
      case 'venue':
        h.setVenue(v as VenueId);
        break;
      case 'cam':
        h.setCamMode(v as 'classic' | 'close' | 'dynamic');
        break;
      case 'quality':
        h.setQuality(v === 'auto' ? 'auto' : (Number(v) as QualitySetting));
        break;
    }
    this.refresh();
  }

  private onInput(e: Event) {
    const t = e.target as HTMLInputElement;
    const k = t.dataset.k;
    if (!k) return;
    const h = this.host;
    if (k === 'name') h.onlineSettings.name = t.value;
    else if (k === 'code') {
      const up = t.value.toUpperCase().replace(/[^A-Z]/g, '');
      if (up !== t.value) t.value = up;
      h.onlineSettings.code = up;
    } else if (k === 'volume') {
      h.setVolume(Number(t.value));
      const out = t.parentElement?.querySelector('output');
      if (out) out.textContent = `${Math.round(Number(t.value) * 100)}%`;
    } else if (e.type === 'change') {
      if (k === 'muted') h.setMuted(t.checked);
      else if (k === 'ambience') h.setAmbience(t.checked);
      else if (k === 'arcadeFx') h.setArcadeFx(t.checked);
      else if (k === 'autoReplay') h.setAutoReplay(t.checked);
      else if (k === 'bloom') h.setBloom(t.checked);
      else if (k === 'fullSpeedOut') h.setFullSpeedOut(t.checked);
      else if (k === 'callouts') h.setCallouts(t.checked);
      else if (k === 'devTools') h.setDevTools(t.checked);
    }
  }

  private onKeyDown(e: KeyboardEvent) {
    // Keep game keys (Space fires the ball machine, digits switch cameras…) out of the menu;
    // ` (developer tools) still goes through.
    if (e.code !== 'Backquote') e.stopPropagation();
    const target = e.target as HTMLElement;
    if (e.key === 'Escape') {
      e.preventDefault();
      this.back();
      return;
    }
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') {
      if (e.key === 'Enter' && target.dataset.k === 'code') this.host.joinOnline(this.host.onlineSettings.code);
      return;
    }
    // Character select: left/right flip through the characters.
    if (this.screen === 'characters' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const i = STYLE_IDS.indexOf(this.browse!);
      this.browse = STYLE_IDS[(i + (e.key === 'ArrowRight' ? 1 : -1) + STYLE_IDS.length) % STYLE_IDS.length];
      this.render();
      (this.card.querySelector(`.cs-pick[data-v="${this.browse}"]`) as HTMLElement | null)?.focus();
      return;
    }
    // Arrow keys move between buttons, like a console menu.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.tagName !== 'INPUT')) {
      const items = [...this.card.querySelectorAll<HTMLElement>('button, input')].filter((x) => x.offsetParent !== null);
      const i = items.indexOf(target);
      const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
      const next = items[(i + step + items.length) % items.length];
      if (next) {
        e.preventDefault();
        next.focus();
      }
    }
  }

  /** Esc from outside the menu (window listener in the Sandbox). */
  handleEscape() {
    this.back();
  }

  private focusFirst() {
    // Don't pop the on-screen keyboard or a focus ring on touch devices.
    if (this.host.isTouch) return;
    const first = this.card.querySelector<HTMLElement>('button.primary, .menu-buttons button, button.menu-choice, button');
    first?.focus({ preventScroll: true });
  }
}
