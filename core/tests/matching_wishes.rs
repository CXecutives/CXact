//! The Schwerpunkte, target roles and wishes of the profile, one test per feature: the
//! starred competences, `wunschrollen` and the wishes (day rate, work mode, regions, the
//! starred industries). Each is off while it is empty, visible as a reason with code and
//! params, bounded, and never an exclusion.

use std::path::Path;

use jobalert_core::matching::{
    Assessment, JobInput, Reason, ReasonCode, ReasonKind, TextKind, Verdict, WishKey, assess,
    compile_profile,
};
use jobalert_core::portal::Portal;
use jobalert_core::profile::{ProfileForm, ProfileIndustry, WorkWish, parse};
use serde_json::{Value, json};

/// An invented interim finance consultant without Schwerpunkte, target roles or wishes.
fn base() -> ProfileForm {
    let value = json!({
        "kernkompetenzen": [
            {"kompetenz": "Controlling", "jahre": 15},
            {"kompetenz": "Konzernrechnungslegung nach IFRS", "jahre": 12},
            {"kompetenz": "Treasury", "jahre": 10},
            {"kompetenz": "Restrukturierung", "jahre": 8},
            {"kompetenz": "Budgetierung", "jahre": 12},
            {"kompetenz": "Forecast", "jahre": 12}
        ],
        "vertragsarten": ["projekt", "festanstellung"],
        "tagessatz_min": 800,
        "laender": ["DE"]
    });
    parse(&value.to_string()).expect("a v19 profile")
}

/// The base profile with these competences starred.
fn focus(names: &[&str]) -> ProfileForm {
    let mut profile = base();
    for competence in &mut profile.competences {
        competence.focus = names.contains(&competence.name.as_str());
    }
    profile
}

/// The base profile with these target roles.
fn roles(names: &[&str]) -> ProfileForm {
    ProfileForm {
        roles: names.iter().map(|r| (*r).to_owned()).collect(),
        ..base()
    }
}

/// The base profile with these industries preferred.
fn preferring(industries: &[&str]) -> ProfileForm {
    ProfileForm {
        industries: industries
            .iter()
            .map(|name| ProfileIndustry {
                name: (*name).to_owned(),
                preferred: true,
            })
            .collect(),
        ..base()
    }
}

struct Ad<'a> {
    title: &'a str,
    company: &'a str,
    location: &'a str,
    portal: Portal,
    text: &'a str,
}

const AD: Ad<'static> = Ad {
    title: "Interim Controller (m/w/d)",
    company: "Muster AG",
    location: "Hamburg, Deutschland",
    portal: Portal::LinkedIn,
    text: "",
};

fn run(profile: &ProfileForm, ad: &Ad<'_>) -> Assessment {
    let job = JobInput {
        title: ad.title,
        company: ad.company,
        location: ad.location,
        portal: ad.portal,
        text: ad.text,
        facts: None,
        posted: None,
        kind: TextKind::Full,
    };
    assess(&compile_profile(profile), &job, None).expect("assessed")
}

fn reason(a: &Assessment, code: ReasonCode) -> Option<&Reason> {
    a.reasons.iter().find(|r| r.code == code)
}

fn state(a: &Assessment, code: ReasonCode) -> String {
    reason(a, code)
        .and_then(|r| r.params.get("state"))
        .and_then(Value::as_str)
        .unwrap_or("none")
        .to_owned()
}

/// Two musts met, one open: a mid score with room up and down.
const TREASURY_TEXT: &str = "Über uns\n\
Ein Maschinenbauer aus dem Allgäu.\n\n\
Ihr Profil\n\
- Erfahrung im Treasury\n\
- Erfahrung im Controlling\n\
- Kenntnisse in der Zollabwicklung\n\n\
Rahmenbedingungen\n\
Tagessatz 1.100 € pro Tag\n";

const CONTROLLING_TEXT: &str = "Über uns\n\
Ein Mittelständler aus dem Norden.\n\n\
Ihr Profil\n\
- Erfahrung im Controlling\n\
- Erfahrung in der Budgetierung\n\
- Kenntnisse in der Zollabwicklung\n\n\
Rahmenbedingungen\n\
Tagessatz 1.100 € pro Tag\n";

fn ad(text: &str) -> Ad<'_> {
    Ad { text, ..AD }
}

