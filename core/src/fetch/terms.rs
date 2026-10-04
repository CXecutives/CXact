//! Term learning (user decision 2026-10-04): a search term that brought no fitting job (scored
//! in the mid or high band, not excluded) in its last [`FRUITLESS_RUNS`] runs is set aside, and
//! its slot goes to the next of the profile's terms (`profile::deep_search_terms`, in their
//! order) that is not set aside. A term set aside comes back [`ASIDE_FOR`] after its last
//! fruitless run, and every term comes back when the profile's terms change. Search only: the
//! scores are untouched.
//!
//! It is decided from what is stored, the same way every time: per term the jobs its last runs
//! brought at the sources searched (the store's key/value table) and those jobs' matches now.

use std::collections::BTreeMap;

use jiff::{SignedDuration, Timestamp};
use serde::{Deserialize, Serialize};

use super::search::term_yields;
use crate::portal::{JobKey, Portal};
use crate::profile::MAX_DEEP_TERMS;
use crate::store::Store;

/// So many runs in a row without a fitting job set a term aside.
pub const FRUITLESS_RUNS: usize = 3;
/// A term set aside comes back this long after its last fruitless run.
pub const ASIDE_FOR: SignedDuration = SignedDuration::from_hours(30 * 24);

const KEY: &str = "search_terms_learned";

/// The runs of the profile's terms.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Learned {
    /// The profile's terms they belong to (a fingerprint): other terms start anew.
    profile: u64,
    /// Per term its last runs, the newest last (at most [`FRUITLESS_RUNS`]).
    runs: BTreeMap<String, Vec<TermRun>>,
}

/// One run of a term: when (Unix seconds) and the jobs it brought (`portal:id`).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct TermRun {
    at: i64,
    jobs: Vec<String>,
}

/// FNV-1a over the terms: stable across builds and platforms.
fn fingerprint(candidates: &[String]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in candidates.iter().flat_map(|t| t.bytes().chain([b'\n'])) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0100_0000_01b3);
    }
    hash
}

/// The runs stored for these terms; none when the stored ones belong to other terms.
fn load(store: &Store, candidates: &[String]) -> crate::Result<Learned> {
    let profile = fingerprint(candidates);
    let stored = store
        .kv_get(KEY)?
        .and_then(|text| serde_json::from_str::<Learned>(&text).ok())
        .filter(|learned| learned.profile == profile);
    Ok(stored.unwrap_or(Learned {
        profile,
        runs: BTreeMap::new(),
    }))
}

/// Since when a term is set aside: its last [`FRUITLESS_RUNS`] runs brought no job that fits
/// now (the time of the last of them); `None` otherwise.
fn fruitless_since(store: &Store, runs: &[TermRun]) -> crate::Result<Option<Timestamp>> {
    let Some(last) = runs.last() else {
        return Ok(None);
    };
    if runs.len() < FRUITLESS_RUNS {
        return Ok(None);
    }
    let keys: Vec<JobKey> = runs[runs.len() - FRUITLESS_RUNS..]
        .iter()
        .flat_map(|run| &run.jobs)
        .filter_map(|job| {
            let (portal, id) = job.split_once(':')?;
            Some(JobKey {
                portal: Portal::from_key(portal)?,
                id: id.to_owned(),
            })
        })
        .collect();
    Ok((store.fitting(&keys)? == 0)
        .then(|| crate::time::from_db(last.at))
        .flatten())
}

/// The terms a search at `now` asks for: the profile's terms in their order without those set
/// aside, at most [`MAX_DEEP_TERMS`].
pub fn active_terms(
    store: &Store,
    candidates: &[String],
    now: Timestamp,
) -> crate::Result<Vec<String>> {
    let learned = load(store, candidates)?;
    let mut active = Vec::new();
    for term in candidates {
        if active.len() >= MAX_DEEP_TERMS {
            break;
        }
        let aside = match learned.runs.get(term) {
            Some(runs) => fruitless_since(store, runs)?
                .is_some_and(|since| now.duration_since(since) < ASIDE_FOR),
            None => false,
        };
        if !aside {
            active.push(term.clone());
        }
    }
    Ok(active)
}

