//! User-facing text of the exported files in the app's two languages: every word the Excel
//! file and the HTML overview show. The interface has its own catalogs; these texts only end
//! up in files the user opens. They use the interface's words (glossary in `docs/PLAN.md`)
//! and its style rules - `core/tests/rust_texts.rs` checks both languages. The German words
//! stand at the top level, the English ones in [`en`] under the same names; [`Texts::of`]
//! picks by the app's language. The text files per job are no part of this: they stay
//! German (`job_txt.rs`, a contract with the matching skill).

use jiff::Timestamp;
use serde_json::{Map, Value};

use crate::model::KeyFacts;
use crate::settings::Language;
use crate::store::JobRow;
use crate::view::DetailState;

// User-facing text, German (the app's first language).

/// Name of the sheet with all jobs.
pub const JOBS_SHEET: &str = "Job-Alerts";
/// Name of the sheet with the run information.
pub const INFO_SHEET: &str = "Info";

/// Column headers of the Excel file: what decides first (title, match, musts, exclusion),
/// then who and where, the terms in the app's words, the user's marks, the dates, the links
/// and the job's key last. Unlike the text files nobody reads it by machine - so it says
/// "Portal" like the interface, not "Quelle" like the skill contract; "Ablage" is the place
/// (Jobs or Archiv).
pub const COLUMNS: [&str; 23] = [
    "Titel",
    "Passung",
    "Pflicht erfüllt",
    "Ausschluss",
    "Unternehmen",
    "Ort",
    "Tagessatz",
    "Satz laut Anzeige",
    "Start",
    "Laufzeit",
    "Auslastung",
    "Remote",
    "Vertragsart",
    "Portal",
    "Ablage",
    "Beworben am",
    "Notiz",
    "Favorit",
    "Details",
    "Datum",
    "Anzeige",
    "Alert-Mail",
    "Job-ID",
];

/// The link cells' words, the places of the sheet and the contract types (the reader's).
pub const LINK_AD: &str = "Anzeige öffnen";
pub const LINK_MAIL: &str = "Alert-Mail öffnen";
pub const PLACE_INBOX: &str = "Jobs";
pub const PLACE_ARCHIVE: &str = "Archiv";
pub const CONTRACT_INTERIM: &str = "Interim";
pub const CONTRACT_PERMANENT: &str = "Festanstellung";
pub const CONTRACT_ANUE: &str = "Arbeitnehmerüberlassung";
/// Why an excluded job the user counts anyway is in the list.
pub const OVERRIDDEN: &str = "Manuell einbezogen";

/// The health of a portal at the last fetch, a row of the info sheet each.
pub fn info_portal(label: &str) -> String {
    format!("{label} beim letzten Abruf")
}
pub const HEALTH_OFF: &str = "Ausgeschaltet";
pub const HEALTH_OK: &str = "Bereit";
pub fn health_paused(until: Option<&str>) -> String {
    match until {
        Some(at) => format!("Pausiert, ab {at} wieder möglich"),
        None => "Pausiert bis zum nächsten Abruf".to_owned(),
    }
}
pub fn health_quota(until: &str) -> String {
    format!("Limit erreicht, ab {until} wieder möglich")
}
pub const HEALTH_EMPTY_MAILS: &str = "Alert-Mails ohne Jobs";
pub const HEALTH_EMPTY_PAGES: &str = "Seiten ohne Beschreibung";
pub const HEALTH_LOGIN: &str = "Anmeldung nötig";

/// Label and warning of the last row of the info sheet. Not only a fetch writes the file: a
/// rescore, a details run and "Endgültig löschen" do too.
pub const INFO_NOTE_LABEL: &str = "Hinweis";
pub const INFO_NOTE: &str =
    "Die App schreibt diese Datei immer wieder neu, eigene Notizen gehen dabei verloren.";

/// Labels of the info sheet (the mail address is deliberately not among them). The mailbox
/// is "gelesen" like "Ganzes Postfach lesen" in the interface; "Abruf" is the whole run.
pub const INFO_LAST_SCAN: &str = "Postfach zuletzt gelesen";
pub const INFO_SCOPE: &str = "Umfang beim letzten Lesen des Postfachs";
pub const INFO_NEW: &str = "Neu beim letzten Lesen des Postfachs";
pub const INFO_KNOWN: &str = "Schon bekannt beim letzten Lesen des Postfachs";
pub const INFO_DUP: &str = "In mehreren Alert-Mails beim letzten Lesen des Postfachs";
pub const INFO_JOBS_TOTAL: &str = "Jobs gesamt";
pub const INFO_PROGRAM: &str = "Programm";
/// The app's visible name (the files, the keychain entry and the identifiers keep theirs).
pub const PROGRAM_NAME: &str = "CXact";

/// Scope of a mailbox scan in words.
pub const SCOPE_NEW: &str = "Neu seit dem letzten Abruf";
pub const SCOPE_ALL: &str = "Ganzes Postfach";