#[test]
fn a_schwerpunkt_the_ad_demands_counts_double_and_raises_relevance() {
    let plain = run(&base(), &ad(TREASURY_TEXT));
    let focus = focus(&["Treasury"]);
    let a = run(&focus, &ad(TREASURY_TEXT));
    assert!(a.score > plain.score, "{} vs {}", a.score, plain.score);
    let r = reason(&a, ReasonCode::Focus).expect("focus reason");
    assert_eq!(r.kind, ReasonKind::Met);
    assert_eq!(r.params["focus"], "Treasury");
    assert_eq!(r.params["met"], 1);
    assert_eq!(r.params["relevance"], 100);
    assert_eq!(
        r.evidence.as_ref().expect("evidence").path,
        "kernkompetenzen[2].kompetenz"
    );
    assert!(!r.ranges.is_empty(), "the requirement is highlighted");
    let requirement = a
        .reasons
        .iter()
        .find(|r| r.label.as_deref() == Some("Erfahrung im Treasury"))
        .expect("requirement");
    assert_eq!(requirement.params["focus"], "Treasury");
}

#[test]
fn an_ad_that_demands_no_schwerpunkt_gets_nothing() {
    let focus = focus(&["Treasury", "Restrukturierung"]);
    let plain = run(&base(), &ad(CONTROLLING_TEXT));
    let a = run(&focus, &ad(CONTROLLING_TEXT));
    assert_eq!(a.score, plain.score);
    assert!(reason(&a, ReasonCode::Focus).is_none());
    // A broader requirement inside the Schwerpunkt does not demand it.
    let ifrs = self::focus(&["Konzernrechnungslegung nach IFRS"]);
    let text = "Ihr Profil\n- Kenntnisse in IFRS\n- Erfahrung im Controlling\n\
                - Kenntnisse in der Zollabwicklung\nRahmenbedingungen\nTagessatz 1.100 € pro Tag\n";
    assert_eq!(run(&ifrs, &ad(text)).score, run(&base(), &ad(text)).score);
    assert!(reason(&run(&ifrs, &ad(text)), ReasonCode::Focus).is_none());
}

#[test]
fn a_schwerpunkt_in_the_title_raises_relevance() {
    let title = Ad {
        title: "Interim Treasury Manager (m/w/d)",
        ..ad(CONTROLLING_TEXT)
    };
    let focus = focus(&["Treasury"]);
    let a = run(&focus, &title);
    let r = reason(&a, ReasonCode::Focus).expect("focus from the title");
    assert_eq!(r.params["inTitle"], true);
    assert!(a.score > run(&base(), &title).score);
}

#[test]
fn target_roles_full_half_and_none() {
    let roles = roles(&["Interim CFO", "Head of Finance"]);
    let titled = |title: &'static str| Ad {
        title,
        ..ad(CONTROLLING_TEXT)
    };
    let plain = run(&base(), &titled("Interim CFO (m/w/d)"));
    let full = run(&roles, &titled("Interim CFO (m/w/d)"));
    let r = reason(&full, ReasonCode::TargetRole).expect("target role");
    assert_eq!(
        (r.kind, r.params["fit"].as_str()),
        (ReasonKind::Met, Some("full"))
    );
    assert_eq!(r.params["points"], 8);
    assert!(
        (7..=9).contains(&(full.score - plain.score)),
        "{} vs {}",
        full.score,
        plain.score
    );
    // The field without the lead level: half.
    let half = run(&roles, &titled("Interim Finance Manager (m/w/d)"));
    let r = reason(&half, ReasonCode::TargetRole).expect("half role");
    assert_eq!(
        (r.kind, r.params["points"].as_i64()),
        (ReasonKind::Partial, Some(4))
    );
    // Another role: nothing.
    let other = run(&roles, &titled("Senior Controller (m/w/d)"));
    assert!(reason(&other, ReasonCode::TargetRole).is_none());
    assert_eq!(
        other.score,
        run(&base(), &titled("Senior Controller (m/w/d)")).score
    );
}

