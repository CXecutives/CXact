//! The text the engine scores: an ad without its contact blocks (a person with phone and
//! e-mail), its legal and footer lines (imprint, privacy, cookies, copyright, social links)
//! and the agency's own "about us" at its end. None of them states a requirement, but their
//! words (a recruiter's job title, an agency's fields, a street) would otherwise be read as
//! the ad's.
//!
//! Every removed character becomes blanks of the same UTF-16 length and every line ending
//! stays, so each passage the engine finds lies at the same place in the stored text the
//! reader shows. The contact itself is read from the stored text, before this.
//!
//! The words below are page and mail patterns: external contract - do not translate.

use std::borrow::Cow;
use std::ops::Range;
use std::sync::LazyLock;

use regex::Regex;

/// Labels that open a contact block, as a whole line or before a colon.
const CONTACT_LABELS: &[&str] = &[
    "ihr ansprechpartner",
    "ihre ansprechpartnerin",
    "ihre ansprechpartner",
    "ihr ansprechpartner/in",
    "ansprechpartner",
    "ansprechpartnerin",
    "ansprechperson",
    "ihre ansprechperson",
    "ihr kontakt",
    "mein kontakt",
    "my contact",
    "make contact",
    "ihre kontaktperson",
    "kontaktperson",
    "kontakt",
    "kontakt aufnehmen",
    "kontaktdaten",
    "your contact",
    "your contact person",
    "contact",
    "contact person",
    "contact details",
    "ihr recruiter",
    "ihre recruiterin",
    "your recruiter",
    "e-mail",
    "email",
    "mail",
    "telefon",
    "tel",
    "phone",
    "mobil",
    "mobile",
    "fax",
];

/// Starts of a sign-off (`Mit freundlichen Grüßen`): at the end of an ad it closes the ad.
const SIGN_OFFS: &[&str] = &[
    "mit freundlichen grüßen",
    "mit freundlichen grüssen",
    "freundliche grüße",
    "viele grüße",
    "beste grüße",
    "herzliche grüße",
    "mit besten grüßen",
    "mit herzlichen grüßen",
    "herzlichen dank im voraus",
    "danke im voraus",
    "vielen dank im voraus",
    "best regards",
    "kind regards",
    "regards",
    "best wishes",
];

/// Words of a sign-off line, at most.
const SIGN_OFF_WORDS: usize = 10;

/// Words that may tie a contact label to its company (`Your contact at Example`).
const LABEL_TIES: &[&str] = &["bei", "at", "von", "from", "(m/w/d)", "(w/m/d)"];

/// Words of a line that names a phone number.
const PHONE_WORDS: &[&str] = &[
    "tel",
    "tel.",
    "telefon",
    "telefonnummer",
    "phone",
    "mobil",
    "mobile",
    "mobilnummer",
    "fon",
    "handy",
    "fax",
    "durchwahl",
];

/// Starts of a legal or footer line.
const LEGAL_STARTS: &[&str] = &[
    "©",
    "(c) 20",
    "copyright",
    "impressum",
    "datenschutzerklärung",
    "datenschutzhinweis",
    "datenschutzbestimmung",
    "datenschutzinformation",
    "datenschutzrichtlinie",
    "privacy policy",
    "privacy notice",
    "privacy statement",
    "alle rechte vorbehalten",
    "all rights reserved",
    "nutzungsbedingungen",
    "terms of use",
    "folgen sie uns",
    "follow us",
    "geschäftsführer:",
    "registergericht",
    "amtsgericht",
];

/// Words of a cookie notice besides `cookie` itself.
const COOKIE_WORDS: &[&str] = &[
    "akzeptieren",
    "zustimmen",
    "einstellungen",
    "verwenden",
    "nutzen",
    "accept",
    "settings",
    "we use",
    "this site",
    "diese website",
];

/// Names of social networks: a line of nothing else is a row of links.
const SOCIAL: &[&str] = &[
    "linkedin",
    "xing",
    "facebook",
    "instagram",
    "twitter",
    "x",
    "youtube",
    "kununu",
    "tiktok",
    "glassdoor",
    "threads",
    "teilen",
    "share",
];

