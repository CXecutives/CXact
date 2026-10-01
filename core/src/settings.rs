//! Settings of the app - stored as JSON in the key/value table of the database.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Deserializer, Serialize};

use crate::error::Result;
use crate::portal::{FetchPath, Portal};
use crate::store::Store;

/// Key of the settings in the database (a restore of a backup keeps them, `store/backup.rs`).
pub(crate) const KEY: &str = "settings";

/// `#[serde(default)]` per field: an older file without today's fields keeps loading, and
/// fields of earlier versions (`format`, `scope`, `firstRunSeen`, `sessionPortals`,
/// `autoFetchOnStart`, `autoArchiveDays`, `autoEmptyTrashDays`) are skipped silently - serde
/// only refuses unknown fields with `deny_unknown_fields`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
#[expect(
    clippy::struct_excessive_bools,
    reason = "independent switches of the stored settings, each its own key"
)]
pub struct Settings {
    /// Workspace (the Exportordner); `None` = default ([`default_workspace`]:
    /// `Documents\CXact`, or the `Documents\Job-Alert-Monitor` of an earlier version). Only
    /// changeable through the folder dialog - never a path sent by the frontend.
    pub workspace: Option<PathBuf>,
    /// Switches per portal. Earlier versions stored the list of enabled portals here; that
    /// form still loads (listed = enabled, missing = disabled).
    #[serde(deserialize_with = "portals_any_form")]
    pub portals: BTreeMap<Portal, PortalSwitches>,
    /// Which alert mails "Postfach abrufen" reads (the "Zeitraum" menu beside that button). A
    /// range of a newer version reads as the default.
    #[serde(deserialize_with = "known_range")]
    pub fetch_range: FetchRange,
    /// The Excel file (`JobAlerts.xlsx`) is written with every export.
    pub export_excel: bool,
    /// The CSV file is written with every export.
    pub export_csv: bool,
    /// Language of the interface and of the exported Excel file and prompts (Einstellungen,
    /// Darstellung); `None` = German, until the user chooses English ([`Language::DEFAULT`],
    /// [`Settings::language_or`]). A code of a newer version reads as `None`.
    #[serde(deserialize_with = "known_language")]
    pub language: Option<Language>,
    /// The colours of the page and the window (Einstellungen, Darstellung); the page draws
    /// the top bar itself. The Excel file and the icon keep CXact. A name this version does
    /// not know (a newer version's) reads as CXact, and so does the earlier name "coast".
    #[serde(deserialize_with = "known_palette")]
    pub palette: Palette,
    /// "Jobs abrufen" runs by itself at the start and every 4 hours while the app is open
    /// (user decision 2026-10-01); off and not shown for now ([`AUTO_SHOWN`]).
    pub auto_fetch: bool,
    /// The fetch reads the alert mails (the menu beside the button, user decision
    /// 2026-10-01): with `fetch_search` off, see [`Settings::fetches_mail`].
    pub fetch_mail: bool,
    /// The fetch searches the sources the app searches itself (the same menu).
    pub fetch_search: bool,
}

/// Einstellungen shows Darstellung (the palette and the language); hidden for now.
pub const LOOK_SHOWN: bool = false;
/// Einstellungen shows the Excel and CSV switches; hidden for now, and no file is written.
pub const EXPORT_SHOWN: bool = false;
/// Einstellungen shows "Automatisch abrufen"; hidden for now (user, 2026-10-01: only by
/// hand), and the app never fetches by itself.
pub const AUTO_SHOWN: bool = false;
/// The fetch's ways are shown: the menu beside the fetch chooses the search or the mailbox
/// (user decisions 2026-10-01).
pub const WAYS_SHOWN: bool = true;

/// The app's colour palettes (`ui/src/styles/tokens.css`): CXact by default (the cxpertise
/// cream, coral and navy), and Light and Dark, neutral with blue details.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Palette {
    #[default]
    #[serde(alias = "coast")]
    Cxact,
    Light,
    Dark,
}

impl Palette {
    /// The name of the palette in tokens.css (`:root[data-palette='dark']`) and in the
    /// generated window colours (`export::palette::WINDOW_PALETTES`).
    pub fn code(self) -> &'static str {
        match self {
            Palette::Cxact => "cxact",
            Palette::Light => "light",
            Palette::Dark => "dark",
        }
    }
}

