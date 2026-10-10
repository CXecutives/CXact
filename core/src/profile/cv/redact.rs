//! Redaction before a CV's text leaves the computer: mail addresses, phone numbers, IBANs,
//! profile links and postal addresses (street and number, postcode and city) become
//! `[removed]`; lines with a birth date, the marital status, children, the nationality or the
//! religion go, and where such a label stands alone (a table cell) its value in the next line
//! goes with it. Dates of the career (`01/2015 - 12/2020`), figures, employers and the places
//! of work stay. The name stays: it cannot be told apart from a company reliably, and the
//! prompt never takes it into the profile.

use std::sync::LazyLock;

use regex::{Captures, Regex};

const REMOVED: &str = "[removed]";

/// Labels that make a line personal data wherever they stand (German and English;
/// external contract - do not translate).
static PERSONAL_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:geb\.|(?:geburtsdatum|geburtstag|geburtsort|geboren|familienstand|date of birth|birth ?date|place of birth|born|marital status|staatsangehörigkeit|staatsbürgerschaft|religionszugehörigkeit|glaubensbekenntnis|religious affiliation|anschrift|privatanschrift|privatadresse|wohnhaft)\b)",
    )
    .expect("valid regex")
});

/// Labels that mean personal data only as the label of their line: first in it and followed
/// by a colon, a slash, a tab, a dash between blanks, a number or nothing (`Kinder: 2`, but
/// not `Kinder- und Jugendhilfe`, `Corporate Citizenship` or the word inside a sentence about
/// teams or an employer; external contract - do not translate).
static PERSONAL_LABEL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)^[\s\p{P}\p{S}]*(?P<label>religion|konfession|denomination|nationalität|nationality|citizenship|kinder|children|adresse|address|home address|wohnort|residence)(?:\s*[:\t/]|\s+[–—-]\s|\s*$|\s+\d)",
    )
    .expect("valid regex")
});

/// Values that make a line personal data: the marital status, children (`verheiratet, 2
/// Kinder`, `married, two children`; external contract - do not translate).
static FAMILY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i:\b(?:verheiratet|ledig|geschieden|verwitwet|verpartnert|married|divorced|widowed)\b)|\b(?:\d{1,2}|[Ee]in|[Ee]ine|[Zz]wei|[Dd]rei|[Vv]ier|[Ff]ünf|[Kk]eine)\s+Kind(?:er|ern)?\b|(?i:\b(?:\d{1,2}|one|two|three|four|five)\s+(?:child|children|kids)\b|\bno\s+children\b)",
    )
    .expect("valid regex")
});

/// A German street with its number (`Musterstraße 12a`, `Lange Str. 5`,
/// `Kaiser-Wilhelm-Ring 3`), with the postcode and city when they follow on the line. The
/// endings that are also words of a career (`-ring`, `-ufer`, `-stieg`) only count as words
/// of their own (`Mittlerer Ring 5`); external contract - do not translate.
static STREET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b\p{Lu}[\p{L}.\-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|damm|chaussee|graben|kamp|promenade|-Ring|[ \t](?:Straße|Strasse|Str\.|Weg|Allee|Platz|Gasse|Ring|Damm|Chaussee|Ufer|Graben|Kamp|Promenade))[ \t]*\d{1,3}(?:[ \t]?[a-zA-Z])?(?:[ \t]?[-–/][ \t]?\d{1,3}[a-zA-Z]?)?\b(?:[ \t]*[,·|•]?[ \t]*(?:(?:D|DE|A|AT|CH)[ \t]?-[ \t]?)?\d{4,5}[ \t]+\p{Lu}[\p{L}\-]+)?",
    )
    .expect("valid regex")
});

/// An English street with its number (`221B Baker Street`). Endings that are also words of a
/// career or a German abbreviation (`Fast Close`, `Sales Drive`, `St.` for Stück) do not count.
static STREET_EN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b\d{1,5}[A-Za-z]?[ \t]+(?:[A-Z][a-z]+[ \t]+){1,3}(?:Street|Road|Rd|Avenue|Ave|Lane|Boulevard|Blvd|Terrace|Crescent)\b\.?",
    )
    .expect("valid regex")
});

