#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod platform;
mod session;
#[cfg(debug_assertions)]
mod smoke;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicI32, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};

use commands::{Activity, AppState, CloseGuard, GmailUser, Refresh, Scoring};
use jobalert_core::error::ErrorKind;
use jobalert_core::pipeline::demo::{self, StartMode};
use jobalert_core::secrets::Vault;
use jobalert_core::settings::Language;
use jobalert_core::store::Store;
use tauri::Manager;

// ------------------------------------------------------------------ startup error texts
// The start dialog is the only prose here. It speaks the language of the OS, like the OS's
// own dialogs (it shows before the app's own setting could be read): German on a German
// system, English on any other.

/// The words of the start dialog in one language.
struct Texts {
    title: &'static str,
    start_failed: &'static str,
    /// Followed by the log folder and a period.
    see_log: &'static str,
    window_failed: &'static str,
    database_failed: &'static str,
    database_locked: &'static str,
    newer_schema: &'static str,
    /// Followed by the path of the database and a period.
    database_at: &'static str,
    close_other: &'static str,
    use_newer: &'static str,
    database_in_use: &'static str,
    database_damaged: &'static str,
    /// The main window's title in the demo (`--demo`): nobody takes its jobs for real ones.
    demo_title: &'static str,
}

// User-facing text, German by product decision.
const DE: Texts = Texts {
    title: "CXact",
    start_failed: "Die App konnte nicht starten.",
    see_log: "Details stehen im Protokoll unter",
    window_failed: "Das Fenster ließ sich nicht öffnen.",
    database_failed: "Die Datenbank ließ sich nicht öffnen.",
    database_locked: "Die Datenbank ist in einem anderen Programm geöffnet.",
    newer_schema: "Die Daten stammen von einer neueren Version der App.",
    database_at: "Die Datei liegt unter",
    close_other: "Schließ dieses Programm und starte die App neu.",
    use_newer: "Nimm die neuere Version, die Daten bleiben unverändert.",
    database_in_use: "Ist sie in einem anderen Programm geöffnet, schließ es und starte die App neu.",
    database_damaged: "Ist sie beschädigt, benenne die Datei um. Die App legt dann eine neue an, \
        ohne die bisherigen Jobs und Einstellungen.",
    demo_title: "CXact Demo",
};
// end of user-facing text

// User-facing text, English.
const EN: Texts = Texts {
    title: "CXact",
    start_failed: "The app could not start.",
    see_log: "The log has the details, in",
    window_failed: "The window could not open.",
    database_failed: "The database could not be opened.",
    database_locked: "The database is open in another program.",
    newer_schema: "The data comes from a newer version of the app.",
    database_at: "The file is in",
    close_other: "Close that program and start the app again.",
    use_newer: "Use the newer version, the data stays as it is.",
    database_in_use: "If it is open in another program, close that and start the app again.",
    database_damaged: "If it is damaged, rename the file. The app then creates a new one, \
        without the jobs and settings so far.",
    demo_title: "CXact Demo",
};
// ------------------------------------------------------------------ end of user-facing text

/// The start dialog's words: those of the OS's language.
fn texts() -> &'static Texts {
    match platform::system_language() {
        Language::De => &DE,
        Language::En => &EN,
    }
}

/// Exit code from `AppHandle::exit(code)`. Otherwise Tauri always ends the process with 0 on
/// Windows (the event loop only knows `ExitWithCode(0)`).
static EXIT_CODE: AtomicI32 = AtomicI32::new(0);

fn main() {
    let context = tauri::generate_context!();
    // Dry run: database and vault state in memory only, fakes instead of mailbox and
    // portals, no files. Demo: a data folder of its own made anew, a made-up mailbox and
    // portals that bring the bundled ads fetch by fetch; the demo build ("CXact Demo", its
    // identifier ends in `.demo`) always starts so.
    let mode = StartMode::of_app(std::env::args().skip(1), &context.config().identifier);
    let builder = tauri::Builder::default()
        // Must be the first plugin: a second start only brings the existing window to the
        // front.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(window) = app.get_webview_window(platform::MAIN) {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .invoke_handler(commands::invoke_handler())
        // A startup error (database, WebView2 ...) shows up as a dialog with cause and advice;
        // a GUI program without a console would otherwise end without a word.
        .setup(move |app| {
            if let Err(failure) = setup(app, mode) {
                fail(&failure);
            }
            Ok(())
        });
    let app = platform::app(builder)
        .build(context)
        .unwrap_or_else(|error| fail(&Failure::window(&error)));
    app.run_return(|app, event| match event {
        tauri::RunEvent::ExitRequested {
            code: Some(code), ..
        } => EXIT_CODE.store(code, Ordering::SeqCst),
        tauri::RunEvent::Exit => lifecycle::exiting(app),
        _ => {}
    });
    std::process::exit(EXIT_CODE.load(Ordering::SeqCst));
}

