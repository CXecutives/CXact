//! The terms of the deep search (user decision 2026-10-01: "tief und viel"): what the
//! sources are searched for, built from the profile when a fetch starts. The consultant's own
//! Suchbegriffe (or the proposal from roles and Schwerpunkte) come first, as written; then
//! each target role, the role without its contract words (`Interim CFO` -> `CFO`) and the
//! other names job boards give it (`CFO` -> `Finanzvorstand`, `Head of Finance`); then the
//! Schwerpunkte, the competences (the longest experience first) with their synonyms, the
//! Stichworte and the tools - each once, at most [`MAX_DEEP_TERMS`]. A phrase of more than
//! [`MAX_TERM_WORDS`] words finds little on a job board and is left to the consultant's own
//! terms.
//!
//! The role names below are an external contract - do not translate: they are the words the
//! job boards use.

use super::form::ProfileForm;

/// So many terms the deep search asks each source for at most.
pub const MAX_DEEP_TERMS: usize = 24;
/// A longer phrase (from the competences, not the consultant's own terms) is left out.
const MAX_TERM_WORDS: usize = 4;

/// Names of one role as job boards write them, each group searched together: a role, focus
/// or competence that names one of them (as whole words, in any case) brings the others.
const ROLE_NAMES: &[&[&str]] = &[
    &[
        "CFO",
        "Chief Financial Officer",
        "Finanzvorstand",
        "Kaufmännischer Geschäftsführer",
        "Kaufmännischer Leiter",
        "Head of Finance",
        "Finance Director",
        "Leiter Finanzen",
    ],
    &[
        "Head of Controlling",
        "Leiter Controlling",
        "Controlling Manager",
    ],
    &[
        "Head of Accounting",
        "Leiter Rechnungswesen",
        "Leiter Buchhaltung",
    ],
    &[
        "Treasury",
        "Treasurer",
        "Head of Treasury",
        "Cash Management",
    ],
    &[
        "Konzernrechnungslegung",
        "Konsolidierung",
        "Group Reporting",
        "Group Accounting",
    ],
    &[
        "Restrukturierung",
        "Restructuring",
        "Sanierung",
        "Turnaround",
    ],
    &["CEO", "Geschäftsführer", "Managing Director"],
    &["COO", "Chief Operating Officer", "Head of Operations"],
    &["CHRO", "Head of HR", "Personalleiter"],
    &[
        "CIO",
        "Chief Information Officer",
        "IT-Leiter",
        "Head of IT",
    ],
    &["Projektleiter", "Projektmanager", "Project Manager"],
    &["Programmmanager", "Program Manager", "PMO"],
];

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
    ROLE_NAMES
        .iter()
        .filter(move |group| group.iter().any(|name| names(&text, &key(name))))
        .flat_map(|group| group.iter().copied())
}

/// The deep search's terms for a profile form, in the order they are asked for.
pub fn deep_search_terms(form: &ProfileForm) -> Vec<String> {
    let mut terms = Terms::default();
    for term in &form.search_terms {
        terms.add(term, true);
    }
    for role in &form.roles {
        terms.add(role, false);
        if let Some(core) = core(role) {
            terms.add(&core, false);
        }
        for name in other_names(role) {
            terms.add(name, false);
        }
    }
    for focus in &form.focus {
        terms.add(focus, false);
        for name in other_names(focus) {
            terms.add(name, false);
        }
    }
    let mut competences: Vec<_> = form.competences.iter().collect();
    competences.sort_by_key(|competence| std::cmp::Reverse(competence.years.unwrap_or(0)));
    for competence in &competences {
        terms.add(&competence.name, false);
    }
    for competence in &competences {
        for alias in &competence.aliases {
            terms.add(alias, false);
        }
    }
    for word in form.keywords.iter().chain(&form.tools) {
        terms.add(word, false);
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
    /// Adds a term unless it is known, too long (not `own`), empty, or the list is full.
    fn add(&mut self, term: &str, own: bool) {
        let term = term.trim();
        let words = term.split_whitespace().count();
        if term.chars().count() < 2
            || (!own && words > MAX_TERM_WORDS)
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

    fn competence(name: &str, years: u32, aliases: &[&str]) -> ProfileCompetence {
        ProfileCompetence {
            name: name.to_owned(),
            years: Some(years),
            aliases: aliases.iter().map(|a| (*a).to_owned()).collect(),
            origin: None,
        }
    }

    #[test]
    fn own_terms_first_then_roles_with_their_names_then_the_rest() {
        let form = ProfileForm {
            search_terms: vec![
                "Interim CFO".into(),
                "Konzernrechnungslegung nach IFRS".into(),
            ],
            roles: vec!["Interim CFO".into(), "Head of Controlling".into()],
            focus: vec!["Restrukturierung".into()],
            competences: vec![
                competence("Liquiditätsplanung", 10, &[]),
                competence("Controlling", 18, &["Financial Controlling"]),
                competence(
                    "Rund elf Jahre Treasury, Cash Management und Factoring",
                    11,
                    &[],
                ),
            ],
            keywords: vec!["IFRS".into(), "HGB".into()],
            tools: vec!["SAP S/4HANA".into(), "LucaNet".into()],
            ..ProfileForm::default()
        };
        let terms = deep_search_terms(&form);
        assert_eq!(
            terms[..4],
            [
                "Interim CFO",
                "Konzernrechnungslegung nach IFRS",
                // The role without its contract word, then its other names.
                "CFO",
                "Chief Financial Officer",
            ]
        );
        for wanted in [
            "Finanzvorstand",
            "Head of Finance",
            "Leiter Controlling",
            "Sanierung",
            "Controlling",
            "Liquiditätsplanung",
            "Financial Controlling",
            "IFRS",
            "LucaNet",
        ] {
            assert!(terms.iter().any(|t| t == wanted), "{wanted} in {terms:?}");
        }
        // The longest experience first among the competences.
        let at = |t: &str| terms.iter().position(|x| x == t).unwrap();
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
            keywords: (0..60).map(|n| format!("Thema {n}")).collect(),
            ..ProfileForm::default()
        };
        assert_eq!(deep_search_terms(&form).len(), MAX_DEEP_TERMS);
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
