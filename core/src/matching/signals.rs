//! The signals of a job (engine 25): what the engine read of one ad against one profile, as
//! small integers in fixed ranges. They are the inputs of the Passungsgrad (`scorer.rs`):
//! the role and the field, the level, the musts on the core of the role and the others as
//! met, met in part and open, the frame, the nice-to-haves and the facts behind the caps.
//! The private fitter (`tools/scorer/train.py`) replays the scorer from them.
//!
//! Every signal has a direction ([`SIGN`]): +1 when more of it may only raise the score, -1
//! when it may only lower it, 0 when it may do either. Integer arithmetic only; the same
//! profile and job give the same signals.

use super::CompiledProfile;
use super::atoms::{self, Fit, Vocab};
use super::engine::{self, EngineProfile, Scored};
use super::facts::Finding;
use super::graph;
use super::job::Class;
use super::normalize;
use super::params::{E_FULL, E_NONE};
use super::roles::{self, RoleFit};
#[cfg(test)]
use super::scorer;
use super::title::{self, Distance};
use super::types::{JobInput, ReasonCode};
use super::wishes::{State, WishResult};

/// The number of signals.
pub const N: usize = 21;

/// The signals in table order (the index into [`Signals::v`], [`SIGN`], [`NAMES`], [`MAX`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum Sig {
    /// The target role the title meets: 0 none, 1 half, 2 full.
    Role,
    /// What the title names of the profile's field and target roles (per-mille).
    TitleField,
    /// The lexical relevance of the ad (per-mille).
    Relevance,
    /// No skill must met at all (1): outside the field.
    OffField,
    /// The ad's level against the target roles: 0 a wished level or none to judge, 1 one
    /// above, 2 one below, 3 two or more above, 4 two or more below.
    Level,
    /// The musts on the core of the role (what the title or the ad's field names): met in
    /// full, in part, open.
    CoreMet,
    CorePartial,
    CoreOpen,
    /// The other musts: met in full, in part, open.
    OtherMet,
    OtherPartial,
    OtherOpen,
    /// The frame (day rate, remote and place, start, duration, workload): the aspects met in
    /// part and those clearly missed; the rest fits or is not stated. Each one is a frame step.
    FrameNear,
    FrameMissed,
    /// The nice-to-haves: met in full, in part, open.
    NiceMet,
    NicePartial,
    NiceOpen,
    /// An open formal must (a degree of another field, a licence, a mandatory certificate).
    FormalOpen,
    /// A junior or entry-level role for a senior profile.
    Junior,
    /// A permanent role.
    Permanent,
    /// Distinct core competences of the profile any requirement meets, without general business
    /// work (`Entry::method`; at most 8).
    CoreHits,
    /// The ad's field family (its title and musts) against the profile's: 0 none to judge, 1 far,
    /// 2 near, 3 the same family.
    Family,
}

/// Most requirements of one kind a signal counts.
const COUNT_MAX: u16 = 30;

/// The frame aspects: day rate, remote and place, start, duration, workload.
pub(crate) const FRAME_ASPECTS: u16 = 5;

/// One row of the signal table: the one place that knows a signal's name, direction and top.
struct Row {
    sig: Sig,
    name: &'static str,
    sign: i8,
    max: u16,
}

