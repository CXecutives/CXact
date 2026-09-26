# Changing CXact

How to make the usual changes fast and without leaving a copy behind. The layers, the source
of each decision and the checks that hold them: `docs/ARCHITECTURE.md`.

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
| Windows title bar | `bg` (caption), `text` (title), `text-subtle` (title of an inactive window), of the chosen palette | `palette.rs` (`window_colours` in `src-tauri/src/platform.rs`) |
| Window background, both OS | `bg`: Coast's before the settings are read, then the chosen palette's | `backgroundColor` in `src-tauri/tauri.conf.json` and `tauri.macos.conf.json`; `platform::dress` |
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

- The report, the Excel file and the app icon keep Coast whatever palette is chosen in
  Einstellungen (Light and Dark reach only the page and the window).
- The macOS traffic lights and window frame, and the Windows caption buttons: the system's.
- `tools/ui-harness/specs/shell.spec.ts` paints Apple's traffic light colours into a screenshot
  for people to look at.
- The diagnostic sheets of `tools/icon.py` (`--compare`, `--fringe-sheet`) show the icon on
  neutral desktops (dark, mid grey, white).
- Test mails and pages in `core/tests/fixtures/` keep the colours of whoever wrote them.
- The TXT files have no colours.

## Change the Übersicht

The Übersicht is a list of blocks, `ui/src/features/overview/blocks.ts`: each entry names its
component (`ui/src/features/overview/blocks/`) and the rule for when it shows.

- **Reorder, hide or add a block**: one entry in `BLOCKS`. A new block renders its content inside
  `blocks/Block.svelte` (heading, hairline, spacing, the row list with hairlines or the job rows,
  its own error at its end), so it looks like the others without a style of its own.
- **What a block shows or when**: `ui/src/features/overview/model.svelte.ts`, the one place for
  the Übersicht's data and rules (the order of "Offene Punkte" is its `points`, by weight).
- **Where a tile or a point leads**: `ui/src/features/overview/lead.ts`; each opens exactly the
  set its count names, through the list's public setters.
- **A new number**: `overview_stats` in `core/src/view.rs` (`OverviewStats`), mirrored in
  `tools/ui-harness/stub.ts`; `cargo test -p jobalert-core ipc_types_are_generated_and_committed`
  writes the TypeScript type.
- **Texts**: the `overview` section of `ui/src/lib/i18n/de.ts` and `en.ts`.
- **Check**: `tools/ui-harness/specs/overview.spec.ts` in Chromium.
## Add or change a palette

The app has three palettes (Einstellungen > Darstellung > Farben): Coast is the `:root` block
of `ui/src/styles/tokens.css` and the default; Light and Dark are one block each,
`:root[data-palette='light']` and `:root[data-palette='dark']`, laid over it. Components never
ask which palette is on.

1. **Change one**: edit its block. It sets the palette entries under Coast's names (`--p-cream`
   is the window and the sidebar, `--p-white` the sheet and the cards, `--p-ink` the text,
   `--p-coral` the fills and what is new, `--p-navy` focus, links and progress, ...), so every
   role follows, and then only the roles whose part differs from Coast (in Dark the washes of
   the light text, the scrim, the shadows, the text on the tooltip and on the fills). A value
   of Coast is a change of `:root` and reaches the report, the Excel file and the icon too;
   Light and Dark reach only the page and the window.
2. **Add one** (say `sepia`): a block `:root[data-palette='sepia'] { ... }`, then the name in
   `Palette` (`core/src/settings.rs`, with `code()`), in `window_colours`
   (`src-tauri/src/platform.rs`), in `PALETTES` (`ui/src/lib/palette.ts`), in the options of
   the row `palette` (`ui/src/features/settings/cards.ts`) and its word in
   `settings.paletteName` of `de.ts` and `en.ts`. `cargo test -p jobalert-core ipc_types`
   writes the TypeScript type.
