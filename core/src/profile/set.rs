//! Several profiles in the work folder, one of them active (user decision 2026-09-27).
//!
//! Each profile is one file of the old program's format in `profil/`: the first one is
//! `beraterprofil.json`, the file of the single profile of earlier versions, so a stored
//! profile simply is the first profile (nothing is moved, copied or rewritten, and its backup
//! stays its backup); every further one is `beraterprofil-<n>.json`. Each keeps its one backup
//! `<file>.bak` next to it ([`super::save_form`]). The profiles are the files there: one
//! deleted by hand is gone, one of such a name put there is a profile.
//!
//! The index `profilliste.json` beside them holds what the files cannot: which profile is
//! active, the one active before it (a deleted active profile gives the place back to it)
//! and the names the user gave. Missing or unreadable (every field has a default), the
//! first profile is active and each goes by its role; an active profile whose file is gone
//! gives way to the first one. Reading never writes: only the changes below write the index.
//! A new profile takes the number after the highest any file of the folder carries, a backup
//! of a deleted profile included, so the undo of a deletion never meets another profile.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use super::{PROFILE_DIR, PROFILE_FILE, read_file, utf8, writing};
use crate::error::{Error, Result};
use crate::export::write_atomic;

// File names in the user's work folder are a contract with it - do not translate.
/// The name every profile file starts with.
const STEM: &str = "beraterprofil";
/// The index of the profiles: the active one and the names the user gave.
pub const INDEX_FILE: &str = "profilliste.json";
// end of the contract

/// The longest name of a profile, in characters; a longer one is cut.
pub const MAX_NAME: usize = 80;

/// A profile of the work folder.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    /// Its number: 1 for `beraterprofil.json`, n for `beraterprofil-<n>.json`.
    pub id: u32,
    pub path: PathBuf,
    /// The name the user gave it; without one the page names it by its role or number.
    pub name: Option<String>,
    pub active: bool,
}

/// `profilliste.json`. The names are keyed by the profile's number as text (a JSON object's
/// keys are text); a key that is no number is skipped.
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Index {
    active: Option<u32>,
    /// The profile active before the active one (the user came from there).
    previous: Option<u32>,
    names: BTreeMap<String, String>,
}

impl Index {
    /// `id` becomes the active profile; `now` (the active one until then) is the one before.
    fn activate(&mut self, now: Option<u32>, id: u32) {
        if now != Some(id) {
            self.previous = now;
        }
        self.active = Some(id);
    }

    fn name(&self, id: u32) -> Option<String> {
        self.names.get(&id.to_string()).cloned()
    }

    /// The user's name for `id`: one line, trimmed, at most [`MAX_NAME`] characters; an empty
    /// one gives the profile back its default name.
    fn set_name(&mut self, id: u32, name: Option<&str>) {
        let words = name.unwrap_or_default().split_whitespace();
        let line: String = words.collect::<Vec<_>>().join(" ");
        let clean: String = line
            .chars()
            .filter(|c| !c.is_control())
            .take(MAX_NAME)
            .collect::<String>()
            .trim_end()
            .to_owned();
        if clean.is_empty() {
            self.names.remove(&id.to_string());
        } else {
            self.names.insert(id.to_string(), clean);
        }
    }
}

/// The profiles of a folder, sorted by number, and the highest number any of its files
/// carries (a backup of a deleted profile included).
struct Folder {
    ids: Vec<u32>,
    highest: u32,
}

impl Folder {
    /// The number a new profile takes.
    fn next(&self) -> u32 {
        self.highest.saturating_add(1).max(1)
    }
}

fn dir(workspace: &Path) -> PathBuf {
    workspace.join(PROFILE_DIR)
}

/// The file of profile `id` (`beraterprofil.json`, `beraterprofil-2.json`, ...).
pub fn file_name(id: u32) -> String {
    if id <= 1 {
        PROFILE_FILE.to_owned()
    } else {
        format!("{STEM}-{id}.json")
    }
}

