//! The terms of the deep search (user decision 2026-10-01: "tief und viel"), derived from the
//! profile alone when a fetch starts (2026-10-03: no search terms of their own): each target
//! role, the role without its contract words (`Interim CFO` -> `CFO`), the other names job
//! boards give it (the engine's role table, `matching::lexicon::wishes::ROLE_GROUPS`) and its
//! ESCO occupation's German and English name (`Contact Center Manager` -> `Leiter des
//! Kundendienstes`); then the Schwerpunkte, the competences (the longest experience first) and
//! the tools - each once, at most [`MAX_DEEP_TERMS`]. A competence or a tool the engine finds
//! too broad to search alone (`Projektmanagement`, `Personalführung`, `SAP`,
//! `matching::broad_search_term`) is left out: roles and specialities go first. A phrase of more
//! than [`MAX_TERM_WORDS`] words finds little on a job board and is left out too.

use super::form::ProfileForm;

/// So many terms the deep search asks each source for at most.
pub const MAX_DEEP_TERMS: usize = 24;
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

/// Whether `text` names `name` as whole words (both as [`key`]s).
fn names(text: &str, name: &str) -> bool {
    let words: Vec<&str> = text.split([' ', '-', '/', ',']).collect();
    let wanted: Vec<&str> = name.split([' ', '-', '/', ',']).collect();
    words
        .windows(wanted.len())
        .any(|window| window == wanted.as_slice())
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

/// The other names of every role group `text` names.
fn other_names(text: &str) -> impl Iterator<Item = &'static str> {
    let text = key(text);
    crate::matching::lexicon::wishes::ROLE_GROUPS
        .iter()
        .filter(move |group| group.iter().any(|name| names(&text, &key(name))))
        .flat_map(|group| group.iter().copied())
}

/// The deep search's terms for a profile form, in the order they are asked for.
pub fn deep_search_terms(form: &ProfileForm) -> Vec<String> {
    let mut terms = Terms::default();
    for role in &form.roles {
        terms.add(role);
        let core = core(role);
        if let Some(core) = &core {
            terms.add(core);
        }
        for name in other_names(role) {
            terms.add(name);
        }
        let occupation = crate::matching::occupation_names(core.as_deref().unwrap_or(role));
        for name in &occupation {
            terms.add(name);
        }
    }
    for focus in form.focus() {
        terms.add_specific(&focus.name);
        for name in other_names(&focus.name) {
            terms.add(name);
        }
    }
    let mut competences: Vec<_> = form.competences.iter().collect();
    competences.sort_by_key(|competence| std::cmp::Reverse(competence.years.unwrap_or(0)));
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
            || self.list.len() >= MAX_DEEP_TERMS
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
        assert!(terms.len() <= MAX_DEEP_TERMS);
    }

    #[test]
    fn at_most_so_many_and_an_empty_profile_searches_nothing() {
        assert!(deep_search_terms(&ProfileForm::default()).is_empty());
        let form = ProfileForm {
            tools: (0..60).map(|n| format!("Thema {n}")).collect(),
            ..ProfileForm::default()
        };
        assert_eq!(deep_search_terms(&form).len(), MAX_DEEP_TERMS);
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
        assert!(names(&key("Interim CFO (m/w/d)"), "cfo"));
        assert!(!names(&key("CFOs Assistenz"), "cfo"));
        assert_eq!(core("Interim CFO"), Some("CFO".to_owned()));
        assert_eq!(core("CFO"), None);
        assert_eq!(core("Interim"), None);
    }
}
