//! Tests of the AI prompts: every section of both prompts in both languages, the contact
//! filter, missing facts, the text status, an exclusion, an English ad, no engine code in the
//! text, the cuts, the real engine behind a stored job, and one golden prompt per language
//! (`core/tests/fixtures/prompts/`, invented data only).

use jiff::Timestamp;
use serde_json::{Map, Value, json};

use super::*;
use crate::matching::{
    Evidence, EvidenceLevel, Factor, Highlight, KeyFacts, Summary, compile_profile,
};
use crate::model::{Place, Posting};
use crate::portal::{JobKey, Portal, job_link};
use crate::store::MailRef;

// ------------------------------------------------------------------------- invented data

/// A profile full of contact data in every place real files hold it.
fn profile() -> Value {
    json!({
        "name": "Max Mustermann",
        "Vorname": "Max",
        "email": "max.mustermann@example.org",
        "telefon": "+49 170 1234567",
        "adresse": { "strasse": "Musterweg 12", "plz": "20095", "ort": "Hamburg" },
        "linkedin": "https://www.linkedin.com/in/max-mustermann",
        "links": ["https://max-mustermann.example.org"],
        "kontakt": { "e-mail": "privat@example.org", "mobil": "0151 7654321" },
        "titel": "Interim Manager Finanzen",
        "kernkompetenzen": [
            { "kompetenz": "Controlling", "jahre": 12, "auch": ["Financial Controlling"] },
            { "kompetenz": "Konzernabschluss nach HGB", "jahre": 8 }
        ],
        "methoden_tools": [{ "name": "SAP S/4HANA" }],
        "referenzen": [
            { "name": "Erika Beispiel", "email": "erika@example.org",
              "testimonial": "Max hat unser Reporting in 100 Tagen neu gebaut." }
        ],
        "alleinstellungsmerkmale": [
            "Aufbau eines Konzernreportings, mehr unter www.max-mustermann.example.org oder max@example.org"
        ],
        "harte_kriterien": {
            "min_tagessatz": 1100,
            "laender": ["DE", "AT"],
            "ausgeschlossene_vertragsarten": ["anue"],
            "verfuegbar_ab": "01.12.2026"
        },
        "schwerpunkte": ["Controlling"],
        "wunschrollen": ["Interim CFO"],
        "einsatzpraeferenzen": { "tagessatz_wunsch": 1300, "remote": "teilweise" }
    })
}

/// What must never reach a prompt.
const PRIVATE: [&str; 14] = [
    "Max Mustermann",
    "\"Max\"",
    "max.mustermann@example.org",
    "+49 170",
    "Musterweg",
    "20095",
    "linkedin.com/in",
    "max-mustermann.example.org",
    "privat@example.org",
    "0151",
    "erika@example.org",
    "Erika Beispiel",
    "unser Reporting in 100 Tagen",
    "max@example.org",
];

const AD: &str = "Für die Hanseatic Holding GmbH suchen wir ab 01.11.2026 einen Interim CFO (m/w/d) für neun Monate.

Aufgaben
- Leitung von Finanzen und Controlling der Gruppe
- Konzernabschluss nach HGB und IFRS
- Aufbau eines Reportings mit Power BI

Anforderungen
- Mehrjährige Erfahrung im Controlling
- Sehr gute Kenntnisse im Konzernabschluss nach HGB
- Erfahrung mit SAP S/4HANA
- Verhandlungssichere Englischkenntnisse
- Idealerweise Erfahrung mit Power BI

Rahmen
- Freiberuflich über uns, Tagessatz bis 1.250 €
- Remote-Anteil 60 %, sonst vor Ort in Hamburg";

const URL: &str = "https://www.freelancermap.de/projekt/interim-cfo-2801";

fn view() -> JobView {
    JobView {
        key: JobKey {
            portal: Portal::Freelancermap,
            id: "2801".into(),
        },
        portal: Portal::Freelancermap,
        title: "Interim CFO (m/w/d)".into(),
        company: "Hanseatic Holding GmbH".into(),
        location: "Hamburg".into(),
        work_mode: None,
        mail_date: Some("2026-09-20T07:30:00Z".parse().unwrap()),
        first_seen_at: Timestamp::UNIX_EPOCH,
        unread: true,
        detail: DetailState::Ok,
        short: false,
        closed: false,
        match_: None,
        also_on: Vec::new(),
        place: Place::Inbox,
        trashed_at: None,
        overridden: false,
        has_mail: false,
    }
}

fn item<'a>(
    job: &'a JobView,
    text: Option<&'a str>,
    assessment: Option<&'a Assessment>,
) -> PromptJob<'a> {
    PromptJob {
        job,
        url: URL,
        text,
        page: None,
        assessment,
    }
}

/// UTF-16 offsets of `needle` in `text`.
fn span(text: &str, needle: &str) -> (u32, u32) {
    let at = text
        .find(needle)
        .unwrap_or_else(|| panic!("{needle} in the text"));
    let units = |s: &str| u32::try_from(s.encode_utf16().count()).unwrap();
    let start = units(&text[..at]);
    (start, start + units(needle))
}

/// Builds an assessment of [`AD`] by hand: reasons with their highlighted passages.
struct Built {
    text: &'static str,
    reasons: Vec<Reason>,
    highlights: Vec<Highlight>,
}

impl Built {
    fn new(text: &'static str) -> Self {
        Built {
            text,
            reasons: Vec::new(),
            highlights: Vec::new(),
        }
    }

    fn reason(
        &mut self,
        (kind, weight, code): (ReasonKind, Weight, ReasonCode),
        label: Option<&str>,
        params: Value,
        evidence: Option<(&str, &str, Via)>,
        passage: Option<&str>,
    ) -> u16 {
        let id = u16::try_from(self.reasons.len()).unwrap();
        let mut ranges = Vec::new();
        if let Some(passage) = passage {
            let (start, end) = span(self.text, passage);
            let hid = u16::try_from(self.highlights.len()).unwrap();
            self.highlights.push(Highlight {
                id: hid,
                start,
                end,
                kind,
                reason: id,
            });
            ranges.push(hid);
        }
        self.reasons.push(Reason {
            id,
            kind,
            weight,
            code,
            label: label.map(str::to_owned),
            evidence: evidence.map(|(profile, path, via)| Evidence {
                profile: profile.into(),
                path: path.into(),
                via,
                quote: label.unwrap_or_default().into(),
            }),
            params: object(params),
            ranges,
        });
        id
    }
}

