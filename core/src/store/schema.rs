//! Table layout. An empty database gets the tables of [`SCHEMA_VERSION`]; a database from a
//! newer version is refused and left untouched. A database of an earlier version (schema 1
//! to 7) is never migrated: the start resets everything before it opens one
//! (`reset::reset_outdated`), so here it is refused (`OldSchema`). Both are refused on a
//! connection that only reads, before anything is written.

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

/// Accepts an empty (0) or current schema and refuses a newer one (`NewerSchema`) and one of
/// an earlier version (`OldSchema`).
fn check(version: i64) -> Result<()> {
    match version {
        0 | SCHEMA_VERSION => Ok(()),
        newer if newer > SCHEMA_VERSION => Err(Error::NewerSchema(newer)),
        older => Err(Error::OldSchema(older)),
    }
}

/// The schema of the database file at `path` with the connection that read it, which only
/// reads (`None`: no file).
fn probe(path: &Path) -> Result<Option<(i64, Connection)>> {
    if !path.is_file() {
        return Ok(None);
    }
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let version: i64 = conn.pragma_query_value(None, "user_version", |r| r.get(0))?;
    Ok(Some((version, conn)))
}

/// Refuses the database file at `path` before a connection that writes opens it (one that
/// switches to WAL writes at once): a newer or an earlier schema ([`check`]) stays untouched.
pub(super) fn refuse_foreign(path: &Path) -> Result<()> {
    match probe(path)? {
        Some((version, _)) => check(version),
        None => Ok(()),
    }
}

/// The schema of the database at `path` when an earlier version wrote it (1 to 7), with a
/// connection that only reads it: `None` for a missing, empty, current or newer one, and for
/// a file that is no readable database (opening it says so).
pub(super) fn outdated(path: &Path) -> Option<(i64, Connection)> {
    probe(path)
        .ok()
        .flatten()
        .filter(|(version, _)| (1..SCHEMA_VERSION).contains(version))
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

    #[test]
    fn newer_schema_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        Connection::open(&path)
            .unwrap()
            .pragma_update(None, "user_version", 99)
            .unwrap();
        let before = std::fs::read(&path).unwrap();
        // Not "corrupt" - otherwise someone would set a healthy database aside.
        assert!(matches!(Store::open(&path), Err(Error::NewerSchema(99))));
        assert_eq!(std::fs::read(&path).unwrap(), before, "never written");
        assert!(
            !dir.path().join("jobs.db-wal").exists(),
            "never switched to WAL"
        );
        assert_eq!(outdated(&path).map(|(v, _)| v), None);
    }

    /// A database of an earlier version is named by [`outdated`] (the start resets it) and
    /// never opened as it is.
    #[test]
    fn an_earlier_schema_is_named_and_refused() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("jobs.db");
        assert_eq!(outdated(&path).map(|(v, _)| v), None, "no database");
        Connection::open(&path)
            .unwrap()
            .pragma_update(None, "user_version", 7)
            .unwrap();
        assert_eq!(outdated(&path).map(|(v, _)| v), Some(7));
        let before = std::fs::read(&path).unwrap();
        assert!(matches!(Store::open(&path), Err(Error::OldSchema(7))));
        assert_eq!(std::fs::read(&path).unwrap(), before, "never written");
        assert!(
            !dir.path().join("jobs.db-wal").exists(),
            "never switched to WAL"
        );
        std::fs::remove_file(&path).unwrap();
        drop(Store::open(&path).unwrap());
        assert_eq!(outdated(&path).map(|(v, _)| v), None, "a current one");
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
