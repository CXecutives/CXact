//! Hard criteria of the engine (V10-V13), structured facts first. A violation is
//! decided only on clear wording; everything unclear becomes a check:
//! ANÜ (named, not negated, not optional) · permanent employment (excluded by the profile:
//! a stated permanent role, not an inferred one or one that offers interim too) · projects
//! and interim work (excluded by the profile: an interim role, not one that offers a
//! permanent role too) · work
//! country (location, on-site sentence, not fully remote) · day rate (EUR, upper bound,
//! hourly x 8; not for employment pay: a permanent role, temporary agency work or a wage) ·
//! availability (never decided: a gap or a vague start is a check).

use std::collections::HashMap;
use std::ops::Range;

use std::sync::LazyLock;

use jiff::civil::Date;
use regex::Regex;
use serde_json::{Value, json};

use super::atoms::fold;
use super::contract::{Contract, ContractKind};
use super::lexicon::engine as lex;
use super::normalize::{
    amount_at, clauses, contains_word, find_word, month_named, numeric_date, quarter, sentences,
    splitlines, word_bounded,
};
use super::params::HOURS_PER_DAY;
use super::types::{CriterionKey, ReasonCode, ReasonKind};
use crate::portal::Portal;
use crate::profile::{ProfileForm, Workload};

/// When the consultant is available.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Availability {
    Now,
    From(Date),
}

/// Hard criteria as the engine reads them from the profile.
#[derive(Debug, Clone)]
pub(crate) struct HardCriteria {
    pub min_rate: Option<i128>,
    pub countries: Option<Vec<String>>,
    /// Zeitarbeit (ANÜ) is not among the contract types.
    pub anue_excluded: bool,
    /// Festanstellung is not among the contract types.
    pub permanent_excluded: bool,
    /// Projekt (projects and interim work) is not among the contract types.
    pub project_excluded: bool,
    pub available: Availability,
    /// Minimum annual salary (EUR) for permanent roles and temporary agency work.
    pub min_salary: Option<u64>,
    /// Days per week (1 to 5) the consultant works at least and at most.
    pub workload_min: Option<u8>,
    pub workload_max: Option<u8>,
    /// Minimum duration of an engagement in months.
    pub min_months: Option<u16>,
    /// Words that exclude an ad, as written.
    pub exclusion_words: Vec<String>,
}

/// The days a full-time engagement takes at least, a part-time one at most (Auslastung).
const FULLTIME_DAYS: u8 = 4;
const PARTTIME_DAYS: u8 = 3;

/// A country of the profile as its ISO code: a two-letter code as written ("UK" is GB), or a
/// country name the engine knows ("Deutschland", "Österreich", "Switzerland"); `None` for
/// anything else, so an unknown name is never a country.
pub(crate) fn country_code(entry: &str) -> Option<String> {
    let text = entry.trim();
    if text.len() == 2 && text.chars().all(|c| c.is_ascii_alphabetic()) {
        let code = text.to_ascii_uppercase();
        return Some(if code == "UK" { "GB".to_owned() } else { code });
    }
    let name = fold(text);
    lex::COUNTRIES
        .iter()
        .find(|(known, _)| *known == name)
        .map(|(_, code)| (*code).to_owned())
}

impl HardCriteria {
    /// The hard criteria of a profile: Vollzeit asks for at least [`FULLTIME_DAYS`] a week,
    /// Teilzeit for at most [`PARTTIME_DAYS`].
    pub(crate) fn new(form: &ProfileForm) -> Self {
        let countries: Vec<String> = form
            .countries
            .iter()
            .filter_map(|c| country_code(c))
            .collect();
        let (workload_min, workload_max) = match form.workload {
            Workload::Any => (None, None),
            Workload::Fulltime => (Some(FULLTIME_DAYS), None),
            Workload::Parttime => (None, Some(PARTTIME_DAYS)),
        };
        Self {
            min_rate: form.day_rate_min.filter(|n| *n > 0).map(i128::from),
            countries: (!countries.is_empty()).then_some(countries),
            anue_excluded: !form.temporary,
            permanent_excluded: !form.permanent,
            project_excluded: !form.project,
            available: match form.available.day() {
                Some(day) => Availability::From(day),
                None => Availability::Now,
            },
            min_salary: form
                .min_salary
                .filter(|n| *n > 0 && (form.permanent || form.temporary))
                .map(u64::from),
            workload_min,
            workload_max,
            min_months: (form.min_months > 0).then_some(u16::from(form.min_months)),
            exclusion_words: form.exclusion_words.clone(),
        }
    }
}

/// A decided violation, a check, or a frame row (met or partial).
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Finding {
    pub code: ReasonCode,
    pub decided: bool,
    pub kind: ReasonKind,
    pub key: Option<CriterionKey>,
    pub params: Value,
    pub spans: Vec<Range<usize>>,
}

impl Finding {
    /// A violation when `decided`, else a check.
    pub(crate) fn new(
        code: ReasonCode,
        decided: bool,
        key: Option<CriterionKey>,
        params: Value,
        spans: Vec<Range<usize>>,
    ) -> Self {
        let kind = if decided {
            ReasonKind::Violation
        } else {
            ReasonKind::Check
        };
        Self {
            code,
            decided,
            kind,
            key,
            params,
            spans,
        }
    }

    /// A frame row that never excludes (met, partial or check).
    pub(crate) fn row(
        code: ReasonCode,
        kind: ReasonKind,
        key: Option<CriterionKey>,
        params: Value,
        spans: Vec<Range<usize>>,
    ) -> Self {
        Self {
            code,
            decided: false,
            kind,
            key,
            params,
            spans,
        }
    }
}

