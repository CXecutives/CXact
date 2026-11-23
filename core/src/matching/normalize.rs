//! Text primitives with Python semantics: case folding, whitespace, line splitting and
//! the canonical token stream.
//!
//! The exact character sets of Python's `str` methods and `re` classes come from the frozen
//! `python_unicode.txt`, so no behaviour depends on the Unicode version of the Rust
//! toolchain.

use std::borrow::Cow;
use std::sync::LazyLock;

use super::lexicon;

struct Tables {
    /// Non-ASCII ranges of Python's `\w`.
    word: Vec<(u32, u32)>,
    /// Ranges of Python's `\d`; each run counts 0-9 from its start.
    digit: Vec<(u32, u32)>,
    /// `str.casefold()` for every code point it changes, sorted.
    fold: Vec<(u32, Box<str>)>,
}

static TABLES: LazyLock<Tables> =
    LazyLock::new(|| parse_tables(include_str!("python_unicode.txt")));

fn parse_tables(data: &str) -> Tables {
    let hex = |s: &str| u32::from_str_radix(s, 16).expect("hex code point in python_unicode.txt");
    let mut tables = Tables {
        word: Vec::new(),
        digit: Vec::new(),
        fold: Vec::new(),
    };
    for line in data
        .lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
    {
        let mut parts = line.split(' ');
        let kind = parts.next().unwrap_or_default();
        let first = hex(parts.next().unwrap_or_default());
        match kind {
            "w" => tables
                .word
                .push((first, hex(parts.next().unwrap_or_default()))),
            "d" => tables
                .digit
                .push((first, hex(parts.next().unwrap_or_default()))),
            "f" => {
                let folded: String = parts.filter_map(|p| char::from_u32(hex(p))).collect();
                tables.fold.push((first, folded.into_boxed_str()));
            }
            _ => {}
        }
    }
    tables
}

fn in_ranges(ranges: &[(u32, u32)], c: char) -> Option<(u32, u32)> {
    let cp = u32::from(c);
    let i = ranges.partition_point(|&(_, end)| end < cp);
    ranges.get(i).copied().filter(|&(start, _)| start <= cp)
}

/// Python `str.isspace()` (and `re` `\s`).
pub(crate) fn is_space(c: char) -> bool {
    matches!(
        c,
        '\t'..='\r'
            | '\x1c'..='\x1f'
            | ' '
            | '\u{85}'
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
    )
}

/// Python `re` `\w` (`str.isalnum()` or `_`).
pub(crate) fn is_word(c: char) -> bool {
    if c.is_ascii() {
        c.is_ascii_alphanumeric() || c == '_'
    } else {
        in_ranges(&TABLES.word, c).is_some()
    }
}

/// Value of a Python decimal digit (`re` `\d`), any script.
pub(crate) fn decimal(c: char) -> Option<u32> {
    if c.is_ascii() {
        return c.to_digit(10);
    }
    in_ranges(&TABLES.digit, c).map(|(start, _)| (u32::from(c) - start) % 10)
}

/// Body of a regex character class matching exactly Python's `\d`.
pub(crate) fn digit_class_body() -> String {
    use std::fmt::Write as _;
    TABLES.digit.iter().fold(String::new(), |mut out, &(a, b)| {
        let _ = write!(out, "\\x{{{a:X}}}-\\x{{{b:X}}}");
        out
    })
}

/// Python `str.casefold()`.
pub(crate) fn casefold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        push_folded(&mut out, c);
    }
    out
}

fn push_folded(out: &mut String, c: char) {
    if c.is_ascii() {
        out.push(c.to_ascii_lowercase());
        return;
    }
    let cp = u32::from(c);
    match TABLES.fold.binary_search_by_key(&cp, |(k, _)| *k) {
        Ok(i) => out.push_str(&TABLES.fold[i].1),
        Err(_) => out.push(c),
    }
}

/// Python `str.strip()`.
pub(crate) fn strip(text: &str) -> &str {
    text.trim_matches(is_space)
}

/// Python `str.split()` without arguments.
pub(crate) fn split_whitespace(text: &str) -> impl Iterator<Item = &str> {
    text.split(is_space).filter(|part| !part.is_empty())
}

