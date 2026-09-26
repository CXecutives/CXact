//! What the user keeps about a job: its place - the inbox ("Eingang"), the archive or the
//! trash ("Papierkorb"), like a mail - and "fits anyway"; plus deleting for good from the
//! trash (a tombstone stays). Runs never touch these columns. The favourite of earlier
//! versions (`app_status`) is neither read nor written any more; its columns stay.
//!
//! Every column is nullable, so the migrations (in `schema`) add them with
//! `ALTER TABLE job ADD COLUMN`: schema 4 the first marks, schema 5 the rest.

use jiff::Timestamp;
use rusqlite::{Connection, OptionalExtension, params};

use super::{Store, bump};
use crate::error::Result;
use crate::model::Place;
use crate::portal::{JobKey, Portal};
use crate::time::to_db;

/// The nullable columns schema 4 added to the `job` table, as `(name, sql_type)` pairs.
/// Frozen: schema 5 renamed `hidden_at` to `archived_at`.
///
/// - `app_status`: `saved` = the favourite from schema 5 on (schema 4 also stored
///   `applied`, `interview`, `offer` and `rejected`, which schema 5 turns into favourites);
///   `NULL` = none. Unused since the favourites went (neither read nor written).
/// - `app_status_at`: when the favourite was set (Unix seconds). Unused likewise.
/// - `note`: unused since schema 5 (neither read nor written).
/// - `hidden_at`, now `archived_at`: when the job went to the archive (by the user or by
///   age); `NULL` = not archived.
pub const SCHEMA_4_JOB_COLUMNS: &[(&str, &str)] = &[
    ("app_status", "TEXT"),
    ("app_status_at", "INTEGER"),
    ("note", "TEXT"),
    ("hidden_at", "INTEGER"),
];

/// The nullable columns schema 5 adds to the `job` table.
///
/// - `override_include`: `1` = the user marked an excluded job as fitting anyway; the
///   engine's exclusion is then stored as "scored" (with the fit score) on every rescore.
/// - `mail_version`: the mail parser that read title, company and location
///   (`mail::MAIL_PARSER_VERSION`); `NULL` = one before the versions.
/// - `trashed_at`: when the job went to the trash; it wins over `archived_at`.
/// - `inbox_at`: when the user last moved the job into the inbox (the automatic archive of
///   earlier versions counted a job's age from then).
pub const SCHEMA_5_JOB_COLUMNS: &[(&str, &str)] = &[
    ("override_include", "INTEGER"),
    ("mail_version", "INTEGER"),
    ("trashed_at", "INTEGER"),
    ("inbox_at", "INTEGER"),
];

/// What the migration to schema 5 does beyond the new columns: "hidden" is "archived" now,
/// every other mark of schema 4 (an application status, the pin) becomes the favourite, and
/// the table of deleted job keys (a later scan of an old alert mail never brings them back).
pub const SCHEMA_5_EXTRA: &str = "ALTER TABLE job RENAME COLUMN hidden_at TO archived_at;
UPDATE job SET app_status = 'saved', app_status_at = COALESCE(app_status_at, pinned_at)
 WHERE app_status IS NOT NULL OR pinned_at IS NOT NULL;
CREATE TABLE tombstone (
    portal      TEXT    NOT NULL,
    job_id      TEXT    NOT NULL,
    deleted_at  INTEGER NOT NULL,
    PRIMARY KEY (portal, job_id)
) WITHOUT ROWID;";

/// What the migration to schema 6 does: the indexes of the overview's queries (a date window
/// over the jobs, the last alert mail per portal).
pub const SCHEMA_6_EXTRA: &str =
    "CREATE INDEX job_by_date ON job (COALESCE(mail_date, first_seen_at));
CREATE INDEX alert_by_portal ON alert_mail (portal, mail_date);";

/// The note code of a job the user marked as fitting although the engine excludes it.
pub const USER_OVERRIDE: &str = "userOverride";

/// The jobs in the inbox (the active ones; every list and count but the archive's and the
/// trash's).
pub(crate) const INBOX: &str = "archived_at IS NULL AND trashed_at IS NULL";

