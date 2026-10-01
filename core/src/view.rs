//! IPC v3: what the interface receives and sends - defined once here (and next to the run
//! types in `pipeline`), TypeScript types are generated from it (`view::ts`, tests only).
//!
//! Rules: camelCase, `null` instead of missing fields, data enums tagged with `kind`, never
//! prose - notices, states and errors are codes with data; the words live in the UI catalog.
//! Company and location are cleaned here (the database holds the raw mail values).

use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use jiff::Timestamp;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::error::ErrorInfo;
use crate::fetch::policy::{Policy, limits};
use crate::fetch::{MAX_AGE, PortalHealth, RETRY_AFTER};
pub use crate::matching::TermField;
use crate::matching::{self, Assessment, CoreTerm, ProfileSummary};
use crate::model::{
    Band, DescStatus, KeyFacts, MatchRecord, MatchStatus, Notice, Place, band, gmail_url,
    is_usable_title,
};
use crate::pipeline::{LocalMatcher, Matcher, RunSnapshot, RunSummary, local};
use crate::portal::{JobKey, Portal, Way};
pub use crate::profile::{
    LanguageLevel, ProfileAvailability, ProfileCompetence, ProfileCriteria, ProfileForm,
    ProfileLanguage, ProfileWishes, RemoteWish, UnreadableField,
};
use crate::settings::{FetchRange, Language, Palette, PortalSwitches, Settings};
use crate::store::{AlertMailRow, JobRow, ListFilter, PageQuery, Store};
use crate::text::split_company_location;

#[cfg(test)]
mod ts;

/// Most jobs one page of the list carries.
pub const MAX_PAGE: u32 = 500;

// ---------------------------------------------------------------------- Jobs

/// How a job came to the list (the list's filter "Herkunft"): an alert mail named it, or the
/// app's own search found it. A job can have both.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Origin {
    Mail,
    Search,
}

/// How the job is done, as far as the location field says (and the list's filter by it).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum WorkMode {
    Remote,
    Hybrid,
    Onsite,
}

/// Work mode words in a location ("Berlin (Remote)", "Hybrid", "Vor Ort"), whole words in
/// any case - the same words the mail heuristics keep (`text::page_location`). German mail
/// patterns, do not translate. The list's remote filter reads the same words in SQL
/// (`store::jobs`).
pub(crate) const REMOTE_WORDS: [&str; 3] = ["remote", "home office", "homeoffice"];
pub(crate) const HYBRID_WORDS: [&str; 1] = ["hybrid"];
pub(crate) const ONSITE_WORDS: [&str; 3] = ["vor ort", "on-site", "onsite"];

/// A pattern that finds one of `words` as a whole word, in any case.
fn whole_words(words: &[&str]) -> Regex {
    let words: Vec<String> = words.iter().map(|word| regex::escape(word)).collect();
    Regex::new(&format!(r"(?i)\b(?:{})\b", words.join("|"))).expect("a valid pattern")
}

static REMOTE: LazyLock<Regex> = LazyLock::new(|| whole_words(&REMOTE_WORDS));
static HYBRID: LazyLock<Regex> = LazyLock::new(|| whole_words(&HYBRID_WORDS));
static ONSITE: LazyLock<Regex> = LazyLock::new(|| whole_words(&ONSITE_WORDS));

/// Work mode of a raw location value; remote and on-site together count as hybrid.
pub fn work_mode(location: &str) -> Option<WorkMode> {
    let (remote, onsite) = (REMOTE.is_match(location), ONSITE.is_match(location));
    if HYBRID.is_match(location) || (remote && onsite) {
        Some(WorkMode::Hybrid)
    } else if remote {
        Some(WorkMode::Remote)
    } else if onsite {
        Some(WorkMode::Onsite)
    } else {
        None
    }
}

/// State of the job details.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum DetailState {
    Ok,
    /// Not fetched yet; `retryAt: null` = with the next run.
    Pending {
        retry_at: Option<Timestamp>,
    },
    /// Only the teaser a guest sees (freelance.de without sign-in).
    Teaser,
    /// The last attempts found no description; retried from `retryAt`.
    Failed {
        attempts: u32,
        retry_at: Option<Timestamp>,
    },
    /// The ad no longer exists.
    Gone,
    /// Given up after several failed attempts at this one ad.
    Unfetchable,
    /// Not fetched, and no fetch reaches it (its mail is older than 30 days, or it lies in
    /// the archive or the trash): the ad comes only on request.
    OnRequest,
}

impl DetailState {
    pub fn of(job: &JobRow) -> DetailState {
        DetailState::at(job, Timestamp::now())
    }

    /// The state's `kind` as the JSON says it (`ok`, `pending`, `teaser`, `failed`, `gone`,
    /// `unfetchable`, `onRequest`).
    pub fn code(self) -> &'static str {
        match self {
            DetailState::Ok => "ok",
            DetailState::Pending { .. } => "pending",
            DetailState::Teaser => "teaser",
            DetailState::Failed { .. } => "failed",
            DetailState::Gone => "gone",
            DetailState::Unfetchable => "unfetchable",
            DetailState::OnRequest => "onRequest",
        }
    }

    /// The state at `now`: a job a fetch does not reach (its mail is older than it looks
    /// back, or a place it leaves out, see `store::jobs::FETCHABLE`) is never promised for
    /// "the next fetch" - it waits for a request.
    pub fn at(job: &JobRow, now: Timestamp) -> DetailState {
        let automatic = job.place() == Place::Inbox
            && job.mail_date.unwrap_or(job.first_seen_at)
                >= now.saturating_sub(MAX_AGE).unwrap_or(Timestamp::MIN);
        match job.desc_status {
            DescStatus::Ok => DetailState::Ok,
            DescStatus::Missing if automatic => DetailState::Pending { retry_at: None },
            DescStatus::Missing => DetailState::OnRequest,
            DescStatus::Failed => DetailState::Failed {
                attempts: u32::try_from(job.desc_attempts).unwrap_or(0),
                retry_at: job
                    .desc_attempted_at
                    .and_then(|at| at.checked_add(RETRY_AFTER).ok())
                    .filter(|_| automatic),
            },
            DescStatus::Teaser => DetailState::Teaser,
            DescStatus::Gone => DetailState::Gone,
            DescStatus::Unfetchable => DetailState::Unfetchable,
        }
    }
}

/// The match of a job in the list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobMatch {
    /// 0-100; also kept for excluded jobs.
    pub score: u8,
    pub band: Band,
    pub status: MatchStatus,
    pub note: Option<Notice>,
    pub must_met: u16,
    pub must_total: u16,
    /// At most two met requirements, quoted from the ad.
    pub top: Vec<String>,
    /// At most two open must requirements, quoted from the ad (empty for a job scored by an
    /// earlier version until it is scored again).
    pub open: Vec<String>,
    /// Rate, start, duration, remote share and contract type of the ad.
    pub facts: KeyFacts,
}

/// One row of the job list.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "flat facts of a list row, one JSON field each (IPC contract)"
)]
pub struct JobView {
    pub key: JobKey,
    pub portal: Portal,
    /// Empty when neither the mail nor the link carries a usable title.
    pub title: String,
    pub company: String,
    pub location: String,
    pub work_mode: Option<WorkMode>,
    pub mail_date: Option<Timestamp>,
    pub first_seen_at: Timestamp,
    pub unread: bool,
    pub detail: DetailState,
    /// The full text is short (verified, but under 100 characters).
    pub short: bool,
    /// The ad's page says it no longer accepts applications (the text stays readable).
    pub closed: bool,
    #[serde(rename = "match")]
    #[cfg_attr(test, ts(rename = "match"))]
    pub match_: Option<JobMatch>,
    /// The same job was also announced by these portals.
    pub also_on: Vec<Portal>,
    /// Where the job is: inbox, archive or trash.
    pub place: Place,
    /// When the job went to the trash (null outside it): the trash lists and sorts by it.
    pub trashed_at: Option<Timestamp>,
    /// The user marked the job as fitting although the engine excludes it ("Trotzdem
    /// passend"): it counts as scored with its fit score, its note is `userOverride`.
    pub overridden: bool,
    /// Its alert mail can be opened in Gmail ("Alert-Mail öffnen"; `JobMail.gmailUrl` in the
    /// reader).
    pub has_mail: bool,
    /// How the job came (the filter "Herkunft"): an alert mail named it, the search found it;
    /// both, or none for a job of an earlier version without either time.
    pub origins: Vec<Origin>,
}

impl From<&JobRow> for JobView {
    fn from(job: &JobRow) -> JobView {
        let (company, location) = split_company_location(&job.company, &job.location);
        JobView {
            key: job.key.clone(),
            portal: job.key.portal,
            title: display_title(job),
            company,
            location,
            work_mode: work_mode(&job.location),
            mail_date: job.mail_date,
            first_seen_at: job.first_seen_at,
            unread: job.read_at.is_none(),
            detail: DetailState::of(job),
            short: job.desc_status == DescStatus::Ok && job.desc_short,
            closed: job.desc_status == DescStatus::Ok && job.desc_closed,
            match_: job.match_.as_ref().map(|record| {
                let mut shown = JobMatch::of(record, &job.match_open);
                if job.override_include {
                    shown.status = MatchStatus::Scored;
                    shown.note = Some(Notice {
                        code: crate::store::marks::USER_OVERRIDE.to_owned(),
                        params: serde_json::Map::new(),
                    });
                }
                shown
            }),
            also_on: Vec::new(),
            place: job.place(),
            trashed_at: job.trashed_at,
            overridden: job.override_include,
            has_mail: job.gmail_id.and_then(gmail_url).is_some(),
            origins: [
                job.mailed_at.map(|_| Origin::Mail),
                job.searched_at.map(|_| Origin::Search),
            ]
            .into_iter()
            .flatten()
            .collect(),
        }
    }
}

impl JobMatch {
    /// The list's match of a stored record and its open must requirements.
    pub fn of(record: &MatchRecord, open: &[String]) -> JobMatch {
        JobMatch {
            score: record.score,
            band: band(record.score),
            status: record.status,
            note: record.note.clone(),
            must_met: record.must_met,
            must_total: record.must_total,
            top: record.top.clone(),
            open: open.to_vec(),
            facts: record.facts.clone(),
        }
    }
}

/// The stored title, or - if it is unusable - one read from the slug of a link. A portal's
/// mark for an ended project ("Archiviertes Projekt - ") is no part of it (also in titles
/// stored before the parser dropped it). The app and the Excel file show this one title.
pub(crate) fn display_title(job: &JobRow) -> String {
    if is_usable_title(&job.title) {
        return crate::portal::without_archive_mark(&job.title).to_owned();
    }
    [job.title.as_str(), job.url.as_str()]
        .into_iter()
        .find_map(slug_title)
        .unwrap_or_default()
}

