//! Jobs, alert mails, job details and text files: the types the rest of the app sees and
//! every query on the `job` and `alert_mail` tables.

use jiff::{SignedDuration, Timestamp};
use rusqlite::types::Value;
use rusqlite::{Connection, OptionalExtension, Row, Transaction, TransactionBehavior, params};
use url::Url;

use super::marks::{INBOX, place_condition};
use super::{Store, bump, kv_get_i64, kv_set};
use crate::error::{Error, Result};
use crate::fetch::policy::MAX_FETCH_ATTEMPTS;
use crate::mail::MAIL_PARSER_VERSION;
use crate::mail::extract::{has_gender_tag, looks_like_job_title};
use crate::model::{
    AlertMail, Band, DescStatus, HIGH_FROM, MAX_FIELD_CHARS, MAX_TITLE_CHARS, MID_FROM,
    MatchRecord, Place, Posting, is_usable_title,
};
use crate::portal::{Facts, JobKey, Portal};
use crate::text::{one_line, page_location, split_company_location, truncate_chars};
use crate::time::{from_db, to_db};
use crate::view::{Origin, WorkMode};

/// Maximum length of a stored failure reason (in characters).
const MAX_ERROR_CHARS: usize = 200;

/// How an entry is classified in the current scan.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Seen {
    /// Seen for the first time.
    New,
    /// Already known from an earlier run.
    KnownBefore,
    /// Already seen in this run (the same job in two alert mails).
    DupInRun,
}

/// A job as the UI and the exports see it (without the full text).
#[derive(Debug, Clone, PartialEq)]
pub struct JobRow {
    pub key: JobKey,
    pub url: Url,
    pub title: String,
    pub company: String,
    pub location: String,
    pub mail_date: Option<Timestamp>,
    pub mail_subject: String,
    pub gmail_id: Option<u64>,
    pub first_seen_at: Timestamp,
    pub first_seen_run: i64,
    pub desc_status: DescStatus,
    pub desc_short: bool,
    pub desc_closed: bool,
    pub desc_len: i64,
    pub desc_fetched_at: Option<Timestamp>,
    pub desc_attempts: i64,
    pub desc_error: Option<String>,
    pub txt_name: Option<String>,
    /// Last fetch attempt (success or failure).
    pub desc_attempted_at: Option<Timestamp>,
    /// `None` = unread.
    pub read_at: Option<Timestamp>,
    /// `None` = not scored yet.
    pub match_: Option<MatchRecord>,
    /// Up to two open must requirements of the match, quoted from the ad (empty for a note
    /// of an earlier version).
    pub match_open: Vec<String>,
    /// Who scored it; `None` = to be scored (again).
    pub match_rev: Option<String>,
    /// The facts the job page stated (unreadable JSON counts as none).
    pub facts: Option<Facts>,
    /// When the job went to the archive (by the user or by age).
    pub archived_at: Option<Timestamp>,
    /// When the job went to the trash (it wins over the archive).
    pub trashed_at: Option<Timestamp>,
    /// The user marked the job as fitting although the engine excludes it.
    pub override_include: bool,
    /// When an alert mail last named the job (`None`: none did).
    pub mailed_at: Option<Timestamp>,
    /// When the app's search last found the job (`None`: it never did).
    pub searched_at: Option<Timestamp>,
}

impl JobRow {
    /// Where the job is: the trash wins over the archive, the rest is the inbox.
    pub fn place(&self) -> Place {
        if self.trashed_at.is_some() {
            Place::Trash
        } else if self.archived_at.is_some() {
            Place::Archive
        } else {
            Place::Inbox
        }
    }
}

/// The list's filter (the funnel menu) beside the search: portals, bands, contract types,
/// one work mode, one origin and the day the jobs came from; and the new jobs of one run
/// (the "Zeigen" of a fetch's toast). Like the search it narrows the list and all its
/// counts.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ListFilter {
    /// Only the new jobs a run brought, as [`Store::new_jobs`] counts them: first seen in
    /// this run, not excluded (`None` = every job).
    pub run: Option<i64>,
    /// Only these portals' jobs (empty = every portal).
    pub portals: Vec<Portal>,
    /// Only jobs scored in these bands (`model::band` of their score); unscored and excluded
    /// jobs pass only while it is empty.
    pub bands: Vec<Band>,
    /// Only jobs of these contract types (the codes of `KeyFacts.contract`); empty = every
    /// job, those without a contract type too.
    pub contracts: Vec<String>,
    /// Only jobs of this work mode as the job details say it: the remote share of the key
    /// facts first (all of it remote, none of it on site, anything between hybrid), the
    /// location's work mode (`view::work_mode`) only where they state none. A job whose mode
    /// is unknown passes none.
    pub work_mode: Option<WorkMode>,
    /// Only jobs an alert mail named, or only those the search found (`None` = every job).
    pub origin: Option<Origin>,
    /// Only jobs that came at or after this moment, in Unix seconds: the alert mail's date,
    /// else the first sighting (`None` = every job).
    pub received_since: Option<i64>,
}

impl ListFilter {
    /// The values [`filter_condition`] binds, in the order of its placeholders.
    pub(super) fn values(&self) -> [Value; FILTER_VALUES] {
        let text = |value: Option<String>| value.map_or(Value::Null, Value::Text);
        // A list as a JSON array, none for an empty one.
        let list = |keys: Vec<&str>| {
            text((!keys.is_empty()).then(|| serde_json::to_string(&keys).unwrap_or_default()))
        };
        [
            list(self.portals.iter().map(|portal| portal.key()).collect()),
            list(self.bands.iter().map(|band| band_key(*band)).collect()),
            list(self.contracts.iter().map(String::as_str).collect()),
            text(self.work_mode.map(|mode| mode_key(mode).to_owned())),
            self.run.map_or(Value::Null, Value::Integer),
            text(self.origin.map(|origin| origin_key(origin).to_owned())),
            self.received_since.map_or(Value::Null, Value::Integer),
        ]
    }
}

/// A band as [`filter_condition`] names it in SQL (constants of the code, never input).
const fn band_key(band: Band) -> &'static str {
    match band {
        Band::High => "high",
        Band::Mid => "mid",
        Band::Low => "low",
    }
}

/// A work mode as [`filter_condition`] names it in SQL (constants of the code, never input).
const fn mode_key(mode: WorkMode) -> &'static str {
    match mode {
        WorkMode::Remote => "remote",
        WorkMode::Hybrid => "hybrid",
        WorkMode::Onsite => "onsite",
    }
}

/// An origin as [`filter_condition`] names it in SQL (constants of the code, never input).
const fn origin_key(origin: Origin) -> &'static str {
    match origin {
        Origin::Mail => "mail",
        Origin::Search => "search",
    }
}

/// The contract types of employment: they pay a salary, not a day rate (like the list row).
const EMPLOYMENT: &str = "('permanent', 'anue')";

/// A key fact of the match note (`p`: the prefix of its column).
fn fact(p: &str, name: &str) -> String {
    format!("json_extract({p}match_note, '$.facts.{name}')")
}

/// SQL for the day rate the ad states in euros, as the list row and the Excel file read it:
/// an hourly rate times 8; `NULL` for employment (it pays a salary), for a rate in another
/// currency and without one (`p`: the prefix of the columns).
fn day_rate(p: &str) -> String {
    format!(
        "(CASE WHEN COALESCE({contract}, '') IN {EMPLOYMENT}
                    OR COALESCE({currency}, 'EUR') <> 'EUR' THEN NULL
               ELSE {rate} * (CASE WHEN {hourly} THEN 8 ELSE 1 END) END)",
        contract = fact(p, "contract"),
        currency = fact(p, "currency"),
        rate = fact(p, "rate"),
        hourly = fact(p, "hourly"),
    )
}

/// The order of a page of the list (`p`: the prefix of its columns). Excluded jobs always
/// come last; "match" puts every job whose ring shows no number first (not scored yet and
/// not scorable, newest first: the list's "Noch ohne Passung" on top, so every page it loads
/// is complete), then the best score first, the excluded ones newest first;
/// "rate" the highest day rate first ([`day_rate`]), the jobs without one last; "newest" the
/// latest first sighting. The trash lists the latest trashed first.
fn page_order(query: &PageQuery, p: &str) -> String {
    // "By date": the date of the alert mail; in the trash the day it went there.
    let date = if query.place == Place::Trash {
        format!("{p}trashed_at")
    } else {
        format!("COALESCE({p}mail_date, {p}first_seen_at)")
    };
    let (pending, by_match) = if query.by_match {
        // Only a scored job's ring shows its number: the ones without (not scored yet, not
        // scorable) stand together on top, the excluded ones (their ring shows the ban) by
        // date like those. Equal scores follow the score before the caps (`rank` in the note).
        let scored = format!("{p}match_status IS 'scored'");
        (
            format!("({scored}), "),
            format!(
                "(CASE WHEN {scored} THEN {p}match_score END) DESC, \
                 (CASE WHEN {scored} THEN json_extract({p}match_note, '$.rank') END) DESC, "
            ),
        )
    } else if query.by_rate {
        let rate = day_rate(p);
        (String::new(), format!("({rate} IS NULL), {rate} DESC, "))
    } else {
        (String::new(), String::new())
    };
    // A closed ad (no applications any more) follows the open ones.
    format!(
        "({p}match_status IS 'excluded'), {pending}\
         ({p}desc_status = 'ok' AND {p}desc_closed = 1), {by_match}{date} DESC, \
         {p}portal, {p}job_id"
    )
}

/// How many values [`filter_condition`] binds ([`ListFilter::values`]).
pub(super) const FILTER_VALUES: usize = 7;

/// The condition of a [`ListFilter`] on the `job` table, its values bound from placeholder
/// `?{first}` on in the order of [`ListFilter::values`]: JSON arrays of portal keys, of
/// bands and of contract types, the work mode, the run, the origin and the first second of
/// the days it came from (each `NULL` for none). The band of a score as `model::band` draws
/// it; contract type and remote share come from the key facts in the match note, the work
/// mode without a share from the location; the origin from the times an alert mail named
/// the job (`mailed_at`) and the search found it (`searched_at`); the day it came as "Nach
/// Datum" orders the jobs (the alert mail's date, else the first sighting).
pub(super) fn filter_condition(first: usize) -> String {
    let [portals, bands, contracts, mode, run, origin, since] =
        std::array::from_fn::<String, FILTER_VALUES, _>(|i| format!("?{}", first + i));
    format!(
        "({portals} IS NULL OR portal IN (SELECT value FROM json_each({portals})))
         AND ({bands} IS NULL OR (match_status = 'scored'
                                  AND (CASE WHEN match_score >= {HIGH_FROM} THEN 'high'
                                            WHEN match_score >= {MID_FROM} THEN 'mid'
                                            ELSE 'low' END)
                                      IN (SELECT value FROM json_each({bands}))))
         AND ({contracts} IS NULL OR {contract}
                                     IN (SELECT value FROM json_each({contracts})))
         AND ({mode} IS NULL OR COALESCE({job_mode} = {mode}, 0))
         AND ({run} IS NULL OR (first_seen_run = {run}
                                AND match_status IS NOT 'excluded'))
         AND ({origin} IS NULL OR ({origin} = 'mail' AND mailed_at IS NOT NULL)
                               OR ({origin} = 'search' AND searched_at IS NOT NULL))
         AND ({since} IS NULL OR COALESCE(mail_date, first_seen_at) >= {since})",
        contract = fact("", "contract"),
        job_mode = job_mode(),
    )
}

