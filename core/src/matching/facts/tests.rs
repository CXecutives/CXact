use super::*;

fn anue_codes(text: &str) -> Vec<(ReasonCode, bool)> {
    let job = JobFacts {
        title: "Controller",
        text,
        location: "",
        portal: Portal::LinkedIn,
        facts: None,
        posted: None,
    };
    anue(&job, &segments(text))
        .into_iter()
        .map(|f| (f.code, f.decided))
        .collect()
}

#[test]
fn country_names_in_a_profile_become_codes_and_unknown_ones_are_no_rule() {
    let codes = |countries: &[&str]| {
        let form = ProfileForm {
            countries: countries.iter().map(|c| (*c).to_owned()).collect(),
            ..ProfileForm::default()
        };
        HardCriteria::new(&form).countries
    };
    assert_eq!(
        codes(&["Deutschland", "Österreich", "UK", "ch"]),
        Some(vec!["DE".into(), "AT".into(), "GB".into(), "CH".into()])
    );
    // An unknown name is no country; none at all is no rule.
    assert_eq!(codes(&["Deutschland", "Atlantis"]), Some(vec!["DE".into()]));
    assert_eq!(codes(&[]), None);
    assert_eq!(country_code("DEUTSCHLAND").as_deref(), Some("DE"));
}

#[test]
fn the_other_listings_under_an_ad_are_no_part_of_it() {
    let text = "Vertragsart: Freiberuflich\nSAP FI/CO Berater, remote.\n\n\
                    Ähnliche Projekte (12)\nSAP CO Berater (m/w/d), Arbeitnehmerüberlassung\n\
                    Werkstudent Controlling";
    let own = own_text(text);
    assert_eq!(
        own,
        "Vertragsart: Freiberuflich\nSAP FI/CO Berater, remote.\n\n"
    );
    // The ANÜ of another listing excludes nothing.
    assert!(anue_codes(own).is_empty());
    assert_eq!(anue_codes(text), [(ReasonCode::Anue, true)]);
    // A requirement that names similar projects is no heading; the text stays whole.
    let whole = "Ähnliche Projekte im Mittelstand erfolgreich umgesetzt und begleitet, \
                     idealerweise mehrere davon";
    assert_eq!(own_text(whole), whole);
    // Nor is a short line that goes on after the heading's words, or a sentence.
    for line in [
        "Ähnliche Projekterfahrung von Vorteil",
        "Weitere Projekterfahrung wünschenswert",
        "Weitere Projekte sind bereits geplant.",
        "Andere Projekte im Konzern laufen parallel",
    ] {
        let text = format!("Ihr Profil\n{line}\nEinsatz über Arbeitnehmerüberlassung");
        assert_eq!(own_text(&text), text, "{line}");
    }
    // A heading with a count, a colon or a known tail is one.
    for heading in [
        "Ähnliche Projekte (12)",
        "Similar jobs:",
        "Ähnliche Projekte anzeigen",
        "Weitere Projekte dieses Anbieters",
    ] {
        let text = format!("Ihr Profil\n{heading}\nx");
        assert_eq!(own_text(&text), "Ihr Profil\n", "{heading}");
    }
    let english = "Contract: freelance\n\nSimilar jobs\nPayroll clerk (temporary agency work)";
    assert_eq!(own_text(english), "Contract: freelance\n\n");
    // A text that starts with such a heading keeps it (nothing before it).
    assert_eq!(own_text("Weitere Projekte\nx"), "Weitere Projekte\nx");
}

#[test]
fn anue_decided_only_without_an_option_or_a_distinction() {
    assert_eq!(
        anue_codes("Die Besetzung erfolgt im Rahmen der Arbeitnehmerüberlassung."),
        [(ReasonCode::Anue, true)]
    );
    assert!(
        anue_codes("Wir achten auf eine saubere Abgrenzung zur Arbeitnehmerüberlassung.")
            .is_empty()
    );
    assert_eq!(
        anue_codes(
            "Vertragsart: Freiberuflich oder Arbeitnehmerüberlassung.\n\
                 Bei ANÜ gilt ein entsprechender Stundenlohn."
        ),
        [(ReasonCode::AnueOptional, false)]
    );
}

