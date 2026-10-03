//! Word 97-2003 (`.doc`, [MS-DOC]): the text of the `WordDocument` stream, found through the
//! piece table (the `Clx` in the table stream). The main document and its text boxes count;
//! footnotes, headers and comments are skipped, and so are field instructions (only a field's
//! result is text). Good enough for the plain text of a CV, no formatting.

use std::io::{Cursor, Read};

use super::CvError;

/// A stream larger than this is no CV.
const MAX_STREAM: u64 = 64 * 1024 * 1024;
/// `wIdent` of a Word binary document.
const WORD_IDENT: u16 = 0xA5EC;
/// `nFib` of Word 97; older formats (Word 6, Word 95) lay the file out differently.
const NFIB_WORD97: u16 = 0x00C1;
const ENCRYPTED: u16 = 0x0100;
const TABLE_ONE: u16 = 0x0200;
/// The pair `fcClx`/`lcbClx` in `FibRgFcLcb97`.
const CLX_PAIR: usize = 33;

pub(super) fn text(bytes: &[u8]) -> Result<String, CvError> {
    let mut file = cfb::CompoundFile::open(Cursor::new(bytes)).map_err(|_| CvError::Unreadable)?;
    // A password-protected DOCX is a compound file with its package encrypted inside.
    if file.is_stream("/EncryptedPackage") {
        return Err(CvError::Unreadable);
    }
    if !file.is_stream("/WordDocument") {
        return Err(CvError::Unsupported);
    }
    let word = stream(&mut file, "/WordDocument")?;
    let fib = Fib::read(&word)?;
    let table = stream(&mut file, if fib.table_one { "/1Table" } else { "/0Table" })?;
    let clx = table
        .get(fib.clx.0..fib.clx.0 + fib.clx.1)
        .ok_or(CvError::Unreadable)?;
    let pieces = pieces(clx)?;
    let mut out = String::new();
    read_range(&word, &pieces, 0, fib.ccp_text, &mut out);
    if fib.ccp_txbx > 0 {
        out.push('\r');
        read_range(
            &word,
            &pieces,
            fib.txbx_start,
            fib.txbx_start + fib.ccp_txbx,
            &mut out,
        );
    }
    Ok(clean(&out))
}

fn stream<F: Read + std::io::Seek>(
    file: &mut cfb::CompoundFile<F>,
    path: &str,
) -> Result<Vec<u8>, CvError> {
    let stream = file.open_stream(path).map_err(|_| CvError::Unreadable)?;
    if stream.len() > MAX_STREAM {
        return Err(CvError::TooLarge);
    }
    let mut bytes = Vec::new();
    stream
        .take(MAX_STREAM)
        .read_to_end(&mut bytes)
        .map_err(|_| CvError::Unreadable)?;
    Ok(bytes)
}

/// What the File Information Block says about the text.
struct Fib {
    table_one: bool,
    /// Offset and length of the `Clx` in the table stream.
    clx: (usize, usize),
    ccp_text: u32,
    ccp_txbx: u32,
    /// First character of the text boxes: after the main text, footnotes, headers, macros,
    /// comments and endnotes.
    txbx_start: u32,
}