/// SQL for the work mode of a job as the job details say it (`remote`, `hybrid`, `onsite`,
/// `NULL` for unknown): the remote share the ad states first - all of it remote, none of it
/// on site, anything between hybrid - else the location's, like `view::work_mode`: a hybrid
/// word, or a remote and an on-site word together, hybrid; else a remote word remote, an
/// on-site word on site. Each word whole, in any case.
fn job_mode() -> String {
    use crate::view::{HYBRID_WORDS, ONSITE_WORDS, REMOTE_WORDS};
    // A word between two characters that are no word characters (the location padded with
    // spaces, so its start and end count too). The words are constants of the code.
    let any = |words: &[&str]| {
        let each: Vec<String> = words
            .iter()
            .map(|word| {
                format!("(' ' || lower(location) || ' ') GLOB '*[^a-z0-9_]{word}[^a-z0-9_]*'")
            })
            .collect();
        format!("({})", each.join(" OR "))
    };
    let (remote, hybrid, onsite) = (any(&REMOTE_WORDS), any(&HYBRID_WORDS), any(&ONSITE_WORDS));
    // The share from and to (one of them stands for both where the ad states only one).
    let from = format!(
        "COALESCE({}, {})",
        fact("", "remoteFrom"),
        fact("", "remoteTo")
    );
    let to = format!(
        "COALESCE({}, {})",
        fact("", "remoteTo"),
        fact("", "remoteFrom")
    );
    format!(
        "(CASE WHEN {from} IS NOT NULL THEN
                   CASE WHEN {from} >= 100 THEN '{r}' WHEN {to} <= 0 THEN '{o}' ELSE '{h}' END
               WHEN {hybrid} OR ({remote} AND {onsite}) THEN '{h}'
               WHEN {remote} THEN '{r}'
               WHEN {onsite} THEN '{o}' END)",
        r = mode_key(WorkMode::Remote),
        h = mode_key(WorkMode::Hybrid),
        o = mode_key(WorkMode::Onsite),
    )
}

/// One page of the job list: the jobs of one place, optionally only the new ones. The
/// counts cover the search and the filter (the new ones too), whatever the place.
#[derive(Debug, Clone, Default)]
pub struct PageQuery {
    pub place: Place,
    /// Only new jobs ([`NEW`]: unread and not excluded): like the filter it narrows the list
    /// and the counts.
    pub unread: bool,
    /// The jobs without a score first, then the best match; otherwise by date: the alert
    /// mail's, in the trash the day it went there; excluded jobs last either way.
    pub by_match: bool,
    /// The highest day rate first, the jobs without one last (instead of `by_match`).
    pub by_rate: bool,
    /// Search: every word in the portal's name, title, company, location or full text
    /// (case-insensitive, in any order).
    pub search: Option<String>,
    /// The portal and band filter.
    pub filter: ListFilter,
    pub limit: u32,
    pub offset: u32,
}

/// A new job, in any place: not opened yet and not excluded (the filter "Nur neue" and the
/// row's dot mean the same, like a mail app's unread mark).
const NEW: &str = "(read_at IS NULL AND match_status IS NOT 'excluded')";

/// Column of the first column of the page in the statement of [`Store::job_page`] (the
/// counts come before it).
const PAGE_AT: usize = 6;

/// Counts that belong to a page of the job list: per place, and the excluded ones of each.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct PageCounts {
    /// In the inbox.
    pub inbox: u32,
    pub archive: u32,
    pub trash: u32,
    /// Excluded, in the inbox.
    pub excluded: u32,
    /// Excluded, in the archive.
    pub excluded_archive: u32,
    /// Excluded, in the trash.
    pub excluded_trash: u32,
}

/// An alert mail without recognised entries.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AlertMailRow {
    pub portal: Portal,
    pub subject: String,
    pub mail_date: Option<Timestamp>,
    pub gmail_id: Option<u64>,
}

/// Selection for the list and the export.
#[derive(Debug, Clone, Default)]
pub struct JobFilter {
    /// Only jobs seen for the first time in this run.
    pub first_seen_run: Option<i64>,
    /// Search term in title, company, location and full text (case-insensitive).
    pub search: Option<String>,
    /// Only the inbox, without another portal's duplicates (the Excel overview shows what
    /// the app lists as active).
    pub listed: bool,
}

/// Mail details a job takes over when it is first seen.
#[derive(Debug, Clone, Copy)]
pub struct MailRef<'a> {
    pub subject: &'a str,
    pub date: Option<Timestamp>,
    pub gmail_id: Option<u64>,
}

impl<'a> From<&'a AlertMail> for MailRef<'a> {
    fn from(mail: &'a AlertMail) -> Self {
        MailRef {
            subject: &mail.subject,
            date: mail.date,
            gmail_id: mail.gmail_id,
        }
    }
}

impl Store {
    // ------------------------------------------------------------------ Intake

    /// Records one entry from an alert mail (merge rule: [`upsert`]) - tests only; the app
    /// records whole alert mails ([`Store::record_alert`]).
    #[cfg(test)]
    pub(crate) fn upsert_posting(
        &self,
        run: i64,
        posting: &Posting,
        mail: MailRef<'_>,
        now: Timestamp,
    ) -> Result<Seen> {
        self.write(|conn| {
            let seen = upsert(conn, run, posting, mail, now)?;
            came(conn, &posting.key, Origin::Mail, now)?;
            Ok(seen)
        })
    }

