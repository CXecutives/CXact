//! The term of a requirement and the profile field it belongs to: "Kenntnisse in Anaplan" is
//! the tool "Anaplan", "Branchenerfahrung Energie" the industry "Energie", "Erfahrung mit SAP
//! Analytics Cloud" the tool "SAP Analytics Cloud". "Häufig verlangt" in the Profil counts
//! the ads' terms by it (`view::asked_terms`) and the reader's "+" adds a term to its field
//! (`pipeline::local::open_term`). The words live in `lexicon::terms`.
//!
//! How: the words that only say that or how much something is wanted go from the front
//! (`Kenntnisse in`, `fundierte`, `experience with`, a number of years) and from the end
//! (`von Vorteil`, `setzen wir voraus`, `is a plus`, `-Kenntnisse`), so does a note in
//! brackets (`(m/w/d)`, `(z. B. ...)`, `(C1)`); of alternatives the first stays. What is
//! left is a language (the engine's language names), a certificate (a word of one or a known
//! name), a degree (a degree word first or last), an industry (a lead like
//! `Branchenerfahrung`, the engine's industry words, an ending like `-branche`), a tool or
//! method (a known name or the first word of a family like `SAP`), else a competence.

use std::cmp::Reverse;
use std::sync::LazyLock;

use serde::Serialize;

use super::atoms::fold;
use super::lexicon::{self, engine as lex, terms as words, wishes};

/// A term has at most this many words; more words are a sentence.
pub const TERM_WORDS: usize = 5;

/// Most characters of a term (a longer one is no term the profile could take).
pub const TERM_CHARS: usize = 80;

/// A requirement of more words than this (before the words at its end that only say how
/// much it is wanted) gives no term, whatever words go.
const PHRASE_WORDS: usize = 2 * TERM_WORDS;

/// Most characters of a requirement that gives a term.
const PHRASE_CHARS: usize = 120;

/// A term the profile could take as it stands: at most [`TERM_WORDS`] words that end like no
/// sentence.
pub fn is_term(label: &str) -> bool {
    let words = label.trim();
    !words.is_empty()
        && words.split_whitespace().count() <= TERM_WORDS
        && words.chars().count() <= TERM_CHARS
        && !words.ends_with(['.', '!', '?', ':', ';'])
}

/// The field of the profile a term goes into.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum TermField {
    /// `kernkompetenzen`.
    Competence,
    /// `methoden_tools`.
    Tool,
    /// `branchen`.
    Industry,
    /// `sprachen`.
    Language,
    /// `zertifizierungen`.
    Certificate,
    /// `abschluss`.
    Degree,
}

impl TermField {
    /// The field's name on the wire (`competence`, `tool`, ...).
    pub fn name(self) -> &'static str {
        match self {
            TermField::Competence => "competence",
            TermField::Tool => "tool",
            TermField::Industry => "industry",
            TermField::Language => "language",
            TermField::Certificate => "certificate",
            TermField::Degree => "degree",
        }
    }
}

/// The term of a requirement: its words (the ad's, without what only says that or how much
/// it is wanted), its field and the key two terms of the same thing share.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoreTerm {
    pub term: String,
    pub field: TermField,
    key: String,
}

impl CoreTerm {
    /// What two terms of the same thing share: their words without case and punctuation
    /// ([`term_key`]); a language by the engine's language (`English` and `Englisch` are
    /// one), an industry by the engine's industry (`Energie` and `energy sector`).
    pub fn key(&self) -> &str {
        &self.key
    }
}

