//! App state, settings, the end of the setup, reset and UI error reports.

// Tauri passes command arguments (`State` too) by value. Commands with file, vault or
// database work are `async`: synchronous commands would run on the window thread and make
// the interface stutter.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri passes command arguments by value"
)]

use std::collections::VecDeque;
use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use jiff::Timestamp;
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::fetch::policy::Policy;
use jobalert_core::model::Place;
use jobalert_core::pipeline::{self, RunEvent, dry_run};
use jobalert_core::profile;
use jobalert_core::reset::{self, ResetPlan};
use jobalert_core::store::Backup;
use jobalert_core::view::{
    self, JobQuery, JobSort, Mailbox, ProfileInfo, ResetSummary, SettingsPatch,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};

use super::{Activity, AppState, CmdResult, lock, scoring};

/// UI error reports per minute that reach the log.
const UI_ERRORS_PER_MINUTE: usize = 10;
const MAX_UI_MESSAGE_CHARS: usize = 500;
const MAX_UI_SOURCE_CHARS: usize = 200;

/// The mailbox as the interface shows it. The dry run never touches the vault but shows a
/// mailbox: otherwise the app would ask for one, and what it should demonstrate could not be
/// seen. `example.org` is reserved for examples and cannot be a real mailbox.
pub(super) fn mailbox(state: &AppState) -> Mailbox {
    let (user, error) = if state.dry_run {
        (Some("probelauf@example.org".to_string()), None)
    } else {
        state.gmail_user()
    };
    let checked_at = if state.dry_run {
        None
    } else {
        state
            .store
            .kv_get(super::mailbox::CHECKED_AT)
            .ok()
            .flatten()
            .and_then(|at| at.parse::<Timestamp>().ok())
    };
    Mailbox {
        user,
        vault: crate::platform::vault_kind(),
        error,
        check: lock(&state.mailbox_check).clone(),
        checked_at,
    }
}

/// The stored profile for the interface with what the engine understood of it; an
/// unreadable file is logged and shown as none. The dry run shows its sample profile.
pub(super) fn profile_info(state: &AppState, workspace: &std::path::Path) -> Option<ProfileInfo> {
    let info = if state.dry_run {
        let sample = profile::ProfileInfo {
            path: PathBuf::from(dry_run::PROFILE_NAME),
            bytes: dry_run::PROFILE_JSON.len() as u64,
            saved_at: None,
            parse_error: None,
        };
        ProfileInfo::of(&sample, Some(dry_run::PROFILE_NAME.to_owned()))
            .with_form(profile::parse(dry_run::PROFILE_JSON).ok())
    } else {
        match profile::info(workspace) {
            Ok(info) => {
                ProfileInfo::of(&info?, None).with_form(profile::load(workspace).ok().flatten())
            }
            Err(e) => {
                log::warn!("profile not readable: {e}");
                return None;
            }
        }
    };
    if info.parse_error.is_some() {
        return Some(info);
    }
    let Some(matcher) = state.compiled_profile() else {
        return Some(info);
    };
    match info.clone().understood_by(&matcher, &state.store) {
        Ok(understood) => Some(understood),
        Err(e) => {
            log::warn!("profile state not read: {e}");
            Some(info)
        }
    }
}

/// Everything the page needs - without attaching to a run.
fn build_state(state: &AppState) -> CmdResult<view::AppState> {
    let settings = state.settings()?;
    let workspace = state.workspace();
    let now = Timestamp::now();
    let policy = if state.dry_run {
        Policy::in_memory()
    } else {
        Policy::load(&state.policy_path(), now)
    };
    let last_scan_run = pipeline::last_scan_run(&state.store)?;
    let empty_mails = state.store.zero_posting_mails(last_scan_run)?;
    let last_alerts = state.store.last_alerts().unwrap_or_else(|e| {
        log::warn!("last alert mails not read: {e}");
        Vec::new()
    });
    let counts = view::job_page(
        &state.store,
        &JobQuery {
            place: Place::Inbox,
            sort: JobSort::Newest,
            search: None,
            limit: 0,
            offset: 0,
            portals: Vec::new(),
            bands: Vec::new(),
            received_since: None,
            run: None,
        },
    )?
    .counts;
    let last_run = pipeline::last_run(&state.store)?;
    let running = match &*lock(&state.activity) {
        Activity::Run(run) => Some(run.snapshot()),
        _ => None,
    };
    Ok(view::AppState {
        platform: crate::platform::platform(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        dry_run: state.dry_run,
        // The dry run comes with a mailbox and a sample profile: it starts in the app itself,
        // never in the setup (the smoke probe on a fresh CI machine relies on it). The setup
        // stays until it reached "Alles eingerichtet" (`finish_onboarding`).
        first_run: !state.dry_run && !settings.onboarded,
        running,
        mailbox: mailbox(state),
        profile: profile_info(state, &workspace),
        portals: view::portal_states(&policy, &settings, &empty_mails, &last_alerts, now),
        last_run,
        counts,
        match_pending: state.match_pending(),
        log_dir: state.data_dir.join(jobalert_core::LOG_DIR),
        data_dir: state.data_dir.clone(),
        reset_report: lock(&state.reset_report)
            .as_ref()
            .map(|report| ResetSummary {
                removed: report.removed,
                failed: report.failed.len(),
            }),
    })
}

/// Everything the page needs at the start (and after a reload). If a run is in progress,
/// `channel` attaches the page to its events again (otherwise it stays unused).
#[tauri::command]
pub async fn app_state(
    app: AppHandle,
    state: State<'_, AppState>,
    channel: Channel<RunEvent>,
) -> CmdResult<view::AppState> {
    if let Activity::Run(run) = &*lock(&state.activity) {
        run.attach(channel.clone());
    }
    state.scoring.set_page(channel);
    at_start(&app, &state);
    build_state(&state)
}

/// Once per app start, on the first page load: a rescore if jobs wait for a score (new
/// profile, engine update), in the background. The app never fetches by itself (user
/// decision 2026-10-01: only by hand).
fn at_start(app: &AppHandle, state: &AppState) {
    static CHECKED: AtomicBool = AtomicBool::new(false);
    if CHECKED.swap(true, Ordering::SeqCst) {
        return;
    }
    daily_backup(app);
    if state.busy() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        scoring::rescore_if_pending(&app, &state);
    });
}