/// ANÜ as a topic of the requirements (experience with it, knowledge of the law,
/// managing temporary staff) is no contract form of the ad.
#[test]
fn anue_as_a_topic_of_the_requirements_never_excludes() {
    for text in [
        "Erfahrung mit Arbeitnehmerüberlassung von Vorteil.",
        "Kenntnisse des Arbeitnehmerüberlassungsgesetzes (AÜG) wünschenswert.",
        "Idealerweise Know-how in der Arbeitnehmerüberlassung und im Tarifrecht",
        "Sie verantworten die Steuerung der Arbeitnehmerüberlassung an allen Standorten.",
        "Experience with temporary agency work is a plus.",
        "Knowledge of temporary agency work rules (AÜG), payroll and works council matters.",
    ] {
        assert!(anue_codes(text).is_empty(), "{text}");
    }
    // The contract form stays the contract form, also in a list of keywords.
    for text in [
        "Die Besetzung erfolgt im Rahmen der Arbeitnehmerüberlassung.",
        "Arbeitnehmerüberlassung, 6 Monate, Erfahrung mit SAP FI erforderlich",
    ] {
        assert_eq!(anue_codes(text), [(ReasonCode::Anue, true)], "{text}");
    }
}

/// E16-7: ANÜ named only in the title is read like a contract sentence; a denial, an
/// option or the field of a staffing role in the title decides nothing.
#[test]
fn e16_7_anue_named_only_in_the_title_is_read() {
    let codes = |title: &str| {
        let text = "Wir suchen einen SAP FI/CO Berater für unseren Kunden.\n\
                        - Erfahrung mit SAP FI/CO";
        let job = JobFacts {
            title,
            text,
            location: "",
            portal: Portal::FreelanceDe,
            facts: None,
            posted: None,
        };
        anue(&job, &segments(text))
            .into_iter()
            .map(|f| (f.code, f.decided))
            .collect::<Vec<_>>()
    };
    for title in [
        "SAP FI/CO Berater (m/w/d) in Arbeitnehmerüberlassung",
        "SAP FI/CO Berater (m/w/d) - ANÜ",
        "SAP FI/CO Consultant (m/f/d) - temporary agency work",
    ] {
        assert_eq!(codes(title), [(ReasonCode::Anue, true)], "{title}");
    }
    assert_eq!(
        codes("SAP FI/CO Berater (m/w/d) - freiberuflich oder ANÜ"),
        [(ReasonCode::AnueOptional, false)]
    );
    for title in [
        "SAP FI/CO Berater (m/w/d) - keine ANÜ",
        "Disponent (m/w/d) Arbeitnehmerüberlassung",
        "SAP FI/CO Berater (m/w/d)",
    ] {
        assert!(codes(title).is_empty(), "{title}");
    }
}

