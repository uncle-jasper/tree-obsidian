import { FONTS, SIZES, THEMES, TreeSettings, themeName } from './settings';
import type TreePlugin from './main';

interface Option { key: string; label: string; }

// One row of the panel: its options, which one is current, and how to apply a pick.
interface Choice {
  label: string;
  options: Option[];
  get(s: TreeSettings): string;
  set(s: TreeSettings, key: string): void;
  labelFor?: (s: TreeSettings, key: string) => string;   // a label that isn't fixed: a secret theme, or a custom theme's own name
  from?: (s: TreeSettings) => string; // where ‹ › step from when the current value isn't in options
}

const fromRecord = (rec: Record<string, string>): Option[] => Object.entries(rec).map(([key, label]) => ({ key, label }));

const CHOICES: Choice[] = [
  {
    label: 'theme',
    options: fromRecord(THEMES).map(o => (o.key === '' ? { key: '', label: 'none' } : o)),
    get: s => s.theme,
    set: (s, k) => { s.theme = k; },
    labelFor: themeName,
    from: s => s.secretReturn,
  },
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
];

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

    for (const choice of CHOICES) {
      const current = choice.get(s);
      const found = choice.options.findIndex(o => o.key === current);
      const i = found >= 0 ? found : Math.max(0, choice.options.findIndex(o => o.key === choice.from?.(s)));
      const step = (dir: 1 | -1) => choice.options[(i + dir + choice.options.length) % choice.options.length].key;
      const isOpen = this.listOpen === choice.label;

      const row = this.el.createDiv({ cls: 'tree-quick-row' });
      row.createSpan({ cls: 'tree-quick-label', text: choice.label });
      row.createEl('button', { cls: 'tree-quick-arrow', text: '‹' }).onclick = () => this.pick(choice, step(-1));
      const value = row.createEl('button', { cls: 'tree-quick-value' + (isOpen ? ' is-active' : ''), text: choice.labelFor?.(s, current) ?? (found >= 0 ? choice.options[i].label : current) });
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
          const item = list.createEl('button', { cls: 'tree-quick-item' + (opt.key === current ? ' is-current' : ''), text: choice.labelFor?.(s, opt.key) ?? opt.label });
          item.onclick = () => { this.listOpen = null; this.pick(choice, opt.key); };
        }
        list.querySelector<HTMLElement>('.is-current')?.scrollIntoView({ block: 'nearest' });
      }
    }
  }
}
