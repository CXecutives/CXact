//! Schema 3: match results and the per-job state around them (read).
//!
//! Every column is nullable, so the migration (in `schema`) is one
//! `ALTER TABLE job ADD COLUMN` per entry of [`SCHEMA_3_JOB_COLUMNS`].

use jiff::Timestamp;
use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};

use super::jobs::{JOB_COLUMNS, JobRow, job_row};
use super::{Store, bump};
use crate::error::Result;
use crate::model::{HIGH_FROM, KeyFacts, MatchRecord, MatchStatus, Notice};
use crate::portal::JobKey;
use crate::text::truncate_chars;
use crate::time::{from_db, to_db};

/// The nullable columns schema 3 adds to the `job` table, as `(name, sql_type)` pairs.
/// Timestamps are Unix seconds, like every other time column.
///
/// - `match_score`: score 0-100.
/// - `match_status`: `scored`, `excluded` or `unscorable`.
/// - `match_note`: JSON `{code, params, mustMet, mustTotal, top[<=2], open[<=2],
///   terms[<=8], facts, rank}`, at most 1024 bytes.
/// - `match_at`: when the job was scored.
/// - `match_rev`: revision of engine, profile and model that produced the score; `NULL`
///   after a change of title or text (the job is scored again).
/// - `read_at`: when the user read the job; `NULL` means unread.
/// - `desc_facts`: facts taken from the job page.
/// - `dup_of`: `portal:id` of the job this one duplicates.
/// - `parser_version`: version of the page parser that produced the full text.
/// - `pinned_at`: when the user pinned the job; unused since schema 5 (see `marks`).
pub const SCHEMA_3_JOB_COLUMNS: &[(&str, &str)] = &[
    ("match_score", "INTEGER"),
    ("match_status", "TEXT"),
    ("match_note", "TEXT"),
    ("match_at", "INTEGER"),
    ("match_rev", "TEXT"),
    ("read_at", "INTEGER"),
    ("desc_facts", "TEXT"),
    ("dup_of", "TEXT"),
    ("parser_version", "INTEGER"),
    ("pinned_at", "INTEGER"),
];

/// Most bytes a stored note takes.
const MAX_NOTE_BYTES: usize = 1024;
/// Most characters of one quoted requirement in the note.
const MAX_TOP_CHARS: usize = 80;
/// Most quoted requirements in the note, met ones and open ones each.
const MAX_TOP: usize = 2;

/// A match as the store keeps it: what the matcher says ([`MatchRecord`]), up to two open
/// must requirements quoted from the ad (the list's `open`) and the open requirements that
/// are terms ("Häufig verlangt" counts them, [`Store::asked_terms`]).
#[derive(Debug, Clone, PartialEq)]
pub struct Judgement {
    pub record: MatchRecord,
    pub open: Vec<String>,
    pub terms: Vec<String>,
}

impl From<MatchRecord> for Judgement {
    /// A record without open requirements (a matcher that names none).
    fn from(record: MatchRecord) -> Judgement {
        Judgement {
            record,
            open: Vec::new(),
            terms: Vec::new(),
        }
    }
}

/// The Excel sheet: the inbox and the archive, no duplicate.
const SHEET: &str = "trashed_at IS NULL AND dup_of IS NULL";

/// The list's order by match: the best score first, equal scores by the score before the
/// caps (`rank` in the note), then the newest mail.
const BY_MATCH: &str = "match_score DESC, json_extract(match_note, '$.rank') DESC,
    COALESCE(mail_date, first_seen_at) DESC, portal, job_id";

/// `match_note` as stored.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredNote {
    code: Option<String>,
    params: serde_json::Map<String, serde_json::Value>,
    must_met: u16,
    must_total: u16,
    top: Vec<String>,
    /// Open must requirements (quoted); older notes have none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    open: Vec<String>,
    /// Open must and nice requirements that are terms; older notes have none.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    terms: Vec<String>,
    #[serde(skip_serializing_if = "KeyFacts::is_empty", serialize_with = "compact")]
    facts: KeyFacts,
    /// Per-mille score before caps (tie-breaker of the list order).
    rank: u16,
}

