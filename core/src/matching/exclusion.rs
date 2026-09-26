//! Exclusion words of the profile (`ausschlusswoerter`): a word in the title or in the ad's
//! own text excludes the ad (decided). Whole words, case-insensitive, with the forms German
//! gives them: a word matches its inflections and the compounds it starts (`Werkstudent`:
//! `Werkstudentin`, `Werkstudenten`, `Werkstudentenstelle`), a long word also the compounds
//! it ends (`Pflichtpraktikum`, `Pflichtpraktikums`); a female form in the profile
//! (`Werkstudentin`) matches the male one too. Generated forms match as whole words with
//! their inflections only, never as the start of another word: the participle of an `-ent`
//! noun (`Werkstudierende`), `-mann` as `-frau` and `-leute` (`Kauffrauen`), `-um` as `-a`
//! (`Praktika`, not `praktikable` or `Praktikabilität`; `Zentrum` never `zentral`). The words
//! of one family match each other (`lexicon::EXCLUSION_WORD_FAMILIES`: `Praktikum` and
//! `Praktikant`). A phrase matches word by word or written as one word (`Call Center`,
//! `Callcenter`).

use std::ops::Range;

use serde_json::json;

use super::atoms::fold;
use super::facts::{Finding, HardCriteria, Segment};
use super::lexicon::engine as lex;
use super::types::{CriterionKey, ReasonCode};

/// Shortest form that also matches as the start of a longer word or with an inflection.
const PREFIX_MIN: usize = 4;
/// Shortest form that also matches as the end of a compound.
const SUFFIX_MIN: usize = 8;
/// Shortest `-ent` noun that also matches as a participle (`Student`, not `Agent`).
const PARTICIPLE_MIN: usize = 7;
/// Passages highlighted per word.
const SPANS_MAX: usize = 3;
/// Endings of an agent noun before a female ending (`Berater-in`, `Praktikant-in`).
const AGENT_ENDINGS: &[&str] = &["ent", "ant", "er", "or", "eur", "ist"];
/// Endings of a German inflection after a form (`Werkstudenten`, `Kauffrauen`, `Praktikums`).
const INFLECTIONS: &[&str] = &["e", "n", "s", "en", "er", "es", "em", "in", "innen"];

/// One form of an exclusion word: its folded words; the last one carries the inflections.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Form {
    words: Vec<String>,
    /// The last word also matches the compounds it starts (`Werkstudentenstelle`). A
    /// generated form matches only as a word with its inflections (`Praktika`, never
    /// `praktikable`).
    open: bool,
}

/// One exclusion word with its forms.
struct Word<'a> {
    text: &'a str,
    forms: Vec<Form>,
}

fn words(folded: &str) -> Vec<&str> {
    folded
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect()
}

/// The word itself, the male form of a female or participle form and the other words of
/// its family.
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
    for family in lex::EXCLUSION_WORD_FAMILIES {
        if out.iter().any(|b| family.contains(&b.as_str())) {
            for member in *family {
                if !out.iter().any(|b| b == member) {
                    out.push((*member).to_owned());
                }
            }
        }
    }
    out
}

/// A base (open) with its generated forms (closed).
fn variants(base: &str) -> Vec<(String, bool)> {
    let mut out = vec![(base.to_owned(), true)];
    if base.chars().count() >= PARTICIPLE_MIN
        && let Some(stem) = base.strip_suffix("ent")
    {
        out.push((format!("{stem}ierend"), false));
    }
    if let Some(stem) = base.strip_suffix("mann") {
        out.push((format!("{stem}frau"), false));
        out.push((format!("{stem}leute"), false));
    }
    if base.chars().count() > 5
        && let Some(stem) = base.strip_suffix("um")
    {
        out.push((format!("{stem}a"), false));
    }
    out
}

fn forms(word: &str) -> Vec<Form> {
    let folded = fold(word);
    let parts = words(&folded);
    let Some((last, head)) = parts.split_last() else {
        return Vec::new();
    };
    let mut out: Vec<Form> = Vec::new();
    for base in bases(last) {
        for (variant, open) in variants(&base) {
            let mut phrase: Vec<String> = head.iter().map(|w| (*w).to_owned()).collect();
            phrase.push(variant);
            if !out.iter().any(|f| f.words == phrase) {
                out.push(Form {
                    words: phrase,
                    open,
                });
            }
        }
    }
    if parts.len() > 1 {
        out.push(Form {
            words: vec![parts.concat()],
            open: true,
        });
    }
    out
}

