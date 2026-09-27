//! Time: UTC timestamps inside; local time for display, file names and export. Local is the
//! time zone of the OS, like the interface's dates: the app sets it once at its start
//! ([`follow_system_zone`]). Until then, and so in every test, it is Europe/Berlin: the
//! golden files and digests stay the same on any machine.

use std::sync::{LazyLock, OnceLock};
use std::time::Duration;

use jiff::Timestamp;
use jiff::civil::{Date, DateTime};
use jiff::tz::TimeZone;
use tokio_util::sync::CancellationToken;

/// The zone the app set at its start ([`set_zone`]).
static ZONE: OnceLock<TimeZone> = OnceLock::new();
/// The zone until then.
static BERLIN: LazyLock<TimeZone> =
    LazyLock::new(|| TimeZone::get("Europe/Berlin").unwrap_or_else(|_| TimeZone::system()));

/// Time zone of everything the user sees: the OS's once the app set it, else Europe/Berlin.
pub fn zone() -> &'static TimeZone {
    ZONE.get().unwrap_or(&BERLIN)
}

/// Sets the zone of everything the user sees, once per process; `false` if it was set before.
pub fn set_zone(zone: TimeZone) -> bool {
    ZONE.set(zone).is_ok()
}

/// At the start of the app: local time is the OS's, like the interface's. A zone the OS does
/// not name keeps Europe/Berlin.
pub fn follow_system_zone() {
    match TimeZone::try_system() {
        Ok(system) => {
            let name = system.iana_name().unwrap_or("unnamed").to_owned();
            if set_zone(system) {
                log::info!("time zone {name}");
            }
        }
        Err(e) => log::warn!("time zone of the system unknown, Europe/Berlin kept: {e}"),
    }
}

/// Local time of a timestamp.
pub fn local(ts: Timestamp) -> DateTime {
    zone().to_datetime(ts)
}

/// Calendar day (local) of a timestamp.
pub fn local_date(ts: Timestamp) -> Date {
    local(ts).date()
}

/// Start of the local day of a timestamp: its midnight (or the first moment of the day where
/// a change of time skips midnight). What a day counts, such as a portal's daily cap,
/// counts from here - "today" in the interface.
pub fn day_start(ts: Timestamp) -> Timestamp {
    ts.to_zoned(zone().clone()).start_of_day().map_or_else(
        |_| ts.saturating_sub(DAY).unwrap_or(ts),
        |day| day.timestamp(),
    )
}

/// Start of the next local day after a timestamp.
pub fn next_day_start(ts: Timestamp) -> Timestamp {
    ts.to_zoned(zone().clone())
        .tomorrow()
        .and_then(|tomorrow| tomorrow.start_of_day())
        .map_or_else(
            |_| ts.saturating_add(DAY).unwrap_or(ts),
            |day| day.timestamp(),
        )
}

/// A day of 24 hours, where a local day cannot be computed (the ends of time).
const DAY: jiff::SignedDuration = jiff::SignedDuration::from_hours(24);

/// "19.09.2026 14:05".
pub fn display(ts: Timestamp) -> String {
    local(ts).strftime("%d.%m.%Y %H:%M").to_string()
}

/// Seconds for the database.
pub fn to_db(ts: Timestamp) -> i64 {
    ts.as_second()
}

pub fn from_db(seconds: i64) -> Option<Timestamp> {
    Timestamp::from_second(seconds).ok()
}

/// Waits `wait`; `false` if `cancel` came first - the one cancellable sleep of the app.
pub async fn sleep_cancellable(wait: Duration, cancel: &CancellationToken) -> bool {
    tokio::select! {
        biased;
        () = cancel.cancelled() => false,
        () = tokio::time::sleep(wait) => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn berlin_summer_and_winter_time() {
        let summer: Timestamp = "2026-09-19T12:05:00Z".parse().unwrap();
        assert_eq!(display(summer), "19.09.2026 14:05");
        let winter: Timestamp = "2026-01-10T23:30:00Z".parse().unwrap();
        assert_eq!(display(winter), "11.01.2026 00:30");
        assert_eq!(local_date(winter), Date::new(2026, 1, 11).unwrap());
        assert_eq!(from_db(to_db(summer)), Some(summer));
    }

    /// A local day runs from midnight to midnight, the long day of the change to winter time
    /// too (25 hours).
    #[test]
    fn local_days_start_at_midnight() {
        let at = |text: &str| text.parse::<Timestamp>().unwrap();
        let evening = at("2026-09-19T21:30:00Z");
        assert_eq!(day_start(evening), at("2026-09-18T22:00:00Z"));
        assert_eq!(next_day_start(evening), at("2026-09-19T22:00:00Z"));
        let late = at("2026-09-19T22:30:00Z");
        assert_eq!(day_start(late), at("2026-09-19T22:00:00Z"));
        let long_day = at("2026-10-25T12:00:00Z");
        assert_eq!(day_start(long_day), at("2026-10-24T22:00:00Z"));
        assert_eq!(next_day_start(long_day), at("2026-10-25T23:00:00Z"));
    }
}
