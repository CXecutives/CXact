//! Management consulting for performance and profit: profit improvement, cost reduction,
//! pricing, strategy, KPI systems and business cases.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "consulting",
    triggers: &[
        "ebit",
        "ergebnisverbesser",
        "kostenoptimier",
        "kostensenk",
        "managementberat",
        "performance",
        "preismanagement",
        "pricing",
        "profit",
        "strategieberat",
        "unternehmensberat",
        "unternehmensstrateg",
    ],
    generic: &[],
    concepts: &[
        // Profit and performance improvement.
        ("performance improvement", "ergebnisverbesserung"),
        ("profit improvement", "ergebnisverbesserung"),
        ("ergebnissteigerung", "ergebnisverbesserung"),
        ("ergebnisprogramm", "ergebnisverbesserung"),
        ("ebit-verbesserung", "ergebnisverbesserung"),
        ("ebit improvement", "ergebnisverbesserung"),
        ("margin improvement", "ergebnisverbesserung"),
        ("margenverbesserung", "ergebnisverbesserung"),
        ("ertragssteigerung", "ergebnisverbesserung"),
        ("profitabilitatssteigerung", "ergebnisverbesserung"),
        ("profitability improvement", "ergebnisverbesserung"),
        // Cost reduction (the same concept as in procurement).
        ("cost reduction", "kostensenkung"),
        ("kostenreduktion", "kostensenkung"),
        ("kostenreduzierung", "kostensenkung"),
        ("kostenoptimierung", "kostensenkung"),
        ("cost optimisation", "kostensenkung"),
        ("cost optimization", "kostensenkung"),
        ("cost cutting", "kostensenkung"),
        ("sachkostensenkung", "kostensenkung"),
        // Pricing (the same concept as in sales).
        ("pricing", "preismanagement"),
        ("transfer pricing", "verrechnungspreis"),
        ("preisstrategie", "preismanagement"),
        ("preisgestaltung", "preismanagement"),
        ("preisfindung", "preismanagement"),
        ("preispolitik", "preismanagement"),
        ("pricing strategy", "preismanagement"),
        ("price management", "preismanagement"),
        ("value based pricing", "preismanagement"),
        // Consulting and strategy.
        ("management consulting", "managementberatung"),
        ("unternehmensberatung", "managementberatung"),
        ("strategieberatung", "managementberatung"),
        ("strategy consulting", "managementberatung"),
        ("management consultant", "managementberatung"),
        ("unternehmensberater", "managementberatung"),
        ("corporate strategy", "unternehmensstrategie"),
        ("strategieentwicklung", "unternehmensstrategie"),
        ("strategy development", "unternehmensstrategie"),
        ("business case", "business-case"),
        ("wirtschaftlichkeitsrechnung", "business-case"),
        ("wirtschaftlichkeitsbetrachtung", "business-case"),
        ("zero-based budgeting", "zero-based-budgeting"),
        ("zero based budgeting", "zero-based-budgeting"),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, full, vocab};
    use crate::matching::atoms::Vocab;

    fn consulting() -> Vocab {
        let v = vocab(&[
            "Ergebnisverbesserung",
            "Kostensenkung",
            "Pricing",
            "Managementberatung",
            "Unternehmensstrategie",
        ]);
        assert!(v.packs().contains(&"consulting"), "{:?}", v.packs());
        v
    }

    #[test]
    fn performance_wording_meets_the_profile() {
        let v = consulting();
        for (job, profile) in [
            (
                "Performance Improvement im Mittelstand",
                "Ergebnisverbesserung",
            ),
            ("Profit improvement programmes", "Ergebnisverbesserung"),
            (
                "Nachweisbare Erfolge in der Kostenoptimierung",
                "Kostensenkung",
            ),
            ("Preisstrategie und Preisfindung", "Pricing"),
            (
                "Erfahrung in der Unternehmensberatung",
                "Managementberatung",
            ),
            ("Corporate Strategy", "Unternehmensstrategie"),
        ] {
            assert!(full(&v, job, profile), "{job} / {profile}");
        }
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &consulting(),
            &[
                ("Transfer Pricing", "Pricing"),
                ("Performance Marketing", "Ergebnisverbesserung"),
                ("Kostenrechnung", "Kostensenkung"),
            ],
        );
    }
}
