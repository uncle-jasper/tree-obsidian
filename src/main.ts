import { MarkdownView, Platform, Plugin, setIcon } from 'obsidian';
import { EditorView, drawSelection } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { DEFAULT_SETTINGS, SECRET_THEMES, THEMES, TreeSettings, TreeSettingTab } from './settings';
import { GoalInput, StatusLine, countWords, fmtMinutes, noteBody, pick, timeMessages } from './status';
import { QuickPanel } from './quick';
import { CUSTOM_KEYS, CUSTOM_VARS, CursorStyle, customPalette, isCustom } from './custom';
import { JustWrite } from './justwrite';
import { Eggs } from './eggs';
import { WordPress } from './wordpress';
import { autoPairExtension, bottomScrollMargin, shapeCursorExtension, tabOutExtension, typewriterExtension, zenExtension } from './editor';

export default class TreePlugin extends Plugin {
  settings!: TreeSettings;
  status!: StatusLine;
  quick!: QuickPanel;
  justWrite!: JustWrite;
  settingTab!: TreeSettingTab;
  focusActive = false;
  private focusHidExtras = false;   // focus mode hid properties and mentions, so leaving it shows them again
  private exitEl: HTMLElement | null = null;
  private focusTabsEl: HTMLElement | null = null;   // the pane focus mode keeps on screen
  private refreshQueued = false;
  private editQueued = false;

