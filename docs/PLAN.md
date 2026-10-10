# CXact: the product, its decisions and the next steps

The state of 2026-10-03. This file says what CXact is and does, the decisions that hold, and what comes next.
Tick the boxes under "Next" as the work lands, and replace a decision when the user changes it. Older
history is in git, read it only when a question needs it. How to change a part is in `docs/CHANGING.md`,
the layers in `docs/ARCHITECTURE.md`, the engine in `docs/MATCHING.md`, how to work with the user in
`MEMORY.md`.

## What CXact is

A desktop app for Windows and macOS (Tauri 2, a Rust core, a Svelte 5 UI) for an interim manager or a
freelance consultant. It finds jobs and scores each one against the consultant's profile.

The fetch runs only when the user presses "Jobs suchen" (one run, `RunKind::Fetch`):
- With a connected mailbox (Gmail, iCloud, GMX or WEB.DE) it first reads the job alert mails of LinkedIn
  and freelance.de (read-only IMAP, the password in the OS keychain), since the last fetch, the first one
  30 days back. A mailbox that fails (the server, the keychain) only skips this part; the run says so
  (`RunSummary::mail`).
- Then it searches the sources that allow it itself, with terms derived from the profile.
- It is refused without a usable profile (`profile::missing_required`), then with nothing to read.

Every new job's ad is fetched and scored by the matching engine. The list sorts by match, date or day rate.

## Sources

- Searched by the app: Hays, freelancermap, Michael Page, SOLCOM, GULP, Amadeus Fire, interim-x, FRATCH.
  Their public search, as their robots.txt allows (read at run time, kept a day in `policy.json`).
- By alert mail: LinkedIn and freelance.de. A job link of any other source in an alert mail is read too.
  LinkedIn is never searched or scraped beyond the links in the user's own alert mails.
- Every source can be switched off (Einstellungen > Suche, Postfach). freelance.de can sign in through its
  own window (`session.rs`), so the fetch reads ads that need a sign-in.
- Deep search: up to 24 terms from the profile's core alone (`profile::deep_search_terms`: Wunschrollen
  with the other names of the engine's role table, the role's own field kept (`Project Manager Customer
  Service`, never a bare `Project Manager`), and their ESCO occupation's German and English name;
  the names job boards give the field the roles lie in (the domain pack's `search`: `Kundenservice`,
  `Contact Center`, `Call Center`); Kompetenzen in the profile's order, those of that field first; Tools.
  A competence or tool the engine finds too broad to search alone, such as Projektmanagement,
  Automatisierung or SAP, stays out). Term learning (`fetch::terms`): a term whose last 3 runs brought no
  fitting job is set aside and the next of the profile's terms takes its slot; it comes back after 30 days
  or when the profile's terms change ("CXact sucht nach" lists the active terms). Each term is paged while new jobs come, up to 10 pages on Hays,
  freelancermap, Michael Page and GULP, each asked for the newest first (so a page without new jobs ends a
  term safely), and never past its last page: one that repeats the page before, or on freelancermap the
  page that completes its result count or a short page the count puts last. A cut-short paging resumes at
  the next fetch within 7 days.
  SOLCOM, interim-x and FRATCH list all their projects; the app filters them. Amadeus Fire, interim-x and
  FRATCH (one list whatever the terms) keep only the titles whose pre-score reaches `PRESCORE_FLOOR`
  (measured on the held-out sets: no high-band job below it). A title pre-score that knows the target
  roles orders what is fetched first; one run reads at most half a searched source's daily cap of ads
  (`fetch::run_budget`), the titles that fit least wait for a later run.
- A source filters only by contract type: Hays to the one type a profile allows alone (Contracting,
  Festanstellung or Arbeitnehmerüberlassung; its robots.txt refusing that page, the term goes without the
  filter). Michael Page's tiles and Amadeus Fire's addresses tell a hit's contract (interim and projects,
  else permanent): the search keeps the types the profile allows (`portal::Contracts::allows`). GULP's `projectTypes` name where a project comes from, not its contract: no filter. No remote or country
  filter. A source whose robots.txt refused every page reports it instead of "ok" with no jobs.
- The screen before any ad (`pipeline::score::screen`): a new job whose title alone the engine excludes
  (an exclusion word, Zeitarbeit the profile does not allow) is kept as excluded without its ad; "Trotzdem
  bewerten" reads it. A place, a junior level or Festanstellung never screen a job out.
