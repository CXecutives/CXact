# CXact: the product, its decisions and the next steps

The state of 2026-10-03. This file says what CXact is and does, the decisions that hold, and what comes next.
Tick the boxes under "Next" as the work lands, and replace a decision when the user changes it. Older
history is in git, read it only when a question needs it. How to change a part is in `docs/CHANGING.md`,
the layers in `docs/ARCHITECTURE.md`, the engine in `docs/MATCHING.md`, how to work with the user in
`MEMORY.md`.

## What CXact is

A desktop app for Windows and macOS (Tauri 2, a Rust core, a Svelte 5 UI) for an interim manager or a
freelance consultant. It finds jobs and scores each one against the consultant's profile.

The fetch runs only when the user presses it, one button, **"Jobs suchen"**, in one run:
- First it reads the job alert mails of LinkedIn and freelance.de from Gmail, when a mailbox is connected
  (IMAP, an app password in the OS keychain), since the last fetch, the first one 30 days back. A Gmail or
  keychain failure skips only this part, with a warning and "Postfach prüfen".
- Then it searches the portals that allow it itself, with terms from the profile.

Every new job's ad is fetched and scored by the matching engine. The list sorts by match, date or day rate.

## Sources

- Searched by the app: Hays, freelancermap, Michael Page, SOLCOM, GULP, Amadeus Fire, interim-x, FRATCH.
  Their public search, as their robots.txt allows (read at run time, kept a day in `policy.json`).
- By alert mail: LinkedIn and freelance.de. A job link of any other source in an alert mail is read too.
  LinkedIn is never searched or scraped beyond the links in the user's own alert mails.
- Every portal can be switched off (Einstellungen > Portale). freelance.de can sign in through its
  own window (`session.rs`), so the fetch reads ads that need a sign-in.
- Deep search: up to 24 terms from the profile (`profile::deep_search_terms`: Wunschrollen, Schwerpunkte,
  the proposed or stored Suchbegriffe). Each term is paged while new jobs come, up to 10 pages on Hays,
  freelancermap, Michael Page and GULP. A cut-short paging resumes at the next fetch within 7 days.
  SOLCOM, interim-x and FRATCH list all their projects; the app filters them. A title pre-score that knows
  the target roles orders what is fetched first.
- The pace, within the scraping rules of `CLAUDE.md` (`admit`, `fetch/policy.rs`): search sources run at
  2.5 to 5 s, capped at 300 an hour and 1,500 a day each, never below robots.txt's Crawl-delay.
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
  - The places Aktuell, Archiv, Papierkorb as tabs. "Jobs suchen" at the right, the view's one primary,
    with or without a mailbox; "Papierkorb leeren" in the Papierkorb. While it runs one line under the
    header ("Portale werden durchsucht, 3 von 8 fertig", under it "Bisher 12 neue Jobs") with a thin bar
    that never moves back, and a small spinner at Jobs in the sidebar. An empty Aktuell says "Noch keine
    Jobs"; after a search without a fitting job "Noch keine passenden Jobs gefunden" with "Profil
    öffnen"; the end toast says "Keine neuen passenden Jobs, n ausgeschlossen".
  - The search over every word, and the funnel: the order Übereinstimmung, Datum or Tagessatz; the filters
    Portal, Übereinstimmung and Neu seit (Heute, 7, 30 Tagen). The date is the day a job came into CXact
    (`first_seen_at`).
  - One row height. A row holds the ring, the unread dot, the title, the company, the place, the pay and the
    date. Excluded jobs stand behind a divider.
  - The job view, right of the list or in place of it when narrow:
    - The head: the title, Archivieren and Löschen as icon buttons, close.
    - The ring (its name in its tooltip) with its band words and an info symbol, then three text buttons
      that wrap: Anzeige öffnen, Alert-Mail öffnen (only for a job a mail brought), Prompt kopieren (only
      for a job with a score); "Trotzdem bewerten" before them for an excluded job.
    - The Jobdetails table with the verdict icons (a row with only "–" shows only where a verdict judges
      it; "Gefunden" quiet), the Anforderungen (Erfüllt, Teilweise erfüllt, Nicht erfüllt; a missing term
      goes into the profile with a plus) and the ad's text. An excluded job shows neither verdicts nor
      Anforderungen: its head says why.
  - Moves have an undo toast. Delete for good stays in the Papierkorb.
