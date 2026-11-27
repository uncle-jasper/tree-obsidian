// A theme pack's layers (falling rain, light, scanlines) behind or over each open note only, never the
// sidebars or the title bar: Dan's choice for rain, kept for every pack. One packs.js stage per note,
// in its .view-content (contained). Colors, glow and sheen are painted once for the window, in main.ts.
// Paused while Obsidian is hidden and still under reduced motion: packs.js does both.
import TreePacks, { Choices, PackTheme, Stage } from './packs';
import type TreePlugin from './main';

const LAYER_EFFECTS = ['particles', 'light', 'overlay'];

export class PackLayers {
  private stages = new Map<HTMLElement, { stage: Stage; key: string }>();
  private theme: PackTheme | null = null;
  private choices: Choices = {};

  constructor(private plugin: TreePlugin) {}

  register() { this.plugin.register(() => this.clear()); }

  // The theme in use (null: none from a pack) and its switch choices
  show(theme: PackTheme | null, choices: Choices) {
    this.theme = theme && !theme.native && theme.effects.some(e => LAYER_EFFECTS.includes(e.type)) ? theme : null;
    this.choices = choices;
    this.sync();
  }

  // Called again whenever notes open or close (layout-change)
  sync() {
    const hosts = new Set<HTMLElement>();
    if (this.theme) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
        const host = leaf.view.containerEl.querySelector<HTMLElement>(':scope > .view-content');
        if (host) hosts.add(host);
      }
    }
    for (const [host, s] of this.stages) {
      if (!hosts.has(host) || !host.isConnected) { s.stage.destroy(); this.stages.delete(host); }
    }
    if (!this.theme) return;
    // Re-applied only when something changed, so rain keeps falling and light keeps its rhythm
    const key = this.theme.id + JSON.stringify(this.choices) + JSON.stringify(this.theme.effects);
    for (const host of hosts) {
      let s = this.stages.get(host);
      if (!s) {
        s = { stage: TreePacks.createStage({ root: host, layers: host, parts: ['layers'], contained: true, themeAttr: false, backdropClass: 'tree-pack-backdrop' }), key: '' };
        this.stages.set(host, s);
      }
      if (s.key !== key) { s.stage.apply(this.theme, this.choices); s.key = key; }
    }
  }

  clear() {
    for (const s of this.stages.values()) s.stage.destroy();
    this.stages.clear();
  }
}
