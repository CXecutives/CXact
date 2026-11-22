//! The settings and the portals as the interface shows them: the mailbox, the work folder, the
//! switches, and every portal's sign-in, pause and quota state.

use std::path::PathBuf;

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::{MailProvider, WorkspaceProfile};
use crate::error::ErrorInfo;
use crate::fetch::PortalHealth;
use crate::fetch::policy::{Policy, limits};
use crate::portal::{Portal, Way};
use crate::settings::{PortalSwitches, Settings};
use crate::store::{AlertMailRow, PortalAlerts};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Platform {
    Windows,
    Macos,
}

/// Where the mailbox's password is kept.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum VaultKind {
    WindowsCredentialManager,
    MacosKeychain,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Mailbox {
    /// The stored address; `null` = no mailbox connected.
    pub user: Option<String>,
    /// The provider of the stored mailbox (`Settings::mail_provider`); without one the one
    /// last chosen, Gmail before any.
    pub provider: MailProvider,
    pub vault: VaultKind,
    /// The vault could not be read.
    pub error: Option<ErrorInfo>,
    /// What "Verbinden" found in the mailbox in this session (the sign-in worked). `null`
    /// before a "Verbinden", and when it signed in but could not count (too slow, or the
    /// server failed on a mail): the answer to `save_mailbox` is then signed in and not
    /// counted, and the next fetch reads the alert mails anyway.
    pub check: Option<MailboxCheck>,
    /// When the server last accepted this mailbox ("Verbinden", "Speichern"): a mail error of
    /// a fetch that finished before it is past.
    pub checked_at: Option<Timestamp>,
}

/// "Postfach prüfen": the sign-in worked, and this many alert mails of the enabled portals
/// lie in the mailbox from the last `days` days (`mail::check::check_mailbox`; its errors
/// are `invalid` for the shape of the input and the mail error codes of the sign-in).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MailboxCheck {
    pub days: u32,
    pub total: u32,
    /// Every portal asked for, in the order of `Portal::ALL`.
    pub per_portal: Vec<PortalCount>,
}

/// A number of a portal.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalCount {
    pub portal: Portal,
    pub count: u32,
}

/// The work folder as Einstellungen shows it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SettingsView {
    /// The work folder in use (chosen or default); its `profil/` holds the profile.
    pub workspace: PathBuf,
    pub workspace_is_default: bool,
}

/// Another work folder (`pick_workspace`): the folder, and what became of the profile there.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct WorkspacePick {
    pub folder: PathBuf,
    pub profile: WorkspaceProfile,
}

/// Changes of the settings: the portal switches (`null` = unchanged); the work folder only
/// changes through the folder dialog (`pick_workspace`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct SettingsPatch {
    pub portals: Vec<PortalPatch>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalPatch {
    pub portal: Portal,
    pub enabled: Option<bool>,
    pub login_enabled: Option<bool>,
}

impl SettingsPatch {
    pub fn apply(&self, settings: &mut Settings) {
        for patch in &self.portals {
            let switches: &mut PortalSwitches = settings.portals.entry(patch.portal).or_default();
            if let Some(on) = patch.enabled {
                switches.enabled = on;
            }
            if let Some(on) = patch.login_enabled {
                switches.login_enabled = on;
            }
        }
    }
}

/// Whether a portal offers a sign-in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum PortalLogin {
    None,
    Optional,
}

