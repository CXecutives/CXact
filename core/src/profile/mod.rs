//! The consultant profile: one file in `profil/` of the workspace, `beraterprofil.json`
//! (Profil-JSON v19, [`form`]; user decision 2026-10-03: one profile only). Saving writes the
//! editor's form, rebased on what the file holds by then, and keeps the previous file next to
//! it as the one backup (`beraterprofil.json.bak`).

pub mod cv;
mod form;
mod import;
mod search_terms;

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use jiff::Timestamp;

use crate::error::{Error, InvalidInput, Result};
use crate::export::write_atomic;
use crate::store::Store;

pub(crate) use form::key;
#[cfg(test)]
pub(crate) use form::typescript as form_typescript;
pub use form::{
    LanguageLevel, MAX_FOCUS, MIN_MONTHS, ProfileAvailability, ProfileCompetence, ProfileForm,
    ProfileIndustry, ProfileLanguage, WorkWish, Workload, file_value, missing_required, parse,
};
pub use import::{MAX_CV_COMPETENCES, MAX_CV_TOOLS, import as import_cv};
pub use search_terms::{MAX_CANDIDATES, MAX_DEEP_TERMS, deep_search_terms};

/// Folder and file names are a contract with the user's work folder - do not translate.
pub const PROFILE_DIR: &str = "profil";
pub const PROFILE_FILE: &str = "beraterprofil.json";
/// The profile's previous version, kept next to it on every save (one backup, replaced each
/// time).
pub const BACKUP_FILE: &str = "beraterprofil.json.bak";

/// The store key of the fields the CV import filled (until the next save).
const AI_FILLED_KEY: &str = "profile.aiFilled";

/// One save at a time: two saves close together (two terms added from the reader) each read
/// the file the other one wrote, so neither drops what the other changed.
static WRITING: Mutex<()> = Mutex::new(());

fn writing() -> MutexGuard<'static, ()> {
    WRITING.lock().unwrap_or_else(PoisonError::into_inner)
}

/// State of the stored profile.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProfileInfo {
    pub path: PathBuf,
    pub bytes: u64,
    pub saved_at: Option<Timestamp>,
    /// The file does not read as a profile (edited by hand, or of another version).
    pub parse_error: Option<InvalidInput>,
}

/// The profile's file.
pub fn profile_path(workspace: &Path) -> PathBuf {
    workspace.join(PROFILE_DIR).join(PROFILE_FILE)
}

/// The profile's one backup.
pub fn backup_path(workspace: &Path) -> PathBuf {
    workspace.join(PROFILE_DIR).join(BACKUP_FILE)
}

/// A file the app keeps in the profile folder: the profile and its backup (what a reset
/// deletes).
pub fn is_app_file(name: &str) -> bool {
    name == PROFILE_FILE || name == BACKUP_FILE
}

fn read(workspace: &Path) -> Result<Option<Vec<u8>>> {
    let path = profile_path(workspace);
    match std::fs::read(&path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(Error::io(&path, e)),
    }
}

/// The profile in a file's bytes.
fn form_of(bytes: &[u8]) -> std::result::Result<ProfileForm, InvalidInput> {
    parse(std::str::from_utf8(bytes).map_err(|_| InvalidInput::ProfileNotUtf8)?)
}

/// The stored profile; `None` if there is none.
pub fn info(workspace: &Path) -> Result<Option<ProfileInfo>> {
    let Some(bytes) = read(workspace)? else {
        return Ok(None);
    };
    let path = profile_path(workspace);
    let saved_at = std::fs::metadata(&path)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| Timestamp::try_from(t).ok());
    Ok(Some(ProfileInfo {
        bytes: bytes.len() as u64,
        parse_error: form_of(&bytes).err(),
        path,
        saved_at,
    }))
}

/// The stored profile's form; `None` if there is none or it does not read (the profile info
/// names the error).
pub fn load(workspace: &Path) -> Result<Option<ProfileForm>> {
    Ok(read(workspace)?.and_then(|bytes| form_of(&bytes).ok()))
}

/// The ISO code of a country entry of a profile as the engine reads it: a two-letter code,
/// or a German or English name of its lexicon (`Norwegen`, `Czechia`); `None` for a name it
/// does not know.
pub fn country_code(name: &str) -> Option<String> {
    crate::matching::facts::country_code(name)
}

