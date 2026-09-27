//! How to apply to an ad: the application deadline it names (`Bewerbungsfrist 15.10.2026`,
//! `apply by 31 October`) and its contact (a person, an e-mail address, a phone number).
//! Read line by line from the ad's own text, never from the other listings under it. A date
//! counts as a deadline only right after a deadline word, so a start or an end date is none;
//! a person and a phone number count only after their words, so a requirement line never
//! names a contact.

use std::sync::LazyLock;

use jiff::ToSpan;
use jiff::civil::Date;
use regex::Regex;

use super::atoms::fold;
use super::lexicon::engine as lex;

/// Longest contact value kept, in characters.
const MAX_CONTACT_CHARS: usize = 80;
/// A deadline without a year lies in the year of the posting, unless that day lies more than
/// this many days before it (`bis 15. Januar` in a December ad is next January).
const PAST_DAYS: i32 = 60;
/// Words of a name at most (`Dr. Anna Maria Brandt` has a title and three).
const NAME_WORDS: usize = 3;
/// Digits of a phone number, at least and at most (E.164 allows 15).
const PHONE_DIGITS: std::ops::RangeInclusive<usize> = 7..=15;
/// Digits of a number without a phone word, which must start with `+` (`+49 40 5550 1234`).
const BARE_PHONE_DIGITS: usize = 9;

/// The contact an ad names, each part as the ad writes it.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct Contact {
    pub name: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

/// The application deadline of an ad; `posted` (the alert mail's day) gives a date without a
/// year its year.
pub(crate) fn deadline(text: &str, posted: Option<Date>) -> Option<Date> {
    text.lines()
        .find_map(|line| line_deadline(&tokens(&fold(line)), posted))
}

/// The words of a folded line; a date keeps its dots, slashes and dashes (`15.10.2026`).
fn tokens(folded: &str) -> Vec<&str> {
    folded
        .split(|c: char| !c.is_alphanumeric() && !matches!(c, '.' | '/' | '-'))
        .map(|w| w.trim_matches(['.', '-', '/']))
        .filter(|w| !w.is_empty())
        .collect()
}

/// Whether the words at `at` are the entry `marker` (one or more words); the index after it.
fn marker_at(words: &[&str], at: usize, marker: &str) -> Option<usize> {
    let parts: Vec<&str> = marker.split(' ').collect();
    let end = at + parts.len();
    (words.get(at..end)? == parts.as_slice()).then_some(end)
}

/// The index of the first word from `at` that is not one of `fillers`.
fn past(words: &[&str], mut at: usize, fillers: &[&str]) -> usize {
    while words.get(at).is_some_and(|w| fillers.contains(w)) {
        at += 1;
    }
    at
}

fn line_deadline(words: &[&str], posted: Option<Date>) -> Option<Date> {
    (0..words.len()).find_map(|at| {
        let named = lex::DEADLINE_MARKERS
            .iter()
            .find_map(|marker| marker_at(words, at, marker));
        let from = match named {
            Some(end) => end,
            None if lex::APPLY_WORDS.contains(&words[at]) => {
                let until = past(words, at + 1, lex::APPLY_FILLERS);
                if !words
                    .get(until)
                    .is_some_and(|w| lex::UNTIL_WORDS.contains(w))
                {
                    return None;
                }
                until + 1
            }
            None => return None,
        };
        date_at(
            &words[past(words, from, lex::DEADLINE_FILLERS).min(words.len())..],
            posted,
        )
    })
}

/// A two- or four-digit year (`26`, `2026`).
fn year_of(word: &str) -> Option<i16> {
    let year = word.parse::<i16>().ok()?;
    match word.len() {
        2 => Some(2000 + year),
        4 if year > 2000 => Some(year),
        _ => None,
    }
}

/// A day or a month number of one or two digits.
fn small(word: &str) -> Option<i8> {
    word.parse::<i8>().ok().filter(|_| word.len() <= 2)
}

/// A day number, also with an English ending (`31st`).
fn day_of(word: &str) -> Option<i8> {
    let bare = lex::DAY_SUFFIXES
        .iter()
        .find_map(|s| word.strip_suffix(s))
        .unwrap_or(word);
    small(bare).filter(|d| (1..=31).contains(d))
}

fn month_of(word: &str) -> Option<i8> {
    lex::MONTHS
        .iter()
        .find(|(name, _)| *name == word)
        .map(|&(_, month)| month)
}

