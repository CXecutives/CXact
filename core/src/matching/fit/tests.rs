use serde_json::json;

use super::*;
use crate::matching::profile::core_texts;
use crate::profile::of_json;

/// A head of customer service as a CV names it: the field written apart meets the
/// profile's compound, an abbreviation its compound, a ticket system its name; a tool name is
/// no compound of a word.
#[test]
fn a_service_lead_meets_the_words_of_service_ads() {
    let data = of_json(&json!({
        "kernkompetenzen": [
            {"kompetenz": "Customer Service Management"},
            {"kompetenz": "Call Center Management"},
            {"kompetenz": "KPI-Reporting"},
            {"kompetenz": "CRM-Einführung"},
            {"kompetenz": "Führung"}
        ],
        "methoden_tools": ["Zendesk", "Genesys Cloud", "DIN 276"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let value = |text: &str| skill_fit_in(&skills, text, true).value;
    for met in [
        "Leitung Kundenservice",
        "Erfahrung im Kundenservice",
        "Erfahrung im Contact Center",
        "Sicherer Umgang mit Kennzahlen",
        "Erfahrung mit CRM-Systemen",
        "Erfahrung im Umgang mit Ticketsystemen",
    ] {
        assert_eq!(value(met), E_FULL, "{met}");
    }
    // An IT service desk is near a contact center, no proof of one.
    assert_eq!(value("Erfahrung im Service Desk"), E_HALF);
    // A code a number completes is no abbreviation of a compound.
    assert_eq!(value("DIN 1946"), E_NONE);
}

/// Knowledge of a product family (`SAP-Kenntnisse`) is met by an entry naming a product
/// of it; a product of the family asked for is not (`SAP BW`).
#[test]
fn a_family_is_met_by_its_products() {
    let data =
        of_json(&json!({"kernkompetenzen": [{"kompetenz": "SAP S/4HANA"}, {"kompetenz": "CFO"}]}));
    let skills = Skills::new(&core_texts(&data), &data);
    assert_eq!(
        skill_fit_in(&skills, "Sehr gute SAP-Kenntnisse", true).value,
        E_FULL
    );
    assert_eq!(
        skill_fit_in(&skills, "Kenntnisse in SAP BW", true).value,
        E_NONE
    );
    assert_eq!(skill_fit_in(&skills, "SAP", true).value, E_NONE);
    // Another field with leadership stays open.
    assert_eq!(
        skill_fit_in(
            &skills,
            "8 Jahre Controlling, davon 3 mit Führungsverantwortung",
            true
        )
        .value,
        E_NONE
    );
}

/// A licence counts under any of its names (`Sachkundige Person` for a `Qualified
/// Person`).
#[test]
fn licences_under_any_name() {
    let data =
        of_json(&json!({"kernkompetenzen": [{"kompetenz": "Sachkundige Person nach § 15 AMG"}]}));
    let skills = Skills::new(&core_texts(&data), &data);
    assert_eq!(licence_fit(&skills, "qualified person").value, E_FULL);
    assert_eq!(licence_fit(&skills, "sachkundige person").value, E_FULL);
    assert_eq!(licence_fit(&skills, "steuerberater").value, E_NONE);
}

/// A common word of a name of several words is no part of it; the name's own word is.
#[test]
fn a_common_word_is_no_part_of_a_name() {
    let data = of_json(&json!({
        "kernkompetenzen": [{"kompetenz": "Controlling"}],
        "methoden_tools": ["Amazon Web Services", "SAP Analytics Cloud", "IBM Cognos"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let fit = |text: &str| skill_fit_in(&skills, text, true).value;
    assert_eq!(fit("Erfahrung im Service Management"), E_NONE);
    assert_eq!(fit("Sicherer Umgang mit Cloud"), E_NONE);
    assert_eq!(fit("Kenntnisse in Cognos"), E_FULL);
}

/// What the profile names literally stays met when the ad adds only words of experience;
/// working with stakeholders is half of stakeholder management; SAP module codes stay.
#[test]
fn the_profile_named_literally_is_met() {
    let data = of_json(&json!({
        "kernkompetenzen": [
            {"kompetenz": "Projektmanagement"},
            {"kompetenz": "Customer Experience"},
            {"kompetenz": "Stakeholder-Management"}
        ],
        "methoden_tools": ["SAP CS"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let fit = |text: &str| skill_fit_in(&skills, text, true).value;
    assert_eq!(
        fit("Mehrjährige Berufserfahrung im Projektmanagement"),
        E_FULL
    );
    assert_eq!(fit("Projekterfahrung im Stakeholder-Management"), E_FULL);
    assert_eq!(fit("Erfahrung im Umgang mit Stakeholdern"), E_HALF);
    assert_eq!(fit("Kenntnisse in SAP CS"), E_FULL);
    assert_eq!(fit("SAP PS"), E_NONE);
}

/// An industry of the profile is the setting of a requirement, never its function:
/// `Vertrieb im Maschinenbau` is not met, even half, by the industry `Maschinenbau`.
#[test]
fn an_industry_is_the_setting_not_the_function() {
    let data = of_json(&json!({
        "kernkompetenzen": [{"kompetenz": "Controlling"}],
        "branchen": ["Maschinenbau"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let fit = |text: &str| skill_fit_in(&skills, text, true).value;
    assert_eq!(fit("Vertriebserfahrung im Maschinenbau"), E_NONE);
    assert_eq!(fit("Controlling im Maschinenbau"), E_FULL);
    assert_eq!(fit("Controlling in der Automobilindustrie"), E_HALF);
    // An industry's name inside a skill's word is no fit; the industry itself is.
    let data = of_json(&json!({"branchen": ["Telekommunikation"]}));
    let skills = Skills::new(&core_texts(&data), &data);
    let fit = |text: &str| skill_fit_in(&skills, text, true).value;
    assert_eq!(fit("Ausgeprägte Kommunikationsfähigkeit"), E_NONE);
    assert_eq!(fit("Erfahrung in der Telekommunikation"), E_FULL);
}

/// ESCO, the broad layer: a requirement and a profile entry the engine's own words do not
/// relate meet through a concept both name, when the profile names it by its preferred
/// label: in full when the ad does too and asks nothing else, else half.
#[test]
fn esco_relates_what_the_own_words_do_not() {
    let fit = |profile: &str, item: &str| {
        let data = of_json(&json!({"kernkompetenzen": [{"kompetenz": profile}]}));
        let skills = Skills::new(&core_texts(&data), &data);
        let fit = skill_fit_in(&skills, item, true);
        (fit.value, fit.via)
    };
    // The preferred labels in German and English.
    assert_eq!(fit("Buchführung", "Accounting"), (E_FULL, Via::Synonym));
    assert_eq!(
        fit(
            "Batteriemanagementsysteme",
            "Experience with battery management systems"
        ),
        (E_FULL, Via::Synonym)
    );
    // Another name in the ad, or a product ESCO files under the concept: half.
    assert_eq!(fit("Buchführung", "Buchhaltung"), (E_HALF, Via::Semantic));
    assert_eq!(
        fit("Datenvisualisierungssoftware", "Tableau"),
        (E_HALF, Via::Semantic)
    );
    // Through another name in the profile: no match; two products of the same kind are
    // similar, met in part (the rubric's rule 3), never in full.
    assert_eq!(fit("Buchhaltung", "Accounting").0, E_NONE);
    assert_eq!(fit("Power BI", "Tableau").0, E_HALF);
    // Where the engine's own words know both, they decide.
    assert_eq!(
        fit("Projektleitung", "Projektmanagement"),
        (E_HALF, Via::General)
    );
    // A soft skill is no concept to match.
    assert_eq!(fit("Kommunikation", "Gesprächsführung").0, E_NONE);
}

/// A kind of tool asked for is met by a tool of it the profile names (`Salesforce` for a
/// CRM); a tool asked for in part by another tool of its kind or by the kind alone.
#[test]
fn a_kind_of_tool_is_met_by_its_tools() {
    let data = of_json(&json!({
        "kernkompetenzen": [{"kompetenz": "Controlling"}],
        "methoden_tools": ["Salesforce", "SAP S/4HANA", "Power BI"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let fit = |text: &str| skill_fit_in(&skills, text, true);
    for met in [
        "Erfahrung mit CRM-Systemen",
        "Sicherer Umgang mit ERP-Systemen",
        "Kenntnisse in Business Intelligence",
    ] {
        assert_eq!(fit(met).value, E_FULL, "{met}");
        assert_eq!(fit(met).via, Via::Specific, "{met}");
    }
    assert_eq!(fit("Erfahrung mit HubSpot").value, E_HALF);
    assert_eq!(fit("Kenntnisse in Tableau").value, E_HALF);
    assert_eq!(fit("Erfahrung mit Jira").value, E_NONE);
    let data = of_json(&json!({"kernkompetenzen": [{"kompetenz": "CRM-Einführung"}]}));
    let skills = Skills::new(&core_texts(&data), &data);
    assert_eq!(
        skill_fit_in(&skills, "Erfahrung mit Salesforce", true).value,
        E_HALF
    );
}
/// The first part of a hyphen ellipsis is matched as it is written out: `Risiko-` before
/// the quality management it shares its head with asks for risk management.
#[test]
fn an_ellipsis_part_is_matched_written_out() {
    let data = of_json(&json!({"kernkompetenzen": [
        {"kompetenz": "Risikomanagement"},
        {"kompetenz": "Controlling"}
    ]}));
    let skills = Skills::new(&core_texts(&data), &data);
    let values = |line: &str| -> Vec<u16> {
        let text = format!("Anforderungen:\n- {line}\n");
        let doc = crate::matching::job::read(&text, &skills.vocab);
        doc.items
            .iter()
            .map(|i| item_fit(&skills, i).value)
            .collect()
    };
    assert_eq!(
        values("Erfahrung im Risiko- und Qualitätsmanagement"),
        [E_FULL, E_NONE]
    );
    assert_eq!(
        values("Erfahrung im Qualitäts- und Risikomanagement"),
        [E_NONE, E_FULL]
    );
}

/// The parts of a programme are met by programme management (the wording of a real ad), a
/// method the ad accepts a comparable one for by another method of its kind, `Mehr als` asks
/// for nothing more; risk management is no part of a programme alone, a procurement tool is
/// no method.
#[test]
fn a_programme_manager_meets_the_parts_and_comparable_methods() {
    let data = of_json(&json!({
        "kernkompetenzen": [
            {"kompetenz": "Programmmanagement"},
            {"kompetenz": "Stakeholdermanagement"}
        ],
        "methoden_tools": ["PRINCE2", "Scrum"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let value = |text: &str| skill_fit_in(&skills, text, true).value;
    for met in [
        "Sehr gute Kenntnisse in Programmplanung",
        "Ressourcenmanagement",
        "Abhängigkeitsmanagement",
        "Mehr als 5 Jahre Erfahrung im Stakeholdermanagement",
    ] {
        assert_eq!(value(met), E_FULL, "{met}");
    }
    assert_eq!(
        value("Erfahrung mit SAP Activate oder vergleichbaren Transformationsmethoden"),
        E_HALF
    );
    for open in [
        "Risikomanagement",
        "Erfahrung mit SAP Ariba oder vergleichbaren Tools",
        "Produktionsplanung",
    ] {
        assert_eq!(value(open), E_NONE, "{open}");
    }
}

/// What an entry names beside the skill is generic (`SAP SD`): something near the skill is
/// met in half as by an entry of one word (order to cash by the module); a sentence proves
/// nothing, and another process stays open.
#[test]
fn an_entry_with_a_generic_word_meets_near_work_in_half() {
    let data = of_json(&json!({
        "kernkompetenzen": [{"kompetenz": "Kundenservice"}],
        "methoden_tools": ["SAP SD", "SAP S/4HANA"]
    }));
    let skills = Skills::new(&core_texts(&data), &data);
    let value = |text: &str| skill_fit_in(&skills, text, true).value;
    assert_eq!(value("O2C-Expertise"), E_HALF);
    assert_eq!(value("SD-Kenntnisse"), E_FULL);
    assert_eq!(value("P2P-Expertise"), E_NONE);
}
