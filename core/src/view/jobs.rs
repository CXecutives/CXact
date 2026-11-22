//! The job list: rows, the query that narrows and orders them, the counts and the page the
//! interface shows, and the state of a job's details.

use std::sync::LazyLock;

use jiff::Timestamp;
use regex::Regex;
use serde::{Deserialize, Serialize};

use crate::fetch::{MAX_AGE, RETRY_AFTER};
use crate::model::{
    AppNote, Band, DescStatus, KeyFacts, MatchRecord, MatchStatus, Notice, Place, band, gmail_url,
    is_usable_title,
};
use crate::portal::{JobKey, Portal};
use crate::store::{JobRow, ListFilter, PageQuery, Store};
use crate::text::split_company_location;

/// Most jobs one page of the list carries.
pub const MAX_PAGE: u32 = 500;

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
    /// At most two open must requirements, quoted from the ad.
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
    /// Its alert mail can be opened ("Alert-Mail öffnen"): in Gmail by `JobMail.gmailUrl` in
    /// the reader, else in the app (`alert_mail`).
    pub has_mail: bool,
    /// How the job came (the filter "Herkunft"): an alert mail named it, the search found it,
    /// or both.
    pub origins: Vec<Origin>,
}

impl From<&JobRow> for JobView {
    fn from(job: &JobRow) -> JobView {
        JobView::at(job, Timestamp::now())
    }
}

