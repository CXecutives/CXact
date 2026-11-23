use super::*;

/// The section a line opens when it is a heading.
fn heading_kind(line: &str) -> Option<HeadingKind> {
    match sections::classify(line, false, None) {
        Line::Heading(kind) => Some(kind),
        _ => None,
    }
}

#[test]
fn task_lines_follow_a_task_heading() {
    let text = "Aufgaben:
- Aufbau des Service Desk
- Steuerung der Dienstleister

Ihr Profil:
- SAP FI
";
    let vocab = Vocab::all();
    let doc = read(text, &vocab);
    let tasks: Vec<(&str, &std::rc::Rc<[String]>)> = doc
        .tasks
        .iter()
        .map(|t| (&text[t.span.clone()], &t.atoms))
        .collect();
    assert_eq!(
        tasks,
        [
            (
                "Aufbau des Service Desk",
                &atoms::atoms("Aufbau des Service Desk", &vocab)
            ),
            (
                "Steuerung der Dienstleister",
                &atoms::atoms("Steuerung der Dienstleister", &vocab)
            ),
        ]
    );
    assert!(tasks.iter().all(|(_, atoms)| !atoms.is_empty()));
    assert!(doc.items.iter().all(|i| !i.text.contains("Service Desk")));
    // English and inline task headings, two sentences on one line.
    let key = "Key Responsibilities
Lead the team. Own the monthly close
Ihre Aufgaben: Aufbau des Controllings
";
    let tasks: Vec<String> = read(key, &vocab)
        .tasks
        .iter()
        .map(|t| key[t.span.clone()].to_owned())
        .collect();
    assert_eq!(
        tasks,
        [
            "Lead the team.",
            "Own the monthly close",
            "Aufbau des Controllings"
        ]
    );
}

#[test]
fn degrees_and_their_fields() {
    let degree = |text: &str| {
        let folded = fold(text);
        names_degree(&atoms::raw_tokens(&folded).collect::<Vec<_>>())
    };
    assert!(degree("MSc or PhD in life sciences, pharmacy or chemistry"));
    assert!(degree("Master in Business Administration"));
    assert!(!degree("Erfahrung im Master Data Management"));
    assert!(!degree("Masterdaten und Stammdatenpflege"));
    assert!(degree("Promotion in Chemie oder Pharmazie"));
    assert!(degree("Zweites Staatsexamen in Pharmazie"));
    assert!(!degree("Erfahrung in Sales Promotion und Handel"));
    let fields = |text: &str| super::super::fit::degree_fields_in(&fold(text));
    assert_eq!(
        fields("Naturwissenschaftliches Studium (Pharmazie, Chemie, Biologie)"),
        ["life-science", "science"]
    );
    assert_eq!(
        fields("Dr. rer. nat., approbierte Apothekerin"),
        ["life-science", "science"]
    );
}

fn class(text: &str) -> Class {
    classify(text, None, &Vocab::all())
}

/// Frame words count as whole words, with an ending, before a frame head or at the end
/// of a compound; as a modifier of another head they are part of a skill.
#[test]
fn frame_words_are_words_not_prefixes() {
    for frame in [
        "Reisebereitschaft",
        "Reisetätigkeit bis 50 %",
        "Verfügbarkeit ab sofort",
        "Startdatum 01.11.2026",
        "Gehaltsvorstellung",
        "Remote-Arbeit möglich",
        "Projektlaufzeit 6 Monate",
        "Hybrid, 2 Tage vor Ort",
        "Travel willingness",
        "Remote work",
        "Location: Munich",
        "Präsenzpflicht in Hamburg",
    ] {
        assert_eq!(class(frame), Class::Frame, "{frame}");
    }
    for skill in [
        "Vergütungsmanagement",
        "Gehaltsabrechnung",
        "Standortschließung",
        "Standortleitung",
        "Salary Benchmarking",
        "Hybrid Cloud",
        "Travel Management",
        "Start-up-Erfahrung",
        "Erfahrung mit Vergütung und Benefits",
        "Aufbau der Online-Präsenz",
        "Corporate Finance",
        "Resource allocation",
    ] {
        assert_eq!(class(skill), Class::Skill, "{skill}");
    }
}

/// Soft words are soft with an ending or a soft head; a compound with another head or
/// a soft adjective before another noun is a skill.
#[test]
fn soft_words_are_words_not_prefixes() {
    for soft in [
        "Kommunikationsstärke",
        "Kommunikationsfähigkeit",
        "Analytisches Denken",
        "Analytische und konzeptionelle Fähigkeiten",
        "Flexibilität und Belastbarkeit",
        "Selbstständige Arbeitsweise",
        "Communication skills",
    ] {
        assert_eq!(class(soft), Class::Soft, "{soft}");
    }
    for skill in [
        "Kommunikationsstrategie",
        "Analytische Methodenvalidierung",
        "Communication strategy",
        "unternehmerische Verantwortung",
    ] {
        assert_eq!(class(skill), Class::Skill, "{skill}");
    }
}