/// Job facts used for the criteria.
pub(crate) struct JobFacts<'a> {
    pub title: &'a str,
    pub text: &'a str,
    pub location: &'a str,
    pub portal: Portal,
    pub facts: Option<&'a Value>,
    pub posted: Option<Date>,
}

/// A sentence of the text: byte range and folded text.
pub(crate) type Segment = (Range<usize>, String);

/// Parts of a line between the separators of `SEGMENT_SEPARATORS`.
fn line_parts(line: &str) -> Vec<&str> {
    let mut parts = vec![line];
    for sep in lex::SEGMENT_SEPARATORS {
        parts = parts.into_iter().flat_map(|p| p.split(sep)).collect();
    }
    parts
}

/// The ad without the other listings a portal shows under it ("Ähnliche Projekte (12)",
/// "Similar jobs"): the text up to the first line that is such a heading. The hard criteria
/// read only this part; the ad text itself stays whole.
pub(crate) fn own_text(text: &str) -> &str {
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        let folded = fold(line.trim());
        let heading = super::sections::is_listings_heading(&folded);
        if heading && offset > 0 {
            return &text[..offset];
        }
        offset += line.len();
    }
    text
}

/// Sentences of the text (also split at ` // `, ` · `, ` | `, ` • `), as byte ranges with
/// their folded text.
pub(crate) fn segments(text: &str) -> Vec<Segment> {
    let mut out = Vec::new();
    for line in splitlines(text) {
        for part in line_parts(line) {
            for sentence in sentences(part) {
                let start = (sentence.as_ptr() as usize).saturating_sub(text.as_ptr() as usize);
                out.push((start..start + sentence.len(), fold(sentence)));
            }
        }
    }
    out
}

pub(crate) fn fact<'a>(facts: Option<&'a Value>, key: &str) -> Option<&'a Value> {
    facts.and_then(|f| f.get(key)).filter(|v| !v.is_null())
}

/// Findings of the contract type, ANÜ, country, day rate and availability.
pub(crate) fn check(
    criteria: &HardCriteria,
    job: &JobFacts<'_>,
    segments: &[Segment],
    folded: &str,
    contract: &Contract,
    anue_findings: Vec<Finding>,
) -> Vec<Finding> {
    let mut findings = Vec::new();
    let (row, inferred) = match contract.kind {
        ContractKind::Interim => (ReasonKind::Met, false),
        ContractKind::Permanent => (ReasonKind::Partial, contract.inferred),
        ContractKind::Anue => (ReasonKind::Partial, false),
        ContractKind::Unclear => (ReasonKind::Check, false),
    };
    findings.push(Finding::row(
        ReasonCode::ContractType,
        row,
        None,
        json!({ "type": contract.code, "inferred": inferred }),
        contract.spans.clone(),
    ));
    if contract.kind == ContractKind::Permanent || contract.stated_permanent {
        findings.push(if criteria.permanent_excluded {
            // Excluded by the profile: decided only for a stated permanent role (not one
            // inferred from benefits or a title, not one that offers interim work too).
            let stated = contract.kind == ContractKind::Permanent && !contract.inferred;
            Finding::new(
                ReasonCode::Permanent,
                stated,
                Some(CriterionKey::NoPermanent),
                json!({ "excluded": true, "stated": stated }),
                contract.spans.clone(),
            )
        } else {
            Finding::new(ReasonCode::Permanent, false, None, json!({}), Vec::new())
        });
    }
    if criteria.project_excluded {
        findings.extend(project(contract));
    }
    if criteria.anue_excluded {
        if anue_findings.is_empty() && contract.kind == ContractKind::Unclear && contract.agency {
            findings.push(Finding::new(
                ReasonCode::AnueRisk,
                false,
                Some(CriterionKey::NoAnue),
                json!({}),
                contract.spans.clone(),
            ));
        }
        findings.extend(anue_findings);
    }
    if let Some(allowed) = &criteria.countries {
        findings.extend(country(allowed, job, segments, folded));
    }
    // The pay of an employment or of temporary agency work is no day rate.
    if !matches!(contract.kind, ContractKind::Permanent | ContractKind::Anue) {
        findings.extend(day_rate(criteria, job, segments));
    }
    if let Availability::From(date) = criteria.available {
        findings.extend(availability(date, job, segments));
    }
    findings
}

/// A project or interim role while the profile excludes them: decided for an interim role
/// (stated by the ad, or a source that lists projects only), a check for an ad that states a
/// permanent role and interim work both; nothing for any other role.
fn project(contract: &Contract) -> Option<Finding> {
    let decided = match contract.kind {
        ContractKind::Interim => true,
        ContractKind::Unclear if contract.stated_permanent => false,
        _ => return None,
    };
    Some(Finding::new(
        ReasonCode::Project,
        decided,
        Some(CriterionKey::NoProject),
        json!({ "excluded": true, "stated": decided, "type": contract.code }),
        contract.spans.clone(),
    ))
}

