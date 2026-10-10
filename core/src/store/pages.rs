//! What the page parsers leave behind besides the text: the facts a page states
//! (`desc_facts`).

use rusqlite::{OptionalExtension, params};

use super::Store;
use crate::error::Result;
use crate::portal::{Facts, JobKey};

impl Store {
    /// The facts the job's page stated (`None` keeps the stored facts - a failed page states
    /// nothing).
    pub fn record_parse(&self, key: &JobKey, facts: Option<&Facts>) -> Result<()> {
        // A new page replaces the facts (none stated = none stored).
        let replace = facts.is_some();
        let json = facts
            .filter(|f| !f.is_empty())
            .map(|f| serde_json::to_string(f).expect("facts are always serialisable"));
        // Other facts judge the job anew (the engine reads them); SET sees the old values.
        self.conn().execute(
            "UPDATE job SET desc_facts = CASE WHEN ?3 THEN ?4 ELSE desc_facts END,
                            match_rev = CASE WHEN ?3 AND desc_facts IS NOT ?4 THEN NULL
                                             ELSE match_rev END
             WHERE portal = ?1 AND job_id = ?2",
            params![key.portal.key(), key.id, replace, json],
        )?;
        Ok(())
    }

    /// The facts the job page stated (unreadable JSON counts as none).
    pub fn facts(&self, key: &JobKey) -> Result<Option<Facts>> {
        let json: Option<String> = self
            .conn()
            .query_row(
                "SELECT desc_facts FROM job WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    }
}
