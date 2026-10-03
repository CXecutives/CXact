//! The prompt a user hands to an AI together with a CV ("Prompt kopieren" on the start page
//! of a new profile): the AI hands over a profile in exactly the JSON the editor reads, as a
//! file to download (or, where it makes no files, alone in one code block to save as one),
//! which the user loads with "Datei hochladen" (user decision 2026-10-01; [`super::answer`]
//! finds the profile in a whole answer saved as the file too). Like the app's other prompts it addresses the assistant as "du" without
//! naming a product; the JSON keys and the fixed values are the profile format.
//!
//! It stands on its own for an AI that has never seen the app: it says so first, then how to
//! go about it (ask the user in one short message for what the CV cannot say but the matching
//! needs most, each question may be skipped), and explains every key the editor reads. The
//! rules follow the engine: short terms (a sentence proves no requirement), only true synonyms
//! in `auch` (an alias counts as the competence), years from the CV's dates (the text says what
//! day it is), Schwerpunkte that are competences, target roles with a field, and wishes and
//! exclusion criteria only where the user or the CV states them (a wrong one costs points or
//! excludes good jobs).
//!
//! external contract - do not translate: the German text and the profile JSON keys it names
//! (the tests check that every key of the skeleton is explained and that the editor reads it).

use jiff::civil::Date;

/// The keys the AI fills, in the order the app writes them: the ones a CV fills, the career
/// stations (read by the engine, kept in the file), the wishes and the hard criteria (in the
/// order of the form's criteria).
const SKELETON: &str = r#"{
  "name": "",
  "titel": "",
  "wunschrollen": [],
  "berufserfahrung_jahre": null,
  "ausbildung": [
    { "abschluss": "" }
  ],
  "kernkompetenzen": [
    { "kompetenz": "", "jahre": null, "auch": [] }
  ],
  "schwerpunkte": [],
  "methoden_tools": [
    { "name": "" }
  ],
  "zertifizierungen": [
    { "name": "" }
  ],
  "branchen": [
    { "branche": "" }
  ],
  "sprachen": [
    { "sprache": "", "niveau": "" }
  ],
  "alleinstellungsmerkmale": [],
  "keywords": [],
  "stationen": [
    { "zeitraum": "", "rolle": "", "schwerpunkte": [] }
  ],
  "einsatzpraeferenzen": {
    "tagessatz_wunsch": null,
    "remote": "",
    "regionen": [],
    "branchen": []
  },
  "harte_kriterien": {
    "min_tagessatz": null,
    "laender": [],
    "ausgeschlossene_vertragsarten": [],
    "verfuegbar_ab": "",
    "remote_ausserhalb_erlaubt": null,
    "min_jahresgehalt": null,
    "festanstellung_orte": [],
    "festanstellung_remote_min": null,
    "auslastung_min_tage": null,
    "auslastung_max_tage": null,
    "min_laufzeit_monate": null,
    "ausschlusswoerter": []
  }
}"#;

/// The skeleton the AI fills.
pub(crate) fn skeleton() -> String {
    SKELETON.to_owned()
}

const INTRO: &str = "Du unterstützt mich als KI-Assistent bei meinem Beraterprofil. Du kennst meine Job-Alert-App nicht; alles, was du über das Profil und sein Format wissen musst, folgt in diesem Text. Die App vergleicht jede Stellenanzeige Begriff für Begriff mit meinem Profil; je genauer es meinen Lebenslauf und meine Wünsche wiedergibt, desto besser findet sie passende Projekte und Stellen. Bitte erstelle das Profil aus meinem angehängten Lebenslauf; fehlt er, bitte mich zuerst darum.";

