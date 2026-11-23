//! The frame of a requirement clause: `[pronoun] [verbs] [qualifier] [knowledge noun]
//! [preposition] CORE [verb]`. The frame only says that and how much something is wanted, the
//! core names what: the lead's words never become atoms, a clause about the person is soft
//! unless it asks for knowledge or names a skill, a clause that describes the role or says
//! something is not needed asks for nothing.

#[allow(
    clippy::wildcard_imports,
    reason = "siblings of one reader share its helpers"
)]
use super::*;

/// The tokens of a requirement without its lead: a pronoun and the verbs after it, also a
/// modal (`you have spent several years in x` reads `several years in x`, `Sie sollten
/// Erfahrung in x mitbringen` reads `Erfahrung in x`), and the lead's verbs that close the
/// clause. The lead asks for nothing, its verbs would stay open.
pub(crate) fn without_lead(mut raw: Vec<String>) -> Vec<String> {
    let lead = |w: &String| lex::LEAD_VERBS.binary_search(&w.as_str()).is_ok();
    if !raw
        .first()
        .is_some_and(|w| lex::PRONOUN_STARTS.contains(&w.as_str()))
    {
        return raw;
    }
    let verbs = raw[1..].iter().take_while(|w| lead(w)).count();
    if verbs > 0 {
        raw.drain(..=verbs);
        while raw.last().is_some_and(lead) {
            raw.pop();
        }
    }
    raw
}

/// A sentence about the person, not a skill: it starts with a pronoun (`Sie`, `Du`, `You`), asks
/// for no knowledge and names no known skill (`Sie kommunizieren klar, auch wenn es unbequem
/// wird`); `Sie haben Erfahrung mit Lieferantenverhandlungen` asks for knowledge.
pub(super) fn soft_sentence(phrase: &str) -> bool {
    let folded = fold(phrase);
    let mut tokens = atoms::raw_tokens(&folded);
    let pronoun = tokens
        .next()
        .is_some_and(|first| lex::PRONOUN_STARTS.contains(&first));
    pronoun
        && !tokens.any(|t| lex::KNOWLEDGE_STEMS.iter().any(|k| t.starts_with(k)))
        && !known_skill(phrase)
}

/// A sentence that describes the role or the search, no skill (`lex::DESCRIPTION_STARTS`).
pub(super) fn describes_role(phrase: &str) -> bool {
    let folded = fold(phrase);
    lex::DESCRIPTION_STARTS
        .iter()
        .any(|w| folded.starts_with(w))
}

/// An item that says something is not needed (`Keine SAP-Kenntnisse erforderlich`).
pub(super) fn not_needed(item: &str) -> bool {
    let folded = fold(item);
    lex::NOT_NEEDED.iter().any(|w| folded.contains(w))
        || folded.starts_with("kein ")
        || folded.starts_with("keine ")
}
