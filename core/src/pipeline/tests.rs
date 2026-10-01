//! Runs with the dry-run dummies; simulated time (pace costs nothing).

use std::path::Path;
use std::sync::Mutex;

use jiff::SignedDuration;
use tokio::time::Instant;

use super::demo::{DemoBackends, DemoMail, DemoPages};
use super::*;
use crate::error::ErrorKind;
use crate::export::TXT_DIR;
use crate::fetch::policy::PauseReason;
use crate::model::{DescStatus, Place};
use crate::store::{JobFilter, JobRow};

fn clock() -> impl Fn() -> Timestamp {
    let base = Timestamp::now();
    let start = Instant::now();
    move || base + SignedDuration::try_from(start.elapsed()).unwrap()
}

fn request() -> RunRequest {
    RunRequest {
        kind: RunKind::Fetch,
    }
}

fn ctx(workspace: &Path, dry_run: bool) -> RunContext {
    RunContext {
        workspace: workspace.to_path_buf(),
        dry_run,
        portals: Portal::ALL.to_vec(),
        fetch_portals: Portal::ALL.to_vec(),
        sign_in: vec![Portal::FreelanceDe],
        language: Language::De,
        mailbox: None,
        read_mail: true,
        search_portals: Vec::new(),
        search_terms: Vec::new(),
    }
}

/// Mailbox only: no portal may fetch details.
fn scan_only(workspace: &Path) -> RunContext {
    RunContext {
        fetch_portals: Vec::new(),
        ..ctx(workspace, false)
    }
}

/// The files in the folder of the text files earlier versions wrote.
fn txt_files(workspace: &Path) -> usize {
    std::fs::read_dir(workspace.join(RESULT_DIR).join(TXT_DIR)).map_or(0, Iterator::count)
}

async fn go<B: Backends>(
    backends: &mut B,
    store: &Store,
    request: &RunRequest,
    ctx: &RunContext,
    cancel: &CancellationToken,
    clock: &impl Fn() -> Timestamp,
) -> (RunSummary, Vec<RunEvent>) {
    let mut events = Vec::new();
    let policy = Mutex::new(Policy::in_memory());
    let summary = run(backends, store, &policy, request, ctx, cancel, clock, |e| {
        events.push(e);
    })
    .await;
    (summary, events)
}

fn finished(events: &[RunEvent]) -> usize {
    events
        .iter()
        .filter(|e| matches!(e, RunEvent::Finished { .. }))
        .count()
}

/// Every event stays below 8 KB (bigger ones the Tauri channel parks in a queue that any
/// page could fetch).
fn assert_small(events: &[RunEvent]) {
    for event in events {
        let size = serde_json::to_vec(event).unwrap().len();
        assert!(size < 8 * 1024, "{size} bytes: {event:?}");
    }
}

/// Without a mailbox a fetch searches the sources: the hits become jobs of the run, their ads
/// are read in the same run, and nothing fails for want of a mailbox.
#[tokio::test(start_paused = true)]
async fn a_fetch_without_a_mailbox_searches_and_reads_the_hits() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let ctx = RunContext {
        read_mail: false,
        search_portals: vec![Portal::Hays],
        search_terms: vec!["Interim CFO".to_owned()],
        ..ctx(dir.path(), true)
    };
    let c = clock();
    let (summary, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(summary.outcome, Outcome::Completed);
    assert!(summary.scan.is_none());
    let found = &summary.search.as_ref().unwrap()[&Portal::Hays];
    // Its first page brought a new job, so its second was asked too (the demo's source shows
    // the same job there, known by then: no third).
    assert_eq!((found.pages, found.hits, found.new), (2, 2, 1));
    assert_eq!(summary.new_jobs.map(|n| n.count), Some(1));
    let key = JobKey {
        portal: Portal::Hays,
        id: "896260".into(),
    };
    assert_eq!(
        store.job(&key).unwrap().unwrap().desc_status,
        DescStatus::Ok
    );
    assert!(events.iter().any(|e| matches!(
        e,
        RunEvent::Progress {
            step: Step::Search,
            portal: Some(Portal::Hays),
            ..
        }
    )));
    assert_small(&events);
}