#[test]
fn a_target_role_never_lifts_a_capped_or_excluded_ad() {
    let roles = roles(&["Interim CFO"]);
    let off_field = Ad {
        title: "Interim CFO (m/w/d) Klinikverbund",
        text: "Ihr Profil\n- Erfahrung in der Krankenhausbuchhaltung\n\
               - Kenntnisse im DRG-System\n- Erfahrung in Pflegesatzverhandlungen\n\
               Rahmenbedingungen\nTagessatz 1.400 € pro Tag\n",
        ..AD
    };
    let a = run(&roles, &off_field);
    assert!(reason(&a, ReasonCode::TargetRole).is_some());
    assert!(a.score <= 25, "off-field cap holds, got {}", a.score);
    let anue = Ad {
        title: "Interim CFO (m/w/d)",
        text: "Ihr Profil\n- Erfahrung im Treasury\n- Erfahrung im Controlling\n\
               Rahmenbedingungen\nDie Besetzung erfolgt im Rahmen der Arbeitnehmerüberlassung.\n",
        ..AD
    };
    assert_eq!(run(&roles, &anue).verdict, Verdict::Excluded);
}

#[test]
fn day_rate_wish_met_near_missed_unknown() {
    let profile = ProfileForm {
        day_rate_wish: Some(1000),
        ..base()
    };
    let text = |rate: &str| {
        format!(
            "Ihr Profil\n- Erfahrung im Treasury\n- Erfahrung im Controlling\n\
             - Kenntnisse in der Zollabwicklung\nRahmenbedingungen\n{rate}\n"
        )
    };
    let check = |rate: &str, expected: &str| {
        let body = text(rate);
        let a = run(&profile, &ad(&body));
        assert_eq!(state(&a, ReasonCode::DayRateWish), expected, "{rate}");
        let plain = run(&base(), &ad(&body));
        (i32::from(a.score) - i32::from(plain.score), a)
    };
    let (delta, met) = check("Tagessatz 1.100 € pro Tag", "met");
    assert!(
        (2..=4).contains(&delta),
        "met adds three points, got {delta}"
    );
    let r = reason(&met, ReasonCode::DayRateWish).expect("reason");
    assert_eq!(
        (r.params["wish"].as_u64(), r.params["rate"].as_u64()),
        (Some(1000), Some(1100))
    );
    assert_eq!(check("Tagessatz 960 € pro Tag", "near").0, 0);
    let (delta, _) = check("Tagessatz 850 € pro Tag", "missed");
    assert!(
        (-4..=-2).contains(&delta),
        "missed takes three points, got {delta}"
    );
    assert_eq!(check("Start ab sofort", "unknown").0, 0);
    let (_, chf) = check("Tagessatz CHF 1.200 pro Tag", "unknown");
    assert_eq!(
        reason(&chf, ReasonCode::DayRateWish).unwrap().params["currency"],
        "CHF"
    );
    // Not for permanent roles.
    let body = text("Eine unbefristete Festanstellung mit einem Jahresgehalt von 120.000 €");
    let permanent = Ad {
        title: "Controller (m/w/d)",
        ..ad(&body)
    };
    let permanent = run(&profile, &permanent);
    assert!(reason(&permanent, ReasonCode::DayRateWish).is_none());
}

#[test]
fn work_mode_wishes() {
    let case = |mode: WorkWish, frame: &str| {
        let body = format!(
            "Ihr Profil\n- Erfahrung im Treasury\n- Erfahrung im Controlling\n\
             Rahmenbedingungen\nTagessatz 1.100 € pro Tag\n{frame}\n"
        );
        let profile = ProfileForm {
            work_mode: mode,
            ..base()
        };
        let ad = Ad { text: &body, ..AD };
        state(&run(&profile, &ad), ReasonCode::RemoteWish)
    };
    // Remote: at least fully remote.
    assert_eq!(case(WorkWish::Remote, "Einsatz zu 100 % remote"), "met");
    assert_eq!(case(WorkWish::Remote, "Einsatz zu 80 % remote"), "near");
    assert_eq!(case(WorkWish::Remote, "Einsatz zu 60 % remote"), "missed");
    assert_eq!(case(WorkWish::Remote, "Start ab sofort"), "unknown");
    // Hybrid: at least partly remote.
    assert_eq!(case(WorkWish::Hybrid, "Remote-Anteil 40 %"), "met");
    assert_eq!(
        case(WorkWish::Hybrid, "Hybrides Arbeiten nach Absprache"),
        "met"
    );
    assert_eq!(
        case(WorkWish::Hybrid, "Einsatz vor Ort in Hamburg"),
        "missed"
    );
    // On site.
    assert_eq!(case(WorkWish::Onsite, "Einsatz zu 100 % remote"), "missed");
    assert_eq!(case(WorkWish::Onsite, "Einsatz vor Ort in Hamburg"), "met");
}

