//! "Aus Lebenslauf ausfüllen": the CV worker's answer (`cv-worker/schema.json`, the part of the
//! profile a CV can tell) read by the profile form with its caps and merged into the one
//! profile, which is saved at once (a cancel after the answer never costs a try). What the CV
//! filled is noted until the next save (`set_ai_filled`).
//!
//! The merge never overwrites: an entry the profile has (the same name, case aside) keeps its
//! star, years and level; a new competence gets its star only while fewer than [`MAX_FOCUS`]
//! carry one; a new industry never carries the wish star. Contract types, rates, countries,
//! work mode, availability, workload and exclusion words are the user's alone: the answer
//! never touches them.

use std::path::Path;

use serde_json::{Map, Value};

use super::form::{self, MAX_FOCUS, key};
use super::{ProfileForm, ProfileInfo};
use crate::error::Result;

/// At most this many competences and tools come from a CV.
pub const MAX_CV_COMPETENCES: usize = 25;
pub const MAX_CV_TOOLS: usize = 30;

/// The answer is no profile part (a fault of the worker or the AI): nothing is saved.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoProfile;

/// The form of the answer: only the keys a CV fills, capped (competences, tools, stars), the
/// industries without the wish star; `NoProfile` when it does not read as a profile.
pub fn cv_form(answer: &Map<String, Value>) -> std::result::Result<ProfileForm, NoProfile> {
    let mut part: Map<String, Value> = answer
        .iter()
        .filter(|(name, _)| form::CV_KEYS.contains(&name.as_str()))
        .map(|(name, value)| (name.clone(), value.clone()))
        .collect();
    if let Some(Value::Array(rows)) = part.get_mut(key::COMPETENCES) {
        rows.truncate(MAX_CV_COMPETENCES);
        let mut stars = 0;
        for row in rows.iter_mut() {
            if let Some(star) = row.get_mut("schwerpunkt")
                && star.as_bool() == Some(true)
            {
                stars += 1;
                if stars > MAX_FOCUS {
                    *star = Value::Bool(false);
                }
            }
        }
    }
    if let Some(Value::Array(tools)) = part.get_mut(key::TOOLS) {
        tools.truncate(MAX_CV_TOOLS);
    }
    if let Some(Value::Array(rows)) = part.get_mut(key::INDUSTRIES) {
        for row in rows.iter_mut() {
            if let Some(wish) = row.get_mut("wunsch") {
                *wish = Value::Bool(false);
            }
        }
    }
    form::parse(&Value::Object(part).to_string()).map_err(|_| NoProfile)
}

/// The profile with what the CV adds (see the module), and the fields it filled (by their
/// names in the form).
pub fn merge(now: &ProfileForm, cv: &ProfileForm) -> (ProfileForm, Vec<&'static str>) {
    let same = |a: &str, b: &str| a.trim().to_lowercase() == b.trim().to_lowercase();
    let mut out = now.clone();
    let mut filled = Vec::new();
    let mut note = |field: &'static str, changed: bool| {
        if changed && !filled.contains(&field) {
            filled.push(field);
        }
    };
    let union = |list: &mut Vec<String>, more: &[String]| {
        let before = list.len();
        for item in more {
            if !list.iter().any(|have| same(have, item)) {
                list.push(item.clone());
            }
        }
        list.len() > before
    };
    note("roles", union(&mut out.roles, &cv.roles));
    note("tools", union(&mut out.tools, &cv.tools));
    note("degrees", union(&mut out.degrees, &cv.degrees));
    note(
        "certificates",
        union(&mut out.certificates, &cv.certificates),
    );
    if out.years.is_none() && cv.years.is_some() {
        out.years = cv.years;
        note("years", true);
    }
    for row in &cv.competences {
        if let Some(have) = out
            .competences
            .iter_mut()
            .find(|c| same(&c.name, &row.name))
        {
            if have.years.is_none() && row.years.is_some() {
                have.years = row.years;
                note("competences", true);
            }
            continue;
        }
        let stars = out.competences.iter().filter(|c| c.focus).count();
        let mut row = row.clone();
        row.focus &= stars < MAX_FOCUS;
        out.competences.push(row);
        note("competences", true);
    }
    for row in &cv.industries {
        if !out.industries.iter().any(|i| same(&i.name, &row.name)) {
            out.industries.push(super::ProfileIndustry {
                name: row.name.clone(),
                preferred: false,
            });
            note("industries", true);
        }
    }
    for row in &cv.languages {
        if !out
            .languages
            .iter()
            .any(|l| same(&l.language, &row.language))
        {
            out.languages.push(row.clone());
            note("languages", true);
        }
    }
    (out, filled)
}

