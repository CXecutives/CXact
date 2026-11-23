//! The rule for permanent roles (only when the profile sets it): the minimum annual salary.
//! Decided only for a stated permanent role with clear wording; an inferred permanent role,
//! an unclear contract (an agency without details) or unclear wording gives a check.
//!
//! Salary: EUR per year, the upper bound counts (`110.000 bis 130.000 €` -> 130,000) with the
//! bonus share its sentence names (`plus bis zu 20 % Bonus`), `ab 100.000` is a lower bound
//! that decides only when it stays below the minimum with `LOWER_BOUND_HEADROOM` added, a
//! salary heading of its own (`Gehaltsinformationen`) names the amounts of the line below it,
//! a monthly amount decides only when fourteen of them stay below the minimum (else a
//! check: the number of salaries a year is unknown), one in another currency is not compared
//! with a minimum in euros (a check, like a day rate in another currency).

use std::ops::Range;

use serde_json::json;

use super::ad_facts::currency_code;
use super::contract::{Contract, ContractKind};
use super::facts::{Finding, HardCriteria, Segment, hourly_pay_in};
use super::lexicon::engine as lex;
use super::normalize::{amount_at, amount_sides, ends_word};
use super::params::HOURS_PER_YEAR;
use super::types::{CriterionKey, ReasonCode};

/// The most salaries a year a monthly amount stands for (twelve and two extra).
const MONTHLY_SALARIES_MAX: u64 = 14;
/// How far above a lower bound (`ab 75.000 €`, `at least 60.000 €`) a salary may still go
/// (percent): a lower bound decides only when this much more stays below the minimum.
const LOWER_BOUND_HEADROOM: u64 = 25;

/// Does a rule for permanent roles apply, and may it decide?
fn scope(contract: &Contract) -> Option<bool> {
    match contract.kind {
        ContractKind::Permanent => Some(!contract.inferred),
        ContractKind::Unclear if contract.agency || contract.stated_permanent => Some(false),
        _ => None,
    }
}

/// A salary statement of one sentence.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Salary {
    /// Highest amount; `None` when only a lower bound is given (`ab 100.000 €`).
    pub upper: Option<u64>,
    pub lower: u64,
    pub monthly: bool,
    pub currency: Option<&'static str>,
}

impl Salary {
    /// The amount shown, per year (the highest, else the lower bound; a monthly one times
    /// twelve).
    pub(crate) fn per_year(&self) -> u64 {
        self.yearly(self.upper.unwrap_or(self.lower))
    }

    /// The lower end of a range, per year.
    pub(crate) fn range_from_per_year(&self) -> Option<u64> {
        self.upper
            .filter(|upper| self.lower < *upper)
            .map(|_| self.yearly(self.lower))
    }

    /// An amount of the statement per year (absurd digit runs saturate).
    fn yearly(&self, amount: u64) -> u64 {
        if self.monthly {
            amount.saturating_mul(12)
        } else {
            amount
        }
    }
}

/// The salary per year with the bonus share its sentence names: what the rule compares with
/// the minimum.
pub(crate) fn with_bonus(per_year: u64, bonus: u64) -> u64 {
    per_year.saturating_mul(100 + bonus) / 100
}

/// Amounts in a folded sentence: thousands separators, `k`/`TEUR` suffixes, no percentages.
fn amounts(folded: &str) -> Vec<(usize, u64)> {
    let bytes = folded.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() || (i > 0 && bytes[i - 1].is_ascii_alphabetic()) {
            i += 1;
            continue;
        }
        let start = i;
        let (value, end) = amount_at(bytes, i);
        i = end;
        let rest = folded[i..].trim_start();
        if rest.starts_with('%') || !money_context(folded, start, i) {
            continue;
        }
        let thousands = lex::THOUSAND_SUFFIXES.iter().any(|s| rest.starts_with(s))
            || rest == "k"
            || rest.starts_with("k-");
        let value = if thousands {
            value.saturating_mul(1000)
        } else {
            value
        };
        out.push((start, value));
    }
    out
}

/// Is the amount at `start..end` money: a currency or unit after it (past a range), or a
/// currency or salary word before it (`Gehalt: 120.000`, `€ 95.000`)? A count in the same
/// sentence (`rund 11.000 Beschäftigte`) is none.
fn money_context(folded: &str, start: usize, end: usize) -> bool {
    let (after, before) = amount_sides(folded, start, end);
    // A unit that ends in a letter is a word of its own (`11.000 Kunden` is no `k`).
    let unit_after = |u: &&str| {
        after.starts_with(*u) && (!u.ends_with(char::is_alphabetic) || ends_word(after, u.len()))
    };
    lex::SALARY_UNITS.iter().any(unit_after)
        || lex::SALARY_UNITS
            .iter()
            .chain(lex::SALARY_CUES)
            .any(|w| before.ends_with(w))
}

