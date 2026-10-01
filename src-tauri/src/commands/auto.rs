//! "Jobs abrufen" by itself (user decision 2026-10-01; supersedes "the app never fetches by
//! itself", 2026-09-26): at the start and every four hours while the app is open, as long as
//! Einstellungen allow it (`autoFetch`). A run in progress puts it off by five minutes; a fetch
//! that cannot start (no mailbox and no source to search) waits for the next turn. The dry run
//! and the demo never fetch by themselves. The run goes out on the page's channel, like a
//! rescore the app starts: the page shows it as any fetch.

use std::time::Duration;

use jiff::Timestamp;
use jobalert_core::pipeline::{self, RunKind, RunRequest};
use tauri::{AppHandle, Manager};

use super::AppState;

/// A run in progress puts the automatic fetch off by this much.
const PUT_OFF: Duration = Duration::from_secs(5 * 60);
/// While the switch is off, it is looked at again after this long.
const LOOK_AGAIN: Duration = Duration::from_secs(15 * 60);

/// Starts the loop of the automatic fetch (once, on the first page load).
pub(super) fn start(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.dry_run || state.demo {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(next_wait(&app)).await;
            let state = app.state::<AppState>();
            if !switched_on(&state) {
                continue;
            }
            if state.busy() {
                tokio::time::sleep(PUT_OFF).await;
                continue;
            }
            let request = RunRequest {
                kind: RunKind::Fetch,
                only: None,
            };
            match super::run::launch(&app, &state, request, state.scoring.page()) {
                Ok(()) => log::info!("automatic fetch started"),
                Err(e) => {
                    log::info!("automatic fetch did not start: {:?}", e.kind);
                    tokio::time::sleep(pipeline::AUTO_EVERY.unsigned_abs()).await;
                }
            }
        }
    });
}

fn switched_on(state: &AppState) -> bool {
    state.settings().is_ok_and(|settings| settings.auto_fetch)
}

/// How long until the next automatic fetch is due (the switch off: a while, then again).
fn next_wait(app: &AppHandle) -> Duration {
    let state = app.state::<AppState>();
    if !switched_on(&state) {
        return LOOK_AGAIN;
    }
    let now = Timestamp::now();
    let last = pipeline::last_run(&state.store)
        .ok()
        .flatten()
        .map(|summary| summary.finished_at);
    pipeline::auto_due(last, now)
        .duration_since(now)
        .try_into()
        .unwrap_or(Duration::ZERO)
}
