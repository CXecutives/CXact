# Changing CXact

How to make the usual changes fast and without leaving a copy behind. The layers, the source
of each decision and the checks that hold them: `docs/ARCHITECTURE.md`.

## Change the look

Every colour of the app is written in one file, `ui/src/styles/tokens.css`. Everything else
derives from it: the page, the Excel file, the app icon, the window background and the
Windows title bar. No other file may hold a colour
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
| Excel file (`JobAlerts.xlsx`; the CSV file has no colours) | `surface-muted` (header row), `score-excluded` (excluded rows), `score-ring-0` ... `score-ring-9` (score cells) | `palette.rs` (`xlsx.rs`, `scale.rs`) |
| Windows title bar | `bg` (caption), `text` (title), `text-subtle` (title of an inactive window), of the chosen palette | `palette.rs` (`window_colours` in `src-tauri/src/platform.rs`) |
| Window background, both OS | `bg`: Coast's before the settings are read, then the chosen palette's | `backgroundColor` in `src-tauri/tauri.conf.json` and `tauri.macos.conf.json`; `platform::dress` |
| App icon (Windows, macOS 14 and 15, macOS 26, the brand mark in the page) | `brand` (the plate), `brand-glyph` (the folder with the check) | `tools/palette.json` (`tools/icon.py`) |

Only opaque colour roles leave the page: a role with an alpha (`--selection`), gradients and
shadows stay in it. `palette.rs` holds only the roles of this table (`OUTSIDE` in
`tools/tokens.mjs`): a consumer that starts to wear another role adds it there.

### 2. Run `npm run regen`

It runs `node tools/tokens.mjs`, then `python tools/icon.py` (Python with Pillow, about
30 s). It rewrites, never edit these by hand:

- `core/src/export/palette.rs`: the colour roles of the table above as Rust constants (the
  Excel file, the window and the Windows title bar, the icon's tests)
- `tools/palette.json`: every colour role for the icon generator
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
- Look at the page (`tools/ui-preview.cmd`), a new Excel file (write it from the app) and, after `npx tauri build` and installing, the title bar, the window before the page
  paints, and the icon in the taskbar, the Dock and Finder.

### What does not follow the palette

- The Excel file and the app icon keep Coast whatever palette is chosen in Einstellungen
  (Light and Dark reach only the page and the window).
- The macOS traffic lights and window frame, and the Windows caption buttons: the system's.
- `tools/ui-harness/specs/shell.spec.ts` paints Apple's traffic light colours into a screenshot
  for people to look at.
- The diagnostic sheets of `tools/icon.py` (`--compare`, `--fringe-sheet`) show the icon on
  neutral desktops (dark, mid grey, white).
- Test mails and pages in `core/tests/fixtures/` keep the colours of whoever wrote them.
- The TXT files have no colours.

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
   of Coast is a change of `:root` and reaches the Excel file and the icon too;
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

## Add or change a setting or a first-run step

- Einstellungen is one table, `CARDS` in `ui/src/features/settings/cards.ts`: the cards in
  their order (Postfach, Portale, Export, Darstellung, App), each with its rows. A setting is
  one row there: its kind (switch, choice, a row of buttons, a value), its texts from the
  catalog and what it saves (`patch`). A button is one entry in `ACTIONS` (it opens a checked
  target, or names a command of `SettingsView.svelte`), with `locked` for why it waits. A new
  stored value also needs its field in `Settings` (`core/src/settings.rs`, its default in
  `Settings::default()`) and `SettingsPatch` (`view.rs`), and a file of the new version in
  `core/tests/settings_compat.rs`.
- The range of "Postfach abrufen" is the choice `fetchRange` of the Postfach card (since the
  last fetch, 7 days, 30 days, all alert mails; the words in `settings.rangeName`); core turns
  it into the first day to read (`scan_since` in `core/src/mail/scan.rs`). Another range is a
  variant of `FetchRange` (`core/src/settings.rs`), its arm in `scan_since` and its word.
- The Excel and the CSV file each have a switch of the Export card (`exportExcel` on,
  `exportCsv` off by default); the export writes a file only while its switch is on, and its
  "Öffnen" waits until the file exists (`excelExists`, `csvExists`). The text files for the
  job-matching skill have no switch.
- A first-run step is one entry in `ui/src/features/first-run/steps.ts` (order, name, when it
  is done) and its snippet of the same id in `FirstRunView.svelte`.

## Keys

The app has no shortcuts of its own (`no_app_shortcuts` in `core/tests/ui_contract.rs`): only
what every program does stays, the OS's editing keys of fields, Tab, Enter and Esc, the arrows
in menus and the context menu key. `ui/src/lib/input/input.ts` applies them; what differs
between Windows and macOS is `keyConventions()` in `ui/src/lib/platform.ts`. No tooltip and no
menu names a key.

## Change the job list: its filter, its order, the job's menu

- **The filter**: `FILTER_GROUPS` in `ui/src/lib/state/filter.ts`, the groups in their order
  (Portal, Übereinstimmung, Vertragsart, Arbeitsort), each with its choices, its words and what
  lets a job through. The funnel's menu, the chips under the header, the query and the harness
  read it; the filter is the same in every place. Another group is one entry there, its field
  in `ListFilter` (`toQuery` hands it to the `JobQuery`), its words in the catalog, and in the
  backend its field of `JobQuery` (`view.rs`) and its condition in `filter_condition`
  (`core/src/store/jobs.rs`), which narrows the list and its counts alike.
- **The order**: `SORTS` in the same file (the sort button: by match, by date).
- **The job's menu**: one table, `jobMenu` in `ui/src/features/jobs/actions.ts`. A right click
  on a row shows both groups (what shows the job: Öffnen, Alert-Mail öffnen, Anzeige öffnen,
  KI-Prompt kopieren; what changes it: Trotzdem bewerten or Wieder ausschließen, then the moves
  of its place); the reader's "…" shows the second group (its buttons are the first), and
  the row's tools under the pointer are the moves of its place (`rowTools`, icons with their
  label as tooltip; the ones that delete turn red). The moves per place are `OF_PLACE`, their
  icons `ACTIONS`, their toast words `SAID`. No entry names a key.
