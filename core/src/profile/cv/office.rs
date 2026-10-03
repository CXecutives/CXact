//! DOCX, DOCM, DOTX (`WordprocessingML`) and ODT (`OpenDocument` text): the zip's main XML
//! part as text. Paragraphs, table rows, text boxes and fields' results count; headers and
//! footers live in other parts and are never opened; deleted text, field instructions,
//! comments and the fallback copies of text boxes are skipped. The unpacked XML is capped.

use std::io::{Cursor, Read};

use quick_xml::encoding::Decoder;
use quick_xml::events::{BytesStart, Event};
use quick_xml::{Reader, XmlVersion};

use super::{CvError, Format};

/// The most XML one part may unpack to (a zip bomb stops here).
const MAX_XML: u64 = 20 * 1024 * 1024;

/// How one dialect's elements read.
struct Dialect {
    /// The root element of the main part (anything else is another kind of file).
    root: &'static str,
    /// Only text inside these elements counts (empty: all text).
    text_in: &'static [&'static str],
    /// Elements whose whole content is skipped.
    skip: &'static [&'static str],
    /// Elements that end a line where they end (or stand empty).
    line: &'static [&'static str],
    /// Empty elements that stand for a character.
    char_of: fn(&[u8]) -> Option<char>,
}

const WORD: Dialect = Dialect {
    root: "document",
    text_in: &["t"],
    skip: &[
        "delText",
        "instrText",
        "Fallback",
        "pPr",
        "rPr",
        "moveFrom",
        "sdtPr",
        "commentReference",
    ],
    line: &["p", "tr"],
    char_of: |name| match name {
        b"tab" => Some('\t'),
        b"br" | b"cr" => Some('\n'),
        b"noBreakHyphen" => Some('-'),
        _ => None,
    },
};

const ODF: Dialect = Dialect {
    root: "document-content",
    text_in: &[],
    skip: &[
        "annotation",
        "tracked-changes",
        "note",
        "title",
        "desc",
        "automatic-styles",
        "font-face-decls",
        "scripts",
        "sequence-decls",
    ],
    line: &["p", "h", "table-row", "list-item"],
    char_of: |name| match name {
        b"tab" => Some('\t'),
        b"line-break" => Some('\n'),
        b"s" => Some(' '),
        _ => None,
    },
};

/// The text of a DOCX-like or ODT file; other zips (Pages, a spreadsheet) are unsupported.
pub(super) fn text(bytes: &[u8]) -> Result<(Format, String), CvError> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| CvError::Unreadable)?;
    if let Some(mimetype) = part(&mut zip, "mimetype")? {
        if mimetype.starts_with("application/vnd.oasis.opendocument.text") {
            let content = part(&mut zip, "content.xml")?.ok_or(CvError::Unreadable)?;
            return Ok((Format::Odt, xml_text(&content, &ODF)?));
        }
        return Err(CvError::Unsupported);
    }
    let main = part(&mut zip, "_rels/.rels")?
        .and_then(|rels| main_part(&rels))
        .unwrap_or_else(|| "word/document.xml".to_owned());
    let Some(document) = part(&mut zip, &main)? else {
        return Err(CvError::Unsupported);
    };
    Ok((Format::Docx, xml_text(&document, &WORD)?))
}

/// One part as UTF-8 text, `None` when the zip has none of that name.
fn part(zip: &mut zip::ZipArchive<Cursor<&[u8]>>, name: &str) -> Result<Option<String>, CvError> {
    let file = match zip.by_name(name) {
        Ok(file) => file,
        Err(zip::result::ZipError::FileNotFound) => return Ok(None),
        Err(_) => return Err(CvError::Unreadable),
    };
    if file.size() > MAX_XML {
        return Err(CvError::TooLarge);
    }
    let mut bytes = Vec::new();
    file.take(MAX_XML + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| CvError::Unreadable)?;
    if bytes.len() as u64 > MAX_XML {
        return Err(CvError::TooLarge);
    }
    let bytes = bytes.strip_prefix(b"\xEF\xBB\xBF").unwrap_or(&bytes);
    String::from_utf8(bytes.to_vec())
        .map(Some)
        .map_err(|_| CvError::Unreadable)
}

