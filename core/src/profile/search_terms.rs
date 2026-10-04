//! The terms of the deep search (user decision 2026-10-01: "tief und viel"), derived from the
//! profile alone when a fetch starts (2026-10-03: no search terms of their own), from its core
//! (2026-10-04, after a live search: generic words alone bring every field's jobs):
//! - each target role, the role without its contract words (`Interim CFO` -> `CFO`), the
//!   other names job boards give it (the engine's role table,
//!   `matching::lexicon::wishes::ROLE_GROUPS`) with the role's own field kept
//!   (`Projektleiter Customer Service` -> `Project Manager Customer Service`, never a bare
//!   `Project Manager`), and its ESCO occupation's German and English name (`Contact Center
//!   Manager` -> `Leiter des Kundendienstes`);
//! - the Schwerpunkte;
//! - the names job boards give the field the roles and Schwerpunkte lie in (`Kundenservice`,
//!   `Contact Center`, `Call Center`: `matching::field_search_terms`);
//! - the competences, those of that field first, the longest experience first; then the
//!   tools.
//!
//! Each once, at most [`MAX_CANDIDATES`]; a search asks for the first [`MAX_DEEP_TERMS`] of them
//! that it has not set aside (`fetch::terms`). A competence or a tool the engine finds too broad to
//! search alone (`Projektmanagement`, `Personalführung`, `Automatisierung`, `SAP`,
//! `matching::broad_search_term`) is left out. A phrase of more than [`MAX_TERM_WORDS`] words
//! finds little on a job board and is left out too.

use super::form::ProfileForm;

/// So many terms the deep search asks each source for at most (`fetch::terms::active_terms`).
pub const MAX_DEEP_TERMS: usize = 24;
/// So many of the profile's terms there are at most: the next ones take the slots of those set
/// aside (`fetch::terms`).
pub const MAX_CANDIDATES: usize = 2 * MAX_DEEP_TERMS;
/// A longer phrase is left out.
const MAX_TERM_WORDS: usize = 4;

/// Words of the contract, not of the role: left out for the role's core.
const CONTRACT_WORDS: &[&str] = &[
    "interim",
    "freelance",
    "freiberuflich",
    "freiberuflicher",
    "befristet",
    "contract",
    "contractor",
    "(m/w/d)",
    "(w/m/d)",
];

