//! Robert Half (roberthalf.com/de): finance, IT and interim roles in Germany. The app searches
//! its job pages itself (user decision 2026-10-01: the user gets no alert mails of it): one
//! page per term, `/de/de/jobs/deutschland/<term>` (the pages its sitemap lists), and keeps
//! the interim and project roles (most are placements into a permanent post or temporary
//! work). The robots.txt allows the search and the jobs (checked at run time); its alert mails
//! are read where they come.
//!
//! A job is `/de/de/job/<place>/<slug>/<office>-<number>-dede`: the office (5 digits) and the
//! number (10 digits) make its key, and any place and slug lead to it. Its page is one
//! `rhcl-job-card`: the title, the ad as escaped HTML, and a list of facts (place, remote,
//! kind of contract).

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    host_and_segments, host_is, keyword_slug, link, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct RobertHalf;

const DOMAIN: &str = "roberthalf.com";
const ORIGIN: &str = "https://www.roberthalf.com/";
const PARSER_VERSION: u32 = 1;
/// The office part of a job's key, then its number.
const OFFICE_DIGITS: usize = 5;
const NUMBER_DIGITS: usize = 10;
/// The German site's suffix of a job.
const LOCALE: &str = "dede";
/// The kinds of contract the search keeps (`Interim Management`; no `Personalvermittlung`,
/// no `Zeitarbeit`).
const PROJECTS: [&str; 3] = ["interim", "projekt", "freiberuf"];

impl PortalAdapter for RobertHalf {
    fn portal(&self) -> Portal {
        Portal::RobertHalf
    }
    fn key(&self) -> &'static str {
        "roberthalf"
    }
    fn label(&self) -> &'static str {
        "roberthalf.com"
    }
    fn monogram(&self) -> &'static str {
        "rh"
    }
    fn file_tag(&self) -> &'static str {
        "Robert Half"
    }
    fn home_url(&self) -> &'static str {
        "https://www.roberthalf.com/de/de"
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN, "roberthalf.de"]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["robert half"]
    }
    fn limits(&self) -> Limits {
        Limits {
            pace_ms: 4_000..=8_000,
            per_hour: 30,
            per_day: 100,
        }
    }
    fn access(&self) -> Access {
        Access::Guest
    }
    fn checks_robots(&self) -> bool {
        true
    }
    fn way(&self) -> Way {
        Way::Search
    }

    /// One page per term, all over Germany.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .map(|term| keyword_slug(term))
            .filter(|slug| !slug.is_empty())
            .filter_map(|slug| {
                Url::parse(ORIGIN)
                    .ok()?
                    .join(&format!("de/de/jobs/deutschland/{slug}"))
                    .ok()
            })
            .collect()
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        // The search's own block, also when it found nothing ("0 Jobergebnisse").
        if doc.select(&RESULTS).next().is_none() {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        }
        Ok(doc.select(&CARD).filter_map(hit).collect())
    }

    /// `/de/de/job/<place>/<slug>/<office>-<number>-dede`.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        match segments.as_slice() {
            [country, language, job, _, _, last]
                if country == "de" && language == "de" && job == "job" =>
            {
                let mut parts = last.split('-');
                let (office, number) = (parts.next()?, parts.next()?);
                let fits = all_digits(office, OFFICE_DIGITS)
                    && office.len() == OFFICE_DIGITS
                    && all_digits(number, NUMBER_DIGITS)
                    && number.len() == NUMBER_DIGITS
                    && parts.next() == Some(LOCALE)
                    && parts.next().is_none();
                fits.then(|| link(Portal::RobertHalf, format!("{office}{number}")))?
            }
            _ => None,
        }
    }

    /// Any place and slug lead to the job: the key's office and number decide.
    fn canonical_url(&self, id: &str) -> Option<Url> {
        if id.len() != OFFICE_DIGITS + NUMBER_DIGITS || !all_digits(id, 1) {
            return None;
        }
        let (office, number) = id.split_at(OFFICE_DIGITS);
        Url::parse(&format!(
            "{ORIGIN}de/de/job/de/job/{office}-{number}-{LOCALE}"
        ))
        .ok()
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else if path.contains("/jobs") || path.contains("suche") {
            // A job that has gone leads back to the search.
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
        facts(&Html::parse_document(html))
    }
}

