//! Numbers in an item: language level and required years.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// Highest language level word in a text.
pub(crate) fn level_in(text: &str) -> Option<u8> {
    let folded = fold(text);
    lex::LEVEL_WORDS
        .iter()
        .filter(|(word, _)| contains_word(&folded, word))
        .map(|&(_, level)| level)
        .max()
}

/// Required years: `mindestens 10 Jahre`, `10+ years`, `zehn Jahre`, and a range with its
/// lower and upper end (`3-5 Jahre`, `3 bis 5 Jahre`, `between 3 and 5 years`).
pub(crate) fn years_in(text: &str) -> Option<(u32, Option<u32>)> {
    let folded = fold(text);
    let words: Vec<&str> = folded
        .split(|c: char| !c.is_alphanumeric() && c != '+')
        .filter(|w| !w.is_empty())
        .collect();
    let number = |w: &str| {
        let w = w.trim_end_matches('+');
        w.parse::<u32>()
            .ok()
            .or_else(|| {
                NUMBER_WORDS
                    .iter()
                    .find(|(word, _)| *word == w)
                    .map(|&(_, n)| n)
            })
            .filter(|n| (1..=40).contains(n))
    };
    (1..words.len()).find_map(|i| {
        if !YEAR_UNITS.iter().any(|u| words[i].starts_with(u)) {
            return None;
        }
        let n = number(words[i - 1])?;
        // `3-5 Jahre` (the dash splits the words), `3 bis 5 Jahre`.
        let other = match i {
            2.. if number(words[i - 2]).is_some() => number(words[i - 2]),
            3.. if RANGE_WORDS.contains(&words[i - 2]) => number(words[i - 3]),
            _ => None,
        };
        Some(match other {
            Some(m) if m != n => (m.min(n), Some(m.max(n))),
            _ => (n, None),
        })
    })
}

/// Words between the two ends of a range of years.
pub(super) const RANGE_WORDS: &[&str] = &["bis", "to", "and", "und"];
