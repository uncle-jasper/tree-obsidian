// Installed theme packs, kept as files in the vault ("Tree packs/<id>.tree-pack.json") so they sync
// to the iPad with the notes, and the shelf they come from. As Tree's Packs screen (PACKS-PLAN.md).
// A pack file is data only; packs.js checks every one before it's used.
import { Notice, Platform, normalizePath, requestUrl, TAbstractFile } from 'obsidian';
import type TreePlugin from './main';
import TreePacks, { Pack } from './packs';

export const SHELF_URL = 'https://uncle-jasper.github.io/tree-packs/';

export interface ShelfEntry { id: string; name: string; version: string; file: string; description: string; swatches: string[]; }

const ID = /^[a-z0-9][a-z0-9-]{0,30}[a-z0-9]$/;
const HEX = /^#[0-9a-f]{6}$/i;

export class PackStore {
  readonly folder = 'Tree packs';
  installed: Record<string, Pack> = {};
  shelf: ShelfEntry[] | null = null;
  shelfState: 'unchecked' | 'checking' | 'ok' | 'offline' = 'unchecked';
  private shelfRequest: Promise<void> | null = null;
  private reloadTimer = 0;

  constructor(private plugin: TreePlugin) {}

  private get adapter() { return this.plugin.app.vault.adapter; }
  private path(id: string) { return normalizePath(this.folder + '/' + id + '.tree-pack.json'); }

  all(): Pack[] { return [...TreePacks.BUILTIN, ...this.installedList()]; }
  installedList(): Pack[] { return Object.values(this.installed).sort((a, b) => a.name.localeCompare(b.name)); }
  find(id: string): Pack | null { return this.all().find(p => p.id === id) ?? null; }

  // Read every pack file in the folder. A file that fails the checks is skipped.
  async load() {
    const found: Record<string, Pack> = {};
    try {
      if (await this.adapter.exists(this.folder)) {
        for (const f of (await this.adapter.list(this.folder)).files) {
          if (!f.endsWith('.tree-pack.json')) continue;
          const r = TreePacks.check(await this.adapter.read(f));
          if (r.ok && !TreePacks.BUILTIN.some(b => b.id === r.pack.id)) found[r.pack.id] = r.pack;
        }
      }
    } catch (e) { console.warn('Tree: could not read packs', e); }
    this.installed = found;
  }

  // Packs arriving by sync (or removed on another device) show up without a restart
  watch() {
    const mine = (f: TAbstractFile | string) => normalizePath(typeof f === 'string' ? f : f.path).startsWith(this.folder + '/');
    const later = () => {
      window.clearTimeout(this.reloadTimer);
      this.reloadTimer = window.setTimeout(async () => { await this.load(); this.plugin.applyAppearance(); }, 500);
    };
    const vault = this.plugin.app.vault;
    for (const ev of ['create', 'modify', 'delete'] as const)
      this.plugin.registerEvent(vault.on(ev as 'create', f => { if (mine(f)) later(); }));
    this.plugin.registerEvent(vault.on('rename', (f, old) => { if (mine(f) || mine(old)) later(); }));
  }

  async install(raw: unknown): Promise<{ ok: true; pack: Pack } | { ok: false; error: string }> {
    const r = TreePacks.check(raw);
    if (!r.ok) return r;
    if (TreePacks.BUILTIN.some(b => b.id === r.pack.id)) return { ok: false, error: 'That pack is built into Tree already.' };
    if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
    await this.adapter.write(this.path(r.pack.id), JSON.stringify(r.pack, null, 2) + '\n');
    this.installed[r.pack.id] = r.pack;
    this.refreshCurrent(r.pack.id);
    return r;
  }

