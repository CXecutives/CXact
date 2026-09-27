//! `JobAlerts.csv` (setting `exportCsv`): the same rows and columns as the Excel file's job
//! sheet ([`COLUMNS`]), printed as text in the format of the old program, which a German Excel
//! opens without an import dialog: `;` between the fields, UTF-8 with a byte order mark,
//! CRLF line ends, quotes only where a field needs them (`"` doubled), the headers in the
//! app's language, days and moments as text (`19.09.2026 14:05`), links as their address.

use std::path::Path;

use jiff::Timestamp;

use super::columns::{COLUMNS, Row, Value};
use super::texts::Texts;
use crate::error::Result;
use crate::settings::Language;
use crate::store::JobRow;

/// The byte order mark that tells Excel the file is UTF-8.
const BOM: &str = "\u{feff}";
const SEPARATOR: char = ';';
const LINE_END: &str = "\r\n";

/// Writes the CSV file in the app's language (atomically, like the Excel file: a file open
/// in Excel stays as it was, the error is `FileLocked`). `mailbox` is the Gmail address whose
/// account the alert-mail links open.
pub fn write_csv(
    path: &Path,
    jobs: &[JobRow],
    language: Language,
    mailbox: Option<&str>,
) -> Result<()> {
    let text = csv_text(jobs, language, mailbox, Timestamp::now());
    super::write_atomic(path, text.as_bytes())
}

/// The whole file as text, as of `now`.
fn csv_text(jobs: &[JobRow], language: Language, mailbox: Option<&str>, now: Timestamp) -> String {
    let texts = Texts::of(language);
    let mut out = String::from(BOM);
    line(&mut out, COLUMNS.iter().map(|c| field(c.header(language))));
    for job in jobs {
        let row = Row {
            job,
            texts,
            mailbox,
            now,
        };
        line(
            &mut out,
            COLUMNS.iter().map(|c| printed((c.value)(&row), texts)),
        );
    }
    out
}

/// One record: the fields with `;` between them, then CRLF.
fn line(out: &mut String, fields: impl Iterator<Item = String>) {
    for (i, field) in fields.enumerate() {
        if i > 0 {
            out.push(SEPARATOR);
        }
        out.push_str(&field);
    }
    out.push_str(LINE_END);
}

/// A value as the file prints it: numbers bare, days and moments in the language's form,
/// links as their address, text defused and quoted where needed.
fn printed(value: Value, texts: &Texts) -> String {
    match value {
        Value::Empty => String::new(),
        Value::Text(words) => field(&defused(&words)),
        Value::Score { score, .. } => score.to_string(),
        Value::Rate(euros) => euros.to_string(),
        Value::Months(months) => months.to_string(),
        Value::Day(day) => day.strftime(texts.day).to_string(),
        Value::Moment(at) => at.strftime(texts.moment).to_string(),
        Value::Link { url, .. } => field(&url),
    }
}

/// A field in quotes when it holds the separator, a quote or a line break (its quotes
/// doubled); as it is otherwise.
fn field(text: &str) -> String {
    if text.contains([SEPARATOR, '"', '\r', '\n']) {
        format!("\"{}\"", text.replace('"', "\"\""))
    } else {
        text.to_owned()
    }
}