#[tokio::test(start_paused = true)]
#[expect(clippy::too_many_lines, reason = "one run, checked from every side")]
async fn one_click_run_writes_everything_and_finishes_once() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    assert_eq!(s.kind, RunKindName::Fetch);
    let scan = s.scan.as_ref().unwrap();
    assert_eq!((scan.alert_mails, scan.new), (3, 5));
    let fetch = s.fetch.as_ref().unwrap();
    let ok: usize = fetch.per_portal.values().map(|p| p.ok).sum();
    assert_eq!(ok, 4, "freelance.de shows a portal stop in the dry run");
    let freelance = &fetch.per_portal[&Portal::FreelanceDe];
    assert_eq!(freelance.skipped, 1);
    let paused = PortalHealth::Paused {
        until: None,
        reason: PauseReason::Throttled,
    };
    let health = freelance.stop.as_ref().unwrap().health();
    assert!(
        matches!(
            health,
            PortalHealth::Paused {
                until: Some(_),
                reason: PauseReason::Throttled
            }
        ),
        "{health:?} vs {paused:?}"
    );
    // The per-portal summary: scan and fetch counts side by side.
    let of = |portal| s.per_portal.iter().find(|p| p.portal == portal).unwrap();
    let li = of(Portal::LinkedIn);
    assert_eq!((li.new, li.known, li.dup, li.fetched), (2, 0, 0, 2));
    assert_eq!(li.stopped, None);
    let fl = of(Portal::FreelanceDe);
    assert_eq!((fl.new, fl.fetched, fl.skipped), (1, 0, 1));
    assert_eq!(fl.stopped, Some(health));
    assert!(s.empty_alerts.is_empty());
    // The real engine with the sample profile: scored at the details (high, mid, low,
    // excluded), the job without details in the catch-up.
    assert_eq!(
        s.score,
        Some(ScoreSummary {
            scored: 3,
            excluded: 1,
            unscorable: 1,
            pending: 0,
            best: Some(100),
            delta: None,
        }),
        "a fetch has no delta"
    );
    assert!(
        events.iter().any(|e| matches!(
            e,
            RunEvent::JobUpdated { job, .. } if job.match_.as_ref().is_some_and(|m| m.score == 100)
        )),
        "the ring appears with the details"
    );
    assert!(events.iter().any(|e| matches!(
        e,
        RunEvent::Progress {
            step: Step::Score,
            done: 1,
            total: 1,
            ..
        }
    )));
    assert_eq!(txt_files(dir.path()), 0, "no text files any more");
    assert_eq!(finished(&events), 1);
    assert_small(&events);
    assert!(last_run(&store).unwrap().is_some_and(|l| l.run == s.run));
    // The interface sees waits (countdown), every phase and the portal stop as codes.
    let statuses: Vec<(StatusCode, Option<Portal>, bool)> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::Status {
                code,
                portal,
                until,
            } => Some((*code, *portal, until.is_some())),
            _ => None,
        })
        .collect();
    for phase in [
        (StatusCode::ConnectingMail, None),
        (StatusCode::SearchingMail, None),
        (StatusCode::ReadingMails, None),
        (StatusCode::FetchingDetails, Some(Portal::Freelancermap)),
        (StatusCode::FetchingDetails, Some(Portal::LinkedIn)),
        (StatusCode::FetchingDetails, Some(Portal::FreelanceDe)),
    ] {
        assert!(
            statuses.contains(&(phase.0, phase.1, false)),
            "{phase:?}: {statuses:?}"
        );
    }
    let waits: Vec<_> = statuses.iter().filter(|(.., until)| *until).collect();
    assert!(!waits.is_empty());
    assert!(
        waits
            .iter()
            .all(|(code, portal, _)| *code == StatusCode::Waiting && portal.is_some())
    );
    // After a wait an activity follows again - in between other portals may wait too, they
    // run side by side. The status line never stays on the pause.
    for (i, _) in statuses.iter().enumerate().filter(|(_, (.., wait))| *wait) {
        let next = statuses[i + 1..].iter().find(|(.., wait)| !wait);
        assert!(
            next.is_some_and(|(code, ..)| matches!(
                code,
                StatusCode::FetchingDetails | StatusCode::SigningIn | StatusCode::Scoring
            )),
            "{statuses:?}"
        );
    }
    // `null` instead of a missing field.
    let status_json = serde_json::to_value(status(StatusCode::Scoring, None, None)).unwrap();
    assert_eq!(
        status_json,
        serde_json::json!({"type": "status", "code": "scoring", "portal": null, "until": null})
    );
    assert!(events.iter().any(|e| matches!(
        e,
        RunEvent::PortalHealth { portal: Portal::FreelanceDe, health: h, action_needed }
            if *h == health && *action_needed == health.action_needed()
    )));

    // Second run: nothing new, no text file twice.
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.scan.as_ref().unwrap().new, 0);
    assert_eq!(txt_files(dir.path()), 0);
}

#[tokio::test(start_paused = true)]
async fn cancel_during_fetch_keeps_work() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let cancel = CancellationToken::new();
    let mut events = Vec::new();
    let policy = Mutex::new(Policy::in_memory());
    let s = run(
        &mut DemoBackends,
        &store,
        &policy,
        &request(),
        &ctx(dir.path(), false),
        &cancel,
        &c,
        |e| {
            if matches!(e, RunEvent::JobUpdated { .. }) {
                cancel.cancel();
            }
            events.push(e);
        },
    )
    .await;
    assert_eq!(s.outcome, Outcome::Cancelled);
    let fetched = store
        .jobs(&JobFilter::default())
        .unwrap()
        .iter()
        .filter(|job| job.desc_status == DescStatus::Ok)
        .count();
    assert_eq!(fetched, 1, "what was fetched is stored");
    assert_eq!(finished(&events), 1);
}

/// The mailbox session ends with a logout once the scan is done.
#[tokio::test(start_paused = true)]
async fn the_scan_logs_out() {
    use std::sync::atomic::{AtomicBool, Ordering};

    use crate::mail::imap::MailSource;
    use crate::mail::{RawHead, RawMail};

    static LOGGED_OUT: AtomicBool = AtomicBool::new(false);
    struct Tracked(DemoMail);
    impl MailSource for Tracked {
        async fn search(
            &mut self,
            since: Option<jiff::civil::Date>,
            portals: &[Portal],
        ) -> Result<Vec<u32>, MailError> {
            self.0.search(since, portals).await
        }
        async fn heads(&mut self, uids: &[u32]) -> Result<Vec<RawHead>, MailError> {
            self.0.heads(uids).await
        }
        async fn fetch(&mut self, uids: &[u32]) -> Result<Vec<RawMail>, MailError> {
            self.0.fetch(uids).await
        }
        async fn logout(self) {
            LOGGED_OUT.store(true, Ordering::SeqCst);
        }
    }
    struct WithTracked;
    impl Backends for WithTracked {
        type Mail = Tracked;
        type Pages = DemoPages;
        async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<Tracked, MailError> {
            Ok(Tracked(DemoBackends.connect_mail(cancel).await?))
        }
        fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
            Ok(DemoPages)
        }
    }
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, _) = go(
        &mut WithTracked,
        &store,
        &request(),
        &scan_only(dir.path()),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    assert!(LOGGED_OUT.load(Ordering::SeqCst));
}

