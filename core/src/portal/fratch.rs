//! FRATCH (fratch.io): a platform for freelance and interim mandates (interim controlling,
//! restructuring, transformation). The app reads its public project list itself (user
//! decision 2026-10-01): one page per fetch with every open project (about 30, all freelance:
//! the terms pick nothing out), as a JSON-LD `ItemList` of names and addresses. Its
//! robots.txt allows everything (checked at run time).
//!
//! A project is `/<lang>/projects/<slug>`: the slug is its only name, so its key is a hash of
//! it ([`PortalAdapter::hashed_ids`]); its page carries a JSON-LD `JobPosting` (title, text,
//! country or place, start, contract). The client stays unnamed ("confidential").

use std::sync::LazyLock;

use scraper::Html;
use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobKey, JobLink, NoHits, Portal, PortalAdapter, Way, hex12,
    host_and_segments, host_is, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct Fratch;

const DOMAIN: &str = "fratch.io";
const ORIGIN: &str = "https://fratch.io/";
const PARSER_VERSION: u32 = 1;

impl PortalAdapter for Fratch {
    fn portal(&self) -> Portal {
        Portal::Fratch
    }
    fn key(&self) -> &'static str {
        "fratch"
    }
    fn label(&self) -> &'static str {
        "fratch.io"
    }
    fn monogram(&self) -> &'static str {
        "fr"
    }
    fn file_tag(&self) -> &'static str {
        "FRATCH"
    }
    fn home_url(&self) -> &'static str {
        "https://fratch.io/de/projects"
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["fratch"]
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
    fn hashed_ids(&self) -> bool {
        true
    }

    /// The list of its open projects, once; none without a term, like every search.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        if terms.iter().all(|term| term.trim().is_empty()) {
            return Vec::new();
        }
        Url::parse(self.home_url()).into_iter().collect()
    }

    /// The list's JSON-LD `ItemList`: each project's name and address.
    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        let Some(list) = json_ld(&doc, "ItemList") else {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        };
        Ok(list
            .get("itemListElement")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| {
                let url = Url::parse(item.get("url")?.as_str()?).ok()?;
                Some(Hit {
                    link: self.job_link(&url)?,
                    title: without_gender_mark(&one_line(item.get("name")?.as_str()?)),
                    company: String::new(),
                    location: String::new(),
                })
            })
            .collect())
    }

    /// `/<lang>/projects/<slug>`: the slug (the same in every language) is the project.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        let [_, projects, slug] = segments.as_slice() else {
            return None;
        };
        if projects != "projects" || slug.is_empty() {
            return None;
        }
        let hash = Sha256::digest(format!("{DOMAIN}/projects/{slug}").as_bytes());
        Some(JobLink {
            key: JobKey {
                portal: Portal::Fratch,
                id: format!("u{}", hex12(&hash)),
            },
            url: Url::parse(&format!("{ORIGIN}de/projects/{slug}")).ok()?,
        })
    }

    /// The address needs the slug: none from its hash.
    fn canonical_url(&self, _id: &str) -> Option<Url> {
        None
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") || path.contains("signin") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else if path.trim_end_matches('/').ends_with("/projects") {
            PageOutcome::Gone
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
        facts(json_ld(&Html::parse_document(html), "JobPosting").as_ref())
    }
}

