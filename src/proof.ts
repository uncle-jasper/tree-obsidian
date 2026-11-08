// Proof mode: spelling and plain grammar mistakes, checked on the device by Harper (harper.js), only while it's on.
// Style is never flagged: fragments, long sentences, "And" at the start, word choice and the like are switched off
// in the engine's config (styleRules()) and dropped again by kind (DROP_KINDS), so a new Harper style rule can't creep in.
// The engine (about 8 MB) isn't bundled: it's fetched once from this version's GitHub release, the first time proof
// mode is turned on, checked against the hash of the build's own copy, and kept in the plugin folder.
import { MarkdownView, TFile, normalizePath, requestUrl } from 'obsidian';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { RangeSetBuilder, StateEffect, StateField } from '@codemirror/state';
import { Dialect, LocalLinter, SuggestionKind, createBinaryModuleFromUrl } from 'harper.js';
import type { Lint } from 'harper.js';
import type TreePlugin from './main';

declare const __HARPER_VERSION__: string;
declare const __PROOF_ENGINE_SHA__: string;

const REPO = 'uncle-jasper/tree-obsidian';
const ENGINE_FILE = 'proof-engine-' + __HARPER_VERSION__ + '.wasm.gz';

export const DIALECTS: Record<string, string> = {
  american: 'American',
  british: 'British',
  canadian: 'Canadian',
  australian: 'Australian',
  indian: 'Indian',
};
const DIALECT_ENUM: Record<string, Dialect> = {
  american: Dialect.American, british: Dialect.British, canadian: Dialect.Canadian,
  australian: Dialect.Australian, indian: Dialect.Indian,
};

// Kinds that are never a mistake, only a preference
export const DROP_KINDS = new Set(['Style', 'Readability', 'Enhancement', 'Redundancy', 'Regionalism']);
// Rules that flag choices, not errors. Picked by running Harper over real personal essays: every one of these
// fired on something written that way on purpose ("a couple months", "pre-dawn", "mirrorless", "...").
const STYLE_RULES = [
  'LongSentences', 'SplitWords', 'MassNouns', 'DayOneNames', 'ClicheAccent', 'OkToOkay', 'DisjointPrefixes',
  'OxfordComma', 'ExpandThough', 'ExpandControl', 'ExpandMemoryShorthands', 'ExpandTimeShorthands', 'AvoidCurses',
  'CompoundNouns', 'PossessiveYour', 'QuantifierNeedsOf', 'Gonna', 'Myself', 'Therein', 'DiscourseMarkers',
  'NumericRangeEnDash', 'UseEllipsisCharacter', 'UseTitleCase', 'CondenseAllThe', 'WillNonLemma', 'SpelledNumbers',
];
// Any rule described like this is advice about style, whatever its name
const STYLE_WORDS = /style|concise|wordy|wordiness|redundan|more natural|natural phrasing|readab|clarity|initialism|expands? |preferred|prefer |recommend|consider|less idiomatic|more standard|formal|informal|cliché|cliche|jargon|filler|weasel|hedg|passive|adverb|vague|overused|simpler|plain/i;

export interface ProofLint {
  from: number;
  to: number;
  spelling: boolean;
  word: string;
  message: string;
  fixes: { text: string; kind: SuggestionKind }[];
  lint: Lint;
  source: string;   // the text it was found in, for "ignore"
}

interface ProofState { lints: ProofLint[]; deco: DecorationSet; }

const setLints = StateEffect.define<ProofLint[]>();

const markSpell = Decoration.mark({ class: 'tree-proof tree-proof-spell' });
const markGrammar = Decoration.mark({ class: 'tree-proof tree-proof-grammar' });

function decorate(lints: ProofLint[]): DecorationSet {
  const b = new RangeSetBuilder<Decoration>();
  for (const l of lints) if (l.to > l.from) b.add(l.from, l.to, l.spelling ? markSpell : markGrammar);
  return b.finish();
}

