//! The Passungsgrad (engine 25): `score = content x frame factor`, then the lowest cap.
//!
//! The content is the share of what matters for the job that the profile fits, in three
//! named parts with weights fixed by meaning (`params.rs`):
//!
//! - role and field (`W_ROLE`): the field of the role (the same field or a target role in
//!   full, near, far, foreign; from the target role, the title and how the ad's text and its
//!   musts fit the profile's field) at its level (a wished level full, one above or below
//!   `LEVEL_ONE`, two or more above `LEVEL_TWO_ABOVE`; two or more below caps);
//! - core of the role (`W_CORE`): the share of the musts on the core of the role that the
//!   profile meets, counted as at least `CORE_SATURATION`; the ones the ad does not name
//!   count as role and field and the other musts do on average;
//! - other musts (`W_MUSTS`): the share of the other musts, counted as at least
//!   `MUST_SATURATION`, the ones a short list does not name at `UNNAMED` of role and field.
//!
//! A requirement met in part counts `PARTIAL`; what is unclear or missing never counts
//! against. The nice-to-haves add up to `NICE_MAX` inside the content. The frame factor
//! keeps `FRAME_STEP` for each stated condition worse than wished (day rate, work mode and
//! place, start, duration, workload; what the ad does not state fits), a permanent role keeps
//! `PERMANENT_FACTOR`; then the lowest cap holds, each with its reason. Integer arithmetic
//! only; every line is whole points, so the lines add up to the score.

use super::engine::Cap;
use super::params::{
    CORE_OPEN_CAP, CORE_SATURATION, E_FULL, FIELD_VALUES, FORMAL_CAP, FRAME_STEP, HIT_RELEVANCE,
    HITS_MAX, JUNIOR_CAP, LEVEL_CAP, LEVEL_ONE, LEVEL_TWO_ABOVE, MUST_SATURATION, NICE_MAX,
    OFF_FIELD_CAP, PARTIAL, PERMANENT_FACTOR, RELEVANCE_FAR, RELEVANCE_NEAR, RELEVANCE_SAME,
    TITLE_NEAR, TITLE_SAME, UNNAMED, W_CORE, W_MUSTS, W_ROLE,
};
use super::score::div_round_half_even;
use super::signals::{FRAME_ASPECTS, Sig, Signals};
use super::types::CapCode;

/// The weights of the content parts in their order: role and field, core, other musts.
pub(crate) const WEIGHTS: [u64; 3] = [W_ROLE, W_CORE, W_MUSTS];

/// The frame steps at most: one per frame aspect.
const STEPS_MAX: usize = FRAME_ASPECTS as usize;

/// The field of the role against the profile's.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FieldClass {
    Same,
    Near,
    Far,
    Foreign,
}

impl FieldClass {
    pub(crate) fn code(self) -> &'static str {
        match self {
            FieldClass::Same => "same",
            FieldClass::Near => "near",
            FieldClass::Far => "far",
            FieldClass::Foreign => "foreign",
        }
    }

    fn value(self) -> u64 {
        FIELD_VALUES[self as usize]
    }
}

/// How the ad fits the profile's field (per-mille and more): the relevance of its text plus
/// `HIT_RELEVANCE` for each distinct core competence a requirement meets (at most
/// `HITS_MAX`).
fn field_fit(s: &Signals) -> u64 {
    u64::from(s.get(Sig::Relevance)) + HIT_RELEVANCE * u64::from(s.get(Sig::CoreHits).min(HITS_MAX))
}

/// The field class: foreign without any skill must met, unless the title meets a target
/// role (the field of a wished role is never foreign, however low the level); the same field
/// for a target role met in full, a title of the profile's field or an ad that fits it
/// closely; near for a target role met in half or a title or an ad that fits it in part; far
/// for an ad that touches it; else foreign.
pub(crate) fn class(s: &Signals) -> FieldClass {
    let title = u64::from(s.get(Sig::TitleField));
    let role = s.get(Sig::Role);
    let field = field_fit(s);
    if s.get(Sig::OffField) == 1 && role == 0 {
        FieldClass::Foreign
    } else if role == 2 || title >= TITLE_SAME || field >= RELEVANCE_SAME {
        FieldClass::Same
    } else if role == 1 || title >= TITLE_NEAR || field >= RELEVANCE_NEAR {
        FieldClass::Near
    } else if field >= RELEVANCE_FAR {
        FieldClass::Far
    } else {
        FieldClass::Foreign
    }
}