/// The condition of a place on the `job` table.
pub(crate) const fn place_condition(place: Place) -> &'static str {
    match place {
        Place::Inbox => INBOX,
        Place::Archive => "archived_at IS NOT NULL AND trashed_at IS NULL",
        Place::Trash => "trashed_at IS NOT NULL",
    }
}

impl Store {
    /// Moves jobs to a place: the inbox (out of archive and trash; the time of the move is
    /// kept), the archive (out of the trash too) or the
    /// trash (the archive time stays for the way back). A job keeps the time it first went to
    /// the archive. Returns the keys that really moved (a job already there or gone is not).
    pub fn move_jobs(&self, keys: &[JobKey], to: Place, now: Timestamp) -> Result<Vec<JobKey>> {
        self.place_jobs(keys.iter().map(|key| (key, to, Some(now))))
    }

    /// Takes moves back (the undo of a toast): each job returns to the place it came from as
    /// it was there. Into the trash with the time it first went there (`trashed_at`, never
    /// later than `now`): its date stays. Into the inbox with the time of the last move into
    /// it. Returns the keys that really moved.
    pub fn move_back(
        &self,
        back: &[(JobKey, Place, Option<Timestamp>)],
        now: Timestamp,
    ) -> Result<Vec<JobKey>> {
        self.place_jobs(back.iter().map(|(key, to, trashed_at)| {
            let at = match to {
                Place::Inbox => None,
                Place::Archive => Some(now),
                Place::Trash => Some(trashed_at.filter(|at| *at <= now).unwrap_or(now)),
            };
            (key, *to, at)
        }))
    }

    /// "Wiederherstellen": takes jobs out of the trash, back to where they lay, like Mail's
    /// "put back": a job thrown away from the archive returns there (it kept its archive
    /// time), any other into the inbox (moved there now). Returns the keys that really left
    /// the trash.
    pub fn restore_jobs(&self, keys: &[JobKey], now: Timestamp) -> Result<Vec<JobKey>> {
        self.write(|conn| {
            let mut stmt = conn.prepare_cached(
                "UPDATE job SET trashed_at = NULL,
                                inbox_at = CASE WHEN archived_at IS NULL THEN ?3 ELSE inbox_at END
                 WHERE portal = ?1 AND job_id = ?2 AND trashed_at IS NOT NULL",
            )?;
            let mut restored = Vec::new();
            for key in keys {
                if stmt.execute(params![key.portal.key(), key.id, to_db(now)])? > 0
                    && !restored.contains(key)
                {
                    restored.push(key.clone());
                }
            }
            if !restored.is_empty() {
                bump(conn)?;
            }
            Ok(restored)
        })
    }

    /// Moves each job to its place at its time (`None`: the inbox keeps the time of the last
    /// move into it); returns the keys that really moved.
    fn place_jobs<'a>(
        &self,
        jobs: impl Iterator<Item = (&'a JobKey, Place, Option<Timestamp>)>,
    ) -> Result<Vec<JobKey>> {
        self.write(|conn| {
            let mut moved = Vec::new();
            for (key, to, at) in jobs {
                let (set, from) = match to {
                    Place::Inbox => (
                        "archived_at = NULL, trashed_at = NULL, inbox_at = COALESCE(?3, inbox_at)",
                        "(archived_at IS NOT NULL OR trashed_at IS NOT NULL)",
                    ),
                    Place::Archive => (
                        "archived_at = COALESCE(archived_at, ?3), trashed_at = NULL",
                        "(archived_at IS NULL OR trashed_at IS NOT NULL)",
                    ),
                    Place::Trash => ("trashed_at = ?3", "trashed_at IS NULL"),
                };
                let mut stmt = conn.prepare_cached(&format!(
                    "UPDATE job SET {set} WHERE portal = ?1 AND job_id = ?2 AND {from}"
                ))?;
                if stmt.execute(params![key.portal.key(), key.id, at.map(to_db)])? > 0
                    && !moved.contains(key)
                {
                    moved.push(key.clone());
                }
            }
            if !moved.is_empty() {
                bump(conn)?;
            }
            Ok(moved)
        })
    }

    /// The keys of every job in the trash ("Papierkorb leeren").
    pub fn trashed_keys(&self) -> Result<Vec<JobKey>> {
        let conn = self.conn();
        keys_where(&conn, "trashed_at IS NOT NULL", [])
    }

