//! Matching engine: scores a job text against the consultant profile.
//!
//! Pure, synchronous and deterministic; no I/O, integer arithmetic. [`compile_profile`]
//! once per profile, then [`assess`] per job. See `docs/MATCHING.md`.

mod ad_facts;
mod application;
mod atoms;
mod contract;
mod engine;
mod exclusion;
mod explain;
mod factors;
pub(crate) mod facts;
mod fit;
mod focus;
mod job;
mod layout;
pub(crate) mod lexicon;
mod limits;
mod normalize;
mod params;
mod permanent;
mod profile;
mod pyre;
mod relevance;
mod requirements;
mod roles;
mod score;
mod sections;
mod seniority;
mod terms;
mod types;
mod vocabulary;
mod wishes;

use std::collections::BTreeMap;
use std::fmt::Write as _;

use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};

use crate::profile::ProfileForm;

pub use layout::{TextLayout, text_layout};
pub use terms::{CoreTerm, TERM_CHARS, TERM_WORDS, TermField, core_term, is_term, term_key};
pub use types::*;
pub use vocabulary::{Vocabulary, vocabulary};

use engine::EngineProfile;
use facts::{Availability, HardCriteria};

/// Version of the scoring behaviour; part of the match revision (`match_rev`). 4: the
/// Schwerpunkte, target roles and wishes of the profile. 5: frame and soft words as words
/// (not prefixes of skills), real compound boundaries, codes with their number and short
/// skills, multiword terms across dropped words, doctorate and QP. 6: rules from the unseen
/// held-out set 3 (rates next to a currency, reading noise, English language names, texts
/// without requirements, generic heads, a tie-breaker, student roles). 7: a page's
/// structured criteria (a limited employment type, an internship or entry level, the
/// industries). 8: rules from the unseen held-out set 4 (hard facts in the fine print,
/// reading noise, teasers and titles, a single open skill under a foreign title, junior
/// roles for senior profiles, vocabulary). 9: rules from the unseen held-out set 5 (a
/// language is a light fit, the relevance query holds the field, portal tags and rate lines
/// are no requirements, an industry is no function, leadership or generic words alone name
/// no field, entry-level musts, leading titles, salary chips and bonus shares, every years
/// minimum is the target). 10: bugs of the unseen held-out set 6 (the country of the on-site
/// clause, particle words are no `Führung`, shared objects of split lines, stated permanent
/// roles with a comma and denied interim wording, the linking `s` of compounds, teaser terms
/// cap and count half through another field's compound). 11: permanent employment as an
/// excluded contract type (`ausgeschlossene_vertragsarten` names `festanstellung`), decided
/// only for a stated permanent role. 12: the hard criteria read only the ad, not the other
/// listings a portal shows under it. 13: country names in a profile become ISO codes. 14:
/// rules from the unseen held-out set 8 (a part of a total is no years minimum, English ANÜ
/// denials, rate spellings). 15: a heading of the other listings is one only as a whole
/// heading, never a requirement line that starts with its words. 16: ANÜ as a topic of the
/// requirements is no contract form, an hourly wage is employment pay (never a day rate), the
/// workload, the minimum duration and the exclusion words of the profile, rules from the
/// unseen held-out set 9. 17: the application deadline and the contact of an ad (scores
/// unchanged; stored jobs read them on their rescore). 18: the years an ad asks for against
/// the profile's own years (`berufserfahrung_jahre`), never an exclusion, a clearly junior
/// role over-qualified; the target years (`zielprofil_min_jahre`) read no more; pay and
/// duration as the ad states them (ranges, hourly amounts, weeks, a bonus, a salary in
/// another currency unclear). 19: the profile is Profil-JSON v19, read through its typed form
/// only (no free key walk, no synonyms of a competence, no USPs or career stations); the
/// contract types, the work mode (`hybrid` at least partly remote), the workload (full time at
/// least four days, part time at most three) and the starred industries; remote work abroad
/// and the region of permanent roles are no rules any more.
pub const ENGINE_VERSION: u32 = 19;

/// Keys of the facts JSON the engine reads ([`JobInput::facts`]) - the one definition for
/// the engine and for the pipeline that hands it the facts stored from the job page.
pub mod fact_key {
    /// Contract type as the page words it ("Freiberuflich", "Arbeitnehmerüberlassung").
    pub const CONTRACT: &str = "contract";
    /// Work location as the page states it; replaces the location of the alert mail.
    pub const LOCATION: &str = "location";
    /// Remote share in percent (a number).
    pub const REMOTE_PERCENT: &str = "remotePercent";
    /// Rate as the page words it ("95 €/h").
    pub const RATE: &str = "rate";
    /// Start as the page words it ("ab sofort", "01.11.2026").
    pub const START: &str = "start";
    /// Duration as the page words it ("6 Monate").
    pub const DURATION: &str = "duration";
    /// Career level as the page words it (LinkedIn: "Praktikum", "Direktor").
    pub const LEVEL: &str = "level";
    /// Industries as the page lists them (LinkedIn: "Maschinenbau").
    pub const INDUSTRIES: &str = "industries";
    /// Every key the engine reads.
    pub const ALL: &[&str] = &[
        CONTRACT,
        LOCATION,
        REMOTE_PERCENT,
        RATE,
        START,
        DURATION,
        LEVEL,
        INDUSTRIES,
    ];
}

