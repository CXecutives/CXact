//! Copies of the database in `backups/` next to it - in the data folder, never in the work
//! folder: the marks, tombstones, overrides and old texts it holds come back from no fetch.
//! One copy before every migration (`jobs.pre-v4.db`: the database as schema 4 left it), one
//! a day (`jobs-2026-09-25.db`, local date) and one before every restore
//! (`jobs.before-restore-20260926-081530-123.db`, UTC to the millisecond, so the names sort
//! across a change of the clocks), a few of each kept. `VACUUM INTO` writes a consistent,
//! compact copy while the app keeps working; it goes to a temporary name first, so a copy
//! that was cut off never looks like one. The dry run (in memory) has none, and the reset
//! of everything deletes the folder (`reset.rs`).
//!
//! A restore ("Sicherung wiederherstellen") reads the chosen copy into memory, checks it and
//! brings it to the current schema there, copies the database as it is now into the folder
//! (its undo), then replaces the database's content with `SQLite`'s backup API in one
//! transaction on the app's own connection: it is the old database or the restored one,
//! never a mix, and any failure before the end leaves the current one as it was. What
//! belongs to the app rather than to the jobs stays as it is now: the settings, the stamps of
//! the files the app wrote in the work folder, and a change counter above both, so the files
//! follow the restored jobs.

use std::path::{Path, PathBuf};

use jiff::civil::Date;
use jiff::tz::TimeZone;
use jiff::{SignedDuration, Timestamp};
use rusqlite::backup::StepResult;
use rusqlite::{Connection, OpenFlags, params};
use serde::Serialize;

use super::{jobs, kv_get_i64, kv_set, schema};
use crate::error::{Error, Result};

/// The folder of the copies, next to the database.
pub const BACKUP_DIR: &str = "backups";
/// Daily copies kept.
const DAILY_KEPT: usize = 3;
/// Copies from before a migration kept.
const MIGRATION_KEPT: usize = 3;
/// Copies from before a restore kept.
const RESTORE_KEPT: usize = 3;
/// Name parts of the copies.
const DAILY_PREFIX: &str = "jobs-";
const MIGRATION_PREFIX: &str = "jobs.pre-v";
const RESTORE_PREFIX: &str = "jobs.before-restore-";
const SUFFIX: &str = ".db";
/// A copy while it is written.
const PARTIAL: &str = ".partial";
/// The moment in the name of a copy before a restore (UTC; the milliseconds follow).
const RESTORE_STAMP: &str = "%Y%m%d-%H%M%S";

/// A copy of the database the user can go back to.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Backup {
    /// Its file name in `backups/`, the only name a restore takes.
    pub id: String,
    pub kind: BackupKind,
    /// When it was written.
    pub at: Timestamp,
    pub bytes: u64,
}

/// Why a copy was made.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum BackupKind {
    /// The copy of a day.
    Daily,
    /// Before an update of the app changed the database's layout.
    Update,
    /// The state a restore replaced (restoring it undoes that restore).
    Restore,
}

/// The folder of the copies of the database at `db`.
pub fn backup_dir(db: &Path) -> PathBuf {
    db.parent().unwrap_or(Path::new(".")).join(BACKUP_DIR)
}

/// Before a migration from `version`: a copy of the database as that schema left it. A copy
/// from an earlier attempt at the same step stays (it is the same schema). `None` if there
/// was one already.
pub(super) fn before_migration(
    conn: &Connection,
    db: &Path,
    version: i64,
) -> Result<Option<PathBuf>> {
    let dir = backup_dir(db);
    let target = dir.join(format!("{MIGRATION_PREFIX}{version}{SUFFIX}"));
    if target.exists() {
        return Ok(None);
    }
    copy(conn, &target)?;
    prune(&dir, MIGRATION_KEPT, migration_version);
    Ok(Some(target))
}

/// The copy of the day `today` (local), unless there is one: through a connection of its
/// own, so the app's connection is never held while it writes. `None` if the day has its
/// copy already.
pub(super) fn daily(db: &Path, today: Date) -> Result<Option<PathBuf>> {
    let dir = backup_dir(db);
    let target = dir.join(format!("{DAILY_PREFIX}{today}{SUFFIX}"));
    if target.exists() {
        return Ok(None);
    }
    let conn = Connection::open(db)?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    copy(&conn, &target)?;
    prune(&dir, DAILY_KEPT, daily_date);
    Ok(Some(target))
}

