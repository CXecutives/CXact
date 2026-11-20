//! Duplicates: the same position announced more than once - by several agencies, by several
//! portals, or posted again under a new number - is one job. A job whose full text (or guest
//! teaser) arrives is compared with the other jobs that have one ([`same_job`]):
//!
//! - the same project by its number: a GULP project of SOLCOM names SOLCOM's project number
//!   first in its title ([`source_key`]);
//! - otherwise the same normalised title ([`title_key`]: no IDs, gender marks, place or
//!   duration tails, contract words; no company needed, agencies name none or their own)
//!   and texts whose word triples overlap by at least [`MIN_OVERLAP`] percent of the
//!   shorter one - a teaser is contained in its full text, an agency's copy shares most of
//!   the client's words. Within one portal (a repost) the places must meet too: one template
//!   for two cities is two jobs.
//!
//! The copies point to one original (`dup_of`): the richest copy ([`outranks`]), which alone
//! is listed and scored; the list shows one row with the other portals in `alsoOn`. Nothing
//! the user did is lost: the original takes the union of the copies' marks ([`merge_marks`]),
//! and an archived or trashed job is never merged at all.

use std::collections::{BTreeMap, HashSet};

use rusqlite::{OptionalExtension, params};

use super::Store;
use crate::error::Result;
use crate::portal::{JobKey, Portal};

/// Share (percent) of the shorter text's word triples the other text must contain.
const MIN_OVERLAP: usize = 80;
/// Fewest word triples the shorter text needs to be compared at all (a few words prove
/// nothing).
const MIN_TRIPLES: usize = 8;
/// A full text replaces the original's when it is at least this much longer (percent).
const RICHER_BY: usize = 125;

impl Store {
    /// Compares a job that just got its full text (or a guest's teaser) with every other job
    /// with a text and links it with the first (earliest seen) one that announces the same
    /// position: the richer of the two becomes (or stays) the original, the other one and
    /// every copy that pointed to it point to that one. A copy that is itself a duplicate
    /// leads to its original. Returns the original.
    ///
    /// An archived or trashed job is never linked, in either direction: its place would
    /// leave with it, or the fresh, open announcement would vanish behind it; a closed ad is
    /// never the original.
    pub fn link_duplicate(&self, key: &JobKey) -> Result<Option<JobKey>> {
        self.write(|conn| {
            let Some(own) = copy(conn, key)? else {
                return Ok(None);
            };
            if own.dup_of.is_some() || own.hidden {
                return Ok(None);
            }
            let own_title = title_key(&own.title);
            let own_source = source_key(&own);
            // Titles first (small), texts only for the few that may match.
            let mut stmt = conn.prepare_cached(
                "SELECT portal, job_id, title, company FROM job
                 WHERE NOT (portal = ?1 AND job_id = ?2)
                   AND desc_status IN ('ok', 'teaser') AND desc_text IS NOT NULL
                 ORDER BY first_seen_at, portal, job_id",
            )?;
            let candidates: Vec<JobKey> = stmt
                .query_map(params![key.portal.key(), key.id], |r| {
                    Ok((
                        r.get::<_, String>(0)?,
                        r.get::<_, String>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, String>(3)?,
                    ))
                })?
                .filter_map(std::result::Result::ok)
                .filter_map(|(portal, id, title, company)| {
                    let other = JobKey {
                        portal: Portal::from_key(&portal)?,
                        id,
                    };
                    let source = project_of(other.portal, &title, &company);
                    let related = (!own_title.is_empty() && title_key(&title) == own_title)
                        || own_source.as_ref() == Some(&other)
                        || source.as_ref() == Some(key)
                        || (own_source.is_some() && source == own_source);
                    related.then_some(other)
                })
                .collect();
            for other_key in candidates {
                let Some(other) = copy(conn, &other_key)? else {
                    continue;
                };
                if !same_job(&own, &other) {
                    continue;
                }
                // A copy that is a duplicate itself leads to its original.
                let root_key = other.dup_of.clone().unwrap_or(other_key);
                if &root_key == key {
                    continue;
                }
                let Some(root) = copy(conn, &root_key)? else {
                    continue;
                };
                if root.dup_of.is_some() || root.hidden || root.closed {
                    continue;
                }
                let (original, duplicate) = if outranks(&own, &root) && !own.closed {
                    (key, &root_key)
                } else {
                    (&root_key, key)
                };
                link(conn, duplicate, original)?;
                merge_marks(conn, original, duplicate)?;
                return Ok(Some(original.clone()));
            }
            Ok(None)
        })
    }

    /// The job this one duplicates, if any.
    pub fn dup_of(&self, key: &JobKey) -> Result<Option<JobKey>> {
        let text: Option<String> = self
            .conn()
            .query_row(
                "SELECT dup_of FROM job WHERE portal = ?1 AND job_id = ?2",
                params![key.portal.key(), key.id],
                |r| r.get(0),
            )
            .optional()?
            .flatten();
        Ok(text.as_deref().and_then(JobKey::parse))
    }

