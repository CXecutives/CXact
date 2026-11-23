//! Exclusion roles, mentions and denials.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Exclusion words of one family: a profile word in it matches the others too (`Praktikum`,
/// `Praktikant`, `Praktikantin`, `Praktikanten` name the same kind of position).
pub(crate) const EXCLUSION_WORD_FAMILIES: &[&[&str]] = &[&["praktikum", "praktikant"]];

/// Exclusion words that name a kind of position (prefixes of the folded word): in the ad's
/// text they exclude only where it states the offered role, never in a passing mention. A
/// word that ends like a person noun (`-ent`, `-ant`, `-and`, `-ist`) is one as well.
pub(crate) const EXCLUSION_ROLE_WORDS: &[&str] = &[
    "werkstud",
    "working student",
    "praktik",
    "pflichtpraktik",
    "internship",
    "intern",
    "trainee",
    "azubi",
    "auszubild",
    "ausbildung",
    "lehrstelle",
    "lehrling",
    "junior",
    "einsteiger",
    "berufseinsteiger",
    "quereinsteiger",
    "berufsanfanger",
    "absolvent",
    "graduate",
    "volontar",
    "aushilf",
    "hilfskraft",
    "minijob",
    "nebenjob",
    "abschlussarbeit",
    "bachelorarbeit",
    "masterarbeit",
    "thesis",
    "student",
    "sachbearbeit",
    "assistenz",
    "sekretar",
];

pub(crate) const EXCLUSION_ROLE_ENDINGS: &[&str] = &["ent", "ant", "and", "ist"];

/// Heads of a compound that name the position itself (`Werkstudentenstelle`,
/// `Praktikumsplatz`), not something about it (`Praktikumsbetreuung`).
pub(crate) const EXCLUSION_ROLE_HEADS: &[&str] = &[
    "stelle",
    "platz",
    "job",
    "tatigkeit",
    "position",
    "programm",
    "vertrag",
    "level",
];

/// Words within three words before a position word that make it a passing mention, not
/// the offered role: the team, the people one supervises, trains or mentors, a denial, a
/// requirement, an offer of the company (prefixes of a word, same clause).
pub(crate) const EXCLUSION_MENTION_BEFORE: &[&str] = &[
    "von",
    "mit",
    "inkl",
    "inklusive",
    "einschliesslich",
    "samt",
    "unser",
    "kein",
    "nicht",
    "ohne",
    "betreu",
    "anleit",
    "fuhrung",
    "fuhren",
    "fuhrst",
    "fuhrt",
    "leitung",
    "leiten",
    "leitest",
    "coach",
    "mentor",
    "schulung",
    "schulen",
    "ausbild",
    "einarbeit",
    "team",
    "mitarbeiter",
    "mitarbeitend",
    "kolleg",
    "erfahrung",
    "kenntnis",
    "erwart",
    "voraussetzung",
    "abgeschlossen",
    "absolviert",
    "erfolgreich",
    "qualifi",
    "bieten",
    "bietet",
    "including",
    "with",
    "our",
    "supervis",
    "experience",
    "knowledge",
    "degree",
    "completed",
    "offer",
];

/// English words of the same kind, as whole words (`manage` is no prefix of `Management
/// Trainee`).
pub(crate) const EXCLUSION_MENTION_BEFORE_WHOLE: &[&str] = &[
    "of", "no", "not", "without", "manage", "manages", "managing", "lead", "leads", "leading",
    "train", "trains", "training",
];

/// Words within two words after a position word that make it the people one supervises
/// (`Werkstudenten betreuen`), prefixes.
pub(crate) const EXCLUSION_MENTION_AFTER: &[&str] = &[
    "betreu",
    "anleit",
    "ausbild",
    "einarbeit",
    "coach",
    "mentor",
    "schulen",
    "schult",
    "fuhren",
    "fuhrst",
    "fuhrt",
    "supervis",
    "managen",
];

