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

// Time goal messages (not in Tree's word goal pool; written for the time goal)
export const timeMessages = [
  'that\'s your time. well done.',
  'you stayed with it.',
  'time reached. take a moment.',
  'you showed up. that\'s the work.',
];

export interface WordGoal { target: number; baseline: number; path: string; }
// Counts only while its note is in front: see tickTimeGoal() in main.ts
export interface TimeGoal { minutes: number; spentMs: number; path: string; }

export type GoalInput = { words: number } | { minutes: number } | { clear: true };

// The goal box takes both: 500 is words; 25m, 25 min, 1h, 1h30m, 90m and 1:30 (h:mm) are time; 0 clears
export function parseGoal(raw: string): GoalInput | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (s === '' || /^0+$/.test(s)) return { clear: true };
  if (/^\d+$/.test(s)) return { words: Math.min(99999, Number(s)) };
  let m = s.match(/^(\d+):([0-5]\d)$/);
  if (m) return minutesOrNull(Number(m[1]) * 60 + Number(m[2]));
  m = s.match(/^(?:(\d+)h(?:ours?|rs?)?)?(?:(\d+)(?:m(?:in(?:ute)?s?)?)?)?$/);   // the m is optional after hours: 1h30
  if (m && (m[1] || m[2])) return minutesOrNull(Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0));
  return null;
}
const minutesOrNull = (n: number): GoalInput => (n > 0 ? { minutes: Math.min(5999, n) } : { clear: true });

// "25 minutes", "1 hour", "1 hour 30 minutes"
export function fmtMinutes(n: number) {
  const h = Math.floor(n / 60), m = n % 60;
  return [h ? plural(h, 'hour') : '', m || !h ? plural(m, 'minute') : ''].filter(Boolean).join(' ');
}

export interface StatusHooks {
  onQuick(anchor: HTMLElement): void;
  onSetGoal(goal: GoalInput): void;
  onPeekObsidian(on: boolean): void;     // the ⋯ that brings up Obsidian's own status bar
  onToggleExtras(): void;                // the ¶ that hides properties and mentions
}

export const pick = (list: string[]) => list[Math.floor(Math.random() * list.length)];

export const countWords = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).filter(Boolean).length);

// What you've written: the note without its properties (the --- block at the top).
// Linked and unlinked mentions aren't part of the note's text, so they never count anyway.
const FRONTMATTER = /^---\r?\n(?:[\s\S]*?\r?\n)?---[ \t]*(?:\r?\n|$)/;
export function noteBody(text: string) {
  const fm = text.match(FRONTMATTER)?.[0] ?? '';
  return { body: text.slice(fm.length), lines: fm.split('\n').length - 1 };
}
const plural = (n: number, word: string) => n + ' ' + word + (n !== 1 ? 's' : '');

// One status line, moved to whichever markdown leaf is active.
export class StatusLine {
  el: HTMLElement;
  private words: HTMLElement;
  private extras: HTMLElement;
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
    this.extras = left.createSpan({ cls: 'tree-extras-toggle', text: '¶' });
    this.extras.onclick = () => hooks.onToggleExtras();
    this.centre = this.el.createDiv({ cls: 'tree-stat-centre' });
    this.msg    = this.el.createDiv({ cls: 'tree-stat-msg' });
    const right = this.el.createDiv({ cls: 'tree-stat-right' });
    this.words  = right.createSpan({ cls: 'tree-stat-words', attr: { 'aria-label': 'Set a word or time goal' } });
    this.words.onclick = () => this.editGoal();
    this.chars  = right.createSpan();
    this.cursor = right.createSpan();
    const peek  = right.createSpan({ cls: 'tree-peek-toggle', text: '⋯', attr: { 'aria-label': 'Obsidian status bar' } });
    peek.onmouseenter = () => hooks.onPeekObsidian(true);
    peek.onmouseleave = () => hooks.onPeekObsidian(false);
    // Tree's goal progress line along the bottom edge
    this.goalBar = this.el.createDiv({ cls: 'tree-goal-bar' });
  }

  // Click the word count (or Ctrl+Shift+W): it turns into a box. 500 sets words, 25m sets time,
  // Enter sets, 0 clears, Escape cancels. suffix = typed after the cursor (the time goal command's "m").
  editGoal(suffix = '') {
    if (this.editingGoal || !this.el.isConnected) return;
    this.editingGoal = true;
    const { goal, timeGoal } = this.getSettings();
    this.words.empty();
    // text, not number, so the iPad keyboard has letters for "m" and "h"
    const input = this.words.createEl('input', {
      cls: 'tree-goal-input',
      attr: { type: 'text', placeholder: '500 or 25m', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false' },
    });
    if (suffix) input.value = suffix;
    else if (timeGoal && timeGoal.path === this.notePath) input.value = timeGoal.minutes + 'm';
    else if (goal && goal.path === this.notePath) input.value = String(goal.target);
    const done = (save: boolean) => {
      if (!this.editingGoal) return;
      let parsed: GoalInput | null = null;
      if (save && !(parsed = parseGoal(input.value))) { input.addClass('is-invalid'); return; }   // stays open
      this.editingGoal = false;
      if (parsed) this.hooks.onSetGoal(parsed);
      input.remove();
      this.refresh(this.view);
    };
    input.oninput = () => input.removeClass('is-invalid');
    input.onkeydown = e => {
      if (e.key === 'Enter') { e.preventDefault(); done(true); }
      else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    };
    input.onblur = () => done(false);
    input.onclick = e => e.stopPropagation();
    input.focus();
    input.setSelectionRange(0, suffix ? 0 : input.value.length);
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
    const { body: text, lines: fmLines } = noteBody(editor.getValue());
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

    // A goal on this note takes the middle (and the reading time steps aside), as in the plan
    const goal = s.goal && s.goal.path === path ? s.goal : null;
    const timeGoal = s.timeGoal && s.timeGoal.path === path ? s.timeGoal : null;
    if (timeGoal) {
      // whole minutes only, so nothing ticks at you
      this.centre.setText(Math.floor(timeGoal.spentMs / 60000) + ' / ' + timeGoal.minutes + ' min');
      this.goalBar.style.width = Math.min(100, (timeGoal.spentMs / (timeGoal.minutes * 60000)) * 100) + '%';
    } else if (goal) {
      const session = Math.max(0, words - goal.baseline);
      this.centre.setText(session + ' / ' + fmtGoal(goal.target) + ' words');
      this.goalBar.style.width = Math.min(100, (session / goal.target) * 100) + '%';
    } else {
      const mins = Math.ceil(words / 200);
      this.centre.setText(s.showReadTime && words > 50 ? mins + ' min read' : '');
    }
    this.goalBar.toggleClass('is-active', !!(goal || timeGoal));

    // Lines count from the first line under the properties; inside the properties there's no position
    const pos = editor.getCursor();
    const editing = view.getMode() === 'source' && pos.line >= fmLines;
    this.cursor.toggle(s.showCursor && editing);
    if (editing) this.cursor.setText('ln ' + (pos.line - fmLines + 1) + ', col ' + (pos.ch + 1));

    this.extras.toggleClass('is-on', document.body.hasClass('tree-hide-extras'));
    this.extras.setAttr('aria-label', document.body.hasClass('tree-hide-extras') ? 'Turn quiet mode off' : 'Turn quiet mode on (hides properties and mentions)');
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
