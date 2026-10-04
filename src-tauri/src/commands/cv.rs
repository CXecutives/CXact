//! "Aus Lebenslauf ausfüllen": the CV is chosen in a file dialog of this side or dropped on the
//! window (the window keeps what was dropped, `AppState::note_drop`); the page never sends a
//! path. The file is read off the window thread with a time limit, sent to the CV worker
//! (`jobalert_core::ai`), and its answer merged into the one profile, saved at once. The dry
//! run answers `dryRun` before anything is read, so no test ever reaches the paid worker.

use std::path::PathBuf;
use std::time::Duration;

use jiff::Timestamp;
use jiff::tz::TimeZone;
use jobalert_core::ai::{self, CvClient};
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::profile::{self, cv};
use jobalert_core::view::ProfileInfo;
use tauri::{AppHandle, State, WebviewWindow};
use tokio_util::sync::CancellationToken;

use super::app::profile_info;
use super::{Activity, AppState, CmdResult, busy_error, lock, scoring};

/// Reading the file takes longer than this: it is no CV the app can read.
const READ_LIMIT: Duration = Duration::from_secs(30);
/// What the window dropped counts for the CV import this long.
const DROP_FRESH: Duration = Duration::from_secs(120);

/// Title of the file dialog (the only words this side shows itself here).
mod texts {
    // User-facing text, German.
    pub const PICK_CV: &str = "Lebenslauf wählen";
    // end of user-facing text
}

/// "Aus Lebenslauf ausfüllen": `dropped` takes the files last dropped on the window, else the
/// file dialog asks (`None` when it is closed or the import cancelled). The stored profile.
/// Fails with `cv` and the import's code
/// (`ErrorInfo::from(&CvError)`); `dryRun` in the dry run.
#[tauri::command]
pub async fn profile_from_cv(
    app: AppHandle,
    window: WebviewWindow,
    state: State<'_, AppState>,
    dropped: bool,
) -> CmdResult<Option<ProfileInfo>> {
    if state.dry_run {
        return Err(ErrorInfo::new(ErrorKind::DryRun));
    }
    let paths = if dropped {
        state
            .take_drop(DROP_FRESH)
            .ok_or_else(|| ErrorInfo::not_found("file"))?
    } else {
        match rfd::AsyncFileDialog::new()
            .set_title(texts::PICK_CV)
            .add_filter(texts::PICK_CV, &cv::EXTENSIONS)
            .set_parent(&window)
            .pick_files()
            .await
        {
            Some(files) => files.iter().map(|f| f.path().to_path_buf()).collect(),
            None => return Ok(None),
        }
    };
    let guard = CvGuard::claim(&state, &app)?;
    let cancel = guard.cancel.clone();
    let result = import(&state, paths, &cancel).await;
    drop(guard);
    match result {
        Ok(Some(())) => {
            scoring::profile_changed(&app, &state);
            Ok(profile_info(&state, &state.workspace()?))
        }
        Ok(None) => Ok(None),
        Err(error) => Err(error),
    }
}

/// Reads, sends and merges; `None` when cancelled.
async fn import(
    state: &AppState,
    paths: Vec<PathBuf>,
    cancel: &CancellationToken,
) -> CmdResult<Option<()>> {
    let cv_error = |e: &cv::CvError| ErrorInfo::from(e);
    let read = tauri::async_runtime::spawn_blocking(move || cv::read(&paths));
    let file = match tokio::time::timeout(READ_LIMIT, read).await {
        Ok(Ok(Ok(file))) => file,
        Ok(Ok(Err(e))) => return Err(cv_error(&e)),
        Ok(Err(_)) | Err(_) => return Err(cv_error(&cv::CvError::Unreadable)),
    };
    let id = ai::install_id(&state.data_dir)?;
    let client = CvClient::new().map_err(|e| {
        log::warn!("cv: client not built: {e}");
        cv_error(&cv::CvError::Unavailable)
    })?;
    let today = Timestamp::now().to_zoned(TimeZone::UTC).date();
    let answer = match client.fill(&id, &file, cancel).await {
        Ok(answer) => answer,
        Err(cv::CvError::Cancelled) => return Ok(None),
        Err(e) => {
            if let cv::CvError::Limit { until } = &e {
                ai::note_tries(&state.store, 0, Some(until), today);
            }
            return Err(cv_error(&e));
        }
    };
    ai::note_tries(
        &state.store,
        answer.remaining_today,
        answer.until.as_deref(),
        today,
    );
    let Some((_, filled)) = profile::import_cv(&state.workspace()?, &answer.profile)? else {
        return Err(cv_error(&cv::CvError::Refused));
    };
    log::info!("cv: profile filled ({} fields)", filled.len());
    Ok(Some(()))
}

/// The app held while a CV is read and evaluated (cancellable with `cancel_run`, like a run).
struct CvGuard<'a> {
    state: &'a AppState,
    app: AppHandle,
    cancel: CancellationToken,
}

impl<'a> CvGuard<'a> {
    fn claim(state: &'a AppState, app: &AppHandle) -> CmdResult<CvGuard<'a>> {
        let cancel = CancellationToken::new();
        let mut activity = lock(&state.activity);
        if !matches!(*activity, Activity::Idle) {
            return Err(busy_error(&activity));
        }
        *activity = Activity::Cv(cancel.clone());
        Ok(CvGuard {
            state,
            app: app.clone(),
            cancel,
        })
    }
}

impl Drop for CvGuard<'_> {
    fn drop(&mut self) {
        {
            let mut activity = lock(&self.state.activity);
            if matches!(*activity, Activity::Cv(_)) {
                *activity = Activity::Idle;
            }
        }
        // A profile change meanwhile found the slot busy: its rescore starts now.
        scoring::after_run(&self.app);
    }
}
