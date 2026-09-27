//! The browser preview's demo data, computed by the real engine. The preview (`npm run
//! harness`, `tools/ui-preview.cmd`) answers the app's commands from a stub
//! (`tools/ui-harness/stub.ts`); everything the engine computes there - list rows, the reader
//! with its reasons and passages, what the app understood of the profile, the AI prompts -
//! comes from `tools/ui-harness/demo/snapshot.json`, which this test
//! writes from the invented ads of `demo/ads.json` and the invented profile of
//! `demo/profile.json`, with the list rows' matches for a few invented test profiles of
//! `tools/test-profiles/` (the preview's other profiles). So an engine change reaches the
//! preview without mirroring it by hand.
//!
//! Like the generated TypeScript types: the test rewrites the snapshot and fails while the
//! committed file differs (run it again, then commit the file):
//! `cargo test -p jobalert-core --test ui_demo_snapshot`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jiff::{SignedDuration, Timestamp};
use jobalert_core::export::{PromptSource, ai_prompt};
use jobalert_core::model::{AlertMail, Place, Posting};
use jobalert_core::pipeline::{LocalMatcher, Matcher};
use jobalert_core::portal::{JobKey, Portal};
use jobalert_core::settings::Language;
use jobalert_core::store::Store;
use jobalert_core::view::{self, JobQuery, JobSort, JobView};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// The fixed "now" of the preview (`NOW` in stub.ts and in the specs' fixtures).
const NOW: &str = "2026-09-24T07:30:00Z";
/// When the jobs were scored: with the last fetch, an hour ago.
const SCORED_HOURS_AGO: f64 = 1.0;
/// When the profile was saved.
const PROFILE_SAVED_HOURS_AGO: f64 = 72.0;
/// The name of the profile file the preview shows.
const PROFILE_FILE_NAME: &str = "profil-interim-finance.json";
/// The preview's other profiles (`tools/test-profiles/`): the first two are in its work
/// folder from the start, the last is the file "Aus Datei laden" chooses.
const OTHER_PROFILES: [&str; 3] = [
    "sap-fico.json",
    "it-cloud-freelancer.json",
    "ki-automatisierung.json",
];
/// The subject of the demo's alert mails (a mail's own words, German like the portals').
const SUBJECT: &str = "Neue Jobs für Ihr Profil";
/// The Gmail id of the first alert mail (the others count up from it).
const GMAIL_ID: u64 = 0x18c2_f0a9_d1e4_b7a3;

fn demo_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/ui-harness/demo")
}

/// One invented ad of `demo/ads.json` and its state in the demo.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "the flags of a fixture, one JSON field each"
)]
struct Ad {
    portal: String,
    id: String,
    title: String,
    company: String,
    /// As the alert mail says it (a work mode in brackets: "Bremen (Remote)").
    location: String,
    /// When its alert mail came.
    mail_hours_ago: f64,
    /// When the app first saw it (default: with its mail).
    seen_hours_ago: Option<f64>,
    /// `ok` (default), `teaser`, `pending` or `failed`.
    #[serde(default = "ok")]
    detail: String,
    /// Failed attempts of a `failed` detail.
    #[serde(default)]
    attempts: u32,
    /// The ad's text, line by line; of a `pending` or `failed` job the text its page brings
    /// once fetched, of a duplicate none (it has the original's).
    #[serde(default)]
    text: Vec<String>,
    /// The page's text is short (a checked text under 100 characters).
    #[serde(default)]
    short: bool,
    /// The page takes no applications any more.
    #[serde(default)]
    closed: bool,
    #[serde(default)]
    read: bool,
    /// `inbox` (default) or `archive`.
    #[serde(default = "inbox")]
    place: String,
    /// Another portal's announcement of the same ad (`portal:id`): the list shows it as
    /// `alsoOn` of that job.
    duplicate_of: Option<String>,
    /// The job arrives with the preview's scripted fetch.
    #[serde(default)]
    run: bool,
}

fn ok() -> String {
    "ok".into()
}

fn inbox() -> String {
    "inbox".into()
}

/// A job after its page came and the engine scored it.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Fetched {
    job: JobView,
    detail: view::JobDetail,
}