/// Words of the report (`JobAlerts.html`, "Bericht" in the app): the new matches by band
/// ("Neu und passend" like the day overview), the low ones as a count, then the favourites.
pub const HTML_TITLE: &str = "Bericht";
pub const HTML_PINNED: &str = "Favoriten";
pub const HTML_HIGH: &str = "Hohe Passung";
pub const HTML_MID: &str = "Mittlere Passung";
/// The low band's word (the report lists no low band; a favourite may be one).
pub const HTML_LOW_BAND: &str = "Geringe Passung";
/// The heading of the unread jobs by date, when no profile scores them.
pub const HTML_NEW_JOBS: &str = "Neue Jobs";
pub const HTML_CREATED: &str = "Erstellt am";
pub const HTML_EMPTY: &str = "Keine neuen passenden Jobs.";
pub const HTML_EMPTY_NEW: &str = "Keine neuen Jobs.";
/// Without a usable profile: the list's sentence in the app.
pub const HTML_NO_PROFILE: &str = "Ohne Profil gibt es keine Passung.";

/// The summary line: the new matches and how many of them fit well.
pub fn html_summary(total: usize, high: usize) -> String {
    let jobs = if total == 1 {
        "1 neuer passender Job".to_owned()
    } else {
        format!("{} neue passende Jobs", group(total, '.'))
    };
    if high == 0 {
        format!("{jobs}.")
    } else {
        format!("{jobs}, {} mit hoher Passung.", group(high, '.'))
    }
}

/// The legend of the bands: from which score a ring counts as high or medium.
pub fn html_legend_band(high: bool) -> String {
    if high {
        format!("Hohe Passung ab {}", crate::model::HIGH_FROM)
    } else {
        format!("Mittlere Passung ab {}", crate::model::MID_FROM)
    }
}

/// Under the bands: the new jobs with a low match, as a count.
pub fn html_low(count: usize) -> String {
    if count == 1 {
        "1 Job mit geringer Passung steht in der App.".to_owned()
    } else {
        format!(
            "{} Jobs mit geringer Passung stehen in der App.",
            group(count, '.')
        )
    }
}

/// Under a cut list of new matches: how many more the app lists.
pub fn html_more(count: usize) -> String {
    if count == 1 {
        "1 weiterer Job in der App.".to_owned()
    } else {
        format!("{} weitere Jobs in der App.", group(count, '.'))
    }
}

/// The must requirements a job meets, as the reader's head says it.
pub fn html_musts(met: u16, total: u16) -> String {
    if total == 0 {
        "Keine Pflichtanforderungen erkannt".to_owned()
    } else {
        format!("{met} von {total} Pflichtpunkten erfüllt")
    }
}
pub const HTML_MATCH: &str = "Passung";
pub const HTML_MET: &str = "Erfüllt";
pub const HTML_OPEN: &str = "Offen";
pub const HTML_EXCLUDED: &str = "Ausgeschlossen";
/// A job the user counts although the engine excludes it, like the reader says it.
pub const HTML_OVERRIDDEN: &str = "Manuell einbezogen";
pub const HTML_FAVOURITE: &str = "Favorit";
/// The mark of a job the last fetch brought.
pub const HTML_SINCE: &str = "Seit dem letzten Abruf";
/// Marks of the ad: it takes no applications, it is gone, only its start was readable, its
/// details are not there.
pub const HTML_CLOSED: &str = "Keine Bewerbung mehr möglich";
pub const HTML_GONE: &str = "Nicht mehr online";
pub const HTML_TEASER: &str = "Vorschau";
pub const HTML_NO_DETAILS: &str = "Details fehlen";
pub const HTML_UNSCORABLE: &str = "Nicht bewertbar";
/// A job not scored yet (also one that waits for its details), like the app's ring.
pub const HTML_NONE: &str = "Noch nicht bewertet";

/// The key facts of an ad in the app's words: `1.100 €/Tag`, `95 €/Std.`, `1.000 CHF/Tag`.
pub fn rate_words(amount: u32, hourly: bool, currency: Option<&str>) -> String {
    let money = match currency.filter(|c| *c != "EUR") {
        Some(code) => format!("{}\u{202f}{code}", group(amount as usize, '.')),
        None => format!("{}\u{202f}€", group(amount as usize, '.')),
    };
    if hourly {
        format!("{money}/Std.")
    } else {
        format!("{money}/Tag")
    }
}
pub const RATE_OPEN: &str = "Satz nach Absprache";

/// The remote share: `voll remote`, `vor Ort`, `60 % remote`, `60 bis 100 % remote`.
pub fn remote_words(from: u8, to: u8) -> String {
    if from >= 100 {
        "voll remote".to_owned()
    } else if to == 0 {
        "vor Ort".to_owned()
    } else if from == to {
        format!("{from}\u{202f}% remote")
    } else {
        format!("{from} bis {to}\u{202f}% remote")
    }
}

/// The duration: `1 Monat`, `6 Monate`.
pub fn months_words(months: u16) -> String {
    if months == 1 {
        "1 Monat".to_owned()
    } else {
        format!("{months} Monate")
    }
}

