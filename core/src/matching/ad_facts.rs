//! The key facts of an ad (rate, start, duration, remote share, place, contract type,
//! salary, years), each with the passage that states it: the evidence of the hard-criteria
//! strip and the facts of the list row. The page facts come first, then the text. The
//! application deadline and the contact come from the text (`application.rs`).

use std::ops::Range;

use jiff::civil::Date;
use serde_json::Value;

use super::application::{self, Contact};
use super::atoms::fold;
use super::contract::{Contract, ContractKind};
use super::facts::{self, JobFacts, Rate, Segment, Start, fact, parse_start, stated_rate};
use super::job::contains_word;
use super::lexicon::engine as lex;
use super::limits::{self, Workload};
use super::permanent::{bonus_percent, parse_salary};
use super::types::KeyFacts;
use super::wishes::remote_share;

/// Longest duration read (ten years).
const MAX_MONTHS: u64 = 120;
/// Weeks of a month, in hundredths (a week is a 4.33rd of a month).
const WEEKS_PER_MONTH_X100: u64 = 433;
/// Words after an end marker where the end date stands (`bis Ende März 2027`).
const END_DATE_WORDS: usize = 4;

/// A value the ad states, with the byte range of the sentence (`None` for a page fact).
#[derive(Debug, Clone)]
pub(crate) struct Stated<T> {
    pub value: T,
    pub span: Option<Range<usize>>,
}

fn stated<T>(value: T, span: Option<Range<usize>>) -> Stated<T> {
    Stated { value, span }
}

/// A duration as the ad states it: months, or weeks (never rounded up to months), a range
/// with its lower end in the same unit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Duration {
    pub amount: u16,
    pub from: Option<u16>,
    pub weeks: bool,
}

impl Duration {
    fn months(amount: u16) -> Self {
        Self {
            amount,
            from: None,
            weeks: false,
        }
    }

    /// Its length in hundredths of a month: of two statements the longer one counts.
    fn centi_months(self) -> u64 {
        let amount = u64::from(self.amount);
        if self.weeks {
            amount * 10_000 / WEEKS_PER_MONTH_X100
        } else {
            amount * 100
        }
    }

    /// Is it shorter than `min` months? Weeks count as a 4.33rd of a month each; a range
    /// counts by its upper end.
    pub(crate) fn below_months(self, min: u16) -> bool {
        if self.weeks {
            u64::from(self.amount) * 100 < u64::from(min) * WEEKS_PER_MONTH_X100
        } else {
            self.amount < min
        }
    }
}

/// What the ad states about the hard criteria and the key facts.
#[derive(Debug, Clone)]
pub(crate) struct AdFacts {
    pub rate: Option<Stated<Rate>>,
    /// A rate to be agreed (`Tagessatz nach Absprache`), without an amount.
    pub rate_open: Option<Stated<()>>,
    pub start: Option<Stated<Start>>,
    /// The duration (months or weeks).
    pub months: Option<Stated<Duration>>,
    /// Remote share in percent (from, to).
    pub remote: Option<(u64, u64)>,
    /// The work location as the page states it (trimmed, may be empty).
    pub location: String,
    pub contract: ContractKind,
    /// The contract type rests on a statement (a page fact or a sentence), not on hints.
    pub contract_stated: bool,
    /// The contract type as the interface names it (`Contract::code`).
    pub contract_code: &'static str,
    pub contract_span: Option<Range<usize>>,
    /// Stated annual salary, its upper end (a monthly one times twelve).
    pub salary: Option<Stated<u64>>,
    /// The lower end of a range of salaries, per year.
    pub salary_from: Option<u64>,
    /// The share of a bonus the salary's sentence names (percent, 0 without).
    pub salary_bonus: u64,
    /// The salary is a lower bound only (`ab 100.000 €`).
    pub salary_lower_bound: bool,
    /// The currency of a salary not in euros (`CHF`).
    pub salary_currency: Option<String>,
    /// The workload in percent of a five-day week.
    pub workload: Option<Stated<Workload>>,
    /// The application deadline.
    pub deadline: Option<Date>,
    /// The contact the ad names.
    pub contact: Contact,
}

