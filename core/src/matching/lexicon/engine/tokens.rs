//! Filler words, short tokens and name and gender forms.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Words that carry no skill on top of the old stopwords (sorted).
pub(crate) const FILLERS: &[&str] = &[
    "about",
    "abstimmung",
    "accept",
    "according",
    "advantage",
    "advantageous",
    "aktuelle",
    "alternativ",
    "analytische",
    "anspruchsvolle",
    "anwendung",
    "any",
    "around",
    "asset",
    "aufgaben",
    "ausdrucklich",
    "ausgepragt",
    "ausschliesslich",
    "background",
    "bereich",
    "bereichen",
    "bereits",
    "besten",
    "between",
    "bieten",
    "bietet",
    "both",
    "bringen",
    "bringst",
    "comparable",
    "damit",
    "darunter",
    "davon",
    "deal",
    "deep",
    "dein",
    "deine",
    "deinem",
    "deinen",
    "deiner",
    "delivered",
    "demonstrated",
    "detaillierte",
    "dich",
    "dir",
    "each",
    "eben",
    "eigene",
    "eigenen",
    "eigener",
    "eigenes",
    "einen",
    "ensure",
    "entsprechende",
    "erfahren",
    "erfahrene",
    "erfolgt",
    "erst",
    "etwa",
    "every",
    "example",
    "experienced",
    "expertise",
    "fachliche",
    "fachlichen",
    "fachlicher",
    "fachliches",
    "familiarity",
    "find",
    "folgende",
    "folgenden",
    "gangigen",
    "gegebenenfalls",
    "gegenuber",
    "geht",
    "general",
    "ggf",
    "gilt",
    "grosse",
    "grosses",
    "hands-on",
    "hiervon",
    "hilfreich",
    "hohe",
    "hoher",
    "ideally",
    "inkl",
    "insbesondere",
    "jahre",
    "jahren",
    "jetzt",
    "jeweils",
    "keep",
    "kenntniss",
    "kenntnissen",
    "kentniss",
    "kentnisse",
    "kurz",
    "kurze",
    "large",
    "least",
    "level",
    "meet",
    "mehrere",
    "mind",
    "mindestens",
    "moderne",
    "moglich",
    "moglichkeit",
    "nachweisbare",
    "nachweislich",
    "need",
    "needs",
    "nice",
    "niveau",
    "nur",
    "occasional",
    "off",
    "other",
    "others",
    "own",
    "part",
    "particular",
    "plus",
    "possible",
    "preferred",
    "pro",
    "record",
    "related",
    "schnell",
    "schnelle",
    "selbst",
    "several",
    "sicher",
    "since",
    "some",
    "sound",
    "sowohl",
    "starke",
    "successful",
    "such",
    "tatigkeit",
    "than",
    "through",
    "track",
    "uberwiegend",
    "umfeld",
    "understanding",
    "uns",
    "unser",
    "unsere",
    "unserem",
    "unseren",
    "unserer",
    "unternehmensumfeld",
    "vergleichbare",
    "vergleichbaren",
    "vertiefte",
    "very",
    "via",
    "vom",
    "vorteil",
    "vorzugsweise",
    "ways",
    "wege",
    "weitreichende",
    "wenig",
    "which",
    "wichtig",
    "wichtige",
    "wichtiger",
    "willing",
    "worked",
    "wunschenswert",
    "year",
    "zahlreiche",
    "zahlreichen",
    "zudem",
];

/// Common words of a product or field name (`Amazon Web Services`, `SAP Analytics Cloud`,
/// `Prompt Engineering`): asked for alone they are no part of a profile entry of several
/// words (stems, sorted).
pub(crate) const NAME_WORDS: &[&str] = &[
    "analytic",
    "business",
    "central",
    "cloud",
    "engine",
    "financial",
    "platform",
    "sens",
    "servic",
    "solution",
    "web",
];

/// Gender endings of a word (after folding).
pub(crate) const GENDER_FORMS: &[&str] = &[
    ":innen", "*innen", "_innen", ":in", "*in", "_in", "/in", "(in)",
];

/// Short tokens that name a skill or role (`QP`, `R`, `Go`, `5S`, `8D`, `IQ/OQ/PQ`, `CI/CD`)
/// and survive the minimum length (sorted).
pub(crate) const SHORT_TOKENS: &[&str] = &[
    "5s", "8d", "ai", "bi", "cd", "ci", "go", "hr", "iq", "ml", "oq", "pq", "qa", "qc", "qp", "r",
    "ux", "vp",
];

