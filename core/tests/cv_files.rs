//! Reading CVs for the AI import (`profile::cv`): the invented CVs of `fixtures/cv/` (written
//! by `tools/cv-fixtures.py`) in every format, what goes out and what never does.

use std::path::PathBuf;

use jobalert_core::profile::cv::{self, Cv, CvError, CvInput, Format};

fn fixture(name: &str) -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/cv")
        .join(name)
}

fn read(names: &[&str]) -> Result<Cv, CvError> {
    let paths: Vec<PathBuf> = names.iter().map(|n| fixture(n)).collect();
    cv::read(&paths)
}

fn text_of(name: &str) -> (Format, String) {
    let cv = read(&[name]).unwrap_or_else(|e| panic!("{name}: {e:?}"));
    match cv.input {
        CvInput::Text(text) => (cv.format, text),
        CvInput::Files(_) => panic!("{name}: files instead of text"),
    }
}

/// What every text format keeps, and the personal data it never sends.
fn assert_cv(name: &str, text: &str) {
    for kept in [
        "Max Mustermann",
        "Berufserfahrung",
        "01/2015",
        "03/2008 – 12/2014",
        "Interim CFO, Geschäftsführung & Controlling",
        "Leiter Controlling, Einführung SAP S/4HANA",
        "Englisch verhandlungssicher",
        "Excel, Power BI",
    ] {
        assert!(text.contains(kept), "{name}: `{kept}` missing in\n{text}");
    }
    for gone in [
        "example.com",
        "1234567",
        "1970",
        "verheiratet",
        "3704",
        "KOPFZEILE",
        "TITEL",
    ] {
        assert!(!text.contains(gone), "{name}: `{gone}` in\n{text}");
    }
}

#[test]
fn word_files_give_their_text_with_tables_and_text_boxes() {
    for name in ["lebenslauf.docx", "lebenslauf.docm", "lebenslauf.dotx"] {
        let (format, text) = text_of(name);
        assert_eq!(format, Format::Docx);
        assert_cv(name, &text);
        assert_eq!(
            text.matches("Textfeld Projektleitung").count(),
            1,
            "{name}: {text}"
        );
        for gone in ["GELOESCHT", "HYPERLINK"] {
            assert!(!text.contains(gone), "{name}: `{gone}` in\n{text}");
        }
        // Each table row on its own line.
        assert!(
            text.contains("01/2015 – heute\nInterim CFO"),
            "{name}: {text}"
        );
    }
}

#[test]
fn an_odt_gives_its_text_without_comments_and_changes() {
    let (format, text) = text_of("lebenslauf.odt");
    assert_eq!(format, Format::Odt);
    assert_cv("lebenslauf.odt", &text);
    assert_eq!(text.matches("Textfeld Projektleitung").count(), 1, "{text}");
    for gone in ["GELOESCHT", "KOMMENTAR", "BILDTITEL"] {
        assert!(!text.contains(gone), "`{gone}` in\n{text}");
    }
}

#[test]
fn a_word_97_file_gives_its_text_through_the_piece_table() {
    let (format, text) = text_of("lebenslauf.doc");
    assert_eq!(format, Format::Doc);
    assert_cv("lebenslauf.doc", &text);
    assert_eq!(text.matches("Textfeld Projektleitung").count(), 1, "{text}");
    assert!(!text.contains("HYPERLINK"), "{text}");
}

#[test]
fn an_rtf_gives_its_text_without_pictures_and_objects() {
    let (format, text) = text_of("lebenslauf.rtf");
    assert_eq!(format, Format::Rtf);
    assert_cv("lebenslauf.rtf", &text);
    for gone in [
        "89504e47",
        "OBJEKT",
        "RESULTAT",
        "HYPERLINK",
        "AUTOR",
        "Arial",
    ] {
        assert!(!text.contains(gone), "`{gone}` in\n{text}");
    }
}

#[test]
fn plain_text_markdown_and_html_are_read() {
    for (name, expected) in [
        ("lebenslauf.txt", Format::Txt),
        ("lebenslauf-ansi.txt", Format::Txt),
        ("lebenslauf.md", Format::Markdown),
        ("lebenslauf.html", Format::Html),
    ] {
        let (format, text) = text_of(name);
        assert_eq!(format, expected, "{name}");
        assert_cv(name, &text);
    }
    let (_, html) = text_of("lebenslauf.html");
    assert!(!html.contains("geheim"), "{html}");
}

