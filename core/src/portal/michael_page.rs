//! Michael Page (michaelpage.de): senior interim roles, Finance above all. The app searches its
//! public job search itself (user decision 2026-10-01), one keyword page per term; its
//! robots.txt forbids the contract filter (`contract=temp`), so the app keeps the interim roles
//! of the page itself (the tile's contract). The robots.txt allows the keyword pages and the
//! ads (checked at run time).
//!
//! A hit is `div.job-tile` with its link, title and place; an ad is
//! `/job-detail/<slug>/ref/jn-<MMYYYY>-<number>` (the slug belongs to the address: the link
//! of the hit is kept), its text `#job-description`, its facts the summary list (contract,
//! industry, place) and the lines "Start:", "Dauer:", "Auslastung:" of the text. An ad that
//! has gone answers 410 ("Diese Stelle ist leider bereits offline").

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobKey, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    definitions, host_and_segments, host_is, keyword_slug, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct MichaelPage;

const DOMAIN: &str = "michaelpage.de";
const ORIGIN: &str = "https://www.michaelpage.de/";
const PARSER_VERSION: u32 = 1;
/// A hit whose number is this many months older than the newest of its page is an ad the
/// search still lists although it has gone.
const STALE_MONTHS: u32 = 6;

impl PortalAdapter for MichaelPage {
    fn portal(&self) -> Portal {
        Portal::MichaelPage
    }
    fn key(&self) -> &'static str {
        "michaelpage"
    }
    fn label(&self) -> &'static str {
        "michaelpage.de"
    }
    fn monogram(&self) -> &'static str {
        "MP"
    }
    fn file_tag(&self) -> &'static str {
        "Michael Page"
    }
    fn home_url(&self) -> &'static str {
        ORIGIN
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["michaelpage"]
    }
    fn limits(&self) -> Limits {
        super::search_limits()
    }
    fn access(&self) -> Access {
        Access::Guest
    }
    fn way(&self) -> Way {
        Way::Search
    }
    fn checks_robots(&self) -> bool {
        true
    }
    fn projects_only(&self) -> bool {
        true
    }

    /// `/job-detail/<slug>/ref/jn-<MMYYYY>-<number>`: the number is the job.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        let [detail, _slug, reference, code] = segments.as_slice() else {
            return None;
        };
        let id = code.strip_prefix("jn-")?.rsplit('-').next()?;
        if detail != "job-detail" || reference != "ref" || !all_digits(id, 5) {
            return None;
        }
        let mut clean = Url::parse(ORIGIN).ok()?;
        clean.set_path(url.path());
        Some(JobLink {
            key: JobKey {
                portal: Portal::MichaelPage,
                id: id.to_owned(),
            },
            url: clean,
        })
    }

    /// The address needs the ad's slug and month: none from the number alone.
    fn canonical_url(&self, _id: &str) -> Option<Url> {
        None
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else {
            PageOutcome::Suspicious(Cause::RedirectNotFollowed)
        }
    }

    fn guest_page(&self, html: &str, _path: &str, _link: &JobLink) -> PageOutcome {
        let doc = Html::parse_document(html);
        let parsed = parse(&doc);
        if parsed.text.is_none() && super::has_challenge(&doc, html) {
            return PageOutcome::Blocked(Cause::Captcha);
        }
        judge(parsed)
    }

    fn parser_version(&self) -> u32 {
        PARSER_VERSION
    }

    fn parse_facts(&self, html: &str) -> Facts {
        facts(&Html::parse_document(html))
    }

    /// One keyword page per term (the search's own address), interim roles only.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .filter_map(|term| {
                let slug = keyword_slug(term);
                if slug.is_empty() {
                    return None;
                }
                // No contract filter: the robots.txt forbids it.
                Url::parse(ORIGIN).ok()?.join(&format!("jobs/{slug}")).ok()
            })
            .collect()
    }

    /// Its further pages as its own links count them: `page=1` is the second (the first
    /// page has none).
    fn search_page_url(&self, first: &Url, page: u32) -> Option<Url> {
        let mut url = first.clone();
        url.query_pairs_mut()
            .append_pair("page", &page.checked_sub(1)?.to_string());
        Some(url)
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        let hits: Vec<(Hit, u32)> = doc.select(&TILE).filter_map(hit).collect();
        if hits.is_empty() {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            if doc.select(&RESULTS).next().is_none() {
                return Err(NoHits::Suspicious(Cause::PageNotRecognised));
            }
        }
        let newest = hits.iter().map(|(_, month)| *month).max().unwrap_or(0);
        Ok(hits
            .into_iter()
            .filter(|(_, month)| newest.saturating_sub(*month) <= STALE_MONTHS)
            .map(|(hit, _)| hit)
            .collect())
    }
}

