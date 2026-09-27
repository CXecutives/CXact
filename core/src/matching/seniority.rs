//! The level of an ad against the profile's own years of experience
//! (`berufserfahrung_jahre`), for interim and permanent roles alike (engine 18). Never an
//! exclusion, and without the profile's years no verdict at all. Whether the years an ad asks
//! for are met is the verdict of its requirement (`fit.rs`: at or below the profile's years
//! met, from four fifths on in part, below that open); here only the level of the role.
//!
//! Over-qualified (partial): a closed range whose upper end is at most half the profile's
//! years (`3-5 Jahre` for 15), and from `JUNIOR_ROLE_YEARS` on a junior role: a junior title,
//! a junior or entry level the page states (an internship, a working student) or a must that
//! asks for first professional experience. An assistant or associate level without years is
//! a check. Nothing when the ad asks for the profile's years somewhere.

use std::ops::Range;

use serde_json::json;

use super::atoms::fold;
use super::facts::Finding;
use super::job::{Item, JobDoc, contains_word};
use super::lexicon::engine as lex;
use super::params::JUNIOR_ROLE_YEARS;
use super::sections::ReqKind;
use super::types::{ReasonCode, ReasonKind};

/// Years of experience in one requirement: lower bound and, for a closed range, the
/// upper bound.
pub(crate) fn experience_years(folded: &str) -> Option<(u32, Option<u32>)> {
    // `Min. 5 years in Regulatory Affairs` and `5+ years in internal audit` state years
    // without the word experience.
    if !lex::EXPERIENCE_WORDS.iter().any(|w| folded.contains(w))
        && !lex::MIN_MARKERS.iter().any(|w| folded.contains(w))
    {
        return None;
    }
    let text = folded.replace(['–', '—'], "-");
    let words: Vec<&str> = text
        .split(|c: char| c.is_whitespace() || matches!(c, ',' | ';' | '(' | ')' | ':'))
        .filter(|w| !w.is_empty())
        .collect();
    // Years right after `davon` (`of which`) are a part of the total before them
    // (`Mehrjährige Erfahrung, davon mindestens drei Jahre in ...`): without a number in the
    // total the line states no minimum.
    let part = |i: usize| {
        (i.saturating_sub(3)..i).any(|k| {
            lex::YEARS_SUBSPAN.contains(&words[k])
                || (words[k] == "which" && k > 0 && words[k - 1] == "of")
        })
    };
    let number = |w: &str| -> Option<u32> {
        let w = w.trim_end_matches('+');
        w.parse::<u32>()
            .ok()
            .or_else(|| {
                lex::NUMBER_WORDS
                    .iter()
                    .find(|(word, _)| *word == w)
                    .map(|&(_, n)| n)
            })
            .filter(|n| (1..=40).contains(n))
    };
    let unit = |i: usize| {
        words
            .get(i)
            .is_some_and(|u| lex::YEAR_UNITS.iter().any(|y| u.starts_with(y)))
    };
    for (i, word) in words.iter().enumerate() {
        if let Some((a, b)) = word.split_once('-')
            && let (Some(a), Some(b)) = (number(a), number(b))
            && unit(i + 1)
        {
            return (!part(i)).then_some((a.min(b), Some(a.max(b))));
        }
        let Some(n) = number(word) else { continue };
        if let (Some(sep), Some(m)) = (words.get(i + 1), words.get(i + 2).and_then(|w| number(w)))
            && ["-", "bis", "to", "and"].contains(sep)
            && unit(i + 3)
        {
            return (!part(i)).then_some((n.min(m), Some(n.max(m))));
        }
        if unit(i + 1) {
            return (!part(i)).then_some((n, None));
        }
    }
    None
}

/// Junior wording in the title (`Junior`, `Werkstudent`, `Trainee`, `Berufseinstieg`).
pub(crate) fn junior_title(title: &str) -> bool {
    let folded = fold(title);
    lex::JUNIOR_TITLES.iter().any(|w| contains_word(&folded, w))
}

/// The code of the level a junior word names (`internship`, `student`, `junior`, ...); an
/// entry level without its own code is `entry`.
fn level_code(word: &str) -> &'static str {
    lex::LEVEL_CODES
        .iter()
        .find(|(w, _)| *w == word)
        .map_or("entry", |&(_, code)| code)
}

/// The junior level the title names, if any.
fn junior_level(title: &str) -> Option<&'static str> {
    let folded = fold(title);
    lex::JUNIOR_TITLES
        .iter()
        .find(|w| contains_word(&folded, w))
        .map(|w| level_code(w))
}

