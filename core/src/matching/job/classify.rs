//! The kind of every item: skill, language, degree, soft, frame or nothing.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

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
            || crate::matching::lexicon::domains::DOMAINS
                .iter()
                .any(|d| d.triggers.iter().any(|p| t.starts_with(p)))
            || crate::matching::lexicon::JOB_SKILL_VOCAB.contains(t)
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

pub(super) fn starts_with_any(atom: &str, stems: &[&str]) -> bool {
    stems.iter().any(|s| atom.starts_with(s))
}

/// Any frame word inside a word (the quick test before the rules of [`frame_word`]).
pub(super) static FRAME_ANY: LazyLock<Regex> = LazyLock::new(|| {
    let words: Vec<String> = lex::FRAME_WORDS.iter().map(|w| regex::escape(w)).collect();
    Regex::new(&words.join("|")).expect("frame words")
});

/// A word with one of `WORD_ENDINGS` (or none) after `stem`.
pub(super) fn ending_after<'w>(word: &'w str, stem: &str) -> Option<&'w str> {
    word.strip_prefix(stem)
        .filter(|rest| rest.is_empty() || lex::WORD_ENDINGS.contains(rest))
}

/// Is `part` one of `heads`, perhaps with an ending?
pub(super) fn is_head(part: &str, heads: &[&str]) -> bool {
    heads.iter().any(|h| ending_after(part, h).is_some())
}

/// The compound head after a modifier (and its linking letters) in `rest`.
pub(super) fn heads_after(rest: &str) -> impl Iterator<Item = &str> {
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
pub(super) fn is_frame(folded: &str, tokens: &[&str]) -> bool {
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
pub(super) fn joined_by_space(folded: &str, first: &str, second: &str) -> bool {
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
pub(super) fn soft_token(folded: &str, tokens: &[&str], i: usize) -> bool {
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
pub(super) const LANGUAGE_ITEM_OTHERS: usize = 4;

pub(super) fn classify(text: &str, phrase_level: Option<u8>, vocab: &Vocab) -> Class {
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
