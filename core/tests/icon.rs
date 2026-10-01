//! The app icon files must match their generator (`tools/icon.py`): the ICO stages in the same
//! order, the ICNS entries, the 1024 PNG and the SVG brand mark. Tauri takes the first ICO entry
//! as the window icon (title bar, Alt+Tab, taskbar); a small stage there would be scaled up and
//! look blurry next to the sharp Explorer icon.
//!
//! The ICO stages carry straight alpha and the plate colour in every pixel, the transparent ones
//! included (colour bleed): the Windows shell scales a stage without premultiplying when it has
//! no stage of the wanted size, and a transparent black pixel then becomes a dark fringe around
//! the plate on the desktop.
//!
//! The plate's geometry is pinned by a reference written down here, independent of the
//! generator: Apple's continuous corner, the radius as a share of the plate and an exact
//! area-coverage rasterizer. Every stage's alpha must match it within one level.

// Pixel coordinates and levels: small non-negative numbers (at most 1024 and 255).
#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    clippy::cast_possible_wrap
)]

use std::io::Read;
use std::path::Path;

use jobalert_core::export::palette;

/// One stage in the ICO directory.
struct Entry {
    width: u32,
    height: u32,
    planes: u16,
    bpp: u16,
    png: bool,
    len: usize,
    /// Set bits of the AND mask (DIB stages only).
    mask_bits: u32,
    /// Straight RGBA, top row first.
    pixels: Vec<[u8; 4]>,
    /// The AND mask per pixel, top row first (DIB stages only; true = transparent).
    mask: Option<Vec<bool>>,
}

/// Reads an ICO file (header 6 bytes, then 16 bytes per stage) and decodes every stage.
fn read_ico(bytes: &[u8]) -> Vec<Entry> {
    assert_eq!(&bytes[0..4], [0, 0, 1, 0], "not an ICO file");
    let count = usize::from(u16::from_le_bytes([bytes[4], bytes[5]]));
    (0..count)
        .map(|i| {
            let e = &bytes[6 + 16 * i..6 + 16 * (i + 1)];
            // 0 in the width/height byte means 256.
            let size = |b: u8| if b == 0 { 256 } else { u32::from(b) };
            let at = |o: usize| u32::from_le_bytes([e[o], e[o + 1], e[o + 2], e[o + 3]]) as usize;
            let (len, offset) = (at(8), at(12));
            let blob = &bytes[offset..offset + len];
            let png = blob.starts_with(&[0x89, b'P', b'N', b'G']);
            let w = size(e[0]);
            let (pixels, mask) = if png {
                (decode_png(blob), None)
            } else {
                let (pixels, mask) = decode_dib(blob, w as usize);
                (pixels, Some(mask))
            };
            Entry {
                width: w,
                height: size(e[1]),
                planes: u16::from_le_bytes([e[4], e[5]]),
                bpp: u16::from_le_bytes([e[6], e[7]]),
                png,
                len,
                mask_bits: {
                    let start = 40 + (w * w * 4) as usize;
                    blob.get(start..)
                        .map_or(0, |m| m.iter().map(|b| b.count_ones()).sum())
                },
                pixels,
                mask,
            }
        })
        .collect()
}

/// Pixels (RGBA, top row first) and AND mask of a 32 bpp DIB stage: BITMAPINFOHEADER, BGRA rows
/// bottom up, then the mask rows bottom up, each padded to 4 bytes.
fn decode_dib(blob: &[u8], s: usize) -> (Vec<[u8; 4]>, Vec<bool>) {
    let head = u32::from_le_bytes([blob[0], blob[1], blob[2], blob[3]]) as usize;
    let xor = &blob[head..head + s * s * 4];
    let and = &blob[head + s * s * 4..];
    let stride = s.div_ceil(32) * 4;
    let mut pixels = Vec::with_capacity(s * s);
    let mut mask = Vec::with_capacity(s * s);
    for y in 0..s {
        let row = s - 1 - y;
        for x in 0..s {
            let p = &xor[(row * s + x) * 4..][..4];
            pixels.push([p[2], p[1], p[0], p[3]]);
            mask.push(and[row * stride + x / 8] & (0x80 >> (x % 8)) != 0);
        }
    }
    (pixels, mask)
}

