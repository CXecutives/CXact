//! The reader: one job with the explanation of its match (reasons, criteria, highlights), the
//! stored text layout and the alert mail it came from.

use std::collections::BTreeSet;

use jiff::Timestamp;
use serde::Serialize;

use super::jobs::{JobView, job_views};
use super::profile::term_level;
use crate::matching::{self, Assessment, CriterionKey, ReasonCode, Via};
use crate::model::{AppNote, Band, MatchStatus, Notice, band, gmail_url};
use crate::pipeline::{LocalMatcher, Matcher, local};
use crate::portal::JobKey;
use crate::store::{Store, StoredMailRow};

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
    /// The step of the match ladder.
    pub via: Via,
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
    pub code: ReasonCode,
    /// The requirement as the ad words it (data, not prose of the app).
    pub label: String,
    pub evidence: Option<Evidence>,
    /// A reason that decided a hard criterion names it (`criterion`, a `CriterionKey`).
    #[cfg_attr(test, ts(as = "crate::view::ts::Params"))]
    pub params: serde_json::Map<String, serde_json::Value>,
    pub ranges: Vec<TextRange>,
}

/// One hard criterion of the reader's strip: the profile's values, the ad's value and the
/// reason that decided it (`params.reason`, its id).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Criterion {
    /// `c:` and the key.
    pub id: String,
    /// `met` only with the ad's value as evidence, `open` when the ad does not mention it.
    pub kind: ReasonKind,
    pub code: CriterionKey,
    /// The ad's words of the deciding reason (empty without one).
    pub label: String,
    #[cfg_attr(test, ts(as = "crate::view::ts::Params"))]
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
    pub criteria: Vec<Criterion>,
    /// The Passungsgrad line by line (empty for an unscorable job): the points of the lines
    /// add up to `score`.
    pub parts: Vec<matching::Part>,
    /// Every cap that fired, with its reason, the lowest first.
    pub caps: Vec<matching::CapLine>,
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
    /// The mail in Gmail; `null` for a mail of another provider, which opens in the app
    /// (`alert_mail`) when `JobView.hasMail`.
    pub gmail_url: Option<String>,
}

/// A job's alert mail as the app keeps it, to read in the app where no Gmail link opens it
/// (`alert_mail`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct StoredMail {
    pub subject: String,
    /// The sender's name, else the address.
    pub sender: String,
    pub date: Option<Timestamp>,
    /// The mail as running text (its HTML without markup); empty for a mail of Gmail, whose
    /// text the app does not keep.
    pub text: String,
}

impl From<StoredMailRow> for StoredMail {
    fn from(row: StoredMailRow) -> StoredMail {
        StoredMail {
            subject: row.subject,
            sender: row.sender,
            date: row.mail_date,
            text: row.body.unwrap_or_default(),
        }
    }
}

/// The alert mail of the job `key` ("Alert-Mail öffnen" without Gmail); `None` when no
/// mail named it (the search found it).
pub fn alert_mail(store: &Store, key: &JobKey) -> crate::Result<Option<StoredMail>> {
    Ok(store.stored_mail(key)?.map(StoredMail::from))
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
        job: job_views(store, std::slice::from_ref(&job), now)?
            .pop()
            .unwrap_or_else(|| JobView::at(&job, now)),
    }))
}

/// The reader of a job the user marked as fitting anyway: it counts as scored and its summary
/// is `userOverride` (the engine's violations stay listed: the user sees what the engine
/// found).
fn overridden(detail: &mut MatchDetail) {
    detail.status = MatchStatus::Scored;
    detail.summary = Some(Notice::bare(AppNote::UserOverride));
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
            code: r.code,
            label: r.label.clone().unwrap_or_default(),
            evidence: r.evidence.as_ref().map(|e| Evidence {
                profile: e.profile.clone(),
                path: e.path.clone(),
                via: e.via,
                quote: e.quote.clone(),
            }),
            params: local::with_criterion(assessment, r, reason_params(r)),
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
        parts: assessment.parts.clone(),
        caps: assessment.caps.clone(),
    }
}

