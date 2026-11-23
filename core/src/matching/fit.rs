//! The profile the engine matches against, and the match ladder for one item:
//! exact/stem/synonym = 1.0, profile more specific or covered (`graph`) = 1.0, profile more
//! general or near = 0.5, generic atoms never alone (V1-V4, V15), kinds of tool, language
//! levels (V9), years (V8), degrees (field, relatedness, level) and licences.

use std::rc::Rc;
use std::sync::LazyLock;

use super::atoms::{self, Fit, Vocab, fold};
use super::graph::{Known, Row};
use super::job::{Class, Item, language_of, names_degree};
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
    /// The index of each atom in `Skills::known`.
    pub ids: Vec<usize>,
    pub years: Option<u32>,
    /// What ESCO names in it (competences, tools and certificates only).
    pub broad: Broad,
    /// General business work any field does (`Projektmanagement`, `Stakeholder Management`;
    /// `atoms::general_work`): it meets requirements, but it shows no field.
    pub method: bool,
    /// The kinds of tool it names (`TOOL_KINDS`).
    pub tools: Vec<&'static str>,
    /// An industry of the profile (`branchen`): a setting, no skill.
    pub industry: bool,
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
    /// The entries' atoms, numbered (`Entry::ids`).
    pub known: Known,
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
            .map(|entry| {
                let atoms = atoms::atoms(&entry.text, &vocab).to_vec();
                Entry {
                    years: years(&entry.text),
                    broad: if skill(&entry.path) {
                        Broad::skills(&entry.text, &vocab)
                    } else {
                        Broad::default()
                    },
                    method: atoms::general_work(&entry.text),
                    tools: tool_kinds(&entry.text),
                    industry: entry.path.starts_with(key::INDUSTRIES),
                    ids: Vec::new(),
                    atoms,
                    text: entry.text.clone(),
                    path: entry.path.clone(),
                }
            })
            .collect();
        entries.retain(|e| !e.atoms.is_empty());
        let mut distinct: Vec<String> = entries.iter().flat_map(|e| e.atoms.clone()).collect();
        distinct.sort();
        distinct.dedup();
        let known = Known::new(distinct);
        for entry in &mut entries {
            entry.ids = entry.atoms.iter().filter_map(|a| known.index(a)).collect();
        }
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
            known,
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

/// An atom of an ad with its row against the profile's atoms.
struct Asked {
    atom: String,
    row: Rc<Row>,
    /// The profile atoms it meets as an abbreviation ([`Asked::fit`]).
    abbreviates: Vec<usize>,
}

impl Asked {
    /// An abbreviation the ad asks for is also met by a compound the profile names with it
    /// before a hyphen (`CRM` by `CRM-Einführung`, `KPI` by `KPI-Reporting`; `DIN` is no part
    /// of `DIN 276`, a code).
    fn new(skills: &Skills, atom: &str) -> Self {
        let row = skills.known.row(atom);
        let abbreviates = if atom.len() == 3 && !atoms::is_generic(atom) {
            let compound = |p: &String| {
                p.strip_prefix(atom)
                    .and_then(|head| head.strip_prefix('-'))
                    .is_some_and(|head| head.starts_with(|c: char| c.is_ascii_alphabetic()))
            };
            let known = skills.known.atoms();
            (0..known.len())
                .filter(|&i| row.fits[i] == Fit::None && compound(&known[i]))
                .collect()
        } else {
            Vec::new()
        };
        Self {
            row,
            abbreviates,
            atom: atom.to_owned(),
        }
    }

    /// The ad atom against the profile atom `i` ([`graph::fit`], abbreviations too).
    fn fit(&self, i: usize) -> Fit {
        match self.row.fits[i] {
            Fit::None if self.abbreviates.contains(&i) => Fit::Specific,
            fit => fit,
        }
    }

    /// Does any profile atom relate to it, either way?
    fn related(&self, known: &Known) -> bool {
        !self.abbreviates.is_empty()
            || self.row.fits.iter().any(|f| *f != Fit::None)
            || known.back(&self.row, &self.atom)
    }
}