/// The share of role and field the level keeps (per-mille).
fn level_factor(level: u16) -> u64 {
    match level {
        0 => 1000,
        3 => LEVEL_TWO_ABOVE,
        _ => LEVEL_ONE,
    }
}

/// The share (per-mille) of met, partly met and open requirements, counted as at least
/// `units`, the unnamed ones at `fill`.
fn share(met: u16, partial: u16, open: u16, units: u64, fill: u64) -> u64 {
    let n = u64::from(met) + u64::from(partial) + u64::from(open);
    let units = units.max(n);
    if units == 0 {
        return fill;
    }
    (u64::from(met) * u64::from(E_FULL) + u64::from(partial) * PARTIAL + (units - n) * fill) / units
}

/// How the score of one job came about, in whole points: the content parts, the
/// nice-to-have bonus, the frame steps and the permanent line add up to `total` (before the
/// caps).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Percent {
    pub class: Option<FieldClass>,
    /// The share of each content part (per-mille): role and field, core, other musts.
    pub shares: [u16; 3],
    /// The points of each content part, at most its weight.
    pub points: [u8; 3],
    /// The nice-to-have bonus (points, at most `NICE_MAX`, never above 100 with the parts).
    pub nice: u8,
    /// The content: the parts plus the bonus.
    pub content: u8,
    /// The points each frame step takes, in the order of the frame aspects worse than wished
    /// (the first `steps` count).
    pub frame: [u8; STEPS_MAX],
    pub steps: u8,
    /// The points a permanent role takes after the frame.
    pub permanent: u8,
    /// The score before the caps: the content minus the frame steps and the permanent line.
    pub total: u8,
    /// The same in per-mille before rounding: orders jobs with the same score.
    pub fine: u16,
}

fn point(value: u64) -> u8 {
    u8::try_from(value.min(100)).unwrap_or(100)
}

/// The points a factor of `keep` (per-mille) takes from `points`.
fn taken(points: u8, keep: u64) -> u8 {
    point(div_round_half_even(u64::from(points) * (1000 - keep), 1000))
}

/// The three content shares (per-mille): role and field, core, other musts.
fn shares(s: &Signals, class: FieldClass) -> [u64; 3] {
    let role = class.value() * level_factor(s.get(Sig::Level)) / 1000;
    let (om, op, oo) = (
        s.get(Sig::OtherMet),
        s.get(Sig::OtherPartial),
        s.get(Sig::OtherOpen),
    );
    let musts = share(om, op, oo, MUST_SATURATION, role * UNNAMED / 1000);
    // The core points the ad does not name count as role and field and the named other musts
    // on average; without other musts as role and field.
    let fill = if om + op + oo == 0 {
        role
    } else {
        u64::midpoint(role, share(om, op, oo, 0, 0))
    };
    let core = share(
        s.get(Sig::CoreMet),
        s.get(Sig::CorePartial),
        s.get(Sig::CoreOpen),
        CORE_SATURATION,
        fill,
    );
    [role, core, musts]
}

/// The Passungsgrad of one job from its signals.
pub(crate) fn percent(s: &Signals) -> Percent {
    let class = class(s);
    let shares = shares(s, class);
    let mut points = [0u8; 3];
    for (i, (w, sh)) in WEIGHTS.iter().zip(shares).enumerate() {
        points[i] = point(div_round_half_even(w * sh, 1000));
    }
    let parts: u8 = points.iter().sum();
    let (nm, np, no) = (
        s.get(Sig::NiceMet),
        s.get(Sig::NicePartial),
        s.get(Sig::NiceOpen),
    );
    let nice_share = if nm + np + no == 0 {
        0
    } else {
        share(nm, np, no, 0, 0)
    };
    let nice = point(div_round_half_even(NICE_MAX * nice_share, 1000)).min(100 - parts);
    let content = parts + nice;
    let mut fine = ((WEIGHTS
        .iter()
        .zip(shares)
        .map(|(w, sh)| w * sh)
        .sum::<u64>()
        + NICE_MAX * nice_share)
        / 100)
        .min(1000);
    let mut total = content;
    let steps = (s.get(Sig::FrameNear) + s.get(Sig::FrameMissed)).min(FRAME_ASPECTS);
    let mut frame = [0u8; STEPS_MAX];
    for step in frame.iter_mut().take(usize::from(steps)) {
        *step = taken(total, FRAME_STEP);
        total -= *step;
        fine = fine * FRAME_STEP / 1000;
    }
    let permanent = if s.get(Sig::Permanent) == 1 {
        fine = fine * PERMANENT_FACTOR / 1000;
        taken(total, PERMANENT_FACTOR)
    } else {
        0
    };
    Percent {
        class: Some(class),
        shares: shares.map(|v| u16::try_from(v.min(1000)).unwrap_or(1000)),
        points,
        nice,
        content,
        frame,
        steps: u8::try_from(steps).unwrap_or(0),
        permanent,
        total: total - permanent,
        fine: u16::try_from(fine).unwrap_or(1000),
    }
}

