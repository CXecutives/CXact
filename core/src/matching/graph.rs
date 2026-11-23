//! The engine's knowledge graph: how the atoms of an ad relate to the atoms of a profile.
//!
//! The profile's atoms are numbered once ([`Known`]); each atom of an ad is related to all
//! of them once per profile and thread ([`Row`]), so matching an item is a lookup.

use std::cell::{OnceCell, RefCell};
use std::rc::Rc;
use std::sync::atomic::{AtomicU64, Ordering};

use super::atoms::{self, Fit, Memo};
use super::lexicon::domains::DOMAINS;

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
    /// [`atoms::fit`] of the ad atom against each profile atom, by index.
    pub fits: Box<[Fit]>,
    /// The packs of the ad atom ([`packs`]).
    pub packs: u32,
    /// Does a profile atom relate to it the other way round ([`atoms::fit`] of the profile
    /// atom against it)?
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
            fits: self.atoms.iter().map(|p| atoms::fit(job, p)).collect(),
            packs: packs(job),
            back: OnceCell::new(),
        });
        ROWS.with(|rows| rows.borrow_mut().put(self.id, job, row.clone()));
        row
    }

    /// Does a profile atom relate to the ad atom of `row` the other way round?
    pub(crate) fn back(&self, row: &Row, job: &str) -> bool {
        *row.back
            .get_or_init(|| self.atoms.iter().any(|p| atoms::fit(p, job) != Fit::None))
    }
}