/// A startup failure: what the user reads (in the OS's language, may be empty: then only
/// that the app could not start) and the cause for the log (English - the dialog never shows
/// it).
struct Failure {
    message: String,
    cause: String,
}

impl Failure {
    fn other(cause: impl std::fmt::Display) -> Failure {
        Failure {
            message: String::new(),
            cause: cause.to_string(),
        }
    }

    /// The window or the UI could not be created; the platform may know what helps.
    fn window(cause: impl std::fmt::Display) -> Failure {
        let text = texts();
        let message = match platform::window_hint(platform::system_language()) {
            Some(hint) => format!("{}\n\n{hint}", text.window_failed),
            None => text.window_failed.to_owned(),
        };
        Failure {
            message,
            cause: format!("window: {cause}"),
        }
    }

    /// The database could not be opened: what happened, where the file is and what to do.
    /// A database of a newer version is not damaged - it must not be put aside.
    fn database(path: &Path, error: &jobalert_core::Error) -> Failure {
        let text = texts();
        let at = format!("{} {}.", text.database_at, path.display());
        let message = match error.kind() {
            ErrorKind::NewerSchema => format!("{} {at}\n\n{}", text.newer_schema, text.use_newer),
            ErrorKind::FileLocked => {
                format!("{} {at}\n\n{}", text.database_locked, text.close_other)
            }
            _ => format!(
                "{} {at}\n\n{} {}",
                text.database_failed, text.database_in_use, text.database_damaged
            ),
        };
        Failure {
            message,
            cause: format!("database: {error}"),
        }
    }
}

/// Shows a startup error and exits.
fn fail(failure: &Failure) -> ! {
    log::error!("startup failed: {}", failure.cause);
    let words = texts();
    let mut text = words.start_failed.to_owned();
    if !failure.message.is_empty() {
        text = format!("{text}\n\n{}", failure.message);
    }
    rfd::MessageDialog::new()
        .set_level(rfd::MessageLevel::Error)
        .set_title(words.title)
        .set_description(format!(
            "{text}\n\n{} {}.",
            words.see_log,
            platform::LOG_DIR_HINT
        ))
        .set_buttons(rfd::MessageButtons::Ok)
        .show();
    std::process::exit(1);
}

/// The log file in the data folder, and the panic hook that writes to it.
fn install_log(data_dir: &Path) {
    let level = if cfg!(debug_assertions) {
        log::LevelFilter::Debug
    } else {
        log::LevelFilter::Info
    };
    if let Err(error) =
        jobalert_core::logging::FileLogger::install(&data_dir.join(jobalert_core::LOG_DIR), level)
    {
        eprintln!("log file unavailable: {error}");
    }
    // Without a console (GUI program) a panic would otherwise vanish without a trace. Only
    // place and kind: the message of a slice panic quotes ad or mail text.
    std::panic::set_hook(Box::new(|info| {
        let payload = info.payload();
        let message = payload
            .downcast_ref::<&str>()
            .copied()
            .or_else(|| payload.downcast_ref::<String>().map(String::as_str))
            .unwrap_or_default();
        log::error!(
            "{}",
            jobalert_core::logging::panic_line(info.location(), message)
        );
    }));
}