/// The date the words start with: `15.10.2026`, `15.10.26`, `2026-10-15`, `15.10.`,
/// `30. Oktober (2026)`, `31st October`, `October 31(, 2026)` or `Ende Oktober (2026)`.
fn date_at(words: &[&str], posted: Option<Date>) -> Option<Date> {
    let first = *words.first()?;
    let parts: Vec<&str> = first.split(['.', '/', '-']).collect();
    let (month, day, year) = match parts.as_slice() {
        [y, m, d] if first.contains('-') && y.len() == 4 => {
            return Date::new(year_of(y)?, small(m)?, small(d)?).ok();
        }
        [d, m, y] => return Date::new(year_of(y)?, small(m)?, day_of(d)?).ok(),
        [d, m] => (small(m)?, day_of(d)?, None),
        [word] => {
            if let Some(day) = day_of(word) {
                let month = month_of(words.get(1)?)?;
                (month, day, words.get(2).and_then(|w| year_of(w)))
            } else if let Some(month) = month_of(word) {
                (
                    month,
                    day_of(words.get(1)?)?,
                    words.get(2).and_then(|w| year_of(w)),
                )
            } else if lex::MONTH_END_WORDS.contains(word) {
                let month = month_of(words.get(1)?)?;
                let year = words.get(2).and_then(|w| year_of(w));
                let first_day = dated(month, 1, year, posted)?;
                return Some(first_day.last_of_month());
            } else {
                return None;
            }
        }
        _ => return None,
    };
    dated(month, day, year, posted)
}

/// A day of a month in `year`, else in the posting's year (the next one when that day lies
/// well before the posting).
fn dated(month: i8, day: i8, year: Option<i16>, posted: Option<Date>) -> Option<Date> {
    if let Some(year) = year {
        return Date::new(year, month, day).ok();
    }
    let posted = posted?;
    let this = Date::new(posted.year(), month, day).ok()?;
    if this < posted.checked_sub(PAST_DAYS.days()).ok()? {
        Date::new(posted.year() + 1, month, day).ok()
    } else {
        Some(this)
    }
}

/// The contact an ad names: the person after a contact word, the first e-mail address (one on
/// a line with a contact word first), the first phone number after a phone word or written
/// with its country code.
pub(crate) fn contact(text: &str) -> Contact {
    let lines: Vec<&str> = text.lines().collect();
    let names: Vec<(usize, String)> = lines
        .iter()
        .enumerate()
        .filter_map(|(i, line)| person(line).map(|name| (i, name)))
        .collect();
    let named_line = names.first().map(|(i, _)| *i);
    let email = named_line
        .and_then(|i| lines.get(i).and_then(|line| email_in(line)))
        .or_else(|| lines.iter().find_map(|line| email_in(line)));
    let phone = lines.iter().find_map(|line| phone_in(line));
    Contact {
        name: names.into_iter().next().map(|(_, name)| name),
        email,
        phone,
    }
}

/// Cut to `MAX_CONTACT_CHARS`, without the punctuation that ends it.
fn kept(value: &str) -> Option<String> {
    let value = value.trim().trim_end_matches(['.', ',', ';', ':']);
    (!value.is_empty()).then(|| value.chars().take(MAX_CONTACT_CHARS).collect())
}

