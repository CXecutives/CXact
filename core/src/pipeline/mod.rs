//! One click: mailbox -> new jobs -> job details -> export.
//!
//! The run kinds pick the steps (`RunKind`); the portals come from the settings, never from
//! the page. The export always runs at the end - after a cancellation, a portal stop or an
//! error too (it is purely local). Every run starts with exactly one `Started` (its kind: the
//! page also follows runs it did not start) and ends with exactly one `Finished`; the summary
//! of a fetch is also stored as `last_run_summary` - "the last fetch" for the page, which a
//! rescore or a details run never replaces. Events carry codes
//! and data, never prose; the log gets English lines with the run id (never content,
//! addresses or passwords).

pub mod demo;
pub mod local;
pub mod rescore;
pub mod score;

use std::collections::BTreeMap;
use std::future::Future;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use jiff::Timestamp;
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

use crate::error::{ErrorInfo, InvalidInput};
use crate::export::{self, RESULT_DIR};
use crate::fetch::policy::Policy;
use crate::fetch::search::{SearchCounts, SearchEvent, search_all};
use crate::fetch::{
    FetchEvent, FetchSummary, PageFetcher, PortalHealth, Prescore, Selection, fetch_all,
    neutral_prescore,
};
use crate::mail::imap::{MailError, MailSource};
use crate::mail::scan::{ScanError, ScanEvent, ScanSummary, Scope, scan};
use crate::portal::{FetchPath, JobKey, Portal};
use crate::settings::Language;
use crate::store::Store;
use crate::text::truncate_chars;
use crate::time;
use crate::view::{Deleted, EmptyAlert, JobView, MAX_SUBJECT_CHARS};
pub use local::LocalMatcher;
pub use score::Matcher;
use score::Tally;

/// What the interface starts. The JSON is flat: `{ "kind": "details", "keys": [...] }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct RunRequest {
    #[serde(flatten)]
    #[cfg_attr(test, ts(flatten))]
    pub kind: RunKind,
}

/// The kinds of run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum RunKind {
    /// The alert mails of the enabled portals in the range the settings choose
    /// (`fetchRange`), their job details, export.
    Fetch,
    /// Job details of exactly these jobs (older ones too), export.
    Details { keys: Vec<JobKey> },
    /// Score again with the current profile, export.
    Rescore,
}

/// The kind of a run without its data (summary, snapshot).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum RunKindName {
    Fetch,
    Details,
    Rescore,
}

impl RunKindName {
    /// A mailbox run: the kind "the last fetch" means.
    pub fn reads_mail(self) -> bool {
        self == RunKindName::Fetch
    }
}

impl RunKind {
    pub fn name(&self) -> RunKindName {
        match self {
            RunKind::Fetch => RunKindName::Fetch,
            RunKind::Details { .. } => RunKindName::Details,
            RunKind::Rescore => RunKindName::Rescore,
        }
    }
}

/// Run settings that do not come from the page.
#[derive(Debug, Clone)]
pub struct RunContext {
    pub workspace: PathBuf,
    /// Dry run: nothing is written.
    pub dry_run: bool,
    /// Portals whose alert mails are read (settings: enabled).
    pub portals: Vec<Portal>,
    /// Portals whose job pages may be fetched (settings: enabled).
    pub fetch_portals: Vec<Portal>,
    /// Of those, the portals read in the session window (sign-in switched on); the others
    /// go as a guest. A run never opens a session window for any other portal.
    pub sign_in: Vec<Portal>,
    /// Language of the Excel file (the text files stay German).
    pub language: Language,
    /// The Gmail address the run reads (`None` without a mailbox step or in the dry run):
    /// after a successful scan the files link the alert mails in its account.
    pub mailbox: Option<String>,
    /// Whether a fetch reads the mailbox (`false`: none is connected, the run only searches).
    pub read_mail: bool,
    /// The sources the app searches itself (switched on, `Way::Search`).
    pub search_portals: Vec<Portal>,
    /// What it searches for: the active profile's search terms.
    pub search_terms: Vec<String>,
}

impl RunContext {
    /// The fetch path of a portal in this run.
    pub fn path(&self, portal: Portal) -> FetchPath {
        if self.sign_in.contains(&portal) {
            FetchPath::Session
        } else {
            FetchPath::Guest
        }
    }
}

