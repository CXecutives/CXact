//! Target roles (`wunschrollen`, `ENGINE_VERSION` 4): job titles the consultant wants. Off
//! without any.
//!
//! Role and title are compared with the title-fit machinery (folding, stems, concepts,
//! compounds) after a few role paraphrases (`Chief Financial Officer` = `CFO`,
//! `Leiter Finanzen` = `Head of Finance`). A role is its topic atoms plus a lead flag
//! (`Head`, `Leiter`, `Leitung`, `Director`, ...) and contract words (`Interim`):
//! - full: every topic atom is in the title (equal), a lead role meets a lead title, the
//!   contract words are in the title, the contract is interim or a contract type the
//!   profile allows (21: `Interim Head of Customer Service` fits a permanent `Leiter
//!   Kundenservice` in full when Festanstellung is allowed, its factor is cost enough), and
//!   the title is no junior title;
//! - half: every topic atom is in the title, but one of the other conditions fails or an
//!   atom only fits as a narrower or wider compound;
//! - none otherwise, and always when a role of generic words only (`Head of Finance`)
//!   meets a title that names a specific topic of its own (`S/4HANA Finance Lead`).
//!
//! The best role is a signal of the learned scorer (`signals`: in full or in half) before
//! the caps, so it never lifts an off-field ad over its cap and never touches an exclusion.

use std::sync::LazyLock;

use super::atoms::{self, Fit, Vocab, fold, raw_tokens};
use super::contract::ContractKind;
use super::fit::Broad;
use super::graph;
use super::lexicon::esco::Kind;
use super::lexicon::{self, wishes as lex};
use super::normalize::contains_word;
use super::seniority::junior_title;
use crate::profile::{ProfileForm, key};

/// A target role as the engine compares it.
#[derive(Debug, Clone)]
pub(crate) struct Role {
    /// As written in the profile.
    pub text: String,
    /// JSON path, e.g. `wunschrollen[0]`.
    pub path: String,
    topic: Vec<String>,
    contract: Vec<String>,
    lead: bool,
    /// At least one topic atom is specific (not generic).
    specific: bool,
    /// The occupations ESCO names in it.
    occupations: Broad,
    /// Its level on the ladder of `title.rs` (engine 23).
    level: Option<u8>,
}

/// The parts of a role or a title.
struct Parts {
    topic: Vec<String>,
    contract: Vec<String>,
    lead: bool,
}

/// A folded text with the word paraphrases applied (whole words).
fn paraphrased(text: &str) -> String {
    let mut folded = fold(text);
    for (phrase, replacement) in lex::ROLE_WORD_PHRASES {
        if contains_word(&folded, phrase) {
            folded = replace_words(&folded, phrase, replacement);
        }
    }
    folded
}

/// Every name of a role group as the engine reads it, with the group's first name, the
/// longest first (`lex::ROLE_GROUPS`).
static ROLE_NAMES: LazyLock<Vec<(String, String)>> = LazyLock::new(|| {
    let mut names: Vec<(String, String)> = lex::ROLE_GROUPS
        .iter()
        .flat_map(|group| {
            let first = paraphrased(group[0]);
            group[1..]
                .iter()
                .map(move |name| (paraphrased(name), first.clone()))
        })
        .collect();
    names.sort_by_key(|(name, _)| std::cmp::Reverse(name.len()));
    names
});

/// Folds a role or title and applies the paraphrases and the role names (whole words).
fn normalise(text: &str) -> String {
    let mut folded = paraphrased(text);
    for (name, first) in ROLE_NAMES.iter() {
        if contains_word(&folded, name) {
            folded = replace_words(&folded, name, first);
        }
    }
    folded
}

/// Replaces whole-word occurrences of `phrase`.
fn replace_words(text: &str, phrase: &str, replacement: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(at) = rest.find(phrase) {
        let end = at + phrase.len();
        let before = rest[..at]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphanumeric());
        let after = rest[end..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_alphanumeric());
        out.push_str(&rest[..at]);
        out.push_str(if before && after { replacement } else { phrase });
        rest = &rest[end..];
    }
    out.push_str(rest);
    out
}

