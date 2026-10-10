//! Domain packs: bilingual pairs and paraphrases of one field on top of the general core
//! (`lexicon::engine`). A pack is switched on automatically when at least `PACK_HITS`
//! tokens of the profile's competences start with one of its triggers; it never adds
//! matches for other profiles. A new field is one more file here plus one line in
//! [`DOMAINS`].
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. Keys are words separated by single spaces (stemmed when the table
//! is built; stopwords, fillers and words under three letters never occur in keys, since
//! the text loses them first), or one hyphenated word for a spelling with hyphens; values
//! are one concept. A key in two packs names the same concept in both.

mod consulting;
mod customer_service;
mod data;
mod energy;
mod finance;
mod hr;
mod it_project;
mod it_service;
mod legal;
mod marketing;
mod operations;
mod pharma;
mod procurement;
mod restructuring;
mod sales;
mod sap;
mod software;

/// One domain pack.
pub(crate) struct Domain {
    /// Stable id, shown in the profile summary.
    pub name: &'static str,
    /// The field's names as job boards write them, the most common first: a profile whose
    /// target roles lie in the field searches for them too
    /// (`profile::deep_search_terms`).
    pub search: &'static [&'static str],
    /// Folded token prefixes in the profile's competences that switch the pack on.
    pub triggers: &'static [&'static str],
    /// Folded words of the field that are too broad to meet a requirement on their own
    /// (`HR`, `Daten`); they count for every profile, like the core's generic atoms.
    pub generic: &'static [&'static str],
    /// Phrase -> concept.
    pub concepts: &'static [(&'static str, &'static str)],
}

/// All packs, in a fixed order.
pub(crate) const DOMAINS: &[&Domain] = &[
    &finance::DOMAIN,
    &sap::DOMAIN,
    &it_project::DOMAIN,
    &hr::DOMAIN,
    &procurement::DOMAIN,
    &data::DOMAIN,
    &pharma::DOMAIN,
    &operations::DOMAIN,
    &sales::DOMAIN,
    &legal::DOMAIN,
    &software::DOMAIN,
    &restructuring::DOMAIN,
    &consulting::DOMAIN,
    &energy::DOMAIN,
    &customer_service::DOMAIN,
    &it_service::DOMAIN,
    &marketing::DOMAIN,
];

/// Helpers for the pack tests: atoms and fits under the packs a profile switches on.
#[cfg(test)]
pub(crate) mod testing {
    use crate::matching::atoms::{Fit, Vocab, atoms, fit};

    /// The vocabulary of a profile with these competences.
    pub(crate) fn vocab(profile: &[&str]) -> Vocab {
        Vocab::for_texts(profile.iter().copied())
    }

    /// Asserts that each pair meets in the same atoms.
    pub(crate) fn assert_same(vocab: &Vocab, pairs: &[(&str, &str)]) {
        for (a, b) in pairs {
            assert_eq!(atoms(a, vocab), atoms(b, vocab), "{a} / {b}");
        }
    }

    /// Does an atom of `profile` meet an atom of `job` in full (equal, or the profile
    /// more specific)?
    pub(crate) fn full(vocab: &Vocab, job: &str, profile: &str) -> bool {
        let profile = atoms(profile, vocab);
        atoms(job, vocab).iter().any(|j| {
            profile
                .iter()
                .any(|p| matches!(fit(j, p), Fit::Equal | Fit::Specific))
        })
    }

    /// Asserts that no pair meets in full.
    pub(crate) fn assert_apart(vocab: &Vocab, pairs: &[(&str, &str)]) {
        for (job, profile) in pairs {
            assert!(
                !full(vocab, job, profile),
                "{job} met by {profile}: {:?} / {:?}",
                atoms(job, vocab),
                atoms(profile, vocab)
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;
    use crate::matching::atoms::{fold, stem};

    fn stems(key: &str) -> Vec<String> {
        key.split(' ').map(stem).collect()
    }

    #[test]
    fn names_are_unique_and_tables_sorted() {
        let mut names: Vec<&str> = DOMAINS.iter().map(|d| d.name).collect();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), DOMAINS.len());
        for domain in DOMAINS {
            for table in [domain.triggers, domain.generic] {
                assert!(table.windows(2).all(|w| w[0] < w[1]), "{}", domain.name);
                assert!(table.iter().all(|w| fold(w) == *w), "{}", domain.name);
            }
        }
    }

    /// Every pack names its field for the deep search: a few short terms, each once.
    #[test]
    fn every_pack_names_its_field() {
        for domain in DOMAINS {
            assert!((3..=10).contains(&domain.search.len()), "{}", domain.name);
            let mut names: Vec<String> = domain.search.iter().map(|n| fold(n)).collect();
            assert!(
                names.iter().all(|n| n.split_whitespace().count() <= 4),
                "{}",
                domain.name
            );
            names.sort();
            names.dedup();
            assert_eq!(names.len(), domain.search.len(), "{}", domain.name);
        }
    }

    /// A key names one concept, in its own pack and in every other (keys that stem alike,
    /// such as `year-end close` and `year-end closing`, are one key).
    #[test]
    fn keys_agree_across_packs() {
        let mut all: BTreeMap<Vec<String>, (&str, &str, String)> = BTreeMap::new();
        for domain in DOMAINS {
            for (key, value) in domain.concepts {
                assert!(!key.contains("  ") && key.trim() == *key, "{key}");
                let value = stem(value);
                if let Some((pack, other, before)) = all.get(&stems(key)) {
                    assert_eq!(
                        *before, value,
                        "'{other}' is {before} in {pack} but '{key}' is {value} in {}",
                        domain.name
                    );
                } else {
                    all.insert(stems(key), (domain.name, key, value));
                }
            }
        }
    }

    /// A pack needs `PACK_HITS` trigger tokens: one stray word of another field (a common
    /// sight in wide fields) switches nothing on.
    #[test]
    fn one_stray_word_switches_no_pack() {
        let packs = |texts: &[&str]| testing::vocab(texts).packs().to_vec();
        let stray = [
            "Recruiting",
            "Controlling",
            "SQL",
            "Vertrieb",
            "Compliance",
            "GMP",
            "Lean",
            "Java",
            "Einkauf",
        ];
        assert!(packs(&stray).is_empty(), "{:?}", packs(&stray));
        assert_eq!(packs(&["Recruiting", "Arbeitsrecht"]), ["hr"]);
        assert_eq!(packs(&["SQL", "Datenmodellierung"]), ["data"]);
        assert!(packs(&["SQL", "Reporting"]).is_empty());
    }
}
