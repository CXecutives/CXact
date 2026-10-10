//! The profile entries the engine matches against, with their JSON paths.

use super::normalize::strip;
use crate::profile::{ProfileForm, key};

/// An entry of the profile: a degree, competence, tool, certificate, industry or language.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CoreText {
    /// Stripped text as written in the profile.
    pub text: String,
    /// JSON path, e.g. `kernkompetenzen[3].kompetenz`.
    pub path: String,
}

/// The entries of a profile in the order of the file's lists, each text once (the first
/// wins).
pub(crate) fn core_texts(form: &ProfileForm) -> Vec<CoreText> {
    let mut raw: Vec<(String, &str)> = Vec::new();
    for (i, degree) in form.degrees.iter().enumerate() {
        raw.push((format!("{}[{i}]", key::DEGREES), degree));
    }
    for (i, c) in form.competences.iter().enumerate() {
        raw.push((
            format!("{}[{i}].{}", key::COMPETENCES, key::COMPETENCE),
            &c.name,
        ));
    }
    for (i, tool) in form.tools.iter().enumerate() {
        raw.push((format!("{}[{i}]", key::TOOLS), tool));
    }
    for (i, certificate) in form.certificates.iter().enumerate() {
        raw.push((format!("{}[{i}]", key::CERTIFICATES), certificate));
    }
    for (i, industry) in form.industries.iter().enumerate() {
        raw.push((format!("{}[{i}]", key::INDUSTRIES), industry));
    }
    for (i, language) in form.languages.iter().enumerate() {
        raw.push((
            format!("{}[{i}].{}", key::LANGUAGES, key::LANGUAGE),
            &language.language,
        ));
    }
    let mut core: Vec<CoreText> = Vec::new();
    for (path, text) in raw {
        let text = strip(text);
        if !text.is_empty() && !core.iter().any(|c| c.text == text) {
            core.push(CoreText {
                text: text.to_owned(),
                path,
            });
        }
    }
    core
}
