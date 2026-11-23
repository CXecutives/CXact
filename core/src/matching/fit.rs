//! The profile the engine matches against, and the match ladder for one item:
//! exact/stem/synonym = 1.0, profile more specific = 1.0, profile more general = 0.5,
//! two thirds of a long phrase = 0.5, generic atoms never alone (V1-V4, V15), language
//! levels (V9), years (V8), degrees (field, relatedness, level) and licences.

use super::atoms::{self, Fit, Vocab, fold};
use super::job::{Class, Item, Stage, language_of, names_degree};
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine as lex;
use super::lexicon::esco::{self, Kind};
use super::normalize::contains_word;
use super::params::{E_FULL, E_HALF, E_NONE, SENTENCE_ATOMS};
use super::profile::CoreText;
use super::types::Via;
use crate::profile::{ProfileForm, key};

/// A profile entry (competence, tool, certificate, ...).
#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub text: String,
    pub path: String,
    pub atoms: Vec<String>,
    pub years: Option<u32>,
    /// What ESCO names in it (competences, tools and certificates only).
    pub broad: Broad,
    /// General business work any field does (`Projektmanagement`, `Stakeholder Management`;
    /// `atoms::general_work`): it meets requirements, but it shows no field.
    pub method: bool,
}

/// What ESCO, the broad layer under the engine's own words, names in a text
/// (`esco::named`): skills and knowledge for the requirements, occupations for the target
/// roles.
#[derive(Debug, Clone, Default)]
pub(crate) struct Broad {
    terms: Vec<BroadTerm>,
}

#[derive(Debug, Clone, Copy)]
struct BroadTerm {
    id: u16,
    /// Named by its preferred label.
    preferred: bool,
    /// The engine's own words (the core or a pack of the profile) give all its words a
    /// meaning: they decide, ESCO does not.
    known: bool,
    /// Its share of the text's words that are not generic, in per-mille.
    share: u16,
}

impl Broad {
    pub(crate) fn of(text: &str, vocab: &Vocab, kinds: &[Kind]) -> Self {
        let (words, named) = esco::named(text, kinds);
        if named.is_empty() {
            return Self::default();
        }
        let known = vocab.known(&words);
        let content: Vec<usize> = (0..words.len())
            .filter(|&i| !atoms::is_generic(&words[i]))
            .collect();
        let terms = named
            .iter()
            // A soft skill (`Kommunikation`) is no skill to match.
            .filter(|n| {
                !words[n.start..n.start + n.len]
                    .iter()
                    .any(|w| lex::SOFT_SKILLS.iter().any(|s| w.starts_with(s)))
            })
            .map(|n| {
                let span = n.start..n.start + n.len;
                let inside = content.iter().filter(|i| span.contains(i)).count();
                BroadTerm {
                    id: n.concept.id,
                    preferred: n.preferred,
                    known: span.clone().all(|i| known[i]),
                    share: u16::try_from(1000 * inside / content.len().max(1)).unwrap_or(1000),
                }
            })
            .collect();
        Self { terms }
    }

    /// The skills and knowledge of a requirement or a profile entry.
    pub(crate) fn skills(text: &str, vocab: &Vocab) -> Self {
        Self::of(text, vocab, &[Kind::Skill, Kind::Knowledge])
    }

    /// The pairs of a term of `self` (the ad's side) and a term of `profile` that name one
    /// concept, where the engine's own words leave the meaning of at least one of them to
    /// ESCO, the profile names the concept by its preferred label (in its own language or the
    /// other) and the concept is most of what each side says.
    fn shared<'a>(
        &'a self,
        profile: &'a Broad,
    ) -> impl Iterator<Item = (&'a BroadTerm, &'a BroadTerm)> + 'a {
        self.terms
            .iter()
            .flat_map(|ad| profile.terms.iter().map(move |p| (ad, p)))
            .filter(|(ad, p)| {
                ad.id == p.id
                    && p.preferred
                    && !(ad.known && p.known)
                    && 2 * ad.share > 1000
                    && 2 * p.share > 1000
            })
    }

    /// How a requirement (`self`) is met by a profile entry through a concept both name
    /// ([`Broad::shared`]): in full when each names only that concept by its preferred label
    /// (`Buchhaltung` and `Accounting`), else half (another name in the ad, such as a product
    /// filed under the concept, or more than the concept).
    fn meets(&self, entry: &Broad) -> Option<(u16, Via)> {
        self.shared(entry)
            .map(|(item, e)| {
                if item.share == 1000 && e.share == 1000 && item.preferred {
                    (E_FULL, Via::Synonym)
                } else {
                    (E_HALF, Via::Semantic)
                }
            })
            .max_by_key(|(value, _)| *value)
    }

    /// Does a title (`self`) name an occupation of a target role ([`Broad::shared`])?
    pub(crate) fn names(&self, role: &Broad) -> bool {
        self.shared(role).next().is_some()
    }
}

