//! The engine: requirements read from the job (V5-V7, V16), each item scored on the
//! ladder (V1-V4, V8, V9, V15), hard criteria decided or checked (V10-V13), relevance
//! (V17, V18), the signals of the job ([`signals`]) and the learned points (engine 24).
//! Integer arithmetic only.
//!
//! `points = clamp(learned(signals) + clamp(sum(wishes), -100, 100), 0, 1000)`, a permanent
//! role `* 0.9`, `score = round_half_even(points/10)`, then the lowest cap that fired.

use std::ops::Range;

use serde_json::{Value, json};

use super::ad_facts::{self, AdFacts};
use super::atoms::{self, Fit, Vocab, fold};
use super::contract::{self, Contract, ContractKind};
use super::exclusion;
use super::facts::{self, Finding, HardCriteria, JobFacts, Segment};
use super::fit::{self, ItemFit, Skills};
use super::job::{self, Class, Item, Stage};
use super::lexicon::engine as lex;
use super::limits;
use super::normalize::{char_len, strip};
use super::params::{
    E_FULL, E_HALF, E_NONE, FORMAL_CAP, JUNIOR_CAP, LANGUAGE_MUST_LEVEL, LEVEL_CAP,
    LOW_EVIDENCE_ITEMS, MIN_TEXT_CHARS, OFF_FIELD_CAP, OFF_FIELD_SINGLE_CAP, OFF_FIELD_TITLE_FIT,
    PERMANENT_FACTOR, SENIOR_YEARS, SEVERAL_OPEN_CAP, THIN_MUSTS, THIN_TEXT_CHARS, W_MUST, W_SOFT,
    W_TERM, WISH_MAX,
};
use super::permanent;
use super::profile::{self, CoreText};
use super::relevance;
use super::roles::{self, Role, RoleFit};
use super::score::div_round_half_even;
use super::scorer;
use super::sections::ReqKind;
use super::seniority;
use super::signals::{self, Signals};
use super::title::{self, Distance, ProfileLevel};
use super::types::{EvidenceLevel, JobInput, ReasonCode, TextKind, Verdict, Via};
use super::wishes::{self, WishResult, Wishes};
use crate::profile::{ProfileForm, key};

/// A profile prepared for the engine.
pub(crate) struct EngineProfile {
    /// The core competences as the profile names them.
    pub core: Vec<CoreText>,
    pub skills: Skills,
    pub criteria: HardCriteria,
    pub query: Vec<(String, u64)>,
    /// The query plus the topics of the target roles: what the title may name.
    pub title_query: Vec<(String, u64)>,
    pub roles: Vec<Role>,
    pub wishes: Wishes,
    /// The levels of the target roles and the profile's highest (engine 23).
    pub level: ProfileLevel,
    /// The field families of the profile's packs (engine 23).
    pub fields: Vec<&'static str>,
    /// The level of the profile's own roles: its target roles and the roles its competences
    /// name, never its years (what its role brings, `fit::role_brings`).
    pub brings: u8,
}

impl EngineProfile {
    pub(crate) fn new(form: &ProfileForm) -> Self {
        let core = profile::core_texts(form);
        let skills = Skills::new(&core, form);
        let criteria = HardCriteria::new(form);
        let query = relevance::query(&skills);
        let roles = roles::read(form, &skills.vocab);
        let title_query = relevance::title_query(&query, &roles::topics(&roles));
        let wishes = Wishes::new(form);
        let level = ProfileLevel::new(form.roles.iter().map(String::as_str), skills.total_years);
        let fields = title::profile_fields(skills.vocab.packs());
        let brings = level
            .wished
            .iter()
            .copied()
            .chain(
                form.competences
                    .iter()
                    .filter_map(|c| title::level_of(&c.name)),
            )
            .max()
            .unwrap_or(0);
        Self {
            core,
            skills,
            criteria,
            query,
            title_query,
            roles,
            wishes,
            level,
            fields,
            brings,
        }
    }
}

/// One item with its fit and weight.
#[derive(Debug, Clone)]
pub(crate) struct Scored {
    pub item: Item,
    pub fit: ItemFit,
    pub weight: u64,
}

