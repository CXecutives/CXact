//! The mailbox: its provider in the settings, address and password in the system vault.

use jiff::Timestamp;
use jobalert_core::error::ErrorInfo;
use jobalert_core::mail::MailProvider;
use jobalert_core::mail::check::{check_mailbox, store_account};
use jobalert_core::mail::imap::Credentials;
use jobalert_core::secrets::Vault;
use jobalert_core::view::Mailbox;
use tauri::{AppHandle, State};

use super::app::mailbox;
use super::{AppState, CmdResult, GmailUser, lock};

/// Key of the time the server last accepted the mailbox (`Mailbox.checked_at`; empty: none).
pub(super) const CHECKED_AT: &str = "mailbox_checked_at";

/// Saves the mailbox at `provider` after a real sign-in (`mail::check`): an address or
/// password the provider can never accept is refused first, before the app is held or
/// anything is sent (the stub answers the same way); a wrong password (`mailAuth`, with
/// `allowImap` at GMX and WEB.DE), a Gmail mailbox that is no Gmail or no connection say so
/// and nothing is saved. The sign-in also
/// counts the alert mails of the last 30 days per enabled portal (`Mailbox.check`, `null`
/// when the count did not finish; the sign-in still counts). The app is held meanwhile, so
/// no run reads the vault half way, and `cancel_run` stops the check. Another account
/// starts with its own scan state.
#[tauri::command]
pub async fn save_mailbox(
    app: AppHandle,
    state: State<'_, AppState>,
    provider: MailProvider,
    user: String,
    password: String,
) -> CmdResult<Mailbox> {
    state.ensure_real()?;
    let credentials = Credentials::new(provider, &user, &password);
    // The shape first: a typo is named at once, also while a fetch holds the app.
    credentials.validate().map_err(|e| ErrorInfo::from(&e))?;
    let portals = state.settings()?.enabled_portals();
    // Held until the account is stored: a run cannot start with the account this replaces.
    let guard = state.claim_mailbox(&app)?;
    let check = check_mailbox(
        &credentials,
        &portals,
        Timestamp::now(),
        guard.cancel.clone(),
    )
    .await
    .map_err(ErrorInfo::from)?;
    let vault = Vault::app();
    let cached = match &*lock(&state.gmail_user) {
        GmailUser::Known(user) => Some(user.clone()),
        GmailUser::Unread => None,
    };
    let previous = cached.unwrap_or_else(|| {
        let provider = state
            .settings()
            .map(|s| s.mail_provider)
            .unwrap_or_default();
        vault.load(provider).ok().flatten().map(|c| c.user)
    });
    // The old account's scan state goes first, then the vault takes the new account, then
    // the settings its provider.
    store_account(&state.store, previous.as_deref(), &credentials, |c| {
        vault.save(c)
    })?;
    *lock(&state.gmail_user) = GmailUser::Known(Some(credentials.user.clone()));
    *lock(&state.mailbox_check) = check;
    state
        .store
        .kv_set(CHECKED_AT, &Timestamp::now().to_string())?;
    drop(guard);
    log::info!("mailbox saved");
    Ok(mailbox(&state))
}

#[tauri::command]
pub async fn remove_mailbox(app: AppHandle, state: State<'_, AppState>) -> CmdResult<bool> {
    state.ensure_real()?;
    // Held like saving: a run that read the vault before this reads it again.
    let guard = state.claim_mailbox(&app)?;
    let removed = Vault::app().delete()?;
    *lock(&state.gmail_user) = GmailUser::Known(None);
    *lock(&state.mailbox_check) = None;
    state.store.kv_set(CHECKED_AT, "")?;
    state.store.clear_scan_state()?;
    drop(guard);
    log::info!("mailbox removed");
    Ok(removed)
}
