//! Profiles beyond the corpus: a field without any domain pack (the general core alone plus
//! the profile's own terms), the summary of the profile (packs, years, degrees, criteria)
//! and formal duties (licences).

use std::path::Path;

use jobalert_core::matching::{
    Assessment, CriterionKey, JobInput, ProfileQuality, ReasonCode, ReasonKind, TextKind, Verdict,
    assess, compile_profile,
};
use jobalert_core::portal::Portal;
use jobalert_core::profile::{ProfileForm, parse};
use serde_json::json;

fn fixture(name: &str) -> ProfileForm {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/matching")
        .join(name);
    parse(&std::fs::read_to_string(path).expect("fixture")).expect("a v19 profile")
}

fn run(profile: &ProfileForm, title: &str, text: &str) -> Assessment {
    let job = JobInput {
        title,
        company: "Muster AG",
        location: "Berlin, Deutschland",
        portal: Portal::LinkedIn,
        text,
        facts: None,
        posted: None,
        kind: TextKind::Full,
    };
    assess(&compile_profile(profile), &job, None).expect("assessed")
}

fn has(a: &Assessment, code: ReasonCode, kind: ReasonKind) -> bool {
    a.reasons.iter().any(|r| r.code == code && r.kind == kind)
}

/// An invented clinical project manager: no domain pack, own terms in English too.
fn clinical() -> ProfileForm {
    let value = json!({
        "kernkompetenzen": [
            {"kompetenz": "Klinische Studienleitung", "jahre": 12},
            {"kompetenz": "Good Clinical Practice", "jahre": 12},
            {"kompetenz": "Monitoring klinischer Prüfungen", "jahre": 8},
            {"kompetenz": "Projektmanagement", "jahre": 15},
            {"kompetenz": "Zulassungsstrategie", "jahre": 6},
            {"kompetenz": "Pharmakovigilanz", "jahre": 5}
        ],
        "methoden_tools": [
            "Clinical Trial Management", "Studienmanagement", "GCP", "Clinical Monitoring",
            "Regulatory Affairs"
        ],
        "sprachen": [
            {"sprache": "Deutsch", "niveau": "Muttersprache"},
            {"sprache": "Englisch", "niveau": "C1"}
        ],
        "vertragsarten": ["projekt", "festanstellung"],
        "laender": ["DE"]
    });
    parse(&value.to_string()).expect("a v19 profile")
}

const CLINICAL_AD: &str = "About the role\n\
We are looking for an interim clinical project manager for a phase III study.\n\
Requirements\n\
Several years of experience in clinical trial management\n\
Sound knowledge of GCP\n\
Experience in clinical monitoring\n\
Experience in project management\n\
Fluent English\n\
What we offer\n\
Day rate: 1,050 EUR\n";

const FINANCE_AD: &str = "Ihr Profil\n\
Mehrjährige Erfahrung im Controlling\n\
Fundierte Kenntnisse in der Konzernrechnungslegung nach IFRS\n\
Erfahrung mit Monatsabschlüssen nach HGB\n\
Rahmenbedingungen\n\
Tagessatz 1.200 € pro Tag\n";

#[test]
fn the_core_alone_serves_an_unrelated_field() {
    let profile = clinical();
    let compiled = compile_profile(&profile);
    assert!(
        compiled.summary().packs.is_empty(),
        "no pack for clinical work"
    );
    let fit = run(
        &profile,
        "Interim Clinical Project Manager (m/w/d)",
        CLINICAL_AD,
    );
    assert_eq!(fit.verdict, Verdict::Scored);
    assert!(fit.score >= 80, "clinical ad scored {}", fit.score);
    let tool = fit
        .reasons
        .iter()
        .find_map(|r| {
            r.evidence
                .as_ref()
                .filter(|e| e.path.starts_with("methoden_tools["))
        })
        .expect("an English term meets a requirement");
    assert_eq!(tool.path, "methoden_tools[0]");
    let other = run(&profile, "Interim Konzerncontroller (m/w/d)", FINANCE_AD);
    assert!(other.score <= 25, "finance ad scored {}", other.score);
    assert!(has(&other, ReasonCode::ContractType, ReasonKind::Met));
}

