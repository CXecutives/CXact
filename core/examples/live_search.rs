//! One real search of the sources the app searches itself, to see that it holds against the
//! live pages (a developer's check; nothing is stored, the policy lives in memory):
//!
//! `cargo run -p jobalert-core --example live_search -- "Interim CFO" "SAP FI/CO"`
//! `cargo run -p jobalert-core --example live_search -- --profile path/to/profil.json`
//!
//! It asks each source's robots.txt and the pages of each term (deeper while they bring new
//! jobs), at the sources' own pace, side by side, and prints what it found. With `--profile`
//! the terms are the deep search's of that profile, as a fetch builds them. Never part of a
//! test run.

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
    let args: Vec<String> = std::env::args().skip(1).collect();
    let terms = match args.as_slice() {
        [flag, path] if flag == "--profile" => {
            let text = std::fs::read_to_string(path).expect("the profile file");
            let form = jobalert_core::profile::form_of(&text).expect("a profile");
            jobalert_core::profile::deep_search_terms(&form)
        }
        [] => vec!["Interim CFO".to_owned()],
        _ => args,
    };
    println!("terms ({}): {terms:?}", terms.len());
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
