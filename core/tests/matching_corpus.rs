//! The synthetic matching corpus (`core/tests/fixtures/matching`).
//!
//! - Hygiene: no fixture is ignored by git (the repository is public, fixtures must ship).
//! - Gates of the engine: decided exclusions and status exactly as in `corpus.json`,
//!   expected checks raised, `mustOpen` items never met; a golden digest of all corpus
//!   results (same on Windows and macOS) and the speed budget (release builds, on held-out
//!   ads of real length). Expectations written for a later engine (`since`, `profileSince` in
//!   `corpus.json`) are gated from that `ENGINE_VERSION` on.

mod common;
#[allow(dead_code)]
#[path = "../examples/common/gold.rs"]
mod gold;

use std::fmt::Write as _;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;

use jobalert_core::matching::{
    Assessment, JobInput, ReasonCode, ReasonKind, TextKind, Verdict, Weight, assess,
    compile_profile,
};
use jobalert_core::portal::Portal;
use jobalert_core::profile::{ProfileForm, WorkWish, parse};
use serde_json::Value;
use sha2::Digest as _;

/// The file of the SHA-256 (16 hex) over every profile x job result of the corpus, in
/// `tests/fixtures/matching` (`npm run gen` writes it). Update it only together
/// with `ENGINE_VERSION` and the measurements in `docs/MATCHING.md`. Version 11 (the
/// excluded permanent employment, a key no corpus profile sets) changed only the version
/// line: with `engine 10` in front the rows still give the version-10 value
/// `6e4d9945276f410c`. Version 17 (the deadline and the contact, no score moved) changed only
/// the version line too: with `engine 16` in front the rows give `501e5e88adf66bd7`. Version
/// 18: K47 and K51 of senior and wish are scored (the years below the profile's never exclude),
/// no score moved. Version 19: the profiles are Profil-JSON v19 (migrated), the region of
/// permanent roles is no rule (K33 and K43 of senior and wish), a table of role names; the
/// function words and generic activity words of the gap finder (K12 of five profiles); a
/// title that meets a target role or names a Schwerpunkt is not off the field (wish K55).
/// Version 20: no Schwerpunkte (the owner's decision of 2026-10-10). Version 21: the
/// industries are experience, no wish (the owner's decision of 2026-10-10); a target role's
/// contract word costs nothing where the profile allows the ad's contract type (wish K42).
/// Version 22: the aggregation repaired (one must, saturating musts, a fixed relevance share,
/// a prior from the title, tools half); every exclusion, status and band row holds. Version
/// 23: the frame of the title (levels, fields), the half way pads; the rows hold again.
/// Version 24: the learned scorer in place of the hand formula, a target role lifts no
/// off-field cap, salary headings and lower bounds far below the minimum; the corpus's band,
/// status and exclusion checks hold. Version 25: the Passungsgrad (content x frame factor,
/// then the caps) in place of the learned scorer, and the rubric's rules: a short ad is judged
/// from its title (K38 of fin, senior and wish are scored), an industry costs little (rule
/// 5), a similar tool is met in part (rule 3); the status, exclusion and check rows hold, the
/// bands are the report's. Then `UNNAMED` 700 (rule 8: a short list of other musts counts as
/// the role does) and a specialist offered as an employment is a rung below a lead. Then the
/// causes of held-out sets 1 and 6: a nice cue after a comma makes only its clause nice, a
/// field word is no industry, a must naming the title's field word stands on the core, general
/// business work shows no field, a compound of another field fits a title in half. Version 26
/// (the revision carries the engine's fingerprint) changed only the version line: with
/// `engine 25` in front the rows still give `106934c7fafea2b3`.
const GOLDEN_DIGEST: &str = "golden_digest.txt";

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/matching")
}

