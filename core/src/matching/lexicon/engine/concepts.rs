//! Concepts, atoms, title heads and field relations.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Atoms that never meet a requirement on their own (sorted; stemmed forms such as
/// `financ`, `manag` included, since atoms are stemmed).
pub(crate) const GENERIC_ATOMS: &[&str] = &[
    "advisor",
    "analys",
    "analyse",
    "anwendung",
    "berat",
    "berater",
    "beratung",
    "business",
    "central",
    "chief",
    "consult",
    "consultant",
    "consulting",
    "digital",
    "director",
    "direktor",
    "direktorin",
    "einfuhrung",
    "erfolg",
    "erp",
    "erstellung",
    "financ",
    "finance",
    "finanz",
    "funktion",
    "head",
    "integration",
    "international",
    "it",
    "kapazitat",
    "konzeption",
    "landschaft",
    "leitung",
    "manag",
    "management",
    "manager",
    "offic",
    "partn",
    "partner",
    "prinzip",
    "process",
    "project",
    "projekt",
    "prozess",
    "regulatorisch",
    "reguliert",
    "sap",
    "stabilisierung",
    "system",
    "team",
    "technologi",
    "technologie",
    "tool",
    "transaktion",
    "transition",
    "umgebung",
    "umstellung",
    "unternehm",
    "unternehmen",
    "unterstutzung",
    "verfahr",
    "werkzeug",
    "zugang",
    "zusammenarbeit",
];

/// Generic atoms that name a field, with its family (`FIELD_PACKS`): too broad to meet a
/// requirement through a word of the profile, but a must that names the field of the title
/// stands on the core of the role (`10+ years in finance` for a `Finance Transformation
/// Lead`), and a must that names only a field is met by a profile of that field.
pub(crate) const FIELD_ATOMS: &[(&str, &str)] = &[
    ("erp", "it"),
    ("financ", "finance"),
    ("finance", "finance"),
    ("finanz", "finance"),
    ("it", "it"),
    ("sap", "it"),
];

/// Compound modifiers that do not narrow a skill (`Konzernkonsolidierung` is still
/// consolidation) (sorted).
pub(crate) const LIGHT_MODIFIERS: &[&str] = &[
    "bereich",
    "business",
    "finanz",
    "gesamt",
    "gruppen",
    "konzern",
    "projekt",
    "sap",
    "unternehmen",
    "unternehmens",
];

/// Heads of a closed compound that a German hyphen ellipsis shares: the longest one the
/// compound ends in is the head.
/// (`Projekt- und Programmmanagement`, `Projektplanung und -controlling`, the closings of a
/// month and of a year in `Monats- und Jahresabschlüsse`)
pub(crate) const ELLIPSIS_HEADS: &[&str] = &[
    "abschlusse",
    "abschlussen",
    "abwicklung",
    "analyse",
    "analysen",
    "anforderungen",
    "anwendungen",
    "architektur",
    "architekturen",
    "beratung",
    "bereich",
    "berichtswesen",
    "betreuung",
    "branche",
    "controlling",
    "daten",
    "denken",
    "dokumentation",
    "ebene",
    "ebenen",
    "einfuhrung",
    "entwicklung",
    "erfahrung",
    "fahigkeit",
    "fahigkeiten",
    "geschick",
    "industrie",
    "integration",
    "kenntnisse",
    "kommunikation",
    "kompetenz",
    "kompetenzen",
    "konzepte",
    "konzepten",
    "leitung",
    "losungen",
    "management",
    "massnahmen",
    "modelle",
    "optimierung",
    "orientierung",
    "planung",
    "plattformen",
    "projekte",
    "projekten",
    "prozesse",
    "prozessen",
    "recht",
    "reporting",
    "sektor",
    "starke",
    "steuerung",
    "strategie",
    "strukturen",
    "systeme",
    "systemen",
    "teams",
    "technik",
    "tools",
    "umfeld",
    "verantwortung",
    "verfahren",
    "verhandlungen",
    "verstandnis",
    "vertrage",
    "verwaltung",
    "vorhaben",
    "wirtschaft",
];

