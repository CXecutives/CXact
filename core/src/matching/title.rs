//! The frame of a job title (engine 23): the title without its noise (IDs, HTML entities,
//! gender markers, tails of place and duration), the level of its head noun on a ladder of
//! six, and the field family the title and the musts name.
//!
//! The ladder: 1 clerical and agent work, 2 specialist, consultant and officer, 3 senior and
//! project lead, 4 team lead, 5 the lead of a function, 6 director, division, interim
//! manager and C-level. A title's level is its highest head noun before a word that names
//! whom the role serves (`Assistenz der Geschäftsführung` is 1); `Senior` raises a level 1 or
//! 2 by one; the ad's own words make a role a lead role (`disziplinarische Führung`, at least
//! 4) or one without staff (`ohne Personalverantwortung`, at most 3). The profile's levels are
//! those of its target roles, else one from its years. For the levels below the profile a
//! specialist stands with a senior (the rubric's ladder: `Spezialist, Senior und Referent`),
//! and consulting and project heads are engagements of every level, never below.
//!
//! The field families group the domain packs (`FIELD_PACKS`); an ad's family is the one the
//! title (three times) and the musts trigger most; its distance to the profile's families is
//! same, near (`NEAR_FIELDS`) or far.

use std::collections::HashMap;
use std::sync::LazyLock;

use regex::Regex;

use super::atoms::{fold, raw_tokens};
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine as lex;
use super::normalize::{any_word, contains_word, holds_any};
use super::relevance;

/// The title without its noise: HTML entities decoded, a leading ID (`1083881 Power
/// Platform Entwickler`) dropped, gender markers and tails without a skill cut
/// ([`relevance::clean_title`]).
pub(crate) fn clean(title: &str) -> String {
    let mut text = title.to_owned();
    for (entity, plain) in [
        ("&amp;", "&"),
        ("&nbsp;", " "),
        ("&quot;", "\""),
        ("&#39;", "'"),
        ("&apos;", "'"),
        ("&lt;", "<"),
        ("&gt;", ">"),
    ] {
        text = text.replace(entity, plain);
    }
    let trimmed = text.trim_start();
    let id_end = trimmed
        .find(|c: char| !c.is_ascii_digit())
        .unwrap_or(trimmed.len());
    if id_end >= 4 && trimmed[id_end..].starts_with([' ', '-', ':', '|']) {
        text = trimmed[id_end..]
            .trim_start_matches([' ', '-', ':', '|'])
            .to_owned();
    }
    relevance::clean_title(&text)
}

/// The head word a token is or ends with (the longest) and its level.
fn head_level(token: &str) -> Option<(&'static str, u8)> {
    lex::TITLE_HEADS
        .iter()
        .filter(|(head, _)| {
            token == *head || (token.len() >= head.len() + 3 && token.ends_with(head))
        })
        .max_by_key(|(head, _)| head.len())
        .copied()
}

/// The level of a title's head noun (none when it names no head: `Customer Service`) and
/// whether a head of it is an engagement of every level (`TITLE_ENGAGEMENTS`).
fn head_of(title: &str) -> (Option<u8>, bool) {
    /// A title names a level only with a head, a head phrase or a senior word in it.
    static LEVEL_WORD: LazyLock<Regex> = LazyLock::new(|| {
        let heads = lex::TITLE_HEADS.iter().chain(lex::TITLE_HEAD_PHRASES);
        any_word(
            heads
                .map(|(head, _)| *head)
                .chain(lex::TITLE_SENIOR.iter().copied()),
        )
    });
    let mut folded = fold(title);
    if !LEVEL_WORD.is_match(&folded) {
        return (None, false);
    }
    let mut level: Option<u8> = None;
    let mut engagement = false;
    for &(phrase, phrase_level) in lex::TITLE_HEAD_PHRASES {
        if contains_word(&folded, phrase) {
            level = level.max(Some(phrase_level));
            engagement |= lex::TITLE_ENGAGEMENTS.contains(&phrase);
            folded = folded.replace(phrase, " ");
        }
    }
    let mut senior = false;
    for token in raw_tokens(&folded) {
        if lex::TITLE_SERVES.contains(&token) {
            break;
        }
        senior |= lex::TITLE_SENIOR.contains(&token);
        if let Some((head, head_level)) = head_level(token) {
            level = level.max(Some(head_level));
            engagement |= lex::TITLE_ENGAGEMENTS.contains(&head);
        }
    }
    // `Senior` without a head names no rung (`Senior HR Business Partner`).
    match level {
        Some(l @ 1..=2) if senior => (Some(l + 1), engagement),
        None if senior => (Some(3), true),
        other => (other, engagement),
    }
}

