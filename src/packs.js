// packs.js: the theme-pack engine shared by Tree, Ginkgo and the Tree
// Obsidian plugin (PACKS-PLAN.md, rule 8). One file, no dependencies.
// Tree and Ginkgo load it like spell.js; the plugin copies it into its build;
// the tree-packs previewer loads it from Tree.
//
// What it does:
//   check(json)          read a pack file and make it safe (FORMAT.md, version 1)
//   BUILTIN              Classic and Retro, the packs built into every app
//   createStage(opts)    paint a theme into a page: colors and effects
//   fromLegacy(settings) where a saved setting from before packs lands now
//   + small helpers for the pack row, the theme row, switches and saved colors
//
// A pack file is data only. Nothing in it is ever run or inserted as HTML:
// colors must be #rrggbb, numbers are clamped, text is cut to length, and
// anything else is dropped.

(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.TreePacks = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const FORMAT = 1;
  const ID = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
  const HEX = /^#[0-9a-f]{6}$/i;
  const VER = /^\d+\.\d+\.\d+$/;
  const COLORS = ['bg', 'surface', 'text', 'accent', 'muted', 'border'];
  const GLOW_TARGETS = ['text', 'links', 'cursor'];

  // ── Reading a pack ────────────────────────────────────────────────────
  const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
  const num = (v, lo, hi, def) => (typeof v === 'number' && isFinite(v)) ? Math.min(hi, Math.max(lo, v)) : def;
  const text = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max) : '');
  const hex = v => (typeof v === 'string' && HEX.test(v)) ? v.toLowerCase() : null;
  function rect(r, needsY) {
    if (!isObj(r) || !hex(r.color)) return null;
    const out = { x: num(r.x, 0, 1, 0.5), w: num(r.w, 0, 1, 0.3), h: num(r.h, 0, 1, 0.3), color: hex(r.color) };
    if (needsY) out.y = num(r.y, 0, 1, 0.5);
    return out;
  }
  function sw(e, out) {
    const label = text(e.switch, 24);
    if (label) { out.switch = label; out.on = e.on === true; }
    return out;
  }

  // One effect, made safe. Returns null for a type this engine doesn't know,
  // so the theme still loads with its colors (FORMAT.md, "Effects").
  function cleanEffect(e) {
    if (!isObj(e)) return null;
    if (e.type === 'particles') {
      const out = { type: 'particles', color: hex(e.color),
        opacity: num(e.opacity, 0.2, 3, 1), density: num(e.density, 0.2, 3, 1), speed: num(e.speed, 0.2, 3, 1),
        length: num(e.length, 0.2, 3, 1), slant: num(e.slant, -0.5, 0.5, 0.12), regions: [] };
      for (const r of (Array.isArray(e.regions) ? e.regions : []).slice(0, 8)) {
        const c = rect(r, true);
        if (c) { c.chance = num(r.chance, 0, 1, 0.5); out.regions.push(c); }
      }
      if (e.style === 'snow') out.style = 'snow';   // round flakes that drift; streaks otherwise
      return sw(e, out);
    }
    if (e.type === 'light') {
      const spots = (Array.isArray(e.spots) ? e.spots : []).slice(0, 6).map(s => {
        const c = rect(s, true); if (c) c.strength = num(s.strength, 0, 0.4, 0.15); return c; }).filter(Boolean);
      const streaks = (Array.isArray(e.streaks) ? e.streaks : []).slice(0, 6).map(s => {
        const c = rect(s, false); if (c) c.strength = num(s.strength, 0, 0.4, 0.1); return c; }).filter(Boolean);
      if (!spots.length && !streaks.length) return null;
      return sw(e, { type: 'light', spots, streaks, flicker: e.flicker === true, pulse: e.pulse === true });
    }
    if (e.type === 'overlay') {
      const out = { type: 'overlay', scanlines: num(e.scanlines, 0, 0.5, 0), vignette: null };
      if (isObj(e.vignette) && hex(e.vignette.color))
        out.vignette = { color: hex(e.vignette.color), strength: num(e.vignette.strength, 0, 0.8, 0.4) };
      return sw(e, out);
    }
    if (e.type === 'glow') {
      if (!GLOW_TARGETS.includes(e.target)) return null;
      return sw(e, { type: 'glow', target: e.target, strength: num(e.strength, 0, 1, 0.4) });
    }
    if (e.type === 'sheen') {
      const colors = (Array.isArray(e.colors) ? e.colors : []).map(hex).filter(Boolean).slice(0, 8);
      if (colors.length < 2) return null;
      return sw(e, { type: 'sheen', colors, seconds: num(e.seconds, 3, 20, 7) });
    }
    return null;
  }

  // check(json or object) → { ok: true, pack } or { ok: false, error }.
  // The error is one plain line for the Packs screen.
  function check(input) {
    let p = input;
    if (typeof p === 'string') {
      try { p = JSON.parse(p); } catch (e) { return fail("This isn't a pack file (it isn't readable JSON)."); }
    }
    if (!isObj(p) || p.treePack === undefined) return fail("This isn't a pack file.");
    if (typeof p.treePack !== 'number' || p.treePack > FORMAT || p.treePack < 1)
      return fail('This pack needs a newer version of the app.');
    if (typeof p.id !== 'string' || !ID.test(p.id)) return fail("The pack's ID is missing or malformed.");
    const name = text(p.name, 24);
    if (!name) return fail('The pack has no name.');
    if (typeof p.version !== 'string' || !VER.test(p.version)) return fail("The pack's version should look like 1.0.0.");
    const description = text(p.description, 120);
    if (!description) return fail('The pack has no description.');
    if (!Array.isArray(p.themes) || !p.themes.length) return fail('The pack has no themes.');
    if (p.themes.length > 8) return fail('A pack can hold at most 8 themes.');
    const themes = [], seen = new Set();
    for (const t of p.themes) {
      if (!isObj(t) || typeof t.id !== 'string' || !ID.test(t.id)) return fail('A theme has a missing or malformed ID.');
      if (seen.has(t.id)) return fail(`Two themes share the ID "${t.id}".`);
      seen.add(t.id);
      const tname = text(t.name, 24);
      if (!tname) return fail(`Theme "${t.id}" has no name.`);
      if (!isObj(t.colors)) return fail(`Theme "${tname}" has no colors.`);
      const colors = {};
      for (const k of COLORS) {
        colors[k] = hex(t.colors[k]);
        if (!colors[k]) return fail(`Theme "${tname}": ${k} should be a color like #1a2b3c.`);
      }
      if (hex(t.colors.selection)) colors.selection = hex(t.colors.selection);
      const effects = (Array.isArray(t.effects) ? t.effects : []).slice(0, 6).map(cleanEffect).filter(Boolean);
      themes.push({ id: t.id, name: tname, light: t.light === true, colors, effects });
    }
    if (!seen.has(p.everyday)) return fail("The pack's everyday theme isn't one of its themes.");
    return { ok: true, pack: { treePack: 1, id: p.id, name, version: p.version,
      description, everyday: p.everyday, themes } };
  }
  function fail(error) { return { ok: false, error }; }

  // Is `b` a newer version than `a`? ("1.2.0" vs "1.10.0")
  function newer(a, b) {
    const pa = String(a).split('.').map(Number), pb = String(b).split('.').map(Number);
    for (let i = 0; i < 3; i++) if ((pb[i] || 0) !== (pa[i] || 0)) return (pb[i] || 0) > (pa[i] || 0);
    return false;
  }

  // ── Built-in packs ────────────────────────────────────────────────────
  // Classic and Retro keep each app's own theme code (PACKS-PLAN.md, rule
  // 5), so their themes carry `native`: the app theme name and body classes
  // that draw them today. Their colors are the same as that code's, for
  // places that need the six colors (Ginkgo's frame, saved colors).
  // A `native` effect is a switch that toggles a body class (terminal's crt).
  // Only built-in packs can have these; check() drops them from pack files.
  const T = (id, name, light, c, extra) => Object.assign({ id, name, light,
    colors: { bg: c[0], surface: c[1], text: c[2], accent: c[3], muted: c[4], border: c[5] }, effects: [],
    native: { theme: id, classes: [] } }, extra || {});
  const custom = (id, name) => T(id, name, true, ['#f5f0e8', '#ede8de', '#2c2416', '#8b6e4e', '#a89880', '#d4c8b4'], { custom: true });
  const CRT = { type: 'native', switch: 'crt', on: false, className: 'crt-on' };
  const CRT_ON = Object.assign({}, CRT, { on: true });   // amber terminal and doogie journal start with crt on
  const BUILTIN = [
    { treePack: 1, id: 'classic', name: 'Classic', version: '1.0.0', builtin: true, everyday: 'parchment',
      description: "Tree's own themes, and your three custom ones.",
      themes: [
        T('parchment', 'parchment', true,  ['#f5f0e8', '#ede8de', '#2c2416', '#8b6e4e', '#a89880', '#d4c8b4']),
        T('paper',     'paper',     true,  ['#f5f7fa', '#eceef2', '#1a1d23', '#4a6080', '#8a96a8', '#d4d8e0']),
        T('ash',       'ash',       true,  ['#b0b0b0', '#a4a4a4', '#0e0e0e', '#3a3a3a', '#555555', '#909090']),
        T('sage',      'sage',      true,  ['#c4d9c4', '#b8cfb8', '#162016', '#3a6640', '#4a6050', '#a0bfa0']),
        T('dark',      'dark',      false, ['#1a1a1a', '#252525', '#d8d8d8', '#444444', '#555555', '#2a2a2a']),
        T('moss',      'moss',      false, ['#1e2420', '#242d28', '#d4ddd0', '#82b890', '#607860', '#2e3d30']),
        T('slate',     'slate',     false, ['#1c2333', '#232d40', '#d0d8e8', '#7a9fd4', '#5a7090', '#2e3d54']),
        custom('custom', 'custom'), custom('custom2', 'custom 2'), custom('custom3', 'custom 3'),
      ] },
    { treePack: 1, id: 'retro', name: 'Retro', version: '1.0.0', builtin: true, everyday: 'terminal',
      description: 'Screens from the 80s and 90s.',
      themes: [
        T('gameboy',    'game boy',   true,  ['#b5bd8e', '#a6ae80', '#33422a', '#5f6f47', '#7c8760', '#96a072']),
        T('moonwalker', 'moonwalker', false, ['#000000', '#0b0f14', '#6cb5f8', '#0127dd', '#1a3fae', '#0d1a4a']),
        T('terminal',   'terminal',   false, ['#0a0a0a', '#0f0f0f', '#22cc22', '#0a5c0a', '#1a7a1a', '#1a3a1a'], { effects: [CRT] }),
        T('amber-crt',  'amber terminal', false, ['#0a0a0a', '#0f0f0f', '#ffb000', '#7a4a00', '#a06a00', '#3a2200'],
          { native: { theme: 'terminal', classes: ['amber-crt'] }, effects: [CRT_ON] }),
        T('doogie-journal', 'doogie journal', false, ['#0000aa', '#0000aa', '#eaeaea', '#00aaaa', '#7575ca', '#2323b4'],
          { native: { theme: 'terminal', classes: ['doogie-journal'] }, effects: [CRT_ON] }),
      ] },
  ];

  // A custom slot's theme from the app's own custom colors. Same mapping
  // Ginkgo's frame has always used.
  function customTheme(slot, c) {
    const base = BUILTIN[0].themes.find(t => t.id === slot);
    if (!base || !c || !hex(c.bg) || !hex(c.text) || !hex(c.accent)) return base;
    const bg = hex(c.bg), tx = hex(c.text), ac = hex(c.accent);
    return Object.assign({}, base, { name: text(c.name, 24) || base.name, light: luminance(bg) > 0.4,
      colors: { bg, surface: bg, text: tx, accent: ac, muted: ac, border: ac } });
  }

  // ── Old settings → pack, theme, switches ──────────────────────────────
  // The table in PACKS-PLAN.md, "Moving today's settings over". `settings`
  // is the saved tree-editor-settings object (or null on first run).
  function fromLegacy(s) {
    const theme = s && typeof s.theme === 'string' ? s.theme : '';
    if (['gameboy', 'moonwalker'].includes(theme)) return { pack: 'retro', theme, switches: {} };
    if (theme === 'terminal') return { pack: 'retro', theme: 'terminal', switches: { crt: !!s.crtEnabled } };
    if (theme === 'rain') {
      if (!s.downpour) return { pack: 'rain', theme: 'rain', switches: { 'falling rain': false } };
      return { pack: 'rain', theme: 'downpour', switches: { 'falling rain': !s.rainStill } };
    }
    const classic = BUILTIN[0].themes.map(t => t.id);
    return { pack: 'classic', theme: classic.includes(theme) ? theme : 'parchment', switches: {} };
  }

  // ── The pack row and the theme row ────────────────────────────────────
  function findTheme(pack, id) { return pack && pack.themes.find(t => t.id === id) || null; }
  // The theme a pack opens on: the one last used in it, else its everyday one.
  function openingTheme(pack, lastUsed) {
    const id = lastUsed && lastUsed[pack.id];
    return findTheme(pack, id) || findTheme(pack, pack.everyday) || pack.themes[0];
  }
  // Step within the pack, wrapping around, never into the next pack.
  function stepTheme(pack, id, dir) {
    const i = Math.max(0, pack.themes.findIndex(t => t.id === id));
    const n = pack.themes.length;
    return pack.themes[((i + (dir < 0 ? -1 : 1)) % n + n) % n];
  }
  // The switches a theme shows, each once: [{ label, on }].
  function switchesOf(theme) {
    const out = [];
    for (const e of (theme && theme.effects) || []) {
      if (e.switch && !out.some(s => s.label === e.switch)) out.push({ label: e.switch, on: !!e.on });
    }
    return out;
  }
  // Effects that are on, given the person's switch choices ({ label: bool }).
  function activeEffects(theme, choices) {
    return ((theme && theme.effects) || []).filter(e =>
      !e.switch || (choices && typeof choices[e.switch] === 'boolean' ? choices[e.switch] : !!e.on));
  }

  // ── Saved colors ──────────────────────────────────────────────────────
  // What the app saves about the theme in use, so it keeps showing even if
  // its pack isn't installed (offline, shelf unreachable). Colors only:
  // effects wait until the pack is back (PACKS-PLAN.md, rule 4).
  function remember(pack, theme) {
    return { pack: pack.id, theme: theme.id, name: theme.name, light: !!theme.light, colors: Object.assign({}, theme.colors) };
  }
  function fromMemory(m) {
    if (!isObj(m) || !isObj(m.colors) || !COLORS.every(k => hex(m.colors[k]))) return null;
    const colors = {};
    for (const k of COLORS) colors[k] = hex(m.colors[k]);
    if (hex(m.colors.selection)) colors.selection = hex(m.colors.selection);
    return { id: String(m.theme || 'remembered'), name: text(m.name, 24) || 'theme', light: m.light === true, colors, effects: [], remembered: true };
  }

  // ── Colors ────────────────────────────────────────────────────────────
  const rgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));
  const rgba = (h, a) => `rgba(${rgb(h).join(',')},${+a.toFixed(4)})`;
  function luminance(h) {
    const [r, g, b] = rgb(h).map(c => c / 255).map(c => c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }
  // CSS variables for a theme: Tree's six, plus --selection.
  function cssVars(theme) {
    const c = theme.colors, v = {};
    for (const k of COLORS) v['--' + k] = c[k];
    v['--selection'] = c.selection || rgba(c.accent, 0.24);
    return v;
  }

  // ── The stage: painting a theme into a page ───────────────────────────
  // opts:
  //   root       element that gets the colors and theme marks (document.body)
  //   layers     element the effect layers go in (document.body)
  //   selectors  { text, links, cursor, headings }: what glow and sheen
  //              style. Each app passes its own; these defaults are generic.
  //   themeAttr  the dataset key that names the theme (default 'theme')
  //   packTheme  that key's value for a theme from a pack file ('pack')
  //   backdropClass  class on root while something is drawn behind the
  //              page, so the app can make its panes see-through ('tp-backdrop')
  //   parts      what this stage paints: 'colors' (CSS variables on root),
  //              'css' (glow, sheen, selection) and 'layers' (particles,
  //              light, overlay). All three unless given; the Obsidian plugin
  //              paints colors and css once for the window, and layers in
  //              each note.
  //   varPrefix  prefix of the color variables ('--': --bg, --text…)
  //   themeAttr  false to leave root's dataset alone
  //   contained  layers fill the `layers` element instead of the window:
  //              absolutely placed, sized to it. Layer elements carry the
  //              class tp-layer (tp-behind or tp-front), for the app's CSS.
  //
  // stage.apply(theme, choices) shows a theme with the person's switch
  // choices; stage.clear() removes everything; stage.destroy() too, for good.
  const DEFAULT_SELECTORS = { text: 'body', links: 'a', cursor: '.cm-cursor', headings: 'h1, h2, h3, h4, h5, h6' };
  let stageCount = 0;

  function createStage(opts) {
    opts = opts || {};
    const doc = (opts.root && opts.root.ownerDocument) || document;
    const win = doc.defaultView;
    const root = opts.root || doc.body;
    const layersIn = opts.layers || doc.body;
    const sel = Object.assign({}, DEFAULT_SELECTORS, opts.selectors || {});
    const attr = opts.themeAttr === false ? null : (opts.themeAttr || 'theme');
    const parts = new Set(opts.parts || ['colors', 'css', 'layers']);
    const prefix = opts.varPrefix || '--';
    const contained = !!opts.contained;
    const packTheme = opts.packTheme || 'pack';
    const backdropClass = opts.backdropClass || 'tp-backdrop';
    const uid = 'tp' + (++stageCount);
    let current = null, setVars = [], setClasses = [], layers = [], styleEl = null, rains = [];

    function style(cssText) {
      if (!styleEl) { styleEl = doc.createElement('style'); styleEl.id = uid + '-style'; doc.head.appendChild(styleEl); }
      styleEl.textContent = cssText;
    }
    // z < 0: behind the page; otherwise in front of it.
    function place(el, z, css) {
      el.className = uid + '-layer tp-layer ' + (z < 0 ? 'tp-behind' : 'tp-front');
      el.setAttribute('aria-hidden', 'true');
      // A canvas needs its size spelled out; a div fills its inset, which may reach past the edges (light streaks).
      const size = el.tagName === 'CANVAS' ? 'width:100%;height:100%;' : '';
      el.style.cssText = (contained
        ? `position:absolute;inset:0;${size}pointer-events:none;z-index:${z < 0 ? 'auto' : 10};`
        : `position:fixed;inset:0;${size}pointer-events:none;z-index:${z};`) + 'display:block;' + (css || '');
      // Contained, a layer behind the page comes first, so the page paints over it.
      if (contained && z < 0) layersIn.prepend(el); else layersIn.appendChild(el);
      layers.push(el);
      return el;
    }
    const layer = (z, css) => place(doc.createElement('div'), z, css);

    function clearLook() {
      for (const k of setVars) root.style.removeProperty(k);
      for (const c of setClasses) root.classList.remove(c);
      setVars = []; setClasses = [];
      root.classList.remove(backdropClass);
      root.style.removeProperty('color-scheme');
      for (const l of layers) l.remove();
      layers = [];
      if (styleEl) styleEl.textContent = '';
      // Leave no empty attributes behind.
      if (root.getAttribute('style') === '') root.removeAttribute('style');
      if (root.getAttribute('class') === '') root.removeAttribute('class');
    }

    function apply(theme, choices) {
      if (!theme) return;
      const on = activeEffects(theme, choices);
      const prevRains = rains;
      clearLook();
      current = theme;

      if (theme.native) {
        // The app's own theme code draws it; only marks and class switches here.
        if (attr) root.dataset[attr] = theme.native.theme;
        const classes = theme.native.classes.slice();
        for (const e of on) if (e.type === 'native' && e.className) classes.push(e.className);
        for (const c of classes) { root.classList.add(c); setClasses.push(c); }
        stopRains(prevRains, true);
        return;
      }

      if (attr) root.dataset[attr] = packTheme;
      if (parts.has('colors')) {
        const vars = cssVars(theme);
        for (const k in vars) { const name = prefix + k.slice(2); root.style.setProperty(name, vars[k]); setVars.push(name); }
        root.style.setProperty('color-scheme', theme.light ? 'light' : 'dark');
      }

      // Selectors are lists ("a, b"): each part gets its own ::selection.
      const each = (list, suffix) => list.split(',').map(x => x.trim() + suffix).join(', ');
      const css = [`${each(sel.text, ' ::selection')}, ${each(sel.text, '::selection')} { background: var(${prefix}selection); }`];
      let behind = false, keep = [];
      on.forEach((e, i) => {
        if (!parts.has(e.type === 'glow' || e.type === 'sheen' ? 'css' : 'layers')) return;
        if (e.type === 'particles') {
          behind = true;
          // Same theme and same effect: keep the rain falling across re-applies.
          const old = prevRains.find(r => r.theme.id === theme.id && r.index === i);
          if (old) { old.setEffect(e, theme); old.start(); keep.push(old); place(old.canvas, -1); }
          else { const r = makeRain(e, theme, i); keep.push(r); r.start(); }
        } else if (e.type === 'light') {
          behind = true;
          lightLayers(e);
        } else if (e.type === 'overlay') {
          overlayLayer(e);
        } else if (e.type === 'glow') {
          css.push(glowCss(e));
        } else if (e.type === 'sheen') {
          css.push(sheenCss(e));
        }
      });
      // Rain that is switched off finishes its fall; rain from another theme just stops.
      for (const r of prevRains) if (!keep.includes(r)) {
        if (r.theme.id === theme.id) { r.ease(); keep.push(r); place(r.canvas, -1); behind = true; }
        else r.destroy();
      }
      rains = keep;
      if (behind) root.classList.add(backdropClass);
      if (parts.has('css')) style(css.join('\n'));
    }

    function stopRains(list, destroy) { for (const r of list) destroy ? r.destroy() : r.stop(); rains = []; }

    // particles ─ the same falling streaks as Tree's rain, drop for drop:
    // with the defaults and the same random numbers, the same picture.
    function makeRain(effect, theme, index) {
      const canvas = place(doc.createElement('canvas'), -1);
      const ctx = canvas.getContext('2d');
      const r = { canvas, theme, index, drops: [], w: 0, h: 0, running: false, easing: false, frame: 0, booted: false };
      let e, base, snow = false;
      r.setEffect = (eff, th) => { e = eff; snow = eff.style === 'snow'; base = rgb(eff.color || th.colors.muted).join(','); };
      r.setEffect(effect, theme);

      // Snow: round flakes, nearer ones bigger, brighter and quicker, swaying as they fall.
      // Its own path, so rain stays drop for drop what it always was.
      function flake(anywhere) {
        const z = Math.random();
        return {
          x: Math.random() * (r.w + 60) - 30,
          y: anywhere ? Math.random() * r.h : -10 - Math.random() * r.h * 0.6,
          rad: (0.8 + z * 1.6) * e.length, v: (0.5 + z * 1.1) * e.speed,
          a: Math.min(1, (0.25 + z * 0.35) * e.opacity),
          phase: Math.random() * Math.PI * 2, sway: 0.3 + z * 0.6,
        };
      }
      function drop(anywhere) {
        if (snow) return flake(anywhere);
        const z = Math.random();
        const d = {
          x: Math.random() * (r.w + 60) - 30,
          y: anywhere ? Math.random() * r.h : -20 - Math.random() * r.h * 0.6,
          len: (14 + z * 22) * e.length, v: (7 + z * 9) * e.speed, a: (0.05 + z * 0.09) * e.opacity,
        };
        if (e.regions.length) d.lit = Math.random();
        return d;
      }
      const count = () => Math.round((r.w * r.h) / (snow ? 6000 : 2600) * e.density);
      function size() {
        const dpr = Math.min(win.devicePixelRatio || 1, 2);
        r.w = contained ? canvas.clientWidth : win.innerWidth;
        r.h = contained ? canvas.clientHeight : win.innerHeight;
        canvas.width = r.w * dpr; canvas.height = r.h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      function fill(anywhere) { r.drops = []; for (let i = 0, n = count(); i < n; i++) r.drops.push(drop(anywhere)); }
      function colorAt(d) {
        if (d.lit !== undefined) {
          const fx = d.x / r.w, fy = d.y / r.h;
          for (const g of e.regions)
            if (d.lit < g.chance && fx >= g.x && fx <= g.x + g.w && fy >= g.y && fy <= g.y + g.h) return rgb(g.color).join(',');
        }
        return base;
      }
      function draw() {
        ctx.clearRect(0, 0, r.w, r.h);
        if (snow) {
          for (const d of r.drops) {
            if (!d) continue;
            ctx.fillStyle = 'rgba(' + base + ',' + d.a + ')';
            ctx.beginPath();
            ctx.arc(d.x, d.y, d.rad, 0, Math.PI * 2);
            ctx.fill();
          }
          return;
        }
        ctx.lineWidth = 1; ctx.lineCap = 'round';
        for (const d of r.drops) {
          if (!d) continue;
          const lit = colorAt(d);
          // Lit streaks are brightest near the lights at the top and bottom, as in the Rain study.
          const a = lit === base ? d.a : d.a * (1 + 0.5 * Math.abs(1 - 2 * Math.min(1, Math.max(0, d.y / r.h))));
          ctx.strokeStyle = 'rgba(' + lit + ',' + a + ')';
          ctx.beginPath();
          ctx.moveTo(d.x, d.y);
          ctx.lineTo(d.x - d.len * e.slant, d.y + d.len);
          ctx.stroke();
        }
      }
      function step() {
        if (!r.running) return;
        let left = 0;
        for (let i = 0; i < r.drops.length; i++) {
          const d = r.drops[i];
          if (!d) continue;
          d.y += d.v;
          d.x -= snow ? d.v * e.slant - Math.sin(d.phase + d.y * 0.015) * d.sway * 0.35 : d.v * e.slant;
          if (d.y > r.h + 20) r.drops[i] = r.easing ? null : drop(false);
          if (r.drops[i]) left++;
        }
        draw();
        if (r.easing && !left) { r.running = false; r.drops = []; return; }
        r.frame = win.requestAnimationFrame(step);
      }
      const reduce = () => win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      r.start = () => {
        r.easing = false;
        if (!r.w) size();
        if (reduce()) { r.running = false; win.cancelAnimationFrame(r.frame); fill(true); draw(); return; }
        if (doc.hidden) return;
        if (!r.drops.some(Boolean)) fill(!r.booted);     // first time: already raining; later: starts at the top
        else r.drops = r.drops.map(d => d || drop(false));
        r.booted = true;
        if (!r.running) { r.running = true; r.frame = win.requestAnimationFrame(step); }
      };
      r.ease = () => {
        r.easing = true;
        if (reduce() || !r.running) { r.running = false; r.drops = []; draw(); }
      };
      r.stop = () => { r.running = false; win.cancelAnimationFrame(r.frame); };
      // Contained, the rain follows its element's size, not the window's.
      if (contained && win.ResizeObserver) {
        r.ro = new win.ResizeObserver(() => { if (canvas.clientWidth !== r.w || canvas.clientHeight !== r.h) r.resize(); });
        r.ro.observe(canvas);
      }
      r.destroy = () => { r.stop(); if (r.ro) r.ro.disconnect(); canvas.remove(); };
      r.resize = () => { size(); if (!r.easing) { fill(true); } draw(); };
      r.visibility = () => { if (doc.hidden) r.stop(); else if (!r.easing) r.start(); else if (r.drops.some(Boolean)) { r.running = true; r.frame = win.requestAnimationFrame(step); } };
      r._internals = { fill, draw, step, size };     // for tests
      return r;
    }

    // light ─ soft colored light behind the page. Drawn the way the Rain
    // and Judgment Day study pages drew it, which Dan approved.
    function lightLayers(e) {
      const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      if (e.spots.length) {
        const g = e.spots.map(s => `radial-gradient(ellipse ${s.w * 100}% ${s.h * 100}% at ${s.x * 100}% ${s.y * 100}%, ${rgba(s.color, s.strength)}, transparent 70%)`);
        const el = layer(-1, `background:${g.join(',')};`);
        if (e.flicker && !reduce && el.animate)      // a neon tube's hum
          el.animate([{ opacity: 1 }, { opacity: 1, offset: 0.47 }, { opacity: 0.82, offset: 0.48 }, { opacity: 1, offset: 0.5 },
            { opacity: 0.9, offset: 0.76 }, { opacity: 1 }], { duration: 6000, iterations: Infinity, easing: 'ease-in-out' });
      }
      if (e.streaks.length) {
        // Each streak fades upward from the bottom edge. The layer runs past
        // the screen so the blur doesn't dim the streaks at its edges.
        const g = e.streaks.map(s => {
          const pos = s.w >= 1 ? 0 : Math.min(1, Math.max(0, (s.x - s.w / 2) / (1 - s.w))) * 100;
          return `linear-gradient(to top, ${rgba(s.color, s.strength)}, transparent) ${pos.toFixed(2)}% 100% / ${s.w * 100}% ${s.h * 100}% no-repeat`;
        });
        // Contained, a clipping layer holds it, so the overhang never reaches past its element.
        let el;
        if (contained) {
          el = doc.createElement('div');
          el.style.cssText = `position:absolute;inset:-40px;background:${g.join(',')};filter:blur(14px);`;
          layer(-1, 'overflow:hidden;').appendChild(el);
        } else el = layer(-1, `inset:-40px;background:${g.join(',')};filter:blur(14px);`);
        if (e.pulse && !reduce && el.animate)        // light breathing on wet pavement
          el.animate([{ opacity: 1 }, { opacity: 0.75 }, { opacity: 1 }], { duration: 9000, iterations: Infinity, easing: 'ease-in-out' });
      }
    }

    // overlay ─ scanlines and a vignette in front of the page.
    function overlayLayer(e) {
      const g = [];
      if (e.scanlines > 0) g.push(`repeating-linear-gradient(to bottom, transparent 0 2px, rgba(0,0,0,${e.scanlines}) 2px 3px)`);
      if (e.vignette && e.vignette.strength > 0) g.push(`radial-gradient(ellipse at center, transparent 55%, ${rgba(e.vignette.color, e.vignette.strength)} 100%)`);
      if (g.length) layer(2147483000, `background:${g.join(',')};`);
    }

    // glow ─ follows the color of what it's on.
    function glowCss(e) {
      const pct = Math.round(e.strength * 100);
      if (e.target === 'cursor')
        return `${sel.cursor} { box-shadow: 0 0 ${Math.round(2 + 8 * e.strength)}px color-mix(in srgb, var(--accent) ${pct}%, transparent), 0 0 2px color-mix(in srgb, var(--accent) ${pct}%, white); }`;
      const shadow = `0 0 ${(0.4 + 0.4 * e.strength).toFixed(2)}em color-mix(in srgb, currentColor ${pct}%, transparent)`;
      return `${e.target === 'links' ? sel.links : sel.text} { text-shadow: ${shadow}; }`;
    }

    // sheen ─ a band of light drifting back and forth across headings.
    function sheenCss(e) {
      const reduce = win.matchMedia && win.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const name = uid + '-sheen';
      const n = e.colors.length - 1;
      const stops = e.colors.map((c, i) => `${c} ${Math.round(i / n * 100)}%`).join(', ');
      return `@keyframes ${name} { 0%, 100% { background-position: 0% 0; } 50% { background-position: 100% 0; } }
${sel.headings} { background-image: linear-gradient(100deg, ${stops});
  background-size: 220% 100%; -webkit-background-clip: text; background-clip: text; color: transparent; -webkit-text-fill-color: transparent;
  ${reduce ? '' : `animation: ${name} ${e.seconds}s ease-in-out infinite;`} }`;
    }

    function onResize() { for (const r of rains) r.resize(); }
    function onVisibility() { for (const r of rains) r.visibility(); }
    win.addEventListener('resize', onResize);
    doc.addEventListener('visibilitychange', onVisibility);

    return {
      apply,
      clear() { stopRains(rains, true); clearLook(); current = null; },
      destroy() {
        stopRains(rains, true); clearLook(); current = null;
        if (styleEl) styleEl.remove();
        win.removeEventListener('resize', onResize);
        doc.removeEventListener('visibilitychange', onVisibility);
      },
      get theme() { return current; },
      get rains() { return rains; },        // for tests
    };
  }

  return { FORMAT, check, newer, BUILTIN, customTheme, fromLegacy, findTheme, openingTheme, stepTheme,
    switchesOf, activeEffects, remember, fromMemory, cssVars, luminance, createStage };
});
