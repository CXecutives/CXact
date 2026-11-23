//! A job text as the engine reads it: sections with inline headings, frame and
//! English headings (V5), three stages - sections, requirement sentences, vocabulary (V16),
//! items with AND parts, OR alternatives and examples (V6) and the kind of every item (V7).

use super::atoms::{self, Vocab, fold};
use super::facts::rate_in;
use super::lexicon::engine::{
    AND, AND_WORDS, CueScope, EN_CUES, EXAMPLE_SEPARATORS, EXAMPLES, NUMBER_WORDS, OR, YEAR_UNITS,
};
use super::lexicon::{HeadingKind, engine as lex};
use super::normalize::{contains_word, sentences, splitlines, strip};
use super::requirements::extract_job_skills;
use super::sections::{self, Line, ReqKind};
use regex::Regex;
use std::ops::Range;
use std::sync::LazyLock;

mod classify;
mod coordination;
mod lines;
mod quantities;
mod split;
#[cfg(test)]
mod tests;

pub(crate) use self::classify::{known_skill, language_of, names_degree};
pub(crate) use self::lines::is_heading_line;
pub(crate) use self::quantities::level_in;
#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use self::{classify::*, coordination::*, lines::*, quantities::*, split::*};

/// Where an item came from (V16).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Stage {
    Section,
    Sentence,
    Vocabulary,
}

/// What an item asks for (V7).
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum Class {
    Skill,
    /// A language (stem) with the required CEFR level (1-7), if stated.
    Language(String, Option<u8>),
    Degree,
    /// A licence or admission (the lexicon word, e.g. `steuerberater`).
    Licence(&'static str),
    Soft,
    Frame,
}

/// One requirement item: met when one of its alternatives is met.
#[derive(Debug, Clone)]
pub(crate) struct Item {
    /// Byte range of the whole item in the text (vocabulary terms have none).
    pub span: Option<Range<usize>>,
    pub text: String,
    pub alternatives: Vec<String>,
    pub kind: ReqKind,
    pub class: Class,
    /// Required years of experience, if stated: at least this many (the lower end of a
    /// range).
    pub years: Option<u32>,
    /// The upper end of a closed range of years (`3-5 Jahre`).
    pub years_max: Option<u32>,
    pub stage: Stage,
}

/// The requirements of a job.
#[derive(Debug, Clone, Default)]
pub(crate) struct JobDoc {
    pub items: Vec<Item>,
    /// Byte ranges of requirement lines (the "requirements" field of the relevance).
    pub requirement_lines: Vec<Range<usize>>,
    /// Byte ranges of the lines under a task heading (`Aufgaben`). Tasks never become
    /// requirement rows.
    pub task_lines: Vec<Range<usize>>,
}

/// Reads the requirements of a job text.
pub(crate) fn read(text: &str, vocab: &Vocab) -> JobDoc {
    let mut doc = JobDoc::default();
    let read = section_phrases(text);
    doc.task_lines = read.tasks;
    let mut phrases = read.phrases;
    if !phrases.iter().any(|(_, kind, _)| *kind == ReqKind::Must) {
        phrases.extend(cued_sentences(text, &read.in_nice));
    }
    for (phrase, kind, stage) in phrases.into_iter().flat_map(|p| cue_clauses(p, vocab)) {
        if describes_role(phrase) {
            continue;
        }
        let start = offset(text, phrase);
        doc.requirement_lines.push(start..start + phrase.len());
        let level = level_in(phrase);
        if soft_sentence(phrase) {
            let nice = kind == ReqKind::Nice || !sections::nice_cues(phrase).is_empty();
            doc.items.push(Item {
                span: Some(start..start + phrase.len()),
                text: phrase.to_owned(),
                alternatives: Vec::new(),
                kind: if nice { ReqKind::Nice } else { kind },
                class: Class::Soft,
                years: None,
                years_max: None,
                stage,
            });
            continue;
        }
        let parts = split(phrase);
        let tails = shared_objects(phrase, &parts);
        let nice = nice_parts(phrase, &parts);
        // A modifier of a hyphen ellipsis reads as the word it stands for (`Risiko-` of
        // `Risiko- und Qualitätsmanagement` as `Risikomanagement`).
        let texts: Vec<String> = parts
            .iter()
            .map(|(r, _)| {
                let part = &phrase[r.clone()];
                atoms::complete_ellipsis(part, &phrase[r.end..]).unwrap_or_else(|| part.to_owned())
            })
            .collect();
        let classes = part_classes(&texts, level, vocab);
        for (((((span, alternatives), class), tail), whole), nice) in parts
            .into_iter()
            .zip(classes)
            .zip(tails)
            .zip(&texts)
            .zip(nice)
        {
            let whole = whole.as_str();
            if atoms::atoms(whole, vocab).is_empty() || not_needed(whole) || noise_item(whole) {
                continue;
            }
            let with_tail = |text: &str| match &tail {
                Some(t) => format!("{text} {}", &phrase[t.clone()]),
                None => text.to_owned(),
            };
            let kind = if nice { ReqKind::Nice } else { kind };
            let years = years_in(whole);
            doc.items.push(Item {
                span: Some(start + span.start..start + span.end),
                text: with_tail(whole),
                alternatives: alternatives
                    .into_iter()
                    .map(|r| with_tail(&phrase[r]))
                    .collect(),
                kind,
                class,
                years: years.map(|(min, _)| min),
                years_max: years.and_then(|(_, max)| max),
                stage,
            });
        }
    }
    if doc.items.is_empty() {
        for term in vocabulary_terms(text) {
            doc.items.push(Item {
                span: None,
                alternatives: vec![term.clone()],
                text: term,
                kind: ReqKind::Must,
                class: Class::Skill,
                years: None,
                years_max: None,
                stage: Stage::Vocabulary,
            });
        }
    }
    doc
}

/// An ad without a must section: every sentence with a requirement cue (German or English),
/// outside headings, closing blocks and nice sections.
fn cued_sentences<'a>(text: &'a str, in_nice: &[usize]) -> Vec<(&'a str, ReqKind, Stage)> {
    let mut phrases = Vec::new();
    for line in splitlines(text) {
        let (stripped, bullet) = line_of(line);
        if stripped.is_empty()
            || sections::classify(stripped, bullet, None) != Line::Text
            || in_nice.contains(&offset(text, stripped))
        {
            continue;
        }
        for sentence in sentences(stripped) {
            let phrase = sections::clean_phrase(sentence);
            let folded = fold(phrase);
            if sections::cued(phrase) || EN_CUES.iter().any(|c| folded.contains(c)) {
                phrases.push((phrase, ReqKind::Must, Stage::Sentence));
            }
        }
    }
    phrases
}

/// Terms of an ad without requirement sentences: the general vocabulary without industries
/// (an industry is no skill).
fn vocabulary_terms(text: &str) -> Vec<String> {
    let industry = |t: &str| {
        let folded = fold(t);
        super::lexicon::wishes::INDUSTRY_WORDS
            .iter()
            .chain(super::lexicon::wishes::INDUSTRIES)
            .any(|(w, _)| *w == folded)
    };
    extract_job_skills(text)
        .into_iter()
        .filter(|t| !industry(t))
        .collect()
}
