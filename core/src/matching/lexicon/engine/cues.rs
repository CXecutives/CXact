//! Nice and must cues, separators, examples, lead verbs and description starts.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Items that are only a soft word (`Arbeitsweise`, `working style`, `Soft Skills`); compared
/// as stems.
pub(crate) const SOFT_ALONE: &[&str] = &[
    "arbeitsweise",
    "eigenschaften",
    "fahigkeiten",
    "haltung",
    "kompetenzen",
    "mentalitat",
    "mindset",
    "personlichkeit",
    "skills",
    "soft",
    "style",
];

/// A sentence starting with one of these words and naming no known skill is a soft
/// requirement (`Sie kommunizieren klar`, `Du packst gerne mit an`).
pub(crate) const PRONOUN_STARTS: &[&str] =
    &["sie", "du", "you", "your", "ihr", "ihre", "dein", "deine"];

/// Starts of a sentence that describes the role or the search, not a skill (`we are looking for`,
/// `the role is`, and their German forms): no requirement.
pub(crate) const DESCRIPTION_STARTS: &[&str] = &[
    "die position ist",
    "die rolle ist",
    "diese position ist",
    "diese rolle ist",
    "gesucht werden",
    "gesucht wird",
    "the position is",
    "the role is",
    "this position is",
    "this role is",
    "we are looking",
    "we're looking",
    "wir suchen",
];

/// Wording that makes a formal requirement mandatory.
pub(crate) const MANDATORY_WORDS: &[&str] = &[
    "zwingend",
    "unabdingbar",
    "unerlasslich",
    "unbedingt erforderlich",
    "verpflichtend",
    "mandatory",
    "is a must",
    "must-have",
    "strictly required",
];

/// Where a nice cue makes requirements nice-to-haves.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CueScope {
    /// The item it stands in (`Power BI (optional)`).
    Item,
    /// The clause it opens, to the clause's end (`10+ years in finance, ideally in
    /// controlling`, `SAP FI (idealerweise S/4HANA)`), else the item it closes (`SAP
    /// bevorzugt`).
    Clause,
    /// The line up to it (`Kenntnisse in LucaNet und Power BI von Vorteil`), the whole line when
    /// it opens it (`Von Vorteil sind ...`).
    Line,
    /// The items of the list it opens when the line refers to them: a choice, no duty (the
    /// rubric's rule 1; `Kenntnisse in mindestens zwei der folgenden Bereiche:`).
    List,
}

/// Nice cues and their scope: whole words; the last word of a German cue may take a declined
/// ending (`wünschenswerte`, `erwünschte`); a hyphen counts as a space (`nice-to-have`).
pub(crate) const NICE_CUES: &[(&str, CueScope)] = &[
    ("a plus", CueScope::Line),
    ("advantageous", CueScope::Line),
    ("an advantage", CueScope::Line),
    ("an asset", CueScope::Line),
    ("any of", CueScope::List),
    ("at least one", CueScope::List),
    ("at least two", CueScope::List),
    ("beneficial", CueScope::Line),
    ("bestenfalls", CueScope::Clause),
    ("bevorzugt", CueScope::Clause),
    ("bonus", CueScope::Line),
    ("desirable", CueScope::Line),
    ("ein plus", CueScope::Line),
    ("eine der", CueScope::List),
    ("einem der", CueScope::List),
    ("einer der", CueScope::List),
    ("erwunscht", CueScope::Line),
    ("gern", CueScope::Clause),
    ("gerne", CueScope::Clause),
    ("grosses plus", CueScope::Line),
    ("helfen dabei", CueScope::Line),
    ("helfen ihnen", CueScope::Line),
    ("hilfreich", CueScope::Line),
    ("hilft dabei", CueScope::Line),
    ("hilft ihnen", CueScope::Line),
    ("idealerweise", CueScope::Clause),
    ("ideally", CueScope::Clause),
    ("is a plus", CueScope::Line),
    ("klarer vorteil", CueScope::Line),
    ("mindestens eine", CueScope::List),
    ("mindestens einem", CueScope::List),
    ("mindestens einer", CueScope::List),
    ("mindestens zwei", CueScope::List),
    ("nice to have", CueScope::Line),
    ("one of", CueScope::List),
    ("one or more of", CueScope::List),
    ("optimalerweise", CueScope::Clause),
    ("optional", CueScope::Item),
    ("preferably", CueScope::Clause),
    ("preferred", CueScope::Clause),
    ("strong plus", CueScope::Line),
    ("two of", CueScope::List),
    ("von vorteil", CueScope::Line),
    ("vorteilhaft", CueScope::Line),
    ("vorzugsweise", CueScope::Clause),
    ("would help", CueScope::Line),
    ("wunschenswert", CueScope::Line),
    ("zwei der", CueScope::List),
];

/// The words of a pick list's line that refer to the items below it.
pub(crate) const PICK_LIST_REFERS: &[&str] = &["folgend", "following"];

