//! Skill atoms of the engine: case-folded, umlauts folded, fillers removed, light
//! stemming (V1), bilingual concepts (V3), and the fit of two atoms including compounds
//! (V2) and specific/general relations (V4).

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};

use super::graph;
use super::lexicon::domains::{DOMAINS, Domain};
use super::lexicon::{self, engine as lex};
use super::normalize::casefold;
use super::params::PACK_HITS;

/// Case-folded, umlauts folded (`Übersicht` -> `ubersicht`, `ß` -> `ss`).
pub(crate) fn fold(text: &str) -> String {
    let folded = casefold(text);
    if !folded.contains(['ä', 'ö', 'ü']) {
        return folded;
    }
    folded
        .chars()
        .map(|c| match c {
            'ä' => 'a',
            'ö' => 'o',
            'ü' => 'u',
            other => other,
        })
        .collect()
}

static STOP: LazyLock<Vec<String>> = LazyLock::new(|| {
    let mut words: Vec<String> = lexicon::STOPWORDS.iter().map(|w| fold(w)).collect();
    words.extend(lex::FILLERS.iter().map(|w| (*w).to_owned()));
    words.sort();
    words.dedup();
    words
});

/// The concept table of one profile: the general core plus the domain packs its
/// competences switch on. Stemmed keys and values, longest keys first.
#[derive(Debug, Clone)]
pub(crate) struct Vocab {
    concepts: Vec<(Vec<String>, String)>,
    /// Indices into `concepts` by the first stem of the key, in `concepts` order.
    by_first: HashMap<String, Vec<usize>>,
    /// One-word keys by their form without a linking `s` (`werkleit` for `werksleit`).
    by_linking_s: HashMap<String, Vec<usize>>,
    /// The concepts (values), sorted.
    values: Vec<String>,
    packs: Vec<&'static str>,
    /// Its own number: the key of the atoms read with it ([`atoms`]). A clone is the same
    /// table and keeps it.
    id: u64,
}

/// The next [`Vocab::id`].
static VOCAB_IDS: AtomicU64 = AtomicU64::new(0);

/// The forms of a compound stem without one linking `s`: an `s` after four letters or more
/// and before three or more (`werksleit` -> `werkleit`).
fn without_linking_s(word: &str) -> impl Iterator<Item = String> + '_ {
    word.char_indices()
        .filter(move |&(at, c)| c == 's' && at >= 4 && word.len() - at > 3)
        .map(move |(at, _)| format!("{}{}", &word[..at], &word[at + 1..]))
}

impl Vocab {
    fn with(packs: &[&'static Domain]) -> Self {
        let mut concepts: Vec<(Vec<String>, String)> = lex::CORE_CONCEPTS
            .iter()
            .chain(packs.iter().flat_map(|d| d.concepts.iter()))
            .map(|(key, value)| (key.split(' ').map(stem).collect(), stem(value)))
            .collect();
        concepts.sort_by_key(|(key, _)| std::cmp::Reverse(key.len()));
        let mut by_first: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, (key, _)) in concepts.iter().enumerate() {
            if let Some(first) = key.first() {
                by_first.entry(first.clone()).or_default().push(index);
            }
        }
        let mut by_linking_s: HashMap<String, Vec<usize>> = HashMap::new();
        for (index, (key, _)) in concepts.iter().enumerate() {
            if let [only] = key.as_slice() {
                for form in without_linking_s(only).filter(|f| !by_first.contains_key(f)) {
                    by_linking_s.entry(form).or_default().push(index);
                }
            }
        }
        let mut values: Vec<String> = concepts.iter().map(|(_, value)| value.clone()).collect();
        values.sort();
        values.dedup();
        Self {
            concepts,
            by_first,
            by_linking_s,
            values,
            packs: packs.iter().map(|d| d.name).collect(),
            id: VOCAB_IDS.fetch_add(1, Ordering::Relaxed),
        }
    }

    /// The general core only (tests).
    #[cfg(test)]
    pub(crate) fn core() -> Self {
        Self::with(&[])
    }