/// Headings of the company's own portrait.
const ABOUT_HEADINGS: &[&str] = &[
    "über uns",
    "ueber uns",
    "about us",
    "wer wir sind",
    "who we are",
    "das sind wir",
];

/// Words of a section heading of the ad itself (its tasks, its requirements, what it
/// offers, its frame): a footer or a portrait ends there.
const SECTION_WORDS: &[&str] = &[
    "aufgabe",
    "anforderung",
    "profil",
    "qualifikation",
    "mitbringen",
    "bieten",
    "angebot",
    "benefit",
    "requirement",
    "responsibilit",
    "skills",
    "kenntnisse",
    "erfahrung",
    "rahmen",
    "voraussetzung",
    "must-have",
    "must have",
    "nice-to-have",
    "nice to have",
    "wünschenswert",
    "eckdaten",
    "projektdetails",
    "task",
    "offer",
    "what you",
    "was sie",
    "your role",
    "ihre rolle",
];

/// Starts of a line that states a fact of the job.
const FACT_STARTS: &[&str] = &[
    "start",
    "beginn",
    "projektstart",
    "dauer",
    "laufzeit",
    "projektdauer",
    "einsatzort",
    "standort",
    "arbeitsort",
    "ort:",
    "remote",
    "auslastung",
    "stundensatz",
    "tagessatz",
    "vergütung",
    "budget",
    "vertragsart",
    "anstellungsart",
    "duration",
    "location",
    "workload",
    "rate",
];

/// Words of a fact label without a colon, at most (`Start`, `Dauer`).
const FACT_WORDS: usize = 3;
/// Words of a short line, at most: a section heading.
const HEADING_WORDS: usize = 5;
/// Words of a line in a contact block, at most, unless it holds an address.
const CONTACT_LINE_WORDS: usize = 8;
/// Words of a line with an e-mail address or a phone number, at most, that goes as a whole;
/// a longer one keeps everything but the address and the number.
const ADDRESS_LINE_WORDS: usize = 12;
/// Words of a sentence with an address, at most, that closes the ad; a longer line is a
/// whole ad on one line.
const SENTENCE_WORDS: usize = 40;
/// Lines of a contact block after its label, at most.
const CONTACT_LINES: usize = 8;
/// Digits of a phone number, at least and at most (E.164 allows 15).
const PHONE_DIGITS: std::ops::RangeInclusive<usize> = 7..=15;
/// Digits of a phone number with its country code and no phone word, at least.
const BARE_PHONE_DIGITS: usize = 9;
/// Bytes before an address within which its contact label goes with it.
const LABEL_REACH: usize = 60;

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    // A portal hides some as `***@***.com`.
    Regex::new(r"[\w.+*-]+@[\w*-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}").expect("e-mail pattern")
});
static PHONE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\+|\b0)[\d \t/().\-]{6,}\d").expect("phone pattern"));

/// The ad as the engine scores it: contact, legal and footer passages blanked out; the
/// text itself when there is none.
pub fn scored_text(text: &str) -> Cow<'_, str> {
    let ranges = cuts(text);
    if ranges.is_empty() {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut cut = ranges.iter().peekable();
    for (at, c) in text.char_indices() {
        while cut.peek().is_some_and(|r| r.end <= at) {
            cut.next();
        }
        let inside = cut.peek().is_some_and(|r| r.contains(&at));
        if inside && c != '\n' {
            out.extend(std::iter::repeat_n(' ', c.len_utf16()));
        } else {
            out.push(c);
        }
    }
    Cow::Owned(out)
}

/// One line of the text: its byte range (without the line ending) and its content.
struct Line<'a> {
    range: Range<usize>,
    text: &'a str,
    /// Lower-cased, without leading bullets and the closing colon.
    key: String,
    words: usize,
}

