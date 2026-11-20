//! The title as the list and the Excel file show it: without the portal's reference codes,
//! without the place, the work mode and the duration a portal appends (`| Berlin | 65%
//! Remote`), without the job's own location once more at the end, and with HTML entities
//! read. The stored title stays as the portal gave it: the engine reads it whole (a contract
//! word or a remote share in a title counts).
//!
//! The frame words below are portal patterns: external contract - do not translate.

use std::sync::LazyLock;

use regex::Regex;

use crate::matching::lexicon::engine as lex;

/// Separators between the parts of a title.
const SEPARATORS: &[&str] = &[" | ", "|", " // ", "; ", " – ", " — ", " - "];

/// Words of a part that only frames the job (work mode, contract, duration, workload,
/// region), besides numbers, places and reference codes.
const FRAME_WORDS: &[&str] = &[
    "remote",
    "hybrid",
    "hybride",
    "onsite",
    "on-site",
    "offsite",
    "vor",
    "ort",
    "home",
    "office",
    "homeoffice",
    "mobil",
    "freelance",
    "freelancer",
    "freiberuflich",
    "contract",
    "contractor",
    "interim",
    "projekt",
    "project",
    "befristet",
    "monat",
    "monate",
    "monaten",
    "month",
    "months",
    "woche",
    "wochen",
    "week",
    "weeks",
    "tag",
    "tage",
    "tagen",
    "day",
    "days",
    "jahr",
    "jahre",
    "year",
    "years",
    "std",
    "std.",
    "stunden",
    "hours",
    "h",
    "vollzeit",
    "teilzeit",
    "full-time",
    "fulltime",
    "part-time",
    "auslastung",
    "workload",
    "ab",
    "sofort",
    "asap",
    "start",
    "laufzeit",
    "dauer",
    "bis",
    "from",
    "to",
    "und",
    "and",
    "oder",
    "or",
    "in",
    "im",
    "per",
    "pro",
    "für",
    "fur",
    "for",
    "mit",
    "with",
    "ca",
    "ca.",
    "min",
    "min.",
    "max",
    "max.",
    "bundesweit",
    "deutschlandweit",
    "dach",
    "europe",
    "europa",
    "eu",
    "germany",
    "deutschland",
    "region",
    "nr",
    "id",
    "ref",
    "referenz",
    "raum",
    "nähe",
    "nahe",
    "januar",
    "februar",
    "märz",
    "marz",
    "april",
    "mai",
    "juni",
    "juli",
    "august",
    "september",
    "oktober",
    "november",
    "dezember",
    "january",
    "february",
    "march",
    "may",
    "june",
    "july",
    "october",
    "december",
    "jan",
    "feb",
    "mär",
    "mar",
    "apr",
    "jun",
    "jul",
    "aug",
    "sep",
    "sept",
    "okt",
    "oct",
    "nov",
    "dez",
    "dec",
];

/// Words that only join others (`Stuttgart und Remote`): a part of nothing else frames
/// nothing.
const JOINERS: &[&str] = &[
    "und", "and", "oder", "or", "in", "im", "per", "pro", "für", "fur", "for", "mit", "with", "ab",
    "bis", "from", "to", "vor",
];

/// HTML entities by name.
const ENTITIES: &[(&str, &str)] = &[
    ("amp", "&"),
    ("nbsp", " "),
    ("quot", "\""),
    ("apos", "'"),
    ("lt", "<"),
    ("gt", ">"),
    ("ndash", "–"),
    ("mdash", "—"),
    ("auml", "ä"),
    ("ouml", "ö"),
    ("uuml", "ü"),
    ("Auml", "Ä"),
    ("Ouml", "Ö"),
    ("Uuml", "Ü"),
    ("szlig", "ß"),
    ("euro", "€"),
];

static ENTITY: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"&(#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z]{2,6});").expect("entity")
});
/// A reference code before the title (`1083872 Controller`, `F5026P2A1: Controller`).
static LEADING_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:\d{4,}|[A-Z0-9]*\d[A-Z0-9]{3,}:)\s*[-:|]?\s+").expect("leading code")
});
/// A reference code in brackets (`(ID: 2058)`, `(76037)`).
static BRACKET_CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"\s*\((?:(?i:id|nr\.?|ref\.?|referenz|projekt-?nr\.?)\s*:?\s*)?[A-Z]{0,5}[-_ ]?\d{3,}\)",
    )
    .expect("bracket code")
});
/// A reference code as a word (`JBA15221`, `AFRA-28`, `IT_2326`, `4569`).
static CODE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(?:[A-Z]{2,6}[-_]?\d{2,}|\d{4,}|[A-Z]{1,3}\d{3,}[A-Z0-9]*)$").expect("code")
});