/// How a word of the text holds a word of a form.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fit<'t> {
    /// The word itself, with an inflection or a female ending (`Werkstudenten`): the rest.
    Word(&'t str),
    /// A compound the word ends (`Pflichtpraktikum`, `Pflichtpraktikums`): the inflection.
    Head(&'t str),
    /// A compound the word starts (`Werkstudentenstelle`): the rest.
    Modifier(&'t str),
}

/// Does a word of the text match a word of a form (`open`: also as the start of a compound)?
fn fit<'t>(text: &'t str, form: &str, open: bool) -> Option<Fit<'t>> {
    let len = form.chars().count();
    if text == form {
        return Some(Fit::Word(""));
    }
    if len >= PREFIX_MIN
        && let Some(rest) = text.strip_prefix(form)
    {
        if INFLECTIONS.contains(&rest) {
            return Some(Fit::Word(rest));
        }
        if open {
            return Some(Fit::Modifier(rest));
        }
    }
    if len >= SUFFIX_MIN {
        for ending in std::iter::once("").chain(INFLECTIONS.iter().copied()) {
            if let Some(stem) = text.strip_suffix(ending)
                && stem.len() > form.len()
                && stem.ends_with(form)
            {
                return Some(Fit::Head(ending));
            }
        }
    }
    None
}

/// Does the folded text contain the word in one of its forms?
fn found(folded: &str, word: &Word<'_>) -> bool {
    let text = words(folded);
    word.forms.iter().any(|form| {
        // The words before the last one of a phrase match as before, as prefixes.
        let open = |i: usize| form.open || i + 1 < form.words.len();
        text.windows(form.words.len()).any(|window| {
            window
                .iter()
                .zip(&form.words)
                .enumerate()
                .all(|(i, (t, f))| fit(t, f, open(i)).is_some())
        })
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

    /// E16-2: a generated form (`-um` as `-a`, the participle, `-frau`, `-leute`) matches
    /// only as a word with its inflections, never as the start of another word; `Praktikum`
    /// and `Praktikant` are one family.
    #[test]
    fn e16_2_generated_forms_are_whole_words() {
        for (word, text) in [
            (
                "Praktikum",
                "Sie entwickeln pragmatische und praktikable Lösungen",
            ),
            (
                "Praktikum",
                "Bewertung der Maßnahmen auf Wirkung und Praktikabilität",
            ),
            ("Praktikum", "ein praktikabel umsetzbares Konzept"),
            ("Zentrum", "Sie übernehmen eine zentrale Rolle"),
            ("Zentrum", "Zentralisierung der Buchhaltung"),
            ("Ministerium", "ministeriale Abstimmung"),
        ] {
            assert!(!hit(word, text), "{word}: {text}");
        }
        for (word, text) in [
            ("Praktikum", "Praktikant (m/w/d) im Controlling"),
            ("Praktikum", "Praktikantin Controlling"),
            ("Praktikum", "Wir suchen Praktikanten"),
            ("Praktikum", "Praktikantenstelle im Einkauf"),
            ("Praktikum", "mehrere Pflichtpraktika"),
            ("Praktikum", "im Rahmen eines Pflichtpraktikums"),
            ("Praktikum", "Praktika im Ausland"),
            ("Praktikant", "Praktikum (m/w/d) im Controlling"),
            ("Praktikantin", "Pflichtpraktikum im Finanzbereich"),
            ("Kaufmann", "Kauffrauen und Kaufleuten"),
            ("Werkstudent", "Wir suchen Werkstudierende"),
            ("Werkstudent", "Werkstudierenden-Stelle"),
            ("Aushilfe", "Wir suchen Aushilfen"),
            ("Zentrum", "im Zentrum der Stadt"),
        ] {
            assert!(hit(word, text), "{word}: {text}");
        }
    }
}