#[test]
fn region_wish_places_states_and_remote_only() {
    let profile = ProfileForm {
        regions: vec!["Bayern".into(), "Frankfurt am Main".into()],
        ..base()
    };
    let case = |location: &'static str, frame: &str| {
        let body = format!(
            "Ihr Profil\n- Erfahrung im Treasury\n- Erfahrung im Controlling\n\
             Rahmenbedingungen\nTagessatz 1.100 € pro Tag\n{frame}\n"
        );
        let ad = Ad {
            location,
            text: &body,
            ..AD
        };
        let a = run(&profile, &ad);
        let r = reason(&a, ReasonCode::RegionWish)
            .expect("region reason")
            .clone();
        (state(&a, ReasonCode::RegionWish), r.params)
    };
    let (s, p) = case("München, Bayern, Deutschland", "Einsatz vor Ort");
    assert_eq!(
        (s.as_str(), p["location"].as_str()),
        ("met", Some("München"))
    );
    assert_eq!(case("D-90402 Nürnberg", "Einsatz vor Ort").0, "met");
    assert_eq!(case("60311 Frankfurt am Main", "Einsatz vor Ort").0, "met");
    let (s, p) = case("Hamburg, Deutschland", "Einsatz vor Ort in Hamburg");
    assert_eq!(
        (s.as_str(), p["location"].as_str()),
        ("missed", Some("Hamburg"))
    );
    assert_eq!(
        case("Hamburg, Deutschland", "Einsatz zu 60 % remote").0,
        "near"
    );
    let (s, p) = case("Hamburg, Deutschland", "Einsatz zu 100 % remote");
    assert_eq!((s.as_str(), p["remote"].as_bool()), ("met", Some(true)));
    assert_eq!(case("Deutschland", "Einsatz vor Ort").0, "unknown");
}

#[test]
fn industry_wish_from_intro_company_and_title() {
    let profile = preferring(&["Automobilindustrie", "Versicherungen"]);
    let case = |ad: &Ad<'_>| state(&run(&profile, ad), ReasonCode::IndustryWish);
    let text = |intro: &str| {
        format!(
            "Über uns\n{intro}\n\nIhre Aufgaben\nGespräche mit den Banken\n\n\
             Ihr Profil\n- Erfahrung im Treasury\n- Erfahrung im Controlling\n\
             Rahmenbedingungen\nTagessatz 1.100 € pro Tag\n"
        )
    };
    let automotive = text("Ein Automobilzulieferer mit 900 Mitarbeitenden.");
    assert_eq!(case(&ad(&automotive)), "met");
    let retail = text("Ein Handelskonzern aus dem Norden.");
    assert_eq!(case(&ad(&retail)), "missed");
    // Tasks say nothing about the client's industry.
    let banks = preferring(&["Banken"]);
    let plain = text("Ein Mittelständler.");
    assert_eq!(
        state(&run(&banks, &ad(&plain)), ReasonCode::IndustryWish),
        "unknown"
    );
    // The company counts on LinkedIn; on a freelance portal it is the agency.
    let wiesbaden = text("Ein Unternehmen aus Wiesbaden.");
    let insurer = Ad {
        company: "Rheingau Versicherung AG",
        ..ad(&wiesbaden)
    };
    assert_eq!(case(&insurer), "met");
    let agency = Ad {
        portal: Portal::Freelancermap,
        ..insurer
    };
    assert_eq!(case(&agency), "unknown");
}

