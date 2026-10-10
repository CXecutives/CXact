//! Reading a CV for the AI import ("Aus Lebenslauf ausfüllen"): the chosen file becomes either
//! text, read here and redacted before it leaves the computer, or files the worker sends as
//! they are (a PDF, or up to five photos of the pages). The client of the worker is
//! [`crate::ai`].
//!
//! - DOCX, DOCM, DOTX and ODT: the zip's main XML, text with tables and text boxes, without
//!   headers and footers ([`office`]).
//! - DOC (Word 97-2003): the text of the `WordDocument` stream through its piece table
//!   ([`doc`]).
//! - RTF: a stripper that skips pictures, objects and the other destinations ([`rtf`]).
//! - TXT, MD as they are, HTML through [`crate::text`].
//! - PDF, JPG, PNG, WEBP: files; photos lose their metadata ([`strip`]), photos above the AI's
//!   size or turned by their EXIF are re-encoded ([`media`]).
//! - Everything else (.pages, .heic, unknown): [`CvError::Unsupported`].
//!
//! The kind comes from the content where it shows (zip, compound file, RTF, PDF, the photo
//! formats), from the extension only for plain text. Reading never panics outward
//! ([`std::panic::catch_unwind`]); a reader that cannot make sense of a file answers
//! [`CvError::Unreadable`]. It is blocking work: the caller runs it in `spawn_blocking` with a
//! time limit. Logs name codes, formats and sizes only, never a name, a path or the text.

mod doc;
mod media;
mod office;
mod redact;
mod rtf;
mod strip;

use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub use redact::redact;

/// The file endings the file dialog offers (what [`read`] reads; a photo may come as
/// several pages).
pub const EXTENSIONS: [&str; 15] = [
    "pdf", "docx", "docm", "dotx", "doc", "odt", "rtf", "txt", "md", "html", "htm", "jpg", "jpeg",
    "png", "webp",
];

/// At most this many characters of text go to the worker (its own limit).
pub const MAX_TEXT: usize = 100_000;
/// At most this many photos of the pages.
pub const MAX_PHOTOS: usize = 5;
/// A PDF up to 10 MB and, where its pages can be counted, up to 15 pages (the worker's limits).
pub const MAX_PDF_BYTES: usize = 10 * 1024 * 1024;
pub const MAX_PDF_PAGES: usize = 15;
/// A document file larger than this is no CV.
const MAX_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;
/// A photo larger than this is not even read (it is downscaled when it is above
/// [`media::MAX_PHOTO_BYTES`]).
const MAX_PHOTO_FILE_BYTES: u64 = 40 * 1024 * 1024;
/// Text with fewer letters and digits than this is no readable CV (a scan inside a DOCX).
const MIN_TEXT: usize = 40;

/// Why a CV could not be filled in: a code with data, never a sentence (the UI words it). The
/// first three come from reading the file, the rest from the worker and the network.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, thiserror::Error)]
#[serde(tag = "code", content = "params", rename_all = "camelCase")]
pub enum CvError {
    #[error("the CV file cannot be read")]
    Unreadable,
    #[error("the CV is too large")]
    TooLarge,
    #[error("the CV format is not supported")]
    Unsupported,
    /// The daily or monthly tries are used up; `until`: the first day ('YYYY-MM-DD', UTC)
    /// that works again.
    #[error("the AI tries are used up until {until}")]
    Limit { until: String },
    /// The worker is switched off (its emergency switch).
    #[error("the AI import is paused")]
    Paused,
    /// The worker no longer takes this app's requests: an update is needed.
    #[error("this build is outdated for the AI import")]
    Outdated,
    /// The AI cut its answer short or refused it: never half a profile.
    #[error("the AI gave no usable answer")]
    Refused,
    /// The worker or the AI behind it failed.
    #[error("the AI import is unavailable")]
    Unavailable,
    #[error("no connection to the AI import")]
    Offline,
    #[error("the AI import took too long")]
    Timeout,
    #[error("cancelled")]
    Cancelled,
}

