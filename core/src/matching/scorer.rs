//! The Passungsgrad (engine 25): the score is the share of what matters for the job that the
//! profile fits, in four named parts with their weights (`params.rs`):
//!
//! - role and field: the field of the role (the same field or a target role in full, near,
//!   far, foreign; from the target role, the title and how the ad's text and its musts fit
//!   the profile's field) at its level (a wished level full, one above or below
//!   `LEVEL_ONE`, two or more above `LEVEL_TWO_ABOVE`; two or more below caps);
//! - core of the role: the share of the musts on the core of the role that the profile meets
//!   (without any, the share of role and field);
//! - other musts: the share of the other musts, counted as at least
//!   `MUST_SATURATION`, the ones a short list does not name at `UNNAMED` of role and field;
//! - frame: day rate, remote and place, start, duration and workload; what the ad does not
//!   state fits.
//!
//! A requirement met in part counts `PARTIAL`; what is unclear or missing never counts
//! against. The nice-to-haves add up to `NICE_MAX`, a permanent role keeps
//! `PERMANENT_FACTOR` (a line of its own), then the lowest cap holds, each with its reason.
//! Integer arithmetic only; every line is whole points, so the lines add up to the score.

use super::engine::Cap;
use super::params::{
    CORE_OPEN_CAP, E_FULL, FIELD_VALUES, FORMAL_CAP, HIT_RELEVANCE, HITS_MAX, JUNIOR_CAP,
    LEVEL_CAP, LEVEL_ONE, LEVEL_TWO_ABOVE, MUST_SATURATION, NICE_MAX, OFF_FIELD_CAP, PARTIAL,
    PERMANENT_FACTOR, RELEVANCE_FAR, RELEVANCE_NEAR, RELEVANCE_SAME, TITLE_NEAR, TITLE_SAME,
    UNNAMED, W_CORE, W_FRAME, W_MUSTS, W_ROLE,
};
use super::score::div_round_half_even;
use super::signals::{FRAME_ASPECTS, Sig, Signals};
use super::types::CapCode;

/// The weights of the parts in their order: role and field, core, other musts,
/// frame.
pub(crate) const WEIGHTS: [u64; 4] = [W_ROLE, W_CORE, W_MUSTS, W_FRAME];

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

