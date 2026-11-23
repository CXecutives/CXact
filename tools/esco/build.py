"""ESCO vocabulary of the matching engine: core/src/matching/lexicon/esco.bin.

    py -3.14 tools/esco/build.py [FOLDER]

FOLDER holds the two CSV downloads of the ESCO portal (classification, DE and EN), as
"ESCO dataset - v<version> - classification - <de|en> - csv.zip"; the default is
core/tests/fixtures/private/esco (ignored by git: the raw data never enters the repo). The
portal asks for an e-mail address, so the user downloads them once by hand.

ESCO is the European Commission's classification of skills, competences and occupations
(https://esco.ec.europa.eu). Reuse is authorised under the Commission's reuse policy
(Decision 2011/833/EU) with attribution; the notice is in src-tauri/resources/THIRD-PARTY.txt
(tools/third-party.mjs) and must name the version written here.

What the file holds (read by core/src/matching/lexicon/esco.rs):
- every released concept: occupation, skill (skill/competence), knowledge or language (the
  members of the language collection), and whether it is transversal (reuse level
  "transversal" or a member of the transversal collection)
- its labels in German and English: the preferred label first, then the alternative ones,
  then the hidden ones (misspellings, old terms), each marked with "~". A German label that
  names both gender forms ("Leiter Callcenter/Leiterin Callcenter") becomes its two forms
- the key index: every label folded the engine's way (see `key`) to the concepts it names.
  A label stays out of the index (see `why_not`) when its key is empty, longer than
  MAX_WORDS words, one word of GENERIC, one word left of a longer label ("deep learning"
  folds to "learn"), or two words of VAGUE

The key is the engine's token stream without its concept tables, as `atoms` in
core/src/matching/atoms.rs builds it: case folding, umlauts folded, gender endings and
"knowledge of" suffixes removed, stopwords, fillers and short words dropped, the light
stemmer. On top, a hyphenated or slashed word counts as its parts, and a feminine form after
a slash goes ("Kunden/Kundinnen"). This file mirrors that code and reads its word lists from
the Rust sources; esco.rs has the same function, and its test checks every key here against
it. When the engine's folding changes, run this script again (and mirror the change here).

The file: the magic "ESCO", a format byte, then two sections, each a little-endian u32
length and a zlib stream of UTF-8 text (one record per line, fields split by tabs):
  1. index:     "ESCO <version>", the concepts ("<kind><t>" per
                line, in id order: kind o/s/k/l, t 1 for transversal), "=", then the keys,
                sorted by bytes: "<key>\t<id>,<id>,..." (ids sorted)
  2. labels:    per concept id one line "<de labels>\t<en labels>", labels split by "|"
"""

from __future__ import annotations

import csv
import io
import re
import struct
import sys
import zipfile
import zlib
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "core" / "src" / "matching" / "lexicon" / "esco.bin"
DEFAULT_SOURCE = REPO / "core" / "tests" / "fixtures" / "private" / "esco"
LEXICON = REPO / "core" / "src" / "matching" / "lexicon"
FORMAT = 2

# Keys of more words never occur in a job ad as they are (ESCO's long skill phrases).
MAX_WORDS = 6