/// Reads the key facts of an ad.
pub(crate) fn read(
    job: &JobFacts<'_>,
    segments: &[Segment],
    folded: &str,
    contract: &Contract,
) -> AdFacts {
    let rate = stated_rate(job, segments).map(|(rate, span)| stated(rate, span));
    let salary = segments
        .iter()
        .find_map(|(range, f)| parse_salary(f).map(|s| (s, range, bonus_percent(f))));
    let rate_open = if rate.is_none() {
        segments
            .iter()
            .find(|(_, f)| {
                lex::RATE_WORDS.iter().any(|w| f.contains(w))
                    && lex::RATE_OPEN.iter().any(|w| f.contains(w))
            })
            .map(|(range, _)| stated((), Some(range.clone())))
    } else {
        None
    };
    let location = fact(job.facts, super::fact_key::LOCATION)
        .and_then(Value::as_str)
        .unwrap_or(job.location)
        .trim()
        .to_owned();
    let contract_fact = fact(job.facts, super::fact_key::CONTRACT).is_some();
    let contract_span = contract.spans.first().cloned();
    let start = start(job, segments);
    // An end date counts from the stated start, else from the posting date.
    let reference = match start.as_ref().map(|s| s.value) {
        Some(Start::Date(date)) => Some(date),
        _ => job.posted,
    };
    AdFacts {
        rate,
        rate_open,
        months: months(job, segments, reference),
        start,
        remote: remote_share(job, segments, folded),
        location,
        contract: contract.kind,
        contract_stated: !contract.inferred && (contract_fact || contract_span.is_some()),
        contract_code: contract.code,
        contract_span,
        salary: salary
            .as_ref()
            .map(|(s, range, _)| stated(s.per_year(), Some((*range).clone()))),
        salary_from: salary.as_ref().and_then(|(s, ..)| s.range_from_per_year()),
        salary_bonus: salary.as_ref().map_or(0, |(.., bonus)| *bonus),
        salary_lower_bound: salary.as_ref().is_some_and(|(s, ..)| s.upper.is_none()),
        salary_currency: salary
            .as_ref()
            .and_then(|(s, ..)| s.currency)
            .map(currency_code),
        workload: limits::read(job, segments),
        deadline: application::deadline(job.text, job.posted),
        contact: application::contact(job.text),
    }
}

/// The start: the page fact, else the first sentence about the start.
fn start(job: &JobFacts<'_>, segments: &[Segment]) -> Option<Stated<Start>> {
    let from_fact = fact(job.facts, super::fact_key::START)
        .and_then(Value::as_str)
        .and_then(parse_start)
        .map(|s| stated(s, None));
    from_fact.or_else(|| {
        segments
            .iter()
            .filter(|(_, f)| lex::START_WORDS.iter().any(|w| f.contains(w)))
            .find_map(|(range, f)| parse_start(f).map(|s| stated(s, Some(range.clone()))))
    })
}

/// The duration (E16-6): only a real duration statement sets months. The page fact first,
/// then the first sentence with a duration word (`Laufzeit`, `Projektdauer`, `befristet`,
/// `lexicon::DURATION_TERMS`; not `Einarbeitungsdauer`), then the first duration phrase of
/// any sentence (`für 6 Monate`, `6+ Monate`, `ein 6-monatiges Projekt`, `12 months` as a
/// clause of its own). A lead time, a notice period or years of experience are never a
/// duration (`Start in 2 Wochen`, `Kündigungsfrist 2 Wochen`,
/// `5 Jahre Erfahrung in einem Start-up`); an end date (`bis Ende März 2027`) counts from
/// `reference`, the stated start or the posting date.
fn months(
    job: &JobFacts<'_>,
    segments: &[Segment],
    reference: Option<Date>,
) -> Option<Stated<Duration>> {
    let from_fact = fact(job.facts, super::fact_key::DURATION)
        .and_then(Value::as_str)
        .and_then(|s| duration_in(&fold(s), true, reference))
        .map(|m| stated(m, None));
    let pass = |term: bool| {
        segments
            .iter()
            .filter(|(_, f)| !term || duration_term(f))
            .find_map(|(range, f)| {
                duration_in(f, term, reference).map(|m| stated(m, Some(range.clone())))
            })
    };
    from_fact.or_else(|| pass(true)).or_else(|| pass(false))
}

