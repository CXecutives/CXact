//! The demo's mailbox and portals (the `CXact Demo` app, the `--demo` start): at every fetch
//! the mailbox receives the next batch of alert mails, made from the invented ads the app
//! bundles; the batch's ads of a source the app searches (freelancermap) come through that
//! source's search instead, and the portals answer with those ads' texts. Everything else is
//! the real run:
//! the scan reads the mails, the fetch asks for the pages at the real pace, the real engine
//! scores them with the profile of the demo's work folder and the export writes its files
//! there. What the mailbox received lives in the demo's database, which the app makes anew
//! at every start: every start begins with an empty inbox. No real mailbox, portal or
//! keychain entry is ever touched.

use std::collections::{HashMap, HashSet};
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use jiff::civil::Date;
use jiff::{SignedDuration, Timestamp};
use serde::{Deserialize, Serialize};
use tokio_util::sync::CancellationToken;
use url::Url;

use super::{DEMO_ADDRESS, FixtureJob, ad_body, page_facts, pause};
use crate::fetch::{PageFetcher, PageFields, PageOutcome, Prescore, neutral_prescore};
use crate::mail::imap::{MailError, MailSource};
use crate::mail::{RawHead, RawMail, head_part};
use crate::pipeline::{Backends, LivePaths, LocalMatcher, Matcher, stored_paths};
use crate::portal::{Facts, FetchPath, Hit, JobKey, JobLink, Portal, Way};
use crate::store::Store;

/// The database entry of the demo's mailbox: the batches it received so far ([`Batch`]).
const MAILBOX: &str = "demo_mailbox";
/// So many jobs a fetch brings (the last one what is left).
const BATCH_JOBS: RangeInclusive<usize> = 5..=15;
/// So many jobs one alert mail carries at most.
const MAIL_JOBS: usize = 3;
/// The mails of the first fetch came over the days before it.
const FIRST_SPAN: SignedDuration = SignedDuration::from_hours(72);
/// The mails of a later fetch came since the one before, spread over two hours at least.
const MIN_SPAN: SignedDuration = SignedDuration::from_hours(2);
/// The order of the ads and the size of each batch: the same at every start.
const SEED: u64 = 0x5eed_0dea_2026;
/// The store's number of the current run (`Store::begin_run`).
const RUN_SEQ: &str = "run_seq";
/// So many hits a search page shows at most, the newest first.
const SEARCH_HITS: usize = 20;
/// How long a portal takes to answer, in milliseconds (the pace between two requests is the
/// real one, `fetch::admit`).
const ANSWER_MS: RangeInclusive<u64> = 300..=900;
/// How long the mailbox takes to connect, to search, to send heads and to send mails.
const CONNECT: Duration = Duration::from_millis(600);
const SEARCH: Duration = Duration::from_millis(400);
const HEADS: Duration = Duration::from_millis(100);
const LOAD: Duration = Duration::from_millis(300);

/// One invented ad as its alert mail announces it and its page shows it.
#[derive(Debug, Clone)]
struct DemoAd {
    key: JobKey,
    /// The job link of its alert mail.
    url: String,
    title: String,
    company: String,
    location: String,
    /// The ad's text as its page shows it.
    text: String,
    /// A guest sees only its teaser (freelance.de without a sign-in).
    teaser: bool,
    /// What its page states (rate, start, duration, remote share, contract).
    facts: Facts,
}

/// The ads the demo draws from, in the order its mailbox receives them.
#[derive(Debug, Default)]
pub struct DemoAds {
    ads: Vec<DemoAd>,
    index: HashMap<JobKey, usize>,
}

impl DemoAds {
    /// Reads the ad folders (each a `jobs.json` and one text file per job in the text
    /// contract format, like `core/tests/fixtures/matching/heldout8`). A folder that is not
    /// there is left out (the app without the demo bundle carries two sets only), a job two
    /// folders hold comes once. The order mixes the sets and the portals, the same at every
    /// start.
    pub fn load(sources: &[PathBuf]) -> crate::Result<DemoAds> {
        let sets: Vec<String> = sources.iter().map(|s| s.display().to_string()).collect();
        let names: Vec<&str> = sets.iter().map(String::as_str).collect();
        DemoAds::load_from(&names, |set, file| {
            std::fs::read_to_string(Path::new(set).join(file)).ok()
        })
    }

