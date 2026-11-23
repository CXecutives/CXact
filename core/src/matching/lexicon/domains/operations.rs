//! Operations and engineering: production and plant management, lean, Six Sigma and
//! operational excellence, maintenance, production planning, quality management
//! (ISO 9001, IATF 16949), automotive, R&D and occupational safety.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "operations",
    search: &[
        "Werksleiter",
        "Produktionsleiter",
        "Head of Operations",
        "Operations Manager",
        "Supply Chain Management",
    ],
    triggers: &[
        "apqp",
        "betriebsleit",
        "excellence",
        "fertigungsleit",
        "fertigungsplan",
        "fertigungssteuer",
        "iatf",
        "instandhalt",
        "instandsetz",
        "kaizen",
        "kvp",
        "lean",
        "oee",
        "ppap",
        "produktionsleit",
        "produktionsplan",
        "produktionssteuer",
        "shop-floor",
        "shopfloor",
        "sigma",
        "smed",
        "tpm",
        "vda",
        "werksleit",
        "wertstrom",
    ],
    generic: &["operation", "technik"],
    concepts: &[
        // Production and plant leadership.
        ("production", "produktion"),
        ("manufacturing", "produktion"),
        ("fertigung", "produktion"),
        ("herstellung", "produktion"),
        ("produktionsleiter", "produktionsleitung"),
        ("produktionsleiterin", "produktionsleitung"),
        ("leiter produktion", "produktionsleitung"),
        ("leiterin produktion", "produktionsleitung"),
        ("leitung produktion", "produktionsleitung"),
        ("head production", "produktionsleitung"),
        ("head manufacturing", "produktionsleitung"),
        ("production manager", "produktionsleitung"),
        ("manufacturing manager", "produktionsleitung"),
        ("fertigungsleiter", "produktionsleitung"),
        ("fertigungsleiterin", "produktionsleitung"),
        ("fertigungsleitung", "produktionsleitung"),
        ("werksleiter", "werksleitung"),
        ("werksleiterin", "werksleitung"),
        ("plant manager", "werksleitung"),
        ("plant director", "werksleitung"),
        ("head plant", "werksleitung"),
        ("standortleiter", "werksleitung"),
        ("standortleiterin", "werksleitung"),
        ("standortleitung", "werksleitung"),
        ("betriebsleiter", "werksleitung"),
        ("betriebsleiterin", "werksleitung"),
        ("betriebsleitung", "werksleitung"),
        ("technischer leiter", "technischeleitung"),
        ("technische leiterin", "technischeleitung"),
        ("technische leitung", "technischeleitung"),
        ("leiter technik", "technischeleitung"),
        ("leiterin technik", "technischeleitung"),
        ("leitung technik", "technischeleitung"),
        ("chief operating officer", "coo"),
        ("head operations", "operationsleitung"),
        ("director operations", "operationsleitung"),
        ("operations director", "operationsleitung"),
        ("operations manager", "operationsleitung"),
        ("leiter operations", "operationsleitung"),
        ("leiterin operations", "operationsleitung"),
        ("leitung operations", "operationsleitung"),
        // Lean, Six Sigma and operational excellence (`Lean Six Sigma` gives both).
        ("lean", "lean-management"),
        ("lean management", "lean-management"),
        ("lean production", "lean-management"),
        ("lean manufacturing", "lean-management"),
        ("lean methoden", "lean-management"),
        ("lean methodik", "lean-management"),
        ("lean prinzipien", "lean-management"),
        ("lean principles", "lean-management"),
        ("six sigma", "six-sigma"),
        ("sigma", "six-sigma"),
        ("operational excellence", "operationalexcellence"),
        ("operative exzellenz", "operationalexcellence"),
        ("kontinuierlicher verbesserungsprozess", "kvp"),
        ("continuous improvement", "kvp"),
        ("continuous improvement process", "kvp"),
        ("kaizen", "kvp"),
        ("shopfloor management", "shopfloor-management"),
        ("shop floor management", "shopfloor-management"),
        ("total productive maintenance", "tpm"),
        ("overall equipment effectiveness", "oee"),
        ("gesamtanlageneffektivitat", "oee"),
        ("single minute exchange", "smed"),
        ("rustzeitoptimierung", "smed"),
        ("rustzeitreduzierung", "smed"),
        ("value stream mapping", "wertstromanalyse"),
        ("value stream design", "wertstromanalyse"),
        ("wertstromdesign", "wertstromanalyse"),
        ("wertstrommethode", "wertstromanalyse"),
        ("process optimisation", "prozessoptimierung"),
        ("process optimization", "prozessoptimierung"),
        // Maintenance.
        ("maintenance", "instandhaltung"),
        ("maintenance management", "instandhaltung"),
        ("instandhaltungsmanagement", "instandhaltung"),
        ("instandsetzung", "instandhaltung"),
        ("wartung", "instandhaltung"),
        ("predictive maintenance", "predictive-maintenance"),
        ("vorausschauende instandhaltung", "predictive-maintenance"),
        ("instandhaltungsleiter", "instandhaltungsleitung"),
        ("instandhaltungsleiterin", "instandhaltungsleitung"),
        ("leiter instandhaltung", "instandhaltungsleitung"),
        ("leiterin instandhaltung", "instandhaltungsleitung"),
        ("leitung instandhaltung", "instandhaltungsleitung"),
        ("maintenance manager", "instandhaltungsleitung"),
        ("head maintenance", "instandhaltungsleitung"),
        // Production planning.
        ("production planning", "produktionsplanung"),
        ("fertigungsplanung", "produktionsplanung"),
        ("produktionsplanung produktionssteuerung", "pps"),
        ("production planning control", "pps"),
        ("fertigungssteuerung", "produktionssteuerung"),
        ("production control", "produktionssteuerung"),
        // Quality management (the same keys and concepts as in `pharma`).
        ("quality assurance", "qualitatssicherung"),
        ("qa", "qualitatssicherung"),
        ("quality control", "qualitatskontrolle"),
        ("quality management", "qualitatsmanagement"),
        ("qm", "qualitatsmanagement"),
        ("quality manager", "qualitatsmanagement"),
        ("qualitatsmanager", "qualitatsmanagement"),
        ("qualitatsmanagerin", "qualitatsmanagement"),
        ("quality management system", "qualitatsmanagementsystem"),
        ("qms", "qualitatsmanagementsystem"),
        ("qm system", "qualitatsmanagementsystem"),
        ("qm systeme", "qualitatsmanagementsystem"),
        ("quality management systems", "qualitatsmanagementsystem"),
        ("qualitatsmanagementsysteme", "qualitatsmanagementsystem"),
        ("auditvorbereitung", "audit"),
        ("audit preparation", "audit"),
        ("zertifizierung", "zertifizierung"),
        ("certification", "zertifizierung"),
        ("zertifizierungsaudit", "zertifizierung"),
        ("zertifizierungen", "zertifizierung"),
        ("head quality", "qualitatsleitung"),
        ("quality director", "qualitatsleitung"),
        ("director quality", "qualitatsleitung"),
        ("qualitatsleiter", "qualitatsleitung"),
        ("qualitatsleiterin", "qualitatsleitung"),
        ("leiter qualitatssicherung", "qualitatsleitung"),
        ("leiterin qualitatssicherung", "qualitatsleitung"),
        ("leitung qualitatssicherung", "qualitatsleitung"),
        ("failure mode effects analysis", "fmea"),
        ("statistical process control", "spc"),
        ("statistische prozesslenkung", "spc"),
        ("complaint management", "reklamationsmanagement"),
        ("reklamationsbearbeitung", "reklamationsmanagement"),
        // Automotive.
        ("automotive industry", "automotive"),
        ("automobilindustrie", "automotive"),
        ("automobilbranche", "automotive"),
        ("automotive branche", "automotive"),
        ("fahrzeugbau", "automotive"),
        ("automobil", "automotive"),
        ("automotive supplier", "automotive-zulieferer"),
        ("automobilzulieferer", "automotive-zulieferer"),
        ("automobilzulieferindustrie", "automotive-zulieferer"),
        // Engineering, R&D and safety.
        ("industrial engineering", "industrial-engineering"),
        ("research development", "forschung-entwicklung"),
        ("forschung entwicklung", "forschung-entwicklung"),
        ("f&e", "forschung-entwicklung"),
        ("r&d", "forschung-entwicklung"),
        ("design engineering", "konstruktion"),
        ("occupational safety", "arbeitssicherheit"),
        ("occupational health safety", "arbeitssicherheit"),
        ("health safety environment", "arbeitssicherheit"),
        ("hse", "arbeitssicherheit"),
        ("ehs", "arbeitssicherheit"),
        ("arbeitsschutz", "arbeitssicherheit"),
    ],
    // A management system is the narrower work of quality management; audits and
    // certifications are close to the system and to a process audit.
    // IATF 16949 holds all of ISO 9001, the standard of quality management.
    covers: &[
        ("iso-9001", &["iatf"]),
        (
            "qualitatsmanagement",
            &["iso-9001", "qualitatsmanagementsystem"],
        ),
    ],
    near: &[
        ("prozessaudit", &["audit", "zertifizierung"]),
        ("qualitatsmanagementsystem", &["audit", "zertifizierung"]),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, assert_same, vocab};
    use crate::matching::atoms::{Fit, Vocab, atoms};
    use crate::matching::graph::fit;

    fn operations() -> Vocab {
        let v = vocab(&["Lean Management", "Werksleitung", "Instandhaltung"]);
        assert_eq!(v.packs(), ["operations"]);
        v
    }

    /// IATF 16949 holds all of ISO 9001, quality management names it in part; another ISO
    /// standard is none of the two.
    #[test]
    fn iso_9001_is_held_by_iatf_and_quality_management() {
        let v = operations();
        let one = |text: &str| atoms(text, &v).last().cloned().expect("one atom");
        let iso = one("Tiefgehende Kenntnisse der ISO 9001");
        assert_eq!(fit(&iso, &one("IATF 16949")), Fit::Covered);
        assert_eq!(fit(&iso, &one("Qualitätsmanagement")), Fit::General);
        assert_eq!(fit(&one("IATF 16949"), &iso), Fit::General);
        assert_eq!(
            fit(&one("Qualitätsmanagement"), &one("IATF 16949")),
            Fit::Covered
        );
        assert_eq!(fit(&one("ISO 27001"), &one("IATF 16949")), Fit::None);
        assert_eq!(
            fit(&one("ISO 14001"), &one("Qualitätsmanagement")),
            Fit::None
        );
    }

    #[test]
    fn paraphrases() {
        assert_same(
            &operations(),
            &[
                ("Production", "Produktion"),
                ("Manufacturing", "Fertigung"),
                ("Produktionsleiterin", "Head of Production"),
                ("Plant Manager", "Werksleiter"),
                ("Standortleiterin", "Werksleitung"),
                ("Technischer Leiter", "Leitung Technik"),
                ("Lean", "Lean Management"),
                ("Lean Production", "Lean-Methoden"),
                ("Six Sigma", "Six-Sigma"),
                ("Operational Excellence", "Operative Exzellenz"),
                ("KVP", "Kontinuierlicher Verbesserungsprozess"),
                ("Kaizen", "Continuous Improvement"),
                ("Shop Floor Management", "Shopfloor-Management"),
                ("Total Productive Maintenance", "TPM"),
                ("Value Stream Mapping", "Wertstromanalyse"),
                ("Maintenance", "Instandhaltung"),
                ("Wartung und Instandsetzung", "Instandhaltung"),
                ("Production planning", "Produktionsplanung"),
                ("Produktionsplanung und -steuerung", "PPS"),
                ("Quality Management", "Qualitätsmanagement"),
                ("QM", "Quality Management"),
                ("FMEA", "Failure Mode and Effects Analysis"),
                ("Automobilindustrie", "Automotive"),
                ("Automotive supplier", "Automobilzulieferer"),
                ("F&E", "Research & Development"),
                ("Arbeitsschutz", "HSE"),
            ],
        );
        let lss = atoms("Lean Six Sigma", &operations());
        assert_eq!(*lss, ["lean-management", "six-sigma"]);
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &operations(),
            &[
                ("LeanIX", "Lean"),
                ("Lean", "LeanIX"),
                ("Operational Excellence", "Excel"),
                ("Produktionscontrolling", "Produktion"),
                ("Unternehmensplanung", "Produktionsplanung"),
                ("technisches Verständnis", "Technischer Leiter"),
                ("OEM", "OEE"),
            ],
        );
    }
}
