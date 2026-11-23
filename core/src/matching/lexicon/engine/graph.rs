//! Relations of the knowledge graph for every profile (the packs add their own,
//! `Domain::covers` and `Domain::near`): concepts that cover narrower ones, concepts close to
//! each other, and the kinds of concept the engine treats apart.
//!
//! external contract - do not translate.

/// Umbrella concepts and the narrower concepts they cover (stemmed when the graph is built):
/// an ad asking for the umbrella is met by a profile naming a narrower one, the narrower one
/// asked is met in half by the umbrella.
pub(crate) const CORE_COVERS: &[(&str, &[&str])] = &[];

/// Concepts close to each other, met in half both ways: an AI tool used and AI asked for,
/// leading and managing a project or a programme, stakeholders and their management. A node
/// of ten letters or more relates its compounds too (`Projektleitungserfahrung`).
pub(crate) const CORE_NEAR: &[(&str, &[&str])] = &[
    ("generative-ki", AI_TOOLS),
    ("ki", AI_TOOLS),
    ("llm", AI_TOOLS),
    (
        "programmmanagement",
        &["programmleitung", "projektmanagement"],
    ),
    ("projektleitung", &["projektmanagement"]),
    ("stakeholdermanagement", &["stakeholder"]),
];

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