fn state(
    key: CriterionKey,
    status: CriterionStatus,
    reason: Option<u16>,
    params: Value,
    range: Option<(u32, u32)>,
) -> CriterionState {
    CriterionState {
        key,
        status,
        reason,
        params: object(params),
        range,
    }
}

/// The reasons of the app's assessment of [`AD`]: three musts met (one through the
/// Schwerpunkt), English open, Power BI open as a nice-to-have, a start before the
/// availability (its id comes back), the target role and two wishes.
fn reasons() -> (Built, u16) {
    use ReasonCode as C;
    use ReasonKind as K;
    let mut b = Built::new(AD);
    let requirement = json!({ "class": "skill", "source": "section" });
    b.reason(
        (K::Met, Weight::Must, C::Requirement),
        Some("Mehrjährige Erfahrung im Controlling"),
        json!({ "class": "skill", "source": "section", "focus": "Controlling" }),
        Some(("Controlling", "kernkompetenzen[0].kompetenz", Via::Exact)),
        Some("Mehrjährige Erfahrung im Controlling"),
    );
    b.reason(
        (K::Met, Weight::Must, C::Requirement),
        Some("Sehr gute Kenntnisse im Konzernabschluss nach HGB"),
        requirement.clone(),
        Some((
            "Konzernabschluss nach HGB",
            "kernkompetenzen[1].kompetenz",
            Via::Exact,
        )),
        Some("Sehr gute Kenntnisse im Konzernabschluss nach HGB"),
    );
    b.reason(
        (K::Met, Weight::Must, C::Requirement),
        Some("Erfahrung mit SAP S/4HANA"),
        requirement.clone(),
        Some(("SAP S/4HANA", "methoden_tools[0].name", Via::Exact)),
        Some("Erfahrung mit SAP S/4HANA"),
    );
    b.reason(
        (K::Open, Weight::Must, C::Requirement),
        Some("Verhandlungssichere Englischkenntnisse"),
        json!({ "class": "language", "source": "section" }),
        None,
        Some("Verhandlungssichere Englischkenntnisse"),
    );
    b.reason(
        (K::Open, Weight::Nice, C::Requirement),
        Some("Idealerweise Erfahrung mit Power BI"),
        requirement,
        None,
        Some("Idealerweise Erfahrung mit Power BI"),
    );
    b.reason(
        (K::Met, Weight::Info, C::ContractType),
        None,
        json!({ "type": "interim", "inferred": false }),
        None,
        Some("Freiberuflich"),
    );
    let gap = b.reason(
        (K::Check, Weight::Info, C::AvailabilityGap),
        None,
        json!({ "days": 30 }),
        None,
        Some("ab 01.11.2026"),
    );
    b.reason(
        (K::Met, Weight::Info, C::Focus),
        None,
        json!({ "focus": "Controlling", "met": 1, "partial": 0, "inTitle": false, "relevance": 100 }),
        Some(("Controlling", "schwerpunkte[0]", Via::Exact)),
        Some("Mehrjährige Erfahrung im Controlling"),
    );
    b.reason(
        (K::Met, Weight::Info, C::TargetRole),
        None,
        json!({ "role": "Interim CFO", "fit": "full", "points": 8 }),
        Some(("Interim CFO", "wunschrollen[0]", Via::Exact)),
        None,
    );
    b.reason(
        (K::Partial, Weight::Info, C::DayRateWish),
        None,
        json!({ "state": "near", "rate": 1250, "wish": 1300, "hourly": false, "points": 1 }),
        Some(("1300", "einsatzpraeferenzen.tagessatz_wunsch", Via::Exact)),
        Some("Tagessatz bis 1.250 €"),
    );
    b.reason(
        (K::Met, Weight::Info, C::RemoteWish),
        None,
        json!({ "state": "met", "share": 60, "level": "partly", "points": 3 }),
        Some(("teilweise", "einsatzpraeferenzen.remote", Via::Exact)),
        Some("Remote-Anteil 60 %"),
    );
    (b, gap)
}

/// A factor of what moved a score.
fn factor(code: FactorCode, params: Value) -> Factor {
    Factor {
        code,
        params: object(params),
    }
}

/// The app's assessment of [`AD`] for [`profile`] (the reasons of [`reasons`], and what
/// moved the score: the counts, the Schwerpunkt, the target role and the wishes).
fn assessment() -> Assessment {
    let (b, gap) = reasons();
    Assessment {
        verdict: Verdict::Scored,
        score: 68,
        summary: Summary {
            must_met: 3,
            must_partial: 0,
            must_open: 1,
            must_total: 4,
            nice_met: 0,
            nice_total: 1,
            evidence: EvidenceLevel::Full,
        },
        criteria: criteria(gap),
        reasons: b.reasons,
        highlights: b.highlights,
        facts: KeyFacts {
            rate: Some(1250),
            hourly: Some(false),
            start: Some("2026-11-01".into()),
            months: Some(9),
            remote_from: Some(60),
            remote_to: Some(60),
            contract: Some("interim".into()),
            ..KeyFacts::default()
        },
        rank: 700,
        factors: vec![
            factor(
                FactorCode::Musts,
                json!({ "met": 3, "partial": 0, "total": 4 }),
            ),
            factor(FactorCode::Nice, json!({ "met": 0, "total": 1 })),
            factor(FactorCode::Focus, json!({ "hit": 1, "total": 1 })),
            factor(
                FactorCode::TargetRole,
                json!({ "role": "Interim CFO", "fit": "full" }),
            ),
            factor(FactorCode::Wishes, json!({ "points": 3 })),
        ],
    }
}

/// The hard criteria of [`assessment`]: the day rate, the country and no temporary agency
/// work met, the start to check (`gap`: the reason).
fn criteria(gap: u16) -> Vec<CriterionState> {
    vec![
        state(
            CriterionKey::MinDayRate,
            CriterionStatus::Ok,
            None,
            json!({ "rate": 1250, "hourly": false }),
            Some(span(AD, "Tagessatz bis 1.250 €")),
        ),
        state(
            CriterionKey::Countries,
            CriterionStatus::Ok,
            None,
            json!({ "location": "Hamburg" }),
            None,
        ),
        state(
            CriterionKey::NoAnue,
            CriterionStatus::Ok,
            None,
            json!({ "contract": "interim" }),
            Some(span(AD, "Freiberuflich")),
        ),
        state(
            CriterionKey::NoPermanent,
            CriterionStatus::Inactive,
            None,
            json!({}),
            None,
        ),
        state(
            CriterionKey::Availability,
            CriterionStatus::Check,
            Some(gap),
            json!({ "start": "2026-11-01" }),
            Some(span(AD, "ab 01.11.2026")),
        ),
    ]
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => Map::new(),
    }
}

