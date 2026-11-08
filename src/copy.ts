// Copy clean Markdown: the note as you'd paste it into a newsletter or blog tool, without its properties
// and without %% comments %% or <!-- comments -->. Everything else is left exactly as written.
import { MarkdownView, Notice, TFile } from 'obsidian';
import type TreePlugin from './main';
import { noteBody } from './status';

export function cleanMarkdown(text: string) {
  return noteBody(text).body
    .replace(/%%[\s\S]*?(?:%%|$)/g, '')
    .replace(/<!--[\s\S]*?(?:-->|$)/g, '')
    .replace(/[ \t]+$/gm, m => (m.length >= 2 ? m : ''))   // keeps Markdown's two-space line breaks
    .replace(/\n{3,}/g, '\n\n')
    .trim() + '\n';
}

export class CopyClean {
  constructor(private plugin: TreePlugin) {}

  register() {
    this.plugin.addCommand({
      id: 'copy-clean-markdown',
      name: 'Copy clean Markdown (no properties or comments)',
      checkCallback: checking => {
        const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) return false;
        if (!checking) void this.copy(view.editor.getValue());
        return true;
      },
    });
    this.plugin.registerEvent(this.plugin.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(item => item.setTitle('Copy clean Markdown').setIcon('clipboard-copy')
        .onClick(async () => this.copy(await this.plugin.app.vault.read(file))));
    }));
  }

  private async copy(text: string) {
    await navigator.clipboard.writeText(cleanMarkdown(text));
    // The status line says it when it's there; from a file menu it may not be
    if (this.plugin.status.el.isConnected && this.plugin.settings.statusMessages) this.plugin.status.typeMessage('clean markdown copied.');
    else new Notice('clean markdown copied.');
  }
}
