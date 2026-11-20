"""Trains the learned scorer of the matching engine and writes its tables.

    py -3.14 -X utf8 -I tools/scorer/train.py --labels <consensus.jsonl> --signals <eNN.jsonl>
        --out core/src/matching/scorer_tables.rs [--train-splits train] [--report-splits test,locked]

Inputs (both private, never in the repo):
  --signals  the engine's signals per pair: a header line {"names", "sign", "max"} and then
             one line per pair {"pair", "profile", "split", "group", "v": [...]}.
  --labels   the teachers' consensus per pair: {"pair", "passung" 0-100, "punkte", "note" 0-3,
             "drop"}. A pair with "drop": true or without "passung" is left out.

Model: cyclic boosting of an additive model. Each signal is cut into at most MAX_BINS
quantile bins of at least MIN_BIN pairs; each pass walks the signals in order and moves
every bin of one signal by LEARNING_RATE times the mean residual of its pairs (L2 loss).
After each pass every signal with a direction (sign +1 or -1) is projected onto a
monotone table (PAVA, weighted by the bin counts); free signals (sign 0) keep their shape.
Tables are centred, their means go into the intercept.

Evaluation: 5 folds grouped by "group" on the training pairs give out-of-fold predictions.
Calibration maps the out-of-fold predictions onto the distribution of the training labels
by quantile matching at CALIB_KNOTS knots (piecewise linear), which undoes the shrink to the
mean. The final model is fitted on all training pairs.

Output: a Rust file with INTERCEPT (tenths of a point), TABLES (per signal, the lower edge of
each bin and its points in tenths) and CALIB (knots in tenths), all integer. The report
prints Spearman and NDCG@10 per profile, out of fold on the training split and with the
integer model on every report split.
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
        if row.get("drop") or row.get("passung") is None:
            continue
        labels[row["pair"]] = row
    return labels


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


def calibration(pred_tenths, label_tenths):
    """CALIB_KNOTS knots (x strictly rising in 0..1000, y non-decreasing in 0..1000)."""
    q = np.linspace(0.0, 1.0, CALIB_KNOTS)
    xs = np.clip(np.round(np.quantile(pred_tenths, q)), 0, 1000).astype(int).tolist()
    ys = np.clip(np.round(np.quantile(label_tenths, q)), 0, 1000).astype(int).tolist()
    for k in range(1, CALIB_KNOTS):
        xs[k] = max(xs[k], xs[k - 1] + 1)
        ys[k] = max(ys[k], ys[k - 1])
    for k in range(CALIB_KNOTS - 1, -1, -1):
        upper = 1000 - (CALIB_KNOTS - 1 - k)
        xs[k] = min(xs[k], upper if k == CALIB_KNOTS - 1 else min(upper, xs[k + 1] - 1))
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


def ndcg(pred, notes, k=TOP_K):
    gains = np.asarray([2 ** int(n) - 1 for n in notes], dtype=float)
    if gains.sum() == 0:
        return float("nan")
    order = np.argsort(-np.asarray(pred, dtype=float), kind="mergesort")
    discounts = 1.0 / np.log2(np.arange(2, k + 2))
    dcg = (gains[order][:k] * discounts[: min(k, len(gains))]).sum()
    ideal = (np.sort(gains)[::-1][:k] * discounts[: min(k, len(gains))]).sum()
    return float(dcg / ideal)


def note_of(label):
    note = label.get("note")
    if note is None:
        note = min(3, int(label["passung"]) // 25)
    return int(note)


def report(title, rows, pred, labels):
    print(f"{title}: {len(rows)} pairs")
    profiles = sorted({r["profile"] for r in rows})
    all_y = [labels[r["pair"]]["passung"] for r in rows]
    print(f"  all        spearman {spearman(pred, all_y):6.3f}")
    nd = []
    for p in profiles:
        idx = [i for i, r in enumerate(rows) if r["profile"] == p]
        y = [all_y[i] for i in idx]
        notes = [note_of(labels[rows[i]["pair"]]) for i in idx]
        pr = [pred[i] for i in idx]
        n = ndcg(pr, notes)
        if not np.isnan(n):
            nd.append(n)
        print(f"  {p:10s} n {len(idx):4d}  spearman {spearman(pr, y):6.3f}  ndcg@10 {n:6.3f}")
    if nd:
        print(f"  mean ndcg@10 over profiles {float(np.mean(nd)):6.3f}")


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
    train = [r for r in rows if r["split"] in train_splits and r["pair"] in labels]
    if len(train) < 2 * MIN_BIN:
        sys.exit(f"only {len(train)} labelled training pairs; at least {2 * MIN_BIN} are needed")

    X = np.asarray([r["v"] for r in train], dtype=np.int64)
    y = np.asarray([float(labels[r["pair"]]["passung"]) for r in train])
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

    print(f"signals {len(names)}, training pairs {len(train)} (splits {sorted(train_splits)})")
    for name, table in zip(names, ints):
        if len(table) > 1:
            span = max(p for _, p in table) - min(p for _, p in table)
            print(f"  {name:14s} bins {len(table):2d}  span {span / 10:6.1f} points")
    report("train, out of fold", train, oof_cal, labels)
    for split in [s for s in args.report_splits.split(",") if s]:
        part = [r for r in rows if r["split"] == split and r["pair"] in labels]
        if not part:
            print(f"{split}: no labelled pairs")
            continue
        pred = [calibrate(knots, integer_raw(int_b, ints, r["v"])) for r in part]
        report(f"{split}, integer model", part, pred, labels)

    Path(args.out).write_text(rust(names, int_b, ints, knots, len(train)), encoding="utf-8", newline="\n")
    print(f"wrote {args.out}")


if __name__ == "__main__":
    main()
