//! Relevance of a job for the profile, independent of explicit requirements:
//! title fit (V17) and a BM25F-like lexical score over title x3, requirement lines x2 and
//! the rest x1 with static specificity and a fixed document length (V18).

use std::collections::{BTreeMap, HashMap};
use std::ops::Range;
use std::sync::LazyLock;

use super::atoms::{self, Fit, Vocab, fold};
use super::fit::Skills;
use super::graph::{self, Known};
use super::lexicon::engine as lex;
use super::params::{
    BM25_B, BM25_K1, BM25_LENGTH, FIELD_REQUIREMENTS, FIELD_REST, FIELD_TITLE, GENERIC_WEIGHT,
    RELEVANCE_HALF, SENTENCE_ATOMS, SPECIFIC_WEIGHT,
};
use crate::profile::key;

fn counts(text: &str, vocab: &Vocab) -> BTreeMap<String, u64> {
    let mut map = BTreeMap::new();
    for line in text.lines() {
        for atom in atoms::atoms(line, vocab).iter() {
            *map.entry(atom.clone()).or_insert(0) += 1;
        }
    }
    map
}

/// The atoms a profile is looked for by in an ad, each with its static weight
/// ([`query`]), numbered.
#[derive(Debug, Clone)]
pub(crate) struct Query {
    pub atoms: Vec<(String, u64)>,
    known: Known,
}

impl Query {
    pub(crate) fn new(atoms: Vec<(String, u64)>) -> Self {
        Self {
            known: Known::new(atoms.iter().map(|(a, _)| a.clone()).collect()),
            atoms,
        }
    }
}

/// The atoms of each line read once, then [`counts`] over lines borrowing them.
fn tally<'c>(
    lines: impl Iterator<Item = &'c str>,
    read: &'c HashMap<&str, atoms::Atoms>,
) -> HashMap<&'c str, u64> {
    let mut map = HashMap::new();
    for line in lines {
        for atom in read.get(line).into_iter().flat_map(|a| a.iter()) {
            *map.entry(atom.as_str()).or_insert(0) += 1;
        }
    }
    map
}

/// Is an atom a contract word of a title (`TITLE_CONTRACT_WORDS`, as written or stemmed)?
fn contract_word(atom: &str) -> bool {
    static WORDS: LazyLock<Vec<String>> = LazyLock::new(|| {
        let written = lex::TITLE_CONTRACT_WORDS.iter().map(|w| (*w).to_owned());
        let stemmed = lex::TITLE_CONTRACT_WORDS.iter().map(|w| atoms::stem(w));
        let mut words: Vec<String> = written.chain(stemmed).collect();
        words.sort();
        words.dedup();
        words
    });
    WORDS.binary_search_by(|w| w.as_str().cmp(atom)).is_ok()
}

/// Distinct profile atoms with their static weight: specific 1000, generic 200; an atom
/// only named in free text counts half (an entry long enough to be a sentence). Languages are no field, and contract words and quantities say nothing about
/// it: they stay out.
pub(crate) fn query(skills: &Skills) -> Query {
    let noise = |a: &str| {
        contract_word(a)
            || lex::NUMBER_WORDS.iter().any(|(w, _)| *w == a)
            || lex::QUERY_NOISE.contains(&a)
    };
    let mut atoms: Vec<(String, bool)> = skills
        .entries
        .iter()
        .filter(|e| !e.path.starts_with(key::LANGUAGES))
        .flat_map(|e| {
            let free_text =
                e.atoms.iter().filter(|a| !atoms::is_generic(a)).count() >= SENTENCE_ATOMS;
            e.atoms
                .iter()
                .filter(move |a| !noise(a))
                .map(move |a| (a.clone(), free_text))
        })
        .collect();
    // Competence occurrences (`false`) sort first and win the dedup.
    atoms.sort();
    atoms.dedup_by(|b, a| a.0 == b.0);
    Query::new(
        atoms
            .into_iter()
            .map(|(a, usp)| {
                let weight = if atoms::is_generic(&a) {
                    GENERIC_WEIGHT
                } else if usp {
                    SPECIFIC_WEIGHT / 2
                } else {
                    SPECIFIC_WEIGHT
                };
                (a, weight)
            })
            .collect(),
    )
}

/// Title fit in per-mille: share of the title's content atoms the profile covers, scaled
/// by the static weight of the profile atom (specific 1000, USP-only 500).
pub(crate) fn title_fit(query: &Query, title: &str, vocab: &Vocab) -> u64 {
    title_fit_with(query, title, vocab, false)
}

/// The title fit of a text judged by its title alone: its contract words (`Interim`,
/// `Freelance`) leave the title, the field words decide.
pub(crate) fn field_title_fit(query: &Query, title: &str, vocab: &Vocab) -> u64 {
    title_fit_with(query, title, vocab, true)
}

