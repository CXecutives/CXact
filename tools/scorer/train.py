"""Fits the free value of the Passungsgrad (engine 25) on teacher labels and prints it.

    py -3.14 -X utf8 -I tools/scorer/train.py --signals <scores.jsonl> --labels <labels.jsonl>
        --exclude <gold pairs.jsonl> [--splits train,lockbox] [--params core/src/matching/params.rs]

Inputs (all private, never in the repo):
  --signals  the engine's dump of every pair: a header line {"names", "sign", "max"} and then
             one line per pair {"pair", "profile", "v": [...], "score", "rank", "verdict"}.
  --labels   the teacher labels {"pair", "profile", "split", "note", "passung", "excluded",
             "drop"}; only the pairs of --splits are read.
  --exclude  a file of pair lines {"pair", ...}: these pairs never enter the fit (the gold
             pairs: the fit must not see the sets it is checked on).

The fitter replays `scorer.rs` from the signals (`percent` and `caps`, integer arithmetic,
the mirror of the Rust: change both together) and first checks that the replay with the
constants of --params gives every dumped score. Everything with a meaning stays fixed (the
weights 40/40/20, the level and field values, the frame step, the caps, the thresholds of
the field class, UNNAMED by the rubric's rule 8); it searches only what has none,
deterministically on a grid:

  - PARTIAL, what a requirement met in part counts (300 to 950 per-mille).

The objective is NDCG@10 (mean over profiles, the order of gold/eval.py: scored, unscorable,
excluded, then score, then rank) plus Spearman of the score against the teacher's passung
(excluded -1 on both sides). A tie keeps the values nearest the current ones. The output is
the named constants for `core/src/matching/params.rs` and the measures before and after;
the checks on the gold tune part, the owner's 154 and the teacher test split are run apart
(bench/retrain.sh).
"""

import argparse
import json
import math
import re
from collections import defaultdict
from pathlib import Path

E_FULL = 1000
FRAME_ASPECTS = 5
TOP_K = 10
VERDICT_ORDER = {"scored": 0, "unscorable": 1, "excluded": 2}

# The constants the replay reads from params.rs; the fitted ones first.
FITTED = ["PARTIAL"]
FIXED = [
    "UNNAMED",
    "W_ROLE",
    "W_CORE",
    "W_MUSTS",
    "CORE_SATURATION",
    "MUST_SATURATION",
    "LEVEL_ONE",
    "LEVEL_TWO_ABOVE",
    "NICE_MAX",
    "FRAME_STEP",
    "PERMANENT_FACTOR",
    "TITLE_SAME",
    "TITLE_NEAR",
    "HIT_RELEVANCE",
    "HITS_MAX",
    "RELEVANCE_SAME",
    "RELEVANCE_NEAR",
    "RELEVANCE_FAR",
    "FORMAL_CAP",
    "CORE_OPEN_CAP",
    "OFF_FIELD_CAP",
    "JUNIOR_CAP",
    "LEVEL_CAP",
]

GRID = {"PARTIAL": range(300, 951, 50)}


def read_jsonl(path):
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def read_params(path):
    """The constants of params.rs: name -> int (FIELD_VALUES as a list)."""
    text = Path(path).read_text(encoding="utf-8")
    out = {}
    for name, value in re.findall(r"pub\(crate\) const (\w+): u\d+ = (\d+);", text):
        out[name] = int(value)
    values = re.search(r"pub\(crate\) const FIELD_VALUES: \[u64; 4\] = \[([^\]]*)\];", text)
    out["FIELD_VALUES"] = [int(x) for x in values.group(1).split(",")]
    missing = [n for n in FITTED + FIXED if n not in out]
    if missing:
        raise SystemExit(f"{path}: no constant {', '.join(missing)}")
    return out


def div_rhe(n, d):
    """`score::div_round_half_even` for n >= 0."""
    if d == 0:
        return 0
    q, r = divmod(n, d)
    if 2 * r > d or (2 * r == d and q % 2 == 1):
        q += 1
    return q


def share(met, partial, open_, units, fill, p):
    n = met + partial + open_
    units = max(units, n)
    if units == 0:
        return fill
    return (met * E_FULL + partial * p["PARTIAL"] + (units - n) * fill) // units


