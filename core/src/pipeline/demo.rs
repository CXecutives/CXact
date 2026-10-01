//! Dry run: a mailbox and portals to look at - without network, without an account. The run
//! behaves like a real one (pace, events, summary) but writes nothing: database and safety
//! state then only live in memory. The sample mails and ads are German like real ones; the
//! jobs are scored by the real engine against the invented sample profile of the matching
//! corpus, so the list shows real rings (high, mid, low, excluded and one without details).
//!
//! The demo (the `CXact Demo` app, the `--demo` start) keeps a data folder of its own, made
//! anew at every start with an empty inbox and the sample profile; its mailbox and portals
//! ([`feed`]) bring the invented ads of the held-out sets in batches, fetch by fetch.

mod feed;

use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use jiff::civil::Date;
use serde::Deserialize;
use serde_json::Value;
use tokio_util::sync::CancellationToken;

use super::{Backends, LocalMatcher, Matcher};
use crate::fetch::{Cause, PageFetcher, PageOutcome};
use crate::mail::imap::{MailError, MailSource};
use crate::mail::{RawHead, RawMail, head_part};
use crate::portal::{Facts, FetchPath, JobLink, Portal};
use crate::store::Store;
pub use feed::{DemoAds, DemoFeed};

/// The profile of the dry run: the invented interim finance profile of the matching corpus.
pub const PROFILE_JSON: &str = include_str!("../../tests/fixtures/matching/sample_profile.json");
/// File name the dry run shows for it (a name, German like the profile keys).
pub const PROFILE_NAME: &str = "beispielprofil.json";
/// What the demo searches for: the sample profile names no target role, so it gives no search
/// terms of its own.
const DEMO_SEARCH_TERMS: [&str; 2] = ["Interim CFO", "Controlling"];

/// The demo's profile: the sample profile with [`DEMO_SEARCH_TERMS`] (the sample stays as the
/// matching corpus reads it).
pub fn demo_profile() -> String {
    let mut value: Value = serde_json::from_str(PROFILE_JSON).unwrap_or_default();
    if let Some(fields) = value.as_object_mut() {
        fields.insert(
            crate::profile::KEYS_SEARCH_TERMS[0].to_owned(),
            Value::from(DEMO_SEARCH_TERMS.to_vec()),
        );
    }
    serde_json::to_string_pretty(&value).unwrap_or_else(|_| PROFILE_JSON.to_owned())
}

static MATCHER: LazyLock<Arc<LocalMatcher>> = LazyLock::new(|| {
    let value = serde_json::from_str(PROFILE_JSON).unwrap_or_default();
    Arc::new(LocalMatcher::from_json(&value))
});

/// The engine with the sample profile.
pub fn matcher() -> Arc<LocalMatcher> {
    MATCHER.clone()
}

/// Sample alerts per portal (invented companies).
const MAILS: [(Portal, &str, &str, &str); 3] = [
    (
        Portal::LinkedIn,
        "LinkedIn Job Alerts <jobalerts-noreply@linkedin.com>",
        "Interim CFO: 2 neue Jobs in Hamburg",
        r#"<table><tr><td><a href="https://www.linkedin.com/comm/jobs/view/4999000001/">Interim CFO (m/w/d)</a><p>Nordlicht AG · Hamburg</p></td></tr>
           <tr><td><a href="https://www.linkedin.com/comm/jobs/view/4999000002/">Leiter Controlling (m/w/d)</a><p>Hafenwerke GmbH · Bremen (Hybrid)</p></td></tr></table>"#,
    ),
    (
        Portal::Freelancermap,
        "freelancermap <projekte@freelancermap.de>",
        "Neue Projekte für Ihre Suche „SAP“",
        r#"<a href="https://www.freelancermap.de/nproj/2999001.html">SAP FI/CO Berater (m/w/d)</a><br>Ferrum Systems SE<br>Ort: München // Start: ab sofort<br>
           <a href="https://www.freelancermap.de/nproj/2999002.html">Projektleiter S/4HANA</a><br>Nordwind Consulting<br>Ort: Remote"#,
    ),
    (
        Portal::FreelanceDe,
        "freelance.de <info@freelance.de>",
        "Projektvorschläge der Woche",
        r#"<a href="https://www.freelance.de/project/index.php?id=1999001">PMO Manager (m/w/d)</a><br>Projektbüro Nord GmbH<br>Berlin"#,
    ),
];