/// A CV whose personal data stands in table cells, one per line: the address, birth date,
/// nationality, religion, marital status and children never go out, the career does.
#[test]
fn a_cv_sends_no_address_nationality_religion_or_children() {
    let text = "Max Mustermann\nMusterstraße 12\n20095 Hamburg\nPersönliche Daten\nGeburtsdatum\n01.01.1970\nStaatsangehörigkeit\ndeutsch\nKonfession\nevangelisch\nFamilienstand\nverheiratet, 2 Kinder\nBerufserfahrung\n01/2015 – heute\nInterim CFO, Beispiel AG, Hamburg\n03/2008 – 12/2014\nLeiter Controlling, Muster GmbH, München\nKenntnisse\nSAP S/4HANA, ISO 27001, IFRS 16\n";
    let cv = cv::from_files(vec![("cv.txt".into(), text.as_bytes().to_vec())]).unwrap();
    let CvInput::Text(sent) = cv.input else {
        panic!("files instead of text")
    };
    for kept in [
        "Max Mustermann",
        "Persönliche Daten",
        "Berufserfahrung\n01/2015 – heute\nInterim CFO, Beispiel AG, Hamburg",
        "03/2008 – 12/2014\nLeiter Controlling, Muster GmbH, München",
        "SAP S/4HANA, ISO 27001, IFRS 16",
    ] {
        assert!(sent.contains(kept), "`{kept}` missing in\n{sent}");
    }
    for gone in [
        "Musterstraße",
        "20095",
        "1970",
        "deutsch",
        "evangelisch",
        "verheiratet",
        "Kinder",
    ] {
        assert!(!sent.contains(gone), "`{gone}` in\n{sent}");
    }
}

#[test]
fn a_pdf_goes_as_a_file_within_its_limits() {
    let cv = read(&["lebenslauf.pdf"]).unwrap();
    assert_eq!(cv.format, Format::Pdf);
    let CvInput::Files(files) = &cv.input else {
        panic!("text instead of the file")
    };
    assert_eq!(files.len(), 1);
    assert_eq!(files[0].mime, "application/pdf");
    assert_eq!(
        files[0].bytes,
        std::fs::read(fixture("lebenslauf.pdf")).unwrap()
    );
    assert_eq!(read(&["lebenslauf-16-seiten.pdf"]), Err(CvError::TooLarge));
}

#[test]
fn photos_go_as_files_up_to_five() {
    let cv = read(&["seite.jpg", "seite.png", "seite.webp"]).unwrap();
    let CvInput::Files(files) = &cv.input else {
        panic!("text instead of the photos")
    };
    let mimes: Vec<&str> = files.iter().map(|f| f.mime).collect();
    assert_eq!(mimes, ["image/jpeg", "image/png", "image/webp"]);
    assert_eq!(read(&["seite.jpg"; 6]), Err(CvError::TooLarge));
}

#[test]
fn a_large_photo_is_downscaled_to_a_jpeg() {
    // Noise does not compress: about 9 MB as PNG.
    let (width, height) = (1800, 1700);
    let mut state = 0x1234_5678_u32;
    let pixels: Vec<u8> = (0..width * height * 3)
        .map(|_| {
            state ^= state << 13;
            state ^= state >> 17;
            state ^= state << 5;
            state.to_le_bytes()[0]
        })
        .collect();
    let image = image::RgbImage::from_raw(width, height, pixels).unwrap();
    let mut png = Vec::new();
    image
        .write_to(&mut std::io::Cursor::new(&mut png), image::ImageFormat::Png)
        .unwrap();
    assert!(png.len() > 3_750_000, "{} bytes", png.len());
    let cv = cv::from_files(vec![("foto.png".into(), png)]).unwrap();
    let CvInput::Files(files) = &cv.input else {
        panic!("text instead of the photo")
    };
    assert_eq!(files[0].mime, "image/jpeg");
    assert!(
        files[0].bytes.len() <= 3_750_000,
        "{}",
        files[0].bytes.len()
    );
}

