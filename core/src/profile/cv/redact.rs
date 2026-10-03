//! Redaction before a CV's text leaves the computer: mail addresses, phone numbers, IBANs and
//! profile links become `[removed]`; lines with a birth date or the marital status go. Dates
//! of the career (`01/2015 - 12/2020`) and figures stay. The name stays: it cannot be told
//! apart from a company reliably, and the prompt never takes it into the profile.

use std::sync::LazyLock;

use regex::Regex;

const REMOVED: &str = "[removed]";

/// Lines that are personal data as a whole (the label decides, German and English;
/// external contract - do not translate).
static PERSONAL_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"(?i)\b(?:geb\.|(?:geburtsdatum|geburtstag|geburtsort|geboren|familienstand|date of birth|birth ?date|place of birth|born|marital status)\b)",
    )
    .expect("valid regex")
});

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
    let kept: Vec<&str> = text
        .lines()
        .filter(|line| !PERSONAL_LINE.is_match(line))
        .collect();
    let text = kept.join("\n");
    let text = MAIL.replace_all(&text, REMOVED);
    let text = PROFILE_LINK.replace_all(&text, REMOVED);
    let text = IBAN.replace_all(&text, REMOVED);
    PHONE
        .replace_all(&text, |caps: &regex::Captures| {
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
}
