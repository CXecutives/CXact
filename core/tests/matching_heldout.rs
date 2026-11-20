//! Held-out regression corpora (`core/tests/fixtures/matching/heldout1` to `heldout10`):
//! invented ads with blind labels (grade 0-3, excluded) written by independent agents for
//! profiles the engine was not tuned on at the time. Every set was later used to find and
//! fix systematic gaps, so they are regression gates now, not an unseen measurement.
//! Set 10 (customer service and contact center, customer experience, IT service management
//! and marketing, the fields of the domain packs `customerService`, `itService` and
//! `marketing`) has its gate since engine 19.
//!
//! Every set runs the engine over all labelled (profile, job) pairs and computes the
//! metrics of `docs/MATCHING.md` (NDCG@10/20, P@5 against what each profile can reach,
//! Spearman over all and over the relevant pairs, the concordance per grade pair, high band,
//! buried grade-3 jobs, exclusion precision and recall). The gates below freeze what the engine reaches;
//! `-- --ignored heldout_report --nocapture` prints the tables.

#[allow(dead_code)]
#[path = "common/eval.rs"]
mod eval;
#[allow(dead_code)]
#[path = "../examples/common/gold.rs"]
mod gold;
#[allow(dead_code)]
#[path = "../examples/common/labels.rs"]
mod labels;
#[allow(dead_code)]
#[path = "../examples/common/metrics.rs"]
mod metrics;

use std::path::{Path, PathBuf};

use jobalert_core::matching::{
    Assessment, JobInput, TextKind, Verdict, assess, compile_profile, prescore,
};
use jobalert_core::portal::Portal;
use metrics::{Exclusions, Metrics, Outcome, Pair};
use serde_json::Value;

fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/matching")
}

/// One labelled pair with the job it belongs to (for the miss lists).
struct Row {
    profile: String,
    job: String,
    pair: Pair,
    /// The title's pre-score for the profile (`matching::prescore`).
    prescore: u16,
    /// The label excludes by an owner's decision the engine keeps out on purpose
    /// (`labels::OWNER_DECISION`).
    owner_decision: bool,
}

struct SetRun {
    rows: Vec<Row>,
    per_profile: Vec<(String, Metrics)>,
    total: Metrics,
    /// The exclusions without the labels of the owner's decisions: what the engine is meant
    /// to find.
    kept: Exclusions,
}

/// A profile file of a set: its own folder first, then the sample profiles.
fn profile_path(set: &Path, name: &str) -> PathBuf {
    let own = set.join(name);
    if own.exists() {
        own
    } else {
        fixtures().join(name)
    }
}

fn run_set(name: &str) -> SetRun {
    let dir = fixtures().join(name);
    let jobs = gold::read_jobs(&dir.join("jobs.json")).expect("jobs.json");
    let text = std::fs::read_to_string(dir.join("labels.json")).expect("labels.json");
    let all_labels = labels::parse_labels(&text).expect("labels");
    let mut rows = Vec::new();
    let mut per_profile = Vec::new();
    for (index, (profile_name, own)) in all_labels.iter().enumerate() {
        let path = profile_path(&dir, profile_name);
        let data = jobalert_core::profile::parse(&std::fs::read_to_string(&path).expect("profile"))
            .expect("a v19 profile");
        let profile = compile_profile(&data);
        let mut pairs = Vec::new();
        for job in &jobs {
            let Some(label) = labels::for_job(own, job) else {
                continue;
            };
            let content = std::fs::read_to_string(dir.join(job.txt_name())).expect("job file");
            let file = gold::parse_txt(&content);
            let posted = job
                .mail_date
                .as_deref()
                .unwrap_or(&job.first_seen_at)
                .parse::<jiff::Timestamp>()
                .ok()
                .map(|t| t.to_zoned(jiff::tz::TimeZone::UTC).date());
            let input = JobInput {
                title: &job.title,
                company: &job.company,
                location: &job.location,
                portal: Portal::from_key(&job.portal).expect("portal"),
                text: &file.body,
                facts: job.facts.as_ref(),
                posted,
                kind: if job.is_teaser() {
                    TextKind::Teaser
                } else {
                    TextKind::Full
                },
            };
            let a = assess(&profile, &input, None).expect("a usable profile");
            let pair_name = format!(
                "{name} {} {}",
                profile_name.trim_end_matches(".json"),
                job.file
            );
            explain(&pair_name, &a, label.grade, label.excluded);
            let outcome = match a.verdict {
                Verdict::Scored => Outcome::Scored,
                Verdict::Excluded => Outcome::Excluded,
                Verdict::Unscorable => Outcome::Unscorable,
            };
            let pair = Pair {
                profile: index,
                score: a.score,
                rank: a.rank,
                outcome,
                grade: label.grade,
                label_excluded: label.excluded,
            };
            rows.push(Row {
                profile: profile_name.clone(),
                job: job.file.clone(),
                pair,
                prescore: prescore(&profile, &job.title, &job.location),
                owner_decision: label.owner_decision(),
            });
            pairs.push(pair);
        }
        per_profile.push((profile_name.clone(), metrics::metrics(&pairs)));
    }
    let all: Vec<Pair> = rows.iter().map(|r| r.pair).collect();
    let kept: Vec<Pair> = rows
        .iter()
        .filter(|r| !r.owner_decision)
        .map(|r| r.pair)
        .collect();
    SetRun {
        total: metrics::metrics(&all),
        kept: Exclusions::of(&kept),
        rows,
        per_profile,
    }
}