/// The target of the package's `officeDocument` relationship.
fn main_part(rels: &str) -> Option<String> {
    let mut reader = Reader::from_str(rels);
    loop {
        match reader.read_event() {
            Ok(Event::Start(e) | Event::Empty(e)) if e.local_name().as_ref() == b"Relationship" => {
                let kind = attribute(&e, b"Type", reader.decoder())?;
                if kind.ends_with("/officeDocument") {
                    let target = attribute(&e, b"Target", reader.decoder())?;
                    return Some(target.trim_start_matches('/').to_owned());
                }
            }
            Ok(Event::Eof) | Err(_) => return None,
            Ok(_) => {}
        }
    }
}

fn attribute(element: &BytesStart, name: &[u8], decoder: Decoder) -> Option<String> {
    element
        .attributes()
        .flatten()
        .find(|a| a.key.local_name().as_ref() == name)
        .and_then(|a| {
            a.decoded_and_normalized_value(XmlVersion::Implicit1_0, decoder)
                .ok()
        })
        .map(std::borrow::Cow::into_owned)
}

fn xml_text(xml: &str, dialect: &Dialect) -> Result<String, CvError> {
    let mut reader = Reader::from_str(xml);
    let mut out = String::new();
    let mut root_seen = false;
    // Depth inside a skipped element (0: not skipping), and inside a text element.
    let mut skipping = 0usize;
    let mut texting = 0usize;
    loop {
        let event = reader.read_event().map_err(|_| CvError::Unreadable)?;
        match event {
            Event::Start(e) => {
                let name = e.local_name();
                let name = name.as_ref();
                if !root_seen {
                    if name != dialect.root.as_bytes() {
                        return Err(CvError::Unsupported);
                    }
                    root_seen = true;
                }
                if skipping > 0 || is(dialect.skip, name) {
                    skipping += 1;
                } else if is(dialect.text_in, name) {
                    texting += 1;
                }
            }
            Event::End(e) => {
                let name = e.local_name();
                let name = name.as_ref();
                if skipping > 0 {
                    skipping -= 1;
                } else if is(dialect.text_in, name) {
                    texting = texting.saturating_sub(1);
                } else if is(dialect.line, name) {
                    out.push('\n');
                }
            }
            Event::Empty(e) => {
                let name = e.local_name();
                let name = name.as_ref();
                if skipping > 0 {
                    continue;
                }
                if let Some(c) = (dialect.char_of)(name) {
                    out.push(c);
                } else if is(dialect.line, name) {
                    out.push('\n');
                }
            }
            Event::Text(t) if skipping == 0 && (dialect.text_in.is_empty() || texting > 0) => {
                out.push_str(&t.xml10_content().map_err(|_| CvError::Unreadable)?);
            }
            Event::CData(t) if skipping == 0 && (dialect.text_in.is_empty() || texting > 0) => {
                out.push_str(&t.decode().map_err(|_| CvError::Unreadable)?);
            }
            Event::GeneralRef(r)
                if skipping == 0 && (dialect.text_in.is_empty() || texting > 0) =>
            {
                let resolved = match r.resolve_char_ref() {
                    Ok(Some(c)) => Some(c.to_string()),
                    Ok(None) => r.decode().ok().and_then(|name| {
                        quick_xml::escape::resolve_predefined_entity(&name).map(str::to_owned)
                    }),
                    Err(_) => None,
                };
                out.push_str(resolved.as_deref().unwrap_or_default());
            }
            Event::Eof => break,
            _ => {}
        }
    }
    if root_seen {
        Ok(out)
    } else {
        Err(CvError::Unsupported)
    }
}

fn is(list: &[&str], name: &[u8]) -> bool {
    list.iter().any(|l| l.as_bytes() == name)
}