/// Merges the answer into the stored profile (a new one without) and saves it at once; the
/// profile and the fields the CV filled. `None` when the answer is no profile part.
pub fn import(
    workspace: &Path,
    answer: &Map<String, Value>,
) -> Result<Option<(ProfileInfo, Vec<&'static str>)>> {
    let Ok(cv) = cv_form(answer) else {
        return Ok(None);
    };
    let now = super::load(workspace)?.unwrap_or_default();
    let (merged, filled) = merge(&now, &cv);
    let info = super::save_form(workspace, &now, &merged)?;
    Ok(Some((info, filled)))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::profile::{LanguageLevel, ProfileCompetence};

    fn answer(value: Value) -> Map<String, Value> {
        match value {
            Value::Object(map) => map,
            other => panic!("no object: {other}"),
        }
    }

    /// The answer is capped and read as the form reads a file; anything that does not read
    /// saves nothing.
    #[test]
    fn the_answer_is_capped_and_read_by_the_form() {
        let competences: Vec<Value> = (0..30)
            .map(|n| json!({"kompetenz": format!("K{n}"), "jahre": n, "schwerpunkt": true}))
            .collect();
        let tools: Vec<Value> = (0..40).map(|n| json!(format!("T{n}"))).collect();
        let cv = cv_form(&answer(json!({
            "wunschrollen": ["Interim CFO"],
            "kernkompetenzen": competences,
            "methoden_tools": tools,
            "branchen": [{"branche": "Pharma", "wunsch": true}],
            // Never from a CV.
            "tagessatz_min": 900,
        })))
        .unwrap();
        assert_eq!(cv.competences.len(), MAX_CV_COMPETENCES);
        assert_eq!(cv.focus().count(), MAX_FOCUS);
        assert_eq!(cv.tools.len(), MAX_CV_TOOLS);
        assert!(!cv.industries[0].preferred);
        assert_eq!(cv.day_rate_min, None);
        for bad in [
            json!({"sprachen": [{"sprache": "Deutsch", "niveau": "gut"}]}),
            json!({"kernkompetenzen": "Controlling"}),
        ] {
            assert_eq!(cv_form(&answer(bad)), Err(NoProfile));
        }
    }

    /// The merge keeps what the profile has and adds what is new; the fields it filled are
    /// named.
    #[test]
    fn the_merge_never_overwrites() {
        let now = ProfileForm {
            roles: vec!["Interim CFO".into()],
            permanent: false,
            day_rate_min: Some(1_000),
            years: Some(20),
            competences: (0..5)
                .map(|n| ProfileCompetence {
                    name: format!("K{n}"),
                    years: if n == 0 { None } else { Some(3) },
                    focus: true,
                })
                .collect(),
            ..ProfileForm::default()
        };
        let cv = cv_form(&answer(json!({
            "wunschrollen": ["interim cfo", "Head of Finance"],
            "berufserfahrung_jahre": 18,
            "kernkompetenzen": [
                {"kompetenz": "k0", "jahre": 12, "schwerpunkt": false},
                {"kompetenz": "k1", "jahre": 9, "schwerpunkt": false},
                {"kompetenz": "Treasury", "jahre": 7, "schwerpunkt": true},
            ],
            "sprachen": [{"sprache": "Englisch", "niveau": "C1"}],
        })))
        .unwrap();
        let (merged, filled) = merge(&now, &cv);
        assert_eq!(merged.roles, ["Interim CFO", "Head of Finance"]);
        assert_eq!(merged.years, Some(20), "the profile's years stay");
        assert_eq!(
            merged.competences[0].years,
            Some(12),
            "a missing year is filled"
        );
        assert_eq!(
            merged.competences[1].years,
            Some(3),
            "a year the profile has stays"
        );
        let treasury = merged.competences.last().unwrap();
        assert_eq!(treasury.name, "Treasury");
        assert!(!treasury.focus, "five stars already");
        assert_eq!(merged.languages[0].level, LanguageLevel::C1);
        assert_eq!(
            (merged.permanent, merged.day_rate_min),
            (false, Some(1_000))
        );
        assert_eq!(filled, ["roles", "competences", "languages"]);
    }

    /// Without a profile the answer becomes the profile, saved at once.
    #[test]
    fn the_answer_is_saved_as_the_profile() {
        let dir = tempfile::tempdir().unwrap();
        let (info, filled) = import(
            dir.path(),
            &answer(json!({"wunschrollen": ["Interim CFO"], "methoden_tools": ["SAP"]})),
        )
        .unwrap()
        .unwrap();
        assert!(info.parse_error.is_none());
        assert_eq!(filled, ["roles", "tools"]);
        let stored = crate::profile::load(dir.path()).unwrap().unwrap();
        assert_eq!(stored.roles, ["Interim CFO"]);
        assert!(stored.permanent, "the user's choices keep their defaults");
        assert!(
            import(dir.path(), &answer(json!({"x": 1})))
                .unwrap()
                .is_some()
        );
        assert!(
            import(dir.path(), &answer(json!({"sprachen": "x"})))
                .unwrap()
                .is_none()
        );
    }
}
