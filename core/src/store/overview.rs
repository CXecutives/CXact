//! Queries over all jobs: the alert mails per portal (index `alert_by_portal`), the
//! open terms of the jobs of a date window (index `job_by_date`) and the counts a rescore
//! compares before and after.

use jiff::Timestamp;
use rusqlite::params;

use super::Store;
use super::marks::INBOX;
use crate::error::Result;
use crate::model::HIGH_FROM;
use crate::portal::Portal;
use crate::time::{from_db, to_db};

/// Excluded and high-band jobs of the inbox (no duplicate), what a rescore compares.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BandCounts {
    pub excluded: u32,
    pub high: u32,
}

/// The alert mails of a portal the app read: the date of its last one and how many came
/// since a moment.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PortalAlerts {
    pub portal: Portal,
    pub last: Option<Timestamp>,
    pub since: u32,
}

impl Store {
    /// The alert mails of every portal that ever sent one: the date of its last one and how
    /// many are dated at or after `since`.
    pub fn portal_alerts(&self, since: Timestamp) -> Result<Vec<PortalAlerts>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT portal, MAX(mail_date), COALESCE(SUM(mail_date >= ?1), 0)
             FROM alert_mail INDEXED BY alert_by_portal GROUP BY portal ORDER BY portal",
        )?;
        let rows = stmt.query_map([to_db(since)], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, Option<i64>>(1)?,
                r.get::<_, u32>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, at, count) = row?;
            if let Some(portal) = Portal::from_key(&portal) {
                out.push(PortalAlerts {
                    portal,
                    last: at.and_then(from_db),
                    since: count,
                });
            }
        }
        Ok(out)
    }

    /// The open terms of every scored job whose alert mail (else first sighting) is at most
    /// `since` old, in the inbox or the archive, no duplicate: one list per job, the newest
    /// job first. One pass over the stored notes through the index `job_by_date`
    /// ("Häufig verlangt", `view::asked_terms`).
    pub fn asked_terms(&self, since: Timestamp) -> Result<Vec<Vec<String>>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT match_note FROM job INDEXED BY job_by_date
             WHERE COALESCE(mail_date, first_seen_at) >= ?1 AND trashed_at IS NULL
               AND dup_of IS NULL AND match_status = 'scored' AND match_note IS NOT NULL
             ORDER BY COALESCE(mail_date, first_seen_at) DESC, portal, job_id",
        )?;
        let rows = stmt.query_map([to_db(since)], |r| r.get::<_, String>(0))?;
        let mut out = Vec::new();
        for note in rows {
            let terms = super::matches::note_terms(&note?);
            if !terms.is_empty() {
                out.push(terms);
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

    /// The alert mails per portal go through their index, whatever number of mails.
    #[test]
    fn the_portal_alerts_use_their_index() {
        let store = Store::in_memory().unwrap();
        let conn = store.conn();
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN SELECT portal, MAX(mail_date), SUM(mail_date >= ?1)
                 FROM alert_mail INDEXED BY alert_by_portal GROUP BY portal",
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

    /// Each portal's last alert mail and how many are dated in the window; a mail without a
    /// date counts for neither.
    #[test]
    fn the_alert_mails_of_each_portal() {
        use crate::model::AlertMail;
        use crate::store::test_support::now;

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let day = |n: i64| now() - jiff::SignedDuration::from_hours(24 * n);
        for (key, portal, date) in [
            ("a", Portal::LinkedIn, Some(day(2))),
            ("b", Portal::LinkedIn, Some(day(29))),
            ("c", Portal::LinkedIn, Some(day(40))),
            ("d", Portal::LinkedIn, None),
            ("e", Portal::FreelanceDe, Some(day(60))),
        ] {
            let alert = AlertMail {
                key: key.to_owned(),
                portal,
                subject: "Neue Jobs".to_owned(),
                sender: String::new(),
                date,
                gmail_id: None,
                postings: Vec::new(),
            };
            store.record_alert(run, &alert, now()).unwrap();
        }
        let alerts = store.portal_alerts(day(30)).unwrap();
        assert_eq!(
            alerts,
            [
                PortalAlerts {
                    portal: Portal::FreelanceDe,
                    last: Some(day(60)),
                    since: 0,
                },
                PortalAlerts {
                    portal: Portal::LinkedIn,
                    last: Some(day(2)),
                    since: 2,
                },
            ]
        );
    }

    /// The open terms of a window go through the date index, whatever number of jobs.
    #[test]
    fn the_asked_terms_use_their_index() {
        let store = Store::in_memory().unwrap();
        let conn = store.conn();
        let mut stmt = conn
            .prepare(
                "EXPLAIN QUERY PLAN SELECT match_note FROM job INDEXED BY job_by_date
                 WHERE COALESCE(mail_date, first_seen_at) >= ?1 AND trashed_at IS NULL
                   AND dup_of IS NULL AND match_status = 'scored'",
            )
            .unwrap();
        let plan = stmt
            .query_map([1_i64], |r| r.get::<_, String>(3))
            .unwrap()
            .map(Result::unwrap)
            .collect::<Vec<_>>()
            .join("; ");
        assert!(plan.contains("job_by_date"), "{plan}");
    }

    /// The terms of the scored jobs of the inbox and the archive in the window, newest first;
    /// the trash, an excluded job, a job without terms and one before the window are none of
    /// them.
    #[test]
    fn the_asked_terms_of_the_window() {
        use crate::model::{MatchRecord, MatchStatus, Place};
        use crate::store::Judgement;
        use crate::store::test_support::{mail, now, posting};

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let day = |n: i64| now() - jiff::SignedDuration::from_hours(24 * n);
        let mut keys = Vec::new();
        let mut judged = Vec::new();
        for (id, ago, status, terms) in [
            (1, 1, MatchStatus::Scored, vec!["Power BI", "SAP FI"]),
            (2, 2, MatchStatus::Scored, vec!["Power BI"]),
            (3, 3, MatchStatus::Excluded, vec!["Excluded"]),
            (4, 4, MatchStatus::Scored, vec![]),
            (5, 5, MatchStatus::Scored, vec!["Archived"]),
            (6, 6, MatchStatus::Scored, vec!["Trashed"]),
            (7, 40, MatchStatus::Scored, vec!["Old"]),
        ] {
            let p = posting(
                &format!("https://www.linkedin.com/jobs/view/400000000{id}/"),
                "Rolle",
                "Firma",
                "Köln",
            );
            let mut sent = mail();
            sent.date = Some(day(ago));
            store.upsert_posting(run, &p, sent, now()).unwrap();
            let record = MatchRecord {
                status,
                score: 70,
                note: None,
                must_met: 0,
                must_total: 0,
                top: Vec::new(),
                facts: crate::model::KeyFacts::default(),
                rank: 0,
            };
            let terms = terms.into_iter().map(str::to_owned).collect();
            judged.push((
                p.key.clone(),
                Judgement {
                    record,
                    open: Vec::new(),
                    terms,
                },
            ));
            keys.push(p.key);
        }
        store.save_judgements(&judged, "r", now()).unwrap();
        store
            .move_jobs(std::slice::from_ref(&keys[4]), Place::Archive, now())
            .unwrap();
        store
            .move_jobs(std::slice::from_ref(&keys[5]), Place::Trash, now())
            .unwrap();
        let asked = store.asked_terms(day(30)).unwrap();
        assert_eq!(
            asked,
            [
                vec!["Power BI", "SAP FI"],
                vec!["Power BI"],
                vec!["Archived"]
            ]
        );
    }
}