/// A start on a day: `ab 01.11.2026`.
pub fn start_from(day: &str) -> String {
    format!("ab {day}")
}

/// Why a job is excluded, by the code of its first violation (the list's `note`), in the
/// words of the interface's criteria. `None` for a code without a text: the overview then
/// says only "Ausgeschlossen" - never the code itself.
pub fn exclusion_reason(code: &str, params: &Map<String, Value>) -> Option<&'static str> {
    Some(match code {
        "dayRate" => "Der Tagessatz liegt unter dem Minimum im Profil.",
        "country" => "Der Einsatzort liegt außerhalb der Länder im Profil.",
        "anue" => "Die Anzeige nennt Arbeitnehmerüberlassung.",
        "permanent" => "Der Job ist eine Festanstellung, das Profil schließt sie aus.",
        "availability" => "Der Start passt nicht zur Verfügbarkeit.",
        "salary" => "Das Gehalt liegt unter dem Minimum im Profil.",
        "permanentRegion" => "Der Ort liegt außerhalb der Orte für Festanstellung.",
        "tooJunior" => "Der Job verlangt deutlich weniger Erfahrung.",
        "formalOpen" if licence(params) => {
            "Die Anzeige verlangt eine Zulassung, die das Profil nicht nennt."
        }
        "formalOpen" => "Die Anzeige verlangt einen Abschluss, den das Profil nicht nennt.",
        "hardCriterion" => "Ein Ausschlusskriterium greift.",
        _ => return None,
    })
}

/// State of the job details (see [`DetailState`]) in the words of the interface's badges
/// (`job.detail`, `job.closed`); a full text has no badge there and is "Vorhanden" here.
pub fn details_label(detail: DetailState, closed: bool, short: bool) -> &'static str {
    match detail {
        DetailState::Ok if closed => "Keine Bewerbung mehr möglich",
        DetailState::Ok if short => "Vorhanden (kurz)",
        DetailState::Ok => "Vorhanden",
        DetailState::Pending { .. } => "Details folgen",
        DetailState::OnRequest => "Details auf Anfrage",
        DetailState::Teaser => "Vorschau",
        DetailState::Failed { .. } => "Details fehlen",
        DetailState::Gone => "Nicht mehr online",
        DetailState::Unfetchable => "Nicht erreichbar",
    }
}
// end of user-facing text

/// The English words of the files, under the German names.
pub mod en {
    use serde_json::{Map, Value};

    use super::licence;
    use crate::view::DetailState;

    // User-facing text, English.

    pub const JOBS_SHEET: &str = "Job alerts";
    pub const INFO_SHEET: &str = "Info";

    pub const COLUMNS: [&str; super::COLUMNS.len()] = [
        "Title",
        "Match",
        "Must-haves met",
        "Exclusion",
        "Company",
        "Location",
        "Day rate",
        "Rate in the ad",
        "Start",
        "Duration",
        "Workload",
        "Remote",
        "Contract type",
        "Portal",
        "Place",
        "Applied on",
        "Note",
        "Favourite",
        "Details",
        "Date",
        "Ad",
        "Alert email",
        "Job ID",
    ];

    pub const LINK_AD: &str = "Open ad";
    pub const LINK_MAIL: &str = "Open alert email";
    pub const PLACE_INBOX: &str = "Jobs";
    pub const PLACE_ARCHIVE: &str = "Archive";
    pub const CONTRACT_INTERIM: &str = "Interim";
    pub const CONTRACT_PERMANENT: &str = "Permanent";
    pub const CONTRACT_ANUE: &str = "Temporary agency work";
    pub const OVERRIDDEN: &str = "Included by you";

    pub fn info_portal(label: &str) -> String {
        format!("{label} at the last fetch")
    }
    pub const HEALTH_OFF: &str = "Switched off";
    pub const HEALTH_OK: &str = "Ready";
    pub fn health_paused(until: Option<&str>) -> String {
        match until {
            Some(at) => format!("Paused, possible again from {at}"),
            None => "Paused until the next fetch".to_owned(),
        }
    }
    pub fn health_quota(until: &str) -> String {
        format!("Limit reached, possible again from {until}")
    }
    pub const HEALTH_EMPTY_MAILS: &str = "Alert emails without jobs";
    pub const HEALTH_EMPTY_PAGES: &str = "Pages without a description";
    pub const HEALTH_LOGIN: &str = "Sign-in needed";

    pub const INFO_NOTE_LABEL: &str = "Note";
    pub const INFO_NOTE: &str =
        "The app rewrites this file from time to time, so notes added here are lost.";

    pub const INFO_LAST_SCAN: &str = "Mailbox last read";
    pub const INFO_SCOPE: &str = "Scope of the last mailbox read";
    pub const INFO_NEW: &str = "New at the last mailbox read";
    pub const INFO_KNOWN: &str = "Already known at the last mailbox read";
    pub const INFO_DUP: &str = "In several alert emails at the last mailbox read";
    pub const INFO_JOBS_TOTAL: &str = "Jobs in total";
    pub const INFO_PROGRAM: &str = "Program";

