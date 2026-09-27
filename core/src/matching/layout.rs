//! The layout of an ad's text for the reader: the lines that head a section of the ad (the
//! ones the engine reads as headings: `Ihre Aufgaben`, `Ihr Profil`, `Wünschenswert`,
//! `Rahmen`, `Responsibilities`, `Requirements`) and the lines of a list (a bullet glyph
//! leads them). Everything else is text. UTF-16 offsets, as the browser counts.

use super::job;
use super::lexicon::{self, engine as lex};
use super::normalize::{is_space, strip};

/// A heading has at most this many words (a longer line is a sentence that starts with a
/// heading's word).
const HEADING_WORDS: usize = 6;

/// Headings and bullets of a text (UTF-16 `(start, end)` of `text`).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct TextLayout {
    /// The words of a heading line (without its indent and its trailing space).
    pub headings: Vec<(u32, u32)>,
    /// The bullet glyph of a list line and the space after it (the item follows).
    pub bullets: Vec<(u32, u32)>,
}

fn utf16(text: &str, byte: usize) -> u32 {
    let units = text.get(..byte).map_or(0, |p| p.encode_utf16().count());
    u32::try_from(units).unwrap_or(u32::MAX)
}

fn bullet_glyph(c: char) -> bool {
    lexicon::BULLETS.contains(&c) || lex::EXTRA_BULLETS.contains(&c)
}

/// The byte length of a line's bullet (its glyphs and the space after them), if a bullet
/// leads the line and words follow it. A dash or a star needs the space (`-20 %` is text).
fn bullet(line: &str) -> Option<usize> {
    let glyphs = line.len() - line.trim_start_matches(bullet_glyph).len();
    if glyphs == 0 {
        return None;
    }
    let rest = &line[glyphs..];
    let body = rest.trim_start_matches(is_space);
    let spaced = body.len() < rest.len();
    let plain_ascii = line[..glyphs].chars().all(|c| matches!(c, '-' | '*'));
    (!body.is_empty() && (spaced || !plain_ascii)).then_some(line.len() - body.len())
}

/// A heading the reader shows as one: the engine reads it as a heading, it is short and it
/// names no number (`Bewerbungsfrist 15.10.2026` opens no section, it states a date).
fn heading(line: &str) -> bool {
    line.split(is_space).filter(|w| !w.is_empty()).count() <= HEADING_WORDS
        && !line.chars().any(|c| c.is_ascii_digit())
        && job::is_heading_line(line)
}

/// The layout of a text, line by line.
pub fn text_layout(text: &str) -> TextLayout {
    let mut out = TextLayout::default();
    let mut start = 0;
    for line in text.split('\n') {
        let words = strip(line);
        if !words.is_empty() {
            let from = start + (line.len() - line.trim_start_matches(is_space).len());
            if let Some(length) = bullet(words) {
                out.bullets
                    .push((utf16(text, from), utf16(text, from + length)));
            } else if heading(words) {
                out.headings
                    .push((utf16(text, from), utf16(text, from + words.len())));
            }
        }
        start += line.len() + 1;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parts(text: &str, ranges: &[(u32, u32)]) -> Vec<String> {
        let units: Vec<u16> = text.encode_utf16().collect();
        ranges
            .iter()
            .map(|&(a, b)| String::from_utf16_lossy(&units[a as usize..b as usize]))
            .collect()
    }

    #[test]
    fn headings_and_bullets_in_german_and_english() {
        let text = "Über 400.000 Kunden vertrauen uns.\n\nIhre Aufgaben\n• Führung des Teams\n\
            • Monatsabschluss\n\n  Ihr Profil:\n- Reporting nach IFRS\n-20 % remote\n\n\
            Wünschenswert\n✓ Französisch\n\nRahmen\nStart ab sofort.\n\nBewerbungsfrist \
            15.10.2026\nResponsibilities\n* Lead the close\nRequirements\n";
        let l = text_layout(text);
        assert_eq!(
            parts(text, &l.headings),
            [
                "Ihre Aufgaben",
                "Ihr Profil:",
                "Wünschenswert",
                "Rahmen",
                "Responsibilities",
                "Requirements"
            ]
        );
        assert_eq!(parts(text, &l.bullets), ["• ", "• ", "- ", "✓ ", "* "]);
    }

    #[test]
    fn a_sentence_and_a_lone_glyph_are_text() {
        let text = "Ihr Profil umfasst langjährige Erfahrung im Controlling und im Reporting.\n\
            •\n---\n";
        let l = text_layout(text);
        assert!(l.headings.is_empty(), "{:?}", l.headings);
        assert!(l.bullets.is_empty(), "{:?}", l.bullets);
    }
}