/// Everything the engine found for one job.
#[derive(Debug, Clone)]
pub(crate) struct Evaluation {
    pub items: Vec<Scored>,
    pub findings: Vec<Finding>,
    pub verdict: Verdict,
    pub score: u8,
    pub evidence: EvidenceLevel,
    pub short: bool,
    /// The best target role and the title it met.
    pub role: Option<(RoleFit, String)>,
    /// The wishes with their points (per-mille).
    pub wishes: Vec<WishResult>,
    /// What the ad states about rate, start, duration, remote share, place and contract.
    pub facts: AdFacts,
    /// The score in per-mille before the caps and the rounding: orders jobs with the same
    /// score (two jobs capped at 40 are not equally good).
    pub rank: u16,
    /// The cap that held the score down, with the highest score it allows (none when the
    /// rounded score stays at or below every cap).
    pub capped: Option<(CapKind, u8)>,
    /// The ad's level and how many levels it stands below the profile (none at a level the
    /// profile wants or without a level).
    pub level: Option<(u8, u8)>,
    /// The ad's field family and its distance to the profile's.
    pub field: Option<(&'static str, Distance)>,
    /// What the engine read, as the learned scorer's inputs (engine 24 groundwork).
    pub signals: Signals,
    /// Every cap that fired, with the highest score it allows (the lowest one holds).
    pub caps: Vec<Cap>,
    /// The contract type the ad states.
    pub contract: ContractKind,
}

/// Why a score is capped (the rubric's caps, a text without requirements, a junior role).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CapKind {
    /// An open formal must (a degree of another field, a licence).
    Formal,
    /// Several musts open (at least two and at least half).
    SeveralOpen,
    /// No skill must met at all: outside the field.
    OffField,
    /// A junior or entry-level role for a senior profile.
    Junior,
    /// A role two or more levels below the profile (engine 23).
    Level,
}

impl CapKind {
    /// The code the interface reads (`Factor` params).
    pub(crate) fn code(self) -> &'static str {
        match self {
            CapKind::Formal => "formal",
            CapKind::SeveralOpen => "severalOpen",
            CapKind::OffField => "offField",
            CapKind::Junior => "junior",
            CapKind::Level => "level",
        }
    }
}

/// A cap with its kind; the lower of two, the first of two alike.
pub(crate) type Cap = (u8, CapKind);

fn lower(a: Cap, b: Cap) -> Cap {
    if b.0 < a.0 { b } else { a }
}

fn weight(item: &Item) -> u64 {
    match (&item.class, item.stage) {
        (Class::Frame, _) => 0,
        // A language is a hygiene factor: met, it says little about the field.
        (Class::Soft | Class::Language(..), _) => W_SOFT,
        (_, Stage::Vocabulary) => W_TERM,
        _ => W_MUST,
    }
}

/// The one definition of a must, read by the signals, the caps, the evidence and the
/// summary: a must the engine weighs (a skill, degree or licence, a teaser's term), never a
/// soft skill; a language only while it counts against the profile (asked at C1 or higher
/// and not met in full; met it is hygiene and adds nothing).
pub(crate) fn is_must(s: &Scored) -> bool {
    s.item.kind == ReqKind::Must
        && s.weight > 0
        && match &s.item.class {
            Class::Soft | Class::Frame => false,
            Class::Language(_, level) => {
                level.is_some_and(|l| l >= LANGUAGE_MUST_LEVEL) && s.fit.value < E_FULL
            }
            _ => true,
        }
}

/// The weight a must carries in the evidence: a language that counts against weighs like a
/// skill.
fn must_weight_of(s: &Scored) -> u64 {
    if matches!(s.item.class, Class::Language(..)) {
        W_MUST
    } else {
        s.weight
    }
}

/// A nice-to-have that counts in the summary (soft skills and languages add nothing).
pub(crate) fn is_nice(s: &Scored) -> bool {
    s.item.kind == ReqKind::Nice
        && s.weight > 0
        && !matches!(
            s.item.class,
            Class::Soft | Class::Frame | Class::Language(..)
        )
}

