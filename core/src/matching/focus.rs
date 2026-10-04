//! Schwerpunkte (`ENGINE_VERSION` 4, the competences with the star since 19): the up to five
//! core competences the consultant wants to be booked for.
//!
//! A requirement (section or sentence stage, must or nice, met in full) that names such a
//! competence in full weighs `FOCUS_FACTOR` times in `M` and `K`. A Schwerpunkt named in full
//! by a requirement or by the title is demanded and adds `FOCUS_RELEVANCE` to the relevance
//! (at most `FOCUS_RELEVANCE_MAX` of them); a narrower requirement names it in half (shown,
//! no effect). An ad that demands none gets nothing, never less.

use super::atoms::fold;
use super::fit::{self, ItemFit, Skills};
use super::job::{Class, Item, Stage};
use super::params::{E_FULL, E_NONE, FOCUS_MAX};
use super::types::Via;
use crate::profile::{ProfileForm, key};

/// A Schwerpunkt and the profile entries that are it.
#[derive(Debug, Clone)]
pub(crate) struct Focus {
    /// As written in the profile.
    pub text: String,
    /// JSON path, e.g. `kernkompetenzen[1].kompetenz`.
    pub path: String,
    /// Indices into [`Skills::entries`]: the competence.
    pub entries: Vec<usize>,
}

/// The Schwerpunkte of a profile: its starred competences (at most `FOCUS_MAX`), each with
/// the entry that is it (a competence without words the engine reads is none).
pub(crate) fn of_profile(skills: &Skills, form: &ProfileForm) -> Vec<Focus> {
    form.competences
        .iter()
        .enumerate()
        .filter(|(_, c)| c.focus)
        .take(FOCUS_MAX)
        .filter_map(|(i, c)| {
            let folded = fold(&c.name);
            let entries: Vec<usize> = skills
                .entries
                .iter()
                .enumerate()
                .filter(|(_, e)| fold(&e.text) == folded)
                .map(|(i, _)| i)
                .collect();
            (!entries.is_empty()).then(|| Focus {
                text: c.name.trim().to_owned(),
                path: format!("{}[{i}].{}", key::COMPETENCES, key::COMPETENCE),
                entries,
            })
        })
        .collect()
}

/// The Schwerpunkt a requirement names (the best, the first on a tie) and whether in full:
/// every word of the Schwerpunkt in the requirement (exact, stem, synonym, light compound)
/// while the requirement itself is met in full (`item_value`); a narrower requirement
/// (`Tableau im Reporting` for `Reporting`) names it in half. A broader requirement that
/// only lies inside the Schwerpunkt (`SAP S/4HANA` for `SAP S/4HANA Finance`) does not
/// name it: the ad asks for less than the Schwerpunkt.
pub(crate) fn of_item(
    skills: &Skills,
    focus: &[Focus],
    item: &Item,
    item_value: u16,
) -> Option<(usize, bool)> {
    if item.class != Class::Skill || item.stage == Stage::Vocabulary {
        return None;
    }
    let (index, fit) = focus
        .iter()
        .enumerate()
        .map(|(i, f)| (i, fit::focus_fit(skills, item, &f.entries)))
        .filter(|(_, fit)| fit.value > E_NONE && fit.via != Via::Specific)
        .fold(
            None,
            |best: Option<(usize, ItemFit)>, (i, fit)| match best {
                Some((_, b)) if b.value >= fit.value => best,
                _ => Some((i, fit)),
            },
        )?;
    Some((index, fit.value == E_FULL && item_value == E_FULL))
}

/// Which Schwerpunkte the title names.
pub(crate) fn in_title(skills: &Skills, focus: &[Focus], title: &str) -> Vec<bool> {
    focus
        .iter()
        .map(|f| fit::title_names(skills, title, &f.entries))
        .collect()
}
