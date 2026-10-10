//! Table layout: one schema, no migration. An empty database gets the tables of
//! [`SCHEMA_VERSION`]; a database of any other schema is refused as one that does not read
//! (`Corrupt`), on a connection that only reads, before anything is written.

use std::path::Path;

use rusqlite::{Connection, OpenFlags};

use crate::error::{Error, Result};

pub(super) const SCHEMA_VERSION: i64 = 8;

/// The tables of schema 8. Timestamps are Unix seconds. The columns of `job` beyond the
/// mail's and the page's:
///
/// - `match_score` (0-100), `match_status` (`scored`, `excluded`, `unscorable`),
///   `match_note` (JSON `{code, params, mustMet, mustTotal, top[<=2], open[<=2], terms[<=8],
///   facts, rank}`, at most 1024 bytes), `match_at`, `match_rev` (engine, profile and model
///   that scored it; `NULL` after a change of title or text: scored again);
/// - `read_at` (`NULL` = unread), `desc_facts` (the facts of the job page), `dup_of`
///   (`portal:id` of the job this one duplicates), `parser_version` (the page parser of the
///   full text), `mail_version` (the mail parser of title, company and location);
/// - the user's marks: `archived_at`, `trashed_at` (it wins over the archive), `inbox_at`
///   (when the user last moved it into the inbox), `override_include` (`1` = fits anyway);
/// - how it came: `mailed_at` (an alert mail last named it), `searched_at` (the search last
///   found it); both can be set.
///
/// `tombstone` keeps the keys of jobs deleted for good, so a later scan of an old alert mail
/// never brings them back.
const SCHEMA: &str = "
CREATE TABLE job (
    portal            TEXT    NOT NULL,
    job_id            TEXT    NOT NULL,
    url               TEXT    NOT NULL,
    title             TEXT    NOT NULL,
    company           TEXT    NOT NULL,
    location          TEXT    NOT NULL,
    mail_date         INTEGER,
    mail_subject      TEXT    NOT NULL,
    gmail_id          TEXT,
    first_seen_at     INTEGER NOT NULL,
    first_seen_run    INTEGER NOT NULL,
    last_seen_run     INTEGER NOT NULL,
    desc_status       TEXT    NOT NULL DEFAULT 'missing',
    desc_short        INTEGER NOT NULL DEFAULT 0,
    desc_closed       INTEGER NOT NULL DEFAULT 0,
    desc_text         TEXT,
    desc_fetched_at   INTEGER,
    desc_attempted_at INTEGER,
    desc_attempts     INTEGER NOT NULL DEFAULT 0,
    desc_error        TEXT,
    search            TEXT    NOT NULL,
    match_score       INTEGER,
    match_status      TEXT,
    match_note        TEXT,
    match_at          INTEGER,
    match_rev         TEXT,
    read_at           INTEGER,
    desc_facts        TEXT,
    dup_of            TEXT,
    parser_version    INTEGER,
    archived_at       INTEGER,
    override_include  INTEGER,
    mail_version      INTEGER,
    trashed_at        INTEGER,
    inbox_at          INTEGER,
    mailed_at         INTEGER,
    searched_at       INTEGER,
    PRIMARY KEY (portal, job_id)
) WITHOUT ROWID;
CREATE INDEX job_by_run ON job (first_seen_run);
CREATE INDEX job_by_date ON job (COALESCE(mail_date, first_seen_at));
CREATE TABLE alert_mail (
    mail_key       TEXT    PRIMARY KEY,
    portal         TEXT    NOT NULL,
    subject        TEXT    NOT NULL,
    mail_date      INTEGER,
    gmail_id       TEXT,
    n_postings     INTEGER NOT NULL,
    last_seen_run  INTEGER NOT NULL
) WITHOUT ROWID;
CREATE INDEX alert_by_portal ON alert_mail (portal, mail_date);
CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE tombstone (
    portal      TEXT    NOT NULL,
    job_id      TEXT    NOT NULL,
    deleted_at  INTEGER NOT NULL,
    PRIMARY KEY (portal, job_id)
) WITHOUT ROWID;
";

/// Creates the tables in an empty database, accepts a current one and refuses the others
/// ([`check`]).
pub(super) fn create(conn: &Connection) -> Result<()> {
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    check(version)?;
    if version == 0 {
        // Tables and version number in one transaction: a crash in between would
        // otherwise leave tables with version 0, and every later start would fail.
        conn.execute_batch(&format!(
            "BEGIN IMMEDIATE; {SCHEMA} PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;"
        ))?;
    }
    Ok(())
}

/// Accepts an empty (0) or the current schema and refuses any other.
fn check(version: i64) -> Result<()> {
    match version {
        0 | SCHEMA_VERSION => Ok(()),
        other => Err(Error::Corrupt(format!(
            "database schema {other}, this build reads {SCHEMA_VERSION}"
        ))),
    }
}

/// The schema of the database file at `path`, read on a connection that only reads (`None`:
/// no file).
fn probe(path: &Path) -> Result<Option<i64>> {
    if !path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    Ok(Some(version))
}

/// Refuses the database file at `path` before a connection that writes opens it (one that
/// switches to WAL writes at once): one of another schema ([`check`]) stays untouched.
pub(super) fn refuse_foreign(path: &Path) -> Result<()> {
    match probe(path)? {
        Some(version) => check(version),
        None => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;

    use super::*;
    use crate::store::Store;
    use crate::store::test_support::{mail, now, posting};

    fn version(conn: &Connection) -> i64 {
        conn.pragma_query_value(None, "user_version", |r| r.get(0))
            .unwrap()
    }

    #[test]
    fn schema_is_created_once_and_reopened() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("jobs.db");
        let store = Store::open(&path).unwrap();
        let run = store.begin_run().unwrap();
        store
            .upsert_posting(
                run,
                &posting(
                    "https://www.linkedin.com/jobs/view/4123456789/",
                    "A",
                    "",
                    "",
                ),
                mail(),
                now(),
            )
            .unwrap();
        assert_eq!(version(&store.conn()), SCHEMA_VERSION);
        drop(store);
        let again = Store::open(&path).unwrap();
        assert_eq!(again.job_count().unwrap(), 1);
        assert_eq!(again.begin_run().unwrap(), 2);
    }

    /// A database of any other schema does not read and is never written; the load error
    /// says so.
    #[test]
    fn another_schema_is_refused_and_never_written() {
        for other in [SCHEMA_VERSION - 1, SCHEMA_VERSION + 1] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("jobs.db");
            Connection::open(&path)
                .unwrap()
                .pragma_update(None, "user_version", other)
                .unwrap();
            let before = std::fs::read(&path).unwrap();
            let error = Store::open(&path).err().expect("refused");
            assert!(matches!(error, Error::Corrupt(_)), "{other}: {error}");
            assert_eq!(std::fs::read(&path).unwrap(), before, "never written");
            assert!(
                !dir.path().join("jobs.db-wal").exists(),
                "never switched to WAL"
            );
        }
    }

    /// A file database runs in WAL mode.
    #[test]
    fn a_file_database_uses_wal() {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("jobs.db")).unwrap();
        let mode: String = store
            .conn()
            .pragma_query_value(None, "journal_mode", |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
        assert!(
            !dir.path().join("backups").exists(),
            "a new database needs no copy"
        );
    }
}
