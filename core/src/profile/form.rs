//! The profile (Profil-JSON v19, user decision 2026-10-03): one flat file with German keys,
//! read into one typed form that the editor, the engine, the search and the CV import share.
//! Nothing else is read: a file with another key, a value of another type or a value out of
//! range does not read at all (the Profil view offers to start a new one), so no hidden data
//! can steer the engine.
//!
//! The file keys and values are an external contract (hand-made files, the CV worker's
//! `schema.json`) - do not translate. [`key`] names the keys the engine writes into its paths.

use jiff::civil::Date;
use serde::{Deserialize, Serialize};

use crate::error::InvalidInput;

/// File keys the engine names in the JSON paths of its evidence (`kernkompetenzen[3].kompetenz`)
/// and of the wishes; `the_file_keys_are_the_engine_keys` checks them against the file.
pub(crate) mod key {
    pub const ROLES: &str = "wunschrollen";
    pub const COMPETENCES: &str = "kernkompetenzen";
    pub const COMPETENCE: &str = "kompetenz";
    pub const TOOLS: &str = "methoden_tools";
    pub const INDUSTRIES: &str = "branchen";
    pub const INDUSTRY: &str = "branche";
    pub const LANGUAGES: &str = "sprachen";
    pub const LANGUAGE: &str = "sprache";
    pub const DEGREES: &str = "abschluesse";
    pub const CERTIFICATES: &str = "zertifizierungen";
    pub const DAY_RATE_WISH: &str = "tagessatz_wunsch";
    pub const WORK_MODE: &str = "arbeitsmodell";
    pub const REGIONS: &str = "regionen";
}

/// At most this many competences carry the star (Schwerpunkte).
pub const MAX_FOCUS: usize = 5;
/// The most years of experience, in total and per competence.
pub const MAX_YEARS: u32 = 70;
const MAX_DAY_RATE: u32 = 100_000;
const MAX_SALARY: u32 = 10_000_000;
/// The most entries of a list, and characters of an entry.
pub const MAX_ITEMS: usize = 300;
pub const MAX_TEXT: usize = 1_000;
/// The minimum durations a profile chooses from, in months (0: any).
pub const MIN_MONTHS: [u8; 4] = [0, 3, 6, 12];
/// The country of a new profile.
const HOME_COUNTRY: &str = "DE";

/// The editable profile (Profil-JSON v19): what the consultant looks for, what she brings,
/// what does not fit. `date` is `dd.mm.yyyy`; `permanent` and `temporary` allow Festanstellung
/// and Zeitarbeit (projects and interim work, `projekt`, are always on).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileForm {
    /// `wunschrollen`.
    pub roles: Vec<String>,
    /// `vertragsarten` names `festanstellung`.
    pub permanent: bool,
    /// `vertragsarten` names `zeitarbeit`.
    pub temporary: bool,
    /// `tagessatz_wunsch`: nudges the score.
    pub day_rate_wish: Option<u32>,
    /// `tagessatz_min`: below it a job is excluded.
    pub day_rate_min: Option<u32>,
    /// `mindestgehalt` (Festanstellung and Zeitarbeit; none without both).
    pub min_salary: Option<u32>,
    /// `arbeitsmodell`: a wish, never an exclusion.
    #[cfg_attr(test, ts(inline))]
    pub work_mode: WorkWish,
    /// `laender`, ISO codes.
    pub countries: Vec<String>,
    /// `regionen`: a wish.
    pub regions: Vec<String>,
    /// `verfuegbar_ab`.
    #[cfg_attr(test, ts(inline))]
    pub available: ProfileAvailability,
    /// `auslastung`.
    #[cfg_attr(test, ts(inline))]
    pub workload: Workload,
    /// `mindestlaufzeit_monate`, one of [`MIN_MONTHS`].
    #[cfg_attr(test, ts(type = "0 | 3 | 6 | 12"))]
    pub min_months: u8,
    /// `kernkompetenzen`, the starred ones the Schwerpunkte.
    #[cfg_attr(test, ts(inline))]
    pub competences: Vec<ProfileCompetence>,
    /// `methoden_tools`.
    pub tools: Vec<String>,
    /// `berufserfahrung_jahre`.
    pub years: Option<u32>,
    /// `branchen`, the starred ones preferred.
    #[cfg_attr(test, ts(inline))]
    pub industries: Vec<ProfileIndustry>,
    /// `sprachen`.
    #[cfg_attr(test, ts(inline))]
    pub languages: Vec<ProfileLanguage>,
    /// `abschluesse`, a degree with its field in one entry.
    pub degrees: Vec<String>,
    /// `zertifizierungen`.
    pub certificates: Vec<String>,
    /// `ausschlusswoerter`: a job naming one is excluded.
    pub exclusion_words: Vec<String>,
}

