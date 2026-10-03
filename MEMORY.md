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

- Fast and lean at full quality. Do what pays off and skip the rest: no long read-only exploration before
  building, no repeated test runs, no audits except for data safety, security and backend removals.
- For a look or layout question, show a visual draft first: real screenshots of the stub UI with token or
  CSS overrides, or exact mockups with the app's tokens, Inter and Lucide. Show today next to the proposals.
  Then ask one round of questions (AskUserQuestion) with one recommendation, and build right after the
  answer. No value tables, they do not help.
- Small UI changes (text, colour, spacing, an icon): edit directly, run the affected specs in Chromium,
  refresh the preview.
- Gates decide by exit code. Run `cargo fmt --all --check` before every commit, and never commit after a
  gate chained with `;`.
- Before a push, run the full harness once in both engines (`npm run harness`), with no dev server running
  beside it. Two at once once failed with `ERR_NO_BUFFER_SPACE`.
- A flaky test is fixed the same day, never retried. CI fails a test that passes only on its retry.
- Report at milestones, in a few lines. Give honest durations. Say plainly when an earlier answer was wrong.
- Refresh `.preview/` (`npm run preview:refresh`) only when a block is finished and green, then say to reload it.

## State (2026-10-03)

- `main` is green on CI (Windows and macOS, both harness engines). The portable builds of 2026-10-02 are in
  `target/portable/` of the old folder: `CXact.exe` and `CXact Demo.exe`.
- The search already pages deeply. Up to 24 terms come from the profile (`profile::deep_search_terms`).
  Each term is paged while new jobs come, up to 10 pages on Hays, freelancermap, Michael Page and GULP. A
  cut-short paging resumes at the next fetch within 7 days. A title pre-score orders the fetch. Caps are
  300 an hour and 1,500 a day per search source, at 2.5 to 5 s, never below a robots.txt Crawl-delay.
  On 2026-10-02 the user was told by mistake that only the first page is read. Correct that when the search
  comes up.

## Environment

- Windows dev PC: Git Bash, PowerShell 5.1, Python as `py -3.14`. macOS is checked only through the
  `macos-latest` CI runner.
- After a fresh clone:
  - `git config core.hooksPath .githooks`, then `npm ci`. The Rust toolchain comes from
    `rust-toolchain.toml`.
  - Copy `core/tests/fixtures/private/` by hand from the old folder if needed. It holds the real alert mails
    and pages, is ignored by git, and the tests that need it skip without it.
- `.claude/launch.json` holds the two preview servers:
  - `ui-preview`: the copy in `.preview/` on 5178.
  - `ui-dev`: Vite with the stub on 5179, for drafts and checks.
- The app's data (SQLite, settings, sessions) lives in the OS app data folder. The Gmail app password lives in
  the OS keychain. A new clone touches neither.