/// A readable title from the last path segment of a link
/// (`/projekt/sap-berater-m-w-d-80331` -> "Sap berater (m/w/d)"); `None` without words.
pub fn slug_title(url: &str) -> Option<String> {
    let url = url::Url::parse(url.trim()).ok()?;
    let segment = url.path_segments()?.rfind(|s| !s.is_empty())?;
    let segment = segment.strip_suffix(".html").unwrap_or(segment);
    let decoded = percent_decode(segment);
    let words: Vec<&str> = decoded
        .split(['-', '_', '+'])
        .filter(|w| !w.is_empty() && !w.chars().all(|c| c.is_ascii_digit()))
        .filter(|w| !w.eq_ignore_ascii_case("projekt"))
        .collect();
    let mut out: Vec<String> = Vec::new();
    let mut i = 0;
    while i < words.len() {
        let gender = words.get(i..i + 3).is_some_and(|w| {
            let lower: Vec<String> = w.iter().map(|s| s.to_lowercase()).collect();
            lower.iter().all(|s| ["m", "w", "d"].contains(&s.as_str())) && lower.len() == 3
        });
        if gender {
            out.push(format!("({})", words[i..i + 3].join("/").to_lowercase()));
            i += 3;
        } else {
            out.push(words[i].to_string());
            i += 1;
        }
    }
    let letters = out
        .iter()
        .filter(|w| w.chars().filter(|c| c.is_alphabetic()).count() >= 2)
        .count();
    if letters < 2 {
        return None;
    }
    let title = out.join(" ");
    let mut chars = title.chars();
    let first = chars.next()?;
    Some(first.to_uppercase().chain(chars).collect())
}

fn percent_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        let hex = |b: u8| (b as char).to_digit(16);
        if bytes[i] == b'%'
            && let (Some(h), Some(l)) = (
                bytes.get(i + 1).copied().and_then(hex),
                bytes.get(i + 2).copied().and_then(hex),
            )
        {
            out.push(u8::try_from(h * 16 + l).unwrap_or(b'?'));
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Kind of a reason in the match explanation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ReasonKind {
    Met,
    Partial,
    Open,
    Violation,
    Check,
}

/// Weight of a reason.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ReasonWeight {
    Must,
    Nice,
    Hard,
    Info,
}

/// Where the profile backs a reason.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Evidence {
    /// The profile phrase.
    pub profile: String,
    /// JSON path in the profile file.
    pub path: String,
    /// Code of the match ladder step (exact, stem, synonym ...).
    pub via: String,
    /// Words of the ad.
    pub quote: String,
}

/// A range in the full text, in UTF-16 code units (as the browser counts).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TextRange {
    pub start: u32,
    pub end: u32,
}

/// One reason of the match explanation.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Reason {
    pub id: String,
    pub kind: ReasonKind,
    pub weight: ReasonWeight,
    pub code: String,
    /// The requirement as the ad words it (data, not prose of the app).
    pub label: String,
    pub evidence: Option<Evidence>,
    #[cfg_attr(test, ts(type = "Record<string, string | number | boolean | null>"))]
    pub params: serde_json::Map<String, serde_json::Value>,
    pub ranges: Vec<TextRange>,
}

/// A highlighted passage of the full text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Highlight {
    pub id: String,
    /// UTF-16 offsets.
    pub start: u32,
    pub end: u32,
    pub kind: ReasonKind,
    /// Id of the reason it belongs to.
    pub reason: String,
}

/// The full match explanation of one job (reader).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MatchDetail {
    pub score: u8,
    pub status: MatchStatus,
    pub band: Band,
    /// Revision of engine, profile and model the score was made with.
    pub rev: String,
    pub at: Timestamp,
    pub summary: Option<Notice>,
    /// At most 40.
    pub reasons: Vec<Reason>,
    /// At most 200.
    pub highlights: Vec<Highlight>,
    /// The hard criteria strip.
    pub criteria: Vec<Reason>,
    /// What moved the score, at most five lines in reading order ("Warum diese Zahl?"):
    /// codes `musts`, `nice`, `focus`, `targetRole`, `wishes`, `evidence`, `permanent`,
    /// `cap` with their params (`matching::FactorCode`).
    pub factors: Vec<Notice>,
}

/// How the reader lays out the ad's text (UTF-16 ranges of `JobDetail::text`).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct TextLayout {
    /// The words of a line that heads a section of the ad.
    pub headings: Vec<TextRange>,
    /// The bullet glyph of a list line and the space after it (the item follows).
    pub bullets: Vec<TextRange>,
}

impl TextLayout {
    fn of(text: Option<&str>) -> Self {
        let Some(text) = text else {
            return Self::default();
        };
        let ranges = |all: Vec<(u32, u32)>| -> Vec<TextRange> {
            all.into_iter()
                .map(|(start, end)| TextRange { start, end })
                .collect()
        };
        let layout = matching::text_layout(text);
        Self {
            headings: ranges(layout.headings),
            bullets: ranges(layout.bullets),
        }
    }
}

/// The alert mail a job came from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobMail {
    pub subject: String,
    pub gmail_url: Option<String>,
}

/// One job in the reader.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobDetail {
    pub job: JobView,
    /// The full text (only with details `ok`).
    pub text: Option<String>,
    pub url: String,
    pub fetched_at: Option<Timestamp>,
    pub mail: JobMail,
    /// Headings and list lines of the text (empty without one).
    pub layout: TextLayout,
    #[serde(rename = "match")]
    #[cfg_attr(test, ts(rename = "match"))]
    pub match_: Option<MatchDetail>,
}

/// Most reasons in the reader.
pub const MAX_REASONS: usize = 40;
/// Most highlighted passages in the reader.
pub const MAX_HIGHLIGHTS: usize = 200;

/// The reader data of a job; `None` if the job does not exist (any more).
///
/// Reasons are not stored: with a usable `matcher` the job is assessed again from its stored
/// text. If its stored score has another revision, the fresh one is saved - only with `save`
/// (no run active); otherwise the run's catch-up takes care of it. Either way the reader
/// shows the fresh result.
pub fn job_detail(
    store: &Store,
    key: &JobKey,
    matcher: Option<&LocalMatcher>,
    save: bool,
    now: Timestamp,
) -> crate::Result<Option<JobDetail>> {
    let Some(mut job) = store.job(key)? else {
        return Ok(None);
    };
    let text = store.description(key)?;
    // An engine panic leaves the reader without a match instead of failing the command.
    let assessed = matcher.filter(|m| m.usable()).and_then(|m| {
        let assessment =
            crate::pipeline::score::guarded(key, || m.assessment(&job, text.as_deref()))??;
        Some((m, assessment))
    });
    let match_ = match assessed {
        None => None,
        Some((matcher, assessment)) => {
            let at = if job.match_rev.as_deref() == Some(matcher.rev()) {
                store.match_at(key)?.unwrap_or(now)
            } else {
                let judged = local::judgement(&assessment);
                // Only over the score read above: a run that started meanwhile may have
                // stored its own (compare and set).
                if save
                    && let Err(e) = store.save_match_if(
                        key,
                        &judged,
                        matcher.rev(),
                        job.match_rev.as_deref(),
                        now,
                    )
                {
                    log::warn!("fresh score of {key} not stored: {e}");
                }
                job.match_ = Some(judged.record);
                job.match_open = judged.open;
                job.match_rev = Some(matcher.rev().to_owned());
                now
            };
            let mut detail = match_detail(&assessment, matcher, at);
            if job.override_include {
                overridden(&mut detail);
                if let Some(record) = job.match_.as_mut() {
                    record.status = MatchStatus::Scored;
                }
            }
            Some(detail)
        }
    };
    Ok(Some(JobDetail {
        layout: TextLayout::of(text.as_deref()),
        text,
        url: job.url.to_string(),
        fetched_at: job.desc_fetched_at,
        mail: JobMail {
            subject: job.mail_subject.clone(),
            gmail_url: job.gmail_id.and_then(gmail_url).map(|u| u.to_string()),
        },
        match_,
        job: job_views(store, std::slice::from_ref(&job))?
            .pop()
            .unwrap_or_else(|| JobView::from(&job)),
    }))
}

/// The reader of a job the user marked as fitting anyway: it counts as scored, its summary
/// is `userOverride`, and a reason with that code comes first (the engine's violations stay
/// listed: the user sees what the engine found).
fn overridden(detail: &mut MatchDetail) {
    let code = crate::store::marks::USER_OVERRIDE;
    detail.status = MatchStatus::Scored;
    detail.summary = Some(Notice {
        code: code.to_owned(),
        params: serde_json::Map::new(),
    });
    detail.reasons.insert(
        0,
        Reason {
            id: code.to_owned(),
            kind: ReasonKind::Met,
            weight: ReasonWeight::Info,
            code: code.to_owned(),
            label: String::new(),
            evidence: None,
            params: serde_json::Map::new(),
            ranges: Vec::new(),
        },
    );
    detail.reasons.truncate(MAX_REASONS);
}

/// The reader's explanation of an assessment: at most [`MAX_REASONS`] reasons (violations,
/// checks and musts before nice-to-haves and info), the highlights of those reasons (at most
/// [`MAX_HIGHLIGHTS`]) and the hard-criteria strip with every criterion the profile sets.
pub fn match_detail(assessment: &Assessment, matcher: &LocalMatcher, at: Timestamp) -> MatchDetail {
    let rank = |r: &matching::Reason| match (r.kind, r.weight) {
        (matching::ReasonKind::Violation, _) => 0,
        (matching::ReasonKind::Check, _) => 1,
        (_, matching::Weight::Must | matching::Weight::Hard) => 2,
        (_, matching::Weight::Nice) => 3,
        (_, matching::Weight::Info) => 4,
    };
    let mut ranked: Vec<&matching::Reason> = assessment.reasons.iter().collect();
    ranked.sort_by_key(|r| rank(r));
    let kept: BTreeSet<u16> = ranked.iter().take(MAX_REASONS).map(|r| r.id).collect();
    let highlights: Vec<&matching::Highlight> = assessment
        .highlights
        .iter()
        .filter(|h| kept.contains(&h.reason))
        .take(MAX_HIGHLIGHTS)
        .collect();
    let ranges = |reason: &matching::Reason| -> Vec<TextRange> {
        highlights
            .iter()
            .filter(|h| reason.ranges.contains(&h.id))
            .map(|h| TextRange {
                start: h.start,
                end: h.end,
            })
            .collect()
    };
    let reasons = assessment
        .reasons
        .iter()
        .filter(|r| kept.contains(&r.id))
        .map(|r| Reason {
            id: reason_id(r.id),
            kind: reason_kind(r.kind),
            weight: reason_weight(r.weight),
            code: local::code_name(&r.code),
            label: r.label.clone().unwrap_or_default(),
            evidence: r.evidence.as_ref().map(|e| Evidence {
                profile: e.profile.clone(),
                path: e.path.clone(),
                via: local::code_name(&e.via),
                quote: e.quote.clone(),
            }),
            params: reason_params(r),
            ranges: ranges(r),
        })
        .collect();
    let criteria = criteria_strip(assessment, matcher, &ranges);
    let record = local::record(assessment);
    MatchDetail {
        score: record.score,
        status: record.status,
        band: band(record.score),
        rev: matcher.rev().to_owned(),
        at,
        summary: Some(summary_notice(&assessment.summary)),
        reasons,
        highlights: highlights
            .iter()
            .map(|h| Highlight {
                id: format!("h{}", h.id),
                start: h.start,
                end: h.end,
                kind: reason_kind(h.kind),
                reason: reason_id(h.reason),
            })
            .collect(),
        criteria,
        factors: assessment
            .factors
            .iter()
            .map(|f| Notice {
                code: local::code_name(&f.code),
                params: local::flat_params(&f.params),
            })
            .collect(),
    }
}