/// Mailbox and fetch routes of a run (dummies in tests and in the dry run).
pub trait Backends {
    type Mail: MailSource + Send;
    type Pages: PageFetcher + Send;
    fn connect_mail(
        &mut self,
        cancel: &CancellationToken,
    ) -> impl Future<Output = Result<Self::Mail, MailError>> + Send;
    /// Fetch path of **one** portal - only the one `path` names: own HTTP session or own
    /// window. The portals run side by side and therefore share none.
    fn pages(&mut self, portal: Portal, path: FetchPath) -> Result<Self::Pages, String>;
    /// The matcher of the run; `None` = nothing is scored (no usable profile or engine).
    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        None
    }
    /// The pre-score that orders the fetch queue of a portal (`matching::prescore` with the
    /// profile); neutral by default - then the newest mail comes first.
    fn prescore(&self) -> Prescore {
        neutral_prescore()
    }
    /// The fetch path of every portal as the settings say right now, asked before every
    /// request: a portal switched off (or to another path) during the run gets no further
    /// request. `None` by default - the paths stay as the run started.
    fn live_paths(&self) -> Option<LivePaths> {
        None
    }
}

/// The current fetch path of a portal (`None` = switched off), see [`Backends::live_paths`].
pub type LivePaths = Arc<dyn Fn(Portal) -> Option<FetchPath> + Send + Sync>;

/// The fetch paths as the stored settings say right now (the app's
/// [`Backends::live_paths`]). Unreadable settings count as switched off: no request without
/// a readable switch.
pub fn stored_paths(store: Arc<Store>) -> LivePaths {
    Arc::new(move |portal| {
        crate::settings::Settings::load(&store)
            .ok()
            .and_then(|settings| settings.fetch_path(portal))
    })
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Step {
    Scan,
    /// The app's own search of the sources (user decision 2026-10-01).
    Search,
    Fetch,
    Score,
}

/// What is happening right now.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum StatusCode {
    ConnectingMail,
    SearchingMail,
    ReadingMails,
    /// A source's own search (the portal named).
    Searching,
    FetchingDetails,
    SigningIn,
    /// Gap before the next request of a portal (`until` for a countdown).
    Waiting,
    Scoring,
}

/// Events to the interface. Each stays small (< 8 KB; bigger messages bypass the ACL of the
/// Tauri channel): full texts and job rows are fetched by the page itself (`list_jobs`,
/// `job_detail`). Struct variants only - with `tag = "type"` a newtype variant would merge
/// into the tag.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(
    tag = "type",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum RunEvent {
    /// The first event of every run: its kind (the rescores the app starts by itself
    /// included).
    Started { kind: RunKindName },
    Progress {
        step: Step,
        portal: Option<Portal>,
        done: usize,
        total: usize,
    },
    /// What is happening; `until`: end of a wait (the interface shows a countdown).
    Status {
        code: StatusCode,
        portal: Option<Portal>,
        until: Option<Timestamp>,
    },
    Alert {
        portal: Portal,
        subject: String,
        date: Option<Timestamp>,
        postings: usize,
        /// Gmail message id (hexadecimal) - opened through `open_target`.
        gmail_id: Option<String>,
    },
    /// A job has a new state - the finished list row. `fresh`: first seen in this run (a
    /// new job, not one the page may already list further down).
    JobUpdated { job: Box<JobView>, fresh: bool },
    /// A portal stopped for the rest of the run, or its health changed. `action_needed`:
    /// the user has to act ([`PortalHealth::action_needed`]).
    PortalHealth {
        portal: Portal,
        health: PortalHealth,
        action_needed: bool,
    },
    /// Sign-in needed: the session window is open (`waiting`) or closed again.
    LoginNeeded { portal: Portal, waiting: bool },
    /// The end. A named field, no newtype (see above).
    Finished { summary: Box<RunSummary> },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Outcome {
    Completed,
    Cancelled,
    Failed { error: ErrorInfo },
}

/// Counters of the mailbox step. Invariant: `postings = new + known + dup`.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ScanCounts {
    pub mails_found: usize,
    pub mails_checked: usize,
    /// Unreadable mails (counted instead of dropped silently).
    pub mails_defective: usize,
    pub alert_mails: usize,
    /// Alert mails without a recognised job (layout changed?).
    pub empty_alerts: usize,
    pub postings: usize,
    pub new: usize,
    pub known: usize,
    pub dup: usize,
}

impl From<&ScanSummary> for ScanCounts {
    fn from(s: &ScanSummary) -> ScanCounts {
        ScanCounts {
            mails_found: s.mails_found,
            mails_checked: s.mails_checked,
            mails_defective: s.mails_defective,
            alert_mails: s.alert_mails,
            empty_alerts: s.zero_posting_mails,
            postings: s.postings_total,
            new: s.new,
            known: s.known_before,
            dup: s.dup_in_run,
        }
    }
}

/// One portal in the run summary.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalSummary {
    pub portal: Portal,
    pub new: usize,
    pub known: usize,
    pub dup: usize,
    /// Job details fetched (full text found).
    pub fetched: usize,
    /// Pages without a description.
    pub failed: usize,
    /// Ads that no longer exist.
    pub gone: usize,
    /// Jobs left for later (pause, cap, sign-in, breaker, network).
    pub skipped: usize,
    /// Why the portal stopped in this run.
    pub stopped: Option<PortalHealth>,
}

