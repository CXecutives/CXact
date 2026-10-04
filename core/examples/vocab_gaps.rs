//! The gap finder: which words of the ads' requirements and titles neither the engine's own
//! words nor ESCO know, by frequency (`docs/MATCHING.md`, "Vocabulary"):
//!
//! ```text
//! cargo run -p jobalert-core --example vocab_gaps [-- N]
//! ```
//!
//! Reads every ad there is: the corpus and the held-out sets (`core/tests/fixtures/matching`),
//! and, when present, the real job pages and alert mails in `core/tests/fixtures/private`
//! (ignored by git; only their words reach the output). Prints the share of requirements
//! the engine knows in full, then the N (default 60) most frequent unknown words of the
//! requirements and of the titles, each with the number of ads and up to three examples.
//! A word that occurs nowhere stays out of the vocabulary: fill from the top down.
//!
//! A developer's tool: the engine holds the gap finder in debug builds only (the shipped app
//! carries the fixed vocabulary alone), so the finder runs in a debug build.

#[cfg(debug_assertions)]
#[path = "vocab_gaps/finder.rs"]
mod finder;

fn main() {
    #[cfg(debug_assertions)]
    finder::main();
    #[cfg(not(debug_assertions))]
    eprintln!(
        "the gap finder runs in a debug build: cargo run -p jobalert-core --example vocab_gaps"
    );
}