    /// Per job: the other portals that announced the same job (`alsoOn`), for the given
    /// jobs; jobs without duplicates are left out.
    pub fn also_on(&self, keys: &[&JobKey]) -> Result<BTreeMap<JobKey, Vec<Portal>>> {
        let conn = self.conn();
        let mut stmt = conn.prepare_cached(
            "SELECT dup_of, portal FROM job WHERE dup_of IS NOT NULL ORDER BY portal",
        )?;
        let rows = stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?;
        let mut out: BTreeMap<JobKey, Vec<Portal>> = BTreeMap::new();
        for row in rows {
            let (original, portal) = row?;
            let (Some(original), Some(portal)) =
                (JobKey::parse(&original), Portal::from_key(&portal))
            else {
                continue;
            };
            // The same portal under a second key (a slug link, a repost) is no other portal.
            if keys.contains(&&original) && portal != original.portal {
                let portals = out.entry(original).or_default();
                if !portals.contains(&portal) {
                    portals.push(portal);
                }
            }
        }
        Ok(out)
    }
}

/// One announcement as the comparison reads it.
#[derive(Debug, Clone)]
struct Copy {
    key: JobKey,
    title: String,
    company: String,
    location: String,
    text: String,
    /// Only a guest's teaser, not the full text.
    teaser: bool,
    closed: bool,
    /// In the archive or the trash.
    hidden: bool,
    dup_of: Option<JobKey>,
}

/// A job with a text (a full text or a teaser).
fn copy(conn: &rusqlite::Connection, key: &JobKey) -> Result<Option<Copy>> {
    Ok(conn
        .query_row(
            "SELECT title, company, location, desc_text, desc_status = 'teaser', desc_closed,
                    archived_at IS NOT NULL OR trashed_at IS NOT NULL, dup_of
             FROM job
             WHERE portal = ?1 AND job_id = ?2 AND desc_text IS NOT NULL
               AND desc_status IN ('ok', 'teaser')",
            params![key.portal.key(), key.id],
            |r| {
                Ok(Copy {
                    key: key.clone(),
                    title: r.get(0)?,
                    company: r.get(1)?,
                    location: r.get(2)?,
                    text: r.get(3)?,
                    teaser: r.get(4)?,
                    closed: r.get(5)?,
                    hidden: r.get(6)?,
                    dup_of: r
                        .get::<_, Option<String>>(7)?
                        .as_deref()
                        .and_then(JobKey::parse),
                })
            },
        )
        .optional()?)
}

/// Do the two announce the same position? By the project's number, else by the normalised
/// title and the overlap of the texts; within one portal the places must meet too.
fn same_job(a: &Copy, b: &Copy) -> bool {
    if a.key == b.key {
        return false;
    }
    let (source_a, source_b) = (source_key(a), source_key(b));
    if source_a.as_ref() == Some(&b.key)
        || source_b.as_ref() == Some(&a.key)
        || (source_a.is_some() && source_a == source_b)
    {
        return true;
    }
    let title = title_key(&a.title);
    if title.is_empty() || title != title_key(&b.title) {
        return false;
    }
    if a.key.portal == b.key.portal && !places_meet(&a.location, &b.location) {
        return false;
    }
    overlaps(&a.text, &b.text)
}

/// Is `a` the richer copy, the one to list and score? A full text before a teaser, within
/// one portal the key with the portal's id before a slug link's, then a text at least a
/// quarter longer; the earlier one otherwise.
fn outranks(a: &Copy, b: &Copy) -> bool {
    if a.teaser != b.teaser {
        return b.teaser;
    }
    if a.key.portal == b.key.portal && a.key.has_portal_id() != b.key.has_portal_id() {
        return a.key.has_portal_id();
    }
    let length = |copy: &Copy| copy.text.chars().count();
    length(a) * 100 >= length(b) * RICHER_BY
}

/// The project a copy announces by its number at its source: GULP lists SOLCOM's projects
/// with SOLCOM's number first in the title.
fn source_key(copy: &Copy) -> Option<JobKey> {
    project_of(copy.key.portal, &copy.title, &copy.company)
}

fn project_of(portal: Portal, title: &str, company: &str) -> Option<JobKey> {
    if portal != Portal::Gulp || !company.to_lowercase().contains("solcom") {
        return None;
    }
    let number: String = title
        .trim_start()
        .chars()
        .take_while(char::is_ascii_digit)
        .collect();
    (number.len() >= 6).then_some(JobKey {
        portal: Portal::Solcom,
        id: number,
    })
}

/// Do the overlapping texts announce the same ad? At least [`MIN_OVERLAP`] percent of the
/// shorter text's word triples are in the other one.
fn overlaps(a: &str, b: &str) -> bool {
    let (a, b) = (triples(a), triples(b));
    let (small, large) = if a.len() <= b.len() { (a, b) } else { (b, a) };
    if small.len() < MIN_TRIPLES {
        return false;
    }
    let hits = small.iter().filter(|t| large.contains(*t)).count();
    hits * 100 >= small.len() * MIN_OVERLAP
}

/// The word triples of a text (lower case, letters and digits only).
fn triples(text: &str) -> HashSet<String> {
    let lower = text.to_lowercase();
    let words: Vec<&str> = lower
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .collect();
    words.windows(3).map(|w| w.join(" ")).collect()
}

