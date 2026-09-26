//! Queries over all jobs: the last alert mail per portal (index `alert_by_portal` of schema
//! 6), the jobs of one company in a date window (index `job_by_date`), and the counts a
//! rescore compares before and after.

use jiff::Timestamp;
use rusqlite::params;

use super::Store;
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

impl Store {
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

    /// The queries go through their indexes, whatever number of jobs: the date window through
    /// `job_by_date`, the last alert mails through `alert_by_portal`.
    #[test]
    fn the_queries_use_their_indexes() {
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
