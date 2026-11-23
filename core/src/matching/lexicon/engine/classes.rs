//! Word classes: languages, soft skills, frames, degrees, licences and years.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Language stems and their canonical name.
pub(crate) const LANGUAGES: &[&str] = &[
    "deutsch",
    "englisch",
    "franzosisch",
    "spanisch",
    "italienisch",
    "niederlandisch",
    "polnisch",
    "russisch",
    "chinesisch",
    "portugiesisch",
    "turkisch",
    "tschechisch",
    "ungarisch",
    "rumanisch",
    "schwedisch",
    "danisch",
    "norwegisch",
    "finnisch",
    "griechisch",
    "japanisch",
    "arabisch",
    "koreanisch",
    "kroatisch",
];

/// English names of languages (whole words) and their stem in `LANGUAGES`.
pub(crate) const LANGUAGE_NAMES: &[(&str, &str)] = &[
    ("german", "deutsch"),
    ("english", "englisch"),
    ("french", "franzosisch"),
    ("spanish", "spanisch"),
    ("italian", "italienisch"),
    ("dutch", "niederlandisch"),
    ("flemish", "niederlandisch"),
    ("polish", "polnisch"),
    ("russian", "russisch"),
    ("chinese", "chinesisch"),
    ("mandarin", "chinesisch"),
    ("portuguese", "portugiesisch"),
    ("turkish", "turkisch"),
    ("czech", "tschechisch"),
    ("hungarian", "ungarisch"),
    ("romanian", "rumanisch"),
    ("swedish", "schwedisch"),
    ("danish", "danisch"),
    ("norwegian", "norwegisch"),
    ("finnish", "finnisch"),
    ("greek", "griechisch"),
    ("japanese", "japanisch"),
    ("arabic", "arabisch"),
    ("korean", "koreanisch"),
    ("croatian", "kroatisch"),
];

/// Language level words (case-folded, without umlauts) and CEFR level 1 (A1) .. 7 (native).
pub(crate) const LEVEL_WORDS: &[(&str, u8)] = &[
    ("a1", 1),
    ("a2", 2),
    ("b1", 3),
    ("b2", 4),
    ("c1", 5),
    ("c2", 6),
    ("grundkenntnisse", 2),
    ("basic", 2),
    ("gute", 4),
    ("gut", 4),
    ("good", 4),
    ("sehr gute", 5),
    ("verhandlungssicher", 5),
    ("verhandlungssichere", 5),
    ("fliessend", 5),
    ("fliessende", 5),
    ("fluent", 5),
    ("business fluent", 5),
    ("proficient", 5),
    ("muttersprache", 7),
    ("muttersprachlich", 7),
    ("muttersprachliche", 7),
    ("native", 7),
    ("mother tongue", 7),
];

/// Soft skills: weight 250, cannot be proven from a profile (prefix stems, sorted).
pub(crate) const SOFT_SKILLS: &[&str] = &[
    "analytical",
    "analytisch",
    "auffassungsgabe",
    "auftreten",
    "belastbar",
    "communication",
    "durchsetzung",
    "durchsetzungsstark",
    "eigeninitiative",
    "eigenstandig",
    "empathie",
    "engagement",
    "flexibilit",
    "freude",
    "gelassen",
    "gespur",
    "gestaltungswill",
    "hands-on-mental",
    "humor",
    "kommunikation",
    "kommunikationsstark",
    "kommunikativ",
    "konfliktfahig",
    "kundenorientier",
    "losungsorientier",
    "mentalitat",
    "mentality",
    "mitarbeiterorientier",
    "motivation",
    "neugier",
    "organisationsfahig",
    "organisationstalent",
    "organisatorisch",
    "pragmatisch",
    "prasentationsfahig",
    "prasentationsstark",
    "proaktiv",
    "problemlosung",
    "reliable",
    "resilienz",
    "selbststandig",
    "serviceorientier",
    "sorgfalt",
    "sozialkompetenz",
    "stressresistenz",
    "structured",
    "strukturiert",
    "teamfahig",
    "teamplayer",
    "uberzeugungskraft",
    "umsetzungsstark",
    "unternehmerisch",
    "verantwortungsbewusst",
    "verantwortungsbewusstsein",
    "verbindlich",
    "verhandlungsfahig",
    "verhandlungsgeschick",
    "verhandlungsstark",
    "vertriebsorientier",
    "wertschatz",
    "wertschatzend",
    "zahlenaffin",
    "zahlenverstandnis",
    "zuhor",
    "zuverlassig",
];

