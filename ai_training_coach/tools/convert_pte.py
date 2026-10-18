"""Convert the PTE synthetic dataset (users / daily / sessions / sets tables) into the coach's
wide training format: one row per person per 4-week block, label column `exercises`.

    python tools/convert_pte.py <pte data dir> --out data/pte_blocks.csv

Features: the person's profile plus their lifestyle averages over the block.
Labels: the movements the person actually did in that block. A movement done in only one
session is a soft 0.6, and one that came with pain (NRS >= 3) is halved.
The PTE `split` column (assigned by user) is kept, so `train` never mixes a person across splits.
Latent `_SYNTH` / `synthetic_truth_*` columns are never read.
"""
from __future__ import annotations

import argparse
import csv
import gzip
import random
import sys
from collections import defaultdict
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_coach import BY_ID  # noqa: E402

BLOCK_WEEKS = 4

# PTE exercise id -> coach catalog id
EXERCISE_MAP = {
    "sit_to_stand": "sit_to_stand", "bodyweight_squat": "bodyweight_squat",
    "goblet_squat": "goblet_squat", "leg_press": "leg_press",
    "barbell_back_squat": "barbell_back_squat", "split_squat": "split_squat", "step_up": "step_up",
    "db_bulgarian_split_squat": "bulgarian_split_squat", "glute_bridge": "glute_bridge",
    "hip_thrust": "barbell_hip_thrust", "romanian_deadlift": "dumbbell_romanian_deadlift",
    "hamstring_curl": "lying_leg_curl", "incline_pushup": "incline_push_up", "pushup": "push_up",
    "db_bench_press": "dumbbell_bench_press", "machine_chest_press": "machine_chest_press",
    "barbell_bench": "barbell_bench_press", "db_overhead_press": "dumbbell_shoulder_press",
    "band_overhead_press": "band_overhead_press", "lateral_raise": "dumbbell_lateral_raise",
    "band_row": "band_row", "db_row": "single_arm_dumbbell_row",
    "seated_cable_row": "seated_cable_row", "lat_pulldown": "lat_pulldown", "pullup": "pull_up",
    "face_pull": "band_face_pull", "db_curl": "dumbbell_curl",
    "triceps_pushdown": "triceps_pushdown", "overhead_triceps_ext": "overhead_triceps_extension",
    "dead_bug": "dead_bug", "plank": "front_plank", "side_plank": "side_plank",
    "pallof_press": "band_pallof_press", "farmers_carry": "farmers_carry",
    "calf_raise": "standing_calf_raise",
}
AEROBIC_MAP = {"walk": "brisk_walk", "intervals": "intervals_4x4"}
GOALS = {"1": "health", "2": "active", "3": "fit", "4": "strength", "5": "body_shape"}
TRAINING_YEARS = {"untrained": 0.0, "novice": 0.7, "trained": 2.5}
EQUIPMENT = {"none": "none", "home": "bands;dumbbells;kettlebell;pull_up_bar", "gym": "gym"}
# Lifestyle columns are blanked on a share of rows, so the model also learns to suggest well
# for apps that only know the profile (the encoder adds a missing flag for each).
LIFESTYLE = ["sleep_hours", "steps", "sitting_hours", "head_down_minutes", "phone_after_23h_minutes",
             "phone_screen_hours", "resting_hr", "gait_speed_mps", "hrv_z", "soreness",
             "emg_load_upper", "emg_load_lower", "emg_load_trunk"]


def _open(p: Path):
    return gzip.open(p, "rt", newline="") if p.suffix == ".gz" else open(p, newline="")


def _rows(d: Path, name: str):
    p = d / f"{name}.csv"
    with _open(p if p.exists() else d / f"{name}.csv.gz") as f:
        yield from csv.DictReader(f)


def _label_name(eid: str) -> str:
    # A comma inside a name (e.g. "4x4 Intervals (walk-run, bike or rower)") would be read as a
    # separator on one-label rows, so those use the catalog id, which matches just as well.
    name = BY_ID[eid].name
    return eid if "," in name else name


def _mean(xs):
    xs = [float(x) for x in xs if x not in ("", None)]
    return round(sum(xs) / len(xs), 3) if xs else ""


