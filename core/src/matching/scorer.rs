//! The learned scorer (engine 24): the points of a job from its signals, as tables learned
//! from teacher labels (`tools/scorer/train.py`, `scorer_tables.rs`).
//!
//! `learned(s) = calib(clamp(INTERCEPT + sum(TABLES[j](s[j])), 0, 1000)) + ROLE_POINTS[role]`: each table maps
//! a signal to the points of its bin (the last bin whose lower edge the value reaches), the
//! calibration is piecewise linear between its knots. Per-mille (tenths of a score point),
//! integer only. A table rises with its signal where [`SIGN`] says up and falls where it says
//! down, and the calibration never falls: more of a good signal never lowers the score.
//!
//! [`SIGN`]: super::signals::SIGN

use super::scorer_tables::{CALIB, INTERCEPT, TABLES};
use super::signals::{Sig, Signals};

/// The plus of the target role the title meets (none, half, full; per-mille): the rubric's
/// "höchstens 10 Punkte". It comes after the calibration, so it is at most 10 points at every
/// score; the trainer leaves the signal out of the fit (`ROLE_POINTS` in
/// `tools/scorer/train.py`: change both together).
pub(crate) const ROLE_POINTS: [u16; 3] = [0, 50, 100];

/// The points of one signal value: those of the last bin whose lower edge it reaches.
fn lookup(table: &[(u16, i16)], value: u16) -> i32 {
    table
        .iter()
        .take_while(|(edge, _)| *edge <= value)
        .last()
        .map_or(0, |&(_, points)| i32::from(points))
}

/// The raw sum of the tables, clamped to 0..=1000.
fn raw(signals: &Signals) -> u16 {
    let sum = TABLES
        .iter()
        .zip(signals.v)
        .map(|(table, value)| lookup(table, value))
        .sum::<i32>()
        + INTERCEPT;
    u16::try_from(sum.clamp(0, 1000)).unwrap_or(0)
}

/// The calibration: piecewise linear between the knots, flat outside them.
fn calib(value: u16) -> u16 {
    let (first, last) = (CALIB[0], CALIB[CALIB.len() - 1]);
    if value <= first.0 {
        return first.1;
    }
    for pair in CALIB.windows(2) {
        let ((x0, y0), (x1, y1)) = (pair[0], pair[1]);
        if value <= x1 {
            let rise = u32::from(y1 - y0) * u32::from(value - x0) / u32::from(x1 - x0);
            return y0 + u16::try_from(rise).unwrap_or(0);
        }
    }
    last.1
}

/// The learned fit of a job with the plus of its target role (per-mille, 0..=1000).
pub(crate) fn learned(signals: &Signals) -> u16 {
    let role = ROLE_POINTS[usize::from(signals.get(Sig::Role)).min(ROLE_POINTS.len() - 1)];
    (calib(raw(signals)) + role).min(1000)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::signals::{MAX, N, NAMES, SIGN};

    #[test]
    fn the_tables_load() {
        assert_eq!(TABLES.len(), N);
        for (j, table) in TABLES.iter().enumerate() {
            assert!(!table.is_empty(), "{}", NAMES[j]);
            assert_eq!(table[0].0, 0, "{} starts at 0", NAMES[j]);
            assert!(
                table.windows(2).all(|w| w[0].0 < w[1].0),
                "{} edges rise",
                NAMES[j]
            );
            assert!(
                table.iter().all(|(edge, _)| *edge <= MAX[j]),
                "{}",
                NAMES[j]
            );
        }
        assert!(
            CALIB
                .windows(2)
                .all(|w| w[0].0 < w[1].0 && w[0].1 <= w[1].1)
        );
        assert!(CALIB.iter().all(|&(x, y)| x <= 1000 && y <= 1000));
    }

    #[test]
    fn learned_points_are_deterministic_and_bounded() {
        let mut s = Signals::default();
        for (j, max) in MAX.iter().enumerate() {
            s.v[j] = max / 2;
        }
        assert_eq!(learned(&s), learned(&s));
        assert!(learned(&Signals::default()) <= 1000);
        assert!(learned(&Signals { v: MAX }) <= 1000);
    }

    /// Raising one signal never moves the score against its direction, from several starts.
    #[test]
    fn the_score_follows_each_signal_direction() {
        let mut half = Signals::default();
        for (j, max) in MAX.iter().enumerate() {
            half.v[j] = max / 2;
        }
        for start in [Signals::default(), half, Signals { v: MAX }] {
            for j in 0..N {
                if SIGN[j] == 0 {
                    continue;
                }
                let mut s = start;
                let mut last: Option<u16> = None;
                for value in 0..=MAX[j] {
                    s.v[j] = value;
                    let now = learned(&s);
                    if let Some(before) = last {
                        let wrong = if SIGN[j] > 0 {
                            now < before
                        } else {
                            now > before
                        };
                        assert!(!wrong, "{} at {value}: {before} -> {now}", NAMES[j]);
                    }
                    last = Some(now);
                }
            }
        }
    }

    /// A target role adds at most 10 points, wherever the job stands.
    #[test]
    fn a_target_role_adds_at_most_ten() {
        let mut half = Signals::default();
        for (j, max) in MAX.iter().enumerate() {
            half.v[j] = max / 2;
        }
        for start in [Signals::default(), half, Signals { v: MAX }] {
            let mut none = start;
            none.v[Sig::Role as usize] = 0;
            let mut full = start;
            full.v[Sig::Role as usize] = 2;
            let lift = learned(&full) - learned(&none);
            assert!(lift <= 100, "{lift}");
        }
    }

    #[test]
    fn the_calibration_is_flat_outside_its_knots() {
        assert_eq!(calib(0), CALIB[0].1.min(calib(CALIB[0].0)));
        assert_eq!(calib(1000), CALIB[CALIB.len() - 1].1);
    }
}
