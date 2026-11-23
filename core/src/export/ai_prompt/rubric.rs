//! The numbers of the rubric (`ai_rubric.de.md`): the text names each one only as a
//! placeholder (`{W_ROLE}`, `{PARTIAL}` ...), filled in here from its one source, the engine's
//! parameters (`matching::params`) and the app's bands (`model`), so no number of the rubric
//! can drift from what the app computes. The wording writes each number as its prose does
//! ([`Number`]); the tests tie the words around a number (`fast voll`, `halbieren`) to it.

use super::Wording;
use crate::matching::params::{
    CORE_OPEN_CAP, CORE_SATURATION, FIELD_VALUES, FORMAL_CAP, FRAME_STEP, JUNIOR_CAP,
    LANGUAGE_MUST_LEVEL, LEVEL_CAP, LEVEL_ONE, MUST_SATURATION, NICE_MAX, OFF_FIELD_CAP, PARTIAL,
    PERMANENT_FACTOR, SENIOR_YEARS, UNNAMED, W_CORE, W_MUSTS, W_ROLE,
};
use crate::model::{HIGH_FROM, MID_FROM};
use crate::profile::LanguageLevel;

/// A number of the rubric and how its prose writes it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Number {
    /// Points, years, a score: digits.
    Plain(u64),
    /// How many musts count: a word in a sentence.
    Count(u64),
    /// A share of a part (per-mille) as a decimal.
    Share(u64),
    /// A share of the score (per-mille) in percent.
    Percent(u64),
    /// A language level of the engine's scale.
    Language(Option<LanguageLevel>),
}

/// Every placeholder of the rubric and its number. A placeholder named after a constant
/// shows that constant; `_COST` shows what a factor takes.
fn placeholders() -> Vec<(&'static str, Number)> {
    vec![
        ("HIGH_FROM", Number::Plain(u64::from(HIGH_FROM))),
        ("MID_FROM", Number::Plain(u64::from(MID_FROM))),
        ("W_ROLE", Number::Plain(W_ROLE)),
        ("W_CORE", Number::Plain(W_CORE)),
        ("W_MUSTS", Number::Plain(W_MUSTS)),
        ("FIELD_NEAR", Number::Share(FIELD_VALUES[1])),
        ("FIELD_FAR", Number::Share(FIELD_VALUES[2])),
        ("CORE_SATURATION", Number::Count(CORE_SATURATION)),
        ("MUST_SATURATION", Number::Count(MUST_SATURATION)),
        ("UNNAMED", Number::Percent(UNNAMED)),
        ("PARTIAL", Number::Percent(PARTIAL)),
        ("NICE_MAX", Number::Plain(NICE_MAX)),
        ("FRAME_STEP_COST", Number::Percent(1000 - FRAME_STEP)),
        ("PERMANENT_COST", Number::Percent(1000 - PERMANENT_FACTOR)),
        ("PERMANENT_FACTOR", Number::Percent(PERMANENT_FACTOR)),
        ("LEVEL_ONE", Number::Percent(LEVEL_ONE)),
        (
            "LANGUAGE_MUST_LEVEL",
            Number::Language(LanguageLevel::of_engine(LANGUAGE_MUST_LEVEL)),
        ),
        ("CORE_OPEN_CAP", Number::Plain(u64::from(CORE_OPEN_CAP))),
        ("OFF_FIELD_CAP", Number::Plain(u64::from(OFF_FIELD_CAP))),
        ("FORMAL_CAP", Number::Plain(u64::from(FORMAL_CAP))),
        ("SENIOR_YEARS", Number::Plain(u64::from(SENIOR_YEARS))),
        ("JUNIOR_CAP", Number::Plain(u64::from(JUNIOR_CAP))),
        ("LEVEL_CAP", Number::Plain(u64::from(LEVEL_CAP))),
    ]
}

