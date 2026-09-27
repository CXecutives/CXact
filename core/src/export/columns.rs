//! The columns of the job overview, one table for both of its files: [`COLUMNS`] holds each
//! column once, with its header in both languages, its width in Excel and the value it takes
//! for a job. The value says what it is (text, a score, a sum, a day, a link ...): the Excel
//! file (`xlsx.rs`) gives it its cell and format, the CSV file (`csv.rs`) prints it. A new
//! column is one row here.

use jiff::Timestamp;
use jiff::civil::{Date, DateTime};

use super::texts::Texts;
use crate::model::{KeyFacts, MatchRecord, MatchStatus, Place, gmail_url_for};
use crate::settings::Language;
use crate::store::JobRow;
use crate::text::split_company_location;
use crate::time;

/// What a column holds for a job.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Value {
    /// Nothing: an empty cell.
    Empty,
    Text(String),
    /// The score in percent; a scored job's (`scored`) wears its ring colour in Excel, an
    /// excluded one's stays grey.
    Score {
        score: u8,
        scored: bool,
    },
    /// A day rate in euros.
    Rate(u32),
    /// A duration in months.
    Months(u16),
    /// A calendar day (a start).
    Day(Date),
    /// A moment in local time (the alert mail's).
    Moment(DateTime),
    /// A link: Excel shows its words, the CSV file its address.
    Link {
        url: String,
        words: &'static str,
    },
}

impl Value {
    /// Text, or an empty cell for none.
    fn text(words: Option<impl Into<String>>) -> Value {
        words.map_or(Value::Empty, |words| Value::Text(words.into()))
    }
}

/// A job's row and what its values need: the words of the file's language, the Gmail
/// account the alert-mail links open and the moment of writing.
pub(super) struct Row<'a> {
    pub job: &'a JobRow,
    pub texts: &'a Texts,
    pub mailbox: Option<&'a str>,
    pub now: Timestamp,
}

/// One column: a key for the code, its header in German and English, its width in Excel
/// characters (a width `w` is `7 w + 5` px at 100 %; every header keeps clear of its filter
/// button, about 20 px with the cell's padding) and its value for a job.
pub(super) struct Column {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the tests find a column by its key")
    )]
    pub key: &'static str,
    de: &'static str,
    en: &'static str,
    pub width: f64,
    pub value: fn(&Row<'_>) -> Value,
}

impl Column {
    pub fn header(&self, language: Language) -> &'static str {
        match language {
            Language::De => self.de,
            Language::En => self.en,
        }
    }
}

// User-facing text, German and English.