/// The copies of the database at `db`, newest first: every kind, each with the time it was
/// written (its file's) and its size. Other files in the folder are no copies.
pub(super) fn list(db: &Path) -> Result<Vec<Backup>> {
    let dir = backup_dir(db);
    let entries = match std::fs::read_dir(&dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(e) => return Err(Error::io(&dir, e)),
    };
    let mut copies: Vec<Backup> = entries
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| described(&entry.path()))
        .collect();
    copies.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| b.id.cmp(&a.id)));
    Ok(copies)
}

/// The copy at `path`, if it is one.
fn described(path: &Path) -> Option<Backup> {
    let id = path.file_name()?.to_str()?.to_owned();
    let kind = kind_of(&id)?;
    let meta = std::fs::metadata(path)
        .ok()
        .filter(std::fs::Metadata::is_file)?;
    let at = Timestamp::try_from(meta.modified().ok()?).ok()?;
    Some(Backup {
        id,
        kind,
        at,
        bytes: meta.len(),
    })
}

/// What a copy's name says it is; `None` for any other name (never a path: the three
/// patterns take no separator).
fn kind_of(name: &str) -> Option<BackupKind> {
    if daily_date(name).is_some() {
        Some(BackupKind::Daily)
    } else if migration_version(name).is_some() {
        Some(BackupKind::Update)
    } else if restore_stamp(name).is_some() {
        Some(BackupKind::Restore)
    } else {
        None
    }
}

/// Replaces the content of the database at `db` (the app's connection `conn`) with its copy
/// `id`; returns the copy of the state it replaced, written first. The chosen copy is checked
/// and brought to the current schema in memory before anything changes: one that is gone is
/// `BackupMissing`, one that is no readable database of this app `BackupCorrupt`, one of a
/// newer app `NewerSchema`, and the database stays as it was.
pub(super) fn restore(
    conn: &mut Connection,
    db: &Path,
    id: &str,
    now: Timestamp,
) -> Result<Backup> {
    let staged = stage(db, id)?;
    let before = before_restore(conn, db, now)?;
    keep_app_state(conn, &staged)?;
    replace(&staged, conn)?;
    Ok(before)
}

/// The copy `id` in memory, checked and at the current schema.
fn stage(db: &Path, id: &str) -> Result<Connection> {
    let missing = || Error::BackupMissing(id.to_owned());
    if kind_of(id).is_none() {
        return Err(missing());
    }
    let path = backup_dir(db).join(id);
    if !path.is_file() {
        return Err(missing());
    }
    let corrupt = |detail: String| Error::BackupCorrupt {
        name: id.to_owned(),
        detail,
    };
    let source = Connection::open_with_flags(
        &path,
        OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(|e| corrupt(e.to_string()))?;
    // A file that is no database fails here already ("file is not a database").
    let check: String = source
        .query_row("PRAGMA quick_check", [], |r| r.get(0))
        .map_err(|e| corrupt(e.to_string()))?;
    if check != "ok" {
        return Err(corrupt(check));
    }
    let version: i64 = source
        .pragma_query_value(None, "user_version", |r| r.get(0))
        .map_err(|e| corrupt(e.to_string()))?;
    if version > schema::SCHEMA_VERSION {
        return Err(Error::NewerSchema(version));
    }
    if version < 1 {
        return Err(corrupt("no database of this app".to_owned()));
    }
    let mut staged = Connection::open_in_memory()?;
    replace(&source, &mut staged).map_err(|e| corrupt(e.to_string()))?;
    drop(source);
    schema::migrate(&staged).map_err(|e| match e {
        Error::NewerSchema(_) => e,
        other => corrupt(other.to_string()),
    })?;
    jobs::refresh_all_searches(&staged).map_err(|e| corrupt(e.to_string()))?;
    Ok(staged)
}

/// Before a restore: the database as it is now, the newest three such copies kept.
fn before_restore(conn: &Connection, db: &Path, now: Timestamp) -> Result<Backup> {
    let dir = backup_dir(db);
    // A name of its own, also for two restores within a millisecond.
    let mut target = dir.join(restore_name(now));
    let mut at = now;
    while target.exists() {
        at = at
            .checked_add(SignedDuration::from_millis(1))
            .map_err(|e| Error::Corrupt(format!("backup name: {e}")))?;
        target = dir.join(restore_name(at));
    }
    copy(conn, &target)?;
    prune(&dir, RESTORE_KEPT, restore_stamp);
    described(&target).ok_or_else(|| Error::Corrupt(format!("backup {}", target.display())))
}

/// What stays as it is now through a restore, written into the staged copy: the settings
/// (the app's choices, not the jobs; the work folder and with it the profile stay) and a
/// change counter above both databases'.
fn keep_app_state(live: &Connection, staged: &Connection) -> Result<()> {
    let settings = crate::settings::KEY;
    let kept: Vec<(String, String)> = live
        .prepare("SELECT key, value FROM kv WHERE key = ?1")?
        .query_map(params![settings], |r| Ok((r.get(0)?, r.get(1)?)))?
        .collect::<rusqlite::Result<_>>()?;
    let rev = kv_get_i64(live, "data_rev")?
        .unwrap_or(0)
        .max(kv_get_i64(staged, "data_rev")?.unwrap_or(0))
        + 1;
    let tx = staged.unchecked_transaction()?;
    tx.execute("DELETE FROM kv WHERE key = ?1", params![settings])?;
    for (key, value) in &kept {
        kv_set(&tx, key, value)?;
    }
    kv_set(&tx, "data_rev", &rev.to_string())?;
    tx.commit()?;
    Ok(())
}

/// The whole content of `from` into `to`, in one step: `SQLite` writes it as one transaction
/// of `to`, which it rolls back when the step fails.
fn replace(from: &Connection, to: &mut Connection) -> Result<()> {
    let copy = rusqlite::backup::Backup::new(from, to)?;
    match copy.step(-1)? {
        StepResult::Done => Ok(()),
        // Another connection holds a lock (the daily copy): nothing was written.
        _ => Err(rusqlite::Error::SqliteFailure(
            rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_BUSY),
            Some("database busy during a restore".to_owned()),
        )
        .into()),
    }
}

