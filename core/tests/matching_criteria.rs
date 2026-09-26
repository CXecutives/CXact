//! The hard-criteria strip rests on evidence: a criterion is `Ok` only with the ad's value
//! (and the passage that states it), `NotMentioned` when the ad says nothing, `Inactive`
//! when it does not apply to the contract type. The key facts of the ad come with it.

use jobalert_core::matching::{
    Assessment, CompiledProfile, CriterionKey, CriterionState, CriterionStatus, JobInput,
    ReasonCode, ReasonKind, TextKind, Verdict, assess, compile_profile,
};
use jobalert_core::portal::Portal;
use serde_json::{Value, json};

/// An invented interim finance consultant with every freelance criterion set.
fn profile() -> Value {
    json!({
        "kernkompetenzen": [
            {"kompetenz": "Controlling", "jahre": 15},
            {"kompetenz": "Konzernrechnungslegung nach IFRS", "jahre": 12},
            {"kompetenz": "Budgetierung", "jahre": 12}
        ],
        "harte_kriterien": {
            "min_tagessatz": 800,
            "laender": ["DE"],
            "ausgeschlossene_vertragsarten": ["anue"],
            "verfuegbar_ab": "sofort",
            "min_jahresgehalt": 150_000
        }
    })
}

fn run(location: &str, text: &str) -> Assessment {
    let job = JobInput {
        title: "Interim Controller (m/w/d)",
        company: "Muster AG",
        location,
        portal: Portal::LinkedIn,
        text,
        facts: None,
        posted: None,
        kind: TextKind::Full,
    };
    assess(&compile_profile(&profile()), &job, None).expect("assessed")
}

fn criterion(a: &Assessment, key: CriterionKey) -> &CriterionState {
    a.criteria.iter().find(|c| c.key == key).expect("criterion")
}

fn passage(text: &str, state: &CriterionState) -> String {
    let (start, end) = state.range.expect("a passage");
    let units: Vec<u16> = text.encode_utf16().collect();
    String::from_utf16(&units[start as usize..end as usize]).expect("utf-16")
}

const STATED: &str =
    "Für unseren Kunden suchen wir einen Interim Controller (m/w/d) auf freiberuflicher Basis.

Ihre Aufgaben:
- Aufbau des Konzernreportings nach IFRS
- Budgetierung und Forecast

Ihr Profil:
- Erfahrung im Controlling
- Mindestens 10 Jahre Berufserfahrung

Rahmendaten:
- Start: ab sofort
- Laufzeit: 6 Monate
- 60 % remote
- Tagessatz: 950 € pro Tag";

#[test]
fn met_only_with_the_ads_value_and_its_passage() {
    let a = run("Hamburg, Deutschland", STATED);
    let rate = criterion(&a, CriterionKey::MinDayRate);
    assert_eq!(rate.status, CriterionStatus::Ok);
    assert_eq!(rate.params["rate"], 950);
    assert!(passage(STATED, rate).contains("950"));
    let country = criterion(&a, CriterionKey::Countries);
    assert_eq!(country.status, CriterionStatus::Ok);
    assert_eq!(country.params["location"], "Hamburg, Deutschland");
    let anue = criterion(&a, CriterionKey::NoAnue);
    assert_eq!(anue.status, CriterionStatus::Ok);
    assert_eq!(anue.params["contract"], "interim");
    let start = criterion(&a, CriterionKey::Availability);
    assert_eq!(start.status, CriterionStatus::Ok);
    assert_eq!(start.params["start"], "now");
    assert!(passage(STATED, start).contains("ab sofort"));
    // A salary is no criterion of a freelance role.
    let salary = criterion(&a, CriterionKey::MinSalary);
    assert_eq!(salary.status, CriterionStatus::Inactive);

    let facts = &a.facts;
    assert_eq!((facts.rate, facts.hourly), (Some(950), Some(false)));
    assert_eq!(facts.start.as_deref(), Some("now"));
    assert_eq!(facts.months, Some(6));
    assert_eq!((facts.remote_from, facts.remote_to), (Some(60), Some(60)));
    assert_eq!(facts.contract.as_deref(), Some("interim"));
    let json = serde_json::to_string(facts).expect("json");
    assert!(json.len() < 160, "{json}");
}

