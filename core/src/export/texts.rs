//! User-facing text of the exported files in the app's two languages: every word the Excel
//! file shows. The interface has its own catalogs; these texts only end
//! up in files the user opens. They use the interface's words (glossary in `docs/PLAN.md`)
//! and its style rules - `core/tests/rust_texts.rs` checks both languages. The German words
//! stand at the top level, the English ones in [`en`] under the same names; [`Texts::of`]
//! picks by the app's language.

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

/// The link cells' words, the places of the sheet and the contract types (the reader's).
pub const LINK_AD: &str = "Anzeige öffnen";
pub const LINK_MAIL: &str = "Alert-Mail öffnen";
pub const PLACE_INBOX: &str = "Jobs";
pub const PLACE_ARCHIVE: &str = "Archiv";
pub const CONTRACT_INTERIM: &str = "Interim";
pub const CONTRACT_PERMANENT: &str = "Festanstellung";
pub const CONTRACT_ANUE: &str = "Arbeitnehmerüberlassung";
pub const CONTRACT_FREELANCE: &str = "Freiberuflich";
/// Why an excluded job the user scores anyway is in the list.
pub const OVERRIDDEN: &str = "Trotzdem bewertet";

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
pub const HEALTH_EMPTY_PAGES: &str = "Anzeigen ohne Text";
pub const HEALTH_LOGIN: &str = "Anmeldung nötig";

/// Label and warning of the last row of the info sheet. Not only a fetch writes the file: a
/// rescore, a details run and "Endgültig löschen" do too.
pub const INFO_NOTE_LABEL: &str = "Hinweis";
pub const INFO_NOTE: &str =
    "Die App schreibt diese Datei immer wieder neu, eigene Notizen gehen dabei verloren.";

/// Labels of the info sheet (the mail address is deliberately not among them). The mailbox
/// is "abgerufen" like "Postfach abrufen" in the interface; the range is its "Zeitraum".
pub const INFO_LAST_SCAN: &str = "Postfach zuletzt abgerufen";
pub const INFO_SCOPE: &str = "Zeitraum beim letzten Abruf";
pub const INFO_NEW: &str = "Neu beim letzten Abruf";
pub const INFO_KNOWN: &str = "Schon bekannt beim letzten Abruf";
pub const INFO_DUP: &str = "In mehreren Alert-Mails beim letzten Abruf";
pub const INFO_JOBS_TOTAL: &str = "Jobs gesamt";
pub const INFO_PROGRAM: &str = "Programm";
/// The app's visible name (the files, the keychain entry and the identifiers keep theirs).
pub const PROGRAM_NAME: &str = "CXact";

/// Scope of a mailbox scan in words (the interface's range of "Postfach abrufen").
pub const SCOPE_NEW: &str = "Seit dem letzten Abruf";
pub const SCOPE_ALL: &str = "Alle Alert-Mails";
/// The last so many days of the mailbox.
pub fn scope_days(days: u16) -> String {
    format!("Letzte {days} Tage")
}

/// When the file was written (a row of the info sheet).
pub const CREATED: &str = "Erstellt am";
/// Why a job is excluded when its reason has no words (never the engine's code).
pub const EXCLUDED: &str = "Ausgeschlossen";

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

/// The workload in percent of a five-day week, as the app's list row says it: `Vollzeit`,
/// whole days as days (`3 Tage/Woche`, `3 bis 4 Tage/Woche`), any other share as a share
/// (`50 %`), part-time without a number as such (`Teilzeit`, with full time open too
/// `Teilzeit möglich`).
pub fn workload_words(from: Option<u8>, to: u8) -> String {
    let Some(from) = from else {
        return if to >= 100 {
            "Teilzeit möglich"
        } else {
            "Teilzeit"
        }
        .to_owned();
    };
    let low = from.min(to);
    if low == to && to >= 100 {
        return "Vollzeit".to_owned();
    }
    match workload_days(low, to) {
        Some((1, 1)) => "1 Tag/Woche".to_owned(),
        Some((a, b)) if a == b => format!("{b} Tage/Woche"),
        Some((a, b)) => format!("{a} bis {b} Tage/Woche"),
        None if low == to => format!("{to}\u{202f}%"),
        None => format!("{low} bis {to}\u{202f}%"),
    }
}

