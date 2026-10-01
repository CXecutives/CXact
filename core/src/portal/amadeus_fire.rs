//! Amadeus Fire (amadeus-fire.de): a staffing company for accounting, controlling, treasury and
//! finance with an interim management line. The app reads its public job directory itself
//! (user decision 2026-10-01): its job search is drawn in the browser from a file the
//! robots.txt of its data host forbids, so the app reads the sitemap that host allows
//! (`daten.amadeus-fire.de/packages/jobtoolControlling/`, about 6,000 jobs, the robots.txt of
//! that host checked at run time, [`PortalAdapter::search_robots_url`]) and keeps the interim
//! and project roles (most of the rest are permanent posts): their address names them.
//!
//! A job is `/jobs/<slug>-<number>` on www.amadeus-fire.de, its page server-drawn with a
//! JSON-LD `JobPosting` (title, text in parts, place, contract, the number as its identifier).
//! The client stays unnamed: Amadeus Fire places the interim manager.

use std::sync::LazyLock;

use scraper::Html;
use serde_json::Value;
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobKey, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    host_and_segments, host_is, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct AmadeusFire;

const DOMAIN: &str = "amadeus-fire.de";
const ORIGIN: &str = "https://www.amadeus-fire.de/";
/// The job directory its data host's robots.txt allows (its `Sitemap:` line names it).
const DIRECTORY: &str =
    "https://daten.amadeus-fire.de/packages/jobtoolControlling/jobtool2xml.php?jobsite=19";
const PARSER_VERSION: u32 = 1;
/// Words of an address that make the job an interim or project role.
const ROLE_WORDS: [&str; 5] = [
    "interim",
    "projekt",
    "projektmanager",
    "freelance",
    "freiberuflich",
];
/// The gender mark of an address (`m-w-d`, `w-m-d`, ...): the title ends before it.
const GENDER_MARKS: [&str; 4] = ["m-w-d", "w-m-d", "d-m-w", "m-f-d"];

impl PortalAdapter for AmadeusFire {
    fn portal(&self) -> Portal {
        Portal::AmadeusFire
    }
    fn key(&self) -> &'static str {
        "amadeusfire"
    }
    fn label(&self) -> &'static str {
        "amadeus-fire.de"
    }
    fn monogram(&self) -> &'static str {
        "AF"
    }
    fn file_tag(&self) -> &'static str {
        "Amadeus Fire"
    }
    fn home_url(&self) -> &'static str {
        ORIGIN
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["amadeus-fire"]
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

    /// The directory, once (its interim roles are all finance: the terms pick nothing out);
    /// none without a term, like every search.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        if terms.iter().all(|term| term.trim().is_empty()) {
            return Vec::new();
        }
        Url::parse(DIRECTORY).into_iter().collect()
    }

    fn search_robots_url(&self) -> Option<&'static str> {
        Some("https://daten.amadeus-fire.de/robots.txt")
    }

    /// The directory's addresses (`<loc>`, each in a CDATA section): the interim and project
    /// roles among them, their title and place from the address until the page tells them.
    fn search_page(&self, xml: &str) -> Result<Vec<Hit>, NoHits> {
        if !xml.contains("<urlset") {
            let doc = Html::parse_document(xml);
            if super::has_challenge(&doc, xml) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        }
        Ok(xml
            .split("<loc>")
            .skip(1)
            .filter_map(|part| part.split("</loc>").next())
            .map(|loc| {
                loc.trim()
                    .trim_start_matches("<![CDATA[")
                    .trim_end_matches("]]>")
                    .trim()
            })
            .filter_map(|loc| Url::parse(loc).ok())
            .filter_map(|url| self.hit(&url))
            .collect())
    }

    /// `/jobs/<slug>-<number>`: the number is the job.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) || host.starts_with("daten.") {
            return None;
        }
        let [jobs, slug] = segments.as_slice() else {
            return None;
        };
        let id = slug.rsplit('-').next()?;
        if jobs != "jobs" || !all_digits(id, 4) {
            return None;
        }
        let mut clean = Url::parse(ORIGIN).ok()?;
        clean.set_path(url.path());
        Some(JobLink {
            key: JobKey {
                portal: Portal::AmadeusFire,
                id: id.to_owned(),
            },
            url: clean,
        })
    }

    /// The address needs the job's slug: none from the number alone.
    fn canonical_url(&self, _id: &str) -> Option<Url> {
        None
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else if path.trim_end_matches('/') == "/jobsuche" || path == "/" {
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
        facts(posting(&Html::parse_document(html)).as_ref())
    }
}

