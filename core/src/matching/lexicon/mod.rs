//! Words and patterns the engine looks for in job ads and profiles.
//!
//! external contract - do not translate: everything in this module is German or English
//! wording of job ads and consultant profiles (German JSON keys of the profile format).

pub(crate) mod domains;
pub(crate) mod engine;
mod tables;
pub(crate) mod terms;
pub(crate) mod wishes;

pub(crate) use tables::*;

/// Heading prefixes checked after the exact heading lists, in this order.
pub(crate) const HEADING_PREFIXES: &[(&str, HeadingKind)] = &[
    ("anforderung", HeadingKind::Must),
    ("ihr profil", HeadingKind::Must),
    ("dein profil", HeadingKind::Must),
    ("qualifikation", HeadingKind::Must),
    ("voraussetzung", HeadingKind::Must),
    ("wünschenswert", HeadingKind::Nice),
    ("wuenschenswert", HeadingKind::Nice),
    ("von vorteil", HeadingKind::Nice),
];

/// What a heading line opens.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeadingKind {
    Must,
    Nice,
    Task,
    Neutral,
}

/// Characters that start a bullet line.
pub(crate) const BULLETS: &[char] = &['-', '*', '•', '·', '▸', '►'];

/// Suffixes that turn a language token into the language (`deutschkenntnisse` -> `deutsch`).
pub(crate) const LANGUAGE_SUFFIXES: &[&str] = &[
    "kenntnisse",
    "kenntnis",
    "sprache",
    "sprachen",
    "sprachkenntnisse",
];

/// Inline headings (`Anforderungen: ...`). `{S}` is Python's whitespace class.
pub(crate) const INLINE_HEADING: &str = r"^{S}*(ihr profil|dein profil|anforderung(?:en)?|qualifikation(?:en)?|voraussetzung(?:en)?|wünschenswert|wuenschenswert|ihre aufgaben|deine aufgaben|aufgaben|wir bieten|über uns){S}*[:：]{S}+(.+)$";

/// Requirement cues in a sentence (fallback without requirement sections).
pub(crate) const CUE_HARD: &str = r"\b(?:vorausgesetzt|erforderlich|benötigt|benoetigt|setzen{S}+wir{S}+voraus|setzt{S}+{NS}+{S}+voraus|voraussetzung{S}+ist|erwarten{S}+wir|abgeschlossenes{S}+studium|studium|hochschulabschluss|abschluss|abgeschlossene{S}+ausbildung|ausbildung|zertifizierung|zertifikat|zertifiziert|mehrjährig|mehrjaehrig|langjährig|langjaehrig|verhandlungssicher|fließend|fliessend|muttersprachlich|sprachkenntnisse|sicherer{S}+umgang|fundierte{S}+kenntnisse|umfassende{S}+kenntnisse|sehr{S}+gute{S}+kenntnisse|gute{S}+kenntnisse|tiefgehende{S}+kenntnisse|praxiserfahrung|berufserfahrung)\b";
/// `Erfahrung ... in/mit/im/von` within 40 characters.
pub(crate) const CUE_EXPERIENCE: &str =
    r"\b(?:erfahrung|erfahrungen|kenntnis|kenntnisse)\b.{0,40}\b(?:in|mit|im|von)\b";
/// Marks a cue sentence as nice-to-have.
pub(crate) const CUE_NICE: &str = r"\b(?:von{S}+vorteil|nice{S}+to{S}+have|nice-to-have|wünschenswert|wuenschenswert|idealerweise|vorteilhaft|bonus)\b";

/// Profile keys of the explicit list pass: top-level list and the item keys read from it.
pub(crate) const PROFILE_LISTS: &[(&str, &[&str])] = &[
    ("methoden_tools", &["name", "kompetenz"]),
    ("zertifizierungen", &["name", "zertifizierung"]),
    ("branchen", &["branche"]),
    ("sprachen", &["sprache"]),
    ("kernkompetenzen", &["kompetenz"]),
    ("alleinstellungsmerkmale", &[]),
    ("keywords", &[]),
];

/// Profile keys of the hard criteria.
pub(crate) const KEY_CRITERIA: &str = "harte_kriterien";
pub(crate) const KEY_PREFERENCES: &str = "einsatzpraeferenzen";
pub(crate) const KEY_MIN_RATE: &str = "min_tagessatz";
pub(crate) const KEY_RATE_FROM: &str = "tagessatz_ab";
pub(crate) const KEY_COUNTRIES: &str = "laender";
pub(crate) const KEY_EXCLUDED_CONTRACTS: &str = "ausgeschlossene_vertragsarten";
pub(crate) const KEY_AVAILABLE: &str = "verfuegbar_ab";
pub(crate) const KEY_REMOTE_OUTSIDE: &str = "remote_ausserhalb_erlaubt";
/// Keys of the engine, German first, English aliases after (missing = rule off).
pub(crate) const KEY_CRITERIA_ALIASES: &[&str] = &[KEY_CRITERIA, "hard_criteria"];
pub(crate) const KEYS_MIN_SALARY: &[&str] =
    &["min_jahresgehalt", "min_annual_salary", "min_salary"];
pub(crate) const KEYS_PERMANENT_PLACES: &[&str] = &[
    "festanstellung_orte",
    "permanent_locations",
    "permanent_places",
];
pub(crate) const KEYS_PERMANENT_REMOTE: &[&str] =
    &["festanstellung_remote_min", "permanent_remote_min"];
