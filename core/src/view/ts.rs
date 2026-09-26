//! TypeScript types of the IPC contract, generated from the Rust types (ts-rs, tests only).
//!
//! `cargo test -p jobalert-core ipc_types` regenerates `ui/src/lib/ipc/types/` and fails
//! while a file changed - commit the result. The command map `commands.ts` next to them is
//! written by `core/tests/contract.rs` from the command table in `src-tauri`.
//!
//! Beside the types, the decisions the interface shares with the backend are written as
//! values, one lower-case module each (never edited by hand, [`values`]): `bands.ts` (the
//! band thresholds), `portals.ts` (the portals' names and marks), `profile.ts` (the form's
//! criteria, limits and empty form).

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::{Path, PathBuf};

use ts_rs::{Config, TS, TypeVisitor};

use crate::error::{ErrorInfo, ErrorKind, InvalidInput};
use crate::fetch::PortalHealth;
use crate::fetch::policy::PauseReason;
use crate::model::{Band, KeyFacts, MatchStatus, Notice, Place};
use crate::pipeline::{
    ExportSummary, NewJobs, Outcome, PortalSummary, RunEvent, RunKind, RunKindName, RunRequest,
    RunSnapshot, RunSummary, ScanCounts, ScoreDelta, ScoreSummary, StatusCode, Step,
};
use crate::portal::{JobKey, Portal};
use crate::settings::{FetchRange, Language, Palette};
use crate::store::{Backup, BackupKind};
use crate::view::{
    AppState, Deleted, DetailState, EmptyAlert, Evidence, Highlight, JobCounts, JobDetail, JobMail,
    JobMatch, JobPage, JobQuery, JobSort, JobView, LanguageLevel, Mailbox, MailboxCheck,
    MatchDetail, MoveBack, OpenTarget, Platform, PortalCount, PortalLogin, PortalNew, PortalPatch,
    PortalState, ProfileAvailability, ProfileCompetence, ProfileCriteria, ProfileDraft,
    ProfileForm, ProfileInfo, ProfileLanguage, ProfileQuality, ProfileSave, ProfileSource,
    ProfileUnderstanding, ProfileWishes, Quota, Reason, ReasonKind, ReasonWeight, RemoteWish,
    ResetSummary, SettingsPatch, SettingsView, TextRange, UnreadableField, VaultKind, WorkMode,
    WorkspacePick, WorkspaceProfile,
};

/// `Portal` lives in `portal/mod.rs` without the derive: its TypeScript is the keys of the
/// registry (`Portal::ALL`), so a new portal needs no second list here.
impl TS for Portal {
    type WithoutGenerics = Portal;
    type OptionInnerType = Portal;
    fn docs() -> Option<String> {
        Some(ts_rs::format_docs(&[" A portal key."]))
    }
    fn ident(_: &Config) -> String {
        "Portal".to_owned()
    }
    fn name(_: &Config) -> String {
        "Portal".to_owned()
    }
    fn inline(_: &Config) -> String {
        let keys: Vec<String> = Portal::ALL
            .iter()
            .map(|p| format!("\"{}\"", p.key()))
            .collect();
        keys.join(" | ")
    }
    fn decl(cfg: &Config) -> String {
        format!("type Portal = {};", Self::inline(cfg))
    }
    fn decl_concrete(cfg: &Config) -> String {
        Self::decl(cfg)
    }
    fn visit_dependencies(_: &mut impl TypeVisitor)
    where
        Self: 'static,
    {
    }
    fn output_path() -> Option<PathBuf> {
        Some(PathBuf::from("Portal.ts"))
    }
}

/// Identity of a job across all mails and runs.
#[derive(TS)]
#[ts(rename = "JobKey")]
#[expect(
    dead_code,
    reason = "shadow of `JobKey` for the TypeScript generator only"
)]
struct JobKeyTs {
    portal: Portal,
    id: String,
}

/// `JobKey` lives in `portal/mod.rs` without the derive; its TypeScript comes from the shadow
/// above (a test checks that the JSON agrees).
macro_rules! shadow {
    ($real:ty => $shadow:ty) => {
        impl TS for $real {
            type WithoutGenerics = $real;
            type OptionInnerType = $real;
            fn docs() -> Option<String> {
                <$shadow>::docs()
            }
            fn ident(cfg: &Config) -> String {
                <$shadow>::ident(cfg)
            }
            fn name(cfg: &Config) -> String {
                <$shadow>::name(cfg)
            }
            fn inline(cfg: &Config) -> String {
                <$shadow>::inline(cfg)
            }
            fn decl(cfg: &Config) -> String {
                <$shadow>::decl(cfg)
            }
            fn decl_concrete(cfg: &Config) -> String {
                <$shadow>::decl_concrete(cfg)
            }
            fn visit_dependencies(v: &mut impl TypeVisitor)
            where
                Self: 'static,
            {
                <$shadow>::visit_dependencies(v);
            }
            fn output_path() -> Option<PathBuf> {
                <$shadow>::output_path()
            }
        }
    };
}

