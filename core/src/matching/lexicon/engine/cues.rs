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

/// A must line containing one of these is a nice-to-have.
pub(crate) const NICE_CUES: &[&str] = &[
    "von vorteil",
    "wunschenswert",
    "idealerweise",
    "nice to have",
    "nice-to-have",
    "ideally",
    "a plus",
    "vorteilhaft",
    "bonus",
    "ein plus",
    "strong plus",
    "gerne mit",
    "an advantage",
    "advantageous",
    "hilfreich",
    "grosses plus",
    "an asset",
    "klarer vorteil",
    "preferred",
    "is a plus",
    "vorzugsweise",
    "bevorzugt",
    "desirable",
    "beneficial",
    "helfen dabei",
    "hilft dabei",
    "helfen ihnen",
    "hilft ihnen",
    "would help",
];

/// Nice cues that open a clause after a comma (`10+ years in finance, ideally in
/// controlling`): the clause from the cue on is nice, what stands before it keeps its kind.
pub(crate) const NICE_LEADS: &[&str] = &[
    "bestenfalls",
    "bevorzugt",
    "idealerweise",
    "ideally",
    "optimalerweise",
    "preferably",
    "vorzugsweise",
];

/// A line that opens a pick list (`Kenntnisse in mindestens zwei der folgenden Bereiche:`): it
/// names a count of the items below and refers to them. The items it opens are a choice, no
/// duty (the rubric's rule 1): they count as nice-to-haves.
pub(crate) const PICK_LIST_COUNTS: &[&str] = &[
    "any of",
    "at least one",
    "at least two",
    "eine der",
    "einem der",
    "einer der",
    "mindestens eine",
    "mindestens einem",
    "mindestens einer",
    "mindestens zwei",
    "one of",
    "two of",
    "zwei der",
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
