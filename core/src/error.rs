//! Errors of the core. `Display` texts are English and meant for logs only: the interface
//! receives an [`ErrorInfo`] (`{kind, params}`) and words it from its own catalog.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::fetch::PortalHealth;
use crate::mail::imap::MailError;
use crate::portal::Portal;
use crate::secrets::SecretError;

pub type Result<T, E = Error> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("database error: {0}")]
    Db(#[from] rusqlite::Error),

    /// The file is open elsewhere (typically in Excel on Windows) and cannot be replaced.
    #[error("file is locked by another program: {}", .0.display())]
    FileLocked(PathBuf),

    #[error("file {}: {source}", path.display())]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("cannot create the Excel file: {0}")]
    Xlsx(#[from] rust_xlsxwriter::XlsxError),

    #[error("stored data is corrupt: {0}")]
    Corrupt(String),

    /// The database comes from a newer version - not corrupt, just not readable.
    #[error("the database comes from a newer version of this app (schema {0})")]
    NewerSchema(i64),

    /// A copy of the database to restore that is not there (any more), by its name.
    #[error("backup {0} not found")]
    BackupMissing(String),

    /// A copy of the database to restore that is no readable database of this app.
    #[error("backup {name} is not a readable database: {detail}")]
    BackupCorrupt { name: String, detail: String },

    /// Input of the user that cannot be used.
    #[error("invalid input: {0}")]
    Invalid(InvalidInput),

    /// The fetch path of a portal could not be created (HTTP client, session window).
    #[error("fetching from {portal} is not possible: {detail}")]
    FetchUnavailable { portal: Portal, detail: String },
}

/// Why an input was refused - a code with data, never a sentence.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, thiserror::Error)]
#[serde(
    tag = "reason",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum InvalidInput {
    #[error("no portal is enabled")]
    NoPortal,
    #[error("the profile is not UTF-8 text")]
    ProfileNotUtf8,
    #[error("the profile is not valid JSON (line {line}, column {column})")]
    ProfileNotJson { line: usize, column: usize },
    /// `found`: `array`, `string`, `number`, `boolean` or `null`.
    #[error("the profile must be a JSON object, found {found}")]
    ProfileNotObject { found: String },
    /// A value of the profile form is out of range; `field` names it (`minDayRate`, ...),
    /// `row` the entry of a list of rows (`competences`, `languages`), counted from 0 without
    /// the empty rows, `max` the highest number (or count of entries) it takes, where one is
    /// the limit.
    #[error("the profile value {field} is out of range")]
    ProfileValue {
        field: String,
        row: Option<u32>,
        max: Option<u32>,
    },
    /// Not a complete e-mail address.
    #[error("not a complete mail address")]
    MailAddress,
    /// An app password is exactly 16 letters (not the normal account password).
    #[error("not an app password")]
    AppPassword,
    #[error("{portal} has no sign-in")]
    NoSignIn { portal: Portal },
}

/// Stable error codes for the interface (it reacts to these, never to a text).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum ErrorKind {
    Db,
    FileLocked,
    Io,
    Xlsx,
    Corrupt,
    NewerSchema,
    Invalid,
    /// A run or a sign-in window is active.
    Busy,
    NotFound,
    /// Not available in the dry run.
    DryRun,
    /// Not available in the demo (`--demo`, the `CXact Demo` build): its mailbox and portals
    /// are made up, it never touches a real mailbox, a portal or the vault and keeps to its
    /// own data folder.
    Demo,
    MailMissing,
    MailConnect,
    MailAuth,
    MailTimeout,
    MailLost,
    MailNotGmail,
    MailServer,
    MailCancelled,
    /// No connection to the internet: the name of the mail server did not resolve, or the
    /// network is down (`MailError::Offline`).
    Offline,
    SecretStore,
    SecretCorrupt,
    /// The fetch path of a portal could not be created.
    PortalUnavailable,
    /// The portal is paused (`params.until`, `params.reason`).
    PortalPaused,
    /// The hourly or daily cap of the portal is reached (`params.until`).
    PortalQuota,
    /// A crash inside the app; details are in the log.
    Internal,
}

/// An error as the interface sees it: a code plus data (paths, numbers, portal keys).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct ErrorInfo {
    pub kind: ErrorKind,
    #[cfg_attr(test, ts(type = "Record<string, string | number | boolean | null>"))]
    pub params: Map<String, Value>,
}

impl ErrorInfo {
    pub fn new(kind: ErrorKind) -> ErrorInfo {
        ErrorInfo {
            kind,
            params: Map::new(),
        }
    }

    /// Adds a parameter (only strings, numbers, booleans or null belong here).
    #[must_use]
    pub fn with(mut self, name: &str, value: impl Into<Value>) -> ErrorInfo {
        self.params.insert(name.to_string(), value.into());
        self
    }

