use crate::matching::{Assessment, CapCode, JobInput, PartCode, TextKind, assess, compile_profile};
use crate::portal::Portal;

// external contract - do not translate (profile JSON keys)
const PROFILE: &str = r#"{
        "kernkompetenzen": [
            {"kompetenz": "Controlling"}, {"kompetenz": "Reporting nach IFRS"},
            {"kompetenz": "Konsolidierung"}, {"kompetenz": "Liquiditätsplanung"},
            {"kompetenz": "Restrukturierung"}, {"kompetenz": "Treasury"}
        ],
        "wunschrollen": ["Interim CFO"],
        "arbeitsmodell": "remote"
    }"#;

// external contract - do not translate (German ads)
const CFO: &str = "Wir suchen einen Interim CFO für ein Familienunternehmen.\n\n\
        Ihr Profil\n\
        • Erfahrung im Controlling\n\
        • Reporting nach IFRS\n\
        • Erfahrung in der Konsolidierung\n\
        • Liquiditätsplanung\n\n\
        Wünschenswert\n\
        • Erfahrung mit Treasury\n\n\
        Der Einsatz ist zu 100 % remote.\n";

fn assessed(title: &str, text: &str) -> Assessment {
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
    assess(&profile, &job).unwrap()
}

fn points(a: &Assessment, code: PartCode) -> i16 {
    a.parts
        .iter()
        .find(|p| p.code == code)
        .map_or(0, |p| p.points)
}

/// The lines of the Passungsgrad add up to the score: the three content parts, the
/// nice-to-have bonus, the frame lines, the permanent line and the cap that held.
#[test]
fn the_lines_add_up_to_the_score() {
    let permanent = CFO.replace(
        "Wir suchen einen Interim CFO für ein Familienunternehmen.",
        "Wir suchen einen CFO in Festanstellung, Vollzeit und unbefristet.",
    );
    let open_core = CFO.replace("Reporting nach IFRS", "Steuerung nach US-GAAP und HGB");
    let onsite = CFO.replace(
        "Der Einsatz ist zu 100 % remote.",
        "Der Einsatz ist zu 100 % vor Ort.",
    );
    let foreign = "Wir suchen eine Pflegefachkraft.\n\nIhr Profil\n\
            • Examen in der Gesundheits- und Krankenpflege\n• Erfahrung in der Intensivpflege\n\
            • Kenntnisse der Wundversorgung\n";
    for (title, text) in [
        ("Interim CFO (m/w/d)", CFO),
        ("CFO (m/w/d)", permanent.as_str()),
        ("Interim CFO (m/w/d)", open_core.as_str()),
        ("Interim CFO (m/w/d)", onsite.as_str()),
        ("Pflegefachkraft Intensivstation (m/w/d)", foreign),
    ] {
        let a = assessed(title, text);
        let sum: i16 = a.parts.iter().map(|p| p.points).sum();
        assert_eq!(sum, i16::from(a.score), "{title}: {:?}", a.parts);
        let codes: Vec<PartCode> = a.parts.iter().map(|p| p.code).take(3).collect();
        assert_eq!(codes, [PartCode::Role, PartCode::Core, PartCode::Musts]);
        for part in &a.parts {
            match part.code {
                PartCode::Role | PartCode::Core | PartCode::Musts | PartCode::Nice => {
                    assert!(
                        part.points >= 0 && part.points <= i16::from(part.max),
                        "{part:?}"
                    );
                }
                PartCode::Frame | PartCode::Permanent | PartCode::Cap => {
                    assert!(part.points <= 0, "{part:?}");
                }
            }
        }
        assert!(a.caps.windows(2).all(|w| w[0].max <= w[1].max));
    }
    let p = assessed("CFO (m/w/d)", &permanent);
    assert!(points(&p, PartCode::Permanent) < 0, "{:?}", p.parts);
}

