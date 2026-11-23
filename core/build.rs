//! The fingerprint of what decides a score, for the stored revision of every match
//! (`pipeline::local`): SHA-256 over the engine with its word lists and ESCO data, the text
//! it is handed and the mapping onto the store, as `CXACT_ENGINE_SOURCES` (16 hex). A change
//! to any of them scores every stored job again, with no version to bump by hand.

use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

/// Everything that decides a score, relative to the crate root; a folder counts whole.
const ENGINE_SOURCES: &[&str] = &[
    "src/matching",
    "src/text/scored.rs",
    "src/pipeline/local.rs",
];

fn main() {
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").expect("manifest dir"));
    let mut files = Vec::new();
    for source in ENGINE_SOURCES {
        // A folder is watched whole, a file added to it included.
        println!("cargo::rerun-if-changed={source}");
        collect(&root.join(source), &mut files);
    }
    // By their path with `/`: the same sources give the same fingerprint on every OS.
    let mut named: Vec<(String, PathBuf)> = files
        .into_iter()
        .map(|path| {
            let name = path
                .strip_prefix(&root)
                .expect("below the crate root")
                .to_string_lossy()
                .replace('\\', "/");
            (name, path)
        })
        .collect();
    named.sort();
    let mut hash = Sha256::new();
    for (name, path) in &named {
        let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("{name}: {e}"));
        let len = u64::try_from(bytes.len()).expect("file size");
        hash.update(name.as_bytes());
        hash.update([0]);
        hash.update(len.to_le_bytes());
        hash.update(&bytes);
    }
    let hex = hash
        .finalize()
        .iter()
        .take(8)
        .fold(String::new(), |mut hex, b| {
            let _ = write!(hex, "{b:02x}");
            hex
        });
    println!("cargo::rustc-env=CXACT_ENGINE_SOURCES={hex}");
}

/// The files of a path: the path itself or every file below the folder.
fn collect(path: &Path, out: &mut Vec<PathBuf>) {
    if path.is_dir() {
        for entry in std::fs::read_dir(path).expect("engine source folder") {
            collect(&entry.expect("folder entry").path(), out);
        }
    } else {
        out.push(path.to_owned());
    }
}