    /// Reads the ad sets through `read(set, file)`: the folders of [`DemoAds::load`], or the
    /// files built into the CXact Demo exe (one file to send, no resources beside it).
    pub fn load_from(
        sets: &[&str],
        read: impl Fn(&str, &str) -> Option<String>,
    ) -> crate::Result<DemoAds> {
        let mut ads = Vec::new();
        let mut seen = HashSet::new();
        for &set in sets {
            let Some(json) = read(set, "jobs.json") else {
                log::warn!("demo: no ads in {set}");
                continue;
            };
            let jobs: Vec<FixtureJob> = serde_json::from_str(&json)
                .map_err(|e| crate::Error::Corrupt(format!("{set}/jobs.json: {e}")))?;
            for job in jobs {
                let Some(link) = crate::portal::job_link(&job.url) else {
                    log::warn!("demo: no job link in {}", job.file);
                    continue;
                };
                if !seen.insert(link.key.clone()) {
                    continue;
                }
                let file = format!("{}.txt", job.file);
                let text = read(set, &file)
                    .ok_or_else(|| crate::Error::Corrupt(format!("{set}/{file}: not there")))?;
                ads.push(DemoAd {
                    key: link.key,
                    url: job.url,
                    title: job.title,
                    company: job.company,
                    location: job.location,
                    text: ad_body(&text).to_owned(),
                    teaser: job.desc_status == "teaser",
                    facts: job.facts.as_ref().and_then(page_facts).unwrap_or_default(),
                });
            }
        }
        fastrand::Rng::with_seed(SEED).shuffle(&mut ads);
        let index = ads
            .iter()
            .enumerate()
            .map(|(at, ad)| (ad.key.clone(), at))
            .collect();
        Ok(DemoAds { ads, index })
    }

    pub fn len(&self) -> usize {
        self.ads.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ads.is_empty()
    }

    fn get(&self, key: &JobKey) -> Option<&DemoAd> {
        self.index.get(key).and_then(|&at| self.ads.get(at))
    }
}

/// The alert mails one fetch found in the mailbox: the next `count` ads, arrived at `at`,
/// handed out in run `run` (`None`: outside a run, the tests of the mailbox).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
struct Batch {
    at: Timestamp,
    count: usize,
    #[serde(default)]
    run: Option<i64>,
}

/// The batches the mailbox received so far; an unreadable entry counts as none.
fn received(store: &Store) -> crate::Result<Vec<Batch>> {
    Ok(store
        .kv_get(MAILBOX)?
        .and_then(|json| {
            serde_json::from_str(&json)
                .inspect_err(|e| log::warn!("demo: the mailbox is unreadable ({e})"))
                .ok()
        })
        .unwrap_or_default())
}

/// The mailbox receives the next batch of ads (none once every ad came) and remembers it;
/// returns every batch it holds now.
///
/// Once per run: the mailbox as the fetch connects to it, or the search when the fetch reads
/// no mails (its "Alert-Mails" switched off) - whichever asks first; the other finds the
/// batch already there.
fn deliver(store: &Store, ads: &DemoAds, now: Timestamp) -> crate::Result<Vec<Batch>> {
    let mut batches = received(store)?;
    let run = store
        .kv_get(RUN_SEQ)?
        .and_then(|value| value.parse::<i64>().ok());
    if run.is_some() && batches.last().is_some_and(|batch| batch.run == run) {
        return Ok(batches);
    }
    let delivered: usize = batches.iter().map(|batch| batch.count).sum();
    let left = ads.len().saturating_sub(delivered);
    if left > 0 {
        batches.push(Batch {
            at: now,
            count: batch_size(delivered).min(left),
            run,
        });
        let json =
            serde_json::to_string(&batches).map_err(|e| crate::Error::Corrupt(e.to_string()))?;
        store.kv_set(MAILBOX, &json)?;
    }
    Ok(batches)
}

