# enWriter

enWriter is a desktop app for writing novels. It works offline, and your work is kept in plain folders on your computer. It was previously called emWriter; some internal names (`window.emw`, a few `emwriter.` storage keys) still use the old name on purpose.

It is built with Electron and plain JavaScript. Version `0.7.9` is declared in `package.json`.

## Features

**Manuscript and editor**
- Rich-text editor with a ribbon, drop caps, a page font and size that apply to the whole book, and links.
- Smart quotes, automatic ellipsis, and `--` becoming an em dash.
- Typewriter mode, which keeps the line you are writing near the middle of the page.
- Auto highlight: a settled selection is highlighted with the ribbon's current colour.
- Find and replace, including Replace All (a snapshot is taken first).
- Spell check, off until switched on (F7 or the ribbon), with US or UK English and a custom dictionary.

**Structure**
- Chapters and scenes, with word counts and autosave.
- Timeline: plotlines down the side, chapters across the top, scenes in the cells.
- Chapter overview: clicking a chapter shows its scenes as cards.

**Story bible**
- Characters, Places, Notes and Tags, each with categories, aliases, attributes and links to scenes.
- Family trees: families of existing characters on a canvas, generation bands, relationship types with colours (built in or your own), auto-arrange, and export as a PNG.

**Darlings**
- A holding place for text, scenes, chapters and reference items (characters, places, notes, tags) you removed but may want back.
- Project snapshots: Ctrl+S keeps a copy of the whole project, listed in Darlings, and any snapshot can be restored.

**Library**
- Home screen with several books, shelves and covers.
- A private shelf protected by a passphrase.
- The library folder can be moved or switched in Settings.

**Settings and appearance**
- Dark, light or system theme, accent colour, UI scale, reduced motion.
- Writing settings and a configurable bottom bar (order and visibility of tabs).

**Shortcuts**
- A shortcut viewer (`Ctrl+/`) where every shortcut can be rebound.

## Keyboard shortcuts

The table below lists the default shortcuts. It was generated from the shortcut registry (`emw.keys.list()`) of the running app. On macOS, `Ctrl` is shown as `⌘` and `Alt` as `⌥`. Every shortcut can be changed in Settings, in the shortcuts section (also reached with `Ctrl+/`).

| Action | Shortcut |
| --- | --- |
| Settings | `Ctrl+,` |
| Select all | `Ctrl+A` |
| Keyboard shortcuts | `Ctrl+/` |
| Go to tab 1 to 8 (bottom bar order) | `Ctrl+1` to `Ctrl+8` |
| Next tab | `Ctrl+PageDown` |
| Previous tab | `Ctrl+PageUp` |
| Spell check | `F7` |
| Save and snapshot | `Ctrl+S` |
| New chapter | `Ctrl+N` |
| New scene | `Ctrl+Shift+N` |
| Undo | `Ctrl+Z` |
| Redo | `Ctrl+Shift+Z` or `Ctrl+Y` |
| Undo chapter or scene change | `Ctrl+Alt+Z` |
| Redo chapter or scene change | `Ctrl+Alt+Shift+Z` |
| Pin chapters panel | `Alt+1` |
| Show ribbon | `Alt+2` |
| Pin inspector | `Alt+3` |
| Send to Darlings | `Ctrl+Shift+D` |
| Save snapshot with a name | `Ctrl+Shift+S` |
| Find | `Ctrl+F` |
| Find next | `F3` |
| Find previous | `Shift+F3` |
| Replace | `Ctrl+H` |
| New book (on Home) | `Ctrl+N` |

Actions with no default shortcut, such as the View menu items for family trees, can be given one in the same place. `Ctrl+Z` is normal text undo inside the editor, and store undo on views such as the Timeline, the chapter overview and the story-bible tabs.

## Where your writing lives

