// Loads main.js against a stub Obsidian so load-time crashes fail the build instead of Obsidian.
const Module = require('module');
const orig = Module._load;
Module._load = (req, ...rest) => {
  if (req === 'obsidian') return { Plugin: class {}, PluginSettingTab: class {}, Setting: class {}, MarkdownView: class {}, setIcon() {}, Platform: {}, Modal: class {}, Notice: class {}, Component: class {}, MarkdownRenderer: {}, TFile: class {}, requestUrl() {} };
  if (req === '@codemirror/view') return { EditorView: { updateListener: { of() {} } }, drawSelection() {}, Decoration: { mark() {}, line() {} }, ViewPlugin: { fromClass() {} }, keymap: { of() {} } };
  if (req === '@codemirror/state') return { RangeSetBuilder: class {}, EditorState: { transactionExtender: { of() {} } }, Transaction: {}, EditorSelection: {}, Prec: { highest() {} } };
  return orig(req, ...rest);
};
if (typeof require('../main.js').default !== 'function') throw new Error('main.js has no default plugin export');
console.log('main.js loads');