/// Parses a salary statement (a salary word and an amount of at least 10,000 per year or
/// 1,000 per month).
pub(crate) fn parse_salary(folded: &str) -> Option<Salary> {
    if !lex::SALARY_CUES.iter().any(|w| folded.contains(w)) {
        return None;
    }
    parse_amounts(folded)
}

/// A salary heading of its own (`Gehaltsinformationen`, `Salary information`): a salary word
/// and no digit in a few words.
fn salary_heading(folded: &str) -> bool {
    lex::SALARY_CUES.iter().any(|w| folded.contains(w))
        && !folded.chars().any(|c| c.is_ascii_digit())
        && folded.split_whitespace().count() <= 3
}

/// The salary of a sentence: stated in it, or in the line below a salary heading
/// (`Gehaltsinformationen` then `100.000€- 120.000€ je nach Berufserfahrung`).
fn stated_salary(segments: &[Segment]) -> Option<(Salary, Range<usize>)> {
    segments.iter().enumerate().find_map(|(i, (range, f))| {
        parse_salary(f).map(|s| (s, range.clone())).or_else(|| {
            let (next, below) = segments.get(i + 1).filter(|_| salary_heading(f))?;
            parse_amounts(below).map(|s| (s, next.clone()))
        })
    })
}

/// The amounts of a sentence known to state a salary.
fn parse_amounts(folded: &str) -> Option<Salary> {
    let monthly = lex::MONTHLY_WORDS.iter().any(|w| folded.contains(w));
    let floor = if monthly {
        lex::SALARY_MIN_AMOUNT / 10
    } else {
        lex::SALARY_MIN_AMOUNT
    };
    let found: Vec<(usize, u64)> = amounts(folded)
        .into_iter()
        .filter(|(_, v)| *v >= floor)
        .collect();
    let upper = found.iter().map(|(_, v)| *v).max()?;
    let lower = found.iter().map(|(_, v)| *v).min().unwrap_or(upper);
    let lower_only = found.len() == 1 && {
        let before = &folded[..found[0].0];
        let tail: String = before
            .chars()
            .rev()
            .take(24)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        lex::LOWER_BOUND_WORDS.iter().any(|w| tail.contains(w))
    };
    let currency = lex::OTHER_CURRENCIES
        .iter()
        .find(|w| folded.contains(**w))
        .copied();
    Some(Salary {
        upper: (!lower_only).then_some(upper),
        lower,
        monthly,
        currency,
    })
}

/// Minimum salary rule.
pub(crate) fn salary(
    criteria: &HardCriteria,
    contract: &Contract,
    title: &str,
    segments: &[Segment],
) -> Vec<Finding> {
    // The pay of temporary agency work is employment pay too (where ANÜ itself is allowed).
    let scope = match contract.kind {
        ContractKind::Anue => (!criteria.anue_excluded).then_some(true),
        _ => scope(contract),
    };
    let (Some(min), Some(may_decide)) = (criteria.min_salary, scope) else {
        return Vec::new();
    };
    let key = Some(CriterionKey::MinSalary);
    // An hourly wage of an employment counts per year (`16,50 € pro Stunde`).
    let hourly = || {
        segments.iter().find_map(|(range, f)| {
            let rate = hourly_pay_in(f)?;
            let per_year = rate.upper.saturating_mul(HOURS_PER_YEAR);
            let salary = Salary {
                upper: Some(per_year),
                lower: per_year,
                monthly: false,
                currency: rate.currency,
            };
            Some((salary, range.clone()))
        })
    };
    let stated = stated_salary(segments);
    // The stated wage of a student role decides like a stated salary.
    let wage = stated.is_none() && super::contract::student_role(title);
    let may_decide = may_decide || wage;
    let Some((salary, span)) = stated.or_else(hourly) else {
        return vec![Finding::new(
            ReasonCode::SalaryUnknown,
            false,
            key,
            json!({ "min": min }),
            Vec::new(),
        )];
    };
    let bonus = segments
        .iter()
        .find(|(r, _)| *r == span)
        .map_or(0, |(_, f)| bonus_percent(f));
    let stated = salary.per_year();
    let mut params = json!({ "salary": stated });
    if salary.upper.is_none() {
        params["lowerBound"] = json!(true);
    }
    if salary.monthly {
        params["monthly"] = json!(true);
    }
    if let Some(from) = salary.range_from_per_year() {
        params["from"] = json!(from);
    }
    // Another currency is never compared with a minimum in euros: unclear.
    if let Some(currency) = salary.currency {
        params["currency"] = json!(currency_code(currency));
        return vec![Finding::new(
            ReasonCode::Salary,
            false,
            key,
            params,
            vec![span],
        )];
    }
    let compared = with_bonus(stated, bonus);
    if compared >= min {
        return Vec::new();
    }
    params["min"] = json!(min);
    if bonus > 0 {
        params["bonus"] = json!(bonus);
        params["withBonus"] = json!(compared);
    }
    // A monthly salary decides only when even fourteen of them stay below the minimum.
    let clear = !salary.monthly
        || salary.upper.is_some_and(|upper| {
            with_bonus(upper.saturating_mul(MONTHLY_SALARIES_MAX), bonus) < min
        });
    // A lower bound decides only when the headroom above it stays below the minimum too.
    let bounded = salary.upper.is_some() || with_bonus(compared, LOWER_BOUND_HEADROOM) < min;
    let decided = may_decide && bounded && clear;
    vec![Finding::new(
        ReasonCode::Salary,
        decided,
        key,
        params,
        vec![span],
    )]
}