impl Default for ProfileForm {
    /// A new profile: Festanstellung and Zeitarbeit allowed, Deutschland, from now on, no wish
    /// of work mode, workload or duration.
    fn default() -> Self {
        ProfileForm {
            roles: Vec::new(),
            permanent: true,
            temporary: true,
            day_rate_wish: None,
            day_rate_min: None,
            min_salary: None,
            work_mode: WorkWish::Any,
            countries: vec![HOME_COUNTRY.to_owned()],
            regions: Vec::new(),
            available: ProfileAvailability::Now,
            workload: Workload::Any,
            min_months: 0,
            competences: Vec::new(),
            tools: Vec::new(),
            years: None,
            industries: Vec::new(),
            languages: Vec::new(),
            degrees: Vec::new(),
            certificates: Vec::new(),
            exclusion_words: Vec::new(),
        }
    }
}

/// One competence with its years; `focus` = the star (a Schwerpunkt).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileCompetence {
    pub name: String,
    pub years: Option<u32>,
    pub focus: bool,
}

/// One industry of the consultant's experience; `preferred` = the star.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileIndustry {
    pub name: String,
    pub preferred: bool,
}

/// One language with its level.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileLanguage {
    pub language: String,
    #[cfg_attr(test, ts(inline))]
    pub level: LanguageLevel,
}

/// CEFR level or native.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum LanguageLevel {
    A1,
    A2,
    B1,
    B2,
    C1,
    C2,
    #[serde(rename = "native")]
    Native,
}

impl LanguageLevel {
    /// The level of the engine's scale (1 = A1 to 6 = C2, 7 native).
    pub(crate) fn engine(self) -> u8 {
        match self {
            LanguageLevel::A1 => 1,
            LanguageLevel::A2 => 2,
            LanguageLevel::B1 => 3,
            LanguageLevel::B2 => 4,
            LanguageLevel::C1 => 5,
            LanguageLevel::C2 => 6,
            LanguageLevel::Native => 7,
        }
    }

    /// The level of the engine's scale; `None` outside it.
    pub(crate) fn of_engine(level: u8) -> Option<LanguageLevel> {
        Some(match level {
            1 => LanguageLevel::A1,
            2 => LanguageLevel::A2,
            3 => LanguageLevel::B1,
            4 => LanguageLevel::B2,
            5 => LanguageLevel::C1,
            6 => LanguageLevel::C2,
            7 => LanguageLevel::Native,
            _ => return None,
        })
    }
}

/// The work mode the consultant wishes (`arbeitsmodell`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum WorkWish {
    Any,
    Remote,
    Hybrid,
    Onsite,
}

/// The workload the consultant wants (`auslastung`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Workload {
    Any,
    Fulltime,
    Parttime,
}

/// When the consultant is available (`verfuegbar_ab`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ProfileAvailability {
    Now,
    /// From a day (`date` as `dd.mm.yyyy`).
    From {
        date: String,
    },
}

impl ProfileAvailability {
    /// The day it starts; `None` for now (and for a date that does not read).
    pub(crate) fn day(&self) -> Option<Date> {
        match self {
            ProfileAvailability::Now => None,
            ProfileAvailability::From { date } => german_date(date),
        }
    }
}

/// A `dd.mm.yyyy` date.
fn german_date(text: &str) -> Option<Date> {
    let mut parts = text.trim().split('.');
    let (day, month, year) = (parts.next()?, parts.next()?, parts.next()?);
    if parts.next().is_some() || day.len() != 2 || month.len() != 2 || year.len() != 4 {
        return None;
    }
    Date::new(year.parse().ok()?, month.parse().ok()?, day.parse().ok()?).ok()
}