/// If the mailbox fails, nothing is fetched - the export still runs.
#[tokio::test(start_paused = true)]
async fn mail_failure_skips_fetch_but_exports() {
    struct Failing;
    impl Backends for Failing {
        type Mail = DemoMail;
        type Pages = DemoPages;
        async fn connect_mail(&mut self, _: &CancellationToken) -> Result<DemoMail, MailError> {
            Err(MailError::Auth(
                "[AUTHENTICATIONFAILED] Invalid credentials".into(),
            ))
        }
        fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
            Ok(DemoPages)
        }
    }
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, events) = go(
        &mut Failing,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(matches!(&s.outcome, Outcome::Failed { error } if error.kind == ErrorKind::MailAuth));
    assert!(s.fetch.is_none());
    assert_eq!(finished(&events), 1);
    // The Gmail reply is for the log only, never in the summary.
    let json = serde_json::to_string(&s).unwrap();
    assert!(!json.contains("AUTHENTICATIONFAILED"), "{json}");
    // A first fetch that failed leaves setup open; one that read the mailbox ends it.
    assert!(!has_completed_fetch(&store));
    go(
        &mut DemoBackends,
        &store,
        &request(),
        &scan_only(dir.path()),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(has_completed_fetch(&store));
}

#[tokio::test(start_paused = true)]
async fn dry_run_writes_nothing() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), true),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    assert!(store.kv_get(LAST_RUN).unwrap().is_none());
}

#[tokio::test(start_paused = true)]
async fn a_portal_must_be_enabled() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let mut context = ctx(dir.path(), false);
    context.portals.clear();
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &context,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(matches!(&s.outcome, Outcome::Failed { error }
        if error.kind == ErrorKind::Invalid && error.params["reason"] == "noPortal"));
}

/// Details switched off for a portal: its alert mails are read, its pages never requested.
#[tokio::test(start_paused = true)]
async fn details_off_means_no_request_to_the_portal() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let mut context = ctx(dir.path(), false);
    context.fetch_portals = vec![Portal::Freelancermap];
    let (s, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &context,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.scan.as_ref().unwrap().new, 5, "all mails are read");
    let requested: Vec<Portal> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::Status {
                code: StatusCode::FetchingDetails | StatusCode::Waiting,
                portal,
                ..
            } => *portal,
            _ => None,
        })
        .collect();
    assert!(
        requested.iter().all(|p| *p == Portal::Freelancermap),
        "{requested:?}"
    );
    // A targeted fetch of a switched-off portal does not request it either.
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4999000002/")
        .unwrap()
        .key;
    let details = RunRequest {
        kind: RunKind::Details { keys: vec![key] },
    };
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &details,
        &context,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.fetch.as_ref().unwrap().queued, 0);
}

/// "Fetch details" for single jobs: only these, without the mailbox.
#[tokio::test(start_paused = true)]
async fn targeted_fetch_only_touches_the_chosen_jobs() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    go(
        &mut DemoBackends,
        &store,
        &request(),
        &scan_only(dir.path()),
        &CancellationToken::new(),
        &c,
    )
    .await;
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4999000002/")
        .unwrap()
        .key;
    let targeted = RunRequest {
        kind: RunKind::Details {
            keys: vec![key.clone()],
        },
    };
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &targeted,
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.kind, RunKindName::Details);
    assert!(s.scan.is_none(), "a targeted fetch without the mailbox");
    assert_eq!(s.fetch.as_ref().unwrap().queued, 1);
    assert_eq!(
        store.job(&key).unwrap().unwrap().desc_status,
        DescStatus::Ok
    );
}

/// Rescore: no mailbox, no fetch - only the export (the score step follows with a matcher).
#[tokio::test(start_paused = true)]
async fn rescore_only_exports() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let (store, _) = store_with_texts();
    let rescore = RunRequest {
        kind: RunKind::Rescore,
    };
    let (s, events) = go(
        &mut DemoBackends,
        &store,
        &rescore,
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(s.scan.is_none() && s.fetch.is_none());
    assert!(s.score.is_some());
    assert_eq!(finished(&events), 1);
}

/// Cancel after k of n job details => exactly k stored, exactly one `Finished`.
#[tokio::test(start_paused = true)]
async fn cancel_after_k_of_n_keeps_exactly_k() {
    for k in 0..=5 {
        let c = clock();
        let dir = tempfile::tempdir().unwrap();
        let store = Store::in_memory().unwrap();
        let cancel = CancellationToken::new();
        let mut events = Vec::new();
        let mut updated = 0;
        let policy = Mutex::new(Policy::in_memory());
        run(
            &mut DemoBackends,
            &store,
            &policy,
            &request(),
            &ctx(dir.path(), false),
            &cancel,
            &c,
            |e| {
                if matches!(e, RunEvent::JobUpdated { .. }) {
                    updated += 1;
                }
                if updated >= k
                    && matches!(
                        e,
                        RunEvent::JobUpdated { .. }
                            | RunEvent::Status { .. }
                            | RunEvent::Progress { .. }
                    )
                {
                    cancel.cancel();
                }
                events.push(e);
            },
        )
        .await;
        let ok = store
            .jobs(&JobFilter::default())
            .unwrap()
            .iter()
            .filter(|j| j.desc_status == DescStatus::Ok)
            .count();
        assert_eq!(ok, updated, "k = {k}");
        assert_eq!(finished(&events), 1, "k = {k}");
    }
}

/// The biggest summary a run can send stays below 8 KB as it sends it (`finished_event`), with
/// every source's counts.
#[test]
fn the_largest_summary_is_a_small_event() {
    let now = Timestamp::now();
    let mut summary = RunSummary::new(RunKindName::Fetch, false, now);
    summary.outcome = Outcome::Failed {
        error: ErrorInfo::new(ErrorKind::Io).with("path", "x".repeat(400)),
    };
    summary.scan = Some(ScanCounts::default());
    summary.per_portal = Portal::ALL
        .into_iter()
        .map(|portal| PortalSummary {
            portal,
            new: 9999,
            known: 9999,
            dup: 9999,
            fetched: 9999,
            failed: 9999,
            gone: 9999,
            skipped: 9999,
            stopped: Some(PortalHealth::LayoutSuspect {
                empty_mails: 9999,
                pages: 99,
            }),
        })
        .collect();
    summary.score = Some(ScoreSummary::default());
    summary.empty_alerts = (0..MAX_EMPTY_ALERTS)
        .map(|_| EmptyAlert {
            portal: Portal::FreelanceDe,
            subject: "ü".repeat(MAX_SUBJECT_CHARS),
            date: Some(now),
            gmail_id: Some(format!("{:x}", u64::MAX)),
        })
        .collect();
    let event = summary.finished_event();
    assert_small(std::slice::from_ref(&event));
    let RunEvent::Finished { summary: sent } = event else {
        panic!("finished");
    };
    assert_eq!(sent.per_portal, summary.per_portal, "every source's counts");
}