/// A city after a postcode, with the parts of its name that follow (`Frankfurt am Main`,
/// `Halle (Saale)`).
const CITY: &str = r"\p{Lu}[\p{L}\-]+(?:[ \t]+(?:am|an[ \t]der|im|in[ \t]der|ob[ \t]der|bei|vor[ \t]der)[ \t]+\p{Lu}[\p{L}\-]+)?(?:[ \t]*\([\p{L} .]+\))?";

/// A German postcode and city where an address puts it: first on the line, or after a comma,
/// a middle dot, a bar, a tab or a wider gap (never `ISO 27001 Lead Auditor`). An Austrian
/// or Swiss one only with its country (`A-1010 Wien`), else four digits are a year.
static POSTCODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"(?P<lead>^[ \t\p{{P}}\p{{S}}]*|[,;·|•][ \t]*|\t[ \t]*| {{2,}})(?P<code>(?:(?:D|DE)[ \t]?-[ \t]?)?\d{{5}}[ \t]+(?P<city>{CITY}))|\b(?:A|AT|CH)[ \t]?-[ \t]?\d{{4}}[ \t]+{CITY}"
    ))
    .expect("valid regex")
});

/// A postcode first on the line right after a street, four digits too (`8001 Zürich`).
static POSTCODE_AFTER_STREET: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(&format!(
        r"^[ \t]*(?:(?:D|DE|A|AT|CH)[ \t]?-[ \t]?)?\d{{4,5}}[ \t]+{CITY}"
    ))
    .expect("valid regex")
});

/// A British postcode (`NW1 6XE`) and an American state with its ZIP code after a comma
/// (`Washington, DC 20500`).
static POSTCODE_EN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\b[A-Z]{1,2}\d[A-Z\d]?[ \t]\d[A-Z]{2}\b|(?P<comma>,[ \t]*)(?:AL|AK|AZ|AR|CA|CO|CT|DE|DC|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY)[ \t]+\d{5}(?:-\d{4})?\b",
    )
    .expect("valid regex")
});

/// Words a figure has after it that no city starts with (`12000 Mitarbeiter`); external
/// contract - do not translate.
const FIGURE_WORDS: [&str; 25] = [
    "Mitarbeit",
    "Beschäftigt",
    "Angestellt",
    "Kunde",
    "Nutzer",
    "User",
    "Teilnehm",
    "Mitglied",
    "Euro",
    "EUR",
    "Stunde",
    "Stück",
    "Tonne",
    "Projekt",
    "Patient",
    "Einwohner",
    "Filiale",
    "Standort",
    "Lieferant",
    "Fahrzeug",
    "Artikel",
    "Employee",
    "Customer",
    "Member",
    "Hour",
];

static MAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}")
        .expect("valid regex")
});

/// A profile on a career network carries the name in its address.
static PROFILE_LINK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)(?:https?://)?(?:[a-z]{2,3}\.)?(?:linkedin\.com/in|xing\.com/profile)/[^\s,;)]+",
    )
    .expect("valid regex")
});

static IBAN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b").expect("valid regex")
});

/// A phone number candidate: starts with `+`, `(0` or `0` and runs on in digits, blanks,
/// dashes, slashes, dots and brackets ([`is_phone`] decides).
static PHONE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"(?:\+|\(0|\b0)[0-9 ()/.\-]{5,24}[0-9]").expect("valid regex"));

/// The text with the personal data removed.
pub fn redact(text: &str) -> String {
    let mut kept = Vec::new();
    // The line after a label that stands alone is its value.
    let mut value_follows = false;
    let mut after_street = false;
    for line in text.lines() {
        if std::mem::take(&mut value_follows) && !line.trim().is_empty() {
            after_street = false;
            continue;
        }
        if let Some(alone) = personal(line) {
            value_follows = alone;
            after_street = false;
            continue;
        }
        let (line, street) = addresses(line, after_street);
        after_street = street;
        kept.push(line);
    }
    let text = kept.join("\n");
    let text = MAIL.replace_all(&text, REMOVED);
    let text = PROFILE_LINK.replace_all(&text, REMOVED);
    let text = IBAN.replace_all(&text, REMOVED);
    PHONE
        .replace_all(&text, |caps: &Captures| {
            let found = caps.get(0).expect("the whole match");
            // The tail of a larger number (`1.000.000.000`) is no phone number.
            let before = text[..found.start()].chars().next_back();
            let tail = before.is_some_and(|c| c.is_ascii_digit() || c == '.' || c == ',');
            if !tail && is_phone(found.as_str()) {
                REMOVED.to_owned()
            } else {
                found.as_str().to_owned()
            }
        })
        .into_owned()
}

