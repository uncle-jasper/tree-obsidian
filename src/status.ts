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

const countWords = (s: string) => (s.trim() === '' ? 0 : s.trim().split(/\s+/).filter(Boolean).length);
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

  constructor(private getSettings: () => TreeSettings, onQuick: (anchor: HTMLElement) => void) {
    this.el = createDiv({ cls: 'tree-status' });
    const left = this.el.createDiv({ cls: 'tree-stat-left' });
    this.words  = left.createSpan();
    this.chars  = left.createSpan();
    this.centre = this.el.createDiv({ cls: 'tree-stat-centre' });
    this.msg    = this.el.createDiv({ cls: 'tree-stat-msg' });
    const right = this.el.createDiv({ cls: 'tree-stat-right' });
    this.cursor = right.createSpan();
    const quick = right.createSpan({ cls: 'tree-quick-toggle', text: 'Aa', attr: { 'aria-label': 'Theme and font' } });
    quick.onclick = () => onQuick(this.el);
  }

  attach(view: MarkdownView | null) {
    if (!view || !this.getSettings().statusLine) { this.el.detach(); return; }
    if (this.el.parentElement !== view.containerEl) view.containerEl.appendChild(this.el);
    this.refresh(view);
  }

  refresh(view: MarkdownView | null) {
    if (!view || this.el.parentElement !== view.containerEl) return;
    const s      = this.getSettings();
    const editor = view.editor;
    const text   = editor.getValue();
    const words  = countWords(text);

    const sel = editor.getSelection();
    this.words.setText(sel ? plural(countWords(sel), 'word') + ' selected' : plural(words, 'word'));

    this.chars.toggle(s.showChars);
    this.chars.setText(plural(text.length, 'char'));

    const mins = Math.ceil(words / 200);
    this.centre.setText(s.showReadTime && words > 50 ? mins + ' min read' : '');

    const editing = view.getMode() === 'source';
    this.cursor.toggle(s.showCursor && editing);
    if (editing) {
      const pos = editor.getCursor();
      this.cursor.setText('ln ' + (pos.line + 1) + ', col ' + (pos.ch + 1));
    }
  }

  // Ported from Tree's typeStatusMessage(): type it out, hold, fade.
  typeMessage(text: string) {
    if (this.busy || !this.getSettings().statusMessages || !this.el.isConnected) return;
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
          this.later(() => {
            this.msg.style.opacity = '0';
            this.later(() => {
              this.busy = false;
              this.el.removeClass('is-talking');
              this.centre.removeClass('is-hidden');
            }, 500);
          }, 1400);
        }
      }, 45);
      this.timers.push(t);
    }, 150);
  }

  welcome() {
    this.typeMessage(welcomeMessages[Math.floor(Math.random() * welcomeMessages.length)]);
  }

  private later(fn: () => void, ms: number) {
    this.timers.push(window.setTimeout(fn, ms));
  }

  destroy() {
    this.timers.forEach(t => { clearTimeout(t); clearInterval(t); });
    this.el.detach();
  }
}