    /// Records a recognised alert mail with its entries - as one change. A mail without
    /// entries is remembered too (layout guard). Returns the classification of each entry.
    pub fn record_alert(&self, run: i64, alert: &AlertMail, now: Timestamp) -> Result<Vec<Seen>> {
        self.write(|conn| {
            conn.execute(
                "INSERT INTO alert_mail (mail_key, portal, subject, mail_date, gmail_id,
                                         n_postings, last_seen_run)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
                 ON CONFLICT (mail_key) DO UPDATE SET
                    n_postings = excluded.n_postings, last_seen_run = excluded.last_seen_run",
                params![
                    alert.key,
                    alert.portal.key(),
                    alert.subject,
                    alert.date.map(to_db),
                    alert.gmail_id.map(|id| id.to_string()),
                    i64::try_from(alert.postings.len()).unwrap_or(i64::MAX),
                    run,
                ],
            )?;
            alert
                .postings
                .iter()
                .map(|posting| {
                    let seen = upsert(conn, run, posting, MailRef::from(alert), now)?;
                    came(conn, &posting.key, Origin::Mail, now)?;
                    Ok(seen)
                })
                .collect()
        })
    }

    /// The sources at least one job came from, in the order of `Portal::ALL`.
    pub fn sources(&self) -> Result<Vec<Portal>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached("SELECT DISTINCT portal FROM job")?;
        let keys = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<std::result::Result<Vec<_>, _>>()?;
        Ok(Portal::ALL
            .into_iter()
            .filter(|portal| keys.iter().any(|key| key == portal.key()))
            .collect())
    }

    /// Jobs the app's own search found (user decision 2026-10-01): rows like an alert mail's,
    /// without a mail (no subject, date or Gmail link). A known job is only seen again, a job
    /// deleted for good stays deleted.
    pub fn record_found(
        &self,
        run: i64,
        postings: &[Posting],
        now: Timestamp,
    ) -> Result<Vec<Seen>> {
        let none = MailRef {
            subject: "",
            date: None,
            gmail_id: None,
        };
        self.write(|conn| {
            postings
                .iter()
                .map(|posting| {
                    let seen = upsert(conn, run, posting, none, now)?;
                    came(conn, &posting.key, Origin::Search, now)?;
                    Ok(seen)
                })
                .collect()
        })
    }

    /// Alert mails of a run without a single recognised entry (layout guard: grey rows with
    /// a Gmail link).
    pub fn zero_posting_mails(&self, run: i64) -> Result<Vec<AlertMailRow>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT portal, subject, mail_date, gmail_id FROM alert_mail
             WHERE last_seen_run = ?1 AND n_postings = 0 ORDER BY mail_date DESC",
        )?;
        let rows = stmt.query_map([run], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, Option<i64>>(2)?,
                r.get::<_, Option<String>>(3)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, subject, date, gmail_id) = row?;
            let portal = Portal::from_key(&portal)
                .ok_or_else(|| Error::Corrupt(format!("unknown portal `{portal}`")))?;
            out.push(AlertMailRow {
                portal,
                subject,
                mail_date: date.and_then(from_db),
                gmail_id: gmail_id.and_then(|id| id.parse().ok()),
            });
        }
        Ok(out)
    }

    // ------------------------------------------------------------------ Queries

    pub fn job(&self, key: &JobKey) -> Result<Option<JobRow>> {
        let conn = self.conn();
        let row = conn
            .query_row(
                &format!("SELECT {JOB_COLUMNS} FROM job WHERE portal = ?1 AND job_id = ?2"),
                params![key.portal.key(), key.id],
                job_row,
            )
            .optional()?;
        row.transpose()
    }

    /// Text of a job: the full text (status `ok`) or the teaser a guest sees (`teaser`).
    pub fn description(&self, key: &JobKey) -> Result<Option<String>> {
        Ok(self
            .conn()
            .query_row(
                "SELECT desc_text FROM job WHERE portal = ?1 AND job_id = ?2
                 AND desc_status IN ('ok', 'teaser')",
                params![key.portal.key(), key.id],
                |r| r.get(0),
            )
            .optional()?
            .flatten())
    }

    /// Jobs, newest first (first sighting, then mail date).
    pub fn jobs(&self, filter: &JobFilter) -> Result<Vec<JobRow>> {
        let conn = self.conn();
        let words = search_words(filter.search.as_deref());
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {JOB_COLUMNS} FROM job
             WHERE (?1 IS NULL OR first_seen_run = ?1)
               AND {}
               AND (NOT ?3 OR ({INBOX} AND dup_of IS NULL))
             ORDER BY first_seen_at DESC, mail_date DESC, portal, job_id",
            matches_words("?2")
        ))?;
        let rows = stmt.query_map(
            params![filter.first_seen_run, words, filter.listed],
            job_row,
        )?;
        rows.map(|r| r?).collect()
    }

    /// One page of the job list and its counts - from one statement, so list and counts
    /// never disagree.
    pub fn job_page(&self, query: &PageQuery) -> Result<(Vec<JobRow>, PageCounts)> {
        let conn = self.conn();
        let words = search_words(query.search.as_deref());
        let order = |p: &str| page_order(query, p);
        // The counts of each place, narrowed by the search and the filter ("Nur neue" too).
        // The excluded jobs are counted per place, so the list's section says its number
        // before every page is there.
        let facet = place_condition(query.place);
        let sql = format!(
            "WITH base AS (
                 SELECT * FROM job WHERE dup_of IS NULL AND {words} AND {filter}
                                     AND (NOT ?4 OR {NEW})
             ), counts AS (
                 SELECT COALESCE(SUM({INBOX}), 0) AS n_inbox,
                        COALESCE(SUM({INBOX} AND match_status IS 'excluded'), 0) AS n_excluded,
                        COALESCE(SUM({archive}), 0) AS n_archive,
                        COALESCE(SUM({trash}), 0) AS n_trash,
                        COALESCE(SUM({archive} AND match_status IS 'excluded'), 0)
                            AS n_excluded_archive,
                        COALESCE(SUM({trash} AND match_status IS 'excluded'), 0)
                            AS n_excluded_trash
                 FROM base
             ), page AS (
                 SELECT {JOB_COLUMNS} FROM base
                 WHERE {facet}
                 ORDER BY {}
                 LIMIT ?2 OFFSET ?3
             )
             SELECT counts.n_inbox, counts.n_excluded, counts.n_archive, counts.n_trash,
                    counts.n_excluded_archive, counts.n_excluded_trash, page.*
             FROM counts LEFT JOIN page
             ORDER BY {}",
            order(""),
            order("page."),
            words = matches_words("?1"),
            filter = filter_condition(5),
            archive = place_condition(Place::Archive),
            trash = place_condition(Place::Trash),
        );
        let mut stmt = conn.prepare_cached(&sql)?;
        let mut counts = PageCounts::default();
        let mut jobs = Vec::new();
        let values = [
            words.map_or(Value::Null, Value::Text),
            Value::Integer(i64::from(query.limit)),
            Value::Integer(i64::from(query.offset)),
            Value::Integer(i64::from(query.unread)),
        ]
        .into_iter()
        .chain(query.filter.values());
        let mut rows = stmt.query(rusqlite::params_from_iter(values))?;
        while let Some(row) = rows.next()? {
            counts = PageCounts {
                inbox: row.get(0)?,
                excluded: row.get(1)?,
                archive: row.get(2)?,
                trash: row.get(3)?,
                excluded_archive: row.get(4)?,
                excluded_trash: row.get(5)?,
            };
            if row.get::<_, Option<String>>(PAGE_AT)?.is_some() {
                jobs.push(job_row_at(row, PAGE_AT)??);
            }
        }
        Ok((jobs, counts))
    }

    /// Per portal: jobs first seen in this run and jobs known before that appeared again.
    pub fn scan_counts(&self, run: i64) -> Result<Vec<(Portal, usize, usize)>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT portal, SUM(first_seen_run = ?1), SUM(first_seen_run < ?1)
             FROM job WHERE last_seen_run = ?1 GROUP BY portal",
        )?;
        let rows = stmt.query_map([run], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, i64>(1)?,
                r.get::<_, i64>(2)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (portal, new, known) = row?;
            let portal = Portal::from_key(&portal)
                .ok_or_else(|| Error::Corrupt(format!("unknown portal `{portal}`")))?;
            out.push((
                portal,
                usize::try_from(new).unwrap_or(0),
                usize::try_from(known).unwrap_or(0),
            ));
        }
        Ok(out)
    }

    /// The oldest mail date (else first sighting) of a job of `portal` an older mail parser
    /// read, or `None` when every job of it is current.
    pub fn stale_mail_since(&self, portal: Portal) -> Result<Option<Timestamp>> {
        let oldest: Option<i64> = self.conn().query_row(
            "SELECT MIN(COALESCE(mail_date, first_seen_at)) FROM job
             WHERE portal = ?2 AND (mail_version IS NULL OR mail_version < ?1)",
            params![MAIL_PARSER_VERSION, portal.key()],
            |r| r.get(0),
        )?;
        Ok(oldest.and_then(from_db))
    }

    /// Test helper: the job reads as if an older mail parser had read it.
    #[cfg(test)]
    pub(crate) fn make_mail_stale(&self, key: &JobKey) {
        self.conn()
            .execute(
                "UPDATE job SET mail_version = NULL WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
            )
            .unwrap();
    }

    /// Number of all jobs.
    pub fn job_count(&self) -> Result<i64> {
        Ok(self
            .conn()
            .query_row("SELECT COUNT(*) FROM job", [], |r| r.get(0))?)
    }

    /// Number of the jobs the Excel sheet lists (see [`JobFilter::listed`]): the inbox,
    /// without another portal's duplicates.
    pub fn listed_count(&self) -> Result<i64> {
        Ok(self.conn().query_row(
            &format!("SELECT COUNT(*) FROM job WHERE {INBOX} AND dup_of IS NULL"),
            [],
            |r| r.get(0),
        )?)
    }

    // ------------------------------------------------------------------ Job details

    /// Jobs whose full text should be fetched automatically: open or failed (at the earliest
    /// `retry_after` after the last attempt), mail at most `max_age` old, and only what the
    /// lists show as active ([`FETCHABLE`]). Order: open ones before retries, then newest mail
    /// first.
    pub fn fetch_queue(
        &self,
        now: Timestamp,
        max_age: SignedDuration,
        retry_after: SignedDuration,
    ) -> Result<Vec<JobRow>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(&format!(
            "SELECT {JOB_COLUMNS} FROM job WHERE {FETCHABLE} AND {DUE}
             ORDER BY desc_status = 'failed', COALESCE(mail_date, first_seen_at) DESC, portal, job_id"
        ))?;
        let rows = stmt.query_map(due_params(now, max_age, retry_after), job_row)?;
        rows.map(|r| r?).collect()
    }

    /// Full text stored (also short, checked texts and closed ads).
    pub fn record_text(
        &self,
        key: &JobKey,
        text: &str,
        short: bool,
        closed: bool,
        now: Timestamp,
    ) -> Result<()> {
        self.write(|conn| {
            conn.execute(
                "UPDATE job SET desc_status = 'ok', desc_text = ?3, desc_short = ?4, desc_closed = ?5,
                                desc_fetched_at = ?6, desc_attempted_at = ?6, desc_error = NULL,
                                match_rev = NULL
                 WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id, text, short, closed, to_db(now)],
            )?;
            bump(conn)?;
            refresh_search(conn, key)
        })
    }

    /// Only the teaser a guest sees: stored for matching and marked, never as a text file.
    /// A full text is never downgraded. The attempt counter starts again, so that a sign-in
    /// switched on later fetches the full text right away.
    pub fn record_teaser(&self, key: &JobKey, text: &str, now: Timestamp) -> Result<()> {
        self.write(|conn| {
            let changed = conn.execute(
                "UPDATE job SET desc_status = 'teaser', desc_text = ?3, desc_short = 0,
                                desc_closed = 0, desc_fetched_at = ?4, desc_attempted_at = ?4,
                                desc_attempts = 0, desc_error = NULL, match_rev = NULL
                 WHERE portal = ?1 AND job_id = ?2 AND desc_status <> 'ok'",
                params![key.portal.key(), key.id, text, to_db(now)],
            )?;
            if changed > 0 {
                bump(conn)?;
                refresh_search(conn, key)?;
            }
            Ok(())
        })
    }

    /// The ad no longer exists.
    pub fn record_gone(&self, key: &JobKey, now: Timestamp) -> Result<()> {
        self.write(|conn| {
            // A text fetched earlier stays valid - a success is never downgraded.
            let changed = conn.execute(
                "UPDATE job SET desc_status = 'gone', desc_attempted_at = ?3, desc_error = NULL
                 WHERE portal = ?1 AND job_id = ?2 AND desc_status <> 'ok'",
                params![key.portal.key(), key.id, to_db(now)],
            )?;
            if changed > 0 {
                bump(conn)?;
            }
            Ok(())
        })
    }

    /// Page loaded, but no valid text: count the attempt; after `MAX_FETCH_ATTEMPTS` the job
    /// counts as unfetchable. A job with a valid text stays unchanged (returns its status); a
    /// teaser stays a teaser (it is only fetched again with a sign-in, see `DUE`).
    /// The reason often comes from the page (redirect target, script error) - it is stored
    /// as one short line.
    pub fn record_failed(&self, key: &JobKey, error: &str, now: Timestamp) -> Result<DescStatus> {
        self.record_failure(key, error, now, true)
    }

    /// Like [`Store::record_failed`]; `count_attempt: false` records the failure without
    /// costing the job an attempt (a page in a series of suspicious pages - the portal's
    /// fault, not the job's).
    pub fn record_failure(
        &self,
        key: &JobKey,
        error: &str,
        now: Timestamp,
        count_attempt: bool,
    ) -> Result<DescStatus> {
        let error = truncate_chars(&one_line(error), MAX_ERROR_CHARS);
        let status: String = self.write(|conn| {
            let updated: Option<String> = conn
                .query_row(
                    "UPDATE job SET desc_attempts = desc_attempts + ?6, desc_attempted_at = ?3, desc_error = ?4,
                                    desc_status = CASE WHEN desc_status = 'teaser' THEN 'teaser'
                                                       WHEN desc_attempts + ?6 >= ?5 THEN 'unfetchable'
                                                       ELSE 'failed' END
                     WHERE portal = ?1 AND job_id = ?2 AND desc_status <> 'ok'
                     RETURNING desc_status",
                    params![
                        key.portal.key(),
                        key.id,
                        to_db(now),
                        error,
                        MAX_FETCH_ATTEMPTS,
                        i64::from(count_attempt)
                    ],
                    |r| r.get(0),
                )
                .optional()?;
            match updated {
                Some(status) => {
                    bump(conn)?;
                    Ok(status)
                }
                None => Ok(conn.query_row(
                    "SELECT desc_status FROM job WHERE portal = ?1 AND job_id = ?2",
                    params![key.portal.key(), key.id],
                    |r| r.get(0),
                )?),
            }
        })?;
        DescStatus::parse(&status)
            .ok_or_else(|| Error::Corrupt(format!("unknown status `{status}`")))
    }

    /// Structured page details (LinkedIn header, freelancermap data) are more reliable than
    /// the mail heuristics: non-empty values replace the mail values - with the same length
    /// limits as on intake, and the work mode from the mail ("Remote") stays. What the page
    /// leaves empty keeps the mail value, unless that is a job title the mail heuristic took
    /// for company or location (see `merge_details`).
    pub fn record_page_fields(
        &self,
        key: &JobKey,
        title: &str,
        company: &str,
        location: &str,
    ) -> Result<()> {
        let title = truncate_chars(&one_line(title), MAX_TITLE_CHARS);
        let company = truncate_chars(&one_line(company), MAX_FIELD_CHARS);
        let location = one_line(location);
        self.write(|conn| {
            let (stored_company, stored_location): (String, String) = conn
                .query_row(
                    "SELECT company, location FROM job WHERE portal = ?1 AND job_id = ?2",
                    params![key.portal.key(), key.id],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
                .optional()?
                .unwrap_or_default();
            let (stored_company, stored_location) =
                usable_details((&stored_company, &stored_location));
            let company = if company.is_empty() {
                stored_company.to_string()
            } else {
                company
            };
            let location = if location.is_empty() {
                stored_location.to_string()
            } else {
                page_location(stored_location, &location, MAX_FIELD_CHARS)
            };
            // The engine reads title and location: a change to either makes the score
            // pending again (SET expressions see the old row).
            conn.execute(
                "UPDATE job SET
                    match_rev = CASE WHEN (?3 <> '' AND ?3 <> title) OR ?5 <> location
                                     THEN NULL ELSE match_rev END,
                    title    = CASE WHEN ?3 <> '' THEN ?3 ELSE title END,
                    company  = ?4,
                    location = ?5
                 WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id, title, company, location],
            )?;
            bump(conn)?;
            refresh_search(conn, key)
        })
    }

    // ------------------------------------------------------------------ Text files

    /// Test: the text file an earlier version of the app wrote for a job (the app writes
    /// none any more; the names it knows stay for the cleanup).
    #[cfg(test)]
    pub(crate) fn mark_old_txt(&self, key: &JobKey, file_name: &str, now: Timestamp) {
        self.conn()
            .execute(
                "UPDATE job SET txt_name = ?3, txt_written_at = ?4
                 WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id, file_name, to_db(now)],
            )
            .expect("the name is stored");
    }

    /// Names of all text files earlier versions of the app wrote (for deleting jobs for good
    /// and "reset everything"), with the ones of deleted jobs that are still on disk
    /// ([`Store::txt_leftovers`]).
    pub fn txt_names(&self) -> Result<Vec<String>> {
        let mut names: Vec<String> = {
            let conn = self.conn();
            let mut stmt =
                conn.prepare_cached("SELECT txt_name FROM job WHERE txt_name IS NOT NULL")?;
            let names = stmt.query_map([], |r| r.get(0))?;
            names.collect::<rusqlite::Result<_>>()?
        };
        for name in self.txt_leftovers()? {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        Ok(names)
    }

    /// Old text files of jobs deleted for good that could not be removed (open in another
    /// program): their rows are gone, so their names live on here until a later export or a
    /// reset removes them.
    pub fn txt_leftovers(&self) -> Result<Vec<String>> {
        Ok(self
            .kv_get(TXT_LEFTOVERS)?
            .and_then(|json| serde_json::from_str(&json).ok())
            .unwrap_or_default())
    }

    /// Replaces the list of [`Store::txt_leftovers`] (empty: forgets it).
    pub fn set_txt_leftovers(&self, names: &[String]) -> Result<()> {
        if names.is_empty() {
            self.conn()
                .execute("DELETE FROM kv WHERE key = ?1", [TXT_LEFTOVERS])?;
            return Ok(());
        }
        let json = serde_json::to_string(names).expect("names are always serialisable");
        self.kv_set(TXT_LEFTOVERS, &json)
    }
}