/// The format of the chosen file, for the log and the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Format {
    Docx,
    Odt,
    Doc,
    Rtf,
    Txt,
    Markdown,
    Html,
    Pdf,
    Jpeg,
    Png,
    Webp,
}

/// What goes to the worker.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CvInput {
    /// The text, read and redacted here.
    Text(String),
    /// One PDF, or up to five photos of the pages, as they are (photos downscaled).
    Files(Vec<CvFile>),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CvFile {
    pub mime: &'static str,
    pub bytes: Vec<u8>,
}

/// A CV read and ready to send.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cv {
    pub input: CvInput,
    pub format: Format,
}

impl Cv {
    /// Characters of the text or bytes of the files (for the log).
    pub fn size(&self) -> usize {
        match &self.input {
            CvInput::Text(text) => text.chars().count(),
            CvInput::Files(files) => files.iter().map(|f| f.bytes.len()).sum(),
        }
    }
}

/// Reads the chosen files: one document, or up to five photos of the pages.
pub fn read(paths: &[PathBuf]) -> Result<Cv, CvError> {
    let mut files = Vec::with_capacity(paths.len());
    for path in paths {
        let name = file_name(path);
        let cap = if is_photo_name(&name) {
            MAX_PHOTO_FILE_BYTES
        } else {
            MAX_DOCUMENT_BYTES
        };
        let len = std::fs::metadata(path)
            .map_err(|_| CvError::Unreadable)?
            .len();
        if len > cap {
            return Err(CvError::TooLarge);
        }
        let bytes = std::fs::read(path).map_err(|_| CvError::Unreadable)?;
        files.push((name, bytes));
    }
    from_files(files)
}

/// Like [`read`], for files already in memory: (file name, content). Only the extension of
/// the name is looked at.
pub fn from_files(files: Vec<(String, Vec<u8>)>) -> Result<Cv, CvError> {
    catch_unwind(AssertUnwindSafe(|| read_all(files))).unwrap_or_else(|_| {
        log::warn!("cv: a reader panicked");
        Err(CvError::Unreadable)
    })
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_default()
}

fn extension(name: &str) -> String {
    Path::new(name)
        .extension()
        .map(|e| e.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default()
}

fn is_photo_name(name: &str) -> bool {
    matches!(
        extension(name).as_str(),
        "jpg" | "jpeg" | "png" | "webp" | "heic" | "heif"
    )
}

/// What a file is, from its content first.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Kind {
    Zip,
    Compound,
    Rtf,
    Pdf,
    Photo(Format),
    Text(Format),
    Unsupported,
}

fn kind(name: &str, bytes: &[u8]) -> Kind {
    let at = |offset: usize, magic: &[u8]| bytes.get(offset..offset + magic.len()) == Some(magic);
    if at(0, b"PK\x03\x04") {
        return Kind::Zip;
    }
    if at(0, b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1") {
        return Kind::Compound;
    }
    if at(0, b"{\\rtf") {
        return Kind::Rtf;
    }
    if at(0, b"%PDF") {
        return Kind::Pdf;
    }
    if at(0, b"\xFF\xD8\xFF") {
        return Kind::Photo(Format::Jpeg);
    }
    if at(0, b"\x89PNG\r\n\x1A\n") {
        return Kind::Photo(Format::Png);
    }
    if at(0, b"RIFF") && at(8, b"WEBP") {
        return Kind::Photo(Format::Webp);
    }
    // HEIC/HEIF and other ISO media files: no reader here.
    if at(4, b"ftyp") {
        return Kind::Unsupported;
    }
    match extension(name).as_str() {
        "txt" | "text" => Kind::Text(Format::Txt),
        "md" | "markdown" => Kind::Text(Format::Markdown),
        "html" | "htm" | "xhtml" => Kind::Text(Format::Html),
        // Word saves a web page as .doc too.
        "doc" if looks_like_html(bytes) => Kind::Text(Format::Html),
        _ => Kind::Unsupported,
    }
}

