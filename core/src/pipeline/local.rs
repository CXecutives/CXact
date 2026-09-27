//! The matching engine behind [`Matcher`]: one compiled profile, its revision
//! `e{ENGINE_VERSION}.{INPUTS}:{fingerprint}`, what a stored job hands the engine (text, page
//! facts, teaser or full text) and the mapping of an [`Assessment`] onto what the store keeps
//! per job ([`MatchRecord`]).

use serde_json::{Map, Value};

use super::Matcher;
use crate::matching::{
    self, Assessment, CompiledProfile, CoreTerm, JobInput, ProfileQuality, ReasonCode, ReasonKind,
    TextKind, Verdict, Weight, fact_key,
};
use crate::model::{DescStatus, MatchRecord, MatchStatus, Notice, is_usable_title};
use crate::portal::Facts;
use crate::store::{JobRow, Judgement};

/// Met requirements quoted in the list row.
const TOP: usize = 2;

/// Open terms a stored match keeps ("Häufig verlangt" counts them across the jobs).
pub const MAX_TERMS: usize = 8;

/// Version of what a stored job hands the engine besides its text, and of what the store
/// keeps of the assessment (2: page facts and the teaser flag; 3: the company, for the
/// industry wish; 4: career level, industries and a remote field in words; 5: the workload
/// in the stored facts; 6: the open terms for "Häufig verlangt"; 7: an open term is a
/// requirement whose words hold a term, [`open_term`]). Part of the revision: a change scores
/// every stored job again.
const INPUTS: u32 = 7;

/// The local engine with one profile.
pub struct LocalMatcher {
    profile: CompiledProfile,
    rev: String,
}

impl LocalMatcher {
    pub fn new(profile: CompiledProfile) -> LocalMatcher {
        let rev = format!(
            "e{}.{INPUTS}:{}",
            matching::ENGINE_VERSION,
            profile.fingerprint()
        );
        LocalMatcher { profile, rev }
    }

    /// Compiles a profile file's JSON (anything that is no object gives an empty profile).
    pub fn from_json(value: &Value) -> LocalMatcher {
        LocalMatcher::new(matching::compile_profile(value))
    }

    pub fn profile(&self) -> &CompiledProfile {
        &self.profile
    }

    /// The profile names competences: jobs can be scored. An empty profile scores nothing
    /// and leaves nothing pending.
    pub fn usable(&self) -> bool {
        self.profile.quality() != ProfileQuality::Empty
    }

    /// The full assessment of a job (`text`: its stored description, if any) with the facts
    /// its page stated; a teaser is judged as one. A job without text is judged from title
    /// and location alone - usually `unscorable`, but a clear location can already exclude it.
    pub fn assessment(&self, job: &JobRow, text: Option<&str>) -> Option<Assessment> {
        let title = if is_usable_title(&job.title) {
            job.title.clone()
        } else {
            crate::view::slug_title(job.url.as_str()).unwrap_or_default()
        };
        let posted = crate::time::local_date(job.mail_date.unwrap_or(job.first_seen_at));
        let facts = job.facts.as_ref().and_then(engine_facts);
        let kind = if job.desc_status == DescStatus::Teaser {
            TextKind::Teaser
        } else {
            TextKind::Full
        };
        let input = JobInput {
            title: &title,
            company: &job.company,
            location: &job.location,
            portal: job.key.portal,
            text: text.unwrap_or_default(),
            facts: facts.as_ref(),
            posted: Some(posted),
            kind,
        };
        matching::assess(&self.profile, &input, None)
    }
}

impl Matcher for LocalMatcher {
    fn rev(&self) -> &str {
        &self.rev
    }

    fn assess(&self, job: &JobRow, text: Option<&str>) -> Option<MatchRecord> {
        self.assessment(job, text).map(|a| record(&a))
    }

    fn judge(&self, job: &JobRow, text: Option<&str>) -> Option<Judgement> {
        self.assessment(job, text).map(|a| judgement(&a))
    }

    fn explain(&self, job: &JobRow, text: Option<&str>) -> Option<Assessment> {
        self.assessment(job, text)
    }
}

