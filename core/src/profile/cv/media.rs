//! The files that go to the worker: a PDF within the worker's limits as it is, and photos of
//! the pages without their metadata ([`strip`]: no GPS position, camera or time leaves the
//! computer). A photo goes as its own file when it is within the AI's size per photo and
//! pixels; otherwise, and when its EXIF turns it, it is re-encoded as an upright JPEG, which
//! carries no metadata either.

use std::io::Cursor;
use std::sync::LazyLock;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::metadata::Orientation;
use image::{DynamicImage, ImageDecoder, ImageReader, Limits};
use regex::bytes::Regex;

use super::{CvError, CvFile, Format, MAX_PDF_BYTES, MAX_PDF_PAGES, strip};

/// The AI takes at most 5 MB per photo in base64: 3.75 MB of bytes.
pub(super) const MAX_PHOTO_BYTES: usize = 3_750_000;
/// The longest side the AI takes; a downscaled photo gets [`TARGET_SIDE`].
const MAX_SIDE: u32 = 8_000;
const TARGET_SIDE: u32 = 2_400;
/// Decoding a photo may allocate at most this much.
const MAX_DECODE_ALLOC: u64 = 512 * 1024 * 1024;

/// A page object of a PDF, where the page tree is not compressed.
static PAGE: LazyLock<Regex> =
    LazyLock::new(|| Regex::new(r"/Type\s*/Page(?:[^A-Za-z]|$)").expect("valid regex"));

pub(super) fn pdf(bytes: &[u8]) -> Result<CvFile, CvError> {
    if bytes.len() > MAX_PDF_BYTES {
        return Err(CvError::TooLarge);
    }
    if pages(bytes) > MAX_PDF_PAGES {
        return Err(CvError::TooLarge);
    }
    Ok(CvFile {
        mime: "application/pdf",
        bytes: bytes.to_vec(),
    })
}

/// The page objects that can be seen (0 when they sit in compressed object streams: then the
/// size alone decides).
pub(super) fn pages(bytes: &[u8]) -> usize {
    PAGE.find_iter(bytes).count()
}

pub(super) fn photo(bytes: &[u8], format: Format) -> Result<CvFile, CvError> {
    let mime = match format {
        Format::Jpeg => "image/jpeg",
        Format::Png => "image/png",
        Format::Webp => "image/webp",
        _ => return Err(CvError::Unsupported),
    };
    let (longest, upright) = {
        let mut decoder = ImageReader::new(Cursor::new(bytes))
            .with_guessed_format()
            .map_err(|_| CvError::Unreadable)?
            .into_decoder()
            .map_err(|_| CvError::Unreadable)?;
        let (width, height) = decoder.dimensions();
        // A broken EXIF block turns nothing: it goes with the rest of the metadata.
        let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
        (width.max(height), orientation == Orientation::NoTransforms)
    };
    if bytes.len() > MAX_PHOTO_BYTES || longest > MAX_SIDE {
        return encode(bytes, TARGET_SIDE);
    }
    if upright && let Some(bytes) = strip::metadata(bytes, format) {
        return Ok(CvFile { mime, bytes });
    }
    // Turned by its EXIF, or a structure the stripper does not follow: re-encoded at its size.
    encode(bytes, longest)
}

/// The photo as a JPEG with its longest side at most `side`, upright as its EXIF says and
/// without any metadata; smaller once when it is above [`MAX_PHOTO_BYTES`], then
/// [`CvError::TooLarge`].
fn encode(bytes: &[u8], side: u32) -> Result<CvFile, CvError> {
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| CvError::Unreadable)?
        .into_decoder()
        .map_err(|_| CvError::Unreadable)?;
    decoder.set_limits(limits).map_err(|_| CvError::TooLarge)?;
    let orientation = decoder.orientation().unwrap_or(Orientation::NoTransforms);
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| CvError::Unreadable)?;
    image.apply_orientation(orientation);
    let mut side = side;
    for quality in [85, 70] {
        let small = if image.width().max(image.height()) > side {
            image.resize(side, side, FilterType::Triangle)
        } else {
            image.clone()
        };
        let mut out = Vec::new();
        JpegEncoder::new_with_quality(&mut out, quality)
            .encode_image(&small.to_rgb8())
            .map_err(|_| CvError::Unreadable)?;
        if out.len() <= MAX_PHOTO_BYTES {
            return Ok(CvFile {
                mime: "image/jpeg",
                bytes: out,
            });
        }
        side = side * 2 / 3;
    }
    Err(CvError::TooLarge)
}