- **Library folder.** Default `Documents/enWriter` (inside the operating system's Documents folder). It can be changed in Settings.
- **`library.json`** in the library folder holds the shelves and per-book display information.
- **One `.mwt` package per book.** Each is a folder containing:
  - `book.json`: the structure and reference data (chapters, scenes, characters, places, notes, tags, families, and so on).
  - `Files/`: chapter, scene and note bodies as HTML files, plus character thumbnails and Darlings payloads.
  - `Meta/`: `info.json` and, if the book has one, `cover.webp`.
  - `Snapshots/`: project snapshots, if you have taken any.
- **`settings.json`** is in the app's user data folder (Electron's `userData`, which differs by operating system). It holds per-user preferences, including custom shortcuts and the custom dictionary. It is not inside the library.

Writes to these files are atomic (a temporary file is written, then renamed).

**Backing up:** close the app and copy the library folder. A single `.mwt` folder is one book. Copy `settings.json` as well if you want your preferences and shortcuts.

**Privacy:** enWriter's own code makes no network requests, and the page's Content Security Policy allows only local resources. On Windows and Linux, Electron's spell checker may download a dictionary the first time a language is used; that is Chromium's download, not the app's. macOS uses the system spell checker.

The private shelf hides books from view. It does **not** encrypt them: hidden books stay readable on disk. The passphrase is stored as a salted scrypt hash in `settings.json`.

## Getting started

Requirements: Node.js and npm. `package.json` does not declare a Node version, so use a current Node LTS release that the declared dependencies (`electron` `^45.1.0`, `electron-builder` `^26.18.0`) support. The repository includes a `package-lock.json`.

```
git clone https://github.com/kaisar149/enwriter.git
cd enwriter
npm ci
npm start
```

`npm install` also works if you prefer it; `npm ci` installs exactly what the lockfile lists.

Installers are built with electron-builder, using the configuration in `package.json`:

```
npm run pack    # unpacked app in dist/, no installer
npm run dist    # installers for the platform you run it on
```

The configured targets are NSIS on Windows, DMG on macOS, and AppImage and deb on Linux. The `.mwt` file association is declared for packaged builds. These scripts and targets are configured, but they have not been run while writing this README, so treat installers as untested.

On Windows and Linux the app downloads spell-check dictionaries on first use of a language; this needs a network connection once. On macOS the system checker picks the language itself, so the US/UK choice does not apply there.

## Project layout

```
.github/workflows/   GitHub Actions workflows
build/               electron-builder resources folder
src/                 all application code
LICENSE              MIT license
package.json         scripts, electron-builder config
package-lock.json    dependency lockfile
```

The `.github/workflows/` and `build/` folders exist in the repository but are not described further here.

