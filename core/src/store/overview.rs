//! The queries of the "Übersicht" page: the jobs of a date window (the index `job_by_date`
//! of schema 6 finds them at once; the numbers are taken from them), the last alert mail per
//! portal (index `alert_by_portal`), the jobs of one company, and the counts a rescore
//! compares before and after.

use jiff::Timestamp;
use rusqlite::params;

use super::Store;
use super::jobs::{JOB_COLUMNS, JobRow, job_row};
use super::marks::INBOX;
use crate::error::Result;
use crate::model::HIGH_FROM;
use crate::portal::Portal;
use crate::text::split_company_location;
use crate::time::{from_db, to_db};

/// Excluded and high-band jobs of the inbox (no duplicate), what a rescore compares.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BandCounts {
    pub excluded: u32,
    pub high: u32,
}

/// What one portal's jobs in the inbox (no duplicate) still leave open.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct InboxOpen {
    /// Without their full ad and not given up on: not fetched yet, or failed so far.
    pub no_ad: u32,
    /// With only the teaser a guest sees.
    pub teaser: u32,
    /// Excluded and not opened yet.
    pub excluded_unread: u32,
}

impl Store {
    /// The jobs whose alert mail (else first sighting) is at most `since` old, not in the
    /// trash, no duplicate (its original stands for it), newest first.
    pub fn jobs_since(&self, since: Timestamp) -> Result<Vec<JobRow>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {JOB_COLUMNS} FROM job INDEXED BY job_by_date
             WHERE COALESCE(mail_date, first_seen_at) >= ?1 AND trashed_at IS NULL
               AND dup_of IS NULL
             ORDER BY COALESCE(mail_date, first_seen_at) DESC, portal, job_id"
        ))?;
        let rows = stmt.query_map([to_db(since)], job_row)?;
        rows.map(|r| r?).collect()
    }

    /// The jobs per portal whose alert mail (else first sighting) is at most `since` old,
    /// wherever they lie now; a job two portals announced counts for each.
    pub fn new_per_portal(&self, since: Timestamp) -> Result<Vec<(Portal, u32)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT portal, COUNT(*) FROM job INDEXED BY job_by_date
             WHERE COALESCE(mail_date, first_seen_at) >= ?1 GROUP BY portal",
        )?;
        let rows = stmt.query_map([to_db(since)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, u32>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, count) = row?;
            if let Some(portal) = Portal::from_key(&portal) {
                out.push((portal, count));
            }
        }
        Ok(out)
    }

    /// The date of the last alert mail of every portal that ever sent one.
    pub fn last_alerts(&self) -> Result<Vec<(Portal, Option<Timestamp>)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT portal, MAX(mail_date) FROM alert_mail INDEXED BY alert_by_portal GROUP BY portal ORDER BY portal",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<i64>>(1)?))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, at) = row?;
            if let Some(portal) = Portal::from_key(&portal) {
                out.push((portal, at.and_then(from_db)));
            }
        }
        Ok(out)
    }

    /// The jobs of one company (its name as the list shows it, normalised: case, punctuation
    /// and legal forms left out) whose alert mail is at most `since` old, not in the trash, no
    /// duplicate - the job asked about included. 0 for a name without words.
    pub fn company_count(&self, company: &str, since: Timestamp) -> Result<u32> {
        let wanted = company_key(company, "");
        if wanted.is_empty() {
            return Ok(0);
        }
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT company, location FROM job INDEXED BY job_by_date
             WHERE COALESCE(mail_date, first_seen_at) >= ?1 AND trashed_at IS NULL
               AND dup_of IS NULL",
        )?;
        let rows = stmt.query_map([to_db(since)], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
        })?;
        let mut count = 0;
        for row in rows {
            let (company, location) = row?;
            if company_key(&company, &location) == wanted {
                count += 1;
            }
        }
        Ok(count)
    }

    /// The excluded and the high-band jobs of the inbox (no duplicate).
    pub fn band_counts(&self) -> Result<BandCounts> {
        let (excluded, high): (u32, u32) = self.conn().query_row(
            &format!(
                "SELECT COALESCE(SUM(match_status IS 'excluded'), 0),
                        COALESCE(SUM(match_status IS 'scored' AND match_score >= ?1), 0)
                 FROM job WHERE {INBOX} AND dup_of IS NULL"
            ),
            params![HIGH_FROM],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok(BandCounts { excluded, high })
    }

    /// Per portal what its jobs in the inbox (no duplicate) leave open ([`InboxOpen`]); a
    /// portal without jobs there is left out.
    pub fn inbox_open(&self) -> Result<Vec<(Portal, InboxOpen)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT portal,
                    COALESCE(SUM(desc_status IN ('missing', 'failed')), 0),
                    COALESCE(SUM(desc_status = 'teaser'), 0),
                    COALESCE(SUM(read_at IS NULL AND match_status IS 'excluded'), 0)
             FROM job WHERE {INBOX} AND dup_of IS NULL GROUP BY portal ORDER BY portal"
        ))?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                InboxOpen {
                    no_ad: r.get(1)?,
                    teaser: r.get(2)?,
                    excluded_unread: r.get(3)?,
                },
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, open) = row?;
            if let Some(portal) = Portal::from_key(&portal) {
                out.push((portal, open));
            }
        }
        Ok(out)
    }
}

