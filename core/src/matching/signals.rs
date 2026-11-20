//! The signals of a job (engine 24 groundwork): what the engine read of one ad against one
//! profile, as small integers in fixed ranges. The learned scorer (`scorer.rs`) turns them
//! into points; the private trainer (`tools/scorer/train.py`) learns its tables from them.
//!
//! Every signal has a direction ([`SIGN`]): +1 when more of it may only raise the score, -1
//! when it may only lower it, 0 when the trainer may learn any shape. Integer arithmetic
//! only; the same profile and job give the same signals.

use super::CompiledProfile;
use super::atoms::{self, Fit, Vocab, fold};
use super::engine::{self, EngineProfile, Scored};
use super::job::{self, Class};
use super::lexicon::HeadingKind;
use super::normalize::{self, splitlines, strip};
use super::params::{E_FULL, E_NONE, MUST_SATURATION};
use super::roles::{self, RoleFit};
use super::sections::{self, ReqKind};
use super::title::Distance;
use super::types::{EvidenceLevel, JobInput, Via};
use super::{fit, relevance};
use crate::profile::key;

/// The number of signals.
pub const N: usize = 22;

/// The signals in table order (the index into [`Signals::v`], [`SIGN`], [`NAMES`], [`MAX`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum Sig {
    /// Saturating coverage of the musts through the profile's competences, focus,
    /// certificates, degrees and industries (per-mille).
    CoreCov,
    /// Coverage of the musts through the profile's tools (per-mille).
    ToolCov,
    /// Coverage of the musts through a more general profile entry, at half (per-mille).
    GeneralCov,
    /// Distinct core competences any requirement hits (at most 8).
    RevCov,
    /// Distinct core competences and target role topics in the task lines, the first three
    /// lines double (at most 5).
    TaskCore,
    /// Open musts on the core of the role (at most 5).
    OpenCore,
    /// Other open musts (at most 10).
    OpenOther,
    /// Weighted musts (at most 20).
    NMusts,
    /// Share of the ad's musts that are hygiene: soft skills, languages, frame (per-mille).
    HygieneShare,
    /// Mean fit of the nice-to-haves (per-mille).
    NiceCov,
    /// The lexical relevance of the ad (per-mille).
    Relevance,
    /// What the title names of the profile's field and target roles (per-mille).
    TitleField,
    /// The target role the title meets: 0 none, 1 half, 2 full.
    Role,
    /// Levels the ad stands below the profile (at most 3).
    LevelBelow,
    /// Levels the ad stands above the profile's highest (at most 2).
    LevelAbove,
    /// The ad's field against the profile's: 0 same, 1 near, 2 unknown, 3 far.
    FieldClass,
    /// In the profile's own or a near field: the fit of the musts that name carrier work
    /// (project management, leadership, stakeholders, process work, KPI reporting) (per-mille).
    Carrier,
    /// The mandate builds or changes something (1) or not (0).
    Build,
    /// A seat in running operations for a profile at team lead level or above (1) or not (0).
    RunSeat,
    /// How much the text allowed to read: 0 full, 1 low, 2 teaser.
    Evidence,
    /// An open formal must (degree of another field, licence, mandatory certificate).
    FormalOpen,
    /// An open language must at C1 or above.
    LangOpenC1,
}

impl Sig {
    /// Every signal in table order.
    pub const ALL: [Sig; N] = [
        Sig::CoreCov,
        Sig::ToolCov,
        Sig::GeneralCov,
        Sig::RevCov,
        Sig::TaskCore,
        Sig::OpenCore,
        Sig::OpenOther,
        Sig::NMusts,
        Sig::HygieneShare,
        Sig::NiceCov,
        Sig::Relevance,
        Sig::TitleField,
        Sig::Role,
        Sig::LevelBelow,
        Sig::LevelAbove,
        Sig::FieldClass,
        Sig::Carrier,
        Sig::Build,
        Sig::RunSeat,
        Sig::Evidence,
        Sig::FormalOpen,
        Sig::LangOpenC1,
    ];
}

/// The direction of each signal: +1 up, -1 down, 0 free.
pub const SIGN: [i8; N] = [
    1, 1, 1, 1, 1, -1, -1, 0, 0, 1, 1, 1, 1, -1, -1, -1, 1, 1, -1, 0, -1, -1,
];