/// The number of a profile file by its name; `None` for any other file.
pub fn id_of(name: &str) -> Option<u32> {
    if name == PROFILE_FILE {
        return Some(1);
    }
    let digits = name
        .strip_prefix(STEM)?
        .strip_prefix('-')?
        .strip_suffix(".json")?;
    if digits.is_empty() || digits.starts_with('0') || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    digits.parse().ok().filter(|&id| id >= 2)
}

/// A file the app keeps in the profile folder: a profile, its backup, the aside copy of a
/// swap ([`restore`]) and the index (what a reset deletes).
pub fn is_app_file(name: &str) -> bool {
    let base = name
        .strip_suffix(".bak")
        .or_else(|| name.strip_suffix(".swap"))
        .unwrap_or(name);
    name == INDEX_FILE || id_of(base).is_some()
}

/// The one backup of a profile file (`<file>.bak`).
pub(super) fn backup_of(path: &Path) -> PathBuf {
    let mut name = path.as_os_str().to_owned();
    name.push(".bak");
    PathBuf::from(name)
}

fn scan(dir: &Path) -> Result<Folder> {
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Folder {
                ids: Vec::new(),
                highest: 0,
            });
        }
        Err(e) => return Err(Error::io(dir, e)),
    };
    let mut ids = Vec::new();
    let mut highest = 0;
    for entry in entries {
        let entry = entry.map_err(|e| Error::io(dir, e))?;
        let Some(name) = entry.file_name().to_str().map(str::to_owned) else {
            continue;
        };
        if let Some(id) = id_of(&name) {
            if entry.path().is_file() {
                ids.push(id);
            }
            highest = highest.max(id);
        } else if let Some(id) = name.strip_suffix(".bak").and_then(id_of) {
            highest = highest.max(id);
        }
    }
    ids.sort_unstable();
    Ok(Folder { ids, highest })
}

