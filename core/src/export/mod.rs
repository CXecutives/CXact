//! The AI prompts, the generated colours of the window and the icon, and writing the app's
//! own files atomically (a crash never leaves half a file behind).

mod ai_prompt;
mod colour;
pub mod generated;
pub mod palette;
pub mod personal;

use std::io::Write;
use std::path::{Path, PathBuf};

use crate::error::{Error, Result};

pub use ai_prompt::{MAX_AD_CHARS, MAX_PROFILE_CHARS, PromptJob, PromptSource, ai_prompt};

/// Temporary files of [`write_atomic`] - only left behind after a crash in the middle of
/// writing, and they belong to the app.
const TMP_PREFIX: &str = ".jam-";
const TMP_SUFFIX: &str = ".tmp";

/// Writes `bytes` atomically to `path`: first into a temporary file in the same folder, then
/// rename. If the target is locked (open in another program), it stays unchanged and the
/// error is `FileLocked`.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> Result<()> {
    let long = long_path(path);
    let path = long.as_path();
    let dir = path.parent().unwrap_or_else(|| Path::new("."));
    ensure_dir(dir)?;
    let mut tmp = tempfile::Builder::new()
        .prefix(TMP_PREFIX)
        .suffix(TMP_SUFFIX)
        .tempfile_in(dir)
        .map_err(|e| Error::io(dir, e))?;
    tmp.write_all(bytes).map_err(|e| Error::io(tmp.path(), e))?;
    tmp.as_file()
        .sync_all()
        .map_err(|e| Error::io(tmp.path(), e))?;
    tmp.persist(path)
        .map_err(|e| Error::replace(path, e.error))?;
    Ok(())
}

/// Creates a folder (with its parents, long paths too).
pub(crate) fn ensure_dir(dir: &Path) -> Result<()> {
    std::fs::create_dir_all(long_path(dir)).map_err(|e| Error::io(dir, e))
}

/// Windows paths from 260 characters on need the long form `\\?\`: `tempfile` passes the
/// path unchanged to Windows when renaming - a long workspace would otherwise make a file in
/// it fail.
fn long_path(path: &Path) -> PathBuf {
    let Ok(absolute) = std::path::absolute(path) else {
        return path.to_path_buf();
    };
    match absolute.to_str() {
        Some(p) if cfg!(windows) && p.len() >= 240 && !p.starts_with(r"\\?\") => {
            match p.strip_prefix(r"\\") {
                Some(unc) => format!(r"\\?\UNC\{unc}").into(),
                None => format!(r"\\?\{p}").into(),
            }
        }
        _ => absolute,
    }
}

/// The files in `dir` whose name (or the name before a reset leftover's mark) is `ours`.
pub(crate) fn files_in(dir: &Path, ours: impl Fn(&str) -> bool) -> Vec<PathBuf> {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return Vec::new();
    };
    entries
        .filter_map(std::result::Result::ok)
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter(|e| {
            e.file_name().to_str().is_some_and(|name| {
                ours(
                    name.split_once(crate::reset::LEFTOVER)
                        .map_or(name, |(base, _)| base),
                )
            })
        })
        .map(|e| e.path())
        .collect()
}

/// A temporary file of [`write_atomic`] (left behind by an interrupted write).
pub(crate) fn is_tmp(name: &str) -> bool {
    name.starts_with(TMP_PREFIX) && name.ends_with(TMP_SUFFIX)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn atomic_write_replaces_and_leaves_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a").join("x.txt");
        write_atomic(&path, b"eins").unwrap();
        write_atomic(&path, b"zwei").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "zwei");
        let leftovers: Vec<_> = std::fs::read_dir(path.parent().unwrap()).unwrap().collect();
        assert_eq!(leftovers.len(), 1);
    }

    /// Read-only is not "open in another program".
    #[cfg(windows)] // On Unix a missing write bit does not prevent replacing.
    #[test]
    fn read_only_target_is_no_lock() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"alt").unwrap();
        let mut perms = std::fs::metadata(&path).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&path, perms.clone()).unwrap();
        let err = write_atomic(&path, b"neu").unwrap_err();
        assert!(matches!(err, Error::Io { .. }), "{err:?}");
        #[expect(
            clippy::permissions_set_readonly_false,
            reason = "test: lift the write protection again"
        )]
        perms.set_readonly(false);
        std::fs::set_permissions(&path, perms).unwrap();
    }

    /// Paths above 260 characters (deeply nested workspace).
    #[test]
    fn long_paths_are_written() {
        let dir = tempfile::tempdir().unwrap();
        let deep = dir.path().join("a".repeat(120)).join("b".repeat(120));
        let path = deep.join(format!("{}.txt", "c".repeat(100)));
        write_atomic(&path, b"eins").unwrap();
        write_atomic(&path, b"zwei").unwrap();
        assert_eq!(std::fs::read(long_path(&path)).unwrap(), b"zwei");
    }

    /// A file open in another program (Windows: without delete sharing) stays unchanged, the error
    /// says "locked".
    #[cfg(windows)]
    #[test]
    fn locked_target_is_reported_and_kept() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, b"alt").unwrap();
        let lock = std::fs::OpenOptions::new()
            .read(true)
            .share_mode(0)
            .open(&path)
            .unwrap();
        let err = write_atomic(&path, b"neu").unwrap_err();
        assert!(matches!(err, Error::FileLocked(_)), "{err:?}");
        drop(lock);
        assert_eq!(std::fs::read(&path).unwrap(), b"alt");
        let files = std::fs::read_dir(dir.path()).unwrap().count();
        assert_eq!(files, 1, "no temporary leftovers");
    }
}