const STEPS: &str = "Der Ablauf
1. Lies zuerst den ganzen Lebenslauf.
2. Frag mich dann in einer einzigen kurzen Nachricht nach dem, was die App für den Vergleich am meisten braucht, der Lebenslauf aber nicht sagt. Frag nur nach dem, was dort nicht schon steht.
- die Rollen, für die ich gebucht werden will (schlag mir die aus dem Lebenslauf zur Bestätigung vor)
- mein Mindesttagessatz und mein Wunschtagessatz, für Festanstellungen das Mindestjahresgehalt und die Orte
- der Remote-Anteil, den ich mir wünsche
- Regionen oder Länder, in denen ich arbeiten will
- Vertragsarten, die ich ausschließe, etwa Arbeitnehmerüberlassung oder Festanstellung
- ab wann ich verfügbar bin
- wie viele Tage pro Woche ich arbeiten will
- die kürzeste Laufzeit eines Einsatzes, die ich annehme
- Wörter, die eine Anzeige für mich ausschließen
3. Ich kann jede Frage überspringen; was ich nicht beantworte, bleibt leer.
4. Schreib das Profil erst nach meiner Antwort, nach den Regeln unten, und gib es so aus, wie „Die Antwort“ es beschreibt.";

/// `{today}` is replaced with the day the app writes the prompt.
const PRINCIPLES: &str = "Grundsätze
1. Für alles, was aus dem Lebenslauf kommt, ist er die einzige Quelle. Übernimm nur, was dort steht oder direkt daraus folgt; erfinde, schätze und ergänze nichts.
2. Wünsche und Ausschlusskriterien stammen aus meiner Antwort auf deine Fragen, aus dem Lebenslauf nur, wo er sie ausdrücklich nennt.
3. Was weder der Lebenslauf noch ich sagen, bleibt leer, Text als \"\", Listen als [] und Zahlen oder Ja-Nein-Werte als null. Leere Felder fülle ich selbst in der App.
4. Jahre rechnest du aus den Daten des Lebenslaufs in ganzen Jahren, abgerundet; Zeiträume, die sich überschneiden, zählen einmal. Heute ist der {today}.
5. Schreib Begriffe kurz und so, wie Stellenanzeigen sie schreiben; Sprachen, Branchen und Sätze auf Deutsch.
6. Keine Kontaktdaten, keine Adresse, kein Geburtsdatum, kein Familienstand und keine Namen von Arbeitgebern oder Kunden.";