# The index leaves out what would name a concept from too little. Folded and unstemmed
# words; the script stems them. Review both lists when the data changes (`-v` prints what
# they leave out).
#
# Too broad or ambiguous alone: a one-word key of these stays out.
GENERIC = [
    # Activities of any job.
    "analyse", "analysieren", "analysis", "analyze", "anwenden", "arbeit", "arbeiten",
    "aufgabe", "beraten", "betreuen", "bewerten", "control", "durchfuhren", "entwickeln",
    "erstellen", "fuhren", "handle", "help", "helfen", "implement", "kontrollieren", "lead",
    "leiten", "manage", "managen", "monitor", "operate", "organisieren", "organise",
    "organize", "perform", "plan", "planen", "prufen", "steuern", "unterstutzen", "use",
    "verwalten",
    # Ranks and roles without a field.
    "assistant", "assistent", "assistentin", "director", "direktor", "direktorin", "expert",
    "experte", "expertin", "head", "helfer", "helferin", "leiter", "leiterin", "manager",
    "managerin", "mitarbeiter", "mitarbeiterin", "officer", "specialist", "spezialist",
    "spezialistin", "staff", "worker",
    # Broad nouns.
    "art", "arten", "beratung", "business", "daten", "data", "design", "engineer",
    "entwicklung", "fuhrung", "information", "informationen", "kontrolle", "leitung",
    "management", "material", "materialien", "method", "methode", "methoden", "methods",
    "model", "organisation", "planung", "process", "prozess", "produkt", "produkte",
    "product", "products", "projekt", "project", "research", "service", "steuerung",
    "support", "system", "systeme", "systems", "task", "team", "technician", "technik",
    "technique", "techniques", "technology", "tool", "tools", "type", "typen", "unternehmen",
    "unterstutzung", "verwaltung",
    # An agent noun whose stem is a common word of the other language or of the same
    # ("Bäcker" stems to "back", "Trainer" to "train", "Tester" to "test"), and short labels
    # that are common words ("ISO" for an information security officer, "CALL").
    "ableser", "backen", "backer", "breaker", "builder", "call", "care", "cleaner", "copy",
    "dealer", "drawer", "extra", "feeder", "former", "hearing", "host", "iso", "loader",
    "man", "marken", "page", "presser", "reader", "seller", "super", "tester", "texter",
    "tie", "trainer", "valuer", "winder", "woman",
]
# Vague words: a two-word key of only these stays out ("organise work", "plan tasks").
VAGUE = [
    "analyse", "apply", "arbeit", "arbeiten", "handle", "help", "lead", "manage", "monitor",
    "operate", "organise", "organize", "perform", "plan", "support", "task", "tasks", "use",
    "work",
]

KINDS = {"occupation": "o", "skill": "s", "knowledge": "k", "language": "l"}


# --------------------------------------------------------------- the engine's word lists


def rust_list(source: str, name: str) -> list[str]:
    """The string literals of `pub(crate) const NAME: &[&str] = &[...];`."""
    found = re.search(
        r"pub\(crate\) const " + name + r": &\[&str\] = &\[(.*?)\];", source, re.S
    )
    if not found:
        sys.exit(f"{name} not found in the lexicon sources")
    return re.findall(r'"((?:[^"\\]|\\.)*)"', found.group(1))


def rust_synonyms(source: str) -> dict[str, str | None]:
    found = re.search(
        r"pub\(crate\) const SYNONYM_WORDS: &\[\(&str, Option<&str>\)\] = &\[(.*?)\n\];",
        source,
        re.S,
    )
    if not found:
        sys.exit("SYNONYM_WORDS not found in tables.rs")
    pairs = re.findall(
        r'\(\s*"([^"]*)",\s*(?:Some\(\s*"([^"]*)"\s*\)|(None))\s*,?\s*\)', found.group(1)
    )
    return {k: (None if none else v) for k, v, none in pairs}


TABLES = (LEXICON / "tables.rs").read_text(encoding="utf-8")
ENGINE = "\n".join(
    f.read_text(encoding="utf-8") for f in sorted((LEXICON / "engine").glob("*.rs"))
)
STOPWORDS = rust_list(TABLES, "STOPWORDS")
SYNONYMS = rust_synonyms(TABLES)
FILLERS = rust_list(ENGINE, "FILLERS")
SHORT_TOKENS = set(rust_list(ENGINE, "SHORT_TOKENS"))
NUMBERED_CODES = set(rust_list(ENGINE, "NUMBERED_CODES"))
KNOWLEDGE_SUFFIXES = rust_list(ENGINE, "KNOWLEDGE_SUFFIXES")
GENDER_FORMS = rust_list(ENGINE, "GENDER_FORMS")


# ------------------------------------------------------------------- the engine's folding


def fold(text: str) -> str:
    """`atoms::fold`: case folding (Rust mirrors Python's), umlauts folded."""
    return text.casefold().replace("ä", "a").replace("ö", "o").replace("ü", "u")


STOP = {fold(w) for w in STOPWORDS} | set(FILLERS)
MISSING = object()


def blen(text: str) -> int:
    """Rust's `str::len` (bytes)."""
    return len(text.encode("utf-8"))


def is_alnum(c: str) -> bool:
    return c.isalnum()


