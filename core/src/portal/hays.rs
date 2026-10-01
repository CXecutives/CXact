//! Hays (hays.de): the largest agency for freelance projects in Germany. The app searches its
//! public job search itself (user decision 2026-10-01), limited to projects for freelancers
//! (`joblevel=3`, "Freiberuflich für ein Projekt"), served as HTML with `mrew=1&e=false`; the
//! robots.txt allows the search and the ads (checked at run time).
//!
//! A hit is `div.search__result` with its link, its title and its place; an ad is
//! `/jobsuche/stellenangebote-jobs-detail-<slug>-<id>/1` (the slug is not read: any one opens
//! the ad), its text the sections of `div.h-job-detail__content`, its facts the meta lines
//! (contract, place, start) and the industry of its form.

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    host_and_segments, host_is, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct Hays;

const DOMAIN: &str = "hays.de";
const DETAIL_PREFIX: &str = "stellenangebote-jobs-detail-";
const PARSER_VERSION: u32 = 1;

impl PortalAdapter for Hays {
    fn portal(&self) -> Portal {
        Portal::Hays
    }
    fn key(&self) -> &'static str {
        "hays"
    }
    fn label(&self) -> &'static str {
        "hays.de"
    }
    fn monogram(&self) -> &'static str {
        "Ha"
    }
    fn file_tag(&self) -> &'static str {
        "Hays"
    }
    fn home_url(&self) -> &'static str {
        "https://www.hays.de/"
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["hays.de"]
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

    /// `/jobsuche/stellenangebote-jobs-detail-<slug>-<id>/<n>`: the id is the last part of the
    /// slug; the link keeps its slug.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        let [area, detail, ..] = segments.as_slice() else {
            return None;
        };
        let id = detail.strip_prefix(DETAIL_PREFIX)?.rsplit('-').next()?;
        if area != "jobsuche" || !all_digits(id, 4) {
            return None;
        }
        let mut clean = Url::parse("https://www.hays.de/").ok()?;
        clean.set_path(url.path());
        Some(JobLink {
            key: super::JobKey {
                portal: Portal::Hays,
                id: id.to_owned(),
            },
            url: clean,
        })
    }

    fn canonical_url(&self, id: &str) -> Option<Url> {
        if !all_digits(id, 4) {
            return None;
        }
        Url::parse(&format!(
            "https://www.hays.de/jobsuche/{DETAIL_PREFIX}job-{id}/1"
        ))
        .ok()
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

    /// One page per term: projects for freelancers only, newest first (the search's own
    /// order), as HTML.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .filter_map(|term| {
                let mut url =
                    Url::parse("https://www.hays.de/jobsuche/stellenangebote-jobs").ok()?;
                url.query_pairs_mut()
                    .append_pair("q", term)
                    .append_pair("joblevel", "3")
                    .append_pair("mrew", "1")
                    .append_pair("e", "false");
                Some(url)
            })
            .collect()
    }

    /// Its further pages as its own links name them (measured 2026-10-01): the contracting
    /// jobs, page `n` in the path, the term in the query.
    fn search_page_url(&self, first: &Url, page: u32) -> Option<Url> {
        let term = first
            .query_pairs()
            .find(|(name, _)| name == "q")
            .map(|(_, value)| value.into_owned())?;
        let mut url = Url::parse(&format!(
            "https://www.hays.de/jobsuche/stellenangebote-jobs/j/Contracting/3/p/{page}"
        ))
        .ok()?;
        url.query_pairs_mut()
            .append_pair("q", &term)
            .append_pair("e", "false")
            .append_pair("ij", "false");
        Some(url)
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        let hits: Vec<Hit> = doc
            .select(&RESULT)
            .filter_map(|result| hit(result))
            .collect();
        if hits.is_empty() {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            // A search page without its result list is a page the parser does not know.
            if doc.select(&RESULTS).next().is_none() && doc.select(&NO_RESULTS).next().is_none() {
                return Err(NoHits::Suspicious(Cause::PageNotRecognised));
            }
        }
        Ok(hits)
    }
}

static RESULTS: Css = LazyLock::new(|| selector("div.search__results"));
/// The page of a search without hits (it says so, with its own form).
static NO_RESULTS: Css =
    LazyLock::new(|| selector("#search-results-no-results, .search__no-results"));
static RESULT: Css = LazyLock::new(|| selector("div.search__result"));
static RESULT_LINK: Css = LazyLock::new(|| selector("a.search__result__link"));
static RESULT_TITLE: Css = LazyLock::new(|| selector(".search__result__header__title"));
static RESULT_PLACE: Css =
    LazyLock::new(|| selector(".search__result__job__attribute__location .info-text"));