/// Two jobs with a full text (without the mailbox).
fn store_with_texts() -> (Store, Vec<JobKey>) {
    fill_texts(Store::in_memory().unwrap())
}

fn fill_texts(store: Store) -> (Store, Vec<JobKey>) {
    let run = store.begin_run().unwrap();
    let mut keys = Vec::new();
    for id in [4_000_000_001_u64, 4_000_000_002] {
        let link =
            crate::portal::job_link(&format!("https://www.linkedin.com/jobs/view/{id}/")).unwrap();
        let posting = crate::model::Posting::new(link.key.clone(), link.url, "Rolle", "", "");
        let mail = crate::store::MailRef {
            subject: "Neue Jobs",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(run, &posting, mail, Timestamp::now())
            .unwrap();
        store
            .record_text(&link.key, "Volltext", false, false, Timestamp::now())
            .unwrap();
        keys.push(link.key);
    }
    (store, keys)
}

/// If no run can be created (database locked or broken), it ends as an error - without
/// mailbox, without fetch, with exactly one `Finished`.
#[tokio::test(start_paused = true)]
async fn a_run_that_cannot_begin_fails() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    store.kv_set("run_seq", "broken").unwrap();
    let (s, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(matches!(&s.outcome, Outcome::Failed { error } if error.kind == ErrorKind::Corrupt));
    assert!(s.scan.is_none() && s.fetch.is_none());
    assert_eq!(s.run, 0);
    assert_eq!(finished(&events), 1);
    assert_eq!(store.job_count().unwrap(), 0);
}

/// The dry-run backends without a matcher.
struct Unscored;

impl Backends for Unscored {
    type Mail = DemoMail;
    type Pages = DemoPages;
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        DemoBackends.connect_mail(cancel).await
    }
    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
        Ok(DemoPages)
    }
}

/// A matcher that judges only LinkedIn jobs, with a changeable revision.
struct Picky(&'static str);

impl Matcher for Picky {
    fn rev(&self) -> &str {
        self.0
    }
    fn assess(&self, job: &JobRow, _text: Option<&str>) -> Option<crate::model::MatchRecord> {
        (job.key.portal == Portal::LinkedIn).then(|| crate::model::MatchRecord {
            status: crate::model::MatchStatus::Scored,
            score: 50,
            note: None,
            must_met: 0,
            must_total: 0,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        })
    }
}

struct WithPicky(&'static str);

impl Backends for WithPicky {
    type Mail = DemoMail;
    type Pages = DemoPages;
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        DemoBackends.connect_mail(cancel).await
    }
    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
        Ok(DemoPages)
    }
    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        Some(Arc::new(Picky(self.0)))
    }
}

/// Without a matcher nothing is scored and the summary has no score; jobs the matcher does
/// not judge stay pending without stalling the catch-up; a new revision scores again.
#[tokio::test(start_paused = true)]
async fn scoring_follows_the_matcher() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, _) = go(
        &mut Unscored,
        &store,
        &request(),
        &scan_only(dir.path()),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.score, None);
    assert!(
        store
            .jobs(&JobFilter::default())
            .unwrap()
            .iter()
            .all(|job| job.match_.is_none())
    );
    let rescore = RunRequest {
        kind: RunKind::Rescore,
    };
    let (s, _) = go(
        &mut WithPicky("r1"),
        &store,
        &rescore,
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    let first = s.score.unwrap();
    assert_eq!((first.scored, first.pending), (2, 3), "{first:?}");
    let (s, _) = go(
        &mut WithPicky("r1"),
        &store,
        &rescore,
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.score.unwrap().scored, 0, "nothing stale");
    let (s, _) = go(
        &mut WithPicky("r2"),
        &store,
        &rescore,
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.score.unwrap().scored, 2, "a new revision scores again");
}

/// Whatever subjects and paths a summary holds, its `Finished` event stays below 8 KB.
#[test]
fn the_finished_event_always_fits_the_channel() {
    let mut summary = RunSummary::new(RunKindName::Fetch, false, Timestamp::now());
    let wide = "\u{1f600}".repeat(crate::view::MAX_SUBJECT_CHARS);
    summary.empty_alerts = (0..MAX_EMPTY_ALERTS)
        .map(|_| crate::view::EmptyAlert {
            portal: Portal::LinkedIn,
            subject: wide.clone(),
            date: None,
            gmail_id: Some("18f0a1b2c3d4e5f6".into()),
        })
        .collect();
    let long = "C:/".to_owned() + &"verzeichnis/".repeat(400);
    summary.outcome = Outcome::Failed {
        error: ErrorInfo::new(ErrorKind::Io).with("path", long),
    };
    assert!(
        serde_json::to_vec(&summary).unwrap().len() > 8 * 1024,
        "too big at first"
    );
    let event = summary.finished_event();
    assert_small(std::slice::from_ref(&event));
    let RunEvent::Finished { summary: fitted } = event else {
        panic!("finished");
    };
    assert!(
        !fitted.empty_alerts.is_empty(),
        "only as much goes as needed"
    );
    let small = RunSummary::new(RunKindName::Fetch, false, Timestamp::now());
    assert_eq!(
        small.finished_event(),
        RunEvent::Finished {
            summary: Box::new(small.clone())
        },
        "a small summary goes out unchanged"
    );
}

/// An engine that panics on LinkedIn jobs (like the splitter once did on some ads).
struct Panicky;

impl Matcher for Panicky {
    fn rev(&self) -> &'static str {
        "boom"
    }
    fn assess(&self, job: &JobRow, text: Option<&str>) -> Option<crate::model::MatchRecord> {
        assert!(job.key.portal != Portal::LinkedIn, "engine bug");
        Picky("boom").assess(job, text)
    }
    fn explain(&self, job: &JobRow, _text: Option<&str>) -> Option<crate::matching::Assessment> {
        assert!(job.key.portal != Portal::LinkedIn, "engine bug");
        None
    }
}