/// Key of [`Store::txt_leftovers`].
const TXT_LEFTOVERS: &str = "txt_leftovers";

// ---------------------------------------------------------------------- Helpers

pub(super) const JOB_COLUMNS: &str = "portal, job_id, url, title, company, location, mail_date,
    mail_subject, gmail_id, first_seen_at, first_seen_run, desc_status, desc_short, desc_closed,
    COALESCE(LENGTH(desc_text), 0) AS desc_len, desc_fetched_at, desc_attempts, desc_error,
    txt_name, desc_attempted_at, read_at, match_status, match_score, match_note, match_rev,
    desc_facts, archived_at, trashed_at, override_include, mailed_at, searched_at";
pub(super) const JOB_COLUMN_COUNT: usize = 31;

/// The jobs whose ads the app fetches by itself: the inbox - never the archive, the trash or
/// a duplicate (its original's row stands for it; a merged guest teaser would cost a
/// signed-in request). The portals' caps are small, so every request belongs to a job the
/// user still reads. "Anzeige laden" asks for chosen jobs wherever they lie.
pub(super) const FETCHABLE: &str = "dup_of IS NULL AND archived_at IS NULL AND trashed_at IS NULL";

/// Due for a fetch (of a [`FETCHABLE`] job): open or failed (at the earliest `?2` after the
/// last attempt), or a teaser (right away, after a failed attempt like a failure, at most
/// `MAX_FETCH_ATTEMPTS` = `?3` times) - mail not older than `?1`. Teasers are only fetched
/// on a session path (`fetch::fetch_all`).
const DUE: &str = "COALESCE(mail_date, first_seen_at) >= ?1
    AND (desc_status = 'missing'
         OR (desc_status = 'failed' AND COALESCE(desc_attempted_at, 0) <= ?2)
         OR (desc_status = 'teaser' AND desc_attempts < ?3
             AND (desc_attempts = 0 OR COALESCE(desc_attempted_at, 0) <= ?2)))";

fn due_params(now: Timestamp, max_age: SignedDuration, retry_after: SignedDuration) -> [i64; 3] {
    [
        to_db(now.saturating_sub(max_age).unwrap_or(Timestamp::MIN)),
        to_db(now.saturating_sub(retry_after).unwrap_or(Timestamp::MIN)),
        i64::from(MAX_FETCH_ATTEMPTS),
    ]
}

/// Reads one row; unknown values become `Error::Corrupt` (the inner `Result`).
pub(super) fn job_row(r: &Row<'_>) -> rusqlite::Result<Result<JobRow>> {
    job_row_at(r, 0)
}

/// Reads the job columns starting at column `at`.
fn job_row_at(r: &Row<'_>, at: usize) -> rusqlite::Result<Result<JobRow>> {
    let col = |i: usize| at + i;
    let portal: String = r.get(col(0))?;
    let url: String = r.get(col(2))?;
    let status: String = r.get(col(11))?;
    let gmail_id: Option<String> = r.get(col(8))?;
    let first_seen_at: i64 = r.get(col(9))?;
    let (Some(portal), Ok(url), Some(desc_status), Some(first_seen_at)) = (
        Portal::from_key(&portal),
        Url::parse(&url),
        DescStatus::parse(&status),
        from_db(first_seen_at),
    ) else {
        return Ok(Err(Error::Corrupt(format!(
            "job row {portal}/{url}/{status}"
        ))));
    };
    let (match_, match_open) = match super::matches::decode_match(
        r.get::<_, Option<String>>(col(21))?.as_deref(),
        r.get(col(22))?,
        r.get::<_, Option<String>>(col(23))?.as_deref(),
    ) {
        Some((record, open)) => (Some(record), open),
        None => (None, Vec::new()),
    };
    Ok(Ok(JobRow {
        key: JobKey {
            portal,
            id: r.get(col(1))?,
        },
        url,
        title: r.get(col(3))?,
        company: r.get(col(4))?,
        location: r.get(col(5))?,
        mail_date: r.get::<_, Option<i64>>(col(6))?.and_then(from_db),
        mail_subject: r.get(col(7))?,
        gmail_id: gmail_id.and_then(|s| s.parse().ok()),
        first_seen_at,
        first_seen_run: r.get(col(10))?,
        desc_status,
        desc_short: r.get(col(12))?,
        desc_closed: r.get(col(13))?,
        desc_len: r.get(col(14))?,
        desc_fetched_at: r.get::<_, Option<i64>>(col(15))?.and_then(from_db),
        desc_attempts: r.get(col(16))?,
        desc_error: r.get(col(17))?,
        txt_name: r.get(col(18))?,
        desc_attempted_at: r.get::<_, Option<i64>>(col(19))?.and_then(from_db),
        read_at: r.get::<_, Option<i64>>(col(20))?.and_then(from_db),
        match_,
        match_open,
        match_rev: r.get(col(24))?,
        facts: r
            .get::<_, Option<String>>(col(25))?
            .and_then(|json| serde_json::from_str(&json).ok()),
        archived_at: r.get::<_, Option<i64>>(col(26))?.and_then(from_db),
        trashed_at: r.get::<_, Option<i64>>(col(27))?.and_then(from_db),
        override_include: r.get::<_, Option<i64>>(col(28))?.is_some(),
        mailed_at: r.get::<_, Option<i64>>(col(29))?.and_then(from_db),
        searched_at: r.get::<_, Option<i64>>(col(30))?.and_then(from_db),
    }))
}

/// Records one entry. Merge rule for known jobs: mail details and first sighting stay
/// unchanged; title, company and location are only filled in when they are empty or the
/// placeholder - never replaced just because another value is longer. A job an older mail
/// parser read ([`MAIL_PARSER_VERSION`]) and whose page is not read yet takes the current
/// parser's title and details: that heals what the older one got wrong.
/// The job came again this way (an alert mail named it, the search found it): the time of
/// it, for the filter "Herkunft". A job deleted for good has no row: nothing to mark.
fn came(conn: &Connection, key: &JobKey, origin: Origin, now: Timestamp) -> Result<()> {
    let column = match origin {
        Origin::Mail => "mailed_at",
        Origin::Search => "searched_at",
    };
    conn.execute(
        &format!("UPDATE job SET {column} = ?3 WHERE portal = ?1 AND job_id = ?2"),
        params![key.portal.key(), key.id, to_db(now)],
    )?;
    Ok(())
}

