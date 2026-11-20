//! Lines, headings and requirement cues of a job text.

use std::sync::LazyLock;

use regex::Regex;

use super::lexicon::{self, HeadingKind};
use super::normalize::{casefold, char_len, decimal, is_space, split_whitespace, strip};
use super::pyre;

/// Headings longer than this are ordinary lines.
const HEADING_MAX_CHARS: usize = 64;
/// Cue sentences longer than this are ignored.
const CUE_MAX_CHARS: usize = 400;

static INLINE_HEADING: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::INLINE_HEADING));
static CUE_HARD: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::CUE_HARD));
static CUE_EXPERIENCE: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::CUE_EXPERIENCE));
static CUE_NICE: LazyLock<Regex> = LazyLock::new(|| pyre::compile(lexicon::CUE_NICE));

/// Kind of a requirement: must or nice-to-have.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ReqKind {
    Must,
    Nice,
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

/// Python `_norm_heading`.
pub(crate) fn norm_heading(line: &str) -> String {
    let text = strip(strip_bullets(strip(line)));
    let text = strip(strip_number(text));
    let text = text.trim_end_matches([':', '：']);
    let kept: String = casefold(text)
        .chars()
        .filter(|&c| {
            c.is_ascii_lowercase()
                || c.is_ascii_digit()
                || matches!(c, 'ä' | 'ö' | 'ü' | 'ß' | ' ' | '&' | '/' | '-')
        })
        .collect();
    split_whitespace(&kept).collect::<Vec<_>>().join(" ")
}

/// Python `_section_kind`: what a heading line opens, `None` for ordinary lines.
pub(crate) fn section_kind(line: &str) -> Option<HeadingKind> {
    let norm = norm_heading(line);
    if norm.is_empty() || char_len(&norm) > HEADING_MAX_CHARS {
        return None;
    }
    for (table, kind) in [
        (lexicon::NEUTRAL_HEADINGS, HeadingKind::Neutral),
        (lexicon::NICE_HEADINGS, HeadingKind::Nice),
        (lexicon::MUST_HEADINGS, HeadingKind::Must),
        (lexicon::TASK_HEADINGS, HeadingKind::Task),
    ] {
        if lexicon::contains(table, &norm) {
            return Some(kind);
        }
    }
    lexicon::HEADING_PREFIXES
        .iter()
        .find(|(prefix, _)| norm.starts_with(prefix))
        .map(|&(_, kind)| kind)
}

/// Result of the inline-heading check (`Anforderungen: ...` on one line).
pub(crate) enum Inline<'a> {
    /// No inline heading.
    None,
    /// A must/nice heading with the rest of the line as a requirement.
    Section(ReqKind, &'a str),
    /// Another inline heading (tasks, offer, about us): the line stays an ordinary line.
    Other,
}

/// The inline heading of a line (`Anforderungen: ...`).
pub(crate) fn inline_heading(line: &str) -> Inline<'_> {
    // The pattern needs its colon: most lines have none.
    if !line.contains([':', '：']) {
        return Inline::None;
    }
    let view = pyre::view(line);
    let Some(caps) = INLINE_HEADING.captures(&view) else {
        return Inline::None;
    };
    let (Some(head), Some(rest)) = (caps.get(1), caps.get(2)) else {
        return Inline::None;
    };
    let (from, to) = pyre::original_range(line, &view, head.start(), head.end());
    let head = casefold(&line[from..to]);
    let (from, to) = pyre::original_range(line, &view, rest.start(), rest.end());
    let rest = strip(&line[from..to]);
    let kind = if head == "ihr profil"
        || head == "dein profil"
        || head.starts_with("anforderung")
        || head.starts_with("qualifikation")
        || head.starts_with("voraussetzung")
    {
        ReqKind::Must
    } else if head.starts_with("wünschenswert") || head.starts_with("wuenschenswert") {
        ReqKind::Nice
    } else {
        return Inline::Other;
    };
    Inline::Section(kind, rest)
}

/// Python `_clean_phrase`: leading bullets and numbering removed.
pub(crate) fn clean_phrase(sentence: &str) -> &str {
    let text = strip(strip_bullets(strip(sentence)));
    strip(strip_number(text))
}

/// Python `_cue_kind`: requirement kind of a cue sentence, `None` if it is none.
pub(crate) fn cue_kind(sentence: &str) -> Option<ReqKind> {
    if sentence.is_empty() || char_len(sentence) > CUE_MAX_CHARS {
        return None;
    }
    let view = pyre::view(sentence);
    if !(CUE_HARD.is_match(&view) || CUE_EXPERIENCE.is_match(&view)) {
        return None;
    }
    Some(if CUE_NICE.is_match(&view) {
        ReqKind::Nice
    } else {
        ReqKind::Must
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn headings() {
        assert_eq!(section_kind("Anforderungen:"), Some(HeadingKind::Must));
        assert_eq!(section_kind("- 2) Wünschenswert"), Some(HeadingKind::Nice));
        assert_eq!(section_kind("Ihre Qualifikation"), None);
        assert_eq!(section_kind("Über uns"), Some(HeadingKind::Neutral));
        assert_eq!(norm_heading("• 1. Ihr Profil："), "ihr profil");
    }

    #[test]
    fn new_headings() {
        for (line, kind) in [
            ("Qualifikation", HeadingKind::Must),
            ("Anforderungen", HeadingKind::Must),
            ("Muss-Anforderungen", HeadingKind::Must),
            ("Profile", HeadingKind::Must),
            ("Requirements", HeadingKind::Must),
            ("Aufgaben", HeadingKind::Task),
            ("Hauptaufgaben", HeadingKind::Task),
            ("Responsibilities", HeadingKind::Task),
            ("Key Responsibilities", HeadingKind::Task),
        ] {
            assert_eq!(section_kind(line), Some(kind), "{line}");
        }
    }

    #[test]
    fn inline_headings() {
        assert!(matches!(
            inline_heading("Anforderungen: SAP"),
            Inline::Section(ReqKind::Must, "SAP")
        ));
        assert!(matches!(inline_heading("Anforderungen:"), Inline::None));
        assert!(matches!(
            inline_heading("Ihr Profil: SAP FI"),
            Inline::Section(ReqKind::Must, "SAP FI")
        ));
        assert!(matches!(inline_heading("Wir bieten: Geld"), Inline::Other));
    }
}