/// The size of the batch after `delivered` ads: 5 to 15, the same at every start.
fn batch_size(delivered: usize) -> usize {
    fastrand::Rng::with_seed(SEED ^ u64::try_from(delivered).unwrap_or(u64::MAX)).usize(BATCH_JOBS)
}

/// One alert mail in the demo's mailbox.
#[derive(Debug, Clone)]
struct Mail {
    uid: u32,
    portal: Portal,
    /// When it came into the mailbox: the search goes by it, like Gmail's by the arrival.
    arrived: Timestamp,
    bytes: Vec<u8>,
}

/// How a portal's alert mails look: its sender, the subject for one job and for several
/// (`{n}` their number), and a job's block with its link, company and location.
struct Style {
    portal: Portal,
    from: &'static str,
    one: &'static str,
    many: &'static str,
    /// A table row per job with "Company · Location" (LinkedIn), else a block of lines.
    table: bool,
    /// The label before the location in a block of lines ("Ort: ", freelancermap).
    place: &'static str,
}

/// The alert mails of the portals the ads come from, like real ones (German like the portals'
/// mails, external data - do not translate). A source the app searches sends none in the demo
/// (its ads come through its search, [`FeedPages`]).
const STYLES: [Style; 3] = [
    Style {
        portal: Portal::LinkedIn,
        from: "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        one: "Ein neuer Job für dich",
        many: "{n} neue Jobs für dich",
        table: true,
        place: "",
    },
    Style {
        portal: Portal::FreelanceDe,
        from: "freelance.de <info@freelance.de>",
        one: "Neue Projektvorschläge für Sie",
        many: "Neue Projektvorschläge für Sie",
        table: false,
        place: "",
    },
    Style {
        portal: Portal::Freelancermap,
        from: "freelancermap <projekte@freelancermap.de>",
        one: "Ein neues Projekt für Ihre Suche",
        many: "{n} neue Projekte für Ihre Suche",
        table: false,
        place: "Ort: ",
    },
];

/// The mailbox after these batches: per batch and portal, mails of up to three jobs, dated
/// over the days before the first fetch, and for a later one over the time since the fetch
/// before (two hours at least); the portals' mails mixed in time, the newest a while before
/// the fetch. The same batches always give the same mails.
fn mailbox(ads: &DemoAds, batches: &[Batch]) -> Vec<Mail> {
    let mut mails = Vec::new();
    let mut from = 0;
    let mut before: Option<Timestamp> = None;
    for (number, batch) in (0u32..).zip(batches) {
        let to = (from + batch.count).min(ads.len());
        let group = ads.ads.get(from..to).unwrap_or_default();
        from = to;
        let mut letters: Vec<(&Style, Vec<&DemoAd>)> = Vec::new();
        for style in STYLES
            .iter()
            .filter(|style| style.portal.way() == Way::Alert)
        {
            let theirs: Vec<&DemoAd> = group
                .iter()
                .filter(|ad| ad.key.portal == style.portal)
                .collect();
            letters.extend(theirs.chunks(MAIL_JOBS).map(|jobs| (style, jobs.to_vec())));
        }
        let mut rng = fastrand::Rng::with_seed(SEED ^ u64::from(number));
        rng.shuffle(&mut letters);
        let span = before.map_or(FIRST_SPAN, |previous| {
            batch
                .at
                .duration_since(previous)
                .clamp(MIN_SPAN, FIRST_SPAN)
        });
        let count = i64::try_from(letters.len()).unwrap_or(i64::MAX);
        let slot = span.as_secs() / count.saturating_add(1);
        for ((place, (style, jobs)), uid) in (0i64..).zip(letters).zip(number * 100 + 1..) {
            let back = slot * (count - place) - rng.i64(0..=slot / 2);
            let date = batch
                .at
                .checked_sub(SignedDuration::from_secs(back))
                .unwrap_or(batch.at);
            mails.push(Mail {
                uid,
                portal: style.portal,
                arrived: batch.at,
                bytes: letter(style, &jobs, date, uid),
            });
        }
        before = Some(batch.at);
    }
    mails
}

