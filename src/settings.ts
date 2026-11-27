import { App, Notice, Platform, PluginSettingTab, Setting } from 'obsidian';
import type TreePlugin from './main';
import { CURSOR_STYLES, linkColor, needsReadable, CUSTOM_KEYS, CustomColors, CustomKey, CursorStyle, isCustom, themeFileName, themeFromFile, themeToFile } from './custom';
import type { JustWriteState } from './justwrite';
import type { TimeGoal, WordGoal } from './status';
import { WP_SECRET_ID } from './wordpress';
import { DIALECTS } from './proof';
import TreePacks, { Choices, Pack, PackTheme, Remembered } from './packs';

export interface TreeSettings {
  pack: string;         // 'classic', 'retro', or an installed pack's id
  theme: string;        // a theme of that pack; '' (Classic only) = leave Obsidian's theme alone
  font: string;         // '' = Obsidian's text font
  fontSize: number;     // 0  = Obsidian's size
  statusLine: boolean;
  statusMessages: boolean;
  hideObsidianStatus: boolean;
  showChars: boolean;
  showReadTime: boolean;
  showCursor: boolean;
  lineLength: number;   // characters per line
  zen: boolean;
  zenGranularity: 'sentence' | 'paragraph';
  typewriter: boolean;
  proof: boolean;           // proof mode; always starts off
  proofDictionary: string;  // the note holding words proof mode accepts
  proofDialect: string;     // key of DIALECTS
  hideExtras: boolean;  // properties and linked/unlinked mentions hidden
  tabOut: boolean;
  justWrite: JustWriteState | null;
  goal: WordGoal | null;
  timeGoal: TimeGoal | null;   // one goal at a time: setting either clears the other
  wpUrl: string;
  wpUser: string;   // the application password lives in Obsidian's secure storage, not here
  packLast: Record<string, string>;            // pack id → the theme last used in it
  packSwitches: Record<string, Choices>;       // 'pack/theme' → its switches (crt, falling rain…)
  packRemembered: Remembered | null;           // colors of the shelf theme in use, for when its pack is missing
  packSeen: Record<string, string>;            // shelf packs already seen in settings: id → version
  packsMigrated: boolean;                      // settings from before packs (2.0) moved over
  custom: CustomColors;
  custom2: CustomColors;
  custom3: CustomColors;
}

export const DEFAULT_SETTINGS: TreeSettings = {
  pack: 'classic',
  theme: 'parchment',
  font: '',
  fontSize: 0,
  statusLine: true,
  statusMessages: true,
  hideObsidianStatus: true,
  showChars: true,
  showReadTime: true,
  showCursor: true,
  lineLength: 68,       // Tree's measure (max-width: 68ch)
  zen: false,
  zenGranularity: 'sentence',
  typewriter: false,
  proof: false,
  proofDictionary: 'Tree dictionary',
  proofDialect: 'american',
  hideExtras: false,
  tabOut: true,
  justWrite: null,
  goal: null,
  timeGoal: null,
  wpUrl: '',
  wpUser: '',
  packLast: {},
  packSwitches: {},
  packRemembered: null,
  packSeen: {},
  packsMigrated: false,
  custom:  { bg: '#f5f0e8', text: '#2c2416', accent: '#8b6e4e' },   // Tree's defaults
  custom2: { bg: '#f5f0e8', text: '#2c2416', accent: '#8b6e4e' },
  custom3: { bg: '#f5f0e8', text: '#2c2416', accent: '#8b6e4e' },
};

// ── Themes come in packs (packs.js, shared with Tree and Ginkgo) ──
// Classic and Retro are built in and drawn by this plugin's own CSS (themes.css). Installed packs
// are painted by packs.js. Classic here also has "none", to leave Obsidian's theme alone.
export const NONE_THEME: PackTheme = { id: '', name: 'none', light: true, effects: [],
  colors: { bg: '#ffffff', surface: '#ffffff', text: '#000000', accent: '#000000', muted: '#000000', border: '#000000' } };
export const themesOf = (pack: Pack) => (pack.id === 'classic' ? [NONE_THEME, ...pack.themes] : pack.themes);
export const CUSTOM_LABELS: Record<CustomKey, string> = { custom: 'custom', custom2: 'custom 2', custom3: 'custom 3' };

