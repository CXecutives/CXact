//! "Daten exportieren" and "Daten importieren" (Einstellungen > Daten): the app's data in one
//! file, to take to another computer or to keep. The file is one JSON object in UTF-8
//! (`CXact-Daten-2026-09-27.json`), written compact with `format` first:
//!
//! ```json
//! {"format":"cxact-data","version":1,"app":"3.0.0","createdAt":"2026-09-27T08:15:30Z",
//!  "schema":12,
//!  "database":{"bytes":123456,"sha256":"<hex>","base64":"<the database file>"},
//!  "profile":{"bytes":2345,"sha256":"<hex>","base64":"<the profile file>"},
//!  "settings":{"portals":{...},"fetchRange":"sinceLast","exportExcel":true,...}}
//! ```
//!
//! - `database`: a consistent copy of `jobs.db` (`VACUUM INTO` through a connection of its
//!   own, like the copy of a day; the app keeps working), without what belongs to the computer
//!   that wrote it: the settings (they travel in `settings`), the window's place, the stamps of
//!   the files the app wrote in the work folder and the moment Gmail last accepted the mailbox
//!   there. `schema` is its schema version.
//! - `profile`: the profile file of the work folder byte for byte; `null` without one.
//! - `settings`: the settings (`settings.rs`) without the work folder, a path of that computer.
//! - Never in it: the Gmail app password (only in the keychain of the OS), the sign-ins at the
//!   portals (the storage of the session window), the portals' request counts (`policy.json`)
//!   and the log.
//!
//! An import checks the whole file before anything changes: a file that is no such export is
//! `Invalid(DataFileForeign)`, one of a newer format `DataFileNewer`, a damaged one (cut off, a
//! checksum that does not match, a database that does not read) `DataFileCorrupt`, a database
//! of a newer schema `NewerSchema`. Then the database as it is now is copied to
//! `backups/jobs.before-import-<UTC>.db` (the Sicherung dialog restores it), the file's profile
//! takes the place of the work folder's (which becomes its backup `beraterprofil.json.bak`; a
//! file without a profile leaves it), and the database's content is replaced in one
//! transaction like a restore: with the file's settings in this computer's work folder, and
//! what belongs to this computer kept. The scan state of the mailbox goes when the file's
//! account is not the one connected here (like another account in "Verbinden").

use std::io::Read as _;
use std::path::{Path, PathBuf};

use jiff::Timestamp;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use super::{GMAIL_ACCOUNT, MAILBOX_CHECKED, Store, backup, kv_get, kv_get_i64, kv_set};
use crate::error::{Error, InvalidInput, Result};
use crate::export::write_atomic;
use crate::profile;
use crate::settings::{self, Settings};

/// What the file says it is (`format`), and the version of its layout: a file of a newer
/// layout is refused (`DataFileNewer`), one of an older one read.
pub const FORMAT: &str = "cxact-data";
pub const VERSION: u64 = 1;
/// The extension of a data file (it is JSON).
pub const EXTENSION: &str = "json";

/// So much of the start of a file is read first: a file that does not start as a JSON object
/// is no data file, and is not read further (a picture or a video chosen by mistake).
const HEAD: u64 = 4096;
/// The byte order mark an editor may have put before the JSON.
const BOM: &[u8] = b"\xEF\xBB\xBF";
/// The key of the window's place (`window.rs`): the screens of this computer.
const WINDOW: &str = "window";

/// The keys of the key/value table that belong to the computer, not to the data (the
/// window's place, the stamps of the files in the work folder, the mailbox's last check):
/// never exported, and kept through an import. The settings travel in the file on their own.
fn local_keys(conn: &Connection) -> Result<Vec<(String, String)>> {
    let stamps = format!("{}%", crate::pipeline::EXPORT_STAMP);
    let rows = conn
        .prepare("SELECT key, value FROM kv WHERE key IN (?1, ?2) OR key LIKE ?3")?
        .query_map(params![WINDOW, MAILBOX_CHECKED, stamps], |r| {
            Ok((r.get(0)?, r.get(1)?))
        })?
        .collect::<rusqlite::Result<_>>()?;
    Ok(rows)
}

/// Deletes the keys of [`local_keys`] and the settings.
fn drop_local_keys(conn: &Connection) -> Result<()> {
    let stamps = format!("{}%", crate::pipeline::EXPORT_STAMP);
    conn.execute(
        "DELETE FROM kv WHERE key IN (?1, ?2, ?3) OR key LIKE ?4",
        params![WINDOW, MAILBOX_CHECKED, settings::KEY, stamps],
    )?;
    Ok(())
}

