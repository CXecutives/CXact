//! Contact person, name and phone words.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Words that name the contact person of an ad anywhere in a line
/// (`Ihre Ansprechpartnerin ist Julia Brandt`). Several words are one entry.
pub(crate) const CONTACT_PERSON_WORDS: &[&str] = &[
    "ansprechpartner",
    "ansprechpartnerin",
    "ansprechperson",
    "kontaktperson",
    "contact person",
    "your contact",
    "recruiter",
    "recruiterin",
];

/// Words that name a contact only as the first word of a line, a label (`Kontakt: Julia
/// Brandt`).
pub(crate) const CONTACT_LABELS: &[&str] = &["kontakt", "contact"];

/// Words between a contact word and the name (`Ihr Ansprechpartner ist Herr Max Weber`).
pub(crate) const CONTACT_FILLERS: &[&str] = &["ist", "is", "wird", "will", "be"];

/// Forms of address before a name; one with a single name after it stays (`Frau Brandt`).
pub(crate) const HONORIFICS: &[&str] = &["frau", "herr", "mr", "mrs", "ms"];

/// Titles before a name that stay with it (`Dr. Julia Brandt`).
pub(crate) const NAME_TITLES: &[&str] = &["dr", "prof"];

/// Capitalised words that are never part of a person's name.
pub(crate) const NOT_A_NAME: &[&str] = &[
    "abteilung",
    "ag",
    "and",
    "bewerbung",
    "bewerbungen",
    "bitte",
    "details",
    "e-mail",
    "email",
    "fragen",
    "gmbh",
    "hr",
    "human",
    "ihr",
    "ihre",
    "info",
    "kg",
    "mail",
    "mbh",
    "personal",
    "personalabteilung",
    "please",
    "questions",
    "resources",
    "se",
    "sie",
    "tel",
    "telefon",
    "phone",
    "und",
    "unter",
    "via",
    "wir",
];

/// Words that name a phone number in a line (`Tel. 040 5550 1234`).
pub(crate) const PHONE_WORDS: &[&str] = &[
    "tel",
    "telefon",
    "telefonnummer",
    "rufnummer",
    "fon",
    "mobil",
    "mobile",
    "handy",
    "phone",
    "call",
];

/// Local parts of an e-mail address nobody answers.
pub(crate) const NO_REPLY: &[&str] = &["noreply", "no-reply", "donotreply", "do-not-reply"];
