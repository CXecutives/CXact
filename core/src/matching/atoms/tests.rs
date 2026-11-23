use super::*;
use crate::matching::graph::fit;

fn all(text: &str) -> Vec<String> {
    atoms(text, &Vocab::all()).to_vec()
}

/// `SAFe` is scaled agile work (the safe operating area of power electronics is none), the
/// general ledger the Hauptbuch, cost centres their accounting, FICO the FI module.
#[test]
fn scaled_agile_ledger_cost_centres_and_fico() {
    assert_eq!(all("SAFe"), all("Scaled Agile Framework"));
    assert_eq!(all("SAFe"), all("Agile Skalierung"));
    assert_ne!(all("Safe Operating Area"), all("SAFe"));
    assert_eq!(all("Hauptbuch"), all("General Ledger"));
    assert_eq!(all("Kostenstellen"), all("Kostenstellenrechnung"));
    assert!(
        all("SAP FICO").contains(&"fi".to_owned()),
        "{:?}",
        all("SAP FICO")
    );
}

/// `Integration` and `Central` alone are too broad: `Post-Merger-Integration` does not
/// meet integration technologies, `Central Finance` not `Employee Central`.
#[test]
fn integration_and_central_alone_meet_nothing() {
    assert_eq!(fit("integration", "post-merger-integration"), Fit::None);
    assert_eq!(fit("central", "central-finance"), Fit::None);
    assert_eq!(
        fit("post-merger-integration", "post-merger-integration"),
        Fit::Equal
    );
}

/// English process words are their German concepts; an AI tool and AI meet in half both
/// ways; a programme is half a project.
#[test]
fn process_words_ai_tools_and_programmes() {
    assert_eq!(all("Process Optimization"), all("Prozessoptimierung"));
    assert_eq!(all("process improvement"), all("Prozessoptimierung"));
    assert_eq!(all("Automation"), all("Automatisierung"));
    assert_eq!(all("Quality Management"), all("Qualitätsmanagement"));
    assert_eq!(fit("ki", "chatgpt"), Fit::General);
    assert_eq!(fit("chatgpt", "ki"), Fit::General);
    assert_eq!(fit("programmmanagement", "projektmanagement"), Fit::General);
}

/// A German hyphen ellipsis reads as the words it stands for; one whose head is unknown
/// stays as written.
#[test]
fn hyphen_ellipses_are_written_out() {
    assert_eq!(
        all("Projekt- und Programmmanagement"),
        all("Projektmanagement und Programmmanagement")
    );
    assert_eq!(
        all("Risiko-, Issue- und Eskalationsmanagement"),
        all("Risikomanagement, Issuemanagement und Eskalationsmanagement")
    );
    assert_eq!(
        all("Projektplanung und -controlling"),
        all("Projektplanung und Projektcontrolling")
    );
    assert_eq!(
        all("HW- und SW-Entwicklungsteams"),
        all("HW-Entwicklungsteams und SW-Entwicklungsteams")
    );
    assert_eq!(
        all("Erfahrung im Utilities-/Energieumfeld"),
        all("Erfahrung im Utilitiesumfeld / Energieumfeld")
    );
    assert_eq!(
        all("E-Mail- und Telefonsupport"),
        ["e-mail", "telefonsupport"]
    );
}

/// A pronoun with its leading verbs asks for nothing.
#[test]
fn leads_ask_for_nothing() {
    assert_eq!(
        all("You have spent several years in IT programme management"),
        all("IT programme management")
    );
    assert_eq!(
        all("You bring experience in stakeholder management"),
        all("experience in stakeholder management")
    );
    assert_eq!(
        all("Sie verfügen über Erfahrung im Controlling"),
        all("Erfahrung im Controlling")
    );
    // Without a pronoun first the words stay.
    assert_eq!(all("Spent fuel handling"), all("spent fuel handling"));
}

/// The modifier of a hyphen ellipsis takes the head of the word it shares.
#[test]
fn ellipsis_modifiers_complete() {
    assert_eq!(
        complete_ellipsis("Erfahrung im Risiko-", " und Qualitätsmanagement").as_deref(),
        Some("Erfahrung im Risikomanagement")
    );
    assert_eq!(
        complete_ellipsis("Risiko-", ", Qualitäts- und Abhängigkeitsmanagement").as_deref(),
        Some("Risikomanagement")
    );
    assert_eq!(
        complete_ellipsis("HW-", " und SW-Entwicklung").as_deref(),
        Some("HW-Entwicklung")
    );
    assert_eq!(complete_ellipsis("Risiko", " und Qualität"), None);
    assert_eq!(complete_ellipsis("Ein-", " und Verkauf"), None);
}