static CONTENT: Css = LazyLock::new(|| selector("div.h-job-detail__content"));
static TITLE: Css = LazyLock::new(|| selector("h1"));
static META: Css = LazyLock::new(|| selector(".h-job-detail__meta-item.h-job-detail__location"));
static INDUSTRY: Css = LazyLock::new(|| selector("input#job_industry"));

/// A hit of the search list: its link, its title without "(m/w/d)" and its place.
fn hit(result: ElementRef<'_>) -> Option<Hit> {
    let href = result.select(&RESULT_LINK).next()?.value().attr("href")?;
    let link = Hays.job_link(&Url::parse("https://www.hays.de/").ok()?.join(href).ok()?)?;
    let title = result
        .select(&RESULT_TITLE)
        .next()
        .map(|node| without_gender_mark(&one_line(&node.text().collect::<String>())))
        .unwrap_or_default();
    let location = result
        .select(&RESULT_PLACE)
        .next()
        .map(|node| one_line(&node.text().collect::<String>()))
        .unwrap_or_default();
    Some(Hit {
        link,
        title,
        // The client stays unnamed: Hays places the freelancer.
        company: String::new(),
        location,
    })
}

/// The ad: its sections as text, the title and place as fields, the facts.
fn parse(doc: &Html) -> Parsed {
    let text = doc
        .select(&CONTENT)
        .next()
        .map(|node| html_to_text(&node.html()));
    let title = doc
        .select(&TITLE)
        .next()
        .map(|node| without_gender_mark(&one_line(&node.text().collect::<String>())))
        .unwrap_or_default();
    let location = meta(doc)
        .into_iter()
        .find(|line| !is_contract(line) && !line.starts_with("Startdatum"))
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

/// The meta lines of the ad, each one line: the contract, the place, the start.
fn meta(doc: &Html) -> Vec<String> {
    doc.select(&META)
        .map(|node| one_line(&node.text().collect::<String>()))
        .filter(|line| !line.is_empty())
        .collect()
}

fn is_contract(line: &str) -> bool {
    let lower = line.to_lowercase();
    [
        "freiberuflich",
        "festanstellung",
        "arbeitnehmerüberlassung",
        "contracting",
    ]
    .iter()
    .any(|word| lower.contains(word))
}

fn facts(doc: &Html) -> Facts {
    let mut facts = Facts::default();
    for line in meta(doc) {
        if is_contract(&line) {
            facts.employment_type = Facts::value(&line);
        } else if let Some(start) = line.strip_prefix("Startdatum:") {
            facts.start = Facts::value(start);
        }
    }
    facts.industries = doc
        .select(&INDUSTRY)
        .next()
        .and_then(|node| node.value().attr("value"))
        .and_then(Facts::value);
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A search page as Hays serves it (2026-10-01), shortened to two hits.
    const SEARCH: &str = r#"<html><body><div class="search__results">
      <div class="search__result border-radius-10">
        <a class="search__result__link" target="_blank" href="https://www.hays.de/jobsuche/stellenangebote-jobs-detail-sap-p2m-streamlead-pm-eam-klagenfurt-896260/1"></a>
        <div class="search__result__header"><h4 class="search__result__header__title"> SAP P2M Streamlead (PM/EAM) <span class="jospositiononly"> (m/w/d) </span></h4></div>
        <div class="search__result__job__attributes">
          <div class="search__result__job__attribute search__result__job__attribute__type"><div class="info-text"> Freiberuflich für ein Projekt </div></div>
          <div class="search__result__job__attribute search__result__job__attribute__location"><div class="info-text"> Klagenfurt </div></div>
        </div>
      </div>
      <div class="search__result"><a class="search__result__link" href="/jobsuche/stellenangebote-jobs-detail-interim-cfo-hamburg-891480/1"></a>
        <h4 class="search__result__header__title">Interim CFO (w/m/d)</h4></div>
    </div></body></html>"#;

    /// An ad as Hays serves it (2026-10-01), shortened.
    const AD: &str = r#"<html><body><h1> SAP P2M Streamlead (PM/EAM) (m/w/d) </h1>
      <div class="info-text h-job-detail__meta-item h-job-detail__location"> freiberuflich für ein Projekt </div>
      <div class="info-text h-job-detail__meta-item h-job-detail__location">Klagenfurt</div>
      <div class="info-text h-job-detail__meta-item h-job-detail__location">Startdatum: sofort</div>
      <input type="hidden" id="job_industry" value="Software / EDV / IT-Dienstleistung">
      <div class="h-job-detail__content"><h3>Aufgaben</h3><ul><li>Leitung des SAP-Streams Plan to Maintain im Rahmen eines internationalen SAP-Transformationsprogramms</li></ul>
      <h3>Profil</h3><ul><li>Mehrjährige Erfahrung als SAP Stream Lead im Bereich SAP PM/EAM</li></ul></div>
    </body></html>"#;

    /// Its further pages as its own links name them (measured 2026-10-01).
    #[test]
    fn the_search_pages_like_its_links() {
        let first = Hays.search_urls(&["Interim CFO".to_owned()]).remove(0);
        assert_eq!(
            Hays.search_page_url(&first, 2).unwrap().as_str(),
            "https://www.hays.de/jobsuche/stellenangebote-jobs/j/Contracting/3/p/2?q=Interim+CFO&e=false&ij=false"
        );
    }

    #[test]
    fn the_search_lists_its_hits() {
        let hits = Hays.search_page(SEARCH).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].link.key.id, "896260");
        assert_eq!(hits[0].title, "SAP P2M Streamlead (PM/EAM)");
        assert_eq!(hits[0].location, "Klagenfurt");
        assert_eq!(
            hits[0].link.url.as_str(),
            "https://www.hays.de/jobsuche/stellenangebote-jobs-detail-sap-p2m-streamlead-pm-eam-klagenfurt-896260/1"
        );
        assert_eq!(hits[1].link.key.id, "891480");
        assert_eq!(hits[1].title, "Interim CFO");
        // A page without its list is unknown; one that says it found nothing is no hits.
        assert_eq!(
            Hays.search_page("<html><body>Wartung</body></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
        assert_eq!(
            Hays.search_page(r#"<div class="search__results"></div>"#),
            Ok(Vec::new())
        );
        // One term, one page: projects for freelancers, as HTML.
        let urls = Hays.search_urls(&["SAP FI/CO".to_owned()]);
        assert_eq!(
            urls[0].as_str(),
            "https://www.hays.de/jobsuche/stellenangebote-jobs?q=SAP+FI%2FCO&joblevel=3&mrew=1&e=false"
        );
    }

    #[test]
    fn an_ad_gives_its_text_fields_and_facts() {
        let link = Hays
            .canonical_url("896260")
            .and_then(|url| Hays.job_link(&url))
            .unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Hays.guest_page(AD, "/", &link)
        else {
            panic!("no text");
        };
        assert!(text.contains("Leitung des SAP-Streams"), "{text}");
        assert!(text.contains("SAP PM/EAM"), "{text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "SAP P2M Streamlead (PM/EAM)");
        assert_eq!(fields.location, "Klagenfurt");
        assert_eq!(
            facts.employment_type.as_deref(),
            Some("freiberuflich für ein Projekt")
        );
        assert_eq!(facts.start.as_deref(), Some("sofort"));
        assert_eq!(
            facts.industries.as_deref(),
            Some("Software / EDV / IT-Dienstleistung")
        );
    }

    #[test]
    fn links_need_the_detail_path_and_a_number() {
        let link = |text: &str| Hays.job_link(&Url::parse(text).unwrap()).map(|l| l.key.id);
        assert_eq!(
            link("https://www.hays.de/jobsuche/stellenangebote-jobs-detail-x-896260/1?utm=a"),
            Some("896260".to_owned())
        );
        assert_eq!(
            link("https://www.hays.de/jobsuche/stellenangebote-jobs?q=sap"),
            None
        );
        assert_eq!(
            link("https://www.hays.de/jobsuche/stellenangebote-jobs-detail-x/1"),
            None
        );
        assert_eq!(
            link("https://example.com/jobsuche/stellenangebote-jobs-detail-x-896260/1"),
            None
        );
    }

    /// The real pages of 2026-10-01 read (private, not in the repository).
    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_pages_read() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let search = std::fs::read_to_string(dir.join("hays-search.html")).unwrap();
        assert!(Hays.search_page(&search).unwrap().len() >= 10);
        let ad = std::fs::read_to_string(dir.join("hays-896260.html")).unwrap();
        let link = Hays
            .canonical_url("896260")
            .and_then(|url| Hays.job_link(&url))
            .unwrap();
        assert!(matches!(
            Hays.guest_page(&ad, "/", &link),
            PageOutcome::Text { .. }
        ));
    }
}