/// Soft words of every kind of ad; a soft word alone; a sentence about the person.
/// The greeting under a recruiter's list closes it: no requirement follows.
#[test]
fn a_greeting_closes_the_requirements() {
    let doc = read(
        "Ihr Profil\n- Erste Führungserfahrung\n- Haben wir Ihr Interesse geweckt?\n\
             - Dann senden Sie mir Ihr Profil\n- Viele Grüße\n- Max Muster\n",
        &Vocab::all(),
    );
    let items: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(items, ["Erste Führungserfahrung"]);
}

/// A bare `Skills` heading over prose opens the requirements; over a tag list it stays the
/// portal's tags.
#[test]
fn a_skills_heading_over_prose_lists_requirements() {
    let texts = |text: &str| -> Vec<String> {
        read(text, &Vocab::all())
            .items
            .into_iter()
            .filter(|i| i.stage == Stage::Section)
            .map(|i| i.text)
            .collect()
    };
    assert_eq!(
        texts(
            "Skills:
Substantive experience from leading IT projects at several clients
"
        ),
        ["Substantive experience from leading IT projects at several clients"]
    );
    assert!(
        texts(
            "Skills
SAP FI, DATEV, HGB, IFRS, Konzernabschluss
"
        )
        .is_empty()
    );
}

/// Application, contact and privacy lines and the sign-off close the requirements too.
#[test]
fn application_and_contact_lines_close_the_requirements() {
    for closing in [
        "Bewerbung: Bei Interesse senden Sie bitte Ihren CV",
        "Bei Interesse senden Sie mir Ihr Profil",
        "Sind Sie aktuell verfügbar und passt dies zu Ihren Kompetenzen?",
        "Ich freue mich auf Ihre Rückmeldung!",
        "Wir bestätigen, dass wir alle Bewerbungen vertraulich behandeln",
        "Ihr Ansprechpartner: Max Muster",
        "Kind regards,",
        "© 2026 Muster GmbH",
    ] {
        let doc = read(
            &format!("Ihr Profil\n- Erste Führungserfahrung\n- {closing}\n- Datenmodellierung\n"),
            &Vocab::all(),
        );
        let items: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
        assert_eq!(items, ["Erste Führungserfahrung"], "{closing}");
    }
}

#[test]
fn soft_words_sentences_and_words_alone() {
    for soft in [
        "Strukturierte und sorgfältige Arbeitsweise",
        "Zahlenaffinität, Sorgfalt und Neugier",
        "Überzeugungskraft",
        "Verhandlungsstärke",
        "Structured approach",
        "Reliable and analytical",
        "Strong analytical skills",
        "Arbeitsweise",
        "Working style",
        "Soft Skills",
        "Hohe Kunden- und Serviceorientierung",
        "Ausgeprägte Problemlösungskompetenz",
        "Gestaltungswillen",
        "Umsetzungsstärke",
        "hohes Maß an Eigeninitiative",
        "kommunikative Fähigkeiten",
        "Unternehmerisches Denken",
        "Zahlenverständnis",
        "Hohe Kunden- und Vertriebsorientierung",
        "Sehr gute Kommunikationsfähigkeiten auf Fach-, IT- und Managementebene",
        "Sicheres Auftreten auf unterschiedlichen Hierarchieebenen",
    ] {
        assert_eq!(class(soft), Class::Soft, "{soft}");
    }
    let doc = read(
        "Ihr Profil\n- Sie kommunizieren klar und wertschätzend, auch wenn es unbequem wird\n\
             - Sie haben Erfahrung mit SAP FI\n",
        &Vocab::all(),
    );
    let classes: Vec<(&str, &Class)> = doc
        .items
        .iter()
        .map(|i| (i.text.as_str(), &i.class))
        .collect();
    assert_eq!(
        classes[0],
        (
            "Sie kommunizieren klar und wertschätzend, auch wenn es unbequem wird",
            &Class::Soft
        )
    );
    // A sentence naming a known skill stays a requirement.
    assert!(
        classes
            .iter()
            .any(|(t, c)| t.contains("SAP FI") && **c == Class::Skill)
    );
}