fn upsert(
    conn: &Connection,
    run: i64,
    posting: &Posting,
    mail: MailRef<'_>,
    now: Timestamp,
) -> Result<Seen> {
    let key = &posting.key;
    // A job deleted for good stays deleted: an old alert mail never brings it back.
    let deleted = conn
        .query_row(
            "SELECT 1 FROM tombstone WHERE portal = ?1 AND job_id = ?2",
            params![key.portal.key(), key.id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if deleted {
        return Ok(Seen::KnownBefore);
    }
    let known: Option<(i64, String, String, String, Option<i64>, bool)> = conn
        .query_row(
            "SELECT last_seen_run, title, company, location, mail_version,
                    desc_fetched_at IS NOT NULL
             FROM job WHERE portal = ?1 AND job_id = ?2",
            params![key.portal.key(), key.id],
            |r| {
                Ok((
                    r.get(0)?,
                    r.get(1)?,
                    r.get(2)?,
                    r.get(3)?,
                    r.get(4)?,
                    r.get(5)?,
                ))
            },
        )
        .optional()?;
    let Some((last_run, title, company, location, version, page_read)) = known else {
        conn.execute(
            "INSERT INTO job (portal, job_id, url, title, company, location, mail_date,
                              mail_subject, gmail_id, first_seen_at, first_seen_run,
                              last_seen_run, search, mail_version)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11, ?12, ?13)",
            params![
                key.portal.key(),
                key.id,
                posting.url.as_str(),
                posting.title,
                posting.company,
                posting.location,
                mail.date.map(to_db),
                mail.subject,
                mail.gmail_id.map(|id| id.to_string()),
                to_db(now),
                run,
                mail_search(key, posting),
                MAIL_PARSER_VERSION,
            ],
        )?;
        bump(conn)?;
        return Ok(Seen::New);
    };
    // The last sighting is invisible to export and UI - hence no bump().
    conn.execute(
        "UPDATE job SET last_seen_run = ?3, mail_version = ?4 WHERE portal = ?1 AND job_id = ?2",
        params![key.portal.key(), key.id, run, MAIL_PARSER_VERSION],
    )?;
    // Read by an older mail parser and no page yet: the current parser's reading wins (it
    // heals what an older one got wrong). Otherwise the merge rules below.
    // With the page read, the page's values stand; only a stored pair that reads like a job
    // title (the older parser's mistake) gives way to the current reading.
    let older = version.is_none_or(|v| v < MAIL_PARSER_VERSION);
    let stale = older && !page_read;
    let has_pair = !(posting.company.is_empty() && posting.location.is_empty());
    let wrong_pair = older && (looks_like_job_title(&company) || looks_like_job_title(&location));
    let new_title = if (stale || !is_usable_title(&title)) && posting.has_real_title() {
        posting.title.clone()
    } else {
        title.clone()
    };
    let (new_company, new_location) = if (stale || wrong_pair) && has_pair {
        (posting.company.clone(), posting.location.clone())
    } else {
        merge_details((&company, &location), (&posting.company, &posting.location))
    };
    if new_title != title || new_company != company || new_location != location {
        // The engine reads title and location (the country criterion): a change to either
        // makes the score pending again - the same rule as for page fields.
        conn.execute(
            "UPDATE job SET title = ?3, company = ?4, location = ?5,
                            match_rev = CASE WHEN title <> ?3 OR location <> ?5
                                             THEN NULL ELSE match_rev END
             WHERE portal = ?1 AND job_id = ?2",
            params![
                key.portal.key(),
                key.id,
                new_title,
                new_company,
                new_location
            ],
        )?;
        refresh_search(conn, key)?;
        bump(conn)?;
    }
    Ok(if last_run == run {
        Seen::DupInRun
    } else {
        Seen::KnownBefore
    })
}

/// Company and location are only taken over as a pair - never mixed from two different
/// mails: when there are no details yet, or when the stored "company" was really just a
/// place ("D-20038 Hamburg") and the new mail names a real company. A stored pair that
/// holds a job title (an older mail heuristic read the next entry of a collection mail as
/// this job's company) counts as no details - like an unusable title it gives way, and
/// without new details it is cleared: empty is better than wrong.
fn merge_details(stored: (&str, &str), new: (&str, &str)) -> (String, String) {
    let stored = usable_details(stored);
    let keep = (stored.0.to_string(), stored.1.to_string());
    let take = (new.0.to_string(), new.1.to_string());
    if new.0.is_empty() && new.1.is_empty() {
        return keep;
    }
    if stored.0.is_empty() && stored.1.is_empty() {
        return take;
    }
    let stored_has_company = !split_company_location(stored.0, stored.1).0.is_empty();
    let new_has_company = !split_company_location(new.0, new.1).0.is_empty();
    if !stored_has_company && new_has_company {
        take
    } else {
        keep
    }
}

/// Company and location as stored, or none when either is a job title (it carries a gender
/// tag, which no company or place does). The pair came from one spot, so both go.
fn usable_details<'a>((company, location): (&'a str, &'a str)) -> (&'a str, &'a str) {
    if has_gender_tag(company) || has_gender_tag(location) {
        ("", "")
    } else {
        (company, location)
    }
}

/// Version of what the search column holds: raised with every change of [`search_text`],
/// so that [`refresh_all_searches`] recomputes the column of the jobs stored before.
const SEARCH_VERSION: i64 = 2;

/// Recomputes the search column of every job once after [`search_text`] changed (a row keeps
/// the column of the version that wrote it).
pub(super) fn refresh_all_searches(conn: &Connection) -> Result<()> {
    if kv_get_i64(conn, "search_version")? == Some(SEARCH_VERSION) {
        return Ok(());
    }
    let tx = Transaction::new_unchecked(conn, TransactionBehavior::Immediate)?;
    let rows = tx
        .prepare("SELECT portal, job_id, title, company, location, desc_text FROM job")?
        .query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                r.get::<_, String>(1)?,
                r.get::<_, String>(2)?,
                r.get::<_, String>(3)?,
                r.get::<_, String>(4)?,
                r.get::<_, Option<String>>(5)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    for (portal, id, title, company, location, text) in rows {
        let search = search_text(
            Portal::from_key(&portal),
            &title,
            &company,
            &location,
            text.as_deref().unwrap_or(""),
        );
        tx.execute(
            "UPDATE job SET search = ?3 WHERE portal = ?1 AND job_id = ?2",
            params![portal, id, search],
        )?;
    }
    kv_set(&tx, "search_version", &SEARCH_VERSION.to_string())?;
    tx.commit()?;
    Ok(())
}

/// Recomputes the search column (lower case, umlauts included).
fn refresh_search(conn: &Connection, key: &JobKey) -> Result<()> {
    let row: Option<(String, String, String, Option<String>)> = conn
        .query_row(
            "SELECT title, company, location, desc_text FROM job WHERE portal = ?1 AND job_id = ?2",
            params![key.portal.key(), key.id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)),
        )
        .optional()?;
    if let Some((title, company, location, text)) = row {
        conn.execute(
            "UPDATE job SET search = ?3 WHERE portal = ?1 AND job_id = ?2",
            params![
                key.portal.key(),
                key.id,
                search_text(
                    Some(key.portal),
                    &title,
                    &company,
                    &location,
                    text.as_deref().unwrap_or("")
                )
            ],
        )?;
    }
    Ok(())
}

/// What the search looks through: the portal's name, title, company, location and text.
fn search_text(
    portal: Option<Portal>,
    title: &str,
    company: &str,
    location: &str,
    text: &str,
) -> String {
    let portal = portal.map_or("", Portal::label);
    fold(&format!("{portal}\n{title}\n{company}\n{location}\n{text}"))
}

/// The search column of a job as its alert mail names it (no text yet).
fn mail_search(key: &JobKey, posting: &Posting) -> String {
    search_text(
        Some(key.portal),
        &posting.title,
        &posting.company,
        &posting.location,
        "",
    )
}

/// Comparison form for the search: lower case (Unicode, so umlauts too).
fn fold(text: &str) -> String {
    text.to_lowercase()
}

/// Words a search takes at most; the rest of a longer query is ignored.
const MAX_SEARCH_WORDS: usize = 8;

/// The `LIKE` patterns of a search, one per word, as a JSON array for [`matches_words`]; an
/// empty search matches everything (`None`).
pub(super) fn search_words(search: Option<&str>) -> Option<String> {
    let words: Vec<String> = fold(search.unwrap_or(""))
        .split_whitespace()
        .take(MAX_SEARCH_WORDS)
        .map(|word| format!("%{}%", escape_like(word)))
        .collect();
    (!words.is_empty()).then(|| serde_json::Value::from(words).to_string())
}

/// The condition that a job's search column holds every word of a search, in any field and
/// order (`param` binds the JSON array of [`search_words`]).
pub(super) fn matches_words(param: &str) -> String {
    format!(
        "({param} IS NULL OR NOT EXISTS (SELECT 1 FROM json_each({param}) AS word
                                          WHERE search NOT LIKE word.value ESCAPE '\\'))"
    )
}