/// Once per app start, after the first page load and off the window thread: the database's
/// copy of the day in the data folder (`Store::backup_daily`, the newest three kept). The dry
/// run has none: its database lives in memory.
fn daily_backup(app: &AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let today = jobalert_core::time::local_date(Timestamp::now());
        match state.store.backup_daily(today) {
            Ok(Some(copy)) => log::info!(
                "database copied to {}",
                copy.file_name().unwrap_or_default().to_string_lossy()
            ),
            Ok(None) => {}
            Err(e) => log::warn!("database not copied: {e}"),
        }
    });
}

/// Saves the portal switches. The workspace only changes through the dialog.
#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> CmdResult<view::AppState> {
    let mut settings = state.settings()?;
    patch.apply(&mut settings);
    settings.save(&state.store)?;
    build_state(&state)
}

/// The setup reached "Alles eingerichtet": the next start opens the Jobs view
/// (`Settings::onboarded`; a reset deletes it with the database).
#[tauri::command]
pub async fn finish_onboarding(state: State<'_, AppState>) -> CmdResult<()> {
    let mut settings = state.settings()?;
    settings.onboarded = true;
    settings.save(&state.store)?;
    Ok(())
}

/// "Reset everything": leave the order, then restart - deleting happens at the start.
#[tauri::command]
pub async fn reset_all(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    state.ensure_idle()?;
    state.ensure_real()?;
    let plan = ResetPlan {
        workspace: state.workspace(),
    };
    reset::request(&state.data_dir, &plan)?;
    log::info!("reset requested, restarting");
    app.request_restart();
    Ok(())
}

/// The copies of the database in the data folder, newest first ("Sicherung
/// wiederherstellen"): the daily ones, the ones before an update and before a restore. None in
/// the dry run, whose database lives in memory.
#[tauri::command]
pub async fn list_backups(state: State<'_, AppState>) -> CmdResult<Vec<Backup>> {
    Ok(state.store.backups()?)
}

/// Restores the database from its copy `id` (a name of `list_backups`). The state it replaces
/// is copied first and that copy returned: restoring it is the undo. The app is held
/// meanwhile like a file command (no run, sign-in or file command writes the database), and
/// the dry run never restores. Afterwards the scores follow the profile (a
/// rescore when the copy's are of another profile or engine); the page loads everything
/// again.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<Backup> {
    state.ensure_real()?;
    let files = state.claim_files(&app)?;
    let before = state.store.restore_backup(&id, Timestamp::now())?;
    log::info!(
        "database restored from {id}, the state before is {}",
        before.id
    );
    drop(files);
    scoring::rescore_if_pending(&app, &state);
    Ok(before)
}

/// Errors of the page into the log (cut, single line, at most ten per minute).
#[tauri::command]
pub fn report_ui_error(message: String, source: Option<String>, line: Option<u32>) {
    static RECENT: Mutex<VecDeque<Instant>> = Mutex::new(VecDeque::new());
    {
        let mut recent = lock(&RECENT);
        let now = Instant::now();
        while recent
            .front()
            .is_some_and(|t| now.duration_since(*t) > Duration::from_secs(60))
        {
            recent.pop_front();
        }
        if recent.len() >= UI_ERRORS_PER_MINUTE {
            return;
        }
        recent.push_back(now);
    }
    let flat = |text: &str, max: usize| -> String {
        text.chars()
            .map(|c| if c.is_control() { ' ' } else { c })
            .take(max)
            .collect()
    };
    log::error!(
        "ui: {} ({}:{})",
        flat(&message, MAX_UI_MESSAGE_CHARS),
        flat(source.as_deref().unwrap_or_default(), MAX_UI_SOURCE_CHARS),
        line.unwrap_or(0)
    );
}

/// Errors of a missing folder or file carry what was looked for.
pub(super) fn existing(path: PathBuf, what: &str) -> CmdResult<std::ffi::OsString> {
    if path.exists() {
        Ok(path.into_os_string())
    } else {
        Err(ErrorInfo::new(ErrorKind::NotFound)
            .with("what", what)
            .with("path", path.display().to_string()))
    }
}

/// The text on the clipboard, for the Paste entry of the app's own field menu (the page may
/// not read the clipboard without the engine's prompt). None without text; never logged.
#[tauri::command]
pub fn clipboard_text() -> Option<String> {
    let mut clipboard = arboard::Clipboard::new().ok()?;
    clipboard.get_text().ok()
}