/// The columns in their order: what decides first (title, match, musts, exclusion), then who
/// and where, the terms in the app's words, the portal and the alert mail's subject, the
/// place, the ad's text, the dates, the links and the job's key last. Unlike the text files
/// nobody reads them by machine - so they say "Portal" like the interface, not "Quelle" like
/// the skill contract; "Ablage" is the place (Jobs or Archiv). The widths fit the longest
/// values: the exclusion holds a sentence, the ad's text its longest state, which is
/// "Keine Bewerbung mehr möglich" in German.
pub(super) const COLUMNS: [Column; 23] = [
    Column {
        key: "title",
        de: "Titel",
        en: "Title",
        width: 50.0,
        value: |r| Value::Text(crate::view::display_title(r.job)),
    },
    Column {
        key: "score",
        de: "Übereinstimmung",
        en: "Match",
        width: 19.0,
        value: |r| match shown_match(r.job) {
            Some(m) => Value::Score {
                score: m.score,
                scored: m.status == MatchStatus::Scored,
            },
            None => Value::Empty,
        },
    },
    Column {
        key: "musts",
        de: "Pflicht erfüllt",
        en: "Must-haves met",
        width: 16.0,
        value: |r| match shown_match(r.job) {
            Some(m) if m.must_total > 0 => Value::Text(format!("{}/{}", m.must_met, m.must_total)),
            _ => Value::Empty,
        },
    },
    Column {
        key: "exclusion",
        de: "Ausschluss",
        en: "Exclusion",
        width: 48.0,
        value: exclusion,
    },
    Column {
        key: "company",
        de: "Unternehmen",
        en: "Company",
        width: 30.0,
        value: |r| Value::Text(split_company_location(&r.job.company, &r.job.location).0),
    },
    Column {
        key: "location",
        de: "Ort",
        en: "Location",
        width: 22.0,
        value: |r| Value::Text(split_company_location(&r.job.company, &r.job.location).1),
    },
    Column {
        key: "day_rate",
        de: "Tagessatz",
        en: "Day rate",
        width: 12.0,
        value: day_rate,
    },
    Column {
        key: "rate_words",
        de: "Satz laut Anzeige",
        en: "Rate in the ad",
        width: 20.0,
        value: |r| Value::text(key_facts(r.job).and_then(|f| r.texts.rate(f))),
    },
    Column {
        key: "start",
        de: "Start",
        en: "Start",
        width: 13.0,
        value: start,
    },
    Column {
        key: "duration",
        de: "Laufzeit",
        en: "Duration",
        width: 12.0,
        value: |r| {
            key_facts(r.job)
                .and_then(|f| f.months)
                .map_or(Value::Empty, Value::Months)
        },
    },
    Column {
        key: "workload",
        de: "Auslastung",
        en: "Workload",
        width: 17.0,
        value: |r| Value::text(key_facts(r.job).and_then(|f| r.texts.workload(f))),
    },
    Column {
        key: "remote",
        de: "Remote",
        en: "Remote",
        width: 16.0,
        value: |r| Value::text(key_facts(r.job).and_then(|f| r.texts.remote(f))),
    },
    Column {
        key: "contract",
        de: "Vertragsart",
        en: "Contract type",
        width: 16.0,
        value: |r| {
            Value::text(
                key_facts(r.job)
                    .and_then(|f| f.contract.as_deref())
                    .and_then(|kind| r.texts.contract(kind)),
            )
        },
    },
    Column {
        key: "deadline",
        de: "Bewerbungsfrist",
        en: "Application deadline",
        width: 23.0,
        value: |r| {
            key_facts(r.job)
                .and_then(|f| f.deadline.as_deref())
                .and_then(|day| day.parse::<Date>().ok())
                .map_or(Value::Empty, Value::Day)
        },
    },
    Column {
        key: "contact",
        de: "Kontakt",
        en: "Contact",
        width: 40.0,
        value: contact,
    },
    Column {
        key: "portal",
        de: "Portal",
        en: "Portal",
        width: 17.0,
        value: |r| Value::Text(r.job.key.portal.label().to_owned()),
    },
    Column {
        key: "subject",
        de: "Mail-Betreff",
        en: "Alert email subject",
        width: 40.0,
        value: |r| Value::Text(r.job.mail_subject.clone()),
    },
    Column {
        key: "place",
        de: "Ablage",
        en: "Place",
        width: 11.0,
        value: |r| match r.job.place() {
            Place::Archive => Value::Text(r.texts.place_archive.to_owned()),
            Place::Inbox | Place::Trash => Value::Text(r.texts.place_inbox.to_owned()),
        },
    },
    Column {
        key: "details",
        de: "Anzeigentext",
        en: "Ad text",
        width: 28.0,
        value: |r| Value::Text(r.texts.details_label(r.job, r.now).to_owned()),
    },
    Column {
        key: "date",
        de: "Datum",
        en: "Date",
        width: 17.0,
        value: |r| Value::Moment(time::local(r.job.mail_date.unwrap_or(r.job.first_seen_at))),
    },
    Column {
        key: "ad",
        de: "Anzeige",
        en: "Ad",
        width: 16.0,
        value: |r| Value::Link {
            url: r.job.url.to_string(),
            words: r.texts.link_ad,
        },
    },
    Column {
        key: "mail",
        de: "Alert-Mail",
        en: "Alert email",
        width: 19.0,
        value: |r| {
            r.job
                .gmail_id
                .and_then(|id| gmail_url_for(id, r.mailbox))
                .map_or(Value::Empty, |url| Value::Link {
                    url: url.to_string(),
                    words: r.texts.link_mail,
                })
        },
    },
    Column {
        key: "key",
        de: "Job-ID",
        en: "Job ID",
        width: 24.0,
        value: |r| Value::Text(r.job.key.to_string()),
    },
];