/// The name of the copy before a restore at `at`.
fn restore_name(at: Timestamp) -> String {
    format!(
        "{RESTORE_PREFIX}{}-{:03}{SUFFIX}",
        at.to_zoned(TimeZone::UTC).strftime(RESTORE_STAMP),
        at.subsec_millisecond()
    )
}

/// `VACUUM INTO` a temporary name, then the real one.
fn copy(conn: &Connection, target: &Path) -> Result<()> {
    let dir = target.parent().unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir).map_err(|e| Error::io(dir, e))?;
    let mut partial = target.as_os_str().to_owned();
    partial.push(PARTIAL);
    let partial = PathBuf::from(partial);
    // A copy cut off before: VACUUM INTO writes only into a missing or empty file.
    match std::fs::remove_file(&partial) {
        Ok(()) => {}
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(Error::io(&partial, e)),
    }
    let name = partial
        .to_str()
        .ok_or_else(|| Error::Corrupt(format!("backup path {}", partial.display())))?;
    if let Err(e) = conn.execute("VACUUM INTO ?1", [name]) {
        let _ = std::fs::remove_file(&partial);
        return Err(e.into());
    }
    std::fs::rename(&partial, target).map_err(|e| Error::io(target, e))
}

/// Keeps the `kept` newest copies of one kind in `dir` (newest by `order`, a name that is no
/// copy of this kind has none), deletes the older ones and the copies of this kind that were
/// cut off before (the app ended while it wrote one; only a copy of the same day or schema
/// would replace it). A failure only goes to the log.
fn prune<K: Ord>(dir: &Path, kept: usize, order: impl Fn(&str) -> Option<K>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut copies: Vec<(K, PathBuf)> = Vec::new();
    let mut old: Vec<PathBuf> = Vec::new();
    for entry in entries.filter_map(std::result::Result::ok) {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if let Some(key) = order(name) {
            copies.push((key, entry.path()));
        } else if name.strip_suffix(PARTIAL).and_then(&order).is_some() {
            old.push(entry.path());
        }
    }
    copies.sort_by(|a, b| b.0.cmp(&a.0));
    old.extend(copies.into_iter().skip(kept).map(|(_, path)| path));
    for path in old {
        if let Err(e) = std::fs::remove_file(&path) {
            log::warn!("old database copy {} not deleted: {e}", path.display());
        }
    }
}

