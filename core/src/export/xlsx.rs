//! `JobAlerts.xlsx`: sheet "Job-Alerts" (the jobs of the inbox and the archive, best match
//! first) and sheet "Info". The file is generated completely anew on every write.
//!
//! The job sheet's columns are one table, [`COLUMNS`]: each column once, with its header in
//! both languages, its width and what it writes for a job. A new column is one row there.

use std::path::Path;

use jiff::Timestamp;
use rust_xlsxwriter::{
    Color, Format, FormatBorder, FormatUnderline, Url, Workbook, Worksheet, XlsxError,
};

use super::palette::{self, Colour};
use super::scale::{SCORE_SCALE, score_step};
use super::texts::Texts;
use crate::error::Result;
use crate::model::{KeyFacts, MatchRecord, MatchStatus, Place, gmail_url_for};
use crate::settings::Language;
use crate::store::JobRow;
use crate::text::{split_company_location, truncate_chars};
use crate::time;

/// Excel takes at most this many characters per cell ...
const MAX_CELL_CHARS: usize = 32_767;
/// ... and at most this many links per sheet; above that, URLs stay text (otherwise Excel
/// reports "unreadable content" and removes all links when repairing).
const MAX_LINKS: usize = 65_530;
/// The fill of the header row: the app's muted surface.
const HEADER_FILL: Colour = palette::SURFACE_MUTED;
/// The text of an excluded job's row: the grey of an excluded ring in the app.
const EXCLUDED_GREY: Colour = palette::SCORE_EXCLUDED;

/// One column of the job sheet: a key for the code, its header in German and English, its
/// width in characters (a width `w` is `7 w + 5` px at 100 %; every header keeps clear of its
/// filter button, about 20 px with the cell's padding) and what it writes for a job (nothing
/// is an empty cell).
struct Column {
    #[cfg_attr(
        not(test),
        expect(dead_code, reason = "the tests find a column by its key")
    )]
    key: &'static str,
    de: &'static str,
    en: &'static str,
    width: f64,
    cell: fn(&mut Cell<'_>) -> Result<(), XlsxError>,
}

impl Column {
    fn header(&self, language: Language) -> &'static str {
        match language {
            Language::De => self.de,
            Language::En => self.en,
        }
    }
}

// User-facing text, German and English.

