"""Fits the weights of the Passungsgrad (engine 25) on graded pairs and prints them.

    py -3.14 -X utf8 -I tools/scorer/train.py --signals <scores.jsonl> --gold <gold.jsonl>
        [--part tune] [--params core/src/matching/params.rs]

Inputs (both private, never in the repo):
  --signals  the engine's dump of every pair: a header line {"names", "sign", "max"} and then
             one line per pair {"pair", "profile", "v": [...], "score", "rank", "verdict"}.
  --gold     graded pairs {"pair", "profile", "gold": part, "answer": {"note", "passung",
             "ausschluss"}}; only the pairs of --part are read.

The fitter replays `scorer.rs` from the signals (`percent` and `caps`, integer arithmetic,
the mirror of the Rust: change both together) and first checks that the replay with the
constants of --params gives every dumped score. It then searches, deterministically:

  - the four weights (W_ROLE, W_CORE, W_MUSTS, W_FRAME), each 10 to 50 in steps of 5, sum 100,
    with the value of a requirement met in part (PARTIAL) on a grid;
  - then the level values (LEVEL_ONE, LEVEL_TWO_ABOVE) on a grid;
  - the two steps once more from the best.

The objective is NDCG@10 (mean over profiles, the order of gold/eval.py: scored, unscorable,
excluded, then score, then rank) plus Spearman of the score against the graded passung
(excluded -1 on both sides). A tie keeps the values nearest the current ones. The output is
the named constants for `core/src/matching/params.rs` and the measures before and after.
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
FITTED = ["W_ROLE", "W_CORE", "W_MUSTS", "W_FRAME", "PARTIAL", "LEVEL_ONE", "LEVEL_TWO_ABOVE"]
FIXED = [
    "MUST_SATURATION",
    "NICE_MAX",
    "PERMANENT_FACTOR",
    "TITLE_SAME",
    "TITLE_NEAR",
    "HIT_RELEVANCE",
    "HITS_MAX",
    "UNNAMED",
    "RELEVANCE_SAME",
    "RELEVANCE_NEAR",
    "RELEVANCE_FAR",
    "FORMAL_CAP",
    "CORE_OPEN_CAP",
    "OFF_FIELD_CAP",
    "JUNIOR_CAP",
    "LEVEL_CAP",
]

WEIGHT_STEPS = range(10, 51, 5)
PARTIAL_STEPS = range(300, 901, 50)
LEVEL_ONE_STEPS = range(700, 1001, 50)
LEVEL_TWO_STEPS = range(300, 701, 50)


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
    if s["off_field"] == 1:
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


def percent(s, p):
    """`scorer::percent`: (total, fine, class)."""
    klass = field_class(s, p)
    role = p["FIELD_VALUES"][klass] * level_factor(s["level"], p) // 1000
    core = share(s["core_met"], s["core_partial"], s["core_open"], 0, role, p)
    unnamed = role * p["UNNAMED"] // 1000
    musts = share(
        s["other_met"], s["other_partial"], s["other_open"], p["MUST_SATURATION"], unnamed, p
    )
    missed = min(s["frame_missed"], FRAME_ASPECTS)
    near = min(s["frame_near"], FRAME_ASPECTS - missed)
    frame = share(FRAME_ASPECTS - near - missed, near, missed, FRAME_ASPECTS, E_FULL, p)
    weights = [p["W_ROLE"], p["W_CORE"], p["W_MUSTS"], p["W_FRAME"]]
    shares = [role, core, musts, frame]
    points = [min(100, div_rhe(w * sh, 1000)) for w, sh in zip(weights, shares)]
    nice_n = s["nice_met"] + s["nice_partial"] + s["nice_open"]
    nice_share = 0 if nice_n == 0 else share(s["nice_met"], s["nice_partial"], s["nice_open"], 0, 0, p)
    nice = min(100, div_rhe(p["NICE_MAX"] * nice_share, 1000))
    total = min(100, sum(points) + nice)
    fine = min(1000, (sum(w * sh for w, sh in zip(weights, shares)) + p["NICE_MAX"] * nice_share) // 100)
    if s["permanent"] == 1:
        total -= min(100, div_rhe(total * (1000 - p["PERMANENT_FACTOR"]), 1000))
        fine = fine * p["PERMANENT_FACTOR"] // 1000
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
    for row, s, gold in pairs:
        score, rank = replay(row, s, p)
        scored.append((row, gold, score, rank))
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
    best_p = dict(start)
    best = (round(objective(pairs, best_p), 9), 0, tuple(best_p[k] for k in FITTED))
    for _ in range(2):
        base = dict(best_p)
        for a in WEIGHT_STEPS:
            for b in WEIGHT_STEPS:
                for c in WEIGHT_STEPS:
                    d = 100 - a - b - c
                    if d not in WEIGHT_STEPS:
                        continue
                    for partial in PARTIAL_STEPS:
                        p = dict(base, W_ROLE=a, W_CORE=b, W_MUSTS=c, W_FRAME=d, PARTIAL=partial)
                        cand = (round(objective(pairs, p), 9), distance(p, start), tuple(p[k] for k in FITTED))
                        if better(cand, best):
                            best, best_p = cand, p
        base = dict(best_p)
        for one in LEVEL_ONE_STEPS:
            for two in LEVEL_TWO_STEPS:
                if two > one:
                    continue
                p = dict(base, LEVEL_ONE=one, LEVEL_TWO_ABOVE=two)
                cand = (round(objective(pairs, p), 9), distance(p, start), tuple(p[k] for k in FITTED))
                if better(cand, best):
                    best, best_p = cand, p
    return best_p


def load(signals, gold_path, part):
    rows = read_jsonl(signals)
    header, rows = rows[0], rows[1:]
    names = header["names"]
    gold = {}
    for row in read_jsonl(gold_path):
        if row.get("gold") != part:
            continue
        answer = row["answer"]
        excluded = (answer.get("ausschluss") or {}).get("grund", "keiner") != "keiner"
        gold[row["pair"]] = {
            "note": 0 if excluded else int(answer["note"]),
            "passung": answer["passung"],
            "excluded": excluded,
        }
    pairs = [(r, dict(zip(names, r["v"])), gold[r["pair"]]) for r in rows if r["pair"] in gold]
    return rows, names, pairs


def show(title, pairs, p):
    nd, sp, means = measure(pairs, p)
    m = "/".join(str(means[n]) for n in (3, 2, 1, 0))
    print(f"{title}: ndcg@10 {nd:.3f}  spearman {sp:.3f}  mean per note 3/2/1/0 {m}")


def main():
    here = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    parser.add_argument("--signals", required=True)
    parser.add_argument("--gold", required=True)
    parser.add_argument("--part", default="tune")
    parser.add_argument("--params", default=str(here / "../../core/src/matching/params.rs"))
    args = parser.parse_args()
    current = read_params(args.params)
    rows, names, pairs = load(args.signals, args.gold, args.part)
    if not pairs:
        raise SystemExit(f"no pairs of part {args.part} in {args.signals}")
    wrong = []
    for row in rows:
        s = dict(zip(names, row["v"]))
        if row.get("score") is not None and replay(row, s, current) != (row["score"], row["rank"]):
            wrong.append(row["pair"])
    if wrong:
        raise SystemExit(f"the replay differs from the engine on {len(wrong)} pairs, e.g. {wrong[:3]}")
    print(f"{len(pairs)} pairs of part {args.part}; the replay matches all {len(rows)} dumped scores")
    show("current", pairs, current)
    fitted = search(pairs, current)
    show("fitted ", pairs, fitted)
    print("\n// fitted on the gold labels by tools/scorer/train.py")
    for name in FITTED:
        print(f"pub(crate) const {name}: u64 = {fitted[name]};")


if __name__ == "__main__":
    main()
