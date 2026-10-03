# CXact

A desktop app for Windows and macOS (Tauri 2, a Rust core, a Svelte 5 UI) that finds interim and freelance
jobs and scores each one against a consultant's profile.

## What it does

- **Jobs suchen** searches the public job search of Hays, freelancermap, Michael Page, SOLCOM, GULP,
  Amadeus Fire, interim-x and FRATCH. The terms come from the active profile. Each term is paged while new
  jobs come, within what each source's robots.txt allows.
- **Alert-Mails lesen** reads the job alert mails of LinkedIn and freelance.de from a Gmail mailbox
  (read-only IMAP; the Gmail app password is stored only in the OS keychain).
- Every new job's ad is fetched politely. Every source can be switched off, and each has its pauses and
  limits.
- Every job is scored locally against the profile by an explainable, integer-only rule engine:
  exclusions, must-have and optional requirements, focus areas, wishes.
- Jobs live in three places like mail: Aktuell, Archiv, Papierkorb. Nothing moves or empties itself.
- For a deeper look at one job, the app copies a prompt for any AI chat. It sends nothing to an AI itself.

## Install

**Windows:** run the NSIS installer (a per-user install, no admin rights). The build is unsigned, so
SmartScreen asks on the first start: *More info → Run anyway*. A portable build and a demo build come from
`tools/portable.cmd`.

**macOS:** open the `.dmg` (Apple Silicon, macOS 14 or newer). On the first start go to *System Settings →
Privacy & Security → Open Anyway*. The build is only ad-hoc signed, so the keychain asks again after an
update.

Builds are not published as releases; the CI workflow keeps the installer and the dmg as artifacts.

## First start

The app opens on Erste Schritte:
1. Create the profile in the Profil view: start empty, upload a file, or copy the prompt with which any AI
   writes the profile file from a CV.
2. Optionally connect the Gmail mailbox with an app password, needed only for alert mails.
3. Run the first fetch.

The app speaks German; English is built in and switched on in a later version.

## The profile

The Profil view edits the profile as a form, on the tabs Wünsche, Können, Erfahrung and Ausschlüsse.
Several profiles can live side by side in the work folder's `profil/`; the title's menu chooses the active
one, and every job is scored again with it.

Saving writes only the changed fields into the JSON file. It keeps every other key as it is and leaves the
previous version beside it. The keys are German; English keys are read too. A competence can carry an
`auch` list of alternative terms. Everything personal lives only in this file, never in the app or its
code.

## Privacy and sources

Everything runs locally. Jobs, ad texts, the database and the logs never leave the machine, except for the
IMAP connection to Gmail and the requests to the job sources themselves.

The mailbox is opened read-only: mails stay unread, and nothing is changed, deleted or sent. LinkedIn is
never searched; only the links in the user's own alert mails are opened. freelance.de can sign in through
its own window (off by default).

Every request goes through one policy: robots.txt read at run time, randomized pauses, hourly and daily
caps per source, and a stop on rate limits, blocks, captchas or sign-in walls, never bypassed.

## Development

The rules for working on the code are in `CLAUDE.md`. The product and its next steps are in
`docs/PLAN.md`, the layers in `docs/ARCHITECTURE.md`, where each kind of change goes in
`docs/CHANGING.md`, and the engine with its measurements in `docs/MATCHING.md`.

**Requirements:** the Rust toolchain pinned in `rust-toolchain.toml`, Node 22.12 or newer, npm. After a
clone: `git config core.hooksPath .githooks` and `npm ci`.

**Commands:**
```
npm run check          # svelte-check, eslint, stylelint, prettier, tokens, architecture
npx playwright install chromium webkit   # once, for the harness
npm run harness         # the Playwright UI harness (Chromium + WebKit)
tools/ui-preview.cmd    # the UI with demo data in the browser (http://localhost:5178)
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npx tauri build         # release bundles (NSIS on Windows, app and dmg on macOS)
tools/portable.cmd      # target/portable/CXact.exe and "CXact Demo.exe"
```

**Dry run and demo:** `--dry-run` starts the app without touching the real mailbox, sources or work
folder. The demo build starts on made-up jobs and asks no source.