const FIELDS: &str = "Die Felder
- name ist mein Vor- und Nachname.
- titel ist meine berufliche Rolle in zwei bis fünf Wörtern, wie sie über einer passenden Anzeige stehen könnte, etwa Interim CFO, IT-Programmmanager oder Entwicklungsingenieur Elektronik. Kein Abschluss und kein Satz.
- wunschrollen sind zwei bis sechs Rollen, für die ich gebucht werden will, so wie ich sie bestätigt oder genannt habe, sonst so, wie der Lebenslauf sie zeigt, jede mit ihrem Fachgebiet, etwa Head of Controlling oder Projektleiter Inbetriebnahme. Interim Manager, Berater oder Freelancer allein nennen kein Fachgebiet. Nennen Anzeigen eine Rolle deutsch und englisch, nimm beide Formen auf.
- berufserfahrung_jahre zählt vom Beginn der ersten beruflichen Station bis heute, ohne Ausbildung, Studium, Praktika und Lücken. Nennt der Lebenslauf die Zahl selbst, gilt sie.
- ausbildung enthält je Abschluss ein Objekt. abschluss nennt die Art ausgeschrieben (Bachelor, Master, Diplom, Magister, Staatsexamen, Promotion, MBA oder eine Berufsausbildung) und das Fach, dazu (FH), (Univ.) oder (BA), wenn der Lebenslauf das sagt, etwa Diplom-Ingenieur (FH) Maschinenbau, Master of Science Wirtschaftsinformatik oder Industriekaufmann (IHK). Keine Schulabschlüsse.
- kernkompetenzen sind zehn bis zwanzig fachliche Kompetenzen, soweit der Lebenslauf sie belegt, die wichtigsten zuerst, je ein Objekt mit kompetenz, jahre und auch. kompetenz ist ein Begriff aus einem bis vier Wörtern, etwa Konzerncontrolling, Anforderungsmanagement oder Konstruktion; nichts so Allgemeines wie Management, keine Werkzeuge wie SAP (die gehören zu methoden_tools) und keine Sätze.
- jahre einer Kompetenz sind die Jahre der Stationen, in denen der Lebenslauf sie nennt; ohne solche Stationen bleibt jahre null.
- auch sind andere Begriffe, unter denen Anzeigen genau diese Kompetenz suchen, vor allem die englische oder deutsche Entsprechung, etwa Requirements Engineering zu Anforderungsmanagement. Keine Ober- oder Unterbegriffe und keine verwandten Themen, denn die App wertet jeden Begriff in auch wie die Kompetenz selbst.
- schwerpunkte sind drei bis fünf der kernkompetenzen, für die ich vor allem gebucht werden will, erkennbar an Profiltext und jüngsten Stationen. Schreib jeden Schwerpunkt genau so wie in kernkompetenzen.
- methoden_tools sind Software, Systeme, Programmiersprachen und Methoden, je ein Objekt mit name, so genau wie im Lebenslauf, etwa SAP S/4HANA FI, Power BI, Python, Scrum oder FMEA.
- zertifizierungen sind erworbene Zertifikate und Zulassungen unter ihrem gängigen Namen, je ein Objekt mit name, etwa PMP, PRINCE2 Practitioner oder ITIL 4 Foundation. Keine Schulungen ohne Abschluss.
- branchen sind die Branchen meiner Stationen, je ein Objekt mit branche, etwa Automobilindustrie, Banken oder Pharma. Keine Funktionen wie Controlling und keine Firmennamen.
- sprachen enthält jede Sprache mit sprache und niveau. niveau ist \"A1\", \"A2\", \"B1\", \"B2\", \"C1\", \"C2\" oder \"Muttersprache\"; verhandlungssicher, fließend und sehr gut werden \"C1\", gut wird \"B2\", Grundkenntnisse werden \"A2\". Ohne Angabe im Lebenslauf bleibt niveau leer.
- alleinstellungsmerkmale sind bis zu fünf kurze Sätze darüber, was mich laut Lebenslauf von anderen abhebt, jeder mit einem Beleg von dort, etwa „Leitete drei Werksanläufe bis zum Serienstart.“ Zahlen nur, wenn sie im Lebenslauf stehen, und keine Floskeln wie teamfähig oder motiviert.
- keywords sind fünf bis zwanzig weitere Fachbegriffe aus dem Lebenslauf, die in passenden Anzeigen stehen und oben noch fehlen, etwa Normen, Regelwerke und Verfahren wie IFRS 16, ISO 26262 oder GMP.
- stationen enthält jede berufliche Station als Objekt, die jüngste zuerst. zeitraum schreibst du wie 03/2021 bis 06/2024 oder 03/2021 bis heute, rolle als Funktion ohne Firmennamen und schwerpunkte als zwei bis sechs fachliche Themen, die der Lebenslauf für die Station nennt, kurz wie Kompetenzen.";