/// The columns of the job sheet in their order: what decides first (title, match, musts,
/// exclusion), then who and where, the terms in the app's words, the dates, the links and
/// the job's key last. Unlike the text files nobody reads it by machine - so
/// it says "Portal" like the interface, not "Quelle" like the skill contract; "Ablage" is the
/// place (Jobs or Archiv). The widths fit the longest values: the exclusion holds a sentence,
/// the details column its longest state "Keine Bewerbung mehr möglich".
const COLUMNS: [Column; 20] = [
    Column {
        key: "title",
        de: "Titel",
        en: "Title",
        width: 50.0,
        cell: |c| c.text(&crate::view::display_title(c.job)),
    },
    Column {
        key: "score",
        de: "Passung",
        en: "Match",
        width: 11.0,
        cell: score_cell,
    },
    Column {
        key: "musts",
        de: "Pflicht erfüllt",
        en: "Must-haves met",
        width: 16.0,
        cell: |c| match shown_match(c.job) {
            Some(m) if m.must_total > 0 => c.text(&format!("{}/{}", m.must_met, m.must_total)),
            _ => Ok(()),
        },
    },
    Column {
        key: "exclusion",
        de: "Ausschluss",
        en: "Exclusion",
        width: 48.0,
        cell: exclusion_cell,
    },
    Column {
        key: "company",
        de: "Unternehmen",
        en: "Company",
        width: 30.0,
        cell: |c| c.text(&split_company_location(&c.job.company, &c.job.location).0),
    },
    Column {
        key: "location",
        de: "Ort",
        en: "Location",
        width: 22.0,
        cell: |c| c.text(&split_company_location(&c.job.company, &c.job.location).1),
    },
    Column {
        key: "day_rate",
        de: "Tagessatz",
        en: "Day rate",
        width: 12.0,
        cell: day_rate_cell,
    },
    Column {
        key: "rate_words",
        de: "Satz laut Anzeige",
        en: "Rate in the ad",
        width: 20.0,
        cell: |c| match key_facts(c.job).and_then(|f| c.texts.rate(f)) {
            Some(words) => c.text(&words),
            None => Ok(()),
        },
    },
    Column {
        key: "start",
        de: "Start",
        en: "Start",
        width: 13.0,
        cell: start_cell,
    },
    Column {
        key: "duration",
        de: "Laufzeit",
        en: "Duration",
        width: 12.0,
        cell: |c| match key_facts(c.job).and_then(|f| f.months) {
            Some(months) => c.number(f64::from(months), &c.formats.months[c.g]),
            None => Ok(()),
        },
    },
    Column {
        key: "workload",
        de: "Auslastung",
        en: "Workload",
        width: 13.0,
        // Empty until the engine's reading of the workload reaches the file.
        cell: |_| Ok(()),
    },
    Column {
        key: "remote",
        de: "Remote",
        en: "Remote",
        width: 16.0,
        cell: |c| match key_facts(c.job).and_then(|f| c.texts.remote(f)) {
            Some(remote) => c.text(&remote),
            None => Ok(()),
        },
    },
    Column {
        key: "contract",
        de: "Vertragsart",
        en: "Contract type",
        width: 16.0,
        cell: |c| {
            let contract = key_facts(c.job)
                .and_then(|f| f.contract.as_deref())
                .and_then(|kind| c.texts.contract(kind));
            match contract {
                Some(words) => c.text(words),
                None => Ok(()),
            }
        },
    },
    Column {
        key: "portal",
        de: "Portal",
        en: "Portal",
        width: 17.0,
        cell: |c| c.text(c.job.key.portal.label()),
    },
    Column {
        key: "place",
        de: "Ablage",
        en: "Place",
        width: 11.0,
        cell: |c| match c.job.place() {
            Place::Archive => c.text(c.texts.place_archive),
            Place::Inbox | Place::Trash => c.text(c.texts.place_inbox),
        },
    },
    Column {
        key: "details",
        de: "Details",
        en: "Details",
        width: 28.0,
        cell: |c| c.text(c.texts.details_label(c.job, c.now)),
    },
    Column {
        key: "date",
        de: "Datum",
        en: "Date",
        width: 17.0,
        cell: |c| {
            let date = time::local(c.job.mail_date.unwrap_or(c.job.first_seen_at));
            c.sheet
                .write_datetime_with_format(c.row, c.col, date, &c.formats.moment[c.g])?;
            Ok(())
        },
    },
    Column {
        key: "ad",
        de: "Anzeige",
        en: "Ad",
        width: 16.0,
        cell: |c| c.link(c.job.url.as_str(), c.texts.link_ad),
    },
    Column {
        key: "mail",
        de: "Alert-Mail",
        en: "Alert email",
        width: 19.0,
        cell: |c| {
            let mail = c
                .job
                .gmail_id
                .and_then(|id| gmail_url_for(id, c.mailbox))
                .map(|url| url.to_string())
                .unwrap_or_default();
            c.link(&mail, c.texts.link_mail)
        },
    },
    Column {
        key: "key",
        de: "Job-ID",
        en: "Job ID",
        width: 24.0,
        cell: |c| c.text(&c.job.key.to_string()),
    },
];

// end of user-facing text

/// A cell of the job sheet: where it is, the job of its row and what the columns need.
struct Cell<'a> {
    sheet: &'a mut Worksheet,
    row: u32,
    col: u16,
    job: &'a JobRow,
    texts: &'a Texts,
    formats: &'a Formats,
    /// `1` in the row of an excluded job (its grey formats), else `0`.
    g: usize,
    mailbox: Option<&'a str>,
    now: Timestamp,
    /// The links written so far (Excel takes at most [`MAX_LINKS`]).
    links: &'a mut usize,
}