/// The stored page facts under the keys the engine reads ([`fact_key`]); `None` if the page
/// stated none of them. Pages state no location of their own: the engine keeps the job's.
pub(crate) fn engine_facts(facts: &Facts) -> Option<Value> {
    let mut map = Map::new();
    let mut put = |key: &str, value: Option<Value>| {
        if let Some(value) = value {
            map.insert(key.to_owned(), value);
        }
    };
    put(
        fact_key::CONTRACT,
        facts.employment_type.clone().map(Value::from),
    );
    put(
        fact_key::REMOTE_PERCENT,
        facts
            .remote_percent
            .or_else(|| facts.remote.as_deref().and_then(remote_share))
            .map(Value::from),
    );
    put(fact_key::RATE, facts.rate.clone().map(Value::from));
    put(fact_key::START, facts.start.clone().map(Value::from));
    put(fact_key::DURATION, facts.duration.clone().map(Value::from));
    put(fact_key::LEVEL, facts.level.clone().map(Value::from));
    put(
        fact_key::INDUSTRIES,
        facts.industries.clone().map(Value::from),
    );
    (!map.is_empty()).then_some(Value::Object(map))
}

/// The remote share a page's remote field states in words, when it gives no percentage:
/// on site only is 0, fully remote 100; anything in between (partly, by arrangement) stays
/// unknown. German and English page words, do not translate.
fn remote_share(text: &str) -> Option<u8> {
    let folded = text.to_lowercase();
    let has = |words: &[&str]| words.iter().any(|w| folded.contains(w));
    let partly = has(&[
        "teil",
        "hybrid",
        "absprache",
        "möglich",
        "moglich",
        "optional",
        "partly",
        "partial",
    ]);
    if partly {
        return None;
    }
    if has(&[
        "vor ort",
        "on-site",
        "onsite",
        "on site",
        "präsenz",
        "kein remote",
        "no remote",
    ]) {
        return Some(0);
    }
    if has(&[
        "100% remote",
        "100 % remote",
        "voll remote",
        "komplett remote",
        "vollständig remote",
        "nur remote",
        "fully remote",
        "full remote",
    ]) {
        return Some(100);
    }
    None
}

/// What the list keeps of an assessment: status, score, the one note, must counts and up to
/// two met requirements.
pub fn record(assessment: &Assessment) -> MatchRecord {
    let status = match assessment.verdict {
        Verdict::Scored => MatchStatus::Scored,
        Verdict::Excluded => MatchStatus::Excluded,
        Verdict::Unscorable => MatchStatus::Unscorable,
    };
    MatchRecord {
        status,
        score: assessment.score,
        note: note(assessment),
        must_met: assessment.summary.must_met,
        must_total: assessment.summary.must_total,
        top: top(assessment),
        facts: assessment.facts.clone(),
        rank: assessment.rank,
    }
}

/// The statement of the list row: the first decided violation of an excluded job, why an
/// unscorable one has no score, else the first point to check (`None` if nothing).
fn note(assessment: &Assessment) -> Option<Notice> {
    let first = |kind: ReasonKind| assessment.reasons.iter().find(|r| r.kind == kind);
    let reason = match assessment.verdict {
        Verdict::Excluded => first(ReasonKind::Violation),
        Verdict::Unscorable => assessment
            .reasons
            .iter()
            .find(|r| r.code == ReasonCode::ShortText)
            .or_else(|| first(ReasonKind::Check)),
        Verdict::Scored => first(ReasonKind::Check),
    }?;
    Some(Notice {
        code: code_name(&reason.code),
        params: flat_params(&reason.params),
    })
}

/// What the store keeps of an assessment: its [`record`], up to two open must requirements
/// ([`open`]) and its open terms ([`terms`]).
pub fn judgement(assessment: &Assessment) -> Judgement {
    Judgement {
        record: record(assessment),
        open: open(assessment),
        terms: terms(assessment),
    }
}

/// The open must and nice requirements that are skills and hold a term ([`open_term`]; a
/// language, a degree or a licence is no competence), the musts first, each in the ad's order
/// and once (case aside), at most [`MAX_TERMS`], in the ad's words: what "Häufig verlangt"
/// counts across the jobs by their terms (`view::asked_terms`), so a change of what a term
/// stands for needs no scoring again.
pub fn terms(assessment: &Assessment) -> Vec<String> {
    let open = |weight: Weight| {
        assessment.reasons.iter().filter(move |r| {
            r.weight == weight
                && r.params.get("class").and_then(Value::as_str) == Some("skill")
                && open_term(r).is_some()
        })
    };
    let mut out: Vec<String> = Vec::new();
    for reason in open(Weight::Must).chain(open(Weight::Nice)) {
        let Some(label) = reason.label.as_deref().map(str::trim) else {
            continue;
        };
        if !out.iter().any(|t| t.to_lowercase() == label.to_lowercase()) {
            out.push(label.to_owned());
        }
        if out.len() == MAX_TERMS {
            break;
        }
    }
    out
}

