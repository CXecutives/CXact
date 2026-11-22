//! IPC v3: what the interface receives and sends - defined once here (and next to the run
//! types in `pipeline`), TypeScript types are generated from it (`view::ts`, tests only).
//!
//! Rules: camelCase, `null` instead of missing fields, data enums tagged with `kind`, never
//! prose - notices, states and errors are codes with data; the words live in the UI catalog.
//! Company and location are cleaned here (the database holds the raw mail values).

mod jobs;
mod profile;
mod reader;
mod settings;
mod state;
#[cfg(test)]
mod test_support;
#[cfg(test)]
pub(crate) mod ts;

pub use crate::mail::MailProvider;
pub use crate::matching::TermField;
pub use crate::profile::{
    LanguageLevel, ProfileAvailability, ProfileCompetence, ProfileForm, ProfileLanguage, WorkWish,
    Workload, WorkspaceProfile,
};
pub use jobs::*;
pub use profile::*;
pub use reader::*;
pub use settings::*;
pub use state::*;