/// One IFD of a TIFF block (big-endian) at `start`, its values longer than four bytes after
/// it: (tag, type, count, value).
fn ifd(start: usize, entries: &[(u16, u16, u32, Vec<u8>)]) -> Vec<u8> {
    let offset = |at: usize| u32::try_from(at).unwrap().to_be_bytes();
    let mut head = u16::try_from(entries.len()).unwrap().to_be_bytes().to_vec();
    let mut data = Vec::new();
    let data_start = start + 2 + 12 * entries.len() + 4;
    for (tag, kind, count, value) in entries {
        head.extend(tag.to_be_bytes());
        head.extend(kind.to_be_bytes());
        head.extend(count.to_be_bytes());
        if value.len() <= 4 {
            let mut inline = value.clone();
            inline.resize(4, 0);
            head.extend(inline);
        } else {
            head.extend(offset(data_start + data.len()));
            data.extend(value);
            if data.len() % 2 == 1 {
                data.push(0);
            }
        }
    }
    head.extend([0; 4]);
    head.extend(data);
    head
}

/// An EXIF block as a phone writes it: camera, time, the GPS position and, when given, an
/// orientation.
fn phone_exif(orientation: Option<u16>) -> Vec<u8> {
    const ASCII: u16 = 2;
    const SHORT: u16 = 3;
    const LONG: u16 = 4;
    const RATIONAL: u16 = 5;
    let text = |s: &str| {
        let mut bytes = s.as_bytes().to_vec();
        bytes.push(0);
        (u32::try_from(bytes.len()).unwrap(), bytes)
    };
    let degrees = |values: [u32; 3]| -> Vec<u8> {
        values
            .iter()
            .flat_map(|v| [v.to_be_bytes(), 1u32.to_be_bytes()].concat())
            .collect()
    };
    let (make_len, make) = text("CXactCam Phone");
    let (time_len, time) = text("2026:10:01 12:34:56");
    let mut first = vec![(0x010F, ASCII, make_len, make)];
    if let Some(turn) = orientation {
        first.push((0x0112, SHORT, 1, turn.to_be_bytes().to_vec()));
    }
    first.push((0x0132, ASCII, time_len, time));
    first.push((0x8825, LONG, 1, vec![0; 4]));
    let gps_at = 8 + ifd(8, &first).len();
    first.last_mut().unwrap().3 = u32::try_from(gps_at).unwrap().to_be_bytes().to_vec();
    let gps = [
        (0x0001, ASCII, 2, b"N\0".to_vec()),
        (0x0002, RATIONAL, 3, degrees([53, 33, 11])),
        (0x0003, ASCII, 2, b"E\0".to_vec()),
        (0x0004, RATIONAL, 3, degrees([9, 59, 44])),
    ];
    let mut exif = b"MM\0*\0\0\0\x08".to_vec();
    exif.extend(ifd(8, &first));
    exif.extend(ifd(gps_at, &gps));
    exif
}

/// A JPEG photo of a page, 40 x 30, with the phone's EXIF, an XMP block with the position, a
/// comment and a colour profile.
fn phone_photo(orientation: Option<u16>) -> (Vec<u8>, Vec<u8>) {
    use image::ImageEncoder;
    let page = image::RgbImage::from_fn(40, 30, |x, y| {
        image::Rgb([
            u8::try_from(x * 6).unwrap(),
            u8::try_from(y * 8).unwrap(),
            90,
        ])
    });
    let icc = b"a colour profile, kept".to_vec();
    let mut jpeg = Vec::new();
    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpeg, 90);
    encoder.set_exif_metadata(phone_exif(orientation)).unwrap();
    encoder.set_icc_profile(icc.clone()).unwrap();
    encoder.encode_image(&page).unwrap();
    let xmp = b"http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>GPSLatitude 53,33.18N</x:xmpmeta>";
    let comment = b"CXactCam comment";
    let mut segments = Vec::new();
    for (marker, payload) in [(0xE1_u8, &xmp[..]), (0xFE, &comment[..])] {
        segments.extend([0xFF, marker]);
        segments.extend(u16::try_from(payload.len() + 2).unwrap().to_be_bytes());
        segments.extend(payload);
    }
    jpeg.splice(2..2, segments);
    (jpeg, icc)
}

fn decoder(bytes: &[u8]) -> image::codecs::jpeg::JpegDecoder<std::io::Cursor<&[u8]>> {
    image::codecs::jpeg::JpegDecoder::new(std::io::Cursor::new(bytes)).unwrap()
}

fn sent_photo(bytes: Vec<u8>) -> cv::CvFile {
    let cv = cv::from_files(vec![("foto.jpg".into(), bytes)]).unwrap();
    let CvInput::Files(mut files) = cv.input else {
        panic!("text instead of the photo")
    };
    files.remove(0)
}