3. Run `npm run regen`: `tools/tokens.mjs` writes the window's colours of every palette
   (`LIGHT_BG`, `DARK_TEXT`, ... and `WINDOW_PALETTES` in `palette.rs`) and measures every text
   role on its backgrounds in every palette (`CONTRAST`, WCAG AA 4.5:1). It fails on a pair
   below; the only exception is Coast's light coral primary, a documented decision
   (`EXCEPTIONS`). `npm run check` runs the same measurement.
4. Check: `cargo test -p jobalert-core --test palette --test ui_contract`, the settings spec
   (`npm run harness -- settings.spec.ts`, its palette and contrast tests), and the page in
   each palette (`tools/ui-preview.cmd`, add `&palette=dark` to the address).

## Add or change a setting, a first-run step or a key

- A setting of Einstellungen is one entry in `ui/src/features/settings/cards.ts`: its card,
  its kind (switch, choice, a row of buttons, a value), its texts from the catalog and what it
  saves (`patch`). A button is one entry in `ACTIONS` (it opens a checked target, or names a
  command of `SettingsView.svelte`), with `locked` for why it waits. A new stored value also
  needs its field in `Settings` (`core/src/settings.rs`) and `SettingsPatch` (`view.rs`).
- A first-run step is one entry in `ui/src/features/first-run/steps.ts` (order, name, when it
  is done) and its snippet of the same id in `FirstRunView.svelte`.
- A key of the app is one row of `ui/src/lib/input/keys.ts` (what it does, where it works,
  its name, its keys per OS): `ui/src/lib/input/input.ts` dispatches from it, the card of the
  keys and Einstellungen show it, and a button that does the same names it (`keys` on
  `Button`). What differs between Windows and macOS is `keyConventions()` in
  `ui/src/lib/platform.ts`; the views' keys are `ui/src/lib/views.ts`.

## Change a role of the controls

Each role of the UI has one pattern, decided in one place; the components only read it, and
`core/tests/ui_contract.rs` fails when a copy appears elsewhere.

- **An icon**: `ui/src/lib/icons.ts` maps each meaning (`trash`, `purge`, `external`,
  `prompt`, `fetch`, `retry`, ...) to one Lucide glyph; components and views pass the
  meaning. Another glyph for a meaning is one edit there (a new glyph also gets its import in
  `ui/src/components/Icon.svelte`, a type error says so). One glyph means one thing: a new
  meaning needs a glyph no other meaning has.
- **A view in the sidebar** (name, icon, key): `ui/src/lib/views.ts`.
- **A toast**: `TOAST_KINDS` (glyph, colour) and `TOAST_LIFE` (how long, by its button) in
  `ui/src/lib/state/toasts.svelte.ts`; a quiet success is always a toast (`toasts.show`),
  never a note that stays in the view.
- **Hover, press and focus**: one answer per surface kind (quiet, control, raised, label) in
  `ui/src/styles/tokens.css` ("one answer per surface kind").
- **Buttons**: two heights, `sm` (28 px, in rows and tools) and `field` (32 px, the default);
  a button that loses something for good is `warns` (red at rest).
- **Check**: `cargo test -p jobalert-core --test ui_contract`, `npm run check`, and
  `tools/ui-harness/specs/shell.spec.ts`, `input.spec.ts` and `gallery.spec.ts` in Chromium.

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

## Add words to the engine

The engine's words live in `core/src/matching/lexicon/` (German and English wording of ads
and profiles: an external contract, never translated):

- `engine.rs`: the core's lists for every profile: fillers, generic words, `CORE_CONCEPTS`
  (phrase to concept: the synonyms), soft skills, language names and levels. Sorted tables
  stay sorted (`binary_search`).
- `domains/<field>.rs`: a domain pack. `triggers` switch it on from the profile's
  competences, `concepts` map a phrase to a concept, `generic` holds words too broad to meet
  a requirement alone. The head of `domains/mod.rs` says how a key is written (folded words,
  single spaces).
- `wishes.rs`: the wishes and industries. `tables.rs` is generated from the old engine
  (`core/tests/fixtures/matching/legacy_lexicon.json`): never edit it.