// ------------------------------------------------------------------------- helpers

fn de_words() -> &'static Words {
    de::German.words()
}

/// The prompt without its fenced blocks (the profile JSON and the ad text are data).
fn outside_fences(prompt: &str) -> String {
    let mut out = String::new();
    let mut fence: Option<String> = None;
    for line in prompt.lines() {
        let ticks: String = line.chars().take_while(|c| *c == '`').collect();
        match &fence {
            Some(open) if line.trim() == open => fence = None,
            Some(_) => {}
            None if ticks.len() >= 3 => fence = Some(ticks),
            None => {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    out
}

/// The positions of `headings` in `prompt`, which must all be there and in this order.
fn in_order(prompt: &str, headings: &[&str]) {
    let mut last = 0;
    for heading in headings {
        let Some(at) = prompt[last..].find(heading) else {
            panic!("{heading:?} missing or out of order:\n{prompt}");
        };
        last += at + heading.len();
    }
}

fn both(check: impl Fn(Language, &str)) {
    let view = view();
    let a = assessment();
    for language in [Language::De, Language::En] {
        let one = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), language);
        check(language, &one);
    }
}

// ------------------------------------------------------------------------- structure

#[test]
fn every_section_of_one_job_in_order() {
    let view = view();
    let a = assessment();
    let de = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::De);
    in_order(
        &de,
        &[
            "# Auftrag\n",
            "# Mein Profil\n",
            "```json\n",
            "# Die Anzeige\n",
            "## Jobdetails\n",
            "## Anzeigentext\n",
            "```text\n",
            "# Vorbewertung der App\n",
            "**Harte Kriterien**",
            "**Erfüllt**",
            "**Offen**",
            "**Schwerpunkte, Wunschrolle und Wünsche**",
            "# Arbeitsweise\n",
            "# Bewertungsregel\n",
            "## Obergrenzen",
            "# Antwortformat\n",
            "## Ergebnis\n",
            "## Begründung\n",
            "## Anforderungen\n",
            "| Anforderung | Gewicht | Stand | Anzeige | Profil |",
            "## Harte Kriterien\n",
            "## Risiken und Warnsignale\n",
            "## Offene Fragen\n",
            "## Vergütung und Konditionen\n",
            "## Für die Bewerbung\n",
            "## Nachricht\n",
        ],
    );
    let en = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::En);
    in_order(
        &en,
        &[
            "# Task\n",
            "# My profile\n",
            "```json\n",
            "# The ad\n",
            "## Job details\n",
            "## Ad text\n",
            "```text\n",
            "# The app's pre-assessment\n",
            "**Hard criteria**",
            "**Met**",
            "**Open**",
            "**Focus areas, target role and preferences**",
            "# How to work\n",
            "# Scoring rule\n",
            "## Caps",
            "# Answer format\n",
            "## Result\n",
            "## Reasons\n",
            "## Requirements\n",
            "| Requirement | Weight | Status | Ad | Profile |",
            "## Hard criteria\n",
            "## Risks and red flags\n",
            "## Open questions\n",
            "## Pay and conditions\n",
            "## For the application\n",
            "## Message\n",
        ],
    );
}

#[test]
fn the_pre_assessment_says_what_the_app_found() {
    let view = view();
    let a = assessment();
    let de = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::De);
    for part in [
        "- Ergebnis: 68 von 100 Punkten der App, mittlere Übereinstimmung (ab 80 hoch, ab 40 mittel)",
        "- Muss-Anforderungen: 3 von 4 erfüllt, 1 offen",
        "- Kann-Anforderungen: 0 von 1 erfüllt",
        // What moved the score, as the reader's "why this number" shows it.
        "- Schwerpunkte: 1 von 1 getroffen",
        "- Wünsche: heben die Punktzahl um 3 von 100 Punkten",
        // Every criterion the profile sets, with its threshold and the ad's words.
        "- Tagessatz mindestens 1.100 €: erfüllt, 1.250 € pro Tag („Tagessatz bis 1.250 €“)",
        "- Einsatzland DE, AT oder voll remote: erfüllt, Ort Hamburg",
        "- Keine Arbeitnehmerüberlassung: erfüllt, Vertragsart Interim („Freiberuflich“)",
        "- Verfügbar ab 01.12.2026: zu prüfen. Der Start liegt 30 Tage vor meiner Verfügbarkeit. „ab 01.11.2026“",
        // The requirements with the profile entry, its years and the Schwerpunkt.
        "- „Mehrjährige Erfahrung im Controlling“ (Muss): Profil Controlling, 12 Jahre; Schwerpunkt Controlling, zählt doppelt",
        "- „Sehr gute Kenntnisse im Konzernabschluss nach HGB“ (Muss): Profil Konzernabschluss nach HGB, 8 Jahre",
        "- „Erfahrung mit SAP S/4HANA“ (Muss): Profil SAP S/4HANA",
        "- „Verhandlungssichere Englischkenntnisse“ (Muss, Sprache): kein Beleg im Profil gefunden",
        "- „Idealerweise Erfahrung mit Power BI“ (Kann): kein Beleg im Profil gefunden",
        "- Der Schwerpunkt Controlling ist gefragt.",
        "- Der Titel passt zur Wunschrolle Interim CFO.",
        "- Der Tagessatz von 1.250 € liegt knapp unter dem Wunsch von 1.300 €. „Tagessatz bis 1.250 €“",
        "- Die Stelle ist zu 60 % remote, gewünscht ist teilweise remote. „Remote-Anteil 60 %“",
        // The key facts.
        "- Vertragsart: Interim",
        "- Vergütung: 1.250 € pro Tag",
        "- Start: 01.11.2026",
        "- Dauer: 9 Monate",
        "- Remote-Anteil: 60 %",
        "- Datum der Alert-Mail: 20.09.2026",
        "- Portal: freelancermap.de",
        "- Link: https://www.freelancermap.de/projekt/interim-cfo-2801",
    ] {
        assert!(de.contains(part), "{part} missing:\n{de}");
    }
    // A check a criterion carries is said once, there, and a target role met with the wishes.
    assert_eq!(de.matches("30 Tage vor meiner Verfügbarkeit").count(), 1);
    assert!(!de.contains("**Zu prüfen**"), "no other point to check");
    assert!(!de.contains("- Wunschrolle:"), "the target role once");
}

