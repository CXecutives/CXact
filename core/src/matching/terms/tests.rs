use super::*;
use TermField::{Certificate, Competence, Degree, Industry, Language, Tool};

/// Phrases of ads (German and English), their term and its field.
const CASES: &[(&str, &str, TermField)] = &[
    // The three of the user's report.
    ("Kenntnisse in Anaplan", "Anaplan", Tool),
    ("Branchenerfahrung Energie", "Energie", Industry),
    (
        "Erfahrung mit SAP Analytics Cloud",
        "SAP Analytics Cloud",
        Tool,
    ),
    // German leads and fillers.
    ("Fundierte Kenntnisse in SAP FI/CO", "SAP FI/CO", Tool),
    ("Sehr gute Kenntnisse in Power BI", "Power BI", Tool),
    (
        "Erfahrung im Projektmanagement",
        "Projektmanagement",
        Competence,
    ),
    (
        "Erfahrung in der Lohnbuchhaltung",
        "Lohnbuchhaltung",
        Competence,
    ),
    (
        "Kenntnisse im Schweizer Sozialversicherungsrecht",
        "Schweizer Sozialversicherungsrecht",
        Competence,
    ),
    (
        "Mehrjährige Erfahrung im Controlling",
        "Controlling",
        Competence,
    ),
    ("Know-how im Bereich Treasury", "Treasury", Competence),
    ("Sicherer Umgang mit MS Excel", "MS Excel", Tool),
    ("5+ Jahre Erfahrung mit Workday", "Workday", Tool),
    ("Drei Jahre Erfahrung in SAP", "SAP", Tool),
    (
        "Erfahrung als Projektleiter (m/w/d)",
        "Projektleiter",
        Competence,
    ),
    ("Konzernberichtswesen", "Konzernberichtswesen", Competence),
    ("Kenntnisse in agilen Methoden", "Agilen Methoden", Tool),
    ("Praxis in Scrum", "Scrum", Tool),
    (
        "Verständnis für Finanzprozesse",
        "Finanzprozesse",
        Competence,
    ),
    ("Erfahrung aus der Beratung", "Beratung", Competence),
    ("Kenntnisse in LucaNet oder IBM Cognos", "LucaNet", Tool),
    (
        "Konsolidierungstools (z. B. LucaNet)",
        "Konsolidierungstools",
        Competence,
    ),
    // Trailing verbs and wishes.
    ("Kenntnisse in Anaplan helfen dabei", "Anaplan", Tool),
    ("SAP-Kenntnisse setzen wir voraus", "SAP", Tool),
    ("Erfahrung mit Jedox von Vorteil", "Jedox", Tool),
    ("Anaplan-Erfahrung wünschenswert", "Anaplan", Tool),
    ("IFRS-Kenntnisse sind ein Plus", "IFRS", Competence),
    ("Python (von Vorteil)", "Python", Tool),
    ("Excelkenntnisse erforderlich", "Excel", Tool),
    ("Kenntnisse in Tableau oder vergleichbar", "Tableau", Tool),
    // Industries.
    ("Erfahrung in der Energiebranche", "Energie", Industry),
    ("Branchenkenntnisse Pharma", "Pharma", Industry),
    (
        "Erfahrung in der Automobilindustrie",
        "Automobilindustrie",
        Industry,
    ),
    (
        "Erfahrung in der chemischen Industrie",
        "Chemischen Industrie",
        Industry,
    ),
    ("Branchenerfahrung im Bankenumfeld", "Banken", Industry),
    (
        "Erfahrung in der Versicherungsbranche",
        "Versicherung",
        Industry,
    ),
    ("Energiewirtschaft", "Energiewirtschaft", Industry),
    ("Pharma-Branche", "Pharma", Industry),
    ("Logistik", "Logistik", Industry),
    // Languages.
    ("Sehr gute Englischkenntnisse", "Englisch", Language),
    ("Verhandlungssicheres Deutsch", "Deutsch", Language),
    ("Englisch fließend", "Englisch", Language),
    ("Deutsch (C1)", "Deutsch", Language),
    ("Französisch in Wort und Schrift", "Französisch", Language),
    ("Fluent German", "German", Language),
    ("Business fluent English", "English", Language),
    // Certificates and degrees.
    ("PMP-Zertifizierung", "PMP", Certificate),
    (
        "Zertifizierung als Scrum Master",
        "Scrum Master",
        Certificate,
    ),
    ("PRINCE2 Practitioner", "PRINCE2 Practitioner", Certificate),
    ("ITIL Foundation Zertifikat", "ITIL Foundation", Certificate),
    ("CFA", "CFA", Certificate),
    ("Abgeschlossenes BWL-Studium", "BWL-Studium", Degree),
    (
        "Abgeschlossene kaufmännische Ausbildung",
        "Kaufmännische Ausbildung",
        Degree,
    ),
    (
        "Studium der Wirtschaftswissenschaften",
        "Studium der Wirtschaftswissenschaften",
        Degree,
    ),
    ("Master in Finance", "Master in Finance", Degree),
    ("MBA", "MBA", Degree),
    // Not what it looks like.
    (
        "Master Data Management",
        "Master Data Management",
        Competence,
    ),
    ("Scrum Master", "Scrum Master", Competence),
    ("ISO 9001 Zertifizierung", "ISO 9001", Competence),
    (
        "Ausbildung von Mitarbeitern",
        "Ausbildung von Mitarbeitern",
        Competence,
    ),
    ("Sales Promotion", "Sales Promotion", Competence),
    ("Record to Report", "Record to Report", Competence),
    ("Betriebswirtschaft", "Betriebswirtschaft", Competence),
    ("Energiehandel", "Energiehandel", Competence),
    ("SAP-Einführung", "SAP-Einführung", Competence),
    ("SAP-FI", "SAP-FI", Tool),
    // English.
    ("Knowledge of IFRS", "IFRS", Competence),
    ("Hands-on experience with Workday", "Workday", Tool),
    ("Strong experience in M&A", "M&A", Competence),
    (
        "Proven track record in restructuring",
        "Restructuring",
        Competence,
    ),
    ("Working knowledge of SQL", "SQL", Tool),
    ("Experience with Jira is a plus", "Jira", Tool),
    ("SAP experience required", "SAP", Tool),
    ("Excel skills", "Excel", Tool),
    ("Experience in the energy sector", "Energy", Industry),
    ("Automotive industry experience", "Automotive", Industry),
    ("Knowledge Management", "Knowledge Management", Competence),
    ("Customer Experience", "Customer Experience", Competence),
    (
        "Working Capital Management",
        "Working Capital Management",
        Competence,
    ),
    ("Deep Learning", "Deep Learning", Competence),
    ("Familiarity with Power-BI", "Power-BI", Tool),
    ("Background in finance", "Finance", Competence),
];

