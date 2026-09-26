//! Exclusion words of the profile (`ausschlusswoerter`): a word in the title or in the ad's
//! own text excludes the ad (decided). Whole words, case-insensitive, with the forms German
//! gives them: a word matches its inflections and the compounds it starts (`Werkstudent`:
//! `Werkstudentin`, `Werkstudenten`, `Werkstudentenstelle`), a long word also the compounds
//! it ends (`Praktikum`: `Pflichtpraktikum`), the participle of an `-ent` noun
//! (`Werkstudierende`), `-mann` as `-frau` and `-leute`, `-um` as `-a` (`Praktika`); a female
//! form in the profile (`Werkstudentin`) matches the male one too. A phrase matches word by
//! word or written as one word (`Call Center`, `Callcenter`).

use std::ops::Range;

use serde_json::json;

use super::atoms::fold;
use super::facts::{Finding, HardCriteria, Segment};
use super::types::{CriterionKey, ReasonCode};

/// Shortest form that also matches as the start of a longer word.
const PREFIX_MIN: usize = 4;
/// Shortest form that also matches as the end of a compound.
const SUFFIX_MIN: usize = 8;
/// Shortest `-ent` noun that also matches as a participle (`Student`, not `Agent`).
const PARTICIPLE_MIN: usize = 7;
/// Passages highlighted per word.
const SPANS_MAX: usize = 3;
/// Endings of an agent noun before a female ending (`Berater-in`, `Praktikant-in`).
const AGENT_ENDINGS: &[&str] = &["ent", "ant", "er", "or", "eur", "ist"];

/// One exclusion word with its folded forms (each a list of words).
struct Word<'a> {
    text: &'a str,
    forms: Vec<Vec<String>>,
}

fn words(folded: &str) -> Vec<&str> {
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect()
}

/// The word itself and the male form of a female or participle form.
fn bases(word: &str) -> Vec<String> {
    let mut out = vec![word.to_owned()];
    for ending in ["innen", "in"] {
        if let Some(stem) = word.strip_suffix(ending)
            && stem.chars().count() >= PREFIX_MIN
            && AGENT_ENDINGS.iter().any(|e| stem.ends_with(e))
        {
            out.push(stem.to_owned());
            break;
        }
    }
    for ending in ["ierenden", "ierende"] {
        if let Some(stem) = word.strip_suffix(ending)
            && stem.chars().count() >= 3
        {
            out.push(format!("{stem}ent"));
            break;
        }
    }
    out
}

/// A base with its other forms.
fn variants(base: &str) -> Vec<String> {
    let mut out = vec![base.to_owned()];
    if base.chars().count() >= PARTICIPLE_MIN
        && let Some(stem) = base.strip_suffix("ent")
    {
        out.push(format!("{stem}ierend"));
    }
    if let Some(stem) = base.strip_suffix("mann") {
        out.push(format!("{stem}frau"));
        out.push(format!("{stem}leute"));
    }
    if base.chars().count() > 5
        && let Some(stem) = base.strip_suffix("um")
    {
        out.push(format!("{stem}a"));
    }
    out
}

fn forms(word: &str) -> Vec<Vec<String>> {
    let folded = fold(word);
    let parts = words(&folded);
    let Some((last, head)) = parts.split_last() else {
        return Vec::new();
    };
    let mut out: Vec<Vec<String>> = Vec::new();
    for base in bases(last) {
        for form in variants(&base) {
            let mut phrase: Vec<String> = head.iter().map(|w| (*w).to_owned()).collect();
            phrase.push(form);
            if !out.contains(&phrase) {
                out.push(phrase);
            }
        }
    }
    if parts.len() > 1 {
        out.push(vec![parts.concat()]);
    }
    out
}

/// Does a word of the text match one word of a form?
fn matches(text: &str, form: &str) -> bool {
    let len = form.chars().count();
    text == form
        || (len >= PREFIX_MIN && text.starts_with(form))
        || (len >= SUFFIX_MIN && text.ends_with(form))
}

/// Does the folded text contain the word in one of its forms?
fn found(folded: &str, word: &Word<'_>) -> bool {
    let text = words(folded);
    word.forms.iter().any(|form| {
        text.windows(form.len())
            .any(|window| window.iter().zip(form).all(|(t, f)| matches(t, f)))
    })
}

/// A decided exclusion for every exclusion word in the title or the ad's own text
/// (`exclusionWord {word}`), with the sentences that name it.
pub(crate) fn check(criteria: &HardCriteria, title: &str, segments: &[Segment]) -> Vec<Finding> {
    if criteria.exclusion_words.is_empty() {
        return Vec::new();
    }
    let title = fold(title);
    criteria
        .exclusion_words
        .iter()
        .map(|text| Word {
            text,
            forms: forms(text),
        })
        .filter(|w| !w.forms.is_empty())
        .filter_map(|word| {
            let spans: Vec<Range<usize>> = segments
                .iter()
                .filter(|(_, f)| found(f, &word))
                .map(|(range, _)| range.clone())
                .take(SPANS_MAX)
                .collect();
            (!spans.is_empty() || found(&title, &word)).then(|| {
                Finding::new(
                    ReasonCode::ExclusionWord,
                    true,
                    Some(CriterionKey::ExclusionWords),
                    json!({ "word": word.text }),
                    spans,
                )
            })
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(word: &str, text: &str) -> bool {
        let w = Word {
            text: word,
            forms: forms(word),
        };
        found(&fold(text), &w)
    }

    #[test]
    fn a_word_matches_its_german_forms_and_compounds() {
        for text in [
            "Werkstudent (m/w/d) Controlling",
            "Werkstudentin im Controlling",
            "Wir suchen Werkstudierende für das Controlling",
            "Werkstudenten-Job im Finanzbereich",
            "Eine Werkstudentenstelle mit 20 Stunden",
            "WERKSTUDENT*IN CONTROLLING",
        ] {
            assert!(hit("Werkstudent", text), "{text}");
        }
        assert!(hit("Werkstudentin", "Werkstudent (m/w/d)"));
        assert!(hit("Werkstudierende", "Werkstudent (m/w/d)"));
        assert!(hit("Praktikum", "Pflichtpraktikum im Controlling"));
        assert!(hit("Praktikum", "Praktika im Ausland"));
        assert!(hit("Kaufmann", "Kauffrau für Büromanagement"));
        assert!(hit("Call Center", "Agent im Callcenter"));
        assert!(hit("Call Center", "Call-Center Agent"));
        assert!(hit(
            "Abschlussarbeit",
            "Bachelor-Abschlussarbeit im Controlling"
        ));
    }

    #[test]
    fn a_word_stays_a_word() {
        assert!(!hit(
            "Werkstudent",
            "Studierende der Wirtschaftswissenschaften"
        ));
        assert!(!hit("Praktikum", "Praktiker mit Erfahrung"));
        assert!(!hit("Agent", "ein international agierender Konzern"));
        assert!(!hit("Pflege", "Stammdatenpflege in SAP"));
        assert!(!hit("IT", "Wir bieten Zeit für Weiterbildung"));
        assert!(hit("IT", "IT-Leiter (m/w/d)"));
    }
}