// end of user-facing text

/// The match the overview shows: none for an unscored or unscorable job.
fn shown_match(job: &JobRow) -> Option<&MatchRecord> {
    job.match_
        .as_ref()
        .filter(|m| m.status != MatchStatus::Unscorable)
}

/// The ad's key facts as the engine read them.
fn key_facts(job: &JobRow) -> Option<&KeyFacts> {
    job.match_.as_ref().map(|m| &m.facts)
}

/// The exclusion in words - for a job the user scores anyway that she does, and why the
/// engine would exclude it.
fn exclusion(r: &Row<'_>) -> Value {
    let Some(m) = shown_match(r.job) else {
        return Value::Empty;
    };
    let why = m
        .note
        .as_ref()
        .and_then(|n| r.texts.exclusion_reason(&n.code, &n.params))
        .unwrap_or(r.texts.excluded);
    if r.job.override_include {
        Value::Text(format!("{}. {why}", r.texts.overridden))
    } else if m.status == MatchStatus::Excluded {
        Value::Text(why.to_owned())
    } else {
        Value::Empty
    }
}

/// The day rate in euros: an hourly rate x 8, a rate in another currency left out.
fn day_rate(r: &Row<'_>) -> Value {
    let Some(facts) = key_facts(r.job) else {
        return Value::Empty;
    };
    let Some(rate) = facts
        .rate
        .filter(|_| facts.currency.as_deref().is_none_or(|code| code == "EUR"))
    else {
        return Value::Empty;
    };
    Value::Rate(if facts.hourly == Some(true) {
        rate.saturating_mul(8)
    } else {
        rate
    })
}

/// The contact the ad names: the person, the e-mail address and the phone number it names,
/// in this order.
fn contact(r: &Row<'_>) -> Value {
    let Some(facts) = key_facts(r.job) else {
        return Value::Empty;
    };
    let parts: Vec<&str> = [
        &facts.contact_name,
        &facts.contact_email,
        &facts.contact_phone,
    ]
    .into_iter()
    .filter_map(|part| part.as_deref())
    .collect();
    if parts.is_empty() {
        Value::Empty
    } else {
        Value::Text(parts.join(", "))
    }
}

/// The start: a day, or "ab sofort" / "offen".
fn start(r: &Row<'_>) -> Value {
    match key_facts(r.job).and_then(|f| f.start.as_deref()) {
        Some("now") => Value::Text(r.texts.start_now.to_owned()),
        Some("vague") => Value::Text(r.texts.start_open.to_owned()),
        Some(day) => day
            .parse::<Date>()
            .map_or_else(|_| Value::Text(day.to_owned()), Value::Day),
        None => Value::Empty,
    }
}

#[cfg(test)]
pub(super) mod tests {
    use super::*;
    use crate::model::DescStatus;
    use crate::portal::job_link;

    /// A job of the tests: a LinkedIn job of Muster GmbH in Mannheim whose alert mail's
    /// subject would be a formula.
    pub(in crate::export) fn row(url: &str, title: &str, status: DescStatus) -> JobRow {
        let link = job_link(url).unwrap();
        JobRow {
            key: link.key,
            url: link.url,
            title: title.into(),
            company: "von: Muster GmbH".into(),
            location: "D-68159 Mannheim".into(),
            mail_date: Some("2026-09-18T07:05:00Z".parse().unwrap()),
            mail_subject: "=HYPERLINK(\"http://evil\")".into(),
            gmail_id: Some(0x1a2b),
            first_seen_at: "2026-09-19T08:00:00Z".parse().unwrap(),
            first_seen_run: 1,
            desc_status: status,
            desc_short: false,
            desc_closed: false,
            desc_len: 0,
            desc_fetched_at: None,
            desc_attempts: 0,
            desc_error: None,
            txt_name: None,
            desc_attempted_at: None,
            read_at: None,
            match_: None,
            match_open: Vec::new(),
            match_rev: None,
            facts: None,
            archived_at: None,
            trashed_at: None,
            override_include: false,
        }
    }