    /// Core plus every pack that at least `PACK_HITS` tokens of `texts` trigger (one stray
    /// word such as `Budget` in an HR profile switches on no finance pack).
    pub(crate) fn for_texts<'a>(texts: impl IntoIterator<Item = &'a str>) -> Self {
        let folded: Vec<String> = texts.into_iter().map(fold).collect();
        let packs: Vec<&'static Domain> = DOMAINS
            .iter()
            .filter(|domain| {
                let hits = folded
                    .iter()
                    .flat_map(|text| raw_tokens(text))
                    .filter(|t| domain.triggers.iter().any(|p| t.starts_with(p)))
                    .count();
                hits >= PACK_HITS
            })
            .copied()
            .collect();
        Self::with(&packs)
    }

    /// Every pack (the gap finder, tests).
    pub(crate) fn all() -> Self {
        Self::with(DOMAINS)
    }

    /// Names of the switched-on packs.
    pub(crate) fn packs(&self) -> &[&'static str] {
        &self.packs
    }

    /// Which of these words (stemmed, as `esco::words` folds a text) the vocabulary gives a
    /// meaning: the words of a key, and a concept written as itself.
    pub(crate) fn known(&self, words: &[String]) -> Vec<bool> {
        let mut known = vec![false; words.len()];
        let mut at = 0;
        while at < words.len() {
            if let Some((n, _)) = self.concept_at(words, at) {
                known[at..at + n].fill(true);
                at += n;
            } else {
                known[at] = self.values.binary_search(&words[at]).is_ok();
                at += 1;
            }
        }
        known
    }

    /// The longest concept whose key starts at `at` (the first in `concepts` order); a
    /// one-word key also with or without its linking `s` (`Werkleiter` for `Werksleiter`).
    fn concept_at(&self, stems: &[String], at: usize) -> Option<(usize, String)> {
        let stem = stems.get(at)?;
        let Some(candidates) = self.by_first.get(stem) else {
            return self.linking_s_concept(stem).map(|value| (1, value));
        };
        candidates.iter().find_map(|&index| {
            let (key, value) = &self.concepts[index];
            let end = at + key.len();
            (end <= stems.len() && stems[at..end] == key[..]).then(|| (key.len(), value.clone()))
        })
    }

    /// The value of a one-word key that differs from `stem` by a linking `s` (a compound
    /// has eight letters or more).
    fn linking_s_concept(&self, stem: &str) -> Option<String> {
        if stem.len() < 8 {
            return None;
        }
        let one_word = |index: &usize| {
            let (key, value) = &self.concepts[*index];
            (key.len() == 1).then(|| value.clone())
        };
        if let Some(found) = self
            .by_linking_s
            .get(stem)
            .and_then(|c| c.iter().find_map(one_word))
        {
            return Some(found);
        }
        without_linking_s(stem).find_map(|form| {
            self.by_first
                .get(&form)
                .and_then(|c| c.iter().find_map(one_word))
        })
    }
}

/// Is `word` a stopword or filler (folded form)?
pub(crate) fn is_filler(word: &str) -> bool {
    STOP.binary_search_by(|w| w.as_str().cmp(word)).is_ok()
}

fn is_token_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, '+' | '#' | '.' | '/' | '-' | '&' | 'ß')
}

/// Raw folded tokens (the old token class plus `&` inside words such as `M&A`), trimmed
/// of leading and trailing `.`, `-`, `/` and `&`.
pub(crate) fn raw_tokens(folded: &str) -> impl Iterator<Item = &str> {
    folded
        .split(|c: char| !is_token_char(c))
        .map(|t| t.trim_matches(|c| c == '.' || c == '-' || c == '/' || c == '&'))
        .filter(|t| !t.is_empty())
}

/// `FI/CO` and `UI/UX`: short codes joined by `/` are separate tokens.
fn split_codes(token: &str) -> Vec<&str> {
    let parts: Vec<&str> = token.split('/').collect();
    // Short codes (`FI/CO`) and short words (`HGB/IFRS`); `S/4HANA` and `m/w/d` stay.
    let codes = parts.len() > 1
        && parts.iter().all(|p| {
            (p.len() <= 3 && lexicon::synonym(p).is_some())
                || ((2..=5).contains(&p.len()) && p.chars().all(|c| c.is_ascii_alphabetic()))
        });
    if codes { parts } else { vec![token] }
}

/// Light, symmetric stemmer for German and English (V1). Hyphenated words are stemmed
/// part by part.
pub(crate) fn stem(word: &str) -> String {
    if word.contains('-') {
        return word.split('-').map(stem_word).collect::<Vec<_>>().join("-");
    }
    stem_word(word)
}