/// Debugging aid: `HELDOUT_EXPLAIN="heldout1 sample_profile D11"` prints the reasons of that
/// pair (with `heldout_rows -- --nocapture`); several pairs are separated by `;`, `disagree`
/// names every pair whose exclusion the label does not share or whose grade 3 is buried,
/// `low` every relevant pair (grade 2 or 3) below 60, and `HELDOUT_ONLY=heldout1` runs one
/// set.
fn explain(pair_name: &str, a: &Assessment, grade: u8, label_excluded: bool) {
    let Ok(wanted) = std::env::var("HELDOUT_EXPLAIN") else {
        return;
    };
    let excluded = a.verdict == Verdict::Excluded;
    let disagree =
        excluded != label_excluded || (grade == 3 && !label_excluded && (excluded || a.score < 40));
    let low = grade >= 2 && !label_excluded && a.score < 60;
    let named = wanted.split(';').any(|p| p.trim() == pair_name);
    if !((wanted == "disagree" && disagree) || (wanted == "low" && low) || named) {
        return;
    }
    println!(
        "{pair_name} score {} grade {grade} label excluded {label_excluded}",
        a.score
    );
    for r in &a.reasons {
        let evidence = r.evidence.as_ref().map(|e| e.profile.as_str());
        println!(
            "  {:?} {:?} {:?} {:?} <- {evidence:?} {}",
            r.kind,
            r.weight,
            r.code,
            r.label,
            Value::Object(r.params.clone())
        );
    }
}

/// What a set must reach (frozen from the engine; see `docs/MATCHING.md`).
struct Floor {
    ndcg10: f64,
    spearman: f64,
    exclusion_precision: f64,
    exclusion_recall: f64,
    /// Exclusion recall without the labels of the owner's decisions (`SetRun::kept`).
    kept_recall: f64,
    grade3_buried: usize,
}