/// The database of a start, the work folder it falls back to and, in the demo, the ads its
/// mailbox brings: the real database, one in memory (dry run) or the demo's, made anew in
/// `<data>/demo` with an empty inbox and its own work folder there with the sample profile,
/// its ads read from the ones the app bundles.
fn open_store(
    app: &tauri::App,
    mode: StartMode,
    app_data: &Path,
    data_dir: &Path,
) -> Result<(Store, PathBuf, Option<Arc<demo::DemoAds>>), Failure> {
    let database = data_dir.join(jobalert_core::DB_FILE);
    let opened = match mode {
        StartMode::Normal => Store::open(&database),
        StartMode::DryRun => Store::in_memory(),
        StartMode::Demo => {
            let resources = app
                .path()
                .resource_dir()
                .map_err(|e| Failure::other(format!("resources: {e}")))?;
            let fresh = demo::create_demo_data(
                app_data,
                &demo::demo_sources(&resources),
                Some(demo::PROFILE_JSON),
            )
            .map_err(|e| Failure::other(format!("demo: {e}")))?;
            log::info!("demo: {} ads", fresh.ads.len());
            let store =
                Store::open(&fresh.database).map_err(|e| Failure::database(&fresh.database, &e))?;
            return Ok((store, fresh.workspace, Some(Arc::new(fresh.ads))));
        }
    };
    // `Documents\CXact`, or the folder of an earlier version that holds the app's files.
    let workspace = jobalert_core::settings::default_workspace(
        &app.path()
            .document_dir()
            .map_err(|e| Failure::other(format!("documents folder: {e}")))?,
    );
    Ok((
        opened.map_err(|e| Failure::database(&database, &e))?,
        workspace,
        None,
    ))
}

/// Startup: log -> panic hook -> crypto -> pending reset -> database -> window.
fn setup(app: &mut tauri::App, mode: StartMode) -> Result<(), Failure> {
    let dry_run = mode == StartMode::DryRun;
    let app_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| Failure::other(format!("data folder: {e}")))?;
    // The demo keeps to a folder of its own inside the app's: its log, database, safety
    // state and work folder. The real ones stay as they are.
    let data_dir = if mode == StartMode::Demo {
        app_data.join(demo::DEMO_DIR)
    } else {
        app_data.clone()
    };
    install_log(&data_dir);
    jobalert_core::install_crypto();
    // Dates in the files follow the OS's zone, like the page's.
    jobalert_core::time::follow_system_zone();
    // A requested reset runs before anything else - nothing holds a file open yet. The dry
    // run and the demo never delete anything.
    let reset_report = (mode == StartMode::Normal)
        .then(|| jobalert_core::reset::perform_pending(&data_dir, &Vault::app()))
        .flatten();
    let (store, default_workspace, demo_ads) = open_store(app, mode, &app_data, &data_dir)?;
    let store = Arc::new(store);
    // The sessions' storage outside the data folder (macOS data stores) goes too.
    if reset_report.is_some() {
        session::forget_all(app.handle().clone(), data_dir.clone());
    }
    app.manage(AppState {
        store: store.clone(),
        default_workspace,
        data_dir,
        dry_run,
        demo: mode == StartMode::Demo,
        demo_ads,
        user_agent: platform::USER_AGENT.to_owned(),
        system_language: jobalert_core::settings::Language::DEFAULT,
        reset_report: Mutex::new(reset_report),
        gmail_user: Mutex::new(GmailUser::Unread),
        mailbox_check: Mutex::new(None),
        mailbox_epoch: AtomicU64::new(0),
        activity: Mutex::new(Activity::Idle),
        scoring: Scoring::default(),
        refresh: Refresh::default(),
        close_guard: CloseGuard::default(),
    });
    // The web view version goes to the log only: the UI does not need it, and for debugging
    // the log is more reliable than a screenshot.
    let webview_version = tauri::webview_version().unwrap_or_default();
    log::info!(
        "start {}{} (web view {})",
        env!("CARGO_PKG_VERSION"),
        match mode {
            StartMode::Normal => "",
            StartMode::DryRun => " (dry run)",
            StartMode::Demo => " (demo)",
        },
        if webview_version.is_empty() {
            "unknown"
        } else {
            &webview_version
        }
    );

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == platform::MAIN)
        .cloned()
        .ok_or_else(|| Failure::window("no configuration for the main window"))?;
    let builder =
        tauri::WebviewWindowBuilder::from_config(app.handle(), &config).map_err(Failure::window)?;
    // Nobody takes the demo's jobs for real ones: its window says it is the demo.
    let builder = if mode == StartMode::Demo {
        builder.title(texts().demo_title)
    } else {
        builder
    };
    let builder = platform::harden(builder, app.config());
    #[cfg(debug_assertions)]
    let builder = smoke::attach(builder);
    let window = builder.build().map_err(Failure::window)?;
    let maximized = geometry::restore(&window, &store);
    platform::apply(&window).map_err(Failure::window)?;
    // Cards hidden for now keep their defaults (the palette, the language, the export).
    if let Ok(mut settings) = jobalert_core::settings::Settings::load(&store)
        && settings.fit_hidden()
        && let Err(e) = settings.save(&store)
    {
        log::warn!("hidden settings not reset: {e}");
    }
    // The chosen palette before the window shows (the page reads it from the app state).
    let palette = jobalert_core::settings::Settings::load(&store)
        .map(|settings| settings.palette)
        .unwrap_or_default();
    platform::dress(&window, palette);
    platform::reveal_after_first_load(&window, maximized);
    lifecycle::watch(&window, store);
    #[cfg(debug_assertions)]
    if std::env::args().any(|arg| arg == "--devtools") {
        window.open_devtools();
    }
    Ok(())
}

