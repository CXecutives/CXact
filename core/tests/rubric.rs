//! The scoring rubric of the AI prompts: `core/src/export/ai_rubric.de.md` covers the app's
//! own scale of 0 to 100 in bands that leave no gap, takes the app's high and mid limits as
//! placeholders (the prompt fills them in from `model`, so the text cannot drift from the
//! bands) and names the profile keys it rules on.

use std::path::{Path, PathBuf};

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

/// The meaning of the number: `- 90 bis 100 ...` down to `- unter 25 ...`, no gap.
#[test]
fn the_bands_cover_zero_to_one_hundred() {
    let rubric = read(RUBRIC);
    let section = rubric
        .split("\n## ")
        .find(|s| s.starts_with("Passungsgrad von 0 bis 100"))
        .expect("section with the bands");
    let mut next = 100;
    let bands = section.lines().filter(|l| {
        l.strip_prefix("- ")
            .and_then(|rest| rest.split(' ').next())
            .is_some_and(|first| first == "unter" || first.parse::<i32>().is_ok())
    });
    let mut count = 0;
    for line in bands {
        let words: Vec<&str> = line.split(' ').collect();
        let (from, to): (i32, i32) = if words[1] == "unter" {
            (0, words[2].parse::<i32>().unwrap() - 1)
        } else {
            assert_eq!(words[2], "bis", "{line}");
            (words[1].parse().unwrap(), words[3].parse().unwrap())
        };
        assert_eq!(to, next, "{line}");
        assert!(from <= to && words.len() > 3, "{line}");
        next = from - 1;
        count += 1;
    }
    assert!(count >= 3, "{count} bands");
    assert_eq!(next, -1, "the bands end at 0");
}

/// The limits of the app's bands are placeholders (the prompt fills them in), no number
/// that could differ from `model::HIGH_FROM` and `MID_FROM`.
#[test]
fn the_limits_of_the_app_are_placeholders() {
    let rubric = read(RUBRIC);
    let flat = rubric.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(
        flat.contains("Ab {HIGH_FROM} Punkten ist die Übereinstimmung hoch, ab {MID_FROM} mittel"),
        "bands"
    );
    assert!(
        flat.contains("Sie zählen nur im Rahmen und heben die Zahl nie"),
        "wishes never lift a score"
    );
    let mut rest = rubric.as_str();
    while let Some(at) = rest.find('{') {
        let end = rest[at..].find('}').expect("a closed placeholder") + at;
        let name = &rest[at + 1..end];
        assert!(matches!(name, "HIGH_FROM" | "MID_FROM"), "{name}");
        rest = &rest[end..];
    }
}

/// The rubric rules on the profile's own keys (Profil-JSON v19).
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
        "regionen",
    ] {
        assert!(rubric.contains(key), "{key}");
    }
}