/// Pixels (RGBA, top row first) of a PNG as the generator writes it: 8 bit RGBA, not interlaced.
fn decode_png(png: &[u8]) -> Vec<[u8; 4]> {
    let (w, h) = png_size(png);
    assert_eq!(
        (png[24], png[25], png[28]),
        (8, 6, 0),
        "PNG stage must be 8 bit RGBA, not interlaced"
    );
    let mut idat = Vec::new();
    let mut at = 8;
    while at + 8 <= png.len() {
        let len = u32::from_be_bytes([png[at], png[at + 1], png[at + 2], png[at + 3]]) as usize;
        if &png[at + 4..at + 8] == b"IDAT" {
            idat.extend_from_slice(&png[at + 8..at + 8 + len]);
        }
        at += 12 + len;
    }
    let mut raw = Vec::new();
    flate2::read::ZlibDecoder::new(idat.as_slice())
        .read_to_end(&mut raw)
        .expect("PNG data inflates");
    let stride = w as usize * 4;
    let mut out = vec![0u8; stride * h as usize];
    for y in 0..h as usize {
        let filter = raw[y * (stride + 1)];
        let line = &raw[y * (stride + 1) + 1..(y + 1) * (stride + 1)];
        for (x, &value) in line.iter().enumerate() {
            let left = if x >= 4 { out[y * stride + x - 4] } else { 0 };
            let up = if y > 0 { out[(y - 1) * stride + x] } else { 0 };
            let up_left = if x >= 4 && y > 0 {
                out[(y - 1) * stride + x - 4]
            } else {
                0
            };
            let predictor = match filter {
                0 => 0,
                1 => left,
                2 => up,
                3 => left.midpoint(up), // rounds down, as PNG's average filter
                4 => paeth(left, up, up_left),
                other => panic!("unknown PNG filter {other}"),
            };
            out[y * stride + x] = value.wrapping_add(predictor);
        }
    }
    out.chunks_exact(4)
        .map(|p| [p[0], p[1], p[2], p[3]])
        .collect()
}

fn paeth(left: u8, up: u8, up_left: u8) -> u8 {
    let estimate = i16::from(left) + i16::from(up) - i16::from(up_left);
    let distance = |v: u8| (estimate - i16::from(v)).abs();
    if distance(left) <= distance(up) && distance(left) <= distance(up_left) {
        left
    } else if distance(up) <= distance(up_left) {
        up
    } else {
        up_left
    }
}

/// The plate's colour: the app's `--brand` token (tools/icon.py reads it from
/// tools/palette.json, which says what the generated palette says: core/tests/palette.rs).
const BRAND: [u8; 3] = palette::BRAND.rgb;

/// A number constant of the generator, e.g. `MASK_ALPHA = 128`.
fn generator_number(source: &str, name: &str) -> u8 {
    let head = format!("\n{name} = ");
    let start = source.find(&head).expect("constant in tools/icon.py") + head.len();
    source[start..]
        .split(|c: char| !c.is_ascii_digit())
        .next()
        .and_then(|n| n.parse().ok())
        .expect("number")
}

fn repo(relative: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join(relative)
}

/// The list `NAME = [...]` of the generator (numbers or quoted pairs).
fn generator_list<'a>(source: &'a str, name: &str) -> &'a str {
    let head = format!("{name} = [");
    let start = source.find(&head).expect("list in tools/icon.py") + head.len();
    let end = start + source[start..].find(']').expect("closing bracket");
    &source[start..end]
}

/// The entries of an ICNS file (`icns`, total length, then per entry its type, its length
/// including these 8 bytes and its data): type and data, here a PNG each.
fn icns_entries(icns: &[u8]) -> Vec<(String, &[u8])> {
    assert_eq!(&icns[0..4], b"icns");
    let be = |at: usize| {
        u32::from_be_bytes([icns[at], icns[at + 1], icns[at + 2], icns[at + 3]]) as usize
    };
    assert_eq!(be(4), icns.len(), "ICNS length field");
    let mut entries = Vec::new();
    let mut at = 8;
    while at < icns.len() {
        let ostype = String::from_utf8_lossy(&icns[at..at + 4]).into_owned();
        let len = be(at + 4);
        entries.push((ostype, &icns[at + 8..at + len]));
        at += len;
    }
    entries
}

/// Width and height of a PNG (IHDR).
fn png_size(png: &[u8]) -> (u32, u32) {
    assert!(png.starts_with(&[0x89, b'P', b'N', b'G']), "not a PNG");
    let be = |o: usize| u32::from_be_bytes([png[o], png[o + 1], png[o + 2], png[o + 3]]);
    (be(16), be(20))
}