/// What moved the score stands under the result as the reader shows it: the text's evidence,
/// the permanent role, the cap with its maximum and a title without a target role.
#[test]
fn what_moved_the_score_is_said_with_the_cap() {
    let view = view();
    let mut a = assessment();
    a.reasons.retain(|r| r.code != ReasonCode::TargetRole);
    a.factors = vec![
        factor(FactorCode::TargetRole, json!({ "fit": "none" })),
        factor(FactorCode::Wishes, json!({ "points": -1 })),
        factor(FactorCode::Evidence, json!({ "evidence": "teaser" })),
        factor(FactorCode::Permanent, json!({ "percent": 90 })),
        factor(FactorCode::Cap, json!({ "cap": "titleOpen", "max": 60 })),
    ];
    let de = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::De);
    let result = de.split("**Harte Kriterien**").next().unwrap();
    for part in [
        "- Wunschrolle: keine im Titel",
        "- Wünsche: senken die Punktzahl um 1 von 100 Punkten",
        "- Text: nur der Anriss, die Punktzahl rückt zur Mitte",
        "- Festanstellung: zählt mit 90 % der fachlichen Passung",
        "- Obergrenze: Muss-Anforderung zum Kern der Rolle offen, höchstens 60 von 100 Punkten",
    ] {
        assert!(result.contains(part), "{part}:\n{result}");
    }
    let en = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::En);
    for part in [
        "- Target role: none in the title",
        "- Preferences: lower the score by 1 of 100 points",
        "- Text: only the teaser, the score leans to the middle",
        "- Permanent role: counts at 90% of its fit",
        "- Cap: a must-have on the core of the role open, at most 60 of 100 points",
    ] {
        assert!(en.contains(part), "{part}:\n{en}");
    }
}

// ------------------------------------------------------------------------- the profile

#[test]
fn no_contact_data_reaches_a_prompt() {
    let view = view();
    let mut a = assessment();
    // A profile entry behind a reason is filtered too.
    a.reasons[0].evidence.as_mut().unwrap().profile = "Controlling, siehe max@example.org".into();
    both(|_, prompt| {
        for private in PRIVATE {
            assert!(!prompt.contains(private), "{private} leaked:\n{prompt}");
        }
    });
    let prompt = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::De);
    assert!(!prompt.contains("max@example.org"));
    // What the analysis needs stays, and the profile part is valid JSON.
    for kept in [
        "Controlling",
        "SAP S/4HANA",
        "min_tagessatz",
        "Interim Manager Finanzen",
    ] {
        assert!(prompt.contains(kept), "{kept} missing");
    }
    let json = prompt
        .split("```json\n")
        .nth(1)
        .and_then(|rest| rest.split("\n```").next())
        .unwrap();
    let parsed: Value = serde_json::from_str(json).unwrap();
    assert!(parsed.get("email").is_none() && parsed.get("name").is_none());
}

#[test]
fn the_glossary_names_only_the_keys_the_profile_holds() {
    let view = view();
    let de = ai_prompt(&profile(), item(&view, Some(AD), None), Language::De);
    assert!(de.contains("- `min_tagessatz`: niedrigster Tagessatz in Euro"));
    assert!(de.contains("- `einsatzpraeferenzen`: Wünsche, nie ein Ausschluss"));
    assert!(
        !de.contains("`min_jahresgehalt`:"),
        "the profile sets no salary"
    );
    let en = ai_prompt(&profile(), item(&view, Some(AD), None), Language::En);
    assert!(en.contains("- `laender`: allowed countries of work as country codes"));
    assert!(en.contains("- `kernkompetenzen`: core skills"));
    let bare = ai_prompt(&json!({}), item(&view, Some(AD), None), Language::De);
    assert!(
        !bare.contains(de_words().glossary_intro),
        "no glossary without keys"
    );
    // The limits, the exclusion words and the keywords, under their real keys.
    let mut full = profile();
    full["harte_kriterien"]["auslastung_min_tage"] = json!(3);
    full["harte_kriterien"]["auslastung_max_tage"] = json!(5);
    full["harte_kriterien"]["min_laufzeit_monate"] = json!(6);
    full["harte_kriterien"]["ausschlusswoerter"] = json!(["Werkstudent"]);
    full["keywords"] = json!(["IFRS 16"]);
    for language in [Language::De, Language::En] {
        let prompt = ai_prompt(&full, item(&view, Some(AD), None), language);
        for key in [
            "auslastung_min_tage",
            "auslastung_max_tage",
            "min_laufzeit_monate",
            "ausschlusswoerter",
            "keywords",
        ] {
            assert!(prompt.contains(&format!("- `{key}`: ")), "{key}");
        }
    }
}

/// The method and the answer say what the engine does: the workload and the duration are
/// checks, never exclusions, and fully remote work abroad fits unless the profile rules it
/// out (a missing `remote_ausserhalb_erlaubt` allows it, only `false` excludes).
#[test]
fn limits_are_checks_and_remote_work_abroad_fits_unless_ruled_out() {
    let view = view();
    let a = assessment();
    let de = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::De);
    for part in [
        "`min_laufzeit_monate` sind teilweise, nie ein Ausschluss",
        "bei einer voll remote Stelle nur, wenn `remote_ausserhalb_erlaubt` auf `false` steht",
        "verletzt ist nur, was nach der Bewertungsregel ausschließt",
    ] {
        assert!(de.contains(part), "{part}");
    }
    let en = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), Language::En);
    for part in [
        "`min_laufzeit_monate` are partly met, never an exclusion",
        "for a fully remote role only when `remote_ausserhalb_erlaubt` is `false`",
        "violated is only what excludes under the scoring rule",
    ] {
        assert!(en.contains(part), "{part}");
    }
    let mut strict = profile();
    strict["harte_kriterien"]["remote_ausserhalb_erlaubt"] = json!(false);
    let de = ai_prompt(&strict, item(&view, Some(AD), Some(&a)), Language::De);
    assert!(
        de.contains("- Einsatzland DE, AT: erfüllt, Ort Hamburg"),
        "{de}"
    );
    let en = ai_prompt(&strict, item(&view, Some(AD), Some(&a)), Language::En);
    assert!(en.contains("- Country of work DE, AT: met"), "{en}");
}

