//! The app's own search (user decision 2026-10-01): the public search of every source that
//! has one ([`PortalAdapter::search_urls`](crate::portal::PortalAdapter::search_urls)) for
//! the search terms of the active profile, deep (user, 2026-10-01: "tief und viel"): a term's
//! further pages ([`PortalAdapter::search_page_url`](crate::portal::PortalAdapter::search_page_url))
//! are asked for while the page before brought jobs the list did not know, up to
//! [`MAX_PAGES`]. The source's robots.txt is read first (once a day) and a page it does not
//! allow is never requested. Every page goes through [`admit`] like a job page: pace (never
//! below the robots.txt's Crawl-delay), caps, pauses; a throttle or a block pauses the source
//! as a page's would, a check or a wall stops it for the run, and a page the parser does not
//! know stops it too and counts toward the breaker. The hits become jobs of the list
//! ([`Store::record_found`]); their ads are read by the fetch step that follows.
//!
//! The sources are searched side by side, each at its own pace. A term whose paging a stop or
//! a cancel cut short goes on where it stopped at the source's next search within
//! [`RESUME_FRESH`] (its first page is always asked again: new jobs stand there).

use std::collections::BTreeMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Mutex;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::task::Poll;

use jiff::{SignedDuration, Timestamp};
use serde::{Deserialize, Serialize};
use tokio::sync::mpsc;
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

/// So many pages of one term a source is asked for at most.
pub const MAX_PAGES: u32 = 10;
/// A term's paging cut short goes on at the source's next search within this time.
pub const RESUME_FRESH: SignedDuration = SignedDuration::from_hours(7 * 24);

/// Where the paging of a source's terms stopped short: the first page's address of each such
/// term and the page that comes next (the store's key/value table, per source).
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Resume {
    /// When it was written (Unix seconds).
    at: i64,
    pages: BTreeMap<String, u32>,
}

fn resume_key(portal: Portal) -> String {
    format!("search_resume:{}", portal.key())
}

/// The paging a source's last search left, if it is fresh.
fn load_resume(store: &Store, portal: Portal, now: Timestamp) -> crate::Result<Resume> {
    let resume = store
        .kv_get(&resume_key(portal))?
        .and_then(|text| serde_json::from_str::<Resume>(&text).ok())
        .unwrap_or_default();
    // A clock that went back meanwhile leaves it fresh.
    let fresh =
        crate::time::from_db(resume.at).is_some_and(|at| now.duration_since(at) < RESUME_FRESH);
    Ok(if fresh { resume } else { Resume::default() })
}

fn save_resume(
    store: &Store,
    portal: Portal,
    pages: BTreeMap<String, u32>,
    now: Timestamp,
) -> crate::Result<()> {
    let resume = Resume {
        at: crate::time::to_db(now),
        pages,
    };
    store.kv_set(
        &resume_key(portal),
        &serde_json::to_string(&resume).unwrap_or_default(),
    )
}

/// What the searches of the sources share: the store, the rules, the run, the cancel, the
/// clock, the switches, and the run's page count (done, total) that grows as pages are added.
struct Shared<'a, C: Fn() -> Timestamp> {
    store: &'a Store,
    policy: &'a Mutex<Policy>,
    run: i64,
    on: &'a PortalOnFn<'a>,
    cancel: &'a CancellationToken,
    clock: &'a C,
    done: AtomicUsize,
    total: AtomicUsize,
}

/// How a source's search ended.
enum Ended {
    Completed,
    Cancelled,
}

