//! Input and output types of the matching engine. Self-contained: the integrator maps
//! them onto the IPC and store types.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

pub use crate::model::KeyFacts;
use crate::portal::Portal;

/// How complete the job text is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum TextKind {
    /// The full description.
    Full,
    /// Only a teaser (for example freelance.de without sign-in).
    Teaser,
}

/// One job to assess.
#[derive(Debug, Clone, Copy)]
pub struct JobInput<'a> {
    pub title: &'a str,
    /// Hiring company or agency as the portal or mail gave it (industry wish).
    pub company: &'a str,
    /// Location as the portal or mail gave it.
    pub location: &'a str,
    pub portal: Portal,
    /// Description body (the TXT text after the header lines).
    pub text: &'a str,
    /// Structured facts of the portal (remote share, start, rate, ...), if any.
    pub facts: Option<&'a Value>,
    /// Date of the alert mail, the reference for start dates.
    pub posted: Option<jiff::civil::Date>,
    pub kind: TextKind,
}

/// Overall outcome for a job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Verdict {
    Scored,
    /// At least one decided hard-criterion violation; the score is kept for reference.
    Excluded,
    /// Too little text to assess.
    Unscorable,
}

/// How much the text allowed to assess.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum EvidenceLevel {
    Full,
    Low,
    Teaser,
}

/// Counts behind the score.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub must_met: u16,
    pub must_partial: u16,
    pub must_open: u16,
    pub must_total: u16,
    pub nice_met: u16,
    pub nice_total: u16,
    pub evidence: EvidenceLevel,
}

/// Result of [`super::assess`].
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assessment {
    pub verdict: Verdict,
    /// 0-100; also set for excluded jobs, 0 for unscorable ones.
    pub score: u8,
    pub summary: Summary,
    pub reasons: Vec<Reason>,
    pub highlights: Vec<Highlight>,
    pub criteria: Vec<CriterionState>,
    /// Rate, start, duration, remote share and contract type as read from the ad.
    pub facts: KeyFacts,
    /// Per-mille score before caps and rounding: the tie-breaker of equal scores.
    pub rank: u16,
    /// The Passungsgrad line by line (empty for an unscorable job): the three content parts
    /// with their points of their weight, the nice-to-have bonus, one line per frame condition
    /// worse than wished, the permanent line and the cap that held; the points add up to
    /// `score`.
    pub parts: Vec<Part>,
    /// Every cap that fired, with its reason, the lowest first.
    pub caps: Vec<CapLine>,
}

/// One line of the Passungsgrad: its points (a minus for a frame line, the permanent line and
/// the cap) of its maximum, with what it was read from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Part {
    pub code: PartCode,
    pub points: i16,
    pub max: u8,
    #[cfg_attr(test, ts(as = "crate::view::ts::Params"))]
    pub params: Map<String, Value>,
}

/// What a [`Part`] is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum PartCode {
    /// Role and field: `class` same, near, far or foreign, the target role (`role`, `fit`),
    /// the level (`level`: at, oneAbove, oneBelow, twoAbove, twoBelow).
    Role,
    /// Core of the role: the musts on the core met (`met`), in part (`partial`) of `total`,
    /// counted as at least `counted` (the ones the ad does not name count as role and field
    /// and the other musts do).
    Core,
    /// Weitere Muss-Punkte: `met`, `partial` of `total`, counted as at least `counted`.
    Musts,
    /// One frame condition worse than wished: its `aspect` (rate, place, start, duration,
    /// workload) met in part or missed (`state`: near, missed); the score keeps `percent`.
    Frame,
    /// The nice-to-haves (`met`, `partial` of `total`): only a plus.
    Nice,
    /// A permanent role keeps `percent` of the points.
    Permanent,
    /// The cap that held (`cap`, its `max`).
    Cap,
}

/// A cap that fired, with the highest score it allows and its reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct CapLine {
    pub code: CapCode,
    pub max: u8,
    /// `open`, `total` (coreOpen), `level`, `gap` (level), `field` (offField).
    #[cfg_attr(test, ts(as = "crate::view::ts::Params"))]
    pub params: Map<String, Value>,
}