fn parts(text: &str, vocab: &Vocab) -> Parts {
    let folded = normalise(text);
    let tokens: Vec<&str> = raw_tokens(&folded).collect();
    let lead = tokens
        .iter()
        .any(|t| lex::LEAD_WORDS.contains(t) || lex::LEAD_ENDINGS.iter().any(|e| t.ends_with(e)));
    let contract: Vec<String> = tokens
        .iter()
        .filter(|t| lex::ROLE_CONTRACT_WORDS.contains(t))
        .map(|t| (*t).to_owned())
        .collect();
    let rest: Vec<&str> = tokens
        .iter()
        .filter(|t| {
            !lex::LEAD_WORDS.contains(t)
                && !lex::LEVEL_WORDS.contains(t)
                && !lex::ROLE_CONTRACT_WORDS.contains(t)
                && !lexicon::engine::JUNIOR_TITLES.contains(t)
        })
        .copied()
        .collect();
    Parts {
        topic: atoms::atoms(&rest.join(" "), vocab).to_vec(),
        contract,
        lead,
    }
}

/// The target roles of a profile (`wunschrollen`); a role without words of a topic
/// (`Interim`) is none.
pub(crate) fn read(form: &ProfileForm, vocab: &Vocab) -> Vec<Role> {
    form.roles
        .iter()
        .enumerate()
        .filter_map(|(i, text)| {
            let p = parts(text, vocab);
            (!p.topic.is_empty()).then(|| Role {
                specific: p.topic.iter().any(|a| !atoms::is_generic(a)),
                occupations: occupations(text, vocab),
                level: super::title::level_of(text),
                path: format!("{}[{i}]", key::ROLES),
                text: text.clone(),
                topic: p.topic,
                contract: p.contract,
                lead: p.lead,
            })
        })
        .collect()
}

/// The occupations ESCO names in a role or a title, its contract words left out (`Interim`
/// says nothing about the occupation).
fn occupations(text: &str, vocab: &Vocab) -> Broad {
    let folded = fold(text);
    let words: Vec<&str> = folded
        .split_whitespace()
        .filter(|w| !lex::ROLE_CONTRACT_WORDS.contains(w))
        .collect();
    Broad::of(&words.join(" "), vocab, &[Kind::Occupation])
}

/// The best target role for a title: its index and whether it fits in full.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct RoleFit {
    pub role: usize,
    pub full: bool,
}

/// How one role fits a title: `None`, `Some(false)` half, `Some(true)` full; `contract_ok`:
/// the ad's contract needs no contract word of the role (interim, or a type the profile
/// allows).
fn role_fit(
    role: &Role,
    title: &Parts,
    (junior, level): (bool, Option<u8>),
    contract_ok: bool,
) -> Option<bool> {
    let mut full = true;
    for atom in &role.topic {
        let best = title
            .topic
            .iter()
            .map(|t| graph::fit(t, atom))
            .max()
            .unwrap_or(Fit::None);
        match best {
            Fit::Equal => {}
            Fit::General | Fit::Specific => full = false,
            Fit::None => return None,
        }
    }
    if role
        .contract
        .iter()
        .any(|c| !contract_ok && !title.contract.contains(c))
    {
        full = false;
    }
    if (role.lead && !title.lead) || junior {
        full = false;
    }
    // A full fit needs the role's level (engine 23): a team lead is no head of the field.
    if let (Some(title_level), Some(role_level)) = (level, role.level)
        && title_level < role_level
    {
        full = false;
    }
    // A role of generic words only (`Head of Finance`) is another role when the title
    // names a specific topic of its own (`S/4HANA Finance Lead`, `FP&A`).
    let extra = title.topic.iter().any(|t| {
        !atoms::is_generic(t) && !role.topic.iter().any(|r| graph::fit(t, r) != Fit::None)
    });
    if !role.specific && extra {
        return None;
    }
    Some(full)
}