- What each term brought per source is kept (`fetch::search::term_yields`) for the term learning inside the
  app (`fetch::terms`); the interface shows no terms.
  `core/examples/live_search.rs` runs a real search with fetch and scores and compares two term lists.
- The pace, within the scraping rules of `CLAUDE.md` (`admit`, `fetch/policy.rs`): search sources run at
  2.5 to 5 s, capped at 300 an hour and 1,500 a day each, never below robots.txt's Crawl-delay. A
  robots.txt that answers another 4xx than 401, 403 or 429 counts as none (RFC 9309); one that moved is
  followed through up to five redirects (each through `admit`), of a large one the first 512 KiB count,
  and one that cannot be read otherwise lets the source ask no page in that run. A 401 is a login
  wall; the same 4xx on three ad pages in a row stops a source for the run, only the first ad charged.
- Rejected for good: jobs.ch, karriere.at, eFinancialCareers and StepStone (their terms forbid automated
  access); Robert Half and Etengo (almost no interim or project roles); web search APIs; the Bundesagentur.
- Jobs that several sources bring merge into one (`dup_of`); "Gefunden" names every way it came.

## Matching

The engine (`core/src/matching`, pure, synchronous, integer only, `ENGINE_VERSION` 19) reads the profile
(Profil-JSON v19 through its typed form, `core/src/profile/form.rs`) and the ad:
- **Exclusions:** contract types (Zeitarbeit, Festanstellung), exclusion words, countries, the minimum day
  rate, permanent-role rules.
- **Requirements:** must-haves and optional ones, each met, partly met or not met against the
  competences, tools, languages, degrees, certificates and years of experience. Every competence counts
  the same: no Schwerpunkte (the owner's decision of 2026-10-10, engine 20).
- **The rest:** target roles and wishes (rate, work mode, regions, availability,
  workload, duration).
- **Words:** its own (a core and domain packs, German and English) and ESCO under them, the EU
  classification of occupations, skills and knowledge.

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
    - Können: Kompetenzen (no stars, every one counts the same), Werkzeuge, Stichworte, Stärken.
    - Erfahrung: years, Branchen, Sprachen, Abschlüsse, Zertifikate.
    - Ausschlüsse: words, Zeitarbeit, Festanstellung and its rules.
  - A new profile looks for projects only: Festanstellung and Zeitarbeit are off, so Mindestgehalt is hidden
    (`ProfileForm::default`).
  - Under some fields, "Häufig verlangt": the terms the recent jobs ask for that the profile lacks, one click
    adds them.
  - Save bar with Speichern and Verwerfen; leaving with changes asks. One profile,
    `profil/beraterprofil.json` in Profil-JSON v19 (flat German keys, `core/src/profile/form.rs`), with one
    backup; a save applies what the user changed to what the file holds by then, in every list. The last
    file that did not read and was replaced by a save stays as `beraterprofil.unlesbar.json` until a reset.
- **Einstellungen**, on tabs like the Profil:
  - Suche: the eight search sources, each a compact row with its tile, the calls of today, open in the
    browser and a switch.
  - Postfach: the account card (mail tile, the address, "Verbunden" after a green dot, Ändern, Entfernen),
    under it the card of the alert sources (sign-in where offered, then "Alert anlegen").
  - Daten: the profile's folder (Ändern with `pick_workspace`, Öffnen; `Documents\CXact` until another is
    chosen, `settings::default_workspace`) and "Alle Daten zurücksetzen".
- **Erste Schritte** (until the setup is finished, `Settings::onboarded`, saved by `finish_onboarding`; a
  reset brings it back): 1 Profil, 2 Postfach (optional, only the alert mails need it), 3 Fertig.
- **Shell:**
  - The top bar, the sidebar and Zurück and Vor as `CLAUDE.md` says. The sidebar has Jobs, Profil and
    Einstellungen. Zurück and Vor also walk the tabs of Profil and Einstellungen.
  - The app's own menus, toasts (at most three, bottom right) and tooltips.
  - A start whose data cannot load offers to restore a daily copy of the database.
- **Dry run:** `--dry-run` changes nothing outside its own data.

## Decisions that hold

