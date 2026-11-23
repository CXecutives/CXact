use super::*;

fn heading(line: &str) -> Option<HeadingKind> {
    match classify(line, false, None) {
        Line::Heading(kind) => Some(kind),
        _ => None,
    }
}

#[test]
fn headings() {
    assert_eq!(heading("Anforderungen:"), Some(HeadingKind::Must));
    assert_eq!(heading("2) Wünschenswert"), Some(HeadingKind::Nice));
    assert_eq!(heading("Ihre Qualifikation"), Some(HeadingKind::Must));
    assert_eq!(heading("Über uns"), Some(HeadingKind::Neutral));
    assert_eq!(norm_heading("• 1. Ihr Profil："), "ihr profil");
}

#[test]
fn new_headings_and_lead_words() {
    for (line, kind) in [
        ("Qualifikation", HeadingKind::Must),
        ("Anforderungen", HeadingKind::Must),
        ("Muss-Anforderungen", HeadingKind::Must),
        ("Profile", HeadingKind::Must),
        ("Requirements", HeadingKind::Must),
        ("Aufgaben", HeadingKind::Task),
        ("Hauptaufgaben", HeadingKind::Task),
        ("Responsibilities", HeadingKind::Task),
        ("Key Responsibilities", HeadingKind::Task),
        ("Ihre Qualifikation", HeadingKind::Must),
        ("Unsere Aufgaben", HeadingKind::Task),
        ("Meine Anforderungen", HeadingKind::Must),
        ("Core Requirements", HeadingKind::Must),
        ("Your Profile", HeadingKind::Must),
        ("Main Responsibilities", HeadingKind::Task),
    ] {
        assert_eq!(heading(line), Some(kind), "{line}");
    }
    assert_eq!(heading("Ihre Reise"), None);
    assert_eq!(heading("Key"), None);
}

/// A task heading is a task heading, never the end of the ad (`Ihre Aufgaben`, `What you'll
/// do`); `About you` and `Skills & Experience` ask for the profile; a spelled umlaut reads as
/// the umlaut; frame conditions are no tasks.
#[test]
fn task_profile_and_frame_headings() {
    for (line, kind) in [
        ("Ihre Aufgaben", HeadingKind::Task),
        ("Deine Aufgaben:", HeadingKind::Task),
        ("Your Responsibilities", HeadingKind::Task),
        ("What you'll do", HeadingKind::Task),
        ("What you’ll do", HeadingKind::Task),
        ("Projektbeschreibung", HeadingKind::Task),
        ("About you", HeadingKind::Must),
        ("Skills & Experience", HeadingKind::Must),
        ("Wuenschenswert", HeadingKind::Nice),
        ("Wünschenswerte Kenntnisse", HeadingKind::Nice),
        ("Ueber uns", HeadingKind::Neutral),
        ("Rahmenbedingungen", HeadingKind::Neutral),
        ("About the company", HeadingKind::Neutral),
        ("So geht's weiter", HeadingKind::Neutral),
    ] {
        assert_eq!(heading(line), Some(kind), "{line}");
    }
}

/// A line that starts like a heading but names a skill is a requirement (real ads:
/// `Requirements Engineering`, `Branchenkenntnisse im Handel`, `Kategoriemanagement`,
/// `Compensation & Benefits` in a must list).
#[test]
fn a_skill_that_starts_like_a_heading_is_text() {
    for line in [
        "Requirements Engineering",
        "Branchenkenntnisse im Handel",
        "Kategoriemanagement",
        "Compensation & Benefits",
    ] {
        assert_eq!(classify(line, false, None), Line::Text, "{line}");
    }
    assert_eq!(heading("Bewerbungsprozess"), Some(HeadingKind::Neutral));
    assert_eq!(heading("Benefits für dich"), Some(HeadingKind::Neutral));
}

/// An inline heading keeps its content, in German and English.
#[test]
fn inline_headings() {
    assert_eq!(
        classify("Anforderungen: SAP", false, None),
        Line::Inline(HeadingKind::Must, "SAP")
    );
    assert_eq!(
        classify("Anforderungen:", false, None),
        Line::Heading(HeadingKind::Must)
    );
    assert_eq!(
        classify("Ihr Profil: SAP FI", false, None),
        Line::Inline(HeadingKind::Must, "SAP FI")
    );
    assert_eq!(
        classify("Nice to have: Power BI", false, None),
        Line::Inline(HeadingKind::Nice, "Power BI")
    );
    assert_eq!(
        classify("Wir bieten: Geld", false, None),
        Line::Inline(HeadingKind::Neutral, "Geld")
    );
    assert_eq!(classify("Einsatzort: München", false, None), Line::Text);
}

/// A line with a number is no heading; a frame line among them ends the section.
#[test]
fn a_heading_names_no_number() {
    assert_eq!(
        classify("Bewerbungsfrist 15.10.2026", false, None),
        Line::Closing
    );
    assert_eq!(
        classify("Ähnliche Projekte (12)", false, None),
        Line::Heading(HeadingKind::Neutral)
    );
    assert_eq!(classify("- Anforderungen", false, None), Line::Text);
    assert_eq!(classify("Anforderungen", true, None), Line::Text);
}

/// A bare `Skills` heading over prose opens the requirements; over a tag list it is the
/// portal's tags.
#[test]
fn a_skills_heading_over_prose_or_tags() {
    let prose = "Substantive experience from leading IT projects at several clients";
    assert_eq!(
        classify("Skills:", false, Some(prose)),
        Line::Heading(HeadingKind::Must)
    );
    assert_eq!(
        classify("Skills", false, Some("SAP FI, DATEV, HGB, IFRS")),
        Line::Heading(HeadingKind::Neutral)
    );
    assert_eq!(
        classify("Skills: SAP, Excel, Power BI", false, None),
        Line::Closing
    );
}

/// The heading tables are sorted and written in the heading folding.
#[test]
fn heading_tables_are_folded_and_sorted() {
    for table in [lex::HEADINGS, lex::HEADING_PREFIXES] {
        assert!(table.windows(2).all(|w| w[0].0 < w[1].0), "sorted");
        for (heading, _) in table {
            assert_eq!(heading_fold(heading), *heading);
        }
    }
    for table in [lex::OTHER_LISTINGS, lex::LISTING_TAILS, lex::HEADING_LEADS] {
        for heading in table {
            assert_eq!(heading_fold(heading), *heading);
        }
    }
}
