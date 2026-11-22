//! Turns an engine evaluation into an [`Assessment`]: codes and params (no prose), quotes
//! from the ad, the profile evidence with its JSON path, UTF-16 highlight ranges and the
//! state of every hard criterion.

use std::ops::Range;

use serde_json::{Map, Value, json};

use super::ad_facts::{self, AdFacts, currency_code, start_code};
use super::contract::ContractKind;
use super::engine::{self, EngineProfile, Evaluation, Scored};
use super::factors;
use super::facts::{HardCriteria, Start};
use super::fit;
use super::job::{Class, Stage};
use super::limits;
use super::normalize::{char_len, strip};
use super::params::{
    E_FULL, E_NONE, MUST_SATURATION, NICE_MAX, PERMANENT_FACTOR, W_CORE, W_FRAME, W_MUSTS, W_ROLE,
};
use super::permanent;
use super::signals::{FRAME_ASPECTS, Sig};
use super::types::{
    Assessment, CapCode, CapLine, CriterionKey, CriterionState, CriterionStatus, Evidence,
    EvidenceLevel, Highlight, Part, PartCode, Reason, ReasonCode, ReasonKind, Summary, Verdict,
    Via, Weight,
};

/// Longest quote in a reason.
const QUOTE_MAX_CHARS: usize = 120;

/// Collects reasons and highlights with running ids.
struct Builder<'t> {
    text: &'t str,
    reasons: Vec<Reason>,
    highlights: Vec<Highlight>,
}

impl Builder<'_> {
    fn reason(&mut self, kind: ReasonKind, weight: Weight, code: ReasonCode) -> &mut Reason {
        let id = count(self.reasons.len());
        self.reasons.push(Reason {
            id,
            kind,
            weight,
            code,
            label: None,
            evidence: None,
            params: Map::new(),
            ranges: Vec::new(),
        });
        self.reasons.last_mut().expect("just added")
    }

    /// Highlights bytes `range` of the text for the last reason.
    fn highlight(&mut self, range: Range<usize>) {
        if range.is_empty() || range.end > self.text.len() {
            return;
        }
        let id = count(self.highlights.len());
        let reason = self.reasons.last_mut().expect("a reason to highlight");
        reason.ranges.push(id);
        let highlight = Highlight {
            id,
            start: utf16_offset(self.text, range.start),
            end: utf16_offset(self.text, range.end),
            kind: reason.kind,
            reason: reason.id,
        };
        self.highlights.push(highlight);
    }
}

fn count(n: usize) -> u16 {
    u16::try_from(n).unwrap_or(u16::MAX)
}

fn utf16_offset(text: &str, byte: usize) -> u32 {
    let units = text
        .get(..byte)
        .map_or(0, |prefix| prefix.encode_utf16().count());
    u32::try_from(units).unwrap_or(u32::MAX)
}

