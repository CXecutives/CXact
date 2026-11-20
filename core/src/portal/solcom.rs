//! SOLCOM (solcom.de): IT, SAP and engineering projects for freelancers. The app searches its
//! public project list itself (user decision 2026-10-01), one page per term through its own
//! keyword field (`aufgaben`); the robots.txt allows the list and the projects (checked at run
//! time).
//!
//! A hit is `article.project-offer-card`: its link, its title after the project number, its
//! place among the card's facts; a project is `/fuer-freiberufler/projektliste/<id>-<slug>`
//! (the slug belongs to the address: the link of the hit is kept), its text the sections of
//! `.solcom-text` under their headings (without the page's footer), its start, duration and
//! place in its Eckdaten, its title, contract and industry in its JSON-LD.

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
        "SO"
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

    fn parse_facts(&self, html: &str) -> Facts {
        facts(&Html::parse_document(html))
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
/// A fact of the ad's Eckdaten.
static META_ROW: Css = LazyLock::new(|| selector(".meta-row"));
static ICON: Css = LazyLock::new(|| selector("svg path"));

/// "1083900 Azure Architekt" reads as "Azure Architekt".
fn without_number(title: &str) -> String {
    let title = title.trim();
    let rest = title
        .trim_start_matches(|c: char| c.is_ascii_digit())
        .trim_start();
    without_gender_mark(if rest.is_empty() { title } else { rest })
}

/// A card of the list: its link, its title and its place (the fact under the map pin; a
/// card without a place has none).
fn hit(card: ElementRef<'_>) -> Option<Hit> {
    let anchor = card.select(&CARD_LINK).next()?;
    let url = Url::parse(ORIGIN)
        .ok()?
        .join(anchor.value().attr("href")?)
        .ok()?;
    let facts = meta(card.select(&CARD_FACT));
    Some(Hit {
        link: Solcom.job_link(&url)?,
        title: without_number(&anchor.text().collect::<String>()),
        // The client stays unnamed: SOLCOM places the freelancer.
        company: String::new(),
        location: fact(&facts, Fact::Place).unwrap_or_default(),
        contract: None,
    })
}

/// What a fact of a card or of the ad's Eckdaten names.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Fact {
    Number,
    Duration,
    Start,
    Place,
    /// The contract or the workload (both under a briefcase), or an icon not known.
    Other,
}

/// The facts' icons (the start of their path): a hash, a clock, a calendar, a map pin.
const ICONS: [(&str, Fact); 4] = [
    ("M224,88H", Fact::Number),
    ("M128,40a", Fact::Duration),
    ("M208,32H", Fact::Start),
    ("M128,64a", Fact::Place),
];
/// The facts' order where they come without icons; a card without a place leaves it out.
const ORDER: [Fact; 4] = [Fact::Number, Fact::Duration, Fact::Start, Fact::Place];

/// The facts of a card or of the Eckdaten, each with what it names: by its icon, or without
/// icons by its place in the row.
fn meta<'a>(items: impl Iterator<Item = ElementRef<'a>>) -> Vec<(Fact, String)> {
    let items: Vec<(Option<String>, String)> = items
        .map(|item| {
            let icon = item
                .select(&ICON)
                .next()
                .and_then(|path| path.value().attr("d"))
                .map(str::to_owned);
            (icon, one_line(&item.text().collect::<String>()))
        })
        .collect();
    let icons = items.iter().any(|(icon, _)| icon.is_some());
    items
        .into_iter()
        .enumerate()
        .map(|(index, (icon, value))| {
            let kind = if icons {
                icon.and_then(|icon| {
                    ICONS
                        .iter()
                        .find(|(start, _)| icon.starts_with(start))
                        .map(|&(_, kind)| kind)
                })
                .unwrap_or(Fact::Other)
            } else {
                ORDER.get(index).copied().unwrap_or(Fact::Other)
            };
            (kind, value)
        })
        .filter(|(_, value)| !value.is_empty())
        .collect()
}

/// The first fact of that kind.
fn fact(facts: &[(Fact, String)], kind: Fact) -> Option<String> {
    facts
        .iter()
        .find(|(k, _)| *k == kind)
        .map(|(_, value)| value.clone())
}

/// The project's JSON-LD `JobPosting`, if any.
fn posting(doc: &Html) -> Option<Value> {
    doc.select(&JSON_LD)
        .filter_map(|node| serde_json::from_str::<Value>(&node.text().collect::<String>()).ok())
        .find(|value| value.get("@type").and_then(Value::as_str) == Some("JobPosting"))
}

