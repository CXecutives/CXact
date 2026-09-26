//! The limits of an engagement the profile sets, checked and never decided: the workload
//! the ad asks for against the days per week the consultant works (`auslastung_min_tage`,
//! `auslastung_max_tage`), and the duration against the minimum (`min_laufzeit_monate`).
//!
//! The workload is a share of a five-day week in percent: full-time is 100, `3 Tage/Woche`
//! 60, `Auslastung 80 %` 80, `20 h/Woche` 50 (40 hours are a full week), part-time without a
//! number up to 80 (no lower bound). A number of days or a percentage next to a place word
//! (`3 Tage/Woche vor Ort`, `80 % remote`) is the place of work, not the workload.

use std::ops::Range;

use serde_json::{Map, Value, json};

use super::ad_facts::{AdFacts, Stated};
use super::contract::ContractKind;
use super::facts::{Finding, HardCriteria, JobFacts, Segment, fact};
use super::job::contains_word;
use super::lexicon::engine as lex;
use super::types::{CriterionKey, ReasonCode};

/// Share of a week of one day.
const DAY_SHARE: u32 = 20;
/// Hours of a full week.
const FULL_WEEK_HOURS: u32 = 40;
/// The upper end of part-time work without a number.
pub(crate) const WORKLOAD_PART: u8 = 80;
/// Tokens around a number where a place word makes it the place of work.
const PLACE_REACH: usize = 3;

/// A workload in percent of a five-day week: `from` is unknown for part-time without a
/// number.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct Workload {
    pub from: Option<u8>,
    pub to: u8,
}

impl Workload {
    fn exact(from: u32, to: u32) -> Self {
        let share = |p: u32| u8::try_from(p.clamp(1, 100)).unwrap_or(100);
        let (low, high) = (from.min(to), from.max(to));
        Self {
            from: Some(share(low)),
            to: share(high),
        }
    }
}

/// The workload the ad states (E16-5): an explicit statement first, the first clause with a
/// workload word and a number (`Auslastung: 100 %`, `Teilzeit (20 h/Woche)`), then the first
/// sentence that says full-time or part-time; only then any other number of days or hours
/// per week, and last the page's employment type (LinkedIn's `Vollzeit` is its default, so a
/// stated `drei Tage pro Woche` beats it). A day count of home office, on-site work or travel
/// is never the workload.
pub(crate) fn read(job: &JobFacts<'_>, segments: &[Segment]) -> Option<Stated<Workload>> {
    let numeric = |cued: bool| {
        segments
            .iter()
            .filter(|(_, f)| workload_cue(f) == cued)
            .find_map(|(range, f)| {
                clauses(f)
                    .find_map(numeric_workload)
                    .map(|w| stated(w, Some(range.clone())))
            })
    };
    numeric(true)
        .or_else(|| {
            segments
                .iter()
                .find_map(|(range, f)| word_workload(f).map(|w| stated(w, Some(range.clone()))))
        })
        .or_else(|| numeric(false))
        .or_else(|| {
            fact(job.facts, super::fact_key::CONTRACT)
                .and_then(Value::as_str)
                .and_then(|value| word_workload(&super::atoms::fold(value)))
                .map(|w| stated(w, None))
        })
}

fn stated(value: Workload, span: Option<Range<usize>>) -> Stated<Workload> {
    Stated { value, span }
}

/// Does a sentence or clause hold a workload word (`Auslastung`, `Arbeitszeit`, `Vollzeit`,
/// `Teilzeit`)?
fn workload_cue(folded: &str) -> bool {
    lex::WORKLOAD_CUES.iter().any(|w| folded.contains(w))
}

/// Clauses of a sentence at `;` and at a comma that is no decimal comma (`38,5 Stunden`); a
/// parenthesis stays with its clause (`Teilzeit (50 %)`).
fn clauses(folded: &str) -> impl Iterator<Item = &str> {
    let bytes = folded.as_bytes();
    let digit = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_digit);
    let mut cuts = vec![0];
    for (i, b) in bytes.iter().enumerate() {
        let decimal = *b == b',' && i > 0 && digit(i - 1) && digit(i + 1);
        if (*b == b',' && !decimal) || *b == b';' {
            cuts.push(i);
            cuts.push(i + 1);
        }
    }
    cuts.push(folded.len());
    cuts.chunks(2)
        .map(move |pair| &folded[pair[0]..pair[1]])
        .collect::<Vec<_>>()
        .into_iter()
}

