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
use sha2::Digest as _;
use tokio_util::sync::CancellationToken;

use crate::error::{ErrorInfo, InvalidInput};
use crate::export::{self, InfoValue, RESULT_DIR, Texts, texts, write_xlsx};
use crate::fetch::policy::Policy;
use crate::fetch::search::{SearchCounts, SearchEvent, search_all};
use crate::fetch::{
    FetchEvent, FetchSummary, PageFetcher, PortalHealth, Prescore, Selection, fetch_all,
    neutral_prescore,
};
use crate::mail::imap::{MailError, MailSource};
use crate::mail::scan::{ScanError, ScanEvent, ScanSummary, Scope, scan};
use crate::portal::{FetchPath, JobKey, Portal};
use crate::settings::{FetchRange, Language};
use crate::store::{JobRow, Store};
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
    /// Which alert mails a fetch reads (settings).
    pub fetch_range: FetchRange,
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
    Export,
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
    WritingFiles,
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

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ExportSummary {
    /// Written Excel overview (if written in this run).
    pub overview_xlsx: Option<PathBuf>,
    /// Written CSV overview (if written in this run; `exportCsv`). Summaries of earlier
    /// versions have none.
    #[serde(default)]
    #[cfg_attr(test, ts(optional = nullable))]
    pub overview_csv: Option<PathBuf>,
    /// A foreign overview at the same path was backed up here.
    pub backup: Option<PathBuf>,
    /// The first error (closest to the cause); `params.target` names what failed.
    pub error: Option<ErrorInfo>,
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
    pub export: Option<ExportSummary>,
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
            export: None,
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
            let Some(export) = summary.export.as_mut() else {
                break;
            };
            if let Some(error) = export.error.as_mut()
                && !error.params.is_empty()
            {
                error.params.clear();
            } else if export.backup.take().is_none()
                && export.overview_csv.take().is_none()
                && export.overview_xlsx.take().is_none()
            {
                break;
            }
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
/// State of the overview per path (key = prefix + path).
pub(crate) const EXPORT_STAMP: &str = "export:";
/// The numbers of the last successful mailbox scan for the sheet "Info" ([`ScanFacts`]).
const LAST_SCAN_FACTS: &str = "last_scan_facts";
/// Info sheet rows (German words) of the last successful mailbox scan, as earlier versions
/// stored them; read only while no scan stored its facts.
const LAST_SCAN_INFO: &str = "last_scan_info";
/// So many empty alert mails a summary carries (the event must stay small).
pub const MAX_EMPTY_ALERTS: usize = 10;
/// Largest `Finished` event in bytes of JSON: Tauri channel messages above 8 KB bypass the
/// ACL (a margin for the channel's own framing).
pub const MAX_EVENT_BYTES: usize = 7 * 1024;
/// Start of the last successful mailbox scan (Unix seconds).
const LAST_FETCH_AT: &str = "last_fetch_at";
/// The portals' health at the end of the last run, for the Info sheet ([`HealthRow`]).
const LAST_HEALTH: &str = "last_portal_health";
/// Label of the mail address row that earlier versions stored - do not translate.
const LEGACY_ACCOUNT_LABEL: &str = "Gmail-Konto";
/// Info sheet labels and values earlier versions stored with the last mailbox scan, and
/// today's words for them (until the next scan stores its own) - do not translate.
const LEGACY_INFO: [(&str, &str); 5] = [
    ("Umfang des letzten Laufs", texts::INFO_SCOPE),
    ("Neu (letzter Lauf)", texts::INFO_NEW),
    ("Schon bekannt (letzter Lauf)", texts::INFO_KNOWN),
    ("Doppelt in mehreren Mails (letzter Lauf)", texts::INFO_DUP),
    ("Neu seit letztem Lauf", texts::SCOPE_NEW),
];

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
                    scan: (ctx.read_mail || !search).then(|| Scope::from(ctx.fetch_range)),
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
    let mut scanned_ok = false;

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
                    remember_scan(store, scope, &scanned, started_at);
                    remember_account(store, ctx.mailbox.as_deref());
                    scanned_ok = true;
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
            Ok((count, high)) => {
                summary.new_jobs = Some(NewJobs { count, high });
                if scanned_ok {
                    remember_new_jobs(store, count);
                }
            }
            Err(e) => log::warn!("run {run}: new jobs not counted: {e}"),
        }
    }
    remember_health(store, policy, ctx, clock());

    summary.finished_at = clock();
    if !ctx.dry_run {
        emit(status(StatusCode::WritingFiles, None, None));
        let info = info_rows(store, summary.finished_at, Texts::of(ctx.language));
        let exported = export_all(
            store,
            &ctx.workspace,
            &info,
            run,
            summary.finished_at,
            ctx.language,
        );
        log_export(run, &exported);
        summary.export = Some(exported);
    }
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