/// Searches every source of `portals` that has a search for `terms`, side by side; `false`
/// when the run was cancelled. A source switched off during the run stops before its next
/// page.
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
    let shared = Shared {
        store,
        policy,
        run,
        on,
        cancel,
        clock: &clock,
        done: AtomicUsize::new(0),
        total: AtomicUsize::new(plan.iter().map(|(_, urls)| urls.len()).sum()),
    };
    // Only sources switched on get a fetch path - built before the start: if one fails, no
    // source begins.
    let mut work = Vec::new();
    for (portal, urls) in plan {
        found.entry(portal).or_default();
        if !on(portal) {
            shared.done.fetch_add(urls.len(), Ordering::Relaxed);
            continue;
        }
        let fetcher =
            pages(portal).map_err(|detail| crate::Error::FetchUnavailable { portal, detail })?;
        work.push((portal, urls, fetcher));
    }
    let (notes, mut incoming) = mpsc::unbounded_channel::<SearchEvent>();
    let mut searches: Vec<Pin<Box<_>>> = work
        .into_iter()
        .map(|(portal, urls, fetcher)| {
            Box::pin(search_source(portal, urls, fetcher, &shared, notes.clone()))
        })
        .collect();
    drop(notes);
    let mut results: Vec<Option<crate::Result<(Portal, SearchCounts, Ended)>>> =
        searches.iter().map(|_| None).collect();
    // All sources side by side in this one task; what a search reports is delivered right
    // after its step.
    std::future::poll_fn(|cx| {
        let mut pending = false;
        for (search, result) in searches.iter_mut().zip(results.iter_mut()) {
            if result.is_none() {
                match search.as_mut().poll(cx) {
                    Poll::Ready(done) => *result = Some(done),
                    Poll::Pending => pending = true,
                }
            }
            while let Ok(event) = incoming.try_recv() {
                on_event(event);
            }
        }
        if pending {
            Poll::Pending
        } else {
            Poll::Ready(())
        }
    })
    .await;
    while let Ok(event) = incoming.try_recv() {
        on_event(event);
    }
    let mut completed = true;
    for result in results.into_iter().flatten() {
        let (portal, counts, ended) = result?;
        completed &= matches!(ended, Ended::Completed);
        found.insert(portal, counts);
    }
    Ok(completed)
}

