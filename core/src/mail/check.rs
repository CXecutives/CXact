//! "Postfach prüfen": a real sign-in to Gmail (IMAP `LOGIN` and the `X-GM-EXT-1` check of
//! [`Gmail::connect`]) and a count of the alert mails of the last 30 days per portal, with
//! the scan's own rules (the head decides what is loaded, [`classify_mail`] what is an
//! alert). Read-only like the scan; nothing is stored. The result says what the mailbox
//! holds before the first fetch; an error is a code only (wrong app password, no Gmail, no
//! connection, no answer in time) and never carries the password.

use std::collections::BTreeMap;
use std::time::Duration;

use jiff::{SignedDuration, Timestamp};
use tokio_util::sync::CancellationToken;

use super::imap::{BATCH, Credentials, Gmail, MailError, MailSource};
use super::{MailKind, classify_mail, is_candidate};
use crate::portal::Portal;
use crate::view::{MailboxCheck, PortalCount};

/// Days the check looks back (the first fetch reads as many).
pub const CHECK_DAYS: u32 = 30;
/// Longest the sign-in may take (connection, TLS, `LOGIN`, capabilities, mailbox).
const LOGIN_LIMIT: Duration = Duration::from_secs(30);
/// Longest the count may take after the sign-in.
const COUNT_LIMIT: Duration = Duration::from_secs(90);

/// Signs in to Gmail with `credentials` and counts the alert mails of `portals` of the last
/// [`CHECK_DAYS`] days. Errors: `MailAuth` (the app password was refused), `MailNotGmail`,
/// `MailConnect` (offline, no server), `MailTimeout` (no answer in time), `MailLost`,
/// `MailServer`, `MailCancelled`.
pub async fn check_mailbox(
    credentials: &Credentials,
    portals: &[Portal],
    now: Timestamp,
    cancel: CancellationToken,
) -> Result<MailboxCheck, MailError> {
    let connect = Gmail::connect(credentials, cancel.clone());
    let mut gmail = tokio::time::timeout(LOGIN_LIMIT, connect)
        .await
        .map_err(|_| MailError::Timeout)??;
    let counted = tokio::time::timeout(COUNT_LIMIT, count_alerts(&mut gmail, portals, now)).await;
    gmail.close().await;
    counted.map_err(|_| MailError::Timeout)?
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pipeline::Backends;
    use crate::pipeline::demo::DemoBackends;

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
}