#[test]
fn wishes_are_bounded_and_never_exclude() {
    let profile = ProfileForm {
        day_rate_wish: Some(1500),
        work_mode: WorkWish::Remote,
        regions: vec!["München".into()],
        ..preferring(&["Automobilindustrie"])
    };
    let missed = Ad {
        location: "Hamburg, Deutschland",
        text: "Über uns\nEin Handelskonzern.\n\nIhr Profil\n- Erfahrung im Treasury\n\
               - Erfahrung im Controlling\n- Kenntnisse in der Zollabwicklung\n\
               Rahmenbedingungen\nTagessatz 900 € pro Tag\nEinsatz vor Ort in Hamburg\n",
        ..AD
    };
    let plain = run(&base(), &missed);
    let a = run(&profile, &missed);
    assert_eq!(a.verdict, Verdict::Scored, "wishes never exclude");
    let delta = i32::from(plain.score) - i32::from(a.score);
    assert!(
        (9..=11).contains(&delta),
        "all four missed take ten points, got {delta}"
    );
    let points: i64 = a
        .reasons
        .iter()
        .filter_map(|r| r.params.get("points").and_then(Value::as_i64))
        .sum();
    assert_eq!(points, -10);
    for r in &a.reasons {
        assert_ne!(r.kind, ReasonKind::Violation, "{r:?}");
    }
}

/// A change of the base profile.
type Change = Box<dyn Fn(&mut ProfileForm)>;

#[test]
fn the_summary_and_the_fingerprint_follow_the_fields() {
    let plain = compile_profile(&base());
    assert!(plain.summary().wishes.iter().all(|w| !w.set));
    assert_eq!(plain.summary().wishes.len(), 6);
    let full = ProfileForm {
        day_rate_wish: Some(1300),
        work_mode: WorkWish::Hybrid,
        regions: vec!["München".into()],
        ..preferring(&["Maschinenbau"])
    };
    let compiled = compile_profile(&full);
    let set = |key| {
        compiled
            .summary()
            .wishes
            .iter()
            .find(|w| w.key == key)
            .expect("wish")
            .clone()
    };
    assert_eq!(set(WishKey::DayRate).params["wish"], 1300);
    assert_eq!(set(WishKey::Remote).params["min"], 20);
    assert_eq!(set(WishKey::Remote).params["level"], "hybrid");
    assert!(set(WishKey::Regions).set && set(WishKey::Industries).set);
    let mut seen = vec![plain.fingerprint()];
    let changes: [(&str, Change); 6] = [
        ("focus", Box::new(|p| p.competences[2].focus = true)),
        ("role", Box::new(|p| p.roles = vec!["Interim CFO".into()])),
        ("rate", Box::new(|p| p.day_rate_wish = Some(1200))),
        ("mode", Box::new(|p| p.work_mode = WorkWish::Remote)),
        ("region", Box::new(|p| p.regions = vec!["Hamburg".into()])),
        (
            "industry",
            Box::new(|p| {
                p.industries = vec![ProfileIndustry {
                    name: "Chemie".into(),
                    preferred: true,
                }];
            }),
        ),
    ];
    for (name, change) in changes {
        let mut profile = base();
        change(&mut profile);
        let fingerprint = compile_profile(&profile).fingerprint();
        assert!(!seen.contains(&fingerprint), "{name}");
        seen.push(fingerprint);
    }
}

/// Every reason and warning code of the engine has a text in the UI catalog.
#[test]
fn every_engine_code_has_a_catalog_text() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("..");
    let types = std::fs::read_to_string(root.join("core/src/matching/types.rs")).expect("types");
    let catalog = std::fs::read_to_string(root.join("ui/src/lib/i18n/de.ts")).expect("de.ts");
    let variants = |name: &str| -> Vec<String> {
        let start = types
            .find(&format!("pub enum {name} {{"))
            .unwrap_or_else(|| panic!("{name}"));
        let body = &types[start..];
        let body = &body[body.find('{').unwrap() + 1..body.find("\n}").unwrap()];
        body.lines()
            .map(str::trim)
            .filter(|l| !l.starts_with("//") && !l.is_empty())
            .filter_map(|l| l.strip_suffix(','))
            .map(|v| {
                let mut camel = v[..1].to_lowercase();
                camel.push_str(&v[1..]);
                camel
            })
            .collect()
    };
    let block = |start: &str| -> &str {
        let at = catalog.find(start).unwrap_or_else(|| panic!("{start}"));
        let rest = &catalog[at..];
        &rest[..rest.find("} satisfies").expect("end of block")]
    };
    for (enum_name, table) in [
        ("ReasonCode", "const reasonCode = {"),
        ("ProfileWarningCode", "const warning = {"),
    ] {
        let block = block(table);
        for code in variants(enum_name) {
            let listed =
                block.contains(&format!("\n  {code}:")) || block.contains(&format!("\n  {code},"));
            assert!(listed, "{enum_name}::{code} has no text in de.ts");
        }
    }
}