export const switchKey = (s: TreeSettings) => s.pack + '/' + s.theme;
export const choicesOf = (s: TreeSettings): Choices => s.packSwitches[switchKey(s)] ?? {};
export function switchOn(s: TreeSettings, theme: PackTheme | null, label: string) {
  const c = choicesOf(s)[label];
  if (typeof c === 'boolean') return c;
  return TreePacks.switchesOf(theme).find(x => x.label === label)?.on ?? false;
}
// The custom slot in use, if any
export const customKey = (s: TreeSettings): CustomKey | null => (s.pack === 'classic' && isCustom(s.theme) ? s.theme : null);

// What's on screen: a theme plus its switches. Each look has its own CSS class (tree-theme-<look>);
// themes from installed packs are all "pack", painted by packs.js.
export const LOOKS = ['parchment', 'paper', 'ash', 'sage', 'dark', 'moss', 'slate', 'custom', 'custom2', 'custom3',
  'gameboy', 'moonwalker', 'terminal', 'terminal-crt', 'amber-terminal', 'amber-crt', 'doogie-plain', 'doogie-journal', 'pack'];
export function lookOf(s: TreeSettings): string {
  if (s.pack === 'classic') return s.theme;
  if (s.pack !== 'retro') return 'pack';
  const crt = switchOn(s, TreePacks.findTheme(TreePacks.BUILTIN[1], s.theme), 'crt');
  if (s.theme === 'terminal') return crt ? 'terminal-crt' : 'terminal';
  if (s.theme === 'amber-crt') return crt ? 'amber-crt' : 'amber-terminal';
  if (s.theme === 'doogie-journal') return crt ? 'doogie-journal' : 'doogie-plain';
  return s.theme;
}

// A named custom theme goes by its name wherever themes are listed
// with (C1) to (C3) after it, so it still reads as one of the custom themes
export const themeName = (s: TreeSettings, packId: string, theme: PackTheme) =>
  (packId === 'classic' && isCustom(theme.id) && s[theme.id].name ? s[theme.id].name + ' (C' + (CUSTOM_KEYS.indexOf(theme.id) + 1) + ')' : theme.name);

export const FONTS: Record<string, string> = {
  '':                                     'Obsidian default',
  "'Tree iAWriterMonoS', monospace":      'iA Writer Mono',
  "'Tree iAWriterDuoS', monospace":       'iA Writer Duo',
  "'Tree iAWriterQuattroS', monospace":   'iA Writer Quattro',
  "'Tree JetBrains Mono', monospace":     'JetBrains Mono',
  "'Tree Inconsolata', monospace":        'Inconsolata',
  "'Tree Geist Mono', monospace":         'Geist Mono',
  "'Tree Geist Sans', sans-serif":        'Geist Sans',
  "'Tree DejaVu Sans Mono', monospace":   'DejaVu Sans Mono',
  "'Tree PerfectDOS437', monospace":      'Perfect DOS VGA 437',
  "'Tree PrintChar21', monospace":        'Print Char 21',
};

export const SIZES = [0, 12, 14, 16, 18, 20, 22, 24, 26];

export class TreeSettingTab extends PluginSettingTab {
  private editing: CustomKey = 'custom';   // the custom theme shown in settings
  constructor(app: App, private plugin: TreePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };
    containerEl.empty();

    const locked = this.plugin.justWrite.active;

    new Setting(containerEl).setName('Appearance').setHeading();
    if (locked) containerEl.createEl('p', { cls: 'setting-item-description', text: 'Locked during Just Write. Write 500 words, or wait out the 30 minutes.' });