/// The ISO codes of every country the engine tells apart in a job ad, by a country or a
/// city name of its lexicon (a German city without a country is in Germany), sorted: the
/// countries a profile can choose (`laender`). The UI catalog names each of them
/// (`profile.country`), which `core/tests/countries.rs` checks.
pub fn country_codes() -> Vec<&'static str> {
    use crate::matching::lexicon::engine as lex;
    let mut codes: Vec<&'static str> = lex::COUNTRIES
        .iter()
        .chain(lex::CITIES)
        .map(|&(_, code)| code)
        .chain(["DE"])
        .collect();
    codes.sort_unstable();
    codes.dedup();
    codes
}

/// Saves the editor's form (without a profile it becomes the profile). `before` is the form
/// as the editor received it: what the user changed is applied to what the file holds now
/// ([`form::merge`]); a file that does not read is replaced. The previous file becomes the
/// one backup next to it; the file is replaced atomically, and not touched when nothing
/// changes. One save at a time ([`WRITING`]).
pub fn save_form(
    workspace: &Path,
    before: &ProfileForm,
    after: &ProfileForm,
) -> Result<ProfileInfo> {
    let _one_at_a_time = writing();
    let after = form::validate(after)?;
    let before = before.normalized();
    let previous = read(workspace)?;
    let now = previous.as_deref().and_then(|bytes| form_of(bytes).ok());
    let form = match &now {
        // A rebase that breaks a limit (a sixth star) saves what the user saw.
        Some(now) => form::validate(&form::merge(now, &before, &after)).unwrap_or(after),
        None => after,
    };
    let text = form::write(&form);
    if previous.as_deref() != Some(text.as_bytes()) {
        if let Some(old) = &previous {
            write_atomic(&backup_path(workspace), old)?;
        }
        write_atomic(&profile_path(workspace), text.as_bytes())?;
    }
    info(workspace)?.ok_or_else(|| Error::Corrupt("profile unreadable right after saving".into()))
}

