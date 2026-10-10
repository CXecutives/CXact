//! A photo's metadata removed before it leaves the computer, without touching its pixels:
//! EXIF (with GPS position, camera and time), XMP, IPTC, comments, text chunks and whatever
//! follows the picture's end. What a decoder needs stays: the image data, the colour profile
//! (ICC), Adobe's colour transform and the JFIF density (without its thumbnail). A file whose
//! structure this does not follow gives `None`, and the caller re-encodes it.

use super::Format;

/// The photo without its metadata; `None` when its structure is not followed here.
pub(super) fn metadata(bytes: &[u8], format: Format) -> Option<Vec<u8>> {
    match format {
        Format::Jpeg => jpeg(bytes),
        Format::Png => png(bytes),
        Format::Webp => webp(bytes),
        _ => None,
    }
}

const SOI: [u8; 2] = [0xFF, 0xD8];
const EOI: [u8; 2] = [0xFF, 0xD9];
const SOS: u8 = 0xDA;
const APP0: u8 = 0xE0;
const APP2: u8 = 0xE2;
const APP14: u8 = 0xEE;
const COM: u8 = 0xFE;

/// The JPEG's segments up to its end marker, the metadata segments left out.
fn jpeg(bytes: &[u8]) -> Option<Vec<u8>> {
    if !bytes.starts_with(&SOI) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(&SOI);
    let mut at = SOI.len();
    loop {
        if *bytes.get(at)? != 0xFF {
            return None;
        }
        // Fill bytes before a marker.
        while *bytes.get(at + 1)? == 0xFF {
            at += 1;
        }
        let marker = bytes[at + 1];
        match marker {
            // The end: a trailer or further pictures after it (MPF) stay behind.
            0xD9 => {
                out.extend_from_slice(&EOI);
                return Some(out);
            }
            // Markers without a length.
            0x01 | 0xD0..=0xD7 => {
                out.extend_from_slice(&[0xFF, marker]);
                at += 2;
                continue;
            }
            _ => {}
        }
        let len = usize::from(u16::from_be_bytes([
            *bytes.get(at + 2)?,
            *bytes.get(at + 3)?,
        ]));
        if len < 2 {
            return None;
        }
        let end = at + 2 + len;
        let segment = bytes.get(at..end)?;
        keep_segment(marker, &segment[4..], &mut out);
        at = end;
        if marker == SOS {
            // The entropy-coded data runs to the next marker that is neither a stuffed byte
            // nor a restart marker.
            let mut next = at;
            loop {
                match (bytes.get(next), bytes.get(next + 1)) {
                    (None, _) | (Some(0xFF), None) => {
                        // Cut short: the data as far as it goes, then the end.
                        out.extend_from_slice(&bytes[at..next]);
                        out.extend_from_slice(&EOI);
                        return Some(out);
                    }
                    (Some(0xFF), Some(0x00 | 0xD0..=0xD7)) => next += 2,
                    (Some(0xFF), Some(0xFF)) => next += 1,
                    (Some(0xFF), Some(_)) => break,
                    (Some(_), _) => next += 1,
                }
            }
            out.extend_from_slice(&bytes[at..next]);
            at = next;
        }
    }
}

/// Writes the segment when a decoder needs it: everything but the application segments and
/// comments, of those only the ICC profile, Adobe's colour transform and JFIF's density.
fn keep_segment(marker: u8, payload: &[u8], out: &mut Vec<u8>) {
    let keep = match marker {
        APP0 => {
            // JFIF without its thumbnail: version, units and density, then a 0 x 0 thumbnail.
            if payload.starts_with(b"JFIF\0") && payload.len() >= 14 {
                out.extend_from_slice(&[0xFF, APP0, 0, 16]);
                out.extend_from_slice(&payload[..12]);
                out.extend_from_slice(&[0, 0]);
            }
            false
        }
        APP2 => payload.starts_with(b"ICC_PROFILE\0"),
        APP14 => payload.starts_with(b"Adobe"),
        0xE1..=0xEF | COM => false,
        _ => true,
    };
    if keep {
        let len = u16::try_from(payload.len() + 2).expect("a segment's length fits its field");
        out.extend_from_slice(&[0xFF, marker]);
        out.extend_from_slice(&len.to_be_bytes());
        out.extend_from_slice(payload);
    }
}

const PNG_SIGNATURE: &[u8; 8] = b"\x89PNG\r\n\x1a\n";
/// The chunks a PNG keeps: the image and how its colours read. Text (`tEXt`, `zTXt`,
/// `iTXt` with XMP), `eXIf`, `tIME`, animation and private chunks go.
const PNG_KEPT: [&[u8; 4]; 15] = [
    b"IHDR", b"PLTE", b"IDAT", b"IEND", b"tRNS", b"cHRM", b"gAMA", b"iCCP", b"sBIT", b"sRGB",
    b"cICP", b"mDCV", b"cLLI", b"bKGD", b"pHYs",
];
/// An empty `IEND` chunk with its checksum.
const PNG_IEND: [u8; 12] = [0, 0, 0, 0, b'I', b'E', b'N', b'D', 0xAE, 0x42, 0x60, 0x82];

