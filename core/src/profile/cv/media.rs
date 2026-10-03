//! The files that go to the worker as they are: a PDF within the worker's limits, and photos
//! of the pages, downscaled to a JPEG when they are above the AI's size per photo or larger
//! than it takes in pixels.

use std::io::Cursor;
use std::sync::LazyLock;

use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader, Limits};
use regex::bytes::Regex;

use super::{CvError, CvFile, Format, MAX_PDF_BYTES, MAX_PDF_PAGES};

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

pub(super) fn photo(bytes: Vec<u8>, format: Format) -> Result<CvFile, CvError> {
    let mime = match format {
        Format::Jpeg => "image/jpeg",
        Format::Png => "image/png",
        Format::Webp => "image/webp",
        _ => return Err(CvError::Unsupported),
    };
    let (width, height) = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .map_err(|_| CvError::Unreadable)?
        .into_dimensions()
        .map_err(|_| CvError::Unreadable)?;
    if bytes.len() <= MAX_PHOTO_BYTES && width.max(height) <= MAX_SIDE {
        return Ok(CvFile { mime, bytes });
    }
    downscale(&bytes)
}

/// The photo as a JPEG with its longest side at most [`TARGET_SIDE`], upright as its EXIF
/// says; [`CvError::TooLarge`] when even that is above [`MAX_PHOTO_BYTES`].
fn downscale(bytes: &[u8]) -> Result<CvFile, CvError> {
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_DECODE_ALLOC);
    let mut decoder = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| CvError::Unreadable)?
        .into_decoder()
        .map_err(|_| CvError::Unreadable)?;
    decoder.set_limits(limits).map_err(|_| CvError::TooLarge)?;
    let orientation = decoder.orientation().map_err(|_| CvError::Unreadable)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|_| CvError::Unreadable)?;
    image.apply_orientation(orientation);
    let mut side = TARGET_SIDE;
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
