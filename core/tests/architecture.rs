//! Architecture rules of the app shell (`src-tauri/src`, docs/ARCHITECTURE.md). The UI's
//! rules live in `ui_contract.rs` and `tools/architecture.mjs`.

use std::path::{Path, PathBuf};

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

fn rust_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in std::fs::read_dir(dir).unwrap().flatten() {
        let path = entry.path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

/// The app shell decides per OS in `platform.rs` only (CLAUDE.md): the window frame, the
/// title bar colours, the menu. `smoke.rs` is the debug-only probe that takes screenshots
/// the way each OS does. Core keeps what the file system does differently (long paths,
/// files held open) next to the code that meets it.
#[test]
fn per_os_code_of_the_shell_only_in_platform_rs() {
    let root = repo("src-tauri/src");
    let mut files = Vec::new();
    rust_files(&root, &mut files);
    assert!(
        files.len() >= 5,
        "only {} files in src-tauri/src",
        files.len()
    );
    let allowed = ["platform.rs", "smoke.rs"];
    let needles = [
        "target_os",
        "cfg(windows)",
        "cfg(unix)",
        "cfg!(windows)",
        "cfg!(unix)",
        "target_family",
    ];
    let mut problems = Vec::new();
    for file in &files {
        let rel = file
            .strip_prefix(&root)
            .unwrap()
            .to_string_lossy()
            .replace('\\', "/");
        if allowed.contains(&rel.as_str()) {
            continue;
        }
        let text = std::fs::read_to_string(file).unwrap();
        for (n, line) in text.lines().enumerate() {
            if needles.iter().any(|needle| line.contains(needle)) {
                problems.push(format!("src-tauri/src/{rel}:{}: {}", n + 1, line.trim()));
            }
        }
    }
    assert!(
        problems.is_empty(),
        "per-OS code of the shell only in src-tauri/src/platform.rs (fix: a function there \
         that the caller asks):\n  {}",
        problems.join("\n  ")
    );
}