#[test]
fn years_are_read_at_the_entry_or_its_competence() {
    let profile = profile();
    assert_eq!(
        entry_years(&profile, "kernkompetenzen[0].kompetenz"),
        Some(12)
    );
    assert_eq!(
        entry_years(&profile, "kernkompetenzen[0].auch[0]"),
        Some(12)
    );
    assert_eq!(entry_years(&profile, "methoden_tools[0].name"), None);
    assert_eq!(entry_years(&profile, "kernkompetenzen[9].kompetenz"), None);
    assert_eq!(entry_years(&profile, "nichts"), None);
}

// ------------------------------------------------------------------------- the ad

#[test]
fn missing_facts_are_said() {
    let mut bare = view();
    bare.company.clear();
    bare.location.clear();
    bare.mail_date = None;
    let de = ai_prompt(
        &profile(),
        item(&bare, Some("Kurzer Text."), None),
        Language::De,
    );
    for label in [
        "Unternehmen",
        "Ort",
        "Vertragsart",
        "Vergütung",
        "Start",
        "Dauer",
        "Remote-Anteil",
    ] {
        assert!(
            de.contains(&format!("- {label}: nicht erkannt")),
            "{label}:\n{de}"
        );
    }
    assert!(de.contains(de_words().no_assessment));
    let en = ai_prompt(
        &profile(),
        item(&bare, Some("Short text."), None),
        Language::En,
    );
    for label in [
        "Company",
        "Location",
        "Contract type",
        "Pay",
        "Start",
        "Duration",
        "Remote share",
    ] {
        assert!(en.contains(&format!("- {label}: not found")), "{label}");
    }
    // What the portal page states fills a gap in its own words.
    let page = Facts {
        employment_type: Some("Freiberuflich".into()),
        rate: Some("95 €/h".into()),
        duration: Some("6 Monate".into()),
        remote: Some("nach Absprache".into()),
        level: Some("Direktor".into()),
        industries: Some("Maschinenbau".into()),
        ..Facts::default()
    };
    let with_page = PromptJob {
        page: Some(&page),
        ..item(&bare, Some("Kurzer Text."), None)
    };
    let de = ai_prompt(&profile(), with_page, Language::De);
    for part in [
        "- Vertragsart: nicht erkannt",
        "- Beschäftigungsart: „Freiberuflich“ (laut Portalseite)",
        "- Vergütung: „95 €/h“ (laut Portalseite)",
        "- Dauer: „6 Monate“ (laut Portalseite)",
        "- Remote-Anteil: „nach Absprache“ (laut Portalseite)",
        "- Karrierestufe: „Direktor“ (laut Portalseite)",
        "- Branchen: „Maschinenbau“ (laut Portalseite)",
        "- Start: nicht erkannt",
    ] {
        assert!(de.contains(part), "{part}:\n{de}");
    }
}

#[test]
fn the_text_status_is_said() {
    let full = view();
    let mut teaser = view();
    teaser.detail = DetailState::Teaser;
    let mut short = view();
    short.short = true;
    let mut closed = view();
    closed.closed = true;
    let mut gone = view();
    gone.detail = DetailState::Gone;
    let de = |job: &JobView, text: Option<&str>| {
        ai_prompt(&profile(), item(job, text, None), Language::De)
    };
    assert!(de(&full, Some(AD)).contains(de_words().text_full));
    let marked = de(
        &teaser,
        Some("Die vollständige Beschreibung ist nur für Mitglieder."),
    );
    assert!(marked.contains("Nur der Anriss, den das Portal ohne Anmeldung zeigt."));
    assert!(!marked.contains(de_words().text_full));
    assert!(de(&short, Some("Interim-Mandat, Details im Gespräch.")).contains("sehr kurzen Text"));
    let none = de(&full, None);
    assert!(none.contains("Den Text der Anzeige hat die App nicht."));
    assert!(!none.contains("```text"), "no empty text block");
    assert!(
        de(&closed, Some(AD))
            .contains("- Status: Die Portalseite nimmt keine Bewerbungen mehr an.")
    );
    assert!(
        de(&gone, None).contains("- Status: Die Anzeige ist auf dem Portal nicht mehr online.")
    );
    let en = ai_prompt(
        &profile(),
        item(&teaser, Some("Teaser."), None),
        Language::En,
    );
    assert!(en.contains("Only the teaser the portal shows without signing in."));
}

#[test]
fn an_english_ad_stays_as_it_is() {
    let view = view();
    let ad = "We are looking for an Interim CFO (m/f/d).\n\nRequirements\n- 10+ years in controlling\n- Fluent German and English";
    let de = ai_prompt(&profile(), item(&view, Some(ad), None), Language::De);
    assert!(de.contains(ad), "the ad verbatim");
    assert!(de.contains("Antworte auf Deutsch"));
    assert!(de.contains("Zitate bleiben in der Sprache der Anzeige."));
    let en = ai_prompt(&profile(), item(&view, Some(AD), None), Language::En);
    assert!(
        en.contains(AD),
        "a German ad verbatim in the English prompt"
    );
    assert!(en.contains("Answer in English"));
    assert!(en.contains("Quotes stay in the language of the ad."));
    for german in [
        "Antworte",
        "Titel:",
        "Bewertungsregel",
        "Muss-Anforderungen",
        "gekürzt",
    ] {
        assert!(!outside_fences(&en).contains(german), "{german} in:\n{en}");
    }
}

#[test]
fn a_fence_is_longer_than_any_backticks_in_the_ad() {
    let view = view();
    let ad = "Kenntnisse in ```SQL``` und `Python`";
    let prompt = ai_prompt(&profile(), item(&view, Some(ad), None), Language::De);
    assert!(
        prompt.contains(&format!("````text\n{ad}\n````")),
        "{prompt}"
    );
    assert_eq!(fence_for("ohne"), "```");
}

