//! The engine's knowledge graph: how the atoms of an ad relate to the atoms of a profile.
//!
//! The nodes are the stemmed atoms and concepts the vocabulary reads; synonyms are one node
//! already (`Vocab`). The edges say what the words do not: an umbrella covers narrower
//! concepts (`Rechnungswesen` covers `Jahresabschluss`, also through a chain), and two
//! concepts are near each other (`Projektleitung`, `Projektmanagement`); the tables are the
//! core's (`lexicon::engine::CORE_COVERS`, `CORE_NEAR`) and the packs' (`Domain::covers`,
//! `Domain::near`), for every profile. [`fit`] relates two atoms by their words first
//! (`atoms::fit_direct`), then by the edges.
//!
//! The profile's atoms are numbered once ([`Known`]); each atom of an ad is related to all
//! of them once per profile and thread ([`Row`]), so matching an item is a lookup.

use std::cell::{OnceCell, RefCell};
use std::collections::HashMap;
use std::rc::Rc;
use std::sync::LazyLock;
use std::sync::atomic::{AtomicU64, Ordering};

use super::atoms::{self, Fit, Memo, stem};
use super::lexicon::domains::DOMAINS;
use super::lexicon::engine as lex;
use super::normalize::contains_word;

/// How an ad atom relates to a profile atom: by their words, then through the graph. A
/// node of ten letters or more stands for its compounds too (`Projektleitungskompetenz` is
/// near `Projektmanagement`); the profile atom is the other node, or a compound of it.
pub(crate) fn fit(job: &str, profile: &str) -> Fit {
    let direct = atoms::fit_direct(job, profile);
    if direct != Fit::None {
        return direct;
    }
    let starts = (COMPOUND_NODE..job.len()).filter(|&at| job.is_char_boundary(at));
    std::iter::once(job)
        .chain(starts.map(|at| &job[..at]))
        .filter_map(|node| EDGES.get(node))
        .flatten()
        .filter_map(|(other, edge)| match atoms::fit_direct(other, profile) {
            Fit::Equal => Some(*edge),
            // A compound of the other node meets in half (`Konzerncontrolling` for FP&A asked);
            // it proves no umbrella (`Standortkonsolidierung` is no accounting).
            Fit::Specific if *edge == Fit::General => Some(Fit::General),
            _ => None,
        })
        .max()
        .unwrap_or(Fit::None)
}

/// A node relates its compounds when it has this many letters or more.
const COMPOUND_NODE: usize = 10;

/// Every node with the nodes it relates to and how an ad asking for it is met by a profile
/// naming the other: an umbrella in full by a narrower node it covers (the profile is more
/// specific), a narrower node in half by its umbrellas (more general), a node in half by its
/// near ones.
static EDGES: LazyLock<HashMap<String, Vec<(String, Fit)>>> = LazyLock::new(|| {
    let covers = DOMAINS
        .iter()
        .flat_map(|d| d.covers)
        .chain(lex::CORE_COVERS);
    let near = DOMAINS.iter().flat_map(|d| d.near).chain(lex::CORE_NEAR);
    let mut below: HashMap<String, Vec<String>> = HashMap::new();
    for (umbrella, narrower) in covers {
        below
            .entry(stem(umbrella))
            .or_default()
            .extend(narrower.iter().map(|n| stem(n)));
    }
    let mut edges: HashMap<String, Vec<(String, Fit)>> = HashMap::new();
    let mut add = |from: &str, to: &str, edge: Fit| {
        let list = edges.entry(from.to_owned()).or_default();
        match list.iter_mut().find(|(n, _)| n == to) {
            Some((_, e)) => *e = (*e).max(edge),
            None => list.push((to.to_owned(), edge)),
        }
    };
    for umbrella in below.keys() {
        for narrower in covered(&below, umbrella) {
            add(umbrella, &narrower, Fit::Covered);
            add(&narrower, umbrella, Fit::General);
        }
    }
    for (a, others) in near {
        for b in *others {
            add(&stem(a), &stem(b), Fit::General);
            add(&stem(b), &stem(a), Fit::General);
        }
    }
    edges
});

/// Every node an umbrella covers, through chains too.
fn covered(below: &HashMap<String, Vec<String>>, umbrella: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    let mut open = vec![umbrella.to_owned()];
    while let Some(node) = open.pop() {
        for narrower in below.get(&node).into_iter().flatten() {
            if !out.contains(narrower) {
                out.push(narrower.clone());
                open.push(narrower.clone());
            }
        }
    }
    out
}