static RESULTS: Css = LazyLock::new(|| selector(".jobsearch"));
static CARD: Css = LazyLock::new(|| selector("rhcl-job-card"));
static TITLE: Css = LazyLock::new(|| selector("[slot=headline]"));
static TEXT: Css = LazyLock::new(|| {
    selector("[data-testid=job-details-description], [data-testid=job-details-requirements]")
});
static INFO: Css = LazyLock::new(|| selector("[slot=job-info] > li[data-subslot]"));

/// The ad: its parts hold the HTML escaped, as text.
fn parse(doc: &Html) -> Parsed {
    let card = doc.select(&CARD).next();
    let text = card.and_then(|card| {
        let parts: Vec<String> = card
            .select(&TEXT)
            .map(|part| html_to_text(&part.text().collect::<String>()))
            .filter(|part| !part.trim().is_empty())
            .collect();
        (!parts.is_empty()).then(|| parts.join("\n\n"))
    });
    let title = card
        .and_then(|card| card.select(&TITLE).next())
        .map(|node| without_gender_mark(&one_line(&node.text().collect::<String>())))
        .unwrap_or_default();
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title,
            // The client stays unnamed: Robert Half places the candidate.
            company: String::new(),
            location: info(doc, "location").unwrap_or_default(),
        },
        facts: facts(doc),
    }
}

/// A job of the search: an interim or project role, with its title and place.
fn hit(card: ElementRef<'_>) -> Option<Hit> {
    let kind = info_of(card.select(&INFO), "type")?.to_lowercase();
    if !PROJECTS.iter().any(|word| kind.contains(word)) {
        return None;
    }
    let anchor = card.select(&TITLE).next()?;
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    Some(Hit {
        link: RobertHalf.job_link(&url)?,
        title: without_gender_mark(&one_line(&anchor.text().collect::<String>())),
        company: String::new(),
        location: info_of(card.select(&INFO), "location").unwrap_or_default(),
    })
}

/// One fact of the card's list by its name.
fn info(doc: &Html, name: &str) -> Option<String> {
    info_of(doc.select(&INFO), name)
}

