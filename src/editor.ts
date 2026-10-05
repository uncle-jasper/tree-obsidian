// Zen mode (sentence / paragraph dimming) and typewriter scrolling, ported from Tree's CodeMirror plugins.
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate, keymap } from '@codemirror/view';
import { EditorSelection, EditorState, Prec, RangeSetBuilder, Transaction } from '@codemirror/state';
import type { TreeSettings } from './settings';

const zenDimMark  = Decoration.mark({ class: 'tree-zen-dim' });
const zenDimLine  = Decoration.line({ class: 'tree-zen-dim-line' });

function isSentenceTerm(ch: string) {
  return ch === '.' || ch === '!' || ch === '?';
}

// Straight from Tree's getZenSentenceRange()
function getZenSentenceRange(state: EditorState) {
  const pos  = state.selection.main.head;
  const doc  = state.doc;
  const text = doc.toString();

  // Find paragraph bounds (delimited by blank lines)
  let paraStart = 0;
  for (let i = pos - 1; i >= 0; i--) {
    if (text[i] === '\n' && i > 0 && text[i - 1] === '\n') { paraStart = i + 1; break; }
  }
  let paraEnd = text.length;
  for (let i = pos; i < text.length; i++) {
    if (text[i] === '\n' && i + 1 < text.length && text[i + 1] === '\n') { paraEnd = i; break; }
  }

  const para   = text.slice(paraStart, paraEnd);
  const relPos = pos - paraStart;

  // Walk backward: find the terminator that ended the previous sentence
  let sentStart = 0;
  let prevTermIdx = -1;
  for (let i = relPos - 1; i >= 0; i--) {
    if (isSentenceTerm(para[i])) {
      const next = para[i + 1];
      // Only a real sentence boundary when followed by whitespace (or end of para)
      if (!next || /\s/.test(next)) {
        prevTermIdx = i;
        let j = i + 1;
        while (j < relPos && /[ \t\n]/.test(para[j])) j++;
        sentStart = j;
        break;
      }
    }
  }

  // Typed a terminator but haven't started the next sentence yet: keep the just-completed one lit
  if (sentStart >= relPos && prevTermIdx >= 0) {
    let completedStart = 0;
    for (let i = prevTermIdx - 1; i >= 0; i--) {
      if (isSentenceTerm(para[i])) {
        const next = para[i + 1];
        if (!next || /\s/.test(next)) {
          let j = i + 1;
          while (j < prevTermIdx && /[ \t\n]/.test(para[j])) j++;
          completedStart = j;
          break;
        }
      }
    }
    return { from: paraStart + completedStart, to: pos };
  }

  // Walk forward: find the terminator that ends the current sentence
  let sentEnd = para.length;
  for (let i = relPos; i < para.length; i++) {
    if (isSentenceTerm(para[i])) { sentEnd = i + 1; break; }
  }

  return { from: paraStart + sentStart, to: Math.min(paraStart + sentEnd, doc.length) };
}

// Straight from Tree's getZenParagraphLines()
function getZenParagraphLines(state: EditorState) {
  const curLine = state.doc.lineAt(state.selection.main.head);
  // Blank line: cursor just pressed Enter, so the preceding paragraph dims immediately
  if (curLine.text.trim() === '') return { fromLine: curLine.number, toLine: curLine.number };
  // Extend downward only through contiguous non-blank lines; lines above stay dim
  let e = curLine.number;
  while (e < state.doc.lines && state.doc.line(e + 1).text.trim() !== '') e++;
  return { fromLine: curLine.number, toLine: e };
}

export function zenExtension(getSettings: () => TreeSettings) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = this.build(view); }
    update(u: ViewUpdate) {
      // Any transaction counts, so toggling zen (which reconfigures editors) rebuilds immediately
      if (u.docChanged || u.selectionSet || u.viewportChanged || u.transactions.length) this.decorations = this.build(u.view);
    }
    build(view: EditorView): DecorationSet {
      const s = getSettings();
      const builder = new RangeSetBuilder<Decoration>();
      const { state } = view;
      if (!s.zen || !state.doc.length) return builder.finish();

      if (s.zenGranularity === 'sentence') {
        const { from, to } = getZenSentenceRange(state);
        if (from > 0)              builder.add(0,  from, zenDimMark);
        if (to < state.doc.length) builder.add(to, state.doc.length, zenDimMark);
      } else {
        // Dim every visible line outside the active paragraph
        const { fromLine, toLine } = getZenParagraphLines(state);
        let last = 0;
        for (const { from, to } of view.visibleRanges) {
          for (let pos = Math.max(from, last); pos <= to; ) {
            const line = state.doc.lineAt(pos);
            if (line.number < fromLine || line.number > toLine) builder.add(line.from, line.from, zenDimLine);
            last = pos = line.to + 1;
          }
        }
      }
      return builder.finish();
    }
  }, { decorations: v => v.decorations });
}

// Keeps the cursor line centered while you type or move with the keyboard.
// The centering rides along on the keystroke's own transaction, so CodeMirror scrolls once,
// in the same redraw. (Scrolling afterwards, as Tree does, makes Obsidian paint twice and flash.)
// Clicks and drag-selects are left alone so the page doesn't jump under the mouse, and changes
// that don't come from you (sync, other plugins) don't yank the view around.
export function typewriterExtension(getSettings: () => TreeSettings) {
  const centerOnInput = EditorState.transactionExtender.of(tr => {
    if (!getSettings().typewriter || !(tr.docChanged || tr.selection)) return null;
    if (tr.annotation(Transaction.userEvent) === undefined || tr.isUserEvent('select.pointer')) return null;
    return { effects: EditorView.scrollIntoView(tr.newSelection.main.head, { y: 'center' }) };
  });

  // When typewriter is switched on (editors get reconfigured), center once right away
  const centerOnToggle = ViewPlugin.fromClass(class {
    update(u: ViewUpdate) {
      if (!getSettings().typewriter || !u.transactions.some(tr => tr.reconfigured)) return;
      const view = u.view;
      window.setTimeout(() => {
        if (!getSettings().typewriter || !view.dom.isConnected) return;
        view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) });
      }, 0);
    }
  });

  return [centerOnInput, centerOnToggle];
}

// Longest first, so *** wins over ** wins over *. The first four are Tree's; ==, ]] and ` are Obsidian's.
const TAB_OUT_MARKS = ['***', '**', '~~', '==', ']]', '*', '`'];

// Tab jumps past closing formatting marks (Tree's Tab handler). Anywhere else it returns false,
// so Obsidian's own Tab (indent, etc.) carries on as normal. Unlike Tree, the marks must follow
// text, i.e. be closing marks, so Tab at the start of "- **bold**" still indents the list item.
export function tabOutExtension(getSettings: () => TreeSettings) {
  return Prec.highest(keymap.of([{
    key: 'Tab',
    run: view => {
      if (!getSettings().tabOut) return false;
      const { state } = view;
      const { from, to } = state.selection.main;
      if (from !== to || state.selection.ranges.length > 1) return false;
      const before = state.sliceDoc(Math.max(0, from - 1), from);
      if (before === '' || /\s/.test(before)) return false;
      const ahead = state.sliceDoc(from, Math.min(state.doc.length, from + 3));
      const mark = TAB_OUT_MARKS.find(m => ahead.startsWith(m));
      if (!mark) return false;
      const skip = mark.length;
      view.dispatch({ selection: EditorSelection.cursor(from + skip), userEvent: 'select' });
      return true;
    },
  }]));
}