/// Two passes, so `reportings` and `reporting` meet in `report`.
fn stem_word(word: &str) -> String {
    // A word the first pass keeps, the second keeps too.
    match stem_once(word) {
        Some(once) => stem_once(&once).unwrap_or(once),
        None => word.to_owned(),
    }
}

/// One pass of the rules; `None` when no rule changes the word.
fn stem_once(word: &str) -> Option<String> {
    const RULES: &[(&str, &str)] = &[
        ("ungen", "ung"),
        ("heiten", "heit"),
        ("keiten", "keit"),
        ("ies", "y"),
        ("ing", ""),
        ("ern", ""),
        ("en", ""),
        ("er", ""),
        ("es", ""),
        ("ed", ""),
        ("e", ""),
        ("s", ""),
    ];
    if word.len() < 5 || !word.is_ascii() {
        return None;
    }
    for (suffix, replacement) in RULES {
        if let Some(base) = word.strip_suffix(suffix) {
            if *suffix == "s" && (base.ends_with('s') || base.ends_with('i') || base.ends_with('u'))
            {
                continue;
            }
            if base.len() >= 4 {
                return Some(format!("{base}{replacement}"));
            }
        }
    }
    None
}

/// Gender forms end a word (`Personalleiter:in`, `Berater*innen`, `Leiter/in`,
/// `Controller(in)`): the base word counts.
fn strip_gender(folded: &str) -> String {
    let mut out = String::with_capacity(folded.len());
    let mut rest = folded;
    while let Some(c) = rest.chars().next() {
        let form = lex::GENDER_FORMS.iter().find(|form| {
            rest.strip_prefix(**form).is_some_and(|after| {
                after.chars().next().is_none_or(|n| !n.is_alphanumeric())
                    && out.chars().next_back().is_some_and(char::is_alphanumeric)
            })
        });
        if let Some(form) = form {
            rest = &rest[form.len()..];
        } else {
            out.push(c);
            rest = &rest[c.len_utf8()..];
        }
    }
    out
}

/// A hyphenated skill without a part that only says "knowledge of" (`SQL-Kenntnisse`).
fn without_knowledge(token: &str) -> &str {
    lex::KNOWLEDGE_SUFFIXES
        .iter()
        .find_map(|s| token.strip_suffix(s).filter(|rest| !rest.is_empty()))
        .unwrap_or(token)
}

/// A short token that names a skill (`QP`, `R`, `8D`)?
fn short_skill(token: &str) -> bool {
    lex::SHORT_TOKENS.binary_search(&token).is_ok()
}

/// Raw tokens with codes completed by their number (`iso 9001` -> `iso-9001`).
fn numbered(raw: &[&str]) -> Vec<String> {
    let mut out: Vec<String> = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        let t = raw[i];
        let number = raw
            .get(i + 1)
            .filter(|n| n.len() <= 6 && n.chars().all(|c| c.is_ascii_digit()));
        if let Some(n) = number.filter(|_| lex::NUMBERED_CODES.binary_search(&t).is_ok()) {
            out.push(format!("{t}-{n}"));
            i += 2;
        } else {
            out.push(t.to_owned());
            i += 1;
        }
    }
    out
}

/// A token the atoms keep: long enough (or a known short skill or synonym), no filler,
/// with a letter.
fn kept(token: &str) -> Option<String> {
    let mapped = match lexicon::synonym(token) {
        Some(Some(mapped)) => mapped.to_owned(),
        Some(None) => return None,
        None if token.len() < 3 && !short_skill(token) => return None,
        None => token.to_owned(),
    };
    let skill = short_skill(&mapped)
        || (!is_filler(&mapped) && mapped.chars().any(|c| c.is_ascii_alphabetic()));
    skill.then_some(mapped)
}

/// Atoms of a text: tokens without fillers, stemmed, concepts of `vocab` applied. A
/// concept whose words include a filler, a stopword or a short word (`US GAAP`, `Order to
/// Cash`, `Year End Closing`) is found before those words go.
pub(crate) fn atoms(text: &str, vocab: &Vocab) -> Atoms {
    // One job reads its title, items and lines many times (the ladder, the caps, the
    // relevance), the signals and the assessment read it twice, and every job the profile's
    // own words: each text once per vocabulary and thread.
    if let Some(found) = READ_ATOMS.with(|read| read.borrow().get(vocab.id, text)) {
        return found;
    }
    let found: Atoms = read_atoms(text, vocab).into();
    READ_ATOMS.with(|read| read.borrow_mut().put(vocab.id, text, found.clone()));
    found
}