    // Themes come in packs, as in Tree and Ginkgo: the pack, then one of its themes, then that theme's switches
    const store = this.plugin.packs;
    const pack = store.find(s.pack) ?? TreePacks.BUILTIN[0];
    new Setting(containerEl)
      .setName('Pack')
      .setDesc('Classic and Retro are built in; more under Packs below.')
      .addDropdown(d => d.addOptions(Object.fromEntries(store.all().map(p => [p.id, p.name])))
        .addOptions(store.find(s.pack) ? {} : { [s.pack]: s.packRemembered?.pack === s.pack ? s.pack + ' (not installed)' : s.pack })
        .setValue(s.pack).setDisabled(locked)
        .onChange(async v => { this.plugin.selectPack(v); await save(); this.display(); }));
    new Setting(containerEl)
      .setName('Theme')
      .setDesc(pack.id === 'classic' ? 'Works best with Obsidian\'s default theme underneath. None leaves Obsidian\'s theme alone.' : 'Works best with Obsidian\'s default theme underneath.')
      .addDropdown(d => d.addOptions(Object.fromEntries(themesOf(pack).map(t => [t.id, themeName(s, pack.id, t)])))
        .setValue(s.theme).setDisabled(locked)
        .onChange(async v => { this.plugin.selectTheme(pack.id, v); await save(); this.display(); }));
    // A theme's own switches, shown only while it's on (as in Tree's quick settings)
    const theme = TreePacks.findTheme(pack, s.theme);
    for (const sw of TreePacks.switchesOf(theme)) {
      new Setting(containerEl).setName(sw.label[0].toUpperCase() + sw.label.slice(1))
        .addToggle(t => t.setValue(switchOn(s, theme, sw.label)).setDisabled(locked)
          .onChange(async v => { this.plugin.setSwitch(sw.label, v); await save(); }));
    }

    new Setting(containerEl)
      .setName('Font')
      .setDesc('Built in, so they work on iPad too.')
      .addDropdown(d => d.addOptions(FONTS).setValue(s.font).setDisabled(locked)
        .onChange(async v => { s.font = v; await save(); }));

    new Setting(containerEl)
      .setName('Font size')
      .addDropdown(d => {
        SIZES.forEach(n => d.addOption(String(n), n ? n + 'px' : 'Obsidian default'));
        d.setValue(String(s.fontSize)).setDisabled(locked).onChange(async v => { s.fontSize = Number(v); await save(); });
      });