fn info_of<'a>(mut items: impl Iterator<Item = ElementRef<'a>>, name: &str) -> Option<String> {
    items
        .find(|item| item.value().attr("data-subslot") == Some(name))
        .map(|item: ElementRef<'_>| one_line(&item.text().collect::<String>()))
        .filter(|value| !value.is_empty())
}

/// The kind of contract and the remote share. A placement ("Personalvermittlung") is a
/// permanent post with the client: the engine reads it as such.
fn facts(doc: &Html) -> Facts {
    let mut facts = Facts::default();
    if let Some(kind) = info(doc, "type") {
        facts.employment_type = if kind.eq_ignore_ascii_case("Personalvermittlung") {
            Facts::value(&format!("Festanstellung ({kind})"))
        } else {
            Facts::value(&kind)
        };
    }
    if let Some(site) = info(doc, "worksite")
        && site != "onsite"
    {
        facts.set_remote(&site);
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const AD: &str = r#"<html><body><div id="joblisting"><div>
      <rhcl-job-card job-id="60030-0013516669-dede" variant="listing">
      <a href="https://www.roberthalf.com/de/de/job/köln-nordrhein-westfalen/leitung-finanzbuchhaltung-wmd/60030-0013516669-dede" slot="headline">
      Leitung Finanzbuchhaltung (w/m/d)
      </a>
      <div slot="description" data-testid="job-details-description">
      &lt;p&gt;Für unseren Kunden suchen wir eine &lt;strong&gt;Leitung der Finanzbuchhaltung&lt;/strong&gt;.&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Führung eines Finance-Teams&lt;/li&gt;&lt;li&gt;Monats- und Jahresabschlüsse&lt;/li&gt;&lt;/ul&gt;
      </div>
      <div slot="requirements" data-testid="job-details-requirements"></div>
      <ul slot="job-info">
      <li data-subslot="location">Köln, Nordrhein-Westfalen</li>
      <li data-subslot="worksite">remote</li>
      <li data-subslot="type">Personalvermittlung</li>
      </ul>
      </rhcl-job-card></div></div></body></html>"#;

    fn ad_link() -> JobLink {
        RobertHalf
            .job_link(
                &Url::parse(
                    "https://www.roberthalf.com/de/de/job/k%C3%B6ln-nordrhein-westfalen/leitung-finanzbuchhaltung-wmd/60030-0013516669-dede",
                )
                .unwrap(),
            )
            .unwrap()
    }

    #[test]
    fn its_links_carry_office_and_number() {
        let link = ad_link();
        assert_eq!(link.key.id, "600300013516669");
        assert_eq!(
            link.url.as_str(),
            "https://www.roberthalf.com/de/de/job/de/job/60030-0013516669-dede"
        );
        for other in [
            "https://www.roberthalf.com/de/de/jobs",
            "https://www.roberthalf.com/us/en/job/austin-tx/accountant/03720-0013420011-usen",
            "https://www.roberthalf.com/de/de/job/köln/x/60030-0013516669-dech",
            "https://www.roberthalf.com/de/de/job/köln/x/6003-0013516669-dede",
            "https://www.example.com/de/de/job/köln/x/60030-0013516669-dede",
        ] {
            assert!(
                RobertHalf.job_link(&Url::parse(other).unwrap()).is_none(),
                "{other}"
            );
        }
    }

    #[test]
    fn the_search_keeps_the_interim_roles() {
        let urls = RobertHalf.search_urls(&["Interim CFO".to_owned(), "–".to_owned()]);
        assert_eq!(
            urls.iter().map(Url::as_str).collect::<Vec<_>>(),
            ["https://www.roberthalf.com/de/de/jobs/deutschland/interim-cfo"]
        );
        let card = |id: &str, kind: &str| {
            format!(
                r#"<rhcl-job-card job-id="06640-{id}-dede" variant="card">
                <a href="https://www.roberthalf.com/de/de/job/frankfurt-am-main-hessen/cfo-wmd/06640-{id}-dede" slot="headline">Interim CFO (w/m/d)</a>
                <ul slot="job-info"><li data-subslot="location">Frankfurt am Main, Hessen</li>
                <li data-subslot="type">{kind}</li></ul></rhcl-job-card>"#
            )
        };
        let page = format!(
            r#"<div class="jobsearch aem-GridColumn">{}{}{}</div>"#,
            card("0013512443", "Interim Management"),
            card("0013512444", "Personalvermittlung"),
            card("0013512445", "Zeitarbeit"),
        );
        let hits = RobertHalf.search_page(&page).unwrap();
        assert_eq!(hits.len(), 1, "placements and temporary work stay out");
        assert_eq!(hits[0].link.key.id, "066400013512443");
        assert_eq!(hits[0].title, "Interim CFO");
        assert_eq!(hits[0].location, "Frankfurt am Main, Hessen");
        assert_eq!(
            RobertHalf.search_page(r#"<div class="jobsearch"><p>0 Jobergebnisse</p></div>"#),
            Ok(Vec::new())
        );
        assert_eq!(
            RobertHalf.search_page("<html><body></body></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
    }

    #[test]
    fn a_job_gives_its_text_and_facts() {
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = RobertHalf.guest_page(AD, "/", &ad_link())
        else {
            panic!("no text");
        };
        assert!(text.contains("Leitung der Finanzbuchhaltung"), "{text}");
        assert!(text.contains("Jahresabschlüsse"), "{text}");
        assert!(!text.contains("<p>"), "{text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "Leitung Finanzbuchhaltung");
        assert_eq!(fields.location, "Köln, Nordrhein-Westfalen");
        assert_eq!(
            facts.employment_type.as_deref(),
            Some("Festanstellung (Personalvermittlung)")
        );
        assert_eq!(facts.remote.as_deref(), Some("remote"));
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_page_reads() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let ad = std::fs::read_to_string(dir.join("rh-ad.html")).unwrap();
        let PageOutcome::Text { text, fields, .. } = RobertHalf.guest_page(&ad, "/", &ad_link())
        else {
            panic!("no text");
        };
        assert!(text.len() > 1000, "{text}");
        assert!(
            fields
                .unwrap()
                .title
                .starts_with("Leitung Finanzbuchhaltung")
        );
        let search = std::fs::read_to_string(dir.join("rh-search-icfo.html")).unwrap();
        let hits = RobertHalf.search_page(&search).unwrap();
        assert!(hits.len() <= 25, "{}", hits.len());
        let empty = std::fs::read_to_string(dir.join("rh-search-empty.html")).unwrap();
        assert_eq!(RobertHalf.search_page(&empty), Ok(Vec::new()));
    }
}
