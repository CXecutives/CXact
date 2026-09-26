//! Search the mailbox and take alert mails into the store.
//!
//! Every mail is stored immediately - a cancel or network error loses nothing that was
//! already processed. Ingestion is idempotent: overlapping periods do no harm, so there
//! are no UID pointers (and no UIDVALIDITY traps), only one timestamp per portal.

use std::collections::BTreeMap;

use jiff::civil::Date;
use jiff::{Timestamp, ToSpan as _};
use tokio_util::sync::CancellationToken;

use super::imap::{BATCH, MailError, MailSource};
use super::{MAIL_PARSER_VERSION, MailKind, classify_mail, is_candidate};
use crate::model::AlertMail;
use crate::portal::Portal;
use crate::settings::FetchRange;
use crate::store::{Seen, Store};
use crate::time::local_date;

/// Which mails a scan looks at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Scope {
    /// Since the last successful scan (one day of overlap); 30 days the first time.
    New,
    /// The last so many days (from the day that many days before today).
    Days(u16),
    /// The whole mailbox (All Mail: archived and filtered alerts too), without a date limit.
    All,
}

impl From<FetchRange> for Scope {
    /// The scan of "Postfach abrufen" for the range the settings choose.
    fn from(range: FetchRange) -> Scope {
        match range {
            FetchRange::SinceLast => Scope::New,
            FetchRange::Days7 => Scope::Days(7),
            FetchRange::Days30 => Scope::Days(30),
            FetchRange::All => Scope::All,
        }
    }
}

/// Without a previous scan: this far back (a month of alerts: freelance projects are often
/// taken within a few weeks, older ones are still worth a look on the first day).
const FIRST_SCAN_DAYS: i32 = 30;

/// Counters of a scan. Invariant: `postings_total = new + known_before + dup_in_run`.
#[derive(Debug, Clone, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanSummary {
    /// Search matches.
    pub mails_found: usize,
    /// Of those, checked (by their head; only possible alerts are loaded whole).
    pub mails_checked: usize,
    /// Unreadable (counted instead of silently dropped).
    pub mails_defective: usize,
    pub alert_mails: usize,
    /// Alert mails without a single recognised entry (layout changed?).
    pub zero_posting_mails: usize,
    pub postings_total: usize,
    pub new: usize,
    pub known_before: usize,
    pub dup_in_run: usize,
    /// Per portal: its alert mails and the jobs they carried - a portal whose mails carry
    /// no job at all probably changed its mail layout.
    #[serde(skip)]
    pub per_portal: BTreeMap<Portal, PortalScan>,
}

/// Alert mails of one portal in a scan.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PortalScan {
    pub alert_mails: usize,
    pub postings: usize,
}

