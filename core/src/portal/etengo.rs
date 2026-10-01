//! Etengo (etengo.de): IT, SAP and PMO projects for freelancers. The app searches its public
//! project search itself (user decision 2026-10-01), one page per term (`search`); the
//! robots.txt allows the search and the projects (checked at run time).
//!
//! A hit is `div.card-project` with its link and title (the client's place stays hidden: "DE
//! XXXXX"); a project is `/it-projektsuche/<id>/`, its text the description beside the facts,
//! its facts the list of the aside (start, duration, workload, industry).

use std::sync::LazyLock;

use scraper::{ElementRef, Html};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits, definitions,
    host_and_segments, host_is, link, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct Etengo;

const DOMAIN: &str = "etengo.de";
const ORIGIN: &str = "https://www.etengo.de/";
const PARSER_VERSION: u32 = 1;

impl PortalAdapter for Etengo {
    fn portal(&self) -> Portal {
        Portal::Etengo
    }
    fn key(&self) -> &'static str {
        "etengo"
    }
    fn label(&self) -> &'static str {
        "etengo.de"
    }
    fn monogram(&self) -> &'static str {
        "et"
    }
    fn file_tag(&self) -> &'static str {
        "Etengo"
    }
    fn home_url(&self) -> &'static str {
        ORIGIN
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["etengo"]
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
    fn way(&self) -> Way {
        Way::Search
    }
    fn checks_robots(&self) -> bool {
        true
    }
    fn projects_only(&self) -> bool {
        true
    }

    /// `/it-projektsuche/<id>/`.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        match segments.as_slice() {
            [area, id] if area == "it-projektsuche" && all_digits(id, 4) => {
                link(Portal::Etengo, id.clone())
            }
            _ => None,
        }
    }

    fn canonical_url(&self, id: &str) -> Option<Url> {
        if !all_digits(id, 4) {
            return None;
        }
        Url::parse(&format!("{ORIGIN}it-projektsuche/{id}/")).ok()
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else if path.trim_end_matches('/') == "/it-projektsuche" {
            // A project that has gone leads back to the search.
            PageOutcome::Gone
        } else {
            PageOutcome::Suspicious(Cause::RedirectNotFollowed)
        }
    }

    fn guest_page(&self, html: &str, _path: &str, _link: &JobLink) -> PageOutcome {
        let doc = Html::parse_document(html);
        let parsed = parse(&doc);
        // The page carries a reCAPTCHA script for its forms: only a page without its project
        // is judged as a check.
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

    /// One page per term, through the search's own field.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .filter_map(|term| {
                let mut url = Url::parse(ORIGIN).ok()?.join("it-projektsuche/").ok()?;
                url.query_pairs_mut().append_pair("search", term);
                Some(url)
            })
            .collect()
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        let hits: Vec<Hit> = doc.select(&CARD).filter_map(hit).collect();
        // A search without projects shows no grid, only its own form for a project alert.
        if hits.is_empty()
            && doc.select(&GRID).next().is_none()
            && doc.select(&ALERT_FORM).next().is_none()
        {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        }
        Ok(hits)
    }
}

static GRID: Css = LazyLock::new(|| selector("#project-grid"));
static ALERT_FORM: Css = LazyLock::new(|| selector(".alertform-error"));
static CARD: Css = LazyLock::new(|| selector("div.card-project"));
static CARD_LINK: Css = LazyLock::new(|| selector("h3 a"));
static TITLE: Css = LazyLock::new(|| selector("h1 .headline, h1"));
static TEXT: Css = LazyLock::new(|| selector(".row-projectdetail article"));
static FACTS: Css = LazyLock::new(|| selector(".jobinfos dl"));

fn hit(card: ElementRef<'_>) -> Option<Hit> {
    let anchor = card.select(&CARD_LINK).next()?;
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    Some(Hit {
        link: Etengo.job_link(&url)?,
        title: without_gender_mark(&one_line(&anchor.text().collect::<String>())),
        // The client stays unnamed: Etengo places the freelancer.
        company: String::new(),
        location: String::new(),
    })
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
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title,
            company: String::new(),
            location: String::new(),
        },
        facts: facts(doc),
    }
}

