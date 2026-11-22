"""Trains the learned scorer of the matching engine and writes its tables.

    py -3.14 -X utf8 -I tools/scorer/train.py --labels <consensus.jsonl> --signals <eNN.jsonl>
        --out core/src/matching/scorer_tables.rs [--train-splits train] [--report-splits test,locked]

Inputs (both private, never in the repo):
  --signals  the engine's signals per pair: a header line {"names", "sign", "max"} and then
             one line per pair {"pair", "profile", "split", "group", "v": [...]}.
             A dump with the trace of each pair ("learned", "wish", "permanent", "caps") lets the
             report replay the engine's points after the fit.
  --labels   the teachers' consensus per pair: {"pair", "passung" 0-100, "punkte", "note" 0-3,
             "drop", "excluded"}. A pair with "drop": true or without "note" is left out; a pair
             the teachers excluded counts as note 0 (the gain of retrain.sh and metrics.rs).
             Optional: "split" moves the pair to that split (a graded test pair into training),
             "weight" (a whole number, default 1) counts it that many times in the fit and the
             calibration (a stronger teacher's label).

Target: the score of the pair's note (NOTE_TARGET, 0 -> 12 ... 3 -> 88).

Model: cyclic boosting of an additive model. Each signal is cut into at most MAX_BINS
quantile bins of at least MIN_BIN pairs; each pass walks the signals in order and moves
every bin of one signal by LEARNING_RATE times the mean residual of its pairs (L2 loss).
After each pass every signal with a direction (sign +1 or -1) is projected onto a
monotone table (PAVA, weighted by the bin counts); free signals (sign 0) keep their shape.
Tables are centred, their means go into the intercept.

Evaluation: 5 folds grouped by "group" on the training pairs give out-of-fold predictions.
Calibration is the isotonic (PAVA) map of the out-of-fold predictions to NOTE_TARGET of each
pair's note, read at CALIB_KNOTS quantiles of the predictions (piecewise linear between them):
it undoes the shrink to the mean and puts each note at its score. The final model is fitted
on all training pairs.

Output: a Rust file with INTERCEPT (tenths of a point), TABLES (per signal, the lower edge of
each bin and its points in tenths) and CALIB (knots in tenths), all integer. The report
prints Spearman and NDCG@10 per profile, out of fold on the training split and with the
integer model on every report split; with a traced dump both replay the engine's points
(`replay`, the mirror of `points` and `final_score` in engine.rs) and order the pairs as
retrain.sh does (scored, unscorable, excluded; then score, then the points before the caps).
"""

import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

MAX_BINS = 16
MIN_BIN = 20
PASSES = 30
LEARNING_RATE = 0.3
FOLDS = 5
CALIB_KNOTS = 21
TOP_K = 10
# The score (tenths) a note is calibrated to.
NOTE_TARGET = {0: 120, 1: 450, 2: 680, 3: 880}

# The mirror of engine.rs `points` and `final_score` (change both together).
WISH_MAX = 100
PERMANENT_FACTOR = 900
CAPS = {"formal", "severalOpen", "offField", "junior", "level"}
VERDICT_ORDER = {"scored": 0, "unscorable": 1, "excluded": 2}


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def read_signals(path):
    rows = read_jsonl(path)
    if not rows or "names" not in rows[0]:
        sys.exit(f"{path}: the first line must be the header with names, sign and max")
    return rows[0], rows[1:]


def read_labels(path):
    labels = {}
    for row in read_jsonl(path):
        if row.get("drop") or row.get("note") is None:
            continue
        labels[row["pair"]] = row
    return labels


def split_of(row, labels):
    """The split of a pair: its label's, else the dump's."""
    return labels.get(row["pair"], {}).get("split") or row["split"]


def weight_of(label):
    return max(1, int(label.get("weight", 1)))


def note_of(label):
    """The note a pair counts with: 0 when the teachers excluded it."""
    return 0 if label.get("excluded") else int(label["note"])


# -- bins -----------------------------------------------------------------------------------


def bin_edges(values):
    """Lower edges of at most MAX_BINS quantile bins with at least MIN_BIN values each;
    the first edge is 0, so every value falls into a bin."""
    values = np.sort(np.asarray(values, dtype=np.int64))
    n = len(values)
    if n < 2 * MIN_BIN:
        return [0]
    target = max(MIN_BIN, int(np.ceil(n / MAX_BINS)))
    uniques, counts = np.unique(values, return_counts=True)
    edges, filled = [0], 0
    for value, count in zip(uniques, counts):
        if filled >= target and n - sum_before(uniques, counts, value) >= MIN_BIN:
            edges.append(int(value))
            filled = 0
        filled += int(count)
    return edges[:MAX_BINS]