/// Frame conditions: weight 0 (travel, availability, presence, driving licence) (prefix
/// stems, sorted).
pub(crate) const FRAME_WORDS: &[&str] = &[
    "auslastung",
    "availability",
    "beauftragung",
    "bereitschaft",
    "dauer",
    "duration",
    "einsatzort",
    "freelancer",
    "fuhrerschein",
    "gehalt",
    "honorar",
    "hybrid",
    "laufzeit",
    "location",
    "monday",
    "on-site",
    "onsite",
    "permanent",
    "prasenz",
    "rate",
    "reise",
    "reisebereitschaft",
    "remote",
    "salary",
    "standort",
    "start",
    "stundensatz",
    "tagessatz",
    "teilzeit",
    "travel",
    "verfugbar",
    "vergutung",
    "verlangerung",
    "vertragsart",
    "vollzeit",
    "vor-ort-anteil",
    "vor-ort-prasenz",
    "willingness",
    "workload",
];

/// Heads that keep a frame word a frame (`Reisebereitschaft`, `Startdatum`,
/// `Gehaltsvorstellung`, `Remote-Arbeit`) (sorted).
pub(crate) const FRAME_HEADS: &[&str] = &[
    "aktivitat",
    "anteil",
    "arbeit",
    "basis",
    "bereit",
    "date",
    "datum",
    "days",
    "dienst",
    "expectation",
    "expectations",
    "first",
    "freudig",
    "freudigkeit",
    "klasse",
    "model",
    "modell",
    "option",
    "paket",
    "pflicht",
    "presence",
    "quote",
    "range",
    "requirement",
    "requirements",
    "share",
    "tag",
    "tage",
    "tatigkeit",
    "termin",
    "time",
    "vorstellung",
    "work",
    "working",
    "zeit",
    "zeiten",
    "zeitpunkt",
    "zeitraum",
];

/// Skill heads after an English frame word: the frame word is then a modifier
/// (`Hybrid Cloud`, `Travel Management`, `Salary Benchmarking`) (sorted).
pub(crate) const FRAME_MODIFIED_HEADS: &[&str] = &[
    "accounting",
    "administration",
    "analysis",
    "analytics",
    "architecture",
    "audit",
    "audits",
    "banding",
    "bands",
    "benchmark",
    "benchmarking",
    "cloud",
    "compliance",
    "controlling",
    "design",
    "governance",
    "infrastructure",
    "integration",
    "management",
    "manager",
    "migration",
    "modeling",
    "modelling",
    "monitoring",
    "negotiation",
    "negotiations",
    "operations",
    "optimisation",
    "optimization",
    "planning",
    "policies",
    "policy",
    "process",
    "processes",
    "program",
    "programme",
    "reporting",
    "review",
    "reviews",
    "services",
    "solution",
    "solutions",
    "sourcing",
    "strategy",
    "structure",
    "structures",
    "survey",
    "surveys",
    "system",
    "systems",
];

/// Modifiers that make a compound ending in a frame word a skill (`Online-Präsenz`).
pub(crate) const NOT_FRAME_MODIFIERS: &[&str] = &[
    "brand", "digital", "internet", "markt", "medien", "online", "social", "web",
];

/// An item naming compensation work is a skill, not a frame (`Vergütung und Benefits`).
pub(crate) const FRAME_SKILL_CONTEXT: &[&str] = &[
    "benefit",
    "compensation",
    "entgelt",
    "grading",
    "payroll",
    "reward",
    "tarif",
];

