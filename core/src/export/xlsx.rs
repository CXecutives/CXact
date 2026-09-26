//! `JobAlerts.xlsx`: sheet "Job-Alerts" (the jobs of the inbox and the archive, best match
//! first) and sheet "Info". The file is generated completely anew on every write.

use std::path::Path;

use jiff::Timestamp;
use rust_xlsxwriter::{
    Color, Format, FormatBorder, FormatUnderline, Url, Workbook, Worksheet, XlsxError,
};

use super::palette::{self, Colour};
use super::scale::{SCORE_SCALE, score_step};
use super::texts::Texts;
use crate::error::Result;
use crate::model::{MatchStatus, Place, gmail_url_for};
use crate::settings::Language;
use crate::store::JobRow;
use crate::text::{split_company_location, truncate_chars};
use crate::time;

/// Excel takes at most this many characters per cell ...
const MAX_CELL_CHARS: usize = 32_767;
/// ... and at most this many links per sheet; above that, URLs stay text (otherwise Excel
/// reports "unreadable content" and removes all links when repairing).
const MAX_LINKS: usize = 65_530;
/// Column widths in characters (order as in `COLUMNS`; a width `w` is `7 w + 5` px at 100 %).
/// Every header keeps clear of its filter button (about 20 px with the cell's padding); the
/// exclusion holds a sentence, the details "Keine Bewerbung mehr möglich".
const WIDTHS: [f64; 21] = [
    50.0, 11.0, 16.0, 48.0, 30.0, 22.0, 12.0, 20.0, 13.0, 12.0, 13.0, 16.0, 16.0, 17.0, 11.0, 11.0,
    28.0, 17.0, 16.0, 19.0, 24.0,
];
/// The fill of the header row: the app's muted surface.
const HEADER_FILL: Colour = palette::SURFACE_MUTED;
/// The text of an excluded job's row: the grey of an excluded ring in the app.
const EXCLUDED_GREY: Colour = palette::SCORE_EXCLUDED;

/// The columns by their place in `COLUMNS`.
mod col {
    pub const TITLE: u16 = 0;
    pub const SCORE: u16 = 1;
    pub const MUSTS: u16 = 2;
    pub const EXCLUSION: u16 = 3;
    pub const COMPANY: u16 = 4;
    pub const LOCATION: u16 = 5;
    pub const DAY_RATE: u16 = 6;
    pub const RATE_WORDS: u16 = 7;
    pub const START: u16 = 8;
    pub const DURATION: u16 = 9;
    /// The workload an ad states: empty until the engine reads it.
    #[expect(
        dead_code,
        reason = "the column exists; the engine does not read it yet"
    )]
    pub const WORKLOAD: u16 = 10;
    pub const REMOTE: u16 = 11;
    pub const CONTRACT: u16 = 12;
    pub const PORTAL: u16 = 13;
    pub const PLACE: u16 = 14;
    pub const FAVOURITE: u16 = 15;
    pub const DETAILS: u16 = 16;
    pub const DATE: u16 = 17;
    pub const AD: u16 = 18;
    pub const MAIL: u16 = 19;
    pub const KEY: u16 = 20;
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
    for (col, (title, width)) in (0u16..).zip(texts.columns.iter().zip(WIDTHS)) {
        sheet.write_string_with_format(0, col, *title, &formats.header)?;
        sheet.set_column_width(col, width)?;
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
        let g = usize::from(excluded);
        text(sheet, row, col::TITLE, &crate::view::display_title(job))?;
        match_cells(sheet, row, job, texts, &formats)?;
        let (company, location) = split_company_location(&job.company, &job.location);
        text(sheet, row, col::COMPANY, &company)?;
        text(sheet, row, col::LOCATION, &location)?;
        fact_cells(sheet, row, job, texts, &formats, g)?;
        text(sheet, row, col::PORTAL, job.key.portal.label())?;
        let place = match job.place() {
            Place::Archive => texts.place_archive,
            Place::Inbox | Place::Trash => texts.place_inbox,
        };
        text(sheet, row, col::PLACE, place)?;
        if job.pinned_at.is_some() {
            text(sheet, row, col::FAVOURITE, texts.cell_yes)?;
        }
        text(sheet, row, col::DETAILS, texts.details_label(job, now))?;
        let date = time::local(job.mail_date.unwrap_or(job.first_seen_at));
        sheet.write_datetime_with_format(row, col::DATE, date, &formats.moment[g])?;
        let link_format = formats.link[g].as_ref();
        let place = (row, &mut links);
        link(
            sheet,
            place,
            col::AD,
            job.url.as_str(),
            texts.link_ad,
            link_format,
        )?;
        let mail = job
            .gmail_id
            .and_then(|id| gmail_url_for(id, mailbox))
            .map(|url| url.to_string())
            .unwrap_or_default();
        link(
            sheet,
            (row, &mut links),
            col::MAIL,
            &mail,
            texts.link_mail,
            link_format,
        )?;
        text(sheet, row, col::KEY, &job.key.to_string())?;
    }
    let last_row = u32::try_from(jobs.len()).unwrap_or(u32::MAX);
    sheet.autofilter(
        0,
        0,
        last_row,
        u16::try_from(texts.columns.len() - 1).unwrap_or(0),
    )?;
    // The header row and the title column stay in view.
    sheet.set_freeze_panes(1, 1)?;
    Ok(())
}

