# Changing CXact

How to make the usual changes fast and without leaving a copy behind.

## Change the look

Every colour of the app is written in one file, `ui/src/styles/tokens.css`. Everything else
derives from it: the page, the report (`JobAlerts.html`), the Excel file, the app icon, the
window background and the Windows title bar. No other file may hold a colour
(`core/tests/palette.rs`, `no_colour_is_written_twice`); the UI lint rejects colours outside
tokens.css as well.

### 1. Edit tokens.css

Palette first, roles second.

1. **Palette** (`--p-*`, HSL triplets such as `13 73% 63%`). A new palette is new values here:
   the coral, the navy, the cream, the ink, the greys, the status colours, the ten score steps
   (`--p-score-0` ... `--p-score-9`). Only tokens.css refers to a palette entry, so renaming one
   (a blue brand is no longer `--p-coral`) is a change inside this file.
2. **Roles** (`--bg`, `--text`, `--accent`, `--primary`, `--brand`, `--score-ring-0`, ...). A
   role points at a palette entry (`hsl(var(--p-coral))`) or at another role
   (`var(--text-subtle)`). Point a role elsewhere to move one use to another colour and leave
   the rest alone: `--brand` changes only the app icon, `--unread` only the dot of a new job.

Components use roles only; so do the consumers outside the page:

| Consumer | Roles | Read through |
|---|---|---|
| Report (`JobAlerts.html`) | `bg`, `surface`, `surface-muted`, `text`, `text-muted`, `text-subtle`, `border`, `icon-accent` (the star), `unread` (the dot of a new job), `score-high-*`, `score-mid-*`, `score-low-*` (text and surface), `score-track`, `danger`, `danger-strong`, `danger-soft`, `score-ring-0` ... `score-ring-9`, and the font `font-sans` | `core/src/export/palette.rs` (`overview_html.rs`) |
| Excel file (`JobAlerts.xlsx`) | `surface-muted` (header row), `score-excluded` (excluded rows), `score-ring-0` ... `score-ring-9` (score cells) | `palette.rs` (`xlsx.rs`, `scale.rs`) |
| Windows title bar | `bg` (caption), `text` (title), `text-subtle` (title of an inactive window) | `palette.rs` (`src-tauri/src/platform.rs`) |
| Window background, both OS | `bg` | `backgroundColor` in `src-tauri/tauri.conf.json` and `tauri.macos.conf.json` |
| App icon (Windows, macOS 14 and 15, macOS 26, the brand mark in the page) | `brand` (the plate), `brand-glyph` (the folder with the check) | `tools/palette.json` (`tools/icon.py`) |

Only opaque colour roles leave the page: a role with an alpha (`--selection`), gradients and
shadows stay in it.

### 2. Run `npm run regen`

It runs `node tools/tokens.mjs`, then `python tools/icon.py` (Python with Pillow, about
30 s). It rewrites, never edit these by hand:

- `core/src/export/palette.rs`: every colour role as a Rust constant (the report, the Excel
  file, the Windows title bar)
- `tools/palette.json`: the same for the icon generator
- `backgroundColor` in `src-tauri/tauri.conf.json` and `src-tauri/tauri.macos.conf.json`
- `src-tauri/icons/icon.ico`, `icon.icns`, `icon.png`, `src-tauri/icons/CXact.icon/` and
  `ui/src/assets/app-icon.svg`

Commit them together with tokens.css.

### 3. Check

- `npm run check`: its last step, `check:tokens`, fails while a generated file is stale.
- `cargo test -p jobalert-core --test palette --test icon --test ui_contract`: the generated
  files say what tokens.css says, no colour is written anywhere else, every icon file carries
  `--brand`, the title bar names its roles. CI runs these with `cargo test`.
- Contrast: the gallery's colour board (`tools/ui-preview.cmd`, then add `&gallery` to the
  address) measures the text roles against white and the cream. Body text keeps 4.5:1.
- Look at the page (`tools/ui-preview.cmd`), a new report and Excel file (write them from the
  app) and, after `npx tauri build` and installing, the title bar, the window before the page
  paints, and the icon in the taskbar, the Dock and Finder.

### What does not follow the palette

- The macOS traffic lights and window frame, and the Windows caption buttons: the system's.
- `tools/ui-harness/specs/shell.spec.ts` paints Apple's traffic light colours into a screenshot
  for people to look at.
- The diagnostic sheets of `tools/icon.py` (`--compare`, `--fringe-sheet`) show the icon on
  neutral desktops (dark, mid grey, white).
- Test mails and pages in `core/tests/fixtures/` keep the colours of whoever wrote them.
- The TXT files have no colours.