/// Forgets the texts read on this thread (a new job): their atoms.
pub(crate) fn forget() {
    atoms::forget_atoms();
}

/// What the engine uses from the profile.
#[derive(Debug, Clone)]
pub(crate) struct Skills {
    pub entries: Vec<Entry>,
    /// Language stem and CEFR level (1-7).
    pub languages: Vec<(String, u8)>,
    /// Fields of the profile's degrees; `None` = no degree stated.
    pub degree_fields: Option<Vec<&'static str>>,
    /// Highest degree level (1 bachelor, 2 master or diploma, 3 doctorate; 0 unknown).
    pub degree_level: u8,
    /// Degrees as written.
    pub degrees: Vec<String>,
    /// All profile texts, folded (licences are looked up here).
    pub folded: Vec<String>,
    pub total_years: Option<u32>,
    /// Core plus the domain packs the competences switch on.
    pub vocab: Vocab,
    /// The parts of the profile's hyphenated atoms (`contact`, `cent`, `leitung`): the words
    /// of an ad that one of them joins are read as one atom ([`joined`]).
    pub joins: Vec<Vec<String>>,
}

/// The same text once stripped as the core texts are.
fn strip_eq(a: &str, b: &str) -> bool {
    super::normalize::strip(a) == b
}

/// Degree fields named in a folded text; a match inside a longer match does not count.
pub(crate) fn degree_fields_in(folded: &str) -> Vec<&'static str> {
    let found: Vec<(usize, usize, &'static str)> = lex::DEGREE_FIELDS
        .iter()
        .flat_map(|&(word, field)| {
            folded
                .match_indices(word)
                .map(move |(at, _)| (at, at + word.len(), field))
        })
        .collect();
    let mut fields: Vec<&'static str> = found
        .iter()
        .filter(|(start, end, _)| {
            !found
                .iter()
                .any(|(s, e, _)| s <= start && end <= e && e - s > end - start)
        })
        .map(|(_, _, field)| *field)
        .collect();
    fields.sort_unstable();
    fields.dedup();
    fields
}

/// Degree level named in a folded text (0 = none).
pub(crate) fn degree_level_in(folded: &str) -> u8 {
    let level = lex::DEGREE_LEVELS
        .iter()
        .filter(|(word, _)| folded.contains(word))
        .map(|&(_, level)| level)
        .max()
        .unwrap_or(0);
    let applied = lex::DEGREE_APPLIED.iter().any(|w| folded.contains(w));
    if level == 2 && applied && !folded.contains("master") {
        1
    } else {
        level
    }
}

/// Does the item ask for knowledge of the family and nothing else (`Sehr gute
/// SAP-Kenntnisse`), no product of it (`Kenntnisse in SAP BW`) and no bare word of a teaser?
fn family_only(text: &str, family: &str) -> bool {
    let folded = fold(text);
    let knowledge = lex::KNOWLEDGE_STEMS.iter().any(|k| folded.contains(k));
    knowledge
        && atoms::raw_tokens(&folded).all(|t| {
            let t = t.split('-').next().unwrap_or(t);
            t == family
                || atoms::is_filler(t)
                || lex::KNOWLEDGE_WORDS.contains(&t)
                || lex::LEVEL_WORDS.iter().any(|(w, _)| *w == t)
        })
}

/// Languages of the profile with their CEFR level, those the engine knows.
fn languages_of(form: &ProfileForm) -> Vec<(String, u8)> {
    form.languages
        .iter()
        .filter_map(|row| {
            let name = fold(&row.language);
            let first = atoms::raw_tokens(&name).next()?.to_owned();
            Some((language_of(&first)?.to_owned(), row.level.engine()))
        })
        .collect()
}