#[test]
fn icon_stages_match_generator() {
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    let entries = read_ico(&bytes);
    let source = std::fs::read_to_string(repo("tools/icon.py")).unwrap();
    let sizes: Vec<u32> = generator_list(&source, "SIZES")
        .split(',')
        .map(|s| s.trim().parse().expect("number in SIZES"))
        .collect();

    let actual: Vec<u32> = entries.iter().map(|e| e.width).collect();
    assert_eq!(
        actual, sizes,
        "icon.ico does not match tools/icon.py any more - regenerate: python tools/icon.py"
    );
    for e in &entries {
        assert_eq!(e.width, e.height, "stage {} is not square", e.width);
        assert_eq!(e.bpp, 32, "stage {} without alpha", e.width);
        assert_eq!(e.planes, 1, "stage {}: planes must be 1", e.width);
        // Only 256 is compressed: older image libraries (GDI+ among them) cannot read a
        // compressed smaller stage and then show nothing.
        assert_eq!(
            e.png,
            e.width == 256,
            "stage {}: PNG only for 256, else an uncompressed DIB",
            e.width
        );
        if !e.png {
            // BITMAPINFOHEADER + BGRA pixels + AND mask; a short stage stays empty.
            let mask = e.width.div_ceil(32) * 4 * e.height;
            let expected = 40 + e.width * e.height * 4 + mask;
            assert_eq!(
                e.len, expected as usize,
                "stage {}: DIB is not complete",
                e.width
            );
            // The mask belongs to the image: whoever reads only the mask would otherwise get
            // an opaque border around the rounded plate.
            assert!(
                e.mask_bits > 0,
                "stage {}: empty AND mask, the transparent corners are missing",
                e.width
            );
        }
    }
}

/// The AND mask is the plate rounded to whole pixels: transparent exactly where the alpha is
/// below the generator's threshold (half coverage).
#[test]
fn and_mask_follows_the_alpha() {
    let source = std::fs::read_to_string(repo("tools/icon.py")).unwrap();
    let threshold = generator_number(&source, "MASK_ALPHA");
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    for e in read_ico(&bytes) {
        let Some(mask) = &e.mask else { continue };
        let wrong = e
            .pixels
            .iter()
            .zip(mask)
            .filter(|(p, transparent)| **transparent != (p[3] < threshold))
            .count();
        assert_eq!(
            wrong, 0,
            "stage {}: {wrong} AND mask bits do not match the alpha",
            e.width
        );
    }
}

/// Every size the shell asks for at 100/125/150/175/200 % (Explorer, desktop, taskbar, Start,
/// Alt+Tab) has its own stage, so Windows draws it 1:1 instead of scaling another one.
#[test]
fn ico_has_a_stage_for_every_windows_scale() {
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    let sizes: Vec<u32> = read_ico(&bytes).iter().map(|e| e.width).collect();
    for wanted in [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256] {
        assert!(
            sizes.contains(&wanted),
            "icon.ico has no {wanted} stage ({sizes:?})"
        );
    }
}

/// No pixel of any ICO stage - transparent ones included - is darker than the plate's darkest
/// colour. A transparent black pixel (0,0,0,0) is invisible 1:1 but turns into a dark fringe
/// around the plate as soon as Windows scales the stage without premultiplying; premultiplied
/// storage darkens the edge the same way; a macOS drop shadow would show here too.
#[test]
fn ico_stages_have_no_dark_fringe() {
    let source = std::fs::read_to_string(repo("tools/icon.py")).unwrap();
    let glyph = palette::BRAND_GLYPH.rgb;
    let darkest = [0, 1, 2].map(|k| BRAND[k].min(glyph[k]));
    let tolerance = generator_number(&source, "FRINGE_TOLERANCE");
    assert!(tolerance <= 4, "the fringe tolerance must stay small");
    let floor = darkest.map(|c| c.saturating_sub(tolerance));
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    for e in read_ico(&bytes) {
        let dark: Vec<(usize, usize, [u8; 4])> = e
            .pixels
            .iter()
            .enumerate()
            .filter(|(_, p)| (0..3).any(|k| p[k] < floor[k]))
            .map(|(i, p)| (i % e.width as usize, i / e.width as usize, *p))
            .collect();
        assert!(
            dark.is_empty(),
            "stage {}: {} pixels darker than the plate {darkest:?} (first at x, y, rgba: {:?}) - \
             transparent pixels must carry the plate colour: python tools/icon.py",
            e.width,
            dark.len(),
            dark[0]
        );
    }
}