/// Everything the preview shows that the engine computes.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    /// How to regenerate it.
    generated_by: &'static str,
    now: Timestamp,
    /// The list rows of the demo, in the order of `ads.json` (duplicates and the scripted
    /// fetch's jobs left out).
    jobs: Vec<JobView>,
    /// The reader of every job of `jobs` (`portal:id`).
    details: BTreeMap<String, view::JobDetail>,
    /// The scripted fetch's new jobs as their alert mails announce them.
    announced: Vec<JobView>,
    /// Jobs once their page came and the engine scored them (`portal:id`): those whose ad
    /// was still missing ("Anzeige laden") and the scripted fetch's.
    fetched: BTreeMap<String, Fetched>,
    /// The stored profile with what the engine understood of it.
    profile: view::ProfileInfo,
    /// The preview's other profiles ([`OTHER_PROFILES`]).
    profiles: Vec<OtherProfile>,
    /// The AI prompts per language: every job's (`portal:id`, the scripted fetch's once their
    /// page came).
    prompts: BTreeMap<&'static str, BTreeMap<String, String>>,
}

/// Another profile of the preview: what the app shows of it and the engine's match of every
/// listed job with it (`portal:id`), which the list shows once it is the active one.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct OtherProfile {
    file: &'static str,
    profile: view::ProfileInfo,
    matches: BTreeMap<String, Option<view::JobMatch>>,
}

fn now() -> Timestamp {
    NOW.parse().unwrap()
}

fn ago(hours: f64) -> Timestamp {
    #[expect(clippy::cast_possible_truncation, reason = "hours of a fixture")]
    let seconds = (hours * 3600.0).round() as i64;
    now() - SignedDuration::from_secs(seconds)
}

/// The ad's key as the specs name it (the demo's ids are shorter than some portals' real
/// ones, so the key is not read from a link).
fn key_of(ad: &Ad) -> JobKey {
    JobKey {
        portal: Portal::from_key(&ad.portal).unwrap_or_else(|| panic!("portal {}", ad.portal)),
        id: ad.id.clone(),
    }
}

/// Records one ad as its alert mail brought it, with its page unless that comes later
/// (`pending` or `failed`).
fn record(store: &Store, run: i64, ad: &Ad, text: Option<&str>, index: u64) -> JobKey {
    let key = key_of(ad);
    let url = key
        .portal
        .adapter()
        .canonical_url(&key.id)
        .unwrap_or_else(|| panic!("no link for {key}"));
    let mail = ago(ad.mail_hours_ago);
    let seen = ago(ad.seen_hours_ago.unwrap_or(ad.mail_hours_ago));
    let alert = AlertMail {
        key: format!("demo:{key}"),
        portal: key.portal,
        subject: SUBJECT.to_owned(),
        sender: key.portal.label().to_owned(),
        date: Some(mail),
        gmail_id: Some(GMAIL_ID + index),
        postings: vec![Posting::new(
            key.clone(),
            url,
            &ad.title,
            &ad.company,
            &ad.location,
        )],
    };
    store.record_alert(run, &alert, seen).unwrap();
    match (ad.detail.as_str(), text) {
        ("ok", Some(text)) => store
            .record_text(&key, text, ad.short, ad.closed, seen)
            .unwrap(),
        ("teaser", Some(text)) => store.record_teaser(&key, text, seen).unwrap(),
        ("failed", _) => {
            for _ in 0..ad.attempts {
                store.record_failure(&key, "HTTP 503", seen, true).unwrap();
            }
        }
        ("pending", _) => {}
        // The scripted fetch's jobs as their mails announce them: the pages come later.
        (_, None) if ad.run => {}
        (detail, text) => panic!("{key}: detail {detail} with text {}", text.is_some()),
    }
    key
}

fn score(store: &Store, matcher: &LocalMatcher, keys: &[JobKey], at: Timestamp) {
    for key in keys {
        let job = store.job(key).unwrap().unwrap();
        let text = store.description(key).unwrap();
        let judged = matcher.judge(&job, text.as_deref()).unwrap();
        store
            .save_judgements(&[(key.clone(), judged)], matcher.rev(), at)
            .unwrap();
    }
}

fn marks(store: &Store, ad: &Ad, key: &JobKey) {
    let seen = ago(ad.seen_hours_ago.unwrap_or(ad.mail_hours_ago));
    if ad.read {
        store.mark_read(key, seen).unwrap();
    }
    match ad.place.as_str() {
        "inbox" => {}
        "archive" => {
            store
                .move_jobs(std::slice::from_ref(key), Place::Archive, seen)
                .unwrap();
        }
        place => panic!("{key}: place {place}"),
    }
}

fn detail_of(store: &Store, matcher: &LocalMatcher, key: &JobKey) -> view::JobDetail {
    view::job_detail(store, key, Some(matcher), false, now())
        .unwrap()
        .unwrap()
}