shadow!(JobKey => JobKeyTs);

/// Generated file name -> content, and the files every type depends on.
struct Generated {
    cfg: Config,
    by_name: BTreeMap<String, String>,
    needed: Vec<String>,
}

impl Generated {
    fn add<T: TS + 'static>(&mut self) {
        let path = T::output_path().expect("exportable type");
        let name = path.to_string_lossy().replace('\\', "/");
        let content = T::export_to_string(&self.cfg).expect("TypeScript for the type");
        for dep in T::dependencies(&self.cfg) {
            self.needed
                .push(dep.output_path.to_string_lossy().replace('\\', "/"));
        }
        self.by_name.insert(name, content);
    }
}

/// Every type of the contract.
#[expect(clippy::too_many_lines, reason = "one line per type of the contract")]
fn contract() -> BTreeMap<String, String> {
    // Integers are JSON numbers, never `bigint`.
    let mut f = Generated {
        cfg: Config::new().with_large_int("number"),
        by_name: BTreeMap::new(),
        needed: Vec::new(),
    };
    f.add::<Portal>();
    f.add::<JobKey>();
    f.add::<ErrorKind>();
    f.add::<ErrorInfo>();
    f.add::<InvalidInput>();
    f.add::<MatchStatus>();
    f.add::<Place>();
    f.add::<Band>();
    f.add::<Notice>();
    f.add::<KeyFacts>();
    f.add::<PauseReason>();
    f.add::<PortalHealth>();
    f.add::<WorkMode>();
    f.add::<DetailState>();
    f.add::<JobMatch>();
    f.add::<JobView>();
    f.add::<ReasonKind>();
    f.add::<ReasonWeight>();
    f.add::<Evidence>();
    f.add::<TextRange>();
    f.add::<Reason>();
    f.add::<Highlight>();
    f.add::<MatchDetail>();
    f.add::<JobMail>();
    f.add::<JobDetail>();
    f.add::<JobSort>();
    f.add::<JobQuery>();
    f.add::<PortalNew>();
    f.add::<JobCounts>();
    f.add::<JobPage>();
    f.add::<EmptyAlert>();
    f.add::<Platform>();
    f.add::<Language>();
    f.add::<Palette>();
    f.add::<FetchRange>();
    f.add::<VaultKind>();
    f.add::<Mailbox>();
    f.add::<PortalCount>();
    f.add::<MailboxCheck>();
    f.add::<SettingsView>();
    f.add::<SettingsPatch>();
    f.add::<WorkspacePick>();
    f.add::<WorkspaceProfile>();
    f.add::<PortalPatch>();
    f.add::<PortalLogin>();
    f.add::<Quota>();
    f.add::<PortalState>();
    f.add::<ProfileQuality>();
    f.add::<ProfileSource>();
    f.add::<ProfileUnderstanding>();
    f.add::<ProfileInfo>();
    f.add::<LanguageLevel>();
    f.add::<ProfileAvailability>();
    f.add::<ProfileCompetence>();
    f.add::<ProfileLanguage>();
    f.add::<ProfileCriteria>();
    f.add::<RemoteWish>();
    f.add::<ProfileWishes>();
    f.add::<UnreadableField>();
    f.add::<ProfileForm>();
    f.add::<ProfileDraft>();
    f.add::<ProfileSave>();
    f.add::<ResetSummary>();
    f.add::<BackupKind>();
    f.add::<Backup>();
    f.add::<AppState>();
    f.add::<OpenTarget>();
    f.add::<MoveBack>();
    f.add::<Deleted>();
    f.add::<RunRequest>();
    f.add::<RunKind>();
    f.add::<RunKindName>();
    f.add::<Step>();
    f.add::<StatusCode>();
    f.add::<RunEvent>();
    f.add::<Outcome>();
    f.add::<ScanCounts>();
    f.add::<PortalSummary>();
    f.add::<ScoreDelta>();
    f.add::<ScoreSummary>();
    f.add::<NewJobs>();
    f.add::<ExportSummary>();
    f.add::<RunSummary>();
    f.add::<RunSnapshot>();
    let missing: Vec<&String> = f
        .needed
        .iter()
        .filter(|n| !f.by_name.contains_key(*n))
        .collect();
    assert!(
        missing.is_empty(),
        "types used but not exported: {missing:?}"
    );
    let mut barrel = String::new();
    for file in f.by_name.keys() {
        // Types only: the value modules are imported by their path.
        let module = file.trim_end_matches(".ts");
        let _ = writeln!(barrel, "export type {{ {module} }} from \"./{module}\";");
    }
    f.by_name.extend(values());
    f.by_name.insert(
        "index.ts".into(),
        format!(
            "// Generated by core/src/view/ts.rs (cargo test -p jobalert-core ipc_types). Do not edit.\n\
             {barrel}export type {{ Commands }} from \"./commands\";\n"
        ),
    );
    f.by_name
}

