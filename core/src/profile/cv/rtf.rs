//! RTF to text: a stripper that keeps the running text and skips the destinations that are no
//! text of the document (font and colour tables, document info, headers and footers,
//! pictures, objects, field instructions, footnotes, comments and every `\*` destination).
//! Bytes in `\'hh` are Windows-1252 (`normalize` maps its C1 range); `\uN` is Unicode with
//! its fallback skipped.

/// Destinations whose content is never text of the document.
const SKIP: &[&str] = &[
    "annotation",
    "atnauthor",
    "atnid",
    "bkmkend",
    "bkmkstart",
    "colorschememapping",
    "colortbl",
    "datastore",
    "fldinst",
    "filetbl",
    "fonttbl",
    "footer",
    "footerf",
    "footerl",
    "footerr",
    "footnote",
    "generator",
    "header",
    "headerf",
    "headerl",
    "headerr",
    "info",
    "latentstyles",
    "listoverridetable",
    "listtable",
    "nonshppict",
    "object",
    "objdata",
    "pgdsctbl",
    "pict",
    "revtbl",
    "rsidtbl",
    "stylesheet",
    "themedata",
    "xmlnstbl",
];

#[derive(Clone, Copy)]
struct Group {
    skip: bool,
    /// Fallback characters after a `\uN` (`\ucN`, default 1).
    uc: usize,
}

pub(super) fn text(bytes: &[u8]) -> String {
    let mut out = String::new();
    let mut stack: Vec<Group> = Vec::new();
    let mut group = Group { skip: false, uc: 1 };
    // Fallback characters still to skip after a `\uN`.
    let mut fallback = 0usize;
    let mut i = 0;
    let emit = |out: &mut String, group: &Group, fallback: &mut usize, c: char| {
        if *fallback > 0 {
            *fallback -= 1;
        } else if !group.skip {
            out.push(c);
        }
    };
    while i < bytes.len() {
        match bytes[i] {
            b'{' => {
                stack.push(group);
                fallback = 0;
                i += 1;
            }
            b'}' => {
                group = stack.pop().unwrap_or(group);
                fallback = 0;
                i += 1;
            }
            b'\\' => {
                i += 1;
                let Some(&next) = bytes.get(i) else { break };
                if next.is_ascii_alphabetic() {
                    let start = i;
                    while i < bytes.len() && bytes[i].is_ascii_alphabetic() {
                        i += 1;
                    }
                    let word = std::str::from_utf8(&bytes[start..i]).unwrap_or_default();
                    let num_start = i;
                    if bytes.get(i) == Some(&b'-') {
                        i += 1;
                    }
                    while i < bytes.len() && bytes[i].is_ascii_digit() {
                        i += 1;
                    }
                    let param = std::str::from_utf8(&bytes[num_start..i])
                        .ok()
                        .and_then(|n| n.parse::<i64>().ok());
                    if bytes.get(i) == Some(&b' ') {
                        i += 1;
                    }
                    match word {
                        "bin" => {
                            // Raw binary data of the given length.
                            let skip = usize::try_from(param.unwrap_or(0)).unwrap_or(0);
                            i = i.saturating_add(skip).min(bytes.len());
                        }
                        "uc" => group.uc = usize::try_from(param.unwrap_or(1)).unwrap_or(1),
                        "u" => {
                            let code = param.unwrap_or(0);
                            // Negative values are the upper half of the 16-bit range.
                            let unit = u16::try_from(code.rem_euclid(65_536)).unwrap_or(0);
                            if !group.skip {
                                out.push(char::from_u32(u32::from(unit)).unwrap_or('\u{FFFD}'));
                            }
                            fallback = group.uc;
                        }
                        _ if SKIP.contains(&word) => group.skip = true,
                        _ => {
                            if let Some(c) = word_char(word) {
                                emit(&mut out, &group, &mut fallback, c);
                            }
                        }
                    }
                } else {
                    i += 1;
                    match next {
                        b'\'' => {
                            let hex = bytes
                                .get(i..i + 2)
                                .and_then(|h| std::str::from_utf8(h).ok());
                            if let Some(b) = hex.and_then(|h| u8::from_str_radix(h, 16).ok()) {
                                emit(&mut out, &group, &mut fallback, char::from(b));
                            }
                            i = (i + 2).min(bytes.len());
                        }
                        // An ignorable destination: none of them is text of the document.
                        b'*' => group.skip = true,
                        b'~' => emit(&mut out, &group, &mut fallback, ' '),
                        b'_' => emit(&mut out, &group, &mut fallback, '-'),
                        b'\\' | b'{' | b'}' => {
                            emit(&mut out, &group, &mut fallback, char::from(next));
                        }
                        b'\n' | b'\r' => emit(&mut out, &group, &mut fallback, '\n'),
                        // `\-` (optional hyphen), `\|`, `\:` and the rest: nothing.
                        _ => {}
                    }
                }
            }
            // Line breaks in the source are no text.
            b'\r' | b'\n' => i += 1,
            b => {
                emit(&mut out, &group, &mut fallback, char::from(b));
                i += 1;
            }
        }
    }
    out
}

/// Control words that stand for a character.
fn word_char(word: &str) -> Option<char> {
    Some(match word {
        "par" | "line" | "row" | "sect" | "page" => '\n',
        "tab" | "cell" => '\t',
        "emdash" => '\u{2014}',
        "endash" => '\u{2013}',
        "bullet" => '\u{2022}',
        "lquote" => '\u{2018}',
        "rquote" => '\u{2019}',
        "ldblquote" => '\u{201C}',
        "rdblquote" => '\u{201D}',
        "emspace" | "enspace" | "qmspace" => ' ',
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::text;

    #[test]
    fn keeps_text_and_skips_destinations() {
        // The en dash as `\u` 8211 with its fallback `?`.
        let dash = [b"\\".as_slice(), b"u8211?"].concat();
        let rtf = [
            br"{\rtf1\ansi{\fonttbl{\f0 Arial;}}{\info{\title T}}{\header H\par}Gesch\'e4ft"
                .as_slice(),
            &dash,
            br"\par{\pict 0a0b}{\*\x Y}A\tab B\~C}",
        ]
        .concat();
        assert_eq!(text(&rtf), "Gesch\u{e4}ft\u{2013}\nA\tB C");
    }

    #[test]
    fn keeps_the_result_of_a_field_only() {
        let rtf = br#"{\rtf1{\field{\*\fldinst HYPERLINK "x"}{\fldrslt Link}}}"#;
        assert_eq!(text(rtf), "Link");
    }

    #[test]
    fn skips_binary_data() {
        let rtf = b"{\\rtf1{\\pict\\bin3 }}}}after}";
        assert_eq!(text(rtf), "after");
    }
}