/// The params of a reason for the reader; an open requirement the profile could take also
/// names its term and field (`term`, `field`: `pipeline::local::open_term`), what the
/// reader's "+" adds.
fn reason_params(reason: &matching::Reason) -> serde_json::Map<String, serde_json::Value> {
    let mut params = local::flat_params(&reason.params);
    if let Some(core) = local::open_term(reason) {
        params.insert("term".into(), core.term.into());
        params.insert("field".into(), core.field.name().into());
    }
    params
}

/// The hard-criteria strip: every criterion the profile sets that applies to the job, with
/// the profile's values, the ad's value, the reason that decided it (`params.reason`) and
/// the passages. Kind `met` only with the ad's value as evidence; `open` when the ad does
/// not mention it.
fn criteria_strip(
    assessment: &Assessment,
    matcher: &LocalMatcher,
    ranges: &dyn Fn(&matching::Reason) -> Vec<TextRange>,
) -> Vec<Reason> {
    let set = &matcher.profile().summary().criteria;
    assessment
        .criteria
        .iter()
        .filter(|c| c.status != matching::CriterionStatus::Inactive)
        .map(|c| {
            let linked = c
                .reason
                .and_then(|id| assessment.reasons.iter().find(|r| r.id == id));
            let mut params = set
                .iter()
                .find(|info| info.key == c.key)
                .map(|info| local::flat_params(&info.params))
                .unwrap_or_default();
            params.extend(local::flat_params(&c.params));
            if let Some(reason) = linked {
                params.extend(local::flat_params(&reason.params));
                params.insert("reason".into(), reason_id(reason.id).into());
            }
            let mut passages = linked.map(ranges).unwrap_or_default();
            if passages.is_empty()
                && let Some((start, end)) = c.range
            {
                passages.push(TextRange { start, end });
            }
            let code = local::code_name(&c.key);
            Reason {
                id: format!("c:{code}"),
                kind: match c.status {
                    matching::CriterionStatus::Violated => ReasonKind::Violation,
                    matching::CriterionStatus::Check => ReasonKind::Check,
                    matching::CriterionStatus::NotMentioned => ReasonKind::Open,
                    _ => ReasonKind::Met,
                },
                weight: ReasonWeight::Hard,
                code,
                label: linked.and_then(|r| r.label.clone()).unwrap_or_default(),
                evidence: None,
                params,
                ranges: passages,
            }
        })
        .collect()
}

/// The counts behind the score (`n of m must`) and how much text there was.
fn summary_notice(s: &matching::Summary) -> Notice {
    Notice {
        code: "summary".into(),
        params: serde_json::Map::from_iter([
            ("mustMet".into(), s.must_met.into()),
            ("mustPartial".into(), s.must_partial.into()),
            ("mustOpen".into(), s.must_open.into()),
            ("mustTotal".into(), s.must_total.into()),
            ("niceMet".into(), s.nice_met.into()),
            ("niceTotal".into(), s.nice_total.into()),
            ("evidence".into(), local::code_name(&s.evidence).into()),
        ]),
    }
}

fn reason_id(id: u16) -> String {
    format!("r{id}")
}

fn reason_kind(kind: matching::ReasonKind) -> ReasonKind {
    match kind {
        matching::ReasonKind::Met => ReasonKind::Met,
        matching::ReasonKind::Partial => ReasonKind::Partial,
        matching::ReasonKind::Open => ReasonKind::Open,
        matching::ReasonKind::Violation => ReasonKind::Violation,
        matching::ReasonKind::Check => ReasonKind::Check,
    }
}

fn reason_weight(weight: matching::Weight) -> ReasonWeight {
    match weight {
        matching::Weight::Must => ReasonWeight::Must,
        matching::Weight::Nice => ReasonWeight::Nice,
        matching::Weight::Hard => ReasonWeight::Hard,
        matching::Weight::Info => ReasonWeight::Info,
    }
}

/// List rows with the other portals that announced the same job (`alsoOn`).
pub fn job_views(store: &Store, rows: &[JobRow]) -> crate::Result<Vec<JobView>> {
    let keys: Vec<&JobKey> = rows.iter().map(|row| &row.key).collect();
    let mut also = store.also_on(&keys)?;
    Ok(rows
        .iter()
        .map(|row| JobView {
            also_on: also.remove(&row.key).unwrap_or_default(),
            ..JobView::from(row)
        })
        .collect())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum JobSort {
    /// The jobs still without a score first, then the best match (excluded jobs behind the
    /// others).
    Match,
    /// By date: the alert mail's, in the trash the day the job went there.
    Newest,
    /// By the day rate the ad states, the highest first (in euros, an hourly rate times 8);
    /// jobs without one last (employment pays a salary, a rate in another currency).
    Rate,
}

/// Which jobs the list shows: the jobs of one place, narrowed by the search and the filter.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobQuery {
    pub place: Place,
    /// By match, or by date: the alert mail's, in the trash the day the job went there.
    pub sort: JobSort,
    pub search: Option<String>,
    /// The filter (funnel menu): only these portals' jobs; empty = every portal. Like the
    /// search it narrows the list and all its counts.
    #[serde(default)]
    pub portals: Vec<Portal>,
    /// The filter: only jobs scored in these bands (`high`, `mid`, `low`); unscored and
    /// excluded jobs pass only while it is empty.
    #[serde(default)]
    pub bands: Vec<Band>,
    /// The filter "Aus dem letzten Abruf" (the "Zeigen" of a fetch's toast): only the new
    /// jobs this run brought, the ones its toast counts (`RunSummary.newJobs`: first seen in
    /// it, not excluded). `null` = every job.
    #[serde(default)]
    pub run: Option<i64>,
    /// The filter "Gefunden": only jobs that came at or after this moment (Unix seconds;
    /// the alert mail's date, else when the app first saw the job, as "Nach Datum" orders
    /// them). The page names the start of today, of the last 7 or of the last 30 days in
    /// the user's time zone. `null` = every job.
    #[serde(default)]
    pub received_since: Option<i64>,
    /// At most [`MAX_PAGE`]; 0 = counts only.
    pub limit: u32,
    pub offset: u32,
}

impl JobQuery {
    /// The filter of the query: portals, bands, run and the day it came from.
    pub fn filter(&self) -> ListFilter {
        ListFilter {
            portals: self.portals.clone(),
            bands: self.bands.clone(),
            run: self.run,
            received_since: self.received_since,
        }
    }
}

/// Counts of the list (with the search and the filter applied, whatever the place), from the
/// same statement as the page. Every number of the list comes from here: the rows each place
/// holds (the length of the list, the other places' search hits, "Papierkorb leeren") and
/// its section "Ausgeschlossen".
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobCounts {
    /// In the inbox ("Eingang").
    pub inbox: u32,
    pub archive: u32,
    /// In the trash ("Papierkorb").
    pub trash: u32,
    /// Excluded, in the inbox.
    pub excluded: u32,
    /// Excluded, in the archive (the section "Ausgeschlossen" of the Archiv tab).
    pub excluded_archive: u32,
    /// Excluded, in the trash (the section "Ausgeschlossen" of the Papierkorb tab).
    pub excluded_trash: u32,
}

/// One page of the job list with its counts.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct JobPage {
    pub jobs: Vec<JobView>,
    pub counts: JobCounts,
}

/// List and counts from one store query. A job is in exactly one place.
pub fn job_page(store: &Store, query: &JobQuery) -> crate::Result<JobPage> {
    let (rows, counts) = store.job_page(&PageQuery {
        place: query.place,
        by_match: query.sort == JobSort::Match,
        by_rate: query.sort == JobSort::Rate,
        search: query.search.clone(),
        filter: query.filter(),
        limit: query.limit.min(MAX_PAGE),
        offset: query.offset,
    })?;
    Ok(JobPage {
        jobs: job_views(store, &rows)?,
        counts: JobCounts {
            inbox: counts.inbox,
            archive: counts.archive,
            trash: counts.trash,
            excluded: counts.excluded,
            excluded_archive: counts.excluded_archive,
            excluded_trash: counts.excluded_trash,
        },
    })
}

/// An alert mail of a run without recognised jobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct EmptyAlert {
    pub portal: Portal,
    pub subject: String,
    pub date: Option<Timestamp>,
    /// Gmail message id (hexadecimal) - opened through `open_target`.
    pub gmail_id: Option<String>,
}

/// Longest subject an event or summary carries (in characters).
pub const MAX_SUBJECT_CHARS: usize = 160;

impl From<&AlertMailRow> for EmptyAlert {
    fn from(row: &AlertMailRow) -> EmptyAlert {
        EmptyAlert {
            portal: row.portal,
            subject: crate::text::truncate_chars(&row.subject, MAX_SUBJECT_CHARS),
            date: row.mail_date,
            gmail_id: row.gmail_id.map(|id| format!("{id:x}")),
        }
    }
}

// ---------------------------------------------------------------------- App state

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Platform {
    Windows,
    Macos,
}

/// Where the Gmail app password is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum VaultKind {
    WindowsCredentialManager,
    MacosKeychain,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Mailbox {
    /// The stored Gmail address; `null` = no mailbox connected.
    pub user: Option<String>,
    pub vault: VaultKind,
    /// The vault could not be read.
    pub error: Option<ErrorInfo>,
    /// What "Verbinden" found in the mailbox in this session (the sign-in worked). `null`
    /// before a "Verbinden", and when it signed in but could not count (too slow, or Gmail
    /// failed on a mail): the answer to `save_mailbox` is then signed in and not counted,
    /// and the next fetch reads the alert mails anyway.
    pub check: Option<MailboxCheck>,
    /// When Gmail last accepted this mailbox ("Verbinden", "Speichern"): a mail error of a
    /// fetch that finished before it is past.
    pub checked_at: Option<Timestamp>,
}

/// "Postfach prüfen": the sign-in worked, and this many alert mails of the enabled portals
/// lie in the mailbox from the last `days` days (`mail::check::check_mailbox`; its errors
/// are `invalid` for the shape of the input and the mail error codes of the sign-in).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MailboxCheck {
    pub days: u32,
    pub total: u32,
    /// Every portal asked for, in the order of `Portal::ALL`.
    pub per_portal: Vec<PortalCount>,
}

/// A number of a portal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalCount {
    pub portal: Portal,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SettingsView {
    /// Effective workspace (chosen or default).
    pub workspace: PathBuf,
    pub workspace_is_default: bool,
    /// The Excel file of the overview, where it is or will be written.
    pub excel_path: PathBuf,
    /// The Excel file is there to open: written (`exportExcel` on) and on disk.
    pub excel_exists: bool,
    /// The CSV file of the overview, where it is or will be written (next to the Excel file).
    pub csv_path: PathBuf,
    /// The CSV file is there to open: written (`exportCsv` on) and on disk.
    pub csv_exists: bool,
}

/// Another work folder (`pick_workspace`): the folder, and what became of the profile there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct WorkspacePick {
    pub folder: PathBuf,
    pub profile: WorkspaceProfile,
}

/// The profile after a change of the work folder.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum WorkspaceProfile {
    /// The new folder had none: the old folder's `profil/` came along.
    Copied,
    /// The new folder brings its own profile, which the app uses from now on.
    Own,
    /// Neither folder has a profile.
    None,
}