/// How often "Jobs abrufen" runs by itself while the app is open (user decision 2026-10-01).
pub const AUTO_EVERY: jiff::SignedDuration = jiff::SignedDuration::from_hours(4);

/// When the next automatic fetch is due: [`AUTO_EVERY`] after the last fetch ended, at once
/// when there was none (or its time lies ahead: a clock set back).
pub fn auto_due(last: Option<Timestamp>, now: Timestamp) -> Timestamp {
    match last {
        Some(last) if last <= now => last.checked_add(AUTO_EVERY).unwrap_or(now).max(now),
        _ => now,
    }
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

/// What failed in an export step (`params.target` of the error).
#[derive(Clone, Copy)]
enum Target {
    /// The work folder itself (a network drive or stick that is gone): nothing is written.
    Workspace,
    /// The Excel overview (writing it or reading its export stamp).
    Overview,
    /// Backing up a foreign Excel overview.
    Backup,
    /// The CSV overview (writing it, backing up a foreign one or reading its export stamp).
    Csv,
}

impl Target {
    const fn code(self) -> &'static str {
        match self {
            Target::Workspace => "workspace",
            Target::Overview => "overview",
            Target::Backup => "backup",
            Target::Csv => "csv",
        }
    }

    /// The base name of what failed when the error itself names no file (an error of the
    /// Excel writer, of the database behind a stamp).
    const fn file_name(self) -> Option<&'static str> {
        match self {
            Target::Overview | Target::Backup => Some(export::XLSX_NAME),
            Target::Csv => Some(export::CSV_NAME),
            Target::Workspace => None,
        }
    }
}

/// The overviews (in `language`): the Excel file with `exportExcel` on, the CSV file with
/// `exportCsv` on. An overview is only regenerated if something changed - data, run (Excel
/// only: its sheet "Info" names it), folder, language, the Gmail account of the links - or it
/// is missing; a file open elsewhere is then not disturbed needlessly. Old text files of jobs
/// deleted for good that stayed earlier get another try ([`Store::txt_leftovers`]).
pub fn export_all(
    store: &Store,
    workspace: &Path,
    info: &[(String, InfoValue)],
    run: i64,
    now: Timestamp,
    language: Language,
) -> ExportSummary {
    let result_dir = workspace.join(RESULT_DIR);
    let mut summary = ExportSummary::default();
    if !reachable(workspace, &mut summary) {
        return summary;
    }
    retry_txt_leftovers(store, &result_dir);
    write_overviews(store, &result_dir, info, (run, language), now, &mut summary);
    summary
}

/// Which overviews are written: the Excel file (`exportExcel`) and the CSV file
/// (`exportCsv`); unreadable settings keep the defaults, Excel on and CSV off.
fn overview_switches(store: &Store) -> (bool, bool) {
    crate::settings::Settings::load(store).map_or((true, false), |settings| {
        (settings.export_excel, settings.export_csv)
    })
}