/// `in Wort und Schrift` is one item; a comma tail stays with its item; the partners
/// listed after `Zusammenarbeit mit` are one item, a skill list after `Erfahrung mit`
/// is not.
#[test]
fn fixed_phrases_comma_tails_and_partner_lists() {
    let texts =
        |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
    assert_eq!(
        texts("Sehr gutes Deutsch in Wort und Schrift"),
        ["Sehr gutes Deutsch in Wort und Schrift"]
    );
    assert_eq!(
        texts("Fluent English, written and spoken"),
        ["Fluent English, written and spoken"]
    );
    assert_eq!(
        texts("Erfahrung mit SAP, gerne auch S/4HANA"),
        ["Erfahrung mit SAP, gerne auch S/4HANA"]
    );
    assert_eq!(
        texts("Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern"),
        ["Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern"]
    );
    assert_eq!(
        texts("Erfahrung mit Finanzierungsrunden und Investorenkommunikation"),
        [
            "Erfahrung mit Finanzierungsrunden",
            "Investorenkommunikation"
        ]
    );
}

/// Tag lines, notices and company lines are no requirements; soft phrases and soft
/// lines; coordinated objects and partners stay one item.
#[test]
fn reading_noise_of_ads() {
    let texts = |section: &str| -> Vec<(String, Class)> {
        read(&format!("Ihr Profil\n{section}\n"), &Vocab::all())
            .items
            .into_iter()
            .map(|i| (i.text, i.class))
            .collect()
    };
    let found =
        texts("- SAP FI\nSkills: SAP, Excel, Power BI\n- Datenschutz liegt uns am Herzen\n");
    assert_eq!(found, [("SAP FI".to_owned(), Class::Skill)]);
    let found = texts("- Muster GmbH, München, Hamburg, Köln\n- seit 1998 am Markt\n- SAP CO\n");
    assert_eq!(found, [("SAP CO".to_owned(), Class::Skill)]);
    assert_eq!(
        texts("- Freude an komplexen Verhandlungen\n")[0].1,
        Class::Soft
    );
    // One soft part and parts without a known skill: the whole line is soft.
    assert!(
        texts("- Verbindlich, pragmatisch und mit Leidenschaft für gute Lösungen\n")
            .iter()
            .all(|(_, c)| *c == Class::Soft)
    );
    let parts =
        |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
    assert_eq!(
        parts("Steuerung großer IT-Projekte und externer Dienstleister"),
        ["Steuerung großer IT-Projekte und externer Dienstleister"]
    );
    assert_eq!(
        parts("Kommunikation gegenüber Vorstand, Aufsichtsrat und Investoren"),
        ["Kommunikation gegenüber Vorstand, Aufsichtsrat und Investoren"]
    );
    assert_eq!(
        parts("Controlling und Reporting"),
        ["Controlling", "Reporting"]
    );
    let doc = read(
        "Requirements\n- Tableau is a plus\n- SAP S/4HANA preferred\n",
        &Vocab::all(),
    );
    assert!(doc.items.iter().all(|i| i.kind == ReqKind::Nice));
}

/// Must and can headings of tenders, portal footers, English nice cues.
#[test]
fn tender_headings_footers_and_nice_cues() {
    let doc = read(
        "Muss-Anforderungen\n- SAP FI\nKann-Anforderungen\n- SAP CO\n\
             Projekt-ID: SDP-2026-118\nEingestellt am: 18.09.2026\nBranche: Medizintechnik\n",
        &Vocab::all(),
    );
    let items: Vec<(&str, ReqKind)> = doc
        .items
        .iter()
        .map(|i| (i.text.as_str(), i.kind))
        .collect();
    assert_eq!(
        items,
        [("SAP FI", ReqKind::Must), ("SAP CO", ReqKind::Nice)]
    );
    let doc = read(
        "Requirements\n- Experience under GMP is an advantage\n- Power BI is helpful\n",
        &Vocab::all(),
    );
    assert_eq!(doc.items[0].kind, ReqKind::Nice);
    // The cue word does not count as a skill (`Power BI von Vorteil` is Power BI).
    let vocab = Vocab::all();
    assert_eq!(
        atoms::atoms("Power BI von Vorteil", &vocab),
        atoms::atoms("Power BI", &vocab)
    );
}

/// Languages under their English names (`Fluent Dutch`).
#[test]
fn languages_by_english_name() {
    assert_eq!(
        class("Fluent Dutch"),
        Class::Language("niederlandisch".into(), Some(5))
    );
    assert_eq!(language_of("english"), Some("englisch"));
    assert_eq!(language_of("germany"), None);
}

