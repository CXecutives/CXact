//! Settings of the app - stored as JSON in the key/value table of the database.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::portal::{FetchPath, Portal};
use crate::store::Store;

/// Key of the settings in the database (a restore of a backup keeps them, `store/backup.rs`).
pub(crate) const KEY: &str = "settings";

/// `#[serde(default)]` per field: a missing field takes its default, and an unknown one is
/// skipped silently (serde only refuses unknown fields with `deny_unknown_fields`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Workspace (the Arbeitsordner, the profiles'); `None` = default ([`default_workspace`]:
    /// `Documents\CXact`). Only changeable through the folder dialog - never a path sent by
    /// the frontend.
    pub workspace: Option<PathBuf>,
    /// Switches per portal.
    pub portals: BTreeMap<Portal, PortalSwitches>,
    /// The fetch reads the alert mails (the menu beside the button, user decision
    /// 2026-10-01): with `fetch_search` off, see [`Settings::fetches_mail`].
    pub fetch_mail: bool,
    /// The fetch searches the sources the app searches itself (the same menu).
    pub fetch_search: bool,
}

/// The switches of one portal. Safe defaults: active, never signed in. An enabled portal's
/// alert mails are read and its ads fetched; off = no mail read and zero requests to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct PortalSwitches {
    /// Alert mails of the portal are read and its ads fetched.
    pub enabled: bool,
    /// The app may sign in (only portals with a sign-in, i.e. freelance.de).
    pub login_enabled: bool,
}

impl Default for PortalSwitches {
    fn default() -> PortalSwitches {
        PortalSwitches {
            enabled: true,
            login_enabled: false,
        }
    }
}

impl Default for Settings {
    fn default() -> Settings {
        Settings {
            workspace: None,
            portals: Portal::ALL
                .into_iter()
                .map(|p| (p, PortalSwitches::default()))
                .collect(),
            fetch_mail: true,
            fetch_search: true,
        }
    }
}

impl Settings {
    /// Stored settings; unreadable ones are replaced by the defaults (they are convenience,
    /// not data) - except the portal switches, which are safety: a switched-off portal
    /// must never get requests again because the stored JSON broke. Those come back off
    /// ([`Settings::safe_after_damage`]) until the user switches them on again.
    pub fn load(store: &Store) -> Result<Settings> {
        Ok(match store.kv_get(KEY)? {
            Some(json) => serde_json::from_str::<Settings>(&json).map_or_else(
                |e| {
                    log::warn!(
                        "settings unreadable ({e}): defaults, every portal switched off until \
                         the user switches it on again"
                    );
                    Settings::safe_after_damage()
                },
                Settings::normalized,
            ),
            None => Settings::default(),
        })
    }

    /// The defaults with every portal switched off: no mail read, no page requested, no
    /// sign-in.
    fn safe_after_damage() -> Settings {
        let off = PortalSwitches {
            enabled: false,
            login_enabled: false,
        };
        Settings {
            portals: Portal::ALL.into_iter().map(|p| (p, off)).collect(),
            ..Settings::default()
        }
    }

    pub fn save(&self, store: &Store) -> Result<()> {
        let json = serde_json::to_string(&self.clone().normalized()).expect("serialisable");
        store.kv_set(KEY, &json)
    }

    /// Every portal present; sign-in only where the portal has one.
    fn normalized(mut self) -> Settings {
        for portal in Portal::ALL {
            let switches = self.portals.entry(portal).or_default();
            if !portal.access().can_sign_in() {
                switches.login_enabled = false;
            }
        }
        self
    }

    /// The fetch reads the mailbox instead of searching: one of the two, never both (user
    /// decision 2026-10-01, "nur Postfach oder Suche"). The mailbox only while its switch alone
    /// is on; both on (the defaults, a file of an earlier version) or both off search.
    pub fn fetches_mail(&self) -> bool {
        self.fetch_mail && !self.fetch_search
    }

    /// The switches of a portal.
    pub fn portal(&self, portal: Portal) -> PortalSwitches {
        self.portals.get(&portal).copied().unwrap_or_default()
    }

    /// Portals whose alert mails are read (in the order of `Portal::ALL`).
    pub fn enabled_portals(&self) -> Vec<Portal> {
        Portal::ALL
            .into_iter()
            .filter(|&p| self.portal(p).enabled)
            .collect()
    }

    /// Portals whose job pages may be fetched: enabled and - for a portal that is only
    /// readable signed in - with the sign-in allowed. Otherwise the portal gets zero
    /// requests, and no sign-in window ever opens unasked.
    pub fn fetch_portals(&self) -> Vec<Portal> {
        Portal::ALL
            .into_iter()
            .filter(|&p| self.fetch_path(p).is_some())
            .collect()
    }

    /// The fetch path of a portal: `None` = zero requests; the session window only with
    /// the sign-in switched on.
    pub fn fetch_path(&self, portal: Portal) -> Option<FetchPath> {
        let switches = self.portal(portal);
        if !switches.enabled {
            return None;
        }
        portal.access().path(switches.login_enabled)
    }

    /// Workspace (chosen or default).
    pub fn workspace_or(&self, default: &std::path::Path) -> PathBuf {
        self.workspace
            .clone()
            .unwrap_or_else(|| default.to_path_buf())
    }
}

