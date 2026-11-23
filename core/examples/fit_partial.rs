//! Fits the free value of the Passungsgrad (`PARTIAL`, `core/src/matching/params.rs`) on
//! teacher labels with the engine's own scorer and prints it:
//!
//! ```text
//! cargo run -p jobalert-core --example fit_partial -- --signals <scores.jsonl>
//!     --labels <labels.jsonl> --exclude <gold pairs.jsonl> [--splits train,lockbox]
//! ```
//!
//! Inputs (all private, never in the repo; `bench/retrain.sh` passes them):
//! - `--signals`: the engine's dump of every pair, a header line `{"names", "sign", "max"}` and
//!   then one line per pair `{"pair", "profile", "v": [...], "score", "rank", "verdict"}`;
//! - `--labels`: the teacher labels `{"pair", "profile", "split", "note", "passung",
//!   "excluded", "drop"}`, only the pairs of `--splits` are read;
//! - `--exclude`: pair lines `{"pair", ...}` that never enter the fit (the gold pairs: the fit
//!   must not see the sets it is checked on).
//!
//! It first checks that the scorer gives every dumped score (the dump is of this engine), then
//! scores the labelled pairs with `matching::signal_score`, the engine's arithmetic, for each
//! `PARTIAL` of the grid (300 to 950 per-mille). Everything else stays fixed by meaning. The
//! objective is NDCG@10 (mean over the profiles; the order scored, unscorable, excluded, then
//! score, rank and pair) plus Spearman of the score against the teacher's passung (excluded -1
//! on both sides); a tie keeps the value nearest the current one. It prints the measures
//! before and after and the constant for `params.rs`; the checks on the gold tune part, the
//! owner's 154 and the teacher test split run apart (`bench/retrain.sh`).

mod common;

use std::collections::{BTreeMap, HashMap, HashSet};
use std::error::Error;

use common::eval::{ndcg_at, spearman};
use jobalert_core::matching::{SIGNAL_NAMES, SIGNALS, ScoreParams, Signals, signal_score};
use serde_json::Value;

/// The values of `PARTIAL` the fit tries (per-mille).
const GRID: (u64, u64, usize) = (300, 950, 50);
const TOP_K: usize = 10;
/// The objective is compared at this precision, so float noise never decides a tie.
const OBJECTIVE_SCALE: f64 = 1e9;

type Failure = Box<dyn Error>;

/// One dumped pair.
struct Row {
    pair: String,
    profile: String,
    signals: Signals,
    /// The engine's score and rank (`None` without an assessment).
    dumped: Option<(u8, u16)>,
    verdict: Option<String>,
}

/// The teacher's label of a pair.
struct Label {
    /// 0 to 3; 0 for a pair the teacher excluded.
    note: u8,
    /// The teacher's score; -1 for an excluded pair.
    passung: f64,
    excluded: bool,
}

/// The measures of one set of values.
struct Measure {
    ndcg: f64,
    spearman: f64,
    /// The mean score per note 0 to 3 (scored pairs the teacher did not exclude).
    means: [Option<f64>; 4],
}

fn main() {
    if let Err(e) = run() {
        eprintln!("fit_partial: {e}");
        std::process::exit(1);
    }
}

fn run() -> Result<(), Failure> {
    let args = Args::parse()?;
    let rows = read_rows(&args.signals)?;
    let excluded: HashSet<String> = read_jsonl(&args.exclude)?
        .iter()
        .filter_map(|r| r["pair"].as_str().map(str::to_owned))
        .collect();
    let splits: HashSet<&str> = args.splits.split(',').collect();
    let labels = read_labels(&args.labels, &splits, &excluded)?;
    let pairs: Vec<(&Row, &Label)> = rows
        .iter()
        .filter_map(|r| labels.get(&r.pair).map(|l| (r, l)))
        .collect();
    if pairs.is_empty() {
        return Err(format!("no labelled pairs of {} in {}", args.splits, args.signals).into());
    }
    let current = ScoreParams::ENGINE;
    let wrong: Vec<&str> = rows
        .iter()
        .filter(|r| r.dumped.is_some_and(|d| replay(r, current) != d))
        .map(|r| r.pair.as_str())
        .collect();
    if !wrong.is_empty() {
        let first: Vec<&str> = wrong.iter().take(3).copied().collect();
        return Err(format!(
            "the scorer differs from the dump on {} pairs, e.g. {first:?} (dump again)",
            wrong.len()
        )
        .into());
    }
    println!(
        "{} teacher pairs of {} (gold pairs left out); the scorer gives all {} dumped scores",
        pairs.len(),
        args.splits,
        rows.len()
    );
    show("current", &measure(&pairs, current));
    let fitted = search(&pairs, current);
    show("fitted ", &measure(&pairs, fitted));
    println!("\n// fitted on the teacher labels by core/examples/fit_partial.rs");
    println!("pub(crate) const PARTIAL: u64 = {};", fitted.partial);
    Ok(())
}

