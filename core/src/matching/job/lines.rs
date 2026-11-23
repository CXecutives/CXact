//! Lines of a job text: headings, bullets, closing blocks and the phrases of every section.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// A must phrase cut at the clause cues it holds (`CueScope::Clause`): the head keeps its
/// kind and the clause from the cue on is nice, so an `or` inside the clause never makes the
/// head an alternative of it (`10+ years in finance, ideally in controlling or accounting`);
/// inside brackets the clause ends with them (`SAP FI (idealerweise S/4HANA)`: only S/4HANA is
/// nice) and what follows them keeps the head's kind. A cue with no head before it makes the
/// whole phrase nice; one with no words after it closes its item (see [`nice_parts`]).
pub(super) fn cue_clauses<'a>((phrase, kind, stage): Phrase<'a>, vocab: &Vocab) -> Vec<Phrase<'a>> {
    let whole = vec![(phrase, kind, stage)];
    if kind == ReqKind::Nice {
        return whole;
    }
    let Some(cue) = sections::nice_cues(phrase)
        .into_iter()
        .find(|c| c.scope == CueScope::Clause)
    else {
        return whole;
    };
    let before = phrase[..cue.at.start].trim_end();
    let head = trim_joints(before);
    // A cue opens a clause after a comma, a bracket or a joining word (`SAP, idealerweise
    // S/4HANA`); after a word it closes what stands before it (`SAP bevorzugt, Excel`).
    if head.len() == before.len() && !head.is_empty() {
        return whole;
    }
    let bracket = depth(before) > 0;
    let end = if bracket {
        phrase[cue.at.end..]
            .find(')')
            .map_or(phrase.len(), |c| cue.at.end + c)
    } else {
        phrase.len()
    };
    if trim_joints(&phrase[cue.at.end..end]).is_empty() {
        return whole;
    }
    if atoms::atoms(head, vocab).is_empty() {
        return vec![(phrase, ReqKind::Nice, stage)];
    }
    let mut cut = vec![
        (head, kind, stage),
        (
            trim_joints(&phrase[cue.at.start..end]),
            ReqKind::Nice,
            stage,
        ),
    ];
    let rest = trim_joints(phrase.get(end + 1..).unwrap_or(""));
    if bracket && !rest.is_empty() {
        cut.extend(cue_clauses((rest, kind, stage), vocab));
    }
    cut
}

/// The parts of a phrase its item and line cues make nice: an item cue its part, a line cue
/// the parts up to it, or its part and the ones after it when it opens its part (`Von Vorteil
/// sind ...`), a list cue that refers to the items its part and the ones after it; a clause
/// cue left in the phrase closes its part (`SAP bevorzugt`).
pub(super) fn nice_parts(phrase: &str, parts: &[(Range<usize>, Vec<Range<usize>>)]) -> Vec<bool> {
    let mut nice = vec![false; parts.len()];
    for cue in sections::nice_cues(phrase) {
        let Some(i) = parts.iter().rposition(|(r, _)| r.start <= cue.at.start) else {
            nice.fill(true);
            continue;
        };
        let opens = parts[i].0.start == cue.at.start;
        let marked = match cue.scope {
            CueScope::Item | CueScope::Clause => i..i + 1,
            CueScope::Line if depth(&phrase[..cue.at.start]) > 0 => i..i + 1,
            CueScope::Line if opens => i..parts.len(),
            CueScope::Line => 0..i + 1,
            CueScope::List => {
                let refers = fold(&phrase[cue.at.end..]);
                if !lex::PICK_LIST_REFERS.iter().any(|w| refers.contains(w)) {
                    continue;
                }
                i..parts.len()
            }
        };
        nice[marked].fill(true);
    }
    nice
}

/// Open brackets in a text.
pub(super) fn depth(text: &str) -> usize {
    text.matches('(')
        .count()
        .saturating_sub(text.matches(')').count())
}

/// A text without the signs and joining words at its ends (`SAP FI (`, `und Excel`).
pub(super) fn trim_joints(text: &str) -> &str {
    let mut text = text.trim_matches(|c: char| {
        c.is_whitespace() || matches!(c, ',' | ';' | ':' | '(' | ')' | '-' | '–')
    });
    loop {
        let before = text.len();
        for joint in lex::ELLIPSIS_JOINERS.iter().chain(["and", "or"].iter()) {
            if let Some(rest) = text.strip_suffix(joint).filter(|r| r.ends_with(' ')) {
                text = rest.trim_end_matches(|c: char| c.is_whitespace() || c == ',');
            }
            if let Some(rest) = text.strip_prefix(joint).filter(|r| r.starts_with(' ')) {
                text = rest.trim_start();
            }
        }
        if text.len() == before {
            return text;
        }
    }
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
