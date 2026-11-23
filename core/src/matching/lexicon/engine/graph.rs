//! Relations of the knowledge graph for every profile (the packs add their own,
//! `Domain::covers` and `Domain::near`): concepts that cover narrower ones, concepts close to
//! each other, work and its parts, and the kinds of concept the engine treats apart.
//!
//! external contract - do not translate.

/// Umbrella concepts and the narrower concepts they cover (stemmed when the graph is built):
/// an ad asking for the umbrella is met by a profile naming a narrower one, the narrower one
/// asked is met in half by the umbrella. Who manages programmes manages projects.
pub(crate) const CORE_COVERS: &[(&str, &[&str])] =
    &[("projektmanagement", &["programmmanagement"])];

/// Concepts close to each other, met in half both ways: an AI tool used and AI asked for,
/// leading and managing a project or a programme, stakeholders and their management. A node
/// of ten letters or more relates its compounds too (`Projektleitungserfahrung`).
pub(crate) const CORE_NEAR: &[(&str, &[&str])] = &[
    ("generative-ki", AI_TOOLS),
    ("ki", AI_TOOLS),
    ("llm", AI_TOOLS),
    ("programmmanagement", &["programmleitung"]),
    ("projektleitung", &["projektmanagement"]),
    ("stakeholdermanagement", &["stakeholder"]),
];

/// Work and the parts it comprises (stemmed when the graph is built): who does the whole does
/// its parts, so a part asked for is met in full by a profile naming the whole, and the whole
/// asked in half by a part. No chain into the umbrellas: general ledger accounting closes the
/// books, but accounting asked for is not met by bookkeeping alone (`Domain::covers`).
pub(crate) const PARTS: &[(&str, &[&str])] = &[
    // The general ledger closes the months and the year and draws up the balance sheet.
    (
        "hauptbuchhaltung",
        &[
            "bilanzierung",
            "jahresabschluss",
            "monatsabschluss",
            "rechnungslegung",
        ],
    ),
    // A programme is planned, its resources and the dependencies of its projects managed.
    (
        "programmmanagement",
        &[
            "abhangigkeitsmanagement",
            "programmplanung",
            "ressourcenmanagement",
        ],
    ),
];

/// Heads of a compound that names an undertaking (stems): the compound
/// (`Transformationsvorhaben`) is near project management, the work that runs it. `Projekt`
/// is none of them: `IT-Projekte` near project management lifts the project jobs of other
/// fields (measured on the 154 graded jobs and the held-out sets).
pub(crate) const PROJECT_HEADS: &[&str] = &["vorhab"];

/// AI tools a profile names.
const AI_TOOLS: &[&str] = &["chatgpt", "claude", "copilot"];

/// General business work any field does (`Projektmanagement`, `Stakeholder Management`): it
/// meets requirements, but shows no field.
pub(crate) const METHODS: &[&str] = &[
    "automatisierung",
    "changemanagement",
    "deutsch",
    "einfuhrung",
    "englisch",
    "franzosisch",
    "interimmanagement",
    "migration",
    "programmmanagement",
    "projektleitung",
    "projektmanagement",
    "prozessautomatisierung",
    "prozessoptimierung",
    "qualitatsmanagement",
    "spanisch",
    "stakeholdermanagement",
];