/// The overviews written anew when the user's marks (a move, "score anyway", a delete)
/// changed them since they were last written - the stamp of the last write says so - and
/// when a file is missing: call it after marks and right before "open Excel" or "open CSV".
/// A run writes them by itself. A file open in Excel stays as it is: the summary's error is
/// `fileLocked` with `target` (`overview` for the Excel file, `csv` for the CSV file), `path`
/// and `name` (`JobAlerts.xlsx`, `JobAlerts.csv`); `overviewXlsx` and `overviewCsv` name the
/// files written. A file switched off is not written.
pub fn refresh_overviews(
    store: &Store,
    workspace: &Path,
    now: Timestamp,
    language: Language,
) -> ExportSummary {
    let result_dir = workspace.join(RESULT_DIR);
    let mut summary = ExportSummary::default();
    if overview_switches(store) == (false, false) || !reachable(workspace, &mut summary) {
        return summary;
    }
    // The run of the last write stays: marks alone change no run number.
    let run = store
        .kv_get(&stamp_key(&export::overview_path(&result_dir)))
        .ok()
        .flatten()
        .and_then(|stamp| serde_json::from_str::<serde_json::Value>(&stamp).ok())
        .and_then(|stamp| stamp["run"].as_i64())
        .unwrap_or_else(|| last_scan_run(store).unwrap_or(0));
    let info = info_rows(store, now, Texts::of(language));
    write_overviews(
        store,
        &result_dir,
        &info,
        (run, language),
        now,
        &mut summary,
    );
    summary
}

/// Deletes jobs for good (see [`Store::delete_jobs`]): the text files earlier versions wrote
/// for them go and the overview is written again without them (in `language`). Without a
/// workspace (the dry run) nothing on disk changes.
pub fn delete_jobs(
    store: &Store,
    workspace: Option<&Path>,
    keys: &[JobKey],
    (now, language): (Timestamp, Language),
) -> crate::Result<Deleted> {
    // Only the trash is deleted for good.
    let keys = store.in_trash(keys)?;
    let (gone, names) = store.delete_jobs(&keys, now)?;
    // The jobs as the list showed them: a duplicate that stood behind a row goes with it
    // (its key is among `gone` for the page), but the user deleted that row once.
    let rows = keys.iter().filter(|key| gone.contains(key)).count();
    let mut deleted = Deleted {
        count: u32::try_from(rows).unwrap_or(u32::MAX),
        keys: gone,
        export_error: None,
    };
    let Some(workspace) = workspace.filter(|_| !deleted.keys.is_empty()) else {
        return Ok(deleted);
    };
    remove_deleted_txt(store, workspace, &names);
    let info = info_rows(store, now, Texts::of(language));
    let run = last_scan_run(store).unwrap_or(0);
    let exported = export_all(store, workspace, &info, run, now, language);
    deleted.export_error = exported.error;
    Ok(deleted)
}

/// Removes the text files earlier versions wrote for jobs now deleted for good. A file that
/// stays (open in another program, or the work folder on a drive that is gone) is remembered,
/// since its job's row is gone, so the next export or a reset removes it
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

/// Is the work folder there? A deleted local folder is simply made again; one on a drive
/// that is gone (a network share, a stick) is one clear error naming the work folder - not
/// a text folder and an Excel file that each could not be written - and the
/// export is skipped: the files follow once the folder is back.
fn reachable(workspace: &Path, summary: &mut ExportSummary) -> bool {
    match export::ensure_dir(workspace) {
        Ok(()) => true,
        Err(e) => {
            note_error(summary, &e, Target::Workspace);
            false
        }
    }
}

/// The first error stays: it is closest to the cause (the folder is unreachable); later
/// consequential errors only go to the log. Only one is reported anyway. It says what
/// failed (`target`) and the base name of the file or folder (`name`).
fn note_error(summary: &mut ExportSummary, error: &crate::Error, target: Target) {
    if summary.error.is_some() {
        log::warn!("export: another error ({}): {error}", target.code());
    } else {
        log::warn!("export: {}: {error}", target.code());
        summary.error = Some(export_error(error, target));
    }
}

/// An export error for the page: its code with `target` and `name`.
fn export_error(error: &crate::Error, target: Target) -> ErrorInfo {
    let info = ErrorInfo::from(error).with("target", target.code());
    match target.file_name() {
        Some(name) => info.with_name_of(Path::new(name)),
        None => info,
    }
}