/// Why a score is capped.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum CapCode {
    /// An open formal must (a degree of another field, a licence, a mandatory certificate).
    Formal,
    /// The core of the role clearly open: at least half of its musts open.
    CoreOpen,
    /// A foreign field: no skill must met at all.
    OffField,
    /// A junior or entry-level role for a senior profile.
    Junior,
    /// A role two or more levels below the target roles.
    Level,
}

impl CapCode {
    /// Its camelCase name (the trace, the cap part's `cap`).
    pub fn code(self) -> &'static str {
        match self {
            CapCode::Formal => "formal",
            CapCode::CoreOpen => "coreOpen",
            CapCode::OffField => "offField",
            CapCode::Junior => "junior",
            CapCode::Level => "level",
        }
    }
}

/// Kind of a reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ReasonKind {
    Met,
    Partial,
    Open,
    Violation,
    Check,
}

/// Weight class of a reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Weight {
    Must,
    Nice,
    Hard,
    Info,
}

/// What a reason is about; the UI catalog turns code + params into text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ReasonCode {
    /// A requirement of the ad (label = quote).
    Requirement,
    /// A vocabulary term found in the ad (no explicit requirements).
    Term,
    Anue,
    DayRate,
    Availability,
    Country,
    AnueOptional,
    AnueHidden,
    CountryUnclear,
    DayRateCurrency,
    /// The job starts before the profile's availability (`days`); never decided.
    AvailabilityGap,
    StartVague,
    Permanent,
    /// A project or interim role while the profile allows neither (`excluded`, `stated`,
    /// `type` freelance or interim): decided for a role the ad or its source makes one, a
    /// check where the ad offers a permanent role too.
    Project,
    /// A formal requirement (degree field, licence) the profile does not hold: a check
    /// with a score cap, decided only when the ad makes it mandatory.
    FormalOpen,
    LowEvidence,
    ShortText,
    /// Stated annual salary (`salary`, `min`): decided below the minimum for a stated
    /// permanent role in EUR per year, otherwise a check.
    Salary,
    /// A permanent role without a salary statement.
    SalaryUnknown,
    /// An assistant or associate level without years may be below the profile's years of
    /// experience (`level`, `have`); a check.
    SeniorityUnclear,
    /// A clearly junior role for the profile's years of experience (`have`): a closed range
    /// far below them (`years`, `max`) or a junior level (`level`: `internship`, `student`,
    /// `trainee`, `entry`, `graduate`, `volunteer`, `junior`); met in part, never an exclusion.
    Overqualified,
    /// Contract type inferred from the ad (`type`: interim, permanent, anue, unclear;
    /// `inferred` when only indirect cues were found).
    ContractType,
    /// A staffing agency without contract details: temporary agency work is possible.
    AnueRisk,
    /// The title matches a target role (`role`, `fit` full or half, `points`).
    TargetRole,
    /// Day rate wish (`state` met, near, missed or unknown, `points`, `wish`, `rate`,
    /// `hourly`, `currency`).
    DayRateWish,
    /// Work mode wish (`state`, `points`, `min` or `onsite`, `level` remote, hybrid or
    /// onsite, the ad's share `share` or `from`/`to`).
    RemoteWish,
    /// Region wish (`state`, `points`, `location`, `remote`).
    RegionWish,
    /// The ad's workload is outside the profile's days per week (`from`, `to`: percent of a
    /// five-day week, `from` left out when unknown; `minDays`, `maxDays` as the profile sets
    /// them); a check, never an exclusion.
    Workload,
    /// The engagement is shorter than the profile's minimum (`months`, `min`); a check.
    Duration,
    /// An exclusion word of the profile stands in the title or the ad (`word`, as the
    /// profile writes it); excludes.
    ExclusionWord,
}

/// How a profile entry met a requirement.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Via {
    Exact,
    Synonym,
    /// The profile entry is more specific than the requirement.
    Specific,
    /// The profile entry is more general (counts half).
    General,
    Semantic,
}

/// The profile side of a met requirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Evidence {
    /// Profile entry as written.
    pub profile: String,
    /// JSON path of the entry, e.g. `kernkompetenzen[3].kompetenz`.
    pub path: String,
    pub via: Via,
    /// The requirement text it met (at most 120 characters).
    pub quote: String,
}

