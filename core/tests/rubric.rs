//! The scoring rubric of the AI prompts: the German file `core/src/export/ai_rubric.de.md`
//! covers the bands 1 to 10 and stops wishes below the app's high band; the English rubric of
//! the English prompts (`ai_rubric.en.md`) has the same sections, bands and caps.

use std::path::{Path, PathBuf};

use jobalert_core::model::HIGH_FROM;

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

/// A cap: an upper (`true`) or lower bound and its score.
type Cap = (bool, u32);

fn sorted(mut caps: Vec<Cap>) -> Vec<Cap> {
    caps.sort_unstable();
    caps
}

/// The caps of the rubric: the lines of its section `Obergrenzen`.
fn rubric_caps(rubric: &str) -> Vec<Cap> {
    let section = rubric
        .split("\n## ")
        .find(|s| s.starts_with("Obergrenzen"))
        .expect("section Obergrenzen");
    let caps = section
        .lines()
        .filter(|l| l.starts_with("- "))
        .map(|line| {
            let upper = line.contains("höchstens");
            let n: u32 = line
                .rsplit(' ')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or_else(|| panic!("a cap ends with its score: {line}"));
            (upper, n)
        })
        .collect();
    sorted(caps)
}

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
}

const RUBRIC_EN: &str = "core/src/export/ai_rubric.en.md";

/// The bands of a rubric (`from`, `to`) in the section `heading`, written `- 9 <to> 10 ...`.
fn bands(rubric: &str, heading: &str, to: &str) -> Vec<(u32, u32)> {
    let section = rubric
        .split("\n## ")
        .find(|s| s.starts_with(heading))
        .unwrap_or_else(|| panic!("section {heading}"));
    section
        .lines()
        .filter(|l| l.starts_with("- "))
        .map(|line| {
            let words: Vec<&str> = line.split(' ').collect();
            assert_eq!(words[2], to, "{line}");
            (words[1].parse().unwrap(), words[3].parse().unwrap())
        })
        .collect()
}

/// The caps of the English rubric: the lines of its section `Caps`.
fn english_caps(rubric: &str) -> Vec<Cap> {
    let section = rubric
        .split("\n## ")
        .find(|s| s.starts_with("Caps"))
        .expect("section Caps");
    let caps = section
        .lines()
        .filter(|l| l.starts_with("- "))
        .map(|line| {
            let n: u32 = line
                .rsplit(' ')
                .next()
                .and_then(|n| n.parse().ok())
                .unwrap_or_else(|| panic!("a cap ends with its score: {line}"));
            (line.contains("at most"), n)
        })
        .collect();
    sorted(caps)
}

/// The English prompts carry the English rubric (`ai_rubric.en.md`): it says what the German
/// one says, so both languages score alike - the same sections, bands, caps and the same stop
/// below the app's high band.
#[test]
fn the_english_rubric_says_the_same() {
    let german = read(RUBRIC);
    let english = read(RUBRIC_EN);
    assert_eq!(
        german.matches("\n## ").count(),
        english.matches("\n## ").count(),
        "the same sections"
    );
    assert_eq!(
        bands(&german, "Punkte von 1 bis 10", "bis"),
        bands(&english, "Points from 1 to 10", "to")
    );
    assert_eq!(rubric_caps(&german), english_caps(&english));
    let high = u32::from(HIGH_FROM) / 10;
    assert!(
        english.contains(&format!("to {high} or more")),
        "high band {high}"
    );
    for key in [
        "min_tagessatz",
        "laender",
        "min_jahresgehalt",
        "zielprofil_min_jahre",
        "schwerpunkte",
        "wunschrollen",
        "tagessatz_wunsch",
        "einsatzpraeferenzen",
    ] {
        assert!(german.contains(key) && english.contains(key), "{key}");
    }
}