/// Formal requirements the profile does not hold: without any degree in the profile a
/// check (a cap only for a degree the ad makes mandatory without an equivalent); a must degree of another field or a missing licence is a check with
/// a score cap, decided only when the ad makes it mandatory; a certificate the ad makes
/// mandatory and the profile does not hold in full is decided too.
/// (`Six Sigma Black Belt Zertifizierung (zwingend)` for a Green Belt)
fn formal(profile: &EngineProfile, items: &[Scored]) -> (Vec<Finding>, bool) {
    let mut findings = Vec::new();
    let mut cap = false;
    let mut no_degree = false;
    for s in items {
        let folded = fold(&s.item.text);
        let mandatory = lex::MANDATORY_WORDS.iter().any(|w| folded.contains(w));
        let certificate = s.item.class == Class::Skill
            && mandatory
            && lex::CERTIFICATE_WORDS.iter().any(|w| folded.contains(w));
        let class = match s.item.class {
            Class::Degree => "degree",
            Class::Licence(_) => "licence",
            _ if certificate => "certificate",
            _ => continue,
        };
        if class == "degree" && profile.skills.degree_fields.is_none() {
            no_degree = true;
            // Unknown: it caps only where the ad makes it mandatory without an equivalent.
            let comparable = lex::COMPARABLE_WORDS.iter().any(|w| folded.contains(w));
            if s.item.kind == ReqKind::Must && mandatory && !comparable {
                cap = true;
                findings.push(Finding::new(
                    ReasonCode::FormalOpen,
                    false,
                    None,
                    json!({ "class": class, "mandatory": true }),
                    s.item.span.clone().into_iter().collect(),
                ));
            }
            continue;
        }
        let held = if certificate {
            s.fit.value == E_FULL
        } else {
            s.fit.value != E_NONE
        };
        if s.item.kind != ReqKind::Must || held {
            continue;
        }
        cap = true;
        findings.push(Finding::new(
            ReasonCode::FormalOpen,
            mandatory,
            None,
            json!({ "class": class, "mandatory": mandatory }),
            s.item.span.clone().into_iter().collect(),
        ));
    }
    if no_degree && findings.is_empty() {
        findings.push(Finding::new(
            ReasonCode::FormalOpen,
            false,
            None,
            json!({}),
            Vec::new(),
        ));
    }
    (findings, cap)
}

/// The rubric's caps: an open formal must; several musts open (at least two and at least
/// half) with the core of the role among them; no skill must met at all (outside the field: at least two, or the only one when
/// the title names nothing of the profile either); an open must on the topic of the title
/// (the core of the role).
fn cap(items: &[Scored], title: &str, vocab: &Vocab, formal_cap: bool, title_fit: u64) -> Vec<Cap> {
    let musts: Vec<&Scored> = items.iter().filter(|s| is_must(s)).collect();
    let open = musts.iter().filter(|s| s.fit.value == E_NONE).count();
    let several_open = open >= 2 && 2 * open >= musts.len();
    // Only explicit requirements, never a teaser's vocabulary terms; a must of generic words
    // and leadership alone (`SAP-Kenntnisse`, `Erste Führungserfahrung`) names no field.
    let names_field = |s: &Scored| {
        let atoms = atoms::atoms(&s.item.text, vocab);
        atoms.is_empty()
            || atoms
                .iter()
                .any(|a| !atoms::is_generic(a) && !fit::leadership_atom(a))
    };
    let skills: Vec<&&Scored> = musts
        .iter()
        .filter(|s| s.item.class == Class::Skill && s.item.stage != Stage::Vocabulary)
        .filter(|s| names_field(s))
        .collect();
    let all_open = !skills.is_empty() && skills.iter().all(|s| s.fit.value == E_NONE);
    let off_field = all_open && skills.len() >= 2;
    // The only skill must open and a title that names little of the profile: off the field
    // too, a little milder (one requirement is thin evidence).
    let off_field_single = all_open && skills.len() == 1 && title_fit < OFF_FIELD_TITLE_FIT;
    let title_atoms = roles::title_core(title, vocab);
    let related = |a: &str, t: &str| {
        matches!(atoms::fit(a, t), Fit::Equal | Fit::Specific)
            || matches!(atoms::fit(t, a), Fit::Equal | Fit::Specific)
    };
    // A teaser's term from the title counts here like an explicit must.
    let core_open = musts
        .iter()
        .filter(|s| s.item.class == Class::Skill)
        .any(|s| {
            s.fit.value == E_NONE
                && atoms::atoms(&s.item.text, vocab)
                    .iter()
                    .any(|a| !atoms::is_generic(a) && title_atoms.iter().any(|t| related(a, t)))
        });
    [
        formal_cap.then_some((FORMAL_CAP, CapKind::Formal)),
        // Several musts open cap at 40 only with the core of the role open: open peripheral
        // musts cost their share of `M`, no more (engine 22).
        (several_open && core_open).then_some((SEVERAL_OPEN_CAP, CapKind::SeveralOpen)),
        off_field.then_some((OFF_FIELD_CAP, CapKind::OffField)),
        off_field_single.then_some((OFF_FIELD_SINGLE_CAP, CapKind::OffField)),
    ]
    .into_iter()
    .flatten()
    .collect()
}