/// Python `str.splitlines()`: every Unicode line boundary, `\r\n` counts once, no
/// trailing empty line.
pub(crate) fn splitlines(text: &str) -> Vec<&str> {
    let mut lines = Vec::new();
    let mut start = 0;
    let mut chars = text.char_indices().peekable();
    while let Some((at, c)) = chars.next() {
        let is_break = matches!(
            c,
            '\n' | '\r'
                | '\x0b'
                | '\x0c'
                | '\x1c'
                | '\x1d'
                | '\x1e'
                | '\u{85}'
                | '\u{2028}'
                | '\u{2029}'
        );
        if !is_break {
            continue;
        }
        lines.push(&text[start..at]);
        let mut end = at + c.len_utf8();
        if c == '\r' && chars.peek().is_some_and(|&(_, next)| next == '\n') {
            chars.next();
            end += 1;
        }
        start = end;
    }
    if start < text.len() {
        lines.push(&text[start..]);
    }
    lines
}

/// The text with every page placeholder (a hidden address,
/// `lexicon::engine::PAGE_PLACEHOLDERS`) blanked out by spaces of the same byte length, so
/// every byte offset into it is one into the original text.
pub(crate) fn mask_placeholders(text: &str) -> Cow<'_, str> {
    let mut masked = Cow::Borrowed(text);
    for placeholder in lexicon::engine::PAGE_PLACEHOLDERS {
        if masked.contains(placeholder) {
            let blank = " ".repeat(placeholder.len());
            masked = Cow::Owned(masked.replace(placeholder, &blank));
        }
    }
    masked
}

/// Length in code points, like Python's `len(str)`.
pub(crate) fn char_len(text: &str) -> usize {
    text.chars().count()
}

fn is_token_start(c: char) -> bool {
    c.is_ascii_lowercase() || c.is_ascii_digit() || matches!(c, 'ä' | 'ö' | 'ü' | 'ß' | '+' | '#')
}

fn is_token_char(c: char) -> bool {
    is_token_start(c) || matches!(c, '.' | '/' | '-')
}

/// Tokens of an already case-folded text: `[a-z0-9äöüß+#][a-z0-9äöüß+#./\-]*`, trailing
/// dots removed.
fn raw_token_iter(folded: &str) -> impl Iterator<Item = &str> {
    let mut rest = folded;
    std::iter::from_fn(move || {
        let start = rest.find(is_token_start)?;
        let tail = &rest[start..];
        let end = tail.find(|c| !is_token_char(c)).unwrap_or(tail.len());
        rest = &tail[end..];
        Some(tail[..end].trim_end_matches('.'))
    })
}

/// Python `_raw_canonical`: tokens without the length filter, canonicalised.
pub(crate) fn raw_canonical(text: &str) -> Vec<String> {
    let folded = casefold(text);
    let tokens = raw_token_iter(&folded)
        .filter(|t| !lexicon::contains(lexicon::STOPWORDS, t))
        .map(str::to_owned)
        .collect();
    canonical_stream(tokens)
}

/// Python `canonical_stream`: word synonyms first, then adjacent pairs, left to right.
pub(crate) fn canonical_stream(tokens: Vec<String>) -> Vec<String> {
    let words: Vec<String> = tokens
        .into_iter()
        .filter_map(|t| match lexicon::synonym(&t) {
            Some(Some(mapped)) => Some(mapped.to_owned()),
            Some(None) => None,
            None => Some(t),
        })
        .collect();
    let mut result = Vec::with_capacity(words.len());
    let mut i = 0;
    while i < words.len() {
        if let Some(next) = words.get(i + 1)
            && let Some(merged) = lexicon::synonym_pair(&words[i], next)
        {
            result.push(merged.to_owned());
            i += 2;
            continue;
        }
        result.push(words[i].clone());
        i += 1;
    }
    result
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
            && (word.chars().count() <= 2
                || lexicon::engine::ABBREVIATIONS.contains(&word.to_lowercase().as_str()))
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

/// Whole-word (or whole-phrase) containment in a folded text.
pub(crate) fn contains_word(folded: &str, word: &str) -> bool {
    contains_word_with(folded, word, &[""])
}

/// Is `word` in a text where a word starts, its end followed by one of `endings` and the end
/// of a word (`""`: right at the end; `tarifliche` for `tariflich` with `e`)?
pub(crate) fn contains_word_with(text: &str, word: &str, endings: &[&str]) -> bool {
    text.match_indices(word).any(|(at, _)| {
        let rest = &text[at + word.len()..];
        let tail = &rest[..rest
            .find(|c: char| !c.is_alphanumeric())
            .unwrap_or(rest.len())];
        starts_word(text, at) && endings.contains(&tail)
    })
}

/// The first whole-word (or whole-phrase) occurrence of `word` in a text: no letter or digit
/// right before or after it.
pub(crate) fn find_word(text: &str, word: &str) -> Option<usize> {
    text.match_indices(word)
        .map(|(at, _)| at)
        .find(|&at| word_bounded(text, at, at + word.len()))
}

/// Is `text[start..end]` bounded as a word (no letter or digit right before or after it)?
pub(crate) fn word_bounded(text: &str, start: usize, end: usize) -> bool {
    starts_word(text, start) && ends_word(text, end)
}

/// Does no letter or digit stand right before byte `at`?
pub(crate) fn starts_word(text: &str, at: usize) -> bool {
    text[..at]
        .chars()
        .next_back()
        .is_none_or(|c| !c.is_alphanumeric())
}

/// Does no letter or digit stand at byte `at`?
pub(crate) fn ends_word(text: &str, at: usize) -> bool {
    text[at..]
        .chars()
        .next()
        .is_none_or(|c| !c.is_alphanumeric())
}

/// The words of a text with their byte offsets: runs of letters and digits, with `inner` signs
/// inside a word (`Müller-Lüdenscheidt`).
pub(crate) fn word_spans<'a>(text: &'a str, inner: &[char]) -> Vec<(usize, &'a str)> {
    let mut out = Vec::new();
    let mut start = None;
    for (at, c) in text.char_indices() {
        let inside = c.is_alphanumeric() || (start.is_some() && inner.contains(&c));
        match (inside, start) {
            (true, None) => start = Some(at),
            (false, Some(from)) => {
                out.push((from, &text[from..at]));
                start = None;
            }
            _ => {}
        }
    }
    if let Some(from) = start {
        out.push((from, &text[from..]));
    }
    out
}

