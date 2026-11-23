//! Contract kinds: agency work (ANUE), interim and permanent.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// A sentence that denies a contract form gives no contract signal
/// (`Interim Management oder Arbeitnehmerüberlassung ist nicht vorgesehen`).
pub(crate) const CONTRACT_DENIED: &[&str] = &[
    "nicht vorgesehen",
    "nicht moglich",
    "nicht gewunscht",
    "nicht gewollt",
    "ausgeschlossen",
    "not possible",
    "not an option",
    "not considered",
    "kein interim",
    "keine interim",
    "keine freelancer",
    "keine freiberufler",
    "no freelancer",
    "no interim",
    "not consider",
    "don't consider",
];

/// ANÜ named: whole words, then substrings (case-folded, without umlauts).
pub(crate) const ANUE_WORDS: &[&str] = &["anu", "anue"];

pub(crate) const ANUE_PARTS: &[&str] = &["uberlassung", "temporary agency"];

/// ANÜ in substance without the name (whole words).
pub(crate) const ANUE_HIDDEN: &[&str] = &["payrolling", "equal pay", "igz", "bap", "gvp"];

/// Negations in the same sentence: whole words, then substrings.
pub(crate) const ANUE_NEGATION: &[&str] = &[
    "kein", "keine", "nicht", "ohne", "not", "no", "without", "never",
];

pub(crate) const ANUE_NEGATION_PARTS: &[&str] = &[
    "ausgeschlossen",
    "abgrenzung",
    "nicht vorgesehen",
    "not considered",
    "excluded",
    "ruled out",
];

/// ANÜ as a topic of the requirements, not the contract form: a cue that governs it
/// (experience with it, knowledge of the law, managing temporary staff). Cues before the
/// mention: the start of a word (`Erfahrung`, `Kenntnisse`; not `SAP-Kenntnisse`, whose
/// object is SAP) with only `ANUE_TOPIC_LINKS` between it and the mention, or a part of the
/// mention's own word (`ANÜ-Erfahrung`).
pub(crate) const ANUE_TOPIC: &[&str] = &[
    "erfahrung",
    "kenntnis",
    "know-how",
    "knowhow",
    "vertraut",
    "versiert",
    "expertise",
    "fachwissen",
    "idealerweise",
    "steuerung",
    "experience",
    "knowledge",
    "familiar",
    "managing",
    "management",
];

/// Words between a cue of `ANUE_TOPIC` and the ANÜ it governs (`Erfahrung im Einsatz von`,
/// `Kenntnisse des`, `Steuerung der`, `experience with`, `knowledge of`).
pub(crate) const ANUE_TOPIC_LINKS: &[&str] = &[
    "mit",
    "im",
    "in",
    "der",
    "des",
    "dem",
    "den",
    "die",
    "das",
    "von",
    "vom",
    "zur",
    "zum",
    "bei",
    "rund",
    "um",
    "fur",
    "zu",
    "und",
    "sowie",
    "oder",
    "bzw",
    "einsatz",
    "umgang",
    "rahmen",
    "bereich",
    "thema",
    "themen",
    "fragen",
    "regelungen",
    "abwicklung",
    "gestaltung",
    "with",
    "of",
    "the",
    "a",
    "an",
    "about",
    "around",
    "regarding",
    "and",
    "or",
    "handling",
    "use",
];

/// A requirement after the ANÜ it names (`Arbeitnehmerüberlassung von Vorteil`, `... is a
/// plus`): substrings of the next four words.
pub(crate) const ANUE_TOPIC_AFTER: &[&str] = &[
    "von vorteil",
    "wunschenswert",
    "erwunscht",
    "vorteilhaft",
    "nice to have",
    "a plus",
    "an advantage",
];

/// ANÜ only one option: whole words, then substrings.
pub(crate) const ANUE_OPTION: &[&str] = &[
    "oder",
    "or",
    "wahlweise",
    "alternativ",
    "optional",
    "moglich",
];

pub(crate) const ANUE_OPTION_PARTS: &[&str] = &["je nach"];

/// ANÜ as the business of a company, not the contract form (its core business, a group
/// active in it): substrings of the sentence, unless it also names the contract
/// (`ANUE_CONTRACT`).
pub(crate) const ANUE_BUSINESS: &[&str] = &[
    "kerngeschaft",
    "geschaftsfeld",
    "geschaftsbereich",
    "tatig",
    "spezialisiert",
    "marktfuhrer",
    "anbieter von",
    "anbieter fur",
    "active in",
    "specialis",
    "specializ",
    "provider of",
];

/// Roles of the staffing business: a title that names one with ANÜ names ANÜ as the field of
/// the role, not its contract form (`Disponent (m/w/d) Arbeitnehmerüberlassung`), substrings.
pub(crate) const ANUE_FIELD_ROLES: &[&str] = &[
    "disponent",
    "recruit",
    "personalberater",
    "personalvermittl",
    "niederlassungsleit",
    "branch manager",
    "personaldienstleist",
];

