//! Start, duration, deadline and workload words.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Words of a sentence that states a duration: whole words (with a plural ending), no other
/// compounds (`Einarbeitungsdauer`, `Anfahrtsdauer` and `dauerhaft` state none).
pub(crate) const DURATION_TERMS: &[&str] = &[
    "laufzeit",
    "projektlaufzeit",
    "vertragslaufzeit",
    "mindestlaufzeit",
    "gesamtlaufzeit",
    "einsatzlaufzeit",
    "dauer",
    "projektdauer",
    "einsatzdauer",
    "vertragsdauer",
    "auftragsdauer",
    "mandatsdauer",
    "gesamtdauer",
    "zeitraum",
    "einsatzzeitraum",
    "projektzeitraum",
    "befristet",
    "befristung",
    "duration",
    "length",
];

pub(crate) const MONTH_UNITS: &[&str] = &["monat", "month"];

/// Separators of the clauses of a duration sentence (`Start October 2026, 12 months`).
pub(crate) const DURATION_CLAUSE_BREAKS: &[char] = &[',', ';', '|', '·', '(', ')'];

/// Words of a clause that is only a duration (`6 Monate mit Option auf Verlängerung`).
pub(crate) const DURATION_FILLERS: &[&str] = &[
    "ca",
    "circa",
    "rund",
    "etwa",
    "zunachst",
    "vorerst",
    "voraussichtlich",
    "mindestens",
    "min",
    "max",
    "approx",
    "initially",
    "initial",
    "mit",
    "with",
    "option",
    "optional",
    "auf",
    "plus",
    "verlangerung",
    "verlangerungsoption",
    "verlangerbar",
    "extension",
    "extendable",
    "possible",
    "moglich",
    "und",
    "and",
    "oder",
    "or",
    "bis",
    "to",
    "zu",
    "geplant",
    "planned",
    "weitere",
    "further",
];

/// Words between a duration phrase's head and its amount (`für ca. 3-6 Monate`).
pub(crate) const DURATION_QUALIFIERS: &[&str] = &[
    "ca",
    "circa",
    "rund",
    "etwa",
    "zunachst",
    "vorerst",
    "voraussichtlich",
    "insgesamt",
    "mindestens",
    "min",
    "max",
    "maximal",
    "approx",
    "approximately",
    "initially",
    "about",
    "around",
    "at",
    "least",
    "bis",
    "zu",
    "to",
    "oder",
    "or",
    "und",
    "and",
];

/// Words before an amount that make it a lead time (`Start in 2 Wochen`, `nach 4 Wochen`,
/// `within 4 weeks`), never a duration.
pub(crate) const DURATION_LEAD_WORDS: &[&str] = &[
    "in",
    "innerhalb",
    "binnen",
    "nach",
    "within",
    "after",
    "vor",
    "seit",
    "since",
    "ago",
    "alle",
    "every",
    "each",
    "jede",
    "jeden",
    "jedes",
    "spatestens",
    "fruhestens",
];

/// Parts of the word before an amount or of the two after its unit that make it a notice
/// period, a lead time or another span (`Kündigungsfrist 2 Wochen`, `4 Wochen Vorlauf`,
/// `Probezeit 6 Monate`, `2 Wochen Einarbeitung`), never the duration.
pub(crate) const DURATION_LEAD_PARTS: &[&str] = &[
    "frist",
    "notice",
    "vorlauf",
    "kundigung",
    "probezeit",
    "urlaub",
    "vacation",
    "einarbeitung",
    "onboarding",
];

/// Parts of the two words after a unit that make the amount years of experience.
pub(crate) const DURATION_EXPERIENCE: &[&str] = &["erfahrung", "experience", "praxis"];

/// Words right before an amount (past its qualifiers) that make a duration phrase
/// (`für 6 Monate`, `for 9 months`, `über 12 Monate`, `auf 6 Monate angelegt`).
pub(crate) const DURATION_FOR: &[&str] = &["fur", "for", "uber", "over", "auf"];

/// A duration as an adjective (`ein 6-monatiges Projekt`); years as an adjective are mostly
/// experience or a degree, so they are none.
pub(crate) const DURATION_ADJECTIVES: &[&str] = &["monatig", "wochig"];

/// Where an end date is an application deadline, not the end of the engagement.
pub(crate) const DEADLINE_WORDS: &[&str] = &[
    "bewerb",
    "apply",
    "application",
    "deadline",
    "einsendeschluss",
];