/// A term for comparing: lower case, its words without punctuation between them
/// ("Power-BI" and "power bi" are one; `+` and `#` belong to a word, "C++" is no "C#").
pub fn term_key(term: &str) -> String {
    term.to_lowercase()
        .split(|c: char| !c.is_alphanumeric() && c != '+' && c != '#')
        .filter(|w| !w.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The term of a requirement and its field; `None` for a sentence (a term of more than
/// [`TERM_WORDS`] words, a requirement of more than [`PHRASE_WORDS`], a full stop at its end)
/// and for words that name nothing the profile could take (`Erfahrung`,
/// `Hochschulabschluss`).
pub fn core_term(phrase: &str) -> Option<CoreTerm> {
    let phrase = phrase.trim();
    if phrase.is_empty()
        || phrase.chars().count() > PHRASE_CHARS
        || phrase.ends_with(['.', '!', '?', ':', ';', '…'])
    {
        return None;
    }
    let text = without_notes(phrase);
    let all = words_of(&text);
    let language = all.iter().any(|w| language_of(&w.key).is_some());
    let mut marks = Marks::default();
    let mut end = all.len() - tails(&all, language, &mut marks);
    // Of alternatives the first stays (`Kenntnisse in LucaNet oder IBM Cognos`).
    if let Some(at) = all[..end]
        .iter()
        .skip(1)
        .position(|w| OR_WORDS.contains(&w.key.as_str()))
    {
        end = 1 + at;
        end -= tails(&all[..end], language, &mut marks);
    }
    if end > PHRASE_WORDS {
        return None;
    }
    let start = leads(&all[..end], language, &mut marks);
    let mut rest: Vec<Word<'_>> = all.get(start..end)?.to_vec();
    let last = rest.pop()?;
    let last = without_ending(last, &mut marks);
    rest.push(last);
    classify(&rest, &marks, phrase)
}

/// The words of the table that say the term's field.
#[derive(Debug, Default)]
struct Marks {
    industry: bool,
    certificate: bool,
}

/// One word of the requirement: the ad's word without the punctuation around it, and folded
/// for comparing.
#[derive(Debug, Clone)]
struct Word<'a> {
    raw: &'a str,
    key: String,
}

/// Alternatives inside a term.
const OR_WORDS: &[&str] = &["beziehungsweise", "bzw", "oder", "or", "/"];

/// Punctuation around a word of the ad.
const RAW_PUNCTUATION: &[char] = &[
    ',', ';', ':', '!', '?', '"', '\'', '„', '“', '”', '‚', '‘', '’', '«', '»', '*', '•',
];

/// Punctuation around a word when comparing.
const KEY_PUNCTUATION: &[char] = &[
    ',', ';', ':', '!', '?', '"', '\'', '„', '“', '”', '‚', '‘', '’', '«', '»', '*', '•', '.', '(',
    ')', '[', ']',
];

/// Words that are dashes between words.
const DASHES: &[&str] = &["-", "–", "—", "|"];

/// Phrases of one table as words, the longest first.
struct Phrases(Vec<Vec<&'static str>>);

impl Phrases {
    fn new(tables: &[&[&'static str]]) -> Phrases {
        let mut all: Vec<Vec<&'static str>> = tables
            .iter()
            .flat_map(|table| table.iter())
            .map(|phrase| phrase.split(' ').collect())
            .collect();
        all.sort_by_key(|words: &Vec<&str>| Reverse(words.len()));
        Phrases(all)
    }

    /// The number of words of the longest phrase that `words` start with.
    fn at_start(&self, words: &[Word<'_>]) -> Option<usize> {
        self.0
            .iter()
            .find(|p| p.len() <= words.len() && p.iter().zip(words).all(|(a, w)| *a == w.key))
            .map(Vec::len)
    }

    /// The number of words of the longest phrase that `words` end with.
    fn at_end(&self, words: &[Word<'_>]) -> Option<usize> {
        self.0
            .iter()
            .find(|p| {
                p.len() <= words.len()
                    && p.iter()
                        .zip(&words[words.len() - p.len()..])
                        .all(|(a, w)| *a == w.key)
            })
            .map(Vec::len)
    }
}

static LEADS: LazyLock<Phrases> =
    LazyLock::new(|| Phrases::new(&[words::LEADS, lex::NICE_CUES, lex::MANDATORY_WORDS]));
static TAILS: LazyLock<Phrases> = LazyLock::new(|| {
    Phrases::new(&[
        words::TAILS,
        lex::NICE_CUES,
        lex::NICE_CLOSING,
        lex::MANDATORY_WORDS,
    ])
});
static LEVELS: LazyLock<Phrases> = LazyLock::new(|| {
    let levels: &'static [&'static str] = Box::leak(
        lex::LEVEL_WORDS
            .iter()
            .map(|(word, _)| *word)
            .collect::<Vec<_>>()
            .into_boxed_slice(),
    );
    Phrases::new(&[levels, words::LANGUAGE_WORDS])
});
static INDUSTRY_NOUNS: LazyLock<Phrases> = LazyLock::new(|| Phrases::new(&[words::INDUSTRY_NOUNS]));
static CERTIFICATE_LEADS: LazyLock<Phrases> =
    LazyLock::new(|| Phrases::new(&[words::CERTIFICATE_LEADS]));
static CERTIFICATE_TAILS: LazyLock<Phrases> =
    LazyLock::new(|| Phrases::new(&[words::CERTIFICATE_TAILS]));
static ENGLISH_NOUNS: LazyLock<Phrases> = LazyLock::new(|| Phrases::new(&[words::ENGLISH_NOUNS]));

/// The requirement without its notes in brackets: a gender note (`(m/w/d)`), a level
/// (`(C1)`), a wish (`(von Vorteil)`), examples (`(z. B. LucaNet)`) and the short form of the
/// words before it (`SAP Analytics Cloud (SAC)`). Other brackets stay (`SAP (FI/CO)`).
fn without_notes(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(open) = rest.find('(') {
        let Some(length) = rest[open..].find(')') else {
            break;
        };
        let close = open + length;
        out.push_str(&rest[..open]);
        let inner = &rest[open + 1..close];
        if !is_note(inner, &out) {
            out.push_str(&rest[open..=close]);
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    out
}

/// Whether the words in brackets are only a note (see [`without_notes`]).
fn is_note(inner: &str, before: &str) -> bool {
    let folded = fold(inner.trim());
    let parts: Vec<&str> = folded
        .split(|c: char| c.is_whitespace() || c == '/' || c == ',' || c == '-')
        .map(|p| p.trim_matches(KEY_PUNCTUATION))
        .filter(|p| !p.is_empty())
        .collect();
    let key = parts.join(" ");
    let spaced: Vec<String> = folded
        .split_whitespace()
        .map(|p| p.trim_matches(KEY_PUNCTUATION).to_owned())
        .filter(|p| !p.is_empty())
        .collect();
    let spaced = spaced.join(" ");
    let gender = lex::GENDER_MARKERS.contains(&folded.as_str())
        || (!parts.is_empty() && parts.iter().all(|p| lex::GENDER_LETTERS.contains(p)))
        || matches!(key.as_str(), "in" | "innen");
    let level = parts.iter().any(|p| is_cefr(p))
        && parts
            .iter()
            .all(|p| is_cefr(p) || LEVEL_FILLERS.contains(p));
    let wish = [
        words::TAILS,
        lex::NICE_CUES,
        lex::NICE_CLOSING,
        lex::MANDATORY_WORDS,
        NOTE_WORDS,
    ]
    .iter()
    .any(|table| table.contains(&spaced.as_str()))
        || lex::LEVEL_WORDS.iter().any(|(word, _)| *word == spaced);
    let examples = lex::EXAMPLES
        .iter()
        .chain(EXAMPLE_STARTS)
        .any(|marker| folded.starts_with(marker));
    let inner = inner.trim();
    let short_form = (2..=8).contains(&inner.chars().count())
        && inner.chars().any(char::is_uppercase)
        && inner
            .chars()
            .all(|c| c.is_uppercase() || c.is_ascii_digit() || c == '&' || c == '-')
        && before.split_whitespace().count() >= 2;
    key.is_empty() || gender || level || wish || examples || short_form
}

/// Words in brackets that are a wish (`(Pflicht)`, `(optional)`).
const NOTE_WORDS: &[&str] = &[
    "ideal",
    "idealerweise",
    "must",
    "optional",
    "pflicht",
    "plus",
    "zwingend",
];

/// Words that open examples in brackets, on top of the engine's.
const EXAMPLE_STARTS: &[&str] = &["bspw", "wie ", "like ", "incl", "inkl"];

/// Words around a level in brackets (`(mind. B2)`, `(C1-Niveau)`).
const LEVEL_FILLERS: &[&str] = &[
    "bis",
    "level",
    "min",
    "mind",
    "mindestens",
    "niveau",
    "oder",
    "or",
];

/// A level of the Common European Framework (`b2`).
fn is_cefr(word: &str) -> bool {
    let mut chars = word.chars();
    matches!(
        (chars.next(), chars.next(), chars.next()),
        (Some('a' | 'b' | 'c'), Some('1' | '2'), None)
    )
}

/// The words of the requirement; gender endings go (`Controller:in`), and so do dashes and
/// gender notes between words.
fn words_of(text: &str) -> Vec<Word<'_>> {
    text.split_whitespace()
        .filter_map(|token| {
            let raw = without_gender(token.trim_matches(RAW_PUNCTUATION));
            let key = fold(raw).trim_matches(KEY_PUNCTUATION).to_owned();
            let gender = lex::GENDER_MARKERS.contains(&key.as_str())
                || (key.contains('/') && key.split('/').all(|p| lex::GENDER_LETTERS.contains(&p)));
            (!key.is_empty() && !DASHES.contains(&key.as_str()) && !gender)
                .then_some(Word { raw, key })
        })
        .collect()
}

/// A word without its gender ending (`Controller:in`, `Berater*innen`, `Leiter(in)`).
fn without_gender(word: &str) -> &str {
    lex::GENDER_FORMS
        .iter()
        .find_map(|form| {
            cut_ascii(word, form)
                .filter(|stem| stem.chars().last().is_some_and(char::is_alphabetic))
        })
        .unwrap_or(word)
}

/// `word` without an ASCII `ending` in any case, if something is left.
fn cut_ascii<'a>(word: &'a str, ending: &str) -> Option<&'a str> {
    let at = word.len().checked_sub(ending.len())?;
    (at > 0 && word.is_char_boundary(at) && word[at..].eq_ignore_ascii_case(ending))
        .then(|| &word[..at])
}

/// How many words at the front only say that or how much the term is wanted.
fn leads(words: &[Word<'_>], language: bool, marks: &mut Marks) -> usize {
    let mut start = 0;
    while start < words.len() {
        let rest = &words[start..];
        let step = if let Some(n) = INDUSTRY_NOUNS.at_start(rest) {
            marks.industry = true;
            n
        } else if let Some(n) = CERTIFICATE_LEADS.at_start(rest) {
            marks.certificate = true;
            n
        } else if let Some(n) = LEADS.at_start(rest) {
            n
        } else if let Some(n) = language.then(|| LEVELS.at_start(rest)).flatten() {
            n
        } else if is_german_qualifier(&rest[0].key)
            || (is_number(&rest[0].key)
                && rest.get(1).is_some_and(|w| YEARS.contains(&w.key.as_str())))
        {
            // `Fundierte`, or a number of years (`5 Jahre`).
            1
        } else if let Some(n) = english_lead(rest) {
            n
        } else {
            break;
        };
        start += step;
    }
    start.min(words.len())
}

/// Words of years after a number (`5 Jahre`, `3+ years`).
const YEARS: &[&str] = &["jahr", "jahre", "jahren", "year", "years", "yrs"];

/// A number (`5`, `3+`, `5-7`) or a number word (`drei`, `mehrere`).
fn is_number(word: &str) -> bool {
    (word.chars().any(|c| c.is_ascii_digit())
        && word
            .chars()
            .all(|c| c.is_ascii_digit() || matches!(c, '+' | '-' | '–')))
        || lex::NUMBER_WORDS.iter().any(|(number, _)| *number == word)
        || matches!(word, "mehrere" | "einige" | "several" | "many" | "multiple")
}

/// A German qualifier with or without its ending (`fundierte`, `sehr gutes`).
fn is_german_qualifier(word: &str) -> bool {
    words::GERMAN_QUALIFIERS.iter().any(|stem| {
        word.strip_prefix(stem)
            .is_some_and(|ending| words::QUALIFIER_ENDINGS.contains(&ending))
    })
}

/// English qualifiers and a noun before a link word (`Strong knowledge of`), or qualifiers
/// before a lead (`Proven track record in`): the words to strip.
fn english_lead(words: &[Word<'_>]) -> Option<usize> {
    let qualifiers = words
        .iter()
        .take_while(|w| words::ENGLISH_QUALIFIERS.contains(&w.key.as_str()))
        .count();
    let rest = &words[qualifiers..];
    if let Some(n) = ENGLISH_NOUNS.at_start(rest)
        && rest
            .get(n)
            .is_some_and(|w| words::ENGLISH_LINKS.contains(&w.key.as_str()))
    {
        return Some(qualifiers + n);
    }
    let lead = LEADS.at_start(rest).is_some()
        || INDUSTRY_NOUNS.at_start(rest).is_some()
        || CERTIFICATE_LEADS.at_start(rest).is_some();
    (qualifiers > 0 && lead).then_some(qualifiers)
}

/// How many words at the end only say how much the term is wanted, or that it is known.
fn tails(words: &[Word<'_>], language: bool, marks: &mut Marks) -> usize {
    let mut end = words.len();
    while end > 0 {
        let rest = &words[..end];
        let step = if let Some(n) = INDUSTRY_NOUNS.at_end(rest) {
            marks.industry = true;
            n
        } else if let Some(n) = CERTIFICATE_TAILS.at_end(rest) {
            marks.certificate = true;
            n
        } else if let Some(n) = TAILS.at_end(rest) {
            n
        } else if let Some(n) = language.then(|| LEVELS.at_end(rest)).flatten() {
            n
        } else if english_tail(rest) {
            1
        } else if words::INDUSTRY_TAILS.contains(&rest[end - 1].key.as_str()) {
            // `Pharma Branche` is `Pharma`; `chemische Industrie` keeps its words.
            marks.industry = true;
            let before = &rest[..end - 1];
            let named = |n: usize| {
                before.len() >= n && industry_of(&joined(&before[before.len() - n..])).is_some()
            };
            if !named(1) && !named(2) {
                break;
            }
            1
        } else {
            break;
        };
        end -= step;
    }
    words.len() - end
}

/// An English noun that closes a term (`SAP experience`), unless the word before it makes a
/// term with it (`Customer Experience`).
fn english_tail(words: &[Word<'_>]) -> bool {
    let Some((last, before)) = words.split_last() else {
        return false;
    };
    words::ENGLISH_TAIL_NOUNS.contains(&last.key.as_str())
        && before
            .last()
            .is_none_or(|w| !words::ENGLISH_KEPT.contains(&w.key.as_str()))
}

/// The folded words, one space between them.
fn joined(words: &[Word<'_>]) -> String {
    words
        .iter()
        .map(|w| w.key.as_str())
        .collect::<Vec<_>>()
        .join(" ")
}

/// The last word without an ending that only says it is known (`SAP-Kenntnisse`,
/// `Excelkenntnisse`), a certificate (`PMP-Zertifizierung`) or an industry
/// (`Pharma-Branche`, `Energiebranche`).
fn without_ending<'a>(word: Word<'a>, marks: &mut Marks) -> Word<'a> {
    let cut = |raw: &'a str| Word {
        raw,
        key: fold(raw).trim_matches(KEY_PUNCTUATION).to_owned(),
    };
    for suffix in lex::KNOWLEDGE_SUFFIXES {
        if let Some(stem) = cut_ascii(word.raw, suffix) {
            return cut(stem);
        }
    }
    for suffix in words::CERTIFICATE_SUFFIXES {
        if let Some(stem) = cut_ascii(word.raw, suffix) {
            marks.certificate = true;
            return cut(stem);
        }
    }
    for ending in words::INDUSTRY_WORD_ENDINGS {
        if let Some(stem) = cut_ascii(word.raw, &format!("-{ending}")) {
            marks.industry = true;
            return cut(stem);
        }
    }
    // A closed compound with a knowledge ending: a language or a tool before it.
    for ending in CLOSED_KNOWLEDGE {
        if let Some(stem) = cut_ascii(word.raw, ending) {
            let stem_word = cut(stem);
            let tool = words::TOOLS
                .binary_search(&term_key(&stem_word.key).as_str())
                .is_ok();
            if tool || language_of(&stem_word.key).is_some() {
                return stem_word;
            }
        }
    }
    // An industry word with an ending that goes (`Energiebranche`, `Versicherungsbranche`).
    for ending in words::INDUSTRY_ENDINGS_DROPPED {
        let Some(stem) = cut_ascii(word.raw, ending) else {
            continue;
        };
        for stem in [Some(stem), stem.strip_suffix('s')].into_iter().flatten() {
            let stem_word = cut(stem);
            if industry_of(&stem_word.key).is_some() {
                marks.industry = true;
                return stem_word;
            }
        }
    }
    word
}

/// Knowledge endings of a closed compound (`Excelkenntnisse`, `Englischkenntnisse`).
const CLOSED_KNOWLEDGE: &[&str] = &["kenntnisse", "kenntnis", "erfahrung", "wissen"];

/// The engine's language (its stem) a word names: `Englisch`, `English`,
/// `Englischkenntnisse`, `englische`.
fn language_of(word: &str) -> Option<&'static str> {
    if let Some((_, stem)) = lex::LANGUAGE_NAMES.iter().find(|(name, _)| *name == word) {
        return Some(stem);
    }
    lex::LANGUAGES.iter().copied().find(|stem| {
        word.strip_prefix(stem).is_some_and(|rest| {
            let rest = rest.trim_start_matches('-');
            words::QUALIFIER_ENDINGS.contains(&rest)
                || lexicon::LANGUAGE_SUFFIXES.contains(&rest)
                || CLOSED_KNOWLEDGE.contains(&rest)
        })
    })
}

/// The engine's industry a term names: a word of its industry table (`Energie`, `energy`,
/// `öffentliche Verwaltung`), or one word of an industry word and an industry ending
/// (`Energiewirtschaft`, `Bankenumfeld`, `Versicherungsbranche`).
fn industry_of(key: &str) -> Option<&'static str> {
    let whole = |word: &str| {
        wishes::INDUSTRIES
            .iter()
            .chain(wishes::INDUSTRY_WORDS)
            .find(|(name, _)| *name == word)
            .map(|(_, id)| *id)
    };
    if let Some(id) = whole(key) {
        return Some(id);
    }
    if key.contains(' ') {
        return None;
    }
    words::INDUSTRY_WORD_ENDINGS.iter().find_map(|ending| {
        let stem = key.strip_suffix(ending)?.trim_end_matches('-');
        whole(stem).or_else(|| stem.strip_suffix('s').and_then(whole))
    })
}

/// The field of what is left of the requirement, and the term in the ad's words.
fn classify(words: &[Word<'_>], marks: &Marks, phrase: &str) -> Option<CoreTerm> {
    let first = words.first()?;
    let folded = joined(words);
    let key = term_key(&folded);
    let (field, key) = if let [only] = words
        && let Some(stem) = language_of(&only.key)
    {
        let raw: String = only.raw.chars().take(stem.chars().count()).collect();
        let raw = if lex::LANGUAGES.contains(&stem) && fold(&raw) == stem {
            raw
        } else {
            only.raw.to_owned()
        };
        let term = capitalized(&raw);
        return is_term(&term).then(|| CoreTerm {
            term,
            field: TermField::Language,
            key: format!("language:{stem}"),
        });
    } else if (marks.certificate
        || words::CERTIFICATES.binary_search(&key.as_str()).is_ok()
        || lex::LICENCE_WORDS.contains(&folded.as_str()))
        && !words::STANDARD_CODES.contains(&first.key.as_str())
    {
        (TermField::Certificate, None)
    } else if is_degree(words) {
        if words::GENERIC_DEGREES.contains(&folded.as_str()) {
            return None;
        }
        (TermField::Degree, None)
    } else if let Some(id) = industry_of(&folded) {
        (TermField::Industry, Some(format!("industry:{id}")))
    } else if marks.industry
        || words.last().is_some_and(|w| {
            words::INDUSTRY_ENDINGS
                .iter()
                .any(|e| w.key.len() > e.len() && w.key.ends_with(e))
        })
    {
        (TermField::Industry, None)
    } else if words::TOOLS.binary_search(&key.as_str()).is_ok() || is_tool_family(&first.key) {
        (TermField::Tool, None)
    } else {
        (TermField::Competence, None)
    };
    let mut term = words.iter().map(|w| w.raw).collect::<Vec<_>>().join(" ");
    if term.matches('(').count() != term.matches(')').count() {
        term.retain(|c| c != '(' && c != ')');
    }
    // A bullet starts with a capital; so does its term (`Kaufmännische Ausbildung`), unless
    // its first word has capitals of its own (`iOS`, `e-Commerce`).
    let bullet = phrase
        .chars()
        .find(|c| c.is_alphabetic())
        .is_some_and(char::is_uppercase);
    if bullet && !first.raw.chars().any(char::is_uppercase) {
        term = capitalized(&term);
    }
    let key = key.unwrap_or_else(|| term_key(&term));
    (is_term(&term) && !key.is_empty()).then_some(CoreTerm { term, field, key })
}

/// The first letter in capitals.
fn capitalized(text: &str) -> String {
    let mut chars = text.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// A degree: a degree word first (`Master in Finance`, `Studium der BWL`, `Diplom-Kaufmann`;
/// no `Master Data`, no `Sales Promotion`), a degree word anywhere (`MBA`,
/// `Hochschulabschluss`), or a degree ending first or last (`BWL-Studium`, `kaufmännische
/// Ausbildung`; no `Ausbildung von Mitarbeitern`).
fn is_degree(words: &[Word<'_>]) -> bool {
    let (Some(first), Some(last)) = (words.first(), words.last()) else {
        return false;
    };
    let first = first.key.as_str();
    let next = words.get(1).map(|w| w.key.as_str());
    let degree_first = words::DEGREE_FIRST.iter().any(|degree| {
        first == *degree
            || first
                .strip_prefix(degree)
                .is_some_and(|rest| rest.starts_with('-'))
    }) || first.starts_with("dipl.");
    if degree_first {
        let not_master = first.starts_with("master")
            && (next.is_some_and(|n| lex::MASTER_NOT_DEGREE.contains(&n))
                || first
                    .strip_prefix("master-")
                    .is_some_and(|rest| lex::MASTER_NOT_DEGREE.contains(&rest)));
        let not_promotion = first == "promotion"
            && words
                .iter()
                .any(|w| lex::PROMOTION_NOT_DEGREE.contains(&w.key.as_str()));
        return !not_master && !not_promotion;
    }
    if words
        .iter()
        .any(|w| words::DEGREE_ANY.contains(&w.key.as_str()))
    {
        return true;
    }
    let ends = |word: &str| words::DEGREE_ENDINGS.iter().any(|e| word.ends_with(e));
    if ends(first) {
        let others = first.ends_with("ausbildung")
            && next.is_some_and(|n| words::TRAINING_OTHERS.contains(&n));
        return !others;
    }
    ends(&last.key)
}

/// The first word of a family of tools (`SAP`, `MS`), or of one with its module (`SAP-FI`).
fn is_tool_family(first: &str) -> bool {
    words::TOOL_FAMILIES.binary_search(&first).is_ok()
        || first.split_once('-').is_some_and(|(family, code)| {
            words::TOOL_FAMILIES.binary_search(&family).is_ok()
                && (1..=words::MODULE_CODE_CHARS).contains(&code.chars().count())
                && code.chars().all(char::is_alphanumeric)
        })
}

#[cfg(test)]
mod tests {
    use super::*;
    use TermField::{Certificate, Competence, Degree, Industry, Language, Tool};

    /// Phrases of ads (German and English), their term and its field.
    const CASES: &[(&str, &str, TermField)] = &[
        // The three of the user's report.
        ("Kenntnisse in Anaplan", "Anaplan", Tool),
        ("Branchenerfahrung Energie", "Energie", Industry),
        (
            "Erfahrung mit SAP Analytics Cloud",
            "SAP Analytics Cloud",
            Tool,
        ),
        // German leads and fillers.
        ("Fundierte Kenntnisse in SAP FI/CO", "SAP FI/CO", Tool),
        ("Sehr gute Kenntnisse in Power BI", "Power BI", Tool),
        (
            "Erfahrung im Projektmanagement",
            "Projektmanagement",
            Competence,
        ),
        (
            "Erfahrung in der Lohnbuchhaltung",
            "Lohnbuchhaltung",
            Competence,
        ),
        (
            "Kenntnisse im Schweizer Sozialversicherungsrecht",
            "Schweizer Sozialversicherungsrecht",
            Competence,
        ),
        (
            "Mehrjährige Erfahrung im Controlling",
            "Controlling",
            Competence,
        ),
        ("Know-how im Bereich Treasury", "Treasury", Competence),
        ("Sicherer Umgang mit MS Excel", "MS Excel", Tool),
        ("5+ Jahre Erfahrung mit Workday", "Workday", Tool),
        ("Drei Jahre Erfahrung in SAP", "SAP", Tool),
        (
            "Erfahrung als Projektleiter (m/w/d)",
            "Projektleiter",
            Competence,
        ),
        ("Konzernberichtswesen", "Konzernberichtswesen", Competence),
        ("Kenntnisse in agilen Methoden", "Agilen Methoden", Tool),
        ("Praxis in Scrum", "Scrum", Tool),
        (
            "Verständnis für Finanzprozesse",
            "Finanzprozesse",
            Competence,
        ),
        ("Erfahrung aus der Beratung", "Beratung", Competence),
        ("Kenntnisse in LucaNet oder IBM Cognos", "LucaNet", Tool),
        (
            "Konsolidierungstools (z. B. LucaNet)",
            "Konsolidierungstools",
            Competence,
        ),
        // Trailing verbs and wishes.
        ("Kenntnisse in Anaplan helfen dabei", "Anaplan", Tool),
        ("SAP-Kenntnisse setzen wir voraus", "SAP", Tool),
        ("Erfahrung mit Jedox von Vorteil", "Jedox", Tool),
        ("Anaplan-Erfahrung wünschenswert", "Anaplan", Tool),
        ("IFRS-Kenntnisse sind ein Plus", "IFRS", Competence),
        ("Python (von Vorteil)", "Python", Tool),
        ("Excelkenntnisse erforderlich", "Excel", Tool),
        ("Kenntnisse in Tableau oder vergleichbar", "Tableau", Tool),
        // Industries.
        ("Erfahrung in der Energiebranche", "Energie", Industry),
        ("Branchenkenntnisse Pharma", "Pharma", Industry),
        (
            "Erfahrung in der Automobilindustrie",
            "Automobilindustrie",
            Industry,
        ),
        (
            "Erfahrung in der chemischen Industrie",
            "Chemischen Industrie",
            Industry,
        ),
        ("Branchenerfahrung im Bankenumfeld", "Banken", Industry),
        (
            "Erfahrung in der Versicherungsbranche",
            "Versicherung",
            Industry,
        ),
        ("Energiewirtschaft", "Energiewirtschaft", Industry),
        ("Pharma-Branche", "Pharma", Industry),
        ("Logistik", "Logistik", Industry),
        // Languages.
        ("Sehr gute Englischkenntnisse", "Englisch", Language),
        ("Verhandlungssicheres Deutsch", "Deutsch", Language),
        ("Englisch fließend", "Englisch", Language),
        ("Deutsch (C1)", "Deutsch", Language),
        ("Französisch in Wort und Schrift", "Französisch", Language),
        ("Fluent German", "German", Language),
        ("Business fluent English", "English", Language),
        // Certificates and degrees.
        ("PMP-Zertifizierung", "PMP", Certificate),
        (
            "Zertifizierung als Scrum Master",
            "Scrum Master",
            Certificate,
        ),
        ("PRINCE2 Practitioner", "PRINCE2 Practitioner", Certificate),
        ("ITIL Foundation Zertifikat", "ITIL Foundation", Certificate),
        ("CFA", "CFA", Certificate),
        ("Abgeschlossenes BWL-Studium", "BWL-Studium", Degree),
        (
            "Abgeschlossene kaufmännische Ausbildung",
            "Kaufmännische Ausbildung",
            Degree,
        ),
        (
            "Studium der Wirtschaftswissenschaften",
            "Studium der Wirtschaftswissenschaften",
            Degree,
        ),
        ("Master in Finance", "Master in Finance", Degree),
        ("MBA", "MBA", Degree),
        // Not what it looks like.
        (
            "Master Data Management",
            "Master Data Management",
            Competence,
        ),
        ("Scrum Master", "Scrum Master", Competence),
        ("ISO 9001 Zertifizierung", "ISO 9001", Competence),
        (
            "Ausbildung von Mitarbeitern",
            "Ausbildung von Mitarbeitern",
            Competence,
        ),
        ("Sales Promotion", "Sales Promotion", Competence),
        ("Record to Report", "Record to Report", Competence),
        ("Betriebswirtschaft", "Betriebswirtschaft", Competence),
        ("Energiehandel", "Energiehandel", Competence),
        ("SAP-Einführung", "SAP-Einführung", Competence),
        ("SAP-FI", "SAP-FI", Tool),
        // English.
        ("Knowledge of IFRS", "IFRS", Competence),
        ("Hands-on experience with Workday", "Workday", Tool),
        ("Strong experience in M&A", "M&A", Competence),
        (
            "Proven track record in restructuring",
            "Restructuring",
            Competence,
        ),
        ("Working knowledge of SQL", "SQL", Tool),
        ("Experience with Jira is a plus", "Jira", Tool),
        ("SAP experience required", "SAP", Tool),
        ("Excel skills", "Excel", Tool),
        ("Experience in the energy sector", "Energy", Industry),
        ("Automotive industry experience", "Automotive", Industry),
        ("Knowledge Management", "Knowledge Management", Competence),
        ("Customer Experience", "Customer Experience", Competence),
        (
            "Working Capital Management",
            "Working Capital Management",
            Competence,
        ),
        ("Deep Learning", "Deep Learning", Competence),
        ("Familiarity with Power-BI", "Power-BI", Tool),
        ("Background in finance", "Finance", Competence),
    ];

    #[test]
    fn the_term_and_field_of_ad_phrases() {
        let mut wrong = Vec::new();
        for (phrase, term, field) in CASES {
            let got = core_term(phrase).map(|c| (c.term, c.field));
            if got.as_ref() != Some(&((*term).to_owned(), *field)) {
                wrong.push(format!("{phrase:?}: {got:?}, wanted ({term:?}, {field:?})"));
            }
        }
        assert!(wrong.is_empty(), "\n{}", wrong.join("\n"));
    }

    /// A sentence, a term of more than five words and words that name nothing give none.
    #[test]
    fn no_term_of_a_sentence_or_of_nothing() {
        for phrase in [
            "",
            "Erfahrung",
            "Kenntnisse",
            "Branchenerfahrung",
            "Mindestens 5 Jahre Berufserfahrung",
            "Abgeschlossenes Studium",
            "Hochschulabschluss",
            "Erfahrung in SAP.",
            "Aufgaben:",
            "Sie verfügen über fundierte Kenntnisse in der Konzernrechnungslegung",
            "Erfahrung mit Lagerverwaltungssystemen in der Hafenlogistik und im Zoll",
            "one two three four five six seven eight nine ten eleven",
        ] {
            assert_eq!(core_term(phrase), None, "{phrase:?}");
        }
        // A long bullet whose term is short gives it.
        assert_eq!(
            core_term("Erfahrung mit Anaplan von Vorteil").map(|c| c.term),
            Some("Anaplan".to_owned())
        );
    }

    /// Two terms of one thing share their key: a spelling, a language in two languages, an
    /// industry in two words.
    #[test]
    fn terms_of_one_thing_share_a_key() {
        let key = |phrase: &str| core_term(phrase).unwrap().key().to_owned();
        assert_eq!(key("Kenntnisse in Anaplan"), key("Anaplan"));
        assert_eq!(key("Power-BI"), key("Kenntnisse in Power BI"));
        assert_eq!(key("Englischkenntnisse"), key("Fluent English"));
        assert_eq!(
            key("Branchenerfahrung Energie"),
            key("Energy sector experience")
        );
        assert_eq!(key("Energiewirtschaft"), key("Energie"));
        assert_ne!(key("C++"), key("C#"));
        assert_ne!(key("SAP FI"), key("SAP CO"));
    }

    /// A term keeps the ad's words and is never longer than five words.
    #[test]
    fn a_term_is_the_ads_words() {
        let got = core_term("Erfahrung mit sap analytics cloud").unwrap();
        assert_eq!(got.term, "Sap analytics cloud");
        let got = core_term("erfahrung mit sap").unwrap();
        assert_eq!(got.term, "sap", "a bullet in lower case stays so");
        let got = core_term("Kenntnisse in iOS").unwrap();
        assert_eq!(got.term, "iOS");
        for (phrase, ..) in CASES {
            if let Some(got) = core_term(phrase) {
                assert!(is_term(&got.term), "{phrase:?}: {got:?}");
            }
        }
    }

    /// A term is a keyword or a bullet of up to five words that ends like no sentence.
    #[test]
    fn a_term_has_few_words_and_no_full_stop() {
        assert!(is_term("SAP S/4HANA"));
        assert!(is_term("  Kenntnisse in Zollabwicklung  "));
        assert!(is_term("one two three four five"));
        assert!(!is_term("one two three four five six"));
        assert!(!is_term("Erfahrung in SAP."));
        assert!(!is_term("Aufgaben:"));
        assert!(!is_term(""));
        assert!(!is_term(&"x".repeat(81)));
    }

    /// The tables searched by halves are sorted, and each is written as its keys are.
    #[test]
    fn the_tables_are_sorted_keys() {
        for (name, table) in [
            ("TOOLS", words::TOOLS),
            ("TOOL_FAMILIES", words::TOOL_FAMILIES),
            ("CERTIFICATES", words::CERTIFICATES),
        ] {
            assert!(table.windows(2).all(|w| w[0] < w[1]), "{name} is sorted");
            for entry in table {
                assert_eq!(term_key(&fold(entry)), *entry, "{name}: {entry}");
            }
        }
    }
}
