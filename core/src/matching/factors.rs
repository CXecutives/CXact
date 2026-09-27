//! What moved a score, for the reader's "why this number": the musts met, the optional
//! requirements, the Schwerpunkte, the target role, the wishes, a text with little evidence,
//! the factor of a permanent role and the cap that held the score down. Codes and params
//! only, read from the evaluation the score came from (it never changes the score). At most
//! [`MAX_FACTORS`] lines: where there are more, the ones that explain the most stay (a cap,
//! the permanent factor, the musts first), in reading order.

use serde_json::{Map, Value, json};

use super::contract::ContractKind;
use super::engine::{EngineProfile, Evaluation};
use super::types::{EvidenceLevel, Factor, FactorCode, MAX_FACTORS, Summary, Verdict};

/// Per-mille of the fit a permanent role keeps (`params::PERMANENT_FACTOR`), in percent.
const PERMANENT_PERCENT: u64 = super::params::PERMANENT_FACTOR / 10;

/// The lines in the order they are read.
const READING: [FactorCode; 8] = [
    FactorCode::Musts,
    FactorCode::Nice,
    FactorCode::Focus,
    FactorCode::TargetRole,
    FactorCode::Wishes,
    FactorCode::Evidence,
    FactorCode::Permanent,
    FactorCode::Cap,
];

/// The lines kept first where there are more than [`MAX_FACTORS`].
const KEPT_FIRST: [FactorCode; 8] = [
    FactorCode::Cap,
    FactorCode::Permanent,
    FactorCode::Musts,
    FactorCode::Focus,
    FactorCode::TargetRole,
    FactorCode::Wishes,
    FactorCode::Evidence,
    FactorCode::Nice,
];

fn factor(code: FactorCode, params: &Value) -> Factor {
    Factor {
        code,
        params: params.as_object().cloned().unwrap_or_else(Map::new),
    }
}

/// Every line that applies, unordered.
fn all(profile: &EngineProfile, evaluation: &Evaluation, summary: &Summary) -> Vec<Factor> {
    let mut out = Vec::new();
    if summary.must_total > 0 {
        out.push(factor(
            FactorCode::Musts,
            &json!({
                "met": summary.must_met,
                "partial": summary.must_partial,
                "total": summary.must_total,
            }),
        ));
    }
    if summary.nice_total > 0 {
        out.push(factor(
            FactorCode::Nice,
            &json!({ "met": summary.nice_met, "total": summary.nice_total }),
        ));
    }
    if !profile.focus.is_empty() {
        let hit = evaluation
            .focus
            .iter()
            .filter(|h| h.title || !h.met.is_empty())
            .count();
        out.push(factor(
            FactorCode::Focus,
            &json!({ "hit": hit, "total": profile.focus.len() }),
        ));
    }
    if !profile.roles.is_empty() {
        let params = match &evaluation.role {
            Some((fit, _, _)) => json!({
                "role": profile.roles[fit.role].text,
                "fit": if fit.full { "full" } else { "half" },
            }),
            None => json!({ "fit": "none" }),
        };
        out.push(factor(FactorCode::TargetRole, &params));
    }
    let wish_points = evaluation
        .wishes
        .iter()
        .map(|w| w.points)
        .sum::<i64>()
        .clamp(-super::params::WISH_MAX, super::params::WISH_MAX);
    if wish_points != 0 {
        // Per-mille of the score: one point is ten.
        let points = (wish_points + wish_points.signum() * 5) / 10;
        out.push(factor(FactorCode::Wishes, &json!({ "points": points })));
    }
    let evidence = match evaluation.evidence {
        EvidenceLevel::Full => None,
        EvidenceLevel::Low => Some("low"),
        EvidenceLevel::Teaser => Some("teaser"),
    };
    if let Some(level) = evidence {
        out.push(factor(FactorCode::Evidence, &json!({ "evidence": level })));
    }
    // A permanent role: its shrunk fit was scaled by `PERMANENT_FACTOR`.
    if evaluation.facts.contract == ContractKind::Permanent {
        out.push(factor(
            FactorCode::Permanent,
            &json!({ "percent": PERMANENT_PERCENT }),
        ));
    }
    if let Some((kind, max)) = evaluation.capped {
        out.push(factor(
            FactorCode::Cap,
            &json!({ "cap": kind.code(), "max": max }),
        ));
    }
    out
}

