# CXact: the product, its decisions and the next steps

The state of 2026-10-03. This file says what CXact is and does, the decisions that hold, and what comes next.
Tick the boxes under "Next" as the work lands, and replace a decision when the user changes it. Older
history is in git, read it only when a question needs it. How to change a part is in `docs/CHANGING.md`,
the layers in `docs/ARCHITECTURE.md`, the engine in `docs/MATCHING.md`, how to work with the user in
`MEMORY.md`.

## What CXact is

A desktop app for Windows and macOS (Tauri 2, a Rust core, a Svelte 5 UI) for an interim manager or a
freelance consultant. It finds jobs and scores each one against the consultant's profile.

The fetch runs only when the user presses it, one of two ways the menu beside the button chooses (never
both; the search by default, `Settings::fetches_mail`):
- **"Jobs suchen"** searches the sources that allow it itself, with terms from the active profile.
- **"Alert-Mails lesen"** reads the job alert mails of LinkedIn and freelance.de from Gmail (IMAP, an app
  password in the OS keychain), since the last fetch, the first one 30 days back.

Every new job's ad is fetched and scored by the matching engine. The list sorts by match, date or day rate.

## Sources

- Searched by the app: Hays, freelancermap, Michael Page, SOLCOM, GULP, Amadeus Fire, interim-x, FRATCH.
  Their public search, as their robots.txt allows (read at run time, kept a day in `policy.json`).
- By alert mail: LinkedIn and freelance.de. A job link of any other source in an alert mail is read too.
  LinkedIn is never searched or scraped beyond the links in the user's own alert mails.
- Every source can be switched off (Einstellungen > Suche, Postfach). freelance.de can sign in through its
  own window (`session.rs`), so the fetch reads ads that need a sign-in.
- Deep search: up to 24 terms from the profile (`profile::deep_search_terms`: Wunschrollen, Schwerpunkte,
  the proposed or stored Suchbegriffe). Each term is paged while new jobs come, up to 10 pages on Hays,
  freelancermap, Michael Page and GULP. A cut-short paging resumes at the next fetch within 7 days.
  SOLCOM, interim-x and FRATCH list all their projects; the app filters them. A title pre-score that knows
  the target roles orders what is fetched first.
- Conservative and polite: every request goes through `admit` (`fetch/policy.rs`). Search sources run at
  2.5 to 5 s, capped at 300 an hour and 1,500 a day each, never below robots.txt's Crawl-delay. A source
  stops on 429, 999, 403, a captcha or a login wall. Captchas and 2FA are never bypassed.
- Rejected for good: jobs.ch, karriere.at, eFinancialCareers and StepStone (their terms forbid automated
  access); Robert Half and Etengo (almost no interim or project roles); web search APIs; the Bundesagentur.
- Jobs that several sources bring merge into one (`dup_of`); "Gefunden" names every way it came.

## Matching

The engine (`core/src/matching`, pure, synchronous, integer only, `ENGINE_VERSION` 18) reads the profile
and the ad:
- **Exclusions:** contract types (Zeitarbeit, Festanstellung), exclusion words, countries, the minimum day
  rate, permanent-role rules.
- **Requirements:** must-haves and optional ones, each met, partly met or not met against the
  competences, tools, languages, degrees, certificates and years of experience.
- **The rest:** Schwerpunkte, target roles and wishes (rate, remote share, regions, industries,
  availability, workload, duration).

It gives a score of 0 to 100 in three bands, or an exclusion with its reason. An excluded job can be
scored anyway ("Trotzdem bewerten"). Measured on a corpus and on held-out sets of invented ads
(`docs/MATCHING.md`). The copied AI prompt ("Prompt kopieren") hands a job, the profile and the engine's
pre-assessment to any AI chat for a deeper check.

## Screens

- **Jobs:**
  - The places Aktuell, Archiv, Papierkorb as tabs. The fetch with its way menu (a chevron) at the right,
    "Papierkorb leeren" in the Papierkorb.
  - The search over every word, and the funnel: the order Übereinstimmung, Datum or Tagessatz; the filters
    Quelle, Übereinstimmung and Gefunden (Heute, 7, 30 Tage).
  - One row height. A row holds the ring, the unread dot, the title, the company, the place, the pay and the
    date. Excluded jobs stand behind a divider.
  - The job view, right of the list or in place of it when narrow:
    - The head: the title, Archivieren and Löschen as icon buttons, close.
    - The ring with its band words, then the actions: "Trotzdem bewerten" for an excluded job, Anzeige
      öffnen, Alert-Mail öffnen (only for a job a mail brought), Prompt kopieren.
    - The Jobdetails table with the verdict icons, the Anforderungen (Erfüllt, Teilweise erfüllt, Nicht
      erfüllt; a missing term goes into the profile with a plus) and the ad's text.
  - Moves have an undo toast. Delete for good stays in the Papierkorb.