/// The level of a title's head noun (none when it names no head: `Customer Service`).
pub(crate) fn level_of(title: &str) -> Option<u8> {
    head_of(title).0
}

/// Does the title name an engagement of every level (`Senior Berater`, `Projektleiter`), not
/// a rung below a lead (`Senior Qualitätsingenieur`)?
pub(crate) fn engagement(title: &str) -> bool {
    head_of(title).1
}

/// The level of an ad: its title's, moved by what the ad says of staff, or operative work
/// where the title names no head and the ad asks for a vocational training (`folded`: the
/// folded ad without the other listings under it).
pub(crate) fn ad_level(title: &str, folded: &str) -> Option<u8> {
    let level = level_of(title);
    if holds_any(folded, lex::NO_LEAD_CUES) {
        return level.map(|l| l.min(3));
    }
    if holds_any(folded, lex::LEAD_CUES) {
        return Some(level.map_or(4, |l| l.max(4)));
    }
    // A title without a head noun whose ad asks for a vocational training is operative work.
    if level.is_none() && holds_any(folded, lex::OPERATIVE_CUES) {
        return Some(1);
    }
    level
}

/// Operative levels (the owner's rule): clerical and agent work (1) and team lead (4); the
/// only ones a profile without target roles is judged above, by its years.
const OPERATIVE: [u8; 2] = [1, 4];

/// The rung of a level on the line of the rubric's ladder: a specialist (2) stands with a
/// senior (3); an engagement of every level (consulting, a project) at 2 or 3 stands on none.
fn rung(level: u8, engagement: bool) -> Option<u8> {
    match level {
        2 | 3 if engagement => None,
        2 => Some(3),
        l => Some(l),
    }
}

/// The profile's levels: those of its target roles (wished), their rungs on the line, and
/// the highest level, else one from its years (`years_level`).
#[derive(Debug, Clone, Default)]
pub(crate) struct ProfileLevel {
    pub wished: Vec<u8>,
    line: Vec<u8>,
    pub top: Option<u8>,
}

impl ProfileLevel {
    pub(crate) fn new<'a>(roles: impl IntoIterator<Item = &'a str>, years: Option<u32>) -> Self {
        let heads: Vec<(Option<u8>, bool)> = roles.into_iter().map(head_of).collect();
        let sorted = |mut v: Vec<u8>| {
            v.sort_unstable();
            v.dedup();
            v
        };
        let wished = sorted(heads.iter().filter_map(|h| h.0).collect());
        let line = sorted(
            heads
                .iter()
                .filter_map(|&(l, e)| l.and_then(|l| rung(l, e)))
                .collect(),
        );
        let top = wished.last().copied().or_else(|| years.map(years_level));
        Self { wished, line, top }
    }

    /// How many levels an ad stands below the profile (the owner's rule: two or more cap,
    /// unless a target role names the level): its rung below the nearest rung a target role
    /// names at or above it; a profile without target roles judges an operative ad (clerical
    /// and agent work, team lead) by its years. A specialist or a senior specialist is a rung
    /// (`Senior Qualitätsingenieur` for a plant manager); consulting and project roles
    /// (`engagement`) are engagements of every level and a lead of a function is the tier of
    /// a director's mandate: never below a profile (0 for them, or no level to judge).
    pub(crate) fn gap(&self, ad: Option<u8>, engagement: bool) -> u8 {
        let Some((level, rung)) = ad.and_then(|l| rung(l, engagement).map(|r| (l, r))) else {
            return 0;
        };
        if rung >= 5 {
            return 0;
        }
        match self.line.iter().find(|&&w| w >= rung) {
            Some(&wished) => wished - rung,
            None if self.wished.is_empty() && OPERATIVE.contains(&level) => {
                self.top.map_or(0, |top| top.saturating_sub(level))
            }
            None => 0,
        }
    }
}

/// The level years of experience stand for when the profile names no target role.
fn years_level(years: u32) -> u8 {
    match years {
        0..=2 => 2,
        3..=7 => 3,
        8..=14 => 4,
        _ => 5,
    }
}

/// The family of a domain pack.
fn family_of_pack(pack: &str) -> Option<&'static str> {
    lex::FIELD_PACKS
        .iter()
        .find(|(_, packs)| packs.contains(&pack))
        .map(|(family, _)| *family)
}

