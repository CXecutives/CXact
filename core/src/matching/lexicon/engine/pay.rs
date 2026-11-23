//! Pay, rate and salary words.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Rate statements, units and currencies.
pub(crate) const RATE_WORDS: &[&str] = &[
    "tagessatz",
    "honorar",
    "stundensatz",
    "day rate",
    "daily rate",
    "hourly rate",
    "vergutung",
    "pro tag",
    "per day",
    "pro stunde",
    "per hour",
    "€/tag",
    "€/h",
    "stundenlohn",
    "hourly wage",
    "hourly pay",
];

/// Employment pay (an hourly wage of an employee or of temporary agency work), never a
/// freelance rate. Phrases, whole words (never inside another word: `Volkswagen`), and the
/// head of a word with an inflection (`Lohn`, `Stundenlohn`, `Bruttostundenlohn`,
/// `Mindestlöhne`; not `Lohnbuchhaltung`). `groß` folds to `gross`, so English `gross` is
/// employment pay only in a phrase.
pub(crate) const WAGE_PHRASES: &[&str] = &[
    "equal pay",
    "gross per hour",
    "per hour gross",
    "gross hourly",
    "hourly gross",
    "an hour gross",
    "/h gross",
    "/hr gross",
    "/hour gross",
];

pub(crate) const WAGE_WORDS_WHOLE: &[&str] = &["igz", "bap", "gvp", "wage", "wages"];

pub(crate) const WAGE_HEADS: &[&str] = &["lohn"];

/// A pay scale or a gross amount: employment pay unless the sentence names a freelance rate
/// (`Entgelt: 95 €/h zzgl. MwSt.` is a rate). Whole words with an inflection (`tarifliche`,
/// `Übertarifliche`, `Tarifs`; not `Tarifsystem`), phrases whose last word takes one
/// (`nach Tarifvertrages`; a `Tarifvertrag` on its own is a topic), and heads (`Entgelt`,
/// `Stundenentgelt`; not `Entgeltabrechnung`).
pub(crate) const PAY_SCALE_WORDS: &[&str] = &[
    "brutto",
    "tarif",
    "tariflich",
    "ubertariflich",
    "tarifvertraglich",
    "tarifgebunden",
    "tarifgruppe",
    "entgeltgruppe",
    "nach tarifvertrag",
    "gemass tarifvertrag",
    "laut tarifvertrag",
];

pub(crate) const PAY_SCALE_HEADS: &[&str] = &["entgelt"];

/// A freelance rate: overrules `PAY_SCALE_WORDS` (substrings).
pub(crate) const FREELANCE_RATE_WORDS: &[&str] = &[
    "stundensatz",
    "tagessatz",
    "honorar",
    "day rate",
    "daily rate",
    "freelance",
    "freiberuf",
    "zzgl",
    "mwst",
    "plus vat",
    "excl. vat",
];

pub(crate) const SALARY_WORDS: &[&str] = &[
    "gehalt",
    "salary",
    "p.a.",
    "t€",
    "per annum",
    "pro jahr",
    "per year",
    "jahresbrutto",
];

/// Currencies and rate units next to an amount (`950 €`, `EUR 950`, `95 €/h`).
pub(crate) const RATE_UNITS: &[&str] = &[
    "€",
    "eur",
    "euro",
    "chf",
    "usd",
    "gbp",
    "$",
    "£",
    "/h",
    "/std",
    "/tag",
    "/day",
    "pro tag",
    "pro stunde",
    "per day",
    "per hour",
    "k€",
];

/// Words of a rate range (`bis 1.100 €`, `ab 900`, `max. 1.000`).
pub(crate) const RATE_RANGE_WORDS: &[&str] = &[
    "maximal", "circa", "up to", "from", "rund", "max.", "max", "ca.", "ca", "bis", "von", "ab",
    "to", "zu",
];

/// A rate to be agreed, without an amount (with a rate word in the same sentence).
pub(crate) const RATE_OPEN: &[&str] = &[
    "nach absprache",
    "nach vereinbarung",
    "auf anfrage",
    "verhandelbar",
    "verhandlungssache",
    "negotiable",
    "on request",
    "to be agreed",
    "tbd",
];

pub(crate) const HOURLY_WORDS: &[&str] = &["stunde", "std", "hour", "/h", "stundensatz"];

/// A day rate named in the value of a rate line.
pub(crate) const DAILY_WORDS: &[&str] = &[
    "tagessatz",
    "pro tag",
    "per day",
    "/tag",
    "/day",
    "day rate",
    "daily rate",
];

pub(crate) const OTHER_CURRENCIES: &[&str] = &["chf", "usd", "gbp", "$", "£"];

/// Pay by commission or by result is no day rate (substrings; `provisionsfrei` is none).
pub(crate) const NO_RATE_WORDS: &[&str] =
    &["provision", "commission", "erfolgshonorar", "success fee"];

pub(crate) const NO_RATE_EXCEPT: &[&str] = &["provisionsfrei", "ohne provision", "no commission"];

/// Salary statements: cue words, units and bounds.
pub(crate) const SALARY_CUES: &[&str] = &[
    // LinkedIn's salary chip, per year or per month.
    "€/jahr",
    "eur/jahr",
    "€/monat",
    "eur/monat",
    "/yr",
    "gehalt",
    "salary",
    "vergutung",
    "compensation",
    "brutto",
    "einkommen",
    "p. a.",
    "p.a.",
    "per annum",
];

/// Units and currencies that make an amount of a salary sentence money (`95.000 €`, `120k`,
/// `130.000 brutto p.a.`).
pub(crate) const SALARY_UNITS: &[&str] = &[
    "€",
    "eur",
    "euro",
    "chf",
    "usd",
    "gbp",
    "$",
    "£",
    "k",
    "t€",
    "teur",
    "tsd",
    "brutto",
    "p.a.",
    "p. a.",
    "pro jahr",
    "per year",
    "per annum",
    "jahrlich",
    "im jahr",
    "a year",
    "/jahr",
    "/yr",
    "/mo",
    "pro monat",
    "per month",
    "monatlich",
];

pub(crate) const MONTHLY_WORDS: &[&str] = &["monat", "month", "/mo"];

pub(crate) const LOWER_BOUND_WORDS: &[&str] =
    &["ab ", "from ", "starting at", "mindestens", "at least"];

/// Suffixes that multiply an amount by 1,000 (`120k`, `120 TEUR`).
pub(crate) const THOUSAND_SUFFIXES: &[&str] = &["k€", "k ", "k,", "teur", "tsd", "t€"];

/// Plausible annual salaries in EUR start here.
pub(crate) const SALARY_MIN_AMOUNT: u64 = 10_000;

/// Words of a variable pay next to a salary (`plus bis zu 20 % Bonus`).
pub(crate) const BONUS_WORDS: &[&str] = &["bonus", "variab", "tantieme"];