/// An alert mail with these jobs, in the portal's own words and layout.
fn letter(style: &Style, jobs: &[&DemoAd], date: Timestamp, uid: u32) -> Vec<u8> {
    let subject = match jobs.len() {
        1 => style.one.to_owned(),
        n => style.many.replace("{n}", &n.to_string()),
    };
    let blocks: String = jobs
        .iter()
        .map(|ad| {
            let (url, title) = (escape(&ad.url), escape(&ad.title));
            let (company, location) = (escape(&ad.company), escape(&ad.location));
            if style.table {
                format!(
                    r#"<tr><td><a href="{url}">{title}</a><p>{company}</p><p>{location}</p></td></tr>"#
                )
            } else {
                let place = style.place;
                format!(
                    r#"<div><a href="{url}">{title}</a><br>{company}<br>{place}{location}</div>"#
                )
            }
        })
        .collect();
    let body = if style.table {
        format!("<table>{blocks}</table>")
    } else {
        blocks
    };
    let (from, date) = (style.from, date.strftime("%a, %d %b %Y %H:%M:%S +0000"));
    format!(
        "From: {from}\r\nTo: {DEMO_ADDRESS}\r\nSubject: {subject}\r\nDate: {date}\r\n\
         Message-ID: <demo.{uid}@example.com>\r\nMIME-Version: 1.0\r\n\
         Content-Type: text/html; charset=utf-8\r\n\r\n<html><body>{body}</body></html>"
    )
    .into_bytes()
}

/// Text for HTML.
fn escape(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// The demo's mailbox and portals for one run, with the engine of the demo's profile.
pub struct DemoFeed {
    ads: Arc<DemoAds>,
    store: Arc<Store>,
    /// The engine with the profile as it was when the run started.
    matcher: Option<Arc<LocalMatcher>>,
    /// When the mailbox receives the next batch.
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
}

impl DemoFeed {
    pub fn new(
        ads: Arc<DemoAds>,
        store: Arc<Store>,
        matcher: Option<Arc<LocalMatcher>>,
    ) -> DemoFeed {
        DemoFeed {
            ads,
            store,
            matcher,
            clock: Arc::new(Timestamp::now),
        }
    }
}

impl Backends for DemoFeed {
    type Mail = FeedMail;
    type Pages = FeedPages;

    /// The mailbox receives the next batch as the fetch connects to it.
    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<FeedMail, MailError> {
        pause(CONNECT, cancel).await?;
        let batches = deliver(&self.store, &self.ads, (self.clock)())
            .map_err(|e| MailError::Server(format!("demo mailbox: {e}")))?;
        Ok(FeedMail {
            mails: mailbox(&self.ads, &batches),
            cancel: cancel.clone(),
        })
    }

    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<FeedPages, String> {
        Ok(FeedPages {
            ads: Arc::clone(&self.ads),
            store: Arc::clone(&self.store),
            clock: Arc::clone(&self.clock),
        })
    }

    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        self.matcher.clone().map(|m| m as Arc<dyn Matcher>)
    }

    fn prescore(&self) -> Prescore {
        match &self.matcher {
            Some(local) => {
                let local = Arc::clone(local);
                Arc::new(move |title: &str, location: &str| {
                    crate::matching::prescore(local.profile(), title, location)
                })
            }
            None => neutral_prescore(),
        }
    }

    fn live_paths(&self) -> Option<LivePaths> {
        Some(stored_paths(Arc::clone(&self.store)))
    }
}

/// The demo's mailbox as a fetch finds it.
pub struct FeedMail {
    mails: Vec<Mail>,
    cancel: CancellationToken,
}

