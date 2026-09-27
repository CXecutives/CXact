# CXact

Desktop app (Tauri 2 + Rust, Windows and macOS) that turns job alert mails into a scored,
searchable list of postings.

## What it does

Reads job alert mails from LinkedIn, freelancermap and freelance.de out of a Gmail mailbox
(read-only IMAP; the Gmail app password is stored only in the OS keychain). Fetches each
job's full posting page politely: every portal can be switched off individually, and each
has its own request limits and pauses. Scores every job locally against a consultant
profile with an explainable, integer-only rule engine. Nothing is sent to the cloud.
Writes an Excel workbook (`JobAlerts.xlsx`) and, if you want, a CSV file (`JobAlerts.csv`,
`;`-separated, UTF-8) with the same columns into the export folder (`Documents\CXact` unless
you choose another; Einstellungen > Export, where each file has its switch). Jobs live in three places like mail (Jobs, Archiv, Papierkorb);
nothing moves or empties itself. For a deeper look at one job the reader copies a prompt for
any AI chat, and the Profil names the terms the recent jobs ask for most that the profile
lacks ("Häufig verlangt").

## Install

**Windows:** run the NSIS installer (current-user install, no admin rights needed). The
build is unsigned, so Windows SmartScreen blocks it on first launch: choose
*More info -> Run anyway*.

**macOS:** open the `.dmg` (Apple Silicon only, macOS 14 or newer). On first start, go to
*System Settings -> Privacy & Security -> Open Anyway*. The build is only ad-hoc signed, so
the keychain also asks for permission again after every update.

Builds are not published as GitHub releases; download the current installer/dmg from the CI
workflow's artifacts.

## First start