/// E16-4: a sentence that offers the contract through ANÜ stays the contract even with a
/// cue elsewhere in its clause or at its start; ANÜ is a topic only where the cue
/// governs it.
#[test]
fn e16_4_anue_is_a_topic_only_where_a_cue_governs_it() {
    for text in [
        "Erfahrung im Controlling erforderlich, die Anstellung erfolgt über \
             Arbeitnehmerüberlassung.",
        "Idealerweise Start zum 01.11., der Einsatz erfolgt in Arbeitnehmerüberlassung.",
        "Für unseren Kunden suchen wir im Rahmen der Arbeitnehmerüberlassung einen \
             Controller mit Berufserfahrung in der Konsolidierung.",
        "Wir suchen im Rahmen der Arbeitnehmerüberlassung einen Controller (m/w/d) für die \
             Unternehmenssteuerung.",
        "Wir suchen im Wege der Arbeitnehmerüberlassung einen Controller mit fundierten \
             SAP-Kenntnissen.",
        "Ihre Expertise ist gefragt: Einsatz im Rahmen der Arbeitnehmerüberlassung.",
        "Profitieren Sie von unserer Erfahrung: Wir besetzen die Position im Rahmen der \
             Arbeitnehmerüberlassung.",
        "Im Rahmen der Arbeitnehmerüberlassung suchen wir einen Referent Konzernsteuerung \
             (m/w/d).",
        "We are looking for an experienced SAP FI/CO consultant via temporary agency work.",
        "For our client we are looking for a controller with SAP knowledge on a temporary \
             agency basis.",
        "Controller mit SAP-Kenntnissen in Arbeitnehmerüberlassung",
        "Anstellung bei unserem Partner, Überlassung an den Kunden, Erfahrung mit SAP \
             erforderlich.",
    ] {
        assert_eq!(anue_codes(text), [(ReasonCode::Anue, true)], "{text}");
    }
    for text in [
        "Sie haben Erfahrung im Einsatz von Arbeitnehmerüberlassung.",
        "Sie verantworten die Steuerung der Arbeitnehmerüberlassung und den Einsatz von \
             Fremdpersonal.",
        "Kenntnisse im AÜG, in der Arbeitnehmerüberlassung und im Tarifrecht",
        "Erfahrung mit SAP und Arbeitnehmerüberlassung",
        "Personalwesen und Arbeitnehmerüberlassung von Vorteil",
        "ANÜ-Erfahrung wünschenswert",
    ] {
        assert!(anue_codes(text).is_empty(), "{text}");
    }
}

/// ANÜ as the business of the hiring company is no contract form; the contract wording
/// in the same kind of sentence stays one, and `nächstmöglich` offers no option.
#[test]
fn anue_as_the_business_of_a_company_never_excludes() {
    for text in [
        "Unser Kerngeschäft ist die Arbeitnehmerüberlassung in Industrie und Logistik.",
        "Die Gruppe ist in der Arbeitnehmerüberlassung, der Personalvermittlung und im \
             Engineering tätig.",
    ] {
        assert!(anue_codes(text).is_empty(), "{text}");
    }
    for text in [
        "Wir sind ein in der Region tätiger Personaldienstleister und suchen im Rahmen der \
             Arbeitnehmerüberlassung eine Buchhaltung.",
        "Wir suchen zum nächstmöglichen Zeitpunkt im Rahmen der Arbeitnehmerüberlassung \
             einen Controller.",
    ] {
        assert_eq!(anue_codes(text), [(ReasonCode::Anue, true)], "{text}");
    }
}

#[test]
fn a_denied_anue_never_excludes_in_english_either() {
    for text in [
        "We contract freelancers only; Arbeitnehmerüberlassung (ANÜ) is excluded.",
        "No temporary agency work.",
        "The engagement is not via ANÜ but under a service contract.",
        "A service contract without temporary agency work.",
        "Temporary agency work is ruled out for this mandate.",
    ] {
        assert!(anue_codes(text).is_empty(), "{text}");
    }
    assert_eq!(
        anue_codes("The assignment is temporary agency work via our staffing unit."),
        [(ReasonCode::Anue, true)]
    );
}

