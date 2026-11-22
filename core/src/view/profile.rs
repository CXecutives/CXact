//! The profile as the interface shows it: what the app understood of it, the editor's save
//! and the terms the ads ask for that the profile does not cover.

use std::collections::{BTreeMap, BTreeSet, HashMap};

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::{LanguageLevel, ProfileForm, TermField};
use crate::error::ErrorInfo;
use crate::matching::{self, CoreTerm, ProfileSummary};
use crate::model::Notice;
use crate::pipeline::{LocalMatcher, Matcher, local};
use crate::store::Store;

/// How much the app understood of the profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ProfileQuality {
    Good,
    Thin,
    /// Nothing usable - jobs are not scored.
    Empty,
}

impl From<matching::ProfileQuality> for ProfileQuality {
    fn from(quality: matching::ProfileQuality) -> ProfileQuality {
        match quality {
            matching::ProfileQuality::Good => ProfileQuality::Good,
            matching::ProfileQuality::Thin => ProfileQuality::Thin,
            matching::ProfileQuality::Empty => ProfileQuality::Empty,
        }
    }
}

/// A part of the profile file the terms for the match come from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileSource {
    /// JSON path pattern (`kernkompetenzen[].kompetenz`, `methoden_tools[]`).
    pub path: String,
    /// Terms read there.
    pub count: u32,
}

/// "What the app understood" of the profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileUnderstanding {
    pub competence_count: u32,
    pub competences: Vec<String>,
    /// Where the terms come from.
    pub sources: Vec<ProfileSource>,
    pub criteria: Vec<Notice>,
    pub warnings: Vec<Notice>,
    /// Domain packs the profile switched on (`finance`, `sap`, `itProject`, ...).
    pub packs: Vec<String>,
    /// Total years of professional experience, if the profile states them.
    pub years: Option<u32>,
    /// Degrees as written in the profile.
    pub degrees: Vec<String>,
}

/// The stored consultant profile.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileInfo {
    /// Name of the file the user chose (else the stored file name).
    pub file_name: String,
    pub bytes: u64,
    pub saved_at: Option<Timestamp>,
    pub quality: Option<ProfileQuality>,
    pub understood: Option<ProfileUnderstanding>,
    pub scored_at: Option<Timestamp>,
    /// Jobs still waiting for a score with this profile.
    pub pending: u32,
    /// The file does not read as a profile (edited by hand, or of another version).
    pub parse_error: Option<ErrorInfo>,
    /// The profile as the editor shows it (`null` while the file does not read).
    pub form: Option<ProfileForm>,
    /// The `ProfileForm` fields a usable profile still needs (core `missing_required`).
    #[cfg_attr(test, ts(type = "Array<keyof ProfileForm>"))]
    pub missing: Vec<String>,
}

