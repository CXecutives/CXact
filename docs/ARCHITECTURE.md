# Architecture

How CXact is built and which check keeps each rule. Where a change goes:
[docs/CHANGING.md](CHANGING.md). Decisions and progress: [docs/PLAN.md](PLAN.md).

## Layers

Each layer uses only the ones below it.

- **`core/`** (`jobalert-core`): everything the app knows and does, without UI and without
  prose. `mail/` reads the alert mails, `portal/` knows the portals (one registry), `fetch/`
  fetches pages through the policy, `matching/` is the pure integer engine, `store/` the
  SQLite database (a chain of schema steps), `pipeline/` runs scan, fetch, score and export,
  `export/` writes Excel, TXT, the report and the prompts, `view.rs` shapes what the UI sees.
- **`src-tauri/`**: the shell. Thin commands in `src/commands/`, each one line in
  `commands.txt`; they call core and return its view types. Per-OS code only in
  `src/platform.rs` (`smoke.rs` is the debug-only probe).
- **`ui/src/`** (Svelte 5), from the bottom:
  - `styles/tokens.css`: every value (colour, length, time, radius, shadow, layer) and the
    three palettes. Nothing else writes a value.
  - `components/`: the design system. The only raw controls, the only Lucide import
    (`Icon.svelte`); it knows no feature and gets its data as props.
  - `features/<name>/`: one screen each (`jobs`, `overview`, `profile`, `settings`,
    `first-run`, `shell`, `gallery`) and `features/shared/`. A feature uses another only
    through `features/shared/` and the public modules named in `FEATURE_PUBLIC` of
    `tools/architecture.mjs`.
  - `lib/`: no components, no features. `lib/state/` the app's state, `lib/ipc/api.ts` the
    only door to Tauri, `lib/input/input.ts` all input handling, `lib/motion/` all motion,
    `lib/i18n/` the catalogs (`de.ts` the source, `en.ts` its mirror) and the text functions,
    `lib/platform.ts` the per-OS conventions, `lib/icons.ts` the icons by meaning.
  - `App.svelte`, `main.ts`: which view shows.

## One source per decision

A decision is written once; everything else reads it or is generated from it.

| Decision | Source | Read by |
|---|---|---|
| Colours, sizes, times, palettes | `ui/src/styles/tokens.css` | components, `npm run regen` (report, Excel, title bar, window, icon) |
| Facts of a job, their order and icons | `ui/src/lib/facts.ts` | list row, reader |
| Order and filter of the list | `ui/src/lib/state/filter.ts` | funnel menu, filter line, reset, harness |
| Icons (meaning to glyph) | `ui/src/lib/icons.ts` | `Icon.svelte`, every icon position |
| Views of the sidebar (name, icon, key) | `ui/src/lib/views.ts` | sidebar, keys |
| Keys | `ui/src/lib/input/keys.ts` (per-OS conventions: `keyConventions()` in `lib/platform.ts`) | `input.ts`, menus, tooltips, the card of the keys, Einstellungen |
| Toasts (kinds, life) | `TOAST_KINDS`, `TOAST_LIFE` in `ui/src/lib/state/toasts.svelte.ts` | `Toast.svelte` |
| Hover, press, focus | one answer per surface kind in `tokens.css` | every control |
| Screens as tables | `features/jobs/reader-sections.ts`, `features/settings/cards.ts`, `features/overview/blocks.ts`, `features/first-run/steps.ts`, `features/profile/rows.ts` | their views |
| Texts | `ui/src/lib/i18n/de.ts` (`en.ts` mirrors it) | every text the UI shows |
| Commands | `src-tauri/commands.txt` | `generate_handler!`, capabilities, `commands.ts`, the stub |
| Profile criteria | `CRITERIA` in `core/src/profile/form.rs` | form, engine, `profile.ts` |
| Excel columns | `COLUMNS` in `core/src/export/xlsx.rs` | the Excel file |
| Match bands | `HIGH_FROM`, `MID_FROM` in `core/src/model.rs` | store, report, prompts, `bands.ts` |
| Portals | `PORTALS` in `core/src/portal/` | settings, UI (`portals.ts`), mail, fetch |
| Defaults of the settings | `AUTO_*` in `core/src/settings.rs` | `settings.ts`, Einstellungen |
| Error codes | `ErrorKind` in `core/src/error.rs` | `ErrorKind.ts`, `t.error` |
| Engine words | `core/src/matching/lexicon/` | the engine |

## Data flow

mail, store, engine, view, UI:

1. `mail/` reads the alert mails of the portals that are on (IMAP); `portal/` turns them
   into job links.
2. `store/` keeps jobs, pages and the user's marks; `fetch/` asks `admit` (policy.json)
   before every request and stores the page.
3. `matching/` scores every job against the profile (pure, integers, `ENGINE_VERSION`); the
   store keeps the assessment. `export/` writes the files at the end of a run.