/// The title to show: entities read, reference codes and frame parts gone; the title itself
/// when nothing is left.
pub fn tidy_title(title: &str, location: &str) -> String {
    let decoded = entities(title);
    let mut text = LEADING_CODE.replace(decoded.trim(), "").into_owned();
    text = BRACKET_CODE.replace_all(&text, "").into_owned();
    let places = place_words(location);
    // Every part that only frames the job goes, the first that names it stays.
    let all = split(&text);
    let mut parts: Vec<(&str, &str)> = Vec::new();
    for (sep, part) in &all {
        if !frame(part, &places) {
            parts.push((if parts.is_empty() { "" } else { sep }, part));
        }
    }
    let joined: String = parts.iter().flat_map(|(sep, part)| [*sep, *part]).collect();
    let out = without_frame_after_gender(&joined, &places);
    let out = out
        .trim()
        .trim_end_matches([',', ';', '-', '–', '|', '/'])
        .trim();
    if out.is_empty() {
        decoded.trim().to_owned()
    } else {
        out.to_owned()
    }
}

/// The title with its HTML entities read (`&amp;`, `&#038;`, `&#x2013;`).
pub(super) fn entities(text: &str) -> String {
    ENTITY
        .replace_all(text, |c: &regex::Captures<'_>| {
            let name = &c[1];
            let code =
                if let Some(hex) = name.strip_prefix("#x").or_else(|| name.strip_prefix("#X")) {
                    u32::from_str_radix(hex, 16).ok()
                } else if let Some(dec) = name.strip_prefix('#') {
                    dec.parse().ok()
                } else {
                    None
                };
            code.and_then(char::from_u32)
                .map(String::from)
                .or_else(|| {
                    ENTITIES
                        .iter()
                        .find(|(n, _)| *n == name)
                        .map(|(_, plain)| (*plain).to_owned())
                })
                .unwrap_or_else(|| c[0].to_owned())
        })
        .into_owned()
}

/// The parts of a title, each with the separator before it (the first with none).
fn split(text: &str) -> Vec<(&str, &str)> {
    let mut parts = Vec::new();
    let mut rest = text;
    let mut sep = "";
    while let Some((at, next)) = SEPARATORS
        .iter()
        .filter_map(|s| rest.find(s).map(|at| (at, *s)))
        .min_by_key(|&(at, s)| (at, std::cmp::Reverse(s.len())))
    {
        parts.push((sep, &rest[..at]));
        sep = next;
        rest = &rest[at + next.len()..];
    }
    parts.push((sep, rest));
    parts
}

/// Lower-cased with umlauts folded, as the place lists spell them.
fn fold(word: &str) -> String {
    word.to_lowercase()
        .replace('ä', "a")
        .replace('ö', "o")
        .replace('ü', "u")
        .replace('ß', "ss")
}

/// The words of the job's location.
fn place_words(location: &str) -> Vec<String> {
    words(location)
        .into_iter()
        .map(|w| fold(&w))
        .filter(|w| w.chars().any(char::is_alphabetic))
        .collect()
}

/// The words of a part: split at blanks and punctuation, codes kept whole.
fn words(part: &str) -> Vec<String> {
    part.split(|c: char| c.is_whitespace() || matches!(c, ',' | '/' | '(' | ')' | '&' | '+' | ':'))
        .map(|w| w.trim_matches(|c: char| matches!(c, '.' | '!' | '?' | '"' | '\'')))
        .filter(|w| !w.is_empty())
        .map(str::to_owned)
        .collect()
}

/// A word that only frames the job: a number, a share, a range, a frame word, a place, a
/// country or a reference code.
fn frame_word(word: &str, places: &[String]) -> bool {
    let folded = fold(word);
    let numeric = word
        .chars()
        .all(|c| c.is_ascii_digit() || matches!(c, '%' | '-' | '–' | '.' | ','));
    numeric
        || CODE.is_match(word)
        || FRAME_WORDS.contains(&word.to_lowercase().as_str())
        || FRAME_WORDS.contains(&folded.as_str())
        || place(&folded)
        || places.contains(&folded)
        || folded
            .split('-')
            .all(|piece| !piece.is_empty() && (place(piece) || places.iter().any(|p| p == piece)))
}

fn place(folded: &str) -> bool {
    lex::GERMAN_CITIES.contains(&folded)
        || lex::CITIES.iter().any(|(city, _)| *city == folded)
        || lex::COUNTRIES.iter().any(|(country, _)| *country == folded)
}

/// A part that only frames the job (`Berlin`, `65% Remote`, `6-12 Month Contract`, `JBA15221`).
fn frame(part: &str, places: &[String]) -> bool {
    let words = words(part);
    !words.is_empty()
        && words.iter().all(|w| frame_word(w, places))
        && words
            .iter()
            .any(|w| !JOINERS.contains(&w.to_lowercase().as_str()))
}