def field_class(s, p):
    """`scorer::class`: 0 same, 1 near, 2 far, 3 foreign."""
    title, role = s["title_field"], s["role"]
    field = s["relevance"] + p["HIT_RELEVANCE"] * min(s["core_hits"], p["HITS_MAX"])
    if s["off_field"] == 1 and role == 0:
        return 3
    if role == 2 or title >= p["TITLE_SAME"] or field >= p["RELEVANCE_SAME"]:
        return 0
    if role == 1 or title >= p["TITLE_NEAR"] or field >= p["RELEVANCE_NEAR"]:
        return 1
    if field >= p["RELEVANCE_FAR"]:
        return 2
    return 3


def level_factor(level, p):
    if level == 0:
        return 1000
    if level == 3:
        return p["LEVEL_TWO_ABOVE"]
    return p["LEVEL_ONE"]


def taken(points, keep):
    return min(100, div_rhe(points * (1000 - keep), 1000))


def percent(s, p):
    """`scorer::percent`: (total, fine, class)."""
    klass = field_class(s, p)
    role = p["FIELD_VALUES"][klass] * level_factor(s["level"], p) // 1000
    om, op, oo = s["other_met"], s["other_partial"], s["other_open"]
    musts = share(om, op, oo, p["MUST_SATURATION"], role * p["UNNAMED"] // 1000, p)
    fill = role if om + op + oo == 0 else (role + share(om, op, oo, 0, 0, p)) // 2
    core = share(s["core_met"], s["core_partial"], s["core_open"], p["CORE_SATURATION"], fill, p)
    weights = [p["W_ROLE"], p["W_CORE"], p["W_MUSTS"]]
    shares = [role, core, musts]
    parts = sum(min(100, div_rhe(w * sh, 1000)) for w, sh in zip(weights, shares))
    nice_n = s["nice_met"] + s["nice_partial"] + s["nice_open"]
    nice_share = 0 if nice_n == 0 else share(s["nice_met"], s["nice_partial"], s["nice_open"], 0, 0, p)
    nice = min(min(100, div_rhe(p["NICE_MAX"] * nice_share, 1000)), 100 - parts)
    total = parts + nice
    fine = min(1000, (sum(w * sh for w, sh in zip(weights, shares)) + p["NICE_MAX"] * nice_share) // 100)
    for _ in range(min(FRAME_ASPECTS, s["frame_near"] + s["frame_missed"])):
        total -= taken(total, p["FRAME_STEP"])
        fine = fine * p["FRAME_STEP"] // 1000
    if s["permanent"] == 1:
        fine = fine * p["PERMANENT_FACTOR"] // 1000
        total -= taken(total, p["PERMANENT_FACTOR"])
    return total, fine, klass


def caps(s, klass, p):
    """`scorer::caps`: the highest scores the caps allow."""
    out = []
    if s["formal_open"] == 1:
        out.append(p["FORMAL_CAP"])
    core = share(s["core_met"], s["core_partial"], s["core_open"], 0, 0, p)
    if s["core_open"] >= 1 and 2 * core < E_FULL:
        out.append(p["CORE_OPEN_CAP"])
    if klass == 3:
        out.append(p["OFF_FIELD_CAP"])
    if s["junior"] == 1:
        out.append(p["JUNIOR_CAP"])
    if s["level"] == 4:
        out.append(p["LEVEL_CAP"])
    return out


def replay(row, s, p):
    """The engine's (score, rank) of one pair: 0 when unscorable."""
    if row["verdict"] == "unscorable":
        return 0, 0
    total, fine, klass = percent(s, p)
    return min([total] + caps(s, klass, p)), fine


def ranks(x):
    order = sorted(range(len(x)), key=lambda i: x[i])
    out = [0.0] * len(x)
    i = 0
    while i < len(x):
        j = i
        while j + 1 < len(x) and x[order[j + 1]] == x[order[i]]:
            j += 1
        for k in range(i, j + 1):
            out[order[k]] = (i + j) / 2
        i = j + 1
    return out


def spearman(a, b):
    ra, rb = ranks(a), ranks(b)
    n = len(a)
    ma, mb = sum(ra) / n, sum(rb) / n
    cov = sum((x - ma) * (y - mb) for x, y in zip(ra, rb))
    den = math.sqrt(sum((x - ma) ** 2 for x in ra) * sum((y - mb) ** 2 for y in rb))
    return cov / den if den else 0.0


def dcg(gains):
    return sum((2**g - 1) / math.log2(i + 2) for i, g in enumerate(gains))


def measure(pairs, p):
    """NDCG@10 (mean over profiles), Spearman and the mean score per note."""
    scored = []
    for row, s, label in pairs:
        score, rank = replay(row, s, p)
        scored.append((row, label, score, rank))
    by = defaultdict(list)
    for item in scored:
        by[item[0]["profile"]].append(item)
    ndcgs = []
    for _, items in sorted(by.items()):
        items.sort(key=lambda t: (VERDICT_ORDER.get(t[0]["verdict"], 3), -t[2], -t[3], t[0]["pair"]))
        gains = [t[1]["note"] for t in items]
        ideal = dcg(sorted(gains, reverse=True)[:TOP_K])
        if ideal > 0:
            ndcgs.append(dcg(gains[:TOP_K]) / ideal)
    eff = [-1 if t[0]["verdict"] == "excluded" else t[2] for t in scored]
    want = [-1 if t[1]["excluded"] else t[1]["passung"] for t in scored]
    means = {}
    for note in range(4):
        xs = [t[2] for t in scored if t[1]["note"] == note and not t[1]["excluded"] and t[0]["verdict"] == "scored"]
        means[note] = round(sum(xs) / len(xs)) if xs else None
    return sum(ndcgs) / len(ndcgs), spearman(eff, want), means


def objective(pairs, p):
    nd, sp, _ = measure(pairs, p)
    return nd + sp


def distance(p, start):
    return sum(abs(p[k] - start[k]) for k in FITTED)


def better(candidate, best):
    """Higher objective first, then nearer the current values, then the smaller tuple."""
    return (-candidate[0], candidate[1], candidate[2]) < (-best[0], best[1], best[2])


def search(pairs, start):
    """The whole grid of the value (it is small)."""
    best_p = dict(start)
    best = (round(objective(pairs, best_p), 9), 0, tuple(best_p[k] for k in FITTED))
    for partial in GRID["PARTIAL"]:
        p = dict(start, PARTIAL=partial)
        cand = (round(objective(pairs, p), 9), distance(p, start), tuple(p[k] for k in FITTED))
        if better(cand, best):
            best, best_p = cand, p
    return best_p


def load(signals, labels_path, exclude_path, splits):
    rows = read_jsonl(signals)
    header, rows = rows[0], rows[1:]
    names = header["names"]
    excluded = {r["pair"] for r in read_jsonl(exclude_path)}
    labels = {}
    for row in read_jsonl(labels_path):
        if row.get("drop") or row.get("note") is None or row.get("split") not in splits:
            continue
        if row["pair"] in excluded:
            continue
        labels[row["pair"]] = {
            "note": 0 if row["excluded"] else int(row["note"]),
            "passung": -1 if row["excluded"] else row["passung"],
            "excluded": bool(row["excluded"]),
        }
    pairs = [(r, dict(zip(names, r["v"])), labels[r["pair"]]) for r in rows if r["pair"] in labels]
    return rows, names, pairs


def show(title, pairs, p):
    nd, sp, means = measure(pairs, p)
    m = "/".join(str(means[n]) for n in (3, 2, 1, 0))
    print(f"{title}: ndcg@10 {nd:.3f}  spearman {sp:.3f}  mean per note 3/2/1/0 {m}")


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--signals", required=True)
    parser.add_argument("--labels", required=True)
    parser.add_argument("--exclude", required=True)
    parser.add_argument("--splits", default="train,lockbox")
    parser.add_argument("--params", default=str(here / "../../core/src/matching/params.rs"))
    args = parser.parse_args()
    current = read_params(args.params)
    splits = set(args.splits.split(","))
    rows, names, pairs = load(args.signals, args.labels, args.exclude, splits)
    if not pairs:
        raise SystemExit(f"no labelled pairs of {args.splits} in {args.signals}")
    wrong = []
    for row in rows:
        s = dict(zip(names, row["v"]))
        if row.get("score") is not None and replay(row, s, current) != (row["score"], row["rank"]):
            wrong.append(row["pair"])
    if wrong:
        raise SystemExit(f"the replay differs from the engine on {len(wrong)} pairs, e.g. {wrong[:3]}")
    print(f"{len(pairs)} teacher pairs of {args.splits} (gold pairs left out); "
          f"the replay matches all {len(rows)} dumped scores")
    show("current", pairs, current)
    fitted = search(pairs, current)
    show("fitted ", pairs, fitted)
    print("\n// fitted on the teacher labels by tools/scorer/train.py")
    for name in FITTED:
        print(f"pub(crate) const {name}: u64 = {fitted[name]};")


if __name__ == "__main__":
    main()