def sum_before(uniques, counts, value):
    return int(counts[uniques < value].sum())


def bin_index(edges, values):
    return np.searchsorted(np.asarray(edges), np.asarray(values), side="right") - 1


# -- model ----------------------------------------------------------------------------------


def pava(values, weights, increasing):
    """Weighted isotonic regression of a sequence (non-decreasing, or non-increasing)."""
    if not increasing:
        return -pava(-values, weights, True)
    blocks = []  # [mean, weight, count]
    for v, w in zip(values, weights):
        blocks.append([float(v), float(max(w, 1e-9)), 1])
        while len(blocks) > 1 and blocks[-2][0] > blocks[-1][0]:
            m2, w2, c2 = blocks.pop()
            m1, w1, c1 = blocks.pop()
            blocks.append([(m1 * w1 + m2 * w2) / (w1 + w2), w1 + w2, c1 + c2])
    out = []
    for m, _, c in blocks:
        out.extend([m] * c)
    return np.asarray(out)


def fit(bins, y, signs, n_bins):
    """Cyclic boosting: returns the intercept and one table per signal."""
    n, m = bins.shape
    intercept = float(y.mean())
    tables = [np.zeros(n_bins[j]) for j in range(m)]
    pred = np.full(n, intercept)
    for _ in range(PASSES):
        for j in range(m):
            if n_bins[j] < 2:
                continue
            residual = y - pred
            counts = np.bincount(bins[:, j], minlength=n_bins[j])
            sums = np.bincount(bins[:, j], weights=residual, minlength=n_bins[j])
            step = np.where(counts > 0, sums / np.maximum(counts, 1), 0.0) * LEARNING_RATE
            tables[j] += step
            pred += step[bins[:, j]]
        for j in range(m):
            if n_bins[j] < 2:
                continue
            counts = np.bincount(bins[:, j], minlength=n_bins[j])
            if signs[j] != 0:
                tables[j] = pava(tables[j], counts, signs[j] > 0)
            mean = float((tables[j] * counts).sum() / max(counts.sum(), 1))
            tables[j] -= mean
            intercept += mean
        pred = predict(intercept, tables, bins)
    return intercept, tables


def predict(intercept, tables, bins):
    pred = np.full(bins.shape[0], intercept)
    for j, table in enumerate(tables):
        pred += table[bins[:, j]]
    return pred


def fold_of(group):
    return int(hashlib.sha1(f"{group}|fold".encode()).hexdigest(), 16) % FOLDS


# -- calibration ----------------------------------------------------------------------------


def calibration(pred_tenths, target_tenths):
    """The isotonic map of the predictions to the targets as CALIB_KNOTS knots (x strictly
    rising in 0..1000, y non-decreasing in 0..1000), the knots at quantiles of the
    predictions from the lowest to the highest (flat outside them)."""
    pred = np.clip(np.round(np.asarray(pred_tenths, dtype=float)), 0, 1000).astype(int)
    target = np.asarray(target_tenths, dtype=float)
    order = np.argsort(pred, kind="mergesort")
    xs_sorted, fitted = pred[order], pava(target[order], np.ones(len(pred)), True)
    q = np.linspace(0.0, 1.0, CALIB_KNOTS)
    xs = np.round(np.quantile(xs_sorted, q)).astype(int).tolist()
    for k in range(1, CALIB_KNOTS):
        xs[k] = max(xs[k], xs[k - 1] + 1)
    for k in range(CALIB_KNOTS - 2, -1, -1):
        xs[k] = min(xs[k], xs[k + 1] - 1)

    def at(x):
        """The fitted value of the last prediction at or below x (the first one below all)."""
        i = int(np.searchsorted(xs_sorted, x, side="right")) - 1
        return float(fitted[max(i, 0)])

    ys = [int(np.clip(round(at(x)), 0, 1000)) for x in xs]
    for k in range(1, CALIB_KNOTS):
        ys[k] = max(ys[k], ys[k - 1])
    return list(zip(xs, ys))