fn read_json(path: &Path) -> Value {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn read_profile(path: &Path) -> ProfileForm {
    let text = std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    parse(&text).unwrap_or_else(|e| panic!("{}: {e:?}", path.display()))
}

/// The engine on local private ads: no panic, one line per job.
/// `JOBALERT_LOCAL_DIR=DIR cargo test -p jobalert-core --test matching_corpus -- --ignored engine_on_local`
#[test]
#[ignore = "needs local private data"]
fn engine_on_local_data() {
    let dir = std::env::var("JOBALERT_LOCAL_DIR").expect("set JOBALERT_LOCAL_DIR");
    let root = fixtures();
    let (corpus, _) = corpus();
    for name in corpus["profiles"]
        .as_object()
        .expect("profiles")
        .values()
        .filter_map(Value::as_str)
    {
        let profile = compile_profile(&read_profile(&root.join(name)));
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .expect("folder")
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.extension().is_some_and(|e| e == "txt"))
            .collect();
        files.sort();
        for (index, path) in files.iter().enumerate() {
            let content = std::fs::read_to_string(path).expect("job file");
            let file = parse_job_file(&content);
            let input = JobInput {
                title: &file.title,
                company: &file.company,
                location: &file.location,
                portal: Portal::LinkedIn,
                text: &file.text,
                facts: None,
                posted: None,
                kind: TextKind::Full,
            };
            let assessment = assess(&profile, &input);
            let verdict = assessment.as_ref().map(|a| code_of_verdict(a.verdict));
            println!(
                "{name} #{index}: {:?} {verdict:?}",
                assessment.map(|a| a.score)
            );
        }
    }
}

#[test]
fn no_fixture_is_ignored_by_git() {
    let root = fixtures();
    let mut paths = Vec::new();
    let mut stack = vec![root.clone()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir).expect("fixture dir") {
            let path = entry.expect("entry").path();
            if path.is_dir() {
                stack.push(path);
            } else {
                paths.push(path);
            }
        }
    }
    assert!(paths.len() >= 50, "fixtures found: {}", paths.len());
    let output = Command::new("git")
        .arg("check-ignore")
        .arg("--no-index")
        .args(&paths)
        .current_dir(&root)
        .output();
    let Ok(output) = output else {
        eprintln!("git not available; skipped");
        return;
    };
    let ignored = String::from_utf8_lossy(&output.stdout);
    assert!(
        ignored.trim().is_empty(),
        "fixtures ignored by git:\n{ignored}"
    );
}

// --- gates of the engine ---------------------------------------------------------

/// Expectation of one job for one profile (`corpus.json`).
struct Expect {
    band: (u8, u8),
    status: String,
    violations: Vec<String>,
    checks: Vec<String>,
    must_open: Vec<String>,
}

/// One corpus job with its expectations per profile key (`fin`, `it`, `senior`, `sap`).
struct CorpusJob {
    id: String,
    /// First `ENGINE_VERSION` whose gates check this job.
    since: u32,
    file: JobFile,
    portal: Portal,
    mail_date: Option<jiff::civil::Date>,
    kind: TextKind,
    facts: Value,
    expect: Vec<(String, Expect)>,
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect()
        })
        .unwrap_or_default()
}

fn corpus() -> (Value, Vec<CorpusJob>) {
    let root = fixtures();
    let corpus = read_json(&root.join("corpus.json"));
    let jobs = corpus["jobs"]
        .as_array()
        .expect("jobs")
        .iter()
        .map(|job| {
            let id = job["id"].as_str().expect("id").to_owned();
            let content = std::fs::read_to_string(root.join("corpus").join(format!("{id}.txt")))
                .expect("job file");
            let file = parse_job_file(&content);
            let expect = job["expect"]
                .as_object()
                .expect("expect")
                .iter()
                .map(|(key, e)| {
                    let band = e["band"].as_array().expect("band");
                    let bound =
                        |i: usize| u8::try_from(band[i].as_u64().expect("bound")).expect("0-100");
                    let expect = Expect {
                        band: (bound(0), bound(1)),
                        status: e["status"].as_str().expect("status").to_owned(),
                        violations: strings(&e["violations"]),
                        checks: strings(&e["checks"]),
                        must_open: strings(&e["mustOpen"]),
                    };
                    (key.clone(), expect)
                })
                .collect();
            CorpusJob {
                file,
                portal: Portal::from_key(job["portal"].as_str().expect("portal"))
                    .expect("portal key"),
                mail_date: job["mailDate"].as_str().and_then(|d| d.parse().ok()),
                kind: if job["kind"] == "teaser" {
                    TextKind::Teaser
                } else {
                    TextKind::Full
                },
                facts: job["facts"].clone(),
                expect,
                since: since(&job["since"]),
                id,
            }
        })
        .collect();
    (corpus, jobs)
}

