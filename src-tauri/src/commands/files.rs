//! Result files: open checked targets, and the files that follow the user's marks.

use std::fmt::Write as _;
use std::sync::Mutex;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

use jiff::Timestamp;
use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::export::{self, RESULT_DIR};
use jobalert_core::model::gmail_url_for;
use jobalert_core::pipeline;
use jobalert_core::view::OpenTarget;
use tauri::{AppHandle, Manager, State};

use super::app::existing;
use super::{AppState, CmdResult, lock, not_found};

/// Google page to create an app password.
const APP_PASSWORD_URL: &str = "https://myaccount.google.com/apppasswords";
/// Google page to turn on 2-step verification, which an app password requires.
const TWO_STEP_URL: &str = "https://myaccount.google.com/signinoptions/twosv";
/// How long the files wait after the last mark: a few clicks in a row write once.
const SETTLE: Duration = Duration::from_secs(2);
/// How often a waiting refresh looks whether the app is idle again.
const IDLE_POLL: Duration = Duration::from_millis(500);

/// The files a mark changes - the overviews (the Excel and the CSV file) - follow the user's
/// marks a moment after the last one:
/// never while a run, a sign-in or a file command holds the app (a run writes them at its
/// end, a refresh then follows), never in the dry run. Marks of the last moments before the
/// app ends are written when it ends ([`flush_marks`]).
#[derive(Default)]
pub struct Refresh {
    /// Counts the marks: only the wait of the last one writes.
    marks: AtomicU64,
    /// The mark the files follow; held while they are written, so two writes never overlap.
    written: Mutex<u64>,
}

impl Refresh {
    /// Counts a mark and returns its number.
    fn mark(&self) -> u64 {
        self.marks.fetch_add(1, Ordering::SeqCst) + 1
    }

    /// Runs `write` unless the files already follow the latest mark; says whether it ran.
    fn follow(&self, write: impl FnOnce()) -> bool {
        let mut written = lock(&self.written);
        let mark = self.marks.load(Ordering::SeqCst);
        if *written == mark {
            return false;
        }
        write();
        *written = mark;
        true
    }
}

/// A mark changed (moved, "fits anyway", read or unread): the files follow shortly.
pub(super) fn marked(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.dry_run {
        return;
    }
    let mark = state.refresh.mark();
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTLE).await;
        loop {
            let state = app.state::<AppState>();
            if state.refresh.marks.load(Ordering::SeqCst) != mark {
                return;
            }
            if !state.busy() {
                break;
            }
            tokio::time::sleep(IDLE_POLL).await;
        }
        let state = app.state::<AppState>();
        state.refresh.follow(|| refresh(&state));
    });
}

/// The app ends: files that still wait for a mark (closed within [`SETTLE`]) are written now,
/// which takes milliseconds, unless a run or a file command still holds the app.
pub fn flush_marks(state: &AppState) {
    if !state.dry_run && !state.busy() {
        state.refresh.follow(|| refresh(state));
    }
}

fn refresh(state: &AppState) {
    let Ok(settings) = state.settings() else {
        return;
    };
    let workspace = settings.workspace_or(&state.default_workspace);
    let language = settings.language_or(state.system_language);
    // Each overview is rewritten only when something changed.
    let _ = pipeline::refresh_overviews(&state.store, &workspace, Timestamp::now(), language);
}

/// An overview to open (`excel` or `csv`): not found while it is switched off - the app
/// writes none, an old file is no file of the app's now - and written fresh before it opens,
/// so the marks since the last write are in it.
fn overview(
    state: &AppState,
    path: std::path::PathBuf,
    switched_on: bool,
) -> CmdResult<std::ffi::OsString> {
    if !switched_on {
        return Err(ErrorInfo::new(ErrorKind::NotFound)
            .with("what", "file")
            .with("path", path.display().to_string()));
    }
    if !state.dry_run && !state.busy() {
        let settings = state.settings()?;
        let language = settings.language_or(state.system_language);
        let _ = pipeline::refresh_overviews(
            &state.store,
            &state.workspace()?,
            Timestamp::now(),
            language,
        );
    }
    existing(path, "file")
}

/// The work folder to open: a fresh install has none until the first export writes it, so it
/// is made now (like the export would) and then opened. The dry run writes nothing outside its
/// database: there a missing folder stays not found.
fn workspace_folder(state: &AppState) -> CmdResult<std::ffi::OsString> {
    let workspace = state.workspace()?;
    if !state.dry_run && !workspace.is_dir() {
        std::fs::create_dir_all(&workspace)
            .map_err(|e| ErrorInfo::from(jobalert_core::Error::io(&workspace, e)))?;
        log::info!("work folder made to open it");
    }
    existing(workspace, "folder")
}

