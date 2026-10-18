"""Export a trained coach model to one JSON file the MyoCoach web app scores in the browser.

    python tools/export_web.py models/phone_garment_model --out ../daily-coach/src/coach/coach-model.json

The MyoCoach Daily app (daily-coach/) uses it. The JSON holds the fitted feature encoder, the user tower (W1, b1, W2, b2) and the exercise
vectors with the metadata tower already folded in (V = E + M @ Wm), so the browser only needs
two small matrix products. `src/coach/model.ts` mirrors FeatureEncoder.transform and _forward.
It also writes a few reference scores so the TypeScript port can be checked against NumPy.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from training_coach import CoachModel  # noqa: E402

# Feature rows the parity check scores in both NumPy and TypeScript.
REFERENCE_ROWS = [
    {"age": 29, "sex": "male", "height_cm": 180, "weight_kg": 78, "goal": "body_shape",
     "body_shape_subgoal": "lean_gain", "training_age_years": 0.7, "days_per_week": 4,
     "minutes_per_week": 240, "equipment": "gym", "priority_muscles": "chest;shoulders"},
    {"age": 52, "sex": "female", "height_cm": 162, "weight_kg": 70, "goal": "health",
     "training_age_years": 0.0, "days_per_week": 3, "minutes_per_week": 120, "equipment": "none"},
    {"age": 35, "sex": "female", "height_cm": 168, "weight_kg": 64, "goal": "strength",
     "training_age_years": 2.5, "days_per_week": 3, "minutes_per_week": 180,
     "equipment": "bands;dumbbells;kettlebell;pull_up_bar", "sleep_hours": 6.1, "steps": 4200},
]


def r(a, nd=5):
    return np.round(np.asarray(a, float), nd).tolist()


def export(model_dir: str, out: str) -> dict:
    m = CoachModel.load(model_dir)
    p = m.rec.p
    V = p["E"] + m.rec.M @ p["Wm"]
    ref = m.score_rows(REFERENCE_ROWS)
    info = m.info
    doc = {
        "format": "myocoach-coach-model/1",
        "trainedOn": Path(info.get("trained_on", "")).name,
        "rows": info.get("rows"),
        "splitBy": info.get("split_by", "random"),
        "testMetrics": info.get("test_metrics"),
        "encoder": m.encoder.to_json()["spec"],
        "W1": r(p["W1"]), "b1": r(p["b1"]), "W2": r(p["W2"]), "b2": r(p["b2"]),
        "items": [{"id": e.id, "name": e.name, "pattern": e.pattern, "muscles": list(e.muscles),
                   "equipment": e.equipment, "level": e.level, "category": e.category,
                   "contraindications": list(e.contraindications), "cue": e.cue} for e in m.items],
        "V": r(V), "c": r(p["c"]),
        "reference": {"rows": REFERENCE_ROWS, "top": [
            [[m.items[j].id, round(float(row[j]), 4)] for j in np.argsort(-row)[:8]] for row in ref]},
    }
    Path(out).parent.mkdir(parents=True, exist_ok=True)
    Path(out).write_text(json.dumps(doc, separators=(",", ":")))
    return doc


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("model_dir")
    ap.add_argument("--out", required=True)
    a = ap.parse_args()
    d = export(a.model_dir, a.out)
    print(f"Wrote {a.out}: {len(d['items'])} exercises, {len(d['W1'])} encoded features "
          f"({Path(a.out).stat().st_size / 1024:.0f} KB)")