/// The atoms of a text as [`atoms`] hands them out: one read shared by every caller.
pub(crate) type Atoms = Rc<[String]>;

thread_local! {
    /// The texts [`atoms`] read, by vocabulary.
    static READ_ATOMS: RefCell<Memo<Atoms>> = const { RefCell::new(Memo::new(1 << 14)) };
}

/// What a pure function read from a text, by the table it read it with (a vocabulary, the
/// profile's atoms), kept per thread up to `kept` texts in all before it starts anew.
pub(crate) struct Memo<V> {
    tables: Vec<(u64, HashMap<Box<str>, V>)>,
    kept: usize,
}

impl<V: Clone> Memo<V> {
    pub(crate) const fn new(kept: usize) -> Self {
        Self {
            tables: Vec::new(),
            kept,
        }
    }

    pub(crate) fn get(&self, table: u64, text: &str) -> Option<V> {
        let (_, texts) = self.tables.iter().find(|(id, _)| *id == table)?;
        texts.get(text).cloned()
    }

    pub(crate) fn put(&mut self, table: u64, text: &str, value: V) {
        if self.tables.iter().map(|(_, t)| t.len()).sum::<usize>() >= self.kept {
            self.tables.clear();
        }
        if !self.tables.iter().any(|(id, _)| *id == table) {
            self.tables.push((table, HashMap::new()));
        }
        if let Some((_, texts)) = self.tables.iter_mut().find(|(id, _)| *id == table) {
            texts.insert(text.into(), value);
        }
    }
}

/// A German hyphen ellipsis: modifiers that share the head of the word after them
/// (`projekt- und programmmanagement`, `risiko-, issue- und eskalationsmanagement`,
/// `utilities-/energieumfeld`).
static LEADING_ELLIPSIS: LazyLock<regex::Regex> = LazyLock::new(|| {
    let sep =
        r"(?:,\s*(?:(?:und|oder|sowie|bzw\.?|&)\s+)?|\s*/\s*|\s+(?:und|oder|sowie|bzw\.?|&)\s+)";
    regex::Regex::new(&format!(
        r"((?:[\p{{L}}\d]+(?:-[\p{{L}}\d]+)*-{sep})+)([\p{{L}}\d]+(?:-[\p{{L}}\d]+)*)"
    ))
    .expect("leading ellipsis")
});
/// One modifier of a leading ellipsis with its separator.
static ELLIPSIS_PART: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"([\p{L}\d]+(?:-[\p{L}\d]+)*)-([^\p{L}\d]+)").expect("ellipsis part")
});
/// A trailing ellipsis: a head that shares the modifier of the word before it
/// (`projektplanung und -controlling`).
static TRAILING_ELLIPSIS: LazyLock<regex::Regex> = LazyLock::new(|| {
    regex::Regex::new(r"([\p{L}\d]+)(\s+(?:und|oder|sowie|bzw\.?|&)\s+|,\s*)-([\p{L}\d]+)")
        .expect("trailing ellipsis")
});

/// The head of a closed compound (`management` of `programmmanagement`), the longest of
/// `ELLIPSIS_HEADS` with a modifier of three letters or more before it.
fn compound_head(word: &str) -> Option<&str> {
    lex::ELLIPSIS_HEADS
        .iter()
        .filter(|h| word.len() >= h.len() + 3 && word.ends_with(**h))
        .max_by_key(|h| h.len())
        .map(|h| &word[word.len() - h.len()..])
}