/// ANÜ named (decided), optional or hidden; empty when not mentioned.
pub(crate) fn anue(job: &JobFacts<'_>, segments: &[Segment]) -> Vec<Finding> {
    let any = |f: &str, words: &[&str], parts: &[&str]| {
        words.iter().any(|w| contains_word(f, w)) || parts.iter().any(|p| f.contains(p))
    };
    let named = |f: &str| any(f, lex::ANUE_WORDS, lex::ANUE_PARTS);
    let negated = |f: &str| any(f, lex::ANUE_NEGATION, lex::ANUE_NEGATION_PARTS);
    let optional = |f: &str| any(f, lex::ANUE_OPTION, lex::ANUE_OPTION_PARTS);
    let (mut decided, mut option, mut hidden) = (Vec::new(), Vec::new(), Vec::new());
    let contract = fact(job.facts, super::fact_key::CONTRACT)
        .and_then(Value::as_str)
        .map(fold);
    // The title counts like a contract sentence (E16-7):
    // `SAP FI/CO Berater (m/w/d) in Arbeitnehmerüberlassung`. It does not where it names ANÜ
    // as a topic or as the field of a role in the staffing business:
    // `Disponent (m/w/d) Arbeitnehmerüberlassung`.
    let title = fold(job.title);
    let title_says = (named(&title)
        && !negated(&title)
        && !anue_topic(&title, &named)
        && !lex::ANUE_FIELD_ROLES.iter().any(|w| title.contains(w)))
    .then_some(title.as_str());
    for f in contract
        .as_deref()
        .filter(|f| named(f) && !negated(f))
        .into_iter()
        .chain(title_says)
    {
        if optional(f) {
            option.push(0..0);
        } else {
            decided.push(0..0);
        }
    }
    for (range, f) in segments {
        if anue_topic(f, &named) {
            continue;
        }
        if named(f) {
            if negated(f) {
                continue;
            }
            if optional(f) {
                &mut option
            } else {
                &mut decided
            }
            .push(range.clone());
        } else if lex::ANUE_HIDDEN.iter().any(|w| contains_word(f, w)) {
            hidden.push(range.clone());
        }
    }
    let spans = |v: Vec<Range<usize>>| v.into_iter().filter(|r| !r.is_empty()).collect();
    // An ad that offers ANÜ as one option somewhere is optional, even where another
    // sentence names it plainly (`bei ANÜ entsprechender Stundenlohn`).
    if !decided.is_empty() && option.is_empty() {
        vec![Finding::new(
            ReasonCode::Anue,
            true,
            Some(CriterionKey::NoAnue),
            json!({}),
            spans(decided),
        )]
    } else if !option.is_empty() {
        option.extend(decided);
        vec![Finding::new(
            ReasonCode::AnueOptional,
            false,
            Some(CriterionKey::NoAnue),
            json!({}),
            spans(option),
        )]
    } else if !hidden.is_empty() {
        vec![Finding::new(
            ReasonCode::AnueHidden,
            false,
            Some(CriterionKey::NoAnue),
            json!({}),
            spans(hidden),
        )]
    } else {
        Vec::new()
    }
}

/// Words at the start of a sentence where a cue of `ANUE_TOPIC` governs a list that names
/// the contract form (`Kenntnisse im AÜG, in der Arbeitnehmerüberlassung und ...`).
const ANUE_TOPIC_HEAD: usize = 3;
/// Words before an ANÜ mention in which a cue governs it (`Erfahrung im Einsatz von ANÜ`).
const ANUE_TOPIC_REACH: usize = 4;

/// ANÜ (or its hidden signs) as a topic of the requirements, not the contract form (E16-4):
/// only where a cue governs the mention (`Erfahrung mit Arbeitnehmerüberlassung`,
/// `Kenntnisse des AÜG`, `Steuerung der Arbeitnehmerüberlassung`, `... von Vorteil`), or a
/// cue at the start of the sentence governs a list that names it and no clause that names
/// it places the job in it. A clause that offers the contract
/// (`Einsatz über Arbeitnehmerüberlassung`, `im Rahmen der ANÜ`, `ANUE_CONTRACT`) stays
/// the contract even with a cue elsewhere in it (`... einen Controller mit Berufserfahrung`).
/// ANÜ as the business of the hiring company is no contract form either.
fn anue_topic(folded: &str, named: &dyn Fn(&str) -> bool) -> bool {
    let hidden = |s: &str| lex::ANUE_HIDDEN.iter().any(|w| contains_word(s, w));
    let mentions = |s: &str| named(s) || hidden(s);
    if !mentions(folded) {
        return false;
    }
    // The business of a company (`Unser Kerngeschäft ist die Arbeitnehmerüberlassung`).
    let placed = |s: &str| lex::ANUE_CONTRACT.iter().any(|w| contains_word(s, w));
    if lex::ANUE_BUSINESS.iter().any(|w| folded.contains(w)) && !placed(folded) {
        return true;
    }
    let clauses: Vec<&str> = clauses(folded, &[',', ';'])
        .filter(|c| mentions(c))
        .collect();
    if clauses.iter().any(|c| anue_governed(c)) {
        return true;
    }
    let head = folded
        .split_whitespace()
        .take(ANUE_TOPIC_HEAD)
        .any(topic_cue);
    head && !clauses.iter().any(|c| placed(c))
}

/// A word that starts with a cue of `ANUE_TOPIC` (`Kenntnisse`, not `SAP-Kenntnisse`).
fn topic_cue(word: &str) -> bool {
    let word = word.trim_start_matches(|c: char| !c.is_alphanumeric());
    lex::ANUE_TOPIC.iter().any(|w| word.starts_with(w))
}

/// Does a cue govern the first ANÜ mention of the clause: in its own word (`ANÜ-Erfahrung`),
/// before it with only linking words between (`Erfahrung im Einsatz von`), or a requirement
/// right after it (`Arbeitnehmerüberlassung von Vorteil`)?
fn anue_governed(clause: &str) -> bool {
    let parts = lex::ANUE_PARTS.iter().filter_map(|p| clause.find(p));
    let words = lex::ANUE_WORDS
        .iter()
        .chain(lex::ANUE_HIDDEN)
        .filter_map(|w| find_word(clause, w));
    let Some(at) = parts.chain(words).min() else {
        return false;
    };
    let tokens: Vec<(usize, &str)> = clause
        .split_whitespace()
        .map(|w| (w.as_ptr() as usize - clause.as_ptr() as usize, w))
        .collect();
    let Some(m) = tokens.iter().rposition(|&(start, _)| start <= at) else {
        return false;
    };
    let link = |w: &str| {
        let w = w.trim_matches(|c: char| !c.is_alphanumeric());
        lex::ANUE_TOPIC_LINKS.contains(&w)
    };
    let own = lex::ANUE_TOPIC.iter().any(|w| tokens[m].1.contains(w));
    let before = (m.saturating_sub(ANUE_TOPIC_REACH)..m)
        .any(|j| topic_cue(tokens[j].1) && tokens[j + 1..m].iter().all(|(_, w)| link(w)));
    let next: Vec<&str> = tokens[m + 1..]
        .iter()
        .take(ANUE_TOPIC_REACH)
        .map(|(_, w)| *w)
        .collect();
    let after = lex::ANUE_TOPIC_AFTER
        .iter()
        .any(|w| next.join(" ").contains(w));
    own || before || after
}

