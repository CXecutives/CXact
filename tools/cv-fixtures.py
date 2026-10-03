"""Writes the invented test CVs of `core/tests/fixtures/cv/` (one per format the CV import
reads, plus the ones it refuses). Neutral metadata: no author, fixed zip times, no EXIF.

    py -3 tools/cv-fixtures.py

The content is made up. Each document carries the same CV with personal data the import must
redact, a page header it must skip and, where the format has them, a text box it must read
once, deleted text and a field instruction it must skip (core/tests/cv_files.rs).
Needs Pillow for the photos.
"""

import io
import struct
import zipfile
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parent.parent / "core" / "tests" / "fixtures" / "cv"
ZIP_TIME = (1980, 1, 1, 0, 0, 0)

PERSONAL = [
    "Max Mustermann",
    "E-Mail: max.mustermann@example.com",
    "Telefon: +49 170 1234567",
    "Geburtsdatum: 01.01.1970",
    "Familienstand: verheiratet",
]
ROWS = [
    ("01/2015 – heute", "Interim CFO, Geschäftsführung & Controlling"),
    ("03/2008 – 12/2014", "Leiter Controlling, Einführung SAP S/4HANA"),
]
LANGUAGES = "Sprachen: Deutsch Muttersprache, Englisch verhandlungssicher"
IBAN = "IBAN: DE89 3704 0044 0532 0130 00"
TEXT_BOX = "Textfeld Projektleitung"
HEADER = "KOPFZEILE VERTRAULICH"