/// Whether the words from `at` are `phrase` (words separated by single spaces), its last word
/// perhaps with one of `endings`; the index after it.
pub(crate) fn phrase_at<S: AsRef<str>>(
    words: &[S],
    at: usize,
    phrase: &str,
    endings: &[&str],
) -> Option<usize> {
    let parts: Vec<&str> = phrase.split(' ').collect();
    for (i, part) in parts.iter().enumerate() {
        let word = words.get(at + i)?.as_ref();
        let ending = || {
            i + 1 == parts.len()
                && word
                    .strip_prefix(part)
                    .is_some_and(|rest| endings.contains(&rest))
        };
        if word != *part && !ending() {
            return None;
        }
    }
    Some(at + parts.len())
}

/// A date written as one word: a day (`31.03.2027`, `2027-03-31`) or a month (`03/2027`), as
/// (year, month, the day if it names one). A year has four digits.
pub(crate) fn numeric_date(word: &str) -> Option<(i16, i8, Option<i8>)> {
    let year = |s: &str| s.parse::<i16>().ok().filter(|_| s.len() == 4);
    let small = |s: &str| s.parse::<i8>().ok().filter(|_| s.len() <= 2);
    match word.split(['.', '/', '-']).collect::<Vec<_>>().as_slice() {
        [y, m, d] if word.contains('-') && y.len() == 4 => {
            Some((year(y)?, small(m)?, Some(small(d)?)))
        }
        [d, m, y] => Some((year(y)?, small(m)?, Some(small(d)?))),
        [m, y] => Some((year(y)?, small(m)?, None)),
        _ => None,
    }
}

/// The month a folded word names (`marz`, `march`, `mar`: `lex::MONTHS`).
pub(crate) fn month_named(word: &str) -> Option<i8> {
    lexicon::engine::MONTHS
        .iter()
        .find(|(name, _)| *name == word)
        .map(|&(_, month)| month)
}

/// The quarter a folded word names (`q2`).
pub(crate) fn quarter(word: &str) -> Option<i8> {
    word.strip_prefix('q')
        .and_then(|q| q.parse::<i8>().ok())
        .filter(|q| (1..=4).contains(q))
}

/// The number a word names (`zwei`, `five`, `NUMBER_WORDS`).
pub(crate) fn number_word(word: &str) -> Option<u32> {
    lexicon::engine::NUMBER_WORDS
        .iter()
        .find(|(w, _)| *w == word)
        .map(|&(_, n)| n)
}

/// The text after an amount (`start..end` of `text`) and the text before it, each past a range
/// (`950 - 1.100`, `bis 1.200`, `1,100 to 1,250`): where its unit or the word for it stands.
pub(crate) fn amount_sides(text: &str, start: usize, end: usize) -> (&str, &str) {
    let ranges = lexicon::engine::RATE_RANGE_WORDS;
    let number =
        |c: char| c.is_whitespace() || c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | '–');
    let after = text[end..].trim_start_matches(number);
    let after = ranges
        .iter()
        .find_map(|w| after.strip_prefix(w))
        .map_or(after, |rest| rest.trim_start_matches(number));
    let sign = |c: char| number(c) || matches!(c, ':' | '(' | '~');
    let before = text[..start].trim_end_matches(sign);
    let before = ranges
        .iter()
        .find_map(|w| before.strip_suffix(w))
        .map_or(before, |rest| rest.trim_end_matches(sign));
    (after, before)
}

