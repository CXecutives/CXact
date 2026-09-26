//! A colour of the app's tokens, as the generated [`super::palette`] carries it.

/// A colour token of `ui/src/styles/tokens.css`: its CSS and its sRGB bytes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Colour {
    /// As CSS (`hsl(H S% L%)`), exactly as the token's palette entry writes it.
    pub css: &'static str,
    /// Red, green and blue, rounded like a browser.
    pub rgb: [u8; 3],
}

impl Colour {
    #[must_use]
    pub const fn new(css: &'static str, rgb: [u8; 3]) -> Colour {
        Colour { css, rgb }
    }

    /// As `0xRRGGBB` (what the Excel writer takes).
    #[must_use]
    pub const fn rgb_u32(self) -> u32 {
        let [red, green, blue] = self.rgb;
        ((red as u32) << 16) | ((green as u32) << 8) | blue as u32
    }

    /// As `#RRGGBB`.
    #[must_use]
    pub fn hex(self) -> String {
        let [red, green, blue] = self.rgb;
        format!("#{red:02X}{green:02X}{blue:02X}")
    }
}

#[cfg(test)]
mod tests {
    use super::Colour;

    #[test]
    fn bytes_read_as_one_number_and_as_hex() {
        let colour = Colour::new("", [0x12, 0xAB, 0x05]);
        assert_eq!(colour.rgb_u32(), 0x12_AB05);
        assert_eq!(colour.hex(), format!("#{:06X}", colour.rgb_u32()));
    }
}
