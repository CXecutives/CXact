//! `ui/src/styles/tokens.css` is the one place a colour of the app is written. What is not the
//! page reads it through files `tools/tokens.mjs` generates: `core/src/export/palette.rs` (the
//! Excel file, the window and its title bar, the icon's tests), `tools/palette.json` (the app
//! icon) and the window's `backgroundColor` in `src-tauri/tauri*.conf.json`. These tests read
//! tokens.css on their own (their own parser, their own conversion to RGB) and fail while a
//! generated file is stale (`npm run regen` writes them anew) or a colour is written anywhere
//! else.

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

/// tokens.css without its comments.
fn tokens_css() -> String {
    Regex::new(r"(?s)/\*.*?\*/")
        .unwrap()
        .replace_all(&read("ui/src/styles/tokens.css"), "")
        .into_owned()
}

/// The custom properties of the first `:root` block of tokens.css (Coast), in order.
fn declarations() -> Vec<(String, String)> {
    let css = tokens_css();
    let start = css.find(":root {").expect(":root block") + ":root {".len();
    properties(&css[start..start + css[start..].find('}').expect("end of :root")])
}

/// The palettes besides Coast by name: Coast's declarations with the ones of their
/// `:root[data-palette='name']` block laid over them.
fn palettes() -> Vec<(String, Vec<(String, String)>)> {
    let css = tokens_css();
    Regex::new(r":root\[data-palette='([\w-]+)'\]\s*\{([^}]*)\}")
        .unwrap()
        .captures_iter(&css)
        .map(|found| {
            let mut all = declarations();
            for (name, value) in properties(&found[2]) {
                match all.iter_mut().find(|(n, _)| *n == name) {
                    Some(entry) => entry.1 = value,
                    None => all.push((name, value)),
                }
            }
            (found[1].to_string(), all)
        })
        .collect()
}

/// The custom properties of a block's body (name without the dashes, value with its white
/// space folded), in order.
fn properties(body: &str) -> Vec<(String, String)> {
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
    colour_tokens_of(&declarations())
}

/// The colour tokens of a set of declarations (Coast's, or a palette's).
fn colour_tokens_of(all: &[(String, String)]) -> Vec<Token> {
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

/// The colour tokens something besides the page wears (`OUTSIDE` in tools/tokens.mjs): the
/// window, the Excel file (the score ring as a family), the icon.
const OUTSIDE: [&str; 5] = [
    "bg",
    "surface-muted",
    "score-excluded",
    "brand",
    "brand-glyph",
];

/// palette.rs holds the colour tokens something besides the page wears, in the order of
/// tokens.css, as tokens.css says them - no colour only the page (or the report of earlier
/// versions) wore; the score ring as one table too.
#[test]
fn the_rust_palette_is_the_tokens() {
    let generated: Vec<Token> = palette::TOKENS
        .iter()
        .map(|(name, colour)| as_token(name, *colour))
        .collect();
    let outside: Vec<Token> = colour_tokens()
        .into_iter()
        .filter(|t| OUTSIDE.contains(&t.name.as_str()) || t.name.starts_with("score-ring-"))
        .collect();
    assert_eq!(generated, outside, "palette.rs {REGEN}");
    let steps: Vec<Token> = (0..10).map(|n| token(&format!("score-ring-{n}"))).collect();
    let ring: Vec<Token> = palette::SCORE_RING
        .iter()
        .enumerate()
        .map(|(n, colour)| as_token(&format!("score-ring-{n}"), *colour))
        .collect();
    assert_eq!(ring, steps, "palette.rs {REGEN}");
}

/// The window's colour of every other palette (Light, Dark): `--bg` of its block, as the
/// window wears it before the page paints.
#[test]
fn the_window_colours_of_each_palette_are_the_tokens() {
    let found = palettes();
    let names: Vec<&str> = found.iter().map(|(name, _)| name.as_str()).collect();
    assert_eq!(names, ["light", "dark"], "the palettes of tokens.css");
    let mut expected = Vec::new();
    for (palette, all) in &found {
        let tokens = colour_tokens_of(all);
        let token = tokens
            .iter()
            .find(|t| t.name == "bg")
            .unwrap_or_else(|| panic!("{palette} has no --bg"));
        expected.push((
            palette.clone(),
            "bg".to_string(),
            token.css.clone(),
            token.rgb,
        ));
    }
    let generated: Vec<(String, String, String, [u8; 3])> = palette::WINDOW_PALETTES
        .iter()
        .map(|(palette, name, colour)| {
            (
                (*palette).to_string(),
                (*name).to_string(),
                colour.css.to_string(),
                colour.rgb,
            )
        })
        .collect();
    assert_eq!(generated, expected, "palette.rs {REGEN}");
}

/// palette.json (what tools/icon.py reads) holds every colour token of tokens.css.
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

/// Every source file of the program and its tools, with the files the generator writes and
/// the ones that only carry other people's colours (test mails) left out.
fn scanned() -> Vec<PathBuf> {
    fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
        for entry in std::fs::read_dir(dir).unwrap().flatten() {
            let path = entry.path();
            if path.is_dir() {
                walk(&path, out);
            } else if path.extension().is_some_and(|e| {
                ["rs", "py", "mjs", "js", "yml", "json"]
                    .iter()
                    .any(|x| e == *x)
            }) {
                out.push(path);
            }
        }
    }
    let mut out = Vec::new();
    for dir in ["core/src", "src-tauri/src", ".github"] {
        walk(&repo(dir), &mut out);
    }
    for file in ["tools/icon.py", "tools/tokens.mjs", "tools/third-party.mjs"] {
        out.push(repo(file));
    }
    out.retain(|p| !p.ends_with("core/src/export/palette.rs"));
    out
}

/// No colour is written outside tokens.css and the generated files: no hex colour, no
/// `hsl()`, `rgb()` or byte colour, and the window's configuration holds only the generated
/// `backgroundColor`.
#[test]
fn no_colour_is_written_twice() {
    let literal = Regex::new(
        r"#[0-9A-Fa-f]{6}\b|\b(hsla?|rgba?)\(\s*\d|Rgb = \[0x|\(0x[0-9A-Fa-f]{2}, 0x|0x00[0-9A-Fa-f]{2}_[0-9A-Fa-f]{4}\b",
    )
    .unwrap();
    let files = scanned();
    assert!(files.len() >= 100, "only {} files scanned", files.len());
    let mut problems = Vec::new();
    for path in files {
        let text = std::fs::read_to_string(&path).unwrap();
        for (n, line) in text.lines().enumerate() {
            if let Some(found) = literal.find(line) {
                problems.push(format!("{}:{}: {}", path.display(), n + 1, found.as_str()));
            }
        }
    }
    let hex = Regex::new(r"#[0-9A-Fa-f]{6}\b").unwrap();
    for file in [
        "src-tauri/tauri.conf.json",
        "src-tauri/tauri.macos.conf.json",
        "src-tauri/tauri.windows.conf.json",
    ] {
        let text = read(file);
        let generated = palette::BG.hex();
        for found in hex.find_iter(&text) {
            if !found.as_str().eq_ignore_ascii_case(&generated)
                || !text.contains(&format!("\"backgroundColor\": \"{}\"", found.as_str()))
            {
                problems.push(format!("{file}: {}", found.as_str()));
            }
        }
    }
    assert!(
        problems.is_empty(),
        "colours belong in ui/src/styles/tokens.css (docs/CHANGING.md):\n{}",
        problems.join("\n")
    );
}