/// The signal table, in the order of [`Sig`]: the signal, its name (the fitter's and the dump's),
/// its direction (+1 up, -1 down, 0 either) and its highest value. [`Sig::ALL`], [`SIGN`],
/// [`NAMES`] and [`MAX`] are derived from it.
const TABLE: [Row; N] = [
    Row {
        sig: Sig::Role,
        name: "role",
        sign: 1,
        max: 2,
    },
    Row {
        sig: Sig::TitleField,
        name: "title_field",
        sign: 1,
        max: 1000,
    },
    Row {
        sig: Sig::Relevance,
        name: "relevance",
        sign: 1,
        max: 1000,
    },
    Row {
        sig: Sig::OffField,
        name: "off_field",
        sign: -1,
        max: 1,
    },
    Row {
        sig: Sig::Level,
        name: "level",
        sign: 0,
        max: 4,
    },
    Row {
        sig: Sig::CoreMet,
        name: "core_met",
        sign: 1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::CorePartial,
        name: "core_partial",
        sign: 0,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::CoreOpen,
        name: "core_open",
        sign: -1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::OtherMet,
        name: "other_met",
        sign: 1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::OtherPartial,
        name: "other_partial",
        sign: 0,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::OtherOpen,
        name: "other_open",
        sign: -1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::FrameNear,
        name: "frame_near",
        sign: -1,
        max: FRAME_ASPECTS,
    },
    Row {
        sig: Sig::FrameMissed,
        name: "frame_missed",
        sign: -1,
        max: FRAME_ASPECTS,
    },
    Row {
        sig: Sig::NiceMet,
        name: "nice_met",
        sign: 1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::NicePartial,
        name: "nice_partial",
        sign: 0,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::NiceOpen,
        name: "nice_open",
        sign: -1,
        max: COUNT_MAX,
    },
    Row {
        sig: Sig::FormalOpen,
        name: "formal_open",
        sign: -1,
        max: 1,
    },
    Row {
        sig: Sig::Junior,
        name: "junior",
        sign: -1,
        max: 1,
    },
    Row {
        sig: Sig::Permanent,
        name: "permanent",
        sign: -1,
        max: 1,
    },
    Row {
        sig: Sig::CoreHits,
        name: "core_hits",
        sign: 1,
        max: 8,
    },
    Row {
        sig: Sig::Family,
        name: "family",
        sign: 1,
        max: 3,
    },
];

/// One column of the table, in table order (a row sits at its signal's index).
macro_rules! column {
    ($field:ident) => {{
        let mut out = [TABLE[0].$field; N];
        let mut i = 0;
        while i < N {
            assert!(TABLE[i].sig as usize == i, "signal table out of order");
            out[i] = TABLE[i].$field;
            i += 1;
        }
        out
    }};
}

impl Sig {
    /// Every signal in table order.
    pub const ALL: [Sig; N] = column!(sig);
}

/// The direction of each signal: +1 up, -1 down, 0 either.
pub const SIGN: [i8; N] = column!(sign);

/// The names of the signals (the fitter's and the dump's).
pub const NAMES: [&str; N] = column!(name);

/// The highest value of each signal.
pub const MAX: [u16; N] = column!(max);

/// The signals of one job.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct Signals {
    pub v: [u16; N],
}

impl Signals {
    pub fn get(&self, sig: Sig) -> u16 {
        self.v[sig as usize]
    }

    pub(crate) fn set(&mut self, sig: Sig, value: u64) {
        let max = MAX[sig as usize];
        self.v[sig as usize] = u16::try_from(value).unwrap_or(max).min(max);
    }
}

/// The signals of a job for a profile, read as [`super::assess`] reads it (all zero for an
/// empty profile).
pub fn signals(profile: &CompiledProfile, input: &JobInput<'_>) -> Signals {
    trace(profile, input).signals
}

/// How the points of one job came about (the private fitter replays them): the signals, the
/// points before the caps and every cap that fired.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Trace {
    pub signals: Signals,
    /// The score before the caps (0..=100).
    pub total: u8,
    pub permanent: bool,
    /// Every cap that fired: its code and the highest score it allows.
    pub caps: Vec<(&'static str, u8)>,
    /// Every requirement the engine read, in reading order.
    pub items: Vec<TraceItem>,
}

/// One requirement as the engine read and met it (the private fitter aligns it with the
/// teachers' line verdicts).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraceItem {
    /// The ad line the requirement stands in (empty for a vocabulary term).
    pub line: String,
    pub text: String,
    /// 2 a counted must, 1 a counted nice-to-have, 0 neither.
    pub role: u8,
    /// A must on the core of the role.
    pub core: bool,
    /// The evidence in per-mille.
    pub value: u16,
    /// The profile entry that met it, as written.
    pub entry: Option<String>,
}