#[derive(Default)]
pub struct DemoBackends;

impl Backends for DemoBackends {
    type Mail = DemoMail;
    type Pages = DemoPages;

    async fn connect_mail(&mut self, cancel: &CancellationToken) -> Result<DemoMail, MailError> {
        pause(Duration::from_millis(600), cancel).await?;
        Ok(DemoMail {
            cancel: cancel.clone(),
        })
    }

    fn pages(&mut self, _portal: Portal, _path: FetchPath) -> Result<DemoPages, String> {
        Ok(DemoPages)
    }

    fn matcher(&self) -> Option<Arc<dyn Matcher>> {
        Some(matcher())
    }
}

pub struct DemoMail {
    cancel: CancellationToken,
}

impl MailSource for DemoMail {
    async fn search(&mut self, _: Option<Date>, portals: &[Portal]) -> Result<Vec<u32>, MailError> {
        pause(Duration::from_millis(400), &self.cancel).await?;
        Ok(MAILS
            .iter()
            .zip(1u32..)
            .filter(|((portal, ..), _)| portals.contains(portal))
            .map(|(_, uid)| uid)
            .collect())
    }

    async fn heads(&mut self, uids: &[u32]) -> Result<Vec<RawHead>, MailError> {
        pause(Duration::from_millis(100), &self.cancel).await?;
        Ok(uids
            .iter()
            .filter_map(|&uid| {
                Some(RawHead {
                    uid,
                    bytes: head_part(&sample(uid)?.bytes).to_vec(),
                })
            })
            .collect())
    }

    async fn fetch(&mut self, uids: &[u32]) -> Result<Vec<RawMail>, MailError> {
        pause(Duration::from_millis(300), &self.cancel).await?;
        Ok(uids.iter().filter_map(|&uid| sample(uid)).collect())
    }
}

/// Sample mail `uid` (1-based).
fn sample(uid: u32) -> Option<RawMail> {
    let (_, from, subject, html) = MAILS.get(usize::try_from(uid.checked_sub(1)?).ok()?)?;
    // Today's date: the sample jobs always lie within the 30-day window of the fetch.
    let date = jiff::Timestamp::now().strftime("%a, %d %b %Y %H:%M:%S +0000");
    let bytes = format!(
        "From: {from}\r\nSubject: {subject}\r\nDate: {date}\r\n\
         MIME-Version: 1.0\r\nContent-Type: text/html; charset=utf-8\r\n\r\n{html}"
    );
    Some(RawMail {
        gmail_id: Some(0x1990_0000 + u64::from(uid)),
        bytes: bytes.into_bytes(),
    })
}

/// Pages to look at. Between the requests the real pace applies (waits with a countdown);
/// freelance.de answers with a throttle, so that a portal stop can be seen too.
pub struct DemoPages;

impl PageFetcher for DemoPages {
    async fn fetch(&mut self, link: &JobLink, cancel: &CancellationToken) -> PageOutcome {
        if pause(Duration::from_millis(500), cancel).await.is_err() {
            return PageOutcome::Cancelled;
        }
        if link.key.portal == Portal::FreelanceDe {
            return PageOutcome::Throttled {
                cause: Cause::DrySample,
                retry_after: None,
            };
        }
        PageOutcome::Text {
            text: ad(&link.key.id).to_owned(),
            short: false,
            closed: false,
            fields: None,
            facts: crate::portal::Facts::default(),
        }
    }

    /// A search page of Hays holds one project (the app's dry run does not search; tests
    /// of the run do).
    async fn search(
        &mut self,
        portal: Portal,
        _url: &url::Url,
        cancel: &CancellationToken,
    ) -> Result<Vec<crate::portal::Hit>, PageOutcome> {
        if pause(Duration::from_millis(300), cancel).await.is_err() {
            return Err(PageOutcome::Cancelled);
        }
        let Some(link) = (portal == Portal::Hays)
            .then(|| portal.adapter().canonical_url("896260"))
            .flatten()
            .and_then(|url| portal.adapter().job_link(&url))
        else {
            return Ok(Vec::new());
        };
        Ok(vec![crate::portal::Hit {
            link,
            title: "Interim CFO".to_owned(),
            company: String::new(),
            location: "Hamburg".to_owned(),
        }])
    }
}