#[test]
fn not_mentioned_when_the_ad_says_nothing() {
    let text = "Wir suchen einen Interim Controller (m/w/d).

Ihr Profil:
- Erfahrung im Controlling
- Konzernrechnungslegung nach IFRS

Der Tagessatz ist nach Absprache.";
    let a = run("", text);
    let rate = criterion(&a, CriterionKey::MinDayRate);
    assert_eq!(rate.status, CriterionStatus::NotMentioned);
    assert_eq!(rate.params["rateOpen"], true);
    assert!(passage(text, rate).contains("nach Absprache"));
    for key in [CriterionKey::Countries, CriterionKey::Availability] {
        assert_eq!(
            criterion(&a, key).status,
            CriterionStatus::NotMentioned,
            "{key:?}"
        );
    }
    // Only the contract type is stated (an interim role): no temporary agency work.
    let ok: Vec<CriterionKey> = a
        .criteria
        .iter()
        .filter(|c| c.status == CriterionStatus::Ok)
        .map(|c| c.key)
        .collect();
    assert_eq!(ok, [CriterionKey::NoAnue]);
    assert_eq!(a.facts.rate_open, Some(true));
    assert_eq!((a.facts.rate, a.facts.start.as_deref()), (None, None));
}

#[test]
fn a_violation_keeps_the_ads_value() {
    let text = STATED.replace("950 €", "700 €");
    let a = run("Hamburg", &text);
    let rate = criterion(&a, CriterionKey::MinDayRate);
    assert_eq!(rate.status, CriterionStatus::Violated);
    assert_eq!(rate.params["rate"], 700);
    assert!(rate.reason.is_some());
}

const PERMANENT: &str = "Wir suchen einen Leiter Controlling (m/w/d) für unsere Holding.

Ihre Aufgaben:
- Aufbau des Konzernreportings nach IFRS
- Budgetierung und Forecast

Ihr Profil:
- Erfahrung im Controlling
- Konzernrechnungslegung nach IFRS

Wir bieten eine unbefristete Festanstellung in Vollzeit.";

/// The profile with these excluded contract types.
fn excluding(kinds: &Value) -> CompiledProfile {
    let mut value = profile();
    value["harte_kriterien"]["ausgeschlossene_vertragsarten"] = kinds.clone();
    compile_profile(&value)
}

fn assess_with(profile: &CompiledProfile, title: &str, text: &str) -> Assessment {
    let job = JobInput {
        title,
        company: "Muster AG",
        location: "Hamburg",
        portal: Portal::LinkedIn,
        text,
        facts: None,
        posted: None,
        kind: TextKind::Full,
    };
    assess(profile, &job, None).expect("assessed")
}