/// Window placement (size, position, maximized) across restarts - only if it lies on an
/// existing screen (otherwise the window stays centered). The rules live in
/// `jobalert_core::window`; this only reads and moves the window.
mod geometry {
    use jobalert_core::store::Store;
    use jobalert_core::window::{self, Placement, Screen};
    use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

    /// Moves and sizes the (still hidden) window. Returns whether it should be maximized:
    /// maximizing shows a window at once, so that waits for the first paint
    /// (`platform::reveal_after_first_load`).
    pub fn restore<R: Runtime>(window: &WebviewWindow<R>, store: &Store) -> bool {
        let screens: Vec<Screen> = window
            .available_monitors()
            .unwrap_or_default()
            .iter()
            .map(|m| Screen {
                x: m.position().x,
                y: m.position().y,
                width: m.size().width,
                height: m.size().height,
            })
            .collect();
        let restore = window::restore(Placement::load(store), &screens);
        if let Some(bounds) = restore.bounds {
            // Move first, then size: moving to a screen with another scale factor would
            // otherwise convert the size.
            let _ = window.set_position(PhysicalPosition::new(bounds.x, bounds.y));
            let _ = window.set_size(PhysicalSize::new(bounds.width, bounds.height));
        }
        restore.maximized
    }

    pub fn save<R: Runtime>(window: &WebviewWindow<R>, store: &Store) {
        // Minimized, Windows reports only placeholders (-32000, 0x0) - overwrite nothing.
        if window.is_minimized().unwrap_or(false) {
            return;
        }
        let maximized = window.is_maximized().unwrap_or(false);
        let (Ok(pos), Ok(size)) = (window.outer_position(), window.inner_size()) else {
            return;
        };
        let placement = Placement::on_close(
            Placement::load(store),
            maximized,
            (pos.x, pos.y),
            (size.width, size.height),
        );
        if let Err(e) = placement.save(store) {
            log::warn!("window placement not saved: {e}");
        }
    }
}

/// Closing and quitting (the close button, Alt+F4, Cmd+W and Cmd+Q, which the macOS menu turns
/// into a close of the window): with unsaved changes in the Profil view the window stays and
/// the page asks (`close-requested`: save, discard or cancel), then closes it itself; a page
/// that does not answer within a moment does not keep it open. While a fetch runs the page
/// asks too (`close-running`: "Schließen" or "Abbrechen", `answer_close`); a second close
/// while it asks closes anyway. Otherwise the close button never asks. If something is
/// running, the window stays briefly (the page shows a blocker on the `closing` event), the
/// run is cancelled and gets at most ten seconds to finish writing its files - then the app
/// ends in any case. Once the main window is gone the app ends too:
/// no process stays behind the single-instance lock. An end without any window event (macOS:
/// quit from the Dock, logout) still saves the placement and gives a running fetch the same
/// grace (`exiting`).
mod lifecycle {
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::time::Duration;

    use jobalert_core::store::Store;
    use tauri::{AppHandle, Emitter as _, Manager as _, Runtime, WebviewWindow, WindowEvent};

    use crate::commands::AppState;

