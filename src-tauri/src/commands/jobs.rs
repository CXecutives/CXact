//! The job list, the reader and the per-job marks.

use jiff::Timestamp;
use jobalert_core::export;
use jobalert_core::model::Place;
use jobalert_core::pipeline::{self, demo};
use jobalert_core::portal::JobKey;
use jobalert_core::profile;
use jobalert_core::view::{self, Deleted, JobDetail, JobPage, JobQuery, MoveBack};
use tauri::{AppHandle, State};

use super::{AppState, CmdResult, not_found};

/// One page of the list with its counts (one store query).
#[tauri::command]
pub async fn list_jobs(state: State<'_, AppState>, query: JobQuery) -> CmdResult<JobPage> {
    Ok(view::job_page(&state.store, &query)?)
}

/// The reader: the match is assessed again from the stored text (reasons are not stored).
/// A stale stored score is replaced only while no run is active - else the run's catch-up
/// does it.
#[tauri::command]
pub async fn job_detail(state: State<'_, AppState>, key: JobKey) -> CmdResult<JobDetail> {
    let matcher = state.matcher();
    let save = !state.running();
    view::job_detail(
        &state.store,
        &key,
        matcher.as_deref(),
        save,
        Timestamp::now(),
    )?
    .ok_or_else(|| not_found("job"))
}

/// Marks a job as read - only on a real click in the list; `false` = it was read already.
#[tauri::command]
pub async fn mark_read(state: State<'_, AppState>, key: JobKey) -> CmdResult<bool> {
    let changed = state.store.mark_read(&key, Timestamp::now())?;
    Ok(changed)
}

/// Moves jobs to the inbox, the archive or the trash; returns the keys that really moved
/// (the page toasts and undoes only those).
#[tauri::command]
pub async fn move_jobs(
    state: State<'_, AppState>,
    keys: Vec<JobKey>,
    to: Place,
) -> CmdResult<Vec<JobKey>> {
    let moved = state.store.move_jobs(&keys, to, Timestamp::now())?;
    Ok(moved)
}

/// "Wiederherstellen": takes jobs out of the trash, back to where they lay (the archive for
/// a job thrown away from there, the inbox otherwise); returns the keys that really left it.
#[tauri::command]
pub async fn restore_jobs(state: State<'_, AppState>, keys: Vec<JobKey>) -> CmdResult<Vec<JobKey>> {
    let restored = state.store.restore_jobs(&keys, Timestamp::now())?;
    Ok(restored)
}

/// Takes moves back (the undo of a toast): each job returns to the place it came from as it
/// was there, into the trash with its earlier date; returns the keys that really moved.
#[tauri::command]
pub async fn move_back(state: State<'_, AppState>, jobs: Vec<MoveBack>) -> CmdResult<Vec<JobKey>> {
    let back: Vec<_> = jobs
        .into_iter()
        .map(|job| (job.key, job.to, job.trashed_at))
        .collect();
    let moved = state.store.move_back(&back, Timestamp::now())?;
    Ok(moved)
}

/// "Fits anyway": an excluded job counts as scored with its fit score (`include`), or the
/// engine's verdict applies again - assessed right away unless a run is active (then its
/// catch-up does it); `false` = nothing changed.
#[tauri::command]
pub async fn set_override(
    state: State<'_, AppState>,
    key: JobKey,
    include: bool,
) -> CmdResult<bool> {
    let changed = state.store.set_override(&key, include)?;
    if changed && !include && !state.running() {
        let matcher = state.matcher();
        view::job_detail(
            &state.store,
            &key,
            matcher.as_deref(),
            true,
            Timestamp::now(),
        )?;
    }
    Ok(changed)
}

/// "Endgültig löschen": deletes these jobs for good - only those in the trash. Rows, text
/// files and Excel rows go; only a tombstone of each key stays, so no later scan brings them
/// back. Not while a run is active, and it holds the app while it deletes.
#[tauri::command]
pub async fn purge_jobs(
    app: AppHandle,
    state: State<'_, AppState>,
    keys: Vec<JobKey>,
) -> CmdResult<Deleted> {
    forget(&app, &state, Some(&keys))
}

/// Empties the trash like Mail does: every job in it is deleted for good, whatever the list
/// shows (see [`purge_jobs`]); the result names how many and which.
#[tauri::command]
pub async fn empty_trash(app: AppHandle, state: State<'_, AppState>) -> CmdResult<Deleted> {
    forget(&app, &state, None)
}

/// Deletes these jobs for good (`None`: the whole trash, as it is once the app is held).
fn forget(app: &AppHandle, state: &AppState, keys: Option<&[JobKey]>) -> CmdResult<Deleted> {
    let _files = state.claim_files(app)?;
    let keys = match keys {
        Some(keys) => keys.to_vec(),
        None => state.store.trashed_keys()?,
    };
    let workspace = if state.dry_run {
        None
    } else {
        Some(state.workspace()?)
    };
    Ok(pipeline::delete_jobs(
        &state.store,
        workspace.as_deref(),
        &keys,
        Timestamp::now(),
    )?)
}

/// The profile as the prompts use it (the sample profile in the dry run).
fn prompt_profile(state: &AppState) -> CmdResult<serde_json::Value> {
    let profile = if state.dry_run {
        serde_json::from_str(demo::PROFILE_JSON).ok()
    } else {
        profile::load(&state.workspace()?)?
    };
    profile.ok_or_else(|| not_found("profile"))
}

/// The prompt for a deep analysis of a job in any AI chat: the profile without name and
/// contact data, the ad with its key facts, the app's pre-assessment to check, the method,
/// the rubric and the answer format. The app sends it nowhere.
#[tauri::command]
pub async fn ai_prompt(state: State<'_, AppState>, key: JobKey) -> CmdResult<String> {
    let profile = prompt_profile(&state)?;
    let row = state.store.job(&key)?.ok_or_else(|| not_found("job"))?;
    let matcher = state.matcher();
    let source = export::PromptSource::load(&state.store, matcher.as_deref(), &row)?;
    Ok(export::ai_prompt(&profile, source.job(), state.language()?))
}