Connect the Gmail mailbox with an app password, then create the profile in the **Profil**
view (as a form, or from a file, also one an AI wrote from a CV with the app's prompt), then press
**Postfach abrufen**. Which alert mails it reads is the **Zeitraum** menu beside that button:
since the last fetch (the default), the last 7 or 30 days, or all alert mails. The app
starts in German; Einstellungen > Sprache switches it to English at once (the button is then
Check mailbox).

## The profile

The Profil view edits the profile as a form. Saving writes only the changed fields into the
file, keeps every other key as it is and leaves the previous version next to it
(`profil/beraterprofil.json.bak`). "KI-Prompt für Profilanfertigung kopieren" copies a
prompt for the AI chat you use: with your CV attached, the AI asks what the CV cannot say and
writes the file `beraterprofil.json`, which "Aus Datei laden" puts into the form for review.
Several profiles can live
side by side in `profil/` (`beraterprofil.json`, `beraterprofil-2.json`, ...); the switcher in
the head of the Profil view chooses the active one, and every job is scored again with it.

The consultant profile is a JSON file with German keys (English keys are read too and kept
where they are), in the structure shown by
`core/tests/fixtures/matching/sample_profile_senior.json` (name, years of experience,
education, career stations, competences, and hard criteria such as minimum day rate or
allowed countries). A competence entry can carry an `auch` list of alternative terms that
count toward it. Allowed countries are ISO codes or country names ("DE" or "Deutschland"); a
value the app cannot read is shown at its field and is no rule. Everything personal about the
consultant lives only in this file, never in the app itself or its code.

## How matching works

The engine reads the posting text (must/nice/other sections, inline headings, requirement
sentences), splits requirements into AND/OR items, and matches each item against the
profile's competences and their `auch` aliases through a stemming/compound-aware ladder.
Hard criteria from the profile exclude a job only on clear wording: an excluded contract type
(temporary agency work, permanent employment), a country outside the allowed ones, a day rate
below the minimum, for permanent jobs a salary below the minimum or a place outside the
chosen places, a target profile below the wanted seniority, a formal requirement stated as
mandatory. Unclear wording and the start date become points to check. Schwerpunkte, target
roles and wishes move the score but never exclude. The final score
combines must/nice coverage with a relevance-weighted shrinkage estimate; jobs are banded
into high/mid/low, or marked excluded or unscorable. Details, formulas and the full
parameter set are in `docs/MATCHING.md`.

Measured on the synthetic corpus (58 invented ads, bands fixed before the engine work; the
current engine against the old one; in band = score inside the agreed band, distance = sum of
the distances to the band, Spearman = rank correlation of score and band):

| Profile | Jobs | In band, old | In band, new | Distance, old | Distance, new | Spearman, old | Spearman, new |
|---|---|---|---|---|---|---|---|
| fin (interim finance) | 58 | 26/58 | 56/58 | 613 | 11 | 0.66 | 0.87 |
| it (SAP/IT project lead) | 58 | 45/58 | 56/58 | 241 | 11 | 0.66 | 0.85 |
| senior (interim CFO) | 58 | 22/58 | 55/58 | 611 | 13 | 0.69 | 0.74 |
| sap (SAP FI/CO consultant) | 58 | 40/58 | 56/58 | 229 | 6 | 0.73 | 0.85 |

On eight held-out sets (invented ads with blind labels by independent agents, 192 to 960 pairs
each), NDCG@10 is 0.82 to 0.96, against 0.35 to 0.72 for the old engine. The sets were later
used to fix general gaps, so they are now regression gates (`core/tests/matching_heldout.rs`),
not an unseen measurement.

## Privacy and portals

Everything runs locally: jobs, full texts, the database and logs never leave the machine
except for the IMAP connection to Gmail and the HTTP requests to the job portals themselves.
The app sends nothing to an AI: the prompts it copies (one job, a profile from a CV) go only
where you paste them, and a job prompt carries the profile without name,
contact data and links. The mailbox is opened read-only: mails stay unread, and nothing is changed, deleted
or sent. No passwords are stored by the app except the Gmail app password, which lives in
the OS keychain (Windows Credential Manager / macOS Keychain).

Portal notes: LinkedIn postings are fetched through its public guest view without a
LinkedIn account, which sits in a grey zone under LinkedIn's terms of use. freelancermap
postings are fetched through its public project pages. freelance.de shows guests only a
teaser; signing in ("Anmelden" at freelance.de in Einstellungen > Portale) is off by default, because
freelance.de's crawling policy does not clearly permit signed-in scraping. Every portal can be
switched off; a portal that is on always loads the ads of its alert mails (there is no mode
that keeps only the mails). All portals are fetched conservatively: at most 100 pages a day
from each (counted from local midnight, as Einstellungen shows it) and 30 an hour from
LinkedIn, 40 from freelancermap, 20 from freelance.de, randomized pauses between pages, and an
automatic stop on rate limits, blocks, captchas or sign-in walls, never bypassed.

## Development

**Requirements:** the Rust toolchain pinned in `rust-toolchain.toml`, Node 22.12 or newer
(CI uses the current LTS), npm.

**Commands:**
```
npm ci
npm run check          # svelte-check, eslint, stylelint, prettier
npx playwright install chromium webkit   # once, for the harness
npm run harness         # Playwright UI harness (Chromium + WebKit)
npm run build           # builds the UI into ui/dist
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npx tauri build         # release bundles (NSIS on Windows, app/dmg on macOS), pinned Tauri CLI
target/debug/job-alert-monitor --dry-run --smoke --smoke-run   # debug smoke probe
cargo test -p jobalert-core --test matching_corpus -- --ignored report --nocapture
cargo test -p jobalert-core --test matching_heldout -- --ignored heldout_report --nocapture
```

**Project layout:**
- `core/` - `jobalert-core`: mail scanning, portal fetching, the matching engine, the profile
  form, storage and export; no UI code, no `unsafe`.
- `src-tauri/` - the thin app layer: Tauri commands, window and platform glue.
- `ui/` - Svelte 5 + Vite + TypeScript frontend.
- `tools/` - UI harness, evaluation scripts, icon generation.
- `docs/` - `PLAN.md` (project plan and decisions) and `MATCHING.md` (matching engine
  reference and measurements).

**Dry run:** `--dry-run` starts the app without touching the real mailbox, portals or work
folder, for trying out or screenshotting the UI.