impl Skills {
    pub(crate) fn new(core: &[CoreText], form: &ProfileForm) -> Self {
        let vocab = Vocab::for_texts(core.iter().map(|c| c.text.as_str()));
        let years = |text: &str| {
            form.competences
                .iter()
                .find(|c| strip_eq(&c.name, text))
                .and_then(|c| c.years)
        };
        // An industry is a setting and a language a requirement of its own, no skill.
        let skill = |path: &str| {
            [key::COMPETENCES, key::TOOLS, key::CERTIFICATES]
                .iter()
                .any(|k| path.starts_with(k))
        };
        let mut entries: Vec<Entry> = core
            .iter()
            .map(|entry| Entry {
                atoms: atoms::atoms(&entry.text, &vocab),
                years: years(&entry.text),
                broad: if skill(&entry.path) {
                    Broad::skills(&entry.text, &vocab)
                } else {
                    Broad::default()
                },
                method: atoms::general_work(&entry.text),
                text: entry.text.clone(),
                path: entry.path.clone(),
            })
            .collect();
        entries.retain(|e| !e.atoms.is_empty());
        let languages = languages_of(form);
        let mut degree_fields: Option<Vec<&'static str>> = None;
        let (mut degree_level, mut degrees) = (0, Vec::new());
        for competence in core {
            let folded = fold(&competence.text);
            let tokens: Vec<&str> = atoms::raw_tokens(&folded).collect();
            let is_degree = competence.path.starts_with(key::DEGREES) || names_degree(&tokens);
            if is_degree {
                let fields = degree_fields.get_or_insert_with(Vec::new);
                fields.extend(degree_fields_in(&folded));
                degree_level = degree_level.max(degree_level_in(&folded));
                degrees.push(competence.text.clone());
            }
        }
        let total_years = form
            .years
            .or_else(|| form.competences.iter().filter_map(|c| c.years).max());
        let mut joins: Vec<Vec<String>> = entries
            .iter()
            .flat_map(|e| &e.atoms)
            .filter(|a| a.contains('-'))
            .map(|a| a.split('-').map(str::to_owned).collect::<Vec<_>>())
            .filter(|parts| parts.len() >= 2 && parts.iter().all(|p| !p.is_empty()))
            .collect();
        joins.sort();
        joins.dedup();
        Self {
            entries,
            languages,
            degree_fields,
            degree_level,
            degrees,
            folded: core.iter().map(|t| fold(&t.text)).collect(),
            total_years,
            vocab,
            joins,
        }
    }
}

/// The atoms of an ad with the words a hyphenated profile atom joins read as one atom
/// (`Contact Center` for the profile's `Call-Center-Leitung`: `contact-cent`), the longest
/// run first: the ad writes apart what the profile writes as one word.
fn joined(job: Vec<String>, joins: &[Vec<String>]) -> Vec<String> {
    if joins.is_empty() || job.len() < 2 {
        return job;
    }
    let job = &job;
    let run = |at: usize| -> usize {
        joins
            .iter()
            .flat_map(|parts| {
                (0..parts.len()).map(move |start| {
                    parts[start..]
                        .iter()
                        .zip(&job[at..])
                        .take_while(|(p, j)| p == j)
                        .count()
                })
            })
            .max()
            .unwrap_or(0)
    };
    let mut out = Vec::with_capacity(job.len());
    let mut at = 0;
    while at < job.len() {
        let n = run(at);
        if n >= 2 {
            out.push(job[at..at + n].join("-"));
            at += n;
        } else {
            out.push(job[at].clone());
            at += 1;
        }
    }
    out
}

/// How well the profile meets one item.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct ItemFit {
    /// Evidence in per-mille: 0, 500 or 1000.
    pub value: u16,
    pub entry: Option<usize>,
    pub via: Via,
}

const NONE: ItemFit = ItemFit {
    value: E_NONE,
    entry: None,
    via: Via::Exact,
};

/// Job atoms plus the parts of hyphenated compounds.
fn expand(atoms: &[String]) -> Vec<String> {
    let mut out = atoms.to_vec();
    for atom in atoms {
        if atom.contains('-') {
            out.extend(atom.split('-').filter(|p| p.len() >= 2).map(str::to_owned));
        }
    }
    out
}