/// Heads that keep a soft word soft (`Kommunikationsfähigkeit`, `analytisches Denken`)
/// (sorted).
pub(crate) const SOFT_HEADS: &[&str] = &[
    "approach",
    "arbeiten",
    "arbeitsweise",
    "art",
    "attitude",
    "auftreten",
    "denken",
    "denkvermogen",
    "denkweise",
    "fahigkeit",
    "fahigkeiten",
    "geschick",
    "kompetenz",
    "kompetenzen",
    "manner",
    "mindset",
    "personlichkeit",
    "skill",
    "skills",
    "starke",
    "starken",
    "style",
    "talent",
    "thinking",
    "vermogen",
    "vorgehen",
    "vorgehensweise",
];

/// Words of the setting of a role, like an industry (`produzierender Unternehmen`,
/// `Mittelstand`, `Konzernumfeld`): never its function (atom prefixes, folded).
// external contract - do not translate (matching lexicon)
pub(crate) const SETTING_WORDS: &[&str] = &[
    "eigentumergefuhrt",
    "fertigend",
    "industriell",
    "konzern",
    "manufacturing",
    "mittelstand",
    "produzierend",
];

/// Formal requirements: degrees (prefix stems; a bare `Abschluss` is also a financial
/// statement, so it does not count).
pub(crate) const DEGREE_WORDS: &[&str] = &[
    "b.sc",
    "bachelor",
    "bsc",
    "degree",
    "diplom",
    "doctorate",
    "hochschulabschluss",
    "m.sc",
    "master",
    "msc",
    "ph.d",
    "phd",
    "promotion",
    "promoviert",
    "staatsexamen",
    "staatsexamina",
    "studium",
    "university",
];

/// Words that make `Promotion` sales work, not a doctorate (`Sales Promotion`).
pub(crate) const PROMOTION_NOT_DEGREE: &[&str] = &[
    "handel",
    "marketing",
    "sales",
    "trade",
    "verkauf",
    "vertrieb",
];

/// Words after `master` that make it no degree (`Master Data Management`).
pub(crate) const MASTER_NOT_DEGREE: &[&str] = &["data", "daten", "file", "plan", "record"];

/// Degree fields: stems in a requirement or profile degree -> field id. A match inside a
/// longer match (`informatik` in `wirtschaftsinformatik`) does not count.
pub(crate) const DEGREE_FIELDS: &[(&str, &str)] = &[
    ("betriebswirt", "business"),
    ("bwl", "business"),
    ("business administration", "business"),
    ("business", "business"),
    ("kauffrau", "business"),
    ("kaufmann", "business"),
    ("okonom", "business"),
    ("economics", "business"),
    ("volkswirt", "business"),
    ("accounting", "business"),
    ("wirtschaftsinformat", "business-it"),
    ("business informatics", "business-it"),
    ("information systems", "business-it"),
    ("wirtschaftswissenschaft", "business"),
    ("finance", "business"),
    ("informatik", "it"),
    ("computer science", "it"),
    ("wirtschaftsingenieur", "business-engineering"),
    ("ingenieur", "engineering"),
    ("engineering", "engineering"),
    ("maschinenbau", "engineering"),
    ("elektrotechnik", "engineering"),
    ("verfahrenstechnik", "engineering"),
    ("technisches studium", "engineering"),
    ("rechtswissenschaft", "law"),
    ("jurist", "law"),
    ("jura", "law"),
    ("mathematik", "science"),
    ("physik", "science"),
    ("naturwissenschaft", "science"),
    ("natural science", "science"),
    ("rer. nat", "science"),
    ("rer.nat", "science"),
    ("pharmaz", "life-science"),
    ("pharmacy", "life-science"),
    ("pharmaceutical science", "life-science"),
    ("apothek", "life-science"),
    ("chemie", "life-science"),
    ("chemistry", "life-science"),
    ("biolog", "life-science"),
    ("biochem", "life-science"),
    ("biotechnolog", "life-science"),
    ("life science", "life-science"),
    ("lebenswissenschaft", "life-science"),
    // Fields of the other domain packs (data, HR, operations, software, marketing).
    ("statistik", "science"),
    ("statistics", "science"),
    ("medizin", "medicine"),
    ("medicine", "medicine"),
    ("medizintechnik", "engineering"),
    ("mechatronik", "engineering"),
    ("produktionstechnik", "engineering"),
    ("fertigungstechnik", "engineering"),
    ("fahrzeugtechnik", "engineering"),
    ("psycholog", "psychology"),
    ("softwaretechnik", "it"),
    ("software engineering", "it"),
    ("data science", "it"),
    ("marketing", "business"),
];

