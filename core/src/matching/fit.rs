//! The profile the engine matches against, and the match ladder for one item:
//! exact/stem/synonym = 1.0, profile more specific = 1.0, profile more general = 0.5,
//! two thirds of a long phrase = 0.5, generic atoms never alone (V1-V4, V15), language
//! levels (V9), years (V8), degrees (field, relatedness, level) and licences.

use super::atoms::{self, Fit, Vocab, fold};
use super::job::{Class, Item, Stage, contains_word, language_of, names_degree};
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine as lex;
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
        let mut entries: Vec<Entry> = core
            .iter()
            .map(|entry| Entry {
                atoms: atoms::atoms(&entry.text, &vocab),
                years: years(&entry.text),
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
        Self {
            entries,
            languages,
            degree_fields,
            degree_level,
            degrees,
            folded: core.iter().map(|t| fold(&t.text)).collect(),
            total_years,
            vocab,
        }
    }
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
            .map(|j| atoms::fit(j, p))
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
        .all(|j| entry.iter().any(|p| atoms::fit(j, p) != Fit::None));
    if matched == entry.len() && (!generic_only || whole_item) {
        return if fits.contains(&Fit::General) {
            (E_HALF, Via::General)
        } else if fits.contains(&Fit::Specific) {
            (E_FULL, Via::Specific)
        } else {
            (E_FULL, Via::Exact)
        };
    }
    // The item lies inside the entry: the profile is more specific.
    let content: Vec<&String> = job.iter().filter(|j| !atoms::is_generic(j)).collect();
    if !content.is_empty()
        && content.iter().all(|j| {
            entry
                .iter()
                .any(|p| matches!(atoms::fit(j, p), Fit::Equal | Fit::Specific))
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
            .any(|p| atoms::fit(a, p) != Fit::None || atoms::fit(p, a) != Fit::None)
    };
    related(atom)
        || (atom.contains('-')
            && atom
                .split('-')
                .filter(|p| p.len() >= 3 && !atoms::is_generic(p))
                .all(related))
}

fn skill_fit(skills: &Skills, text: &str) -> ItemFit {
    skill_fit_in(skills, text, None)
}

/// The ladder over all entries, or only over `only` (entry indices).
fn skill_fit_in(skills: &Skills, text: &str, only: Option<&[usize]>) -> ItemFit {
    let job = atoms::atoms(text, &skills.vocab);
    if job.is_empty() {
        return NONE;
    }
    let expanded = expand(&job);
    let mut best = NONE;
    for (index, entry) in skills.entries.iter().enumerate() {
        if only.is_some_and(|only| !only.contains(&index)) {
            continue;
        }
        let (value, via) = entry_fit(&job, &expanded, entry);
        if value > best.value {
            best = ItemFit {
                value,
                entry: Some(index),
                via,
            };
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
    // Leadership asked for is met at least half by a leading role in the profile (only an
    // item about leadership alone, not `8 Jahre Controlling, davon 3 mit Führung`).
    if best.value < E_HALF
        && leadership_only(&job)
        && let Some(index) = skills.entries.iter().position(|e| {
            let folded = fold(&e.text);
            atoms::raw_tokens(&folded).any(|t| lex::PROFILE_LEAD_WORDS.contains(&t))
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
    if best.value == E_FULL
        && job
            .iter()
            .any(|j| !atoms::is_generic(j) && !covered(skills, j))
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
    best
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

/// How well only the entries `only` meet a skill item (best alternative, no years). `via`
/// tells whether the item names the entry (exact), something narrower (general, half) or
/// only a broader term inside the entry (specific).
pub(crate) fn focus_fit(skills: &Skills, item: &Item, only: &[usize]) -> ItemFit {
    // An entry that names the item beats one it only lies inside at the same value.
    let rank = |fit: &ItemFit| (fit.value, fit.via != Via::Specific);
    alternatives(item)
        .iter()
        .flat_map(|alt| {
            only.iter()
                .map(move |&index| skill_fit_in(skills, alt, Some(&[index])))
        })
        .fold(
            NONE,
            |best, fit| {
                if rank(&fit) > rank(&best) { fit } else { best }
            },
        )
}

/// Does the title name one of the entries `only` (every atom of the entry, equal)?
pub(crate) fn title_names(skills: &Skills, title: &str, only: &[usize]) -> bool {
    let job = atoms::atoms(title, &skills.vocab);
    if job.is_empty() {
        return false;
    }
    let expanded = expand(&job);
    only.iter()
        .filter_map(|&index| skills.entries.get(index))
        .any(|entry| entry_fit(&job, &expanded, entry) == (E_FULL, Via::Exact))
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
fn other_field(job: &str, profile: &str) -> bool {
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
            .map(|alt| skill_fit(skills, alt))
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
        if general && fit.value == E_NONE {
            // General experience is judged by the profile's own years alone (none stated: no
            // verdict, the item stays open and the engine does not weigh it).
            if let Some(have) = have {
                fit = ItemFit {
                    value: years_value(have, needed),
                    entry: None,
                    via: Via::Exact,
                };
            }
        } else if fit.value > E_NONE
            && let Some(have) = have
            && have < needed
        {
            fit.value = years_value(have, needed).min(fit.value);
        }
    }
    fit
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::matching::profile::core_texts;
    use crate::profile::of_json;

    /// Knowledge of a product family (`SAP-Kenntnisse`) is met by an entry naming a product
    /// of it; a product of the family asked for is not (`SAP BW`).
    #[test]
    fn a_family_is_met_by_its_products() {
        let data = of_json(
            &json!({"kernkompetenzen": [{"kompetenz": "SAP S/4HANA"}, {"kompetenz": "CFO"}]}),
        );
        let skills = Skills::new(&core_texts(&data), &data);
        assert_eq!(
            skill_fit_in(&skills, "Sehr gute SAP-Kenntnisse", None).value,
            E_FULL
        );
        assert_eq!(
            skill_fit_in(&skills, "Kenntnisse in SAP BW", None).value,
            E_NONE
        );
        assert_eq!(skill_fit_in(&skills, "SAP", None).value, E_NONE);
        // Leadership alone is met half by a leading role; inside another skill it is not.
        assert_eq!(
            skill_fit_in(&skills, "Führungserfahrung", None).value,
            E_HALF
        );
        assert_eq!(
            skill_fit_in(
                &skills,
                "8 Jahre Controlling, davon 3 mit Führungsverantwortung",
                None
            )
            .value,
            E_NONE
        );
    }

    /// A licence counts under any of its names (`Sachkundige Person` for a `Qualified
    /// Person`).
    #[test]
    fn licences_under_any_name() {
        let data = of_json(
            &json!({"kernkompetenzen": [{"kompetenz": "Sachkundige Person nach § 15 AMG"}]}),
        );
        let skills = Skills::new(&core_texts(&data), &data);
        assert_eq!(licence_fit(&skills, "qualified person").value, E_FULL);
        assert_eq!(licence_fit(&skills, "sachkundige person").value, E_FULL);
        assert_eq!(licence_fit(&skills, "steuerberater").value, E_NONE);
    }

    /// An industry of the profile is the setting of a requirement, never its function:
    /// `Vertrieb im Maschinenbau` is not met, even half, by the industry `Maschinenbau`.
    #[test]
    fn an_industry_is_the_setting_not_the_function() {
        let data = of_json(&json!({
            "kernkompetenzen": [{"kompetenz": "Controlling"}],
            "branchen": [{"branche": "Maschinenbau"}]
        }));
        let skills = Skills::new(&core_texts(&data), &data);
        let fit = |text: &str| skill_fit_in(&skills, text, None).value;
        assert_eq!(fit("Vertriebserfahrung im Maschinenbau"), E_NONE);
        assert_eq!(fit("Controlling im Maschinenbau"), E_FULL);
        assert_eq!(fit("Controlling in der Automobilindustrie"), E_HALF);
    }

    /// A teaser's term met only through a compound of another field is half
    /// (`Personalcontrolling` for `Controlling`); a compound of its own field stays full.
    #[test]
    fn a_teaser_term_in_another_field_is_half() {
        let term = |profile: &str| {
            let data = of_json(&json!({"kernkompetenzen": [{"kompetenz": profile}]}));
            let skills = Skills::new(&core_texts(&data), &data);
            let item = Item {
                span: None,
                text: "controlling".to_owned(),
                alternatives: vec!["controlling".to_owned()],
                kind: crate::matching::sections::ReqKind::Must,
                class: Class::Skill,
                years: None,
                years_max: None,
                stage: Stage::Vocabulary,
            };
            item_fit(&skills, &item).value
        };
        assert_eq!(term("Personalcontrolling"), E_HALF);
        assert_eq!(term("Konzerncontrolling"), E_FULL);
        assert_eq!(term("Controlling"), E_FULL);
    }
}
