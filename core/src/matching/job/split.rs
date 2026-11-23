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
        let after_hyphen =
            || i > 0 && bytes[i - 1] == b'-' && leading_ellipsis(&text[..i], &text[i..]).is_none();
        if depth == 0
            && let Some(word) = words.iter().find(|w| {
                w.as_bytes()[0].eq_ignore_ascii_case(&bytes[i])
                    && bytes
                        .get(i..i + w.len())
                        .is_some_and(|b| b.eq_ignore_ascii_case(w.as_bytes()))
            })
            && !after_hyphen()
        {
            found.push(i..i + word.len());
            i += word.len();
            continue;
        }
        i += 1;
    }
    found
}

/// Slashes between two words that are alternatives (`Power BI/Tableau`, `Einkauf/Logistik`):
/// a word of three letters or more on one side; no code (`FI/CO`, `S/4HANA`), gender form
/// (`Berater/in`, `m/w/d`) or number (`02/2027`).
pub(super) fn slashes(text: &str) -> Vec<Range<usize>> {
    let word_at = |chars: &mut dyn Iterator<Item = char>| -> String {
        chars.take_while(|c| c.is_alphanumeric()).collect()
    };
    let plain = |w: &str| w.chars().count() >= 2 && !w.starts_with(|c: char| c.is_ascii_digit());
    let word = |w: &str| w.chars().count() >= 3 && w.chars().any(char::is_lowercase);
    text.match_indices('/')
        .filter(|&(at, _)| {
            let before: String = word_at(&mut text[..at].chars().rev())
                .chars()
                .rev()
                .collect();
            let after = word_at(&mut text[at + 1..].chars());
            plain(&before)
                && plain(&after)
                && (word(&before) || word(&after))
                && !lex::GENDER_LETTERS.contains(&after.as_str())
                && !matches!(after.as_str(), "in" | "innen")
                && depth(&text[..at]) == 0
        })
        .map(|(at, _)| at..at + 1)
        .collect()
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

/// First example marker in a text, a whole word (`etwas` holds no `etwa`): (start, end) byte
/// offsets.
pub(super) fn example_marker(text: &str) -> Option<(usize, usize)> {
    let lower = text.to_lowercase();
    if lower.len() != text.len() {
        return None;
    }
    EXAMPLES
        .iter()
        .filter_map(|m| find_word(&lower, m).map(|at| (at, at + m.len())))
        // Same total length does not mean same offsets ("İẞ" folds to "i̇ß").
        .filter(|&(at, end)| text.is_char_boundary(at) && text.is_char_boundary(end))
        .min()
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
    for part in parts.iter().cloned() {
        let text = &phrase[part.clone()];
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
        let mut or_seps: Vec<Range<usize>> = separators(&phrase[head.clone()], OR)
            .into_iter()
            .chain(separators(&phrase[head.clone()], AND_OR))
            .chain(slashes(&phrase[head.clone()]))
            .map(|r| head.start + r.start..head.start + r.end)
            .collect();
        or_seps.sort_by_key(|r| r.start);
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