/// The field class: foreign without any skill must met; the same field for a target role met
/// in full, a title of the profile's field or an ad that fits it closely; near for a target
/// role met in half or a title or an ad that fits it in part; far for an ad that touches it;
/// else foreign.
pub(crate) fn class(s: &Signals) -> FieldClass {
    let title = u64::from(s.get(Sig::TitleField));
    let role = s.get(Sig::Role);
    let field = field_fit(s);
    if s.get(Sig::OffField) == 1 {
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

/// How the score of one job came about: the parts, the nice-to-have bonus and the permanent line, in
/// whole points that add up to `total` (before the caps).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub(crate) struct Percent {
    pub class: Option<FieldClass>,
    /// The share of each part (per-mille): role and field, core, other musts, frame.
    pub shares: [u16; 4],
    /// The core without musts on the core of the role takes the share of role and field.
    pub core_fallback: bool,
    /// The points of each part, at most its weight.
    pub points: [u8; 4],
    /// The nice-to-have bonus (points, at most `NICE_MAX`).
    pub nice: u8,
    /// The points a permanent role takes.
    pub permanent: u8,
    /// The score before the caps: the parts plus the bonus minus the permanent line.
    pub total: u8,
    /// The same in per-mille before rounding: orders jobs with the same score.
    pub fine: u16,
}

fn point(value: u64) -> u8 {
    u8::try_from(value.min(100)).unwrap_or(100)
}

/// The Passungsgrad of one job from its signals.
pub(crate) fn percent(s: &Signals) -> Percent {
    let class = class(s);
    let role = class.value() * level_factor(s.get(Sig::Level)) / 1000;
    let (cm, cp, co) = (
        s.get(Sig::CoreMet),
        s.get(Sig::CorePartial),
        s.get(Sig::CoreOpen),
    );
    let core_fallback = cm + cp + co == 0;
    let core = share(cm, cp, co, 0, role);
    let musts = share(
        s.get(Sig::OtherMet),
        s.get(Sig::OtherPartial),
        s.get(Sig::OtherOpen),
        MUST_SATURATION,
        role * UNNAMED / 1000,
    );
    let missed = s.get(Sig::FrameMissed).min(FRAME_ASPECTS);
    let near = s.get(Sig::FrameNear).min(FRAME_ASPECTS - missed);
    let frame = share(
        FRAME_ASPECTS - near - missed,
        near,
        missed,
        u64::from(FRAME_ASPECTS),
        u64::from(E_FULL),
    );
    let shares = [role, core, musts, frame];
    let mut points = [0u8; 4];
    for (i, (w, sh)) in WEIGHTS.iter().zip(shares).enumerate() {
        points[i] = point(div_round_half_even(w * sh, 1000));
    }
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
    let nice = point(div_round_half_even(NICE_MAX * nice_share, 1000));
    let sum = u64::from(points.iter().map(|&p| u16::from(p)).sum::<u16>() + u16::from(nice));
    let sum = sum.min(100);
    let permanent_job = s.get(Sig::Permanent) == 1;
    let permanent = if permanent_job {
        point(div_round_half_even(sum * (1000 - PERMANENT_FACTOR), 1000))
    } else {
        0
    };
    let mut fine = (WEIGHTS
        .iter()
        .zip(shares)
        .map(|(w, sh)| w * sh)
        .sum::<u64>()
        + NICE_MAX * nice_share)
        / 100;
    fine = fine.min(1000);
    if permanent_job {
        fine = fine * PERMANENT_FACTOR / 1000;
    }
    Percent {
        class: Some(class),
        shares: shares.map(|v| u16::try_from(v.min(1000)).unwrap_or(1000)),
        core_fallback,
        points,
        nice,
        permanent,
        total: point(sum - u64::from(permanent)),
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
                        (Sig::FrameNear, 1),
                        (Sig::Permanent, u16::from(level % 2 == 1)),
                    ]));
                }
            }
        }
        out
    }

    fn score(s: &Signals) -> u8 {
        let p = percent(s);
        caps(s).iter().map(|c| c.0).fold(p.total, u8::min)
    }

    #[test]
    fn the_weights_sum_to_one_hundred_and_stay_in_range() {
        assert_eq!(WEIGHTS.iter().sum::<u64>(), 100);
        assert!(WEIGHTS.iter().all(|w| (10..=50).contains(w)));
        const { assert!(PARTIAL <= 1000 && LEVEL_ONE <= 1000 && LEVEL_TWO_ABOVE <= LEVEL_ONE) };
        assert!(FIELD_VALUES.windows(2).all(|w| w[0] >= w[1]));
    }

    /// The lines add up: the four parts, the nice-to-have bonus, minus the permanent line, are the
    /// total, and every part stays within its weight.
    #[test]
    fn the_parts_add_up_to_the_total() {
        for s in starts() {
            let p = percent(&s);
            let sum: u16 = p.points.iter().map(|&x| u16::from(x)).sum::<u16>() + u16::from(p.nice);
            assert_eq!(
                u16::from(p.total),
                sum.min(100) - u16::from(p.permanent),
                "{s:?}"
            );
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
    /// level off keeps `LEVEL_ONE`, two above `LEVEL_TWO_ABOVE`.
    #[test]
    fn the_role_part_follows_field_and_level() {
        let at = |pairs: &[(Sig, u16)]| percent(&sig(pairs)).shares[0];
        let value = |i: usize| u16::try_from(FIELD_VALUES[i]).unwrap();
        assert_eq!(at(&[(Sig::Role, 2)]), value(0));
        assert_eq!(at(&[(Sig::Role, 1)]), value(1));
        assert_eq!(at(&[(Sig::Relevance, 400)]), value(2));
        assert_eq!(at(&[(Sig::Relevance, 100)]), value(3));
        assert_eq!(at(&[(Sig::Role, 2), (Sig::OffField, 1)]), value(3));
        let one = u16::try_from(LEVEL_ONE).unwrap();
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 1)]), one);
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 2)]), one);
        let two = u16::try_from(LEVEL_TWO_ABOVE).unwrap();
        assert_eq!(at(&[(Sig::Role, 2), (Sig::Level, 3)]), two);
        assert!(
            caps(&sig(&[(Sig::Role, 2), (Sig::Level, 4)])).contains(&(LEVEL_CAP, CapCode::Level))
        );
    }

    /// Without musts on the core the core takes the share of role and field; the musts a short
    /// list does not name count as role and field does.
    #[test]
    fn missing_musts_count_as_the_role_does() {
        let p = percent(&sig(&[(Sig::Role, 1)]));
        assert!(p.core_fallback);
        assert_eq!(p.shares[1], p.shares[0]);
        assert_eq!(
            u64::from(p.shares[2]),
            u64::from(p.shares[0]) * UNNAMED / 1000
        );
        let two_met = percent(&sig(&[(Sig::Role, 2), (Sig::OtherMet, 2)]));
        let unnamed = (MUST_SATURATION - 2) * UNNAMED;
        assert_eq!(
            u64::from(two_met.shares[2]),
            (2000 + unnamed) / MUST_SATURATION
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