struct WithPanicky;

impl Backends for WithPanicky {
    type Mail = DemoMail;
    type Pages = DemoPages;
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        DemoBackends.connect_mail(cancel).await
    }
    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
        Ok(DemoPages)
    }
    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        Some(Arc::new(Panicky))
    }
}

/// A panic of the engine on one job does not stop the run: the job is
/// unscorable with `engineFailed` and not asked again with the same revision.
#[tokio::test(start_paused = true)]
async fn an_engine_panic_marks_the_job_and_the_run_goes_on() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, _) = go(
        &mut WithPanicky,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    let jobs = store.jobs(&crate::store::JobFilter::default()).unwrap();
    let linkedin: Vec<&JobRow> = jobs
        .iter()
        .filter(|j| j.key.portal == Portal::LinkedIn)
        .collect();
    assert!(!linkedin.is_empty(), "{jobs:?}");
    for job in linkedin {
        let record = job.match_.as_ref().unwrap();
        assert_eq!(record.status, crate::model::MatchStatus::Unscorable);
        assert_eq!(
            record.note.as_ref().unwrap().code,
            super::score::ENGINE_FAILED
        );
        assert_eq!(job.match_rev.as_deref(), Some("boom"), "not asked again");
    }
}

/// A rescore (after the profile was saved) says what it changed: the excluded and the high
/// jobs of the inbox before and after it.
#[tokio::test(start_paused = true)]
async fn a_rescore_says_what_it_changed() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let fetch = ctx(dir.path(), true);
    go(
        &mut DemoBackends,
        &store,
        &request(),
        &fetch,
        &CancellationToken::new(),
        &c,
    )
    .await;
    let scored = store.band_counts().unwrap();
    assert_eq!((scored.excluded, scored.high), (1, 1));
    // As if the profile had changed: no score is left.
    store.clear_matches().unwrap();
    let rescore = RunRequest {
        kind: RunKind::Rescore,
    };
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &rescore,
        &fetch,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(
        s.score.unwrap().delta,
        Some(ScoreDelta {
            excluded_before: 0,
            excluded_after: 1,
            high_before: 0,
            high_after: 1,
        })
    );
    let json = serde_json::to_value(s.finished_event()).unwrap();
    assert_eq!(json["summary"]["score"]["delta"]["highAfter"], 1);
}

/// A run keeps up to two open must requirements per job next to the met ones: the list row
/// and the event carry them, quoted from the ad.
#[tokio::test(start_paused = true)]
async fn a_run_keeps_the_open_musts() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (_, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), true),
        &CancellationToken::new(),
        &c,
    )
    .await;
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4999000002/")
        .unwrap()
        .key;
    let row = store.job(&key).unwrap().unwrap();
    assert_eq!(row.match_open.len(), 2, "{:?}", row.match_open);
    assert!(row.match_open.iter().all(|o| !o.is_empty()));
    let shown = events.iter().rev().find_map(|e| match e {
        RunEvent::JobUpdated { job, .. } if job.key == key => job.match_.clone(),
        _ => None,
    });
    assert_eq!(shown.unwrap().open, row.match_open);
}

/// The request JSON is flat, and every kind round-trips.
#[test]
fn run_requests_are_flat_json() {
    let request: RunRequest = serde_json::from_str(
        r#"{"kind":"details","keys":[{"portal":"linkedin","id":"4123456789"}]}"#,
    )
    .unwrap();
    assert_eq!(request.kind.name(), RunKindName::Details);
    for kind in ["fetch", "rescore"] {
        let json = format!(r#"{{"kind":"{kind}"}}"#);
        let request: RunRequest = serde_json::from_str(&json).unwrap();
        assert_eq!(serde_json::to_string(&request).unwrap(), json);
    }
    // The whole mailbox is the fetch range "Alle Alert-Mails" now, no kind of its own.
    for gone in ["scan", "fullMailbox"] {
        let json = format!(r#"{{"kind":"{gone}"}}"#);
        assert!(serde_json::from_str::<RunRequest>(&json).is_err(), "{gone}");
    }
}

/// A run writes no text files and no `top_matches.json` any more (the external matching skill
/// is gone); what earlier versions wrote stays untouched until "reset everything", which
/// still knows it.
#[tokio::test(start_paused = true)]
async fn a_run_writes_no_text_files_and_no_top_matches() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let result_dir = dir.path().join(RESULT_DIR);
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    assert!(!result_dir.join(TXT_DIR).exists());
    assert!(!result_dir.join("top_matches.json").exists());
    assert!(
        store
            .jobs(&JobFilter::default())
            .unwrap()
            .iter()
            .all(|job| job.txt_name.is_none())
    );
    // The files of an earlier version stay as they are through the next run.
    let old = result_dir.join("top_matches.json");
    std::fs::create_dir_all(&result_dir).unwrap();
    std::fs::write(&old, b"{}").unwrap();
    std::fs::create_dir_all(result_dir.join(TXT_DIR)).unwrap();
    std::fs::write(result_dir.join(TXT_DIR).join("old.txt"), b"alt").unwrap();
    go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(std::fs::read(&old).unwrap(), b"{}");
    assert_eq!(txt_files(dir.path()), 1);
    assert!(
        export::app_files(&result_dir, &[]).contains(&old),
        "a reset takes it"
    );
}

/// Records which fetch path the run builds per portal (mails and pages from the demo).
#[derive(Default)]
struct Paths(Vec<(Portal, FetchPath)>);

impl Backends for Paths {
    type Mail = DemoMail;
    type Pages = DemoPages;
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        DemoBackends.connect_mail(cancel).await
    }
    fn pages(&mut self, portal: Portal, path: FetchPath) -> Result<DemoPages, String> {
        self.0.push((portal, path));
        Ok(DemoPages)
    }
}