/// A term as it is compared: lower case, umlauts as their vowels, single spaces.
fn key(term: &str) -> String {
    term.to_lowercase()
        .replace('ä', "a")
        .replace('ö', "o")
        .replace('ü', "u")
        .replace('ß', "ss")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

/// The role without its contract words (`Interim CFO` -> `CFO`); `None` when nothing is left
/// or nothing was taken.
fn core(role: &str) -> Option<String> {
    let words: Vec<&str> = role.split_whitespace().collect();
    let kept: Vec<&str> = words
        .iter()
        .copied()
        .filter(|word| !CONTRACT_WORDS.contains(&key(word).as_str()))
        .collect();
    (!kept.is_empty() && kept.len() < words.len()).then(|| kept.join(" "))
}

/// Words that join two roles in one (`CFO und Transformationsleitung`).
const JOINING_WORDS: &[&str] = &["und", "and", "&", "/", "sowie"];

/// The other names of the role groups `text` names, with the rest of `text` kept: a name
/// with a field of its own beside it is renamed in place (`Projektleiter Customer Service`
/// -> `Project Manager Customer Service`); a name alone, or joined to another role
/// (`CFO und Transformationsleitung`), brings the other names alone.
fn other_names(text: &str) -> Vec<String> {
    let words: Vec<&str> = text.split_whitespace().collect();
    let keys: Vec<String> = words.iter().map(|w| key(w)).collect();
    let mut out = Vec::new();
    for group in crate::matching::lexicon::wishes::ROLE_GROUPS {
        for name in *group {
            let wanted: Vec<String> = name.split_whitespace().map(key).collect();
            let Some(at) = keys
                .windows(wanted.len())
                .position(|window| window == wanted.as_slice())
            else {
                continue;
            };
            let before = &words[..at];
            let after = &words[at + wanted.len()..];
            // The name stands alone when only contract words are beside it, or a joining word.
            let field = |side: &[&str]| -> Vec<String> {
                side.iter()
                    .map(|w| key(w))
                    .filter(|w| !CONTRACT_WORDS.contains(&w.as_str()))
                    .collect()
            };
            let joins = |w: Option<&String>| w.is_none_or(|w| JOINING_WORDS.contains(&w.as_str()));
            let alone = joins(field(after).first()) && joins(field(before).last());
            if alone {
                out.push((*name).to_owned());
            }
            for other in group.iter().filter(|other| *other != name) {
                out.push(if alone {
                    (*other).to_owned()
                } else {
                    before
                        .iter()
                        .copied()
                        .chain(std::iter::once(*other))
                        .chain(after.iter().copied())
                        .collect::<Vec<_>>()
                        .join(" ")
                });
            }
        }
    }
    out
}

/// The deep search's terms for a profile form, in the order they are asked for (the first
/// [`MAX_DEEP_TERMS`] not set aside, `fetch::terms::active_terms`).
pub fn deep_search_terms(form: &ProfileForm) -> Vec<String> {
    let mut terms = Terms::default();
    for role in &form.roles {
        terms.add(role);
        let core = core(role);
        if let Some(core) = &core {
            terms.add(core);
        }
        let base = core.as_deref().unwrap_or(role);
        for name in other_names(base) {
            terms.add(&name);
        }
        for name in &crate::matching::occupation_names(base) {
            terms.add(name);
        }
    }
    let focus: Vec<&str> = form.focus().map(|f| f.name.as_str()).collect();
    for name in &focus {
        terms.add_specific(name);
    }
    let field = crate::matching::SearchField::of(
        form.roles
            .iter()
            .map(String::as_str)
            .chain(focus.iter().copied()),
    );
    for name in field.map_or(&[][..], |f| f.names()) {
        terms.add(name);
    }
    // The competences of the field first, the longest experience first.
    let mut competences: Vec<_> = form.competences.iter().collect();
    competences.sort_by_cached_key(|c| {
        let of_field = field.is_some_and(|f| f.holds(&c.name));
        (!of_field, std::cmp::Reverse(c.years.unwrap_or(0)))
    });
    for competence in &competences {
        terms.add_specific(&competence.name);
    }
    for tool in &form.tools {
        terms.add_specific(tool);
    }
    terms.list
}

/// The terms gathered so far, each once.
#[derive(Default)]
struct Terms {
    list: Vec<String>,
    seen: std::collections::HashSet<String>,
}

impl Terms {
    /// Adds a term unless the engine finds it too broad to search alone ([`Terms::add`]).
    fn add_specific(&mut self, term: &str) {
        if !crate::matching::broad_search_term(term) {
            self.add(term);
        }
    }

    /// Adds a term unless it is known, too long, empty, or the list is full.
    fn add(&mut self, term: &str) {
        let term = term.trim();
        let words = term.split_whitespace().count();
        if term.chars().count() < 2
            || words > MAX_TERM_WORDS
            || self.list.len() >= MAX_CANDIDATES
            || !self.seen.insert(key(term))
        {
            return;
        }
        self.list.push(term.to_owned());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::profile::ProfileCompetence;

    fn competence(name: &str, years: u32, focus: bool) -> ProfileCompetence {
        ProfileCompetence {
            name: name.to_owned(),
            years: Some(years),
            focus,
        }
    }

    #[test]
    fn roles_with_their_names_then_the_rest() {
        let form = ProfileForm {
            roles: vec!["Interim CFO".into(), "Head of Controlling".into()],
            competences: vec![
                competence("Liquiditätsplanung", 10, false),
                competence("Controlling", 18, false),
                competence("Restrukturierung", 5, true),
                competence(
                    "Rund elf Jahre Treasury, Cash Management und Factoring",
                    11,
                    false,
                ),
            ],
            tools: vec!["SAP S/4HANA".into(), "LucaNet".into()],
            ..ProfileForm::default()
        };
        let terms = deep_search_terms(&form);
        assert_eq!(
            terms[..3],
            [
                "Interim CFO",
                // The role without its contract word, then its other names.
                "CFO",
                "Chief Financial Officer",
            ]
        );
        for wanted in [
            "Finanzvorstand",
            "Kaufmännische Geschäftsführung",
            "Leiter Controlling",
            "Controlling",
            "Liquiditätsplanung",
            "LucaNet",
        ] {
            assert!(terms.iter().any(|t| t == wanted), "{wanted} in {terms:?}");
        }
        // The Schwerpunkte before the competences, the longest experience first among these.
        let at = |t: &str| terms.iter().position(|x| x == t).unwrap();
        assert!(at("Restrukturierung") < at("Controlling"));
        assert!(at("Controlling") < at("Liquiditätsplanung"));
        // A sentence is no search term; every term once, in any case.
        assert!(!terms.iter().any(|t| t.starts_with("Rund elf")));
        let keys: std::collections::HashSet<_> = terms.iter().map(|t| key(t)).collect();
        assert_eq!(keys.len(), terms.len());
        assert!(terms.len() <= MAX_CANDIDATES);
    }

    #[test]
    fn at_most_so_many_and_an_empty_profile_searches_nothing() {
        assert!(deep_search_terms(&ProfileForm::default()).is_empty());
        let form = ProfileForm {
            tools: (0..60).map(|n| format!("Thema {n}")).collect(),
            ..ProfileForm::default()
        };
        assert_eq!(deep_search_terms(&form).len(), MAX_CANDIDATES);
    }

    /// A role ESCO knows brings its occupation's German and English name; a competence or a
    /// tool too broad to search alone stays out, a role never does.
    #[test]
    fn esco_names_and_no_broad_terms() {
        let form = ProfileForm {
            roles: vec!["Contact Center Manager".into(), "Interim Manager".into()],
            competences: vec![
                competence("Projektmanagement", 20, true),
                competence("Personalführung", 15, false),
                competence("Generative KI", 2, false),
                competence("Workforce Management", 8, false),
            ],
            tools: vec!["SAP".into(), "Genesys".into()],
            ..ProfileForm::default()
        };
        let terms = deep_search_terms(&form);
        for wanted in [
            "Contact Center Manager",
            "Leiter des Kundendienstes",
            "contact centre manager",
            "Interim Manager",
            "Workforce Management",
            "Genesys",
        ] {
            assert!(terms.iter().any(|t| t == wanted), "{wanted} in {terms:?}");
        }
        for broad in [
            "Projektmanagement",
            "Personalführung",
            "Generative KI",
            "SAP",
        ] {
            assert!(!terms.iter().any(|t| t == broad), "{broad} in {terms:?}");
        }
    }

    #[test]
    fn a_name_counts_as_whole_words_only() {
        assert!(other_names("Interim CFO (m/w/d)").contains(&"Chief Financial Officer".to_owned()));
        assert!(other_names("CFOs Assistenz").is_empty());
        assert_eq!(core("Interim CFO"), Some("CFO".to_owned()));
        assert_eq!(core("CFO"), None);
        assert_eq!(core("Interim"), None);
    }

    /// A role's other names keep its own field (never a bare `Project Manager`); a name joined
    /// to another role stands alone.
    #[test]
    fn other_names_keep_the_field() {
        assert_eq!(
            other_names("Projektleiter Customer Service"),
            [
                "Projektmanager Customer Service",
                "Project Manager Customer Service"
            ]
        );
        let joined = other_names("CFO und Transformationsleitung");
        assert!(joined.contains(&"CFO".to_owned()), "{joined:?}");
        assert!(joined.contains(&"Finanzvorstand".to_owned()), "{joined:?}");
    }

    /// A head of customer service as a CV names it: the roles with their field, the
    /// Schwerpunkte, the names job boards give the field, then its competences; generic words
    /// stay out.
    #[test]
    fn the_field_of_roles_and_schwerpunkte_is_searched() {
        let form = ProfileForm {
            roles: vec![
                "Interim Head of Customer Service".into(),
                "Projektleiter Customer Service".into(),
            ],
            competences: vec![
                competence("Customer Service Management", 30, true),
                competence("Automatisierung", 8, true),
                competence("Coaching", 20, false),
                competence("Workforce Management", 15, false),
                competence("Training & Weiterbildung", 6, false),
            ],
            ..ProfileForm::default()
        };
        let terms = deep_search_terms(&form);
        for wanted in [
            "Head of Customer Service",
            "Project Manager Customer Service",
            "Kundenservice",
            "Contact Center",
            "Call Center",
            "Beschwerdemanagement",
        ] {
            assert!(terms.iter().any(|t| t == wanted), "{wanted} in {terms:?}");
        }
        for noise in [
            "Projektleiter",
            "Project Manager",
            "Automatisierung",
            "Training & Weiterbildung",
        ] {
            assert!(!terms.iter().any(|t| t == noise), "{noise} in {terms:?}");
        }
        // The field's competences before the others, whatever their years.
        let at = |t: &str| terms.iter().position(|x| x == t).unwrap();
        assert!(at("Workforce Management") < at("Coaching"));
        // A profile without a field of its own searches no field's names.
        let finance = ProfileForm {
            competences: vec![competence("Controlling", 10, false)],
            ..ProfileForm::default()
        };
        assert_eq!(deep_search_terms(&finance), ["Controlling"]);
    }
}