/// `Qualified Person` and `Sachkundige Person` are one licence.
#[test]
fn qualified_person_is_a_licence() {
    assert!(matches!(
        class("Qualified Person according to EU directive"),
        Class::Licence(_)
    ));
    assert!(matches!(
        class("Sachkundige Person nach § 15 AMG"),
        Class::Licence(_)
    ));
}

fn items(phrase: &str) -> Vec<(String, Vec<String>)> {
    split(phrase)
        .into_iter()
        .map(|(r, alts)| {
            (
                phrase[r].to_owned(),
                alts.into_iter().map(|a| phrase[a].to_owned()).collect(),
            )
        })
        .collect()
}

/// (item, must) of an ad's requirement section.
fn musts(section: &str) -> Vec<(String, bool)> {
    read(&format!("Ihr Profil\n{section}\n"), &Vocab::all())
        .items
        .into_iter()
        .map(|i| (i.text, i.kind == ReqKind::Must))
        .collect()
}

#[test]
fn nice_cues_per_item_negated_items_and_frame_blocks() {
    assert_eq!(
        musts("- Erfahrung im Controlling, idealerweise im Maschinenbau"),
        [
            ("Erfahrung im Controlling".to_owned(), true),
            ("idealerweise im Maschinenbau".to_owned(), false)
        ]
    );
    // The items under a pick list's line are a choice, not each a must; the list ends with a
    // line of its own.
    let picked = musts(
        "- Erfahrung in Großprogrammen
- Fundierte Kenntnisse in mindestens zwei der folgenden              Bereiche:
- SAP S/4HANA
- Salesforce
- API Management
             - Verhandlungssichere Englischkenntnisse in Wort und Schrift.",
    );
    let must = |t: &str| picked.iter().find(|(x, _)| x.contains(t)).map(|(_, m)| *m);
    assert_eq!(must("Großprogrammen"), Some(true), "{picked:?}");
    assert_eq!(must("Salesforce"), Some(false), "{picked:?}");
    assert_eq!(must("API Management"), Some(false), "{picked:?}");
    assert!(
        !picked.iter().any(|(x, _)| x.contains("folgenden")),
        "{picked:?}"
    );
    // A results section is no requirement section.
    let results = read(
        "Ihr Profil
- Erfahrung in IT-Transformationen

Erfolgskriterien
             - Etablierte, funktionierende IT-Governance
",
        &Vocab::all(),
    );
    assert_eq!(results.items.len(), 1, "{:?}", results.items);
    let described = musts(
        "- Gesucht wird eine erfahrene Interim-Führungspersönlichkeit auf Partner-Level.
             - Die Rolle ist ausdrücklich keine reine PMO-Position.
- Erfahrung in Multi-Vendor-Umgebungen",
    );
    assert_eq!(described.len(), 1, "{described:?}");
    // An `or` in the nice clause leaves the head a must of its own.
    let items = musts("- 10+ years in finance, ideally in controlling or accounting");
    assert_eq!(
        items[0],
        ("10+ years in finance".to_owned(), true),
        "{items:?}"
    );
    assert!(items[1..].iter().all(|(_, must)| !must), "{items:?}");
    assert!(
        musts("- Kenntnisse in LucaNet und Power BI von Vorteil")
            .iter()
            .all(|(_, must)| !must)
    );
    assert_eq!(musts("- Keine SAP-Kenntnisse erforderlich").len(), 0);
    assert_eq!(
        musts("- Sehr gute Deutsch- und Englischkenntnisse"),
        musts("- Sehr gute Deutschkenntnisse und Englischkenntnisse"),
        "a hyphen ellipsis parts like the written-out form"
    );
    assert_eq!(
        musts("- Erfahrung im Risiko- und Qualitätsmanagement"),
        musts("- Erfahrung im Risikomanagement und Qualitätsmanagement")
    );
    assert_eq!(
        musts("- Ein- und Verkauf").len(),
        1,
        "an unknown head keeps the line"
    );
    // A frame block ends the requirements.
    let frame =
        musts("- Erfahrung im Controlling\nRahmendaten\n- Laufzeit 6 Monate\n- Tagessatz 1.000 €");
    assert_eq!(frame.len(), 1, "{frame:?}");
    assert_eq!(
        musts("✅ Erfahrung im Treasury").len(),
        1,
        "a glyph bullet is a bullet"
    );
}