/// Codes that a number completes (`ISO 9001`, `Annex 11`, `IEC 62304`) (sorted).
pub(crate) const NUMBERED_CODES: &[&str] = &["anhang", "annex", "din", "iec", "iso", "part"];

/// Parts after a hyphenated skill that only say "knowledge of" (`SQL-Kenntnisse`,
/// `CAPA-Erfahrung`, `SAP-Know-how`).
pub(crate) const KNOWLEDGE_SUFFIXES: &[&str] = &[
    "-erfahrung",
    "-erfahrungen",
    "-expertise",
    "-kenntnis",
    "-kenntnisse",
    "-kenntnissen",
    "-know-how",
    "-knowledge",
    "-wissen",
];

/// Stems that ask for knowledge (`Kenntnisse`, `Erfahrung`, `know-how`).
pub(crate) const KNOWLEDGE_STEMS: &[&str] = &[
    "kenntnis",
    "erfahrung",
    "knowledge",
    "experience",
    "know-how",
    "wissen",
    "skills",
];

/// Words that only say "knowledge of" around a skill (`SAP-Kenntnisse`, `Erfahrung mit SAP`).
pub(crate) const KNOWLEDGE_WORDS: &[&str] = &[
    "erfahrung",
    "erfahrungen",
    "experience",
    "kenntnis",
    "kenntnisse",
    "knowledge",
    "know-how",
    "skills",
    "wissen",
    "sehr",
    "gute",
    "gut",
    "fundierte",
    "umfassende",
    "tiefe",
];

/// Shortest modifier of a compound (`Bericht-erstellung`); `h` of `Herstellung` is none.
pub(crate) const MIN_COMPOUND_MODIFIER: usize = 3;

/// Gender markers in a title (`(all genders)`, `(gn)`), and the letters of `(m/w/d)`.
pub(crate) const GENDER_MARKERS: &[&str] = &[
    "all genders",
    "alle geschlechter",
    "gn",
    "gn*",
    "m/w/d",
    "w/m/d",
];

pub(crate) const GENDER_LETTERS: &[&str] = &["d", "f", "i", "m", "w", "x", "div", "divers"];

/// Numbers written as words.
pub(crate) const NUMBER_WORDS: &[(&str, u32)] = &[
    ("zwei", 2),
    ("drei", 3),
    ("vier", 4),
    ("funf", 5),
    ("sechs", 6),
    ("sieben", 7),
    ("acht", 8),
    ("neun", 9),
    ("zehn", 10),
    ("zwolf", 12),
    ("funfzehn", 15),
    ("zwanzig", 20),
    ("two", 2),
    ("three", 3),
    ("five", 5),
    ("ten", 10),
];

/// Profile atoms that say nothing about the field in the relevance query: contract words
/// written as one word and quantities (the number words count as well).
pub(crate) const QUERY_NOISE: &[&str] = &["davon", "elf", "interimmanagement", "jeden", "rund"];

/// Abbreviations that end with a dot but not a sentence.
pub(crate) const ABBREVIATIONS: &[&str] = &[
    "approx", "bspw", "bzw", "ca", "dr", "evtl", "ggf", "inkl", "max", "min", "mind", "nr", "vgl",
    "zzgl",
];

/// What a page shows in place of a hidden address (Cloudflare's email protection, as the
/// HTML gives it with a space or a no-break space): no word of the ad, masked before
/// matching.
pub(crate) const PAGE_PLACEHOLDERS: &[&str] = &["[email protected]", "[email\u{a0}protected]"];

/// Legal forms of a company: a line naming one is about the company, no requirement.
pub(crate) const LEGAL_FORMS: &[&str] = &[
    "gmbh",
    "ag",
    "se",
    "kg",
    "kgaa",
    "ohg",
    "ltd",
    "inc",
    "llc",
    "plc",
    "gmbh & co. kg",
    "b.v.",
    "s.a.",
    "sarl",
    "s.r.l.",
];

/// Bullet glyphs of pasted and LinkedIn ads on top of `BULLETS`.
pub(crate) const EXTRA_BULLETS: &[char] = &[
    '▪', '■', '●', '◦', '✅', '✔', '✓', '➡', '→', '👉', '➤', '\u{fe0f}',
];
