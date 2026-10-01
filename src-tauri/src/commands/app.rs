//! App state, settings, workspace, reset and UI error reports.

// Tauri passes command arguments (`State` too) by value. Commands with file, vault or
// database work are `async`: synchronous commands would run on the window thread and make
// the interface stutter.
#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri passes command arguments by value"
)]

use std::collections::VecDeque;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use jiff::Timestamp;
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::export::{self, RESULT_DIR};
use jobalert_core::fetch::policy::Policy;
use jobalert_core::model::Place;
use jobalert_core::pipeline::{self, Matcher as _, RunEvent, demo};
use jobalert_core::profile;
use jobalert_core::reset::{self, ResetPlan};
use jobalert_core::store::Backup;
use jobalert_core::view::{
    self, JobQuery, JobSort, Mailbox, ProfileEntry, ProfileInfo, ResetSummary, SettingsPatch,
    SettingsView, WorkspacePick, WorkspaceProfile,
};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State, WebviewWindow};

use super::{Activity, AppState, CmdResult, lock, scoring, texts};

/// UI error reports per minute that reach the log.
const UI_ERRORS_PER_MINUTE: usize = 10;
const MAX_UI_MESSAGE_CHARS: usize = 500;
const MAX_UI_SOURCE_CHARS: usize = 200;