impl JobView {
    /// The list row of a job at `now` (the clock its detail state is judged by; the preview's
    /// demo has a fixed one).
    pub fn at(job: &JobRow, now: Timestamp) -> JobView {
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
            detail: DetailState::at(job, now),
            short: job.desc_status == DescStatus::Ok && job.desc_short,
            closed: job.desc_status == DescStatus::Ok && job.desc_closed,
            match_: job.match_.as_ref().map(|record| {
                let mut shown = JobMatch::of(record, &job.match_open);
                if job.override_include {
                    shown.status = MatchStatus::Scored;
                    shown.note = Some(Notice::bare(AppNote::UserOverride));
                }
                shown
            }),
            also_on: Vec::new(),
            place: job.place(),
            trashed_at: job.trashed_at,
            overridden: job.override_include,
            has_mail: job.gmail_id.and_then(gmail_url).is_some() || job.mail_key.is_some(),
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
/// stored before the parser dropped it), nor are its codes and frame (`text::tidy_title`). The app and the Excel file show this one title.
pub(crate) fn display_title(job: &JobRow) -> String {
    if is_usable_title(&job.title) {
        return crate::text::tidy_title(
            crate::portal::without_archive_mark(&job.title),
            &job.location,
        );
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

/// List rows at `now` with the other portals that announced the same job (`alsoOn`).
pub fn job_views(store: &Store, rows: &[JobRow], now: Timestamp) -> crate::Result<Vec<JobView>> {
    let keys: Vec<&JobKey> = rows.iter().map(|row| &row.key).collect();
    let mut also = store.also_on(&keys)?;
    Ok(rows
        .iter()
        .map(|row| JobView {
            also_on: also.remove(&row.key).unwrap_or_default(),
            ..JobView::at(row, now)
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
    pub portals: Vec<Portal>,
    /// The filter: only jobs scored in these bands (`high`, `mid`, `low`); unscored and
    /// excluded jobs pass only while it is empty.
    pub bands: Vec<Band>,
    /// The filter "Aus dem letzten Abruf" (the "Zeigen" of a fetch's toast): only the new
    /// jobs this run brought, the ones its toast counts (`RunSummary.newJobs`: first seen in
    /// it, not excluded). `null` = every job.
    pub run: Option<i64>,
    /// The filter "Gefunden": only jobs the app first saw at or after this moment (Unix
    /// seconds; the day "Nach Datum" orders by first). The page names the start of today, of the last 7 or of the last 30 days in
    /// the user's time zone. `null` = every job.
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

/// List and counts from one store query, now. A job is in exactly one place.
pub fn job_page(store: &Store, query: &JobQuery) -> crate::Result<JobPage> {
    job_page_at(store, query, Timestamp::now())
}

/// [`job_page`] at `now` (the preview's demo has a fixed clock).
pub fn job_page_at(store: &Store, query: &JobQuery, now: Timestamp) -> crate::Result<JobPage> {
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
        jobs: job_views(store, &rows, now)?,
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::Posting;
    use crate::portal::job_link;
    use crate::store::MailRef;
    use crate::view::test_support::*;
    use crate::view::*;

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

    /// A job's origins say how it came: an alert mail, the search, or both.
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

    /// The filter narrows the list and every count like the search: one portal's jobs, or
    /// only the jobs scored in one band (unscored and excluded ones only without it).
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
        assert_eq!(titles(&all), ["B", "A", "E", "D", "C"]);
        let linkedin = page(Some(Portal::LinkedIn), None);
        assert_eq!(titles(&linkedin), ["B", "A", "D", "C"]);
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
            ["B", "A", "E", "D", "C"]
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
        assert_eq!(titles(&job_page(&store, &q).unwrap()), ["B", "D", "C"]);
        q.received_since = Some(0);
        assert_eq!(job_page(&store, &q).unwrap().jobs.len(), 5);
        let json = r#"{"place":"inbox","sort":"match","search":null,
                       "portals":["freelance","hays"],"bands":["high","low"],"run":7,
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
        let (count, high, _) = store.new_jobs(run).unwrap();
        let all = page(None);
        assert_eq!(
            titles(&all),
            ["E", "G"],
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
    /// "Nach Datum" and "Neu seit" go by the day a job came into CXact, whatever its alert
    /// mail's date; within a day the newest mail first, then by portal.
    #[test]
    fn the_date_is_the_day_a_job_came() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let tz = jiff::tz::TimeZone::system();
        let noon = Timestamp::now()
            .to_zoned(tz.clone())
            .date()
            .at(12, 0, 0, 0)
            .to_zoned(tz)
            .unwrap()
            .timestamp();
        let yesterday = noon - jiff::SignedDuration::from_hours(24);
        // (title, link, came, mail date)
        let jobs = [
            (
                "Gestern",
                "https://www.linkedin.com/jobs/view/4000000101/",
                yesterday,
                Some(noon),
            ),
            (
                "Heute alt",
                "https://www.linkedin.com/jobs/view/4000000102/",
                noon,
                Some(yesterday),
            ),
            (
                "Heute neu",
                "https://www.linkedin.com/jobs/view/4000000103/",
                noon,
                Some(noon),
            ),
            (
                "Gesucht",
                "https://www.freelancermap.de/nproj/3000001.html",
                noon,
                None,
            ),
        ];
        for (title, url, came, date) in jobs {
            let link = job_link(url).unwrap();
            let posting = Posting::new(link.key, link.url, title, "", "");
            let mail = MailRef {
                subject: "x",
                date,
                gmail_id: None,
            };
            store.upsert_posting(run, &posting, mail, came).unwrap();
        }
        let page = job_page(&store, &query(Place::Inbox, JobSort::Newest, 50, 0)).unwrap();
        assert_eq!(
            titles(&page),
            ["Heute neu", "Heute alt", "Gesucht", "Gestern"]
        );
        let mut since = query(Place::Inbox, JobSort::Newest, 50, 0);
        since.received_since = Some(noon.as_second() - 3600);
        assert_eq!(
            titles(&job_page(&store, &since).unwrap()),
            ["Heute neu", "Heute alt", "Gesucht"]
        );
    }

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
        // date, the newest first; a job without a score after the scored ones (its section).
        let by_rate = job_page(&store, &query(Place::Inbox, JobSort::Rate, 50, 0)).unwrap();
        assert_eq!(titles(&by_rate), ["B", "A", "C", "G", "F", "E", "D", "H"]);
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
            let came = now - jiff::SignedDuration::from_hours(i % 60 * 24);
            let mail = MailRef {
                subject: "x",
                date: Some(came),
                gmail_id: None,
            };
            store.upsert_posting(run, &posting, mail, came).unwrap();
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
        // The scored ones, then the unscored one; the read job A and the unread but excluded
        // C stand too.
        let all = page(JobSort::Match, 50, 0);
        assert_eq!(titles(&all), ["B", "A", "D", "C"]);
        assert!(all.jobs[2].unread && all.jobs[2].match_.is_none());
        let newest = page(JobSort::Newest, 50, 0);
        assert_eq!(titles(&newest), ["B", "A", "D", "C"]);
        assert!(!newest.jobs[1].unread);
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
}