    pub const SCOPE_NEW: &str = "New since the last fetch";
    pub const SCOPE_ALL: &str = "Whole mailbox";

    pub const HTML_TITLE: &str = "Report";
    pub const HTML_PINNED: &str = "Favourites";
    pub const HTML_HIGH: &str = "High match";
    pub const HTML_MID: &str = "Medium match";
    pub const HTML_LOW_BAND: &str = "Low match";
    pub const HTML_NEW_JOBS: &str = "New jobs";
    pub const HTML_CREATED: &str = "Created on";
    pub const HTML_EMPTY: &str = "No new matching jobs.";
    pub const HTML_EMPTY_NEW: &str = "No new jobs.";
    pub const HTML_NO_PROFILE: &str = "Without a profile, there is no match.";

    pub fn html_summary(total: usize, high: usize) -> String {
        let jobs = if total == 1 {
            "1 new matching job".to_owned()
        } else {
            format!("{} new matching jobs", super::group(total, ','))
        };
        if high == 0 {
            format!("{jobs}.")
        } else {
            format!("{jobs}, {} a high match.", super::group(high, ','))
        }
    }

    pub fn html_legend_band(high: bool) -> String {
        if high {
            format!("High match from {}", crate::model::HIGH_FROM)
        } else {
            format!("Medium match from {}", crate::model::MID_FROM)
        }
    }

    pub fn html_low(count: usize) -> String {
        if count == 1 {
            "1 job with a low match is in the app.".to_owned()
        } else {
            format!(
                "{} jobs with a low match are in the app.",
                super::group(count, ',')
            )
        }
    }

    pub fn html_more(count: usize) -> String {
        if count == 1 {
            "1 more job in the app.".to_owned()
        } else {
            format!("{} more jobs in the app.", super::group(count, ','))
        }
    }

    pub fn html_musts(met: u16, total: u16) -> String {
        if total == 0 {
            "No must-have requirements found".to_owned()
        } else {
            format!("{met} of {total} must-haves met")
        }
    }
    pub const HTML_MATCH: &str = "Match";
    pub const HTML_MET: &str = "Met";
    pub const HTML_OPEN: &str = "Open";
    pub const HTML_EXCLUDED: &str = "Excluded";
    pub const HTML_OVERRIDDEN: &str = "Included by you";
    pub const HTML_FAVOURITE: &str = "Favourite";
    pub const HTML_SINCE: &str = "Since the last fetch";
    pub const HTML_CLOSED: &str = "No longer taking applications";
    pub const HTML_GONE: &str = "No longer online";
    pub const HTML_TEASER: &str = "Preview";
    pub const HTML_NO_DETAILS: &str = "Details missing";
    pub const HTML_UNSCORABLE: &str = "Not scorable";
    pub const HTML_NONE: &str = "Not scored yet";

    pub fn rate_words(amount: u32, hourly: bool, currency: Option<&str>) -> String {
        let money = match currency.filter(|c| *c != "EUR") {
            Some(code) => format!("{}\u{a0}{code}", super::group(amount as usize, ',')),
            None => format!("€{}", super::group(amount as usize, ',')),
        };
        if hourly {
            format!("{money}/hr")
        } else {
            format!("{money}/day")
        }
    }
    pub const RATE_OPEN: &str = "Rate negotiable";

    pub fn remote_words(from: u8, to: u8) -> String {
        if from >= 100 {
            "fully remote".to_owned()
        } else if to == 0 {
            "on site".to_owned()
        } else if from == to {
            format!("{from}% remote")
        } else {
            format!("{from} to {to}% remote")
        }
    }

    pub fn months_words(months: u16) -> String {
        if months == 1 {
            "1 month".to_owned()
        } else {
            format!("{months} months")
        }
    }

    pub fn start_from(day: &str) -> String {
        format!("from {day}")
    }

    pub fn exclusion_reason(code: &str, params: &Map<String, Value>) -> Option<&'static str> {
        Some(match code {
            "dayRate" => "The day rate is below the minimum in the profile.",
            "country" => "The location is outside the countries in the profile.",
            "anue" => "The ad mentions temporary agency work.",
            "permanent" => "This is a permanent job, which the profile excludes.",
            "availability" => "The start does not fit the availability.",
            "salary" => "The salary is below the minimum in the profile.",
            "permanentRegion" => "The location is outside your locations for permanent jobs.",
            "tooJunior" => "The job asks for much less experience.",
            "formalOpen" if licence(params) => {
                "The ad requires a licence the profile does not name."
            }
            "formalOpen" => "The ad requires a degree the profile does not name.",
            "hardCriterion" => "An exclusion criterion applies.",
            _ => return None,
        })
    }

    pub fn details_label(detail: DetailState, closed: bool, short: bool) -> &'static str {
        match detail {
            DetailState::Ok if closed => "No longer taking applications",
            DetailState::Ok if short => "Available (short)",
            DetailState::Ok => "Available",
            DetailState::Pending { .. } => "Details to come",
            DetailState::OnRequest => "Details on request",
            DetailState::Teaser => "Preview",
            DetailState::Failed { .. } => "Details missing",
            DetailState::Gone => "No longer online",
            DetailState::Unfetchable => "Not fetchable",
        }
    }
    // end of user-facing text
}

