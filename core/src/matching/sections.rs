//! The line classifier of a job text: what a line is (a heading, a heading with its content
//! after a colon, a closing line, a pick list's opener or text), the one heading folding, and
//! the requirement cues of a sentence.

use std::collections::HashSet;
use std::ops::Range;
use std::sync::LazyLock;

use regex::Regex;

use super::atoms::{self, fold};
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine::{self as lex, CueScope};
use super::lexicon::{self, HeadingKind};
use super::normalize::{
    char_len, decimal, is_space, phrase_at, split_whitespace, strip, word_spans,
};
use super::pyre;

/// Headings longer than this are ordinary lines.
const HEADING_MAX_CHARS: usize = 64;
/// A heading has at most this many words (a longer line is a sentence that starts with a
/// heading's word).
const HEADING_WORDS: usize = 6;
/// Cue sentences longer than this are ignored.
const CUE_MAX_CHARS: usize = 400;
/// Words from which the line under a `Skills` heading is prose, not a tag list.
const SKILLS_PROSE_WORDS: usize = 8;
/// A heading of the other listings has at most this many characters.
const LISTINGS_MAX_CHARS: usize = 48;

static CUE_HARD: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::CUE_HARD));
static CUE_EXPERIENCE: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::CUE_EXPERIENCE));

/// Kind of a requirement: must or nice-to-have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ReqKind {
    Must,
    Nice,
}

/// What a line of a job text is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Line<'a> {
    /// A heading: it opens a section of this kind.
    Heading(HeadingKind),
    /// A heading with its content after a colon (`Anforderungen: SAP FI`, `Nice to have: Power
    /// BI`): the content belongs to the section it opens.
    Inline(HeadingKind, &'a str),
    /// A line that ends the requirements: the portal's tags, a notice, application, contact or
    /// privacy text, a greeting.
    Closing,
    /// A line that opens a pick list: the items below it are a choice.
    PickList,
    /// Anything else: an item or prose.
    Text,
}

/// What a line is: `line` is stripped, `bullet` says it led with a glyph bullet, `next` is
/// the next non-empty line (a bare `Skills` heading over prose opens the requirements, over a
/// tag list it is the portal's tags).
pub(crate) fn classify<'a>(line: &'a str, bullet: bool, next: Option<&str>) -> Line<'a> {
    let bullet = bullet || is_bullet(line);
    let norm = norm_heading(line);
    if !bullet && lex::TAG_HEADINGS.contains(&norm.as_str()) {
        let prose = next.is_some_and(|n| {
            let n = clean_phrase(n);
            let words = n.split_whitespace().count();
            words >= SKILLS_PROSE_WORDS && 3 * n.matches(',').count() < words
        });
        return Line::Heading(if prose {
            HeadingKind::Must
        } else {
            HeadingKind::Neutral
        });
    }
    let folded = fold(clean_phrase(line));
    if lex::CLOSING_STARTS.iter().any(|w| folded.starts_with(w)) {
        return Line::Closing;
    }
    if !bullet {
        if let Some((head, rest)) = line.split_once([':', '：'])
            && !strip(rest).is_empty()
            && let Some(kind) = heading_kind(&norm_heading(head))
        {
            return Line::Inline(kind, strip(rest));
        }
        if let Some(kind) = heading_kind(&norm) {
            // A heading names no number (`Bewerbungsfrist 15.10.2026` states a date): a frame
            // line ends the section, any other line is text.
            let shown = split_whitespace(&norm).count() <= HEADING_WORDS
                && !norm.chars().any(|c| c.is_ascii_digit());
            return match kind {
                _ if shown || is_listings_heading(&norm) => Line::Heading(kind),
                HeadingKind::Neutral => Line::Closing,
                _ => Line::Text,
            };
        }
    }
    if lex::CLOSING_WORDS.iter().any(|w| folded.contains(w)) {
        return Line::Closing;
    }
    if line.trim_end().ends_with(':')
        && nice_cues(line).iter().any(|c| c.scope == CueScope::List)
        && lex::PICK_LIST_REFERS.iter().any(|w| folded.contains(w))
    {
        return Line::PickList;
    }
    Line::Text
}

