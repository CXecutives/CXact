//! Wishes of the profile (`ENGINE_VERSION` 4, the v19 fields since 19): day rate, work mode
//! and regions. Each wish is off while it is empty; a wish never excludes (exclusions are the
//! hard criteria). The industries of the profile are experience, no wish (21).
//!
//! Every wish ends in a state: met, near, clearly missed or unknown. They are part of the
//! frame of the Passungsgrad (`scorer.rs`): near counts in part, missed against, unknown
//! fits.
//!
//! - Day rate (`tagessatz_wunsch`, not for permanent roles): the upper bound of the stated
//!   EUR rate per day (hourly x 8) at or above the wish is met, at least `WISH_RATE_NEAR`
//!   of it near, below that missed; no rate or another currency is unknown.
//! - Work mode (`arbeitsmodell`: `remote` at least fully remote, `hybrid` at least partly,
//!   `vor_ort` on site, `egal` no wish) as a minimum share (100, 20) against the ad's remote
//!   share (facts, `N % remote`, office or remote days, full-remote
//!   wording, hybrid wording, on site only): met when the share is at least the minimum,
//!   missed when the ad is on site only or its share stays more than `REMOTE_MARGIN` below
//!   it (hybrid wording is near a fully remote wish); `vor_ort` is met up to `ONSITE_MAX`
//!   percent and missed only by a fully remote ad.
//! - Regions (`regionen`: places, German states, regions such as `Rhein-Main`, countries):
//!   a fully remote ad is met; a wished place in the location, a location line or an
//!   on-site sentence is met; another known place (larger German cities, states, foreign
//!   cities and countries) is missed, or near with at least `REGION_REMOTE_NEAR` percent
//!   remote; no known place (a country of the profile only, a small town) is unknown.

use std::cell::LazyCell;
use std::collections::HashMap;
use std::ops::Range;
use std::sync::LazyLock;

use serde_json::{Value, json};

use super::ad_facts::AdFacts;
use super::atoms::fold;
use super::contract::ContractKind;
use super::facts::{self, JobFacts, Segment, fact};
use super::lexicon::{engine as core_lex, wishes as lex};
use super::normalize::{
    contains_word, find_word, holds_any, starts_word, word_bounded, word_spans,
};
use super::params::{
    HYBRID_SHARE, ONSITE_MAX, REGION_REMOTE_NEAR, REMOTE_FULL, REMOTE_MARGIN, REMOTE_NAMED_SHARE,
    REMOTE_PARTLY, WISH_RATE_NEAR, WORKDAYS,
};
use super::types::{ReasonCode, ReasonKind, WishInfo, WishKey};
use crate::profile::{ProfileForm, WorkWish, key};

/// The remote share a profile wishes.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum RemoteWish {
    /// At least this share (percent).
    Min(u64),
    /// Presence on site.
    OnSite,
}

impl RemoteWish {
    /// Params of the wish: the minimum share, on site, and the work mode of the profile
    /// (`remote`, `hybrid`, `onsite`).
    fn params(self) -> Value {
        match self {
            RemoteWish::Min(min) => {
                let level = if min == REMOTE_FULL {
                    "remote"
                } else {
                    "hybrid"
                };
                json!({ "min": min, "onsite": false, "level": level })
            }
            RemoteWish::OnSite => json!({ "min": null, "onsite": true, "level": "onsite" }),
        }
    }

    /// The wish of a work mode; none for `Any`.
    fn of(mode: WorkWish) -> Option<RemoteWish> {
        match mode {
            WorkWish::Any => None,
            WorkWish::Remote => Some(RemoteWish::Min(REMOTE_FULL)),
            WorkWish::Hybrid => Some(RemoteWish::Min(REMOTE_PARTLY)),
            WorkWish::Onsite => Some(RemoteWish::OnSite),
        }
    }
}

/// The wishes of a profile.
#[derive(Debug, Clone, Default)]
pub(crate) struct Wishes {
    pub rate: Option<u64>,
    pub remote: Option<RemoteWish>,
    /// Regions as written.
    pub regions: Option<Vec<String>>,
    /// The regions folded, with the places of states, regions and countries.
    places: Places,
    /// Per wish reason: the profile value as written and its JSON path.
    sources: Vec<(ReasonCode, String, String)>,
}