/// Engine 18 (a product decision, 2026-09-27): the years an ad asks for are judged against the
/// profile's own years and never exclude, so the pairs the labels exclude only for the retired
/// target years (`zielprofil_min_jahre`) are scored now. The recall floors (and NDCG@10 and
/// Spearman where those pairs reach the top) follow.
///
/// Engine 19 (Profil-JSON v19, `docs/MATCHING.md`): every profile is migrated to v19, which
/// keeps no title, USPs or career stations; the pairs the labels excluded only for remote work
/// abroad or the region of permanent roles (rules v19 dropped) are relabeled. The floors below
/// that moved follow the migrated profiles; on the same profiles engine 18 reaches no more.
///
/// Engine 19, second round (ESCO under the engine's words, the gap finder's fills, the error
/// analysis, `docs/MATCHING.md`): the floors of sets 2 to 9 that rose follow.
///
/// Engine 20 (the labels' second pass, 2026-10-10): 18 pairs the first relabel missed (remote
/// work abroad, the region of a permanent role) are relabeled, which raised the recall of sets
/// 6 to 8. The labels that exclude only by the owner's decisions (the retired target years,
/// the hourly pay of agency or student work as a day rate; `labels::OWNER_DECISION`) stay
/// as the labelers wrote them; `kept_recall` leaves them out, so it measures what the engine
/// is meant to find.
const HELDOUT1: Floor = Floor {
    ndcg10: 0.92,
    spearman: 0.74,
    exclusion_precision: 1.0,
    exclusion_recall: 0.97,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// Engine 21: a certificate the ad makes mandatory and the profile does not hold in full
/// excludes, as the rubric says (V02 for P2 and P3; X02 of set 2 relabeled for P3): recall
/// 0.970 and every kept exclusion.
const HELDOUT4: Floor = Floor {
    ndcg10: 0.83,
    spearman: 0.54,
    exclusion_precision: 1.0,
    exclusion_recall: 0.97,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// Engine 18 moved set 3 most (0.955 to 0.869): P1's S01 (grade 3, the labels exclude it for
/// `Mindestens 8 Jahre` below the target of 10) now leads its list, and the target-year
/// exclusions of P1, P4, sap and senior (S01, S05, S06, R02) are scored.
const HELDOUT3: Floor = Floor {
    ndcg10: 0.87,
    spearman: 0.47,
    exclusion_precision: 1.0,
    exclusion_recall: 0.90,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// The ANÜ wage policy, decided in version 16: the hourly pay of temporary agency work
/// (`82 € entspricht dem Bruttostundenlohn`) is employment pay, no day rate, as the labels
/// read it (F03 is no longer excluded for two profiles by a day rate, F08 is by its salary
/// per year).
const HELDOUT6: Floor = Floor {
    ndcg10: 0.90,
    spearman: 0.51,
    exclusion_precision: 1.0,
    exclusion_recall: 0.98,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// Set 5 excludes C10 (a student job) for two profiles by its hourly wage per year, the
/// rule of set 3 (T04); the set-5 labels read a student wage as no salary. The labels of the
/// two sets disagree, the engine keeps the set-3 rule, so the precision floor is below 1.
const HELDOUT5: Floor = Floor {
    ndcg10: 0.80,
    spearman: 0.48,
    exclusion_precision: 0.98,
    exclusion_recall: 0.95,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// Set 7 at the level of engine 12 (the hard criteria read only the ad, not the other
/// listings under it; first contact with engine 10 gave 0.900, 0.438, 0.973 and 3 buried):
/// the student jobs the labelers exclude by their wage stay in for ten profiles. Recall 0.88
/// until version 16: the hourly pay of temporary agency work is employment pay, never a day
/// rate (the user's decision), so the agency jobs L02, L05, M05 and M15 the labels exclude
/// by that pay x 8 stay in for the freelance profiles that allow ANÜ and set no salary
/// (0.844; remote work abroad a profile rules out, decided since version 16, gives 0.863).
/// Engine 21: a monthly salary decides when even fourteen of them stay below the minimum
/// (M14 of four profiles, back to excluded in the labels), 0.870 and every kept exclusion.
/// Engine 22 (the aggregation repaired; 0.916 to 0.910): P14's J11 ends at 39, one point
/// under the line, because its two open SAP musts weigh in the saturating `M` beside the
/// partial lead of digitalisation projects (third buried with K06 and J08).
const HELDOUT7: Floor = Floor {
    ndcg10: 0.90,
    spearman: 0.44,
    exclusion_precision: 0.98,
    exclusion_recall: 0.87,
    kept_recall: 1.0,
    grade3_buried: 3,
};
/// The agency wage of version 16 costs the recall of set 7's reason (N03, N16, Q15, S05,
/// S16); the rules of set 9 bring it back to 0.850. Engine 19: P10's S07 (a hybrid permanent
/// role at the cap of 40) loses a point to the work mode `remote` its migrated profile wishes
/// (`ueberwiegend` before). Engine 21: the monthly salary of Q14 decides for four profiles
/// (back to excluded in the labels).
const HELDOUT8: Floor = Floor {
    ndcg10: 0.95,
    spearman: 0.41,
    exclusion_precision: 1.0,
    exclusion_recall: 0.87,
    kept_recall: 0.986,
    grade3_buried: 0,
};
/// Set 9 after the one correction round of engine 16 (first contact 0.828, 0.407, 0.908,
/// 0.923 and 4 buried; engine 15 0.814 and 5 buried): the target years the labels read
/// differently between profiles (tooJunior for P7 and P8 against the labels, a senior title
/// with fewer years than P9 and P12 ask for left in) stay as they are. Engine 20 (the owner's
/// decision of 2026-10-10: no Schwerpunkte, every competence counts the same) moved NDCG@10
/// from 0.900 to 0.889, engine 21 (the owner's decision of 2026-10-10: the industries are
/// experience, no wish; every profile of the set starred some) to 0.869; the floor follows those
/// decisions.
const HELDOUT9: Floor = Floor {
    ndcg10: 0.868,
    spearman: 0.44,
    exclusion_precision: 0.98,
    exclusion_recall: 0.85,
    kept_recall: 1.0,
    grade3_buried: 0,
};
/// Engine 9 moved set 2 from 0.864 to 0.856: a language met is a light fit now, so off-field
/// ads whose only fitting musts are languages (grade 0 and 1 alike) fall below the cap they
/// shared, and Y05 loses its German where `Projekt Management` (written apart) stays open.
/// Recall 1.0 and Spearman 0.64 until version 16, for the reason of set 7 (X06 for P2 is
/// scored, 0.640 -> 0.639). Engine 22 (the aggregation repaired) moved it from 0.896 to 0.873:
/// in two lists of 24 one grade-2 job passes a grade-3 job (P3's X09 before X07, the senior
/// profile's); the loss is a little above 0.02, every other gate of the set holds.
const HELDOUT2: Floor = Floor {
    ndcg10: 0.87,
    spearman: 0.62,
    exclusion_precision: 1.0,
    exclusion_recall: 0.84,
    kept_recall: 1.0,
    grade3_buried: 0,
};

/// Set 10 (customer service, CX, ITSM and marketing), its floors set after engine 19 as the
/// plan decided. Engine 21 (no industry wish, the owner's decision) moved Spearman from 0.705 to
/// 0.697.
const HELDOUT10: Floor = Floor {
    ndcg10: 0.94,
    spearman: 0.69,
    exclusion_precision: 1.0,
    exclusion_recall: 1.0,
    kept_recall: 1.0,
    grade3_buried: 0,
};

fn misses(run: &SetRun) -> String {
    let list = |f: &dyn Fn(&Row) -> bool| -> Vec<String> {
        run.rows
            .iter()
            .filter(|r| f(r))
            .map(|r| format!("{} {}", r.profile.trim_end_matches(".json"), r.job))
            .collect()
    };
    let missed = |r: &Row| r.pair.outcome != Outcome::Excluded && r.pair.label_excluded;
    format!(
        "buried grade 3: {:?}\nwrong exclusions: {:?}\nmissed exclusions: {:?}\n\
         missed exclusions without the owner's decisions: {:?}",
        list(&|r| r.pair.gain() == 3 && r.pair.buried()),
        list(&|r| r.pair.outcome == Outcome::Excluded && !r.pair.label_excluded),
        list(&missed),
        list(&|r| missed(r) && !r.owner_decision),
    )
}

fn check(name: &str, floor: &Floor) {
    let run = run_set(name);
    let t = &run.total.ranking;
    let e = &run.total.exclusions;
    let report = format!(
        "{name}\n{}\n{}",
        metrics::table(&run.per_profile, &run.total),
        misses(&run)
    );
    assert!(
        e.precision().unwrap_or(1.0) >= floor.exclusion_precision,
        "exclusions the labels do not share:\n{report}"
    );
    assert!(
        e.recall().unwrap_or(1.0) >= floor.exclusion_recall,
        "exclusion recall:\n{report}"
    );
    assert!(
        run.kept.recall().unwrap_or(1.0) >= floor.kept_recall,
        "exclusion recall without the owner's decisions:\n{report}"
    );
    assert!(t.ndcg10 >= floor.ndcg10, "NDCG@10:\n{report}");
    assert!(t.spearman >= floor.spearman, "Spearman:\n{report}");
    assert!(
        t.grade3_low <= floor.grade3_buried,
        "buried grade-3 jobs:\n{report}"
    );
    // A source without search terms keeps only the titles that reach the floor: no job of
    // the high band falls below it.
    let lost: Vec<String> = run
        .rows
        .iter()
        .filter(|r| {
            r.pair.outcome == Outcome::Scored
                && r.pair.score >= jobalert_core::model::HIGH_FROM
                && r.prescore < jobalert_core::fetch::search::PRESCORE_FLOOR
        })
        .map(|r| format!("{} {} ({})", r.profile, r.job, r.prescore))
        .collect();
    assert!(
        lost.is_empty(),
        "high-band jobs below the pre-score floor: {lost:?}"
    );
}

#[test]
fn heldout1_holds_its_gates() {
    check("heldout1", &HELDOUT1);
}

#[test]
fn heldout2_holds_its_gates() {
    check("heldout2", &HELDOUT2);
}

#[test]
fn heldout3_holds_its_gates() {
    check("heldout3", &HELDOUT3);
}

#[test]
fn heldout4_holds_its_gates() {
    check("heldout4", &HELDOUT4);
}

#[test]
fn heldout5_holds_its_gates() {
    check("heldout5", &HELDOUT5);
}

#[test]
fn heldout6_holds_its_gates() {
    check("heldout6", &HELDOUT6);
}

#[test]
fn heldout7_holds_its_gates() {
    check("heldout7", &HELDOUT7);
}

#[test]
fn heldout8_holds_its_gates() {
    check("heldout8", &HELDOUT8);
}

#[test]
fn heldout9_holds_its_gates() {
    check("heldout9", &HELDOUT9);
}

#[test]
fn heldout10_holds_its_gates() {
    check("heldout10", &HELDOUT10);
}

/// Every held-out set.
const SETS: [&str; 10] = [
    "heldout1",
    "heldout2",
    "heldout3",
    "heldout4",
    "heldout5",
    "heldout6",
    "heldout7",
    "heldout8",
    "heldout9",
    "heldout10",
];

/// Prints every set's tables and misses (`-- --ignored heldout_report --nocapture`), then
/// one line per set with the numbers of `docs/MATCHING.md`.
#[test]
#[ignore = "report"]
fn heldout_report() {
    let mut lines = Vec::new();
    for name in SETS {
        let run = run_set(name);
        println!("## {name}\n");
        println!("{}", metrics::table(&run.per_profile, &run.total));
        println!("{}", metrics::order_table(&run.per_profile, &run.total));
        println!("{}", metrics::gate_table(&metrics::gates(&run.total)));
        println!("{}\n", misses(&run));
        lines.push(summary_line(name, &run.total, &run.kept));
    }
    println!(
        "| Set | NDCG@10 | P@5 | Spearman relevant | Concordance 2v3 | Concordance 1v2 | \
         Buried | Exclusions P / R | R kept |\n|---|---|---|---|---|---|---|---|---|"
    );
    for line in lines {
        println!("{line}");
    }
}

/// The pre-scores of the titles by grade (`-- --ignored prescore_report --nocapture`): what
/// the floor of the sources without a search term may drop.
#[test]
#[ignore = "report"]
fn prescore_report() {
    let mut by_grade: [Vec<u16>; 4] = Default::default();
    let mut high = Vec::new();
    for name in SETS {
        for r in run_set(name).rows {
            if r.pair.label_excluded {
                continue;
            }
            by_grade[usize::from(r.pair.grade.min(3))].push(r.prescore);
            if r.pair.outcome == Outcome::Scored && r.pair.score >= 70 {
                high.push((r.prescore, format!("{name} {} {}", r.profile, r.job)));
            }
        }
    }
    for (grade, scores) in by_grade.iter_mut().enumerate() {
        scores.sort_unstable();
        let at = |q: usize| scores.get(scores.len() * q / 100).copied().unwrap_or(0);
        println!(
            "grade {grade}: {} pairs, min {} p5 {} p10 {} p25 {} median {}",
            scores.len(),
            scores.first().copied().unwrap_or(0),
            at(5),
            at(10),
            at(25),
            at(50)
        );
        for floor in [50, 100, 150, 200, 250, 300] {
            let below = scores.iter().filter(|s| **s < floor).count();
            println!("  below {floor}: {below}");
        }
    }
    high.sort();
    println!("lowest high matches: {:?}", &high[..high.len().min(10)]);
}

/// One row of the per-set table of `docs/MATCHING.md`.
fn summary_line(name: &str, m: &Metrics, kept: &Exclusions) -> String {
    let three = |v: Option<f64>| v.map_or_else(|| "n/a".to_owned(), |v| format!("{v:.3}"));
    let r = &m.ranking;
    format!(
        "| {name} | {:.3} | {:.3} | {} | {} | {} | {} | {} / {} | {} |",
        r.ndcg10,
        r.p5,
        three(r.spearman_relevant),
        three(r.concordance_of(2, 3).share),
        three(r.concordance_of(1, 2).share),
        r.grade3_low,
        three(m.exclusions.precision()),
        three(m.exclusions.recall()),
        three(kept.recall()),
    )
}

/// Every pair of both sets (`-- --ignored heldout_rows --nocapture`): score, verdict,
/// grade, label exclusion.
#[test]
#[ignore = "debugging aid"]
fn heldout_rows() {
    let only = std::env::var("HELDOUT_ONLY").ok();
    for name in SETS
        .into_iter()
        .filter(|name| only.as_deref().is_none_or(|o| o == *name))
    {
        for r in run_set(name).rows {
            let p = r.pair;
            println!(
                "{name} {} {} score {} {:?} grade {} excluded {}",
                r.profile.trim_end_matches(".json"),
                r.job,
                p.score,
                p.outcome,
                p.grade,
                p.label_excluded
            );
        }
    }
}