fn lines_of(text: &str) -> Vec<Line<'_>> {
    let mut start = 0;
    text.split('\n')
        .map(|raw| {
            let range = start..start + raw.len();
            start = range.end + 1;
            let line = raw.trim_end_matches('\r');
            Line {
                range: range.start..range.start + line.len(),
                text: line,
                key: key_of(line),
                words: line.split_whitespace().count(),
            }
        })
        .collect()
}

fn key_of(line: &str) -> String {
    line.trim_start_matches(|c: char| {
        c.is_whitespace() || matches!(c, '-' | '•' | '*' | '·' | '–' | '>' | '▪' | '■')
    })
    .trim_end()
    .trim_end_matches(':')
    .trim_end()
    .to_lowercase()
}

/// The byte ranges to blank out, sorted and disjoint.
fn cuts(text: &str) -> Vec<Range<usize>> {
    let lines = lines_of(text);
    let filled: Vec<usize> = (0..lines.len())
        .filter(|&i| !lines[i].text.trim().is_empty())
        .collect();
    // A footer or a portrait counts as one from the second half of the ad on.
    let tail_from = filled.get(filled.len() / 2).copied().unwrap_or(0);
    let mut cut = vec![false; lines.len()];
    let mut ranges = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let line = &lines[i];
        let tail = i >= tail_from;
        let label = contact_label(line);
        // From the second half on, a contact, a sign-off, an application sentence with an
        // address, a legal line or the portrait close the ad: all of it goes, up to the next
        // section of the ad itself.
        let closing = tail
            && (label
                || (line.words <= SIGN_OFF_WORDS
                    && SIGN_OFFS.iter().any(|s| line.key.starts_with(s)))
                || legal(line)
                || ABOUT_HEADINGS.contains(&line.key.as_str())
                || (line.words <= SENTENCE_WORDS && has_address(line.text)));
        if closing {
            let mut j = i;
            while j < lines.len() && (j == i || !(section_heading(&lines[j]) || fact(&lines[j]))) {
                cut[j] = true;
                j += 1;
            }
            i = j;
            continue;
        }
        if label {
            cut[i] = true;
            let mut kept = 0;
            let mut j = i + 1;
            while j < lines.len() && kept < CONTACT_LINES {
                let next = &lines[j];
                if next.text.trim().is_empty() {
                    j += 1;
                    continue;
                }
                if !contact_line(next) {
                    break;
                }
                cut[j] = true;
                kept += 1;
                j += 1;
            }
            i = j;
            continue;
        }
        if legal(line) || social(line) || cookie(line) {
            cut[i] = true;
        } else if has_address(line.text) {
            if line.words <= ADDRESS_LINE_WORDS {
                cut[i] = true;
            } else {
                ranges.extend(address_spans(line));
            }
        }
        i += 1;
    }
    ranges.extend(
        lines
            .iter()
            .zip(&cut)
            .filter(|(_, cut)| **cut)
            .map(|(line, _)| line.range.clone()),
    );
    ranges.retain(|r| !r.is_empty());
    ranges.sort_by_key(|r| r.start);
    ranges
}

/// A line that opens a contact block: a contact label alone, with its company, or before a
/// colon (`Kontakt: ...`); never a task (`Ansprechpartner für ...`).
fn contact_label(line: &Line<'_>) -> bool {
    let head = line
        .text
        .split_once(':')
        .map_or(line.key.as_str(), |(head, _)| head);
    let head = key_of(head);
    if bullet(line.text) {
        return false;
    }
    head.split('/').map(str::trim).all(|part| {
        CONTACT_LABELS.iter().any(|label| {
            part.strip_prefix(label).is_some_and(|rest| {
                let rest: Vec<&str> = rest.split_whitespace().collect();
                rest.is_empty()
                    || (rest.len() <= 4 && LABEL_TIES.contains(&rest[0]))
                    || rest.iter().all(|w| LABEL_TIES.contains(w))
            })
        })
    }) && !head.is_empty()
}

/// A line of a contact block: short, or holding an address; never a bullet or the start of
/// a section.
fn contact_line(line: &Line<'_>) -> bool {
    if bullet(line.text) || section_start(line) || fact(line) {
        return false;
    }
    line.words <= CONTACT_LINE_WORDS || (has_address(line.text) && line.words <= ADDRESS_LINE_WORDS)
}

