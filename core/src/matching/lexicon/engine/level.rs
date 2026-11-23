//! Seniority and role levels.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Values of a page's career level or employment type field (exact, folded) that are
/// clearly below a senior target: an internship, an entry-level role, voluntary work.
pub(crate) const ENTRY_LEVEL_VALUES: &[&str] = &[
    "praktikum",
    "internship",
    "berufseinstieg",
    "einstiegslevel",
    "entry level",
    "entry-level",
    "ehrenamtlich",
    "volunteer",
    "werkstudent",
    "trainee",
];

/// Career levels (exact, folded) that may be below a senior target: a check only.
pub(crate) const LOW_LEVEL_VALUES: &[&str] = &["assistent", "assistant", "associate", "junior"];

/// A must that asks for first professional experience: an entry-level role, like a junior
/// title (whole words or phrases; `graduate` alone is no signal, `graduate degree` is a
/// master's).
pub(crate) const ENTRY_LEVEL_MUSTS: &[&str] = &[
    "erste berufserfahrung",
    "erste berufserfahrungen",
    "ersten berufserfahrungen",
    "erster berufserfahrung",
    "first professional experience",
    "first work experience",
    "berufseinsteiger",
    "berufseinsteigerin",
    "berufseinsteigende",
    "berufseinstieg",
    "absolvent",
    "absolventin",
    "absolventen",
    "hochschulabsolvent",
    "hochschulabsolventin",
    "hochschulabsolventen",
    "recent graduate",
    "recent graduates",
    "graduate program",
    "graduate programme",
    "werkstudententatigkeit",
];

/// The level a junior word names (a title word, a page's career level or employment type,
/// a must that asks for first experience), as the code the interface names it by.
pub(crate) const LEVEL_CODES: &[(&str, &str)] = &[
    ("praktikum", "internship"),
    ("praktikant", "internship"),
    ("praktikantin", "internship"),
    ("internship", "internship"),
    ("werkstudent", "student"),
    ("werkstudentin", "student"),
    ("werkstudententatigkeit", "student"),
    ("trainee", "trainee"),
    ("absolvent", "graduate"),
    ("absolventin", "graduate"),
    ("graduate", "graduate"),
    ("ehrenamtlich", "volunteer"),
    ("volunteer", "volunteer"),
    ("junior", "junior"),
    ("assistent", "assistant"),
    ("assistant", "assistant"),
    ("associate", "associate"),
];

/// Title words of a junior role.
pub(crate) const JUNIOR_TITLES: &[&str] = &[
    "junior",
    "trainee",
    "werkstudent",
    "werkstudentin",
    "praktikant",
    "praktikantin",
    "praktikum",
    "internship",
    "absolvent",
    "absolventin",
    "graduate",
    "berufseinsteiger",
    "berufseinsteigerin",
    "berufseinstieg",
    "young professional",
    "entry level",
    "entry-level",
];