/// The default workspace in `documents`: `CXact`. A workspace chosen in the settings wins
/// ([`Settings::workspace_or`]).
pub fn default_workspace(documents: &Path) -> PathBuf {
    documents.join("CXact")
}

#[cfg(test)]
mod tests {
    /// The fetch searches or reads the mailbox, never both: the mailbox only while its switch
    /// alone is on, so the defaults and a file with both switches search.
    #[test]
    fn the_fetch_reads_the_mailbox_only_while_its_switch_alone_is_on() {
        let way = |fetch_mail, fetch_search| {
            Settings {
                fetch_mail,
                fetch_search,
                ..Settings::default()
            }
            .fetches_mail()
        };
        assert!(!Settings::default().fetches_mail(), "the search by default");
        assert!(way(true, false));
        assert!(!way(false, true));
        assert!(!way(true, true));
        assert!(!way(false, false));
    }

    use super::*;

    #[test]
    fn defaults_round_trip_and_repair() {
        let store = Store::in_memory().unwrap();
        assert_eq!(Settings::load(&store).unwrap(), Settings::default());
        let mut s = Settings::load(&store).unwrap();
        s.portals.insert(
            Portal::LinkedIn,
            PortalSwitches {
                enabled: false,
                login_enabled: true,
            },
        );
        s.fetch_mail = false;
        s.save(&store).unwrap();
        let back = Settings::load(&store).unwrap();
        assert_eq!(
            back.portal(Portal::LinkedIn),
            PortalSwitches {
                enabled: false,
                // LinkedIn has no sign-in: the switch cannot be on.
                login_enabled: false,
            }
        );
        assert!(!back.fetch_mail);
        assert_eq!(
            back.enabled_portals(),
            [
                Portal::FreelanceDe,
                Portal::Freelancermap,
                Portal::Hays,
                Portal::MichaelPage,
                Portal::Solcom,
                Portal::Gulp,
                Portal::AmadeusFire,
                Portal::InterimX,
                Portal::Fratch
            ]
        );
        // Missing fields: default per field.
        store
            .kv_set(KEY, r#"{"portals":{"freelance":{"loginEnabled":true}}}"#)
            .unwrap();
        let partial = Settings::load(&store).unwrap();
        assert!(partial.portal(Portal::FreelanceDe).login_enabled);
        assert!(partial.portal(Portal::FreelanceDe).enabled);
        assert!(partial.portal(Portal::LinkedIn).enabled);
        assert!(partial.fetch_mail && partial.fetch_search);
    }

    /// Broken JSON gives the defaults for convenience, but never switches a portal on:
    /// portals the user switched off must get zero requests (the hard rule), so all of them
    /// come back off until the user switches them on again.
    #[test]
    fn broken_settings_switch_no_portal_on() {
        let store = Store::in_memory().unwrap();
        let mut s = Settings::default();
        for switches in s.portals.values_mut() {
            switches.enabled = false;
        }
        s.save(&store).unwrap();
        let paths = crate::pipeline::stored_paths(std::sync::Arc::new(Store::in_memory().unwrap()));
        assert!(Portal::ALL.iter().all(|&p| paths(p).is_some()), "defaults");
        let json = store.kv_get(KEY).unwrap().unwrap();
        store.kv_set(KEY, &json[..json.len() - 1]).unwrap();
        let back = Settings::load(&store).unwrap();
        assert!(back.fetch_portals().is_empty());
        assert!(back.enabled_portals().is_empty());
        assert!(back.fetch_search, "the rest: defaults");
        let shared = std::sync::Arc::new(store);
        shared.kv_set(KEY, "{kaputt").unwrap();
        let paths = crate::pipeline::stored_paths(shared);
        assert!(Portal::ALL.iter().all(|&p| paths(p).is_none()));
    }

    /// An enabled portal always fetches its ads; switched off it gets zero requests.
    #[test]
    fn a_portal_off_gets_no_request() {
        let mut s = Settings::default();
        assert_eq!(s.fetch_portals(), Portal::ALL);
        s.portals.get_mut(&Portal::LinkedIn).unwrap().enabled = false;
        assert_eq!(
            s.fetch_portals(),
            [
                Portal::FreelanceDe,
                Portal::Freelancermap,
                Portal::Hays,
                Portal::MichaelPage,
                Portal::Solcom,
                Portal::Gulp,
                Portal::AmadeusFire,
                Portal::InterimX,
                Portal::Fratch
            ]
        );
        assert_eq!(s.fetch_path(Portal::LinkedIn), None);
    }

    /// freelance.de without the sign-in switch goes as a guest (the public teaser) - never
    /// in the session window; with the switch in the session window.
    #[test]
    fn a_portal_with_a_sign_in_goes_as_a_guest_until_the_switch() {
        let mut s = Settings::default();
        assert_eq!(s.fetch_portals(), Portal::ALL);
        assert_eq!(s.fetch_path(Portal::FreelanceDe), Some(FetchPath::Guest));
        s.portals
            .get_mut(&Portal::FreelanceDe)
            .unwrap()
            .login_enabled = true;
        assert_eq!(s.fetch_path(Portal::FreelanceDe), Some(FetchPath::Session));
        assert_eq!(s.fetch_path(Portal::LinkedIn), Some(FetchPath::Guest));
        s.portals.get_mut(&Portal::FreelanceDe).unwrap().enabled = false;
        assert_eq!(s.fetch_path(Portal::FreelanceDe), None);
    }
}