/// Countries named in a folded text (names and cities).
/// A country or city name with its country code.
type Place = (&'static str, &'static str);

/// Country and city names by their first word. A name stands in a text only where the
/// text has that first word as a word of its own (the names start with a letter, and a
/// match needs word boundaries), so a text is looked up word by word.
static PLACES_BY_FIRST_WORD: LazyLock<HashMap<&'static str, Vec<Place>>> = LazyLock::new(|| {
    let mut index: HashMap<&'static str, Vec<Place>> = HashMap::new();
    for &(name, code) in lex::COUNTRIES.iter().chain(lex::CITIES) {
        let first = name
            .split(|c: char| !c.is_alphanumeric())
            .next()
            .unwrap_or(name);
        index.entry(first).or_default().push((name, code));
    }
    index
});

/// Every country or city a text names, with the byte offset of the name; a place after a
/// word of nearness (`nähe Venlo`) is a landmark, no place of the job.
fn countries_at(folded: &str) -> Vec<(usize, &'static str)> {
    let mut found = Vec::new();
    let mut before = "";
    for word in folded.split(|c: char| !c.is_alphanumeric()) {
        if word.is_empty() {
            continue;
        }
        let near = lex::NEAR_WORDS.contains(&before);
        before = word;
        if near {
            continue;
        }
        let Some(names) = PLACES_BY_FIRST_WORD.get(word) else {
            continue;
        };
        let at = word.as_ptr() as usize - folded.as_ptr() as usize;
        let rest = &folded[at..];
        for &(name, code) in names {
            let whole = rest
                .strip_prefix(name)
                .is_some_and(|after| after.chars().next().is_none_or(|c| !c.is_alphanumeric()));
            if whole {
                found.push((at, code));
            }
        }
    }
    found
}

fn countries_in(folded: &str) -> Vec<&'static str> {
    let mut found: Vec<&'static str> = countries_at(folded).into_iter().map(|(_, c)| c).collect();
    found.sort_unstable();
    found.dedup();
    found
}

/// Where a sentence says on-site (`true`) or travel (`false`), by byte offset.
fn place_cues(folded: &str) -> Vec<(usize, bool)> {
    let mut cues: Vec<(usize, bool)> = lex::ONSITE_WORDS
        .iter()
        .flat_map(|w| folded.match_indices(w).map(|(at, _)| (at, true)))
        .chain(lex::TRAVEL_WORDS.iter().flat_map(|w| {
            folded
                .match_indices(w)
                .filter(|(at, _)| {
                    let before = folded[..*at].chars().next_back();
                    let after = folded[at + w.len()..].chars().next();
                    before.is_none_or(|c| !c.is_alphanumeric())
                        && after.is_none_or(|c| !c.is_alphanumeric())
                })
                .map(|(at, _)| (at, false))
        }))
        .collect();
    cues.sort_unstable();
    cues
}

pub(crate) fn location_countries(location: &str) -> Vec<&'static str> {
    let folded = fold(location);
    let named = countries_in(&folded);
    if !named.is_empty() {
        return named;
    }
    let german_code = folded
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '-')
        .any(|w| {
            let digits = w.strip_prefix("d-").unwrap_or(w);
            digits.len() == 5 && digits.chars().all(|c| c.is_ascii_digit())
        });
    if german_code { vec!["DE"] } else { Vec::new() }
}