/// A gate version (`since`); missing = the first gated engine.
fn since(value: &Value) -> u32 {
    value
        .as_u64()
        .and_then(|v| u32::try_from(v).ok())
        .unwrap_or(2)
}

/// A job description file: header lines (`Titel:`, `Unternehmen:`, `Ort:`), a blank line,
/// the text.
struct JobFile {
    title: String,
    company: String,
    location: String,
    text: String,
}

fn parse_job_file(content: &str) -> JobFile {
    let (header, body) = content.split_once("\n\n").unwrap_or((content, ""));
    let field = |name: &str| {
        header
            .lines()
            .find_map(|l| l.strip_prefix(name).map(|v| v.trim().to_owned()))
            .unwrap_or_default()
    };
    JobFile {
        title: field("Titel:"),
        company: field("Unternehmen:"),
        location: field("Ort:"),
        text: body.trim().to_owned(),
    }
}

/// Score the gates compare: 0 when the engine showed no score.
fn effective(assessment: Option<&Assessment>) -> u8 {
    match assessment {
        Some(a) if a.verdict != Verdict::Unscorable => a.score,
        _ => 0,
    }
}

fn code(code: ReasonCode) -> String {
    serde_json::to_value(code)
        .expect("code")
        .as_str()
        .expect("string")
        .to_owned()
}

/// The results per (profile key, job id).
struct Run {
    rows: Vec<Row>,
}

struct Row {
    profile: String,
    job: String,
    expect_band: (u8, u8),
    expect_status: String,
    expect_violations: Vec<String>,
    expect_checks: Vec<String>,
    must_open: Vec<String>,
    new: Option<Assessment>,
    /// The gates check this row (its expectations are for this engine or an older one).
    gated: bool,
}

fn run() -> Run {
    run_with(|_, profile| profile)
}

/// The corpus with every profile passed through `prepare` (profile key, profile).
fn run_with(prepare: impl Fn(&str, ProfileForm) -> ProfileForm) -> Run {
    let root = fixtures();
    let (corpus, jobs) = corpus();
    let mut rows = Vec::new();
    for (key, file) in corpus["profiles"].as_object().expect("profiles") {
        let file = file.as_str().expect("profile file");
        let profile_since = since(&corpus["profileSince"][key]);
        let profile = compile_profile(&prepare(key, read_profile(&root.join(file))));
        for job in &jobs {
            let input = JobInput {
                title: &job.file.title,
                company: &job.file.company,
                location: &job.file.location,
                portal: job.portal,
                text: &job.file.text,
                facts: (!job.facts.is_null()).then_some(&job.facts),
                posted: job.mail_date,
                kind: job.kind,
            };
            let new = assess(&profile, &input);
            let (_, expect) = job
                .expect
                .iter()
                .find(|(k, _)| k == key)
                .expect("expectation");
            rows.push(Row {
                profile: key.clone(),
                job: job.id.clone(),
                expect_band: expect.band,
                expect_status: expect.status.clone(),
                expect_violations: expect.violations.clone(),
                expect_checks: expect.checks.clone(),
                must_open: expect.must_open.clone(),
                new,
                gated: profile_since.max(job.since) <= jobalert_core::matching::ENGINE_VERSION,
            });
        }
    }
    Run { rows }
}