/// Compound heads that do not change a skill (`Carve-out-Projekten`,
/// `Restrukturierungsumfeld`) (sorted).
pub(crate) const LIGHT_HEADS: &[&str] = &[
    "aufgabe",
    "bereich",
    "einsatz",
    "erfahrung",
    "kenntnis",
    "projekt",
    "prozess",
    "thema",
    "umfeld",
    "vorhaben",
];

/// Core bilingual synonyms and paraphrases of general business work (every profile):
/// phrase (space-separated words) -> concept. Field-specific pairs live in `domains`.
pub(crate) const CORE_CONCEPTS: &[(&str, &str)] = &[
    ("project management", "projektmanagement"),
    ("project manag", "projektmanagement"),
    ("projekt management", "projektmanagement"),
    ("programme management", "programmmanagement"),
    ("program management", "programmmanagement"),
    ("change management", "changemanagement"),
    ("change managment", "changemanagement"),
    ("stakeholder management", "stakeholdermanagement"),
    ("project lead", "projektleitung"),
    ("interim management", "interimmanagement"),
    ("interim manag", "interimmanagement"),
    ("interim mandat", "interimmanagement"),
    ("gesamtprojektleitung", "projektleitung"),
    ("programmleitung", "programmmanagement"),
    ("grossprogramm", "programmmanagement"),
    ("veranderungsmanagement", "changemanagement"),
    ("implementation", "einfuhrung"),
    ("implementierung", "einfuhrung"),
    ("migration", "migration"),
    ("process optimization", "prozessoptimierung"),
    ("process optimisation", "prozessoptimierung"),
    ("process improvement", "prozessoptimierung"),
    ("process automation", "prozessautomatisierung"),
    ("automation", "automatisierung"),
    ("quality management", "qualitatsmanagement"),
    // Steering and managing a budget, the stakeholders or the suppliers are one work.
    ("budgetsteuerung", "budgetmanagement"),
    ("stakeholdersteuerung", "stakeholdermanagement"),
    ("lieferantensteuerung", "lieferantenmanagement"),
    ("vendormanagement", "lieferantenmanagement"),
    ("vendor management", "lieferantenmanagement"),
    ("german", "deutsch"),
    ("english", "englisch"),
    ("french", "franzosisch"),
    ("spanish", "spanisch"),
];

/// Leadership asked for (`Führungserfahrung`, `leadership experience`): a profile with a
/// leading role meets it at least half.
pub(crate) const LEADERSHIP_ATOMS: &[&str] = &[
    "disziplinarisch",
    "fuhrung",
    "fuhrungserfahrung",
    "fuhrungskompetenz",
    "fuhrungsverantwortung",
    "leadership",
    "mitarbeiterfuhrung",
    "personalfuhrung",
    "personalverantwortung",
    "teamfuhrung",
    "teamleitung",
];

/// Words that reach every field, too broad for a search term on their own (beside the
/// generic, general business, leadership and soft words): `Generative KI`, `Digitalisierung`,
/// `Automatisierung`, `Weiterbildung` (ads of every field offer it)
/// (`atoms::broad_search_term`).
pub(crate) const SEARCH_BROAD_ATOMS: &[&str] = &[
    "ai",
    "automatisierung",
    "digitalisierung",
    "generativ",
    "innovation",
    "intelligenz",
    "ki",
    "kommunikation",
    "kunstlich",
    "optimierung",
    "organisation",
    "prozessoptimierung",
    "strategie",
    "transformation",
    "weiterbildung",
];

/// Separators of a title's marketing tail (`Interim CFO – Scale-up E-Mobility`).
pub(crate) const TITLE_TAIL_SEPARATORS: &[&str] = &[" – ", " — ", " | ", " - "];

/// Contract words in a title that say nothing about the field (title fit).
pub(crate) const TITLE_CONTRACT_WORDS: &[&str] = &[
    "befristet",
    "befristete",
    "befristeter",
    "contract",
    "contractor",
    "fractional",
    "freelance",
    "freelancer",
    "freiberufler",
    "freiberuflich",
    "interim",
    "interimistisch",
    "temporary",
    "zeitlich",
];

/// Whom a soft skill addresses, as atoms: no skill of its own beside a soft word (a level,
/// `-ebene`, as well).
/// (`Kommunikation auf Managementebene`, `Auftreten gegenüber Kunden und Partnern`)
pub(crate) const AUDIENCE_ATOMS: &[&str] = &[
    "eben",
    "fachbereich",
    "kund",
    "management",
    "mitarbeit",
    "partn",
    "stakehold",
    "team",
    "vertriebspartn",
];