/// The switches reach the fetch: a portal off = no fetch path at all (zero requests);
/// sign-in off = the guest path, never a session window; sign-in on = the session window.
#[tokio::test(start_paused = true)]
async fn switches_decide_the_fetch_path() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let mut settings = crate::settings::Settings::default();
    settings.portals.get_mut(&Portal::LinkedIn).unwrap().enabled = false;
    let context = RunContext {
        fetch_portals: settings.fetch_portals(),
        sign_in: Vec::new(),
        ..ctx(dir.path(), false)
    };
    let mut paths = Paths::default();
    let (s, _) = go(
        &mut paths,
        &store,
        &request(),
        &context,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.outcome, Outcome::Completed);
    assert_eq!(
        paths.0,
        [
            (Portal::Freelancermap, FetchPath::Guest),
            (Portal::FreelanceDe, FetchPath::Guest)
        ]
    );
    let fetch = s.fetch.unwrap();
    assert!(!fetch.per_portal.contains_key(&Portal::LinkedIn));

    let context = RunContext {
        sign_in: vec![Portal::FreelanceDe],
        ..context
    };
    let mut paths = Paths::default();
    let store = Store::in_memory().unwrap();
    go(
        &mut paths,
        &store,
        &request(),
        &context,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(paths.0.contains(&(Portal::FreelanceDe, FetchPath::Session)));
}

/// The demo, with the fetch paths read from the stored settings like in the app.
struct Stored(Arc<Store>);

impl Backends for Stored {
    type Mail = DemoMail;
    type Pages = DemoPages;
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        DemoBackends.connect_mail(cancel).await
    }
    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
        Ok(DemoPages)
    }
    fn live_paths(&self) -> Option<LivePaths> {
        Some(stored_paths(Arc::clone(&self.0)))
    }
}

/// A portal switched off while the run fetches gets no further request, although the run
/// started with it switched on ("off = zero requests").
#[tokio::test(start_paused = true)]
async fn a_portal_switched_off_during_the_run_stops_at_once() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Arc::new(Store::in_memory().unwrap());
    let settings = crate::settings::Settings::default();
    settings.save(&store).unwrap();
    let context = RunContext {
        fetch_portals: settings.fetch_portals(),
        sign_in: Vec::new(),
        ..ctx(dir.path(), false)
    };
    let policy = Mutex::new(Policy::in_memory());
    let mut switched = false;
    let summary = run(
        &mut Stored(Arc::clone(&store)),
        &store,
        &policy,
        &request(),
        &context,
        &CancellationToken::new(),
        &c,
        |event| {
            if let RunEvent::JobUpdated { job, .. } = &event
                && job.key.portal == Portal::LinkedIn
                && !switched
            {
                switched = true;
                let mut off = crate::settings::Settings::load(&store).unwrap();
                off.portals.get_mut(&Portal::LinkedIn).unwrap().enabled = false;
                off.save(&store).unwrap();
            }
        },
    )
    .await;
    assert_eq!(summary.outcome, Outcome::Completed);
    let li = summary
        .per_portal
        .iter()
        .find(|p| p.portal == Portal::LinkedIn)
        .unwrap();
    assert_eq!((li.new, li.fetched, li.skipped), (2, 1, 1));
}

/// Every run begins with exactly one `Started` naming its kind: the page also follows the
/// runs it did not start itself (a rescore after a profile change) as what they are.
#[tokio::test(start_paused = true)]
async fn every_run_starts_with_its_kind() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4999000002/")
        .unwrap()
        .key;
    let kinds = [
        (RunKind::Fetch, RunKindName::Fetch),
        (RunKind::Details { keys: vec![key] }, RunKindName::Details),
        (RunKind::Rescore, RunKindName::Rescore),
    ];
    for (kind, name) in kinds {
        let (s, events) = go(
            &mut DemoBackends,
            &store,
            &RunRequest { kind },
            &ctx(dir.path(), false),
            &CancellationToken::new(),
            &c,
        )
        .await;
        assert_eq!(s.kind, name);
        assert_eq!(events.first(), Some(&RunEvent::Started { kind: name }));
        let started = events
            .iter()
            .filter(|e| matches!(e, RunEvent::Started { .. }))
            .count();
        assert_eq!((started, finished(&events)), (1, 1), "{name:?}");
        assert_small(&events);
    }
    // A run that cannot even begin says what it was, too.
    store.kv_set("run_seq", "broken").unwrap();
    let (_, events) = go(
        &mut DemoBackends,
        &store,
        &RunRequest {
            kind: RunKind::Rescore,
        },
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(
        events.first(),
        Some(&RunEvent::Started {
            kind: RunKindName::Rescore
        })
    );
    assert_eq!(finished(&events), 1);
}

/// "The last fetch" is the last mailbox run: a details run or a rescore never replaces it
/// (the sidebar, the failed-fetch retry and the empty alert mails all read it); a fetch that
/// fails before the mailbox (no portal) is still one.
#[tokio::test(start_paused = true)]
async fn the_last_run_is_the_last_fetch() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (fetch, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &scan_only(dir.path()),
        &CancellationToken::new(),
        &c,
    )
    .await;
    let last = || last_run(&store).unwrap().unwrap();
    assert_eq!((last().run, last().kind), (fetch.run, RunKindName::Fetch));
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4999000002/")
        .unwrap()
        .key;
    for kind in [RunKind::Details { keys: vec![key] }, RunKind::Rescore] {
        let (s, _) = go(
            &mut DemoBackends,
            &store,
            &RunRequest { kind },
            &ctx(dir.path(), false),
            &CancellationToken::new(),
            &c,
        )
        .await;
        assert!(s.run > fetch.run && s.outcome == Outcome::Completed);
        assert_eq!(last().run, fetch.run, "{:?} is no fetch", s.kind);
    }
    let mut none = ctx(dir.path(), false);
    none.portals.clear();
    let (failed, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &none,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert!(matches!(failed.outcome, Outcome::Failed { .. }));
    assert_eq!(last().run, failed.run, "a failed fetch is the last fetch");
}

