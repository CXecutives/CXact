//! The gap finder: which words of the ads' requirements and titles neither the engine's own
//! words nor ESCO know, by frequency (`docs/MATCHING.md`, "Vocabulary"):
//!
//! ```text
//! cargo run -p jobalert-core --release --example vocab_gaps [-- N]
//! ```
//!
//! Reads every ad there is: the corpus and the held-out sets (`core/tests/fixtures/matching`),
//! and, when present, the real job pages and alert mails in `core/tests/fixtures/private`
//! (ignored by git; only their words reach the output). Prints the share of requirements
//! the engine knows in full, then the N (default 60) most frequent unknown words of the
//! requirements and of the titles, each with the number of ads and up to three examples.
//! A word that occurs nowhere stays out of the vocabulary: fill from the top down.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

use jobalert_core::fetch::PageOutcome;
use jobalert_core::mail::{MailKind, RawMail, classify_mail};
use jobalert_core::matching::vocabulary_gaps;
use jobalert_core::portal::Portal;
use url::Url;

/// One ad: where it comes from, its title and its text (empty for a mail's posting).
struct Ad {
    source: String,
    title: String,
    text: String,
}

/// The real job pages and the address each was fetched from (search and list pages are no
/// ads). Only what is present is read.
const PAGES: &[(&str, &str)] = &[
    (
        "freelancermap-3049771.html",
        "https://www.freelancermap.de/nproj/3049771.html",
    ),
    (
        "gulp-agency.json",
        "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448",
    ),
    (
        "gulp-direkt.json",
        "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43a340b5a3a29f35d9c0",
    ),
    (
        "hays-896260.html",
        "https://www.hays.de/jobsuche/stellenangebote-jobs-detail-job-896260/1",
    ),
    (
        "ix-ad.html",
        "https://www.interim-x.com/de/projekt/senior_pricing_advisor_mwd-2391",
    ),
    (
        "linkedin-closed-4091550784.html",
        "https://www.linkedin.com/jobs/view/4091550784/",
    ),
    (
        "linkedin-open-4468654483.html",
        "https://www.linkedin.com/jobs/view/4468654483/",
    ),
    (
        "mp-7037091.html",
        "https://www.michaelpage.de/job-detail/interim-projektcontroller-mwd/ref/jn-092026-7037091",
    ),
    (
        "mp-ad.html",
        "https://www.michaelpage.de/job-detail/interim-projektcontroller-mwd/ref/jn-092026-7113284",
    ),
    (
        "solcom-ad.html",
        "https://www.solcom.de/fuer-freiberufler/projektliste/1083900-azure-architekt",
    ),
];

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// The ads of a folder in the corpus format (`Titel:` header, a blank line, the text).
fn txt_ads(dir: &Path, out: &mut Vec<Ad>) {
    let Ok(entries) = std::fs::read_dir(dir) else {
        return;
    };
    let mut files: Vec<PathBuf> = entries
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().is_some_and(|e| e == "txt"))
        .collect();
    files.sort();
    for file in files {
        let Ok(content) = std::fs::read_to_string(&file) else {
            continue;
        };
        let content = content.replace("\r\n", "\n");
        let (header, body) = content.split_once("\n\n").unwrap_or((&content, ""));
        let title = header
            .lines()
            .find_map(|l| l.strip_prefix("Titel:"))
            .unwrap_or_default()
            .trim()
            .to_owned();
        let folder = dir.file_name().unwrap_or_default().to_string_lossy();
        out.push(Ad {
            source: format!(
                "{folder}/{}",
                file.file_name().unwrap_or_default().to_string_lossy()
            ),
            title,
            text: body.to_owned(),
        });
    }
}

/// The real job pages, read by their portal's adapter.
fn page_ads(out: &mut Vec<Ad>) {
    let dir = fixtures().join("private/pages");
    for (file, address) in PAGES {
        let Ok(body) = std::fs::read_to_string(dir.join(file)) else {
            continue;
        };
        let Some(link) = Url::parse(address)
            .ok()
            .and_then(|url| Portal::ALL.iter().find_map(|p| p.adapter().job_link(&url)))
        else {
            continue;
        };
        let adapter = link.key.portal.adapter();
        if let PageOutcome::Text { text, fields, .. } = adapter.guest_page(&body, "/", &link) {
            out.push(Ad {
                source: format!("private/{file}"),
                title: fields.map(|f| f.title).unwrap_or_default(),
                text,
            });
        }
    }
}