/// The sample ad of a job: one fits the profile well, one partly, one hardly, one breaks a
/// hard criterion (day rate below the minimum).
fn ad(id: &str) -> &'static str {
    match id {
        "4999000001" => AD_HIGH,
        "4999000002" => AD_MID,
        "2999002" => AD_EXCLUDED,
        _ => AD_LOW,
    }
}

const AD_HIGH: &str = "Beispielanzeige (Probelauf)

Für die Nordlicht AG suchen wir ab sofort einen Interim CFO (m/w/d) für neun Monate.

Aufgaben:
- Leitung von Controlling und Konzernrechnungslegung nach IFRS
- Monatsabschlüsse und Jahresabschlüsse im Konzern
- Budgetierung, Forecast und Liquiditätsplanung
- Begleitung der Restrukturierung

Anforderungen:
- Mehrjährige Erfahrung im Interim Management
- Fundierte Kenntnisse in Konsolidierung und IFRS
- Erfahrung mit SAP S/4HANA
- Sehr gute Deutschkenntnisse und gute Englischkenntnisse

Rahmenbedingungen:
- Tagessatz 1.200 €
- Einsatzort Hamburg, 60 % remote";

const AD_MID: &str = "Beispielanzeige (Probelauf)

Die Hafenwerke GmbH sucht für ein Interim-Mandat von sechs Monaten eine Leitung Controlling (m/w/d).

Aufgaben:
- Führung des Controlling-Teams
- Aufbau eines Hafenlogistik-Controllings

Anforderungen:
- Erfahrung im Controlling
- Erfahrung mit Power BI
- Budgetierung und Forecast
- Kenntnisse in Zollabwicklung
- Erfahrung in der Tarifkalkulation für Terminals
- Staplerschein

Rahmenbedingungen:
- Einsatzort Bremen, zwei Tage remote";

const AD_LOW: &str = "Beispielanzeige (Probelauf)

Für ein Entwicklungsprojekt suchen wir Unterstützung (m/w/d).

Anforderungen:
- ABAP-Entwicklung
- SAP BTP und SAP Fiori
- Schnittstellen mit IDoc und OData
- Erfahrung mit Java und Kubernetes

Rahmenbedingungen:
- Einsatzort München, remote möglich";

const AD_EXCLUDED: &str = "Beispielanzeige (Probelauf)

Für die Einführung von SAP S/4HANA im Finanzbereich suchen wir eine Projektleitung (m/w/d).

Anforderungen:
- Projektmanagement in SAP-Einführungen
- Erfahrung mit SAP S/4HANA und SAP FI/CO
- Prozessoptimierung im Finanzbereich

Rahmenbedingungen:
- Tagessatz bis 800 €
- 100 % remote";

// ---------------------------------------------------------------------- Demo workspace

/// How the app starts, by its arguments: with its own data, as the dry run (`--dry-run`:
/// database and safety state in memory, the fakes above instead of mailbox and portals, no
/// files) or as the demo (`--demo`: a data folder of its own made anew by
/// [`create_demo_data`], a made-up mailbox and portals that bring the bundled ads, [`feed`]).
/// The dry run wins when both are given: it touches nothing at all. Only the exact flags
/// count.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StartMode {
    Normal,
    DryRun,
    Demo,
}

impl StartMode {
    /// The start the arguments ask for (without the program's own name).
    pub fn of<I>(args: I) -> StartMode
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        let (mut dry_run, mut demo) = (false, false);
        for arg in args {
            match arg.as_ref() {
                "--dry-run" => dry_run = true,
                "--demo" => demo = true,
                _ => {}
            }
        }
        if dry_run {
            StartMode::DryRun
        } else if demo {
            StartMode::Demo
        } else {
            StartMode::Normal
        }
    }

    /// The start of the app with this identifier (its Tauri config): the demo build
    /// ([`is_demo_build`], the `CXact Demo` setup) always starts as the demo, unless the dry
    /// run is asked for; any other build as its arguments say ([`StartMode::of`]).
    pub fn of_app<I>(args: I, identifier: &str) -> StartMode
    where
        I: IntoIterator,
        I::Item: AsRef<str>,
    {
        match StartMode::of(args) {
            StartMode::Normal if is_demo_build(identifier) => StartMode::Demo,
            mode => mode,
        }
    }
}

/// The end of the identifier of the demo build (`src-tauri/tauri.demo.conf.json`).
pub const DEMO_BUILD_SUFFIX: &str = ".demo";

