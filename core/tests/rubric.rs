//! The scoring rubric of the AI prompts: `core/src/export/ai_rubric.de.md` covers the bands
//! 1 to 10, maps them onto the app's points and bands, stops wishes below the app's high band
//! and names the profile keys it rules on.

use std::path::{Path, PathBuf};

use jobalert_core::model::{HIGH_FROM, MID_FROM};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn read(path: &str) -> String {
    std::fs::read_to_string(root().join(path))
        .unwrap_or_else(|e| panic!("{path}: {e}"))
        .replace("\r\n", "\n")
}

const RUBRIC: &str = "core/src/export/ai_rubric.de.md";

#[test]
fn the_bands_cover_one_to_ten() {
    let rubric = read(RUBRIC);
    let section = rubric
        .split("\n## ")
        .find(|s| s.starts_with("Punkte von 1 bis 10"))
        .expect("section with the bands");
    let mut next = 10;
    for line in section.lines().filter(|l| l.starts_with("- ")) {
        let words: Vec<&str> = line.split(' ').collect();
        let (from, to): (u32, u32) = (words[1].parse().unwrap(), words[3].parse().unwrap());
        assert_eq!((to, words[2]), (next, "bis"), "{line}");
        assert!(from <= to && words.len() > 4, "{line}");
        next = from - 1;
    }
    assert_eq!(next, 0, "the bands end at 1");
    // Wishes and target role stop below the app's high band.
    let high = u32::from(HIGH_FROM) / 10;
    assert!(
        rubric.contains(&format!("auf {high} oder mehr")),
        "high band {high}"
    );
    // The score times 10 is the app's points: the same bands.
    let mid = u32::from(MID_FROM) / 10;
    let flat = rubric.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        flat.contains(&format!("ab {high} hohe, ab {mid} mittlere")),
        "bands {high} and {mid}"
    );
}

/// The rubric rules on the profile's own keys (Profil-JSON v19), and on no retired one.
#[test]
fn the_rubric_names_the_profile_keys() {
    let rubric = read(RUBRIC);
    for key in [
        "vertragsarten",
        "tagessatz_min",
        "laender",
        "mindestgehalt",
        "ausschlusswoerter",
        "wunschrollen",
        "tagessatz_wunsch",
        "arbeitsmodell",
    ] {
        assert!(rubric.contains(key), "{key}");
    }
    for retired in [
        "schwerpunkt",
        "zielprofil",
        "einsatzpraeferenzen",
        "harte_kriterien",
        "min_tagessatz",
    ] {
        assert!(!rubric.contains(retired), "a retired key: {retired}");
    }
}