impl ProfileInfo {
    pub fn of(info: &crate::profile::ProfileInfo, file_name: Option<String>) -> ProfileInfo {
        let own = info
            .path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned());
        ProfileInfo {
            file_name: file_name
                .or(own)
                .unwrap_or_else(|| crate::profile::PROFILE_FILE.to_string()),
            bytes: info.bytes,
            saved_at: info.saved_at,
            quality: None,
            understood: None,
            scored_at: None,
            pending: 0,
            parse_error: info.parse_error.as_ref().map(ErrorInfo::from),
            form: None,
            missing: Vec::new(),
        }
    }

    /// Adds the form of the editor and what it still needs.
    #[must_use]
    pub fn with_form(mut self, form: Option<ProfileForm>) -> Self {
        self.missing = form
            .as_ref()
            .map(|f| {
                crate::profile::missing_required(f)
                    .into_iter()
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default();
        self.form = form;
        self
    }

    /// Adds what the engine understood of the profile, how far the jobs are scored with it
    /// (an empty profile scores nothing, so nothing is pending).
    pub fn understood_by(mut self, matcher: &LocalMatcher, store: &Store) -> crate::Result<Self> {
        let profile = matcher.profile();
        self.quality = Some(profile.quality().into());
        self.understood = Some(understanding(profile.summary()));
        if matcher.usable() {
            self.scored_at = store.scored_at(matcher.rev())?;
            self.pending = store.match_pending(matcher.rev())?;
        }
        Ok(self)
    }
}

/// The "understood" card: competences, where they were found (path patterns), every hard
/// criterion as `{code, params}` with `set`, and the warnings.
pub fn understanding(summary: &ProfileSummary) -> ProfileUnderstanding {
    ProfileUnderstanding {
        competence_count: u32::from(summary.competence_count),
        competences: summary.competences.clone(),
        sources: summary
            .sources
            .iter()
            .map(|s| ProfileSource {
                path: s.path.clone(),
                count: u32::from(s.count),
            })
            .collect(),
        criteria: summary
            .criteria
            .iter()
            .map(|c| {
                let mut params = local::ui_params(&c.params);
                params.insert("set".into(), c.set.into());
                Notice {
                    code: c.key.into(),
                    params,
                }
            })
            .collect(),
        warnings: summary.warnings.iter().map(profile_warning).collect(),
        packs: summary.packs.clone(),
        years: summary.years,
        degrees: summary.degrees.clone(),
    }
}

/// A warning of the engine about the profile.
fn profile_warning(warning: &matching::ProfileWarning) -> Notice {
    Notice {
        code: warning.code.into(),
        params: local::ui_params(&warning.params),
    }
}

/// Saving the editor: the form as it was handed out (`before`) and as the user left it; what
/// the user changed is applied to the stored profile (`profile::save_form`).
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileSave {
    pub before: ProfileForm,
    pub after: ProfileForm,
}

/// The days "Häufig verlangt" looks back.
pub const ASKED_DAYS: i64 = 30;
/// Most terms "Häufig verlangt" names.
pub const MAX_ASKED: usize = 8;
/// A term counts as often asked from this many jobs on (one job is no pattern).
pub const MIN_ASKED: u32 = 2;

/// A term the ads ask for that the profile does not cover, the field of the profile it
/// belongs to, and in how many jobs ("Häufig verlangt" in the Profil).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct AskedTerm {
    /// The term in the ad's words, without what only says that or how much it is wanted
    /// ("Anaplan" of "Kenntnisse in Anaplan"; of the newest job that asks for it).
    pub term: String,
    pub field: TermField,
    pub count: u32,
    /// The level a language goes into the profile with: the one the ad asks for, else B2 (the
    /// engine's assumed level); none for any other field.
    pub level: Option<LanguageLevel>,
}

/// The level a language term goes into the profile with (`AskedTerm::level`); none for any
/// other field.
pub(super) fn term_level(core: &CoreTerm, label: &str) -> Option<LanguageLevel> {
    (core.field == TermField::Language)
        .then(|| LanguageLevel::of_engine(matching::language_level(label).unwrap_or(4)))
        .flatten()
}

/// "Häufig verlangt" at `now`: the terms of the open requirements of the scored jobs of the
/// inbox and the archive of the last [`ASKED_DAYS`] days (the engine's open must and nice
/// requirements that are skills and hold a term, `pipeline::local::terms`), each with its
/// field (`matching::core_term`), counted once per job however written ("Kenntnisse in
/// Anaplan" and "Anaplan-Erfahrung" are one), asked by at least [`MIN_ASKED`] jobs, the most
/// frequent first (equal counts by their words), at most [`MAX_ASKED`]. A term the profile
/// (`form`) already names (`named_terms`) is none of them: its jobs may not be scored again
/// yet after a save. One pass over the stored notes, each distinct requirement read once.
pub fn asked_terms(
    store: &Store,
    form: Option<&ProfileForm>,
    now: Timestamp,
) -> crate::Result<Vec<AskedTerm>> {
    let since = now
        .checked_sub(jiff::SignedDuration::from_hours(24 * ASKED_DAYS))
        .unwrap_or(Timestamp::UNIX_EPOCH);
    let known = form.map(named_terms).unwrap_or_default();
    let mut cores: HashMap<String, Option<CoreTerm>> = HashMap::new();
    // Per key the term of the newest job (the store's order), the count and the level.
    let mut counted: BTreeMap<String, (CoreTerm, u32, Option<LanguageLevel>)> = BTreeMap::new();
    for labels in store.asked_terms(since)? {
        let mut seen = BTreeSet::new();
        for label in labels {
            let core = cores
                .entry(label.clone())
                .or_insert_with_key(|l| matching::core_term(l));
            let Some(core) = core.as_ref() else {
                continue;
            };
            let key = core.key();
            if known.contains(key) || !seen.insert(key.to_owned()) {
                continue;
            }
            let entry = counted
                .entry(key.to_owned())
                .or_insert_with(|| (core.clone(), 0, term_level(core, &label)));
            // An ad that names the field says more than one that names the term alone
            // ("Branchenerfahrung Handel", "Handel").
            if entry.0.field == TermField::Competence {
                entry.0.field = core.field;
            }
            entry.1 += 1;
        }
    }
    let mut asked: Vec<(CoreTerm, u32, Option<LanguageLevel>)> = counted
        .into_values()
        .filter(|(_, count, _)| *count >= MIN_ASKED)
        .collect();
    asked.sort_by(|(a, n, _), (b, m, _)| {
        m.cmp(n)
            .then_with(|| matching::term_key(&a.term).cmp(&matching::term_key(&b.term)))
    });
    Ok(asked
        .into_iter()
        .take(MAX_ASKED)
        .map(|(core, count, level)| AskedTerm {
            term: core.term,
            field: core.field,
            count,
            level,
        })
        .collect())
}