#[test]
fn stemming_and_concepts() {
    assert_eq!(all("Mehrjährige Erfahrung im Controlling"), ["controll"]);
    assert_eq!(
        all("Several years of experience in controlling"),
        ["controll"]
    );
    assert_eq!(
        all("Erfahrung mit Monatsabschlüssen"),
        all("Monatsabschlüsse")
    );
    assert_eq!(
        all("Solid knowledge of IFRS group accounting"),
        ["ifrs", "konzernrechnungslegung"]
    );
    assert_eq!(all("Restrukturierungen"), all("Restrukturierung"));
    assert_eq!(all("Shared Service Centern"), all("Shared Service Center"));
    assert_eq!(all("SAP FI/CO"), ["sap", "fi", "co"]);
    assert_eq!(all("M&A-Transaktionen"), ["m&a"]);
    assert!(!all("Müller GmbH & Co. KG").contains(&"co".to_owned()));
}

/// Bilingual pairs and paraphrases seen in finance ads meet in one concept.
#[test]
fn finance_paraphrases() {
    let same = [
        ("Month-end closing", "Monatsabschluss"),
        ("monthly close", "Monatsabschlüsse"),
        ("Year-end closing", "Jahresabschluss"),
        ("Consolidated financial statements", "Konzernabschluss"),
        ("Group controlling", "Konzerncontrolling"),
        ("Group reporting", "Konzernreporting"),
        ("Financial Planning & Analysis", "FP&A"),
        ("Mergers & Acquisitions", "M&A"),
        ("Liquidity planning", "Liquiditätsplanung"),
        ("Cash Management", "Liquiditätssteuerung"),
        ("Variance analysis", "Abweichungsanalyse"),
        ("Soll-Ist-Vergleich", "Abweichungsanalyse"),
        ("Cost center accounting", "Kostenstellenrechnung"),
        ("General Ledger", "Hauptbuchhaltung"),
        ("Accounts payable", "Kreditorenbuchhaltung"),
        ("Asset accounting", "Anlagenbuchhaltung"),
        ("FI-AA", "Anlagenbuchhaltung"),
        ("CO-PA", "Ergebnisrechnung"),
        ("Berichtswesen", "Reporting"),
        ("Hochrechnung", "Forecast"),
        ("Carve out", "Carve-out"),
        ("Post Merger Integration", "PMI"),
        ("Restructuring", "Restrukturierung"),
        ("Finance Business Partner", "Finance Business Partnering"),
        ("German GAAP", "HGB"),
        ("Interim Manager", "Interim Management"),
        ("Interim-Mandat", "Interim Management"),
        ("Accruals", "Abgrenzungen"),
    ];
    for (a, b) in same {
        assert_eq!(all(a), all(b), "{a} / {b}");
    }
}

/// False friends: these must not meet each other fully.
#[test]
fn anti_pairs() {
    let full = |job: &str, profile: &str| {
        let profile = all(profile);
        all(job).iter().any(|j| {
            profile
                .iter()
                .any(|p| matches!(fit(j, p), Fit::Equal | Fit::Specific))
        })
    };
    let pairs = [
        ("Steuerung", "Steuern"),
        ("SAP Business Partner", "Finance Business Partnering"),
        ("Standortkonsolidierung", "Konsolidierung"),
        ("Produktionsplanung", "Unternehmensplanung"),
        ("Change Requests", "Changemanagement"),
        ("Hochschulabschluss", "Jahresabschlüsse"),
        ("Projektmanagement", "Management Accounting"),
        ("Rechnungsprüfung", "Rechnungslegung"),
    ];
    for (job, profile) in pairs {
        assert!(!full(job, profile), "{job} met by {profile}");
    }
}

