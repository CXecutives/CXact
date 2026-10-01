//! Safety rules for portal requests - pace, caps, pauses - and their durable state in
//! `policy.json`.
//!
//! Principle: inconspicuous through restraint, not through disguise. **Every** request is
//! counted (failures and sign-in pages too); clicking again circumvents nothing. The file
//! lives next to the database and survives "reset everything" - a block pause must not be
//! clickable away. It only holds portal names, codes and timestamps.

use std::collections::BTreeMap;
use std::ops::RangeInclusive;
use std::path::{Path, PathBuf};
use std::time::Duration;

use jiff::{SignedDuration, Timestamp};
use serde::{Deserialize, Serialize};

use super::robots::Robots;
use crate::export::write_atomic;
use crate::portal::Portal;
use crate::time;

/// The pace of [`Policy::quick`] (the demo), in milliseconds.
pub const QUICK_PACE_MS: RangeInclusive<u64> = 150..=450;

/// Pace and caps of a portal.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Limits {
    /// Gap between two requests in milliseconds (random within the range).
    pub pace_ms: RangeInclusive<u64>,
    /// Requests within any hour (a rolling window).
    pub per_hour: usize,
    /// Requests within a local day, from midnight (what the interface calls "today").
    pub per_day: usize,
}

/// Pace and caps of a portal - from its adapter.
pub fn limits(portal: Portal) -> Limits {
    portal.adapter().limits()
}

/// Session window: dwell time per page (from "fully loaded") like a reader -
/// in addition to the gap, deliberately double restraint.
pub const DWELL_SECS: RangeInclusive<u64> = 8..=20;

/// Only jobs from mails of the last 30 days are fetched automatically (older ones per click).
pub const MAX_AGE: SignedDuration = SignedDuration::from_hours(30 * 24);
/// A failed fetch is retried after 12 hours at the earliest.
pub const RETRY_AFTER: SignedDuration = SignedDuration::from_hours(12);
/// After a network error: retry once, after this wait.
pub const NET_RETRY: Duration = Duration::from_secs(30);
/// After this many failed attempts a job counts as unfetchable (a teaser stops being
/// fetched again).
pub const MAX_FETCH_ATTEMPTS: u32 = 3;

/// Pause after throttling (429, server errors, second timeout).
const THROTTLE_PAUSE: SignedDuration = SignedDuration::from_hours(1);
/// Pause after a block signal (999, 403, redirect to sign-in, captcha).
const BLOCK_PAUSE: SignedDuration = SignedDuration::from_hours(24);
/// Pause after the second block signal within [`REPEAT_WINDOW`] - at the same time the
/// longest pause of all.
const REPEAT_BLOCK_PAUSE: SignedDuration = SignedDuration::from_hours(7 * 24);
const REPEAT_WINDOW: SignedDuration = SignedDuration::from_hours(7 * 24);

const HOUR: SignedDuration = SignedDuration::from_hours(1);
/// A source's robots.txt is read again after a day.
const ROBOTS_FRESH: SignedDuration = SignedDuration::from_hours(24);
const DAY: SignedDuration = SignedDuration::from_hours(24);

/// Pause reasons of earlier versions, which stored only a German text. Only read to
/// derive the code of a pause that is still running - do not translate.
const LEGACY_BREAKER_TEXT: &str = "zwei Seiten ohne Beschreibung in Folge";
const LEGACY_UNREADABLE_TEXT: &str = "Sicherheitsstand war unlesbar";

/// How long a pause lasts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PauseKind {
    Throttled,
    Blocked,
}

/// Why a portal pauses or stopped - a code for the interface.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum PauseReason {
    /// Rate limited: HTTP 429, server errors, no answer twice.
    Throttled,
    /// Block signal: HTTP 999/403, captcha, redirect to a sign-in wall.
    Blocked,
    /// Two pages without a description in a row - the page layout probably changed.
    LayoutChanged,
    /// The stored safety state was unreadable; every portal rests for 24 hours.
    StateUnreadable,
    /// Network trouble (second failure after a retry) - the rest waits for the next run.
    Network,
    /// Signed in, but the portal showed a security check - the portal rests until the next
    /// run (the app never solves a check itself).
    Challenged,
}