/// Counters of the score step.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ScoreSummary {
    pub scored: usize,
    pub excluded: usize,
    pub unscorable: usize,
    /// Jobs still waiting for a score.
    pub pending: usize,
    pub best: Option<u8>,
    /// A rescore (after the profile was saved) only: the excluded and the high-band jobs of
    /// the inbox before and after it.
    #[serde(default)]
    pub delta: Option<ScoreDelta>,
}

/// What a rescore changed: the excluded and the high-band jobs of the inbox (no duplicate)
/// before and after it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ScoreDelta {
    pub excluded_before: u32,
    pub excluded_after: u32,
    pub high_before: u32,
    pub high_after: u32,
}

/// The jobs a mailbox run brought - the "neue Jobs" of the run card: first seen in the run
/// (a job several portals announce counts once, as its original), excluded ones left out;
/// `high`: how many of them are scored in the high band.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct NewJobs {
    pub count: usize,
    pub high: usize,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct RunSummary {
    pub run: i64,
    pub kind: RunKindName,
    pub outcome: Outcome,
    pub dry_run: bool,
    pub started_at: Timestamp,
    pub finished_at: Timestamp,
    pub scan: Option<ScanCounts>,
    pub per_portal: Vec<PortalSummary>,
    /// Set by a mailbox run (summaries of earlier versions have none).
    #[serde(default)]
    pub new_jobs: Option<NewJobs>,
    pub score: Option<ScoreSummary>,
    /// Alert mails of this run without recognised jobs (at most [`MAX_EMPTY_ALERTS`]).
    pub empty_alerts: Vec<EmptyAlert>,
    /// Counters of the fetch step (tests and log only).
    #[serde(skip)]
    pub fetch: Option<FetchSummary>,
    /// Counters of the search, per source (tests and log only).
    #[serde(skip)]
    pub search: Option<BTreeMap<Portal, SearchCounts>>,
}

impl RunSummary {
    pub fn new(kind: RunKindName, dry_run: bool, started_at: Timestamp) -> RunSummary {
        RunSummary {
            run: 0,
            kind,
            outcome: Outcome::Completed,
            dry_run,
            started_at,
            finished_at: started_at,
            scan: None,
            per_portal: Vec::new(),
            new_jobs: None,
            score: None,
            empty_alerts: Vec::new(),
            fetch: None,
            search: None,
        }
    }

    /// The summary as the `Finished` event, below [`MAX_EVENT_BYTES`] whatever subjects,
    /// paths and error params it holds: empty alert mails go from the end first, then error
    /// params, then the file paths (the stored summary keeps everything).
    pub fn finished_event(&self) -> RunEvent {
        // `{"type":"finished","summary":...}` around the summary.
        const ENVELOPE: usize = 64;
        let mut summary = self.clone();
        let fits = |s: &RunSummary| {
            serde_json::to_vec(s).is_ok_and(|json| json.len() + ENVELOPE <= MAX_EVENT_BYTES)
        };
        while !fits(&summary) {
            if summary.empty_alerts.pop().is_some() {
                continue;
            }
            if let Outcome::Failed { error } = &mut summary.outcome
                && !error.params.is_empty()
            {
                error.params.clear();
                continue;
            }
            break;
        }
        RunEvent::Finished {
            summary: Box::new(summary),
        }
    }
}

/// A run in progress, for a page that attaches again (reload): what it is and the events
/// that describe its current state (last status and progress, portal health, alerts).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct RunSnapshot {
    pub kind: RunKindName,
    pub started_at: Timestamp,
    pub replay: Vec<RunEvent>,
}

/// Summary of the last mailbox run, "the last fetch" (JSON).
pub const LAST_RUN: &str = "last_run_summary";
/// Number of the last run with a mailbox scan.
const LAST_SCAN_RUN: &str = "last_scan_run";
/// So many empty alert mails a summary carries (the event must stay small).
pub const MAX_EMPTY_ALERTS: usize = 10;
/// Largest `Finished` event in bytes of JSON: Tauri channel messages above 8 KB bypass the
/// ACL (a margin for the channel's own framing).
pub const MAX_EVENT_BYTES: usize = 7 * 1024;
/// Start of the last successful mailbox scan (Unix seconds).
const LAST_FETCH_AT: &str = "last_fetch_at";

/// What a run kind does.
struct Plan<'a> {
    scan: Option<Scope>,
    /// The sources' own search (a fetch with sources to search and terms to search for).
    search: bool,
    fetch: Option<Selection<'a>>,
}