impl ProfileForm {
    /// Values trimmed, empty entries dropped, every list entry once (case-insensitive, the
    /// first wins), codes in capitals, zero as none, the salary only with Festanstellung or
    /// Zeitarbeit.
    #[must_use]
    pub fn normalized(&self) -> ProfileForm {
        let mut competences: Vec<ProfileCompetence> = Vec::new();
        for row in &self.competences {
            let name = row.name.trim();
            if !name.is_empty() && !competences.iter().any(|c| same(&c.name, name)) {
                competences.push(ProfileCompetence {
                    name: name.to_owned(),
                    ..row.clone()
                });
            }
        }
        let mut industries: Vec<ProfileIndustry> = Vec::new();
        for row in &self.industries {
            let name = row.name.trim();
            if !name.is_empty() && !industries.iter().any(|i| same(&i.name, name)) {
                industries.push(ProfileIndustry {
                    name: name.to_owned(),
                    preferred: row.preferred,
                });
            }
        }
        let mut languages: Vec<ProfileLanguage> = Vec::new();
        for row in &self.languages {
            let language = row.language.trim();
            if !language.is_empty() && !languages.iter().any(|l| same(&l.language, language)) {
                languages.push(ProfileLanguage {
                    language: language.to_owned(),
                    level: row.level,
                });
            }
        }
        let countries: Vec<String> = self
            .countries
            .iter()
            .map(|c| c.trim().to_uppercase())
            .collect();
        let positive = |n: Option<u32>| n.filter(|n| *n > 0);
        ProfileForm {
            roles: clean(&self.roles),
            permanent: self.permanent,
            temporary: self.temporary,
            day_rate_wish: positive(self.day_rate_wish),
            day_rate_min: positive(self.day_rate_min),
            min_salary: positive(self.min_salary).filter(|_| self.permanent || self.temporary),
            work_mode: self.work_mode,
            countries: clean(&countries),
            regions: clean(&self.regions),
            available: match &self.available {
                ProfileAvailability::Now => ProfileAvailability::Now,
                ProfileAvailability::From { date } => ProfileAvailability::From {
                    date: date.trim().to_owned(),
                },
            },
            workload: self.workload,
            min_months: self.min_months,
            competences,
            tools: clean(&self.tools),
            years: self.years,
            industries,
            languages,
            degrees: clean(&self.degrees),
            certificates: clean(&self.certificates),
            exclusion_words: clean(&self.exclusion_words),
        }
    }

    /// The competences with the star, in their order.
    pub fn focus(&self) -> impl Iterator<Item = &ProfileCompetence> {
        self.competences.iter().filter(|c| c.focus)
    }
}

/// The fields a usable profile still needs, by their names in the form (`roles`, `countries`,
/// `competences`, `languages`), in the form's order: the one source for the onboarding, the
/// Profil's "Noch n Angaben offen" and whether a search can start. The contract types always
/// hold `projekt` (projects and interim work), so they are never missing.
pub fn missing_required(form: &ProfileForm) -> Vec<&'static str> {
    let form = form.normalized();
    [
        ("roles", form.roles.is_empty()),
        ("countries", form.countries.is_empty()),
        ("competences", form.competences.is_empty()),
        ("languages", form.languages.is_empty()),
    ]
    .into_iter()
    .filter(|(_, missing)| *missing)
    .map(|(field, _)| field)
    .collect()
}

fn same(a: &str, b: &str) -> bool {
    a.trim().to_lowercase() == b.trim().to_lowercase()
}

/// Trimmed, non-empty, each entry once (case-insensitive, the first spelling wins).
fn clean(items: &[String]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in items {
        let text = item.trim();
        if !text.is_empty() && !out.iter().any(|o| same(o, text)) {
            out.push(text.to_owned());
        }
    }
    out
}

/// The form normalized, or the first value out of range: `field` names it, `row` the entry
/// of a list of rows (competences, industries, languages; counted in the normalized list),
/// `max` the highest number (or count) it takes.
pub(crate) fn validate(form: &ProfileForm) -> Result<ProfileForm, InvalidInput> {
    let form = form.normalized();
    let at = |field: &str, row: Option<usize>, max: Option<u32>| InvalidInput::ProfileValue {
        field: field.to_owned(),
        row: row.and_then(|r| u32::try_from(r).ok()),
        max,
    };
    let fits = |items: &[String]| {
        items.len() <= MAX_ITEMS && items.iter().all(|t| t.chars().count() <= MAX_TEXT)
    };
    let long = |text: &str| text.chars().count() > MAX_TEXT;
    for (value, max, field) in [
        (form.years, MAX_YEARS, "years"),
        (form.day_rate_wish, MAX_DAY_RATE, "dayRateWish"),
        (form.day_rate_min, MAX_DAY_RATE, "dayRateMin"),
        (form.min_salary, MAX_SALARY, "minSalary"),
    ] {
        if value.is_some_and(|n| n > max) {
            return Err(at(field, None, Some(max)));
        }
    }
    for (items, field) in [
        (&form.roles, "roles"),
        (&form.countries, "countries"),
        (&form.regions, "regions"),
        (&form.tools, "tools"),
        (&form.degrees, "degrees"),
        (&form.certificates, "certificates"),
        (&form.exclusion_words, "exclusionWords"),
    ] {
        if !fits(items) {
            return Err(at(field, None, None));
        }
    }
    if form.available.day().is_none() && form.available != ProfileAvailability::Now {
        return Err(at("available", None, None));
    }
    if !MIN_MONTHS.contains(&form.min_months) {
        return Err(at("minMonths", None, None));
    }
    if form.competences.len() > MAX_ITEMS {
        return Err(at("competences", None, None));
    }
    for (i, row) in form.competences.iter().enumerate() {
        if row.years.is_some_and(|y| y > MAX_YEARS) {
            return Err(at("competences", Some(i), Some(MAX_YEARS)));
        }
        if long(&row.name) {
            return Err(at("competences", Some(i), None));
        }
    }
    if form.focus().count() > MAX_FOCUS {
        return Err(at("competences", None, u32::try_from(MAX_FOCUS).ok()));
    }
    if form.industries.len() > MAX_ITEMS {
        return Err(at("industries", None, None));
    }
    if let Some(i) = form.industries.iter().position(|row| long(&row.name)) {
        return Err(at("industries", Some(i), None));
    }
    if form.languages.len() > MAX_ITEMS {
        return Err(at("languages", None, None));
    }
    if let Some(i) = form.languages.iter().position(|row| long(&row.language)) {
        return Err(at("languages", Some(i), None));
    }
    Ok(form)
}

