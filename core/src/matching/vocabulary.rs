//! The engine's words as a person writes them: the suggestions under the profile's fields
//! (the `vocabulary` command). The terms come from the lexicon (the keys of the domain packs
//! and of the core concepts, the job vocabulary, the industries), whose keys are folded
//! (lower case, umlauts as their base letter, stemmed on purpose here and there): a key is
//! shown with its umlauts back (`UMLAUTS`), in title case with small words kept small, its
//! acronyms in capitals and a few names in their own spelling (`SPELLED`). A key that is no
//! term to write (a truncated stem, a typo the engine forgives, a phrase that lost its
//! "of", a false friend, a language, a second spelling) is left out (`HIDDEN`). Whatever is
//! shown folds back to its key, so the engine reads a suggestion as the term it knows.
//!
//! external contract - do not translate: the tables are German and English wording of
//! consultant profiles and job ads.

use std::sync::LazyLock;

use serde::Serialize;

use super::atoms::fold;
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine::CORE_CONCEPTS;
use super::lexicon::{JOB_SKILL_VOCAB, wishes};

/// The terms of the suggestions, each list sorted and without doubles (in any case).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Vocabulary {
    /// Skills, methods, tools and roles: competences, their synonyms, tools, keywords.
    pub skills: Vec<String>,
    /// Industries: the profile's industries and the wished ones.
    pub industries: Vec<String>,
}

/// The vocabulary, built once.
pub fn vocabulary() -> &'static Vocabulary {
    static VOCABULARY: LazyLock<Vocabulary> = LazyLock::new(build);
    &VOCABULARY
}

/// Keys of the job vocabulary that name an industry, not a skill.
const INDUSTRY_SKILLS: &[&str] = &["banken", "gesundheitswesen", "öffentlicher sektor"];

/// Keys that are no term to write.
const HIDDEN: &[&str] = &[
    // Truncated stems and typos the engine forgives.
    "project manag",
    "interim manag",
    "change managment",
    // Phrases that lost their small words (`of`, `&`, `to`) to the folding.
    "absatz produktionsplanung",
    "chemistry manufacturing controls",
    "compensation benefits",
    "corrective preventive action",
    "distribution practice",
    "documentation practice",
    "failure mode effects analysis",
    "financial planning analysis",
    "forschung entwicklung",
    "governance risk compliance",
    "health safety environment",
    "infrastructure code",
    "know customer",
    "korrektur vorbeugemassnahmen",
    "learning development",
    "lohn gehaltsabrechnung",
    "manufacturing practice",
    "mergers acquisition",
    "mergers acquisitions",
    "occupational health safety",
    "out specification",
    "people culture",
    "procure pay",
    "production planning control",
    "produktionsplanung steuerung",
    "purchase pay",
    "reconciliation interests",
    "request proposal",
    "request quotation",
    "research development",
    "sales operations planning",
    "single minute exchange",
    "source pay",
    "herstellungspraxis",
    "vertriebspraxis",
    // Second spellings of a term that is shown.
    "apis",
    "cicd",
    "clean room",
    "computersystem validierung",
    "datawarehouse",
    "datenqualitaet",
    "datenschutz grundverordnung",
    "ecommerce",
    "full-stack",
    "go live",
    "idw-s6",
    "kpis",
    "month end closing",
    "oeffentlicher sektor",
    "private-equity",
    "python3",
    "qliksense",
    "qualitaetsmanagement",
    "reactjs",
    "rest apis",
    "roll out",
    "s4",
    "s4hana",
    "sap fi co",
    "scrummaster",
    "springboot",
    "tsql",
    "us-gaap",
    "vuejs",
    "wirtschaftspruefung",
    "year end closing",
    "zero based budgeting",
    // Words the engine splits apart or reads in a phrase only.
    "anti geldwasche",
    "app entwicklung",
    "automotive branche",
    "co-determination",
    "cpp",
    "dax konzern",
    "dax notiert",
    "dax unternehmen",
    "dev ops",
    "etl strecken",
    "gute-dokumentationspraxis",
    "java script",
    "less",
    "lieferanten management",
    "net",
    "net core",
    "node js",
    "po",
    "rollout intelligenter messsysteme",
    "sigma",
    "613a",
    // False friends, adjectives and words too broad to name a skill.
    "arbeitsrechtlich",
    "automobil",
    "bank",
    "betriebsverfassungsrechtlich",
    "chemical",
    "counsel",
    "dispositionskredit",
    "einkaufsgutschein",
    "einkaufsmoglichkeit",
    "einkaufszentrum",
    "excellence",
    "insurer",
    "kommunal",
    "offentlichen dienst",
    "offentlichen verwaltung",
    "pharmaceutical",
    "revisionssicher",
    "revisionssicherheit",
    "savings",
    "sparkasse",
    "vertrieblich",
    // Languages: the profile names them in its own section.
    "chinesisch",
    "deutsch",
    "english",
    "englisch",
    "franzoesisch",
    "französisch",
    "french",
    "german",
    "italienisch",
    "niederlaendisch",
    "niederländisch",
    "polnisch",
    "portugiesisch",
    "russisch",
    "spanisch",
    "spanish",
    "tuerkisch",
    "türkisch",
];

