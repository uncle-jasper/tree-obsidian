// Tree's Easter eggs. The only way into amber CRT and Doogie Journal, which no menu offers.
import { MarkdownView } from 'obsidian';
import type TreePlugin from './main';

const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
const DOOGIE = ['a', 'b', 'a', 'c', 'a', 'b', 'b'];

const GREEN = ['terminal', 'terminal-crt'];
const CRT   = ['terminal-crt', 'amber-crt', 'doogie-journal'];   // themes with the CRT look

export class Eggs {
  private konamiPos = 0;
  private doogiePos = 0;

  constructor(private plugin: TreePlugin) {}

  private get theme() { return this.plugin.settings.theme; }

  private async switchTo(theme: string, msg: string) {
    const s = this.plugin.settings;
    if (GREEN.includes(s.theme)) s.secretReturn = s.theme;   // remember which green to go back to
    s.theme = theme;
    await this.plugin.saveSettings();
    this.plugin.status.typeMessage(msg);
  }

  private editor() {
    const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
    return view && view.editor.hasFocus() ? view.editor : null;
  }

  // Konami code: amber CRT. Needs the CRT look on (terminal crt, or Doogie). Stricter than Tree,
  // where plain terminal is enough: in the plugin, amber is deliberately unlocked only from CRT.
  private konami(e: KeyboardEvent) {
    if (e.key !== KONAMI[this.konamiPos]) { this.konamiPos = e.key === KONAMI[0] ? 1 : 0; return; }
    if (++this.konamiPos < KONAMI.length) return;
    this.konamiPos = 0;
    if (!CRT.includes(this.theme)) return;

    // Erase the 'ba' that was typed into the note during the sequence
    const ed = this.editor();
    if (ed) {
      const cur = ed.getCursor();
      if (cur.ch >= 2 && ed.getRange({ line: cur.line, ch: cur.ch - 2 }, cur) === 'ba') ed.replaceRange('', { line: cur.line, ch: cur.ch - 2 }, cur);
    }
    if (this.theme === 'amber-crt') void this.switchTo(this.plugin.settings.secretReturn || 'terminal-crt', 'back to green.');
    else void this.switchTo('amber-crt', 'amber mode. you found it.');
  }

  // ABACABB: Doogie Journal. Typed on its own line, only with the CRT look on (terminal crt, or amber).
  private abacabb(e: KeyboardEvent) {
    if (!CRT.includes(this.theme)) { this.doogiePos = 0; return; }
    if (e.key.length !== 1) return;
    const key = e.key.toLowerCase();
    const ed = this.editor();
    const onBlankLine = !!ed && ed.getLine(ed.getCursor().line).trim().length <= DOOGIE.length;
    if (!onBlankLine || key !== DOOGIE[this.doogiePos]) { this.doogiePos = key === DOOGIE[0] ? 1 : 0; return; }
    if (++this.doogiePos < DOOGIE.length) return;
    this.doogiePos = 0;

    const line = ed!.getCursor().line;
    if (ed!.getLine(line).trim().toLowerCase() === 'abacabb') ed!.setLine(line, '');
    if (this.theme === 'doogie-journal') void this.switchTo(this.plugin.settings.secretReturn || 'terminal-crt', 'back to green.');
    else void this.switchTo('doogie-journal', 'Doogie Journal Unlocked!');
  }

  register() {
    this.plugin.registerDomEvent(document, 'keyup', (e: KeyboardEvent) => {
      this.konami(e);
      this.abacabb(e);
    });
  }
}