/// The file.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Bundle {
    format: String,
    version: u64,
    /// The app that wrote it (for the log; the layout is `version`).
    app: String,
    created_at: Timestamp,
    schema: i64,
    database: Blob,
    profile: Option<Blob>,
    settings: serde_json::Value,
}

/// A file in the bundle, with its size and checksum.
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Blob {
    bytes: u64,
    sha256: String,
    base64: String,
}

impl Blob {
    fn of(bytes: &[u8]) -> Blob {
        Blob {
            bytes: bytes.len() as u64,
            sha256: sha256(bytes),
            base64: base64::encode(bytes),
        }
    }

    /// The bytes, checked against size and checksum.
    fn open(&self, what: &str) -> Result<Vec<u8>> {
        let bytes = base64::decode(&self.base64)
            .ok_or_else(|| Error::DataFileCorrupt(format!("{what}: not base64")))?;
        if bytes.len() as u64 != self.bytes || sha256(&bytes) != self.sha256.to_ascii_lowercase() {
            return Err(Error::DataFileCorrupt(format!(
                "{what}: size or checksum does not match"
            )));
        }
        Ok(bytes)
    }
}

/// The start of a file as far as the import reads it before the whole: its format and
/// version (everything else is skipped, not held).
#[derive(Deserialize)]
struct Head {
    format: Option<String>,
    version: Option<u64>,
}

/// What an import did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DataImport {
    /// The copy of the database as it was before (the Sicherung dialog restores it).
    pub before: super::Backup,
    /// The file held a profile: it replaced the work folder's (which is its backup now).
    pub profile: bool,
}

impl Store {
    /// "Alle Daten exportieren": the database, the profile of `workspace` and the settings in
    /// one file at `target` (written to a temporary name first, so a file that was cut off
    /// never looks like one). Returns its size.
    pub fn export_data(&self, workspace: &Path, target: &Path, now: Timestamp) -> Result<u64> {
        let (schema, database) = self.snapshot()?;
        let profile_path = profile::profile_path(workspace);
        let profile = match std::fs::read(&profile_path) {
            Ok(bytes) => Some(Blob::of(&bytes)),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(Error::io(&profile_path, e)),
        };
        let bundle = Bundle {
            format: FORMAT.to_owned(),
            version: VERSION,
            app: env!("CARGO_PKG_VERSION").to_owned(),
            created_at: now,
            schema,
            database: Blob::of(&database),
            profile,
            settings: Settings::load(self)?.portable(),
        };
        drop(database);
        let json = serde_json::to_vec(&bundle)
            .map_err(|e| Error::Corrupt(format!("data file not written: {e}")))?;
        write_atomic(target, &json)?;
        Ok(json.len() as u64)
    }

    /// "Daten importieren": replaces the database, the profile of `workspace` and the settings
    /// with those of the file at `source` (see the module). `mailbox` is the account connected
    /// on this computer (none: the scan state stays; "Verbinden" decides). All or nothing: a
    /// failure leaves the database and the profile as they were (the copy of before may have
    /// been written).
    pub fn import_data(
        &self,
        workspace: &Path,
        source: &Path,
        mailbox: Option<&str>,
        now: Timestamp,
    ) -> Result<DataImport> {
        let Some(db) = &self.path else {
            return Err(Error::Corrupt("an import needs a database file".to_owned()));
        };
        let bundle = read(source)?;
        let profile = bundle
            .profile
            .as_ref()
            .map(|blob| blob.open("profile"))
            .transpose()?;
        let current = Settings::load(self)?;
        let settings = Settings::from_portable(&bundle.settings, current.workspace)
            .ok_or_else(|| Error::DataFileCorrupt("settings: no settings object".to_owned()))?;
        let staged = stage(&bundle.database.open("database")?, db)?;
        drop(bundle);

        let mut conn = self.conn();
        settle(&conn, &staged, &settings, mailbox)?;
        let before = backup::before_import(&conn, db, now)?;
        let undo = match &profile {
            Some(bytes) => Some(place_profile(workspace, bytes)?),
            None => None,
        };
        if let Err(e) = backup::replace(&staged, &mut conn) {
            if let Some(undo) = undo {
                undo.put_back(workspace);
            }
            return Err(e);
        }
        Ok(DataImport {
            before,
            profile: profile.is_some(),
        })
    }