/// Starts of keys that lost their "of" (`head procurement`, `director finance`).
const HIDDEN_STARTS: &[&str] = &["head ", "director "];

/// Folded word parts and their written form (only a key's letters change: `fold` of the
/// written form is the part again).
const UMLAUTS: &[(&str, &str)] = &[
    ("anderung", "änderung"),
    ("aussen", "außen"),
    ("behord", "behörd"),
    ("bekampf", "bekämpf"),
    ("bevollmachtig", "bevollmächtig"),
    ("effektivitat", "effektivität"),
    ("einkaufer", "einkäufer"),
    ("fuhr", "führ"),
    ("geldwasche", "geldwäsche"),
    ("geschaft", "geschäft"),
    ("gesprach", "gespräch"),
    ("getrank", "getränk"),
    ("kaufmannisch", "kaufmännisch"),
    ("konsumgut", "konsumgüt"),
    ("kunstlich", "künstlich"),
    ("liquiditat", "liquidität"),
    ("losung", "lösung"),
    ("massnahme", "maßnahme"),
    ("offentlich", "öffentlich"),
    ("profitabilitat", "profitabilität"),
    ("qualitat", "qualität"),
    ("rustzeit", "rüstzeit"),
    ("saulen", "säulen"),
    ("ubertrag", "übertrag"),
    ("vergut", "vergüt"),
    ("vorstandin", "vorständin"),
    ("zustandig", "zuständig"),
];

/// Word starts that take an umlaut or ß only there (`grosshandel`, not `progress`).
const UMLAUT_STARTS: &[(&str, &str)] = &[("gross", "groß")];

/// Words that stay small inside a term.
const SMALL: &[&str] = &[
    "a", "an", "and", "as", "at", "by", "das", "dem", "den", "der", "des", "die", "for", "für",
    "im", "in", "mit", "of", "on", "or", "the", "to", "und", "von", "with", "zum", "zur",
];

/// Acronyms with a vowel (a part without one, up to five letters, is an acronym anyway).
const ACRONYMS: &[&str] = &[
    "abac", "abap", "alcoa", "alm", "alv", "aml", "api", "aris", "aws", "banf", "bapi", "bi",
    "capa", "cco", "chro", "cics", "cmo", "co", "cobol", "cpo", "dax", "dpo", "dsgvo", "ebit",
    "ecm", "edi", "eeg", "ehs", "elt", "erm", "erp", "etl", "eu", "ewm", "fi", "gaap", "hana",
    "hse", "iam", "ich", "icfr", "ics", "idw", "ifrs", "ipma", "isms", "iso", "it", "itil", "json",
    "kam", "kpi", "mes", "mlro", "otc", "pmbok", "pmi", "qa", "rest", "rpa", "sap", "soap", "sox",
    "ssis", "ssrs", "togaf", "uft", "us", "vba",
];