static RESULTS: Css = LazyLock::new(|| selector("div.view-job-search"));
static TILE: Css = LazyLock::new(|| selector("div.job-tile"));
static TILE_LINK: Css = LazyLock::new(|| selector(".job-title a"));
static TILE_PLACE: Css = LazyLock::new(|| selector(".job-location"));
static TILE_CONTRACT: Css = LazyLock::new(|| selector(".job-contract-type"));
/// The contracts of the roles the app keeps (interim and projects; no permanent posts).
const INTERIM: [&str; 2] = ["interim", "projekt"];
static TITLE: Css = LazyLock::new(|| selector("h1"));
static TEXT: Css = LazyLock::new(|| selector("#job-description"));
static SUMMARY: Css = LazyLock::new(|| selector("dl"));

/// A hit and the month of its number (`jn-<MMYYYY>-...` as months since year 0).
fn hit(card: ElementRef<'_>) -> Option<(Hit, u32)> {
    let contract = card
        .select(&TILE_CONTRACT)
        .next()
        .map(|node| node.text().collect::<String>().to_lowercase())
        .unwrap_or_default();
    if !INTERIM.iter().any(|word| contract.contains(word)) {
        return None;
    }
    let anchor = card.select(&TILE_LINK).next()?;
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    let link = MichaelPage.job_link(&url)?;
    let posted = month_of(&url).unwrap_or(0);
    let title = without_gender_mark(&one_line(&anchor.text().collect::<String>()));
    let location = card
        .select(&TILE_PLACE)
        .next()
        .map(|node| one_line(&node.text().collect::<String>()))
        .unwrap_or_default();
    Some((
        Hit {
            link,
            title,
            // The client stays unnamed: Michael Page places the interim manager.
            company: String::new(),
            location,
        },
        posted,
    ))
}

/// The month of an ad's number (`jn-092026-...`), as months since year 0.
fn month_of(url: &Url) -> Option<u32> {
    let code = url.path_segments()?.next_back()?.strip_prefix("jn-")?;
    let digits = code.split('-').next()?;
    if digits.len() != 6 {
        return None;
    }
    let month: u32 = digits[..2].parse().ok()?;
    let year: u32 = digits[2..].parse().ok()?;
    Some(year * 12 + month)
}

fn parse(doc: &Html) -> Parsed {
    let text = doc
        .select(&TEXT)
        .next()
        .map(|node| html_to_text(&node.html()));
    let title = doc
        .select(&TITLE)
        .next()
        .map(|node| without_gender_mark(&one_line(&node.text().collect::<String>())))
        .unwrap_or_default();
    let location = definitions(doc, &SUMMARY)
        .into_iter()
        .find(|(term, _)| term == "Ort")
        .map(|(_, value)| value)
        .unwrap_or_default();
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title,
            company: String::new(),
            location,
        },
        facts: facts(doc),
    }
}