/// Changes of the settings. `null` = unchanged; the workspace only changes through the
/// folder dialog (`pick_workspace`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SettingsPatch {
    pub portals: Vec<PortalPatch>,
    /// Which alert mails "Postfach abrufen" reads.
    #[serde(default)]
    pub fetch_range: Option<FetchRange>,
    /// Write the Excel file with every export.
    #[serde(default)]
    pub export_excel: Option<bool>,
    /// Write the CSV file with every export.
    #[serde(default)]
    pub export_csv: Option<bool>,
    /// "Jobs abrufen" reads the alert mails.
    #[serde(default)]
    pub fetch_mail: Option<bool>,
    /// "Jobs abrufen" searches the sources.
    #[serde(default)]
    pub fetch_search: Option<bool>,
    /// The language the user chose (from then on the OS language no longer counts).
    pub language: Option<Language>,
    /// The palette the user chose (Einstellungen, Darstellung).
    pub palette: Option<Palette>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalPatch {
    pub portal: Portal,
    pub enabled: Option<bool>,
    pub login_enabled: Option<bool>,
}

impl SettingsPatch {
    pub fn apply(&self, settings: &mut Settings) {
        for patch in &self.portals {
            let switches: &mut PortalSwitches = settings.portals.entry(patch.portal).or_default();
            if let Some(on) = patch.enabled {
                switches.enabled = on;
            }
            if let Some(on) = patch.login_enabled {
                switches.login_enabled = on;
            }
        }
        if let Some(range) = self.fetch_range {
            settings.fetch_range = range;
        }
        if let Some(on) = self.export_excel {
            settings.export_excel = on;
        }
        if let Some(on) = self.export_csv {
            settings.export_csv = on;
        }
        if let Some(on) = self.fetch_mail {
            settings.fetch_mail = on;
        }
        if let Some(on) = self.fetch_search {
            settings.fetch_search = on;
        }
        if let Some(language) = self.language {
            settings.language = Some(language);
        }
        if let Some(palette) = self.palette {
            settings.palette = palette;
        }
    }
}

/// Whether a portal offers a sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum PortalLogin {
    None,
    Optional,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Quota {
    /// Requests in the last hour and the hourly cap.
    pub used_hour: usize,
    pub cap_hour: usize,
    /// Requests today (since local midnight) and the daily cap.
    pub used_day: usize,
    pub cap_day: usize,
}

/// A portal in the settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalState {
    pub portal: Portal,
    /// How the app gets its jobs: its own search, or alert mails (the cards of Einstellungen).
    pub way: Way,
    /// Its alert mails are read and its ads fetched.
    pub enabled: bool,
    pub login: PortalLogin,
    pub login_enabled: bool,
    /// `null` = unknown (or no sign-in), `false` = sign-in needed.
    pub signed_in: Option<bool>,
    pub health: PortalHealth,
    /// The user has to act on the health ([`PortalHealth::action_needed`]).
    pub action_needed: bool,
    pub quota: Option<Quota>,
    /// The date of its last alert mail the app read (`null`: none yet); the settings warn
    /// when it is long ago.
    pub last_alert: Option<Timestamp>,
}

/// The state of every portal. `empty_mails`: alert mails without recognised jobs of the
/// last mailbox run; `last_alerts`: the date of each portal's last alert mail
/// (`Store::last_alerts`).
pub fn portal_states(
    policy: &Policy,
    settings: &Settings,
    empty_mails: &[AlertMailRow],
    last_alerts: &[(Portal, Option<Timestamp>)],
    now: Timestamp,
) -> Vec<PortalState> {
    Portal::ALL
        .into_iter()
        .map(|portal| {
            let state = policy.state(portal);
            let switches = settings.portal(portal);
            let limits = limits(portal);
            let (used_hour, used_day) = policy.usage(portal, now);
            let login = if portal.access().can_sign_in() {
                PortalLogin::Optional
            } else {
                PortalLogin::None
            };
            // Nothing remembered means "unknown": only a sign-in or a page that asks for one
            // turns it into a statement.
            let signed_in = match (login, state.login_needed, state.session_confirmed_at) {
                (PortalLogin::Optional, true, _) => Some(false),
                (PortalLogin::Optional, false, Some(_)) => Some(true),
                _ => None,
            };
            let empty = empty_mails.iter().filter(|m| m.portal == portal).count();
            let health = PortalHealth::of(policy, portal, now, switches.login_enabled, empty);
            PortalState {
                portal,
                way: portal.way(),
                enabled: switches.enabled,
                login,
                login_enabled: switches.login_enabled,
                signed_in,
                action_needed: health.action_needed(),
                health,
                quota: Some(Quota {
                    used_hour,
                    cap_hour: limits.per_hour,
                    used_day,
                    cap_day: limits.per_day,
                }),
                last_alert: last_alerts
                    .iter()
                    .find(|(p, _)| *p == portal)
                    .and_then(|(_, at)| *at),
            }
        })
        .collect()
}

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
    /// JSON path pattern (`kernkompetenzen[].kompetenz`, `stationen[].rolle`).
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
    /// Where the terms come from, also parts the form does not show (`stationen`).
    pub sources: Vec<ProfileSource>,
    pub criteria: Vec<Notice>,
    pub warnings: Vec<Notice>,
    /// Domain packs the profile switched on (`finance`, `sap`, `itProject`, ...).
    pub packs: Vec<String>,
    /// Total years of professional experience, if the profile states them.
    pub years: Option<u32>,
    /// Degrees as written in the profile.
    pub degrees: Vec<String>,
    /// `schwerpunkte`: the competences that matter most.
    pub focus: Vec<String>,
    /// `wunschrollen`: the roles the consultant is looking for.
    pub roles: Vec<String>,
    /// `einsatzpraeferenzen`: wishes, they nudge the score and never exclude.
    pub wishes: ProfileWishes,
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
    /// The file is no valid JSON object any more (edited by hand).
    pub parse_error: Option<ErrorInfo>,
    /// The profile as the editor shows it (`null` while the file does not read).
    pub form: Option<ProfileForm>,
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
        }
    }

    /// Adds the form of the editor.
    #[must_use]
    pub fn with_form(mut self, form: Option<ProfileForm>) -> Self {
        self.form = form;
        self
    }

    /// Adds what the engine understood of the profile and how far the jobs are scored with
    /// it (an empty profile scores nothing, so nothing is pending).
    pub fn understood_by(mut self, matcher: &LocalMatcher, store: &Store) -> crate::Result<Self> {
        let profile = matcher.profile();
        self.quality = Some(profile.quality().into());
        let mut understood = understanding(profile.summary());
        // The newer profile inputs, as the form reads them.
        if let Some(form) = &self.form {
            understood.focus.clone_from(&form.focus);
            understood.roles.clone_from(&form.roles);
            understood.wishes = form.wishes.clone();
        }
        self.understood = Some(understood);
        if matcher.usable() {
            self.scored_at = store.scored_at(matcher.rev())?;
            self.pending = store.match_pending(matcher.rev())?;
        }
        Ok(self)
    }
}

/// A profile of the work folder as the switcher of the Profil view lists it (one of them
/// active; `profile::list`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileEntry {
    /// Its number (`beraterprofil.json` is 1); the page's "Profil 2" without a name or role.
    pub id: u32,
    /// The name the user gave it ("Umbenennen").
    pub name: Option<String>,
    /// Its role (`titel`, else its first `wunschrollen`): its name without one of its own.
    pub role: Option<String>,
    pub active: bool,
}

/// The profiles of the work folder for the switcher, in the order of their numbers.
pub fn profile_entries(workspace: &Path) -> crate::Result<Vec<ProfileEntry>> {
    Ok(crate::profile::list(workspace)?
        .into_iter()
        .map(|entry| ProfileEntry {
            id: entry.id,
            role: crate::profile::role(&entry.path),
            name: entry.name,
            active: entry.active,
        })
        .collect())
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
                let mut params = local::flat_params(&c.params);
                params.insert("set".into(), c.set.into());
                Notice {
                    code: local::code_name(&c.key),
                    params,
                }
            })
            .collect(),
        warnings: summary.warnings.iter().map(profile_warning).collect(),
        packs: summary.packs.clone(),
        years: summary.years,
        degrees: summary.degrees.clone(),
        focus: Vec::new(),
        roles: Vec::new(),
        wishes: ProfileWishes::default(),
    }
}

/// A warning of the engine about the profile; a value it could not read also names the
/// form field that holds it (`field`, an [`UnreadableField`]), so the editor says it there.
fn profile_warning(warning: &matching::ProfileWarning) -> Notice {
    let mut params = local::flat_params(&warning.params);
    let field = match warning.code {
        matching::ProfileWarningCode::AvailabilityNotUnderstood => Some(UnreadableField::Available),
        matching::ProfileWarningCode::CriterionNotUnderstood => warning
            .params
            .get("key")
            .and_then(serde_json::Value::as_str)
            .and_then(UnreadableField::of_key),
        _ => None,
    };
    if let Some(field) = field {
        params.insert("field".into(), local::code_name(&field).into());
    }
    Notice {
        code: local::code_name(&warning.code),
        params,
    }
}

/// A profile read for the editor from a chosen file or a pasted answer: nothing is stored
/// until the user saves it. `understood` says what the engine reads in it (its warnings
/// show before saving).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileDraft {
    pub form: ProfileForm,
    /// The JSON saving merges the form into: the file's or the answer's, for an update from a
    /// CV the stored profile with the answer's career stations.
    pub source: String,
    pub quality: ProfileQuality,
    pub understood: ProfileUnderstanding,
}

impl From<crate::profile::Draft> for ProfileDraft {
    fn from(draft: crate::profile::Draft) -> ProfileDraft {
        let mut understood = understanding(&draft.summary);
        understood.focus.clone_from(&draft.form.focus);
        understood.roles.clone_from(&draft.form.roles);
        understood.wishes = draft.form.wishes.clone();
        ProfileDraft {
            form: draft.form,
            source: draft.source,
            quality: draft.quality.into(),
            understood,
        }
    }
}

/// Saving the editor: the form as it was handed out (`before`) and as the user left it;
/// only what differs is written. `source` is the JSON of a draft (`{}` for a new profile),
/// `null` for the stored profile. `clear` names the values the app could not read that the
/// user removed ("Wert entfernen"): their keys go wherever they are.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ProfileSave {
    pub before: ProfileForm,
    pub after: ProfileForm,
    pub source: Option<String>,
    #[serde(default)]
    pub clear: Vec<UnreadableField>,
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
    // Per key the term of the newest job (the store's order) and the count.
    let mut counted: BTreeMap<String, (CoreTerm, u32)> = BTreeMap::new();
    for labels in store.asked_terms(since)? {
        let mut seen = BTreeSet::new();
        for label in labels {
            let core = cores
                .entry(label)
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
                .or_insert_with(|| (core.clone(), 0));
            // An ad that names the field says more than one that names the term alone
            // ("Branchenerfahrung Handel", "Handel").
            if entry.0.field == TermField::Competence {
                entry.0.field = core.field;
            }
            entry.1 += 1;
        }
    }
    let mut asked: Vec<(CoreTerm, u32)> = counted
        .into_values()
        .filter(|(_, count)| *count >= MIN_ASKED)
        .collect();
    asked.sort_by(|(a, n), (b, m)| {
        m.cmp(n)
            .then_with(|| matching::term_key(&a.term).cmp(&matching::term_key(&b.term)))
    });
    Ok(asked
        .into_iter()
        .take(MAX_ASKED)
        .map(|(core, count)| AskedTerm {
            term: core.term,
            field: core.field,
            count,
        })
        .collect())
}