/// The rubric with every placeholder filled in, as `w` writes the numbers.
pub(super) fn fill(w: &dyn Wording) -> String {
    placeholders()
        .iter()
        .fold(w.words().rubric.to_owned(), |text, (name, number)| {
            text.replace(&format!("{{{name}}}"), &w.number(*number))
        })
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeSet;

    use super::super::de::German;
    use super::*;
    use crate::matching::params::LEVEL_TWO_ABOVE;

    fn raw() -> &'static str {
        German.words().rubric
    }

    fn flat(text: &str) -> String {
        text.split_whitespace().collect::<Vec<_>>().join(" ")
    }

    /// The placeholders of the text are exactly the table's, and filling leaves none.
    #[test]
    fn every_placeholder_is_filled() {
        let mut named = BTreeSet::new();
        let mut rest = raw();
        while let Some(at) = rest.find('{') {
            let end = rest[at..].find('}').expect("a closed placeholder") + at;
            named.insert(&rest[at + 1..end]);
            rest = &rest[end + 1..];
        }
        let table: BTreeSet<&str> = placeholders().iter().map(|(name, _)| *name).collect();
        assert_eq!(named, table);
        let filled = fill(&German);
        assert!(!filled.contains('{') && !filled.contains('}'), "{filled}");
    }

    /// No number of the engine is written into the text: the digits left are the scale and
    /// its bands, the numbering of the rules and the examples of a reading.
    #[test]
    fn the_rubric_writes_no_number_of_the_engine() {
        let mut text = flat(raw());
        for fixed in [
            "Passungsgrad von 0 bis 100",
            "- 90 bis 100 ",
            "- 75 bis 89 ",
            "- 50 bis 74 ",
            "- 25 bis 49 ",
            "- unter 25 ",
            "„6 Monate plus Verlängerung“",
            "„80 bis 100 %“",
        ] {
            assert!(text.contains(fixed), "{fixed}");
            text = text.replace(fixed, " ");
        }
        for rule in 1..=8 {
            text = text.replacen(&format!(" {rule}. "), " ", 1);
        }
        let left: Vec<&str> = text
            .split_whitespace()
            .filter(|w| w.chars().any(|c| c.is_ascii_digit()))
            .collect();
        assert!(left.is_empty(), "numbers written into the rubric: {left:?}");
    }

    /// The words around a number say what it does: a change of the constant changes them.
    #[test]
    fn the_words_match_the_numbers() {
        let text = flat(raw());
        for (phrase, holds) in [
            ("Gleiches Fach zählt voll", FIELD_VALUES[0] == 1000),
            ("ein fremdes nichts", FIELD_VALUES[3] == 0),
            (
                "Ein teilweise erfüllter Punkt zählt fast voll",
                (800..1000).contains(&PARTIAL),
            ),
            (
                "Eine Ebene über oder unter dem Profil kostet wenig",
                LEVEL_ONE >= 800,
            ),
            (
                "Zwei Ebenen über dem Profil halbieren Rolle und Fach",
                LEVEL_TWO_ABOVE == 500,
            ),
            (
                "eine Festanstellung ein Zehntel weniger",
                PERMANENT_FACTOR == 900,
            ),
        ] {
            assert!(text.contains(phrase), "{phrase}");
            assert!(
                holds,
                "the rubric says „{phrase}“: change its words with the constant"
            );
        }
    }

    /// German writes a number as its prose does.
    #[test]
    fn german_writes_the_numbers_as_its_prose_does() {
        let n = |number| German.number(number);
        assert_eq!(n(Number::Plain(40)), "40");
        assert_eq!(n(Number::Count(3)), "drei");
        assert_eq!(n(Number::Count(12)), "zwölf");
        assert_eq!(n(Number::Count(13)), "13");
        assert_eq!(n(Number::Share(700)), "0,7");
        assert_eq!(n(Number::Share(250)), "0,25");
        assert_eq!(n(Number::Share(1000)), "1");
        assert_eq!(n(Number::Percent(900)), "90 %");
        assert_eq!(n(Number::Percent(955)), "95,5 %");
        let c1 = LanguageLevel::of_engine(5);
        assert_eq!(n(Number::Language(c1)), "C1");
    }
}