/// The app's language: German unless the user chose English in Einstellungen
/// ([`Language::DEFAULT`]); only the macOS menu follows the OS ([`Language::from_locale`]).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum Language {
    De,
    En,
}

impl Language {
    /// The app's language until the user picks one in Einstellungen: German, whatever the
    /// OS display language is (the app is written for German-speaking consultants; many of
    /// them run an English Windows or macOS).
    pub const DEFAULT: Language = Language::De;

    /// The language for a BCP 47 tag of the OS (`de-DE`, `de_AT.UTF-8`, `gsw-CH` ...): German
    /// for German, English for everything else (and for no tag at all).
    pub fn from_locale(tag: Option<&str>) -> Language {
        let primary = tag
            .unwrap_or_default()
            .split(['-', '_', '.', '@'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase();
        // `gsw` is Swiss German, `nds` Low German: their readers read German.
        if matches!(primary.as_str(), "de" | "gsw" | "nds") {
            Language::De
        } else {
            Language::En
        }
    }

    /// The code of the language (`de`, `en`), as in `<html lang>`.
    pub fn code(self) -> &'static str {
        match self {
            Language::De => "de",
            Language::En => "en",
        }
    }
}

/// Which alert mails "Postfach abrufen" reads (`mail::scan::Scope`): since the last fetch
/// that covered the time before it, the last 7 or 30 days, or every alert mail. The scan
/// state per portal advances only when the range covered the gap since it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum FetchRange {
    #[default]
    SinceLast,
    Days7,
    Days30,
    All,
}

/// The switches of one portal. Safe defaults: active, never signed in. An enabled portal's
/// alert mails are read and its ads fetched; off = no mail read and zero requests to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", from = "StoredSwitches")]
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

/// The switches as a file of any version holds them. Earlier versions had a switch of their
/// own for the ads (`fetchDetails`): off, the portal got zero requests. That promise stands,
/// so such a portal comes back switched off until the user switches it on again.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct StoredSwitches {
    enabled: bool,
    fetch_details: bool,
    login_enabled: bool,
}

impl Default for StoredSwitches {
    fn default() -> StoredSwitches {
        let switches = PortalSwitches::default();
        StoredSwitches {
            enabled: switches.enabled,
            fetch_details: true,
            login_enabled: switches.login_enabled,
        }
    }
}