const SETTINGS: &str = "Wünsche und Ausschlusskriterien
Die Felder unter einsatzpraeferenzen und harte_kriterien füllst du aus meiner Antwort auf deine Fragen, aus dem Lebenslauf nur, wo er sie ausdrücklich nennt; sonst bleiben sie leer. Ein falscher Wert kostet passende Jobs Punkte oder schließt sie aus. Die drei Felder für Festanstellungen bleiben leer, wenn ich Festanstellungen ausschließe. Tagessätze sind Euro pro Tag, ein Stundensatz zählt mal acht; Gehälter sind Euro brutto im Jahr.
- tagessatz_wunsch ist mein Wunschtagessatz; nennt der Lebenslauf nur einen Tagessatz, ist er ein Wunsch, keine Untergrenze.
- remote ist \"voll\" (nur remote), \"ueberwiegend\" (mehr als die Hälfte), \"teilweise\" (bis zur Hälfte) oder \"vor_ort\" (kein Remote).
- regionen sind Orte oder Regionen, in denen ich arbeiten will, etwa Hamburg oder Rhein-Main.
- branchen unter einsatzpraeferenzen sind Branchen, in denen ich künftig arbeiten will, nicht einfach die bisherigen.
- min_tagessatz ist ein Tagessatz, unter dem ich ausdrücklich nicht arbeite.
- laender sind Ländercodes wie \"DE\", \"AT\" und \"CH\", wenn ich Einsätze auf diese Länder beschränke.
- ausgeschlossene_vertragsarten nennt \"anue\", wenn ich Arbeitnehmerüberlassung ausschließe, und \"festanstellung\", wenn ich keine Festanstellung will.
- verfuegbar_ab ist \"sofort\" oder ein Datum wie \"01.11.2026\"; ein Monat ohne Tag wird zum Ersten des Monats.
- remote_ausserhalb_erlaubt ist false, wenn ich neben laender auch reine Remote-Einsätze für Auftraggeber in anderen Ländern ausschließe, und true, wenn sie mir recht sind; ohne Angabe bleibt es null.
- min_jahresgehalt ist das Jahresgehalt, unter dem ich keine Festanstellung annehme.
- festanstellung_orte sind die Orte, an denen ich eine Festanstellung annehme, etwa Hamburg oder München.
- festanstellung_remote_min ist der Remote-Anteil in Prozent von 1 bis 100, ab dem mir eine Festanstellung außerhalb dieser Orte recht ist.
- auslastung_min_tage und auslastung_max_tage sind die Tage pro Woche von 1 bis 5, die ich mindestens und höchstens arbeiten will.
- min_laufzeit_monate ist die kürzeste Laufzeit eines Einsatzes in Monaten, die ich annehme.
- ausschlusswoerter sind Wörter, die eine Anzeige für mich ausschließen, etwa Werkstudent oder Praktikum.";

const ANSWER: &str = "Die Antwort
Gib mir das fertige Profil als Datei profil.json zum Herunterladen. Kannst du keine Datei erstellen, schreib das JSON allein in einen einzigen Codeblock, den ich als profil.json speichere. Schreib danach in einem Satz, dass ich die Datei in der App unter Profil mit „Neues Profil“ und „Datei hochladen“ lade, und sonst nichts. Das JSON behält jeden Schlüssel des Aufbaus unten, seine Schreibweise und die Reihenfolge. Ein Objekt in einer Liste zeigt den Aufbau eines Eintrags; wiederhole es für jeden Eintrag. Zahlen stehen ohne Anführungszeichen und ohne Einheit. Das JSON muss gültig sein, mit geraden doppelten Anführungszeichen, ohne Kommentare und ohne Komma vor einer schließenden Klammer.";

const CHECK: &str = "Prüfe vor dem Antworten";
const CHECKS: [&str; 6] = [
    "Steht jeder Wert aus dem Lebenslauf dort oder folgt direkt aus ihm?",
    "Ist jede Kompetenz ein kurzer Begriff, und meint jeder Begriff in auch genau diese Kompetenz?",
    "Steht jeder Schwerpunkt genau so in kernkompetenzen, und nennt jede Wunschrolle ein Fachgebiet?",
    "Stammen alle Jahre aus den Daten des Lebenslaufs?",
    "Stammen Wünsche und Ausschlusskriterien aus meiner Antwort oder ausdrücklich aus dem Lebenslauf, und sind sie sonst leer?",
    "Ist das JSON gültig, hat es genau die Schlüssel des Aufbaus, und steht es allein in einem einzigen Codeblock?",
];

const STRUCTURE: &str = "Der Aufbau";

const MONTHS: [&str; 12] = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
];

/// `25. September 2026`.
fn german_day(day: Date) -> String {
    let month = usize::try_from(day.month() - 1).unwrap_or(0);
    format!("{}. {} {}", day.day(), MONTHS[month], day.year())
}

