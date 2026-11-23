//! Words and patterns the engine looks for in job ads and profiles.
//!
//! external contract - do not translate: everything in this module is German or English
//! wording of job ads and consultant profiles.

pub(crate) mod domains;
pub(crate) mod engine;
pub(crate) mod esco;
mod tables;
pub(crate) mod terms;
pub(crate) mod wishes;

pub(crate) use tables::*;

/// What a heading line opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeadingKind {
    Must,
    Nice,
    Task,
    Neutral,
}

/// Characters that start a bullet line.
pub(crate) const BULLETS: &[char] = &['-', '*', '•', '·', '▸', '►'];

/// Suffixes that turn a language token into the language (`deutschkenntnisse` -> `deutsch`).
pub(crate) const LANGUAGE_SUFFIXES: &[&str] = &[
    "kenntnisse",
    "kenntnis",
    "sprache",
    "sprachen",
    "sprachkenntnisse",
];

/// Requirement cues in a sentence (fallback without requirement sections).
pub(crate) const CUE_HARD: &str = r"\b(?:vorausgesetzt|erforderlich|benötigt|benoetigt|setzen{S}+wir{S}+voraus|setzt{S}+{NS}+{S}+voraus|voraussetzung{S}+ist|erwarten{S}+wir|abgeschlossenes{S}+studium|studium|hochschulabschluss|abschluss|abgeschlossene{S}+ausbildung|ausbildung|zertifizierung|zertifikat|zertifiziert|mehrjährig|mehrjaehrig|langjährig|langjaehrig|verhandlungssicher|fließend|fliessend|muttersprachlich|sprachkenntnisse|sicherer{S}+umgang|fundierte{S}+kenntnisse|umfassende{S}+kenntnisse|sehr{S}+gute{S}+kenntnisse|gute{S}+kenntnisse|tiefgehende{S}+kenntnisse|praxiserfahrung|berufserfahrung)\b";
/// `Erfahrung ... in/mit/im/von` within 40 characters.
pub(crate) const CUE_EXPERIENCE: &str =
    r"\b(?:erfahrung|erfahrungen|kenntnis|kenntnisse)\b.{0,40}\b(?:in|mit|im|von)\b";
/// Membership test in a sorted table.
pub(crate) fn contains(table: &[&str], word: &str) -> bool {
    table.binary_search(&word).is_ok()
}

/// Canonical form of a token: `Some(None)` drops it, `None` keeps it unchanged.
#[allow(clippy::option_option)] // Mirrors the old table, where `None` is a value.
pub(crate) fn synonym(token: &str) -> Option<Option<&'static str>> {
    SYNONYM_WORDS
        .binary_search_by(|(k, _)| k.cmp(&token))
        .ok()
        .map(|i| SYNONYM_WORDS[i].1)
}

/// Merged token of an adjacent pair.
pub(crate) fn synonym_pair(first: &str, second: &str) -> Option<&'static str> {
    SYNONYM_PAIRS
        .binary_search_by(|(a, b, _)| (*a, *b).cmp(&(first, second)))
        .ok()
        .map(|i| SYNONYM_PAIRS[i].2)
}