/// Permanent employment as an excluded contract type (`festanstellung`, also `permanent`):
/// a stated permanent role is excluded with the sentence that states it; one inferred from
/// benefits or one that offers freelance work too is a check; an interim role meets the
/// criterion with the ad's contract type. Without the value the permanent role is the
/// check it always was.
#[test]
fn permanent_employment_can_be_excluded() {
    for kinds in [
        json!(["anue", "festanstellung"]),
        json!(["Festanstellung"]),
        json!("permanent"),
    ] {
        let profile = excluding(&kinds);
        let a = assess_with(&profile, "Leiter Controlling (m/w/d)", PERMANENT);
        assert_eq!(a.verdict, Verdict::Excluded, "{kinds}");
        let state = criterion(&a, CriterionKey::NoPermanent);
        assert_eq!(state.status, CriterionStatus::Violated, "{kinds}");
        let reason = a
            .reasons
            .iter()
            .find(|r| r.code == ReasonCode::Permanent)
            .expect("the permanent reason");
        assert_eq!(reason.kind, ReasonKind::Violation);
        assert_eq!(reason.params["stated"], true);
        assert!(
            a.highlights.iter().any(|h| h.reason == reason.id),
            "the stating sentence is marked"
        );
    }
    let excluded = excluding(&json!(["festanstellung"]));
    // Inferred from benefits, or offered next to freelance work: a check only.
    let stated = "Wir bieten eine unbefristete Festanstellung in Vollzeit.";
    let hinted = PERMANENT.replace(
        stated,
        "Why join us\n30 days of vacation and a company pension scheme",
    );
    let both = PERMANENT.replace(
        stated,
        "Festanstellung oder freiberuflich, Tagessatz nach Absprache.",
    );
    for text in [hinted.as_str(), both.as_str()] {
        let a = assess_with(&excluded, "Leiter Controlling (m/w/d)", text);
        assert_ne!(a.verdict, Verdict::Excluded, "{text}");
        assert_eq!(
            criterion(&a, CriterionKey::NoPermanent).status,
            CriterionStatus::Check,
            "{text}"
        );
    }
    // An interim role meets it with the ad's contract type.
    let a = assess_with(&excluded, "Interim Controller (m/w/d)", STATED);
    let state = criterion(&a, CriterionKey::NoPermanent);
    assert_eq!(state.status, CriterionStatus::Ok);
    assert_eq!(state.params["contract"], "interim");
    // Without the value: inactive, and the permanent role is the check it was.
    let a = assess_with(
        &compile_profile(&profile()),
        "Leiter Controlling (m/w/d)",
        PERMANENT,
    );
    assert_ne!(a.verdict, Verdict::Excluded);
    assert_eq!(
        criterion(&a, CriterionKey::NoPermanent).status,
        CriterionStatus::Inactive
    );
    let check = a
        .reasons
        .iter()
        .find(|r| r.code == ReasonCode::Permanent)
        .expect("the permanent check");
    assert_eq!(check.kind, ReasonKind::Check);
    assert!(check.params.is_empty());
    // The profile summary names the criterion, and ANÜ only where the profile says so.
    let set: Vec<CriterionKey> = excluded
        .summary()
        .criteria
        .iter()
        .filter(|c| c.set)
        .map(|c| c.key)
        .collect();
    assert!(set.contains(&CriterionKey::NoPermanent), "{set:?}");
    assert!(!set.contains(&CriterionKey::NoAnue), "{set:?}");
}

/// A short requirement line that starts like a heading of the other listings ("Ähnliche
/// Projekterfahrung von Vorteil") is part of the ad: the hard criteria below it still count,
/// as a plain line and as a list item of a page. A real heading still ends the ad.
#[test]
fn a_requirement_that_starts_like_other_listings_keeps_the_ad_whole() {
    // The pay of temporary agency work is no day rate (version 16): one frame each.
    let frame = "Rahmendaten:\n- Einsatz über Arbeitnehmerüberlassung";
    let rate = "Rahmendaten:\n- Freiberuflich\n- Tagessatz: 600 €";
    for line in [
        "Ähnliche Projekterfahrung von Vorteil",
        "- Weitere Projekterfahrung wünschenswert",
    ] {
        for (below, key) in [
            (frame, CriterionKey::NoAnue),
            (rate, CriterionKey::MinDayRate),
        ] {
            let text = format!("Ihr Profil:\n- Erfahrung im Controlling\n{line}\n\n{below}");
            let a = run("Hamburg", &text);
            assert_eq!(a.verdict, Verdict::Excluded, "{line}");
            assert_eq!(
                criterion(&a, key).status,
                CriterionStatus::Violated,
                "{line} {key:?}"
            );
        }
    }
    let listings = format!(
        "Ihr Profil:\n- Erfahrung im Controlling\n- Tagessatz: 950 €\n\nÄhnliche Projekte (12)\n{frame}"
    );
    let a = run("Hamburg", &listings);
    assert_ne!(a.verdict, Verdict::Excluded);
}

/// A profile that names its countries (`["Deutschland", "Österreich"]`) keeps the country
/// rule: a job in Hamburg passes, one in Paris is excluded.
#[test]
fn country_names_in_a_profile_keep_the_country_rule() {
    let mut value = profile();
    value["harte_kriterien"]["laender"] = json!(["Deutschland", "Österreich"]);
    let named = compile_profile(&value);
    let at = |location: &str| {
        let job = JobInput {
            title: "Interim Controller (m/w/d)",
            company: "Muster AG",
            location,
            portal: Portal::LinkedIn,
            text: STATED,
            facts: None,
            posted: None,
            kind: TextKind::Full,
        };
        assess(&named, &job, None).expect("assessed")
    };
    assert_eq!(
        criterion(&at("Hamburg"), CriterionKey::Countries).status,
        CriterionStatus::Ok
    );
    let paris = at("Paris, Frankreich");
    assert_eq!(paris.verdict, Verdict::Excluded);
    assert_eq!(
        criterion(&paris, CriterionKey::Countries).status,
        CriterionStatus::Violated
    );
}

