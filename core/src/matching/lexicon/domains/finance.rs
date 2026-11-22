//! Finance, controlling, accounting, treasury, restructuring and M&A.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "finance",
    search: &[
        "Leiter Finanzen",
        "Head of Finance",
        "Leiter Controlling",
        "Leiter Rechnungswesen",
        "Finanzbuchhaltung",
        "Konzernrechnungswesen",
    ],
    triggers: &[
        "accounting",
        "bilanz",
        "buchhalt",
        "budget",
        "carve-out",
        "cfo",
        "controll",
        "finanztransformation",
        "fp&a",
        "hauptbuch",
        "hgb",
        "ifrs",
        "jahresabschl",
        "konsolidier",
        "konzernabschluss",
        "konzernrechnungs",
        "kostenrechnung",
        "kostenstellen",
        "liquidit",
        "m&a",
        "monatsabschl",
        "rechnungslegung",
        "rechnungswesen",
        "restrukturier",
        "sanierung",
        "treasury",
    ],
    generic: &[],
    concepts: &[
        // Closings and statements.
        ("annual financial statement", "jahresabschluss"),
        ("annual accounts", "jahresabschluss"),
        ("year-end closing", "jahresabschluss"),
        ("year end closing", "jahresabschluss"),
        ("year-end close", "jahresabschluss"),
        ("month-end closing", "monatsabschluss"),
        ("month end closing", "monatsabschluss"),
        ("month-end close", "monatsabschluss"),
        ("monthly closing", "monatsabschluss"),
        ("monthly close", "monatsabschluss"),
        ("consolidated financial statement", "konzernabschluss"),
        ("group financial statement", "konzernabschluss"),
        // Group accounting and reporting.
        ("group accounting", "konzernrechnungslegung"),
        ("konzernrechnungswesen", "konzernrechnungslegung"),
        ("konzernrechnung", "konzernrechnungslegung"),
        ("group reporting", "konzernreporting"),
        ("group controlling", "konzerncontrolling"),
        ("group consolidation", "konzernkonsolidierung"),
        ("group treasury", "konzerntreasury"),
        ("consolidation", "konsolidierung"),
        // The steps of a consolidation: each one is part of it.
        ("intercompany elimination", "ic-eliminierung"),
        ("intercompany eliminierung", "ic-eliminierung"),
        ("ic-eliminierung", "ic-eliminierung"),
        ("schuldenkonsolidierung", "ic-eliminierung"),
        ("currency translation", "wahrungsumrechnung"),
        ("foreign currency translation", "wahrungsumrechnung"),
        ("wahrungsumrechnung", "wahrungsumrechnung"),
        ("berichtswesen", "reporting"),
        // Finance leadership roles and paraphrases (held-out sets).
        ("finance director", "cfo"),
        ("director finance", "cfo"),
        ("chief financial officer", "cfo"),
        ("kaufmannischer leiter", "cfo"),
        ("kaufmannische leiterin", "cfo"),
        ("kaufmannische leitung", "cfo"),
        ("finanzleiter", "cfo"),
        ("finanzleiterin", "cfo"),
        ("leiter finanzen", "cfo"),
        ("head finance", "cfo"),
        ("finanzleitung", "cfo"),
        ("leitung finanzen", "cfo"),
        ("vp finance", "cfo"),
        ("leiterin finanzen", "cfo"),
        ("budget planning", "budgetierung"),
        ("turnaround", "restrukturierung"),
        ("sanierung", "restrukturierung"),
        ("krisensituation", "restrukturierung"),
        ("german gaap", "hgb"),
        ("us gaap", "us-gaap"),
        // Controlling and planning.
        ("financial planning analysis", "fp&a"),
        ("financial controlling", "controlling"),
        ("controller", "controlling"),
        ("finance business partner", "finance-bp"),
        ("finance business partnering", "finance-bp"),
        ("budgeting", "budgetierung"),
        ("budgetplanung", "budgetierung"),
        ("forecasting", "forecast"),
        ("financial forecasting", "forecast"),
        ("financial planning", "finanzplanung"),
        ("finanzplanung", "finanzplanung"),
        ("financial analysis", "finanzanalyse"),
        ("finanzanalyse", "finanzanalyse"),
        ("p&l", "guv"),
        ("profit loss", "guv"),
        ("profit loss statement", "guv"),
        ("income statement", "guv"),
        ("gewinn verlustrechnung", "guv"),
        ("guv", "guv"),
        ("commercial finance", "finance-bp"),
        ("hochrechnung", "forecast"),
        ("variance analysis", "abweichungsanalyse"),
        ("accruals", "abgrenzung"),
        ("soll-ist-vergleich", "abweichungsanalyse"),
        ("cost accounting", "kostenrechnung"),
        ("cost center accounting", "kostenstellenrechnung"),
        ("cost centre accounting", "kostenstellenrechnung"),
        ("cost center", "kostenstellenrechnung"),
        ("cost centre", "kostenstellenrechnung"),
        ("kostenstellen", "kostenstellenrechnung"),
        ("product costing", "produktkostenrechnung"),
        ("profitability analysis", "ergebnisrechnung"),
        // Bookkeeping.
        ("financial accounting", "finanzbuchhaltung"),
        ("accounting", "rechnungswesen"),
        ("ledger", "hauptbuchhaltung"),
        ("general ledger", "hauptbuchhaltung"),
        ("hauptbuch", "hauptbuchhaltung"),
        ("accounts payable", "kreditorenbuchhaltung"),
        ("accounts receivable", "debitorenbuchhaltung"),
        ("fixed asset accounting", "anlagenbuchhaltung"),
        ("asset accounting", "anlagenbuchhaltung"),
        ("subledger", "nebenbuchhaltung"),
        ("tax audit", "betriebsprufung"),
        // Treasury and liquidity.
        ("liquidity planning", "liquiditatsplanung"),
        ("cash flow planning", "liquiditatsplanung"),
        ("cash forecast", "liquiditatsplanung"),
        ("cash management", "cash-management"),
        ("liquidity management", "cash-management"),
        ("liquiditatsmanagement", "cash-management"),
        ("liquiditatssteuerung", "cash-management"),
        ("working capital management", "working-capital-management"),
        ("working capital", "working-capital-management"),
        ("fx hedging", "devisensicherung"),
        ("currency hedging", "devisensicherung"),
        ("foreign exchange hedging", "devisensicherung"),
        ("refinancing", "refinanzierung"),
        ("payment transactions", "zahlungsverkehr"),
        // Transactions and restructuring.
        ("post merger integration", "post-merger-integration"),
        ("pmi", "post-merger-integration"),
        ("mergers acquisitions", "m&a"),
        ("mergers acquisition", "m&a"),
        ("carve out", "carve-out"),
        ("restructuring", "restrukturierung"),
        ("shared service centre", "shared-service-cent"),
        ("shared service center", "shared-service-cent"),
    ],
    // Planning, analysis and the P&L are the work of controlling, cash management is part of
    // treasury and liquidity planning, accounting part of the statements.
    half: &[
        (
            "controlling",
            &["finanzanalyse", "finanzplanung", "forecast", "fp&a", "guv"],
        ),
        (
            "finance-bp",
            &["finanzanalyse", "finanzplanung", "fp&a", "guv"],
        ),
        ("jahresabschluss", &["rechnungswesen"]),
        ("konzernrechnungslegung", &["rechnungswesen"]),
        ("konsolidierung", &["ic-eliminierung", "wahrungsumrechnung"]),
        ("liquiditatsplanung", &["cash-management"]),
        ("treasury", &["cash-management"]),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_same, vocab};
    use crate::matching::atoms::{Fit, Vocab, atoms, fit};

    fn finance() -> Vocab {
        let v = vocab(&[
            "Konzernrechnungslegung nach IFRS",
            "Konsolidierung",
            "Controlling",
        ]);
        assert!(v.packs().contains(&"finance"), "{:?}", v.packs());
        v
    }

    /// English group accounting reads as the German; the steps of a consolidation are met
    /// in half by it, never the other way.
    #[test]
    fn group_accounting_and_the_steps_of_a_consolidation() {
        let v = finance();
        assert_same(
            &v,
            &[
                (
                    "several years in group accounting",
                    "Konzernrechnungslegung",
                ),
                ("intercompany eliminations", "Schuldenkonsolidierung"),
                ("currency translation", "Währungsumrechnung"),
            ],
        );
        let one = |text: &str| atoms(text, &v).pop().expect("one atom");
        let consolidation = one("Konsolidierung");
        for step in ["intercompany eliminations", "currency translation"] {
            assert_eq!(fit(&one(step), &consolidation), Fit::General, "{step}");
            assert_eq!(fit(&consolidation, &one(step)), Fit::None, "{step}");
        }
    }
}
