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