/// A count with its thousands grouped like the app's numbers (`1.234`, `1,234`).
fn group(count: usize, separator: char) -> String {
    let digits = count.to_string();
    let mut out = String::with_capacity(digits.len() + digits.len() / 3);
    for (i, digit) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            out.push(separator);
        }
        out.push(digit);
    }
    out
}

/// Does a `formalOpen` violation name a licence (not a degree)?
fn licence(params: &Map<String, Value>) -> bool {
    params.get("class").and_then(Value::as_str) == Some("licence")
}

/// Words of the info sheet an earlier version stored with the last mailbox scan in a wording
/// of this file that changed since, and the German word of that row today - do not
/// translate.
const FORMER_WORDS: [(&str, &str); 7] = [
    (
        "Doppelt in mehreren Alert-Mails beim letzten Postfach-Abruf",
        INFO_DUP,
    ),
    ("Letzter Postfach-Abruf", INFO_LAST_SCAN),
    ("Umfang des letzten Postfach-Abrufs", INFO_SCOPE),
    ("Neu beim letzten Postfach-Abruf", INFO_NEW),
    ("Schon bekannt beim letzten Postfach-Abruf", INFO_KNOWN),
    (
        "In mehreren Alert-Mails beim letzten Postfach-Abruf",
        INFO_DUP,
    ),
    ("Alle", SCOPE_ALL),
];