/// The weight of the musts ([`is_must`]): what the evidence level reads.
fn must_weight(items: &[Scored]) -> u64 {
    items
        .iter()
        .filter(|s| is_must(s))
        .map(must_weight_of)
        .sum()
}

/// Contract type and the findings of the hard criteria (ANÜ, country, day rate,
/// availability, salary and region of permanent roles).
fn criteria_findings(
    profile: &EngineProfile,
    facts: &JobFacts<'_>,
    segments: &[Segment],
    folded: &str,
) -> (Vec<Finding>, Contract) {
    let anue = facts::anue(facts, segments);
    let contract = contract::infer(facts, segments, &anue);
    let criteria = &profile.criteria;
    let mut findings = facts::check(criteria, facts, segments, folded, &contract, anue);
    findings.extend(permanent::salary(
        criteria,
        &contract,
        facts.title,
        segments,
    ));
    (findings, contract)
}

/// The target role the title matches and the wishes for one ad.
fn preferences(
    profile: &EngineProfile,
    ad: &wishes::Ad<'_>,
    title: &str,
    level: Option<u8>,
) -> (Option<(RoleFit, String)>, Vec<WishResult>) {
    let criteria = &profile.criteria;
    let allowed = match ad.contract {
        ContractKind::Interim => !criteria.project_excluded,
        ContractKind::Permanent => !criteria.permanent_excluded,
        ContractKind::Anue => !criteria.anue_excluded,
        ContractKind::Unclear => false,
    };
    let fit = roles::best(
        &profile.roles,
        title,
        ad.vocab,
        (ad.contract, allowed),
        level,
    );
    let role = fit.map(|fit| (fit, title.to_owned()));
    (role, wishes::evaluate(&profile.wishes, ad))
}

/// How much the text allowed to assess: a teaser, low (vocabulary terms, no weighted
/// must, fewer than two weighted items, a long text read thin) or full.
fn evidence_level(
    kind: TextKind,
    items: &[Scored],
    must_weight: u64,
    text_chars: usize,
) -> EvidenceLevel {
    let hard_items = items.iter().filter(|s| s.weight > 0).count();
    let vocabulary = items.iter().any(|s| s.item.stage == Stage::Vocabulary);
    let weighted_musts = items.iter().filter(|s| is_must(s)).count();
    let thin = text_chars >= THIN_TEXT_CHARS && weighted_musts < THIN_MUSTS;
    if kind == TextKind::Teaser {
        EvidenceLevel::Teaser
    } else if vocabulary || must_weight == 0 || hard_items < LOW_EVIDENCE_ITEMS || thin {
        EvidenceLevel::Low
    } else {
        EvidenceLevel::Full
    }
}