/// Every place a known region, state or country stands for, and all known places.
static KNOWN_PLACES: LazyLock<Places> = LazyLock::new(|| {
    Places::new(
        core_lex::GERMAN_CITIES
            .iter()
            .copied()
            .chain(lex::REGION_PLACES.iter().map(|(region, _)| *region))
            .chain(
                lex::REGION_PLACES
                    .iter()
                    .flat_map(|(_, p)| p.iter().copied()),
            )
            .chain(core_lex::CITIES.iter().map(|(city, _)| *city))
            .chain(
                core_lex::COUNTRIES
                    .iter()
                    .filter(|(_, code)| *code != "DE")
                    .map(|(name, _)| *name),
            ),
    )
});

/// Folded places to look for in a text: one pass over the words of a text finds the place
/// it names first, where a search per place would read the text once for each of them.
#[derive(Debug, Clone, Default)]
struct Places {
    /// The places that start with a letter or digit, by their first word, the longest first.
    by_word: HashMap<String, Vec<String>>,
    /// The places that start with another sign (a region written so), searched one by one.
    others: Vec<String>,
}

impl Places {
    fn new<S: AsRef<str>>(places: impl IntoIterator<Item = S>) -> Self {
        let mut index = Places::default();
        for place in places {
            let place = place.as_ref();
            if place.is_empty() {
                continue;
            }
            match place.split(|c: char| !c.is_alphanumeric()).next() {
                Some(word) if !word.is_empty() => index
                    .by_word
                    .entry(word.to_owned())
                    .or_default()
                    .push(place.to_owned()),
                _ => index.others.push(place.to_owned()),
            }
        }
        for list in index.by_word.values_mut() {
            list.sort_by(|a, b| b.len().cmp(&a.len()).then_with(|| a.cmp(b)));
            list.dedup();
        }
        index.others.sort();
        index.others.dedup();
        index
    }

    /// The place a folded text names first as a whole word (`München, Bayern` names
    /// München), the longest of those that start there.
    fn first_named(&self, folded: &str) -> Option<&str> {
        let indexed = word_spans(folded, &[])
            .into_iter()
            .find_map(|(start, word)| {
                let places = self.by_word.get(word)?;
                let place = places.iter().find(|p| whole_at(folded, start, p))?;
                Some((start, place.as_str()))
            });
        self.others
            .iter()
            .filter_map(|place| find_word(folded, place).map(|start| (start, place.as_str())))
            .chain(indexed)
            .min_by_key(|(start, place)| (*start, std::cmp::Reverse(place.len())))
            .map(|(_, place)| place)
    }
}

/// Does `place` stand in the folded text at `start` as a whole word?
fn whole_at(folded: &str, start: usize, place: &str) -> bool {
    folded[start..].starts_with(place) && word_bounded(folded, start, start + place.len())
}

/// German places (cities and states) for a region `Deutschland`.
fn german_places() -> impl Iterator<Item = &'static str> {
    core_lex::GERMAN_CITIES
        .iter()
        .copied()
        .chain(lex::REGION_PLACES.iter().map(|(region, _)| *region))
        .chain(
            lex::REGION_PLACES
                .iter()
                .flat_map(|(_, p)| p.iter().copied()),
        )
}

/// A folded region with every place it stands for.
fn expand(region: &str) -> Vec<String> {
    let mut places = vec![region.to_owned()];
    for (name, inside) in lex::REGION_PLACES {
        if *name == region {
            places.extend(inside.iter().map(|p| (*p).to_owned()));
        }
    }
    if let Some(&(_, code)) = core_lex::COUNTRIES.iter().find(|(name, _)| *name == region) {
        places.extend(
            core_lex::COUNTRIES
                .iter()
                .filter(|(_, c)| *c == code)
                .map(|(name, _)| (*name).to_owned()),
        );
        places.extend(
            core_lex::CITIES
                .iter()
                .filter(|(_, c)| *c == code)
                .map(|(city, _)| (*city).to_owned()),
        );
        if code == "DE" {
            places.extend(german_places().map(str::to_owned));
        }
    }
    places
}

/// Words of a text as written (letters, digits, `-`, `&`), without surrounding hyphens.
fn words(text: &str) -> impl Iterator<Item = &str> {
    text.split(|c: char| !(c.is_alphanumeric() || c == '-' || c == '&'))
        .map(|w| w.trim_matches('-'))
        .filter(|w| !w.is_empty())
}

/// Does a folded word stand for an entry of a word list: the same word, or a longer word
/// starting with an entry of at least six letters?
fn word_is(folded: &str, entry: &str) -> bool {
    folded == entry || (entry.len() >= 6 && folded.starts_with(entry))
}

