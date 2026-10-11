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
  - The build compresses every TTF to WOFF2 (`wawoff2`), whole, with no subsetting. `styles.css` went from 2.4 MB to 0.9 MB; the iPhone was hanging on cold starts.

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

- **Status line:** Aa and ¶ on the left; reading time or goal in the middle; word count, character count and cursor position on the right.
  - Counts, reading time, goal, milestones, Just Write and the line number cover only what's written: properties are left out (`noteBody()` in `status.ts`). Mentions aren't part of the note's text.
  - It stays on its note while a sidebar has the focus (`currentNote()` in `main.ts`), and goes only when the main area's most recent pane isn't a note. It used to vanish on a click into the file explorer.
- **Quiet mode, ¶ (Ctrl+Shift+H on Mac and iPad):** says "quiet mode on." / "quiet mode off." (not when focus mode does it), and hides properties and linked/unlinked mentions in every note, and stays until pressed again. Focus mode hides them too and shows them on the way out, unless they were already hidden going in. Pressing ¶ during focus mode sticks. While on, the note keeps Tree's 6rem under the last line (also when a note has no mentions).
- **Bottom room:** CodeMirror keeps the line you're typing 80px above the status line, as Tree's `ensureCursorPadding()` does, quiet mode or not. Bottom only, by choice (Tree also does the top). Not in typewriter mode.
  - Obsidian's own status bar is hidden, and appears only while hovering the faint ⋯ at the far right.
- **Word goal:** set by clicking the word count or with Ctrl+Shift+W (Mac only). It belongs to one note, and shows "200 / 500 words" in the middle.
- **Time goal:** the same box takes time: `25m`, `25 min`, `1h`, `1h30m`, `90m`, `1:30` (h:mm). `500` is still words, `0` clears.
  - A note has one goal at a time. Setting either kind replaces the other.
  - Shows "12 / 25 min" in whole minutes (nothing ticks) and fills the same bar. After the target it keeps counting.
    - A goal of an hour or more shows hours and minutes on both sides: "12m / 1h 30m", "1h 15m / 1h 30m", "45m / 2h" (`fmtTimeGoal()` in `status.ts`). Tree shows the same.
  - It counts only while its note is the current one and its Obsidian window (the main one or a popout) is in front and visible: a 5s tick, with gaps over 10s dropped. Switching notes or apps, locking the screen and sleep all pause it. Clicking into a sidebar (files, search, outline) doesn't: the current note is then the main area's most recent pane (`currentNote()` in `main.ts`). Typing isn't required, on purpose: it's for time spent with the page, not words produced.
  - Setting a goal says "word goal: 500." / "time goal: 25 minutes." / "goal cleared." Tree has the same time goal.
- **Custom themes:** three slots (`custom`, `custom2`, `custom3`), in Tree and Ginkgo too. Only these can be named, given a cursor, exported or imported over. Built-in themes are fixed.
  - A name (24 characters at most) replaces "custom 2" wherever themes are listed, followed by (C1), (C2) or (C3) so it still reads as a custom theme: "Dusk (C2)" (`themeName()` in `settings.ts`).
  - Cursor: line (Tree's own), block (the CRT shape, no glow) or underline (Doogie Journal's), in the accent color. The block is the accent at 40%, not solid, so the letter under it stays readable. Dan chose tinted over solid. Body classes `tree-cursor-block` / `tree-cursor-underline`, set only while a custom theme is on.
    - Drawn by `shapeCursorExtension()` in `editor.ts`, a CodeMirror layer that measures the character under the cursor. Terminal CRT, Amber CRT (solid block with glow) and Doogie Journal (underline) are drawn the same way. Styling `.cm-cursor` with `width: 1ch` was tried first and didn't line up in headings or formatted text: 1ch is body-text width, whatever the cursor sits on.
  - Theme file, shared by all three apps: `Name.tree-theme.json` holding `{ treeTheme: 1, name, bg, text, accent, cursor }`. Import needs three `#rrggbb` colors, and fills the slot it was started from. Messages are Tree's: "theme exported." / "theme imported." / "not a theme file."
  - Export on desktop is a download. Obsidian on iPad can't download, so there the file is written to the vault root.
  - Ginkgo's shell works out surface, muted and border differently from Tree and the plugin, so a shared theme matches on the three main colors only.
- **Font sizes:** 14 to 26px in steps of 2, plus Obsidian's own. The same list in Tree and Ginkgo.
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
  - iOS only: headings glow at 50%, bold text at 50%. WebKit blooms bold text about twice as bright as Chromium, so full-strength headings smeared on iPhone while matching body text on Mac. Check glow changes in both engines.
  - Tree and Ginkgo do the same in WebKit only (`@supports (font: -apple-system-body)`): editor headings at 60%, preview headings at 45%, bold at 50%.
- **Glow themes (Moonwalker, Terminal, Terminal CRT, Amber CRT):** every text glow follows the text color (`currentColor`, or `color-mix(in srgb, currentColor N%, transparent)` for a fainter one), so dim text never sits under a brighter glow and blurs. Applies in all three apps. Terminal links are `#7dff7d`, Amber CRT links `#ffd27a`. Doogie Journal has no glow.
- **Bold:** drawn as Tree draws it, weight 700 plus a 0.6px `-webkit-text-stroke`, the same as bold in the Tree and Ginkgo editors, while a Tree font is on. Most bundled fonts have no bold face, and Chromium's synthetic bold barely shows.
  - Known differences, left for now. Dan may want all three in line later:
    - Reading view bold is 0.6px here; Tree and Ginkgo's preview bold is 0.4px.
    - Tree and Ginkgo give H4 to H6 a 0.4px stroke (`.cm-tree-h4, .cm-tree-h5, .cm-tree-h6`). The plugin gives headings none.
- **Focus mode is the main window only:** Obsidian copies body's classes into popout windows, so every focus rule leaves out `.is-popout-window`. Notes on other displays stay as they are, and keep their properties and mentions unless ¶ was pressed.
  - The pane that stays is the main window's most recent one, marked `.tree-focus-tabs` by `markFocusTabs()`. Not `.mod-active`: that leaves the main window when you click into another, which blanked the note.
- **Focus mode on desktop:** the ribbon waits off the left edge and slides out on hover. Its focus icon is a way out without Escape.
- **Skipped on purpose:** syntax dimming, smart punctuation, heading shortcuts, dictionary, tabs, library, preview/split, find/replace, and a ✎ port of Tree's annotations. Dan uses Obsidian's `%%` comments.

## Gotchas learned

- Never reuse a class name for both a body state and an element. One clash blanked the whole window.
- Avoid circular imports between modules that read each other's constants at load. The smoke test exists because of one.
- Prefer putting effects in the same transaction, as typewriter does with `transactionExtender`. Scrolling afterward causes a visible double paint.
- Obsidian 1.14 sizes the editor from `--font-preferred-size`, which is worked out on `body`. Setting `--font-text-size` on the note pane alone does nothing; set both.
- A theme rule must be at least as specific as the base rule it overrides. Moonwalker's status color lost to `.workspace-leaf-content[data-type="markdown"] > .tree-status`, and the old glow's white edge hid it.
- CSS padding above `.cm-content` lands between properties and the first line in Obsidian.
- `wawoff2` gives back empty fonts, with no error, when several compress at once. `build-css.mjs` runs them one at a time and throws on an empty result.
