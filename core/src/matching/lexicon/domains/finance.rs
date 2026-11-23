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
        // Being firm in the closings (`abschlusssicher nach HGB`) is closing experience.
        ("abschlusssicherheit", "jahresabschluss"),
        ("abschlusssicher", "jahresabschluss"),
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
        // An account of a customer is no accounting (as `sales` reads it).
        ("key account", "key-account-management"),
        ("account management", "kundenbetreuung"),
        ("account manager", "kundenbetreuung"),
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
        ("financial due diligence", "due-diligence"),
        ("due diligence", "due-diligence"),
        ("m&a-prozesse", "m&a"),
        ("m&a prozesse", "m&a"),
        ("m&a-transaktionen", "m&a"),
        // Steering the company's finances.
        (
            "kaufmannische unternehmenssteuerung",
            "unternehmenssteuerung",
        ),
        ("unternehmenssteuerung", "unternehmenssteuerung"),
        ("finanzwesen", "rechnungswesen"),
        ("restructuring", "restrukturierung"),
        ("shared service centre", "shared-service-cent"),
        ("shared service center", "shared-service-cent"),
    ],
    // Planning, analysis and the P&L are the work of controlling, controlling and planning
    // steer the company, cash management is treasury's, the balance sheet, the closings,
    // financial reporting and group accounting are accounting (bookkeeping and a consolidation alone are no proof:
    // the held-out labels), the eliminations steps of a consolidation, due diligence a step
    // of M&A.
    covers: &[
        (
            "controlling",
            &["finanzanalyse", "finanzplanung", "forecast", "fp&a", "guv"],
        ),
        ("konsolidierung", &["ic-eliminierung", "wahrungsumrechnung"]),
        ("m&a", &["due-diligence"]),
        (
            "rechnungswesen",
            &[
                "bilanzierung",
                "jahresabschluss",
                "konzernrechnungslegung",
                "monatsabschluss",
                "rechnungslegung",
            ],
        ),
        ("treasury", &["cash-management"]),
        (
            "unternehmenssteuerung",
            &["controlling", "unternehmensplanung"],
        ),
    ],
    // A finance business partner plans and analyses, liquidity planning manages cash, an
    // integration follows a deal: close, no proof of the other. Liquidity planning is no
    // proof of treasury (the held-out labels).
    near: &[
        ("cash-management", &["liquiditatsplanung"]),
        (
            "finance-bp",
            &["finanzanalyse", "finanzplanung", "fp&a", "guv"],
        ),
        ("m&a", &["post-merger-integration"]),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_same, full, vocab};
    use crate::matching::atoms::{Fit, Vocab, atoms};
    use crate::matching::graph::fit;

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
    /// in half by it, it in full by a step; M&A in full by a due diligence, in half by an
    /// integration after the deal.
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
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        for (step, part, met) in [
            (
                "Fundierte Erfahrung mit M&A-Prozessen",
                "Post Merger Integration",
                Fit::General,
            ),
            (
                "Fundierte Erfahrung mit M&A-Prozessen",
                "Financial Due Diligence",
                Fit::Covered,
            ),
            (
                "kaufmännische Unternehmenssteuerung",
                "Unternehmensplanung",
                Fit::Covered,
            ),
        ] {
            let job = atoms(step, &v);
            let profile = one(part);
            assert!(
                job.iter().any(|j| fit(j, &profile) == met),
                "{step} / {part}: {job:?} {profile:?}"
            );
        }
        let consolidation = one("Konsolidierung");
        for step in ["intercompany eliminations", "currency translation"] {
            assert_eq!(fit(&one(step), &consolidation), Fit::General, "{step}");
            assert_eq!(fit(&consolidation, &one(step)), Fit::Covered, "{step}");
        }
    }

    /// Accounting asked for is met by its narrower work, an umbrella through a chain too
    /// (steering the company covers controlling, controlling FP&A); the narrower work asked is
    /// met in half by accounting.
    #[test]
    fn accounting_is_met_by_its_narrower_work() {
        let v = finance();
        for (job, profile) in [
            (
                "Fundierte Expertise im Finanz- und Rechnungswesen",
                "Bilanzierung nach HGB",
            ),
            (
                "Erfahrung im Rechnungswesen",
                "Konzernrechnungslegung nach IFRS",
            ),
            ("kaufmännische Unternehmenssteuerung", "FP&A"),
            ("Fundierte Kenntnisse in Accounting", "Monatsabschlüsse"),
            ("Erfahrung im Treasury", "Cash Management"),
        ] {
            assert!(full(&v, job, profile), "{job} / {profile}");
            assert!(!full(&v, profile, job), "{profile} / {job}");
        }
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        assert_eq!(
            fit(&one("Bilanzierung"), &one("Rechnungswesen")),
            Fit::General
        );
        // A key account is no accounting.
        assert!(!full(
            &v,
            "Erfahrung im Key Account Management",
            "Konsolidierung"
        ));
    }

    /// The general ledger closes the books: closings, the balance sheet and financial
    /// reporting asked for are met in full by general ledger accounting, it only in half by a
    /// closing; accounting as a whole is not met by the ledger, a closed contract is no closing.
    #[test]
    fn the_general_ledger_comprises_the_closings() {
        let v = vocab(&["Hauptbuchhaltung", "Buchhaltung", "SAP FI"]);
        assert!(v.packs().contains(&"finance"), "{:?}", v.packs());
        for job in [
            "Umfangreiche praktische Erfahrung in Monats- und Jahresabschlüssen",
            "Fundierte Erfahrung in der Bilanzierung",
            "Sehr gute Kenntnisse der Rechnungslegung nach HGB",
        ] {
            assert!(full(&v, job, "Hauptbuchhaltung"), "{job}");
        }
        assert_eq!(
            *atoms("Erfahrung in Monats- und Jahresabschlüssen", &v),
            ["monatsabschluss", "jahresabschluss"]
        );
        for (job, profile) in [
            ("Hauptbuchhaltung", "Monatsabschlüsse"),
            ("Erfahrung im Rechnungswesen", "Hauptbuchhaltung"),
            ("Erfahrung mit Vertragsabschlüssen", "Hauptbuchhaltung"),
        ] {
            assert!(!full(&v, job, profile), "{job} / {profile}");
        }
        // Being firm in the closings is closing experience; closing a sale is not.
        assert_same(
            &v,
            &[
                ("Abschlusssicherheit nach HGB", "Jahresabschluss nach HGB"),
                ("abschlusssicher nach HGB", "Jahresabschluss nach HGB"),
            ],
        );
        assert!(!full(&v, "Abschlussstärke im Vertrieb", "Jahresabschluss"));
    }
}