impl<'a> Plan<'a> {
    fn of(kind: &'a RunKind, ctx: &'a RunContext) -> Plan<'a> {
        let queue = Some(Selection::Queue(&ctx.fetch_portals));
        match kind {
            RunKind::Fetch => {
                let search = !ctx.search_portals.is_empty() && !ctx.search_terms.is_empty();
                Plan {
                    // Without a mailbox a fetch only searches; with neither the scan says why.
                    scan: (ctx.read_mail || !search).then_some(Scope::New),
                    search,
                    fetch: queue,
                }
            }
            RunKind::Details { keys } => Plan {
                scan: None,
                search: false,
                fetch: Some(Selection::Jobs(keys, &ctx.fetch_portals)),
            },
            RunKind::Rescore => Plan {
                scan: None,
                search: false,
                fetch: None,
            },
        }
    }
}

/// Runs a run. Database errors end it as `Failed`; the export still runs - unless the run
/// could not even be created.
#[expect(
    clippy::too_many_arguments,
    clippy::too_many_lines,
    reason = "store, rules, request, cancellation, clock and events separately (replaceable in \
              tests); the steps of a run read best in one place"
)]
pub async fn run<B: Backends>(
    backends: &mut B,
    store: &Store,
    policy: &Mutex<Policy>,
    request: &RunRequest,
    ctx: &RunContext,
    cancel: &CancellationToken,
    clock: impl Fn() -> Timestamp,
    mut emit: impl FnMut(RunEvent),
) -> RunSummary {
    let started_at = clock();
    let mut summary = RunSummary::new(request.kind.name(), ctx.dry_run, started_at);
    emit(RunEvent::Started { kind: summary.kind });
    // Without a run number (database locked or broken) nothing can be assigned: then
    // neither mailbox nor fetch nor export.
    let run = match store.begin_run() {
        Ok(run) => run,
        Err(e) => {
            log::error!("run could not begin: {e}");
            summary.outcome = failed(ErrorInfo::from(&e));
            summary.finished_at = clock();
            emit(summary.finished_event());
            return summary;
        }
    };
    summary.run = run;
    log::info!("run {run}: {:?} started", summary.kind);
    let plan = Plan::of(&request.kind, ctx);
    let mut postings: BTreeMap<Portal, usize> = BTreeMap::new();
    // The scan of this run succeeded: its facts are the Info sheet's.

    if let Some(scope) = plan.scan {
        let before_scan = last_scan_run(store).unwrap_or(0);
        if ctx.portals.is_empty() {
            summary.outcome = failed(ErrorInfo::from(&InvalidInput::NoPortal));
        } else if let Err(e) = store.kv_set(LAST_SCAN_RUN, &run.to_string()) {
            // The alert mails of the last run with a mailbox scan tell the portals' health.
            summary.outcome = failed(ErrorInfo::from(&e));
        } else {
            // Remember the state of the last scan that read mail: one that read none (wrong
            // app password, no network, instant cancel, or no alert mail since the last
            // fetch) says nothing new about the alert mails - "alert mails without jobs" stays
            // until mails are read again.
            let mut scanned = ScanSummary::default();
            let result = scan_step(
                backends,
                store,
                (run, scope, started_at),
                &ctx.portals,
                cancel,
                &mut scanned,
                &mut postings,
                &mut emit,
            )
            .await;
            summary.outcome = match result {
                Ok(()) => {
                    remember_scan(store, started_at);
                    Outcome::Completed
                }
                Err(ScanError::Mail(MailError::Cancelled)) => Outcome::Cancelled,
                Err(ScanError::Mail(e)) => failed(ErrorInfo::from(&e)),
                Err(ScanError::Store(e)) => failed(ErrorInfo::from(&e)),
            };
            if scanned.mails_checked == 0 {
                let _ = store.kv_set(LAST_SCAN_RUN, &before_scan.to_string());
            }
            summary.scan = Some(ScanCounts::from(&scanned));
            summary.empty_alerts = store
                .zero_posting_mails(run)
                .unwrap_or_default()
                .iter()
                .take(MAX_EMPTY_ALERTS)
                .map(EmptyAlert::from)
                .collect();
        }
    }

    // The search: after the mailbox (or in its place without one), before the ads are read,
    // so its hits are fetched in the same run; a mailbox that failed does not stop it.
    if plan.search && summary.outcome != Outcome::Cancelled {
        let mut found = BTreeMap::new();
        let searched = search_step(
            backends,
            ctx,
            (store, policy, run),
            cancel,
            &clock,
            &mut found,
            &mut emit,
        )
        .await;
        for (portal, counts) in &found {
            *postings.entry(*portal).or_default() += counts.hits;
        }
        summary.search = Some(found);
        match searched {
            Ok(true) => {}
            Ok(false) => summary.outcome = Outcome::Cancelled,
            Err(e) => {
                log::warn!("run {run}: search failed: {e}");
                if summary.outcome == Outcome::Completed {
                    summary.outcome = failed(ErrorInfo::from(&e));
                }
            }
        }
    }

    let matcher = backends.matcher();
    let mut tally = Tally::default();
    // The ads are read after a completed scan, or after the search whatever the mailbox did.
    let fetch_now = summary.outcome == Outcome::Completed
        || (summary.search.is_some() && summary.outcome != Outcome::Cancelled);
    if let Some(selection) = plan.fetch
        && fetch_now
    {
        let mut fetched = FetchSummary::default();
        let outcome = fetch_step(
            backends,
            ctx,
            (store, policy, matcher.as_deref()),
            run,
            selection,
            cancel,
            &clock,
            (&mut fetched, &mut tally),
            &mut emit,
        )
        .await;
        // A failure of the mailbox stays the run's outcome.
        if summary.outcome == Outcome::Completed {
            summary.outcome = outcome;
        }
        summary.fetch = Some(fetched);
    }
    summary.per_portal = per_portal(store, run, &postings, summary.fetch.as_ref());
    // A rescore says what it changed (after the profile was saved).
    let before = (request.kind == RunKind::Rescore)
        .then(|| store.band_counts().ok())
        .flatten();
    if let Some(matcher) = &matcher {
        score_step(
            store,
            &**matcher,
            cancel,
            &clock,
            &mut tally,
            &mut summary,
            &mut emit,
        );
    }
    if let Some(before) = before
        && let Ok(after) = store.band_counts()
    {
        let totals = summary.score.get_or_insert_with(ScoreSummary::default);
        totals.delta = Some(ScoreDelta {
            excluded_before: before.excluded,
            excluded_after: after.excluded,
            high_before: before.high,
            high_after: after.high,
        });
    }

    if summary.scan.is_some() || summary.search.is_some() {
        match store.new_jobs(run) {
            Ok((count, high)) => summary.new_jobs = Some(NewJobs { count, high }),
            Err(e) => log::warn!("run {run}: new jobs not counted: {e}"),
        }
    }

    summary.finished_at = clock();
    // "The last fetch" of the page: a rescore or a details run never replaces it.
    if !ctx.dry_run
        && summary.kind.reads_mail()
        && let Ok(json) = serde_json::to_string(&summary)
        && let Err(e) = store.kv_set(LAST_RUN, &json)
    {
        log::warn!("run {run}: summary not stored: {e}");
    }
    log::info!("run {run}: finished {:?}", summary.outcome);
    emit(summary.finished_event());
    summary
}

