// Tests for packs in the plugin, against a stand-in Obsidian with an in-memory vault.
// Run: node scripts/test-packs.mjs   (after npm ci; not part of the build)
// Covers what can be checked outside Obsidian: moving old settings over, what each theme looks like
// (lookOf), choosing packs and themes, uninstalling, and a pack that hasn't synced yet. How it all
// looks in Obsidian is Dan's check (PACKS-PLAN.md, rule 7).
import esbuild from 'esbuild';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const out = await esbuild.build({
  stdin: {
    contents: "export { default as TreePlugin } from './src/main'; export { PackStore } from './src/packstore'; export { lookOf, choicesOf } from './src/settings'; export { default as TreePacks } from './src/packs';",
    resolveDir: '.', loader: 'ts',
  },
  bundle: true, format: 'cjs', platform: 'node', write: false,
  external: ['obsidian', 'electron', '@codemirror/*', '@lezer/*', 'fs'],
  define: { __HARPER_VERSION__: '"0"', __PROOF_ENGINE_SHA__: '"0"' },
});

// ── A stand-in Obsidian: an in-memory vault, and nothing on screen ──
const files = new Map();
const adapter = {
  exists: async p => files.has(p) || [...files.keys()].some(k => k.startsWith(p + '/')),
  list: async p => ({ files: [...files.keys()].filter(k => k.startsWith(p + '/')), folders: [] }),
  read: async p => files.get(p),
  write: async (p, t) => { files.set(p, t); },
  mkdir: async () => {},
  remove: async p => { files.delete(p); },
};
const anything = () => new Proxy(function () {}, { get: (t, k) => (k === 'prototype' ? {} : anything()), apply: () => anything(), construct: () => anything() });
const obsidian = {
  Plugin: class { register() {} registerEvent() {} registerDomEvent() {} },
  PluginSettingTab: class {}, Setting: class {}, MarkdownView: class {}, Modal: class {}, Notice: class {}, Component: class {},
  MarkdownRenderer: {}, TFile: class {}, TAbstractFile: class {}, Platform: {}, setIcon() {},
  normalizePath: p => p.replace(/\/+/g, '/'),
  requestUrl: async () => ({ status: 0 }),
};
const require = createRequire(import.meta.url);
const Module = require('module');
const load = Module._load;
Module._load = (req, ...rest) => (req === 'obsidian' ? obsidian : req.startsWith('@codemirror/') ? anything() : load(req, ...rest));
const m = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(m, m.exports, require);
const { TreePlugin, PackStore, lookOf, choicesOf, TreePacks } = m.exports;

// A plugin started the way onload starts it, up to the point of drawing anything
async function start(data, vault) {
  files.clear();
  for (const [k, v] of Object.entries(vault || {})) files.set(k, v);
  const p = new TreePlugin();
  p.app = { vault: { adapter, on() {} }, workspace: { getLeavesOfType: () => [], layoutReady: false } };
  p.loadData = async () => (data === undefined ? null : JSON.parse(JSON.stringify(data)));
  p.saveData = async d => { p.saved = JSON.parse(JSON.stringify(d)); };
  p.saveSettings = async () => p.saveData(p.settings);
  p.packs = new PackStore(p);
  await p.loadSettings();
  await p.packs.load();
  await p.movePacksOver();
  return p;
}
const now = p => ({ pack: p.settings.pack, theme: p.settings.theme, look: lookOf(p.settings) });

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('  ✓', name); }
  catch (e) { failed++; console.log('  ✗', name, '\n     ', e.message.split('\n').join('\n      ')); }
}

console.log('old settings move over');
const cases = [
  ['first install', undefined, { pack: 'classic', theme: 'parchment', look: 'parchment' }],
  ['moss', { theme: 'moss' }, { pack: 'classic', theme: 'moss', look: 'moss' }],
  ['none (Obsidian\'s theme)', { theme: '' }, { pack: 'classic', theme: '', look: '' }],
  ['custom 2', { theme: 'custom2', custom2: { bg: '#101820', text: '#d8e2ea', accent: '#ff4fa3', name: 'night' } }, { pack: 'classic', theme: 'custom2', look: 'custom2' }],
  ['game boy', { theme: 'gameboy' }, { pack: 'retro', theme: 'gameboy', look: 'gameboy' }],
  ['moonwalker', { theme: 'moonwalker' }, { pack: 'retro', theme: 'moonwalker', look: 'moonwalker' }],
  ['terminal, crt off', { theme: 'terminal', crt: false }, { pack: 'retro', theme: 'terminal', look: 'terminal' }],
  ['terminal, crt on', { theme: 'terminal', crt: true }, { pack: 'retro', theme: 'terminal', look: 'terminal-crt' }],
  ['terminal crt from before 0.18', { theme: 'terminal-crt' }, { pack: 'retro', theme: 'terminal', look: 'terminal-crt' }],
  ['amber crt', { theme: 'amber-crt', crt: true, secretReturn: 'terminal' }, { pack: 'retro', theme: 'amber-crt', look: 'amber-crt' }],
  ['doogie journal', { theme: 'doogie-journal', crt: true }, { pack: 'retro', theme: 'doogie-journal', look: 'doogie-journal' }],
  ['rain', { theme: 'rain', downpour: false }, { pack: 'rain', theme: 'rain', look: 'pack' }],
  ['downpour, falling rain on', { theme: 'rain', downpour: true, fallingRain: true }, { pack: 'rain', theme: 'downpour', look: 'pack' }],
  ['downpour, falling rain off', { theme: 'rain', downpour: true, fallingRain: false }, { pack: 'rain', theme: 'downpour', look: 'pack' }],
];
for (const [name, data, want] of cases) {
  await test(name, async () => {
    const p = await start(data);
    assert.deepStrictEqual(now(p), want);
    assert.ok(p.saved && p.saved.packsMigrated, 'saved as moved over');
    for (const k of ['crt', 'downpour', 'fallingRain', 'secretReturn']) assert.ok(!(k in p.saved), k + ' left behind');
    if (want.pack === 'rain') {
      assert.ok(files.has('Tree packs/rain.tree-pack.json'), 'the Rain pack is installed in the vault');
      const falling = choicesOf(p.settings)['falling rain'];
      assert.strictEqual(falling, name === 'downpour, falling rain on');
      assert.strictEqual(p.settings.packRemembered.colors.bg, want.theme === 'rain' ? '#192125' : '#0e1517');
    } else assert.strictEqual(files.size, 0, 'nothing written to the vault');
    // A second start changes nothing
    const again = await start(p.saved, Object.fromEntries(files));
    assert.deepStrictEqual(now(again), want);
  });
}
await test('custom colors and names are kept', async () => {
  const p = await start({ theme: 'custom2', custom2: { bg: '#101820', text: '#d8e2ea', accent: '#ff4fa3', name: 'night', cursor: 'block', readable: true } });
  assert.deepStrictEqual(p.settings.custom2, { bg: '#101820', text: '#d8e2ea', accent: '#ff4fa3', name: 'night', cursor: 'block', readable: true });
});