/// Words, numbers and the signs `/`, `%`, `-` of a folded clause; a decimal part stays with
/// its number (`38,5`).
fn tokens(clause: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut chars = clause.char_indices().peekable();
    while let Some((start, c)) = chars.next() {
        let kind = |c: char| {
            if c.is_ascii_digit() {
                1
            } else if c.is_alphabetic() {
                2
            } else {
                0
            }
        };
        match kind(c) {
            0 => {
                if matches!(c, '/' | '%' | '-' | '–') {
                    out.push(&clause[start..start + c.len_utf8()]);
                }
            }
            k => {
                let mut end = start + c.len_utf8();
                while let Some(&(at, next)) = chars.peek() {
                    let decimal = k == 1
                        && matches!(next, ',' | '.')
                        && clause[at + 1..].starts_with(|d: char| d.is_ascii_digit());
                    if kind(next) == k || decimal {
                        end = at + next.len_utf8();
                        chars.next();
                    } else {
                        break;
                    }
                }
                out.push(&clause[start..end]);
            }
        }
    }
    out
}

/// A number token (its whole part) or a small number word.
fn number(token: &str) -> Option<u32> {
    let whole = token.split([',', '.']).next().unwrap_or(token);
    whole.parse::<u32>().ok().or_else(|| {
        lex::WORKLOAD_NUMBER_WORDS
            .iter()
            .find(|(word, _)| *word == token)
            .map(|(_, n)| *n)
    })
}

/// A number at `i`, with the upper end of a range after it (`3-4`, `16 bis 20`); the index
/// after it.
fn range_at(tokens: &[&str], i: usize) -> Option<(u32, u32, usize)> {
    let low = number(tokens[i])?;
    if let (Some(sep), Some(high)) = (tokens.get(i + 1), tokens.get(i + 2))
        && lex::WORKLOAD_RANGE.contains(sep)
        && let Some(high) = number(high)
    {
        return Some((low, high, i + 3));
    }
    Some((low, low, i + 1))
}

/// Is a week token at `at`, after at most two words such as `pro` or `in der`? The index
/// after it.
fn week_after(tokens: &[&str], mut at: usize) -> Option<usize> {
    for _ in 0..3 {
        let token = tokens.get(at)?;
        if lex::WORKLOAD_WEEK.contains(token) {
            return Some(at + 1);
        }
        if !lex::WORKLOAD_PER.contains(token) {
            return None;
        }
        at += 1;
    }
    None
}

/// Does a place word stand in `tokens[from..to]`? A hyphen joins its words again
/// (`on-site`, `vor-Ort`).
fn place_near(tokens: &[&str], from: usize, to: usize) -> bool {
    let to = to.min(tokens.len());
    let window = tokens[from.min(to)..to].join(" ").replace(" - ", "-");
    lex::WORKLOAD_PLACE_WORDS
        .iter()
        .any(|w| contains_word(&window, w))
}

/// A workload with a number: days or hours per week, or a percentage in a clause with a
/// workload word.
fn numeric_workload(clause: &str) -> Option<Workload> {
    let tokens = tokens(clause);
    let cue = workload_cue(clause);
    for i in 0..tokens.len() {
        let Some((low, high, next)) = range_at(&tokens, i) else {
            continue;
        };
        let Some(unit) = tokens.get(next) else {
            continue;
        };
        let before = i.saturating_sub(PLACE_REACH);
        if *unit == "%" {
            // `80 - 100 %` reads its range; `80 % - 100 %` too.
            let (high, end) = match (tokens.get(next + 1), tokens.get(next + 2)) {
                (Some(sep), Some(upper)) if lex::WORKLOAD_RANGE.contains(sep) => {
                    match number(upper).filter(|_| tokens.get(next + 3) == Some(&"%")) {
                        Some(upper) => (upper, next + 4),
                        None => (high, next + 1),
                    }
                }
                _ => (high, next + 1),
            };
            if cue && high <= 100 && !place_near(&tokens, end, end + 2) {
                return Some(Workload::exact(low, high));
            }
            continue;
        }
        // After the unit and the week the place of work may follow anywhere up to the next
        // number (`2 Tage pro Woche sind im Home Office möglich`; `4 Tage pro Woche mit 1 Tag
        // remote` keeps its 4 days).
        let place = |end: usize| {
            let stop = (end..tokens.len())
                .find(|&k| number(tokens[k]).is_some())
                .unwrap_or(tokens.len());
            place_near(&tokens, before, i) || place_near(&tokens, end, stop)
        };
        if lex::WORKLOAD_WEEKLY_HOURS.contains(unit) && !place(next + 1) {
            return hours(low, high);
        }
        let Some(end) = week_after(&tokens, next + 1) else {
            continue;
        };
        if place(end) {
            continue;
        }
        if lex::WORKLOAD_DAY_UNITS.contains(unit) && (1..=5).contains(&high) {
            return Some(Workload::exact(low * DAY_SHARE, high * DAY_SHARE));
        }
        if lex::WORKLOAD_HOUR_UNITS.contains(unit) {
            return hours(low, high);
        }
    }
    None
}

