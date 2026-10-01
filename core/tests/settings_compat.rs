//! The settings file stays compatible across versions (docs/ARCHITECTURE.md, guardrails):
//! the file an earlier version wrote loads without losing a value, the file of a newer
//! version (fields and names this one does not know) loads without being taken for a damaged
//! one (which would switch every portal off), and what this version saves loads back the same.
//!
//! A new field of `Settings`: add `fixtures/settings/<version>.json` (a copy of the newest
//! file plus the new field at a value other than its default; a second file of the same
//! version gets a suffix, `3.0.0-2.json`), point `NEWEST` at it and give each older file its
//! expectation (the new field at its default). Never edit a file that a released version
//! wrote: users still have it on disk. A renamed field keeps the old name as
//! `#[serde(alias = "...")]`, or the older files lose its value here.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use jobalert_core::portal::Portal;
use jobalert_core::settings::{FetchRange, Language, Palette, PortalSwitches, Settings};
use jobalert_core::store::Store;

/// The key of the settings in the database's key/value table.
const KEY: &str = "settings";
/// The file of this version: every field, none at its default.
const NEWEST: &str = "3.0.0-3.json";

fn fixture(name: &str) -> String {
    let path = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/settings")
        .join(name);
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn load(json: &str) -> Settings {
    let store = Store::in_memory().unwrap();
    store.kv_set(KEY, json).unwrap();
    Settings::load(&store).unwrap()
}

/// Saved and loaded again, and the JSON that was saved.
fn round_trip(settings: &Settings) -> (Settings, serde_json::Value) {
    let store = Store::in_memory().unwrap();
    settings.save(&store).unwrap();
    let saved = store.kv_get(KEY).unwrap().expect("saved");
    (
        Settings::load(&store).unwrap(),
        serde_json::from_str(&saved).unwrap(),
    )
}

fn switches(enabled: bool, login_enabled: bool) -> PortalSwitches {
    PortalSwitches {
        enabled,
        login_enabled,
    }
}

/// What `NEWEST` holds.
fn newest() -> Settings {
    Settings {
        workspace: Some(PathBuf::from("/data/CXact")),
        portals: BTreeMap::from([
            (Portal::LinkedIn, switches(true, false)),
            (Portal::FreelanceDe, switches(true, true)),
            (Portal::Freelancermap, switches(false, false)),
            (Portal::Hays, switches(false, false)),
        ]),
        fetch_range: FetchRange::Days30,
        export_excel: false,
        export_csv: true,
        language: Some(Language::En),
        palette: Palette::Dark,
        auto_fetch: false,
    }
}

fn keys(value: &serde_json::Value) -> Vec<String> {
    let mut keys: Vec<String> = value
        .as_object()
        .expect("an object")
        .keys()
        .cloned()
        .collect();
    keys.sort();
    keys
}

#[test]
fn the_newest_file_holds_every_field_off_its_default() {
    let file: serde_json::Value = serde_json::from_str(&fixture(NEWEST)).unwrap();
    let default = serde_json::to_value(Settings::default()).unwrap();
    assert_eq!(
        keys(&file),
        keys(&default),
        "Settings has another field than fixtures/settings/{NEWEST}: add a file of the new \
         version with it (see the head of this test)"
    );
    for key in keys(&default) {
        assert_ne!(
            file[&key], default[&key],
            "{key} stands at its default in {NEWEST}: a lost value would go unnoticed"
        );
    }
}

#[test]
fn the_file_of_this_version_loads_without_loss_and_round_trips() {
    let loaded = load(&fixture(NEWEST));
    assert_eq!(loaded, newest());
    let (back, saved) = round_trip(&loaded);
    assert_eq!(back, loaded);
    let file: serde_json::Value = serde_json::from_str(&fixture(NEWEST)).unwrap();
    assert_eq!(saved, file, "this version saves exactly the file it reads");
}

#[test]
fn a_file_of_an_earlier_version_loads_without_loss_and_round_trips() {
    let loaded = load(&fixture("older.json"));
    let expected = Settings {
        workspace: Some(PathBuf::from("/data/CXact")),
        // The list form: listed portals on, the others off.
        portals: BTreeMap::from([
            (Portal::LinkedIn, switches(true, false)),
            (Portal::FreelanceDe, switches(false, false)),
            (Portal::Freelancermap, switches(true, false)),
            (Portal::Hays, switches(false, false)),
        ]),
        ..Settings::default()
    };
    assert_eq!(loaded, expected);
    let (back, saved) = round_trip(&loaded);
    assert_eq!(back, loaded);
    let default = serde_json::to_value(Settings::default()).unwrap();
    assert_eq!(
        keys(&saved),
        keys(&default),
        "saving writes today's form: the fields of the earlier version go, the new ones come"
    );
}

/// The file of 3.0.0: the automatic archive and trash are gone; a portal whose details
/// switch was off comes back switched off (that switch promised zero requests to it); the
/// new fields stand at their defaults.
#[test]
fn the_file_of_3_0_0_loads_and_keeps_its_promise_of_no_requests() {
    let loaded = load(&fixture("3.0.0.json"));
    let expected = Settings {
        workspace: Some(PathBuf::from("/data/CXact")),
        portals: BTreeMap::from([
            (Portal::LinkedIn, switches(false, false)),
            (Portal::FreelanceDe, switches(true, true)),
            (Portal::Freelancermap, switches(false, false)),
            (Portal::Hays, switches(true, false)),
        ]),
        language: Some(Language::En),
        palette: Palette::Dark,
        ..Settings::default()
    };
    assert_eq!(loaded, expected);
    let (back, saved) = round_trip(&loaded);
    assert_eq!(back, loaded);
    let default = serde_json::to_value(Settings::default()).unwrap();
    assert_eq!(keys(&saved), keys(&default), "saving writes today's form");
}

/// The file of 3.0.0 before the search (2026-10-01): Hays comes switched on, and so does the
/// automatic fetch.
#[test]
fn the_file_before_the_search_loads_with_the_new_source_on() {
    let loaded = load(&fixture("3.0.0-2.json"));
    let mut portals = newest().portals;
    portals.insert(Portal::Hays, switches(true, false));
    let expected = Settings {
        portals,
        auto_fetch: true,
        ..newest()
    };
    assert_eq!(loaded, expected);
    assert_eq!(round_trip(&loaded).0, loaded);
}

#[test]
fn a_file_of_a_newer_version_loads_without_damage() {
    let loaded = load(&fixture("newer.json"));
    // Unknown fields, an unknown portal and a switch it does not know are skipped; a language,
    // palette or fetch range of a newer version reads as none chosen. Nothing else changes:
    // above all the file is not taken for a damaged one (that would switch every portal off).
    // Hays and the automatic fetch came after it: at their defaults.
    let mut portals = newest().portals;
    portals.insert(Portal::Hays, switches(true, false));
    let expected = Settings {
        language: None,
        palette: Palette::Cxact,
        fetch_range: FetchRange::SinceLast,
        portals,
        auto_fetch: true,
        ..newest()
    };
    assert_eq!(loaded, expected);
    assert_eq!(round_trip(&loaded).0, loaded);
}