/// Opens a checked target in the browser, the mail client or the file manager.
#[tauri::command]
pub async fn open_target(state: State<'_, AppState>, target: OpenTarget) -> CmdResult<()> {
    let job = |key| {
        state
            .store
            .job(key)
            .map(|job| job.ok_or_else(|| not_found("job")))
    };
    // A mail opens in the account of the mailbox the app reads (the address is cached after
    // the first read; the dry run never touches the vault).
    let mail = |id: Option<u64>| -> CmdResult<std::ffi::OsString> {
        let mailbox = if state.dry_run {
            None
        } else {
            state.gmail_user().0
        };
        Ok(id
            .and_then(|id| gmail_url_for(id, mailbox.as_deref()))
            .ok_or_else(|| not_found("mail"))?
            .to_string()
            .into())
    };
    let what: std::ffi::OsString = match target {
        OpenTarget::JobUrl { key } => job(&key)??.url.to_string().into(),
        OpenTarget::Gmail { key } => mail(job(&key)??.gmail_id)?,
        OpenTarget::ContactMail { key } => {
            let job = job(&key)??;
            let email = job.match_.and_then(|m| m.facts.contact_email);
            email
                .and_then(|to| mailto(&to, &job.title))
                .ok_or_else(|| not_found("mail"))?
                .into()
        }
        OpenTarget::AlertMail { gmail_id } => mail(u64::from_str_radix(&gmail_id, 16).ok())?,
        OpenTarget::PortalHome { portal } => portal.home_url().into(),
        OpenTarget::AppPasswordPage => APP_PASSWORD_URL.into(),
        OpenTarget::TwoStepPage => TWO_STEP_URL.into(),
        OpenTarget::Workspace => workspace_folder(&state)?,
        OpenTarget::ProfileDir => existing(
            state.workspace()?.join(jobalert_core::profile::PROFILE_DIR),
            "folder",
        )?,
        OpenTarget::Excel => overview(
            &state,
            export::overview_path(&state.workspace()?.join(RESULT_DIR)),
            state.settings()?.export_excel,
        )?,
        OpenTarget::Csv => overview(
            &state,
            export::csv_path(&state.workspace()?.join(RESULT_DIR)),
            state.settings()?.export_csv,
        )?,
        OpenTarget::ExcelInFolder => {
            let workspace = state.workspace()?;
            let excel = export::overview_path(&workspace.join(RESULT_DIR));
            if excel.is_file() {
                return show_in_folder(&excel);
            }
            // No file yet (before the first fetch): the work folder it will be in.
            workspace_folder(&state)?
        }
        OpenTarget::ExcelBackupInFolder { name } => {
            if !export::is_xlsx_backup(&name) {
                return Err(not_found("file"));
            }
            let path = state.workspace()?.join(RESULT_DIR).join(name);
            existing(path.clone(), "file")?;
            return show_in_folder(&path);
        }
        OpenTarget::LogDir => existing(state.data_dir.join(jobalert_core::LOG_DIR), "folder")?,
        OpenTarget::DataDir => existing(state.data_dir.clone(), "folder")?,
    };
    open::that_detached(&what).map_err(|e| {
        log::warn!("could not open a target: {e}");
        ErrorInfo::new(ErrorKind::Io)
    })
}

/// A new mail to an address the engine read from an ad, the job's title as its subject:
/// `None` for anything that is not a plain address (nothing of the ad reaches the link but
/// the address and the encoded subject).
fn mailto(to: &str, subject: &str) -> Option<String> {
    let (local, domain) = to.split_once('@')?;
    let plain = |part: &str, extra: &[char]| {
        !part.is_empty()
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || extra.contains(&c))
    };
    if !plain(local, &['.', '_', '%', '+', '-']) || !plain(domain, &['.', '-']) {
        return None;
    }
    let mut encoded = String::new();
    for byte in subject.trim().bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    Some(if encoded.is_empty() {
        format!("mailto:{to}")
    } else {
        format!("mailto:{to}?subject={encoded}")
    })
}

/// Shows a checked file selected in its folder (Explorer, Finder).
fn show_in_folder(path: &std::path::Path) -> CmdResult<()> {
    crate::platform::show_in_folder(path).map_err(|e| {
        log::warn!("could not show a file in its folder: {e}");
        ErrorInfo::new(ErrorKind::Io)
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A contact's mail: the address as it is, the subject encoded; nothing but a plain
    /// address makes a link.
    #[test]
    fn a_contact_mail_carries_the_title_as_its_subject() {
        assert_eq!(
            mailto("julia.brandt@hanseatic.example", "Interim CFO (m/w/d) & Co").as_deref(),
            Some(
                "mailto:julia.brandt@hanseatic.example?subject=Interim%20CFO%20%28m%2Fw%2Fd%29%20%26%20Co"
            )
        );
        assert_eq!(
            mailto("a@b.example", "Für Ü").as_deref(),
            Some("mailto:a@b.example?subject=F%C3%BCr%20%C3%9C")
        );
        assert_eq!(
            mailto("a@b.example", " ").as_deref(),
            Some("mailto:a@b.example")
        );
        for bad in [
            "a@b.example?bcc=c@d.example",
            "a b@c.example",
            "@c.example",
            "a@",
            "a",
        ] {
            assert_eq!(mailto(bad, "x"), None, "{bad}");
        }
    }

    /// The files follow the latest mark once: the wait of a mark and the flush when the app
    /// ends never write twice for the same mark, and a new mark writes again.
    #[test]
    fn the_files_follow_the_latest_mark_once() {
        let refresh = Refresh::default();
        let mut writes = 0;
        assert!(!refresh.follow(|| writes += 1), "no mark, nothing to write");
        refresh.mark();
        refresh.mark();
        assert!(refresh.follow(|| writes += 1));
        assert!(!refresh.follow(|| writes += 1), "written already");
        refresh.mark();
        assert!(refresh.follow(|| writes += 1));
        assert_eq!(writes, 2);
    }
}