    /// Of these keys, the ones in the trash: only they may be deleted for good.
    pub fn in_trash(&self, keys: &[JobKey]) -> Result<Vec<JobKey>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT 1 FROM job WHERE portal = ?1 AND job_id = ?2 AND trashed_at IS NOT NULL",
        )?;
        let mut out = Vec::new();
        for key in keys {
            if stmt
                .query_row(params![key.portal.key(), key.id], |_| Ok(()))
                .optional()?
                .is_some()
            {
                out.push(key.clone());
            }
        }
        Ok(out)
    }

    /// Deletes jobs for good (with the duplicates that stand for them): their rows go, only a
    /// tombstone of each key stays, so a scan never imports them again from an old alert
    /// mail. Returns the keys of the rows that went and the names of their text files (the
    /// caller removes the files). The commands delete only from the trash ([`Store::in_trash`]).
    pub fn delete_jobs(
        &self,
        keys: &[JobKey],
        now: Timestamp,
    ) -> Result<(Vec<JobKey>, Vec<String>)> {
        self.write(|conn| {
            let mut doomed: Vec<(String, String)> = Vec::new();
            {
                let mut dups = conn.prepare_cached(
                    "SELECT portal, job_id FROM job WHERE dup_of = ?1 OR (portal = ?2 AND job_id = ?3)",
                )?;
                for key in keys {
                    let rows = dups.query_map(
                        params![key.to_string(), key.portal.key(), key.id],
                        |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
                    )?;
                    for row in rows {
                        let row = row?;
                        if !doomed.contains(&row) {
                            doomed.push(row);
                        }
                    }
                }
            }
            let mut names = Vec::new();
            let mut name = conn.prepare_cached(
                "SELECT txt_name FROM job WHERE portal = ?1 AND job_id = ?2 AND txt_name IS NOT NULL",
            )?;
            let mut tomb = conn.prepare_cached(
                "INSERT OR REPLACE INTO tombstone (portal, job_id, deleted_at) VALUES (?1, ?2, ?3)",
            )?;
            let mut delete =
                conn.prepare_cached("DELETE FROM job WHERE portal = ?1 AND job_id = ?2")?;
            for (portal, id) in &doomed {
                if let Some(file) = name
                    .query_row(params![portal, id], |r| r.get::<_, String>(0))
                    .optional()?
                {
                    names.push(file);
                }
                tomb.execute(params![portal, id, to_db(now)])?;
                delete.execute(params![portal, id])?;
            }
            if !doomed.is_empty() {
                bump(conn)?;
            }
            let gone = doomed
                .into_iter()
                .filter_map(|(portal, id)| Portal::from_key(&portal).map(|portal| JobKey { portal, id }))
                .collect();
            Ok((gone, names))
        })
    }

    /// Was this job deleted for good?
    pub fn is_deleted(&self, key: &JobKey) -> Result<bool> {
        Ok(self
            .conn()
            .query_row(
                "SELECT 1 FROM tombstone WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
                |_| Ok(()),
            )
            .optional()?
            .is_some())
    }

    /// "Fits anyway": the user includes an excluded job (it counts as scored with its fit
    /// score, and every rescore keeps it so) or takes that back (`false`; the caller stores
    /// the engine's verdict again). `true` if the mark changed.
    pub fn set_override(&self, key: &JobKey, include: bool) -> Result<bool> {
        self.write(|conn| {
            let changed = conn.execute(
                "UPDATE job SET override_include = CASE WHEN ?3 THEN 1 END,
                                match_status = CASE WHEN ?3 AND match_status = 'excluded'
                                                    THEN 'scored' ELSE match_status END
                 WHERE portal = ?1 AND job_id = ?2 AND (override_include IS NULL) = ?3",
                params![key.portal.key(), key.id, include],
            )? > 0;
            if changed {
                if !include {
                    // The engine's verdict is due again (the caller assesses it right away).
                    conn.execute(
                        "UPDATE job SET match_rev = NULL WHERE portal = ?1 AND job_id = ?2",
                        params![key.portal.key(), key.id],
                    )?;
                }
                bump(conn)?;
            }
            Ok(changed)
        })
    }
}