    /// Adds `name`, the base name of `path` (`JobAlerts.xlsx`), unless the error has one:
    /// the page names the file without its folders.
    #[must_use]
    pub fn with_name_of(self, path: &Path) -> ErrorInfo {
        match path.file_name() {
            Some(name) if !self.params.contains_key("name") => {
                self.with("name", name.to_string_lossy().into_owned())
            }
            _ => self,
        }
    }

    /// "Not found" with what was looked for (`job`, `mail`, `folder`, `file`, `profile`).
    pub fn not_found(what: &str) -> ErrorInfo {
        ErrorInfo::new(ErrorKind::NotFound).with("what", what)
    }

    /// A portal that takes no request right now, as an error with the words of its health:
    /// `portalQuota` for a cap and `portalPaused` for everything else, each with `portal`,
    /// `until` (ISO 8601, `null` = until the next run) and `reason` (a `PauseReason` code, or
    /// `quota`, `loginRequired`, `layoutChanged`). The page says "ab 11:05 wieder möglich"
    /// from `until`; nothing continues by itself.
    pub fn portal_health(portal: Portal, health: &PortalHealth) -> ErrorInfo {
        let (kind, until, reason) = match health {
            PortalHealth::QuotaReached { until } => {
                (ErrorKind::PortalQuota, Some(*until), "quota".to_owned())
            }
            PortalHealth::Paused { until, reason } => {
                let code = match serde_json::to_value(reason) {
                    Ok(Value::String(code)) => code,
                    _ => String::new(),
                };
                (ErrorKind::PortalPaused, *until, code)
            }
            PortalHealth::LoginRequired => {
                (ErrorKind::PortalPaused, None, "loginRequired".to_owned())
            }
            PortalHealth::LayoutSuspect { .. } | PortalHealth::Ok => {
                (ErrorKind::PortalPaused, None, "layoutChanged".to_owned())
            }
        };
        ErrorInfo::new(kind)
            .with("portal", portal.key())
            .with("until", until.map(|at| at.to_string()))
            .with("reason", reason)
    }
}

impl Error {
    pub fn kind(&self) -> ErrorKind {
        match self {
            Error::Db(_) => ErrorKind::Db,
            Error::FileLocked(_) => ErrorKind::FileLocked,
            Error::Io { .. } => ErrorKind::Io,
            Error::Xlsx(_) => ErrorKind::Xlsx,
            Error::Corrupt(_) | Error::BackupCorrupt { .. } => ErrorKind::Corrupt,
            Error::NewerSchema(_) => ErrorKind::NewerSchema,
            Error::BackupMissing(_) => ErrorKind::NotFound,
            Error::Invalid(_) => ErrorKind::Invalid,
            Error::FetchUnavailable { .. } => ErrorKind::PortalUnavailable,
        }
    }

    /// Input/output error with path; a sharing or lock violation counts as "locked".
    /// The error numbers 32/33 are Windows-specific (they mean something else elsewhere).
    pub fn io(path: impl Into<PathBuf>, source: std::io::Error) -> Self {
        let path = path.into();
        if cfg!(windows) && matches!(source.raw_os_error(), Some(32 | 33)) {
            Error::FileLocked(path)
        } else {
            Error::Io { path, source }
        }
    }

    /// Error while replacing an existing file. If it is open in Excel, Windows only says
    /// "access denied" - so it counts as locked only if the file exists and is not
    /// read-only. Missing write permission stays an ordinary error; closing Excel would not
    /// help there. "Open in Excel" is a Windows peculiarity; elsewhere an open file does not
    /// prevent replacing it, and "access denied" has other causes.
    pub(crate) fn replace(path: &Path, source: std::io::Error) -> Self {
        let open_elsewhere = cfg!(windows)
            && source.kind() == std::io::ErrorKind::PermissionDenied
            && std::fs::metadata(path).is_ok_and(|m| m.is_file() && !m.permissions().readonly());
        if open_elsewhere {
            Error::FileLocked(path.to_path_buf())
        } else {
            Error::io(path, source)
        }
    }
}

impl From<&Error> for ErrorInfo {
    fn from(error: &Error) -> ErrorInfo {
        let info = ErrorInfo::new(error.kind());
        match error {
            // The path for the log and "show in folder", the base name for the words.
            Error::FileLocked(path) | Error::Io { path, .. } => info
                .with("path", path.display().to_string())
                .with_name_of(path),
            Error::NewerSchema(version) => info.with("schema", *version),
            // `what` names a backup, so the page says "the backup" and not "the app's data".
            Error::BackupMissing(name) | Error::BackupCorrupt { name, .. } => {
                info.with("what", "backup").with("name", name.as_str())
            }
            Error::Invalid(input) => ErrorInfo::from(input),
            Error::FetchUnavailable { portal, .. } => info.with("portal", portal.key()),
            Error::Db(_) | Error::Xlsx(_) | Error::Corrupt(_) => info,
        }
    }
}