/// Every requirement item with its fit and weight. A must met only through the profile's
/// tools (`methoden_tools`) counts half unless the title names that tool: a tool on the list
/// proves use, a competence proves the work (engine 22).
///
/// In a field far from the profile's (engine 23) every must counts half: what meets it there
/// is work the profile carries from its own field.
fn scored(profile: &EngineProfile, items: Vec<Item>, title: &str, far: bool) -> Vec<Scored> {
    let title_atoms = atoms::atoms(title, &profile.skills.vocab);
    items
        .into_iter()
        .map(|item| {
            let mut fit = fit::item_fit(&profile.skills, &item);
            // An industry the profile lacks costs little and never caps (the rubric's rule 5):
            // half met, never open.
            if fit.value == E_NONE
                && item.class == Class::Skill
                && fit::industry_only(&item.text, &profile.skills.vocab)
            {
                fit = ItemFit {
                    value: E_HALF,
                    entry: None,
                    via: Via::General,
                };
            }
            // What follows from the profile's role counts as shown (the rubric's rule 2).
            if fit.value < E_FULL
                && matches!(item.class, Class::Skill | Class::Soft)
                && fit::role_brings(profile.brings, &item.text, &profile.skills.vocab)
            {
                fit = ItemFit {
                    value: E_FULL,
                    entry: None,
                    via: Via::Exact,
                };
            }
            if item.kind == ReqKind::Must
                && let Some(entry) = fit.entry.and_then(|e| profile.skills.entries.get(e))
                && entry.path.starts_with(key::TOOLS)
                && !entry
                    .atoms
                    .iter()
                    .filter(|a| !atoms::is_generic(a))
                    .any(|a| title_atoms.iter().any(|t| atoms::fit(t, a) == Fit::Equal))
            {
                fit.value /= 2;
            }
            if far && item.kind == ReqKind::Must {
                fit.value /= 2;
            }
            // General experience without the profile's years: nothing to judge it by.
            // A degree while the profile names none: unknown, a small minus, no must
            // (engine 22).
            let unjudged = (item.years.is_some()
                && profile.skills.total_years.is_none()
                && fit::general_experience(&item.text, &profile.skills.vocab))
                || (item.class == Class::Degree && profile.skills.degree_fields.is_none());
            // Filler and hygiene (office tools, travel, team player) are neutral: met or
            // open, no must (the rubric's rule 4).
            let hygiene =
                matches!(item.class, Class::Skill | Class::Soft) && signals::is_hygiene(&item.text);
            Scored {
                weight: if unjudged || hygiene {
                    0
                } else {
                    weight(&item)
                },
                fit,
                item,
            }
        })
        .collect()
}

/// The fields of a job the hard criteria read (the ad without the other listings under it).
fn job_facts<'a>(job: &JobInput<'a>) -> JobFacts<'a> {
    JobFacts {
        title: job.title,
        text: facts::own_text(job.text),
        location: job.location,
        portal: job.portal,
        facts: job.facts,
        posted: job.posted,
    }
}

/// Every cap of a job: the rubric's caps and a junior role for a senior profile
/// (`JUNIOR_CAP`). A title that meets a target role lifts no cap (the rubric: a target role
/// never lifts a cap), the off-field cap included.
fn all_caps(
    profile: &EngineProfile,
    items: &[Scored],
    title: &str,
    job: &JobInput<'_>,
    formal_cap: bool,
) -> Vec<Cap> {
    let vocab = &profile.skills.vocab;
    let title_fit = relevance::title_fit(&profile.query, title, vocab);
    cap(items, title, vocab, formal_cap, title_fit)
        .into_iter()
        .chain(
            junior_for_senior(profile, job.title, &page_levels(job), items)
                .then_some((JUNIOR_CAP, CapKind::Junior)),
        )
        .collect()
}

/// A junior role for a profile with `SENIOR_YEARS` or more: a junior title (`Junior`,
/// `Werkstudent`, `Trainee`, `Berufseinstieg`), a junior or entry level the page states (an
/// internship), or a must that asks for first professional experience (`Erste
/// Berufserfahrung`, `Berufseinsteiger`, `Absolvent`). A level mismatch whatever the skills.
fn junior_for_senior(
    profile: &EngineProfile,
    title: &str,
    levels: &[String],
    items: &[Scored],
) -> bool {
    profile
        .skills
        .total_years
        .is_some_and(|years| years >= SENIOR_YEARS)
        && (seniority::junior_title(title)
            || seniority::page_junior_level(levels).is_some()
            || seniority::entry_level_must(items.iter().map(|s| &s.item)))
}

