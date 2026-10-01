//! SOLCOM (solcom.de): IT, SAP and engineering projects for freelancers. The app searches its
//! public project list itself (user decision 2026-10-01), one page per term through its own
//! keyword field (`aufgaben`); the robots.txt allows the list and the projects (checked at run
//! time).
//!
//! A hit is `article.project-offer-card`: its link, its title after the project number, its
//! place among the card's facts; a project is `/fuer-freiberufler/projektliste/<id>-<slug>`
//! (the slug belongs to the address: the link of the hit is kept), its text the sections of
//! `.solcom-text` under their headings, its title, place and contract in its JSON-LD.

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use serde_json::Value;
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobKey, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    host_and_segments, host_is, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct Solcom;

const DOMAIN: &str = "solcom.de";
const ORIGIN: &str = "https://www.solcom.de/";
const PARSER_VERSION: u32 = 1;

impl PortalAdapter for Solcom {
    fn portal(&self) -> Portal {
        Portal::Solcom
    }
    fn key(&self) -> &'static str {
        "solcom"
    }
    fn label(&self) -> &'static str {
        "solcom.de"
    }
    fn monogram(&self) -> &'static str {
        "so"
    }
    fn file_tag(&self) -> &'static str {
        "SOLCOM"
    }
    fn home_url(&self) -> &'static str {
        ORIGIN
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["solcom"]
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

    /// `/fuer-freiberufler/projektliste/<id>-<slug>`.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        let [area, list, project] = segments.as_slice() else {
            return None;
        };
        let id = project.split('-').next()?;
        if area != "fuer-freiberufler" || list != "projektliste" || !all_digits(id, 5) {
            return None;
        }
        let mut clean = Url::parse(ORIGIN).ok()?;
        clean.set_path(url.path());
        Some(JobLink {
            key: JobKey {
                portal: Portal::Solcom,
                id: id.to_owned(),
            },
            url: clean,
        })
    }

    /// The address needs the project's slug: none from the number alone.
    fn canonical_url(&self, _id: &str) -> Option<Url> {
        None
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") || path.contains("anmelden") {
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
        facts(posting(&Html::parse_document(html)).as_ref())
    }

    /// One list per term, through the list's keyword field.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .filter_map(|term| {
                let mut url = Url::parse(ORIGIN)
                    .ok()?
                    .join("fuer-freelancer/projektliste")
                    .ok()?;
                url.query_pairs_mut().append_pair("aufgaben", term);
                Some(url)
            })
            .collect()
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        let hits: Vec<Hit> = doc.select(&CARD).filter_map(hit).collect();
        if hits.is_empty() {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            if doc.select(&LIST).next().is_none() {
                return Err(NoHits::Suspicious(Cause::PageNotRecognised));
            }
        }
        Ok(hits)
    }
}