#[test]
fn packs_follow_the_competences() {
    let senior = compile_profile(&fixture("sample_profile_senior.json"));
    assert_eq!(senior.summary().packs, ["finance", "sap", "restructuring"]);
    let sap = compile_profile(&fixture("sample_profile_sap.json"));
    assert_eq!(sap.summary().packs, ["finance", "sap", "itProject"]);
    let it = compile_profile(&fixture("sample_profile_it.json"));
    assert_eq!(it.summary().packs, ["sap", "itProject"]);
}

#[test]
fn the_summary_shows_years_degrees_and_criteria() {
    let senior = compile_profile(&fixture("sample_profile_senior.json"));
    let summary = senior.summary();
    assert_eq!(summary.years, Some(30));
    assert!(
        summary
            .degrees
            .iter()
            .any(|d| d.starts_with("Diplom-Kauffrau (Univ.)")),
        "{:?}",
        summary.degrees
    );
    let criterion = |key| {
        summary
            .criteria
            .iter()
            .find(|c| c.key == key)
            .expect("criterion")
    };
    assert_eq!(criterion(CriterionKey::MinSalary).params["min"], 150_000);
    assert!(summary.warnings.is_empty(), "{:?}", summary.warnings);
    assert_eq!(senior.quality(), ProfileQuality::Good);
}

#[test]
fn a_mandatory_licence_excludes_an_optional_one_caps() {
    let profile = fixture("sample_profile_senior.json");
    let ad = |licence: &str| {
        format!(
            "Anforderungen:\n- {licence}\n- Mehrjährige Erfahrung im Controlling\n\
             - Fundierte Kenntnisse in der Konzernrechnungslegung nach IFRS\n\
             - Erfahrung mit Monatsabschlüssen\nRahmenbedingungen:\nTagessatz: 1.300 € pro Tag\n"
        )
    };
    let mandatory = run(
        &profile,
        "Interim Leitung Steuern (m/w/d)",
        &ad("Zulassung als Steuerberater:in zwingend erforderlich"),
    );
    assert_eq!(mandatory.verdict, Verdict::Excluded);
    assert!(has(
        &mandatory,
        ReasonCode::FormalOpen,
        ReasonKind::Violation
    ));
    let optional = run(
        &profile,
        "Interim Leitung Steuern (m/w/d)",
        &ad("Zulassung als Steuerberater:in"),
    );
    assert_eq!(optional.verdict, Verdict::Scored);
    assert!(has(&optional, ReasonCode::FormalOpen, ReasonKind::Check));
    assert!(optional.score <= 40, "capped, got {}", optional.score);
}

/// A certificate the ad makes mandatory and the profile does not hold excludes; asked for
/// without that word it is a requirement like any other.
#[test]
fn a_mandatory_certificate_excludes() {
    let profile = fixture("sample_profile_senior.json");
    let ad = |certificate: &str| {
        format!(
            "Anforderungen:
- {certificate}
- Mehrjährige Erfahrung im Controlling
             - Fundierte Kenntnisse in der Konzernrechnungslegung nach IFRS
             Rahmenbedingungen:
Tagessatz: 1.300 € pro Tag
"
        )
    };
    let title = "Interim Leiter Controlling (m/w/d)";
    let mandatory = run(
        &profile,
        title,
        &ad("Six Sigma Black Belt Zertifizierung (zwingend)"),
    );
    assert_eq!(mandatory.verdict, Verdict::Excluded);
    assert!(has(
        &mandatory,
        ReasonCode::FormalOpen,
        ReasonKind::Violation
    ));
    let plain = run(&profile, title, &ad("Six Sigma Black Belt Zertifizierung"));
    assert_eq!(plain.verdict, Verdict::Scored);
}