/// The atoms of an alternative and, for the entries' side, the parts of its hyphenated
/// compounds too.
struct Alternative {
    atoms: Vec<Asked>,
    /// The best fit of the atoms and the parts for each profile atom.
    best: Vec<Fit>,
}

impl Alternative {
    fn new(skills: &Skills, job: &[String]) -> Self {
        let atoms: Vec<Asked> = job.iter().map(|a| Asked::new(skills, a)).collect();
        let parts: Vec<Asked> = job
            .iter()
            .filter(|a| a.contains('-'))
            .flat_map(|a| a.split('-').filter(|p| p.len() >= 2))
            .map(|p| Asked::new(skills, p))
            .collect();
        let best = (0..skills.known.atoms().len())
            .map(|i| {
                let all = atoms.iter().chain(&parts);
                all.map(|j| j.fit(i)).max().unwrap_or(Fit::None)
            })
            .collect();
        Self { atoms, best }
    }
}

/// A free-text entry (a long description): containing a requirement is weaker evidence than
/// a competence entry.
fn sentence_like(entry: &Entry) -> bool {
    entry.atoms.iter().filter(|a| !atoms::is_generic(a)).count() >= SENTENCE_ATOMS
}

/// One entry against the atoms of one alternative.
fn entry_fit(job: &Alternative, whole: &Entry) -> (u16, Via) {
    let entry = &whole.atoms;
    let fits: Vec<Fit> = whole.ids.iter().map(|&i| job.best[i]).collect();
    let matched = fits.iter().filter(|f| **f != Fit::None).count();
    // Nothing of the entry is asked for (most entries for most items).
    if matched == 0 {
        return (E_NONE, Via::Exact);
    }
    let generic_only = entry
        .iter()
        .zip(&fits)
        .filter(|(_, f)| **f != Fit::None)
        .all(|(p, _)| atoms::is_generic(p));
    let whole_item = job
        .atoms
        .iter()
        .all(|j| whole.ids.iter().any(|&i| j.fit(i) != Fit::None));
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
    let content: Vec<&Asked> = job
        .atoms
        .iter()
        .filter(|j| !atoms::is_generic(&j.atom))
        .collect();
    let name_words_only = entry.len() >= 2
        && content
            .iter()
            .all(|j| lex::NAME_WORDS.contains(&j.atom.as_str()));
    if !content.is_empty()
        && !name_words_only
        && content.iter().all(|j| {
            whole
                .ids
                .iter()
                .any(|&i| matches!(j.fit(i), Fit::Equal | Fit::Specific))
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
    (E_NONE, Via::Exact)
}

/// Does any profile atom relate to this job atom (a hyphenated atom through its parts)?
fn covered(skills: &Skills, atom: &Asked) -> bool {
    let known = &skills.known;
    atom.related(known)
        || (atom.atom.contains('-')
            && atom
                .atom
                .split('-')
                .filter(|p| p.len() >= 3 && !atoms::is_generic(p))
                .all(|p| Asked::new(skills, p).related(known)))
}

/// The best entry on the ladder for the atoms of a requirement (`industries`: the profile's
/// industries count too), the first of equals.
fn best_entry(skills: &Skills, job: &Alternative, industries: bool) -> ItemFit {
    let mut best = NONE;
    for (index, entry) in skills.entries.iter().enumerate() {
        if !industries && entry.industry {
            continue;
        }
        let (value, via) = entry_fit(job, entry);
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
    let job = joined(atoms::atoms(text, &skills.vocab).to_vec(), &skills.joins);
    if job.is_empty() {
        return NONE;
    }
    let asked = Alternative::new(skills, &job);
    let mut best = best_entry(skills, &asked, true);
    // An industry of the profile meets a requirement through a compound only when the
    // requirement asks for an industry (`Kommunikationsfähigkeit` is no `Telekommunikation`);
    // its own name it always meets.
    if best.via != Via::Exact
        && best
            .entry
            .and_then(|e| skills.entries.get(e))
            .is_some_and(|e| e.industry)
        && !industry_only(text, &skills.vocab)
    {
        best = best_entry(skills, &asked, false);
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
    // The ad asks for more than the profile names (`Tableau im Reporting` against
    // `Reporting`): the profile is more general, half.
    // Words of experience (`Berufserfahrung`, `Projekterfahrung`, `Praxis`) ask for nothing
    // more: what the profile names literally stays met (engine 22).
    if best.value == E_FULL
        && asked.atoms.iter().any(|j| {
            !atoms::is_generic(&j.atom) && !experience_atom(&j.atom) && !covered(skills, j)
        })
    {
        // An industry is the setting of a requirement, never its function
        // (`Vertriebserfahrung im Maschinenbau` is not half met by `Maschinenbau`).
        let industry = best
            .entry
            .and_then(|e| skills.entries.get(e))
            .is_some_and(|e| e.industry);
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
    for atom in atoms::atoms(text, vocab).iter() {
        if industry_atom(atom) {
            any = true;
        } else if !(atoms::is_generic(atom) || experience_atom(atom)) {
            return false;
        }
    }
    any
}

/// Does an atom name an industry or a setting (`pharmaindustri`, `banken`, `produzierend`)?
fn industry_atom(atom: &str) -> bool {
    use super::lexicon::wishes;
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
        || INDUSTRY_STEMS.0.iter().any(|e| atom.ends_with(e.as_str()))
        || INDUSTRY_STEMS
            .1
            .iter()
            .any(|n| atom.starts_with(n.as_str()))
        || lex::SETTING_WORDS.iter().any(|w| atom.starts_with(w))
}

/// The stems of the industry endings and tails, and of the industry nouns.
static INDUSTRY_STEMS: LazyLock<(Vec<String>, Vec<String>)> = LazyLock::new(|| {
    use super::lexicon::terms;
    let endings = terms::INDUSTRY_ENDINGS.iter().chain(terms::INDUSTRY_TAILS);
    (
        endings.map(|e| atoms::stem(e)).collect(),
        terms::INDUSTRY_NOUNS
            .iter()
            .map(|n| atoms::stem(n))
            .collect(),
    )
});

/// The stems of the words of experience (`GENERAL_EXPERIENCE`, `EXPERIENCE_WORDS`).
static EXPERIENCE_STEMS: LazyLock<Vec<String>> = LazyLock::new(|| {
    lex::GENERAL_EXPERIENCE
        .iter()
        .chain(lex::EXPERIENCE_WORDS)
        .map(|w| atoms::stem(w))
        .collect()
});

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
        .position(|e| e.tools.iter().any(|k| kinds.contains(k)))
}

/// An atom that only says experience (`berufserfahr`, `projekterfahr`, `praxis`), not
/// the experience of a function (`Vertriebserfahrung`).
fn experience_atom(atom: &str) -> bool {
    EXPERIENCE_STEMS
        .iter()
        .any(|w| atom.starts_with(w.as_str()))
        || atom == "projekterfahrung"
}

/// An atom of leadership (`fuhrung`, `personalverantwortung`).
pub(crate) fn leadership_atom(atom: &str) -> bool {
    lex::LEADERSHIP_ATOMS
        .iter()
        .any(|l| atom == *l || atom.starts_with(l))
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

/// Is an item general professional experience (`10 Jahre Berufserfahrung`, `8 years of
/// experience`), not experience in a topic (`3-5 Jahre Berufserfahrung im Controlling`)? Its
/// years are judged against the profile's own years (`berufserfahrung_jahre`).
pub(crate) fn general_experience(text: &str, vocab: &Vocab) -> bool {
    let folded = fold(text);
    let experience = |a: &str| EXPERIENCE_STEMS.iter().any(|w| a.starts_with(w.as_str()));
    let topic = atoms::atoms(text, vocab)
        .iter()
        .any(|a| !atoms::is_generic(a) && !experience(a));
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