/// The summary list (contract, industry) and the lines of the text that name the start, the
/// duration and the workload.
fn facts(doc: &Html) -> Facts {
    let mut facts = Facts::default();
    for (term, value) in definitions(doc, &SUMMARY) {
        match term.as_str() {
            "Vertragsart" => facts.employment_type = Facts::value(&value),
            "Branche" => facts.industries = Facts::value(&value),
            "Fachbereich" => facts.function = Facts::value(&value),
            _ => {}
        }
    }
    let text = doc
        .select(&TEXT)
        .next()
        .map(|node| html_to_text(&node.html()))
        .unwrap_or_default();
    for line in text.lines().map(str::trim) {
        if let Some(start) = line.strip_prefix("Start:") {
            facts.start = facts.start.or_else(|| Facts::value(start));
        } else if let Some(duration) = line.strip_prefix("Dauer:") {
            facts.duration = facts.duration.or_else(|| Facts::value(duration));
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A search page as Michael Page serves it (2026-10-01), shortened: a hit of this month and
    /// one the search still lists from a year ago.
    const SEARCH: &str = r#"<div class="view view-job-search"><ul>
      <li class="views-row"><div class="job-tile search-job-tile"><div class="job-title"><h3><a href="/job-detail/interim-projektcontroller-mwd/ref/jn-092026-7113284">Interim Projektcontroller (m/w/d)</a></h3></div>
        <div class="job-properties"><div class="job-location"><i></i> Hamburg</div><div class="job-contract-type"> Interim</div></div></div></li>
      <li class="views-row"><div class="job-tile search-job-tile"><div class="job-title"><h3><a href="/job-detail/interim-financial-controller/ref/jn-092025-6848928">Interim Financial Controller</a></h3></div>
        <div class="job-properties"><div class="job-contract-type"> Interim</div></div></div></li>
      <li class="views-row"><div class="job-tile search-job-tile"><div class="job-title"><h3><a href="/job-detail/head-controlling/ref/jn-092026-7113300">Head of Controlling</a></h3></div>
        <div class="job-properties"><div class="job-contract-type"> Festanstellung</div></div></div></li>
    </ul></div>"#;

    const AD: &str = r#"<html><body><h1>Interim Projektcontroller (m/w/d)</h1>
      <dl><dt class="summary-detail-field-label">Ort</dt><dd class="summary-detail-field-value"><a href="/jobs/hamburg">Hamburg</a></dd></dl>
      <dl><dt class="summary-detail-field-label">Vertragsart</dt><dd class="summary-detail-field-value"><a>Interim</a></dd></dl>
      <dl><dt class="summary-detail-field-label">Branche</dt><dd class="summary-detail-field-value">Transport &amp; Distribution</dd></dl>
      <div id="job-description"><p class="job-posted-date"> hinzugefügt 28/09/2026</p>
        <div class="job_advert__job-desc-company"><p>Start: ASAP<br>Dauer: 12 Monate+<br>Auslastung: Vollzeit</p></div>
        <div class="job_advert__job-desc-role"><p>Projektcontrolling nach IFRS und POC-Methode für Großprojekte</p></div></div>
    </body></html>"#;

    /// `page=1` is its second page (measured 2026-10-01).
    #[test]
    fn the_search_pages_like_its_links() {
        let first = MichaelPage
            .search_urls(&["Controlling".to_owned()])
            .remove(0);
        assert_eq!(
            MichaelPage.search_page_url(&first, 2).unwrap().as_str(),
            "https://www.michaelpage.de/jobs/controlling?page=1"
        );
    }

    #[test]
    fn the_search_lists_its_current_hits() {
        let hits = MichaelPage.search_page(SEARCH).unwrap();
        assert_eq!(
            hits.len(),
            1,
            "the ad of a year ago has gone, the permanent post is none"
        );
        assert_eq!(hits[0].link.key.id, "7113284");
        assert_eq!(hits[0].title, "Interim Projektcontroller");
        assert_eq!(hits[0].location, "Hamburg");
        assert_eq!(
            MichaelPage.search_page("<html></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
        let urls = MichaelPage.search_urls(&["Interim CFO".to_owned(), "SAP FI/CO".to_owned()]);
        assert_eq!(
            urls.iter().map(Url::as_str).collect::<Vec<_>>(),
            [
                "https://www.michaelpage.de/jobs/interim-cfo",
                "https://www.michaelpage.de/jobs/sap-fi-co"
            ]
        );
    }

    #[test]
    fn an_ad_gives_its_text_fields_and_facts() {
        let url = Url::parse(
            "https://www.michaelpage.de/job-detail/interim-projektcontroller-mwd/ref/jn-092026-7113284",
        )
        .unwrap();
        let link = MichaelPage.job_link(&url).unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = MichaelPage.guest_page(AD, "/", &link)
        else {
            panic!("no text");
        };
        assert!(text.contains("Projektcontrolling nach IFRS"), "{text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "Interim Projektcontroller");
        assert_eq!(fields.location, "Hamburg");
        assert_eq!(facts.employment_type.as_deref(), Some("Interim"));
        assert_eq!(
            facts.industries.as_deref(),
            Some("Transport & Distribution")
        );
        assert_eq!(facts.start.as_deref(), Some("ASAP"));
        assert_eq!(facts.duration.as_deref(), Some("12 Monate+"));
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_pages_read() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let search = std::fs::read_to_string(dir.join("mp-search.html")).unwrap();
        assert!(!MichaelPage.search_page(&search).unwrap().is_empty());
        let ad = std::fs::read_to_string(dir.join("mp-ad.html")).unwrap();
        let url = Url::parse(
            "https://www.michaelpage.de/job-detail/interim-projektcontroller-mwd/ref/jn-092026-7113284",
        )
        .unwrap();
        let link = MichaelPage.job_link(&url).unwrap();
        assert!(matches!(
            MichaelPage.guest_page(&ad, "/", &link),
            PageOutcome::Text { .. }
        ));
    }
}
