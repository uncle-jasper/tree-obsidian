// Just Write (Tree's Ctrl/Cmd+Shift+J): 30 minutes with the look locked, or 500 new words in this note.
import { MarkdownView } from 'obsidian';
import type TreePlugin from './main';
import { countWords } from './status';

const JW_MINUTES = 30;
const JW_WORDS   = 500;

export interface JustWriteState { until: number; wordStart: number; path: string; }

export class JustWrite {
  constructor(private plugin: TreePlugin) {}

  get state() { return this.plugin.settings.justWrite; }
  get active() { return !!this.state && Date.now() < this.state.until; }

  // On load: pick up a session that was running when Obsidian closed, as Tree does after a reload
  resume() {
    if (this.state && !this.active) { this.plugin.settings.justWrite = null; void this.plugin.saveData(this.plugin.settings); }
    this.apply();
    this.plugin.registerInterval(window.setInterval(() => this.tick(), 2000));
  }

  async start() {
    if (this.active) return;
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return;
    this.plugin.quick.close();
    this.plugin.settings.justWrite = {
      until: Date.now() + JW_MINUTES * 60 * 1000,
      wordStart: countWords(view.editor.getValue()),
      path: view.file.path,
    };
    await this.plugin.saveSettings();
    this.apply();
    this.plugin.status.typeMessage('just write mode. 30 minutes. no escape.', true);
  }

  private async end(msg: string | null) {
    if (!this.state) return;
    this.plugin.settings.justWrite = null;
    await this.plugin.saveSettings();
    this.apply();
    if (msg) this.plugin.status.typeMessage(msg, true);
  }

  // Timer, polled every 2s like Tree (survives sleep and throttled timers)
  private tick() {
    if (this.state && Date.now() >= this.state.until) void this.end(null);
  }

  // Called after you type: 500 new words in the Just Write note releases you early
  checkRelease(view: MarkdownView | null) {
    if (!this.active || !view?.file || view.file.path !== this.state!.path) return;
    if (countWords(view.editor.getValue()) - this.state!.wordStart >= JW_WORDS) {
      void this.end('500 words. you have earned your freedom.');
    }
  }

  // Lock styling + italicize the Just Write note's tab, as Tree does
  apply() {
    const on = this.active;
    document.body.toggleClass('tree-just-write', on);
    this.plugin.app.workspace.iterateAllLeaves(leaf => {
      const header = (leaf as any).tabHeaderEl as HTMLElement | undefined;
      const path = leaf.view instanceof MarkdownView ? leaf.view.file?.path : undefined;
      header?.toggleClass('tree-just-write-tab', on && path === this.state?.path);
    });
  }
}