/// The atoms of the words of lead, level, contract, junior roles and the role's shape,
/// sorted: what a title says beside its core ([`title_core`]).
pub(crate) fn shape(vocab: &Vocab) -> Vec<String> {
    let mut shape: Vec<String> = lex::LEAD_WORDS
        .iter()
        .chain(lex::LEVEL_WORDS)
        .chain(lex::ROLE_CONTRACT_WORDS)
        .chain(lex::ROLE_SHAPE_WORDS)
        .chain(lexicon::engine::JUNIOR_TITLES)
        .flat_map(|w| atoms::atoms(w, vocab).to_vec())
        .collect();
    shape.sort();
    shape.dedup();
    shape
}

/// The core of a title (engine 24): its specific atoms without the words of its `shape`
/// ([`shape`]). An open must on them is an open core.
pub(crate) fn title_core(title: &str, vocab: &Vocab, shape: &[String]) -> Vec<String> {
    atoms::atoms(title, vocab)
        .iter()
        .filter(|a| !atoms::is_generic(a) && shape.binary_search(a).is_err())
        .cloned()
        .collect()
}

/// The topic atoms of every target role (what a title may name).
pub(crate) fn topics(roles: &[Role]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for role in roles {
        for atom in &role.topic {
            if !atoms::is_generic(atom) && !out.contains(atom) {
                out.push(atom.clone());
            }
        }
    }
    out
}