impl Fib {
    fn read(word: &[u8]) -> Result<Fib, CvError> {
        let u16_at = |at: usize| -> Result<u16, CvError> {
            word.get(at..at + 2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .ok_or(CvError::Unreadable)
        };
        let u32_at = |at: usize| -> Result<u32, CvError> {
            word.get(at..at + 4)
                .map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .ok_or(CvError::Unreadable)
        };
        if u16_at(0)? != WORD_IDENT {
            return Err(CvError::Unreadable);
        }
        if u16_at(2)? < NFIB_WORD97 {
            return Err(CvError::Unsupported);
        }
        let flags = u16_at(0x0A)?;
        if flags & ENCRYPTED != 0 {
            return Err(CvError::Unreadable);
        }
        // FibBase (32 bytes), then the count of 16-bit values and FibRgW, the count of 32-bit
        // values and FibRgLw, the count of pairs and FibRgFcLcb.
        let words = usize::from(u16_at(32)?);
        let longs_at = 34 + words * 2;
        let longs = usize::from(u16_at(longs_at)?);
        let lw = longs_at + 2;
        let pairs_at = lw + longs * 4;
        let pairs = usize::from(u16_at(pairs_at)?);
        if longs < 10 || pairs <= CLX_PAIR {
            return Err(CvError::Unreadable);
        }
        // Character counts in FibRgLw: 3 the main text, 4 to 8 footnotes, headers, macros,
        // comments and endnotes, 9 the text boxes.
        let count = |index: usize| u32_at(lw + index * 4);
        let txbx_start = (3..=8).try_fold(0u32, |sum, index| {
            sum.checked_add(count(index)?).ok_or(CvError::Unreadable)
        })?;
        let clx_at = pairs_at + 2 + CLX_PAIR * 8;
        Ok(Fib {
            table_one: flags & TABLE_ONE != 0,
            clx: (u32_at(clx_at)? as usize, u32_at(clx_at + 4)? as usize),
            ccp_text: count(3)?,
            ccp_txbx: count(9)?,
            txbx_start,
        })
    }
}

/// One piece of text: characters `start..end` lie at `offset` in the `WordDocument` stream,
/// one byte each (Windows-1252) or two (UTF-16).
struct Piece {
    start: u32,
    end: u32,
    offset: usize,
    compressed: bool,
}

/// The pieces of the `Clx`: property runs (`Prc`, skipped), then the piece table (`Pcdt`).
fn pieces(clx: &[u8]) -> Result<Vec<Piece>, CvError> {
    let mut at = 0;
    while let Some(&kind) = clx.get(at) {
        match kind {
            1 => {
                let size = clx.get(at + 1..at + 3).ok_or(CvError::Unreadable)?;
                at += 3 + usize::from(u16::from_le_bytes([size[0], size[1]]));
            }
            2 => {
                let size = clx.get(at + 1..at + 5).ok_or(CvError::Unreadable)?;
                let size = u32::from_le_bytes([size[0], size[1], size[2], size[3]]) as usize;
                let plc = clx.get(at + 5..at + 5 + size).ok_or(CvError::Unreadable)?;
                return piece_table(plc);
            }
            _ => return Err(CvError::Unreadable),
        }
    }
    Err(CvError::Unreadable)
}

/// `PlcPcd`: n + 1 character positions, then n piece descriptors of 8 bytes.
fn piece_table(plc: &[u8]) -> Result<Vec<Piece>, CvError> {
    if plc.len() < 4 || !(plc.len() - 4).is_multiple_of(12) {
        return Err(CvError::Unreadable);
    }
    let n = (plc.len() - 4) / 12;
    let u32_at = |at: usize| u32::from_le_bytes([plc[at], plc[at + 1], plc[at + 2], plc[at + 3]]);
    let descriptors = (n + 1) * 4;
    Ok((0..n)
        .map(|i| {
            let fc = u32_at(descriptors + i * 8 + 2);
            let compressed = fc & 0x4000_0000 != 0;
            let fc = (fc & 0x3FFF_FFFF) as usize;
            Piece {
                start: u32_at(i * 4),
                end: u32_at((i + 1) * 4),
                offset: if compressed { fc / 2 } else { fc },
                compressed,
            }
        })
        .collect())
}

/// Appends the characters `start..end` (character positions) to `out`; what lies outside the
/// stream is left out.
fn read_range(word: &[u8], pieces: &[Piece], start: u32, end: u32, out: &mut String) {
    for piece in pieces {
        let from = start.max(piece.start);
        let to = end.min(piece.end);
        if from >= to {
            continue;
        }
        let skip = (from - piece.start) as usize;
        let count = (to - from) as usize;
        if piece.compressed {
            let at = piece.offset + skip;
            let bytes = word
                .get(at..(at + count).min(word.len()))
                .unwrap_or_default();
            out.extend(bytes.iter().map(|&b| char::from(b)));
        } else {
            let at = piece.offset + skip * 2;
            let bytes = word
                .get(at..(at + count * 2).min(word.len()))
                .unwrap_or_default();
            let units = bytes
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]));
            out.extend(char::decode_utf16(units).map(|c| c.unwrap_or(char::REPLACEMENT_CHARACTER)));
        }
    }
}

/// Word's special characters as text: paragraph, cell and row marks become line breaks; of a
/// field (begin 0x13, separator 0x14, end 0x15) only the result stays.
fn clean(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    // Per open field: true once its result began.
    let mut fields: Vec<bool> = Vec::new();
    for c in raw.chars() {
        match c {
            '\u{13}' => fields.push(false),
            '\u{14}' => {
                if let Some(result) = fields.last_mut() {
                    *result = true;
                }
            }
            '\u{15}' => {
                fields.pop();
            }
            _ if fields.iter().any(|result| !result) => {}
            '\r' | '\u{07}' | '\u{0B}' | '\u{0C}' => out.push('\n'),
            '\u{1E}' => out.push('-'),
            '\t' => out.push('\t'),
            c if c < ' ' => {}
            c => out.push(c),
        }
    }
    out
}
