//! Files the tests generate from the code, one rule for all of them: the IPC types and the
//! command map, the preview's demo data and vocabulary, the golden prompt and the corpus
//! digest. A test writes its file when it differs; without `CXACT_REGEN` it then fails (look at
//! the diff, commit it), with `CXACT_REGEN=1` it passes. `npm run gen` (`tools/gen.mjs`) runs
//! them so, and the next `cargo test --workspace` is green on its first run.

use std::path::Path;

/// The variable that makes a generating test pass after writing its file.
pub const REGEN: &str = "CXACT_REGEN";

/// True while the tests run under `npm run gen` (`CXACT_REGEN` set, not `0`).
pub fn regen() -> bool {
    std::env::var_os(REGEN).is_some_and(|value| !value.is_empty() && value != "0")
}

/// What a generating test says when it rewrote a stale file outside `npm run gen`.
pub fn stale(what: &str) -> String {
    format!(
        "{what} was stale: rewritten, look at the diff and commit it (npm run gen rewrites every generated file in one run)"
    )
}

/// Writes `content` to `path` when the file differs (line ends aside). `Err` with the message
/// of [`stale`] when it was rewritten outside `npm run gen`.
pub fn write(path: &Path, content: &str) -> Result<(), String> {
    let stored = std::fs::read_to_string(path)
        .unwrap_or_default()
        .replace("\r\n", "\n");
    if stored == content {
        return Ok(());
    }
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("{}: {e}", dir.display()))?;
    }
    std::fs::write(path, content).map_err(|e| format!("{}: {e}", path.display()))?;
    if regen() {
        Ok(())
    } else {
        Err(stale(&path.display().to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh file passes untouched; a stale one is rewritten (the outcome then depends only
    /// on `CXACT_REGEN`, which this test leaves as the run set it).
    #[test]
    fn a_stale_file_is_rewritten() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sub").join("x.ts");
        let first = write(&path, "eins\n");
        assert_eq!(first.is_ok(), regen(), "{first:?}");
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "eins\n");
        std::fs::write(&path, "eins\r\n").unwrap();
        assert_eq!(write(&path, "eins\n"), Ok(()), "line ends aside");
        let second = write(&path, "zwei\n");
        assert_eq!(second.is_ok(), regen());
        if let Err(message) = second {
            assert!(message.contains("npm run gen"), "{message}");
        }
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "zwei\n");
    }
}