def strip_gender(folded: str) -> str:
    """`atoms::strip_gender`."""
    out: list[str] = []
    i = 0
    while i < len(folded):
        rest = folded[i:]
        form = next(
            (
                f
                for f in GENDER_FORMS
                if rest.startswith(f)
                and (len(rest) == len(f) or not is_alnum(rest[len(f)]))
                and out
                and is_alnum(out[-1])
            ),
            None,
        )
        if form:
            i += len(form)
        else:
            out.append(folded[i])
            i += 1
    return "".join(out)


def raw_tokens(folded: str) -> list[str]:
    """`atoms::raw_tokens`."""
    parts = re.split(r"[^a-zA-Z0-9+#./\-&ß]", folded)
    return [t for t in (p.strip(".-/&") for p in parts) if t]


def without_knowledge(token: str) -> str:
    for suffix in KNOWLEDGE_SUFFIXES:
        if token.endswith(suffix) and len(token) > len(suffix):
            return token[: -len(suffix)]
    return token


def synonym(token: str):
    return SYNONYMS.get(token, MISSING)


def split_codes(token: str) -> list[str]:
    parts = token.split("/")
    codes = len(parts) > 1 and all(
        (blen(p) <= 3 and synonym(p) is not MISSING)
        or (2 <= blen(p) <= 5 and p.isascii() and p.isalpha())
        for p in parts
    )
    return parts if codes else [token]


def numbered(raw: list[str]) -> list[str]:
    out: list[str] = []
    i = 0
    while i < len(raw):
        t = raw[i]
        n = raw[i + 1] if i + 1 < len(raw) else None
        if (
            n is not None
            and blen(n) <= 6
            and all(c in "0123456789" for c in n)
            and t in NUMBERED_CODES
        ):
            out.append(f"{t}-{n}")
            i += 2
        else:
            out.append(t)
            i += 1
    return out


def kept(token: str) -> str | None:
    """`atoms::kept`."""
    mapped = synonym(token)
    if mapped is MISSING:
        if blen(token) < 3 and token not in SHORT_TOKENS:
            return None
        mapped = token
    elif mapped is None:
        return None
    skill = mapped in SHORT_TOKENS or (
        mapped not in STOP and any(c.isascii() and c.isalpha() for c in mapped)
    )
    return mapped if skill else None


RULES = [
    ("ungen", "ung"),
    ("heiten", "heit"),
    ("keiten", "keit"),
    ("ies", "y"),
    ("ing", ""),
    ("ern", ""),
    ("en", ""),
    ("er", ""),
    ("es", ""),
    ("ed", ""),
    ("e", ""),
    ("s", ""),
]


def stem_once(word: str) -> str:
    if blen(word) < 5 or not word.isascii():
        return word
    for suffix, replacement in RULES:
        if word.endswith(suffix):
            base = word[: -len(suffix)]
            if suffix == "s" and base[-1:] in ("s", "i", "u"):
                continue
            if blen(base) >= 4:
                return base + replacement
    return word


def stem(word: str) -> str:
    """`atoms::stem`."""
    if "-" in word:
        return "-".join(stem_once(stem_once(p)) for p in word.split("-"))
    return stem_once(stem_once(word))


def feminine(before: str, word: str) -> bool:
    """`word` is the feminine form of `before` ("kundinnen" after "kunden")."""
    if word in ("in", "innen"):
        return True
    common = max(blen(before) - 2, 3)
    return (
        (word.endswith("in") or word.endswith("innen"))
        and blen(before) >= common
        and blen(word) > common
        and word.startswith(before[:common])
    )


def words(token: str, everything: bool = False) -> list[str]:
    """The stemmed words of one kept token: its parts at "/" and "-", a feminine form after
    a slash dropped, a number kept with the part before it ("iso-9001"). `everything` keeps
    the parts the engine drops (to count them)."""
    if "-" not in token and "/" not in token:
        return [stem(token)]
    segments: list[str] = []
    for segment in token.split("/"):
        if segments and feminine(segments[-1], segment):
            continue
        segments.append(segment)
    parts: list[str] = []
    for segment in segments:
        for part in segment.split("-"):
            if part and part.isdigit() and part.isascii() and parts:
                parts[-1] = f"{parts[-1]}-{part}"
            else:
                parts.append(part)
    out = []
    for part in parts:
        k = part if everything else kept(part)
        if k:
            out.append(stem(k))
    return out


