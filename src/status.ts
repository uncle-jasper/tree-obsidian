import { MarkdownView } from 'obsidian';
import type { TreeSettings } from './settings';

// Same pool as Tree's index.html
export const welcomeMessages = [
  'good to see you.',
  'let\'s write something.',
  'the cursor is ready.',
  'tree is listening.',
  'begin anywhere.',
  'what\'s on your mind?',
  'a blank page is an invitation.',
];

// Tree's milestone and idle messages, word for word
const milestoneMessages: Record<number, string> = {
  100:  'one hundred words. a proper start.',
  250:  'two hundred and fifty words. you\'re warming up.',
  500:  'five hundred words. half a page. keep going.',
  1000: 'one thousand words. now we\'re getting somewhere.',
  2000: 'two thousand words. that\'s a short story.',
  5000: 'five thousand words. seriously, well done.',
};
const milestones = [100, 250, 500, 1000, 2000, 5000];

const idleMessages = [
  'still there?',
  'the words aren\'t going to write themselves.',
  'take your time.',
  'waiting patiently.',
  'no rush.',
];
const IDLE_MS = 3 * 60 * 1000;

// Tree's word goal messages
const goalMessages = [
  'goal reached. well done.',
  'you hit your target.',
  'that\'s your word count. nice work.',
  'target reached. take a moment.',
];
const fmtGoal = (n: number) => (n >= 1000 ? (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k' : String(n));

export interface WordGoal { target: number; baseline: number; path: string; }

export interface StatusHooks {
  onQuick(anchor: HTMLElement): void;
  onSetGoal(target: number): void;       // 0 clears
  onPeekObsidian(on: boolean): void;     // the ⋯ that brings up Obsidian's own status bar
}

const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

export const countWords = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).filter(Boolean).length);
const plural = (n: number, word: string) => n + ' ' + word + (n !== 1 ? 's' : '');

// One status line, moved to whichever markdown leaf is active.
export class StatusLine {
  el: HTMLElement;
  private words: HTMLElement;
  private chars: HTMLElement;
  private centre: HTMLElement;
  private cursor: HTMLElement;
  private msg: HTMLElement;
  private busy = false;
  private timers: number[] = [];
  // Milestones count per note, and only while you're writing (as Tree resets them per tab)
  private notePath: string | null = null;
  private lastWords = 0;
  private reached = new Set<number>();
  private idleTimer = 0;
  private pending: string | null = null;   // an important message waiting for the current one to finish
  private goalBar: HTMLElement;
  private editingGoal = false;

  constructor(private getSettings: () => TreeSettings, private hooks: StatusHooks) {
    this.el = createDiv({ cls: 'tree-status' });
    // Unlike Tree: the Aa control has the left end to itself; the counts sit together on the right,
    // and a faint ⋯ at the far right is the one spot that brings up Obsidian's own status bar.
    const left = this.el.createDiv({ cls: 'tree-stat-left' });
    const quick = left.createSpan({ cls: 'tree-quick-toggle', text: 'Aa', attr: { 'aria-label': 'Theme and font' } });
    quick.onclick = () => { if (!document.body.hasClass('tree-just-write')) hooks.onQuick(this.el); };
    this.centre = this.el.createDiv({ cls: 'tree-stat-centre' });
    this.msg    = this.el.createDiv({ cls: 'tree-stat-msg' });
    const right = this.el.createDiv({ cls: 'tree-stat-right' });
    this.words  = right.createSpan({ cls: 'tree-stat-words', attr: { 'aria-label': 'Set a word goal' } });
    this.words.onclick = () => this.editGoal();
    this.chars  = right.createSpan();
    this.cursor = right.createSpan();
    const peek  = right.createSpan({ cls: 'tree-obsidian-peek', text: '⋯', attr: { 'aria-label': 'Obsidian status bar' } });
    peek.onmouseenter = () => hooks.onPeekObsidian(true);
    peek.onmouseleave = () => hooks.onPeekObsidian(false);
    // Tree's goal progress line along the bottom edge
    this.goalBar = this.el.createDiv({ cls: 'tree-goal-bar' });
  }