impl From<PauseKind> for PauseReason {
    fn from(kind: PauseKind) -> PauseReason {
        match kind {
            PauseKind::Throttled => PauseReason::Throttled,
            PauseKind::Blocked => PauseReason::Blocked,
        }
    }
}

/// State of a portal.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PortalState {
    pub paused_until: Option<Timestamp>,
    pub pause_kind: Option<PauseKind>,
    /// Code of the last pause (missing in files of earlier versions).
    pub pause_code: Option<PauseReason>,
    /// Detail of the last pause for the log (e.g. "HTTP 999"); never shown as a sentence.
    pub pause_reason: Option<String>,
    /// End of the last block pause - a new block signal within seven days after it counts as
    /// a repetition (otherwise the short pause would start again after every 7-day pause).
    pub block_until: Option<Timestamp>,
    /// Pages without a description in a row - across runs (clicking again does not reset
    /// the breaker).
    pub suspicious_streak: u32,
    /// Requests of the local day and the last hour (files of earlier versions: of the last
    /// 24 hours).
    pub accesses: Vec<Timestamp>,
    /// End of the last request - the gap counts from the answer, also across runs.
    pub last_done_at: Option<Timestamp>,
    /// freelance.de: last confirmed session (first job page with a sign-out link).
    pub session_confirmed_at: Option<Timestamp>,
    /// freelance.de: sign-in needed (session expired or never signed in).
    pub login_needed: bool,
    /// The source's robots.txt as last read, and when (read again after a day).
    pub robots: Option<Robots>,
    pub robots_at: Option<Timestamp>,
}

impl PortalState {
    /// Code of the current pause; files of earlier versions only carry a text.
    pub fn pause_code(&self) -> PauseReason {
        if let Some(code) = self.pause_code {
            return code;
        }
        let text = self.pause_reason.as_deref().unwrap_or_default();
        if text.starts_with(LEGACY_BREAKER_TEXT) {
            PauseReason::LayoutChanged
        } else if text == LEGACY_UNREADABLE_TEXT {
            PauseReason::StateUnreadable
        } else {
            self.pause_kind.map_or(PauseReason::Throttled, Into::into)
        }
    }
}

