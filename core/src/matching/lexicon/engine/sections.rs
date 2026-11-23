//! Section headings, prefixes, listings and closing lines.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Headings that are a portal's tag list, not the ad's requirements (whole heading).
pub(crate) const TAG_HEADINGS: &[&str] = &["skills"];

/// Extra must headings (normalised heading prefixes).
pub(crate) const MUST_PREFIXES: &[&str] = &[
    "ihre qualifikation",
    "deine qualifikation",
    "your profile",
    "what you bring",
    "requirements",
    "your skills",
    "must-have",
    "must have",
    "anforderungsprofil",
    "profil",
    "muss-anforderung",
    "mussanforderung",
    "muss-kriteri",
    "musskriteri",
];

/// Extra nice headings.
pub(crate) const NICE_PREFIXES: &[&str] = &[
    "preferred",
    "nice to have",
    "nice-to-have",
    "good to have",
    "a plus",
    "soll-anforderung",
    "sollanforderung",
    "soll-kriteri",
    "sollkriteri",
    "kann-anforderung",
    "kannanforderung",
    "kann-kriteri",
    "kannkriteri",
];

/// Headings (folded) of the other listings a portal shows under an ad: nothing below them
/// belongs to the ad, so no hard criterion (ANÜ, country, rate, permanent role, seniority)
/// is read from there.
pub(crate) const OTHER_LISTINGS: &[&str] = &[
    "ahnliche projekte",
    "ahnliche jobs",
    "ahnliche stellen",
    "ahnliche stellenangebote",
    "weitere projekte",
    "weitere jobs",
    "weitere stellen",
    "andere projekte",
    "similar projects",
    "similar jobs",
    "more jobs",
    "people also viewed",
];

/// What may follow a heading of `OTHER_LISTINGS` on its line (folded): a portal's link
/// text or the listings' owner.
pub(crate) const LISTING_TAILS: &[&str] = &[
    "anzeigen",
    "dieses anbieters",
    "des anbieters",
    "fur dich",
    "for you",
];

/// Headings that end requirement sections.
pub(crate) const OTHER_PREFIXES: &[&str] = &[
    "rahmenbedingungen",
    "konditionen",
    "eckdaten",
    "wir bieten",
    "what we offer",
    "about",
    "benefits",
    "zum ablauf",
    "bewerbung",
    "your responsibilities",
    "responsibilities",
    "why join",
    "why us",
    "your benefits",
    "unser angebot",
    "das bieten wir",
    "ihre aufgaben",
    "deine aufgaben",
    "projektbeschreibung",
    "ausgangslage",
    "das programmteam",
    // Frame blocks and portal footers (they are no requirements).
    "engagement details",
    "compensation",
    "conditions",
    "project details",
    "projektdaten",
    "projektdetails",
    "key facts",
    "the role",
    "your mission",
    "what you will do",
    "rahmendaten",
    "vertragsdetails",
    "contract details",
    "details",
    "eckpunkte",
    "sonstiges",
    "seniority level",
    "employment type",
    "job function",
    "industries",
    "bitte beachten",
    "terms",
    "rahmen",
    "weitere infos",
    "weitere informationen",
    "kategorien",
    "tags",
    // Portal chrome after the ad (the provider, more projects).
    "projektanbieter",
    "weitere projekte",
    "ahnliche projekte",
    "similar projects",
    "similar jobs",
    "ahnliche jobs",
    // Portal footers and meta lines.
    "projekt-id",
    "projekt id",
    "projektnummer",
    "projekt-nr",
    "referenznummer",
    "kennziffer",
    "job-id",
    "eingestellt am",
    "veroffentlicht am",
    "online seit",
    "branche",
    "kategorie",
    "karrierestufe",
    "beschaftigungsverhaltnis",
    "tatigkeitsbereich",
];

/// Nice cues that close a line (`X und Y von Vorteil`): the whole line is nice.
pub(crate) const NICE_CLOSING: &[&str] = &[
    "von vorteil",
    "wunschenswert",
    "a plus",
    "ein plus",
    "strong plus",
    "nice to have",
    "nice-to-have",
    "vorteilhaft",
    "bonus",
    "an advantage",
    "advantageous",
    "hilfreich",
    "grosses plus",
    "an asset",
    "klarer vorteil",
    "preferred",
    "is a plus",
];

/// Separators of the parts of one line (`Start: 02/2027 · Dauer: 10 Monate · 78 €/h`).
pub(crate) const SEGMENT_SEPARATORS: &[&str] = &[" // ", " · ", " | ", " • "];

/// A contract type line (`Vertragsart: Festanstellung`).
pub(crate) const CONTRACT_LINES: &[&str] = &["vertragsart:", "anstellungsart:", "employment type:"];

/// Lines that name a work location.
pub(crate) const LOCATION_LINES: &[&str] = &[
    "standort",
    "einsatzort",
    "arbeitsort",
    "dienstort",
    "location",
    "ort:",
];

/// Closing lines of an ad: they end a requirement section.
/// Lines that end requirements from their start on (portal tags, notices, application and
/// privacy text); a requirement may name these words later in the line.
pub(crate) const CLOSING_STARTS: &[&str] = &[
    "skills:",
    "tags:",
    "kategorien:",
    "kategorie:",
    "keywords:",
    "schlagworte:",
    "hinweis",
    "please note",
    "bitte senden sie",
    "wir melden uns",
    "datenschutz",
    "bei interesse",
    "interesse?",
    "haben wir ihr interesse",
    "sind sie aktuell verfugbar",
    "dann melden sie sich",
    "bewerbung:",
    "fur ihre bewerbung",
    "kontakt:",
    "kontaktperson",
    "ihr kontakt",
    "ihr ansprechpartner",
    "ihre ansprechpartnerin",
    "©",
];

pub(crate) const CLOSING_WORDS: &[&str] = &[
    "interessiert?",
    "interesse geweckt",
    "viele grusse",
    "freundlichen grussen",
    "freuen wir uns auf",
    "freuen uns auf",
    "bitte beachten sie",
    "we look forward",
    "look forward to hearing",
    "freue mich auf",
    "freue ich mich",
    "jetzt bewerben",
    "apply now",
    "beste grusse",
    "besten grussen",
    "liebe grusse",
    "herzliche grusse",
    "kind regards",
    "best regards",
    "datenschutzerklarung",
    "vertraulich behandeln",
];
