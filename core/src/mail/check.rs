//! "Verbinden": the mailbox the user typed in, checked and stored.
//!
//! 1. The shape of address and app password is checked without the network: an input that
//!    Gmail can never accept (an account password typed by mistake) is never sent anywhere.
//! 2. A real sign-in to Gmail (IMAP `LOGIN` and the `X-GM-EXT-1` check of
//!    [`Gmail::connect`]). Only this step decides: a wrong app password, no Gmail, no
//!    connection or no answer in time say so, and nothing is stored.
//! 3. Best effort, a count of the alert mails of the last 30 days per portal, with the scan's
//!    own rules (the head decides what is loaded, [`classify_mail`] what is an alert). A count
//!    that is slow or fails never throws the sign-in away: the check then says it did not
//!    count, and the next fetch reads the mails anyway.
//! 4. The account is stored ([`store_account`]); another account starts with its own scan
//!    state, cleared before the vault holds the new account.
//!
//! Read-only like the scan. An error is a code only and never carries the password.

use std::collections::BTreeMap;
use std::future::Future;
use std::time::Duration;

use jiff::{SignedDuration, Timestamp};
use tokio_util::sync::CancellationToken;

use super::imap::{BATCH, Credentials, Gmail, MailError, MailSource};
use super::{MailKind, classify_mail, is_candidate};
use crate::error::{ErrorInfo, ErrorKind, InvalidInput};
use crate::portal::Portal;
use crate::secrets::SecretError;
use crate::store::Store;
use crate::view::{MailboxCheck, PortalCount};

/// Days the check looks back (the first fetch reads as many).
pub const CHECK_DAYS: u32 = 30;
/// Longest the sign-in may take (connection, TLS, `LOGIN`, capabilities, mailbox).
const LOGIN_LIMIT: Duration = Duration::from_secs(30);
/// Longest the count may take after the sign-in; then the check stops counting.
const COUNT_LIMIT: Duration = Duration::from_secs(90);
/// Letters of a Google app password (Google shows them in groups of four).
const APP_PASSWORD_LETTERS: usize = 16;