/// What a normalised heading opens: the other listings and whole headings, the heading
/// without its lead word (`Ihre Qualifikation`), a prefix (`Anforderungen an Sie`), then a
/// heading in two languages (`Aufgaben / Tasks`).
fn heading_kind(norm: &str) -> Option<HeadingKind> {
    if norm.is_empty() || char_len(norm) > HEADING_MAX_CHARS {
        return None;
    }
    if is_listings_heading(norm) {
        return Some(HeadingKind::Neutral);
    }
    let bare = norm
        .split_once(' ')
        .filter(|(lead, _)| lex::HEADING_LEADS.contains(lead))
        .map_or(norm, |(_, rest)| rest);
    let exact = |text: &str| {
        lex::HEADINGS
            .binary_search_by(|(h, _)| (*h).cmp(text))
            .ok()
            .map(|i| lex::HEADINGS[i].1)
    };
    exact(norm)
        .or_else(|| exact(bare))
        .or_else(|| by_prefix(norm))
        .or_else(|| by_prefix(bare))
        .or_else(|| {
            norm.split(" / ")
                .skip_while(|_| !norm.contains(" / "))
                .find_map(heading_kind)
        })
}

/// The kind of the longest heading prefix of `norm`, unless the heading is a skill: a frame
/// or task word compounded with a skill head (`Branchenkenntnisse`, `Kategoriemanagement`), or
/// one skill term (`Requirements Engineering`, `Compensation & Benefits`).
fn by_prefix(norm: &str) -> Option<HeadingKind> {
    let &(prefix, kind) = lex::HEADING_PREFIXES
        .iter()
        .filter(|(p, _)| norm.starts_with(p))
        .max_by_key(|(p, _)| p.len())?;
    let rest = &norm[prefix.len()..];
    let tail = rest.split(' ').next().unwrap_or("");
    let compound = !tail.is_empty()
        && !lex::HEADING_INFLECTIONS.contains(&tail)
        && matches!(kind, HeadingKind::Neutral | HeadingKind::Task)
        && lex::SKILL_COMPOUND_HEADS.iter().any(|h| tail.ends_with(h));
    (!compound && !skill_term(norm)).then_some(kind)
}

/// Skill terms of several words: the concept keys of the core and every domain pack and the
/// general vocabulary.
static SKILL_TERMS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    lex::CORE_CONCEPTS
        .iter()
        .chain(DOMAINS.iter().flat_map(|d| d.concepts.iter()))
        .map(|(key, _)| *key)
        .chain(lexicon::JOB_SKILL_VOCAB.iter().copied())
        .filter(|term| term.contains(' '))
        .collect()
});

/// Is a heading one skill term of several words, as written or without its fillers (concept
/// keys have none)?
fn skill_term(norm: &str) -> bool {
    let words: Vec<&str> = atoms::raw_tokens(norm).collect();
    let content: Vec<&str> = words
        .iter()
        .copied()
        .filter(|w| !atoms::is_filler(w))
        .collect();
    [words, content]
        .iter()
        .any(|w| w.len() > 1 && SKILL_TERMS.contains(w.join(" ").as_str()))
}

/// A folded line that heads the other listings of a portal: a heading of
/// `lexicon::OTHER_LISTINGS` as whole words, then nothing, a count (`(12)`), a colon or a
/// known tail (`anzeigen`, `dieses Anbieters`). A line that goes on is a sentence of the ad
/// (`Ähnliche Projekterfahrung von Vorteil`, `Weitere Projekte sind geplant.`).
pub(crate) fn is_listings_heading(folded: &str) -> bool {
    char_len(folded) <= LISTINGS_MAX_CHARS
        && lex::OTHER_LISTINGS.iter().any(|heading| {
            let Some(tail) = folded.strip_prefix(heading) else {
                return false;
            };
            if tail.chars().next().is_some_and(char::is_alphanumeric) {
                return false;
            }
            let tail = tail.trim().trim_end_matches(':').trim_end();
            let count = tail.trim_start_matches('(').trim_end_matches(')');
            tail.is_empty()
                || (!count.is_empty() && count.chars().all(|c| c.is_ascii_digit()))
                || lex::LISTING_TAILS.contains(&tail)
        })
}