fn read_index(dir: &Path) -> Index {
    let path = dir.join(INDEX_FILE);
    match std::fs::read(&path) {
        Ok(bytes) => {
            let text = String::from_utf8_lossy(&bytes);
            serde_json::from_str(text.trim_start_matches('\u{feff}')).unwrap_or_else(|e| {
                log::warn!("profile index unreadable ({e}): the first profile is active");
                Index::default()
            })
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Index::default(),
        Err(e) => {
            log::warn!("profile index not read ({e}): the first profile is active");
            Index::default()
        }
    }
}

fn write_index(dir: &Path, index: &Index) -> Result<()> {
    let mut json = serde_json::to_string_pretty(index).expect("serialisable");
    json.push('\n');
    write_atomic(&dir.join(INDEX_FILE), json.as_bytes())
}

/// The active profile among `ids`: the index's, else the first.
fn active_of(ids: &[u32], index: &Index) -> Option<u32> {
    index
        .active
        .filter(|id| ids.contains(id))
        .or_else(|| ids.first().copied())
}

/// The profiles of the work folder in the order of their numbers, the active one marked.
pub fn list(workspace: &Path) -> Result<Vec<Entry>> {
    let dir = dir(workspace);
    let folder = scan(&dir)?;
    let index = read_index(&dir);
    let active = active_of(&folder.ids, &index);
    Ok(folder
        .ids
        .iter()
        .map(|&id| Entry {
            id,
            path: dir.join(file_name(id)),
            name: index.name(id),
            active: Some(id) == active,
        })
        .collect())
}

/// The file of the active profile. Without any profile it is the file a new one gets (so
/// saving the first profile of a folder writes `beraterprofil.json`); a folder that cannot
/// be read gives the first profile's file, whose reading then says why.
pub(super) fn active_path(workspace: &Path) -> PathBuf {
    let dir = dir(workspace);
    let id = match scan(&dir) {
        Ok(folder) => active_of(&folder.ids, &read_index(&dir)).unwrap_or_else(|| folder.next()),
        Err(_) => 1,
    };
    dir.join(file_name(id))
}

/// A profile saved into a folder without one got a new number: a name an earlier profile
/// of that number left in the index is not its name. Called while [`writing`] is held.
pub(super) fn forget_name(workspace: &Path, path: &Path) {
    let Some(id) = path.file_name().and_then(|n| n.to_str()).and_then(id_of) else {
        return;
    };
    let dir = dir(workspace);
    let mut index = read_index(&dir);
    if index.names.remove(&id.to_string()).is_some()
        && let Err(e) = write_index(&dir, &index)
    {
        log::warn!("profile index not written: {e}");
    }
}

/// Makes profile `id` the active one. `false` if there is no such profile.
pub fn switch(workspace: &Path, id: u32) -> Result<bool> {
    let _one_at_a_time = writing();
    let dir = dir(workspace);
    let ids = scan(&dir)?.ids;
    if !ids.contains(&id) {
        return Ok(false);
    }
    let mut index = read_index(&dir);
    let now = active_of(&ids, &index);
    if now != Some(id) {
        index.activate(now, id);
        write_index(&dir, &index)?;
    }
    Ok(true)
}

/// A new profile of `bytes` named `name`, active from now on: its number. Called while
/// [`writing`] is held. Without the index written, the new file goes again and the
/// profiles stay as they were.
fn add(workspace: &Path, bytes: &[u8], name: Option<&str>) -> Result<u32> {
    let dir = dir(workspace);
    let folder = scan(&dir)?;
    let id = folder.next();
    let path = dir.join(file_name(id));
    write_atomic(&path, bytes)?;
    let mut index = read_index(&dir);
    index.set_name(id, name);
    let now = active_of(&folder.ids, &index);
    index.activate(now, id);
    if let Err(e) = write_index(&dir, &index) {
        let _ = std::fs::remove_file(&path);
        return Err(e);
    }
    Ok(id)
}

/// A new empty profile (`{}`), active from now on: its number.
pub fn create(workspace: &Path) -> Result<u32> {
    let _one_at_a_time = writing();
    add(workspace, b"{}", None)
}

/// A copy of profile `id` (its file byte for byte) named `name` (the page's words for a
/// copy), active from now on: its number; `None` if there is no such profile.
pub fn duplicate(workspace: &Path, id: u32, name: Option<&str>) -> Result<Option<u32>> {
    let _one_at_a_time = writing();
    if id_of(&file_name(id)) != Some(id) {
        return Ok(None);
    }
    let path = dir(workspace).join(file_name(id));
    let bytes = match std::fs::read(&path) {
        Ok(bytes) => bytes,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(Error::io(&path, e)),
    };
    add(workspace, &bytes, name).map(Some)
}

/// A new profile from a file the user chose, active from now on: its number. It holds the
/// profile of the file as [`super::read_file`] reads it (a JSON object as it is, the profile
/// of an AI's answer saved as it came, empty values dropped); a file that is no profile is
/// refused with its reason and nothing is written.
pub fn import(workspace: &Path, file: &Path) -> Result<u32> {
    let bytes = std::fs::read(file).map_err(|e| Error::io(file, e))?;
    let (_, source) = read_file(utf8(&bytes)?)?;
    let _one_at_a_time = writing();
    add(workspace, source.as_bytes(), None)
}

/// Names profile `id` (one line, trimmed, at most [`MAX_NAME`] characters); an empty name
/// gives it back its default (its role or its number). `false` if there is no such profile.
pub fn rename(workspace: &Path, id: u32, name: &str) -> Result<bool> {
    let _one_at_a_time = writing();
    let dir = dir(workspace);
    if !scan(&dir)?.ids.contains(&id) {
        return Ok(false);
    }
    let mut index = read_index(&dir);
    index.set_name(id, Some(name));
    write_index(&dir, &index)?;
    Ok(true)
}

/// Deletes profile `id`: its file becomes its one backup (replacing an older one), so
/// [`restore`] brings it back. The active profile gives the place back to the one active
/// before it (user decision 2026-09-27: she came from there); without that one the next
/// profile in order is active, else the one before; the last one leaves no profile, the
/// state of a new work folder. `false` if there is no such profile.
pub fn delete(workspace: &Path, id: u32) -> Result<bool> {
    let _one_at_a_time = writing();
    let dir = dir(workspace);
    let folder = scan(&dir)?;
    if !folder.ids.contains(&id) {
        return Ok(false);
    }
    let mut index = read_index(&dir);
    let active = active_of(&folder.ids, &index);
    let path = dir.join(file_name(id));
    std::fs::rename(&path, backup_of(&path)).map_err(|e| Error::io(&path, e))?;
    if active == Some(id) {
        let at = folder
            .ids
            .iter()
            .position(|&other| other == id)
            .unwrap_or(0);
        let rest: Vec<u32> = folder.ids.iter().copied().filter(|&o| o != id).collect();
        let back = index.previous.filter(|previous| rest.contains(previous));
        index.active = back.or_else(|| {
            rest.get(at)
                .or_else(|| at.checked_sub(1).and_then(|before| rest.get(before)))
                .copied()
        });
        index.previous = None;
        // Without the index the first profile is active: a valid state too.
        if let Err(e) = write_index(&dir, &index) {
            log::warn!("profile index not written after a deletion: {e}");
        }
    }
    Ok(true)
}

/// Brings profile `id` back from its backup, active from now on: the undo of its deletion
/// (the backup becomes the profile again) and of a save that replaced it with another file
/// (the two swap, so the undo can itself be undone). `false` without a backup.
pub fn restore(workspace: &Path, id: u32) -> Result<bool> {
    let _one_at_a_time = writing();
    if id_of(&file_name(id)) != Some(id) {
        return Ok(false);
    }
    let dir = dir(workspace);
    let path = dir.join(file_name(id));
    let backup = backup_of(&path);
    if !backup.exists() {
        return Ok(false);
    }
    let mut index = read_index(&dir);
    let active = active_of(&scan(&dir)?.ids, &index);
    if path.exists() {
        // A swap in three renames within the folder; the profile is never left missing
        // longer than between the last two.
        let aside = path.with_extension("json.swap");
        std::fs::rename(&path, &aside).map_err(|e| Error::io(&path, e))?;
        if let Err(e) = std::fs::rename(&backup, &path) {
            let _ = std::fs::rename(&aside, &path);
            return Err(Error::io(&backup, e));
        }
        std::fs::rename(&aside, &backup).map_err(|e| Error::io(&aside, e))?;
    } else {
        std::fs::rename(&backup, &path).map_err(|e| Error::io(&backup, e))?;
    }
    if active != Some(id) {
        index.activate(active, id);
        if let Err(e) = write_index(&dir, &index) {
            log::warn!("profile index not written after a restore: {e}");
        }
    }
    Ok(true)
}

/// The role a profile goes by without a name of its own: its `titel`, else its first
/// `wunschrollen`; `None` for a file that does not read or names neither.
pub fn role(path: &Path) -> Option<String> {
    let bytes = std::fs::read(path).ok()?;
    let form = super::form_of(utf8(&bytes).ok()?)?;
    let title = form.title.trim();
    if title.is_empty() {
        form.roles
            .iter()
            .map(|role| role.trim())
            .find(|role| !role.is_empty())
            .map(str::to_owned)
    } else {
        Some(title.to_owned())
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use jiff::Timestamp;

    use super::*;
    use crate::error::ErrorKind;
    use crate::pipeline::rescore::{Host, Rescore};
    use crate::pipeline::{LocalMatcher, Matcher};
    use crate::profile::{BACKUP_FILE, info, load, profile_path, save_form, stored_form};
    use crate::store::Store;

    fn fixture(name: &str) -> String {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/matching")
            .join(name);
        std::fs::read_to_string(path).unwrap()
    }

    /// The files of the profile folder, sorted.
    fn files(workspace: &Path) -> Vec<String> {
        let mut names: Vec<String> = std::fs::read_dir(workspace.join(PROFILE_DIR))
            .unwrap()
            .map(|e| e.unwrap().file_name().to_string_lossy().into_owned())
            .collect();
        names.sort();
        names
    }

    fn ids(workspace: &Path) -> Vec<u32> {
        list(workspace).unwrap().iter().map(|e| e.id).collect()
    }

    fn active(workspace: &Path) -> Option<u32> {
        crate::profile::active_id(workspace).unwrap()
    }

    /// A profile of an earlier version (one file and its backup, no index) is the first
    /// profile as it is: reading writes nothing, a second profile leaves its bytes and its
    /// backup alone, and switching back finds it again.
    #[test]
    fn a_single_profile_of_an_earlier_version_is_the_first_profile() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        let folder = ws.join(PROFILE_DIR);
        std::fs::create_dir_all(&folder).unwrap();
        let text = format!("\u{feff}{}", fixture("sample_profile_senior.json"));
        std::fs::write(folder.join(PROFILE_FILE), &text).unwrap();
        std::fs::write(folder.join(BACKUP_FILE), b"{\"name\": \"vorher\"}").unwrap();

        let listed = list(ws).unwrap();
        assert_eq!(
            listed,
            [Entry {
                id: 1,
                path: folder.join(PROFILE_FILE),
                name: None,
                active: true,
            }]
        );
        assert_eq!(profile_path(ws), folder.join(PROFILE_FILE));
        assert!(info(ws).unwrap().unwrap().parse_error.is_none());
        assert!(stored_form(ws).is_some());
        assert!(role(&folder.join(PROFILE_FILE)).is_some());
        assert_eq!(
            files(ws),
            [PROFILE_FILE, BACKUP_FILE],
            "reading writes nothing"
        );

        let second = create(ws).unwrap();
        assert_eq!(second, 2);
        assert_eq!((ids(ws), active(ws)), (vec![1, 2], Some(2)));
        assert_eq!(
            files(ws),
            [
                "beraterprofil-2.json",
                PROFILE_FILE,
                BACKUP_FILE,
                INDEX_FILE
            ]
        );
        assert_eq!(
            std::fs::read_to_string(folder.join(PROFILE_FILE)).unwrap(),
            text
        );
        assert_eq!(
            std::fs::read(folder.join(BACKUP_FILE)).unwrap(),
            b"{\"name\": \"vorher\"}",
            "its backup stays its backup"
        );
        assert!(switch(ws, 1).unwrap());
        assert_eq!(profile_path(ws), folder.join(PROFILE_FILE));
        assert_eq!(
            std::fs::read_to_string(folder.join(PROFILE_FILE)).unwrap(),
            text
        );
    }

    #[test]
    fn profiles_are_created_duplicated_renamed_deleted_and_restored() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        assert!(list(ws).unwrap().is_empty(), "a new work folder has none");
        assert_eq!(active(ws), None);

        // The first new profile is the file of earlier versions, empty.
        assert_eq!(create(ws).unwrap(), 1);
        assert_eq!(load(ws).unwrap().unwrap(), serde_json::json!({}));
        let after = crate::profile::ProfileForm {
            title: "SAP FI/CO Berater".into(),
            ..crate::profile::ProfileForm::default()
        };
        save_form(
            ws,
            None,
            &crate::profile::ProfileForm::default(),
            &after,
            &[],
        )
        .unwrap();
        let first = std::fs::read(ws.join(PROFILE_DIR).join(PROFILE_FILE)).unwrap();

        // A copy is the file byte for byte, with the name the page gave it, active now.
        assert_eq!(duplicate(ws, 1, Some("SAP Kopie")).unwrap(), Some(2));
        assert_eq!(duplicate(ws, 7, None).unwrap(), None, "no such profile");
        let copy = ws.join(PROFILE_DIR).join("beraterprofil-2.json");
        assert_eq!(std::fs::read(&copy).unwrap(), first);
        assert_eq!(active(ws), Some(2));
        assert_eq!(list(ws).unwrap()[1].name.as_deref(), Some("SAP Kopie"));
        assert_eq!(role(&copy).as_deref(), Some("SAP FI/CO Berater"));

        // A name is one trimmed line of at most 80 characters; an empty one gives the
        // default back.
        assert!(rename(ws, 2, "  SAP\n  FI/CO \t").unwrap());
        assert_eq!(list(ws).unwrap()[1].name.as_deref(), Some("SAP FI/CO"));
        assert!(rename(ws, 2, &"x".repeat(200)).unwrap());
        assert_eq!(
            list(ws).unwrap()[1].name.as_deref().map(str::len),
            Some(MAX_NAME)
        );
        assert!(rename(ws, 2, " ").unwrap());
        assert_eq!(list(ws).unwrap()[1].name, None);
        assert!(!rename(ws, 5, "Nichts").unwrap());

        // Deleting the active profile makes it its backup; the one active before it is
        // active again, and a new profile never takes its number.
        assert!(rename(ws, 2, "Zweites").unwrap());
        assert!(delete(ws, 2).unwrap());
        assert!(!copy.exists());
        assert_eq!(std::fs::read(backup_of(&copy)).unwrap(), first);
        assert_eq!((ids(ws), active(ws)), (vec![1], Some(1)));
        assert!(!delete(ws, 2).unwrap(), "gone already");
        assert_eq!(create(ws).unwrap(), 3);
        assert!(switch(ws, 1).unwrap());
        assert!(
            !switch(ws, 2).unwrap(),
            "a deleted profile cannot be chosen"
        );

        // The undo brings it back with its name, active again.
        assert!(restore(ws, 2).unwrap());
        assert_eq!((ids(ws), active(ws)), (vec![1, 2, 3], Some(2)));
        assert_eq!(list(ws).unwrap()[1].name.as_deref(), Some("Zweites"));
        assert!(!restore(ws, 2).unwrap(), "no backup left");

        // Deleting one that is not active keeps the active one.
        assert!(delete(ws, 1).unwrap());
        assert_eq!((ids(ws), active(ws)), (vec![2, 3], Some(2)));
        // The one active before is gone too: the next one in order follows the active one.
        assert!(delete(ws, 2).unwrap());
        assert_eq!(active(ws), Some(3));
    }

    /// Deleting the active profile gives the place back to the one active before it, not to
    /// a neighbour: after a switch, a new profile, a copy or a file taken as a profile, the
    /// user is back where she came from.
    #[test]
    fn deleting_the_active_profile_goes_back_to_the_one_active_before() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        for _ in 0..4 {
            create(ws).unwrap();
        }
        assert!(switch(ws, 1).unwrap());
        assert!(switch(ws, 3).unwrap());
        assert!(delete(ws, 3).unwrap());
        assert_eq!(active(ws), Some(1), "the one before, not the neighbour 4");
        // A new profile deleted at once: the one active before it again.
        assert_eq!(create(ws).unwrap(), 5);
        assert!(delete(ws, 5).unwrap());
        assert_eq!(active(ws), Some(1));
        // Its undo makes it active again; deleting it again goes back once more.
        assert!(restore(ws, 5).unwrap());
        assert_eq!(active(ws), Some(5));
        assert!(delete(ws, 5).unwrap());
        assert_eq!(active(ws), Some(1));
        // The one before is gone too: the neighbour follows.
        assert!(switch(ws, 2).unwrap());
        assert!(delete(ws, 1).unwrap());
        assert!(delete(ws, 2).unwrap());
        assert_eq!((ids(ws), active(ws)), (vec![4], Some(4)));
    }

    /// Deleting the last profile leaves the state of a work folder without one: no profile,
    /// none active, the next save a new profile; its undo brings it back.
    #[test]
    fn the_last_profile_leaves_a_valid_state() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        let form = crate::profile::ProfileForm {
            name: "Erika".into(),
            ..crate::profile::ProfileForm::default()
        };
        save_form(
            ws,
            Some("{}"),
            &crate::profile::ProfileForm::default(),
            &form,
            &[],
        )
        .unwrap();
        assert_eq!((ids(ws), active(ws)), (vec![1], Some(1)));
        assert!(delete(ws, 1).unwrap());
        assert_eq!((ids(ws), active(ws)), (vec![], None));
        assert!(info(ws).unwrap().is_none());
        assert!(load(ws).unwrap().is_none());
        assert!(!profile_path(ws).exists());
        // The index says so and reads back.
        let index = std::fs::read_to_string(ws.join(PROFILE_DIR).join(INDEX_FILE)).unwrap();
        assert_eq!(
            serde_json::from_str::<serde_json::Value>(&index).unwrap()["active"],
            serde_json::Value::Null
        );

        // A save makes a new profile, which takes the next number.
        save_form(
            ws,
            Some("{}"),
            &crate::profile::ProfileForm::default(),
            &form,
            &[],
        )
        .unwrap();
        assert_eq!((ids(ws), active(ws)), (vec![2], Some(2)));
        // The undo of the deletion still brings the first one back.
        assert!(restore(ws, 1).unwrap());
        assert_eq!((ids(ws), active(ws)), (vec![1, 2], Some(1)));
    }

    /// An index the app cannot read (edited by hand) costs the names only: the first profile
    /// is active; an active profile whose file went is followed by the first.
    #[test]
    fn a_broken_index_or_a_missing_file_leaves_the_first_profile_active() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        create(ws).unwrap();
        create(ws).unwrap();
        assert!(rename(ws, 2, "Zwei").unwrap());
        assert_eq!(active(ws), Some(2));
        let index = ws.join(PROFILE_DIR).join(INDEX_FILE);
        std::fs::write(&index, b"{kaputt").unwrap();
        assert_eq!((ids(ws), active(ws)), (vec![1, 2], Some(1)));
        assert_eq!(list(ws).unwrap()[1].name, None);
        assert!(switch(ws, 2).unwrap());
        std::fs::remove_file(ws.join(PROFILE_DIR).join("beraterprofil-2.json")).unwrap();
        assert_eq!((ids(ws), active(ws)), (vec![1], Some(1)));
        assert_eq!(profile_path(ws), ws.join(PROFILE_DIR).join(PROFILE_FILE));
    }

    #[test]
    fn only_the_app_s_files_are_profiles() {
        for (name, id) in [
            ("beraterprofil.json", Some(1)),
            ("beraterprofil-2.json", Some(2)),
            ("beraterprofil-17.json", Some(17)),
            ("beraterprofil-1.json", None),
            ("beraterprofil-02.json", None),
            ("beraterprofil-x.json", None),
            ("beraterprofil-2.json.bak", None),
            ("Beraterprofil.json", None),
            ("profilliste.json", None),
        ] {
            assert_eq!(id_of(name), id, "{name}");
        }
        assert_eq!(file_name(1), PROFILE_FILE);
        assert_eq!(file_name(12), "beraterprofil-12.json");
        for name in [
            "beraterprofil.json",
            "beraterprofil.json.bak",
            "beraterprofil-3.json.bak",
            "beraterprofil-3.json.swap",
            "profilliste.json",
        ] {
            assert!(is_app_file(name), "{name}");
        }
        for name in [
            "Profil_Erika.json",
            "beraterprofil-x.json.bak",
            "notizen.txt",
        ] {
            assert!(!is_app_file(name), "{name}");
        }
    }

    /// A file that is no profile is refused with its reason; nothing is written.
    #[test]
    fn a_file_is_imported_as_a_new_profile_only_when_it_is_one() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        let file = ws.join("Profil_Neu.json");
        std::fs::write(&file, b"[1]").unwrap();
        let error = import(ws, &file).unwrap_err();
        assert_eq!(
            crate::error::ErrorInfo::from(&error).params["reason"],
            "profileNotObject"
        );
        assert!(!ws.join(PROFILE_DIR).exists());
        let text = fixture("sample_profile_it.json");
        std::fs::write(&file, format!("\u{feff}{text}")).unwrap();
        assert_eq!(import(ws, &file).unwrap(), 1);
        assert_eq!(import(ws, &file).unwrap(), 2);
        assert_eq!(active(ws), Some(2));
        let stored = std::fs::read_to_string(ws.join(PROFILE_DIR).join("beraterprofil-2.json"));
        assert_eq!(
            stored.unwrap(),
            text,
            "as it is, without the byte order mark"
        );
    }

    /// The app as the rescore rules see it after a switch: idle, the new profile usable, its
    /// pending jobs counted in the store.
    struct App<'a> {
        store: &'a Store,
        matcher: &'a LocalMatcher,
        launched: Cell<u32>,
    }

    impl Host for App<'_> {
        fn running(&self) -> bool {
            false
        }
        fn usable(&self) -> bool {
            self.matcher.usable()
        }
        fn certain(&self) -> bool {
            true
        }
        fn pending(&self) -> u32 {
            self.store.match_pending(self.matcher.rev()).unwrap()
        }
        fn scored(&self) -> bool {
            self.store.has_matches().unwrap()
        }
        fn has_jobs(&self) -> bool {
            self.store.job_count().unwrap() > 0
        }
        fn clear_matches(&self) {
            self.store.clear_matches().unwrap();
        }
        fn launch_rescore(&self) -> std::result::Result<(), ErrorKind> {
            self.launched.set(self.launched.get() + 1);
            Ok(())
        }
    }

    fn score(store: &Store, matcher: &LocalMatcher) {
        for job in store.jobs(&crate::store::JobFilter::default()).unwrap() {
            let text = store.description(&job.key).unwrap();
            let judged = matcher.judge(&job, text.as_deref()).unwrap();
            store
                .save_judgements(
                    &[(job.key.clone(), judged)],
                    matcher.rev(),
                    Timestamp::now(),
                )
                .unwrap();
        }
    }

    /// Switching changes the file the app compiles its matcher from (`commands::scoring`
    /// keys it by the active file), so the matcher's revision changes and every job waits for
    /// a score with the new profile: the profile change the switch reports starts the rescore
    /// that scores them all.
    #[test]
    fn switching_rescores_every_job_with_the_new_profile() {
        let dir = tempfile::tempdir().unwrap();
        let ws = dir.path();
        let file = ws.join("it.json");
        std::fs::create_dir_all(ws.join(PROFILE_DIR)).unwrap();
        std::fs::write(profile_path(ws), fixture("sample_profile.json")).unwrap();
        std::fs::write(&file, fixture("sample_profile_it.json")).unwrap();
        assert_eq!(import(ws, &file).unwrap(), 2);
        assert!(switch(ws, 1).unwrap());

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        for id in [4_000_000_001_u64, 4_000_000_002] {
            let link =
                crate::portal::job_link(&format!("https://www.linkedin.com/jobs/view/{id}/"))
                    .unwrap();
            let posting =
                crate::model::Posting::new(link.key.clone(), link.url, "Controller", "", "");
            let mail = crate::store::MailRef {
                subject: "Neue Jobs",
                date: None,
                gmail_id: None,
            };
            store
                .upsert_posting(run, &posting, mail, Timestamp::now())
                .unwrap();
            store
                .record_text(
                    &link.key,
                    "Controlling mit SAP und IFRS.",
                    false,
                    false,
                    Timestamp::now(),
                )
                .unwrap();
        }
        let finance = LocalMatcher::from_json(&load(ws).unwrap().unwrap());
        score(&store, &finance);
        assert_eq!(store.match_pending(finance.rev()).unwrap(), 0);

        let before = profile_path(ws);
        assert!(switch(ws, 2).unwrap());
        assert_ne!(
            profile_path(ws),
            before,
            "another file, another compiled profile"
        );
        let it = LocalMatcher::from_json(&load(ws).unwrap().unwrap());
        assert_ne!(it.rev(), finance.rev());
        assert_eq!(store.match_pending(it.rev()).unwrap(), 2, "every job waits");
        let app = App {
            store: &store,
            matcher: &it,
            launched: Cell::new(0),
        };
        Rescore::default().profile_changed(&app);
        assert_eq!(app.launched.get(), 1, "the switch starts a rescore");
        score(&store, &it);
        assert_eq!(store.match_pending(it.rev()).unwrap(), 0);
        // Switching back makes them wait for the first profile again.
        assert!(switch(ws, 1).unwrap());
        assert_eq!(store.match_pending(finance.rev()).unwrap(), 2);
    }
}
