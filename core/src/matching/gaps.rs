//! The gap finder's view of a job (`core/examples/vocab_gaps.rs`): the words of its
//! requirements and of its title that neither the engine's own words nor ESCO know. It reads
//! every domain pack, whatever a profile switches on.
//!
//! A word is known when a concept of the core or a pack names it (in a key or as the concept),
//! when a word list of the engine has it (the general vocabulary, the tools, the role names,
//! lead, level and contract words, leadership, experience and knowledge words, numbers,
//! industries, degrees, languages, soft skills, the frame, a pack's triggers), when ESCO names
//! it as the engine trusts ESCO (`esco::named`: a skill, knowledge or an occupation), when it is
//! a code the engine matches as written (`VOB`), a compound of a known head
//! (`Transformationsprojekt`) or too generic to say anything (`SAP`, `Manager`).

use std::collections::BTreeSet;
use std::sync::LazyLock;

use super::atoms::{Vocab, is_generic, stem};
use super::job::{self, Class, Stage};
use super::lexicon::domains::DOMAINS;
use super::lexicon::esco::{self, Kind};
use super::lexicon::{self, engine as lex, terms as term_words, wishes};
use super::relevance::clean_title;
use super::terms::core_term;

/// A requirement or a title with the words neither the engine nor ESCO knows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gap {
    /// The requirement's term (its text when it is a sentence), or the title.
    pub term: String,
    /// Its unknown words, folded and stemmed as ESCO's index folds them.
    pub unknown: Vec<String>,
}

/// What the gap finder learns from one job: the gap of its title and of each skill
/// requirement with an unknown word.
#[derive(Debug, Clone, Default)]
pub struct JobGaps {
    pub title: Option<Gap>,
    pub requirements: Vec<Gap>,
    /// Its skill requirements, known or not.
    pub items: usize,
}

/// The words the engine's own tables know, folded the way `esco::words` folds a text.
static KNOWN: LazyLock<BTreeSet<String>> = LazyLock::new(|| {
    let phrases = lex::CORE_CONCEPTS
        .iter()
        .chain(DOMAINS.iter().flat_map(|d| d.concepts.iter()))
        .flat_map(|(key, value)| [*key, *value])
        .chain(lexicon::JOB_SKILL_VOCAB.iter().copied())
        .chain(term_words::TOOLS.iter().copied())
        .chain(
            wishes::ROLE_GROUPS
                .iter()
                .flat_map(|group| group.iter().copied()),
        )
        .chain(wishes::LEAD_WORDS.iter().copied())
        .chain(wishes::LEVEL_WORDS.iter().copied())
        .chain(wishes::ROLE_CONTRACT_WORDS.iter().copied())
        .chain(lex::TITLE_CONTRACT_WORDS.iter().copied())
        .chain(lex::JUNIOR_TITLES.iter().copied())
        .chain(lex::PROFILE_LEAD_WORDS.iter().copied())
        .chain(lex::GENERAL_EXPERIENCE.iter().copied())
        .chain(lex::EXPERIENCE_WORDS.iter().copied())
        .chain(lex::KNOWLEDGE_WORDS.iter().copied())
        .chain(lex::YEARS_SUBSPAN.iter().copied())
        .chain(lex::QUERY_NOISE.iter().copied())
        .chain(lex::FRAME_HEADS.iter().copied())
        .chain(lex::NUMBER_WORDS.iter().map(|(word, _)| *word))
        .chain(lex::LEVEL_WORDS.iter().map(|(word, _)| *word))
        .chain(lex::DEGREE_WORDS.iter().copied())
        .chain(wishes::INDUSTRIES.iter().map(|(word, _)| *word))
        .chain(wishes::INDUSTRY_WORDS.iter().map(|(word, _)| *word))
        .chain(lex::LANGUAGE_NAMES.iter().map(|(name, _)| *name));
    phrases.flat_map(esco::words).collect()
});

