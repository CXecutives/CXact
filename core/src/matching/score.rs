//! Integer rounding of the scores.

/// Half-to-even rounding of `numerator / denominator` for non-negative integers.
pub(crate) fn div_round_half_even(numerator: u64, denominator: u64) -> u64 {
    if denominator == 0 {
        return 0;
    }
    let quotient = numerator / denominator;
    let twice_rest = 2 * (numerator % denominator);
    match twice_rest.cmp(&denominator) {
        std::cmp::Ordering::Less => quotient,
        std::cmp::Ordering::Greater => quotient + 1,
        std::cmp::Ordering::Equal => quotient + (quotient & 1),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn integer_rounding() {
        assert_eq!(div_round_half_even(5, 2), 2);
        assert_eq!(div_round_half_even(7, 2), 4);
        assert_eq!(div_round_half_even(2, 3), 1);
    }
}