/// A line that states a fact of the job (`Dauer: 6 Monate`, `Start`, `Einsatzort`), no list
/// item: the engine reads it, so a closing block ends there.
fn fact(line: &Line<'_>) -> bool {
    !bullet(line.text)
        && (line.text.contains(':') || line.words <= FACT_WORDS)
        && FACT_STARTS.iter().any(|f| line.key.starts_with(f))
}

/// A list item: a bullet glyph, or a dash or a star before a blank (`***@***.com` is none).
fn bullet(line: &str) -> bool {
    let mut chars = line.trim_start().chars();
    match chars.next() {
        Some('•' | '·' | '–' | '▪' | '■' | '►' | '✓') => true,
        Some('-' | '*') => chars.next().is_some_and(char::is_whitespace),
        _ => false,
    }
}

/// The start of a section of the ad: its heading, or any other short line that ends with a
/// colon and is no contact label (`Hinweis:`).
fn section_start(line: &Line<'_>) -> bool {
    section_heading(line)
        || (line.words <= HEADING_WORDS
            && line.text.trim_end().ends_with(':')
            && !contact_label(line)
            && !legal(line))
}

/// A short line naming a section of the ad itself.
fn section_heading(line: &Line<'_>) -> bool {
    line.words > 0
        && line.words <= HEADING_WORDS
        && !line.text.trim_end().ends_with(['.', ','])
        && SECTION_WORDS.iter().any(|w| line.key.contains(w))
}

fn legal(line: &Line<'_>) -> bool {
    LEGAL_STARTS.iter().any(|s| line.key.starts_with(s))
}

fn cookie(line: &Line<'_>) -> bool {
    line.key.contains("cookie") && COOKIE_WORDS.iter().any(|w| line.key.contains(w))
}

/// A row of social links (`LinkedIn | Xing | Instagram`).
fn social(line: &Line<'_>) -> bool {
    let words: Vec<&str> = line
        .key
        .split(|c: char| c.is_whitespace() || matches!(c, '|' | '·' | ',' | '/' | '•'))
        .filter(|w| !w.is_empty())
        .collect();
    !words.is_empty()
        && words.iter().any(|w| *w != "x" && SOCIAL.contains(w))
        && words.iter().all(|w| SOCIAL.contains(w))
}

/// Whether the line holds an e-mail address or a phone number.
fn has_address(line: &str) -> bool {
    EMAIL.is_match(line) || !phones(line).is_empty()
}

/// The phone numbers of a line: after a phone word, written with the country code, or the
/// whole line.
fn phones(line: &str) -> Vec<Range<usize>> {
    let lower = line.to_lowercase();
    let worded = lower
        .split(|c: char| !c.is_alphanumeric() && c != '.')
        .any(|w| PHONE_WORDS.contains(&w.trim_end_matches('.')) || PHONE_WORDS.contains(&w));
    PHONE
        .find_iter(line)
        .filter(|m| {
            // Not the tail of an amount or a date (`85.000`, `1.0123`).
            !line[..m.start()].ends_with(|c: char| c.is_ascii_digit() || c == '.' || c == ',')
        })
        .filter(|m| {
            let number = m.as_str().trim_end_matches(['-', '/', '(', '.']);
            let digits = number.chars().filter(char::is_ascii_digit).count();
            PHONE_DIGITS.contains(&digits)
                && (worded
                    || (number.starts_with('+') && digits >= BARE_PHONE_DIGITS)
                    || (number.trim() == line.trim() && digits >= BARE_PHONE_DIGITS))
        })
        .map(|m| m.range())
        .collect()
}