/// `Some` when the line is personal data as a whole; `Some(true)` when it is a label with
/// nothing after it, so its value stands in the next line.
fn personal(line: &str) -> Option<bool> {
    let has_value = |rest: &str| rest.chars().any(char::is_alphanumeric);
    if PERSONAL_LINE.is_match(line) {
        return Some(!has_value(&PERSONAL_LINE.replace_all(line, "")));
    }
    if let Some(caps) = PERSONAL_LABEL.captures(line) {
        let label = caps.name("label").expect("the label group");
        return Some(!has_value(&line[label.end()..]));
    }
    FAMILY.is_match(line).then_some(false)
}

/// The line with its streets and postcodes removed, and whether it named a street (a
/// postcode may follow first on the next line).
fn addresses(line: &str, after_street: bool) -> (String, bool) {
    let mut street = false;
    let line = STREET.replace_all(line, |caps: &Captures| {
        let found = caps.get(0).expect("the whole match");
        // A decimal or a date goes on (`Arbeitsplatz 4.0`): no house number.
        let mut next = line[found.end()..].chars();
        let number_goes_on = matches!(
            (next.next(), next.next()),
            (Some('.' | ',' | '/'), Some(c)) if c.is_ascii_digit()
        );
        if number_goes_on {
            found.as_str().to_owned()
        } else {
            street = true;
            REMOVED.to_owned()
        }
    });
    let line = STREET_EN.replace_all(&line, |_: &Captures| {
        street = true;
        REMOVED
    });
    let line = if after_street {
        POSTCODE_AFTER_STREET.replace(&line, REMOVED)
    } else {
        line
    };
    let line = POSTCODE.replace_all(&line, |caps: &Captures| {
        let whole = caps.get(0).expect("the whole match").as_str();
        let (Some(lead), Some(city)) = (caps.name("lead"), caps.name("city")) else {
            return REMOVED.to_owned();
        };
        if FIGURE_WORDS.iter().any(|w| city.as_str().starts_with(w)) {
            whole.to_owned()
        } else {
            format!("{}{REMOVED}", lead.as_str())
        }
    });
    let line = POSTCODE_EN.replace_all(&line, |caps: &Captures| {
        let comma = caps.name("comma").map_or("", |c| c.as_str());
        format!("{comma}{REMOVED}")
    });
    (line.into_owned(), street)
}

/// 7 to 15 digits, and no date in it (`01/2015`, `1.2015`, `01.01.1970`).
fn is_phone(candidate: &str) -> bool {
    let digits = candidate.chars().filter(char::is_ascii_digit).count();
    if !(7..=15).contains(&digits) {
        return false;
    }
    let groups: Vec<&str> = candidate
        .split(|c: char| !c.is_ascii_digit())
        .filter(|g| !g.is_empty())
        .collect();
    let separators: Vec<char> = candidate
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .collect::<String>()
        .split(|c: char| c.is_ascii_digit())
        .filter(|s| !s.is_empty())
        .map(|s| s.trim().chars().next().unwrap_or(' '))
        .collect();
    !groups.windows(2).zip(&separators).any(|(pair, sep)| {
        let year = pair[1].len() == 4 && (pair[1].starts_with("19") || pair[1].starts_with("20"));
        (*sep == '/' || *sep == '.') && pair[0].len() <= 2 && year
    })
}

#[cfg(test)]
mod tests {
    use super::redact;

    #[test]
    fn removes_contact_data() {
        let text = "Max Muster\nmax.muster@example.com\nTel. +49 (0)40 1234 5678\nMobil 0170/1234567\nIBAN DE89 3704 0044 0532 0130 00\nlinkedin.com/in/max-muster";
        let redacted = redact(text);
        for gone in ["example.com", "1234 5678", "1234567", "3704", "max-muster"] {
            assert!(!redacted.contains(gone), "{gone} in {redacted}");
        }
        assert!(redacted.starts_with("Max Muster\n[removed]"));
    }

    #[test]
    fn drops_birth_date_and_marital_status_lines() {
        let text = "Geburtsdatum: 01.01.1970\nFamilienstand: ledig\ngeb. 1970 in Hamburg\nDate of birth: 1 May 1970\nMarital status: married\nControlling";
        assert_eq!(redact(text), "Controlling");
    }