fn hours(low: u32, high: u32) -> Option<Workload> {
    let share = |h: u32| h * 100 / FULL_WEEK_HOURS;
    (high > 0 && high <= 60).then(|| Workload::exact(share(low), share(high)))
}

/// Full-time or part-time in the words of a sentence.
fn word_workload(sentence: &str) -> Option<Workload> {
    let has = |list: &[&str]| list.iter().any(|w| contains_word(sentence, w));
    let full = has(lex::WORKLOAD_FULL);
    let part = has(lex::WORKLOAD_PART_WORDS);
    let option = lex::WORKLOAD_PART_OPTION
        .iter()
        .any(|w| sentence.contains(w));
    match (full, part) {
        (false, false) => None,
        (true, false) => Some(Workload::exact(100, 100)),
        // Part-time as an option or next to full-time: anything up to full time.
        (true, true) => Some(Workload {
            from: None,
            to: 100,
        }),
        (false, true) => Some(Workload {
            from: None,
            to: if option { 100 } else { WORKLOAD_PART },
        }),
    }
}

/// The ad's workload against the profile's days per week: a check when it asks for more
/// days than the maximum or offers fewer than the minimum; never decided.
pub(crate) fn workload(criteria: &HardCriteria, ad: &AdFacts) -> Vec<Finding> {
    let (min, max) = (criteria.workload_min, criteria.workload_max);
    let Some(stated) = ad
        .workload
        .as_ref()
        .filter(|_| min.is_some() || max.is_some())
    else {
        return Vec::new();
    };
    if workload_fits(stated.value, min, max) {
        return Vec::new();
    }
    vec![Finding::new(
        ReasonCode::Workload,
        false,
        Some(CriterionKey::Workload),
        Value::Object(workload_params(stated.value, min, max)),
        stated.span.clone().into_iter().collect(),
    )]
}

/// Is the workload within the profile's days per week (as far as the ad says)?
pub(crate) fn workload_fits(w: Workload, min: Option<u8>, max: Option<u8>) -> bool {
    let share = |days: u8| u32::from(days) * DAY_SHARE;
    let above = w
        .from
        .zip(max)
        .is_some_and(|(from, max)| u32::from(from) > share(max));
    let below = min.is_some_and(|min| u32::from(w.to) < share(min));
    !above && !below
}

/// `from` (left out when unknown) and `to` of the ad in percent of a five-day week,
/// `minDays` and `maxDays` of the profile where it sets them.
pub(crate) fn workload_params(w: Workload, min: Option<u8>, max: Option<u8>) -> Map<String, Value> {
    let mut params = Map::new();
    if let Some(from) = w.from {
        params.insert("from".into(), json!(from));
    }
    params.insert("to".into(), json!(w.to));
    if let Some(min) = min {
        params.insert("minDays".into(), json!(min));
    }
    if let Some(max) = max {
        params.insert("maxDays".into(), json!(max));
    }
    params
}