1. **A term or synonym**: one `(phrase, concept)` pair in the pack of its field, or in
   `CORE_CONCEPTS` when every field uses it. A false friend gets a concept of its own. The
   pack's unit tests get a paraphrase that meets it and a false friend that does not.
2. **A pack**: a file in `domains/` and one line in `DOMAINS`.
3. Run `cargo test -p jobalert-core` (the pack tests and the gates of the corpus and the
   held-out sets, whose floors stand in `core/tests/matching_heldout.rs`; a floor is never
   lowered to let a change pass), then both reports:
   `cargo test -p jobalert-core --test matching_corpus -- --ignored report --nocapture` and
   `cargo test -p jobalert-core --test matching_heldout -- --ignored heldout_report --nocapture`.
4. A change that moves a score raises `ENGINE_VERSION` (`core/src/matching/mod.rs`; the app
   scores the stored jobs again) and gets its section in `docs/MATCHING.md` with the numbers
   before and after.

## Release a version

1. **Bump**: `version` in the root `Cargo.toml` (the app, the installer and Einstellungen >
   Wartung read it) and in `package.json`; the lock files follow (`cargo check`,
   `npm install --package-lock-only`). The harness stub keeps its own demo version.
2. **Data of the old version**: a new field of `Settings` came with its file of the new
   version (`core/tests/settings_compat.rs` says how); a new database layout is one more step
   of the schema chain (`core/src/store/schema.rs`, with its `schema_vN.sql` fixture). The
   store copies the database to `backups/` before it migrates.
3. **Gates**: `npm run check`, `cargo fmt --all --check`, clippy, `cargo test --workspace`,
   and the full harness in both engines once.
4. **Build**: `npx tauri build` writes
   `target/release/bundle/nsis/CXact_<version>_x64-setup.exe`; the macOS dmg comes from the
   `macos-latest` CI job (workflow artifacts; nothing is published).
5. **Install over the old version**: the user starts the setup from the Explorer (an agent's
   sandbox redirects AppData, so its install is not the real one). The setup replaces the
   program only: the data folder (`%LOCALAPPDATA%\de.cxecutives.job-alert-monitor\`, on macOS
   `~/Library/Application Support/de.cxecutives.job-alert-monitor/`: the database with the
   settings, `backups/`, the log), the work folder and the keychain entry stay. It removes an
   install of the old name Job-Alert-Monitor silently (`src-tauri/windows/hooks.nsh`,
   `core/tests/installer_hooks.rs`). The identifier `de.cxecutives.job-alert-monitor` never
   changes: it names the data folder and the keychain entry.
6. **Check**: the new version under Wartung, the jobs, marks and profile still there, a
   fetch runs. On macOS the keychain asks once more (the build is only ad-hoc signed).

## Where a new rule goes

A rule is a check that fails a gate, never a sentence alone. Its message names the rule and
the fix; its exceptions stand in it with a reason. Then one row in the guardrail table of
`docs/ARCHITECTURE.md`.

- **One file, one construct** (an import, a syntax, a value in TypeScript or Svelte):
  `eslint.config.js`, as an import door or a `SYNTAX` entry opened for the one file that may.
  CSS values: `stylelint.config.js`.
- **The import graph, file size, dead code**: `tools/architecture.mjs` (`LIB_UI_HELPERS`,
  `FEATURE_PUBLIC`, `LARGE`, `ENTRIES`). A finding accepted for a while goes to `TEMPORARY`
  with a TODO; the check fails once the finding is gone, so the entry goes too.
- **Across files, or a promise no linter sees** (the gallery shows every component, texts
  only from the catalog, per-OS markup): `core/tests/ui_contract.rs`, which runs without Node.
- **The backend and its data**: a Rust test in `core/tests/` (`contract.rs` for commands,
  `settings_compat.rs` and `existing_data.rs` for stored data, `architecture.rs` for the
  shell).
- **Behaviour in a browser**: a harness spec in `tools/ui-harness/specs/`, reading its texts
  from the catalog through the shared helpers.