  // Click the word count (or Ctrl+Shift+W): it turns into a number box. Enter sets, 0 clears, Escape cancels.
  editGoal() {
    if (this.editingGoal || !this.el.isConnected) return;
    this.editingGoal = true;
    const goal = this.getSettings().goal;
    this.words.empty();
    const input = this.words.createEl('input', {
      cls: 'tree-goal-input',
      attr: { type: 'number', min: '0', max: '99999', placeholder: 'goal' },
    });
    if (goal && goal.path === this.notePath) input.value = String(goal.target);
    const done = (save: boolean) => {
      if (!this.editingGoal) return;
      this.editingGoal = false;
      if (save) this.hooks.onSetGoal(Math.max(0, Math.floor(Number(input.value)) || 0));
      input.remove();
      this.refresh(this.view);
    };
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    };
    input.onblur = () => done(false);
    input.onclick = e => e.stopPropagation();
    input.focus();
  }

  private view: MarkdownView | null = null;

  attach(view: MarkdownView | null) {
    if (!view || !this.getSettings().statusLine) { this.el.detach(); return; }
    if (this.el.parentElement !== view.containerEl) view.containerEl.appendChild(this.el);
    this.refresh(view);
  }

  // edited = this refresh follows something you typed (not opening a note, sync, etc.)
  refresh(view: MarkdownView | null, edited = false) {
    if (!view || this.el.parentElement !== view.containerEl) return;
    this.view = view;
    const s      = this.getSettings();
    const editor = view.editor;
    const text   = editor.getValue();
    const words  = countWords(text);

    const path = view.file?.path ?? null;
    if (path !== this.notePath) {
      // New note: start counting from here, so an existing 3,000-word note doesn't set anything off
      this.notePath = path;
      this.reached = new Set();
    } else if (edited) {
      this.checkGoal(words, this.lastWords);
      this.checkMilestone(words, this.lastWords);
      this.resetIdle();
    }
    this.lastWords = words;

    const sel = editor.getSelection();
    if (!this.editingGoal) this.words.setText(sel ? plural(countWords(sel), 'word') + ' selected' : plural(words, 'word'));

    this.chars.toggle(s.showChars);
    this.chars.setText(plural(text.length, 'char'));

    // A word goal on this note takes the middle (and the reading time steps aside), as in the plan
    const goal = s.goal && s.goal.path === path ? s.goal : null;
    if (goal) {
      const session = Math.max(0, words - goal.baseline);
      this.centre.setText(session + ' / ' + fmtGoal(goal.target));
      this.goalBar.style.width = Math.min(100, (session / goal.target) * 100) + '%';
    } else {
      const mins = Math.ceil(words / 200);
      this.centre.setText(s.showReadTime && words > 50 ? mins + ' min read' : '');
    }
    this.goalBar.toggleClass('is-active', !!goal);

    const editing = view.getMode() === 'source';
    this.cursor.toggle(s.showCursor && editing);
    if (editing) {
      const pos = editor.getCursor();
      this.cursor.setText('ln ' + (pos.line + 1) + ', col ' + (pos.ch + 1));
    }
  }

  // Tree's updateGoalBar(): a message the moment you cross the target
  private checkGoal(words: number, prev: number) {
    const goal = this.getSettings().goal;
    if (!goal || goal.path !== this.notePath) return;
    const now = words - goal.baseline, before = prev - goal.baseline;
    if (now >= goal.target && before < goal.target) this.typeMessage(pick(goalMessages));
  }

  // Tree's checkMilestone()
  private checkMilestone(words: number, prev: number) {
    for (const m of milestones) {
      if (words >= m && prev < m && !this.reached.has(m)) {
        if (this.busy) return;   // retry on the next keystroke rather than silently drop
        this.reached.add(m);
        this.typeMessage(milestoneMessages[m]);
        return;
      }
    }
  }

  // Tree's resetIdle(): a nudge after 3 minutes without typing
  private resetIdle() {
    clearTimeout(this.idleTimer);
    this.idleTimer = window.setTimeout(() => this.typeMessage(pick(idleMessages)), IDLE_MS);
  }

  // Word frequency: shown at once rather than typed, so it's quick to read
  showWordCount(word: string, count: number) {
    if (this.busy || !this.el.isConnected) return;
    this.busy = true;
    this.el.addClass('is-talking');
    this.centre.addClass('is-hidden');
    this.msg.setText(`"${word}" · ${count} time${count !== 1 ? 's' : ''}`);
    this.msg.style.opacity = '1';
    this.later(() => this.fadeOut(), 2200);
  }

  private fadeOut() {
    this.msg.style.opacity = '0';
    this.later(() => {
      this.busy = false;
      this.el.removeClass('is-talking');
      this.centre.removeClass('is-hidden');
      if (this.pending) { const next = this.pending; this.pending = null; this.typeMessage(next, true); }
    }, 500);
  }

  // Ported from Tree's typeStatusMessage(): type it out, hold, fade.
  // important = always shown (Just Write), even with status messages off, and queued if one is already playing
  typeMessage(text: string, important = false) {
    if (!this.el.isConnected || (!important && !this.getSettings().statusMessages)) return;
    if (this.busy) { if (important) this.pending = text; return; }
    this.busy = true;
    this.el.addClass('is-talking');
    this.centre.addClass('is-hidden');
    let i = 0;
    this.later(() => {
      this.msg.style.opacity = '1';
      this.msg.setText('');
      const t = window.setInterval(() => {
        this.msg.setText(text.substring(0, ++i));
        if (i >= text.length) {
          clearInterval(t);
          this.later(() => this.fadeOut(), 1400);
        }
      }, 45);
      this.timers.push(t);
    }, 150);
  }

  welcome() {
    this.typeMessage(pick(welcomeMessages));
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  destroy() {
    clearTimeout(this.idleTimer);
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    this.el.detach();
  }
}