/// What the profile names already, by the keys of its terms: every competence and its
/// synonyms, keyword, tool, certificate, degree, industry (a wished one too) and language,
/// by its words and by its term (`Englisch` names `English`, `Energiewirtschaft` names
/// `Energie`, see `matching::CoreTerm::key`).
fn named_terms(form: &ProfileForm) -> BTreeSet<String> {
    let entries = form
        .competences
        .iter()
        .flat_map(|c| std::iter::once(&c.name).chain(&c.aliases))
        .chain(&form.keywords)
        .chain(&form.tools)
        .chain(&form.certificates)
        .chain(&form.degrees)
        .chain(&form.industries)
        .chain(&form.wishes.industries)
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

/// Result of "reset everything" after the restart.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ResetSummary {
    pub removed: usize,
    /// Entries that could not be deleted (details in the log).
    pub failed: usize,
}

/// Everything the interface needs at the start (and after a reload).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
#[expect(
    clippy::struct_excessive_bools,
    reason = "flat facts of the app for the page, one JSON field each (IPC contract)"
)]
pub struct AppState {
    pub platform: Platform,
    /// The app's version (`3.0.0`), shown in Einstellungen under Wartung.
    pub version: String,
    pub dry_run: bool,
    /// The demo (`--demo`, or the CXact Demo build): a data folder of its own; every fetch
    /// brings the next bundled ads from a made-up mailbox (`Demo` refuses a real mailbox,
    /// the sign-ins and the vault).
    pub demo: bool,
    /// No run has finished yet and no job is known.
    pub first_run: bool,
    /// A fetch has completed its mailbox step (`pipeline::has_completed_fetch`): the
    /// first-run page stays until then, also after a first fetch that failed.
    pub setup_done: bool,
    /// The run in progress (after a reload the interface picks up from here).
    pub running: Option<RunSnapshot>,
    pub settings: SettingsView,
    pub mailbox: Mailbox,
    /// The active profile.
    pub profile: Option<ProfileInfo>,
    /// Every profile of the work folder, the active one marked (empty without one).
    pub profiles: Vec<ProfileEntry>,
    pub portals: Vec<PortalState>,
    /// Which alert mails "Postfach abrufen" reads.
    pub fetch_range: FetchRange,
    /// The Excel file is written with every export.
    pub export_excel: bool,
    /// The CSV file is written with every export.
    pub export_csv: bool,
    /// "Jobs abrufen" reads the alert mails (the menu beside the button).
    pub fetch_mail: bool,
    /// "Jobs abrufen" searches the sources (the menu beside the button).
    pub fetch_search: bool,
    /// The language of the interface and the exports: the chosen one, else the OS language.
    pub language: Language,
    /// The colours of the page and the window (Excel and the icon keep Light).
    pub palette: Palette,
    /// The last fetch - a rescore or a details run is none.
    pub last_run: Option<RunSummary>,
    pub counts: JobCounts,
    pub match_pending: u32,
    pub data_dir: PathBuf,
    pub log_dir: PathBuf,
    pub reset_report: Option<ResetSummary>,
}

// ---------------------------------------------------------------------- Commands

/// What `open_target` may open - never an arbitrary path or link from the page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum OpenTarget {
    JobUrl {
        key: JobKey,
    },
    /// The alert mail a job came from.
    Gmail {
        key: JobKey,
    },
    /// A new mail to the contact the ad names, the job's title as its subject (the default
    /// mail program).
    ContactMail {
        key: JobKey,
    },
    /// An alert mail by its Gmail id (e.g. one without recognised jobs).
    AlertMail {
        gmail_id: String,
    },
    /// Home page of a portal ("open in your own browser" after a block).
    PortalHome {
        portal: Portal,
    },
    /// The page where the user sets up a source's alert (`setup_url`).
    PortalSetup {
        portal: Portal,
    },
    /// Google page to create an app password.
    AppPasswordPage,
    /// Google page to turn on 2-step verification (an app password needs it).
    TwoStepPage,
    /// The app's data folder (database, settings, sessions).
    DataDir,
    Workspace,
    /// The folder of the profile file in the workspace (`profil`).
    ProfileDir,
    Excel,
    /// The CSV file (`exportCsv`); not found while none is written.
    Csv,
    /// The Excel file shown selected in its folder (Explorer, Finder); the workspace while
    /// there is none yet.
    ExcelInFolder,
    /// The old program's Excel file the app renamed before its first write
    /// (`ExportSummary::backup`), by its name in the result folder, shown selected there.
    ExcelBackupInFolder {
        name: String,
    },
    LogDir,
}

/// A job an undo takes back to the place it came from (`move_back`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MoveBack {
    pub key: JobKey,
    pub to: Place,
    /// When the job went to the trash ([`JobView::trashed_at`]): back in the trash it keeps
    /// its date.
    pub trashed_at: Option<Timestamp>,
}