/// Profiles with fewer competences than this are `Thin`.
const THIN_BELOW: usize = 5;
/// Competences listed in the profile summary.
const SUMMARY_COMPETENCES: usize = 40;

/// A profile prepared for matching. Building it never fails.
pub struct CompiledProfile {
    engine: EngineProfile,
    quality: ProfileQuality,
    summary: ProfileSummary,
    fingerprint: String,
}

impl CompiledProfile {
    pub fn quality(&self) -> ProfileQuality {
        self.quality
    }

    pub fn summary(&self) -> &ProfileSummary {
        &self.summary
    }

    /// 16 hex characters of SHA-256 over the engine version and an order-independent view
    /// of what the engine uses from the profile.
    pub fn fingerprint(&self) -> String {
        self.fingerprint.clone()
    }
}

/// Prepares a profile.
pub fn compile_profile(form: &ProfileForm) -> CompiledProfile {
    let engine = EngineProfile::new(form);
    let quality = match engine.skills.entries.len() {
        0 => ProfileQuality::Empty,
        n if n < THIN_BELOW => ProfileQuality::Thin,
        _ => ProfileQuality::Good,
    };
    let summary = summarize(&engine, quality);
    let fingerprint = fingerprint(&engine);
    CompiledProfile {
        engine,
        quality,
        summary,
        fingerprint,
    }
}

/// The hard criteria as understood from the profile.
fn criteria_info(c: &HardCriteria) -> Vec<CriterionInfo> {
    let info = |key, set: bool, params: Value| CriterionInfo {
        key,
        set,
        params: params.as_object().cloned().unwrap_or_default(),
    };
    let available = match c.available {
        Availability::Now => json!("now"),
        Availability::From(day) => json!(day.to_string()),
    };
    vec![
        info(
            CriterionKey::MinDayRate,
            c.min_rate.is_some(),
            json!({ "min": c.min_rate.map(|m| m.to_string()) }),
        ),
        info(
            CriterionKey::Countries,
            c.countries.is_some(),
            json!({ "countries": c.countries }),
        ),
        info(CriterionKey::NoAnue, c.anue_excluded, json!({})),
        info(CriterionKey::NoPermanent, c.permanent_excluded, json!({})),
        info(
            CriterionKey::Availability,
            true,
            json!({ "from": available }),
        ),
        info(
            CriterionKey::MinSalary,
            c.min_salary.is_some(),
            json!({ "min": c.min_salary }),
        ),
        info(
            CriterionKey::Workload,
            c.workload_min.is_some() || c.workload_max.is_some(),
            json!({ "minDays": c.workload_min, "maxDays": c.workload_max }),
        ),
        info(
            CriterionKey::Duration,
            c.min_months.is_some(),
            json!({ "min": c.min_months }),
        ),
        info(
            CriterionKey::ExclusionWords,
            !c.exclusion_words.is_empty(),
            json!({ "words": c.exclusion_words }),
        ),
    ]
}

fn summarize(engine: &EngineProfile, quality: ProfileQuality) -> ProfileSummary {
    let core = &engine.core;
    let mut sources: BTreeMap<String, u16> = BTreeMap::new();
    for entry in core {
        let count = sources.entry(path_pattern(&entry.path)).or_insert(0);
        *count = count.saturating_add(1);
    }
    let criteria = criteria_info(&engine.criteria);
    let warnings = warnings(core.len(), quality, &criteria);
    let wishes = wishes_info(engine);
    let skills = &engine.skills;
    ProfileSummary {
        packs: skills
            .vocab
            .packs()
            .iter()
            .map(|p| (*p).to_owned())
            .collect(),
        years: skills.total_years,
        degrees: skills.degrees.clone(),
        competence_count: u16::try_from(core.len()).unwrap_or(u16::MAX),
        competences: core
            .iter()
            .take(SUMMARY_COMPETENCES)
            .map(|c| c.text.clone())
            .collect(),
        sources: sources
            .into_iter()
            .map(|(path, count)| SourceInfo { path, count })
            .collect(),
        criteria,
        warnings,
        wishes,
    }
}

/// What the user should know about the profile: too few competences, no criterion.
fn warnings(
    competences: usize,
    quality: ProfileQuality,
    criteria: &[CriterionInfo],
) -> Vec<ProfileWarning> {
    let warn = |code, params: Value| ProfileWarning {
        code,
        params: params.as_object().cloned().unwrap_or_default(),
    };
    let mut warnings = Vec::new();
    match quality {
        ProfileQuality::Empty => warnings.push(warn(ProfileWarningCode::NoCompetences, json!({}))),
        ProfileQuality::Thin => {
            warnings.push(warn(
                ProfileWarningCode::FewCompetences,
                json!({ "count": competences }),
            ));
        }
        ProfileQuality::Good => {}
    }
    if criteria.iter().all(|c| !c.set) {
        warnings.push(warn(ProfileWarningCode::NoCriteria, json!({})));
    }
    warnings
}