/// A job atom against a profile atom ([`atoms::fit`]); an abbreviation the ad asks for is
/// also met by a compound the profile names with it before a hyphen (`CRM` by
/// `CRM-Einführung`, `KPI` by `KPI-Reporting`; `DIN` is no part of `DIN 276`, a code).
fn atom_fit(job: &str, profile: &str) -> Fit {
    match atoms::fit(job, profile) {
        Fit::None
            if job.len() == 3
                && !atoms::is_generic(job)
                && profile
                    .strip_prefix(job)
                    .and_then(|head| head.strip_prefix('-'))
                    .is_some_and(|head| head.starts_with(|c: char| c.is_ascii_alphabetic())) =>
        {
            Fit::Specific
        }
        fit => fit,
    }
}

/// A free-text entry (a long description): containing a requirement is weaker evidence than
/// a competence entry.
fn sentence_like(entry: &Entry) -> bool {
    entry.atoms.iter().filter(|a| !atoms::is_generic(a)).count() >= SENTENCE_ATOMS
}

/// One entry against the atoms of one alternative.
fn entry_fit(job: &[String], expanded: &[String], whole: &Entry) -> (u16, Via) {
    let entry = &whole.atoms;
    let best = |p: &String| {
        expanded
            .iter()
            .map(|j| atom_fit(j, p))
            .max()
            .unwrap_or(Fit::None)
    };
    let fits: Vec<Fit> = entry.iter().map(best).collect();
    let matched = fits.iter().filter(|f| **f != Fit::None).count();
    let generic_only = entry
        .iter()
        .zip(&fits)
        .filter(|(_, f)| **f != Fit::None)
        .all(|(p, _)| atoms::is_generic(p));
    let whole_item = job
        .iter()
        .all(|j| entry.iter().any(|p| atom_fit(j, p) != Fit::None));
    if matched == entry.len() && (!generic_only || whole_item) {
        return if fits.contains(&Fit::General) {
            (E_HALF, Via::General)
        } else if fits.contains(&Fit::Specific) {
            (E_FULL, Via::Specific)
        } else {
            (E_FULL, Via::Exact)
        };
    }
    // The item lies inside the entry: the profile is more specific. A common word of a name
    // of several words is no part of it (`Services` of `Amazon Web Services`).
    let content: Vec<&String> = job.iter().filter(|j| !atoms::is_generic(j)).collect();
    let name_words_only = entry.len() >= 2
        && content
            .iter()
            .all(|j| lex::NAME_WORDS.contains(&j.as_str()));
    if !content.is_empty()
        && !name_words_only
        && content.iter().all(|j| {
            entry
                .iter()
                .any(|p| matches!(atom_fit(j, p), Fit::Equal | Fit::Specific))
        })
    {
        // Free text that mentions a skill (a USP sentence, a long description such as
        // `Integration FI/CO mit MM und SD`) does not prove it.
        return if sentence_like(whole) {
            (E_NONE, Via::Exact)
        } else {
            (E_FULL, Via::Specific)
        };
    }
    if entry.len() >= 3 && 3 * matched >= 2 * entry.len() && !generic_only {
        return (E_HALF, Via::General);
    }
    (E_NONE, Via::Exact)
}

/// Does any profile atom relate to this job atom (a hyphenated atom through its parts)?
fn covered(skills: &Skills, atom: &str) -> bool {
    let related = |a: &str| {
        skills
            .entries
            .iter()
            .flat_map(|e| &e.atoms)
            .any(|p| atom_fit(a, p) != Fit::None || atoms::fit(p, a) != Fit::None)
    };
    related(atom)
        || (atom.contains('-')
            && atom
                .split('-')
                .filter(|p| p.len() >= 3 && !atoms::is_generic(p))
                .all(related))
}

/// The best entry on the ladder for the atoms of a requirement (`industries`: the profile's
/// industries count too), the first of equals.
fn best_entry(skills: &Skills, job: &[String], industries: bool) -> ItemFit {
    let expanded = expand(job);
    let mut best = NONE;
    for (index, entry) in skills.entries.iter().enumerate() {
        if !industries && entry.path.starts_with(key::INDUSTRIES) {
            continue;
        }
        let (value, via) = entry_fit(job, &expanded, entry);
        if value > best.value {
            best = ItemFit {
                value,
                entry: Some(index),
                via,
            };
        }
    }
    best
}

