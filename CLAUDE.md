# CXact (formerly Job-Alert-Monitor)

Desktop app (Tauri 2 + Rust, Windows and macOS) that finds interim and freelance jobs, by its own search of the
sources that allow it or from the user's job alert mails, fetches the job pages and **scores every job against a
consultant profile**, only when the user presses the fetch.
**What the app is and does, the decisions that hold and the next steps live in `docs/PLAN.md`: read the part the
task needs. How to work with the user is in `MEMORY.md` (imported below).**
The old app `CXecutives/projektscraper` is a read-only reference.

## Hard rules
- Never modify `CXecutives/projektscraper`. Push only to `origin` = `CXecutives/CXact` (formerly `Project`),
  fast-forward only; never bypass `.githooks/pre-push`; never force-push. The repo holds CXact only: no old code,
  branches or history.
- Secrets: never ask for, read, log, print or commit passwords. The mailbox password lives only in the OS keychain.
  The repo is public: no real mails, profiles or labels outside `core/tests/fixtures/private/` (ignored).
- Everything in the repo is English (code, comments, docs, logs, errors, tests, CI, commits). Exceptions are the
  modules marked `external contract - do not translate` (folder names, profile JSON keys, German mail patterns,
  matching lexicon, the German AI prompts) and the German UI catalog `ui/src/lib/i18n/de.ts`.
  `core/tests/language.rs` enforces it.
