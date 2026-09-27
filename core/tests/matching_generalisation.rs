//! Rules found on the unseen held-out sets 3 to 6, checked on invented ads: they must hold
//! for any ad and any profile, not for the ads they were found on.

use jobalert_core::matching::{
    Assessment, JobInput, ReasonCode, ReasonKind, TextKind, Verdict, assess, compile_profile,
};
use jobalert_core::portal::Portal;
use serde_json::{Value, json};

/// An introduction that makes every test ad long enough to be read.
const INTRO: &str = "Die Muster AG ist ein mittelständisches Unternehmen mit Sitz in Köln und \
                     rund 800 Mitarbeitenden.\n\n";

fn run(profile: &Value, title: &str, text: &str) -> Assessment {
    let text = &format!("{INTRO}{text}");
    let job = JobInput {
        title,
        company: "Muster AG",
        location: "Köln, Deutschland",
        portal: Portal::LinkedIn,
        text,
        facts: None,
        posted: None,
        kind: TextKind::Full,
    };
    assess(&compile_profile(profile), &job, None).expect("assessed")
}

fn finance() -> Value {
    json!({
        "kernkompetenzen": [
            {"kompetenz": "Controlling", "jahre": 15},
            {"kompetenz": "CFO", "jahre": 8},
            {"kompetenz": "Konzernrechnungslegung nach IFRS", "jahre": 12},
            {"kompetenz": "Treasury", "jahre": 10}
        ],
        "sprachen": [
            {"sprache": "Dutch", "niveau": "Native"},
            {"sprache": "English", "niveau": "C2"}
        ],
        "berufserfahrung_jahre": 15,
        "harte_kriterien": {
            "min_jahresgehalt": 95000,
            "festanstellung_orte": ["München"]
        }
    })
}

fn met(a: &Assessment, label: &str) -> bool {
    a.reasons
        .iter()
        .any(|r| r.label.as_deref() == Some(label) && r.kind == ReasonKind::Met)
}

/// Languages under their English names meet the ad's languages.
#[test]
fn languages_under_english_names() {
    let a = run(
        &finance(),
        "Controller (m/w/d)",
        "Ihr Profil\n- Erfahrung im Controlling\n- Fluent Dutch\n- Business fluent English\n",
    );
    assert!(met(&a, "Fluent Dutch"), "{:#?}", a.reasons);
    assert!(met(&a, "Business fluent English"), "{:#?}", a.reasons);
}

/// A text long enough to read but without any requirement is judged from its title: low
/// evidence and at most 60, higher for the profile whose field the title names.
#[test]
fn a_text_without_requirements_is_judged_from_its_title() {
    let text = "Die Muster AG sucht für die Übergangszeit bis zur Nachbesetzung eine erfahrene \
                Persönlichkeit. Vor Ort in Köln, befristet für sechs Monate.";
    let fin = run(&finance(), "Interim CFO (m/w/d)", text);
    assert_eq!(fin.verdict, Verdict::Scored);
    assert!(fin.score <= 60, "{}", fin.score);
    assert!(
        fin.reasons
            .iter()
            .any(|r| r.code == ReasonCode::LowEvidence),
        "{:#?}",
        fin.reasons
    );
    let other = json!({"kernkompetenzen": [
        {"kompetenz": "Recruiting"}, {"kompetenz": "Arbeitsrecht"}, {"kompetenz": "Payroll"}
    ]});
    let hr = run(&other, "Interim CFO (m/w/d)", text);
    assert!(hr.score < fin.score, "{} < {}", hr.score, fin.score);
}

/// The level of an ad does not depend on the profile's packs: `3-5 Jahre` of a pharma role
/// (`QA` in the title is quality assurance for every profile) is far below a finance
/// profile's 15 years: over-qualified, met in part, never an exclusion.
#[test]
fn seniority_is_the_same_for_every_profile() {
    let a = run(
        &finance(),
        "QA Manager Sterile (m/w/d)",
        "Ihr Profil\n- 3-5 Jahre Erfahrung in der Qualitätssicherung\n\
         - CAPA und Change Control\n- Freiberuflich, Tagessatz 900 €\n",
    );
    assert!(
        a.reasons
            .iter()
            .any(|r| r.code == ReasonCode::Overqualified && r.kind == ReasonKind::Partial),
        "{:#?}",
        a.reasons
    );
    assert_ne!(a.verdict, Verdict::Excluded);
}