/// icon.png is the macOS 1024 entry (Apple's margin and template shadow); Windows takes
/// everything from icon.ico.
#[test]
fn windows_uses_only_the_ico() {
    for config in [
        "src-tauri/tauri.conf.json",
        "src-tauri/tauri.windows.conf.json",
    ] {
        let text = std::fs::read_to_string(repo(config)).unwrap();
        let json: serde_json::Value = serde_json::from_str(&text).unwrap();
        let icons = json["bundle"]["icon"].as_array().expect("bundle.icon");
        assert!(
            icons.iter().all(|i| i.as_str().is_some_and(|p| Path::new(p)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("ico")))),
            "{config}: Windows must not use the macOS PNG or ICNS: {icons:?}"
        );
    }
}

#[test]
fn window_icon_is_the_48_stage() {
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    let first = &read_ico(&bytes)[0];
    assert_eq!(
        first.width, 48,
        "Tauri takes the first entry as the window icon - a smaller stage would be scaled up"
    );
}

/// The ICNS holds the generator's entries in its order, each a PNG of its size; icon.png is
/// the 1024 entry.
#[test]
fn mac_icons_match_generator() {
    let source = std::fs::read_to_string(repo("tools/icon.py")).unwrap();
    let expected: Vec<(String, u32)> = generator_list(&source, "ICNS_ENTRIES")
        .split(')')
        .filter_map(|pair| {
            let pair = pair.trim_start_matches(|c: char| c == ',' || c.is_whitespace());
            let (ostype, size) = pair.split_once(',')?;
            let ostype = ostype.trim_matches(|c: char| !c.is_ascii_alphanumeric());
            let size = size.trim().parse().ok()?;
            Some((ostype.to_owned(), size))
        })
        .collect();
    assert_eq!(expected.len(), 8, "{expected:?}");
    let icns = std::fs::read(repo("src-tauri/icons/icon.icns")).unwrap();
    let mut found = Vec::new();
    let mut largest = &icns[0..0];
    for (ostype, png) in icns_entries(&icns) {
        let (w, h) = png_size(png);
        assert_eq!(w, h, "{ostype} is not square");
        if w == 1024 {
            largest = png;
        }
        found.push((ostype, w));
    }
    assert_eq!(found, expected, "icon.icns does not match tools/icon.py");
    let png = std::fs::read(repo("src-tauri/icons/icon.png")).unwrap();
    assert_eq!(png_size(&png), (1024, 1024));
    assert_eq!(png, largest, "icon.png is the 1024 entry of the ICNS");
}

