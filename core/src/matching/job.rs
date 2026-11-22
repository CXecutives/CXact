//! A job text as the engine reads it: sections with inline headings, frame and
//! English headings (V5), three stages - sections, requirement sentences, vocabulary (V16),
//! items with AND parts, OR alternatives and examples (V6) and the kind of every item (V7).

use std::ops::Range;
use std::sync::LazyLock;

use regex::Regex;

use super::atoms::{self, Vocab, fold};
use super::facts::{self, rate_in};
use super::lexicon::{HeadingKind, engine as lex};
use super::normalize::{splitlines, strip};
use super::requirements::extract_job_skills;
use super::sections::{self, Inline, ReqKind};

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

use super::lexicon::engine::{
    ABBREVIATIONS, AND, AND_WORDS, EN_CUES, EXAMPLE_SEPARATORS, EXAMPLES, MUST_PREFIXES, NICE_CUES,
    NICE_LEADS, NICE_PREFIXES, NUMBER_WORDS, OR, OTHER_PREFIXES, YEAR_UNITS,
};

/// A must phrase cut at a nice cue that opens a clause after a comma (`NICE_LEADS`): the head
/// stays a must, the clause from the cue on is nice, so an `or` inside the clause never makes
/// the head an alternative of it (`10+ years in finance, ideally in controlling or
/// accounting`).
fn cut_nice_lead((phrase, kind, stage): Phrase<'_>) -> Vec<Phrase<'_>> {
    let phrase = without_elaboration(phrase);
    match cut_at_nice_lead(phrase) {
        Some((head, clause)) if kind == ReqKind::Must => {
            vec![(head, kind, stage), (clause, ReqKind::Nice, stage)]
        }
        _ => vec![(phrase, kind, stage)],
    }
}

/// A phrase without the elaboration that follows a comma (`ELABORATION_LEADS`: `…, with the
/// ability to develop and motivate teams`): the clause explains the head, its words would
/// otherwise become requirements of their own.
fn without_elaboration(phrase: &str) -> &str {
    phrase
        .match_indices(", ")
        .find(|(at, sep)| {
            let rest = phrase[at + sep.len()..].to_lowercase();
            lex::ELABORATION_LEADS
                .iter()
                .any(|lead| rest.starts_with(lead) && rest[lead.len()..].starts_with([' ', ',']))
        })
        .map_or(phrase, |(at, _)| phrase[..at].trim_end())
}

/// Where a phrase splits at a nice lead after a comma: its head and the clause from the cue on.
fn cut_at_nice_lead(phrase: &str) -> Option<(&str, &str)> {
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

fn heading(line: &str) -> Option<HeadingKind> {
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
fn line_of(line: &str) -> (&str, bool) {
    let stripped = strip(line);
    let rest = stripped.trim_start_matches(lex::EXTRA_BULLETS);
    (strip(rest), rest.len() != stripped.len())
}

/// A heading, unless the line is a glyph bullet.
fn heading_of(stripped: &str, bullet: bool) -> Option<HeadingKind> {
    if bullet { None } else { heading(stripped) }
}

/// Whether a line opens a section of the ad the way the engine reads it (a heading, never a
/// glyph bullet); the reader sets such a line as a heading (`layout.rs`).
pub(crate) fn is_heading_line(line: &str) -> bool {
    let (stripped, bullet) = line_of(line);
    heading_of(stripped, bullet).is_some()
}

fn offset(text: &str, part: &str) -> usize {
    (part.as_ptr() as usize).saturating_sub(text.as_ptr() as usize)
}

fn nice_cue(line: &str) -> bool {
    let folded = fold(line);
    NICE_CUES.iter().any(|c| folded.contains(c))
}

/// A line that ends requirements from its start on (`Skills: ...`, `Hinweis`, `Datenschutz`),
/// a bullet or not.
fn closing_start(line: &str) -> bool {
    let folded = fold(sections::clean_phrase(line));
    lex::CLOSING_STARTS.iter().any(|w| folded.starts_with(w))
}

/// A bare `Skills` heading over prose (`Skills:` then `Substantive experience from leading
/// IT projects ...`): the ad's requirements; over a tag list (`SAP FI, DATEV, HGB`) it is the
/// portal's tags.
fn skills_over_prose(stripped: &str, after: &[&str]) -> bool {
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
const SKILLS_PROSE_WORDS: usize = 8;

/// An item about the company or the frame, no requirement: a legal form (`Muster GmbH`), a
/// founding year (`seit 1998`), or only places, days and contract words.
fn noise_item(item: &str) -> bool {
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
fn not_needed(item: &str) -> bool {
    let folded = fold(item);
    lex::NOT_NEEDED.iter().any(|w| folded.contains(w))
        || folded.starts_with("kein ")
        || folded.starts_with("keine ")
}

type Phrase<'a> = (&'a str, ReqKind, Stage);

/// What stage 1 read: the phrases of the requirement sections, the offsets of nice lines
/// and the lines of the task sections.
struct SectionRead<'a> {
    phrases: Vec<Phrase<'a>>,
    in_nice: Vec<usize>,
    tasks: Vec<Range<usize>>,
}

/// Stage 1: requirement and nice-to-have sections; also the offsets of nice lines and the
/// lines of the task sections.
/// A line that opens a pick list: it names a count and refers to the items below
/// (`lex::PICK_LIST_COUNTS`, `PICK_LIST_REFERS`), and ends with a colon.
fn opens_pick_list(stripped: &str) -> bool {
    let folded = fold(stripped);
    stripped.trim_end().ends_with(':')
        && lex::PICK_LIST_COUNTS.iter().any(|w| folded.contains(w))
        && lex::PICK_LIST_REFERS.iter().any(|w| folded.contains(w))
}

/// An item of a pick list: a bullet, or a short line without a sentence's end.
fn pick_item(stripped: &str, bullet: bool) -> bool {
    bullet || (stripped.chars().count() <= 60 && !stripped.trim_end().ends_with('.'))
}

fn section_phrases(text: &str) -> SectionRead<'_> {
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

/// Reads the requirements of a job text.
pub(crate) fn read(text: &str, vocab: &Vocab) -> JobDoc {
    let mut doc = JobDoc::default();
    let read = section_phrases(text);
    doc.task_lines = read.tasks;
    let mut phrases = read.phrases;
    if !phrases.iter().any(|(_, kind, _)| *kind == ReqKind::Must) {
        phrases.extend(cued_sentences(text, &read.in_nice));
    }
    for (phrase, kind, stage) in phrases.into_iter().flat_map(cut_nice_lead) {
        if describes_role(phrase) {
            continue;
        }
        let start = offset(text, phrase);
        doc.requirement_lines.push(start..start + phrase.len());
        let level = level_in(phrase);
        if soft_sentence(phrase) {
            let nice = kind == ReqKind::Nice || nice_cue(phrase);
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
        // `X, idealerweise Y`: nice from the cue on; `X und Y von Vorteil`: a closing cue
        // makes the whole line nice.
        let closing = parts.last().is_some_and(|(r, _)| {
            let folded = fold(&phrase[r.clone()]);
            lex::NICE_CLOSING.iter().any(|c| folded.contains(c))
        });
        let mut nice = kind == ReqKind::Nice || closing;
        let classes = part_classes(phrase, &parts, level, vocab);
        for (((span, alternatives), class), tail) in parts.into_iter().zip(classes).zip(tails) {
            let whole = &phrase[span.clone()];
            if atoms::atoms(whole, vocab).is_empty() || not_needed(whole) || noise_item(whole) {
                continue;
            }
            let with_tail = |text: &str| match &tail {
                Some(t) => format!("{text} {}", &phrase[t.clone()]),
                None => text.to_owned(),
            };
            nice |= nice_cue(whole);
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
            || heading_of(stripped, bullet).is_some()
            || closing_start(stripped)
            || in_nice.contains(&offset(text, stripped))
        {
            continue;
        }
        for sentence in sentences(stripped) {
            let phrase = sections::clean_phrase(sentence);
            let folded = fold(phrase);
            let english = EN_CUES.iter().any(|c| folded.contains(c));
            let kind = sections::cue_kind(phrase).or(english.then_some(ReqKind::Must));
            if let Some(kind) = kind {
                let kind = if nice_cue(phrase) {
                    ReqKind::Nice
                } else {
                    kind
                };
                phrases.push((phrase, kind, Stage::Sentence));
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

/// Sentences of a line: split after `.!?;` and whitespace before an uppercase letter or a
/// digit, but not after abbreviations (`z. B.`, `u. a.`, `inkl.`).
pub(crate) fn sentences(line: &str) -> Vec<&str> {
    let text = strip(line);
    let mut parts = Vec::new();
    let mut start = 0;
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    for (i, &(at, c)) in chars.iter().enumerate() {
        if !matches!(c, '.' | '!' | '?' | ';') {
            continue;
        }
        let Some(&(_, next)) = chars.get(i + 1) else {
            continue;
        };
        if !next.is_whitespace() {
            continue;
        }
        let Some(&(word_at, first)) = chars[i + 1..].iter().find(|(_, c)| !c.is_whitespace())
        else {
            continue;
        };
        if !(first.is_uppercase() || first.is_ascii_digit()) {
            continue;
        }
        let word = text[..at]
            .rsplit(|c: char| !c.is_alphanumeric())
            .next()
            .unwrap_or("");
        if c == '.'
            && (word.chars().count() <= 2 || ABBREVIATIONS.contains(&word.to_lowercase().as_str()))
        {
            continue;
        }
        parts.push(&text[start..=at]);
        start = word_at;
    }
    parts.push(&text[start..]);
    parts
        .into_iter()
        .map(strip)
        .filter(|p| !p.is_empty())
        .collect()
}

/// Byte ranges of (ASCII, case-insensitive) separators at parenthesis depth 0.
fn separators(text: &str, words: &[&str]) -> Vec<Range<usize>> {
    let bytes = text.as_bytes();
    let mut found = Vec::new();
    let mut depth = 0i32;
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'(' | b'[' => depth += 1,
            b')' | b']' => depth -= 1,
            _ => {}
        }
        let after_hyphen = i > 0 && bytes[i - 1] == b'-';
        if depth == 0
            && !after_hyphen
            && let Some(word) = words.iter().find(|w| {
                bytes
                    .get(i..i + w.len())
                    .is_some_and(|b| b.eq_ignore_ascii_case(w.as_bytes()))
            })
        {
            found.push(i..i + word.len());
            i += word.len();
            continue;
        }
        i += 1;
    }
    found
}

fn cut(text: &str, seps: &[Range<usize>]) -> Vec<Range<usize>> {
    let mut parts = Vec::new();
    let mut start = 0;
    for sep in seps {
        // Overlapping separators (", " inside ", oder ") merge into one cut.
        if sep.start < start {
            start = start.max(sep.end);
            continue;
        }
        parts.push(start..sep.start);
        start = sep.end;
    }
    parts.push(start..text.len());
    parts
        .into_iter()
        .map(|r| trim_range(text, r))
        .filter(|r| !r.is_empty())
        .collect()
}

fn trim_range(text: &str, range: Range<usize>) -> Range<usize> {
    let part = &text[range.clone()];
    let trimmed =
        part.trim_matches(|c: char| c.is_whitespace() || c == '.' || c == ',' || c == ';');
    let start = range.start + (trimmed.as_ptr() as usize - part.as_ptr() as usize);
    start..start + trimmed.len()
}

/// First example marker in a text: (start, end) byte offsets.
fn example_marker(text: &str) -> Option<(usize, usize)> {
    let lower = text.to_lowercase();
    if lower.len() != text.len() {
        return None;
    }
    EXAMPLES
        .iter()
        .filter_map(|m| lower.find(m).map(|at| (at, at + m.len())))
        // Same total length does not mean same offsets ("İẞ" folds to "i̇ß").
        .filter(|&(at, end)| text.is_char_boundary(at) && text.is_char_boundary(end))
        .min()
}

/// The AND separators that really part two requirements: none inside a fixed phrase
/// (`in Wort und Schrift`), none before a comma tail (`, gerne auch`), none between the
/// bare nouns listed after a word of working together
/// (`Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern`).
fn joined(phrase: &str, seps: &[Range<usize>]) -> Vec<Range<usize>> {
    let lower = phrase.to_lowercase();
    let protected: Vec<Range<usize>> = lex::PROTECTED_PHRASES
        .iter()
        .flat_map(|p| lower.match_indices(p).map(|(at, m)| at..at + m.len()))
        .collect();
    let mut kept: Vec<Range<usize>> = Vec::new();
    let mut listing = false;
    for (i, sep) in seps.iter().enumerate() {
        let inside = protected
            .iter()
            .any(|p| p.start <= sep.start && sep.end <= p.end);
        let rest = lower.get(sep.end..).unwrap_or("");
        let tail = phrase[sep.clone()].starts_with(',')
            && lex::COMMA_TAILS
                .iter()
                .chain(lex::PROTECTED_PHRASES)
                .any(|t| rest.starts_with(t));
        // The part before this separator, and the part after it (up to the next one).
        let before_start = if i == 0 { 0 } else { seps[i - 1].end };
        let before = lower.get(before_start..sep.start).unwrap_or("");
        let after_end = seps.get(i + 1).map_or(phrase.len(), |s| s.start);
        let after = phrase.get(sep.end..after_end).unwrap_or("");
        if lex::LIST_OBJECT_WORDS.iter().any(|w| before.contains(w)) {
            listing = true;
        }
        // Only a bare noun after the list word keeps the list together.
        listing = listing && after.split_whitespace().count() == 1 && !known_skill(after);
        // `Steuerung großer IT-Projekte und externer Dienstleister`: the second object of the
        // same head, declined like the first.
        let before_words: Vec<&str> = phrase
            .get(before_start..sep.start)
            .unwrap_or("")
            .split_whitespace()
            .collect();
        let genitive = coordinated_object(&before_words, after);
        // `Projektplanung und -controlling`: the head shares the word before it.
        let ellipsis = after.starts_with('-');
        // `Kenntnisse in klassischen und agilen Methoden`: the declined adjective shares the
        // noun of the next part.
        let dangling = before_words.last().is_some_and(|w| declined_adjective(w))
            && after
                .split_whitespace()
                .next()
                .is_some_and(|w| w.chars().next().is_some_and(char::is_lowercase));
        // `Erfahrung in der Erstellung und Anwendung von Personas`: two activities share the
        // object the second one names.
        let activities = activity_pair(&before_words, after);
        if inside || tail || listing || genitive || ellipsis || dangling || activities {
            continue;
        }
        kept.push(sep.clone());
    }
    kept
}

/// The class of each part of a line, classified once: one soft part among parts without a
/// known skill makes all of them soft (`verbindlich, pragmatisch und mit Freude am Detail`).
fn part_classes(
    phrase: &str,
    parts: &[(Range<usize>, Vec<Range<usize>>)],
    level: Option<u8>,
    vocab: &Vocab,
) -> Vec<Class> {
    let classes: Vec<Class> = parts
        .iter()
        .map(|(r, _)| classify(&phrase[r.clone()], level, vocab))
        .collect();
    let soft_line = classes.contains(&Class::Soft)
        && parts
            .iter()
            .zip(&classes)
            .all(|((r, _), class)| *class == Class::Soft || !known_skill(&phrase[r.clone()]));
    classes
        .into_iter()
        .map(|class| match class {
            Class::Skill if soft_line => Class::Soft,
            class => class,
        })
        .collect()
}

/// The object a part shares with the next ones (`Erfahrung im Aufbau und in der Führung von
/// Vertriebsteams`: `im Aufbau` is of the sales teams too): a part that ends in a noun after
/// an activity preposition, followed by parts that start with one, takes the object the
/// last of them names (`von ...`), as a range of `phrase`.
fn shared_objects(
    phrase: &str,
    parts: &[(Range<usize>, Vec<Range<usize>>)],
) -> Vec<Option<Range<usize>>> {
    let preposition = |w: &str| lex::ACTIVITY_PREPOSITIONS.contains(&w.to_lowercase().as_str());
    let words = |r: &Range<usize>| phrase[r.clone()].split_whitespace().collect::<Vec<&str>>();
    let bare_activity = |r: &Range<usize>| {
        let w = words(r);
        w.len() >= 2
            && w.last()
                .is_some_and(|l| l.chars().next().is_some_and(char::is_uppercase))
            && w[w.len().saturating_sub(3)..w.len() - 1]
                .iter()
                .any(|p| preposition(p))
    };
    let object = |r: &Range<usize>| -> Option<Range<usize>> {
        let w = words(r);
        if !w.first().is_some_and(|f| preposition(f)) {
            return None;
        }
        let opener = w.iter().skip(2).find(|x| lex::OBJECT_OPENERS.contains(x))?;
        let at = opener.as_ptr() as usize - phrase.as_ptr() as usize;
        Some(at..r.end)
    };
    (0..parts.len())
        .map(|i| {
            let (part, _) = &parts[i];
            if !bare_activity(part) || object(part).is_some() {
                return None;
            }
            parts[i + 1..]
                .iter()
                .take_while(|(r, _)| words(r).first().is_some_and(|f| preposition(f)))
                .find_map(|(r, _)| object(r))
        })
        .collect()
}

/// Is `after` a second activity with an object (`Anwendung von Personas`) after a part that
/// ends in a bare activity (`Kenntnisse in der Erstellung`)? Both nouns of an activity
/// (`-ung`, `-ion`, `Aufbau`, `Analyse`).
fn activity_pair(before: &[&str], after: &str) -> bool {
    let activity = |w: &str| {
        let folded = fold(w);
        w.chars().next().is_some_and(char::is_uppercase)
            && (folded.ends_with("ung")
                || folded.ends_with("ion")
                || lex::ACTIVITY_NOUNS.contains(&folded.as_str()))
    };
    let Some((last, rest)) = before.split_last() else {
        return false;
    };
    let bare = activity(last)
        && rest.iter().rev().take(3).any(|w| {
            let w = w.to_lowercase();
            lex::ACTIVITY_PREPOSITIONS.contains(&w.as_str()) || w == "mit"
        });
    let words: Vec<&str> = after
        .split_whitespace()
        .skip_while(|w| lex::ARTICLES.contains(&w.to_lowercase().as_str()))
        .collect();
    bare && words.first().is_some_and(|w| activity(w))
        && words[1..].iter().any(|w| lex::OBJECT_OPENERS.contains(w))
}

/// A declined German adjective written in lower case (`klassischen`, `organisatorische`,
/// `qualitativer`): an adjective stem with a declension ending.
fn declined_adjective(word: &str) -> bool {
    word.chars().next().is_some_and(char::is_lowercase)
        && word.chars().all(char::is_alphabetic)
        && word.chars().count() >= 5
        && ["e", "en", "er", "es", "em"].iter().any(|ending| {
            word.strip_suffix(ending)
                .is_some_and(|stem| lex::ADJECTIVE_STEMS.iter().any(|s| stem.ends_with(s)))
        })
}

/// Is `after` a second object of the head noun that starts `before` (`Steuerung großer
/// IT-Projekte` and `externer Dienstleister`): both a lower-case adjective with the same
/// ending right after the head?
fn coordinated_object(before: &[&str], after: &str) -> bool {
    let mut words = after.split_whitespace();
    let (Some(first), Some(_)) = (words.next(), words.next()) else {
        return false;
    };
    let head_is_noun = before
        .first()
        .and_then(|w| w.chars().next())
        .is_some_and(char::is_uppercase);
    let adjective = |w: &str| {
        w.chars().next().is_some_and(char::is_lowercase)
            && lex::DECLINED_ENDINGS.iter().any(|e| w.ends_with(e))
            && w.chars().count() > 4
    };
    head_is_noun
        && before.get(1).is_some_and(|w| adjective(w))
        && adjective(first)
        && lex::DECLINED_ENDINGS
            .iter()
            .any(|e| first.ends_with(e) && before[1].ends_with(e))
}

/// Does a text name a known skill: a code or number (`SAP`, `S/4HANA`, `ISO 9001`), a
/// language, a trigger of any domain pack or a term of the general vocabulary?
pub(crate) fn known_skill(text: &str) -> bool {
    let code = text
        .split(|c: char| !(c.is_alphanumeric() || matches!(c, '/' | '&' | '+')))
        .any(|w| {
            let letters = w.chars().filter(|c| c.is_alphabetic()).count();
            w.chars().any(|c| c.is_ascii_digit())
                || ((2..=6).contains(&letters) && w.chars().all(|c| !c.is_lowercase()))
        });
    if code {
        return true;
    }
    let folded = fold(text);
    let tokens: Vec<&str> = atoms::raw_tokens(&folded).collect();
    tokens.iter().any(|t| {
        language_of(t).is_some()
            || super::lexicon::domains::DOMAINS
                .iter()
                .any(|d| d.triggers.iter().any(|p| t.starts_with(p)))
            || super::lexicon::JOB_SKILL_VOCAB.contains(t)
    })
}

/// The language a token names (`Englisch`, `English`, `Niederländisch`, `Dutch`).
pub(crate) fn language_of(token: &str) -> Option<&'static str> {
    lex::LANGUAGES
        .iter()
        .find(|l| token.starts_with(**l))
        .copied()
        .or_else(|| {
            lex::LANGUAGE_NAMES
                .iter()
                .find(|(name, _)| *name == token)
                .map(|&(_, stem)| stem)
        })
}

/// A sentence that describes the role or the search, no skill (`lex::DESCRIPTION_STARTS`).
fn describes_role(phrase: &str) -> bool {
    let folded = fold(phrase);
    lex::DESCRIPTION_STARTS
        .iter()
        .any(|w| folded.starts_with(w))
}

/// A sentence about the person, not a skill: it starts with `Sie`, `Du`, `You` or `Your`
/// and names no known skill (`Sie kommunizieren klar, auch wenn es unbequem wird`).
fn soft_sentence(phrase: &str) -> bool {
    let folded = fold(phrase);
    let first = atoms::raw_tokens(&folded).next().unwrap_or("");
    lex::PRONOUN_STARTS.contains(&first) && !known_skill(phrase)
}

/// A part that is one adjective (`Classic`, `klassische`, `strategic`).
fn lone_adjective(text: &str) -> bool {
    let word = fold(text.trim());
    !word.is_empty()
        && !word.contains(char::is_whitespace)
        && word.chars().all(char::is_alphabetic)
        && lex::ADJECTIVE_ENDINGS.iter().any(|e| word.ends_with(e))
}

/// Items of a requirement phrase: (item range, alternative ranges), relative to `phrase`.
pub(crate) fn split(phrase: &str) -> Vec<(Range<usize>, Vec<Range<usize>>)> {
    let lower = fold(phrase);
    let has_or = OR.iter().any(|w| lower.contains(w));
    let has_and = AND_WORDS.iter().any(|w| lower.contains(w));
    let and_seps: Vec<Range<usize>> = if has_or && !has_and {
        separators(phrase, &["; "])
    } else {
        joined(phrase, &separators(phrase, AND))
    };
    let mut items: Vec<(Range<usize>, Vec<Range<usize>>)> = Vec::new();
    let parts = cut(phrase, &and_seps);
    for (index, part) in parts.iter().cloned().enumerate() {
        let text = &phrase[part.clone()];
        // `Classic and agile project management`: the lone adjective shares the next
        // part's noun, it is no requirement of its own.
        if lone_adjective(text)
            && parts
                .get(index + 1)
                .is_some_and(|next| phrase[next.clone()].split_whitespace().count() >= 2)
        {
            continue;
        }
        let marker = example_marker(text);
        // "z. B. LucaNet" after a comma: examples of the previous item.
        if let Some((0, after)) = marker
            && let Some((_, alternatives)) = items.last_mut()
        {
            alternatives.extend(example_list(phrase, part.start + after..part.end));
            continue;
        }
        let mut alternatives = Vec::new();
        let close = |open: usize| text[open..].find(')').map_or(text.len(), |c| open + c);
        let (head, examples) = match (text.find('('), marker) {
            // "(z. B. LucaNet)": only a marker inside the brackets opens them; "(SAP) z. B."
            // is a marker after a closed bracket.
            (Some(open), Some((start, after))) if start > open && close(open) >= after => (
                part.start..part.start + open,
                Some(part.start + after..part.start + close(open)),
            ),
            (_, Some((start, after))) => (
                part.start..part.start + start,
                Some(part.start + after..part.end),
            ),
            _ => (part.clone(), None),
        };
        let head = trim_range(phrase, head);
        let or_seps: Vec<Range<usize>> = separators(&phrase[head.clone()], OR)
            .into_iter()
            .map(|r| head.start + r.start..head.start + r.end)
            .collect();
        if has_or && !has_and {
            let comma: Vec<Range<usize>> = separators(&phrase[head.clone()], &[", "])
                .into_iter()
                .map(|r| head.start + r.start..head.start + r.end)
                .collect();
            let mut all: Vec<Range<usize>> = or_seps.into_iter().chain(comma).collect();
            all.sort_by_key(|r| r.start);
            alternatives.extend(cut_abs(phrase, &head, &all));
        } else {
            alternatives.extend(cut_abs(phrase, &head, &or_seps));
        }
        if let Some(list) = examples {
            alternatives.extend(example_list(phrase, list));
        }
        if !head.is_empty() {
            items.push((part, alternatives));
        }
    }
    items
}

fn cut_abs(phrase: &str, within: &Range<usize>, seps: &[Range<usize>]) -> Vec<Range<usize>> {
    let local: Vec<Range<usize>> = seps
        .iter()
        .map(|r| r.start - within.start..r.end - within.start)
        .collect();
    cut(&phrase[within.clone()], &local)
        .into_iter()
        .map(|r| within.start + r.start..within.start + r.end)
        .collect()
}

fn example_list(phrase: &str, list: Range<usize>) -> Vec<Range<usize>> {
    let list = trim_range(phrase, list);
    let seps: Vec<Range<usize>> = separators(&phrase[list.clone()], EXAMPLE_SEPARATORS)
        .into_iter()
        .map(|r| list.start + r.start..list.start + r.end)
        .collect();
    cut_abs(phrase, &list, &seps)
}

/// Highest language level word in a text.
pub(crate) fn level_in(text: &str) -> Option<u8> {
    let folded = fold(text);
    lex::LEVEL_WORDS
        .iter()
        .filter(|(word, _)| contains_word(&folded, word))
        .map(|&(_, level)| level)
        .max()
}

/// Whole-word (or whole-phrase) containment in a folded text.
pub(crate) fn contains_word(folded: &str, word: &str) -> bool {
    let mut from = 0;
    while let Some(at) = folded[from..].find(word) {
        let start = from + at;
        let end = start + word.len();
        let before = folded[..start]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphanumeric());
        let after = folded[end..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_alphanumeric());
        if before && after {
            return true;
        }
        from = end;
    }
    false
}

fn starts_with_any(atom: &str, stems: &[&str]) -> bool {
    stems.iter().any(|s| atom.starts_with(s))
}

/// Any frame word inside a word (the quick test before the rules of [`frame_word`]).
static FRAME_ANY: LazyLock<Regex> = LazyLock::new(|| {
    let words: Vec<String> = lex::FRAME_WORDS.iter().map(|w| regex::escape(w)).collect();
    Regex::new(&words.join("|")).expect("frame words")
});

/// A word with one of `WORD_ENDINGS` (or none) after `stem`.
fn ending_after<'w>(word: &'w str, stem: &str) -> Option<&'w str> {
    word.strip_prefix(stem)
        .filter(|rest| rest.is_empty() || lex::WORD_ENDINGS.contains(rest))
}

/// Is `part` one of `heads`, perhaps with an ending?
fn is_head(part: &str, heads: &[&str]) -> bool {
    heads.iter().any(|h| ending_after(part, h).is_some())
}

/// The compound head after a modifier (and its linking letters) in `rest`.
fn heads_after(rest: &str) -> impl Iterator<Item = &str> {
    std::iter::once(rest).chain(
        lex::LINKERS
            .iter()
            .filter_map(move |l| rest.strip_prefix(l)),
    )
}

/// Does a word (folded) stand for a frame condition? The frame word itself or with an
/// ending (`Verfügbarkeit`), a compound of a frame word and a frame head
/// (`Reisebereitschaft`, `Gehaltsvorstellung`, `Remote-Arbeit`) or a compound that ends in
/// a frame word (`Projektlaufzeit`, `Dienstreise`). A frame word that only modifies another
/// head is a skill (`Vergütungsmanagement`, `Gehaltsabrechnung`, `Standortleitung`,
/// `Start-up`).
pub(crate) fn frame_word(word: &str) -> bool {
    // Most words contain no frame word at all: one pass over the word first.
    if !FRAME_ANY.is_match(word) {
        return false;
    }
    let frame = |part: &str| {
        lex::FRAME_WORDS
            .iter()
            .any(|f| ending_after(part, f).is_some())
    };
    let head = |part: &str| is_head(part, lex::FRAME_HEADS) || frame(part);
    if frame(word) {
        return true;
    }
    if let (Some((first, _)), Some((_, last))) = (word.split_once('-'), word.rsplit_once('-')) {
        return (frame(first) && head(last))
            || (frame(last) && !lex::NOT_FRAME_MODIFIERS.contains(&first));
    }
    lex::FRAME_WORDS.iter().any(|f| {
        let compound = word
            .strip_prefix(f)
            .is_some_and(|rest| heads_after(rest).any(|h| !h.is_empty() && head(h)));
        // `Projektlaufzeit`: a real modifier (four letters or more) before a frame word of
        // five letters or more (`corporate` does not end in the frame word `rate`).
        let ends = f.len() >= 5
            && word.len() >= f.len() + 4
            && word.find(f).is_some_and(|at| {
                at >= 4
                    && ending_after(&word[at..], f).is_some()
                    && !lex::NOT_FRAME_MODIFIERS.iter().any(|m| word.starts_with(m))
            });
        compound || ends
    })
}

/// Is the item a frame condition? A frame word counts unless an English skill head follows
/// it (`Hybrid Cloud`, `Travel Management`) or the item names compensation work
/// (`Vergütung und Benefits`).
fn is_frame(folded: &str, tokens: &[&str]) -> bool {
    if tokens
        .iter()
        .any(|t| lex::FRAME_SKILL_CONTEXT.iter().any(|c| t.starts_with(c)))
    {
        return false;
    }
    tokens.iter().enumerate().any(|(i, t)| {
        frame_word(t)
            && !tokens.get(i + 1).is_some_and(|next| {
                lex::FRAME_MODIFIED_HEADS.contains(next) && joined_by_space(folded, t, next)
            })
    })
}

/// Are two tokens of `folded` (slices of it) separated by spaces only?
fn joined_by_space(folded: &str, first: &str, second: &str) -> bool {
    let start = folded.as_ptr() as usize;
    let end_first = first.as_ptr() as usize + first.len() - start;
    let begin_second = second.as_ptr() as usize - start;
    folded
        .get(end_first..begin_second)
        .is_some_and(|gap| !gap.is_empty() && gap.chars().all(char::is_whitespace))
}

/// Is a token a soft skill? The soft word with an ending (`analytische`, `Flexibilität`) or
/// a compound with a soft head (`Kommunikationsfähigkeit`); a soft adjective before another
/// noun is a modifier (`analytische Methodenvalidierung`), and a compound with another head
/// is a skill (`Kommunikationsstrategie`).
fn soft_token(folded: &str, tokens: &[&str], i: usize) -> bool {
    let t = tokens[i];
    lex::SOFT_SKILLS.iter().any(|s| {
        if ending_after(t, s).is_some() {
            let modifies = tokens.get(i + 1).is_some_and(|next| {
                joined_by_space(folded, t, next)
                    && next.len() >= 4
                    && next.chars().all(|c| c.is_alphabetic() || c == '-')
                    && !atoms::is_filler(next)
                    && !is_head(next, lex::SOFT_HEADS)
                    && !lex::SOFT_SKILLS.iter().any(|o| next.starts_with(o))
            });
            return !modifies;
        }
        t.strip_prefix(s)
            .is_some_and(|rest| heads_after(rest).any(|h| is_head(h, lex::SOFT_HEADS)))
    })
}

/// Other atoms from which an item that names a language is a skill line instead.
const LANGUAGE_ITEM_OTHERS: usize = 4;

fn classify(text: &str, phrase_level: Option<u8>, vocab: &Vocab) -> Class {
    let folded = fold(text);
    let tokens: Vec<&str> = atoms::raw_tokens(&folded).collect();
    // A rate statement (`1.000 bis 1.200 € pro Tag`) is the frame, never a skill.
    if is_frame(&folded, &tokens) || rate_in(&folded).is_some() {
        return Class::Frame;
    }
    if let Some(word) = lex::LICENCE_WORDS.iter().find(|w| folded.contains(**w))
        && lex::LICENCE_CONTEXT.iter().any(|c| folded.contains(c))
    {
        return Class::Licence(word);
    }
    let content = atoms::atoms(text, vocab);
    let soft = (0..tokens.len())
        .filter(|&i| soft_token(&folded, &tokens, i))
        .count()
        + lex::SOFT_PHRASES
            .iter()
            .filter(|p| folded.contains(*p))
            .count();
    // Whom the soft skill addresses is no skill of its own.
    let audience = content
        .iter()
        .filter(|a| {
            lex::AUDIENCE_ATOMS.contains(&a.as_str())
                || (a.ends_with("eb") && !a.ends_with("trieb"))
        })
        .count();
    if soft > 0 && 2 * soft >= content.len() - if soft > 0 { audience } else { 0 } {
        return Class::Soft;
    }
    // `Arbeitsweise`, `working style`, `Soft Skills` alone.
    if !content.is_empty()
        && content
            .iter()
            .all(|a| lex::SOFT_ALONE.iter().any(|w| atoms::stem(w) == *a))
    {
        return Class::Soft;
    }
    // A language item names little else (`Deutsch fließend`); a line of several skills that
    // ends with a language is no language requirement.
    let others = content.iter().filter(|a| language_of(a).is_none()).count();
    if let Some(language) = tokens
        .iter()
        .map(|t| (*t).to_owned())
        .chain(content.iter().cloned())
        .find_map(|t| language_of(&t))
        .filter(|_| others < LANGUAGE_ITEM_OTHERS)
    {
        return Class::Language(language.to_owned(), level_in(text).or(phrase_level));
    }
    if names_degree(&tokens) {
        return Class::Degree;
    }
    Class::Skill
}

/// Do the tokens name a degree (`Master Data Management` does not)?
pub(crate) fn names_degree(tokens: &[&str]) -> bool {
    let sales = tokens
        .iter()
        .any(|t| starts_with_any(t, lex::PROMOTION_NOT_DEGREE));
    tokens.iter().enumerate().any(|(i, t)| {
        (starts_with_any(t, lex::DEGREE_WORDS)
            || lex::DEGREE_ENDINGS.iter().any(|e| t.ends_with(e)))
            && !(sales && t.starts_with("promotion"))
            && !(t.starts_with("master")
                && (lex::MASTER_NOT_DEGREE
                    .iter()
                    .any(|w| t.len() > 6 && t[6..].trim_start_matches('-').starts_with(w))
                    || tokens
                        .get(i + 1)
                        .is_some_and(|n| starts_with_any(n, lex::MASTER_NOT_DEGREE))))
    })
}

/// Required years: `mindestens 10 Jahre`, `10+ years`, `zehn Jahre`, and a range with its
/// lower and upper end (`3-5 Jahre`, `3 bis 5 Jahre`, `between 3 and 5 years`).
pub(crate) fn years_in(text: &str) -> Option<(u32, Option<u32>)> {
    let folded = fold(text);
    let words: Vec<&str> = folded
        .split(|c: char| !c.is_alphanumeric() && c != '+')
        .filter(|w| !w.is_empty())
        .collect();
    let number = |w: &str| {
        let w = w.trim_end_matches('+');
        w.parse::<u32>()
            .ok()
            .or_else(|| {
                NUMBER_WORDS
                    .iter()
                    .find(|(word, _)| *word == w)
                    .map(|&(_, n)| n)
            })
            .filter(|n| (1..=40).contains(n))
    };
    (1..words.len()).find_map(|i| {
        if !YEAR_UNITS.iter().any(|u| words[i].starts_with(u)) {
            return None;
        }
        let n = number(words[i - 1])?;
        // `3-5 Jahre` (the dash splits the words), `3 bis 5 Jahre`.
        let other = match i {
            2.. if number(words[i - 2]).is_some() => number(words[i - 2]),
            3.. if RANGE_WORDS.contains(&words[i - 2]) => number(words[i - 3]),
            _ => None,
        };
        Some(match other {
            Some(m) if m != n => (m.min(n), Some(m.max(n))),
            _ => (n, None),
        })
    })
}

/// Words between the two ends of a range of years.
const RANGE_WORDS: &[&str] = &["bis", "to", "and", "und"];

/// Does the lexicon know this heading text? (for tests and the relevance fields)
#[cfg(test)]
pub(crate) fn heading_kind(line: &str) -> Option<HeadingKind> {
    heading(line)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn task_lines_follow_a_task_heading() {
        let text = "Aufgaben:
- Aufbau des Service Desk
- Steuerung der Dienstleister

Ihr Profil:
- SAP FI
";
        let doc = read(text, &Vocab::all());
        let lines: Vec<&str> = doc.task_lines.iter().map(|r| &text[r.clone()]).collect();
        assert_eq!(
            lines,
            ["- Aufbau des Service Desk", "- Steuerung der Dienstleister"]
        );
        assert!(doc.items.iter().all(|i| !i.text.contains("Service Desk")));
        let key = "Key Responsibilities
Lead the team
";
        assert_eq!(read(key, &Vocab::all()).task_lines.len(), 1);
    }

    #[test]
    fn degrees_and_their_fields() {
        let degree = |text: &str| {
            let folded = fold(text);
            names_degree(&atoms::raw_tokens(&folded).collect::<Vec<_>>())
        };
        assert!(degree("MSc or PhD in life sciences, pharmacy or chemistry"));
        assert!(degree("Master in Business Administration"));
        assert!(!degree("Erfahrung im Master Data Management"));
        assert!(!degree("Masterdaten und Stammdatenpflege"));
        assert!(degree("Promotion in Chemie oder Pharmazie"));
        assert!(degree("Zweites Staatsexamen in Pharmazie"));
        assert!(!degree("Erfahrung in Sales Promotion und Handel"));
        let fields = |text: &str| super::super::fit::degree_fields_in(&fold(text));
        assert_eq!(
            fields("Naturwissenschaftliches Studium (Pharmazie, Chemie, Biologie)"),
            ["life-science", "science"]
        );
        assert_eq!(
            fields("Dr. rer. nat., approbierte Apothekerin"),
            ["life-science", "science"]
        );
    }

    fn class(text: &str) -> Class {
        classify(text, None, &Vocab::all())
    }

    /// Frame words count as whole words, with an ending, before a frame head or at the end
    /// of a compound; as a modifier of another head they are part of a skill.
    #[test]
    fn frame_words_are_words_not_prefixes() {
        for frame in [
            "Reisebereitschaft",
            "Reisetätigkeit bis 50 %",
            "Verfügbarkeit ab sofort",
            "Startdatum 01.11.2026",
            "Gehaltsvorstellung",
            "Remote-Arbeit möglich",
            "Projektlaufzeit 6 Monate",
            "Hybrid, 2 Tage vor Ort",
            "Travel willingness",
            "Remote work",
            "Location: Munich",
            "Präsenzpflicht in Hamburg",
        ] {
            assert_eq!(class(frame), Class::Frame, "{frame}");
        }
        for skill in [
            "Vergütungsmanagement",
            "Gehaltsabrechnung",
            "Standortschließung",
            "Standortleitung",
            "Salary Benchmarking",
            "Hybrid Cloud",
            "Travel Management",
            "Start-up-Erfahrung",
            "Erfahrung mit Vergütung und Benefits",
            "Aufbau der Online-Präsenz",
            "Corporate Finance",
            "Resource allocation",
        ] {
            assert_eq!(class(skill), Class::Skill, "{skill}");
        }
    }

    /// Soft words are soft with an ending or a soft head; a compound with another head or
    /// a soft adjective before another noun is a skill.
    #[test]
    fn soft_words_are_words_not_prefixes() {
        for soft in [
            "Kommunikationsstärke",
            "Kommunikationsfähigkeit",
            "Analytisches Denken",
            "Analytische und konzeptionelle Fähigkeiten",
            "Flexibilität und Belastbarkeit",
            "Selbstständige Arbeitsweise",
            "Communication skills",
        ] {
            assert_eq!(class(soft), Class::Soft, "{soft}");
        }
        for skill in [
            "Kommunikationsstrategie",
            "Analytische Methodenvalidierung",
            "Communication strategy",
            "unternehmerische Verantwortung",
        ] {
            assert_eq!(class(skill), Class::Skill, "{skill}");
        }
    }

    /// Soft words of every kind of ad; a soft word alone; a sentence about the person.
    /// The greeting under a recruiter's list closes it: no requirement follows.
    #[test]
    fn a_greeting_closes_the_requirements() {
        let doc = read(
            "Ihr Profil\n- Erste Führungserfahrung\n- Haben wir Ihr Interesse geweckt?\n\
             - Dann senden Sie mir Ihr Profil\n- Viele Grüße\n- Max Muster\n",
            &Vocab::all(),
        );
        let items: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(items, ["Erste Führungserfahrung"]);
    }

    /// A bare `Skills` heading over prose opens the requirements; over a tag list it stays the
    /// portal's tags.
    #[test]
    fn a_skills_heading_over_prose_lists_requirements() {
        let texts = |text: &str| -> Vec<String> {
            read(text, &Vocab::all())
                .items
                .into_iter()
                .filter(|i| i.stage == Stage::Section)
                .map(|i| i.text)
                .collect()
        };
        assert_eq!(
            texts(
                "Skills:
Substantive experience from leading IT projects at several clients
"
            ),
            ["Substantive experience from leading IT projects at several clients"]
        );
        assert!(
            texts(
                "Skills
SAP FI, DATEV, HGB, IFRS, Konzernabschluss
"
            )
            .is_empty()
        );
    }

    /// Application, contact and privacy lines and the sign-off close the requirements too.
    #[test]
    fn application_and_contact_lines_close_the_requirements() {
        for closing in [
            "Bewerbung: Bei Interesse senden Sie bitte Ihren CV",
            "Bei Interesse senden Sie mir Ihr Profil",
            "Sind Sie aktuell verfügbar und passt dies zu Ihren Kompetenzen?",
            "Ich freue mich auf Ihre Rückmeldung!",
            "Wir bestätigen, dass wir alle Bewerbungen vertraulich behandeln",
            "Ihr Ansprechpartner: Max Muster",
            "Kind regards,",
            "© 2026 Muster GmbH",
        ] {
            let doc = read(
                &format!(
                    "Ihr Profil\n- Erste Führungserfahrung\n- {closing}\n- Datenmodellierung\n"
                ),
                &Vocab::all(),
            );
            let items: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
            assert_eq!(items, ["Erste Führungserfahrung"], "{closing}");
        }
    }

    #[test]
    fn soft_words_sentences_and_words_alone() {
        for soft in [
            "Strukturierte und sorgfältige Arbeitsweise",
            "Zahlenaffinität, Sorgfalt und Neugier",
            "Überzeugungskraft",
            "Verhandlungsstärke",
            "Structured approach",
            "Reliable and analytical",
            "Strong analytical skills",
            "Arbeitsweise",
            "Working style",
            "Soft Skills",
            "Hohe Kunden- und Serviceorientierung",
            "Ausgeprägte Problemlösungskompetenz",
            "Gestaltungswillen",
            "Umsetzungsstärke",
            "hohes Maß an Eigeninitiative",
            "kommunikative Fähigkeiten",
            "Unternehmerisches Denken",
            "Zahlenverständnis",
            "Hohe Kunden- und Vertriebsorientierung",
            "Sehr gute Kommunikationsfähigkeiten auf Fach-, IT- und Managementebene",
            "Sicheres Auftreten auf unterschiedlichen Hierarchieebenen",
        ] {
            assert_eq!(class(soft), Class::Soft, "{soft}");
        }
        let doc = read(
            "Ihr Profil\n- Sie kommunizieren klar und wertschätzend, auch wenn es unbequem wird\n\
             - Sie haben Erfahrung mit SAP FI\n",
            &Vocab::all(),
        );
        let classes: Vec<(&str, &Class)> = doc
            .items
            .iter()
            .map(|i| (i.text.as_str(), &i.class))
            .collect();
        assert_eq!(
            classes[0],
            (
                "Sie kommunizieren klar und wertschätzend, auch wenn es unbequem wird",
                &Class::Soft
            )
        );
        // A sentence naming a known skill stays a requirement.
        assert!(
            classes
                .iter()
                .any(|(t, c)| t.contains("SAP FI") && **c == Class::Skill)
        );
    }

    /// `in Wort und Schrift` is one item; a comma tail stays with its item; the partners
    /// listed after `Zusammenarbeit mit` are one item, a skill list after `Erfahrung mit`
    /// is not.
    #[test]
    fn fixed_phrases_comma_tails_and_partner_lists() {
        let texts =
            |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
        assert_eq!(
            texts("Sehr gutes Deutsch in Wort und Schrift"),
            ["Sehr gutes Deutsch in Wort und Schrift"]
        );
        assert_eq!(
            texts("Fluent English, written and spoken"),
            ["Fluent English, written and spoken"]
        );
        assert_eq!(
            texts("Erfahrung mit SAP, gerne auch S/4HANA"),
            ["Erfahrung mit SAP, gerne auch S/4HANA"]
        );
        assert_eq!(
            texts("Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern"),
            ["Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern"]
        );
        assert_eq!(
            texts("Erfahrung mit Finanzierungsrunden und Investorenkommunikation"),
            [
                "Erfahrung mit Finanzierungsrunden",
                "Investorenkommunikation"
            ]
        );
    }

    /// Tag lines, notices and company lines are no requirements; soft phrases and soft
    /// lines; coordinated objects and partners stay one item.
    #[test]
    fn reading_noise_of_ads() {
        let texts = |section: &str| -> Vec<(String, Class)> {
            read(&format!("Ihr Profil\n{section}\n"), &Vocab::all())
                .items
                .into_iter()
                .map(|i| (i.text, i.class))
                .collect()
        };
        let found =
            texts("- SAP FI\nSkills: SAP, Excel, Power BI\n- Datenschutz liegt uns am Herzen\n");
        assert_eq!(found, [("SAP FI".to_owned(), Class::Skill)]);
        let found =
            texts("- Muster GmbH, München, Hamburg, Köln\n- seit 1998 am Markt\n- SAP CO\n");
        assert_eq!(found, [("SAP CO".to_owned(), Class::Skill)]);
        assert_eq!(
            texts("- Freude an komplexen Verhandlungen\n")[0].1,
            Class::Soft
        );
        // One soft part and parts without a known skill: the whole line is soft.
        assert!(
            texts("- Verbindlich, pragmatisch und mit Leidenschaft für gute Lösungen\n")
                .iter()
                .all(|(_, c)| *c == Class::Soft)
        );
        let parts =
            |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
        assert_eq!(
            parts("Steuerung großer IT-Projekte und externer Dienstleister"),
            ["Steuerung großer IT-Projekte und externer Dienstleister"]
        );
        assert_eq!(
            parts("Kommunikation gegenüber Vorstand, Aufsichtsrat und Investoren"),
            ["Kommunikation gegenüber Vorstand, Aufsichtsrat und Investoren"]
        );
        assert_eq!(
            parts("Controlling und Reporting"),
            ["Controlling", "Reporting"]
        );
        let doc = read(
            "Requirements\n- Tableau is a plus\n- SAP S/4HANA preferred\n",
            &Vocab::all(),
        );
        assert!(doc.items.iter().all(|i| i.kind == ReqKind::Nice));
    }

    /// Must and can headings of tenders, portal footers, English nice cues.
    #[test]
    fn tender_headings_footers_and_nice_cues() {
        let doc = read(
            "Muss-Anforderungen\n- SAP FI\nKann-Anforderungen\n- SAP CO\n\
             Projekt-ID: SDP-2026-118\nEingestellt am: 18.09.2026\nBranche: Medizintechnik\n",
            &Vocab::all(),
        );
        let items: Vec<(&str, ReqKind)> = doc
            .items
            .iter()
            .map(|i| (i.text.as_str(), i.kind))
            .collect();
        assert_eq!(
            items,
            [("SAP FI", ReqKind::Must), ("SAP CO", ReqKind::Nice)]
        );
        let doc = read(
            "Requirements\n- Experience under GMP is an advantage\n- Power BI is helpful\n",
            &Vocab::all(),
        );
        assert_eq!(doc.items[0].kind, ReqKind::Nice);
        // The cue word does not count as a skill (`Power BI von Vorteil` is Power BI).
        let vocab = Vocab::all();
        assert_eq!(
            atoms::atoms("Power BI von Vorteil", &vocab),
            atoms::atoms("Power BI", &vocab)
        );
    }

    /// Languages under their English names (`Fluent Dutch`).
    #[test]
    fn languages_by_english_name() {
        assert_eq!(
            class("Fluent Dutch"),
            Class::Language("niederlandisch".into(), Some(5))
        );
        assert_eq!(language_of("english"), Some("englisch"));
        assert_eq!(language_of("germany"), None);
    }

    /// `Qualified Person` and `Sachkundige Person` are one licence.
    #[test]
    fn qualified_person_is_a_licence() {
        assert!(matches!(
            class("Qualified Person according to EU directive"),
            Class::Licence(_)
        ));
        assert!(matches!(
            class("Sachkundige Person nach § 15 AMG"),
            Class::Licence(_)
        ));
    }

    fn items(phrase: &str) -> Vec<(String, Vec<String>)> {
        split(phrase)
            .into_iter()
            .map(|(r, alts)| {
                (
                    phrase[r].to_owned(),
                    alts.into_iter().map(|a| phrase[a].to_owned()).collect(),
                )
            })
            .collect()
    }

    /// (item, must) of an ad's requirement section.
    fn musts(section: &str) -> Vec<(String, bool)> {
        read(&format!("Ihr Profil\n{section}\n"), &Vocab::all())
            .items
            .into_iter()
            .map(|i| (i.text, i.kind == ReqKind::Must))
            .collect()
    }

    #[test]
    fn nice_cues_per_item_negated_items_and_frame_blocks() {
        assert_eq!(
            musts("- Erfahrung im Controlling, idealerweise im Maschinenbau"),
            [
                ("Erfahrung im Controlling".to_owned(), true),
                ("idealerweise im Maschinenbau".to_owned(), false)
            ]
        );
        // The items under a pick list's line are a choice, not each a must; the list ends with a
        // line of its own.
        let picked = musts(
            "- Erfahrung in Großprogrammen
- Fundierte Kenntnisse in mindestens zwei der folgenden              Bereiche:
- SAP S/4HANA
- Salesforce
- API Management
             - Verhandlungssichere Englischkenntnisse in Wort und Schrift.",
        );
        let must = |t: &str| picked.iter().find(|(x, _)| x.contains(t)).map(|(_, m)| *m);
        assert_eq!(must("Großprogrammen"), Some(true), "{picked:?}");
        assert_eq!(must("Salesforce"), Some(false), "{picked:?}");
        assert_eq!(must("API Management"), Some(false), "{picked:?}");
        assert!(
            !picked.iter().any(|(x, _)| x.contains("folgenden")),
            "{picked:?}"
        );
        // An elaboration after a comma is no requirement of its own; a results section is no
        // requirement section.
        let led = musts(
            "- Proven people leadership experience, with the ability to develop and              motivate high-performing teams",
        );
        assert_eq!(
            led,
            [("Proven people leadership experience".to_owned(), true)],
            "{led:?}"
        );
        let results = read(
            "Ihr Profil
- Erfahrung in IT-Transformationen

Erfolgskriterien
             - Etablierte, funktionierende IT-Governance
",
            &Vocab::all(),
        );
        assert_eq!(results.items.len(), 1, "{:?}", results.items);
        let described = musts(
            "- Gesucht wird eine erfahrene Interim-Führungspersönlichkeit auf Partner-Level.
             - Die Rolle ist ausdrücklich keine reine PMO-Position.
- Erfahrung in Multi-Vendor-Umgebungen",
        );
        assert_eq!(described.len(), 1, "{described:?}");
        // An `or` in the nice clause leaves the head a must of its own.
        let items = musts("- 10+ years in finance, ideally in controlling or accounting");
        assert_eq!(
            items[0],
            ("10+ years in finance".to_owned(), true),
            "{items:?}"
        );
        assert!(items[1..].iter().all(|(_, must)| !must), "{items:?}");
        assert!(
            musts("- Kenntnisse in LucaNet und Power BI von Vorteil")
                .iter()
                .all(|(_, must)| !must)
        );
        assert_eq!(musts("- Keine SAP-Kenntnisse erforderlich").len(), 0);
        assert_eq!(
            musts("- Sehr gute Deutsch- und Englischkenntnisse").len(),
            1,
            "a hyphenated shared ending is one item"
        );
        // A frame block ends the requirements.
        let frame = musts(
            "- Erfahrung im Controlling\nRahmendaten\n- Laufzeit 6 Monate\n- Tagessatz 1.000 €",
        );
        assert_eq!(frame.len(), 1, "{frame:?}");
        assert_eq!(
            musts("✅ Erfahrung im Treasury").len(),
            1,
            "a glyph bullet is a bullet"
        );
    }

    #[test]
    fn and_or_and_examples() {
        let got = items("Kenntnisse in LucaNet oder IBM Cognos");
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].1, ["Kenntnisse in LucaNet", "IBM Cognos"]);
        let got = items("Fundierte Kenntnisse in Konsolidierungswerkzeugen, z. B. LucaNet");
        assert_eq!(got.len(), 1);
        assert_eq!(
            got[0].1,
            [
                "Fundierte Kenntnisse in Konsolidierungswerkzeugen",
                "LucaNet"
            ]
        );
        let got = items("Mehrjährige Erfahrung im Controlling, inkl. Budgetierung");
        assert_eq!(got.len(), 2);
        let got = items("Sicherer Umgang mit Power BI / Tableau");
        assert_eq!(got[0].1, ["Sicherer Umgang mit Power BI", "Tableau"]);
        let got = items(
            "Kenntnisse in Analysewerkzeugen (u. a. Python, R, VBA, Power BI) und praktische Erfahrung mit KI",
        );
        assert_eq!(got.len(), 2);
        assert!(got[0].1.contains(&"Power BI".to_owned()), "{got:?}");
    }

    /// A lone adjective shares the next part's noun and is no item of its own.
    #[test]
    fn lone_adjectives_are_no_items() {
        let texts =
            |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
        assert_eq!(
            texts("Classic and agile project management"),
            ["agile project management"]
        );
        assert_eq!(texts("Klassische und agile Methoden"), ["agile Methoden"]);
        assert_eq!(
            texts("Controlling und Reporting"),
            ["Controlling", "Reporting"]
        );
        assert_eq!(texts("Excel und Power BI"), ["Excel", "Power BI"]);
    }

    /// A declined adjective that ends a part shares the noun of the next one, a head after
    /// `und -` the word before it, two activities the object of the second: one requirement
    /// each.
    #[test]
    fn shared_nouns_and_heads_keep_one_item() {
        let texts =
            |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
        for one in [
            "Kenntnisse in klassischen und agilen Projektmanagement-Methoden",
            "Sehr gute organisatorische und kommunikative Fähigkeiten",
            "Durchführung qualitativer und quantitativer Nutzerforschung",
            "Methodenkompetenz in Projektplanung und -controlling",
            "Kenntnisse in der Erstellung und Anwendung von Personas",
            "Sicherer Umgang mit der Analyse und Interpretation von Kundendaten",
        ] {
            assert_eq!(texts(one), [one], "{one}");
        }
        assert_eq!(
            texts("Erfahrung im Controlling und Reporting"),
            ["Erfahrung im Controlling", "Reporting"]
        );
        assert_eq!(
            texts("Erfahrung im Controlling und Konzernrechnungslegung nach IFRS"),
            [
                "Erfahrung im Controlling",
                "Konzernrechnungslegung nach IFRS"
            ]
        );
    }

    #[test]
    fn overlapping_separators_and_a_marker_after_brackets() {
        // ", " and " oder " overlap: one cut, no inverted range.
        let got =
            items("Studium der Wirtschaftswissenschaften, oder eine vergleichbare Qualifikation");
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(
            got[0].1,
            [
                "Studium der Wirtschaftswissenschaften",
                "eine vergleichbare Qualifikation"
            ]
        );
        // The bracket closes before "z. B.": the examples follow the marker.
        let got = items("Erfahrung mit einem ERP-System (SAP) z. B. S/4HANA");
        assert_eq!(got.len(), 1, "{got:?}");
        assert_eq!(
            got[0].1,
            ["Erfahrung mit einem ERP-System (SAP)", "S/4HANA"],
            "{got:?}"
        );
        // Folding that keeps the length but moves the offsets ("İ" grows, "ẞ" shrinks).
        let got = items("İẞ Kenntnisse z. B. SAP");
        assert!(!got.is_empty(), "{got:?}");
    }

    /// Messy ads (set 9): a heading in two languages, a keyword line of several skills that
    /// ends with a language, frame lines about workload and extension.
    #[test]
    fn messy_ads_keep_their_structure() {
        assert_eq!(heading("Aufgaben / Tasks:"), Some(HeadingKind::Task));
        assert_eq!(heading("Profil / Profile"), Some(HeadingKind::Must));
        assert_eq!(heading("Controlling / Reporting"), None);
        let core = Vocab::core();
        assert_eq!(
            classify(
                "ISTQB Advanced Test Manager, min. 7 Jahre Testmanagement, SAP Testing, \
                 Playwright hands on, Deutsch fliessend",
                None,
                &core
            ),
            Class::Skill
        );
        assert!(matches!(
            classify("Verhandlungssicheres Deutsch", None, &core),
            Class::Language(..)
        ));
        for frame in [
            "Einsatz in Vollzeit, davon drei Tage pro Woche vor Ort",
            "Eine Verlängerung ist möglich",
            "Beauftragung über uns",
        ] {
            assert_eq!(classify(frame, None, &core), Class::Frame, "{frame}");
        }
    }

    #[test]
    fn kinds_years_levels() {
        assert_eq!(
            classify("Ausgeprägte Kommunikationsstärke", None, &Vocab::core()),
            Class::Soft
        );
        assert_eq!(
            classify("Reisebereitschaft", None, &Vocab::core()),
            Class::Frame
        );
        assert_eq!(
            classify("Englischkenntnisse auf Niveau C1", None, &Vocab::core()),
            Class::Language("englisch".into(), Some(5))
        );
        assert_eq!(
            classify(
                "Abgeschlossenes Studium der Wirtschaftswissenschaften",
                None,
                &Vocab::core()
            ),
            Class::Degree
        );
        assert_eq!(
            classify(
                "Abgeschlossene technische Ausbildung oder Ingenieurstudium",
                None,
                &Vocab::core()
            ),
            Class::Degree
        );
        assert_eq!(
            classify(
                "Zulassung als Steuerberater:in zwingend erforderlich",
                None,
                &Vocab::core()
            ),
            Class::Licence("steuerberater")
        );
        assert_eq!(
            classify(
                "Enge Zusammenarbeit mit Steuerberatern",
                None,
                &Vocab::core()
            ),
            Class::Skill
        );
        assert_eq!(
            years_in("Mindestens 15 Jahre Erfahrung in der Konsolidierung"),
            Some((15, None))
        );
        assert_eq!(
            years_in("Mindestens zehn Jahre Berufserfahrung"),
            Some((10, None))
        );
        assert_eq!(years_in("At least 8 years of experience"), Some((8, None)));
        assert_eq!(years_in("10+ years in FP&A"), Some((10, None)));
        // A range: at least its lower end, up to its upper end.
        assert_eq!(
            years_in("3-5 Jahre Berufserfahrung im Controlling"),
            Some((3, Some(5)))
        );
        assert_eq!(years_in("3 bis 5 Jahre Erfahrung"), Some((3, Some(5))));
        assert_eq!(
            years_in("between 3 and 5 years of experience"),
            Some((3, Some(5)))
        );
        assert_eq!(years_in("2 Sprachen und 5 Jahre SAP"), Some((5, None)));
        assert_eq!(heading_kind("Ihre Qualifikation"), Some(HeadingKind::Must));
        assert_eq!(
            heading_kind("Rahmenbedingungen"),
            Some(HeadingKind::Neutral)
        );
    }

    /// A portal's tag list under a bare `Skills` heading, the provider's other projects and a
    /// rate line are no requirements of the ad.
    #[test]
    fn portal_tags_other_projects_and_rates() {
        let doc = read(
            "Ihr Profil\n- SAP FI\n- Bis zu 1.200 € pro Tag\n\nSkills\nPower BI\nTableau\n\n\
             Ähnliche Projekte\nSAP CO Berater (m/w/d)\n",
            &Vocab::all(),
        );
        let items: Vec<(&str, &Class)> = doc
            .items
            .iter()
            .map(|i| (i.text.as_str(), &i.class))
            .collect();
        assert_eq!(
            items,
            [
                ("SAP FI", &Class::Skill),
                ("Bis zu 1.200 € pro Tag", &Class::Frame)
            ]
        );
        assert_eq!(heading_kind("Projektanbieter"), Some(HeadingKind::Neutral));
    }

    /// An offer, the start or the steps after the application end the requirements.
    #[test]
    fn offers_and_next_steps_are_no_requirements() {
        let doc = read(
            "Dein Profil\n- SAP FI\n\nWas wir dir bieten\n- 30 Tage Urlaub\n\nSo geht es weiter\n\
             Nach deiner Bewerbung meldet sich unser Team.\n",
            &Vocab::all(),
        );
        let texts: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(texts, ["SAP FI"]);
        for heading in [
            "Was wir Ihnen bieten",
            "Dein Start",
            "Ihr Start",
            "So geht's weiter",
        ] {
            assert_eq!(
                heading_kind(heading),
                Some(HeadingKind::Neutral),
                "{heading}"
            );
        }
    }

    /// Parts joined by `und` share the object the last one names: no bare `Erfahrung im
    /// Aufbau` is left.
    #[test]
    fn split_parts_keep_their_shared_object() {
        let doc = read(
            "Ihr Profil\n- Erfolgreiche Erfahrung im Aufbau und in der Führung von Vertriebsteams\n",
            &Vocab::all(),
        );
        let texts: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(
            texts,
            [
                "Erfolgreiche Erfahrung im Aufbau von Vertriebsteams",
                "in der Führung von Vertriebsteams"
            ]
        );
    }
}