/// Catch-up scoring after a completed run and the score summary.
fn score_step(
    store: &Store,
    matcher: &dyn Matcher,
    cancel: &CancellationToken,
    clock: &impl Fn() -> Timestamp,
    tally: &mut Tally,
    summary: &mut RunSummary,
    emit: &mut impl FnMut(RunEvent),
) {
    let run = summary.run;
    if summary.outcome == Outcome::Completed {
        match score::catch_up(store, matcher, cancel, clock, tally, emit) {
            Ok(true) => {}
            Ok(false) => summary.outcome = Outcome::Cancelled,
            Err(e) => {
                log::warn!("run {run}: scoring failed: {e}");
                summary.outcome = failed(ErrorInfo::from(&e));
            }
        }
    }
    let pending = store.match_pending(matcher.rev()).unwrap_or(0);
    summary.score = Some(tally.summary(usize::try_from(pending).unwrap_or(0)));
    log::info!("run {run}: score {:?}", summary.score);
}

/// The health of a portal as an event, with whether the user has to act.
fn health_event(portal: Portal, health: PortalHealth) -> RunEvent {
    RunEvent::PortalHealth {
        portal,
        action_needed: health.action_needed(),
        health,
    }
}

fn failed(error: ErrorInfo) -> Outcome {
    Outcome::Failed { error }
}

/// Number of the last run with a mailbox scan that read mail (its alert mails without jobs
/// are the portals' health); 0 = none yet.
pub fn last_scan_run(store: &Store) -> crate::Result<i64> {
    Ok(store
        .kv_get(LAST_SCAN_RUN)?
        .and_then(|v| v.parse().ok())
        .unwrap_or(0))
}

/// The summary of the last fetch, if one is stored (and readable). One of a run over the
/// whole mailbox (a kind of its own in earlier versions) reads as a fetch.
pub fn last_run(store: &Store) -> crate::Result<Option<RunSummary>> {
    Ok(store.kv_get(LAST_RUN)?.and_then(|json| {
        let mut summary: serde_json::Value = serde_json::from_str(&json).ok()?;
        if summary["kind"] == "fullMailbox" {
            summary["kind"] = "fetch".into();
        }
        serde_json::from_value(summary).ok()
    }))
}