/// The [`Trace`] of a job for a profile, read as [`super::assess`] reads it.
pub fn trace(profile: &CompiledProfile, input: &JobInput<'_>) -> Trace {
    if profile.quality() == super::ProfileQuality::Empty {
        return Trace::default();
    }
    let masked = normalize::mask_placeholders(input.text);
    let read = JobInput {
        text: &masked,
        ..*input
    };
    let e = engine::evaluate(&profile.engine, &read);
    let title = title::clean(read.title);
    let core = CoreTest::new(&profile.engine, &title, e.field.map(|(f, _)| f));
    Trace {
        signals: e.signals,
        total: e.percent.total,
        permanent: e.signals.get(Sig::Permanent) == 1,
        caps: e.caps.iter().map(|&(c, kind)| (kind.code(), c)).collect(),
        items: e
            .items
            .iter()
            .map(|x| TraceItem {
                line: x.item.span.as_ref().map_or_else(String::new, |span| {
                    let start = read.text[..span.start].rfind('\n').map_or(0, |i| i + 1);
                    let end = read.text[span.start..]
                        .find('\n')
                        .map_or(read.text.len(), |i| span.start + i);
                    read.text[start..end].trim().to_owned()
                }),
                text: x.item.text.clone(),
                role: if engine::is_must(x) {
                    2
                } else {
                    u8::from(engine::is_nice(x))
                },
                core: engine::is_must(x) && core.on_core(x),
                value: x.fit.value,
                entry: x
                    .fit
                    .entry
                    .and_then(|i| profile.engine.skills.entries.get(i))
                    .map(|e| e.text.clone()),
            })
            .collect(),
    }
}

/// What the engine read of one job, handed over by `engine::evaluate`.
pub(crate) struct Parts<'a> {
    /// The cleaned title.
    pub title: &'a str,
    pub items: &'a [Scored],
    pub relevance: u64,
    pub role: Option<&'a RoleFit>,
    /// The ad's level, the levels it stands below the profile and whether that caps.
    pub ad_level: Option<u8>,
    pub gap: u8,
    pub level_cap: bool,
    pub field: Option<(&'static str, Distance)>,
    pub findings: &'a [Finding],
    pub wishes: &'a [WishResult],
}

/// Does a requirement name an expectation every candidate meets (`tables::HYGIENE`; a
/// hyphen counts as a space: `MS-Office-Kenntnisse`; whole words: `Excellent` is no Excel)?
pub(crate) fn is_hygiene(text: &str) -> bool {
    let folded = atoms::fold(text).replace('-', " ");
    crate::matching::lexicon::HYGIENE
        .iter()
        .any(|w| normalize::contains_word(&folded, w))
}

fn related(a: &str, b: &str) -> bool {
    matches!(graph::fit(a, b), Fit::Equal | Fit::Specific)
        || matches!(graph::fit(b, a), Fit::Equal | Fit::Specific)
}

/// Which musts stand on the core of the role: a skill that names what the title names (also
/// a field word of it, `lexicon::engine::FIELD_ATOMS`), or the ad's field (a trigger of its family).
pub(crate) struct CoreTest<'a> {
    title_atoms: Vec<String>,
    title_fields: Vec<&'static str>,
    field: Option<&'static str>,
    vocab: &'a Vocab,
}

/// The field family a requirement names and nothing else (`10+ years in finance`): every atom
/// generic, at least one a field word (`lexicon::engine::FIELD_ATOMS`).
pub(crate) fn only_names_field(atoms: &[String]) -> Option<&'static str> {
    if !atoms.iter().all(|a| atoms::is_generic(a)) {
        return None;
    }
    field_words(atoms).next()
}