/// The word a modifier of a leading ellipsis stands for: `part` ends in the modifier
/// (`Erfahrung im Risiko-`), `rest` is the text after it (`und Qualitätsmanagement`); the
/// part completed with the head of the first full word of `rest` (`Erfahrung im
/// Risikomanagement`; `HW-` before `SW-Entwicklung` reads `HW-Entwicklung`), `None` when
/// `part` is no modifier or the head is unknown.
pub(crate) fn complete_ellipsis(part: &str, rest: &str) -> Option<String> {
    let modifier = part.trim_end().strip_suffix('-')?;
    if modifier.is_empty() || modifier.ends_with(char::is_whitespace) {
        return None;
    }
    let word = rest
        .split(|c: char| c.is_whitespace() || c == ',' || c == '/')
        .map(|w| w.trim_matches(|c: char| !c.is_alphanumeric() && c != '-'))
        .find(|w| {
            !w.is_empty() && !w.ends_with('-') && !lex::ELLIPSIS_JOINERS.contains(&fold(w).as_str())
        })?;
    if let Some((_, last)) = word.rsplit_once('-') {
        return (!last.is_empty()).then(|| format!("{modifier}-{last}"));
    }
    let folded = fold(word);
    let head = compound_head(&folded)?;
    let chars: Vec<char> = word.chars().collect();
    let n = head.chars().count();
    let written: String = chars[chars.len().saturating_sub(n)..].iter().collect();
    let head = if fold(&written) == head {
        written
    } else {
        head.to_owned()
    };
    Some(format!("{modifier}{head}"))
}

/// The folded text with its hyphen ellipses written out (`projekt- und programmmanagement`
/// reads as `projektmanagement und programmmanagement`, `projektplanung und -controlling`
/// as `projektplanung und projektcontrolling`); an ellipsis whose head is unknown stays.
fn expand_ellipses(folded: &str) -> std::borrow::Cow<'_, str> {
    if !folded.contains('-') {
        return std::borrow::Cow::Borrowed(folded);
    }
    let leading = LEADING_ELLIPSIS.replace_all(folded, |caps: &regex::Captures<'_>| {
        let word = &caps[2];
        // A hyphenated word shares its last part (`HW- und SW-Entwicklungsteams`).
        let (head, joiner) = match word.rsplit_once('-') {
            Some((_, last)) => (Some(last), "-"),
            None => (compound_head(word), ""),
        };
        let Some(head) = head else {
            return caps[0].to_owned();
        };
        let mods = ELLIPSIS_PART.replace_all(&caps[1], |part: &regex::Captures<'_>| {
            let sep = if part[2].contains('/') {
                " / "
            } else {
                &part[2]
            };
            // A hyphenated modifier keeps its hyphen (`Carve-out-, Post-Merger- oder
            // Transformationsprojekte`).
            let joiner = if part[1].contains('-') { "-" } else { joiner };
            format!("{}{joiner}{head}{sep}", &part[1])
        });
        format!("{mods}{word}")
    });
    let trailing = TRAILING_ELLIPSIS.replace_all(&leading, |caps: &regex::Captures<'_>| {
        let word = &caps[1];
        match compound_head(word) {
            Some(head) => format!(
                "{word}{}{}{}",
                &caps[2],
                &word[..word.len() - head.len()],
                &caps[3]
            ),
            None => caps[0].to_owned(),
        }
    });
    std::borrow::Cow::Owned(trailing.into_owned())
}

/// A requirement without its leading pronoun and verbs (`you have spent several years in x`
/// reads `several years in x`): the lead asks for nothing, its verbs would stay open.
fn without_lead(mut raw: Vec<String>) -> Vec<String> {
    if !raw
        .first()
        .is_some_and(|w| lex::PRONOUN_STARTS.contains(&w.as_str()))
    {
        return raw;
    }
    let verbs = raw[1..]
        .iter()
        .take_while(|w| lex::LEAD_VERBS.binary_search(&w.as_str()).is_ok())
        .count();
    if verbs > 0 {
        raw.drain(..=verbs);
    }
    raw
}