fn status(code: StatusCode, portal: Option<Portal>, until: Option<Timestamp>) -> RunEvent {
    RunEvent::Status {
        code,
        portal,
        until,
    }
}

/// Reports an activity unless the status line already shows it.
fn announce(
    activity: &mut Option<(StatusCode, Portal)>,
    code: StatusCode,
    portal: Portal,
    emit: &mut impl FnMut(RunEvent),
) {
    if *activity != Some((code, portal)) {
        emit(status(code, Some(portal), None));
        *activity = Some((code, portal));
    }
}

#[expect(
    clippy::too_many_arguments,
    reason = "store, request, cancellation, counters and events separately (replaceable in tests)"
)]
async fn scan_step<B: Backends>(
    backends: &mut B,
    store: &Store,
    (run, scope, started_at): (i64, Scope, Timestamp),
    portals: &[Portal],
    cancel: &CancellationToken,
    scanned: &mut ScanSummary,
    postings: &mut BTreeMap<Portal, usize>,
    emit: &mut impl FnMut(RunEvent),
) -> Result<(), ScanError> {
    emit(status(StatusCode::ConnectingMail, None, None));
    let mut mail = backends.connect_mail(cancel).await?;
    log::info!("run {run}: mailbox scan {scope:?} for {portals:?}");
    emit(status(StatusCode::SearchingMail, None, None));
    let result = scan(
        &mut mail,
        store,
        run,
        scope,
        portals,
        started_at,
        cancel,
        scanned,
        |event| match event {
            ScanEvent::Found { total } => {
                if total > 0 {
                    emit(status(StatusCode::ReadingMails, None, None));
                }
            }
            ScanEvent::Alert(alert) => {
                for posting in &alert.postings {
                    *postings.entry(posting.key.portal).or_default() += 1;
                }
                emit(RunEvent::Alert {
                    portal: alert.portal,
                    subject: truncate_chars(&alert.subject, MAX_SUBJECT_CHARS),
                    date: alert.date,
                    postings: alert.postings.len(),
                    gmail_id: alert.gmail_id.map(|id| format!("{id:x}")),
                });
            }
            ScanEvent::Progress { done, total } => emit(RunEvent::Progress {
                step: Step::Scan,
                portal: None,
                done,
                total,
            }),
        },
    )
    .await;
    mail.logout().await;
    let s = &*scanned;
    // Per portal: as soon as all of a portal's alert mails came without a job, its mail
    // layout probably changed - even while the other portals are fine.
    for (portal, mails) in s.empty_portals() {
        log::warn!(
            "run {run}: {}: {mails} alert mails but no jobs recognised - mail layout changed?",
            portal.key()
        );
        emit(health_event(
            portal,
            PortalHealth::LayoutSuspect {
                empty_mails: mails,
                pages: 0,
            },
        ));
    }
    match &result {
        Ok(()) => log::info!(
            "run {run}: mailbox checked: {} mails, {} alert mails, {} new, {} known, {} duplicates",
            s.mails_checked,
            s.alert_mails,
            s.new,
            s.known_before,
            s.dup_in_run
        ),
        Err(ScanError::Mail(MailError::Cancelled)) => log::info!("run {run}: mailbox cancelled"),
        Err(e) => log::warn!("run {run}: mailbox failed: {e}"),
    }
    if s.mails_defective > 0 {
        log::warn!("run {run}: {} unreadable mails skipped", s.mails_defective);
    }
    result
}