#[test]
fn long_texts_are_cut() {
    let mut big = profile();
    big["kernkompetenzen"] = Value::Array(
        (0..2000)
            .map(|i| json!({ "kompetenz": format!("Kompetenz {i}"), "jahre": 3 }))
            .collect(),
    );
    let text = "Anforderung ".repeat(5_000);
    let view = view();
    let prompt = ai_prompt(&big, item(&view, Some(&text), None), Language::De);
    assert!(
        prompt.chars().count() < MAX_PROFILE_CHARS + MAX_AD_CHARS + 20_000,
        "{}",
        prompt.len()
    );
    assert_eq!(
        prompt.matches("[gekürzt]").count(),
        3,
        "profile and ad marked as cut, and the note says so"
    );
    assert!(prompt.contains("Der Text ist nach 12.000 Zeichen gekürzt"));
    let short = ai_prompt(&profile(), item(&view, Some(AD), None), Language::De);
    assert!(!short.contains("[gekürzt]"));
}

// ------------------------------------------------------------------------- exclusions

#[test]
fn an_excluded_job_says_why() {
    let ad = "Controlling auf Stundenbasis\n\nHonorar: 95,- € pro Stunde\nRemote: 100 %";
    let mut b = Built::new(ad);
    b.reason(
        (ReasonKind::Met, Weight::Must, ReasonCode::Requirement),
        Some("Controlling auf Stundenbasis"),
        json!({ "class": "skill" }),
        Some(("Controlling", "kernkompetenzen[0].kompetenz", Via::Exact)),
        None,
    );
    let rate = b.reason(
        (ReasonKind::Violation, Weight::Hard, ReasonCode::DayRate),
        None,
        json!({ "rate": 760, "min": "1100", "hourly": true }),
        None,
        Some("Honorar: 95,- € pro Stunde"),
    );
    let excluded = Assessment {
        verdict: Verdict::Excluded,
        score: 90,
        summary: Summary {
            must_met: 1,
            must_partial: 0,
            must_open: 0,
            must_total: 1,
            nice_met: 0,
            nice_total: 0,
            evidence: EvidenceLevel::Low,
        },
        criteria: vec![state(
            CriterionKey::MinDayRate,
            CriterionStatus::Violated,
            Some(rate),
            json!({ "rate": 95, "hourly": true }),
            Some(span(ad, "Honorar: 95,- € pro Stunde")),
        )],
        reasons: b.reasons,
        highlights: b.highlights,
        facts: KeyFacts {
            rate: Some(95),
            hourly: Some(true),
            ..KeyFacts::default()
        },
        rank: 900,
        factors: Vec::new(),
    };
    let mut job = view();
    let de = ai_prompt(
        &profile(),
        item(&job, Some(ad), Some(&excluded)),
        Language::De,
    );
    for part in [
        "- Ergebnis: ausgeschlossen durch ein hartes Kriterium, ohne den Ausschluss 90 von 100 Punkten der App",
        "- Ausschlussgrund: Der Stundensatz ergibt mal 8 etwa 760 € pro Tag, unter dem Minimum von 1.100 €. „Honorar: 95,- € pro Stunde“",
        "- Tagessatz mindestens 1.100 €: verletzt, 95 € pro Stunde, etwa 760 € pro Tag („Honorar: 95,- € pro Stunde“)",
        "- Vergütung: 95 € pro Stunde, etwa 760 € pro Tag",
        "**Ausgeschlossen**",
    ] {
        assert!(de.contains(part), "{part}:\n{de}");
    }
    assert!(!de.contains(de_words().overridden));
    job.overridden = true;
    let de = ai_prompt(
        &profile(),
        item(&job, Some(ad), Some(&excluded)),
        Language::De,
    );
    assert!(de.contains(&format!("- {}", de_words().overridden)));
    let en = ai_prompt(
        &profile(),
        item(&job, Some(ad), Some(&excluded)),
        Language::En,
    );
    for part in [
        "- Result: excluded by a hard criterion; without the exclusion 90 of the app's 100 points",
        "- Reason for the exclusion: The hourly rate times 8 gives about €760 per day, below the minimum of €1,100. \"Honorar: 95,- € pro Stunde\"",
        "- Day rate at least €1,100: violated, €95 per hour, about €760 per day (\"Honorar: 95,- € pro Stunde\")",
        "I marked the job as fitting anyway",
    ] {
        assert!(en.contains(part), "{part}:\n{en}");
    }
}

// ------------------------------------------------------------------------- no codes

/// Every engine code once, so a new one cannot go unsaid (the match is exhaustive).
fn every_code() -> Vec<ReasonCode> {
    use ReasonCode as C;
    let all = vec![
        C::Requirement,
        C::Term,
        C::Anue,
        C::DayRate,
        C::Availability,
        C::Country,
        C::AnueOptional,
        C::AnueHidden,
        C::CountryUnclear,
        C::DayRateCurrency,
        C::AvailabilityGap,
        C::StartVague,
        C::Permanent,
        C::FormalOpen,
        C::LowEvidence,
        C::ShortText,
        C::Salary,
        C::SalaryUnknown,
        C::PermanentRegion,
        C::PermanentRegionUnclear,
        C::SeniorityUnclear,
        C::Overqualified,
        C::ContractType,
        C::AnueRisk,
        C::Focus,
        C::TargetRole,
        C::DayRateWish,
        C::RemoteWish,
        C::RegionWish,
        C::IndustryWish,
        C::Workload,
        C::Duration,
        C::ExclusionWord,
    ];
    for code in &all {
        match code {
            C::Requirement
            | C::Term
            | C::Anue
            | C::DayRate
            | C::Availability
            | C::Country
            | C::AnueOptional
            | C::AnueHidden
            | C::CountryUnclear
            | C::DayRateCurrency
            | C::AvailabilityGap
            | C::StartVague
            | C::Permanent
            | C::FormalOpen
            | C::LowEvidence
            | C::ShortText
            | C::Salary
            | C::SalaryUnknown
            | C::PermanentRegion
            | C::PermanentRegionUnclear
            | C::SeniorityUnclear
            | C::Overqualified
            | C::ContractType
            | C::AnueRisk
            | C::Focus
            | C::TargetRole
            | C::DayRateWish
            | C::RemoteWish
            | C::RegionWish
            | C::IndustryWish
            | C::Workload
            | C::Duration
            | C::ExclusionWord => {}
        }
    }
    all
}

