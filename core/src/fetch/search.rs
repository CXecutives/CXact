//! The app's own search (user decision 2026-10-01): the public search of every source that
//! has one ([`PortalAdapter::search_urls`](crate::portal::PortalAdapter::search_urls)) for
//! the search terms of the active profile, deep (user, 2026-10-01: "tief und viel"): a term's
//! further pages ([`PortalAdapter::search_page_url`](crate::portal::PortalAdapter::search_page_url))
//! are asked for while the page before brought jobs the list did not know, up to
//! [`MAX_PAGES`], and never past the term's last page (`Paging`): one that shows the page
//! before again, or, where the source states how many hits the search finds, the page that
//! completes them or a short one the count puts last. The source's robots.txt is read first
//! (once a day) and a page it does not allow is never requested. Every page goes through
//! [`admit`] like a job page: pace (never below the robots.txt's Crawl-delay), caps, pauses;
//! a throttle or a block pauses the source as a page's would, a check or a wall stops it for
//! the run, and a page the parser does not know stops it too and counts toward the breaker.
//! The hits become jobs of the list ([`Store::record_found`]); their ads are read by the
//! fetch step that follows.
//!
//! The sources are searched side by side, each at its own pace. A term whose paging a stop or
//! a cancel cut short goes on where it stopped at the source's next search within
//! [`RESUME_FRESH`] (its first page is always asked again: new jobs stand there). Where the
//! paging stopped and what each term brought are bookkeeping: unreadable or not kept, they are
//! logged and the search and the run go on.
//!
//! A source filters by contract type only ([`PortalAdapter::contract_filter`]); its robots.txt
//! refusing the filtered page, the term is asked without the filter. A source whose robots.txt
//! refused every page tells so ([`StopReason::Refused`]) instead of an empty "ok". A source
//! without search terms (one list of all its roles) keeps only the hits whose title reaches
//! [`PRESCORE_FLOOR`] with the profile. The new jobs of every page go through the plan's
//! screen (the pre-filter of the pipeline: titles the engine excludes alone). What each term
//! brought is kept per source ([`term_yields`]: the term learning, `fetch::terms`).

use std::collections::{BTreeMap, BTreeSet};
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
    Admission, Blocker, Cause, PageFetcher, PageOutcome, PortalOnFn, PrescoreFn, SUSPICIOUS_STREAK,
    StopReason, admit, robots_path, search_robots_of,
};
use crate::model::Posting;
use crate::portal::{Contracts, JobKey, Portal};
use crate::store::{Seen, Store};
use crate::sync::lock;

/// What the search of one source brought in a run.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct SearchCounts {
    /// Search pages requested.
    pub pages: usize,
    /// Hits on them that were kept (a job on two pages counts twice; a source without search
    /// terms keeps those above [`PRESCORE_FLOOR`]).
    pub hits: usize,
    /// Jobs the list did not know yet.
    pub new: usize,
    /// Of those, the ones the screen excluded from their title alone.
    pub excluded: usize,
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
    /// The source's search is over: so many new jobs that are not excluded.
    SourceDone { portal: Portal, new: usize },
}

/// What a run searches: the sources, the terms, the contract types the profile allows, the
/// profile's title pre-score and the screen of the new jobs.
pub struct SearchPlan<'a> {
    pub portals: &'a [Portal],
    pub terms: &'a [String],
    pub contracts: Contracts,
    /// The profile's title pre-score: the hits of a source without search terms below
    /// [`PRESCORE_FLOOR`] are left out (`None`: every hit is kept).
    pub prescore: Option<&'a PrescoreFn>,
    /// Takes the new jobs of a page and says how many of them it excluded from their title
    /// alone (`None`: none).
    pub screen: Option<&'a Screen<'a>>,
}

/// The screen of a search's new jobs: how many of them it excluded from their title alone.
pub type Screen<'a> = dyn Fn(&[JobKey]) -> usize + Sync + 'a;

/// The first pages of a source's search with the term each asks for.
type FirstPages = Vec<(Option<String>, Url)>;

/// The least title pre-score (per mille) a hit of a source without search terms needs to be
/// kept. Measured on the held-out sets (`matching_heldout`, `prescore_report`): it drops about
/// three quarters of the titles graded 0 and nearly no grade-3 or high-band job.
pub const PRESCORE_FLOOR: u16 = 50;

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

/// So many jobs of one term the yield keeps per source.
const YIELD_JOBS: usize = 300;

/// What each term brought at a source's last search (the store's key/value table, per
/// source): its jobs (the ids at that source), new or known.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
struct Yield {
    terms: BTreeMap<String, TermYield>,
}