fn title_fit_with(query: &Query, title: &str, vocab: &Vocab, drop_contract: bool) -> u64 {
    // Contract words (`Interim`, `Freelance`, `befristet`) say nothing about the field: they
    // count in the title but never match the profile (`Interim Management` in a profile
    // does not make every interim title fit).
    let contract = contract_word;
    // A title judged alone drops them (and the generic atoms, as always).
    let dropped = |a: &str| atoms::is_generic(a) || (drop_contract && contract(a));
    let read = atoms::atoms(title, vocab);
    let title_atoms: Vec<&String> = read.iter().filter(|a| !dropped(a)).collect();
    if title_atoms.is_empty() {
        return 0;
    }
    let score: u64 = title_atoms
        .iter()
        .filter(|t| !contract(t))
        .map(|t| {
            let row = query.known.row(t);
            query
                .atoms
                .iter()
                .enumerate()
                .map(|(i, (_, weight))| {
                    let full = (*weight).clamp(SPECIFIC_WEIGHT / 2, SPECIFIC_WEIGHT);
                    match row.fits[i] {
                        // A compound of another field names the title's word as part of
                        // other work (`Personalcontrolling` for `Head of Controlling`): half,
                        // as for a requirement (`fit::item_fit`).
                        Fit::Specific if graph::other_field(row.packs, query.known.packs(i)) => {
                            full / 2
                        }
                        Fit::Equal | Fit::Specific => full,
                        Fit::General => full / 2,
                        Fit::None => 0,
                    }
                })
                .max()
                .unwrap_or(0)
        })
        .sum();
    score / title_atoms.len() as u64
}

/// The title query: the profile's query plus the atoms of its target roles (a title that
/// names a target role fits).
pub(crate) fn title_query(query: &Query, roles: &[String]) -> Query {
    let mut out = query.atoms.clone();
    for atom in roles {
        if !out.iter().any(|(a, _)| a == atom) {
            out.push((atom.clone(), SPECIFIC_WEIGHT));
        }
    }
    Query::new(out)
}

/// A title without gender markers (`(m/w/d)`, `(all genders)`, `(f/m/d)`) and without a
/// marketing tail after a dash or bar that names no skill (`– remote`, `– Scale-up`).
pub(crate) fn clean_title(title: &str) -> String {
    let mut out = String::with_capacity(title.len());
    let mut rest = title;
    while let Some(open) = rest.find('(') {
        let Some(close) = rest[open..].find(')').map(|c| open + c) else {
            break;
        };
        let inner = fold(&rest[open + 1..close]);
        let gender = lex::GENDER_MARKERS.iter().any(|m| inner.trim() == *m)
            || (!inner.trim().is_empty()
                && inner
                    .split(['/', '|', ',', ' ', '-'])
                    .filter(|p| !p.is_empty())
                    .all(|p| lex::GENDER_LETTERS.contains(&p)));
        out.push_str(&rest[..open]);
        if !gender {
            out.push_str(&rest[open..=close]);
        }
        rest = &rest[close + 1..];
    }
    out.push_str(rest);
    for sep in lex::TITLE_TAIL_SEPARATORS {
        if let Some((head, tail)) = out.split_once(sep)
            && !head.trim().is_empty()
            && !super::job::known_skill(tail)
        {
            out = head.to_owned();
        }
    }
    out.trim().to_owned()
}