/// Phrases whose `und`/`and` joins no two requirements (`Deutsch in Wort und Schrift`).
pub(crate) const PROTECTED_PHRASES: &[&str] = &[
    "in wort und schrift",
    "wort und schrift",
    "mündlich und schriftlich",
    "schriftlich und mündlich",
    "written and spoken",
    "spoken and written",
    "written and verbal",
    "verbal and written",
];

/// Words after a comma that continue the item (`SAP, gerne auch S/4HANA`,
/// `klar, auch wenn es unbequem wird`); `, davon 3 Jahre in Führung` splits.
pub(crate) const COMMA_TAILS: &[&str] = &[
    "auch ",
    "gerne ",
    "gern ",
    "davon ",
    "ob ",
    "ohne dass",
    "auch wenn",
    "as ",
    "egal ",
    "insbesondere ",
    "vorzugsweise ",
];

/// Words after which a list of bare nouns names the partners of one item
/// (`Zusammenarbeit mit Gesellschaftern, Investoren und Dienstleistern`); a list after
/// `Erfahrung mit` names skills and splits.
pub(crate) const LIST_OBJECT_WORDS: &[&str] = &[
    "gegenüber",
    "rund um",
    "towards",
    "zusammenarbeit mit",
    "umgang mit",
    "abstimmung mit",
    "austausch mit",
    "kontakt mit",
    "kommunikation mit",
    "verhandlungen mit",
    "schnittstelle zu",
    "working with",
    "collaboration with",
    "interaction with",
    "liaising with",
    "dealing with",
    "interface with",
];

/// Prepositions of a requirement part that names an activity (`im Aufbau`, `in der Führung`)
/// and the words that open its object (`von Vertriebsteams`): parts joined by `und` share
/// the object the last one names.
pub(crate) const ACTIVITY_PREPOSITIONS: &[&str] = &["im", "in", "beim", "bei", "zur", "zum", "am"];

pub(crate) const OBJECT_OPENERS: &[&str] = &["von", "of"];

/// Activities without an ending of their own (`Aufbau`, `Analyse`), folded.
pub(crate) const ACTIVITY_NOUNS: &[&str] = &["analyse", "aufbau", "ausbau", "betrieb"];

/// German articles before a noun.
pub(crate) const ARTICLES: &[&str] = &["der", "die", "das", "des", "dem", "den"];