/// Why a job is excluded, by the code of its first violation (the list's `note`), in the
/// words of the interface's criteria. `None` for a code without a text: the file then says
/// only "Ausgeschlossen" - never the code itself.
pub fn exclusion_reason(code: &str, params: &Map<String, Value>) -> Option<&'static str> {
    Some(match code {
        "dayRate" => "Der Tagessatz liegt unter dem Minimum im Profil.",
        "country" => "Der Einsatzort liegt außerhalb der Länder im Profil.",
        "anue" => "Die Anzeige nennt Arbeitnehmerüberlassung.",
        "permanent" => "Der Job ist eine Festanstellung, das Profil schließt sie aus.",
        "availability" => "Der Start passt nicht zur Verfügbarkeit.",
        "salary" => "Das Gehalt liegt unter dem Minimum im Profil.",
        "permanentRegion" => "Der Ort liegt außerhalb der Orte für Festanstellung.",
        "exclusionWord" => "Die Anzeige nennt ein Ausschlusswort aus dem Profil.",
        "formalOpen" if licence(params) => {
            "Die Anzeige verlangt eine Zulassung, die das Profil nicht nennt."
        }
        "formalOpen" => "Die Anzeige verlangt einen Abschluss, den das Profil nicht nennt.",
        "hardCriterion" => "Ein Ausschlusskriterium greift.",
        _ => return None,
    })
}