/// Word starts the engine knows (soft skills, leadership, the frame, languages, the packs'
/// triggers), stemmed like the words they start.
static KNOWN_STARTS: LazyLock<Vec<String>> = LazyLock::new(|| {
    lex::SOFT_SKILLS
        .iter()
        .chain(lex::LEADERSHIP_ATOMS)
        .chain(lex::FRAME_WORDS)
        .chain(lex::LANGUAGES)
        .chain(DOMAINS.iter().flat_map(|d| d.triggers.iter()))
        .map(|start| stem(start))
        .collect()
});

/// The words of a text written as a code (`VOB`, `HOAI`, `ISTQB`: two to six capitals, as
/// `job::known_skill` reads a code), folded and stemmed: names the engine matches as written.
fn codes(text: &str) -> Vec<String> {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| {
            let letters = w.chars().filter(|c| c.is_alphabetic()).count();
            (2..=6).contains(&letters) && w.chars().all(|c| !c.is_lowercase())
        })
        .flat_map(esco::words)
        .collect()
}

/// A word one of the engine's tables knows, or too generic to say anything.
fn known(word: &str) -> bool {
    is_generic(word)
        || KNOWN.contains(word)
        || lex::LIGHT_HEADS.contains(&word)
        || KNOWN_STARTS
            .iter()
            .any(|start| word.starts_with(start.as_str()))
}

/// A compound the engine relates to a word it knows: a known head after a modifier of three
/// letters or more (`Krankenhausfinanzierung`, `Transformationsprojekt`), as the ladder reads
/// compounds.
fn known_compound(word: &str) -> bool {
    word.char_indices()
        .map(|(at, _)| at)
        .filter(|&at| at >= 3 && word.len() - at >= 5)
        .any(|at| known(&word[at..]))
}

/// The words of a text that neither the engine nor ESCO knows (a code, also one with a
/// number such as `iso-27001`, counts as known).
fn unknown_words(text: &str) -> Vec<String> {
    let (words, named) = esco::named(text, &[Kind::Skill, Kind::Knowledge, Kind::Occupation]);
    let codes = codes(text);
    let in_esco = |at: usize| {
        named
            .iter()
            .any(|n| (n.start..n.start + n.len).contains(&at))
    };
    let mut unknown: Vec<String> = words
        .iter()
        .enumerate()
        .filter(|(at, word)| {
            !word.chars().any(|c| c.is_ascii_digit())
                && !known(word)
                && !known_compound(word)
                && !codes.contains(*word)
                && !in_esco(*at)
        })
        .map(|(_, word)| word.clone())
        .collect();
    unknown.dedup();
    unknown
}

/// The words of a job's title and of its skill requirements that neither the engine's own
/// words nor ESCO know.
pub fn vocabulary_gaps(title: &str, text: &str) -> JobGaps {
    let vocab = Vocab::all();
    let clean = clean_title(title);
    let title_unknown = unknown_words(&clean);
    let doc = job::read(text, &vocab);
    let skills: Vec<&job::Item> = doc
        .items
        .iter()
        .filter(|item| item.class == Class::Skill && item.stage != Stage::Vocabulary)
        .collect();
    let requirements = skills
        .iter()
        .filter_map(|item| {
            let term = core_term(&item.text).map_or_else(|| item.text.clone(), |t| t.term);
            let unknown = unknown_words(&term);
            (!unknown.is_empty()).then_some(Gap { term, unknown })
        })
        .collect();
    JobGaps {
        title: (!title_unknown.is_empty()).then_some(Gap {
            term: clean,
            unknown: title_unknown,
        }),
        requirements,
        items: skills.len(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_words_are_no_gap() {
        let gaps = vocabulary_gaps(
            "Interim Leiter Kundenservice (m/w/d)",
            "Anforderungen:\n- Erfahrung im Controlling\n- Kenntnisse in Buchhaltung\n\
             - Erfahrung mit Quuxifizierung\n",
        );
        assert_eq!(gaps.title, None);
        assert_eq!(gaps.requirements.len(), 1, "{:?}", gaps.requirements);
        assert_eq!(gaps.requirements[0].unknown, ["quuxifizierung"]);
    }
}