impl Wishes {
    /// Reads the wishes of a profile.
    pub(crate) fn new(form: &ProfileForm) -> Self {
        let mut wishes = Wishes::default();
        let regions: Vec<String> = form
            .regions
            .iter()
            .map(|r| r.trim().to_owned())
            .filter(|t| !t.is_empty())
            .collect();
        wishes.rate = form.day_rate_wish.filter(|n| *n > 0).map(u64::from);
        wishes.remote = RemoteWish::of(form.work_mode);
        wishes.regions = (!regions.is_empty()).then_some(regions);
        if let Some(rate) = wishes.rate {
            wishes.sources.push((
                ReasonCode::DayRateWish,
                rate.to_string(),
                key::DAY_RATE_WISH.to_owned(),
            ));
        }
        if wishes.remote.is_some() {
            let mode = serde_json::to_value(form.work_mode)
                .ok()
                .and_then(|v| v.as_str().map(str::to_owned))
                .unwrap_or_default();
            wishes
                .sources
                .push((ReasonCode::RemoteWish, mode, key::WORK_MODE.to_owned()));
        }
        if let Some(list) = &wishes.regions {
            wishes.sources.push((
                ReasonCode::RegionWish,
                list.join(", "),
                key::REGIONS.to_owned(),
            ));
        }
        wishes.places = Places::new(
            wishes
                .regions
                .iter()
                .flatten()
                .flat_map(|r| expand(&fold(r))),
        );
        wishes
    }

    /// The wishes as understood (`set` and the values).
    pub(crate) fn info(&self) -> Vec<WishInfo> {
        let info = |key, set: bool, params: Value| WishInfo {
            key,
            set,
            params: params.as_object().cloned().unwrap_or_default(),
        };
        let remote = self.remote.map_or_else(
            || json!({ "min": null, "onsite": null, "level": null }),
            RemoteWish::params,
        );
        vec![
            info(
                WishKey::DayRate,
                self.rate.is_some(),
                json!({ "wish": self.rate }),
            ),
            info(WishKey::Remote, self.remote.is_some(), remote),
            info(
                WishKey::Regions,
                self.regions.is_some(),
                json!({ "regions": self.regions }),
            ),
        ]
    }

    /// The canonical view for the profile fingerprint.
    pub(crate) fn canonical(&self) -> String {
        let sorted = |list: &Option<Vec<String>>| {
            list.as_ref().map(|l| {
                let mut l: Vec<String> = l.iter().map(|t| fold(t)).collect();
                l.sort();
                l
            })
        };
        format!(
            "rate {:?} remote {:?} regions {:?}",
            self.rate,
            self.remote,
            sorted(&self.regions)
        )
    }

    /// The profile value (as written) and JSON path behind a wish reason.
    pub(crate) fn source(&self, code: ReasonCode) -> Option<(&str, &str)> {
        self.sources
            .iter()
            .find(|(c, _, _)| *c == code)
            .map(|(_, text, path)| (text.as_str(), path.as_str()))
    }
}

/// How a wish came out.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum State {
    Met,
    Near,
    Missed,
    Unknown,
}

impl State {
    fn name(self) -> &'static str {
        match self {
            Self::Met => "met",
            Self::Near => "near",
            Self::Missed => "missed",
            Self::Unknown => "unknown",
        }
    }

    /// The reader groups: met, met in part, open (missed or not stated).
    pub(crate) fn kind(self) -> ReasonKind {
        match self {
            Self::Met => ReasonKind::Met,
            Self::Near => ReasonKind::Partial,
            Self::Missed | Self::Unknown => ReasonKind::Open,
        }
    }
}

/// One wish for one job, with the passages behind it.
#[derive(Debug, Clone)]
pub(crate) struct WishResult {
    pub code: ReasonCode,
    pub state: State,
    pub params: Value,
    pub spans: Vec<Range<usize>>,
}

fn result(
    code: ReasonCode,
    state: State,
    mut params: Value,
    spans: Vec<Range<usize>>,
) -> WishResult {
    params["state"] = json!(state.name());
    WishResult {
        code,
        state,
        params,
        spans,
    }
}

/// The wishes for one ad (`ad`: what it states), in the order day rate, remote, region.
pub(crate) fn evaluate(
    wishes: &Wishes,
    job: &JobFacts<'_>,
    segments: &[Segment],
    ad: &AdFacts,
) -> Vec<WishResult> {
    let mut out = Vec::new();
    if let Some(wish) = wishes.rate
        && ad.contract != ContractKind::Permanent
    {
        out.push(rate(wish, ad));
    }
    if let Some(wish) = wishes.remote {
        out.push(remote(wish, ad.remote));
    }
    if wishes.regions.is_some() {
        out.push(region(&wishes.places, job, segments, ad.remote));
    }
    out
}