/// The names of the signals (the trainer's and the dump's).
pub const NAMES: [&str; N] = [
    "core_cov",
    "tool_cov",
    "general_cov",
    "rev_cov",
    "task_core",
    "open_core",
    "open_other",
    "n_musts",
    "hygiene_share",
    "nice_cov",
    "relevance",
    "title_field",
    "role",
    "level_below",
    "level_above",
    "field_class",
    "carrier",
    "build",
    "run_seat",
    "evidence",
    "formal_open",
    "lang_open_c1",
];

/// The highest value of each signal.
pub const MAX: [u16; N] = [
    1000, 1000, 1000, 8, 5, 5, 10, 20, 1000, 1000, 1000, 1000, 2, 3, 2, 3, 1000, 1, 1, 2, 1, 1,
];

/// The signals of one job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Signals {
    pub v: [u16; N],
}

impl Signals {
    pub fn get(&self, sig: Sig) -> u16 {
        self.v[sig as usize]
    }

    fn set(&mut self, sig: Sig, value: u64) {
        let max = MAX[sig as usize];
        self.v[sig as usize] = u16::try_from(value).unwrap_or(max).min(max);
    }
}

/// The signals of a job for a profile, read as [`super::assess`] reads it (all zero for an
/// empty profile).
pub fn signals(profile: &CompiledProfile, input: &JobInput<'_>) -> Signals {
    if profile.quality() == super::ProfileQuality::Empty {
        return Signals::default();
    }
    fit::forget();
    let masked = normalize::mask_placeholders(input.text);
    let read = JobInput {
        text: &masked,
        ..*input
    };
    engine::evaluate(&profile.engine, &read).signals
}

/// How the points of one job came about (the private trainer replays them): the learned fit,
/// the wishes, the contract and every cap that fired.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trace {
    pub signals: Signals,
    /// [`super::scorer`]'s fit with the tables the engine was built with (per-mille).
    pub learned: u16,
    /// The summed wish points (per-mille, not yet bounded).
    pub wish: i64,
    pub permanent: bool,
    /// Every cap that fired: its code and the highest score it allows.
    pub caps: Vec<(&'static str, u8)>,
}

/// The [`Trace`] of a job for a profile, read as [`super::assess`] reads it.
pub fn trace(profile: &CompiledProfile, input: &JobInput<'_>) -> Trace {
    if profile.quality() == super::ProfileQuality::Empty {
        return Trace::default();
    }
    fit::forget();
    let masked = normalize::mask_placeholders(input.text);
    let read = JobInput {
        text: &masked,
        ..*input
    };
    let e = engine::evaluate(&profile.engine, &read);
    Trace {
        signals: e.signals,
        learned: super::scorer::learned(&e.signals),
        wish: e.wishes.iter().map(|w| w.points).sum(),
        permanent: e.contract == super::contract::ContractKind::Permanent,
        caps: e.caps.iter().map(|&(c, kind)| (kind.code(), c)).collect(),
    }
}

/// What the engine read of one job, handed over by `engine::evaluate`.
pub(crate) struct Parts<'a> {
    /// The cleaned title.
    pub title: &'a str,
    /// The ad without the other listings under it.
    pub own: &'a str,
    pub items: &'a [Scored],
    pub relevance: u64,
    pub role: Option<&'a RoleFit>,
    pub ad_level: Option<u8>,
    pub gap: u8,
    pub field: Option<Distance>,
    pub evidence: EvidenceLevel,
    pub formal_open: bool,
}

/// Words of carrier work: what a profile brings into a near field (folded, as substrings).
// external contract - do not translate (matching lexicon)
const CARRIER_WORDS: &[&str] = &[
    "projektmanagement",
    "projektleitung",
    "project management",
    "fuhrung",
    "leadership",
    "stakeholder",
    "prozessoptimierung",
    "process improvement",
    "kpi",
    "reporting",
];

/// Words of a mandate that builds or changes something (folded, as substrings).
// external contract - do not translate (matching lexicon)
const BUILD_WORDS: &[&str] = &[
    "aufbau",
    "neuausrichtung",
    "transformation",
    "einfuhrung",
    "vakanz",
    "restrukturierung",
    "turnaround",
    "implementierung",
    "build-up",
    "set up",
    "setup",
];