/// `key` goes into `original`'s row, and so does every copy that pointed to `key`: their own
/// scores are gone for good (never scored again, never listed on their own).
fn link(conn: &rusqlite::Connection, key: &JobKey, original: &JobKey) -> Result<()> {
    conn.execute(
        "UPDATE job SET dup_of = ?1 WHERE dup_of = ?2",
        params![original.to_string(), key.to_string()],
    )?;
    conn.execute(
        "UPDATE job SET dup_of = ?3, match_score = NULL, match_status = NULL,
                        match_note = NULL, match_at = NULL, match_rev = NULL
         WHERE portal = ?1 AND job_id = ?2",
        params![key.portal.key(), key.id, original.to_string()],
    )?;
    Ok(())
}

/// The original keeps the union of what the user and the files had of both copies: read
/// stays read (the earlier time), "fits anyway" stays, the job counts from its first
/// sighting - so "Neu", the run card's new jobs and the age that archives it treat it as the
/// job the user already saw - and a move back into the inbox keeps counting from then (the
/// later one). The duplicate's own marks stay on its row too.
fn merge_marks(conn: &rusqlite::Connection, original: &JobKey, other: &JobKey) -> Result<()> {
    struct Kept {
        read_at: Option<i64>,
        first_seen_at: i64,
        first_seen_run: i64,
        inbox_at: Option<i64>,
        include: bool,
    }
    let kept = |key: &JobKey| {
        conn.query_row(
            "SELECT read_at, first_seen_at, first_seen_run, inbox_at,
                    override_include IS NOT NULL
             FROM job WHERE portal = ?1 AND job_id = ?2",
            params![key.portal.key(), key.id],
            |r| {
                Ok(Kept {
                    read_at: r.get(0)?,
                    first_seen_at: r.get(1)?,
                    first_seen_run: r.get(2)?,
                    inbox_at: r.get(3)?,
                    include: r.get(4)?,
                })
            },
        )
    };
    let (new, old) = (kept(original)?, kept(other)?);
    let read_at = match (new.read_at, old.read_at) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (a, b) => a.or(b),
    };
    let inbox_at = match (new.inbox_at, old.inbox_at) {
        (Some(a), Some(b)) => Some(a.max(b)),
        (a, b) => a.or(b),
    };
    conn.execute(
        "UPDATE job SET read_at = ?3, first_seen_at = ?4, first_seen_run = ?5,
                        inbox_at = ?6,
                        override_include = CASE WHEN ?7 THEN 1 ELSE override_include END,
                        match_status = CASE WHEN ?7 AND match_status = 'excluded'
                                            THEN 'scored' ELSE match_status END
         WHERE portal = ?1 AND job_id = ?2",
        params![
            original.portal.key(),
            original.id,
            read_at,
            new.first_seen_at.min(old.first_seen_at),
            new.first_seen_run.min(old.first_seen_run),
            inbox_at,
            old.include,
        ],
    )?;
    Ok(())
}

/// Within one portal, do the two places name a common place? An empty place or one that
/// names only remote work meets every place.
fn places_meet(a: &str, b: &str) -> bool {
    // German and English place words that name no place, do not translate.
    const NO_PLACE: &[&str] = &[
        "remote",
        "home",
        "office",
        "homeoffice",
        "hybrid",
        "mobil",
        "raum",
        "grossraum",
        "region",
        "und",
        "and",
        "oder",
        "or",
        "bei",
        "near",
        "deutschland",
        "germany",
        "de",
        "dach",
        "bundesweit",
        "deutschlandweit",
        "europa",
        "europe",
        "freiberuflich",
        "vor",
        "ort",
        "onsite",
        "im",
        "monat",
        "x",
        "1x",
    ];
    let places = |text: &str| -> HashSet<String> {
        fold(text)
            .split(|c: char| !c.is_alphanumeric())
            .filter(|w| w.len() > 1 && !w.bytes().all(|b| b.is_ascii_digit()))
            .filter(|w| !NO_PLACE.contains(w))
            .map(str::to_owned)
            .collect()
    };
    let (a, b) = (places(a), places(b));
    a.is_empty() || b.is_empty() || !a.is_disjoint(&b)
}

// German and English job ad words, do not translate.
const GENDER: &[&str] = &[
    "m", "w", "d", "f", "x", "i", "div", "divers", "all", "genders", "gn", "mwd", "wmd", "mfd",
    "fmd", "dmw", "mwx",
];
const CONTRACT: &[&str] = &[
    "interim",
    "freelance",
    "freelancer",
    "freiberuflich",
    "freiberufler",
    "contract",
    "contractor",
    "befristet",
    "unbefristet",
    "teilzeit",
    "vollzeit",
    "remote",
    "hybrid",
    "homeoffice",
    "onsite",
    "projekteinsatz",
    "anue",
    "ref",
    "nr",
    "id",
    "job",
    "amp",
    "nbsp",
];
// Words of a tail that names no part of the role.
const TAIL: &[&str] = &[
    "remote",
    "hybrid",
    "vor",
    "ort",
    "und",
    "and",
    "monate",
    "monat",
    "months",
    "month",
    "wochen",
    "weeks",
    "jahre",
    "years",
    "ab",
    "sofort",
    "asap",
    "start",
    "bis",
    "zu",
    "von",
    "mit",
    "in",
    "im",
    "the",
    "auf",
    "nur",
    "fest",
    "angestellte",
    "mitarbeiter",
    "mgl",
    "moeglich",
    "possible",
    "ueberwiegend",
    "mostly",
    "full",
    "fully",
    "teilweise",
    "deutschland",
    "germany",
    "bundesweit",
    "dach",
    "onsite",
    "homeoffice",
    "freelance",
    "interim",
    "freiberuflich",
    "contract",
    "teilzeit",
    "vollzeit",
    "region",
    "raum",
];