def calibrate(knots, v):
    """Integer piecewise linear, as `scorer.rs` computes it."""
    if v <= knots[0][0]:
        return knots[0][1]
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if v <= x1:
            return y0 + (y1 - y0) * (v - x0) // (x1 - x0)
    return knots[-1][1]


# -- integer model --------------------------------------------------------------------------


def integer_model(intercept, tables, edges):
    ints = [[(int(e), int(round(10 * t))) for e, t in zip(edges[j], tables[j])] for j in range(len(tables))]
    return int(round(10 * intercept)), ints


def integer_raw(intercept, ints, v):
    total = intercept
    for j, table in enumerate(ints):
        points = table[0][1]
        for edge, p in table:
            if v[j] >= edge:
                points = p
        total += points
    return min(1000, max(0, total))


# -- metrics --------------------------------------------------------------------------------


def ranks(x):
    x = np.asarray(x, dtype=float)
    order = np.argsort(x, kind="mergesort")
    r = np.empty(len(x))
    r[order] = np.arange(len(x))
    for value in np.unique(x):
        same = x == value
        r[same] = r[same].mean()
    return r


def spearman(a, b):
    if len(a) < 3:
        return float("nan")
    ra, rb = ranks(a), ranks(b)
    if ra.std() == 0 or rb.std() == 0:
        return float("nan")
    return float(np.corrcoef(ra, rb)[0, 1])


def round_half_even(n, d):
    q, r = divmod(n, d)
    return q + (1 if 2 * r > d or (2 * r == d and q % 2 == 1) else 0)


def replay(fit, row, caps=None):
    """The engine's (score, points before the caps, verdict) of a pair from its learned fit
    (per-mille): the bounded wishes, a permanent role at PERMANENT_FACTOR, the rounding and the
    caps (CAPS, or the codes given). A dump without a trace gives the fit itself."""
    caps = CAPS if caps is None else caps
    verdict = row.get("verdict") or "scored"
    if "caps" not in row:
        return fit / 10, fit, verdict
    if verdict == "unscorable":
        return 0, 0, verdict
    points = min(1000, max(0, fit + max(-WISH_MAX, min(WISH_MAX, row["wish"]))))
    if row["permanent"]:
        points = points * PERMANENT_FACTOR // 1000
    score = min([min(100, round_half_even(points, 10))] + [c for k, c in row["caps"] if k in caps])
    return score, points, verdict


def ndcg(keys, notes, k=TOP_K):
    """NDCG@k of the pairs ordered by their keys (smallest first)."""
    gains = np.asarray([2 ** int(n) - 1 for n in notes], dtype=float)
    if gains.sum() == 0:
        return float("nan")
    order = sorted(range(len(keys)), key=lambda i: keys[i])
    discounts = 1.0 / np.log2(np.arange(2, k + 2))
    dcg = (gains[order][:k] * discounts[: min(k, len(gains))]).sum()
    ideal = (np.sort(gains)[::-1][:k] * discounts[: min(k, len(gains))]).sum()
    return float(dcg / ideal)


def measure(rows, fits, labels, caps=None):
    """Mean NDCG@10 over profiles, the mean score per note (scored pairs), NDCG@10 per profile
    and the replay of every pair."""
    out = [replay(f, r, caps) for f, r in zip(fits, rows)]
    keys = [(VERDICT_ORDER[v], -s, -p, r["pair"]) for (s, p, v), r in zip(out, rows)]
    notes = [note_of(labels[r["pair"]]) for r in rows]
    per = {}
    for p in sorted({r["profile"] for r in rows}):
        idx = [i for i, r in enumerate(rows) if r["profile"] == p]
        per[p] = (len(idx), ndcg([keys[i] for i in idx], [notes[i] for i in idx]))
    nd = [n for _, n in per.values() if not np.isnan(n)]
    means = {}
    for note in range(4):
        s = [o[0] for o, n in zip(out, notes) if o[2] == "scored" and n == note]
        means[note] = (float(np.mean(s)) if s else float("nan"), len(s))
    return float(np.mean(nd)) if nd else float("nan"), means, per, out


def report(title, rows, fits, labels):
    nd, means, per, out = measure(rows, fits, labels)
    print(f"{title}: {len(rows)} pairs")
    notes = [note_of(labels[r["pair"]]) for r in rows]
    print(f"  all        spearman {spearman([o[0] for o in out], notes):6.3f}")
    for p, (n, v) in per.items():
        print(f"  {p:10s} n {n:4d}  ndcg@10 {v:6.3f}")
    grades = "  ".join(f"{g}: {m:5.1f} (n {c})" for g, (m, c) in sorted(means.items(), reverse=True))
    print(f"  mean ndcg@10 over profiles {nd:6.3f}; mean score per note {grades}")