/// The keys of the jobs that meet `condition` (fixed SQL of this module, never input).
fn keys_where(
    conn: &Connection,
    condition: &str,
    params: impl rusqlite::Params,
) -> Result<Vec<JobKey>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT portal, job_id FROM job WHERE {condition} ORDER BY portal, job_id"
    ))?;
    let rows = stmt.query_map(params, |r| {
        Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
    })?;
    let mut keys = Vec::new();
    for row in rows {
        let (portal, id) = row?;
        if let Some(portal) = Portal::from_key(&portal) {
            keys.push(JobKey { portal, id });
        }
    }
    Ok(keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MatchStatus;
    use crate::store::Seen;
    use crate::store::test_support::{mail, now, posting};

    fn store_with_jobs(count: u8) -> (Store, Vec<JobKey>) {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let mut keys = Vec::new();
        for i in 1..=count {
            let p = posting(
                &format!("https://www.linkedin.com/jobs/view/400000000{i}/"),
                &format!("Job {i}"),
                "",
                "",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            keys.push(p.key);
        }
        (store, keys)
    }

    fn place(store: &Store, key: &JobKey) -> Place {
        store.job(key).unwrap().unwrap().place()
    }

    /// A job is in exactly one place; moving counts only real moves and keeps the first time
    /// a job went to a place.
    #[test]
    fn a_job_is_in_one_place_at_a_time() {
        let (store, keys) = store_with_jobs(2);
        let at = now();
        let later = at + jiff::SignedDuration::from_hours(1);
        assert_eq!(place(&store, &keys[0]), Place::Inbox);
        assert_eq!(store.move_jobs(&keys, Place::Archive, at).unwrap(), keys);
        assert!(
            store
                .move_jobs(&keys, Place::Archive, later)
                .unwrap()
                .is_empty(),
            "only real moves come back"
        );
        assert_eq!(store.job(&keys[0]).unwrap().unwrap().archived_at, Some(at));
        assert_eq!(
            store
                .move_jobs(std::slice::from_ref(&keys[0]), Place::Trash, later)
                .unwrap(),
            [keys[0].clone()]
        );
        assert_eq!(place(&store, &keys[0]), Place::Trash);
        assert_eq!(place(&store, &keys[1]), Place::Archive);
        // From the trash back to the archive, then to the inbox.
        store
            .move_jobs(std::slice::from_ref(&keys[0]), Place::Archive, later)
            .unwrap();
        assert_eq!(place(&store, &keys[0]), Place::Archive);
        assert_eq!(store.move_jobs(&keys, Place::Inbox, later).unwrap(), keys);
        assert_eq!(place(&store, &keys[0]), Place::Inbox);
        let job = store.job(&keys[0]).unwrap().unwrap();
        assert_eq!((job.archived_at, job.trashed_at), (None, None));
    }

    /// An undo puts a job back as it was: the trash keeps the time the job first went there.
    #[test]
    fn a_move_taken_back_keeps_the_earlier_times() {
        let (store, keys) = store_with_jobs(3);
        let at = now();
        let later = at + jiff::SignedDuration::from_hours(72);
        let one = std::slice::from_ref(&keys[0]);
        // Wiederherstellen three days later, then its undo: back with the first trash time.
        store.move_jobs(one, Place::Trash, at).unwrap();
        store.move_jobs(one, Place::Inbox, later).unwrap();
        let back = [(keys[0].clone(), Place::Trash, Some(at))];
        assert_eq!(store.move_back(&back, later).unwrap(), one);
        assert_eq!(store.job(&keys[0]).unwrap().unwrap().trashed_at, Some(at));
        assert!(
            store.move_back(&back, later).unwrap().is_empty(),
            "there already"
        );
        // A time from the future is no time of the trash.
        let ahead = later + jiff::SignedDuration::from_hours(1);
        store
            .move_back(&[(keys[1].clone(), Place::Trash, Some(ahead))], later)
            .unwrap();
        assert_eq!(
            store.job(&keys[1]).unwrap().unwrap().trashed_at,
            Some(later)
        );
        // Archived, then taken back: in the inbox again.
        let three = std::slice::from_ref(&keys[2]);
        store.move_jobs(three, Place::Archive, later).unwrap();
        let back = [(keys[2].clone(), Place::Inbox, None)];
        assert_eq!(store.move_back(&back, later).unwrap(), three);
        assert_eq!(place(&store, &keys[2]), Place::Inbox);
    }

    /// Wiederherstellen puts a job back where it lay before the trash: one thrown away from
    /// the archive into the archive, one from the inbox into the inbox.
    #[test]
    fn a_restored_job_goes_back_where_it_lay() {
        let (store, keys) = store_with_jobs(3);
        let at = now();
        let later = at + jiff::SignedDuration::from_hours(72);
        store
            .move_jobs(std::slice::from_ref(&keys[0]), Place::Archive, at)
            .unwrap();
        store.move_jobs(&keys[..2], Place::Trash, at).unwrap();
        let rev = store.data_rev().unwrap();
        assert_eq!(store.restore_jobs(&keys, later).unwrap(), &keys[..2]);
        assert_ne!(store.data_rev().unwrap(), rev);
        let archived = store.job(&keys[0]).unwrap().unwrap();
        assert_eq!(archived.place(), Place::Archive);
        assert_eq!(archived.archived_at, Some(at), "it keeps its archive time");
        assert_eq!(place(&store, &keys[1]), Place::Inbox);
        assert!(
            store.restore_jobs(&keys, later).unwrap().is_empty(),
            "none in the trash"
        );
    }

    /// Archive and trash leave the skill's top matches; back in the inbox, the job is back.
    #[test]
    fn only_inbox_jobs_reach_the_top_matches() {
        let (store, keys) = store_with_jobs(1);
        let key = &keys[0];
        let scored = crate::model::MatchRecord {
            status: MatchStatus::Scored,
            score: 88,
            note: None,
            must_met: 3,
            must_total: 3,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(&[(key.clone(), scored)], "r", now())
            .unwrap();
        let listed = |jobs: Vec<crate::store::JobRow>| -> Vec<JobKey> {
            jobs.into_iter().map(|j| j.key).collect()
        };
        let one = std::slice::from_ref(key);
        assert_eq!(listed(store.best_matches(5).unwrap()), one);
        for away in [Place::Archive, Place::Trash] {
            store.move_jobs(one, away, now()).unwrap();
            assert!(store.best_matches(5).unwrap().is_empty());
            store.move_jobs(one, Place::Inbox, now()).unwrap();
            assert_eq!(listed(store.best_matches(5).unwrap()), one);
        }
    }

    /// The best matches for the matching skill: the best by score; never excluded, archived,
    /// trashed, unscored or gone.
    #[test]
    fn the_best_matches_leave_out_the_rest() {
        let (store, keys) = store_with_jobs(7);
        let record = |status, score| crate::model::MatchRecord {
            status,
            score,
            note: None,
            must_met: 1,
            must_total: 1,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(
                &[
                    (keys[0].clone(), record(MatchStatus::Scored, 60)),
                    (keys[1].clone(), record(MatchStatus::Scored, 90)),
                    (keys[2].clone(), record(MatchStatus::Excluded, 99)),
                    (keys[3].clone(), record(MatchStatus::Scored, 95)),
                    (keys[4].clone(), record(MatchStatus::Scored, 80)),
                    (keys[6].clone(), record(MatchStatus::Scored, 97)),
                ],
                "r",
                now(),
            )
            .unwrap();
        // Job 6 has no score; job 4 is archived; job 7 is in the trash.
        store
            .move_jobs(std::slice::from_ref(&keys[3]), Place::Archive, now())
            .unwrap();
        store
            .move_jobs(std::slice::from_ref(&keys[6]), Place::Trash, now())
            .unwrap();
        let titles = |limit| -> Vec<String> {
            store
                .best_matches(limit)
                .unwrap()
                .into_iter()
                .map(|j| j.title)
                .collect()
        };
        assert_eq!(titles(5), ["Job 2", "Job 5", "Job 1"]);
        assert_eq!(titles(2), ["Job 2", "Job 5"]);
        store.record_gone(&keys[1], now()).unwrap();
        assert_eq!(
            titles(5),
            ["Job 5", "Job 1"],
            "an ad no longer online is out"
        );
    }

    /// Only the trash is deleted for good; a deleted job leaves only its tombstone: the row,
    /// its duplicate and its text file name go, and the same link in an old alert mail never
    /// brings it back.
    #[test]
    fn a_deleted_job_never_comes_back() {
        let (store, keys) = store_with_jobs(2);
        let link = "https://www.linkedin.com/jobs/view/4000000001/";
        store.mark_txt_written(&keys[0], "a.txt", now()).unwrap();
        store
            .move_jobs(std::slice::from_ref(&keys[0]), Place::Trash, now())
            .unwrap();
        assert_eq!(store.trashed_keys().unwrap(), [keys[0].clone()]);
        assert_eq!(store.in_trash(&keys).unwrap(), [keys[0].clone()]);
        let rev = store.data_rev().unwrap();
        let (gone, names) = store
            .delete_jobs(&store.trashed_keys().unwrap(), now())
            .unwrap();
        assert_eq!(
            (gone, names),
            (vec![keys[0].clone()], vec!["a.txt".to_owned()])
        );
        assert!(
            store.data_rev().unwrap() > rev,
            "the Excel file loses the row"
        );
        assert!(store.job(&keys[0]).unwrap().is_none());
        assert!(store.is_deleted(&keys[0]).unwrap());
        assert!(store.job(&keys[1]).unwrap().is_some());
        assert!(!store.is_deleted(&keys[1]).unwrap());
        // The next scan finds the old mail again.
        let next = store.begin_run().unwrap();
        let again = posting(link, "Job 1", "", "");
        assert_eq!(
            store.upsert_posting(next, &again, mail(), now()).unwrap(),
            Seen::KnownBefore
        );
        assert!(store.job(&keys[0]).unwrap().is_none());
        assert_eq!(store.job_count().unwrap(), 1);
        assert_eq!(
            store
                .delete_jobs(std::slice::from_ref(&keys[0]), now())
                .unwrap(),
            (Vec::new(), Vec::new())
        );
    }

    /// "Fits anyway" turns an excluded job into a scored one with its fit score; a rescore
    /// keeps that, taking it back makes the engine's verdict due again.
    #[test]
    fn the_override_survives_a_rescore_and_can_be_taken_back() {
        let (store, keys) = store_with_jobs(1);
        let key = &keys[0];
        let excluded = crate::model::MatchRecord {
            status: MatchStatus::Excluded,
            score: 71,
            note: None,
            must_met: 1,
            must_total: 2,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(&[(key.clone(), excluded.clone())], "r1", now())
            .unwrap();
        let status = |store: &Store| {
            let job = store.job(key).unwrap().unwrap();
            let record = job.match_.unwrap();
            (record.status, record.score, job.override_include)
        };
        assert_eq!(status(&store), (MatchStatus::Excluded, 71, false));
        assert!(store.set_override(key, true).unwrap());
        assert!(!store.set_override(key, true).unwrap());
        assert_eq!(status(&store), (MatchStatus::Scored, 71, true));
        // A rescore with the same verdict keeps the user's word.
        store
            .save_matches(&[(key.clone(), excluded.clone())], "r2", now())
            .unwrap();
        assert_eq!(status(&store), (MatchStatus::Scored, 71, true));
        assert!(
            store
                .save_match_if(key, &excluded.clone().into(), "r3", Some("r2"), now())
                .unwrap()
        );
        assert_eq!(status(&store), (MatchStatus::Scored, 71, true));
        // Taken back: the score is due again; the next assessment stores the verdict.
        assert!(store.set_override(key, false).unwrap());
        assert_eq!(store.job(key).unwrap().unwrap().match_rev, None);
        store
            .save_matches(&[(key.clone(), excluded)], "r3", now())
            .unwrap();
        assert_eq!(status(&store), (MatchStatus::Excluded, 71, false));
    }

    #[test]
    fn an_unknown_job_changes_nothing() {
        let (store, _) = store_with_jobs(1);
        let other = crate::portal::job_link("https://www.linkedin.com/jobs/view/4000000009/")
            .unwrap()
            .key;
        let one = std::slice::from_ref(&other);
        assert!(
            store
                .move_jobs(one, Place::Trash, now())
                .unwrap()
                .is_empty()
        );
        assert!(!store.set_override(&other, true).unwrap());
        assert!(store.in_trash(one).unwrap().is_empty());
    }
}