/// The amount written from byte `start` of a digit run, thousands separators included
/// (`1.200`, `95,000`): its value (saturating) and the byte after it.
pub(crate) fn amount_at(bytes: &[u8], start: usize) -> (u64, usize) {
    let mut value: u64 = 0;
    let mut i = start;
    while i < bytes.len() {
        let c = bytes[i];
        if c.is_ascii_digit() {
            value = value.saturating_mul(10).saturating_add(u64::from(c - b'0'));
            i += 1;
        } else if (c == b'.' || c == b',')
            && bytes
                .get(i + 1..i + 4)
                .is_some_and(|d| d.iter().all(u8::is_ascii_digit))
            && bytes.get(i + 4).is_none_or(|d| !d.is_ascii_digit())
        {
            i += 1;
        } else {
            break;
        }
    }
    (value, i)
}

/// Clauses of a sentence, cut at `breaks`, never at a decimal comma (`38,5 Stunden`); a cut
/// sign belongs to no clause.
pub(crate) fn clauses<'a>(text: &'a str, breaks: &'a [char]) -> impl Iterator<Item = &'a str> {
    let bytes = text.as_bytes();
    let digit = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_digit);
    let mut start = 0;
    let mut cuts = Vec::new();
    for (at, c) in text.char_indices() {
        let decimal = c == ',' && at > 0 && digit(at - 1) && digit(at + 1);
        if breaks.contains(&c) && !decimal {
            cuts.push(&text[start..at]);
            start = at + c.len_utf8();
        }
    }
    cuts.push(&text[start..]);
    cuts.into_iter()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn placeholders_are_blanked_in_place() {
        let text = "SOLCOM GmbH\n[email protected]\n[email\u{a0}protected]\nSAP";
        let masked = mask_placeholders(text);
        assert_eq!(masked.len(), text.len());
        assert!(!masked.contains("protected"));
        assert!(masked.ends_with("\nSAP"));
        assert!(matches!(mask_placeholders("SAP FI"), Cow::Borrowed(_)));
    }

    #[test]
    fn casefold_follows_python() {
        assert_eq!(casefold("GROẞKONZERN Straße"), "grosskonzern strasse");
        assert_eq!(
            casefold("Zertiﬁzierung İ ſ K"),
            "zertifizierung i\u{307} s k"
        );
        assert_eq!(casefold("ΣΑΣ"), "σασ");
    }

    #[test]
    fn python_character_classes() {
        assert!(is_space('\x1f') && is_space('\u{a0}') && !is_space('\u{200b}'));
        assert!(is_word('²') && is_word('ª') && !is_word('\u{200d}') && !is_word('\u{301}'));
        assert_eq!(decimal('\u{663}'), Some(3));
        assert_eq!(decimal('\u{1d7d8}'), Some(0));
        assert_eq!(decimal('²'), None);
    }

    #[test]
    fn splitlines_like_python() {
        assert_eq!(
            splitlines("a\r\nb\rc\u{2028}d\x0ce\n"),
            ["a", "b", "c", "d", "e"]
        );
        assert_eq!(splitlines("a\n\nb"), ["a", "", "b"]);
        assert_eq!(splitlines("\n"), [""]);
        assert!(splitlines("").is_empty());
        assert_eq!(splitlines("a\x1fb"), ["a\x1fb"]);
    }

    #[test]
    fn tokens_and_synonyms() {
        assert_eq!(
            raw_canonical("SAP S4 HANA, KI und Power BI."),
            ["sap", "s/4hana", "ki", "power", "bi"]
        );
        assert_eq!(raw_canonical("Project Management"), ["projektmanagement"]);
    }

    #[test]
    fn dates_written_as_one_word() {
        assert_eq!(numeric_date("31.03.2027"), Some((2027, 3, Some(31))));
        assert_eq!(numeric_date("2027-03-31"), Some((2027, 3, Some(31))));
        assert_eq!(numeric_date("03/2027"), Some((2027, 3, None)));
        assert_eq!(numeric_date("0170.1234.5678"), None);
        assert_eq!(numeric_date("3-6"), None);
        assert_eq!(month_named("marz"), Some(3));
        assert_eq!(quarter("q2"), Some(2));
        assert_eq!(quarter("q5"), None);
    }
}
