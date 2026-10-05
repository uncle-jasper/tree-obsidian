// Tree's "↑ wp": send the note to WordPress as a draft, through the WordPress REST API with an
// application password. The body is rendered by Obsidian itself, so it matches Reading view:
// %% comments, properties and vault-only things (note links, embeds) stay behind.
import { App, Component, MarkdownRenderer, MarkdownView, Modal, Notice, Setting, TFile, requestUrl } from 'obsidian';
import type TreePlugin from './main';

export const WP_SECRET_ID = 'tree-wordpress-password';

// Title: the note's opening "# Heading" if it starts with one (as in Tree), otherwise its file name
export function splitTitle(markdown: string, fallback: string) {
  const lines = markdown.split('\n');
  const first = lines.findIndex(l => l.trim() !== '');
  const h1 = first >= 0 ? lines[first].match(/^# (.+)$/) : null;
  if (h1) return { title: h1[1].trim(), body: lines.slice(first + 1).join('\n').trim() };
  return { title: fallback, body: markdown.trim() };
}

// Basic auth header that survives non-ASCII usernames/passwords (btoa alone doesn't)
export function basicAuth(user: string, pass: string) {
  const bytes = new TextEncoder().encode(user + ':' + pass);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return 'Basic ' + btoa(bin);
}

// Tidy Obsidian's rendered HTML into plain post HTML
function cleanForWordPress(root: HTMLElement) {
  // Links to other notes would be broken on the blog: keep their text
  root.querySelectorAll('a.internal-link').forEach(a => a.replaceWith(document.createTextNode(a.textContent ?? '')));
  // Vault embeds and local images can't be reached from WordPress; UI bits aren't content
  root.querySelectorAll('.internal-embed, .frontmatter, .frontmatter-container, button, svg, input, .collapse-indicator, .heading-collapse-indicator, .list-collapse-indicator')
    .forEach(el => el.remove());
  root.querySelectorAll('img').forEach(img => { if (!/^https?:/.test(img.getAttribute('src') ?? '')) img.remove(); });
  // Drop Obsidian's classes and data attributes; keep only what a post needs
  const keep = new Set(['href', 'src', 'alt', 'title', 'colspan', 'rowspan', 'start', 'id']);
  root.querySelectorAll('*').forEach(el => {
    for (const attr of Array.from(el.attributes)) if (!keep.has(attr.name)) el.removeAttribute(attr.name);
  });
}

class ConfirmModal extends Modal {
  constructor(app: App, private title: string, private onYes: () => void) { super(app); }
  onOpen() {
    this.contentEl.addClass('tree-wp-confirm');
    this.contentEl.createEl('p', { text: `send "${this.title}" to wordpress as a draft?` });
    new Setting(this.contentEl)
      .addButton(b => b.setButtonText('cancel').onClick(() => this.close()))
      .addButton(b => b.setButtonText('send').setCta().onClick(() => { this.close(); this.onYes(); }));
  }
  onClose() { this.contentEl.empty(); }
}

export class WordPress {
  private sending = false;

  constructor(private plugin: TreePlugin) {}

  private get app() { return this.plugin.app; }

  // Messages go in Tree's status line like Tree; if it isn't showing, an Obsidian notice instead
  private say(msg: string) {
    if (this.plugin.status.el.isConnected) this.plugin.status.typeMessage(msg, true);
    else new Notice(msg);
  }

  register() {
    this.plugin.addCommand({
      id: 'send-to-wordpress',
      name: 'Send to WordPress as draft',
      checkCallback: checking => {
        const file = this.app.workspace.getActiveViewOfType(MarkdownView)?.file;
        if (!file) return false;
        if (!checking) void this.confirm(file);
        return true;
      },
    });
    // The note's … menu and the file list's right-click menu
    this.plugin.registerEvent(this.app.workspace.on('file-menu', (menu, file) => {
      if (!(file instanceof TFile) || file.extension !== 'md') return;
      menu.addItem(item => item.setTitle('Send to WordPress as draft').setIcon('send').onClick(() => this.confirm(file)));
    }));
  }

  async confirm(file: TFile) {
    const s = this.plugin.settings;
    const password = this.app.secretStorage.getSecret(WP_SECRET_ID);
    if (!s.wpUrl || !s.wpUser || !password) {
      this.say('add your wordpress credentials in settings first.');
      const setting = (this.app as any).setting;
      setting?.open?.();
      setting?.openTabById?.(this.plugin.manifest.id);
      return;
    }
    const { title, body } = await this.read(file);
    if (!body && !title) { this.say('nothing to send.'); return; }
    new ConfirmModal(this.app, title, () => void this.send(file)).open();
  }

  private async read(file: TFile) {
    let text = await this.app.vault.cachedRead(file);
    // Properties never go to the blog
    const end = this.app.metadataCache.getFileCache(file)?.frontmatterPosition?.end.offset;
    if (end !== undefined) text = text.slice(end);
    // Old Tree notes (%{ }) are stripped too, as Tree did
    text = text.replace(/%\{[^}]*\}/g, '');
    return splitTitle(text, file.basename);
  }

  private async send(file: TFile) {
    if (this.sending) return;
    this.sending = true;
    const s = this.plugin.settings;
    const url = s.wpUrl.trim().replace(/\/+$/, '');
    const password = this.app.secretStorage.getSecret(WP_SECRET_ID) ?? '';
    const component = new Component();
    try {
      const { title, body } = await this.read(file);
      const el = createDiv();
      component.load();
      await MarkdownRenderer.render(this.app, body, el, file.path, component);
      cleanForWordPress(el);
      // As Tree does: repeat the title as an <h3> at the top of the body. The blog's theme shows
      // only the date on a post page, so without this the post has no visible title.
      el.prepend(createEl('h3', { text: title }));

      this.say('sending to wordpress…');
      const res = await requestUrl({
        url: url + '/wp-json/wp/v2/posts',
        method: 'POST',
        headers: { Authorization: basicAuth(s.wpUser.trim(), password), 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content: el.innerHTML, status: 'draft' }),
        throw: false,
      });
      if (res.status >= 200 && res.status < 300) this.say('draft sent to wordpress ✓');
      else {
        let message = 'error ' + res.status;
        try { message = res.json?.message || message; } catch { /* not JSON */ }
        this.say('wordpress: ' + message);
      }
    } catch {
      this.say('could not reach wordpress. check the site url.');
    } finally {
      component.unload();
      this.sending = false;
    }
  }
}
