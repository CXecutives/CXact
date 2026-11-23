//! IT projects and PMO: delivery, testing, data and requirements.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "itProject",
    search: &["IT-Projektleiter", "IT-Projektmanager", "PMO"],
    triggers: &[
        "agil",
        "anforderungs",
        "confluence",
        "cutover",
        "datenmigration",
        "devops",
        "go-live",
        "hypercare",
        "it-",
        "jira",
        "pmo",
        "requirements",
        "rollout",
        "schnittstell",
        "scrum",
        "software",
        "testmanagement",
    ],
    generic: &[],
    concepts: &[
        ("head it", "it-leitung"),
        ("leiter it", "it-leitung"),
        ("leitung it", "it-leitung"),
        ("it-leiter", "it-leitung"),
        ("data migration", "datenmigration"),
        ("test management", "testmanagement"),
        ("master data", "stammdat"),
        ("project management office", "pmo"),
        ("roll out", "rollout"),
        ("go live", "go-live"),
        ("produktivsetzung", "go-live"),
        // Scaled agile work (SAFe); the power electronics' safe operating area is none.
        ("scaled agile framework", "safe"),
        ("scaled agile", "safe"),
        ("agile release train", "safe"),
        ("release train", "safe"),
        ("agile skalierung", "safe"),
        ("agile scaling", "safe"),
        ("skalierte agile", "safe"),
        ("skalierten agilen", "safe"),
        ("safe operating area", "safe-operating-area"),
        ("agile methoden", "agile-methoden"),
        ("requirements engineering", "anforderungsmanagement"),
        ("requirements management", "anforderungsmanagement"),
    ],
    // Scrum, Kanban and SAFe are the agile methods.
    covers: &[("agile-methoden", &["kanban", "safe", "scrum"])],
    // Requirements and their management are a competence of project management (IPMA): near.
    near: &[("anforderungsmanagement", &["projektmanagement"])],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{full, vocab};
    use crate::matching::atoms::{Fit, Vocab, atoms};
    use crate::matching::graph::fit;

    fn projects() -> Vocab {
        let v = vocab(&["Scrum", "Jira", "IT-Projektleitung"]);
        assert!(v.packs().contains(&"itProject"), "{:?}", v.packs());
        v
    }

    /// Agile methods asked for are met by Scrum or scaled agile work, Scrum asked for not by
    /// the umbrella; a classic method is no agile one.
    #[test]
    fn agile_methods_are_met_by_scrum() {
        let v = projects();
        for profile in ["Scrum", "Agile Skalierung", "Kanban"] {
            assert!(
                full(&v, "Erfahrung mit agilen Methoden", profile),
                "{profile}"
            );
        }
        assert!(!full(&v, "Scrum", "agile Methoden"));
        assert!(!full(&v, "Erfahrung mit agilen Methoden", "PRINCE2"));
        assert!(!full(&v, "Erfahrung mit statistischen Methoden", "Scrum"));
    }

    /// Requirements engineering is requirements management, near project management and no
    /// proof of it; software engineering is not.
    #[test]
    fn requirements_are_near_project_management() {
        let v = projects();
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        let asked = one("Mehr als 7 Jahre Erfahrung in Requirements Engineering");
        assert_eq!(asked, one("Kenntnisse im Anforderungsmanagement"));
        assert_eq!(fit(&asked, &one("Projektmanagement")), Fit::General);
        assert_eq!(
            fit(&one("Software Engineering"), &one("Projektmanagement")),
            Fit::None
        );
    }
}