fn rate(wish: u64, ad: &AdFacts) -> WishResult {
    let code = ReasonCode::DayRateWish;
    // A wage is employment pay, no day rate.
    let Some(stated) = ad.rate.as_ref().filter(|r| !r.value.wage) else {
        return result(code, State::Unknown, json!({ "wish": wish }), Vec::new());
    };
    let rate = stated.value;
    let spans: Vec<Range<usize>> = stated.span.clone().into_iter().collect();
    if let Some(currency) = rate.currency {
        let params = json!({ "wish": wish, "currency": currency.to_uppercase() });
        return result(code, State::Unknown, params, spans);
    }
    let per_day = rate.per_day();
    let state = if per_day >= wish {
        State::Met
    } else if u128::from(per_day) * 1000 >= u128::from(wish) * u128::from(WISH_RATE_NEAR) {
        State::Near
    } else {
        State::Missed
    };
    let mut params = json!({ "wish": wish, "rate": per_day, "hourly": rate.hourly });
    facts::rate_amounts(&mut params, &rate);
    result(code, state, params, spans)
}

/// Does a folded text name one of `list` (whole words, word starts from six letters on, or
/// phrases)?
fn names(folded: &str, list: &'static [&'static str]) -> bool {
    holds_any(folded, list)
        && list.iter().any(|entry| {
            if entry.contains(' ') {
                contains_word(folded, entry)
            } else {
                words(folded).any(|w| word_is(w, entry))
            }
        })
}

fn has_remote(folded: &str) -> bool {
    names(folded, lex::REMOTE_AD_WORDS)
}

fn has_onsite(folded: &str) -> bool {
    names(folded, lex::ONSITE_AD_WORDS)
}

/// Shares one sentence states: `N % remote`, `N % vor Ort`, `Remote: N %`, and office or
/// remote days of a week (`zwei Tage vor Ort` = 60 %).
fn stated_shares(folded: &str) -> Vec<u64> {
    let mut out = Vec::new();
    // A share is a percentage or a number of days.
    if !folded.contains('%') && !holds_any(folded, lex::DAY_WORDS) {
        return out;
    }
    // Read only where a share or days need them (most sentences state neither).
    let remote = LazyCell::new(|| has_remote(folded));
    let onsite = LazyCell::new(|| has_onsite(folded));
    let bytes = folded.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if !bytes[i].is_ascii_digit() || (i > 0 && bytes[i - 1].is_ascii_alphanumeric()) {
            i += 1;
            continue;
        }
        let start = i;
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        let Ok(n) = folded[start..i].parse::<u64>() else {
            continue;
        };
        let rest = folded[i..].trim_start();
        if let Some(after) = rest.strip_prefix('%')
            && n <= 100
        {
            // The words right after the share say what it is.
            let head = words(after).take(3).collect::<Vec<_>>().join(" ");
            let to_remote = first_at(&head, lex::REMOTE_AD_WORDS);
            let to_onsite = first_at(&head, lex::ONSITE_AD_WORDS);
            if to_onsite < to_remote {
                out.push(100 - n);
            } else if to_remote < to_onsite || *remote {
                out.push(n);
            }
        }
    }
    let tokens: Vec<&str> = words(folded).collect();
    for (at, pair) in tokens.windows(2).enumerate() {
        let n = pair[0].parse::<u64>().ok().or_else(|| {
            lex::DAY_NUMBERS
                .iter()
                .find(|(word, _)| *word == pair[0])
                .map(|&(_, n)| n)
        });
        let Some(n) = n.filter(|n| (1..=WORKDAYS).contains(n)) else {
            continue;
        };
        if !lex::DAY_WORDS.contains(&pair[1]) {
            continue;
        }
        let after = tokens[at + 2..].join(" ");
        let (days_remote, days_onsite) = if has_remote(&after) || has_onsite(&after) {
            let first_remote = first_at(&after, lex::REMOTE_AD_WORDS);
            let first_onsite = first_at(&after, lex::ONSITE_AD_WORDS);
            (first_remote < first_onsite, first_onsite < first_remote)
        } else {
            (*remote && !*onsite, *onsite && !*remote)
        };
        let per_day = 100 / WORKDAYS;
        if days_remote {
            out.push(n * per_day);
        } else if days_onsite {
            out.push((WORKDAYS - n) * per_day);
        }
    }
    out
}

/// Byte position of the first word of `list` in a folded text (`usize::MAX` if none).
fn first_at(folded: &str, list: &[&str]) -> usize {
    let first = |entry: &&str| {
        let mut starts = folded.match_indices(*entry).map(|(at, _)| at);
        starts.find(|&at| starts_word(folded, at))
    };
    list.iter().filter_map(first).min().unwrap_or(usize::MAX)
}