/// A country with the sentence that names it.
type Named = (&'static str, Range<usize>);

/// The countries of on-site statements and of travel. A country belongs to the on-site or
/// travel statement before it (else the first one after it): `vor Ort in Düsseldorf,
/// gelegentlich Reisen nach Polen` works in Germany and travels to Poland. A frame line
/// naming the place (`Ort: 3199 Rotterdam, Niederlande`) is decided like the job location.
/// An on-site statement that also names an allowed country or the job's own place on site
/// (`on site in Leverkusen and at the plants in Belgium`) makes the other countries second
/// sites, checked like travel; so does a frame line naming an allowed country beside others
/// (`Location: Remote, meetings in Germany and Poland`).
fn places_of_work(
    segments: &[(Range<usize>, String)],
    allowed: &[String],
    home: &[&str],
) -> (Vec<Named>, Vec<Named>) {
    let mut onsite: Vec<Named> = Vec::new();
    let mut travel: Vec<Named> = Vec::new();
    for (range, f) in segments {
        let named = countries_at(f);
        if named.is_empty() {
            continue;
        }
        let place = lex::PLACE_LABELS
            .iter()
            .any(|l| f.trim_start().starts_with(l));
        let cues = place_cues(f);
        let cue_at = |at: usize| {
            cues.iter()
                .rev()
                .find(|(c, _)| *c < at)
                .or_else(|| cues.iter().find(|(c, _)| *c > at))
                .map(|&(_, onsite)| onsite)
        };
        let (mut here, mut away): (Vec<&'static str>, Vec<&'static str>) = (Vec::new(), Vec::new());
        for (at, code) in named {
            match (place, cue_at(at)) {
                (true, _) | (false, Some(true)) => here.push(code),
                (false, Some(false)) => away.push(code),
                (false, None) => {}
            }
        }
        let home_on_site = here.iter().any(|c| allowed.iter().any(|a| a == c))
            || (!place
                && home.iter().any(|word| {
                    f.match_indices(word).any(|(at, _)| {
                        word_bounded(f, at, at + word.len()) && cue_at(at) == Some(true)
                    })
                }));
        if home_on_site {
            here.retain(|c| {
                let inside = allowed.iter().any(|a| a == c);
                if !inside {
                    away.push(c);
                }
                inside
            });
        }
        for list in [&mut here, &mut away] {
            list.sort_unstable();
            list.dedup();
        }
        away.retain(|c| !here.contains(c));
        onsite.extend(here.into_iter().map(|c| (c, range.clone())));
        travel.extend(away.into_iter().map(|c| (c, range.clone())));
    }
    (onsite, travel)
}

fn country(
    allowed: &[String],
    job: &JobFacts<'_>,
    segments: &[(Range<usize>, String)],
    folded: &str,
) -> Vec<Finding> {
    let outside = |codes: &[&'static str]| -> Vec<String> {
        codes
            .iter()
            .filter(|c| !allowed.iter().any(|a| a == *c))
            .map(|c| (*c).to_owned())
            .collect()
    };
    let facts_remote =
        fact(job.facts, super::fact_key::REMOTE_PERCENT).and_then(Value::as_u64) == Some(100);
    let location = fact(job.facts, super::fact_key::LOCATION)
        .and_then(Value::as_str)
        .unwrap_or(job.location);
    let location_folded = fold(location);
    // LinkedIn's workplace type in the location (`Wien, Österreich (Remote)`) is remote work,
    // unless the location names days on site too (`2 Tage vor Ort in Bern & Remote`).
    let onsite_location = lex::LOCATION_ONSITE
        .iter()
        .any(|w| contains_word(&location_folded, w));
    let remote_full = facts_remote
        || states_full_remote(folded)
        || (contains_word(&location_folded, "remote") && !onsite_location);
    let located = outside(&location_countries(location));
    // The job's own place counts as home only where it is not outside the countries.
    let home = if located.is_empty() {
        super::permanent::place_words(&location_folded)
    } else {
        Vec::new()
    };
    let (onsite, travel) = places_of_work(segments, allowed, &home);
    let onsite_codes: Vec<&'static str> = onsite.iter().map(|(c, _)| *c).collect();
    let onsite_out = outside(&onsite_codes);
    let travel_codes: Vec<&'static str> = travel.iter().map(|(c, _)| *c).collect();
    let travel_out = outside(&travel_codes);
    let spans_of = |list: &[(&'static str, Range<usize>)], codes: &[String]| -> Vec<Range<usize>> {
        let mut spans: Vec<Range<usize>> = list
            .iter()
            .filter(|(c, _)| codes.iter().any(|o| o == c))
            .map(|(_, r)| r.clone())
            .collect();
        spans.dedup();
        spans
    };
    let unclear = |codes: Vec<String>, spans: Vec<Range<usize>>| {
        Finding::new(
            ReasonCode::CountryUnclear,
            false,
            Some(CriterionKey::Countries),
            json!({ "countries": codes }),
            spans,
        )
    };
    if !remote_full {
        let mut decided: Vec<String> = located.iter().chain(&onsite_out).cloned().collect();
        decided.sort();
        decided.dedup();
        if !decided.is_empty() {
            let params = json!({ "outside": decided, "allowed": allowed });
            return vec![Finding::new(
                ReasonCode::Country,
                true,
                Some(CriterionKey::Countries),
                params,
                spans_of(&onsite, &decided),
            )];
        }
        if !travel_out.is_empty() {
            return vec![unclear(travel_out.clone(), spans_of(&travel, &travel_out))];
        }
        return Vec::new();
    }
    if !onsite_out.is_empty() {
        return vec![unclear(onsite_out.clone(), spans_of(&onsite, &onsite_out))];
    }
    if !travel_out.is_empty() {
        return vec![unclear(travel_out.clone(), spans_of(&travel, &travel_out))];
    }
    Vec::new()
}

/// Does a folded text state full remote work, in a clause that does not deny it (`We are
/// unable to consider fully remote arrangements` states none)?
fn states_full_remote(folded: &str) -> bool {
    lex::FULL_REMOTE.iter().any(|phrase| {
        folded.match_indices(phrase).any(|(at, _)| {
            let clause = folded[..at]
                .rfind(['.', '!', '?', ';', '\n'])
                .map_or(0, |i| i + 1);
            !folded[clause..at]
                .split(|c: char| !c.is_alphanumeric())
                .any(|w| lex::DENIALS.contains(&w))
        })
    })
}

/// A rate statement: highest amount, hourly or daily, EUR or not, freelance rate or wage.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Rate {
    pub upper: u64,
    /// The lowest amount of the statement: the lower end of a range (`900 - 1.200 €/Tag`),
    /// else `upper`.
    pub lower: u64,
    pub hourly: bool,
    pub currency: Option<&'static str>,
    /// Employment pay (`Stundenlohn`, `brutto pro Stunde`, a pay scale): the job is judged as
    /// employment, never by its day rate.
    pub wage: bool,
}

impl Rate {
    /// The rate per day (an hourly rate times eight); absurd digit runs saturate. A range
    /// counts by its upper end.
    pub(crate) fn per_day(&self) -> u64 {
        if self.hourly {
            self.upper.saturating_mul(HOURS_PER_DAY)
        } else {
            self.upper
        }
    }

    /// The lower end of a range (per day or per hour, as stated), if the statement names one.
    pub(crate) fn range_from(&self) -> Option<u64> {
        (self.lower < self.upper).then_some(self.lower)
    }
}

/// The rate the ad states: the page facts first, then the first sentence with a rate (and
/// its range).
pub(crate) fn stated_rate(
    job: &JobFacts<'_>,
    segments: &[Segment],
) -> Option<(Rate, Option<Range<usize>>)> {
    let from_facts = fact(job.facts, super::fact_key::RATE)
        .and_then(Value::as_str)
        .and_then(|s| parse_rate(&fold(s)))
        .map(|r| (r, None));
    from_facts.or_else(|| {
        segments
            .iter()
            .find_map(|(range, f)| rate_in(f).map(|r| (r, Some(range.clone()))))
    })
}

/// The rate of a sentence, clause by clause (`Freelance mit 90 € pro Stunde oder befristet
/// (Gehaltsband 72-84 T€ p.a.)`: the salary clause does not hide the rate); a freelance rate
/// before a wage, the highest per day when clauses name several.
pub(crate) fn rate_in(folded: &str) -> Option<Rate> {
    clause_rates(folded).max_by_key(|r| (!r.wage, r.per_day()))
}

/// Does a sentence name employment pay (an hourly wage)?
pub(crate) fn wage_in(folded: &str) -> bool {
    clause_rates(folded).any(|r| r.wage)
}

/// The hourly pay of a sentence, a wage before a freelance rate.
pub(crate) fn hourly_pay_in(folded: &str) -> Option<Rate> {
    clause_rates(folded)
        .filter(|r| r.hourly)
        .max_by_key(|r| (r.wage, r.upper))
}

/// The rates of the clauses of a sentence. A sentence that is employment pay as a whole
/// (`18,50 € pro Stunde (brutto)`) makes every rate in it a wage.
fn clause_rates(folded: &str) -> impl Iterator<Item = Rate> {
    let rates: Vec<Rate> = clauses(folded, &[';', '(', ')'])
        .flat_map(|part| part.split(" oder "))
        .flat_map(|part| part.split(" or "))
        .filter_map(parse_rate)
        .collect();
    // Only a sentence with a rate is read for employment pay.
    let whole = !rates.is_empty() && is_wage(folded) && !names_freelance_rate(folded);
    rates.into_iter().map(move |rate| Rate {
        wage: rate.wage || whole,
        ..rate
    })
}

fn names_freelance_rate(folded: &str) -> bool {
    lex::FREELANCE_RATE_WORDS.iter().any(|w| folded.contains(w))
}

/// Is a rate statement employment pay (`Stundenlohn`, `hourly wage`, or a pay scale or
/// `brutto` without a freelance rate word) rather than a freelance rate? Words and phrases
/// only, never inside another word (`Volkswagen`, `Entgeltabrechnung`, `Tarifsystem`).
pub(crate) fn is_wage(folded: &str) -> bool {
    let explicit = lex::WAGE_PHRASES.iter().any(|w| contains_phrase(folded, w))
        || lex::WAGE_WORDS_WHOLE
            .iter()
            .any(|w| contains_word(folded, w))
        || lex::WAGE_HEADS.iter().any(|w| ends_a_word(folded, w));
    let scale = || {
        lex::PAY_SCALE_WORDS
            .iter()
            .any(|w| contains_word_form(folded, w))
            || lex::PAY_SCALE_HEADS.iter().any(|w| ends_a_word(folded, w))
    };
    explicit || (scale() && !names_freelance_rate(folded))
}

/// A phrase with word boundaries; one that starts with a sign (`/h gross`) needs only the
/// boundary after it (`€18/h gross`).
fn contains_phrase(folded: &str, phrase: &str) -> bool {
    if phrase.starts_with(char::is_alphanumeric) {
        return contains_word(folded, phrase);
    }
    folded.match_indices(phrase).any(|(at, _)| {
        folded[at + phrase.len()..]
            .chars()
            .next()
            .is_none_or(|c| !c.is_alphanumeric())
    })
}

/// A word (or phrase) whose last word may take an ending of `PAY_SCALE_ENDINGS`
/// (`tarifliche`, `nach Tarifvertrages`), never inside another word.
fn contains_word_form(folded: &str, word: &str) -> bool {
    folded.match_indices(word).any(|(start, _)| {
        let end = start + word.len();
        let before = folded[..start]
            .chars()
            .next_back()
            .is_none_or(|c| !c.is_alphanumeric());
        let rest = &folded[end..];
        let tail = &rest[..rest
            .find(|c: char| !c.is_alphanumeric())
            .unwrap_or(rest.len())];
        before && lex::PAY_SCALE_ENDINGS.contains(&tail)
    })
}

/// A word of the text that ends with `head` and an ending of `WAGE_HEAD_ENDINGS`
/// (`Bruttostundenlohn`, `Stundenentgelts`).
fn ends_a_word(folded: &str, head: &str) -> bool {
    folded.split(|c: char| !c.is_alphanumeric()).any(|word| {
        lex::WAGE_HEAD_ENDINGS
            .iter()
            .any(|e| word.strip_suffix(e).is_some_and(|w| w.ends_with(head)))
    })
}

/// A currency next to a time unit, also with the amount between them (`110 EUR/h`, `EUR pro
/// Stunde`, `CHF/Tag`, LinkedIn's `€420/day`). Only a text
/// with one of `CURRENCY_MARKS` can match (the regex is checked after them).
static CURRENCY_PER_TIME: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?:€|\beur\b|\beuro\b|\bchf\b|\busd\b|\bgbp\b)\s*(?:\d[\d.,]*\s*)?(?:/|\bpro\b|\bper\b|\bje\b)\s*(?:h\b|hr\b|std\b|stunde|tag\b|day\b|hour|pt\b|mt\b)")
        .expect("currency per time")
});