/// Words and parts written their own way (brands, laws, methods).
const SPELLED: &[(&str, &str)] = &[
    ("adwords", "AdWords"),
    ("angularjs", "AngularJS"),
    ("asp.net", "ASP.NET"),
    ("betrvg", "BetrVG"),
    ("bizdev", "BizDev"),
    ("bw/4hana", "BW/4HANA"),
    ("cgmp", "cGMP"),
    ("co-om", "CO-OM"),
    ("co-pa", "CO-PA"),
    ("co-pc", "CO-PC"),
    ("devops", "DevOps"),
    ("ecmascript", "ECMAScript"),
    ("eudralex", "EudraLex"),
    ("fi-aa", "FI-AA"),
    ("fi-ap", "FI-AP"),
    ("fi-ar", "FI-AR"),
    ("gitlab", "GitLab"),
    ("gxp", "GxP"),
    ("hermes", "HERMES"),
    ("hinschg", "HinSchG"),
    ("iac", "IaC"),
    ("idoc", "IDoc"),
    ("imsys", "iMSys"),
    ("inso", "InsO"),
    ("iot", "IoT"),
    ("javascript", "JavaScript"),
    ("k8s", "K8s"),
    ("lksg", "LkSG"),
    ("medtech", "MedTech"),
    ("mongodb", "MongoDB"),
    ("nodejs", "NodeJS"),
    ("postgresql", "PostgreSQL"),
    ("prince2", "PRINCE2"),
    ("qlikview", "QlikView"),
    ("react.js", "React.js"),
    ("restful", "RESTful"),
    ("s/4hana", "S/4HANA"),
    ("safe", "SAFe"),
    ("salesforce.com", "Salesforce.com"),
    ("sapscript", "SAPscript"),
    ("servicenow", "ServiceNow"),
    ("sharepoint", "SharePoint"),
    ("starug", "StaRUG"),
    ("typescript", "TypeScript"),
    ("vue.js", "Vue.js"),
];

fn build() -> Vocabulary {
    let skills = DOMAINS
        .iter()
        .flat_map(|domain| domain.concepts.iter().map(|(key, _)| *key))
        .chain(CORE_CONCEPTS.iter().map(|(key, _)| *key))
        .chain(JOB_SKILL_VOCAB.iter().copied())
        .filter(|key| !INDUSTRY_SKILLS.contains(key));
    let industries = wishes::INDUSTRY_WORDS
        .iter()
        .chain(wishes::INDUSTRIES)
        .map(|(key, _)| *key)
        .chain(INDUSTRY_SKILLS.iter().copied());
    Vocabulary {
        skills: terms(skills),
        industries: terms(industries),
    }
}

/// The written form of the keys that are terms, sorted, each once.
fn terms<'a>(keys: impl Iterator<Item = &'a str>) -> Vec<String> {
    let mut out: Vec<String> = keys.filter(|key| shown(key)).map(written).collect();
    out.sort_by_cached_key(|term| (fold(term), term.clone()));
    out.dedup_by(|a, b| fold(a) == fold(b));
    out
}

fn shown(key: &str) -> bool {
    !HIDDEN.contains(&key) && !HIDDEN_STARTS.iter().any(|start| key.starts_with(start))
}

fn spelled(word: &str) -> Option<&'static str> {
    SPELLED
        .iter()
        .find(|(key, _)| *key == word)
        .map(|(_, form)| *form)
}

