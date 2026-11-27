import { FONTS, SIZES, TreeSettings, themeName, themesOf, switchOn } from './settings';
import TreePacks from './packs';
import type TreePlugin from './main';

interface Option { key: string; label: string; }

// One row of the panel: its options, which one is current, and how to apply a pick.
interface Choice {
  label: string;
  options: Option[];
  get(s: TreeSettings): string;
  set(s: TreeSettings, key: string): void;
  spacer?: boolean;   // an empty row, holding the place of a switch this theme doesn't have
}

const onOff: Option[] = [{ key: 'off', label: 'off' }, { key: 'on', label: 'on' }];

const fromRecord = (rec: Record<string, string>): Option[] => Object.entries(rec).map(([key, label]) => ({ key, label }));

const SETTINGS_ROWS: Choice[] = [
  {
    label: 'font',
    options: fromRecord(FONTS),
    get: s => s.font,
    set: (s, k) => { s.font = k; },
  },
  {
    label: 'size',
    options: SIZES.map(n => ({ key: String(n), label: n ? n + 'px' : 'default' })),
    get: s => String(s.fontSize),
    set: (s, k) => { s.fontSize = Number(k); },
  },
  {
    label: 'zen',
    options: ['off', 'sentence', 'paragraph'].map(k => ({ key: k, label: k })),
    get: s => (s.zen ? s.zenGranularity : 'off'),
    set: (s, k) => {
      s.zen = k !== 'off';
      if (k !== 'off') s.zenGranularity = k as TreeSettings['zenGranularity'];
    },
  },
  {
    label: 'typewriter',
    options: [{ key: 'off', label: 'off' }, { key: 'on', label: 'on' }],
    get: s => (s.typewriter ? 'on' : 'off'),
    set: (s, k) => { s.typewriter = k === 'on'; },
  },
  {
    label: 'proof',
    options: [{ key: 'off', label: 'off' }, { key: 'on', label: 'on' }],
    get: s => (s.proof ? 'on' : 'off'),
    set: (s, k) => { s.proof = k === 'on'; },
  },
];

// The pack row, the theme row (stepping within the pack, never into the next one) and the
// theme's own switches, worked out each time from the packs installed: as in Tree's quick settings.
function themeRows(plugin: TreePlugin): Choice[] {
  const s = plugin.settings, store = plugin.packs;
  const pack = store.find(s.pack);
  const rows: Choice[] = [{
    label: 'pack',
    options: [...store.all().map(p => ({ key: p.id, label: p.name.toLowerCase() })), ...(pack ? [] : [{ key: s.pack, label: s.pack }])],
    get: s => s.pack,
    set: (_s, k) => plugin.selectPack(k),
  }];
  if (!pack) return rows;   // its pack isn't here (yet): nothing to step through
  rows.push({
    label: 'theme',
    options: themesOf(pack).map(t => ({ key: t.id, label: themeName(s, pack.id, t) })),
    get: s => s.theme,
    set: (_s, k) => plugin.selectTheme(pack.id, k),
  });
  const theme = TreePacks.findTheme(pack, s.theme);
  const switches = TreePacks.switchesOf(theme);
  for (const sw of switches) rows.push({
    label: sw.label,
    options: onOff,
    get: s => (switchOn(s, theme, sw.label) ? 'on' : 'off'),
    set: (_s, k) => plugin.setSwitch(sw.label, k === 'on'),
  });
  return rows;
}

// Small Tree-style popover above the status line. ‹ › flick through options;
// clicking the name opens the full list under that row.
export class QuickPanel {
  el: HTMLElement | null = null;
  private listOpen: string | null = null;   // label of the row whose list is showing

  private outside = (e: PointerEvent) => {
    if (this.el && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tree-quick-toggle')) this.close();
  };
  private keys = (e: KeyboardEvent) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopPropagation();
    // Escape backs out one step: list first, then the panel
    if (this.listOpen) { this.listOpen = null; this.render(); } else this.close();
  };

  constructor(private plugin: TreePlugin) {}

  get isOpen() { return !!this.el; }

  toggle(anchor: HTMLElement) {
    if (this.el) this.close(); else this.open(anchor);
  }

  open(anchor: HTMLElement) {
    this.el = anchor.createDiv({ cls: 'tree-quick' });
    anchor.addClass('is-open');
    this.render();
    document.addEventListener('pointerdown', this.outside, true);
    document.addEventListener('keydown', this.keys, true);
  }

  close() {
    if (!this.el) return;
    this.el.parentElement?.removeClass('is-open');
    this.el.remove();
    this.el = null;
    this.listOpen = null;
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
  }

  private async pick(choice: Choice, key: string) {
    choice.set(this.plugin.settings, key);
    await this.plugin.saveSettings();
    this.render();
  }

  private render() {
    if (!this.el) return;
    const s = this.plugin.settings;
    this.el.empty();

    // The panel grows up from the status line, so a theme with fewer switches would move every row above.
    // Empty rows at the bottom make up for switches this theme lacks: the panel keeps its height, and
    // stepping through packs and themes, the pack and theme rows stay put under the pointer.
    const rows = [...themeRows(this.plugin), ...SETTINGS_ROWS];
    const most = Math.max(0, ...this.plugin.packs.all().flatMap(p => p.themes.map(t => TreePacks.switchesOf(t).length)));
    const has = TreePacks.switchesOf(TreePacks.findTheme(this.plugin.packs.find(s.pack), s.theme)).length;
    for (let n = has; n < most; n++) rows.push({ label: '', options: onOff, get: () => 'off', set: () => {}, spacer: true });
    for (const choice of rows) {
      const current = choice.get(s);
      const found = choice.options.findIndex(o => o.key === current);
      const i = Math.max(0, found);
      const step = (dir: 1 | -1) => choice.options[(i + dir + choice.options.length) % choice.options.length].key;
      const isOpen = this.listOpen === choice.label;

      const row = this.el.createDiv({ cls: 'tree-quick-row' });
      if (choice.spacer) { row.addClass('is-spacer'); row.setAttr('aria-hidden', 'true'); }
      row.createSpan({ cls: 'tree-quick-label', text: choice.label });
      row.createEl('button', { cls: 'tree-quick-arrow', text: '‹' }).onclick = () => this.pick(choice, step(-1));
      const value = row.createEl('button', { cls: 'tree-quick-value' + (isOpen ? ' is-active' : ''), text: found >= 0 ? choice.options[i].label : current });
      row.createEl('button', { cls: 'tree-quick-arrow', text: '›' }).onclick = () => this.pick(choice, step(1));

      // On/off rows just flip; everything else opens its list
      value.onclick = () => {
        if (choice.options.length <= 2) { this.pick(choice, step(1)); return; }
        this.listOpen = isOpen ? null : choice.label;
        this.render();
      };

      if (isOpen) {
        const list = this.el.createDiv({ cls: 'tree-quick-list' });
        for (const opt of choice.options) {
          const item = list.createEl('button', { cls: 'tree-quick-item' + (opt.key === current ? ' is-current' : ''), text: opt.label });
          item.onclick = () => { this.listOpen = null; this.pick(choice, opt.key); };
        }
        list.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}
