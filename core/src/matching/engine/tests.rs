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