struct Args {
    signals: String,
    labels: String,
    exclude: String,
    splits: String,
}

impl Args {
    fn parse() -> Result<Args, Failure> {
        const USAGE: &str = "usage: fit_partial --signals <scores.jsonl> --labels <labels.jsonl> \
                             --exclude <gold pairs.jsonl> [--splits train,lockbox]";
        let mut values: HashMap<String, String> = HashMap::new();
        let mut args = std::env::args().skip(1);
        while let Some(flag) = args.next() {
            let name = flag
                .strip_prefix("--")
                .filter(|n| ["signals", "labels", "exclude", "splits"].contains(n));
            match (name, args.next()) {
                (Some(name), Some(value)) => {
                    values.insert(name.to_owned(), value);
                }
                _ => return Err(format!("{flag}?\n{USAGE}").into()),
            }
        }
        let mut take = |name: &str| values.remove(name).ok_or_else(|| USAGE.to_owned());
        Ok(Args {
            signals: take("signals")?,
            labels: take("labels")?,
            exclude: take("exclude")?,
            splits: take("splits").unwrap_or_else(|_| "train,lockbox".to_owned()),
        })
    }
}

fn read_jsonl(path: &str) -> Result<Vec<Value>, Failure> {
    let text = std::fs::read_to_string(path).map_err(|e| format!("{path}: {e}"))?;
    text.lines()
        .filter(|l| !l.trim().is_empty())
        .enumerate()
        .map(|(i, l)| {
            serde_json::from_str(l).map_err(|e| Failure::from(format!("{path}:{}: {e}", i + 1)))
        })
        .collect()
}

/// A JSON value as Python reads it in an `if`.
fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64() != Some(0.0),
        Some(Value::String(s)) => !s.is_empty(),
        Some(Value::Array(a)) => !a.is_empty(),
        Some(Value::Object(o)) => !o.is_empty(),
    }
}

fn read_rows(path: &str) -> Result<Vec<Row>, Failure> {
    let mut lines = read_jsonl(path)?.into_iter();
    let header = lines.next().ok_or_else(|| format!("{path}: empty"))?;
    let names: Vec<&str> = header["names"]
        .as_array()
        .map(|a| a.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    if names != SIGNAL_NAMES {
        return Err(format!("{path}: the signals are not this engine's (dump again)").into());
    }
    lines
        .map(|r| {
            let pair = r["pair"]
                .as_str()
                .ok_or_else(|| format!("{path}: a line without pair"))?;
            let v: Vec<u16> = r["v"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(|x| x.as_u64()?.try_into().ok())
                        .collect()
                })
                .unwrap_or_default();
            let v: [u16; SIGNALS] = v
                .try_into()
                .map_err(|_| format!("{path}: {pair}: not {SIGNALS} signals"))?;
            let score = r["score"].as_u64().and_then(|s| u8::try_from(s).ok());
            let rank = r["rank"].as_u64().and_then(|s| u16::try_from(s).ok());
            Ok(Row {
                pair: pair.to_owned(),
                profile: r["profile"].as_str().unwrap_or_default().to_owned(),
                signals: Signals { v },
                dumped: score.map(|s| (s, rank.unwrap_or(0))),
                verdict: r["verdict"].as_str().map(str::to_owned),
            })
        })
        .collect()
}

fn read_labels(
    path: &str,
    splits: &HashSet<&str>,
    excluded: &HashSet<String>,
) -> Result<HashMap<String, Label>, Failure> {
    let mut labels = HashMap::new();
    for row in read_jsonl(path)? {
        let split = row["split"].as_str().unwrap_or_default();
        if truthy(row.get("drop")) || row["note"].is_null() || !splits.contains(split) {
            continue;
        }
        let pair = row["pair"]
            .as_str()
            .ok_or_else(|| format!("{path}: a label without pair"))?;
        if excluded.contains(pair) {
            continue;
        }
        let out = truthy(row.get("excluded"));
        let label = if out {
            Label {
                note: 0,
                passung: -1.0,
                excluded: true,
            }
        } else {
            let note = row["note"]
                .as_u64()
                .and_then(|n| u8::try_from(n).ok())
                .filter(|&n| n <= 3)
                .ok_or_else(|| format!("{pair}: a note of 0 to 3"))?;
            Label {
                note,
                passung: row["passung"]
                    .as_f64()
                    .ok_or_else(|| format!("{pair}: passung"))?,
                excluded: false,
            }
        };
        labels.insert(pair.to_owned(), label);
    }
    Ok(labels)
}