/// The words of the files in one language.
pub struct Texts {
    pub language: Language,
    pub jobs_sheet: &'static str,
    pub info_sheet: &'static str,
    pub columns: [&'static str; COLUMNS.len()],
    pub link_ad: &'static str,
    pub link_mail: &'static str,
    pub place_inbox: &'static str,
    pub place_archive: &'static str,
    /// Interim, permanent, temporary agency work.
    contracts: [&'static str; 3],
    pub overridden: &'static str,
    info_portal: fn(&str) -> String,
    health_off: &'static str,
    health_ok: &'static str,
    health_paused: fn(Option<&str>) -> String,
    health_quota: fn(&str) -> String,
    health_empty_mails: &'static str,
    health_empty_pages: &'static str,
    health_login: &'static str,
    /// Number formats of the Excel cells: a day, a score, a day rate, a duration.
    pub excel_day: &'static str,
    pub excel_score: &'static str,
    pub excel_rate: &'static str,
    pub excel_months: &'static str,
    pub info_note_label: &'static str,
    pub info_note: &'static str,
    pub info_last_scan: &'static str,
    pub info_scope: &'static str,
    pub info_new: &'static str,
    pub info_known: &'static str,
    pub info_dup: &'static str,
    pub info_jobs_total: &'static str,
    pub info_program: &'static str,
    pub scope_new: &'static str,
    pub scope_all: &'static str,
    pub html_title: &'static str,
    pub html_pinned: &'static str,
    pub html_high: &'static str,
    pub html_mid: &'static str,
    pub html_low_band: &'static str,
    pub html_new_jobs: &'static str,
    pub html_created: &'static str,
    pub html_empty: &'static str,
    pub html_empty_new: &'static str,
    pub html_no_profile: &'static str,
    /// The summary line (all new matches, the high ones).
    pub html_summary: fn(usize, usize) -> String,
    /// The legend of a band (`true`: high).
    pub html_legend_band: fn(bool) -> String,
    /// The new jobs with a low match, as a count.
    pub html_low: fn(usize) -> String,
    /// Under a cut list of new matches: how many more the app lists.
    pub html_more: fn(usize) -> String,
    /// The must requirements met (met, total).
    pub html_musts: fn(u16, u16) -> String,
    pub html_match: &'static str,
    pub html_met: &'static str,
    pub html_open: &'static str,
    pub html_excluded: &'static str,
    pub html_overridden: &'static str,
    pub html_favourite: &'static str,
    pub html_since: &'static str,
    pub html_closed: &'static str,
    pub html_gone: &'static str,
    pub html_teaser: &'static str,
    pub html_no_details: &'static str,
    pub html_unscorable: &'static str,
    pub html_none: &'static str,
    /// The key facts in the app's words.
    rate_words: fn(u32, bool, Option<&str>) -> String,
    pub rate_open: &'static str,
    remote_words: fn(u8, u8) -> String,
    months_words: fn(u16) -> String,
    start_from: fn(&str) -> String,
    /// A moment as text (`strftime`): `19.09.2026 14:05`, `19/09/2026 14:05`.
    pub moment: &'static str,
    /// A day as text (`strftime`): `19.09.2026`, `19/09/2026`.
    pub day: &'static str,
    /// The number format of the date cells in Excel.
    pub excel_moment: &'static str,
    /// The Excel cells of a favourite and of an ad's start (`now`, `vague`).
    pub cell_yes: &'static str,
    pub start_now: &'static str,
    pub start_open: &'static str,
    exclusion: fn(&str, &Map<String, Value>) -> Option<&'static str>,
    details: fn(DetailState, bool, bool) -> &'static str,
}

/// The German words.
pub const DE: Texts = Texts {
    language: Language::De,
    jobs_sheet: JOBS_SHEET,
    info_sheet: INFO_SHEET,
    columns: COLUMNS,
    link_ad: LINK_AD,
    link_mail: LINK_MAIL,
    place_inbox: PLACE_INBOX,
    place_archive: PLACE_ARCHIVE,
    contracts: [CONTRACT_INTERIM, CONTRACT_PERMANENT, CONTRACT_ANUE],
    overridden: OVERRIDDEN,
    info_portal,
    health_off: HEALTH_OFF,
    health_ok: HEALTH_OK,
    health_paused,
    health_quota,
    health_empty_mails: HEALTH_EMPTY_MAILS,
    health_empty_pages: HEALTH_EMPTY_PAGES,
    health_login: HEALTH_LOGIN,
    excel_day: "dd.mm.yyyy",
    excel_score: "0\" %\"",
    excel_rate: "#,##0\" €\"",
    excel_months: "[=1]0\" Monat\";0\" Monate\"",
    info_note_label: INFO_NOTE_LABEL,
    info_note: INFO_NOTE,
    info_last_scan: INFO_LAST_SCAN,
    info_scope: INFO_SCOPE,
    info_new: INFO_NEW,
    info_known: INFO_KNOWN,
    info_dup: INFO_DUP,
    info_jobs_total: INFO_JOBS_TOTAL,
    info_program: INFO_PROGRAM,
    scope_new: SCOPE_NEW,
    scope_all: SCOPE_ALL,
    html_title: HTML_TITLE,
    html_pinned: HTML_PINNED,
    html_high: HTML_HIGH,
    html_mid: HTML_MID,
    html_low_band: HTML_LOW_BAND,
    html_new_jobs: HTML_NEW_JOBS,
    html_created: HTML_CREATED,
    html_empty: HTML_EMPTY,
    html_empty_new: HTML_EMPTY_NEW,
    html_no_profile: HTML_NO_PROFILE,
    html_summary,
    html_legend_band,
    html_low,
    html_more,
    html_musts,
    html_match: HTML_MATCH,
    html_met: HTML_MET,
    html_open: HTML_OPEN,
    html_excluded: HTML_EXCLUDED,
    html_overridden: HTML_OVERRIDDEN,
    html_favourite: HTML_FAVOURITE,
    html_since: HTML_SINCE,
    html_closed: HTML_CLOSED,
    html_gone: HTML_GONE,
    html_teaser: HTML_TEASER,
    html_no_details: HTML_NO_DETAILS,
    html_unscorable: HTML_UNSCORABLE,
    html_none: HTML_NONE,
    rate_words,
    rate_open: RATE_OPEN,
    remote_words,
    months_words,
    start_from,
    moment: "%d.%m.%Y %H:%M",
    day: "%d.%m.%Y",
    excel_moment: "dd.mm.yyyy hh:mm",
    cell_yes: "Ja",
    start_now: "ab sofort",
    start_open: "offen",
    exclusion: exclusion_reason,
    details: details_label,
};

/// The English words.
pub const EN: Texts = Texts {
    language: Language::En,
    jobs_sheet: en::JOBS_SHEET,
    info_sheet: en::INFO_SHEET,
    columns: en::COLUMNS,
    link_ad: en::LINK_AD,
    link_mail: en::LINK_MAIL,
    place_inbox: en::PLACE_INBOX,
    place_archive: en::PLACE_ARCHIVE,
    contracts: [
        en::CONTRACT_INTERIM,
        en::CONTRACT_PERMANENT,
        en::CONTRACT_ANUE,
    ],
    overridden: en::OVERRIDDEN,
    info_portal: en::info_portal,
    health_off: en::HEALTH_OFF,
    health_ok: en::HEALTH_OK,
    health_paused: en::health_paused,
    health_quota: en::health_quota,
    health_empty_mails: en::HEALTH_EMPTY_MAILS,
    health_empty_pages: en::HEALTH_EMPTY_PAGES,
    health_login: en::HEALTH_LOGIN,
    excel_day: "dd/mm/yyyy",
    excel_score: "0\"%\"",
    excel_rate: "\"€\"#,##0",
    excel_months: "[=1]0\" month\";0\" months\"",
    info_note_label: en::INFO_NOTE_LABEL,
    info_note: en::INFO_NOTE,
    info_last_scan: en::INFO_LAST_SCAN,
    info_scope: en::INFO_SCOPE,
    info_new: en::INFO_NEW,
    info_known: en::INFO_KNOWN,
    info_dup: en::INFO_DUP,
    info_jobs_total: en::INFO_JOBS_TOTAL,
    info_program: en::INFO_PROGRAM,
    scope_new: en::SCOPE_NEW,
    scope_all: en::SCOPE_ALL,
    html_title: en::HTML_TITLE,
    html_pinned: en::HTML_PINNED,
    html_high: en::HTML_HIGH,
    html_mid: en::HTML_MID,
    html_low_band: en::HTML_LOW_BAND,
    html_new_jobs: en::HTML_NEW_JOBS,
    html_created: en::HTML_CREATED,
    html_empty: en::HTML_EMPTY,
    html_empty_new: en::HTML_EMPTY_NEW,
    html_no_profile: en::HTML_NO_PROFILE,
    html_summary: en::html_summary,
    html_legend_band: en::html_legend_band,
    html_low: en::html_low,
    html_more: en::html_more,
    html_musts: en::html_musts,
    html_match: en::HTML_MATCH,
    html_met: en::HTML_MET,
    html_open: en::HTML_OPEN,
    html_excluded: en::HTML_EXCLUDED,
    html_overridden: en::HTML_OVERRIDDEN,
    html_favourite: en::HTML_FAVOURITE,
    html_since: en::HTML_SINCE,
    html_closed: en::HTML_CLOSED,
    html_gone: en::HTML_GONE,
    html_teaser: en::HTML_TEASER,
    html_no_details: en::HTML_NO_DETAILS,
    html_unscorable: en::HTML_UNSCORABLE,
    html_none: en::HTML_NONE,
    rate_words: en::rate_words,
    rate_open: en::RATE_OPEN,
    remote_words: en::remote_words,
    months_words: en::months_words,
    start_from: en::start_from,
    moment: "%d/%m/%Y %H:%M",
    day: "%d/%m/%Y",
    excel_moment: "dd/mm/yyyy hh:mm",
    cell_yes: "Yes",
    start_now: "starts now",
    start_open: "open",
    exclusion: en::exclusion_reason,
    details: en::details_label,
};

impl Texts {
    /// The words of a language.
    pub fn of(language: Language) -> &'static Texts {
        match language {
            Language::De => &DE,
            Language::En => &EN,
        }
    }

    /// See [`exclusion_reason`].
    pub fn exclusion_reason(
        &self,
        code: &str,
        params: &Map<String, Value>,
    ) -> Option<&'static str> {
        (self.exclusion)(code, params)
    }