/// Writes the overviews that are switched on (the Excel file, the CSV file), each one only
/// if it is missing or something changed since the last time at its path. Both list the
/// inbox and the archive, best match first, no duplicate row (the original's row stands for
/// it) and nothing of the trash; the jobs are read once for both.
fn write_overviews(
    store: &Store,
    result_dir: &Path,
    info: &[(String, InfoValue)],
    (run, language): (i64, Language),
    now: Timestamp,
    summary: &mut ExportSummary,
) {
    let (excel, csv) = overview_switches(store);
    let account = gmail_account(store);
    let rev = store.data_rev().unwrap_or(-1);
    // The account of the Gmail links (only a digest of it) changes their target.
    let digest = account
        .as_deref()
        .map(|a| crate::portal::hex12(&sha2::Sha256::digest(a)));
    let mut jobs: Option<Vec<JobRow>> = None;
    if excel {
        // The run number belongs to the sheet "Info" and changes the file on every run.
        let stamp = serde_json::json!({
            "rev": rev, "run": run, "language": language, "account": digest,
        });
        let path = export::overview_path(result_dir);
        if write_overview(
            store,
            &path,
            &stamp,
            Target::Overview,
            now,
            summary,
            &mut jobs,
            |jobs| write_xlsx(&path, jobs, info, language, account.as_deref()),
        ) {
            summary.overview_xlsx = Some(path);
        }
    }
    if csv {
        // The CSV file has no sheet "Info": a run alone does not change it (an open file is
        // not disturbed on every run).
        let stamp = serde_json::json!({
            "rev": rev, "language": language, "account": digest,
        });
        let path = export::csv_path(result_dir);
        if write_overview(
            store,
            &path,
            &stamp,
            Target::Csv,
            now,
            summary,
            &mut jobs,
            |jobs| export::write_csv(&path, jobs, language, account.as_deref()),
        ) {
            summary.overview_csv = Some(path);
        }
    }
}

/// Writes one overview with `write` if it is missing or its `stamp` changed since the last
/// time at this path; `true` when it was written. The state is remembered per path: what the
/// app wrote there stays its own - also after switching the folder and back. `jobs` are the
/// rows of the overviews, read at the first write.
#[expect(
    clippy::too_many_arguments,
    reason = "one step of the export with its summary, its jobs and its writer"
)]
fn write_overview(
    store: &Store,
    path: &Path,
    stamp: &serde_json::Value,
    target: Target,
    now: Timestamp,
    summary: &mut ExportSummary,
    jobs: &mut Option<Vec<JobRow>>,
    write: impl FnOnce(&[JobRow]) -> crate::Result<()>,
) -> bool {
    let stamp = stamp.to_string();
    let key = stamp_key(path);
    // Without a readable state the ownership of the file is unknown - then it is neither
    // backed up nor replaced. A database error must not back up the app's own overview.
    let last = match store.kv_get(&key) {
        Ok(last) => last,
        Err(e) => {
            note_error(summary, &e, target);
            return false;
        }
    };
    if path.exists() && last.as_deref() == Some(stamp.as_str()) {
        return false;
    }
    // An overview that does not come from this app (e.g. from the old program in the same
    // folder) is backed up before the first write - never replaced silently. The name is
    // part of the user's workspace - do not translate - and says the local time, like the
    // text files' names. The page names a backed-up Excel file; a CSV file only the log.
    if path.exists() && last.is_none() {
        let backup = path.with_file_name(format!(
            "{}{}.{}",
            export::XLSX_BACKUP_PREFIX,
            time::local(now).strftime("%Y%m%d-%H%M%S"),
            path.extension().and_then(|e| e.to_str()).unwrap_or("xlsx")
        ));
        if let Err(e) = std::fs::rename(path, &backup) {
            let failed = match target {
                Target::Overview => Target::Backup,
                other => other,
            };
            note_error(summary, &crate::Error::io(path, e), failed);
            return false;
        }
        log::info!("a foreign overview was backed up before the first write");
        if matches!(target, Target::Overview) {
            summary.backup = Some(backup);
        }
    }
    if jobs.is_none() {
        match store.sheet_jobs() {
            Ok(rows) => *jobs = Some(rows),
            Err(e) => {
                note_error(summary, &e, target);
                return false;
            }
        }
    }
    match write(jobs.as_deref().unwrap_or_default()) {
        Ok(()) => {
            if let Err(e) = store.kv_set(&key, &stamp) {
                log::warn!("export stamp not stored: {e}");
            }
            true
        }
        Err(e) => {
            note_error(summary, &e, target);
            false
        }
    }
}