/// Packs switch on by the profile's competences; the core works alone.
#[test]
fn packs_follow_the_profile() {
    let finance = Vocab::for_texts(["Controlling", "Konzernrechnungslegung nach IFRS"]);
    assert_eq!(finance.packs(), ["finance"]);
    let sap = Vocab::for_texts(["SAP FI", "SAP S/4HANA", "Datenmigration", "Jira"]);
    assert_eq!(sap.packs(), ["sap", "itProject"]);
    // One stray trigger switches on no pack: the HR profile gets no finance pack.
    let hr = Vocab::for_texts(["Recruiting", "Arbeitsrecht", "Budgetverantwortung"]);
    assert_eq!(hr.packs(), ["hr"]);
    let clinical = Vocab::for_texts(["Klinische Studien", "Clinical Trial Management"]);
    assert!(clinical.packs().is_empty());
    assert_ne!(
        atoms("group accounting", &clinical),
        atoms("group accounting", &finance)
    );
    assert_eq!(
        atoms("project management", &clinical),
        atoms("Projektmanagement", &clinical)
    );
}

#[test]
fn codes_gender_forms_and_near_equivalents() {
    assert_eq!(all("HGB/IFRS"), all("HGB IFRS"));
    assert_eq!(all("S/4HANA"), all("S/4HANA"));
    assert_eq!(all("Personalleiter:in"), all("Personalleiter"));
    assert_eq!(all("Berater*innen"), all("Berater"));
    assert_eq!(all("Controller/in (m/w/d)"), all("Controller"));
    let a = |s: &str| all(s).remove(0);
    assert_eq!(
        fit(&a("Projektleitungserfahrung"), &a("Projektmanagement")),
        Fit::General
    );
    assert_eq!(
        fit(&a("Projektmanagement"), &a("Projektleitung")),
        Fit::General
    );
}

/// A compound needs a real modifier: `Herstellung` is no `Erstellung`.
#[test]
fn leading_roles_are_one_concept() {
    let has = |text: &str, atom: &str| all(text).iter().any(|a| a == atom);
    assert!(has("Head of Finance", "cfo"));
    assert!(has("VP Finance", "cfo"));
    assert!(has("Leitung Finanzen", "cfo"));
    assert!(has("Chief Commercial Officer", "vertriebsleitung"));
    assert!(has("Commercial Director", "vertriebsleitung"));
    assert!(has("Leiter IT", "it-leitung"));
    // The rank words alone name no field.
    for word in ["Head", "Chief", "Officer", "Director"] {
        assert!(all(word).iter().all(|a| is_generic(a)), "{word}");
    }
}

#[test]
fn compound_boundaries() {
    let a = |s: &str| all(s).remove(0);
    // A hyphen marks a compound however short its modifier; a verbal particle is none.
    assert_eq!(fit(&a("IT-Carve-out"), &a("Carve-out")), Fit::General);
    assert_eq!(fit(&a("Führung"), &a("Einführung")), Fit::None);
    assert_eq!(fit(&a("Führung"), &a("Durchführung")), Fit::None);
    assert_eq!(fit(&a("Führung"), &a("Buchführung")), Fit::None);
    // `Führung` is never met inside a word with a particle, also after a hyphen or a
    // modifier (`HRIS-Einführung`, `Markteinführung`); a real modifier stays a compound.
    assert_eq!(fit(&a("Führung"), &a("HRIS-Einführung")), Fit::None);
    assert_eq!(fit(&a("Führung"), &a("Markteinführung")), Fit::None);
    assert_eq!(fit(&a("Führung"), &a("Ausführung")), Fit::None);
    assert_eq!(fit(&a("HRIS-Einführung"), &a("Führung")), Fit::None);
    assert_eq!(fit(&a("Führung"), &a("Teamführung")), Fit::Specific);
    // The linking `s` of a compound changes nothing (`Leistung` is no `Leitung`).
    assert_eq!(fit(&a("Werksleiter"), &a("Werkleiter")), Fit::Equal);
    assert_eq!(fit(&a("Werkleiter"), &a("Werksleiter")), Fit::Equal);
    assert_eq!(fit(&a("Leistung"), &a("Leitung")), Fit::None);
    assert_eq!(all("Konzernrechnung"), all("Konzernrechnungslegung"));
    // `Unternehmen` and `Partner` are too broad to meet anything alone.
    assert!(is_generic(&a("Unternehmen")));
    assert!(is_generic(&a("Partner")));
    assert_eq!(fit(&a("Herstellung"), &a("Erstellung")), Fit::None);
    assert_eq!(fit(&a("Erstellung"), &a("Herstellung")), Fit::None);
    assert_eq!(fit(&a("Tourenplanung"), &a("Planung")), Fit::General);
    // `Erstellung` alone is too broad: it reaches no compound (`Berichterstellung`).
    assert_eq!(fit(&a("Berichterstellung"), &a("Erstellung")), Fit::None);
}