impl Cell<'_> {
    /// Text; an overlong value is cut instead of letting the whole export fail.
    fn text(&mut self, value: &str) -> Result<(), XlsxError> {
        text(self.sheet, self.row, self.col, value)
    }

    fn number(&mut self, value: f64, format: &Format) -> Result<(), XlsxError> {
        self.sheet
            .write_number_with_format(self.row, self.col, value, format)?;
        Ok(())
    }

    /// A link as a clickable cell with a friendly text (`words`), in Excel's link style or
    /// in the grey of an excluded row; what Excel does not take as a link (length, form,
    /// number) stays as its address in text - the export never fails because of it.
    fn link(&mut self, url: &str, words: &str) -> Result<(), XlsxError> {
        if url.is_empty() {
            return Ok(());
        }
        if *self.links < MAX_LINKS {
            let link = Url::new(url).set_text(words);
            let written = match self.formats.link[self.g].as_ref() {
                Some(format) => self
                    .sheet
                    .write_url_with_format(self.row, self.col, link, format),
                None => self.sheet.write_url(self.row, self.col, link),
            };
            if written.is_ok() {
                *self.links += 1;
                return Ok(());
            }
        }
        self.text(url)
    }
}

/// The match the sheet shows: none for an unscored or unscorable job.
fn shown_match(job: &JobRow) -> Option<&MatchRecord> {
    job.match_
        .as_ref()
        .filter(|m| m.status != MatchStatus::Unscorable)
}

/// The ad's key facts as the engine read them.
fn key_facts(job: &JobRow) -> Option<&KeyFacts> {
    job.match_.as_ref().map(|m| &m.facts)
}

/// The score: a number shown with a percent sign; a scored job's cell takes the ring colour
/// of the app (`scale.rs`), an excluded one's stays grey.
fn score_cell(c: &mut Cell<'_>) -> Result<(), XlsxError> {
    let Some(m) = shown_match(c.job) else {
        return Ok(());
    };
    let format = if m.status == MatchStatus::Scored {
        &c.formats.steps[score_step(m.score)]
    } else {
        &c.formats.score_grey
    };
    c.number(f64::from(m.score), format)
}

/// The exclusion in words - for a job the user counts anyway that she does, and why the
/// engine would exclude it.
fn exclusion_cell(c: &mut Cell<'_>) -> Result<(), XlsxError> {
    let Some(m) = shown_match(c.job) else {
        return Ok(());
    };
    let why = m
        .note
        .as_ref()
        .and_then(|n| c.texts.exclusion_reason(&n.code, &n.params))
        .unwrap_or(c.texts.excluded);
    if c.job.override_include {
        c.text(&format!("{}. {why}", c.texts.overridden))
    } else if m.status == MatchStatus::Excluded {
        c.text(why)
    } else {
        Ok(())
    }
}

/// The day rate in euros as a number: an hourly rate x 8, a rate in another currency left
/// out.
fn day_rate_cell(c: &mut Cell<'_>) -> Result<(), XlsxError> {
    let Some(facts) = key_facts(c.job) else {
        return Ok(());
    };
    let Some(rate) = facts
        .rate
        .filter(|_| facts.currency.as_deref().is_none_or(|code| code == "EUR"))
    else {
        return Ok(());
    };
    let day = if facts.hourly == Some(true) {
        rate.saturating_mul(8)
    } else {
        rate
    };
    c.number(f64::from(day), &c.formats.rate[c.g])
}

/// The start: a date cell, or "ab sofort" / "offen".
fn start_cell(c: &mut Cell<'_>) -> Result<(), XlsxError> {
    match key_facts(c.job).and_then(|f| f.start.as_deref()) {
        Some("now") => c.text(c.texts.start_now),
        Some("vague") => c.text(c.texts.start_open),
        Some(day) => match day.parse::<jiff::civil::Date>() {
            Ok(date) => {
                c.sheet
                    .write_datetime_with_format(c.row, c.col, date, &c.formats.day[c.g])?;
                Ok(())
            }
            Err(_) => c.text(day),
        },
        None => Ok(()),
    }
}

/// A value of the info sheet: text, a whole number or a moment (a date cell) - numbers and
/// dates are real cells, never text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InfoValue {
    Text(String),
    Number(u64),
    Moment(Timestamp),
}

/// Writes the Excel file in the app's language. `info` are label/value pairs for the sheet
/// "Info" (labels already in that language); `mailbox` is the Gmail address whose account the
/// alert-mail links open (else the browser's first account). The details column says the
/// state at the moment of writing.
pub fn write_xlsx(
    path: &Path,
    jobs: &[JobRow],
    info: &[(String, InfoValue)],
    language: Language,
    mailbox: Option<&str>,
) -> Result<()> {
    write_xlsx_at(path, jobs, info, language, mailbox, Timestamp::now())
}