/// The params of a reason for the reader; an open requirement the profile could take also
/// names its term and field (`term`, `field`: `pipeline::local::open_term`) and a language
/// its level (`level`), what the reader's "+" adds.
fn reason_params(reason: &matching::Reason) -> serde_json::Map<String, serde_json::Value> {
    let mut params = local::ui_params(&reason.params);
    if let Some(core) = local::open_term(reason) {
        let level = term_level(&core, reason.label.as_deref().unwrap_or(&core.term));
        if let Some(level) = level.and_then(|l| serde_json::to_value(l).ok()) {
            params.insert("level".into(), level);
        }
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
) -> Vec<Criterion> {
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
                .map(|info| local::ui_params(&info.params))
                .unwrap_or_default();
            params.extend(local::ui_params(&c.params));
            if let Some(reason) = linked {
                params.extend(local::ui_params(&reason.params));
                params.insert("reason".into(), reason_id(reason.id).into());
            }
            let mut passages = linked.map(ranges).unwrap_or_default();
            if passages.is_empty()
                && let Some((start, end)) = c.range
            {
                passages.push(TextRange { start, end });
            }
            Criterion {
                id: format!("c:{}", local::code_name(&c.key)),
                kind: match c.status {
                    matching::CriterionStatus::Violated => ReasonKind::Violation,
                    matching::CriterionStatus::Check => ReasonKind::Check,
                    matching::CriterionStatus::NotMentioned => ReasonKind::Open,
                    _ => ReasonKind::Met,
                },
                code: c.key,
                label: linked.and_then(|r| r.label.clone()).unwrap_or_default(),
                params,
                ranges: passages,
            }
        })
        .collect()
}

