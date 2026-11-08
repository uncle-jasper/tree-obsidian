// Tree's custom themes: pick bg / text / accent, derive the rest (same math as Tree's applyCustomColors()).
// A custom theme can also have a name and its own cursor: Tree's line, the CRT block or Doogie Journal's underline.
export type CursorStyle = 'line' | 'block' | 'underline';
export const CURSOR_STYLES: CursorStyle[] = ['line', 'block', 'underline'];
// readable: whether colors too faint to see are shown adjusted (true) or exactly as picked (false). Unset until asked.
export interface CustomColors { bg: string; text: string; accent: string; name?: string; cursor?: CursorStyle; readable?: boolean; }

export const CUSTOM_KEYS = ['custom', 'custom2', 'custom3'] as const;
export type CustomKey = typeof CUSTOM_KEYS[number];
export const isCustom = (theme: string): theme is CustomKey => (CUSTOM_KEYS as readonly string[]).includes(theme);

// A custom theme as a file. Tree and Ginkgo write and read the same one.
export const themeFileName = (c: CustomColors, fallback: string) =>
  ((c.name || fallback).replace(/[\\/:*?"<>|]/g, '').trim() || fallback) + '.tree-theme.json';

export const themeToFile = (c: CustomColors) =>
  JSON.stringify({ treeTheme: 1, name: c.name ?? '', bg: c.bg, text: c.text, accent: c.accent, cursor: c.cursor ?? 'line',
    ...(typeof c.readable === 'boolean' ? { readable: c.readable } : {}) }, null, 2) + '\n';

export function themeFromFile(raw: string): CustomColors | null {
  let t: any = null;
  try { t = JSON.parse(raw); } catch { /* not JSON */ }
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!t || !hex.test(t.bg) || !hex.test(t.text) || !hex.test(t.accent)) return null;
  return {
    bg: t.bg.toLowerCase(), text: t.text.toLowerCase(), accent: t.accent.toLowerCase(),
    name: typeof t.name === 'string' ? t.name.trim().slice(0, 24) : '',
    cursor: CURSOR_STYLES.includes(t.cursor) ? t.cursor : 'line',
    ...(typeof t.readable === 'boolean' ? { readable: t.readable } : {}),
  };
}

const hexToRgb = (h: string) => { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const rgbToHex = (r: number, g: number, b: number) =>
  '#' + [r, g, b].map(v => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
const adjustHex = (h: string, a: number) => { const [r, g, b] = hexToRgb(h); return rgbToHex(r + a, g + a, b + a); };
const blendHex = (f: string, b: string, t: number) => {
  const [r1, g1, b1] = hexToRgb(f), [r2, g2, b2] = hexToRgb(b);
  return rgbToHex(r1 * t + r2 * (1 - t), g1 * t + g2 * (1 - t), b1 * t + b2 * (1 - t));
};

// How much one color stands out from another: WCAG's contrast ratio, 1 (the same) to 21 (black on white).
const luminance = (rgb: number[]) => {
  const [r, g, b] = rgb.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: number[], b: number[]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

// The block cursor is the accent at 40% over the background. A muted accent leaves that nearly invisible, so the tint
// goes up, a point at a time, until the block stands out from the background as it does in a theme that reads well
// (BLOCK_SEEN). The block is drawn over the letter, which tints the letter too, and at 100% hides it. So the tint
// stops early if the letter would get hard to read through it (LETTER_READABLE).
const BLOCK_BASE = 40, BLOCK_SEEN = 2.05, LETTER_READABLE = 1.85;
export function blockStrength({ bg, text, accent }: CustomColors): number {
  const b = hexToRgb(bg), t = hexToRgb(text), a = hexToRgb(accent);
  const under = (c: number[], pct: number) => a.map((v, i) => v * pct / 100 + c[i] * (1 - pct / 100));   // c seen through the block
  let pct = BLOCK_BASE;
  while (pct < 100 && contrast(under(b, pct), b) < BLOCK_SEEN && contrast(under(t, pct + 1), under(b, pct + 1)) >= LETTER_READABLE) pct++;
  return pct;
}

// An accent close to the background can't be seen. A custom theme's cursor and links (also tags and the selection)
// fall back on the accent nudged toward white or black (whichever pulls away from the background faster), just until
// it stands out: CURSOR_SEEN is WCAG's 3:1 for things that aren't text, LINK_READABLE its 4.5:1 for text. Accents that
// already stand out are left as they are, so the hue holds. Tree and Ginkgo do the same.
const CURSOR_SEEN = 3, LINK_READABLE = 4.5;
function readableAgainst(bg: string, color: string, target: number): string {
  const b = hexToRgb(bg), a = hexToRgb(color);
  if (contrast(a, b) >= target) return color;
  const toward = (end: number[], pct: number) => a.map((v, i) => v + (end[i] - v) * pct / 100);
  let best: { end: number[]; pct: number } | null = null;
  for (const end of [[255, 255, 255], [0, 0, 0]]) {
    for (let pct = 1; pct <= 100; pct++) {
      if (contrast(toward(end, pct), b) >= target) { if (!best || pct < best.pct) best = { end, pct }; break; }
    }
  }
  if (!best) best = { end: luminance(b) > 0.18 ? [0, 0, 0] : [255, 255, 255], pct: 100 };
  const [r, g, bl] = toward(best.end, best.pct);
  return rgbToHex(r, g, bl);
}
export const cursorColor = (bg: string, accent: string) => readableAgainst(bg, accent, CURSOR_SEEN);
export const linkColor   = (bg: string, accent: string) => readableAgainst(bg, accent, LINK_READABLE);

// Readable colors: a theme whose accent is too faint to read as a link (under LINK_READABLE) asks once whether to adjust
// it. The colors picked are always what's saved; adjusting is only in what's shown, so it can be switched off again.
// On: links and the cursor use the nudged colors above, and an accent under ACCENT_SEEN is shown as the link color.
// Off: the accent, links and cursor are exactly the accent. Tree and Ginkgo do the same.
const ACCENT_SEEN = 3;
export const needsReadable = ({ bg, accent }: CustomColors) => contrast(hexToRgb(accent), hexToRgb(bg)) < LINK_READABLE;
export function shownColors(c: CustomColors): { accent: string; cursor: string; link: string } {
  if (c.readable === false) return { accent: c.accent, cursor: c.accent, link: c.accent };
  const link = linkColor(c.bg, c.accent);
  const accent = c.readable && contrast(hexToRgb(c.accent), hexToRgb(c.bg)) < ACCENT_SEEN ? link : c.accent;
  return { accent, cursor: cursorColor(c.bg, c.accent), link };
}

export const CUSTOM_VARS = ['--tree-bg', '--tree-surface', '--tree-text', '--tree-accent', '--tree-muted', '--tree-border', '--tree-on-accent', '--tree-selection', '--tree-cursor', '--tree-link', '--tree-block-strength'];

export function customPalette(colors: CustomColors): Record<string, string> {
  const { bg, text } = colors;
  const { accent, cursor, link } = shownColors(colors);
  const [r, g, b] = hexToRgb(link);
  return {
    '--tree-bg':        bg,
    '--tree-surface':   adjustHex(bg, -10),
    '--tree-text':      text,
    '--tree-accent':    accent,
    '--tree-muted':     blendHex(text, bg, 0.5),
    '--tree-border':    blendHex(text, bg, 0.15),
    '--tree-on-accent': bg,
    '--tree-selection': `rgba(${r},${g},${b},0.25)`,
    '--tree-cursor':    cursor,
    '--tree-link':      link,
    '--tree-block-strength': blockStrength({ ...colors, accent: cursor }) + '%',
  };
}