- **Profil:**
  - Several profiles, one active. The title's menu holds the profiles, Neues Profil, Duplizieren,
    Umbenennen (in the title) and Löschen. A new profile starts on a page with three ways: Leer anfangen,
    Datei hochladen, Prompt kopieren (the prompt has any AI hand back the profile as a file).
  - Name and Rolle under the title. The tabs:
    - Wünsche in groups with headings: Rollen und Suche, Tagessatz, Ort, Zeit, Branchen.
    - Können: Kompetenzen with Schwerpunkte as stars, Werkzeuge, Stichworte, Stärken.
    - Erfahrung: years, Branchen, Sprachen, Abschlüsse, Zertifikate.
    - Ausschlüsse: words, Zeitarbeit, Festanstellung and its rules.
  - Save bar with Speichern and Verwerfen; leaving with changes asks. Saving merges into the profile's
    JSON in the work folder (`profil/`), keeping unknown keys, with one backup.
- **Einstellungen**, on tabs like the Profil:
  - Suche: the eight search sources, each a compact row with its tile, the calls of today, open in the
    browser and a switch.
  - Postfach: the account card (mail tile, the address, "Verbunden" after a green dot, Ändern, Entfernen),
    under it the card of the alert sources (sign-in where offered, then "Alert anlegen").
  - Daten: the work folder (Ändern, Öffnen) and "Alle Daten zurücksetzen".
  - Darstellung (palette and language) is hidden for now (`LOOK_SHOWN`).
- **Erste Schritte** (until the first completed fetch): 1 Profil, 2 Postfach (optional, only the alert
  mails need it), 3 the first fetch in the words of its way.
- **Shell:**
  - One top bar like the Claude app's (`CLAUDE.md`). The sidebar has Jobs, Profil and Einstellungen; it
    docks or folds, folding by itself below 1100 px. Zurück and Vor walk the views, places, jobs and tabs.
  - The app's own menus, toasts (at most three, bottom right) and tooltips.
  - A start whose data cannot load offers to restore a daily copy of the database.
- **Demo and dry run:** `CXact Demo.exe` (`--features embedded-demo`) starts on a fresh demo folder with
  made-up jobs and asks no source. `--dry-run` changes nothing outside its own data.

## Decisions that hold

- **Look:**
  - One palette shown, CXact (cream window, white sheet, the coral #E67A5C of the icon and cxpertise.de
    for what acts or is new, a richer cxpertise navy 212 50% 36% for headings, what is chosen, links and
    focus). Light and Dark wait behind the hidden Darstellung.
  - Warnings and successes take the score rings' yellow and green for their signs and dots, their words
    stay ink.
  - Five ring colours from red to green by 20 points.
- **Icons:** Lucide only, by meaning (`ui/src/lib/icons.ts`, one glyph per meaning and one meaning per
  glyph). The stroke is 2 of 24 units, so it grows with the icon. Sizes: 15 px in the content and the top
  bar, 19 in the sidebar.
  - The top bar shows panel-left and panel-right at rest; under the pointer, the panel close or open glyph
    of what a click does. arrow-left and arrow-right.
  - In the job: Öffnen is the open book, Alert-Mails lesen the open envelope, Trotzdem bewerten the plain
    plus.
- **Controls:** one button height, 28 px (only a button inside a field is lower), at most one primary per
  view. Menus open from a chevron button. Motion stays at 180 ms or less, ease-out, no bounce.
- **Texts:** the rules in `CLAUDE.md`. German first (`de.ts`), English mirrors it (`en.ts`). The fetch's
  words are "Jobs suchen" and "Alert-Mails lesen"; the first place is "Aktuell".
- **Data:** SQLite in the OS app data folder (schema 7, a chain of migrations); the settings file stays
  readable across versions (`core/tests/settings_compat.rs`). No real users yet: old local data may be
  dropped with a new version. The app writes no files of jobs; its work folder holds the profiles.
- **IPC:** the types come from Rust (ts-rs, `core/src/view.rs`), the commands from `src-tauri/commands.txt`;
  the backend sends codes and params, never prose; run events stay under 8 KB.

## Platforms (documented differences only)

Inside the window both OS show the same app. They differ by OS convention, decided in
`ui/src/lib/platform.ts` and `src-tauri/src/platform.rs`:
- **The top bar:**
  - Windows: no native title bar. The app's caption buttons sit at the right, and the caption window of
    `platform.rs` moves the window and opens the system menu and the snap layouts. 36 px.
  - macOS: the native traffic lights 16 px in, centred. 44 px.