- **Look:**
  - One palette, CXact (cream window, white sheet, the coral #E67A5C of the icon and cxpertise.de
    for what acts or is new, a richer cxpertise navy 212 50% 36% for headings, what is chosen, links and
    focus). No light or dark theme.
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
- **Controls:** one button height, 28 px (only a button inside a field is lower). Menus open from a chevron
  button.
- **Texts:** the rules in `CLAUDE.md`. The fetch's words are "Jobs suchen" and "Alert-Mails lesen"; the
  first place is "Aktuell".
- **Data:** SQLite in the OS app data folder, one schema. A database of any other schema is refused
  before anything is written: the start shows the load error (rename the file, the app makes a new
  one). The app writes no files of jobs; its work folder holds the profile.
- **Mailbox:** Gmail, iCloud, GMX and WEB.DE; no Outlook. The provider is chosen with the mailbox and
  kept in the settings (`Settings::mail_provider`), address and password in the OS keychain. Gmail and
  iCloud take an app password, GMX and WEB.DE the account password, once IMAP is allowed in their web
  mailer (a refused sign-in there says `allowImap`). Gmail is searched in All Mail with its own search;
  the others with standard IMAP in the inbox and the folders marked as archive or all mail, from the
  portals' senders, a copy counted once by its Message-ID (`core/src/mail/imap.rs`). "Alert-Mail öffnen"
  opens Gmail's link; a mail of the others opens in the app as the store keeps it (`alert_mail`).
- No backward compatibility until the owner declares the project finished (2026-10-10).
- **IPC:** the types come from Rust (ts-rs, `core/src/view.rs`), the commands from `src-tauri/commands.txt`
  (`docs/CHANGING.md`).

## Platforms (documented differences only)

Inside the window both OS show the same app. They differ by OS convention, decided in
`ui/src/lib/platform.ts` and `src-tauri/src/platform.rs`:
- **The top bar:** Windows draws its caption buttons, macOS keeps the native traffic lights (`CLAUDE.md`).
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

One word per thing, checked for the catalog (`ui_contract.rs`) and the Rust texts (`rust_texts.rs`):
- Job, Jobansicht, Seitenleiste
- Aktuell (the place of the active jobs, `inbox` in code), Neu (unread)
- Archiv, Zurückholen (out of the Archiv)
- Papierkorb, Löschen, Endgültig löschen, Wiederherstellen
- Übereinstimmung (Hohe, Mittlere, Geringe)
- Quelle, Suche, Alert-Mails
- Jobs suchen, Alert-Mails lesen, Abruf
- bewerten, neu bewerten
- Ausgeschlossen, Trotzdem bewerten
- Anforderungen, Pflicht, Optional
- Erfüllt, Teilweise erfüllt, Nicht erfüllt
- Jobdetails, Gefunden
- Anzeige (öffnen), Prompt kopieren
- Postfach, Alert-Mail, Alert anlegen
- Profil, Wünsche, Können, Erfahrung, Ausschlüsse
- Kompetenz, Werkzeuge und Methoden
- Wunschrolle, Suchbegriffe
- Tagessatz, Mindesttagessatz, Gehalt
- Festanstellung, Zeitarbeit
- Vertragsart, Arbeitsmodell, Remote-Anteil
- Auslastung, Laufzeit, Einsatzländer
- Einstellungen, Daten, Arbeitsordner
- Aufrufe, Anmelden, Abmelden
- Probelauf

## Next

Asked by the user on 2026-10-02. Start with drafts for the visible points, decide them in one round, then
build.

