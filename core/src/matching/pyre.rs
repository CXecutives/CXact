//! Python `re` semantics on top of the `regex` crate.
//!
//! The old patterns use `re.IGNORECASE` and Python's Unicode `\s`, `\d` and `\b`. Two
//! tools make the Rust matches identical:
//! - pattern templates spell `{S}` (Python `\s`), `{NS}` (`\S`), `{D}` (`\d`) and `{DB}`
//!   (`\d` inside a class) with Python's exact character sets;
//! - [`view`] maps a text one character to one character so that plain lowercase
//!   literals match exactly what Python's case-insensitive matching accepted, and so
//!   that the `regex` crate's word boundary sees Python's `\w`.

use regex::Regex;

use super::normalize::{decimal, is_space, is_word};

const SPACE: &str = r"\t\n\x0B\x0C\r\x1C-\x1F \x{85}\x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}";

/// Compiles a pattern template (see the module docs). Panics on an invalid template,
/// which only a code change can cause.
pub(crate) fn compile(template: &str) -> Regex {
    let digits = super::normalize::digit_class_body();
    let pattern = template
        .replace("{S}", &format!("[{SPACE}]"))
        .replace("{NS}", &format!("[^{SPACE}]"))
        .replace("{DB}", &digits)
        .replace("{D}", &format!("[{digits}]"));
    Regex::new(&pattern).expect("valid matching pattern")
}

/// The text as Python's case-insensitive `re` sees it, one character per character.
///
/// Letters that Python matches against the lowercase pattern letters become those
/// letters; every other character becomes a stand-in with the same Python class
/// (`ª` for word characters, `¤` for other characters), except whitespace, digits and the
/// few non-ASCII pattern literals, which stay as they are.
pub(crate) fn view(text: &str) -> String {
    text.chars().map(view_char).collect()
}

fn view_char(c: char) -> char {
    if c.is_ascii() {
        return c.to_ascii_lowercase();
    }
    match c {
        '\u{130}' | '\u{131}' => 'i',
        '\u{212a}' => 'k',
        '\u{17f}' => 's',
        'Ä' => 'ä',
        'Ö' => 'ö',
        'Ü' => 'ü',
        '\u{1e9e}' => 'ß',
        'ä' | 'ö' | 'ü' | 'ß' | '：' | '€' => c,
        _ if is_space(c) || decimal(c).is_some() => c,
        _ if is_word(c) => 'ª',
        _ => '¤',
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_keeps_python_word_boundaries() {
        let onsite = compile(r"\b(?:vor{S}+ort)\b");
        assert!(onsite.is_match(&view("Arbeit VOR\u{a0}Ort.")));
        assert!(
            !onsite.is_match(&view("vor Ort²")),
            "² is a word character in Python"
        );
        assert!(
            onsite.is_match(&view("vor Ort\u{200d}")),
            "ZWJ is no word character in Python"
        );
        assert!(compile("abschluss").is_match(&view("ABSCHLUſS")));
        assert!(compile("fließend").is_match(&view("FLIEẞEND")));
        assert!(compile(r"{D}+").is_match(&view("\u{661}\u{662}")));
    }
}