/// The ladder over all entries; `broad`: ESCO too (not for a soft skill, which counts half
/// unproven anyway).
fn skill_fit_in(skills: &Skills, text: &str, broad: bool) -> ItemFit {
    let job = joined(atoms::atoms(text, &skills.vocab), &skills.joins);
    if job.is_empty() {
        return NONE;
    }
    let mut best = best_entry(skills, &job, true);
    // An industry of the profile meets a requirement through a compound only when the
    // requirement asks for an industry (`Kommunikationsfähigkeit` is no `Telekommunikation`);
    // its own name it always meets.
    if best.via != Via::Exact
        && best
            .entry
            .and_then(|e| skills.entries.get(e))
            .is_some_and(|e| e.path.starts_with(key::INDUSTRIES))
        && !industry_only(text, &skills.vocab)
    {
        best = best_entry(skills, &job, false);
    }
    // The industry is the setting of a requirement (`Qualitätsmanagement produzierender
    // Unternehmen`): without a fit the function alone is read, the setting costs little
    // (the rubric's rule 5).
    if best.value == E_NONE && job.iter().any(|a| industry_atom(a)) {
        let function: Vec<String> = job.iter().filter(|a| !industry_atom(a)).cloned().collect();
        if function.iter().any(|a| !atoms::is_generic(a)) {
            best = best_entry(skills, &function, false);
        }
    }
    // A generic family asked for alone (`SAP-Kenntnisse`) is met by an entry that names a
    // product of it (`SAP S/4HANA`).
    if best.value == E_NONE
        && let [family] = job.as_slice()
        && atoms::is_generic(family)
        && family_only(text, family)
        && let Some(index) = skills.entries.iter().position(|e| {
            e.atoms.len() >= 2
                && e.atoms.first() == Some(family)
                && e.atoms.iter().any(|a| !atoms::is_generic(a))
        })
    {
        best = ItemFit {
            value: E_FULL,
            entry: Some(index),
            via: Via::Specific,
        };
    }
    // Leadership asked for is met at least half by a leading role or a competence of
    // leadership in the profile (`Führung` for `Leadership`; only an item about leadership
    // alone, not `8 Jahre Controlling, davon 3 mit Führung`). Leadership names no field: it
    // never counts in full on its own.
    if best.value < E_HALF
        && leadership_only(&job)
        && let Some(index) = skills.entries.iter().position(|e| {
            let folded = fold(&e.text);
            atoms::raw_tokens(&folded).any(|t| lex::PROFILE_LEAD_WORDS.contains(&t))
                || (e.path.starts_with(key::COMPETENCES)
                    && e.atoms.iter().all(|a| leadership_atom(a)))
        })
    {
        best = ItemFit {
            value: E_HALF,
            entry: Some(index),
            via: Via::General,
        };
    }
    // The ad asks for more than the profile names (`Tableau im Reporting` against
    // `Reporting`): the profile is more general, half.
    // Words of experience (`Berufserfahrung`, `Projekterfahrung`, `Praxis`) ask for nothing
    // more: what the profile names literally stays met (engine 22).
    if best.value == E_FULL
        && job
            .iter()
            .any(|j| !atoms::is_generic(j) && !experience_atom(j) && !covered(skills, j))
    {
        // An industry is the setting of a requirement, never its function
        // (`Vertriebserfahrung im Maschinenbau` is not half met by `Maschinenbau`).
        let industry = best
            .entry
            .and_then(|e| skills.entries.get(e))
            .is_some_and(|e| e.path.starts_with(key::INDUSTRIES));
        if industry {
            best = NONE;
        } else {
            best.value = E_HALF;
            best.via = Via::General;
        }
    }
    // Another tool of the same kind (`HubSpot` for `Salesforce`, both CRM) is similar:
    // partly met, never open (the rubric's rule 3).
    if broad
        && best.value < E_HALF
        && let Some(index) = same_kind(skills, text)
    {
        best = ItemFit {
            value: E_HALF,
            entry: Some(index),
            via: Via::General,
        };
    }
    // ESCO, the broad layer: a concept the item and an entry both name.
    if broad && best.value < E_FULL && skills.entries.iter().any(|e| !e.broad.terms.is_empty()) {
        let item = Broad::skills(text, &skills.vocab);
        for (index, entry) in skills.entries.iter().enumerate() {
            if let Some((value, via)) = item.meets(&entry.broad)
                && value > best.value
            {
                best = ItemFit {
                    value,
                    entry: Some(index),
                    via,
                };
            }
        }
    }
    best
}