/// The counts behind the score (`n of m must`) and how much text there was.
fn summary_notice(s: &matching::Summary) -> Notice {
    Notice {
        code: AppNote::Summary.into(),
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Posting;
    use crate::portal::Portal;
    use crate::portal::job_link;
    use crate::view::test_support::*;
    use crate::view::*;

    /// A job from a mailbox without Gmail has no Gmail link, yet its alert mail opens in the
    /// app: subject, sender, date and text as the store keeps them.
    #[test]
    fn an_alert_mail_without_gmail_opens_in_the_app() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let link = job_link("https://www.linkedin.com/jobs/view/4123456789/").unwrap();
        let date: Timestamp = "2026-09-03T06:15:00Z".parse().unwrap();
        let alert = crate::model::AlertMail {
            key: "mid:eins@linkedin.com".into(),
            portal: Portal::LinkedIn,
            subject: "Neue Jobs".into(),
            sender: "LinkedIn Job Alerts".into(),
            date: Some(date),
            gmail_id: None,
            text: Some("Senior Controller (m/w/d)\nMusterwerke GmbH".into()),
            postings: vec![Posting::new(
                link.key.clone(),
                link.url,
                "Senior Controller",
                "Musterwerke GmbH",
                "Köln",
            )],
        };
        store.record_alert(run, &alert, Timestamp::now()).unwrap();
        let detail = job_detail(&store, &link.key, None, true, Timestamp::now())
            .unwrap()
            .unwrap();
        assert_eq!(detail.mail.gmail_url, None);
        assert!(detail.job.has_mail);
        let mail = alert_mail(&store, &link.key).unwrap().unwrap();
        assert_eq!(
            serde_json::to_value(&mail).unwrap(),
            serde_json::json!({
                "subject": "Neue Jobs",
                "sender": "LinkedIn Job Alerts",
                "date": "2026-09-03T06:15:00Z",
                "text": "Senior Controller (m/w/d)\nMusterwerke GmbH",
            })
        );
        // A job the search found has no alert mail.
        let found = job_link("https://www.freelancermap.de/nproj/12345.html").unwrap();
        let posting = Posting::new(found.key.clone(), found.url, "Rolle", "", "");
        store
            .record_found(run, &[posting], Timestamp::now())
            .unwrap();
        assert_eq!(alert_mail(&store, &found.key).unwrap(), None);
        let row = store.job(&found.key).unwrap().unwrap();
        assert!(!JobView::from(&row).has_mail);
    }

    /// The reader recomputes the reasons; a stale stored score is replaced only when no run
    /// is active (`save`), and a current one keeps its time.
    #[test]
    fn the_reader_recomputes_and_heals_a_stale_score() {
        let matcher = crate::pipeline::dry_run::matcher();
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
        assert_eq!(stored.note.unwrap().code, ReasonCode::DayRate.into());
        let t2: Timestamp = "2026-09-21T08:00:00Z".parse().unwrap();
        let later = job_detail(&store, &key, Some(&matcher), true, t2)
            .unwrap()
            .unwrap();
        assert_eq!(later.match_.unwrap().at, t1, "current score: stored time");
        // Without a usable profile there is no match to explain.
        let empty = LocalMatcher::from_form(&ProfileForm::default());
        let none = job_detail(&store, &key, Some(&empty), true, t2)
            .unwrap()
            .unwrap();
        assert_eq!(none.match_, None);
    }

    /// "Fits anyway": the excluded job shows as scored with the user's word as its summary
    /// (the engine's findings stay listed); taken back, the engine's verdict is stored again.
    #[test]
    fn an_override_shows_the_users_word_and_can_be_taken_back() {
        let matcher = crate::pipeline::dry_run::matcher();
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
        assert_eq!(m.summary.unwrap().code, AppNote::UserOverride.into());
        assert!(m.reasons.iter().any(|r| r.kind == ReasonKind::Violation));
        // The engine's verdict stays where it is said: the criterion is still violated and
        // the stored note still names it; the override is a mark of its own, also after a
        // rescore.
        let rate = m
            .criteria
            .iter()
            .find(|c| c.code == CriterionKey::MinDayRate)
            .unwrap();
        assert_eq!(rate.kind, ReasonKind::Violation, "{:?}", m.criteria);
        let row = store.job(&key).unwrap().unwrap();
        let fresh = matcher.judge(&row, store.description(&key).unwrap().as_deref());
        store
            .save_judgements(&[(key.clone(), fresh.unwrap())], "r9", now)
            .unwrap();
        let stored = store.job(&key).unwrap().unwrap();
        let record = stored.match_.as_ref().unwrap();
        assert_eq!(
            (record.status, record.note.as_ref().unwrap().code),
            (MatchStatus::Scored, ReasonCode::DayRate.into())
        );
        let shown = JobView::from(&stored).match_.unwrap();
        assert_eq!(shown.status, MatchStatus::Scored);
        assert_eq!(shown.note.unwrap().code, AppNote::UserOverride.into());
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
        let matcher = crate::pipeline::dry_run::matcher();
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
        assert_eq!(quoted.evidence.as_ref().unwrap().via, Via::Exact);
        let range = quoted.ranges[0];
        let passage = String::from_utf16(&text16[range.start as usize..range.end as usize]);
        assert!(passage.unwrap().contains("Controlling"));
        // The strip: every criterion the sample profile sets, the day rate violated and
        // linked to its reason.
        let codes: Vec<String> = m
            .criteria
            .iter()
            .map(|c| local::code_name(&c.code))
            .collect();
        assert_eq!(codes, ["minDayRate", "countries", "noAnue", "availability"]);
        let rate = &m.criteria[0];
        assert_eq!(rate.kind, ReasonKind::Violation);
        let linked = rate.params["reason"].as_str().unwrap();
        assert!(ids.contains(linked) && !rate.ranges.is_empty(), "{rate:?}");
        assert_eq!(m.criteria[1].kind, ReasonKind::Met);
        assert_eq!(
            m.criteria[1].params["countries"],
            serde_json::json!(["DE", "AT", "CH"])
        );
        // Met with the ad's value as evidence; the start is not mentioned (open).
        assert_eq!(m.criteria[1].params["location"], "Hamburg");
        assert_eq!(m.criteria[2].params["contract"], "interim");
        assert_eq!(m.criteria[3].kind, ReasonKind::Open);
        let summary = m.summary.unwrap();
        assert_eq!(summary.params["evidence"], "full");
        assert!(serde_json::to_vec(&m.reasons).unwrap().len() < 64 * 1024);
    }

    /// The reader's reasons name the term and field of an open requirement the profile could
    /// take (a language its level); a met one names none.
    #[test]
    fn the_reader_names_the_term_of_an_open_requirement() {
        let text = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Kenntnisse in Anaplan
- Branchenerfahrung Energie
- Verhandlungssichere Spanischkenntnisse";
        let matcher = crate::pipeline::dry_run::matcher();
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
        // An industry the profile lacks is met in part (the rubric's rule 5): it names none.
        assert_eq!(named("Branchenerfahrung Energie"), (None, None));
        assert_eq!(named("Erfahrung im Controlling"), (None, None));
        let spanish = detail
            .reasons
            .iter()
            .find(|r| r.label == "Verhandlungssichere Spanischkenntnisse")
            .unwrap();
        assert_eq!(spanish.params.get("level"), Some(&"C1".into()));
    }

    /// The reader's Passungsgrad adds up: for every job of the preview's demo (the snapshot
    /// the real engine computed, `core/tests/ui_demo_snapshot.rs`) the points of the parts are
    /// its score, and an unscorable job has none.
    #[test]
    fn the_parts_add_up_to_the_score_of_every_demo_job() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tools/ui-harness/demo/snapshot.json");
        let snapshot: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let mut checked = 0;
        for group in ["details", "fetched"] {
            for (key, detail) in snapshot[group].as_object().unwrap() {
                let m = &detail["match"];
                if m.is_null() {
                    continue;
                }
                let parts = m["parts"].as_array().unwrap();
                let sum: i64 = parts.iter().map(|p| p["points"].as_i64().unwrap()).sum();
                if m["status"] == "unscorable" {
                    assert!(parts.is_empty(), "{key}: {parts:?}");
                } else {
                    assert_eq!(Some(sum), m["score"].as_i64(), "{key}: {parts:?}");
                    checked += 1;
                }
            }
        }
        assert!(
            checked >= 10,
            "only {checked} scored demo jobs - did the snapshot move?"
        );
    }
}