/// Excel runs a cell that starts with `=`, `+`, `-` or `@` (or a tab or a carriage return) as
/// a formula - titles and subjects come from other people's mails. A leading `'` keeps it
/// text.
fn defused(text: &str) -> String {
    if text.starts_with(['=', '+', '-', '@', '\t', '\r']) {
        format!("'{text}")
    } else {
        text.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::columns::tests::{at, record, row};
    use crate::model::{DescStatus, KeyFacts, MatchStatus};

    /// The lines of a file without its byte order mark (each checked to end in CRLF).
    fn lines(text: &str) -> Vec<&str> {
        let body = text.strip_prefix(BOM).expect("a byte order mark first");
        assert!(body.ends_with(LINE_END), "the last line ends too");
        let lines: Vec<&str> = body.split_terminator(LINE_END).collect();
        assert!(
            lines.iter().all(|l| !l.contains('\n')),
            "every line ends in CRLF: {lines:?}"
        );
        lines
    }

    fn job() -> JobRow {
        let mut job = row(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "Leitung; \"Controlling\"",
            DescStatus::Ok,
        );
        let mut scored = record(MatchStatus::Scored, 83);
        scored.facts = KeyFacts {
            rate: Some(1200),
            start: Some("2026-11-01".into()),
            months: Some(6),
            contract: Some("interim".into()),
            ..KeyFacts::default()
        };
        job.match_ = Some(scored);
        job
    }

    /// The format of the old program: a byte order mark, `;`, CRLF, the header row of the
    /// table in German, a field with `;` and `"` quoted and its quotes doubled, numbers bare,
    /// days and moments as text, links as their address, a formula defused.
    #[test]
    fn the_file_is_the_familiar_csv() {
        let now: Timestamp = "2026-10-01T08:00:00Z".parse().unwrap();
        let text = csv_text(&[job()], Language::De, Some("erika@gmail.com"), now);
        let lines = lines(&text);
        assert_eq!(lines.len(), 2);
        let header: Vec<&str> = COLUMNS.iter().map(|c| c.header(Language::De)).collect();
        assert_eq!(lines[0], header.join(";"));
        assert!(
            lines[0].starts_with("Titel;Übereinstimmung;"),
            "{}",
            lines[0]
        );
        assert!(lines[0].contains(";Portal;Mail-Betreff;"), "{}", lines[0]);
        let row = lines[1];
        assert!(
            row.starts_with("\"Leitung; \"\"Controlling\"\"\";83;3/4;;Muster GmbH;Mannheim;1200;"),
            "{row}"
        );
        assert!(row.contains(";01.11.2026;6;"), "a day as text: {row}");
        assert!(
            row.contains(";linkedin.com;\"'=HYPERLINK(\"\"http://evil\"\")\";Jobs;"),
            "the subject defused and quoted: {row}"
        );
        assert!(
            row.contains(";18.09.2026 09:05;https://www.linkedin.com/jobs/view/4000000002/;"),
            "the mail's moment in local time, the ad's address: {row}"
        );
        assert!(
            row.contains(";https://mail.google.com/mail/u/erika@gmail.com/#all/1a2b;"),
            "{row}"
        );
        assert!(row.ends_with(";linkedin:4000000002"), "{row}");
        assert_eq!(
            row.matches(';').count(),
            COLUMNS.len(),
            "a field per column, and the title's own: {row}"
        );
    }

    /// In English the headers and the words are English and a day reads like the Excel
    /// file's; a job without a match leaves its fields empty.
    #[test]
    fn english_headers_and_words() {
        let now: Timestamp = "2026-10-01T08:00:00Z".parse().unwrap();
        let mut plain = job();
        plain.match_ = None;
        plain.title = "Interim CFO".into();
        let text = csv_text(&[job(), plain], Language::En, None, now);
        let lines = lines(&text);
        assert!(lines[0].starts_with("Title;Match;"), "{}", lines[0]);
        assert!(lines[0].contains(";Alert email subject;"), "{}", lines[0]);
        assert!(lines[1].contains(";01/11/2026;"), "{}", lines[1]);
        assert!(
            lines[1].contains(";Interim;;;linkedin.com;"),
            "{}",
            lines[1]
        );
        let fields: Vec<&str> = lines[2].split(';').collect();
        assert_eq!(fields.len(), COLUMNS.len());
        for key in [
            "score",
            "musts",
            "exclusion",
            "day_rate",
            "start",
            "contract",
        ] {
            assert_eq!(fields[at(key)], "", "{key}");
        }
        assert_eq!(fields[at("place")], "Jobs");
    }

    /// Only what needs it is quoted.
    #[test]
    fn quotes_only_where_needed() {
        assert_eq!(field("Muster GmbH"), "Muster GmbH");
        assert_eq!(field("a;b"), "\"a;b\"");
        assert_eq!(field("say \"hi\""), "\"say \"\"hi\"\"\"");
        assert_eq!(field("two\r\nlines"), "\"two\r\nlines\"");
        assert_eq!(defused("-5 %"), "'-5 %");
        assert_eq!(defused("@SUM(1)"), "'@SUM(1)");
        assert_eq!(defused("SAP"), "SAP");
    }

    /// Written atomically; a file open in Excel stays as it was.
    #[test]
    fn written_atomically() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(super::super::CSV_NAME);
        write_csv(&path, &[job()], Language::De, None).unwrap();
        let bytes = std::fs::read(&path).unwrap();
        assert!(
            bytes.starts_with(b"\xEF\xBB\xBF"),
            "UTF-8 with a byte order mark"
        );
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }
}