/// Neighbouring degree fields: a degree in one half-meets a requirement for the other.
pub(crate) const DEGREE_RELATED: &[(&str, &str)] = &[
    ("science", "life-science"),
    ("business", "business-it"),
    ("it", "business-it"),
    ("business", "business-engineering"),
    ("engineering", "business-engineering"),
];

/// Degree levels: 1 bachelor, 2 master or university diploma, 3 doctorate.
pub(crate) const DEGREE_LEVELS: &[(&str, u8)] = &[
    ("bachelor", 1),
    ("b.sc", 1),
    ("b. sc", 1),
    ("master", 2),
    ("m.sc", 2),
    ("m. sc", 2),
    ("mba", 2),
    ("diplom", 2),
    ("magister", 2),
    ("staatsexamen", 2),
    ("staatsexamina", 2),
    ("promotion", 3),
    ("phd", 3),
];

/// A university of applied sciences or a dual study: a diploma is a bachelor level.
pub(crate) const DEGREE_APPLIED: &[&str] = &[
    "(fh)",
    "(ba)",
    "fachhochschul",
    "duale hochschule",
    "berufsakademie",
];

/// Words of a certificate (`Six Sigma Black Belt Zertifizierung`, `Pega Certified`).
pub(crate) const CERTIFICATE_WORDS: &[&str] = &[
    "certification",
    "certified",
    "zertifikat",
    "zertifizierung",
    "zertifiziert",
];

/// Licences and admissions that cannot be acquired within a project.
pub(crate) const LICENCE_WORDS: &[&str] = &[
    "steuerberater",
    "wirtschaftsprufer",
    "rechtsanwalt",
    "volljurist",
    "approbation",
    "certified public accountant",
    "chartered accountant",
    "qualified person",
    "sachkundige person",
    "sachkundigen person",
];

/// Names of the same licence: a profile holding one meets a requirement for another.
pub(crate) const LICENCE_SYNONYMS: &[&[&str]] = &[&[
    "qualified person",
    "sachkundige person",
    "sachkundigen person",
    "sachkundiger person",
    "qp",
]];

/// A licence word counts only as a qualification (`Zulassung als ...`, `... examen`).
pub(crate) const LICENCE_CONTEXT: &[&str] = &[
    "amg",
    "(qp)",
    "zulassung",
    "bestellung",
    "examen",
    "titel",
    "qualifikation",
    "als ",
    "license",
    "licence",
    "qualified",
    "volljurist",
    "approbation",
];

/// A degree requirement that accepts any comparable degree.
pub(crate) const COMPARABLE_WORDS: &[&str] = &["vergleichbar", "comparable", "equivalent"];

/// General experience, compared with the profile's total years.
pub(crate) const GENERAL_EXPERIENCE: &[&str] =
    &["berufserfahrung", "berufspraxis", "praxis", "professional"];

/// Year units after a number (`10 Jahre`, `8 years`).
pub(crate) const YEAR_UNITS: &[&str] = &["jahr", "year"];

/// Words that open a part of the years a line stated before them (`Mehrjährige Erfahrung,
/// davon mindestens drei Jahre in ...`): the years after them are no minimum of the ad.
pub(crate) const YEARS_SUBSPAN: &[&str] = &["davon", "hiervon", "darunter", "thereof", "including"];

/// Experience statements: words and bounds.
pub(crate) const EXPERIENCE_WORDS: &[&str] = &["erfahrung", "experience", "praxis"];

/// A minimum of years without the word experience (`Min. 5 years in ...`).
/// `5+ years` and `5+ Jahre` are minimums too.
pub(crate) const MIN_MARKERS: &[&str] = &[
    "min.",
    "mind.",
    "mindestens",
    "at least",
    "minimum",
    "+ year",
    "+ jahr",
];