fn view_of(store: &Store, key: &JobKey) -> JobView {
    let row = store.job(key).unwrap().unwrap();
    view::job_views(store, std::slice::from_ref(&row))
        .unwrap()
        .pop()
        .unwrap()
}

/// The list rows of every place, by key.
fn rows(store: &Store) -> BTreeMap<String, JobView> {
    let mut rows = BTreeMap::new();
    for place in [Place::Inbox, Place::Archive, Place::Trash] {
        let query = JobQuery {
            place,
            unread: false,
            sort: JobSort::Newest,
            search: None,
            portal: None,
            min_band: None,
            contracts: Vec::new(),
            remote_only: false,
            remote_or_hybrid: false,
            min_day_rate: None,
            min_salary: None,
            deadline_soon: false,
            limit: view::MAX_PAGE,
            offset: 0,
        };
        for job in view::job_page(store, &query).unwrap().jobs {
            rows.insert(job.key.to_string(), job);
        }
    }
    rows
}

/// The languages of the prompts, as the snapshot names them.
const LANGUAGES: [(&str, Language); 2] = [("de", Language::De), ("en", Language::En)];

/// The AI prompt of each job (`portal:id`) in a language.
fn job_prompts(
    store: &Store,
    matcher: &LocalMatcher,
    profile: &Value,
    keys: &[JobKey],
    language: Language,
) -> BTreeMap<String, String> {
    keys.iter()
        .map(|key| {
            let row = store.job(key).unwrap().unwrap();
            let source = PromptSource::load(store, Some(matcher), &row).unwrap();
            (key.to_string(), ai_prompt(profile, source.job(), language))
        })
        .collect()
}

/// The demo's fixtures, its database and the engine with its profile.
struct Demo {
    ads: Vec<Ad>,
    /// The ads' texts by `portal:id`.
    texts: BTreeMap<String, String>,
    profile_text: String,
    profile: Value,
    matcher: LocalMatcher,
    store: Store,
}

impl Demo {
    fn load() -> Demo {
        Demo::with_profile(std::fs::read_to_string(demo_dir().join("profile.json")).unwrap())
    }

    fn with_profile(profile_text: String) -> Demo {
        let dir = demo_dir();
        let ads: Vec<Ad> =
            serde_json::from_str(&std::fs::read_to_string(dir.join("ads.json")).unwrap()).unwrap();
        let texts = ads
            .iter()
            .filter(|ad| !ad.text.is_empty())
            .map(|ad| (format!("{}:{}", ad.portal, ad.id), ad.text.join("\n")))
            .collect();
        let profile: Value = serde_json::from_str(&profile_text).unwrap();
        let matcher = LocalMatcher::from_json(&profile);
        assert!(matcher.usable(), "the demo profile scores");
        Demo {
            ads,
            texts,
            profile_text,
            profile,
            matcher,
            store: Store::in_memory().unwrap(),
        }
    }

    /// The ad's text; a duplicate has the original's.
    fn text_of(&self, ad: &Ad) -> Option<&str> {
        let own = format!("{}:{}", ad.portal, ad.id);
        self.texts
            .get(ad.duplicate_of.as_ref().unwrap_or(&own))
            .map(String::as_str)
    }

    /// The demo before the scripted fetch: every job its mail, its page, its score and its
    /// marks. The listed jobs in the order of the fixtures (no duplicates).
    fn fill(&self) -> Vec<(&Ad, JobKey)> {
        let run = self.store.begin_run().unwrap();
        let mut keys = Vec::new();
        for (index, ad) in (0u64..).zip(&self.ads).filter(|(_, ad)| !ad.run) {
            let key = record(&self.store, run, ad, self.text_of(ad), index);
            if let Some(original) = &ad.duplicate_of {
                let linked = self.store.link_duplicate(&key).unwrap();
                assert_eq!(
                    linked.map(|k| k.to_string()).as_deref(),
                    Some(original.as_str())
                );
            } else {
                keys.push((ad, key));
            }
        }
        let every: Vec<JobKey> = keys.iter().map(|(_, key)| key.clone()).collect();
        score(&self.store, &self.matcher, &every, ago(SCORED_HOURS_AGO));
        for (ad, key) in &keys {
            marks(&self.store, ad, key);
        }
        keys
    }