#[test]
fn and_or_and_examples() {
    let got = items("Kenntnisse in LucaNet oder IBM Cognos");
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].1, ["Kenntnisse in LucaNet", "IBM Cognos"]);
    let got = items("Fundierte Kenntnisse in Konsolidierungswerkzeugen, z. B. LucaNet");
    assert_eq!(got.len(), 1);
    assert_eq!(
        got[0].1,
        [
            "Fundierte Kenntnisse in Konsolidierungswerkzeugen",
            "LucaNet"
        ]
    );
    let got = items("Mehrjährige Erfahrung im Controlling, inkl. Budgetierung");
    assert_eq!(got.len(), 2);
    let got = items("Sicherer Umgang mit Power BI / Tableau");
    assert_eq!(got[0].1, ["Sicherer Umgang mit Power BI", "Tableau"]);
    let got = items(
        "Kenntnisse in Analysewerkzeugen (u. a. Python, R, VBA, Power BI) und praktische Erfahrung mit KI",
    );
    assert_eq!(got.len(), 2);
    assert!(got[0].1.contains(&"Power BI".to_owned()), "{got:?}");
}

/// An adjective that ends a part shares the noun of the next one: one requirement (as in
/// `Classic and agile project management` or `klassischen und agilen Methoden`).
#[test]
fn adjectives_share_the_next_noun() {
    let texts =
        |phrase: &str| -> Vec<String> { items(phrase).into_iter().map(|(t, _)| t).collect() };
    for one in [
        "Classic and agile project management",
        "Klassische und agile Methoden",
        "Kenntnisse in klassischen und agilen Projektmanagement-Methoden",
        "Sehr gute organisatorische und kommunikative Fähigkeiten",
        "Durchführung qualitativer und quantitativer Nutzerforschung",
    ] {
        assert_eq!(texts(one), [one], "{one}");
    }
    assert_eq!(
        texts("Controlling und Reporting"),
        ["Controlling", "Reporting"]
    );
    assert_eq!(texts("Excel und Power BI"), ["Excel", "Power BI"]);
    assert_eq!(
        texts("Erfahrung im Controlling und Reporting"),
        ["Erfahrung im Controlling", "Reporting"]
    );
    assert_eq!(
        texts("Erfahrung im Controlling und Konzernrechnungslegung nach IFRS"),
        [
            "Erfahrung im Controlling",
            "Konzernrechnungslegung nach IFRS"
        ]
    );
}

/// Every conjunct written out in full: a trailing ellipsis takes the modifier of the word
/// before it, a bare activity the object of the next one; a skill term, a relative clause and
/// the parts of `und/oder` or of a slash between words stay one requirement.
#[test]
fn conjuncts_are_written_out_in_full() {
    let texts = |section: &str| -> Vec<String> {
        read(
            &format!(
                "Ihr Profil
- {section}
"
            ),
            &Vocab::all(),
        )
        .items
        .into_iter()
        .map(|i| i.text)
        .collect()
    };
    assert_eq!(
        texts("Methodenkompetenz in Projektplanung und -controlling"),
        ["Methodenkompetenz in Projektplanung", "Projektcontrolling"]
    );
    for one in [
        "Kenntnisse in der Erstellung und Anwendung von Personas",
        "Sicherer Umgang mit der Analyse und Interpretation von Kundendaten",
    ] {
        assert_eq!(texts(one), [one], "{one}");
    }
    // A part that ends in no activity shares no object.
    assert_eq!(
        texts("Erfahrung im Vertrieb und in der Führung von Teams"),
        ["Erfahrung im Vertrieb", "in der Führung von Teams"]
    );
    assert_eq!(
        texts("Erfahrung in Compensation & Benefits"),
        ["Erfahrung in Compensation & Benefits"]
    );
    assert_eq!(
        texts("Erfahrung mit Tools, die die Zusammenarbeit im Team fördern"),
        ["Erfahrung mit Tools, die die Zusammenarbeit im Team fördern"]
    );
    assert_eq!(
        texts("Erfahrung im Controlling, die Fähigkeit zur Analyse"),
        ["Erfahrung im Controlling", "die Fähigkeit zur Analyse"]
    );
    let alternatives =
        |phrase: &str| -> Vec<Vec<String>> { items(phrase).into_iter().map(|(_, a)| a).collect() };
    assert_eq!(
        alternatives("Excel und/oder Power BI"),
        [["Excel", "Power BI"]]
    );
    assert_eq!(
        alternatives("Sicherer Umgang mit Power BI/Tableau"),
        [["Sicherer Umgang mit Power BI", "Tableau"]]
    );
    for one in [
        "SAP S/4HANA",
        "SAP FI/CO",
        "Leiter/in Controlling",
        "HGB/IFRS",
    ] {
        assert_eq!(alternatives(one), [[one]], "{one}");
    }
    assert_eq!(
        alternatives("Erfahrung mit ERP-Systemen, bspw. SAP oder Oracle"),
        [["Erfahrung mit ERP-Systemen", "SAP", "Oracle"]]
    );
    assert_eq!(
        alternatives("Etwas Erfahrung mit SAP"),
        [["Etwas Erfahrung mit SAP"]]
    );
}