// The marks, kept in place while you type until the next check replaces them
const proofField = StateField.define<ProofState>({
  create: () => ({ lints: [], deco: Decoration.none }),
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setLints)) return { lints: e.value, deco: decorate(e.value) };
    if (!tr.docChanged || !value.lints.length) return value;
    const lints: ProofLint[] = [];
    for (const l of value.lints) {
      const from = tr.changes.mapPos(l.from, 1), to = tr.changes.mapPos(l.to, -1);
      // an edit inside a mark means it's being fixed: drop it until the next check
      if (to > from && tr.changes.touchesRange(l.from, l.to) === false) lints.push({ ...l, from, to });
    }
    return { lints, deco: decorate(lints) };
  },
  provide: f => EditorView.decorations.from(f, v => v.deco),
});

// Text the checker should never see, blanked to spaces so positions stay the same: properties, comments,
// code, links and embeds, URLs, tags, and placeholders like [PHOTO: harbor at dusk]
const MASKS = [
  /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/,
  /%%[\s\S]*?(?:%%|$)/g,
  /<!--[\s\S]*?(?:-->|$)/g,
  /^(```|~~~)[\s\S]*?^\1/gm,
  /`[^`\n]*`/g,
  /!?\[\[[^\]\n]*\]\]/g,
  /\]\([^)\n]*\)/g,
  /\bhttps?:\/\/\S+/g,
  /(^|\s)#[^\s#]+/g,
  /\[[A-Z][A-Z ]*:[^\]\n]*\]/g,
  /^\$\$[\s\S]*?\$\$/gm,
];
export function maskText(text: string) {
  let out = text;
  for (const re of MASKS) out = out.replace(re, m => m.replace(/[^\n]/g, ' '));
  return out;
}

export class Proof {
  private linter: LocalLinter | null = null;
  private loading: Promise<LocalLinter | null> | null = null;
  private words: string[] = [];
  private popover: HTMLElement | null = null;

  constructor(private plugin: TreePlugin) {}

  get on() { return this.plugin.settings.proof; }

  register() {
    const plugin = this.plugin;
    plugin.addCommand({ id: 'toggle-proof', name: 'Toggle proof mode', callback: () => void this.toggle() });
    plugin.addCommand({ id: 'proof-next', name: 'Proof mode: go to the next mistake', callback: () => this.next() });
    plugin.registerEditorExtension([proofField, this.checker(), this.clicks()]);
    // The dictionary note is plain text you can edit: pick up changes to it
    plugin.registerEvent(plugin.app.vault.on('modify', file => {
      if (file.path === this.dictionaryPath() && this.linter) void this.loadWords().then(() => this.recheckAll());
    }));
    plugin.register(() => this.closePopover());
  }

  dictionaryPath() {
    let p = (this.plugin.settings.proofDictionary || 'Tree dictionary').trim();
    if (!p.endsWith('.md')) p += '.md';
    return normalizePath(p);
  }

  async toggle(on = !this.on) {
    if (on && this.plugin.justWrite.active) { this.plugin.status.typeMessage('not during just write.'); return; }
    this.plugin.settings.proof = on;
    await this.plugin.saveSettings();
    this.plugin.status.typeMessage(on ? 'proof mode on.' : 'proof mode off.');
  }

  // After any settings change: load the engine if proof mode is now on, clear the marks if it's off
  sync() {
    this.closePopover();
    // (the words too, in case the dictionary note was changed in settings)
    if (this.on) void this.ensureEngine().then(async l => { if (l) { await this.loadWords(); this.recheckAll(); } });
    else this.clearAll();
    this.updateCount();
  }

  async setDialect() {
    if (!this.linter) return;
    await this.linter.setDialect(DIALECT_ENUM[this.plugin.settings.proofDialect] ?? Dialect.American);
    this.recheckAll();
  }