- [ ] Wire the new interface (branch `ui-preview`, design round 6, finished 2026-10-11). It already uses
  main's generated types, `PORTAL_MONOGRAM`, the texts for `cv`, `project` and `noProject`, the new settings
  patch and profile save, and a stub in main's shape; its full harness passes in Chromium and WebKit. What
  the merge still needs:
  - Conflicts: `README.md`, `docs/{ARCHITECTURE,CHANGING,PLAN}.md` and `de.ts` (take ui-preview's `de.ts`).
  - `core/tests/matching_wishes.rs`: empty `TEXT_WITH_THE_NEW_UI`; drop the `ProfileWarningCode` row, then
    delete the UI's warning table, `PROFILE_KEY_FIELD`, `keyLabel` and `rawKeys`, the `permanentRegion`
    reason and criterion texts.
  - `core/tests/mailbox_slot.rs`: one `mailbox:` entry (the closing note is one string now).
  - The demo snapshot of engine 19 (`cargo test -p jobalert-core --test ui_demo_snapshot`): 17 specs in
    `list`, `reader` and `runs` pin engine-18 bands and counts and follow it; `demo/profile.json` through
    prettier; then `DEMO_FORM` can become `DEMO.profile.form`.
  - Backend and UI together, what the new interface never uses: `setup_url` and `OpenTarget::PortalSetup`
    (it is the home page anyway), `TWO_STEP_URL` and `OpenTarget::TwoStepPage`, the `activity` of the
    `closing` event, `ui/src/assets/app-icon.svg` in `tools/icon.py` and `core/tests/icon.rs`, the run's
    `status` events, `ProfileInfo.understood`, `MatchDetail.highlights` and a few count fields; the
    "Arbeitsordner" comments in `core/src/settings.rs`.
  - Then the full gates and harness, version 4.0.0, `tools/portable.cmd` and the installer (the user starts
    them).

- [x] Mailboxes beyond Gmail, the backend: `MailProvider` (gmail, icloud, gmx, webde), `save_mailbox`
  with `provider`, `Mailbox.provider`, `allowImap` on `mailAuth`, the standard IMAP search, the kept text
  of an alert mail and `alert_mail` (schema 10).
- [ ] Mailboxes beyond Gmail, the interface: the provider in the Postfach form (and the first run) and on
  the account card; "IMAP-Abruf erlauben" on `allowImap`; the password field's words per provider (Gmail
  and iCloud an app password, GMX and WEB.DE the password); "Alert-Mail öffnen" calls `alert_mail` when
  `JobMail.gmailUrl` is null and shows the mail in the app. Open: the provider pages of
  `OpenTarget::AppPasswordPage` (Google's only), and the grey rows of empty alert mails (`EmptyAlert`)
  open only in Gmail.
- [ ] An excluded or not yet scored job shows no analysis: no verdict icons in the Jobdetails, no
  Anforderungen; only the ad and "Trotzdem bewerten" until it is scored.
- [ ] No press shrink: pressing a button must not scale it (`Button.svelte`, `.btn:active:hover` with
  `--btn-press`). It looks odd on the small chevron buttons; drop it at least there, likely everywhere
  ("nothing deforms on press"). Check the open look of a menu button (`aria-expanded` keeps the wash).
- [ ] The job view's action buttons: the user dislikes their words and size. Drafts: shorter words,
  icon buttons with tooltips beside Archivieren and Löschen, or one text button and a "…" menu.
- [x] The list's date shows when a job came into CXact (`first_seen_at`), for the row, the order "Nach
  Datum" (the local day, then the newest mail, then the portal: `store/jobs.rs` `page_order`) and the
  filter "Neu seit".
- [ ] A leaner Profil (drafts; the backend has Profil-JSON v19 with its 19 fields since engine 19). Candidates:
  - Drop Suchbegriffe; the search derives its terms.
  - Drop the field Rolle; it repeats the profile's title, which is renamed in place.
  - Merge Stichworte into the Kompetenzen.
  - One Branchen field, plain chips without stars (engine 21: the industries are experience, no wish).
  - Perhaps Können as the first tab, the one block the profile needs.
- [ ] The search as one pipeline with the scoring: the queries from the whole profile, expanded through the
  engine's own lexicon (synonyms, role phrases, German and English), and the sources' own filters from the
  profile (freelance and interim when Zeitarbeit and Festanstellung are excluded, remote share, regions,
  the rate where a source filters it). Completeness over speed: longer pauses rather than fewer pages,
  still within each source's robots.txt and stops. Show in Einstellungen > Suche what CXact searches for
  and what each query brings. Measure before and after with the user's real profile: hits per source and
  term, the share of high matches, duplicates, known jobs it missed.
- [ ] freelancermap's further pages: in the live runs it answered page 2 (`pagenr=2` beside the query) with
  page 1 again for 21 of 24 terms. The search stops at that repeat now, but reaches no deeper there.
  Building the next page from the site's own paginator link (its island's `initialPagination` carries
  every filter beside `pagenr`) needs one manual look at page 2 in a browser first.
- [ ] Optional: a calmer "Gefunden" line in the Jobdetails; hide Jobdetails rows that only say "–".
- [ ] The release installers (`npx tauri build`, `docs/CHANGING.md` "Release a version"); the user
  starts them.