/// Frame words after the gender mark at the end (`Engineer (m/w/d) Munich`) go.
fn without_frame_after_gender(title: &str, places: &[String]) -> String {
    let Some(close) = title.rfind(')') else {
        return title.to_owned();
    };
    let Some(open) = title[..close].rfind('(') else {
        return title.to_owned();
    };
    let inner = fold(&title[open + 1..close]);
    let gender = lex::GENDER_MARKERS.iter().any(|m| inner.trim() == *m)
        || inner
            .split(['/', '|', ',', ' ', '-'])
            .filter(|p| !p.is_empty())
            .all(|p| lex::GENDER_LETTERS.contains(&p));
    let tail = &title[close + 1..];
    if gender && !tail.trim().is_empty() && frame(tail, places) {
        title[..=close].to_owned()
    } else {
        title.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entities_are_read() {
        assert_eq!(
            tidy_title("Leiter SAP Entwicklung &#038; Integration", ""),
            "Leiter SAP Entwicklung & Integration"
        );
        assert_eq!(
            tidy_title("R&amp;D Lead &ndash; Pumps", ""),
            "R&D Lead – Pumps"
        );
        assert_eq!(tidy_title("Head of &#x41;udit", ""), "Head of Audit");
        assert_eq!(tidy_title("Fish &chips; Co", ""), "Fish &chips; Co");
    }

    #[test]
    fn reference_codes_go() {
        assert_eq!(
            tidy_title("1083872 Montagekoordinator", ""),
            "Montagekoordinator"
        );
        assert_eq!(
            tidy_title("F12345678X1: Informationsmanager BIM", ""),
            "Informationsmanager BIM"
        );
        assert_eq!(
            tidy_title("Scrum Master (m/w/d) (ID: 2058)", ""),
            "Scrum Master (m/w/d)"
        );
        assert_eq!(tidy_title("PEGA Architect (76037)", ""), "PEGA Architect");
        assert_eq!(
            tidy_title(
                "SAP Consultant (m/w/d) | Hybrid | Walldorf | ABC12345",
                "Walldorf"
            ),
            "SAP Consultant (m/w/d)"
        );
        assert_eq!(
            tidy_title("Projektcontroller (m/w/d) Projekt Nr. 4569", ""),
            "Projektcontroller (m/w/d)"
        );
    }

    #[test]
    fn place_and_frame_tails_go() {
        let tidy = |t| tidy_title(t, "Hamburg");
        assert_eq!(
            tidy("Asset Manager (m/w/d) | München | 30% Remote | XYZ15248"),
            "Asset Manager (m/w/d)"
        );
        assert_eq!(
            tidy(
                "Release Train Engineer (m/w/d) – Automotive | Stuttgart, 1–2 Tage/Woche vor Ort | 100 % Auslastung"
            ),
            "Release Train Engineer (m/w/d) – Automotive"
        );
        assert_eq!(
            tidy("Project Manager (m/f/d) | Legal Sector | Berlin | 6–12 Month Contract"),
            "Project Manager (m/f/d) | Legal Sector"
        );
        assert_eq!(
            tidy("Projektmanager (m/w/d) - remote"),
            "Projektmanager (m/w/d)"
        );
        assert_eq!(
            tidy("Complaints Manager (w/m/d) – Berlin - September/Oktober 2026"),
            "Complaints Manager (w/m/d)"
        );
        assert_eq!(
            tidy("2x DevOps Engineer Java - 12+ Monate - Remote - Start Dez/Jan"),
            "2x DevOps Engineer Java"
        );
        assert_eq!(
            tidy("Platform Engineer (m/f/d); FREELANCE; Germany"),
            "Platform Engineer (m/f/d)"
        );
        assert_eq!(
            tidy("FREELANCE | Expediting Manager (m/w/d) | Maschinenbau"),
            "Expediting Manager (m/w/d) | Maschinenbau"
        );
        assert_eq!(
            tidy("Mitarbeiter Personal (m/w/d) | 35 Std./Woche"),
            "Mitarbeiter Personal (m/w/d)"
        );
    }

    #[test]
    fn the_jobs_own_location_at_the_end_goes() {
        assert_eq!(
            tidy_title(
                "Material Planner (m/w/d) - Rietheim-Weilheim",
                "Rietheim-Weilheim"
            ),
            "Material Planner (m/w/d)"
        );
        assert_eq!(
            tidy_title("Platform Engineer (m/f/d) Hamburg", "Hamburg"),
            "Platform Engineer (m/f/d)"
        );
        assert_eq!(
            tidy_title("Controller (m/w/d) Hamburg Hamburg", "Hamburg"),
            "Controller (m/w/d)"
        );
    }

    #[test]
    fn content_stays() {
        for title in [
            "Team Coordinator - Security Design",
            "Senior Service Manager (m/w/d) - Arbeitnehmerüberlassung",
            "Program Manager (m/w/d) | PMI / PRINCE2 | Manufacturing",
            "Site Manager Hamm (m/w/d)",
            "Interim CFO",
            "Remote",
            "Berlin",
        ] {
            assert_eq!(tidy_title(title, "Hamm"), title);
        }
    }
}