/// Is this the identifier of the demo build? Its own identifier gives the demo its own data
/// folder and its own single-instance lock, beside an installed CXact.
pub fn is_demo_build(identifier: &str) -> bool {
    identifier.ends_with(DEMO_BUILD_SUFFIX)
}

/// The mailbox the demo shows and its alert mails are addressed to: invented, on a domain
/// reserved for examples (no real account, never the keychain).
pub const DEMO_ADDRESS: &str = "demo@example.com";

/// The folder of the demo data inside the app's data folder (the `--demo` start): its own
/// database, its own work folder, never the real ones.
pub const DEMO_DIR: &str = "demo";
/// The demo's work folder inside [`DEMO_DIR`].
pub const DEMO_WORKSPACE: &str = "workspace";
/// The ad folders the demo reads, inside the app's resources: the invented ads of the nine
/// held-out sets of the matching fixtures, each with its `jobs.json`. The demo build bundles
/// all of them (`bundle.resources` in `src-tauri/tauri.demo.conf.json`), the app itself sets
/// 8 and 9 (`src-tauri/tauri.conf.json`); a folder that is not there is left out.
pub const DEMO_SOURCES: [&str; 9] = [
    "demo/heldout1",
    "demo/heldout2",
    "demo/heldout3",
    "demo/heldout4",
    "demo/heldout5",
    "demo/heldout6",
    "demo/heldout7",
    "demo/heldout8",
    "demo/heldout9",
];

/// The demo's ad folders in the app's resource folder `resources` (joined part by part: a
/// verbatim Windows path takes no `/`).
pub fn demo_sources(resources: &Path) -> Vec<PathBuf> {
    DEMO_SOURCES
        .iter()
        .map(|dir| {
            dir.split('/')
                .fold(resources.to_path_buf(), |at, part| at.join(part))
        })
        .collect()
}

/// A demo data folder made by [`create_demo_data`].
#[derive(Debug)]
pub struct DemoData {
    /// `<data>/demo`.
    pub dir: PathBuf,
    /// Its database (`<data>/demo/jobs.db`), opened with `Store::open`.
    pub database: PathBuf,
    /// Its work folder, stored in its settings (the profile lies in `profil/`).
    pub workspace: PathBuf,
    /// The ads its mailbox brings, batch by batch ([`DemoFeed`]).
    pub ads: DemoAds,
}

/// One job of a fixture folder's `jobs.json` (the format of the held-out sets).
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FixtureJob {
    file: String,
    url: String,
    title: String,
    company: String,
    location: String,
    desc_status: String,
    facts: Option<Value>,
}

/// Makes a fresh demo data folder `<data_dir>/demo`: a new database without any job (an
/// empty inbox, no fetch yet) whose settings name its own work folder, emptied first (a
/// profile, the Excel and CSV files of an earlier demo go); `profile` (a profile's JSON) is
/// written there as its profile. Reads the ads of the fixture folders (`sources`,
/// [`DemoAds::load`]) that its mailbox brings fetch by fetch. The real database, the real
/// work folder, a mailbox and every portal stay untouched: the function reads the fixtures
/// and writes below `<data_dir>/demo` only, anew on every call.
pub fn create_demo_data(
    data_dir: &Path,
    sources: &[PathBuf],
    profile: Option<&str>,
) -> crate::Result<DemoData> {
    create_demo_data_with(data_dir, DemoAds::load(sources)?, profile)
}

/// [`create_demo_data`] with ads already read (the ones built into the CXact Demo exe).
pub fn create_demo_data_with(
    data_dir: &Path,
    ads: DemoAds,
    profile: Option<&str>,
) -> crate::Result<DemoData> {
    let dir = data_dir.join(DEMO_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| crate::Error::io(&dir, e))?;
    let database = dir.join(crate::DB_FILE);
    for suffix in ["", "-wal", "-shm"] {
        let file = PathBuf::from(format!("{}{suffix}", database.display()));
        match std::fs::remove_file(&file) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
                return Err(crate::Error::io(&file, e));
            }
            _ => {}
        }
    }
    let workspace = dir.join(DEMO_WORKSPACE);
    // A file of it still open elsewhere (the Excel file) stays: the demo starts anyway.
    match std::fs::remove_dir_all(&workspace) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => {
            log::warn!("demo: the work folder was not emptied ({e})");
        }
        _ => {}
    }
    std::fs::create_dir_all(&workspace).map_err(|e| crate::Error::io(&workspace, e))?;
    if let Some(profile) = profile {
        let target = workspace
            .join(crate::profile::PROFILE_DIR)
            .join(crate::profile::PROFILE_FILE);
        crate::export::ensure_dir(target.parent().unwrap_or(&workspace))?;
        std::fs::write(&target, profile).map_err(|e| crate::Error::io(&target, e))?;
    }
    let store = Store::open(&database)?;
    let settings = crate::settings::Settings {
        workspace: Some(workspace.clone()),
        ..crate::settings::Settings::default()
    };
    settings.save(&store)?;
    Ok(DemoData {
        dir,
        database,
        workspace,
        ads,
    })
}