/// Kinds of tools: the names of the kind itself and of its tools (folded, whole words; a
/// hyphen reads as a space). The kind asked for (`CRM-System`) is met by a tool of it
/// (`Salesforce`); a tool asked for is met in part by another tool of its kind or by the kind
/// alone (`HubSpot` for `Salesforce`, the rubric's rule 3). A bare family (`SAP`, `Oracle`,
/// `Microsoft`) names no kind.
pub(crate) const TOOL_KINDS: &[(&str, &[&str], &[&str])] = &[
    (
        "crm",
        &["crm"],
        &[
            "dynamics crm",
            "dynamics 365 sales",
            "hubspot",
            "pipedrive",
            "salesforce",
            "sap c4c",
            "sap crm",
            "sap sales cloud",
            "siebel",
            "sugarcrm",
            "zoho",
        ],
    ),
    (
        "erp",
        &["erp", "warenwirtschaft", "warenwirtschaftssystem"],
        &[
            "abas",
            "business central",
            "dynamics 365 finance",
            "dynamics ax",
            "dynamics nav",
            "infor",
            "jd edwards",
            "navision",
            "netsuite",
            "odoo",
            "oracle ebs",
            "oracle erp",
            "oracle fusion",
            "proalpha",
            "s/4hana",
            "s4hana",
            "sap ecc",
            "sap erp",
            "sap fi",
            "sap fi/co",
            "sap fico",
            "sap mm",
            "sap pp",
            "sap r/3",
            "sap s/4",
            "sap s/4hana",
            "sap sd",
        ],
    ),
    (
        "bi",
        &["bi tool", "bi tools", "business intelligence"],
        &[
            "cognos",
            "looker",
            "microstrategy",
            "power bi",
            "powerbi",
            "qlik",
            "qlik sense",
            "qlikview",
            "sap analytics cloud",
            "sap bo",
            "sap businessobjects",
            "sap bw",
            "tableau",
            "thoughtspot",
        ],
    ),
    (
        "ticketing",
        &["itsm tool", "itsm tools", "ticket system", "ticketsystem"],
        &[
            "bmc remedy",
            "freshdesk",
            "freshservice",
            "jira service desk",
            "jira service management",
            "otrs",
            "remedy",
            "servicenow",
            "topdesk",
            "zendesk",
        ],
    ),
    (
        "ccaas",
        &["acd", "ccaas", "contact center software"],
        &[
            "amazon connect",
            "avaya",
            "cisco uccx",
            "cxone",
            "five9",
            "genesys",
            "nice cxone",
            "talkdesk",
            "twilio flex",
        ],
    ),
    (
        "hcm",
        &["hris"],
        &[
            "adp",
            "loga",
            "oracle hcm",
            "personio",
            "sap hcm",
            "sap hr",
            "sap successfactors",
            "successfactors",
            "workday",
        ],
    ),
    (
        "projects",
        &[],
        &[
            "asana",
            "azure devops",
            "jira",
            "microsoft project",
            "monday.com",
            "ms project",
            "planview",
            "smartsheet",
            "trello",
        ],
    ),
    (
        "consolidation",
        &["konsolidierungssoftware"],
        &[
            "bpc",
            "cch tagetik",
            "hfm",
            "lucanet",
            "onestream",
            "oracle hfm",
            "sap bpc",
            "sap group reporting",
            "tagetik",
        ],
    ),
    (
        "planning",
        &[],
        &["anaplan", "hyperion", "jedox", "oracle pbcs", "sap ibp"],
    ),
    (
        "procurement",
        &[],
        &[
            "ariba",
            "coupa",
            "ivalua",
            "jaggaer",
            "sap ariba",
            "sap srm",
        ],
    ),
    (
        "rpa",
        &["rpa"],
        &[
            "automation anywhere",
            "blue prism",
            "power automate",
            "uipath",
        ],
    ),
    ("cloud", &[], &["aws", "azure", "gcp", "google cloud"]),
    (
        "quality standard",
        &[],
        &["as9100", "en 9100", "iatf 16949", "iso 13485", "iso 9001"],
    ),
    ("project method", &[], &["pmp", "prince2", "sap activate"]),
];

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::atoms::fold;

    #[test]
    fn tool_kinds_are_folded() {
        for (kind, own, tools) in TOOL_KINDS {
            for name in own.iter().chain(*tools) {
                assert_eq!(fold(name), *name, "{kind}");
                assert!(!name.contains('-'), "{kind}: {name}");
            }
        }
    }
}