/// Words that seek the role after them (`Wir suchen eine/n Werkstudent/in`).
pub(crate) const EXCLUSION_HIRING_BEFORE: &[&str] = &[
    "suchen", "sucht", "suchst", "besetzen", "hiring", "seek", "seeks", "seeking",
];

/// Words that seek the role before them (`Werkstudent Controlling gesucht`).
pub(crate) const EXCLUSION_HIRING_AFTER: &[&str] = &["gesucht", "wanted"];

/// Nouns before `als` that name the role after it (`Stelle als Werkstudent`).
pub(crate) const EXCLUSION_ROLE_AS: &[&str] = &[
    "stelle",
    "position",
    "tatigkeit",
    "einstieg",
    "job",
    "anstellung",
    "beschaftigung",
    "einsatz",
    "mitarbeit",
    "karrierestart",
    "role",
];

/// Field labels whose value names the role (`Position: Praktikum`).
pub(crate) const EXCLUSION_ROLE_FIELDS: &[&str] = &[
    "position",
    "stelle",
    "rolle",
    "role",
    "jobtitel",
    "job title",
    "stellenbezeichnung",
    "stellentitel",
    "anstellungsart",
    "beschaftigungsart",
    "vertragsart",
    "art der anstellung",
    "art der stelle",
    "employment type",
    "job type",
    "jobart",
    "stellenart",
    "karrierestufe",
    "seniority level",
    "erfahrungsstufe",
    "level",
];

/// Words before an indefinite article that offer the role after it
/// (`für eine Werkstudententätigkeit`, `im Rahmen eines Praktikums`).
pub(crate) const EXCLUSION_ROLE_FOR: &[&str] = &["fur", "for", "rahmen", "form"];

pub(crate) const INDEFINITE_ARTICLES: &[&str] = &[
    "ein", "eine", "einen", "einer", "eines", "a", "an", "ihres", "deines", "seines",
];

/// A short line that starts with a position word names the role unless it goes on to others
/// (`Ausbildung der Auszubildenden`, `Ausbildung und Personalentwicklung`).
pub(crate) const EXCLUSION_LINE_BREAKERS: &[&str] = &[
    "und", "sowie", "oder", "bzw", "and", "or", "der", "des", "den", "dem", "von", "fur", "mit",
    "of", "for", "with", "unserer", "unseres",
];

/// Words that deny what follows them: an exclusion word two words after (`kein
/// Schichtdienst`), full remote work in the same clause (`unable to consider fully remote`).
pub(crate) const DENIALS: &[&str] = &[
    "kein", "keine", "keinen", "keiner", "keinem", "ohne", "nicht", "nie", "no", "not", "without",
    "never", "cannot", "unable",
];

/// Words before a condition word (`Schichtdienst`, `Außendienst`, `Provisionsbasis`) that make
/// it a passing mention: a denial (two words before, `DENIALS`), the team or the company,
/// supervising or training others, a requirement of experience (four words before, same
/// clause).
pub(crate) const EXCLUSION_OTHERS: &[&str] = &[
    "mitarbeiter",
    "mitarbeitend",
    "kolleg",
    "belegschaft",
    "beschaftigte",
    "employee",
    "colleague",
    "staff",
];

/// Parts of a word before a condition word that make it about others or a requirement
/// (`Präsenztrainings für den Außendienst`, `Personaleinsatzplanung für den Schichtdienst`).
pub(crate) const EXCLUSION_OTHERS_PARTS: &[&str] = &[
    "betreuung",
    "schulung",
    "training",
    "coaching",
    "mentoring",
    "anleitung",
    "einarbeitung",
    "fuhrung",
    "leitung",
    "steuerung",
    "planung",
    "begleitung",
    "erfahrung",
    "kenntnis",
];

pub(crate) const EXCLUSION_REQUIREMENT_WORDS: &[&str] = &[
    "experience",
    "knowledge",
    "background",
    "vertraut",
    "familiar",
    "umfeld",
    "environment",
    "idealerweise",
    "ideally",
];

// --- ENGINE_VERSION 23: the frame of a title (`title.rs`) ---