/// What one term brought at a source.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct TermYield {
    pub pages: u32,
    pub hits: u32,
    pub new: u32,
    /// The ids of its jobs at the source (at most [`YIELD_JOBS`]).
    pub jobs: Vec<String>,
}

fn yield_key(portal: Portal) -> String {
    format!("search_yield:{}", portal.key())
}

/// What each term brought at a source's last search.
pub fn term_yields(store: &Store, portal: Portal) -> crate::Result<BTreeMap<String, TermYield>> {
    Ok(store
        .kv_get(&yield_key(portal))?
        .and_then(|text| serde_json::from_str::<Yield>(&text).ok())
        .unwrap_or_default()
        .terms)
}

/// Keeps what the terms of this search brought, beside what the other terms of the profile
/// brought before (a term no longer searched goes).
fn save_yield(
    store: &Store,
    portal: Portal,
    terms: &[String],
    searched: BTreeMap<String, TermYield>,
) -> crate::Result<()> {
    let mut kept = term_yields(store, portal)?;
    kept.retain(|term, _| terms.contains(term));
    kept.extend(searched);
    store.kv_set(
        &yield_key(portal),
        &serde_json::to_string(&Yield { terms: kept }).unwrap_or_default(),
    )
}

/// What a term's pages showed in this run, to tell its last page, past which a page would
/// only repeat one or show none: the page shows the one before again (the source ignores the
/// page asked for, or repeats its last), or, on a source that states how many hits the search
/// finds, its pages showed them all, or the page is short and the count puts it last.
#[derive(Debug, Default)]
struct Paging {
    /// The jobs of the term's pages.
    seen: BTreeSet<JobKey>,
    /// The jobs of the page before.
    before: Option<BTreeSet<JobKey>>,
    /// The most jobs one of the term's pages showed: no more than a whole page holds.
    fullest: usize,
}

impl Paging {
    /// Takes in page `page`'s jobs (every hit of the page, whatever its contract type) and
    /// the count its source states; `true`: it is the term's last. A short page alone is no
    /// end (a page may leave out some of its hits); it is where the count leaves no hit for a
    /// page after it, even at the fullest page's size. A count below the page's own jobs
    /// contradicts the page and is not trusted.
    fn last(&mut self, page: u32, keys: BTreeSet<JobKey>, count: Option<usize>) -> bool {
        let count = count.filter(|count| *count >= keys.len());
        let repeated = !keys.is_empty() && self.before.as_ref() == Some(&keys);
        let short = keys.len() < self.fullest;
        self.fullest = self.fullest.max(keys.len());
        self.seen.extend(keys.iter().cloned());
        let shown = usize::try_from(page)
            .unwrap_or(usize::MAX)
            .saturating_mul(self.fullest);
        let counted = count.is_some_and(|count| {
            let complete = self.seen.len() >= count;
            complete || (short && shown >= count)
        });
        self.before = Some(keys);
        repeated || counted
    }
}

/// What the searches of the sources share: the store, the rules, the run, the cancel, the
/// clock, the switches, and the run's page count (done, total) that grows as pages are added.
struct Shared<'a, C: Fn() -> Timestamp> {
    store: &'a Store,
    policy: &'a Mutex<Policy>,
    run: i64,
    plan: &'a SearchPlan<'a>,
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

/// The first pages of a source's search, each with the term it asks for (`None`: the one
/// list of a source without search terms).
fn first_pages(portal: Portal, terms: &[String]) -> FirstPages {
    let adapter = portal.adapter();
    if !adapter.searches_terms() {
        return adapter
            .search_urls(terms)
            .into_iter()
            .map(|url| (None, url))
            .collect();
    }
    terms
        .iter()
        .flat_map(|term| {
            adapter
                .search_urls(std::slice::from_ref(term))
                .into_iter()
                .map(move |url| (Some(term.clone()), url))
        })
        .collect()
}