/// The mailbox as the interface shows it. The dry run and the demo never touch the vault
/// but show a mailbox: otherwise the app would ask for one, and what they should
/// demonstrate could not be seen. `example.org` and `example.com` are reserved for examples
/// and cannot be a real mailbox.
pub(super) fn mailbox(state: &AppState) -> Mailbox {
    let (user, error) = if state.dry_run {
        (Some("probelauf@example.org".to_string()), None)
    } else if state.demo {
        (Some(demo::DEMO_ADDRESS.to_string()), None)
    } else {
        state.gmail_user()
    };
    let checked_at = if state.dry_run || state.demo {
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
            path: PathBuf::from(demo::PROFILE_NAME),
            bytes: demo::PROFILE_JSON.len() as u64,
            saved_at: None,
            parse_error: None,
        };
        ProfileInfo::of(&sample, Some(demo::PROFILE_NAME.to_owned()))
            .with_form(profile::form_of(demo::PROFILE_JSON))
    } else {
        match profile::info(workspace) {
            Ok(info) => ProfileInfo::of(&info?, None).with_form(profile::stored_form(workspace)),
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

/// The profiles of the work folder for the switcher; the dry run has its sample profile
/// only.
pub(super) fn profile_entries(
    state: &AppState,
    workspace: &std::path::Path,
) -> CmdResult<Vec<ProfileEntry>> {
    if state.dry_run {
        let role = profile::form_of(demo::PROFILE_JSON)
            .map(|form| form.title.trim().to_owned())
            .filter(|title| !title.is_empty());
        return Ok(vec![ProfileEntry {
            id: 1,
            name: None,
            role,
            active: true,
        }]);
    }
    Ok(view::profile_entries(workspace)?)
}

/// Everything the page needs - without attaching to a run.
fn build_state(state: &AppState) -> CmdResult<view::AppState> {
    let settings = state.settings()?;
    let workspace = settings.workspace_or(&state.default_workspace);
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
            unread: false,
            sort: JobSort::Newest,
            search: None,
            limit: 0,
            offset: 0,
            portal: None,
            band: None,
            contracts: Vec::new(),
            work_mode: None,
            run: None,
        },
    )?
    .counts;
    let last_run = pipeline::last_run(&state.store)?;
    let result_dir = workspace.join(RESULT_DIR);
    let running = match &*lock(&state.activity) {
        Activity::Run(run) => Some(run.snapshot()),
        _ => None,
    };
    Ok(view::AppState {
        platform: crate::platform::platform(),
        version: env!("CARGO_PKG_VERSION").to_owned(),
        dry_run: state.dry_run,
        demo: state.demo,
        // The dry run and the demo come with a mailbox and a sample profile: they start in the
        // app itself, never on the first-run page (the smoke probe on a fresh CI machine relies
        // on it; the demo starts with an empty Eingang). The first-run page stays until a fetch
        // has read the mailbox, also after a failed one.
        first_run: !state.dry_run
            && !state.demo
            && !pipeline::has_completed_fetch(&state.store)
            && counts.inbox + counts.archive + counts.trash == 0,
        setup_done: state.dry_run || state.demo || pipeline::has_completed_fetch(&state.store),
        running,
        settings: SettingsView {
            workspace_is_default: settings.workspace.is_none(),
            excel_path: export::overview_path(&result_dir),
            excel_exists: settings.export_excel && export::overview_path(&result_dir).is_file(),
            csv_path: export::csv_path(&result_dir),
            csv_exists: settings.export_csv && export::csv_path(&result_dir).is_file(),
            workspace: workspace.clone(),
        },
        mailbox: mailbox(state),
        profile: profile_info(state, &workspace),
        profiles: profile_entries(state, &workspace).unwrap_or_else(|e| {
            log::warn!("profiles not listed: {e:?}");
            Vec::new()
        }),
        portals: view::portal_states(&policy, &settings, &empty_mails, &last_alerts, now),
        sources: state.store.sources().unwrap_or_else(|e| {
            log::warn!("the sources of the jobs could not be read: {e}");
            Vec::new()
        }),
        fetch_range: settings.fetch_range,
        export_excel: settings.export_excel,
        export_csv: settings.export_csv,
        language: settings.language_or(state.system_language),
        palette: settings.palette,
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
/// profile, engine update), in the background. The app never fetches by itself at the start
/// (user decision 2026-09-26): only "Abrufen" and its keys do.
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
/// run has none: its database lives in memory; nor the demo: it is made anew at every start.
fn daily_backup(app: &AppHandle) {
    if app.state::<AppState>().demo {
        return;
    }
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

/// Saves portal switches, the fetch range, which files the export writes, the language and
/// the palette. The workspace only changes through the dialog. Another language, or the Excel
/// or the CSV file switched on, writes the files a moment later (like a mark); another palette
/// dresses the window at once.
#[tauri::command]
pub async fn save_settings(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> CmdResult<view::AppState> {
    let mut settings = state.settings()?;
    let (language, excel, csv) = (
        settings.language_or(state.system_language),
        settings.export_excel,
        settings.export_csv,
    );
    patch.apply(&mut settings);
    settings.save(&state.store)?;
    if patch.palette.is_some() {
        crate::platform::dress(&window, settings.palette);
    }
    let switched_on = (settings.export_excel && !excel) || (settings.export_csv && !csv);
    if settings.language_or(state.system_language) != language || switched_on {
        super::files::marked(&app);
    }
    build_state(&state)
}

/// Folder dialog for the workspace; `None` if cancelled. The work moves along (user decision
/// 2026-09-26): a folder without a profile gets a copy of the old folder's `profil/`, one
/// with a profile of its own keeps it and the app uses it from now on; the Excel and the CSV
/// file are written in the new folder at once. The app is held meanwhile, like a file
/// command.
#[tauri::command]
pub async fn pick_workspace(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> CmdResult<Option<WorkspacePick>> {
    state.ensure_idle()?;
    // The demo keeps to its own work folder.
    state.ensure_not_demo()?;
    let current = state.workspace()?;
    let Some(folder) = rfd::AsyncFileDialog::new()
        .set_title(texts::of(state.language()?).pick_workspace)
        .set_directory(current.parent().unwrap_or(&current))
        .set_parent(&window)
        .pick_folder()
        .await
    else {
        return Ok(None);
    };
    let folder = folder.path().to_path_buf();
    // Writable? Better a clear error now than later at the export. The dry run never
    // writes anything outside its in-memory database.
    if !state.dry_run {
        let probe = folder.join(".job-alert-monitor-write-test");
        std::fs::write(&probe, b"")
            .map_err(|e| ErrorInfo::from(jobalert_core::Error::io(&folder, e)))?;
        let _ = std::fs::remove_file(probe);
    }
    let files = state.claim_files(&app)?;
    let profile = if state.dry_run {
        WorkspaceProfile::None
    } else {
        take_profile(&current, &folder)?
    };
    let before = state.matcher().map(|m| m.rev().to_owned());
    let mut settings = state.settings()?;
    settings.workspace = Some(folder.clone());
    settings.save(&state.store)?;
    if !state.dry_run {
        write_files(&state, &folder, settings.language_or(state.system_language));
    }
    // The profile lives in the workspace: another folder can mean another profile (its
    // rescore starts once the files are written and the app is free).
    if state.matcher().map(|m| m.rev().to_owned()) != before {
        scoring::profile_changed(&app, &state);
    }
    drop(files);
    Ok(Some(WorkspacePick { folder, profile }))
}

/// The profile of a new work folder: its own, else a copy of the old folder's `profil/` (its
/// files; nothing in the new folder is overwritten).
fn take_profile(old: &Path, new: &Path) -> CmdResult<WorkspaceProfile> {
    if profile::profile_path(new).is_file() {
        return Ok(WorkspaceProfile::Own);
    }
    if old == new || !profile::profile_path(old).is_file() {
        return Ok(WorkspaceProfile::None);
    }
    let io = |path: &Path, e| ErrorInfo::from(jobalert_core::Error::io(path, e));
    let (from, to) = (
        old.join(profile::PROFILE_DIR),
        new.join(profile::PROFILE_DIR),
    );
    std::fs::create_dir_all(&to).map_err(|e| io(&to, e))?;
    for entry in std::fs::read_dir(&from).map_err(|e| io(&from, e))? {
        let entry = entry.map_err(|e| io(&from, e))?;
        let target = to.join(entry.file_name());
        if entry.path().is_file() && !target.exists() {
            std::fs::copy(entry.path(), &target).map_err(|e| io(&target, e))?;
        }
    }
    log::info!("profile copied into the new work folder");
    Ok(WorkspaceProfile::Copied)
}

/// The overviews in the (new) work folder, now; a file that cannot be written says so in the
/// log and is written by the next fetch.
fn write_files(state: &AppState, workspace: &Path, language: jobalert_core::settings::Language) {
    let now = Timestamp::now();
    let overviews = pipeline::refresh_overviews(&state.store, workspace, now, language);
    log::info!(
        "files written in the new work folder: overviews {}",
        if overviews.error.is_none() {
            "written"
        } else {
            "not written"
        }
    );
}

/// "Reset everything": leave the order, then restart - deleting happens at the start.
#[tauri::command]
pub async fn reset_all(app: AppHandle, state: State<'_, AppState>) -> CmdResult<()> {
    state.ensure_idle()?;
    state.ensure_real()?;
    state.ensure_not_demo()?;
    let plan = ResetPlan {
        workspace: state.workspace()?,
        txt_names: state.store.txt_names()?,
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
/// neither the dry run nor the demo restores. Afterwards the scores follow the profile (a
/// rescore when the copy's are of another profile or engine) and the files follow the jobs;
/// the page loads everything again.
#[tauri::command]
pub async fn restore_backup(
    app: AppHandle,
    state: State<'_, AppState>,
    id: String,
) -> CmdResult<Backup> {
    state.ensure_real()?;
    state.ensure_not_demo()?;
    let files = state.claim_files(&app)?;
    let before = state.store.restore_backup(&id, Timestamp::now())?;
    log::info!(
        "database restored from {id}, the state before is {}",
        before.id
    );
    drop(files);
    scoring::rescore_if_pending(&app, &state);
    super::files::marked(&app);
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
