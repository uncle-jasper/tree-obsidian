// Types for packs.js, the theme-pack engine shared with Tree and Ginkgo.
// packs.js is a copy of ../tree/packs.js, byte for byte (scripts/check-engine.cjs).
export interface PackColors { bg: string; surface: string; text: string; accent: string; muted: string; border: string; selection?: string; }
export interface PackEffect { type: string; switch?: string; on?: boolean; className?: string; [k: string]: unknown; }
export interface PackTheme {
  id: string; name: string; light: boolean; colors: PackColors; effects: PackEffect[];
  native?: { theme: string; classes: string[] }; custom?: boolean; remembered?: boolean;
}
export interface Pack { treePack: number; id: string; name: string; version: string; description: string; everyday: string; themes: PackTheme[]; builtin?: boolean; }
export interface Remembered { pack: string; theme: string; name: string; light: boolean; colors: PackColors; }
export type Choices = Record<string, boolean>;
export interface Stage { apply(theme: PackTheme, choices?: Choices): void; clear(): void; destroy(): void; readonly theme: PackTheme | null; }
export interface StageOptions {
  root?: HTMLElement; layers?: HTMLElement; selectors?: Partial<Record<'text' | 'links' | 'cursor' | 'headings', string>>;
  themeAttr?: string | false; packTheme?: string; backdropClass?: string;
  parts?: ('colors' | 'css' | 'layers')[]; varPrefix?: string; contained?: boolean;
}
declare const TreePacks: {
  FORMAT: number;
  check(input: unknown): { ok: true; pack: Pack } | { ok: false; error: string };
  newer(a: string, b: string): boolean;
  BUILTIN: Pack[];
  fromLegacy(s: unknown): { pack: string; theme: string; switches: Choices };
  findTheme(pack: Pack | null, id: string): PackTheme | null;
  openingTheme(pack: Pack, lastUsed: Record<string, string>): PackTheme;
  stepTheme(pack: Pack, id: string, dir: number): PackTheme;
  switchesOf(theme: PackTheme | null): { label: string; on: boolean }[];
  activeEffects(theme: PackTheme | null, choices?: Choices): PackEffect[];
  remember(pack: Pack, theme: PackTheme): Remembered;
  fromMemory(m: unknown): PackTheme | null;
  cssVars(theme: PackTheme): Record<string, string>;
  luminance(hex: string): number;
  createStage(opts?: StageOptions): Stage;
};
export default TreePacks;