    #[test]
    fn keeps_career_dates_and_figures() {
        let text = "01/2015 - 12/2020 Interim CFO\n01.03.2008 - 31.12.2014\n2015 – 2020\nUmsatz 1.000.000.000 EUR\n0,5 Mio\n15 Jahre\nBornholm";
        assert_eq!(redact(text), text);
    }

    #[test]
    fn drops_nationality_religion_and_children_lines() {
        let text = "Staatsangehörigkeit: deutsch\ndeutsche Staatsangehörigkeit\nNationalität: deutsch\nNationalität/Nationality: deutsch\nNationality: German\nCitizenship: German\nKonfession: römisch-katholisch\nReligion: evangelisch\n• Religion – keine\nKinder: 2\nKinder 2 (8 und 12 Jahre)\nverheiratet, 2 Kinder\nVater von zwei Kindern\nledig, keine Kinder\nMarried, two children\nno children\nControlling";
        assert_eq!(redact(text), "Controlling");
    }

    /// A table cell is a line of its own: the value of a label standing alone goes with it,
    /// a label with its value in the line takes nothing else along, and an empty value cell
    /// (a blank line) neither.
    #[test]
    fn drops_the_value_cell_after_a_label_standing_alone() {
        let text = "Geburtsdatum\n01.01.1970\nKonfession\nevangelisch\nStaatsangehörigkeit:\ndeutsch\nKinder\n2\nAnschrift\nAm Markt 1\nKonfession: keine\nControlling\nKinder\n\nBerufserfahrung";
        assert_eq!(redact(text), "Controlling\n\nBerufserfahrung");
    }

    #[test]
    fn removes_postal_addresses() {
        let text = "Max Muster\nMusterstraße 12\n20095 Hamburg\nLange Str. 5a, 80331 München\nKaiser-Wilhelm-Ring 3 · 50672 Köln\nD-60311 Frankfurt am Main\nMax Muster, 04109 Leipzig\nBahnhofstrasse 1\n8001 Zürich\nA-1010 Wien\n221B Baker Street\nLondon NW1 6XE\n1600 Pennsylvania Avenue, Washington, DC 20500\nAnschrift: Am Markt 1\nWohnort: Hamburg\nAddress: 10 Main Road\nAdresse\tMusterweg 3";
        assert_eq!(
            redact(text),
            "Max Muster\n[removed]\n[removed]\n[removed]\n[removed]\n[removed]\nMax Muster, [removed]\n[removed]\n[removed]\n[removed]\n[removed]\nLondon [removed]\n[removed], Washington, [removed]"
        );
    }

    /// What an address rule must not take: places of work, employers, skills, standards,
    /// figures, dates of jobs and the words a career shares with a street.
    #[test]
    fn keeps_places_of_work_skills_and_figures() {
        let text = "Berufserfahrung\n01/2015 – heute Interim CFO, Beispiel AG, Hamburg\n2010 - 2015 Leiter Controlling, Muster GmbH, München\nProjekt Werk Heidelberg 12/2016 – 03/2018\nNew York, NY, 2019 – 2021\nISO 27001 Lead Auditor\nISO/IEC 27001, EN 50128\nSAP S/4HANA, IFRS 16, Industrie 4.0, Arbeitsplatz 4.0\n12000 Mitarbeiter in 30 Ländern\n• 25000 Kunden betreut\nUmsatz 50000 Euro\nKinder- und Jugendhilfe e.V., Bereichsleitung\nCorporate Citizenship, Nachhaltigkeit\nReligionswissenschaft (Nebenfach)\nAdressmanagement, Address Validation\nMonitoring 24/7, Engineering 4.0\nVerkäufer 25 Jahre\nQuereinstieg 3 Jahre\nMonatsabschluss in 3 Tagen Fast Close\nAbsatz 500 Tsd St. pro Jahr\n15000 Tonnen pro Jahr\nTeams unterschiedlicher Nationalität geführt\nInterim GF eines Klinikverbunds katholischer Konfession\nMobilität bundesweit, unabhängig vom Wohnort\nKey Account Management\nSprachen: Deutsch, Englisch";
        assert_eq!(redact(text), text);
    }
}