    /// How long a cancelled run may still clean up.
    const GRACE: Duration = Duration::from_secs(10);
    const STEP: Duration = Duration::from_millis(100);
    /// The event that asks the page about its unsaved changes (`ui/src/lib/ipc/api.ts`,
    /// `onCloseRequested`).
    const CLOSE_REQUESTED: &str = "close-requested";
    /// The event that asks the page whether to close while a fetch runs
    /// (`ui/src/lib/ipc/api.ts`, `onCloseRunning`).
    const CLOSE_RUNNING: &str = "close-running";
    /// How long a close request waits for the page's first word before the window closes.
    const ANSWER: Duration = Duration::from_secs(3);

    /// The closing sequence runs exactly once: further clicks on the close button change
    /// nothing, and the end of the process does not wait a second time.
    static CLOSING: AtomicBool = AtomicBool::new(false);

    pub fn watch<R: Runtime>(window: &WebviewWindow<R>, store: Arc<Store>) {
        let win = window.clone();
        window.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                super::geometry::save(&win, &store);
                let state = win.state::<AppState>();
                if state.close_guard.unsaved() && !CLOSING.load(Ordering::SeqCst) {
                    let asked = state.close_guard.answers();
                    match win.emit(CLOSE_REQUESTED, ()) {
                        Ok(()) => {
                            api.prevent_close();
                            // The question must be seen (closed from the taskbar while
                            // minimized, say): the window comes to the front.
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            wait_for_answer(&win, asked);
                            return;
                        }
                        Err(e) => log::warn!("close request not sent to the page ({e})"),
                    }
                }
                // A fetch runs: the page asks first whether to close anyway and answers with
                // `answer_close`. Asked already (a page that cannot answer) or answered
                // "Schließen": the window closes.
                if state.fetching() && !CLOSING.load(Ordering::SeqCst) && state.close_guard.ask() {
                    match win.emit(CLOSE_RUNNING, ()) {
                        Ok(()) => {
                            api.prevent_close();
                            let _ = win.unminimize();
                            let _ = win.set_focus();
                            return;
                        }
                        Err(e) => log::warn!("close question not sent to the page ({e})"),
                    }
                }
                if !state.busy() {
                    return;
                }
                api.prevent_close();
                if CLOSING.swap(true, Ordering::SeqCst) {
                    return;
                }
                // The note names what the window waits for (a fetch, a rescore, a sign-in...).
                let activity = state.activity_name();
                let _ = win.emit("closing", serde_json::json!({ "activity": activity }));
                state.scoring.stop();
                state.cancel_run();
                let app = win.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    for _ in 0..(GRACE.as_millis() / STEP.as_millis()) {
                        if !app.state::<AppState>().busy() {
                            break;
                        }
                        tokio::time::sleep(STEP).await;
                    }
                    app.exit(0);
                });
            }
            WindowEvent::Destroyed => {
                win.state::<AppState>().cancel_run();
                win.app_handle().exit(0);
            }
            _ => {}
        });
    }

    /// The page answers a close request at once (it shows its question); without a word
    /// from it the window closes anyway.
    fn wait_for_answer<R: Runtime>(win: &WebviewWindow<R>, asked: u64) {
        let win = win.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(ANSWER).await;
            let state = win.state::<AppState>();
            if state.close_guard.answers() == asked {
                log::warn!("the page did not answer the close request, closing");
                state.close_guard.set(false);
                if let Err(e) = win.close() {
                    log::warn!("window not closed: {e}");
                }
            }
        });
    }

    /// The process ends (`RunEvent::Exit`). Without the closing sequence before it - macOS
    /// quits from the Dock or at logout through `terminate:` without any window event - this
    /// is the last chance: save the placement, start no own run any more, cancel a running
    /// one and wait for it the same grace. The runtime threads keep running meanwhile. Every
    /// way out ends here, so the files still waiting for a mark are written last.
    pub fn exiting<R: Runtime>(app: &AppHandle<R>) {
        let Some(state) = app.try_state::<AppState>() else {
            return;
        };
        if !CLOSING.swap(true, Ordering::SeqCst) {
            if let Some(window) = app.get_webview_window(crate::platform::MAIN) {
                super::geometry::save(&window, &state.store);
            }
            state.scoring.stop();
            state.cancel_run();
            for _ in 0..(GRACE.as_millis() / STEP.as_millis()) {
                if !state.busy() {
                    break;
                }
                std::thread::sleep(STEP);
            }
        }
        crate::commands::flush_marks(&state);
    }
}
