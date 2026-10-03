//! Metric wiring of `match_eval` and the held-out gates: one [`Pair`] per labelled (profile,
//! job), the ranking metrics of `tests/common/eval.rs`, exclusion precision and recall, and
//! the gates of `docs/MATCHING.md` "Corpus and gates".
//!
//! Conventions: the gain of a job is `2^grade - 1` with grade 0 when the labelers excluded it
//! (nobody applies to an excluded job); the engine ranks excluded jobs last and unscorable
//! ones just above them, as the app's list does.
//!
//! Two measures look at the order below the top: the Spearman correlation over the relevant
//! pairs only (gain > 0: list order against gain), and the concordance per grade pair (share
//! of same-profile job pairs whose displayed scores order them like their label grades, ties
//! half; the score of an excluded job is kept, so it measures the fit, not the exclusions).
//! The pooled Spearman stays in the tables, but most pairs of a set have gain 0, so its
//! ceiling is low (0.51 on set 7 even for a perfect order) and it gates nothing.
#![allow(clippy::cast_precision_loss)] // Counts are tiny; these are report numbers.

use std::collections::BTreeMap;
use std::fmt::Write as _;

use super::eval;

/// A job counts as relevant for P@5 and the high band from this grade on.
pub const RELEVANT: u8 = 2;
/// Scores below this bury a job (`no grade-3 job below 40`).
pub const LOW_BELOW: u8 = 40;
/// Below this many labelled jobs the gates are reported but not enforced ("preliminary").
pub const MIN_LABELLED_JOBS: usize = 60;
/// The grade pairs of the concordance (lower grade, higher grade), in report order.
pub const GRADE_PAIRS: [(u8, u8); 6] = [(0, 3), (0, 2), (0, 1), (1, 3), (1, 2), (2, 3)];
/// Gates of the order below the top (`docs/MATCHING.md` "Corpus and gates"): the Spearman
/// correlation over the relevant pairs, and the concordance of the grade pairs that decide
/// what a user sees first. Grade 0 against grade 1 and grade 1 against grade 2 are reported
/// only: the labelers themselves disagree most there.
pub const MIN_SPEARMAN_RELEVANT: f64 = 0.50;
pub const MIN_CONCORDANCE: [(u8, u8, f64); 4] =
    [(0, 3, 0.95), (0, 2, 0.85), (1, 3, 0.80), (2, 3, 0.70)];

/// The engine's verdict.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    Scored,
    Excluded,
    Unscorable,
}

/// One labelled job for one profile.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Pair {
    /// Index of the profile (groups the per-profile rankings).
    pub profile: usize,
    pub score: u8,
    /// The engine's per-mille score before caps: breaks ties of equal scores.
    pub rank: u16,
    pub outcome: Outcome,
    pub grade: u8,
    pub label_excluded: bool,
}

impl Pair {
    /// Grade used for the gain: 0 for a job the labelers excluded.
    pub fn gain(&self) -> u8 {
        if self.label_excluded { 0 } else { self.grade }
    }

    /// Ranking key: excluded last, unscorable just above them; equal scores follow the score
    /// before the caps, as in the app's list.
    pub fn key(&self) -> f64 {
        let score = f64::from(self.score) + f64::from(self.rank) / 10_000.0;
        match self.outcome {
            Outcome::Scored => score,
            Outcome::Unscorable => -1.0,
            Outcome::Excluded => score - 1000.0,
        }
    }

    /// The score the engine shows (kept for an excluded job, 0 when unscorable).
    pub fn shown(&self) -> f64 {
        f64::from(self.score)
    }

    /// The engine hides the job: excluded, unscorable or below 40.
    pub fn buried(&self) -> bool {
        self.outcome != Outcome::Scored || self.score < LOW_BELOW
    }
}

/// Share of same-profile job pairs of two grades that the scores order like the grades
/// (ties count half), and the number of such pairs; `None` without pairs.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Concordance {
    pub share: Option<f64>,
    pub pairs: usize,
}