/// The whole prompt: the task (the AI does not know the app), the steps (the questions
/// first), the principles (with `today`), the rule of every field, the wishes and exclusion
/// criteria, the answer wanted and the checks before it; then the skeleton in a JSON code
/// block.
pub fn text(today: Date) -> String {
    let checks: Vec<String> = CHECKS
        .iter()
        .enumerate()
        .map(|(i, check)| format!("{}. {check}", i + 1))
        .collect();
    let parts = [
        INTRO.to_owned(),
        STEPS.to_owned(),
        PRINCIPLES.replace("{today}", &german_day(today)),
        FIELDS.to_owned(),
        SETTINGS.to_owned(),
        ANSWER.to_owned(),
        format!("{CHECK}\n{}", checks.join("\n")),
        format!("{STRUCTURE}\n```json\n{}\n```", skeleton()),
    ];
    let mut text = parts.join("\n\n");
    text.push('\n');
    text
}

#[cfg(test)]
mod tests {
    use super::super::form::{self, ProfileForm};
    use super::super::json::Json;
    use super::*;
    use crate::matching::{self, ProfileWarningCode};

    /// The skeleton filled the way an AI would answer (same keys, same order).
    const FILLED: &str = r#"{
  "name": "Erika Beispiel",
  "titel": "Interim CFO",
  "wunschrollen": ["Interim CFO"],
  "berufserfahrung_jahre": 20,
  "ausbildung": [
    { "abschluss": "Diplom-Kauffrau" }
  ],
  "kernkompetenzen": [
    { "kompetenz": "Controlling", "jahre": 12, "auch": ["FP&A"] }
  ],
  "schwerpunkte": ["Controlling"],
  "methoden_tools": [
    { "name": "SAP" }
  ],
  "zertifizierungen": [
    { "name": "PMP" }
  ],
  "branchen": [
    { "branche": "Chemie" }
  ],
  "sprachen": [
    { "sprache": "Englisch", "niveau": "C1" }
  ],
  "alleinstellungsmerkmale": ["Schnell"],
  "keywords": ["IFRS"],
  "stationen": [
    { "zeitraum": "2012 - heute", "rolle": "Interim CFO", "schwerpunkte": ["Restrukturierung"] }
  ],
  "einsatzpraeferenzen": {
    "tagessatz_wunsch": 1200,
    "remote": "ueberwiegend",
    "regionen": ["Hamburg"],
    "branchen": ["Chemie"]
  },
  "harte_kriterien": {
    "min_tagessatz": 1000,
    "laender": ["DE"],
    "ausgeschlossene_vertragsarten": ["anue"],
    "verfuegbar_ab": "sofort",
    "remote_ausserhalb_erlaubt": false,
    "min_jahresgehalt": 120000,
    "festanstellung_orte": ["Hamburg"],
    "festanstellung_remote_min": 60,
    "auslastung_min_tage": 3,
    "auslastung_max_tage": 5,
    "min_laufzeit_monate": 6,
    "ausschlusswoerter": ["Werkstudent"]
  }
}"#;

    fn day() -> Date {
        Date::new(2026, 9, 25).unwrap()
    }

    /// The keys of a document in order, the items of a list by its first one.
    fn shape(value: &Json) -> String {
        match value {
            Json::Object(entries) => entries
                .iter()
                .map(|(key, child)| format!("{key}{{{}}}", shape(child)))
                .collect::<Vec<_>>()
                .join(","),
            Json::Array(items) => items.first().map(shape).unwrap_or_default(),
            _ => String::new(),
        }
    }

    fn keys(doc: &Json) -> Vec<String> {
        match doc {
            Json::Object(entries) => entries.iter().map(|(k, _)| k.clone()).collect(),
            _ => Vec::new(),
        }
    }

    /// Every key of a document, nested ones too, each once.
    fn all_keys(value: &Json, out: &mut Vec<String>) {
        match value {
            Json::Object(entries) => {
                for (key, child) in entries {
                    if !out.contains(key) {
                        out.push(key.clone());
                    }
                    all_keys(child, out);
                }
            }
            Json::Array(items) => items.iter().for_each(|item| all_keys(item, out)),
            _ => {}
        }
    }

    /// The rules of a prompt: everything before its JSON code blocks.
    fn rules(text: &str) -> &str {
        &text[..text.find("```json").unwrap()]
    }

    /// `word` stands in `text` as a word of its own (keys contain `_`).
    fn names(text: &str, word: &str) -> bool {
        text.match_indices(word).any(|(at, _)| {
            let before = text[..at].chars().next_back();
            let after = text[at + word.len()..].chars().next();
            let apart = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric() && c != '_');
            apart(before) && apart(after)
        })
    }

    /// Every key of the skeleton is one the editor or the engine reads, and every field the
    /// editor reads has its key there: the filled skeleton fills every field of the form (a
    /// field the form gains later fails here until the skeleton names it), its stations (kept
    /// in the file, the form does not show them) give the engine terms, and writing the form
    /// into an empty profile gives back the keys of the skeleton but the stations, the wishes
    /// and the criteria in the skeleton's order.
    #[test]
    fn the_skeleton_names_exactly_the_keys_of_the_form() {
        let skeleton: Json = serde_json::from_str(&skeleton()).unwrap();
        let doc: Json = serde_json::from_str(FILLED).unwrap();
        assert_eq!(
            shape(&doc),
            shape(&skeleton),
            "the answer keeps the skeleton"
        );
        let read = form::read(&doc);
        assert!(!read.competences[0].aliases.is_empty(), "auch");
        assert!(read.languages[0].level.is_some(), "niveau");
        let filled = serde_json::to_value(&read).unwrap();
        let empty = serde_json::to_value(ProfileForm::default()).unwrap();
        for (field, value) in filled.as_object().unwrap() {
            let nested = matches!(field.as_str(), "wishes" | "criteria");
            if !nested {
                assert_ne!(value, &empty[field], "{field} not read from the skeleton");
                continue;
            }
            for (inner, value) in value.as_object().unwrap() {
                // Permanent employment is excluded under the key that excludes ANÜ.
                if inner == "noPermanent" {
                    continue;
                }
                assert_ne!(
                    value, &empty[field][inner],
                    "{field}.{inner} not read from the skeleton"
                );
            }
        }
        let summary = matching::compile_profile(&doc.to_value()).summary().clone();
        assert!(
            summary
                .sources
                .iter()
                .any(|s| s.path.starts_with("stationen[]")),
            "{:?}",
            summary.sources
        );
        assert!(summary.warnings.is_empty(), "{:?}", summary.warnings);

        // Two degrees go into `ausbildung`, as the skeleton has them.
        let mut form = read.clone();
        form.degrees.push("MBA".into());
        // Untouched search terms follow the roles and are not written.
        form.search_terms.clear();
        let mut written = Json::object();
        form::merge(&mut written, &ProfileForm::default(), &form, &[]);
        let mut expected = keys(&skeleton);
        expected.retain(|key| key != "stationen");
        assert_eq!(keys(&written), expected);
        for section in ["einsatzpraeferenzen", "harte_kriterien"] {
            assert_eq!(
                keys(written.get(section).unwrap()),
                keys(skeleton.get(section).unwrap()),
                "{section}"
            );
        }
        // The minimum years an ad asked for are retired: no rule asks for them.
        let mut all = Vec::new();
        all_keys(&skeleton, &mut all);
        assert!(
            !all.iter().any(|key| key.starts_with("zielprofil")),
            "{all:?}"
        );
    }

    /// The answer of the AI reads like a chosen file: what it leaves as in the skeleton
    /// is dropped (the unfilled skeleton is an empty profile, a partly filled one leaves no
    /// empty criterion the app cannot read), and the filled skeleton comes back as it is, also
    /// inside a code block with a sentence after it.
    #[test]
    fn the_file_of_the_answer_loads_without_empty_keys() {
        let draft = super::super::draft_from_text(&skeleton()).unwrap();
        assert_eq!(draft.form, ProfileForm::default());
        assert_eq!(draft.source, "{}");
        let answer = skeleton().replacen("\"name\": \"\"", "\"name\": \"Erika Beispiel\"", 1);
        let draft = super::super::draft_from_text(&answer).unwrap();
        assert_eq!(draft.source, "{\n  \"name\": \"Erika Beispiel\"\n}");
        assert!(
            !draft
                .summary
                .warnings
                .iter()
                .any(|w| w.code == ProfileWarningCode::CriterionNotUnderstood),
            "{:?}",
            draft.summary.warnings
        );
        for text in [
            FILLED.to_owned(),
            format!("```json\n{FILLED}\n```\nLade die Datei mit „Datei hochladen“."),
        ] {
            assert_eq!(super::super::draft_from_text(&text).unwrap().source, FILLED);
        }
    }

    /// Every key of the skeleton has its rule before the code blocks, and so has every fixed
    /// value the form reads.
    #[test]
    fn every_key_of_the_skeleton_is_explained() {
        let text = text(day());
        let skeleton: Json = serde_json::from_str(&skeleton()).unwrap();
        let mut keys = Vec::new();
        all_keys(&skeleton, &mut keys);
        for key in &keys {
            assert!(names(rules(&text), key), "{key}");
        }
        for value in [
            "Muttersprache",
            "C1",
            "B2",
            "A2",
            "voll",
            "ueberwiegend",
            "teilweise",
            "vor_ort",
            "anue",
            "festanstellung",
            "sofort",
        ] {
            assert!(text.contains(&format!("\"{value}\"")), "{value}");
        }
        for word in ["true", "false", "null"] {
            assert!(names(rules(&text), word), "{word}");
        }
    }

    /// The prompt says first that the AI does not know the app, has it ask for what the CV
    /// cannot say before it writes, says which day it is, asks for the file the app loads
    /// (naming the view and the button as the interface does) and ends with the skeleton in a
    /// code block; it reads like the app's other prompts.
    #[test]
    fn the_text_asks_first_and_ends_with_the_skeleton() {
        let german = text(day());
        assert!(german.starts_with(
            "Du unterstützt mich als KI-Assistent bei meinem Beraterprofil. Du kennst meine \
             Job-Alert-App nicht;"
        ));
        assert!(german.contains("in einer einzigen kurzen Nachricht"));
        assert!(german.contains("Ich kann jede Frage überspringen"));
        assert!(german.contains("Heute ist der 25. September 2026."));
        assert!(german.contains("als Datei profil.json zum Herunterladen"));
        assert!(german.contains("unter Profil mit „Neues Profil“ und „Datei hochladen“"));
        assert!(german.ends_with(&format!("Der Aufbau\n```json\n{}\n```\n", skeleton())));
        let march = Date::new(2027, 3, 1).unwrap();
        assert!(text(march).contains("Heute ist der 1. März 2027."));
        // The questions come before the rules of the fields.
        assert!(german.find("Der Ablauf").unwrap() < german.find("Die Felder").unwrap());
        // The view and the button as the interface names them.
        let catalog = include_str!("../../../ui/src/lib/i18n/de.ts");
        for name in [
            "profile: 'Profil'",
            "newProfile: 'Neues Profil'",
            "pickFile: 'Datei hochladen'",
        ] {
            assert!(catalog.contains(name), "{name}");
        }
        // No dash as a separator, no product named.
        for word in [
            "\u{2013}", "\u{2014}", "Claude", "ChatGPT", "Gemini", "Copilot",
        ] {
            assert!(!german.contains(word), "{word}");
        }
        for word in ["the", "and", "you", "your", "with"] {
            assert!(!names(rules(&german), word), "{word}");
        }
    }
}