/// Words of a seat in running operations (folded, as substrings).
// external contract - do not translate (matching lexicon)
const RUN_WORDS: &[&str] = &[
    "laufenden betrieb",
    "laufender betrieb",
    "operative tatigkeit",
    "tagesgeschaft",
    "sachbearbeitung",
    "day-to-day",
];

/// The profile's highest level at which a run seat counts against it (team lead).
const RUN_SEAT_LEVEL: u8 = 4;

/// The first task lines count twice in `task_core`.
const LEADING_TASKS: usize = 3;

/// Lines of the ad's own text the mandate is read from beside the title and the tasks.
const LEADING_LINES: usize = 2;

/// The task lines of the ad: the lines under a task heading up to the next heading.
// TODO(integrator): take `JobDoc::task_lines` once the reading branch (wt-read) merges.
fn task_lines(own: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut in_tasks = false;
    for line in splitlines(own) {
        let stripped = strip(line);
        if stripped.is_empty() {
            continue;
        }
        if job::is_heading_line(line) {
            in_tasks = sections::section_kind(stripped) == Some(HeadingKind::Task);
            continue;
        }
        if in_tasks {
            out.push(stripped);
        }
    }
    out
}

/// Does a requirement name an expectation every candidate meets (`tables::HYGIENE`)?
fn is_hygiene(text: &str) -> bool {
    let folded = atoms::fold(text);
    crate::matching::lexicon::HYGIENE
        .iter()
        .any(|w| folded.contains(w))
}

fn related(a: &str, b: &str) -> bool {
    matches!(atoms::fit(a, b), Fit::Equal | Fit::Specific)
        || matches!(atoms::fit(b, a), Fit::Equal | Fit::Specific)
}

/// Does a text name one of the specific atoms?
fn names_any(text_atoms: &[String], wanted: &[String]) -> bool {
    wanted
        .iter()
        .filter(|w| !atoms::is_generic(w))
        .any(|w| text_atoms.iter().any(|t| related(t, w)))
}

/// Distinct core competences and target role topics in the task lines (`LEADING_TASKS`
/// lines count twice), at most `MAX`.
fn task_core(profile: &EngineProfile, lines: &[&str], vocab: &Vocab) -> u64 {
    let core: Vec<&fit::Entry> = profile
        .skills
        .entries
        .iter()
        .filter(|e| e.path.starts_with(key::COMPETENCES))
        .collect();
    let topics: Vec<String> = roles::topics(&profile.roles);
    let mut best = vec![0u64; core.len() + topics.len()];
    for (i, line) in lines.iter().enumerate() {
        let weight = if i < LEADING_TASKS { 2 } else { 1 };
        let line_atoms = atoms::atoms(line, vocab);
        for (j, entry) in core.iter().enumerate() {
            if names_any(&line_atoms, &entry.atoms) {
                best[j] = best[j].max(weight);
            }
        }
        for (j, topic) in topics.iter().enumerate() {
            if names_any(&line_atoms, std::slice::from_ref(topic)) {
                best[core.len() + j] = best[core.len() + j].max(weight);
            }
        }
    }
    best.iter().sum()
}

fn count(n: usize) -> u64 {
    u64::try_from(n).unwrap_or(u64::MAX)
}

/// The mean of per-mille values (0 without any).
fn mean(values: impl Iterator<Item = u16>) -> u64 {
    let (sum, n) = values.fold((0u64, 0u64), |(s, n), v| (s + u64::from(v), n + 1));
    sum.checked_div(n).unwrap_or(0)
}

/// The signals of one job from what the engine read.
pub(crate) fn compute(profile: &EngineProfile, parts: &Parts<'_>) -> Signals {
    let mut s = Signals::default();
    let musts: Vec<&Scored> = parts.items.iter().filter(|x| engine::is_must(x)).collect();
    let tasks = task_lines(parts.own);
    coverage(&mut s, profile, parts, &musts);
    opens(&mut s, profile, parts, &musts);
    s.set(
        Sig::TaskCore,
        task_core(profile, &tasks, &profile.skills.vocab),
    );
    frame(&mut s, profile, parts, &musts);
    mandate(&mut s, profile, parts, &tasks);
    s
}