/// Every currency of `CURRENCY_PER_TIME` contains one of these.
const CURRENCY_MARKS: &[&str] = &["€", "eur", "chf", "usd", "gbp"];

/// Can the engine read a rate from this text (a page's rate field)? A bare number is none:
/// without a unit it is no day or hourly rate.
pub(crate) fn readable_rate(text: &str) -> bool {
    parse_rate(&fold(text)).is_some()
}

pub(crate) fn parse_rate(folded: &str) -> Option<Rate> {
    // Every amount is written in digits.
    if !folded.bytes().any(|b| b.is_ascii_digit()) {
        return None;
    }
    // Pay by commission is no rate (`Vergütung auf Provisionsbasis ... 250 € pro Workshop`).
    if lex::NO_RATE_WORDS.iter().any(|w| folded.contains(w))
        && !lex::NO_RATE_EXCEPT.iter().any(|w| folded.contains(w))
    {
        return None;
    }
    let rate_word = lex::RATE_WORDS.iter().any(|w| folded.contains(w));
    let currency_per_time =
        || CURRENCY_MARKS.iter().any(|m| folded.contains(m)) && CURRENCY_PER_TIME.is_match(folded);
    if !(rate_word || currency_per_time()) || lex::SALARY_WORDS.iter().any(|w| folded.contains(w)) {
        return None;
    }
    let mut amounts = Vec::new();
    let bytes = folded.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let start = i;
        let (value, end) = amount_at(bytes, i);
        i = end;
        let date = date_part(bytes, start, i);
        // Decimals (",50", ",-") and percentages are no separate amounts.
        if i < bytes.len() && (bytes[i] == b',' || bytes[i] == b'.') && !date {
            let mut j = i + 1;
            while j < bytes.len() && (bytes[j].is_ascii_digit() || bytes[j] == b'-') {
                j += 1;
            }
            if j > i + 1 {
                i = j;
            }
        }
        let percent = folded[i..].trim_start().starts_with('%');
        // Only an amount next to a currency or a rate word is a rate (`Start: 02/2027 ·
        // 78 €/h` is 78, a postcode or a year is none).
        // Next to a currency even a student's wage counts (`16,50 € pro Stunde`).
        // An amount of a salary's size is no rate (`Vergütungspaket von 170.000 bis
        // 210.000 €`).
        let rate_size = (MIN_RATE_AMOUNT..MAX_RATE_AMOUNT).contains(&value);
        if !percent && !date && rate_size && rate_context(folded, start, i) {
            amounts.push(value);
        }
    }
    let upper = amounts.iter().copied().max()?;
    let lower = amounts.iter().copied().min().unwrap_or(upper);
    let names = |f: &str, words: &[&str]| words.iter().any(|w| f.contains(w));
    // The value beats its label: `Stundensatz: Tagessatz 1.100 - 1.250 €` is a day rate.
    let value = folded.split_once(':').map_or(folded, |(_, v)| v);
    let hourly = names(folded, lex::HOURLY_WORDS)
        && (names(value, lex::HOURLY_WORDS) || !names(value, lex::DAILY_WORDS));
    let currency = lex::OTHER_CURRENCIES
        .iter()
        .find(|w| folded.contains(**w))
        .copied();
    Some(Rate {
        upper,
        lower,
        hourly,
        currency,
        wage: is_wage(folded),
    })
}