#[test]
fn overlapping_separators_and_a_marker_after_brackets() {
    // ", " and " oder " overlap: one cut, no inverted range.
    let got = items("Studium der Wirtschaftswissenschaften, oder eine vergleichbare Qualifikation");
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!(
        got[0].1,
        [
            "Studium der Wirtschaftswissenschaften",
            "eine vergleichbare Qualifikation"
        ]
    );
    // The bracket closes before "z. B.": the examples follow the marker.
    let got = items("Erfahrung mit einem ERP-System (SAP) z. B. S/4HANA");
    assert_eq!(got.len(), 1, "{got:?}");
    assert_eq!(
        got[0].1,
        ["Erfahrung mit einem ERP-System (SAP)", "S/4HANA"],
        "{got:?}"
    );
    // Folding that keeps the length but moves the offsets ("İ" grows, "ẞ" shrinks).
    let got = items("İẞ Kenntnisse z. B. SAP");
    assert!(!got.is_empty(), "{got:?}");
}

/// Messy ads (set 9): a heading in two languages, a keyword line of several skills that
/// ends with a language, frame lines about workload and extension.
#[test]
fn messy_ads_keep_their_structure() {
    assert_eq!(heading_kind("Aufgaben / Tasks:"), Some(HeadingKind::Task));
    assert_eq!(heading_kind("Profil / Profile"), Some(HeadingKind::Must));
    assert_eq!(heading_kind("Controlling / Reporting"), None);
    let core = Vocab::core();
    assert_eq!(
        classify(
            "ISTQB Advanced Test Manager, min. 7 Jahre Testmanagement, SAP Testing, \
                 Playwright hands on, Deutsch fliessend",
            None,
            &core
        ),
        Class::Skill
    );
    assert!(matches!(
        classify("Verhandlungssicheres Deutsch", None, &core),
        Class::Language(..)
    ));
    for frame in [
        "Einsatz in Vollzeit, davon drei Tage pro Woche vor Ort",
        "Eine Verlängerung ist möglich",
        "Beauftragung über uns",
    ] {
        assert_eq!(classify(frame, None, &core), Class::Frame, "{frame}");
    }
}

#[test]
fn kinds_years_levels() {
    assert_eq!(
        classify("Ausgeprägte Kommunikationsstärke", None, &Vocab::core()),
        Class::Soft
    );
    assert_eq!(
        classify("Reisebereitschaft", None, &Vocab::core()),
        Class::Frame
    );
    assert_eq!(
        classify("Englischkenntnisse auf Niveau C1", None, &Vocab::core()),
        Class::Language("englisch".into(), Some(5))
    );
    assert_eq!(
        classify(
            "Abgeschlossenes Studium der Wirtschaftswissenschaften",
            None,
            &Vocab::core()
        ),
        Class::Degree
    );
    assert_eq!(
        classify(
            "Abgeschlossene technische Ausbildung oder Ingenieurstudium",
            None,
            &Vocab::core()
        ),
        Class::Degree
    );
    assert_eq!(
        classify(
            "Zulassung als Steuerberater:in zwingend erforderlich",
            None,
            &Vocab::core()
        ),
        Class::Licence("steuerberater")
    );
    assert_eq!(
        classify(
            "Enge Zusammenarbeit mit Steuerberatern",
            None,
            &Vocab::core()
        ),
        Class::Skill
    );
    assert_eq!(
        years_in("Mindestens 15 Jahre Erfahrung in der Konsolidierung"),
        Some((15, None))
    );
    assert_eq!(
        years_in("Mindestens zehn Jahre Berufserfahrung"),
        Some((10, None))
    );
    assert_eq!(years_in("At least 8 years of experience"), Some((8, None)));
    assert_eq!(years_in("10+ years in FP&A"), Some((10, None)));
    // A range: at least its lower end, up to its upper end.
    assert_eq!(
        years_in("3-5 Jahre Berufserfahrung im Controlling"),
        Some((3, Some(5)))
    );
    assert_eq!(years_in("3 bis 5 Jahre Erfahrung"), Some((3, Some(5))));
    assert_eq!(
        years_in("between 3 and 5 years of experience"),
        Some((3, Some(5)))
    );
    assert_eq!(years_in("2 Sprachen und 5 Jahre SAP"), Some((5, None)));
    assert_eq!(heading_kind("Ihre Qualifikation"), Some(HeadingKind::Must));
    assert_eq!(
        heading_kind("Rahmenbedingungen"),
        Some(HeadingKind::Neutral)
    );
}

