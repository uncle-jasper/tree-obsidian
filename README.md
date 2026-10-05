# Tree for Obsidian

The writing feel of [Tree](https://github.com/uncle-jasper/tree), a distraction-free markdown editor, brought into Obsidian. Only the parts Obsidian doesn't already have.

## What's in it

- **Themes.** Tree's palettes, plus two custom themes built from three colors you pick.
- **Fonts.** iA Writer Mono, Duo and Quattro, JetBrains Mono, Inconsolata, Geist, and a couple of retro faces. They're built in, so they work on iPad too.
- **Status line.** Word and character count, reading time and cursor position, plus Tree's little typed-out messages and word milestones. Obsidian's own status bar tucks away behind a faint ⋯ at the right end.
- **Word goal.** Click the word count (or Ctrl+Shift+W on Mac) and type a number. Progress shows as "200 / 500 words", with a thin line filling along the bottom.
- **Aa panel.** Tap the Aa in the status line to change theme, font, size, zen and typewriter without opening settings.
- **Focus mode.** Hides all of Obsidian's interface and leaves just the page. Escape, or the faint corner mark, brings it back.
- **Zen mode.** Fades everything except the sentence or paragraph you're writing.
- **Typewriter mode.** Keeps the line you're typing in the middle of the screen.
- **Just Write.** Cmd+Shift+J locks the look for 30 minutes, or until you've written 500 words.
- **Small things.** Tab jumps past closing `**`, `*`, `~~`, `==`, `` ` `` and `]]`. Double-click a word to see how often it appears. Writing lines are 68 characters wide, with Tree's 1.8 line spacing.

Try the Konami code in terminal crt for something extra.

## Install

Not in the community plugin list yet, so install by hand:

1. Build it (below) to get `main.js`, `manifest.json` and `styles.css`.
2. Copy those three files into `<your vault>/.obsidian/plugins/tree-writer/`.
3. In Obsidian, go to **Settings → Community plugins** and turn on **Tree**.

Works best with Obsidian's default theme underneath.

## Build

```
npm install
npm run build
```

This produces `main.js` and `styles.css` next to `manifest.json`.

## Credits

Fonts: iA Writer Mono, Duo and Quattro (iA), JetBrains Mono, Inconsolata, Geist (Vercel), Print Char 21 (Kreative Korp) and Perfect DOS VGA 437 (Zeh Fernando). Each is included under its own license.

If Tree helps you write, you can [buy me a coffee](https://buymeacoffee.com/dandanmian).