  private ensureEngine(): Promise<LocalLinter | null> {
    if (this.linter) return Promise.resolve(this.linter);
    if (!this.loading) {
      this.loading = this.loadEngine().catch(err => {
        console.error('Tree proof mode:', err);
        this.plugin.status.typeMessage(String(err?.message ?? err).startsWith('offline') ? 'proof mode needs a connection the first time.' : 'the proof engine didn\'t load.', true);
        this.plugin.settings.proof = false;
        void this.plugin.saveSettings();
        return null;
      }).finally(() => { this.loading = null; });
    }
    return this.loading;
  }

  private enginePath() {
    return normalizePath(this.plugin.manifest.dir + '/' + ENGINE_FILE);
  }

  engineDownloaded() {
    return this.plugin.app.vault.adapter.exists(this.enginePath());
  }

  async removeEngine() {
    const adapter = this.plugin.app.vault.adapter;
    if (await adapter.exists(this.enginePath())) await adapter.remove(this.enginePath());
  }

  private async loadEngine(): Promise<LocalLinter> {
    const adapter = this.plugin.app.vault.adapter;
    const path = this.enginePath();
    let gz: ArrayBuffer | null = (await adapter.exists(path)) ? await adapter.readBinary(path) : null;
    let wasm = gz ? await gunzip(gz).catch(() => null) : null;
    if (!wasm || (await sha256(wasm)) !== __PROOF_ENGINE_SHA__) {
      this.plugin.status.typeMessage('fetching the proof engine. once only.', true);
      const url = 'https://github.com/' + REPO + '/releases/download/' + this.plugin.manifest.version + '/' + ENGINE_FILE;
      let res;
      try { res = await requestUrl({ url, throw: false }); } catch { throw new Error('offline'); }
      if (res.status !== 200) throw new Error('engine download failed: ' + res.status);
      gz = res.arrayBuffer;
      wasm = await gunzip(gz);
      if ((await sha256(wasm)) !== __PROOF_ENGINE_SHA__) throw new Error('engine download did not match');
      await adapter.writeBinary(path, gz);
    }
    const url = URL.createObjectURL(new Blob([wasm], { type: 'application/wasm' }));
    const linter = new LocalLinter({
      binary: createBinaryModuleFromUrl(url, 'full'),
      dialect: DIALECT_ENUM[this.plugin.settings.proofDialect] ?? Dialect.American,
    });
    await linter.setup();
    await linter.setLintConfig({ ...(await linter.getDefaultLintConfig()), ...(await styleRules(linter)) });
    this.linter = linter;
    await this.loadWords();
    // Harper's first check takes a couple of seconds; later ones take milliseconds. Pay it now.
    await linter.lint('Warming up the proof engine so the first real check is quick.');
    return linter;
  }

  private async loadWords() {
    if (!this.linter) return;
    const file = this.plugin.app.vault.getAbstractFileByPath(this.dictionaryPath());
    const text = file instanceof TFile ? await this.plugin.app.vault.cachedRead(file) : '';
    this.words = parseDictionary(text);
    await this.linter.clearWords();
    // with the possessive too, so "Yongkang" also covers "Yongkang's"
    await this.linter.importWords(this.words.flatMap(w => [w, w + '\'s', w + '’s']));
  }

  private async addWord(word: string) {
    const vault = this.plugin.app.vault;
    const path = this.dictionaryPath();
    const file = vault.getAbstractFileByPath(path);
    if (file instanceof TFile) await vault.process(file, t => t.replace(/\n*$/, '\n') + word + '\n');
    else {
      const folder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
      if (folder && !vault.getAbstractFileByPath(folder)) await vault.createFolder(folder);
      await vault.create(path, '%% Words Tree\'s proof mode accepts as spelled. One per line. %%\n\n' + word + '\n');
    }
    // the modify event reloads the words and checks again
    this.plugin.status.typeMessage('added to dictionary.');
  }

  // Every open note's editor
  private editors(): EditorView[] {
    const views: EditorView[] = [];
    this.plugin.app.workspace.iterateAllLeaves(leaf => {
      const cm = leaf.view instanceof MarkdownView ? (leaf.view.editor as unknown as { cm?: EditorView }).cm : undefined;
      if (cm) views.push(cm);
    });
    return views;
  }

