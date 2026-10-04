//! The consultant profile: the editor's form is saved into the one profile file (what the user
//! changed, applied to what the file holds by then). While the form holds unsaved changes,
//! closing the window asks; so it does while a fetch runs (`answer_close`).

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri passes command arguments by value"
)]

use jiff::Timestamp;
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::matching::{self, Vocabulary};
use jobalert_core::pipeline::dry_run;
use jobalert_core::profile;
use jobalert_core::view::{self, AskedTerm, ProfileInfo, ProfileSave};
use tauri::{AppHandle, State, WebviewWindow};

use super::app::profile_info;
use super::{AppState, CmdResult, scoring};

/// Saves the editor into the profile (without one it becomes the profile), keeps the previous
/// file as the backup and scores every job again (in the background).
#[tauri::command]
pub async fn save_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    save: ProfileSave,
) -> CmdResult<ProfileInfo> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let info = profile::save_form(&workspace, &save.before, &save.after)?;
    scoring::profile_changed(&app, &state);
    Ok(profile_info(&state, &workspace).unwrap_or_else(|| ProfileInfo::of(&info, None)))
}

/// The required fields a form not saved yet still lacks, by their names in the form
/// (`profile::missing_required`: the missing line of a new profile).
#[tauri::command]
pub fn profile_missing(form: profile::ProfileForm) -> Vec<String> {
    profile::missing_required(&form)
        .into_iter()
        .map(str::to_owned)
        .collect()
}

/// "Häufig verlangt": the terms the jobs of the last 30 days ask for most that the stored
/// profile does not name (the dry run's sample profile in the dry run); none without a
/// profile.
#[tauri::command]
pub async fn asked_terms(state: State<'_, AppState>) -> CmdResult<Vec<AskedTerm>> {
    let form = if state.dry_run {
        profile::parse(dry_run::PROFILE_JSON).ok()
    } else {
        profile::load(&state.workspace()?)?
    };
    let Some(form) = form else {
        return Ok(Vec::new());
    };
    Ok(view::asked_terms(
        &state.store,
        Some(&form),
        Timestamp::now(),
    )?)
}

/// The engine's words as terms, for the suggestions of the profile's fields (skills and
/// industries); the page asks once.
#[tauri::command]
pub fn vocabulary() -> Vocabulary {
    matching::vocabulary().clone()
}

/// The page holds unsaved changes (or no longer): closing the window then asks first.
#[tauri::command]
pub fn set_unsaved(state: State<'_, AppState>, on: bool) {
    state.close_guard.set(on);
}

/// Closes the window after the page asked about its unsaved changes (saved or discarded):
/// the close goes the usual way (placement, the question about a running fetch) without
/// asking about the changes again.
#[tauri::command]
pub fn close_window(window: WebviewWindow, state: State<'_, AppState>) -> CmdResult<()> {
    state.close_guard.set(false);
    close_now(&window)
}

/// The answer to "Der Abruf läuft noch. Trotzdem schließen?" (main.rs asks while a fetch
/// runs): `close` closes the window, which cancels the fetch and waits for it to stop;
/// otherwise the window stays and the next close asks again.
#[tauri::command]
pub fn answer_close(
    window: WebviewWindow,
    state: State<'_, AppState>,
    close: bool,
) -> CmdResult<()> {
    state.close_guard.answer(close);
    if close { close_now(&window) } else { Ok(()) }
}

fn close_now(window: &WebviewWindow) -> CmdResult<()> {
    window.close().map_err(|e| {
        log::warn!("window not closed: {e}");
        ErrorInfo::new(ErrorKind::Internal)
    })
}
