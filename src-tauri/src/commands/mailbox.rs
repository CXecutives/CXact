//! The Gmail mailbox: address and app password in the system vault.

use jiff::Timestamp;
use jobalert_core::error::ErrorInfo;
use jobalert_core::mail::check::check_mailbox;
use jobalert_core::mail::imap::Credentials;
use jobalert_core::secrets::Vault;
use jobalert_core::view::Mailbox;
use tauri::State;
use tokio_util::sync::CancellationToken;

use super::app::mailbox;
use super::{AppState, CmdResult, GmailUser, lock};

/// Saves the Gmail access after a real sign-in: a wrong app password, a mailbox that is no
/// Gmail or no connection say so and nothing is saved; the sign-in also counts the alert
/// mails of the last 30 days per enabled portal (`Mailbox.check`). Another account starts
/// with its own scan state.
#[tauri::command]
pub async fn save_mailbox(
    state: State<'_, AppState>,
    user: String,
    password: String,
) -> CmdResult<Mailbox> {
    state.ensure_idle()?;
    state.ensure_real()?;
    let credentials = Credentials::new(&user, &password);
    let portals = state.settings()?.enabled_portals();
    let check = check_mailbox(
        &credentials,
        &portals,
        Timestamp::now(),
        CancellationToken::new(),
    )
    .await
    .map_err(ErrorInfo::from)?;
    let vault = Vault::app();
    let cached = match &*lock(&state.gmail_user) {
        GmailUser::Known(user) => Some(user.clone()),
        GmailUser::Unread => None,
    };
    let previous = cached.unwrap_or_else(|| vault.load_gmail().ok().flatten().map(|c| c.user));
    vault.save_gmail(&credentials)?;
    *lock(&state.gmail_user) = GmailUser::Known(Some(credentials.user.clone()));
    *lock(&state.mailbox_check) = Some(check);
    if previous.as_deref() != Some(credentials.user.as_str()) {
        state.store.clear_scan_state()?;
    }
    log::info!("mailbox saved");
    Ok(mailbox(&state))
}

#[tauri::command]
pub async fn remove_mailbox(state: State<'_, AppState>) -> CmdResult<bool> {
    state.ensure_idle()?;
    state.ensure_real()?;
    let removed = Vault::app().delete_gmail()?;
    *lock(&state.gmail_user) = GmailUser::Known(None);
    *lock(&state.mailbox_check) = None;
    state.store.clear_scan_state()?;
    log::info!("mailbox removed");
    Ok(removed)
}