/// The fields the field words of a text's atoms name (`lexicon::engine::FIELD_ATOMS`).
fn field_words(atoms: &[String]) -> impl Iterator<Item = &'static str> + '_ {
    crate::matching::lexicon::engine::FIELD_ATOMS
        .iter()
        .filter(|(w, _)| atoms.iter().any(|a| a == w))
        .map(|&(_, field)| field)
}

impl<'a> CoreTest<'a> {
    pub(crate) fn new(
        profile: &'a EngineProfile,
        title: &str,
        field: Option<&'static str>,
    ) -> Self {
        let vocab = &profile.skills.vocab;
        Self {
            title_atoms: roles::title_core(title, vocab, &profile.shape),
            title_fields: field_words(&atoms::atoms(title, vocab)).collect(),
            field,
            vocab,
        }
    }

    pub(crate) fn on_core(&self, m: &Scored) -> bool {
        if m.item.class != Class::Skill {
            return false;
        }
        let item = atoms::atoms(&m.item.text, self.vocab);
        item.iter()
            .any(|a| !atoms::is_generic(a) && self.title_atoms.iter().any(|t| related(a, t)))
            || field_words(&item).any(|f| self.title_fields.contains(&f))
            || self
                .field
                .is_some_and(|f| title::names_field(&m.item.text, f))
    }
}

fn count(n: usize) -> u64 {
    u64::try_from(n).unwrap_or(u64::MAX)
}

/// Met in full, in part and open, as the job view groups them.
fn tally<'a>(items: impl Iterator<Item = &'a Scored>) -> [u64; 3] {
    let mut out = [0u64; 3];
    for x in items {
        let i = match x.fit.value {
            E_FULL => 0,
            E_NONE => 2,
            _ => 1,
        };
        out[i] += 1;
    }
    out
}

/// The signals of one job from what the engine read; the facts behind the caps (`OffField`,
/// `FormalOpen`, `Junior`) and `Permanent` are the engine's to set.
pub(crate) fn compute(profile: &EngineProfile, parts: &Parts<'_>) -> Signals {
    let mut s = Signals::default();
    role_and_field(&mut s, profile, parts);
    let core = CoreTest::new(profile, parts.title, parts.field.map(|(f, _)| f));
    let musts: Vec<&Scored> = parts.items.iter().filter(|x| engine::is_must(x)).collect();
    let [met, partial, open] = tally(musts.iter().copied().filter(|m| core.on_core(m)));
    s.set(Sig::CoreMet, met);
    s.set(Sig::CorePartial, partial);
    s.set(Sig::CoreOpen, open);
    let [met, partial, open] = tally(musts.iter().copied().filter(|m| !core.on_core(m)));
    s.set(Sig::OtherMet, met);
    s.set(Sig::OtherPartial, partial);
    s.set(Sig::OtherOpen, open);
    let mut hit: Vec<usize> =
        parts
            .items
            .iter()
            .filter(|x| x.fit.value > E_NONE)
            .filter_map(|x| x.fit.entry)
            .filter(|&e| {
                profile.skills.entries.get(e).is_some_and(|e| {
                    e.path.starts_with(crate::profile::key::COMPETENCES) && !e.method
                })
            })
            .collect();
    hit.sort_unstable();
    hit.dedup();
    s.set(Sig::CoreHits, count(hit.len()));
    let [met, partial, open] = tally(parts.items.iter().filter(|x| engine::is_nice(x)));
    s.set(Sig::NiceMet, met);
    s.set(Sig::NicePartial, partial);
    s.set(Sig::NiceOpen, open);
    let (near, missed) = frame(parts.findings, parts.wishes);
    s.set(Sig::FrameNear, near);
    s.set(Sig::FrameMissed, missed);
    s
}