/// The day of a daily copy's name.
fn daily_date(name: &str) -> Option<Date> {
    name.strip_prefix(DAILY_PREFIX)?
        .strip_suffix(SUFFIX)?
        .parse()
        .ok()
}

/// The schema of a migration copy's name.
fn migration_version(name: &str) -> Option<i64> {
    name.strip_prefix(MIGRATION_PREFIX)?
        .strip_suffix(SUFFIX)?
        .parse()
        .ok()
}

/// The moment of a copy before a restore, as its name writes it (`20260926-081530-123`,
/// which sorts like the moment).
fn restore_stamp(name: &str) -> Option<String> {
    let stamp = name.strip_prefix(RESTORE_PREFIX)?.strip_suffix(SUFFIX)?;
    let shape = stamp.len() == 19
        && stamp.char_indices().all(|(i, c)| {
            if i == 8 || i == 15 {
                c == '-'
            } else {
                c.is_ascii_digit()
            }
        });
    shape.then(|| stamp.to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn day(text: &str) -> Date {
        text.parse().unwrap()
    }

    /// The `marker` of a copy, read without changing it.
    fn marker(copy: &Path) -> Option<String> {
        Connection::open(copy)
            .unwrap()
            .query_row("SELECT value FROM kv WHERE key = 'marker'", [], |r| {
                r.get(0)
            })
            .ok()
    }

    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .collect();
        names.sort();
        names
    }

    /// One copy a day, a readable database with the jobs of the day; the three newest days
    /// stay, other files in the folder too.
    #[test]
    fn a_copy_a_day_and_three_kept() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("jobs.db");
        let store = Store::open(&db).unwrap();
        store.kv_set("marker", "eins").unwrap();
        let first = store.backup_daily(day("2026-09-20")).unwrap().unwrap();
        assert_eq!(
            first,
            root.path().join("backups").join("jobs-2026-09-20.db")
        );
        assert_eq!(
            store.backup_daily(day("2026-09-20")).unwrap(),
            None,
            "once a day"
        );
        assert_eq!(marker(&first).as_deref(), Some("eins"));
        std::fs::write(backup_dir(&db).join("notes.txt"), b"mine").unwrap();
        for date in ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-24"] {
            store.backup_daily(day(date)).unwrap().unwrap();
        }
        assert_eq!(
            names(&backup_dir(&db)),
            [
                "jobs-2026-09-22.db",
                "jobs-2026-09-23.db",
                "jobs-2026-09-24.db",
                "notes.txt"
            ]
        );
    }

    /// The dry run keeps no copy: its database lives in memory only.
    #[test]
    fn a_database_in_memory_has_no_copy() {
        let store = Store::in_memory().unwrap();
        assert_eq!(store.backup_daily(day("2026-09-20")).unwrap(), None);
    }

    /// A copy that was cut off is written again, never taken for a copy; one of an earlier
    /// day, which no copy replaces, goes with the next copy. Other files stay.
    #[test]
    fn a_cut_off_copy_is_replaced() {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("jobs.db");
        let store = Store::open(&db).unwrap();
        store.kv_set("marker", "ganz").unwrap();
        let dir = backup_dir(&db);
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("jobs-2026-09-20.db.partial"), b"halb").unwrap();
        let copy = store.backup_daily(day("2026-09-20")).unwrap().unwrap();
        assert_eq!(marker(&copy).as_deref(), Some("ganz"));
        assert_eq!(names(&dir), ["jobs-2026-09-20.db"]);

        std::fs::write(dir.join("jobs-2026-09-18.db.partial"), b"halb").unwrap();
        std::fs::write(dir.join("notes.partial"), b"mine").unwrap();
        store.backup_daily(day("2026-09-21")).unwrap().unwrap();
        assert_eq!(
            names(&dir),
            ["jobs-2026-09-20.db", "jobs-2026-09-21.db", "notes.partial"]
        );
    }

    #[test]
    fn copy_names_are_read_back() {
        assert_eq!(daily_date("jobs-2026-09-20.db"), Some(day("2026-09-20")));
        assert_eq!(daily_date("jobs-2026-09-20.db.partial"), None);
        assert_eq!(daily_date("jobs.pre-v4.db"), None);
        assert_eq!(migration_version("jobs.pre-v4.db"), Some(4));
        assert_eq!(migration_version("jobs.pre-v12.db"), Some(12));
        assert_eq!(migration_version("jobs-2026-09-20.db"), None);
        let stamp: Timestamp = "2026-09-26T08:15:30.123Z".parse().unwrap();
        assert_eq!(
            restore_name(stamp),
            "jobs.before-restore-20260926-081530-123.db"
        );
        assert_eq!(
            restore_stamp(&restore_name(stamp)).as_deref(),
            Some("20260926-081530-123")
        );
        for name in [
            "jobs.before-restore-20260926-081530.db",
            "jobs.before-restore-20260926-081530-12a.db",
            "jobs.before-restore-../../jobs.db",
            "jobs.db",
        ] {
            assert_eq!(kind_of(name), None, "{name}");
        }
        assert_eq!(kind_of("jobs-2026-09-20.db"), Some(BackupKind::Daily));
        assert_eq!(kind_of("jobs.pre-v4.db"), Some(BackupKind::Update));
    }

    // ------------------------------------------------------------------ Restore

    use crate::error::{ErrorInfo, ErrorKind};
    use crate::store::test_support::{mail, now, posting};

    /// A data folder with a database of one job and the marker `old`, its copy of the day,
    /// then a second job, the marker `new` and other settings: the state a restore replaces.
    struct Folder {
        _root: tempfile::TempDir,
        db: PathBuf,
        store: Store,
        copy: String,
    }

    fn job(store: &Store, id: &str) {
        let run = store.begin_run().unwrap();
        let url = format!("https://www.linkedin.com/jobs/view/{id}/");
        let posting = posting(&url, "Interim CFO", "Nordlicht AG", "Hamburg");
        store.upsert_posting(run, &posting, mail(), now()).unwrap();
    }

    fn folder() -> Folder {
        let root = tempfile::tempdir().unwrap();
        let db = root.path().join("jobs.db");
        let store = Store::open(&db).unwrap();
        job(&store, "4123456789");
        store.kv_set("marker", "old").unwrap();
        store
            .kv_set(crate::settings::KEY, r#"{"language":"de"}"#)
            .unwrap();
        let copy = store.backup_daily(day("2026-09-20")).unwrap().unwrap();
        job(&store, "4123456790");
        store.kv_set("marker", "new").unwrap();
        store
            .kv_set(crate::settings::KEY, r#"{"language":"en"}"#)
            .unwrap();
        let copy = copy.file_name().unwrap().to_str().unwrap().to_owned();
        Folder {
            _root: root,
            db,
            store,
            copy,
        }
    }

    fn state(store: &Store) -> (i64, Option<String>) {
        (store.job_count().unwrap(), store.kv_get("marker").unwrap())
    }

    fn at(text: &str) -> Timestamp {
        text.parse().unwrap()
    }

    /// The copy brings its jobs back; the state it replaced is a copy of its own first, and
    /// restoring that one undoes the restore. The settings stay, the change counter rises
    /// (the files follow), and the database is restored on disk, not only in the connection.
    #[test]
    fn a_restore_brings_the_old_rows_back_and_can_be_undone() {
        let f = folder();
        std::fs::write(backup_dir(&f.db).join("notes.txt"), b"mine").unwrap();
        let listed = f.store.backups().unwrap();
        assert_eq!(listed.len(), 1, "other files are no copies: {listed:?}");
        assert_eq!(
            (listed[0].id.as_str(), listed[0].kind),
            (f.copy.as_str(), BackupKind::Daily)
        );
        assert!(listed[0].bytes > 0);
        let rev = f.store.data_rev().unwrap();

        let before = f
            .store
            .restore_backup(&f.copy, at("2026-09-26T08:15:30.123Z"))
            .unwrap();
        assert_eq!(state(&f.store), (1, Some("old".to_owned())));
        assert_eq!(
            f.store.kv_get(crate::settings::KEY).unwrap().as_deref(),
            Some(r#"{"language":"en"}"#),
            "the settings stay as they are"
        );
        assert!(f.store.data_rev().unwrap() > rev);
        assert_eq!(before.id, "jobs.before-restore-20260926-081530-123.db");
        assert_eq!(before.kind, BackupKind::Restore);
        assert_eq!(
            marker(&backup_dir(&f.db).join(&before.id)).as_deref(),
            Some("new")
        );
        let listed: Vec<String> = f
            .store
            .backups()
            .unwrap()
            .into_iter()
            .map(|b| b.id)
            .collect();
        assert_eq!(listed.len(), 2);
        assert!(listed.contains(&before.id) && listed.contains(&f.copy));

        // It keeps working, and the next start reads the restored database.
        job(&f.store, "4123456791");
        assert_eq!(f.store.job_count().unwrap(), 2);
        let undo = f
            .store
            .restore_backup(&before.id, at("2026-09-26T08:15:40Z"))
            .unwrap();
        assert_eq!(state(&f.store), (2, Some("new".to_owned())));
        assert_eq!(undo.kind, BackupKind::Restore);
        drop(f.store);
        let again = Store::open(&f.db).unwrap();
        assert_eq!(state(&again), (2, Some("new".to_owned())));
    }

    /// A restore that fails at its last step (another connection holds the write lock)
    /// changes nothing: the jobs and the marker are the current ones.
    #[test]
    fn a_failed_restore_leaves_the_database_as_it_was() {
        let f = folder();
        f.store
            .conn()
            .busy_timeout(std::time::Duration::from_millis(50))
            .unwrap();
        let other = Connection::open(&f.db).unwrap();
        other.execute_batch("BEGIN IMMEDIATE").unwrap();
        let error = f
            .store
            .restore_backup(&f.copy, at("2026-09-26T08:15:30Z"))
            .unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Db, "{error}");
        // It failed at the very end: the copy of the current state was written already.
        let dir = backup_dir(&f.db);
        assert!(names(&dir).iter().any(|n| restore_stamp(n).is_some()));
        other.execute_batch("ROLLBACK").unwrap();
        drop(other);
        assert_eq!(state(&f.store), (2, Some("new".to_owned())));
        job(&f.store, "4123456791");
        assert_eq!(f.store.job_count().unwrap(), 3);
    }

    /// A copy that is no readable database of this app is refused with a code, before
    /// anything is written: a file of garbage, a cut-off copy, a database of another program,
    /// a copy of a newer app; a name that is no copy is not found.
    #[test]
    fn a_broken_backup_is_refused_with_a_code() {
        let f = folder();
        let dir = backup_dir(&f.db);
        let whole = std::fs::read(dir.join(&f.copy)).unwrap();
        std::fs::write(dir.join("jobs-2026-09-21.db"), b"no database at all").unwrap();
        std::fs::write(dir.join("jobs-2026-09-22.db"), &whole[..whole.len() / 2]).unwrap();
        Connection::open(dir.join("jobs-2026-09-23.db"))
            .unwrap()
            .execute_batch("CREATE TABLE notes (text TEXT)")
            .unwrap();
        std::fs::copy(dir.join(&f.copy), dir.join("jobs-2026-09-24.db")).unwrap();
        Connection::open(dir.join("jobs-2026-09-24.db"))
            .unwrap()
            .pragma_update(None, "user_version", 99)
            .unwrap();
        let files = names(&dir);
        for id in [
            "jobs-2026-09-21.db",
            "jobs-2026-09-22.db",
            "jobs-2026-09-23.db",
        ] {
            let error = f.store.restore_backup(id, now()).unwrap_err();
            assert!(
                matches!(error, Error::BackupCorrupt { .. }),
                "{id}: {error}"
            );
            let info = ErrorInfo::from(&error);
            assert_eq!(info.kind, ErrorKind::Corrupt);
            assert_eq!(info.params["what"], "backup");
            assert_eq!(info.params["name"], id);
        }
        let newer = f
            .store
            .restore_backup("jobs-2026-09-24.db", now())
            .unwrap_err();
        assert!(matches!(newer, Error::NewerSchema(99)), "{newer}");
        for id in ["jobs-2026-09-19.db", "../jobs.db", "jobs.db", ""] {
            let error = f.store.restore_backup(id, now()).unwrap_err();
            assert_eq!(ErrorInfo::from(&error).kind, ErrorKind::NotFound, "{id}");
        }
        assert_eq!(names(&dir), files, "no copy was written");
        assert_eq!(state(&f.store), (2, Some("new".to_owned())));
    }

    /// The dry run's database in memory has no copies and restores none.
    #[test]
    fn a_database_in_memory_lists_and_restores_nothing() {
        let store = Store::in_memory().unwrap();
        assert!(store.backups().unwrap().is_empty());
        assert!(matches!(
            store.restore_backup("jobs-2026-09-20.db", now()),
            Err(Error::BackupMissing(_))
        ));
    }
}