  async onload() {
    await this.loadSettings();
    this.applyAppearance();

    this.quick  = new QuickPanel(this);
    this.justWrite = new JustWrite(this);
    new Eggs(this).register();
    new WordPress(this).register();
    this.status = new StatusLine(() => this.settings, {
      onQuick: anchor => this.quick.toggle(anchor),
      onSetGoal: goal => this.setGoal(goal),
      onPeekObsidian: on => this.peekObsidian(on),
      onToggleExtras: () => this.toggleExtras(),
    });
    this.settingTab = new TreeSettingTab(this.app, this);
    this.addSettingTab(this.settingTab);

    // Status line follows the active note
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => { this.attachStatus(); this.markFocusTabs(); }));
    this.registerEvent(this.app.workspace.on('layout-change', () => { this.attachStatus(); this.justWrite.apply(); this.markFocusTabs(); }));
    // Make sure the editor draws its own cursor (so Tree's cursor styles apply), blinking at Tree's 1s rate
    this.registerEditorExtension(drawSelection({ cursorBlinkRate: 1000 }));
    this.registerEditorExtension([zenExtension(() => this.settings), typewriterExtension(() => this.settings), tabOutExtension(() => this.settings), autoPairExtension(), bottomScrollMargin(), shapeCursorExtension(() => this.cursorStyle())]);
    this.registerEditorExtension(EditorView.updateListener.of(u => {
      if (!(u.docChanged || u.selectionSet)) return;
      // Only your own typing counts toward milestones and idle nudges, not sync or other plugins
      if (u.docChanged && u.transactions.some(tr => tr.annotation(Transaction.userEvent) !== undefined)) this.editQueued = true;
      this.queueRefresh();
    }));

    // Word frequency: double-click a word to see how often it appears in the note (Tree's dblclick)
    this.registerDomEvent(document, 'dblclick', (e: MouseEvent) => {
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!view || !(e.target as HTMLElement).closest('.markdown-source-view')) return;
      const sel = view.editor.getSelection().trim().toLowerCase();
      if (!sel || /\s/.test(sel)) return;
      const escaped = sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const count = (noteBody(view.editor.getValue()).body.toLowerCase().match(new RegExp('\\b' + escaped + '\\b', 'g')) || []).length;
      if (count > 0) this.status.showWordCount(sel, count);
    });

    this.app.workspace.onLayoutReady(() => {
      const bar = document.querySelector<HTMLElement>('.status-bar');
      if (bar) {
        this.registerDomEvent(bar, 'mouseenter', () => this.peekObsidian(true));
        this.registerDomEvent(bar, 'mouseleave', () => this.peekObsidian(false));
      }
      this.attachStatus();
      this.justWrite.resume();
      this.lastTick = Date.now();
      this.registerInterval(window.setInterval(() => this.tickTimeGoal(), 5000));
      window.setTimeout(() => this.status.welcome(), 800);
    });

    // Focus mode
    this.addCommand({ id: 'toggle-focus', name: 'Toggle focus mode', callback: () => this.toggleFocus() });
    this.addCommand({ id: 'quick-style', name: 'Change theme and font', callback: () => {
      if (this.justWrite.active) return;   // the look is locked during Just Write
      this.quick.toggle(this.status.el.isConnected ? this.status.el : document.body);
    } });
    // Tree's Ctrl+Shift+W. Free on Mac (Obsidian closes windows with Cmd+Shift+W); elsewhere Ctrl is Mod, so no default.
    this.addCommand({ id: 'word-goal', name: 'Set word or time goal for this note',
      hotkeys: Platform.isMacOS ? [{ modifiers: ['Ctrl', 'Shift'], key: 'W' }] : [],
      callback: () => this.status.editGoal() });
    this.addCommand({ id: 'time-goal', name: 'Set time goal for this note', callback: () => this.status.editGoal('m') });
    // A goal belongs to its note, so it follows the note when it's renamed or moved
    this.registerEvent(this.app.vault.on('rename', (file, oldPath) => {
      const { goal, timeGoal } = this.settings;
      if (goal?.path !== oldPath && timeGoal?.path !== oldPath) return;
      if (goal?.path === oldPath) goal.path = file.path;
      if (timeGoal?.path === oldPath) timeGoal.path = file.path;
      void this.saveData(this.settings);
    }));
    this.addCommand({ id: 'just-write', name: 'Just Write (30 minutes or 500 words)', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'J' }],
      callback: () => this.justWrite.start() });
    this.addCommand({ id: 'toggle-zen', name: 'Toggle zen mode', callback: () => this.toggleZen() });
    this.addCommand({ id: 'cycle-zen', name: 'Switch zen mode between sentence and paragraph', callback: () => this.cycleZenGranularity() });
    this.addCommand({ id: 'toggle-typewriter', name: 'Toggle typewriter mode', callback: () => this.toggleTypewriter() });
    // Ctrl+Shift+H, as Tree hides its toolbar. Free on Mac and iPad, where Obsidian's shortcuts use Cmd; elsewhere Ctrl is Mod, so no default.
    this.addCommand({ id: 'toggle-extras', name: 'Toggle quiet mode (hide properties and mentions)',
      hotkeys: Platform.isMacOS || Platform.isIosApp ? [{ modifiers: ['Ctrl', 'Shift'], key: 'H' }] : [],
      callback: () => this.toggleExtras() });
    this.addRibbonIcon('maximize-2', 'Tree: focus mode', () => this.toggleFocus());

    this.exitEl = document.body.createDiv({ cls: 'tree-focus-exit', attr: { 'aria-label': 'Leave focus mode' } });
    setIcon(this.exitEl, 'minimize-2');
    this.registerDomEvent(this.exitEl, 'click', () => this.setFocus(false));

    // Escape leaves focus mode, unless something else (a modal, menu, suggester) wants it first
    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (!this.focusActive || e.key !== 'Escape') return;
      if (this.quick.isOpen || (document.activeElement as HTMLElement | null)?.closest('.tree-status') || document.querySelector('.modal-container, .menu, .suggestion-container, .prompt')) return;
      if ((this.app.vault as any).getConfig?.('vimMode')) return;
      e.preventDefault();
      this.setFocus(false);
    }, true);
  }

  onunload() {
    this.quick.close();
    this.status.destroy();
    this.exitEl?.remove();
    this.focusTabsEl?.removeClass('tree-focus-tabs');
    document.body.removeClass('tree-focus', 'tree-extras-by-focus', 'tree-typewriter', 'tree-just-write', 'tree-hide-obsidian-status', 'tree-hide-extras', 'tree-obsidian-peek', 'tree-font-on', 'tree-size-on', 'tree-cursor-block', 'tree-cursor-underline', ...this.themeClasses());
    document.body.style.removeProperty('--tree-font');
    document.body.style.removeProperty('--tree-font-size');
    document.body.style.removeProperty('--tree-line-length');
    CUSTOM_VARS.forEach(v => document.body.style.removeProperty(v));
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // fresh copies, so editing custom colors never touches the defaults
    for (const key of CUSTOM_KEYS) this.settings[key] = Object.assign({}, DEFAULT_SETTINGS[key], data?.[key]);
    delete (this.settings as any).focusWidth;   // replaced by lineLength in 0.2
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.applyAppearance();
    this.attachStatus();
  }

  private themeClasses() {
    return [...Object.keys(THEMES), ...Object.keys(SECRET_THEMES)].filter(Boolean).map(t => 'tree-theme-' + t);
  }

  // A custom theme picks its cursor. The CRT themes have their block and Doogie Journal its underline; the rest use the line.
  private cursorStyle(): CursorStyle {
    const s = this.settings;
    if (s.theme === 'terminal-crt' || s.theme === 'amber-crt') return 'block';
    if (s.theme === 'doogie-journal') return 'underline';
    return (isCustom(s.theme) && s[s.theme].cursor) || 'line';
  }

  applyAppearance() {
    const s = this.settings;
    const body = document.body;
    body.removeClass(...this.themeClasses());
    if (s.theme) body.addClass('tree-theme-' + s.theme);
    CUSTOM_VARS.forEach(v => body.style.removeProperty(v));
    if (isCustom(s.theme)) {
      for (const [v, val] of Object.entries(customPalette(s[s.theme]))) body.style.setProperty(v, val);
    }
    body.toggleClass('tree-cursor-block', this.cursorStyle() === 'block');
    body.toggleClass('tree-cursor-underline', this.cursorStyle() === 'underline');

    body.toggleClass('tree-font-on', !!s.font);
    body.style.setProperty('--tree-font', s.font);
    body.toggleClass('tree-size-on', s.fontSize > 0);
    body.style.setProperty('--tree-font-size', s.fontSize + 'px');
    body.style.setProperty('--tree-line-length', s.lineLength + 'ch');
    body.toggleClass('tree-typewriter', s.typewriter);
    body.toggleClass('tree-hide-obsidian-status', s.statusLine && s.hideObsidianStatus);
    body.toggleClass('tree-hide-extras', s.hideExtras || this.focusHidExtras);
    body.toggleClass('tree-extras-by-focus', this.focusHidExtras);   // so other windows keep theirs
    this.app.workspace.updateOptions();   // re-run editor extensions so zen/typewriter changes show at once
  }

  // The note you're with: the active one, or while a sidebar (files, search, outline) has the focus, the main
  // area's most recent pane if that's a note. So a click into the file explorer doesn't take the status line away.
  private currentNote(): MarkdownView | null {
    const ws = this.app.workspace;
    const active = ws.getActiveViewOfType(MarkdownView);
    if (active) return active;
    const view = ws.getMostRecentLeaf(ws.rootSplit)?.view;
    return view instanceof MarkdownView ? view : null;
  }

  private attachStatus() {
    this.status.attach(this.currentNote());
  }

  private queueRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      const edited = this.editQueued;
      this.editQueued = false;
      const view = this.currentNote();
      this.status.refresh(view, edited);
      if (edited) this.justWrite.checkRelease(view);
    });
  }

  toggleFocus() {
    this.setFocus(!this.focusActive);
  }

  setFocus(on: boolean) {
    if (on === this.focusActive) return;
    this.focusActive = on;
    document.body.toggleClass('tree-focus', on);
    // Focus mode hides properties and mentions too, and brings them back on the way out,
    // unless they were already hidden going in
    this.focusHidExtras = on && !this.settings.hideExtras;
    this.applyAppearance();
    this.markFocusTabs();
    this.attachStatus();
    if (on) {
      this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.focus();
      this.status.typeMessage('focus mode.');
    }
  }

  // Focus mode shows one pane: the main window's most recent, even while the active note is in another window.
  private markFocusTabs() {
    const ws = this.app.workspace;
    const leaf = this.focusActive ? ws.getMostRecentLeaf(ws.rootSplit) : null;
    const el = leaf?.view.containerEl.closest<HTMLElement>('.workspace-tabs') ?? null;
    if (el === this.focusTabsEl) return;
    this.focusTabsEl?.removeClass('tree-focus-tabs');
    el?.addClass('tree-focus-tabs');
    this.focusTabsEl = el;
  }

  async toggleZen() {
    this.settings.zen = !this.settings.zen;
    await this.saveSettings();
    this.status.typeMessage(this.settings.zen ? 'zen mode on.' : 'zen mode off.');
  }

  async cycleZenGranularity() {
    this.settings.zenGranularity = this.settings.zenGranularity === 'sentence' ? 'paragraph' : 'sentence';
    this.settings.zen = true;
    await this.saveSettings();
    this.status.typeMessage('zen: ' + this.settings.zenGranularity + '.');
  }

  // The ¶ (or Ctrl+Shift+H). Pressing it in focus mode is your call, so leaving focus mode won't undo it.
  async toggleExtras() {
    const hide = !document.body.hasClass('tree-hide-extras');
    this.focusHidExtras = false;
    this.settings.hideExtras = hide;
    await this.saveSettings();
    this.status.typeMessage(hide ? 'quiet mode on.' : 'quiet mode off.');
  }

  async toggleTypewriter() {
    this.settings.typewriter = !this.settings.typewriter;
    await this.saveSettings();
    this.status.typeMessage(this.settings.typewriter ? 'typewriter on.' : 'typewriter off.');
  }

  // Word goal (Tree's setGoal): counts from now, in this note only. A time goal works the same way,
  // and a note has one or the other.
  async setGoal(input: GoalInput) {
    const view = this.currentNote();
    if (!view?.file) return;
    const path = view.file.path;
    this.settings.goal = 'words' in input
      ? { target: input.words, baseline: countWords(noteBody(view.editor.getValue()).body), path }
      : null;
    this.settings.timeGoal = 'minutes' in input ? { minutes: input.minutes, spentMs: 0, path } : null;
    this.lastTick = Date.now();
    await this.saveSettings();
    this.status.typeMessage('words' in input ? 'word goal: ' + input.words + '.'
      : 'minutes' in input ? 'time goal: ' + fmtMinutes(input.minutes) + '.'
      : 'goal cleared.');
  }

  // Time goal: every 5s, add the time since the last tick, but only while the goal's note is the one you're with (currentNote)
  // and its Obsidian window (the main one or a popout) is in front. Locking the screen takes focus away;
  // sleep leaves a gap, which is dropped.
  private lastTick = 0;
  private tickTimeGoal() {
    const now = Date.now(), gap = now - this.lastTick;
    this.lastTick = now;
    const g = this.settings.timeGoal;
    if (!g || gap > 10000) return;
    const view = this.currentNote();
    if (view?.file?.path !== g.path) return;
    const doc = view.containerEl.ownerDocument;
    if (doc.visibilityState !== 'visible' || !doc.hasFocus()) return;
    const target = g.minutes * 60000, before = g.spentMs;
    g.spentMs += gap;
    if (before < target && g.spentMs >= target) this.status.typeMessage(pick(timeMessages));
    // The status line shows whole minutes, so refresh (and save) only when the minute turns over
    if (Math.floor(before / 60000) !== Math.floor(g.spentMs / 60000)) {
      this.status.refresh(view);
      void this.saveData(this.settings);
    }
  }

  // Obsidian's status bar shows while the mouse is on Tree's ⋯ or on the bar itself
  private peekTimer = 0;
  peekObsidian(on: boolean) {
    clearTimeout(this.peekTimer);
    if (on) { document.body.addClass('tree-obsidian-peek'); return; }
    // a moment's grace to move from the ⋯ onto the bar
    this.peekTimer = window.setTimeout(() => {
      if (!document.querySelector('.status-bar:hover')) document.body.removeClass('tree-obsidian-peek');
    }, 250);
  }
}