/// The ad text of a file in the text contract format: what follows its head (the lines up to
/// the first empty one).
fn ad_body(text: &str) -> &str {
    let text = text.trim_start_matches('\u{feff}');
    text.find("\n\n")
        .map(|at| at + 2)
        .or_else(|| text.find("\r\n\r\n").map(|at| at + 4))
        .map_or(text, |start| &text[start..])
        .trim()
}

/// A fixture's facts (the engine's words: `rate`, `hourly`, `currency`, `start`, `months`,
/// `remoteFrom`, `contract`) as the facts a job page states, in a page's own words, so the
/// engine reads them as it reads a real page. `None` without any.
fn page_facts(value: &Value) -> Option<Facts> {
    let int = |key: &str| value.get(key).and_then(Value::as_u64);
    let text = |key: &str| value.get(key).and_then(Value::as_str);
    // A page's words, German like the portals' (external data, do not translate).
    let rate = int("rate").map(|rate| {
        let currency = text("currency").unwrap_or("€");
        if value.get("hourly").and_then(Value::as_bool) == Some(true) {
            format!("{rate} {currency}/h")
        } else {
            format!("{rate} {currency} pro Tag")
        }
    });
    let start = text("start").map(|start| match start {
        "now" => "ab sofort".to_owned(),
        "vague" => "nach Absprache".to_owned(),
        day => day
            .parse::<jiff::civil::Date>()
            .map_or_else(|_| day.to_owned(), |d| d.strftime("%d.%m.%Y").to_string()),
    });
    let employment_type = text("contract").and_then(|contract| match contract {
        "interim" => Some("Freiberuflich".to_owned()),
        "permanent" => Some("Festanstellung".to_owned()),
        "anue" => Some("Arbeitnehmerüberlassung".to_owned()),
        _ => None,
    });
    let facts = Facts {
        rate,
        start,
        duration: int("months").map(|months| format!("{months} Monate")),
        remote_percent: int("remoteFrom").and_then(|p| u8::try_from(p).ok()),
        employment_type,
        ..Facts::default()
    };
    (!facts.is_empty()).then_some(facts)
}