/// Does a requirement ask only for experience in an industry (`Erfahrung in der
/// Pharmaindustrie`, `Banking background`)? Its atoms are industries, industry endings and
/// generic or experience words.
pub(crate) fn industry_only(text: &str, vocab: &Vocab) -> bool {
    let mut any = false;
    for atom in atoms::atoms(text, vocab) {
        if industry_atom(&atom) {
            any = true;
        } else if !(atoms::is_generic(&atom) || experience_atom(&atom)) {
            return false;
        }
    }
    any
}

/// Does an atom name an industry or a setting (`pharmaindustri`, `banken`, `produzierend`)?
fn industry_atom(atom: &str) -> bool {
    use super::lexicon::{terms, wishes};
    wishes::INDUSTRIES
        .iter()
        .chain(wishes::INDUSTRY_WORDS)
        .any(|(w, _)| {
            // A generic atom is never the start of an industry's name: `financ` (`finance`,
            // the function) is no `financial services`.
            atom == *w
                || (w.len() >= 6
                    && (atom.starts_with(w) || (w.starts_with(atom) && !atoms::is_generic(atom))))
        })
        || terms::INDUSTRY_ENDINGS
            .iter()
            .chain(terms::INDUSTRY_TAILS)
            .any(|e| atom.ends_with(atoms::stem(e).as_str()))
        || terms::INDUSTRY_NOUNS
            .iter()
            .any(|n| atom.starts_with(atoms::stem(n).as_str()))
        || lex::SETTING_WORDS.iter().any(|w| atom.starts_with(w))
}

/// The kinds of tool a text names (`TOOL_KINDS`).
fn tool_kinds(text: &str) -> Vec<&'static str> {
    let folded = fold(text).replace('-', " ");
    super::lexicon::TOOL_KINDS
        .iter()
        .filter(|(_, names)| names.iter().any(|n| contains_word(&folded, n)))
        .map(|(kind, _)| *kind)
        .collect()
}

/// The first profile entry that names a tool of a kind the text names.
fn same_kind(skills: &Skills, text: &str) -> Option<usize> {
    let kinds = tool_kinds(text);
    if kinds.is_empty() {
        return None;
    }
    skills
        .entries
        .iter()
        .position(|e| tool_kinds(&e.text).iter().any(|k| kinds.contains(k)))
}

/// An atom that only says experience (`berufserfahr`, `projekterfahr`, `praxis`), not
/// the experience of a function (`Vertriebserfahrung`).
fn experience_atom(atom: &str) -> bool {
    lex::GENERAL_EXPERIENCE
        .iter()
        .chain(lex::EXPERIENCE_WORDS)
        .map(|w| atoms::stem(w))
        .any(|w| atom.starts_with(&w))
        || atom == atoms::stem("projekterfahrung")
}

/// Does a requirement ask only for what a role at `level` brings (`ROLE_BRINGS`:
/// `Führungserfahrung`, `Budgetverantwortung`, `Stakeholder-Management` for a head of)?
pub(crate) fn role_brings(level: u8, text: &str, vocab: &Vocab) -> bool {
    let brought: Vec<&str> = lex::ROLE_BRINGS
        .iter()
        .filter(|(from, _)| *from <= level)
        .flat_map(|(_, words)| words.iter().copied())
        .collect();
    let named = |a: &str| brought.iter().any(|w| a.starts_with(w));
    let filler = |a: &str| atoms::is_generic(a) || experience_atom(a);
    let mut any = false;
    for atom in atoms::atoms(text, vocab) {
        let parts: Vec<&str> = atom.split('-').filter(|p| !p.is_empty()).collect();
        if parts.iter().any(|p| named(p)) && parts.iter().all(|p| named(p) || filler(p)) {
            any = true;
        } else if !filler(&atom) {
            return false;
        }
    }
    any
}