/// Keeps the run of the `searched` terms at `now`: the jobs each brought at the `portals`
/// searched (what their yields hold now). A term that comes back from aside starts its runs
/// anew; a term no longer among the profile's goes.
pub fn record_run(
    store: &Store,
    candidates: &[String],
    searched: &[String],
    portals: &[Portal],
    now: Timestamp,
) -> crate::Result<()> {
    let mut learned = load(store, candidates)?;
    let mut jobs: BTreeMap<&str, Vec<String>> = BTreeMap::new();
    let yields: Vec<_> = portals
        .iter()
        .map(|&portal| term_yields(store, portal).map(|y| (portal, y)))
        .collect::<crate::Result<_>>()?;
    for term in searched {
        let found = jobs.entry(term.as_str()).or_default();
        for (portal, yields) in &yields {
            if let Some(found_here) = yields.get(term) {
                found.extend(
                    found_here
                        .jobs
                        .iter()
                        .map(|id| format!("{}:{id}", portal.key())),
                );
            }
        }
    }
    for (term, found) in jobs {
        let runs = learned.runs.entry(term.to_owned()).or_default();
        if fruitless_since(store, runs)?.is_some() {
            runs.clear();
        }
        runs.push(TermRun {
            at: crate::time::to_db(now),
            jobs: found,
        });
        let excess = runs.len().saturating_sub(FRUITLESS_RUNS);
        runs.drain(..excess);
    }
    learned.runs.retain(|term, _| candidates.contains(term));
    store.kv_set(KEY, &serde_json::to_string(&learned).unwrap_or_default())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{KeyFacts, MatchRecord, MatchStatus, Posting};
    use crate::portal::job_link;
    use crate::store::MailRef;

    const DAY: SignedDuration = SignedDuration::from_hours(24);

    fn terms(names: &[&str]) -> Vec<String> {
        names.iter().map(|n| (*n).to_owned()).collect()
    }

    /// A LinkedIn job with its match.
    fn job(store: &Store, id: u64, status: MatchStatus, points: u8) -> String {
        let run = store.begin_run().unwrap();
        let link = job_link(&format!("https://www.linkedin.com/jobs/view/{id}/")).unwrap();
        let posting = Posting::new(link.key.clone(), link.url, "Job", "", "");
        let mail = MailRef {
            subject: "x",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(run, &posting, mail, Timestamp::now())
            .unwrap();
        let record = MatchRecord {
            status,
            score: points,
            note: None,
            must_met: 1,
            must_total: 2,
            top: Vec::new(),
            facts: KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(&[(link.key.clone(), record)], "r", Timestamp::now())
            .unwrap();
        link.key.id
    }

    /// One search at `at`: what each term brought at LinkedIn, kept as its run.
    fn search(
        store: &Store,
        candidates: &[String],
        brought: &[(&str, Vec<String>)],
        at: Timestamp,
    ) -> Vec<String> {
        let active = active_terms(store, candidates, at).unwrap();
        let yields: BTreeMap<&str, serde_json::Value> = brought
            .iter()
            .map(|(term, jobs)| {
                (
                    *term,
                    serde_json::json!({"pages": 1, "hits": jobs.len(), "new": 0, "jobs": jobs}),
                )
            })
            .collect();
        store
            .kv_set(
                "search_yield:linkedin",
                &serde_json::json!({ "terms": yields }).to_string(),
            )
            .unwrap();
        record_run(store, candidates, &active, &[Portal::LinkedIn], at).unwrap();
        active
    }

    /// Three runs without a fitting job set a term aside and give its slot to the next term;
    /// a fitting job, an excluded one or a job of the mid band decide as their scores say.
    #[test]
    fn a_fruitless_term_gives_its_slot_to_the_next() {
        let store = Store::in_memory().unwrap();
        let mut candidates: Vec<String> =
            (0..MAX_DEEP_TERMS).map(|n| format!("Term {n}")).collect();
        candidates.push("Reserve".to_owned());
        let fitting = job(&store, 4_000_000_301, MatchStatus::Scored, 60);
        let excluded = job(&store, 4_000_000_302, MatchStatus::Excluded, 90);
        let low = job(&store, 4_000_000_303, MatchStatus::Scored, 20);
        let start = Timestamp::now();
        for run in 0..FRUITLESS_RUNS {
            let at = start + DAY * i32::try_from(run).unwrap();
            let active = search(
                &store,
                &candidates,
                &[
                    ("Term 0", vec![low.clone(), excluded.clone()]),
                    ("Term 1", vec![fitting.clone()]),
                ],
                at,
            );
            assert_eq!(active, candidates[..MAX_DEEP_TERMS], "run {run}");
        }
        // `Term 1` brought a fitting job; the others nothing that fits (a low score, an
        // excluded job, nothing at all): set aside, their slots go to the next term.
        let later = start + DAY * 3;
        let active = active_terms(&store, &candidates, later).unwrap();
        assert_eq!(active, ["Term 1", "Reserve"]);
    }

    /// A term set aside comes back after `ASIDE_FOR` and starts its runs anew; every term comes
    /// back when the profile's terms change.
    #[test]
    fn set_aside_terms_come_back() {
        let store = Store::in_memory().unwrap();
        let candidates = terms(&["Kundenservice", "Contact Center"]);
        let start = Timestamp::now();
        for run in 0..FRUITLESS_RUNS {
            let at = start + DAY * i32::try_from(run).unwrap();
            search(&store, &candidates, &[], at);
        }
        let last = start + DAY * 2;
        assert!(
            active_terms(&store, &candidates, last + DAY)
                .unwrap()
                .is_empty()
        );
        // Back after its time: one more fruitless run does not set it aside again.
        let back = last + ASIDE_FOR;
        assert_eq!(active_terms(&store, &candidates, back).unwrap(), candidates);
        search(&store, &candidates, &[], back);
        assert_eq!(
            active_terms(&store, &candidates, back + DAY).unwrap(),
            candidates
        );
        // Other terms of the profile: nothing is set aside.
        for run in 0..FRUITLESS_RUNS {
            let at = back + DAY * (2 + i32::try_from(run).unwrap());
            search(&store, &candidates, &[], at);
        }
        let now = back + DAY * 10;
        assert!(active_terms(&store, &candidates, now).unwrap().is_empty());
        let changed = terms(&["Kundenservice", "Contact Center", "Call Center"]);
        assert_eq!(active_terms(&store, &changed, now).unwrap(), changed);
    }

    /// A term with fewer runs or without any stays: a fresh profile searches its first terms.
    #[test]
    fn a_new_term_is_searched() {
        let store = Store::in_memory().unwrap();
        let candidates: Vec<String> = (0..30).map(|n| format!("Term {n}")).collect();
        let now = Timestamp::now();
        assert_eq!(
            active_terms(&store, &candidates, now).unwrap(),
            candidates[..MAX_DEEP_TERMS]
        );
        search(&store, &candidates, &[], now);
        assert_eq!(
            active_terms(&store, &candidates, now + DAY).unwrap(),
            candidates[..MAX_DEEP_TERMS]
        );
    }
}
