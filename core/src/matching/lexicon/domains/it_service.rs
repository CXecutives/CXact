//! IT service management: ITIL and ITSM, service desk and IT support, incident, problem,
//! release and service level management, configuration and assets, IT operations and the
//! ITSM tools.
//!
//! As in `customer_service`, an English term that German ads use as it is (`Incident
//! Management`, `Service Desk`) is no key; its other forms map to a value whose parts are
//! its words.
//!
//! external contract - do not translate.

use super::Domain;

pub(crate) const DOMAIN: Domain = Domain {
    name: "itService",
    search: &[
        "IT Service Manager",
        "Service Delivery Manager",
        "IT Service Management",
        "Service Desk",
        "IT-Betrieb",
    ],
    // `Incident` alone is no trigger: security profiles handle incidents too.
    triggers: &[
        "cmdb",
        "help-desk",
        "helpdesk",
        "it-servic",
        "itil",
        "itsm",
        "otrs",
        "problemmanag",
        "remedy",
        "service-desk",
        "servicedesk",
        "servicenow",
        "topdesk",
    ],
    generic: &[],
    concepts: &[
        // ITSM and its roles (`Change Management` stays the general concept of the core).
        ("it service management", "itsm"),
        ("it servicemanagement", "itsm"),
        ("it service manager", "itsm"),
        ("it service managerin", "itsm"),
        ("service integration management", "siam"),
        ("service delivery management", "service-delivery"),
        ("service delivery manager", "service-delivery"),
        // Service desk and support.
        ("servicedesk", "service-desk"),
        ("help desk", "service-desk"),
        ("helpdesk", "service-desk"),
        ("it helpdesk", "service-desk"),
        ("user helpdesk", "service-desk"),
        ("it support", "service-desk"),
        ("user support", "service-desk"),
        ("end user support", "service-desk"),
        ("first level support", "service-desk"),
        ("1st level support", "service-desk"),
        ("second level support", "service-desk"),
        ("2nd level support", "service-desk"),
        ("anwenderbetreuung", "service-desk"),
        ("anwendersupport", "service-desk"),
        ("benutzerbetreuung", "service-desk"),
        ("leiter service desk", "service-desk-leitung"),
        ("leiterin service desk", "service-desk-leitung"),
        ("leitung service desk", "service-desk-leitung"),
        ("head service desk", "service-desk-leitung"),
        ("leiter it support", "service-desk-leitung"),
        ("leitung it support", "service-desk-leitung"),
        ("head it support", "service-desk-leitung"),
        ("ticketing", "ticketsystem"),
        ("ticketing system", "ticketsystem"),
        ("ticket system", "ticketsystem"),
        // The ITIL practices.
        ("incidentmanagement", "incident-management"),
        ("incident handling", "incident-management"),
        ("storungsmanagement", "incident-management"),
        ("storungsbearbeitung", "incident-management"),
        ("major incident", "major-incident-management"),
        ("problemmanagement", "problem-management"),
        ("root cause analysis", "ursachenanalyse"),
        ("change advisory board", "cab"),
        ("releasemanagement", "release-management"),
        ("release deployment management", "release-management"),
        ("service level management", "service-level-management"),
        ("sla management", "service-level-management"),
        ("slm", "service-level-management"),
        ("service level agreement", "sla"),
        ("slas", "sla"),
        ("operational level agreement", "ola"),
        ("service design", "servicedesign"),
        ("service strategy", "servicestrategie"),
        ("service catalogue", "servicekatalog"),
        ("service catalog", "servicekatalog"),
        ("request fulfillment", "request-fulfilment"),
        ("service request management", "request-fulfilment"),
        ("escalation management", "eskalationsmanagement"),
        ("knowledge management", "wissensmanagement"),
        ("capacity management", "kapazitatsplanung"),
        ("availability management", "verfugbarkeitsmanagement"),
        ("it service continuity management", "itscm"),
        ("supplier management", "lieferantenmanagement"),
        ("vendor management", "lieferantenmanagement"),
        // Configuration, assets and operations.
        ("configuration management database", "cmdb"),
        ("configuration management", "konfigurationsmanagement"),
        ("itam", "it-asset-management"),
        ("it operations", "it-betrieb"),
        ("it betrieb", "it-betrieb"),
        // Tools.
        ("servicenow itsm", "servicenow"),
        ("jira service desk", "jira-service-management"),
        ("remedy", "bmc-remedy"),
    ],
};

#[cfg(test)]
mod tests {
    use super::super::testing::{assert_apart, assert_same, full, vocab};
    use crate::matching::atoms::Vocab;

    fn itsm() -> Vocab {
        let v = vocab(&["ITIL", "IT-Service-Management", "Incident Management"]);
        assert_eq!(v.packs(), ["itService"]);
        v
    }

    #[test]
    fn paraphrases() {
        assert_same(
            &itsm(),
            &[
                ("IT-Service-Management", "ITSM"),
                ("IT Servicemanagement", "ITSM"),
                ("IT Service Manager", "ITSM"),
                ("Servicedesk", "Helpdesk"),
                ("Helpdesk", "IT-Support"),
                ("1st Level Support", "Anwenderbetreuung"),
                ("Leitung Service Desk", "Leiter IT Support"),
                ("Störungsmanagement", "Incidentmanagement"),
                ("Service Level Management", "SLM"),
                ("Service Level Agreements", "SLA"),
                ("SLAs", "SLA"),
                ("Service Catalogue", "Servicekatalog"),
                ("Configuration Management Database", "CMDB"),
                ("Request Fulfillment", "Request-Fulfilment"),
                ("Remedy", "BMC-Remedy"),
                ("IT Operations", "IT-Betrieb"),
                ("Vendor Management", "Supplier Management"),
            ],
        );
    }

    /// Terms ads use as they are meet their other forms through the parts of their value.
    #[test]
    fn terms_meet_their_forms() {
        let v = itsm();
        assert!(full(&v, "Service Desk", "Helpdesk"));
        assert!(full(&v, "Incident Management", "Störungsmanagement"));
        assert!(full(&v, "Problem Management", "Problemmanagement"));
        assert!(full(&v, "Release Management", "Releasemanagement"));
        assert!(full(&v, "Incidentmanagement", "Major Incident"));
        assert!(!full(&v, "Major Incident", "Incident Management"));
    }

    #[test]
    fn false_friends_stay_apart() {
        assert_apart(
            &itsm(),
            &[
                ("Asset Management", "ITAM"),
                ("Service Level", "Service Level Agreement"),
                ("Change Requests", "Change Advisory Board"),
                ("Incident Management", "Problemmanagement"),
                ("Service Delivery Manager", "Leitung Service Desk"),
            ],
        );
    }
}