/// The title as every agency words it alike: lower case, umlauts spelled out, words only;
/// without IDs and project numbers, gender marks, a tail after a bar (`| Ort | Dauer`), a
/// tail after a dash that names only place, time, share or contract, and contract words.
fn title_key(title: &str) -> String {
    let head = fold(title.split('|').next().unwrap_or_default()).replace('\u{a0}', " ");
    let words = |part: &str| -> Vec<String> {
        part.split(|c: char| !c.is_alphanumeric())
            .filter(|w| !w.is_empty())
            .map(str::to_owned)
            .collect()
    };
    let numeric = |w: &str| w.bytes().filter(u8::is_ascii_digit).count() >= 4;
    let mut kept: Vec<String> = Vec::new();
    for (index, part) in head
        .split(" - ")
        .flat_map(|part| part.split(" \u{2013} "))
        .flat_map(|part| part.split(" \u{2014} "))
        .enumerate()
    {
        let part_words = words(part);
        let noise = |w: &String| {
            TAIL.contains(&w.as_str())
                || w.bytes().all(|b| b.is_ascii_digit())
                || numeric(w)
                || GENDER.contains(&w.as_str())
        };
        if index > 0 && part_words.iter().all(noise) {
            continue;
        }
        kept.extend(part_words);
    }
    kept.retain(|w| {
        !GENDER.contains(&w.as_str()) && !CONTRACT.contains(&w.as_str()) && !numeric(w)
    });
    kept.join(" ")
}

/// Lower case with the umlauts spelled out (`fuer` and `für` alike) and HTML's dashes and
/// ampersands as text.
fn fold(text: &str) -> String {
    text.replace("&#8211;", "\u{2013}")
        .replace("&amp;", "&")
        .to_lowercase()
        .replace('\u{e4}', "ae")
        .replace('\u{f6}', "oe")
        .replace('\u{fc}', "ue")
        .replace('\u{df}', "ss")
}

#[cfg(test)]
mod tests {
    use super::*;

    const TEXT: &str = "Für unseren Kunden suchen wir einen erfahrenen SAP FI/CO Berater. \
        Aufgaben: Einführung von S/4HANA Finance, Abstimmung mit den Fachbereichen, Konzeption \
        der Hauptbuchhaltung und Anlagenbuchhaltung, Schulung der Key User. Profil: mehrjährige \
        Projekterfahrung im Controlling, sehr gute Deutschkenntnisse, Reisebereitschaft.";

    const OTHER: &str = "Wir suchen eine Projektleitung für den Rollout eines \
        Warenwirtschaftssystems in 40 Filialen. Aufgaben: Planung, Steuerung der Dienstleister, \
        Berichtswesen an die Geschäftsführung. Profil: Erfahrung im Handel und in agilen \
        Methoden.";

    #[test]
    fn the_same_job_reads_alike() {
        let same = |a: &str, b: &str| title_key(a) == title_key(b);
        assert!(same(
            "SAP FI/CO Berater (m/w/d)",
            "SAP FI/CO-Berater (w/m/d)"
        ));
        assert!(same(
            "1083881 Power Platform Entwickler",
            "Power Platform Entwickler"
        ));
        assert!(same(
            "Risk Manager Medical Devices (m/w/d) | 100% remote | Teilzeit",
            "Risk Manager Medical Devices"
        ));
        assert!(same(
            "Interim Projektcontroller (m/w/d) - remote",
            "Projektcontroller"
        ));
        assert!(same("Manager f\u{fc}r Einkauf", "Manager fuer Einkauf"));
        assert!(same(
            "***** Application Manager Lovion",
            "Application Manager Lovion"
        ));
        assert!(same(
            "SAP TM Lead Consultant POS77281",
            "SAP TM Lead Consultant"
        ));
        assert!(!same("SAP FI/CO Berater (m/w/d)", "SAP MM Berater (m/w/d)"));
        assert!(!same(
            "Consultant AI Strategy - Financial Services",
            "Consultant AI Strategy - Data Infrastructure"
        ));
        assert_eq!(title_key("(m/w/d)"), "");
    }

    #[test]
    fn near_identical_texts_overlap_and_others_not() {
        assert!(overlaps(TEXT, &TEXT.to_uppercase()), "case does not count");
        let edited = TEXT.replace("Reisebereitschaft", "Reisebereitschaft (20 %)");
        assert!(overlaps(TEXT, &edited));
        let agency = format!(
            "{TEXT}\n\nIhre Vorteile: ein kurzer Draht, faire Konditionen, schnelle Entscheidungen."
        );
        assert!(
            overlaps(&agency, TEXT),
            "an agency's copy with its own lines"
        );
        assert!(!overlaps(TEXT, OTHER));
    }

