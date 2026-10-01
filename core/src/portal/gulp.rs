//! GULP (gulp.de, Randstad): IT, engineering and finance projects. The app searches its
//! project exchange itself as its page does (user decision 2026-10-01: the user gets no alert
//! mails of it): one POST of the term to `/gulp2/rest/internal/projects/search`, the newest 20
//! hits. The robots.txt allows the search, the project pages and the data they load (checked
//! at run time); its alert mails are read where they come.
//!
//! A project is `/gulp2/g/projekte/agentur/C<number>` (GULP's own) or
//! `/gulp2/g/projekte/talentfinder/<24 hex>` (another agency's, through GULP). The page is
//! drawn in the browser from its data, `/gulp2/rest/internal/projects/{agency,direkt}/<id>`:
//! the app reads that data as the page does. GULP's own carry their number as the key, the
//! others a hash of their address (their id is no number).

use serde_json::Value;
use sha2::{Digest, Sha256};
use url::Url;

use super::{
    Access, Facts, Hit, JobKey, JobLink, NoHits, Portal, PortalAdapter, Way, all_digits, hex12,
    host_and_segments, host_is, link, without_gender_mark,
};
use crate::fetch::policy::Limits;
use crate::fetch::{Cause, PageFields, PageOutcome, Parsed, judge};
use crate::text::{html_to_text, one_line};

pub(super) struct Gulp;

const DOMAIN: &str = "gulp.de";
const ORIGIN: &str = "https://www.gulp.de/";
const PARSER_VERSION: u32 = 1;
/// The id of another agency's project (a database id).
const FOREIGN_ID_LEN: usize = 24;
/// The project exchange's search (a POST of the term, as its page sends it).
const SEARCH: &str = "https://www.gulp.de/gulp2/rest/internal/projects/search";
/// So many hits of a term, the newest first.
const SEARCH_HITS: u32 = 20;

impl PortalAdapter for Gulp {
    fn portal(&self) -> Portal {
        Portal::Gulp
    }
    fn key(&self) -> &'static str {
        "gulp"
    }
    fn label(&self) -> &'static str {
        "gulp.de"
    }
    fn monogram(&self) -> &'static str {
        "gu"
    }
    fn file_tag(&self) -> &'static str {
        "GULP"
    }
    fn home_url(&self) -> &'static str {
        ORIGIN
    }
    fn sender_domains(&self) -> &'static [&'static str] {
        &[DOMAIN]
    }
    fn search_terms(&self) -> &'static [&'static str] {
        &["gulp"]
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
    fn hashed_ids(&self) -> bool {
        true
    }
    fn way(&self) -> Way {
        Way::Search
    }

    /// One search per term; the term rides in the address's query (the POST sends it in its
    /// body, [`Gulp::search_body`]).
    fn search_urls(&self, terms: &[String]) -> Vec<Url> {
        terms
            .iter()
            .filter(|term| !term.trim().is_empty())
            .filter_map(|term| {
                let mut url = Url::parse(SEARCH).ok()?;
                url.query_pairs_mut().append_pair("query", term.trim());
                Some(url)
            })
            .collect()
    }

    /// The query as the page sends it: the term, the newest first, in German.
    fn search_body(&self, url: &Url) -> Option<String> {
        let term = url
            .query_pairs()
            .find(|(name, _)| name == "query")
            .map(|(_, value)| value.into_owned())?;
        Some(
            serde_json::json!({
                "query": term,
                "page": 1,
                "limit": SEARCH_HITS,
                "order": "DATE_DESC",
                "countries": [],
                "cities": [],
                "language": "DE",
                "remote": false,
                "projectTypes": [],
            })
            .to_string(),
        )
    }

    fn search_page(&self, body: &str) -> Result<Vec<Hit>, NoHits> {
        let Ok(data) = serde_json::from_str::<Value>(body) else {
            let doc = scraper::Html::parse_document(body);
            if super::has_challenge(&doc, body) {
                return Err(NoHits::Blocked(Cause::Captcha));
            }
            return Err(NoHits::Suspicious(Cause::PageNotRecognised));
        };
        let projects = data
            .get("projects")
            .and_then(Value::as_array)
            .ok_or(NoHits::Suspicious(Cause::PageNotRecognised))?;
        Ok(projects.iter().filter_map(hit).collect())
    }

    /// `/gulp2/g/projekte/agentur/C<number>` and `/gulp2/g/projekte/talentfinder/<24 hex>`.
    fn job_link(&self, url: &Url) -> Option<JobLink> {
        let (host, segments) = host_and_segments(url)?;
        if !host_is(&host, DOMAIN) {
            return None;
        }
        let segments: Vec<&str> = segments.iter().map(String::as_str).collect();
        match segments.as_slice() {
            ["gulp2", "g", "projekte", "agentur", id] => {
                let number = id.strip_prefix(['C', 'c'])?;
                all_digits(number, 1).then(|| link(Portal::Gulp, number.to_owned()))?
            }
            ["gulp2", "g", "projekte", "talentfinder", id] if is_foreign_id(id) => {
                let id = id.to_ascii_lowercase();
                let hash = Sha256::digest(format!("{DOMAIN}/talentfinder/{id}").as_bytes());
                Some(JobLink {
                    key: JobKey {
                        portal: Portal::Gulp,
                        id: format!("u{}", hex12(&hash)),
                    },
                    url: Url::parse(&format!("{ORIGIN}gulp2/g/projekte/talentfinder/{id}")).ok()?,
                })
            }
            _ => None,
        }
    }

    fn canonical_url(&self, id: &str) -> Option<Url> {
        if !all_digits(id, 1) {
            return None;
        }
        Url::parse(&format!("{ORIGIN}gulp2/g/projekte/agentur/C{id}")).ok()
    }

    /// The data the project's page loads.
    fn fetch_url(&self, link: &JobLink) -> Url {
        let segments: Vec<&str> = link
            .url
            .path_segments()
            .map(Iterator::collect)
            .unwrap_or_default();
        let data = match segments.as_slice() {
            [.., "agentur", id] => format!("agency/{id}"),
            [.., "talentfinder", id] => format!("direkt/{id}"),
            _ => return link.url.clone(),
        };
        Url::parse(&format!(
            "{ORIGIN}gulp2/rest/internal/projects/{data}?language=DE"
        ))
        .unwrap_or_else(|_| link.url.clone())
    }

    fn redirect_outcome(&self, path: &str) -> PageOutcome {
        if path.contains("login") {
            PageOutcome::Blocked(Cause::LoginWall)
        } else {
            PageOutcome::Suspicious(Cause::RedirectNotFollowed)
        }
    }

    fn guest_page(&self, body: &str, _path: &str, _link: &JobLink) -> PageOutcome {
        let Ok(data) = serde_json::from_str::<Value>(body) else {
            let doc = scraper::Html::parse_document(body);
            if super::has_challenge(&doc, body) {
                return PageOutcome::Blocked(Cause::Captcha);
            }
            return PageOutcome::Suspicious(Cause::PageNotRecognised);
        };
        judge(parse(&data))
    }

    fn parser_version(&self) -> u32 {
        PARSER_VERSION
    }

    fn parse_facts(&self, body: &str) -> Facts {
        serde_json::from_str::<Value>(body)
            .map(|data| facts(&data))
            .unwrap_or_default()
    }
}

