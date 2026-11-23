//! Lines of a job text: headings, bullets, closing blocks and the phrases of every section.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// A must phrase cut at a nice cue that opens a clause after a comma (`NICE_LEADS`): the head
/// stays a must, the clause from the cue on is nice, so an `or` inside the clause never makes
/// the head an alternative of it (`10+ years in finance, ideally in controlling or
/// accounting`).
pub(super) fn cut_nice_lead((phrase, kind, stage): Phrase<'_>) -> Vec<Phrase<'_>> {
    match cut_at_nice_lead(phrase) {
        Some((head, clause)) if kind == ReqKind::Must => {
            vec![(head, kind, stage), (clause, ReqKind::Nice, stage)]
        }
        _ => vec![(phrase, kind, stage)],
    }
}

/// Where a phrase splits at a nice lead after a comma: its head and the clause from the cue on.
pub(super) fn cut_at_nice_lead(phrase: &str) -> Option<(&str, &str)> {
    phrase.match_indices(", ").find_map(|(at, sep)| {
        let rest = &phrase[at + sep.len()..];
        let word = rest
            .split(|c: char| !c.is_alphabetic())
            .next()
            .unwrap_or("");
        let head = phrase[..at].trim_end();
        (!head.is_empty() && NICE_LEADS.contains(&word.to_lowercase().as_str()))
            .then_some((head, rest))
    })
}

/// A stripped line without a leading glyph bullet (`✅`, `👉`, `→`), and whether it had
/// one: such a line is a bullet, never a heading.
pub(super) fn line_of(line: &str) -> (&str, bool) {
    let stripped = strip(line);
    let rest = stripped.trim_start_matches(lex::EXTRA_BULLETS);
    (strip(rest), rest.len() != stripped.len())
}

/// Whether a line opens a section of the ad the way the engine reads it; the reader sets such
/// a line as a heading (`layout.rs`).
pub(crate) fn is_heading_line(line: &str) -> bool {
    let (stripped, bullet) = line_of(line);
    matches!(sections::classify(stripped, bullet, None), Line::Heading(_))
}

pub(super) fn offset(text: &str, part: &str) -> usize {
    (part.as_ptr() as usize).saturating_sub(text.as_ptr() as usize)
}

pub(super) fn nice_cue(line: &str) -> bool {
    let folded = fold(line);
    NICE_CUES.iter().any(|c| folded.contains(c))
}

/// An item about the company or the frame, no requirement: a legal form (`Muster GmbH`), a
/// founding year (`seit 1998`), or only places, days and contract words.
pub(super) fn noise_item(item: &str) -> bool {
    let folded = fold(item);
    let tokens: Vec<&str> = atoms::raw_tokens(&folded).collect();
    let legal = lex::LEGAL_FORMS.iter().any(|f| {
        if f.contains(' ') {
            folded.contains(f)
        } else {
            tokens.contains(f)
        }
    }) && tokens.len() <= 12;
    let founded = tokens
        .windows(2)
        .any(|w| w[0] == "seit" && w[1].len() == 4 && w[1].chars().all(|c| c.is_ascii_digit()));
    let place = |t: &str| {
        lex::GERMAN_CITIES.contains(&t)
            || lex::CITIES.iter().any(|(c, _)| *c == t)
            || lex::COUNTRIES.iter().any(|(c, _)| *c == t)
    };
    let frame_only = !tokens.is_empty()
        && tokens.iter().all(|t| {
            place(t)
                || atoms::is_filler(t)
                || t.chars().all(|c| c.is_ascii_digit() || c == '%')
                || lex::FRAME_WORDS.contains(t)
                || lex::DAY_WORDS_ONSITE.contains(t)
                || lex::TITLE_CONTRACT_WORDS.contains(t)
        })
        && tokens
            .iter()
            .any(|t| place(t) || lex::DAY_WORDS_ONSITE.contains(t));
    legal || founded || frame_only
}

/// An item that says something is not needed (`Keine SAP-Kenntnisse erforderlich`).
pub(super) fn not_needed(item: &str) -> bool {
    let folded = fold(item);
    lex::NOT_NEEDED.iter().any(|w| folded.contains(w))
        || folded.starts_with("kein ")
        || folded.starts_with("keine ")
}

pub(super) type Phrase<'a> = (&'a str, ReqKind, Stage);

/// What stage 1 read: the phrases of the requirement sections, the offsets of nice lines
/// and the lines of the task sections.
pub(super) struct SectionRead<'a> {
    pub(super) phrases: Vec<Phrase<'a>>,
    pub(super) in_nice: Vec<usize>,
    pub(super) tasks: Vec<Range<usize>>,
}

/// An item of a pick list: a bullet, or a short line without a sentence's end.
pub(super) fn pick_item(stripped: &str, bullet: bool) -> bool {
    bullet || (stripped.chars().count() <= 60 && !stripped.trim_end().ends_with('.'))
}

/// Stage 1: requirement and nice-to-have sections; also the offsets of nice lines and the
/// lines of the task sections.
pub(super) fn section_phrases(text: &str) -> SectionRead<'_> {
    let mut current: Option<HeadingKind> = None;
    // The items under a pick list's line are a choice: nice-to-haves.
    let mut pick = false;
    let mut phrases: Vec<Phrase<'_>> = Vec::new();
    let mut in_nice = Vec::new();
    let mut tasks = Vec::new();
    let lines = splitlines(text);
    for (at, line) in lines.iter().enumerate() {
        let (stripped, bullet) = line_of(line);
        if stripped.is_empty() {
            continue;
        }
        let next = lines[at + 1..]
            .iter()
            .map(|l| line_of(l).0)
            .find(|l| !sections::clean_phrase(l).is_empty());
        let content = match sections::classify(stripped, bullet, next) {
            Line::Heading(kind) => {
                current = Some(kind);
                pick = false;
                continue;
            }
            Line::Inline(kind, rest) => {
                current = Some(kind);
                pick = false;
                rest
            }
            Line::Closing => {
                current = Some(HeadingKind::Neutral);
                continue;
            }
            Line::PickList if current == Some(HeadingKind::Must) => {
                pick = true;
                continue;
            }
            Line::PickList | Line::Text => {
                pick = pick && pick_item(stripped, bullet);
                stripped
            }
        };
        let kind = match current {
            Some(HeadingKind::Must) if pick => ReqKind::Nice,
            // A nice cue inside a must line marks items, not the line (see `read`).
            Some(HeadingKind::Must) => ReqKind::Must,
            Some(HeadingKind::Nice) => {
                in_nice.push(offset(text, stripped));
                ReqKind::Nice
            }
            Some(HeadingKind::Task) => {
                let start = offset(text, content);
                tasks.push(start..start + content.len());
                continue;
            }
            _ => continue,
        };
        for sentence in sentences(content) {
            let phrase = sections::clean_phrase(sentence);
            if !phrase.is_empty() {
                phrases.push((phrase, kind, Stage::Section));
            }
        }
    }
    SectionRead {
        phrases,
        in_nice,
        tasks,
    }
}