/// Relevance `R = min(1000, R_lex + T/2)` in per-mille (`T` over the title query).
pub(crate) fn relevance(
    query: &Query,
    title_query: &Query,
    vocab: &Vocab,
    title: &str,
    text: &str,
    requirement_lines: &[Range<usize>],
) -> u64 {
    let title_counts = counts(title, vocab);
    // The atoms of each line and requirement phrase once.
    let requirement_text = || {
        requirement_lines
            .iter()
            .flat_map(|range| text[range.clone()].lines())
    };
    let mut read: HashMap<&str, atoms::Atoms> = HashMap::new();
    for line in text.lines().chain(requirement_text()) {
        read.entry(line)
            .or_insert_with(|| atoms::atoms(line, vocab));
    }
    let all = tally(text.lines(), &read);
    let requirement_counts = tally(requirement_text(), &read);
    let length = text.chars().count() as u64;
    // Length normalisation in per-mille: 1 - b + b * len / avg.
    let norm = (1000 - BM25_B) + BM25_B * length / BM25_LENGTH;
    // Each distinct atom of the ad against the query once: the profile atoms it names.
    let mut named: HashMap<&str, Vec<usize>> = HashMap::new();
    for job in title_counts
        .keys()
        .map(String::as_str)
        .chain(all.keys().copied())
        .chain(requirement_counts.keys().copied())
    {
        named.entry(job).or_insert_with(|| {
            let row = query.known.row(job);
            (0..query.atoms.len())
                .filter(|&i| matches!(row.fits[i], Fit::Equal | Fit::Specific))
                .collect()
        });
    }
    let field = |counts: &mut dyn Iterator<Item = (&str, u64)>| {
        let mut per_atom = vec![0u64; query.atoms.len()];
        for (job, n) in counts {
            for &index in named.get(job).into_iter().flatten() {
                per_atom[index] += n;
            }
        }
        per_atom
    };
    let in_title = field(&mut title_counts.iter().map(|(k, n)| (k.as_str(), *n)));
    let in_all = field(&mut all.iter().map(|(k, n)| (*k, *n)));
    let in_requirements = field(&mut requirement_counts.iter().map(|(k, n)| (*k, *n)));
    let mut mass: u64 = 0;
    for (index, (_, weight)) in query.atoms.iter().enumerate() {
        let in_rest = in_all[index].saturating_sub(in_requirements[index]);
        let tf = FIELD_TITLE * in_title[index]
            + FIELD_REQUIREMENTS * in_requirements[index]
            + FIELD_REST * in_rest;
        if tf == 0 {
            continue;
        }
        // BM25 saturation in per-mille: tf * (k1 + 1) / (tf + k1 * norm).
        let saturation = tf * (BM25_K1 + 1000) * 1_000_000 / (tf * 1_000_000 + BM25_K1 * norm);
        mass += weight * saturation / 1000;
    }
    let lexical = 1000 * mass / (mass + RELEVANCE_HALF);
    let title = title_fit(title_query, title, vocab);
    (lexical + title / 2).min(1000)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A contract word in the title (`Interim`) never matches the profile, not even its
    /// `Interim Management`.
    #[test]
    fn title_contract_words_never_match() {
        let vocab = Vocab::all();
        let query = Query::new(vec![
            ("interim".to_owned(), 1000),
            ("controll".to_owned(), 1000),
        ]);
        assert_eq!(title_fit(&query, "Interim Controller", &vocab), 500);
        assert_eq!(title_fit(&query, "Controller", &vocab), 1000);
        assert_eq!(title_fit(&query, "Freelance Interim", &vocab), 0);
    }

    /// Gender markers and a marketing tail without a skill leave the title; a tail naming a
    /// skill stays.
    #[test]
    fn titles_without_markers_and_tails() {
        assert_eq!(clean_title("Head of IT (all genders)"), "Head of IT");
        assert_eq!(clean_title("Controller (f/m/d)"), "Controller");
        assert_eq!(
            clean_title("Leiter Controlling (m/w/d) – Festanstellung"),
            "Leiter Controlling"
        );
        assert_eq!(
            clean_title("Interim CFO – Scale-up E-Mobility"),
            "Interim CFO"
        );
        assert_eq!(
            clean_title("Senior Consultant – SAP FI/CO"),
            "Senior Consultant – SAP FI/CO"
        );
        assert_eq!(clean_title("Controller (Konzern)"), "Controller (Konzern)");
    }

    /// A title that names a target role fits, even without the role's words in the query.
    #[test]
    fn target_roles_join_the_title_query() {
        let vocab = Vocab::all();
        let query = Query::new(vec![("controll".to_owned(), 1000)]);
        let with_role = title_query(&query, &["werksleit".to_owned()]);
        assert_eq!(title_fit(&query, "Werksleiter", &vocab), 0);
        assert!(title_fit(&with_role, "Werksleiter", &vocab) > 0);
    }

    /// The query holds the field: no languages, contract words or quantities, and free text
    /// (an entry long enough to be a sentence) counts half.
    #[test]
    fn the_query_holds_the_field() {
        let data = crate::profile::of_json(&serde_json::json!({
            "kernkompetenzen": [
                {"kompetenz": "Controlling"},
                {"kompetenz": "Interim Management"},
                {"kompetenz": "Rund elf Jahre Treasury, Cash Management, Liquiditätsplanung und Factoring"}
            ],
            "sprachen": [{"sprache": "Englisch", "niveau": "C1"}]
        }));
        let skills = Skills::new(&super::super::profile::core_texts(&data), &data);
        let query = query(&skills);
        let weight = |text: &str| {
            let atom = atoms::atoms(text, &skills.vocab)[0].clone();
            query
                .atoms
                .iter()
                .find(|(a, _)| *a == atom)
                .map(|(_, w)| *w)
        };
        assert_eq!(weight("Controlling"), Some(SPECIFIC_WEIGHT));
        assert_eq!(weight("Treasury"), Some(SPECIFIC_WEIGHT / 2));
        assert_eq!(weight("Englisch"), None);
        assert_eq!(weight("Interim Management"), None);
        assert_eq!(weight("elf"), None);
    }

    /// A title judged alone loses its contract words: `Interim CFO` is a CFO title.
    #[test]
    fn a_title_alone_is_judged_by_its_field() {
        let vocab = Vocab::all();
        let query = Query::new(vec![("cfo".to_owned(), SPECIFIC_WEIGHT)]);
        assert!(title_fit(&query, "Interim CFO", &vocab) < SPECIFIC_WEIGHT);
        assert_eq!(
            field_title_fit(&query, "Interim CFO", &vocab),
            SPECIFIC_WEIGHT
        );
    }
}