fn quote(text: &str) -> String {
    let text = strip(text);
    if char_len(text) <= QUOTE_MAX_CHARS {
        return text.to_owned();
    }
    let cut: String = text.chars().take(QUOTE_MAX_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

fn object(value: &Value) -> Map<String, Value> {
    value.as_object().cloned().unwrap_or_default()
}

fn class_name(class: &Class) -> &'static str {
    match class {
        Class::Skill => "skill",
        Class::Language(..) => "language",
        Class::Degree => "degree",
        Class::Licence(_) => "licence",
        Class::Soft => "soft",
        Class::Frame => "frame",
    }
}

/// Builds the assessment of one evaluated job.
pub(crate) fn assessment(
    profile: &EngineProfile,
    text: &str,
    evaluation: &Evaluation,
) -> Assessment {
    let mut b = Builder {
        text,
        reasons: Vec::new(),
        highlights: Vec::new(),
    };
    let mut summary = Summary {
        must_met: 0,
        must_partial: 0,
        must_open: 0,
        must_total: 0,
        nice_met: 0,
        nice_total: 0,
        evidence: evaluation.evidence,
    };
    for scored in &evaluation.items {
        let item = &scored.item;
        let kind = match scored.fit.value {
            E_FULL => ReasonKind::Met,
            E_NONE => ReasonKind::Open,
            _ => ReasonKind::Partial,
        };
        // The engine's one definition of a must and of a nice-to-have that counts.
        let weight = if engine::is_must(scored) {
            Weight::Must
        } else if engine::is_nice(scored) {
            Weight::Nice
        } else {
            Weight::Info
        };
        match (weight, kind) {
            (Weight::Must, ReasonKind::Met) => summary.must_met += 1,
            (Weight::Must, ReasonKind::Partial) => summary.must_partial += 1,
            (Weight::Must, _) => summary.must_open += 1,
            (Weight::Nice, ReasonKind::Met | ReasonKind::Partial) => summary.nice_met += 1,
            _ => {}
        }
        if weight == Weight::Nice {
            summary.nice_total += 1;
        }
        let code = if item.stage == Stage::Vocabulary {
            ReasonCode::Term
        } else {
            ReasonCode::Requirement
        };
        let params = requirement_params(profile, scored);
        let reason = b.reason(kind, weight, code);
        reason.label = Some(quote(&item.text));
        reason.params = object(&params);
        reason.evidence = scored.fit.entry.map(|index| {
            let entry = &profile.skills.entries[index];
            Evidence {
                profile: entry.text.clone(),
                path: entry.path.clone(),
                via: scored.fit.via,
                quote: quote(&item.text),
            }
        });
        if let Some(span) = item.span.clone() {
            b.highlight(span);
        }
    }
    summary.must_total = summary.must_met + summary.must_partial + summary.must_open;

    let criteria = criterion_states(profile, &mut b, evaluation);
    preferences(profile, &mut b, evaluation);
    if evaluation.short {
        b.reason(ReasonKind::Check, Weight::Info, ReasonCode::ShortText);
    } else if evaluation.evidence != EvidenceLevel::Full {
        b.reason(ReasonKind::Check, Weight::Info, ReasonCode::LowEvidence);
    }
    let factors = factors::factors(profile, evaluation, &summary);
    let (parts, caps) = passung(profile, evaluation);
    Assessment {
        verdict: evaluation.verdict,
        score: evaluation.score,
        summary,
        reasons: b.reasons,
        highlights: b.highlights,
        criteria,
        facts: evaluation.facts.key_facts(),
        rank: evaluation.rank,
        factors,
        parts,
        caps,
    }
}

fn max_of(weight: u64) -> u8 {
    u8::try_from(weight).unwrap_or(u8::MAX)
}

/// What Rolle und Fach was read from: the field class, the target role and the level.
fn role_params(profile: &EngineProfile, evaluation: &Evaluation) -> Value {
    let (role, fit) = match &evaluation.role {
        Some((fit, _)) => (
            Some(profile.roles[fit.role].text.clone()),
            if fit.full { "full" } else { "half" },
        ),
        None => (None, "none"),
    };
    let level = ["at", "oneAbove", "oneBelow", "twoAbove", "twoBelow"]
        .get(usize::from(evaluation.signals.get(Sig::Level)))
        .copied()
        .unwrap_or("at");
    json!({
        "class": evaluation.percent.class.map_or("far", |c| c.code()),
        "role": role,
        "fit": fit,
        "level": level,
    })
}

/// The Passungsgrad line by line and every cap that fired with its reason, the lowest first
/// (none for an unscorable job). The points of the lines add up to the score.
fn passung(profile: &EngineProfile, evaluation: &Evaluation) -> (Vec<Part>, Vec<CapLine>) {
    if evaluation.verdict == Verdict::Unscorable {
        return (Vec::new(), Vec::new());
    }
    let p = &evaluation.percent;
    let s = &evaluation.signals;
    let line = |code, points: u8, max: u64, params: Value| Part {
        code,
        points: i16::from(points),
        max: max_of(max),
        params: object(&params),
    };
    let counts = |met: Sig, partial: Sig, open: Sig| {
        let (m, pa, o) = (s.get(met), s.get(partial), s.get(open));
        (m, pa, m + pa + o)
    };
    let (core_met, core_partial, core_total) =
        counts(Sig::CoreMet, Sig::CorePartial, Sig::CoreOpen);
    let (musts_met, musts_partial, musts_total) =
        counts(Sig::OtherMet, Sig::OtherPartial, Sig::OtherOpen);
    let (nice_met, nice_partial, nice_total) =
        counts(Sig::NiceMet, Sig::NicePartial, Sig::NiceOpen);
    let mut parts = vec![
        line(
            PartCode::Role,
            p.points[0],
            W_ROLE,
            role_params(profile, evaluation),
        ),
        line(
            PartCode::Core,
            p.points[1],
            W_CORE,
            json!({
                "met": core_met,
                "partial": core_partial,
                "total": core_total,
                "fallback": p.core_fallback,
            }),
        ),
        line(
            PartCode::Musts,
            p.points[2],
            W_MUSTS,
            json!({
                "met": musts_met,
                "partial": musts_partial,
                "total": musts_total,
                "counted": u64::from(musts_total).max(MUST_SATURATION),
            }),
        ),
        line(
            PartCode::Frame,
            p.points[3],
            W_FRAME,
            json!({
                "near": s.get(Sig::FrameNear),
                "missed": s.get(Sig::FrameMissed),
                "aspects": FRAME_ASPECTS,
            }),
        ),
    ];
    if nice_total > 0 {
        parts.push(line(
            PartCode::Nice,
            p.nice,
            NICE_MAX,
            json!({ "met": nice_met, "partial": nice_partial, "total": nice_total }),
        ));
    }
    if s.get(Sig::Permanent) == 1 {
        parts.push(Part {
            code: PartCode::Permanent,
            points: -i16::from(p.permanent),
            max: 0,
            params: object(&json!({ "percent": PERMANENT_FACTOR / 10 })),
        });
    }
    if let Some((code, max)) = evaluation.capped {
        parts.push(Part {
            code: PartCode::Cap,
            points: i16::from(evaluation.score) - i16::from(p.total),
            max,
            params: object(&json!({ "cap": code.code(), "max": max })),
        });
    }
    (parts, cap_lines(evaluation, core_total))
}

/// The params of a requirement: where it stands and its class; the years it asks (a range
/// with its upper end), whether they are general experience, the years they were judged
/// against (`have`, none: no verdict) and how the years alone fit (`yearsFit`, the Jobdetails
/// row "Erfahrung"); the entry's own years and whether the profile holds a language at all (an
/// open one is then a level too low).
fn requirement_params(profile: &EngineProfile, scored: &Scored) -> Value {
    let item = &scored.item;
    let source = match item.stage {
        Stage::Section => "section",
        Stage::Sentence => "sentence",
        Stage::Vocabulary => "vocabulary",
    };
    let mut params = json!({ "source": source, "class": class_name(&item.class) });
    if let Some(years) = item.years {
        params["years"] = json!(years);
        if let Some(max) = item.years_max {
            params["max"] = json!(max);
        }
        let general = fit::general_experience(&item.text, &profile.skills.vocab);
        if general {
            params["general"] = json!(true);
        }
        if let Some(have) = fit::years_have(&profile.skills, general, scored.fit.entry) {
            params["have"] = json!(have);
            params["yearsFit"] = json!(match fit::years_value(have, years) {
                E_FULL => "met",
                E_NONE => "open",
                _ => "partial",
            });
        }
    }
    if let Some(years) = scored
        .fit
        .entry
        .and_then(|e| profile.skills.entries.get(e))
        .and_then(|e| e.years)
    {
        params["entryYears"] = json!(years);
    }
    if let Class::Language(language, _) = &item.class
        && profile.skills.languages.iter().any(|(l, _)| l == language)
    {
        params["held"] = json!(true);
    }
    params
}

/// Reasons of the version-4 inputs: the target role the title matches, every wish.
fn preferences(profile: &EngineProfile, b: &mut Builder<'_>, evaluation: &Evaluation) {
    if let Some((fit, title)) = &evaluation.role {
        let role = &profile.roles[fit.role];
        let (kind, name, via) = if fit.full {
            (ReasonKind::Met, "full", Via::Exact)
        } else {
            (ReasonKind::Partial, "half", Via::General)
        };
        let reason = b.reason(kind, Weight::Info, ReasonCode::TargetRole);
        reason.params = object(&json!({ "role": role.text, "fit": name }));
        reason.evidence = Some(Evidence {
            profile: role.text.clone(),
            path: role.path.clone(),
            via,
            quote: quote(title),
        });
    }
    for wish in &evaluation.wishes {
        let text = b.text;
        let reason = b.reason(wish.state.kind(), Weight::Info, wish.code);
        reason.params = object(&wish.params);
        reason.evidence = profile
            .wishes
            .source(wish.code)
            .map(|(value, path)| Evidence {
                profile: value.to_owned(),
                path: path.to_owned(),
                via: Via::Exact,
                quote: wish
                    .spans
                    .first()
                    .and_then(|span| text.get(span.clone()))
                    .map(quote)
                    .unwrap_or_default(),
            });
        for span in &wish.spans {
            b.highlight(span.clone());
        }
    }
}

fn criterion_states(
    profile: &EngineProfile,
    b: &mut Builder<'_>,
    evaluation: &Evaluation,
) -> Vec<CriterionState> {
    let text = b.text;
    let mut states = evidence_states(profile, &evaluation.facts, text);
    for finding in &evaluation.findings {
        let weight = if finding.decided {
            Weight::Hard
        } else {
            Weight::Info
        };
        let reason = b.reason(finding.kind, weight, finding.code);
        reason.params = object(&finding.params);
        let id = reason.id;
        for span in &finding.spans {
            b.highlight(span.clone());
        }
        if let Some(state) = finding
            .key
            .and_then(|key| states.iter_mut().find(|s| s.key == key))
        {
            let next = match finding.kind {
                ReasonKind::Violation => CriterionStatus::Violated,
                ReasonKind::Check => CriterionStatus::Check,
                // A frame row (over-qualified) leaves the state as it is.
                _ => state.status,
            };
            if state.status != CriterionStatus::Violated {
                state.status = next;
                state.reason = Some(id);
            }
        }
    }
    states
}

/// A criterion state with the ad's value and the passage (UTF-16) that states it.
fn criterion(
    key: CriterionKey,
    status: CriterionStatus,
    params: &Value,
    span: Option<&Range<usize>>,
    text: &str,
) -> CriterionState {
    CriterionState {
        key,
        status,
        reason: None,
        params: object(params),
        range: span.map(|r| (utf16_offset(text, r.start), utf16_offset(text, r.end))),
    }
}

/// `Ok` with evidence that meets the criterion, `NotMentioned` otherwise.
fn told(ok: bool) -> CriterionStatus {
    if ok {
        CriterionStatus::Ok
    } else {
        CriterionStatus::NotMentioned
    }
}

/// The salary against the minimum, as the rule compares it: `Ok` for a salary in euros whose
/// upper end with its bonus reaches the minimum (`withBonus`); `NotMentioned` for none and for
/// one in another currency (never compared with a minimum in euros). The params show the
/// salary as the ad states it (`salary`, `from`, `lowerBound`, `bonus`, `currency`).
fn salary_state(min: u64, ad: &AdFacts, text: &str) -> CriterionState {
    let key = CriterionKey::MinSalary;
    let Some(salary) = &ad.salary else {
        return criterion(key, CriterionStatus::NotMentioned, &json!({}), None, text);
    };
    let mut params = json!({ "salary": salary.value });
    if let Some(from) = ad.salary_from {
        params["from"] = json!(from);
    }
    if ad.salary_lower_bound {
        params["lowerBound"] = json!(true);
    }
    if let Some(currency) = &ad.salary_currency {
        params["currency"] = json!(currency);
        return criterion(
            key,
            CriterionStatus::NotMentioned,
            &params,
            salary.span.as_ref(),
            text,
        );
    }
    let compared = permanent::with_bonus(salary.value, ad.salary_bonus);
    if ad.salary_bonus > 0 {
        params["bonus"] = json!(ad.salary_bonus);
        params["withBonus"] = json!(compared);
    }
    criterion(
        key,
        told(compared >= min),
        &params,
        salary.span.as_ref(),
        text,
    )
}

/// The duration against the minimum months: `Ok` unless it is shorter (weeks count as a
/// 4.33rd of a month), with the duration as the ad states it (`months` or `weeks`, `from`).
fn duration_state(min: u16, ad: &AdFacts, text: &str) -> CriterionState {
    let key = CriterionKey::Duration;
    match &ad.months {
        Some(stated) => {
            let params = limits::duration_params(stated.value);
            let ok = !stated.value.below_months(min);
            criterion(key, told(ok), &params, stated.span.as_ref(), text)
        }
        None => criterion(key, CriterionStatus::NotMentioned, &json!({}), None, text),
    }
}

/// The day rate: `Ok` for a stated EUR rate at the minimum, `NotMentioned` with `rateOpen`
/// for a rate to be agreed.
fn rate_state(min: i128, ad: &AdFacts, text: &str) -> CriterionState {
    let key = CriterionKey::MinDayRate;
    // A wage is no day rate.
    if let Some(rate) = ad.rate.as_ref().filter(|r| !r.value.wage) {
        let r = rate.value;
        let mut params = json!({ "rate": r.upper, "hourly": r.hourly });
        if r.hourly {
            // What the rule compares: the hourly rate per day.
            params["perDay"] = json!(r.per_day());
        }
        if let Some(from) = r.range_from() {
            params["from"] = json!(from);
        }
        if let Some(currency) = r.currency {
            params["currency"] = json!(currency_code(currency));
        }
        let ok = r.currency.is_none() && i128::from(r.per_day()) >= min;
        return criterion(key, told(ok), &params, rate.span.as_ref(), text);
    }
    let (params, span) = match &ad.rate_open {
        Some(open) => (json!({ "rateOpen": true }), open.span.as_ref()),
        None => (json!({}), None),
    };
    criterion(key, CriterionStatus::NotMentioned, &params, span, text)
}

/// The start: `Ok` for a stated start (a gap is a finding), `NotMentioned` for none or a
/// vague one.
fn start_state(ad: &AdFacts, text: &str) -> CriterionState {
    let key = CriterionKey::Availability;
    match &ad.start {
        Some(start) => {
            let params = json!({ "start": start_code(start.value) });
            let ok = start.value != Start::Vague;
            criterion(key, told(ok), &params, start.span.as_ref(), text)
        }
        None => criterion(key, CriterionStatus::NotMentioned, &json!({}), None, text),
    }
}

/// The state of every hard criterion from what the ad states, before the findings: `Ok`
/// only with the ad's value as evidence, `NotMentioned` without one, `Inactive` when the
/// profile does not set it or it does not apply to the contract type (a salary for a
/// freelance role, a day rate for a permanent one). Findings then decide violations and
/// checks.
fn evidence_states(profile: &EngineProfile, ad: &AdFacts, text: &str) -> Vec<CriterionState> {
    let c = &profile.criteria;
    let permanent = ad.contract == ContractKind::Permanent;
    // Employment pay: a permanent role or temporary agency work has no day rate.
    let employment = permanent || ad.contract == ContractKind::Anue;
    let unset = |key| criterion(key, CriterionStatus::Inactive, &json!({}), None, text);
    let remote_full =
        ad_facts::location_remote(&ad.location) || ad.remote.is_some_and(|(from, _)| from >= 100);
    let place = if remote_full {
        json!({ "remote": true })
    } else if ad.location.is_empty() {
        json!({})
    } else {
        json!({ "location": ad.location })
    };
    let anue_ok = ad.contract_stated
        && matches!(ad.contract, ContractKind::Interim | ContractKind::Permanent);
    vec![
        match c.min_rate {
            Some(min) if !employment => rate_state(min, ad, text),
            _ => unset(CriterionKey::MinDayRate),
        },
        match &c.countries {
            Some(allowed) => {
                let ok = remote_full || ad_facts::location_allowed(&ad.location, allowed);
                criterion(CriterionKey::Countries, told(ok), &place, None, text)
            }
            None => unset(CriterionKey::Countries),
        },
        if c.anue_excluded {
            let params = if anue_ok {
                json!({ "contract": ad.contract_code })
            } else {
                json!({})
            };
            let span = ad.contract_span.as_ref().filter(|_| anue_ok);
            criterion(CriterionKey::NoAnue, told(anue_ok), &params, span, text)
        } else {
            unset(CriterionKey::NoAnue)
        },
        if c.permanent_excluded {
            // Met only where the ad states an interim role.
            let ok = ad.contract_stated && ad.contract == ContractKind::Interim;
            let params = if ok {
                json!({ "contract": ad.contract_code })
            } else {
                json!({})
            };
            let span = ad.contract_span.as_ref().filter(|_| ok);
            criterion(CriterionKey::NoPermanent, told(ok), &params, span, text)
        } else {
            unset(CriterionKey::NoPermanent)
        },
        if c.project_excluded {
            // Met only where the ad states a permanent role or temporary agency work.
            let ok = ad.contract_stated
                && matches!(ad.contract, ContractKind::Permanent | ContractKind::Anue);
            let params = if ok {
                json!({ "contract": ad.contract_code })
            } else {
                json!({})
            };
            let span = ad.contract_span.as_ref().filter(|_| ok);
            criterion(CriterionKey::NoProject, told(ok), &params, span, text)
        } else {
            unset(CriterionKey::NoProject)
        },
        start_state(ad, text),
        match c.min_salary {
            Some(min) if employment => salary_state(min, ad, text),
            _ => unset(CriterionKey::MinSalary),
        },
        workload_state(c, ad, text),
        match c.min_months {
            // A permanent role has no end.
            Some(min) if !permanent => duration_state(min, ad, text),
            _ => unset(CriterionKey::Duration),
        },
        // Only a hit shows (a violation); no word is no evidence.
        unset(CriterionKey::ExclusionWords),
    ]
}

/// The workload: `Ok` for a stated workload within the profile's days per week (`from`,
/// `to` in percent), `NotMentioned` for none; one outside is a check (a finding).
fn workload_state(c: &HardCriteria, ad: &AdFacts, text: &str) -> CriterionState {
    let key = CriterionKey::Workload;
    let (min, max) = (c.workload_min, c.workload_max);
    if min.is_none() && max.is_none() {
        return criterion(key, CriterionStatus::Inactive, &json!({}), None, text);
    }
    match &ad.workload {
        Some(stated) => {
            let mut params = json!({ "to": stated.value.to });
            if let Some(from) = stated.value.from {
                params["from"] = json!(from);
            }
            let ok = limits::workload_fits(stated.value, min, max);
            criterion(key, told(ok), &params, stated.span.as_ref(), text)
        }
        None => criterion(key, CriterionStatus::NotMentioned, &json!({}), None, text),
    }
}

/// Every cap that fired with its reason, the lowest first.
fn cap_lines(evaluation: &Evaluation, core_total: u16) -> Vec<CapLine> {
    let s = &evaluation.signals;
    let mut caps: Vec<CapLine> = evaluation
        .caps
        .iter()
        .map(|&(max, code)| CapLine {
            code,
            max,
            params: object(&match code {
                CapCode::CoreOpen => json!({
                    "open": s.get(Sig::CoreOpen),
                    "total": core_total,
                }),
                CapCode::Level => json!({
                    "level": evaluation.level.map(|(l, _)| l),
                    "gap": evaluation.level.map(|(_, g)| g),
                }),
                CapCode::OffField => json!({
                    "field": evaluation.field.map(|(f, _)| f),
                }),
                CapCode::Formal | CapCode::Junior => json!({}),
            }),
        })
        .collect();
    caps.sort_by_key(|c| c.max);
    caps
}

#[cfg(test)]
mod tests {
    use crate::matching::{
        Assessment, CapCode, JobInput, PartCode, TextKind, assess, compile_profile,
    };
    use crate::portal::Portal;

    // external contract - do not translate (profile JSON keys)
    const PROFILE: &str = r#"{
        "kernkompetenzen": [
            {"kompetenz": "Controlling"}, {"kompetenz": "Reporting nach IFRS"},
            {"kompetenz": "Konsolidierung"}, {"kompetenz": "Liquiditätsplanung"},
            {"kompetenz": "Restrukturierung"}, {"kompetenz": "Treasury"}
        ],
        "wunschrollen": ["Interim CFO"],
        "arbeitsmodell": "remote"
    }"#;

    // external contract - do not translate (German ads)
    const CFO: &str = "Wir suchen einen Interim CFO für ein Familienunternehmen.\n\n\
        Ihr Profil\n\
        • Erfahrung im Controlling\n\
        • Reporting nach IFRS\n\
        • Erfahrung in der Konsolidierung\n\
        • Liquiditätsplanung\n\n\
        Wünschenswert\n\
        • Erfahrung mit Treasury\n\n\
        Der Einsatz ist zu 100 % remote.\n";

    fn assessed(title: &str, text: &str) -> Assessment {
        let profile = compile_profile(&crate::profile::parse(PROFILE).unwrap());
        let job = JobInput {
            title,
            company: "",
            location: "Hamburg",
            portal: Portal::Freelancermap,
            text,
            facts: None,
            posted: None,
            kind: TextKind::Full,
        };
        assess(&profile, &job).unwrap()
    }

    fn points(a: &Assessment, code: PartCode) -> i16 {
        a.parts
            .iter()
            .find(|p| p.code == code)
            .map_or(0, |p| p.points)
    }

    /// The lines of the Passungsgrad add up to the score: the four parts, the Kann bonus, the
    /// permanent line and the cap that held.
    #[test]
    fn the_lines_add_up_to_the_score() {
        let permanent = CFO.replace(
            "Wir suchen einen Interim CFO für ein Familienunternehmen.",
            "Wir suchen einen CFO in Festanstellung, Vollzeit und unbefristet.",
        );
        let open_core = CFO.replace("Reporting nach IFRS", "Steuerung nach US-GAAP und HGB");
        let foreign = "Wir suchen eine Pflegefachkraft.\n\nIhr Profil\n\
            • Examen in der Gesundheits- und Krankenpflege\n• Erfahrung in der Intensivpflege\n\
            • Kenntnisse der Wundversorgung\n";
        for (title, text) in [
            ("Interim CFO (m/w/d)", CFO),
            ("CFO (m/w/d)", permanent.as_str()),
            ("Interim CFO (m/w/d)", open_core.as_str()),
            ("Pflegefachkraft Intensivstation (m/w/d)", foreign),
        ] {
            let a = assessed(title, text);
            let sum: i16 = a.parts.iter().map(|p| p.points).sum();
            assert_eq!(sum, i16::from(a.score), "{title}: {:?}", a.parts);
            let codes: Vec<PartCode> = a.parts.iter().map(|p| p.code).take(4).collect();
            assert_eq!(
                codes,
                [
                    PartCode::Role,
                    PartCode::Core,
                    PartCode::Musts,
                    PartCode::Frame
                ]
            );
            for part in &a.parts[..4] {
                assert!(
                    part.points >= 0 && part.points <= i16::from(part.max),
                    "{part:?}"
                );
            }
            assert!(a.caps.windows(2).all(|w| w[0].max <= w[1].max));
        }
        let p = assessed("CFO (m/w/d)", &permanent);
        assert!(points(&p, PartCode::Permanent) < 0, "{:?}", p.parts);
    }

    /// Rolle und Fach: the target role in full is the same field; a nursing role is foreign
    /// to a finance profile and caps at 24.
    #[test]
    fn rolle_und_fach_follows_the_role_and_the_field() {
        let cfo = assessed("Interim CFO (m/w/d)", CFO);
        let role = &cfo.parts[0];
        assert_eq!(role.params["class"], "same", "{role:?}");
        assert_eq!(role.points, i16::from(role.max));
        let nurse = assessed(
            "Pflegefachkraft Intensivstation (m/w/d)",
            "Wir suchen eine Pflegefachkraft.\n\nIhr Profil\n\
             • Examen in der Gesundheits- und Krankenpflege\n• Erfahrung in der Intensivpflege\n\
             • Kenntnisse der Wundversorgung\n",
        );
        assert_eq!(
            nurse.parts[0].params["class"], "foreign",
            "{:?}",
            nurse.parts
        );
        assert_eq!(nurse.parts[0].points, 0);
        assert!(nurse.caps.iter().any(|c| c.code == CapCode::OffField));
        assert!(nurse.score <= 24, "{}", nurse.score);
    }

    /// Kern der Rolle: the musts on the field of the role count; open, they cost the part and
    /// cap at 49.
    #[test]
    fn the_core_counts_the_musts_on_the_role() {
        let met = assessed("Interim CFO (m/w/d)", CFO);
        assert!(
            met.parts[1].params["total"].as_u64().unwrap() > 0,
            "{:?}",
            met.parts
        );
        let open = assessed(
            "Interim CFO (m/w/d)",
            &CFO.replace(
                "Erfahrung im Controlling",
                "Erfahrung in der Aktuarmathematik",
            )
            .replace("Reporting nach IFRS", "Bilanzierung nach US-GAAP")
            .replace(
                "Erfahrung in der Konsolidierung",
                "Erfahrung im Asset Management",
            )
            .replace("Liquiditätsplanung", "Kenntnisse der Solvency-II-Bilanz"),
        );
        assert!(
            points(&open, PartCode::Core) < points(&met, PartCode::Core),
            "{:?} {:?}",
            met.parts,
            open.parts
        );
        assert!(open.score < met.score);
    }

    /// Weitere Muss-Punkte: an open must off the core costs its share of the part.
    #[test]
    fn an_open_other_must_costs_its_share() {
        let base = assessed("Interim CFO (m/w/d)", CFO);
        let more = assessed(
            "Interim CFO (m/w/d)",
            &CFO.replace(
                "• Liquiditätsplanung\n",
                "• Liquiditätsplanung\n• Sehr gute Kenntnisse in Anaplan\n",
            ),
        );
        assert!(
            points(&more, PartCode::Musts) < points(&base, PartCode::Musts)
                || points(&more, PartCode::Core) < points(&base, PartCode::Core),
            "{:?} {:?}",
            base.parts,
            more.parts
        );
        assert!(more.score <= base.score);
    }

    /// Rahmen: what the ad does not state fits; a work mode against the wish costs.
    #[test]
    fn the_frame_counts_what_the_ad_states() {
        let remote = assessed("Interim CFO (m/w/d)", CFO);
        let frame = &remote.parts[3];
        assert_eq!(frame.points, i16::from(frame.max), "{frame:?}");
        let unstated = assessed(
            "Interim CFO (m/w/d)",
            &CFO.replace("Der Einsatz ist zu 100 % remote.\n", ""),
        );
        assert_eq!(points(&unstated, PartCode::Frame), i16::from(frame.max));
        let onsite = assessed(
            "Interim CFO (m/w/d)",
            &CFO.replace(
                "Der Einsatz ist zu 100 % remote.",
                "Der Einsatz ist zu 100 % vor Ort.",
            ),
        );
        let lower = &onsite.parts[3];
        assert!(lower.points < frame.points, "{lower:?}");
        assert_eq!(lower.params["missed"], 1);
    }
}