  // Remove the pack and everything remembered about it. The pack in use falls back to Classic's dark.
  async uninstall(id: string): Promise<string> {
    const s = this.plugin.settings;
    const name = (this.installed[id]?.name ?? id).toLowerCase();
    if (await this.adapter.exists(this.path(id))) await this.adapter.remove(this.path(id));
    delete this.installed[id];
    delete s.packLast[id];
    for (const key of Object.keys(s.packSwitches)) if (key.startsWith(id + '/')) delete s.packSwitches[key];
    let msg = name + ' uninstalled.';
    if (s.pack === id) { this.plugin.selectTheme('classic', 'dark'); msg = name + ' uninstalled. switched to dark.'; }
    await this.plugin.saveSettings();
    return msg;
  }

  // After an install or update, the pack in use is shown again in case its themes changed
  private refreshCurrent(id: string) {
    const s = this.plugin.settings;
    if (s.pack !== id) return;
    const pack = this.installed[id];
    this.plugin.selectTheme(id, TreePacks.findTheme(pack, s.theme)?.id ?? TreePacks.openingTheme(pack, s.packLast).id);
  }

  async exportPack(id: string) {
    const p = this.installed[id];
    if (!p) return;
    const name = id + '.tree-pack.json', text = JSON.stringify(p, null, 2) + '\n';
    // Obsidian on iPad can't download: the file goes to the vault root
    if (Platform.isMobile) { await this.adapter.write(name, text); new Notice('pack exported to your vault: ' + name); return; }
    const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    const a = document.body.createEl('a', { href: url, attr: { download: name } });
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ── The shelf ──
  checkShelf(force = false): Promise<void> {
    if (this.shelfRequest && !force) return this.shelfRequest;
    this.shelfState = 'checking';
    this.shelfRequest = requestUrl({ url: SHELF_URL + 'index.json', throw: false }).then(res => {
      const idx = res.status === 200 ? res.json : null;
      if (!idx || idx.treePacks !== 1 || !Array.isArray(idx.packs)) throw new Error('shelf');
      const text = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '');
      this.shelf = idx.packs
        .filter((e: any) => e && ID.test(e.id) && typeof e.file === 'string' && /^packs\/[a-z0-9-]+\.tree-pack\.json$/.test(e.file))
        .map((e: any): ShelfEntry => ({ id: e.id, file: e.file, name: text(e.name, 24) || e.id, version: text(e.version, 20),
          description: text(e.description, 120), swatches: (Array.isArray(e.swatches) ? e.swatches : []).filter((c: unknown) => typeof c === 'string' && HEX.test(c)).slice(0, 8) }));
      this.shelfState = 'ok';
    }).catch(() => { this.shelfState = 'offline'; this.shelfRequest = null; });
    return this.shelfRequest;
  }
  shelfEntry(id: string) { return (this.shelf ?? []).find(e => e.id === id) ?? null; }

  async installFromShelf(entry: ShelfEntry, done: 'installed' | 'updated'): Promise<string> {
    try {
      const res = await requestUrl({ url: SHELF_URL + entry.file, throw: false });
      if (res.status !== 200) throw new Error(String(res.status));
      const r = await this.install(res.text);
      if (!r.ok) return entry.id + ': ' + r.error;
      await this.plugin.saveSettings();
      return r.pack.name.toLowerCase() + ' ' + done + '.';
    } catch (e) {
      return "couldn't reach the shelf. try again later.";
    }
  }

  // Shelf packs not installed and not yet seen in settings, plus updates
  news(): number {
    const seen = this.plugin.settings.packSeen;
    return (this.shelf ?? []).filter(e => {
      const mine = this.installed[e.id];
      return mine ? TreePacks.newer(mine.version, e.version) : seen[e.id] !== e.version;
    }).length;
  }
  markSeen() {
    const seen = this.plugin.settings.packSeen;
    let changed = false;
    for (const e of this.shelf ?? []) if (!this.installed[e.id] && seen[e.id] !== e.version) { seen[e.id] = e.version; changed = true; }
    if (changed) void this.plugin.saveData(this.plugin.settings);
  }
}
