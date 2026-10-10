// Tree's custom themes: pick bg / text / accent, derive the rest (same math as Tree's applyCustomColors()).
// A custom theme can also have a name and its own cursor: Tree's line, the CRT block or Doogie Journal's underline.
export type CursorStyle = 'line' | 'block' | 'underline';
export const CURSOR_STYLES: CursorStyle[] = ['line', 'block', 'underline'];
export interface CustomColors { bg: string; text: string; accent: string; name?: string; cursor?: CursorStyle; }

export const CUSTOM_KEYS = ['custom', 'custom2', 'custom3'] as const;
export type CustomKey = typeof CUSTOM_KEYS[number];
export const isCustom = (theme: string): theme is CustomKey => (CUSTOM_KEYS as readonly string[]).includes(theme);

// A custom theme as a file. Tree and Ginkgo write and read the same one.
export const themeFileName = (c: CustomColors, fallback: string) =>
  ((c.name || fallback).replace(/[\\/:*?"<>|]/g, '').trim() || fallback) + '.tree-theme.json';

export const themeToFile = (c: CustomColors) =>
  JSON.stringify({ treeTheme: 1, name: c.name ?? '', bg: c.bg, text: c.text, accent: c.accent, cursor: c.cursor ?? 'line' }, null, 2) + '\n';

export function themeFromFile(raw: string): CustomColors | null {
  let t: any = null;
  try { t = JSON.parse(raw); } catch { /* not JSON */ }
  const hex = /^#[0-9a-fA-F]{6}$/;
  if (!t || !hex.test(t.bg) || !hex.test(t.text) || !hex.test(t.accent)) return null;
  return {
    bg: t.bg.toLowerCase(), text: t.text.toLowerCase(), accent: t.accent.toLowerCase(),
    name: typeof t.name === 'string' ? t.name.trim().slice(0, 24) : '',
    cursor: CURSOR_STYLES.includes(t.cursor) ? t.cursor : 'line',
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

export const CUSTOM_VARS = ['--tree-bg', '--tree-surface', '--tree-text', '--tree-accent', '--tree-muted', '--tree-border', '--tree-on-accent', '--tree-selection'];

export function customPalette({ bg, text, accent }: CustomColors): Record<string, string> {
  const [r, g, b] = hexToRgb(accent);
  return {
    '--tree-bg':        bg,
    '--tree-surface':   adjustHex(bg, -10),
    '--tree-text':      text,
    '--tree-accent':    accent,
    '--tree-muted':     blendHex(text, bg, 0.5),
    '--tree-border':    blendHex(text, bg, 0.15),
    '--tree-on-accent': bg,
    '--tree-selection': `rgba(${r},${g},${b},0.25)`,
  };
}
