//! The colour scale of a score, shared by every place that draws one: ten steps by decile
//! (0-9 ... 90-100), red through orange and yellow to green. The steps are the tokens
//! `--score-ring-0` ... `--score-ring-9` of `ui/src/styles/tokens.css` (the app's ring), which
//! the report and the Excel score cells take through the generated [`super::palette`].
//! Excluded and unscored jobs are not on the scale.

use super::palette::{self, Colour};

/// Step `n` colours the scores `10 n ..= 10 n + 9` (the last step takes 100 too).
pub const SCORE_SCALE: [Colour; 10] = palette::SCORE_RING;

/// The step of a score (its decile, 100 in the last one).
#[must_use]
pub const fn score_step(score: u8) -> usize {
    let step = score / 10;
    if step > 9 { 9 } else { step as usize }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deciles_map_to_steps() {
        assert_eq!(score_step(0), 0);
        assert_eq!(score_step(9), 0);
        assert_eq!(score_step(10), 1);
        assert_eq!(score_step(89), 8);
        assert_eq!(score_step(90), 9);
        assert_eq!(score_step(100), 9);
    }
}