impl ScanSummary {
    /// Portals whose alert mails all came without a single job, with their mail count.
    pub fn empty_portals(&self) -> impl Iterator<Item = (Portal, usize)> + '_ {
        self.per_portal
            .iter()
            .filter(|(_, s)| s.alert_mails > 0 && s.postings == 0)
            .map(|(&portal, s)| (portal, s.alert_mails))
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ScanError {
    #[error(transparent)]
    Mail(#[from] MailError),
    #[error(transparent)]
    Store(#[from] crate::Error),
}

/// What the scan reports along the way.
#[derive(Debug)]
pub enum ScanEvent<'a> {
    Found { total: usize },
    Alert(&'a AlertMail),
    Progress { done: usize, total: usize },
}

/// Per portal (`mail_healed:<portal>`): the mail parser version the mailbox was last read
/// back with for the portal's jobs an older one had read (see
/// [`crate::mail::MAIL_PARSER_VERSION`]). Per portal, because a scan searches only the
/// portals switched on: a portal switched off during the read-back keeps its old readings
/// until a scan that includes it reads back.
fn heal_key(portal: Portal) -> String {
    format!("mail_healed:{}", portal.key())
}

/// Jobs of `portal` an older mail parser read, when they were not read back yet: the
/// oldest mail date.
fn heal_from(store: &Store, portal: Portal) -> crate::Result<Option<Timestamp>> {
    let healed = store
        .kv_get(&heal_key(portal))?
        .and_then(|v| v.parse::<i64>().ok())
        .unwrap_or(0);
    if healed >= MAIL_PARSER_VERSION {
        return Ok(None);
    }
    store.stale_mail_since(portal)
}

/// The day the search starts from (`None` = everything): since the last scan, or the last
/// so many days. After an update of the mail parser the first scan reaches back once to the
/// oldest job the older one read, so the current one reads it again (read-only, alert mails
/// only) - also a scan of the last days, which marks the read-back as done.
fn scan_since(
    store: &Store,
    scope: Scope,
    portals: &[Portal],
    now: Timestamp,
) -> crate::Result<Option<Date>> {
    let today = local_date(now);
    let first = today.saturating_sub(FIRST_SCAN_DAYS.days());
    let mut since = match scope {
        Scope::All => return Ok(None),
        Scope::Days(days) => today.saturating_sub(i32::from(days).days()),
        Scope::New => today,
    };
    for &portal in portals {
        if scope == Scope::New {
            let from = match store.last_scan(portal)? {
                // One day of overlap: IMAP searches by day, in the server's time zone.
                Some(at) if at <= now => local_date(at).saturating_sub(1.day()),
                // State in the future (the clock was set wrong): treated as unknown.
                _ => first,
            };
            since = since.min(from);
        }
        if let Some(stale) = heal_from(store, portal)?.filter(|at| *at <= now) {
            since = since.min(local_date(stale).saturating_sub(1.day()));
        }
    }
    Ok(Some(since))
}

/// Searches the mailbox and takes in all alert mails of the selected portals.
///
/// `summary` belongs to the caller: even after an error or cancel it holds what was
/// processed (and already stored) up to then. The per-portal scan state advances only
/// after a complete pass - and only for portals whose gap since their last state the
/// searched period fully covered (without a state: the first scan's 30 days).
#[expect(
    clippy::too_many_arguments,
    reason = "mailbox, store, scope, clock and events are passed separately (swappable in tests)"
)]
pub async fn scan<S: MailSource>(
    source: &mut S,
    store: &Store,
    run: i64,
    scope: Scope,
    portals: &[Portal],
    started: Timestamp,
    cancel: &CancellationToken,
    summary: &mut ScanSummary,
    mut on_event: impl FnMut(ScanEvent<'_>),
) -> Result<(), ScanError> {
    let since = scan_since(store, scope, portals, started)?;
    let uids = source.search(since, portals).await?;
    summary.mails_found = uids.len();
    on_event(ScanEvent::Found { total: uids.len() });

    let mut done = 0;
    for chunk in uids.chunks(BATCH) {
        if cancel.is_cancelled() {
            return Err(MailError::Cancelled.into());
        }
        // Heads first: only a mail that may be an alert is loaded whole (up to 4 MB each).
        let heads = source.heads(chunk).await?;
        summary.mails_checked += heads.len();
        let candidates: Vec<u32> = heads
            .iter()
            .filter(|head| is_candidate(&head.bytes, portals))
            .map(|head| head.uid)
            .collect();
        for raw in source.fetch(&candidates).await? {
            match classify_mail(&raw, portals) {
                MailKind::Defective => summary.mails_defective += 1,
                MailKind::Other => {}
                MailKind::Alert(alert) => {
                    take_alert(store, run, &alert, started, summary)?;
                    on_event(ScanEvent::Alert(&alert));
                }
            }
        }
        // Progress per processed UID: mails deleted in the meantime are missing from the
        // reply, yet the bar still reaches 100 %.
        done += chunk.len();
        on_event(ScanEvent::Progress {
            done,
            total: uids.len(),
        });
    }
    if cancel.is_cancelled() {
        return Err(MailError::Cancelled.into());
    }

    let first = local_date(started).saturating_sub(FIRST_SCAN_DAYS.days());
    for &portal in portals {
        // The gap is covered only with one day of overlap (as in `scan_since`). A state
        // in the future counts as "unknown" and is replaced; without one the gap is the
        // first scan's days.
        let covered = match (since, store.last_scan(portal)?) {
            (None, _) => true,
            (Some(since), None) => since <= first,
            (Some(since), Some(last)) => last > started || since < local_date(last),
        };
        if covered {
            store.set_last_scan(portal, started)?;
        }
        // A complete pass read back what an older mail parser had read of this portal:
        // once is enough. Only for the portals searched - the others still read back.
        store.kv_set(&heal_key(portal), &MAIL_PARSER_VERSION.to_string())?;
    }
    Ok(())
}

fn take_alert(
    store: &Store,
    run: i64,
    alert: &AlertMail,
    now: Timestamp,
    summary: &mut ScanSummary,
) -> crate::Result<()> {
    // One mail is one change; it is counted only once it is stored - so the invariant
    // holds even after an error.
    let seen = store.record_alert(run, alert, now)?;
    summary.alert_mails += 1;
    let portal = summary.per_portal.entry(alert.portal).or_default();
    portal.alert_mails += 1;
    portal.postings += alert.postings.len();
    if alert.postings.is_empty() {
        summary.zero_posting_mails += 1;
    }
    for seen in seen {
        match seen {
            Seen::New => summary.new += 1,
            Seen::KnownBefore => summary.known_before += 1,
            Seen::DupInRun => summary.dup_in_run += 1,
        }
        summary.postings_total += 1;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::mail::{RawHead, RawMail, head_part};

    /// Mailbox fake: every mail has a UID; optionally, fetching fails at a given UID. It
    /// remembers which mails were loaded whole.
    struct Fake {
        mails: Vec<(u32, RawMail)>,
        fail_at: Option<u32>,
        searched: Vec<Option<Date>>,
        loaded: Vec<u32>,
    }

    impl MailSource for Fake {
        async fn search(
            &mut self,
            since: Option<Date>,
            _: &[Portal],
        ) -> Result<Vec<u32>, MailError> {
            self.searched.push(since);
            Ok(self.mails.iter().map(|(uid, _)| *uid).collect())
        }

        async fn heads(&mut self, uids: &[u32]) -> Result<Vec<RawHead>, MailError> {
            if let Some(fail) = self.fail_at.filter(|f| uids.contains(f)) {
                return Err(MailError::Lost(format!("at {fail}")));
            }
            Ok(self
                .mails
                .iter()
                .filter(|(uid, _)| uids.contains(uid))
                .map(|(uid, m)| RawHead {
                    uid: *uid,
                    bytes: head_part(&m.bytes).to_vec(),
                })
                .collect())
        }

        async fn fetch(&mut self, uids: &[u32]) -> Result<Vec<RawMail>, MailError> {
            if let Some(fail) = self.fail_at.filter(|f| uids.contains(f)) {
                return Err(MailError::Lost(format!("at {fail}")));
            }
            self.loaded.extend_from_slice(uids);
            Ok(self
                .mails
                .iter()
                .filter(|(uid, _)| uids.contains(uid))
                .map(|(_, m)| m.clone())
                .collect())
        }
    }

    fn alert_mail(id: u64, job_ids: &[u64]) -> RawMail {
        let links = job_ids
            .iter()
            .map(|j| {
                format!(r#"<p><a href="https://www.linkedin.com/jobs/view/{j}/">Rolle {j}</a></p>"#)
            })
            .collect::<Vec<_>>()
            .concat();
        let bytes = format!(
            "From: jobalerts-noreply@linkedin.com\r\nSubject: Neue Jobs\r\n\
             Date: Thu, 03 Sep 2026 08:15:00 +0200\r\nContent-Type: text/html\r\n\r\n{links}"
        );
        RawMail {
            gmail_id: Some(id),
            bytes: bytes.into_bytes(),
        }
    }

    fn fake(fail_at: Option<u32>) -> Fake {
        let mut mails = vec![
            (1, alert_mail(1, &[4_000_000_001, 4_000_000_002])),
            (
                2,
                alert_mail(2, &[4_000_000_002, 4_000_000_003, 4_000_000_003]),
            ),
            (3, RawMail::default()),
            (
                4,
                RawMail {
                    gmail_id: Some(4),
                    bytes: b"From: a@b.de\r\nSubject: Hallo\r\n\r\nText".to_vec(),
                },
            ),
        ];
        // Enough mails for several fetch batches.
        for uid in 5..=60 {
            mails.push((uid, alert_mail(u64::from(uid), &[])));
        }
        Fake {
            mails,
            fail_at,
            searched: Vec::new(),
            loaded: Vec::new(),
        }
    }

    fn now() -> Timestamp {
        "2026-09-19T08:00:00Z".parse().unwrap()
    }

    async fn run_scan(
        store: &Store,
        source: &mut Fake,
        scope: Scope,
        at: Timestamp,
    ) -> (ScanSummary, Result<(), ScanError>) {
        run_scan_in(store, source, scope, at).await.1
    }

    async fn run_scan_in(
        store: &Store,
        source: &mut Fake,
        scope: Scope,
        at: Timestamp,
    ) -> (i64, (ScanSummary, Result<(), ScanError>)) {
        let run = store.begin_run().unwrap();
        let mut summary = ScanSummary::default();
        let cancel = CancellationToken::new();
        let result = scan(
            source,
            store,
            run,
            scope,
            &[Portal::LinkedIn],
            at,
            &cancel,
            &mut summary,
            |_| {},
        )
        .await;
        (run, (summary, result))
    }

    #[tokio::test]
    async fn counts_and_invariant() {
        let store = Store::in_memory().unwrap();
        let (run, (s, result)) = run_scan_in(&store, &mut fake(None), Scope::New, now()).await;
        result.unwrap();
        assert_eq!(s.mails_found, 60);
        assert_eq!(s.mails_checked, 60);
        assert_eq!(s.mails_defective, 1);
        assert_eq!(s.alert_mails, 58, "2 with entries + 56 without");
        assert_eq!(s.zero_posting_mails, 56);
        // Layout guard: the grey rows come from the database (even after a restart).
        assert_eq!(store.zero_posting_mails(run).unwrap().len(), 56);
        // Mail 2 contains 4000000003 twice - merged within one mail.
        assert_eq!(
            (s.postings_total, s.new, s.known_before, s.dup_in_run),
            (4, 3, 0, 1)
        );
        assert_eq!(s.postings_total, s.new + s.known_before + s.dup_in_run);
        // Second run: nothing new.
        let (s, _) = run_scan(&store, &mut fake(None), Scope::New, now()).await;
        assert_eq!((s.new, s.known_before, s.dup_in_run), (0, 3, 1));
    }

    /// Two phases: only a mail whose head may be an alert is loaded whole - a mail from
    /// anyone else about anything else never leaves the server.
    #[tokio::test]
    async fn only_candidates_are_loaded_whole() {
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        let (s, result) = run_scan(&store, &mut source, Scope::New, now()).await;
        result.unwrap();
        assert_eq!(s.mails_checked, 60, "every head is checked");
        assert!(
            !source.loaded.contains(&4),
            "the private mail stays on the server"
        );
        assert!(
            source.loaded.contains(&3),
            "an unreadable head is loaded (defective)"
        );
        assert_eq!(source.loaded.len(), 59);
    }

    /// A portal whose alert mails all came without a job is named - others with jobs not.
    #[tokio::test]
    async fn a_portal_with_only_empty_alerts_is_named() {
        let store = Store::in_memory().unwrap();
        let (s, result) = run_scan(&store, &mut fake(None), Scope::New, now()).await;
        result.unwrap();
        assert_eq!(s.empty_portals().count(), 0, "LinkedIn mails carried jobs");
        let mut empty = fake(None);
        empty.mails.retain(|(uid, _)| *uid >= 5);
        let (s, _) = run_scan(&Store::in_memory().unwrap(), &mut empty, Scope::New, now()).await;
        assert_eq!(
            s.empty_portals().collect::<Vec<_>>(),
            [(Portal::LinkedIn, 56)]
        );
    }

    #[tokio::test]
    async fn since_follows_the_scan_state() {
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        run_scan(&store, &mut source, Scope::New, now())
            .await
            .1
            .unwrap();
        let later: Timestamp = "2026-09-25T08:00:00Z".parse().unwrap();
        run_scan(&store, &mut source, Scope::New, later)
            .await
            .1
            .unwrap();
        run_scan(&store, &mut source, Scope::All, later)
            .await
            .1
            .unwrap();
        let day = |s: &str| Some(s.parse::<Date>().unwrap());
        assert_eq!(
            source.searched,
            [day("2026-08-20"), day("2026-09-18"), None],
            "first run 30 days; then last state minus 1 day; \"All\" without a limit"
        );
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), Some(later));
    }

    /// "Letzte 7 Tage" and "Letzte 30 Tage" search from that day whatever the state; the
    /// state advances only when the days reach back over the gap since it (one day of
    /// overlap), and without a state only when they reach the first scan's 30 days.
    #[tokio::test]
    async fn the_last_days_search_their_days_and_advance_only_over_the_gap() {
        let day = |s: &str| Some(s.parse::<Date>().unwrap());
        // No state yet: seven days do not cover the first scan's thirty.
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        run_scan(&store, &mut source, Scope::Days(7), now())
            .await
            .1
            .unwrap();
        assert_eq!(source.searched, [day("2026-09-12")]);
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), None);
        run_scan(&store, &mut source, Scope::Days(30), now())
            .await
            .1
            .unwrap();
        assert_eq!(source.searched.last(), Some(&day("2026-08-20")));
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), Some(now()));
        // Three days later seven days cover the gap, three weeks later they do not.
        let soon: Timestamp = "2026-09-22T08:00:00Z".parse().unwrap();
        run_scan(&store, &mut source, Scope::Days(7), soon)
            .await
            .1
            .unwrap();
        assert_eq!(source.searched.last(), Some(&day("2026-09-15")));
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), Some(soon));
        let late: Timestamp = "2026-10-13T08:00:00Z".parse().unwrap();
        run_scan(&store, &mut source, Scope::Days(7), late)
            .await
            .1
            .unwrap();
        assert_eq!(source.searched.last(), Some(&day("2026-10-06")));
        assert_eq!(
            store.last_scan(Portal::LinkedIn).unwrap(),
            Some(soon),
            "the gap stays open"
        );
        // "Seit dem letzten Abruf" then closes it from the last state.
        run_scan(&store, &mut source, Scope::New, late)
            .await
            .1
            .unwrap();
        assert_eq!(source.searched.last(), Some(&day("2026-09-21")));
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), Some(late));
    }

    /// Each range of the settings is the scan it names.
    #[test]
    fn every_fetch_range_is_its_scan() {
        let store = Store::in_memory().unwrap();
        let since = |range: FetchRange| {
            scan_since(&store, Scope::from(range), &[Portal::LinkedIn], now()).unwrap()
        };
        let day = |s: &str| Some(s.parse::<Date>().unwrap());
        assert_eq!(
            since(FetchRange::SinceLast),
            day("2026-08-20"),
            "first scan"
        );
        assert_eq!(since(FetchRange::Days7), day("2026-09-12"));
        assert_eq!(since(FetchRange::Days30), day("2026-08-20"));
        assert_eq!(since(FetchRange::All), None);
        store.set_last_scan(Portal::LinkedIn, now()).unwrap();
        assert_eq!(since(FetchRange::SinceLast), day("2026-09-18"));
        assert_eq!(
            since(FetchRange::Days7),
            day("2026-09-12"),
            "whatever the state"
        );
    }

    /// After an update of the mail parser the first scan reads back once to the oldest job
    /// the older parser read; the job takes the current reading, the next scan is normal.
    #[tokio::test]
    async fn an_updated_mail_parser_reads_back_once() {
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        run_scan(&store, &mut source, Scope::New, now())
            .await
            .1
            .unwrap();
        let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4000000001/")
            .unwrap()
            .key;
        store.make_mail_stale(&key);
        store.kv_set(&heal_key(Portal::LinkedIn), "1").unwrap();
        assert!(store.stale_mail_since(Portal::LinkedIn).unwrap().is_some());
        let later: Timestamp = "2026-09-25T08:00:00Z".parse().unwrap();
        for _ in 0..2 {
            run_scan(&store, &mut source, Scope::New, later)
                .await
                .1
                .unwrap();
        }
        let day = |s: &str| Some(s.parse::<Date>().unwrap());
        assert_eq!(
            source.searched[1..],
            [day("2026-09-02"), day("2026-09-24")],
            "back to the old job's mail once, then from the last scan"
        );
        assert_eq!(
            store.stale_mail_since(Portal::LinkedIn).unwrap(),
            None,
            "read again"
        );
    }

    /// A portal switched off while the mailbox is read back keeps its older readings only
    /// until a scan includes it again: the read-back is tracked per portal.
    #[tokio::test]
    async fn a_portal_switched_off_during_the_read_back_reads_back_later() {
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        let bytes = "From: projekte@freelancermap.de\r\nSubject: Neue Projektanfragen\r\n\
             Date: Tue, 25 Aug 2026 08:15:00 +0200\r\nContent-Type: text/html\r\n\r\n\
             <p><a href=\"https://www.freelancermap.de/nproj/2971857.html\">SAP FI/CO Berater (m/w/d)</a></p>";
        source.mails.push((
            61,
            RawMail {
                gmail_id: Some(61),
                bytes: bytes.as_bytes().to_vec(),
            },
        ));
        let both = [Portal::LinkedIn, Portal::Freelancermap];
        let scan_with = async |store: &Store, source: &mut Fake, portals: &[Portal], at| {
            let run = store.begin_run().unwrap();
            let mut summary = ScanSummary::default();
            scan(
                source,
                store,
                run,
                Scope::New,
                portals,
                at,
                &CancellationToken::new(),
                &mut summary,
                |_| {},
            )
            .await
            .unwrap();
        };
        scan_with(&store, &mut source, &both, now()).await;
        let key = crate::portal::job_link("https://www.freelancermap.de/nproj/2971857.html")
            .unwrap()
            .key;
        store.make_mail_stale(&key);
        store.kv_set(&heal_key(Portal::Freelancermap), "1").unwrap();
        let later: Timestamp = "2026-09-25T08:00:00Z".parse().unwrap();
        let day = |s: &str| Some(s.parse::<Date>().unwrap());

        // Switched off: no read-back for it, and it is not marked as read back.
        scan_with(&store, &mut source, &[Portal::LinkedIn], later).await;
        assert_eq!(source.searched.last(), Some(&day("2026-09-18")));
        assert!(
            store
                .stale_mail_since(Portal::Freelancermap)
                .unwrap()
                .is_some()
        );
        // Switched on again: back to its old job's mail, which heals.
        scan_with(&store, &mut source, &both, later).await;
        assert_eq!(source.searched.last(), Some(&day("2026-08-24")));
        assert_eq!(store.stale_mail_since(Portal::Freelancermap).unwrap(), None);
    }

    /// A state in the future (clock set wrong) counts as unknown: "New" searches thirty
    /// days back and replaces it.
    #[tokio::test]
    async fn a_state_in_the_future_is_replaced() {
        let store = Store::in_memory().unwrap();
        let mut source = fake(None);
        let future: Timestamp = "2027-01-01T08:00:00Z".parse().unwrap();
        store.set_last_scan(Portal::LinkedIn, future).unwrap();
        run_scan(&store, &mut source, Scope::New, now())
            .await
            .1
            .unwrap();
        assert_eq!(
            source.searched.last().unwrap(),
            &Some("2026-08-20".parse().unwrap())
        );
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), Some(now()));
    }

    /// Failure mid-scan: what was processed up to then is stored and counted, the scan
    /// state does not advance.
    #[tokio::test]
    async fn failure_keeps_work_but_not_the_state() {
        let store = Store::in_memory().unwrap();
        let (s, result) = run_scan(&store, &mut fake(Some(30)), Scope::New, now()).await;
        assert!(matches!(result, Err(ScanError::Mail(MailError::Lost(_)))));
        assert_eq!(s.mails_checked, BATCH);
        assert_eq!(store.job_count().unwrap(), 3);
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), None);
    }

    #[tokio::test]
    async fn cancel_stops_before_the_next_batch() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let mut summary = ScanSummary::default();
        let cancel = CancellationToken::new();
        let result = scan(
            &mut fake(None),
            &store,
            run,
            Scope::New,
            &[Portal::LinkedIn],
            now(),
            &cancel,
            &mut summary,
            |event| {
                if matches!(event, ScanEvent::Progress { .. }) {
                    cancel.cancel();
                }
            },
        )
        .await;
        assert!(matches!(result, Err(ScanError::Mail(MailError::Cancelled))));
        assert_eq!(summary.mails_checked, BATCH);
        assert_eq!(store.last_scan(Portal::LinkedIn).unwrap(), None);
    }
}