/// The best target role for a job title (full before half, profile order on a tie);
/// `allowed`: the profile allows the ad's contract type; `level`: the ad's level (a full fit
/// needs at least the role's).
pub(crate) fn best(
    roles: &[Role],
    title: &str,
    vocab: &Vocab,
    (contract, allowed): (ContractKind, bool),
    level: Option<u8>,
) -> Option<RoleFit> {
    if roles.is_empty() {
        return None;
    }
    let parts = parts(title, vocab);
    let junior = junior_title(title);
    let contract_ok = contract == ContractKind::Interim || allowed;
    let fits: Vec<(usize, bool)> = roles
        .iter()
        .enumerate()
        .filter_map(|(i, role)| {
            role_fit(role, &parts, (junior, level), contract_ok).map(|full| (i, full))
        })
        .collect();
    let best = fits
        .iter()
        .find(|(_, full)| *full)
        .or_else(|| fits.first())
        .map(|&(role, full)| RoleFit { role, full });
    if best.is_some() {
        return best;
    }
    // ESCO, the broad layer: the title names an occupation of a role (half, it is ESCO's
    // word alone).
    let title = occupations(title, vocab);
    roles
        .iter()
        .position(|role| title.names(&role.occupations))
        .map(|role| RoleFit { role, full: false })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn form(roles: &[&str]) -> ProfileForm {
        ProfileForm {
            roles: roles.iter().map(|r| (*r).to_owned()).collect(),
            ..ProfileForm::default()
        }
    }

    fn fit(roles: &[&str], title: &str, contract: ContractKind) -> Option<(String, bool)> {
        let vocab = Vocab::all();
        let read = read(&form(roles), &vocab);
        assert_eq!(read.len(), roles.len());
        best(&read, title, &vocab, (contract, false), None)
            .map(|f| (read[f.role].text.clone(), f.full))
    }

    #[test]
    fn titles_against_target_roles() {
        use ContractKind::{Interim, Permanent};
        let roles = [
            "Interim CFO",
            "Head of Finance",
            "Leitung Konzernrechnungswesen",
        ];
        let full = |title, contract| fit(&roles, title, contract).filter(|(_, full)| *full);
        let half = |title, contract| fit(&roles, title, contract).filter(|(_, full)| !*full);
        assert_eq!(
            full("Interim CFO (m/w/d)", Interim).unwrap().0,
            "Interim CFO"
        );
        // A freelance portal's CFO project is interim without the word.
        assert!(full("CFO (m/w/d)", Interim).is_some());
        // A permanent CFO is half of an interim CFO, full where the profile allows
        // Festanstellung.
        assert!(half("Chief Financial Officer (m/w/d)", Permanent).is_some());
        let vocab = Vocab::all();
        let read = read(&form(&roles), &vocab);
        let allowed = best(
            &read,
            "Chief Financial Officer (m/w/d)",
            &vocab,
            (Permanent, true),
            None,
        );
        assert_eq!(
            allowed,
            Some(RoleFit {
                role: 0,
                full: true
            })
        );
        assert_eq!(
            full("Head of Finance (m/w/d)", Permanent).unwrap().0,
            "Head of Finance"
        );
        assert!(full("Leiter Finanzen (m/w/d)", Permanent).is_some());
        assert!(full("Leitung Konzernrechnungswesen (m/w/d)", Permanent).is_some());
        // The field without the lead level, or a junior title.
        assert!(half("Projekt im Konzernrechnungswesen", Interim).is_some());
        assert!(half("Interim Finance Manager", Interim).is_some());
        assert!(half("Junior Head of Finance", Permanent).is_some());
        // A generic role is another role when the title names a specific topic.
        let other = |title| fit(&roles, title, Interim);
        assert_eq!(other("Interim SAP S/4HANA Finance Lead (Contract)"), None);
        assert_eq!(other("Director Finance Transformation (m/w/d)"), None);
        assert_eq!(
            fit(&roles, "Head of Group Controlling (m/w/d)", Permanent),
            None
        );
        assert_eq!(
            fit(&roles, "Leiter Konzerncontrolling (Interim)", Interim),
            None
        );
        assert_eq!(fit(&roles, "SAP MM Berater (m/w/d)", Interim), None);
    }

    #[test]
    fn specific_roles_allow_more_words_in_the_title() {
        let roles = ["SAP FI/CO Berater", "S/4HANA Finance Lead"];
        let full = |title| {
            fit(&roles, title, ContractKind::Interim)
                .filter(|(_, full)| *full)
                .map(|(role, _)| role)
        };
        assert_eq!(
            full("SAP FI/CO Berater (m/w/d) für S/4HANA-Migration").as_deref(),
            Some("SAP FI/CO Berater")
        );
        assert_eq!(
            full("Interim SAP S/4HANA Finance Lead (Contract)").as_deref(),
            Some("S/4HANA Finance Lead")
        );
        assert_eq!(
            fit(
                &roles,
                "SAP SD Inhouse-Berater (m/w/d)",
                ContractKind::Interim
            ),
            None
        );
    }

    /// Every name of a role group is the same role to the engine.
    #[test]
    fn the_names_of_a_group_are_one_role() {
        for group in lex::ROLE_GROUPS {
            let first = normalise(group[0]);
            for name in *group {
                assert_eq!(normalise(name), first, "{name}");
            }
        }
        assert_eq!(normalise("Interim Finanzvorständin"), "interim cfo");
    }

    /// A title the engine's own words do not relate to a role, but that names the role's
    /// occupation in ESCO (the role by its preferred label), fits in half.
    #[test]
    fn esco_relates_a_title_to_a_role() {
        let roles = ["Leiter der Buchhaltung"];
        assert_eq!(
            fit(&roles, "Accounting Manager", ContractKind::Permanent),
            Some(("Leiter der Buchhaltung".to_owned(), false))
        );
        assert_eq!(fit(&roles, "Sales Manager", ContractKind::Permanent), None);
    }

    #[test]
    fn a_role_without_a_topic_is_none() {
        let vocab = Vocab::all();
        let roles = read(&form(&["Interim", "CFO"]), &vocab);
        assert_eq!(roles.len(), 1);
        assert_eq!(roles[0].path, "wunschrollen[1]");
        assert!(read(&form(&[]), &vocab).is_empty());
    }
}
