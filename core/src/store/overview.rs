//! Queries over all jobs: the last alert mail per portal (index `alert_by_portal` of schema
//! 6) and the counts a rescore compares before and after. (Schema 6's index `job_by_date`
//! served a count of a company's jobs that is gone; the index stays, no migration.)

use jiff::Timestamp;
use rusqlite::params;

use super::Store;
use super::marks::INBOX;
use crate::error::Result;
use crate::model::HIGH_FROM;
use crate::portal::Portal;
use crate::time::from_db;

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

#[cfg(test)]
mod tests {
    use super::*;

    /// The last alert mails go through their index, whatever number of mails.
    #[test]
    fn the_last_alerts_use_their_index() {
        let store = Store::in_memory().unwrap();
        let conn = store.conn();
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN SELECT portal, MAX(mail_date) FROM alert_mail
                 INDEXED BY alert_by_portal WHERE ?1 = ?1 GROUP BY portal",
            )
            .unwrap();
        let plan = stmt
            .query_map([1_i64], |r| r.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
            .join("; ");
        assert!(plan.contains("alert_by_portal"), "{plan}");
    }
}