impl FeedMail {
    fn mail(&self, uid: u32) -> Option<&Mail> {
        self.mails
            .binary_search_by_key(&uid, |mail| mail.uid)
            .ok()
            .and_then(|at| self.mails.get(at))
    }
}

impl MailSource for FeedMail {
    async fn search(
        &mut self,
        since: Option<Date>,
        portals: &[Portal],
    ) -> Result<Vec<u32>, MailError> {
        pause(SEARCH, &self.cancel).await?;
        Ok(self
            .mails
            .iter()
            .filter(|mail| portals.contains(&mail.portal))
            .filter(|mail| since.is_none_or(|day| crate::time::local_date(mail.arrived) >= day))
            .map(|mail| mail.uid)
            .collect())
    }

    async fn heads(&mut self, uids: &[u32]) -> Result<Vec<RawHead>, MailError> {
        pause(HEADS, &self.cancel).await?;
        Ok(uids
            .iter()
            .filter_map(|&uid| self.mail(uid))
            .map(|mail| RawHead {
                uid: mail.uid,
                bytes: head_part(&mail.bytes).to_vec(),
            })
            .collect())
    }

    async fn fetch(&mut self, uids: &[u32]) -> Result<Vec<RawMail>, MailError> {
        pause(LOAD, &self.cancel).await?;
        Ok(uids
            .iter()
            .filter_map(|&uid| self.mail(uid))
            .map(|mail| RawMail {
                // No Gmail id: the demo's mails cannot be opened in a real mailbox.
                gmail_id: None,
                bytes: mail.bytes.clone(),
            })
            .collect())
    }
}

/// The portals as the demo's fetch asks them: every ad's page with its text (a freelance.de
/// teaser as a teaser) and its facts, and a source's search page, after a short answer time.
pub struct FeedPages {
    ads: Arc<DemoAds>,
    /// The batches handed out so far (the search shows their ads).
    store: Arc<Store>,
    /// When the search hands out this run's batch (the fetch read no mails).
    clock: Arc<dyn Fn() -> Timestamp + Send + Sync>,
}

impl PageFetcher for FeedPages {
    async fn fetch(&mut self, link: &JobLink, cancel: &CancellationToken) -> PageOutcome {
        let answer = Duration::from_millis(fastrand::u64(ANSWER_MS));
        if !crate::time::sleep_cancellable(answer, cancel).await {
            return PageOutcome::Cancelled;
        }
        let Some(ad) = self.ads.get(&link.key) else {
            return PageOutcome::Gone;
        };
        // The page names company and location plainly, where the mail reader may have
        // missed them (a line it took for a sentence); the mail's title stays.
        let fields = Some(PageFields {
            title: String::new(),
            company: ad.company.clone(),
            location: place(&ad.location).to_owned(),
        });
        if ad.teaser {
            PageOutcome::Teaser {
                text: ad.text.clone(),
                fields,
                facts: ad.facts.clone(),
            }
        } else {
            PageOutcome::Text {
                text: ad.text.clone(),
                short: false,
                closed: false,
                fields,
                facts: ad.facts.clone(),
            }
        }
    }

    /// A search page shows the source's ads of the batches handed out so far (this fetch's
    /// included), the newest first; a source without ads in the demo finds none. Every term
    /// finds the same: the run counts a job once.
    async fn search(
        &mut self,
        portal: Portal,
        _url: &Url,
        cancel: &CancellationToken,
    ) -> Result<Vec<Hit>, PageOutcome> {
        let answer = Duration::from_millis(fastrand::u64(ANSWER_MS));
        if !crate::time::sleep_cancellable(answer, cancel).await {
            return Err(PageOutcome::Cancelled);
        }
        let batches = deliver(&self.store, &self.ads, (self.clock)()).unwrap_or_else(|e| {
            log::warn!("demo: the mailbox is unreadable ({e})");
            Vec::new()
        });
        let handed: usize = batches.iter().map(|batch| batch.count).sum();
        let ads = self.ads.ads.get(..handed.min(self.ads.len()));
        Ok(ads
            .unwrap_or_default()
            .iter()
            .rev()
            .filter(|ad| ad.key.portal == portal)
            .take(SEARCH_HITS)
            .filter_map(|ad| {
                Some(Hit {
                    link: crate::portal::job_link(&ad.url)?,
                    title: ad.title.clone(),
                    company: ad.company.clone(),
                    location: place(&ad.location).to_owned(),
                })
            })
            .collect())
    }
}