/// The ad's remote share in percent (from, to), as far as it can be read.
pub(crate) fn remote_share(
    job: &JobFacts<'_>,
    segments: &[Segment],
    folded: &str,
) -> Option<(u64, u64)> {
    if let Some(p) = fact(job.facts, super::fact_key::REMOTE_PERCENT).and_then(Value::as_u64) {
        let p = p.min(100);
        return Some((p, p));
    }
    let location = fold(
        fact(job.facts, super::fact_key::LOCATION)
            .and_then(Value::as_str)
            .unwrap_or(job.location),
    );
    let mut stated: Vec<u64> = segments
        .iter()
        .flat_map(|(_, f)| stated_shares(f))
        .collect();
    let full = holds_any(folded, core_lex::FULL_REMOTE)
        || holds_any(folded, core_lex::REMOTE_FULL_EXTRA)
        || contains_word(&location, "remote");
    if full {
        stated.push(100);
    }
    if let Some(&max) = stated.iter().max() {
        return Some((max, max));
    }
    if holds_any(folded, lex::REMOTE_NONE) {
        return Some((0, 0));
    }
    if holds_any(folded, lex::HYBRID_WORDS) || contains_word(&location, "hybrid") {
        return Some(HYBRID_SHARE);
    }
    if segments.iter().any(|(_, f)| has_remote(f)) {
        let mixed = segments.iter().any(|(_, f)| has_remote(f) && has_onsite(f));
        return Some(if mixed {
            HYBRID_SHARE
        } else {
            REMOTE_NAMED_SHARE
        });
    }
    if segments.iter().any(|(_, f)| has_onsite(f)) || has_onsite(&location) {
        return Some((0, 0));
    }
    None
}

fn remote(wish: RemoteWish, share: Option<(u64, u64)>) -> WishResult {
    let code = ReasonCode::RemoteWish;
    let mut params = wish.params();
    let Some((from, to)) = share else {
        return result(code, State::Unknown, params, Vec::new());
    };
    if from == to {
        params["share"] = json!(from);
    } else {
        params["from"] = json!(from);
        params["to"] = json!(to);
    }
    let (met, missed) = match wish {
        RemoteWish::Min(min) => (from >= min, to == 0 || to + REMOTE_MARGIN < min),
        RemoteWish::OnSite => (to <= ONSITE_MAX, from >= REMOTE_FULL),
    };
    let state = if met {
        State::Met
    } else if missed {
        State::Missed
    } else {
        State::Near
    };
    result(code, state, params, Vec::new())
}

/// The first word of `text` whose folded form is `place` (else `place` itself).
fn as_written(text: &str, place: &str) -> String {
    words(text)
        .find(|w| fold(w) == place)
        .map_or_else(|| place.to_owned(), str::to_owned)
}

fn region(
    places: &Places,
    job: &JobFacts<'_>,
    segments: &[Segment],
    share: Option<(u64, u64)>,
) -> WishResult {
    let code = ReasonCode::RegionWish;
    let from = share.map_or(0, |(from, _)| from);
    if from >= 100 {
        return result(code, State::Met, json!({ "remote": true }), Vec::new());
    }
    let raw = fact(job.facts, super::fact_key::LOCATION)
        .and_then(Value::as_str)
        .unwrap_or(job.location);
    // Where the ad names its place: the location, location lines, on-site sentences.
    let mut sources: Vec<(String, Option<Range<usize>>, &str)> = vec![(fold(raw), None, raw)];
    for (range, f) in segments {
        let line = core_lex::LOCATION_LINES.iter().any(|w| f.starts_with(w));
        let onsite = core_lex::ONSITE_WORDS.iter().any(|w| f.contains(w));
        if line || onsite {
            let written = job.text.get(range.clone()).unwrap_or("");
            sources.push((f.clone(), Some(range.clone()), written));
        }
    }
    let spans = |range: &Option<Range<usize>>| range.clone().into_iter().collect::<Vec<_>>();
    for (folded, range, written) in &sources {
        if let Some(place) = places.first_named(folded) {
            let params = json!({ "location": as_written(written, place), "remote": false });
            return result(code, State::Met, params, spans(range));
        }
    }
    for (folded, range, written) in &sources {
        if let Some(place) = KNOWN_PLACES.first_named(folded) {
            let state = if from >= REGION_REMOTE_NEAR {
                State::Near
            } else {
                State::Missed
            };
            let params = json!({ "location": as_written(written, place), "remote": false });
            return result(code, state, params, spans(range));
        }
    }
    result(code, State::Unknown, json!({}), Vec::new())
}

#[cfg(test)]
mod tests;