#[test]
fn rates() {
    let r = parse_rate(&fold("Honorar: 900 - 1.100 € pro Tag")).unwrap();
    assert_eq!((r.upper, r.hourly), (1100, false));
    let r = parse_rate(&fold("Honorar: 95,- € pro Stunde")).unwrap();
    assert_eq!((r.upper, r.hourly), (95, true));
    assert_eq!(
        parse_rate(&fold("Day rate: 1,150 EUR")).unwrap().upper,
        1150
    );
    assert_eq!(
        parse_rate(&fold("Tagessatz: CHF 950 pro Tag"))
            .unwrap()
            .currency,
        Some("chf")
    );
    assert!(parse_rate(&fold("Jahresgehalt von 110.000 € pro Jahr")).is_none());
    // Only amounts next to a currency or a rate word: no year, date or postcode.
    let rate = |s: &str| parse_rate(&fold(s)).map(|r| (r.upper, r.hourly));
    assert_eq!(
        rate("Start: 02/2027 · Dauer: 10 Monate · 80 % · 78 €/h zzgl. MwSt."),
        Some((78, true))
    );
    assert_eq!(rate("Tagessatz: bis 1.100"), Some((1100, false)));
    assert_eq!(rate("Tagessatz ab 01.11.2026: 950 EUR"), Some((950, false)));
    assert_eq!(rate("80331 München, Tagessatz 900 €"), Some((900, false)));
    assert_eq!(rate("Stundensatz: 95,50 €"), Some((95, true)));
    assert_eq!(
        rate("Day rate: EUR 950–1,100 depending on experience"),
        Some((1100, false))
    );
    assert_eq!(rate("Honorar nach Absprache, Laufzeit bis 2027"), None);
    assert_eq!(rate("16,50 € pro Stunde"), Some((16, true)));
    // A currency with a time unit is a rate in every spelling, without a rate word.
    assert_eq!(
        rate("Start: 15.10.2026 | 110 EUR/h | Remote: 90 %"),
        Some((110, true))
    );
    assert_eq!(
        parse_rate(&fold("110 EUR/h")).map(|r| (r.upper, r.hourly)),
        Some((110, true))
    );
    assert_eq!(parse_rate(&fold("950 CHF/Tag")).map(|r| r.upper), Some(950));
    // The salary clause of an either-or does not hide the rate.
    let r = rate_in(&fold(
        "Freelance mit 80–90 € pro Stunde (ca. 32 Std./Woche) oder befristete Anstellung \
             (Gehaltsband 72–84 T€ p.a. bei 40 h)",
    ))
    .unwrap();
    assert_eq!((r.upper, r.hourly), (90, true));
}

/// E16-3: a wage word counts only as a word or a phrase, never inside another word
/// (`Volkswagen`, `Entgeltabrechnung`, `Tarifsystem`, `groß` folded to `gross`); a pay
/// scale or `Entgelt` next to a freelance rate word stays a rate.
#[test]
fn e16_3_wage_words_are_words_not_parts_of_words() {
    let wage = |s: &str| rate_in(&fold(s)).map(|r| r.wage);
    for text in [
        "Tagessatz 700 € für den Einsatz bei Volkswagen",
        "Einsatz bei der Volkswagen AG in Wolfsburg, 60 €/h",
        "Projekt bei Volkswagen in Wolfsburg, 110 €/h, 6 Monate",
        "Entgelt: 95 €/h zzgl. MwSt.",
        "Unterstützung der Entgeltabrechnung, 70 €/h remote",
        "Projekt Tarifsystem-Migration, 70 €/h",
        "Das Projekt ist groß, 70 €/h",
        "Stundensatz 90 € für die Einführung der Entgeltabrechnung",
        "Stundensatz 70 € zzgl. MwSt., kein Dienstwagen",
        "Customs tariff project, 70 €/h",
        "Einführung eines neuen Tarifvertrags im SAP HCM, 90 €/h",
        "Lohnbuchhaltung im Mittelstand, 85 €/h",
    ] {
        assert_eq!(wage(text), Some(false), "{text}");
    }
    for text in [
        "Übertarifliche Bezahlung ab 32 € pro Stunde",
        "Tarifvertragliche Vergütung 26 €/Std.",
        "Vergütung nach Tarifvertrag: 21 €/h",
        "Vergütung nach Tarif: 24 € pro Stunde",
        "We pay €18/h gross.",
        "We offer €17.50 gross per hour.",
        "Entgelt: 22 € pro Stunde",
        "Bruttostundenlohn 19,80 € nach iGZ-Tarif",
        "Stundenlohn: 21 €",
        "18,50 € brutto pro Stunde",
        "Minimum wage €13 per hour",
        "Pay: hourly wage of €16 plus shift allowance.",
    ] {
        assert_eq!(wage(text), Some(true), "{text}");
    }
}

