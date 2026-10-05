import { App, PluginSettingTab, Setting } from 'obsidian';
import type TreePlugin from './main';
import type { CustomColors } from './custom';

export interface TreeSettings {
  theme: string;        // '' = leave Obsidian's theme alone
  font: string;         // '' = Obsidian's text font
  fontSize: number;     // 0  = Obsidian's size
  statusLine: boolean;
  statusMessages: boolean;
  showChars: boolean;
  showReadTime: boolean;
  showCursor: boolean;
  lineLength: number;   // characters per line
  zen: boolean;
  zenGranularity: 'sentence' | 'paragraph';
  typewriter: boolean;
  tabOut: boolean;
  custom: CustomColors;
  custom2: CustomColors;
}

export const DEFAULT_SETTINGS: TreeSettings = {
  theme: 'parchment',
  font: '',
  fontSize: 0,
  statusLine: true,
  statusMessages: true,
  showChars: true,
  showReadTime: true,
  showCursor: true,
  lineLength: 68,       // Tree's measure (max-width: 68ch)
  zen: false,
  zenGranularity: 'sentence',
  typewriter: false,
  tabOut: true,
  custom:  { bg: '#f5f0e8', text: '#2c2416', accent: '#8b6e4e' },   // Tree's defaults
  custom2: { bg: '#f5f0e8', text: '#2c2416', accent: '#8b6e4e' },
};

export const THEMES: Record<string, string> = {
  '':                'none (use Obsidian theme)',
  parchment:         'parchment',
  dark:              'dark',
  moss:              'moss',
  slate:             'slate',
  paper:             'paper',
  sage:              'sage',
  ash:               'ash',
  gameboy:           'game boy',
  moonwalker:        'moonwalker',
  terminal:          'terminal',
  'terminal-crt':    'terminal crt',
  'amber-crt':       'amber crt',
  'doogie-journal':  'doogie journal',
  custom:            'custom',
  custom2:           'custom 2',
};

export const FONTS: Record<string, string> = {
  '':                                     'Obsidian default',
  "'Tree iAWriterMonoS', monospace":      'iA Writer Mono',
  "'Tree iAWriterDuoS', monospace":       'iA Writer Duo',
  "'Tree iAWriterQuattroS', monospace":   'iA Writer Quattro',
  "'Tree JetBrains Mono', monospace":     'JetBrains Mono',
  "'Tree Inconsolata', monospace":        'Inconsolata',
  "'Tree Geist Mono', monospace":         'Geist Mono',
  "'Tree Geist Sans', sans-serif":        'Geist Sans',
  "'Tree PerfectDOS437', monospace":      'Perfect DOS VGA 437',
  "'Tree PrintChar21', monospace":        'Print Char 21',
};

export const SIZES = [0, 16, 18, 20, 22, 24, 26];

export class TreeSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: TreePlugin) {
    super(app, plugin);
  }

  display() {
    const { containerEl } = this;
    const s = this.plugin.settings;
    const save = async () => { await this.plugin.saveSettings(); };
    containerEl.empty();

    new Setting(containerEl).setName('Appearance').setHeading();

    new Setting(containerEl)
      .setName('Theme')
      .setDesc('Tree palette. Works best with Obsidian\'s default theme underneath.')
      .addDropdown(d => d.addOptions(THEMES).setValue(s.theme)
        .onChange(async v => { s.theme = v; await save(); }));

    new Setting(containerEl)
      .setName('Font')
      .setDesc('Editor and reading view only. Fonts are built in, so they work on iPad too.')
      .addDropdown(d => d.addOptions(FONTS).setValue(s.font)
        .onChange(async v => { s.font = v; await save(); }));

    new Setting(containerEl)
      .setName('Font size')
      .addDropdown(d => {
        SIZES.forEach(n => d.addOption(String(n), n ? n + 'px' : 'Obsidian default'));
        d.setValue(String(s.fontSize)).onChange(async v => { s.fontSize = Number(v); await save(); });
      });

    for (const [key, name] of [['custom', 'Custom'], ['custom2', 'Custom 2']] as const) {
      new Setting(containerEl).setName(name + ' theme').setHeading();
      const colors = s[key];
      for (const [part, label] of [['bg', 'Background'], ['text', 'Text'], ['accent', 'Accent']] as const) {
        new Setting(containerEl)
          .setName(label)
          .setDesc(part === 'bg' ? 'Surfaces, borders and muted text are worked out from these three, as in Tree.' : '')
          .addColorPicker(c => c.setValue(colors[part]).onChange(async v => {
            colors[part] = v;
            if (s.theme !== key) { s.theme = key; this.display(); }   // picking a color switches to that theme
            await save();
          }));
      }
    }

    new Setting(containerEl).setName('Status line').setHeading();

    new Setting(containerEl)
      .setName('Show status line')
      .setDesc('Tree\'s status line at the bottom of each note. Also shows on iPad.')
      .addToggle(t => t.setValue(s.statusLine)
        .onChange(async v => { s.statusLine = v; await save(); }));

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

    new Setting(containerEl).setName('Writing').setHeading();

    new Setting(containerEl)
      .setName('Zen mode')
      .setDesc('Fades everything except what you\'re writing, as in Tree. Also in the Aa panel and the "Tree: Toggle zen mode" command.')
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
      .setDesc('With the cursor just before closing **, *, *** or ~~, Tab jumps past them, as in Tree. Everywhere else Tab works as usual.')
      .addToggle(t => t.setValue(s.tabOut)
        .onChange(async v => { s.tabOut = v; await save(); }));

    new Setting(containerEl).setName('Writing column').setHeading();

    new Setting(containerEl)
      .setName('Line length')
      .setDesc('Characters per line. Tree uses 68, inside the 60–75 range typographers recommend for comfortable reading. '
        + 'Applies when Obsidian\'s "Readable line length" is on, and always in focus mode.')
      .addSlider(sl => sl.setLimits(50, 90, 1).setValue(s.lineLength).setDynamicTooltip()
        .onChange(async v => { s.lineLength = v; await save(); }))
      .addExtraButton(b => b.setIcon('rotate-ccw').setTooltip('Back to 68')
        .onClick(async () => { s.lineLength = 68; await save(); this.display(); }));

    new Setting(containerEl)
      .setName('Focus mode')
      .setDesc('Toggle with the ribbon icon or the "Tree: Toggle focus mode" command. Escape or the corner mark leaves it. '
        + 'The Aa at the end of the status line changes theme, font and size without opening settings.');
  }
}