/// The score (a number shown with a percent sign; a scored job's cell takes the ring colour
/// of the app, `scale.rs`; unscorable and unscored jobs none), the musts met ("3/4") and the
/// exclusion in words - for a job the user counts anyway that she does, and why the engine
/// would exclude it.
fn match_cells(
    sheet: &mut Worksheet,
    row: u32,
    job: &JobRow,
    texts: &Texts,
    formats: &Formats,
) -> Result<(), XlsxError> {
    let Some(m) = &job.match_ else {
        return Ok(());
    };
    if m.status == MatchStatus::Unscorable {
        return Ok(());
    }
    let score = f64::from(m.score);
    if m.status == MatchStatus::Scored {
        sheet.write_number_with_format(
            row,
            col::SCORE,
            score,
            &formats.steps[score_step(m.score)],
        )?;
    } else {
        sheet.write_number_with_format(row, col::SCORE, score, &formats.score_grey)?;
    }
    if m.must_total > 0 {
        text(
            sheet,
            row,
            col::MUSTS,
            &format!("{}/{}", m.must_met, m.must_total),
        )?;
    }
    let why = || {
        m.note
            .as_ref()
            .and_then(|n| texts.exclusion_reason(&n.code, &n.params))
            .unwrap_or(texts.html_excluded)
    };
    if job.override_include {
        text(
            sheet,
            row,
            col::EXCLUSION,
            &format!("{}. {}", texts.overridden, why()),
        )?;
    } else if m.status == MatchStatus::Excluded {
        text(sheet, row, col::EXCLUSION, why())?;
    }
    Ok(())
}

/// The ad's key facts as the engine read them: the day rate in euros as a number (an hourly
/// rate x 8, a rate in another currency left out) and the rate in the app's words, the start
/// (a date cell, or "ab sofort" / "offen"), the duration in months, the remote share and the
/// contract type in words. The workload column stays empty until the engine reads it.
fn fact_cells(
    sheet: &mut Worksheet,
    row: u32,
    job: &JobRow,
    texts: &Texts,
    formats: &Formats,
    g: usize,
) -> Result<(), XlsxError> {
    let Some(facts) = job.match_.as_ref().map(|m| &m.facts) else {
        return Ok(());
    };
    if let Some(rate) = facts.rate
        && facts.currency.as_deref().is_none_or(|c| c == "EUR")
    {
        let day = if facts.hourly == Some(true) {
            rate.saturating_mul(8)
        } else {
            rate
        };
        sheet.write_number_with_format(row, col::DAY_RATE, f64::from(day), &formats.rate[g])?;
    }
    if let Some(words) = texts.rate(facts) {
        text(sheet, row, col::RATE_WORDS, &words)?;
    }
    match facts.start.as_deref() {
        Some("now") => text(sheet, row, col::START, texts.start_now)?,
        Some("vague") => text(sheet, row, col::START, texts.start_open)?,
        Some(day) => match day.parse::<jiff::civil::Date>() {
            Ok(date) => {
                sheet.write_datetime_with_format(row, col::START, date, &formats.day[g])?;
            }
            Err(_) => text(sheet, row, col::START, day)?,
        },
        None => {}
    }
    if let Some(months) = facts.months {
        sheet.write_number_with_format(
            row,
            col::DURATION,
            f64::from(months),
            &formats.months[g],
        )?;
    }
    if let Some(remote) = texts.remote(facts) {
        text(sheet, row, col::REMOTE, &remote)?;
    }
    if let Some(contract) = facts.contract.as_deref().and_then(|c| texts.contract(c)) {
        text(sheet, row, col::CONTRACT, contract)?;
    }
    Ok(())
}

/// Text cell; overlong values are cut instead of letting the whole export fail.
fn text(sheet: &mut Worksheet, row: u32, col: u16, value: &str) -> Result<(), XlsxError> {
    sheet.write_string(row, col, truncate_chars(value, MAX_CELL_CHARS))?;
    Ok(())
}