/// The first line of a value module.
fn value_header(source: &str) -> String {
    format!(
        "// Generated by core/src/view/ts.rs from {source} \
         (cargo test -p jobalert-core ipc_types). Do not edit.\n"
    )
}

/// The JSON name of a value (a variant as the IPC writes it).
fn json_name(value: impl serde::Serialize) -> String {
    serde_json::to_value(value)
        .ok()
        .and_then(|v| v.as_str().map(str::to_owned))
        .expect("a unit variant")
}

/// The value modules: the decisions of the backend the interface shows, by file name.
fn values() -> BTreeMap<String, String> {
    use crate::model::{HIGH_FROM, MID_FROM};

    let mut out = BTreeMap::new();

    let mut bands = value_header("core/src/model.rs");
    let from: Vec<String> = Band::ALL
        .iter()
        .map(|band| format!("{}: {}", json_name(band), band.lowest()))
        .collect();
    let _ = write!(
        bands,
        "import type {{ Band }} from \"./Band\";\n\n\
         /** Minimum score of the high band. */\n\
         export const HIGH_FROM = {HIGH_FROM};\n\
         /** Minimum score of the mid band. */\n\
         export const MID_FROM = {MID_FROM};\n\
         /** The lowest score of each band. */\n\
         export const BAND_FROM: Record<Band, number> = {{ {} }};\n\n\
         /** The band of a score (`model::band`). */\n\
         export function bandOf(score: number): Band {{\n  \
         return score >= HIGH_FROM ? \"{}\" : score >= MID_FROM ? \"{}\" : \"{}\";\n}}\n",
        from.join(", "),
        json_name(Band::High),
        json_name(Band::Mid),
        json_name(Band::Low),
    );
    out.insert("bands.ts".to_owned(), bands);

    let mut portals = value_header("the portal registry, core/src/portal");
    portals.push_str(
        "import type { Portal } from \"./Portal\";\n\n\
         /** Every portal in the app's order (`Portal::ALL`). */\n\
         export const PORTALS: readonly Portal[] = [",
    );
    let keys: Vec<String> = Portal::ALL
        .iter()
        .map(|p| format!("\"{}\"", p.key()))
        .collect();
    portals.push_str(&keys.join(", "));
    portals.push_str(
        "];\n\n/** A portal's name everywhere: its web address (`Portal::label`). */\n\
         export const PORTAL_LABEL: Record<Portal, string> = {\n",
    );
    for portal in Portal::ALL {
        let _ = writeln!(portals, "  {}: \"{}\",", portal.key(), portal.label());
    }
    portals.push_str(
        "};\n\n/** A portal's two-letter mark, brand-neutral (`Portal::monogram`). */\n\
         export const PORTAL_MONOGRAM: Record<Portal, string> = {\n",
    );
    for portal in Portal::ALL {
        let _ = writeln!(portals, "  {}: \"{}\",", portal.key(), portal.monogram());
    }
    portals.push_str("};\n");
    out.insert("portals.ts".to_owned(), portals);

    let profile = value_header("core/src/profile/form.rs") + &crate::profile::form_typescript();
    out.insert("profile.ts".to_owned(), profile);
    out
}

pub(crate) fn types_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../ui/src/lib/ipc/types")
}

/// Regenerates the TypeScript types; fails while the committed files differ.
#[test]
fn ipc_types_are_generated_and_committed() {
    let dir = types_dir();
    std::fs::create_dir_all(&dir).unwrap();
    let expected = contract();
    let mut changed = Vec::new();
    for (name, content) in &expected {
        let path = dir.join(name);
        if std::fs::read_to_string(&path).ok().as_deref() != Some(content.as_str()) {
            std::fs::write(&path, content).unwrap();
            changed.push(name.clone());
        }
    }
    // Files of types that no longer exist go (the command map belongs to contract.rs).
    for entry in std::fs::read_dir(&dir).unwrap() {
        let name = entry.unwrap().file_name().to_string_lossy().into_owned();
        let is_ts = Path::new(&name)
            .extension()
            .is_some_and(|e| e.eq_ignore_ascii_case("ts"));
        if is_ts && name != "commands.ts" && !expected.contains_key(&name) {
            std::fs::remove_file(dir.join(&name)).unwrap();
            changed.push(format!("{name} (removed)"));
        }
    }
    assert!(
        changed.is_empty(),
        "regenerated TypeScript types - commit them: {changed:?}"
    );
}

/// The shadows say what the real types serialise to.
#[test]
fn the_shadows_match_the_json() {
    let cfg = Config::new();
    for portal in Portal::ALL {
        let json = serde_json::to_string(&portal).unwrap();
        assert!(Portal::inline(&cfg).contains(&json), "{json}");
    }
    let key = crate::portal::job_link("https://www.linkedin.com/jobs/view/4123456789/")
        .unwrap()
        .key;
    let json = serde_json::to_value(&key).unwrap();
    let fields: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert_eq!(fields, ["id", "portal"]);
    let decl = JobKey::decl(&cfg);
    assert!(
        decl.contains("portal: Portal") && decl.contains("id: string"),
        "{decl}"
    );
}
