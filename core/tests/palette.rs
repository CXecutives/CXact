//! `ui/src/styles/tokens.css` is the one place a colour of the app is written. What is not the
//! page reads it through files `tools/tokens.mjs` generates: `core/src/export/palette.rs` (the
//! report, the Excel file, the Windows title bar), `tools/palette.json` (the app icon) and the
//! window's `backgroundColor` in `src-tauri/tauri*.conf.json`. These tests read tokens.css on
//! their own (their own parser, their own conversion to RGB) and fail while a generated file
//! is stale (`npm run regen` writes them anew).

use std::path::{Path, PathBuf};

use jobalert_core::export::palette::{self, Colour};
use regex::Regex;

const REGEN: &str = "stale against ui/src/styles/tokens.css: run `npm run regen`";

fn repo(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

fn read(relative: &str) -> String {
    std::fs::read_to_string(repo(relative)).unwrap_or_else(|e| panic!("{relative}: {e}"))
}

/// The custom properties of the first `:root` block of tokens.css (name without the dashes,
/// value with its white space folded), in order.
fn declarations() -> Vec<(String, String)> {
    let css = Regex::new(r"(?s)/\*.*?\*/")
        .unwrap()
        .replace_all(&read("ui/src/styles/tokens.css"), "")
        .into_owned();
    let start = css.find(":root {").expect(":root block") + ":root {".len();
    let body = &css[start..start + css[start..].find('}').expect("end of :root")];
    body.split(';')
        .filter_map(|part| {
            let (name, value) = part.trim().split_once(':')?;
            let name = name.trim().strip_prefix("--")?;
            Some((
                name.to_string(),
                value.split_whitespace().collect::<Vec<_>>().join(" "),
            ))
        })
        .collect()
}

/// An HSL triplet (`13 73% 63%`) as RGB, rounded like a browser.
fn rgb(triplet: &str) -> [u8; 3] {
    let parts: Vec<f64> = triplet
        .split(' ')
        .map(|p| p.trim_end_matches('%').parse().expect("HSL number"))
        .collect();
    let (hue, saturation, lightness) = (parts[0], parts[1] / 100.0, parts[2] / 100.0);
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let second = chroma * (1.0 - ((hue / 60.0) % 2.0 - 1.0).abs());
    let base = lightness - chroma / 2.0;
    let (red, green, blue) = match hue {
        h if h < 60.0 => (chroma, second, 0.0),
        h if h < 120.0 => (second, chroma, 0.0),
        h if h < 180.0 => (0.0, chroma, second),
        h if h < 240.0 => (0.0, second, chroma),
        h if h < 300.0 => (second, 0.0, chroma),
        _ => (chroma, 0.0, second),
    };
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        reason = "0..=255 by construction"
    )]
    let byte = |channel: f64| ((channel + base) * 255.0).round() as u8;
    [byte(red), byte(green), byte(blue)]
}

/// A colour token of tokens.css: its name, its CSS and its RGB.
#[derive(Debug, PartialEq)]
struct Token {
    name: String,
    css: String,
    rgb: [u8; 3],
}

/// Every colour token in the order of tokens.css: a semantic token whose value is
/// `hsl(var(--p-name))`, or `var(--other)` of another colour token. Tokens with an alpha,
/// gradients and shadows stay in the page.
fn colour_tokens() -> Vec<Token> {
    let all = declarations();
    let value = |name: &str| all.iter().find(|(n, _)| n == name).map(|(_, v)| v.as_str());
    let direct = Regex::new(r"^hsl\(var\(--(p-[\w-]+)\)\)$").unwrap();
    let alias = Regex::new(r"^var\(--([\w-]+)\)$").unwrap();
    let resolve = |name: &str| -> Option<String> {
        let mut name = name.to_string();
        loop {
            let token = value(&name)?;
            if let Some(found) = direct.captures(token) {
                return Some(value(&found[1]).expect("palette entry").to_string());
            }
            let next = alias.captures(token)?[1].to_string();
            if next.starts_with("p-") {
                return None;
            }
            name = next;
        }
    };
    all.iter()
        .filter(|(name, _)| !name.starts_with("p-"))
        .filter_map(|(name, _)| {
            let triplet = resolve(name)?;
            Some(Token {
                name: name.clone(),
                css: format!("hsl({triplet})"),
                rgb: rgb(&triplet),
            })
        })
        .collect()
}

fn token(name: &str) -> Token {
    colour_tokens()
        .into_iter()
        .find(|t| t.name == name)
        .unwrap_or_else(|| panic!("--{name} is no colour token"))
}

fn as_token(name: &str, colour: Colour) -> Token {
    Token {
        name: name.to_string(),
        css: colour.css.to_string(),
        rgb: colour.rgb,
    }
}

/// palette.rs holds every colour token, in order, as tokens.css says it; the score ring as
/// one table and the font stack too.
#[test]
fn the_rust_palette_is_the_tokens() {
    let generated: Vec<Token> = palette::TOKENS
        .iter()
        .map(|(name, colour)| as_token(name, *colour))
        .collect();
    assert_eq!(generated, colour_tokens(), "palette.rs {REGEN}");
    let steps: Vec<Token> = (0..10).map(|n| token(&format!("score-ring-{n}"))).collect();
    let ring: Vec<Token> = palette::SCORE_RING
        .iter()
        .enumerate()
        .map(|(n, colour)| as_token(&format!("score-ring-{n}"), *colour))
        .collect();
    assert_eq!(ring, steps, "palette.rs {REGEN}");
    let font = declarations()
        .into_iter()
        .find(|(name, _)| name == "font-sans")
        .expect("--font-sans")
        .1;
    assert_eq!(palette::FONT_SANS, font, "palette.rs {REGEN}");
}

/// palette.json (what tools/icon.py reads) holds the same colour tokens and font.
#[test]
fn the_icon_palette_is_the_tokens() {
    let json: serde_json::Value = serde_json::from_str(&read("tools/palette.json")).unwrap();
    let colours = json["colours"].as_object().expect("colours");
    let generated: Vec<Token> = colours
        .iter()
        .map(|(name, colour)| Token {
            name: name.clone(),
            css: colour["css"].as_str().expect("css").to_string(),
            rgb: serde_json::from_value(colour["rgb"].clone()).expect("rgb"),
        })
        .collect();
    let mut expected = colour_tokens();
    expected.sort_by(|a, b| a.name.cmp(&b.name));
    assert_eq!(generated, expected, "tools/palette.json {REGEN}");
    assert_eq!(
        json["fontSans"],
        palette::FONT_SANS,
        "tools/palette.json {REGEN}"
    );
}

/// Before the page paints, the window shows its `backgroundColor`: the page's `--bg`, on both
/// OS (Windows also shows it under its title bar).
#[test]
fn the_window_is_the_page_background() {
    let bg = token("bg");
    let hex = format!("#{:02X}{:02X}{:02X}", bg.rgb[0], bg.rgb[1], bg.rgb[2]);
    for file in [
        "src-tauri/tauri.conf.json",
        "src-tauri/tauri.macos.conf.json",
    ] {
        let config: serde_json::Value = serde_json::from_str(&read(file)).unwrap();
        assert_eq!(
            config["app"]["windows"][0]["backgroundColor"],
            hex.as_str(),
            "{file} {REGEN}"
        );
    }
}