/// The engine's (score, rank) of one pair: 0 when unscorable.
fn replay(row: &Row, p: ScoreParams) -> (u8, u16) {
    if row.verdict.as_deref() == Some("unscorable") {
        (0, 0)
    } else {
        signal_score(&row.signals, p)
    }
}

/// The list order of a verdict: scored, unscorable, excluded, then anything else.
fn verdict_order(verdict: Option<&str>) -> u8 {
    match verdict {
        Some("scored") => 0,
        Some("unscorable") => 1,
        Some("excluded") => 2,
        _ => 3,
    }
}

#[allow(clippy::cast_precision_loss)] // Counts and scores are small.
fn measure(pairs: &[(&Row, &Label)], p: ScoreParams) -> Measure {
    let scored: Vec<(u8, u16)> = pairs.iter().map(|(r, _)| replay(r, p)).collect();
    let mut by: BTreeMap<&str, Vec<usize>> = BTreeMap::new();
    for (i, (row, _)) in pairs.iter().enumerate() {
        by.entry(row.profile.as_str()).or_default().push(i);
    }
    let mut ndcgs = Vec::new();
    for mut items in by.into_values() {
        if items.iter().all(|&i| pairs[i].1.note == 0) {
            continue;
        }
        // Ties of verdict, score and rank keep the order of the pair names (a stable sort).
        items.sort_by(|&a, &b| pairs[a].0.pair.cmp(&pairs[b].0.pair));
        let keys: Vec<f64> = items
            .iter()
            .map(|&i| {
                let (score, rank) = scored[i];
                let order = f64::from(3 - verdict_order(pairs[i].0.verdict.as_deref()));
                order * 1e7 + f64::from(score) * 1e4 + f64::from(rank)
            })
            .collect();
        let gains: Vec<u8> = items.iter().map(|&i| pairs[i].1.note).collect();
        ndcgs.push(ndcg_at(&keys, &gains, TOP_K));
    }
    let shown: Vec<f64> = pairs
        .iter()
        .zip(&scored)
        .map(|((row, _), &(score, _))| {
            if row.verdict.as_deref() == Some("excluded") {
                -1.0
            } else {
                f64::from(score)
            }
        })
        .collect();
    let wanted: Vec<f64> = pairs.iter().map(|(_, l)| l.passung).collect();
    let means = [0u8, 1, 2, 3].map(|note| {
        let xs: Vec<f64> = pairs
            .iter()
            .zip(&scored)
            .filter(|((row, l), _)| {
                l.note == note && !l.excluded && row.verdict.as_deref() == Some("scored")
            })
            .map(|(_, &(score, _))| f64::from(score))
            .collect();
        (!xs.is_empty()).then(|| xs.iter().sum::<f64>() / xs.len() as f64)
    });
    Measure {
        ndcg: ndcgs.iter().sum::<f64>() / ndcgs.len() as f64,
        spearman: spearman(&shown, &wanted),
        means,
    }
}

/// The whole grid (it is small): the highest objective, then the value nearest the current
/// one, then the smaller value.
#[allow(clippy::cast_possible_truncation)] // The objective is at most 2.
fn search(pairs: &[(&Row, &Label)], current: ScoreParams) -> ScoreParams {
    let rank = |p: ScoreParams| {
        let m = measure(pairs, p);
        let objective = ((m.ndcg + m.spearman) * OBJECTIVE_SCALE).round() as i64;
        (-objective, p.partial.abs_diff(current.partial), p.partial)
    };
    let (from, to, step) = GRID;
    let mut best = (rank(current), current);
    for partial in (from..=to).step_by(step) {
        let p = ScoreParams { partial };
        let candidate = rank(p);
        if candidate < best.0 {
            best = (candidate, p);
        }
    }
    best.1
}

fn show(title: &str, m: &Measure) {
    // Python's `round`, so the means read as the earlier fitter printed them.
    let means: Vec<String> = [3, 2, 1, 0]
        .iter()
        .map(|&n| m.means[n].map_or_else(|| "None".to_owned(), |x| x.round_ties_even().to_string()))
        .collect();
    println!(
        "{title}: ndcg@10 {:.3}  spearman {:.3}  mean per note 3/2/1/0 {}",
        m.ndcg,
        m.spearman,
        means.join("/")
    );
}