/// Schwerpunkte, target roles and the wishes as understood.
fn wishes_info(engine: &EngineProfile) -> Vec<WishInfo> {
    let mut wishes = vec![
        WishInfo {
            key: WishKey::Focus,
            set: !engine.focus.is_empty(),
            params: object(json!({
                "focus": engine.focus.iter().map(|f| f.text.clone()).collect::<Vec<_>>(),
            })),
        },
        WishInfo {
            key: WishKey::TargetRoles,
            set: !engine.roles.is_empty(),
            params: object(json!({
                "roles": engine.roles.iter().map(|r| r.text.clone()).collect::<Vec<_>>(),
            })),
        },
    ];
    wishes.extend(engine.wishes.info());
    wishes
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

/// `kernkompetenzen[3].kompetenz` -> `kernkompetenzen[].kompetenz`.
fn path_pattern(path: &str) -> String {
    let mut out = String::with_capacity(path.len());
    let mut in_index = false;
    for c in path.chars() {
        match c {
            '[' => {
                in_index = true;
                out.push_str("[]");
            }
            ']' => in_index = false,
            _ if in_index => {}
            _ => out.push(c),
        }
    }
    out
}

fn fingerprint(engine: &EngineProfile) -> String {
    let mut entries: Vec<String> = engine
        .skills
        .entries
        .iter()
        .map(|e| format!("{}:{:?}", e.atoms.join(" "), e.years))
        .collect();
    entries.sort();
    entries.dedup();
    let mut languages = engine.skills.languages.clone();
    languages.sort();
    let c = &engine.criteria;
    let mut countries = c.countries.clone().unwrap_or_default();
    countries.sort();
    // Schwerpunkte keep their order (the first ones add relevance); roles do not.
    let focus: Vec<String> = engine.focus.iter().map(|f| atoms::fold(&f.text)).collect();
    let mut roles: Vec<String> = engine.roles.iter().map(|r| atoms::fold(&r.text)).collect();
    roles.sort();
    let mut exclusions: Vec<String> = c.exclusion_words.iter().map(|w| atoms::fold(w)).collect();
    exclusions.sort();
    let canonical = format!(
        "engine {ENGINE_VERSION}\nentries {}\nlanguages {languages:?}\ndegree {:?} {}\nyears {:?}\n\
         min {:?}\ncountries {countries:?}\nanue {}\npermanent {}\navailable {:?}\n\
         salary {:?}\npacks {:?}\n\
         focus {focus:?}\nroles {roles:?}\nwishes {}\nworkload {:?} {:?}\nmonths {:?}\n\
         exclusions {exclusions:?}\n",
        entries.join("|"),
        engine.skills.degree_fields,
        engine.skills.degree_level,
        engine.skills.total_years,
        c.min_rate,
        c.anue_excluded,
        c.permanent_excluded,
        c.available,
        c.min_salary,
        engine.skills.vocab.packs(),
        engine.wishes.canonical(),
        c.workload_min,
        c.workload_max,
        c.min_months,
    );
    let digest = Sha256::digest(canonical.as_bytes());
    digest.iter().take(8).fold(String::new(), |mut hex, b| {
        let _ = write!(hex, "{b:02x}");
        hex
    })
}

/// The hard criteria of a profile with their thresholds, as the profile summary names them
/// (the AI prompts state them next to the ad's values).
pub(crate) fn profile_criteria(form: &ProfileForm) -> Vec<CriterionInfo> {
    criteria_info(&HardCriteria::new(form))
}

/// A language level as the engine reads it: CEFR 1 (A1) to 6 (C2), 7 native.
pub(crate) fn language_level(text: &str) -> Option<u8> {
    job::level_in(text)
}

/// Assesses one job; `None` when the profile is `Empty` (nothing is scored then).
pub fn assess(
    profile: &CompiledProfile,
    job: &JobInput<'_>,
    embedder: Option<&dyn Embedder>,
) -> Option<Assessment> {
    let _ = embedder; // Semantic matching is a later experiment.
    if profile.quality == ProfileQuality::Empty {
        return None;
    }
    let evaluation = engine::evaluate(&profile.engine, job);
    Some(explain::assessment(&profile.engine, job.text, &evaluation))
}

/// Cheap relevance of a job from its title (per-mille), to order fetches before any text
/// is known: the title against the profile's field and its target roles (`Interim CFO`,
/// `Head of Finance`), as the engine reads a title. The location is not used yet.
pub fn prescore(profile: &CompiledProfile, title: &str, location: &str) -> u16 {
    let _ = location;
    let engine = &profile.engine;
    let fit = relevance::title_fit(&engine.title_query, title, &engine.skills.vocab);
    u16::try_from(fit.min(1000)).unwrap_or(1000)
}