async fn pause(length: Duration, cancel: &CancellationToken) -> Result<(), MailError> {
    if crate::time::sleep_cancellable(length, cancel).await {
        Ok(())
    } else {
        Err(MailError::Cancelled)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::{self, JobInput, TextKind, Verdict};
    use crate::model::{Band, band};

    /// Fixture folders of the matching sets, by name.
    fn fixtures(sets: &[&str]) -> Vec<PathBuf> {
        sets.iter()
            .map(|set| {
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("tests/fixtures/matching")
                    .join(set)
            })
            .collect()
    }

    /// The demo data folder: a fresh database of its own below `<data>/demo` without any job
    /// and without a fetch (an empty inbox), its own work folder with the sample profile, and
    /// the ads its mailbox brings; the real database beside it stays as it was, and a second
    /// call starts anew.
    #[test]
    fn the_demo_data_stand_apart_and_start_empty() {
        let data = tempfile::tempdir().unwrap();
        let real = data.path().join(crate::DB_FILE);
        let store = Store::open(&real).unwrap();
        store.kv_set("mine", "1").unwrap();
        drop(store);
        let before = std::fs::read(&real).unwrap();
        let sources = fixtures(&["heldout8"]);
        let demo = create_demo_data(data.path(), &sources, Some(PROFILE_JSON)).unwrap();
        assert_eq!(demo.dir, data.path().join(DEMO_DIR));
        assert_eq!(demo.ads.len(), 64, "every ad of the set");
        assert_eq!(
            std::fs::read(&real).unwrap(),
            before,
            "the real database untouched"
        );
        let store = Store::open(&demo.database).unwrap();
        assert_eq!(store.kv_get("mine").unwrap(), None);
        let settings = crate::settings::Settings::load(&store).unwrap();
        assert_eq!(
            settings.workspace.as_deref(),
            Some(demo.workspace.as_path())
        );
        let profile = demo.workspace.join("profil").join("beraterprofil.json");
        assert_eq!(std::fs::read_to_string(&profile).unwrap(), PROFILE_JSON);
        assert_eq!(store.job_count().unwrap(), 0, "an empty inbox");
        assert!(!super::super::has_completed_fetch(&store));
        std::fs::write(demo.workspace.join("JobAlerts.csv"), "old").unwrap();
        drop(store);
        // Anew on every call: the files and the profile of the last demo go (none asked for).
        let again = create_demo_data(data.path(), &sources, None).unwrap();
        assert!(!again.workspace.join("profil").exists());
        assert!(!again.workspace.join("JobAlerts.csv").exists());
    }

    /// The demo never is the real data: its folder, database and work folder lie inside
    /// `<data>/demo`, none of them is the data folder or its database. A set that is not
    /// bundled is left out.
    #[test]
    fn the_demo_is_never_the_real_data_folder() {
        let data = tempfile::tempdir().unwrap();
        let sources = fixtures(&["heldout8", "heldout9", "not-bundled"]);
        let demo = create_demo_data(data.path(), &sources, None).unwrap();
        let real = data.path().join(crate::DB_FILE);
        for path in [&demo.dir, &demo.database, &demo.workspace] {
            assert_ne!(path.as_path(), data.path());
            assert_ne!(path, &real);
            assert!(path.starts_with(data.path().join(DEMO_DIR)), "{path:?}");
        }
        assert!(!real.exists(), "no real database made");
        assert_eq!(
            demo.ads.len(),
            159,
            "both sets the app bundles (one job in both)"
        );
    }

    /// Only the exact flags choose the start; the dry run wins over the demo. The demo build
    /// starts as the demo whatever else is asked, except for the dry run.
    #[test]
    fn the_arguments_choose_the_start() {
        let none: [&str; 0] = [];
        assert_eq!(StartMode::of(none), StartMode::Normal);
        assert_eq!(StartMode::of(["--demo"]), StartMode::Demo);
        assert_eq!(StartMode::of(["--devtools", "--demo"]), StartMode::Demo);
        assert_eq!(StartMode::of(["--dry-run"]), StartMode::DryRun);
        assert_eq!(StartMode::of(["--demo", "--dry-run"]), StartMode::DryRun);
        assert_eq!(
            StartMode::of(["demo", "--demo=1", "--DEMO", "-demo"]),
            StartMode::Normal
        );
        let app = "de.cxecutives.job-alert-monitor";
        let demo = "de.cxecutives.job-alert-monitor.demo";
        assert_eq!(StartMode::of_app(none, app), StartMode::Normal);
        assert_eq!(StartMode::of_app(["--demo"], app), StartMode::Demo);
        assert_eq!(StartMode::of_app(none, demo), StartMode::Demo);
        assert_eq!(StartMode::of_app(["--devtools"], demo), StartMode::Demo);
        assert_eq!(StartMode::of_app(["--dry-run"], demo), StartMode::DryRun);
        assert_eq!(
            StartMode::of_app(none, "de.cxecutives.job-alert-monitor.demonstration"),
            StartMode::Normal
        );
    }

    /// A Tauri config file of the app.
    fn config(name: &str) -> Value {
        let path = Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri")
            .join(name);
        serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap()
    }

    /// Does `config` bundle the ads of the demo folder `dir` (its `jobs.json` and its texts,
    /// from the matching fixtures of the same name)?
    fn bundles(config: &Value, dir: &str) -> bool {
        let set = dir.rsplit('/').next().unwrap();
        let from = format!("../core/tests/fixtures/matching/{set}");
        let resources = &config["bundle"]["resources"];
        resources[format!("{from}/jobs.json")] == *format!("{dir}/jobs.json")
            && resources[format!("{from}/*.txt")] == *format!("{dir}/")
    }

    /// The demo build (`npx tauri build --config src-tauri/tauri.demo.conf.json`) is the setup
    /// "CXact Demo": an identifier of its own that marks it as the demo build (its own data
    /// folder), a program file of its own (its setup never closes a running CXact) and no
    /// installer hook (it never removes another install); it bundles every folder of
    /// [`DEMO_SOURCES`]. The app itself is no demo build and keeps sets 8 and 9 for `--demo`.
    #[test]
    fn the_demo_build_carries_every_set() {
        let (app, demo) = (config("tauri.conf.json"), config("tauri.demo.conf.json"));
        let identifier = demo["identifier"].as_str().unwrap();
        assert!(is_demo_build(identifier), "{identifier}");
        assert!(!is_demo_build(app["identifier"].as_str().unwrap()));
        assert_eq!(demo["productName"], "CXact Demo");
        assert!(demo["mainBinaryName"].is_string());
        assert_ne!(demo["mainBinaryName"], "job-alert-monitor");
        let nsis = demo["bundle"]["windows"]["nsis"].as_object().unwrap();
        assert_eq!(nsis.get("installerHooks"), Some(&Value::Null));
        for dir in DEMO_SOURCES {
            assert!(bundles(&demo, dir), "{dir}");
            let set = dir.rsplit('/').next().unwrap();
            assert!(fixtures(&[set])[0].join("jobs.json").is_file(), "{set}");
        }
        for dir in ["demo/heldout8", "demo/heldout9"] {
            assert!(bundles(&app, dir), "{dir}");
        }
        let resources = Path::new("C:/App/resources");
        let sources = demo_sources(resources);
        assert_eq!(sources.len(), DEMO_SOURCES.len());
        assert_eq!(sources[0], resources.join("demo").join("heldout1"));
        assert_eq!(sources[8], resources.join("demo").join("heldout9"));
    }

    #[test]
    fn a_fixture_s_facts_read_like_a_page() {
        let facts = page_facts(&serde_json::json!({"rate": 95, "hourly": true,
            "start": "2026-11-02", "months": 9, "remoteFrom": 20, "contract": "interim"}))
        .unwrap();
        assert_eq!(facts.rate.as_deref(), Some("95 €/h"));
        assert_eq!(facts.start.as_deref(), Some("02.11.2026"));
        assert_eq!(facts.duration.as_deref(), Some("9 Monate"));
        assert_eq!(facts.remote_percent, Some(20));
        assert_eq!(facts.employment_type.as_deref(), Some("Freiberuflich"));
        assert_eq!(page_facts(&serde_json::json!({"rate": null})), None);
        assert_eq!(ad_body("Titel: A\nOrt: B\n\nDer Text.\n"), "Der Text.");
    }

    /// The demo searches with its own terms; the sample profile of the corpus has none.
    #[test]
    fn the_demo_profile_searches() {
        let form = crate::profile::form_of(&demo_profile()).unwrap();
        assert_eq!(form.search_terms, DEMO_SEARCH_TERMS);
        let sample = crate::profile::form_of(PROFILE_JSON).unwrap();
        assert!(
            sample.search_terms.is_empty(),
            "the corpus profile stays as it is"
        );
    }

    /// The sample ads give every ring the list knows, judged by the real engine.
    #[test]
    fn the_sample_ads_show_every_ring() {
        let matcher = matcher();
        assert!(matcher.usable());
        let judge = |id: &str, title: &str, location: &str| {
            let job = JobInput {
                title,
                company: "Muster AG",
                location,
                portal: Portal::LinkedIn,
                text: ad(id),
                facts: None,
                posted: None,
                kind: TextKind::Full,
            };
            let a = matching::assess(matcher.profile(), &job, None).unwrap();
            (a.verdict, band(a.score))
        };
        assert_eq!(
            judge("4999000001", "Interim CFO (m/w/d)", "Hamburg"),
            (Verdict::Scored, Band::High)
        );
        assert_eq!(
            judge(
                "4999000002",
                "Leiter Controlling (m/w/d)",
                "Bremen (Hybrid)"
            ),
            (Verdict::Scored, Band::Mid)
        );
        assert_eq!(
            judge("2999001", "SAP FI/CO Berater (m/w/d)", "München"),
            (Verdict::Scored, Band::Low)
        );
        assert_eq!(
            judge("2999002", "Projektleiter S/4HANA", "Remote").0,
            Verdict::Excluded
        );
    }
}