| File | What it does |
| --- | --- |
| `src/library.js` | Library folder, `library.json`, `.mwt` packages, `settings.json` and its validation rules, library moves. |
| `src/main.js` | Electron main process: window, theme, spell-check language and dictionary, IPC handlers, family-tree PNG export. |
| `src/preload.js` | The `window.api` bridge between the renderer and the main process (context isolation on). |
| `src/private-shelf.js` | Passphrase check for the private shelf (salted scrypt hash). |
| `src/snapshots.js` | Project snapshots written inside each book package. |
| `src/renderer/app.js` | Manuscript: chapter and scene tree, autosave, word counts. |
| `src/renderer/auto-highlight.js` | Auto highlight toggle for settled selections. |
| `src/renderer/book.js` | The open book, per-book storage keys, switching books. |
| `src/renderer/boot.js` | Runs before first paint: theme, accent, zoom. Holds `window.emwPrefs`. |
| `src/renderer/chapter-view.js` | Chapter overview: a grid of scene cards. |
| `src/renderer/darlings.js` | Darlings tab: sending, restoring, and the snapshot list. |
| `src/renderer/editor.js` | The rich-text editor and ribbon (contenteditable), typewriter mode. |
| `src/renderer/entity-view.js` | Characters, Places, Notes and Tags: list-and-detail view per kind. |
| `src/renderer/family-canvas.js` | Family trees: the SVG canvas, connecting, auto-arrange, PNG export. |
| `src/renderer/family-tree.js` | Family trees: families panel and relationship types manager. |
| `src/renderer/find.js` | Find and replace. |
| `src/renderer/fonts.js` | System font list and the searchable font picker. |
| `src/renderer/home.js` | Home: shelves, covers, books. |
| `src/renderer/index.html` | The single page: CSP, icon sprite, view containers, script load order. |
| `src/renderer/inspector.js` | Inspector: characters and places detected in the text, attached notes. |
| `src/renderer/legibility.js` | Keeps writer-chosen colours readable across dark and light themes. |
| `src/renderer/library-settings.js` | Library section of Settings: moving, starting or opening a library. |
| `src/renderer/private-shelf.js` | Private shelf, renderer side. |
| `src/renderer/scene-dialog.js` | Scene detail window opened from the Timeline. |
| `src/renderer/settings.js` | Settings dialog and the renderer side of `settings.json`. |
| `src/renderer/shortcuts.js` | Shortcut registry, key handling, tab navigation, the shortcuts viewer. |
| `src/renderer/smart-text.js` | Smart quotes and automatic ellipsis while typing. |
| `src/renderer/snapshots.js` | Snapshots, renderer side (save, list, restore). |
| `src/renderer/spell-dictionary.js` | Custom dictionary. |
| `src/renderer/spell-language.js` | US or UK English, globally or per book. |
| `src/renderer/spellcheck.js` | Spell check toggle and correction menu. |
| `src/renderer/store.js` | Single source of truth for book data; every change is an undoable commit. |
| `src/renderer/styles.css` | All styling; colours are tokens with dark values on `:root` and light values on `html[data-theme="light"]`. |
| `src/renderer/timeline.js` | Timeline: plotlines by chapters, scenes in the cells. |
| `src/renderer/typography.js` | Whole-book page font and size. |
| `src/renderer/ui.js` | Menu bar, auto-hiding panels, bottom tabs, dialog, context menu, toast, inline rename. |
| `src/renderer/widgets.js` | Shared pieces: link fields, chip input, small rich-text editor, image helpers. |
| `src/renderer/writing-settings.js` | Writing and Bottom bar sections of Settings. |

**Renderer modules.** Renderer files are plain scripts loaded with `defer` from `index.html`; there is no bundler and no framework. Each is an IIFE with `'use strict'` that attaches to the shared global `window.emw` (for example `emw.store`, `emw.menu`, `emw.toast`, `emw.settings`). The load order is defined by the script tags in `index.html`. The internal namespace keeps the old `emw` name.

**The store.** `store.js` holds the book data. Every change goes through `commit(label, fn, opts)`, which records an undo snapshot; `S.batch` makes several changes one undo step. Views render from the store and listen with `S.on`. Text bodies live in files and are not part of store undo.

**Main process.** `main.js` creates the window (sandboxed, context isolation on, no Node integration in the renderer) and registers IPC handlers. `library.js` owns the library, packages and settings, `snapshots.js` the snapshots, and `private-shelf.js` the passphrase. The renderer only ever sees book ids, never folder paths, and IPC arguments are validated in the main process.

## Design principles

- No framework, no bundler, no runtime dependencies. Electron and electron-builder are development dependencies only.
- Strict Content Security Policy (`script-src 'self'`) and a sandboxed renderer. The renderer reaches the main process only through `window.api`.
- Atomic file writes. Deleted data goes to the OS trash or has a working Undo.
- Destructive actions are undone with an Undo toast rather than a confirmation dialog.
- Every colour is a token. Dark and light values are both defined, and new surfaces are checked in both themes.

## Contributing and status

To report a problem, [open an issue](https://github.com/kaisar149/enwriter/issues). Say which version you are running (`package.json`), what you did, and what you expected.

Known limitations:
- No test suite is documented: `package.json` has no `test` script, so changes are checked by running the app.
- Installers have not been built or run as part of writing this README.
- The family tree canvas was exercised in Chromium with a stand-in for the main-process bridge, not in a full Electron run, so the PNG export's save dialog has not been seen working end to end.
- Family tree auto-arrange is a heuristic. It avoids overlaps, but with many spouse and sibling links some lines arc over a row, and you may want to adjust by hand.
- Text edits are not part of store undo; the editor uses the browser's own text undo.
- The private shelf is not encryption (see above).

## License

MIT. See [LICENSE](LICENSE).