/// The term and profile field of an open requirement the profile could take (the reader's
/// "+", "Häufig verlangt"): a keyword of the ad or a bullet, never a sentence of the ad, a
/// soft skill or a frame condition, whose words hold a term (`matching::core_term`:
/// "Kenntnisse in Anaplan" is the tool "Anaplan").
pub fn open_term(reason: &matching::Reason) -> Option<CoreTerm> {
    let class = reason.params.get("class").and_then(Value::as_str);
    let offered = reason.kind == ReasonKind::Open
        && matches!(class, Some("skill" | "language" | "degree" | "licence"))
        && match reason.code {
            ReasonCode::Term => true,
            ReasonCode::Requirement => {
                reason.params.get("source").and_then(Value::as_str) != Some("sentence")
            }
            _ => false,
        };
    if offered {
        matching::core_term(reason.label.as_deref()?)
    } else {
        None
    }
}

/// Up to two open must requirements quoted from the ad, in the ad's order: the list's
/// `open`.
pub fn open(assessment: &Assessment) -> Vec<String> {
    assessment
        .reasons
        .iter()
        .filter(|r| {
            r.kind == ReasonKind::Open
                && r.weight == Weight::Must
                && matches!(r.code, ReasonCode::Requirement | ReasonCode::Term)
        })
        .filter_map(|r| r.label.clone())
        .take(TOP)
        .collect()
}

/// Up to two met requirements quoted from the ad, musts first.
fn top(assessment: &Assessment) -> Vec<String> {
    let met = |weight: Weight| {
        assessment.reasons.iter().filter(move |r| {
            r.kind == ReasonKind::Met
                && r.weight == weight
                && matches!(r.code, ReasonCode::Requirement | ReasonCode::Term)
        })
    };
    met(Weight::Must)
        .chain(met(Weight::Nice))
        .filter_map(|r| r.label.clone())
        .take(TOP)
        .collect()
}

/// The camelCase name of a serialisable code (`ReasonCode::DayRate` -> `dayRate`).
pub(crate) fn code_name(code: &impl serde::Serialize) -> String {
    match serde_json::to_value(code) {
        Ok(Value::String(name)) => name,
        _ => String::new(),
    }
}

