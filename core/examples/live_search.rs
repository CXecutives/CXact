//! One real search of the sources the app searches itself, to see that it holds against the
//! live pages (a developer's check; nothing is stored, the policy lives in memory):
//!
//! `cargo run -p jobalert-core --example live_search -- "Interim CFO" "SAP FI/CO"`
//!
//! It asks each source's robots.txt and one page per term, at the sources' own pace, and
//! prints what it found. Never part of a test run.

use std::collections::BTreeMap;
use std::sync::Mutex;

use jiff::Timestamp;
use jobalert_core::fetch::http::HttpFetcher;
use jobalert_core::fetch::policy::Policy;
use jobalert_core::fetch::search::search_all;
use jobalert_core::portal::{Portal, Way};
use jobalert_core::store::Store;
use tokio_util::sync::CancellationToken;

/// A current browser's agent, like the app's (`src-tauri/src/platform.rs`).
const AGENT: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like \
                     Gecko) Chrome/140.0.0.0 Safari/537.36";

#[tokio::main]
async fn main() {
    jobalert_core::install_crypto();
    let terms: Vec<String> = std::env::args().skip(1).collect();
    let terms = if terms.is_empty() {
        vec!["Interim CFO".to_owned()]
    } else {
        terms
    };
    let store = Store::in_memory().expect("store");
    let run = store.begin_run().expect("run");
    let policy = Mutex::new(Policy::in_memory());
    let portals: Vec<Portal> = Portal::ALL
        .into_iter()
        .filter(|portal| portal.way() == Way::Search)
        .collect();
    let on = |_: Portal| true;
    let mut found = BTreeMap::new();
    let started = Timestamp::now();
    let done = search_all(
        |_| HttpFetcher::new(AGENT).map_err(|e| e.to_string()),
        (&store, &policy, run),
        (&portals, &terms, &on),
        &CancellationToken::new(),
        Timestamp::now,
        &mut found,
        |event| println!("{event:?}"),
    )
    .await
    .expect("search");
    println!(
        "done: {done} in {}",
        Timestamp::now().duration_since(started)
    );
    for (portal, counts) in &found {
        println!("{}: {counts:?}", portal.key());
    }
    let jobs = store
        .jobs(&jobalert_core::store::JobFilter::default())
        .unwrap_or_default();
    for portal in &portals {
        for job in jobs.iter().filter(|job| job.key.portal == *portal).take(5) {
            println!(
                "  {} | {} | {} | {}",
                portal.key(),
                job.title,
                job.company,
                job.location
            );
        }
    }
}