- **The portals' order in the UI**: `PORTAL_ORDER` in `ui/src/lib/portals.ts` (freelance.de,
  LinkedIn, freelancermap: Einstellungen, the first-run page, the filter). Core's
  `Portal::ALL` is the order the backend works in and stays as it is.

## Change a role of the controls

Each role of the UI has one pattern, decided in one place; the components only read it, and
`core/tests/ui_contract.rs` fails when a copy appears elsewhere.

- **An icon**: `ui/src/lib/icons.ts` maps each meaning (`trash`, `purge`, `external`,
  `prompt`, `fetch`, `retry`, ...) to one Lucide glyph; components and views pass the
  meaning. Another glyph for a meaning is one edit there (a new glyph also gets its import in
  `ui/src/components/Icon.svelte`, a type error says so). One glyph means one thing: a new
  meaning needs a glyph no other meaning has.
- **A view in the sidebar** (name, icon): `ui/src/lib/views.ts`.
- **A toast**: `TOAST_KINDS` (glyph, colour) and `TOAST_LIFE` (how long, by its button) in
  `ui/src/lib/state/toasts.svelte.ts`; a quiet success is always a toast (`toasts.show`),
  never a note that stays in the view.
- **Hover, press and focus**: one answer per surface kind (quiet, control, raised, label) in
  `ui/src/styles/tokens.css` ("one answer per surface kind").
- **Buttons**: two heights, `sm` (28 px, in rows and tools) and `field` (32 px, the default);
  a button that loses something for good is `warns` (red at rest).
- **Tooltips**: only where something is missing: a button that shows only its glyph, text
  that is cut off, the reason a control waits; never the words that stand there (the sidebar
  names its entries only as a rail of icons). No "·" as a separator: an icon, a comma or a
  line of its own. Both are rules of `ui_contract.rs`.
- **Motion**: only through `ui/src/lib/motion/` (<= 180 ms each): a view switch fades out,
  then in; a row that leaves folds its height; what comes under the list header unfolds;
  bars, notices, dialogs, menus and toasts have their entrances there.
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
4. The UI: one entry in `ui/src/features/profile/sections.ts` where it belongs in the form
   (`{ kind: 'number', key, label, testid }` or `{ kind: 'chips', ... }`; its unit and limit
   come from core) and its label (and hint, placeholder) in both catalogs (`profile.field`).
   `ProfileEditor.svelte`, `ui/src/lib/state/profile.svelte.ts` (the CV update fills it
   too) and the stub's validation need nothing.

A criterion of another kind (a switch, a choice) is a new `Kind` variant: the compiler
names every `match row.kind` that has to handle it; in the UI `normalizedCriteria` and
`fieldValue` of `profile.svelte.ts` take it by hand, a switch is one `kind: 'switch'` entry of
the section's switches, anything else a control kind of `sections.ts` with its component.

## Change the Profil form

Its layout is one table, `SECTIONS` in `ui/src/features/profile/sections.ts`: the sections in
their order and each one's lines of fields. Moving, adding or removing a field or a section is
one entry there (a new section also needs its heading and sentence in `profile.section` and
`profile.sectionHint`); a quiet hint where values contradict each other is the field's
`advice`, a field that waits for another its `off`.

