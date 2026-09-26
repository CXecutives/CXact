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

## What the backend generates for the UI

`cargo test -p jobalert-core ipc_types` writes `ui/src/lib/ipc/types/` from core and fails
while a file changed (commit the result); `cargo test -p jobalert-core --test contract`
writes `commands.ts`. Never edit them by hand. The PascalCase files are the IPC types
(ts-rs); the lower-case ones are values the UI imports by their path:

| File | Source | Holds |
|---|---|---|
| `commands.ts` | `src-tauri/commands.txt` | every command, its arguments and its result |
| `bands.ts` | `core/src/model.rs` | `HIGH_FROM`, `MID_FROM`, `BAND_FROM`, `bandOf` |
| `portals.ts`, `Portal.ts` | the registry in `core/src/portal/` | `PORTALS` (the order), `PORTAL_LABEL`, `PORTAL_MONOGRAM` |
| `settings.ts` | `core/src/settings.rs` | `AUTO_ARCHIVE_DAYS`, `AUTO_EMPTY_TRASH_DAYS` |
| `profile.ts` | `CRITERIA` in `core/src/profile/form.rs` | `NUMBER_CRITERIA` (limit, unit), `WORD_CRITERIA`, `UNREADABLE_FIELDS`, `MAX_FOCUS`, the list limits, `EMPTY_FORM` |

## Add or remove a command

1. The handler: a `#[tauri::command]` function in `src-tauri/src/commands/<area>.rs`.
2. One line in `src-tauri/commands.txt`: `name  { arguments }  -> Result`, both in
   TypeScript (`{}` for none). A new Rust type in them derives `ts_rs::TS` under
   `cfg(test)` and gets its `f.add::<T>()` in `core/src/view/ts.rs`.
3. One entry in `generate_handler!` in `src-tauri/src/commands/mod.rs`.
4. A handler in `tools/ui-harness/stub.ts` (its `Handlers` type asks for every command).
5. Build `src-tauri` (clippy or a build): `build.rs` writes the app manifest and
   `src-tauri/capabilities/main.json` from the table. Run the contract test for
   `commands.ts`. Commit both.

`core/tests/contract.rs` checks the table against `generate_handler!` both ways and the
capability against the table. Removing a command is the same in reverse; the stub, the
harness specs and the callers of `invoke` fail to compile until nothing names it.

## Add a profile criterion

A number or a list of words under `harte_kriterien`:

1. The engine reads it first: its keys (`KEYS_...`) in `core/src/matching/lexicon/` and its
   value in `matching::facts::HardCriteria`.
2. `core/src/profile/form.rs`: a field of `ProfileCriteria`, a variant of `UnreadableField`
   (and in `UnreadableField::ALL`), a limit (`MAX_...`) if it is a new one, and one row of
   `CRITERIA` in the order a new profile writes it: `Kind::Number { max, unit, slot, read }`
   or `Kind::Words { upper, slot, read }`. Normalizing, the limit, reading, writing and
   "Wert entfernen" follow the row; a test fails while `ALL` or the table misses a field.
3. `cargo test -p jobalert-core ipc_types` rewrites `ProfileCriteria.ts`,
   `UnreadableField.ts` and `profile.ts`.
4. The UI: its place in `ui/src/features/profile/ProfileEditor.svelte` (the unit through
   `unitOf`) and its label in both catalogs (`profile.field`).
   `ui/src/lib/state/profile.svelte.ts` and the stub's validation need nothing.

A criterion of another kind (a switch, a choice) is a new `Kind` variant: the compiler
names every `match row.kind` that has to handle it; in the UI `normalizedCriteria` and
`fieldValue` of `profile.svelte.ts` take it by hand.

## Add an Excel column

One row of `COLUMNS` in `core/src/export/xlsx.rs`: a key, the German and the English header,
the width and the function that writes its cell (`Cell` holds the job, the words of the
language and the formats). Words a cell writes live in `core/src/export/texts.rs` in both
languages. The header test and the autofilter follow the table; `core/tests/rust_texts.rs`
checks the headers like every export text.

## Add a portal

1. An adapter in `core/src/portal/<name>.rs` (`PortalAdapter`: key, label, monogram, file
   tag, home page, sender domains, search terms, limits, job links, pages), registered in
   `PORTALS`, with its variant of `Portal` in `Portal::ALL` (`core/src/portal/mod.rs`).
2. Its alert mails in `core/src/mail/` (sender, layout, fixtures in `core/tests/fixtures/`).
3. `cargo test -p jobalert-core ipc_types` rewrites `Portal.ts` and `portals.ts`. The UI
   takes names and monograms from there (the catalogs point at `PORTAL_LABEL`), the order
   from `PORTALS`; the settings get its switches from `Portal::ALL`.
4. The stub's demo data may give it jobs; `docs/PLAN.md` says what the portal allows.

## Change a threshold or a default

- The match bands: `HIGH_FROM` and `MID_FROM` in `core/src/model.rs`. The store, the
  report's legend, the prompts and (through `bands.ts`) the UI, the gallery and the stub
  follow.
- The defaults of the settings: `AUTO_ARCHIVE_DAYS` and `AUTO_EMPTY_TRASH_DAYS` in
  `core/src/settings.rs`; the switches in Einstellungen take the days from `settings.ts`.
- The profile's limits: the `MAX_...` constants in `core/src/profile/form.rs` (the backend
  refuses above them; `profile.ts` carries them to the stub and the editor).
- After each: `cargo test -p jobalert-core ipc_types`, commit the rewritten files.
- Not generated yet: the 30 days the first mailbox scan reads (`FIRST_SCAN_DAYS` in
  `core/src/mail/scan.rs`) stand in the catalog texts by hand.