/// Smallest amount read as a rate (a rate is always next to a currency or rate word).
const MIN_RATE_AMOUNT: u64 = 5;
/// Amounts from here on are salaries or budgets, never a rate per day or hour.
const MAX_RATE_AMOUNT: u64 = 10_000;

/// Is the number at `start..end` part of a date (`02/2027`, `01.11.2026`)?
fn date_part(bytes: &[u8], start: usize, end: usize) -> bool {
    let digit_at = |i: usize| bytes.get(i).is_some_and(u8::is_ascii_digit);
    // Digits joined by `/` or `.` before the number: `11/2026`, `01.11.2026`.
    let joined_before =
        start >= 2 && matches!(bytes[start - 1], b'/' | b'.') && digit_at(start - 2);
    // `02/2027`, `01.11.`: digits after `/`, or two digits and a dot after `.` (no
    // thousands group such as `1.100`, no decimals such as `95.50`).
    let joined_after = match bytes.get(end) {
        Some(b'/') => digit_at(end + 1),
        Some(b'.') => digit_at(end + 1) && digit_at(end + 2) && bytes.get(end + 3) == Some(&b'.'),
        _ => false,
    };
    joined_before || joined_after
}

/// Does a currency or rate unit follow the amount (after a range such as `- 1.100`), or a
/// currency or rate word precede it (`Tagessatz: bis`, `EUR`)?
fn rate_context(folded: &str, start: usize, end: usize) -> bool {
    let after = folded.get(end..).unwrap_or("");
    let rest = after.trim_start_matches(|c: char| {
        c.is_whitespace() || c.is_ascii_digit() || matches!(c, '.' | ',' | '-' | '–')
    });
    let rest = lex::RATE_RANGE_WORDS
        .iter()
        .find_map(|w| rest.strip_prefix(w))
        .map_or(rest, |r| {
            r.trim_start_matches(|c: char| {
                c.is_whitespace() || c.is_ascii_digit() || matches!(c, '.' | ',' | '-')
            })
        });
    if lex::RATE_UNITS.iter().any(|u| rest.starts_with(u)) {
        return true;
    }
    // The upper end of a range looks past the lower one (`EUR 950–1,100`).
    let before = folded
        .get(..start)
        .unwrap_or("")
        .trim_end_matches(|c: char| {
            c.is_whitespace()
                || c.is_ascii_digit()
                || matches!(c, ':' | '(' | '~' | '-' | '–' | '.' | ',')
        });
    let before = lex::RATE_RANGE_WORDS
        .iter()
        .find_map(|w| before.strip_suffix(w))
        .map_or(before, |b| {
            // `EUR 1,100 to 1,250`: past the lower end of the range to its unit.
            b.trim_end_matches(|c: char| {
                c.is_whitespace() || c.is_ascii_digit() || matches!(c, ':' | '(' | '.' | ',')
            })
        });
    lex::RATE_UNITS
        .iter()
        .chain(lex::RATE_WORDS)
        .any(|w| before.ends_with(w))
}