/// Ranking quality of the engine.
#[derive(Debug, Clone, Copy, Default, PartialEq)]
pub struct Ranking {
    pub ndcg10: f64,
    pub ndcg20: f64,
    pub p5: f64,
    pub spearman: f64,
    /// Spearman of list order and gain over the relevant pairs only (gain > 0); `None` with
    /// fewer than two of them.
    pub spearman_relevant: Option<f64>,
    /// Concordance of label grade and shown score per pair of [`GRADE_PAIRS`].
    pub concordance: [Concordance; 6],
    /// Share of relevant jobs among those scored 80 or more; `None` when there are none.
    pub high_band: Option<f64>,
    /// Grade-3 jobs the engine buries.
    pub grade3_low: usize,
}

impl Ranking {
    /// The concordance of one grade pair (`lower`, `higher`).
    pub fn concordance_of(&self, lower: u8, higher: u8) -> Concordance {
        GRADE_PAIRS
            .iter()
            .position(|&pair| pair == (lower, higher))
            .map_or_else(Concordance::default, |i| self.concordance[i])
    }
}

/// Exclusions of the engine against the labels.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Exclusions {
    /// Excluded by both.
    pub hit: usize,
    /// Excluded by the engine only.
    pub wrong: usize,
    /// Excluded by the labelers only.
    pub missed: usize,
}

impl Exclusions {
    pub fn of(pairs: &[Pair]) -> Exclusions {
        let mut e = Exclusions::default();
        for p in pairs {
            match (p.outcome == Outcome::Excluded, p.label_excluded) {
                (true, true) => e.hit += 1,
                (true, false) => e.wrong += 1,
                (false, true) => e.missed += 1,
                (false, false) => {}
            }
        }
        e
    }

    pub fn precision(&self) -> Option<f64> {
        let decided = self.hit + self.wrong;
        (decided > 0).then(|| self.hit as f64 / decided as f64)
    }

    pub fn recall(&self) -> Option<f64> {
        let labelled = self.hit + self.missed;
        (labelled > 0).then(|| self.hit as f64 / labelled as f64)
    }
}

/// All numbers of one profile (or of the total).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Metrics {
    pub n: usize,
    pub ranking: Ranking,
    pub exclusions: Exclusions,
}

fn grades(pairs: &[Pair]) -> Vec<u8> {
    pairs.iter().map(Pair::gain).collect()
}

fn keys(pairs: &[Pair]) -> Vec<f64> {
    pairs.iter().map(Pair::key).collect()
}

/// NDCG@k of one profile's pairs.
fn ndcg(pairs: &[Pair], k: usize) -> f64 {
    eval::ndcg_at(&keys(pairs), &grades(pairs), k)
}

/// Pairs grouped by profile, in profile order.
fn by_profile(pairs: &[Pair]) -> Vec<Vec<Pair>> {
    let mut groups: BTreeMap<usize, Vec<Pair>> = BTreeMap::new();
    for p in pairs {
        groups.entry(p.profile).or_default().push(*p);
    }
    groups.into_values().collect()
}

/// Mean over the profiles that have at least one job with a gain: a profile without a
/// relevant job has no ranking to judge (its NDCG would be 0 whatever the engine does).
fn ranked_mean(pairs: &[Pair], metric: impl Fn(&[Pair]) -> f64) -> f64 {
    let groups: Vec<Vec<Pair>> = by_profile(pairs)
        .into_iter()
        .filter(|g| g.iter().any(|p| p.gain() > 0))
        .collect();
    if groups.is_empty() {
        return 0.0;
    }
    groups.iter().map(|g| metric(g)).sum::<f64>() / groups.len() as f64
}

/// P@5 of the profiles that have relevant jobs, each divided by what it can reach
/// (`min(5, relevant jobs)`: a profile with two relevant jobs scores 1.0 when both are in its
/// top 5); 0 when no profile has a relevant job.
fn reachable_p5(pairs: &[Pair]) -> f64 {
    let values: Vec<f64> = by_profile(pairs)
        .iter()
        .filter_map(|g| eval::reachable_precision_at(&keys(g), &grades(g), 5, RELEVANT))
        .collect();
    if values.is_empty() {
        0.0
    } else {
        values.iter().sum::<f64>() / values.len() as f64
    }
}