/// Does a must ask for first professional experience (`Erste Berufserfahrung`,
/// `Berufseinsteiger`, `Absolvent`)? Then the role is an entry-level one.
pub(crate) fn entry_level_must<'a>(items: impl IntoIterator<Item = &'a Item>) -> bool {
    items.into_iter().any(|item| {
        item.kind == ReqKind::Must && {
            let folded = fold(&item.text);
            lex::ENTRY_LEVEL_MUSTS
                .iter()
                .any(|w| contains_word(&folded, w))
        }
    })
}

/// The junior or entry level the page states in its own fields (folded), if any.
pub(crate) fn page_junior_level(page_levels: &[String]) -> Option<&'static str> {
    page_levels
        .iter()
        .map(|l| l.trim())
        .find(|l| lex::ENTRY_LEVEL_VALUES.contains(l) || *l == "junior")
        .map(level_code)
}

/// The level rule; empty without the profile's years (`total`). `page_levels`: the career
/// level and employment type the page states in its own fields (folded).
pub(crate) fn check(
    total: Option<u32>,
    title: &str,
    text: &str,
    doc: &JobDoc,
    page_levels: &[String],
) -> Vec<Finding> {
    let Some(have) = total else {
        return Vec::new();
    };
    let statements: Vec<(u32, Option<u32>, Range<usize>)> = doc
        .requirement_lines
        .iter()
        .filter_map(|range| {
            let (min, max) = experience_years(&fold(text.get(range.clone())?))?;
            Some((min, max, range.clone()))
        })
        .collect();
    // The ad asks for the profile's years somewhere: the role is not below it.
    if statements.iter().any(|(min, ..)| *min >= have) {
        return Vec::new();
    }
    let over = |params: serde_json::Value, spans: Vec<Range<usize>>| {
        vec![Finding::row(
            ReasonCode::Overqualified,
            ReasonKind::Partial,
            None,
            params,
            spans,
        )]
    };
    let top = statements.into_iter().max_by_key(|(min, ..)| *min);
    // The ad's highest years, whatever topic they name, are its level: a closed range far
    // below the profile's years.
    if let Some((min, Some(max), range)) = &top
        && 2 * max <= have
    {
        return over(
            json!({ "years": min, "max": max, "have": have }),
            vec![range.clone()],
        );
    }
    if have < JUNIOR_ROLE_YEARS {
        return Vec::new();
    }
    let junior = page_junior_level(page_levels)
        .or_else(|| junior_level(title))
        .or_else(|| entry_level_must(&doc.items).then_some("entry"));
    if let Some(level) = junior {
        return over(json!({ "level": level, "have": have }), Vec::new());
    }
    // Without years, an assistant or associate level may be below the profile.
    match page_levels
        .iter()
        .map(|l| l.trim())
        .find(|l| lex::LOW_LEVEL_VALUES.contains(l))
    {
        Some(level) if top.is_none() => vec![Finding::new(
            ReasonCode::SeniorityUnclear,
            false,
            None,
            json!({ "level": level_code(level), "have": have }),
            Vec::new(),
        )],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn years_and_titles() {
        let y = |t: &str| experience_years(&fold(t));
        assert_eq!(
            y("3-5 Jahre Berufserfahrung im Controlling"),
            Some((3, Some(5)))
        );
        assert_eq!(y("6 – 8 Jahre Erfahrung"), Some((6, Some(8))));
        assert_eq!(y("7+ years of experience in FP&A"), Some((7, None)));
        assert_eq!(
            y("At least 5 years of professional experience"),
            Some((5, None))
        );
        assert_eq!(y("Mindestens zehn Jahre Berufserfahrung"), Some((10, None)));
        assert_eq!(y("between 3 and 5 years of experience"), Some((3, Some(5))));
        assert_eq!(y("Laufzeit 2 Jahre"), None);
        assert_eq!(y("Min. 5 years in Regulatory Affairs CMC"), Some((5, None)));
        assert_eq!(y("5+ years in internal audit"), Some((5, None)));
        assert_eq!(y("8+ Jahre im Controlling"), Some((8, None)));
        // A part of the total (`davon`) is no minimum of its own.
        assert_eq!(
            y("Langjährige Praxis im Einkauf, davon mindestens zwei Jahre in leitender Rolle"),
            None
        );
        assert_eq!(
            y("Mindestens 9 Jahre Berufserfahrung, davon 4 Jahre im Treasury"),
            Some((9, None))
        );
        assert_eq!(
            y("Several years of experience in tax, of which at least 3 years in transfer pricing"),
            None
        );
        assert_eq!(
            y("Solid experience in audit, including at least 2 years at a Big Four firm"),
            None
        );
        assert!(junior_title("Junior Controller (m/w/d)"));
    }
}
