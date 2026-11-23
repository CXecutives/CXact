use super::*;
use crate::matching::params::FORMAL_CAP;

fn must(value: u16) -> Scored {
    Scored {
        item: Item {
            span: None,
            text: "SAP FI".into(),
            alternatives: Vec::new(),
            kind: ReqKind::Must,
            class: Class::Skill,
            years: None,
            years_max: None,
            stage: Stage::Section,
        },
        fit: ItemFit {
            value,
            entry: None,
            via: Via::Exact,
        },
        weight: W_MUST,
        core: false,
    }
}

/// A long text read with fewer than three weighted musts is low evidence; a short one
/// with two is not.
#[test]
fn a_long_text_read_thin_is_low_evidence() {
    let two = [must(E_FULL), must(E_FULL)];
    let level = |items: &[Scored], chars| evidence_level(TextKind::Full, items, W_MUST, chars);
    assert_eq!(level(&two, 1200), EvidenceLevel::Full);
    assert_eq!(level(&two, THIN_TEXT_CHARS), EvidenceLevel::Low);
    let three = [must(E_FULL), must(E_FULL), must(E_NONE)];
    assert_eq!(level(&three, 4000), EvidenceLevel::Full);
}

/// Soft skills and languages add nothing; a language asked at C1 or higher and not met
/// counts against the profile like a skill must.
#[test]
fn soft_skills_and_languages_are_no_musts() {
    let language = |level, value| {
        let mut s = must(value);
        s.item.class = Class::Language("englisch".into(), level);
        s.weight = W_SOFT;
        s
    };
    let mut soft = must(E_NONE);
    soft.item.class = Class::Soft;
    soft.weight = W_SOFT;
    assert!(!is_must(&soft));
    assert!(!is_must(&language(None, E_FULL)));
    assert!(!is_must(&language(None, E_NONE)));
    assert!(!is_must(&language(Some(5), E_FULL)));
    assert!(is_must(&language(Some(5), E_NONE)));
    // An open C1 language weighs like an open skill must; soft skills and other
    // languages weigh nothing.
    assert_eq!(must_weight(&[language(Some(5), E_NONE)]), W_MUST);
    assert_eq!(must_weight(&[language(None, E_FULL), soft]), 0);
}

/// The lowest cap holds the score; the rank keeps the points before it; an unscorable
/// job scores 0.
#[test]
fn the_cap_holds_the_score_and_the_rank_keeps_the_points() {
    let percent = Percent {
        total: 74,
        fine: 735,
        ..Percent::default()
    };
    assert_eq!(final_score(&percent, None, false), (74, 735, None));
    let cap = Some((FORMAL_CAP, CapCode::Formal));
    assert_eq!(
        final_score(&percent, cap, false),
        (FORMAL_CAP, 735, Some((CapCode::Formal, FORMAL_CAP)))
    );
    let low = Percent {
        total: 30,
        fine: 300,
        ..Percent::default()
    };
    assert_eq!(final_score(&low, cap, false), (30, 300, None));
    assert_eq!(final_score(&percent, cap, true), (0, 0, None));
}

/// Calibration on the owner's scale: a strong fit (role and field met, the core met, most musts
/// met, the frame fits) scores at least `STRONG_FROM`, an ad of another field with no must met
/// stays under the cap of a foreign field, a partial fit lands between.
mod calibration {
    use crate::matching::params::OFF_FIELD_CAP;
    use crate::matching::{JobInput, TextKind, assess, compile_profile};
    use crate::portal::Portal;

    /// Strong fits score 85 to 95 on the owner's scale.
    const STRONG_FROM: u8 = 85;

    // external contract - do not translate (profile JSON keys)
    const PROFILE: &str = r#"{
        "kernkompetenzen": [
            {"kompetenz": "Kundenservice", "jahre": 15},
            {"kompetenz": "Contact Center Management", "jahre": 12},
            {"kompetenz": "Prozessoptimierung", "jahre": 10},
            {"kompetenz": "KPI-Reporting", "jahre": 10},
            {"kompetenz": "Change Management", "jahre": 8},
            {"kompetenz": "Customer Experience", "jahre": 8}
        ],
        "methoden_tools": ["Salesforce", "Zendesk"],
        "wunschrollen": ["Interim Head of Customer Service"],
        "vertragsarten": ["projekt"],
        "arbeitsmodell": "remote"
    }"#;

    fn score(title: &str, text: &str) -> u8 {
        let profile = compile_profile(&crate::profile::parse(PROFILE).unwrap());
        let job = JobInput {
            title,
            company: "",
            location: "Hamburg",
            portal: Portal::Freelancermap,
            text,
            facts: None,
            posted: None,
            kind: TextKind::Full,
        };
        assess(&profile, &job).unwrap().score
    }

    // external contract - do not translate (German ads)
    const STRONG: &str = "Für den Umbau unseres Kundenservice suchen wir einen Interim Head of \
        Customer Service.\n\nIhr Profil\n\
        • Mehrjährige Erfahrung in der Leitung eines Kundenservice\n\
        • Erfahrung im Contact Center Management\n\
        • Erfahrung in der Prozessoptimierung\n\
        • KPI-Reporting an die Geschäftsführung\n\
        • Erfahrung im Change Management\n\
        • Kenntnisse in Salesforce\n\
        • Erfahrung mit Workforce Management\n\n\
        Wünschenswert\n• Erfahrung mit Zendesk\n\nDer Einsatz ist zu 100 % remote.\n";
    const FOREIGN: &str = "Wir suchen einen Senior Java Entwickler für unser Produktteam.\n\n\
        Ihr Profil\n\
        • Mehrjährige Erfahrung mit Java und Spring Boot\n\
        • Erfahrung mit Kubernetes und Docker\n\
        • Kenntnisse in Microservices-Architekturen\n\
        • Erfahrung mit PostgreSQL\n\nDer Einsatz ist zu 100 % remote.\n";
    const PARTIAL: &str = "Wir suchen einen Interim Teamleiter Kundenservice für unser Contact \
        Center.\n\nIhr Profil\n\
        • Erfahrung im Kundenservice\n\
        • Erfahrung mit Workforce Management und Personaleinsatzplanung\n\
        • Kenntnisse in Genesys Cloud\n\
        • Erfahrung im Qualitätsmanagement nach ISO 18295\n\
        • Erfahrung in der Telekommunikationsbranche\n\nDer Einsatz ist hybrid in Hamburg.\n";

    #[test]
    fn strong_partial_and_foreign_fits_land_on_the_scale() {
        let strong = score("Interim Head of Customer Service (m/w/d)", STRONG);
        let partial = score("Interim Teamleiter Kundenservice (m/w/d)", PARTIAL);
        let foreign = score("Senior Java Entwickler (m/w/d)", FOREIGN);
        assert!(strong >= STRONG_FROM, "strong {strong}");
        assert!(foreign <= OFF_FIELD_CAP, "foreign {foreign}");
        assert!(
            partial > OFF_FIELD_CAP && partial < STRONG_FROM,
            "partial {partial}"
        );
    }
}
