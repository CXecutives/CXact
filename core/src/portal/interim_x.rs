//! interim-x (interim-x.com): interim management mandates of a Horváth company. The app reads
//! its public project list itself (user decision 2026-10-01: the user gets no project mails
//! of it, they need an accreditation): one page per fetch, every project on it (all interim).
//! It has no robots.txt (everything allowed, checked at run time); its mails are read where
//! they come.
//!
//! A project is `/de/projekt/<slug>-<id>` (`/en/project/...` in English); a short slug leads
//! to the full one (301 on the same host). Its page names the role ("Position"), the
//! project's facts in labelled boxes (day rate, duration, country, place, industry) and its
//! text in two cards (tasks and goals, requirements). The client stays unnamed.

use std::sync::LazyLock;

use scraper::{ElementRef, Html, Node};
use url::Url;

use super::{
    Access, Css, Facts, Hit, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits,
    host_and_segments, host_is, link, selector, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct InterimX;

const DOMAIN: &str = "interim-x.com";
const ORIGIN: &str = "https://www.interim-x.com/";
const PARSER_VERSION: u32 = 1;

impl PortalAdapter for InterimX {
    fn portal(&self) -> Portal {
        Portal::InterimX
    }
    fn key(&self) -> &'static str {
        "interimx"
    }
    fn label(&self) -> &'static str {
        "interim-x.com"
    }
    fn monogram(&self) -> &'static str {
        "ix"
    }
    fn file_tag(&self) -> &'static str {
        "interim-x"
    }
    fn home_url(&self) -> &'static str {
        "https://www.interim-x.com/de/projekte"
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["interim-x"]
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
    fn projects_only(&self) -> bool {
        true
    }
    fn way(&self) -> Way {
        Way::Search
    }

    /// The list of its open projects, once (a handful, all interim: the terms pick nothing
    /// out); none without a term, like every search.
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        if terms.iter().all(|term| term.trim().is_empty()) {
            return Vec::new();
        }
        Url::parse(self.home_url()).into_iter().collect()
    }

    fn search_page(&self, html: &str) -> Result<Vec<Hit>, NoHits> {
        let doc = Html::parse_document(html);
        if doc.select(&PROJECT).next().is_none() {
            if super::has_challenge(&doc, html) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        }
        Ok(doc.select(&LIST_CARD).filter_map(hit).collect())
    }

    /// `/<lang>/projekt/<slug>-<id>` or `/<lang>/project/<slug>-<id>`.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        match segments.as_slice() {
            [_, kind, slug] if kind == "projekt" || kind == "project" => {
                let id = slug.rsplit('-').next()?;
                all_digits(id, 1).then(|| link(Portal::InterimX, id.to_owned()))?
            }
            _ => None,
        }
    }

    /// A placeholder slug: the site leads to the project's own (301, same host).
    fn canonical_url(&self, id: &str) -> Option<Url> {
        if !all_digits(id, 1) {
            return None;
        }
        Url::parse(&format!("{ORIGIN}de/projekt/projekt-{id}")).ok()
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") || path.contains("anmeldung") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else if path.contains("seite-nicht-gefunden")
            || path.trim_end_matches('/') == "/de/projekte"
        {
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

static PROJECT: Css = LazyLock::new(|| selector(".tx-imx-projects"));
static LIST_CARD: Css = LazyLock::new(|| selector(".card.project > a[href]"));
static LIST_ROLE: Css = LazyLock::new(|| selector(".project-position"));
static LIST_PLACE: Css = LazyLock::new(|| selector("[title=Einsatzort] .detail-item"));
static HEADING: Css = LazyLock::new(|| selector("h1.title"));
static ROLE_LABEL: Css = LazyLock::new(|| selector("#job-basics h3"));
static BOX_LABEL: Css = LazyLock::new(|| selector(".tx-imx-projects h4"));
static CARDS: Css =
    LazyLock::new(|| selector("#job-tasks .card-content, #job-requirements .card-content"));

/// A project of the list: its role and place.
fn hit(anchor: ElementRef<'_>) -> Option<Hit> {
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    let text = |css: &Css| {
        anchor
            .select(css)
            .next()
            .map(|node| one_line(&node.text().collect::<String>()))
            .unwrap_or_default()
    };
    Some(Hit {
        link: InterimX.job_link(&url)?,
        title: without_gender_mark(&text(&LIST_ROLE)),
        company: String::new(),
        location: text(&LIST_PLACE),
    })
}

/// The labelled boxes of the page: each label (`h4`) with the rest of its box.
fn boxes(doc: &Html) -> Vec<(String, String)> {
    doc.select(&BOX_LABEL)
        .filter_map(|label| {
            let name = one_line(&label.text().collect::<String>());
            let parent = label.parent().and_then(ElementRef::wrap)?;
            let all = one_line(&parent.text().collect::<String>());
            let value = all
                .strip_prefix(name.as_str())
                .unwrap_or(&all)
                .trim()
                .to_owned();
            Some((name, value))
        })
        .collect()
}

/// The role: the text after the label "Position", up to the next element.
fn role(doc: &Html) -> Option<String> {
    let label = doc
        .select(&ROLE_LABEL)
        .find(|node| one_line(&node.text().collect::<String>()) == "Position")?;
    let text: String = label
        .next_siblings()
        .take_while(|node| !matches!(node.value(), Node::Element(_)))
        .filter_map(|node| node.value().as_text().map(|t| t.to_string()))
        .collect();
    let role = without_gender_mark(&one_line(&text));
    (!role.is_empty()).then_some(role)
}

fn parse(doc: &Html) -> Parsed {
    let text = doc.select(&PROJECT).next().and_then(|_| {
        let parts: Vec<String> = doc
            .select(&CARDS)
            .map(|card| html_to_text(&card.html()))
            .filter(|part| !part.trim().is_empty())
            .collect();
        (!parts.is_empty()).then(|| parts.join("\n\n"))
    });
    let title = role(doc)
        .or_else(|| {
            doc.select(&HEADING)
                .next()
                .map(|node| one_line(&node.text().collect::<String>()))
        })
        .unwrap_or_default();
    let place = boxes(doc)
        .into_iter()
        .filter(|(name, value)| {
            (name == "Einsatzort" || name == "Einsatzland") && value != "nicht veröffentlicht"
        })
        .map(|(_, value)| value)
        .next()
        .unwrap_or_default();
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title,
            company: String::new(),
            location: place,
        },
        facts: facts(doc),
    }
}