- **Profil:**
  - One profile. Without one, a page with two ways: Aus Lebenslauf ausfüllen (an AI evaluates the CV,
    the profile is saved at once) and Selbst ausfüllen (the empty form).
  - No title (the sidebar names the place); "Aus Lebenslauf ausfüllen" ends the first group's heading
    line. Once Speichern was pressed, the required fields still empty get a coral edge (focus stays
    navy) and the save bar names them ("Es fehlen noch …", core's `ProfileInfo.missing`), each a link
    that puts the caret into its field.
  - Four groups on one page (`sections.ts`; "Luftige Gruppen", design round 6), each field with its label
    above it:
    - Wunschjob: Wunschrollen, Vertragsart (check boxes, one stays), Wunschtagessatz, Mindesttagessatz,
      Mindestgehalt (with Festanstellung or Zeitarbeit).
    - Einsatz: Arbeitsmodell, Länder (DE, AT, CH first) and Regionen, Verfügbar, Auslastung and
      Mindestlaufzeit.
    - Qualifikation: Kompetenzen with years and up to five stars, Tools und Methoden, Berufserfahrung,
      Branchen with a star for the preferred ones, Sprachen with their level, Abschlüsse and Zertifikate.
    - Ausschlüsse: Ausschlusswörter.
  - Info symbols (one sentence each) only at Vertragsart, Mindesttagessatz, Länder, the stars of
    Kompetenzen, Ausschlusswörter, the app password and the match in the job view; a field has a hint or
    an info symbol, never both.
  - Under some fields, "Häufig verlangt": the terms the recent jobs ask for that the profile lacks, one click
    adds them.
  - Save bar with Speichern and Verwerfen; leaving with changes asks. Saving merges into the profile's
    JSON in the work folder (`profil/`), keeping unknown keys, with one backup.
- **Einstellungen**, one page in the groups of the Profil, every row a `SettingRow` (hairlines only
  between rows, every text button outlined with its glyph, the switch last):
  - Jobportale: "Suche und Alert-Mails" (the eight portals the app searches) and "Nur Alert-Mails"
    (LinkedIn and freelance.de with "Alert anlegen", freelance.de with its sign-in), each portal with its
    tile, its state line, open in the browser and a switch.
  - Postfach: the mailbox with Ändern and Entfernen, or "Kein Postfach" with Verbinden.
  - Daten: Profil-Ordner (Ändern, Öffnen) and "Alles zurücksetzen" (Zurücksetzen, asks first).
- **Setup** (`features/first-run`, until it was finished once, `onboarded`): a mode of the shell of its
  own, without the sidebar and the top bar's buttons, every switch of the view refused. Its steps from a
  table: Willkommen, Weg wählen (the CV or by hand), Upload (drop zone, "Wird von einer KI
  ausgewertet."), Auswertung (its failures in one sentence with their ways on), Prüfen und ergänzen (the
  Profil's form, "Weiter" saves), Alert-Mails (optional), Fertig ("Alles eingerichtet", "Zu den
  Jobs"). It resumes from what is stored; Enter is "Weiter"; usable at 480 x 360.
- **Shell:**
  - The top bar, the sidebar and Zurück and Vor as `CLAUDE.md` says. The sidebar has Jobs, Profil and
    Einstellungen. Zurück and Vor also walk the tabs of Einstellungen.
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
- **Controls:** one height, 28 px, for every button, field, choice of a few, menu row and sidebar entry (only
  a control inside a field is lower, 22 px). A choice of a few gives its options equal widths; the places keep
  theirs. Menus open from a chevron button.
- **Texts:** the rules in `CLAUDE.md`. The fetch's words are "Jobs suchen"; the first place is
  "Aktuell".
- **Data:** SQLite in the OS app data folder (schema 8, no migrations). A database of schema 1 to 7 is
  reset at the start like "Alle Daten zurücksetzen" (`reset::reset_outdated`): the database, `backups/`,
  the sessions and the Gmail entry go, the old profiles are set aside as `profil.alt`, `policy.json`
  stays, and the reset notice shows. The app writes no files of jobs;
  its work folder holds the profiles.
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
- Portal (never Quelle), Jobportale, Alert-Mails
- Jobs suchen, Suche (never Abruf)
- bewerten, neu bewerten
- Ausgeschlossen, Trotzdem bewerten
- Anforderungen, Pflicht, Optional
- Erfüllt, Teilweise erfüllt, Nicht erfüllt
- Jobdetails, Gefunden
- Anzeige (öffnen), Prompt kopieren
- Postfach, Alert-Mail, Alert anlegen
- Profil, Wunschjob, Einsatz, Qualifikation, Ausschlüsse
- Kompetenz, Schwerpunkt, Tools und Methoden
- Wunschrolle, Suchbegriffe
- Tagessatz, Wunschtagessatz, Mindesttagessatz, Gehalt
- Festanstellung, Zeitarbeit
- Vertragsart, Arbeitsmodell, Remote-Anteil
- Auslastung, Laufzeit, Einsatzländer
- Einstellungen, Daten, Arbeitsordner
- Aufrufe, Anmelden, Abmelden
- Probelauf

## Next

Asked by the user on 2026-10-02. Start with drafts for the visible points, decide them in one round, then
build.

- [x] An excluded or not yet scored job shows no analysis: no verdict icons in the Jobdetails, no
  Anforderungen; only the ad and "Trotzdem bewerten" until it is scored.
- [x] No press shrink: pressing a button must not scale it (`Button.svelte`, `.btn:active:hover` with
  `--btn-press`). It looks odd on the small chevron buttons; drop it at least there, likely everywhere
  ("nothing deforms on press"). Check the open look of a menu button (`aria-expanded` keeps the wash).
- [x] The job view's action buttons: the user dislikes their words and size. Drafts: shorter words,
  icon buttons with tooltips beside Archivieren and Löschen, or one text button and a "…" menu.
- [ ] The list's date shows when a job came into CXact (`first_seen_at`), for the row and the order "Nach
  Datum". Today it is the alert mail's date where there is one (`COALESCE(mail_date, first_seen_at)` in
  `store/jobs.rs` `page_order` and the row). The UI and the preview use `first_seen_at` already; core's
  order and filter follow.
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
- [x] Optional: a calmer "Gefunden" line in the Jobdetails; hide Jobdetails rows that only say "–".
- [ ] The release installers (`npx tauri build`, `docs/CHANGING.md` "Release a version"); the user
  starts them.