/// The field families of a profile: those of its switched-on packs.
pub(crate) fn profile_fields(packs: &[&'static str]) -> Vec<&'static str> {
    let mut out: Vec<&'static str> = packs.iter().filter_map(|p| family_of_pack(p)).collect();
    out.sort_unstable();
    out.dedup();
    out
}

/// Every trigger of the packs with the families it stands for (a bit per index in
/// `FIELD_PACKS`).
static TRIGGERS: LazyLock<HashMap<&'static str, u16>> = LazyLock::new(|| {
    let mut triggers: HashMap<&'static str, u16> = HashMap::new();
    for domain in DOMAINS {
        let family = family_of_pack(domain.name);
        if let Some(index) = lex::FIELD_PACKS
            .iter()
            .position(|(f, _)| Some(*f) == family)
        {
            for trigger in domain.triggers {
                *triggers.entry(trigger).or_default() |= 1 << index;
            }
        }
    }
    triggers
});

/// Trigger hits of each family in a text (`weight` per hit, once per pack and token): a
/// token is hit by the triggers it starts with.
fn tally(text: &str, weight: u32, hits: &mut [u32]) {
    let folded = fold(text);
    for token in raw_tokens(&folded) {
        let starts = token.char_indices().skip(1).map(|(at, _)| &token[..at]);
        let families = starts
            .chain([token])
            .filter_map(|start| TRIGGERS.get(start))
            .fold(0, |all, families| all | families);
        for (index, hit) in hits.iter_mut().enumerate() {
            if families & (1 << index) != 0 {
                *hit += weight;
            }
        }
    }
}

/// Does a text name a field family (a trigger of one of its packs)?
pub(crate) fn names_field(text: &str, family: &str) -> bool {
    let Some(index) = lex::FIELD_PACKS.iter().position(|(f, _)| *f == family) else {
        return false;
    };
    let mut hits = vec![0u32; lex::FIELD_PACKS.len()];
    tally(text, 1, &mut hits);
    hits[index] > 0
}

/// How far an ad's field lies from the profile's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Distance {
    Same,
    Near,
    Far,
}

/// Title hits weigh this many times a must's.
const TITLE_WEIGHT: u32 = 3;
/// An ad names a field with at least this many weighted hits.
const FIELD_HITS: u32 = 3;