/// A link as a clickable cell with a friendly text (`words`), in Excel's link style or in
/// `format`; what Excel does not take as a link (length, form, number) stays as its address
/// in text - the export never fails because of it.
fn link(
    sheet: &mut Worksheet,
    (row, links): (u32, &mut usize),
    col: u16,
    url: &str,
    words: &str,
    format: Option<&Format>,
) -> Result<(), XlsxError> {
    if url.is_empty() {
        return Ok(());
    }
    if *links < MAX_LINKS {
        let link = Url::new(url).set_text(words);
        let written = match format {
            Some(format) => sheet.write_url_with_format(row, col, link, format),
            None => sheet.write_url(row, col, link),
        };
        if written.is_ok() {
            *links += 1;
            return Ok(());
        }
    }
    text(sheet, row, col, url)
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
    use crate::export::texts::{
        COLUMNS, INFO_LAST_SCAN, INFO_NOTE_LABEL, INFO_SHEET, JOBS_SHEET, en,
    };
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
            pinned_at: None,
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

    fn cells(path: &Path, sheet: &str, row: usize) -> Vec<Data> {
        let mut book: Xlsx<_> = open_workbook(path).unwrap();
        let range = book.worksheet_range(sheet).unwrap();
        range.rows().nth(row).unwrap().to_vec()
    }

    #[test]
    fn the_columns_come_in_their_order() {
        assert_eq!(
            COLUMNS,
            [
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
                "Favorit",
                "Details",
                "Datum",
                "Anzeige",
                "Alert-Mail",
                "Job-ID",
            ]
        );
        assert_eq!(WIDTHS.len(), COLUMNS.len());
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
        job.pinned_at = Some("2026-09-19T09:00:00Z".parse().unwrap());
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
        assert_eq!(first[0].to_string(), "Interim Controller");
        assert_eq!(first[1], Data::Float(83.0));
        assert_eq!(first[2].to_string(), "3/4");
        assert_eq!(first[3], Data::Empty);
        assert_eq!(first[4].to_string(), "Muster GmbH");
        assert_eq!(first[5].to_string(), "Mannheim");
        assert_eq!(first[6], Data::Float(760.0), "95 an hour is 760 a day");
        assert_eq!(first[7].to_string(), "95\u{202f}€/Std.");
        assert!(
            matches!(first[8], Data::DateTime(_)),
            "a real date: {:?}",
            first[8]
        );
        assert_eq!(first[9], Data::Float(6.0));
        assert_eq!(
            first[10],
            Data::Empty,
            "no workload until the engine reads it"
        );
        assert_eq!(first[11].to_string(), "60 bis 100\u{202f}% remote");
        assert_eq!(first[12].to_string(), "Interim");
        assert_eq!(first[13].to_string(), "linkedin.com");
        assert_eq!(first[14].to_string(), "Archiv");
        assert_eq!(first[15].to_string(), "Ja");
        assert_eq!(first[16].to_string(), "Vorhanden");
        assert!(
            matches!(first[17], Data::DateTime(_)),
            "the mail date is an Excel date"
        );
        assert_eq!(first[18].to_string(), "Anzeige öffnen");
        assert_eq!(first[19].to_string(), "Alert-Mail öffnen");
        assert_eq!(first[20].to_string(), "linkedin:4000000002");
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
            first[3].to_string(),
            "Der Tagessatz liegt unter dem Minimum im Profil."
        );
        assert_eq!(first[8].to_string(), "offen");
        let second = cells(&path, JOBS_SHEET, 2);
        assert_eq!(
            second[3].to_string(),
            "Manuell einbezogen. Der Tagessatz liegt unter dem Minimum im Profil."
        );
        assert_eq!(second[8].to_string(), "ab sofort");
        let xlsx = std::fs::read(&path).unwrap();
        let grey = EXCLUDED_GREY.hex()[1..].to_string();
        for cell in ["S2", "T2"] {
            let font = font_of(&xlsx, cell);
            assert!(
                font.contains(&grey) && font.contains("<u/>"),
                "{cell}: {font}"
            );
        }
        for cell in ["S3", "T3"] {
            let font = font_of(&xlsx, cell);
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
        let header: Vec<String> = range
            .rows()
            .next()
            .unwrap()
            .iter()
            .map(ToString::to_string)
            .collect();
        assert_eq!(header, en::COLUMNS);
        let first: Vec<&Data> = range.rows().nth(1).unwrap().iter().collect();
        assert_eq!(first[4].to_string(), "Muster GmbH");
        assert_eq!(first[7].to_string(), "€1,100/day");
        assert_eq!(first[8].to_string(), "starts now");
        assert_eq!(first[12].to_string(), "Permanent");
        assert_eq!(first[14].to_string(), "Jobs");
        assert_eq!(first[16].to_string(), "Preview");
        assert_eq!(first[18].to_string(), "Open ad");
        assert_eq!(first[19].to_string(), "Open alert email");
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
                .map(|row| range.get((row, 16)).unwrap().to_string())
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