/// The aside's list: the start, the duration, the workload (with its remote share) and the
/// industry.
fn facts(doc: &Html) -> Facts {
    let mut facts = Facts {
        employment_type: Facts::value("Freiberuflich"),
        ..Facts::default()
    };
    for (term, value) in definitions(doc, &FACTS) {
        match term.as_str() {
            "Start" => facts.start = Facts::value(&value),
            "Laufzeit" => facts.duration = Facts::value(&value),
            "Branche" => facts.industries = Facts::value(&value),
            "Auslastung" if value.to_lowercase().contains("remote") => facts.set_remote(&value),
            _ => {}
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const SEARCH: &str = r#"<div id="project-grid" class="grid project-grid"><div class="col col-1-3"><div class="card card-project"><div class="card-content">
      <h3 class="headline-4"><a href="https://www.etengo.de/it-projektsuche/103313/" title="One Identity Manager Developer / IAM Engineer (w/m/d)">One Identity Manager Developer / IAM Engineer (w/m/d)</a></h3>
      <div class="grid"><div class="col col-1-2"><small>Projekt-ID</small> <span>CA-103313</span></div><div class="col col-1-2"><small>PLZ</small> <span>DE XXXXX</span></div></div></div></div></div></div>"#;

    const AD: &str = r#"<html><body><h1 class="headline-1"><span class="headline">One Identity Manager Developer / IAM Engineer (w/m/d)</span></h1>
      <div class="row row-hero-text row-projectdetail"><article class="node"><p>Für unseren Kunden suchen wir einen One Identity Manager Developer.</p>
      <h3 class="headline-4">Aufgaben</h3><p><ul><li>Entwicklung von Identity-Management-Lösungen mit One Identity Manager</li></ul></p></article>
      <aside class="right"><div class="jobinfos"><dl><dt>Start</dt><dd>01.10.2026</dd><dt>Laufzeit</dt><dd>10 Monate</dd><dt>Branche</dt><dd>IT-Services</dd><dt>Auslastung</dt><dd>3 Tage pro Woche remote</dd></dl></div></aside></div></body></html>"#;

    #[test]
    fn the_search_gives_its_cards() {
        let hits = Etengo.search_page(SEARCH).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].link.key.id, "103313");
        assert_eq!(
            hits[0].title,
            "One Identity Manager Developer / IAM Engineer"
        );
        assert_eq!(
            Etengo.search_page(r#"<div id="project-grid"></div>"#),
            Ok(Vec::new())
        );
        // A search without projects: the page with its alert form, no grid.
        assert_eq!(
            Etengo.search_page(r#"<div class="grid alertform-error"></div>"#),
            Ok(Vec::new())
        );
        assert_eq!(
            Etengo.search_page("<html></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
        assert_eq!(
            Etengo.search_urls(&["SAP".to_owned()])[0].as_str(),
            "https://www.etengo.de/it-projektsuche/?search=SAP"
        );
    }

    #[test]
    fn a_project_gives_its_text_and_facts() {
        let link = Etengo
            .job_link(&Url::parse("https://www.etengo.de/it-projektsuche/103313/").unwrap())
            .unwrap();
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Etengo.guest_page(AD, "/", &link)
        else {
            panic!("no text");
        };
        assert!(text.contains("Identity-Management-Lösungen"), "{text}");
        assert_eq!(
            fields.unwrap().title,
            "One Identity Manager Developer / IAM Engineer"
        );
        assert_eq!(facts.start.as_deref(), Some("01.10.2026"));
        assert_eq!(facts.duration.as_deref(), Some("10 Monate"));
        assert_eq!(facts.industries.as_deref(), Some("IT-Services"));
        assert_eq!(facts.remote.as_deref(), Some("3 Tage pro Woche remote"));
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_pages_read() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let list = std::fs::read_to_string(dir.join("etengo-list.html")).unwrap();
        assert!(Etengo.search_page(&list).unwrap().len() >= 10);
        let ad = std::fs::read_to_string(dir.join("etengo-ad.html")).unwrap();
        let link = Etengo
            .job_link(&Url::parse("https://www.etengo.de/it-projektsuche/103313/").unwrap())
            .unwrap();
        assert!(matches!(
            Etengo.guest_page(&ad, "/", &link),
            PageOutcome::Text { .. }
        ));
    }
}