/// [`write_xlsx`] as of `now`.
fn write_xlsx_at(
    path: &Path,
    jobs: &[JobRow],
    info: &[(String, InfoValue)],
    language: Language,
    mailbox: Option<&str>,
    now: Timestamp,
) -> Result<()> {
    let texts = Texts::of(language);
    let mut workbook = Workbook::new();
    jobs_sheet(workbook.add_worksheet(), jobs, texts, mailbox, now)?;
    info_sheet(workbook.add_worksheet(), info, texts)?;
    let bytes = workbook.save_to_buffer()?;
    super::write_atomic(path, &bytes)
}

/// The formats of the job sheet, each as `[normal, grey]` where an excluded row needs it.
struct Formats {
    header: Format,
    grey: Format,
    link: [Option<Format>; 2],
    /// A scored job's score: its number format on the ring colour of its step.
    steps: [Format; 10],
    score_grey: Format,
    rate: [Format; 2],
    months: [Format; 2],
    day: [Format; 2],
    moment: [Format; 2],
}

impl Formats {
    fn new(texts: &Texts) -> Formats {
        let grey = Format::new().set_font_color(Color::RGB(EXCLUDED_GREY.rgb_u32()));
        let pair = |number: &str| -> [Format; 2] {
            [
                Format::new().set_num_format(number),
                grey.clone().set_num_format(number),
            ]
        };
        Formats {
            header: Format::new()
                .set_bold()
                .set_background_color(Color::RGB(HEADER_FILL.rgb_u32()))
                .set_border_bottom(FormatBorder::Thin),
            // A link of an excluded job stays a link, in the grey of its row.
            link: [
                None,
                Some(grey.clone().set_underline(FormatUnderline::Single)),
            ],
            steps: SCORE_SCALE.map(|colour| {
                Format::new()
                    .set_num_format(texts.excel_score)
                    .set_background_color(Color::RGB(colour.rgb_u32()))
            }),
            score_grey: grey.clone().set_num_format(texts.excel_score),
            rate: pair(texts.excel_rate),
            months: pair(texts.excel_months),
            day: pair(texts.excel_day),
            moment: pair(texts.excel_moment),
            grey,
        }
    }
}

fn jobs_sheet(
    sheet: &mut Worksheet,
    jobs: &[JobRow],
    texts: &Texts,
    mailbox: Option<&str>,
    now: Timestamp,
) -> Result<(), XlsxError> {
    sheet.set_name(texts.jobs_sheet)?;
    let formats = Formats::new(texts);
    for (col, column) in (0u16..).zip(&COLUMNS) {
        sheet.write_string_with_format(0, col, column.header(texts.language), &formats.header)?;
        sheet.set_column_width(col, column.width)?;
    }
    let mut links = 0;
    for (row, job) in (1u32..).zip(jobs) {
        // Excluded jobs stay in the list, grey, with their domain score (a job the user
        // counts anyway is stored as scored).
        let excluded = job
            .match_
            .as_ref()
            .is_some_and(|m| m.status == MatchStatus::Excluded);
        if excluded {
            sheet.set_row_format(row, &formats.grey)?;
        }
        for (col, column) in (0u16..).zip(&COLUMNS) {
            (column.cell)(&mut Cell {
                sheet,
                row,
                col,
                job,
                texts,
                formats: &formats,
                g: usize::from(excluded),
                mailbox,
                now,
                links: &mut links,
            })?;
        }
    }
    let last_row = u32::try_from(jobs.len()).unwrap_or(u32::MAX);
    let last_col = u16::try_from(COLUMNS.len() - 1).unwrap_or(0);
    sheet.autofilter(0, 0, last_row, last_col)?;
    // The header row and the title column stay in view.
    sheet.set_freeze_panes(1, 1)?;
    Ok(())
}

/// Text cell; overlong values are cut instead of letting the whole export fail.
fn text(sheet: &mut Worksheet, row: u32, col: u16, value: &str) -> Result<(), XlsxError> {
    sheet.write_string(row, col, truncate_chars(value, MAX_CELL_CHARS))?;
    Ok(())
}