/// The ad's field family and its distance to the profile's families: the family the title
/// and the musts trigger most (at least `FIELD_HITS`); a tie with a family of the profile
/// counts as the same field. None without a family on either side.
pub(crate) fn field<'a>(
    profile: &[&'static str],
    title: &str,
    musts: impl IntoIterator<Item = &'a str>,
) -> Option<(&'static str, Distance)> {
    if profile.is_empty() {
        return None;
    }
    let mut hits = vec![0u32; lex::FIELD_PACKS.len()];
    tally(title, TITLE_WEIGHT, &mut hits);
    for must in musts {
        tally(must, 1, &mut hits);
    }
    let best = *hits.iter().max()?;
    if best < FIELD_HITS {
        return None;
    }
    let top: Vec<&'static str> = lex::FIELD_PACKS
        .iter()
        .zip(&hits)
        .filter(|(_, h)| **h == best)
        .map(|((family, _), _)| *family)
        .collect();
    if let Some(same) = top.iter().find(|f| profile.contains(f)) {
        return Some((same, Distance::Same));
    }
    let family = top[0];
    let near = lex::NEAR_FIELDS.iter().any(|&(a, b)| {
        (a == family && profile.contains(&b)) || (b == family && profile.contains(&a))
    });
    Some((family, if near { Distance::Near } else { Distance::Far }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_head_noun_gives_the_level() {
        let level = |t: &str| level_of(&clean(t));
        assert_eq!(level("Sachbearbeiter Kreditoren (m/w/d)"), Some(1));
        assert_eq!(level("Kundenbetreuer Road Assistance"), Some(1));
        assert_eq!(level("Assistenz der Geschäftsführung"), Some(1));
        assert_eq!(
            level("Referent Kundenkontakt Technik und Reporting"),
            Some(2)
        );
        assert_eq!(level("Senior Consultant SAP FI"), Some(3));
        assert_eq!(level("Senior Project Manager"), Some(3));
        assert_eq!(level("Projektleiter Customer Service"), Some(3));
        assert_eq!(level("Teamleiter Call Center"), Some(4));
        assert_eq!(level("Interim Teamleiter / Lead SAP Solutions"), Some(4));
        assert_eq!(level("Leiter Service Management"), Some(5));
        assert_eq!(level("Interim Head of Customer Service"), Some(5));
        assert_eq!(level("Senior Customer Insights Manager"), Some(5));
        assert_eq!(level("Key Account Manager Telekommunikation"), Some(2));
        assert_eq!(level("Bereichsleiter Finanzen"), Some(6));
        assert_eq!(level("Interim Manager Customer Operations"), Some(6));
        assert_eq!(level("Interim CFO (m/w/d)"), Some(6));
        assert_eq!(level("Coach für CTO"), Some(3));
        assert_eq!(level("Customer Service"), None);
    }

    #[test]
    fn the_ad_says_whether_the_role_leads() {
        assert_eq!(
            ad_level(
                "Referent Controlling",
                &fold("Sie übernehmen die disziplinarische Führung von 4 Mitarbeitenden.")
            ),
            Some(4)
        );
        assert_eq!(
            ad_level(
                "Head of Reporting",
                &fold("Die Rolle ist ohne Personalverantwortung.")
            ),
            Some(3)
        );
        assert_eq!(
            ad_level(
                "Customer Service",
                &fold("Abgeschlossene kaufmännische Ausbildung")
            ),
            Some(1)
        );
    }

    #[test]
    fn noise_leaves_the_title() {
        assert_eq!(
            clean("1083881 Power Platform/D365 Entwickler"),
            "Power Platform/D365 Entwickler"
        );
        assert_eq!(clean("R&amp;D Manager (m/w/d)"), "R&D Manager");
    }

    #[test]
    fn levels_below_the_profile() {
        let p = ProfileLevel::new(["Interim CFO", "Leiter Controlling"], Some(25));
        assert_eq!((p.top, p.wished.clone()), (Some(6), vec![5, 6]));
        assert_eq!(p.gap(Some(5), false), 0, "a target role names it");
        assert_eq!(p.gap(Some(4), false), 1);
        assert_eq!(p.gap(Some(1), false), 4);
        assert_eq!(
            ProfileLevel::new(["Interim CFO"], None).gap(Some(5), false),
            0
        );
        assert_eq!(p.gap(Some(3), true), 0, "a project role is no level below");
        assert_eq!(p.gap(Some(2), true), 0, "nor is a consultant");
        assert_eq!(p.gap(None, false), 0);
        let years = ProfileLevel::new([], Some(20));
        assert_eq!(
            (
                years.top,
                years.gap(Some(1), false),
                years.gap(Some(2), false)
            ),
            (Some(5), 4, 0)
        );
    }

    /// A senior specialist is a rung, not an engagement of every level: two below a plant
    /// manager it caps, a senior consultant or a project lead stays level with any profile,
    /// and a target role at the specialist's rung brings it within one.
    #[test]
    fn a_senior_specialist_is_a_rung_below_a_lead() {
        let plant = ProfileLevel::new(["Interim Werksleiter", "Interim COO"], Some(18));
        let gap = |p: &ProfileLevel, t: &str| p.gap(level_of(t), engagement(t));
        assert_eq!(gap(&plant, "Senior Qualitätsingenieur Serienbetreuung"), 2);
        assert_eq!(
            gap(&plant, "Qualitätsingenieur"),
            2,
            "a specialist stands with a senior"
        );
        assert_eq!(gap(&plant, "Senior Berater Qualitätsmanagement"), 0);
        assert_eq!(gap(&plant, "Lead Consultant Operational Excellence"), 0);
        assert_eq!(gap(&plant, "Projektleiter Werksverlagerung"), 0);
        assert_eq!(
            gap(&plant, "Kundenberater Innendienst"),
            4,
            "a clerk is no consultant"
        );
        assert_eq!(
            gap(&plant, "Senior HR Business Partner"),
            0,
            "no head, no rung"
        );
        let lead = ProfileLevel::new(["Teamleiter Qualität"], None);
        assert_eq!(gap(&lead, "Qualitätsingenieur"), 1);
        let engineer = ProfileLevel::new(["Senior Qualitätsingenieur", "Werksleiter"], None);
        assert_eq!(gap(&engineer, "Qualitätsingenieur"), 0);
    }

    #[test]
    fn the_field_of_an_ad() {
        let cx = ["service"];
        let far = field(
            &cx,
            "Java Backend Entwickler",
            ["Spring Boot", "Kubernetes", "AWS"],
        );
        assert_eq!(far.map(|f| f.1), Some(Distance::Far));
        let same = field(
            &cx,
            "Leiter Kundenservice",
            ["Contact Center", "Beschwerdemanagement"],
        );
        assert_eq!(same.map(|f| f.1), Some(Distance::Same));
    }
}
