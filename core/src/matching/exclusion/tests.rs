use super::*;
use crate::matching::facts::segments;

fn hit(word: &str, text: &str) -> bool {
    found(&fold(text), &Word::new(word))
}

/// The words that exclude with `words` in the profile, and the passages they highlight.
fn excluded(words: &[&str], title: &str, levels: &[&str], text: &str) -> Vec<String> {
    let form = crate::profile::ProfileForm {
        exclusion_words: words.iter().map(|w| (*w).to_owned()).collect(),
        ..crate::profile::ProfileForm::default()
    };
    let criteria = HardCriteria::new(&form);
    let levels: Vec<String> = levels.iter().map(|l| fold(l)).collect();
    check(&criteria, title, &levels, &segments(text), &[])
        .into_iter()
        .map(|f| {
            let marked: Vec<&str> = f.spans.iter().map(|r| &text[r.clone()]).collect();
            format!("{} {:?}", f.params["word"].as_str().unwrap_or(""), marked)
        })
        .collect()
}

#[test]
fn a_word_matches_its_german_forms_and_compounds() {
    for text in [
        "Werkstudent (m/w/d) Controlling",
        "Werkstudentin im Controlling",
        "Wir suchen Werkstudierende für das Controlling",
        "Werkstudenten-Job im Finanzbereich",
        "Eine Werkstudentenstelle mit 20 Stunden",
        "WERKSTUDENT*IN CONTROLLING",
    ] {
        assert!(hit("Werkstudent", text), "{text}");
    }
    assert!(hit("Werkstudentin", "Werkstudent (m/w/d)"));
    assert!(hit("Werkstudierende", "Werkstudent (m/w/d)"));
    assert!(hit("Praktikum", "Pflichtpraktikum im Controlling"));
    assert!(hit("Praktikum", "Praktika im Ausland"));
    assert!(hit("Kaufmann", "Kauffrau für Büromanagement"));
    assert!(hit("Call Center", "Agent im Callcenter"));
    assert!(hit("Call Center", "Call-Center Agent"));
    assert!(hit(
        "Abschlussarbeit",
        "Bachelor-Abschlussarbeit im Controlling"
    ));
}

#[test]
fn a_word_stays_a_word() {
    assert!(!hit(
        "Werkstudent",
        "Studierende der Wirtschaftswissenschaften"
    ));
    assert!(!hit("Praktikum", "Praktiker mit Erfahrung"));
    assert!(!hit("Agent", "ein international agierender Konzern"));
    assert!(!hit("Pflege", "Stammdatenpflege in SAP"));
    assert!(!hit("IT", "Wir bieten Zeit für Weiterbildung"));
    assert!(hit("IT", "IT-Leiter (m/w/d)"));
}

/// E16-2: a generated form (`-um` as `-a`, the participle, `-frau`, `-leute`) matches
/// only as a word with its inflections, never as the start of another word; `Praktikum`
/// and `Praktikant` are one family.
#[test]
fn e16_2_generated_forms_are_whole_words() {
    for (word, text) in [
        (
            "Praktikum",
            "Sie entwickeln pragmatische und praktikable Lösungen",
        ),
        (
            "Praktikum",
            "Bewertung der Maßnahmen auf Wirkung und Praktikabilität",
        ),
        ("Praktikum", "ein praktikabel umsetzbares Konzept"),
        ("Zentrum", "Sie übernehmen eine zentrale Rolle"),
        ("Zentrum", "Zentralisierung der Buchhaltung"),
        ("Ministerium", "ministeriale Abstimmung"),
    ] {
        assert!(!hit(word, text), "{word}: {text}");
    }
    for (word, text) in [
        ("Praktikum", "Praktikant (m/w/d) im Controlling"),
        ("Praktikum", "Praktikantin Controlling"),
        ("Praktikum", "Wir suchen Praktikanten"),
        ("Praktikum", "Praktikantenstelle im Einkauf"),
        ("Praktikum", "mehrere Pflichtpraktika"),
        ("Praktikum", "im Rahmen eines Pflichtpraktikums"),
        ("Praktikum", "Praktika im Ausland"),
        ("Praktikant", "Praktikum (m/w/d) im Controlling"),
        ("Praktikantin", "Pflichtpraktikum im Finanzbereich"),
        ("Kaufmann", "Kauffrauen und Kaufleuten"),
        ("Werkstudent", "Wir suchen Werkstudierende"),
        ("Werkstudent", "Werkstudierenden-Stelle"),
        ("Aushilfe", "Wir suchen Aushilfen"),
        ("Zentrum", "im Zentrum der Stadt"),
    ] {
        assert!(hit(word, text), "{word}: {text}");
    }
}