fn png(bytes: &[u8]) -> Option<Vec<u8>> {
    if !bytes.starts_with(PNG_SIGNATURE) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(PNG_SIGNATURE);
    let mut at = PNG_SIGNATURE.len();
    while at < bytes.len() {
        let len = u32::from_be_bytes(bytes.get(at..at + 4)?.try_into().ok()?);
        let kind: &[u8; 4] = bytes.get(at + 4..at + 8)?.try_into().ok()?;
        let end = (at + 12).checked_add(usize::try_from(len).ok()?)?;
        let chunk = bytes.get(at..end)?;
        if PNG_KEPT.contains(&kind) {
            out.extend_from_slice(chunk);
        }
        at = end;
        if kind == b"IEND" {
            return Some(out);
        }
    }
    // No end chunk: the chunks as far as they go, then the end.
    out.extend_from_slice(&PNG_IEND);
    Some(out)
}

/// The chunks a WebP keeps: the image, its alpha, animation and colour profile. `EXIF`,
/// `XMP ` and unknown chunks go.
const WEBP_KEPT: [&[u8; 4]; 7] = [
    b"VP8 ", b"VP8L", b"VP8X", b"ALPH", b"ANIM", b"ANMF", b"ICCP",
];
/// The flags of `VP8X` that announce EXIF and XMP.
const VP8X_EXIF: u8 = 0x08;
const VP8X_XMP: u8 = 0x04;

fn webp(bytes: &[u8]) -> Option<Vec<u8>> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WEBP" {
        return None;
    }
    let riff = usize::try_from(u32::from_le_bytes(bytes[4..8].try_into().ok()?)).ok()?;
    let end_of_riff = riff.saturating_add(8).min(bytes.len());
    let mut out = Vec::with_capacity(bytes.len());
    out.extend_from_slice(b"RIFF\0\0\0\0WEBP");
    let mut at = 12;
    while at + 8 <= end_of_riff {
        let kind: &[u8; 4] = bytes[at..at + 4].try_into().ok()?;
        let size =
            usize::try_from(u32::from_le_bytes(bytes[at + 4..at + 8].try_into().ok()?)).ok()?;
        let data_end = (at + 8).checked_add(size)?;
        let data = bytes.get(at + 8..data_end)?;
        if WEBP_KEPT.contains(&kind) {
            let start = out.len();
            out.extend_from_slice(&bytes[at..at + 8]);
            out.extend_from_slice(data);
            if kind == b"VP8X" {
                *out.get_mut(start + 8)? &= !(VP8X_EXIF | VP8X_XMP);
            }
            if size % 2 == 1 {
                out.push(0);
            }
        }
        at = data_end + size % 2;
    }
    let riff = u32::try_from(out.len() - 8).ok()?;
    out[4..8].copy_from_slice(&riff.to_le_bytes());
    Some(out)
}

#[cfg(test)]
mod tests {
    use std::io::Cursor;

    use image::{ImageDecoder, ImageReader, RgbImage};

    use super::*;

    const SECRET: &[u8] = b"CXactSecretCamera";

    fn page() -> RgbImage {
        RgbImage::from_fn(40, 30, |x, y| {
            let channel = |v: u32| u8::try_from(v).unwrap();
            image::Rgb([channel(x * 6), channel(y * 8), 90])
        })
    }

    fn crc32(bytes: &[u8]) -> u32 {
        let mut crc = !0u32;
        for &byte in bytes {
            crc ^= u32::from(byte);
            for _ in 0..8 {
                crc = if crc & 1 == 1 {
                    (crc >> 1) ^ 0xEDB8_8320
                } else {
                    crc >> 1
                };
            }
        }
        !crc
    }

    fn png_chunk(kind: [u8; 4], data: &[u8]) -> Vec<u8> {
        let mut chunk = u32::try_from(data.len()).unwrap().to_be_bytes().to_vec();
        chunk.extend_from_slice(&kind);
        chunk.extend_from_slice(data);
        let crc = crc32(&chunk[4..]);
        chunk.extend_from_slice(&crc.to_be_bytes());
        chunk
    }

    fn pixels(bytes: &[u8]) -> Vec<u8> {
        image::load_from_memory(bytes).unwrap().to_rgb8().into_raw()
    }