#[test]
fn the_term_and_field_of_ad_phrases() {
    let mut wrong = Vec::new();
    for (phrase, term, field) in CASES {
        let got = core_term(phrase).map(|c| (c.term, c.field));
        if got.as_ref() != Some(&((*term).to_owned(), *field)) {
            wrong.push(format!("{phrase:?}: {got:?}, wanted ({term:?}, {field:?})"));
        }
    }
    assert!(wrong.is_empty(), "\n{}", wrong.join("\n"));
}

/// A sentence, a term of more than five words and words that name nothing give none.
#[test]
fn no_term_of_a_sentence_or_of_nothing() {
    for phrase in [
        "",
        "Erfahrung",
        "Kenntnisse",
        "Branchenerfahrung",
        "Mindestens 5 Jahre Berufserfahrung",
        "Abgeschlossenes Studium",
        "Hochschulabschluss",
        "Erfahrung in SAP.",
        "Aufgaben:",
        "Sie verfügen über fundierte Kenntnisse in der Konzernrechnungslegung",
        "Erfahrung mit Lagerverwaltungssystemen in der Hafenlogistik und im Zoll",
        "one two three four five six seven eight nine ten eleven",
    ] {
        assert_eq!(core_term(phrase), None, "{phrase:?}");
    }
    // A long bullet whose term is short gives it.
    assert_eq!(
        core_term("Erfahrung mit Anaplan von Vorteil").map(|c| c.term),
        Some("Anaplan".to_owned())
    );
}

/// Two terms of one thing share their key: a spelling, a language in two languages, an
/// industry in two words.
#[test]
fn terms_of_one_thing_share_a_key() {
    let key = |phrase: &str| core_term(phrase).unwrap().key().to_owned();
    assert_eq!(key("Kenntnisse in Anaplan"), key("Anaplan"));
    assert_eq!(key("Power-BI"), key("Kenntnisse in Power BI"));
    assert_eq!(key("Englischkenntnisse"), key("Fluent English"));
    assert_eq!(
        key("Branchenerfahrung Energie"),
        key("Energy sector experience")
    );
    assert_eq!(key("Energiewirtschaft"), key("Energie"));
    assert_ne!(key("C++"), key("C#"));
    assert_ne!(key("SAP FI"), key("SAP CO"));
}

/// A term keeps the ad's words and is never longer than five words.
#[test]
fn a_term_is_the_ads_words() {
    let got = core_term("Erfahrung mit sap analytics cloud").unwrap();
    assert_eq!(got.term, "Sap analytics cloud");
    let got = core_term("erfahrung mit sap").unwrap();
    assert_eq!(got.term, "sap", "a bullet in lower case stays so");
    let got = core_term("Kenntnisse in iOS").unwrap();
    assert_eq!(got.term, "iOS");
    for (phrase, ..) in CASES {
        if let Some(got) = core_term(phrase) {
            assert!(is_term(&got.term), "{phrase:?}: {got:?}");
        }
    }
}

/// A term is a keyword or a bullet of up to five words that ends like no sentence.
#[test]
fn a_term_has_few_words_and_no_full_stop() {
    assert!(is_term("SAP S/4HANA"));
    assert!(is_term("  Kenntnisse in Zollabwicklung  "));
    assert!(is_term("one two three four five"));
    assert!(!is_term("one two three four five six"));
    assert!(!is_term("Erfahrung in SAP."));
    assert!(!is_term("Aufgaben:"));
    assert!(!is_term(""));
    assert!(!is_term(&"x".repeat(81)));
}

/// The tables searched by halves are sorted, and each is written as its keys are.
#[test]
fn the_tables_are_sorted_keys() {
    for (name, table) in [
        ("TOOLS", words::TOOLS),
        ("TOOL_FAMILIES", words::TOOL_FAMILIES),
        ("CERTIFICATES", words::CERTIFICATES),
    ] {
        assert!(table.windows(2).all(|w| w[0] < w[1]), "{name} is sorted");
        for entry in table {
            assert_eq!(term_key(&fold(entry)), *entry, "{name}: {entry}");
        }
    }
}