/// The boxes: the day rate, the duration (its first date the start), the industry; every
/// mandate is interim.
fn facts(doc: &Html) -> Facts {
    let mut facts = Facts {
        employment_type: Facts::value("Interim"),
        ..Facts::default()
    };
    for (name, value) in boxes(doc) {
        match name.as_str() {
            "Tagessatz" => facts.rate = Facts::value(&value),
            "Laufzeit" => {
                facts.start = value.split(" - ").next().and_then(Facts::value);
                facts.duration = Facts::value(&value);
            }
            "Branche" => facts.industries = Facts::value(&value),
            "Funktion" => facts.function = Facts::value(&value),
            _ => {}
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const AD: &str = r#"<html><body>
      <section class="page-header"><span class="category">Projekt &#8470; 2391</span><h1 class="title">Beratung bei der Optimierung von Dynamic Pricing</h1></section>
      <div class="tx-imx-projects"><section>
      <div id="job-basics" class="row"><div class="card-content">
        <h2 class="h3 card-title"><span>Allgemeine Projektdaten</span></h2>
        <h3 class="h4"><translate class="hidden"></translate>Position</h3>Senior Pricing Advisor (m/w/d) ad interim
        <hr class="on-dark"/>
        <div class="row">
          <div class="col-sm-4"><h4 class="h5"><translate class="hidden"></translate>Tagessatz</h4>
          nach Vereinbarung</div>
          <div class="col-sm-4"><h4 class="h5">Laufzeit</h4>
          19.10.2026
          -
          31.01.2027</div>
        </div>
        <div class="row">
          <div class="col-sm-4"><h4 class="h5">Einsatzland</h4>Deutschland</div>
          <div class="col-sm-4"><h4 class="h5">Einsatzort</h4>nicht veröffentlicht</div>
          <div class="col-sm-4"><h4 class="h5">Branche</h4>Transport &amp; Logistik</div>
        </div>
      </div></div>
      <div id="job-tasks" class="row"><div class="card-content">
        <h3 class="h4">Aufgabenstellung</h3><p>Unser Mandant sucht einen erfahrenen Pricing Advisor.</p>
        <ul><li>Entwicklung eines Pricing-Ansatzes</li></ul>
      </div></div>
      <div id="job-requirements" class="row"><div class="card-content">
        <h3 class="h4">Anforderungen</h3><ul><li>Erfahrung in Revenue Management</li></ul>
      </div></div>
      </section></div></body></html>"#;

    fn ad_link() -> JobLink {
        InterimX
            .job_link(
                &Url::parse("https://www.interim-x.com/de/projekt/senior_pricing_advisor_mwd-2391")
                    .unwrap(),
            )
            .unwrap()
    }

    #[test]
    fn its_links_carry_the_project_number() {
        let link = ad_link();
        assert_eq!(link.key.id, "2391");
        assert_eq!(
            link.url.as_str(),
            "https://www.interim-x.com/de/projekt/projekt-2391"
        );
        let english =
            Url::parse("https://interim-x.com/en/project/pricing_advisor-2391?utm=mail").unwrap();
        assert_eq!(InterimX.job_link(&english).unwrap().key, link.key);
        for other in [
            "https://www.interim-x.com/de/projekte",
            "https://www.interim-x.com/de/projekt/ohne_nummer",
            "https://www.example.com/de/projekt/x-2391",
        ] {
            assert!(
                InterimX.job_link(&Url::parse(other).unwrap()).is_none(),
                "{other}"
            );
        }
    }

    #[test]
    fn the_list_gives_every_project() {
        assert!(InterimX.search_urls(&[]).is_empty());
        assert_eq!(
            InterimX
                .search_urls(&["Interim CFO".to_owned(), "Controlling".to_owned()])
                .iter()
                .map(Url::as_str)
                .collect::<Vec<_>>(),
            ["https://www.interim-x.com/de/projekte"]
        );
        let list = r#"<div class="tx-imx-projects"><div class="row project-list">
          <div class="card project" id="current-project-{{ project.id }}">
          <a title="Klicken" href="/de/projekt/senior_pricing_advisor_mwd_ad_interim-2391"><div class="card-body">
          <div class="h4 bold project-position">Senior Pricing Advisor (m/w/d)</div>
          <div class="project-detail" title="Einsatzort"><div class="detail-item"><i></i>
          Deutschland</div></div></div></a></div></div></div>"#;
        let hits = InterimX.search_page(list).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].link.key.id, "2391");
        assert_eq!(hits[0].title, "Senior Pricing Advisor");
        assert_eq!(hits[0].location, "Deutschland");
        assert_eq!(
            InterimX.search_page(r#"<div class="tx-imx-projects"></div>"#),
            Ok(Vec::new())
        );
        assert_eq!(
            InterimX.search_page("<html></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
    }

    #[test]
    fn a_project_gives_its_role_text_and_facts() {
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = InterimX.guest_page(AD, "/", &ad_link())
        else {
            panic!("no text");
        };
        assert!(text.contains("Pricing-Ansatzes"), "{text}");
        assert!(text.contains("Revenue Management"), "{text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "Senior Pricing Advisor (m/w/d) ad interim");
        assert_eq!(fields.location, "Deutschland");
        assert_eq!(facts.employment_type.as_deref(), Some("Interim"));
        assert_eq!(facts.rate.as_deref(), Some("nach Vereinbarung"));
        assert_eq!(facts.start.as_deref(), Some("19.10.2026"));
        assert_eq!(facts.duration.as_deref(), Some("19.10.2026 - 31.01.2027"));
        assert_eq!(facts.industries.as_deref(), Some("Transport & Logistik"));
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_page_reads() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        let ad = std::fs::read_to_string(dir.join("ix-ad.html")).unwrap();
        let PageOutcome::Text { text, fields, .. } = InterimX.guest_page(&ad, "/", &ad_link())
        else {
            panic!("no text");
        };
        assert!(text.len() > 500, "{text}");
        assert!(fields.unwrap().title.starts_with("Senior Pricing Advisor"));
        let list = std::fs::read_to_string(dir.join("ix-list.html")).unwrap();
        assert!(!InterimX.search_page(&list).unwrap().is_empty());
    }
}