/// The key of the export stamp of an overview file (per path).
fn stamp_key(path: &Path) -> String {
    format!("{EXPORT_STAMP}{}", path.display())
}

/// The Gmail address whose alert mails the files link to: the account of the last successful
/// mailbox scan.
fn gmail_account(store: &Store) -> Option<String> {
    store
        .kv_get(crate::store::GMAIL_ACCOUNT)
        .ok()
        .flatten()
        .filter(|a| !a.trim().is_empty())
}

/// After a successful mailbox scan: the account it read is the one the files link to.
fn remember_account(store: &Store, mailbox: Option<&str>) {
    if let Some(account) = mailbox.map(str::trim).filter(|a| !a.is_empty())
        && let Err(e) = store.kv_set(crate::store::GMAIL_ACCOUNT, account)
    {
        log::warn!("account of the links not stored: {e}");
    }
}

/// The health of every portal at the end of a run, for the Info sheet: switched on or off
/// and what the safety state says (a pause or a cap with its end, a sign-in needed, alert
/// mails without jobs of the last mailbox scan).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
struct HealthRow {
    portal: Portal,
    enabled: bool,
    health: PortalHealth,
}

/// Remembers the health of every portal at the end of a run (the Info sheet's rows).
fn remember_health(store: &Store, policy: &Mutex<Policy>, ctx: &RunContext, now: Timestamp) {
    let empty = store
        .zero_posting_mails(last_scan_run(store).unwrap_or(0))
        .unwrap_or_default();
    let rows: Vec<HealthRow> = {
        let policy = crate::sync::lock(policy);
        Portal::ALL
            .into_iter()
            .map(|portal| {
                let mails = empty.iter().filter(|m| m.portal == portal).count();
                let login = ctx.sign_in.contains(&portal);
                HealthRow {
                    portal,
                    enabled: ctx.portals.contains(&portal),
                    health: PortalHealth::of(&policy, portal, now, login, mails),
                }
            })
            .collect()
    };
    let saved = serde_json::to_string(&rows)
        .map_err(|e| e.to_string())
        .and_then(|json| store.kv_set(LAST_HEALTH, &json).map_err(|e| e.to_string()));
    if let Err(e) = saved {
        log::warn!("portal health for the Info sheet not stored: {e}");
    }
}

/// The numbers of a successful mailbox scan for the sheet "Info", without words: the sheet
/// says them in the language of the export.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct ScanFacts {
    /// Start of the scan (Unix seconds).
    at: i64,
    scope: Scope,
    /// Listings in the alert mails, by what the scan knew of them.
    new: usize,
    known: usize,
    dup: usize,
    /// The new jobs of the run, as its card counts them ([`NewJobs`]: a job several portals
    /// announce once, excluded ones left out); `None` in the facts of earlier versions.
    #[serde(default)]
    jobs: Option<usize>,
}

/// Remembers the numbers of a successful mailbox scan for the sheet "Info" - only then: a
/// failed scan does not overwrite the last good state. The mail address stays out of the
/// file - it may be passed on.
fn remember_scan(store: &Store, scope: Scope, scan: &ScanSummary, at: Timestamp) {
    let facts = ScanFacts {
        at: time::to_db(at),
        scope,
        new: scan.new,
        known: scan.known_before,
        dup: scan.dup_in_run,
        jobs: None,
    };
    save_facts(store, &facts);
    if let Err(e) = store.kv_set(LAST_FETCH_AT, &time::to_db(at).to_string()) {
        log::warn!("time of the mailbox scan not stored: {e}");
    }
}

/// The run card's number of new jobs goes with the facts of the scan that just succeeded:
/// the Info sheet says the same number as the card.
fn remember_new_jobs(store: &Store, count: usize) {
    if let Some(facts) = scan_facts(store) {
        save_facts(
            store,
            &ScanFacts {
                jobs: Some(count),
                ..facts
            },
        );
    }
}

fn scan_facts(store: &Store) -> Option<ScanFacts> {
    store
        .kv_get(LAST_SCAN_FACTS)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
}

