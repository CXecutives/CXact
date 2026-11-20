//! Skill atoms of the engine: case-folded, umlauts folded, fillers removed, light
//! stemming (V1), bilingual concepts (V3), and the fit of two atoms including compounds
//! (V2) and specific/general relations (V4).

use std::cell::RefCell;
use std::collections::HashMap;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};

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
pub(crate) fn atoms(text: &str, vocab: &Vocab) -> Vec<String> {
    // One job reads its title, items and lines many times (the ladder, the caps, the
    // relevance): each text once per vocabulary and thread.

    let key = (vocab.id, text.to_owned());
    if let Some(found) = READ_ATOMS.with(|read| read.borrow().get(&key).cloned()) {
        return found;
    }
    let found = read_atoms(text, vocab);
    READ_ATOMS.with(|read| {
        let mut read = read.borrow_mut();
        if read.len() >= ATOMS_KEPT {
            read.clear();
        }
        read.insert(key, found.clone());
    });
    found
}

/// Forgets the texts [`atoms`] read on this thread (a new job: one job's texts are read
/// again, another job's hardly).
pub(crate) fn forget_atoms() {
    READ_ATOMS.with(|read| read.borrow_mut().clear());
}

thread_local! {
    /// The texts [`atoms`] read, by vocabulary.
    static READ_ATOMS: RefCell<HashMap<(u64, String), Vec<String>>> = RefCell::new(HashMap::new());
}