    /// A consistent copy of the database without what belongs to this computer, and its
    /// schema: written by `VACUUM INTO` into a temporary folder next to it (through a
    /// connection of its own, so the app keeps working), then emptied of the local keys and
    /// compacted, so nothing of them stays in its free pages.
    fn snapshot(&self) -> Result<(i64, Vec<u8>)> {
        let folder = match &self.path {
            Some(db) => tempfile::Builder::new()
                .prefix(".export-")
                .tempdir_in(db.parent().unwrap_or(Path::new("."))),
            None => tempfile::tempdir(),
        }
        .map_err(|e| Error::io(std::env::temp_dir(), e))?;
        let copy = folder.path().join("jobs.db");
        let name = copy
            .to_str()
            .ok_or_else(|| Error::Corrupt(format!("export path {}", copy.display())))?;
        match &self.path {
            Some(db) => {
                let own = Connection::open(db)?;
                own.busy_timeout(std::time::Duration::from_secs(5))?;
                own.execute("VACUUM INTO ?1", [name])?;
            }
            None => {
                self.conn().execute("VACUUM INTO ?1", [name])?;
            }
        }
        let schema = {
            let conn = Connection::open(&copy)?;
            conn.pragma_update_and_check(None, "journal_mode", "DELETE", |_| Ok(()))?;
            drop_local_keys(&conn)?;
            conn.execute_batch("VACUUM")?;
            conn.pragma_query_value(None, "user_version", |r| r.get(0))?
        };
        let bytes = std::fs::read(&copy).map_err(|e| Error::io(&copy, e))?;
        Ok((schema, bytes))
    }
}

/// The file at `source`, checked as far as it can be without its database: a data file of
/// this app (a JSON object whose `format` says so), not of a newer layout, whole.
fn read(source: &Path) -> Result<Bundle> {
    let mut file = std::fs::File::open(source).map_err(|e| Error::io(source, e))?;
    let mut bytes = Vec::new();
    (&mut file)
        .take(HEAD)
        .read_to_end(&mut bytes)
        .map_err(|e| Error::io(source, e))?;
    if !json_object(&bytes) {
        return Err(InvalidInput::DataFileForeign.into());
    }
    file.read_to_end(&mut bytes)
        .map_err(|e| Error::io(source, e))?;
    parse(&bytes)
}

/// The text starts as a JSON object.
fn json_object(bytes: &[u8]) -> bool {
    let text = bytes.strip_prefix(BOM).unwrap_or(bytes);
    text.iter().find(|b| !b.is_ascii_whitespace()) == Some(&b'{')
}

/// A data file's bytes as a bundle (see [`read`]). A JSON text that does not read whole is
/// a damaged data file when it names the format (it was cut off), else a foreign file.
fn parse(bytes: &[u8]) -> Result<Bundle> {
    let bytes = bytes.strip_prefix(BOM).unwrap_or(bytes);
    if !json_object(bytes) {
        return Err(InvalidInput::DataFileForeign.into());
    }
    let head: Head = match serde_json::from_slice(bytes) {
        Ok(head) => head,
        Err(e) => {
            let mark = format!("\"{FORMAT}\"");
            return Err(if bytes.windows(mark.len()).any(|w| w == mark.as_bytes()) {
                Error::DataFileCorrupt(format!("not whole: {e}"))
            } else {
                InvalidInput::DataFileForeign.into()
            });
        }
    };
    if head.format.as_deref() != Some(FORMAT) {
        return Err(InvalidInput::DataFileForeign.into());
    }
    match head.version {
        Some(version) if version > VERSION => return Err(Error::DataFileNewer(version)),
        Some(_) => {}
        None => return Err(Error::DataFileCorrupt("no version".to_owned())),
    }
    serde_json::from_slice(bytes).map_err(|e| Error::DataFileCorrupt(e.to_string()))
}

/// The file's database in memory, checked and at the current schema: written to a temporary
/// folder next to `db` and read from there like a copy of `backups/`.
fn stage(database: &[u8], db: &Path) -> Result<Connection> {
    let folder = tempfile::Builder::new()
        .prefix(".import-")
        .tempdir_in(db.parent().unwrap_or(Path::new(".")))
        .map_err(|e| Error::io(db, e))?;
    let path = folder.path().join("jobs.db");
    std::fs::write(&path, database).map_err(|e| Error::io(&path, e))?;
    let staged = backup::stage_file(&path, &|detail| {
        Error::DataFileCorrupt(format!("database: {detail}"))
    })?;
    // The staged database is in memory: the file may go.
    drop(folder);
    Ok(staged)
}