/// Does a sentence hold a word of `lexicon::DURATION_TERMS` (with a plural ending)?
fn duration_term(folded: &str) -> bool {
    folded.split(|c: char| !c.is_alphanumeric()).any(|w| {
        lex::DURATION_TERMS.iter().any(|t| {
            w.strip_prefix(t)
                .is_some_and(|rest| ["", "en", "s", "e"].contains(&rest))
        })
    })
}

/// The duration a sentence states (`term`: a sentence with a duration word, where every
/// amount of time counts; else only duration phrases), or its end date counted from
/// `reference` in months.
fn duration_in(folded: &str, term: bool, reference: Option<Date>) -> Option<Duration> {
    folded
        .split(lex::DURATION_CLAUSE_BREAKS)
        .filter_map(|clause| clause_duration(clause, term))
        .max_by_key(|d| d.centi_months())
        .or_else(|| end_months(folded, term, reference?).map(Duration::months))
}

/// The longest duration of a clause: months (years times twelve) or weeks, with the lower
/// end of a range (`3-6 Monate`, `für ca. 3 bis 6 Monate`).
fn clause_duration(clause: &str, term: bool) -> Option<Duration> {
    let words: Vec<&str> = clause
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    let is_number = |w: &str| w.parse::<u64>().is_ok();
    let any_part = |w: &str, parts: &[&str]| parts.iter().any(|p| w.contains(p));
    // A clause of its own (`Start October 2026, 12 months`, `6 Monate mit Option`).
    let bare = words.iter().all(|w| {
        is_number(w)
            || lex::MONTH_UNITS
                .iter()
                .chain(lex::WEEK_UNITS)
                .any(|u| w.starts_with(u))
            || lex::DURATION_FILLERS.contains(w)
    });
    let mut best: Option<Duration> = None;
    for (i, pair) in words.windows(2).enumerate() {
        let Ok(amount) = pair[0].parse::<u64>() else {
            continue;
        };
        let unit = pair[1];
        let is = |units: &[&str]| units.iter().any(|u| unit.starts_with(u));
        // The lower end of a range: a number right before (`3-6`, the dash splits the words)
        // or one word before (`3 bis 6`).
        let lower = match i {
            1.. if is_number(words[i - 1]) => words[i - 1].parse::<u64>().ok(),
            2.. if ["bis", "to"].contains(&words[i - 1]) => words[i - 2].parse::<u64>().ok(),
            _ => None,
        }
        .filter(|l| *l < amount);
        let (amount, lower, weeks, short_unit) = if is(lex::MONTH_UNITS) {
            (amount, lower, false, true)
        } else if is(lex::YEAR_UNITS) {
            (
                amount.saturating_mul(12),
                lower.map(|l| l * 12),
                false,
                false,
            )
        } else if is(lex::WEEK_UNITS) || unit.starts_with("wochig") {
            (amount, lower, true, true)
        } else {
            continue;
        };
        // The word before the amount, past a range and its qualifiers (`für ca. 3-6 Monate`).
        let head = words[..i]
            .iter()
            .rev()
            .find(|w| !is_number(w) && !lex::DURATION_QUALIFIERS.contains(w))
            .copied()
            .unwrap_or("");
        let after = &words[(i + 2).min(words.len())..(i + 4).min(words.len())];
        let lead = lex::DURATION_LEAD_WORDS.contains(&head)
            || any_part(head, lex::DURATION_LEAD_PARTS)
            || after.iter().any(|w| any_part(w, lex::DURATION_LEAD_PARTS));
        let experience = after.iter().any(|w| any_part(w, lex::DURATION_EXPERIENCE));
        if lead || experience {
            continue;
        }
        let phrase = lex::DURATION_FOR.contains(&head)
            || lex::DURATION_ADJECTIVES.iter().any(|a| unit.starts_with(a))
            || (short_unit && (bare || plus_before(clause, pair[0])));
        let Ok(amount16) = u16::try_from(amount) else {
            continue;
        };
        let duration = Duration {
            amount: amount16,
            from: lower.and_then(|l| u16::try_from(l).ok()),
            weeks,
        };
        let length = duration.centi_months();
        if (term || phrase)
            && amount >= 1
            && length <= MAX_MONTHS * 100
            && best.is_none_or(|b| length > b.centi_months())
        {
            best = Some(duration);
        }
    }
    best
}