/// So many texts [`atoms`] keeps per thread before it starts anew.
const ATOMS_KEPT: usize = 4096;

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
/// engine finds generic, a concept of general business work (`lex::CORE_CONCEPTS`),
/// leadership, a soft skill or a word too broad for a search (`lex::SEARCH_BROAD_ATOMS`); a
/// term without an atom is too.
pub(crate) fn broad_search_term(term: &str) -> bool {
    let general: Vec<&str> = lex::CORE_CONCEPTS.iter().map(|&(_, to)| to).collect();
    atoms(term, &ALL_PACKS).iter().all(|atom| {
        is_generic(atom)
            || general.contains(&atom.as_str())
            || lex::LEADERSHIP_ATOMS.contains(&atom.as_str())
            || lex::SOFT_SKILLS.iter().any(|soft| atom.starts_with(soft))
            || lex::SEARCH_BROAD_ATOMS
                .iter()
                .any(|word| *word == atom || stem(word) == *atom)
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
                .flat_map(|term| atoms(term, &ALL_PACKS))
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
                    .any(|n| fit(atom, n) != Fit::None || fit(n, atom) != Fit::None)
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

/// How a job atom relates to a profile atom (V2 compounds, V4 specific/general). A head
/// the lexicon treats as a near equivalent (`Projektleitung` for `Projektmanagement`, also
/// in `Projektleitungserfahrung`) meets it in half: close, but leading a project and
/// managing projects are not always the same skill.
pub(crate) fn fit(job: &str, profile: &str) -> Fit {
    let direct = fit_direct(job, profile);
    if direct != Fit::None {
        return direct;
    }
    for &(a, b) in lex::EQUIVALENT_HEADS {
        for (from, to) in [(a, b), (b, a)] {
            if let Some(rest) = job.strip_prefix(from)
                && fit_direct(&format!("{to}{rest}"), profile) != Fit::None
            {
                return Fit::General;
            }
        }
    }
    // The narrower work of a broader field the profile names (`Beschwerdemanagement` for
    // `Customer Service Management`), an AI tool for AI: half.
    if HALF.get(job).is_some_and(|broader| {
        broader
            .iter()
            .any(|b| matches!(fit_direct(b, profile), Fit::Equal | Fit::Specific))
    }) {
        return Fit::General;
    }
    Fit::None
}

/// The concepts of an ad and the profile concepts that meet them in half
/// (`lexicon::engine::CORE_HALF`, `Domain::half`), stemmed.
static HALF: LazyLock<HashMap<String, Vec<String>>> = LazyLock::new(|| {
    let mut half: HashMap<String, Vec<String>> = HashMap::new();
    for (profile, jobs) in lex::CORE_HALF
        .iter()
        .chain(DOMAINS.iter().flat_map(|d| d.half.iter()))
    {
        for job in *jobs {
            half.entry(stem(job)).or_default().push(stem(profile));
        }
    }
    half
});

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

fn fit_direct(job: &str, profile: &str) -> Fit {
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
mod tests {
    use super::*;

    fn all(text: &str) -> Vec<String> {
        atoms(text, &Vocab::all())
    }

    /// SAFe is scaled agile work (the safe operating area of power electronics is none), the
    /// general ledger the Hauptbuch, cost centres their accounting, FICO the FI module.
    #[test]
    fn scaled_agile_ledger_cost_centres_and_fico() {
        assert_eq!(all("SAFe"), all("Scaled Agile Framework"));
        assert_eq!(all("SAFe"), all("Agile Skalierung"));
        assert_ne!(all("Safe Operating Area"), all("SAFe"));
        assert_eq!(all("Hauptbuch"), all("General Ledger"));
        assert_eq!(all("Kostenstellen"), all("Kostenstellenrechnung"));
        assert!(
            all("SAP FICO").contains(&"fi".to_owned()),
            "{:?}",
            all("SAP FICO")
        );
    }

    /// `Integration` and `Central` alone are too broad: `Post-Merger-Integration` does not
    /// meet integration technologies, `Central Finance` not `Employee Central`.
    #[test]
    fn integration_and_central_alone_meet_nothing() {
        assert_eq!(fit("integration", "post-merger-integration"), Fit::None);
        assert_eq!(fit("central", "central-finance"), Fit::None);
        assert_eq!(
            fit("post-merger-integration", "post-merger-integration"),
            Fit::Equal
        );
    }

    /// English process words are their German concepts; an AI tool meets AI in half; a
    /// programme is half a project.
    #[test]
    fn process_words_ai_tools_and_programmes() {
        assert_eq!(all("Process Optimization"), all("Prozessoptimierung"));
        assert_eq!(all("process improvement"), all("Prozessoptimierung"));
        assert_eq!(all("Automation"), all("Automatisierung"));
        assert_eq!(all("Quality Management"), all("Qualitätsmanagement"));
        assert_eq!(fit("ki", "chatgpt"), Fit::General);
        assert_eq!(fit("chatgpt", "ki"), Fit::None);
        assert_eq!(fit("programmmanagement", "projektmanagement"), Fit::General);
    }

    /// A German hyphen ellipsis reads as the words it stands for; one whose head is unknown
    /// stays as written.
    #[test]
    fn hyphen_ellipses_are_written_out() {
        assert_eq!(
            all("Projekt- und Programmmanagement"),
            all("Projektmanagement und Programmmanagement")
        );
        assert_eq!(
            all("Risiko-, Issue- und Eskalationsmanagement"),
            all("Risikomanagement, Issuemanagement und Eskalationsmanagement")
        );
        assert_eq!(
            all("Projektplanung und -controlling"),
            all("Projektplanung und Projektcontrolling")
        );
        assert_eq!(
            all("HW- und SW-Entwicklungsteams"),
            all("HW-Entwicklungsteams und SW-Entwicklungsteams")
        );
        assert_eq!(
            all("Erfahrung im Utilities-/Energieumfeld"),
            all("Erfahrung im Utilitiesumfeld / Energieumfeld")
        );
        assert_eq!(
            all("E-Mail- und Telefonsupport"),
            ["e-mail", "telefonsupport"]
        );
    }

    #[test]
    fn stemming_and_concepts() {
        assert_eq!(all("Mehrjährige Erfahrung im Controlling"), ["controll"]);
        assert_eq!(
            all("Several years of experience in controlling"),
            ["controll"]
        );
        assert_eq!(
            all("Erfahrung mit Monatsabschlüssen"),
            all("Monatsabschlüsse")
        );
        assert_eq!(
            all("Solid knowledge of IFRS group accounting"),
            ["ifrs", "konzernrechnungslegung"]
        );
        assert_eq!(all("Restrukturierungen"), all("Restrukturierung"));
        assert_eq!(all("Shared Service Centern"), all("Shared Service Center"));
        assert_eq!(all("SAP FI/CO"), ["sap", "fi", "co"]);
        assert_eq!(all("M&A-Transaktionen"), ["m&a-transaktion"]);
        assert!(!all("Müller GmbH & Co. KG").contains(&"co".to_owned()));
    }

    /// Bilingual pairs and paraphrases seen in finance ads meet in one concept.
    #[test]
    fn finance_paraphrases() {
        let same = [
            ("Month-end closing", "Monatsabschluss"),
            ("monthly close", "Monatsabschlüsse"),
            ("Year-end closing", "Jahresabschluss"),
            ("Consolidated financial statements", "Konzernabschluss"),
            ("Group controlling", "Konzerncontrolling"),
            ("Group reporting", "Konzernreporting"),
            ("Financial Planning & Analysis", "FP&A"),
            ("Mergers & Acquisitions", "M&A"),
            ("Liquidity planning", "Liquiditätsplanung"),
            ("Cash Management", "Liquiditätssteuerung"),
            ("Variance analysis", "Abweichungsanalyse"),
            ("Soll-Ist-Vergleich", "Abweichungsanalyse"),
            ("Cost center accounting", "Kostenstellenrechnung"),
            ("General Ledger", "Hauptbuchhaltung"),
            ("Accounts payable", "Kreditorenbuchhaltung"),
            ("Asset accounting", "Anlagenbuchhaltung"),
            ("FI-AA", "Anlagenbuchhaltung"),
            ("CO-PA", "Ergebnisrechnung"),
            ("Berichtswesen", "Reporting"),
            ("Hochrechnung", "Forecast"),
            ("Carve out", "Carve-out"),
            ("Post Merger Integration", "PMI"),
            ("Restructuring", "Restrukturierung"),
            ("Finance Business Partner", "Finance Business Partnering"),
            ("German GAAP", "HGB"),
            ("Interim Manager", "Interim Management"),
            ("Interim-Mandat", "Interim Management"),
            ("Accruals", "Abgrenzungen"),
        ];
        for (a, b) in same {
            assert_eq!(all(a), all(b), "{a} / {b}");
        }
    }

    /// False friends: these must not meet each other fully.
    #[test]
    fn anti_pairs() {
        let full = |job: &str, profile: &str| {
            let profile = all(profile);
            all(job).iter().any(|j| {
                profile
                    .iter()
                    .any(|p| matches!(fit(j, p), Fit::Equal | Fit::Specific))
            })
        };
        let pairs = [
            ("Steuerung", "Steuern"),
            ("SAP Business Partner", "Finance Business Partnering"),
            ("Standortkonsolidierung", "Konsolidierung"),
            ("Produktionsplanung", "Unternehmensplanung"),
            ("Change Requests", "Changemanagement"),
            ("Hochschulabschluss", "Jahresabschlüsse"),
            ("Projektmanagement", "Management Accounting"),
            ("Rechnungsprüfung", "Rechnungslegung"),
        ];
        for (job, profile) in pairs {
            assert!(!full(job, profile), "{job} met by {profile}");
        }
    }

    /// Packs switch on by the profile's competences; the core works alone.
    #[test]
    fn packs_follow_the_profile() {
        let finance = Vocab::for_texts(["Controlling", "Konzernrechnungslegung nach IFRS"]);
        assert_eq!(finance.packs(), ["finance"]);
        let sap = Vocab::for_texts(["SAP FI", "SAP S/4HANA", "Datenmigration", "Jira"]);
        assert_eq!(sap.packs(), ["sap", "itProject"]);
        // One stray trigger switches on no pack: the HR profile gets no finance pack.
        let hr = Vocab::for_texts(["Recruiting", "Arbeitsrecht", "Budgetverantwortung"]);
        assert_eq!(hr.packs(), ["hr"]);
        let clinical = Vocab::for_texts(["Klinische Studien", "Clinical Trial Management"]);
        assert!(clinical.packs().is_empty());
        assert_ne!(
            atoms("group accounting", &clinical),
            atoms("group accounting", &finance)
        );
        assert_eq!(
            atoms("project management", &clinical),
            atoms("Projektmanagement", &clinical)
        );
    }

    #[test]
    fn codes_gender_forms_and_near_equivalents() {
        assert_eq!(all("HGB/IFRS"), all("HGB IFRS"));
        assert_eq!(all("S/4HANA"), all("S/4HANA"));
        assert_eq!(all("Personalleiter:in"), all("Personalleiter"));
        assert_eq!(all("Berater*innen"), all("Berater"));
        assert_eq!(all("Controller/in (m/w/d)"), all("Controller"));
        let a = |s: &str| all(s).remove(0);
        assert_eq!(
            fit(&a("Projektleitungserfahrung"), &a("Projektmanagement")),
            Fit::General
        );
        assert_eq!(
            fit(&a("Projektmanagement"), &a("Projektleitung")),
            Fit::General
        );
    }

    /// A compound needs a real modifier: `Herstellung` is no `Erstellung`.
    #[test]
    fn leading_roles_are_one_concept() {
        let has = |text: &str, atom: &str| all(text).iter().any(|a| a == atom);
        assert!(has("Head of Finance", "cfo"));
        assert!(has("VP Finance", "cfo"));
        assert!(has("Leitung Finanzen", "cfo"));
        assert!(has("Chief Commercial Officer", "vertriebsleitung"));
        assert!(has("Commercial Director", "vertriebsleitung"));
        assert!(has("Leiter IT", "it-leitung"));
        // The rank words alone name no field.
        for word in ["Head", "Chief", "Officer", "Director"] {
            assert!(all(word).iter().all(|a| is_generic(a)), "{word}");
        }
    }

    #[test]
    fn compound_boundaries() {
        let a = |s: &str| all(s).remove(0);
        // A hyphen marks a compound however short its modifier; a verbal particle is none.
        assert_eq!(fit(&a("IT-Carve-out"), &a("Carve-out")), Fit::General);
        assert_eq!(fit(&a("Führung"), &a("Einführung")), Fit::None);
        assert_eq!(fit(&a("Führung"), &a("Durchführung")), Fit::None);
        assert_eq!(fit(&a("Führung"), &a("Buchführung")), Fit::None);
        // `Führung` is never met inside a word with a particle, also after a hyphen or a
        // modifier (`HRIS-Einführung`, `Markteinführung`); a real modifier stays a compound.
        assert_eq!(fit(&a("Führung"), &a("HRIS-Einführung")), Fit::None);
        assert_eq!(fit(&a("Führung"), &a("Markteinführung")), Fit::None);
        assert_eq!(fit(&a("Führung"), &a("Ausführung")), Fit::None);
        assert_eq!(fit(&a("HRIS-Einführung"), &a("Führung")), Fit::None);
        assert_eq!(fit(&a("Führung"), &a("Teamführung")), Fit::Specific);
        // The linking `s` of a compound changes nothing (`Leistung` is no `Leitung`).
        assert_eq!(fit(&a("Werksleiter"), &a("Werkleiter")), Fit::Equal);
        assert_eq!(fit(&a("Werkleiter"), &a("Werksleiter")), Fit::Equal);
        assert_eq!(fit(&a("Leistung"), &a("Leitung")), Fit::None);
        assert_eq!(all("Konzernrechnung"), all("Konzernrechnungslegung"));
        // `Unternehmen` and `Partner` are too broad to meet anything alone.
        assert!(is_generic(&a("Unternehmen")));
        assert!(is_generic(&a("Partner")));
        assert_eq!(fit(&a("Herstellung"), &a("Erstellung")), Fit::None);
        assert_eq!(fit(&a("Erstellung"), &a("Herstellung")), Fit::None);
        assert_eq!(fit(&a("Tourenplanung"), &a("Planung")), Fit::General);
        // `Erstellung` alone is too broad: it reaches no compound (`Berichterstellung`).
        assert_eq!(fit(&a("Berichterstellung"), &a("Erstellung")), Fit::None);
    }

    /// `SQL-Kenntnisse` is SQL; `ISO 9001` and `ISO 13485` differ; short skills stay.
    #[test]
    fn codes_numbers_and_short_skills() {
        assert_eq!(all("SQL-Kenntnisse"), all("SQL"));
        assert_eq!(all("IFRS-Kenntnisse"), all("IFRS"));
        assert_eq!(all("CAPA-Erfahrung"), all("CAPA"));
        assert_eq!(all("SAP-Know-how"), all("SAP"));
        assert_eq!(all("ISO 9001"), ["iso-9001"]);
        assert_ne!(all("ISO 13485"), all("ISO 9001"));
        assert_eq!(all("ISO-9001"), all("ISO 9001:2015"));
        assert!(all("EU GMP Annex 1").contains(&"annex-1".to_owned()));
        assert_ne!(all("Annex 11"), all("Annex 1"));
        for short in ["R", "Go", "5S", "8D", "ML", "VP"] {
            assert_eq!(all(short).len(), 1, "{short}");
        }
        assert_eq!(all("IQ/OQ/PQ").len(), 3);
        assert_eq!(all("CI/CD").len(), 2);
    }

    /// Lexicon terms with a stopword, filler or short word match with spaces too.
    #[test]
    fn multiword_terms_across_dropped_words() {
        assert_eq!(all("US GAAP"), all("US-GAAP"));
        assert_eq!(all("Order to Cash"), all("Order-to-Cash"));
        assert_eq!(all("Working Capital"), all("Working-Capital-Management"));
        assert_eq!(all("Year End Closing"), all("Jahresabschluss"));
        assert_eq!(all("React Native"), all("React-Native"));
        assert_eq!(all("React Native").len(), 1);
        assert_eq!(all("Customer Experience"), all("Customer-Experience"));
        assert_eq!(all("Customer Experience").len(), 1);
        assert_eq!(all("Job Evaluation"), all("Stellenbewertung"));
        assert_eq!(all("General Counsel"), ["leitung-recht"]);
        // Spellings the error analysis found: words apart, a space in a code, a typo.
        assert_eq!(all("Projekt Management"), all("Projektmanagement"));
        assert_eq!(all("SAP S/4 HANA"), all("SAP S/4HANA"));
        assert_eq!(all("sehr gute Kentnisse in SAP FI"), all("SAP FI"));
    }

    #[test]
    fn compounds() {
        let a = |s: &str| all(s).remove(0);
        assert_eq!(
            fit(&a("Konzernkonsolidierung"), &a("Konsolidierung")),
            Fit::Equal
        );
        assert_eq!(
            fit(&a("Restrukturierungsumfeld"), &a("Restrukturierung")),
            Fit::Equal
        );
        assert_eq!(fit(&a("Carve-out-Projekten"), &a("Carve-out")), Fit::Equal);
        assert_eq!(
            fit(&a("Finanztransformation"), &a("Transformation")),
            Fit::Equal
        );
        assert_eq!(
            fit(&a("Beteiligungscontrolling"), &a("Controlling")),
            Fit::General
        );
        assert_eq!(
            fit(&a("Projektleitung"), &a("SAP-Projektleitung")),
            Fit::Specific
        );
        assert_eq!(fit(&a("Management"), &a("Interim-Management")), Fit::None);
        assert_eq!(fit(&a("Projektmanagement"), &a("Management")), Fit::None);
    }

    #[test]
    fn tables_are_sorted_and_folded() {
        for table in [
            lex::FILLERS,
            lex::GENERIC_ATOMS,
            lex::LIGHT_MODIFIERS,
            lex::LIGHT_HEADS,
            lex::SOFT_SKILLS,
            lex::FRAME_WORDS,
            lex::LOCATION_NOISE,
            lex::GERMAN_CITIES,
        ] {
            assert!(table.windows(2).all(|w| w[0] < w[1]), "{table:?}");
            assert!(table.iter().all(|w| fold(w) == *w), "{table:?}");
        }
        for domain in DOMAINS {
            assert!(
                domain.triggers.windows(2).all(|w| w[0] < w[1]),
                "{}",
                domain.name
            );
            for (key, value) in domain.concepts {
                assert_eq!(fold(key), *key, "{}", domain.name);
                assert_eq!(fold(value), *value, "{}", domain.name);
            }
        }
    }
}