/// What the run card counts, from the run itself: its new jobs (first seen in it, a
/// duplicate once, excluded ones left out) and how many of them fit well - not a capped top
/// list, not the scan's count with the excluded ones. Rows of the run say whether a job is
/// new in it.
#[tokio::test(start_paused = true)]
async fn a_fetch_counts_its_new_jobs() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (s, events) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    let mut expected = NewJobs::default();
    let first_seen = store
        .jobs(&JobFilter {
            first_seen_run: Some(s.run),
            ..JobFilter::default()
        })
        .unwrap();
    for job in &first_seen {
        let status = job.match_.as_ref().map(|m| (m.status, m.score));
        if store.dup_of(&job.key).unwrap().is_some()
            || matches!(status, Some((crate::model::MatchStatus::Excluded, _)))
        {
            continue;
        }
        expected.count += 1;
        if matches!(status, Some((crate::model::MatchStatus::Scored, points))
            if points >= crate::model::HIGH_FROM)
        {
            expected.high += 1;
        }
    }
    assert_eq!(s.new_jobs, Some(expected));
    let scan = s.scan.as_ref().unwrap();
    assert!(expected.high >= 1, "the sample has a job that fits well");
    assert!(
        expected.count < scan.new,
        "the excluded job is no new job of the card: {expected:?} vs {} new",
        scan.new
    );
    let updated: Vec<bool> = events
        .iter()
        .filter_map(|e| match e {
            RunEvent::JobUpdated { fresh, .. } => Some(*fresh),
            _ => None,
        })
        .collect();
    assert!(!updated.is_empty() && updated.iter().all(|fresh| *fresh));
    // The stored "last fetch" has the numbers too (the run card after a restart).
    assert_eq!(last_run(&store).unwrap().unwrap().new_jobs, Some(expected));

    // Details of an older job: no mailbox, no new jobs, and its row is no new one.
    let key = first_seen
        .iter()
        .find(|job| job.desc_status != DescStatus::Ok)
        .map(|job| job.key.clone())
        .expect("a job without details");
    let (d, events) = go(
        &mut DemoBackends,
        &store,
        &RunRequest {
            kind: RunKind::Details { keys: vec![key] },
        },
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(d.new_jobs, None);
    assert!(
        events
            .iter()
            .all(|e| !matches!(e, RunEvent::JobUpdated { fresh: true, .. }))
    );
    let (r, _) = go(
        &mut DemoBackends,
        &store,
        &RunRequest {
            kind: RunKind::Rescore,
        },
        &ctx(dir.path(), false),
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(r.new_jobs, None);
}

/// Summaries stored by an earlier version (without `newJobs`, of a run over the whole
/// mailbox, or with the counts of the text files it wrote) are still read, the second as a
/// fetch, the text files forgotten.
#[test]
fn an_older_stored_summary_still_reads() {
    let store = Store::in_memory().unwrap();
    let summary = RunSummary::new(RunKindName::Fetch, false, Timestamp::now());
    let mut json = serde_json::to_value(&summary).unwrap();
    json.as_object_mut().unwrap().remove("newJobs");
    store.kv_set(LAST_RUN, &json.to_string()).unwrap();
    assert_eq!(last_run(&store).unwrap(), Some(summary.clone()));
    json["kind"] = "fullMailbox".into();
    store.kv_set(LAST_RUN, &json.to_string()).unwrap();
    assert_eq!(last_run(&store).unwrap(), Some(summary.clone()));
    // The export of an earlier version (its files, its counts of text files) is forgotten.
    let mut json = serde_json::to_value(&summary).unwrap();
    json["export"] = serde_json::json!({"overviewXlsx": null, "txtWritten": 7, "txtFailed": 0});
    store.kv_set(LAST_RUN, &json.to_string()).unwrap();
    assert_eq!(last_run(&store).unwrap(), Some(summary));
}

/// A job deleted for good takes the text file an earlier version wrote for it along, and the
/// next run never brings it back from the old alert mail.
#[tokio::test(start_paused = true)]
async fn a_deleted_job_leaves_its_files_and_stays_gone() {
    let c = clock();
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let fetch = ctx(dir.path(), false);
    go(
        &mut DemoBackends,
        &store,
        &request(),
        &fetch,
        &CancellationToken::new(),
        &c,
    )
    .await;
    let listed = |store: &Store| {
        let filter = JobFilter {
            listed: true,
            ..JobFilter::default()
        };
        store.jobs(&filter).unwrap().len()
    };
    assert!(listed(&store) > 0);
    let total = store.job_count().unwrap();
    let victim = store
        .jobs(&JobFilter::default())
        .unwrap()
        .into_iter()
        .find(|job| job.desc_status == DescStatus::Ok && job.place() == Place::Inbox)
        .unwrap();
    // An earlier version wrote a text file for it.
    let txt_dir = dir.path().join(RESULT_DIR).join(TXT_DIR);
    std::fs::create_dir_all(&txt_dir).unwrap();
    let file = txt_dir.join("20260901_LinkedIn_Rolle_1.txt");
    std::fs::write(&file, b"alt").unwrap();
    store.mark_old_txt(&victim.key, "20260901_LinkedIn_Rolle_1.txt", c());
    let one = std::slice::from_ref(&victim.key);
    // Only the trash is deleted for good.
    let kept = delete_jobs(&store, Some(dir.path()), one, c()).unwrap();
    assert_eq!(kept.count, 0);
    assert!(file.exists());
    store.move_jobs(one, Place::Trash, c()).unwrap();
    let deleted = delete_jobs(&store, Some(dir.path()), one, c()).unwrap();
    assert_eq!(deleted.count, 1, "the one row the user deleted");
    let gone = i64::try_from(deleted.keys.len()).unwrap();
    assert!(!file.exists());
    assert_eq!(store.job_count().unwrap(), total - gone);
    let files = txt_files(dir.path());
    // The next run reads the same alert mails: the job stays deleted.
    let (s, _) = go(
        &mut DemoBackends,
        &store,
        &request(),
        &fetch,
        &CancellationToken::new(),
        &c,
    )
    .await;
    assert_eq!(s.scan.as_ref().unwrap().new, 0);
    assert!(store.job(&victim.key).unwrap().is_none());
    assert_eq!(store.job_count().unwrap(), total - gone);
    assert_eq!(txt_files(dir.path()), files);
    assert!(!file.exists());
}

/// One job two portals announced, as the list shows it: the freelancermap row with the
/// LinkedIn duplicate behind it. `(original, duplicate)`.
fn job_on_two_portals(store: &Store) -> (JobKey, JobKey) {
    const AD: &str = "Für unseren Kunden suchen wir einen erfahrenen SAP FI/CO Berater. \
        Aufgaben: Einführung von S/4HANA Finance, Abstimmung mit den Fachbereichen.";
    let run = store.begin_run().unwrap();
    let add = |url: &str| {
        let link = crate::portal::job_link(url).unwrap();
        let posting = crate::model::Posting::new(
            link.key.clone(),
            link.url,
            "SAP FI/CO Berater (m/w/d)",
            "Ferrum Systems SE",
            "Hamburg",
        );
        let mail = crate::store::MailRef {
            subject: "Neue Jobs",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(run, &posting, mail, Timestamp::now())
            .unwrap();
        store
            .record_text(&link.key, AD, false, false, Timestamp::now())
            .unwrap();
        link.key
    };
    let original = add("https://www.freelancermap.de/nproj/12345.html");
    let duplicate = add("https://www.linkedin.com/jobs/view/4000000002/");
    assert_eq!(
        store.link_duplicate(&duplicate).unwrap(),
        Some(original.clone())
    );
    (original, duplicate)
}

/// "Endgültig löschen" counts the jobs the list showed: a duplicate that stood behind the
/// row goes with it (its key comes back for the page) but is no job of its own.
#[test]
fn a_purge_counts_the_rows_it_deleted() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::in_memory().unwrap();
    let (original, duplicate) = job_on_two_portals(&store);
    let now = Timestamp::now();
    let one = std::slice::from_ref(&original);
    store.move_jobs(one, Place::Trash, now).unwrap();
    let deleted = delete_jobs(&store, Some(dir.path()), one, now).unwrap();
    assert_eq!(deleted.count, 1, "one row");
    assert_eq!(deleted.keys.len(), 2);
    assert!(
        deleted.keys.contains(&duplicate),
        "the page drops both keys"
    );
    assert!(store.txt_leftovers().unwrap().is_empty());
    // Emptying the whole trash counts the same way.
    let (store, keys) = store_with_texts();
    store.move_jobs(&keys, Place::Trash, now).unwrap();
    let all = store.trashed_keys().unwrap();
    let deleted = delete_jobs(&store, Some(dir.path()), &all, now).unwrap();
    assert_eq!(deleted.count, 2);
}

/// The text file of a job deleted for good that could not be removed is not forgotten with
/// its row: a reset still finds it, and the next delete for good removes it.
#[test]
fn a_text_file_that_stayed_is_removed_later() {
    let dir = tempfile::tempdir().unwrap();
    let (store, keys) = store_with_texts();
    let now = Timestamp::now();
    let result_dir = dir.path().join(RESULT_DIR);
    let txt_dir = result_dir.join(TXT_DIR);
    std::fs::create_dir_all(&txt_dir).unwrap();
    let (stayed, gone) = (
        "20260901_LinkedIn_Rolle_4000000007.txt".to_string(),
        "20260901_LinkedIn_Rolle_4000000008.txt".to_string(),
    );
    std::fs::write(txt_dir.join(&stayed), b"alt").unwrap();
    store
        .set_txt_leftovers(&[stayed.clone(), gone.clone()])
        .unwrap();
    assert!(store.txt_names().unwrap().contains(&stayed), "still known");
    assert_eq!(
        export::txt_files(&result_dir, &store.txt_names().unwrap()).len(),
        1
    );
    let next = std::slice::from_ref(&keys[1]);
    store.move_jobs(next, Place::Trash, now).unwrap();
    delete_jobs(&store, Some(dir.path()), next, now).unwrap();
    assert!(
        !txt_dir.join(&stayed).exists(),
        "removed with the next delete"
    );
    assert!(store.txt_leftovers().unwrap().is_empty(), "and forgotten");
}

/// An old text file open in another program (Windows: without delete sharing, as Word holds
/// it) stays when its job is deleted for good; it is remembered, and the next delete for good
/// removes it.
#[cfg(windows)]
#[test]
fn an_open_text_file_of_a_deleted_job_is_remembered_and_removed_later() {
    use std::os::windows::fs::OpenOptionsExt;
    let dir = tempfile::tempdir().unwrap();
    let (store, keys) = store_with_texts();
    let now = Timestamp::now();
    // The text file an earlier version wrote for the job.
    let name = "20260901_LinkedIn_Rolle_4000000001.txt".to_owned();
    let txt_dir = dir.path().join(RESULT_DIR).join(TXT_DIR);
    std::fs::create_dir_all(&txt_dir).unwrap();
    let file = txt_dir.join(&name);
    std::fs::write(&file, b"alt").unwrap();
    store.mark_old_txt(&keys[0], &name, now);
    let one = std::slice::from_ref(&keys[0]);
    store.move_jobs(one, Place::Trash, now).unwrap();
    let lock = std::fs::OpenOptions::new()
        .read(true)
        .share_mode(0)
        .open(&file)
        .unwrap();
    let deleted = delete_jobs(&store, Some(dir.path()), one, now).unwrap();
    assert_eq!(deleted.count, 1);
    assert!(file.exists());
    assert_eq!(store.txt_leftovers().unwrap(), std::slice::from_ref(&name));
    assert!(store.txt_names().unwrap().contains(&name));
    drop(lock);
    let next = std::slice::from_ref(&keys[1]);
    store.move_jobs(next, Place::Trash, now).unwrap();
    delete_jobs(&store, Some(dir.path()), next, now).unwrap();
    assert!(!file.exists());
    assert!(store.txt_leftovers().unwrap().is_empty());
}