/// A key as a person writes it: word by word, small words small but the first.
fn written(key: &str) -> String {
    key.split(' ')
        .enumerate()
        .map(|(at, word)| {
            if at > 0 && SMALL.contains(&word) {
                word.to_owned()
            } else {
                word_form(word)
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

/// A word: its own spelling, else part by part between hyphens and slashes (a small word
/// inside stays small: `Purchase-to-Pay`).
fn word_form(word: &str) -> String {
    if let Some(form) = spelled(word) {
        return form.to_owned();
    }
    let mut out = String::new();
    let mut part = String::new();
    for c in word.chars().chain(std::iter::once('\0')) {
        if c == '-' || c == '/' || c == '\0' {
            let inside = !out.is_empty() && SMALL.contains(&part.as_str());
            out.push_str(&if inside {
                part.clone()
            } else {
                part_form(&part)
            });
            part.clear();
            if c != '\0' {
                out.push(c);
            }
        } else {
            part.push(c);
        }
    }
    out
}

fn part_form(part: &str) -> String {
    if let Some(form) = spelled(part) {
        return form.to_owned();
    }
    if acronym(part) {
        return part.to_uppercase();
    }
    let mut written = part.to_owned();
    for (from, to) in UMLAUTS {
        written = written.replace(from, to);
    }
    for (from, to) in UMLAUT_STARTS {
        if let Some(rest) = written.strip_prefix(from) {
            written = format!("{to}{rest}");
        }
    }
    let mut chars = written.chars();
    chars.next().map_or_else(String::new, |first| {
        first.to_uppercase().chain(chars).collect()
    })
}

/// An acronym: named, or up to five letters and digits without a vowel (`crm`, `m365`),
/// or joined by `&` (`r&d`).
fn acronym(part: &str) -> bool {
    ACRONYMS.contains(&part)
        || part.contains('&')
        || (part.chars().count() <= 5
            && part.chars().any(char::is_alphabetic)
            && !part.chars().any(|c| "aeiouyäöü".contains(c)))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Every key the vocabulary shows, with its written form.
    fn shown_keys() -> Vec<(&'static str, String)> {
        DOMAINS
            .iter()
            .flat_map(|domain| domain.concepts.iter().map(|(key, _)| *key))
            .chain(CORE_CONCEPTS.iter().map(|(key, _)| *key))
            .chain(JOB_SKILL_VOCAB.iter().copied())
            .chain(wishes::INDUSTRY_WORDS.iter().map(|(key, _)| *key))
            .chain(wishes::INDUSTRIES.iter().map(|(key, _)| *key))
            .filter(|key| shown(key))
            .map(|key| (key, written(key)))
            .collect()
    }

    /// A written term folds back to its key: the engine reads a suggestion as the term it
    /// knows (only case, umlauts and ß change).
    #[test]
    fn every_term_folds_back_to_its_key() {
        for (key, term) in shown_keys() {
            assert_eq!(fold(&term), fold(key), "{key} -> {term}");
        }
    }

    #[test]
    fn terms_are_written_like_a_person_writes_them() {
        for (key, term) in [
            ("leiter qualitatssicherung", "Leiter Qualitätssicherung"),
            ("veranderungsmanagement", "Veränderungsmanagement"),
            ("sap s/4hana", "SAP S/4HANA"),
            ("power bi", "Power BI"),
            ("purchase-to-pay", "Purchase-to-Pay"),
            ("verhandlungen mit banken", "Verhandlungen mit Banken"),
            (
                "13-wochen-liquiditatsplanung",
                "13-Wochen-Liquiditätsplanung",
            ),
            ("grosshandel", "Großhandel"),
            ("vertriebsaussendienst", "Vertriebsaußendienst"),
            ("it-dienstleister", "IT-Dienstleister"),
            ("r&d", "R&D"),
            ("microsoft 365", "Microsoft 365"),
            ("gxp-kenntnisse", "GxP-Kenntnisse"),
            ("sanierungsgeschaftsfuhrer", "Sanierungsgeschäftsführer"),
        ] {
            assert_eq!(written(key), term, "{key}");
        }
    }

    #[test]
    fn lists_are_sorted_single_and_without_hidden_keys() {
        let words = vocabulary();
        for list in [&words.skills, &words.industries] {
            assert!(!list.is_empty());
            let folded: Vec<String> = list.iter().map(|term| fold(term)).collect();
            assert!(folded.windows(2).all(|w| w[0] < w[1]), "sorted, each once");
        }
        for gone in [
            "Project Manag",
            "Head Procurement",
            "Deutsch",
            "Einkaufszentrum",
        ] {
            assert!(!words.skills.iter().any(|term| term == gone), "{gone}");
        }
        assert!(words.skills.iter().any(|term| term == "Controlling"));
        assert!(words.industries.iter().any(|term| term == "Maschinenbau"));
        assert!(!words.skills.iter().any(|term| term == "Maschinenbau"));
    }

    /// The harness serves the same words (`tools/ui-harness/demo/vocabulary.json`): written
    /// here, and a failure while the committed file differs (commit the result).
    #[test]
    fn the_harness_has_the_vocabulary() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../tools/ui-harness/demo/vocabulary.json");
        let json = serde_json::to_string_pretty(vocabulary()).unwrap() + "\n";
        let before = std::fs::read_to_string(&path).unwrap_or_default();
        if before.replace("\r\n", "\n") != json {
            std::fs::write(&path, &json).unwrap();
            panic!("tools/ui-harness/demo/vocabulary.json was stale: rewritten, commit it");
        }
    }

    /// Prints both lists for a review of their forms:
    /// `cargo test -p jobalert-core vocabulary_report -- --ignored --nocapture`.
    #[test]
    #[ignore = "a report to read"]
    fn vocabulary_report() {
        let words = vocabulary();
        println!(
            "{} skills:\n{}",
            words.skills.len(),
            words.skills.join(" | ")
        );
        println!(
            "{} industries:\n{}",
            words.industries.len(),
            words.industries.join(" | ")
        );
    }
}