/// An atom of leadership (`fuhrung`, `personalverantwortung`).
pub(crate) fn leadership_atom(atom: &str) -> bool {
    lex::LEADERSHIP_ATOMS
        .iter()
        .any(|l| atom == *l || atom.starts_with(l))
}

/// Does a requirement ask for leadership alone (`Erste Führungserfahrung`)? Its atoms are
/// leadership atoms and generic ones only.
fn leadership_only(atoms: &[String]) -> bool {
    atoms.iter().any(|a| leadership_atom(a))
        && atoms
            .iter()
            .all(|a| leadership_atom(a) || atoms::is_generic(a))
}

fn language_fit(skills: &Skills, language: &str, level: Option<u8>) -> ItemFit {
    let Some(&(_, have)) = skills.languages.iter().find(|(l, _)| l == language) else {
        return NONE;
    };
    // One level below the requirement (B2 for "fluent") is half, further below open.
    let need = level.unwrap_or(3);
    let value = if have >= need {
        E_FULL
    } else if have + 1 >= need {
        E_HALF
    } else {
        E_NONE
    };
    ItemFit {
        value,
        entry: None,
        via: Via::Exact,
    }
}

/// A degree requirement: the field (any, comparable, same, neighbouring or other) and the
/// level (a bachelor for a master's requirement is half). `Diplom-Kauffrau (Univ.)` is a
/// business degree at master level.
fn degree_fit(skills: &Skills, text: &str) -> ItemFit {
    let Some(fields) = &skills.degree_fields else {
        return NONE;
    };
    let folded = fold(text);
    let wanted = degree_fields_in(&folded);
    let comparable = lex::COMPARABLE_WORDS.iter().any(|w| folded.contains(w));
    let related = |w: &&str| {
        fields.iter().any(|f| {
            lex::DEGREE_RELATED
                .iter()
                .any(|&(a, b)| (a == *w && b == *f) || (a == *f && b == *w))
        })
    };
    let field = if wanted.is_empty() || comparable || wanted.iter().any(|w| fields.contains(w)) {
        E_FULL
    } else if wanted.iter().any(related) || fields.is_empty() {
        E_HALF
    } else {
        E_NONE
    };
    // The lowest level the ad accepts (`Bachelor or Master` = bachelor).
    let needed = lex::DEGREE_LEVELS
        .iter()
        .filter(|(word, _)| folded.contains(word))
        .map(|&(_, level)| level)
        .min()
        .unwrap_or(0);
    let level_ok = needed == 0 || skills.degree_level == 0 || skills.degree_level >= needed;
    let value = if level_ok { field } else { field.min(E_HALF) };
    ItemFit {
        value,
        entry: None,
        via: Via::Exact,
    }
}

/// A licence requirement (`Zulassung als Steuerberater`): met only when a profile text
/// names the same licence.
/// A licence the profile holds under any of its names (`Sachkundige Person` for a
/// `Qualified Person`).
fn licence_fit(skills: &Skills, word: &str) -> ItemFit {
    let names = lex::LICENCE_SYNONYMS
        .iter()
        .find(|names| names.contains(&word))
        .map_or_else(|| vec![word], |names| names.to_vec());
    let held = |t: &String| names.iter().any(|n| contains_word(t, n));
    let value = if skills.folded.iter().any(held) {
        E_FULL
    } else {
        E_NONE
    };
    ItemFit {
        value,
        entry: None,
        via: Via::Exact,
    }
}

/// The alternatives of a skill item (the item itself when it has none).
fn alternatives(item: &Item) -> Vec<&str> {
    let mut alternatives: Vec<&str> = item.alternatives.iter().map(String::as_str).collect();
    if alternatives.is_empty() {
        alternatives.push(&item.text);
    }
    alternatives
}

/// The packs whose triggers an atom starts with.
fn packs_of(atom: &str) -> Vec<&'static str> {
    DOMAINS
        .iter()
        .filter(|d| d.triggers.iter().any(|t| atom.starts_with(t)))
        .map(|d| d.name)
        .collect()
}