/// The key facts without their `null` values (the note has 400 bytes).
fn compact<S: serde::Serializer>(facts: &KeyFacts, serializer: S) -> Result<S::Ok, S::Error> {
    let mut value = serde_json::to_value(facts).map_err(serde::ser::Error::custom)?;
    if let Some(map) = value.as_object_mut() {
        map.retain(|_, v| !v.is_null());
    }
    value.serialize(serializer)
}

/// The note of a match as JSON of at most [`MAX_NOTE_BYTES`] bytes (quotes are cut, then
/// dropped - the open ones first, then the terms from the last, then the met ones, then the
/// note's params; the key facts stay).
pub(super) fn encode_note(judged: &Judgement) -> String {
    let (record, open) = (&judged.record, judged.open.as_slice());
    let quotes = |list: &[String]| -> Vec<String> {
        list.iter()
            .take(MAX_TOP)
            .map(|t| truncate_chars(t, MAX_TOP_CHARS))
            .collect()
    };
    let mut note = StoredNote {
        code: record.note.as_ref().map(|n| n.code.clone()),
        params: record
            .note
            .as_ref()
            .map(|n| n.params.clone())
            .unwrap_or_default(),
        must_met: record.must_met,
        must_total: record.must_total,
        top: quotes(&record.top),
        open: quotes(open),
        terms: judged.terms.clone(),
        facts: record.facts.clone(),
        rank: record.rank,
    };
    loop {
        let json = serde_json::to_string(&note).unwrap_or_default();
        let nothing_left = note.open.is_empty()
            && note.terms.is_empty()
            && note.top.is_empty()
            && note.params.is_empty();
        if json.len() <= MAX_NOTE_BYTES || nothing_left {
            return json;
        }
        if note.open.pop().is_none() && note.terms.pop().is_none() && note.top.pop().is_none() {
            note.params.clear();
        }
    }
}

/// The open terms of a stored note (none in an older or unreadable one).
pub(super) fn note_terms(note: &str) -> Vec<String> {
    #[derive(Deserialize)]
    struct Terms {
        #[serde(default)]
        terms: Vec<String>,
    }
    serde_json::from_str::<Terms>(note)
        .map(|n| n.terms)
        .unwrap_or_default()
}

/// A match from its stored columns with its open must requirements; `None` without a status
/// (not scored).
pub(super) fn decode_match(
    status: Option<&str>,
    score: Option<i64>,
    note: Option<&str>,
) -> Option<(MatchRecord, Vec<String>)> {
    let status = MatchStatus::parse(status?)?;
    let note: StoredNote = note
        .and_then(|n| serde_json::from_str(n).ok())
        .unwrap_or_default();
    let record = MatchRecord {
        status,
        score: score
            .and_then(|s| u8::try_from(s.clamp(0, 100)).ok())
            .unwrap_or(0),
        note: note.code.map(|code| Notice {
            code,
            params: note.params,
        }),
        must_met: note.must_met,
        must_total: note.must_total,
        top: note.top,
        facts: note.facts,
        rank: note.rank,
    };
    Some((record, note.open))
}

impl Store {
    /// Marks a job as read; `true` if it was unread. Reading changes no export - so no new
    /// change counter.
    pub fn mark_read(&self, key: &JobKey, now: Timestamp) -> Result<bool> {
        Ok(self.conn().execute(
            "UPDATE job SET read_at = ?3 WHERE portal = ?1 AND job_id = ?2 AND read_at IS NULL",
            params![key.portal.key(), key.id, to_db(now)],
        )? > 0)
    }