- **Dialog buttons:** Windows puts the action first; macOS puts cancel left and the action right.
- **Scrollbars:** Windows slim and styled, their room kept; macOS native overlay.
- **Middle-button autoscroll:** Windows only.
- **Words for OS things:** Explorer or Finder, Anmeldeinformationsverwaltung or Schlüsselbund.
- **Keys:** the command key (Strg or Cmd) and how keys are written. The back key (Alt+Left, or Cmd+[ and
  Cmd+Left; the mouse's back button on both).
- **The menu:** none, or a minimal App, Edit, Window.
- **Smaller differences:** a text field's menu, font smoothing, keychain or credential manager, session
  storage, reveal in folder.
- **Builds:** target Safari 17, so View Transitions, `@starting-style`, `scrollbar-gutter` and
  `content-visibility` are forbidden. Windows: NSIS per user, German installer. macOS: Apple Silicon only,
  ad-hoc signed, minimum 14.0.

## Glossary (UI)

One word per thing in both languages, checked for the catalogs (`ui_contract.rs`) and the Rust texts
(`rust_texts.rs`). English is plain British English ("email", never "mail"). German → English:
- Job → Job; Jobansicht → Job view; Seitenleiste → Sidebar
- Aktuell (the place of the active jobs, `inbox` in code) → Current; Neu (unread) → New
- Archiv → Archive; Zurückholen (out of the Archiv) → Move back
- Papierkorb → Trash; Löschen → Delete; Endgültig löschen → Delete forever; Wiederherstellen → Restore
- Übereinstimmung (Hohe, Mittlere, Geringe) → Match (High, Medium, Low)
- Quelle → Source; Suche → Search; Alert-Mails → Alert emails
- Jobs suchen → Search jobs; Alert-Mails lesen → Read alert emails; Abruf → Fetch
- bewerten, neu bewerten → score, rescore
- Ausgeschlossen → Excluded; Trotzdem bewerten → Score anyway
- Anforderungen → Requirements; Pflicht → Must-have; Optional → Optional
- Erfüllt, Teilweise erfüllt, Nicht erfüllt → Met, Partly met, Not met
- Jobdetails → Job details; Gefunden → Found
- Anzeige (öffnen) → Ad (Open ad); Prompt kopieren → Copy prompt
- Postfach → Mailbox; Alert-Mail → Alert email; Alert anlegen → Set up alert
- Profil → Profile; Wünsche → Preferences; Können → Skills; Erfahrung → Experience; Ausschlüsse → Exclusions
- Kompetenz → Skill; Schwerpunkt → Focus area; Werkzeuge und Methoden → Tools and methods
- Wunschrolle → Preferred role; Suchbegriffe → Search terms
- Tagessatz → Day rate; Mindesttagessatz → Minimum day rate; Gehalt → Salary
- Festanstellung → Permanent job; Zeitarbeit → Temporary agency work
- Vertragsart → Contract type; Arbeitsmodell → Work model; Remote-Anteil → Remote share
- Auslastung → Workload; Laufzeit → Duration; Einsatzländer → Countries
- Einstellungen → Settings; Daten → Data; Arbeitsordner → Work folder
- Aufrufe → Requests; Anmelden, Abmelden → Sign in, Sign out
- Probelauf → Dry run; Demo → Demo

## Next

Asked by the user on 2026-10-02. Start with drafts for the visible points, decide them in one round, then
build.

- [ ] An excluded or not yet scored job shows no analysis: no verdict icons in the Jobdetails, no
  Anforderungen; only the ad and "Trotzdem bewerten" until it is scored.
- [ ] No press shrink: pressing a button must not scale it (`Button.svelte`, `.btn:active:hover` with
  `--btn-press`). It looks odd on the small chevron buttons; drop it at least there, likely everywhere
  ("nothing deforms on press"). Check the open look of a menu button (`aria-expanded` keeps the wash).
- [ ] The job view's action buttons: the user dislikes their words and size. Drafts: shorter words,
  icon buttons with tooltips beside Archivieren and Löschen, or one text button and a "…" menu.
- [ ] The list's date shows when a job came into CXact (`first_seen_at`), for the row and the order "Nach
  Datum". Today it is the alert mail's date where there is one (`COALESCE(mail_date, first_seen_at)` in
  `store/jobs.rs` `page_order` and the row).
- [ ] A leaner Profil (drafts). Candidates:
  - Drop Suchbegriffe; the search derives its terms.
  - Drop the field Rolle; it repeats the profile's title, which is renamed in place.
  - Merge Stichworte into the Kompetenzen.
  - One Branchen field with stars for the wished ones, like the Schwerpunkte.
  - Perhaps Können as the first tab, the one block the profile needs.
- [ ] The search as one pipeline with the scoring: the queries from the whole profile, expanded through the
  engine's own lexicon (synonyms, role phrases, German and English), and the sources' own filters from the
  profile (freelance and interim when Zeitarbeit and Festanstellung are excluded, remote share, regions,
  the rate where a source filters it). Completeness over speed: longer pauses rather than fewer pages,
  still within each source's robots.txt and stops. Show in Einstellungen > Suche what CXact searches for
  and what each query brings. Measure before and after with the user's real profile: hits per source and
  term, the share of high matches, duplicates, known jobs it missed.
- [ ] Optional: a calmer "Gefunden" line in the Jobdetails; hide Jobdetails rows that only say "–".
- [ ] The release and demo installers (`npx tauri build`, `docs/CHANGING.md` "Release a version"); the user
  starts them.