/// The brand mark in the UI is the generator's vector: same plate crop, the check cut out of
/// the folder, one flat colour each (the app's --brand and --brand-glyph).
#[test]
fn ui_brand_mark_is_the_generated_vector() {
    let svg = std::fs::read_to_string(repo("ui/src/assets/app-icon.svg")).unwrap();
    assert!(
        svg.contains("Generated by tools/icon.py"),
        "edited by hand?"
    );
    assert!(
        svg.contains(r#"viewBox="0 0 1024 1024""#),
        "the plate fills the square"
    );
    assert!(
        svg.contains(r#"fill-rule="evenodd""#),
        "the check is a cut-out"
    );
    let plate = format!(r#"<path fill="{}" d="#, palette::BRAND.hex());
    let glyph = format!(
        r#"<path fill="{}" fill-rule="evenodd""#,
        palette::BRAND_GLYPH.hex()
    );
    assert!(svg.contains(&plate), "the plate is --brand: npm run regen");
    assert!(
        svg.contains(&glyph),
        "the glyph is --brand-glyph: npm run regen"
    );
    assert!(!svg.contains("Gradient"), "a gradient is back");
    assert_eq!(
        svg.matches("<path").count(),
        2,
        "plate and folder with check"
    );
}

/// The `d` attributes of an SVG's paths, in order.
fn svg_paths(svg: &str) -> Vec<&str> {
    svg.split(" d=\"")
        .skip(1)
        .map(|rest| &rest[..rest.find('"').expect("closing quote")])
        .collect()
}

/// macOS 26 draws the app icon from an Icon Composer package: --brand as the fill, one
/// group with one layer, the white glyph on the full square (the same path as the brand mark,
/// whose plate fills the square too), nothing baked in the system draws itself. The package
/// never goes into `bundle.icon`: `tauri build` crashes on it (tauri-apps/tauri#15315), the
/// macOS CI compiles it with actool instead.
#[test]
fn icon_composer_package_is_the_glyph() {
    let text = std::fs::read_to_string(repo("src-tauri/icons/CXact.icon/icon.json")).unwrap();
    let spec: serde_json::Value = serde_json::from_str(&text).unwrap();
    let channels: Vec<String> = BRAND
        .iter()
        .map(|c| format!("{:.5}", f64::from(*c) / 255.0))
        .collect();
    assert_eq!(
        spec["fill"]["solid"],
        format!("extended-srgb:{},1.00000", channels.join(",")),
        "the fill is --brand: npm run regen"
    );
    let groups = spec["groups"].as_array().expect("groups");
    assert_eq!(groups.len(), 1, "one group");
    let layers = groups[0]["layers"].as_array().expect("layers");
    assert_eq!(layers.len(), 1, "one layer");
    assert_eq!(layers[0]["image-name"], "glyph.svg");
    assert_eq!(
        layers[0]["position"]["scale"], 1,
        "the glyph fills the canvas"
    );

    let glyph =
        std::fs::read_to_string(repo("src-tauri/icons/CXact.icon/Assets/glyph.svg")).unwrap();
    assert!(
        glyph.contains("Generated by tools/icon.py"),
        "edited by hand?"
    );
    assert!(
        glyph.contains(r#"viewBox="0 0 1024 1024" width="1024" height="1024""#),
        "the glyph is laid out on the full square"
    );
    let plate = palette::BRAND.hex();
    for baked in ["<mask", "<filter", "<clipPath", "Gradient", plate.as_str()] {
        assert!(!glyph.contains(baked), "{baked} is the system's job");
    }
    let mark = std::fs::read_to_string(repo("ui/src/assets/app-icon.svg")).unwrap();
    assert_eq!(
        svg_paths(&glyph),
        svg_paths(&mark)[1..],
        "the glyph is the brand mark's folder with the check"
    );

    let text = std::fs::read_to_string(repo("src-tauri/tauri.macos.conf.json")).unwrap();
    let config: serde_json::Value = serde_json::from_str(&text).unwrap();
    let icons = config["bundle"]["icon"].as_array().expect("bundle.icon");
    assert!(
        icons
            .iter()
            .all(|i| i.as_str().is_some_and(|p| !Path::new(p)
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("icon")))),
        "tauri build crashes on a .icon in bundle.icon: {icons:?}"
    );
}

// ------------------------------------------------------------------- reference geometry

/// Apple's continuous corner as `UIKit` draws it (the path dumped by Liam Rosenfeld, 2021): the
/// curve leaves the incoming edge `CORNER_START` radii before the corner and reaches the
/// outgoing edge as far after it, in three cubics. Points are (back along the incoming edge,
/// forward along the outgoing edge) in radii; the curve is symmetric about the diagonal.
const CORNER_START: f64 = 1.528_664_98;
const CORNER: [[(f64, f64); 3]; 3] = [
    [
        (1.088_492_96, 0.0),
        (0.868_406_94, 0.0),
        (0.631_493_79, 0.074_911_39),
    ],
    [
        (0.372_823_83, 0.169_059_56),
        (0.169_059_56, 0.372_823_83),
        (0.074_911_39, 0.631_493_79),
    ],
    [
        (0.0, 0.868_406_94),
        (0.0, 1.088_492_96),
        (0.0, CORNER_START),
    ],
];

/// The plate's corner radius as a share of its side: Mike Swanson's fit to Apple's own
/// `AppIconMask` (34 of 152). Apple publishes no number.
const PLATE_RADIUS: f64 = 0.2237;

/// The plate (left, top)..(right, bottom) as a polygon, clockwise on screen: straight sides
/// and the continuous corner, each cubic flattened into 256 chords (far below a level at 1024).
fn plate_outline(left: f64, top: f64, right: f64, bottom: f64) -> Vec<(f64, f64)> {
    let radius = PLATE_RADIUS * (right - left);
    // Corner, incoming direction, outgoing direction.
    let corners = [
        ((right, top), (1.0, 0.0), (0.0, 1.0)),
        ((right, bottom), (0.0, 1.0), (-1.0, 0.0)),
        ((left, bottom), (-1.0, 0.0), (0.0, -1.0)),
        ((left, top), (0.0, -1.0), (1.0, 0.0)),
    ];
    let mut out = Vec::new();
    for (corner, incoming, outgoing) in corners {
        let at = |(back, forward): (f64, f64)| {
            (
                corner.0 - back * radius * incoming.0 + forward * radius * outgoing.0,
                corner.1 - back * radius * incoming.1 + forward * radius * outgoing.1,
            )
        };
        let mut start = at((CORNER_START, 0.0));
        out.push(start);
        for [first, second, end] in CORNER {
            let control = [start, at(first), at(second), at(end)];
            for step in 1..=256 {
                let t = f64::from(step) / 256.0;
                let rest = 1.0 - t;
                let weights = [
                    rest * rest * rest,
                    3.0 * rest * rest * t,
                    3.0 * rest * t * t,
                    t * t * t,
                ];
                let point = control
                    .iter()
                    .zip(weights)
                    .fold((0.0, 0.0), |sum, (point, weight)| {
                        (sum.0 + weight * point.0, sum.1 + weight * point.1)
                    });
                out.push(point);
            }
            start = control[3];
        }
    }
    out
}

/// The Windows plate (left, top)..(right, bottom) as a polygon, clockwise on screen: straight
/// sides and circular corners of the same radius, as the icon workshop draws them (user,
/// 2026-10-01), each quarter circle flattened into 256 chords.
fn round_plate_outline(left: f64, top: f64, right: f64, bottom: f64) -> Vec<(f64, f64)> {
    let radius = PLATE_RADIUS * (right - left);
    // Each corner's centre and the angle its quarter circle starts at (y down: clockwise).
    let corners = [
        ((right - radius, top + radius), -std::f64::consts::FRAC_PI_2),
        ((right - radius, bottom - radius), 0.0),
        (
            (left + radius, bottom - radius),
            std::f64::consts::FRAC_PI_2,
        ),
        ((left + radius, top + radius), std::f64::consts::PI),
    ];
    let mut out = Vec::new();
    for ((x, y), start) in corners {
        for step in 0..=256 {
            let angle = start + std::f64::consts::FRAC_PI_2 * f64::from(step) / 256.0;
            out.push((x + radius * angle.cos(), y + radius * angle.sin()));
        }
    }
    out
}

/// Exact area coverage (0..1) of a polygon on a size x size grid, top row first: every edge
/// adds the signed area between itself and the right side of each cell it crosses (the
/// accumulation of font-rs); a running sum along the row gives each pixel's covered share.
/// The polygon must stay within 0..size horizontally.
fn coverage(outline: &[(f64, f64)], size: usize) -> Vec<f64> {
    use std::cmp::Ordering;
    let stride = size + 2;
    let mut acc = vec![0.0f64; size * stride + 2];
    for (index, &from) in outline.iter().enumerate() {
        let to = outline[(index + 1) % outline.len()];
        // Downwards edges count +1, upwards -1; a horizontal edge adds nothing.
        let (sign, upper, lower) = match from.1.partial_cmp(&to.1) {
            Some(Ordering::Less) => (1.0, from, to),
            Some(Ordering::Greater) => (-1.0, to, from),
            _ => continue,
        };
        let dxdy = (lower.0 - upper.0) / (lower.1 - upper.1);
        let mut x = upper.0;
        if upper.1 < 0.0 {
            x -= upper.1 * dxdy;
        }
        let first = upper.1.max(0.0).floor() as usize;
        let last = (lower.1.ceil().max(0.0) as usize).min(size);
        for y in first..last {
            let row = y * stride;
            let height = ((y + 1) as f64).min(lower.1) - (y as f64).max(upper.1);
            let next = x + dxdy * height;
            let area = height * sign;
            let (low, high) = if x < next { (x, next) } else { (next, x) };
            let cell = low.max(0.0).floor();
            let (start, end) = (cell as usize, high.ceil() as usize);
            if end <= start + 1 {
                let middle = 0.5 * (x + next) - cell;
                acc[row + start] += area - area * middle;
                acc[row + start + 1] += area * middle;
            } else {
                let slope = 1.0 / (high - low);
                let head = low - cell;
                let first_share = 0.5 * slope * (1.0 - head) * (1.0 - head);
                let tail = high - high.ceil() + 1.0;
                let last_share = 0.5 * slope * tail * tail;
                acc[row + start] += area * first_share;
                if end == start + 2 {
                    acc[row + start + 1] += area * (1.0 - first_share - last_share);
                } else {
                    let second = slope * (1.5 - head);
                    acc[row + start + 1] += area * (second - first_share);
                    for value in &mut acc[row + start + 2..row + end - 1] {
                        *value += area * slope;
                    }
                    let before_last = second + (end - start - 3) as f64 * slope;
                    acc[row + end - 1] += area * (1.0 - before_last - last_share);
                }
                acc[row + end] += area * last_share;
            }
            x = next;
        }
    }
    let mut out = Vec::with_capacity(size * size);
    for y in 0..size {
        let mut run = 0.0;
        for cell in &acc[y * stride..y * stride + size] {
            run += cell;
            out.push(run.abs().min(1.0));
        }
    }
    out
}

/// A share 0..1 as an 8 bit level.
fn level(share: f64) -> i32 {
    (share * 255.0).round() as i32
}

/// The reference rasterizer itself: a rectangle with fractional sides covers each pixel by the
/// product of its overlaps, and a plate's coverage sums to its area.
#[test]
fn reference_rasterizer_is_exact() {
    let (left, top, right, bottom) = (1.25, 0.5, 3.75, 2.2);
    let rect = coverage(
        &[(left, top), (right, top), (right, bottom), (left, bottom)],
        5,
    );
    let overlap = |from: f64, to: f64, pixel: usize| {
        (to.min(pixel as f64 + 1.0) - from.max(pixel as f64)).max(0.0)
    };
    for y in 0..5 {
        for x in 0..5 {
            let expected = overlap(left, right, x) * overlap(top, bottom, y);
            assert!(
                (rect[y * 5 + x] - expected).abs() < 1e-12,
                "pixel {x},{y}: {} instead of {expected}",
                rect[y * 5 + x]
            );
        }
    }
    let outline = plate_outline(0.3, 0.7, 40.3, 40.7);
    let shoelace = outline
        .iter()
        .zip(outline.iter().cycle().skip(1))
        .map(|(from, to)| from.0 * to.1 - to.0 * from.1)
        .sum::<f64>()
        / 2.0;
    let sum: f64 = coverage(&outline, 42).iter().sum();
    assert!(
        (sum - shoelace.abs()).abs() < 1e-9,
        "coverage {sum} vs area {shoelace}"
    );
}

/// Every ICO stage is the plate filling its square with the workshop's circular corner: each
/// alpha within one level of the exact coverage, the four mirror images alike, nothing outside
/// the plate.
#[test]
fn ico_plate_is_exact() {
    let bytes = std::fs::read(repo("src-tauri/icons/icon.ico")).unwrap();
    for stage in read_ico(&bytes) {
        let size = stage.width as usize;
        let exact = coverage(
            &round_plate_outline(0.0, 0.0, size as f64, size as f64),
            size,
        );
        let alpha = |x: usize, y: usize| i32::from(stage.pixels[y * size + x][3]);
        for y in 0..size {
            for x in 0..size {
                let (value, share) = (alpha(x, y), exact[y * size + x]);
                assert!(
                    (value - level(share)).abs() <= 1,
                    "stage {size}: alpha {value} at {x},{y}, the exact plate has {}",
                    level(share)
                );
                if share < 1e-9 {
                    assert_eq!(value, 0, "stage {size}: spill at {x},{y} outside the plate");
                }
                let mirrors = [(size - 1 - x, y), (x, size - 1 - y), (y, x)];
                for (mirror_x, mirror_y) in mirrors {
                    let other = alpha(mirror_x, mirror_y);
                    assert!(
                        (value - other).abs() <= 1,
                        "stage {size}: not symmetric, {x},{y} has {value}, \
                         {mirror_x},{mirror_y} has {other}"
                    );
                }
            }
        }
    }
}

/// Apple's template shadow of macOS 11 to 15 on the 1024 grid, as iccir reverse-engineered it
/// from Apple's own templates (206 plate on 256: opacity 0.3, offset 3, `CIGaussianBlur`
/// radius 3): the plate in black at 30 %, 12 down, blurred with a standard deviation of 12.
const SHADOW_OPACITY: f64 = 0.3;
const SHADOW_OFFSET: f64 = 12.0;
const SHADOW_BLUR: f64 = 12.0;

/// The standard normal distribution function (Abramowitz and Stegun 7.1.26, error below 1e-6).
fn normal(z: f64) -> f64 {
    let x = z.abs() / std::f64::consts::SQRT_2;
    let t = 1.0 / (1.0 + 0.327_591_1 * x);
    let poly = t
        * (0.254_829_592
            + t * (-0.284_496_736
                + t * (1.421_413_741 + t * (-1.453_152_027 + t * 1.061_405_429))));
    let erf = 1.0 - poly * (-x * x).exp();
    if z >= 0.0 {
        0.5 * (1.0 + erf)
    } else {
        0.5 * (1.0 - erf)
    }
}

/// Every macOS entry is the same icon scaled: the plate on Apple's grid (its edges at 100 of
/// 1024, fractional below 1024) in the flat --brand, over Apple's template shadow, which falls
/// below the plate and stays inside the canvas.
#[test]
fn mac_entries_follow_apples_grid_and_shadow() {
    let plate = BRAND;
    let icns = std::fs::read(repo("src-tauri/icons/icon.icns")).unwrap();
    let mut seen = Vec::new();
    for (ostype, png) in icns_entries(&icns) {
        let size = png_size(png).0 as usize;
        if seen.contains(&size) {
            continue;
        }
        seen.push(size);
        let pixels = decode_png(png);
        let scale = size as f64 / 1024.0;
        let (near, far) = (100.0 * scale, size as f64 - 100.0 * scale);
        let exact = coverage(&plate_outline(near, near, far, far), size);
        let at = |x: usize, y: usize| pixels[y * size + x];

        // Where the plate covers less than a whole pixel, the premultiplied colour is its
        // coverage times the plate colour (the shadow is black): the edge sits at 100 of 1024.
        for (index, (pixel, share)) in pixels.iter().zip(&exact).enumerate() {
            if *share > 1.0 - 1e-9 {
                continue;
            }
            for channel in 0..3 {
                let premultiplied = f64::from(pixel[3]) * f64::from(pixel[channel]) / 255.0;
                let expected = share * f64::from(plate[channel]);
                assert!(
                    (premultiplied - expected).abs() <= 1.0,
                    "{ostype} {size}: pixel {},{} channel {channel} is {premultiplied:.2} \
                     premultiplied, the exact plate over a black shadow gives {expected:.2}",
                    index % size,
                    index / size
                );
            }
        }

        // The plate is the flat --brand.
        let mut counts = std::collections::HashMap::new();
        for pixel in pixels.iter().filter(|p| p[3] == 255) {
            *counts.entry([pixel[0], pixel[1], pixel[2]]).or_insert(0) += 1;
        }
        let main = counts.iter().max_by_key(|(_, n)| **n).map(|(c, _)| *c);
        assert_eq!(
            main,
            Some(plate),
            "{ostype} {size}: the plate is not --brand"
        );

        // Left and right mirror each other.
        for y in 0..size {
            for x in 0..size / 2 {
                let (left, right) = (at(x, y)[3], at(size - 1 - x, y)[3]);
                assert!(
                    left.abs_diff(right) <= 1,
                    "{ostype} {size}: {x},{y} has {left}, its mirror {right}"
                );
            }
        }

        // The shadow along the middle column outside the plate: the Gaussian profile of the
        // moved plate (Pillow's box-approximated blur stays within 3 levels of it).
        let (sigma, offset) = (SHADOW_BLUR * scale, SHADOW_OFFSET * scale);
        let middle = size / 2;
        let (mut above, mut below) = (0.0, 0.0);
        for y in 0..size {
            if exact[y * size + middle] > 1e-9 {
                continue;
            }
            let centre = y as f64 + 0.5;
            let expected = SHADOW_OPACITY
                * 255.0
                * (normal((centre - near - offset) / sigma)
                    - normal((centre - far - offset) / sigma));
            let alpha = f64::from(at(middle, y)[3]);
            assert!(
                (alpha - expected).abs() <= 3.0,
                "{ostype} {size}: shadow alpha {alpha} at row {y}, the template gives {expected:.1}"
            );
            if centre < near {
                above += alpha;
            } else {
                below += alpha;
            }
        }
        assert!(
            below > 0.0 && below > 3.0 * above,
            "{ostype} {size}: the shadow must fall below the plate ({below} below, {above} above)"
        );

        // Inside the canvas: the outermost 40 of 1024 on every side stay empty.
        let ring = (40.0 * scale) as usize;
        for y in 0..size {
            for x in 0..size {
                let outer = x.min(y).min(size - 1 - x).min(size - 1 - y) < ring;
                assert!(
                    !outer || at(x, y)[3] == 0,
                    "{ostype} {size}: the shadow reaches {x},{y}, near the edge of the canvas"
                );
            }
        }
    }
    assert_eq!(seen, [32, 64, 128, 256, 512, 1024]);
}