/// One source's search: its robots.txt, then each term's pages one after the other at the
/// source's pace, deeper while a page brings new jobs.
#[expect(
    clippy::too_many_lines,
    reason = "the robots.txt, the pages, the paging and the outcome of each read best in one piece"
)]
async fn search_source<F: PageFetcher, C: Fn() -> Timestamp>(
    portal: Portal,
    urls: Vec<Url>,
    mut fetcher: F,
    shared: &Shared<'_, C>,
    notes: mpsc::UnboundedSender<SearchEvent>,
) -> crate::Result<(Portal, SearchCounts, Ended)> {
    let Shared {
        store,
        policy,
        run,
        on,
        cancel,
        clock,
        ..
    } = *shared;
    let send = |event: SearchEvent| {
        let _ = notes.send(event);
    };
    let mut counts = SearchCounts::default();
    let planned = urls.len();
    let robots = robots_of(&mut fetcher, policy, portal, cancel, clock, |until| {
        send(SearchEvent::Waiting { portal, until });
    })
    .await?;
    let robots = match robots {
        Ok(robots) => robots,
        Err(Blocker::Page(outcome)) if *outcome == PageOutcome::Cancelled => {
            return Ok((portal, counts, Ended::Cancelled));
        }
        Err(Blocker::Stop(reason)) => {
            stopped(&mut counts, portal, Some(reason), &send);
            shared.done.fetch_add(planned, Ordering::Relaxed);
            return Ok((portal, counts, Ended::Completed));
        }
        Err(Blocker::Page(outcome)) => {
            let reason = stop_reason(policy, portal, &outcome, clock())?;
            stopped(&mut counts, portal, reason, &send);
            shared.done.fetch_add(planned, Ordering::Relaxed);
            return Ok((portal, counts, Ended::Completed));
        }
    };
    let adapter = portal.adapter();
    let resume = load_resume(store, portal, clock())?;
    // The terms whose paging this search cuts short, and where it goes on.
    let mut left: BTreeMap<String, u32> = BTreeMap::new();
    let mut ended = Ended::Completed;
    let mut first_pages = urls.into_iter();
    'terms: for first in first_pages.by_ref() {
        let resume_at = resume.pages.get(first.as_str()).copied();
        let mut page = 1;
        let mut url = first.clone();
        loop {
            shared.done.fetch_add(1, Ordering::Relaxed);
            if !robots.allows(&robots_path(&url)) {
                counts.refused += 1;
                log::info!("{}: robots.txt does not allow {}", portal.key(), url.path());
                break;
            }
            if !on(portal) {
                break 'terms;
            }
            match admit(policy, portal, cancel, clock, |until| {
                send(SearchEvent::Waiting { portal, until });
            })
            .await?
            {
                Admission::Cancelled => {
                    left.insert(first.to_string(), page);
                    ended = Ended::Cancelled;
                    break 'terms;
                }
                Admission::Stop(reason) => {
                    left.insert(first.to_string(), page);
                    stopped(&mut counts, portal, Some(reason), &send);
                    break 'terms;
                }
                Admission::Go => {}
            }
            send(SearchEvent::Searching {
                portal,
                done: shared.done.load(Ordering::Relaxed),
                total: shared.total.load(Ordering::Relaxed),
            });
            let result = fetcher.search(portal, &url, cancel).await;
            let now = clock();
            lock(policy).record_done(portal, now);
            counts.pages += 1;
            let (hits, new, reason) = match result {
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
                    let new = seen.iter().filter(|seen| **seen == Seen::New).count();
                    counts.hits += postings.len();
                    counts.new += new;
                    (postings.len(), new, None)
                }
                Err(PageOutcome::Cancelled) => {
                    lock(policy).save()?;
                    left.insert(first.to_string(), page);
                    ended = Ended::Cancelled;
                    break 'terms;
                }
                // A search page that is gone: the next term.
                Err(PageOutcome::Gone) => (0, 0, None),
                Err(outcome) => (0, 0, Some(stop_reason(policy, portal, &outcome, now)?)),
            };
            lock(policy).save()?;
            if let Some(reason) = reason {
                left.insert(first.to_string(), page);
                stopped(&mut counts, portal, reason, &send);
                break 'terms;
            }
            // Deeper while the page brought jobs the list did not know; where the last search
            // stopped short, on from there (its first page told what is new).
            let next = match resume_at {
                Some(at) if page == 1 && new == 0 && at > 2 => at,
                Some(at) if page < at => page + 1,
                _ if new > 0 => page + 1,
                _ => break,
            };
            if hits == 0 || next > MAX_PAGES {
                break;
            }
            let Some(next_url) = adapter.search_page_url(&first, next) else {
                break;
            };
            shared.total.fetch_add(1, Ordering::Relaxed);
            page = next;
            url = next_url;
        }
    }
    // The terms never reached count as done for the run's progress.
    shared
        .done
        .fetch_add(first_pages.count(), Ordering::Relaxed);
    save_resume(store, portal, left, clock())?;
    Ok((portal, counts, ended))
}

