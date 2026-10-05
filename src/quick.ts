import { FONTS, SIZES, THEMES } from './settings';
import type TreePlugin from './main';

const fontKeys  = Object.keys(FONTS);
const themeKeys = Object.keys(THEMES);
const sizeLabel = (n: number) => (n ? n + 'px' : 'default');

// Small Tree-style popover above the status line: theme / font / size, each cycled with ‹ ›.
export class QuickPanel {
  el: HTMLElement | null = null;
  private outside = (e: PointerEvent) => {
    if (this.el && !this.el.contains(e.target as Node) && !(e.target as HTMLElement).closest('.tree-quick-toggle')) this.close();
  };
  private keys = (e: KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.close(); }
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
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
  }

  private render() {
    if (!this.el) return;
    const s = this.plugin.settings;
    this.el.empty();
    this.row('theme', THEMES[s.theme] === THEMES[''] ? 'none' : THEMES[s.theme], dir => {
      s.theme = step(themeKeys, s.theme, dir);
    });
    this.row('font', FONTS[s.font], dir => {
      s.font = step(fontKeys, s.font, dir);
    });
    this.row('size', sizeLabel(s.fontSize), dir => {
      s.fontSize = step(SIZES, s.fontSize, dir);
    });
    const zenModes = ['off', 'sentence', 'paragraph'] as const;
    this.row('zen', s.zen ? s.zenGranularity : 'off', dir => {
      const next = step([...zenModes], s.zen ? s.zenGranularity : 'off', dir);
      s.zen = next !== 'off';
      if (next !== 'off') s.zenGranularity = next;
    });
    this.row('typewriter', s.typewriter ? 'on' : 'off', () => {
      s.typewriter = !s.typewriter;
    });
  }

  private row(label: string, value: string, change: (dir: 1 | -1) => void) {
    const row = this.el!.createDiv({ cls: 'tree-quick-row' });
    row.createSpan({ cls: 'tree-quick-label', text: label });
    const apply = async (dir: 1 | -1) => {
      change(dir);
      await this.plugin.saveSettings();
      this.render();
    };
    row.createEl('button', { cls: 'tree-quick-arrow', text: '‹' }).onclick = () => apply(-1);
    row.createEl('button', { cls: 'tree-quick-value', text: value }).onclick = () => apply(1);
    row.createEl('button', { cls: 'tree-quick-arrow', text: '›' }).onclick = () => apply(1);
  }
}

function step<T>(list: T[], current: T, dir: 1 | -1): T {
  const i = Math.max(0, list.indexOf(current));
  return list[(i + dir + list.length) % list.length];
}
