//! A real search of the sources the app searches itself, run as a fetch does it: the deep
//! search's terms, the screen of the new titles, the ads by title pre-score and the engine's
//! scores (a developer's check; the policy lives in memory or in `--policy`, the jobs in `--db` or
//! in memory):
//!
//! `cargo run -p jobalert-core --example live_search -- --profile profil.json`
//! `--sources hays,gulp`: only those sources. `--terms old.txt`: these terms (one per line)
//! instead of the profile's. `--db run.db`: the store (a fresh file for a fresh run).
//! `--out a.json`: what it brought, for a comparison. `--policy policy.json`: caps and pauses kept
//! across runs, as the app keeps them.
//! `cargo run -p jobalert-core --example live_search -- --compare a.json b.json`: two term
//! lists of the same profile on the same day side by side (the union scored once by the same
//! engine: each job keeps its score), what each brought, the jobs one found and the other not.
//!
//! It asks each source's robots.txt and the pages of each term (deeper while they bring new
//! jobs) at the sources' own pace, side by side, then the ads, then scores; never part of a
//! test run. Its numbers belong in `core/tests/fixtures/private/` (ignored).

use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use jiff::Timestamp;
use jobalert_core::fetch::http::HttpFetcher;
use jobalert_core::fetch::policy::Policy;
use jobalert_core::fetch::search::term_yields;
use jobalert_core::mail::imap::MailError;
use jobalert_core::model::{HIGH_FROM, MID_FROM, MatchStatus};
use jobalert_core::pipeline::dry_run::DryRunMail;
use jobalert_core::pipeline::{
    self, Backends, LocalMatcher, Matcher, RunContext, RunKind, RunRequest,
};
use jobalert_core::portal::{Contracts, FetchPath, Portal, Way};
use jobalert_core::store::{JobFilter, Store};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;

/// A current browser's agent, like the app's (`src-tauri/src/platform.rs`).
const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like \
                     Gecko) Chrome/140.0.0.0 Safari/537.36";

/// Real pages as a guest and the engine with the profile; no mailbox.
struct Live {
    matcher: Arc<LocalMatcher>,
}

impl Backends for Live {
    type Mail = DryRunMail;
    type Pages = HttpFetcher;

    async fn connect_mail(&mut self, _: &CancellationToken) -> Result<DryRunMail, MailError> {
        Err(MailError::NoCredentials)
    }

    fn pages(&mut self, _: Portal, _: FetchPath) -> Result<HttpFetcher, String> {
        HttpFetcher::new(AGENT).map_err(|e| e.to_string())
    }

    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        Some(self.matcher.clone())
    }

    fn prescore(&self) -> jobalert_core::fetch::Prescore {
        let matcher = Arc::clone(&self.matcher);
        Arc::new(move |title: &str, location: &str| {
            jobalert_core::matching::prescore(matcher.profile(), title, location)
        })
    }
}

/// What one search brought (`--out`).
#[derive(Debug, Default, Serialize, Deserialize)]
struct Report {
    terms: Vec<String>,
    /// Requests per source (robots.txt, search pages and ads).
    requests: BTreeMap<String, usize>,
    /// Per term and source: pages, hits, new.
    yields: BTreeMap<String, BTreeMap<String, (u32, u32, u32)>>,
    jobs: Vec<Job>,
}

/// A job of the search: its key, title, how it ended and its score.
#[derive(Debug, Clone, Serialize, Deserialize)]
struct Job {
    key: String,
    title: String,
    status: Option<String>,
    score: u8,
    /// The terms that found it.
    terms: Vec<String>,
}

impl Job {
    fn fits(&self) -> bool {
        self.status.as_deref() == Some("scored") && self.score >= MID_FROM
    }
    fn high(&self) -> bool {
        self.status.as_deref() == Some("scored") && self.score >= HIGH_FROM
    }
}

#[tokio::main]
async fn main() {
    jobalert_core::install_crypto();
    let args: Vec<String> = std::env::args().skip(1).collect();
    if let [flag, a, b] = args.as_slice()
        && flag == "--compare"
    {
        compare(&read_report(a), &read_report(b));
        return;
    }
    let value = |name: &str| {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|at| args.get(at + 1))
            .cloned()
    };
    let path = value("--profile").expect("--profile path/to/profil.json");
    let form = jobalert_core::profile::parse(&std::fs::read_to_string(path).expect("profile"))
        .expect("a v19 profile");
    let terms = value("--terms").map_or_else(
        || jobalert_core::profile::deep_search_terms(&form),
        |file| {
            std::fs::read_to_string(file)
                .expect("terms file")
                .lines()
                .map(str::trim)
                .filter(|line| !line.is_empty())
                .map(str::to_owned)
                .collect()
        },
    );
    let only: Option<Vec<Portal>> =
        value("--sources").map(|list| list.split(',').filter_map(Portal::from_key).collect());
    let portals: Vec<Portal> = Portal::ALL
        .into_iter()
        .filter(|portal| portal.way() == Way::Search)
        .filter(|portal| only.as_ref().is_none_or(|list| list.contains(portal)))
        .collect();
    let store = match value("--db") {
        Some(db) => Store::open(std::path::Path::new(&db)).expect("store"),
        None => Store::in_memory().expect("store"),
    };
    // The terms the search asks for: the profile's without those set aside (`fetch::terms`).
    let active = jobalert_core::fetch::terms::active_terms(&store, &terms, Timestamp::now())
        .expect("the stored runs of the terms");
    println!("terms ({}): {active:?}", active.len());
    let ctx = RunContext {
        workspace: std::env::temp_dir(),
        dry_run: false,
        portals: portals.clone(),
        fetch_portals: portals.clone(),
        sign_in: Vec::new(),
        mailbox: None,
        read_mail: false,
        mail_error: None,
        search_portals: portals.clone(),
        search_terms: terms.clone(),
        contracts: Contracts {
            project: form.project,
            permanent: form.permanent,
            temporary: form.temporary,
        },
    };
    let policy = Mutex::new(value("--policy").map_or_else(Policy::in_memory, |file| {
        Policy::load(std::path::Path::new(&file), Timestamp::now())
    }));
    let mut live = Live {
        matcher: Arc::new(LocalMatcher::from_form(&form)),
    };
    let started = Timestamp::now();
    let summary = pipeline::run(
        &mut live,
        &store,
        &policy,
        &RunRequest {
            kind: RunKind::Fetch,
        },
        &ctx,
        &CancellationToken::new(),
        Timestamp::now,
        |event| println!("{}", serde_json::to_string(&event).unwrap_or_default()),
    )
    .await;
    println!(
        "{:?} in {}",
        summary.outcome,
        Timestamp::now().duration_since(started)
    );
    let report = report(&store, &policy, &portals, active);
    print(&report);
    if let Some(out) = value("--out") {
        std::fs::write(
            &out,
            serde_json::to_string_pretty(&report).unwrap_or_default(),
        )
        .expect("report written");
        println!("written to {out}");
    }
}

