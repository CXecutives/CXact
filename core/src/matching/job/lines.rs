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

pub(super) fn heading(line: &str) -> Option<HeadingKind> {
    if sections::is_bullet(line) {
        return None;
    }
    let norm = fold(&sections::norm_heading(line));
    if norm.is_empty() || norm.len() > 64 {
        return None;
    }
    let starts = |list: &[&str]| list.iter().any(|p| norm.starts_with(p));
    // A heading of the other listings only as a whole heading ("Ähnliche Projekterfahrung"
    // is a requirement).
    let other = OTHER_PREFIXES.iter().any(|p| {
        norm.starts_with(p)
            && (!lex::OTHER_LISTINGS.contains(p) || facts::is_listings_heading(&norm))
    });
    // A bare `Skills` heading is the portal's tag list, not the ad's requirements.
    if other || lex::TAG_HEADINGS.contains(&norm.as_str()) {
        return Some(HeadingKind::Neutral);
    }
    if let Some(kind) = sections::section_kind(line) {
        return Some(kind);
    }
    if starts(NICE_PREFIXES) {
        Some(HeadingKind::Nice)
    } else if starts(MUST_PREFIXES) {
        Some(HeadingKind::Must)
    } else {
        // A heading in two languages (`Aufgaben / Tasks`, `Profil / Profile`): its first
        // part that is a heading.
        norm.split(" / ")
            .skip_while(|_| !norm.contains(" / "))
            .find_map(|part| heading(part).filter(|_| part != norm))
    }
}

/// A stripped line without a leading glyph bullet (`✅`, `👉`, `→`), and whether it had
/// one: such a line is a bullet, never a heading.
pub(super) fn line_of(line: &str) -> (&str, bool) {
    let stripped = strip(line);
    let rest = stripped.trim_start_matches(lex::EXTRA_BULLETS);
    (strip(rest), rest.len() != stripped.len())
}

/// A heading, unless the line is a glyph bullet.
pub(super) fn heading_of(stripped: &str, bullet: bool) -> Option<HeadingKind> {
    if bullet { None } else { heading(stripped) }
}

/// Whether a line opens a section of the ad the way the engine reads it (a heading, never a
/// glyph bullet); the reader sets such a line as a heading (`layout.rs`).
pub(crate) fn is_heading_line(line: &str) -> bool {
    let (stripped, bullet) = line_of(line);
    heading_of(stripped, bullet).is_some()
}

pub(super) fn offset(text: &str, part: &str) -> usize {
    (part.as_ptr() as usize).saturating_sub(text.as_ptr() as usize)
}

pub(super) fn nice_cue(line: &str) -> bool {
    let folded = fold(line);
    NICE_CUES.iter().any(|c| folded.contains(c))
}

/// A line that ends requirements from its start on (`Skills: ...`, `Hinweis`, `Datenschutz`),
/// a bullet or not.
pub(super) fn closing_start(line: &str) -> bool {
    let folded = fold(sections::clean_phrase(line));
    lex::CLOSING_STARTS.iter().any(|w| folded.starts_with(w))
}

/// A bare `Skills` heading over prose (`Skills:` then `Substantive experience from leading
/// IT projects ...`): the ad's requirements; over a tag list (`SAP FI, DATEV, HGB`) it is the
/// portal's tags.
pub(super) fn skills_over_prose(stripped: &str, after: &[&str]) -> bool {
    let folded = fold(stripped);
    if !lex::TAG_HEADINGS.contains(&folded.trim_end_matches(':').trim()) {
        return false;
    }
    let Some(next) = after
        .iter()
        .map(|l| sections::clean_phrase(line_of(l).0))
        .find(|l| !l.is_empty())
    else {
        return false;
    };
    let words = next.split_whitespace().count();
    let commas = next.matches(',').count();
    words >= SKILLS_PROSE_WORDS && 3 * commas < words
}

/// Words from which the line under a `Skills` heading is prose, not a tag list.
pub(super) const SKILLS_PROSE_WORDS: usize = 8;

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

/// A line that opens a pick list: it names a count and refers to the items below
/// (`lex::PICK_LIST_COUNTS`, `PICK_LIST_REFERS`), and ends with a colon.
pub(super) fn opens_pick_list(stripped: &str) -> bool {
    let folded = fold(stripped);
    stripped.trim_end().ends_with(':')
        && lex::PICK_LIST_COUNTS.iter().any(|w| folded.contains(w))
        && lex::PICK_LIST_REFERS.iter().any(|w| folded.contains(w))
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
        if !bullet && skills_over_prose(stripped, &lines[at + 1..]) {
            current = Some(HeadingKind::Must);
            continue;
        }
        match sections::inline_heading(stripped) {
            Inline::Section(kind, rest) => {
                current = Some(if kind == ReqKind::Must {
                    HeadingKind::Must
                } else {
                    HeadingKind::Nice
                });
                let phrase = sections::clean_phrase(rest);
                if !phrase.is_empty() {
                    phrases.push((phrase, kind, Stage::Section));
                }
                continue;
            }
            Inline::Other => {
                current = Some(HeadingKind::Neutral);
                continue;
            }
            Inline::None => {}
        }
        if let Some(kind) = heading_of(stripped, bullet) {
            current = Some(kind);
            pick = false;
            continue;
        }
        if closing_start(stripped) {
            current = Some(HeadingKind::Neutral);
            continue;
        }
        // `Interessiert? Dann freuen wir uns auf Ihre Bewerbung.` closes the ad.
        let folded = fold(stripped);
        if lex::CLOSING_WORDS.iter().any(|w| folded.contains(w)) {
            current = Some(HeadingKind::Neutral);
            continue;
        }
        if current == Some(HeadingKind::Must) && opens_pick_list(stripped) {
            pick = true;
            continue;
        }
        pick = pick && pick_item(stripped, bullet);
        let kind = match current {
            Some(HeadingKind::Must) if pick => ReqKind::Nice,
            // A nice cue inside a must line marks items, not the line (see `read`).
            Some(HeadingKind::Must) => ReqKind::Must,
            Some(HeadingKind::Nice) => {
                in_nice.push(offset(text, stripped));
                ReqKind::Nice
            }
            Some(HeadingKind::Task) => {
                let start = offset(text, stripped);
                tasks.push(start..start + stripped.len());
                continue;
            }
            _ => continue,
        };
        for sentence in sentences(stripped) {
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

/// Does the lexicon know this heading text? (for tests and the relevance fields)
#[cfg(test)]
pub(crate) fn heading_kind(line: &str) -> Option<HeadingKind> {
    heading(line)
}
