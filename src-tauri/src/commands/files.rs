//! Open checked targets: a job's ad and mails, the Google pages, the app's folders.

use std::fmt::Write as _;

use jobalert_core::error::{ErrorInfo, ErrorKind};
use jobalert_core::model::gmail_url_for;
use jobalert_core::view::OpenTarget;
use tauri::State;

use super::app::existing;
use super::{AppState, CmdResult, not_found};

/// Google page to create an app password.
const APP_PASSWORD_URL: &str = "https://myaccount.google.com/apppasswords";
/// Google page to turn on 2-step verification, which an app password requires.
const TWO_STEP_URL: &str = "https://myaccount.google.com/signinoptions/twosv";

/// The work folder to open: a fresh install may have none yet, so it is made now and then
/// opened. The dry run writes nothing outside its
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
    // the first read; the dry run and the demo never touch the vault).
    let mail = |id: Option<u64>| -> CmdResult<std::ffi::OsString> {
        let mailbox = if state.dry_run || state.demo {
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
        OpenTarget::PortalSetup { portal } => portal.setup_url().into(),
        OpenTarget::AppPasswordPage => APP_PASSWORD_URL.into(),
        OpenTarget::TwoStepPage => TWO_STEP_URL.into(),
        OpenTarget::Workspace => workspace_folder(&state)?,
        OpenTarget::ProfileDir => existing(
            state.workspace()?.join(jobalert_core::profile::PROFILE_DIR),
            "folder",
        )?,
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
}
