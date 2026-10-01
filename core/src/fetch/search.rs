//! The app's own search (user decision 2026-10-01): the public search of every source that
//! has one ([`PortalAdapter::search_urls`](crate::portal::PortalAdapter::search_urls)), one
//! page per search term of the active profile. The source's robots.txt is read first (once a
//! day) and a page it does not allow is never requested. Every page goes through
//! [`admit`] like a job page: pace, caps, pauses; a throttle or a block pauses the source as
//! a page's would, a check or a wall stops it for the run, and a page the parser does not
//! know stops it too and counts toward the breaker. The hits become jobs of the list
//! ([`Store::record_found`]); their ads are read by the fetch step that follows.
//!
//! The sources are searched one after the other: a search is a few pages per source, and its
//! hits wait for the fetch step anyway.

use std::collections::BTreeMap;
use std::sync::Mutex;

use jiff::Timestamp;
use tokio_util::sync::CancellationToken;
use url::Url;

use super::policy::{PauseKind, PauseReason, Policy};
use super::{
    Admission, Blocker, Cause, PageFetcher, PageOutcome, PortalOnFn, SUSPICIOUS_STREAK, StopReason,
    admit, robots_of, robots_path,
};
use crate::model::Posting;
use crate::portal::Portal;
use crate::store::{Seen, Store};
use crate::sync::lock;

/// What the search of one source brought in a run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchCounts {
    /// Search pages requested.
    pub pages: usize,
    /// Hits on them (a job on two pages counts twice).
    pub hits: usize,
    /// Jobs the list did not know yet.
    pub new: usize,
    /// Pages left out: their robots.txt does not allow them.
    pub refused: usize,
    /// Why the source's search stopped early, where it did.
    pub stop: Option<StopReason>,
}

/// What the search tells the run while it goes.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SearchEvent {
    /// A search page of `portal` is requested now; `done` of `total` pages of the run.
    Searching {
        portal: Portal,
        done: usize,
        total: usize,
    },
    /// Waiting for the source's next request until then.
    Waiting { portal: Portal, until: Timestamp },
    /// The source's search stopped early.
    Stopped { portal: Portal, reason: StopReason },
}