/// In a long line: each e-mail address and phone number, from the contact label right
/// before it on.
fn address_spans(line: &Line<'_>) -> Vec<Range<usize>> {
    let mut spans: Vec<Range<usize>> = EMAIL.find_iter(line.text).map(|m| m.range()).collect();
    spans.extend(phones(line.text));
    // ASCII folding keeps every byte offset (the labels are ASCII).
    let lower = line.text.to_ascii_lowercase();
    spans
        .into_iter()
        .map(|span| {
            let from = span.start.saturating_sub(LABEL_REACH);
            let from = (0..=from)
                .rev()
                .find(|&b| lower.is_char_boundary(b))
                .unwrap_or(0);
            let label = CONTACT_LABELS
                .iter()
                .filter_map(|label| lower[from..span.start].rfind(label).map(|at| from + at))
                .min();
            label.unwrap_or(span.start)..span.end
        })
        .map(|r| line.range.start + r.start..line.range.start + r.end)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The kept lines of a scored text, without the blanked ones.
    fn kept(text: &str) -> Vec<String> {
        scored_text(text)
            .lines()
            .map(str::trim)
            .filter(|l| !l.is_empty())
            .map(str::to_owned)
            .collect()
    }

    #[test]
    fn the_text_keeps_its_offsets() {
        let text = "Aufgaben\n- SAP FI für Großkunden\n\nIhre Ansprechpartnerin\nJülia Brändt 😀\nTel.: +49 40 5550 1234\n";
        let scored = scored_text(text);
        assert_eq!(scored.encode_utf16().count(), text.encode_utf16().count());
        assert_eq!(scored.lines().count(), text.lines().count());
        assert_eq!(kept(text), ["Aufgaben", "- SAP FI für Großkunden"]);
    }

    #[test]
    fn an_ad_without_any_stays_as_it_is() {
        let text = "Ihre Aufgaben\n- Ansprechpartner für Geschäftsführung und Banken\n- Kontakt zu Behörden\nIhr Profil\n- 10 Jahre Erfahrung, 75.000 - 85.000 EUR";
        assert!(matches!(scored_text(text), Cow::Borrowed(_)));
    }

    #[test]
    fn contact_blocks_go() {
        let text = "Ihr Profil\n- Controlling\n\nIhr Ansprechpartner:\nMax Muster\nSenior Recruiter Finance\nmax.muster@agentur.example\n+49 30 1234567\n\nKontakt: Frau Brandt, bewerbung@firma.example\nYour contact at Example:\nJane Porter\nContact:\nOur team places experts in many fields across Europe since 2001.";
        assert_eq!(
            kept(text),
            [
                "Ihr Profil",
                "- Controlling",
                "Our team places experts in many fields across Europe since 2001."
            ]
        );
    }

    #[test]
    fn a_contact_block_ends_at_a_heading_and_a_list() {
        let text = "Kontakt\nAnna Beispiel\n***@***.com\nVoraussetzungen:\n- B2B-Sales\n\nZielgruppe:\n- Ansprechpartner: CFO, Head of Controlling\n- Kontakt: Einkauf";
        assert_eq!(
            kept(text),
            [
                "Voraussetzungen:",
                "- B2B-Sales",
                "Zielgruppe:",
                "- Ansprechpartner: CFO, Head of Controlling",
                "- Kontakt: Einkauf"
            ]
        );
    }

    #[test]
    fn a_sign_off_at_the_end_goes_with_its_name() {
        let text = "Aufgaben\n- Controlling\n- Planung\nProfil\n- SAP CO\nDanke im Voraus und herzliche Grüße aus Bonn,\nMax Muster";
        assert_eq!(
            kept(text),
            [
                "Aufgaben",
                "- Controlling",
                "- Planung",
                "Profil",
                "- SAP CO"
            ]
        );
    }

    #[test]
    fn a_contact_block_ends_at_the_next_section() {
        let text = "Kontakt\nAnna Beispiel\n\nIhre Aufgaben\nBudget\nForecast";
        assert_eq!(kept(text), ["Ihre Aufgaben", "Budget", "Forecast"]);
    }

    #[test]
    fn addresses_in_long_lines_go_alone() {
        let text = "Für unseren Kunden suchen wir einen Testmanager. Aufgaben Planung der Tests, Abstimmung mit den Fachbereichen, Berichte an die Projektleitung. Anforderungen Erfahrung mit Splunk und Deutsch C1 Projektdauer Ansprechpartner Max Muster max@firma.example Aktion Formular öffnen. Bitte senden Sie Ihr Profil per E-Mail an: jobs@agentur.example oder rufen Sie an unter Tel. 040 / 123 456-78 bis Freitag.";
        let scored = scored_text(text);
        assert!(!scored.contains('@'));
        assert!(!scored.contains("456"));
        assert!(!scored.contains("Ansprechpartner Max"));
        assert!(scored.contains("Erfahrung mit Splunk und Deutsch C1 Projektdauer"));
        assert!(scored.contains("Aktion Formular öffnen."));
    }

    #[test]
    fn what_follows_an_application_sentence_at_the_end_goes_too() {
        let text = "Aufgaben\n- Planung\n- Reporting\nProfil\n- Python\n- SQL\n- Excel\nPlease send your CV to jobs@agency.example with your rate.\nTower 24\n1100 Vienna\nHinweis:\nWir speichern Ihr Profil.\nWas wir bieten\n- Remote";
        assert_eq!(
            kept(text),
            [
                "Aufgaben",
                "- Planung",
                "- Reporting",
                "Profil",
                "- Python",
                "- SQL",
                "- Excel",
                "Was wir bieten",
                "- Remote"
            ]
        );
    }

    #[test]
    fn a_closing_block_ends_at_a_fact() {
        let text = "Aufgaben\n- Planung\n- Reporting\n- Steuerung\nProfil\n- Python\n- SQL\nViele Grüße\nMax Muster\nStart\n02.11.2026\nDauer:\n6 Monate";
        assert_eq!(
            kept(text)[7..],
            ["Start", "02.11.2026", "Dauer:", "6 Monate"]
        );
    }

    #[test]
    fn amounts_and_dates_are_no_phone_numbers() {
        for line in [
            "75.000 - 85.000 EUR je nach Erfahrung",
            "Start 01.10.2026, Laufzeit 6 Monate",
            "Referenz 0815-2026",
            "Budget 0,5 Mio. bis 1.000.000",
            "02.11.2026",
        ] {
            assert!(phones(line).is_empty(), "{line}");
        }
        assert_eq!(phones("+49 (0)7121 1277-0").len(), 1);
        assert_eq!(phones("Telefon: 040 / 123 456-78").len(), 1);
    }

    #[test]
    fn the_footer_goes_from_the_second_half_on() {
        let text = "Aufgaben\n- Konsolidierung\n- Reporting\nProfil\n- IFRS\n\nAgentur GmbH\ninfo@agentur.example\n\n© 2026 Agentur GmbH\nImpressum | Datenschutz\nLinkedIn | Xing";
        assert_eq!(
            kept(text),
            [
                "Aufgaben",
                "- Konsolidierung",
                "- Reporting",
                "Profil",
                "- IFRS",
                "Agentur GmbH"
            ]
        );
    }

    #[test]
    fn the_portrait_at_the_end_goes_until_the_next_section() {
        let text = "Ihre Aufgaben\n- Einkauf\n- Lieferanten\nIhr Profil\n- SAP MM\n\nÜber uns:\nWir sind seit 1990 Spezialist für Personal in Technik und Handel.\n\nWas wir bieten\n- Tagessatz 900 EUR";
        assert_eq!(
            kept(text),
            [
                "Ihre Aufgaben",
                "- Einkauf",
                "- Lieferanten",
                "Ihr Profil",
                "- SAP MM",
                "Was wir bieten",
                "- Tagessatz 900 EUR"
            ]
        );
    }

    #[test]
    fn a_portrait_at_the_start_stays() {
        let text = "Über uns:\nUnser Kunde ist ein Versicherer.\nAufgaben\n- Solvency II\n- Reporting\n- Prozesse\nProfil\n- Aktuar";
        assert!(matches!(scored_text(text), Cow::Borrowed(_)));
    }

    #[test]
    fn cookie_and_legal_lines_go_anywhere() {
        let text = "Wir verwenden Cookies, um die Website zu verbessern. Akzeptieren\nAufgaben\n- Steuern\n- Bilanz\n- Abschluss\n- Reporting";
        assert_eq!(
            kept(text),
            [
                "Aufgaben",
                "- Steuern",
                "- Bilanz",
                "- Abschluss",
                "- Reporting"
            ]
        );
    }
}