/// A student role is employment: its stated hourly wage decides the salary criterion, its
/// place is only a check (the role is inferred from the title).
#[test]
fn a_student_role_is_employment_and_its_wage_decides() {
    let a = run(
        &finance(),
        "Werkstudent (m/w/d) Controlling",
        "Dein Profil\n- Studium der Wirtschaftswissenschaften\n- Erste Erfahrung im Controlling\n\
         Das bieten wir\n- 16,50 € pro Stunde\n",
    );
    assert_eq!(a.verdict, Verdict::Excluded);
    let codes: Vec<(ReasonCode, ReasonKind)> = a.reasons.iter().map(|r| (r.code, r.kind)).collect();
    assert!(
        codes.contains(&(ReasonCode::Salary, ReasonKind::Violation)),
        "{codes:?}"
    );
    assert!(
        !codes.contains(&(ReasonCode::PermanentRegion, ReasonKind::Violation)),
        "{codes:?}"
    );
}

/// A short teaser is judged from its title when the title names the field or a target
/// role; a short full text (an empty ad) stays unscorable.
#[test]
fn a_short_teaser_is_judged_from_its_title() {
    let mut profile = finance();
    profile["wunschrollen"] = json!(["Interim CFO"]);
    let teaser = |title: &str, kind| {
        let job = JobInput {
            title,
            company: "Muster AG",
            location: "Köln",
            portal: Portal::FreelanceDe,
            text: "Ort: Köln // Vertragsart: Freiberuflich // Start: sofort",
            facts: None,
            posted: None,
            kind,
        };
        assess(&compile_profile(&profile), &job, None).expect("assessed")
    };
    let cfo = teaser("Interim CFO (m/w/d)", TextKind::Teaser);
    assert_eq!(cfo.verdict, Verdict::Scored);
    assert!(cfo.score <= 60 && cfo.score > 10, "{}", cfo.score);
    assert_eq!(
        teaser("Lagerlogistiker (m/w/d)", TextKind::Teaser).verdict,
        Verdict::Unscorable
    );
    assert_eq!(
        teaser("Interim CFO (m/w/d)", TextKind::Full).verdict,
        Verdict::Unscorable
    );
}

/// A single explicit skill must that is open, under a title that names little of the
/// profile, caps the score as off the field (a sales role for a finance profile).
#[test]
fn a_single_open_skill_under_a_foreign_title_is_off_the_field() {
    let a = run(
        &finance(),
        "Senior Sales Executive (m/w/d)",
        "Ihr Profil\n- Erfolge im Neukundengeschäft\n- Verhandlungssicheres Deutsch\n\
         - Gutes Englisch\n- Sicheres Auftreten\n",
    );
    assert!(a.score <= 30, "{}", a.score);
    // The same must under a title of the profile's field: no such cap.
    let b = run(
        &finance(),
        "Controller (m/w/d)",
        "Ihr Profil\n- Erfolge im Neukundengeschäft\n- Verhandlungssicheres Deutsch\n\
         - Gutes Englisch\n- Sicheres Auftreten\n",
    );
    assert!(b.score > a.score, "{} > {}", b.score, a.score);
}

/// A junior role is a level mismatch for a senior profile (ten years or more), even when
/// every skill fits and the profile sets no target years.
#[test]
fn a_junior_role_caps_a_senior_profile() {
    let text =
        "Ihr Profil\n- Erfahrung im Controlling\n- Treasury\n- Konzernrechnungslegung nach IFRS\n";
    let profile = finance();
    let junior = run(&profile, "Junior Controller (m/w/d)", text);
    let regular = run(&profile, "Controller (m/w/d)", text);
    assert!(junior.score <= 40, "{}", junior.score);
    assert!(regular.score > 40, "{}", regular.score);
}

/// Equal scores keep an order: the score before the caps.
#[test]
fn the_rank_orders_capped_scores() {
    let weak = run(
        &finance(),
        "Controller (m/w/d)",
        "Ihr Profil\n- Erfahrung im Controlling\n- Python\n- Tableau\n- Snowflake\n",
    );
    let weaker = run(
        &finance(),
        "Data Engineer (m/w/d)",
        "Ihr Profil\n- Kubernetes\n- Python\n- Tableau\n- Snowflake\n",
    );
    assert!(weak.rank > weaker.rank, "{} > {}", weak.rank, weaker.rank);
    assert!(u32::from(weak.rank) >= u32::from(weak.score) * 10 - 5);
}

/// A language met is a light fit: two musts met of three weigh less when one of them is a
/// language than when both are skills.
#[test]
fn a_language_met_weighs_less_than_a_skill_met() {
    let skills = run(
        &finance(),
        "Controller (m/w/d)",
        "Ihr Profil\n- Erfahrung im Controlling\n- Treasury\n- Tableau\n",
    );
    let language = run(
        &finance(),
        "Controller (m/w/d)",
        "Ihr Profil\n- Erfahrung im Controlling\n- Fluent English\n- Tableau\n",
    );
    assert!(
        skills.score > language.score,
        "{} > {}",
        skills.score,
        language.score
    );
}