/// Is a profile atom a compound of another field than the job atom it narrows
/// (`Personalcontrolling`, an HR word, for `Controlling`)?
pub(crate) fn other_field(job: &str, profile: &str) -> bool {
    let own = packs_of(job);
    let theirs = packs_of(profile);
    !theirs.is_empty() && theirs.iter().all(|p| !own.contains(p))
}

/// Is an item general professional experience (`10 Jahre Berufserfahrung`, `8 years of
/// experience`), not experience in a topic (`3-5 Jahre Berufserfahrung im Controlling`)? Its
/// years are judged against the profile's own years (`berufserfahrung_jahre`).
pub(crate) fn general_experience(text: &str, vocab: &Vocab) -> bool {
    let folded = fold(text);
    let experience = |a: &str| {
        lex::GENERAL_EXPERIENCE
            .iter()
            .chain(lex::EXPERIENCE_WORDS)
            .any(|w| a.starts_with(&atoms::stem(w)))
    };
    let topic = atoms::atoms(text, vocab)
        .into_iter()
        .any(|a| !atoms::is_generic(&a) && !experience(&a));
    !topic
        && lex::GENERAL_EXPERIENCE
            .iter()
            .chain(lex::EXPERIENCE_WORDS)
            .any(|w| contains_word(&folded, w))
}

/// The years a requirement of years is judged against: the matching competence's own years,
/// else the profile's years of experience (for general experience, or a topic the profile
/// names without years); none without either.
pub(crate) fn years_have(skills: &Skills, general: bool, entry: Option<usize>) -> Option<u32> {
    entry
        .and_then(|e| skills.entries.get(e))
        .and_then(|e| e.years)
        .or(if general || entry.is_some() {
            skills.total_years
        } else {
            None
        })
}

/// How far `have` years meet `needed`: in full at or above, in half from four fifths on.
pub(crate) fn years_value(have: u32, needed: u32) -> u16 {
    if have >= needed {
        E_FULL
    } else if 5 * u64::from(have) >= 4 * u64::from(needed) {
        E_HALF
    } else {
        E_NONE
    }
}

/// The ladder for one item (best alternative), then the years requirement.
pub(crate) fn item_fit(skills: &Skills, item: &Item) -> ItemFit {
    let mut fit = match &item.class {
        Class::Frame => NONE,
        Class::Language(language, level) => language_fit(skills, language, *level),
        Class::Degree => degree_fit(skills, &item.text),
        Class::Licence(word) => licence_fit(skills, word),
        Class::Soft | Class::Skill => alternatives(item)
            .iter()
            .map(|alt| skill_fit_in(skills, alt, item.class == Class::Skill))
            .max_by_key(|f| f.value)
            .unwrap_or(NONE),
    };
    // A teaser's term met only through a compound of another field is half: the profile
    // names the skill as part of other work (`Personalcontrolling` for `Controlling`).
    if item.stage == Stage::Vocabulary
        && fit.value == E_FULL
        && fit.via == Via::Specific
        && let Some(entry) = fit.entry.and_then(|e| skills.entries.get(e))
    {
        let job = atoms::atoms(&item.text, &skills.vocab);
        let narrowed = job.iter().any(|j| {
            entry
                .atoms
                .iter()
                .any(|p| atoms::fit(j, p) == Fit::Specific && other_field(j, p))
        });
        if narrowed {
            fit.value = E_HALF;
            fit.via = Via::General;
        }
    }
    if let Some(needed) = item.years {
        let general = general_experience(&item.text, &skills.vocab);
        let have =
            fit.entry
                .and_then(|e| skills.entries[e].years)
                .or(if general || fit.value > 0 {
                    skills.total_years
                } else {
                    None
                });
        // Asked years cost little and never leave a requirement open (the rubric's rule 5):
        // fewer years meet it at least in half.
        if general && fit.value == E_NONE {
            // General experience is judged by the profile's own years alone (none stated: no
            // verdict, the item stays open and the engine does not weigh it).
            if let Some(have) = have {
                fit = ItemFit {
                    value: years_value(have, needed).max(E_HALF),
                    entry: None,
                    via: Via::Exact,
                };
            }
        } else if fit.value > E_NONE
            && let Some(have) = have
            && have < needed
        {
            fit.value = years_value(have, needed).max(E_HALF).min(fit.value);
        }
    }
    fit
}

#[cfg(test)]
mod tests;
