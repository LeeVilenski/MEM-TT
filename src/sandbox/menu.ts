import { STYLES, PLAYABLE_STYLE_IDS, FREE_PLAY_OPPONENT_IDS, type StyleId } from '../game/styles';
import { AI_LEVELS, type AiLevel } from '../game/ai';
import { REALISM_PRESETS } from '../game/realism';
import { VENUES, type VenueId } from '../render/venues';
import type { QualitySetting } from '../render/quality';
import type { UnlockKind } from '../progress/unlocks';
import { CharacterPreview } from '../render/charPreview';
import { canInstall, install, onInstallChange } from '../pwa/install';
import { DRILL_CATEGORIES, type Drill } from '../progress/drills';
import { BAT_RUBBER_IDS, BLADES, BLADE_IDS, type Bat, type BladeId } from '../game/equipment';
import { RUBBERS } from '../physics';

/** Which screen the menu shows (null: hidden). */
export type MenuScreen = 'title' | 'pause' | 'vsai' | 'online' | 'settings' | 'characters' | 'training';

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
  look: { venue: VenueId; volume: number; muted: boolean; ambience: boolean; music: boolean; autoReplay: boolean; arcadeFx: boolean; bloom: boolean; fullSpeedOut: boolean; callouts: boolean; mjMode: boolean; spinPalette: 'standard' | 'colourblind'; spinLabel: boolean; reduceMotion: boolean; swipeMode: 'curve' | 'real' | 'aim' | 'spin' };
  quality: { setting: QualitySetting };
  devTools: boolean;
  /** null if unlocked, otherwise how to unlock it. */
  lockReason(kind: UnlockKind, id: string): string | null;
  /** A character's bat, and changing it. */
  batFor(id: StyleId): Bat;
  setBat(id: StyleId, bat: Bat): void;

  startAiMatch(): void;
  /** You and an AI partner against two AI. */
  startDoubles(): void;
  startPractice(): void;
  startTutorial(): void;
  /** The Locker: stats, badges and unlocks. */
  openCareer(): void;
  /** The World Tour. */
  openTour(): void;
  /** One line about World Tour progress for the title screen. */
  tourSummary(): string;
  readonly drills: readonly Drill[];
  drillOpen(index: number): boolean;
  drillStars(id: string): number;
  drillBest(id: string): number;
  startDrill(id: string): void;
  showHowTo(): void;
  createOnline(): void;
  joinOnline(code: string): void;
  resume(): void;
  /** A rally has been recorded that can be replayed from the pause menu. */
  readonly canReplay: boolean;
  /** Watch the last rally (from the pause menu). */
  watchReplay(): void;
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
  setMusic(m: boolean): void;
  setAutoReplay(a: boolean): void;
  setArcadeFx(a: boolean): void;
  setQuality(q: QualitySetting): void;
  setBloom(on: boolean): void;
  setFullSpeedOut(on: boolean): void;
  setCallouts(on: boolean): void;
  setMjMode(on: boolean): void;
  setSpinPalette(p: 'standard' | 'colourblind'): void;
  setSpinLabel(on: boolean): void;
  setSwipeMode(m: 'curve' | 'real' | 'aim' | 'spin'): void;
  setReduceMotion(on: boolean): void;
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
/** Small flat glyphs for the title buttons' icon tiles. */
const ICONS: Record<string, string> = {
  play: '<path d="M8 5v14l11-7z"/>',
  bat: '<circle cx="10" cy="10" r="6.5"/><path d="M14 14l5.5 5.5" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/>',
  ball: '<circle cx="12" cy="12" r="7"/>',
  cup: '<path d="M7 4h10v5a5 5 0 0 1-10 0zM4 5h3v3H5.5A1.5 1.5 0 0 1 4 6.5zM20 5h-3v3h1.5A1.5 1.5 0 0 0 20 6.5zM11 14h2v4h3v2H8v-2h3z"/>',
  globe: '<circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4 12h16M12 4c-3 3.2-3 12.8 0 16M12 4c3 3.2 3 12.8 0 16" fill="none" stroke="currentColor" stroke-width="1.6"/>',
  net: '<path d="M3 9h18v2H3zM5 11h2v8H5zM17 11h2v8h-2z"/><path d="M7 13h10M7 16h10M10 11v8M14 11v8" stroke="currentColor" stroke-width="1.2" fill="none"/>',
};
const ico = (k: string) => `<span class="mb-ico" aria-hidden="true"><svg viewBox="0 0 24 24" fill="currentColor">${ICONS[k]}</svg></span>`;

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
  /** A message at the top of the next screen shown (e.g. a drill result); cleared when it changes. */
  banner = '';
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
    onInstallChange(() => this.screen === 'settings' && this.refresh());
  }

  get visible() {
    return this.screen !== null;
  }

  show(screen: MenuScreen, pause?: PauseContext) {
    if (pause) this.pause = pause;
    if (screen === 'title' || screen === 'pause') this.home = screen;
    const changed = this.screen !== screen;
    if (changed && this.screen === 'training') this.banner = '';
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
    // Entry animations play only when a screen opens, not on every re-render.
    this.card.classList.toggle('entering', this.el.dataset.screen !== (s ?? ''));
    this.el.dataset.screen = s ?? '';
    if (s === 'title') this.card.innerHTML = this.titleHtml();
    else if (s === 'pause') this.card.innerHTML = this.pauseHtml();
    else if (s === 'vsai') this.card.innerHTML = this.vsAiHtml();
    else if (s === 'online') this.card.innerHTML = this.onlineHtml();
    else if (s === 'settings') this.card.innerHTML = this.settingsHtml();
    else if (s === 'characters') this.card.innerHTML = this.charactersHtml();
    else if (s === 'training') this.card.innerHTML = this.trainingHtml();
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
      <h1 class="menu-title">MEM <span>Table Tennis</span></h1>
      <p class="menu-tag">Spin, pace and placement.</p>
      <button data-a="go-characters" class="menu-player" aria-label="Playing as ${esc(st.character)}. Change player">
        <span class="mp-avatar" aria-hidden="true">${esc(st.character[0])}</span>
        <span class="mp-text"><small>Playing as</small><b>${esc(st.character)}</b><small>${esc(styleNote(st.id))}</small></span>
        <span class="mp-change">Change ›</span>
      </button>
      <div class="menu-buttons">
        <button data-a="quick" class="primary big c-blue">${ico('play')}<span class="mb-t">Quick match <small>vs ${AI_LEVELS[h.matchSettings.level].name} AI · best of ${h.matchSettings.bestOf}</small></span></button>
        <button data-a="go-vsai" class="c-orange">${ico('bat')}<span class="mb-t">Match vs AI <small>Choose opponent and format</small></span></button>
        <button data-a="tour" class="c-yellow">${ico('globe')}<span class="mb-t">World Tour <small>${esc(h.tourSummary())}</small></span></button>
        <button data-a="go-training" class="c-green">${ico('ball')}<span class="mb-t">Training <small>Drills, ball machine, tutorial</small></span></button>
        <button data-a="go-online" class="c-purple">${ico('net')}<span class="mb-t">Online <small>Play friends: singles or doubles</small></span></button>
        <div class="menu-row three">
          <button data-a="career" class="secondary">Locker</button>
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
        <button data-a="resume" class="primary big c-blue">${ico('play')}<span class="mb-t">Resume</span></button>
        ${this.host.canReplay ? `<button data-a="replay">Watch last rally${this.host.isTouch ? '' : ' <kbd>R</kbd>'}</button>` : ''}
        ${restart ? `<button data-a="restart">${restart}</button>` : ''}
        <button data-a="howto">How to play</button>
        <button data-a="go-settings">Settings</button>
        <button data-a="quit" class="secondary">${quit}</button>
      </div>
      ${this.host.devTools ? '<button data-a="inspect" class="link menu-dev">Developer: free camera</button>' : ''}
      <p class="menu-foot">${this.host.isTouch ? 'Tap Resume to carry on.' : '<b>Resume</b> takes the mouse back. <kbd>Esc</kbd> during play pauses.'}</p>`;
  }

  private trainingHtml() {
    const h = this.host;
    const stars = (n: number) => `<span class="stars" aria-label="${n} of 3 stars">${'★'.repeat(n)}<span class="off">${'★'.repeat(3 - n)}</span></span>`;
    const drill = (d: Drill) => {
      const i = h.drills.indexOf(d);
      const open = h.drillOpen(i);
      const best = h.drillStars(d.id);
      const score = h.drillBest(d.id);
      const need = h.drills.find((x) => x.id === d.requires) ?? h.drills[i - 1];
      return `<button class="menu-drill${open ? '' : ' locked'}" data-a="drill" data-id="${d.id}"${open ? '' : ' aria-disabled="true"'}>
          <span class="md-main"><b>${open ? '' : '🔒 '}${esc(d.name)}</b><small>${open ? esc(d.description) : `Earn a star in “${esc(need?.name ?? '')}” first`}</small></span>
          <span class="md-side">${stars(best)}<small>${open ? (score ? `best ${score.toLocaleString()}` : 'Start') : ''}</small></span>
        </button>`;
    };
    const drills = DRILL_CATEGORIES.map((cat) => {
      const list = h.drills.filter((d) => d.category === cat);
      return list.length ? `<div class="md-cat">${cat}</div>${list.map(drill).join('')}` : '';
    }).join('');
    return `
      ${this.header('Training')}
      ${this.banner ? `<div class="menu-banner">${this.banner}</div>` : ''}
      <div class="menu-buttons"><div class="menu-row">
        <button data-a="practice" class="c-green">${ico('ball')}<span class="mb-t">Ball machine <small>Free practice, no score</small></span></button>
        <button data-a="tutorial" class="c-blue">${ico('play')}<span class="mb-t">Tutorial <small>Guided, step by step</small></span></button>
      </div></div>
      ${this.group('Drills', `<div class="menu-drills">${drills}</div>`)}`;
  }

  private vsAiHtml() {
    const m = this.host.matchSettings;
    const levels = (Object.keys(AI_LEVELS) as AiLevel[])
      .map((id, i) => this.choice('level', id, AI_LEVELS[id].name, m.level === id, ['Gentle, slow to react', 'Solid all round', 'Fast, precise, aggressive', 'Barely misses. Good luck'][i]))
      .join('');
    const styles = [this.choice('aiStyle', 'random', 'Random', m.aiStyle === 'random', 'Surprise me')]
      .concat(FREE_PLAY_OPPONENT_IDS.map((id) => this.choice('aiStyle', id, STYLES[id].character, m.aiStyle === id, styleNote(id))))
      .join('');
    const formats = BEST_OF.map((n) => this.choice('bestOf', String(n), `Best of ${n}`, m.bestOf === n)).join('');
    return `
      ${this.header('Match vs AI')}
      ${this.group('Mode', `<div class="menu-choices">${this.choice('doubles', '0', 'Singles', !m.doubles, '1 v 1')}${this.choice('doubles', '1', 'Doubles', m.doubles, 'You + AI partner v 2 AI')}</div>`)}
      ${this.group('Opponent level', `<div class="menu-choices">${levels}</div>`)}
      ${m.doubles ? this.doublesLineupHtml() : this.group('Opponent', `<div class="menu-choices wrap">${styles}</div>`)}
      ${this.group('Format', `<div class="menu-choices">${formats}</div>`)}
      ${this.group('Venue', `<div class="menu-choices wrap">${(Object.keys(VENUES) as VenueId[]).map((id) => this.choice('venue', id, VENUES[id].name, this.host.look.venue === id, undefined, this.host.lockReason('venue', id))).join('')}</div>`)}
      <div class="menu-actions"><button data-a="start" class="primary big">Start match</button></div>`;
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
        .concat(FREE_PLAY_OPPONENT_IDS.map((id) => this.choice(slot, id, STYLES[id].character, m[slot] === id, others.has(id) ? (id === h.realism.style ? 'You' : 'In the game') : STYLES[id].role, null, others.has(id))))
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
        ${this.group('Difficulty (realism)', `<div class="menu-choices">${realism}</div>${custom ? `<p class="menu-note">Custom setting (${h.realism.percent}%): pick a preset to change it.</p>` : ''}`)}
        ${this.group('Your character', `<button data-a="go-characters" class="menu-player compact"><span class="mp-avatar" aria-hidden="true">${esc(STYLES[h.realism.style].character[0])}</span><span class="mp-text"><b>${esc(STYLES[h.realism.style].character)}</b><small>${esc(styleNote(h.realism.style))}</small></span><span class="mp-change">Change ›</span></button>`)}
        ${this.group('Venue', `<div class="menu-choices wrap">${venues}</div>`)}
        ${this.group(
          'Sound',
          `<label class="menu-slider"><span>Volume</span><input type="range" data-k="volume" min="0" max="1" step="0.05" value="${h.look.volume}" aria-label="Volume"><output>${Math.round(h.look.volume * 100)}%</output></label>
           ${toggle('muted', 'Mute', h.look.muted)}
           ${toggle('music', 'Music', h.look.music, 'A background song for each venue')}
           ${toggle('ambience', 'Venue ambience', h.look.ambience, 'Office hum, server fans, wind')}
           ${toggle('mjMode', 'MJ mode', h.look.mjMode, 'Every smash, yours or the AI’s, comes with a grunt. Hee-hee!')}`,
        )}
        ${this.group(
          'Gameplay & effects',
          `${toggle('arcadeFx', 'Arcade effects', h.look.arcadeFx, 'Hit-stop, camera shake, sparks, crowd')}
           ${toggle('fullSpeedOut', 'Your shots at full speed', h.look.fullSpeedOut, 'The game slows down only for balls coming at you (offline)')}
           ${toggle('autoReplay', 'Auto-replay long rallies', h.look.autoReplay)}
           <p class="menu-note">Angling your ${h.isTouch ? 'swipe' : 'flick'} sideways (up-left, up-right) does:</p>
           <div class="menu-choices wrap">${this.choice('swipeMode', 'curve', 'Aim + curve in', h.look.swipeMode === 'curve', 'Aims, and the ball bends in toward where you aimed (recommended)')}${this.choice('swipeMode', 'real', 'Aim + real brush', h.look.swipeMode === 'real', 'Aims, and brushes the way the bat travels: it curves away from the aim')}${this.choice('swipeMode', 'aim', 'Aim only', h.look.swipeMode === 'aim', 'No sidespin from the angle: use the hook keys or buttons')}${this.choice('swipeMode', 'spin', 'Spin only', h.look.swipeMode === 'spin', 'Sidespin only, no aiming')}</div>
           ${toggle('callouts', 'Point call-outs', h.look.callouts, 'A call after each point: NET, OUT, ACE…')}`,
        )}
        ${this.group(
          'Accessibility',
          `<p class="menu-note">The ball's trail is coloured by its spin.</p>
           <div class="menu-choices">${this.choice('spinPalette', 'standard', 'Standard colours', h.look.spinPalette === 'standard', 'Red topspin · green backspin · yellow sidespin')}${this.choice('spinPalette', 'colourblind', 'Colour-blind safe', h.look.spinPalette === 'colourblind', 'Orange topspin · blue backspin · yellow sidespin')}</div>
           ${toggle('spinLabel', 'Spin label', h.look.spinLabel, 'Names the spin of the ball coming at you (▲ topspin, ▼ backspin, ↻ sidespin), so you don’t need the colours')}
           ${toggle('reduceMotion', 'Reduce motion', h.look.reduceMotion, 'No camera shake, zoom kick, hit-stop or screen flash')}`,
        )}
        ${this.group('Camera', `<div class="menu-choices">${this.choice('cam', 'dynamic', 'Dynamic', h.camMode === 'dynamic', 'Follows the play (recommended)')}${this.choice('cam', 'close', 'Close', h.camMode === 'close', 'Behind you, more depth')}${this.choice('cam', 'classic', 'Classic', h.camMode === 'classic', 'High and steady, like TV')}</div>`)}
        ${this.group('Graphics quality', `<div class="menu-choices">${quality}</div>${toggle('bloom', 'Glow effects', h.look.bloom, 'Bloom on the ball trail, sparks and lights (High quality only)')}`)}
        ${canInstall() ? this.group('App', '<div class="menu-choices"><button data-a="install" class="menu-choice">Install app</button></div>') : ''}
        ${this.group('Advanced', toggle('devTools', 'Developer tools', h.devTools, 'Physics tuning, ball machine and every assist. <kbd>`</kbd> toggles it too.'))}
      </div>`;
  }

  private charactersHtml() {
    const h = this.host;
    const id = this.browse!;
    const st = STYLES[id];
    const lock = h.lockReason('style', id);
    const current = h.realism.style === id;
    const list = PLAYABLE_STYLE_IDS.map((sid) => {
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
          ${lock ? `<div class="cs-rubbers"><span class="k">Forehand</span>${rubber(st.rubbers.forehand)}<span class="k">Backhand</span>${rubber(st.rubbers.backhand)}</div>` : this.batHtml(id)}
          <div class="menu-actions">${action}</div>
        </div>
      </div>
      <div class="cs-list" role="group" aria-label="Characters">${list}</div>`;
  }

  /** The bat editor: blade and the rubber on each side, with what each does. Locked kit says how to unlock it. */
  private batHtml(id: StyleId) {
    const h = this.host;
    const bat = h.batFor(id);
    const blade = BLADES[bat.blade];
    const opt = (v: string, label: string, sel: boolean, lock: string | null) => `<option value="${esc(v)}"${sel ? ' selected' : ''}${lock ? ' disabled' : ''}>${lock ? '🔒 ' : ''}${esc(label)}${lock ? ` — ${esc(lock)}` : ''}</option>`;
    const blades = BLADE_IDS.map((b) => opt(b, BLADES[b].name, b === bat.blade, h.lockReason('blade', b))).join('');
    const rubbers = (sel: string) => BAT_RUBBER_IDS.map((r) => opt(r, `${RUBBERS[r].name} (${RUBBERS[r].kind})`, r === sel, h.lockReason('rubber', r))).join('');
    // 1–5 pips for a quick read of the kit.
    const pips = (v: number) => `<span class="bat-pips" aria-label="${v} out of 5">${'●'.repeat(v)}${'○'.repeat(5 - v)}</span>`;
    const r = RUBBERS[bat.forehand];
    // Starter kit (Classic on a Starter blade) rates 2; only the best kit reaches 5.
    const speedScore = (e: number) => (e < 0.86 ? 1 + (e - 0.62) / 0.24 : 2 + (3 * (e - 0.86)) / 0.1);
    const spinScore = (g: number) => (g < 1.43 ? 1 + g / 1.43 : 2 + (3 * (g - 1.43)) / 0.59);
    const lvl = (x: number, lo: number, hi: number) => Math.max(1, Math.min(5, Math.round(1 + (4 * (x - lo)) / (hi - lo))));
    return `<div class="cs-bat">
      <div class="cs-bat-row"><label for="bat-blade">Blade</label><select id="bat-blade" data-k="batBlade">${blades}</select></div>
      <div class="cs-bat-row"><label for="bat-fh">Forehand</label><select id="bat-fh" data-k="batFH">${rubbers(bat.forehand)}</select></div>
      <div class="cs-bat-row"><label for="bat-bh">Backhand</label><select id="bat-bh" data-k="batBH">${rubbers(bat.backhand)}</select></div>
      <div class="cs-bat-stats">
        <span>Speed ${pips(lvl(speedScore(Math.min(0.96, blade.speed * r.restitution)), 1, 5))}</span>
        <span>Control ${pips(lvl(blade.control, 0, 0.45))}</span>
        <span>Spin ${pips(lvl(spinScore(r.friction * (1 + r.tangentialRestitution)), 1, 5))}</span>
      </div>
      <p class="cs-bat-note">${esc(blade.description)} <small>(Stats for the forehand side.)</small></p>
    </div>`;
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
    return hit ? hit[0] : `Custom (${p}%)`;
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
        case 'install':
          void install();
          return;
        case 'start':
          return h.matchSettings.doubles ? h.startDoubles() : h.startAiMatch();
        case 'practice':
          return h.startPractice();
        case 'tutorial':
          return h.startTutorial();
        case 'career':
          return h.openCareer();
        case 'tour':
          return h.openTour();
        case 'drill':
          if (t.getAttribute('aria-disabled') === 'true') {
            t.classList.remove('shake');
            void t.offsetWidth;
            t.classList.add('shake');
            return;
          }
          return h.startDrill(t.dataset.id!);
        case 'howto':
          return h.showHowTo();
        case 'create':
          return h.createOnline();
        case 'join':
          return h.joinOnline(h.onlineSettings.code);
        case 'resume':
          return h.resume();
        case 'replay':
          return h.watchReplay();
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
      case 'swipeMode':
        h.setSwipeMode(v as 'curve' | 'real' | 'aim' | 'spin');
        break;
      case 'spinPalette':
        h.setSpinPalette(v === 'colourblind' ? 'colourblind' : 'standard');
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
    } else if (e.type === 'change' && (k === 'batBlade' || k === 'batFH' || k === 'batBH') && this.browse) {
      const bat = { ...h.batFor(this.browse) };
      if (k === 'batBlade') bat.blade = t.value as BladeId;
      else if (k === 'batFH') bat.forehand = t.value;
      else bat.backhand = t.value;
      h.setBat(this.browse, bat);
      this.refresh();
    } else if (e.type === 'change') {
      if (k === 'muted') h.setMuted(t.checked);
      else if (k === 'ambience') h.setAmbience(t.checked);
      else if (k === 'music') h.setMusic(t.checked);
      else if (k === 'arcadeFx') h.setArcadeFx(t.checked);
      else if (k === 'autoReplay') h.setAutoReplay(t.checked);
      else if (k === 'bloom') h.setBloom(t.checked);
      else if (k === 'fullSpeedOut') h.setFullSpeedOut(t.checked);
      else if (k === 'callouts') h.setCallouts(t.checked);
      else if (k === 'mjMode') h.setMjMode(t.checked);
      else if (k === 'spinLabel') h.setSpinLabel(t.checked);
      else if (k === 'reduceMotion') h.setReduceMotion(t.checked);
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
    if (this.screen === 'pause' && e.code === 'KeyR' && !e.repeat && this.host.canReplay) {
      e.preventDefault();
      this.host.watchReplay();
      return;
    }
    if (target.tagName === 'INPUT' && (target as HTMLInputElement).type === 'text') {
      if (e.key === 'Enter' && target.dataset.k === 'code') this.host.joinOnline(this.host.onlineSettings.code);
      return;
    }
    // Character select: left/right flip through the characters.
    if (this.screen === 'characters' && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const i = PLAYABLE_STYLE_IDS.indexOf(this.browse!);
      this.browse = PLAYABLE_STYLE_IDS[(i + (e.key === 'ArrowRight' ? 1 : -1) + PLAYABLE_STYLE_IDS.length) % PLAYABLE_STYLE_IDS.length];
      this.render();
      (this.card.querySelector(`.cs-pick[data-v="${this.browse}"]`) as HTMLElement | null)?.focus();
      return;
    }
    // Arrow keys move between buttons, like a console menu.
    // (A dropdown keeps its own arrow keys.)
    if (target.tagName === 'SELECT') return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && target.tagName !== 'INPUT')) {
      const items = [...this.card.querySelectorAll<HTMLElement>('button, input, select')].filter((x) => x.offsetParent !== null);
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