    new Setting(containerEl)
      .setName('Line length')
      .setDesc('Characters per line; Tree uses 68. Applies with Obsidian\'s "Readable line length" on, and always in focus mode.')
      .addSlider(sl => sl.setLimits(50, 90, 1).setValue(s.lineLength).setDynamicTooltip().setDisabled(locked)
        .onChange(async v => { s.lineLength = v; await save(); }))
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Back to 68').setDisabled(locked)
        .onClick(async () => { if (locked) return; s.lineLength = 68; await save(); this.display(); }));


    this.displayPacks(containerEl, locked);

    // Custom themes: one editor, for the slot picked here. It opens on the custom theme in use, if any.
    // Only the custom themes can be named, given a cursor, exported or imported over. The built-in ones are fixed.
    new Setting(containerEl).setName('Custom themes').setHeading();
    const inUse = customKey(s);
    if (inUse) this.editing = inUse;
    const key = this.editing;
    new Setting(containerEl)
      .setName('Edit')
      .setDesc('Three themes of your own, in Classic. The same theme file works in Tree and Ginkgo.')
      .addDropdown(d => d.addOptions(Object.fromEntries(CUSTOM_KEYS.map(k => [k, s[k].name ? s[k].name + ' (' + CUSTOM_LABELS[k] + ')' : CUSTOM_LABELS[k]])))
        .setValue(key).onChange(v => { this.editing = v as CustomKey; this.display(); }));
    {
      const colors = s[key];
      new Setting(containerEl)
        .setName('Name')
        .setDesc('Shown in place of "' + CUSTOM_LABELS[key] + '" wherever themes are listed.')
        .addText(t => t.setPlaceholder(CUSTOM_LABELS[key]).setValue(colors.name ?? '').setDisabled(locked).onChange(async v => {
          colors.name = v.trim().slice(0, 24);
          const option = containerEl.querySelector<HTMLOptionElement>('option[value="' + key + '"]');
          if (option && s.pack === 'classic') option.textContent = themeName(s, 'classic', TreePacks.findTheme(TreePacks.BUILTIN[0], key)!);
          await save();
        }));
      const rows: Partial<Record<'bg' | 'text' | 'accent', Setting>> = {};
      let showReadable = () => {};
      for (const [part, label] of [['bg', 'Background'], ['text', 'Text'], ['accent', 'Accent']] as const) {
        rows[part] = new Setting(containerEl)
          .setName(label)
          .setDesc(part === 'bg' ? 'Surfaces, borders and muted text are worked out from these three, as in Tree.' : '')
          .addColorPicker(c => {
            c.setValue(colors[part]).setDisabled(locked).onChange(async v => {
              colors[part] = v;
              this.plugin.pickingColor = true;   // don't ask about readability mid-drag
              showReadable();
              if (customKey(s) !== key) { this.plugin.selectTheme('classic', key); this.display(); }   // picking a color switches to that theme
              await save();
            });
          });
      }
      // Readable colors: an accent too faint to read can be shown adjusted, or exactly as picked. The colors picked are
      // always what's saved, so this can be switched either way. When it would change something, the row shows what:
      // the accent, then the color links and the cursor take instead.
      const readableRow = new Setting(containerEl)
        .setName('Readable colors')
        .addToggle(t => t.setValue(colors.readable !== false).setDisabled(locked)
          .onChange(async v => { colors.readable = v; await save(); }));
      showReadable = () => {
        readableRow.descEl.empty();
        if (!needsReadable(colors)) { readableRow.setDesc('Your colors already read well.'); return; }
        const swatch = (color: string) => {
          readableRow.descEl.createSpan({ cls: 'tree-readable-swatch' }).style.backgroundColor = color;
          readableRow.descEl.appendText(color);
        };
        readableRow.descEl.appendText('The accent is hard to read here. On: ');
        swatch(colors.accent);
        readableRow.descEl.appendText(' → ');
        swatch(linkColor(colors.bg, colors.accent));
        readableRow.descEl.appendText(' for links and the cursor. Off: your color, exactly.');
      };
      showReadable();
      // Once the picker closes, a theme that's now too faint asks whether to adjust it
      for (const part of ['bg', 'accent'] as const)
        rows[part]!.controlEl.querySelector('input[type="color"]')?.addEventListener('change', () => {
          window.setTimeout(() => { this.plugin.pickingColor = false; this.plugin.askReadable(); });
        });
      new Setting(containerEl)
        .setName('Cursor')
        .setDesc('Line is Tree\'s own. Block is tinted, so the letter under it stays readable.')
        .addDropdown(d => d.addOptions(Object.fromEntries(CURSOR_STYLES.map(c => [c, c])))
          .setValue(colors.cursor ?? 'line').setDisabled(locked)
          .onChange(async v => { colors.cursor = v as CursorStyle; await save(); }));
      new Setting(containerEl)
        .setName('Share')
        .setDesc('Export saves this theme as a file; import loads one into this slot.')
        .addButton(b => b.setButtonText('Export').onClick(() => this.exportTheme(key)))
        .addButton(b => b.setButtonText('Import').setDisabled(locked).onClick(() => this.importTheme(key)));
    }

    new Setting(containerEl).setName('Writing').setHeading();

    new Setting(containerEl)
      .setName('Zen mode')
      .setDesc('Fades everything except what you\'re writing.')
      .addDropdown(d => d.addOptions({ off: 'off', sentence: 'sentence', paragraph: 'paragraph' })
        .setValue(s.zen ? s.zenGranularity : 'off')
        .onChange(async v => {
          s.zen = v !== 'off';
          if (v !== 'off') s.zenGranularity = v as TreeSettings['zenGranularity'];
          await save();
        }));

    new Setting(containerEl)
      .setName('Typewriter mode')
      .setDesc('Keeps the line you\'re typing in the middle of the screen.')
      .addToggle(t => t.setValue(s.typewriter)
        .onChange(async v => { s.typewriter = v; await save(); }));

    new Setting(containerEl)
      .setName('Tab out of formatting')
      .setDesc('Tab jumps past closing **, *, ~~, ==, ` or ]], as in Tree.')
      .addToggle(t => t.setValue(s.tabOut)
        .onChange(async v => { s.tabOut = v; await save(); }));

    new Setting(containerEl)
      .setName('Focus mode')
      .setDesc('The ribbon icon or the "Toggle focus mode" command. Escape or the corner mark leaves it.');

    new Setting(containerEl).setName('Status line').setHeading();

    new Setting(containerEl)
      .setName('Show status line')
      .setDesc('At the bottom of each note, on iPad too.')
      .addToggle(t => t.setValue(s.statusLine)
        .onChange(async v => { s.statusLine = v; await save(); }));

    new Setting(containerEl)
      .setName('Hide Obsidian\'s status bar')
      .setDesc('Hover the faint ⋯ at the end of Tree\'s line to bring it back.')
      .addToggle(t => t.setValue(s.hideObsidianStatus)
        .onChange(async v => { s.hideObsidianStatus = v; await save(); }));

    new Setting(containerEl)
      .setName('Status messages')
      .setDesc('Welcome and little typed-out notes.')
      .addToggle(t => t.setValue(s.statusMessages)
        .onChange(async v => { s.statusMessages = v; await save(); }));

    new Setting(containerEl)
      .setName('Character count')
      .addToggle(t => t.setValue(s.showChars)
        .onChange(async v => { s.showChars = v; await save(); }));

    new Setting(containerEl)
      .setName('Reading time')
      .addToggle(t => t.setValue(s.showReadTime)
        .onChange(async v => { s.showReadTime = v; await save(); }));

    new Setting(containerEl)
      .setName('Cursor position')
      .addToggle(t => t.setValue(s.showCursor)
        .onChange(async v => { s.showCursor = v; await save(); }));


    new Setting(containerEl).setName('Proof mode').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text:
      'Spelling and plain grammar mistakes, checked on this device. Style is never flagged. Turn it on from the Aa panel or the "Toggle proof mode" command.' });

    new Setting(containerEl)
      .setName('Spelling')
      .addDropdown(d => d.addOptions(DIALECTS).setValue(s.proofDialect)
        .onChange(async v => { s.proofDialect = v; await save(); await this.plugin.proof.setDialect(); }));

    new Setting(containerEl)
      .setName('Dictionary note')
      .setDesc('Words proof mode accepts, one per line. "Add to dictionary" writes here, and you can edit it by hand. It syncs with your vault.')
      .addText(t => t.setPlaceholder('Tree dictionary').setValue(s.proofDictionary)
        .onChange(async v => { s.proofDictionary = v.trim(); await save(); }));

    const engine = new Setting(containerEl)
      .setName('Proof engine')
      .setDesc('Downloaded from Tree\'s GitHub releases the first time proof mode is turned on (about 8 MB), then works offline.');
    void this.plugin.proof.engineDownloaded().then(has => {
      if (!has) return;
      engine.setDesc('Downloaded to this device. Remove it to free the space; it comes back the next time proof mode is turned on.');
      engine.addButton(b => b.setButtonText('Remove').onClick(async () => {
        await this.plugin.proof.toggle(false);
        await this.plugin.proof.removeEngine();
        this.display();
      }));
    });

    new Setting(containerEl).setName('WordPress').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description', text:
      'For "Send to WordPress as draft" (command palette, or a note\'s … menu). Create an application password in WordPress under Users → Profile.' });

    new Setting(containerEl)
      .setName('Site URL')
      .addText(t => t.setPlaceholder('https://yoursite.com').setValue(s.wpUrl)
        .onChange(async v => { s.wpUrl = v.trim(); await save(); }));

    new Setting(containerEl)
      .setName('Username')
      .addText(t => t.setValue(s.wpUser)
        .onChange(async v => { s.wpUser = v.trim(); await save(); }));

    const hasPassword = !!this.app.secretStorage.getSecret(WP_SECRET_ID);
    new Setting(containerEl)
      .setName('Application password')
      .setDesc('Kept in your device\'s secure storage, not in your vault, so it doesn\'t sync. Enter it once on each device.')
      .addText(t => {
        t.inputEl.type = 'password';
        t.setPlaceholder(hasPassword ? 'saved' : 'xxxx xxxx xxxx xxxx xxxx xxxx')
          .onChange(v => this.app.secretStorage.setSecret(WP_SECRET_ID, v.trim()));
      });

  }

  // Desktop hands you the file. Obsidian on iPad and iPhone can't, so there it goes into the vault.
  private async exportTheme(key: CustomKey) {
    const theme = this.plugin.settings[key];
    const name = themeFileName(theme, CUSTOM_LABELS[key]);
    if (Platform.isMobile) {
      await this.app.vault.adapter.write(name, themeToFile(theme));
      new Notice('theme exported to your vault: ' + name);
      return;
    }
    const url = URL.createObjectURL(new Blob([themeToFile(theme)], { type: 'application/json' }));
    const a = document.body.createEl('a', { href: url, attr: { download: name } });
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // Packs: what's installed (saved in the vault, so it syncs), what's on the shelf, and importing a file.
  // As in Tree's Packs screen; built-in packs can't be removed.
  private displayPacks(containerEl: HTMLElement, locked: boolean) {
    const store = this.plugin.packs;
    new Setting(containerEl).setName('Packs').setHeading();
    containerEl.createEl('p', { cls: 'setting-item-description',
      text: 'Installed packs are kept in the "' + store.folder + '" folder of your vault, so they sync with your notes. Uninstalling one never touches your writing.' });
    const strip = (row: Setting, colors: string[]) => {
      const el = row.descEl.createDiv({ cls: 'tree-pack-strip' });
      for (const c of colors) el.createSpan().style.backgroundColor = c;
    };
    const after = (msg: string) => { new Notice(msg); this.display(); };

    new Setting(containerEl).setName('Classic, Retro').setDesc('Built in.');
    for (const p of store.installedList()) {
      const row = new Setting(containerEl).setName(p.name + '  ' + p.version).setDesc(p.description);
      strip(row, p.themes.map(t => t.colors.bg));
      const entry = store.shelfEntry(p.id);
      if (entry && TreePacks.newer(p.version, entry.version))
        row.addButton(b => b.setButtonText('Update').setCta().setDisabled(locked).onClick(async () => { b.setDisabled(true); after(await store.installFromShelf(entry, 'updated')); }));
      else
        row.addButton(b => b.setButtonText('Export').onClick(() => store.exportPack(p.id)));
      row.addButton(b => b.setButtonText('Uninstall').setDisabled(locked).onClick(async () => after(await store.uninstall(p.id))));
    }

    if (store.shelfState === 'ok') {
      const missing = (store.shelf ?? []).filter(e => !store.installed[e.id]);
      for (const e of missing) {
        const row = new Setting(containerEl).setName(e.name + '  ' + e.version).setDesc('On the shelf. ' + e.description);
        strip(row, e.swatches);
        row.addButton(b => b.setButtonText('Install').setCta().setDisabled(locked).onClick(async () => { b.setDisabled(true); after(await store.installFromShelf(e, 'installed')); }));
      }
      if (!missing.length) containerEl.createEl('p', { cls: 'setting-item-description', text: 'You have every pack on the shelf.' });
      store.markSeen();
    } else {
      containerEl.createEl('p', { cls: 'setting-item-description', text: store.shelfState === 'offline' ? 'Shelf not reachable.' : 'Checking the shelf…' });
      if (store.shelfState !== 'checking') store.checkShelf(true).then(() => { if (containerEl.isConnected) this.display(); });
    }

    new Setting(containerEl)
      .setName('Import a pack file')
      .setDesc('Installs a .tree-pack.json from your vault or computer.')
      .addButton(b => b.setButtonText('Import').setDisabled(locked).onClick(() => {
        const input = document.body.createEl('input', { type: 'file', attr: { accept: '.json,application/json', style: 'display: none' } });
        input.onchange = async () => {
          const file = input.files?.[0];
          input.remove();
          if (!file) return;
          const r = await store.install(await file.text());
          after(r.ok ? r.pack.name.toLowerCase() + ' installed. it\'s in the pack list.' : 'not installed: ' + r.error);
        };
        input.click();
      }));
  }

  private importTheme(key: CustomKey) {
    const input = document.body.createEl('input', { type: 'file', attr: { accept: '.json,application/json', style: 'display: none' } });
    input.onchange = async () => {
      const file = input.files?.[0];
      input.remove();
      if (!file) return;
      const theme = themeFromFile(await file.text());
      if (!theme) { new Notice('not a theme file.'); return; }
      this.plugin.settings[key] = theme;
      this.plugin.selectTheme('classic', key);
      await this.plugin.saveSettings();
      this.display();
      new Notice('theme imported.');
    };
    input.click();
  }
}