/// `6+ Monate`: a plus right after the amount.
fn plus_before(clause: &str, amount: &str) -> bool {
    clause.match_indices(amount).any(|(at, _)| {
        clause[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_ascii_digit())
            && clause[at + amount.len()..].trim_start().starts_with('+')
    })
}

/// Months up to an end date (`bis Ende März 2027`, `bis 31.03.2027`; in a sentence without a
/// duration word only `bis Ende`), counted from `reference`, a started month counted whole.
/// An application deadline is none.
fn end_months(folded: &str, term: bool, reference: Date) -> Option<u16> {
    if lex::DEADLINE_WORDS.iter().any(|w| folded.contains(w)) {
        return None;
    }
    let markers: &[&str] = if term {
        lex::DURATION_END_MARKERS
    } else {
        lex::DURATION_END_PHRASES
    };
    let padded = format!(" {folded} ");
    let end = markers.iter().find_map(|m| {
        let (_, after) = padded.split_once(m)?;
        end_date(after)
    })?;
    if end <= reference {
        return None;
    }
    let month_index = |d: Date| i64::from(d.year()) * 12 + i64::from(d.month());
    let whole = month_index(end) - month_index(reference) + i64::from(end.day() >= reference.day());
    u64::try_from(whole)
        .ok()
        .filter(|m| (1..=MAX_MONTHS).contains(m))
        .and_then(|m| u16::try_from(m).ok())
}

/// The last day an end statement names: a date (`31.03.2027`), a month (`03/2027`,
/// `März 2027`), a quarter (`Q2 2027`) or a year (`2027`).
fn end_date(after: &str) -> Option<Date> {
    let words: Vec<&str> = after
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | '(' | ')' | ':'))
        .map(|w| w.trim_end_matches('.'))
        .filter(|w| !w.is_empty())
        .take(END_DATE_WORDS)
        .collect();
    let year = |s: &str| s.parse::<i16>().ok().filter(|y| s.len() == 4 && *y > 2000);
    let small = |s: &str| s.parse::<i8>().ok().filter(|_| s.len() <= 2);
    let last_of = |y: i16, m: i8| Date::new(y, m, 1).ok().map(Date::last_of_month);
    for (i, word) in words.iter().enumerate() {
        let parts: Vec<&str> = word.split(['.', '/']).collect();
        let found = match parts.as_slice() {
            [d, m, y] => year(y)
                .zip(small(m))
                .zip(small(d))
                .and_then(|((y, m), d)| Date::new(y, m, d).ok()),
            [m, y] => year(y).zip(small(m)).and_then(|(y, m)| last_of(y, m)),
            [y] => year(y).and_then(|y| Date::new(y, 12, 31).ok()),
            _ => None,
        };
        if found.is_some() {
            return found;
        }
        let next_year = words.get(i + 1).and_then(|w| year(w));
        if let Some(&(_, month)) = lex::MONTHS.iter().find(|(name, _)| name == word)
            && let Some(y) = next_year
        {
            return last_of(y, month);
        }
        if let Some(quarter) = word
            .strip_prefix('q')
            .and_then(|q| q.parse::<i8>().ok())
            .filter(|q| (1..=4).contains(q))
            && let Some(y) = next_year
        {
            return last_of(y, 3 * quarter);
        }
    }
    None
}