/// Params as the interface takes them: scalars only. Lists of scalars become one
/// comma-separated string (`["DE", "AT"]` -> `"DE, AT"`), nested objects are dropped.
pub(crate) fn flat_params(params: &Map<String, Value>) -> Map<String, Value> {
    params
        .iter()
        .filter_map(|(key, value)| {
            let flat = match value {
                Value::Array(items) => Value::String(
                    items
                        .iter()
                        .filter_map(|item| match item {
                            Value::String(s) => Some(s.clone()),
                            Value::Number(n) => Some(n.to_string()),
                            Value::Bool(b) => Some(b.to_string()),
                            _ => None,
                        })
                        .collect::<Vec<_>>()
                        .join(", "),
                ),
                Value::Object(_) => return None,
                scalar => scalar.clone(),
            };
            Some((key.clone(), flat))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use jiff::Timestamp;
    use serde_json::json;

    use super::*;
    use crate::matching::{TERM_WORDS, TermField};
    use crate::model::Posting;
    use crate::portal::{JobKey, job_link};
    use crate::store::{MailRef, Store};

    fn profile() -> Value {
        serde_json::from_str(super::super::demo::PROFILE_JSON).unwrap()
    }

    /// A stored job with `text` as its description (none if empty).
    fn job(title: &str, location: &str, text: &str) -> (Store, JobKey) {
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let link = job_link("https://www.linkedin.com/jobs/view/4000000001/").unwrap();
        let posting = Posting::new(link.key.clone(), link.url, title, "Muster AG", location);
        let mail = MailRef {
            subject: "Neue Jobs",
            date: Some("2026-09-18T07:00:00Z".parse().unwrap()),
            gmail_id: None,
        };
        let now = Timestamp::now();
        store.upsert_posting(run, &posting, mail, now).unwrap();
        if !text.is_empty() {
            store
                .record_text(&link.key, text, false, false, now)
                .unwrap();
        }
        (store, link.key)
    }

    fn assess(matcher: &LocalMatcher, title: &str, location: &str, text: &str) -> MatchRecord {
        let (store, key) = job(title, location, text);
        let row = store.job(&key).unwrap().unwrap();
        let text = store.description(&key).unwrap();
        matcher.assess(&row, text.as_deref()).unwrap()
    }

    const FIT: &str = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Konzernrechnungslegung nach IFRS
- Erfahrung mit SAP S/4HANA
- Kenntnisse in Zollabwicklung

Rahmenbedingungen:
- Einsatzort Hamburg";

    #[test]
    fn the_revision_names_engine_and_profile() {
        let matcher = LocalMatcher::from_json(&profile());
        let rev = matcher.rev();
        let prefix = format!("e{}.{INPUTS}:", matching::ENGINE_VERSION);
        assert!(rev.starts_with(&prefix), "{rev}");
        assert_eq!(rev.len(), prefix.len() + 16);
        assert_eq!(rev, LocalMatcher::from_json(&profile()).rev(), "stable");
        let mut other = profile();
        other["keywords"] = json!(["Treasury"]);
        assert_ne!(rev, LocalMatcher::from_json(&other).rev());
        assert!(matcher.usable());
        let empty = LocalMatcher::from_json(&json!({"name": "Nur ein Name"}));
        assert!(!empty.usable());
        let (store, key) = job("Interim CFO", "Hamburg", FIT);
        let row = store.job(&key).unwrap().unwrap();
        assert_eq!(
            empty.assess(&row, Some(FIT)),
            None,
            "an empty profile judges nothing"
        );
    }

    #[test]
    fn a_scored_job_keeps_counts_and_two_met_quotes() {
        let matcher = LocalMatcher::from_json(&profile());
        let record = assess(&matcher, "Interim CFO (m/w/d)", "Hamburg", FIT);
        assert_eq!(record.status, MatchStatus::Scored);
        assert!(record.score >= 40, "{record:?}");
        assert_eq!((record.must_met, record.must_total), (3, 4), "{record:?}");
        assert_eq!(
            record.top,
            [
                "Erfahrung im Controlling",
                "Konzernrechnungslegung nach IFRS"
            ]
        );
        assert_eq!(record.note, None, "nothing to check");
        // The one open must, quoted like the met ones; the judgement keeps the same record.
        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", FIT);
        let row = store.job(&key).unwrap().unwrap();
        let judged = matcher.judge(&row, Some(FIT)).unwrap();
        assert_eq!(judged.record, record);
        assert_eq!(judged.open, ["Kenntnisse in Zollabwicklung"]);
        assert_eq!(judged.terms, ["Kenntnisse in Zollabwicklung"], "a term too");
    }

    /// The open terms: musts first, then nice ones, each once; a sentence, a language, a met
    /// or a partly met requirement is none of them.
    #[test]
    fn the_open_terms_are_musts_then_nice_ones() {
        let matcher = LocalMatcher::from_json(&profile());
        let text = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Kenntnisse in Zollabwicklung
- Kenntnisse in Zollabwicklung
- Erfahrung mit Lagerverwaltungssystemen in der Hafenlogistik des Hamburger Hafens

Wünschenswert:
- Erfahrung mit Qlik Sense
- Portugiesisch in Wort und Schrift

Rahmenbedingungen:
- Einsatzort Hamburg";
        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", text);
        let row = store.job(&key).unwrap().unwrap();
        let judged = matcher.judge(&row, Some(text)).unwrap();
        assert_eq!(
            judged.terms,
            ["Kenntnisse in Zollabwicklung", "Erfahrung mit Qlik Sense"],
            "{:?}",
            matcher.explain(&row, Some(text)).map(|a| a.reasons)
        );
        let reasons = matcher.explain(&row, Some(text)).unwrap().reasons;
        let long = |r: &&matching::Reason| {
            r.label
                .as_deref()
                .is_some_and(|l| l.split_whitespace().count() > TERM_WORDS)
        };
        assert!(
            reasons
                .iter()
                .filter(long)
                .any(|r| r.kind == ReasonKind::Open && r.weight == Weight::Must),
            "an open must of more words stays out: {reasons:?}"
        );
        let language = |r: &&matching::Reason| {
            r.params.get("class").and_then(Value::as_str) == Some("language")
        };
        assert!(
            reasons
                .iter()
                .filter(language)
                .any(|r| r.kind == ReasonKind::Open && r.weight == Weight::Nice),
            "an open language stays out: {reasons:?}"
        );
    }

    /// An open requirement the profile could take gives its term and field; a met one, a
    /// sentence of the ad and a frame condition give none.
    #[test]
    fn the_term_of_an_open_requirement() {
        let matcher = LocalMatcher::from_json(&profile());
        let text = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Kenntnisse in Anaplan
- Branchenerfahrung Energie
- Sehr gute Portugiesischkenntnisse
- Reisebereitschaft

Wünschenswert:
- Erfahrung mit Jedox von Vorteil";
        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", text);
        let row = store.job(&key).unwrap().unwrap();
        let reasons = matcher.explain(&row, Some(text)).unwrap().reasons;
        let term = |label: &str| {
            let reason = reasons
                .iter()
                .find(|r| r.label.as_deref() == Some(label))
                .unwrap_or_else(|| panic!("{label}: {reasons:?}"));
            open_term(reason).map(|t| (t.term, t.field))
        };
        assert_eq!(
            term("Kenntnisse in Anaplan"),
            Some(("Anaplan".into(), TermField::Tool))
        );
        assert_eq!(
            term("Branchenerfahrung Energie"),
            Some(("Energie".into(), TermField::Industry))
        );
        assert_eq!(
            term("Erfahrung mit Jedox von Vorteil"),
            Some(("Jedox".into(), TermField::Tool))
        );
        assert_eq!(
            term("Sehr gute Portugiesischkenntnisse"),
            Some(("Portugiesisch".into(), TermField::Language))
        );
        assert_eq!(term("Reisebereitschaft"), None, "a frame condition");
        assert_eq!(term("Erfahrung im Controlling"), None, "met");
        let judged = matcher.judge(&row, Some(text)).unwrap();
        assert!(
            judged
                .terms
                .contains(&"Erfahrung mit Jedox von Vorteil".to_owned()),
            "stored in the ad's words: {:?}",
            judged.terms
        );
    }

    #[test]
    fn the_note_says_why_excluded_unscorable_or_what_to_check() {
        let matcher = LocalMatcher::from_json(&profile());
        let excluded = assess(
            &matcher,
            "Interim CFO",
            "Hamburg",
            &format!("{FIT}\n- Tagessatz bis 700 €"),
        );
        assert_eq!(excluded.status, MatchStatus::Excluded);
        let note = excluded.note.unwrap();
        assert_eq!(note.code, "dayRate");
        assert_eq!(note.params["min"], "1000", "{note:?}");
        let country = assess(&matcher, "Interim CFO", "Paris, Frankreich", "");
        assert_eq!(country.status, MatchStatus::Excluded, "{country:?}");
        let country = country.note.unwrap();
        assert_eq!(country.code, "country");
        assert!(
            country
                .params
                .values()
                .all(|v| !v.is_array() && !v.is_object()),
            "lists are flattened for the interface: {country:?}"
        );
        let untold = assess(&matcher, "Interim CFO", "Hamburg", "");
        assert_eq!(untold.status, MatchStatus::Unscorable);
        assert_eq!(
            (untold.score, untold.note.unwrap().code.as_str()),
            (0, "shortText")
        );
        let check = assess(
            &matcher,
            "Interim CFO",
            "Hamburg",
            &format!("{FIT}\n- Einsatz optional im Rahmen der Arbeitnehmerüberlassung"),
        );
        assert_eq!(check.status, MatchStatus::Scored, "{check:?}");
        assert_eq!(check.note.unwrap().code, "anueOptional");
    }

    #[test]
    fn params_become_scalars() {
        let params = json!({"a": ["DE", "AT"], "b": 3, "c": {"x": 1}, "d": null, "e": [1, true]});
        let flat = flat_params(params.as_object().unwrap());
        assert_eq!(
            Value::Object(flat),
            json!({"a": "DE, AT", "b": 3, "d": null, "e": "1, true"})
        );
        assert_eq!(code_name(&ReasonCode::AvailabilityGap), "availabilityGap");
    }

    /// The facts a job page stated and the teaser flag reach the engine: a rate only the
    /// page head names excludes the job, and a teaser is judged as one.
    #[test]
    fn stored_facts_and_the_teaser_reach_the_engine() {
        let matcher = LocalMatcher::from_json(&profile());
        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", FIT);
        let row = store.job(&key).unwrap().unwrap();
        let plain = matcher.assess(&row, Some(FIT)).unwrap();
        assert_eq!(plain.status, MatchStatus::Scored, "{plain:?}");
        let facts = Facts {
            rate: Some("700 € pro Tag".into()),
            employment_type: Some("Freiberuflich".into()),
            ..Facts::default()
        };
        store.record_parse(&key, 1, Some(&facts)).unwrap();
        let row = store.job(&key).unwrap().unwrap();
        assert_eq!(row.facts.as_ref(), Some(&facts));
        let record = matcher.assess(&row, Some(FIT)).unwrap();
        assert_eq!(record.status, MatchStatus::Excluded, "{record:?}");
        assert_eq!(record.note.unwrap().code, "dayRate");

        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", "");
        store.record_teaser(&key, FIT, Timestamp::now()).unwrap();
        let row = store.job(&key).unwrap().unwrap();
        let text = store.description(&key).unwrap();
        let teaser = matcher.assessment(&row, text.as_deref()).unwrap();
        assert_eq!(teaser.summary.evidence, matching::EvidenceLevel::Teaser);
    }

    /// New page facts make a stored score stale.
    #[test]
    fn other_facts_score_the_job_again() {
        let matcher = LocalMatcher::from_json(&profile());
        let (store, key) = job("Interim CFO (m/w/d)", "Hamburg", FIT);
        let row = store.job(&key).unwrap().unwrap();
        let record = matcher.assess(&row, Some(FIT)).unwrap();
        let now = Timestamp::now();
        store
            .save_matches(&[(key.clone(), record)], matcher.rev(), now)
            .unwrap();
        let facts = Facts {
            start: Some("ab sofort".into()),
            ..Facts::default()
        };
        store.record_parse(&key, 1, Some(&facts)).unwrap();
        assert_eq!(store.match_rev(&key).unwrap(), None, "facts changed");
        store
            .save_matches(
                &[(key.clone(), matcher.assess(&row, Some(FIT)).unwrap())],
                matcher.rev(),
                now,
            )
            .unwrap();
        store.record_parse(&key, 1, Some(&facts)).unwrap();
        assert_eq!(
            store.match_rev(&key).unwrap().as_deref(),
            Some(matcher.rev()),
            "the same facts keep the score"
        );
    }

    /// Every key the engine reads comes from a field of the stored facts - except the
    /// location, which pages do not state apart from the job's own.
    #[test]
    fn the_stored_facts_feed_every_engine_key() {
        let all = Facts {
            employment_type: Some("Freiberuflich".into()),
            level: Some("Direktor".into()),
            function: Some("Finanzen".into()),
            industries: Some("Maschinenbau".into()),
            remote_percent: Some(60),
            remote: Some("teilweise".into()),
            start: Some("ab sofort".into()),
            duration: Some("6 Monate".into()),
            rate: Some("95 €/h".into()),
            skills: vec!["SAP".into()],
        };
        let fed = engine_facts(&all).unwrap();
        let mut keys: Vec<&str> = fed
            .as_object()
            .unwrap()
            .keys()
            .map(String::as_str)
            .collect();
        keys.sort_unstable();
        let mut expected: Vec<&str> = fact_key::ALL
            .iter()
            .copied()
            .filter(|k| *k != fact_key::LOCATION)
            .collect();
        expected.sort_unstable();
        assert_eq!(keys, expected);
        assert_eq!(fed[fact_key::REMOTE_PERCENT], 60);
        assert_eq!(engine_facts(&Facts::default()), None);
    }

    /// A remote field in words (freelance.de's head) reaches the engine as a share when it
    /// is clear: on site only 0, fully remote 100, anything in between unknown.
    #[test]
    fn a_remote_field_in_words() {
        let share = |text: &str| {
            let facts = Facts {
                remote: Some(text.into()),
                ..Facts::default()
            };
            engine_facts(&facts).and_then(|f| f[fact_key::REMOTE_PERCENT].as_u64())
        };
        assert_eq!(share("vor Ort"), Some(0));
        assert_eq!(share("Onsite"), Some(0));
        assert_eq!(share("Komplett remote"), Some(100));
        assert_eq!(share("teilweise remote"), None);
        assert_eq!(share("Remote nach Absprache möglich"), None);
        assert_eq!(share("Hybrid"), None);
    }
}