    /// Stores the matches of a page of jobs as one change (`rev`: who scored them), without
    /// open requirements (see [`Store::save_judgements`]).
    pub fn save_matches(
        &self,
        matches: &[(JobKey, MatchRecord)],
        rev: &str,
        now: Timestamp,
    ) -> Result<()> {
        self.save_all(
            matches.iter().map(|(key, r)| {
                let note = encode_note(&Judgement::from(r.clone()));
                (key, r, note)
            }),
            rev,
            now,
        )
    }

    /// Stores the matches of a page of jobs with their open requirements as one change
    /// (`rev`: who scored them).
    pub fn save_judgements(
        &self,
        judged: &[(JobKey, Judgement)],
        rev: &str,
        now: Timestamp,
    ) -> Result<()> {
        self.save_all(
            judged
                .iter()
                .map(|(key, j)| (key, &j.record, encode_note(j))),
            rev,
            now,
        )
    }

    fn save_all<'a>(
        &self,
        matches: impl ExactSizeIterator<Item = (&'a JobKey, &'a MatchRecord, String)>,
        rev: &str,
        now: Timestamp,
    ) -> Result<()> {
        if matches.len() == 0 {
            return Ok(());
        }
        self.write(|conn| {
            let mut stmt = conn.prepare_cached(
                "UPDATE job SET match_score = ?3, match_note = ?5,
                                match_status = CASE WHEN override_include = 1 AND ?4 = 'excluded'
                                                    THEN 'scored' ELSE ?4 END,
                                match_rev = ?6, match_at = ?7
                 WHERE portal = ?1 AND job_id = ?2",
            )?;
            for (key, record, note) in matches {
                stmt.execute(params![
                    key.portal.key(),
                    key.id,
                    record.score,
                    record.status.as_str(),
                    note,
                    rev,
                    to_db(now),
                ])?;
            }
            bump(conn)
        })
    }

    /// Stores the match of one job only while its revision is still `expected` (compare and
    /// set): a run that scored the job in the meantime wins. A duplicate of another portal's
    /// job is never scored (it shows as that job's row). `true` if stored.
    pub fn save_match_if(
        &self,
        key: &JobKey,
        judged: &Judgement,
        rev: &str,
        expected: Option<&str>,
        now: Timestamp,
    ) -> Result<bool> {
        let record = &judged.record;
        self.write(|conn| {
            let changed = conn.execute(
                "UPDATE job SET match_score = ?3, match_note = ?5,
                                match_status = CASE WHEN override_include = 1 AND ?4 = 'excluded'
                                                    THEN 'scored' ELSE ?4 END,
                                match_rev = ?6, match_at = ?7
                 WHERE portal = ?1 AND job_id = ?2 AND match_rev IS ?8 AND dup_of IS NULL",
                params![
                    key.portal.key(),
                    key.id,
                    record.score,
                    record.status.as_str(),
                    encode_note(judged),
                    rev,
                    to_db(now),
                    expected,
                ],
            )?;
            if changed > 0 {
                bump(conn)?;
            }
            Ok(changed > 0)
        })
    }

    /// Up to `limit` jobs not scored with `rev` yet (after skipping `offset`), with their
    /// full text; newest first. A duplicate of another portal's job is scored with that one.
    pub fn unscored(
        &self,
        rev: &str,
        limit: u32,
        offset: usize,
    ) -> Result<Vec<(JobRow, Option<String>)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {JOB_COLUMNS}, desc_text FROM job
             WHERE match_rev IS NOT ?1 AND dup_of IS NULL
             ORDER BY first_seen_at DESC, portal, job_id LIMIT ?2 OFFSET ?3"
        ))?;
        let offset = i64::try_from(offset).unwrap_or(i64::MAX);
        let rows = stmt.query_map(params![rev, limit, offset], |r| {
            let text: Option<String> = r.get(super::jobs::JOB_COLUMN_COUNT)?;
            Ok(job_row(r)?.map(|job| (job, text)))
        })?;
        rows.map(|r| r?).collect()
    }

    /// Number of jobs not scored with `rev` yet.
    pub fn match_pending(&self, rev: &str) -> Result<u32> {
        Ok(self.conn().query_row(
            "SELECT COUNT(*) FROM job WHERE match_rev IS NOT ?1 AND dup_of IS NULL",
            [rev],
            |r| r.get(0),
        )?)
    }

    /// Does any job still carry a score (of whatever profile; what
    /// [`Store::clear_matches`] would forget)?
    pub fn has_matches(&self) -> Result<bool> {
        Ok(self.conn().query_row(
            "SELECT EXISTS (SELECT 1 FROM job
                            WHERE match_status IS NOT NULL OR match_rev IS NOT NULL)",
            [],
            |r| r.get(0),
        )?)
    }

    /// Forgets every match (the profile is gone); the number of jobs that had one.
    pub fn clear_matches(&self) -> Result<usize> {
        self.write(|conn| {
            let cleared = conn.execute(
                "UPDATE job SET match_score = NULL, match_status = NULL, match_note = NULL,
                                match_at = NULL, match_rev = NULL
                 WHERE match_status IS NOT NULL OR match_rev IS NOT NULL",
                [],
            )?;
            if cleared > 0 {
                bump(conn)?;
            }
            Ok(cleared)
        })
    }

    /// When a job was scored last (with whatever revision).
    pub fn match_at(&self, key: &JobKey) -> Result<Option<Timestamp>> {
        let at: Option<i64> = self
            .conn()
            .query_row(
                "SELECT match_at FROM job WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(at.and_then(from_db))
    }

    /// When the last job was scored with `rev`; `None` if none was.
    pub fn scored_at(&self, rev: &str) -> Result<Option<Timestamp>> {
        let at: Option<i64> = self.conn().query_row(
            "SELECT MAX(match_at) FROM job WHERE match_rev = ?1",
            [rev],
            |r| r.get(0),
        )?;
        Ok(at.and_then(from_db))
    }

    /// The jobs a mailbox run brought and how many of them are scored in the high band: first
    /// seen in `run`, a job several portals announce once (as its original), excluded ones
    /// left out - the numbers of the run card.
    pub fn new_jobs(&self, run: i64) -> Result<(usize, usize)> {
        let (count, high): (i64, i64) = self.conn().query_row(
            "SELECT COUNT(*), COALESCE(SUM(match_status IS 'scored' AND match_score >= ?2), 0)
             FROM job WHERE first_seen_run = ?1 AND dup_of IS NULL
                        AND match_status IS NOT 'excluded'",
            params![run, HIGH_FROM],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )?;
        Ok((
            usize::try_from(count).unwrap_or(0),
            usize::try_from(high).unwrap_or(0),
        ))
    }

    /// The jobs of the Excel sheet: the inbox and the archive (never the trash), no duplicate
    /// (its original's row stands for it), in the list's order by match - excluded ones
    /// after the others, unscored ones after the scored.
    pub fn sheet_jobs(&self) -> Result<Vec<JobRow>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {JOB_COLUMNS} FROM job WHERE {SHEET}
             ORDER BY (match_status IS 'excluded'), (match_score IS NULL), {BY_MATCH}"
        ))?;
        let rows = stmt.query_map([], job_row)?;
        rows.map(|r| r?).collect()
    }

    /// Number of the rows of the Excel sheet ([`Store::sheet_jobs`]).
    pub fn sheet_count(&self) -> Result<u64> {
        let count: i64 = self.conn().query_row(
            &format!("SELECT COUNT(*) FROM job WHERE {SHEET}"),
            [],
            |r| r.get(0),
        )?;
        Ok(u64::try_from(count).unwrap_or(0))
    }

    /// Revision a job was scored with (tests and checks).
    pub fn match_rev(&self, key: &JobKey) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT match_rev FROM job WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::test_support::{mail, now, posting};

    fn store_with_job() -> (Store, JobKey) {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let p = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        store.upsert_posting(run, &p, mail(), now()).unwrap();
        (store, p.key)
    }

    fn record(status: MatchStatus, score: u8) -> MatchRecord {
        MatchRecord {
            status,
            score,
            note: Some(Notice {
                code: "fewMust".into(),
                params: serde_json::Map::new(),
            }),
            must_met: 2,
            must_total: 3,
            top: vec!["SAP FI".into(), "x".repeat(500), "dritter".into()],
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        }
    }

    /// The note of a record with these open must requirements and no terms.
    fn note(record: &MatchRecord, open: &[String]) -> String {
        encode_note(&Judgement {
            record: record.clone(),
            open: open.to_vec(),
            terms: Vec::new(),
        })
    }

    #[test]
    fn the_read_mark() {
        let (store, key) = store_with_job();
        let rev = store.data_rev().unwrap();
        assert!(store.mark_read(&key, now()).unwrap());
        assert!(!store.mark_read(&key, now()).unwrap(), "only once");
        assert_eq!(store.data_rev().unwrap(), rev, "no change counter");
        assert!(store.job(&key).unwrap().unwrap().read_at.is_some());
    }

    #[test]
    fn matches_round_trip_and_notes_stay_small() {
        let (store, key) = store_with_job();
        assert_eq!(store.match_pending("r1").unwrap(), 1);
        let scored = record(MatchStatus::Scored, 83);
        store
            .save_matches(&[(key.clone(), scored.clone())], "r1", now())
            .unwrap();
        assert_eq!(store.match_pending("r1").unwrap(), 0);
        assert_eq!(store.match_pending("r2").unwrap(), 1);
        let back = store.job(&key).unwrap().unwrap().match_.unwrap();
        assert_eq!((back.status, back.score), (MatchStatus::Scored, 83));
        assert_eq!(back.note, scored.note);
        assert_eq!(back.top.len(), 2);
        assert!(back.top[1].chars().count() <= MAX_TOP_CHARS);
        assert!(note(&scored, &[]).len() <= MAX_NOTE_BYTES);
        let mut huge = scored;
        huge.note
            .as_mut()
            .unwrap()
            .params
            .insert("x".into(), "y".repeat(600).into());
        assert!(note(&huge, &[]).len() <= MAX_NOTE_BYTES);
        // The key facts come back; the note keeps them without null values.
        let mut with_facts = record(MatchStatus::Scored, 83);
        with_facts.facts = crate::model::KeyFacts {
            rate: Some(1100),
            hourly: Some(false),
            start: Some("now".into()),
            months: Some(6),
            remote_from: Some(60),
            remote_to: Some(60),
            contract: Some("interim".into()),
            ..crate::model::KeyFacts::default()
        };
        let json = note(&with_facts, &[]);
        assert!(
            json.len() <= MAX_NOTE_BYTES && !json.contains("null"),
            "{json}"
        );
        let back = decode_match(Some("scored"), Some(83), Some(&json))
            .unwrap()
            .0;
        assert_eq!(back.facts, with_facts.facts);
        // The rank (tie-breaker of equal scores) comes back.
        let mut ranked = record(MatchStatus::Scored, 40);
        ranked.rank = 437;
        let json = note(&ranked, &[]);
        assert_eq!(
            decode_match(Some("scored"), Some(40), Some(&json))
                .unwrap()
                .0
                .rank,
            437
        );
        // Open must requirements come back, at most two, and go first when the note is full.
        let open = [
            "Power BI".to_owned(),
            "Zollabwicklung".into(),
            "drittes".into(),
        ];
        let json = note(&ranked, &open);
        let (_, back) = decode_match(Some("scored"), Some(40), Some(&json)).unwrap();
        assert_eq!(back, ["Power BI", "Zollabwicklung"]);
        // A full note drops the open quotes first, then the terms from the last (the nice
        // ones come last), and keeps the met quotes and the facts.
        let mut full = record(MatchStatus::Scored, 40);
        full.top = vec!["ü".repeat(200); 2];
        full.facts = with_facts.facts.clone();
        let terms: Vec<String> = (0..8).map(|i| format!("{i}{}", "ä".repeat(60))).collect();
        let json = encode_note(&Judgement {
            record: full,
            open: vec!["ö".repeat(200); 2],
            terms: terms.clone(),
        });
        assert!(json.len() <= MAX_NOTE_BYTES, "{}", json.len());
        let (kept, open) = decode_match(Some("scored"), Some(40), Some(&json)).unwrap();
        let left = note_terms(&json);
        assert!(open.is_empty() && kept.top.len() == 2, "{json}");
        assert!(!left.is_empty() && left.len() < 8, "{json}");
        assert_eq!(left, terms[..left.len()], "the first terms stay");
        assert_eq!(kept.facts, with_facts.facts, "the facts stay");
        // A note of an earlier version has none, neither open quotes nor terms.
        let old = r#"{"code":null,"params":{},"mustMet":1,"mustTotal":2,"top":["A"]}"#;
        assert!(
            decode_match(Some("scored"), Some(40), Some(old))
                .unwrap()
                .1
                .is_empty()
        );
        assert!(note_terms(old).is_empty());
        assert!(note_terms("no json").is_empty());
        // A new text or title makes the job pending again.
        store
            .record_text(&key, "Volltext", false, false, now())
            .unwrap();
        assert_eq!(store.match_rev(&key).unwrap(), None);
        assert_eq!(store.unscored("r1", 10, 0).unwrap().len(), 1);
        assert!(store.unscored("r1", 10, 1).unwrap().is_empty());
    }

    /// The reader stores its fresh score only over the one it read: a run that scored the
    /// job in between keeps its score.
    #[test]
    fn a_fresh_score_only_replaces_the_one_it_read() {
        let (store, key) = store_with_job();
        let run = record(MatchStatus::Scored, 70);
        store
            .save_matches(&[(key.clone(), run.clone())], "r2", now())
            .unwrap();
        let stale = record(MatchStatus::Scored, 10);
        assert!(
            !store
                .save_match_if(&key, &stale.clone().into(), "r1", None, now())
                .unwrap()
        );
        let job = store.job(&key).unwrap().unwrap();
        assert_eq!(
            (job.match_.unwrap().score, job.match_rev.unwrap()),
            (70, "r2".into())
        );
        assert!(
            store
                .save_match_if(&key, &stale.clone().into(), "r3", Some("r2"), now())
                .unwrap()
        );
        assert_eq!(store.match_rev(&key).unwrap().as_deref(), Some("r3"));
    }

    #[test]
    fn match_times_and_clearing() {
        let (store, key) = store_with_job();
        assert_eq!(store.scored_at("r1").unwrap(), None);
        assert_eq!(store.match_at(&key).unwrap(), None);
        assert!(!store.has_matches().unwrap());
        store
            .save_matches(
                &[(key.clone(), record(MatchStatus::Scored, 70))],
                "r1",
                now(),
            )
            .unwrap();
        let at = store.match_at(&key).unwrap().unwrap();
        assert_eq!(at.as_second(), now().as_second());
        assert_eq!(store.scored_at("r1").unwrap(), Some(at));
        assert_eq!(store.scored_at("r2").unwrap(), None);
        assert!(store.has_matches().unwrap());
        let rev = store.data_rev().unwrap();
        assert_eq!(store.clear_matches().unwrap(), 1);
        assert!(!store.has_matches().unwrap());
        assert!(store.data_rev().unwrap() > rev, "the export changes");
        let job = store.job(&key).unwrap().unwrap();
        assert!(job.match_.is_none() && job.match_rev.is_none());
        assert_eq!(store.match_at(&key).unwrap(), None);
        assert_eq!(store.clear_matches().unwrap(), 0, "nothing left");
    }
}