static JSON_LD: Css = LazyLock::new(|| selector(r#"script[type="application/ld+json"]"#));

/// The page's JSON-LD block of that type, if any.
fn json_ld(doc: &Html, kind: &str) -> Option<Value> {
    doc.select(&JSON_LD)
        .filter_map(|node| serde_json::from_str::<Value>(&node.text().collect::<String>()).ok())
        .find(|value| value.get("@type").and_then(Value::as_str) == Some(kind))
}

fn parse(doc: &Html) -> Parsed {
    let posting = json_ld(doc, "JobPosting");
    let text = posting
        .as_ref()
        .and_then(|p| p.get("description"))
        .and_then(Value::as_str)
        .map(html_to_text)
        .filter(|text| !text.trim().is_empty());
    let title = posting
        .as_ref()
        .and_then(|p| p.get("title"))
        .and_then(Value::as_str)
        .map(|title| without_gender_mark(&one_line(title)))
        .unwrap_or_default();
    let address = |name: &str| {
        posting
            .as_ref()
            .and_then(|p| p.pointer(&format!("/jobLocation/address/{name}")))
            .and_then(Value::as_str)
            .map(one_line)
            .filter(|value| !value.is_empty())
    };
    let location = address("addressLocality")
        .or_else(|| address("addressCountry"))
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

/// Every project is freelance; the start where the posting names it.
fn facts(posting: Option<&Value>) -> Facts {
    Facts {
        employment_type: Facts::value("Freiberuflich"),
        start: posting
            .and_then(|p| p.get("jobStartDate"))
            .and_then(Value::as_str)
            .and_then(Facts::value),
        ..Facts::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The project list as FRATCH serves it (2026-10-01), shortened to its JSON-LD.
    const LIST: &str = r#"<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"ItemList","numberOfItems":2,
      "itemListElement":[{"@type":"ListItem","position":1,"name":"Product Owner (m/w/d)","url":"https://fratch.io/de/projects/product-owner-mwd-y"},
      {"@type":"ListItem","position":2,"name":"Interim Manager für KI-gestütztes Controlling (m/w/d)","url":"https://fratch.io/de/projects/interim-manager-fur-ki-gestutztes-controlling"}]}</script></head><body></body></html>"#;

    /// A project page as FRATCH serves it (2026-10-01), shortened to its JSON-LD.
    const AD: &str = r#"<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
      "url":"https://fratch.io/de/projects/interim-manager-fur-ki-gestutztes-controlling","title":"Interim Manager für KI-gestütztes Controlling",
      "description":"<p>Ein Unternehmen in Bayern sucht einen erfahrenen Interim Manager für das Controlling.</p>",
      "hiringOrganization":{"@type":"Organization","name":"confidential"},"jobStartDate":"2026-11-01","employmentType":["CONTRACTOR"],
      "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressCountry":"DE"}}}</script></head><body></body></html>"#;

    #[test]
    fn the_list_gives_every_project() {
        let urls = Fratch.search_urls(&["Controlling".to_owned()]);
        assert_eq!(urls[0].as_str(), "https://fratch.io/de/projects");
        let hits = Fratch.search_page(LIST).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(
            hits[1].title,
            "Interim Manager für KI-gestütztes Controlling"
        );
        assert!(hits[1].link.key.id.starts_with('u'));
        // The same project in English is the same job.
        let english = Url::parse(
            "https://fratch.io/en/projects/interim-manager-fur-ki-gestutztes-controlling",
        )
        .unwrap();
        assert_eq!(Fratch.job_link(&english).unwrap(), hits[1].link);
        assert_eq!(
            Fratch.search_page("<html><body>Wartung</body></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
    }

    #[test]
    fn a_project_page_reads_from_its_posting() {
        let link = Fratch
            .job_link(
                &Url::parse(
                    "https://fratch.io/de/projects/interim-manager-fur-ki-gestutztes-controlling",
                )
                .unwrap(),
            )
            .unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Fratch.guest_page(AD, "/", &link)
        else {
            panic!("a text");
        };
        let fields = fields.unwrap();
        assert!(text.contains("Interim Manager für das Controlling"));
        assert_eq!(
            fields.title,
            "Interim Manager für KI-gestütztes Controlling"
        );
        assert_eq!(fields.location, "DE");
        assert_eq!(fields.company, "");
        assert_eq!(facts.employment_type.as_deref(), Some("Freiberuflich"));
        assert_eq!(facts.start.as_deref(), Some("2026-11-01"));
    }
}