    fn decoder(bytes: &[u8]) -> Box<dyn ImageDecoder + '_> {
        Box::new(
            ImageReader::new(Cursor::new(bytes))
                .with_guessed_format()
                .unwrap()
                .into_decoder()
                .unwrap(),
        )
    }

    fn contains(haystack: &[u8], needle: &[u8]) -> bool {
        haystack.windows(needle.len()).any(|w| w == needle)
    }

    #[test]
    fn a_png_loses_its_text_and_exif_chunks_and_keeps_its_pixels() {
        let mut plain = Vec::new();
        page()
            .write_to(&mut Cursor::new(&mut plain), image::ImageFormat::Png)
            .unwrap();
        // eXIf, tEXt and an XMP iTXt right after IHDR (8 + 25 bytes).
        let mut tagged = plain[..33].to_vec();
        tagged.extend(png_chunk(
            *b"eXIf",
            &[b"MM\0*\0\0\0\x08".as_slice(), SECRET].concat(),
        ));
        tagged.extend(png_chunk(
            *b"tEXt",
            &[b"Author\0".as_slice(), SECRET].concat(),
        ));
        tagged.extend(png_chunk(
            *b"iTXt",
            &[b"XML:com.adobe.xmp\0\0\0\0\0".as_slice(), SECRET].concat(),
        ));
        tagged.extend_from_slice(&plain[33..]);
        tagged.extend_from_slice(SECRET);
        assert!(decoder(&tagged).exif_metadata().unwrap().is_some());

        let clean = metadata(&tagged, Format::Png).unwrap();
        assert!(!contains(&clean, SECRET));
        assert_eq!(clean, plain);
        assert_eq!(pixels(&clean), page().into_raw());
    }

    #[test]
    fn a_webp_loses_its_exif_and_xmp_chunks_and_flags() {
        let mut lossless = Vec::new();
        page()
            .write_to(&mut Cursor::new(&mut lossless), image::ImageFormat::WebP)
            .unwrap();
        let picture = &lossless[12..];
        assert_eq!(&picture[..4], b"VP8L");
        let chunk = |kind: &[u8; 4], data: &[u8]| {
            let mut c = kind.to_vec();
            c.extend_from_slice(&u32::try_from(data.len()).unwrap().to_le_bytes());
            c.extend_from_slice(data);
            if data.len() % 2 == 1 {
                c.push(0);
            }
            c
        };
        // VP8X: EXIF and XMP announced, canvas 40 x 30 (minus one, 24 bit each).
        let extended = [VP8X_EXIF | VP8X_XMP, 0, 0, 0, 39, 0, 0, 29, 0, 0];
        let mut body = b"WEBP".to_vec();
        body.extend(chunk(b"VP8X", &extended));
        body.extend_from_slice(picture);
        body.extend(chunk(
            b"EXIF",
            &[b"MM\0*\0\0\0\x08".as_slice(), SECRET].concat(),
        ));
        body.extend(chunk(b"XMP ", SECRET));
        let mut tagged = b"RIFF".to_vec();
        tagged.extend_from_slice(&u32::try_from(body.len()).unwrap().to_le_bytes());
        tagged.extend(body);
        assert!(decoder(&tagged).exif_metadata().unwrap().is_some());

        let clean = metadata(&tagged, Format::Webp).unwrap();
        assert!(!contains(&clean, SECRET));
        assert!(!contains(&clean, b"EXIF") && !contains(&clean, b"XMP "));
        assert_eq!(clean[20] & (VP8X_EXIF | VP8X_XMP), 0, "the flags say none");
        let riff = usize::try_from(u32::from_le_bytes(clean[4..8].try_into().unwrap())).unwrap();
        assert_eq!(riff, clean.len() - 8);
        assert!(decoder(&clean).exif_metadata().unwrap().is_none());
        assert_eq!(pixels(&clean), page().into_raw());
    }

    #[test]
    fn a_jpeg_keeps_its_scans_and_drops_what_follows_its_end() {
        let mut plain = Vec::new();
        image::codecs::jpeg::JpegEncoder::new_with_quality(&mut plain, 90)
            .encode_image(&page())
            .unwrap();
        let mut tagged = plain.clone();
        // A comment before the frame, a second picture after the end (as MPF does).
        tagged.splice(2..2, [&[0xFF, COM, 0, 19][..], SECRET].concat());
        tagged.extend_from_slice(&[0xFF, 0xD8, 0xFF, 0xE1, 0, 4, 0, 0, 0xFF, 0xD9]);
        tagged.extend_from_slice(SECRET);
        let clean = metadata(&tagged, Format::Jpeg).unwrap();
        assert!(!contains(&clean, SECRET));
        assert!(clean.ends_with(&EOI) && clean.len() < tagged.len());
        assert_eq!(pixels(&clean), pixels(&plain));
        assert_eq!(metadata(b"\xFF\xD8\x00broken", Format::Jpeg), None);
    }
}