/// The words of a line with their byte offsets (letters, digits, `-` and `'` inside).
fn spans(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut start: Option<usize> = None;
    for (at, c) in line.char_indices() {
        let inside = c.is_alphanumeric() || (start.is_some() && matches!(c, '-' | '\''));
        match (inside, start) {
            (true, None) => start = Some(at),
            (false, Some(from)) => {
                out.push((from, &line[from..at]));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(from) = start {
        out.push((from, &line[from..]));
    }
    out
}

/// The folded words of `spans`, for comparing with the lexicon.
fn folded(words: &[(usize, &str)]) -> Vec<String> {
    words.iter().map(|(_, w)| fold(w)).collect()
}

/// Whether the folded words at `at` are the entry `marker`; the index after it.
fn folded_marker(words: &[String], at: usize, marker: &str) -> Option<usize> {
    let parts: Vec<&str> = marker.split(' ').collect();
    let end = at + parts.len();
    let found = words.get(at..end)?;
    found.iter().zip(&parts).all(|(w, p)| w == p).then_some(end)
}

/// The person a line names after a contact word (a label only at the line's start).
fn person(line: &str) -> Option<String> {
    let words = spans(line);
    let folds = folded(&words);
    (0..words.len()).find_map(|at| {
        let after = lex::CONTACT_PERSON_WORDS
            .iter()
            .find_map(|marker| folded_marker(&folds, at, marker))
            .or_else(|| {
                (at == 0)
                    .then(|| {
                        lex::CONTACT_LABELS
                            .iter()
                            .find_map(|marker| folded_marker(&folds, at, marker))
                    })
                    .flatten()
            })?;
        name_from(line, &words, &folds, after)
    })
}

/// A word of a name: capitalised letters (`Brandt`, `Müller-Lüdenscheidt`, `O'Neill`).
fn name_word(word: &str, folded: &str) -> bool {
    let mut chars = word.chars();
    chars.next().is_some_and(char::is_uppercase)
        && word.chars().count() >= 2
        && word
            .chars()
            .all(|c| c.is_alphabetic() || matches!(c, '-' | '\''))
        && !lex::NOT_A_NAME.contains(&folded)
        && !lex::NOT_A_NAME_ENDINGS.iter().any(|e| folded.ends_with(e))
}

/// The name from the word at `from`: an optional title and form of address, then up to
/// `NAME_WORDS` name words in a row (nothing but spaces between them). Two name words, or a
/// form of address and one, make a name.
fn name_from(line: &str, words: &[(usize, &str)], folds: &[String], from: usize) -> Option<String> {
    let mut at = from;
    while folds
        .get(at)
        .is_some_and(|w| lex::CONTACT_FILLERS.contains(&w.as_str()))
    {
        at += 1;
    }
    let (start, _) = *words.get(at)?;
    let mut honorific = false;
    let mut titled = false;
    let mut names = 0;
    let mut end = start;
    while let (Some(&(offset, word)), Some(fold)) = (words.get(at), folds.get(at)) {
        // Only spaces, or the dot of an abbreviation (`Dr.`), between the words of a name.
        if end != start && !line[end..offset].chars().all(|c| c == ' ' || c == '.') {
            break;
        }
        if names == 0 && lex::HONORIFICS.contains(&fold.as_str()) {
            honorific = true;
        } else if names == 0 && lex::NAME_TITLES.contains(&fold.as_str()) {
            titled = true;
        } else if names < NAME_WORDS && name_word(word, fold) {
            names += 1;
        } else {
            break;
        }
        end = offset + word.len();
        at += 1;
    }
    if names >= 2 || (honorific && names == 1) || (titled && names >= 1) {
        let text = &line[start..end];
        // A form of address before a full name goes (`Herr Max Weber` is `Max Weber`).
        let text = if honorific && names >= 2 {
            let (_, rest) = text.split_once(' ')?;
            rest
        } else {
            text
        };
        kept(text)
    } else {
        None
    }
}

static EMAIL: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)\b([a-z0-9][a-z0-9._%+-]*)@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b")
        .expect("e-mail pattern")
});

/// The first e-mail address of a line that somebody answers.
fn email_in(line: &str) -> Option<String> {
    EMAIL
        .captures_iter(line)
        .find(|c| !lex::NO_REPLY.contains(&fold(&c[1]).as_str()))
        .and_then(|c| kept(&c[0]))
}

static PHONE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"\+?\(?\d[\d \t/()\-.]{5,}\d").expect("phone pattern"));
/// A date (`15.10.2026`) or an amount in thousands (`+100.000.000`): no phone number.
static NOT_PHONE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^(\d{1,2}\.\d{1,2}\.(\d{2}|\d{4})?|\+?\d{1,3}(\.\d{3})+)$")
        .expect("date or amount pattern")
});

/// A phone number: 7 to 15 digits, never a date or an amount.
fn phone_number(candidate: &str) -> Option<String> {
    let candidate = candidate.trim();
    let digits = candidate.chars().filter(char::is_ascii_digit).count();
    (PHONE_DIGITS.contains(&digits) && !NOT_PHONE.is_match(candidate))
        .then(|| candidate.chars().take(MAX_CONTACT_CHARS).collect())
}