/// A portal's tag list under a bare `Skills` heading, the provider's other projects and a
/// rate line are no requirements of the ad.
#[test]
fn portal_tags_other_projects_and_rates() {
    let doc = read(
        "Ihr Profil\n- SAP FI\n- Bis zu 1.200 € pro Tag\n\nSkills\nPower BI\nTableau\n\n\
             Ähnliche Projekte\nSAP CO Berater (m/w/d)\n",
        &Vocab::all(),
    );
    let items: Vec<(&str, &Class)> = doc
        .items
        .iter()
        .map(|i| (i.text.as_str(), &i.class))
        .collect();
    assert_eq!(
        items,
        [
            ("SAP FI", &Class::Skill),
            ("Bis zu 1.200 € pro Tag", &Class::Frame)
        ]
    );
    assert_eq!(heading_kind("Projektanbieter"), Some(HeadingKind::Neutral));
}

/// An offer, the start or the steps after the application end the requirements.
#[test]
fn offers_and_next_steps_are_no_requirements() {
    let doc = read(
        "Dein Profil\n- SAP FI\n\nWas wir dir bieten\n- 30 Tage Urlaub\n\nSo geht es weiter\n\
             Nach deiner Bewerbung meldet sich unser Team.\n",
        &Vocab::all(),
    );
    let texts: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(texts, ["SAP FI"]);
    for heading in [
        "Was wir Ihnen bieten",
        "Dein Start",
        "Ihr Start",
        "So geht's weiter",
    ] {
        assert_eq!(
            heading_kind(heading),
            Some(HeadingKind::Neutral),
            "{heading}"
        );
    }
}

/// Parts joined by `und` share the object the last one names: no bare `Erfahrung im
/// Aufbau` is left.
#[test]
fn split_parts_keep_their_shared_object() {
    let doc = read(
        "Ihr Profil\n- Erfolgreiche Erfahrung im Aufbau und in der Führung von Vertriebsteams\n",
        &Vocab::all(),
    );
    let texts: Vec<&str> = doc.items.iter().map(|i| i.text.as_str()).collect();
    assert_eq!(
        texts,
        [
            "Erfolgreiche Erfahrung im Aufbau von Vertriebsteams",
            "in der Führung von Vertriebsteams"
        ]
    );
}

/// Real wording: a skill that starts like a heading stays a must; an English inline heading
/// keeps its content, split into sentences; `Ihre Aufgaben` lists tasks.
#[test]
fn the_line_classifier_keeps_skills_inline_content_and_tasks() {
    let doc = read(
        "Ihre Aufgaben\n- Steuerung des Category Managements\n\nIhr Profil\nRequirements Engineering\n\
         Kategoriemanagement\nBranchenkenntnisse im Handel\n\
         Nice to have: Erfahrung mit Tableau. Kenntnisse in Python\n",
        &Vocab::all(),
    );
    let items: Vec<(&str, ReqKind)> = doc
        .items
        .iter()
        .map(|i| (i.text.as_str(), i.kind))
        .collect();
    assert_eq!(
        items,
        [
            ("Requirements Engineering", ReqKind::Must),
            ("Kategoriemanagement", ReqKind::Must),
            ("Branchenkenntnisse im Handel", ReqKind::Must),
            ("Erfahrung mit Tableau", ReqKind::Nice),
            ("Kenntnisse in Python", ReqKind::Nice),
        ]
    );
    assert_eq!(doc.tasks.len(), 1);
}