/// [`atoms`], read.
fn read_atoms(text: &str, vocab: &Vocab) -> Vec<String> {
    let folded = fold(text);
    let folded = expand_ellipses(&folded).into_owned();
    // Every gender form starts with one of these.
    let folded = if folded.contains([':', '*', '_', '/', '(']) {
        strip_gender(&folded)
    } else {
        folded
    };
    let mut split: Vec<&str> = Vec::new();
    for token in raw_tokens(&folded).map(without_knowledge) {
        if token.contains('/') {
            split.extend(split_codes(token));
        } else {
            split.push(token);
        }
    }
    let raw: Vec<String> = numbered(
        &split
            .iter()
            .enumerate()
            // `GmbH & Co. KG` is a company form, not SAP CO.
            .filter(|&(i, t)| !(*t == "co" && split.get(i + 1) == Some(&"kg")))
            .map(|(_, t)| *t)
            .collect::<Vec<_>>(),
    );
    let raw = without_lead(raw);
    // Concepts across dropped words: the whole stream, stemmed.
    let full: Vec<String> = raw.iter().map(|t| stem(t)).collect();
    let mut pieces: Vec<(String, bool)> = Vec::with_capacity(raw.len());
    let mut i = 0;
    while i < raw.len() {
        if let Some((n, concept)) = vocab.concept_at(&full, i)
            && n > 1
            && raw[i..i + n].iter().any(|t| kept(t).is_none())
        {
            pieces.push((concept, true));
            i += n;
            continue;
        }
        if let Some(t) = kept(&raw[i]) {
            // Hyphenated words that form a known concept count as that concept.
            let spaced: Vec<String> = if t.contains('-') {
                t.split('-').map(stem).collect()
            } else {
                Vec::new()
            };
            if spaced.len() > 1
                && vocab
                    .concept_at(&spaced, 0)
                    .is_some_and(|(n, _)| n == spaced.len())
            {
                pieces.extend(spaced.into_iter().map(|s| (s, false)));
            } else if t == raw[i] {
                pieces.push((full[i].clone(), false));
            } else {
                pieces.push((stem(&t), false));
            }
        }
        i += 1;
    }
    let (mut stems, done): (Vec<String>, Vec<bool>) = pieces.into_iter().unzip();
    let mut result = Vec::with_capacity(stems.len());
    let mut i = 0;
    while i < stems.len() {
        if done[i] {
            result.push(std::mem::take(&mut stems[i]));
            i += 1;
        } else if let Some((len, concept)) = vocab
            .concept_at(&stems, i)
            .filter(|(len, _)| !done[i..i + len].iter().any(|d| *d))
        {
            result.push(concept);
            i += len;
        } else {
            // Each stem is read here once, after every look ahead from before it.
            result.push(std::mem::take(&mut stems[i]));
            i += 1;
        }
    }
    result.dedup();
    result
}

/// The core's generic atoms plus the broad words of every domain pack (as written and
/// stemmed): a broad word is broad whoever reads it. `longest` lets the hot path skip the
/// long compounds that make up most atoms.
struct Generic {
    words: Vec<String>,
    longest: usize,
}

static GENERIC: LazyLock<Generic> = LazyLock::new(|| {
    let mut words: Vec<String> = lex::GENERIC_ATOMS
        .iter()
        .map(|w| (*w).to_owned())
        .chain(
            DOMAINS
                .iter()
                .flat_map(|d| d.generic.iter())
                .flat_map(|w| [(*w).to_owned(), stem(w)]),
        )
        .collect();
    words.sort();
    words.dedup();
    let longest = words.iter().map(String::len).max().unwrap_or(0);
    Generic { words, longest }
});

/// Is the atom too generic to meet a requirement on its own?
pub(crate) fn is_generic(atom: &str) -> bool {
    let generic = &*GENERIC;
    atom.len() <= generic.longest
        && generic
            .words
            .binary_search_by(|w| w.as_str().cmp(atom))
            .is_ok()
}

/// Every pack's concepts, for reading a search term whatever profile asks for it.
static ALL_PACKS: LazyLock<Vocab> = LazyLock::new(Vocab::all);

/// Is a term too broad to be searched for on its own (`Projektmanagement`,
/// `Personalführung`, `Generative KI`, `SAP`)? It is when every atom of it is a word the
/// engine finds generic, general business work (`lex::METHODS`),
/// leadership, a soft skill or a word too broad for a search (`lex::SEARCH_BROAD_ATOMS`); a
/// term without an atom is too.
pub(crate) fn broad_search_term(term: &str) -> bool {
    atoms(term, &ALL_PACKS).iter().all(|atom| {
        is_generic(atom)
            || lex::METHODS.contains(&atom.as_str())
            || lex::LEADERSHIP_ATOMS.contains(&atom.as_str())
            || lex::SOFT_SKILLS.iter().any(|soft| atom.starts_with(soft))
            || lex::SEARCH_BROAD_ATOMS
                .iter()
                .any(|word| *word == atom || stem(word) == *atom)
    })
}

/// Is a text general business work any field does (`Projektmanagement`, `Stakeholder
/// Management`, leadership)? Every atom of it is generic, a concept of general business work
/// (`lex::METHODS`) or leadership: it meets requirements, but shows no field.
pub(crate) fn general_work(text: &str) -> bool {
    let atoms = atoms(text, &ALL_PACKS);
    !atoms.is_empty()
        && atoms.iter().all(|atom| {
            is_generic(atom)
                || lex::METHODS.contains(&atom.as_str())
                || lex::LEADERSHIP_ATOMS.contains(&atom.as_str())
        })
}