/// What the profile names already, by the keys of its terms: every competence, tool,
/// certificate, degree, industry and language, by its words and by its term (`Englisch`
/// names `English`, `Energiewirtschaft` names `Energie`, see `matching::CoreTerm::key`).
fn named_terms(form: &ProfileForm) -> BTreeSet<String> {
    let entries = form
        .competences
        .iter()
        .map(|c| &c.name)
        .chain(&form.tools)
        .chain(&form.certificates)
        .chain(&form.degrees)
        .chain(&form.industries)
        .chain(form.languages.iter().map(|l| &l.language));
    let mut known = BTreeSet::new();
    for entry in entries {
        known.insert(matching::term_key(entry));
        if let Some(core) = matching::core_term(entry) {
            known.insert(core.key().to_owned());
        }
    }
    known.remove("");
    known
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::MatchStatus;
    use crate::model::Posting;
    use crate::portal::job_link;
    use crate::store::MailRef;
    use crate::view::test_support::*;
    use crate::view::*;
    use std::path::PathBuf;

    /// "What the app understood": quality, competences, sources, criteria and warnings as
    /// codes; the pending count follows the stored revisions.
    #[test]
    fn the_profile_summary_reaches_the_interface() {
        let matcher = crate::pipeline::dry_run::matcher();
        let (store, key) = job_with_text(AD);
        let file = crate::profile::ProfileInfo {
            path: PathBuf::from("beraterprofil.json"),
            bytes: 10,
            saved_at: None,
            parse_error: None,
        };
        let info = ProfileInfo::of(&file, None)
            .understood_by(&matcher, &store)
            .unwrap();
        assert_eq!(info.quality, Some(ProfileQuality::Good));
        assert_eq!((info.pending, info.scored_at), (1, None));
        let understood = info.understood.unwrap();
        assert!(understood.competences.len() <= 40);
        assert!(understood.competence_count as usize >= understood.competences.len());
        assert!(understood.competences.iter().any(|c| c == "Controlling"));
        assert!(
            understood
                .sources
                .iter()
                .any(|s| s.path == "kernkompetenzen[].kompetenz" && s.count > 0)
        );
        let names: Vec<(String, bool)> = understood
            .criteria
            .iter()
            .map(|c| (local::code_name(&c.code), c.params["set"] == true))
            .collect();
        let criteria: Vec<(&str, bool)> = names.iter().map(|(n, set)| (n.as_str(), *set)).collect();
        assert_eq!(
            criteria,
            [
                ("minDayRate", true),
                ("countries", true),
                ("noAnue", true),
                ("noPermanent", false),
                ("noProject", false),
                ("availability", true),
                ("minSalary", false),
                ("workload", false),
                ("duration", false),
                ("exclusionWords", false),
            ]
        );
        assert!(understood.warnings.is_empty());
        let now = Timestamp::now();
        job_detail(&store, &key, Some(&matcher), true, now).unwrap();
        let info = ProfileInfo::of(&file, None)
            .understood_by(&matcher, &store)
            .unwrap();
        assert_eq!(info.pending, 0);
        assert_eq!(
            info.scored_at.map(Timestamp::as_second),
            Some(now.as_second())
        );
        let thin = LocalMatcher::from_form(&ProfileForm {
            tools: vec!["SAP FI".into()],
            countries: Vec::new(),
            ..ProfileForm::default()
        });
        let info = ProfileInfo::of(&file, None)
            .understood_by(&thin, &store)
            .unwrap();
        assert_eq!(info.quality, Some(ProfileQuality::Thin));
        let warnings = info.understood.unwrap().warnings;
        let codes: Vec<String> = warnings.iter().map(|w| local::code_name(&w.code)).collect();
        assert_eq!(codes, ["fewCompetences"]);
        let empty = LocalMatcher::from_form(&ProfileForm::default());
        let info = ProfileInfo::of(&file, None)
            .understood_by(&empty, &store)
            .unwrap();
        assert_eq!(
            (info.quality, info.pending),
            (Some(ProfileQuality::Empty), 0)
        );
    }

    /// Jobs of the last days, one per list of open terms, their alert mails a day apart.
    fn jobs_asking(lists: &[&[&str]], now: Timestamp) -> Store {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let mut judged = Vec::new();
        for (i, terms) in lists.iter().enumerate() {
            let link = job_link(&format!(
                "https://www.linkedin.com/jobs/view/{}/",
                4_200_000_000 + i
            ))
            .unwrap();
            let posting = Posting::new(link.key.clone(), link.url, "Rolle", "Firma", "Köln");
            let day = jiff::SignedDuration::from_hours(24 * i64::try_from(i).unwrap());
            let mail = MailRef {
                subject: "x",
                date: Some(now - day),
                gmail_id: None,
            };
            store.upsert_posting(run, &posting, mail, now).unwrap();
            judged.push((
                link.key,
                crate::store::Judgement {
                    record: record(MatchStatus::Scored, 60),
                    open: Vec::new(),
                    terms: terms.iter().map(|t| (*t).to_owned()).collect(),
                },
            ));
        }
        store.save_judgements(&judged, "r", now).unwrap();
        store
    }

    /// "Häufig verlangt": counted once per job however written, from two jobs on, the most
    /// frequent first (equal counts by their words), in the words of the newest job; what
    /// the profile names already is none of them.
    #[test]
    fn the_terms_asked_most_that_the_profile_lacks() {
        let now: Timestamp = "2026-09-26T10:00:00Z".parse().unwrap();
        let store = jobs_asking(
            &[
                &["Power BI", "SAP FI", "power-bi", "Once"],
                &["power bi", "Zollabwicklung", "C#", "Kanban", "Treasury"],
                &["POWER BI", "C++", "Scrum", "Zollabwicklung"],
                &["SAP FI", "C#", "Treasury", "C++", "Scrum"],
                &["Kanban"],
            ],
            now,
        );
        let asked = |form: Option<&ProfileForm>| -> Vec<(String, u32)> {
            asked_terms(&store, form, now)
                .unwrap()
                .into_iter()
                .map(|a| (a.term, a.count))
                .collect()
        };
        let pairs = |list: &[(&str, u32)]| -> Vec<(String, u32)> {
            list.iter().map(|(t, n)| ((*t).to_owned(), *n)).collect()
        };
        assert_eq!(
            asked(None),
            pairs(&[
                ("Power BI", 3),
                ("C#", 2),
                ("C++", 2),
                ("Kanban", 2),
                ("SAP FI", 2),
                ("Scrum", 2),
                ("Treasury", 2),
                ("Zollabwicklung", 2),
            ])
        );
        let mut form = ProfileForm::default();
        form.competences.push(ProfileCompetence {
            name: "Microsoft Power-BI".into(),
            years: None,
        });
        form.tools.push("power bi".into());
        form.tools.push("Kanban".into());
        form.tools.push("scrum".into());
        form.certificates.push("C++".into());
        assert_eq!(
            asked(Some(&form)),
            pairs(&[
                ("C#", 2),
                ("SAP FI", 2),
                ("Treasury", 2),
                ("Zollabwicklung", 2),
            ])
        );
    }

    /// "Häufig verlangt" counts the ads' terms, not their words: "Kenntnisse in Anaplan" and
    /// "Anaplan-Erfahrung" are one tool, "Branchenerfahrung Energie" and "Energy sector
    /// experience" one industry; each comes with its field (a language with its level), and
    /// what the profile names in any field is none of them.
    #[test]
    fn the_asked_terms_are_core_terms_with_their_field() {
        let now: Timestamp = "2026-09-26T10:00:00Z".parse().unwrap();
        let store = jobs_asking(
            &[
                &[
                    "Kenntnisse in Anaplan",
                    "Branchenerfahrung Energie",
                    "Erfahrung mit SAP Analytics Cloud",
                    "Sehr gute Englischkenntnisse",
                ],
                &[
                    "Anaplan-Erfahrung von Vorteil",
                    "Energy sector experience",
                    "SAP Analytics Cloud",
                    "Fluent English",
                    "Erfahrung",
                ],
                &["Anaplan", "Erfahrung", "Kenntnisse in Jedox"],
                &["Erfahrung mit Jedox", "Branchenkenntnisse Pharma", "Pharma"],
            ],
            now,
        );
        let asked = |form: Option<&ProfileForm>| -> Vec<(String, TermField, u32)> {
            asked_terms(&store, form, now)
                .unwrap()
                .into_iter()
                .map(|a| (a.term, a.field, a.count))
                .collect()
        };
        let levels: Vec<Option<LanguageLevel>> = asked_terms(&store, None, now)
            .unwrap()
            .into_iter()
            .map(|a| a.level)
            .collect();
        assert_eq!(levels, [None, None, Some(LanguageLevel::C1), None, None]);
        let list = |items: &[(&str, TermField, u32)]| -> Vec<(String, TermField, u32)> {
            items
                .iter()
                .map(|(t, f, n)| ((*t).to_owned(), *f, *n))
                .collect()
        };
        assert_eq!(
            asked(None),
            list(&[
                ("Anaplan", TermField::Tool, 3),
                ("Energie", TermField::Industry, 2),
                ("Englisch", TermField::Language, 2),
                ("Jedox", TermField::Tool, 2),
                ("SAP Analytics Cloud", TermField::Tool, 2),
            ]),
            "a word that names nothing (Erfahrung) is none; one job is no pattern (Pharma)"
        );
        let mut form = ProfileForm::default();
        form.tools.push("anaplan".into());
        form.industries.push("Energiewirtschaft".into());
        form.languages.push(ProfileLanguage {
            language: "English".into(),
            level: LanguageLevel::C1,
        });
        form.competences.push(ProfileCompetence {
            name: "Jedox".into(),
            years: None,
        });
        assert_eq!(
            asked(Some(&form)),
            list(&[("SAP Analytics Cloud", TermField::Tool, 2)])
        );
    }

    /// At most eight terms, and only of the last 30 days.
    #[test]
    fn the_asked_terms_are_few_and_recent() {
        let now: Timestamp = "2026-09-26T10:00:00Z".parse().unwrap();
        let many: Vec<String> = (0..12).map(|i| format!("Begriff {i:02}")).collect();
        let many: Vec<&str> = many.iter().map(String::as_str).collect();
        let mut lists: Vec<&[&str]> = vec![&many, &many];
        lists.extend(std::iter::repeat_n(&[][..], 29));
        lists.extend([&["Alt"][..], &["Alt"][..]]);
        let store = jobs_asking(&lists, now);
        let asked = asked_terms(&store, None, now).unwrap();
        assert_eq!(asked.len(), MAX_ASKED);
        assert_eq!(asked[0].term, "Begriff 00");
        assert!(asked.iter().all(|a| a.term != "Alt"), "{asked:?}");
    }

    /// 2,000 jobs of the window with eight terms each stay well below half a second (a debug
    /// build takes about 60 ms).
    #[test]
    fn the_asked_terms_are_fast() {
        let now: Timestamp = "2026-09-26T10:00:00Z".parse().unwrap();
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let mut judged = Vec::new();
        for i in 0..2000_u32 {
            let link = job_link(&format!(
                "https://www.linkedin.com/jobs/view/{}/",
                4_300_000_000 + u64::from(i)
            ))
            .unwrap();
            let posting = Posting::new(link.key.clone(), link.url, "Rolle", "Firma", "Köln");
            let mail = MailRef {
                subject: "x",
                date: Some(now - jiff::SignedDuration::from_mins(i64::from(i))),
                gmail_id: None,
            };
            store.upsert_posting(run, &posting, mail, now).unwrap();
            judged.push((
                link.key,
                crate::store::Judgement {
                    record: record(MatchStatus::Scored, 60),
                    open: Vec::new(),
                    terms: (0..8)
                        .map(|t| format!("Begriff {}", (i + t) % 300))
                        .collect(),
                },
            ));
        }
        store.save_judgements(&judged, "r", now).unwrap();
        let started = std::time::Instant::now();
        let asked = asked_terms(&store, None, now).unwrap();
        let took = started.elapsed();
        assert_eq!(asked.len(), MAX_ASKED);
        assert!(took < std::time::Duration::from_millis(500), "{took:?}");
    }
}