    /// The stored profile as the app shows it, by the name of its file.
    fn profile_info(&self, file_name: &str) -> view::ProfileInfo {
        let info = jobalert_core::profile::ProfileInfo {
            path: PathBuf::from(jobalert_core::profile::PROFILE_FILE),
            bytes: u64::try_from(self.profile_text.len()).unwrap(),
            saved_at: Some(ago(PROFILE_SAVED_HOURS_AGO)),
            parse_error: None,
        };
        view::ProfileInfo::of(&info, Some(file_name.to_owned()))
            .with_form(jobalert_core::profile::form_of(&self.profile_text))
            .understood_by(&self.matcher, &self.store)
            .unwrap()
    }

    /// The scripted fetch: its jobs as their mails announce them, then their pages and those
    /// of the listed jobs whose details were missing, each scored (a page that does not come
    /// leaves the job to be scored from its mail).
    fn fetch(&self, listed: &[(&Ad, JobKey)]) -> (Vec<JobView>, BTreeMap<String, Fetched>) {
        let run = self.store.begin_run().unwrap();
        let mut announced = Vec::new();
        let mut later = Vec::new();
        for (index, ad) in (0u64..).zip(&self.ads).filter(|(_, ad)| ad.run) {
            let key = record(&self.store, run, ad, None, index);
            announced.push(view_of(&self.store, &key));
            later.push((ad, key));
        }
        later.extend(
            listed
                .iter()
                .filter(|(ad, _)| matches!(ad.detail.as_str(), "pending" | "failed"))
                .map(|(ad, key)| (*ad, key.clone())),
        );
        let mut fetched = BTreeMap::new();
        for (ad, key) in &later {
            if let Some(text) = self.text_of(ad) {
                self.store
                    .record_text(key, text, false, false, now())
                    .unwrap();
            }
            score(&self.store, &self.matcher, std::slice::from_ref(key), now());
            let entry = Fetched {
                job: view_of(&self.store, key),
                detail: detail_of(&self.store, &self.matcher, key),
            };
            fetched.insert(key.to_string(), entry);
        }
        (announced, fetched)
    }
}

/// One of the preview's other profiles, over the demo's listed jobs.
fn other_profile(file: &'static str) -> OtherProfile {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../tools/test-profiles")
        .join(file);
    let demo = Demo::with_profile(std::fs::read_to_string(path).unwrap());
    let listed = demo.fill();
    let rows = rows(&demo.store);
    let matches = listed
        .iter()
        .map(|(_, key)| {
            let key = key.to_string();
            let found = rows.get(&key).and_then(|job| job.match_.clone());
            (key, found)
        })
        .collect();
    OtherProfile {
        file,
        profile: demo.profile_info(file),
        matches,
    }
}

fn snapshot() -> Snapshot {
    let demo = Demo::load();
    let (store, matcher) = (&demo.store, &demo.matcher);
    let listed = demo.fill();
    let keys: Vec<JobKey> = listed.iter().map(|(_, key)| key.clone()).collect();
    let rows = rows(store);
    let jobs = keys
        .iter()
        .map(|key| rows.get(&key.to_string()).cloned().unwrap())
        .collect();
    let details = keys
        .iter()
        .map(|key| (key.to_string(), detail_of(store, matcher, key)))
        .collect();
    let mut prompts = BTreeMap::new();
    for (name, language) in LANGUAGES {
        let texts = job_prompts(store, matcher, &demo.profile, &keys, language);
        prompts.insert(name, texts);
    }
    let profile = demo.profile_info(PROFILE_FILE_NAME);
    let (announced, fetched) = demo.fetch(&listed);
    let arrived: Vec<JobKey> = announced.iter().map(|job| job.key.clone()).collect();
    for (name, language) in LANGUAGES {
        let texts = job_prompts(store, matcher, &demo.profile, &arrived, language);
        prompts.entry(name).or_default().extend(texts);
    }
    Snapshot {
        generated_by: "cargo test -p jobalert-core --test ui_demo_snapshot",
        now: now(),
        jobs,
        details,
        announced,
        fetched,
        profile,
        profiles: OTHER_PROFILES.into_iter().map(other_profile).collect(),
        prompts,
    }
}

/// Writes the snapshot; fails while the committed one differs.
#[test]
fn the_preview_s_demo_data_come_from_the_engine() {
    let path = demo_dir().join("snapshot.json");
    let mut json = serde_json::to_string_pretty(&snapshot()).unwrap();
    json.push('\n');
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    if committed.replace("\r\n", "\n") != json {
        std::fs::write(&path, &json).unwrap();
        panic!(
            "regenerated {} - commit it (the preview's demo data follow the engine)",
            path.display()
        );
    }
}