- UI: it must feel like a native app. One palette, CXact, defined only in `ui/src/styles/tokens.css`. The shell
  (a top bar and a sidebar like the Claude app's, drawn by the page on both OS): PLAN "Screens".
  Below the bar both OS show the same content; they differ only where the OS convention does (PLAN "Platforms",
  decided in `ui/src/lib/platform.ts` and `src-tauri/src/platform.rs` only).
- Input as in a native app (PLAN "Decisions that hold"), all of it in `ui/src/lib/input/input.ts`: controls react
  to the left click only; copyable text is marked `data-copy` and copies with Ctrl/Cmd+C, nothing else is
  selectable; fields behave like native fields. No browser context menu, zoom, reload, find or print.
- Styling only via tokens in `ui/src/styles/tokens.css`; controls only from `ui/src/components/`; Tauri only via
  `ui/src/lib/ipc/api.ts`; motion only via `ui/src/lib/motion/`. At most one primary button per view. Lint enforces
  it. Motion is quick and ease-out (at most `--dur-slow`, the ring's fill `--dur-reveal`), no bounce; nothing
  deforms on press.
- UI text (German only, `ui/src/lib/i18n/de.ts`): little text, only what is needed, plain and human. No AI-style
  writing: no dashes or em dashes as separators, no colons in labels or headings, no "X: Y" constructions, no
  filler, no exclamation marks, no emoji. Buttons are one verb phrase, notes one short sentence. The UI must not
  look AI-generated (no sparkles, no gradient text, no glow for decoration).
- The backend never sends prose: notices, errors and status are `{code, params}`; texts live in the UI catalog.
- Scraping stays conservative: links from the user's alert mails, and the public search of the sources that allow
  it (`Way::Search`, the terms derived from the profile), never more than their robots.txt allows (read at run
  time; every request of the searched sources). Every request through `admit` (policy.json), stop on
  429/999/403/captcha/login wall, never bypass captchas or 2FA. Every source can be switched off.
- Run events stay below 8 KB (Tauri channel messages above 8 KB bypass the ACL). async-imap logs LOGIN on trace:
  logger levels stay capped.

## Architecture
`docs/ARCHITECTURE.md`: the layers and their modules, one source per decision, data flow, errors, state,
generated files and the guardrails.

## Commands
- Start here: `docs/CODEMAP.md` (every file with its purpose; `npm run map` after adding, moving or renaming one,
  `--check` fails when it is stale). Helpers use the `cxact-builder` agent (`.claude/agents/`), which knows the rules.
- While working: `npm run affected` prints the checks the change needs; at the end of a block `npm run gate`
  (`--full` for everything) runs them at once with one line per step.
- After a fresh clone: `git config core.hooksPath .githooks` (the pre-push gate),
  `git config merge.regen.driver true` (a merge keeps this side's generated files), `npm ci`,
  `npx playwright install chromium webkit` (the harness); the Rust toolchain comes from `rust-toolchain.toml`.
- Generated files (IPC types, command map, demo snapshot and vocabulary, golden prompt, corpus digest, colours):
  `npm run gen` writes them all in one run (`tools/gen.mjs`); run it after a change of a code, a type or the engine
  and after every merge, then commit what it wrote.
- `cargo fmt --all --check` · `cargo clippy --workspace --all-targets -- -D warnings` · `cargo test --workspace --lib --tests` (no doc tests, examples only through clippy)
- `npm run check` (svelte-check, eslint, stylelint, prettier, tokens, `tools/architecture.mjs`) ·
  `npm run harness` · `npm run build`. On main the old `ui/`, its stub and specs are frozen until the
  new UI lands from `ui-preview` (connecting): there `check:types` checks only the CV worker.
- `npx tauri build` (release bundles) · `tools/portable.cmd` (`target/portable/CXact.exe`) · debug smoke:
  `target/debug/job-alert-monitor --dry-run --smoke --smoke-run`
- Colours: after a change to `tokens.css`, `npm run regen` rewrites the window and icon colours
  (`docs/CHANGING.md` "Change the look").
- The user reviews the UI in the live preview; keep it working: `tools/ui-preview.cmd` (the user's shortcut) and
  `ui-preview` in `.claude/launch.json` run `tools/preview.mjs` (Vite with the stub on 5178, from the UI worktree
  while it exists, else from `ui/`).
- Engine changes: `docs/CHANGING.md` "Add words to the engine".

## Workflow
- Small English commits, each green on its own. Docs only where they make the work faster (CLAUDE.md, CHANGING.md
  as the map of where a change goes); no doc duties per change. Parallel tracks work in their own worktree with
  disjoint files; shared files (`Cargo.toml`, `package.json`, `core/src/lib.rs`, `core/src/view.rs`,
  `src-tauri/src/commands/**`, `src-tauri/commands.txt`, `build.rs`, `capabilities/main.json`, `tauri*.conf.json`)
  belong to the integrator.
- Remove worktrees right after merging and run `cargo clean` there (disk).
- A flaky test is fixed or removed the same day, never retried (CI fails a test that passes only on its retry).
- macOS is verified through the `macos-latest` CI runner (`.github/workflows/ci.yml`) and WebKit locally.

## Change and connect (project rules)
Two kinds of work, both fast; the structure keeps them fast ("a tree needs roots"):
- **Change, add or remove** a function, rule, field, code or text inside the frontend or inside the backend: one
  source per decision, tables instead of wiring, and the change touches only the places `docs/CHANGING.md` names.
  When a small change needs edits in more than three places, fix the structure first (a table, a helper, a
  generated list), then make the change. What goes, goes whole: code, texts, tests and docs together.
- **Connect** frontend and backend only when both are finished. They meet only through the generated types and
  `ui/src/lib/ipc/api.ts`; the stub (`tools/ui-harness/stub.ts`) serves the same contract. A change to the
  contract updates the stub in the same block, so connecting stays a merge, not a rebuild.

## Speed and tokens (project rules)
Fast AND lean: as much as possible in the shortest time, without losing quality. The cost comes from extra work,
not from speed. So:
- Batch the checks: run the gates once at the end of a block, not after every step ("lieber alles auf einmal").
- Parallel tracks in worktrees made by hand from the current base (the workflow's worktree isolation starts from a
  stale base), disjoint files, one integrator who merges as soon as a track is done.
- Only what pays off. Decide before building (product questions in one round, with a recommendation), so nothing
  is built twice. Deliver what the user can see first (preview early), background work after.
- Small UI changes (text, colour, spacing, order, a fact, an icon): the main session edits directly, no subagent,
  no worktree, only the affected specs in Chromium, seen in the live preview; minutes, not hours.
- Subagents only for large, independent chunks with disjoint files and a precise brief. No review or audit agents
  except for data safety, security and backend removals; never confirmation audits.
- Verify where it is uncertain: cheap gates always (`npm run check`, clippy, Rust tests); UI specs of the changed
  area only; the full harness in both engines once before a push; never re-verify what is proven.
- One source per decision (`docs/ARCHITECTURE.md`); `docs/CHANGING.md` says where each kind of change goes.
- Tests check behaviour through shared helpers and read texts from the catalog; screenshot baselines run on request.
- Report at milestones only, state durations honestly beforehand, watch the plan's token use.

## Memory
@MEMORY.md