/// The atoms of each pack's names of its field (`Domain::search`), without the generic ones.
static PACK_NAMES: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| {
    DOMAINS
        .iter()
        .map(|d| {
            let mut names: Vec<String> = d
                .search
                .iter()
                .flat_map(|term| atoms(term, &ALL_PACKS).to_vec())
                .filter(|a| !is_generic(a))
                .collect();
            names.sort();
            names.dedup();
            names
        })
        .collect()
});

/// The concepts of each pack as atoms (`kundenservic-leitung`), with the parts of the
/// hyphenated ones that name something on their own (`workforc` of `workforc-management`).
static PACK_CONCEPTS: LazyLock<Vec<Vec<String>>> = LazyLock::new(|| {
    DOMAINS
        .iter()
        .map(|d| {
            let mut concepts: Vec<String> = d
                .concepts
                .iter()
                .map(|(_, c)| stem(c))
                .flat_map(|c| {
                    let parts: Vec<String> = c
                        .split('-')
                        .filter(|p| c.contains('-') && p.len() >= 4 && !is_generic(p))
                        .map(str::to_owned)
                        .collect();
                    std::iter::once(c).chain(parts)
                })
                .collect();
            concepts.sort();
            concepts.dedup();
            concepts
        })
        .collect()
});

/// How much texts lie in each pack's field: an atom like one of the field's names
/// (`Domain::search`; equal, narrower or wider) adds a full share, a concept of the pack a
/// share divided among the packs that have it.
fn field_shares<'a>(texts: impl IntoIterator<Item = &'a str>) -> Vec<usize> {
    const SHARE: usize = 60;
    let mut shares = vec![0usize; DOMAINS.len()];
    for text in texts {
        for atom in atoms(text, &ALL_PACKS).iter().filter(|a| !is_generic(a)) {
            let concept: Vec<bool> = PACK_CONCEPTS
                .iter()
                .map(|concepts| concepts.binary_search(atom).is_ok())
                .collect();
            let packs = concept.iter().filter(|c| **c).count().max(1);
            for ((share, names), concept) in shares.iter_mut().zip(PACK_NAMES.iter()).zip(concept) {
                if names
                    .iter()
                    .any(|n| graph::fit(atom, n) != Fit::None || graph::fit(n, atom) != Fit::None)
                {
                    *share += SHARE;
                }
                if concept {
                    *share += SHARE / packs;
                }
            }
        }
    }
    shares
}

/// The field of a profile for the deep search: the one domain pack its target roles lie in
/// most ([`field_shares`]); none on a tie or when they lie in none.
#[derive(Debug, Clone, Copy)]
pub(crate) struct SearchField(usize);

impl SearchField {
    pub(crate) fn of<'a>(texts: impl IntoIterator<Item = &'a str>) -> Option<Self> {
        let shares = field_shares(texts);
        let most = shares.iter().copied().max().unwrap_or(0);
        let mut best = shares.iter().enumerate().filter(|(_, s)| **s == most);
        match (best.next(), best.next()) {
            (Some((index, _)), None) if most > 0 => Some(Self(index)),
            _ => None,
        }
    }

    /// The field's names as job boards write them.
    pub(crate) fn names(self) -> &'static [&'static str] {
        DOMAINS[self.0].search
    }

    /// Does a text (a competence) lie in the field at all?
    pub(crate) fn holds(self, text: &str) -> bool {
        field_shares([text])[self.0] > 0
    }
}

/// Relation of a job atom to a profile atom.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) enum Fit {
    None,
    /// The job atom narrows the profile atom (`Finanzcontrolling` vs `Controlling`).
    General,
    /// The profile atom is narrower work the job atom covers (`Jahresabschluss` for
    /// `Rechnungswesen`, `graph`): it meets a requirement, but the ad does not name it.
    Covered,
    /// The profile atom narrows the job atom (`SAP-Projektleitung` vs `Projektleitung`).
    Specific,
    /// Same skill, also through a light compound part (`Konzernkonsolidierung`).
    Equal,
}