/// Result of a permanent delete of jobs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Deleted {
    /// Jobs deleted, as the list showed them: one per row (a duplicate that stood behind a
    /// row went with it but does not count).
    pub count: u32,
    /// The keys of every row that went, duplicates included: the page drops them from lists,
    /// the reader and pending undos.
    pub keys: Vec<JobKey>,
    /// The Excel file could not be written again (e.g. open in Excel); `params.target` names
    /// what failed. The jobs are deleted anyway.
    pub export_error: Option<ErrorInfo>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::policy::PauseKind;
    use crate::model::Posting;
    use crate::portal::job_link;
    use crate::store::MailRef;

    fn store_with(url: &str, title: &str, company: &str, location: &str) -> (Store, JobKey) {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let link = job_link(url).unwrap();
        let posting = Posting::new(link.key.clone(), link.url, title, company, location);
        let mail = MailRef {
            subject: "Neue Projekte",
            date: None,
            gmail_id: Some(0x1a2b),
        };
        store
            .upsert_posting(run, &posting, mail, Timestamp::now())
            .unwrap();
        (store, link.key)
    }

    #[test]
    fn job_row_is_cleaned_for_display() {
        let (store, key) = store_with(
            "https://www.freelancermap.de/nproj/12345.html",
            "Rolle",
            "von: Muster GmbH",
            "Am Mühlenweg 68, 27356 Rotenburg Wümme (Remote)",
        );
        let view = JobView::from(&store.job(&key).unwrap().unwrap());
        assert_eq!(view.company, "Muster GmbH");
        assert_eq!(view.work_mode, Some(WorkMode::Remote));
        assert_eq!(view.detail, DetailState::Pending { retry_at: None });
        let json = serde_json::to_value(&view).unwrap();
        assert_eq!(json["match"], serde_json::Value::Null, "null, not missing");
        assert_eq!(json["detail"]["kind"], "pending");
        assert_eq!(json["portal"], "freelancermap");
        let detail = job_detail(&store, &key, None, true, Timestamp::now())
            .unwrap()
            .unwrap();
        assert_eq!(detail.match_, None, "no profile, no match");
        assert_eq!(
            detail.mail.gmail_url.as_deref(),
            Some("https://mail.google.com/mail/u/0/#all/1a2b")
        );
        // The row knows it too: its menu offers the alert mail like the reader.
        assert!(view.has_mail && detail.job.has_mail);
        assert_eq!(json["hasMail"], true);
    }

    /// A closed ad reaches the list, marked as closed, until its page says it is open again.
    #[test]
    fn a_closed_ad_is_marked() {
        let (store, key) = store_with(
            "https://www.linkedin.com/jobs/view/4123456789/",
            "Controller",
            "Muster GmbH",
            "Köln",
        );
        let text = "Aufgaben und Anforderungen des Projekts. ".repeat(5);
        store
            .record_text(&key, &text, false, true, Timestamp::now())
            .unwrap();
        let view = JobView::from(&store.job(&key).unwrap().unwrap());
        assert!(view.closed);
        assert_eq!(view.detail, DetailState::Ok);
        assert_eq!(serde_json::to_value(&view).unwrap()["closed"], true);
        store
            .record_text(&key, &text, false, false, Timestamp::now())
            .unwrap();
        assert!(!JobView::from(&store.job(&key).unwrap().unwrap()).closed);
    }

    /// A job older than a fetch reaches is never promised for "the next fetch":
    /// it waits for a request, and a failed one shows no retry time.
    #[test]
    fn an_old_job_waits_for_a_request() {
        let (store, key) = store_with(
            "https://www.freelancermap.de/nproj/12345.html",
            "Rolle",
            "Muster GmbH",
            "Köln",
        );
        let job = store.job(&key).unwrap().unwrap();
        let now = job.first_seen_at;
        let later = now
            .checked_add(jiff::SignedDuration::from_hours(40 * 24))
            .unwrap();
        assert_eq!(
            DetailState::at(&job, now),
            DetailState::Pending { retry_at: None }
        );
        assert_eq!(DetailState::at(&job, later), DetailState::OnRequest);
        store.record_failed(&key, "noDescription", now).unwrap();
        let failed = store.job(&key).unwrap().unwrap();
        assert!(matches!(
            DetailState::at(&failed, now),
            DetailState::Failed {
                retry_at: Some(_),
                ..
            }
        ));
        assert_eq!(
            DetailState::at(&failed, later),
            DetailState::Failed {
                attempts: 1,
                retry_at: None
            }
        );
    }

    /// A fetch leaves the trash and the archive out: their jobs wait for a
    /// request instead of a promise for the next fetch.
    #[test]
    fn a_job_the_queue_leaves_out_waits_for_a_request() {
        let (store, key) = store_with(
            "https://www.freelancermap.de/nproj/12345.html",
            "Rolle",
            "Muster GmbH",
            "Köln",
        );
        let now = store.job(&key).unwrap().unwrap().first_seen_at;
        let one = std::slice::from_ref(&key);
        let state = || DetailState::at(&store.job(&key).unwrap().unwrap(), now);
        let pending = DetailState::Pending { retry_at: None };
        assert_eq!(state(), pending);
        store.move_jobs(one, Place::Archive, now).unwrap();
        assert_eq!(state(), DetailState::OnRequest);
        store.move_jobs(one, Place::Trash, now).unwrap();
        assert_eq!(state(), DetailState::OnRequest);
        store.move_jobs(one, Place::Inbox, now).unwrap();
        assert_eq!(state(), pending);
    }

    #[test]
    fn work_modes_from_the_location() {
        assert_eq!(work_mode("Berlin (Remote)"), Some(WorkMode::Remote));
        assert_eq!(work_mode("Hamburg (Hybrid)"), Some(WorkMode::Hybrid));
        assert_eq!(work_mode("Vor Ort in Köln"), Some(WorkMode::Onsite));
        assert_eq!(work_mode("Remote oder vor Ort"), Some(WorkMode::Hybrid));
        assert_eq!(work_mode("Remotely-Str. 5, München"), None);
        assert_eq!(work_mode("Köln"), None);
        assert_eq!(work_mode("Home Office"), Some(WorkMode::Remote));
        assert_eq!(work_mode("ON-SITE Stuttgart"), Some(WorkMode::Onsite));
        // The list's remote filter reads the words in SQL (a GLOB on the lowercase location):
        // lowercase, and nothing a GLOB or a string literal would read otherwise.
        for word in REMOTE_WORDS
            .iter()
            .chain(&HYBRID_WORDS)
            .chain(&ONSITE_WORDS)
        {
            assert_eq!(*word, word.to_lowercase());
            assert!(!word.contains(['*', '?', '[', ']', '\'']), "{word}");
        }
    }

    #[test]
    fn an_unusable_title_is_read_from_the_link() {
        assert_eq!(
            slug_title("https://www.freelancermap.de/projekt/sap-berater-m-w-d-80331-muenchen")
                .as_deref(),
            Some("Sap berater (m/w/d) muenchen")
        );
        assert_eq!(
            slug_title(
                "https://www.linkedin.com/jobs/view/sap-production-support-at-siemens-4456653430"
            )
            .as_deref(),
            Some("Sap production support at siemens")
        );
        assert_eq!(
            slug_title("https://www.linkedin.com/jobs/view/4123456789/"),
            None
        );
        assert_eq!(slug_title("kein Link"), None);
        let (store, key) = store_with(
            "https://www.freelancermap.de/projekt/interim-controller-remote",
            "",
            "",
            "",
        );
        let view = JobView::from(&store.job(&key).unwrap().unwrap());
        assert_eq!(view.title, "Interim controller remote");
    }

    fn record(status: MatchStatus, score: u8) -> MatchRecord {
        MatchRecord {
            status,
            score,
            note: None,
            must_met: 1,
            must_total: 2,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        }
    }

    /// Four jobs: A read, B high, C excluded with a higher score, D unscored.
    fn four_jobs() -> Store {
        let (store, a) = store_with(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        let run = store.begin_run().unwrap();
        let mut keys = Vec::new();
        for (i, title) in [(2, "B"), (3, "C"), (4, "D")] {
            let link =
                job_link(&format!("https://www.linkedin.com/jobs/view/400000000{i}/")).unwrap();
            let posting = Posting::new(link.key.clone(), link.url, title, "", "");
            let mail = MailRef {
                subject: "x",
                date: None,
                gmail_id: None,
            };
            let at = Timestamp::now() + jiff::SignedDuration::from_mins(i);
            store.upsert_posting(run, &posting, mail, at).unwrap();
            keys.push(link.key);
        }
        store
            .record_text(&keys[0], "Volltext", false, false, Timestamp::now())
            .unwrap();
        store.mark_read(&a, Timestamp::now()).unwrap();
        store
            .save_matches(
                &[
                    (a, record(MatchStatus::Scored, 50)),
                    (keys[0].clone(), record(MatchStatus::Scored, 85)),
                    (keys[1].clone(), record(MatchStatus::Excluded, 95)),
                ],
                "r",
                Timestamp::now(),
            )
            .unwrap();
        store
    }

    fn titles(page: &JobPage) -> Vec<&str> {
        page.jobs.iter().map(|j| j.title.as_str()).collect()
    }

    fn query(place: Place, sort: JobSort, limit: u32, offset: u32) -> JobQuery {
        JobQuery {
            place,
            sort,
            search: None,
            portals: Vec::new(),
            bands: Vec::new(),
            received_since: None,
            run: None,
            limit,
            offset,
        }
    }

    /// The filter narrows the list and every count like the search: one portal's jobs, or
    /// only the jobs scored in one band (unscored and excluded ones only without it). A query
    /// without the fields, or with the fields of an earlier version, reads as none.
    #[test]
    fn the_origins_say_how_a_job_came() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let now = Timestamp::now();
        let both = job_link("https://www.linkedin.com/jobs/view/4000000001/").unwrap();
        let found = job_link("https://www.hays.de/jobsuche/stellenangebote-jobs-detail-x-896260/1")
            .unwrap();
        let posting = |link: &crate::portal::JobLink| {
            Posting::new(link.key.clone(), link.url.clone(), "T", "", "")
        };
        let mail = MailRef {
            subject: "Neue Jobs",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(run, &posting(&both), mail, now)
            .unwrap();
        store
            .record_found(run, &[posting(&both), posting(&found)], now)
            .unwrap();
        let page = || {
            let page = job_page(&store, &query(Place::Inbox, JobSort::Newest, 50, 0)).unwrap();
            let mut keys: Vec<(String, Vec<Origin>)> = page
                .jobs
                .iter()
                .map(|job| (job.key.portal.key().to_owned(), job.origins.clone()))
                .collect();
            keys.sort_by(|a, b| a.0.cmp(&b.0));
            keys
        };
        assert_eq!(
            page(),
            [
                ("hays".to_owned(), vec![Origin::Search]),
                ("linkedin".to_owned(), vec![Origin::Mail, Origin::Search])
            ]
        );
    }

    #[test]
    fn the_filter_narrows_list_and_counts() {
        let store = four_jobs();
        let run = store.begin_run().unwrap();
        let link = job_link("https://www.freelancermap.de/nproj/12345.html").unwrap();
        let other = link.key.clone();
        let posting = Posting::new(link.key, link.url, "E", "", "");
        let mail = MailRef {
            subject: "x",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(run, &posting, mail, Timestamp::now())
            .unwrap();
        store
            .save_matches(
                &[(other, record(MatchStatus::Scored, 25))],
                "r",
                Timestamp::now(),
            )
            .unwrap();
        let page = |portal: Option<Portal>, band: Option<Band>| {
            let mut q = query(Place::Inbox, JobSort::Match, 50, 0);
            q.portals = portal.into_iter().collect();
            q.bands = band.into_iter().collect();
            job_page(&store, &q).unwrap()
        };
        let all = page(None, None);
        assert_eq!(titles(&all), ["D", "B", "A", "E", "C"]);
        let linkedin = page(Some(Portal::LinkedIn), None);
        assert_eq!(titles(&linkedin), ["D", "B", "A", "C"]);
        assert_eq!(linkedin.counts.inbox, 4, "the counts follow");
        let map = page(Some(Portal::Freelancermap), None);
        assert_eq!(titles(&map), ["E"]);
        assert_eq!((map.counts.inbox, map.counts.excluded), (1, 0));
        // A: 50, B: 85, C: excluded 95, D: unscored, E: 25. Each band only its own scores.
        let mid = page(None, Some(Band::Mid));
        assert_eq!(
            titles(&mid),
            ["A"],
            "no unscored, no excluded, no other band"
        );
        assert_eq!((mid.counts.inbox, mid.counts.excluded), (1, 0));
        let high = page(None, Some(Band::High));
        assert_eq!(titles(&high), ["B"]);
        assert_eq!(high.counts.inbox, 1);
        assert_eq!(titles(&page(None, Some(Band::Low))), ["E"]);
        assert_eq!(
            titles(&page(Some(Portal::LinkedIn), Some(Band::Mid))),
            ["A"]
        );
        assert!(titles(&page(Some(Portal::LinkedIn), Some(Band::Low))).is_empty());
        // Several portals and several bands: any of them, the bands need not touch.
        let mut q = query(Place::Inbox, JobSort::Match, 50, 0);
        q.portals = vec![Portal::LinkedIn, Portal::Freelancermap];
        assert_eq!(
            titles(&job_page(&store, &q).unwrap()),
            ["D", "B", "A", "E", "C"]
        );
        q.bands = vec![Band::High, Band::Low];
        let both = job_page(&store, &q).unwrap();
        assert_eq!(titles(&both), ["B", "E"]);
        assert_eq!((both.counts.inbox, both.counts.excluded), (2, 0));
        // Eingegangen: only the jobs that came from that moment on (no mail date here: the
        // first sighting; B, C and D came minutes after A and E).
        let mut q = query(Place::Inbox, JobSort::Match, 50, 0);
        q.received_since = Some(crate::time::to_db(
            Timestamp::now() + jiff::SignedDuration::from_secs(90),
        ));
        assert_eq!(titles(&job_page(&store, &q).unwrap()), ["D", "B", "C"]);
        q.received_since = Some(0);
        assert_eq!(job_page(&store, &q).unwrap().jobs.len(), 5);
        // The fields may be missing (an older page): no filter.
        let json = r#"{"place":"inbox","unread":false,"sort":"match",
                       "search":null,"limit":10,"offset":0}"#;
        let old: JobQuery = serde_json::from_str(json).unwrap();
        assert_eq!(old.filter(), ListFilter::default());
        // The fields of an earlier version filter nothing.
        let json = r#"{"place":"inbox","unread":false,"sort":"match","search":null,
                       "minBand":"mid","remoteOnly":true,"remoteOrHybrid":true,
                       "minDayRate":900,"minSalary":90000,"deadlineSoon":true,
                       "limit":10,"offset":0}"#;
        let old: JobQuery = serde_json::from_str(json).unwrap();
        assert_eq!(old.filter(), ListFilter::default());
        // One portal and one band of an earlier version filter nothing now.
        let json = r#"{"place":"inbox","unread":false,"sort":"match","search":null,
                       "portal":"freelance","band":"low","limit":10,"offset":0}"#;
        let single: JobQuery = serde_json::from_str(json).unwrap();
        assert_eq!(single.filter(), ListFilter::default());
        let json = r#"{"place":"inbox","unread":false,"sort":"match","search":null,
                       "portals":["freelance","hays"],"bands":["high","low"],
                       "contracts":["interim","anue"],"workMode":"onsite","run":7,
                       "receivedSince":1790000000,"limit":10,"offset":0}"#;
        let new: JobQuery = serde_json::from_str(json).unwrap();
        assert_eq!(
            new.filter(),
            ListFilter {
                portals: vec![Portal::FreelanceDe, Portal::Hays],
                bands: vec![Band::High, Band::Low],
                run: Some(7),
                received_since: Some(1_790_000_000),
            }
        );
    }

    /// The "Zeigen" of a fetch's toast lists exactly the jobs the toast counts: the new jobs
    /// of that run (first seen in it, another portal's duplicate once, none excluded), with
    /// the band of the high ones where it names them; the counts follow.
    #[test]
    fn the_run_filter_lists_the_jobs_its_toast_counts() {
        let store = four_jobs();
        let run = store.begin_run().unwrap();
        let mut keys = Vec::new();
        for (i, title) in [(5, "E"), (6, "F"), (7, "G")] {
            let link =
                job_link(&format!("https://www.linkedin.com/jobs/view/400000000{i}/")).unwrap();
            let posting = Posting::new(link.key.clone(), link.url, title, "", "");
            let mail = MailRef {
                subject: "x",
                date: None,
                gmail_id: None,
            };
            store
                .upsert_posting(run, &posting, mail, Timestamp::now())
                .unwrap();
            keys.push(link.key);
        }
        // E high, F excluded, G unscored.
        store
            .save_matches(
                &[
                    (keys[0].clone(), record(MatchStatus::Scored, 90)),
                    (keys[1].clone(), record(MatchStatus::Excluded, 95)),
                ],
                "r",
                Timestamp::now(),
            )
            .unwrap();
        let page = |band: Option<Band>| {
            let mut q = query(Place::Inbox, JobSort::Match, 50, 0);
            q.run = Some(run);
            q.bands = band.into_iter().collect();
            job_page(&store, &q).unwrap()
        };
        let (count, high) = store.new_jobs(run).unwrap();
        let all = page(None);
        assert_eq!(
            titles(&all),
            ["G", "E"],
            "no job of an earlier run, none excluded"
        );
        assert_eq!((all.counts.inbox, all.counts.excluded), (2, 0));
        assert_eq!(all.jobs.len(), count);
        assert!(!all.jobs[0].has_mail, "no Gmail id, no alert mail to open");
        let best = page(Some(Band::High));
        assert_eq!(titles(&best), ["E"]);
        assert_eq!(best.jobs.len(), high);
    }

    /// A range of remote shares is a work mode like one share (from 100 % remote, to 0 % on
    /// site, else hybrid), and the list orders by day rate: the highest first (in euros, an
    /// hourly one times 8), equal ones by date, the rest last; the unread filter narrows it
    /// and its counts like the rest of the filter.
    #[test]
    fn the_rate_order_puts_the_highest_day_rate_first() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let facts = |contract: &str, rate: Option<u32>| KeyFacts {
            contract: Some(contract.to_owned()),
            rate,
            ..KeyFacts::default()
        };
        // Title, location and the key facts; `None`: the job is not scored.
        let jobs: [(&str, &str, Option<KeyFacts>); 8] = [
            ("A", "Berlin (Remote)", Some(facts("freelance", Some(1200)))),
            (
                "B",
                "Köln (Hybrid)",
                Some(KeyFacts {
                    hourly: Some(true),
                    ..facts("interim", Some(150))
                }),
            ),
            (
                "C",
                "München",
                Some(KeyFacts {
                    remote_from: Some(0),
                    remote_to: Some(40),
                    ..facts("freelance", Some(1000))
                }),
            ),
            (
                "D",
                "Remote",
                Some(KeyFacts {
                    remote_from: Some(0),
                    remote_to: Some(0),
                    currency: Some("CHF".into()),
                    ..facts("freelance", Some(1300))
                }),
            ),
            (
                "E",
                "Vor Ort",
                Some(KeyFacts {
                    salary: Some(95_000),
                    remote_from: Some(100),
                    remote_to: Some(100),
                    ..facts("permanent", Some(2000))
                }),
            ),
            ("F", "Remote", Some(facts("anue", None))),
            ("G", "", Some(KeyFacts::default())),
            ("H", "Hybrid", None),
        ];
        let mut keys = Vec::new();
        let mut matches = Vec::new();
        for (i, (title, location, facts)) in jobs.iter().enumerate() {
            let link = job_link(&format!(
                "https://www.freelancermap.de/nproj/{}.html",
                12_500 + i
            ))
            .unwrap();
            keys.push(link.key.clone());
            let posting = Posting::new(link.key.clone(), link.url, title, "", location);
            let mail = MailRef {
                subject: "x",
                date: None,
                gmail_id: None,
            };
            let at = Timestamp::now() + jiff::SignedDuration::from_mins(i64::try_from(i).unwrap());
            store.upsert_posting(run, &posting, mail, at).unwrap();
            if let Some(facts) = facts {
                let mut m = record(MatchStatus::Scored, 50);
                m.facts = facts.clone();
                matches.push((link.key, m));
            }
        }
        store.save_matches(&matches, "r", Timestamp::now()).unwrap();
        // By rate: the equal rates of A and B by date (B is newer), then C, then the rest by
        // date, the newest first.
        let by_rate = job_page(&store, &query(Place::Inbox, JobSort::Rate, 50, 0)).unwrap();
        assert_eq!(titles(&by_rate), ["B", "A", "C", "H", "G", "F", "E", "D"]);
    }

    /// A page with every filter on takes moments at 2,000 jobs, not seconds.
    #[test]
    fn a_filtered_page_is_quick_at_2000_jobs() {
        let store = Store::in_memory().unwrap();
        let now = Timestamp::now();
        let run = store.begin_run().unwrap();
        let mut matches = Vec::new();
        for i in 0..2000_i64 {
            let link = job_link(&format!(
                "https://www.linkedin.com/jobs/view/{}/",
                4_100_000_000 + i
            ))
            .unwrap();
            let posting = Posting::new(link.key.clone(), link.url, "Rolle", "Firma", "Köln");
            let mail = MailRef {
                subject: "x",
                date: Some(now - jiff::SignedDuration::from_hours(i % 60 * 24)),
                gmail_id: None,
            };
            store.upsert_posting(run, &posting, mail, now).unwrap();
            let band_score = if i % 3 == 0 { 70 } else { 20 };
            matches.push((link.key, record(MatchStatus::Scored, band_score)));
        }
        store.save_matches(&matches, "r", now).unwrap();
        let mut q = query(Place::Inbox, JobSort::Match, 50, 0);
        q.portals = vec![Portal::LinkedIn];
        q.bands = vec![Band::Mid];
        q.received_since = Some((now - jiff::SignedDuration::from_hours(29 * 24 + 12)).as_second());
        let started = std::time::Instant::now();
        let page = job_page(&store, &q).unwrap();
        let took = started.elapsed();
        // Every third job is in the band, half of them came in the last 30 days.
        assert_eq!(page.counts.inbox, 337);
        assert_eq!(page.jobs.len(), 50);
        assert!(took < std::time::Duration::from_millis(500), "{took:?}");
    }

    #[test]
    fn a_page_and_its_counts_come_together() {
        let store = four_jobs();
        let expected = JobCounts {
            inbox: 4,
            archive: 0,
            trash: 0,
            excluded: 1,
            excluded_archive: 0,
            excluded_trash: 0,
        };
        let page = |sort, limit, offset| {
            job_page(&store, &query(Place::Inbox, sort, limit, offset)).unwrap()
        };
        // The unscored one first; the read job A and the unread but excluded C stand too.
        let all = page(JobSort::Match, 50, 0);
        assert_eq!(titles(&all), ["D", "B", "A", "C"]);
        assert!(all.jobs[0].unread && all.jobs[0].match_.is_none());
        let newest = page(JobSort::Newest, 50, 0);
        assert_eq!(titles(&newest), ["D", "B", "A", "C"]);
        assert!(!newest.jobs[2].unread);
        // Past the end or counts only: no rows, the same counts.
        let past = page(JobSort::Match, 50, 10);
        assert!(past.jobs.is_empty());
        assert_eq!(&past.counts, &expected);
        let counts_only = page(JobSort::Match, 0, 0);
        assert_eq!(
            (counts_only.jobs.len(), &counts_only.counts),
            (0, &expected)
        );
        // The search narrows list and counts alike.
        let mut search = query(Place::Inbox, JobSort::Match, 50, 0);
        search.search = Some("volltext".into());
        let found = job_page(&store, &search).unwrap();
        assert_eq!((found.jobs.len(), found.counts.inbox), (1, 1));
    }

    /// A job is in one place: inbox, archive or trash, each with its list and count. List and
    /// counts agree for every place.
    #[test]
    fn every_place_has_its_list_and_its_count() {
        let store = four_jobs();
        let key = |i: u8| {
            job_link(&format!("https://www.linkedin.com/jobs/view/400000000{i}/"))
                .unwrap()
                .key
        };
        let at = Timestamp::now();
        let later = at + jiff::SignedDuration::from_mins(5);
        // C (excluded) archived, D (unscored, unread) in the trash later.
        store.move_jobs(&[key(3)], Place::Archive, at).unwrap();
        store.move_jobs(&[key(4)], Place::Trash, later).unwrap();
        let page = |place| job_page(&store, &query(place, JobSort::Match, 50, 0)).unwrap();
        let inbox = page(Place::Inbox);
        assert_eq!(titles(&inbox), ["B", "A"]);
        let counts = &inbox.counts;
        assert_eq!(
            (counts.inbox, counts.excluded),
            (2, 0),
            "archive and trash in no inbox count"
        );
        assert_eq!((counts.archive, counts.trash), (1, 1));
        assert_eq!(
            (counts.excluded_archive, counts.excluded_trash),
            (1, 0),
            "the excluded ones of the archive and the trash, each in its place"
        );
        let archive = page(Place::Archive);
        assert_eq!(titles(&archive), ["C"]);
        assert_eq!(archive.jobs[0].place, Place::Archive);
        let trash = page(Place::Trash);
        assert_eq!(titles(&trash), ["D"]);
        assert_eq!(trash.counts, inbox.counts, "the counts ignore the place");
    }

    #[test]
    fn portal_state_shows_pause_quota_and_layout() {
        let now = Timestamp::now();
        let mut policy = Policy::in_memory();
        policy.pause(Portal::LinkedIn, PauseKind::Blocked, "HTTP 999", now);
        let hourly = crate::fetch::policy::limits(Portal::Freelancermap).per_hour;
        for _ in 0..hourly {
            policy.record_access(Portal::Freelancermap, now);
        }
        let mut settings = Settings::default();
        settings
            .portals
            .get_mut(&Portal::FreelanceDe)
            .unwrap()
            .login_enabled = true;
        let empty = [AlertMailRow {
            portal: Portal::FreelanceDe,
            subject: "Projektvorschläge".into(),
            mail_date: None,
            gmail_id: None,
        }];
        let states = portal_states(&policy, &settings, &empty, &[], now);
        let of = |portal| states.iter().find(|s| s.portal == portal).unwrap();
        let li = of(Portal::LinkedIn);
        assert!(matches!(
            li.health,
            PortalHealth::Paused {
                reason: crate::fetch::policy::PauseReason::Blocked,
                ..
            }
        ));
        assert_eq!((li.login, li.signed_in), (PortalLogin::None, None));
        let fm = of(Portal::Freelancermap);
        assert!(matches!(fm.health, PortalHealth::QuotaReached { .. }));
        assert_eq!(fm.quota.unwrap().used_hour, hourly);
        let fl = of(Portal::FreelanceDe);
        assert_eq!(fl.login, PortalLogin::Optional);
        assert_eq!(
            fl.health,
            PortalHealth::LayoutSuspect {
                empty_mails: 1,
                pages: 0
            }
        );
        // Whether to act comes with the health: alert mails without jobs ask her to look,
        // a pause and a cap resolve themselves.
        assert_eq!(
            (li.action_needed, fm.action_needed, fl.action_needed),
            (false, false, true)
        );
        assert!(PortalHealth::LoginRequired.action_needed());
        assert!(
            !PortalHealth::LayoutSuspect {
                empty_mails: 0,
                pages: 5
            }
            .action_needed()
        );
    }

    /// Each portal carries the date of its last alert mail; one that never sent one has none.
    #[test]
    fn each_portal_carries_its_last_alert() {
        let now = Timestamp::now();
        let day = now - jiff::SignedDuration::from_hours(24 * 9);
        let last = [(Portal::LinkedIn, Some(day)), (Portal::FreelanceDe, None)];
        let states = portal_states(&Policy::in_memory(), &Settings::default(), &[], &last, now);
        let of = |portal| {
            states
                .iter()
                .find(|s| s.portal == portal)
                .unwrap()
                .last_alert
        };
        assert_eq!(of(Portal::LinkedIn), Some(day));
        assert_eq!(of(Portal::FreelanceDe), None);
        assert_eq!(of(Portal::Freelancermap), None);
    }

    /// The sign-in state has three values: nothing remembered = unknown.
    #[test]
    fn the_sign_in_state_is_unknown_until_something_happened() {
        let now = Timestamp::now();
        let settings = Settings::default();
        let mut policy = Policy::in_memory();
        let state = |policy: &Policy| {
            portal_states(policy, &settings, &[], &[], now)
                .into_iter()
                .find(|s| s.portal == Portal::FreelanceDe)
                .unwrap()
        };
        assert_eq!(state(&policy).signed_in, None);
        policy.set_session(Portal::FreelanceDe, true, now);
        assert_eq!(state(&policy).signed_in, Some(true));
        policy.set_session(Portal::FreelanceDe, false, now);
        assert_eq!(state(&policy).signed_in, Some(false));
        // Sign-in switched off: the portal goes as a guest, nothing is wrong.
        assert_eq!(state(&policy).health, PortalHealth::Ok);
        let mut settings = settings.clone();
        settings
            .portals
            .get_mut(&Portal::FreelanceDe)
            .unwrap()
            .login_enabled = true;
        let health = portal_states(&policy, &settings, &[], &[], now)
            .into_iter()
            .find(|s| s.portal == Portal::FreelanceDe)
            .unwrap()
            .health;
        assert_eq!(health, PortalHealth::LoginRequired);
    }

    const AD: &str = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Konzernrechnungslegung nach IFRS
