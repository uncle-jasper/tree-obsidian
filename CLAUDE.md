# Tree for Obsidian: notes for Claude

An Obsidian plugin (id `tree-writer`) that brings the writing feel of Tree, a single-file CodeMirror 6 markdown editor PWA, into Obsidian. Tree's source is the sibling folder `../tree/` (`index.html`). That is the live app: never put plugin files in that repo. Port from it by reading, not by importing.

## Principles

- Only build what Obsidian, macOS and iPadOS don't already do. When porting, list every Tree feature you're leaving out, with a reason, and let Dan decide. Never drop one silently.
- Match Tree's behavior and wording. Status messages are Tree's exact lowercase lines.
- It must work on iPad. Obsidian has no status bar there, which is why the status line is our own element.
- Dan has strong aesthetic instincts. Treat "this feels crowded or off" as a requirement.
- Dan writes in Live Preview, never Source mode.

## Layout

- `src/main.ts`: plugin wiring, settings apply, focus mode, word goal, ⋯ peek.
- `src/settings.ts`: settings, theme, font and size lists, settings tab.
- `src/status.ts`: status line, typed messages, milestones, idle, goal display.
- `src/quick.ts`: the Aa panel.
- `src/editor.ts`: zen, typewriter, Tab-out (CodeMirror extensions).
- `src/justwrite.ts`, `src/eggs.ts`, `src/wordpress.ts`, `src/custom.ts`.
- `css/themes.css` and `css/plugin.css`, combined with the fonts into `styles.css` by `scripts/build-css.mjs`. Edit `css/`, never `styles.css`.
- `fonts/`: Tree's TTFs, copied from Tree. Other fonts come from npm packages.

## Build, install, release

```
npm run build   # tsc, esbuild, load smoke test (scripts/smoke.cjs), styles.css
```

- **Mac:** copy `main.js`, `manifest.json` and `styles.css` to `~/Dropbox/Apps/remotely-save/ObsSync/.obsidian/plugins/tree-writer/`.
- **iPad:** gets updates from GitHub releases through BRAT. It does not sync the config folder, by choice.
- **Every release:**
  1. Bump `version` in `manifest.json` and `package.json`.
  2. Build, commit, push.
  3. Run `gh release create <version> main.js manifest.json styles.css`. The tag equals the version, with no "v".
- `minAppVersion` is 1.11.4, because the WordPress password uses `app.secretStorage`.

## Decisions already made

- **Status line:** Aa alone on the left; reading time or goal in the middle; word count, character count and cursor position on the right.
  - Obsidian's own status bar is hidden, and appears only while hovering the faint ⋯ at the far right.
- **Word goal:** set by clicking the word count or with Ctrl+Shift+W (Mac only). It belongs to one note, and shows "200 / 500 words" in the middle.
- **Amber CRT and Doogie Journal:** never in any menu. Konami and ABACABB both require `terminal-crt`.
- **WordPress:**
  - Title: the opening `# Heading`, else the file name.
  - Repeat the title as an `<h3>` at the top of the body. The blog's theme doesn't show post titles.
  - The body is rendered by Obsidian, so `%%` comments and properties are left out.
- **Moonwalker:** a glow fitted to screenshots of the Genesis *Moonwalker* title screen. The same values are in Tree and Ginkgo, so change all three together.
  - Text `#6cb5f8` on pure black. Links and tags `#8a8aff`, kept brighter than the glow's inner layer so they don't look hollow.
  - The glow is `0 0 0.361em currentColor, 0 0 0.434em #0000ff, 0 0 0.434em #0000ff`. Sizes are in em, so it scales with the font.
  - The inner layer is `currentColor`, so dim text gets a dim glow. A fixed bright inner layer blurs any text darker than itself.
  - Keep it at 4 shadows or fewer. Dan has hit typing lag from stacked shadows.
  - iOS only: headings glow at 50%, bold text at 35%. WebKit blooms bold text about twice as bright as Chromium, so full-strength headings smeared on iPhone while matching body text on Mac. Check glow changes in both engines.
  - Tree and Ginkgo do the same in WebKit only (`@supports (font: -apple-system-body)`): editor headings at 60%, preview headings at 45%, bold at 50%.
- **Focus mode on desktop:** the ribbon waits off the left edge and slides out on hover. Its focus icon is a way out without Escape.
- **Skipped on purpose:** syntax dimming, smart punctuation, heading shortcuts, dictionary, tabs, library, preview/split, find/replace, and a ✎ port of Tree's annotations. Dan uses Obsidian's `%%` comments.

## Gotchas learned

- Never reuse a class name for both a body state and an element. One clash blanked the whole window.
- Avoid circular imports between modules that read each other's constants at load. The smoke test exists because of one.
- Prefer putting effects in the same transaction, as typewriter does with `transactionExtender`. Scrolling afterward causes a visible double paint.
- Obsidian 1.14 sizes the editor from `--font-preferred-size`, which is worked out on `body`. Setting `--font-text-size` on the note pane alone does nothing; set both.
- A theme rule must be at least as specific as the base rule it overrides. Moonwalker's status color lost to `.workspace-leaf-content[data-type="markdown"] > .tree-status`, and the old glow's white edge hid it.
- CSS padding above `.cm-content` lands between properties and the first line in Obsidian.