def key_words(text: str, everything: bool = False) -> list[str]:
    folded = strip_gender(fold(text))
    split = [p for t in raw_tokens(folded) for p in split_codes(without_knowledge(t))]
    split = [
        t
        for i, t in enumerate(split)
        if not (t == "co" and i + 1 < len(split) and split[i + 1] == "kg")
    ]
    out: list[str] = []
    for token in numbered(split):
        k = token if everything else kept(token)
        if k is not None:
            out.extend(words(k, everything))
    return out


def key(text: str) -> str:
    """`esco::key`: the folded, stemmed words of a text, split by single spaces."""
    return " ".join(key_words(text))


GENERIC_STEMS = {stem(fold(w)) for w in GENERIC}
VAGUE_STEMS = {stem(fold(w)) for w in VAGUE}


def why_not(label: str, k: str) -> str | None:
    """Why a label stays out of the index, or None."""
    parts = k.split(" ") if k else []
    if not parts:
        return "empty"
    if len(parts) > MAX_WORDS:
        return "long"
    if len(parts) == 1:
        if parts[0] in GENERIC_STEMS:
            return "generic"
        # "deep learning", "IT-Trainer", "work in teams": the one word left says less than
        # the label (a version number such as "PHP 7" takes nothing away).
        written = [w for w in key_words(label, everything=True) if not w.isdigit()]
        if len(written) > 1:
            return "shortened"
    if len(parts) == 2 and all(p in VAGUE_STEMS for p in parts):
        return "generic"
    return None


# ------------------------------------------------------------------------------ reading


def open_zip(folder: Path, lang: str) -> tuple[zipfile.ZipFile, str]:
    found = sorted(folder.glob(f"ESCO dataset - v* - classification - {lang} - csv.zip"))
    if not found:
        sys.exit(f"no ESCO {lang} download in {folder}")
    version = re.search(r" - v([0-9.]+) - ", found[-1].name).group(1)
    return zipfile.ZipFile(found[-1]), version


def rows(archive: zipfile.ZipFile, name: str) -> list[dict[str, str]]:
    member = next(n for n in archive.namelist() if n.startswith(name + "_"))
    with archive.open(member) as raw:
        return list(csv.DictReader(io.TextIOWrapper(raw, encoding="utf-8")))


def split_labels(field: str) -> list[str]:
    out = []
    for line in field.replace("|", "\n").split("\n"):
        label = " ".join(line.split())
        if label:
            out.append(label)
    return out


def gender_pair(label: str) -> list[str]:
    """A German label naming both forms ("Leiter Callcenter/Leiterin Callcenter",
    "Metallziehmaschinenbediener/Metallziehmaschinenbedienerin") as its two forms."""
    if label.count("/") != 1:
        return [label]
    left, right = (s.strip() for s in label.split("/"))
    lw, rw = left.split(), right.split()
    if not lw or not rw or len(lw) != len(rw):
        return [label]
    a, b = fold(lw[-1]), fold(rw[-1])
    if a == b or feminine(a, b):
        return [left, right]
    return [label]


def labels_of(row: dict[str, str], lang: str) -> list[tuple[str, bool]]:
    """(label, hidden) in order: preferred, alternative, hidden; no duplicates."""
    seen: set[str] = set()
    out: list[tuple[str, bool]] = []
    fields = [("preferredLabel", False), ("altLabels", False), ("hiddenLabels", True)]
    for field, hidden in fields:
        for label in split_labels(row.get(field, "")):
            for form in gender_pair(label) if lang == "de" else [label]:
                if form not in seen:
                    seen.add(form)
                    out.append((form, hidden))
    return out


