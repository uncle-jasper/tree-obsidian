import { MarkdownView, Plugin, setIcon } from 'obsidian';
import { EditorView, drawSelection } from '@codemirror/view';
import { Transaction } from '@codemirror/state';
import { DEFAULT_SETTINGS, SECRET_THEMES, THEMES, TreeSettings, TreeSettingTab } from './settings';
import { StatusLine } from './status';
import { QuickPanel } from './quick';
import { CUSTOM_VARS, customPalette } from './custom';
import { JustWrite } from './justwrite';
import { Eggs } from './eggs';
import { tabOutExtension, typewriterExtension, zenExtension } from './editor';

export default class TreePlugin extends Plugin {
  settings!: TreeSettings;
  status!: StatusLine;
  quick!: QuickPanel;
  justWrite!: JustWrite;
  focusActive = false;
  private exitEl: HTMLElement | null = null;
  private refreshQueued = false;
  private editQueued = false;

  async onload() {
    await this.loadSettings();
    this.applyAppearance();

    this.quick  = new QuickPanel(this);
    this.justWrite = new JustWrite(this);
    new Eggs(this).register();
    this.status = new StatusLine(() => this.settings, anchor => this.quick.toggle(anchor));
    this.addSettingTab(new TreeSettingTab(this.app, this));

    // Status line follows the active note
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.attachStatus()));
    this.registerEvent(this.app.workspace.on('layout-change', () => { this.attachStatus(); this.justWrite.apply(); }));
    // Make sure the editor draws its own cursor (so Tree's cursor styles apply), blinking at Tree's 1s rate
    this.registerEditorExtension(drawSelection({ cursorBlinkRate: 1000 }));
    this.registerEditorExtension([zenExtension(() => this.settings), typewriterExtension(() => this.settings), tabOutExtension(() => this.settings)]);
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
      const count = (view.editor.getValue().toLowerCase().match(new RegExp('\\b' + escaped + '\\b', 'g')) || []).length;
      if (count > 0) this.status.showWordCount(sel, count);
    });

    this.app.workspace.onLayoutReady(() => {
      this.attachStatus();
      this.justWrite.resume();
      window.setTimeout(() => this.status.welcome(), 800);
    });

    // Focus mode
    this.addCommand({ id: 'toggle-focus', name: 'Toggle focus mode', callback: () => this.toggleFocus() });
    this.addCommand({ id: 'quick-style', name: 'Change theme and font', callback: () => {
      if (this.justWrite.active) return;   // the look is locked during Just Write
      this.quick.toggle(this.status.el.isConnected ? this.status.el : document.body);
    } });
    this.addCommand({ id: 'just-write', name: 'Just Write (30 minutes or 500 words)', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: 'J' }],
      callback: () => this.justWrite.start() });
    this.addCommand({ id: 'toggle-zen', name: 'Toggle zen mode', callback: () => this.toggleZen() });
    this.addCommand({ id: 'cycle-zen', name: 'Switch zen mode between sentence and paragraph', callback: () => this.cycleZenGranularity() });
    this.addCommand({ id: 'toggle-typewriter', name: 'Toggle typewriter mode', callback: () => this.toggleTypewriter() });
    this.addRibbonIcon('maximize-2', 'Tree: focus mode', () => this.toggleFocus());

    this.exitEl = document.body.createDiv({ cls: 'tree-focus-exit', attr: { 'aria-label': 'Leave focus mode' } });
    setIcon(this.exitEl, 'minimize-2');
    this.registerDomEvent(this.exitEl, 'click', () => this.setFocus(false));

    // Escape leaves focus mode, unless something else (a modal, menu, suggester) wants it first
    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (!this.focusActive || e.key !== 'Escape') return;
      if (this.quick.isOpen || document.querySelector('.modal-container, .menu, .suggestion-container, .prompt')) return;
      if ((this.app.vault as any).getConfig?.('vimMode')) return;
      e.preventDefault();
      this.setFocus(false);
    }, true);
  }

  onunload() {
    this.quick.close();
    this.status.destroy();
    this.exitEl?.remove();
    document.body.removeClass('tree-focus', 'tree-typewriter', 'tree-just-write', 'tree-font-on', 'tree-size-on', ...this.themeClasses());
    document.body.style.removeProperty('--tree-font');
    document.body.style.removeProperty('--tree-font-size');
    document.body.style.removeProperty('--tree-line-length');
    CUSTOM_VARS.forEach(v => document.body.style.removeProperty(v));
  }

  async loadSettings() {
    const data = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, data);
    // fresh copies, so editing custom colors never touches the defaults
    this.settings.custom  = Object.assign({}, DEFAULT_SETTINGS.custom,  data?.custom);
    this.settings.custom2 = Object.assign({}, DEFAULT_SETTINGS.custom2, data?.custom2);
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

  applyAppearance() {
    const s = this.settings;
    const body = document.body;
    body.removeClass(...this.themeClasses());
    if (s.theme) body.addClass('tree-theme-' + s.theme);
    CUSTOM_VARS.forEach(v => body.style.removeProperty(v));
    if (s.theme === 'custom' || s.theme === 'custom2') {
      for (const [v, val] of Object.entries(customPalette(s[s.theme]))) body.style.setProperty(v, val);
    }

    body.toggleClass('tree-font-on', !!s.font);
    body.style.setProperty('--tree-font', s.font);
    body.toggleClass('tree-size-on', s.fontSize > 0);
    body.style.setProperty('--tree-font-size', s.fontSize + 'px');
    body.style.setProperty('--tree-line-length', s.lineLength + 'ch');
    body.toggleClass('tree-typewriter', s.typewriter);
    this.app.workspace.updateOptions();   // re-run editor extensions so zen/typewriter changes show at once
  }

  private attachStatus() {
    this.status.attach(this.app.workspace.getActiveViewOfType(MarkdownView));
  }

  private queueRefresh() {
    if (this.refreshQueued) return;
    this.refreshQueued = true;
    requestAnimationFrame(() => {
      this.refreshQueued = false;
      const edited = this.editQueued;
      this.editQueued = false;
      const view = this.app.workspace.getActiveViewOfType(MarkdownView);
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
    if (on) {
      this.app.workspace.getActiveViewOfType(MarkdownView)?.editor.focus();
      this.status.typeMessage('focus mode.');
    }
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

  async toggleTypewriter() {
    this.settings.typewriter = !this.settings.typewriter;
    await this.saveSettings();
    this.status.typeMessage(this.settings.typewriter ? 'typewriter on.' : 'typewriter off.');
  }
}