fn day_rate(
    criteria: &HardCriteria,
    job: &JobFacts<'_>,
    segments: &[(Range<usize>, String)],
) -> Vec<Finding> {
    let Some((rate, span)) = stated_rate(job, segments) else {
        return Vec::new();
    };
    // Employment pay is judged as employment (salary rules), never as a day rate.
    if rate.wage {
        return Vec::new();
    }
    let spans: Vec<Range<usize>> = span.into_iter().collect();
    if let Some(currency) = rate.currency {
        let params = json!({ "currency": currency.to_uppercase(), "amount": rate.upper });
        return vec![Finding::new(
            ReasonCode::DayRateCurrency,
            false,
            Some(CriterionKey::MinDayRate),
            params,
            spans,
        )];
    }
    // `parse_rate` saturates absurd digit runs at `u64::MAX`: such an amount stays far
    // above any minimum instead of wrapping below it.
    let per_day = rate.per_day();
    match criteria.min_rate {
        Some(min) if i128::from(per_day) < min => {
            let mut params =
                json!({ "rate": per_day, "min": i64::try_from(min).ok(), "hourly": rate.hourly });
            rate_amounts(&mut params, &rate);
            vec![Finding::new(
                ReasonCode::DayRate,
                true,
                Some(CriterionKey::MinDayRate),
                params,
                spans,
            )]
        }
        _ => Vec::new(),
    }
}

/// The amounts of a rate as the ad states them, next to its rate per day (`rate`): the hourly
/// amount (`amount`), the lower end of a range in the stated unit (`from`).
pub(crate) fn rate_amounts(params: &mut Value, rate: &Rate) {
    if rate.hourly {
        params["amount"] = json!(rate.upper);
    }
    if let Some(from) = rate.range_from() {
        params["from"] = json!(from);
    }
}

/// A job start.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Start {
    Now,
    Date(Date),
    Vague,
}

/// Parses a start statement (`ab sofort`, `01.11.2026`, `11/2026`, `ab Januar 2027`, `Q1 2027`).
pub(crate) fn parse_start(text: &str) -> Option<Start> {
    let folded = fold(text);
    let words: Vec<&str> = folded
        .split(|c: char| !c.is_ascii_alphanumeric() && c != '.' && c != '/' && c != '-')
        .map(|w| w.trim_matches(['.', '-']))
        .filter(|w| !w.is_empty())
        .collect();
    for (i, word) in words.iter().enumerate() {
        // A word that is no date (a phone number `0170.1234.5678`) is skipped, it does not
        // end the search.
        if let Some((year, month, day)) = numeric_date(word)
            && let Ok(date) = Date::new(year, month, day.unwrap_or(1))
        {
            return Some(Start::Date(date));
        }
        let year = words
            .get(i + 1)
            .and_then(|w| w.parse::<i16>().ok())
            .filter(|y| *y > 2000);
        let month = month_named(word).or_else(|| quarter(word).map(|q| 3 * q - 2));
        if let (Some(year), Some(month)) = (year, month)
            && let Ok(date) = Date::new(year, month, 1)
        {
            return Some(Start::Date(date));
        }
    }
    if lex::START_NOW.iter().any(|w| contains_word(&folded, w)) {
        return Some(Start::Now);
    }
    lex::START_VAGUE
        .iter()
        .any(|w| folded.contains(w))
        .then_some(Start::Vague)
}

fn availability(
    available: Date,
    job: &JobFacts<'_>,
    segments: &[(Range<usize>, String)],
) -> Vec<Finding> {
    let from_facts = fact(job.facts, super::fact_key::START)
        .and_then(Value::as_str)
        .and_then(parse_start);
    let from_text: Vec<(Start, Range<usize>)> = segments
        .iter()
        .filter(|(_, f)| lex::START_WORDS.iter().any(|w| f.contains(w)))
        .filter_map(|(range, f)| parse_start(f).map(|s| (s, range.clone())))
        .collect();
    let key = Some(CriterionKey::Availability);
    let vague = |spans: Vec<Range<usize>>| {
        vec![Finding::new(
            ReasonCode::StartVague,
            false,
            key,
            json!({}),
            spans,
        )]
    };
    // Statements that disagree (facts "sofort", text "01.12.2026") make the start vague.
    let mut all: Vec<Start> = from_facts
        .into_iter()
        .chain(from_text.iter().map(|(s, _)| *s))
        .collect();
    all.dedup();
    if all.len() > 1 {
        return vague(from_text.into_iter().map(|(_, r)| r).collect());
    }
    let (start, spans) = match (from_facts, from_text.into_iter().next()) {
        (Some(f), _) => (f, Vec::new()),
        (None, Some((t, span))) => (t, vec![span]),
        (None, None) => return Vec::new(),
    };
    let start = match start {
        Start::Vague => return vague(spans),
        Start::Now => match job.posted {
            Some(posted) => posted,
            None => return Vec::new(),
        },
        // A start before the ad was posted means now.
        Start::Date(date) => match job.posted {
            Some(posted) if date < posted => posted,
            _ => date,
        },
    };
    let days = (available - start).get_days();
    if days > 0 {
        vec![Finding::new(
            ReasonCode::AvailabilityGap,
            false,
            key,
            json!({ "days": days }),
            spans,
        )]
    } else {
        Vec::new()
    }
}

#[cfg(test)]
mod tests;
