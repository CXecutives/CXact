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

/// Endings of an adjective that can share the noun of the next item
/// (`Classic and agile project management`, `klassische und agile Methoden`).
pub(crate) const ADJECTIVE_ENDINGS: &[&str] = &[
    "al", "ale", "alen", "aler", "ales", "ic", "ical", "isch", "ische", "ischen", "ischer",
    "isches", "iv", "ive", "iven", "iver", "ives", "lich", "liche", "lichen", "licher", "liches",
];

/// Endings of a declined German adjective or participle (`erwünschte`, `großer`, `externen`,
/// `neues`).
pub(crate) const DECLENSION_ENDINGS: &[&str] = &["e", "em", "en", "er", "es"];

/// Endings of a declined adjective (`großer`, `externen`, `neues`).
pub(crate) const DECLINED_ENDINGS: &[&str] = &["er", "en", "es", "em"];

/// Stems of a German adjective before its declension (`klassisch-en`, `qualitativ-er`,
/// `eigenständig-e`, `strukturiert-e`): such a word that ends a part shares the noun of the
/// next one (`klassischen und agilen Methoden`).
pub(crate) const ADJECTIVE_STEMS: &[&str] = &[
    "al", "ar", "bar", "ell", "end", "haft", "ig", "iert", "isch", "iv", "lich", "sam",
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