/// The role and the field: the target role, the title, the relevance, no skill must met, and
/// the level.
fn role_and_field(s: &mut Signals, profile: &EngineProfile, parts: &Parts<'_>) {
    s.set(
        Sig::Role,
        parts.role.map_or(0, |r| if r.full { 2 } else { 1 }),
    );
    s.set(
        Sig::TitleField,
        super::relevance::field_title_fit(&profile.title_query, parts.title, &profile.skills.vocab)
            .min(1000),
    );
    s.set(Sig::Relevance, parts.relevance.min(1000));
    let wished = parts
        .ad_level
        .is_some_and(|l| profile.level.wished.contains(&l));
    let above = match (parts.ad_level, profile.level.top) {
        (Some(ad), Some(top)) if !wished => ad.saturating_sub(top),
        _ => 0,
    };
    let below = if wished { 0 } else { parts.gap };
    let level = if parts.level_cap && below >= 2 {
        4
    } else if above >= 2 {
        3
    } else if below >= 1 {
        2
    } else {
        u64::from(above >= 1)
    };
    s.set(Sig::Level, level);
    s.set(
        Sig::Family,
        match parts.field {
            Some((_, Distance::Same)) => 3,
            Some((_, Distance::Near)) => 2,
            Some((_, Distance::Far)) => 1,
            None => 0,
        },
    );
}

/// The frame aspects in their order, as the explanation names them: day rate, work mode
/// and place, start, duration, workload.
pub(crate) const FRAME_CODES: [&str; FRAME_ASPECTS as usize] =
    ["rate", "place", "start", "duration", "workload"];

/// How each frame aspect stands (day rate, work mode and place, start, duration, workload):
/// 0 fits or is not stated, 1 met in part, 2 missed (the worst of what speaks to it; a hard
/// criterion clearly broken excludes and is no frame aspect).
pub(crate) fn frame_aspects(
    findings: &[Finding],
    wishes: &[WishResult],
) -> [u8; FRAME_ASPECTS as usize] {
    let mut aspects = [0u8; FRAME_ASPECTS as usize];
    for wish in wishes {
        let index = match wish.code {
            ReasonCode::DayRateWish => 0,
            ReasonCode::RemoteWish | ReasonCode::RegionWish => 1,
            _ => continue,
        };
        let state = match wish.state {
            State::Met | State::Unknown => 0,
            State::Near => 1,
            State::Missed => 2,
        };
        aspects[index] = aspects[index].max(state);
    }
    for finding in findings.iter().filter(|f| !f.decided) {
        let (index, state) = match finding.code {
            ReasonCode::Salary => (0, 1),
            ReasonCode::AvailabilityGap => (2, 2),
            ReasonCode::Duration => (3, 2),
            ReasonCode::Workload => (4, 2),
            _ => continue,
        };
        aspects[index] = aspects[index].max(state);
    }
    aspects
}

/// The frame aspects met in part and clearly missed.
fn frame(findings: &[Finding], wishes: &[WishResult]) -> (u64, u64) {
    frame_aspects(findings, wishes)
        .iter()
        .fold((0u64, 0u64), |(n, m), a| {
            (n + u64::from(*a == 1), m + u64::from(*a == 2))
        })
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
        let musts = [
            Sig::CoreMet,
            Sig::CorePartial,
            Sig::CoreOpen,
            Sig::OtherMet,
            Sig::OtherPartial,
            Sig::OtherOpen,
        ];
        assert!(musts.iter().map(|m| s.get(*m)).sum::<u16>() > 0, "{s:?}");
        assert_eq!(s.get(Sig::FormalOpen), 1, "{s:?}");
    }

    #[test]
    fn an_empty_profile_has_no_signals() {
        let empty = compile_profile(&ProfileForm::default());
        assert_eq!(signals(&empty, &input(AD)), Signals::default());
    }

    /// An ad that states nothing of the frame fits it in full: no frame step.
    #[test]
    fn an_unstated_frame_fits() {
        assert_eq!(frame(&[], &[]), (0, 0));
        assert_eq!(scorer::percent(&Signals::default()).steps, 0);
    }
}