/// Spearman of the list order and the gain over the pairs with a gain; `None` when their
/// gains are all equal (no order to judge).
fn spearman_relevant(pairs: &[Pair]) -> Option<f64> {
    let relevant: Vec<Pair> = pairs.iter().filter(|p| p.gain() > 0).copied().collect();
    let varied = relevant.windows(2).any(|w| w[0].gain() != w[1].gain());
    varied.then(|| {
        let gains: Vec<f64> = relevant.iter().map(|p| f64::from(p.gain())).collect();
        eval::spearman(&keys(&relevant), &gains)
    })
}

/// Concordance of the label grade (not the gain: the score of an excluded job is kept) and
/// the shown score, per grade pair, over the job pairs of each profile.
fn concordance(pairs: &[Pair]) -> [Concordance; 6] {
    let groups = by_profile(pairs);
    GRADE_PAIRS.map(|(lower, higher)| {
        let (mut count, mut agree) = (0usize, 0.0f64);
        for group in &groups {
            for high in group.iter().filter(|p| p.grade == higher) {
                for low in group.iter().filter(|p| p.grade == lower) {
                    count += 1;
                    let (h, l) = (high.shown(), low.shown());
                    agree += if h > l {
                        1.0
                    } else if h < l {
                        0.0
                    } else {
                        0.5
                    };
                }
            }
        }
        Concordance {
            share: (count > 0).then(|| agree / count as f64),
            pairs: count,
        }
    })
}

/// Ranking metrics. NDCG and P@5 are means over the profiles (one ranking per profile; P@5
/// over the profiles with relevant jobs, against what each can reach); Spearman, the high
/// band and the grade-3 count are pooled over all pairs, the concordance over the job pairs
/// of each profile.
pub fn ranking(pairs: &[Pair]) -> Ranking {
    let scores = keys(pairs);
    let gains = grades(pairs);
    let gains_f: Vec<f64> = gains.iter().map(|&g| f64::from(g)).collect();
    Ranking {
        ndcg10: ranked_mean(pairs, |g| ndcg(g, 10)),
        ndcg20: ranked_mean(pairs, |g| ndcg(g, 20)),
        p5: reachable_p5(pairs),
        spearman: if pairs.is_empty() {
            0.0
        } else {
            eval::spearman(&scores, &gains_f)
        },
        spearman_relevant: spearman_relevant(pairs),
        concordance: concordance(pairs),
        high_band: eval::high_band_precision(&scores, &gains, RELEVANT),
        grade3_low: pairs.iter().filter(|p| p.gain() == 3 && p.buried()).count(),
    }
}

/// Everything for a set of pairs (one profile, or all profiles for the total).
pub fn metrics(pairs: &[Pair]) -> Metrics {
    Metrics {
        n: pairs.len(),
        ranking: ranking(pairs),
        exclusions: Exclusions::of(pairs),
    }
}

/// One gate of `docs/MATCHING.md` "Corpus and gates", checked on the total.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Gate {
    pub name: String,
    pub value: String,
    pub target: String,
    pub pass: bool,
}

fn optional(value: Option<f64>) -> String {
    value.map_or_else(|| "n/a".to_owned(), |v| format!("{v:.3}"))
}