  private recheckAll() {
    for (const view of this.editors()) void this.check(view);
  }

  private clearAll() {
    for (const view of this.editors()) if (view.state.field(proofField, false)?.lints.length) view.dispatch({ effects: setLints.of([]) });
  }

  private async check(view: EditorView) {
    if (!this.on || !this.linter) return;
    const doc = view.state.doc;
    const source = doc.toString();
    let found: [string, Lint][];
    try {
      const byRule = await this.linter.organizedLints(maskText(source), { language: 'markdown' });
      found = Object.entries(byRule).flatMap(([rule, list]) => list.map(l => [rule, l] as [string, Lint]));
    } catch (e) { console.error('Tree proof mode:', e); return; }
    // typed meanwhile, or turned off: the next check will do
    if (!this.on || view.state.doc !== doc || !view.dom.isConnected) return;
    const lints: ProofLint[] = [];
    for (const [rule, lint] of found) {
      if (DROP_KINDS.has(lint.lint_kind())) continue;
      const span = lint.span();
      lints.push({
        from: span.start,
        to: span.end,
        spelling: rule === 'SpellCheck',
        word: lint.get_problem_text(),
        message: lint.message().replace(/`/g, '"'),
        fixes: lint.suggestions().slice(0, 3).map(s => ({ text: s.get_replacement_text(), kind: s.kind() })),
        lint,
        source,
      });
    }
    lints.sort((a, b) => a.from - b.from);
    view.dispatch({ effects: setLints.of(lints) });
    this.updateCount();
  }

  // Checks again a moment after you stop typing, while proof mode is on
  private checker() {
    const proof = this;
    return ViewPlugin.fromClass(class {
      timer = 0;
      constructor(readonly view: EditorView) { if (proof.on && proof.linter) void proof.check(view); }
      update(u: ViewUpdate) {
        if (!proof.on) return;
        if (u.docChanged) {
          window.clearTimeout(this.timer);
          this.timer = window.setTimeout(() => void proof.check(this.view), 700);
          proof.closePopover();
        }
        if (u.docChanged || u.transactions.some(tr => tr.effects.some(e => e.is(setLints)))) proof.updateCount();
      }
      destroy() { window.clearTimeout(this.timer); }
    });
  }

  // A click on a mark opens its fixes
  private clicks() {
    return EditorView.domEventHandlers({
      click: (e, view) => {
        if (!this.on) return false;
        const target = (e.target as HTMLElement).closest('.tree-proof');
        if (!target) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos == null) return false;
        const lint = view.state.field(proofField).lints.find(l => pos >= l.from && pos <= l.to);
        if (lint) this.openPopover(view, lint);
        return false;
      },
    });
  }

  private currentView(): EditorView | null {
    const ws = this.plugin.app.workspace;
    const view = ws.getActiveViewOfType(MarkdownView) ?? (ws.getMostRecentLeaf(ws.rootSplit)?.view instanceof MarkdownView ? ws.getMostRecentLeaf(ws.rootSplit)!.view as MarkdownView : null);
    return (view?.editor as unknown as { cm?: EditorView } | undefined)?.cm ?? null;
  }

  // The count on the status line: how many are left in the note you're with
  updateCount() {
    const view = this.on ? this.currentView() : null;
    const n = view ? view.state.field(proofField, false)?.lints.length ?? 0 : null;
    this.plugin.status.setProof(this.on && this.linter ? n ?? 0 : this.on ? -1 : null);
  }

  // Jump to the next mark after the cursor, round to the top at the end, and open its fixes
  next() {
    const view = this.currentView();
    if (!this.on || !view) return;
    const lints = view.state.field(proofField).lints;
    if (!lints.length) return;
    const head = view.state.selection.main.head;
    const lint = lints.find(l => l.from > head) ?? lints[0];
    view.dispatch({ selection: { anchor: lint.from, head: lint.to }, scrollIntoView: true });
    view.focus();
    window.requestAnimationFrame(() => this.openPopover(view, lint));
  }

  private outside = (e: PointerEvent) => {
    if (this.popover && !this.popover.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tree-proof')) this.closePopover();
  };
  private keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !this.popover) return;
    e.preventDefault();
    e.stopPropagation();
    this.closePopover();
  };

  closePopover() {
    if (!this.popover) return;
    this.popover.remove();
    this.popover = null;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
  }

  // Small, in the Aa panel's style: what's wrong, the fixes, then ignore and add to dictionary
  private openPopover(view: EditorView, lint: ProofLint) {
    this.closePopover();
    const at = view.coordsAtPos(lint.from);
    if (!at) return;
    const doc = view.dom.ownerDocument;
    const el = doc.body.createDiv({ cls: 'tree-proof-popover' });
    el.createDiv({ cls: 'tree-proof-message', text: lint.message });
    const row = el.createDiv({ cls: 'tree-proof-fixes' });
    for (const fix of lint.fixes) {
      const label = fix.kind === SuggestionKind.Remove ? 'remove "' + lint.word + '"' : fix.kind === SuggestionKind.InsertAfter ? 'add "' + fix.text + '"' : fix.text.trim() || '(space)';
      row.createEl('button', { cls: 'tree-proof-fix', text: label }).onclick = () => { this.apply(view, lint, fix); };
    }
    const actions = el.createDiv({ cls: 'tree-proof-actions' });
    actions.createEl('button', { text: 'ignore' }).onclick = () => void this.ignore(view, lint);
    if (lint.spelling && /^[\p{L}\p{M}'’-]+$/u.test(lint.word)) {
      actions.createEl('button', { text: 'add to dictionary' }).onclick = () => { this.closePopover(); void this.addWord(lint.word); };
    }
    // under the word, kept on screen
    const rect = el.getBoundingClientRect();
    const win = doc.defaultView ?? window;
    el.style.left = Math.max(8, Math.min(at.left, win.innerWidth - rect.width - 8)) + 'px';
    el.style.top = (at.bottom + rect.height + 12 > win.innerHeight ? at.top - rect.height - 6 : at.bottom + 6) + 'px';
    this.popover = el;
    doc.addEventListener('pointerdown', this.outside, true);
    doc.addEventListener('keydown', this.keys, true);
  }

  private apply(view: EditorView, lint: ProofLint, fix: ProofLint['fixes'][number]) {
    this.closePopover();
    const changes = fix.kind === SuggestionKind.Remove ? { from: lint.from, to: lint.to, insert: '' }
      : fix.kind === SuggestionKind.InsertAfter ? { from: lint.to, insert: fix.text }
      : { from: lint.from, to: lint.to, insert: fix.text };
    view.dispatch({ changes, userEvent: 'input.complete' });
    view.focus();
  }

  // Ignored for this session, in this spot (Harper remembers it by its surroundings)
  private async ignore(view: EditorView, lint: ProofLint) {
    this.closePopover();
    if (!this.linter) return;
    await this.linter.ignoreLint(maskText(lint.source), lint.lint);
    void this.check(view);
  }
}

// One word per line. Properties, %% comments %%, headings and blank lines are skipped; "- word" is fine too.
export function parseDictionary(text: string) {
  return maskText(text).split('\n')
    .map(line => line.replace(/^\s*[-*+]\s+/, '').trim())
    .filter(line => line && !line.startsWith('#'));
}

export async function styleRules(linter: LocalLinter) {
  const descriptions = await linter.getLintDescriptions();
  const off: Record<string, boolean> = {};
  for (const name of Object.keys(await linter.getDefaultLintConfig())) {
    if (STYLE_RULES.includes(name) || STYLE_WORDS.test(descriptions[name] ?? '')) off[name] = false;
  }
  return off;
}

export async function gunzip(gz: ArrayBuffer): Promise<ArrayBuffer> {
  const stream = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).arrayBuffer();
}

export async function sha256(buf: ArrayBuffer) {
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
}