impl From<StoredSwitches> for PortalSwitches {
    fn from(stored: StoredSwitches) -> PortalSwitches {
        PortalSwitches {
            enabled: stored.enabled && stored.fetch_details,
            login_enabled: stored.login_enabled,
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
            fetch_range: FetchRange::SinceLast,
            export_excel: true,
            export_csv: false,
            language: None,
            palette: Palette::Cxact,
            auto_fetch: false,
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

    /// The settings while cards of Einstellungen are hidden (user, 2026-09-30): without
    /// Darstellung the app is CXact and German ([`LOOK_SHOWN`]), without Export it writes no
    /// Excel or CSV file ([`EXPORT_SHOWN`]). A hidden choice goes back to that; `true` when
    /// something changed (the start saves it). The fields and their code stay.
    pub fn fit_hidden(&mut self) -> bool {
        let before = self.clone();
        if !LOOK_SHOWN {
            self.palette = Palette::default();
            self.language = None;
        }
        if !EXPORT_SHOWN {
            self.export_excel = false;
            self.export_csv = false;
        }
        if !AUTO_SHOWN {
            self.auto_fetch = false;
        }
        if !WAYS_SHOWN {
            self.fetch_mail = true;
            self.fetch_search = true;
        }
        *self != before
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

    /// The chosen language, else `fallback` (the app passes [`Language::DEFAULT`]).
    pub fn language_or(&self, fallback: Language) -> Language {
        self.language.unwrap_or(fallback)
    }

    /// Workspace (chosen or default).
    pub fn workspace_or(&self, default: &std::path::Path) -> PathBuf {
        self.workspace
            .clone()
            .unwrap_or_else(|| default.to_path_buf())
    }
}

/// The default workspace's folder in the documents folder.
const WORKSPACE_NAME: &str = "CXact";
/// The default workspace of the versions named Job-Alert-Monitor.
const OLD_WORKSPACE_NAME: &str = "Job-Alert-Monitor";

/// The default workspace in `documents`: `CXact`, unless the `Job-Alert-Monitor` folder of an
/// earlier version holds the app's files (its profiles or its result folder) and `CXact` does
/// not; then that one stays in use, so nothing moves and nothing is left behind. A workspace
/// chosen in the settings wins over both ([`Settings::workspace_or`]).
pub fn default_workspace(documents: &Path) -> PathBuf {
    let current = documents.join(WORKSPACE_NAME);
    let old = documents.join(OLD_WORKSPACE_NAME);
    if !holds_app_files(&current) && holds_app_files(&old) {
        old
    } else {
        current
    }
}

/// The folder holds the app's own folders: the profiles (`profil/`) or the result files
/// (`auswertung/`).
fn holds_app_files(folder: &Path) -> bool {
    folder.join(crate::profile::PROFILE_DIR).is_dir()
        || folder.join(crate::export::RESULT_DIR).is_dir()
}

/// A stored language; one this version does not know (a newer version wrote it) is none.
fn known_language<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Option<Language>, D::Error> {
    let code = Option::<String>::deserialize(deserializer)?;
    Ok(code.and_then(|code| serde_json::from_value(serde_json::Value::String(code)).ok()))
}

/// A stored range; one this version does not know is the default.
fn known_range<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<FetchRange, D::Error> {
    let name = Option::<String>::deserialize(deserializer)?;
    Ok(name
        .and_then(|name| serde_json::from_value(serde_json::Value::String(name)).ok())
        .unwrap_or_default())
}

/// A stored palette; one this version does not know is CXact.
fn known_palette<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<Palette, D::Error> {
    let name = Option::<String>::deserialize(deserializer)?;
    Ok(name
        .and_then(|name| serde_json::from_value(serde_json::Value::String(name)).ok())
        .unwrap_or_default())
}

/// Reads the portal switches in today's map form or the list form of earlier versions.
/// Unknown portal keys are skipped.
fn portals_any_form<'de, D: Deserializer<'de>>(
    deserializer: D,
) -> std::result::Result<BTreeMap<Portal, PortalSwitches>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum AnyForm {
        List(Vec<String>),
        Map(BTreeMap<String, PortalSwitches>),
    }
    Ok(match AnyForm::deserialize(deserializer)? {
        AnyForm::List(keys) => Portal::ALL
            .into_iter()
            .map(|p| {
                let enabled = keys.iter().any(|k| k == p.key());
                (
                    p,
                    PortalSwitches {
                        enabled,
                        ..PortalSwitches::default()
                    },
                )
            })
            .collect(),
        AnyForm::Map(map) => map
            .into_iter()
            .filter_map(|(key, switches)| Some((Portal::from_key(&key)?, switches)))
            .collect(),
    })
}

#[cfg(test)]
mod tests {
    /// Hidden cards keep their defaults: CXact, German, no overview file; the rest stays.
    #[test]
    fn hidden_cards_keep_their_defaults() {
        let mut s = Settings {
            palette: Palette::Dark,
            language: Some(Language::En),
            export_excel: true,
            export_csv: true,
            fetch_range: FetchRange::Days7,
            ..Settings::default()
        };
        assert_eq!(s.fit_hidden(), !LOOK_SHOWN || !EXPORT_SHOWN);
        if !LOOK_SHOWN {
            assert_eq!((s.palette, s.language), (Palette::Cxact, None));
        }
        if !EXPORT_SHOWN {
            assert_eq!((s.export_excel, s.export_csv), (false, false));
        }
        assert_eq!(s.fetch_range, FetchRange::Days7);
        assert!(!s.fit_hidden(), "a second fit changes nothing");
    }

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

    /// A new install exports into `Documents\CXact`; the `Job-Alert-Monitor` folder of an
    /// earlier version stays in use while it holds the app's files and `CXact` does not.
    #[test]
    fn the_default_workspace_keeps_an_old_folder_with_the_apps_files() {
        let documents = tempfile::tempdir().unwrap();
        let (current, old) = (
            documents.path().join("CXact"),
            documents.path().join("Job-Alert-Monitor"),
        );
        assert_eq!(
            default_workspace(documents.path()),
            current,
            "a fresh install"
        );
        std::fs::create_dir(&old).unwrap();
        assert_eq!(
            default_workspace(documents.path()),
            current,
            "an empty old folder is none of the app's"
        );
        for own in [crate::profile::PROFILE_DIR, crate::export::RESULT_DIR] {
            std::fs::create_dir(old.join(own)).unwrap();
            assert_eq!(default_workspace(documents.path()), old, "{own}");
            std::fs::remove_dir(old.join(own)).unwrap();
        }
        std::fs::create_dir_all(old.join(crate::profile::PROFILE_DIR)).unwrap();
        std::fs::create_dir_all(current.join(crate::export::RESULT_DIR)).unwrap();
        assert_eq!(
            default_workspace(documents.path()),
            current,
            "the new folder is in use already"
        );
    }

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
        s.fetch_range = FetchRange::Days7;
        s.export_excel = false;
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
        assert_eq!(
            (back.fetch_range, back.export_excel),
            (FetchRange::Days7, false)
        );
        assert_eq!(
            back.enabled_portals(),
            [
                Portal::FreelanceDe,
                Portal::Freelancermap,
                Portal::Hays,
                Portal::MichaelPage,
                Portal::Solcom,
                Portal::Gulp,
                Portal::InterimX
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
        assert_eq!(
            (
                partial.fetch_range,
                partial.export_excel,
                partial.export_csv
            ),
            (FetchRange::SinceLast, true, false)
        );
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
        assert!(back.export_excel, "the rest: defaults");
        let shared = std::sync::Arc::new(store);
        shared.kv_set(KEY, "{kaputt").unwrap();
        let paths = crate::pipeline::stored_paths(shared);
        assert!(Portal::ALL.iter().all(|&p| paths(p).is_none()));
    }

    /// A file of an earlier version carries fields that no longer exist and the list form of
    /// the portal choice: it loads, and the choice survives as the `enabled` switch. The
    /// switch of the fetch at the start (gone: the app fetches only when asked) and the
    /// automatic archive are skipped, and saving drops them.
    #[test]
    fn settings_of_an_older_version_still_load() {
        let store = Store::in_memory().unwrap();
        store
            .kv_set(
                KEY,
                r#"{"workspace":null,"format":"xlsx","scope":"week","portals":["linkedin"],"sessionPortals":["freelance"],"firstRunSeen":true,"autoFetchOnStart":true,"autoArchiveDays":7}"#,
            )
            .unwrap();
        let back = Settings::load(&store).unwrap();
        assert_eq!(back.enabled_portals(), [Portal::LinkedIn]);
        assert_eq!(back.fetch_portals(), [Portal::LinkedIn]);
        assert_eq!(back.workspace, None);
        back.save(&store).unwrap();
        let saved = store.kv_get(KEY).unwrap().unwrap();
        assert!(!saved.contains("autoFetchOnStart"), "{saved}");
        assert!(!saved.contains("autoArchiveDays"), "{saved}");
        store.kv_set(KEY, r#"{"portals":[]}"#).unwrap();
        assert!(Settings::load(&store).unwrap().enabled_portals().is_empty());
    }

    /// Without a choice the app follows the OS: German only on a German system. A stored
    /// choice wins and survives a restart; an unknown code falls back to the OS.
    #[test]
    fn the_language_follows_the_system_until_chosen() {
        for (tag, language) in [
            (Some("de-DE"), Language::De),
            (Some("de-AT"), Language::De),
            (Some("de_CH.UTF-8"), Language::De),
            (Some("gsw-CH"), Language::De),
            (Some("DE"), Language::De),
            (Some("en-US"), Language::En),
            (Some("fr-FR"), Language::En),
            (Some("nl"), Language::En),
            (Some("dev"), Language::En),
            (Some(""), Language::En),
            (None, Language::En),
        ] {
            assert_eq!(Language::from_locale(tag), language, "{tag:?}");
        }

        let store = Store::in_memory().unwrap();
        let mut s = Settings::load(&store).unwrap();
        assert_eq!(s.language, None);
        assert_eq!(s.language_or(Language::De), Language::De);
        assert_eq!(s.language_or(Language::En), Language::En);
        s.language = Some(Language::En);
        s.save(&store).unwrap();
        let back = Settings::load(&store).unwrap();
        assert_eq!(back.language_or(Language::De), Language::En);
        assert!(
            store
                .kv_get(KEY)
                .unwrap()
                .unwrap()
                .contains(r#""language":"en""#)
        );
        // A language of a newer version: the settings stay, the language follows the OS.
        store
            .kv_set(KEY, r#"{"language":"fr","exportCsv":true}"#)
            .unwrap();
        let newer = Settings::load(&store).unwrap();
        assert!(newer.export_csv);
        assert_eq!(newer.language, None);
    }

    /// CXact until one is chosen; the choice survives a restart, a palette of a newer version
    /// reads as CXact without costing the other settings, and so does its earlier name.
    #[test]
    fn the_palette_is_cxact_until_chosen() {
        let store = Store::in_memory().unwrap();
        let mut s = Settings::load(&store).unwrap();
        assert_eq!(s.palette, Palette::Cxact);
        s.palette = Palette::Dark;
        s.save(&store).unwrap();
        assert_eq!(Settings::load(&store).unwrap().palette, Palette::Dark);
        assert!(
            store
                .kv_get(KEY)
                .unwrap()
                .unwrap()
                .contains(r#""palette":"dark""#)
        );
        store
            .kv_set(KEY, r#"{"palette":"sepia","exportCsv":true}"#)
            .unwrap();
        let newer = Settings::load(&store).unwrap();
        assert_eq!(newer.palette, Palette::Cxact);
        assert!(newer.export_csv);
        store
            .kv_set(KEY, r#"{"palette":"coast","exportCsv":true}"#)
            .unwrap();
        let earlier = Settings::load(&store).unwrap();
        assert_eq!(earlier.palette, Palette::Cxact);
        assert!(earlier.export_csv);
        assert_eq!(
            [Palette::Cxact, Palette::Light, Palette::Dark].map(Palette::code),
            ["cxact", "light", "dark"]
        );
    }

    /// An enabled portal always fetches its ads; switched off it gets zero requests. A file
    /// of an earlier version whose details switch was off brings the portal back switched
    /// off (that switch promised zero requests), and saving drops the switch.
    #[test]
    fn a_portal_off_gets_no_request_and_the_old_details_switch_keeps_its_promise() {
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
                Portal::InterimX
            ]
        );
        assert_eq!(s.fetch_path(Portal::LinkedIn), None);
        let store = Store::in_memory().unwrap();
        store
            .kv_set(
                KEY,
                r#"{"portals":{"linkedin":{"enabled":true,"fetchDetails":false},"freelance":{"enabled":true,"fetchDetails":true,"loginEnabled":true}}}"#,
            )
            .unwrap();
        let back = Settings::load(&store).unwrap();
        assert!(!back.portal(Portal::LinkedIn).enabled);
        assert_eq!(back.fetch_path(Portal::LinkedIn), None);
        assert_eq!(
            back.fetch_path(Portal::FreelanceDe),
            Some(FetchPath::Session)
        );
        back.save(&store).unwrap();
        let saved = store.kv_get(KEY).unwrap().unwrap();
        assert!(!saved.contains("fetchDetails"), "{saved}");
    }

    /// A range of a newer version reads as the default without costing the other settings.
    #[test]
    fn the_fetch_range_is_since_the_last_fetch_until_chosen() {
        let store = Store::in_memory().unwrap();
        assert_eq!(
            Settings::load(&store).unwrap().fetch_range,
            FetchRange::SinceLast
        );
        for (range, json) in [
            (FetchRange::SinceLast, "sinceLast"),
            (FetchRange::Days7, "days7"),
            (FetchRange::Days30, "days30"),
            (FetchRange::All, "all"),
        ] {
            assert_eq!(serde_json::to_value(range).unwrap(), json);
        }
        store
            .kv_set(KEY, r#"{"fetchRange":"days90","exportExcel":false}"#)
            .unwrap();
        let newer = Settings::load(&store).unwrap();
        assert_eq!(newer.fetch_range, FetchRange::SinceLast);
        assert!(!newer.export_excel);
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