fn codes(a: &Assessment) -> Vec<(ReasonCode, ReasonKind)> {
    a.reasons
        .iter()
        .filter(|r| matches!(r.kind, ReasonKind::Violation | ReasonKind::Check))
        .map(|r| (r.code, r.kind))
        .collect()
}

/// An ad of employment with an hourly wage (German or English).
fn wage_ad(pay: &str) -> String {
    format!(
        "Für unser Team suchen wir eine Sachbearbeitung Buchhaltung (m/w/d).

Ihre Aufgaben:
- Kontierung und Buchung von Eingangsrechnungen
- Mitarbeit im Controlling

Ihr Profil:
- Erfahrung im Controlling
- Budgetierung

{pay}"
    )
}

/// An hourly wage of an employee or of temporary agency work is employment pay: the job is
/// judged as employment (the salary rule with a yearly estimate), never by its day rate.
#[test]
fn an_hourly_wage_is_employment_pay_never_a_day_rate() {
    let profile = compile_profile(&profile());
    for pay in [
        "Wir bieten 18,50 € brutto pro Stunde bei 38,5 Stunden pro Woche.",
        "Stundenlohn: 21 €",
        "Bruttostundenlohn 19,80 € nach iGZ-Tarif",
        "We offer €17.50 gross per hour.",
        "Pay: hourly wage of €16 plus shift allowance.",
    ] {
        let a = assess_with(
            &profile,
            "Sachbearbeiter Buchhaltung (m/w/d)",
            &wage_ad(pay),
        );
        let found = codes(&a);
        assert!(
            !found.iter().any(|(code, _)| *code == ReasonCode::DayRate),
            "{pay}: {found:?}"
        );
        // Employment pay below the minimum salary (a yearly estimate) excludes.
        assert_eq!(a.verdict, Verdict::Excluded, "{pay}: {found:?}");
        assert!(
            found.contains(&(ReasonCode::Salary, ReasonKind::Violation)),
            "{pay}: {found:?}"
        );
        assert_eq!(
            criterion(&a, CriterionKey::MinDayRate).status,
            CriterionStatus::Inactive,
            "{pay}"
        );
        assert_eq!(a.facts.contract.as_deref(), Some("permanent"), "{pay}");
    }
    // Without a minimum salary the wage excludes nothing.
    let mut value = self::profile();
    value["harte_kriterien"]
        .as_object_mut()
        .expect("criteria")
        .remove("min_jahresgehalt");
    let freelance_only = compile_profile(&value);
    let a = assess_with(
        &freelance_only,
        "Sachbearbeiter Buchhaltung (m/w/d)",
        &wage_ad("Stundenlohn: 21 €"),
    );
    assert_ne!(a.verdict, Verdict::Excluded, "{:?}", codes(&a));
}

/// The pay of temporary agency work is employment pay as well: no day rate, the salary rule.
#[test]
fn the_pay_of_temporary_agency_work_is_no_day_rate() {
    let mut value = profile();
    value["harte_kriterien"]
        .as_object_mut()
        .expect("criteria")
        .remove("ausgeschlossene_vertragsarten");
    let text = wage_ad("Einsatz im Rahmen der Arbeitnehmerüberlassung, Stundensatz 35 €.");
    let a = assess_with(&compile_profile(&value), "Controller (m/w/d)", &text);
    let found = codes(&a);
    assert!(
        !found.iter().any(|(code, _)| *code == ReasonCode::DayRate),
        "{found:?}"
    );
    assert!(
        found.contains(&(ReasonCode::Salary, ReasonKind::Violation)),
        "{found:?}"
    );
    value["harte_kriterien"]
        .as_object_mut()
        .expect("criteria")
        .remove("min_jahresgehalt");
    let a = assess_with(&compile_profile(&value), "Controller (m/w/d)", &text);
    assert_ne!(a.verdict, Verdict::Excluded, "{:?}", codes(&a));
}