/// The gates; a metric without data (`n/a`) does not fail.
pub fn gates(total: &Metrics) -> Vec<Gate> {
    const EPS: f64 = 1e-9;
    let (r, e) = (&total.ranking, &total.exclusions);
    let gate = |name: &str, value: String, target: &str, pass| Gate {
        name: name.to_owned(),
        value,
        target: target.to_owned(),
        pass,
    };
    let concordance = MIN_CONCORDANCE.map(|(lower, higher, min)| {
        let share = r.concordance_of(lower, higher).share;
        Gate {
            name: format!("Concordance grade {lower} v {higher}"),
            value: optional(share),
            target: format!(">= {min:.3}"),
            pass: share.is_none_or(|s| s >= min - EPS),
        }
    });
    let relevant = r.spearman_relevant;
    let mut all = vec![
        gate(
            "Exclusion precision",
            optional(e.precision()),
            "1.000",
            e.precision().is_none_or(|p| p >= 1.0 - EPS),
        ),
        gate(
            "Exclusion recall",
            optional(e.recall()),
            ">= 0.800",
            e.recall().is_none_or(|r| r >= 0.8 - EPS),
        ),
        gate(
            "NDCG@10",
            format!("{:.3}", r.ndcg10),
            ">= 0.750",
            r.ndcg10 >= 0.75 - EPS,
        ),
        gate("P@5", format!("{:.3}", r.p5), ">= 0.800", r.p5 >= 0.8 - EPS),
        gate(
            "Grade-3 jobs buried (< 40, excluded or unscorable)",
            r.grade3_low.to_string(),
            "0",
            r.grade3_low == 0,
        ),
        gate(
            "High-band precision",
            optional(r.high_band),
            ">= 0.800",
            r.high_band.is_none_or(|h| h >= 0.8 - EPS),
        ),
        gate(
            "Spearman, relevant pairs",
            optional(relevant),
            &format!(">= {MIN_SPEARMAN_RELEVANT:.3}"),
            relevant.is_none_or(|s| s >= MIN_SPEARMAN_RELEVANT - EPS),
        ),
    ];
    all.extend(concordance);
    all
}

/// Overall result of an evaluation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Status {
    NoLabels,
    /// Fewer than [`MIN_LABELLED_JOBS`] labelled jobs: gates shown, not enforced.
    Preliminary,
    Pass,
    Fail,
}

pub fn status(labelled_jobs: usize, gates: &[Gate]) -> Status {
    if labelled_jobs == 0 {
        Status::NoLabels
    } else if labelled_jobs < MIN_LABELLED_JOBS {
        Status::Preliminary
    } else if gates.iter().all(|g| g.pass) {
        Status::Pass
    } else {
        Status::Fail
    }
}

/// The metrics table (Markdown): one row per profile and the total.
pub fn table(rows: &[(String, Metrics)], total: &Metrics) -> String {
    let mut out = String::from(
        "| Profile | n | NDCG@10 | NDCG@20 | P@5 | Spearman | High band | Grade 3 buried | \
         Excl. precision / recall |\n|---|---|---|---|---|---|---|---|---|\n",
    );
    let mut row = |name: &str, m: &Metrics| {
        let r = &m.ranking;
        let _ = writeln!(
            out,
            "| {name} | {} | {:.3} | {:.3} | {:.3} | {:.3} | {} | {} | {} / {} |",
            m.n,
            r.ndcg10,
            r.ndcg20,
            r.p5,
            r.spearman,
            optional(r.high_band),
            r.grade3_low,
            optional(m.exclusions.precision()),
            optional(m.exclusions.recall()),
        );
    };
    for (name, m) in rows {
        row(name, m);
    }
    row("**Total**", total);
    out
}

/// The order below the top (Markdown): Spearman over the relevant pairs and the concordance
/// of every grade pair with the number of job pairs, one row per profile and the total.
pub fn order_table(rows: &[(String, Metrics)], total: &Metrics) -> String {
    let mut out = String::from("| Profile | Spearman relevant |");
    for (lower, higher) in GRADE_PAIRS {
        let _ = write!(out, " {lower}v{higher} (n) |");
    }
    out.push_str("\n|---|---|");
    out.push_str(&"---|".repeat(GRADE_PAIRS.len()));
    out.push('\n');
    let mut row = |name: &str, m: &Metrics| {
        let _ = write!(
            out,
            "| {name} | {} |",
            optional(m.ranking.spearman_relevant)
        );
        for c in &m.ranking.concordance {
            let _ = write!(out, " {} ({}) |", optional(c.share), c.pairs);
        }
        out.push('\n');
    };
    for (name, m) in rows {
        row(name, m);
    }
    row("**Total**", total);
    out
}

/// The gate table (Markdown).
pub fn gate_table(gates: &[Gate]) -> String {
    let mut out = String::from("| Gate | Value | Target | Result |\n|---|---|---|---|\n");
    for g in gates {
        let _ = writeln!(
            out,
            "| {} | {} | {} | {} |",
            g.name,
            g.value,
            g.target,
            if g.pass { "pass" } else { "FAIL" }
        );
    }
    out
}