/// A must of leadership or generic words alone names no field: with every other skill must
/// open the ad is off the field, even though a leading role meets the leadership half and
/// nice-to-haves fit.
#[test]
fn leadership_alone_names_no_field() {
    let a = run(
        &finance(),
        "Key Account Manager (m/w/d)",
        "Ihr Profil\n- Führungserfahrung\n- Salesforce\n- HubSpot\n\
         Wünschenswert\n- Controlling\n- Treasury\n",
    );
    assert!(a.score <= 25, "{}", a.score);
}

/// A must that asks for first professional experience makes an entry-level role: it caps a
/// senior profile like a junior title.
#[test]
fn first_professional_experience_caps_a_senior_profile() {
    let profile = finance();
    let entry = run(
        &profile,
        "Referent Controlling (m/w/d)",
        "Ihr Profil\n- Erste Berufserfahrung im Controlling\n- Treasury\n\
         - Konzernrechnungslegung nach IFRS\n",
    );
    let regular = run(
        &profile,
        "Referent Controlling (m/w/d)",
        "Ihr Profil\n- Mehrjährige Berufserfahrung im Controlling\n- Treasury\n\
         - Konzernrechnungslegung nach IFRS\n",
    );
    assert!(entry.score <= 40, "{}", entry.score);
    assert!(regular.score > 40, "{}", regular.score);
}

/// Years below the profile's never exclude: an open minimum is met by more years, and the
/// highest years an ad asks for, whatever topic they name, make it over-qualified only as a
/// closed range far below the profile's years.
#[test]
fn years_below_the_profile_never_exclude() {
    let over = |a: &Assessment| {
        a.reasons
            .iter()
            .any(|r| r.code == ReasonCode::Overqualified)
    };
    let open = "Ihr Profil\n- Mindestens 3 Jahre Erfahrung mit Power BI\n- Controlling\n";
    let regular = run(&finance(), "Controller (m/w/d)", open);
    assert_ne!(regular.verdict, Verdict::Excluded, "{:#?}", regular.reasons);
    assert!(!over(&regular), "{:#?}", regular.reasons);
    let closed = "Ihr Profil\n- 2-4 Jahre Erfahrung mit Power BI\n- Controlling\n";
    for title in ["Controller (m/w/d)", "Head of Controlling (m/w/d)"] {
        let a = run(&finance(), title, closed);
        assert_ne!(a.verdict, Verdict::Excluded, "{:#?}", a.reasons);
        assert!(over(&a), "{title}: {:#?}", a.reasons);
    }
}

/// General experience is judged by the profile's years: at or above met, from four fifths
/// on in part, below that open; topic years by the competence's own years.
#[test]
fn general_years_against_the_profile_years() {
    let kind = |years: u32, text: &str| {
        let mut profile = finance();
        profile["berufserfahrung_jahre"] = years.into();
        let a = run(&profile, "Controller (m/w/d)", text);
        a.reasons
            .iter()
            .find(|r| r.code == ReasonCode::Requirement && r.params.contains_key("years"))
            .map(|r| (r.kind, r.params.contains_key("general")))
    };
    let general = "Ihr Profil\n- Mindestens 10 Jahre Berufserfahrung\n- Controlling\n";
    assert_eq!(kind(15, general), Some((ReasonKind::Met, true)));
    assert_eq!(kind(10, general), Some((ReasonKind::Met, true)));
    assert_eq!(kind(8, general), Some((ReasonKind::Partial, true)));
    assert_eq!(kind(7, general), Some((ReasonKind::Open, true)));
    // `Controlling` has 15 years of its own, whatever the profile's total.
    let topic = "Ihr Profil\n- Mindestens 12 Jahre Erfahrung im Controlling\n- Treasury\n";
    assert_eq!(kind(7, topic), Some((ReasonKind::Met, false)));
}

/// A teaser is judged like a full ad where its title names the field: an open field word
/// of the title caps it like an open must on the title's topic.
#[test]
fn an_open_title_word_caps_a_teaser() {
    let text = "Die Muster AG sucht ab sofort Unterstützung im Treasury und Controlling mit \
                Konzernrechnungslegung nach IFRS sowie Salesforce …";
    let job = JobInput {
        title: "Treasury Manager Salesforce (m/w/d)",
        company: "Muster AG",
        location: "Köln, Deutschland",
        portal: Portal::LinkedIn,
        text,
        facts: None,
        posted: None,
        kind: TextKind::Teaser,
    };
    let a = assess(&compile_profile(&finance()), &job, None).expect("assessed");
    assert!(a.score <= 60, "{} {:#?}", a.score, a.reasons);
}