/// A freelance hourly rate stays a rate: times eight it is the day rate.
#[test]
fn a_freelance_hourly_rate_counts_eight_times() {
    let profile = compile_profile(&profile());
    for pay in [
        "Stundensatz: 95 €/h",
        "Vergütung: 95 € pro Stunde zzgl. MwSt.",
        "Hourly rate: €95 (freelance)",
        "Stundensatz 95 € brutto",
    ] {
        let a = assess_with(&profile, "Interim Controller (m/w/d)", &wage_ad(pay));
        let found = codes(&a);
        assert!(
            found.contains(&(ReasonCode::DayRate, ReasonKind::Violation)),
            "{pay}: {found:?}"
        );
        let rate = criterion(&a, CriterionKey::MinDayRate);
        assert_eq!(rate.status, CriterionStatus::Violated, "{pay}");
        assert_eq!(
            (
                rate.params["rate"].as_u64(),
                rate.params["hourly"].as_bool()
            ),
            (Some(95), Some(true)),
            "{pay}"
        );
    }
}

/// The profile with the limits of an engagement and exclusion words.
fn limited(extra: &Value) -> CompiledProfile {
    let mut value = profile();
    let criteria = value["harte_kriterien"].as_object_mut().expect("criteria");
    for (key, v) in extra.as_object().expect("object") {
        criteria.insert(key.clone(), v.clone());
    }
    compile_profile(&value)
}

fn frame_ad(frame: &str) -> String {
    format!(
        "Wir suchen einen Interim Controller (m/w/d) auf freiberuflicher Basis.

Ihr Profil:
- Erfahrung im Controlling
- Budgetierung

Rahmendaten:
{frame}
- Tagessatz: 950 € pro Tag"
    )
}

/// The workload outside the profile's days per week is a check (`workload` with the ad's
/// share and the profile's days), never an exclusion; inside it meets the criterion.
#[test]
fn a_workload_outside_the_days_per_week_is_a_check() {
    let profile = limited(&json!({ "auslastung_min_tage": 2, "auslastung_max_tage": 3 }));
    let set = profile
        .summary()
        .criteria
        .iter()
        .find(|c| c.key == CriterionKey::Workload);
    assert_eq!(
        set.map(|c| (c.set, c.params.clone())),
        Some((
            true,
            json!({ "minDays": 2, "maxDays": 3 })
                .as_object()
                .cloned()
                .expect("map")
        ))
    );
    let text = frame_ad("- Auslastung: 100 %");
    let a = assess_with(&profile, "Interim Controller (m/w/d)", &text);
    assert_ne!(a.verdict, Verdict::Excluded, "{:?}", codes(&a));
    let check = a
        .reasons
        .iter()
        .find(|r| r.code == ReasonCode::Workload)
        .expect("a workload check");
    assert_eq!(check.kind, ReasonKind::Check);
    assert_eq!(
        Value::Object(check.params.clone()),
        json!({ "from": 100, "to": 100, "minDays": 2, "maxDays": 3 })
    );
    let state = criterion(&a, CriterionKey::Workload);
    assert_eq!(state.status, CriterionStatus::Check);
    assert!(passage(&text, state).contains("100 %"));
    assert_eq!(
        (a.facts.workload_from, a.facts.workload_to),
        (Some(100), Some(100))
    );

    let text = frame_ad("- Einsatz an 3 Tagen pro Woche, remote 80 %");
    let a = assess_with(&profile, "Interim Controller (m/w/d)", &text);
    let state = criterion(&a, CriterionKey::Workload);
    assert_eq!(state.status, CriterionStatus::Ok, "{:?}", codes(&a));
    assert_eq!(
        (state.params["from"].as_u64(), state.params["to"].as_u64()),
        (Some(60), Some(60))
    );
    assert_eq!(
        (a.facts.remote_from, a.facts.workload_from),
        (Some(80), Some(60))
    );

    let a = assess_with(
        &profile,
        "Interim Controller (m/w/d)",
        &frame_ad("- Start: sofort"),
    );
    assert_eq!(
        criterion(&a, CriterionKey::Workload).status,
        CriterionStatus::NotMentioned
    );
    assert_eq!(a.facts.workload_to, None);
    // Without the keys the workload is no criterion; the facts still name it.
    let a = run("Hamburg", &frame_ad("- Vollzeit"));
    assert_eq!(
        criterion(&a, CriterionKey::Workload).status,
        CriterionStatus::Inactive
    );
    assert_eq!(a.facts.workload_to, Some(100));
}