impl From<&InvalidInput> for ErrorInfo {
    fn from(input: &InvalidInput) -> ErrorInfo {
        let params = match serde_json::to_value(input) {
            Ok(Value::Object(map)) => map,
            _ => Map::new(),
        };
        ErrorInfo {
            kind: ErrorKind::Invalid,
            params,
        }
    }
}

impl From<&MailError> for ErrorInfo {
    fn from(error: &MailError) -> ErrorInfo {
        ErrorInfo::new(error.kind())
    }
}

impl From<&SecretError> for ErrorInfo {
    fn from(error: &SecretError) -> ErrorInfo {
        match error {
            SecretError::Invalid(input) => ErrorInfo::from(input),
            other => ErrorInfo::new(other.kind()),
        }
    }
}

/// Handing an error to the interface: its English text goes to the log, the code to the
/// page.
impl From<Error> for ErrorInfo {
    fn from(error: Error) -> ErrorInfo {
        log::warn!("{error}");
        ErrorInfo::from(&error)
    }
}

impl From<MailError> for ErrorInfo {
    fn from(error: MailError) -> ErrorInfo {
        log::warn!("{error}");
        ErrorInfo::from(&error)
    }
}

impl From<SecretError> for ErrorInfo {
    fn from(error: SecretError) -> ErrorInfo {
        log::warn!("{error}");
        ErrorInfo::from(&error)
    }
}

impl From<InvalidInput> for Error {
    fn from(input: InvalidInput) -> Error {
        Error::Invalid(input)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn infos_are_codes_with_data() {
        let path = PathBuf::from("auswertung").join("JobAlerts.xlsx");
        let locked = ErrorInfo::from(&Error::FileLocked(path.clone()));
        assert_eq!(
            serde_json::to_value(&locked).unwrap(),
            serde_json::json!({"kind": "fileLocked",
                "params": {"path": path.display().to_string(), "name": "JobAlerts.xlsx"}})
        );
        let io = ErrorInfo::from(&Error::io(
            PathBuf::from("a").join("b.txt"),
            std::io::Error::other("x"),
        ));
        assert_eq!(
            (io.kind, &io.params["name"]),
            (ErrorKind::Io, &"b.txt".into())
        );
        assert_eq!(
            serde_json::to_value(ErrorInfo::not_found("job")).unwrap(),
            serde_json::json!({"kind": "notFound", "params": {"what": "job"}})
        );
        let invalid = ErrorInfo::from(&Error::Invalid(InvalidInput::ProfileNotJson {
            line: 3,
            column: 7,
        }));
        assert_eq!(
            serde_json::to_value(&invalid).unwrap(),
            serde_json::json!({"kind": "invalid",
                "params": {"reason": "profileNotJson", "line": 3, "column": 7}})
        );
        let portal = ErrorInfo::from(&Error::FetchUnavailable {
            portal: Portal::LinkedIn,
            detail: "no client".into(),
        });
        assert_eq!(portal.kind, ErrorKind::PortalUnavailable);
        assert_eq!(portal.params["portal"], "linkedin");
    }

    /// A portal that rests says until when and why, a cap as well as a pause: the page words
    /// "ab 11:05 wieder möglich" from `until`, and a pause until the next run has none.
    #[test]
    fn a_resting_portal_says_until_when_and_why() {
        use crate::fetch::policy::PauseReason;
        let at: jiff::Timestamp = "2026-09-26T09:05:00Z".parse().unwrap();
        let quota =
            ErrorInfo::portal_health(Portal::LinkedIn, &PortalHealth::QuotaReached { until: at });
        assert_eq!(
            serde_json::to_value(&quota).unwrap(),
            serde_json::json!({"kind": "portalQuota", "params": {
                "portal": "linkedin", "until": "2026-09-26T09:05:00Z", "reason": "quota"}})
        );
        let paused = ErrorInfo::portal_health(
            Portal::FreelanceDe,
            &PortalHealth::Paused {
                until: Some(at),
                reason: PauseReason::Blocked,
            },
        );
        assert_eq!(paused.kind, ErrorKind::PortalPaused);
        assert_eq!(paused.params["reason"], "blocked");
        assert_eq!(paused.params["until"], "2026-09-26T09:05:00Z");
        let next_run = ErrorInfo::portal_health(
            Portal::FreelanceDe,
            &PortalHealth::Paused {
                until: None,
                reason: PauseReason::Challenged,
            },
        );
        assert_eq!(next_run.params["until"], Value::Null);
        assert_eq!(next_run.params["reason"], "challenged");
        let login = ErrorInfo::portal_health(Portal::FreelanceDe, &PortalHealth::LoginRequired);
        assert_eq!(login.params["reason"], "loginRequired");
    }
}
