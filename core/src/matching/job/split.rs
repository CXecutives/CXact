//! Cutting a requirement phrase into items, AND parts, OR alternatives and examples.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// Byte ranges of (ASCII, case-insensitive) separators at parenthesis depth 0.
pub(super) fn separators(text: &str, words: &[&str]) -> Vec<Range<usize>> {
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
        // `Risiko- und Qualitätsmanagement` parts like the written-out form when the head of
        // the word after it is known; any other word ending in a hyphen keeps its part.
        let after_hyphen = i > 0
            && bytes[i - 1] == b'-'
            && atoms::complete_ellipsis(&text[..i], &text[i..]).is_none();
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

pub(super) fn cut(text: &str, seps: &[Range<usize>]) -> Vec<Range<usize>> {
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

pub(super) fn trim_range(text: &str, range: Range<usize>) -> Range<usize> {
    let part = &text[range.clone()];
    let trimmed =
        part.trim_matches(|c: char| c.is_whitespace() || c == '.' || c == ',' || c == ';');
    let start = range.start + (trimmed.as_ptr() as usize - part.as_ptr() as usize);
    start..start + trimmed.len()
}

/// First example marker in a text: (start, end) byte offsets.
pub(super) fn example_marker(text: &str) -> Option<(usize, usize)> {
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
pub(super) fn joined(phrase: &str, seps: &[Range<usize>]) -> Vec<Range<usize>> {
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

pub(super) fn cut_abs(
    phrase: &str,
    within: &Range<usize>,
    seps: &[Range<usize>],
) -> Vec<Range<usize>> {
    let local: Vec<Range<usize>> = seps
        .iter()
        .map(|r| r.start - within.start..r.end - within.start)
        .collect();
    cut(&phrase[within.clone()], &local)
        .into_iter()
        .map(|r| within.start + r.start..within.start + r.end)
        .collect()
}

pub(super) fn example_list(phrase: &str, list: Range<usize>) -> Vec<Range<usize>> {
    let list = trim_range(phrase, list);
    let seps: Vec<Range<usize>> = separators(&phrase[list.clone()], EXAMPLE_SEPARATORS)
        .into_iter()
        .map(|r| list.start + r.start..list.start + r.end)
        .collect();
    cut_abs(phrase, &list, &seps)
}