impl AmadeusFire {
    /// A job of the directory when its address names an interim or project role: the words
    /// before the gender mark its title, those after it (up to the number) its place.
    fn hit(&self, url: &Url) -> Option<Hit> {
        let link = self.job_link(url)?;
        let slug = url.path_segments()?.next_back()?;
        let words: Vec<&str> = slug.split('-').collect();
        if !words.iter().any(|word| ROLE_WORDS.contains(word)) {
            return None;
        }
        let rest = slug.rsplit_once('-')?.0;
        let (title, place) = GENDER_MARKS
            .iter()
            .find_map(|mark| rest.split_once(&format!("-{mark}")))
            .map_or((rest, ""), |(title, place)| {
                (title, place.trim_start_matches('-'))
            });
        Some(Hit {
            link,
            title: words_of(title),
            company: String::new(),
            location: words_of(place),
        })
    }
}

/// Words of an address as text: hyphens as spaces, each word with a capital.
fn words_of(slug: &str) -> String {
    slug.split('-')
        .filter(|word| !word.is_empty())
        .map(|word| {
            let mut chars = word.chars();
            chars.next().map_or_else(String::new, |first| {
                first.to_uppercase().chain(chars).collect()
            })
        })
        .collect::<Vec<_>>()
        .join(" ")
}