fn report(store: &Store, policy: &Mutex<Policy>, portals: &[Portal], terms: Vec<String>) -> Report {
    let policy = policy
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut report = Report {
        terms,
        ..Report::default()
    };
    let mut found_by: BTreeMap<String, BTreeSet<String>> = BTreeMap::new();
    for &portal in portals {
        report
            .requests
            .insert(portal.key().to_owned(), policy.state(portal).accesses.len());
        for (term, found) in term_yields(store, portal).unwrap_or_default() {
            for id in &found.jobs {
                found_by
                    .entry(format!("{}:{id}", portal.key()))
                    .or_default()
                    .insert(term.clone());
            }
            report.yields.entry(term).or_default().insert(
                portal.key().to_owned(),
                (found.pages, found.hits, found.new),
            );
        }
    }
    for job in store.jobs(&JobFilter::default()).unwrap_or_default() {
        if store.dup_of(&job.key).ok().flatten().is_some() {
            continue;
        }
        let key = format!("{}:{}", job.key.portal.key(), job.key.id);
        let (status, points) = job.match_.as_ref().map_or((None, 0), |m| {
            let status = match m.status {
                MatchStatus::Scored => "scored",
                MatchStatus::Excluded => "excluded",
                MatchStatus::Unscorable => "unscorable",
            };
            (Some(status.to_owned()), m.score)
        });
        report.jobs.push(Job {
            terms: found_by
                .remove(&key)
                .unwrap_or_default()
                .into_iter()
                .collect(),
            key,
            title: job.title,
            status,
            score: points,
        });
    }
    report
}

fn print(report: &Report) {
    let total: usize = report.requests.values().sum();
    println!("requests: {total} {:?}", report.requests);
    for term in &report.terms {
        let jobs: Vec<&Job> = report
            .jobs
            .iter()
            .filter(|job| job.terms.contains(term))
            .collect();
        println!(
            "{term}: {} jobs, {} fitting, {} high, by source {:?}",
            jobs.len(),
            jobs.iter().filter(|job| job.fits()).count(),
            jobs.iter().filter(|job| job.high()).count(),
            report.yields.get(term).cloned().unwrap_or_default()
        );
    }
    println!(
        "all: {} jobs, {} fitting, {} high, {} excluded",
        report.jobs.len(),
        report.jobs.iter().filter(|job| job.fits()).count(),
        report.jobs.iter().filter(|job| job.high()).count(),
        report
            .jobs
            .iter()
            .filter(|job| job.status.as_deref() == Some("excluded"))
            .count()
    );
}

fn read_report(path: &str) -> Report {
    serde_json::from_str(&std::fs::read_to_string(path).expect("report")).expect("a report")
}

/// Two term lists side by side over the union of their jobs.
fn compare(a: &Report, b: &Report) {
    let keys = |report: &Report| -> BTreeMap<String, Job> {
        report
            .jobs
            .iter()
            .map(|job| (job.key.clone(), job.clone()))
            .collect()
    };
    let (in_a, in_b) = (keys(a), keys(b));
    let union: BTreeSet<&String> = in_a.keys().chain(in_b.keys()).collect();
    let fitting = |jobs: &BTreeMap<String, Job>| jobs.values().filter(|job| job.fits()).count();
    let high = |jobs: &BTreeMap<String, Job>| jobs.values().filter(|job| job.high()).count();
    let requests = |report: &Report| report.requests.values().sum::<usize>();
    println!(
        "union {} jobs; A {} jobs, {} fitting, {} high, {} requests; B {} jobs, {} fitting, {} \
         high, {} requests",
        union.len(),
        in_a.len(),
        fitting(&in_a),
        high(&in_a),
        requests(a),
        in_b.len(),
        fitting(&in_b),
        high(&in_b),
        requests(b)
    );
    for (name, ours, theirs) in [("A", &in_a, &in_b), ("B", &in_b, &in_a)] {
        let missed: Vec<&Job> = theirs
            .values()
            .filter(|job| job.fits() && !ours.contains_key(&job.key))
            .collect();
        println!("fitting jobs {name} missed: {}", missed.len());
        for job in missed {
            println!(
                "  {} {} | {} | {:?}",
                job.score, job.key, job.title, job.terms
            );
        }
    }
}