def main() -> None:
    given = [a for a in sys.argv[1:] if not a.startswith("-")]
    folder = Path(given[0]) if given else DEFAULT_SOURCE
    de, version = open_zip(folder, "de")
    en, version_en = open_zip(folder, "en")
    if version != version_en:
        sys.exit(f"the downloads differ in version: {version} / {version_en}")

    concepts: dict[str, dict] = {}
    for lang, archive in (("en", en), ("de", de)):
        for name, is_occupation in (("occupations", True), ("skills", False)):
            for row in rows(archive, name):
                if row["status"] != "released":
                    continue
                c = concepts.setdefault(row["conceptUri"], {"labels": {}})
                c["labels"][lang] = labels_of(row, lang)
                if lang == "en":
                    c["occupation"] = is_occupation
                    c["type"] = row.get("skillType", "")
                    c["transversal"] = row.get("reuseLevel", "") == "transversal"
        if lang == "en":
            transversal = {r["conceptUri"] for r in rows(archive, "transversalSkillsCollection")}
            languages = {r["conceptUri"] for r in rows(archive, "languageSkillsCollection")}

    for uri, c in concepts.items():
        if c.get("occupation"):
            c["kind"] = "occupation"
        elif uri in languages:
            c["kind"] = "language"
        elif c.get("type") == "knowledge":
            c["kind"] = "knowledge"
        else:
            c["kind"] = "skill"
        c["transversal"] = c.get("transversal", False) or uri in transversal
        for lang in ("de", "en"):
            c["labels"].setdefault(lang, [])

    order = {"occupation": 0, "skill": 1, "knowledge": 1, "language": 1}

    def preferred(c: dict) -> str:
        for lang in ("en", "de"):
            if c["labels"][lang]:
                return c["labels"][lang][0][0].casefold()
        return ""

    uris = sorted(concepts, key=lambda u: (order[concepts[u]["kind"]], preferred(concepts[u]), u))
    ids = {u: i for i, u in enumerate(uris)}
    if len(uris) > 0xFFFF:
        sys.exit("more than 65535 concepts: esco.rs stores ids as u16")

    # The index.
    index: dict[str, set[int]] = {}
    labels = {"de": 0, "en": 0}
    indexed = {"de": 0, "en": 0}
    left_out: dict[str, dict[str, int]] = {}
    for uri in uris:
        for lang in ("de", "en"):
            for label, _hidden in concepts[uri]["labels"][lang]:
                if "|" in label or "\t" in label or label.startswith("~"):
                    sys.exit(f"label with a separator: {label!r}")
                labels[lang] += 1
                k = key(label)
                reason = why_not(label, k)
                if reason is None:
                    index.setdefault(k, set()).add(ids[uri])
                    indexed[lang] += 1
                else:
                    shown = left_out.setdefault(reason, {})
                    shown[k or label] = shown.get(k or label, 0) + 1

    lines = [f"ESCO {version}"]
    for uri in uris:
        c = concepts[uri]
        lines.append(KINDS[c["kind"]] + ("1" if c["transversal"] else "0"))
    lines.append("=")
    for k in sorted(index, key=lambda s: s.encode("utf-8")):
        lines.append(k + "\t" + ",".join(str(i) for i in sorted(index[k])))
    section_index = "\n".join(lines) + "\n"

    def label_field(entries: list[tuple[str, bool]]) -> str:
        return "|".join(("~" if hidden else "") + label for label, hidden in entries)

    section_labels = "".join(
        label_field(concepts[u]["labels"]["de"]) + "\t" + label_field(concepts[u]["labels"]["en"])
        + "\n"
        for u in uris
    )

    blob = bytearray(b"ESCO" + bytes([FORMAT]))
    sizes = []
    for text in (section_index, section_labels):
        packed = zlib.compress(text.encode("utf-8"), 9)
        sizes.append((len(text.encode("utf-8")), len(packed)))
        blob += struct.pack("<I", len(packed)) + packed
    OUT.write_bytes(bytes(blob))

    kinds: dict[str, int] = {}
    for u in uris:
        kinds[concepts[u]["kind"]] = kinds.get(concepts[u]["kind"], 0) + 1
    print(f"ESCO {version}: {len(uris)} concepts {kinds}, "
          f"{sum(1 for u in uris if concepts[u]['transversal'])} transversal")
    print(f"labels de {labels['de']} en {labels['en']}; indexed de {indexed['de']} "
          f"en {indexed['en']}; left out: "
          + ", ".join(f"{sum(v.values())} {reason}" for reason, v in sorted(left_out.items())))
    print(f"keys {len(index)}")
    for name, (raw, packed) in zip(("index", "labels"), sizes):
        print(f"  {name}: {raw} bytes -> {packed}")
    print(f"{OUT.relative_to(REPO)}: {len(blob)} bytes")
    if "-v" in sys.argv:
        for reason in ("generic", "shortened"):
            top = sorted(left_out.get(reason, {}).items(), key=lambda kv: (-kv[1], kv[0]))
            print(f"{reason}:", ", ".join(f"{k} ({n})" for k, n in top[:300]))


if __name__ == "__main__":
    main()