/// The packs whose triggers an atom starts with, one bit per pack in `DOMAINS` order.
pub(crate) fn packs(atom: &str) -> u32 {
    DOMAINS
        .iter()
        .enumerate()
        .filter(|(_, d)| d.triggers.iter().any(|t| atom.starts_with(t)))
        .fold(0, |mask, (i, _)| mask | 1 << i)
}

/// Is a profile atom a compound of another field than the ad atom it narrows
/// (`Personalcontrolling`, an HR word, for `Controlling`)? `job` and `profile` are pack masks
/// ([`packs`]).
pub(crate) fn other_field(job: u32, profile: u32) -> bool {
    profile != 0 && profile & job == 0
}

/// The kinds of tool a text names (`lexicon::engine::TOOL_KINDS`, by index), each with
/// whether it names a tool of the kind (`Salesforce`) or the kind alone (`CRM`); read once
/// per text and thread.
pub(crate) fn tool_kinds(text: &str) -> ToolKinds {
    if let Some(found) = KINDS.with(|kinds| kinds.borrow().get(0, text)) {
        return found;
    }
    let folded = atoms::fold(text).replace('-', " ");
    let named = |names: &[&str]| names.iter().any(|n| contains_word(&folded, n));
    let found: ToolKinds = lex::TOOL_KINDS
        .iter()
        .enumerate()
        .filter_map(|(kind, (_, own, tools))| {
            let tool = named(tools);
            (tool || named(own)).then_some((kind, tool))
        })
        .collect();
    KINDS.with(|kinds| kinds.borrow_mut().put(0, text, found.clone()));
    found
}

/// The kinds of tool a text names ([`tool_kinds`]).
pub(crate) type ToolKinds = Rc<[(usize, bool)]>;

thread_local! {
    /// The kinds of tool of the texts read so far.
    static KINDS: RefCell<Memo<ToolKinds>> = const { RefCell::new(Memo::new(1 << 14)) };
}

/// Atoms a profile names, numbered: the entries' atoms, or a query's.
#[derive(Debug, Clone)]
pub(crate) struct Known {
    atoms: Vec<String>,
    packs: Vec<u32>,
    /// Its own number: the key of its rows. A clone is the same table and keeps it.
    id: u64,
}

/// The next [`Known::id`].
static KNOWN_IDS: AtomicU64 = AtomicU64::new(0);

/// How one atom of an ad relates to every atom a profile names.
#[derive(Debug)]
pub(crate) struct Row {
    /// [`fit`] of the ad atom against each profile atom, by index.
    pub fits: Box<[Fit]>,
    /// The packs of the ad atom ([`packs`]).
    pub packs: u32,
    /// Does a profile atom relate to it the other way round ([`fit`] of the profile atom
    /// against it)?
    back: OnceCell<bool>,
}

thread_local! {
    /// The rows of the ad atoms read so far, by table.
    static ROWS: RefCell<Memo<Rc<Row>>> = const { RefCell::new(Memo::new(1 << 16)) };
}

impl Known {
    /// The atoms in this order (each once).
    pub(crate) fn new(atoms: Vec<String>) -> Self {
        Self {
            packs: atoms.iter().map(|a| packs(a)).collect(),
            atoms,
            id: KNOWN_IDS.fetch_add(1, Ordering::Relaxed),
        }
    }

    pub(crate) fn atoms(&self) -> &[String] {
        &self.atoms
    }

    /// The index of an atom.
    pub(crate) fn index(&self, atom: &str) -> Option<usize> {
        self.atoms.iter().position(|a| a == atom)
    }

    /// The packs of the atom at `index` ([`packs`]).
    pub(crate) fn packs(&self, index: usize) -> u32 {
        self.packs[index]
    }

    /// How an ad atom relates to every atom of the table.
    pub(crate) fn row(&self, job: &str) -> Rc<Row> {
        if let Some(found) = ROWS.with(|rows| rows.borrow().get(self.id, job)) {
            return found;
        }
        let row = Rc::new(Row {
            fits: self.atoms.iter().map(|p| fit(job, p)).collect(),
            packs: packs(job),
            back: OnceCell::new(),
        });
        ROWS.with(|rows| rows.borrow_mut().put(self.id, job, row.clone()));
        row
    }

    /// Does a profile atom relate to the ad atom of `row` the other way round?
    pub(crate) fn back(&self, row: &Row, job: &str) -> bool {
        *row.back
            .get_or_init(|| self.atoms.iter().any(|p| fit(p, job) != Fit::None))
    }
}