impl PortalLogin {
    /// The sign-in a portal offers (its access).
    pub fn of(portal: Portal) -> PortalLogin {
        if portal.access().can_sign_in() {
            PortalLogin::Optional
        } else {
            PortalLogin::None
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Quota {
    /// Requests in the last hour and the hourly cap.
    pub used_hour: usize,
    pub cap_hour: usize,
    /// Requests today (since local midnight) and the daily cap.
    pub used_day: usize,
    pub cap_day: usize,
}

/// A portal in the settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct PortalState {
    pub portal: Portal,
    /// How the app gets its jobs: its own search, or alert mails (the cards of Einstellungen).
    pub way: Way,
    /// Its alert mails are read and its ads fetched.
    pub enabled: bool,
    pub login: PortalLogin,
    pub login_enabled: bool,
    /// `null` = unknown (or no sign-in), `false` = sign-in needed.
    pub signed_in: Option<bool>,
    pub health: PortalHealth,
    /// The user has to act on the health ([`PortalHealth::action_needed`]).
    pub action_needed: bool,
    pub quota: Option<Quota>,
    /// The date of its last alert mail the app read (`null`: none yet); the settings warn
    /// when it is long ago.
    pub last_alert: Option<Timestamp>,
    /// How many of its alert mails the app read in the last [`ALERT_MAIL_DAYS`] days (`null`:
    /// unknown, the mailbox was never read).
    pub alert_mails: Option<u32>,
}

/// The days of [`PortalState::alert_mails`].
pub const ALERT_MAIL_DAYS: i64 = 30;

/// The state of every portal. `empty_mails`: alert mails without recognised jobs of the
/// last mailbox run; `alerts`: each portal's alert mails of the last [`ALERT_MAIL_DAYS`] days
/// and its last one (`Store::portal_alerts`), `None` while the mailbox was never read.
pub fn portal_states(
    policy: &Policy,
    settings: &Settings,
    empty_mails: &[AlertMailRow],
    alerts: Option<&[PortalAlerts]>,
    now: Timestamp,
) -> Vec<PortalState> {
    Portal::ALL
        .into_iter()
        .map(|portal| {
            let state = policy.state(portal);
            let switches = settings.portal(portal);
            let limits = limits(portal);
            let (used_hour, used_day) = policy.usage(portal, now);
            let login = PortalLogin::of(portal);
            // Nothing remembered means "unknown": only a sign-in or a page that asks for one
            // turns it into a statement.
            let signed_in = match (login, state.login_needed, state.session_confirmed_at) {
                (PortalLogin::Optional, true, _) => Some(false),
                (PortalLogin::Optional, false, Some(_)) => Some(true),
                _ => None,
            };
            let empty = empty_mails.iter().filter(|m| m.portal == portal).count();
            let health = PortalHealth::of(policy, portal, now, switches.login_enabled, empty);
            PortalState {
                portal,
                way: portal.way(),
                enabled: switches.enabled,
                login,
                login_enabled: switches.login_enabled,
                signed_in,
                action_needed: health.action_needed(),
                health,
                quota: Some(Quota {
                    used_hour,
                    cap_hour: limits.per_hour,
                    used_day,
                    cap_day: limits.per_day,
                }),
                last_alert: alerts
                    .and_then(|all| all.iter().find(|a| a.portal == portal))
                    .and_then(|a| a.last),
                alert_mails: alerts.map(|all| {
                    all.iter()
                        .find(|a| a.portal == portal)
                        .map_or(0, |a| a.since)
                }),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fetch::policy::PauseKind;

    #[test]
    fn portal_state_shows_pause_quota_and_layout() {
        let now = Timestamp::now();
        let mut policy = Policy::in_memory();
        policy.pause(Portal::LinkedIn, PauseKind::Blocked, "HTTP 999", now);
        let hourly = crate::fetch::policy::limits(Portal::Freelancermap).per_hour;
        for _ in 0..hourly {
            policy.record_access(Portal::Freelancermap, now);
        }
        let mut settings = Settings::default();
        settings
            .portals
            .get_mut(&Portal::FreelanceDe)
            .unwrap()
            .login_enabled = true;
        let empty = [AlertMailRow {
            portal: Portal::FreelanceDe,
            subject: "Projektvorschläge".into(),
            mail_date: None,
            gmail_id: None,
        }];
        let states = portal_states(&policy, &settings, &empty, None, now);
        let of = |portal| states.iter().find(|s| s.portal == portal).unwrap();
        let li = of(Portal::LinkedIn);
        assert!(matches!(
            li.health,
            PortalHealth::Paused {
                reason: crate::fetch::policy::PauseReason::Blocked,
                ..
            }
        ));
        assert_eq!((li.login, li.signed_in), (PortalLogin::None, None));
        let fm = of(Portal::Freelancermap);
        assert!(matches!(fm.health, PortalHealth::QuotaReached { .. }));
        assert_eq!(fm.quota.unwrap().used_hour, hourly);
        let fl = of(Portal::FreelanceDe);
        assert_eq!(fl.login, PortalLogin::Optional);
        assert_eq!(
            fl.health,
            PortalHealth::LayoutSuspect {
                empty_mails: 1,
                pages: 0
            }
        );
        // Whether to act comes with the health: alert mails without jobs ask her to look,
        // a pause and a cap resolve themselves.
        assert_eq!(
            (li.action_needed, fm.action_needed, fl.action_needed),
            (false, false, true)
        );
        assert!(PortalHealth::LoginRequired.action_needed());
        assert!(
            !PortalHealth::LayoutSuspect {
                empty_mails: 0,
                pages: 5
            }
            .action_needed()
        );
    }

    /// Each portal carries the date of its last alert mail and how many came in the last 30
    /// days; one that never sent one has none, and before the mailbox was read both are
    /// unknown.
    #[test]
    fn each_portal_carries_its_alert_mails() {
        let now = Timestamp::now();
        let day = now - jiff::SignedDuration::from_hours(24 * 9);
        let alerts = [
            PortalAlerts {
                portal: Portal::LinkedIn,
                last: Some(day),
                since: 4,
            },
            PortalAlerts {
                portal: Portal::FreelanceDe,
                last: None,
                since: 0,
            },
        ];
        let states = portal_states(
            &Policy::in_memory(),
            &Settings::default(),
            &[],
            Some(&alerts),
            now,
        );
        let of = |portal| {
            let state = states.iter().find(|s| s.portal == portal).unwrap();
            (state.last_alert, state.alert_mails)
        };
        assert_eq!(of(Portal::LinkedIn), (Some(day), Some(4)));
        assert_eq!(of(Portal::FreelanceDe), (None, Some(0)));
        assert_eq!(of(Portal::Freelancermap), (None, Some(0)));
        let unread = portal_states(&Policy::in_memory(), &Settings::default(), &[], None, now);
        assert!(unread.iter().all(|s| s.alert_mails.is_none()));
    }

    /// The sign-in state has three values: nothing remembered = unknown.
    #[test]
    fn the_sign_in_state_is_unknown_until_something_happened() {
        let now = Timestamp::now();
        let settings = Settings::default();
        let mut policy = Policy::in_memory();
        let state = |policy: &Policy| {
            portal_states(policy, &settings, &[], None, now)
                .into_iter()
                .find(|s| s.portal == Portal::FreelanceDe)
                .unwrap()
        };
        assert_eq!(state(&policy).signed_in, None);
        policy.set_session(Portal::FreelanceDe, true, now);
        assert_eq!(state(&policy).signed_in, Some(true));
        policy.set_session(Portal::FreelanceDe, false, now);
        assert_eq!(state(&policy).signed_in, Some(false));
        // Sign-in switched off: the portal goes as a guest, nothing is wrong.
        assert_eq!(state(&policy).health, PortalHealth::Ok);
        let mut settings = settings.clone();
        settings
            .portals
            .get_mut(&Portal::FreelanceDe)
            .unwrap()
            .login_enabled = true;
        let health = portal_states(&policy, &settings, &[], None, now)
            .into_iter()
            .find(|s| s.portal == Portal::FreelanceDe)
            .unwrap()
            .health;
        assert_eq!(health, PortalHealth::LoginRequired);
    }
}