console.log('choosing');
await test('amber terminal and doogie journal: crt on by default, off gives the plain look', async () => {
  const p = await start({ theme: 'moss' });
  p.selectTheme('retro', 'amber-crt');
  assert.strictEqual(lookOf(p.settings), 'amber-crt');
  p.setSwitch('crt', false);
  assert.strictEqual(lookOf(p.settings), 'amber-terminal');
  p.selectTheme('retro', 'doogie-journal');
  assert.strictEqual(lookOf(p.settings), 'doogie-journal');
  p.setSwitch('crt', false);
  assert.strictEqual(lookOf(p.settings), 'doogie-plain');
  p.selectTheme('retro', 'amber-crt');
  assert.strictEqual(lookOf(p.settings), 'amber-terminal', 'each theme keeps its own switch');
});
await test('a pack opens on its everyday theme, then on the one last used', async () => {
  const p = await start({ theme: 'moss' });
  const r = await p.packs.install(readFileSync('src/rain-seed.json', 'utf8'));
  assert.ok(r.ok);
  p.selectPack('rain');
  assert.deepStrictEqual([p.settings.pack, p.settings.theme], ['rain', 'rain']);
  p.selectTheme('rain', 'wet-neon');
  p.selectPack('classic');
  assert.deepStrictEqual([p.settings.pack, p.settings.theme], ['classic', 'moss']);
  p.selectPack('rain');
  assert.strictEqual(p.settings.theme, 'wet-neon');
  assert.deepStrictEqual(p.packs.all().map(x => x.id), ['classic', 'retro', 'rain']);
});
await test('a broken pack file is refused in one line', async () => {
  const p = await start({ theme: 'moss' });
  const r = await p.packs.install('{"treePack":1,"id":"x"}');
  assert.ok(!r.ok && !r.error.includes('\n'));
  assert.strictEqual(files.size, 0);
});
await test('uninstalling the pack in use: dark, and nothing of the pack left', async () => {
  const p = await start({ theme: 'rain', downpour: true, fallingRain: true });
  p.selectTheme('rain', 'wet-neon');
  p.setSwitch('falling rain', false);
  const msg = await p.packs.uninstall('rain');
  assert.strictEqual(msg, 'rain uninstalled. switched to dark.');
  assert.deepStrictEqual([p.settings.pack, p.settings.theme], ['classic', 'dark']);
  assert.ok(!files.has('Tree packs/rain.tree-pack.json'));
  assert.deepStrictEqual(Object.keys(p.settings.packSwitches).filter(k => k.startsWith('rain/')), []);
  assert.strictEqual(p.settings.packLast.rain, undefined);
});
await test('a pack not synced yet: its theme is kept, shown in its remembered colors', async () => {
  const first = await start({ theme: 'rain', downpour: true });
  const settings = first.saved;
  const p = await start(settings, {});   // another device: settings synced, the pack file not yet
  assert.deepStrictEqual([p.settings.pack, p.settings.theme], ['rain', 'downpour']);
  const { pack, theme } = p.currentTheme();
  assert.strictEqual(pack, null);
  assert.strictEqual(theme.colors.bg, '#0e1517');
  assert.strictEqual(theme.effects.length, 0, 'effects wait for the pack');
});
await test('the font sizes start at 12px', async () => {
  const { SIZES } = await import('data:text/javascript,export const SIZES=1').then(() => ({ SIZES: null }));
  const src = readFileSync('src/settings.ts', 'utf8');
  assert.ok(/SIZES = \[0, 12, 14/.test(src));
});

console.log(failed ? `\n${failed} failed, ${passed} passed.` : `\nAll ${passed} passed.`);
process.exit(failed ? 1 : 0);