/// The form `after` made of `before`, applied to `now` (the stored profile, which may have
/// changed since `before` was read, e.g. by a term added from the reader): every field the
/// editor changed takes its value from `after`, every other one stays as `now` has it; a
/// list the editor changed is rebased ([`rebase`]), so a save on an older copy never drops
/// an entry that came in meanwhile nor brings back one that went.
pub(crate) fn merge(now: &ProfileForm, before: &ProfileForm, after: &ProfileForm) -> ProfileForm {
    fn pick<T: Clone + PartialEq>(now: &T, before: &T, after: &T) -> T {
        if after == before { now } else { after }.clone()
    }
    fn list<T: Clone + PartialEq>(
        now: &[T],
        before: &[T],
        after: &[T],
        name: fn(&T) -> &str,
    ) -> Vec<T> {
        if after == before {
            now.to_vec()
        } else {
            rebase(now, before, after, name)
        }
    }
    fn text(t: &String) -> &str {
        t
    }
    ProfileForm {
        roles: list(&now.roles, &before.roles, &after.roles, text),
        permanent: pick(&now.permanent, &before.permanent, &after.permanent),
        temporary: pick(&now.temporary, &before.temporary, &after.temporary),
        day_rate_wish: pick(
            &now.day_rate_wish,
            &before.day_rate_wish,
            &after.day_rate_wish,
        ),
        day_rate_min: pick(&now.day_rate_min, &before.day_rate_min, &after.day_rate_min),
        min_salary: pick(&now.min_salary, &before.min_salary, &after.min_salary),
        work_mode: pick(&now.work_mode, &before.work_mode, &after.work_mode),
        countries: list(&now.countries, &before.countries, &after.countries, text),
        regions: list(&now.regions, &before.regions, &after.regions, text),
        available: pick(&now.available, &before.available, &after.available),
        workload: pick(&now.workload, &before.workload, &after.workload),
        min_months: pick(&now.min_months, &before.min_months, &after.min_months),
        competences: list(
            &now.competences,
            &before.competences,
            &after.competences,
            |c| &c.name,
        ),
        tools: list(&now.tools, &before.tools, &after.tools, text),
        years: pick(&now.years, &before.years, &after.years),
        industries: list(
            &now.industries,
            &before.industries,
            &after.industries,
            |i| &i.name,
        ),
        languages: list(&now.languages, &before.languages, &after.languages, |l| {
            &l.language
        }),
        degrees: list(&now.degrees, &before.degrees, &after.degrees, text),
        certificates: list(
            &now.certificates,
            &before.certificates,
            &after.certificates,
            text,
        ),
        exclusion_words: list(
            &now.exclusion_words,
            &before.exclusion_words,
            &after.exclusion_words,
            text,
        ),
    }
}

/// The list `after` made of `before`, applied to `now`; entries are the same by their
/// `name` (case-insensitive). The entries of `after` in its order, without one the file
/// dropped meanwhile; an entry `after` took over unchanged keeps what the file has now (its
/// spelling, years, star, level). An entry the file gained meanwhile stays, after the entry
/// it follows in the file.
fn rebase<T: Clone + PartialEq>(
    now: &[T],
    before: &[T],
    after: &[T],
    name: fn(&T) -> &str,
) -> Vec<T> {
    let find = |list: &[T], wanted: &T| list.iter().position(|item| same(name(item), name(wanted)));
    let mut out: Vec<T> = Vec::new();
    for item in after {
        match (find(before, item), find(now, item)) {
            (Some(_), None) => {}
            (Some(old), Some(current)) if before[old] == *item => out.push(now[current].clone()),
            _ => out.push(item.clone()),
        }
    }
    let mut at = 0;
    for item in now {
        if let Some(found) = find(&out, item) {
            at = found + 1;
        } else if find(before, item).is_none() {
            out.insert(at, item.clone());
            at += 1;
        }
    }
    out
}

// ---------------------------------------------------------------------------------- the file