/// Percentages in a folded sentence.
/// The share of a variable pay the salary sentence names (`plus bis zu 20 % Bonus`), read in
/// the clause that names the bonus (`100 % remote` elsewhere in the sentence is none).
pub(crate) fn bonus_percent(folded: &str) -> u64 {
    folded
        .split([',', ';', '(', ')'])
        .filter(|clause| lex::BONUS_WORDS.iter().any(|w| clause.contains(w)))
        .flat_map(percents)
        .max()
        .unwrap_or(0)
}

pub(crate) fn percents(folded: &str) -> Vec<u64> {
    let bytes = folded.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() {
            i += 1;
            continue;
        }
        let mut value: u64 = 0;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            value = value
                .saturating_mul(10)
                .saturating_add(u64::from(bytes[i] - b'0'));
            i += 1;
        }
        if folded[i..].trim_start().starts_with('%') && value <= 100 {
            out.push(value);
        }
    }
    out
}

/// Words of a location that name a place (no country, state, postal code or work mode).
pub(crate) fn place_words(folded: &str) -> Vec<&str> {
    folded
        .split(|c: char| !c.is_alphanumeric() && c != '-')
        .filter(|w| w.len() > 1)
        .filter(|w| !w.chars().any(|c| c.is_ascii_digit()))
        .filter(|w| *w != "remote" && lex::LOCATION_NOISE.binary_search(w).is_err())
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::matching::atoms::fold;
    use crate::matching::contract::infer;
    use crate::matching::facts::{JobFacts, anue, segments};
    use crate::portal::Portal;

    /// Salary findings of a LinkedIn ad for a profile open to Festanstellung with a minimum of
    /// 150,000 a year.
    fn salary_of(text: &str) -> Vec<(ReasonCode, bool)> {
        let form = crate::profile::ProfileForm {
            permanent: true,
            min_salary: Some(150_000),
            ..crate::profile::ProfileForm::default()
        };
        let criteria = HardCriteria::new(&form);
        let job = JobFacts {
            title: "Head of Controlling (m/w/d)",
            text,
            location: "München",
            portal: Portal::LinkedIn,
            facts: None,
            posted: None,
        };
        let segments = segments(text);
        let contract = infer(&job, &segments, &anue(&job, &segments));
        salary(&criteria, &contract, job.title, &segments)
            .into_iter()
            .map(|f| (f.code, f.decided))
            .collect()
    }

    #[test]
    fn permanent_salary() {
        let permanent = "Wir bieten eine unbefristete Festanstellung.";
        let with = |extra: &str| {
            format!(
                "{permanent}
{extra}"
            )
        };
        assert_eq!(salary_of(permanent), [(ReasonCode::SalaryUnknown, false)]);
        assert!(salary_of(&with("Jahresgehalt 160.000 €.")).is_empty());
        let low = with("Jahresgehalt von 110.000 bis 130.000 € zuzüglich Bonus.");
        assert_eq!(salary_of(&low), [(ReasonCode::Salary, true)]);
        // A lower bound decides only far below the minimum (with a quarter more still below).
        let from = with("Gehalt ab 130.000 € brutto.");
        assert_eq!(salary_of(&from), [(ReasonCode::Salary, false)]);
        let far = with("Für die Stelle ist ein Jahresbruttogehalt ab EUR 110.000 vorgesehen.");
        assert_eq!(salary_of(&far), [(ReasonCode::Salary, true)]);
        let least = with("The compensation is at least 90.000 € gross per year.");
        assert_eq!(salary_of(&least), [(ReasonCode::Salary, true)]);
        // A salary heading of its own names the amounts of the line below it; the upper end
        // decides.
        let below = with("Gehaltsinformationen\n100.000€- 120.000€ je nach Berufserfahrung");
        assert_eq!(salary_of(&below), [(ReasonCode::Salary, true)]);
        let above = with("Gehaltsinformationen\n140.000€- 160.000€ je nach Berufserfahrung");
        assert!(salary_of(&above).is_empty());
        // A heading without a line of amounts below it states nothing.
        let none = with("Salary information\nAttraktive Vergütung und Firmenwagen.");
        assert_eq!(salary_of(&none), [(ReasonCode::SalaryUnknown, false)]);
        assert!(salary_of("Interim-Mandat, Tagessatz 1.200 € pro Tag.").is_empty());
        // A monthly salary decides only when fourteen of them stay below the minimum.
        let monthly = with("3.950 €/Monat - 4.850 €/Monat");
        assert_eq!(salary_of(&monthly), [(ReasonCode::Salary, true)]);
        let near = with("Monatsgehalt 11.000 € brutto.");
        assert_eq!(salary_of(&near), [(ReasonCode::Salary, false)]);
    }

    /// LinkedIn's salary chip states a permanent role and its salary; a bonus share in the
    /// salary clause raises the upper bound (`100 % remote` in another clause does not).
    #[test]
    fn salary_chips_and_bonus_shares() {
        assert_eq!(
            salary_of("120.000 €/Jahr - 140.000 €/Jahr"),
            [(ReasonCode::Salary, true)]
        );
        let permanent = "Wir bieten eine unbefristete Festanstellung.";
        let with = |extra: &str| format!("{permanent}\n{extra}");
        assert!(
            salary_of(&with(
                "Jahresgehalt 120.000 bis 130.000 € plus bis zu 20 % Bonus."
            ))
            .is_empty()
        );
        assert_eq!(
            salary_of(&with(
                "Jahresgehalt 120.000 bis 130.000 € zzgl. Bonus, 100 % remote möglich."
            )),
            [(ReasonCode::Salary, true)]
        );
    }

    #[test]
    fn salaries() {
        let s = |t: &str| parse_salary(&fold(t));
        let upper = |t: &str| s(t).and_then(|s| s.upper);
        assert_eq!(
            upper("Ein Jahresgehalt von 110.000 bis 130.000 € zuzüglich Bonus"),
            Some(130_000)
        );
        assert_eq!(
            upper("Zielgehalt von 160.000 – 190.000 € p. a."),
            Some(190_000)
        );
        assert_eq!(upper("Salary: 120k - 140k EUR"), Some(140_000));
        assert_eq!(upper("Vergütung bis zu 95 TEUR"), Some(95_000));
        let from = s("Gehalt ab 100.000 € brutto").unwrap();
        assert_eq!((from.upper, from.lower), (None, 100_000));
        assert!(s("Monatsgehalt 8.500 € brutto").unwrap().monthly);
        assert_eq!(s("Salary CHF 180,000").unwrap().currency, Some("chf"));
        assert!(s("30 Tage Urlaub und betriebliche Altersvorsorge").is_none());
        assert!(s("Eine Festanstellung in Vollzeit mit attraktiver Vergütung").is_none());
        // Only money counts: a count in a sentence with a salary word is no salary.
        assert!(
            s("Ein Konzern mit rund 11.000 Beschäftigten führt SAP Compensation ein.").is_none()
        );
        assert!(s("Salary review for 12,000 employees and 40 countries").is_none());
        assert_eq!(upper("Gehalt: 120.000 - 140.000"), Some(140_000));
        assert_eq!(upper("Vergütung 95.000 brutto p.a."), Some(95_000));
    }

    #[test]
    fn percents_and_place_words() {
        assert_eq!(percents("die position ist zu 80 % remote moglich"), [80]);
        assert!(percents("bis zu drei tage mobiles arbeiten pro woche").is_empty());
        assert_eq!(
            place_words("frankfurt am main, hessen, deutschland"),
            ["frankfurt", "am", "main"]
        );
        assert!(place_words("deutschland").is_empty());
        assert!(place_words("80333 munchen").contains(&"munchen"));
    }
}