/// The lines of one evaluated job: none for an unscorable one; at most [`MAX_FACTORS`], the
/// ones that explain the most, in reading order.
pub(crate) fn factors(
    profile: &EngineProfile,
    evaluation: &Evaluation,
    summary: &Summary,
) -> Vec<Factor> {
    if evaluation.verdict == Verdict::Unscorable {
        return Vec::new();
    }
    let lines = all(profile, evaluation, summary);
    let rank = |order: &[FactorCode], code: FactorCode| {
        order.iter().position(|c| *c == code).unwrap_or(order.len())
    };
    let mut kept: Vec<Factor> = KEPT_FIRST
        .iter()
        .filter_map(|code| lines.iter().find(|f| f.code == *code).cloned())
        .take(MAX_FACTORS)
        .collect();
    kept.sort_by_key(|f| rank(&READING, f.code));
    kept
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::matching::{FactorCode, JobInput, TextKind, assess, compile_profile};
    use crate::portal::Portal;

    fn job<'a>(title: &'a str, text: &'a str) -> JobInput<'a> {
        JobInput {
            title,
            company: "",
            location: "Hamburg",
            portal: Portal::Freelancermap,
            text,
            facts: None,
            posted: None,
            kind: TextKind::Full,
        }
    }

    const PROFILE: &str = r#"{
        "kernkompetenzen": [
            {"kompetenz": "Controlling"}, {"kompetenz": "Reporting nach IFRS"},
            {"kompetenz": "Konsolidierung"}, {"kompetenz": "Liquiditätsplanung"},
            {"kompetenz": "Restrukturierung"}, {"kompetenz": "Treasury"}
        ],
        "schwerpunkte": ["Restrukturierung", "Treasury"],
        "wunschrollen": ["Interim CFO"]
    }"#;

    const AD: &str = "Wir suchen einen Interim CFO für ein Familienunternehmen in Hamburg.\n\n\
        Ihr Profil\n\
        • Erfahrung im Controlling\n\
        • Reporting nach IFRS\n\
        • Erfahrung in der Konsolidierung\n\
        • Kenntnisse in Anaplan\n\n\
        Wünschenswert\n\
        • Französisch in Wort und Schrift\n";

    #[test]
    fn the_lines_say_what_moved_the_score_in_reading_order() {
        let profile = compile_profile(&serde_json::from_str(PROFILE).unwrap());
        let a = assess(&profile, &job("Interim CFO (m/w/d)", AD), None).unwrap();
        let codes: Vec<FactorCode> = a.factors.iter().map(|f| f.code).collect();
        assert_eq!(
            codes,
            [
                FactorCode::Musts,
                FactorCode::Nice,
                FactorCode::Focus,
                FactorCode::TargetRole
            ]
        );
        assert_eq!(a.factors[0].params["met"], json!(a.summary.must_met));
        assert_eq!(a.factors[0].params["total"], json!(a.summary.must_total));
        assert_eq!(a.factors[2].params["total"], json!(2));
        assert_eq!(a.factors[3].params["fit"], json!("full"));
        assert_eq!(a.factors[3].params["role"], json!("Interim CFO"));
    }

    #[test]
    fn a_permanent_role_and_a_cap_say_so_and_the_lines_stay_five() {
        // A senior profile (20 years) and a junior role: the junior cap holds the score.
        let mut data: serde_json::Value = serde_json::from_str(PROFILE).unwrap();
        data["berufserfahrung_jahre"] = json!(20);
        let profile = compile_profile(&data);
        let requirements = AD.split_once("\n\n").map_or(AD, |(_, rest)| rest);
        let ad = format!(
            "Wir suchen einen Controller in Festanstellung, Vollzeit und unbefristet.\n\n\
             {requirements}"
        );
        let a = assess(&profile, &job("Junior Controller (m/w/d)", &ad), None).unwrap();
        let codes: Vec<FactorCode> = a.factors.iter().map(|f| f.code).collect();
        assert_eq!(
            codes,
            [
                FactorCode::Musts,
                FactorCode::Focus,
                FactorCode::TargetRole,
                FactorCode::Permanent,
                FactorCode::Cap
            ],
            "the optional requirements give way to the cap"
        );
        let cap = &a.factors[4];
        assert_eq!(cap.params["cap"], json!("junior"));
        assert_eq!(cap.params["max"], json!(a.score));
        assert_eq!(a.factors[3].params["percent"], json!(90));
    }

    #[test]
    fn an_unscorable_job_has_none() {
        let profile = compile_profile(&serde_json::from_str(PROFILE).unwrap());
        let a = assess(&profile, &job("Projekt", "Kurz."), None).unwrap();
        assert!(a.factors.is_empty());
    }
}