    /// A match of the tests: three of four musts met.
    pub(in crate::export) fn record(status: MatchStatus, score: u8) -> MatchRecord {
        MatchRecord {
            status,
            score,
            note: None,
            must_met: 3,
            must_total: 4,
            top: Vec::new(),
            facts: KeyFacts::default(),
            rank: 0,
        }
    }

    /// The place of a column in the table, by its key.
    pub(in crate::export) fn at(key: &str) -> usize {
        COLUMNS
            .iter()
            .position(|column| column.key == key)
            .unwrap_or_else(|| panic!("no column {key}"))
    }

    /// Each key once; German and English differ but for product and loan words; the alert
    /// mail's subject follows the portal.
    #[test]
    fn the_table_names_each_column_once() {
        let keys: std::collections::HashSet<&str> = COLUMNS.iter().map(|c| c.key).collect();
        assert_eq!(keys.len(), COLUMNS.len(), "each key once");
        for column in &COLUMNS {
            if !["Portal", "Start", "Remote"].contains(&column.de) {
                assert_ne!(column.de, column.en);
            }
        }
        assert_eq!(at("subject"), at("portal") + 1);
        assert_eq!(COLUMNS[at("score")].header(Language::De), "Übereinstimmung");
        assert_eq!(COLUMNS[at("score")].header(Language::En), "Match");
    }

    /// The values say what they are: numbers and days stay numbers and days, a link keeps
    /// its address, a missing alert mail is no link.
    #[test]
    fn values_keep_their_kind() {
        let mut job = row(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "Interim Controller",
            DescStatus::Ok,
        );
        let mut scored = record(MatchStatus::Scored, 83);
        scored.facts = KeyFacts {
            rate: Some(95),
            hourly: Some(true),
            start: Some("2026-11-01".into()),
            months: Some(6),
            workload_from: Some(60),
            workload_to: Some(60),
            deadline: Some("2026-10-15".into()),
            contact_name: Some("Julia Brandt".into()),
            contact_phone: Some("+49 40 5550 1234".into()),
            ..KeyFacts::default()
        };
        job.match_ = Some(scored);
        let texts = Texts::of(Language::De);
        let value = |job: &JobRow, key: &str| {
            (COLUMNS[at(key)].value)(&Row {
                job,
                texts,
                mailbox: None,
                now: Timestamp::now(),
            })
        };
        assert_eq!(
            value(&job, "score"),
            Value::Score {
                score: 83,
                scored: true
            }
        );
        assert_eq!(value(&job, "day_rate"), Value::Rate(760));
        assert_eq!(value(&job, "duration"), Value::Months(6));
        assert_eq!(value(&job, "workload"), Value::Text("3 Tage/Woche".into()));
        assert_eq!(
            value(&job, "start"),
            Value::Day(Date::new(2026, 11, 1).unwrap())
        );
        assert_eq!(
            value(&job, "deadline"),
            Value::Day(Date::new(2026, 10, 15).unwrap())
        );
        assert_eq!(
            value(&job, "contact"),
            Value::Text("Julia Brandt, +49 40 5550 1234".into())
        );
        assert_eq!(at("deadline"), at("contract") + 1);
        assert_eq!(at("contact"), at("deadline") + 1);
        assert!(matches!(value(&job, "date"), Value::Moment(_)));
        assert_eq!(
            value(&job, "subject"),
            Value::Text("=HYPERLINK(\"http://evil\")".into())
        );
        assert!(matches!(
            value(&job, "ad"),
            Value::Link { url, .. } if url == "https://www.linkedin.com/jobs/view/4000000002/"
        ));
        job.gmail_id = None;
        assert_eq!(value(&job, "mail"), Value::Empty);
        job.match_ = None;
        for key in [
            "score",
            "musts",
            "exclusion",
            "day_rate",
            "workload",
            "deadline",
            "contact",
        ] {
            assert_eq!(value(&job, key), Value::Empty, "{key}");
        }
    }
}
