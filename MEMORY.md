# Memory

What a new session needs to know about working on CXact with this user, beyond the rules in
`CLAUDE.md`. The product, its decisions and the open work are in `docs/PLAN.md`. Keep this file short
and current: replace what changes, drop what no longer holds.

## The user

- The product owner. Judges the app by looking at it: the preview in the browser
  (`tools/ui-preview.cmd`, http://localhost:5178) and the built app.
- Talk German with the user: short, plain, no jargon, no long lists of options. Everything in the repo stays
  English.
- Starts every exe and installer themselves. Build them (`tools/portable.cmd`), never start or install them.
- Wants a lean, clean, modern app that looks native and consistent, and asks often whether something is
  needed at all. What is not needed goes: code, texts and tests together, never hidden behind a flag.

## How to work

- Fast and lean at full quality: no long read-only exploration before building, no repeated test runs.
- For a look or layout question, show a visual draft first: real screenshots of the stub UI with token or
  CSS overrides, or exact mockups with the app's tokens, Inter and Lucide. Show today next to the proposals.
  Then ask one round of questions (AskUserQuestion) with one recommendation, and build right after the
  answer. No value tables, they do not help.
- Gates decide by exit code. Run `cargo fmt --all --check` before every commit, and never commit after a
  gate chained with `;`.
- Run the harness with no dev server beside it. Two at once once failed with `ERR_NO_BUFFER_SPACE`.
- Reports are a few lines. Say plainly when an earlier answer was wrong.

## State (2026-10-11)

- Design round 6 and the backend for the new UI are finished on two branches, not merged and not pushed:
  - `main` holds the backend. Its gates are green.
  - `ui-preview` (worktree `.claude/worktrees/ui-preview`) holds the new UI. It already uses main's generated
    types, and its full harness passes in Chromium and WebKit.
- The next step is the user's changes or the wiring: merge, then the checklist in `docs/PLAN.md` "Next", then build.
- Schema 8 (Block 0): the first start of a newer build resets the user's real data of schema 7. That covers jobs,
  backups, sessions and the Gmail entry; profiles are set aside as `profil.alt`. Tell the user before a build.
- The search already pages deeply (`docs/PLAN.md` "Sources", deep search). On 2026-10-02 the user was told by
  mistake that only the first page is read. Correct that when the search comes up.

## Environment

- Windows dev PC: Git Bash, PowerShell 5.1, Python as `py -3.14`. macOS is checked only through the
  `macos-latest` CI runner.
- The clone lives in `Documents\CXact`, the app's default work folder (`settings::default_workspace`).
  The user's installed 3.x app has its Arbeitsordner set elsewhere; from 4.0 the work folder cannot be
  changed. `profil/` and `auswertung/` are ignored by git either way.
- After a fresh clone (`CLAUDE.md` "Commands"), `core/tests/fixtures/private/` comes from the old folder if
  needed. The tests that need it skip without it.
- `.claude/launch.json` holds the two preview servers:
  - `ui-preview`: the copy in `.preview/` on 5178.
  - `ui-dev`: Vite with the stub on 5179, for drafts and checks.
- The app's data (SQLite, settings, sessions) lives in the OS app data folder. The Gmail app password lives in
  the OS keychain. A new clone touches neither.
