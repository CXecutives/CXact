# Memory

What a new session needs to know about working on CXact with this user, beyond the rules in
`CLAUDE.md`. The product, its decisions and the open work are in `docs/PLAN.md`. Keep this file short
and current: replace what changes, drop what no longer holds.

## The user

- The product owner. Judges the app by looking at it: the live preview in the browser
  (`tools/ui-preview.cmd`, his desktop shortcut, http://localhost:5178) and the built app.
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
- The Windows dynamic port range is 10000-65535 (set by the user on 2026-11-22), so the harness runs at its
  default workers, also beside a dev server.
- Reports are a few lines. Say plainly when an earlier answer was wrong.

## State (2026-11-22)

- `main` holds the backend; `ui-preview` (worktree `.claude/worktrees/ui-preview`) holds the new UI, built against
  main's generated types of 2026-10-11. The engine is being rebuilt as an explainable percent fit (the
  Passungsgrad, branch `wt-percent`), measured on a private Claude-graded gold set (`private/bench/gold/`).
- The user changes the UI next. Connecting comes only after that (`CLAUDE.md` "Change and connect").
- Engine rules of the user: fair and rather optimistic like a good consultant; what an ad does not say never
  costs points; every point of the number is explained.
- The search already pages deeply (`docs/PLAN.md` "Sources", deep search). On 2026-10-02 the user was told by
  mistake that only the first page is read. Correct that when the search comes up.

## Environment

- Windows dev PC: Git Bash, PowerShell 5.1, Python as `py -3.14`. macOS is checked only through the
  `macos-latest` CI runner.
- The clone lives in `Documents\CXact`, the app's default work folder (`settings::default_workspace`).
  `profil/` and `auswertung/` are ignored by git.
- After a fresh clone (`CLAUDE.md` "Commands"), `core/tests/fixtures/private/` comes from the old folder if
  needed. The tests that need it skip without it.
- `.claude/launch.json` holds the two preview servers:
  - `ui-preview`: the live preview on 5178, the same as `tools/ui-preview.cmd` (`tools/preview.mjs`: Vite with
    the stub, from the UI worktree while it exists, else from `ui/`). No copy to refresh: a saved change shows.
  - `ui-dev`: Vite with the stub on 5179, for drafts and checks.
- The app's data (SQLite, settings, sessions) lives in the OS app data folder. The Gmail app password lives in
  the OS keychain. A new clone touches neither.