fn parse(doc: &Html) -> Parsed {
    // The Eckdaten heading stands alone (its facts are facts), the footer names SOLCOM.
    let sections: Vec<String> = doc
        .select(&SECTION_TEXT)
        .filter(|section| !in_footer(*section))
        .filter(|section| one_line(&section.text().collect::<String>()) != "Eckdaten")
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
    let location = fact(&meta(doc.select(&META_ROW)), Fact::Place)
        .or_else(|| {
            posting
                .as_ref()
                .and_then(|p| p.pointer("/jobLocation/address/addressLocality"))
                .and_then(Value::as_str)
                .map(one_line)
        })
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

/// Is the element part of the page's footer?
fn in_footer(element: ElementRef<'_>) -> bool {
    element
        .ancestors()
        .filter_map(ElementRef::wrap)
        .any(|ancestor| ancestor.value().name() == "footer")
}

/// The start and the duration of the Eckdaten, the contract and the industry of the
/// project's JSON-LD.
fn facts(doc: &Html) -> Facts {
    let posting = posting(doc);
    let posting = posting.as_ref();
    let eckdaten = meta(doc.select(&META_ROW));
    let mut facts = Facts {
        start: fact(&eckdaten, Fact::Start).and_then(|value| Facts::value(&value)),
        duration: fact(&eckdaten, Fact::Duration).and_then(|value| Facts::value(&value)),
        ..Facts::default()
    };
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

    /// One fact as the page draws it: its icon (the start of its path) and its value.
    fn row(icon: &str, value: &str) -> String {
        format!(
            r#"<div class="meta-row"><div><svg viewBox="0 0 256 256"><path d="{icon},8Z"/></svg></div><span class="meta-row__value">{value}</span></div>"#
        )
    }

    /// The start, the duration and the place come from the Eckdaten, by their icons in
    /// whatever order; the footer is no part of the ad.
    #[test]
    fn the_eckdaten_give_start_duration_and_place() {
        let eckdaten = [
            ("M224,88H", "1083899"),
            ("M128,40a", "6 MM++"),
            ("M208,32H", "05.10.2026"),
            ("M216,56H", "freiberuflich"),
            ("M128,64a", "Remote und Hamburg"),
            ("M220,158", "50"),
        ]
        .map(|(icon, value)| row(icon, value))
        .concat();
        let ad = AD.replace(
            "<body><h1>Projektdetails</h1>",
            &format!(
                r#"<body><h1>Projektdetails</h1><div><div class="solcom-text">Eckdaten</div><div>{eckdaten}</div></div>"#
            ),
        )
        .replace(
            "</body>",
            r#"<footer><div class="solcom-text"><p>SOLCOM GmbH, Kontakt</p></div><div class="solcom-text"><p>© 2026 SOLCOM GmbH</p></div></footer></body>"#,
        );
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
        } = Solcom.guest_page(&ad, "/", &link)
        else {
            panic!("no text");
        };
        assert!(text.starts_with("Aufgaben\n"), "{text}");
        assert!(!text.contains("SOLCOM GmbH"), "{text}");
        assert_eq!(fields.unwrap().location, "Remote und Hamburg");
        assert_eq!(facts.start.as_deref(), Some("05.10.2026"));
        assert_eq!(facts.duration.as_deref(), Some("6 MM++"));
        assert_eq!(Solcom.parse_facts(&ad), facts);
        // A card without a place names none (its fourth fact is the contract).
        let card = format!(
            r#"<div class="view-project-offers-listing"><article class="project-offer-card"><a href="/fuer-freiberufler/projektliste/1083901-sap-basis" class="project-offer-card__title-link">1083901 SAP Basis</a><ul>{}</ul></article></div>"#,
            [
                ("M224,88H", "1083901"),
                ("M128,40a", "6 MM"),
                ("M208,32H", "01.11.2026"),
                ("M216,56H", "freiberuflich")
            ]
            .map(|(icon, value)| format!(
                r#"<li class="project-offer-card__meta-item"><svg><path d="{icon},8Z"/></svg><span>{value}</span></li>"#
            ))
            .concat()
        );
        let hits = Solcom.search_page(&card).unwrap();
        assert_eq!(hits[0].location, "");
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
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Solcom.guest_page(&ad, "/", &link)
        else {
            panic!("no text");
        };
        assert!(!text.contains("© 2026"), "no footer: {text}");
        assert!(!fields.unwrap().location.is_empty());
        assert!(
            facts.start.is_some() && facts.duration.is_some(),
            "{facts:?}"
        );
    }
}