/// The source's search ends for this run; a reason the user should learn is told.
fn stopped(
    counts: &mut SearchCounts,
    portal: Portal,
    reason: Option<StopReason>,
    on_event: &impl Fn(SearchEvent),
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

    use super::super::policy::limits;
    use super::*;
    use crate::portal::{Hit, JobKey, JobLink};

    const HAYS: Portal = Portal::Hays;
    const FM: Portal = Portal::Freelancermap;

    /// Answers the search pages in order and says which addresses were asked.
    #[derive(Default)]
    struct Fake {
        robots: Option<String>,
        answers: VecDeque<Result<Vec<Hit>, PageOutcome>>,
        /// The addresses asked, kept where the test can read them after the search.
        asked: std::sync::Arc<Mutex<Vec<Url>>>,
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
            lock(&self.asked).push(url.clone());
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
        // The first term's second page too (its first one brought new jobs), which brought
        // only a known one: no third.
        assert_eq!(
            (counts.pages, counts.hits, counts.new, counts.refused),
            (3, 3, 2, 1)
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
        // Each page through admit: four requests counted (robots.txt and three pages).
        assert_eq!(lock(&policy).state(HAYS).accesses.len(), 4);
        // The run's count grows by the page it adds.
        assert!(events.iter().any(|e| matches!(
            e,
            SearchEvent::Searching {
                done: 4,
                total: 4,
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

    fn hits(ids: std::ops::Range<u32>) -> Vec<Hit> {
        ids.map(|id| hit(&format!("89{id:04}"))).collect()
    }

    /// The pages a fake was asked for, as `p<n>` from their addresses (`p1` without one).
    fn pages_of(asked: &Mutex<Vec<Url>>) -> Vec<String> {
        lock(asked)
            .iter()
            .map(|url| {
                url.path()
                    .rsplit_once("/p/")
                    .map_or_else(|| "p1".to_owned(), |(_, page)| format!("p{page}"))
            })
            .collect()
    }

    #[tokio::test(start_paused = true)]
    async fn a_term_goes_deeper_while_its_pages_bring_new_jobs() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        // Pages 1 and 2 new jobs, page 3 only known ones: no page 4.
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(hits(0..20)), Ok(hits(20..40)), Ok(hits(10..20))]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let on = |_: Portal| true;
        let (_, found, _) = search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS],
            &terms(&["Controlling"]),
            &on,
        )
        .await;
        assert_eq!(pages_of(&asked), ["p1", "p2", "p3"]);
        assert_eq!((found[&HAYS].pages, found[&HAYS].new), (3, 40));
        // Every page new: at most MAX_PAGES.
        let store = Store::in_memory().unwrap();
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut answers = VecDeque::new();
        for n in 0..20 {
            answers.push_back(Ok(hits(n * 20..n * 20 + 20)));
        }
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers,
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS],
            &terms(&["Controlling"]),
            &on,
        )
        .await;
        assert_eq!(lock(&asked).len(), usize::try_from(MAX_PAGES).unwrap());
        // A source that shows every hit on one page (SOLCOM) is asked once per term.
        let store = Store::in_memory().unwrap();
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            Portal::Solcom,
            Fake {
                answers: VecDeque::from([Ok(hits(0..20))]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(
            &mut fakes,
            &store,
            &policy,
            &[Portal::Solcom],
            &terms(&["SAP"]),
            &on,
        )
        .await;
        assert_eq!(lock(&asked).len(), 1);
    }

    #[tokio::test(start_paused = true)]
    async fn paging_cut_short_goes_on_where_it_stopped() {
        let store = Store::in_memory().unwrap();
        let on = |_: Portal| true;
        // The first search: pages 1 and 2, then a throttle at page 3.
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([
                    Ok(hits(0..20)),
                    Ok(hits(20..40)),
                    Err(PageOutcome::Throttled {
                        cause: Cause::Http(429),
                        retry_after: None,
                    }),
                ]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        assert_eq!(pages_of(&asked), ["p1", "p2", "p3"]);
        // The next search (the pause over): page 1 again (nothing new there), then on at page
        // 3, deeper while new jobs come.
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(hits(0..20)), Ok(hits(40..60)), Ok(Vec::new())]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        let (_, found, _) =
            search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        assert_eq!(pages_of(&asked), ["p1", "p3", "p4"]);
        assert_eq!(found[&HAYS].new, 20);
        // Finished: the search after starts at page 1 and stops there.
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(hits(0..20))]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        assert_eq!(pages_of(&asked), ["p1"]);
    }

    #[tokio::test(start_paused = true)]
    async fn the_sources_are_searched_side_by_side() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let fake = || Fake {
            answers: VecDeque::from([Ok(Vec::new()), Ok(Vec::new()), Ok(Vec::new())]),
            ..Fake::default()
        };
        let mut fakes = BTreeMap::from([(HAYS, fake()), (FM, fake())]);
        let on = |_: Portal| true;
        let begun = tokio::time::Instant::now();
        search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS, FM],
            &terms(&["SAP", "CFO", "IFRS"]),
            &on,
        )
        .await;
        // Each source: robots.txt and three pages, three gaps of at most 5 s: together not
        // more than one source's time.
        let pace = *limits(HAYS).pace_ms.end();
        assert!(
            begun.elapsed() <= Duration::from_millis(3 * pace + 100),
            "{:?}",
            begun.elapsed()
        );
        assert_eq!(lock(&policy).state(HAYS).accesses.len(), 4);
        assert_eq!(lock(&policy).state(FM).accesses.len(), 4);
    }
}
