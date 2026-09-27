//! The consultant profiles: the editor's form is saved by merging it into the active
//! profile's file; a chosen file (also the one an AI wrote with the app's prompt) fills the
//! form first. Several
//! profiles, one active: list, switch (every job is scored again), create, duplicate,
//! rename, delete (it becomes the backup) and restore, load a file as a new one. While the
//! form holds unsaved changes, closing the window asks; so it does while a fetch runs
//! (`answer_close`).

#![expect(
    clippy::needless_pass_by_value,
    reason = "Tauri passes command arguments by value"
)]

use std::path::Path;

use jiff::Timestamp;
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::matching::{self, Vocabulary};
use jobalert_core::pipeline::demo;
use jobalert_core::profile;
use jobalert_core::view::{self, AskedTerm, ProfileDraft, ProfileEntry, ProfileInfo, ProfileSave};
use tauri::{AppHandle, State, WebviewWindow};

use super::app::{profile_entries, profile_info};
use super::{AppState, CmdResult, not_found, scoring, texts};

/// Chooses a profile file and reads it into the form for review; nothing is stored until
/// the user saves. `None` if cancelled.
#[tauri::command]
pub async fn pick_profile(
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> CmdResult<Option<ProfileDraft>> {
    let workspace = state.workspace()?;
    let words = texts::of(state.language()?);
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title(words.pick_profile)
        .add_filter(words.profile_filter, &["json"])
        .set_directory(&workspace)
        .set_parent(&window)
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    Ok(Some(profile::draft_from_file(file.path())?.into()))
}

/// The prompt that has any AI write a profile file from a CV (copied by the page), in the
/// app's language.
#[tauri::command]
pub async fn profile_prompt(state: State<'_, AppState>) -> CmdResult<String> {
    Ok(profile::cv_prompt(state.language()?))
}

/// Saves the editor: merges the form into the active profile (or the draft it came from;
/// without any profile it becomes the first), keeps the previous file as the backup and
/// scores every job again (in the background).
#[tauri::command]
pub async fn save_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    save: ProfileSave,
) -> CmdResult<ProfileInfo> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let info = profile::save_form(
        &workspace,
        save.source.as_deref(),
        &save.before,
        &save.after,
        &save.clear,
    )?;
    scoring::profile_changed(&app, &state);
    Ok(profile_info(&state, &workspace).unwrap_or_else(|| ProfileInfo::of(&info, None)))
}

/// The profiles of the work folder, the active one marked (the dry run: its sample
/// profile).
#[tauri::command]
pub async fn list_profiles(state: State<'_, AppState>) -> CmdResult<Vec<ProfileEntry>> {
    profile_entries(&state, &state.workspace()?)
}

/// Every job is scored again when the active profile is another one than `before` (in the
/// background, like after a save).
fn after_change(app: &AppHandle, state: &AppState, workspace: &Path, before: Option<u32>) {
    match profile::active_id(workspace) {
        Ok(now) if now == before => {}
        Ok(_) => scoring::profile_changed(app, state),
        Err(e) => {
            log::warn!("active profile not read after a change: {e}");
            scoring::profile_changed(app, state);
        }
    }
}

/// Makes profile `id` the active one; every job is scored again with it.
#[tauri::command]
pub async fn switch_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
) -> CmdResult<Vec<ProfileEntry>> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let before = profile::active_id(&workspace)?;
    if !profile::switch(&workspace, id)? {
        return Err(not_found("profile"));
    }
    after_change(&app, &state, &workspace, before);
    profile_entries(&state, &workspace)
}

/// A new empty profile, active from now on (nothing scores with it until it names
/// competences).
#[tauri::command]
pub async fn create_profile(
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Vec<ProfileEntry>> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let before = profile::active_id(&workspace)?;
    let id = profile::create(&workspace)?;
    log::info!("profile {id} created");
    after_change(&app, &state, &workspace, before);
    profile_entries(&state, &workspace)
}

/// A copy of profile `id` named `name` (the page's words for a copy), active from now on.
#[tauri::command]
pub async fn duplicate_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
    name: Option<String>,
) -> CmdResult<Vec<ProfileEntry>> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let before = profile::active_id(&workspace)?;
    let Some(copy) = profile::duplicate(&workspace, id, name.as_deref())? else {
        return Err(not_found("profile"));
    };
    log::info!("profile {id} copied as {copy}");
    after_change(&app, &state, &workspace, before);
    profile_entries(&state, &workspace)
}

/// Names profile `id`; an empty name gives it back its default (its role or its number).
#[tauri::command]
pub async fn rename_profile(
    state: State<'_, AppState>,
    id: u32,
    name: String,
) -> CmdResult<Vec<ProfileEntry>> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    if !profile::rename(&workspace, id, &name)? {
        return Err(not_found("profile"));
    }
    profile_entries(&state, &workspace)
}

/// Deletes profile `id` (it becomes the backup next to it, so `restore_profile` brings it
/// back); the active one gives way to the next, the last one leaves none. `false` if there
/// is no such profile.
#[tauri::command]
pub async fn delete_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: u32,
) -> CmdResult<bool> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let before = profile::active_id(&workspace)?;
    let deleted = profile::delete(&workspace, id)?;
    if deleted {
        log::info!("profile {id} deleted");
        after_change(&app, &state, &workspace, before);
    }
    Ok(deleted)
}

/// Brings back profile `id` (the undo of its deletion), or with `null` the active profile's
/// backup (the undo of another file saved over it; the two swap); the profile is the active
/// one then. `false` without a backup.
#[tauri::command]
pub async fn restore_profile(
    app: AppHandle,
    state: State<'_, AppState>,
    id: Option<u32>,
) -> CmdResult<bool> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let before = profile::active_id(&workspace)?;
    let Some(id) = id.or(before) else {
        return Ok(false);
    };
    let restored = profile::restore(&workspace, id)?;
    if restored {
        // The same profile with its other file is another profile too.
        scoring::profile_changed(&app, &state);
    }
    Ok(restored)
}

/// Chooses a profile file and takes it as a new profile, active from now on; `None` if
/// cancelled. A file that is no profile is refused with its reason.
#[tauri::command]
pub async fn load_profile(
    window: WebviewWindow,
    app: AppHandle,
    state: State<'_, AppState>,
) -> CmdResult<Option<Vec<ProfileEntry>>> {
    state.ensure_real()?;
    let workspace = state.workspace()?;
    let words = texts::of(state.language()?);
    let Some(file) = rfd::AsyncFileDialog::new()
        .set_title(words.pick_profile)
        .add_filter(words.profile_filter, &["json"])
        .set_directory(&workspace)
        .set_parent(&window)
        .pick_file()
        .await
    else {
        return Ok(None);
    };
    let before = profile::active_id(&workspace)?;
    let id = profile::import(&workspace, file.path())?;
    log::info!("profile {id} loaded from a file");
    after_change(&app, &state, &workspace, before);
    Ok(Some(profile_entries(&state, &workspace)?))
}

/// "Häufig verlangt": the terms the jobs of the last 30 days ask for most that the stored
/// profile does not name (the dry run's sample profile in the dry run); none without a
/// profile.
#[tauri::command]
pub async fn asked_terms(state: State<'_, AppState>) -> CmdResult<Vec<AskedTerm>> {
    let form = if state.dry_run {
        profile::form_of(demo::PROFILE_JSON)
    } else {
        profile::stored_form(&state.workspace()?)
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