#[expect(
    clippy::too_many_arguments,
    reason = "store, rules, selection, cancellation, clock and events separately (replaceable in tests)"
)]
async fn fetch_step<B: Backends>(
    backends: &mut B,
    ctx: &RunContext,
    (store, policy, matcher): (&Store, &Mutex<Policy>, Option<&dyn Matcher>),
    run: i64,
    selection: Selection<'_>,
    cancel: &CancellationToken,
    clock: &impl Fn() -> Timestamp,
    (fetched, tally): (&mut FetchSummary, &mut Tally),
    emit: &mut impl FnMut(RunEvent),
) -> Outcome {
    // Activity in the status line - not anew for every job, again after a wait.
    let mut activity: Option<(StatusCode, Portal)> = None;
    let prescore = backends.prescore();
    // A portal stays on while the settings still name the path the run started with.
    let live = backends.live_paths();
    let on = |portal: Portal| {
        live.as_ref()
            .is_none_or(|now| now(portal) == Some(ctx.path(portal)))
    };
    let result = fetch_all(
        |portal| backends.pages(portal, ctx.path(portal)),
        store,
        policy,
        (selection, &*prescore, &on),
        cancel,
        clock,
        fetched,
        |event| match event {
            FetchEvent::Requeued { portal, count } => log::info!(
                "run {run}: {}: {count} failed jobs open again after a parser update",
                portal.key()
            ),
            FetchEvent::Queued { total } => log::info!("run {run}: job details: {total} open"),
            FetchEvent::Fetching { portal } => {
                announce(&mut activity, StatusCode::FetchingDetails, portal, emit);
            }
            FetchEvent::SigningIn { portal } => {
                announce(&mut activity, StatusCode::SigningIn, portal, emit);
            }
            FetchEvent::Waiting { portal, until } => {
                activity = None;
                emit(status(StatusCode::Waiting, Some(portal), Some(until)));
            }
            FetchEvent::JobUpdated { key, .. } => {
                // A duplicate of another portal's job shows as that job's row (with
                // `alsoOn`) and is scored with it; any other job is scored before its row
                // goes out - the ring appears with the details.
                let shown = if let Ok(Some(original)) = store.dup_of(&key) {
                    original
                } else {
                    if let Some(matcher) = matcher {
                        score::score_one(store, matcher, &key, clock(), tally);
                    }
                    key
                };
                if let Ok(Some(job)) = store.job(&shown)
                    && let Ok(Some(view)) =
                        crate::view::job_views(store, std::slice::from_ref(&job))
                            .map(|mut views| views.pop())
                {
                    emit(RunEvent::JobUpdated {
                        job: Box::new(view),
                        fresh: job.first_seen_run == run,
                    });
                }
            }
            FetchEvent::PortalStopped {
                portal,
                reason,
                skipped,
            } => {
                log::info!("run {run}: {}", reason.log_line(portal, skipped));
                emit(health_event(portal, reason.health()));
            }
            FetchEvent::Progress { done, total } => emit(RunEvent::Progress {
                step: Step::Fetch,
                portal: None,
                done,
                total,
            }),
        },
    )
    .await;
    match result {
        Ok(true) => {
            let ok: usize = fetched.per_portal.values().map(|c| c.ok).sum();
            let open = fetched.queued.saturating_sub(ok);
            log::info!("run {run}: job details: {ok} fetched, {open} without details");
            Outcome::Completed
        }
        Ok(false) => {
            log::info!("run {run}: job details cancelled - what was fetched is stored");
            Outcome::Cancelled
        }
        Err(e) => {
            log::warn!("run {run}: job details failed: {e}");
            failed(ErrorInfo::from(&e))
        }
    }
}

/// The sources' own search: [`search_all`] with the run's events (the source being
/// searched, the waits, a stop as the source's health).
async fn search_step<B: Backends>(
    backends: &mut B,
    ctx: &RunContext,
    (store, policy, run): (&Store, &Mutex<Policy>, i64),
    cancel: &CancellationToken,
    clock: &impl Fn() -> Timestamp,
    found: &mut BTreeMap<Portal, SearchCounts>,
    emit: &mut impl FnMut(RunEvent),
) -> crate::Result<bool> {
    let mut activity: Option<(StatusCode, Portal)> = None;
    // A source stays on while the settings keep it switched on.
    let live = backends.live_paths();
    let on = |portal: Portal| live.as_ref().is_none_or(|now| now(portal).is_some());
    let result = search_all(
        |portal| backends.pages(portal, FetchPath::Guest),
        (store, policy, run),
        (&ctx.search_portals, &ctx.search_terms, &on),
        cancel,
        clock,
        found,
        |event| match event {
            SearchEvent::Searching {
                portal,
                done,
                total,
            } => {
                announce(&mut activity, StatusCode::Searching, portal, emit);
                emit(RunEvent::Progress {
                    step: Step::Search,
                    portal: Some(portal),
                    done,
                    total,
                });
            }
            SearchEvent::Waiting { portal, until } => {
                activity = None;
                emit(status(StatusCode::Waiting, Some(portal), Some(until)));
            }
            SearchEvent::Stopped { portal, reason } => {
                log::info!("run {run}: search {}", reason.log_line(portal, 0));
                emit(health_event(portal, reason.health()));
            }
        },
    )
    .await;
    for (portal, counts) in found.iter() {
        log::info!(
            "run {run}: search {}: {} pages, {} hits, {} new, {} refused by robots.txt",
            portal.key(),
            counts.pages,
            counts.hits,
            counts.new,
            counts.refused
        );
    }
    result
}