/// Every factor code once, so a new one cannot go unsaid (the match is exhaustive), with a
/// cap code the words must hide.
fn every_factor() -> Vec<Factor> {
    use FactorCode as F;
    let all = [
        F::Musts,
        F::Nice,
        F::Focus,
        F::TargetRole,
        F::Wishes,
        F::Evidence,
        F::Permanent,
        F::Cap,
    ];
    for code in &all {
        match code {
            F::Musts
            | F::Nice
            | F::Focus
            | F::TargetRole
            | F::Wishes
            | F::Evidence
            | F::Permanent
            | F::Cap => {}
        }
    }
    let params = json!({
        "met": 1, "partial": 0, "total": 2, "hit": 0, "role": "Interim CFO", "fit": "half",
        "points": 2, "evidence": "low", "percent": 90, "cap": "severalOpen", "max": 40
    });
    all.iter()
        .map(|code| factor(*code, params.clone()))
        .collect()
}

/// An excluded job with every engine code and every criterion in every state.
fn every_reason() -> Assessment {
    let params = json!({
        "rate": 900, "min": 1000, "hourly": false, "currency": "CHF", "days": 12,
        "allowed": ["DE", "AT"], "excluded": true, "stated": true, "location": "Zürich",
        "salary": 90_000, "lowerBound": true, "years": 3, "target": 10, "junior": true,
        "type": "unclear", "inferred": true, "class": "licence", "mandatory": true,
        "focus": "Controlling", "met": 1, "role": "Interim CFO", "fit": "half",
        "state": "missed", "wish": 1300, "share": 40, "level": "mostly", "industry": "Handel",
        "source": "vocabulary"
    });
    let mut b = Built::new(AD);
    for code in every_code() {
        let kind = match code {
            ReasonCode::Anue | ReasonCode::DayRate | ReasonCode::Country => ReasonKind::Violation,
            ReasonCode::Requirement | ReasonCode::Term => ReasonKind::Partial,
            code if is_preference(code) => ReasonKind::Open,
            _ => ReasonKind::Check,
        };
        let weight = match kind {
            ReasonKind::Partial => Weight::Must,
            _ => Weight::Info,
        };
        b.reason(
            (kind, weight, code),
            Some("Controlling"),
            params.clone(),
            Some(("Controlling", "kernkompetenzen[0].kompetenz", Via::General)),
            Some("Controlling"),
        );
    }
    let keys = [
        CriterionKey::MinDayRate,
        CriterionKey::Countries,
        CriterionKey::NoAnue,
        CriterionKey::NoPermanent,
        CriterionKey::Availability,
        CriterionKey::MinSalary,
        CriterionKey::PermanentRegion,
        CriterionKey::Workload,
        CriterionKey::Duration,
        CriterionKey::ExclusionWords,
    ];
    let statuses = [
        CriterionStatus::Ok,
        CriterionStatus::NotMentioned,
        CriterionStatus::Check,
        CriterionStatus::Violated,
    ];
    Assessment {
        verdict: Verdict::Excluded,
        score: 55,
        summary: Summary {
            must_met: 0,
            must_partial: 2,
            must_open: 0,
            must_total: 2,
            nice_met: 0,
            nice_total: 0,
            evidence: EvidenceLevel::Low,
        },
        criteria: keys
            .iter()
            .zip(statuses.iter().cycle())
            .map(|(key, status)| state(*key, *status, Some(3), params.clone(), None))
            .collect(),
        reasons: b.reasons,
        highlights: b.highlights,
        facts: KeyFacts {
            rate: Some(900),
            currency: Some("CHF".into()),
            start: Some("vague".into()),
            contract: Some("anue".into()),
            ..KeyFacts::default()
        },
        rank: 1,
        factors: every_factor(),
    }
}

#[test]
fn no_engine_code_reaches_a_prompt() {
    let every = every_reason();
    let rich = json!({
        "harte_kriterien": {
            "min_tagessatz": 1000, "laender": ["DE"], "min_jahresgehalt": 120_000,
            "festanstellung_orte": ["München", "Augsburg", "Landshut", "Freising", "Erding", "Dachau"],
            "festanstellung_remote_min": 60, "zielprofil_min_jahre": 10,
            "verfuegbar_ab": "sofort", "ausgeschlossene_vertragsarten": ["anue", "festanstellung"]
        },
        "kernkompetenzen": [{ "kompetenz": "Controlling", "jahre": 5 }]
    });
    // camelCase with two small letters in front (the rubric's "iGZ" is a German abbreviation).
    let camel = regex::Regex::new(r"\b[a-z]{2,}[A-Z][A-Za-z]*\b").unwrap();
    let path = regex::Regex::new(r"[a-z_]+\[\d+\]").unwrap();
    let raw_words = regex::Regex::new(r"\b(exact|stem|vocabulary)\b").unwrap();
    let view = view();
    for language in [Language::De, Language::En] {
        let prompt = ai_prompt(&rich, item(&view, Some(AD), Some(&every)), language);
        let prose = outside_fences(&prompt);
        let codes: Vec<&str> = camel.find_iter(&prose).map(|m| m.as_str()).collect();
        assert!(codes.is_empty(), "engine codes {codes:?} in:\n{prose}");
        assert!(!path.is_match(&prose), "a JSON path in:\n{prose}");
        assert!(!raw_words.is_match(&prose), "a raw param in:\n{prose}");
        for raw in ["\"type\"", "{", "}"] {
            assert!(!prose.contains(raw), "{raw} in:\n{prose}");
        }
    }
}

#[test]
fn the_prompts_name_no_product_and_carry_the_rubric() {
    both(|language, prompt| {
        for product in [
            "Claude",
            "ChatGPT",
            "Gemini",
            "Copilot",
            "OpenAI",
            "Anthropic",
        ] {
            assert!(!prompt.contains(product), "{product}");
        }
        let (rubric, method) = match language {
            Language::De => (de_words().rubric, "# Arbeitsweise"),
            Language::En => (en::English.words().rubric, "# How to work"),
        };
        assert!(prompt.contains(rubric.trim_end()), "the rubric whole");
        assert!(prompt.find(method) < prompt.find(rubric.trim_end()));
    });
    assert!(de_words().rubric.starts_with("# Bewertungsregel"));
    assert!(en::English.words().rubric.starts_with("# Scoring rule"));
}

