# Memory

Project facts a new session needs beyond `CLAUDE.md`. How the owner works with Claude is in his
`~/.claude/CLAUDE.md`; the current state and the next steps are in the session handoff (Claude's
project memory, `handoff`), the one place for them. Keep this file short: replace what changes.

## The owner and CXact

- Judges the app by looking at it: the live preview (`tools/ui-preview.cmd`, his desktop shortcut,
  http://localhost:5178) and the built app, which he starts himself (`tools/portable.cmd` builds it).
- Engine rules: fair and rather optimistic like a good consultant; what an ad does not say never costs
  points; every point of the number is explained (`docs/MATCHING.md`, the rubric `core/src/export/ai_rubric.de.md`).
- The search already pages deeply (`docs/PLAN.md` "Sources", deep search). On 2026-10-02 the owner was told by
  mistake that only the first page is read. Correct that when the search comes up.

## Gates

- Gates decide by exit code: run `cargo fmt --all --check` before every commit, and never commit after a gate
  chained with `;`.
- The Windows dynamic port range is 10000-65535 (set by the owner on 2026-11-22), so the harness runs at its
  default workers, also beside a dev server.

## Environment

- macOS is checked only through the `macos-latest` CI runner.
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