/// E16-1: a position word excludes where it names the job itself (the title, the page's
/// level, a sentence that states the offered role), never in a passing mention; the
/// reason highlights the deciding sentence.
#[test]
fn e16_1_a_position_word_excludes_only_as_the_offered_role() {
    const CFO: &str = "Interim CFO (m/w/d) Mittelstand";
    let words = ["Werkstudent", "Praktikum", "Junior", "Ausbildung"];
    // Passing mentions in the ad of a senior role: no exclusion.
    for text in [
        "- Sie führen ein Team von acht Mitarbeitenden inkl. zwei Werkstudenten",
        "- Betreuung von Praktikanten im Finanzbereich",
        "- Erfahrung in der Ausbildung von Werkstudierenden wünschenswert",
        "- Personalverantwortung inkl. Praktikumsbetreuung",
        "Wir bieten jedes Jahr Praktika und Werkstudentenstellen an.",
        "Wir sind Ausbildungsbetrieb.",
        "- Coach two junior data engineers",
        "- Mentoring von zwei Junior-Kolleginnen",
        "- dokumentation + handover to inhouse team (2 ppl, junior)",
        "(Personalbetreuung, Entgeltabrechnung, Ausbildung, Personalentwicklung)",
        "- Ausbildung und Personalentwicklung",
        "Abgeschlossenes Studium (BWL) oder kaufmännische Ausbildung",
        "Wir erwarten eine abgeschlossene Ausbildung zum/zur Bilanzbuchhalter:in bzw. ein \
             einschlägiges Studium.",
        "Ihr Ansprechpartner für Werkstudenten und Praktikanten ist Herr Muster.",
        "Unser Team besteht aus fünf Controllern und zwei Werkstudentinnen.",
        "Sie leiten die Werkstudenten im Team an und betreuen unsere Praktikant*innen.",
        "Die Stelle ist keine Junior-Position.",
        "Praktika im Ausland sind möglich.",
    ] {
        assert_eq!(
            excluded(&words, CFO, &[], text),
            Vec::<String>::new(),
            "{text}"
        );
    }
    // The offered role: decided, with the sentence that states it.
    for (text, word) in [
        (
            "Wir suchen eine/n Werkstudent/in (m/w/d) für das Controlling.",
            "Werkstudent",
        ),
        ("Pflichtpraktikum im Finanzbereich (m/w/d)", "Praktikum"),
        ("Praktikum im Finanzbereich", "Praktikum"),
        ("Werkstudent Controlling gesucht", "Werkstudent"),
        (
            "Wir suchen ab sofort einen Praktikanten für das Controlling.",
            "Praktikum",
        ),
        (
            "Zur Verstärkung suchen wir Unterstützung für eine Werkstudententätigkeit im \
                 Controlling.",
            "Werkstudent",
        ),
        (
            "Die Stelle als Werkstudent umfasst 20 Stunden pro Woche.",
            "Werkstudent",
        ),
        ("Position: Praktikum", "Praktikum"),
        (
            "Im Rahmen eines Pflichtpraktikums lernst du das Controlling kennen.",
            "Praktikum",
        ),
        ("Unser Team sucht einen Junior Controller.", "Junior"),
        ("Ausbildung zum Industriekaufmann (m/w/d)", "Ausbildung"),
        ("We are looking for a junior controller.", "Junior"),
    ] {
        let found = excluded(&words, CFO, &[], text);
        assert_eq!(found, [format!("{word} [{text:?}]")], "{text}");
    }
    // The title and the page's level decide on their own.
    assert_eq!(
        excluded(&words, "Werkstudent Controlling (m/w/d)", &[], "Aufgaben"),
        ["Werkstudent []"]
    );
    assert_eq!(
        excluded(&words, "Controlling (m/w/d)", &["Praktikum"], "Aufgaben"),
        ["Praktikum []"]
    );
    // A mention next to the role statement is no highlight.
    let text = "Wir suchen eine/n Praktikant/in (m/w/d).\n- Betreuung von Werkstudenten";
    assert_eq!(
        excluded(&["Praktikum", "Werkstudent"], CFO, &[], text),
        ["Praktikum [\"Wir suchen eine/n Praktikant/in (m/w/d).\"]"]
    );
}

/// E16-1: a condition word (`Provisionsbasis`, `Rufbereitschaft`, `Callcenter`) excludes in
/// any sentence of the ad, unless denied, about the team, the company or supervising
/// others, or a requirement of experience.
#[test]
fn e16_1_a_condition_word_excludes_unless_it_is_a_passing_mention() {
    const TITLE: &str = "Senior Consultant (m/w/d)";
    for (word, text) in [
        ("Provisionsbasis", "Honorar: auf Provisionsbasis"),
        (
            "Rufbereitschaft",
            "- Teilnahme an der Rufbereitschaft (eine Woche pro Monat)",
        ),
        ("Call Center", "Einsatz im Callcenter"),
        ("Schichtdienst", "Die Arbeit erfolgt im Schichtdienst."),
    ] {
        assert_eq!(
            excluded(&[word], TITLE, &[], text),
            [format!("{word} [{text:?}]")],
            "{text}"
        );
    }
    for (word, text) in [
        (
            "Schichtdienst",
            "Kein Schichtdienst, keine Rufbereitschaft.",
        ),
        (
            "Außendienst",
            "Ein Lebensversicherer mit rund 1.600 Mitarbeitenden im Innen- und Außendienst.",
        ),
        (
            "Außendienst",
            "- Durchführung von Präsenztrainings für den technischen Außendienst",
        ),
        (
            "Schichtdienst",
            "- Personaleinsatzplanung für den Schichtdienst",
        ),
        (
            "Schichtdienst",
            "- Leitung eines Teams mit elf Mitarbeitenden im Schichtdienst",
        ),
        ("Außendienst", "- Erfahrung im Außendienst von Vorteil"),
        (
            "Schichtdienst",
            "- Führungserfahrung, idealerweise in einem Umfeld mit Schichtdienst",
        ),
    ] {
        assert_eq!(
            excluded(&[word], TITLE, &[], text),
            Vec::<String>::new(),
            "{text}"
        );
    }
}