/// A requirement item that says something is not needed.
pub(crate) const NOT_NEEDED: &[&str] = &[
    "nicht notwendig",
    "nicht erforderlich",
    "nicht notig",
    "nicht zwingend",
    "keine voraussetzung",
    "not required",
];

/// English requirement cues for the sentence stage.
pub(crate) const EN_CUES: &[&str] = &[
    "required",
    "experience in",
    "experience with",
    "knowledge of",
    "you bring",
];

/// Example markers inside an item (alternatives of the head).
pub(crate) const EXAMPLES: &[&str] = &[
    "z. b.",
    "z.b.",
    "u. a.",
    "u.a.",
    "e.g.",
    "e. g.",
    "such as",
    "etwa",
    "beispielsweise",
    "bspw.",
];

/// Separators inside an example list.
pub(crate) const EXAMPLE_SEPARATORS: &[&str] = &[", ", " und ", " oder ", " or ", " and "];

/// Verbs that lead a requirement after its pronoun (`You have spent several years in X`,
/// `Sie bringen Erfahrung in X mit`, `Du verfügst über X`): they ask for nothing themselves
/// (sorted).
pub(crate) const LEAD_VERBS: &[&str] = &[
    "acquired",
    "bring",
    "bringen",
    "bringst",
    "bringt",
    "gained",
    "gesammelt",
    "haben",
    "had",
    "has",
    "hast",
    "have",
    "led",
    "mitbringen",
    "mitbringst",
    "possess",
    "spent",
    "verfugen",
    "verfugst",
    "verfugt",
];

/// The joining words between the modifiers of a leading ellipsis and its head
/// (`Risiko-, Qualitäts- und Abhängigkeitsmanagement`).
pub(crate) const ELLIPSIS_JOINERS: &[&str] = &["&", "bzw", "bzw.", "oder", "sowie", "und"];

/// AND separators of requirement items.
pub(crate) const AND: &[&str] = &[
    ", ",
    "; ",
    " und ",
    " sowie ",
    " & ",
    " and ",
    " as well as ",
    " inkl. ",
    " including ",
];

/// Words that make a phrase an AND list.
pub(crate) const AND_WORDS: &[&str] = &[" und ", " sowie ", " and ", " & "];

/// OR separators: alternatives inside an item.
pub(crate) const OR: &[&str] = &[" oder ", " bzw. ", " beziehungsweise ", " or ", " / "];

/// OR separators between two neighbours only (`Excel und/oder Power BI`): they make no phrase
/// a list of alternatives.
pub(crate) const AND_OR: &[&str] = &[" und/oder ", " and/or "];

/// Words that open a relative clause after a comma (`, welche ...`, `, in denen ...`, `, which
/// ...`): the clause belongs to what stands before it, no requirement of its own. An article
/// opens one before a word in lower case (`, die die Zusammenarbeit fördern`).
pub(crate) const RELATIVE_WORDS: &[&str] = &[
    "denen", "deren", "dessen", "welche", "welchem", "welchen", "welcher", "welches", "where",
    "which", "who", "whom", "whose", "wo", "wobei", "wodurch", "womit",
];

/// Prepositions before a relative word (`, in denen`, `, mit der Sie`, `, in which`).
pub(crate) const CLAUSE_PREPOSITIONS: &[&str] = &[
    "an", "auf", "aus", "bei", "by", "durch", "for", "from", "fur", "in", "mit", "nach", "of",
    "on", "uber", "unter", "von", "with", "zu",
];

/// Phrases that make an item soft (`Freude an Zahlen`, `Leadership style`, `build teams`).
pub(crate) const SOFT_PHRASES: &[&str] = &[
    "freude an",
    "spass an",
    "interesse an",
    "interest in",
    "confident when presenting",
    "presentation skills",
    "leadership style",
    "fuhrungsstil",
    "build teams",
    "hands-on mentality",
    "hands-on mentalitat",
    "hohes mass an",
];

/// Sentences of an ad that make the role a lead role (at least a team lead).
pub(crate) const LEAD_CUES: &[&str] = &[
    "disziplinarische fuhrung",
    "disziplinarischer fuhrung",
    "disziplinarische verantwortung",
    "disziplinarischen fuhrung",
    "personalverantwortung fur",
    "fuhrung eines teams",
    "fuhrung des teams",
    "leitung eines teams",
    "leitung des teams",
    "direct reports",
];

/// Sentences of an ad that make the role one without staff (at most a senior specialist).
pub(crate) const NO_LEAD_CUES: &[&str] = &[
    "ohne personalverantwortung",
    "keine personalverantwortung",
    "ohne disziplinarische",
    "without direct reports",
    "no direct reports",
];

/// Requirements of an operative role (a vocational training) where the title names no head.
pub(crate) const OPERATIVE_CUES: &[&str] = &[
    "abgeschlossene berufsausbildung",
    "abgeschlossenen berufsausbildung",
    "kaufmannische ausbildung",
    "kaufmannischen ausbildung",
];