/// Each nice cue marks what its scope covers, in real wordings: a clause cue in brackets only
/// the bracket, a closing cue its item, a line cue the line up to it; cues are whole words.
#[test]
fn nice_cues_mark_their_scope() {
    assert_eq!(
        musts("- SAP FI (idealerweise S/4HANA) und Excel"),
        [
            ("SAP FI".to_owned(), true),
            ("idealerweise S/4HANA".to_owned(), false),
            ("Excel".to_owned(), true)
        ]
    );
    assert_eq!(
        musts("- Erfahrung mit SAP, gerne auch S/4HANA"),
        [
            ("Erfahrung mit SAP".to_owned(), true),
            ("gerne auch S/4HANA".to_owned(), false)
        ]
    );
    // Held-out set 2, Y05 and Y08: the experience is a must, only the clause after `gerne` is
    // nice.
    assert_eq!(
        musts(
            "* Erfahrung im Rechnungswesen / Buchhaltung, gerne mit Bilanzbuchhalter-Qualifikation"
        ),
        [
            ("Erfahrung im Rechnungswesen / Buchhaltung".to_owned(), true),
            ("gerne mit Bilanzbuchhalter-Qualifikation".to_owned(), false)
        ]
    );
    assert_eq!(
        musts(
            "Erfahrung in der Leitung von Projekten im Finanz-Bereich, gerne mit IFRS-Erstanwendung"
        )[0],
        (
            "Erfahrung in der Leitung von Projekten im Finanz-Bereich".to_owned(),
            true
        )
    );
    // A clause cue after a word closes what stands before it.
    assert_eq!(
        musts("- SAP-Erfahrung bevorzugt, sicherer Umgang mit Excel"),
        [
            ("SAP-Erfahrung bevorzugt".to_owned(), false),
            ("sicherer Umgang mit Excel".to_owned(), true)
        ]
    );
    assert_eq!(
        musts("- Erfahrung mit Bonussystemen"),
        [("Erfahrung mit Bonussystemen".to_owned(), true)]
    );
    assert_eq!(
        musts("- SAP-Kenntnisse erwünscht"),
        [("SAP-Kenntnisse erwünscht".to_owned(), false)]
    );
    assert_eq!(
        musts("- SAP FI, Power BI (optional)"),
        [
            ("SAP FI".to_owned(), true),
            ("Power BI (optional)".to_owned(), false)
        ]
    );
    assert_eq!(
        musts("- Power BI von Vorteil, sicherer Umgang mit Excel"),
        [
            ("Power BI von Vorteil".to_owned(), false),
            ("sicherer Umgang mit Excel".to_owned(), true)
        ]
    );
    let picked =
        musts("- Experience in one or more of the following areas:\n- SAP S/4HANA\n- Salesforce");
    assert!(picked.iter().all(|(_, must)| !must), "{picked:?}");
}

/// The modifier of a hyphen ellipsis takes the head of the word it shares.
#[test]
fn ellipsis_modifiers_complete() {
    assert_eq!(
        leading_ellipsis("Erfahrung im Risiko-", " und Qualitätsmanagement").as_deref(),
        Some("Erfahrung im Risikomanagement")
    );
    assert_eq!(
        leading_ellipsis("Risiko-", ", Qualitäts- und Abhängigkeitsmanagement").as_deref(),
        Some("Risikomanagement")
    );
    assert_eq!(
        leading_ellipsis("HW-", " und SW-Entwicklung").as_deref(),
        Some("HW-Entwicklung")
    );
    assert_eq!(leading_ellipsis("Risiko", " und Qualität"), None);
    assert_eq!(leading_ellipsis("Ein-", " und Verkauf"), None);
}

/// The frame of a clause asks for nothing: a pronoun with its verbs and modals, and the verb
/// that closes a German clause; a pronoun sentence that asks for knowledge is no soft
/// sentence as a whole.
#[test]
fn the_frame_of_a_clause_asks_for_nothing() {
    let vocab = Vocab::all();
    let all = |text: &str| atoms::atoms(text, &vocab);
    assert_eq!(
        all("Sie sollten Erfahrung im Controlling mitbringen"),
        all("Erfahrung im Controlling")
    );
    assert_eq!(
        all("Du bringst Kenntnisse in SAP FI mit"),
        all("Kenntnisse in SAP FI")
    );
    assert_eq!(
        all("You should have experience with Power BI"),
        all("experience with Power BI")
    );
    assert_eq!(
        all("Sie besitzen fundierte Kenntnisse im Arbeitsrecht"),
        all("fundierte Kenntnisse im Arbeitsrecht")
    );
    let doc = read(
        "Ihr Profil\n- Sie haben Erfahrung mit Lieferantenverhandlungen\n\
         - Sie kommunizieren klar und wertschätzend\n",
        &vocab,
    );
    let classes: Vec<(&str, &Class)> = doc
        .items
        .iter()
        .map(|i| (i.text.as_str(), &i.class))
        .collect();
    assert_eq!(
        classes,
        [
            (
                "Sie haben Erfahrung mit Lieferantenverhandlungen",
                &Class::Skill
            ),
            ("Sie kommunizieren klar und wertschätzend", &Class::Soft)
        ]
    );
}

/// One table per meaning: the number words of years and days, the adjective endings of every
/// coordination rule.
#[test]
fn one_word_table_per_meaning() {
    assert_eq!(years_in("Mindestens ein Jahr Erfahrung"), Some((1, None)));
    assert_eq!(years_in("four years of experience"), Some((4, None)));
    assert_eq!(
        items("Technical and functional requirements").len(),
        1,
        "an English adjective shares the next noun"
    );
}