/// `SQL-Kenntnisse` is SQL; `ISO 9001` and `ISO 13485` differ; short skills stay.
#[test]
fn codes_numbers_and_short_skills() {
    assert_eq!(all("SQL-Kenntnisse"), all("SQL"));
    assert_eq!(all("IFRS-Kenntnisse"), all("IFRS"));
    assert_eq!(all("CAPA-Erfahrung"), all("CAPA"));
    assert_eq!(all("SAP-Know-how"), all("SAP"));
    assert_eq!(all("ISO 9001"), ["iso-9001"]);
    assert_ne!(all("ISO 13485"), all("ISO 9001"));
    assert_eq!(all("ISO-9001"), all("ISO 9001:2015"));
    assert!(all("EU GMP Annex 1").contains(&"annex-1".to_owned()));
    assert_ne!(all("Annex 11"), all("Annex 1"));
    for short in ["R", "Go", "5S", "8D", "ML", "VP"] {
        assert_eq!(all(short).len(), 1, "{short}");
    }
    assert_eq!(all("IQ/OQ/PQ").len(), 3);
    assert_eq!(all("CI/CD").len(), 2);
}

/// Lexicon terms with a stopword, filler or short word match with spaces too.
#[test]
fn multiword_terms_across_dropped_words() {
    assert_eq!(all("US GAAP"), all("US-GAAP"));
    assert_eq!(all("Order to Cash"), all("Order-to-Cash"));
    assert_eq!(all("Working Capital"), all("Working-Capital-Management"));
    assert_eq!(all("Year End Closing"), all("Jahresabschluss"));
    assert_eq!(all("React Native"), all("React-Native"));
    assert_eq!(all("React Native").len(), 1);
    assert_eq!(all("Customer Experience"), all("Customer-Experience"));
    assert_eq!(all("Customer Experience").len(), 1);
    assert_eq!(all("Job Evaluation"), all("Stellenbewertung"));
    assert_eq!(all("General Counsel"), ["leitung-recht"]);
    // Spellings the error analysis found: words apart, a space in a code, a typo.
    assert_eq!(all("Projekt Management"), all("Projektmanagement"));
    assert_eq!(all("SAP S/4 HANA"), all("SAP S/4HANA"));
    assert_eq!(all("sehr gute Kentnisse in SAP FI"), all("SAP FI"));
}

#[test]
fn compounds() {
    let a = |s: &str| all(s).remove(0);
    assert_eq!(
        fit(&a("Konzernkonsolidierung"), &a("Konsolidierung")),
        Fit::Equal
    );
    assert_eq!(
        fit(&a("Restrukturierungsumfeld"), &a("Restrukturierung")),
        Fit::Equal
    );
    assert_eq!(fit(&a("Carve-out-Projekten"), &a("Carve-out")), Fit::Equal);
    assert_eq!(
        fit(&a("Finanztransformation"), &a("Transformation")),
        Fit::Equal
    );
    assert_eq!(
        fit(&a("Beteiligungscontrolling"), &a("Controlling")),
        Fit::General
    );
    assert_eq!(
        fit(&a("Projektleitung"), &a("SAP-Projektleitung")),
        Fit::Specific
    );
    assert_eq!(fit(&a("Management"), &a("Interim-Management")), Fit::None);
    assert_eq!(fit(&a("Projektmanagement"), &a("Management")), Fit::None);
}

#[test]
fn tables_are_sorted_and_folded() {
    for table in [
        lex::FILLERS,
        lex::GENERIC_ATOMS,
        lex::LIGHT_MODIFIERS,
        lex::LIGHT_HEADS,
        lex::SOFT_SKILLS,
        lex::FRAME_WORDS,
        lex::LOCATION_NOISE,
        lex::GERMAN_CITIES,
    ] {
        assert!(table.windows(2).all(|w| w[0] < w[1]), "{table:?}");
        assert!(table.iter().all(|w| fold(w) == *w), "{table:?}");
    }
    for domain in DOMAINS {
        assert!(
            domain.triggers.windows(2).all(|w| w[0] < w[1]),
            "{}",
            domain.name
        );
        for (key, value) in domain.concepts {
            assert_eq!(fold(key), *key, "{}", domain.name);
            assert_eq!(fold(value), *value, "{}", domain.name);
        }
    }
}