/// A company's name for comparing: cleaned like the list shows it, then without case,
/// punctuation and legal forms.
fn company_key(company: &str, location: &str) -> String {
    let (company, _) = split_company_location(company, location);
    super::duplicates::identity("", &company).1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_support::{mail, now, posting};

    /// The overview's queries go through their indexes, whatever number of jobs: the date
    /// window through `job_by_date`, the last alert mails through `alert_by_portal`.
    #[test]
    fn the_overview_queries_use_their_indexes() {
        let store = Store::in_memory().unwrap();
        let plan = |sql: &str| -> String {
            let conn = store.conn();
            let mut stmt = conn.prepare(&format!("EXPLAIN QUERY PLAN {sql}")).unwrap();
            stmt.query_map([1_i64], |r| r.get::<_, String>(3))
                .unwrap()
                .map(Result::unwrap)
                .collect::<Vec<_>>()
                .join("; ")
        };
        let window = plan(
            "SELECT portal FROM job INDEXED BY job_by_date WHERE COALESCE(mail_date, first_seen_at) >= ?1
             AND trashed_at IS NULL AND dup_of IS NULL",
        );
        assert!(window.contains("job_by_date"), "{window}");
        let per_portal = plan(
            "SELECT portal, COUNT(*) FROM job INDEXED BY job_by_date
             WHERE COALESCE(mail_date, first_seen_at) >= ?1 GROUP BY portal",
        );
        assert!(per_portal.contains("job_by_date"), "{per_portal}");
        let alerts = plan(
            "SELECT portal, MAX(mail_date) FROM alert_mail INDEXED BY alert_by_portal WHERE ?1 = ?1 GROUP BY portal",
        );
        assert!(alerts.contains("alert_by_portal"), "{alerts}");
    }

    /// The company count finds the same firm however a mail wrote it, in the window only,
    /// never the trash.
    #[test]
    fn the_same_company_however_written() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        for (id, company) in [
            (1, "Muster GmbH"),
            (2, "von: MUSTER gmbh"),
            (3, "Muster GmbH & Co. KG"),
            (4, "Andere AG"),
        ] {
            let p = posting(
                &format!("https://www.linkedin.com/jobs/view/400000000{id}/"),
                "Rolle",
                company,
                "Köln",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
        }
        let since = now() - jiff::SignedDuration::from_hours(24 * 30);
        assert_eq!(store.company_count("Muster GmbH", since).unwrap(), 3);
        assert_eq!(store.company_count("Andere AG", since).unwrap(), 1);
        assert_eq!(store.company_count("", since).unwrap(), 0);
        let later = now() + jiff::SignedDuration::from_hours(24 * 40);
        assert_eq!(store.company_count("Muster GmbH", later).unwrap(), 0);
        let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4000000001/")
            .unwrap()
            .key;
        store
            .move_jobs(
                std::slice::from_ref(&key),
                crate::model::Place::Trash,
                now(),
            )
            .unwrap();
        assert_eq!(store.company_count("Muster GmbH", since).unwrap(), 2);
    }
}