def convert(d: Path, out: Path, blank_frac: float = 0.3, seed: int = 0, drop: tuple = (),
            blank_each: float = 0.0) -> int:
    for eid in list(EXERCISE_MAP.values()) + list(AEROBIC_MAP.values()):
        assert eid in BY_ID, f"{eid} is not in the coach catalog"
    rng = random.Random(seed)
    users = {u["user_id"]: u for u in _rows(d, "users")}
    daily = defaultdict(lambda: defaultdict(list))
    for r in _rows(d, "daily"):
        k = (r["user_id"], int(r["week"]) // BLOCK_WEEKS)
        for col, src in [("sleep_hours", "sleep_h"), ("steps", "steps"), ("sitting_hours", "sitting_h"),
                         ("head_down_minutes", "head_down_min"), ("phone_after_23h_minutes", "phone_after23_min"),
                         ("phone_screen_hours", "phone_total_min"), ("resting_hr", "rhr_bpm"),
                         ("gait_speed_mps", "gait_speed_free"), ("hrv_z", "hrv_z"), ("soreness", "soreness_0_10"),
                         ("emg_load_upper", "emg_load_upper"), ("emg_load_lower", "emg_load_lower"),
                         ("emg_load_trunk", "emg_load_trunk")]:
            daily[k][col].append(r[src])
    attend = defaultdict(lambda: [0, 0])
    aerobic = defaultdict(lambda: defaultdict(int))
    for s in _rows(d, "sessions"):
        k = (s["user_id"], int(s["week"]) // BLOCK_WEEKS)
        attend[k][0] += int(s["attended"])
        attend[k][1] += 1
        if s["session_type"] == "aerobic" and s["attended"] == "1" and s["aerobic_type"] in AEROBIC_MAP:
            aerobic[k][AEROBIC_MAP[s["aerobic_type"]]] += 1
    sessions = defaultdict(lambda: defaultdict(set))
    pain = defaultdict(lambda: defaultdict(float))
    for r in _rows(d, "sets"):
        if r["session_type"] != "strength":
            continue
        k = (r["user_id"], int(r["week"]) // BLOCK_WEEKS)
        eid = EXERCISE_MAP[r["exercise_id"]]
        sessions[k][eid].add(r["session_id"])
        if r["pain_nrs"] not in ("", None):
            pain[k][eid] = max(pain[k][eid], float(r["pain_nrs"]))

    rows = []
    for (uid, blk) in sorted(set(sessions) | set(aerobic), key=lambda k: (int(k[0]), k[1])):
        u = users[uid]
        k = (uid, blk)
        lab = {}
        for eid, ss in sessions[k].items():
            w = 1.0 if len(ss) >= 2 else 0.6
            lab[eid] = w * (0.5 if pain[k][eid] >= 3 else 1.0)
        for eid, n in aerobic[k].items():
            lab[eid] = 1.0 if n >= 2 else 0.6
        if not lab:
            continue
        prev = attend.get((uid, blk - 1))
        row = {
            "sample_id": f"u{uid}b{blk}", "user_id": uid, "split": u["split"],
            "age": u["age"], "sex": {"F": "female", "M": "male"}[u["sex"]],
            "height_cm": u["height_cm"], "weight_kg": u["weight_kg"], "goal": GOALS[u["tier"]],
            "body_shape_subgoal": u["subgoal"] if u["tier"] == "5" else "",
            "training_age_years": TRAINING_YEARS[u["training_age"]],
            "days_per_week": u["n_days_available"], "minutes_per_week": u["weekly_minutes"],
            "equipment": EQUIPMENT[u["equipment"]], "priority_muscles": u["priority_muscles"].replace("|", ";"),
            "program_block": blk,
            "attendance_prev_block": round(prev[0] / prev[1], 3) if prev and prev[1] else "",
        }
        means = {c: _mean(v) for c, v in daily[k].items()}
        if means.get("phone_screen_hours") not in ("", None):
            means["phone_screen_hours"] = round(means["phone_screen_hours"] / 60, 2)
        blank = rng.random() < blank_frac
        for c in LIFESTYLE:
            if c not in drop:
                row[c] = "" if blank or rng.random() < blank_each else means.get(c, "")
        row["exercises"] = ";".join(f"{_label_name(e)}:{w:g}" if w < 1 else _label_name(e)
                                    for e, w in sorted(lab.items(), key=lambda x: -x[1]))
        rows.append(row)
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w", newline="") as f:
        wr = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        wr.writeheader()
        wr.writerows(rows)
    return len(rows)


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("data_dir")
    ap.add_argument("--out", default="data/pte_blocks.csv")
    ap.add_argument("--blank-lifestyle", type=float, default=0.3)
    ap.add_argument("--blank-each", type=float, default=0.0,
                    help="also blank each lifestyle value on its own with this chance (a sensor that missed a day)")
    ap.add_argument("--drop", default="",
                    help="comma-separated lifestyle columns to leave out, e.g. resting_hr,hrv_z without a wristband")
    ap.add_argument("--seed", type=int, default=0)
    a = ap.parse_args()
    n = convert(Path(a.data_dir), Path(a.out), a.blank_lifestyle, a.seed,
                tuple(x for x in a.drop.split(",") if x), a.blank_each)
    print(f"Wrote {n} rows to {a.out}")