/// How the musts and nice-to-haves are met: through which kind of profile entry, which core
/// competences, and how much of the ad's musts are hygiene.
fn coverage(s: &mut Signals, profile: &EngineProfile, parts: &Parts<'_>, musts: &[&Scored]) {
    let entries = &profile.skills.entries;
    let units = count(musts.len()).max(MUST_SATURATION);
    let (mut core, mut tools, mut general) = (0u64, 0u64, 0u64);
    for m in musts {
        let value = u64::from(m.fit.value);
        let entry = m.fit.entry.and_then(|e| entries.get(e));
        if m.fit.via == Via::General {
            general += value;
        } else if entry.is_some_and(|e| e.path.starts_with(key::TOOLS)) {
            tools += value;
        } else {
            core += value;
        }
    }
    s.set(Sig::CoreCov, core / units);
    s.set(Sig::ToolCov, tools / units);
    s.set(Sig::GeneralCov, general / units);
    let mut hit: Vec<usize> = parts
        .items
        .iter()
        .filter(|x| x.fit.value > E_NONE)
        .filter_map(|x| x.fit.entry)
        .filter(|&e| {
            entries
                .get(e)
                .is_some_and(|e| e.path.starts_with(key::COMPETENCES))
        })
        .collect();
    hit.sort_unstable();
    hit.dedup();
    s.set(Sig::RevCov, count(hit.len()));
    s.set(Sig::NMusts, count(musts.len()));
    let asked = parts.items.iter().filter(|x| x.item.kind == ReqKind::Must);
    let (hygiene, all) = asked.fold((0u64, 0u64), |(h, n), x| {
        let soft = matches!(
            x.item.class,
            Class::Soft | Class::Language(..) | Class::Frame
        ) || is_hygiene(&x.item.text);
        (h + u64::from(soft), n + 1)
    });
    s.set(
        Sig::HygieneShare,
        (1000 * hygiene).checked_div(all).unwrap_or(0),
    );
    s.set(
        Sig::NiceCov,
        mean(
            parts
                .items
                .iter()
                .filter(|x| engine::is_nice(x))
                .map(|x| x.fit.value),
        ),
    );
}

/// The open musts, on the core of the role (a skill that names what the title names) or not.
fn opens(s: &mut Signals, profile: &EngineProfile, parts: &Parts<'_>, musts: &[&Scored]) {
    let vocab = &profile.skills.vocab;
    let title_atoms = roles::title_core(parts.title, vocab);
    let (mut open_core, mut open_other) = (0u64, 0u64);
    for m in musts.iter().filter(|m| m.fit.value == E_NONE) {
        let on_core = m.item.class == Class::Skill
            && atoms::atoms(&m.item.text, vocab)
                .iter()
                .any(|a| !atoms::is_generic(a) && title_atoms.iter().any(|t| related(a, t)));
        if on_core {
            open_core += 1;
        } else {
            open_other += 1;
        }
    }
    s.set(Sig::OpenCore, open_core);
    s.set(Sig::OpenOther, open_other);
    s.set(Sig::FormalOpen, u64::from(parts.formal_open));
    let lang_open = musts
        .iter()
        .any(|m| matches!(m.item.class, Class::Language(..)) && m.fit.value < E_FULL);
    s.set(Sig::LangOpenC1, u64::from(lang_open));
}

/// The frame of the role: relevance, title, target role, level, field and carrier work.
fn frame(s: &mut Signals, profile: &EngineProfile, parts: &Parts<'_>, musts: &[&Scored]) {
    s.set(Sig::Relevance, parts.relevance.min(1000));
    s.set(
        Sig::TitleField,
        relevance::field_title_fit(&profile.title_query, parts.title, &profile.skills.vocab)
            .min(1000),
    );
    s.set(
        Sig::Role,
        parts.role.map_or(0, |r| if r.full { 2 } else { 1 }),
    );
    s.set(Sig::LevelBelow, u64::from(parts.gap));
    let above = match (parts.ad_level, profile.level.top) {
        (Some(ad), Some(top)) => ad.saturating_sub(top),
        _ => 0,
    };
    s.set(Sig::LevelAbove, u64::from(above));
    let field_class = match parts.field {
        Some(Distance::Same) => 0,
        Some(Distance::Near) => 1,
        None => 2,
        Some(Distance::Far) => 3,
    };
    s.set(Sig::FieldClass, field_class);
    if field_class <= 1 {
        let carriers = musts
            .iter()
            .filter(|m| {
                let folded = fold(&m.item.text);
                CARRIER_WORDS.iter().any(|w| folded.contains(w))
            })
            .map(|m| m.fit.value);
        s.set(Sig::Carrier, mean(carriers));
    }
    s.set(
        Sig::Evidence,
        match parts.evidence {
            EvidenceLevel::Full => 0,
            EvidenceLevel::Low => 1,
            EvidenceLevel::Teaser => 2,
        },
    );
}