/// The file as written: the keys in the order of the form, every key always.
#[derive(Debug, Serialize, Deserialize)]
#[serde(default, deny_unknown_fields)]
struct File {
    wunschrollen: Vec<String>,
    vertragsarten: Vec<Contract>,
    tagessatz_wunsch: Option<u32>,
    tagessatz_min: Option<u32>,
    mindestgehalt: Option<u32>,
    arbeitsmodell: FileWorkMode,
    laender: Vec<String>,
    regionen: Vec<String>,
    verfuegbar_ab: String,
    auslastung: FileWorkload,
    mindestlaufzeit_monate: u8,
    kernkompetenzen: Vec<FileCompetence>,
    methoden_tools: Vec<String>,
    berufserfahrung_jahre: Option<u32>,
    branchen: Vec<FileIndustry>,
    sprachen: Vec<FileLanguage>,
    abschluesse: Vec<String>,
    zertifizierungen: Vec<String>,
    ausschlusswoerter: Vec<String>,
}

impl Default for File {
    /// A missing key reads as the value of a new profile (the CV import's answer holds only
    /// what a CV can tell).
    fn default() -> Self {
        File::of(&ProfileForm::default())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Contract {
    Projekt,
    Festanstellung,
    Zeitarbeit,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FileWorkMode {
    Egal,
    Remote,
    Hybrid,
    VorOrt,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
enum FileWorkload {
    Egal,
    Vollzeit,
    Teilzeit,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileCompetence {
    kompetenz: String,
    #[serde(default)]
    jahre: Option<u32>,
    #[serde(default)]
    schwerpunkt: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileIndustry {
    branche: String,
    #[serde(default)]
    wunsch: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct FileLanguage {
    sprache: String,
    niveau: FileLevel,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
enum FileLevel {
    A1,
    A2,
    B1,
    B2,
    C1,
    C2,
    Muttersprache,
}

/// `verfuegbar_ab` of a profile available now.
const NOW: &str = "sofort";

impl File {
    fn of(form: &ProfileForm) -> File {
        let mut contracts = vec![Contract::Projekt];
        if form.permanent {
            contracts.push(Contract::Festanstellung);
        }
        if form.temporary {
            contracts.push(Contract::Zeitarbeit);
        }
        File {
            wunschrollen: form.roles.clone(),
            vertragsarten: contracts,
            tagessatz_wunsch: form.day_rate_wish,
            tagessatz_min: form.day_rate_min,
            mindestgehalt: form.min_salary,
            arbeitsmodell: match form.work_mode {
                WorkWish::Any => FileWorkMode::Egal,
                WorkWish::Remote => FileWorkMode::Remote,
                WorkWish::Hybrid => FileWorkMode::Hybrid,
                WorkWish::Onsite => FileWorkMode::VorOrt,
            },
            laender: form.countries.clone(),
            regionen: form.regions.clone(),
            verfuegbar_ab: match &form.available {
                ProfileAvailability::Now => NOW.to_owned(),
                ProfileAvailability::From { date } => date.clone(),
            },
            auslastung: match form.workload {
                Workload::Any => FileWorkload::Egal,
                Workload::Fulltime => FileWorkload::Vollzeit,
                Workload::Parttime => FileWorkload::Teilzeit,
            },
            mindestlaufzeit_monate: form.min_months,
            kernkompetenzen: form
                .competences
                .iter()
                .map(|c| FileCompetence {
                    kompetenz: c.name.clone(),
                    jahre: c.years,
                    schwerpunkt: c.focus,
                })
                .collect(),
            methoden_tools: form.tools.clone(),
            berufserfahrung_jahre: form.years,
            branchen: form
                .industries
                .iter()
                .map(|i| FileIndustry {
                    branche: i.name.clone(),
                    wunsch: i.preferred,
                })
                .collect(),
            sprachen: form
                .languages
                .iter()
                .map(|l| FileLanguage {
                    sprache: l.language.clone(),
                    niveau: match l.level {
                        LanguageLevel::A1 => FileLevel::A1,
                        LanguageLevel::A2 => FileLevel::A2,
                        LanguageLevel::B1 => FileLevel::B1,
                        LanguageLevel::B2 => FileLevel::B2,
                        LanguageLevel::C1 => FileLevel::C1,
                        LanguageLevel::C2 => FileLevel::C2,
                        LanguageLevel::Native => FileLevel::Muttersprache,
                    },
                })
                .collect(),
            abschluesse: form.degrees.clone(),
            zertifizierungen: form.certificates.clone(),
            ausschlusswoerter: form.exclusion_words.clone(),
        }
    }

    /// The form of the file; `projekt` (projects and interim work) is always on, so a list of contract types
    /// without it is no profile of this app.
    fn form(self) -> Result<ProfileForm, InvalidInput> {
        if !self.vertragsarten.contains(&Contract::Projekt) {
            return Err(InvalidInput::ProfileValue {
                field: "permanent".to_owned(),
                row: None,
                max: None,
            });
        }
        let available = if self.verfuegbar_ab.trim() == NOW {
            ProfileAvailability::Now
        } else {
            ProfileAvailability::From {
                date: self.verfuegbar_ab,
            }
        };
        validate(&ProfileForm {
            roles: self.wunschrollen,
            permanent: self.vertragsarten.contains(&Contract::Festanstellung),
            temporary: self.vertragsarten.contains(&Contract::Zeitarbeit),
            day_rate_wish: self.tagessatz_wunsch,
            day_rate_min: self.tagessatz_min,
            min_salary: self.mindestgehalt,
            work_mode: match self.arbeitsmodell {
                FileWorkMode::Egal => WorkWish::Any,
                FileWorkMode::Remote => WorkWish::Remote,
                FileWorkMode::Hybrid => WorkWish::Hybrid,
                FileWorkMode::VorOrt => WorkWish::Onsite,
            },
            countries: self.laender,
            regions: self.regionen,
            available,
            workload: match self.auslastung {
                FileWorkload::Egal => Workload::Any,
                FileWorkload::Vollzeit => Workload::Fulltime,
                FileWorkload::Teilzeit => Workload::Parttime,
            },
            min_months: self.mindestlaufzeit_monate,
            competences: self
                .kernkompetenzen
                .into_iter()
                .map(|c| ProfileCompetence {
                    name: c.kompetenz,
                    years: c.jahre,
                    focus: c.schwerpunkt,
                })
                .collect(),
            tools: self.methoden_tools,
            years: self.berufserfahrung_jahre,
            industries: self
                .branchen
                .into_iter()
                .map(|i| ProfileIndustry {
                    name: i.branche,
                    preferred: i.wunsch,
                })
                .collect(),
            languages: self
                .sprachen
                .into_iter()
                .map(|l| ProfileLanguage {
                    language: l.sprache,
                    level: match l.niveau {
                        FileLevel::A1 => LanguageLevel::A1,
                        FileLevel::A2 => LanguageLevel::A2,
                        FileLevel::B1 => LanguageLevel::B1,
                        FileLevel::B2 => LanguageLevel::B2,
                        FileLevel::C1 => LanguageLevel::C1,
                        FileLevel::C2 => LanguageLevel::C2,
                        FileLevel::Muttersprache => LanguageLevel::Native,
                    },
                })
                .collect(),
            degrees: self.abschluesse,
            certificates: self.zertifizierungen,
            exclusion_words: self.ausschlusswoerter,
        })
    }
}

/// The profile in a file's text (without a byte order mark): every key of v19 or none, every
/// value of its type and within its limits.
pub fn parse(text: &str) -> Result<ProfileForm, InvalidInput> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let file: File = serde_json::from_str(text).map_err(|e| InvalidInput::ProfileNotJson {
        line: e.line(),
        column: e.column(),
    })?;
    file.form()
}

/// The file of a form as JSON (what the AI prompt shows of the profile).
pub fn file_value(form: &ProfileForm) -> serde_json::Value {
    serde_json::to_value(File::of(form)).unwrap_or_default()
}

/// The file's text of a valid form (pretty, a line break at the end).
pub(crate) fn write(form: &ProfileForm) -> String {
    let mut text = serde_json::to_string_pretty(&File::of(form)).unwrap_or_default();
    text.push('\n');
    text
}

/// The values the interface shares with the form (`profile.ts`).
#[cfg(test)]
pub(crate) fn typescript() -> String {
    let empty = serde_json::to_string_pretty(&ProfileForm::default()).unwrap_or_default();
    format!(
        "import type {{ ProfileForm }} from \"./ProfileForm\";\n\n\
         /** The largest value of each number of the form (core's form limits). */\n\
         export const NUMBER_LIMITS = {{\n  \
         dayRateWish: {MAX_DAY_RATE},\n  dayRateMin: {MAX_DAY_RATE},\n  \
         minSalary: {MAX_SALARY},\n  years: {MAX_YEARS},\n\
         }} as const satisfies Partial<Record<keyof ProfileForm, number>>;\n\
         export type NumberField = keyof typeof NUMBER_LIMITS;\n\n\
         /** At most this many competences are Schwerpunkte. */\n\
         export const MAX_FOCUS = {MAX_FOCUS};\n\
         /** The most years of experience, in total and per competence. */\n\
         export const MAX_YEARS = {MAX_YEARS};\n\
         /** The most entries of a list, and characters of an entry. */\n\
         export const MAX_ITEMS = {MAX_ITEMS};\n\
         export const MAX_TEXT = {MAX_TEXT};\n\n\
         /** The form of a new profile (`ProfileForm::default()`): Festanstellung and Zeitarbeit\n \
         *  allowed, Deutschland, from now on, no wish of work mode, workload or duration. */\n\
         export const EMPTY_FORM: ProfileForm = {empty};\n"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn full() -> ProfileForm {
        let texts = |items: &[&str]| items.iter().map(|t| (*t).to_owned()).collect::<Vec<_>>();
        ProfileForm {
            roles: texts(&["Interim CFO", "Head of Controlling"]),
            permanent: true,
            temporary: false,
            day_rate_wish: Some(1_200),
            day_rate_min: Some(1_000),
            min_salary: Some(150_000),
            work_mode: WorkWish::Hybrid,
            countries: texts(&["DE", "AT"]),
            regions: texts(&["Hamburg"]),
            available: ProfileAvailability::From {
                date: "01.11.2026".into(),
            },
            workload: Workload::Fulltime,
            min_months: 6,
            competences: vec![
                ProfileCompetence {
                    name: "Controlling".into(),
                    years: Some(15),
                    focus: true,
                },
                ProfileCompetence {
                    name: "Treasury".into(),
                    years: None,
                    focus: false,
                },
            ],
            tools: texts(&["SAP S/4HANA"]),
            years: Some(18),
            industries: vec![ProfileIndustry {
                name: "Pharma".into(),
                preferred: true,
            }],
            languages: vec![ProfileLanguage {
                language: "Deutsch".into(),
                level: LanguageLevel::Native,
            }],
            degrees: texts(&["Diplom-Kauffrau, BWL"]),
            certificates: texts(&["PMP"]),
            exclusion_words: texts(&["Werkstudent"]),
        }
    }

    #[test]
    fn the_file_reads_back_as_written() {
        let form = full();
        let text = write(&form);
        assert_eq!(parse(&text).unwrap(), form);
        let value: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!(
            value["vertragsarten"],
            serde_json::json!(["projekt", "festanstellung"])
        );
        assert_eq!(value["arbeitsmodell"], "hybrid");
        assert_eq!(value["auslastung"], "vollzeit");
        assert_eq!(value["verfuegbar_ab"], "01.11.2026");
        assert_eq!(value["sprachen"][0]["niveau"], "Muttersprache");
        assert_eq!(value["kernkompetenzen"][0]["schwerpunkt"], true);
        assert_eq!(value["branchen"][0]["wunsch"], true);
        // The default form writes every key and reads back the same.
        let empty = write(&ProfileForm::default());
        assert_eq!(parse(&empty).unwrap(), ProfileForm::default());
        assert!(empty.contains("\"verfuegbar_ab\": \"sofort\""), "{empty}");
    }

    /// The keys the engine names are keys of the file.
    #[test]
    fn the_file_keys_are_the_engine_keys() {
        let value = serde_json::to_value(File::of(&full())).unwrap();
        for k in [
            key::ROLES,
            key::COMPETENCES,
            key::TOOLS,
            key::INDUSTRIES,
            key::LANGUAGES,
            key::DEGREES,
            key::CERTIFICATES,
            key::DAY_RATE_WISH,
            key::WORK_MODE,
            key::REGIONS,
        ] {
            assert!(value.get(k).is_some(), "{k}");
        }
        assert!(value[key::COMPETENCES][0].get(key::COMPETENCE).is_some());
        assert!(value[key::INDUSTRIES][0].get(key::INDUSTRY).is_some());
        assert!(value[key::LANGUAGES][0].get(key::LANGUAGE).is_some());
    }

    /// The CV worker's answer (`cv-worker/schema.json`) is a part of the file: every key of
    /// it, with the item keys of its lists, is a key of the file, and its language levels are
    /// the file's.
    #[test]
    fn the_cv_schema_is_a_part_of_the_file() {
        let path =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../cv-worker/schema.json");
        let schema: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let file = serde_json::to_value(File::of(&full())).unwrap();
        for (key, property) in schema["properties"].as_object().unwrap() {
            assert!(file.get(key).is_some(), "{key}");
            if let Some(items) = property["items"]["properties"].as_object() {
                for item in items.keys() {
                    assert!(file[key][0].get(item).is_some(), "{key}[].{item}");
                }
            }
        }
        let levels = &schema["properties"]["sprachen"]["items"]["properties"]["niveau"]["enum"];
        for level in levels.as_array().unwrap() {
            let text = format!(r#"{{"sprachen": [{{"sprache": "Deutsch", "niveau": {level}}}]}}"#);
            assert!(parse(&text).is_ok(), "{level}");
        }
    }

    /// A missing key reads as a new profile has it; a missing `vertragsarten` allows every
    /// contract type; anything else that is no v19 does not read.
    #[test]
    fn what_reads_and_what_does_not() {
        let form = parse(r#"{"wunschrollen": ["Interim CFO"]}"#).unwrap();
        assert_eq!(
            form,
            ProfileForm {
                roles: vec!["Interim CFO".into()],
                ..ProfileForm::default()
            }
        );
        for text in [
            r#"{"vertragsarten": []}"#,
            r#"{"vertragsarten": ["festanstellung"]}"#,
            r#"{"stationen": []}"#,
            r#"{"kernkompetenzen": [{"kompetenz": "X", "auch": ["Y"]}]}"#,
            r#"{"sprachen": [{"sprache": "Englisch", "niveau": "gut"}]}"#,
            r#"{"verfuegbar_ab": "31.02.2026"}"#,
            r#"{"verfuegbar_ab": "2026-11-01"}"#,
            r#"{"mindestlaufzeit_monate": 4}"#,
            r#"{"tagessatz_min": 1000000}"#,
            "[1]",
            "{kaputt",
        ] {
            assert!(parse(text).is_err(), "{text}");
        }
        let six = (0..6)
            .map(|n| format!(r#"{{"kompetenz": "K{n}", "schwerpunkt": true}}"#))
            .collect::<Vec<_>>()
            .join(",");
        assert!(parse(&format!(r#"{{"kernkompetenzen": [{six}]}}"#)).is_err());
        assert_eq!(
            parse("\u{feff}{}").unwrap(),
            ProfileForm::default(),
            "a byte order mark"
        );
    }

    #[test]
    fn the_salary_goes_without_permanent_and_temporary_work() {
        let form = ProfileForm {
            permanent: false,
            temporary: false,
            min_salary: Some(100_000),
            ..ProfileForm::default()
        };
        assert_eq!(form.normalized().min_salary, None);
        let temporary = ProfileForm {
            temporary: true,
            ..form
        };
        assert_eq!(temporary.normalized().min_salary, Some(100_000));
    }

    #[test]
    fn the_required_fields() {
        assert_eq!(
            missing_required(&ProfileForm::default()),
            ["roles", "competences", "languages"]
        );
        let none = ProfileForm {
            countries: vec![" ".into()],
            ..ProfileForm::default()
        };
        assert_eq!(
            missing_required(&none),
            ["roles", "countries", "competences", "languages"]
        );
        assert!(missing_required(&full()).is_empty());
    }

    fn names(items: &[&str]) -> Vec<String> {
        items.iter().map(|t| (*t).to_owned()).collect()
    }

    /// A save on an older copy keeps what came in between and takes out only what it took
    /// out itself, in every list; a row the editor did not touch keeps the file's values.
    #[test]
    fn a_save_on_an_older_copy_keeps_what_came_in_between() {
        let p0 = ProfileForm {
            tools: names(&["SAP", "IFRS"]),
            ..full()
        };
        // Meanwhile the reader adds a tool, a language and gives Treasury its years.
        let mut now = p0.clone();
        now.tools.push("HGB".into());
        now.languages.push(ProfileLanguage {
            language: "Englisch".into(),
            level: LanguageLevel::C1,
        });
        now.competences[1].years = Some(8);
        // The editor still holds p0: it drops IFRS, adds Konsolidierung as a tool and a
        // competence and sets the minimum rate.
        let mut after = p0.clone();
        after.tools = names(&["SAP", "Konsolidierung"]);
        after.competences.push(ProfileCompetence {
            name: "Konsolidierung".into(),
            years: Some(5),
            focus: false,
        });
        after.day_rate_min = Some(1_100);
        let merged = merge(&now, &p0, &after);
        assert_eq!(merged.tools, ["SAP", "HGB", "Konsolidierung"]);
        assert_eq!(merged.languages.len(), 2, "the language stays");
        assert_eq!(merged.competences[1].years, Some(8), "untouched row");
        assert_eq!(merged.competences[2].name, "Konsolidierung");
        assert_eq!(merged.day_rate_min, Some(1_100));
        // On an unchanged file the save is the form as it is, order and all.
        let turned = ProfileForm {
            tools: names(&["IFRS", "SAP"]),
            ..p0.clone()
        };
        assert_eq!(merge(&p0, &p0, &turned), turned);
        // An entry the file dropped meanwhile does not come back.
        let dropped = ProfileForm {
            tools: names(&["SAP"]),
            ..p0.clone()
        };
        let edited = ProfileForm {
            day_rate_wish: Some(1_300),
            tools: names(&["SAP", "IFRS", "Excel"]),
            ..p0.clone()
        };
        assert_eq!(merge(&dropped, &p0, &edited).tools, ["SAP", "Excel"]);
    }
}