/// Role and field: the target role in full is the same field; a nursing role is foreign
/// to a finance profile and caps at 24.
#[test]
fn rolle_und_fach_follows_the_role_and_the_field() {
    let cfo = assessed("Interim CFO (m/w/d)", CFO);
    let role = &cfo.parts[0];
    assert_eq!(role.params["class"], "same", "{role:?}");
    assert_eq!(role.points, i16::from(role.max));
    let nurse = assessed(
        "Pflegefachkraft Intensivstation (m/w/d)",
        "Wir suchen eine Pflegefachkraft.\n\nIhr Profil\n\
             • Examen in der Gesundheits- und Krankenpflege\n• Erfahrung in der Intensivpflege\n\
             • Kenntnisse der Wundversorgung\n",
    );
    assert_eq!(
        nurse.parts[0].params["class"], "foreign",
        "{:?}",
        nurse.parts
    );
    assert_eq!(nurse.parts[0].points, 0);
    assert!(nurse.caps.iter().any(|c| c.code == CapCode::OffField));
    assert!(nurse.score <= 24, "{}", nurse.score);
    // A role of the profile's own field is never foreign, even when its one must is open;
    // a tool that "helps" is a nice-to-have, no must.
    let treasury = assessed(
        "Interim Treasury Manager (m/w/d)",
        "Für die Neuordnung der Konzernfinanzierung suchen wir einen Interim Treasury Manager, \
             der die Liquiditätsplanung der Gesellschaften übernimmt und das Cash Management neu \
             aufsetzt. Kenntnisse in Anaplan helfen dabei.\n",
    );
    assert!(
        !treasury.caps.iter().any(|c| c.code == CapCode::OffField),
        "{:?}",
        treasury.parts
    );
    assert_ne!(treasury.parts[0].params["class"], "foreign");
    assert!(
        treasury.score >= 40,
        "{} {:?}",
        treasury.score,
        treasury.parts
    );
}

/// Core of the role: the musts on the field of the role count; open, they cost the part and
/// cap at 49.
#[test]
fn the_core_counts_the_musts_on_the_role() {
    let met = assessed("Interim CFO (m/w/d)", CFO);
    assert!(
        met.parts[1].params["total"].as_u64().unwrap() > 0,
        "{:?}",
        met.parts
    );
    let open = assessed(
        "Interim CFO (m/w/d)",
        &CFO.replace(
            "Erfahrung im Controlling",
            "Erfahrung in der Aktuarmathematik",
        )
        .replace("Reporting nach IFRS", "Bilanzierung nach US-GAAP")
        .replace(
            "Erfahrung in der Konsolidierung",
            "Erfahrung im Asset Management",
        )
        .replace("Liquiditätsplanung", "Kenntnisse der Solvency-II-Bilanz"),
    );
    assert!(
        points(&open, PartCode::Core) < points(&met, PartCode::Core),
        "{:?} {:?}",
        met.parts,
        open.parts
    );
    assert!(open.score < met.score);
}

/// Weitere Muss-Punkte: an open must off the core costs its share of the part.
#[test]
fn an_open_other_must_costs_its_share() {
    let base = assessed("Interim CFO (m/w/d)", CFO);
    let more = assessed(
        "Interim CFO (m/w/d)",
        &CFO.replace(
            "• Liquiditätsplanung\n",
            "• Liquiditätsplanung\n• Sehr gute Kenntnisse in Anaplan\n",
        ),
    );
    assert!(
        points(&more, PartCode::Musts) < points(&base, PartCode::Musts)
            || points(&more, PartCode::Core) < points(&base, PartCode::Core),
        "{:?} {:?}",
        base.parts,
        more.parts
    );
    assert!(more.score <= base.score);
}

/// Frame: what the ad does not state fits (no line); a work mode against the wish is a
/// line of its own that keeps 95 % of the score.
#[test]
fn the_frame_is_a_factor_with_a_line_per_condition() {
    let frames = |a: &Assessment| -> Vec<serde_json::Map<String, serde_json::Value>> {
        a.parts
            .iter()
            .filter(|p| p.code == PartCode::Frame)
            .map(|p| p.params.clone())
            .collect()
    };
    let remote = assessed("Interim CFO (m/w/d)", CFO);
    assert!(frames(&remote).is_empty(), "{:?}", remote.parts);
    let unstated = assessed(
        "Interim CFO (m/w/d)",
        &CFO.replace("Der Einsatz ist zu 100 % remote.\n", ""),
    );
    assert!(frames(&unstated).is_empty(), "{:?}", unstated.parts);
    let onsite = assessed(
        "Interim CFO (m/w/d)",
        &CFO.replace(
            "Der Einsatz ist zu 100 % remote.",
            "Der Einsatz ist zu 100 % vor Ort.",
        ),
    );
    let lines = frames(&onsite);
    assert_eq!(lines.len(), 1, "{:?}", onsite.parts);
    assert_eq!(lines[0]["aspect"], "place");
    assert_eq!(lines[0]["percent"], 95);
    let content: i16 =
        onsite.parts[..3].iter().map(|p| p.points).sum::<i16>() + points(&onsite, PartCode::Nice);
    assert_eq!(
        i16::from(onsite.score),
        content + points(&onsite, PartCode::Frame),
        "{:?}",
        onsite.parts
    );
    assert!(points(&onsite, PartCode::Frame) < 0);
    assert!(onsite.score < remote.score);
}