/// One explained finding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reason {
    pub id: u16,
    pub kind: ReasonKind,
    pub weight: Weight,
    pub code: ReasonCode,
    /// Quote from the ad (at most 120 characters).
    pub label: Option<String>,
    pub evidence: Option<Evidence>,
    pub params: Map<String, Value>,
    /// Ids of the highlights that belong to this reason.
    pub ranges: Vec<u16>,
}

/// A passage of the job text, in UTF-16 offsets (JavaScript string indices).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Highlight {
    pub id: u16,
    pub start: u32,
    pub end: u32,
    pub kind: ReasonKind,
    pub reason: u16,
}

/// The hard criteria of the profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum CriterionKey {
    MinDayRate,
    Countries,
    NoAnue,
    Availability,
    /// Minimum annual salary for permanent roles and temporary agency work.
    MinSalary,
    /// Permanent employment excluded (`vertragsarten` without `festanstellung`).
    NoPermanent,
    /// Projects and interim work excluded (`vertragsarten` without `projekt`).
    NoProject,
    /// Days per week the consultant works (`auslastung`).
    Workload,
    /// Minimum duration of an engagement (`mindestlaufzeit_monate`).
    Duration,
    /// Words that exclude an ad (`ausschlusswoerter`).
    ExclusionWords,
}

/// State of one hard criterion for a job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum CriterionStatus {
    /// Not set in the profile, or not for this kind of job (a salary for a freelance role).
    Inactive,
    /// Set, and the ad says nothing that shows whether it is met.
    NotMentioned,
    /// Met, with the ad's value as evidence.
    Ok,
    Check,
    Violated,
}

/// A hard criterion for one job, with the reason that decided it and the ad's value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionState {
    pub key: CriterionKey,
    pub status: CriterionStatus,
    pub reason: Option<u16>,
    /// The ad's value: `rate`, `hourly`, `currency`, `rateOpen` (day rate); `start` (`now`,
    /// `vague` or an ISO date); `location` or `remote` (countries, region); `contract`
    /// (ANUE); `salary`; `from`, `to` (workload in percent);
    /// `months` (duration).
    pub params: Map<String, Value>,
    /// Where the ad states it, in UTF-16 offsets (start, end).
    pub range: Option<(u32, u32)>,
}

/// How usable the profile is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ProfileQuality {
    Good,
    /// Few competences; scores are rough.
    Thin,
    /// No competences: nothing is scored.
    Empty,
}

/// Where competences were found in the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceInfo {
    /// Path pattern, e.g. `kernkompetenzen[].kompetenz`.
    pub path: String,
    pub count: u16,
}

/// A hard criterion as understood from the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CriterionInfo {
    pub key: CriterionKey,
    pub set: bool,
    pub params: Map<String, Value>,
}

/// Something the user should fix or know about the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileWarning {
    pub code: ProfileWarningCode,
    pub params: Map<String, Value>,
}

/// Profile warning codes.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ProfileWarningCode {
    NoCompetences,
    FewCompetences,
    NoCriteria,
}

/// A wish of the profile.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum WishKey {
    /// Target roles (`wunschrollen`).
    TargetRoles,
    /// Wished day rate (`tagessatz_wunsch`).
    DayRate,
    /// Wished work mode (`arbeitsmodell`).
    Remote,
    /// Wished regions (`regionen`).
    Regions,
}

/// A wish as understood from the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WishInfo {
    pub key: WishKey,
    pub set: bool,
    pub params: Map<String, Value>,
}

/// "What the app understood" of the profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileSummary {
    pub competence_count: u16,
    /// Up to 40 competences in profile order.
    pub competences: Vec<String>,
    pub sources: Vec<SourceInfo>,
    pub criteria: Vec<CriterionInfo>,
    pub warnings: Vec<ProfileWarning>,
    /// Domain packs switched on by the profile's competences (e.g. `finance`, `sap`).
    pub packs: Vec<String>,
    /// Total years of professional experience, if stated.
    pub years: Option<u32>,
    /// Degrees as written in the profile.
    pub degrees: Vec<String>,
    /// Target roles and the wishes, each with `set`.
    pub wishes: Vec<WishInfo>,
}