/// Words that name an application deadline; the date follows them, past
/// `DEADLINE_FILLERS` only (`Bewerbungsfrist: 15.10.2026`, `apply by 31 October`). Several
/// words are one entry, split by single spaces.
pub(crate) const DEADLINE_MARKERS: &[&str] = &[
    "bewerbungsfrist",
    "bewerbungsschluss",
    "bewerbungsende",
    "einsendeschluss",
    "einsendefrist",
    "deadline",
    "application deadline",
    "applications close",
    "applications closing",
    "closing date",
];

/// Words that name applying: a deadline only with an `UNTIL_WORDS` after them, past
/// `APPLY_FILLERS` (`Bewerbungen bis 15.10.`, `bewerben Sie sich bis spätestens 15.10.2026`,
/// `please apply by 31 October`).
pub(crate) const APPLY_WORDS: &[&str] = &[
    "bewerbung",
    "bewerbungen",
    "bewerben",
    "bewirb",
    "apply",
    "application",
    "applications",
];

/// Words between an `APPLY_WORDS` and its `UNTIL_WORDS`.
pub(crate) const APPLY_FILLERS: &[&str] = &[
    "sie", "sich", "dich", "uns", "gerne", "gern", "bitte", "jetzt", "online", "ihre", "deine",
    "please", "now", "your", "for", "this", "role", "position", "are", "is", "welcome", "open",
    "accepted",
];

/// The word that ends a deadline (`bis`, `by`).
pub(crate) const UNTIL_WORDS: &[&str] = &["bis", "by", "until", "before"];

/// Words between a deadline word and its date (`Bewerbungsfrist ist der 30. Oktober`).
pub(crate) const DEADLINE_FILLERS: &[&str] = &[
    "ist",
    "der",
    "den",
    "am",
    "zum",
    "bis",
    "spatestens",
    "is",
    "the",
    "on",
    "by",
    "of",
    "until",
    "before",
    "latest",
    "at",
    "no",
    "later",
    "than",
];

/// A deadline at the end of a month (`Bewerbungen bis Ende Oktober`).
pub(crate) const MONTH_END_WORDS: &[&str] = &["ende", "end"];

/// Endings of a day number (`31st October`).
pub(crate) const DAY_SUFFIXES: &[&str] = &["st", "nd", "rd", "th"];

/// End markers in a sentence with a duration word (`Laufzeit bis 31.03.2027`), padded with
/// spaces, longest first.
pub(crate) const DURATION_END_MARKERS: &[&str] = &[
    " bis zum ende ",
    " bis ende ",
    " bis zum ",
    " bis ",
    " until the end of ",
    " until end of ",
    " until ",
    " end of ",
    " ende ",
];

/// End markers in any sentence (`Einsatz bis Ende März 2027`), padded with spaces.
pub(crate) const DURATION_END_PHRASES: &[&str] = &[
    " bis zum ende ",
    " bis ende ",
    " until the end of ",
    " until end of ",
    " till the end of ",
];

/// Workload (share of a five-day week). Words that make a percentage a workload
/// (`Auslastung 80 %`), substrings.
pub(crate) const WORKLOAD_CUES: &[&str] = &[
    "auslastung",
    "arbeitspensum",
    "pensum",
    "einsatzumfang",
    "stellenumfang",
    "beschaftigungsumfang",
    "arbeitszeit",
    "teilzeit",
    "vollzeit",
    "workload",
    "utilisation",
    "utilization",
    "capacity",
    "part-time",
    "full-time",
    "part time",
    "full time",
];

/// Full-time work (whole words or phrases).
pub(crate) const WORKLOAD_FULL: &[&str] = &[
    "vollzeit",
    "vollzeitstelle",
    "vollzeitposition",
    "vollzeittatigkeit",
    "vollzeitbeschaftigung",
    "vollauslastung",
    "volle auslastung",
    "full-time",
    "full time",
    "fulltime",
];

/// Part-time work (whole words or phrases): up to `WORKLOAD_PART` percent.
pub(crate) const WORKLOAD_PART_WORDS: &[&str] = &[
    "teilzeit",
    "teilzeitstelle",
    "teilzeittatigkeit",
    "teilzeitbeschaftigung",
    "part-time",
    "part time",
    "parttime",
];