- Kenntnisse in Zollabwicklung

Rahmenbedingungen:
- Tagessatz bis 700 €
- Einsatzort Hamburg";

    fn job_with_text(text: &str) -> (Store, JobKey) {
        let (store, key) = store_with(
            "https://www.linkedin.com/jobs/view/4000000009/",
            "Interim CFO (m/w/d)",
            "Nordlicht AG",
            "Hamburg",
        );
        store
            .record_text(&key, text, false, false, Timestamp::now())
            .unwrap();
        (store, key)
    }

    /// The reader recomputes the reasons; a stale stored score is replaced only when no run
    /// is active (`save`), and a current one keeps its time.
    #[test]
    fn the_reader_recomputes_and_heals_a_stale_score() {
        let matcher = crate::pipeline::demo::matcher();
        let (store, key) = job_with_text(AD);
        let t1: Timestamp = "2026-09-20T08:00:00Z".parse().unwrap();
        let busy = job_detail(&store, &key, Some(&matcher), false, t1)
            .unwrap()
            .unwrap();
        let fresh = busy.match_.as_ref().unwrap();
        assert_eq!(fresh.status, MatchStatus::Excluded);
        assert_eq!((fresh.rev.as_str(), fresh.at), (matcher.rev(), t1));
        assert_eq!(
            busy.job.match_.as_ref().unwrap().status,
            MatchStatus::Excluded,
            "the header shows the fresh result"
        );
        assert_eq!(
            store.match_rev(&key).unwrap(),
            None,
            "a run is active: not saved"
        );
        let idle = job_detail(&store, &key, Some(&matcher), true, t1)
            .unwrap()
            .unwrap();
        assert_eq!(idle.match_, busy.match_);
        assert_eq!(
            store.match_rev(&key).unwrap().as_deref(),
            Some(matcher.rev())
        );
        let stored = store.job(&key).unwrap().unwrap().match_.unwrap();
        assert_eq!(stored.note.unwrap().code, "dayRate");
        let t2: Timestamp = "2026-09-21T08:00:00Z".parse().unwrap();
        let later = job_detail(&store, &key, Some(&matcher), true, t2)
            .unwrap()
            .unwrap();
        assert_eq!(later.match_.unwrap().at, t1, "current score: stored time");
        // Without a usable profile there is no match to explain.
        let empty = LocalMatcher::from_json(&serde_json::json!({}));
        let none = job_detail(&store, &key, Some(&empty), true, t2)
            .unwrap()
            .unwrap();
        assert_eq!(none.match_, None);
    }

    /// "Fits anyway": the excluded job shows as scored with the user's word first (the
    /// engine's findings stay listed); taken back, the engine's verdict is stored again.
    #[test]
    fn an_override_shows_the_users_word_and_can_be_taken_back() {
        let matcher = crate::pipeline::demo::matcher();
        let (store, key) = job_with_text(AD);
        let now = Timestamp::now();
        job_detail(&store, &key, Some(&matcher), true, now).unwrap();
        assert!(store.set_override(&key, true).unwrap());
        let detail = job_detail(&store, &key, Some(&matcher), true, now)
            .unwrap()
            .unwrap();
        assert!(detail.job.overridden);
        let m = detail.match_.unwrap();
        assert_eq!(m.status, MatchStatus::Scored);
        assert_eq!(m.summary.unwrap().code, "userOverride");
        assert_eq!(m.reasons[0].code, "userOverride");
        assert!(m.reasons.iter().any(|r| r.kind == ReasonKind::Violation));
        // The engine's verdict stays where it is said: the criterion is still violated and
        // the stored note still names it; the override is a mark of its own, also after a
        // rescore.
        let rate = m.criteria.iter().find(|c| c.code == "minDayRate").unwrap();
        assert_eq!(rate.kind, ReasonKind::Violation, "{:?}", m.criteria);
        let row = store.job(&key).unwrap().unwrap();
        let fresh = matcher.judge(&row, store.description(&key).unwrap().as_deref());
        store
            .save_judgements(&[(key.clone(), fresh.unwrap())], "r9", now)
            .unwrap();
        let stored = store.job(&key).unwrap().unwrap();
        let record = stored.match_.as_ref().unwrap();
        assert_eq!(
            (record.status, record.note.as_ref().unwrap().code.as_str()),
            (MatchStatus::Scored, "dayRate")
        );
        let shown = JobView::from(&stored).match_.unwrap();
        assert_eq!(shown.status, MatchStatus::Scored);
        assert_eq!(shown.note.unwrap().code, "userOverride");
        assert!(store.set_override(&key, false).unwrap());
        let back = job_detail(&store, &key, Some(&matcher), true, now)
            .unwrap()
            .unwrap();
        assert!(!back.job.overridden);
        assert_eq!(back.match_.unwrap().status, MatchStatus::Excluded);
        let stored = store.job(&key).unwrap().unwrap().match_.unwrap();
        assert_eq!(stored.status, MatchStatus::Excluded);
    }

    /// Reasons, highlights and the criteria strip reference each other consistently.
    #[test]
    fn the_explanation_is_bounded_and_linked() {
        let matcher = crate::pipeline::demo::matcher();
        let many = (0..60).fold(String::new(), |mut all, i| {
            all.push_str("- Kenntnisse in Spezialthema Nummer");
            all.push_str(&i.to_string());
            all.push('\n');
            all
        });
        let text = format!("{AD}\n\nAnforderungen:\n{many}");
        let (store, key) = job_with_text(&text);
        let detail = job_detail(&store, &key, Some(&matcher), true, Timestamp::now())
            .unwrap()
            .unwrap();
        let m = detail.match_.unwrap();
        assert_eq!(m.reasons.len(), MAX_REASONS);
        assert!(m.highlights.len() <= MAX_HIGHLIGHTS);
        assert!(m.reasons.iter().any(|r| r.kind == ReasonKind::Violation));
        let ids: BTreeSet<&str> = m.reasons.iter().map(|r| r.id.as_str()).collect();
        assert!(m.highlights.iter().all(|h| ids.contains(h.reason.as_str())));
        let text16: Vec<u16> = text.encode_utf16().collect();
        for h in &m.highlights {
            assert!(h.start < h.end && h.end as usize <= text16.len(), "{h:?}");
        }
        let quoted = m
            .reasons
            .iter()
            .find(|r| r.label == "Erfahrung im Controlling");
        let quoted = quoted.expect("a met requirement");
        assert_eq!(quoted.kind, ReasonKind::Met);
        assert_eq!(quoted.evidence.as_ref().unwrap().via, "exact");
        let range = quoted.ranges[0];
        let passage = String::from_utf16(&text16[range.start as usize..range.end as usize]);
        assert!(passage.unwrap().contains("Controlling"));
        // The strip: every criterion the sample profile sets, the day rate violated and
        // linked to its reason.
        let codes: Vec<&str> = m.criteria.iter().map(|c| c.code.as_str()).collect();
        assert_eq!(codes, ["minDayRate", "countries", "noAnue", "availability"]);
        let rate = &m.criteria[0];
        assert_eq!(
            (rate.kind, rate.weight),
            (ReasonKind::Violation, ReasonWeight::Hard)
        );
        let linked = rate.params["reason"].as_str().unwrap();
        assert!(ids.contains(linked) && !rate.ranges.is_empty(), "{rate:?}");
        assert_eq!(m.criteria[1].kind, ReasonKind::Met);
        assert_eq!(m.criteria[1].params["countries"], "DE, AT, CH");
        // Met with the ad's value as evidence; the start is not mentioned (open).
        assert_eq!(m.criteria[1].params["location"], "Hamburg");
        assert_eq!(m.criteria[2].params["contract"], "interim");
        assert_eq!(m.criteria[3].kind, ReasonKind::Open);
        let summary = m.summary.unwrap();
        assert_eq!(summary.params["evidence"], "full");
        assert!(serde_json::to_vec(&m.reasons).unwrap().len() < 64 * 1024);
    }

    /// "What the app understood": quality, competences, sources, criteria and warnings as
    /// codes; the pending count follows the stored revisions.
    #[test]
    fn the_profile_summary_reaches_the_interface() {
        let matcher = crate::pipeline::demo::matcher();
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
        let criteria: Vec<(&str, bool)> = understood
            .criteria
            .iter()
            .map(|c| (c.code.as_str(), c.params["set"] == true))
            .collect();
        assert_eq!(
            criteria,
            [
                ("minDayRate", true),
                ("countries", true),
                ("noAnue", true),
                ("noPermanent", false),
                ("availability", true),
                ("minSalary", false),
                ("permanentRegion", false),
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
        let thin = LocalMatcher::from_json(&serde_json::json!({"keywords": ["SAP FI"]}));
        let info = ProfileInfo::of(&file, None)
            .understood_by(&thin, &store)
            .unwrap();
        assert_eq!(info.quality, Some(ProfileQuality::Thin));
        let warnings = info.understood.unwrap().warnings;
        let codes: Vec<&str> = warnings.iter().map(|w| w.code.as_str()).collect();
        assert_eq!(codes, ["fewCompetences", "noCriteria"]);
        let empty = LocalMatcher::from_json(&serde_json::json!({}));
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
            aliases: vec!["power bi".into()],
            origin: None,
        });
        form.keywords.push("Kanban".into());
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
    /// experience" one industry; each comes with its field, and what the profile names in any
    /// field (a synonym of it too) is none of them.
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
            level: None,
            origin: None,
        });
        form.competences.push(ProfileCompetence {
            name: "Planung".into(),
            years: None,
            aliases: vec!["Jedox".into()],
            origin: None,
        });
        assert_eq!(
            asked(Some(&form)),
            list(&[("SAP Analytics Cloud", TermField::Tool, 2)])
        );
    }

    /// The reader's reasons name the term and field of an open requirement the profile could
    /// take; a met one names none.
    #[test]
    fn the_reader_names_the_term_of_an_open_requirement() {
        let text = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Kenntnisse in Anaplan
- Branchenerfahrung Energie";
        let matcher = crate::pipeline::demo::matcher();
        let (store, key) = job_with_text(text);
        let detail = job_detail(&store, &key, Some(&matcher), false, Timestamp::now())
            .unwrap()
            .unwrap()
            .match_
            .unwrap();
        let named = |label: &str| {
            let reason = detail
                .reasons
                .iter()
                .find(|r| r.label == label)
                .unwrap_or_else(|| panic!("{label}: {:?}", detail.reasons));
            (
                reason.params.get("term").cloned(),
                reason.params.get("field").cloned(),
            )
        };
        assert_eq!(
            named("Kenntnisse in Anaplan"),
            (Some("Anaplan".into()), Some("tool".into()))
        );
        assert_eq!(
            named("Branchenerfahrung Energie"),
            (Some("Energie".into()), Some("industry".into()))
        );
        assert_eq!(named("Erfahrung im Controlling"), (None, None));
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