/// A project of the search: its address (or the one its id and kind make), title, place and,
/// for another agency's, that agency.
fn hit(project: &Value) -> Option<Hit> {
    let own = project.get("type").and_then(Value::as_str) == Some("AGENCY");
    let address = field(project, "url").or_else(|| {
        let id = field(project, "id")?;
        Some(if own {
            format!("{ORIGIN}gulp2/g/projekte/agentur/{id}")
        } else {
            format!("{ORIGIN}gulp2/g/projekte/talentfinder/{id}")
        })
    })?;
    Some(Hit {
        link: Gulp.job_link(&Url::parse(&address).ok()?)?,
        title: without_gender_mark(&field(project, "title")?),
        company: if own {
            String::new()
        } else {
            field(project, "companyName").unwrap_or_default()
        },
        location: field(project, "location").unwrap_or_default(),
    })
}

fn is_foreign_id(id: &str) -> bool {
    id.len() == FOREIGN_ID_LEN && id.bytes().all(|b| b.is_ascii_hexdigit())
}

/// A text field of the data, one line.
fn field(data: &Value, name: &str) -> Option<String> {
    data.get(name)
        .and_then(Value::as_str)
        .map(one_line)
        .filter(|value| !value.is_empty())
}

/// The `JobPosting` the page puts in its head (a JSON text inside the data).
fn posting(data: &Value) -> Value {
    data.get("metaJobPosting")
        .and_then(Value::as_str)
        .and_then(|text| serde_json::from_str(text).ok())
        .unwrap_or(Value::Null)
}

fn parse(data: &Value) -> Parsed {
    let posting = posting(data);
    // The posting's description holds the intro, the tasks and the requirements; the data's
    // own only the intro (GULP's own) or the same (another agency's).
    let text = [data.get("description"), posting.get("description")]
        .into_iter()
        .filter_map(|value| value.and_then(Value::as_str))
        .map(html_to_text)
        .filter(|text| !text.trim().is_empty())
        .max_by_key(String::len);
    // Another agency's project names that agency; GULP's own name no client.
    let company = if data.get("type").and_then(Value::as_str) == Some("AGENCY") {
        String::new()
    } else {
        field(data, "companyName").unwrap_or_default()
    };
    Parsed {
        text,
        closed: false,
        fields: PageFields {
            title: field(data, "title")
                .map(|title| without_gender_mark(&title))
                .unwrap_or_default(),
            company,
            location: field(data, "location").unwrap_or_default(),
        },
        facts: facts(data),
    }
}