/// An engagement shorter than the minimum is a check (`duration {months, min}`).
#[test]
fn an_engagement_shorter_than_the_minimum_is_a_check() {
    let profile = limited(&json!({ "min_laufzeit_monate": 6 }));
    let text = frame_ad("- Laufzeit: 3 Monate");
    let a = assess_with(&profile, "Interim Controller (m/w/d)", &text);
    assert_ne!(a.verdict, Verdict::Excluded);
    let check = a
        .reasons
        .iter()
        .find(|r| r.code == ReasonCode::Duration)
        .expect("a duration check");
    assert_eq!(check.kind, ReasonKind::Check);
    assert_eq!(
        Value::Object(check.params.clone()),
        json!({ "months": 3, "min": 6 })
    );
    let state = criterion(&a, CriterionKey::Duration);
    assert_eq!(state.status, CriterionStatus::Check);
    assert!(passage(&text, state).contains("3 Monate"));
    let a = assess_with(
        &profile,
        "Interim Controller (m/w/d)",
        &frame_ad("- Laufzeit: 12 Monate"),
    );
    assert_eq!(
        criterion(&a, CriterionKey::Duration).status,
        CriterionStatus::Ok
    );
    let a = assess_with(
        &profile,
        "Interim Controller (m/w/d)",
        &frame_ad("- Start: sofort"),
    );
    assert_eq!(
        criterion(&a, CriterionKey::Duration).status,
        CriterionStatus::NotMentioned
    );
}

/// An exclusion word in the title or the ad excludes (`exclusionWord {word}`), in its
/// German forms; without a hit the criterion stays out of the strip.
#[test]
fn an_exclusion_word_excludes_in_its_forms() {
    let profile = limited(&json!({ "ausschlusswoerter": ["Werkstudent", "Praktikum"] }));
    let a = assess_with(
        &profile,
        "Werkstudentin Controlling (m/w/d)",
        &frame_ad("- Start: sofort"),
    );
    assert_eq!(a.verdict, Verdict::Excluded);
    let hit = a
        .reasons
        .iter()
        .find(|r| r.code == ReasonCode::ExclusionWord)
        .expect("an exclusion word");
    assert_eq!(hit.kind, ReasonKind::Violation);
    assert_eq!(
        Value::Object(hit.params.clone()),
        json!({ "word": "Werkstudent" })
    );
    assert_eq!(
        criterion(&a, CriterionKey::ExclusionWords).status,
        CriterionStatus::Violated
    );
    let text = frame_ad(
        "- Betreuung von Werkstudenten\n- Wir suchen außerdem eine/n Praktikant/in für ein \
         Pflichtpraktikum im Controlling",
    );
    let a = assess_with(&profile, "Controlling (m/w/d)", &text);
    assert_eq!(a.verdict, Verdict::Excluded);
    // The strip links the reason, whose highlight is the sentence that names the word.
    let state = criterion(&a, CriterionKey::ExclusionWords);
    let reason = a
        .reasons
        .iter()
        .find(|r| Some(r.id) == state.reason)
        .expect("the linked reason");
    let highlight = a
        .highlights
        .iter()
        .find(|h| reason.ranges.contains(&h.id))
        .expect("a highlight");
    let units: Vec<u16> = text.encode_utf16().collect();
    let marked = String::from_utf16(&units[highlight.start as usize..highlight.end as usize])
        .expect("utf-16");
    assert!(marked.contains("Pflichtpraktikum"), "{marked}");
    assert_eq!(
        a.reasons
            .iter()
            .filter(|r| r.code == ReasonCode::ExclusionWord)
            .map(|r| r.params["word"].as_str().unwrap_or(""))
            .collect::<Vec<_>>(),
        ["Praktikum"],
        "the mention of the Werkstudenten one supervises excludes nothing"
    );
    let a = assess_with(
        &profile,
        "Interim Controller (m/w/d)",
        &frame_ad("- Start: sofort"),
    );
    assert_ne!(a.verdict, Verdict::Excluded);
    assert_eq!(
        criterion(&a, CriterionKey::ExclusionWords).status,
        CriterionStatus::Inactive
    );
}