fn escape_like(text: &str) -> String {
    text.replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::{MAX_AGE, RETRY_AFTER};
    use crate::portal::job_link;
    use crate::store::test_support::{mail, now, posting};

    #[test]
    fn seen_counts_new_known_and_duplicates() {
        let store = Store::in_memory().unwrap();
        let run1 = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4123456789/",
            "Interim CFO",
            "Nordlicht AG",
            "Hamburg",
        );
        assert_eq!(
            store.upsert_posting(run1, &a, mail(), now()).unwrap(),
            Seen::New
        );
        // The same job in a second mail of the same run.
        assert_eq!(
            store.upsert_posting(run1, &a, mail(), now()).unwrap(),
            Seen::DupInRun
        );
        let run2 = store.begin_run().unwrap();
        assert_eq!(
            store.upsert_posting(run2, &a, mail(), now()).unwrap(),
            Seen::KnownBefore
        );
        // A known job is a duplicate in the second mail of the same run too, not
        // "already known" once more.
        assert_eq!(
            store.upsert_posting(run2, &a, mail(), now()).unwrap(),
            Seen::DupInRun
        );
        // Two link forms of the same project = the same job.
        let f1 = posting(
            "https://www.freelance.de/project/index.php?id=1255067",
            "SAP",
            "",
            "",
        );
        let f2 = posting(
            "https://www.freelance.de/projekte/projekt-1255067-sap",
            "SAP",
            "",
            "",
        );
        assert_eq!(
            store.upsert_posting(run2, &f1, mail(), now()).unwrap(),
            Seen::New
        );
        assert_eq!(
            store.upsert_posting(run2, &f2, mail(), now()).unwrap(),
            Seen::DupInRun
        );
        assert_eq!(store.job_count().unwrap(), 2);
    }

    #[test]
    fn merge_fills_gaps_but_never_replaces() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let url = "https://www.linkedin.com/jobs/view/4123456789/";
        store
            .upsert_posting(run, &posting(url, "", "", "Hamburg"), mail(), now())
            .unwrap();
        let later = MailRef {
            subject: "Andere Mail",
            date: None,
            gmail_id: None,
        };
        store
            .upsert_posting(
                run,
                &posting(url, "Interim CFO", "Nordlicht AG", "Berlin (anderer Wert)"),
                later,
                now(),
            )
            .unwrap();
        store
            .upsert_posting(
                run,
                &posting(url, "Interim CFO (m/w/d) – längerer Titel", "X", "Y"),
                later,
                now(),
            )
            .unwrap();
        let job = store.job(&job_link(url).unwrap().key).unwrap().unwrap();
        assert_eq!(job.title, "Interim CFO"); // placeholder replaced, then never again
        // Company and location as a pair from the same mail: the first named only a place,
        // the second company and place - never mixed; the third changes nothing.
        assert_eq!(job.company, "Nordlicht AG");
        assert_eq!(job.location, "Berlin (anderer Wert)");
        assert_eq!(job.mail_subject, "3 neue Jobs"); // the first sighting stays
        assert_eq!(job.gmail_id, Some(0x1a2b));
    }

    /// The "company" was only a place (freelance.de often names just the city after the
    /// title) - a later mail with a real company replaces the pair; a real company is never
    /// replaced by another one.
    #[test]
    fn a_real_company_replaces_a_place_only_pair() {
        assert_eq!(
            merge_details(
                ("D-20038 Hamburg", ""),
                ("Muster Consulting GmbH", "D-20038 Hamburg")
            ),
            (
                "Muster Consulting GmbH".to_string(),
                "D-20038 Hamburg".to_string()
            )
        );
        assert_eq!(
            merge_details(("Firma A", "Köln"), ("Firma B", "Berlin")),
            ("Firma A".to_string(), "Köln".to_string())
        );
        assert_eq!(
            merge_details(("Firma A", ""), ("", "")),
            ("Firma A".to_string(), String::new())
        );
    }

    /// An older mail heuristic stored the next job's title as the company. Like a URL title
    /// it is no value: a later mail's pair replaces it, a mail without details clears it.
    #[test]
    fn a_stored_job_title_is_no_company() {
        let title = "Senior Requirements Engineer im Bankenumfeld (w/m/d)";
        assert_eq!(
            merge_details((title, ""), ("Nordlicht AG", "Hamburg")),
            ("Nordlicht AG".to_string(), "Hamburg".to_string())
        );
        assert_eq!(
            merge_details((title, ""), ("", "")),
            (String::new(), String::new())
        );
        assert_eq!(
            merge_details(("Nordlicht AG", title), ("", "")),
            (String::new(), String::new()),
            "the pair came from one spot"
        );
        // Only the sure sign counts in the store: a role word may name a company.
        assert_eq!(
            merge_details(("Controller Akademie", "Köln"), ("", "")),
            ("Controller Akademie".to_string(), "Köln".to_string())
        );

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let url = "https://www.freelance.de/project/index.php?id=1990201";
        let key = job_link(url).unwrap().key;
        let seen = |company: &str| {
            store
                .upsert_posting(
                    run,
                    &posting(url, "VMware Lead Solution Architect (m/f/d)", company, ""),
                    mail(),
                    now(),
                )
                .unwrap();
            let job = store.job(&key).unwrap().unwrap();
            (job.company, job.location)
        };
        assert_eq!(seen(title), (title.to_string(), String::new()));
        assert_eq!(seen(""), (String::new(), String::new()));
    }

    /// The engine reads title and location (the country criterion): a later mail or page
    /// that changes either makes the stored score pending again. Previously a later mail
    /// could move a scored job to London while its score stayed current.
    #[test]
    fn a_new_location_makes_the_score_pending() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let url = "https://www.linkedin.com/jobs/view/4123456780/";
        let key = job_link(url).unwrap().key;
        let seen = |company: &str, location: &str| {
            store
                .upsert_posting(
                    run,
                    &posting(url, "Controller", company, location),
                    mail(),
                    now(),
                )
                .unwrap();
        };
        let scored = || {
            let record = MatchRecord {
                status: crate::model::MatchStatus::Scored,
                score: 67,
                note: None,
                must_met: 1,
                must_total: 1,
                top: Vec::new(),
                facts: crate::model::KeyFacts::default(),
                rank: 0,
            };
            store
                .save_matches(&[(key.clone(), record)], "r1", now())
                .unwrap();
            assert_eq!(store.match_pending("r1").unwrap(), 0);
        };
        let pending = || store.match_pending("r1").unwrap();

        seen("", "");
        scored();
        seen("Acme Ltd", "London, England");
        assert_eq!(pending(), 1, "a mail named the location");
        scored();
        store
            .record_page_fields(&key, "", "Acme Holdings Ltd", "")
            .unwrap();
        assert_eq!(pending(), 0, "the engine does not read the company");
        store
            .record_page_fields(&key, "", "", "Manchester")
            .unwrap();
        assert_eq!(pending(), 1, "the page named another location");
        scored();
        store
            .record_page_fields(&key, "", "", "Manchester")
            .unwrap();
        assert_eq!(pending(), 0, "the same location changes nothing");
    }

    /// A job an older mail parser read takes the current reading when a mail names it again:
    /// a wrong company (the next job's title) and missing details heal. A current reading,
    /// and a job whose page was read, keep the merge rules.
    #[test]
    fn an_older_mail_reading_heals_when_the_job_is_seen_again() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let seen = |url: &str, title: &str, company: &str, location: &str| {
            store
                .upsert_posting(run, &posting(url, title, company, location), mail(), now())
                .unwrap();
            job_link(url).unwrap().key
        };
        let details = |key: &JobKey| {
            let job = store.job(key).unwrap().unwrap();
            (job.title, job.company, job.location)
        };
        let triple = |a: &str, b: &str, c: &str| (a.to_owned(), b.to_owned(), c.to_owned());
        let vmware = "https://www.linkedin.com/jobs/view/4000000011/";
        let wrong = seen(
            vmware,
            "VMware Lead Solution Architect",
            "Senior Requirements Engineer im Bankenumfeld",
            "",
        );
        let bare = "https://www.linkedin.com/jobs/view/4000000012/";
        let empty = seen(bare, "Interim CFO", "", "");
        let current = "https://www.linkedin.com/jobs/view/4000000013/";
        let kept = seen(current, "Controller", "Nordlicht AG", "Hamburg");
        let paged = "https://www.linkedin.com/jobs/view/4000000014/";
        let page = seen(paged, "Treasury", "", "");
        store
            .record_text(&page, "Anzeige", false, false, now())
            .unwrap();
        store
            .record_page_fields(&page, "", "Seitenfirma GmbH", "")
            .unwrap();
        // A page that named no company left the older parser's wrong one in place.
        let titled = "https://www.linkedin.com/jobs/view/4000000015/";
        let paged_wrong = seen(titled, "Architekt", "Senior Requirements Engineer", "");
        store
            .record_text(&paged_wrong, "Anzeige", false, false, now())
            .unwrap();
        for key in [&wrong, &empty, &kept, &page, &paged_wrong] {
            store.make_mail_stale(key);
        }
        // `kept` stands for a job the current parser read.
        seen(current, "Controller", "Nordlicht AG", "Hamburg");
        assert!(store.stale_mail_since(Portal::LinkedIn).unwrap().is_some());

        seen(
            vmware,
            "VMware Lead Solution Architect",
            "Acme Cloud GmbH",
            "München",
        );
        seen(bare, "Interim CFO", "Hanseatic Holding GmbH", "Hamburg");
        seen(current, "Controller", "Andere Firma GmbH", "Berlin");
        seen(paged, "Treasury", "Mailfirma GmbH", "Köln");
        seen(titled, "Architekt", "Beispiel IT GmbH", "Frankfurt am Main");
        assert_eq!(
            details(&wrong),
            triple(
                "VMware Lead Solution Architect",
                "Acme Cloud GmbH",
                "München"
            )
        );
        assert_eq!(
            details(&empty),
            triple("Interim CFO", "Hanseatic Holding GmbH", "Hamburg")
        );
        assert_eq!(
            details(&kept),
            triple("Controller", "Nordlicht AG", "Hamburg")
        );
        assert_eq!(details(&page).1, "Seitenfirma GmbH", "the page wins");
        assert_eq!(details(&paged_wrong).1, "Beispiel IT GmbH");
        assert_eq!(store.stale_mail_since(Portal::LinkedIn).unwrap(), None);
    }

    /// The page's company and location win over the mail heuristics; what the page leaves
    /// empty keeps the mail value - unless that is a job title.
    #[test]
    fn page_fields_win_over_the_mail_heuristic() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str, company: &str, location: &str| {
            store
                .upsert_posting(
                    run,
                    &posting(url, "Rolle", company, location),
                    mail(),
                    now(),
                )
                .unwrap();
            job_link(url).unwrap().key
        };
        let details = |key: &JobKey| {
            let job = store.job(key).unwrap().unwrap();
            (job.company, job.location)
        };
        let pair = |company: &str, location: &str| (company.to_string(), location.to_string());

        let a = add(
            "https://www.freelance.de/project/index.php?id=1990301",
            "Senior Requirements Engineer (w/m/d)",
            "",
        );
        store
            .record_page_fields(&a, "", "Seitenfirma GmbH", "")
            .unwrap();
        assert_eq!(details(&a), pair("Seitenfirma GmbH", ""));

        let b = add(
            "https://www.freelance.de/project/index.php?id=1990302",
            "Senior Requirements Engineer (w/m/d)",
            "",
        );
        store.record_page_fields(&b, "", "", "").unwrap();
        assert_eq!(
            details(&b),
            pair("", ""),
            "a hidden company clears the title"
        );

        let c = add(
            "https://www.freelance.de/project/index.php?id=1990303",
            "Musterfirma",
            "Remote",
        );
        store.record_page_fields(&c, "", "", "Berlin").unwrap();
        assert_eq!(details(&c), pair("Musterfirma", "Berlin (Remote)"));
        store
            .record_page_fields(&c, "", "Seitenfirma GmbH", "")
            .unwrap();
        assert_eq!(details(&c), pair("Seitenfirma GmbH", "Berlin (Remote)"));
    }

    #[test]
    fn fetch_lifecycle_and_queue_order() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let old_mail = MailRef {
            subject: "alt",
            date: Some("2026-08-01T07:00:00Z".parse().unwrap()),
            gmail_id: None,
        };
        let new_mail = MailRef {
            subject: "neu",
            date: Some("2026-09-18T07:00:00Z".parse().unwrap()),
            gmail_id: None,
        };
        let mid_mail = MailRef {
            subject: "mittel",
            date: Some("2026-09-10T07:00:00Z".parse().unwrap()),
            gmail_id: None,
        };
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        let b = posting(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "B",
            "",
            "",
        );
        let c = posting(
            "https://www.linkedin.com/jobs/view/4000000003/",
            "C",
            "",
            "",
        );
        let d = posting(
            "https://www.linkedin.com/jobs/view/4000000004/",
            "D",
            "",
            "",
        );
        store.upsert_posting(run, &a, mid_mail, now()).unwrap();
        store.upsert_posting(run, &b, new_mail, now()).unwrap();
        store.upsert_posting(run, &c, old_mail, now()).unwrap(); // older than 30 days
        store.upsert_posting(run, &d, new_mail, now()).unwrap();
        let month = SignedDuration::from_hours(30 * 24);
        let half_day = SignedDuration::from_hours(12);

        // d fails now -> it is not in the queue for the time being.
        assert_eq!(
            store.record_failed(&d.key, "leer", now()).unwrap(),
            DescStatus::Failed
        );
        let queue: Vec<_> = store
            .fetch_queue(now(), month, half_day)
            .unwrap()
            .into_iter()
            .map(|j| j.title)
            .collect();
        assert_eq!(queue, ["B", "A"]); // newest mail first, the old mail not automatically

        // 13 h later: d is due again, but after the open ones.
        let later = now() + SignedDuration::from_hours(13);
        let queue: Vec<_> = store
            .fetch_queue(later, month, half_day)
            .unwrap()
            .into_iter()
            .map(|j| j.title)
            .collect();
        assert_eq!(queue, ["B", "A", "D"]);

        assert_eq!(
            store.record_failed(&d.key, "leer", later).unwrap(),
            DescStatus::Failed
        );
        assert_eq!(
            store.record_failed(&d.key, "leer", later).unwrap(),
            DescStatus::Unfetchable
        );
        store
            .record_text(&b.key, "Volltext B", false, false, now())
            .unwrap();
        store.record_gone(&a.key, now()).unwrap();
        let later2 = later + SignedDuration::from_hours(24);
        assert!(
            store
                .fetch_queue(later2, month, half_day)
                .unwrap()
                .is_empty()
        );
        assert_eq!(
            store.description(&b.key).unwrap().as_deref(),
            Some("Volltext B")
        );
        assert_eq!(store.description(&a.key).unwrap(), None);
    }

    /// An ad text long enough to compare (duplicates need at least eight word triples).
    const AD: &str = "Für unseren Kunden suchen wir einen erfahrenen SAP FI/CO Berater. \
        Aufgaben: Einführung von S/4HANA Finance, Abstimmung mit den Fachbereichen, Konzeption \
        der Hauptbuchhaltung und Anlagenbuchhaltung, Schulung der Key User. Profil: mehrjährige \
        Projekterfahrung im Controlling, sehr gute Deutschkenntnisse, Reisebereitschaft.";

    /// A freelancermap job with the full text and the same job as freelance.de's guest
    /// teaser, merged into it: `(full, teaser)`.
    fn full_text_and_its_teaser(store: &Store, run: i64) -> (JobKey, JobKey) {
        let add = |url: &str| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        let full = add("https://www.freelancermap.de/nproj/12345.html");
        store.record_text(&full, AD, false, false, now()).unwrap();
        let teaser = add("https://www.freelance.de/project/index.php?id=1255067");
        let start: String = AD.chars().take(260).collect();
        store.record_teaser(&teaser, &start, now()).unwrap();
        assert_eq!(store.link_duplicate(&teaser).unwrap(), Some(full.clone()));
        (full, teaser)
    }

    /// The portals' caps are small: the automatic queue spends them only on jobs the lists
    /// show as active - never the trash, the archive or a duplicate
    /// merged into another portal's job (a guest teaser would cost a signed-in request).
    #[test]
    fn the_queue_leaves_out_what_the_lists_do_not_show() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |id: &str| {
            let url = format!("https://www.linkedin.com/jobs/view/{id}/");
            let p = posting(&url, "Controller", "", "");
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        let (inbox, trashed, archived) = (add("4000000001"), add("4000000002"), add("4000000003"));
        let (_, teaser) = full_text_and_its_teaser(&store, run);
        store
            .move_jobs(std::slice::from_ref(&trashed), Place::Trash, now())
            .unwrap();
        store
            .move_jobs(std::slice::from_ref(&archived), Place::Archive, now())
            .unwrap();
        let queue = || -> Vec<JobKey> {
            let mut keys: Vec<JobKey> = store
                .fetch_queue(now(), MAX_AGE, RETRY_AFTER)
                .unwrap()
                .into_iter()
                .map(|job| job.key)
                .collect();
            keys.sort();
            keys
        };
        assert_eq!(queue(), std::slice::from_ref(&inbox));
        assert!(!queue().contains(&teaser));
        // Back in the inbox, a job is due again.
        store
            .move_jobs(std::slice::from_ref(&trashed), Place::Inbox, now())
            .unwrap();
        assert!(queue().contains(&trashed));
        assert!(!queue().contains(&archived));
    }

    /// After a parser update only the jobs the queue fetches open again: a failed job in the
    /// trash keeps its honest state (the count of the log stays true).
    #[test]
    fn a_parser_update_leaves_the_trash_alone() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |id: &str| {
            let url = format!("https://www.linkedin.com/jobs/view/{id}/");
            let p = posting(&url, "Controller", "", "");
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            store.record_failed(&p.key, "leer", now()).unwrap();
            store.record_parse(&p.key, 1, None).unwrap();
            p.key
        };
        let inbox = add("4000000001");
        let trashed = add("4000000002");
        store
            .move_jobs(std::slice::from_ref(&trashed), Place::Trash, now())
            .unwrap();
        let since = now().saturating_sub(MAX_AGE).unwrap();
        assert_eq!(
            store
                .requeue_older_parses(Portal::LinkedIn, 2, since)
                .unwrap(),
            1
        );
        let status = |key: &JobKey| store.job(key).unwrap().unwrap().desc_status;
        assert_eq!(status(&inbox), DescStatus::Missing);
        assert_eq!(status(&trashed), DescStatus::Failed);
    }

    /// A failure or "gone" after a successful fetch does not downgrade the job - the text
    /// stays, nothing is fetched again.
    #[test]
    fn success_is_never_downgraded() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting("https://www.freelancermap.de/nproj/12345.html", "A", "", "");
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        store
            .record_text(&a.key, "Volltext", false, false, now())
            .unwrap();
        let rev = store.data_rev().unwrap();
        assert_eq!(
            store.record_failed(&a.key, "leer", now()).unwrap(),
            DescStatus::Ok
        );
        store.record_gone(&a.key, now()).unwrap();
        let job = store.job(&a.key).unwrap().unwrap();
        assert_eq!((job.desc_status, job.desc_attempts), (DescStatus::Ok, 0));
        assert_eq!(
            store.description(&a.key).unwrap().as_deref(),
            Some("Volltext")
        );
        assert_eq!(store.data_rev().unwrap(), rev);
    }

    /// The names of the text files earlier versions wrote stay known (for the cleanup), with
    /// the ones of deleted jobs that stayed on disk.
    #[test]
    fn old_text_file_names_stay_known() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        assert!(store.txt_names().unwrap().is_empty());
        store.mark_old_txt(&a.key, "20260918_LinkedIn_A_4000000001.txt", now());
        store.set_txt_leftovers(&["gone.txt".to_owned()]).unwrap();
        assert_eq!(
            store.txt_names().unwrap(),
            ["20260918_LinkedIn_A_4000000001.txt", "gone.txt"]
        );
        store.set_txt_leftovers(&[]).unwrap();
        assert!(store.txt_leftovers().unwrap().is_empty());
    }

    /// Failure reasons often come from the page (redirect target, script error): one short
    /// line is stored - it travels all the way to the UI in the run events.
    #[test]
    fn failure_reasons_are_short_and_flat() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting("https://www.freelancermap.de/nproj/12345.html", "A", "", "");
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        let reason = format!(
            "unerwartete Umleitung nach /{}\nzweite Zeile",
            "x".repeat(20_000)
        );
        store.record_failed(&a.key, &reason, now()).unwrap();
        let error = store.job(&a.key).unwrap().unwrap().desc_error.unwrap();
        assert_eq!(error.chars().count(), MAX_ERROR_CHARS);
        assert!(!error.contains('\n'));
    }

    /// An alert mail is taken over completely or not at all.
    #[test]
    fn an_alert_mail_is_one_change() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let alert = AlertMail {
            key: "gm:1".into(),
            portal: Portal::LinkedIn,
            subject: "2 neue Jobs".into(),
            sender: "LinkedIn".into(),
            date: None,
            gmail_id: Some(1),
            postings: vec![
                posting(
                    "https://www.linkedin.com/jobs/view/4000000001/",
                    "A",
                    "",
                    "",
                ),
                posting(
                    "https://www.linkedin.com/jobs/view/4000000001/",
                    "A",
                    "",
                    "",
                ),
                posting(
                    "https://www.linkedin.com/jobs/view/4000000002/",
                    "B",
                    "",
                    "",
                ),
            ],
        };
        assert_eq!(
            store.record_alert(run, &alert, now()).unwrap(),
            [Seen::New, Seen::DupInRun, Seen::New]
        );
        assert_eq!(store.job_count().unwrap(), 2);
        // If one statement fails, nothing of the mail remains.
        store
            .conn()
            .execute_batch(
                "CREATE TRIGGER no_b BEFORE INSERT ON job WHEN NEW.job_id = '4000000003'
                 BEGIN SELECT RAISE(ABORT, 'Test'); END;",
            )
            .unwrap();
        let failing = AlertMail {
            key: "gm:2".into(),
            postings: vec![
                posting(
                    "https://www.linkedin.com/jobs/view/4000000004/",
                    "D",
                    "",
                    "",
                ),
                posting(
                    "https://www.linkedin.com/jobs/view/4000000003/",
                    "C",
                    "",
                    "",
                ),
            ],
            ..alert
        };
        assert!(store.record_alert(run, &failing, now()).is_err());
        assert_eq!(store.job_count().unwrap(), 2);
        assert!(store.zero_posting_mails(run).unwrap().is_empty());
        let mails: i64 = store
            .conn()
            .query_row("SELECT COUNT(*) FROM alert_mail", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mails, 1);
    }

    #[test]
    fn search_is_case_insensitive_with_umlauts_and_wildcards_are_literal() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Überwachung SAP",
            "Müller GmbH",
            "Köln",
        );
        let b = posting(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "100% Remote",
            "",
            "",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        store.upsert_posting(run, &b, mail(), now()).unwrap();
        let find = |q: &str| {
            store
                .jobs(&JobFilter {
                    search: Some(q.into()),
                    ..JobFilter::default()
                })
                .unwrap()
                .into_iter()
                .map(|j| j.title)
                .collect::<Vec<_>>()
        };
        assert_eq!(find("überwachung"), ["Überwachung SAP"]);
        assert_eq!(find("MÜLLER"), ["Überwachung SAP"]);
        assert_eq!(find("100%"), ["100% Remote"]);
        assert!(find("%").iter().all(|t| t == "100% Remote"));
        assert_eq!(find("  ").len(), 2); // empty search = everything
        store
            .record_text(
                &a.key,
                "Wir suchen einen Projektleiter",
                false,
                false,
                now(),
            )
            .unwrap();
        assert_eq!(find("projektleiter"), ["Überwachung SAP"]);
    }

    #[test]
    fn search_matches_every_word_in_any_field() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.freelancermap.de/nproj/12345.html",
            "SAP FI/CO Berater (m/w/d)",
            "Datenwerk GmbH",
            "München",
        );
        let b = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Controller",
            "Hanse AG",
            "Hamburg",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        store.upsert_posting(run, &b, mail(), now()).unwrap();
        let find = |q: &str| {
            let query = PageQuery {
                search: Some(q.into()),
                limit: 50,
                ..PageQuery::default()
            };
            let (jobs, counts) = store.job_page(&query).unwrap();
            // The counts follow the same search as the list.
            assert_eq!(counts.inbox as usize, jobs.len(), "{q}");
            jobs.into_iter().map(|j| j.title).collect::<Vec<_>>()
        };
        let sap = ["SAP FI/CO Berater (m/w/d)"];
        assert_eq!(find("sap berater"), sap);
        assert_eq!(find("SAP  MÜNCHEN"), sap);
        assert_eq!(find("münchen berater"), sap);
        assert!(find("sap berlin").is_empty());
        assert!(find("sap hamburg").is_empty());
        assert_eq!(find("  ").len(), 2); // empty search = everything
        store
            .record_text(&b.key, "Remote möglich, Start sofort", false, false, now())
            .unwrap();
        assert_eq!(find("controller remote"), ["Controller"]);
    }

    #[test]
    fn search_finds_the_portal_name() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.freelancermap.de/nproj/12345.html",
            "Controller",
            "",
            "",
        );
        let b = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Controller",
            "",
            "",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        store.upsert_posting(run, &b, mail(), now()).unwrap();
        let find = |q: &str| {
            store
                .jobs(&JobFilter {
                    search: Some(q.into()),
                    ..JobFilter::default()
                })
                .unwrap()
                .into_iter()
                .map(|j| j.key)
                .collect::<Vec<_>>()
        };
        assert_eq!(find("freelancermap"), std::slice::from_ref(&a.key));
        assert_eq!(find("LinkedIn controller"), std::slice::from_ref(&b.key));
    }

    #[test]
    fn rows_stored_before_the_portal_name_get_it_once() {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "Controller",
            "",
            "",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        // The column as an older version wrote it, before the portal's name was in it.
        store
            .conn()
            .execute_batch(
                "UPDATE job SET search = 'controller'; UPDATE kv SET value = '1'
                 WHERE key = 'search_version';",
            )
            .unwrap();
        let hits = |q: &str| {
            let filter = JobFilter {
                search: Some(q.into()),
                ..JobFilter::default()
            };
            store.jobs(&filter).unwrap().len()
        };
        assert_eq!(hits("linkedin"), 0);
        refresh_all_searches(&store.conn()).unwrap();
        assert_eq!(hits("linkedin"), 1);
        assert_eq!(
            store.kv_get("search_version").unwrap().as_deref(),
            Some(SEARCH_VERSION.to_string().as_str())
        );
    }

    #[test]
    fn filter_by_run_and_newest_first() {
        let store = Store::in_memory().unwrap();
        let run1 = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        store.upsert_posting(run1, &a, mail(), now()).unwrap();
        let run2 = store.begin_run().unwrap();
        let b = posting(
            "https://www.linkedin.com/jobs/view/4000000002/",
            "B",
            "",
            "",
        );
        let later = now() + SignedDuration::from_mins(1);
        store.upsert_posting(run2, &b, mail(), later).unwrap();
        store.upsert_posting(run2, &a, mail(), later).unwrap(); // known, does not count as new
        let only_new: Vec<_> = store
            .jobs(&JobFilter {
                first_seen_run: Some(run2),
                ..JobFilter::default()
            })
            .unwrap()
            .into_iter()
            .map(|j| j.title)
            .collect();
        assert_eq!(only_new, ["B"]);
        let all: Vec<_> = store
            .jobs(&JobFilter::default())
            .unwrap()
            .into_iter()
            .map(|j| j.title)
            .collect();
        assert_eq!(all, ["B", "A"]);
    }

    #[test]
    fn data_rev_changes_only_with_visible_content() {
        let store = Store::in_memory().unwrap();
        let v0 = store.data_rev().unwrap();
        let run = store.begin_run().unwrap();
        let a = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "A",
            "",
            "",
        );
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        let v1 = store.data_rev().unwrap();
        assert!(v1 > v0);
        // The same mail again: nothing changes, so no new export either.
        store.upsert_posting(run, &a, mail(), now()).unwrap();
        assert_eq!(store.data_rev().unwrap(), v1);
        store
            .upsert_posting(
                run,
                &posting(
                    "https://www.linkedin.com/jobs/view/4000000001/",
                    "A",
                    "Firma",
                    "",
                ),
                mail(),
                now(),
            )
            .unwrap();
        let v2 = store.data_rev().unwrap();
        assert!(v2 > v1);
        store
            .record_text(&a.key, "Text", false, false, now())
            .unwrap();
        assert!(store.data_rev().unwrap() > v2);
    }

    /// A mail that linked the title as a bare address left the URL as the title - and it
    /// stayed, because it was "not empty". A later run with a real title now replaces it. A
    /// proper title, on the other hand, stays untouched.
    #[test]
    fn a_stored_url_is_no_title_and_gets_replaced() {
        let store = Store::in_memory().unwrap();
        let url = "https://www.freelance.de/project/index.php?id=1291188";
        let key = job_link(url).unwrap().key;
        let seen = |title: &str| {
            let run = store.begin_run().unwrap();
            let mail = AlertMail {
                key: format!("m{run}"),
                portal: Portal::FreelanceDe,
                subject: "1 neues Projekt".into(),
                sender: "freelance.de".into(),
                date: None,
                gmail_id: Some(u64::try_from(run).unwrap()),
                postings: vec![posting(url, title, "", "")],
            };
            store.record_alert(run, &mail, now()).unwrap();
            store.job(&key).unwrap().unwrap().title
        };
        // The mail only links the address - for lack of anything better it becomes the title.
        assert_eq!(seen(url), url);
        // A run with a real title replaces it.
        assert_eq!(
            seen("Senior Requirements Engineer (w/m/d)"),
            "Senior Requirements Engineer (w/m/d)"
        );
        // A real title is not replaced by another one.
        assert_eq!(
            seen("Etwas anderes"),
            "Senior Requirements Engineer (w/m/d)"
        );
    }

    /// The jobs of a page with their order: by match first the jobs still without a score
    /// (the list's "Noch ohne Passung" on top, so every page it loads is complete), then the
    /// best score; a closed ad after the open ones of its group; the excluded ones last. By
    /// date only the closed and the excluded ones step back.
    #[test]
    fn by_match_the_jobs_without_a_score_come_first() {
        use crate::model::MatchStatus::{Excluded, Scored};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        // P and Q wait for their score, H and L are scored, C is a closed ad, X excluded;
        // the mails from the newest (P) to the oldest (X).
        let mut keys = Vec::new();
        for (hours, title) in (1..).zip(["P", "Q", "H", "L", "C", "X"]) {
            let job = posting(
                &format!("https://www.linkedin.com/jobs/view/41000000{hours:02}/"),
                title,
                "",
                "",
            );
            let mail = MailRef {
                subject: "x",
                date: Some(now() - SignedDuration::from_hours(hours)),
                gmail_id: None,
            };
            store.upsert_posting(run, &job, mail, now()).unwrap();
            keys.push(job.key);
        }
        for closed in [&keys[1], &keys[4]] {
            store
                .record_text(closed, "Nicht mehr offen", false, true, now())
                .unwrap();
        }
        let record = |status, score| MatchRecord {
            status,
            score,
            note: None,
            must_met: 0,
            must_total: 0,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(
                &[
                    (keys[2].clone(), record(Scored, 60)),
                    (keys[3].clone(), record(Scored, 30)),
                    (keys[4].clone(), record(Scored, 95)),
                    (keys[5].clone(), record(Excluded, 99)),
                ],
                "r",
                now(),
            )
            .unwrap();
        let page = |by_match, limit| {
            let query = PageQuery {
                by_match,
                limit,
                ..PageQuery::default()
            };
            store.job_page(&query).unwrap().0
        };
        let titles = |by_match| {
            page(by_match, 50)
                .into_iter()
                .map(|job| job.title)
                .collect::<Vec<_>>()
        };
        assert_eq!(titles(true), ["P", "Q", "H", "L", "C", "X"]);
        assert_eq!(titles(false), ["P", "H", "L", "Q", "C", "X"]);
        // A page of two by match holds the two without a score, whole.
        assert!(page(true, 2).iter().all(|job| job.match_.is_none()));
    }

    /// By match every job whose ring shows no number stands in one place, on top: the ones
    /// not scored yet and the unscorable ones together, newest first, whatever score an
    /// unscorable one keeps; the excluded ones at the end, newest first too (their ring shows
    /// the ban, not the fit they keep).
    #[test]
    fn by_match_the_jobs_without_a_number_stand_together_and_the_excluded_by_date() {
        use crate::model::MatchStatus::{Excluded, Scored, Unscorable};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        // From the newest mail (A) to the oldest (V).
        let titles = ["A", "B", "U", "E", "N", "S", "V"];
        let mut keys = Vec::new();
        for (hours, title) in (1..).zip(titles) {
            let job = posting(
                &format!("https://www.linkedin.com/jobs/view/42000000{hours:02}/"),
                title,
                "",
                "",
            );
            let mail = MailRef {
                subject: "x",
                date: Some(now() - SignedDuration::from_hours(hours)),
                gmail_id: None,
            };
            store.upsert_posting(run, &job, mail, now()).unwrap();
            keys.push(job.key);
        }
        let record = |status, score, rank| MatchRecord {
            status,
            score,
            note: None,
            must_met: 0,
            must_total: 0,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank,
        };
        // N waits for its score; U and V are not scorable (V with a score left over).
        store
            .save_matches(
                &[
                    (keys[0].clone(), record(Excluded, 20, 200)),
                    (keys[1].clone(), record(Scored, 70, 700)),
                    (keys[2].clone(), record(Unscorable, 0, 0)),
                    (keys[3].clone(), record(Excluded, 90, 900)),
                    (keys[5].clone(), record(Scored, 40, 400)),
                    (keys[6].clone(), record(Unscorable, 55, 550)),
                ],
                "r",
                now(),
            )
            .unwrap();
        let page = |limit| {
            let query = PageQuery {
                by_match: true,
                limit,
                ..PageQuery::default()
            };
            store
                .job_page(&query)
                .unwrap()
                .0
                .into_iter()
                .map(|job| job.title)
                .collect::<Vec<_>>()
        };
        assert_eq!(page(50), ["U", "N", "V", "B", "S", "A", "E"]);
        // A page of three holds the three without a number, whole.
        assert_eq!(page(3), ["U", "N", "V"]);
    }
}