/// A compound part without the linking `s` that does not change the skill.
fn light(part: &str, table: &[&str]) -> bool {
    let part = part.trim_matches('-');
    let candidates = [
        part,
        part.strip_suffix('s').unwrap_or(part),
        part.strip_prefix('s').unwrap_or(part),
    ];
    part.is_empty()
        || candidates
            .iter()
            .any(|p| lexicon::contains(table, p) || lexicon::contains(table, &stem(p)))
}

/// The same compound with and without the linking `s` (`Werksleiter`, `Werkleiter`): one
/// atom is the other with an `s` after a modifier of four letters or more and before a head
/// of three or more (`Leistung` is no `Leitung`).
fn linking_s(a: &str, b: &str) -> bool {
    let (long, short) = match a.len().checked_sub(b.len()) {
        Some(1) => (a, b),
        _ if b.len().checked_sub(a.len()) == Some(1) => (b, a),
        _ => return false,
    };
    let at = long
        .bytes()
        .zip(short.bytes())
        .position(|(x, y)| x != y)
        .unwrap_or(short.len());
    at >= 4
        && short.len() - at >= 3
        && long.as_bytes().get(at) == Some(&b's')
        && long.get(at + 1..) == short.get(at..)
}

/// How a job atom relates to a profile atom by their words (V2 compounds, V4
/// specific/general): equal, one a compound of the other, a linking `s`. The knowledge graph
/// adds what the words do not say (`graph::fit`).
pub(crate) fn fit_direct(job: &str, profile: &str) -> Fit {
    if job == profile {
        return Fit::Equal;
    }
    // Every relation below is one atom at the start or the end of the other, or a linking
    // `s` (one letter more): the rest of the work only for those (the hot path of the
    // relevance and the ladder).
    if job.len().abs_diff(profile.len()) != 1
        && !job.starts_with(profile)
        && !job.ends_with(profile)
        && !profile.starts_with(job)
        && !profile.ends_with(job)
    {
        return Fit::None;
    }
    // A generic profile atom (`Management`) never reaches a compound
    // (`Projektmanagement`).
    if is_generic(profile) {
        return Fit::None;
    }
    // Four letters are too short to be a compound part (`steu` of `Steuern` is not the
    // head of `Steuerung`).
    // A compound needs a real modifier: `h` + `erstellung` is `Herstellung`, no compound.
    // `IT-Carve-out` narrows `Carve-out` (a hyphen marks the compound); `Einführung` is no
    // `Führung` (a verbal particle is no modifier).
    // The modifier next to the head is the last part of a hyphenated one (`HRIS-Ein` of
    // `HRIS-Einführung` is `ein`); a head that particles bind to (`Führung`) takes no
    // modifier ending in a particle (`Markteinführung` is an `Einführung`).
    let modifier_ok = |m: &str, head: &str| {
        let bare = m.trim_end_matches('-');
        let last = bare.rsplit('-').next().unwrap_or(bare);
        let particle_verb = lex::PARTICLE_HEADS.iter().any(|h| head.starts_with(h))
            && lex::PARTICLE_MODIFIERS.iter().any(|p| last.ends_with(p));
        (m.ends_with('-') || bare.len() >= lex::MIN_COMPOUND_MODIFIER)
            && !lex::PARTICLE_MODIFIERS.contains(&last)
            && !particle_verb
    };
    if linking_s(job, profile) {
        return Fit::Equal;
    }
    if profile.len() >= 5 {
        if let Some(modifier) = job
            .strip_suffix(profile)
            .filter(|m| modifier_ok(m, profile))
        {
            return if light(modifier, lex::LIGHT_MODIFIERS) {
                Fit::Equal
            } else {
                Fit::General
            };
        }
        if let Some(head) = job.strip_prefix(profile) {
            return if light(head, lex::LIGHT_HEADS) {
                Fit::Equal
            } else {
                Fit::General
            };
        }
    }
    if job.len() >= 4 && !is_generic(job) {
        // `cash` is not the head of `Order-to-Cash`: a short atom never ends a hyphenated
        // name.
        if let Some(modifier) = profile.strip_suffix(job)
            && modifier_ok(modifier, job)
            && !(modifier.ends_with('-') && job.len() < 5)
        {
            return Fit::Specific;
        }
        if profile.strip_prefix(job).is_some_and(|head| {
            (head.starts_with('-') && job.len() >= 5) || light(head, lex::LIGHT_HEADS)
        }) {
            return Fit::Specific;
        }
    }
    Fit::None
}

#[cfg(test)]
mod tests;