/// The form fields the CV import filled, until the next save (the Profil marks them).
pub fn ai_filled(store: &Store) -> Vec<String> {
    store
        .kv_get(AI_FILLED_KEY)
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

/// Notes the form fields the CV import filled; an empty list clears them (a save does).
pub fn set_ai_filled(store: &Store, fields: &[&str]) -> Result<()> {
    store.kv_set(
        AI_FILLED_KEY,
        &serde_json::to_string(fields).unwrap_or_default(),
    )
}

/// A profile of a test, written as the v19 JSON (anything else panics).
#[cfg(test)]
pub(crate) fn of_json(value: &serde_json::Value) -> ProfileForm {
    parse(&value.to_string()).unwrap_or_else(|e| panic!("no v19 profile ({e:?}): {value}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn workspace() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn stored(dir: &Path) -> String {
        std::fs::read_to_string(profile_path(dir)).unwrap()
    }

    fn form(tools: &[&str]) -> ProfileForm {
        ProfileForm {
            roles: vec!["Interim CFO".into()],
            tools: tools.iter().map(|t| (*t).to_owned()).collect(),
            ..ProfileForm::default()
        }
    }

    #[test]
    fn the_previous_file_becomes_the_one_backup() {
        let dir = workspace();
        let empty = ProfileForm::default();
        let first = form(&["SAP"]);
        save_form(dir.path(), &empty, &first).unwrap();
        assert!(!backup_path(dir.path()).exists(), "nothing to keep yet");
        let saved_once = stored(dir.path());
        assert_eq!(load(dir.path()).unwrap(), Some(first.clone()));
        let second = form(&["SAP", "IFRS"]);
        save_form(dir.path(), &first, &second).unwrap();
        assert_eq!(
            std::fs::read_to_string(backup_path(dir.path())).unwrap(),
            saved_once
        );
        // Saving what the file holds writes nothing.
        let written = stored(dir.path());
        save_form(dir.path(), &second, &second).unwrap();
        assert_eq!(stored(dir.path()), written);
        assert_eq!(
            std::fs::read_to_string(backup_path(dir.path())).unwrap(),
            saved_once
        );
        let mut files: Vec<String> = std::fs::read_dir(dir.path().join(PROFILE_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        files.sort();
        assert_eq!(files, [PROFILE_FILE, BACKUP_FILE], "exactly one backup");
        assert!(files.iter().all(|f| is_app_file(f)));
    }

    #[test]
    fn invalid_input_is_refused_with_a_code_and_nothing_is_written() {
        let dir = workspace();
        let empty = ProfileForm::default();
        let refused = |form: &ProfileForm| match save_form(dir.path(), &empty, form).unwrap_err() {
            Error::Invalid(input) => input,
            other => panic!("{other:?}"),
        };
        let rate = ProfileForm {
            day_rate_min: Some(1_000_000),
            ..empty.clone()
        };
        assert_eq!(
            refused(&rate),
            InvalidInput::ProfileValue {
                field: "dayRateMin".into(),
                row: None,
                max: Some(100_000)
            }
        );
        let date = ProfileForm {
            available: ProfileAvailability::From {
                date: "31.02.2026".into(),
            },
            ..empty.clone()
        };
        assert_eq!(
            refused(&date),
            InvalidInput::ProfileValue {
                field: "available".into(),
                row: None,
                max: None
            }
        );
        assert!(info(dir.path()).unwrap().is_none(), "nothing stored");
    }

    /// A file that does not read is named, loads as none, and a save replaces it (its bytes
    /// stay as the backup).
    #[test]
    fn a_file_that_does_not_read() {
        let dir = workspace();
        assert_eq!(load(dir.path()).unwrap(), None);
        std::fs::create_dir_all(dir.path().join(PROFILE_DIR)).unwrap();
        for (bytes, reason) in [
            (&b"{kaputt"[..], "profileNotJson"),
            (&b"{\"keywords\": [\"SAP\"]}"[..], "profileNotJson"),
            (&[0xff, 0xfe, 0x00][..], "profileNotUtf8"),
        ] {
            std::fs::write(profile_path(dir.path()), bytes).unwrap();
            let error = info(dir.path()).unwrap().unwrap().parse_error.unwrap();
            let info = crate::error::ErrorInfo::from(&Error::Invalid(error));
            assert_eq!(info.params["reason"], reason);
            assert_eq!(load(dir.path()).unwrap(), None);
        }
        let new = form(&["SAP"]);
        save_form(dir.path(), &ProfileForm::default(), &new).unwrap();
        assert_eq!(load(dir.path()).unwrap(), Some(new));
        assert_eq!(
            std::fs::read(backup_path(dir.path())).unwrap(),
            [0xff, 0xfe, 0x00]
        );
    }

    /// DS-3: saves close together each read what the other wrote: eight tools added at once,
    /// each on the same older copy, are all in the file.
    #[test]
    fn ds_3_saves_close_together_keep_every_entry() {
        let dir = workspace();
        let p0 = form(&["SAP"]);
        save_form(dir.path(), &ProfileForm::default(), &p0).unwrap();
        let terms: Vec<String> = (1..=8).map(|n| format!("Begriff {n}")).collect();
        let start = std::sync::Barrier::new(terms.len());
        std::thread::scope(|scope| {
            for term in &terms {
                let (dir, p0, start) = (dir.path(), &p0, &start);
                scope.spawn(move || {
                    let after = form(&["SAP", term]);
                    start.wait();
                    save_form(dir, p0, &after).unwrap();
                });
            }
        });
        let stored = load(dir.path()).unwrap().unwrap().tools;
        for term in &terms {
            assert!(stored.contains(term), "{term} lost: {stored:?}");
        }
        assert_eq!(stored.len(), 9, "{stored:?}");
    }

    #[test]
    fn the_fields_the_cv_filled_until_the_next_save() {
        let dir = workspace();
        let store = Store::open(&dir.path().join("jobs.db")).unwrap();
        assert!(ai_filled(&store).is_empty());
        set_ai_filled(&store, &["roles", "competences"]).unwrap();
        assert_eq!(ai_filled(&store), ["roles", "competences"]);
        set_ai_filled(&store, &[]).unwrap();
        assert!(ai_filled(&store).is_empty());
    }
}