/// E16-1: in the ad of a senior role, a position word that is only mentioned (the team, the
/// people one supervises or trains, the company's offers) excludes nothing; the title and a
/// sentence that states the offered role still do.
#[test]
fn e16_1_a_passing_mention_of_an_exclusion_word_excludes_nothing() {
    let profile = limited(&json!({ "ausschlusswoerter": ["Werkstudent", "Praktikum"] }));
    for line in [
        "- Sie führen ein Team von acht Mitarbeitenden inkl. zwei Werkstudenten",
        "- Betreuung von Praktikanten im Finanzbereich",
        "- Erfahrung in der Ausbildung von Werkstudierenden wünschenswert",
        "- Personalverantwortung inkl. Praktikumsbetreuung",
        "Wir bieten jedes Jahr Praktika und Werkstudentenstellen an.",
        "- Sie entwickeln pragmatische und praktikable Lösungen",
    ] {
        let a = assess_with(&profile, "Interim CFO (m/w/d)", &frame_ad(line));
        assert_ne!(a.verdict, Verdict::Excluded, "{line}: {:?}", codes(&a));
        assert_eq!(
            criterion(&a, CriterionKey::ExclusionWords).status,
            CriterionStatus::Inactive,
            "{line}"
        );
    }
    let a = assess_with(
        &profile,
        "Werkstudent Controlling (m/w/d)",
        &frame_ad("- Start: sofort"),
    );
    assert_eq!(a.verdict, Verdict::Excluded);
    let a = assess_with(
        &profile,
        "Controlling (m/w/d)",
        &frame_ad("Pflichtpraktikum im Finanzbereich (m/w/d)"),
    );
    assert_eq!(a.verdict, Verdict::Excluded);
}

/// The new keys under their English names and values the engine cannot read.
#[test]
fn the_new_criteria_read_english_keys_and_report_odd_values() {
    let english = compile_profile(&json!({
        "kernkompetenzen": [{"kompetenz": "Controlling"}],
        "hard_criteria": {
            "workload_min_days": "2", "workload_max_days": 4,
            "min_duration_months": "6", "exclusion_words": "Werkstudent; Praktikum"
        }
    }));
    let summary = english.summary();
    let params = |key| {
        summary
            .criteria
            .iter()
            .find(|c| c.key == key)
            .map(|c| (c.set, Value::Object(c.params.clone())))
    };
    assert_eq!(
        params(CriterionKey::Workload),
        Some((true, json!({ "minDays": 2, "maxDays": 4 })))
    );
    assert_eq!(
        params(CriterionKey::Duration),
        Some((true, json!({ "min": 6 })))
    );
    assert_eq!(
        params(CriterionKey::ExclusionWords),
        Some((true, json!({ "words": ["Werkstudent", "Praktikum"] })))
    );
    assert!(
        summary
            .warnings
            .iter()
            .all(|w| w.params.get("keys").is_none())
    );
    let odd = compile_profile(&json!({
        "kernkompetenzen": [{"kompetenz": "Controlling"}],
        "harte_kriterien": {
            "auslastung_min_tage": 4, "auslastung_max_tage": 2,
            "min_laufzeit_monate": "lang", "ausschlusswoerter": 5
        }
    }));
    let keys: Vec<String> = odd
        .summary()
        .warnings
        .iter()
        .filter_map(|w| {
            w.params
                .get("key")
                .and_then(Value::as_str)
                .map(str::to_owned)
        })
        .collect();
    assert_eq!(
        keys,
        [
            "auslastung_max_tage",
            "min_laufzeit_monate",
            "ausschlusswoerter"
        ]
    );
}