/// Searches every source of `portals` that has a search for `terms`; `false` when the run
/// was cancelled. A source switched off during the run stops before its next page.
#[expect(
    clippy::too_many_lines,
    reason = "the robots.txt, the pages and the outcome of each read best in one piece"
)]
pub async fn search_all<F: PageFetcher>(
    mut pages: impl FnMut(Portal) -> Result<F, String>,
    (store, policy, run): (&Store, &Mutex<Policy>, i64),
    (portals, terms, on): (&[Portal], &[String], &PortalOnFn<'_>),
    cancel: &CancellationToken,
    clock: impl Fn() -> Timestamp,
    found: &mut BTreeMap<Portal, SearchCounts>,
    mut on_event: impl FnMut(SearchEvent),
) -> crate::Result<bool> {
    let plan: Vec<(Portal, Vec<Url>)> = portals
        .iter()
        .map(|&portal| (portal, portal.adapter().search_urls(terms)))
        .filter(|(_, urls)| !urls.is_empty())
        .collect();
    let total = plan.iter().map(|(_, urls)| urls.len()).sum();
    let mut done = 0;
    for (portal, urls) in plan {
        let counts = found.entry(portal).or_default();
        let after = done + urls.len();
        if !on(portal) {
            done = after;
            continue;
        }
        let mut fetcher =
            pages(portal).map_err(|detail| crate::Error::FetchUnavailable { portal, detail })?;
        let robots = robots_of(&mut fetcher, policy, portal, cancel, &clock, |until| {
            on_event(SearchEvent::Waiting { portal, until });
        })
        .await?;
        let robots = match robots {
            Ok(robots) => robots,
            Err(Blocker::Page(outcome)) if *outcome == PageOutcome::Cancelled => return Ok(false),
            Err(Blocker::Stop(reason)) => {
                stopped(counts, portal, Some(reason), &mut on_event);
                done = after;
                continue;
            }
            Err(Blocker::Page(outcome)) => {
                let reason = stop_reason(policy, portal, &outcome, clock())?;
                stopped(counts, portal, reason, &mut on_event);
                done = after;
                continue;
            }
        };
        for url in urls {
            done += 1;
            if !robots.allows(&robots_path(&url)) {
                counts.refused += 1;
                log::info!("{}: robots.txt does not allow {}", portal.key(), url.path());
                continue;
            }
            if !on(portal) {
                break;
            }
            match admit(policy, portal, cancel, &clock, |until| {
                on_event(SearchEvent::Waiting { portal, until });
            })
            .await?
            {
                Admission::Cancelled => return Ok(false),
                Admission::Stop(reason) => {
                    stopped(counts, portal, Some(reason), &mut on_event);
                    break;
                }
                Admission::Go => {}
            }
            on_event(SearchEvent::Searching {
                portal,
                done,
                total,
            });
            let result = fetcher.search(portal, &url, cancel).await;
            let now = clock();
            lock(policy).record_done(portal, now);
            counts.pages += 1;
            let reason = match result {
                Ok(hits) => {
                    lock(policy).clear_suspicious(portal);
                    let postings: Vec<Posting> = hits
                        .into_iter()
                        .map(|hit| {
                            Posting::new(
                                hit.link.key,
                                hit.link.url,
                                &hit.title,
                                &hit.company,
                                &hit.location,
                            )
                        })
                        .collect();
                    let seen = store.record_found(run, &postings, now)?;
                    counts.hits += postings.len();
                    counts.new += seen.iter().filter(|seen| **seen == Seen::New).count();
                    None
                }
                Err(PageOutcome::Cancelled) => {
                    lock(policy).save()?;
                    return Ok(false);
                }
                // A search page that is gone: the next term.
                Err(PageOutcome::Gone) => None,
                Err(outcome) => Some(stop_reason(policy, portal, &outcome, now)?),
            };
            lock(policy).save()?;
            if let Some(reason) = reason {
                stopped(counts, portal, reason, &mut on_event);
                break;
            }
        }
        done = after;
    }
    Ok(true)
}

/// The source's search ends for this run; a reason the user should learn is told.
fn stopped(
    counts: &mut SearchCounts,
    portal: Portal,
    reason: Option<StopReason>,
    on_event: &mut impl FnMut(SearchEvent),
) {
    log::info!("{}: search stopped ({reason:?})", portal.key());
    if let Some(reason) = reason {
        counts.stop = Some(reason.clone());
        on_event(SearchEvent::Stopped { portal, reason });
    }
}

/// What a search page that brought no hits means for its source, like a job page's outcome:
/// a throttle or a block pauses it, a wall stops it, a page the parser does not know stops it
/// and counts toward the breaker (two in a row pause it for an hour). `None`: it stops for
/// this run without a word.
fn stop_reason(
    policy: &Mutex<Policy>,
    portal: Portal,
    outcome: &PageOutcome,
    now: Timestamp,
) -> crate::Result<Option<StopReason>> {
    let mut policy = lock(policy);
    let reason = match *outcome {
        PageOutcome::Throttled { cause, retry_after } => {
            let detail = cause.to_string();
            let until =
                policy.pause_at_least(portal, PauseKind::Throttled, &detail, now, retry_after);
            Some(StopReason::Paused {
                until,
                reason: PauseReason::Throttled,
                detail,
            })
        }
        PageOutcome::Blocked(cause) => {
            let detail = cause.to_string();
            let until = policy.pause(portal, PauseKind::Blocked, &detail, now);
            Some(StopReason::Paused {
                until,
                reason: PauseReason::Blocked,
                detail,
            })
        }
        PageOutcome::LoginRequired(_) => Some(StopReason::LoginRequired),
        PageOutcome::NetError { cause, .. } => Some(StopReason::Network { cause }),
        PageOutcome::Suspicious(cause) if cause.is_layout_signal() => {
            let streak = policy.count_suspicious(portal);
            (streak >= SUSPICIOUS_STREAK).then(|| StopReason::Breaker {
                until: policy.pause_for(
                    portal,
                    PauseKind::Throttled,
                    PauseReason::LayoutChanged,
                    &Cause::Breaker.to_string(),
                    now,
                ),
            })
        }
        _ => None,
    };
    policy.save()?;
    Ok(reason)
}

#[cfg(test)]
mod tests {
    use std::collections::VecDeque;
    use std::time::Duration;

    use super::*;
    use crate::portal::{Hit, JobKey, JobLink};

    const HAYS: Portal = Portal::Hays;
    const FM: Portal = Portal::Freelancermap;

    /// Answers the search pages in order and says which addresses were asked.
    #[derive(Default)]
    struct Fake {
        robots: Option<String>,
        answers: VecDeque<Result<Vec<Hit>, PageOutcome>>,
        asked: Vec<Url>,
    }

    impl PageFetcher for Fake {
        async fn fetch(&mut self, _link: &JobLink, _cancel: &CancellationToken) -> PageOutcome {
            PageOutcome::Gone
        }
        async fn search(
            &mut self,
            _portal: Portal,
            url: &Url,
            _cancel: &CancellationToken,
        ) -> Result<Vec<Hit>, PageOutcome> {
            self.asked.push(url.clone());
            self.answers.pop_front().unwrap_or(Ok(Vec::new()))
        }
        async fn robots(
            &mut self,
            _portal: Portal,
            _cancel: &CancellationToken,
        ) -> Result<Option<String>, PageOutcome> {
            Ok(self.robots.clone())
        }
    }

    fn hit(id: &str) -> Hit {
        let url = HAYS.adapter().canonical_url(id).unwrap();
        Hit {
            link: JobLink {
                key: JobKey {
                    portal: HAYS,
                    id: id.to_owned(),
                },
                url,
            },
            title: format!("Interim CFO {id}"),
            company: String::new(),
            location: "Hamburg".to_owned(),
        }
    }

    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| (*t).to_owned()).collect()
    }

    /// Runs the search of `portals` with one fake per source.
    async fn search(
        fakes: &mut BTreeMap<Portal, Fake>,
        store: &Store,
        policy: &Mutex<Policy>,
        portals: &[Portal],
        words: &[String],
        on: &PortalOnFn<'_>,
    ) -> (bool, BTreeMap<Portal, SearchCounts>, Vec<SearchEvent>) {
        let mut found = BTreeMap::new();
        let mut events = Vec::new();
        let start = Timestamp::now();
        let begun = tokio::time::Instant::now();
        let clock =
            move || start + jiff::SignedDuration::try_from(begun.elapsed()).unwrap_or_default();
        let cancel = CancellationToken::new();
        let done = search_all(
            |portal| Ok(fakes.remove(&portal).unwrap_or_default()),
            (store, policy, 1),
            (portals, words, on),
            &cancel,
            clock,
            &mut found,
            |event| events.push(event),
        )
        .await
        .unwrap();
        (done, found, events)
    }

    #[tokio::test(start_paused = true)]
    async fn hits_become_jobs_once_and_robots_refuse_pages() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                // The second term's page is not allowed.
                robots: Some(
                    "User-agent: *\nDisallow: /jobsuche/stellenangebote-jobs?q=Treasury".into(),
                ),
                answers: VecDeque::from([
                    Ok(vec![hit("891480"), hit("891481")]),
                    Ok(vec![hit("891480")]),
                ]),
                ..Fake::default()
            },
        )]);
        let on = |_: Portal| true;
        let (done, found, events) = search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS],
            &terms(&["Interim CFO", "Treasury", "Controlling"]),
            &on,
        )
        .await;
        assert!(done);
        let counts = &found[&HAYS];
        assert_eq!(
            (counts.pages, counts.hits, counts.new, counts.refused),
            (2, 3, 2, 1)
        );
        assert!(counts.stop.is_none());
        let job = store
            .job(&JobKey {
                portal: HAYS,
                id: "891480".into(),
            })
            .unwrap()
            .unwrap();
        assert_eq!(job.title, "Interim CFO 891480");
        assert_eq!(job.location, "Hamburg");
        // Each page through admit: three requests counted (robots.txt and two pages).
        assert_eq!(lock(&policy).state(HAYS).accesses.len(), 3);
        assert!(events.iter().any(|e| matches!(
            e,
            SearchEvent::Searching {
                done: 3,
                total: 3,
                ..
            }
        )));
    }

    #[tokio::test(start_paused = true)]
    async fn a_throttle_or_a_check_pauses_the_source_and_stops_its_search() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let mut fakes = BTreeMap::from([
            (
                HAYS,
                Fake {
                    answers: VecDeque::from([Err(PageOutcome::Throttled {
                        cause: Cause::Http(429),
                        retry_after: Some(Duration::from_secs(7200)),
                    })]),
                    ..Fake::default()
                },
            ),
            (
                FM,
                Fake {
                    answers: VecDeque::from([Err(PageOutcome::Blocked(Cause::Captcha))]),
                    ..Fake::default()
                },
            ),
        ]);
        let on = |_: Portal| true;
        let (_, found, events) = search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS, FM],
            &terms(&["SAP", "CFO"]),
            &on,
        )
        .await;
        for portal in [HAYS, FM] {
            assert_eq!(found[&portal].pages, 1, "{portal}");
            assert!(
                matches!(found[&portal].stop, Some(StopReason::Paused { .. })),
                "{portal}"
            );
            assert!(
                events
                    .iter()
                    .any(|e| matches!(e, SearchEvent::Stopped { portal: p, .. } if *p == portal))
            );
        }
        let now = Timestamp::now();
        assert!(matches!(
            lock(&policy).allowance(HAYS, now),
            super::super::policy::Allowance::Paused { .. }
        ));
    }

    #[tokio::test(start_paused = true)]
    async fn an_unknown_page_stops_quietly_then_the_breaker_pauses() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let on = |_: Portal| true;
        for run in 0..2 {
            let mut fakes = BTreeMap::from([(
                HAYS,
                Fake {
                    answers: VecDeque::from([Err(PageOutcome::Suspicious(
                        Cause::PageNotRecognised,
                    ))]),
                    ..Fake::default()
                },
            )]);
            let (_, found, _) = search(
                &mut fakes,
                &store,
                &policy,
                &[HAYS],
                &terms(&["SAP", "CFO"]),
                &on,
            )
            .await;
            assert_eq!(found[&HAYS].pages, 1);
            if run == 0 {
                assert!(found[&HAYS].stop.is_none());
            } else {
                assert!(matches!(
                    found[&HAYS].stop,
                    Some(StopReason::Breaker { .. })
                ));
            }
        }
    }

    #[tokio::test(start_paused = true)]
    async fn a_source_switched_off_is_not_searched() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let mut fakes = BTreeMap::new();
        let off = |portal: Portal| portal != HAYS;
        let (done, found, _) =
            search(&mut fakes, &store, &policy, &[HAYS], &terms(&["SAP"]), &off).await;
        assert!(done);
        assert_eq!(found[&HAYS].pages, 0);
        assert!(lock(&policy).state(HAYS).accesses.is_empty());
    }
}