fn looks_like_html(bytes: &[u8]) -> bool {
    let head = &bytes[..bytes.len().min(1024)];
    let head = String::from_utf8_lossy(head).to_ascii_lowercase();
    head.trim_start_matches('\u{feff}')
        .trim_start()
        .starts_with('<')
        && head.contains("<html")
}

fn read_all(files: Vec<(String, Vec<u8>)>) -> Result<Cv, CvError> {
    let kinds: Vec<Kind> = files.iter().map(|(n, b)| kind(n, b)).collect();
    if kinds.is_empty() || kinds.contains(&Kind::Unsupported) {
        return Err(CvError::Unsupported);
    }
    let photos: Vec<Format> = kinds
        .iter()
        .filter_map(|kind| match kind {
            Kind::Photo(format) => Some(*format),
            _ => None,
        })
        .collect();
    if photos.len() == kinds.len() {
        if photos.len() > MAX_PHOTOS {
            return Err(CvError::TooLarge);
        }
        let files = files
            .into_iter()
            .zip(&photos)
            .map(|((_, bytes), format)| media::photo(&bytes, *format))
            .collect::<Result<Vec<_>, _>>()?;
        return Ok(Cv {
            input: CvInput::Files(files),
            format: photos[0],
        });
    }
    // Otherwise one document alone.
    let ([(_, bytes)], [kind]) = (files.as_slice(), kinds.as_slice()) else {
        return Err(CvError::Unsupported);
    };
    let (format, raw) = match *kind {
        Kind::Pdf => {
            return Ok(Cv {
                input: CvInput::Files(vec![media::pdf(bytes)?]),
                format: Format::Pdf,
            });
        }
        Kind::Zip => office::text(bytes)?,
        Kind::Compound => (Format::Doc, doc::text(bytes)?),
        Kind::Rtf => (Format::Rtf, rtf::text(bytes)),
        Kind::Text(Format::Html) => (Format::Html, crate::text::html_to_text(&decode(bytes))),
        Kind::Text(format) => (format, decode(bytes)),
        // A lone photo went above, unsupported kinds were refused first.
        Kind::Photo(_) | Kind::Unsupported => return Err(CvError::Unsupported),
    };
    Ok(Cv {
        input: CvInput::Text(finish(&raw)?),
        format,
    })
}

/// The text as it goes out: smoothed, redacted, long enough to be a CV, short enough for
/// the worker.
fn finish(raw: &str) -> Result<String, CvError> {
    let text = redact(&crate::text::normalize(raw));
    if text.chars().filter(|c| c.is_alphanumeric()).count() < MIN_TEXT {
        return Err(CvError::Unreadable);
    }
    if text.chars().count() > MAX_TEXT {
        return Err(CvError::TooLarge);
    }
    Ok(text)
}

/// Plain text in UTF-8 (with or without BOM) or UTF-16 with BOM; anything else is read as
/// Windows-1252 (`normalize` maps its C1 range).
fn decode(bytes: &[u8]) -> String {
    if let Some(rest) = bytes.strip_prefix(b"\xEF\xBB\xBF") {
        return String::from_utf8_lossy(rest).into_owned();
    }
    let utf16 = |rest: &[u8], unit: fn([u8; 2]) -> u16| {
        let units = rest.chunks_exact(2).map(|c| unit([c[0], c[1]]));
        char::decode_utf16(units)
            .map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER))
            .collect()
    };
    if let Some(rest) = bytes.strip_prefix(b"\xFF\xFE") {
        return utf16(rest, u16::from_le_bytes);
    }
    if let Some(rest) = bytes.strip_prefix(b"\xFE\xFF") {
        return utf16(rest, u16::from_be_bytes);
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => text.to_owned(),
        Err(_) => bytes.iter().map(|&b| char::from(b)).collect(),
    }
}
