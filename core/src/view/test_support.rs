//! Test helpers the view modules share: a store with one job, a match record, an ad text.

use jiff::Timestamp;

use crate::model::{MatchRecord, MatchStatus, Posting};
use crate::portal::{JobKey, job_link};
use crate::store::{MailRef, Store};

pub(super) fn store_with(url: &str, title: &str, company: &str, location: &str) -> (Store, JobKey) {
    let store = Store::in_memory().unwrap();
    let run = store.begin_run().unwrap();
    let link = job_link(url).unwrap();
    let posting = Posting::new(link.key.clone(), link.url, title, company, location);
    let mail = MailRef {
        subject: "Neue Projekte",
        date: None,
        gmail_id: Some(0x1a2b),
    };
    store
        .upsert_posting(run, &posting, mail, Timestamp::now())
        .unwrap();
    (store, link.key)
}

pub(super) fn record(status: MatchStatus, score: u8) -> MatchRecord {
    MatchRecord {
        status,
        score,
        note: None,
        must_met: 1,
        must_total: 2,
        top: Vec::new(),
        facts: crate::model::KeyFacts::default(),
        rank: 0,
    }
}

pub(super) const AD: &str = "Wir suchen einen Interim CFO (m/w/d).

Anforderungen:
- Erfahrung im Controlling
- Konzernrechnungslegung nach IFRS
- Kenntnisse in Zollabwicklung

Rahmenbedingungen:
- Tagessatz bis 700 €
- Einsatzort Hamburg";

pub(super) fn job_with_text(text: &str) -> (Store, JobKey) {
    let (store, key) = store_with(
        "https://www.linkedin.com/jobs/view/4000000009/",
        "Interim CFO (m/w/d)",
        "Nordlicht AG",
        "Hamburg",
    );
    store
        .record_text(&key, text, false, false, Timestamp::now())
        .unwrap();
    (store, key)
}