/// The scored texts of local private ads: how many still hold an address, and the
/// requirements the engine reads in the whole ad and in the scored one.
/// `JOBALERT_PRIVATE_DBS=a.db;b.db JOBALERT_PROFILE=p.json cargo test -p jobalert-core --lib -- --ignored scored_on_local`
#[cfg(test)]
mod local {
    use super::*;
    use crate::matching::{JobInput, ReasonKind, TextKind, assess, compile_profile};
    use crate::portal::Portal;

    #[test]
    #[ignore = "needs local private data"]
    fn scored_on_local_data() {
        let dbs = std::env::var("JOBALERT_PRIVATE_DBS").expect("set JOBALERT_PRIVATE_DBS");
        let profile = std::env::var("JOBALERT_PROFILE").expect("set JOBALERT_PROFILE");
        let form = crate::profile::parse(&std::fs::read_to_string(profile).expect("profile"))
            .expect("a profile");
        let profile = compile_profile(&form);
        let out = std::env::var("JOBALERT_SCORED_OUT").ok();
        let (mut ads, mut before, mut after, mut changed, mut lost) = (0, 0, 0, 0, 0);
        for db in dbs.split(';') {
            let flags = rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY;
            let conn = rusqlite::Connection::open_with_flags(db, flags).expect("db");
            let mut query = conn
                .prepare(
                    "SELECT portal, job_id, title, company, location, desc_text FROM job \
                     WHERE desc_text IS NOT NULL AND length(desc_text) > 200",
                )
                .expect("query");
            let rows = query
                .query_map([], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                        r.get::<_, String>(4)?,
                        r.get::<_, String>(5)?,
                    ))
                })
                .expect("rows");
            for row in rows {
                let (portal, id, title, company, location, text) = row.expect("row");
                let Ok(portal) = serde_json::from_value::<Portal>(portal.into()) else {
                    continue;
                };
                ads += 1;
                let scored = scored_text(&text);
                before += usize::from(text.lines().any(has_address));
                after += usize::from(scored.lines().any(has_address));
                if let Some(dir) = &out {
                    std::fs::write(format!("{dir}/{ads}.txt"), scored.as_bytes()).expect("out");
                }
                if matches!(scored, Cow::Borrowed(_)) {
                    continue;
                }
                changed += 1;
                let judge = |text: &str| {
                    let input = JobInput {
                        title: &title,
                        company: &company,
                        location: &location,
                        portal,
                        text,
                        facts: None,
                        posted: None,
                        kind: TextKind::Full,
                    };
                    let a = assess(&profile, &input, None).expect("assessment");
                    let mut labels: Vec<String> = a
                        .reasons
                        .iter()
                        .filter(|r| {
                            matches!(
                                r.kind,
                                ReasonKind::Met | ReasonKind::Partial | ReasonKind::Open
                            )
                        })
                        .filter_map(|r| r.label.clone())
                        .collect();
                    labels.sort();
                    (a.summary.must_total, a.summary.nice_total, labels, a.score)
                };
                let (whole, cut) = (judge(&text), judge(&scored));
                if whole.2 != cut.2 || whole.0 != cut.0 || whole.1 != cut.1 {
                    lost += 1;
                    let gone: Vec<&String> =
                        whole.2.iter().filter(|l| !cut.2.contains(l)).collect();
                    let new: Vec<&String> = cut.2.iter().filter(|l| !whole.2.contains(l)).collect();
                    println!(
                        "{id} {title}: musts {}->{} nice {}->{} score {}->{} gone {gone:?} new {new:?}",
                        whole.0, cut.0, whole.1, cut.1, whole.3, cut.3
                    );
                }
            }
        }
        println!(
            "ads {ads}, with an address {before} -> {after}, changed {changed}, other reasons {lost}"
        );
    }
}