fn has(haystack: &[u8], needle: &[u8]) -> bool {
    haystack.windows(needle.len()).any(|w| w == needle)
}

#[test]
fn a_photo_leaves_without_its_gps_position_camera_and_time() {
    use image::ImageDecoder;
    let (photo, icc) = phone_photo(None);
    assert!(decoder(&photo).exif_metadata().unwrap().is_some());
    assert!(has(&photo, b"CXactCam") && has(&photo, b"ns.adobe.com/xap"));

    let sent = sent_photo(photo.clone());
    assert_eq!(sent.mime, "image/jpeg");
    for gone in [
        &b"Exif\0\0"[..],
        b"CXactCam",
        b"2026:10:01",
        b"ns.adobe.com/xap",
    ] {
        assert!(!has(&sent.bytes, gone), "{}", String::from_utf8_lossy(gone));
    }
    let mut clean = decoder(&sent.bytes);
    assert_eq!(clean.exif_metadata().unwrap(), None);
    assert_eq!(clean.xmp_metadata().unwrap(), None);
    assert_eq!(
        clean.icc_profile().unwrap(),
        Some(icc),
        "the colour profile stays"
    );
    // Nothing but the metadata changed: the same pixels.
    let pixels = |bytes: &[u8]| image::load_from_memory(bytes).unwrap().to_rgb8().into_raw();
    assert_eq!(pixels(&sent.bytes), pixels(&photo));
}

#[test]
fn a_photo_turned_by_its_exif_leaves_upright_without_it() {
    use image::ImageDecoder;
    // 6: turned 90 degrees clockwise to be read.
    let (photo, _) = phone_photo(Some(6));
    let sent = sent_photo(photo);
    assert_eq!(sent.mime, "image/jpeg");
    let mut clean = decoder(&sent.bytes);
    assert_eq!(clean.dimensions(), (30, 40));
    assert_eq!(clean.exif_metadata().unwrap(), None);
    assert!(!has(&sent.bytes, b"CXactCam"));
}

#[test]
fn other_formats_and_mixtures_are_refused() {
    assert_eq!(read(&["lebenslauf.pages"]), Err(CvError::Unsupported));
    assert_eq!(read(&["seite.heic"]), Err(CvError::Unsupported));
    assert_eq!(
        read(&["lebenslauf.pdf", "seite.jpg"]),
        Err(CvError::Unsupported)
    );
    assert_eq!(
        read(&["lebenslauf.docx", "lebenslauf.odt"]),
        Err(CvError::Unsupported)
    );
    assert_eq!(read(&[]), Err(CvError::Unsupported));
    let unknown = cv::from_files(vec![("cv.xyz".into(), b"Controlling".repeat(10))]);
    assert_eq!(unknown, Err(CvError::Unsupported));
}

#[test]
fn broken_and_empty_files_are_unreadable() {
    let broken = |name: &str, bytes: &[u8]| cv::from_files(vec![(name.into(), bytes.to_vec())]);
    assert_eq!(
        broken("cv.docx", b"PK\x03\x04broken"),
        Err(CvError::Unreadable)
    );
    assert_eq!(
        broken("cv.doc", b"\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1broken"),
        Err(CvError::Unreadable)
    );
    assert_eq!(broken("cv.txt", b"   \n  "), Err(CvError::Unreadable));
    assert_eq!(
        broken("cv.jpg", b"\xFF\xD8\xFFbroken"),
        Err(CvError::Unreadable)
    );
    assert_eq!(
        cv::read(&[fixture("missing.docx")]),
        Err(CvError::Unreadable)
    );
}

#[test]
fn text_above_the_worker_limit_is_too_large() {
    let long = "Controlling und Finanzen. ".repeat(4_000);
    let result = cv::from_files(vec![("cv.txt".into(), long.into_bytes())]);
    assert_eq!(result, Err(CvError::TooLarge));
}

#[test]
fn a_zip_bomb_stops_at_the_cap() {
    use std::io::Write;
    let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    zip.start_file("word/document.xml", options).unwrap();
    let chunk = vec![b' '; 1024 * 1024];
    for _ in 0..21 {
        zip.write_all(&chunk).unwrap();
    }
    let bytes = zip.finish().unwrap().into_inner();
    assert!(bytes.len() < 1024 * 1024, "{}", bytes.len());
    let result = cv::from_files(vec![("cv.docx".into(), bytes)]);
    assert_eq!(result, Err(CvError::TooLarge));
}