/// Ordinary German requirement lines that once panicked the splitter (overlapping ", " and
/// " oder ", "z. B." after a closed bracket) - for every sample profile.
#[test]
fn separator_edge_lines_assess_for_every_sample_profile() {
    let lines = [
        "Studium der Wirtschaftswissenschaften, oder eine vergleichbare Qualifikation",
        "Erfahrung mit einem ERP-System (SAP) z. B. S/4HANA",
    ];
    for name in [
        "sample_profile.json",
        "sample_profile_it.json",
        "sample_profile_sap.json",
        "sample_profile_senior.json",
    ] {
        let profile = fixture(name);
        for line in lines {
            let text = format!(
                "Für ein Transformationsprojekt im Finanzbereich eines Konzerns suchen wir ab \
                 sofort eine erfahrene Unterstützung.\n\nIhr Profil:\n- {line}\n\
                 - Erfahrung im Controlling\n"
            );
            let a = run(&profile, "Interim Controller (m/w/d)", &text);
            assert!(a.score <= 100, "{name}: {line}");
            assert!(
                a.reasons
                    .iter()
                    .filter_map(|r| r.label.as_deref())
                    .any(|label| line.starts_with(label)),
                "{name}: the line is read as a requirement: {:?}",
                a.reasons
            );
        }
    }
}

/// A rate beyond any plausible amount stays far above the minimum (1000 in the sample
/// profile); it neither overflows nor wraps below it into a decided exclusion.
#[test]
fn an_absurd_hourly_rate_is_no_day_rate_violation() {
    let text = "Für ein Transformationsprojekt im Finanzbereich eines Konzerns suchen wir ab \
                sofort eine erfahrene Unterstützung.\n\n\
                Ihr Profil:\n- Erfahrung im Controlling\n\nRahmenbedingungen\n\
                - Stundensatz 99999999999999999999999 € pro Stunde\n";
    let a = run(
        &fixture("sample_profile.json"),
        "Interim Controller (m/w/d)",
        text,
    );
    assert!(
        !has(&a, ReasonCode::DayRate, ReasonKind::Violation),
        "{:?}",
        a.reasons
    );
    assert_ne!(a.verdict, Verdict::Excluded, "{:?}", a.reasons);
}

/// A plain interim ad every test profile can read.
const TEST_PROFILE_AD: &str = "Für ein Transformationsprojekt suchen wir Unterstützung auf \
freiberuflicher Basis.

Ihre Aufgaben:
- Leitung von Teilprojekten und Steuerung externer Partner
- Aufbau eines Reportings für die Geschäftsführung

Ihr Profil:
- Mehrjährige Projekterfahrung
- Erfahrung im Mittelstand
- Sehr gute Deutsch- und Englischkenntnisse

Rahmendaten:
- Start: ab sofort
- Laufzeit: 6 Monate
- Auslastung: 3 Tage pro Woche
- Tagessatz: 1.200 € pro Tag";

/// The test profiles (`tools/test-profiles/`) read as v19, are understood without a warning,
/// set their criteria and score an ad.
#[test]
fn the_test_profiles_load_and_score() {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("../tools/test-profiles");
    let mut names = Vec::new();
    for entry in std::fs::read_dir(&dir).expect("tools/test-profiles") {
        let path = entry.expect("entry").path();
        if path.extension().is_none_or(|e| e != "json") {
            continue;
        }
        let name = path
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        let form = parse(&std::fs::read_to_string(&path).expect("file")).expect("loads");
        let compiled = compile_profile(&form);
        assert_eq!(compiled.quality(), ProfileQuality::Good, "{name}");
        assert!(
            compiled.summary().warnings.is_empty(),
            "{name}: {:?}",
            compiled.summary().warnings
        );
        let a = run(&form, "Interim Projektleitung (m/w/d)", TEST_PROFILE_AD);
        assert_eq!(a.verdict, Verdict::Scored, "{name}: {:?}", a.reasons);
        names.push(name);
    }
    names.sort();
    assert_eq!(
        names,
        [
            "interim-cfo.json",
            "it-cloud-freelancer.json",
            "ki-automatisierung.json",
            "performance-profit.json",
            "sap-fico.json"
        ]
    );
    let text = std::fs::read_to_string(dir.join("interim-cfo.json")).expect("file");
    let cfo = compile_profile(&parse(&text).expect("a v19 profile"));
    let set: Vec<CriterionKey> = cfo
        .summary()
        .criteria
        .iter()
        .filter(|c| c.set)
        .map(|c| c.key)
        .collect();
    assert_eq!(
        set,
        [
            CriterionKey::MinDayRate,
            CriterionKey::Countries,
            CriterionKey::NoAnue,
            CriterionKey::Availability,
            CriterionKey::MinSalary,
            CriterionKey::Duration,
            CriterionKey::ExclusionWords
        ]
    );
}