#[test]
fn a_rate_range_reads_its_upper_end_in_every_spelling() {
    let rate = |s: &str| rate_in(&fold(s)).map(|r| (r.upper, r.hourly));
    // LinkedIn: the currency before each amount, the unit after it.
    assert_eq!(rate("€610/day - €680/day"), Some((680, false)));
    assert_eq!(rate("€85/hr - €95/hr"), Some((95, true)));
    // English range words between two amounts after one currency.
    assert_eq!(
        rate("Daily rate: EUR 1,050 to 1,180 plus expenses"),
        Some((1180, false))
    );
    assert_eq!(rate("Tagessatz 950 bis 1.050 €"), Some((1050, false)));
    // A portal's rate label is overruled by the value it holds.
    assert_eq!(
        rate("Stundensatz: Tagessatz 980 - 1.120 €"),
        Some((1120, false))
    );
    assert_eq!(rate("Stundensatz: 120 €"), Some((120, true)));
    // A salary chip stays no rate.
    assert_eq!(rate("€95,000/yr - €110,000/yr"), None);
    // Neither is an amount of a salary's size or pay by commission.
    assert_eq!(rate("Vergütungspaket von 170.000 bis 210.000 €"), None);
    assert_eq!(
        rate("Vergütung auf Provisionsbasis: 20 % Provision, 250 € pro Workshop"),
        None
    );
    assert_eq!(rate("Tagessatz 900 €, provisionsfrei"), Some((900, false)));
}

#[test]
fn starts() {
    let d = |y, m, d| Some(Start::Date(Date::new(y, m, d).unwrap()));
    assert_eq!(parse_start("Start: 01.11.2026"), d(2026, 11, 1));
    assert_eq!(parse_start("Start: 11/2026"), d(2026, 11, 1));
    assert_eq!(parse_start("Start: ab Januar 2027"), d(2027, 1, 1));
    assert_eq!(parse_start("Start ab sofort"), Some(Start::Now));
    assert_eq!(parse_start("Start: nach Abstimmung"), Some(Start::Vague));
    assert_eq!(parse_start("2026-11-01"), d(2026, 11, 1));
    // A number that is no date does not end the search.
    assert_eq!(
        parse_start("Start: ab sofort, Rückfragen unter 0170.1234.5678"),
        Some(Start::Now)
    );
    assert_eq!(parse_start("Start: 31.02.2026"), None);
}

/// The contract types, the workload and the duration as the engine reads them.
#[test]
fn the_criteria_of_the_form() {
    let form = ProfileForm {
        permanent: false,
        temporary: true,
        day_rate_min: Some(1_050),
        min_salary: Some(90_000),
        workload: Workload::Parttime,
        min_months: 6,
        available: crate::profile::ProfileAvailability::From {
            date: "01.11.2026".into(),
        },
        ..ProfileForm::default()
    };
    let c = HardCriteria::new(&form);
    assert_eq!(c.min_rate, Some(1050));
    assert!(c.permanent_excluded && !c.anue_excluded);
    assert_eq!(c.min_salary, Some(90_000), "for temporary agency work");
    assert_eq!(
        (c.workload_min, c.workload_max),
        (None, Some(PARTTIME_DAYS))
    );
    assert_eq!(c.min_months, Some(6));
    assert_eq!(
        c.available,
        Availability::From(Date::new(2026, 11, 1).unwrap())
    );
    let full = HardCriteria::new(&ProfileForm {
        workload: Workload::Fulltime,
        ..ProfileForm::default()
    });
    assert_eq!(
        (full.workload_min, full.workload_max),
        (Some(FULLTIME_DAYS), None)
    );
    assert_eq!(full.available, Availability::Now);
    assert_eq!(full.min_months, None);
}

/// Country findings of an ad in Cologne for a profile that works in Germany.
fn country_codes(text: &str) -> Vec<(ReasonCode, bool)> {
    let criteria = HardCriteria::new(&ProfileForm::default());
    let allowed = criteria.countries.clone().expect("countries");
    let job = JobFacts {
        title: "Projektleitung",
        text,
        location: "Köln",
        portal: Portal::LinkedIn,
        facts: None,
        posted: None,
    };
    country(&allowed, &job, &segments(text), &fold(text))
        .into_iter()
        .map(|f| (f.code, f.decided))
        .collect()
}