/// Why "Verbinden" failed. Only the input's shape and the sign-in fail it, never the count.
#[derive(Debug, thiserror::Error)]
pub enum CheckError {
    /// Address or app password cannot be right: nothing was sent to Gmail.
    #[error("invalid credentials: {0}")]
    Invalid(InvalidInput),
    #[error(transparent)]
    Mail(#[from] MailError),
}

/// Handing the error to the interface: `{kind: invalid, reason}` or the mail error's code.
impl From<CheckError> for ErrorInfo {
    fn from(error: CheckError) -> ErrorInfo {
        match error {
            CheckError::Invalid(input) => ErrorInfo::from(&input),
            CheckError::Mail(mail) => ErrorInfo::from(mail),
        }
    }
}

impl Credentials {
    /// Address and app password in a shape Gmail can accept, decided without the network:
    /// an address with a name and a domain with a dot, an app password of exactly 16
    /// letters. An account password entered by mistake is caught here, before any sign-in
    /// (`save_mailbox`) and again before the vault stores it ([`crate::secrets::Vault`]).
    pub fn validate(&self) -> Result<(), InvalidInput> {
        let valid_user = self
            .user
            .split_once('@')
            .is_some_and(|(name, domain)| !name.is_empty() && domain.contains('.'));
        if !valid_user {
            return Err(InvalidInput::MailAddress);
        }
        let password = self.password();
        if password.chars().count() != APP_PASSWORD_LETTERS
            || !password.chars().all(|c| c.is_ascii_alphabetic())
        {
            return Err(InvalidInput::AppPassword);
        }
        Ok(())
    }
}

/// Checks `credentials` and signs in to Gmail with them, then counts the alert mails of
/// `portals` of the last [`CHECK_DAYS`] days. `Ok(None)`: the sign-in worked, the count did
/// not finish in time or failed (logged by its code). Errors: `Invalid` (the shape, nothing
/// sent), `MailAuth` (the app password was refused), `MailNotGmail`, `MailConnect` (offline,
/// no server), `MailTimeout` (no answer to the sign-in in time), `MailLost`, `MailServer`,
/// `MailCancelled` (also while counting: the user stopped "Verbinden").
pub async fn check_mailbox(
    credentials: &Credentials,
    portals: &[Portal],
    now: Timestamp,
    cancel: CancellationToken,
) -> Result<Option<MailboxCheck>, CheckError> {
    sign_in_and_count(
        credentials,
        |credentials| Gmail::connect(credentials, cancel),
        portals,
        now,
    )
    .await
}

/// [`check_mailbox`] with the sign-in handed in (`connect`, a fake in tests).
async fn sign_in_and_count<'a, S, F>(
    credentials: &'a Credentials,
    connect: impl FnOnce(&'a Credentials) -> F,
    portals: &[Portal],
    now: Timestamp,
) -> Result<Option<MailboxCheck>, CheckError>
where
    S: MailSource,
    F: Future<Output = Result<S, MailError>>,
{
    credentials.validate().map_err(CheckError::Invalid)?;
    let mut source = tokio::time::timeout(LOGIN_LIMIT, connect(credentials))
        .await
        .map_err(|_| MailError::Timeout)??;
    let counted = tokio::time::timeout(COUNT_LIMIT, count_alerts(&mut source, portals, now)).await;
    source.logout().await;
    match counted {
        Ok(Ok(check)) => Ok(Some(check)),
        Ok(Err(MailError::Cancelled)) => Err(MailError::Cancelled.into()),
        // The code only: a server's text can quote a mail.
        Ok(Err(error)) => {
            log::warn!(
                "mailbox signed in, alert mails not counted ({:?})",
                error.kind()
            );
            Ok(None)
        }
        Err(_) => {
            log::warn!(
                "mailbox signed in, alert mails not counted ({:?})",
                ErrorKind::MailTimeout
            );
            Ok(None)
        }
    }
}

/// The alert mails of `portals` in `source` of the last [`CHECK_DAYS`] days before `now`,
/// per portal (every portal asked for, in the order of `Portal::ALL`).
pub async fn count_alerts<S: MailSource>(
    source: &mut S,
    portals: &[Portal],
    now: Timestamp,
) -> Result<MailboxCheck, MailError> {
    let from = now
        .checked_sub(SignedDuration::from_hours(24 * i64::from(CHECK_DAYS)))
        .unwrap_or(now);
    let since = crate::time::local_date(from);
    let mut counts: BTreeMap<Portal, u32> = BTreeMap::new();
    let uids = source.search(Some(since), portals).await?;
    for chunk in uids.chunks(BATCH) {
        let candidates: Vec<u32> = source
            .heads(chunk)
            .await?
            .iter()
            .filter(|head| is_candidate(&head.bytes, portals))
            .map(|head| head.uid)
            .collect();
        for raw in source.fetch(&candidates).await? {
            if let MailKind::Alert(alert) = classify_mail(&raw, portals) {
                *counts.entry(alert.portal).or_default() += 1;
            }
        }
    }
    let per_portal: Vec<PortalCount> = Portal::ALL
        .into_iter()
        .filter(|p| portals.contains(p))
        .map(|portal| PortalCount {
            portal,
            count: counts.get(&portal).copied().unwrap_or(0),
        })
        .collect();
    Ok(MailboxCheck {
        days: CHECK_DAYS,
        total: per_portal.iter().map(|p| p.count).sum(),
        per_portal,
    })
}

/// Stores the account that just signed in (`save`: into the vault). Another account than
/// `previous` starts with its own scan state, and that state is cleared **before** the vault
/// holds the new account: a failed clear leaves the old account in the vault with the scan
/// state that belongs to it, and a failed vault write only makes the old account read its
/// days again (the mails it knows are recognised). The other order could leave the new
/// account with the old one's watermarks for good, and its older alert mails unread.
pub fn store_account(
    store: &Store,
    previous: Option<&str>,
    credentials: &Credentials,
    save: impl FnOnce(&Credentials) -> Result<(), SecretError>,
) -> Result<(), ErrorInfo> {
    if previous != Some(credentials.user.as_str()) {
        store.clear_scan_state().map_err(ErrorInfo::from)?;
    }
    save(credentials).map_err(ErrorInfo::from)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use super::*;
    use crate::mail::{RawHead, RawMail};
    use crate::pipeline::Backends;
    use crate::pipeline::demo::{DemoBackends, DemoMail};

    /// The sample mailbox of the dry run holds one alert mail per portal: each is counted
    /// for its portal, the total is their sum, and a portal not asked for is not in it.
    #[tokio::test(start_paused = true)]
    async fn the_alert_mails_are_counted_per_portal() {
        let cancel = CancellationToken::new();
        let mut mail = DemoBackends.connect_mail(&cancel).await.unwrap();
        let check = count_alerts(&mut mail, &Portal::ALL, Timestamp::now())
            .await
            .unwrap();
        assert_eq!(check.days, 30);
        assert_eq!(check.total, 3, "{check:?}");
        assert_eq!(
            check
                .per_portal
                .iter()
                .map(|p| (p.portal, p.count))
                .collect::<Vec<_>>(),
            Portal::ALL.map(|p| (p, 1))
        );
        let only = count_alerts(&mut mail, &[Portal::LinkedIn], Timestamp::now())
            .await
            .unwrap();
        assert_eq!(only.total, 1);
        assert_eq!(only.per_portal.len(), 1);
        let json = serde_json::to_value(&only).unwrap();
        assert_eq!(
            json,
            serde_json::json!({"days": 30, "total": 1,
                "perPortal": [{"portal": "linkedin", "count": 1}]})
        );
    }

    /// An error of the mailbox is a code only: the password never reaches it or the log line.
    #[test]
    fn an_error_carries_no_password() {
        let credentials = Credentials::new("erika@gmail.com", "abcd efgh ijkl mnop");
        let error = MailError::Auth("[AUTHENTICATIONFAILED] Invalid credentials".into());
        let info = crate::error::ErrorInfo::from(&error);
        assert_eq!(info.kind, crate::error::ErrorKind::MailAuth);
        assert!(info.params.is_empty());
        assert!(!error.to_string().contains(credentials.password()));
        assert!(!format!("{credentials:?}").contains(credentials.password()));
    }

    /// A signed-in mailbox whose count never ends well: slow, failing, or stopped.
    enum Count {
        /// Sends nothing for an hour (a huge mailbox on a slow line).
        Slow,
        /// Gmail answers `NO` (a mail deleted meanwhile).
        Fails,
        /// The user stopped "Verbinden".
        Cancelled,
    }

    struct Counting(Count);

    impl MailSource for Counting {
        async fn search(
            &mut self,
            _: Option<jiff::civil::Date>,
            _: &[Portal],
        ) -> Result<Vec<u32>, MailError> {
            match self.0 {
                Count::Slow => {
                    tokio::time::sleep(Duration::from_secs(3600)).await;
                    Ok(Vec::new())
                }
                Count::Fails => Err(MailError::Server(
                    "Some messages could not be FETCHed".into(),
                )),
                Count::Cancelled => Err(MailError::Cancelled),
            }
        }

        async fn heads(&mut self, _: &[u32]) -> Result<Vec<RawHead>, MailError> {
            Ok(Vec::new())
        }

        async fn fetch(&mut self, _: &[u32]) -> Result<Vec<RawMail>, MailError> {
            Ok(Vec::new())
        }
    }

    const GOOD_USER: &str = "erika@gmail.com";
    const GOOD_PASSWORD: &str = "abcd efgh ijkl mnop";

    /// CRED-2: an address or a password in a shape Gmail never accepts is refused before
    /// any sign-in, with the field it belongs to; the account password typed by mistake
    /// never leaves the app.
    #[tokio::test(start_paused = true)]
    async fn cred_2_a_wrong_shape_is_refused_before_any_sign_in() {
        for (user, password, reason) in [
            ("alerts.demo", GOOD_PASSWORD, InvalidInput::MailAddress),
            ("@gmail.com", GOOD_PASSWORD, InvalidInput::MailAddress),
            (GOOD_USER, "MyAccountPassword1!", InvalidInput::AppPassword),
            (GOOD_USER, "kurz", InvalidInput::AppPassword),
            (GOOD_USER, "abcd efgh ijkl", InvalidInput::AppPassword),
        ] {
            let credentials = Credentials::new(user, password);
            let signed_in = AtomicBool::new(false);
            let result = sign_in_and_count(
                &credentials,
                |_| {
                    signed_in.store(true, Ordering::SeqCst);
                    async { Ok::<_, MailError>(Counting(Count::Fails)) }
                },
                &Portal::ALL,
                Timestamp::now(),
            )
            .await;
            assert!(
                !signed_in.load(Ordering::SeqCst),
                "{user} / {password}: sent to Gmail"
            );
            match result {
                Err(CheckError::Invalid(found)) => assert_eq!(found, reason, "{user}"),
                other => panic!("{user} / {password}: {other:?}"),
            }
        }
        // The page gets the reason it marks the field with.
        let info = ErrorInfo::from(CheckError::Invalid(InvalidInput::AppPassword));
        assert_eq!(info.kind, ErrorKind::Invalid);
        assert_eq!(info.params.get("reason"), Some(&"appPassword".into()));
        // A good shape passes: blanks and case are normalised first.
        assert_eq!(
            Credentials::new(" Test@Example.org ", GOOD_PASSWORD).validate(),
            Ok(())
        );
    }

    /// CRED-3: a count slower than its limit keeps the sign-in: the check says it did not
    /// count instead of "Gmail antwortet nicht".
    #[tokio::test(start_paused = true)]
    async fn cred_3_a_slow_count_keeps_the_sign_in() {
        let credentials = Credentials::new(GOOD_USER, GOOD_PASSWORD);
        let started = tokio::time::Instant::now();
        let result = sign_in_and_count(
            &credentials,
            |_| async { Ok::<_, MailError>(Counting(Count::Slow)) },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(matches!(result, Ok(None)), "{result:?}");
        assert!(started.elapsed() <= COUNT_LIMIT + Duration::from_secs(1));
    }

    /// CRED-3: a count that fails keeps the sign-in too; only a stop by the user does not.
    #[tokio::test(start_paused = true)]
    async fn cred_3_a_failed_count_keeps_the_sign_in() {
        let credentials = Credentials::new(GOOD_USER, GOOD_PASSWORD);
        let failed = sign_in_and_count(
            &credentials,
            |_| async { Ok::<_, MailError>(Counting(Count::Fails)) },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(matches!(failed, Ok(None)), "{failed:?}");
        let stopped = sign_in_and_count(
            &credentials,
            |_| async { Ok::<_, MailError>(Counting(Count::Cancelled)) },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(
            matches!(stopped, Err(CheckError::Mail(MailError::Cancelled))),
            "{stopped:?}"
        );
    }

    /// The sign-in alone decides: a refused, a silent or a stopped sign-in is an error, and a
    /// mailbox that counts in time comes back with its count.
    #[tokio::test(start_paused = true)]
    async fn only_the_sign_in_fails_the_check() {
        let credentials = Credentials::new(GOOD_USER, GOOD_PASSWORD);
        let refused = sign_in_and_count(
            &credentials,
            |_| async { Err::<DemoMail, _>(MailError::Auth("[AUTHENTICATIONFAILED]".into())) },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(
            matches!(refused, Err(CheckError::Mail(MailError::Auth(_)))),
            "{refused:?}"
        );
        let silent = sign_in_and_count(
            &credentials,
            |_| async {
                tokio::time::sleep(Duration::from_secs(3600)).await;
                Ok::<_, MailError>(Counting(Count::Fails))
            },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(
            matches!(silent, Err(CheckError::Mail(MailError::Timeout))),
            "{silent:?}"
        );
        let cancel = CancellationToken::new();
        let counted = sign_in_and_count(
            &credentials,
            |_| async { DemoBackends.connect_mail(&cancel).await },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert_eq!(counted.unwrap().map(|c| c.total), Some(3));
        cancel.cancel();
        let stopped = sign_in_and_count(
            &credentials,
            |_| async { DemoBackends.connect_mail(&cancel).await },
            &Portal::ALL,
            Timestamp::now(),
        )
        .await;
        assert!(
            matches!(stopped, Err(CheckError::Mail(MailError::Cancelled))),
            "{stopped:?}"
        );
    }

    /// A store that holds account A's scan state (its watermark and the account the links
    /// point into).
    fn scanned_by_a() -> Store {
        let store = Store::in_memory().unwrap();
        store
            .set_last_scan(Portal::LinkedIn, Timestamp::now())
            .unwrap();
        store
            .kv_set(crate::store::GMAIL_ACCOUNT, "a@example.org")
            .unwrap();
        store
    }

    fn scan_state(store: &Store) -> (bool, Option<String>) {
        (
            store.last_scan(Portal::LinkedIn).unwrap().is_some(),
            store.kv_get(crate::store::GMAIL_ACCOUNT).unwrap(),
        )
    }

    /// CRED-4: switching the account clears the old scan state before the vault holds the
    /// new account, so no failure in between leaves the new account with the old state; a
    /// failed vault write is said, and the old account merely reads its days again.
    #[test]
    fn cred_4_the_old_scan_state_goes_before_the_new_account_is_stored() {
        let store = scanned_by_a();
        let b = Credentials::new("b@example.org", GOOD_PASSWORD);
        let mut seen = None;
        let result = store_account(&store, Some("a@example.org"), &b, |stored| {
            assert_eq!(stored.user, "b@example.org");
            seen = Some(scan_state(&store));
            Err(SecretError::Store("the keychain is locked".into()))
        });
        assert_eq!(
            seen,
            Some((false, None)),
            "the vault got the new account while the old scan state was still there"
        );
        assert_eq!(result.unwrap_err().kind, ErrorKind::SecretStore);
        assert_eq!(scan_state(&store), (false, None));

        // The same account again keeps its scan state; so does the first save after a start
        // whose vault held it.
        let store = scanned_by_a();
        let a = Credentials::new("a@example.org", GOOD_PASSWORD);
        store_account(&store, Some("a@example.org"), &a, |_| Ok(())).unwrap();
        assert_eq!(scan_state(&store), (true, Some("a@example.org".to_owned())));
        // No account before: nothing of another account may stay.
        let store = scanned_by_a();
        store_account(&store, None, &a, |_| Ok(())).unwrap();
        assert_eq!(scan_state(&store), (false, None));
    }
}