/// Head nouns of a title and their level on the ladder of engine 23: 1 clerical and agent
/// work, 2 specialist, consultant and officer, 3 senior and project lead, 4 team lead, 5 the
/// lead of a function, 6 director, division and interim manager, C-level. A token is its head
/// noun as a whole or as the end of a compound (`kundenbetreuer`, `bereichsleiter`); the
/// longest head wins (`projektleiter` 3 before `leiter` 5).
pub(crate) const TITLE_HEADS: &[(&str, u8)] = &[
    ("agent", 1),
    ("assistant", 1),
    ("assistent", 1),
    ("assistentin", 1),
    ("assistenz", 1),
    ("bearbeiter", 1),
    ("bearbeiterin", 1),
    ("betreuer", 1),
    ("betreuerin", 1),
    ("clerk", 1),
    ("disponent", 1),
    ("disponentin", 1),
    ("fachkraft", 1),
    ("kauffrau", 1),
    ("kaufmann", 1),
    ("kundenberater", 1),
    ("kundenberaterin", 1),
    ("mitarbeiter", 1),
    ("mitarbeiterin", 1),
    ("operator", 1),
    ("representative", 1),
    ("sachbearbeitung", 1),
    ("accountant", 2),
    ("administrator", 2),
    ("analyst", 2),
    ("auditor", 2),
    ("berater", 2),
    ("beraterin", 2),
    ("buchhalter", 2),
    ("buchhalterin", 2),
    ("consultant", 2),
    ("controller", 2),
    ("controllerin", 2),
    ("coordinator", 2),
    ("designer", 2),
    ("developer", 2),
    ("engineer", 2),
    ("entwickler", 2),
    ("entwicklerin", 2),
    ("ingenieur", 2),
    ("ingenieurin", 2),
    ("koordinator", 2),
    ("koordinatorin", 2),
    ("officer", 2),
    ("referent", 2),
    ("referentin", 2),
    ("specialist", 2),
    ("spezialist", 2),
    ("spezialistin", 2),
    ("techniker", 2),
    ("trainer", 2),
    ("architect", 3),
    ("architekt", 3),
    ("coach", 3),
    ("expert", 3),
    ("experte", 3),
    ("expertin", 3),
    ("lead", 3),
    ("projektleiter", 3),
    ("projektleiterin", 3),
    ("projektleitung", 3),
    ("projektmanager", 3),
    ("projektmanagerin", 3),
    ("gruppenleiter", 4),
    ("gruppenleiterin", 4),
    ("gruppenleitung", 4),
    ("programmleiter", 4),
    ("programmleitung", 4),
    ("programmmanager", 4),
    ("schichtleiter", 4),
    ("schichtleitung", 4),
    ("supervisor", 4),
    ("teamleiter", 4),
    ("teamleiterin", 4),
    ("teamleitung", 4),
    ("head", 5),
    ("leiter", 5),
    ("leiterin", 5),
    ("leitung", 5),
    ("manager", 5),
    ("managerin", 5),
    ("bereichsleiter", 6),
    ("bereichsleiterin", 6),
    ("bereichsleitung", 6),
    ("ceo", 6),
    ("cfo", 6),
    ("chief", 6),
    ("cio", 6),
    ("cmo", 6),
    ("coo", 6),
    ("cto", 6),
    ("director", 6),
    ("direktor", 6),
    ("direktorin", 6),
    ("geschaftsfuhrer", 6),
    ("geschaftsfuhrerin", 6),
    ("geschaftsfuhrung", 6),
    ("interimsmanager", 6),
    ("prokurist", 6),
    ("vp", 6),
];

/// Phrases of a title that are one head (read before the single words).
pub(crate) const TITLE_HEAD_PHRASES: &[(&str, u8)] = &[
    ("account manager", 2),
    ("product owner", 3),
    ("product manager", 3),
    ("project lead", 3),
    ("project manager", 3),
    ("scrum master", 3),
    ("program manager", 4),
    ("programme manager", 4),
    ("team lead", 4),
    ("team leader", 4),
    ("interim manager", 6),
    ("managing director", 6),
    ("vice president", 6),
];

/// Heads of the levels 2 and 3 that name an engagement of every level, not a rung below a
/// lead (`title::engagement`): consulting, a project, architecture, expertise, coaching.
pub(crate) const TITLE_ENGAGEMENTS: &[&str] = &[
    "architect",
    "architekt",
    "berater",
    "beraterin",
    "coach",
    "consultant",
    "expert",
    "experte",
    "expertin",
    "project lead",
    "project manager",
    "projektleiter",
    "projektleiterin",
    "projektleitung",
    "projektmanager",
    "projektmanagerin",
];

/// Words after which a title names whom the role serves, not the role (`der`, `to`).
pub(crate) const TITLE_SERVES: &[&str] = &["der", "des", "to", "fur"];

/// A title word that raises a specialist (2) or clerical (1) head one level.
pub(crate) const TITLE_SENIOR: &[&str] = &["senior", "sr", "principal"];

/// The domain packs of each field family (engine 23).
pub(crate) const FIELD_PACKS: &[(&str, &[&str])] = &[
    ("finance", &["finance", "restructuring"]),
    ("it", &["sap", "itService", "software", "data"]),
    ("project", &["itProject", "consulting"]),
    ("hr", &["hr"]),
    ("procurement", &["procurement"]),
    ("sales", &["sales", "marketing"]),
    ("service", &["customerService"]),
    ("engineering", &["operations", "energy", "pharma"]),
    ("legal", &["legal"]),
];

/// Field families close to each other: a profile of one does work of the other.
pub(crate) const NEAR_FIELDS: &[(&str, &str)] = &[
    ("finance", "legal"),
    ("finance", "procurement"),
    ("hr", "legal"),
    ("it", "project"),
    ("procurement", "engineering"),
    ("sales", "service"),
];