#[test]
fn decided_exclusions_are_exactly_the_expected_ones() {
    let run = run();
    let mut wrong = Vec::new();
    for row in run.rows.iter().filter(|r| r.gated) {
        let Some(new) = &row.new else { continue };
        let mut actual: Vec<String> = new
            .reasons
            .iter()
            .filter(|r| r.kind == ReasonKind::Violation)
            .map(|r| code(r.code))
            .collect();
        actual.sort();
        let mut expected = row.expect_violations.clone();
        expected.sort();
        let status = code_of_verdict(new.verdict);
        if actual != expected || status != row.expect_status {
            wrong.push(format!(
                "{} {}: {status} {actual:?}, expected {} {expected:?}",
                row.profile, row.job, row.expect_status
            ));
        }
    }
    assert!(
        wrong.is_empty(),
        "decided exclusions differ:\n{}",
        wrong.join("\n")
    );
}

#[test]
fn checks_and_open_musts_match_the_expectations() {
    let run = run();
    let mut wrong = Vec::new();
    for row in run.rows.iter().filter(|r| r.gated) {
        let Some(new) = &row.new else { continue };
        let checks: Vec<String> = new
            .reasons
            .iter()
            .filter(|r| r.kind == ReasonKind::Check)
            .map(|r| code(r.code))
            .collect();
        for expected in &row.expect_checks {
            if !checks.contains(expected) {
                wrong.push(format!(
                    "{} {}: check {expected} missing",
                    row.profile, row.job
                ));
            }
        }
        for open in &row.must_open {
            let needle = open.to_lowercase();
            let met = new.reasons.iter().any(|r| {
                r.kind == ReasonKind::Met
                    && r.weight == Weight::Must
                    && r.label
                        .as_deref()
                        .is_some_and(|l| l.to_lowercase().contains(&needle))
            });
            if met {
                wrong.push(format!(
                    "{} {}: '{open}' counted as met",
                    row.profile, row.job
                ));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

/// One line of a digest: verdict, score, must counts, highlights and every reason.
fn digest_line(canonical: &mut String, row: &Row) {
    let Some(a) = &row.new else {
        let _ = writeln!(canonical, "{} {} none", row.profile, row.job);
        return;
    };
    let codes: Vec<String> = a
        .reasons
        .iter()
        .map(|r| format!("{}:{}", code(r.code), code_of_kind(r.kind)))
        .collect();
    let _ = writeln!(
        canonical,
        "{} {} {} {} {}/{}/{} {}",
        row.profile,
        row.job,
        code_of_verdict(a.verdict),
        a.score,
        a.summary.must_met,
        a.summary.must_total,
        a.highlights.len(),
        codes.join(",")
    );
}

/// The first 16 hex characters of the SHA-256 of `canonical`.
fn hex16(canonical: &str) -> String {
    let digest = sha2::Sha256::digest(canonical.as_bytes());
    digest.iter().take(8).fold(String::new(), |mut s, b| {
        let _ = write!(s, "{b:02x}");
        s
    })
}

#[test]
fn golden_digest_of_all_corpus_results() {
    let run = run();
    let mut canonical = format!("engine {}\n", jobalert_core::matching::ENGINE_VERSION);
    for row in &run.rows {
        digest_line(&mut canonical, row);
    }
    let hex = hex16(&canonical);
    let path = fixtures().join(GOLDEN_DIGEST);
    if let Err(stale) = jobalert_core::export::generated::write(&path, &format!("{hex}\n")) {
        panic!("corpus results changed: {stale}\n{canonical}");
    }
}

/// The target role and the wishes never lift a job into the high band (80) while fewer
/// than half of its musts are met: every corpus row against the same profile without them.
#[test]
fn wishes_never_lift_a_weak_job_into_the_high_band() {
    let with = run();
    let without = run_with(|_, mut profile| {
        profile.roles.clear();
        profile.day_rate_wish = None;
        profile.work_mode = WorkWish::Any;
        profile.regions.clear();
        profile
    });
    let mut lifted = 0;
    let mut failures = Vec::new();
    for (row, base) in with.rows.iter().zip(&without.rows) {
        assert_eq!((&row.profile, &row.job), (&base.profile, &base.job));
        let (Some(new), Some(old)) = (&row.new, &base.new) else {
            continue;
        };
        if new.verdict != Verdict::Scored || new.score <= old.score {
            continue;
        }
        lifted += 1;
        let s = &new.summary;
        if new.score >= 80 && old.score < 80 && 2 * s.must_met < s.must_total {
            failures.push(format!(
                "{} {}: {} -> {} with {} of {} musts",
                row.profile, row.job, old.score, new.score, s.must_met, s.must_total
            ));
        }
    }
    assert!(lifted > 0, "no row is lifted: the test checks nothing");
    assert!(failures.is_empty(), "{failures:#?}");
}

fn code_of_kind(kind: ReasonKind) -> String {
    serde_json::to_value(kind)
        .expect("kind")
        .as_str()
        .expect("string")
        .to_owned()
}

/// The held-out sets the speed budget is measured on: ads of real length (portal pages with
/// their details) and profiles that set every wish and exclusion words.
const SPEED_SETS: &[&str] = &["heldout9", "heldout10"];
/// Jobs of one timed run.
const SPEED_JOBS: usize = 2000;
/// The timed ads are at least this long in the median (characters): the corpus's own ads are
/// short cases and would hide what a real ad costs.
const REAL_AD_CHARS: usize = 1500;

/// One ad of a speed set: its job and what it hands the engine besides.
struct SpeedAd {
    job: gold::GoldJob,
    portal: Portal,
    body: String,
    posted: Option<jiff::civil::Date>,
}

impl SpeedAd {
    fn input(&self) -> JobInput<'_> {
        JobInput {
            title: &self.job.title,
            company: &self.job.company,
            location: &self.job.location,
            portal: self.portal,
            text: &self.body,
            facts: self.job.facts.as_ref(),
            posted: self.posted,
            kind: if self.job.is_teaser() {
                TextKind::Teaser
            } else {
                TextKind::Full
            },
        }
    }
}

/// Median <= 0.5 ms per job and 2000 jobs <= 3 s (engine part; measured in release builds,
/// CI runs it there): every profile of [`SPEED_SETS`] against every ad of its set.
#[test]
fn engine_is_fast_enough() {
    if cfg!(debug_assertions) {
        eprintln!("speed budget is checked in release builds only");
        return;
    }
    let mut profiles = Vec::new();
    let mut ads = Vec::new();
    let mut pairs = Vec::new();
    for set in SPEED_SETS {
        let dir = fixtures().join(set);
        let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
            .expect("set dir")
            .map(|e| e.expect("entry").path())
            .filter(|p| p.extension().is_some_and(|x| x == "json"))
            .filter(|p| {
                p.file_name()
                    .is_some_and(|n| n.to_string_lossy().starts_with('P'))
            })
            .collect();
        files.sort();
        let first = profiles.len();
        profiles.extend(files.iter().map(|p| compile_profile(&read_profile(p))));
        for job in gold::read_jobs(&dir.join("jobs.json")).expect("jobs.json") {
            let content = std::fs::read_to_string(dir.join(job.txt_name())).expect("job file");
            let posted = job
                .mail_date
                .as_deref()
                .unwrap_or(&job.first_seen_at)
                .parse::<jiff::Timestamp>()
                .ok()
                .map(|t| t.to_zoned(jiff::tz::TimeZone::UTC).date());
            let ad = ads.len();
            ads.push(SpeedAd {
                portal: Portal::from_key(&job.portal).expect("portal"),
                body: gold::parse_txt(&content).body,
                posted,
                job,
            });
            pairs.extend((first..profiles.len()).map(|profile| (profile, ad)));
        }
    }
    let mut lengths: Vec<usize> = ads.iter().map(|a| a.body.chars().count()).collect();
    lengths.sort_unstable();
    let length = lengths[lengths.len() / 2];
    assert!(length >= REAL_AD_CHARS, "median ad of {length} characters");
    let mut times = Vec::with_capacity(SPEED_JOBS);
    let started = Instant::now();
    for i in 0..SPEED_JOBS {
        let (profile, ad) = pairs[i % pairs.len()];
        let input = ads[ad].input();
        let one = Instant::now();
        let _ = assess(&profiles[profile], &input);
        times.push(one.elapsed());
    }
    let total = started.elapsed();
    times.sort();
    let median = times[times.len() / 2];
    println!(
        "speed: {} ads (median {length} characters), {} pairs: median {median:?} per job, \
         {SPEED_JOBS} jobs in {total:?}",
        ads.len(),
        pairs.len()
    );
    assert!(median.as_micros() <= 500, "median {median:?} per job");
    assert!(
        total.as_millis() <= 3000,
        "{SPEED_JOBS} jobs took {total:?}"
    );
}

/// Prints the table of the corpus (`-- --ignored report --nocapture`).
#[test]
#[ignore = "report"]
fn report() {
    let run = run();
    println!("profile job band score status/expected findings");
    for row in &run.rows {
        let new = row.new.as_ref();
        let status = new.map_or("-".to_owned(), |a| code_of_verdict(a.verdict));
        let findings: Vec<String> = new
            .map(|a| {
                a.reasons
                    .iter()
                    .filter(|r| matches!(r.kind, ReasonKind::Violation | ReasonKind::Check))
                    .map(|r| code(r.code))
                    .collect()
            })
            .unwrap_or_default();
        let (lo, hi) = row.expect_band;
        let score = effective(new);
        let flag = if !row.gated {
            " (not gated yet)"
        } else if common::eval::band_distance(score, row.expect_band) > 0 {
            " off"
        } else {
            ""
        };
        println!(
            "{} {} [{lo},{hi}] {score} {status}/{} {findings:?} exp {:?}{flag}",
            row.profile, row.job, row.expect_status, row.expect_checks
        );
    }
}

/// Prints every reason of corpus rows (`profile:job`, comma-separated):
/// `JOBALERT_ROWS=fin:K01,sap:K12 cargo test -p jobalert-core --test matching_corpus -- --ignored explain_rows --nocapture`
#[test]
#[ignore = "debugging aid"]
fn explain_rows() {
    let wanted = std::env::var("JOBALERT_ROWS").expect("set JOBALERT_ROWS");
    let wanted: Vec<(&str, &str)> = wanted
        .split(',')
        .filter_map(|pair| pair.split_once(':'))
        .collect();
    let run = run();
    for row in run
        .rows
        .iter()
        .filter(|r| wanted.iter().any(|(p, j)| *p == r.profile && *j == r.job))
    {
        let Some(a) = &row.new else { continue };
        println!(
            "{} {} score {} {:?}",
            row.profile, row.job, a.score, a.verdict
        );
        for r in &a.reasons {
            let evidence = r
                .evidence
                .as_ref()
                .map(|e| format!("<- {} ({:?}, {})", e.profile, e.via, e.path))
                .unwrap_or_default();
            println!(
                "  {:?} {:?} {} {:?} {} {evidence}",
                r.kind,
                r.weight,
                code(r.code),
                r.label.as_deref().unwrap_or(""),
                Value::Object(r.params.clone())
            );
        }
    }
}

fn code_of_verdict(verdict: Verdict) -> String {
    serde_json::to_value(verdict)
        .expect("verdict")
        .as_str()
        .expect("string")
        .to_owned()
}