/// The mandate from the title, the task lines and the ad's first lines: building or
/// changing something, or a seat in running operations.
fn mandate(s: &mut Signals, profile: &EngineProfile, parts: &Parts<'_>, tasks: &[&str]) {
    let mut text = fold(parts.title);
    let leading = splitlines(parts.own)
        .into_iter()
        .map(strip)
        .filter(|l| !l.is_empty())
        .take(LEADING_LINES);
    for line in tasks.iter().copied().chain(leading) {
        text.push('\n');
        text.push_str(&fold(line));
    }
    let build = BUILD_WORDS.iter().any(|w| text.contains(w));
    s.set(Sig::Build, u64::from(build));
    let run = !build
        && profile.level.top.is_some_and(|l| l >= RUN_SEAT_LEVEL)
        && RUN_WORDS.iter().any(|w| text.contains(w));
    s.set(Sig::RunSeat, u64::from(run));
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::compile_profile;
    use crate::matching::types::TextKind;
    use crate::portal::Portal;
    use crate::profile::ProfileForm;

    fn profile() -> CompiledProfile {
        let text = include_str!("../../tests/fixtures/matching/sample_profile.json");
        compile_profile(&crate::profile::parse(text).expect("sample profile"))
    }

    // external contract - do not translate (a German ad)
    const AD: &str = "Wir suchen einen Interim Manager für den Aufbau des Kundenservice.\n\n\
        Ihre Aufgaben:\n\n- Aufbau und Leitung des Kundenservice\n- Prozessoptimierung im Contact Center\n\
        - KPI-Reporting an die Geschäftsführung\n\nIhr Profil:\n\n- Erfahrung im Projektmanagement\n\
        - Führungserfahrung\n- Sehr gute Englischkenntnisse (C1)\n- Kenntnisse in SAP\n\
        - Abgeschlossenes Studium der Medizin\n\nWir bieten:\n\nEin spannendes Umfeld.\n";

    fn input(text: &str) -> JobInput<'_> {
        JobInput {
            title: "Interim Manager Kundenservice (m/w/d)",
            company: "",
            location: "Berlin",
            portal: Portal::Freelancermap,
            text,
            facts: None,
            posted: None,
            kind: TextKind::Full,
        }
    }

    #[test]
    fn tables_line_up() {
        assert_eq!(Sig::ALL.len(), N);
        for (i, sig) in Sig::ALL.iter().enumerate() {
            assert_eq!(*sig as usize, i);
        }
        assert!(SIGN.iter().all(|s| (-1..=1).contains(s)));
        let mut names = NAMES.to_vec();
        names.sort_unstable();
        names.dedup();
        assert_eq!(names.len(), N);
    }

    #[test]
    fn signals_are_deterministic_and_in_range() {
        let p = profile();
        for text in [AD, "", "Kurz.", "Ihr Profil:\n\n- Teamfähigkeit\n"] {
            let a = signals(&p, &input(text));
            let b = signals(&p, &input(text));
            assert_eq!(a, b);
            for (i, v) in a.v.iter().enumerate() {
                assert!(*v <= MAX[i], "{} = {v} above {}", NAMES[i], MAX[i]);
            }
        }
        let s = signals(&p, &input(AD));
        assert!(s.get(Sig::NMusts) > 0, "{s:?}");
        assert_eq!(s.get(Sig::Build), 1, "{s:?}");
    }

    #[test]
    fn task_lines_are_the_lines_under_a_task_heading() {
        assert_eq!(
            task_lines(AD),
            vec![
                "- Aufbau und Leitung des Kundenservice",
                "- Prozessoptimierung im Contact Center",
                "- KPI-Reporting an die Geschäftsführung",
            ]
        );
    }

    #[test]
    fn an_empty_profile_has_no_signals() {
        let empty = compile_profile(&ProfileForm::default());
        assert_eq!(signals(&empty, &input(AD)), Signals::default());
    }
}