/// Writes into the staged database what the import keeps or sets: this computer's keys from
/// `live`, the file's settings in this computer's work folder, a change counter above both
/// (the files are written anew) and, when the file's mailbox is not the one connected here,
/// no scan state (the next fetch reads the connected mailbox from its start).
fn settle(
    live: &Connection,
    staged: &Connection,
    settings: &Settings,
    mailbox: Option<&str>,
) -> Result<()> {
    let kept = local_keys(live)?;
    let rev = kv_get_i64(live, "data_rev")?
        .unwrap_or(0)
        .max(kv_get_i64(staged, "data_rev")?.unwrap_or(0))
        + 1;
    let account = kv_get(staged, GMAIL_ACCOUNT)?;
    let tx = staged.unchecked_transaction()?;
    drop_local_keys(&tx)?;
    for (key, value) in &kept {
        kv_set(&tx, key, value)?;
    }
    kv_set(&tx, settings::KEY, &settings.stored())?;
    if let Some(user) = mailbox
        && account.as_deref() != Some(user)
    {
        tx.execute(
            "DELETE FROM kv WHERE key LIKE 'last_scan:%' OR key = ?1",
            [GMAIL_ACCOUNT],
        )?;
    }
    kv_set(&tx, "data_rev", &rev.to_string())?;
    tx.commit()?;
    Ok(())
}

/// The profile and its backup as they were before an import placed the file's profile.
struct ProfileUndo {
    profile: Option<Vec<u8>>,
    backup: Option<Vec<u8>>,
}

impl ProfileUndo {
    /// Puts both back (the import failed after the profile was placed); a failure only goes to
    /// the log.
    fn put_back(self, workspace: &Path) {
        for (path, bytes) in [
            (profile::profile_path(workspace), self.profile),
            (profile::backup_path(workspace), self.backup),
        ] {
            let result = match bytes {
                Some(bytes) => write_atomic(&path, &bytes),
                None => std::fs::remove_file(&path).map_err(|e| Error::io(&path, e)),
            };
            if let Err(e) = result {
                log::warn!("profile not put back after a failed import: {e}");
            }
        }
    }
}

/// The file's profile in the work folder; the profile there becomes its backup (like a save
/// of the Profil view).
fn place_profile(workspace: &Path, bytes: &[u8]) -> Result<ProfileUndo> {
    let read = |path: PathBuf| match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::io(&path, e)),
    };
    let undo = ProfileUndo {
        profile: read(profile::profile_path(workspace))?,
        backup: read(profile::backup_path(workspace))?,
    };
    if let Some(old) = &undo.profile {
        write_atomic(&profile::backup_path(workspace), old)?;
    }
    write_atomic(&profile::profile_path(workspace), bytes)?;
    Ok(undo)
}

fn sha256(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    Sha256::digest(bytes)
        .iter()
        .fold(String::with_capacity(64), |mut hex, byte| {
            let _ = write!(hex, "{byte:02x}");
            hex
        })
}

