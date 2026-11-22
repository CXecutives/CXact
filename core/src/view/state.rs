//! The state the app hands the interface at the start, the targets and undo records of its
//! commands, and the alert mails of a run without recognised jobs.

use jiff::Timestamp;
use serde::{Deserialize, Serialize};

use super::MailProvider;
use super::jobs::JobCounts;
use super::profile::ProfileInfo;
use super::settings::{Mailbox, Platform, PortalState, SettingsView};
use crate::model::Place;
use crate::pipeline::{RunSnapshot, RunSummary};
use crate::portal::{JobKey, Portal};
use crate::store::AlertMailRow;

/// An alert mail of a run without recognised jobs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct EmptyAlert {
    pub portal: Portal,
    pub subject: String,
    pub date: Option<Timestamp>,
    /// Gmail message id (hexadecimal) - opened through `open_target`.
    pub gmail_id: Option<String>,
}

/// Longest subject an event or summary carries (in characters).
pub const MAX_SUBJECT_CHARS: usize = 160;

impl From<&AlertMailRow> for EmptyAlert {
    fn from(row: &AlertMailRow) -> EmptyAlert {
        EmptyAlert {
            portal: row.portal,
            subject: crate::text::truncate_chars(&row.subject, MAX_SUBJECT_CHARS),
            date: row.mail_date,
            gmail_id: row.gmail_id.map(|id| format!("{id:x}")),
        }
    }
}

/// Everything the interface needs at the start (and after a reload).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct AppState {
    pub platform: Platform,
    /// The app's version (`3.0.0`).
    pub version: String,
    pub dry_run: bool,
    /// The setup is not finished yet (`Settings::onboarded`; never in the dry run): the app
    /// shows the setup alone.
    pub first_run: bool,
    /// The run in progress (after a reload the interface picks up from here).
    pub running: Option<RunSnapshot>,
    pub settings: SettingsView,
    pub mailbox: Mailbox,
    /// The profile.
    pub profile: Option<ProfileInfo>,
    pub portals: Vec<PortalState>,
    /// The last fetch - a rescore or a details run is none.
    pub last_run: Option<RunSummary>,
    /// The day (`YYYY-MM-DD`, UTC) "Aus Lebenslauf ausfüllen" works again while its tries
    /// are used up (`ai::tries_until`); `null` while it works.
    pub cv_until: Option<String>,
    pub counts: JobCounts,
    pub match_pending: u32,
}

/// What `open_target` may open - never an arbitrary path or link from the page.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
#[cfg_attr(test, derive(ts_rs::TS))]
pub enum OpenTarget {
    JobUrl {
        key: JobKey,
    },
    /// The alert mail a job came from.
    Gmail {
        key: JobKey,
    },
    /// A new mail to the contact the ad names, the job's title as its subject (the default
    /// mail program).
    ContactMail {
        key: JobKey,
    },
    /// An alert mail by its Gmail id (e.g. one without recognised jobs).
    AlertMail {
        gmail_id: String,
    },
    /// Home page of a portal ("open in your own browser" after a block).
    PortalHome {
        portal: Portal,
    },
    /// The page where the user sets up a source's alert (`setup_url`).
    PortalSetup {
        portal: Portal,
    },
    /// The provider's page for the password CXact signs in with
    /// ([`MailProvider::password_page`]).
    PasswordPage {
        provider: MailProvider,
    },
    /// The app's data folder (database, settings, sessions).
    DataDir,
    Workspace,
    /// The folder of the profile file in the workspace (`profil`).
    ProfileDir,
}

/// A job an undo takes back to the place it came from (`move_back`).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct MoveBack {
    pub key: JobKey,
    pub to: Place,
    /// When the job went to the trash ([`JobView::trashed_at`]): back in the trash it keeps
    /// its date.
    pub trashed_at: Option<Timestamp>,
}

/// Result of a permanent delete of jobs.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[cfg_attr(test, derive(ts_rs::TS))]
pub struct Deleted {
    /// Jobs deleted, as the list showed them: one per row (a duplicate that stood behind a
    /// row went with it but does not count).
    pub count: u32,
    /// The keys of every row that went, duplicates included: the page drops them from lists,
    /// the reader and pending undos.
    pub keys: Vec<JobKey>,
}