## Add a column of the Excel and the CSV file

One row of `COLUMNS` in `core/src/export/columns.rs`: a key, the German and the English
header, the width in Excel and the function that gives its value for a job (`Row` holds the
job, the words of the language, the Gmail account and the moment of writing). The value says
what it is (`Value`: text, a score, a day rate, months, a day, a moment, a link): `xlsx.rs`
gives it its cell and format, `csv.rs` prints it (numbers bare, days and moments as text in
the language's form, links as their address, text defused and quoted where needed); a new
kind of value is a variant there and the compiler names both places. Words a value holds live
in `core/src/export/texts.rs` in both languages. The header tests, the autofilter and the CSV
header row follow the table; `core/tests/rust_texts.rs` checks the headers like every export
text.

## Add a portal

1. An adapter in `core/src/portal/<name>.rs` (`PortalAdapter`: key, label, monogram, file
   tag, home page, sender domains, search terms, limits, job links, pages), registered in
   `PORTALS`, with its variant of `Portal` in `Portal::ALL` (`core/src/portal/mod.rs`).
2. Its alert mails in `core/src/mail/` (sender, layout, fixtures in `core/tests/fixtures/`).
3. `cargo test -p jobalert-core ipc_types` rewrites `Portal.ts` and `portals.ts`. The UI
   takes names and monograms from there (the catalogs point at `PORTAL_LABEL`); its place in
   the UI's order is one entry of `PORTAL_ORDER` in `ui/src/lib/portals.ts`; the settings get
   its switches from `Portal::ALL`.
4. The stub's demo data may give it jobs; `docs/PLAN.md` says what the portal allows.

## Change a threshold or a default

- The match bands: `HIGH_FROM` and `MID_FROM` in `core/src/model.rs`. The store, the
  prompts and (through `bands.ts`) the UI, the gallery and the stub follow.
- The defaults of the settings: `Settings::default()` in `core/src/settings.rs` (the range of
  "Postfach abrufen" `fetchRange` since the last fetch, the Excel file on, the CSV file off);
  the stub's `initial()` mirrors them.
- A portal's caps: `limits()` of its adapter in `core/src/portal/` (the pause between two
  pages, requests per hour and per day). The hour rolls, the day counts from local midnight
  (`core/src/fetch/policy.rs`, `time::day_start`); the settings show the day's requests.
- The profile's limits: the `MAX_...` constants in `core/src/profile/form.rs` (the backend
  refuses above them; `profile.ts` carries them to the stub and the editor).
- After each: `cargo test -p jobalert-core ipc_types`, commit the rewritten files.
- The copies of the database live in `backups/` next to `jobs.db` in the data folder
  (`core/src/store/backup.rs`: their names, `DAILY_KEPT`, `MIGRATION_KEPT`, `RESTORE_KEPT`);
  Einstellungen > App lists and restores them (`list_backups`, `restore_backup`).
- Not generated yet: the 30 days the first mailbox scan reads (`FIRST_SCAN_DAYS` in
  `core/src/mail/scan.rs`) stand in the catalog texts by hand.

## The preview's demo data

The browser preview (`tools/ui-preview.cmd`, `npm run harness`) runs the page against a stub
(`tools/ui-harness/stub.ts`) instead of the backend. Everything the engine computes comes from
one generated file, `tools/ui-harness/demo/snapshot.json`: the list rows, the reader with its
reasons and passages, the jobs once their page came ("Anzeige laden", the scripted fetch), the
profile as the app understood it and the AI prompts. Never write a
score, a reason or a prompt into the stub by hand.

- An engine, view or prompt change: run `cargo test -p jobalert-core --test ui_demo_snapshot`.
  It rewrites the snapshot and fails while the committed one differs; run it again and commit
  the file with the change. CI fails while it is stale.
- Another demo job, other ad words, another demo state (read, archive, a duplicate,
  details pending or failed, a job of the scripted fetch): edit
  `tools/ui-harness/demo/ads.json`, then regenerate. The sample profile is
  `tools/ui-harness/demo/profile.json`.
- The stub keeps only state: moving, reading, deleting, the list's filter, runs, scenarios and
  errors.
- Specs read engine values (a score, a reason, a count) from the snapshot
  (`tools/ui-harness/specs/demo.ts`), never as literals, so a regenerated snapshot keeps them
  green.

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
   App read it) and in `package.json`; the lock files follow (`cargo check`,
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
6. **Check**: the new version under App, the jobs and the profile still there, a fetch
   runs. On macOS the keychain asks once more (the build is only ad-hoc signed).

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