/// Base64 (RFC 4648, the standard alphabet with padding): the files of a data file inside
/// its JSON.
mod base64 {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [
                chunk[0],
                chunk.get(1).copied().unwrap_or(0),
                chunk.get(2).copied().unwrap_or(0),
            ];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            for (i, shift) in [18, 12, 6, 0].into_iter().enumerate() {
                if i <= chunk.len() {
                    out.push(char::from(ALPHABET[((n >> shift) & 63) as usize]));
                } else {
                    out.push('=');
                }
            }
        }
        out
    }

    /// `None` for anything that is no padded base64 of the standard alphabet.
    pub fn decode(text: &str) -> Option<Vec<u8>> {
        let text = text.as_bytes();
        if !text.len().is_multiple_of(4) {
            return None;
        }
        let mut out = Vec::with_capacity(text.len() / 4 * 3);
        for (index, chunk) in text.chunks(4).enumerate() {
            let last = index + 1 == text.len() / 4;
            let pad = chunk.iter().rev().take_while(|&&c| c == b'=').count();
            if pad > 2 || (pad > 0 && !last) {
                return None;
            }
            let mut n = 0u32;
            for &c in &chunk[..4 - pad] {
                n = (n << 6) | u32::from(value(c)?);
            }
            n <<= 6 * pad;
            let bytes = n.to_be_bytes();
            out.extend_from_slice(&bytes[1..4 - pad]);
        }
        Some(out)
    }

    fn value(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use rusqlite::OpenFlags;

    use super::*;
    use crate::error::{ErrorInfo, ErrorKind};
    use crate::portal::Portal;
    use crate::settings::{Language, Palette};
    use crate::store::test_support::{mail, now, posting};
    use crate::window::Placement;

    /// A data folder with its database and a work folder with a profile.
    struct Folder {
        root: tempfile::TempDir,
        db: PathBuf,
        store: Store,
    }

    impl Folder {
        fn new() -> Folder {
            let root = tempfile::tempdir().unwrap();
            let db = root.path().join("data").join("jobs.db");
            let store = Store::open(&db).unwrap();
            Folder { root, db, store }
        }

        fn workspace(&self) -> PathBuf {
            self.root.path().join("work")
        }

        fn profile(&self) -> Option<String> {
            std::fs::read_to_string(profile::profile_path(&self.workspace())).ok()
        }

        fn backup(&self) -> Option<String> {
            std::fs::read_to_string(profile::backup_path(&self.workspace())).ok()
        }

        fn write_profile(&self, text: &str) {
            let path = profile::profile_path(&self.workspace());
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, text).unwrap();
        }

        fn job(&self, id: &str) {
            let run = self.store.begin_run().unwrap();
            let url = format!("https://www.linkedin.com/jobs/view/{id}/");
            let posting = posting(&url, "Interim CFO", "Nordlicht AG", "Hamburg");
            self.store
                .upsert_posting(run, &posting, mail(), now())
                .unwrap();
        }

        fn export(&self) -> PathBuf {
            let file = self.root.path().join("CXact-Daten.json");
            let bytes = self
                .store
                .export_data(&self.workspace(), &file, now())
                .unwrap();
            assert_eq!(std::fs::metadata(&file).unwrap().len(), bytes);
            file
        }

        fn import(&self, file: &Path, mailbox: Option<&str>) -> Result<DataImport> {
            self.store.import_data(
                &self.workspace(),
                file,
                mailbox,
                at("2026-09-27T08:15:30.123Z"),
            )
        }

        fn backups(&self) -> Vec<String> {
            self.store
                .backups()
                .unwrap()
                .into_iter()
                .map(|b| b.id)
                .collect()
        }

        fn settings(&self) -> Settings {
            Settings::load(&self.store).unwrap()
        }
    }

    fn at(text: &str) -> Timestamp {
        text.parse().unwrap()
    }

    /// A database file under another schema number (a file of a newer app).
    fn with_schema(database: &[u8], version: i64) -> Vec<u8> {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("jobs.db");
        std::fs::write(&path, database).unwrap();
        Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE)
            .unwrap()
            .pragma_update(None, "user_version", version)
            .unwrap();
        std::fs::read(&path).unwrap()
    }

    /// The computer the data comes from: two jobs, its own settings with its work folder, a
    /// profile, a window place, a file stamp and the mailbox it read.
    fn source() -> Folder {
        let from = Folder::new();
        from.job("4123456789");
        from.job("4123456790");
        from.store.kv_set("marker", "from").unwrap();
        let mut settings = from.settings();
        settings.workspace = Some(from.workspace());
        settings.language = Some(Language::En);
        settings.palette = Palette::Dark;
        settings.export_csv = true;
        settings.portals.get_mut(&Portal::LinkedIn).unwrap().enabled = false;
        settings.save(&from.store).unwrap();
        from.write_profile(r#"{"name": "Erika Muster", "titel": "Interim CFO"}"#);
        Placement {
            x: 10,
            y: 20,
            width: 1200,
            height: 800,
            maximized: false,
        }
        .save(&from.store)
        .unwrap();
        from.store
            .kv_set("export:C:/alt/JobAlerts.xlsx", "7")
            .unwrap();
        from.store
            .kv_set(MAILBOX_CHECKED, "2026-09-20T08:00:00Z")
            .unwrap();
        from.store.kv_set(GMAIL_ACCOUNT, "erika@gmail.com").unwrap();
        from.store
            .kv_set("last_scan:linkedin", "1790000000")
            .unwrap();
        from
    }

    /// The computer the data goes to: one job of its own, its own settings, profile, window
    /// place and file stamp.
    fn target() -> Folder {
        let to = Folder::new();
        to.job("4999999999");
        to.store.kv_set("marker", "to").unwrap();
        let mut settings = to.settings();
        settings.workspace = Some(to.workspace());
        settings.save(&to.store).unwrap();
        to.write_profile(r#"{"name": "Jonas Muster"}"#);
        Placement {
            x: -1900,
            y: 0,
            width: 1600,
            height: 900,
            maximized: true,
        }
        .save(&to.store)
        .unwrap();
        to.store
            .kv_set("export:D:/neu/JobAlerts.xlsx", "3")
            .unwrap();
        to
    }

    /// Everything travels: the jobs, the settings (in this computer's work folder), the
    /// profile (the one here is its backup now); what belongs to this computer stays (window,
    /// file stamps, the mailbox's check). The state before is a copy in `backups/`, and the
    /// database is replaced on disk, not only in the connection.
    #[test]
    fn a_round_trip_takes_the_jobs_the_profile_and_the_settings() {
        let from = source();
        let file = from.export();
        let to = target();
        let rev = to.store.data_rev().unwrap();

        let imported = to.import(&file, None).unwrap();
        assert!(imported.profile);
        assert_eq!(imported.before.kind, super::super::BackupKind::Import);
        assert_eq!(
            imported.before.id,
            "jobs.before-import-20260927-081530-123.db"
        );
        assert_eq!(to.backups(), std::slice::from_ref(&imported.before.id));

        assert_eq!(to.store.job_count().unwrap(), 2);
        assert_eq!(to.store.kv_get("marker").unwrap().as_deref(), Some("from"));
        let settings = to.settings();
        assert_eq!(
            settings.workspace,
            Some(to.workspace()),
            "this computer's folder"
        );
        assert_eq!(settings.language, Some(Language::En));
        assert_eq!(settings.palette, Palette::Dark);
        assert!(settings.export_csv);
        assert!(!settings.portal(Portal::LinkedIn).enabled);
        assert_eq!(
            to.profile().as_deref(),
            Some(r#"{"name": "Erika Muster", "titel": "Interim CFO"}"#)
        );
        assert_eq!(to.backup().as_deref(), Some(r#"{"name": "Jonas Muster"}"#));
        let window = Placement::load(&to.store).unwrap();
        assert_eq!(
            (window.x, window.maximized),
            (-1900, true),
            "this computer's screens"
        );
        assert_eq!(
            to.store
                .kv_get("export:D:/neu/JobAlerts.xlsx")
                .unwrap()
                .as_deref(),
            Some("3")
        );
        assert_eq!(
            to.store.kv_get("export:C:/alt/JobAlerts.xlsx").unwrap(),
            None
        );
        assert_eq!(to.store.kv_get(MAILBOX_CHECKED).unwrap(), None);
        // No mailbox here yet: the scan state stays ("Verbinden" decides).
        assert_eq!(
            to.store.kv_get(GMAIL_ACCOUNT).unwrap().as_deref(),
            Some("erika@gmail.com")
        );
        assert!(to.store.kv_get("last_scan:linkedin").unwrap().is_some());
        assert!(to.store.data_rev().unwrap() > rev, "the files follow");

        // The copy of before holds this computer's job; the next start reads the import.
        let copy =
            Connection::open(super::super::backup_dir(&to.db).join(&imported.before.id)).unwrap();
        let marker: String = copy
            .query_row("SELECT value FROM kv WHERE key = 'marker'", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_eq!(marker, "to");
        drop(copy);
        let Folder { root, db, store } = to;
        drop(store);
        let again = Store::open(&db).unwrap();
        assert_eq!(again.job_count().unwrap(), 2);
        drop(root);
    }

    /// Another account connected here: the file's scan state would skip its mails, so it goes;
    /// the same account keeps it. A file without a profile leaves the profile here as it is.
    #[test]
    fn the_scan_state_follows_the_connected_mailbox_and_no_profile_leaves_the_one_here() {
        let from = source();
        std::fs::remove_file(profile::profile_path(&from.workspace())).unwrap();
        let file = from.export();

        let to = target();
        let imported = to.import(&file, Some("jonas@gmail.com")).unwrap();
        assert!(!imported.profile);
        assert_eq!(to.profile().as_deref(), Some(r#"{"name": "Jonas Muster"}"#));
        assert_eq!(to.backup(), None);
        assert_eq!(to.store.kv_get(GMAIL_ACCOUNT).unwrap(), None);
        assert_eq!(to.store.kv_get("last_scan:linkedin").unwrap(), None);

        let same = target();
        same.import(&file, Some("erika@gmail.com")).unwrap();
        assert!(same.store.kv_get("last_scan:linkedin").unwrap().is_some());
    }

    /// Nothing secret and nothing of the computer in the file: the mailbox's password never
    /// reaches the database (only the keychain), the settings carry no work folder, and the
    /// database no window place, file stamp or settings (not even in its free pages).
    #[test]
    fn the_file_holds_no_secret_and_nothing_of_the_computer() {
        let from = source();
        // What "Verbinden" writes into the database: the scan state goes, the address stays in
        // the keychain with the password (the vault here is a closure that keeps nothing).
        let password = "abcdefghijklmnop";
        let credentials = crate::mail::imap::Credentials::new("erika@gmail.com", password);
        crate::mail::check::store_account(&from.store, None, &credentials, |_| Ok(())).unwrap();
        let file = from.export();
        let text = std::fs::read_to_string(&file).unwrap();
        assert!(
            text.starts_with(r#"{"format":"cxact-data","version":1,"#),
            "{}",
            &text[..60]
        );
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        let mut keys: Vec<&str> = value
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        assert_eq!(
            keys,
            [
                "app",
                "createdAt",
                "database",
                "format",
                "profile",
                "schema",
                "settings",
                "version"
            ]
        );
        let settings = value["settings"].as_object().unwrap();
        assert!(!settings.contains_key("workspace"), "{settings:?}");
        let workspace = from.workspace().display().to_string();

        let bundle = parse(text.as_bytes()).unwrap();
        let database = bundle.database.open("database").unwrap();
        let profile = bundle.profile.as_ref().unwrap().open("profile").unwrap();
        for (what, bytes) in [("file", text.as_bytes()), ("database", &database[..])] {
            for secret in [
                password.as_bytes(),
                workspace.as_bytes(),
                b"C:/alt/JobAlerts.xlsx",
            ] {
                assert!(
                    !bytes.windows(secret.len()).any(|w| w == secret),
                    "{what} holds {}",
                    String::from_utf8_lossy(secret)
                );
            }
        }
        assert_eq!(
            profile,
            std::fs::read(profile::profile_path(&from.workspace())).unwrap()
        );
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("jobs.db");
        std::fs::write(&path, &database).unwrap();
        let copy = Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let keys: Vec<String> = copy
            .prepare("SELECT key FROM kv ORDER BY key")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        for local in [settings::KEY, WINDOW, MAILBOX_CHECKED] {
            assert!(!keys.iter().any(|k| k == local), "{local} in {keys:?}");
        }
        assert!(!keys.iter().any(|k| k.starts_with("export:")), "{keys:?}");
        assert!(
            keys.iter().any(|k| k == "marker"),
            "the data travels: {keys:?}"
        );
        // The export wrote nothing else next to the database.
        let left: Vec<String> = std::fs::read_dir(from.db.parent().unwrap())
            .unwrap()
            .map(|e| e.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.starts_with('.'))
            .collect();
        assert!(left.is_empty(), "{left:?}");
    }

    /// A target that refuses files: the good file of a source, and what stays unchanged.
    struct Refusal {
        _from: Folder,
        to: Folder,
        good: String,
    }

    impl Refusal {
        fn new() -> Refusal {
            let from = source();
            let good = std::fs::read_to_string(from.export()).unwrap();
            Refusal {
                _from: from,
                to: target(),
                good,
            }
        }

        fn write(&self, name: &str, bytes: &[u8]) -> PathBuf {
            let path = self.to.root.path().join(name);
            std::fs::write(&path, bytes).unwrap();
            path
        }

        /// The good file, changed by `edit` (written again with its keys sorted).
        fn edited(&self, edit: &dyn Fn(&mut serde_json::Value)) -> Vec<u8> {
            let mut value: serde_json::Value = serde_json::from_str(&self.good).unwrap();
            edit(&mut value);
            serde_json::to_vec(&value).unwrap()
        }

        fn database(&self) -> Vec<u8> {
            parse(self.good.as_bytes())
                .unwrap()
                .database
                .open("database")
                .unwrap()
        }

        /// The good file with `bytes` as its database, size and checksum right.
        fn with_database(&self, bytes: &[u8]) -> Vec<u8> {
            self.edited(&|value| {
                value["database"] = serde_json::to_value(Blob::of(bytes)).unwrap();
            })
        }

        /// The error of importing `path`, after which nothing changed: no copy written, the
        /// jobs, the settings and the profile as they were.
        fn refused(&self, path: &Path) -> Error {
            let error = self.to.import(path, None).unwrap_err();
            let to = &self.to;
            assert_eq!(to.store.job_count().unwrap(), 1, "{error}");
            assert_eq!(to.store.kv_get("marker").unwrap().as_deref(), Some("to"));
            assert_eq!(to.settings().palette, Palette::Coast);
            assert_eq!(to.profile().as_deref(), Some(r#"{"name": "Jonas Muster"}"#));
            assert_eq!(to.backup(), None);
            assert!(to.backups().is_empty(), "{:?}", to.backups());
            error
        }
    }

    /// A file that is no data export and a damaged one (cut off, a changed byte, a database
    /// that does not read, no settings) are refused with their codes before anything changes.
    #[test]
    fn a_foreign_or_damaged_file_is_refused_with_a_code() {
        let r = Refusal::new();
        let database = r.database();
        for path in [
            r.write("empty.json", b""),
            r.write("other.json", br#"{"format":"other-app","version":1}"#),
            r.write("image.png", b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"),
            r.write("profile.json", br#"{"name":"Erika Muster"}"#),
        ] {
            let error = r.refused(&path);
            assert!(
                matches!(error, Error::Invalid(InvalidInput::DataFileForeign)),
                "{}: {error}",
                path.display()
            );
            let info = ErrorInfo::from(&error);
            assert_eq!(
                (info.kind, &info.params["reason"]),
                (ErrorKind::Invalid, &"dataFileForeign".into())
            );
        }
        let changed = r.edited(&|value| {
            let text = value["database"]["base64"].as_str().unwrap();
            let first = if text.starts_with('A') { "B" } else { "A" };
            value["database"]["base64"] = format!("{first}{}", &text[1..]).into();
        });
        for path in [
            r.write("cut.json", &r.good.as_bytes()[..r.good.len() / 2]),
            r.write("changed.json", &changed),
            r.write(
                "no-base64.json",
                &r.edited(&|value| value["profile"]["base64"] = "***".into()),
            ),
            r.write("garbage-db.json", &r.with_database(b"no database at all")),
            r.write(
                "half-db.json",
                &r.with_database(&database[..database.len() / 2]),
            ),
            r.write(
                "no-settings.json",
                &r.edited(&|value| value["settings"] = 7.into()),
            ),
            r.write(
                "no-version.json",
                &r.edited(&|value| value["version"] = "one".into()),
            ),
        ] {
            let error = r.refused(&path);
            assert!(
                matches!(error, Error::DataFileCorrupt(_)),
                "{}: {error}",
                path.display()
            );
            let info = ErrorInfo::from(&error);
            assert_eq!(
                (info.kind, &info.params["what"]),
                (ErrorKind::Corrupt, &"dataFile".into())
            );
        }
        // A file that is gone is an error with its path.
        let gone = r.refused(&r.to.root.path().join("gone.json"));
        assert_eq!(gone.kind(), ErrorKind::Io);
    }

    /// A file of a newer layout or of a newer schema is refused with its code; the good one
    /// imports, also when an editor saved it again (keys sorted, indented, a byte order mark).
    #[test]
    fn a_newer_file_is_refused_and_a_file_saved_again_reads() {
        let r = Refusal::new();
        let newer = r.refused(&r.write(
            "newer.json",
            &r.edited(&|value| value["version"] = 2.into()),
        ));
        assert!(matches!(newer, Error::DataFileNewer(2)), "{newer}");
        let info = ErrorInfo::from(&newer);
        assert_eq!(
            (info.kind, &info.params["what"]),
            (ErrorKind::NewerSchema, &"dataFile".into())
        );
        let schema = r.refused(&r.write(
            "newer-schema.json",
            &r.with_database(&with_schema(&r.database(), 99)),
        ));
        assert!(matches!(schema, Error::NewerSchema(99)), "{schema}");

        let value: serde_json::Value = serde_json::from_str(&r.good).unwrap();
        let mut resaved = BOM.to_vec();
        resaved.extend(serde_json::to_vec_pretty(&value).unwrap());
        r.to.import(&r.write("resaved.json", &resaved), None)
            .unwrap();
        assert_eq!(r.to.store.job_count().unwrap(), 2);
    }

    /// A failure at the very end (another connection holds the write lock) leaves the
    /// database and the profile as they were.
    #[test]
    fn a_failed_import_puts_the_profile_back() {
        let from = source();
        let file = from.export();
        let to = target();
        to.store
            .conn()
            .busy_timeout(std::time::Duration::from_millis(50))
            .unwrap();
        let other = Connection::open(&to.db).unwrap();
        other.execute_batch("BEGIN IMMEDIATE").unwrap();
        let error = to.import(&file, None).unwrap_err();
        assert_eq!(error.kind(), ErrorKind::Db, "{error}");
        other.execute_batch("ROLLBACK").unwrap();
        drop(other);
        assert_eq!(to.store.job_count().unwrap(), 1);
        assert_eq!(to.profile().as_deref(), Some(r#"{"name": "Jonas Muster"}"#));
        assert_eq!(to.backup(), None);
    }

    #[test]
    fn base64_round_trips_and_refuses_what_is_none() {
        for bytes in [
            &b""[..],
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"fooba",
            b"foobar",
            &[0, 255, 7],
        ] {
            let text = base64::encode(bytes);
            assert_eq!(base64::decode(&text).as_deref(), Some(bytes), "{text}");
        }
        assert_eq!(base64::encode(b"foobar"), "Zm9vYmFy");
        assert_eq!(base64::encode(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64::encode(b"foob"), "Zm9vYg==");
        for bad in ["Zm9", "Zm9v!mFy", "Zg==Zm9v", "Z===", "Zm9vYmFy\n"] {
            assert_eq!(base64::decode(bad), None, "{bad}");
        }
    }
}