/// The minimum years an ad had to ask for (engine 17 and before). Read no more: the years
/// an ad asks for are judged against `berufserfahrung_jahre` (engine 18). Still a known key,
/// so a file that has it loads without a warning, and saving keeps it where it is.
pub(crate) const KEYS_RETIRED_TARGET_YEARS: &[&str] = &["zielprofil_min_jahre", "target_min_years"];
/// Days per week (1 to 5) the consultant works at least and at most.
pub(crate) const KEYS_WORKLOAD_MIN: &[&str] = &["auslastung_min_tage", "workload_min_days"];
pub(crate) const KEYS_WORKLOAD_MAX: &[&str] = &["auslastung_max_tage", "workload_max_days"];
/// Minimum duration of an engagement in months.
pub(crate) const KEYS_MIN_MONTHS: &[&str] = &["min_laufzeit_monate", "min_duration_months"];
/// Words that exclude an ad (a list or one text).
pub(crate) const KEYS_EXCLUSION_WORDS: &[&str] =
    &["ausschlusswoerter", "ausschlusswörter", "exclusion_words"];
/// The old criteria under their German and English names (read in `harte_kriterien` and
/// `hard_criteria`).
pub(crate) const KEYS_MIN_RATE: &[&str] = &[KEY_MIN_RATE, "min_day_rate"];
pub(crate) const KEYS_COUNTRIES: &[&str] = &[KEY_COUNTRIES, "countries"];
pub(crate) const KEYS_EXCLUDED_CONTRACTS: &[&str] =
    &[KEY_EXCLUDED_CONTRACTS, "excluded_contract_types"];
pub(crate) const KEYS_REMOTE_OUTSIDE: &[&str] = &[KEY_REMOTE_OUTSIDE, "remote_outside_allowed"];
pub(crate) const KEYS_AVAILABLE: &[&str] = &[KEY_AVAILABLE, "available_from"];
/// Every key a criteria section may hold (others are reported as not evaluated).
pub(crate) const KEYS_ALL_CRITERIA: &[&[&str]] = &[
    KEYS_MIN_RATE,
    KEYS_COUNTRIES,
    KEYS_EXCLUDED_CONTRACTS,
    KEYS_REMOTE_OUTSIDE,
    KEYS_AVAILABLE,
    KEYS_MIN_SALARY,
    KEYS_PERMANENT_PLACES,
    KEYS_PERMANENT_REMOTE,
    KEYS_RETIRED_TARGET_YEARS,
    KEYS_WORKLOAD_MIN,
    KEYS_WORKLOAD_MAX,
    KEYS_MIN_MONTHS,
    KEYS_EXCLUSION_WORDS,
];
/// Top-level total years of experience.
pub(crate) const KEYS_TOTAL_YEARS: &[&str] = &[
    "berufserfahrung_jahre",
    "years_of_experience",
    "total_years",
];
/// Alternative terms of a competence entry.
pub(crate) const KEYS_ALIASES: &[&str] = &["auch", "aliases"];
/// Core competences the consultant wants to be booked for (top level, 3-5 entries).
pub(crate) const KEYS_FOCUS: &[&str] = &["schwerpunkte", "focus_areas"];
/// Target roles (top level).
pub(crate) const KEYS_TARGET_ROLES: &[&str] = &["wunschrollen", "target_roles"];
/// The section of the wishes (it also holds the old `tagessatz_ab` and `verfuegbar_ab`).
pub(crate) const KEY_PREFERENCES_ALIASES: &[&str] = &[KEY_PREFERENCES, "preferences"];
/// Wishes inside that section.
pub(crate) const KEYS_RATE_WISH: &[&str] = &["tagessatz_wunsch", "desired_day_rate"];
pub(crate) const KEYS_REMOTE_WISH: &[&str] = &["remote"];
pub(crate) const KEYS_REGIONS: &[&str] = &["regionen", "regions"];
pub(crate) const KEYS_INDUSTRIES: &[&str] = &["branchen", "industries"];
/// Item fields that name a competence when a list holds objects.
pub(crate) const KEYS_ITEM_TEXT: &[&str] = &["kompetenz", "name", "rolle", "titel"];
/// Contract type value meaning temporary agency work (ANÜ).
pub(crate) const CONTRACT_ANUE: &str = "anue";
/// Availability value meaning "immediately".
pub(crate) const AVAILABLE_NOW: &str = "sofort";

/// Membership test in a sorted table.
pub(crate) fn contains(table: &[&str], word: &str) -> bool {
    table.binary_search(&word).is_ok()
}

/// Canonical form of a token: `Some(None)` drops it, `None` keeps it unchanged.
#[allow(clippy::option_option)] // Mirrors the old table, where `None` is a value.
pub(crate) fn synonym(token: &str) -> Option<Option<&'static str>> {
    SYNONYM_WORDS
        .binary_search_by(|(k, _)| k.cmp(&token))
        .ok()
        .map(|i| SYNONYM_WORDS[i].1)
}

/// Merged token of an adjacent pair.
pub(crate) fn synonym_pair(first: &str, second: &str) -> Option<&'static str> {
    SYNONYM_PAIRS
        .binary_search_by(|(a, b, _)| (*a, *b).cmp(&(first, second)))
        .ok()
        .map(|i| SYNONYM_PAIRS[i].2)
}