/// State of the ad's text (see [`DetailState`]) in the words of the reader's note on the ad
/// (`reader.adNote`): an ad not loaded yet is missing, whoever loads it; a full text has no
/// note there and is "Vorhanden" here.
pub fn details_label(detail: DetailState, closed: bool, short: bool) -> &'static str {
    match detail {
        DetailState::Ok if closed => "Keine Bewerbung mehr möglich",
        DetailState::Ok if short => "Vorhanden (kurz)",
        DetailState::Ok => "Vorhanden",
        DetailState::Pending { .. } | DetailState::OnRequest | DetailState::Failed { .. } => {
            "Anzeige fehlt"
        }
        DetailState::Teaser => "Nur eine Vorschau",
        DetailState::Gone => "Nicht mehr online",
        DetailState::Unfetchable => "Anzeige nicht erreichbar",
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

    pub const LINK_AD: &str = "Open ad";
    pub const LINK_MAIL: &str = "Open alert email";
    pub const PLACE_INBOX: &str = "Jobs";
    pub const PLACE_ARCHIVE: &str = "Archive";
    pub const CONTRACT_INTERIM: &str = "Interim";
    pub const CONTRACT_PERMANENT: &str = "Permanent";
    pub const CONTRACT_ANUE: &str = "Temporary agency work";
    pub const CONTRACT_FREELANCE: &str = "Freelance";
    pub const OVERRIDDEN: &str = "Scored anyway";

    pub fn info_portal(label: &str) -> String {
        format!("{label} at the last check")
    }
    pub const HEALTH_OFF: &str = "Switched off";
    pub const HEALTH_OK: &str = "Ready";
    pub fn health_paused(until: Option<&str>) -> String {
        match until {
            Some(at) => format!("Paused, possible again from {at}"),
            None => "Paused until the next check".to_owned(),
        }
    }
    pub fn health_quota(until: &str) -> String {
        format!("Limit reached, possible again from {until}")
    }
    pub const HEALTH_EMPTY_MAILS: &str = "Alert emails without jobs";
    pub const HEALTH_EMPTY_PAGES: &str = "Ads without text";
    pub const HEALTH_LOGIN: &str = "Sign-in needed";

    pub const INFO_NOTE_LABEL: &str = "Note";
    pub const INFO_NOTE: &str =
        "The app rewrites this file from time to time, so notes added here are lost.";

    pub const INFO_LAST_SCAN: &str = "Mailbox last checked";
    pub const INFO_SCOPE: &str = "Range of the last check";
    pub const INFO_NEW: &str = "New at the last check";
    pub const INFO_KNOWN: &str = "Already known at the last check";
    pub const INFO_DUP: &str = "In several alert emails at the last check";
    pub const INFO_JOBS_TOTAL: &str = "Jobs in total";
    pub const INFO_PROGRAM: &str = "Program";

    pub const SCOPE_NEW: &str = "Since the last check";
    pub const SCOPE_ALL: &str = "All alert emails";
    pub fn scope_days(days: u16) -> String {
        format!("Last {days} days")
    }

    pub const CREATED: &str = "Created on";
    pub const EXCLUDED: &str = "Excluded";

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

    pub fn workload_words(from: Option<u8>, to: u8) -> String {
        let Some(from) = from else {
            return if to >= 100 {
                "part-time possible"
            } else {
                "part-time"
            }
            .to_owned();
        };
        let low = from.min(to);
        if low == to && to >= 100 {
            return "full-time".to_owned();
        }
        match super::workload_days(low, to) {
            Some((1, 1)) => "1 day/week".to_owned(),
            Some((a, b)) if a == b => format!("{b} days/week"),
            Some((a, b)) => format!("{a} to {b} days/week"),
            None if low == to => format!("{to}%"),
            None => format!("{low} to {to}%"),
        }
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
            "exclusionWord" => "The ad names an exclusion word from the profile.",
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
            DetailState::Pending { .. } | DetailState::OnRequest | DetailState::Failed { .. } => {
                "Ad missing"
            }
            DetailState::Teaser => "Only a preview",
            DetailState::Gone => "No longer online",
            DetailState::Unfetchable => "Ad cannot be reached",
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

/// Shares of a five-day week that are whole days (a fifth each), as days: `(3, 4)` for 60 to
/// 80 percent; `None` when one of them is not.
fn workload_days(from: u8, to: u8) -> Option<(u8, u8)> {
    let whole = |share: u8| share > 0 && share.is_multiple_of(20);
    (whole(from) && whole(to)).then_some((from / 20, to / 20))
}

/// Does a `formalOpen` violation name a licence (not a degree)?
fn licence(params: &Map<String, Value>) -> bool {
    params.get("class").and_then(Value::as_str) == Some("licence")
}

/// Words of the info sheet an earlier version stored with the last mailbox scan in a wording
/// of this file that changed since, and the German word of that row today - do not
/// translate.
const FORMER_WORDS: [(&str, &str); 14] = [
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
    ("Postfach zuletzt gelesen", INFO_LAST_SCAN),
    ("Umfang beim letzten Lesen des Postfachs", INFO_SCOPE),
    ("Neu beim letzten Lesen des Postfachs", INFO_NEW),
    ("Schon bekannt beim letzten Lesen des Postfachs", INFO_KNOWN),
    (
        "In mehreren Alert-Mails beim letzten Lesen des Postfachs",
        INFO_DUP,
    ),
    ("Neu seit dem letzten Abruf", SCOPE_NEW),
    ("Ganzes Postfach", SCOPE_ALL),
];

/// The words of the files in one language.
pub struct Texts {
    pub language: Language,
    pub jobs_sheet: &'static str,
    pub info_sheet: &'static str,
    pub link_ad: &'static str,
    pub link_mail: &'static str,
    pub place_inbox: &'static str,
    pub place_archive: &'static str,
    /// Interim, permanent, temporary agency work.
    contracts: [&'static str; 4],
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
    scope_days: fn(u16) -> String,
    pub created: &'static str,
    pub excluded: &'static str,
    /// The key facts in the app's words.
    rate_words: fn(u32, bool, Option<&str>) -> String,
    pub rate_open: &'static str,
    remote_words: fn(u8, u8) -> String,
    months_words: fn(u16) -> String,
    workload_words: fn(Option<u8>, u8) -> String,
    start_from: fn(&str) -> String,
    /// A moment as text (`strftime`): `19.09.2026 14:05`, `19/09/2026 14:05`.
    pub moment: &'static str,
    /// A day as text (`strftime`): `19.09.2026`, `19/09/2026`.
    pub day: &'static str,
    /// The number format of the date cells in Excel.
    pub excel_moment: &'static str,
    /// The Excel cells of an ad's start (`now`, `vague`).
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
    link_ad: LINK_AD,
    link_mail: LINK_MAIL,
    place_inbox: PLACE_INBOX,
    place_archive: PLACE_ARCHIVE,
    contracts: [
        CONTRACT_INTERIM,
        CONTRACT_PERMANENT,
        CONTRACT_ANUE,
        CONTRACT_FREELANCE,
    ],
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
    scope_days,
    created: CREATED,
    excluded: EXCLUDED,
    rate_words,
    rate_open: RATE_OPEN,
    remote_words,
    months_words,
    workload_words,
    start_from,
    moment: "%d.%m.%Y %H:%M",
    day: "%d.%m.%Y",
    excel_moment: "dd.mm.yyyy hh:mm",
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
    link_ad: en::LINK_AD,
    link_mail: en::LINK_MAIL,
    place_inbox: en::PLACE_INBOX,
    place_archive: en::PLACE_ARCHIVE,
    contracts: [
        en::CONTRACT_INTERIM,
        en::CONTRACT_PERMANENT,
        en::CONTRACT_ANUE,
        en::CONTRACT_FREELANCE,
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
    scope_days: en::scope_days,
    created: en::CREATED,
    excluded: en::EXCLUDED,
    rate_words: en::rate_words,
    rate_open: en::RATE_OPEN,
    remote_words: en::remote_words,
    months_words: en::months_words,
    workload_words: en::workload_words,
    start_from: en::start_from,
    moment: "%d/%m/%Y %H:%M",
    day: "%d/%m/%Y",
    excel_moment: "dd/mm/yyyy hh:mm",
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

    /// A contract type's word (`interim`, `freelance`, `permanent`, `anue`); `None` when
    /// unclear.
    pub fn contract(&self, code: &str) -> Option<&'static str> {
        match code {
            "interim" => Some(self.contracts[0]),
            "permanent" => Some(self.contracts[1]),
            "anue" => Some(self.contracts[2]),
            "freelance" => Some(self.contracts[3]),
            _ => None,
        }
    }

    /// A scan of the last so many days in words (`Letzte 7 Tage`).
    pub fn scope_days(&self, days: u16) -> String {
        (self.scope_days)(days)
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

    /// The workload an ad states (`Vollzeit`, `3 Tage/Woche`, `50 %`).
    pub fn workload(&self, facts: &KeyFacts) -> Option<String> {
        facts
            .workload_to
            .map(|to| (self.workload_words)(facts.workload_from, to))
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
    /// duration, workload, start (what the ad does not state is left out).
    pub fn facts_line(&self, facts: &KeyFacts) -> Vec<String> {
        [
            self.rate(facts),
            self.remote(facts),
            self.duration(facts),
            self.workload(facts),
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
    /// the Excel file never shows an engine code.
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
                ReasonCode::FormalOpen,
                ReasonCode::ExclusionWord,
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

    /// The workload in the words of the app's list row (`texts.ts` factWords), placed after
    /// the duration and before the start.
    #[test]
    fn the_workload_reads_like_the_list_row() {
        let cases = [
            (Some(100), 100, "Vollzeit", "full-time"),
            (Some(60), 60, "3 Tage/Woche", "3 days/week"),
            (Some(20), 20, "1 Tag/Woche", "1 day/week"),
            (Some(60), 80, "3 bis 4 Tage/Woche", "3 to 4 days/week"),
            (Some(50), 50, "50\u{202f}%", "50%"),
            (Some(50), 70, "50 bis 70\u{202f}%", "50 to 70%"),
            (None, 80, "Teilzeit", "part-time"),
            (None, 100, "Teilzeit möglich", "part-time possible"),
        ];
        for (from, to, de, en) in cases {
            let facts = KeyFacts {
                workload_from: from,
                workload_to: Some(to),
                ..KeyFacts::default()
            };
            assert_eq!(DE.workload(&facts).as_deref(), Some(de));
            assert_eq!(EN.workload(&facts).as_deref(), Some(en));
        }
        assert_eq!(DE.workload(&KeyFacts::default()), None);
        let facts = KeyFacts {
            months: Some(6),
            start: Some("now".into()),
            workload_from: Some(60),
            workload_to: Some(60),
            ..KeyFacts::default()
        };
        assert_eq!(
            DE.facts_line(&facts),
            ["6 Monate", "3 Tage/Woche", "ab sofort"]
        );
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
        let ts: jiff::Timestamp = "2026-09-19T12:05:00Z".parse().unwrap();
        assert_eq!(DE.moment(ts), "19.09.2026 14:05");
        assert_eq!(EN.moment(ts), "19/09/2026 14:05");
    }
}