/// Part-time only as an option (`Vollzeit, Teilzeit möglich`, `Voll- oder Teilzeit`): any
/// workload up to full time.
pub(crate) const WORKLOAD_PART_OPTION: &[&str] = &[
    "moglich",
    "possible",
    "optional",
    "denkbar",
    "voll- oder teilzeit",
    "voll- und teilzeit",
    "teil- oder vollzeit",
    "teil- und vollzeit",
];

/// Words near a number of days or a percentage that make it the place of work, not the
/// workload (`3 Tage/Woche vor Ort`, `remote 2 Tage`, `80 % remote`): whole words or phrases.
pub(crate) const WORKLOAD_PLACE_WORDS: &[&str] = &[
    "vor ort",
    "vor-ort",
    "standort",
    "zu hause",
    "zuhause",
    "from home",
    "reisebereitschaft",
    "onsite",
    "on-site",
    "on site",
    "remote",
    "homeoffice",
    "home office",
    "home-office",
    "mobil",
    "mobile",
    "mobiles",
    "mobilem",
    "buro",
    "office",
    "prasenz",
    "beim kunden",
    "at the client",
    "anwesenheit",
    "hybrid",
    "reise",
    "reisen",
    "reiseanteil",
    "reisetatigkeit",
    "travel",
];

/// Days and weeks of a workload (`3 Tage/Woche`, `4 days per week`), and the hours.
pub(crate) const WORKLOAD_DAY_UNITS: &[&str] = &["tage", "tagen", "tag", "days", "day", "pt"];

pub(crate) const WORKLOAD_HOUR_UNITS: &[&str] =
    &["stunden", "std.", "std", "hours", "hour", "hrs", "h"];

/// Words between the unit and the week (`Tage pro Woche`, `days a week`, `Tage in der Woche`).
pub(crate) const WORKLOAD_PER: &[&str] = &[
    "/", "pro", "per", "je", "in", "der", "die", "a", "each", "im", "the",
];

pub(crate) const WORKLOAD_WEEK: &[&str] = &["woche", "week", "wk"];

/// Periods after hours that make them no weekly hours (`4 Stunden pro Tag`, `8 h täglich`,
/// `40 Stunden im Monat`).
pub(crate) const WORKLOAD_OTHER_PERIODS: &[&str] = &[
    "tag",
    "tage",
    "tages",
    "taglich",
    "day",
    "days",
    "daily",
    "monat",
    "monats",
    "monatlich",
    "month",
    "monthly",
    "jahr",
    "jahrlich",
    "year",
    "yearly",
    "annually",
];

/// A clock time next to hours (`9-17 Uhr`).
pub(crate) const WORKLOAD_CLOCK: &[&str] = &["uhr"];

/// Hours per week in one word (`20 Wochenstunden`).
pub(crate) const WORKLOAD_WEEKLY_HOURS: &[&str] = &["wochenstunden", "weekly hours"];

/// Separators of a range of numbers (`3-4`, `3 bis 4`, `16 to 20`).
pub(crate) const WORKLOAD_RANGE: &[&str] = &["-", "–", "bis", "to", "oder", "or"];

pub(crate) const WEEK_UNITS: &[&str] = &["woche", "week"];

/// Sentences that state a start.
pub(crate) const START_WORDS: &[&str] = &[
    "start",
    "beginn",
    "projektstart",
    "verfugbarkeit",
    "ab sofort",
    "asap",
    "starting",
];

/// Month names -> month number (case-folded, without umlauts).
pub(crate) const MONTHS: &[(&str, i8)] = &[
    ("januar", 1),
    ("january", 1),
    ("februar", 2),
    ("february", 2),
    ("marz", 3),
    ("march", 3),
    ("april", 4),
    ("mai", 5),
    ("may", 5),
    ("juni", 6),
    ("june", 6),
    ("juli", 7),
    ("july", 7),
    ("august", 8),
    ("september", 9),
    ("oktober", 10),
    ("october", 10),
    ("november", 11),
    ("dezember", 12),
    ("december", 12),
];

/// Words meaning "start now".
pub(crate) const START_NOW: &[&str] = &["sofort", "asap", "immediately", "ab sofort"];

/// Words meaning "start to be agreed".
pub(crate) const START_VAGUE: &[&str] = &[
    "nach abstimmung",
    "nach absprache",
    "nach vereinbarung",
    "flexibel",
    "tbd",
    "to be agreed",
    "zeitnah",
];