/// Does the (stripped) line start with a bullet character?
pub(crate) fn is_bullet(line: &str) -> bool {
    line.starts_with(lexicon::BULLETS)
}

/// `^[bullets]+\s*` removed (only if at least one bullet character leads).
fn strip_bullets(text: &str) -> &str {
    let rest = text.trim_start_matches(lexicon::BULLETS);
    if rest.len() == text.len() {
        text
    } else {
        rest.trim_start_matches(is_space)
    }
}

/// `^\d+[.)]\s*` removed (Python `\d`: any decimal digit).
fn strip_number(text: &str) -> &str {
    let rest = text.trim_start_matches(|c| decimal(c).is_some());
    if rest.len() == text.len() {
        return text;
    }
    match rest.strip_prefix(['.', ')']) {
        Some(after) => after.trim_start_matches(is_space),
        None => text,
    }
}

/// A heading line in the heading folding: without bullets, numbering and a closing colon.
pub(crate) fn norm_heading(line: &str) -> String {
    let text = strip(strip_bullets(strip(line)));
    let text = strip(strip_number(text));
    heading_fold(text.trim_end_matches([':', '：']))
}

/// The one folding of headings and their tables: case and umlauts folded, a spelled umlaut
/// read as one (`ue` as `ü`, so `Wuenschenswert` is `Wünschenswert`), only letters, digits,
/// spaces, `&`, `/` and `-` kept (`What you'll do` reads `what youll do`), spaces joined.
pub(crate) fn heading_fold(text: &str) -> String {
    let kept: String = fold(text)
        .chars()
        .filter(|&c| {
            c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, ' ' | '&' | '/' | '-')
        })
        .collect();
    let spelled = kept
        .replace("ae", "a")
        .replace("oe", "o")
        .replace("ue", "u");
    split_whitespace(&spelled).collect::<Vec<_>>().join(" ")
}

/// Python `_clean_phrase`: leading bullets and numbering removed.
pub(crate) fn clean_phrase(sentence: &str) -> &str {
    let text = strip(strip_bullets(strip(sentence)));
    strip(strip_number(text))
}

/// Python `_cue_kind`: does a sentence ask for something (a requirement cue)?
pub(crate) fn cued(sentence: &str) -> bool {
    if sentence.is_empty() || char_len(sentence) > CUE_MAX_CHARS {
        return false;
    }
    let view = pyre::view(sentence);
    CUE_HARD.is_match(&view) || CUE_EXPERIENCE.is_match(&view)
}

/// A nice cue of a text: its scope and byte range.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Cue {
    pub scope: CueScope,
    pub at: Range<usize>,
}

/// The nice cues of a text, left to right, the longest at each word (`lex::NICE_CUES`: whole
/// words, `Bonussysteme` holds no `bonus`).
pub(crate) fn nice_cues(text: &str) -> Vec<Cue> {
    let words = word_spans(text, &[]);
    let folded: Vec<String> = words.iter().map(|(_, w)| fold(w)).collect();
    let mut cues = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let found = lex::NICE_CUES
            .iter()
            .filter_map(|&(cue, scope)| {
                phrase_at(&folded, i, cue, lex::DECLENSION_ENDINGS).map(|end| (end, scope))
            })
            .max_by_key(|(end, _)| *end);
        let Some((end, scope)) = found else {
            i += 1;
            continue;
        };
        let (last_at, last) = words[end - 1];
        cues.push(Cue {
            scope,
            at: words[i].0..last_at + last.len(),
        });
        i = end;
    }
    cues
}

#[cfg(test)]
mod tests;