/// A sentence that places the job itself in ANÜ (whole words or phrases).
pub(crate) const ANUE_CONTRACT: &[&str] = &[
    "im rahmen",
    "im wege",
    "auf basis",
    "einsatz",
    "besetzung",
    "anstellung",
    "vertragsart",
    "suchen wir",
    "wir suchen",
    "we are looking",
    "we seek",
    "fur unseren kunden",
    "for our client",
    "uber anu",
    "per anu",
    "via anu",
];

/// Permanent position.
pub(crate) const PERMANENT_WORDS: &[&str] = &[
    "festanstellung",
    "jahresgehalt",
    "unbefristet",
    "permanent position",
    "permanent role",
    "annual salary",
];

/// Interim or freelance work (substrings of the folded text).
pub(crate) const INTERIM_CUES: &[&str] = &[
    "interim",
    "freiberuf",
    "freelance",
    "werkvertrag",
    "dienstvertrag",
    "projektanfrage",
    "projektlaufzeit",
    "projektdauer",
    "einsatzdauer",
    "dauer:",
    "duration",
    "auslastung",
    "tagessatz",
    "stundensatz",
    "honorar",
    "day rate",
    "daily rate",
    "hourly rate",
    "(contract)",
    "contract role",
    "contract basis",
    "contractor",
    "auf zeit",
    "projektbasis",
    "project basis",
    "vakanzuberbruckung",
    "ubergangsgeschaftsfuhr",
    "ubergangsweise",
    "fractional",
];

/// Interim management among the interim cues (the rest is freelance project work): only
/// the name of the contract type shown differs, the rules read both as one kind.
pub(crate) const INTERIM_MANAGEMENT_CUES: &[&str] = &[
    "interim",
    "auf zeit",
    "vakanzuberbruckung",
    "ubergangsgeschaftsfuhr",
    "ubergangsweise",
    "fractional",
];

/// A stated permanent position (in addition to [`PERMANENT_WORDS`]).
pub(crate) const PERMANENT_STATED: &[&str] = &[
    "festangestellt",
    "permanent contract",
    "permanent employment",
    "permanent full-time",
    "full-time permanent",
    "annual gross salary",
    "gross annual salary",
    "zielgehalt",
    "bruttojahresgehalt",
    // LinkedIn's salary chip (`72.000 €/Jahr - 88.000 €/Jahr`).
    "€/jahr",
    "eur/jahr",
    "€/yr",
    "/yr",
];

/// A student or trainee role in the title is employment, never interim work.
pub(crate) const STUDENT_ROLES: &[&str] = &[
    "werkstudent",
    "werkstudierende",
    "praktikant",
    "praktikum",
    "pflichtpraktikum",
    "working student",
    "internship",
    "intern ",
    "trainee",
    "auszubildende",
    "ausbildung zum",
    "ausbildung zur",
];

/// A permanent position denied (`this is not a permanent position`).
pub(crate) const PERMANENT_NEGATED: &[&str] = &[
    "not a permanent",
    "no permanent",
    "keine festanstellung",
    "nicht um eine festanstellung",
    "keine feste anstellung",
];

/// A permanent position only as a later option (`Übernahme in eine Festanstellung denkbar`).
pub(crate) const PERMANENT_OPTION: &[&str] = &[
    "ubernahme in eine festanstellung",
    "ubernahme in festanstellung",
    "option auf festanstellung",
    "option auf eine festanstellung",
    "spatere festanstellung",
    "anschliessende festanstellung",
    "possibility of a permanent",
    "option of a permanent",
    "temp-to-perm",
    "temp to perm",
];

/// Values of a page's employment type field (exact, folded) that mean a limited engagement:
/// LinkedIn's "Befristet", "Contract", "Temporary", the freelance portals' "Freiberuflich".
pub(crate) const LIMITED_CONTRACT_VALUES: &[&str] = &[
    "befristet",
    "contract",
    "temporary",
    "temporar",
    "freiberuflich",
    "freelance",
    "selbststandig",
    "serviceorientier",
    "self-employed",
];

/// Indirect hints of a permanent position (benefits, work permit, career page).
pub(crate) const PERMANENT_HINTS: &[&str] = &[
    "why join",
    "work permit",
    "arbeitserlaubnis",
    "aufenthaltstitel",
    "tage urlaub",
    "urlaubstage",
    "days of vacation",
    "vacation days",
    "altersvorsorge",
    "company pension",
    "pension scheme",
    "jobrad",
    "dienstwagen",
    "firmenwagen",
    "company car",
    "probezeit",
    "karriereseite",
    "career page",
    "gehaltsvorstellung",
    "salary expectation",
];

/// A staffing agency writing for a client.
pub(crate) const AGENCY_CUES: &[&str] = &[
    "personaldienstleist",
    "personalvermittl",
    "personalberatung",
    "fur unseren kunden",
    "im auftrag unseres kunden",
    "our client",
    "on behalf of our client",
    "staffing",
    "recruitment agency",
];