static LIST: Css = LazyLock::new(|| selector(".view-project-offers-listing"));
static CARD: Css = LazyLock::new(|| selector("article.project-offer-card"));
static CARD_LINK: Css = LazyLock::new(|| selector("a.project-offer-card__title-link"));
static CARD_FACT: Css = LazyLock::new(|| selector("li.project-offer-card__meta-item"));
static SECTION_TEXT: Css = LazyLock::new(|| selector("div.solcom-text"));
static HEADING: Css = LazyLock::new(|| selector("h2, h3"));
static TITLE: Css = LazyLock::new(|| selector(r#"meta[property="og:title"]"#));
static JSON_LD: Css = LazyLock::new(|| selector(r#"script[type="application/ld+json"]"#));

/// "1083900 Azure Architekt" reads as "Azure Architekt".
fn without_number(title: &str) -> String {
    let title = title.trim();
    let rest = title
        .trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start();
    without_gender_mark(if rest.is_empty() { title } else { rest })
}

/// A card of the list: its link, its title and its place (the card's fourth fact: number,
/// duration, start, place, contract, workload).
fn hit(card: ElementRef<'_>) -> Option<Hit> {
    let anchor = card.select(&CARD_LINK).next()?;
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    let facts: Vec<String> = card
        .select(&CARD_FACT)
        .map(|node| one_line(&node.text().collect::<String>()))
        .collect();
    Some(Hit {
        link: Solcom.job_link(&url)?,
        title: without_number(&anchor.text().collect::<String>()),
        // The client stays unnamed: SOLCOM places the freelancer.
        company: String::new(),
        location: facts.get(3).cloned().unwrap_or_default(),
    })
}

/// The project's JSON-LD `JobPosting`, if any.
fn posting(doc: &Html) -> Option<Value> {
    doc.select(&JSON_LD)
        .filter_map(|node| serde_json::from_str::<Value>(&node.text().collect::<String>()).ok())
        .find(|value| value.get("@type").and_then(Value::as_str) == Some("JobPosting"))
}

fn parse(doc: &Html) -> Parsed {
    let sections: Vec<String> = doc
        .select(&SECTION_TEXT)
        .map(|section| {
            let heading = section
                .parent()
                .and_then(ElementRef::wrap)
                .and_then(|parent| parent.select(&HEADING).next())
                .map(|node| one_line(&node.text().collect::<String>()));
            let text = html_to_text(&section.html());
            match heading {
                Some(heading) if !heading.is_empty() => format!("{heading}\n{text}"),
                _ => text,
            }
        })
        .collect();
    let text = (!sections.is_empty()).then(|| sections.join("\n\n"));
    let posting = posting(doc);
    let title = doc
        .select(&TITLE)
        .next()
        .and_then(|node| node.value().attr("content"))
        .map(without_number)
        .unwrap_or_default();
    let location = posting
        .as_ref()
        .and_then(|p| p.pointer("/jobLocation/address/addressLocality"))
        .and_then(Value::as_str)
        .map(one_line)
        .unwrap_or_default();
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title,
            company: String::new(),
            location,
        },
        facts: facts(posting.as_ref()),
    }
}

/// The contract and the industry of the project's JSON-LD.
fn facts(posting: Option<&Value>) -> Facts {
    let mut facts = Facts::default();
    let text = |name: &str| {
        posting
            .and_then(|p| p.get(name))
            .and_then(Value::as_str)
            .and_then(Facts::value)
    };
    facts.employment_type = text("employmentType").map(|kind| {
        if kind == "CONTRACTOR" {
            "Freiberuflich".to_owned()
        } else {
            kind
        }
    });
    facts.industries = text("industry");
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The list as SOLCOM serves it (2026-10-01), shortened to one card.
    const LIST_PAGE: &str = r#"<div class="view view-project-offers-listing"><div class="views-row">
      <article class="project-offer-card"><h2 class="project-offer-card__title"><a href="/fuer-freiberufler/projektliste/1083900-azure-architekt" class="project-offer-card__title-link">1083900 Azure Architekt</a></h2>
      <ul class="project-offer-card__meta"><li class="project-offer-card__meta-item"><span>1083899</span></li><li class="project-offer-card__meta-item"><span>6 MM++</span></li>
      <li class="project-offer-card__meta-item"><span>05.10.2026</span></li><li class="project-offer-card__meta-item"><span>Remote</span></li>
      <li class="project-offer-card__meta-item"><span>freiberuflich</span></li></ul></article></div></div>"#;

    const AD: &str = r#"<html><head><meta property="og:title" content="1083900 Azure Architekt" />
      <script type="application/ld+json">{"@type":"JobPosting","employmentType":"CONTRACTOR","industry":"Informationstechnologie","jobLocation":{"@type":"Place","address":{"addressLocality":"Remote"}}}</script></head>
      <body><h1>Projektdetails</h1><div class="grid gap-4"><h3>Aufgaben</h3><div class="solcom-text"><ul><li>Azure Landing Zone mit Terraform als Infrastructure as Code</li></ul></div></div>
      <div class="grid gap-4"><h3>Must-haves</h3><div class="solcom-text"><p>Mind. 2 Landing Zones von Grund auf konzipiert</p></div></div></body></html>"#;

    #[test]
    fn the_list_gives_its_cards() {
        let hits = Solcom.search_page(LIST_PAGE).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].link.key.id, "1083900");
        assert_eq!(hits[0].title, "Azure Architekt");
        assert_eq!(hits[0].location, "Remote");
        assert_eq!(
            hits[0].link.url.as_str(),
            "https://www.solcom.de/fuer-freiberufler/projektliste/1083900-azure-architekt"
        );
        assert_eq!(
            Solcom.search_page("<html></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
        assert_eq!(
            Solcom.search_urls(&["SAP FI/CO".to_owned()])[0].as_str(),
            "https://www.solcom.de/fuer-freelancer/projektliste?aufgaben=SAP+FI%2FCO"
        );
    }

    #[test]
    fn a_project_gives_its_sections_and_facts() {
        let url = Url::parse(
            "https://www.solcom.de/fuer-freiberufler/projektliste/1083900-azure-architekt",
        )
        .unwrap();
        let link = Solcom.job_link(&url).unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Solcom.guest_page(AD, "/", &link)
        else {
            panic!("no text");
        };
        assert!(text.contains("Aufgaben\n"), "{text}");
        assert!(text.contains("Terraform"), "{text}");
        assert!(text.contains("Must-haves"), "{text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "Azure Architekt");
        assert_eq!(fields.location, "Remote");
        assert_eq!(facts.employment_type.as_deref(), Some("Freiberuflich"));
        assert_eq!(facts.industries.as_deref(), Some("Informationstechnologie"));
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_pages_read() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let list = std::fs::read_to_string(dir.join("solcom-list.html")).unwrap();
        assert!(Solcom.search_page(&list).unwrap().len() >= 50);
        let ad = std::fs::read_to_string(dir.join("solcom-ad.html")).unwrap();
        let url = Url::parse(
            "https://www.solcom.de/fuer-freiberufler/projektliste/1083900-azure-architekt",
        )
        .unwrap();
        let link = Solcom.job_link(&url).unwrap();
        assert!(matches!(
            Solcom.guest_page(&ad, "/", &link),
            PageOutcome::Text { .. }
        ));
    }
}