/// The start, the duration, the industry, the skills, remote work and the kind of contract
/// (the summary of GULP's own says "in Festanstellung" where it is one).
fn facts(data: &Value) -> Facts {
    let posting = posting(data);
    let summary = field(data, "metaDescription").unwrap_or_default();
    let kind = ["Festanstellung", "Arbeitnehmerüberlassung"]
        .into_iter()
        .find(|word| summary.contains(word))
        .unwrap_or("Freiberuflich");
    let mut facts = Facts {
        employment_type: Facts::value(kind),
        start: field(data, "startDate"),
        duration: field(data, "duration"),
        industries: field(&posting, "industry"),
        ..Facts::default()
    };
    if data.get("remoteWorkPossible").and_then(Value::as_bool) == Some(true)
        || field(data, "location").as_deref() == Some("Remote")
    {
        facts.set_remote("Remote");
    }
    for list in ["skills", "mustHaveSkills"] {
        for skill in data
            .get(list)
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
        {
            facts.add_skill(skill);
        }
    }
    facts
}

#[cfg(test)]
mod tests {
    use super::*;

    const OWN: &str = r#"{"id":"C01344448","type":"AGENCY","title":"Senior Expert Sterilherstellung (m/w/d)",
      "location":"85276 Pfaffenhofen an der Ilm","companyName":"GULP Gruppe","startDate":"19.10.2026",
      "duration":"unbefristet","description":"<p>Unser Kunde sucht einen Senior Expert.</p>",
      "metaDescription":"Für ein Kundenprojekt in 85276 Pfaffenhofen an der Ilm suchen wir zum 19.10.2026 in Festanstellung einen Experten wie Sie.",
      "skills":["Mind. 5 Jahre Erfahrung im GMP-regulierten Umfeld"],
      "metaJobPosting":"{\"@type\":\"JobPosting\",\"industry\":\"Medizin/Pharma/Biotech\",\"description\":\"<p>Unser Kunde sucht einen Senior Expert.</p><br><ul><li>Analyse von Abweichungen inkl. CAPA</li></ul><br><ul><li>Mind. 5 Jahre Erfahrung im GMP-regulierten Umfeld</li></ul>\"}"}"#;

    const FOREIGN: &str = r#"{"id":"6abd43a340b5a3a29f35d9c0","type":"TALENT_FINDER","title":"1083900 Azure Architekt",
      "location":"Remote","companyName":"SOLCOM GmbH","startDate":"05.10.2026","duration":"6 MM++",
      "remoteWorkPossible":true,"mustHaveSkills":[],
      "description":"Unser Kunde ist auf der Suche nach einem Azure Architekten, der die Migration begleitet.",
      "metaDescription":"Für ein Kundenprojekt in Remote suchen wir zum 05.10.2026 für die Dauer von 6 MMn einen Experten."}"#;

    fn url(text: &str) -> Url {
        Url::parse(text).unwrap()
    }

    #[test]
    fn its_links_and_the_data_they_load() {
        let own = Gulp
            .job_link(&url(
                "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448?utm_source=agent",
            ))
            .unwrap();
        assert_eq!(own.key.id, "01344448");
        assert_eq!(
            own.url.as_str(),
            "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448"
        );
        assert_eq!(
            Gulp.fetch_url(&own).as_str(),
            "https://www.gulp.de/gulp2/rest/internal/projects/agency/C01344448?language=DE"
        );
        let foreign = Gulp
            .job_link(&url(
                "https://gulp.de/gulp2/g/projekte/talentfinder/6ABD43A340B5A3A29F35D9C0",
            ))
            .unwrap();
        assert!(foreign.key.id.starts_with('u') && foreign.key.id.len() == 13);
        assert!(!foreign.key.has_portal_id());
        assert_eq!(
            Gulp.fetch_url(&foreign).as_str(),
            "https://www.gulp.de/gulp2/rest/internal/projects/direkt/6abd43a340b5a3a29f35d9c0?language=DE"
        );
        // The key goes through the store and back.
        assert_eq!(JobKey::parse(&foreign.key.to_string()), Some(foreign.key));
        for other in [
            "https://www.gulp.de/gulp2/g/projekte",
            "https://www.gulp.de/gulp2/g/jobs/C01338563",
            "https://www.gulp.de/gulp2/g/projekte/agentur/X01344448",
            "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43",
            "https://www.example.com/gulp2/g/projekte/agentur/C01344448",
        ] {
            assert!(Gulp.job_link(&url(other)).is_none(), "{other}");
        }
    }

    #[test]
    fn gulp_s_own_project_reads_from_its_data() {
        let link = Gulp.job_link(&url(
            "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448",
        ));
        let PageOutcome::Text {
            text,
            fields,
            facts,
            ..
        } = Gulp.guest_page(OWN, "/", &link.unwrap())
        else {
            panic!("no text");
        };
        assert!(text.contains("CAPA"), "the posting's longer text: {text}");
        let fields = fields.unwrap();
        assert_eq!(fields.title, "Senior Expert Sterilherstellung");
        assert_eq!(fields.company, "", "GULP's own name no client");
        assert_eq!(fields.location, "85276 Pfaffenhofen an der Ilm");
        assert_eq!(facts.employment_type.as_deref(), Some("Festanstellung"));
        assert_eq!(facts.start.as_deref(), Some("19.10.2026"));
        assert_eq!(facts.industries.as_deref(), Some("Medizin/Pharma/Biotech"));
        assert_eq!(facts.skills.len(), 1);
    }

    #[test]
    fn another_agency_s_project_names_it() {
        let link = Gulp.job_link(&url(
            "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43a340b5a3a29f35d9c0",
        ));
        let PageOutcome::Text { fields, facts, .. } = Gulp.guest_page(FOREIGN, "/", &link.unwrap())
        else {
            panic!("no text");
        };
        assert_eq!(fields.unwrap().company, "SOLCOM GmbH");
        assert_eq!(facts.employment_type.as_deref(), Some("Freiberuflich"));
        assert_eq!(facts.duration.as_deref(), Some("6 MM++"));
        assert_eq!(facts.remote.as_deref(), Some("Remote"));
    }

    #[test]
    fn the_search_posts_its_term_and_reads_the_projects() {
        let urls = Gulp.search_urls(&["SAP FI/CO".to_owned(), " ".to_owned()]);
        assert_eq!(urls.len(), 1, "an empty term searches nothing");
        assert_eq!(
            urls[0].as_str(),
            "https://www.gulp.de/gulp2/rest/internal/projects/search?query=SAP+FI%2FCO"
        );
        let body: Value = serde_json::from_str(&Gulp.search_body(&urls[0]).unwrap()).unwrap();
        assert_eq!(body["query"], "SAP FI/CO");
        assert_eq!(body["order"], "DATE_DESC");
        let page = r#"{"totalCount":2,"projects":[
          {"id":"C01329404","type":"AGENCY","title":"SAP S/4HANA O2C Consultant (m/w/d)","location":"Hamburg","companyName":null,"url":"https://www.gulp.de/gulp2/g/projekte/agentur/C01329404"},
          {"id":"6abd43a340b5a3a29f35d9c0","type":"TALENT_FINDER","title":"Azure Architekt","location":"Remote","companyName":"SOLCOM GmbH","url":null}]}"#;
        let hits = Gulp.search_page(page).unwrap();
        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].link.key.id, "01329404");
        assert_eq!(hits[0].title, "SAP S/4HANA O2C Consultant");
        assert_eq!(hits[0].company, "");
        assert_eq!(hits[1].company, "SOLCOM GmbH");
        assert!(
            hits[1]
                .link
                .url
                .path()
                .ends_with("/talentfinder/6abd43a340b5a3a29f35d9c0")
        );
        assert_eq!(
            Gulp.search_page(r#"{"totalCount":0,"projects":[]}"#),
            Ok(Vec::new())
        );
        assert_eq!(
            Gulp.search_page("<html><body></body></html>"),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
        assert_eq!(
            Gulp.search_page(r#"{"status":500}"#),
            Err(NoHits::Suspicious(Cause::PageNotRecognised))
        );
    }

    #[test]
    fn a_page_instead_of_its_data_is_not_read() {
        let link = Gulp
            .job_link(&url(
                "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448",
            ))
            .unwrap();
        assert_eq!(
            Gulp.guest_page(
                "<html><body><app-root></app-root></body></html>",
                "/",
                &link
            ),
            PageOutcome::Suspicious(Cause::PageNotRecognised)
        );
    }

    #[test]
    #[ignore = "reads the private pages under core/tests/fixtures/private"]
    fn the_real_data_reads() {
        let dir =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/private/pages");
        for (file, address) in [
            (
                "gulp-agency.json",
                "https://www.gulp.de/gulp2/g/projekte/agentur/C01344448",
            ),
            (
                "gulp-direkt.json",
                "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43a340b5a3a29f35d9c0",
            ),
        ] {
            let body = std::fs::read_to_string(dir.join(file)).unwrap();
            let link = Gulp.job_link(&url(address)).unwrap();
            let PageOutcome::Text { text, .. } = Gulp.guest_page(&body, "/", &link) else {
                panic!("{file}: no text");
            };
            assert!(text.len() > 400, "{file}: {text}");
        }
    }
}