/// The page's own career level and employment type (LinkedIn's criteria), folded.
fn page_levels(job: &JobInput<'_>) -> Vec<String> {
    [super::fact_key::LEVEL, super::fact_key::CONTRACT]
        .iter()
        .filter_map(|key| facts::fact(job.facts, key).and_then(Value::as_str))
        .map(fold)
        .collect()
}

/// The relevance `R'` of a job: lexical and title fit; without any requirement only the title speaks for the field (a teaser's few words name
/// tools of every field).
fn relevance_of(
    profile: &EngineProfile,
    job: &JobInput<'_>,
    title: &str,
    requirement_lines: &[Range<usize>],
    no_items: bool,
) -> u64 {
    let vocab = &profile.skills.vocab;
    if no_items {
        return relevance::field_title_fit(&profile.title_query, title, vocab);
    }
    // With requirements the target role is a signal of its own (not in the title fit).
    relevance::relevance(
        &profile.query,
        &profile.query,
        vocab,
        title,
        job.text,
        requirement_lines,
    )
    .min(1000)
}

/// The points of a job before the caps (engine 24, per-mille): the learned fit
/// ([`scorer::learned`]), the bounded wishes and a permanent role at `PERMANENT_FACTOR`. The
/// rubric's caps then limit the result in [`final_score`], so no wish lifts past them
/// (`tools/scorer/train.py` replays this order: change both together).
fn points(signals: &Signals, wishes: &[WishResult], contract: ContractKind) -> u64 {
    let fit = i64::from(scorer::learned(signals));
    let wish = wishes
        .iter()
        .map(|w| w.points)
        .sum::<i64>()
        .clamp(-WISH_MAX, WISH_MAX);
    let mut points = u64::try_from((fit + wish).clamp(0, 1000)).unwrap_or(0);
    if contract == ContractKind::Permanent {
        points = points * PERMANENT_FACTOR / 1000;
    }
    points
}

/// The score (rounded and capped; 0 when unscorable), the rank (the
/// per-mille score before caps and rounding) and the cap that held the score down.
fn final_score(
    adjusted: u64,
    cap: Option<Cap>,
    unscorable: bool,
) -> (u8, u16, Option<(CapKind, u8)>) {
    if unscorable {
        return (0, 0, None);
    }
    let rounded = u8::try_from(div_round_half_even(adjusted, 10).min(100)).unwrap_or(100);
    let score = cap.map_or(rounded, |(c, _)| rounded.min(c));
    let capped = cap.filter(|&(c, _)| c < rounded).map(|(c, kind)| (kind, c));
    (score, u16::try_from(adjusted).unwrap_or(1000), capped)
}

/// The level of the ad against the profile's years (the same for every profile: all packs,
/// not the profile's; `own`: the ad without the other listings under it), the limits of an
/// engagement (checks) and the exclusion words (they exclude where they name the job itself:
/// the title, the page's level, a sentence that states the role).
fn limit_findings(
    profile: &EngineProfile,
    job: &JobInput<'_>,
    own: &str,
    segments: &[Segment],
    ad: &AdFacts,
    doc: &job::JobDoc,
) -> Vec<Finding> {
    let criteria = &profile.criteria;
    let levels = page_levels(job);
    let total = profile.skills.total_years;
    let mut findings = seniority::check(total, job.title, own, doc, &levels);
    findings.extend(limits::workload(criteria, ad));
    findings.extend(limits::duration(criteria, ad));
    findings.extend(exclusion::check(
        criteria,
        job.title,
        &levels,
        segments,
        &doc.requirement_lines,
    ));
    findings
}

/// The level of the role and the field of the ad against the profile's (engine 23).
struct Frame {
    level: Option<u8>,
    /// Levels below the profile ([`ProfileLevel::gap`]).
    gap: u8,
    field: Option<(&'static str, Distance)>,
}

impl Frame {
    fn of(profile: &EngineProfile, title: &str, own: &str, items: &[Item]) -> Self {
        let level = title::ad_level(title, own);
        let musts = items
            .iter()
            .filter(|i| i.kind == ReqKind::Must)
            .map(|i| i.text.as_str());
        Self {
            level,
            gap: profile.level.gap(level),
            field: title::field(&profile.fields, title, musts),
        }
    }