    /// Within one portal the places must meet: one template for two cities is two jobs.
    #[test]
    fn places_meet_unless_they_name_two_places() {
        assert!(places_meet("Hamburg", "22767 Hamburg"));
        assert!(places_meet("Remote", "Hamburg"));
        assert!(places_meet("", "Berlin"));
        assert!(places_meet("Remote / Regensburg", "Regensburg"));
        assert!(!places_meet("Dresden", "Braunschweig"));
    }

    /// A job scored before it turned out to be a duplicate: its score goes, and the top
    /// lists show the job once (as the original).
    #[test]
    fn a_duplicate_loses_its_score_and_shows_once() {
        use crate::model::{MatchRecord, MatchStatus};
        use crate::store::test_support::{mail, now, posting};

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let first = posting(
            "https://www.freelancermap.de/nproj/12345.html",
            "SAP FI/CO Berater (m/w/d)",
            "Ferrum Systems SE",
            "Hamburg",
        );
        let second = posting(
            "https://www.linkedin.com/jobs/view/4000000001/",
            "SAP FI/CO Berater (m/w/d)",
            "Ferrum Systems SE",
            "Hamburg",
        );
        let record = MatchRecord {
            status: MatchStatus::Scored,
            score: 80,
            note: None,
            must_met: 1,
            must_total: 1,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        for p in [&first, &second] {
            store.upsert_posting(run, p, mail(), now()).unwrap();
            store
                .record_text(&p.key, TEXT, false, false, now())
                .unwrap();
            store
                .save_matches(&[(p.key.clone(), record.clone())], "r1", now())
                .unwrap();
        }
        assert_eq!(
            store.link_duplicate(&second.key).unwrap(),
            Some(first.key.clone())
        );
        let dup = store.job(&second.key).unwrap().unwrap();
        assert_eq!((dup.match_, dup.match_rev), (None, None), "no stale score");
        // The reader's fresh score (compare and set on "never scored") skips it too.
        assert!(
            !store
                .save_match_if(&second.key, &record.clone().into(), "r2", None, now())
                .unwrap()
        );
        let dup = store.job(&second.key).unwrap().unwrap();
        assert_eq!((dup.match_, dup.match_rev), (None, None), "still unscored");
        let keys = |jobs: Vec<crate::store::JobRow>| -> Vec<JobKey> {
            jobs.into_iter().map(|j| j.key).collect()
        };
        let listed = crate::store::JobFilter {
            listed: true,
            ..crate::store::JobFilter::default()
        };
        let rows = keys(store.jobs(&listed).unwrap());
        assert_eq!(rows, [first.key], "the original's row stands for it");
    }

    /// A job in the archive or the trash is never merged (its place would leave with it);
    /// "fits anyway" and read merge: the original keeps both.
    #[test]
    fn no_mark_is_lost_in_a_merge() {
        use crate::model::Place;
        use crate::store::test_support::{mail, now, posting};
        type Mark<'a> = &'a dyn Fn(&JobKey);

        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let original = posting(
            "https://www.freelancermap.de/nproj/12345.html",
            "SAP FI/CO Berater (m/w/d)",
            "Ferrum Systems SE",
            "Hamburg",
        );
        store.upsert_posting(run, &original, mail(), now()).unwrap();
        store
            .record_text(&original.key, TEXT, false, false, now())
            .unwrap();
        let marks: [(&str, Mark<'_>); 2] = [
            ("4000000002", &|key| {
                store
                    .move_jobs(std::slice::from_ref(key), Place::Trash, now())
                    .unwrap();
            }),
            ("4000000003", &|key| {
                store
                    .move_jobs(std::slice::from_ref(key), Place::Archive, now())
                    .unwrap();
            }),
        ];
        let add = |id: &str| {
            let p = posting(
                &format!("https://www.linkedin.com/jobs/view/{id}/"),
                "SAP FI/CO Berater (m/w/d)",
                "",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        for (id, mark) in marks {
            let later = add(id);
            mark(&later);
            store
                .record_text(&later, TEXT, false, false, now())
                .unwrap();
            assert_eq!(store.link_duplicate(&later).unwrap(), None, "{id}");
            assert_eq!(store.dup_of(&later).unwrap(), None);
            let place = store.job(&later).unwrap().unwrap().place();
            assert_ne!(place, Place::Inbox, "{id} stays where it lay");
        }
        // "Fits anyway" and read on the copy: the original keeps both.
        let later = add("4000000005");
        store.set_override(&later, true).unwrap();
        let read = now() - jiff::SignedDuration::from_hours(5);
        assert!(store.mark_read(&later, read).unwrap());
        store
            .record_text(&later, TEXT, false, false, now())
            .unwrap();
        assert_eq!(
            store.link_duplicate(&later).unwrap(),
            Some(original.key.clone())
        );
        let job = store.job(&original.key).unwrap().unwrap();
        assert!(job.override_include, "fits anyway carries over");
        assert_eq!(job.read_at, Some(read), "read stays read");
        let copy = store.job(&later).unwrap().unwrap();
        assert!(copy.override_include, "the copy keeps its own marks too");
        assert_eq!(copy.read_at, Some(read));
    }

    /// Several agencies post the same position, without a company or each with its own:
    /// one job, and the richer copy is the one listed and scored - with the marks of both.
    #[test]
    fn the_richer_copy_of_several_agencies_is_the_original() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str, company: &str| {
            let p = posting(url, "SAP FI/CO Berater (m/w/d)", company, "Hamburg");
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        let plain = add("https://www.gulp.de/gulp2/g/projekte/agentur/C01329404", "");
        store
            .record_text(&plain, TEXT, false, false, now())
            .unwrap();
        assert_eq!(store.link_duplicate(&plain).unwrap(), None);
        let read = now() - jiff::SignedDuration::from_hours(3);
        assert!(store.mark_read(&plain, read).unwrap());
        let rich = add(
            "https://www.freelancermap.de/nproj/2971857.html",
            "Ferrum Systems SE",
        );
        let longer = format!(
            "{TEXT}\n\nRahmendaten: Start im November, Auslastung 100 %, Dauer zwölf Monate, \
             Einsatzort Hamburg mit zwei Tagen vor Ort pro Woche, Abrechnung nach Stunden, \
             Verlängerung möglich, Ansprechpartner im Fachbereich Finanzen."
        );
        store
            .record_text(&rich, &longer, false, false, now())
            .unwrap();
        assert_eq!(store.link_duplicate(&rich).unwrap(), Some(rich.clone()));
        assert_eq!(store.dup_of(&plain).unwrap(), Some(rich.clone()));
        let job = store.job(&rich).unwrap().unwrap();
        assert_eq!(
            job.read_at,
            Some(read),
            "the user read it as the other copy"
        );
        assert_eq!(
            store.also_on(&[&rich]).unwrap().remove(&rich),
            Some(vec![Portal::Gulp])
        );
        // A third copy leads to the original, not to the copy it reads like.
        let third = add("https://www.linkedin.com/jobs/view/4000000007/", "");
        store
            .record_text(&third, TEXT, false, false, now())
            .unwrap();
        assert_eq!(store.link_duplicate(&third).unwrap(), Some(rich));
    }

    /// GULP lists SOLCOM's projects with SOLCOM's number first in the title: one job with
    /// SOLCOM's own ad, however short GULP's text.
    #[test]
    fn a_partner_s_project_is_one_job_by_its_number() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let solcom = posting(
            "https://www.solcom.de/fuer-freiberufler/projektliste/1083900-azure-architekt",
            "Azure Architekt",
            "",
            "Remote",
        );
        let gulp = posting(
            "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43a340b5a3a29f35d9c0",
            "1083900 Azure Architekt",
            "SOLCOM GmbH",
            "Remote",
        );
        let other = posting(
            "https://www.gulp.de/gulp2/g/projekte/talentfinder/6abd43a340b5a3a29f35d9c1",
            "1083901 Azure Architekt",
            "SOLCOM GmbH",
            "Remote",
        );
        for p in [&gulp, &solcom, &other] {
            store.upsert_posting(run, p, mail(), now()).unwrap();
        }
        let short = "Unser Kunde sucht einen Azure Architekten.";
        store
            .record_text(&gulp.key, short, false, false, now())
            .unwrap();
        store
            .record_text(&solcom.key, TEXT, false, false, now())
            .unwrap();
        assert_eq!(
            store.link_duplicate(&solcom.key).unwrap(),
            Some(solcom.key.clone())
        );
        assert_eq!(store.dup_of(&gulp.key).unwrap(), Some(solcom.key.clone()));
        store
            .record_text(&other.key, OTHER, false, false, now())
            .unwrap();
        assert_eq!(
            store.link_duplicate(&other.key).unwrap(),
            None,
            "another number"
        );
    }

    /// The jobs a term brought fit as their original does: a duplicate counts once, through
    /// the job it stands behind.
    #[test]
    fn fitting_follows_the_original() {
        use crate::model::{MatchRecord, MatchStatus};
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str| {
            let p = posting(url, "SAP FI/CO Berater (m/w/d)", "", "Hamburg");
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            store
                .record_text(&p.key, TEXT, false, false, now())
                .unwrap();
            p.key
        };
        let first = add("https://www.freelancermap.de/nproj/12345.html");
        let second = add("https://www.linkedin.com/jobs/view/4000000001/");
        assert_eq!(store.link_duplicate(&second).unwrap(), Some(first.clone()));
        let record = MatchRecord {
            status: MatchStatus::Scored,
            score: 80,
            note: None,
            must_met: 1,
            must_total: 1,
            top: Vec::new(),
            facts: crate::model::KeyFacts::default(),
            rank: 0,
        };
        store
            .save_matches(&[(first.clone(), record)], "r1", now())
            .unwrap();
        assert_eq!(store.fitting(std::slice::from_ref(&second)).unwrap(), 1);
        assert_eq!(store.fitting(&[first, second]).unwrap(), 1, "once");
    }

    /// The start of the ad, as freelance.de shows it to a guest.
    fn teaser_of(text: &str) -> String {
        text.chars().take(260).collect()
    }

    #[test]
    fn a_teaser_is_contained_in_its_full_text_only() {
        assert!(overlaps(&teaser_of(TEXT), TEXT));
        assert!(!overlaps(&teaser_of(TEXT), OTHER));
        assert!(!overlaps("Für unseren Kunden", TEXT), "too little to tell");
    }

    /// freelance.de as a guest gives teasers: the same project on another portal with its
    /// full text is one row, and the listed row is the one with the full text - whichever
    /// arrived first.
    #[test]
    fn a_teaser_points_to_the_full_text_whichever_came_first() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        // The full text first, the teaser later.
        let full = add("https://www.freelancermap.de/nproj/12345.html");
        store.record_text(&full, TEXT, false, false, now()).unwrap();
        let teaser = add("https://www.freelance.de/project/index.php?id=1255067");
        store
            .record_teaser(&teaser, &teaser_of(TEXT), now())
            .unwrap();
        assert_eq!(store.link_duplicate(&teaser).unwrap(), Some(full.clone()));
        assert_eq!(store.dup_of(&teaser).unwrap(), Some(full));
    }

    #[test]
    fn a_full_text_after_its_teaser_becomes_the_original() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        let teaser = add("https://www.freelance.de/project/index.php?id=1255068");
        store
            .record_teaser(&teaser, &teaser_of(TEXT), now())
            .unwrap();
        assert_eq!(store.link_duplicate(&teaser).unwrap(), None);
        let full = add("https://www.linkedin.com/jobs/view/4000000009/");
        store.record_text(&full, TEXT, false, false, now()).unwrap();
        assert_eq!(store.link_duplicate(&full).unwrap(), Some(full.clone()));
        assert_eq!(store.dup_of(&teaser).unwrap(), Some(full.clone()));
        assert_eq!(
            store.dup_of(&full).unwrap(),
            None,
            "the full text is listed"
        );
    }

    /// The full text that takes a read teaser's place is the job the user already saw: it
    /// stays read, keeps its first sighting and is no new job of the run that brought it.
    #[test]
    fn the_new_original_keeps_what_the_user_saw() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let earlier = now() - jiff::SignedDuration::from_hours(48);
        let add = |url: &str, run: i64, at| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), at).unwrap();
            p.key
        };
        let first_run = store.begin_run().unwrap();
        let teaser = add(
            "https://www.freelance.de/project/index.php?id=1255068",
            first_run,
            earlier,
        );
        store
            .record_teaser(&teaser, &teaser_of(TEXT), earlier)
            .unwrap();
        assert!(store.mark_read(&teaser, earlier).unwrap());
        let run = store.begin_run().unwrap();
        let full = add("https://www.linkedin.com/jobs/view/4000000009/", run, now());
        store.record_text(&full, TEXT, false, false, now()).unwrap();
        assert_eq!(store.link_duplicate(&full).unwrap(), Some(full.clone()));
        let job = store.job(&full).unwrap().unwrap();
        assert_eq!(job.read_at, Some(earlier), "read stays read");
        assert_eq!(
            (job.first_seen_at, job.first_seen_run),
            (earlier, first_run),
            "its first sighting"
        );
        assert_eq!(
            store.new_jobs(run).unwrap(),
            (0, 0, 0),
            "no new job of the run"
        );
    }

    /// A teaser the user brought back into the inbox keeps her choice when its full text
    /// takes its place: the new original stands in the inbox.
    #[test]
    fn the_new_original_keeps_a_move_back_into_the_inbox() {
        use crate::model::Place;
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let days = |n: i64| now() - jiff::SignedDuration::from_hours(24 * n);
        let add = |url: &str, run: i64, at| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), at).unwrap();
            p.key
        };
        let first_run = store.begin_run().unwrap();
        let teaser = add(
            "https://www.freelance.de/project/index.php?id=1255068",
            first_run,
            days(40),
        );
        store
            .record_teaser(&teaser, &teaser_of(TEXT), days(40))
            .unwrap();
        let one = std::slice::from_ref(&teaser);
        store.move_jobs(one, Place::Archive, days(10)).unwrap();
        store.move_jobs(one, Place::Inbox, days(2)).unwrap();
        let run = store.begin_run().unwrap();
        let full = add("https://www.linkedin.com/jobs/view/4000000009/", run, now());
        store.record_text(&full, TEXT, false, false, now()).unwrap();
        assert_eq!(store.link_duplicate(&full).unwrap(), Some(full.clone()));
        assert_eq!(store.job(&full).unwrap().unwrap().place(), Place::Inbox);
    }

    /// freelancermap's `/projekt/<slug>` link carries no id, its alerts link `/nproj/<id>`:
    /// the same project under two keys is one row - the one with the portal's id - in
    /// either order; two different projects of the portal never merge.
    #[test]
    fn a_slug_link_and_an_id_link_of_one_project_are_one_row() {
        use crate::store::test_support::{mail, now, posting};
        for id_first in [true, false] {
            let store = Store::in_memory().unwrap();
            let run = store.begin_run().unwrap();
            let add = |url: &str| {
                let p = posting(
                    url,
                    "SAP FI/CO Berater (m/w/d)",
                    "Ferrum Systems SE",
                    "Hamburg",
                );
                store.upsert_posting(run, &p, mail(), now()).unwrap();
                store
                    .record_text(&p.key, TEXT, false, false, now())
                    .unwrap();
                p.key
            };
            let (id, slug) = if id_first {
                let id = add("https://www.freelancermap.de/nproj/2971857.html");
                (
                    id,
                    add("https://www.freelancermap.de/projekt/sap-fi-co-berater-m-w-d"),
                )
            } else {
                let slug = add("https://www.freelancermap.de/projekt/sap-fi-co-berater-m-w-d");
                (add("https://www.freelancermap.de/nproj/2971857.html"), slug)
            };
            assert!(!slug.has_portal_id());
            let later = if id_first { &slug } else { &id };
            assert_eq!(store.link_duplicate(later).unwrap(), Some(id.clone()));
            assert_eq!(store.dup_of(&slug).unwrap(), Some(id.clone()), "{id_first}");
            assert_eq!(store.dup_of(&id).unwrap(), None);
            assert!(store.also_on(&[&id]).unwrap().is_empty(), "no other portal");
        }
        // The same project posted again under a new number: one job - unless the places
        // differ (one template for two cities).
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let mut first = None;
        for (url, place, original) in [
            (
                "https://www.freelancermap.de/nproj/2971857.html",
                "Hamburg",
                None,
            ),
            (
                "https://www.freelancermap.de/nproj/2971858.html",
                "Hamburg",
                Some(0),
            ),
            (
                "https://www.freelancermap.de/nproj/2971859.html",
                "Dresden",
                None,
            ),
        ] {
            let p = posting(url, "SAP FI/CO Berater (m/w/d)", "Ferrum Systems SE", place);
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            store
                .record_text(&p.key, TEXT, false, false, now())
                .unwrap();
            let expected = original.and(first.clone());
            assert_eq!(store.link_duplicate(&p.key).unwrap(), expected, "{url}");
            first.get_or_insert(p.key);
        }
    }

    /// An archived or closed original never swallows a fresh announcement of the same job.
    #[test]
    fn an_archived_or_closed_job_is_no_original() {
        use crate::store::test_support::{mail, now, posting};
        let store = Store::in_memory().unwrap();
        let run = store.begin_run().unwrap();
        let add = |url: &str| {
            let p = posting(
                url,
                "SAP FI/CO Berater (m/w/d)",
                "Ferrum Systems SE",
                "Hamburg",
            );
            store.upsert_posting(run, &p, mail(), now()).unwrap();
            p.key
        };
        let archived = add("https://www.freelancermap.de/nproj/12345.html");
        store
            .record_text(&archived, TEXT, false, false, now())
            .unwrap();
        store
            .move_jobs(
                std::slice::from_ref(&archived),
                crate::model::Place::Archive,
                now(),
            )
            .unwrap();
        let closed = add("https://www.freelance.de/project/index.php?id=1255067");
        store
            .record_text(&closed, TEXT, false, true, now())
            .unwrap();
        let fresh = add("https://www.linkedin.com/jobs/view/4000000001/");
        store
            .record_text(&fresh, TEXT, false, false, now())
            .unwrap();
        assert_eq!(store.link_duplicate(&fresh).unwrap(), None);
        assert_eq!(store.dup_of(&fresh).unwrap(), None);
    }
}

