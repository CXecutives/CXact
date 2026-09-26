//! Restructuring: restructuring roles (CRO, restructuring managing director), restructuring
//! opinions (IDW S6), bank negotiations, insolvency and restructuring law, liquidity in the
//! crisis. Interim wording stays a contract word of the core (it never matches a profile).
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "restructuring",
    triggers: &[
        "eigenverwaltung",
        "insolvenz",
        "krisen",
        "restructuring",
        "restrukturier",
        "sanierung",
        "starug",
        "turnaround",
    ],
    generic: &[],
    concepts: &[
        // Restructuring roles and practice.
        ("chief restructuring officer", "restrukturierung"),
        ("sanierungsgeschaftsfuhrer", "restrukturierung"),
        ("sanierungsgeschaftsfuhrung", "restrukturierung"),
        ("sanierungsexperte", "restrukturierung"),
        ("sanierungspraxis", "restrukturierung"),
        ("sanierungserfahrung", "restrukturierung"),
        ("restrukturierungsmanager", "restrukturierung"),
        ("restrukturierungserfahrung", "restrukturierung"),
        ("turnaround manager", "restrukturierung"),
        ("turnaround management", "restrukturierung"),
        ("generalbevollmachtigter", "restrukturierung"),
        ("sanierungskonzept", "restrukturierung"),
        ("sanierungsgutachten", "restrukturierung"),
        ("restrukturierungskonzept", "restrukturierung"),
        ("idw s6", "restrukturierung"),
        ("idw-s6", "restrukturierung"),
        ("restructuring plan", "restrukturierung"),
        ("turnaround plan", "restrukturierung"),
        // Banks and financing in the crisis.
        ("bankenverhandlung", "bankenkommunikation"),
        ("verhandlungen mit banken", "bankenkommunikation"),
        ("bankengesprache", "bankenkommunikation"),
        ("gesprache mit banken", "bankenkommunikation"),
        ("finanzierungsgesprache", "bankenkommunikation"),
        ("kommunikation mit banken", "bankenkommunikation"),
        ("bank negotiations", "bankenkommunikation"),
        ("lender negotiations", "bankenkommunikation"),
        ("negotiations with banks", "bankenkommunikation"),
        ("bank relations", "bankenkommunikation"),
        ("bankbeziehungen", "bankenkommunikation"),
        // Insolvency and restructuring law.
        ("starug", "insolvenzrecht"),
        ("eigenverwaltung", "insolvenzrecht"),
        ("schutzschirmverfahren", "insolvenzrecht"),
        ("insolvenzplanverfahren", "insolvenzrecht"),
        ("insolvenzrecht", "insolvenzrecht"),
        ("insolvenzordnung", "insolvenzrecht"),
        ("inso", "insolvenzrecht"),
        ("restrukturierungsrahmen", "insolvenzrecht"),
        ("insolvency law", "insolvenzrecht"),
        ("restructuring law", "insolvenzrecht"),
        // Liquidity in the crisis.
        ("13-wochen-liquiditatsplanung", "liquiditatsplanung"),
        ("13-week cash flow", "liquiditatsplanung"),
        ("liquiditatsvorschau", "liquiditatsplanung"),
        ("liquiditatsstatus", "liquiditatsplanung"),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, full, vocab};
    use crate::matching::atoms::Vocab;

    fn restructuring() -> Vocab {
        let v = vocab(&[
            "Restrukturierung",
            "Sanierung",
            "Bankenkommunikation",
            "Liquiditätsplanung",
        ]);
        assert!(v.packs().contains(&"restructuring"), "{:?}", v.packs());
        v
    }

    #[test]
    fn interim_and_restructuring_wording_meets_the_profile() {
        let v = restructuring();
        for (job, profile) in [
            (
                "Erfahrung mit Sanierungskonzepten nach IDW S6",
                "Restrukturierung",
            ),
            (
                "Mandate als Chief Restructuring Officer",
                "Restrukturierung",
            ),
            ("Erfahrung mit Bankenverhandlungen", "Bankenkommunikation"),
            ("negotiations with banks", "Bankenkommunikation"),
            ("13-Wochen-Liquiditätsplanung", "Liquiditätsplanung"),
        ] {
            assert!(full(&v, job, profile), "{job} / {profile}");
        }
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &restructuring(),
            &[
                ("Kenntnisse im StaRUG", "Restrukturierung"),
                ("Bankenreporting", "Bankenkommunikation"),
                ("Datenbanken", "Bankenkommunikation"),
            ],
        );
    }
}