fn info_sheet(
    sheet: &mut Worksheet,
    info: &[(String, InfoValue)],
    texts: &Texts,
) -> Result<(), XlsxError> {
    sheet.set_name(texts.info_sheet)?;
    let bold = Format::new().set_bold();
    let moment = Format::new()
        .set_num_format(texts.excel_moment)
        .set_align(rust_xlsxwriter::FormatAlign::Left);
    let number = Format::new().set_align(rust_xlsxwriter::FormatAlign::Left);
    sheet.set_column_width(0, 48)?;
    sheet.set_column_width(1, 64)?;
    let note = InfoValue::Text(texts.info_note.to_owned());
    let rows = info
        .iter()
        .map(|(label, value)| (label.as_str(), value))
        .chain(std::iter::once((texts.info_note_label, &note)));
    for (row, (label, value)) in (0u32..).zip(rows) {
        sheet.write_string_with_format(row, 0, truncate_chars(label, MAX_CELL_CHARS), &bold)?;
        match value {
            InfoValue::Text(value) => text(sheet, row, 1, value)?,
            #[expect(clippy::cast_precision_loss, reason = "counts of jobs, far below 2^52")]
            InfoValue::Number(n) => {
                sheet.write_number_with_format(row, 1, *n as f64, &number)?;
            }
            InfoValue::Moment(at) => {
                sheet.write_datetime_with_format(row, 1, time::local(*at), &moment)?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use calamine::{Data, Reader, Xlsx, open_workbook};

    use super::*;
    use crate::export::texts::{INFO_LAST_SCAN, INFO_NOTE_LABEL, INFO_SHEET, JOBS_SHEET, en};
    use crate::model::{DescStatus, KeyFacts, MatchRecord, Notice};
    use crate::portal::job_link;

    fn row(url: &str, title: &str, status: DescStatus) -> JobRow {
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

    fn record(status: MatchStatus, score: u8) -> MatchRecord {
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

    /// The place of a column in the sheet, by its key.
    fn at(key: &str) -> usize {
        COLUMNS
            .iter()
            .position(|column| column.key == key)
            .unwrap_or_else(|| panic!("no column {key}"))
    }

    /// The cell name of a column in a row (`S2`).
    fn cell_name(key: &str, row: u32) -> String {
        let letter = char::from(b'A' + u8::try_from(at(key)).unwrap());
        format!("{letter}{row}")
    }

    fn cells(path: &Path, sheet: &str, row: usize) -> Vec<Data> {
        let mut book: Xlsx<_> = open_workbook(path).unwrap();
        let range = book.worksheet_range(sheet).unwrap();
        range.rows().nth(row).unwrap().to_vec()
    }

    /// The header row is the table's in each language, each key once; German and English
    /// differ but for product and loan words.
    #[test]
    fn the_header_row_is_the_table() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        for language in [Language::De, Language::En] {
            write_xlsx(&path, &[], &[], language, None).unwrap();
            let header: Vec<String> = cells(&path, Texts::of(language).jobs_sheet, 0)
                .iter()
                .map(ToString::to_string)
                .collect();
            let table: Vec<&str> = COLUMNS.iter().map(|c| c.header(language)).collect();
            assert_eq!(header, table);
        }
        let keys: std::collections::HashSet<&str> = COLUMNS.iter().map(|c| c.key).collect();
        assert_eq!(keys.len(), COLUMNS.len(), "each key once");
        for column in &COLUMNS {
            if !["Portal", "Details", "Start", "Remote"].contains(&column.de) {
                assert_ne!(column.de, column.en);
            }
        }
    }

    /// A scored job: the score as a number shown with a percent sign, the musts, the facts in
    /// the app's words and as numbers and dates, the marks, the friendly links (the alert
    /// mail in the account the app reads) and the key last.
    #[test]
    fn a_row_carries_the_match_the_terms_and_the_marks() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        let mut job = row(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "Interim Controller",
            DescStatus::Ok,
        );
        job.archived_at = Some("2026-09-21T09:00:00Z".parse().unwrap());
        let mut record = record(MatchStatus::Scored, 83);
        record.facts = KeyFacts {
            rate: Some(95),
            hourly: Some(true),
            start: Some("2026-11-01".into()),
            months: Some(6),
            remote_from: Some(60),
            remote_to: Some(100),
            contract: Some("interim".into()),
            ..KeyFacts::default()
        };
        job.match_ = Some(record);
        write_xlsx(&path, &[job], &[], Language::De, Some("erika@gmail.com")).unwrap();
        let first = cells(&path, JOBS_SHEET, 1);
        assert_eq!(first[at("title")].to_string(), "Interim Controller");
        assert_eq!(first[at("score")], Data::Float(83.0));
        assert_eq!(first[at("musts")].to_string(), "3/4");
        assert_eq!(first[at("exclusion")], Data::Empty);
        assert_eq!(first[at("company")].to_string(), "Muster GmbH");
        assert_eq!(first[at("location")].to_string(), "Mannheim");
        assert_eq!(
            first[at("day_rate")],
            Data::Float(760.0),
            "95 an hour is 760 a day"
        );
        assert_eq!(first[at("rate_words")].to_string(), "95\u{202f}€/Std.");
        assert!(
            matches!(first[at("start")], Data::DateTime(_)),
            "a real date: {:?}",
            first[at("start")]
        );
        assert_eq!(first[at("duration")], Data::Float(6.0));
        assert_eq!(
            first[at("workload")],
            Data::Empty,
            "no workload until the engine reads it"
        );
        assert_eq!(
            first[at("remote")].to_string(),
            "60 bis 100\u{202f}% remote"
        );
        assert_eq!(first[at("contract")].to_string(), "Interim");
        assert_eq!(first[at("portal")].to_string(), "linkedin.com");
        assert_eq!(first[at("place")].to_string(), "Archiv");
        assert_eq!(first[at("details")].to_string(), "Vorhanden");
        assert!(
            matches!(first[at("date")], Data::DateTime(_)),
            "the mail date is an Excel date"
        );
        assert_eq!(first[at("ad")].to_string(), "Anzeige öffnen");
        assert_eq!(first[at("mail")].to_string(), "Alert-Mail öffnen");
        assert_eq!(first[at("key")].to_string(), "linkedin:4000000002");
        let xlsx = std::fs::read(&path).unwrap();
        let sheet = part(&xlsx, "xl/worksheets/sheet1.xml");
        assert!(
            sheet.contains("xSplit=\"1\"") && sheet.contains("ySplit=\"1\""),
            "title and header stay"
        );
        let rels = part(&xlsx, "xl/worksheets/_rels/sheet1.xml.rels");
        assert!(
            rels.contains("https://mail.google.com/mail/u/erika@gmail.com/")
                && sheet.contains("location=\"all/1a2b\""),
            "the account the app reads: {rels}"
        );
        assert!(rels.contains("https://www.linkedin.com/jobs/view/4000000002/"));
        let styles = part(&xlsx, "xl/styles.xml");
        assert!(
            styles.contains("0&quot; %&quot;"),
            "the score's format: {styles}"
        );
    }

    /// An excluded job says why in words, grey to its links; one counted anyway says so and
    /// why the engine excludes it; a vague start is "offen", now "ab sofort".
    #[test]
    fn exclusions_and_overrides_are_said_in_words() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        let mut excluded = row(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Leitung Controlling",
            DescStatus::Ok,
        );
        let mut out = record(MatchStatus::Excluded, 64);
        out.note = Some(Notice {
            code: "dayRate".into(),
            params: serde_json::Map::new(),
        });
        out.facts.start = Some("vague".into());
        excluded.match_ = Some(out.clone());
        let mut counted = row(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "Interim CFO",
            DescStatus::Ok,
        );
        out.status = MatchStatus::Scored;
        out.facts.start = Some("now".into());
        counted.match_ = Some(out);
        counted.override_include = true;
        write_xlsx(&path, &[excluded, counted], &[], Language::De, None).unwrap();
        let first = cells(&path, JOBS_SHEET, 1);
        assert_eq!(
            first[at("exclusion")].to_string(),
            "Der Tagessatz liegt unter dem Minimum im Profil."
        );
        assert_eq!(first[at("start")].to_string(), "offen");
        let second = cells(&path, JOBS_SHEET, 2);
        assert_eq!(
            second[at("exclusion")].to_string(),
            "Manuell einbezogen. Der Tagessatz liegt unter dem Minimum im Profil."
        );
        assert_eq!(second[at("start")].to_string(), "ab sofort");
        let xlsx = std::fs::read(&path).unwrap();
        let grey = EXCLUDED_GREY.hex()[1..].to_string();
        for cell in [cell_name("ad", 2), cell_name("mail", 2)] {
            let font = font_of(&xlsx, &cell);
            assert!(
                font.contains(&grey) && font.contains("<u/>"),
                "{cell}: {font}"
            );
        }
        for cell in [cell_name("ad", 3), cell_name("mail", 3)] {
            let font = font_of(&xlsx, &cell);
            assert!(
                !font.contains(&grey) && font.contains("<u/>"),
                "{cell}: {font}"
            );
        }
        assert!(font_of(&xlsx, "A2").contains(&grey), "the row stays grey");
        assert!(
            !font_of(&xlsx, "A3").contains(&grey),
            "a job counted anyway is no grey row"
        );
    }

    /// The info sheet holds real numbers and dates, not text, and the note last.
    #[test]
    fn the_info_sheet_has_real_numbers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        let info = [
            (
                INFO_LAST_SCAN.to_string(),
                InfoValue::Moment("2026-09-19T12:05:00Z".parse().unwrap()),
            ),
            ("Neu".to_string(), InfoValue::Number(12)),
            ("Programm".to_string(), InfoValue::Text("CXact".into())),
        ];
        write_xlsx(&path, &[], &info, Language::De, None).unwrap();
        let mut book: Xlsx<_> = open_workbook(&path).unwrap();
        assert_eq!(book.sheet_names(), [JOBS_SHEET, INFO_SHEET]);
        let sheet = book.worksheet_range(INFO_SHEET).unwrap();
        assert!(matches!(sheet.get((0, 1)), Some(Data::DateTime(_))));
        assert_eq!(sheet.get((1, 1)), Some(&Data::Float(12.0)));
        assert_eq!(sheet.get((2, 1)).unwrap().to_string(), "CXact");
        assert_eq!(sheet.get((3, 0)).unwrap().to_string(), INFO_NOTE_LABEL);
        assert_eq!(book.worksheet_range(JOBS_SHEET).unwrap().rows().count(), 1);
    }

    /// In English the sheets, headers and word cells are English; data stays as it came.
    #[test]
    fn workbook_in_english() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        let mut job = row(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Interim CFO",
            DescStatus::Teaser,
        );
        let mut scored = record(MatchStatus::Scored, 70);
        scored.facts = KeyFacts {
            rate: Some(1100),
            start: Some("now".into()),
            contract: Some("permanent".into()),
            ..KeyFacts::default()
        };
        job.match_ = Some(scored);
        let info = [(en::INFO_LAST_SCAN.to_string(), InfoValue::Text("x".into()))];
        write_xlsx(&path, &[job], &info, Language::En, None).unwrap();

        let mut book: Xlsx<_> = open_workbook(&path).unwrap();
        assert_eq!(book.sheet_names(), [en::JOBS_SHEET, en::INFO_SHEET]);
        let range = book.worksheet_range(en::JOBS_SHEET).unwrap();
        let first: Vec<&Data> = range.rows().nth(1).unwrap().iter().collect();
        assert_eq!(first[at("company")].to_string(), "Muster GmbH");
        assert_eq!(first[at("rate_words")].to_string(), "€1,100/day");
        assert_eq!(first[at("start")].to_string(), "starts now");
        assert_eq!(first[at("contract")].to_string(), "Permanent");
        assert_eq!(first[at("place")].to_string(), "Jobs");
        assert_eq!(first[at("details")].to_string(), "Preview");
        assert_eq!(first[at("ad")].to_string(), "Open ad");
        assert_eq!(first[at("mail")].to_string(), "Open alert email");
        let info = book.worksheet_range(en::INFO_SHEET).unwrap();
        assert_eq!(info.get((0, 0)).unwrap().to_string(), en::INFO_LAST_SCAN);
        assert_eq!(info.get((1, 0)).unwrap().to_string(), en::INFO_NOTE_LABEL);
    }

    /// The details column says what the list's badge says, as of the moment of writing: a
    /// job whose mail is older than the automatic fetch reaches waits for a request, a closed
    /// ad takes no applications.
    #[test]
    fn the_details_column_speaks_like_the_list() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::XLSX_NAME);
        let now: Timestamp = "2026-10-01T08:00:00Z".parse().unwrap();
        let mut old = row(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "Leitung Controlling",
            DescStatus::Missing,
        );
        old.mail_date = Some("2026-08-20T07:05:00Z".parse().unwrap());
        let mut closed = row(
            "https://www.linkedin.com/jobs/view/4000000003/",
            "Interim CFO",
            DescStatus::Ok,
        );
        closed.desc_closed = true;
        let jobs = [
            row(
                "https://www.linkedin.com/jobs/view/4000000001/",
                "SAP-Berater",
                DescStatus::Missing,
            ),
            old,
            closed,
        ];
        for (language, words) in [
            (
                Language::De,
                [
                    "Details folgen",
                    "Details auf Anfrage",
                    "Keine Bewerbung mehr möglich",
                ],
            ),
            (
                Language::En,
                [
                    "Details to come",
                    "Details on request",
                    "No longer taking applications",
                ],
            ),
        ] {
            write_xlsx_at(&path, &jobs, &[], language, None, now).unwrap();
            let mut book: Xlsx<_> = open_workbook(&path).unwrap();
            let range = book
                .worksheet_range(Texts::of(language).jobs_sheet)
                .unwrap();
            let details: Vec<String> = (1..=3)
                .map(|row| range.get((row, at("details"))).unwrap().to_string())
                .collect();
            assert_eq!(details, words);
        }
    }

    /// One part of an xlsx file (a zip written as a stream: the deflate data of a part ends
    /// by itself, so its local header is enough).
    fn part(xlsx: &[u8], name: &str) -> String {
        use std::io::Read as _;
        let mut at = 0;
        while let Some(found) = xlsx[at..].windows(4).position(|w| w == b"PK\x03\x04") {
            let head = &xlsx[at + found..];
            if head.len() < 30 {
                break;
            }
            let number = |i: usize| usize::from(u16::from_le_bytes([head[i], head[i + 1]]));
            let (method, name_len, extra_len) = (number(8), number(26), number(28));
            if head.get(30..30 + name_len) == Some(name.as_bytes()) {
                assert_eq!(method, 8, "{name} is deflated");
                let mut xml = String::new();
                flate2::read::DeflateDecoder::new(&head[30 + name_len + extra_len..])
                    .read_to_string(&mut xml)
                    .unwrap();
                return xml;
            }
            at += found + 4;
        }
        panic!("{name} missing")
    }

    /// The value of `attribute` in the first tag of `xml` that starts with `tag`.
    fn attribute<'a>(xml: &'a str, tag: &str, attribute: &str) -> &'a str {
        let open = &xml[xml.find(tag).unwrap_or_else(|| panic!("{tag}"))..];
        let open = &open[..open.find('>').unwrap()];
        let value = open
            .split(&format!(" {attribute}=\""))
            .nth(1)
            .unwrap_or_else(|| panic!("{attribute} in {open}"));
        &value[..value.find('"').unwrap()]
    }

    /// The font of a cell of the first sheet (empty for a cell in the default style).
    fn font_of(xlsx: &[u8], cell: &str) -> String {
        let sheet = part(xlsx, "xl/worksheets/sheet1.xml");
        let styles = part(xlsx, "xl/styles.xml");
        let tag = format!("<c r=\"{cell}\"");
        let open = &sheet[sheet.find(&tag).unwrap_or_else(|| panic!("{tag}"))..];
        if !open[..open.find('>').unwrap()].contains(" s=\"") {
            return String::new();
        }
        let style: usize = attribute(&sheet, &tag, "s").parse().unwrap();
        let formats = &styles[styles.find("<cellXfs").unwrap()..];
        let format = formats.split("<xf ").nth(style + 1).unwrap();
        let font: usize = attribute(&format!("<xf {format}"), "<xf ", "fontId")
            .parse()
            .unwrap();
        let fonts = &styles[styles.find("<fonts").unwrap()..styles.find("</fonts>").unwrap()];
        fonts.split("<font>").nth(font + 1).unwrap().to_owned()
    }

    /// An overlong value cuts the cell instead of letting the export fail (on every run
    /// again).
    #[test]
    fn oversized_cell_is_truncated() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("lang.xlsx");
        let mut job = row(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Interim CFO",
            DescStatus::Ok,
        );
        job.title = "x".repeat(40_000);
        write_xlsx(&path, &[job], &[], Language::De, None).unwrap();
        let mut book: Xlsx<_> = open_workbook(&path).unwrap();
        let range = book.worksheet_range(JOBS_SHEET).unwrap();
        let title = range.get((1, 0)).unwrap().to_string();
        assert_eq!(title.chars().count(), MAX_CELL_CHARS);
    }
}
