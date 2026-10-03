//! Vocabulary terms of a job text, independent of the profile.

use std::cmp::Reverse;
use std::sync::LazyLock;

use super::lexicon;
use super::normalize::{canonical_stream, char_len, raw_canonical};

static VOCAB_KEYS: LazyLock<Vec<String>> = LazyLock::new(|| {
    lexicon::JOB_SKILL_VOCAB
        .iter()
        .map(|entry| {
            canonical_stream(entry.split_whitespace().map(str::to_owned).collect()).join(" ")
        })
        .collect()
});

/// Vocabulary terms in the text, longest first, without terms contained in a longer found
/// term.
pub(crate) fn extract_job_skills(text: &str) -> Vec<String> {
    let joined = format!(" {} ", raw_canonical(text).join(" "));
    let mut found: Vec<&String> = Vec::new();
    for key in VOCAB_KEYS.iter() {
        if !key.is_empty() && !found.contains(&key) && joined.contains(&format!(" {key} ")) {
            found.push(key);
        }
    }
    found.sort_by_key(|key| Reverse(char_len(key)));
    let mut result: Vec<String> = Vec::new();
    for key in found {
        let needle = format!(" {key} ");
        if !result
            .iter()
            .any(|longer| format!(" {longer} ").contains(&needle))
        {
            result.push(key.clone());
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vocabulary_prefers_longer_terms() {
        let skills =
            extract_job_skills("Unser Kunde betreibt SAP S/4HANA und Power BI im Reporting.");
        assert_eq!(skills, ["sap s/4hana", "reporting", "power bi"]);
    }
}