/// The place of a location as an ad states it, without the fields a freelancermap line
/// adds ("93047 Regensburg // Vertragsart: ...").
fn place(location: &str) -> &str {
    location.split("//").next().unwrap_or(location).trim()
}

#[cfg(test)]
mod tests {
    use std::path::Path;
    use std::sync::Mutex;

    use tokio::time::Instant;

    use super::*;
    use crate::export::{RESULT_DIR, XLSX_NAME};
    use crate::fetch::policy::Policy;
    use crate::mail::{MailKind, classify_mail};
    use crate::model::DescStatus;
    use crate::pipeline::{Outcome, RunContext, RunKind, RunRequest, RunSummary, run};
    use crate::settings::{FetchRange, Language};
    use crate::store::JobFilter;

    /// Every held-out set the demo build bundles.
    fn every_set() -> Vec<PathBuf> {
        (1..=9)
            .map(|n| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/matching")
                    .join(format!("heldout{n}"))
            })
            .collect()
    }

    /// Simulated time (tokio's paused clock): the pace costs nothing.
    fn clock() -> impl Fn() -> Timestamp + Send + Sync + Clone + 'static {
        let base = Timestamp::now();
        let start = Instant::now();
        move || base + SignedDuration::try_from(start.elapsed()).unwrap()
    }

    /// The demo's mailbox and portals with the sample profile, on `clock`.
    fn feed(
        ads: &Arc<DemoAds>,
        store: &Arc<Store>,
        clock: impl Fn() -> Timestamp + Send + Sync + 'static,
    ) -> DemoFeed {
        DemoFeed {
            clock: Arc::new(clock),
            ..DemoFeed::new(
                Arc::clone(ads),
                Arc::clone(store),
                Some(super::super::matcher()),
            )
        }
    }

    fn ctx(workspace: &Path) -> RunContext {
        RunContext {
            workspace: workspace.to_path_buf(),
            dry_run: false,
            portals: Portal::ALL.to_vec(),
            fetch_portals: Portal::ALL.to_vec(),
            sign_in: Vec::new(),
            fetch_range: FetchRange::SinceLast,
            language: Language::De,
            mailbox: None,
            read_mail: true,
            search_portals: Portal::ALL
                .into_iter()
                .filter(|portal| portal.way() == Way::Search)
                .collect(),
            search_terms: vec!["Interim CFO".to_owned(), "Controlling".to_owned()],
        }
    }

    async fn go(
        feed: &mut DemoFeed,
        store: &Store,
        kind: RunKind,
        ctx: &RunContext,
        clock: &impl Fn() -> Timestamp,
    ) -> RunSummary {
        let policy = Mutex::new(Policy::in_memory());
        let request = RunRequest { kind };
        let cancel = CancellationToken::new();
        run(feed, store, &policy, &request, ctx, &cancel, clock, |_| {}).await
    }

    /// Every ad of every set comes once (a job two sets hold too), in the same mixed order at
    /// every start, with teasers and page facts among them.
    #[test]
    fn the_ads_of_every_set_come_once_in_a_fixed_order() {
        let ads = DemoAds::load(&every_set()).unwrap();
        assert_eq!(ads.len(), 438);
        let again = DemoAds::load(&every_set()).unwrap();
        assert!(
            ads.ads.iter().zip(&again.ads).all(|(a, b)| a.key == b.key),
            "the same order at every start"
        );
        let first: HashSet<Portal> = ads.ads[..10].iter().map(|ad| ad.key.portal).collect();
        assert_eq!(first.len(), 3, "the portals mixed");
        assert!(ads.ads.iter().any(|ad| ad.teaser));
        assert!(ads.ads.iter().any(|ad| ad.facts != Facts::default()));
    }

    /// The mailbox receives 5 to 15 ads per fetch until every ad came, then nothing; every
    /// ad of a source of alert mails reads back from its alert mail as the ad says it (the real
    /// mail reader), each mail dated before it arrived, over the days before the first fetch;
    /// freelancermap, which the app searches, sends none.
    #[test]
    fn every_ad_reads_back_from_its_alert_mail() {
        let ads = DemoAds::load(&every_set()).unwrap();
        let store = Store::in_memory().unwrap();
        let start: Timestamp = "2026-10-01T09:00:00Z".parse().unwrap();
        let mut batches = Vec::new();
        for n in 0.. {
            let now = start + SignedDuration::from_mins(20 * n);
            let next = deliver(&store, &ads, now).unwrap();
            if next.len() == batches.len() {
                break;
            }
            batches = next;
        }
        let (last, rest) = batches.split_last().unwrap();
        assert!(rest.iter().all(|batch| BATCH_JOBS.contains(&batch.count)));
        assert!(last.count <= *BATCH_JOBS.end());
        assert_eq!(batches.iter().map(|b| b.count).sum::<usize>(), ads.len());
        let mails = mailbox(&ads, &batches);
        let mut read: HashMap<JobKey, crate::model::Posting> = HashMap::new();
        for mail in &mails {
            let raw = RawMail {
                gmail_id: None,
                bytes: mail.bytes.clone(),
            };
            let MailKind::Alert(alert) = classify_mail(&raw, &Portal::ALL) else {
                panic!("mail {} is no alert", mail.uid);
            };
            assert_eq!(alert.portal, mail.portal);
            let date = alert.date.unwrap();
            assert!(
                date < mail.arrived && date > mail.arrived - FIRST_SPAN,
                "{date}"
            );
            for posting in alert.postings {
                assert!(read.insert(posting.key.clone(), posting).is_none());
            }
        }
        let mailed: Vec<&DemoAd> = ads
            .ads
            .iter()
            .filter(|ad| ad.key.portal.way() == Way::Alert)
            .collect();
        assert!(mailed.len() < ads.len(), "freelancermap is searched");
        assert_eq!(read.len(), mailed.len());
        // The mail reader takes a line of five words and more that ends with a period for a
        // sentence ("Sp. z o.o.", "Pvt. Ltd."): those few jobs get company and location
        // from their page ([`FeedPages`]).
        let mut missed = 0;
        for ad in mailed {
            let got = &read[&ad.key];
            assert_eq!(got.title, ad.title);
            let details = (got.company.as_str(), got.location.as_str());
            if details == ("", "") && ad.company.ends_with('.') {
                missed += 1;
            } else {
                assert_eq!(
                    details,
                    (ad.company.as_str(), place(&ad.location)),
                    "{}",
                    ad.key
                );
            }
        }
        assert!(missed * 50 < read.len(), "{missed}");
    }

    /// Each fetch brings the next batch like a real fetch: the mails read and freelancermap
    /// searched, every new ad's page fetched and scored by the real engine, the Excel file
    /// written. Once every ad came, a fetch completes and finds no new job.
    #[tokio::test(start_paused = true)]
    async fn every_fetch_brings_the_next_batch_until_all_are_in() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::in_memory().unwrap());
        let ads = Arc::new(DemoAds::load(&every_set()).unwrap());
        let clock = clock();
        let mut feed = feed(&ads, &store, clock.clone());
        let ctx = ctx(dir.path());
        let mut came = 0;
        loop {
            let summary = go(&mut feed, &store, RunKind::Fetch, &ctx, &clock).await;
            assert_eq!(summary.outcome, Outcome::Completed);
            let searched: usize = summary.search.unwrap().values().map(|c| c.new).sum();
            let new = summary.scan.unwrap().new + searched;
            if new == 0 {
                break;
            }
            assert!(new <= *BATCH_JOBS.end());
            assert!(
                new >= *BATCH_JOBS.start() || came + new == ads.len(),
                "{new}"
            );
            let fetch = summary.fetch.unwrap();
            let pages: usize = fetch.per_portal.values().map(|p| p.ok + p.teaser).sum();
            assert_eq!(pages, new, "every new ad's page");
            came += new;
        }
        assert_eq!(came, ads.len());
        let jobs = store.jobs(&JobFilter::default()).unwrap();
        assert_eq!(jobs.len(), ads.len());
        for job in &jobs {
            assert!(
                matches!(job.desc_status, DescStatus::Ok | DescStatus::Teaser),
                "{}",
                job.key
            );
            let ad = ads.get(&job.key).unwrap();
            assert_eq!(job.company, ad.company, "the page's company");
            assert!(!job.location.is_empty(), "{}", job.key);
        }
        let matcher = super::super::matcher();
        assert_eq!(store.match_pending(matcher.rev()).unwrap(), 0, "all scored");
        assert!(dir.path().join(RESULT_DIR).join(XLSX_NAME).is_file());
    }

    /// A fetch that reads no mails ("Alert-Mails" off) still hands out the batch: the search
    /// brings its freelancermap ads, and a later fetch with the mails brings the rest.
    #[tokio::test(start_paused = true)]
    async fn a_fetch_without_the_mails_still_finds_through_the_search() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::in_memory().unwrap());
        let ads = Arc::new(DemoAds::load(&every_set()).unwrap());
        let clock = clock();
        let mut feed = feed(&ads, &store, clock.clone());
        let search_only = RunContext {
            read_mail: false,
            ..ctx(dir.path())
        };
        let summary = go(&mut feed, &store, RunKind::Fetch, &search_only, &clock).await;
        assert_eq!(summary.outcome, Outcome::Completed);
        assert!(summary.scan.is_none(), "no mails read");
        let found: usize = summary.search.unwrap().values().map(|c| c.new).sum();
        assert!(found > 0, "the search found the batch's freelancermap ads");
        let batches = received(&store).unwrap();
        assert_eq!(batches.len(), 1, "one batch for the run");
        let with_mails = go(&mut feed, &store, RunKind::Fetch, &ctx(dir.path()), &clock).await;
        assert!(
            with_mails.scan.unwrap().new > 0,
            "the mails come with a later fetch"
        );
    }

    /// "Anzeige laden": the pages of jobs whose fetch did not get to them come on request.
    #[tokio::test(start_paused = true)]
    async fn a_details_run_fetches_the_chosen_ads() {
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(Store::in_memory().unwrap());
        let ads = Arc::new(DemoAds::load(&every_set()).unwrap());
        let clock = clock();
        let mut feed = feed(&ads, &store, clock.clone());
        let mailbox_only = RunContext {
            fetch_portals: Vec::new(),
            ..ctx(dir.path())
        };
        go(&mut feed, &store, RunKind::Fetch, &mailbox_only, &clock).await;
        let keys: Vec<JobKey> = store
            .jobs(&JobFilter::default())
            .unwrap()
            .into_iter()
            .filter(|job| job.desc_status == DescStatus::Missing)
            .map(|job| job.key)
            .collect();
        assert!(BATCH_JOBS.contains(&keys.len()), "{}", keys.len());
        let summary = go(
            &mut feed,
            &store,
            RunKind::Details { keys: keys.clone() },
            &ctx(dir.path()),
            &clock,
        )
        .await;
        assert_eq!(summary.outcome, Outcome::Completed);
        for key in &keys {
            let job = store.job(key).unwrap().unwrap();
            assert_ne!(job.desc_status, DescStatus::Missing, "{key}");
        }
        assert_eq!(
            store.job_count().unwrap(),
            i64::try_from(keys.len()).unwrap()
        );
    }
}