/// The other listings a portal shows under an ad are no part of it, as for the engine: the
/// rubric of the prompt says so (an ANÜ in a footer excludes nothing).
#[test]
fn the_rubric_leaves_out_the_other_listings_under_an_ad() {
    let flat = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(flat(de_words().rubric).contains(
        "Die weiteren Anzeigen, die ein Portal unter einer Anzeige zeigt (etwa „Ähnliche Projekte“ oder „Similar jobs“), gehören nicht zu ihr. Keine Regel liest sie, und sie schließen nichts aus."
    ));
    assert!(flat(en::English.words().rubric).contains(
        "The other listings a portal shows under an ad (such as “Similar jobs” or „Ähnliche Projekte“) are no part of it. No rule reads them, and they exclude nothing."
    ));
}

// ------------------------------------------------------------------------- the real engine

/// A stored job with `text`, assessed by the real engine through [`PromptSource::load`].
fn stored(url: &str, title: &str, text: &str, profile: &Value) -> PromptSource {
    let store = Store::in_memory().unwrap();
    let run = store.begin_run().unwrap();
    let link = job_link(url).unwrap();
    let posting = Posting::new(link.key.clone(), link.url, title, "Muster AG", "Hamburg");
    let mail = MailRef {
        subject: "Neue Projekte",
        date: Some("2026-09-24T07:00:00Z".parse().unwrap()),
        gmail_id: None,
    };
    let now = Timestamp::now();
    store.upsert_posting(run, &posting, mail, now).unwrap();
    store
        .record_text(&link.key, text, false, false, now)
        .unwrap();
    let row = store.job(&link.key).unwrap().unwrap();
    let matcher = LocalMatcher::new(compile_profile(profile));
    PromptSource::load(&store, Some(&matcher), &row).unwrap()
}

#[test]
fn the_real_engine_behind_a_stored_job() {
    let profile: Value = serde_json::from_str(crate::pipeline::demo::PROFILE_JSON).unwrap();
    let fits = stored(
        "https://www.freelancermap.de/nproj/2999101.html",
        "Interim CFO (m/w/d)",
        "Wir suchen ab sofort einen Interim CFO (m/w/d).\n\nAnforderungen:\n- Erfahrung im Controlling\n- Konzernrechnungslegung nach IFRS\n- Erfahrung mit SAP S/4HANA\n\nRahmenbedingungen:\n- Tagessatz 1.200 €\n- Einsatzort Hamburg",
        &profile,
    );
    let prompt = ai_prompt(&profile, fits.job(), Language::De);
    for part in [
        "- Ergebnis: ",
        " von 100 Punkten der App, hohe Übereinstimmung",
        "- Tagessatz mindestens 1.000 €: erfüllt, 1.200 € pro Tag („Tagessatz 1.200 €“)",
        "- Vergütung: 1.200 € pro Tag",
        "- Start: ab sofort",
        "- „Erfahrung im Controlling“ (Muss): Profil Controlling, 18 Jahre",
        "- Datum der Alert-Mail: 24.09.2026",
    ] {
        assert!(prompt.contains(part), "{part}:\n{prompt}");
    }
    let excluded = stored(
        "https://www.freelancermap.de/nproj/2999102.html",
        "Projektleiter S/4HANA",
        "Für die Einführung von SAP S/4HANA suchen wir eine Projektleitung (m/w/d).\n\nAnforderungen:\n- Projektmanagement in SAP-Einführungen\n- Erfahrung mit SAP S/4HANA\n\nRahmenbedingungen:\n- Tagessatz bis 800 €\n- 100 % remote",
        &profile,
    );
    let prompt = ai_prompt(&profile, excluded.job(), Language::De);
    for part in [
        "- Ergebnis: ausgeschlossen durch ein hartes Kriterium",
        "- Ausschlussgrund: Der Tagessatz von 800 € liegt unter dem Minimum von 1.000 €. „Tagessatz bis 800 €“",
        "- Tagessatz mindestens 1.000 €: verletzt, 800 € pro Tag („Tagessatz bis 800 €“)",
    ] {
        assert!(prompt.contains(part), "{part}:\n{prompt}");
    }
    // Without a usable profile the job has no assessment, and the prompt says so.
    let bare = stored(
        "https://www.freelancermap.de/nproj/2999103.html",
        "Controller",
        "Text",
        &json!({}),
    );
    assert!(bare.assessment.is_none());
}

// ------------------------------------------------------------------------- passages

#[test]
fn passages_follow_utf16_offsets() {
    let text = "Größe 🙂 und „Zitat“ am Ende";
    assert_eq!(passage(text, span(text, "„Zitat“")), Some("„Zitat“".into()));
    assert_eq!(passage(text, span(text, "am Ende")), Some("am Ende".into()));
    assert_eq!(passage(text, (5, 5)), None);
    assert_eq!(passage(text, (900, 950)), None);
    let long = "x".repeat(400);
    let cut = passage(&long, (0, 400)).unwrap();
    assert_eq!(cut.chars().count(), MAX_PASSAGE_CHARS);
    assert!(cut.ends_with('…'));
}

// ------------------------------------------------------------------------- golden samples

/// One full prompt per language, checked in: a change to the prompt shows as a diff of
/// `core/tests/fixtures/prompts/` (the test writes the new text and fails once - look at the
/// diff and commit it).
#[test]
fn golden_prompts() {
    let view = view();
    let a = assessment();
    let mut changed = Vec::new();
    for (language, name) in [(Language::De, "job.de.md"), (Language::En, "job.en.md")] {
        let prompt = ai_prompt(&profile(), item(&view, Some(AD), Some(&a)), language);
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/prompts")
            .join(name);
        let stored = std::fs::read_to_string(&path)
            .unwrap_or_default()
            .replace("\r\n", "\n");
        if stored != prompt {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, &prompt).unwrap();
            changed.push(path.display().to_string());
        }
    }
    assert!(
        changed.is_empty(),
        "regenerated {changed:?} - check the diff and commit it"
    );
}

#[test]
fn money_and_numbers() {
    assert_eq!(grouped(1450, '.'), "1.450");
    assert_eq!(grouped(150_000, ','), "150,000");
    assert_eq!(grouped(999, '.'), "999");
    assert_eq!(grouped(-1200, '.'), "-1.200");
    assert_eq!(as_int(&json!("1000")), Some(1000));
    assert_eq!(as_int(&json!(12.6)), Some(13));
    let params: Map<String, Value> = json!({ "a": ["DE", "AT"], "b": "DE, AT" })
        .as_object()
        .cloned()
        .unwrap();
    assert_eq!(list_param(&params, "a"), list_param(&params, "b"));
}