fn save_facts(store: &Store, facts: &ScanFacts) {
    let saved = serde_json::to_string(facts)
        .map_err(|e| e.to_string())
        .and_then(|json| {
            store
                .kv_set(LAST_SCAN_FACTS, &json)
                .map_err(|e| e.to_string())
        });
    if let Err(e) = saved {
        log::warn!("mailbox scan details not stored: {e}");
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

/// Sheet "Info" of the Excel file (last mailbox fetch, when the file was written, counters,
/// program, the portals' health at the last fetch). The numbers come from the last
/// successful mailbox scan - after pure detail runs too; "new" is the run card's number of
/// new jobs. Any run, a delete for good and a mark write the file (`written`: that moment), so
/// it says when, not the time of a fetch: that is the first row's. The job count is the
/// sheet's rows. Numbers and moments are real cells.
fn info_rows(store: &Store, written: Timestamp, words: &Texts) -> Vec<(String, InfoValue)> {
    let count = |n: usize| InfoValue::Number(u64::try_from(n).unwrap_or(u64::MAX));
    let mut rows = match scan_facts(store) {
        Some(facts) => {
            let scope = match facts.scope {
                Scope::New => words.scope_new.to_owned(),
                Scope::Days(days) => words.scope_days(days),
                Scope::All => words.scope_all.to_owned(),
            };
            let mut rows = Vec::new();
            if let Some(at) = time::from_db(facts.at) {
                rows.push((words.info_last_scan.to_owned(), InfoValue::Moment(at)));
            }
            rows.extend([
                (words.info_scope.to_owned(), InfoValue::Text(scope)),
                (
                    words.info_new.to_owned(),
                    count(facts.jobs.unwrap_or(facts.new)),
                ),
                (words.info_known.to_owned(), count(facts.known)),
                (words.info_dup.to_owned(), count(facts.dup)),
            ]);
            rows
        }
        None => legacy_info_rows(store, words)
            .into_iter()
            .map(|(label, value)| {
                let value = value
                    .parse::<u64>()
                    .map_or(InfoValue::Text(value), InfoValue::Number);
                (label, value)
            })
            .collect(),
    };
    // "Erstellt am" / "Created on".
    rows.push((words.created.into(), InfoValue::Moment(written)));
    rows.push((
        words.info_jobs_total.into(),
        InfoValue::Number(store.sheet_count().unwrap_or(0)),
    ));
    rows.push((
        words.info_program.into(),
        InfoValue::Text(texts::PROGRAM_NAME.into()),
    ));
    let health: Vec<HealthRow> = store
        .kv_get(LAST_HEALTH)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    for row in health {
        rows.push((
            words.info_portal(row.portal.label()),
            InfoValue::Text(words.health(row.enabled, &row.health)),
        ));
    }
    rows
}

/// The rows an earlier version stored with the last mailbox scan (German words), in the
/// words of `words` until the next scan stores its facts.
fn legacy_info_rows(store: &Store, words: &Texts) -> Vec<(String, String)> {
    let mut rows: Vec<(String, String)> = store
        .kv_get(LAST_SCAN_INFO)
        .ok()
        .flatten()
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();
    // Earlier versions stored the mail address among the rows; it stays out now.
    rows.retain(|(label, _)| label != LEGACY_ACCOUNT_LABEL);
    // ... and their own words, read in today's until the next scan stores its facts.
    let today = |text: &mut String| {
        if let Some((_, new)) = LEGACY_INFO.iter().find(|(old, _)| old == text) {
            *text = (*new).to_owned();
        }
        if let Some(word) = words.from_german(text) {
            *text = word.to_owned();
        }
    };
    for (label, value) in &mut rows {
        today(label);
        today(value);
    }
    rows
}

fn log_export(run: i64, exported: &ExportSummary) {
    log::info!(
        "run {run}: export{}{}{}",
        if exported.overview_xlsx.is_some() {
            ", overview written"
        } else {
            ""
        },
        if exported.overview_csv.is_some() {
            ", CSV written"
        } else {
            ""
        },
        if exported.backup.is_some() {
            ", a foreign overview was backed up"
        } else {
            ""
        }
    );
}

#[cfg(test)]
mod tests;