/// The phone number of a line: after a phone word, or anywhere written with its country code.
fn phone_in(line: &str) -> Option<String> {
    let words = spans(line);
    let folds = folded(&words);
    let after = folds
        .iter()
        .position(|w| lex::PHONE_WORDS.contains(&w.as_str()))
        .and_then(|i| words.get(i).map(|(offset, word)| offset + word.len()));
    if let Some(from) = after
        && let Some(found) = PHONE
            .find_iter(&line[from..])
            .find_map(|m| phone_number(m.as_str()))
    {
        return Some(found);
    }
    PHONE
        .find_iter(line)
        .filter(|m| m.as_str().starts_with('+'))
        .filter(|m| m.as_str().chars().filter(char::is_ascii_digit).count() >= BARE_PHONE_DIGITS)
        .find_map(|m| phone_number(m.as_str()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(y: i16, m: i8, d: i8) -> Date {
        Date::new(y, m, d).expect("date")
    }

    const POSTED: Date = Date::constant(2026, 9, 24);

    #[test]
    fn deadlines_in_german_and_english() {
        for (text, expected) in [
            ("Bewerbung bis 15.10.2026", day(2026, 10, 15)),
            ("Bewerbungsfrist 30. Oktober", day(2026, 10, 30)),
            ("Bewerbungsfrist: 30. Oktober 2026.", day(2026, 10, 30)),
            ("Bewerbungsschluss ist der 15.10.26", day(2026, 10, 15)),
            (
                "Bitte bewerben Sie sich bis spätestens 15.10.2026.",
                day(2026, 10, 15),
            ),
            ("Bewerbungen gerne bis zum 20.10.", day(2026, 10, 20)),
            ("Bewerbungen bis Ende Oktober 2026", day(2026, 10, 31)),
            ("Please apply by 31 October.", day(2026, 10, 31)),
            ("Apply by 31st October 2026", day(2026, 10, 31)),
            ("Application deadline: October 31, 2026", day(2026, 10, 31)),
            ("Deadline: 2026-10-15", day(2026, 10, 15)),
            ("Applications close on 1 November", day(2026, 11, 1)),
            (
                "Start: 01.11.2026\nBewerbungsfrist 15.10.2026",
                day(2026, 10, 15),
            ),
            // The deadline before a start in the same line.
            (
                "Bewerbung bis 15.10.2026, Start 01.11.2026",
                day(2026, 10, 15),
            ),
        ] {
            assert_eq!(deadline(text, Some(POSTED)), Some(expected), "{text}");
        }
        // A day without a year well before the posting is next year's.
        assert_eq!(
            deadline("Bewerbung bis 15.01.", Some(day(2026, 12, 10))),
            Some(day(2027, 1, 15))
        );
        // A day without a year needs the posting.
        assert_eq!(deadline("Bewerbungsfrist 30. Oktober", None), None);
    }

    #[test]
    fn plain_dates_are_no_deadline() {
        for text in [
            "Start: 01.11.2026",
            "Projektstart 15.10.2026, Laufzeit bis 31.12.2026",
            "Verfügbar ab 01.10.2026",
            "Deadline-getriebenes Umfeld, Start 01.11.2026",
            "Termintreue bei Deadlines, Start 01.11.2026",
            "Bewerben Sie sich jetzt, Start am 01.11.2026",
            "Wir freuen uns auf Ihre Bewerbung. Start: 01.11.2026",
            "Bewerbung und Start 01.11.2026",
            "Einsatz bis Ende März 2027",
            "Bewerbungsfrist beachten",
            "Deadline driven, start October 2026",
        ] {
            assert_eq!(deadline(text, Some(POSTED)), None, "{text}");
        }
    }

    #[test]
    fn contacts_in_german_and_english() {
        let c = contact(
            "Rahmen\nIhre Ansprechpartnerin: Julia Brandt, julia.brandt@hanseatic.example, \
             Telefon +49 40 5550 1234",
        );
        assert_eq!(c.name.as_deref(), Some("Julia Brandt"));
        assert_eq!(c.email.as_deref(), Some("julia.brandt@hanseatic.example"));
        assert_eq!(c.phone.as_deref(), Some("+49 40 5550 1234"));
        let c = contact("Ihr Ansprechpartner ist Herr Dr. Max Weber.\nTel.: 040 / 123 456-78");
        assert_eq!(c.name.as_deref(), Some("Dr. Max Weber"));
        assert_eq!(c.phone.as_deref(), Some("040 / 123 456-78"));
        let c = contact("Kontakt: Frau Brandt, bewerbung@firma.example");
        assert_eq!(c.name.as_deref(), Some("Frau Brandt"));
        assert_eq!(c.email.as_deref(), Some("bewerbung@firma.example"));
        let c = contact("Your contact: Jane Porter (jane.porter@example.com, +44 20 7946 0000)");
        assert_eq!(c.name.as_deref(), Some("Jane Porter"));
        assert_eq!(c.email.as_deref(), Some("jane.porter@example.com"));
        assert_eq!(c.phone.as_deref(), Some("+44 20 7946 0000"));
        // An address on the contact person's line wins over an earlier one.
        let c = contact(
            "Datenschutz: privacy@firma.example\nContact person: Tom Baker, tom@firma.example",
        );
        assert_eq!(c.email.as_deref(), Some("tom@firma.example"));
        // Nobody answers a no-reply address.
        assert_eq!(contact("noreply@firma.example").email, None);
    }

    #[test]
    fn requirements_and_numbers_are_no_contact() {
        for text in [
            "• Kontakt mit Banken und Wirtschaftsprüfern",
            "• Ansprechpartner für Geschäftsführung und Banken",
            "• Erster Ansprechpartner der Controlling Teams",
            "• Ansprechpartner Geschäftsführung",
            "• Stakeholder Management, Kontakt: Personalabteilung",
            "Mobile Arbeit zu 60 % möglich, 3 Tage pro Woche",
            "Tel. Interview am 15.10.2026",
            "Jahresgehalt 95.000 €, Start 01.11.2026",
            "Die Nordlicht Energie AG versorgt über 400.000 Kunden.",
            "Telefonische Erreichbarkeit 0800 123 4567",
            "Umsatz +100.000.000 € im Jahr",
        ] {
            assert_eq!(contact(text), Contact::default(), "{text}");
        }
    }
}