/// May the portal be requested now?
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Allowance {
    Go,
    Paused {
        until: Timestamp,
        reason: PauseReason,
        /// For the log only.
        detail: String,
    },
    /// Cap reached; the next request is possible from `next_at`.
    Quota {
        next_at: Timestamp,
    },
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct Policy {
    #[serde(skip)]
    path: Option<PathBuf>,
    /// The demo's short pace ([`Policy::quick`]).
    #[serde(skip)]
    quick: bool,
    #[serde(default, deserialize_with = "known_portals")]
    portals: BTreeMap<Portal, PortalState>,
}

/// The sources' states of `policy.json`; a source this version does not know (one taken out
/// again) is left out instead of making the whole file unreadable (which pauses every source).
fn known_portals<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<BTreeMap<Portal, PortalState>, D::Error> {
    let all = BTreeMap::<String, PortalState>::deserialize(deserializer)?;
    Ok(all
        .into_iter()
        .filter_map(|(key, state)| Some((Portal::from_key(&key)?, state)))
        .collect())
}

impl Policy {
    /// Reads `policy.json`. If it is missing, an empty state begins. If it is unreadable,
    /// every portal counts as paused for 24 hours to be safe - a damaged file must not lift
    /// a block pause.
    pub fn load(path: &Path, now: Timestamp) -> Policy {
        let mut policy = match std::fs::read(path) {
            Ok(bytes) => match serde_json::from_slice::<Policy>(&bytes) {
                Ok(mut policy) => {
                    policy.clamp_future(now);
                    policy
                }
                Err(e) => {
                    // Keep a copy for inspection and write the pause over the broken file -
                    // otherwise it would start again on every load and never end. If writing
                    // fails, the broken file stays: the next load pauses again (never a
                    // state without a pause).
                    log::warn!("policy.json unreadable ({e}), all portals paused for 24 h");
                    let aside = path.with_extension(format!("json.bad-{}", now.as_second()));
                    if let Err(e) = std::fs::copy(path, &aside) {
                        log::warn!("policy.json not copied aside: {e}");
                    }
                    let mut paused = Policy::all_paused(now);
                    paused.path = Some(path.to_path_buf());
                    if let Err(e) = paused.save() {
                        log::warn!("safety state not saved: {e}");
                    }
                    paused
                }
            },
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Policy::default(),
            Err(e) => {
                // Only unreadable right now (e.g. locked): pause, but never save - otherwise
                // this stand-in would replace the real file with its longer blocks.
                log::warn!("policy.json not readable ({e}), all portals paused for 24 h");
                return Policy::all_paused(now);
            }
        };
        policy.path = Some(path.to_path_buf());
        policy
    }

    /// State in memory only (dry run, tests): `save` writes nothing.
    pub fn in_memory() -> Policy {
        Policy::default()
    }

    /// The demo's: in memory like [`Policy::in_memory`], with a short pace between two
    /// requests ([`QUICK_PACE_MS`]). Its portals are made up and no request leaves the app,
    /// so the real pace would only make the demo slow; never for a real portal.
    pub fn quick() -> Policy {
        Policy {
            quick: true,
            ..Policy::default()
        }
    }

    /// Cap timestamps from a wrong clock: no request and no answer lies after "now", no
    /// pause reaches further than the longest one (seven days). Otherwise a date once set
    /// ahead would lock a portal for good - `policy.json` survives "reset everything" too.
    fn clamp_future(&mut self, now: Timestamp) {
        let latest_pause_end = now
            .saturating_add(REPEAT_BLOCK_PAUSE)
            .unwrap_or(Timestamp::MAX);
        for state in self.portals.values_mut() {
            for at in &mut state.accesses {
                *at = (*at).min(now);
            }
            for at in [&mut state.last_done_at, &mut state.session_confirmed_at] {
                *at = at.map(|t| t.min(now));
            }
            for until in [&mut state.paused_until, &mut state.block_until] {
                *until = until.map(|t| t.min(latest_pause_end));
            }
        }
    }

    fn all_paused(now: Timestamp) -> Policy {
        let mut policy = Policy::default();
        for portal in Portal::ALL {
            let state = policy.portals.entry(portal).or_default();
            state.paused_until = now.checked_add(DAY).ok();
            state.pause_kind = Some(PauseKind::Blocked);
            state.pause_code = Some(PauseReason::StateUnreadable);
            state.pause_reason = Some("safety state was unreadable".into());
        }
        policy
    }

    /// Writes the state atomically (no partial state after a crash).
    pub fn save(&self) -> crate::Result<()> {
        let Some(path) = &self.path else {
            return Ok(());
        };
        let json = serde_json::to_vec_pretty(self).expect("the policy is always serialisable");
        write_atomic(path, &json)
    }

    pub fn state(&self, portal: Portal) -> PortalState {
        self.portals.get(&portal).cloned().unwrap_or_default()
    }

    /// Pause, hourly cap, daily cap - in this order. The hourly cap frees a request as soon
    /// as the oldest of its window is an hour old; the daily cap counts from local midnight
    /// and frees at the next one.
    pub fn allowance(&self, portal: Portal, now: Timestamp) -> Allowance {
        let state = self.portals.get(&portal);
        if let Some(state) = state
            && let Some(until) = state.paused_until.filter(|&until| until > now)
        {
            return Allowance::Paused {
                until,
                reason: state.pause_code(),
                detail: state.pause_reason.clone().unwrap_or_default(),
            };
        }
        let accesses = state.map_or(&[][..], |s| &s.accesses[..]);
        let limits = limits(portal);
        let hourly = quota_free_at(accesses, now, HOUR, limits.per_hour);
        let daily = (today(accesses, now) >= limits.per_day).then(|| time::next_day_start(now));
        match hourly.into_iter().chain(daily).max() {
            Some(next_at) => Allowance::Quota { next_at },
            None => Allowance::Go,
        }
    }

    /// Counts a request and forgets the ones neither cap counts any more: before the local
    /// day and older than an hour.
    pub fn record_access(&mut self, portal: Portal, now: Timestamp) {
        let state = self.portals.entry(portal).or_default();
        let horizon = time::day_start(now).min(now.saturating_sub(HOUR).unwrap_or(Timestamp::MIN));
        state.accesses.retain(|&at| at >= horizon);
        state.accesses.push(now);
    }

    /// Pauses a portal and returns the end of the pause (reason derived from the kind).
    pub fn pause(
        &mut self,
        portal: Portal,
        kind: PauseKind,
        detail: &str,
        now: Timestamp,
    ) -> Timestamp {
        self.pause_for(portal, kind, kind.into(), detail, now)
    }

    /// Like [`Policy::pause`], but at least `at_least` long - the portal's own
    /// `Retry-After` (capped at the longest pause of all, seven days).
    pub fn pause_at_least(
        &mut self,
        portal: Portal,
        kind: PauseKind,
        detail: &str,
        now: Timestamp,
        at_least: Option<Duration>,
    ) -> Timestamp {
        let at_least = at_least
            .and_then(|d| SignedDuration::try_from(d).ok())
            .map(|d| d.min(REPEAT_BLOCK_PAUSE));
        self.pause_with(portal, kind, kind.into(), detail, now, at_least)
    }

    /// Pauses a portal with an explicit reason and returns the end of the pause. A second
    /// block signal within seven days extends to seven days; a running longer pause is
    /// never shortened.
    pub fn pause_for(
        &mut self,
        portal: Portal,
        kind: PauseKind,
        reason: PauseReason,
        detail: &str,
        now: Timestamp,
    ) -> Timestamp {
        self.pause_with(portal, kind, reason, detail, now, None)
    }

    fn pause_with(
        &mut self,
        portal: Portal,
        kind: PauseKind,
        reason: PauseReason,
        detail: &str,
        now: Timestamp,
        at_least: Option<SignedDuration>,
    ) -> Timestamp {
        let state = self.portals.entry(portal).or_default();
        let length = match kind {
            PauseKind::Throttled => THROTTLE_PAUSE,
            PauseKind::Blocked => {
                // Counted from the end of the last block (it always began before).
                let repeat = state
                    .block_until
                    .is_some_and(|end| now.duration_since(end) <= REPEAT_WINDOW);
                if repeat {
                    REPEAT_BLOCK_PAUSE
                } else {
                    BLOCK_PAUSE
                }
            }
        };
        let length = at_least.map_or(length, |min| length.max(min));
        let until = now.saturating_add(length).unwrap_or(Timestamp::MAX);
        if kind == PauseKind::Blocked {
            state.block_until = Some(until);
        }
        if state.paused_until.is_none_or(|current| current < until) {
            state.paused_until = Some(until);
            state.pause_kind = Some(kind);
            state.pause_code = Some(reason);
            state.pause_reason = Some(detail.to_string());
        }
        state.paused_until.unwrap_or(until)
    }

    /// Counts a page without a description and returns the number in a row.
    pub fn count_suspicious(&mut self, portal: Portal) -> u32 {
        let state = self.portals.entry(portal).or_default();
        state.suspicious_streak = state.suspicious_streak.saturating_add(1);
        state.suspicious_streak
    }

    /// A complete text resets the breaker.
    pub fn clear_suspicious(&mut self, portal: Portal) {
        if let Some(state) = self.portals.get_mut(&portal) {
            state.suspicious_streak = 0;
        }
    }

    /// The sign-in is gone (reset): sign-in needed, no confirmed session.
    pub fn forget_session(&mut self, portal: Portal) {
        let state = self.portals.entry(portal).or_default();
        state.login_needed = true;
        state.session_confirmed_at = None;
    }

    /// Requests in the last hour and today (since local midnight): what the caps count.
    pub fn usage(&self, portal: Portal, now: Timestamp) -> (usize, usize) {
        let accesses = self
            .portals
            .get(&portal)
            .map_or(&[][..], |s| &s.accesses[..]);
        let start = now.saturating_sub(HOUR).unwrap_or(Timestamp::MIN);
        let hour = accesses.iter().filter(|&&at| at > start).count();
        (hour, today(accesses, now))
    }

    /// Last request or last answer of a portal - the gap counts from the later one (also
    /// across runs).
    fn last_access(&self, portal: Portal) -> Option<Timestamp> {
        let state = self.portals.get(&portal)?;
        state.accesses.iter().max().copied().max(state.last_done_at)
    }

    /// How long to wait before the next request: a random gap from the last request or the
    /// last answer (slow answers would otherwise shrink it to zero), at most one gap long -
    /// even if the clock was set back.
    pub fn pace_wait(&self, portal: Portal, now: Timestamp) -> Option<Duration> {
        let last = self.last_access(portal)?;
        let range = if self.quick {
            QUICK_PACE_MS
        } else {
            limits(portal).pace_ms
        };
        // A Crawl-delay of the source's robots.txt is the least gap (not in quick mode).
        let delay = (!self.quick)
            .then(|| self.portals.get(&portal))
            .flatten()
            .and_then(|state| state.robots.as_ref())
            .and_then(|robots| robots.crawl_delay)
            .map_or(0, |seconds| seconds.saturating_mul(1000));
        let pace = SignedDuration::from_millis(
            i64::try_from(fastrand::u64(range).max(delay)).unwrap_or(i64::MAX),
        );
        let wait = last
            .saturating_add(pace)
            .unwrap_or(Timestamp::MAX)
            .duration_since(now)
            .min(pace);
        wait.is_positive().then(|| wait.unsigned_abs())
    }

    /// A request is finished (answer evaluated).
    pub fn record_done(&mut self, portal: Portal, now: Timestamp) {
        self.portals.entry(portal).or_default().last_done_at = Some(now);
    }

    /// Session confirmed (job page with a sign-out link) or sign-in needed.
    /// The robots.txt of `portal` read within the last day, if any.
    pub fn robots(&self, portal: Portal, now: Timestamp) -> Option<Robots> {
        let state = self.portals.get(&portal)?;
        let fresh = state
            .robots_at
            .is_some_and(|at| at <= now && now.duration_since(at) < ROBOTS_FRESH);
        fresh.then(|| state.robots.clone()).flatten()
    }

    /// The robots.txt of `portal` just read (none: it has none, everything allowed).
    pub fn set_robots(&mut self, portal: Portal, robots: Robots, now: Timestamp) {
        let state = self.portals.entry(portal).or_default();
        state.robots = Some(robots);
        state.robots_at = Some(now);
    }

    pub fn set_session(&mut self, portal: Portal, confirmed: bool, now: Timestamp) {
        let state = self.portals.entry(portal).or_default();
        state.login_needed = !confirmed;
        if confirmed {
            state.session_confirmed_at = Some(now);
        }
    }
}

/// The requests of the local day of `now` (since its midnight).
fn today(accesses: &[Timestamp], now: Timestamp) -> usize {
    let start = time::day_start(now);
    accesses.iter().filter(|&&at| at >= start).count()
}

/// If the cap `cap` is reached within the window, the time from which a request is free
/// again; otherwise `None`.
fn quota_free_at(
    accesses: &[Timestamp],
    now: Timestamp,
    window: SignedDuration,
    cap: usize,
) -> Option<Timestamp> {
    let start = now.saturating_sub(window).unwrap_or(Timestamp::MIN);
    let mut recent: Vec<Timestamp> = accesses.iter().copied().filter(|&at| at > start).collect();
    if recent.len() < cap {
        return None;
    }
    recent.sort_unstable();
    // The slot frees up as soon as the oldest of the last `cap` requests leaves the window.
    let oldest_counting = recent[recent.len() - cap];
    oldest_counting.checked_add(window).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(minutes: i64) -> Timestamp {
        Timestamp::from_second(1_790_000_000 + minutes * 60).unwrap()
    }

    /// A file that is only locked for a moment must never be replaced by the stand-in when
    /// saving - with its longer blocks and request counters.
    #[test]
    fn a_locked_file_is_never_overwritten_by_the_stand_in() {
        let dir = tempfile::tempdir().unwrap();
        let missing_dir = dir.path().join("policy.json");
        // A directory instead of a file: reading fails (not "missing").
        std::fs::create_dir(&missing_dir).unwrap();
        let mut policy = Policy::load(&missing_dir, at(0));
        assert!(matches!(
            policy.allowance(Portal::LinkedIn, at(0)),
            Allowance::Paused { .. }
        ));
        policy.record_access(Portal::LinkedIn, at(1));
        policy.save().unwrap();
        assert!(missing_dir.is_dir(), "the stand-in is never saved");
    }

    /// A source this version no longer knows (one taken out again) is left out: the file
    /// stays readable and nothing pauses.
    #[test]
    fn a_source_taken_out_leaves_the_file_readable() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let mut policy = Policy::load(&path, at(0));
        policy.record_access(Portal::LinkedIn, at(1));
        policy.save().unwrap();
        let mut json: serde_json::Value =
            serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        json["portals"]["etengo"] = json["portals"]["linkedin"].clone();
        std::fs::write(&path, serde_json::to_vec(&json).unwrap()).unwrap();
        let again = Policy::load(&path, at(2));
        assert!(!matches!(
            again.allowance(Portal::Hays, at(2)),
            Allowance::Paused { .. }
        ));
        assert_eq!(again.portals.len(), 1, "only the known source");
    }

    #[test]
    fn an_unreadable_file_is_set_aside_and_the_pause_is_anchored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        std::fs::write(&path, b"{ kaputt").unwrap();
        let policy = Policy::load(&path, at(0));
        assert!(matches!(
            policy.allowance(Portal::LinkedIn, at(0)),
            Allowance::Paused { .. }
        ));
        // The pause does not start again on every load.
        let later = Policy::load(&path, at(600));
        assert_eq!(
            later.state(Portal::LinkedIn).paused_until,
            policy.state(Portal::LinkedIn).paused_until
        );
        let aside = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(Result::ok)
            .any(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("policy.json.bad-")
            });
        assert!(aside, "the broken file is kept for inspection");
    }

    /// A moment in local time (Europe/Berlin in every test).
    fn local(text: &str) -> Timestamp {
        text.parse::<jiff::civil::DateTime>()
            .unwrap()
            .to_zoned(time::zone().clone())
            .unwrap()
            .timestamp()
    }

    /// The alert sources: 100 requests a day, their own hourly caps and paces. The sources the
    /// app searches itself: the deep search's (user decision 2026-10-01).
    #[test]
    fn the_caps_of_the_alert_sources_and_of_the_search() {
        for portal in [Portal::LinkedIn, Portal::FreelanceDe] {
            assert_eq!(limits(portal).per_day, 100, "{portal:?}");
        }
        assert_eq!(limits(Portal::LinkedIn).per_hour, 30);
        assert_eq!(limits(Portal::FreelanceDe).per_hour, 20);
        for portal in Portal::ALL
            .into_iter()
            .filter(|p| p.way() == crate::portal::Way::Search)
        {
            let caps = limits(portal);
            assert_eq!((caps.per_hour, caps.per_day), (300, 1_500), "{portal:?}");
            assert!(*caps.pace_ms.start() >= 2_500, "{portal:?}");
        }
    }

    #[test]
    fn the_hourly_cap_rolls() {
        let mut p = Policy::in_memory();
        for i in 0..30 {
            assert_eq!(p.allowance(Portal::LinkedIn, at(i)), Allowance::Go);
            p.record_access(Portal::LinkedIn, at(i));
        }
        // 31st request in the same hour: free as soon as the first leaves the window.
        assert_eq!(
            p.allowance(Portal::LinkedIn, at(30)),
            Allowance::Quota { next_at: at(60) }
        );
        assert_eq!(p.allowance(Portal::LinkedIn, at(61)), Allowance::Go);
        // Other portals are independent.
        assert_eq!(p.allowance(Portal::Freelancermap, at(30)), Allowance::Go);
    }

    /// The daily cap counts from local midnight: the requests of the morning hold it until
    /// the day ends, not 24 hours on, and "today" starts empty at midnight.
    #[test]
    fn the_daily_cap_counts_from_local_midnight() {
        let mut p = Policy::in_memory();
        let morning = local("2026-09-21T06:00");
        // 100 requests, 20 an hour (below the hourly cap): 06:00 to 10:57.
        for i in 0..100 {
            p.record_access(
                Portal::LinkedIn,
                morning
                    .saturating_add(SignedDuration::from_mins(i * 3))
                    .unwrap(),
            );
        }
        let evening = local("2026-09-21T22:00");
        assert_eq!(p.usage(Portal::LinkedIn, evening), (0, 100));
        let midnight = local("2026-09-22T00:00");
        assert_eq!(
            p.allowance(Portal::LinkedIn, evening),
            Allowance::Quota { next_at: midnight }
        );
        assert_eq!(
            p.allowance(Portal::LinkedIn, local("2026-09-21T23:59")),
            Allowance::Quota { next_at: midnight }
        );
        assert_eq!(p.allowance(Portal::LinkedIn, midnight), Allowance::Go);
        assert_eq!(
            p.usage(Portal::LinkedIn, midnight),
            (0, 0),
            "today starts at 0"
        );
        // A request just before midnight counts in the hour after it, not for the new day.
        p.record_access(Portal::LinkedIn, local("2026-09-21T23:50"));
        assert_eq!(p.usage(Portal::LinkedIn, local("2026-09-22T00:10")), (1, 0));
        // The first request of the new day forgets the old day's.
        p.record_access(Portal::LinkedIn, local("2026-09-22T00:20"));
        assert_eq!(p.state(Portal::LinkedIn).accesses.len(), 2);
    }

    /// The long day of the change to winter time (25 hours) counts whole: a request just after
    /// midnight still counts late in the evening, more than 24 hours on.
    #[test]
    fn the_long_day_counts_whole() {
        let mut p = Policy::in_memory();
        p.record_access(Portal::Freelancermap, local("2026-10-25T00:10"));
        let late = local("2026-10-25T23:50");
        p.record_access(Portal::Freelancermap, late);
        assert_eq!(p.usage(Portal::Freelancermap, late), (1, 2));
    }

    #[test]
    fn pauses_escalate_and_never_shrink() {
        let mut p = Policy::in_memory();
        let until = p.pause(Portal::LinkedIn, PauseKind::Blocked, "HTTP 999", at(0));
        assert_eq!(until, at(24 * 60));
        assert!(matches!(
            p.allowance(Portal::LinkedIn, at(60)),
            Allowance::Paused { .. }
        ));
        // Second block signal within 7 days: 7 days.
        let until = p.pause(
            Portal::LinkedIn,
            PauseKind::Blocked,
            "HTTP 999",
            at(2 * 24 * 60),
        );
        assert_eq!(until, at(9 * 24 * 60));
        // A throttle does not shorten the running block.
        let until = p.pause(
            Portal::LinkedIn,
            PauseKind::Throttled,
            "HTTP 429",
            at(3 * 24 * 60),
        );
        assert_eq!(until, at(9 * 24 * 60));
        assert_eq!(
            p.state(Portal::LinkedIn).pause_kind,
            Some(PauseKind::Blocked)
        );
        // Free again afterwards.
        assert_eq!(
            p.allowance(Portal::LinkedIn, at(9 * 24 * 60 + 1)),
            Allowance::Go
        );
    }

    #[test]
    fn state_survives_a_restart_and_a_broken_file_pauses_all() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let mut p = Policy::load(&path, at(0));
        p.record_access(Portal::Freelancermap, at(0));
        p.pause(Portal::LinkedIn, PauseKind::Throttled, "HTTP 429", at(0));
        p.set_session(Portal::FreelanceDe, false, at(0));
        p.save().unwrap();
        let q = Policy::load(&path, at(1));
        assert_eq!(q.state(Portal::Freelancermap).accesses, [at(0)]);
        assert_eq!(q.state(Portal::LinkedIn).paused_until, Some(at(60)));
        assert!(q.state(Portal::FreelanceDe).login_needed);
        // Only portal names, codes and timestamps in the file.
        let json = std::fs::read_to_string(&path).unwrap();
        assert!(json.contains("\"linkedin\"") && !json.contains('@'));

        std::fs::write(&path, b"{kaputt").unwrap();
        let broken = Policy::load(&path, at(0));
        for portal in Portal::ALL {
            assert!(matches!(
                broken.allowance(portal, at(1)),
                Allowance::Paused { .. }
            ));
        }
    }

    /// A clock that was ahead left requests and pauses far in the future: after loading they
    /// block at most as long as the longest pause.
    #[test]
    fn a_clock_that_was_ahead_locks_no_portal_for_good() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("policy.json");
        let future = at(60 * 24 * 365 * 70);
        let mut p = Policy::load(&path, future);
        for _ in 0..40 {
            p.record_access(Portal::LinkedIn, future);
        }
        p.record_done(Portal::LinkedIn, future);
        p.pause(Portal::LinkedIn, PauseKind::Blocked, "HTTP 999", future);
        p.pause(Portal::LinkedIn, PauseKind::Blocked, "HTTP 999", future);
        p.save().unwrap();

        let now = at(0);
        let q = Policy::load(&path, now);
        let state = q.state(Portal::LinkedIn);
        assert!(state.accesses.iter().all(|&a| a <= now));
        assert!(state.last_done_at.is_some_and(|d| d <= now));
        let week = now.saturating_add(REPEAT_BLOCK_PAUSE).unwrap();
        assert!(state.paused_until.is_some_and(|u| u <= week));
        assert!(state.block_until.is_some_and(|u| u <= week));
        // After a week the portal is free again - pause and counters have expired.
        assert_eq!(
            q.allowance(Portal::LinkedIn, at(7 * 24 * 60 + 1)),
            Allowance::Go
        );
        // The gap applies at most once.
        assert!(
            q.pace_wait(Portal::LinkedIn, now)
                .is_some_and(|w| w <= Duration::from_secs(7))
        );
    }

    /// Pause codes: explicit ones are kept, files of earlier versions only carried a German
    /// text - their running pauses still get the right code.
    #[test]
    fn pause_codes_survive_and_legacy_texts_map() {
        let mut p = Policy::in_memory();
        p.pause_for(
            Portal::LinkedIn,
            PauseKind::Throttled,
            PauseReason::LayoutChanged,
            "two pages without description",
            at(0),
        );
        assert!(matches!(
            p.allowance(Portal::LinkedIn, at(1)),
            Allowance::Paused {
                reason: PauseReason::LayoutChanged,
                ..
            }
        ));
        p.pause(Portal::Freelancermap, PauseKind::Blocked, "HTTP 403", at(0));
        assert_eq!(
            p.state(Portal::Freelancermap).pause_code(),
            PauseReason::Blocked
        );
        let legacy = |text: &str, kind| PortalState {
            pause_kind: Some(kind),
            pause_reason: Some(text.into()),
            ..PortalState::default()
        };
        assert_eq!(
            legacy(
                "zwei Seiten ohne Beschreibung in Folge – Seitenaufbau geändert?",
                PauseKind::Throttled
            )
            .pause_code(),
            PauseReason::LayoutChanged
        );
        assert_eq!(
            legacy("Sicherheitsstand war unlesbar", PauseKind::Blocked).pause_code(),
            PauseReason::StateUnreadable
        );
        assert_eq!(
            legacy("HTTP 429", PauseKind::Throttled).pause_code(),
            PauseReason::Throttled
        );
    }

    #[test]
    fn old_accesses_are_forgotten() {
        let mut p = Policy::in_memory();
        p.record_access(Portal::LinkedIn, at(0));
        p.record_access(Portal::LinkedIn, at(25 * 60));
        assert_eq!(p.state(Portal::LinkedIn).accesses, [at(25 * 60)]);
    }

    /// The demo's policy waits only a short pace between two requests, far below any real
    /// portal's; a real policy keeps each portal's own.
    #[test]
    fn the_quick_policy_of_the_demo_keeps_a_short_pace() {
        let now = at(0);
        let mut quick = Policy::quick();
        let mut real = Policy::in_memory();
        for p in [&mut quick, &mut real] {
            p.record_access(Portal::FreelanceDe, now);
        }
        let short = quick.pace_wait(Portal::FreelanceDe, now).unwrap();
        assert!(short <= Duration::from_millis(*QUICK_PACE_MS.end()));
        let long = real.pace_wait(Portal::FreelanceDe, now).unwrap();
        assert!(long >= Duration::from_millis(*limits(Portal::FreelanceDe).pace_ms.start()));
    }
}