/// The pairs the comparison finds in the private run databases (read only), with about seven
/// pairs' titles of each for a look by eye: `cargo test -p jobalert-core --lib
/// duplicates_in_the_private_runs -- --ignored --nocapture`.
#[cfg(test)]
mod measure {
    use super::*;

    #[test]
    #[ignore = "reads the private run databases under core/tests/fixtures/private"]
    fn duplicates_in_the_private_runs() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/fixtures/private/baseline");
        for name in ["run_old.db", "run_new.db", "run_new2.db"] {
            let conn = rusqlite::Connection::open_with_flags(
                dir.join(name),
                rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
            )
            .unwrap();
            let mut stmt = conn
                .prepare(
                    "SELECT portal, job_id, title, company, location, desc_text,
                            desc_status = 'teaser'
                     FROM job WHERE desc_status IN ('ok', 'teaser') AND desc_text IS NOT NULL
                     ORDER BY first_seen_at, portal, job_id",
                )
                .unwrap();
            let copies: Vec<Copy> = stmt
                .query_map([], |r| {
                    Ok(Copy {
                        key: JobKey {
                            portal: Portal::from_key(&r.get::<_, String>(0)?).unwrap(),
                            id: r.get(1)?,
                        },
                        title: r.get(2)?,
                        company: r.get(3)?,
                        location: r.get(4)?,
                        text: r.get(5)?,
                        teaser: r.get(6)?,
                        closed: false,
                        hidden: false,
                        dup_of: None,
                    })
                })
                .unwrap()
                .map(std::result::Result::unwrap)
                .collect();
            let mut pairs = Vec::new();
            for (i, a) in copies.iter().enumerate() {
                for b in &copies[i + 1..] {
                    if same_job(a, b) {
                        pairs.push((a, b));
                    }
                }
            }
            let cross = pairs
                .iter()
                .filter(|(a, b)| a.key.portal != b.key.portal)
                .count();
            println!(
                "{name}: {} jobs with a text, {} pairs ({cross} across portals)",
                copies.len(),
                pairs.len()
            );
            for (a, b) in pairs.iter().step_by((pairs.len() / 7).max(1)) {
                println!(
                    "  {} | {} <> {} | {}",
                    a.key.portal, a.title, b.key.portal, b.title
                );
            }
        }
    }
}