/// The portals of the summary: scan counts (new and known from the store, duplicates as the
/// rest of the postings) and fetch counts, in the order of `Portal::ALL`.
fn per_portal(
    store: &Store,
    run: i64,
    postings: &BTreeMap<Portal, usize>,
    fetch: Option<&FetchSummary>,
) -> Vec<PortalSummary> {
    let seen = if postings.is_empty() {
        Vec::new()
    } else {
        store.scan_counts(run).unwrap_or_default()
    };
    Portal::ALL
        .into_iter()
        .filter_map(|portal| {
            let total = postings.get(&portal).copied();
            let counts = fetch.and_then(|f| f.per_portal.get(&portal));
            if total.is_none() && counts.is_none() {
                return None;
            }
            let (new, known) = seen
                .iter()
                .find(|(p, ..)| *p == portal)
                .map_or((0, 0), |&(_, new, known)| (new, known));
            Some(PortalSummary {
                portal,
                new,
                known,
                dup: total.unwrap_or(0).saturating_sub(new + known),
                fetched: counts.map_or(0, |c| c.ok),
                failed: counts.map_or(0, |c| c.failed),
                gone: counts.map_or(0, |c| c.gone),
                skipped: counts.map_or(0, |c| c.skipped),
                stopped: counts
                    .and_then(|c| c.stop.as_ref())
                    .map(crate::fetch::StopReason::health),
            })
        })
        .collect()
}

/// Deletes jobs for good (see [`Store::delete_jobs`]): the text files earlier versions wrote
/// for them go (and those that stayed at an earlier delete get another try). Without a
/// workspace (the dry run) nothing on disk changes.
pub fn delete_jobs(
    store: &Store,
    workspace: Option<&Path>,
    keys: &[JobKey],
    now: Timestamp,
) -> crate::Result<Deleted> {
    // Only the trash is deleted for good.
    let keys = store.in_trash(keys)?;
    let (gone, names) = store.delete_jobs(&keys, now)?;
    // The jobs as the list showed them: a duplicate that stood behind a row goes with it
    // (its key is among `gone` for the page), but the user deleted that row once.
    let rows = keys.iter().filter(|key| gone.contains(key)).count();
    let deleted = Deleted {
        count: u32::try_from(rows).unwrap_or(u32::MAX),
        keys: gone,
    };
    let Some(workspace) = workspace.filter(|_| !deleted.keys.is_empty()) else {
        return Ok(deleted);
    };
    retry_txt_leftovers(store, &workspace.join(RESULT_DIR));
    remove_deleted_txt(store, workspace, &names);
    Ok(deleted)
}

/// Removes the text files earlier versions wrote for jobs now deleted for good. A file that
/// stays (open in another program, or the work folder on a drive that is gone) is remembered,
/// since its job's row is gone, so the next delete or a reset removes it
/// ([`Store::txt_leftovers`]); the user needs no word about it.
fn remove_deleted_txt(store: &Store, workspace: &Path, names: &[String]) {
    let failed = if workspace.is_dir() {
        export::clear_txt_files(&workspace.join(RESULT_DIR), names).1
    } else {
        names.to_vec()
    };
    if failed.is_empty() {
        return;
    }
    log::warn!(
        "{} text files of deleted jobs not removed (open), removed later",
        failed.len()
    );
    let mut left = store.txt_leftovers().unwrap_or_default();
    for name in &failed {
        if !left.contains(name) {
            left.push(name.clone());
        }
    }
    if let Err(e) = store.set_txt_leftovers(&left) {
        log::warn!("text files not removed are not remembered: {e}");
    }
}

/// Another try at the text files of deleted jobs that stayed earlier; the ones gone meanwhile
/// (removed now or by the user) are forgotten.
fn retry_txt_leftovers(store: &Store, result_dir: &Path) {
    let left = match store.txt_leftovers() {
        Ok(left) if !left.is_empty() => left,
        Ok(_) => return,
        Err(e) => {
            log::warn!("text files not removed earlier are not readable: {e}");
            return;
        }
    };
    let (_, failed) = export::clear_txt_files(result_dir, &left);
    let still: Vec<String> = left.into_iter().filter(|n| failed.contains(n)).collect();
    if let Err(e) = store.set_txt_leftovers(&still) {
        log::warn!("text files not removed are not remembered: {e}");
    }
}

/// After a successful mailbox scan: when it started (a failed scan does not overwrite it).
fn remember_scan(store: &Store, at: Timestamp) {
    if let Err(e) = store.kv_set(LAST_FETCH_AT, &time::to_db(at).to_string()) {
        log::warn!("time of the mailbox scan not stored: {e}");
    }
}

/// Has a fetch ever completed its mailbox step (a scan that read the mailbox)? Until then
/// the app keeps its first-run page: a first fetch that failed (a wrong app password, no
/// connection) or was cancelled before the mailbox was read leaves setup open. A database of
/// an earlier version that fetched counts as done.
pub fn has_completed_fetch(store: &Store) -> bool {
    last_fetch_at(store).is_some()
}

/// Start of the last successful mailbox scan.
pub fn last_fetch_at(store: &Store) -> Option<Timestamp> {
    store
        .kv_get(LAST_FETCH_AT)
        .ok()
        .flatten()
        .and_then(|v| v.parse().ok())
        .and_then(time::from_db)
}

#[cfg(test)]
mod tests;