static JSON_LD: Css = LazyLock::new(|| selector(r#"script[type="application/ld+json"]"#));

/// The job's JSON-LD `JobPosting`, if any.
fn posting(doc: &Html) -> Option<Value> {
    doc.select(&JSON_LD)
        .filter_map(|node| serde_json::from_str::<Value>(&node.text().collect::<String>()).ok())
        .find(|value| value.get("@type").and_then(Value::as_str) == Some("JobPosting"))
}

fn parse(doc: &Html) -> Parsed {
    let posting = posting(doc);
    let field = |name: &str| {
        posting
            .as_ref()
            .and_then(|p| p.get(name))
            .and_then(Value::as_str)
            .map(html_to_text)
            .filter(|text| !text.trim().is_empty())
    };
    // The text in its parts: the description, the tasks, the profile, the skills.
    let parts: Vec<String> = [
        "description",
        "responsibilities",
        "qualifications",
        "skills",
    ]
    .iter()
    .filter_map(|name| field(name))
    .collect();
    let text = (!parts.is_empty()).then(|| parts.join("\n\n"));
    let title = posting
        .as_ref()
        .and_then(|p| p.get("title"))
        .and_then(Value::as_str)
        .map(|title| without_gender_mark(&one_line(title)))
        .unwrap_or_default();
    let location = posting
        .as_ref()
        .and_then(|p| {
            p.pointer("/jobLocation/address/addressLocality")
                .or_else(|| p.pointer("/jobLocation/0/address/addressLocality"))
        })
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

/// The contract of the posting: an interim role is interim, a contractor's freelance.
fn facts(posting: Option<&Value>) -> Facts {
    let title = posting
        .and_then(|p| p.get("title"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    let kind = posting
        .and_then(|p| p.get("employmentType"))
        .and_then(|kind| {
            kind.as_str()
                .or_else(|| kind.get(0).and_then(Value::as_str))
        })
        .unwrap_or_default();
    Facts {
        employment_type: if title.contains("interim") {
            Facts::value("Interim")
        } else if kind == "CONTRACTOR" {
            Facts::value("Freiberuflich")
        } else {
            None
        },
        ..Facts::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The directory as its data host serves it (2026-10-01), shortened: a permanent post, an
    /// interim role, a project role and an address that is no job.
    const DIRECTORY_XML: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
<url><loc><![CDATA[ https://www.amadeus-fire.de/jobs/treasurer-m-w-d-frankfurt-am-main-244259]]></loc><lastmod><![CDATA[ 2026-09-30T08:59:59+00:00 ]]></lastmod></url>
<url><loc><![CDATA[ https://www.amadeus-fire.de/jobs/interim-controller-m-w-d-muenchen-252709]]></loc></url>
<url><loc><![CDATA[ https://www.amadeus-fire.de/jobs/projektmanager-finance-transformation-w-m-d-hamburg-251100]]></loc></url>
<url><loc><![CDATA[ https://www.amadeus-fire.de/karriere]]></loc></url>
</urlset>"#;

    /// A job page as Amadeus Fire serves it (2026-10-01), shortened to its JSON-LD.
    const AD: &str = r#"<html><head><script type="application/ld+json">{"@context":"https://schema.org","@type":"JobPosting",
      "title":"Interim Controller (m/w/d)","description":"<p>Für unseren Kunden suchen wir einen Interim Controller.</p>",
      "responsibilities":"<ul><li>Monatsabschluss nach HGB und IFRS</li></ul>","qualifications":"<ul><li>Erfahrung im Konzerncontrolling</li></ul>",
      "employmentType":"FULL_TIME","identifier":{"@type":"PropertyValue","name":"Amadeus Fire","value":"252709"},
      "hiringOrganization":{"@type":"Organization","name":"Amadeus Fire AG"},
      "jobLocation":{"@type":"Place","address":{"@type":"PostalAddress","addressLocality":"München"}}}</script></head><body></body></html>"#;

    #[test]
    fn the_directory_gives_its_interim_and_project_roles() {
        let urls = AmadeusFire.search_urls(&["Controlling".to_owned()]);
        assert_eq!(urls.len(), 1);
        assert_eq!(urls[0].host_str(), Some("daten.amadeus-fire.de"));
        assert!(AmadeusFire.search_urls(&[" ".to_owned()]).is_empty());
        let hits = AmadeusFire.search_page(DIRECTORY_XML).unwrap();
        assert_eq!(
            hits.len(),
            2,
            "no permanent post, no address that is no job"
        );
        assert_eq!(hits[0].link.key.id, "252709");
        assert_eq!(hits[0].title, "Interim Controller");
        assert_eq!(hits[0].location, "Muenchen");
        assert_eq!(
            hits[0].link.url.as_str(),
            "https://www.amadeus-fire.de/jobs/interim-controller-m-w-d-muenchen-252709"
        );
        assert_eq!(hits[1].title, "Projektmanager Finance Transformation");
        assert_eq!(hits[1].location, "Hamburg");
        assert_eq!(
            AmadeusFire.search_page("<html><body>Wartung</body></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
    }

    #[test]
    fn a_job_page_reads_from_its_posting() {
        let url =
            Url::parse("https://www.amadeus-fire.de/jobs/interim-controller-m-w-d-muenchen-252709")
                .unwrap();
        let link = AmadeusFire.job_link(&url).unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = AmadeusFire.guest_page(AD, "/", &link)
        else {
            panic!("a text");
        };
        let fields = fields.unwrap();
        assert!(text.contains("Interim Controller"));
        assert!(text.contains("Monatsabschluss nach HGB und IFRS"));
        assert!(text.contains("Konzerncontrolling"));
        assert_eq!(fields.title, "Interim Controller");
        assert_eq!(fields.location, "München");
        assert_eq!(fields.company, "");
        assert_eq!(facts.employment_type.as_deref(), Some("Interim"));
        // Not a job: another page of the site, the data host.
        for other in [
            "https://www.amadeus-fire.de/karriere",
            "https://daten.amadeus-fire.de/jobs/x-252709",
            "https://www.example.de/jobs/x-252709",
        ] {
            assert!(
                AmadeusFire.job_link(&Url::parse(other).unwrap()).is_none(),
                "{other}"
            );
        }
    }
}