def esc(text):
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def write_zip(path, entries):
    """`entries`: (name, text, compressed) in order; fixed times, no extra fields."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, text, compressed in entries:
            info = zipfile.ZipInfo(name, ZIP_TIME)
            info.compress_type = zipfile.ZIP_DEFLATED if compressed else zipfile.ZIP_STORED
            info.create_system = 0
            archive.writestr(info, text.encode("utf-8"))
    path.write_bytes(buffer.getvalue())


# ------------------------------------------------------------------ WordprocessingML

W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"


def w_par(text):
    return f'<w:p><w:r><w:t xml:space="preserve">{esc(text)}</w:t></w:r></w:p>'


def docx_document():
    rows = "".join(
        f"<w:tr><w:tc>{w_par(date)}</w:tc><w:tc>{w_par(role)}</w:tc></w:tr>" for date, role in ROWS
    )
    box = f"<w:txbxContent>{w_par(TEXT_BOX)}</w:txbxContent>"
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        f'<w:document xmlns:w="{W}" xmlns:r="{R}"'
        ' xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"'
        ' xmlns:wps="http://schemas.microsoft.com/office/word/2010/wordprocessingShape"'
        ' xmlns:v="urn:schemas-microsoft-com:vml" mc:Ignorable="wps"><w:body>'
        '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/></w:tabs></w:pPr>'
        f'<w:r><w:t>{esc(PERSONAL[0])}</w:t></w:r></w:p>'
        + "".join(w_par(line) for line in PERSONAL[1:])
        + w_par("Berufserfahrung")
        + f"<w:tbl>{rows}</w:tbl>"
        + "<w:p><w:r><mc:AlternateContent>"
        f'<mc:Choice Requires="wps"><w:drawing><wps:txbx>{box}</wps:txbx></w:drawing></mc:Choice>'
        f"<mc:Fallback><w:pict><v:shape><v:textbox>{box}</v:textbox></v:shape></w:pict></mc:Fallback>"
        "</mc:AlternateContent></w:r></w:p>"
        "<w:p><w:del><w:r><w:delText>GELOESCHT</w:delText></w:r></w:del>"
        '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
        '<w:r><w:instrText xml:space="preserve"> HYPERLINK "https://example.org" </w:instrText></w:r>'
        '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
        f"<w:r><w:t>{esc(LANGUAGES)}</w:t></w:r>"
        '<w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>'
        f"<w:p><w:r><w:t>Kenntnisse</w:t></w:r><w:r><w:tab/></w:r>"
        "<w:r><w:t>Excel, Power&#160;BI</w:t></w:r></w:p>"
        + w_par(IBAN)
        + f'<w:sectPr><w:headerReference w:type="default" r:id="rId1"/></w:sectPr>'
        "</w:body></w:document>"
    )


def write_word(path, main_type):
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        f'<Override PartName="/word/document.xml" ContentType="{main_type}"/>'
        '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
        "</Types>"
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{R}/officeDocument" Target="word/document.xml"/>'
        "</Relationships>"
    )
    document_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        f'<Relationship Id="rId1" Type="{R}/header" Target="header1.xml"/>'
        "</Relationships>"
    )
    header = f'<?xml version="1.0" encoding="UTF-8"?><w:hdr xmlns:w="{W}">{w_par(HEADER)}</w:hdr>'
    write_zip(
        path,
        [
            ("[Content_Types].xml", content_types, True),
            ("_rels/.rels", rels, True),
            ("word/document.xml", docx_document(), True),
            ("word/_rels/document.xml.rels", document_rels, True),
            ("word/header1.xml", header, True),
        ],
    )


# ------------------------------------------------------------------------- ODF

def t_par(text):
    return f"<text:p>{esc(text)}</text:p>"


def write_odt(path):
    rows = "".join(
        f"<table:table-row><table:table-cell>{t_par(d)}</table:table-cell>"
        f"<table:table-cell>{t_par(r)}</table:table-cell></table:table-row>"
        for d, r in ROWS
    )
    ns = (
        'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" '
        'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" '
        'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" '
        'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" '
        'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" '
        'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"'
    )
    languages = esc(LANGUAGES).replace(": ", ":<text:s/>", 1)
    content = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<office:document-content {ns} office:version="1.3"><office:body><office:text>'
        "<text:tracked-changes><text:changed-region><text:deletion>"
        "<text:p>GELOESCHT</text:p></text:deletion></text:changed-region></text:tracked-changes>"
        + "".join(t_par(line) for line in PERSONAL)
        + '<text:h text:outline-level="1">Berufserfahrung</text:h>'
        + f"<table:table>{rows}</table:table>"
        + "<text:p><draw:frame><svg:title>BILDTITEL</svg:title>"
        f"<draw:text-box>{t_par(TEXT_BOX)}</draw:text-box></draw:frame></text:p>"
        f"<text:p>{languages}</text:p>"
        "<text:p>Kenntnisse<text:tab/>Excel, Power BI"
        "<office:annotation><text:p>KOMMENTAR</text:p></office:annotation></text:p>"
        + t_par(IBAN)
        + "</office:text></office:body></office:document-content>"
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        f'<office:document-styles {ns}><office:master-styles>'
        f'<style:master-page style:name="Standard"><style:header>{t_par(HEADER)}</style:header>'
        "</style:master-page></office:master-styles></office:document-styles>"
    )
    manifest = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">'
        '<manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.text"/>'
        '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>'
        '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>'
        "</manifest:manifest>"
    )
    write_zip(
        path,
        [
            ("mimetype", "application/vnd.oasis.opendocument.text", False),
            ("content.xml", content, True),
            ("styles.xml", styles, True),
            ("META-INF/manifest.xml", manifest, True),
        ],
    )


# ------------------------------------------------------------------- Word 97

SECTOR = 512
FREE, END, FAT_SECTOR, NO_STREAM = 0xFFFFFFFF, 0xFFFFFFFE, 0xFFFFFFFD, 0xFFFFFFFF


def cfb(streams):
    """A compound file (version 3) of root-level streams, each at least 4096 bytes so no mini
    stream is needed. `streams`: name -> bytes, already in red-black order (the first is the
    root's child, black, the second its left sibling, red)."""
    names = list(streams)
    datas = [streams[n] + b"\0" * (-len(streams[n]) % SECTOR) for n in names]
    starts, sector = [], 2  # sector 0: FAT, sector 1: directory
    for data in datas:
        starts.append(sector)
        sector += len(data) // SECTOR
    total = sector
    assert total <= SECTOR // 4, "one FAT sector is enough for the fixture"
    fat = [FAT_SECTOR, END]
    for data, start in zip(datas, starts):
        count = len(data) // SECTOR
        fat += [start + i + 1 for i in range(count - 1)] + [END]
    fat += [FREE] * (SECTOR // 4 - len(fat))

    def entry(name, kind, color, left, right, child, start, size):
        raw = name.encode("utf-16-le") + b"\0\0" if name else b""
        return (
            raw.ljust(64, b"\0")
            + struct.pack("<HBB", len(raw), kind, color)
            + struct.pack("<III", left, right, child)
            + b"\0" * 16
            + struct.pack("<I", 0)
            + b"\0" * 16
            + struct.pack("<IQ", start, size)
        )

    directory = entry("Root Entry", 5, 1, NO_STREAM, NO_STREAM, 1, END, 0)
    directory += entry(names[0], 2, 1, 2, NO_STREAM, NO_STREAM, starts[0], len(streams[names[0]]))
    directory += entry(names[1], 2, 0, NO_STREAM, NO_STREAM, NO_STREAM, starts[1], len(streams[names[1]]))
    directory += entry("", 0, 0, NO_STREAM, NO_STREAM, NO_STREAM, 0, 0)

    header = b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 16
    header += struct.pack("<HHHHH", 0x003E, 0x0003, 0xFFFE, 9, 6) + b"\0" * 6
    header += struct.pack("<IIIIIIIII", 0, 1, 1, 0, 4096, END, 0, END, 0)
    header += struct.pack("<I", 0) + struct.pack("<I", FREE) * 108
    assert len(header) == SECTOR
    return header + struct.pack(f"<{SECTOR // 4}I", *fat) + directory + b"".join(datas)


def write_doc(path):
    """Word 97-2003: the FIB, the text in two pieces (8-bit and UTF-16), a table, a field and
    a text box; the piece table in the 1Table stream."""
    body = (
        "\r".join(PERSONAL)
        + "\rBerufserfahrung\r"
        + "".join(f"{d}\x07{r}\x07\x07" for d, r in ROWS)
        + "\x13 HYPERLINK \"https://example.org\" \x14"
        + LANGUAGES
        + "\x15\rKenntnisse\tExcel, Power BI\r"
        + IBAN
        + "\r"
    )
    box = TEXT_BOX + "\r"
    # The first piece is plain ASCII (stored compressed), the rest UTF-16.
    split = body.index("Berufserfahrung")
    ascii_part, wide_part = body[:split], body[split:] + box
    assert ascii_part.isascii()
    text_at = 0x800
    wide_at = text_at + len(ascii_part)
    wide_at += wide_at % 2
    word = bytearray(text_at + len(ascii_part) + 2 + len(wide_part) * 2 + 16)
    word[text_at : text_at + len(ascii_part)] = ascii_part.encode("ascii")
    word[wide_at : wide_at + len(wide_part) * 2] = wide_part.encode("utf-16-le")
    word += b"\0" * max(0, 4096 - len(word))

    csw, cslw, cb = 14, 22, 0x5D
    fib = bytearray(32 + 2 + csw * 2 + 2 + cslw * 4 + 2 + cb * 8 + 2)
    struct.pack_into("<HHHHHH", fib, 0, 0xA5EC, 0x00C1, 0, 0x0407, 0, 0x1200)
    struct.pack_into("<H", fib, 0x12, 0x00BF)
    struct.pack_into("<H", fib, 32, csw)
    lw = 32 + 2 + csw * 2
    struct.pack_into("<H", fib, lw, cslw)
    lw += 2
    ccp_text, ccp_txbx = len(body), len(box)
    struct.pack_into("<I", fib, lw, len(word))
    struct.pack_into("<I", fib, lw + 3 * 4, ccp_text)
    struct.pack_into("<I", fib, lw + 9 * 4, ccp_txbx)
    fc = lw + cslw * 4
    struct.pack_into("<H", fib, fc, cb)
    fc += 2

    # Clx: one Prc to skip, then the PlcPcd of two pieces.
    cps = [0, len(ascii_part), len(ascii_part) + len(wide_part)]
    pcds = [(text_at * 2) | 0x40000000, wide_at]
    plc = struct.pack("<3I", *cps) + b"".join(struct.pack("<HIH", 0, p, 0) for p in pcds)
    clx = b"\x01" + struct.pack("<H", 3) + b"\x00\x00\x00" + b"\x02" + struct.pack("<I", len(plc)) + plc
    table = bytearray(0x40) + clx
    table += b"\0" * max(0, 4096 - len(table))
    struct.pack_into("<II", fib, fc + 33 * 8, 0x40, len(clx))
    word[: len(fib)] = fib
    path.write_bytes(cfb({"WordDocument": bytes(word), "1Table": bytes(table)}))


# ------------------------------------------------------------------------- RTF

def rtf_text(text):
    out = []
    for c in text:
        if c in "\\{}":
            out.append("\\" + c)
        elif ord(c) < 128:
            out.append(c)
        elif ord(c) < 256:
            out.append(f"\\'{ord(c):02x}")
        else:
            out.append(f"\\u{ord(c)}?")
    return "".join(out)


def write_rtf(path):
    rows = "".join(
        f"\\trowd\\cellx2000\\cellx7000 {rtf_text(d)}\\cell {rtf_text(r)}\\cell\\row\n" for d, r in ROWS
    )
    pixel = "89504e470d0a1a0a0000000d49484452"
    text = (
        "{\\rtf1\\ansi\\ansicpg1252\\deff0\\uc1"
        "{\\fonttbl{\\f0\\fswiss Arial;}}{\\colortbl;\\red0\\green0\\blue0;}"
        "{\\*\\generator Fixture;}{\\info{\\title TITEL}{\\author AUTOR}}\n"
        f"{{\\header \\pard {HEADER}\\par}}\n"
        + "".join(f"\\pard {rtf_text(line)}\\par\n" for line in PERSONAL)
        + "\\pard Berufserfahrung\\par\n"
        + rows
        + f"{{\\pict\\pngblip\\picw10\\pich10 {pixel}}}\n"
        + "{\\object\\objemb{\\*\\objdata 0105000002000000OBJEKT}{\\result RESULTAT}}\n"
        + "{\\field{\\*\\fldinst HYPERLINK \"https://example.org\"}{\\fldrslt "
        + rtf_text(LANGUAGES)
        + "}}\\par\n"
        + "\\pard Kenntnisse\\tab Excel, Power\\~BI\\par\n"
        + f"\\pard {rtf_text(IBAN)}\\par\n"
        + "{\\*\\shppict{\\pict\\pngblip " + pixel + "}}"
        + "}"
    )
    path.write_bytes(text.encode("ascii"))


# ------------------------------------------------------------------ plain text

def plain_lines():
    return (
        PERSONAL
        + ["", "Berufserfahrung"]
        + [f"{d}  {r}" for d, r in ROWS]
        + ["", LANGUAGES, "Kenntnisse: Excel, Power BI", IBAN]
    )


def write_txt(path):
    path.write_bytes("\r\n".join(plain_lines()).encode("utf-8"))


def write_txt_latin1(path):
    path.write_bytes("\n".join(plain_lines()).encode("cp1252"))


def write_md(path):
    lines = ["# " + PERSONAL[0]] + PERSONAL[1:] + ["", "## Berufserfahrung", ""]
    lines += [f"- **{d}** {r}" for d, r in ROWS]
    lines += ["", LANGUAGES, "", "Kenntnisse: Excel, Power BI", "", IBAN]
    path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))