/// Searches every source of the plan that has a search, side by side; `false` when the run
/// was cancelled. A source switched off during the run stops before its next page.
pub async fn search_all<F: PageFetcher>(
    mut pages: impl FnMut(Portal) -> Result<F, String>,
    (store, policy, run): (&Store, &Mutex<Policy>, i64),
    (plan, on): (&SearchPlan<'_>, &PortalOnFn<'_>),
    cancel: &CancellationToken,
    clock: impl Fn() -> Timestamp,
    found: &mut BTreeMap<Portal, SearchCounts>,
    mut on_event: impl FnMut(SearchEvent),
) -> crate::Result<bool> {
    let work_plan: Vec<(Portal, FirstPages)> = plan
        .portals
        .iter()
        .map(|&portal| (portal, first_pages(portal, plan.terms)))
        .filter(|(_, urls)| !urls.is_empty())
        .collect();
    let shared = Shared {
        store,
        policy,
        run,
        plan,
        on,
        cancel,
        clock: &clock,
        done: AtomicUsize::new(0),
        total: AtomicUsize::new(work_plan.iter().map(|(_, urls)| urls.len()).sum()),
    };
    // Only sources switched on get a fetch path - built before the start: if one fails, no
    // source begins.
    let mut work = Vec::new();
    for (portal, urls) in work_plan {
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
    let mut results: Vec<Option<(Portal, SearchCounts, crate::Result<Ended>)>> =
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
    // A source that failed takes nothing from the others: every source's counts stay in
    // `found`, and the first error is the search's.
    let mut completed = true;
    let mut failure = None;
    for (portal, counts, ended) in results.into_iter().flatten() {
        found.insert(portal, counts);
        match ended {
            Ok(ended) => completed &= matches!(ended, Ended::Completed),
            Err(e) => {
                failure.get_or_insert(e);
            }
        }
    }
    failure.map_or(Ok(completed), Err)
}

/// One source's search with what it brought: the counts come back even when the search
/// failed (a database error, a state that could not be saved), so the run keeps what the
/// pages already brought.
async fn search_source<F: PageFetcher, C: Fn() -> Timestamp>(
    portal: Portal,
    urls: FirstPages,
    fetcher: F,
    shared: &Shared<'_, C>,
    notes: mpsc::UnboundedSender<SearchEvent>,
) -> (Portal, SearchCounts, crate::Result<Ended>) {
    let mut counts = SearchCounts::default();
    let ended = search_terms(portal, urls, fetcher, shared, notes, &mut counts).await;
    (portal, counts, ended)
}

/// One source's search: its robots.txt, then each term's pages one after the other at the
/// source's pace, deeper while a page brings new jobs. What it brings goes into `counts` as
/// it goes.
#[expect(
    clippy::too_many_lines,
    reason = "the robots.txt, the pages, the paging and the outcome of each read best in one piece"
)]
async fn search_terms<F: PageFetcher, C: Fn() -> Timestamp>(
    portal: Portal,
    urls: FirstPages,
    mut fetcher: F,
    shared: &Shared<'_, C>,
    notes: mpsc::UnboundedSender<SearchEvent>,
    counts: &mut SearchCounts,
) -> crate::Result<Ended> {
    let Shared {
        store,
        policy,
        run,
        plan,
        on,
        cancel,
        clock,
        ..
    } = *shared;
    let send = |event: SearchEvent| {
        let _ = notes.send(event);
    };
    let planned = urls.len();
    let robots = search_robots_of(&mut fetcher, policy, portal, cancel, clock, |until| {
        send(SearchEvent::Waiting { portal, until });
    })
    .await?;
    let robots = match robots {
        Ok(robots) => robots,
        Err(Blocker::Page(outcome)) if *outcome == PageOutcome::Cancelled => {
            return Ok(Ended::Cancelled);
        }
        Err(Blocker::Stop(reason)) => {
            stopped(counts, portal, Some(reason), &send);
            shared.done.fetch_add(planned, Ordering::Relaxed);
            send(SearchEvent::SourceDone { portal, new: 0 });
            return Ok(Ended::Completed);
        }
        Err(Blocker::Page(outcome)) => {
            let reason = stop_reason(policy, portal, &outcome, clock())?;
            stopped(counts, portal, reason, &send);
            shared.done.fetch_add(planned, Ordering::Relaxed);
            send(SearchEvent::SourceDone { portal, new: 0 });
            return Ok(Ended::Completed);
        }
    };
    let adapter = portal.adapter();
    // Where the paging stopped last time is bookkeeping: unreadable, every term starts at its
    // first page.
    let resume = load_resume(store, portal, clock()).unwrap_or_else(|e| {
        log::warn!(
            "{}: search paging: where it stopped did not read ({:?}), from the first pages",
            portal.key(),
            e.kind()
        );
        Resume::default()
    });
    // The terms whose paging this search cuts short, and where it goes on.
    let mut left: BTreeMap<String, u32> = BTreeMap::new();
    // What each term brought.
    let mut yields: BTreeMap<String, TermYield> = BTreeMap::new();
    let mut ended = Ended::Completed;
    let mut first_pages = urls.into_iter();
    'terms: for (term, first) in first_pages.by_ref() {
        // The filter by contract type where the robots.txt allows it, else none.
        let first = match adapter.contract_filter(&first, plan.contracts) {
            Some(filtered) if robots.allows(&robots_path(&filtered)) => filtered,
            Some(_) => {
                log::info!(
                    "{}: robots.txt does not allow the filtered search, asked without the filter",
                    portal.key()
                );
                first
            }
            None => first,
        };
        let resume_at = resume.pages.get(first.as_str()).copied();
        let mut page = 1;
        let mut url = first.clone();
        let mut paging = Paging::default();
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
                    stopped(counts, portal, Some(reason), &send);
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
            let mut last = false;
            let (hits, new, reason) = match result {
                Ok(found) => {
                    lock(policy).clear_suspicious(portal);
                    let all = found.hits.len();
                    let keys = found.hits.iter().map(|hit| hit.link.key.clone()).collect();
                    last = paging.last(page, keys, found.count);
                    // A contract type the profile does not allow, as the page shows it.
                    let mut postings: Vec<Posting> = found
                        .hits
                        .into_iter()
                        .filter(|hit| plan.contracts.allows(hit.contract))
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
                    // One list of all roles: only the titles that fit the profile.
                    if term.is_none()
                        && let Some(prescore) = plan.prescore
                    {
                        postings.retain(|p| prescore(&p.title, &p.location) >= PRESCORE_FLOOR);
                    }
                    let seen = store.record_found(run, &postings, now)?;
                    let fresh: Vec<JobKey> = postings
                        .iter()
                        .zip(&seen)
                        .filter(|(_, seen)| **seen == Seen::New)
                        .map(|(posting, _)| posting.key.clone())
                        .collect();
                    if !fresh.is_empty()
                        && let Some(screen) = plan.screen
                    {
                        counts.excluded += screen(&fresh);
                    }
                    counts.hits += postings.len();
                    counts.new += fresh.len();
                    if let Some(term) = &term {
                        let entry = yields.entry(term.clone()).or_default();
                        entry.pages += 1;
                        entry.hits += u32::try_from(postings.len()).unwrap_or(u32::MAX);
                        entry.new += u32::try_from(fresh.len()).unwrap_or(u32::MAX);
                        for posting in &postings {
                            if entry.jobs.len() < YIELD_JOBS
                                && !entry.jobs.contains(&posting.key.id)
                            {
                                entry.jobs.push(posting.key.id.clone());
                            }
                        }
                    }
                    (all, fresh.len(), None)
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
                stopped(counts, portal, reason, &send);
                break 'terms;
            }
            // Deeper while the page brought jobs the list did not know; where the last search
            // stopped short, on from there (its first page told what is new). Never past the
            // term's last page.
            let next = match resume_at {
                Some(at) if page == 1 && new == 0 && at > 2 => at,
                Some(at) if page < at => page + 1,
                _ if new > 0 => page + 1,
                _ => break,
            };
            if hits == 0 || last || next > MAX_PAGES {
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
    // Bookkeeping too: not kept, the next search starts its terms at their first pages and the
    // term learning misses this search - never a reason to fail the run and leave the jobs
    // already found unread.
    if let Err(e) = save_resume(store, portal, left, clock()) {
        log::warn!(
            "{}: search paging: where it stopped was not kept ({:?})",
            portal.key(),
            e.kind()
        );
    }
    if let Err(e) = save_yield(store, portal, plan.terms, yields) {
        log::warn!(
            "{}: search terms: what they brought was not kept ({:?})",
            portal.key(),
            e.kind()
        );
    }
    // Every page refused and none asked: no "ok" with no jobs.
    if counts.pages == 0 && counts.refused > 0 && counts.stop.is_none() {
        stopped(counts, portal, Some(StopReason::Refused), &send);
    }
    send(SearchEvent::SourceDone {
        portal,
        new: counts.new.saturating_sub(counts.excluded),
    });
    Ok(ended)
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

    use super::super::RobotsAnswer;
    use super::super::policy::limits;
    use super::*;
    use crate::portal::{Hit, HitContract, JobKey, JobLink, SearchPage};

    const HAYS: Portal = Portal::Hays;
    const FM: Portal = Portal::Freelancermap;

    /// Answers the search pages in order and says which addresses were asked.
    #[derive(Default)]
    struct Fake {
        robots: Option<String>,
        /// The robots.txt of the search pages' other host, where the source has one.
        search_robots: Option<String>,
        answers: VecDeque<Result<Vec<Hit>, PageOutcome>>,
        /// The count of the whole search every page states, where the source states one.
        count: Option<usize>,
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
        ) -> Result<SearchPage, PageOutcome> {
            lock(&self.asked).push(url.clone());
            let count = self.count;
            self.answers
                .pop_front()
                .unwrap_or(Ok(Vec::new()))
                .map(|hits| SearchPage { hits, count })
        }
        async fn robots(
            &mut self,
            url: &Url,
            _cancel: &CancellationToken,
        ) -> Result<RobotsAnswer, PageOutcome> {
            let search_host = crate::portal::PORTALS
                .iter()
                .any(|adapter| adapter.search_robots_url() == Some(url.as_str()));
            Ok(RobotsAnswer::Text(if search_host {
                self.search_robots.clone()
            } else {
                self.robots.clone()
            }))
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
            contract: None,
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
        let plan = SearchPlan {
            portals,
            terms: words,
            contracts: Contracts::PROJECTS,
            prescore: None,
            screen: None,
        };
        search_with(fakes, store, policy, &plan, on).await
    }

    /// Runs the search of a plan with one fake per source.
    async fn search_with(
        fakes: &mut BTreeMap<Portal, Fake>,
        store: &Store,
        policy: &Mutex<Policy>,
        plan: &SearchPlan<'_>,
        on: &PortalOnFn<'_>,
    ) -> (bool, BTreeMap<Portal, SearchCounts>, Vec<SearchEvent>) {
        let (done, found, events) = try_search_with(fakes, store, policy, plan, on).await;
        (done.unwrap(), found, events)
    }

    /// Like [`search_with`], with the search's own result (it may fail).
    async fn try_search_with(
        fakes: &mut BTreeMap<Portal, Fake>,
        store: &Store,
        policy: &Mutex<Policy>,
        plan: &SearchPlan<'_>,
        on: &PortalOnFn<'_>,
    ) -> (
        crate::Result<bool>,
        BTreeMap<Portal, SearchCounts>,
        Vec<SearchEvent>,
    ) {
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
            (plan, on),
            &cancel,
            clock,
            &mut found,
            |event| events.push(event),
        )
        .await;
        (done, found, events)
    }

    /// A profile of projects alone filters Hays by contract type; where its robots.txt
    /// refuses the filtered page, the term is asked without the filter.
    #[tokio::test(start_paused = true)]
    async fn the_contract_filter_and_its_robots() {
        let on = |_: Portal| true;
        for (rules, wanted) in [
            ("User-agent: *\nDisallow: /login/", "joblevel=3"),
            (
                "User-agent: *\nDisallow: /jobsuche/stellenangebote-jobs?q=CFO&joblevel=3",
                "q=CFO&mrew=1",
            ),
        ] {
            let store = Store::in_memory().unwrap();
            let policy = Mutex::new(Policy::in_memory());
            let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
            let mut fakes = BTreeMap::from([(
                HAYS,
                Fake {
                    robots: Some(rules.into()),
                    asked: asked.clone(),
                    ..Fake::default()
                },
            )]);
            let (_, found, _) =
                search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
            let asked = lock(&asked);
            assert_eq!(asked.len(), 1, "{rules}");
            assert!(asked[0].as_str().contains(wanted), "{}", asked[0]);
            assert_eq!(found[&HAYS].refused, 0);
        }
        // With Festanstellung allowed, no filter at all.
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let words = terms(&["CFO"]);
        let plan = SearchPlan {
            portals: &[HAYS],
            terms: &words,
            contracts: Contracts {
                project: true,
                permanent: true,
                temporary: false,
            },
            prescore: None,
            screen: None,
        };
        search_with(&mut fakes, &store, &policy, &plan, &on).await;
        assert!(!lock(&asked)[0].as_str().contains("joblevel"));
    }

    /// The hits whose page shows a contract type the profile does not allow are no jobs;
    /// the paging still goes by every hit of the page.
    #[tokio::test(start_paused = true)]
    async fn the_hits_of_a_contract_type_not_allowed() {
        let on = |_: Portal| true;
        let of = |id: &str, contract| Hit {
            contract: Some(contract),
            ..hit(id)
        };
        let words = terms(&["CFO"]);
        for (contracts, kept) in [
            (Contracts::PROJECTS, vec!["891480"]),
            (Contracts::ALL, vec!["891480", "891481"]),
            (
                Contracts {
                    project: false,
                    ..Contracts::ALL
                },
                vec!["891481"],
            ),
        ] {
            let store = Store::in_memory().unwrap();
            let policy = Mutex::new(Policy::in_memory());
            let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
            let mut fakes = BTreeMap::from([(
                HAYS,
                Fake {
                    answers: VecDeque::from([
                        Ok(vec![
                            of("891480", HitContract::Project),
                            of("891481", HitContract::Permanent),
                        ]),
                        Ok(Vec::new()),
                    ]),
                    asked: asked.clone(),
                    ..Fake::default()
                },
            )]);
            let plan = SearchPlan {
                portals: &[HAYS],
                terms: &words,
                contracts,
                prescore: None,
                screen: None,
            };
            let (_, found, _) = search_with(&mut fakes, &store, &policy, &plan, &on).await;
            assert_eq!(found[&HAYS].new, kept.len(), "{contracts:?}");
            let yields = term_yields(&store, HAYS).unwrap();
            assert_eq!(yields["CFO"].jobs, kept, "{contracts:?}");
            assert!(lock(&asked).len() >= 2 || kept.is_empty(), "{contracts:?}");
        }
    }

    /// A source whose robots.txt refuses every page says so instead of an empty "ok"; every
    /// source ends with what it brought.
    #[tokio::test(start_paused = true)]
    async fn every_page_refused_is_told() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                robots: Some("User-agent: *\nDisallow: /jobsuche/".into()),
                ..Fake::default()
            },
        )]);
        let on = |_: Portal| true;
        let (_, found, events) = search(
            &mut fakes,
            &store,
            &policy,
            &[HAYS],
            &terms(&["CFO", "Treasury"]),
            &on,
        )
        .await;
        assert_eq!((found[&HAYS].pages, found[&HAYS].refused), (0, 2));
        assert_eq!(found[&HAYS].stop, Some(StopReason::Refused));
        assert!(events.contains(&SearchEvent::Stopped {
            portal: HAYS,
            reason: StopReason::Refused
        }));
        assert_eq!(
            events.last(),
            Some(&SearchEvent::SourceDone {
                portal: HAYS,
                new: 0
            })
        );
    }

    /// A source without search terms keeps only the titles that reach the floor; the screen
    /// takes the new jobs and its exclusions leave the count of what a source brought; each
    /// term's jobs are kept.
    #[tokio::test(start_paused = true)]
    async fn the_floor_the_screen_and_what_each_term_brought() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let on = |_: Portal| true;
        // Hays: two new jobs, the screen excludes one.
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(vec![hit("891480"), hit("891481")]), Ok(Vec::new())]),
                ..Fake::default()
            },
        )]);
        let words = terms(&["CFO"]);
        let screened = Mutex::new(Vec::new());
        let screen = |keys: &[JobKey]| {
            lock(&screened).extend_from_slice(keys);
            1
        };
        let low = |title: &str, _: &str| if title.ends_with("891481") { 0 } else { 500 };
        let plan = SearchPlan {
            portals: &[HAYS],
            terms: &words,
            contracts: Contracts::PROJECTS,
            prescore: Some(&low),
            screen: Some(&screen),
        };
        let (_, found, events) = search_with(&mut fakes, &store, &policy, &plan, &on).await;
        // A source with terms keeps every hit, whatever its pre-score.
        assert_eq!((found[&HAYS].new, found[&HAYS].excluded), (2, 1));
        assert_eq!(lock(&screened).len(), 2);
        assert!(events.contains(&SearchEvent::SourceDone {
            portal: HAYS,
            new: 1
        }));
        let yields = term_yields(&store, HAYS).unwrap();
        assert_eq!(yields["CFO"].jobs, ["891480", "891481"]);
        assert_eq!((yields["CFO"].pages, yields["CFO"].new), (2, 2));
        // A source without terms: the title below the floor is no job.
        let interim = |id: &str| Hit {
            link: Portal::InterimX
                .adapter()
                .canonical_url(id)
                .and_then(|url| Portal::InterimX.adapter().job_link(&url))
                .unwrap(),
            title: format!("Interim CFO {id}"),
            company: String::new(),
            location: String::new(),
            contract: None,
        };
        let mut fakes = BTreeMap::from([(
            Portal::InterimX,
            Fake {
                answers: VecDeque::from([Ok(vec![interim("11"), interim("891481")])]),
                ..Fake::default()
            },
        )]);
        let plan = SearchPlan {
            portals: &[Portal::InterimX],
            terms: &words,
            contracts: Contracts::PROJECTS,
            prescore: Some(&low),
            screen: None,
        };
        let (_, found, _) = search_with(&mut fakes, &store, &policy, &plan, &on).await;
        assert_eq!(
            (found[&Portal::InterimX].hits, found[&Portal::InterimX].new),
            (1, 1)
        );
        assert!(
            store
                .job(&JobKey {
                    portal: Portal::InterimX,
                    id: "891481".into()
                })
                .unwrap()
                .is_none()
        );
        // The terms of a later search keep what the earlier ones brought.
        assert!(term_yields(&store, Portal::InterimX).unwrap().is_empty());
        assert_eq!(term_yields(&store, HAYS).unwrap()["CFO"].jobs.len(), 2);
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

    /// A hit of `portal`'s own search.
    fn hit_at(portal: Portal, id: &str) -> Hit {
        let adapter = portal.adapter();
        Hit {
            link: adapter
                .canonical_url(id)
                .and_then(|url| adapter.job_link(&url))
                .unwrap(),
            title: format!("Interim CFO {id}"),
            company: String::new(),
            location: "Hamburg".to_owned(),
            contract: None,
        }
    }

    /// A database error in one source's search ends that source and fails the search, but
    /// loses nothing of what the run found: the other source's counts and the pages the
    /// failing one had stored stay in `found`.
    #[tokio::test(start_paused = true)]
    async fn a_failing_source_keeps_the_counts_of_all() {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        // Hays's second page cannot be stored: its job is refused by the database.
        store.execute_for_test(
            "CREATE TRIGGER no_page BEFORE INSERT ON job WHEN NEW.job_id = '891482'
             BEGIN SELECT RAISE(ABORT, 'Test'); END;",
        );
        let mut fakes = BTreeMap::from([
            (
                HAYS,
                Fake {
                    answers: VecDeque::from([
                        Ok(vec![hit("891480"), hit("891481")]),
                        Ok(vec![hit("891482")]),
                    ]),
                    ..Fake::default()
                },
            ),
            (
                FM,
                Fake {
                    answers: VecDeque::from([
                        Ok(vec![hit_at(FM, "10001"), hit_at(FM, "10002")]),
                        Ok(Vec::new()),
                    ]),
                    ..Fake::default()
                },
            ),
        ]);
        let on = |_: Portal| true;
        let words = terms(&["CFO"]);
        let plan = SearchPlan {
            portals: &[HAYS, FM],
            terms: &words,
            contracts: Contracts::PROJECTS,
            prescore: None,
            screen: None,
        };
        let (result, found, _) = try_search_with(&mut fakes, &store, &policy, &plan, &on).await;
        assert!(result.is_err(), "the database error is the search's");
        let hays = &found[&HAYS];
        assert_eq!((hays.pages, hays.hits, hays.new), (2, 2, 2));
        let fm = &found[&FM];
        assert_eq!((fm.pages, fm.hits, fm.new), (2, 2, 2));
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
                url.path().rsplit_once("/p/").map_or_else(
                    || "p1".to_owned(),
                    |(_, page)| format!("p{}", page.trim_end_matches('/')),
                )
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

    /// A paging cut short goes on where it stopped; a page that only repeats the one before
    /// (the source ignores the page asked for) ends the term there instead.
    #[tokio::test(start_paused = true)]
    async fn a_page_that_repeats_the_one_before_ends_the_term() {
        let store = Store::in_memory().unwrap();
        let on = |_: Portal| true;
        // The first search: pages 1 to 3, then a throttle at page 4.
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([
                    Ok(hits(0..20)),
                    Ok(hits(20..40)),
                    Ok(hits(40..60)),
                    Err(PageOutcome::Throttled {
                        cause: Cause::Http(429),
                        retry_after: None,
                    }),
                ]),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        // The next search: page 1 brings new jobs, page 2 shows them again: no page 3,
        // although the paging cut short would go on up to page 4.
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(hits(100..120)), Ok(hits(100..120)), Ok(hits(60..80))]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        let (_, found, _) =
            search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        assert_eq!(pages_of(&asked), ["p1", "p2"]);
        assert_eq!(found[&HAYS].new, 20);
        // Ended, not cut short: the search after starts at page 1 and stops there.
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            HAYS,
            Fake {
                answers: VecDeque::from([Ok(hits(100..120))]),
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let policy = Mutex::new(Policy::in_memory());
        search(&mut fakes, &store, &policy, &[HAYS], &terms(&["CFO"]), &on).await;
        assert_eq!(pages_of(&asked), ["p1"]);
    }

    fn fm_hits(ids: std::ops::Range<u32>) -> Vec<Hit> {
        ids.map(|id| {
            let url = FM.adapter().canonical_url(&format!("30{id:05}")).unwrap();
            Hit {
                link: FM.adapter().job_link(&url).unwrap(),
                title: format!("SAP FI/CO {id}"),
                company: String::new(),
                location: String::new(),
                contract: None,
            }
        })
        .collect()
    }

    /// How many pages freelancermap's search asks for one term, its pages answering with
    /// `answers` in turn (then none), each stating `count`.
    async fn fm_search(answers: Vec<Vec<Hit>>, count: Option<usize>) -> usize {
        let store = Store::in_memory().unwrap();
        let policy = Mutex::new(Policy::in_memory());
        let asked = std::sync::Arc::new(Mutex::new(Vec::new()));
        let mut fakes = BTreeMap::from([(
            FM,
            Fake {
                answers: answers.into_iter().map(Ok).collect(),
                count,
                asked: asked.clone(),
                ..Fake::default()
            },
        )]);
        let on = |_: Portal| true;
        search(
            &mut fakes,
            &store,
            &policy,
            &[FM],
            &terms(&["SAP FI/CO"]),
            &on,
        )
        .await;
        let asked = lock(&asked);
        // Page 1 first, then its pages as the source counts them.
        for (n, url) in asked.iter().enumerate().skip(1) {
            assert!(
                url.as_str().ends_with(&format!("pagenr={}", n + 1)),
                "{url}"
            );
        }
        asked.len()
    }

    /// Where the source states how many hits the search finds (freelancermap), a term's
    /// paging ends with the page that completes them, or at a short page the count puts last;
    /// a count the page itself contradicts is not trusted.
    #[tokio::test(start_paused = true)]
    async fn the_paging_ends_at_the_sources_count_or_a_short_page() {
        // All 15 on page 1: no page 2.
        assert_eq!(fm_search(vec![fm_hits(0..15)], Some(15)).await, 1);
        // 30: pages 1 and 2.
        let pages = vec![fm_hits(0..20), fm_hits(20..30), fm_hits(30..40)];
        assert_eq!(fm_search(pages, Some(30)).await, 2);
        // 45, two of them left out of the pages: page 2 one short (the count leaves hits
        // for page 3), page 3 short and last by the count (three pages of 20 hold 45).
        let pages = vec![
            fm_hits(0..20),
            fm_hits(20..39),
            fm_hits(39..43),
            fm_hits(43..50),
        ];
        assert_eq!(fm_search(pages, Some(45)).await, 3);
        // A short page the count leaves hits after: paged on until a page brings none.
        let pages = vec![fm_hits(0..20), fm_hits(20..32), fm_hits(32..40)];
        assert_eq!(fm_search(pages, Some(100)).await, 4);
        // A count below the page's own hits: paged as without one.
        let pages = vec![fm_hits(0..20), fm_hits(20..40)];
        assert_eq!(fm_search(pages, Some(5)).await, 3);
        // Without a count a short page is no end (a source may leave hits out of a page).
        let pages = vec![fm_hits(0..20), fm_hits(20..32), fm_hits(32..40)];
        assert_eq!(fm_search(pages, None).await, 4);
    }

    /// The real search page of 2026-10-01 (private, not in the repository): its count asks
    /// for more pages; the same page again, as freelancermap answered page 2 in the live
    /// runs, ends the term.
    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_search_page_repeated_ends_the_term() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/private/pages/fm-search.html");
        let html = std::fs::read_to_string(path).unwrap();
        let adapter = FM.adapter();
        let keys = || -> BTreeSet<JobKey> {
            let hits = adapter.search_page(&html).unwrap();
            hits.into_iter().map(|hit| hit.link.key).collect()
        };
        let count = adapter.search_count(&html);
        let mut paging = Paging::default();
        assert!(!paging.last(1, keys(), count));
        assert!(paging.last(2, keys(), count));
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

    /// A source whose search pages lie on another host (Amadeus Fire's directory): that
    /// host's robots.txt decides about them, not the one beside its ads.
    #[tokio::test(start_paused = true)]
    async fn the_search_pages_host_decides_with_its_own_robots() {
        let on = |_: Portal| true;
        for (rules, asked) in [
            (
                "User-agent: *
Disallow: /
Allow: /packages/jobtoolControlling/",
                1,
            ),
            (
                "User-agent: *
Disallow: /",
                0,
            ),
        ] {
            let store = Store::in_memory().unwrap();
            let policy = Mutex::new(Policy::in_memory());
            let log = std::sync::Arc::new(Mutex::new(Vec::new()));
            let mut fakes = BTreeMap::from([(
                Portal::AmadeusFire,
                Fake {
                    // Beside the ads everything is allowed.
                    robots: Some(
                        "User-agent: *
Disallow: /wp-admin/"
                            .into(),
                    ),
                    search_robots: Some(rules.into()),
                    asked: log.clone(),
                    ..Fake::default()
                },
            )]);
            let (_, found, _) = search(
                &mut fakes,
                &store,
                &policy,
                &[Portal::AmadeusFire],
                &terms(&["Controlling"]),
                &on,
            )
            .await;
            assert_eq!(lock(&log).len(), asked, "{rules}");
            assert_eq!(found[&Portal::AmadeusFire].refused, 1 - asked, "{rules}");
            assert!(
                lock(&policy)
                    .search_robots(Portal::AmadeusFire, Timestamp::now())
                    .is_some()
            );
        }
    }
}
