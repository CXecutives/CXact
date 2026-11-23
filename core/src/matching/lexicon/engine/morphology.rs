//! Word endings, linkers, adjective stems and particles.
//!
//! external contract - do not translate: German and English wording of job ads and
//! consultant profiles. All entries are case-folded; sorted tables are searched with
//! `binary_search`, keep them sorted.

/// Endings of a frame or soft word that keep its meaning (`Verfügbarkeit`, `Reisen`,
/// `analytische`, `Flexibilität`) (sorted).
pub(crate) const WORD_ENDINGS: &[&str] = &[
    "at", "de", "e", "em", "en", "end", "er", "es", "heit", "ig", "ige", "igen", "iger", "iges",
    "igkeit", "ing", "itat", "keit", "keiten", "ly", "n", "s", "t", "te", "ten", "ter", "ung",
    "ungen", "voll",
];

/// Linking letters between the parts of a compound (`Gehalt-s-vorstellung`).
pub(crate) const LINKERS: &[&str] = &["es", "keits", "n", "s", "ungs"];

/// Endings of a declined German adjective or participle (`erwünschte`, `großer`, `externen`,
/// `neues`).
pub(crate) const DECLENSION_ENDINGS: &[&str] = &["e", "em", "en", "er", "es"];

/// Endings of an adjective before its declension (`klassisch-en`, `qualitativ-er`,
/// `eigenständig-e`, `strukturiert-e`, `classic`, `technical`): such a word that ends a part
/// shares the noun of the next one (`klassischen und agilen Methoden`, `Classic and agile
/// project management`).
pub(crate) const ADJECTIVE_STEMS: &[&str] = &[
    "al", "ar", "bar", "ell", "end", "haft", "ic", "ical", "ig", "iert", "isch", "iv", "lich",
    "sam",
];

/// Verbal particles: `Einführung`, `Durchführung`, `Ausbildung` are no compounds of
/// `Führung` or `Bildung`; `Buchführung` is bookkeeping, no leadership.
/// Heads that verbal particles bind to (`Einführung`, `Durchführung`, `Markteinführung`): a
/// modifier ending in a particle makes another word, no compound of the head.
pub(crate) const PARTICLE_HEADS: &[&str] = &["fuhrung"];

pub(crate) const PARTICLE_MODIFIERS: &[&str] = &[
    "ab", "an", "auf", "aus", "bei", "buch", "durch", "ein", "ent", "fort", "mit", "nach", "uber",
    "um", "unter", "ver", "vor", "weg", "wieder", "zu", "zuruck",
];

/// A compound that ends in a degree word is a degree too (`Ingenieurstudium`, `BWL-Studium`).
/// Not `-ausbildung` as the terms' list has it: as a degree of the reader it cost the 154
/// NDCG@10 0.026 (measured 2026-11-23).
pub(crate) const DEGREE_ENDINGS: &[&str] = &["studium", "studiums"];

/// Endings of a head of `WAGE_HEADS` or `PAY_SCALE_HEADS` (`Stundenlohns`, `Löhne`; not the
/// verb `lohnen`).
pub(crate) const WAGE_HEAD_ENDINGS: &[&str] = &["", "s", "es", "e"];

/// Endings of a word of `PAY_SCALE_WORDS`.
pub(crate) const PAY_SCALE_ENDINGS: &[&str] = &["", "e", "n", "s", "en", "er", "es", "em"];

/// Endings of nouns that are never a name (`Controlling Teams`, `Geschäftsführung`).
pub(crate) const NOT_A_NAME_ENDINGS: &[&str] = &[
    "ung",
    "ing",
    "ment",
    "heit",
    "keit",
    "schaft",
    "team",
    "teams",
    "abteilung",
];