impl AdFacts {
    /// The compact facts for the list row and the reader.
    pub(crate) fn key_facts(&self) -> KeyFacts {
        let percent = |p: u64| u8::try_from(p.min(100)).unwrap_or(100);
        KeyFacts {
            rate: self
                .rate
                .as_ref()
                .map(|r| u32::try_from(r.value.upper).unwrap_or(u32::MAX)),
            hourly: self.rate.as_ref().map(|r| r.value.hourly),
            currency: self
                .rate
                .as_ref()
                .and_then(|r| r.value.currency)
                .map(currency_code),
            rate_open: self.rate_open.as_ref().map(|_| true),
            start: self.start.as_ref().map(|s| start_code(s.value)),
            months: self
                .months
                .as_ref()
                .filter(|m| !m.value.weeks)
                .map(|m| m.value.amount),
            weeks: self
                .months
                .as_ref()
                .filter(|m| m.value.weeks)
                .map(|m| m.value.amount),
            duration_from: self.months.as_ref().and_then(|m| m.value.from),
            rate_from: self
                .rate
                .as_ref()
                .and_then(|r| r.value.range_from())
                .map(|from| u32::try_from(from).unwrap_or(u32::MAX)),
            remote_from: self.remote.map(|(from, _)| percent(from)),
            remote_to: self.remote.map(|(_, to)| percent(to)),
            contract: match self.contract {
                ContractKind::Interim if self.contract_stated => Some(self.contract_code.into()),
                ContractKind::Permanent if self.contract_stated => Some("permanent".into()),
                ContractKind::Anue => Some("anue".into()),
                _ => None,
            },
            workload_from: self.workload.as_ref().and_then(|w| w.value.from),
            workload_to: self.workload.as_ref().map(|w| w.value.to),
            salary: self
                .salary
                .as_ref()
                .filter(|_| self.salary_currency.is_none())
                .map(|s| u32::try_from(s.value).unwrap_or(u32::MAX)),
            salary_lower_bound: (self.salary.is_some() && self.salary_currency.is_none())
                .then_some(self.salary_lower_bound),
            salary_from: self
                .salary_from
                .filter(|_| self.salary_currency.is_none())
                .map(|s| u32::try_from(s).unwrap_or(u32::MAX)),
            salary_bonus: (self.salary.is_some()
                && self.salary_currency.is_none()
                && self.salary_bonus > 0)
                .then(|| u8::try_from(self.salary_bonus.min(100)).unwrap_or(100)),
            deadline: self.deadline.map(|day| day.to_string()),
            contact_name: self.contact.name.clone(),
            contact_email: self.contact.email.clone(),
            contact_phone: self.contact.phone.clone(),
        }
    }
}

/// `now`, `vague` or the ISO date of a start.
pub(crate) fn start_code(start: Start) -> String {
    match start {
        Start::Now => "now".into(),
        Start::Vague => "vague".into(),
        Start::Date(date) => date.to_string(),
    }
}

/// The ISO code of a currency word (`$` is USD, `£` GBP).
pub(crate) fn currency_code(word: &str) -> String {
    match word {
        "$" => "USD".into(),
        "£" => "GBP".into(),
        other => other.to_uppercase(),
    }
}

/// Is the ad's work location in one of `allowed` (country codes)?
pub(crate) fn location_allowed(location: &str, allowed: &[String]) -> bool {
    let mut codes = facts::location_countries(location);
    // A German city without a country (`Hamburg`) is in Germany.
    let folded = fold(location);
    if codes.is_empty() && lex::GERMAN_CITIES.iter().any(|c| contains_word(&folded, c)) {
        codes.push("DE");
    }
    !codes.is_empty() && codes.iter().all(|c| allowed.iter().any(|a| a == c))
}