def write_html(path):
    rows = "".join(f"<tr><td>{esc(d)}</td><td>{esc(r)}</td></tr>" for d, r in ROWS)
    html = (
        '<!doctype html><html lang="de"><head><meta charset="utf-8"><title>TITEL</title>'
        "<style>body { font-family: sans-serif }</style><script>var geheim = 1;</script></head><body>"
        + "".join(f"<p>{esc(line)}</p>" for line in PERSONAL)
        + f"<h2>Berufserfahrung</h2><table>{rows}</table>"
        + f"<p>{esc(LANGUAGES)}</p><p>Kenntnisse: Excel, Power&nbsp;BI</p><p>{esc(IBAN)}</p>"
        + "</body></html>"
    )
    path.write_bytes(html.encode("utf-8"))


# ------------------------------------------------------------------------- PDF

def pdf(pages):
    """A plain PDF with `pages` pages of Helvetica text (the CV on the first)."""
    objects = ["<< /Type /Catalog /Pages 2 0 R >>", None, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"]
    kids = []
    for i in range(pages):
        lines = plain_lines() if i == 0 else [f"Seite {i + 1}"]
        stream = "BT /F1 11 Tf 50 780 Td 14 TL " + " ".join(
            "(" + line.encode("cp1252").decode("latin-1").replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)") + ") '"
            for line in lines
        ) + " ET"
        objects.append(f"<< /Length {len(stream.encode('latin-1'))} >>\nstream\n{stream}\nendstream")
        content = len(objects)
        objects.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> >> /Contents {content} 0 R >>"
        )
        kids.append(f"{len(objects)} 0 R")
    objects[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {pages} >>"
    out = bytearray(b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
    offsets = []
    for number, body in enumerate(objects, start=1):
        offsets.append(len(out))
        out += f"{number} 0 obj\n{body}\nendobj\n".encode("latin-1")
    xref = len(out)
    out += f"xref\n0 {len(objects) + 1}\n0000000000 65535 f \n".encode()
    out += b"".join(f"{o:010d} 00000 n \n".encode() for o in offsets)
    out += f"trailer\n<< /Size {len(objects) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


# ---------------------------------------------------------------------- photos

def photo():
    image = Image.new("RGB", (120, 160), "white")
    draw = ImageDraw.Draw(image)
    for y in range(20, 150, 14):
        draw.rectangle((12, y, 100, y + 5), fill=(40, 40, 40))
    return image


def write_photo(path, fmt):
    buffer = io.BytesIO()
    options = {"JPEG": {"quality": 80}, "PNG": {"optimize": False}, "WEBP": {"lossless": True}}[fmt]
    photo().save(buffer, fmt, **options)
    path.write_bytes(buffer.getvalue())


# ---------------------------------------------------------------- refused ones

def write_pages(path):
    write_zip(path, [("Index/Document.iwa", "not readable", True), ("Metadata/Properties.plist", "x", True)])


def write_heic(path):
    path.write_bytes(struct.pack(">I", 24) + b"ftypheic" + b"\0\0\0\0" + b"mif1heic" + b"\0" * 32)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    main_type = "application/vnd.openxmlformats-officedocument.wordprocessingml"
    write_word(OUT / "lebenslauf.docx", f"{main_type}.document.main+xml")
    write_word(OUT / "lebenslauf.docm", "application/vnd.ms-word.document.macroEnabled.main+xml")
    write_word(OUT / "lebenslauf.dotx", f"{main_type}.template.main+xml")
    write_odt(OUT / "lebenslauf.odt")
    write_doc(OUT / "lebenslauf.doc")
    write_rtf(OUT / "lebenslauf.rtf")
    write_txt(OUT / "lebenslauf.txt")
    write_txt_latin1(OUT / "lebenslauf-ansi.txt")
    write_md(OUT / "lebenslauf.md")
    write_html(OUT / "lebenslauf.html")
    (OUT / "lebenslauf.pdf").write_bytes(pdf(1))
    (OUT / "lebenslauf-16-seiten.pdf").write_bytes(pdf(16))
    write_photo(OUT / "seite.jpg", "JPEG")
    write_photo(OUT / "seite.png", "PNG")
    write_photo(OUT / "seite.webp", "WEBP")
    write_pages(OUT / "lebenslauf.pages")
    write_heic(OUT / "seite.heic")


if __name__ == "__main__":
    main()
