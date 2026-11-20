//! The job list, the reader and the per-job marks.

use jiff::Timestamp;
use jobalert_core::export;
use jobalert_core::model::{DescStatus, Place};
use jobalert_core::pipeline::{self, RunKind, RunRequest, dry_run};
use jobalert_core::portal::JobKey;
use jobalert_core::profile;
use jobalert_core::view::{self, Deleted, JobDetail, JobPage, JobQuery, MoveBack, StoredMail};
use tauri::{AppHandle, State};

use super::{AppState, CmdResult, not_found, run};

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

/// "Alert-Mail öffnen" for a mailbox without Gmail: the job's alert mail as the app keeps
/// it (subject, sender, date, text). `notFound` with `what: job` for an unknown job,
/// `what: mail` for one no mail named.
#[tauri::command]
pub async fn alert_mail(state: State<'_, AppState>, key: JobKey) -> CmdResult<StoredMail> {
    if state.store.job(&key)?.is_none() {
        return Err(not_found("job"));
    }
    view::alert_mail(&state.store, &key)?.ok_or_else(|| not_found("mail"))
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
/// catch-up does it); `false` = nothing changed. A job included without its ad text gets a
/// details run for that job, so the score has a text to rest on (see [`needs_ad`]).
#[tauri::command]
pub async fn set_override(
    app: AppHandle,
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
    if changed && include {
        let status = state.store.job(&key)?.map(|job| job.desc_status);
        if status.is_some_and(|status| needs_ad(include, status)) {
            let request = RunRequest {
                kind: RunKind::Details { keys: vec![key] },
            };
            // Through the channel of the app's own runs (like the rescore); a run or sign-in
            // in progress keeps the slot, and the job's ad stays one click away ("Anzeige laden").
            if let Err(e) = run::launch(&app, &state, request, state.scoring.page()) {
                log::info!("ad of an included job not fetched: {:?}", e.kind);
            }
        }
    }
    Ok(changed)
}

/// Whether including a job starts a details run: the ad text was never loaded.
fn needs_ad(include: bool, status: DescStatus) -> bool {
    include && status == DescStatus::Missing
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
    Ok(pipeline::delete_jobs(
        &state.store,
        &keys,
        Timestamp::now(),
    )?)
}

/// The profile as the prompts use it (the sample profile in the dry run).
fn prompt_profile(state: &AppState) -> CmdResult<profile::ProfileForm> {
    let profile = if state.dry_run {
        profile::parse(dry_run::PROFILE_JSON).ok()
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
    let today = jobalert_core::time::local_date(Timestamp::now());
    Ok(export::ai_prompt(&profile, source.job(), today))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_including_a_job_without_its_ad_fetches_it() {
        assert!(needs_ad(true, DescStatus::Missing));
        for status in [
            DescStatus::Ok,
            DescStatus::Teaser,
            DescStatus::Failed,
            DescStatus::Gone,
            DescStatus::Unfetchable,
        ] {
            assert!(!needs_ad(true, status), "{status:?} is left alone");
        }
        assert!(
            !needs_ad(false, DescStatus::Missing),
            "taking it back fetches nothing"
        );
    }
}
