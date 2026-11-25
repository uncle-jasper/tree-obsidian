// Downpour's falling rain, as in Tree: thin streaks on a canvas behind each open note.
// When the rain stops, drops already falling finish their fall; when it starts again,
// new drops come in from the top. Paused while Obsidian is hidden; still under reduced motion.
import type TreePlugin from './main';
import { lookOf } from './settings';

interface Drop { x: number; y: number; len: number; v: number; a: number; }
interface Pane { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; drops: (Drop | null)[]; w: number; h: number; ro: ResizeObserver; }

const SLANT = 0.12;

export class Rain {
  private panes = new Map<HTMLElement, Pane>();
  private running = false;
  private easing = false;
  private frame = 0;

  constructor(private plugin: TreePlugin) {}

  private get shown() { return lookOf(this.plugin.settings) === 'downpour'; }
  private get falling() { return this.shown && this.plugin.settings.fallingRain; }
  private get reduce() { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; }

  register() {
    this.plugin.registerDomEvent(document, 'visibilitychange', () => this.update());
    this.plugin.register(() => this.clear());
  }

  private drop(p: Pane, anywhere: boolean): Drop {
    const z = Math.random();
    return {
      x: Math.random() * (p.w + 60) - 30,
      y: anywhere ? Math.random() * p.h : -20 - Math.random() * p.h * 0.6,
      len: 14 + z * 22, v: 7 + z * 9, a: 0.05 + z * 0.09,
    };
  }

  private fill(p: Pane, anywhere: boolean) {
    p.drops = [];
    for (let i = 0, n = Math.round((p.w * p.h) / 2600); i < n; i++) p.drops.push(this.drop(p, anywhere));
  }

  private size(p: Pane) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    p.w = p.canvas.clientWidth; p.h = p.canvas.clientHeight;
    p.canvas.width = p.w * dpr; p.canvas.height = p.h * dpr;
    p.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private draw(p: Pane) {
    const ctx = p.ctx;
    ctx.clearRect(0, 0, p.w, p.h);
    ctx.lineWidth = 1; ctx.lineCap = 'round';
    for (const d of p.drops) {
      if (!d) continue;
      ctx.strokeStyle = 'rgba(145,190,195,' + d.a + ')';
      ctx.beginPath();
      ctx.moveTo(d.x, d.y);
      ctx.lineTo(d.x - d.len * SLANT, d.y + d.len);
      ctx.stroke();
    }
  }

  // A canvas at the back of every open note's content, and none anywhere else
  private sync() {
    const hosts = new Set<HTMLElement>();
    if (this.shown) {
      for (const leaf of this.plugin.app.workspace.getLeavesOfType('markdown')) {
        const host = leaf.view.containerEl.querySelector<HTMLElement>(':scope > .view-content');
        if (host) hosts.add(host);
      }
    }
    for (const [host, p] of this.panes) {
      if (!hosts.has(host) || !host.isConnected) { p.ro.disconnect(); p.canvas.remove(); this.panes.delete(host); }
    }
    for (const host of hosts) {
      if (this.panes.has(host)) continue;
      const canvas = host.ownerDocument.createElement('canvas');
      canvas.className = 'tree-rain';
      canvas.setAttribute('aria-hidden', 'true');
      host.prepend(canvas);
      const p: Pane = { canvas, ctx: canvas.getContext('2d')!, drops: [], w: 0, h: 0, ro: null! };
      p.ro = new ResizeObserver(() => {
        this.size(p);
        if (this.falling) this.fill(p, true); else p.drops = [];
        this.draw(p);
        if (this.falling && !this.reduce) this.start();
      });
      p.ro.observe(canvas);
      this.size(p);
      if (this.falling) this.fill(p, true);   // a newly opened note is already in the rain
      this.panes.set(host, p);
    }
  }

  private start() {
    if (this.running || document.hidden) return;
    this.running = true;
    this.frame = window.requestAnimationFrame(this.step);
  }

  private stop() {
    this.running = false;
    window.cancelAnimationFrame(this.frame);
  }

  private step = () => {
    if (!this.running) return;
    let left = 0;
    for (const p of this.panes.values()) {
      for (let i = 0; i < p.drops.length; i++) {
        const d = p.drops[i];
        if (!d) continue;
        d.y += d.v; d.x -= d.v * SLANT;
        if (d.y > p.h + 20) p.drops[i] = this.easing ? null : this.drop(p, false);
        if (p.drops[i]) left++;
      }
      this.draw(p);
    }
    if (this.easing && !left) { this.stop(); for (const p of this.panes.values()) p.drops = []; return; }
    this.frame = window.requestAnimationFrame(this.step);
  };

  // Called whenever settings or the layout change
  update() {
    this.sync();
    document.body.toggleClass('tree-rain-on', this.panes.size > 0);
    if (!this.shown) { this.stop(); return; }
    if (document.hidden) { this.stop(); return; }

    if (this.reduce) {
      this.stop();
      for (const p of this.panes.values()) { if (this.falling) this.fill(p, true); else p.drops = []; this.draw(p); }
      return;
    }
    if (this.falling) {
      const wasEasing = this.easing;
      this.easing = false;
      for (const p of this.panes.values()) {
        if (!p.drops.some(Boolean)) this.fill(p, !wasEasing && !this.running);   // starting up again: from the top
        else p.drops = p.drops.map(d => d || this.drop(p, false));
      }
    } else {
      this.easing = true;
    }
    if ([...this.panes.values()].some(p => p.drops.some(Boolean))) this.start();
  }

  private clear() {
    this.stop();
    for (const p of this.panes.values()) { p.ro.disconnect(); p.canvas.remove(); }
    this.panes.clear();
    document.body.removeClass('tree-rain-on');
  }
}