    /// Two or more levels below the target roles cap at `LEVEL_CAP`.
    fn cap(&self, profile: &EngineProfile) -> Option<Cap> {
        (self.gap >= 2 && !profile.level.wished.is_empty()).then_some((LEVEL_CAP, CapKind::Level))
    }

    /// The ad's level and its gap, when it stands below the profile.
    fn below(&self) -> Option<(u8, u8)> {
        self.level.filter(|_| self.gap > 0).map(|l| (l, self.gap))
    }
}

/// Assesses one job.
pub(crate) fn evaluate(profile: &EngineProfile, job: &JobInput<'_>) -> Evaluation {
    let text = job.text;
    let vocab = &profile.skills.vocab;
    let facts = job_facts(job);
    // The hard criteria and the seniority read the ad only, not the other listings under it.
    let own = facts::own_text(job.text);
    let segments = facts::segments(own);
    let folded = fold(own);
    let (mut findings, stated_contract) = criteria_findings(profile, &facts, &segments, &folded);
    let contract = stated_contract.kind;
    let short = char_len(strip(text)) < MIN_TEXT_CHARS;
    // The title without gender markers and marketing tails (what the role is).
    let title = title::clean(job.title);
    // A short text still has its title: it is judged from the title and the field, without a
    // penalty for little text (the rubric's rule 8).
    let title_only = short;
    let doc = if short {
        job::JobDoc::default()
    } else {
        job::read(text, vocab)
    };
    let ad_facts = ad_facts::read(&facts, &segments, &folded, &stated_contract);
    findings.extend(limit_findings(
        profile, job, own, &segments, &ad_facts, &doc,
    ));
    let requirement_lines = doc.requirement_lines;
    let frame = Frame::of(profile, &title, own, &doc.items);
    let far = matches!(frame.field, Some((_, Distance::Far)));
    let items = scored(profile, doc.items, &title, far);
    let relevance = relevance_of(profile, job, &title, &requirement_lines, items.is_empty());
    let evidence = evidence_level(job.kind, &items, must_weight(&items), char_len(strip(text)));
    let (formal, formal_cap) = formal(profile, &items);
    findings.extend(formal);
    let decided = findings.iter().any(|f| f.decided);

    let readable = !short || title_only;
    let (role, wishes) = if readable {
        let ad = wishes::Ad {
            job: &facts,
            segments: &segments,
            folded: &folded,
            contract,
            vocab,
        };
        preferences(profile, &ad, &title, frame.level)
    } else {
        (None, Vec::new())
    };
    // A short text whose title names neither the field nor a target role stays unscorable.
    let unscorable = !readable || (short && relevance == 0 && role.is_none());
    let (role, wishes) = if unscorable {
        (None, Vec::new())
    } else {
        (role, wishes)
    };
    let caps: Vec<Cap> = all_caps(profile, &items, &title, job, formal_cap)
        .into_iter()
        .chain(frame.cap(profile))
        .collect();
    let cap = caps.iter().copied().reduce(lower);
    let signals = signals::compute(
        profile,
        &signals::Parts {
            title: &title,
            own,
            items: &items,
            relevance,
            role: role.as_ref().map(|(fit, _)| fit),
            ad_level: frame.level,
            gap: frame.gap,
            field: frame.field.map(|(_, d)| d),
            evidence,
            formal_open: formal_cap,
        },
    );
    let adjusted = points(&signals, &wishes, contract);
    let (score, rank, capped) = final_score(adjusted, cap, unscorable);
    let verdict = match (decided, unscorable) {
        (true, _) => Verdict::Excluded,
        (false, true) => Verdict::Unscorable,
        (false, false) => Verdict::Scored,
    };
    Evaluation {
        items,
        findings,
        verdict,
        score,
        evidence,
        short,
        role,
        wishes,
        facts: ad_facts,
        rank,
        capped,
        level: frame.below(),
        field: frame.field,
        signals,
        caps,
        contract,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::wishes::State;

    fn must(value: u16) -> Scored {
        Scored {
            item: Item {
                span: None,
                text: "SAP FI".into(),
                alternatives: Vec::new(),
                kind: ReqKind::Must,
                class: Class::Skill,
                years: None,
                years_max: None,
                stage: Stage::Section,
            },
            fit: ItemFit {
                value,
                entry: None,
                via: Via::Exact,
            },
            weight: W_MUST,
        }
    }

    fn lift(points: i64) -> Vec<WishResult> {
        vec![WishResult {
            code: ReasonCode::RemoteWish,
            state: State::Met,
            points,
            params: json!({}),
            spans: Vec::new(),
        }]
    }

    /// A long text read with fewer than three weighted musts is low evidence; a short one
    /// with two is not.
    #[test]
    fn a_long_text_read_thin_is_low_evidence() {
        let two = [must(E_FULL), must(E_FULL)];
        let level = |items: &[Scored], chars| evidence_level(TextKind::Full, items, W_MUST, chars);
        assert_eq!(level(&two, 1200), EvidenceLevel::Full);
        assert_eq!(level(&two, THIN_TEXT_CHARS), EvidenceLevel::Low);
        let three = [must(E_FULL), must(E_FULL), must(E_NONE)];
        assert_eq!(level(&three, 4000), EvidenceLevel::Full);
    }

    /// Soft skills and languages add nothing; a language asked at C1 or higher and not met
    /// counts against the profile like a skill must.
    #[test]
    fn soft_skills_and_languages_are_no_musts() {
        let language = |level, value| {
            let mut s = must(value);
            s.item.class = Class::Language("englisch".into(), level);
            s.weight = W_SOFT;
            s
        };
        let mut soft = must(E_NONE);
        soft.item.class = Class::Soft;
        soft.weight = W_SOFT;
        assert!(!is_must(&soft));
        assert!(!is_must(&language(None, E_FULL)));
        assert!(!is_must(&language(None, E_NONE)));
        assert!(!is_must(&language(Some(5), E_FULL)));
        assert!(is_must(&language(Some(5), E_NONE)));
        // An open C1 language weighs like an open skill must; soft skills and other
        // languages weigh nothing.
        assert_eq!(must_weight(&[language(Some(5), E_NONE)]), W_MUST);
        assert_eq!(must_weight(&[language(None, E_FULL), soft]), 0);
    }

    /// The wishes move the points by at most `WISH_MAX` either way, never out of 0..=1000; a
    /// permanent role keeps `PERMANENT_FACTOR` of them.
    #[test]
    fn wishes_are_bounded_and_a_permanent_role_counts_less() {
        let mut signals = Signals::default();
        for (j, max) in signals::MAX.iter().enumerate() {
            signals.v[j] = max / 2;
        }
        let base = points(&signals, &[], ContractKind::Interim);
        let up = points(&signals, &lift(3 * WISH_MAX), ContractKind::Interim);
        let down = points(&signals, &lift(-3 * WISH_MAX), ContractKind::Interim);
        let bound = u64::try_from(WISH_MAX).unwrap();
        assert!(up >= base && up - base <= bound, "{base} -> {up}");
        assert!(down <= base && base - down <= bound, "{base} -> {down}");
        assert!(up <= 1000);
        let permanent = points(&signals, &[], ContractKind::Permanent);
        assert_eq!(permanent, base * PERMANENT_FACTOR / 1000);
    }

    /// The lowest cap holds the score; the rank keeps the points before it; an unscorable
    /// job scores 0.
    #[test]
    fn the_cap_holds_the_score_and_the_rank_keeps_the_points() {
        assert_eq!(final_score(735, None, false), (74, 735, None));
        let cap = Some((FORMAL_CAP, CapKind::Formal));
        assert_eq!(
            final_score(735, cap, false),
            (FORMAL_CAP, 735, Some((CapKind::Formal, FORMAL_CAP)))
        );
        assert_eq!(final_score(300, cap, false), (30, 300, None));
        assert_eq!(final_score(735, cap, true), (0, 0, None));
        assert_eq!(
            lower(
                (FORMAL_CAP, CapKind::Formal),
                (OFF_FIELD_CAP, CapKind::OffField)
            ),
            (OFF_FIELD_CAP, CapKind::OffField)
        );
    }
}