/// Only the countries of the on-site statement are places of work; a business trip in
/// the same sentence is at most a check.
#[test]
fn only_the_place_of_work_decides_the_country() {
    assert_eq!(
        country_codes(
            "Vier Tage pro Woche vor Ort in Düsseldorf, gelegentlich Reisen zu Standorten \
                 in Belgien, Polen und Spanien."
        ),
        [(ReasonCode::CountryUnclear, false)]
    );
    assert_eq!(
        country_codes("Einsatz vor Ort in Wien, gelegentlich Reisen nach Köln."),
        [(ReasonCode::Country, true)]
    );
    assert_eq!(
        country_codes("In Wien vor Ort."),
        [(ReasonCode::Country, true)]
    );
    // The job's own place on site makes other countries second sites (a check).
    assert_eq!(
        country_codes(
            "Etwa die Hälfte der Zeit vor Ort in Köln und in den Werken in Belgien und \
                 den Niederlanden."
        ),
        [(ReasonCode::CountryUnclear, false)]
    );
    // A frame line naming an allowed country beside another makes it a second site.
    assert_eq!(
        country_codes(
            "Location: Remote - Meetings in Germany (Unterfranken) and Poland (Posen) may                  happen after agreement"
        ),
        [(ReasonCode::CountryUnclear, false)]
    );
    assert_eq!(
        country_codes("Ort: 3199 Rotterdam, Niederlande"),
        [(ReasonCode::Country, true)]
    );
    // A place near another names a landmark, not the place of work.
    assert!(country_codes("Ort: Straelen (nähe Venlo) 3 Tage vor Ort").is_empty());
}

/// Remote work for a place abroad is a check, never an exclusion (remote work counts
/// everywhere since Profil v19); a location that says remote is remote work.
#[test]
fn remote_work_abroad_is_no_exclusion() {
    let allowed = vec!["DE".to_owned()];
    let text = "Das Team sitzt in Zürich, die Arbeit ist remote.";
    let job = JobFacts {
        title: "Data Engineer",
        text,
        location: "Zürich, Schweiz (Remote)",
        portal: Portal::LinkedIn,
        facts: None,
        posted: None,
    };
    let found = country(&allowed, &job, &segments(text), &fold(text));
    assert!(found.is_empty(), "{found:?}");
}

/// A location that names days on site beside `Remote` is no remote work; a stated work
/// delivery country decides like a location; Swiss regions are places abroad.
#[test]
fn days_on_site_delivery_countries_and_regions_abroad() {
    let allowed = vec!["DE".to_owned()];
    let decided = |location: &str, text: &str| {
        let job = JobFacts {
            title: "Application Service Manager",
            text,
            location,
            portal: Portal::Freelancermap,
            facts: None,
            posted: None,
        };
        country(&allowed, &job, &segments(text), &fold(text))
            .iter()
            .any(|f| f.decided)
    };
    assert!(decided("2 Tage vor Ort in Bern & Remote", "Ein Projekt."));
    assert!(decided(
        "Berlin",
        "Work delivery city: Zürich.
Work delivery country: Switzerland."
    ));
    assert!(decided("Aargau", "Ein Projekt."));
    assert!(decided("Région de Sion", "Un projet."));
    assert!(!decided("Bern (Remote)", "Ein Projekt."));
}

/// Full remote work denied in its clause is no remote work: the place abroad decides.
#[test]
fn denied_full_remote_work_is_none() {
    let allowed = vec!["DE".to_owned()];
    let decided = |text: &str| {
        let job = JobFacts {
            title: "Interim Finance Transformation Lead",
            text,
            location: "Amsterdam, North Holland, Netherlands",
            portal: Portal::LinkedIn,
            facts: None,
            posted: None,
        };
        country(&allowed, &job, &segments(text), &fold(text))
            .iter()
            .any(|f| f.decided)
    };
    assert!(decided(
        "We are unable to consider fully remote or mainly remote arrangements."
    ));
    assert!(decided("Kein 100 % remote möglich."));
    assert!(!decided("The role is fully remote."));
}