    /// The state of a job's details at `now` (see [`details_label`]): like the list, a job
    /// whose mail is older than the automatic fetch reaches waits for a request.
    pub fn details_label(&self, job: &JobRow, now: Timestamp) -> &'static str {
        (self.details)(DetailState::at(job, now), job.desc_closed, job.desc_short)
    }

    /// A moment in local time as the files show it.
    pub fn moment(&self, ts: jiff::Timestamp) -> String {
        crate::time::local(ts).strftime(self.moment).to_string()
    }

    /// The day of a moment in local time.
    pub fn day(&self, ts: jiff::Timestamp) -> String {
        crate::time::local(ts).strftime(self.day).to_string()
    }

    /// A contract type's word (`interim`, `permanent`, `anue`); `None` when unclear.
    pub fn contract(&self, code: &str) -> Option<&'static str> {
        match code {
            "interim" => Some(self.contracts[0]),
            "permanent" => Some(self.contracts[1]),
            "anue" => Some(self.contracts[2]),
            _ => None,
        }
    }

    /// The info sheet's label of a portal's health.
    pub fn info_portal(&self, label: &str) -> String {
        (self.info_portal)(label)
    }

    /// A portal's health at the last fetch in words: switched off, ready, paused or capped
    /// with the moment it is possible again, alert emails or pages without jobs, a sign-in
    /// needed.
    pub fn health(&self, enabled: bool, health: &crate::fetch::PortalHealth) -> String {
        use crate::fetch::PortalHealth;
        if !enabled {
            return self.health_off.to_owned();
        }
        match health {
            PortalHealth::Ok => self.health_ok.to_owned(),
            PortalHealth::Paused { until, .. } => {
                (self.health_paused)(until.map(|at| self.moment(at)).as_deref())
            }
            PortalHealth::QuotaReached { until } => (self.health_quota)(&self.moment(*until)),
            PortalHealth::LayoutSuspect { empty_mails, .. } if *empty_mails > 0 => {
                self.health_empty_mails.to_owned()
            }
            PortalHealth::LayoutSuspect { .. } => self.health_empty_pages.to_owned(),
            PortalHealth::LoginRequired => self.health_login.to_owned(),
        }
    }

    /// The rate an ad states in the app's words (`1.100 €/Tag`, `95 €/Std.`), or that it is
    /// to be agreed; `None` when it says nothing.
    pub fn rate(&self, facts: &KeyFacts) -> Option<String> {
        match facts.rate {
            Some(amount) => Some((self.rate_words)(
                amount,
                facts.hourly == Some(true),
                facts.currency.as_deref(),
            )),
            None => (facts.rate_open == Some(true)).then(|| self.rate_open.to_owned()),
        }
    }

    /// The remote share an ad states (`60 % remote`, `voll remote`, `vor Ort`).
    pub fn remote(&self, facts: &KeyFacts) -> Option<String> {
        let from = facts.remote_from.or(facts.remote_to)?;
        let to = facts.remote_to.unwrap_or(from);
        Some((self.remote_words)(from, to))
    }

    /// The duration an ad states (`6 Monate`).
    pub fn duration(&self, facts: &KeyFacts) -> Option<String> {
        facts.months.map(self.months_words)
    }

    /// The start an ad states: `ab sofort`, `ab 01.11.2026`; a vague one only with `vague`
    /// (`offen`).
    pub fn start(&self, facts: &KeyFacts, vague: bool) -> Option<String> {
        match facts.start.as_deref()? {
            "now" => Some(self.start_now.to_owned()),
            "vague" => vague.then(|| self.start_open.to_owned()),
            day => {
                let shown = day
                    .parse::<jiff::civil::Date>()
                    .map_or_else(|_| day.to_owned(), |d| d.strftime(self.day).to_string());
                Some((self.start_from)(&shown))
            }
        }
    }

    /// The facts line of a job as the app shows it, in its order: rate, remote share,
    /// duration, workload, start (what the ad does not state is left out; the workload
    /// follows once the engine reads it).
    pub fn facts_line(&self, facts: &KeyFacts) -> Vec<String> {
        [
            self.rate(facts),
            self.remote(facts),
            self.duration(facts),
            self.start(facts, false),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    /// Rows of the info sheet that an earlier version stored in German: the same row in this
    /// language (labels and the scope; numbers and dates stay), also where this file words
    /// them otherwise now.
    pub fn from_german(&self, word: &str) -> Option<&'static str> {
        let word = FORMER_WORDS
            .iter()
            .find(|(former, _)| *former == word)
            .map_or(word, |(_, today)| *today);
        let german = DE.stored_words();
        let index = german.iter().position(|w| *w == word)?;
        Some(self.stored_words()[index])
    }

    /// The words of the info sheet that are stored with the last mailbox scan.
    fn stored_words(&self) -> [&'static str; 7] {
        [
            self.info_last_scan,
            self.info_scope,
            self.info_new,
            self.info_known,
            self.info_dup,
            self.scope_new,
            self.scope_all,
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::ReasonCode;
    use crate::pipeline::local::code_name;

    /// Every code that can exclude a job (a decided violation) has a text in both languages:
    /// the overview never shows an engine code.
    #[test]
    fn every_exclusion_code_has_a_text() {
        let none = Map::new();
        let mut licence = Map::new();
        licence.insert("class".into(), "licence".into());
        for texts in [&DE, &EN] {
            for code in [
                ReasonCode::Anue,
                ReasonCode::Permanent,
                ReasonCode::DayRate,
                ReasonCode::Availability,
                ReasonCode::Country,
                ReasonCode::Salary,
                ReasonCode::PermanentRegion,
                ReasonCode::TooJunior,
                ReasonCode::FormalOpen,
            ] {
                let name = code_name(&code);
                assert!(texts.exclusion_reason(&name, &none).is_some(), "{name}");
            }
            assert_ne!(
                texts.exclusion_reason("formalOpen", &licence),
                texts.exclusion_reason("formalOpen", &none)
            );
            assert_eq!(texts.exclusion_reason("somethingNew", &none), None);
        }
    }

    /// Both languages say the same things: each word has its counterpart, none is left
    /// untranslated, and German stored words find their English row.
    #[test]
    fn the_languages_match() {
        assert_eq!(Texts::of(Language::De).language, Language::De);
        assert_eq!(Texts::of(Language::En).language, Language::En);
        for (de, en) in DE.stored_words().into_iter().zip(EN.stored_words()) {
            assert_eq!(EN.from_german(de), Some(en));
            assert_eq!(DE.from_german(de), Some(de));
        }
        assert_eq!(EN.from_german("3"), None);
        // A row stored in a wording this file used before reads as today's row.
        for (former, today) in FORMER_WORDS {
            assert_eq!(DE.from_german(former), Some(today));
            let index = DE.stored_words().iter().position(|w| *w == today).unwrap();
            assert_eq!(EN.from_german(former), Some(EN.stored_words()[index]));
        }
        assert_eq!(
            EN.from_german("Letzter Postfach-Abruf"),
            Some(en::INFO_LAST_SCAN)
        );
        assert_eq!(EN.from_german("Alle"), Some(en::SCOPE_ALL));
        for (de, en) in DE.columns.iter().zip(EN.columns) {
            // Product and loan words are the same in both.
            if !["Portal", "Details", "Start", "Remote"].contains(de) {
                assert_ne!(*de, en);
            }
        }
        let ts: jiff::Timestamp = "2026-09-19T12:05:00Z".parse().unwrap();
        assert_eq!(DE.moment(ts), "19.09.2026 14:05");
        assert_eq!(EN.moment(ts), "19/09/2026 14:05");
    }
}