/// An engagement shorter than the profile's minimum: a check (a permanent role has no end).
pub(crate) fn duration(criteria: &HardCriteria, ad: &AdFacts) -> Vec<Finding> {
    let (Some(min), Some(months)) = (criteria.min_months, ad.months.as_ref()) else {
        return Vec::new();
    };
    if ad.contract == ContractKind::Permanent || months.value >= min {
        return Vec::new();
    }
    vec![Finding::new(
        ReasonCode::Duration,
        false,
        Some(CriterionKey::Duration),
        json!({ "months": months.value, "min": min }),
        months.span.clone().into_iter().collect(),
    )]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::atoms::fold;

    fn of(text: &str) -> Option<(Option<u8>, u8)> {
        let folded = fold(text);
        clauses(&folded)
            .find_map(numeric_workload)
            .or_else(|| word_workload(&folded))
            .map(|w| (w.from, w.to))
    }

    #[test]
    fn workloads_as_a_share_of_the_week() {
        let exact = |p: u8| Some((Some(p), p));
        assert_eq!(of("Vollzeit"), exact(100));
        assert_eq!(of("Full-time position in Munich"), exact(100));
        assert_eq!(of("Auslastung: 3 Tage/Woche"), exact(60));
        assert_eq!(of("Einsatz an drei Tagen pro Woche"), exact(60));
        assert_eq!(of("4 days a week"), exact(80));
        assert_eq!(of("Auslastung 80 %"), exact(80));
        assert_eq!(of("80-100% Auslastung"), Some((Some(80), 100)));
        assert_eq!(of("20 h/Woche"), exact(50));
        assert_eq!(of("16 bis 20 Stunden pro Woche"), Some((Some(40), 50)));
        assert_eq!(of("ca. 32 Std./Woche"), exact(80));
        assert_eq!(of("38,5 Stunden pro Woche"), exact(95));
        assert_eq!(of("Teilzeit (50 %)"), exact(50));
        assert_eq!(of("20 Wochenstunden"), exact(50));
        assert_eq!(of("Teilzeit"), Some((None, WORKLOAD_PART)));
        assert_eq!(of("Part-time (20 hours/week)"), exact(50));
        assert_eq!(of("Vollzeit, Teilzeit möglich"), Some((None, 100)));
        assert_eq!(of("Voll- oder Teilzeit"), Some((None, 100)));
    }

    /// A number of days or a percentage of the place of work is no workload.
    #[test]
    fn the_place_of_work_is_no_workload() {
        for text in [
            "80 % remote",
            "Remote-Anteil 60 %",
            "Vier Tage pro Woche vor Ort in Düsseldorf",
            "3 Tage/Woche beim Kunden",
            "remote 2 Tage pro Woche",
            "2 days per week onsite",
            "Stundensatz 95 €/h",
            "Teams mit 12 Vollzeitäquivalenten",
            "Support 7 Tage die Woche",
        ] {
            assert_eq!(of(text), None, "{text}");
        }
        assert_eq!(
            of("Auslastung 100 % bei 60 % remote"),
            Some((Some(100), 100))
        );
        assert_eq!(
            of("4 Tage pro Woche, davon 2 Tage vor Ort"),
            Some((Some(80), 80))
        );
    }

    /// E16-5: a day count of home office, on-site work or travel is never the workload, also
    /// where the place follows further after the week or is written with a hyphen.
    #[test]
    fn e16_5_home_office_site_and_travel_days_are_no_workload() {
        for text in [
            "- 2 Tage pro Woche sind im Home Office möglich",
            "Sie arbeiten 2 Tage die Woche von zu Hause.",
            "2 Tage pro Woche am Standort Frankfurt",
            "Reisebereitschaft 1-2 Tage pro Woche",
            "2 days per week on-site",
            "3 Tage/Woche vor-Ort",
            "2 days a week working from home",
        ] {
            assert_eq!(of(text), None, "{text}");
        }
        // A place after a later number belongs to that number.
        assert_eq!(
            of("4 Tage pro Woche (davon 2 remote)"),
            Some((Some(80), 80))
        );
        assert_eq!(
            of("4 Tage pro Woche mit 1 Tag remote"),
            Some((Some(80), 80))
        );
    }

    /// E16-5: an explicit workload statement (`Auslastung`, `Vollzeit`) wins over any other
    /// number of days; a stated number of days beats the page's employment type.
    #[test]
    fn e16_5_an_explicit_workload_wins_over_other_numbers() {
        let read_with = |fact: Option<&str>, text: &str| {
            let facts = fact.map(|c| json!({ "contract": c }));
            let job = JobFacts {
                title: "Interim Controller (m/w/d)",
                text,
                location: "",
                portal: crate::portal::Portal::LinkedIn,
                facts: facts.as_ref(),
                posted: None,
            };
            read(&job, &crate::matching::facts::segments(text)).map(|w| (w.value.from, w.value.to))
        };
        let full = Some((Some(100), 100));
        assert_eq!(
            read_with(
                None,
                "In den ersten 4 Wochen 2 Tage pro Woche Workshops.\nAuslastung: 100 %"
            ),
            full
        );
        assert_eq!(
            read_with(
                Some("Vollzeit"),
                "- 2 Tage pro Woche sind im Home Office möglich"
            ),
            full
        );
        for text in [
            "Sie arbeiten in Vollzeit. Sie arbeiten 2 Tage die Woche von zu Hause.",
            "Sie arbeiten 2 Tage die Woche von zu Hause. Sie arbeiten in Vollzeit.",
            "Workshops an 2 Tagen pro Woche. Die Stelle ist in Vollzeit zu besetzen.",
        ] {
            assert_eq!(read_with(None, text), full, "{text}");
        }
        assert_eq!(
            read_with(Some("Vollzeit"), "Einsatz an drei Tagen pro Woche"),
            Some((Some(60), 60))
        );
    }

    #[test]
    fn a_workload_outside_the_days_is_a_check() {
        let w = |from, to| Workload { from, to };
        // Two to three days: a full-time job asks for more, one day offers less.
        assert!(!workload_fits(w(Some(100), 100), Some(2), Some(3)));
        assert!(!workload_fits(w(Some(20), 20), Some(2), Some(3)));
        assert!(workload_fits(w(Some(60), 60), Some(2), Some(3)));
        assert!(workload_fits(w(Some(40), 60), Some(2), Some(3)));
        // Part-time up to 80 %: fine for at most four days, too little for five.
        assert!(workload_fits(w(None, 80), None, Some(4)));
        assert!(!workload_fits(w(None, 80), Some(5), None));
        assert_eq!(
            Value::Object(workload_params(w(None, 80), Some(5), None)),
            json!({ "to": 80, "minDays": 5 })
        );
    }
}
