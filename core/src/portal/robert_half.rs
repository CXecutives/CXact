//! Robert Half (roberthalf.com/de): finance, IT and interim roles in Germany. Its jobs come by
//! alert mail (user decision 2026-10-01: its search is not searched); the robots.txt allows
//! the job pages (checked at run time).
//!
//! A job is `/de/de/job/<place>/<slug>/<office>-<number>-dede`: the office (5 digits) and the
//! number (10 digits) make its key, and any place and slug lead to it. Its page is one
//! `rhcl-job-card`: the title, the ad as escaped HTML, and a list of facts (place, remote,
//! kind of contract).

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use url::Url;

use super::{
    Access, Css, Facts, JobLink, Portal, PortalAdapter, all_digits, host_and_segments, host_is,
    link, selector, without_gender_mark,
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
    /// Its job search, where an alert is set up.
    fn setup_url(&self) -> &'static str {
        "https://www.roberthalf.com/de/de/jobs"
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

/// One fact of the card's list by its name.
fn info(doc: &Html, name: &str) -> Option<String> {
    doc.select(&INFO)
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
    }
}