4. `view.rs` shapes the view types (`AppState`, `JobView`, `OverviewStats`, ...); commands
   return them, runs report `RunEvent`s over a channel (each under 8 KB).
5. The UI calls `invoke(name, args)` of `api.ts`, typed by `commands.ts`; a store of
   `lib/state/` holds the answer; features render it.

## Errors

- The backend sends codes, never words: an error is `ErrorInfo { kind, params }`
  (`core/src/error.rs`), a notice or a status the same (`{code, params}`).
- `api.ts` turns a failed `invoke` into an `IpcError(kind, params)`.
- The UI shows `errorText(error)` (`lib/i18n/texts.ts`), which reads the catalog
  (`t.error.text`); anything else reads as `unknown`. Never `error.message` (ESLint), never an
  empty catch (ESLint). Uncaught errors go to the log through `reportUiError`.
- An error shows where it happened: in its block, its row, its dialog (which keeps its reason
  inside and tries again).

## State and loading

- A store is a class with `$state` fields, one instance, in `lib/state/<concern>.svelte.ts`;
  a screen's own model sits in its feature (`features/overview/model.svelte.ts`).
- Loading has `loading`, `error` and `slow`; `slow` turns on skeletons only after
  `--dur-fast`, so a quick answer never flashes placeholders (`lib/state/app.svelte.ts`).
- Numbers come from the backend (one truth). The page moves them at once for its own changes
  and loads again after a run.
- Rows are plain objects (`$state.raw`) replaced on change, so only that row renders again.

## Generated files

Never edited by hand; committed together with their source.

| Files | From | Written by | Stale fails |
|---|---|---|---|
| `ui/src/lib/ipc/types/*` (PascalCase: IPC types; `bands`, `portals`, `settings`, `profile`: values) | core types (ts-rs) | `cargo test -p jobalert-core ipc_types` | the same test |
| `ui/src/lib/ipc/types/commands.ts` | `src-tauri/commands.txt` | `cargo test -p jobalert-core --test contract` | `contract.rs` |
| `src-tauri/capabilities/main.json`, the app manifest | `commands.txt` | `src-tauri/build.rs` (any build) | `contract.rs` |
| `core/src/export/palette.rs`, `tools/palette.json`, `backgroundColor` of `tauri*.conf.json` | `tokens.css` | `npm run regen` (`tools/tokens.mjs`) | `check:tokens`, `core/tests/palette.rs` |
| App icons, `ui/src/assets/app-icon.svg` | `tools/palette.json` | `npm run regen` (`tools/icon.py`) | `core/tests/icon.rs` |

## Guardrails

Every rule fails a gate (`npm run check`, `cargo test --workspace`, CI) and its message names
the rule and the fix.

| Rule | Where |
|---|---|
| Tauri only in `lib/ipc/api.ts`; Lucide only in `Icon.svelte`; motion only in `lib/motion/`; input listeners only in `input.ts` | `eslint.config.js` (doors), `core/tests/ui_contract.rs` |
| Values only from tokens: no colour, px, ms outside `tokens.css` | `stylelint.config.js`, `eslint.config.js`, `core/tests/palette.rs` |
| Raw controls only in `components/`; no inline style, no `title`, no `{@html}` | `eslint.config.js`, `ui_contract.rs` |
| Layering: components never import features; lib neither components nor features; a feature no other feature's internals | `tools/architecture.mjs` (`check:architecture`) |
| A `.ts`/`.svelte` file of `ui/src` stays at 500 lines (known large files: a ceiling that only goes down) | `tools/architecture.mjs` |
| No dead file, no unused export in `ui/src` and `tools/ui-harness` | `tools/architecture.mjs` |
| UI text only from the catalog; the catalogs plain, English without German | `ui_contract.rs`, `core/tests/language.rs` |
| Errors only through `errorText` | `eslint.config.js` (`errorMessage`) |
| Per-OS code only in `lib/platform.ts` and `src-tauri/src/platform.rs` | `ui_contract.rs`, `core/tests/architecture.rs` |
| Commands declared once | `core/tests/contract.rs` |
| Generated files current | see above |
| Settings of every version load without loss | `core/tests/settings_compat.rs` |
| Database of every version migrates (schema chain, backup first) | `core/src/store/schema.rs` tests, `core/tests/existing_data.rs` |
| TXT files byte-identical | `header_is_exactly_the_contract`, `txt_is_blind_to_the_match` |
| Icons by meaning, one glyph per meaning; one keys table; toasts only through the toast API; one tooltip; two button heights; one answer per surface kind | `ui_contract.rs` |
| At most one primary button per view | `ui_contract.rs` |
| A flaky test fails the run | CI: `--fail-on-flaky-tests` |

Exceptions stand in the rule with a reason. Temporary ones (`TEMPORARY` in
`tools/architecture.mjs`) carry a TODO and fail once their finding is gone. Where a new rule
goes: [docs/CHANGING.md](CHANGING.md#where-a-new-rule-goes).