/// The titles of the postings in the real alert mails.
fn mail_ads(out: &mut Vec<Ad>) {
    let Ok(entries) = std::fs::read_dir(fixtures().join("private/mails")) else {
        return;
    };
    for entry in entries.flatten() {
        let Ok(bytes) = std::fs::read(entry.path()) else {
            continue;
        };
        let raw = RawMail {
            gmail_id: None,
            bytes,
        };
        if let MailKind::Alert(alert) = classify_mail(&raw, &Portal::ALL) {
            for posting in alert.postings {
                out.push(Ad {
                    source: format!("private/{}", entry.file_name().to_string_lossy()),
                    title: posting.title,
                    text: String::new(),
                });
            }
        }
    }
}

/// How often a word is unknown: occurrences, the ads it occurs in, a few examples.
#[derive(Default)]
struct Count {
    times: usize,
    ads: BTreeSet<usize>,
    examples: Vec<String>,
}

fn add(counts: &mut BTreeMap<String, Count>, word: &str, ad: usize, example: &str) {
    let count = counts.entry(word.to_owned()).or_default();
    count.times += 1;
    count.ads.insert(ad);
    if count.examples.len() < 3 && !count.examples.iter().any(|e| e == example) {
        count.examples.push(example.chars().take(70).collect());
    }
}

fn print(name: &str, counts: &BTreeMap<String, Count>, top: usize) {
    let mut rows: Vec<(&String, &Count)> = counts.iter().collect();
    rows.sort_by(|a, b| b.1.times.cmp(&a.1.times).then(a.0.cmp(b.0)));
    println!("\n## Unknown words of the {name} ({} words)\n", rows.len());
    println!("| Word | Times | Ads | Examples |\n|---|---|---|---|");
    for (word, count) in rows.into_iter().take(top) {
        println!(
            "| {word} | {} | {} | {} |",
            count.times,
            count.ads.len(),
            count.examples.join(" / ")
        );
    }
}

fn main() {
    let top = std::env::args()
        .nth(1)
        .and_then(|n| n.parse().ok())
        .unwrap_or(60);
    let mut ads = Vec::new();
    let matching = fixtures().join("matching");
    txt_ads(&matching.join("corpus"), &mut ads);
    for set in 1..=10 {
        txt_ads(&matching.join(format!("heldout{set}")), &mut ads);
    }
    let fixture_ads = ads.len();
    page_ads(&mut ads);
    let pages = ads.len() - fixture_ads;
    mail_ads(&mut ads);
    let mails = ads.len() - fixture_ads - pages;
    let (mut requirements, mut titles) = (BTreeMap::new(), BTreeMap::new());
    let (mut items, mut unknown_items) = (0usize, 0usize);
    for (index, ad) in ads.iter().enumerate() {
        let gaps = vocabulary_gaps(&ad.title, &ad.text);
        if let Some(gap) = &gaps.title {
            for word in &gap.unknown {
                add(&mut titles, word, index, &gap.term);
            }
        }
        items += gaps.items;
        unknown_items += gaps.requirements.len();
        for gap in &gaps.requirements {
            for word in &gap.unknown {
                add(&mut requirements, word, index, &gap.term);
            }
        }
        if std::env::var_os("VOCAB_GAPS_ADS").is_some() && !gaps.requirements.is_empty() {
            println!("{}: {:?}", ad.source, gaps.requirements);
        }
    }
    println!(
        "{} ads ({fixture_ads} fixtures, {pages} real pages, {mails} postings of real mails)",
        ads.len()
    );
    let known = items - unknown_items;
    let permille = 1000 * known / items.max(1);
    println!(
        "Skill requirements known in full: {known} of {items} ({}.{} %)",
        permille / 10,
        permille % 10
    );
    print("requirements", &requirements, top);
    print("titles", &titles, top);
}