# -- output ---------------------------------------------------------------------------------


def rust(names, intercept, ints, knots, n_train):
    lines = [
        "//! generated by tools/scorer/train.py from private teacher labels; do not edit.",
        f"//! {n_train} training pairs, {PASSES} passes, learning rate {LEARNING_RATE}, at most",
        f"//! {MAX_BINS} bins of at least {MIN_BIN} pairs, {CALIB_KNOTS} calibration knots.",
        "//! Points and knots in tenths of a score point.",
        "",
        "use super::signals::N;",
        "",
        "/// The points every job starts from.",
        f"pub(crate) const INTERCEPT: i32 = {intercept};",
        "",
        "/// Per signal: the lower edge of each bin and its points.",
        "pub(crate) const TABLES: [&[(u16, i16)]; N] = [",
    ]
    for name, table in zip(names, ints):
        body = ", ".join(f"({e}, {p})" for e, p in table)
        lines.append(f"    // {name}")
        lines.append(f"    &[{body}],")
    lines.append("];")
    lines.append("")
    lines.append("/// The calibration knots: raw points to points.")
    body = ", ".join(f"({x}, {y})" for x, y in knots)
    lines.append(f"pub(crate) const CALIB: [(u16, u16); {CALIB_KNOTS}] = [{body}];")
    return "\n".join(lines) + "\n"


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--labels", required=True)
    parser.add_argument("--signals", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--train-splits", default="train")
    parser.add_argument("--report-splits", default="test,locked")
    args = parser.parse_args()

    header, rows = read_signals(args.signals)
    labels = read_labels(args.labels)
    names, signs = header["names"], header["sign"]
    train_splits = set(args.train_splits.split(","))
    unique = [r for r in rows if r["pair"] in labels and split_of(r, labels) in train_splits]
    if len(unique) < 2 * MIN_BIN:
        sys.exit(f"only {len(unique)} labelled training pairs; at least {2 * MIN_BIN} are needed")
    # A weighted pair counts as that many copies (same group, so the same fold).
    first, train = [], []
    for r in unique:
        first.append(len(train))
        train.extend([r] * weight_of(labels[r["pair"]]))

    X = np.asarray([r["v"] for r in train], dtype=np.int64)
    y = np.asarray([NOTE_TARGET[note_of(labels[r["pair"]])] / 10 for r in train])
    edges = [bin_edges(X[:, j]) for j in range(X.shape[1])]
    n_bins = [len(e) for e in edges]
    bins = np.stack([bin_index(edges[j], X[:, j]) for j in range(X.shape[1])], axis=1)

    folds = np.asarray([fold_of(r["group"]) for r in train])
    oof = np.zeros(len(train))
    for f in range(FOLDS):
        held = folds == f
        if held.all() or not held.any():
            continue
        b, t = fit(bins[~held], y[~held], signs, n_bins)
        oof[held] = predict(b, t, bins[held])

    knots = calibration(np.clip(oof * 10, 0, 1000), y * 10)
    oof_cal = [calibrate(knots, int(round(min(1000, max(0, 10 * p))))) for p in oof]
    intercept, tables = fit(bins, y, signs, n_bins)
    int_b, ints = integer_model(intercept, tables, edges)

    print(
        f"signals {len(names)}, training pairs {len(unique)}, {len(train)} with weights "
        f"(splits {sorted(train_splits)})"
    )
    for name, table in zip(names, ints):
        if len(table) > 1:
            span = max(p for _, p in table) - min(p for _, p in table)
            print(f"  {name:14s} bins {len(table):2d}  span {span / 10:6.1f} points")
    report("train, out of fold", unique, [oof_cal[i] for i in first], labels)
    for split in [s for s in args.report_splits.split(",") if s]:
        part = [r for r in rows if r["pair"] in labels and split_of(r, labels) == split]
        if not part:
            print(f"{split}: no labelled pairs")
            continue
        pred = [calibrate(knots, integer_raw(int_b, ints, r["v"])) for r in part]
        report(f"{split}, integer model", part, pred, labels)

    Path(args.out).write_text(rust(names, int_b, ints, knots, len(unique)), encoding="utf-8", newline="\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