/// Does the location name remote work?
pub(crate) fn location_remote(location: &str) -> bool {
    contains_word(&fold(location), "remote")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn durations_in_months() {
        // A duration statement (a page's duration field, a sentence with a duration word).
        let d = |s: &str| duration_in(&fold(s), true, None);
        let m = |s: &str| d(s).filter(|d| !d.weeks).map(|d| d.amount);
        assert_eq!(m("Laufzeit: 6 Monate"), Some(6));
        assert_eq!(m("Duration 3-6 months, extension possible"), Some(6));
        assert_eq!(m("12+ Monate"), Some(12));
        assert_eq!(m("Projektdauer 1 Jahr"), Some(12));
        assert_eq!(m("Start ab sofort"), None);
        assert_eq!(m("Laufzeit bis 31.12.2026"), None);
        assert_eq!(m("Laufzeit 999 Monate"), None);
        // A range keeps its lower end; weeks stay weeks, compared as a 4.33rd of a month.
        let range = d("Laufzeit: ca. 3 bis 6 Monate").expect("range");
        assert_eq!((range.from, range.amount, range.weeks), (Some(3), 6, false));
        assert_eq!(d("Duration 3-6 months").and_then(|d| d.from), Some(3));
        let weeks = d("8 Wochen").expect("weeks");
        assert_eq!((weeks.amount, weeks.weeks), (8, true));
        assert!(d("Laufzeit 9 Wochen").expect("9").below_months(3));
        assert!(!d("Laufzeit 13 Wochen").expect("13").below_months(3));
        assert!(d("Laufzeit 2 Monate").expect("2").below_months(3));
        // Of two statements the longer one counts: 3 months against 10 weeks.
        assert_eq!(
            d("Laufzeit 10 Wochen, Verlängerung auf 3 Monate").map(|d| (d.amount, d.weeks)),
            Some((3, false))
        );
    }

    fn date(y: i16, m: i8, d: i8) -> Date {
        Date::new(y, m, d).expect("date")
    }

    /// The months of an ad's text (`reference`: the start or the posting date).
    fn text_months(text: &str, reference: Option<Date>) -> Option<(u16, String)> {
        let job = JobFacts {
            title: "Interim Controller (m/w/d)",
            text,
            location: "",
            portal: crate::portal::Portal::LinkedIn,
            facts: None,
            posted: None,
        };
        months(&job, &facts::segments(text), reference).map(|s| {
            let passage = s.span.map(|r| text[r].to_owned()).unwrap_or_default();
            (s.value.amount, passage)
        })
    }

    /// E16-6: only a real duration statement sets months: a lead time, a notice period,
    /// `Einarbeitungsdauer` and the years of a `Start-up` never do.
    #[test]
    fn e16_6_only_a_duration_statement_sets_months() {
        for (text, expected) in [
            ("Start: in 2 Wochen\nLaufzeit: 12 Monate", 12),
            ("Projektstart nach 4 Wochen Vorlauf\nLaufzeit: 2 Monate", 2),
            (
                "Start ab sofort, Kündigungsfrist 2 Wochen\nLaufzeit: 12 Monate",
                12,
            ),
            (
                "Sie haben 5 Jahre Erfahrung in einem Start-up oder Scale-up.\nLaufzeit: 2 Monate",
                2,
            ),
            ("Start: within 4 weeks\nDuration: 12 months", 12),
            ("Laufzeit: 12 Monate, Kündigungsfrist 4 Wochen", 12),
            // Real duration phrases without a duration word.
            ("Start October 2026, 12 months", 12),
            ("B2B contract for 9 months, start in October 2026", 9),
            ("Start: 01.11.2026 für 6 Monate", 6),
            ("Laufzeit 3 Monate mit Option auf Verlängerung", 3),
            ("Dauer: 6+ Monate", 6),
            ("Remote, 6+ Monate, 90 €/h", 6),
            ("Das Projekt ist befristet auf 12 Monate.", 12),
            ("Wir suchen Sie für ein 6-monatiges Projekt.", 6),
        ] {
            assert_eq!(
                text_months(text, None).map(|(m, _)| m),
                Some(expected),
                "{text}"
            );
        }
        for text in [
            "Einarbeitungsdauer ca. 2 Wochen",
            "Start: in 2 Wochen",
            "Kündigungsfrist 3 Monate",
            "Sie haben 5 Jahre Erfahrung in einem Start-up oder Scale-up.",
            "Wir suchen ab sofort einen SAP FI/CO Berater mit mindestens 5 Jahren \
             Projekterfahrung.",
            "2-3 Jahre Erfahrung im Controlling ODER FP&A, gern E-Com / Start-up",
            "Die Probezeit beträgt 6 Monate.",
        ] {
            assert_eq!(text_months(text, None), None, "{text}");
        }
        // The passage is the duration statement, not the start line before it.
        assert_eq!(
            text_months("Start: in 2 Wochen\nLaufzeit: 12 Monate", None),
            Some((12, "Laufzeit: 12 Monate".to_owned()))
        );
        // An end date counts from the start or the posting date.
        let november = Some(date(2026, 11, 1));
        assert_eq!(
            text_months("Laufzeit bis Ende März 2027", november).map(|(m, _)| m),
            Some(5)
        );
        assert_eq!(
            text_months("Einsatz bis Ende Q2 2027 in Hamburg", november).map(|(m, _)| m),
            Some(8)
        );
        assert_eq!(
            text_months("Dauer: bis 31.03.2027", Some(date(2026, 9, 23))).map(|(m, _)| m),
            Some(7)
        );
        assert_eq!(text_months("Laufzeit bis Ende März 2027", None), None);
        assert_eq!(
            text_months("Bewerbungen bis Ende Oktober 2026", Some(date(2026, 9, 1))),
            None
        );
    }
}