/// The core of the role clearly open: a must on it open and less than half of the core met.
pub(crate) fn core_open(s: &Signals) -> bool {
    let (met, partial, open) = (
        s.get(Sig::CoreMet),
        s.get(Sig::CorePartial),
        s.get(Sig::CoreOpen),
    );
    open >= 1 && 2 * share(met, partial, open, 0, 0) < u64::from(E_FULL)
}

/// Every cap the signals give, with the highest score it allows: an open formal must, the core
/// of the role clearly open, a foreign field, a junior role for a senior profile, two or more
/// levels below the target roles.
pub(crate) fn caps(s: &Signals) -> Vec<Cap> {
    [
        (s.get(Sig::FormalOpen) == 1).then_some((FORMAL_CAP, CapCode::Formal)),
        core_open(s).then_some((CORE_OPEN_CAP, CapCode::CoreOpen)),
        (class(s) == FieldClass::Foreign).then_some((OFF_FIELD_CAP, CapCode::OffField)),
        (s.get(Sig::Junior) == 1).then_some((JUNIOR_CAP, CapCode::Junior)),
        (s.get(Sig::Level) == 4).then_some((LEVEL_CAP, CapCode::Level)),
    ]
    .into_iter()
    .flatten()
    .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::signals::{MAX, N, NAMES};

    fn sig(pairs: &[(Sig, u16)]) -> Signals {
        let mut s = Signals::default();
        for &(k, v) in pairs {
            s.v[k as usize] = v;
        }
        s
    }

    /// Starts across the range: empty, half of every maximum, a few shapes of real ads.
    fn starts() -> Vec<Signals> {
        let mut half = Signals::default();
        for (j, max) in MAX.iter().enumerate() {
            half.v[j] = max / 2;
        }
        let mut out = vec![Signals::default(), half];
        for role in 0..=2 {
            for relevance in [0, 400, 700, 1000] {
                for level in 0..=4 {
                    out.push(sig(&[
                        (Sig::Role, role),
                        (Sig::Relevance, relevance),
                        (Sig::TitleField, 200),
                        (Sig::CoreHits, 1),
                        (Sig::Level, level),
                        (Sig::CoreMet, 2),
                        (Sig::CorePartial, 1),
                        (Sig::CoreOpen, 1),
                        (Sig::OtherMet, 3),
                        (Sig::OtherPartial, 1),
                        (Sig::OtherOpen, 2),
                        (Sig::NiceMet, 1),
                        (Sig::NiceOpen, 1),
                        (Sig::FrameNear, level % 3),
                        (Sig::FrameMissed, u16::from(relevance == 400)),
                        (Sig::Permanent, u16::from(level % 2 == 1)),
                    ]));
                }
            }
        }
        // A full fit with every bonus: the parts and the bonus never pass 100.
        out.push(sig(&[
            (Sig::Role, 2),
            (Sig::CoreMet, 3),
            (Sig::OtherMet, 7),
            (Sig::NiceMet, 2),
        ]));
        out
    }

    fn score(s: &Signals) -> u8 {
        let p = percent(s);
        caps(s).iter().map(|c| c.0).fold(p.total, u8::min)
    }

    /// The weights are fixed by meaning: the role and its core decide, the rest of the list
    /// adds; the fitted values stay in their ranges.
    #[test]
    fn the_weights_are_fixed_by_meaning() {
        assert_eq!(WEIGHTS, [40, 40, 20]);
        const { assert!(PARTIAL < 1000 && UNNAMED <= 1000 && LEVEL_TWO_ABOVE <= LEVEL_ONE) };
        assert!(FIELD_VALUES.windows(2).all(|w| w[0] >= w[1]));
    }

    /// The lines add up: the three parts and the nice-to-have bonus are the content, minus
    /// the frame steps and the permanent line they are the total, every part stays within
    /// its weight and the content within 100.
    #[test]
    fn the_parts_add_up_to_the_total() {
        for s in starts() {
            let p = percent(&s);
            let parts: u16 = p.points.iter().map(|&x| u16::from(x)).sum();
            assert_eq!(u16::from(p.content), parts + u16::from(p.nice), "{s:?}");
            assert!(p.content <= 100, "{s:?}");
            let frame: u16 = p.frame.iter().map(|&x| u16::from(x)).sum();
            assert_eq!(
                u16::from(p.total),
                u16::from(p.content) - frame - u16::from(p.permanent),
                "{s:?}"
            );
            assert!(p.frame[usize::from(p.steps)..].iter().all(|&x| x == 0));
            for (points, w) in p.points.iter().zip(WEIGHTS) {
                assert!(u64::from(*points) <= w, "{s:?}");
            }
            assert!(u64::from(p.nice) <= NICE_MAX);
        }
    }

    /// One requirement flipped from met to open, or from met to met in part, never raises
    /// the score, wherever the job stands.
    #[test]
    fn a_requirement_turning_open_never_raises_the_score() {
        let flips = [
            (Sig::CoreMet, Sig::CoreOpen),
            (Sig::CoreMet, Sig::CorePartial),
            (Sig::CorePartial, Sig::CoreOpen),
            (Sig::OtherMet, Sig::OtherOpen),
            (Sig::OtherMet, Sig::OtherPartial),
            (Sig::OtherPartial, Sig::OtherOpen),
            (Sig::NiceMet, Sig::NiceOpen),
            (Sig::FrameNear, Sig::FrameMissed),
        ];
        for start in starts() {
            for (from, to) in flips {
                if start.get(from) == 0 {
                    continue;
                }
                let mut after = start;
                after.v[from as usize] -= 1;
                after.v[to as usize] += 1;
                assert!(
                    score(&after) <= score(&start),
                    "{} -> {}: {} -> {} at {start:?}",
                    NAMES[from as usize],
                    NAMES[to as usize],
                    score(&start),
                    score(&after)
                );
                assert!(percent(&after).fine <= percent(&start).fine);
            }
        }
    }

    /// Raising a signal with a direction never moves the score against it.
    #[test]
    fn the_score_follows_each_signal_direction() {
        for start in starts() {
            for j in 0..N {
                let sign = crate::matching::signals::SIGN[j];
                if sign == 0 {
                    continue;
                }
                let mut s = start;
                let mut last: Option<u8> = None;
                for value in 0..=MAX[j].min(12) {
                    s.v[j] = value;
                    let now = score(&s);
                    if let Some(before) = last {
                        let wrong = if sign > 0 { now < before } else { now > before };
                        assert!(!wrong, "{} at {value}: {before} -> {now}", NAMES[j]);
                    }
                    last = Some(now);
                }
            }
        }
    }

    /// Role and field: the same field in full, near, far and foreign at their values; one
    /// level off keeps `LEVEL_ONE`, two above `LEVEL_TWO_ABOVE`, two below caps.
    #[test]
    fn the_role_part_follows_field_and_level() {
        let at = |pairs: &[(Sig, u16)]| percent(&sig(pairs)).shares[0];
        let value = |i: usize| u16::try_from(FIELD_VALUES[i]).unwrap();
        assert_eq!(at(&[(Sig::Role, 2)]), value(0));
        assert_eq!(at(&[(Sig::Role, 1)]), value(1));
        assert_eq!(at(&[(Sig::Relevance, 400)]), value(2));
        assert_eq!(at(&[(Sig::Relevance, 100)]), value(3));
        assert_eq!(at(&[(Sig::Relevance, 1000), (Sig::OffField, 1)]), value(3));
        let one = u16::try_from(LEVEL_ONE).unwrap();
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 1)]), one);
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 2)]), one);
        let two = u16::try_from(LEVEL_TWO_ABOVE).unwrap();
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 3)]), two);
        assert!(
            caps(&sig(&[(Sig::Role, 2), (Sig::Level, 4)])).contains(&(LEVEL_CAP, CapCode::Level))
        );
    }

    /// The field of a wished role is never foreign: a title that meets a target role keeps
    /// its field however few of the musts the profile meets (two levels below caps at 40,
    /// not at 24).
    #[test]
    fn a_target_role_is_never_a_foreign_field() {
        let agent = sig(&[
            (Sig::Role, 1),
            (Sig::OffField, 1),
            (Sig::Level, 4),
            (Sig::OtherOpen, 2),
        ]);
        assert_eq!(class(&agent), FieldClass::Near);
        assert_eq!(caps(&agent), vec![(LEVEL_CAP, CapCode::Level)]);
        let mut stranger = agent;
        stranger.v[Sig::Role as usize] = 0;
        assert!(caps(&stranger).contains(&(OFF_FIELD_CAP, CapCode::OffField)));
    }

    /// What an ad does not name counts as the role does: without musts on the core the core
    /// takes the share of role and field (and of the other musts named), a short list of
    /// other musts fills up with `UNNAMED` of role and field.
    #[test]
    fn missing_musts_count_as_the_role_does() {
        let teaser = percent(&sig(&[(Sig::Role, 1)]));
        assert_eq!(teaser.shares[1], teaser.shares[0]);
        assert_eq!(
            u64::from(teaser.shares[2]),
            u64::from(teaser.shares[0]) * UNNAMED / 1000
        );
        let two_met = percent(&sig(&[(Sig::Role, 2), (Sig::OtherMet, 2)]));
        let unnamed = (MUST_SATURATION - 2) * UNNAMED;
        assert_eq!(
            u64::from(two_met.shares[2]),
            (2000 + unnamed) / MUST_SATURATION
        );
        // One core must met of the three counted: the two unnamed count as role and field
        // (1000) and the other musts (all met) on average.
        let one_core = percent(&sig(&[
            (Sig::Role, 2),
            (Sig::CoreMet, 1),
            (Sig::OtherMet, 2),
        ]));
        assert_eq!(one_core.shares[1], 1000);
        let open_others = percent(&sig(&[
            (Sig::Role, 2),
            (Sig::CoreMet, 1),
            (Sig::OtherOpen, 2),
        ]));
        assert_eq!(u64::from(open_others.shares[1]), (1000 + 2 * 500) / 3);
    }

    /// The frame is a factor: what the ad does not state fits (factor 1), each condition worse
    /// than wished keeps `FRAME_STEP`, a permanent role then keeps `PERMANENT_FACTOR`.
    #[test]
    fn the_frame_is_a_factor() {
        let full = [(Sig::Role, 2), (Sig::CoreMet, 3), (Sig::OtherMet, 7)];
        let at = |extra: &[(Sig, u16)]| {
            let mut pairs = full.to_vec();
            pairs.extend_from_slice(extra);
            percent(&sig(&pairs))
        };
        let fits = at(&[]);
        assert_eq!((fits.content, fits.total, fits.steps), (100, 100, 0));
        let one = at(&[(Sig::FrameNear, 1)]);
        assert_eq!((one.frame[0], one.total), (5, 95));
        let two = at(&[(Sig::FrameNear, 1), (Sig::FrameMissed, 1)]);
        assert_eq!((two.frame[..2].to_vec(), two.total), (vec![5, 5], 90));
        let permanent = at(&[(Sig::FrameMissed, 1), (Sig::Permanent, 1)]);
        assert_eq!((permanent.permanent, permanent.total), (10, 85));
        assert_eq!(
            u64::from(at(&[(Sig::Permanent, 1)]).total),
            PERMANENT_FACTOR / 10
        );
    }

    /// A foreign field caps at 24, the core clearly open (less than half of it met) at 49.
    #[test]
    fn the_caps_hold_with_their_reasons() {
        let foreign = sig(&[(Sig::OffField, 1), (Sig::OtherOpen, 3)]);
        assert!(caps(&foreign).contains(&(OFF_FIELD_CAP, CapCode::OffField)));
        let core_open = sig(&[(Sig::Role, 2), (Sig::CoreMet, 1), (Sig::CoreOpen, 2)]);
        assert_eq!(caps(&core_open), vec![(CORE_OPEN_CAP, CapCode::CoreOpen)]);
        let half_met = sig(&[(Sig::Role, 2), (Sig::CoreMet, 1), (Sig::CoreOpen, 1)]);
        assert!(caps(&half_met).is_empty());
    }
}
